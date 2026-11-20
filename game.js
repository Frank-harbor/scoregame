(() => {
  "use strict";

  const CONFIG = window.SCOREGAME_CONFIG || {};
  const STORE = "scoregame.";
  const COUNT_UP_MS = 700;
  const POSTER_WAIT_MS = 4000;
  const CLIP_WAIT_MS = 8000;
  const CLIP_SECONDS = [0.5, 1, 3, 5, 10];
  const SMALLEST_POOL = 8;
  const BOARD_ROWS = 10;
  const DUEL_WIN = 5;
  const DUEL_SECONDS = 20;
  const DUEL_PAUSE_MS = 4500;
  const DUEL_GAP = 5;
  const ROOM_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I to misread

  const $ = (id) => document.getElementById(id);
  const board = $("board");
  const ask = $("ask");
  const notice = $("notice");
  const retry = $("retry");
  const result = $("result");
  const verdict = $("verdict");
  const store = $("store");
  const next = $("next");
  const leaveMatch = $("leaveMatch");
  const streakEl = $("streak");
  const bestEl = $("best");
  const leftLabel = $("leftLabel");
  const rightLabel = $("rightLabel");
  const years = $("years");
  const yearFrom = $("yearFrom");
  const yearTo = $("yearTo");
  const yearsText = $("yearsText");
  const rangeFill = $("rangeFill");
  const targetSeg = $("targetSeg");
  const timer = $("timer");
  const player = $("player");
  const playButton = $("play");
  const skipButton = $("skip");
  const stageDots = [...$("stages").children];
  const tabs = [...document.querySelectorAll("[data-mode]")];
  const targetButtons = [...document.querySelectorAll("[data-target]")];
  const kindButtons = [...document.querySelectorAll("[data-kind]")];
  const who = $("who");
  const nameDialog = $("nameDialog");
  const nameInput = $("nameInput");
  const lobby = $("lobby");

  const calmMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const audio = new Audio();
  audio.preload = "auto";

  const lists = { movies: window.SG_MOVIES, games: window.SG_GAMES, themes: window.SG_THEMES };
  const roomInLink = new URLSearchParams(location.search).get("room");

  let mode = ["movies", "games", "themes", "duel"].includes(load("mode")) ? load("mode") : "movies";
  if (roomInLink) mode = "duel";
  let target = load("target") === "lowest" ? "lowest" : "highest";
  let range = { from: Number(load("from")) || 0, to: Number(load("to")) || 9999 };
  let playerName = (load("name") || "").slice(0, 16);
  let askedForName = false;
  let pendingScore = null;
  let pool = [];
  let streak = 0;
  let best = 0;
  let round = [];
  let answer = null;
  let tickets = [];
  let picking = false;
  let lost = false;
  let unseen = [];
  let dealNumber = 0;
  let stage = 0;
  let clipTimer = 0;
  const counting = new Set();

  // Saved choices. Private browsing can refuse storage, and then they last for this visit only.
  function load(key) {
    try {
      return localStorage.getItem(STORE + key);
    } catch {
      return null;
    }
  }

  function save(key, value) {
    try {
      localStorage.setItem(STORE + key, String(value));
    } catch {}
  }

  const solo = () => mode !== "duel";
  const rated = () => mode !== "themes";
  const listKind = () => (mode === "duel" ? Duel.kind : mode);
  const boardKey = () => (rated() ? `${listKind()}.${target}` : "themes");
  const fmt = (score) => score.toFixed(1);
  const seconds = (n) => (n === 1 ? "1 second" : `${n} seconds`);
  const firstWord = (title) => title.toLowerCase().replace(/^the\s+/, "").split(/[\s:]/)[0];
  const winnerLabel = () => (target === "lowest" ? "Lowest" : "Highest");
  const press = (buttons, key, value) =>
    buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset[key] === value)));

  function setTally(el, value) {
    if (el.textContent === String(value)) return;
    el.textContent = value;
    el.classList.remove("bump");
    void el.offsetWidth; // restart the pop
    el.classList.add("bump");
  }

  /* ---------- choosing a round ---------- */

  // The winner has to beat the runner-up by a clear margin early on.
  // The margin shrinks as the streak grows, so rounds get harder.
  function soloGap() {
    return Math.max(1, 12 - streak);
  }

  function sample(count, from) {
    const picks = new Set();
    while (picks.size < count) picks.add(from[Math.floor(Math.random() * from.length)]);
    return [...picks];
  }

  // Scores ordered so the one the player is hunting for comes first.
  function ranked(items) {
    const sign = target === "lowest" ? 1 : -1;
    return [...items].sort((a, b) => sign * (a.score - b.score));
  }

  function refillUnseen() {
    if (unseen.length < Math.min(40, pool.length)) unseen = pool.map((_, i) => i);
  }

  function drawRatedRound(gap) {
    refillUnseen();
    let picks;
    for (let attempt = 1; attempt <= 2000; attempt++) {
      picks = sample(4, unseen);
      const order = ranked(picks.map((i) => pool[i]));
      if (Math.abs(order[0].score - order[1].score) >= gap) break;
      // No luck at this margin: settle for any round with a single winner.
      if (attempt % 200 === 0) gap = 0.5;
    }
    unseen = unseen.filter((i) => !picks.includes(i));
    return picks.map((i) => pool[i]);
  }

  function drawThemeRound() {
    refillUnseen();
    const at = Math.floor(Math.random() * unseen.length);
    answer = pool[unseen.splice(at, 1)[0]];
    // Wrong answers come from other series, so "Halo" never sits next to "Halo 2".
    const others = pool.filter((g) => firstWord(g.title) !== firstWord(answer.title));
    const four = [answer];
    for (let guard = 0; four.length < 4 && guard < 500; guard++) {
      const g = others[Math.floor(Math.random() * others.length)];
      if (!four.some((f) => firstWord(f.title) === firstWord(g.title))) four.push(g);
    }
    return four.sort(() => Math.random() - 0.5);
  }

  /* ---------- pictures and clips ---------- */

  function preload(src) {
    return new Promise((resolve) => {
      const img = new Image();
      const done = () => resolve();
      img.onload = done;
      img.onerror = done;
      img.src = src;
      setTimeout(done, POSTER_WAIT_MS);
    });
  }

  function loadClip(src) {
    return new Promise((resolve) => {
      const finish = (ok) => {
        audio.removeEventListener("canplaythrough", yes);
        audio.removeEventListener("error", no);
        clearTimeout(wait);
        resolve(ok);
      };
      const yes = () => finish(true);
      const no = () => finish(false);
      const wait = setTimeout(no, CLIP_WAIT_MS);
      audio.addEventListener("canplaythrough", yes);
      audio.addEventListener("error", no);
      audio.src = src;
      audio.load();
    });
  }

  function stopClip() {
    clearTimeout(clipTimer);
    audio.pause();
    playButton.classList.remove("playing");
  }

  // Plays the clip from the start. A length of 0 lets it run to the end.
  function playClip(length) {
    stopClip();
    audio.currentTime = 0;
    audio.play().then(() => {
      if (!length) return;
      playButton.style.setProperty("--clip", `${length}s`);
      playButton.classList.add("playing");
      clipTimer = setTimeout(stopClip, length * 1000);
    }).catch(() => {
      notice.hidden = false;
      notice.textContent = "The clip would not play. Check your sound and press play again.";
    });
  }

  function showStage() {
    const length = CLIP_SECONDS[stage];
    playButton.textContent = `Play ${seconds(length)}`;
    stageDots.forEach((dot, i) => {
      dot.classList.toggle("used", i < stage);
      dot.classList.toggle("now", i === stage);
    });
    const last = stage === CLIP_SECONDS.length - 1;
    skipButton.hidden = last;
    if (!last) skipButton.textContent = `Skip to ${seconds(CLIP_SECONDS[stage + 1])}`;
  }

  /* ---------- the four cards ---------- */

  function buildTicket(index) {
    const ticket = document.createElement("button");
    ticket.type = "button";
    ticket.className = "ticket dealing";
    ticket.innerHTML = `
      <span class="poster"><img alt=""><span class="fallback"></span><span class="badges"></span></span>
      <span class="info">
        <span class="title"></span>
        <span class="year"></span>
        <span class="scorebox">
          <span class="score"></span>
          <span class="meter"><span></span></span>
          <span class="sources"></span>
        </span>
      </span>`;
    const img = ticket.querySelector("img");
    img.addEventListener("error", () => img.parentElement.classList.add("missing"));
    ticket.addEventListener("click", () => pick(index));
    return ticket;
  }

  function fillTicket(ticket, item, scored) {
    ticket.querySelector(".poster").classList.remove("missing");
    ticket.querySelector("img").src = item.poster;
    ticket.querySelector(".fallback").textContent = item.title;
    ticket.querySelector(".title").textContent = item.title;
    ticket.querySelector(".year").textContent = item.year;
    ticket.querySelector(".badges").replaceChildren();
    ticket.querySelector(".score").textContent = "??";
    ticket.querySelector(".meter span").style.width = "0%";
    ticket.querySelector(".sources").textContent = scored ? "Hidden score" : "";
    ticket.setAttribute("aria-label", `${item.title}, ${item.year}`);
    ticket.className = scored ? "ticket dealing" : "ticket dealing unscored";
    ticket.disabled = false;
  }

  function clearBoard() {
    dealNumber += 1; // drops any deal still loading
    counting.forEach(stopCounting);
    picking = false;
    board.replaceChildren();
    tickets = [];
  }

  // Puts four items on the table. Resolves false if another deal replaced this one meanwhile.
  async function layOut(items, scored, thisDeal) {
    await Promise.all(items.map((m) => preload(m.poster)));
    if (thisDeal !== dealNumber) return false;
    round = items;
    if (tickets.length === 0) {
      tickets = [0, 1, 2, 3].map(buildTicket);
      board.append(...tickets);
    }
    notice.hidden = true;
    tickets.forEach((t, i) => fillTicket(t, round[i], scored));
    // A short wait so the browser paints the hidden state before sliding the cards in.
    setTimeout(() => {
      if (thisDeal !== dealNumber) return;
      tickets.forEach((t) => t.classList.remove("dealing"));
      picking = true;
    }, 40);
    return true;
  }

  function hideTable() {
    picking = false;
    counting.forEach(stopCounting); // a fast "Next four" can land mid count-up
    tickets.forEach((t) => {
      t.disabled = true;
      t.classList.add("dealing");
    });
    return ++dealNumber;
  }

  async function deal() {
    result.hidden = true;
    store.hidden = true;
    stopClip();
    const thisDeal = hideTable();

    if (rated()) return layOut(drawRatedRound(soloGap()), true, thisDeal);

    playButton.disabled = true;
    skipButton.disabled = true;
    // A clip that will not load is swapped for another game, a few times over.
    let four;
    for (let attempt = 0; ; attempt++) {
      four = drawThemeRound();
      const ready = await loadClip(answer.preview);
      if (thisDeal !== dealNumber) return;
      if (ready) break;
      if (attempt === 3) return fail("The theme clips are not loading. Check your connection and try again.");
    }
    stage = 0;
    showStage();
    playButton.disabled = false;
    skipButton.disabled = false;
    layOut(four, false, thisDeal);
  }

  /* ---------- the reveal ---------- */

  function countUp(el, to) {
    if (calmMotion) {
      el.textContent = fmt(to);
      return;
    }
    const start = performance.now();
    const ticker = setInterval(() => {
      const t = Math.min(1, (performance.now() - start) / COUNT_UP_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = fmt(t === 1 ? to : Math.floor(to * eased * 2) / 2);
      if (t === 1) stopCounting(ticker);
    }, 16);
    counting.add(ticker);
  }

  function stopCounting(ticker) {
    clearInterval(ticker);
    counting.delete(ticker);
  }

  // marks: one list per card of { text, tone } badges. mine: the card this player picked, if any.
  function revealTable(winner, mine, marks, scored) {
    picking = false;
    tickets.forEach((ticket, i) => {
      const item = round[i];
      ticket.disabled = true;
      ticket.classList.remove("chosen");
      ticket.classList.add("revealed");
      if (item === winner) ticket.classList.add("win");
      if (i === mine) ticket.classList.add(item === winner ? "hit" : "miss");
      ticket.querySelector(".badges").replaceChildren(...marks[i].map((mark) => {
        const badge = document.createElement("span");
        badge.className = `badge ${mark.tone}`;
        badge.textContent = mark.text;
        return badge;
      }));
      if (scored) {
        ticket.querySelector(".sources").textContent = `IMDb ${item.imdb.toFixed(1)} · Metacritic ${item.mc}`;
        ticket.querySelector(".meter span").style.width = `${item.score}%`;
        ticket.setAttribute("aria-label", `${item.title}, ${item.year}, score ${fmt(item.score)}`);
        countUp(ticket.querySelector(".score"), item.score);
      } else if (item === winner) {
        ticket.querySelector(".sources").textContent = `${item.track}, ${item.artist}`;
      }
    });
  }

  function pick(index) {
    if (!picking) return;
    if (!solo()) return Duel.pick(index);
    picking = false;

    const winner = rated() ? ranked(round)[0] : answer;
    const chosen = round[index];
    const right = chosen === winner;
    const marks = round.map((item, i) => [
      ...(item === winner ? [{ text: rated() ? winnerLabel() : "The answer", tone: "win" }] : []),
      ...(i === index ? [{ text: "Your pick", tone: right ? "good" : "bad" }] : []),
    ]);
    revealTable(winner, index, marks, rated());

    if (right) {
      streak += 1;
      if (streak > best) {
        best = streak;
        save(`best.${boardKey()}`, best);
      }
    }
    if (rated()) {
      const word = target === "lowest" ? "is lowest on" : "leads on";
      verdict.textContent = right
        ? `Right. ${winner.title} ${word} ${fmt(winner.score)}.`
        : `Streak over at ${streak}. ${winner.title} had ${fmt(winner.score)}, ` +
          `${chosen.title} had ${fmt(chosen.score)}.`;
    } else {
      verdict.textContent = right
        ? `Right. ${winner.title}, from ${seconds(CLIP_SECONDS[stage])}.`
        : `Streak over at ${streak}. That was ${winner.title}.`;
      store.href = winner.link;
      store.hidden = false;
      playButton.disabled = true;
      skipButton.disabled = true;
      playClip(0); // the full preview, as the payoff
    }
    next.textContent = right ? "Next four" : "Play again";
    next.hidden = false;
    leaveMatch.hidden = true;
    lost = !right;
    verdict.className = right ? "verdict is-right" : "verdict is-wrong";
    setTally(streakEl, streak);
    setTally(bestEl, best);
    if (lost && streak > 0) recordRun(boardKey(), streak);

    result.hidden = false;
    next.focus({ preventScroll: true });
  }

  function advance() {
    if (!solo()) return Duel.rematch();
    if (lost) {
      lost = false;
      streak = 0;
      setTally(streakEl, 0);
    }
    deal();
  }

  /* ---------- leaderboard ---------- */

  const Ranks = {
    shared: Boolean(CONFIG.supabaseUrl && CONFIG.supabaseKey),
    showing: "",
    request: 0,

    headers() {
      return {
        apikey: CONFIG.supabaseKey,
        Authorization: `Bearer ${CONFIG.supabaseKey}`,
        "Content-Type": "application/json",
      };
    },

    onDevice(key) {
      try {
        const rows = JSON.parse(load(`ranks.${key}`) || "[]");
        return Array.isArray(rows) ? rows : [];
      } catch {
        return [];
      }
    },

    // Each name keeps its best run only.
    keepOnDevice(key, name, score) {
      const rows = this.onDevice(key).filter((r) => r.name !== name || r.score > score);
      if (!rows.some((r) => r.name === name)) rows.push({ name, score });
      rows.sort((a, b) => b.score - a.score);
      save(`ranks.${key}`, JSON.stringify(rows.slice(0, 50)));
    },

    async top(key) {
      if (!this.shared) return this.onDevice(key).slice(0, BOARD_ROWS);
      const url = `${CONFIG.supabaseUrl}/rest/v1/scores?select=name,score` +
        `&board=eq.${encodeURIComponent(key)}&order=score.desc,updated_at.asc&limit=${BOARD_ROWS}`;
      const res = await fetch(url, { headers: this.headers() });
      if (!res.ok) throw new Error(`leaderboard ${res.status}`);
      return res.json();
    },

    async submit(key, name, score) {
      this.keepOnDevice(key, name, score);
      if (this.shared) {
        // The database keeps whichever is higher, so an off day never lowers a best.
        await fetch(`${CONFIG.supabaseUrl}/rest/v1/rpc/submit_score`, {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify({ p_board: key, p_name: name, p_score: score }),
        }).catch(() => {});
      }
      if (this.showing === key) this.show(key);
    },

    async show(key) {
      this.showing = key;
      const mine = ++this.request;
      const list = $("ranks");
      const note = $("ranksNote");
      const [what, which] = key.split(".");
      $("boardName").textContent = which
        ? `${what[0].toUpperCase()}${what.slice(1)} · ${which[0].toUpperCase()}${which.slice(1)}`
        : "Themes";
      $("ranksScope").textContent = this.shared
        ? "Best streaks from everyone who has played."
        : "Best streaks on this device.";
      $("ranksRetry").hidden = true;
      if (this.shared) {
        list.replaceChildren();
        note.hidden = false;
        note.textContent = "Loading scores.";
      }
      let rows;
      try {
        rows = await this.top(key);
      } catch {
        if (mine !== this.request) return;
        list.replaceChildren();
        note.hidden = false;
        note.textContent = "The leaderboard did not load.";
        $("ranksRetry").hidden = false;
        return;
      }
      if (mine !== this.request) return;
      note.hidden = rows.length > 0;
      note.textContent = "No scores yet. Finish a run of 1 or more to get on the board.";
      list.replaceChildren(...rows.map((row, i) => {
        const li = document.createElement("li");
        if (row.name === playerName) li.className = "me";
        for (const [cls, text] of [["rank", i + 1], ["rank-name", row.name], ["rank-score", row.score]]) {
          const span = document.createElement("span");
          span.className = cls;
          span.textContent = text;
          li.append(span);
        }
        return li;
      }));
    },
  };

  function recordRun(key, score) {
    if (playerName) return Ranks.submit(key, playerName, score);
    if (askedForName) return;
    askedForName = true;
    pendingScore = { key, score };
    askName();
  }

  function showName() {
    who.textContent = playerName ? `Playing as ${playerName}` : "Set your name";
  }

  function askName() {
    nameInput.value = playerName;
    nameDialog.showModal();
    nameInput.select();
  }

  /* ---------- years ---------- */

  function showYears(list) {
    const all = list.map((m) => m.year);
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const from = Math.min(Math.max(range.from, lo), hi);
    const to = Math.max(Math.min(range.to, hi), from);
    for (const input of [yearFrom, yearTo]) {
      input.min = lo;
      input.max = hi;
    }
    yearFrom.value = from;
    yearTo.value = to;
    paintYears();
    return list.filter((m) => m.year >= from && m.year <= to);
  }

  function paintYears() {
    const lo = Number(yearFrom.min);
    const span = Number(yearFrom.max) - lo || 1;
    const from = Number(yearFrom.value);
    const to = Number(yearTo.value);
    const count = lists[listKind()].filter((m) => m.year >= from && m.year <= to).length;
    yearsText.textContent =
      `${from === to ? from : `${from} to ${to}`} · ${count.toLocaleString("en")} ${listKind()}`;
    rangeFill.style.left = `${((from - lo) / span) * 100}%`;
    rangeFill.style.right = `${100 - ((to - lo) / span) * 100}%`;
  }

  // The two handles may meet but never cross.
  function onYearInput(event) {
    if (Number(yearFrom.value) > Number(yearTo.value)) {
      if (event.target === yearFrom) yearFrom.value = yearTo.value;
      else yearTo.value = yearFrom.value;
    }
    paintYears();
  }

  function onYearChange() {
    range = { from: Number(yearFrom.value), to: Number(yearTo.value) };
    save("from", range.from);
    save("to", range.to);
    start();
  }

  function lockControls(locked) {
    for (const el of [...targetButtons, yearFrom, yearTo]) el.disabled = locked;
  }

  /* ---------- 1v1 ---------- */

  const Duel = {
    kind: load("duelKind") === "games" ? "games" : "movies",
    state: "idle", // idle | waiting | joining | playing
    peer: null,
    conn: null,
    host: false,
    code: "",
    theirName: "Your friend",
    me: 0,
    them: 0,
    n: 0,
    open: false,
    myPick: null,
    theirPick: null,
    roundTimer: 0,
    nextTimer: 0,
    over: false,

    show(title, text, parts) {
      lobby.hidden = false;
      ask.hidden = true;
      timer.hidden = true;
      result.hidden = true;
      clearBoard();
      $("lobbyTitle").textContent = title;
      $("lobbyText").textContent = text;
      $("duelKindSeg").hidden = !parts.setup;
      $("createRoom").hidden = !parts.setup;
      $("invite").hidden = !parts.invite;
      $("leaveRoom").hidden = !parts.leave;
      $("leaveRoom").textContent = parts.leave || "";
      targetSeg.hidden = !parts.setup;
      years.hidden = !parts.setup;
      $("tally").hidden = true;
      lockControls(false);
      if (parts.setup) {
        press(kindButtons, "kind", this.kind);
        press(targetButtons, "target", target);
        showYears(lists[this.kind]);
      }
    },

    setup(problem) {
      this.state = "idle";
      this.show(
        problem ? "Match ended" : "Play a friend",
        problem || `You both get the same four and pick at the same time. A right pick is a point. First to ${DUEL_WIN} wins.`,
        { setup: true }
      );
      Ranks.show(boardKey());
    },

    enter() {
      if (!Array.isArray(lists.movies) || !Array.isArray(lists.games)) {
        return fail("The movie and game lists did not load. Check your connection and try again.");
      }
      if (this.state !== "idle") return;
      if (roomInLink && !this.usedLink) {
        this.usedLink = true;
        return this.join(roomInLink.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8));
      }
      this.setup();
    },

    create() {
      if (!window.Peer) return this.setup("1v1 could not load its connection service. Refresh the page and try again.");
      if (showYears(lists[this.kind]).length < SMALLEST_POOL) {
        return this.setup("Too few titles in those years for a match. Widen the range.");
      }
      this.host = true;
      this.state = "waiting";
      this.code = Array.from({ length: 5 }, () => ROOM_LETTERS[Math.floor(Math.random() * ROOM_LETTERS.length)]).join("");
      this.show(`Room ${this.code}`, "Opening the room.", { leave: "Close room" });
      this.peer = new window.Peer(`scoregame-${this.code}`);
      this.peer.on("open", () => {
        $("inviteLink").value = `${location.origin}${location.pathname}?room=${this.code}`;
        this.show(`Room ${this.code}`, "Send this link to your friend. The match starts when they open it.",
          { invite: true, leave: "Close room" });
      });
      this.peer.on("connection", (conn) => {
        if (this.conn) return conn.close(); // the room already has two players
        this.adopt(conn);
      });
      this.peer.on("error", (err) => {
        if (err.type === "unavailable-id") {
          this.close();
          return this.create(); // someone else has that code: roll another
        }
        this.fall("The connection service did not answer. Check your connection and try again.");
      });
    },

    join(code) {
      if (!window.Peer) return this.setup("1v1 could not load its connection service. Refresh the page and try again.");
      this.host = false;
      this.state = "joining";
      this.code = code;
      this.show(`Joining room ${code}`, "Connecting to your friend.", { leave: "Cancel" });
      this.peer = new window.Peer();
      this.peer.on("open", () => this.adopt(this.peer.connect(`scoregame-${code}`, { reliable: true })));
      this.peer.on("error", (err) => this.fall(err.type === "peer-unavailable"
        ? "That room is not open any more. Ask your friend for a new link."
        : "The connection service did not answer. Check your connection and try again."));
    },

    adopt(conn) {
      this.conn = conn;
      conn.on("open", () => {
        if (!this.host) this.send({ t: "hello", name: playerName });
      });
      conn.on("data", (message) => this.receive(message));
      conn.on("close", () => this.fall(`${this.theirName} left the match.`));
    },

    send(message) {
      if (this.conn && this.conn.open) this.conn.send(message);
    },

    receive(m) {
      if (!m || typeof m !== "object") return;
      if (m.t === "hello" && this.host) {
        this.theirName = String(m.name || "Your friend").slice(0, 16);
        this.send({ t: "hello", name: playerName, kind: this.kind, target, from: Number(yearFrom.value), to: Number(yearTo.value) });
        this.begin();
      } else if (m.t === "hello") {
        this.theirName = String(m.name || "Your friend").slice(0, 16);
        this.kind = m.kind === "games" ? "games" : "movies";
        target = m.target === "lowest" ? "lowest" : "highest"; // the host's choice, for this match only
        range = { from: Number(m.from) || 0, to: Number(m.to) || 9999 };
        this.begin();
      } else if (m.t === "round" && !this.host) {
        const byId = new Map(lists[this.kind].map((item) => [item.id, item]));
        const items = (m.ids || []).map((id) => byId.get(id));
        if (items.length !== 4 || items.some((item) => !item)) {
          return this.fall("Your two copies of the game are out of step. Both refresh the page and try again.");
        }
        this.showRound(m.n, items);
      } else if (m.t === "pick" && this.host) {
        if (m.n !== this.n || !this.open || this.theirPick !== null) return;
        this.theirPick = [0, 1, 2, 3].includes(m.index) ? m.index : null;
        if (this.myPick !== null) this.settle();
      } else if (m.t === "reveal" && !this.host) {
        if (m.n !== this.n) return;
        this.me = m.guestScore;
        this.them = m.hostScore;
        this.reveal(m.guest, m.host, m.over);
      } else if (m.t === "rematch" && this.host) {
        if (this.over) this.again();
      } else if (m.t === "again" && !this.host) {
        this.begin();
      }
    },

    begin() {
      this.state = "playing";
      this.me = 0;
      this.them = 0;
      this.n = 0;
      this.over = false;
      lobby.hidden = true;
      targetSeg.hidden = false;
      years.hidden = false;
      $("tally").hidden = false;
      press(targetButtons, "target", target);
      pool = showYears(lists[this.kind]);
      unseen = [];
      lockControls(true);
      leftLabel.textContent = "You";
      rightLabel.textContent = this.theirName;
      streakEl.textContent = 0;
      bestEl.textContent = 0;
      Ranks.show(boardKey());
      result.hidden = true;
      notice.hidden = false;
      notice.textContent = this.host ? "Dealing the first four." : `Waiting for ${this.theirName} to deal.`;
      if (this.host) this.nextRound();
    },

    nextRound() {
      const items = drawRatedRound(DUEL_GAP);
      this.send({ t: "round", n: this.n + 1, ids: items.map((item) => item.id) });
      this.showRound(this.n + 1, items);
    },

    async showRound(n, items) {
      this.n = n;
      this.open = false;
      this.myPick = null;
      this.theirPick = null;
      clearTimeout(this.roundTimer);
      result.hidden = true;
      ask.hidden = false;
      ask.textContent = `Round ${n}. Which of these four is rated ${target}?`;
      const shown = await layOut(items, true, hideTable());
      if (!shown) return;
      this.open = true;
      timer.hidden = false;
      timer.style.setProperty("--time", `${DUEL_SECONDS}s`);
      timer.classList.remove("running");
      void timer.offsetWidth; // restart the countdown bar
      timer.classList.add("running");
      // The host calls time. A small allowance covers the other side still loading posters.
      if (this.host) this.roundTimer = setTimeout(() => this.settle(), (DUEL_SECONDS + 2) * 1000);
    },

    pick(index) {
      if (!this.open || this.myPick !== null) return;
      this.myPick = index;
      picking = false;
      tickets.forEach((t, i) => {
        t.disabled = true;
        t.classList.toggle("chosen", i === index);
      });
      notice.hidden = false;
      notice.textContent = `Locked in. Waiting for ${this.theirName}.`;
      this.send({ t: "pick", n: this.n, index });
      if (this.host && this.theirPick !== null) this.settle();
    },

    // Host only: both picks are in, or time is up.
    settle() {
      if (!this.open) return;
      clearTimeout(this.roundTimer);
      const winner = ranked(round)[0];
      if (round[this.myPick] === winner) this.me += 1;
      if (round[this.theirPick] === winner) this.them += 1;
      const over = (this.me >= DUEL_WIN || this.them >= DUEL_WIN) && this.me !== this.them;
      this.send({ t: "reveal", n: this.n, host: this.myPick, guest: this.theirPick,
        hostScore: this.me, guestScore: this.them, over });
      this.reveal(this.myPick, this.theirPick, over);
    },

    reveal(mine, theirs, over) {
      this.open = false;
      this.over = over;
      timer.hidden = true;
      timer.classList.remove("running");
      notice.hidden = true;
      const winner = ranked(round)[0];
      const iScored = round[mine] === winner;
      const theyScored = round[theirs] === winner;
      const marks = round.map((item, i) => [
        ...(item === winner ? [{ text: winnerLabel(), tone: "win" }] : []),
        ...(i === mine ? [{ text: "You", tone: iScored ? "good" : "bad" }] : []),
        ...(i === theirs ? [{ text: this.theirName, tone: "them" }] : []),
      ]);
      revealTable(winner, mine, marks, true);
      setTally(streakEl, this.me);
      setTally(bestEl, this.them);

      const roundLine = iScored && theyScored ? "You both got it."
        : iScored ? `You got it. ${this.theirName} missed.`
        : theyScored ? `${this.theirName} got it. You missed.`
        : "Nobody got it.";
      const won = this.me > this.them;
      verdict.textContent = over
        ? `${won ? "You win" : `${this.theirName} wins`} ${Math.max(this.me, this.them)} to ${Math.min(this.me, this.them)}.`
        : roundLine;
      verdict.className = (over ? won : iScored) ? "verdict is-right" : "verdict is-wrong";
      store.hidden = true;
      next.hidden = !over;
      next.textContent = "Rematch";
      leaveMatch.hidden = !over;
      result.hidden = false;
      if (over) next.focus({ preventScroll: true });
      else if (this.host) this.nextTimer = setTimeout(() => this.nextRound(), DUEL_PAUSE_MS);
    },

    rematch() {
      if (!this.over) return;
      if (this.host) return this.again();
      this.send({ t: "rematch" });
      next.hidden = true;
      verdict.textContent = `Asked ${this.theirName} for a rematch.`;
    },

    again() {
      this.send({ t: "again" });
      this.begin();
    },

    close() {
      clearTimeout(this.roundTimer);
      clearTimeout(this.nextTimer);
      const peer = this.peer;
      this.peer = null;
      this.conn = null;
      this.open = false;
      this.over = false;
      this.state = "idle";
      if (peer) peer.destroy();
      if (roomInLink) history.replaceState(null, "", location.pathname);
    },

    // The match or room ended for a reason the player should read.
    fall(reason) {
      if (this.state === "idle") return;
      this.close();
      target = load("target") === "lowest" ? "lowest" : "highest";
      range = { from: Number(load("from")) || 0, to: Number(load("to")) || 9999 };
      leftLabel.textContent = "Streak";
      rightLabel.textContent = "Best";
      if (mode === "duel") this.setup(reason);
    },

    leave() {
      this.fall("");
    },
  };

  /* ---------- modes and start ---------- */

  function fail(message) {
    clearBoard();
    stopClip();
    result.hidden = true;
    player.hidden = true;
    ask.hidden = true;
    lobby.hidden = true;
    notice.hidden = false;
    notice.textContent = message;
    retry.hidden = false;
  }

  function start() {
    press(tabs, "mode", mode);
    clearBoard();
    stopClip();
    streak = 0;
    lost = false;
    unseen = [];
    result.hidden = true;
    retry.hidden = true;
    notice.hidden = true;
    timer.hidden = true;
    player.hidden = true;
    lobby.hidden = true;
    ask.hidden = true;

    if (mode === "duel") return Duel.enter();
    Duel.leave();

    const list = lists[mode];
    targetSeg.hidden = !rated();
    years.hidden = !rated() || !Array.isArray(list);
    $("tally").hidden = false;
    lockControls(false);
    leftLabel.textContent = "Streak";
    rightLabel.textContent = "Best";
    press(targetButtons, "target", target);
    best = Number(load(`best.${boardKey()}`)) || 0;
    streakEl.textContent = streak;
    bestEl.textContent = best;
    Ranks.show(boardKey());

    if (!Array.isArray(list) || list.length < 4) {
      return fail(`The ${mode} list did not load. Check your connection and try again.`);
    }
    pool = rated() ? showYears(list) : list;
    if (pool.length < SMALLEST_POOL) {
      notice.hidden = false;
      notice.textContent = `Only ${pool.length} ${mode} in those years. Widen the range to play.`;
      return;
    }
    player.hidden = rated();
    ask.hidden = false;
    ask.textContent = rated() ? `Which of these four is rated ${target}?` : "Which game is this theme from?";
    notice.hidden = false;
    notice.textContent = rated() ? "Dealing the next four." : "Loading the clip.";
    deal();
  }

  next.addEventListener("click", advance);
  retry.addEventListener("click", () => location.reload());
  leaveMatch.addEventListener("click", () => Duel.leave());
  tabs.forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.mode === mode) return;
    mode = b.dataset.mode;
    save("mode", mode);
    start();
  }));
  targetButtons.forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.target === target) return;
    target = b.dataset.target;
    save("target", target);
    if (mode === "duel") {
      press(targetButtons, "target", target);
      return Ranks.show(boardKey());
    }
    start();
  }));
  kindButtons.forEach((b) => b.addEventListener("click", () => {
    Duel.kind = b.dataset.kind;
    save("duelKind", Duel.kind);
    Duel.setup();
  }));
  for (const input of [yearFrom, yearTo]) {
    input.addEventListener("input", onYearInput);
    input.addEventListener("change", () => {
      if (mode !== "duel") return onYearChange();
      range = { from: Number(yearFrom.value), to: Number(yearTo.value) };
      save("from", range.from);
      save("to", range.to);
    });
  }
  playButton.addEventListener("click", () => playClip(CLIP_SECONDS[stage]));
  skipButton.addEventListener("click", () => {
    if (stage >= CLIP_SECONDS.length - 1) return;
    stage += 1;
    showStage();
    playClip(CLIP_SECONDS[stage]);
  });
  $("createRoom").addEventListener("click", () => Duel.create());
  $("leaveRoom").addEventListener("click", () => Duel.leave());
  $("copyLink").addEventListener("click", async () => {
    const link = $("inviteLink");
    try {
      await navigator.clipboard.writeText(link.value);
    } catch {
      link.select(); // clipboard blocked: leave the link selected for a manual copy
      return;
    }
    $("copyLink").textContent = "Copied";
    setTimeout(() => ($("copyLink").textContent = "Copy link"), 1500);
  });
  $("ranksRetry").addEventListener("click", () => Ranks.show(Ranks.showing));

  who.addEventListener("click", askName);
  $("nameCancel").addEventListener("click", () => nameDialog.close());
  $("nameForm").addEventListener("submit", () => {
    playerName = nameInput.value.trim().slice(0, 16);
    save("name", playerName);
    showName();
    if (playerName && pendingScore) Ranks.submit(pendingScore.key, playerName, pendingScore.score);
    else Ranks.show(Ranks.showing);
  });
  nameDialog.addEventListener("close", () => (pendingScore = null));

  // 1 to 4 pick a card, left to right.
  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || nameDialog.open) return;
    if (event.target instanceof HTMLInputElement) return;
    const n = Number(event.key);
    if (n >= 1 && n <= 4) pick(n - 1);
  });

  showName();
  start();
})();
