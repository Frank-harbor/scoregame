(() => {
  "use strict";

  const CONFIG = window.SCOREGAME_CONFIG || {};
  const STORE = "scoregame.";
  const COUNT_UP_MS = 700;
  const POSTER_WAIT_MS = 4000;
  const CLIP_WAIT_MS = 12000;
  const SOUND_SECONDS = [0.5, 1, 3, 5, 10];
  const VIDEO_SECONDS = [5, 10];
  const SMALLEST_POOL = 8;
  const BOARD_ROWS = 10;
  const LIVES = 5;
  const RATED_SECONDS = 20;
  const THEME_SECONDS = 30;
  const DUEL_PAUSE_MS = 4500;
  const DUEL_GAP = 5;
  const ROOM_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I to misread
  // IMDb votes a title needs at each setting: Hits, Popular, Everything.
  const DEPTHS = { movies: [100000, 25000, 4000], games: [2000, 500, 100] };
  const BOARD_KEYS = ["movies.highest", "movies.lowest", "games.highest", "games.lowest",
    "themes.game", "themes.movie", "themes.sound", "clips.movie", "clips.game", "duel"];
  const THEME_NAMES = { game: "Game themes", movie: "Movie themes", sound: "Sound effects" };

  const $ = (id) => document.getElementById(id);
  const board = $("board");
  const ask = $("ask");
  const notice = $("notice");
  const retry = $("retry");
  const result = $("result");
  const verdict = $("verdict");
  const store = $("store");
  const share = $("share");
  const next = $("next");
  const leaveMatch = $("leaveMatch");
  const tally = $("tally");
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
  const depthSeg = $("depthSeg");
  const themeSeg = $("themeSeg");
  const timer = $("timer");
  const player = $("player");
  const playButton = $("play");
  const skipButton = $("skip");
  const volume = $("volume");
  const tabs = [...document.querySelectorAll("[data-mode]")];
  const targetButtons = [...document.querySelectorAll("[data-target]")];
  const depthButtons = [...document.querySelectorAll("[data-depth]")];
  const themeButtons = [...document.querySelectorAll("[data-theme]")];
  const clipSeg = $("clipSeg");
  const clipButtons = [...document.querySelectorAll("[data-clip]")];
  const topicButtons = [...document.querySelectorAll("[data-topic]")];
  const who = $("who");
  const nameDialog = $("nameDialog");
  const nameInput = $("nameInput");
  const lobby = $("lobby");

  const calmMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // One video element plays everything. For sound-only rounds it stays hidden.
  const audio = $("screen");
  audio.preload = "auto";

  // Sound effects join the theme clips once a data/sounds.js exists. Until then that option stays hidden.
  const sounds = [
    ...(Array.isArray(window.SG_THEMES) ? window.SG_THEMES : []),
    ...(Array.isArray(window.SG_SOUNDS) ? window.SG_SOUNDS.map((s) => ({ ...s, kind: "sound" })) : []),
  ];
  const trailers = Array.isArray(window.SG_CLIPS) ? window.SG_CLIPS : [];
  const lists = {
    movies: window.SG_MOVIES,
    games: window.SG_GAMES,
    "theme:game": sounds.filter((c) => c.kind === "game"),
    "theme:movie": sounds.filter((c) => c.kind === "movie"),
    "theme:sound": sounds.filter((c) => c.kind === "sound"),
    "clip:movie": trailers.filter((c) => c.kind === "movie"),
    "clip:game": trailers.filter((c) => c.kind === "game"),
  };
  const playable = (name) => Array.isArray(lists[name]) && lists[name].length >= SMALLEST_POOL;
  const themeKinds = ["game", "movie", "sound"].filter((k) => playable(`theme:${k}`));
  const clipKinds = ["movie", "game"].filter((k) => playable(`clip:${k}`));
  const roomInLink = new URLSearchParams(location.search).get("room");

  let mode = ["themes", "clips", "movies", "games", "duel"].includes(load("mode")) ? load("mode") : "themes";
  if (mode === "clips" && clipKinds.length === 0) mode = "themes";
  if (roomInLink) mode = "duel";
  let target = load("target") === "lowest" ? "lowest" : "highest";
  let depth = [0, 1, 2].includes(Number(load("depth") ?? 1)) ? Number(load("depth") ?? 1) : 1;
  let themeKind = themeKinds.includes(load("theme")) ? load("theme") : themeKinds[0] || "game";
  let clipKind = clipKinds.includes(load("clip")) ? load("clip") : clipKinds[0] || "movie";
  let range = { from: Number(load("from")) || 0, to: Number(load("to")) || 9999 };
  let stream = null; // the hls.js player behind a Steam trailer
  let clipFrom = 0; // seconds into the clip where play starts
  let clipAt = 0.3; // how far through a trailer the clip is cut, as a fraction
  let playerName = (load("name") || "").slice(0, 16);
  let stats = readJson("stats", { rounds: 0, right: 0 });
  let askedForName = false;
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

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(load(key));
      return value && typeof value === "object" ? value : fallback;
    } catch {
      return fallback;
    }
  }

  // What is on the table right now: a rated list ("movies", "games"), a sound list
  // ("theme:game", "theme:movie", "theme:sound") or a trailer list ("clip:movie", "clip:game").
  const topic = () => (mode === "duel" ? Duel.topic
    : mode === "themes" ? `theme:${themeKind}`
    : mode === "clips" ? `clip:${clipKind}`
    : mode);
  const rated = () => topic() === "movies" || topic() === "games";
  const isVideo = () => topic().startsWith("clip:");
  const listKind = () => topic();
  const boardKey = () => (mode === "duel" ? "duel" : rated() ? `${topic()}.${target}` : topic().replace(":", "s."));
  // A clip shows far more than a sound gives away, so it comes with six to choose from.
  const choices = () => (isVideo() ? 6 : 4);
  const clipSeconds = () => (isVideo() ? VIDEO_SECONDS : SOUND_SECONDS);

  function askText() {
    return {
      "theme:game": "Which game is this theme from?",
      "theme:movie": "Which movie is this theme from?",
      "theme:sound": "Which game is this sound from?",
      "clip:movie": "Which movie is this clip from?",
      "clip:game": "Which game is this clip from?",
    }[topic()] || `Which of these four is rated ${target}?`;
  }
  const fmt = (score) => score.toFixed(1);
  const seconds = (n) => (n === 1 ? "1 second" : `${n} seconds`);
  const firstWord = (title) => title.toLowerCase().replace(/^the\s+/, "").split(/[\s:]/)[0];
  const winnerLabel = () => (target === "lowest" ? "Lowest" : "Highest");
  const press = (buttons, key, value) =>
    buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset[key] === String(value))));

  function boardLabel(key) {
    if (key === "duel") return "1v1 · Win streak";
    const [what, which] = key.split(".");
    if (what === "themes") return THEME_NAMES[which];
    if (what === "clips") return which === "movie" ? "Movie clips" : "Game clips";
    return `${what[0].toUpperCase()}${what.slice(1)} · ${which[0].toUpperCase()}${which.slice(1)}`;
  }

  function setTally(el, value) {
    if (el.textContent === String(value)) return;
    el.textContent = value;
    el.classList.remove("bump");
    void el.offsetWidth; // restart the pop
    el.classList.add("bump");
  }

  // Lives are drawn as five pips, filled ones first.
  function setLives(el, left) {
    el.replaceChildren(...Array.from({ length: LIVES }, (_, i) => {
      const pip = document.createElement("span");
      pip.className = i < left ? "pip" : "pip spent";
      return pip;
    }));
    el.setAttribute("aria-label", `${left} of ${LIVES} lives`);
  }

  function countRound(right) {
    stats.rounds += 1;
    if (right) stats.right += 1;
    save("stats", JSON.stringify(stats));
    showStats();
  }

  function showStats() {
    $("statRounds").textContent = stats.rounds.toLocaleString("en");
    $("statRight").textContent = stats.rounds ? `${Math.round((stats.right / stats.rounds) * 100)}%` : "0%";
    $("statDuel").textContent = Number(load("duel.streak")) || 0;
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

  function drawClipRound() {
    refillUnseen();
    const at = Math.floor(Math.random() * unseen.length);
    answer = pool[unseen.splice(at, 1)[0]];
    clipAt = 0.2 + Math.random() * 0.4; // the middle of a trailer, clear of the title cards
    // Wrong answers come from other series, so "Halo" never sits next to "Halo 2".
    const others = pool.filter((g) => firstWord(g.title) !== firstWord(answer.title));
    const four = [answer];
    for (let guard = 0; four.length < choices() && guard < 2000; guard++) {
      const g = others[Math.floor(Math.random() * others.length)];
      if (!four.some((f) => firstWord(f.title) === firstWord(g.title))) four.push(g);
    }
    return four.sort(() => Math.random() - 0.5);
  }

  function buildPool() {
    const list = lists[listKind()];
    if (!rated()) return list;
    return showYears(list.filter((m) => m.votes >= DEPTHS[listKind()][depth]));
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

  // Loads the clip and parks it at the point play will start from.
  function loadClip(item) {
    return new Promise((resolve) => {
      const finish = (ok) => {
        audio.removeEventListener("loadedmetadata", place);
        audio.removeEventListener("seeked", ready);
        audio.removeEventListener("error", broken);
        clearTimeout(wait);
        resolve(ok);
      };
      const ready = () => finish(true);
      const broken = () => finish(false);
      const place = () => {
        const video = Boolean(item.hls) || isVideo();
        clipFrom = video
          ? Math.max(0, Math.min(audio.duration * clipAt, audio.duration - 15))
          : item.start || 0;
        audio.addEventListener("seeked", ready);
        audio.currentTime = clipFrom;
      };
      const wait = setTimeout(broken, CLIP_WAIT_MS);
      audio.addEventListener("loadedmetadata", place);
      audio.addEventListener("error", broken);
      if (stream) {
        stream.destroy();
        stream = null;
      }
      // Steam serves its trailers as HLS streams, which most browsers need hls.js to play.
      if (item.hls && window.Hls && window.Hls.isSupported()) {
        stream = new window.Hls({ maxBufferLength: 20 });
        stream.on(window.Hls.Events.ERROR, (_, data) => data.fatal && broken());
        stream.loadSource(item.hls);
        stream.attachMedia(audio);
      } else {
        audio.src = item.hls || item.preview;
        audio.load();
      }
    });
  }

  function stopClip() {
    clearTimeout(clipTimer);
    audio.pause();
    playButton.classList.remove("playing");
  }

  // Plays from where the clip was parked. A length of 0 runs to the end.
  function playClip(length) {
    if (!answer) return;
    stopClip();
    audio.currentTime = clipFrom;
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
    const lengths = clipSeconds();
    playButton.textContent = `Play ${seconds(lengths[stage])}`;
    $("stages").replaceChildren(...lengths.map((length, i) => {
      const dot = document.createElement("li");
      dot.textContent = `${length}s`;
      dot.className = i < stage ? "used" : i === stage ? "now" : "";
      return dot;
    }));
    const last = stage === lengths.length - 1;
    skipButton.hidden = last;
    if (!last) skipButton.textContent = `Skip to ${seconds(lengths[stage + 1])}`;
  }

  function longerClip() {
    if (player.hidden || skipButton.disabled || stage >= clipSeconds().length - 1) return;
    stage += 1;
    showStage();
    playClip(clipSeconds()[stage]);
  }

  function setVolume(level) {
    audio.volume = Math.min(1, Math.max(0, level));
    volume.value = Math.round(audio.volume * 100);
    save("volume", audio.volume);
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
    if (tickets.length !== items.length) {
      tickets = items.map((_, i) => buildTicket(i));
      board.replaceChildren(...tickets);
      board.classList.toggle("six", items.length > 4);
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
    counting.forEach(stopCounting); // a fast click on next can land mid count-up
    tickets.forEach((t) => {
      t.disabled = true;
      t.classList.add("dealing");
    });
    return ++dealNumber;
  }

  function readyClipControls(on) {
    playButton.disabled = !on;
    skipButton.disabled = !on;
    if (on) {
      stage = 0;
      showStage();
    }
  }

  async function deal() {
    result.hidden = true;
    stopClip();
    const thisDeal = hideTable();

    if (rated()) return layOut(drawRatedRound(soloGap()), true, thisDeal);

    readyClipControls(false);
    // A clip that will not load is swapped for another title, a few times over.
    let four;
    for (let attempt = 0; ; attempt++) {
      four = drawClipRound();
      const ready = await loadClip(answer);
      if (thisDeal !== dealNumber) return;
      if (ready) break;
      if (attempt === 3) return fail("The clips are not loading. Check your connection and try again.");
    }
    readyClipControls(true);
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
        ticket.querySelector(".sources").textContent = item.artist ? `${item.track}, ${item.artist}` : item.track || "";
      }
    });
    if (!scored) {
      store.hidden = !winner.link;
      if (winner.link) store.href = winner.link;
      store.textContent = winner.hls ? "The game on Steam" : isVideo() ? "The movie on Apple TV" : "Full track on Apple Music";
      playButton.disabled = true;
      skipButton.disabled = true;
      playClip(0); // the rest of the clip, as the payoff
    }
  }

  function pick(index) {
    if (!picking) return;
    if (mode === "duel") return Duel.pick(index);
    picking = false;

    const winner = rated() ? ranked(round)[0] : answer;
    const chosen = round[index];
    const right = chosen === winner;
    const marks = round.map((item, i) => [
      ...(item === winner ? [{ text: rated() ? winnerLabel() : "The answer", tone: "win" }] : []),
      ...(i === index ? [{ text: "Your pick", tone: right ? "good" : "bad" }] : []),
    ]);
    store.hidden = true;
    revealTable(winner, index, marks, rated());
    countRound(right);

    if (right) {
      streak += 1;
      if (streak > best) {
        best = streak;
        save(`best.${boardKey()}`, best);
      }
      // Saved after every right pick, so closing the tab mid-run loses nothing.
      save(`run.${boardKey()}`, streak);
      if (playerName) Ranks.submit(boardKey(), playerName, streak);
    } else {
      save(`run.${boardKey()}`, 0);
    }
    if (rated()) {
      const word = target === "lowest" ? "is lowest on" : "leads on";
      verdict.textContent = right
        ? `Right. ${winner.title} ${word} ${fmt(winner.score)}.`
        : `Streak over at ${streak}. ${winner.title} had ${fmt(winner.score)}, ` +
          `${chosen.title} had ${fmt(chosen.score)}.`;
    } else {
      verdict.textContent = right
        ? `Right. ${winner.title}, from ${seconds(clipSeconds()[stage])}.`
        : `Streak over at ${streak}. That was ${winner.title}.`;
    }
    next.textContent = right ? "Next round" : "Play again";
    next.hidden = false;
    leaveMatch.hidden = true;
    share.hidden = right || streak === 0;
    lost = !right;
    verdict.className = right ? "verdict is-right" : "verdict is-wrong";
    setTally(streakEl, streak);
    setTally(bestEl, best);
    if (lost && streak > 0 && !playerName && !askedForName) {
      askedForName = true;
      askName();
    }

    result.hidden = false;
    next.focus({ preventScroll: true });
  }

  function advance() {
    if (mode === "duel") return Duel.rematch();
    if (lost) {
      lost = false;
      streak = 0;
      setTally(streakEl, 0);
    }
    deal();
  }

  /* ---------- leaderboard ---------- */

  const Ranks = {
    shared: Boolean(CONFIG.binUrl || (CONFIG.supabaseUrl && CONFIG.supabaseKey)),
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
      const rows = readJson(`ranks.${key}`, []);
      return Array.isArray(rows) ? rows : [];
    },

    // Each name keeps its best only. Returns true when this score is a new best for the name.
    keepOnDevice(key, name, score) {
      const before = this.onDevice(key);
      const old = before.find((r) => r.name === name);
      if (old && old.score >= score) return false;
      const rows = before.filter((r) => r.name !== name);
      rows.push({ name, score });
      rows.sort((a, b) => b.score - a.score);
      save(`ranks.${key}`, JSON.stringify(rows.slice(0, 50)));
      return true;
    },

    // The shared store is one small JSON document: { boards: { key: [{ name, score }] } }.
    // Anyone can write to it, so everything read back is checked before it is shown or merged.
    clean(doc) {
      const boards = {};
      for (const key of BOARD_KEYS) {
        const rows = doc && doc.boards && Array.isArray(doc.boards[key]) ? doc.boards[key] : [];
        boards[key] = rows.filter((r) => r && typeof r.name === "string" && r.name.length >= 1 &&
          r.name.length <= 16 && Number.isInteger(r.score) && r.score >= 1 && r.score <= 9999)
          .map((r) => ({ name: r.name, score: r.score }));
      }
      return boards;
    },

    async readStore() {
      const res = await fetch(CONFIG.binUrl, { cache: "no-store" });
      if (!res.ok) throw new Error(`leaderboard ${res.status}`);
      const text = await res.text();
      const junk = text.search(/<!doctype/i); // the host tacks a web page onto its replies
      return this.clean(JSON.parse(junk === -1 ? text : text.slice(0, junk)));
    },

    // Best per name, highest first.
    merge(...lists) {
      const bests = new Map();
      for (const row of lists.flat()) {
        if ((bests.get(row.name) || 0) < row.score) bests.set(row.name, row.score);
      }
      return [...bests].map(([name, score]) => ({ name, score })).sort((a, b) => b.score - a.score);
    },

    // Writes go one at a time: read the latest, fold this device's bests in, write it back.
    // Folding in every board each time also repairs a write another player's write overtook.
    flush() {
      this.writing = (this.writing || Promise.resolve()).then(async () => {
        const boards = await this.readStore();
        for (const key of BOARD_KEYS) boards[key] = this.merge(boards[key], this.onDevice(key)).slice(0, 100);
        await fetch(CONFIG.binUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ v: 1, boards }),
          keepalive: true, // still sent if the tab is closing
        });
      }).catch(() => {});
      return this.writing;
    },

    async top(key) {
      if (CONFIG.binUrl) {
        return this.merge((await this.readStore())[key], this.onDevice(key)).slice(0, BOARD_ROWS);
      }
      if (!this.shared) return this.onDevice(key).slice(0, BOARD_ROWS);
      const url = `${CONFIG.supabaseUrl}/rest/v1/scores?select=name,score` +
        `&board=eq.${encodeURIComponent(key)}&order=score.desc,updated_at.asc&limit=${BOARD_ROWS}`;
      const res = await fetch(url, { headers: this.headers() });
      if (!res.ok) throw new Error(`leaderboard ${res.status}`);
      return res.json();
    },

    async submit(key, name, score) {
      if (!name || score < 1) return;
      const improved = this.keepOnDevice(key, name, score);
      if (improved && CONFIG.binUrl) {
        clearTimeout(this.flushSoon); // several bests at once go up in one write
        this.flushSoon = setTimeout(() => this.flush().then(() => this.show(this.showing)), 300);
      } else if (improved && this.shared) {
        // The database keeps whichever is higher, so an off day never lowers a best.
        await fetch(`${CONFIG.supabaseUrl}/rest/v1/rpc/submit_score`, {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify({ p_board: key, p_name: name, p_score: score }),
          keepalive: true, // still sent if the tab is closing
        }).catch(() => {});
      }
      if (improved && this.showing === key) this.show(key);
    },

    // A name set after playing claims every best already earned on this device.
    claimBests(name) {
      for (const key of BOARD_KEYS) {
        this.submit(key, name, Number(load(key === "duel" ? "duel.best" : `best.${key}`)) || 0);
      }
    },

    async show(key) {
      this.showing = key;
      const mine = ++this.request;
      const list = $("ranks");
      const note = $("ranksNote");
      $("boardPick").value = key;
      $("ranksScope").textContent = this.shared
        ? "Bests from everyone who has played. Saved as you play."
        : "Bests on this device. Saved as you play.";
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
      note.textContent = key === "duel"
        ? "No scores yet. Win a 1v1 match to get on the board."
        : "No scores yet. Get one right to get on the board.";
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
    const all = lists[listKind()].map((m) => m.year);
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
    const floor = DEPTHS[listKind()][depth];
    const count = lists[listKind()].filter((m) => m.votes >= floor && m.year >= from && m.year <= to).length;
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

  function lockControls(locked) {
    for (const el of [...targetButtons, ...depthButtons, ...themeButtons, ...clipButtons, yearFrom, yearTo]) {
      el.disabled = locked;
    }
  }

  // Shows the controls that mean something for what is being played.
  function showControls() {
    const clip = !rated();
    themeSeg.hidden = mode !== "themes" || themeKinds.length < 2;
    clipSeg.hidden = mode !== "clips" || clipKinds.length < 2;
    audio.hidden = !isVideo();
    press(clipButtons, "clip", clipKind);
    targetSeg.hidden = clip;
    depthSeg.hidden = clip;
    years.hidden = clip;
    press(targetButtons, "target", target);
    press(depthButtons, "depth", depth);
    press(themeButtons, "theme", themeKind);
  }

  /* ---------- 1v1 ---------- */

  const Duel = {
    topic: load("duelTopic") || "theme:game",
    state: "idle", // idle | waiting | joining | playing
    peer: null,
    conn: null,
    host: false,
    code: "",
    theirName: "Your friend",
    mine: LIVES,
    theirs: LIVES,
    n: 0,
    open: false,
    myPick: null,
    theirPick: null,
    roundTimer: 0,
    nextTimer: 0,
    over: false,
    usedLink: false,

    show(title, text, parts) {
      lobby.hidden = false;
      ask.hidden = true;
      timer.hidden = true;
      result.hidden = true;
      player.hidden = true;
      stopClip();
      clearBoard();
      $("lobbyTitle").textContent = title;
      $("lobbyText").textContent = text;
      $("topicSeg").hidden = !parts.setup;
      $("createRoom").hidden = !parts.setup;
      $("invite").hidden = !parts.invite;
      $("leaveRoom").hidden = !parts.leave;
      $("leaveRoom").textContent = parts.leave || "";
      tally.hidden = true;
      lockControls(false);
      if (parts.setup) {
        press(topicButtons, "topic", this.topic);
        showControls();
        if (rated()) buildPool();
      } else {
        targetSeg.hidden = true;
        depthSeg.hidden = true;
        years.hidden = true;
      }
      themeSeg.hidden = true;
      clipSeg.hidden = true;
      audio.hidden = true;
    },

    setup(problem) {
      this.state = "idle";
      const streakNow = Number(load("duel.streak")) || 0;
      this.show(
        problem ? "Match ended" : "Play a friend",
        problem || `Pick a topic and send the link. You both get the same choices and ${LIVES} lives. ` +
          `A wrong pick costs a life, and the last one standing wins.` +
          (streakNow ? ` Your win streak is ${streakNow}.` : ""),
        { setup: true }
      );
      Ranks.show("duel");
    },

    enter() {
      if (!Array.isArray(lists.movies) || !Array.isArray(lists.games)) {
        return fail("The movie and game lists did not load. Check your connection and try again.");
      }
      if (!playable(this.topic)) this.topic = "movies";
      if (this.state !== "idle") return;
      if (roomInLink && !this.usedLink) {
        this.usedLink = true;
        return this.join(roomInLink.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8));
      }
      this.setup();
    },

    create() {
      if (!window.Peer) return this.setup("1v1 could not load its connection service. Refresh the page and try again.");
      if (buildPool().length < SMALLEST_POOL) {
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
      conn.on("close", () => {
        // Walking out of a live match hands the win to whoever stayed.
        const forfeit = this.state === "playing" && !this.over;
        if (forfeit) this.won();
        this.fall(forfeit
          ? `${this.theirName} left, so the match is yours. Win streak ${Number(load("duel.streak")) || 0}.`
          : `${this.theirName} left.`);
      });
    },

    send(message) {
      if (this.conn && this.conn.open) this.conn.send(message);
    },

    receive(m) {
      if (!m || typeof m !== "object") return;
      if (m.t === "hello" && this.host) {
        this.theirName = String(m.name || "Your friend").slice(0, 16);
        this.send({ t: "hello", name: playerName, topic: this.topic, target, depth,
          from: Number(yearFrom.value), to: Number(yearTo.value) });
        this.begin();
      } else if (m.t === "hello") {
        // The host's choices apply for this match only; nothing here is saved.
        this.theirName = String(m.name || "Your friend").slice(0, 16);
        this.topic = Object.keys(lists).includes(m.topic) ? m.topic : "movies";
        target = m.target === "lowest" ? "lowest" : "highest";
        depth = [0, 1, 2].includes(m.depth) ? m.depth : 1;
        range = { from: Number(m.from) || 0, to: Number(m.to) || 9999 };
        this.begin();
      } else if (m.t === "round" && !this.host) {
        const byId = new Map(lists[listKind()].map((item) => [item.id, item]));
        const items = (m.ids || []).map((id) => byId.get(id));
        if (items.length !== choices() || items.some((item) => !item)) {
          return this.fall("Your two copies of the game are out of step. Both refresh the page and try again.");
        }
        clipAt = Number(m.at) || 0.3;
        this.showRound(m.n, items, byId.get(m.answer));
      } else if (m.t === "pick" && this.host) {
        if (m.n !== this.n || !this.open || this.theirPick !== null) return;
        this.theirPick = Number.isInteger(m.index) && m.index >= 0 && m.index < round.length ? m.index : null;
        if (this.myPick !== null) this.settle();
      } else if (m.t === "reveal" && !this.host) {
        if (m.n !== this.n) return;
        this.mine = m.guestLives;
        this.theirs = m.hostLives;
        this.reveal(m.guest, m.host, m.over, m.spared);
      } else if (m.t === "rematch" && this.host) {
        if (this.over) this.again();
      } else if (m.t === "again" && !this.host) {
        this.begin();
      }
    },

    begin() {
      this.state = "playing";
      this.mine = LIVES;
      this.theirs = LIVES;
      this.n = 0;
      this.over = false;
      lobby.hidden = true;
      showControls();
      themeSeg.hidden = true;
      clipSeg.hidden = true;
      tally.hidden = false;
      pool = buildPool();
      unseen = [];
      lockControls(true);
      leftLabel.textContent = "You";
      rightLabel.textContent = this.theirName;
      setLives(streakEl, this.mine);
      setLives(bestEl, this.theirs);
      player.hidden = rated();
      readyClipControls(false);
      Ranks.show("duel"); // the joining player never saw the lobby, so the panel is still empty
      result.hidden = true;
      notice.hidden = false;
      notice.textContent = this.host ? "Dealing the first round." : `Waiting for ${this.theirName} to deal.`;
      if (this.host) this.nextRound();
    },

    nextRound() {
      const items = rated() ? drawRatedRound(DUEL_GAP) : drawClipRound();
      this.send({ t: "round", n: this.n + 1, ids: items.map((item) => item.id), answer: rated() ? null : answer.id, at: clipAt });
      this.showRound(this.n + 1, items, answer);
    },

    async showRound(n, items, clipAnswer) {
      this.n = n;
      this.open = false;
      this.myPick = null;
      this.theirPick = null;
      clearTimeout(this.roundTimer);
      stopClip();
      result.hidden = true;
      ask.hidden = false;
      ask.textContent = `Round ${n}. ${askText()}`;
      const thisDeal = hideTable();
      if (!rated()) {
        answer = clipAnswer;
        readyClipControls(false);
        await loadClip(answer);
        if (thisDeal !== dealNumber) return;
        readyClipControls(true);
      }
      const shown = await layOut(items, rated(), thisDeal);
      if (!shown) return;
      const allowed = rated() ? RATED_SECONDS : THEME_SECONDS;
      this.open = true;
      timer.hidden = false;
      timer.style.setProperty("--time", `${allowed}s`);
      timer.classList.remove("running");
      void timer.offsetWidth; // restart the countdown bar
      timer.classList.add("running");
      // The host calls time. A small allowance covers the other side still loading.
      if (this.host) this.roundTimer = setTimeout(() => this.settle(), (allowed + 2) * 1000);
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

    winner() {
      return rated() ? ranked(round)[0] : answer;
    },

    // Host only: both picks are in, or time is up.
    settle() {
      if (!this.open) return;
      clearTimeout(this.roundTimer);
      const winner = this.winner();
      if (round[this.myPick] !== winner) this.mine -= 1;
      if (round[this.theirPick] !== winner) this.theirs -= 1;
      // Both out on the same round is no way to end a match: both keep their last life.
      const spared = this.mine <= 0 && this.theirs <= 0;
      if (spared) {
        this.mine = 1;
        this.theirs = 1;
      }
      const over = this.mine <= 0 || this.theirs <= 0;
      this.send({ t: "reveal", n: this.n, host: this.myPick, guest: this.theirPick,
        hostLives: this.mine, guestLives: this.theirs, over, spared });
      this.reveal(this.myPick, this.theirPick, over, spared);
    },

    won() {
      const now = (Number(load("duel.streak")) || 0) + 1;
      save("duel.streak", now);
      if (now > (Number(load("duel.best")) || 0)) save("duel.best", now);
      if (playerName) Ranks.submit("duel", playerName, now);
      showStats();
      return now;
    },

    reveal(mine, theirs, over, spared) {
      this.open = false;
      this.over = over;
      timer.hidden = true;
      timer.classList.remove("running");
      notice.hidden = true;
      const winner = this.winner();
      const iScored = round[mine] === winner;
      const theyScored = round[theirs] === winner;
      const marks = round.map((item, i) => [
        ...(item === winner ? [{ text: rated() ? winnerLabel() : "The answer", tone: "win" }] : []),
        ...(i === mine ? [{ text: "You", tone: iScored ? "good" : "bad" }] : []),
        ...(i === theirs ? [{ text: this.theirName, tone: "them" }] : []),
      ]);
      store.hidden = true;
      revealTable(winner, mine, marks, rated());
      countRound(iScored);
      setLives(streakEl, this.mine);
      setLives(bestEl, this.theirs);

      let line = iScored && theyScored ? "You both got it."
        : iScored ? `You got it. ${this.theirName} loses a life.`
        : theyScored ? `${this.theirName} got it. You lose a life.`
        : "Nobody got it. You both lose a life.";
      if (spared) line = "Nobody got it on your last lives, so you both keep one.";
      const iWon = over && this.mine > 0;
      if (over && iWon) line = `You win with ${this.mine} ${this.mine === 1 ? "life" : "lives"} left. Win streak ${this.won()}.`;
      if (over && !iWon) {
        save("duel.streak", 0);
        showStats();
        line = `${this.theirName} wins. Your win streak is back to 0.`;
      }
      verdict.textContent = line;
      verdict.className = (over ? iWon : iScored) ? "verdict is-right" : "verdict is-wrong";
      share.hidden = true;
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

    // The match or room ended. Puts this player's own settings back and returns to the lobby.
    fall(reason) {
      if (this.state === "idle") return;
      this.close();
      stopClip();
      this.topic = load("duelTopic") || "theme:game";
      target = load("target") === "lowest" ? "lowest" : "highest";
      depth = [0, 1, 2].includes(Number(load("depth") ?? 1)) ? Number(load("depth") ?? 1) : 1;
      range = { from: Number(load("from")) || 0, to: Number(load("to")) || 9999 };
      leftLabel.textContent = "Streak";
      rightLabel.textContent = "Best";
      if (mode === "duel") this.setup(reason);
    },

    leave() {
      if (this.state === "playing" && !this.over) {
        save("duel.streak", 0); // walking out counts as a loss
        showStats();
      }
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

  // Slides the filled pill under the active tab.
  function moveGlider() {
    const active = tabs.find((b) => b.dataset.mode === mode);
    $("glider").style.width = `${active.offsetWidth}px`;
    $("glider").style.transform = `translateX(${active.offsetLeft}px)`;
  }

  function start() {
    press(tabs, "mode", mode);
    moveGlider();
    clearBoard();
    stopClip();
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

    const list = lists[listKind()];
    showControls();
    tally.hidden = false;
    lockControls(false);
    leftLabel.textContent = "Streak";
    rightLabel.textContent = "Best";
    best = Number(load(`best.${boardKey()}`)) || 0;
    streak = Number(load(`run.${boardKey()}`)) || 0; // a run left unfinished carries on
    streakEl.textContent = streak;
    bestEl.textContent = best;
    Ranks.show(boardKey());

    if (!Array.isArray(list) || list.length < 4) {
      return fail(`The ${mode} list did not load. Check your connection and try again.`);
    }
    pool = buildPool();
    if (pool.length < Math.max(SMALLEST_POOL, choices() + 2)) {
      notice.hidden = false;
      notice.textContent = `Only ${pool.length} ${mode} in those years. Widen the range to play.`;
      return;
    }
    player.hidden = rated();
    ask.hidden = false;
    ask.textContent = askText();
    notice.hidden = false;
    notice.textContent = rated() ? "Dealing the next four." : "Loading the clip.";
    deal();
  }

  // Changing a setting in the 1v1 lobby only updates the lobby. Everywhere else it restarts the run.
  function settingChanged() {
    if (mode !== "duel") return start();
    if (Duel.state === "idle") Duel.setup();
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
    settingChanged();
  }));
  depthButtons.forEach((b) => b.addEventListener("click", () => {
    if (Number(b.dataset.depth) === depth) return;
    depth = Number(b.dataset.depth);
    save("depth", depth);
    settingChanged();
  }));
  themeButtons.forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.theme === themeKind) return;
    themeKind = b.dataset.theme;
    save("theme", themeKind);
    start();
  }));
  clipButtons.forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.clip === clipKind) return;
    clipKind = b.dataset.clip;
    save("clip", clipKind);
    start();
  }));
  topicButtons.forEach((b) => b.addEventListener("click", () => {
    Duel.topic = b.dataset.topic;
    save("duelTopic", Duel.topic);
    Duel.setup();
  }));
  for (const input of [yearFrom, yearTo]) {
    input.addEventListener("input", onYearInput);
    input.addEventListener("change", () => {
      range = { from: Number(yearFrom.value), to: Number(yearTo.value) };
      save("from", range.from);
      save("to", range.to);
      if (mode !== "duel") start();
    });
  }
  playButton.addEventListener("click", () => playClip(clipSeconds()[stage]));
  skipButton.addEventListener("click", longerClip);
  volume.addEventListener("input", () => setVolume(Number(volume.value) / 100));
  $("createRoom").addEventListener("click", () => Duel.create());
  $("leaveRoom").addEventListener("click", () => Duel.leave());

  async function copy(text, button, restore) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return false; // clipboard blocked
    }
    button.textContent = "Copied";
    setTimeout(() => (button.textContent = restore), 1500);
    return true;
  }

  $("copyLink").addEventListener("click", async () => {
    const link = $("inviteLink");
    if (!(await copy(link.value, $("copyLink"), "Copy link"))) link.select(); // left selected for a manual copy
  });
  share.addEventListener("click", () => copy(
    `ScoreGame, ${boardLabel(boardKey())}: a streak of ${streak}. ${location.origin}${location.pathname}`,
    share, "Copy result"));
  $("ranksRetry").addEventListener("click", () => Ranks.show(Ranks.showing));
  // Any leaderboard can be looked at from any mode. Changing mode brings its own board back.
  $("boardPick").addEventListener("change", () => Ranks.show($("boardPick").value));
  // The tab bar changes size when the window does and when the web font arrives.
  new ResizeObserver(moveGlider).observe(document.querySelector(".tabs"));

  who.addEventListener("click", askName);
  $("help").addEventListener("click", () => $("helpDialog").showModal());
  $("nameCancel").addEventListener("click", () => nameDialog.close());
  $("nameForm").addEventListener("submit", () => {
    playerName = nameInput.value.trim().slice(0, 16);
    save("name", playerName);
    showName();
    Ranks.claimBests(playerName);
    Ranks.show(Ranks.showing);
  });

  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (nameDialog.open || $("helpDialog").open || event.target instanceof HTMLInputElement) return;
    const key = event.key.toLowerCase();
    // Cards, left to right: 1 to 9, then 0 for the tenth.
    if (/^[0-9]$/.test(key)) {
      const index = key === "0" ? 9 : Number(key) - 1;
      if (index < tickets.length) pick(index);
      return;
    }
    if (player.hidden) return;
    if (key === "s") return longerClip();
    if (key === "m") return setVolume(audio.volume > 0 ? 0 : Number(load("loud")) || 0.8);
    // Space on a focused button already presses it; only take it over when nothing is focused.
    if (key === " " && !(event.target instanceof HTMLButtonElement) && !playButton.disabled) {
      event.preventDefault();
      playClip(clipSeconds()[stage]);
    }
  });
  volume.addEventListener("change", () => {
    if (audio.volume > 0) save("loud", audio.volume); // what M un-mutes back to
  });

  themeButtons.forEach((b) => (b.hidden = !themeKinds.includes(b.dataset.theme)));
  clipButtons.forEach((b) => (b.hidden = !clipKinds.includes(b.dataset.clip)));
  topicButtons.forEach((b) => (b.hidden = !playable(b.dataset.topic)));
  tabs.find((b) => b.dataset.mode === "clips").hidden = clipKinds.length === 0;
  $("boardPick").replaceChildren(...BOARD_KEYS
    // Sound and clip boards are listed only when that list has something to play.
    .filter((key) => !/^(themes|clips)\./.test(key) || playable(key.replace("s.", ":")))
    .map((key) => {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = boardLabel(key);
      return option;
    }));
  setVolume(load("volume") === null ? 0.8 : Number(load("volume")));
  showName();
  showStats();
  start();
})();
