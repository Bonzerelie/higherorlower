/* /script.js
   Higher Or Lower?! (two-note comparison)
   - audio/{stem}{octave}.mp3
*/
(() => {
  "use strict";

  const AUDIO_DIR = "audio";
  const LS_KEY_NAME = "hol_player_name";

  // UI Sounds
  const UI_SND_SELECT = "select1.mp3";
  const UI_SND_BACK = "back1.mp3";
  const UI_SND_CORRECT = "correct1.mp3";
  const UI_SND_INCORRECT = "incorrect1.mp3";

  const NOTE_PLAY_SEC = 1.2;
  const FADE_OUT_SEC = 0.1;
  const GAP_SEC = 0.01;

  const FIRST_COLOR = "#4da3ff";
  const SECOND_COLOR = "#34c759";

  const PC_TO_STEM = {
    0: "c", 1: "csharp", 2: "d", 3: "dsharp", 4: "e", 5: "f",
    6: "fsharp", 7: "g", 8: "gsharp", 9: "a", 10: "asharp", 11: "b",
  };

  const PC_NAMES_SHARP = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  const PC_NAMES_FLAT  = ["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"];

  const RANGES = {
    "easy-1oct":   { label: "1 Octave",   startOctave: 4, octaves: 1 },
    "med-2oct":    { label: "2 Octaves",  startOctave: 3, octaves: 2 },
    "hard-3oct":   { label: "3 Octaves",  startOctave: 3, octaves: 3 },
    "expert-4oct": { label: "4 Octaves",  startOctave: 2, octaves: 4 },
  };

  const $ = (id) => document.getElementById(id);

  const beginBtn = $("beginBtn");
  const replayBtn = $("replayBtn");
  const higherBtn = $("higherBtn");
  const sameBtn = $("sameBtn");
  const lowerBtn = $("lowerBtn");
  const nextBtn = $("nextBtn");
  
  const settingsBtn = $("settingsBtn");
  const infoBtn = $("infoBtn");
  const downloadScoreBtn = $("downloadScoreBtn");
  
  const subtitle = $("subtitle");
  const feedbackOut = $("feedbackOut");
  const scoreOut = $("scoreOut");
  const miniMount = $("miniMount");

  const titleWrap = $("titleWrap");
  const titleImgWide = $("titleImgWide");
  const titleImgWrapped = $("titleImgWrapped");

  // Modals & Inputs
  const introModal = $("introModal");
  const introBeginBtn = $("introBeginBtn");
  const introRangeSelect = $("introRangeSelect");

  const settingsModal = $("settingsModal");
  const settingsRangeSelect = $("settingsRangeSelect");
  const settingsRestartBtn = $("settingsRestartBtn");
  const settingsCancelBtn = $("settingsCancelBtn");

  const infoModal = $("infoModal");
  const infoClose = $("infoClose");

  const scoreModal = $("scoreModal");
  const scoreModalContinueBtn = $("scoreModalContinueBtn");
  const modalDownloadScorecardBtn = $("modalDownloadScorecardBtn");
  
  const streakModal = $("streakModal");
  const modalTitleRecord = $("modalTitleRecord");
  const modalBodyRecord = $("modalBodyRecord");
  const modalCloseRecord = $("modalCloseRecord");
  const modalDownloadRecord = $("modalDownloadRecord");

  const scoreMeta = $("scoreMeta");
  const modalScoreMeta = $("modalScoreMeta");
  const playerNameInput = $("playerNameInput");
  const modalPlayerNameInput = $("modalPlayerNameInput");
  
  let currentModeKey = "easy-1oct";

  if (!beginBtn || !replayBtn || !higherBtn || !sameBtn || !lowerBtn || !nextBtn || !downloadScoreBtn || !feedbackOut || !scoreOut || !miniMount) {
    const msg = "UI mismatch: required elements missing. Ensure index.html matches script.js ids.";
    if (feedbackOut) feedbackOut.textContent = msg;
    else alert(msg);
    return;
  }

  function setSubtitleVisible(visible) {
    if (!subtitle) return;
    subtitle.classList.toggle("hidden", !visible);
  }

  function setTitleMode(mode) {
    if (!titleWrap) return;
    titleWrap.classList.toggle("titleModeWide", mode === "wide");
    titleWrap.classList.toggle("titleModeWrapped", mode === "wrapped");
  }

  function computeDesiredWideWidthPx() {
    const cssMax = 600;
    const natural = titleImgWide?.naturalWidth || cssMax;
    return Math.min(cssMax, natural);
  }

  function updateTitleForWidth() {
    if (!titleWrap || !titleImgWide || !titleImgWrapped) return;

    const available = Math.floor(titleWrap.getBoundingClientRect().width);
    const desiredWide = computeDesiredWideWidthPx();

    if (available + 1 < desiredWide) setTitleMode("wrapped");
    else setTitleMode("wide");
  }

  // ---------------- iframe sizing & scrolling ----------------
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

  // ---------------- audio ----------------
  let audioCtx = null;
  let masterGain = null;

  const bufferPromiseCache = new Map();
  const activeVoices = new Set();
  const activeUiAudios = new Set();
  let synthFallbackWarned = false;

  function ensureAudioGraph() {
    if (audioCtx) return audioCtx;

    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;

    audioCtx = new Ctx();

    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.9;

    const compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -10;   
    compressor.knee.value = 12;         
    compressor.ratio.value = 12;        
    compressor.attack.value = 0.002;    
    compressor.release.value = 0.25;

    masterGain.connect(compressor);
    compressor.connect(audioCtx.destination);

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
    const fade = Math.max(0.01, Number.isFinite(fadeSec) ? fadeSec : 0.05);

    activeVoices.forEach((v) => {
      try {
        v.gain.gain.cancelScheduledValues(now);
        v.gain.gain.setValueAtTime(v.gain.gain.value, now);
        v.gain.gain.exponentialRampToValueAtTime(0.0001, now + fade);
        v.src.stop(now + fade + 0.05);
      } catch (e) {}
    });
    activeVoices.clear();
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

  function pitchToFrequency(pitch) {
    const A4 = pitchFromPcOct(9, 4);
    return 440 * Math.pow(2, (pitch - A4) / 12);
  }

  function playSynthToneWindowed(pitch, whenSec, playSec, fadeOutSec, gain = 0.65) {
    const ctx = ensureAudioGraph();
    if (!ctx || !masterGain) return null;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(pitchToFrequency(pitch), whenSec);

    const g = ctx.createGain();
    const safeGain = Math.max(0, Number.isFinite(gain) ? gain : 0.65);
    const fadeIn = 0.01;
    const endAt = whenSec + Math.max(0.05, playSec);

    g.gain.setValueAtTime(0, whenSec);
    g.gain.linearRampToValueAtTime(safeGain, whenSec + fadeIn);

    const fade = Math.max(0.015, Number.isFinite(fadeOutSec) ? fadeOutSec : 0.06);
    const fadeStart = Math.max(whenSec + 0.02, endAt - fade);
    g.gain.setValueAtTime(safeGain, fadeStart);
    g.gain.linearRampToValueAtTime(0, endAt);

    osc.connect(g);
    g.connect(masterGain);

    trackVoice(osc, g, whenSec);
    osc.start(whenSec);
    osc.stop(endAt + 0.03);
    return osc;
  }

  function maybeWarnSynthFallback(missingUrl) {
    if (synthFallbackWarned) return;
    synthFallbackWarned = true;
    console.warn("Audio sample missing; using synthesized tones instead:", missingUrl);
    setFeedback(`Audio samples not found; using synthesized tones.<br/><small>Missing: <code>${missingUrl}</code></small>`);
  }

  function stopAllUiSounds() {
    for (const a of Array.from(activeUiAudios)) {
      try { a.pause(); a.currentTime = 0; } catch {}
      activeUiAudios.delete(a);
    }
  }

  async function playUiSound(filename) {
    try {
      const url = `${AUDIO_DIR}/${filename}`;
      const buffer = await loadBuffer(url);
      if (!buffer) return;
      const ctx = ensureAudioGraph();
      if (!ctx) return;
      
      const when = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const g = ctx.createGain();
      g.gain.setValueAtTime(2.0, when);

      src.connect(g);
      g.connect(masterGain);
      trackVoice(src, g, when);
      src.start(when);
    } catch (e) { console.error("UI Sound error:", e); }
  }

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
      maybeWarnSynthFallback(url);
      playSynthToneWindowed(pitch, whenSec, playSec, fadeOutSec, gain * 0.7);
      return true;
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
    return RANGES[currentModeKey] || RANGES["easy-1oct"];
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

  function updateScoreMetaText() {
    const metaText = `Game mode: ${modeLabel()}`;
    if (scoreMeta) scoreMeta.textContent = metaText;
    if (modalScoreMeta) modalScoreMeta.textContent = metaText;
  }

  function renderScore() {
    const items = [
      ["Questions asked", score.asked],
      ["Answers correct", score.correct],
      ["Correct in a row", score.streak],
      ["Longest correct streak", displayLongest()],
      ["Percentage correct", `${scorePercent()}%`],
    ];

    scoreOut.innerHTML = items.map(([k, v]) =>
        `<div class="scoreItem"><span class="scoreK">${k}</span><span class="scoreV">${v}</span></div>`
    ).join("");
    
    updateScoreMetaText();
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

    const nextReady = started && awaitingNext;
    nextBtn.disabled = !nextReady;
    nextBtn.classList.toggle("nextReady", nextReady);
  }

  function updateBeginButton() {
    beginBtn.textContent = started ? "End / Restart Game" : "Begin Game";
    beginBtn.classList.toggle("pulse", !started);
    beginBtn.classList.toggle("primary", !started);
    beginBtn.classList.toggle("isRestart", started);
  }

  // ---------------- mini keyboard ----------------
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

  // ---------------- modals ----------------
  let lastFocusEl = null;

  function openModal(modalEl) {
    lastFocusEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modalEl.classList.remove("hidden");
    postHeightNow();
  }

  function closeModal(modalEl) {
    modalEl.classList.add("hidden");
    postHeightNow();
    if (lastFocusEl) {
      try { lastFocusEl.focus(); } catch {}
    }
  }

  function isVisible(modalEl) { return !modalEl.classList.contains("hidden"); }

  function showRecordPopup(title, message, { showDownload = false } = {}) {
    if (!streakModal || !modalTitleRecord || !modalBodyRecord || !modalDownloadRecord || !modalCloseRecord) return;
    modalTitleRecord.textContent = title;
    modalBodyRecord.textContent = message;
    modalDownloadRecord.classList.toggle("hidden", !showDownload);
    openModal(streakModal);
    modalCloseRecord.focus();
  }

  let scoreModalContinueCallback = null;
  function showScoreModal(onContinue) {
    scoreModalContinueCallback = onContinue;
    
    // update specific modal score fields
    if ($("modalAsked")) $("modalAsked").textContent = score.asked;
    if ($("modalCorrect")) $("modalCorrect").textContent = score.correct;
    if ($("modalStreak")) $("modalStreak").textContent = score.streak;
    if ($("modalLongest")) $("modalLongest").textContent = displayLongest();
    if ($("modalPercent")) $("modalPercent").textContent = `${scorePercent()}%`;
    
    updateScoreMetaText();
    openModal(scoreModal);
    try { scoreModalContinueBtn.focus(); } catch {}
  }

  function considerStreakForLongestOnFail(prevStreak) {
    if (prevStreak > score.longestStored) {
      score.longestStored = prevStreak;
      showRecordPopup(
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

    stopAllUiSounds();

    if (isCorrect) {
      setTimeout(() => playUiSound(UI_SND_CORRECT), 20);
      score.correct += 1;
      score.streak += 1;
      renderScore();
      setFeedback(
        `Correct! ✅<br/>` +
        `First: <strong>${pitchLabel(note1)}</strong> &nbsp;→&nbsp; Second: <strong>${pitchLabel(note2)}</strong>.`
      );
    } else {
      playUiSound(UI_SND_INCORRECT);
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
    stopAllUiSounds();
    await startNewRound({ autoplay: true });
  }

  function resetToLoadingScreen({ openIntro = false } = {}) {
    stopAllNotes(0.08);
    stopAllUiSounds();

    started = false;
    awaitingNext = false;
    canAnswer = false;

    note1 = null;
    note2 = null;

    score.asked = 0;
    score.correct = 0;
    score.streak = 0;
    score.longestStored = 0;

    renderScore();
    updateBeginButton();
    buildMiniKeyboard(null, null);
    
    setFeedback("Press <strong>Begin Game</strong> to start.");
    updateControls();
    
    if (openIntro) {
      openModal(introModal);
      try { introBeginBtn.focus(); } catch {}
    }
  }

  async function beginGame() {
    await resumeAudioIfNeeded();
    stopAllUiSounds();

    started = true;
    updateBeginButton();

    score.asked = 0;
    score.correct = 0;
    score.streak = 0;
    score.longestStored = 0;
    renderScore();

    await startNewRound({ autoplay: true });
  }

  // Settings syncing logic
  function isSettingsDirty() {
    return settingsRangeSelect.value !== currentModeKey;
  }
  
  function updateSettingsDirtyUi() {
    const dirty = isSettingsDirty();
    settingsRestartBtn.disabled = !dirty;
    settingsRestartBtn.classList.toggle("is-disabled", !dirty);
  }
  
  function applyRangeMode(newRange) {
    currentModeKey = newRange;
    computePitchBounds();
    updateScoreMetaText();
  }

  // Name input sync
  function loadInitialName() {
    const saved = localStorage.getItem(LS_KEY_NAME);
    const v = String(saved || "").trim();
    return v.slice(0, 32);
  }

  function saveName(name) { try { localStorage.setItem(LS_KEY_NAME, String(name || "").trim().slice(0, 32)); } catch {} }

  function syncNames(val) {
    if (playerNameInput && playerNameInput.value !== val) playerNameInput.value = val;
    if (modalPlayerNameInput && modalPlayerNameInput.value !== val) modalPlayerNameInput.value = val;
  }
  if (playerNameInput) playerNameInput.addEventListener("input", (e) => syncNames(e.target.value));
  if (modalPlayerNameInput) modalPlayerNameInput.addEventListener("input", (e) => syncNames(e.target.value));

  // ---------------- downloads ----------------
  async function loadImage(src) {
    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }
  
  function drawImageContain(ctx, img, x, y, w, h) {
    const iw = img.naturalWidth || img.width || 1;
    const ih = img.naturalHeight || img.height || 1;
    const r = Math.min(w / iw, h / ih);
    const dw = Math.max(1, iw * r);
    const dh = Math.max(1, ih * r);
    const dx = x + (w - dw) / 2;
    const dy = y + (h - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);
    return { w: dw, h: dh, x: dx, y: dy };
  }

  function drawRoundRect(ctx, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function sanitizeFilenamePart(s) {
    const v = String(s || "").trim().replace(/\s+/g, "_");
    const cleaned = v.replace(/[^a-zA-Z0-9_\-]+/g, "");
    return cleaned.slice(0, 32) || "";
  }
  
  function safeText(s) { return String(s || "").replace(/[\u0000-\u001f\u007f]/g, "").trim(); }

  async function downloadScorecardPng(nameInputEl) {
    const LAYOUT = {
      gapAfterImage: 32,           
      gapAfterUrl: 36,             
      gapAfterTitle: 30,           
      gapAfterMeta: 28,            
      gapAfterName: 22,            
      gapNoNameCompensation: 12,   
      mainGridRowGap: 14,          
    };

    const name = safeText(nameInputEl?.value);
    if (nameInputEl) saveName(name);

    const W = 720;
    const rowsCount = 5;
    const rowH = 58;
    const baseContentH = 340; 
    const H = baseContentH + (rowsCount * (rowH + LAYOUT.mainGridRowGap)) + 80; 
    
    const dpr = Math.max(1, Math.floor((window.devicePixelRatio || 1) * 100) / 100);

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    const pad = 34;
    const cardX = pad;
    const cardY = pad;
    const cardW = W - pad * 2;
    const cardH = H - pad * 2;

    ctx.fillStyle = "#f9f9f9";
    drawRoundRect(ctx, cardX, cardY, cardW, cardH, 18);
    ctx.fill();

    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = 1;
    drawRoundRect(ctx, cardX, cardY, cardW, cardH, 18);
    ctx.stroke();

    const titleSrc = titleImgWide?.getAttribute("src") || "images/title.png";
    const titleImg = await loadImage(titleSrc);

    let yCursor = cardY + 26;

    if (titleImg) {
      const imgMaxW = Math.min(520, cardW - 40);
      const imgMaxH = 92;
      drawImageContain(ctx, titleImg, (W - imgMaxW) / 2, yCursor, imgMaxW, imgMaxH);
      yCursor += imgMaxH + LAYOUT.gapAfterImage;
    }

    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.font = "800 18px Arial, Helvetica, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("www.eartraininglab.com", W / 2, yCursor);
    yCursor += LAYOUT.gapAfterUrl;

    ctx.fillStyle = "#111";
    ctx.textAlign = "center";
    ctx.font = "700 26px Arial, Helvetica, sans-serif";
    ctx.fillText("Score Card", W / 2, yCursor);
    yCursor += LAYOUT.gapAfterTitle;

    ctx.font = "800 18px Arial, Helvetica, sans-serif";
    ctx.fillStyle = "rgba(0,0,0,0.70)";
    ctx.fillText(`Game mode: ${modeLabel()}`, W / 2, yCursor);
    yCursor += LAYOUT.gapAfterMeta;

    if (name) {
      ctx.fillText(`Name: ${name}`, W / 2, yCursor);
      yCursor += LAYOUT.gapAfterName;
    } else {
      yCursor += LAYOUT.gapNoNameCompensation; 
    }

    ctx.fillStyle = "#111";
    ctx.textAlign = "left";

    const rowX = cardX + 26;
    const rowW = cardW - 52;
    
    const rows = [
      ["Questions asked", String(score.asked)],
      ["Answers correct", String(score.correct)],
      ["Correct in a row", String(score.streak)],
      ["Longest correct streak", String(displayLongest())],
      ["Percentage correct", `${scorePercent()}%`],
    ];

    for (const [k, v] of rows) {
      ctx.fillStyle = "#ffffff";
      drawRoundRect(ctx, rowX, yCursor, rowW, rowH, 14);
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.16)";
      ctx.stroke();

      ctx.fillStyle = "rgba(0,0,0,0.70)";
      ctx.font = "900 18px Arial, Helvetica, sans-serif";
      ctx.fillText(k, rowX + 16, yCursor + 33);

      ctx.fillStyle = "#111";
      ctx.font = "900 22px Arial, Helvetica, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(v, rowX + rowW - 16, yCursor + 37);
      ctx.textAlign = "left";

      yCursor += rowH + LAYOUT.mainGridRowGap;
    }

    ctx.textAlign = "center";
    ctx.font = "800 14px Arial, Helvetica, sans-serif";
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillText("Higher Or Lower?! - www.eartraininglab.com", W / 2, cardY + cardH - 24);

    const fileBase = name ? `${sanitizeFilenamePart(name)}_scorecard` : "scorecard";
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileBase}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, "image/png");
  }

  function drawCardBaseOld(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#fbfbfc";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(0,0,0,0.12)";
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, w - 16, h - 16);
    ctx.fillStyle = "#111";
    ctx.fillRect(8, 8, w - 16, 74);
  }

  function drawWrappedTextOld(ctx, text, x, y, maxWidth, lineHeight) {
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

  async function downloadRecordPng(streakValue, playerName) {
    const w = 980;
    const h = 420;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    drawCardBaseOld(ctx, w, h);

    ctx.fillStyle = "#fff";
    ctx.font = "900 30px Arial";
    ctx.fillText("Higher Or Lower?! — Record", 28, 56);

    ctx.fillStyle = "#111";
    ctx.font = "900 28px Arial";
    ctx.fillText(`${streakValue} correct in a row!`, 28, 142);

    ctx.font = "700 22px Arial";
    ctx.fillStyle = "#111";
    const msg = `${playerName} just scored ${streakValue} correct answers in a row on the Higher Or Lower?! game 🎉🎶🥳`;
    drawWrappedTextOld(ctx, msg, 28, 200, w - 56, 34);

    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.font = "700 16px Arial";
    ctx.fillText("Downloaded from www.eartraininglab.com 🎶", 28, h - 36);

    canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "Higher Or Lower Record.png";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, "image/png");
  }

  // ---------------- events ----------------
  function bind() {
    
    // Intro modal
    function handleIntroContinue() {
      playUiSound(UI_SND_SELECT);
      const newRange = String(introRangeSelect.value || "easy-1oct");
      applyRangeMode(newRange);
      if (settingsRangeSelect) settingsRangeSelect.value = newRange;
      
      closeModal(introModal);
      setFeedback("Press <strong>Begin Game</strong> to start.");
      try { beginBtn.focus(); } catch {}
    }
    introBeginBtn.addEventListener("click", handleIntroContinue);
    
    // Settings modal
    settingsBtn.addEventListener("click", () => {
        playUiSound(UI_SND_SELECT);
        stopAllNotes(0.06);
        if (settingsRangeSelect) settingsRangeSelect.value = currentModeKey;
        openModal(settingsModal);
        updateSettingsDirtyUi();
        try { settingsRangeSelect.focus(); } catch {}
    });
    
    settingsCancelBtn.addEventListener("click", () => {
        playUiSound(UI_SND_BACK);
        if (settingsRangeSelect) settingsRangeSelect.value = currentModeKey;
        updateSettingsDirtyUi();
        closeModal(settingsModal);
    });
    
    settingsRangeSelect.addEventListener("change", updateSettingsDirtyUi);
    
    settingsRestartBtn.addEventListener("click", () => {
      if (settingsRestartBtn.disabled) return;
      playUiSound(UI_SND_SELECT);
      const newRange = String(settingsRangeSelect.value || "easy-1oct");
      
      closeModal(settingsModal);

      showScoreModal(() => {
        applyRangeMode(newRange);
        if (introRangeSelect) introRangeSelect.value = newRange;
        resetToLoadingScreen({ openIntro: false });
      });
    });

    // Info Modal
    infoBtn.addEventListener("click", () => {
        playUiSound(UI_SND_SELECT);
        stopAllNotes(0.06);
        openModal(infoModal);
        try { infoClose.focus(); } catch {}
    });

    infoClose.addEventListener("click", () => {
        playUiSound(UI_SND_BACK);
        closeModal(infoModal);
    });

    // Score modal
    scoreModalContinueBtn.addEventListener("click", () => {
      playUiSound(UI_SND_SELECT);
      closeModal(scoreModal);
      if (scoreModalContinueCallback) scoreModalContinueCallback();
    });

    // Main buttons
    beginBtn.addEventListener("click", async () => {
      if (!started) {
        if (introModal && !introModal.classList.contains("hidden")) closeModal(introModal);
        await beginGame();
        return;
      }
      
      showScoreModal(() => {
        resetToLoadingScreen({ openIntro: true });
      });
    });

    replayBtn.addEventListener("click", replay);

    higherBtn.addEventListener("click", () => answer("higher"));
    sameBtn.addEventListener("click", () => answer("same"));
    lowerBtn.addEventListener("click", () => answer("lower"));

    nextBtn.addEventListener("click", goNext);
    
    // Downloads
    downloadScoreBtn.addEventListener("click", () => {
      playUiSound(UI_SND_SELECT);
      downloadScorecardPng(playerNameInput);
    });
    modalDownloadScorecardBtn.addEventListener("click", () => {
      playUiSound(UI_SND_SELECT);
      downloadScorecardPng(modalPlayerNameInput);
    });
    
    modalDownloadRecord.addEventListener("click", () => {
        const name = safeText(playerNameInput.value) || "Player";
        downloadRecordPng(score.longestStored || displayLongest(), name);
    });

    // Modals closing overrides
    modalCloseRecord?.addEventListener("click", () => {
        playUiSound(UI_SND_BACK);
        closeModal(streakModal);
    });
    streakModal?.addEventListener("click", (e) => { 
        if (e.target === streakModal) {
            playUiSound(UI_SND_BACK);
            closeModal(streakModal); 
        }
    });
    introModal?.addEventListener("click", (e) => { 
        if (e.target === introModal) {
            playUiSound(UI_SND_BACK);
            closeModal(introModal); 
        }
    });
    settingsModal?.addEventListener("click", (e) => { 
        if (e.target === settingsModal) {
            playUiSound(UI_SND_BACK);
            if (settingsRangeSelect) settingsRangeSelect.value = currentModeKey;
            closeModal(settingsModal);
        }
    });
    infoModal?.addEventListener("click", (e) => { 
        if (e.target === infoModal) {
            playUiSound(UI_SND_BACK);
            closeModal(infoModal);
        }
    });

    window.addEventListener("resize", () => {
      updateTitleForWidth();
    });

    document.addEventListener("keydown", async (e) => {
      if (e.key === "Escape") {
        if (isVisible(settingsModal)) {
          playUiSound(UI_SND_BACK);
          if (settingsRangeSelect) settingsRangeSelect.value = currentModeKey;
          closeModal(settingsModal);
          return;
        }
        if (isVisible(infoModal)) {
          playUiSound(UI_SND_BACK);
          closeModal(infoModal);
          return;
        }
        if (isVisible(streakModal)) { 
          playUiSound(UI_SND_BACK);
          closeModal(streakModal); 
          return; 
        }
        return;
      }

      if (isVisible(settingsModal) || isVisible(introModal) || isVisible(scoreModal) || isVisible(streakModal) || isVisible(infoModal)) return;

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

  function initTitleSwap() {
    if (!titleWrap || !titleImgWide || !titleImgWrapped) return;

    const tryUpdate = () => updateTitleForWidth();

    if (titleImgWide.complete) tryUpdate();
    else titleImgWide.addEventListener("load", tryUpdate, { once: true });

    if (titleImgWrapped.complete) tryUpdate();
    else titleImgWrapped.addEventListener("load", tryUpdate, { once: true });

    const tro = new ResizeObserver(() => updateTitleForWidth());
    tro.observe(titleWrap);
  }

  function init() {
    bind();
    initTitleSwap();

    const initialName = loadInitialName();
    if (playerNameInput) playerNameInput.value = initialName;
    if (modalPlayerNameInput) modalPlayerNameInput.value = initialName;

    applyRangeMode("easy-1oct");
    renderScore();
    updateBeginButton();
    buildMiniKeyboard(null, null);

    setFeedback("Press <strong>Begin Game</strong> to start.");
    updateControls();
    updateTitleForWidth();

    openModal(introModal);
    try { introBeginBtn.focus(); } catch {}
  }

  init();
})();