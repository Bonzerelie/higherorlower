/* /script.js
   Higher Or Lower?! (two-note comparison)
   - audio/{stem}{octave}.mp3
   - Squarespace iframe sizing + scroll forwarding preserved
*/
(() => {
  "use strict";

  const AUDIO_DIR = "audio";

  const NOTE_PLAY_SEC = 1.2;
  const FADE_OUT_SEC = 0.1;
  const GAP_SEC = 0.01;

  const LIMITER_THRESHOLD_DB = -6;

  const FIRST_COLOR = "#4da3ff";
  const SECOND_COLOR = "#34c759";

  const PC_TO_STEM = {
    0: "c",
    1: "csharp",
    2: "d",
    3: "dsharp",
    4: "e",
    5: "f",
    6: "fsharp",
    7: "g",
    8: "gsharp",
    9: "a",
    10: "asharp",
    11: "b",
  };

  const PC_NAMES_SHARP = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  const PC_NAMES_FLAT  = ["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"];

  const RANGES = {
    "easy-1oct":   { label: "Easy (1 octave)",   startOctave: 4, octaves: 1, endOnFinalC: true },
    "med-2oct":    { label: "Medium (2 octaves)",startOctave: 3, octaves: 2, endOnFinalC: true },
    "hard-3oct":   { label: "Hard (3 octaves)",  startOctave: 3, octaves: 3, endOnFinalC: true },
    "expert-4oct": { label: "Expert (4 octaves)",startOctave: 2, octaves: 4, endOnFinalC: true },
  };

  const $ = (id) => document.getElementById(id);

  const beginBtn = $("beginBtn");
  const replayBtn = $("replayBtn");
  const higherBtn = $("higherBtn");
  const sameBtn = $("sameBtn");
  const lowerBtn = $("lowerBtn");
  const nextBtn = $("nextBtn");
  const downloadScoreBtn = $("downloadScoreBtn");
  const noteRangeSel = $("noteRange");
  const feedbackOut = $("feedbackOut");
  const scoreOut = $("scoreOut");
  const miniMount = $("miniMount");

  const streakModal = $("streakModal");
  const modalTitle = $("modalTitle");
  const modalBody = $("modalBody");
  const modalClose = $("modalClose");
  const modalDownload = $("modalDownload");

  if (!beginBtn || !replayBtn || !higherBtn || !sameBtn || !lowerBtn || !nextBtn || !downloadScoreBtn || !noteRangeSel || !feedbackOut || !scoreOut || !miniMount) {
    const msg = "UI mismatch: required elements missing. Ensure index.html matches script.js ids.";
    if (feedbackOut) feedbackOut.textContent = msg;
    else alert(msg);
    return;
  }

  // ---------------- iframe sizing ----------------
  let lastHeight = 0;
  const ro = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const height = Math.ceil(entry.contentRect.height);
      if (height !== lastHeight) {
        parent.postMessage({ iframeHeight: height }, "*");
        lastHeight = height;
      }
    }
  });
  ro.observe(document.documentElement);

  function postHeightNow() {
    try {
      const h = Math.max(
        document.documentElement.scrollHeight,
        document.body ? document.body.scrollHeight : 0
      );
      parent.postMessage({ iframeHeight: h }, "*");
    } catch {}
  }

  window.addEventListener("load", () => {
    postHeightNow();
    setTimeout(postHeightNow, 250);
    setTimeout(postHeightNow, 1000);
  });

  window.addEventListener("orientationchange", () => {
    setTimeout(postHeightNow, 100);
    setTimeout(postHeightNow, 500);
  });

  function enableScrollForwardingToParent() {
    const SCROLL_GAIN = 6.0;

    const isVerticallyScrollable = () =>
      document.documentElement.scrollHeight > window.innerHeight + 2;

    const isInteractiveTarget = (t) =>
      t instanceof Element && !!t.closest("button, a, input, select, textarea, label");

    let startX = 0;
    let startY = 0;
    let lastY = 0;
    let lockedMode = null;

    let lastMoveTs = 0;
    let vScrollTop = 0;

    window.addEventListener("touchstart", (e) => {
      if (!e.touches || e.touches.length !== 1) return;
      const t = e.target;

      lockedMode = null;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      lastY = startY;

      lastMoveTs = e.timeStamp || performance.now();
      vScrollTop = 0;

      if (isInteractiveTarget(t)) lockedMode = "x";
    }, { passive: true });

    window.addEventListener("touchmove", (e) => {
      if (!e.touches || e.touches.length !== 1) return;
      if (isVerticallyScrollable()) return;

      const x = e.touches[0].clientX;
      const y = e.touches[0].clientY;

      const dx = x - startX;
      const dy = y - startY;

      if (!lockedMode) {
        if (Math.abs(dy) > Math.abs(dx) + 4) lockedMode = "y";
        else if (Math.abs(dx) > Math.abs(dy) + 4) lockedMode = "x";
        else return;
      }
      if (lockedMode !== "y") return;

      const nowTs = e.timeStamp || performance.now();
      const dt = Math.max(8, nowTs - lastMoveTs);
      lastMoveTs = nowTs;

      const fingerStep = (y - lastY) * SCROLL_GAIN;
      lastY = y;

      const scrollTopDelta = -fingerStep;
      const instV = scrollTopDelta / dt;
      vScrollTop = vScrollTop * 0.75 + instV * 0.25;

      e.preventDefault();
      parent.postMessage({ scrollTopDelta }, "*");
    }, { passive: false });

    function endGesture() {
      if (lockedMode === "y" && Math.abs(vScrollTop) > 0.05) {
        const capped = Math.max(-5.5, Math.min(5.5, vScrollTop));
        parent.postMessage({ scrollTopVelocity: capped }, "*");
      }
      lockedMode = null;
      vScrollTop = 0;
    }

    window.addEventListener("touchend", endGesture, { passive: true });
    window.addEventListener("touchcancel", endGesture, { passive: true });

    window.addEventListener("wheel", (e) => {
      if (isVerticallyScrollable()) return;
      parent.postMessage({ scrollTopDelta: e.deltaY }, "*");
    }, { passive: true });
  }
  enableScrollForwardingToParent();

  // ---------------- audio ----------------
  let audioCtx = null;
  let masterGain = null;
  let limiter = null;

  const bufferPromiseCache = new Map();
  const activeVoices = new Set();

  function ensureAudioGraph() {
    if (audioCtx) return audioCtx;

    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      alert("Your browser doesn’t support Web Audio (required for playback).");
      return null;
    }

    audioCtx = new Ctx();

    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.9;

    limiter = audioCtx.createDynamicsCompressor();
    limiter.threshold.value = LIMITER_THRESHOLD_DB;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.12;

    masterGain.connect(limiter);
    limiter.connect(audioCtx.destination);

    return audioCtx;
  }

  async function resumeAudioIfNeeded() {
    const ctx = ensureAudioGraph();
    if (!ctx) return;
    if (ctx.state === "suspended") {
      try { await ctx.resume(); } catch {}
    }
  }

  function stopAllNotes(fadeSec = 0.06) {
    const ctx = ensureAudioGraph();
    if (!ctx) return;

    const now = ctx.currentTime;
    const fade = Math.max(0.02, Number.isFinite(fadeSec) ? fadeSec : 0.06);

    for (const v of Array.from(activeVoices)) {
      try {
        v.gain.gain.cancelScheduledValues(now);
        v.gain.gain.setTargetAtTime(0, now, fade / 6);
        const stopAt = Math.max(now + fade, (v.startTime || now) + 0.001);
        v.src.stop(stopAt + 0.02);
      } catch {}
    }
  }

  function trackVoice(src, gain, startTime) {
    const voice = { src, gain, startTime };
    activeVoices.add(voice);
    src.onended = () => activeVoices.delete(voice);
    return voice;
  }

  function noteUrl(stem, octaveNum) {
    return `${AUDIO_DIR}/${stem}${octaveNum}.mp3`;
  }

  function loadBuffer(url) {
    if (bufferPromiseCache.has(url)) return bufferPromiseCache.get(url);

    const p = (async () => {
      const ctx = ensureAudioGraph();
      if (!ctx) return null;

      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const ab = await res.arrayBuffer();
        return await ctx.decodeAudioData(ab);
      } catch {
        return null;
      }
    })();

    bufferPromiseCache.set(url, p);
    return p;
  }

  function playBufferWindowed(buffer, whenSec, playSec, fadeOutSec, gain = 1) {
    const ctx = ensureAudioGraph();
    if (!ctx || !masterGain) return null;

    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const g = ctx.createGain();

    const safeGain = Math.max(0, Number.isFinite(gain) ? gain : 1);
    const fadeIn = 0.01;
    const endAt = whenSec + Math.max(0.05, playSec);

    g.gain.setValueAtTime(0, whenSec);
    g.gain.linearRampToValueAtTime(safeGain, whenSec + fadeIn);

    const fadeStart = Math.max(whenSec + 0.02, endAt - Math.max(0.06, fadeOutSec));
    g.gain.setValueAtTime(safeGain, fadeStart);
    g.gain.linearRampToValueAtTime(0, endAt);

    src.connect(g);
    g.connect(masterGain);

    trackVoice(src, g, whenSec);
    src.start(whenSec);
    src.stop(endAt + 0.03);

    return src;
  }

  function pitchFromPcOct(pc, oct) { return (oct * 12) + pc; }
  function pcFromPitch(p) { return ((p % 12) + 12) % 12; }
  function octFromPitch(p) { return Math.floor(p / 12); }
  function getStemForPc(pc) { return PC_TO_STEM[(pc + 12) % 12] || null; }

  function pitchLabel(pitch) {
    const pc = pcFromPitch(pitch);
    const oct = octFromPitch(pitch);
    const isAcc = [1, 3, 6, 8, 10].includes(pc);
    if (!isAcc) return `${PC_NAMES_SHARP[pc]}${oct}`;
    return `${PC_NAMES_SHARP[pc]}${oct} / ${PC_NAMES_FLAT[pc]}${oct}`;
  }

  async function playPitchWindowed(pitch, whenSec, playSec, fadeOutSec, gain = 1) {
    const pc = pcFromPitch(pitch);
    const oct = octFromPitch(pitch);
    const stem = getStemForPc(pc);
    if (!stem) return false;

    await resumeAudioIfNeeded();

    const url = noteUrl(stem, oct);
    const buf = await loadBuffer(url);
    if (!buf) {
      setFeedback(`Missing audio: <code>${url}</code>`);
      return false;
    }

    playBufferWindowed(buf, whenSec, playSec, fadeOutSec, gain);
    return true;
  }

  // ---------------- game state ----------------
  const score = { asked: 0, correct: 0, streak: 0, longestStored: 0 };

  let started = false;
  let awaitingNext = false;
  let canAnswer = false;

  let pitchMin = 0;
  let pitchMax = 0;
  let note1 = null;
  let note2 = null;

  function randomInt(min, max) {
    const a = Math.ceil(min);
    const b = Math.floor(max);
    return Math.floor(Math.random() * (b - a + 1)) + a;
  }

  function currentMode() {
    return RANGES[noteRangeSel.value] || RANGES["expert-4oct"];
  }

  function modeLabel() {
    return currentMode().label;
  }

  function computePitchBounds() {
    const m = currentMode();
    const startOct = m.startOctave;
    const octaves = m.octaves;

    pitchMin = pitchFromPcOct(0, startOct);
    pitchMax = pitchFromPcOct(0, startOct + octaves);
  }

  function expectedAnswer(a, b) {
    if (b === a) return "same";
    return b > a ? "higher" : "lower";
  }

  function pickIntervalSemitones() {
    const r = Math.random();
    if (r < 0.14) return 0;
    if (r < 0.62) return 1;
    if (r < 0.90) return 2;
    return 3;
  }

  function pickPair() {
    computePitchBounds();

    const a = randomInt(pitchMin, pitchMax);
    let tries = 0;

    while (tries++ < 30) {
      const dist = pickIntervalSemitones();
      const dir = Math.random() < 0.5 ? -1 : 1;

      let b = a + (dir * dist);
      if (dist === 0) b = a;

      if (b < pitchMin || b > pitchMax) continue;
      if (Math.abs(b - a) > 3) continue;

      return { a, b };
    }

    const b = Math.max(pitchMin, Math.min(pitchMax, a + (Math.random() < 0.5 ? -1 : 1)));
    return { a, b };
  }

  function scorePercent() {
    if (score.asked <= 0) return 0;
    return Math.round((score.correct / score.asked) * 1000) / 10;
  }

  function displayLongest() {
    return Math.max(score.longestStored, score.streak);
  }

  function renderScore() {
    const items = [
      ["Questions asked", score.asked],
      ["Answers correct", score.correct],
      ["Correct in a row", score.streak],
      ["Longest correct streak", displayLongest()],
      ["Percentage correct", `${scorePercent()}%`],
    ];

    scoreOut.innerHTML =
      `<div class="scoreGrid scoreGridVertical">` +
      items.map(([k, v]) =>
        `<div class="scoreItem"><span class="scoreK">${k}</span><span class="scoreV">${v}</span></div>`
      ).join("") +
      `</div>`;
  }

  function setFeedback(html) {
    feedbackOut.innerHTML = html || "";
  }

  function updateControls() {
    replayBtn.disabled = !started || note1 == null || note2 == null;

    const answerDisabled = !started || awaitingNext || !canAnswer || note1 == null || note2 == null;
    higherBtn.disabled = answerDisabled;
    sameBtn.disabled = answerDisabled;
    lowerBtn.disabled = answerDisabled;

    nextBtn.disabled = !started || !awaitingNext;
  }

  function updateBeginButton() {
    beginBtn.textContent = started ? "Restart Game" : "Begin Game";
    beginBtn.classList.toggle("pulse", !started);
  }

  // ---------------- mini keyboard (renders into #miniMount inside Feedback card) ----------------
  const SVG_NS = "http://www.w3.org/2000/svg";

  function el(tag, attrs = {}, children = []) {
    const n = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    for (const c of children) n.appendChild(c);
    return n;
  }

  function isBlackPc(pc) {
    return [1, 3, 6, 8, 10].includes(pc);
  }

  function whiteIndexInOctave(pc) {
    const m = { 0:0, 2:1, 4:2, 5:3, 7:4, 9:5, 11:6 };
    return m[pc] ?? null;
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function computeTwoOctaveWindow(p1, p2) {
    const minP = Math.min(p1, p2);
    const maxP = Math.max(p1, p2);

    let startC = pitchFromPcOct(0, octFromPitch(minP));
    let endC = startC + 24;

    if (maxP > endC) {
      startC += 12;
      endC = startC + 24;
    }

    if (startC < pitchMin) {
      startC = pitchMin;
      endC = startC + 24;
    }
    if (endC > pitchMax) {
      endC = pitchMax;
      startC = endC - 24;
    }

    startC = clamp(startC, pitchMin, pitchMax);
    endC = clamp(endC, pitchMin, pitchMax);

    return { lo: startC, hi: endC };
  }

  function buildMiniKeyboard(p1, p2) {
    miniMount.innerHTML = "";

    if (p1 == null || p2 == null) {
      const s = el("svg", { width: 780, height: 128, viewBox: "0 0 780 128", preserveAspectRatio: "xMidYMid meet" });
      miniMount.appendChild(s);
      return;
    }

    const { lo, hi } = computeTwoOctaveWindow(p1, p2);

    const pitches = [];
    for (let p = lo; p <= hi; p++) pitches.push(p);

    const WHITE_W = 26;
    const WHITE_H = 92;
    const BLACK_W = 16;
    const BLACK_H = 58;
    const BORDER = 8;
    const RADIUS = 14;

    const whitePitches = pitches.filter(p => whiteIndexInOctave(pcFromPitch(p)) != null);
    if (!whitePitches.length) {
      const s = el("svg", { width: 780, height: 128, viewBox: "0 0 780 128" });
      miniMount.appendChild(s);
      return;
    }

    const totalWhite = whitePitches.length;
    const innerW = totalWhite * WHITE_W;
    const outerW = innerW + BORDER * 2;
    const outerH = WHITE_H + BORDER * 2;

    const s = el("svg", {
      width: outerW,
      height: outerH,
      viewBox: `0 0 ${outerW} ${outerH}`,
      preserveAspectRatio: "xMidYMid meet",
      role: "img",
      "aria-label": "Mini keyboard (2 octaves)",
    });
    s.style.maxWidth = `${outerW}px`;

    const style = el("style");
    style.textContent = `
      .frame{ fill:#fff; stroke:#000; stroke-width:${BORDER}; rx:${RADIUS}; ry:${RADIUS}; }
      .w rect{ fill:#fff; stroke:#222; stroke-width:1; }
      .b rect{ fill:#111; stroke:#000; stroke-width:1; rx:3; ry:3; }
      .lbl{ font-family: Arial, Helvetica, sans-serif; font-size:11px; fill: rgba(0,0,0,0.55); font-weight:800; user-select:none; }
      .hl1 rect{ fill:${FIRST_COLOR} !important; }
      .hl1 .lbl{ fill: rgba(255,255,255,0.95) !important; }
      .hl2 rect{ fill:${SECOND_COLOR} !important; }
      .hl2 .lbl{ fill: rgba(255,255,255,0.95) !important; }
      .b.hl1 rect{ fill:${FIRST_COLOR} !important; }
      .b.hl2 rect{ fill:${SECOND_COLOR} !important; }
    `;
    s.appendChild(style);

    s.appendChild(el("rect", {
      x: BORDER / 2,
      y: BORDER / 2,
      width: outerW - BORDER,
      height: outerH - BORDER,
      rx: RADIUS,
      ry: RADIUS,
      class: "frame",
    }));

    const gW = el("g");
    const gB = el("g");
    s.appendChild(gW);
    s.appendChild(gB);

    const startX = BORDER;
    const startY = BORDER;

    const whiteIndexByPitch = new Map();
    whitePitches.forEach((p, i) => whiteIndexByPitch.set(p, i));

    for (let i = 0; i < whitePitches.length; i++) {
      const p = whitePitches[i];
      const x = startX + i * WHITE_W;

      const pc = pcFromPitch(p);
      const oct = octFromPitch(p);
      const name = PC_NAMES_SHARP[pc] + oct;

      const grp = el("g", { class: "w" });
      grp.appendChild(el("rect", { x, y: startY, width: WHITE_W, height: WHITE_H }));

      const text = el("text", { x: x + WHITE_W / 2, y: startY + WHITE_H - 12, "text-anchor": "middle", class: "lbl" });
      text.textContent = (pc === 0) ? name : "";
      grp.appendChild(text);

      if (p === p1) grp.classList.add("hl1");
      if (p === p2) grp.classList.add("hl2");

      gW.appendChild(grp);
    }

    for (let p = lo; p <= hi; p++) {
      const pc = pcFromPitch(p);
      if (!isBlackPc(pc)) continue;

      const leftPcByBlack = { 1:0, 3:2, 6:5, 8:7, 10:9 };
      const leftPc = leftPcByBlack[pc];
      if (leftPc == null) continue;

      const oct = octFromPitch(p);
      const leftWhitePitch = pitchFromPcOct(leftPc, oct);

      const wi = whiteIndexByPitch.get(leftWhitePitch);
      if (wi == null) continue;

      const leftX = startX + wi * WHITE_W;
      const x = leftX + WHITE_W - (BLACK_W / 2);

      const grp = el("g", { class: "b" });
      grp.appendChild(el("rect", { x, y: startY, width: BLACK_W, height: BLACK_H }));

      if (p === p1) grp.classList.add("hl1");
      if (p === p2) grp.classList.add("hl2");

      gB.appendChild(grp);
    }

    miniMount.appendChild(s);
  }

  // ---------------- flow ----------------
  let lastPlayToken = 0;

  async function playPair({ allowAnswerAfter = true } = {}) {
    if (!started || note1 == null || note2 == null) return;

    const token = ++lastPlayToken;

    canAnswer = false;
    updateControls();
    stopAllNotes(0.08);

    const ctx = ensureAudioGraph();
    if (!ctx) return;

    const t0 = ctx.currentTime + 0.03;

    const ok1 = await playPitchWindowed(note1, t0, NOTE_PLAY_SEC, FADE_OUT_SEC, 1.0);
    if (!ok1 || token !== lastPlayToken) return;

    const t1 = t0 + NOTE_PLAY_SEC + GAP_SEC;
    const ok2 = await playPitchWindowed(note2, t1, NOTE_PLAY_SEC, FADE_OUT_SEC, 1.0);
    if (!ok2 || token !== lastPlayToken) return;

    if (allowAnswerAfter) {
      const unlockAtMs = (NOTE_PLAY_SEC * 1000) + 40;
      setTimeout(() => {
        if (token !== lastPlayToken) return;
        canAnswer = true;
        updateControls();
      }, unlockAtMs);
    }
  }

  async function startNewRound({ autoplay = true } = {}) {
    if (!started) return;

    awaitingNext = false;
    canAnswer = false;
    updateControls();

    const pair = pickPair();
    note1 = pair.a;
    note2 = pair.b;

    buildMiniKeyboard(null, null);

    setFeedback("Listen carefully…");

    if (autoplay) {
      await new Promise(requestAnimationFrame);
      setFeedback("Decide if the second note is <strong>Higher</strong>, <strong>Lower</strong>, or the <strong>Same</strong>.");
      await playPair({ allowAnswerAfter: true });
    } else {
      setFeedback("Press <strong>Replay Notes</strong> to hear the notes.");
    }
  }

  async function replay() {
    if (!started || note1 == null || note2 == null) return;
    setFeedback("Replaying…");
    buildMiniKeyboard(null, null);
    awaitingNext = false;
    await playPair({ allowAnswerAfter: true });
  }

  function showPopup(title, message, { showDownload = false } = {}) {
    if (!streakModal || !modalTitle || !modalBody || !modalDownload || !modalClose) return;
    modalTitle.textContent = title;
    modalBody.textContent = message;
    modalDownload.classList.toggle("hidden", !showDownload);
    streakModal.classList.remove("hidden");
    modalClose.focus();
  }

  function hidePopup() {
    streakModal?.classList.add("hidden");
  }

  function considerStreakForLongestOnFail(prevStreak) {
    if (prevStreak > score.longestStored) {
      score.longestStored = prevStreak;
      showPopup(
        "New Longest Streak!",
        `New Longest Streak! That's ${prevStreak} correct in a row!`,
        { showDownload: true }
      );
    }
  }

  function lockAfterAnswer() {
    canAnswer = false;
    awaitingNext = true;
    updateControls();
  }

  function answer(choice) {
    if (!started || !canAnswer || note1 == null || note2 == null) return;

    score.asked += 1;

    const correct = expectedAnswer(note1, note2);
    const isCorrect = choice === correct;

    if (isCorrect) {
      score.correct += 1;
      score.streak += 1;
      renderScore();
      setFeedback(
        `Correct! ✅<br/>` +
        `First: <strong>${pitchLabel(note1)}</strong> &nbsp;→&nbsp; Second: <strong>${pitchLabel(note2)}</strong>.`
      );
    } else {
      const prev = score.streak;
      score.streak = 0;
      considerStreakForLongestOnFail(prev);
      renderScore();
      setFeedback(
        `Incorrect ❌ (You chose <strong>${choice}</strong>.)<br/>` +
        `First: <strong>${pitchLabel(note1)}</strong> &nbsp;→&nbsp; Second: <strong>${pitchLabel(note2)}</strong> ` +
        `(Answer: <strong>${correct}</strong>).`
      );
    }

    buildMiniKeyboard(note1, note2);
    lockAfterAnswer();
  }

  async function goNext() {
    if (!started || !awaitingNext) return;
    setFeedback("");
    await startNewRound({ autoplay: true });
  }

  async function beginGame() {
    await resumeAudioIfNeeded();

    started = true;
    updateBeginButton();

    score.asked = 0;
    score.correct = 0;
    score.streak = 0;
    score.longestStored = 0;
    renderScore();

    await startNewRound({ autoplay: true });
  }

  function restartGame() {
    stopAllNotes(0.08);

    score.asked = 0;
    score.correct = 0;
    score.streak = 0;
    score.longestStored = 0;
    renderScore();

    awaitingNext = false;
    canAnswer = false;
    note1 = null;
    note2 = null;

    buildMiniKeyboard(null, null);
    setFeedback("Restarted. Press <strong>Replay Notes</strong> or <strong>Begin Game</strong> to play.");

    startNewRound({ autoplay: true });
  }

  // ---------------- downloads ----------------
  function downloadBlob(blob, filename) {
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }

  function canvasToPngBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
  }

  function drawCardBase(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#fbfbfc";
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(0,0,0,0.12)";
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, w - 16, h - 16);

    ctx.fillStyle = "#111";
    ctx.fillRect(8, 8, w - 16, 74);
  }

  function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = String(text).split(/\s+/);
    let line = "";
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, y);
        line = word;
        y += lineHeight;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, y);
  }

  function getPlayerName() {
    const prev = localStorage.getItem("hol_player_name") || "";
    const name = window.prompt("Enter your name for the score card:", prev) ?? "";
    const trimmed = String(name).trim();
    if (trimmed) localStorage.setItem("hol_player_name", trimmed);
    return trimmed || "Player";
  }

  async function downloadScoreCardPng(playerName) {
    const w = 560;
    const h = 520;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    drawCardBase(ctx, w, h);

    ctx.fillStyle = "#fff";
    ctx.font = "900 30px Arial";
    ctx.fillText("Higher Or Lower?! — Scorecard", 28, 56);

    const bodyX = 28;
    const bodyY = 130;

    ctx.fillStyle = "#111";
    ctx.font = "900 22px Arial";
    ctx.fillText("Summary", bodyX, bodyY);

    ctx.font = "700 20px Arial";
    const lines = [
      `Name: ${playerName}`,
      `Game mode: ${modeLabel()}`,
      `Questions asked: ${score.asked}`,
      `Answers correct: ${score.correct}`,
      `Correct in a row: ${score.streak}`,
      `Longest correct streak: ${displayLongest()}`,
      `Percentage correct: ${scorePercent()}%`,
    ];

    let y = bodyY + 44;
    for (const ln of lines) {
      ctx.fillText(ln, bodyX, y);
      y += 34;
    }

    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.font = "700 16px Arial";
    ctx.fillText("Downloaded from www.eartraininglab.com 🎶", bodyX, h - 36);

    const blob = await canvasToPngBlob(canvas);
    if (blob) downloadBlob(blob, "Higher Or Lower Scorecard.png");
  }

  async function downloadRecordPng(streakValue, playerName) {
    const w = 980;
    const h = 420;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    drawCardBase(ctx, w, h);

    ctx.fillStyle = "#fff";
    ctx.font = "900 30px Arial";
    ctx.fillText("Higher Or Lower?! — Record", 28, 56);

    ctx.fillStyle = "#111";
    ctx.font = "900 28px Arial";
    ctx.fillText(`${streakValue} correct in a row!`, 28, 142);

    ctx.font = "700 22px Arial";
    ctx.fillStyle = "#111";
    const msg = `${playerName} just scored ${streakValue} correct answers in a row on the Higher Or Lower?! game 🎉🎶🥳`;
    drawWrappedText(ctx, msg, 28, 200, w - 56, 34);

    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.font = "700 16px Arial";
    ctx.fillText("Downloaded from www.eartraininglab.com 🎶", 28, h - 36);

    const blob = await canvasToPngBlob(canvas);
    if (blob) downloadBlob(blob, "Higher Or Lower Record.png");
  }

  async function onDownloadScoreCard() {
    const name = getPlayerName();
    await downloadScoreCardPng(name);
  }

  async function onDownloadRecord() {
    const name = getPlayerName();
    const v = score.longestStored || displayLongest();
    await downloadRecordPng(v, name);
  }

  // ---------------- events ----------------
  function bind() {
    beginBtn.addEventListener("click", async () => {
      if (!started) await beginGame();
      else restartGame();
    });

    replayBtn.addEventListener("click", replay);

    higherBtn.addEventListener("click", () => answer("higher"));
    sameBtn.addEventListener("click", () => answer("same"));
    lowerBtn.addEventListener("click", () => answer("lower"));

    nextBtn.addEventListener("click", goNext);
    downloadScoreBtn.addEventListener("click", onDownloadScoreCard);

    modalClose?.addEventListener("click", hidePopup);
    streakModal?.addEventListener("click", (e) => { if (e.target === streakModal) hidePopup(); });
    modalDownload?.addEventListener("click", onDownloadRecord);

    noteRangeSel.addEventListener("change", () => {
      computePitchBounds();
      buildMiniKeyboard(null, null);
      if (started) startNewRound({ autoplay: true });
    });

    document.addEventListener("keydown", async (e) => {
      if (!started) return;

      if (e.code === "KeyR") {
        await replay();
        return;
      }

      if (e.code === "ArrowUp") { answer("higher"); return; }
      if (e.code === "ArrowDown") { answer("lower"); return; }
      if (e.code === "ArrowRight") { answer("same"); return; }

      if (e.code === "Space" || e.code === "Enter") {
        e.preventDefault();
        if (awaitingNext) await goNext();
      }
    });
  }

  function init() {
    bind();
    computePitchBounds();
    renderScore();
    updateBeginButton();
    buildMiniKeyboard(null, null);
    setFeedback("Press <strong>Begin Game</strong> to start.");
    updateControls();
  }

  init();
})();

