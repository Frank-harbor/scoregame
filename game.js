(() => {
  "use strict";

  const STORE = "scoregame.";
  const COUNT_UP_MS = 700;
  const POSTER_WAIT_MS = 4000;
  const CLIP_WAIT_MS = 8000;
  const CLIP_SECONDS = [0.5, 1, 3, 5, 10];
  const SMALLEST_POOL = 8;

  const $ = (id) => document.getElementById(id);
  const board = $("board");
  const ask = $("ask");
  const notice = $("notice");
  const retry = $("retry");
  const result = $("result");
  const verdict = $("verdict");
  const store = $("store");
  const next = $("next");
  const streakEl = $("streak");
  const bestEl = $("best");
  const years = $("years");
  const yearFrom = $("yearFrom");
  const yearTo = $("yearTo");
  const yearsText = $("yearsText");
  const yearsCount = $("yearsCount");
  const rangeFill = $("rangeFill");
  const player = $("player");
  const playButton = $("play");
  const skipButton = $("skip");
  const stageDots = [...$("stages").children];
  const modeButtons = [...document.querySelectorAll("[data-mode]")];
  const targetButtons = [...document.querySelectorAll("[data-target]")];

  const calmMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const audio = new Audio();
  audio.preload = "auto";

  const lists = {
    movies: window.TOP_BILLING_MOVIES,
    games: window.TOP_BILLING_GAMES,
    themes: themeList(),
  };

  let mode = ["movies", "games", "themes"].includes(load("mode")) ? load("mode") : "movies";
  let target = load("target") === "lowest" ? "lowest" : "highest";
  let range = { from: Number(load("from")) || 0, to: Number(load("to")) || 9999 };
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

  // A theme round needs the game's box art and title, so only games in the main list count.
  function themeList() {
    const games = window.TOP_BILLING_GAMES;
    const sounds = window.TOP_BILLING_SOUNDS;
    if (!Array.isArray(games) || !Array.isArray(sounds)) return undefined;
    const byId = new Map(games.map((g) => [g.id, g]));
    return sounds.filter((s) => byId.has(s.id)).map((s) => ({ ...byId.get(s.id), sound: s }));
  }

  const rated = () => mode !== "themes";
  const bestKey = () => (rated() ? `best.${mode}.${target}` : "best.themes");
  const fmt = (score) => score.toFixed(1);
  const seconds = (n) => (n === 1 ? "1 second" : `${n} seconds`);
  const firstWord = (title) => title.toLowerCase().replace(/^the\s+/, "").split(/[\s:]/)[0];

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
  function minGap() {
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

  function drawRatedRound() {
    refillUnseen();
    let gap = minGap();
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

  /* ---------- loading pictures and clips ---------- */

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
        clearTimeout(timer);
        resolve(ok);
      };
      const yes = () => finish(true);
      const no = () => finish(false);
      const timer = setTimeout(no, CLIP_WAIT_MS);
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

  /* ---------- the four tickets ---------- */

  function buildTicket(index) {
    const ticket = document.createElement("button");
    ticket.type = "button";
    ticket.className = "ticket dealing";
    ticket.innerHTML = `
      <div class="poster"><img alt=""><span class="fallback"></span></div>
      <div class="stub">
        <h2 class="title"></h2>
        <p class="year"></p>
        <div class="tear"></div>
        <p class="mark"></p>
        <p class="score">?</p>
        <p class="sources"></p>
      </div>`;
    const img = ticket.querySelector("img");
    img.addEventListener("error", () => img.parentElement.classList.add("missing"));
    ticket.addEventListener("click", () => pick(index));
    return ticket;
  }

  function fillTicket(ticket, item) {
    ticket.querySelector(".poster").classList.remove("missing");
    ticket.querySelector("img").src = item.poster;
    ticket.querySelector(".fallback").textContent = item.title;
    ticket.querySelector(".title").textContent = item.title;
    ticket.querySelector(".year").textContent = item.year;
    ticket.querySelector(".mark").textContent = "";
    ticket.querySelector(".score").textContent = "?";
    ticket.querySelector(".sources").textContent = "";
    ticket.setAttribute("aria-label", `${item.title}, ${item.year}`);
    ticket.className = rated() ? "ticket dealing" : "ticket dealing no-score";
    ticket.disabled = false;
  }

  async function deal() {
    picking = false;
    result.hidden = true;
    store.hidden = true;
    stopClip();
    // A fast click on "Next four" can land while the last scores are still counting up.
    counting.forEach(stopCounting);
    const thisDeal = ++dealNumber;
    tickets.forEach((t) => {
      t.disabled = true;
      t.classList.add("dealing");
    });

    let four;
    if (rated()) {
      four = drawRatedRound();
      await Promise.all(four.map((m) => preload(m.poster)));
    } else {
      playButton.disabled = true;
      skipButton.disabled = true;
      // A clip that will not load is swapped for another game, a few times over.
      for (let attempt = 0; ; attempt++) {
        four = drawThemeRound();
        const [ready] = await Promise.all([loadClip(answer.sound.preview), ...four.map((m) => preload(m.poster))]);
        if (thisDeal !== dealNumber) return;
        if (ready) break;
        if (attempt === 3) return fail("The theme clips are not loading. Check your connection and try again.");
      }
      stage = 0;
      showStage();
      playButton.disabled = false;
      skipButton.disabled = false;
    }
    if (thisDeal !== dealNumber) return;
    round = four;

    if (tickets.length === 0) {
      tickets = [0, 1, 2, 3].map(buildTicket);
      board.append(...tickets);
    }
    notice.hidden = true;
    tickets.forEach((t, i) => fillTicket(t, round[i]));
    // A short wait so the browser paints the hidden state before sliding the tickets in.
    setTimeout(() => {
      if (thisDeal !== dealNumber) return;
      tickets.forEach((t) => t.classList.remove("dealing"));
      picking = true;
    }, 40);
  }

  /* ---------- the reveal ---------- */

  function countUp(el, to) {
    if (calmMotion) {
      el.textContent = fmt(to);
      return;
    }
    const start = performance.now();
    const timer = setInterval(() => {
      const t = Math.min(1, (performance.now() - start) / COUNT_UP_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = fmt(t === 1 ? to : Math.floor(to * eased * 2) / 2);
      if (t === 1) stopCounting(timer);
    }, 16);
    counting.add(timer);
  }

  function stopCounting(timer) {
    clearInterval(timer);
    counting.delete(timer);
  }

  function pick(index) {
    if (!picking) return;
    picking = false;

    const winner = rated() ? ranked(round)[0] : answer;
    const chosen = round[index];
    const right = chosen === winner;
    const winnerMark = !rated() ? "The answer" : target === "lowest" ? "Lowest score" : "Top score";

    tickets.forEach((ticket, i) => {
      const item = round[i];
      ticket.disabled = true;
      ticket.classList.add("revealed");
      if (item === winner) ticket.classList.add("top-score");
      if (i === index) ticket.classList.add("picked");
      ticket.querySelector(".mark").textContent =
        item === winner ? winnerMark : i === index ? "Your pick" : "";
      if (rated()) {
        ticket.querySelector(".sources").textContent =
          `IMDb ${item.imdb.toFixed(1)} · Metacritic ${item.mc}`;
        ticket.setAttribute("aria-label", `${item.title}, ${item.year}, score ${fmt(item.score)}`);
        countUp(ticket.querySelector(".score"), item.score);
      } else if (item === winner) {
        ticket.querySelector(".sources").textContent = `${item.sound.track}, ${item.sound.artist}`;
      }
    });

    if (right) {
      streak += 1;
      if (streak > best) {
        best = streak;
        save(bestKey(), best);
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
      store.href = winner.sound.link;
      store.hidden = false;
      playButton.disabled = true;
      skipButton.disabled = true;
      playClip(0); // the full preview, as the payoff
    }
    next.textContent = right ? "Next four" : "Play again";
    lost = !right;
    verdict.className = right ? "verdict is-right" : "verdict is-wrong";
    setTally(streakEl, streak);
    setTally(bestEl, best);

    result.hidden = false;
    next.focus({ preventScroll: true });
  }

  function advance() {
    if (lost) {
      lost = false;
      streak = 0;
      setTally(streakEl, 0);
    }
    deal();
  }

  /* ---------- modes, years, start ---------- */

  function fail(message) {
    dealNumber += 1;
    stopClip();
    board.replaceChildren();
    tickets = [];
    result.hidden = true;
    player.hidden = true;
    ask.hidden = true;
    notice.hidden = false;
    notice.textContent = message;
    retry.hidden = false;
  }

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
    yearsText.textContent = from === to ? String(from) : `${from} to ${to}`;
    rangeFill.style.left = `${((from - lo) / span) * 100}%`;
    rangeFill.style.right = `${100 - ((to - lo) / span) * 100}%`;
    const count = lists[mode].filter((m) => m.year >= from && m.year <= to).length;
    yearsCount.textContent = `${count.toLocaleString("en")} ${mode}`;
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

  function start() {
    modeButtons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
    targetButtons.forEach((b) => {
      b.setAttribute("aria-pressed", String(rated() && b.dataset.target === target));
      b.disabled = !rated(); // highest and lowest mean nothing in a theme round
    });
    dealNumber += 1; // drop any deal still loading for the previous setting
    counting.forEach(stopCounting);
    stopClip();
    streak = 0;
    lost = false;
    unseen = [];
    best = Number(load(bestKey())) || 0;
    streakEl.textContent = streak;
    bestEl.textContent = best;
    result.hidden = true;
    retry.hidden = true;
    board.replaceChildren();
    tickets = [];

    const list = lists[mode];
    years.hidden = !rated() || !Array.isArray(list);
    player.hidden = rated();
    if (!Array.isArray(list) || list.length < 4) {
      return fail(`The ${mode} list did not load. Check your connection and try again.`);
    }
    pool = rated() ? showYears(list) : list;
    ask.hidden = false;
    ask.textContent = rated()
      ? `Which of these four is rated ${target}?`
      : "Which game is this theme from?";
    notice.hidden = false;
    if (pool.length < SMALLEST_POOL) {
      player.hidden = true;
      ask.hidden = true;
      notice.textContent = `Only ${pool.length} ${mode} in those years. Widen the range to play.`;
      return;
    }
    notice.textContent = rated() ? "Dealing the next four." : "Loading the clip.";
    deal();
  }

  next.addEventListener("click", advance);
  retry.addEventListener("click", () => location.reload());
  modeButtons.forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.mode === mode) return;
    mode = b.dataset.mode;
    save("mode", mode);
    start();
  }));
  targetButtons.forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.target === target) return;
    target = b.dataset.target;
    save("target", target);
    start();
  }));
  for (const input of [yearFrom, yearTo]) {
    input.addEventListener("input", onYearInput);
    input.addEventListener("change", onYearChange);
  }
  playButton.addEventListener("click", () => playClip(CLIP_SECONDS[stage]));
  skipButton.addEventListener("click", () => {
    if (stage >= CLIP_SECONDS.length - 1) return;
    stage += 1;
    showStage();
    playClip(CLIP_SECONDS[stage]);
  });

  // 1 to 4 pick a ticket, left to right.
  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof HTMLInputElement) return;
    const n = Number(event.key);
    if (n >= 1 && n <= 4) pick(n - 1);
  });

  start();
})();
