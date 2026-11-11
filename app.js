// スロくじ：画面と演出
// 抽選・盤面・保存は logic/ の部品に任せ、ここでは表示と操作だけを扱う。
// 大事な順番：STARTを押す → 抽選・盤面・保存（保存できたときだけ）→ 演出 → 右リール停止後に結果を表示

import { PRIZE_NAMES, isFinished } from "./logic/lottery.js";
import { LINES, winLines, getBoardTable } from "./logic/board.js";
import {
  loadData, saveData, drawAndSave, markRevealed, resetData, updateSettings, createInitialData, StorageError,
} from "./logic/storage.js";
import { tileSVG as makeTileSVG } from "./tiles.js";

const $ = (id) => document.getElementById(id);
const SYMS = ["tou", "dai", "toku", "seven"];

// リールが止まり始める時間（ミリ秒）：[左, 中, 右]。止まりきるまでさらに LAND_MS
const SPEED_TIMES = { slow: [600, 1150, 1900], normal: [350, 700, 1100], fast: [200, 380, 560] };
const LAND_MS = 300;
// 右リールが止まりきってから当選表示を出すまでの「ため」（ミリ秒）
const RESULT_DELAY = { slow: 400, normal: 400, fast: 200 };
const TAP_GUARD_MS = 600;   // 当選表示が出てすぐの連打で閉じないように
const START_GRID = [["dai", "tou", "toku"], ["tou", "seven", "dai"], ["toku", "dai", "tou"]];

/* =========================================================
   絵柄（作り方は tiles.js）
   ========================================================= */
const tileCache = {};
function tileSVG(sym) {
  return tileCache[sym] || (tileCache[sym] = makeTileSVG(sym));
}

/* =========================================================
   効果音（Web Audio で作る。音が出なくても抽選には影響しない）
   ========================================================= */
let audio = null;
let soundOn = false;
function ensureAudio() {
  if (!soundOn) return;
  try {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
  } catch { audio = null; }
}
function tone(freq, t0, dur, type = "square", vol = 0.08, slideTo) {
  if (!soundOn || !audio) return;
  try {
    const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + t0;
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(audio.destination); o.start(t); o.stop(t + dur + 0.02);
  } catch { /* 音が出なくても続ける */ }
}
const SE = {
  start: () => tone(300, 0, 0.15, "square", 0.05, 900),
  stop: () => { tone(150, 0, 0.09, "square", 0.1, 60); tone(1200, 0, 0.025, "triangle", 0.05); },
  win: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.22, "triangle", 0.12)); tone(1047, 0.36, 0.45, "square", 0.05); },
  seven: () => { [523, 659, 784, 1047, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, i * 0.09, 0.25, "triangle", 0.12)); tone(2093, 0.75, 0.6, "square", 0.04); },
};

/* =========================================================
   3Dリール（12面の円筒。正面の面 m が中段、m-1 が上段、m+1 が下段）
   ========================================================= */
const N = 12, STEP = 360 / N, PERSP = 600, SPIN_SPEED = 620;
const mod = (n, m) => ((n % m) + m) % m;
const rnd = () => SYMS[Math.floor(Math.random() * SYMS.length)];   // 回転中の見た目だけに使う（抽選には使わない）
const reels = [...document.querySelectorAll(".reel")].map((el) => ({ el, drum: el.querySelector(".drum"), faces: [], a: 0, m: 0, spinning: false, tween: null }));
let FH = 80, R = 150;
let shownGrid = START_GRID;

function buildReels() {
  const w = reels[0].el.clientWidth;
  FH = Math.max(40, Math.round(w - 6));
  R = FH / (2 * Math.tan(Math.PI / N));
  $("reels").style.setProperty("--fh", FH + "px");
  $("reels").style.setProperty("--rh", Math.round(FH * 2.75) + "px");
  for (const rl of reels) {
    rl.drum.innerHTML = "";
    rl.faces = Array.from({ length: N }, (_, i) => {
      const f = document.createElement("div");
      f.className = "face";
      f.style.transform = `rotateX(${-i * STEP}deg) translateZ(${R}px)`;
      rl.drum.appendChild(f);
      return f;
    });
    setAngle(rl, rl.a);
  }
}
function setAngle(rl, a) { rl.a = a; rl.drum.style.transform = `translateZ(${-R}px) rotateX(${a}deg)`; }
function setFace(rl, i, sym) { const f = rl.faces[mod(i, N)]; f.innerHTML = tileSVG(sym); f.classList.remove("dim"); }
function faceAt(c, r) { const rl = reels[c]; return rl.faces[mod(rl.m + r - 1, N)]; }
function showGrid(grid) {
  shownGrid = grid;
  reels.forEach((rl, c) => {
    rl.m = Math.round(rl.a / STEP);
    setAngle(rl, rl.m * STEP);
    for (let i = 0; i < N; i++) setFace(rl, i, rnd());
    [0, 1, 2].forEach((r) => setFace(rl, rl.m + r - 1, grid[r][c]));
  });
}

let rafOn = false, lastT = 0;
function loop(t) {
  const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0;
  lastT = t;
  let active = false;
  for (const rl of reels) {
    if (rl.spinning) { setAngle(rl, rl.a - SPIN_SPEED * dt); active = true; }
    else if (rl.tween) {
      const tw = rl.tween, p = Math.min(1, (t - tw.t0) / tw.dur);
      const c1 = 1.1, c3 = c1 + 1, e = 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);   // 少し行き過ぎて戻る
      setAngle(rl, tw.from + (tw.to - tw.from) * e);
      if (p >= 1) { rl.tween = null; setAngle(rl, tw.to); tw.done(); } else active = true;
    }
  }
  if (active) requestAnimationFrame(loop); else { rafOn = false; lastT = 0; }
}
function kick() { if (!rafOn) { rafOn = true; lastT = 0; requestAnimationFrame(loop); } }
function startSpin(c) {
  const rl = reels[c];
  for (let i = 0; i < N; i++) setFace(rl, i, rnd());
  rl.spinning = true; rl.el.classList.add("spinning");
  kick();
}
function stopSpin(c, col3, done) {
  const rl = reels[c];
  const from = rl.a;
  const to = Math.floor((from - 180) / STEP) * STEP;   // いま裏側にある面に結果を書いてから、そこへ止める
  rl.m = Math.round(to / STEP);
  col3.forEach((s, r) => setFace(rl, rl.m + r - 1, s));
  rl.spinning = false; rl.el.classList.remove("spinning");
  rl.tween = { from, to, t0: performance.now(), dur: LAND_MS, done: () => { SE.stop(); if (done) done(); } };
  kick();
}

/* =========================================================
   リーチ・当選の枠とライン番号
   ========================================================= */
// ライン番号の表示位置（左右）：段の番号 0〜2、または上端/下端
const MARK_POS = { 2: [0, 0], 1: [1, 1], 3: [2, 2], 4: ["top", "bot"], 5: ["bot", "top"] };
function cellRect(r, c) {
  const host = $("reels").getBoundingClientRect(), reel = reels[c].el.getBoundingClientRect();
  const cy = reel.top - host.top + reel.height / 2;
  const rad = Math.PI / 6;
  const s = PERSP / (PERSP - (R * Math.cos(rad) - R));
  const off = r === 1 ? 0 : (r === 0 ? -1 : 1) * R * Math.sin(rad) * s;
  const h = r === 1 ? FH : FH * Math.cos(rad) * s;
  return { x: reel.left - host.left, y: cy + off - h / 2, w: reel.width, h };
}
function placeMarks() {
  ["L", "R"].forEach((side, k) => {
    const host = $("marks" + side), ref = $("reels").getBoundingClientRect(), hr = host.getBoundingClientRect();
    host.innerHTML = LINES.map((l) => {
      const pos = MARK_POS[l.no][k];
      let y;
      if (pos === "top") y = 8;
      else if (pos === "bot") y = hr.height - 8;
      else { const b = cellRect(pos, 0); y = ref.top - hr.top + b.y + b.h / 2; }
      return `<div class="mark" data-no="${l.no}" style="top:${y}px">${l.no}</div>`;
    }).join("");
  });
}
function setMarks(lines, cls) { lines.forEach((l) => document.querySelectorAll(`.mark[data-no="${l.no}"]`).forEach((m) => m.classList.add(cls))); }
const rectSVG = (cls, b) => `<rect class="${cls}" x="${b.x + 2}" y="${b.y + 2}" width="${b.w - 4}" height="${b.h - 4}" rx="4"/>`;

function showReach(lines) {
  $("overlay").innerHTML = lines.flatMap((l) => l.cells.slice(0, 2).map(([r, c]) => rectSVG("rr", cellRect(r, c)))).join("");
  setMarks(lines, "reach");
}
function clearEffects() {
  $("overlay").innerHTML = "";
  $("cabinet").classList.remove("win");
  $("burst").classList.remove("on", "seven");
  document.querySelectorAll(".mark").forEach((m) => m.classList.remove("reach", "win"));
  document.querySelectorAll(".spark").forEach((s) => s.remove());
  document.querySelectorAll(".face.dim").forEach((f) => f.classList.remove("dim"));
}

/* =========================================================
   表示（メッセージ・履歴・ボタン）
   ========================================================= */
let storage = null;
let data = null;            // 保存データ（logic/storage.js の形式）
let busy = false;           // 回転中・当選表示中は true（STARTやリセットを受け付けない）
let hideLastInHistory = false;
let tapGuardTimer = 0;

function msg(text, cls = "") { const m = $("msg"); m.textContent = text; m.className = "msg" + (cls ? " " + cls : ""); }
function idleMessage() {
  if (!data) return;
  if (isFinished(data.lottery)) msg("終了");
  else if (data.last) msg(`${data.last.n}回目：${PRIZE_NAMES[data.last.prize]}！`, "gold");
  else msg("スタートを押してください");
}
function errorText(e) {
  if (e instanceof StorageError) {
    switch (e.code) {
      case "save-failed":
      case "verify-failed": return "保存できなかったため、抽選しませんでした。もう一度STARTを押してください";
      case "corrupt": return "保存データが壊れています。リセットすると最初からやり直せます";
      case "newer-version": return "新しい版のアプリで保存されたデータです。アプリを最新にしてください";
      case "read-failed": return "保存データを読み込めませんでした";
      default: return e.message;
    }
  }
  return "エラーが起きました：" + (e && e.message ? e.message : String(e));
}
function renderHistory() {
  const list = data ? data.history.slice(0, hideLastInHistory ? -1 : undefined) : [];
  $("histsum").textContent = `履歴（${list.length}件）`;
  $("hist").innerHTML = list.length === 0
    ? `<li class="empty">まだ引いていません</li>`
    : list.slice().reverse().map((h, k) => `<li class="${k === 0 ? "new" : ""}"><span>${h.n}回目</span><span>${PRIZE_NAMES[h.prize]}</span></li>`).join("");
}
function updateControls() {
  const ready = !!data && !busy;
  $("start").disabled = !ready || isFinished(data.lottery);
  $("reset").disabled = busy;
  $("sound").disabled = !data;
  document.querySelectorAll(".seg button").forEach((b) => { b.disabled = !ready; });
}
function renderSettings() {
  const s = data ? data.settings : { speed: "normal", sound: false };
  soundOn = s.sound;
  $("sound").innerHTML = soundOn ? '<span class="ic">🔊</span>音ON' : '<span class="ic">🔇</span>音OFF';
  $("sound").classList.toggle("on", soundOn);
  document.querySelectorAll(".seg button").forEach((b) => b.classList.toggle("on", b.dataset.speed === s.speed));
}

/* =========================================================
   当選表示（タップで閉じる）
   ========================================================= */
/** 揃ったラインに黄色の枠と光る線を出す（右リールが止まりきった直後に出す） */
function showWinLine(last) {
  const win = winLines(last.grid)[0];
  $("overlay").innerHTML = win.cells.map(([r, c]) => rectSVG("wr", cellRect(r, c))).join("") +
    `<polyline class="wl" pathLength="100" points="${win.cells.map(([r, c]) => { const b = cellRect(r, c); return `${b.x + b.w / 2},${b.y + b.h / 2}`; }).join(" ")}"/>`;
  setMarks([win], "win");
  return win;
}

function showResult(last, { resumed = false } = {}) {
  const win = $("overlay").querySelector(".wl") ? winLines(last.grid)[0] : showWinLine(last);
  const seven = last.prize === "seven";
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    if (!win.cells.some(([wr, wc]) => wr === r && wc === c)) faceAt(c, r).classList.add("dim");
  }
  $("cabinet").classList.add("win");

  // 景品名は画面幅いっぱい近くまで大きく（ラッキーセブンは2行）
  const lines = seven ? ["ラッキー", "セブン！"] : [PRIZE_NAMES[last.prize] + "！"];
  const maxChars = Math.max(...lines.map((s) => s.length));
  $("burstLabel").innerHTML = lines.join("<br>");
  $("burstLabel").style.fontSize = Math.min(110, Math.floor($("app").clientWidth * 0.9 / maxChars)) + "px";
  $("burst").classList.toggle("seven", seven);
  $("burst").classList.add("on");
  if (seven) { $("flash").classList.remove("on"); void $("flash").offsetWidth; $("flash").classList.add("on"); }
  for (let i = 0; i < (seven ? 36 : 18); i++) {
    const s = document.createElement("i");
    s.className = "spark";
    const a = Math.random() * Math.PI * 2, d = 110 + Math.random() * 110;
    s.style.setProperty("--dx", Math.cos(a) * d + "px");
    s.style.setProperty("--dy", Math.sin(a) * d + "px");
    if (seven) s.style.background = ["#ff5a5a", "#ffe14d", "#5ad1ff", "#fff"][i % 4];
    $("burst").appendChild(s);
  }
  if (!resumed) (seven ? SE.seven : SE.win)();

  hideLastInHistory = false;
  renderHistory();
  msg(`${last.n}回目：${PRIZE_NAMES[last.prize]}！`, "gold");
  busy = true;
  updateControls();
  clearTimeout(tapGuardTimer);
  tapGuardTimer = setTimeout(() => {
    if ($("burst").classList.contains("on")) $("tapcatch").classList.add("on");
  }, resumed ? 0 : TAP_GUARD_MS);
}

function closeResult() {
  if (!$("tapcatch").classList.contains("on")) return;   // 当選表示が出てすぐ（0.6秒以内）は閉じない
  clearTimeout(tapGuardTimer);
  $("tapcatch").classList.remove("on");
  $("burst").classList.remove("on");
  $("cabinet").classList.remove("win");   // ランプは通常の点滅に戻す（揃ったラインの線は次に回すまで残す）
  busy = false;
  const next = markRevealed(data);
  try {
    saveData(storage, next);
    data = next;
    idleMessage();
  } catch (e) {
    // 結果そのものは保存済み。表示済みの印だけ保存できなかった（次に開いたとき、もう一度結果が表示されるだけ）
    console.warn(e);
    msg("表示済みの記録を保存できませんでした（結果は保存されています）", "error");
  }
  updateControls();
}

/* =========================================================
   説明の枠（エラー時）
   ========================================================= */
function showDialog({ title, body, actions = [] }) {
  $("dlgTitle").textContent = title;
  $("dlgBody").innerHTML = body.map((p) => `<p>${p}</p>`).join("");
  $("dlgActions").innerHTML = "";
  for (const a of actions) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = a.label;
    b.dataset.act = a.id;
    if (a.kind) b.className = a.kind;
    b.addEventListener("click", a.onClick);
    $("dlgActions").appendChild(b);
  }
  $("dialog").hidden = false;
}
function hideDialog() { $("dialog").hidden = true; }

const reloadAction = { id: "reload", label: "再読み込み", kind: "primary", onClick: () => location.reload() };

function showStartupError(e) {
  const code = e instanceof StorageError ? e.code : "unknown";
  const resetAction = (kind, double) => ({
    id: "reset", label: "リセットして最初からやり直す", kind,
    onClick: () => onReset({ double }),
  });
  if (code === "corrupt") {
    showDialog({
      title: "保存データが壊れています",
      body: [
        "前回までの抽選の記録を読み込めませんでした。",
        "壊れたデータは消さずに、端末の中の別の場所に残してあります。",
        "リセットすると、最初の状態（当たり11・大当たり6・特大当たり3・ラッキーセブン1）からやり直せます。",
      ],
      actions: [resetAction("primary", false)],
    });
  } else if (code === "newer-version") {
    showDialog({
      title: "新しい版のアプリのデータです",
      body: [
        "このデータは、より新しい版のアプリで保存されています。",
        "再読み込みしてアプリを最新にしてください。",
        "リセットすると、これまでの記録は消えます。",
      ],
      actions: [reloadAction, resetAction("danger", true)],
    });
  } else if (code === "no-storage") {
    showDialog({
      title: "この端末では記録を保存できません",
      body: [
        "抽選の記録を端末に保存できないため、アプリを使えません。",
        "Safariの「プライベートブラウズ」をやめるか、「設定」→「Safari」で「すべてのCookieをブロック」をオフにしてから、もう一度開いてください。",
      ],
      actions: [reloadAction],
    });
  } else {
    showDialog({
      title: "保存データを読み込めませんでした",
      body: ["一時的な問題かもしれません。再読み込みしてください。", `（${errorText(e)}）`],
      actions: [reloadAction, resetAction("danger", true)],
    });
  }
}

/* =========================================================
   操作
   ========================================================= */
function onStart() {
  if (busy || !data || isFinished(data.lottery)) return;
  ensureAudio();

  let r;
  try {
    r = drawAndSave(storage, data);   // 抽選・盤面・保存。保存できたときだけ先へ進む
  } catch (e) {
    console.error(e);
    msg(errorText(e), "error");
    return;
  }
  data = r.data;
  busy = true;
  updateControls();
  clearEffects();
  hideLastInHistory = true;          // 右リールが止まるまで、今回の結果は履歴に出さない
  renderHistory();
  msg("回転中…");
  SE.start();

  const T = SPEED_TIMES[data.settings.speed] || SPEED_TIMES.normal;
  const grid = r.board.grid;
  const col = (c) => [0, 1, 2].map((row) => grid[row][c]);
  for (let c = 0; c < 3; c++) startSpin(c);
  setTimeout(() => stopSpin(0, col(0)), T[0]);
  setTimeout(() => stopSpin(1, col(1), () => showReach(r.board.reachLines)), T[1]);
  setTimeout(() => stopSpin(2, col(2), () => {
    shownGrid = grid;
    $("overlay").innerHTML = "";
    document.querySelectorAll(".mark.reach").forEach((m) => m.classList.remove("reach"));
    // まず揃ったラインの枠と線を出し、少し間をおいてから景品名などを出す（その間もSTARTやリセットは押せない）
    showWinLine(data.last);
    setTimeout(() => showResult(data.last), RESULT_DELAY[data.settings.speed] ?? RESULT_DELAY.normal);
  }), T[2]);
}

function onReset({ double = false } = {}) {
  if (busy || !storage) return;
  if (!confirm("抽選回数・残数・履歴を最初の状態に戻します。\nよろしいですか？")) return;
  if (double && !confirm("これまでの記録は元に戻せません。\n本当にリセットしますか？")) return;
  const next = resetData(data || createInitialData());
  try {
    saveData(storage, next);
  } catch (e) {
    console.error(e);
    msg(errorText(e), "error");
    return;
  }
  data = next;
  hideDialog();
  clearEffects();
  showGrid(START_GRID);
  renderSettings();
  renderHistory();
  idleMessage();
  updateControls();
}

function changeSettings(patch) {
  if (!data) return false;
  const next = updateSettings(data, patch);
  try {
    saveData(storage, next);
  } catch (e) {
    console.error(e);
    msg("設定を保存できませんでした", "error");
    return false;
  }
  data = next;
  renderSettings();
  return true;
}

function onSound() {
  if (!data) return;
  if (changeSettings({ sound: !data.settings.sound })) ensureAudio();
}

function onSpeed(e) {
  const b = e.target.closest("button[data-speed]");
  if (!b || busy || !data) return;
  changeSettings({ speed: b.dataset.speed });
}

/* =========================================================
   オフライン対応（sw.js の登録と、準備ランプ）
   ========================================================= */
function setOfflineLamp(state, html) {
  $("offline").dataset.state = state;
  $("offline").querySelector("span").innerHTML = html;
}
function setupOffline() {
  // HTTPS（または localhost）でないと Service Worker は使えない（例：iPhone から http://192.168.x.x で開いたとき）
  if (!("serviceWorker" in navigator) || !window.isSecureContext) {
    setOfflineLamp("off", "オフライン<br>不可");
    return;
  }
  setOfflineLamp("wait", "準備中");
  // active になった＝アプリのファイルが全部端末に保存できた
  navigator.serviceWorker.ready.then(() => setOfflineLamp("ok", "オフライン<br>OK"));
  navigator.serviceWorker.register("sw.js").catch((e) => {
    console.warn("オフラインの準備に失敗しました", e);
    setOfflineLamp("off", "オフライン<br>準備失敗");
  });
  // 端末の空きが少ないときに保存データを消されにくくする（対応していない端末では何もしない）
  try { navigator.storage?.persist?.().catch(() => {}); } catch { /* 何もしない */ }
}

/* =========================================================
   起動
   ========================================================= */
function buildLamps() {
  for (const [id, n] of [["lampsT", 16], ["lampsB", 16], ["lampsL", 14], ["lampsR", 14]]) {
    $(id).innerHTML = '<i class="lamp"></i>'.repeat(n);
  }
}

function init() {
  setupOffline();
  buildLamps();
  buildReels();
  showGrid(START_GRID);
  placeMarks();
  renderSettings();
  renderHistory();
  updateControls();

  $("start").addEventListener("click", onStart);
  $("reset").addEventListener("click", () => onReset());
  $("sound").addEventListener("click", onSound);
  document.querySelector(".seg").addEventListener("click", onSpeed);
  $("tapcatch").addEventListener("click", closeResult);
  window.addEventListener("resize", () => {
    if (busy) return;
    buildReels(); showGrid(shownGrid); placeMarks();
  });

  try {
    storage = window.localStorage;
    const probe = "slokuji.probe";
    storage.setItem(probe, "1");
    storage.removeItem(probe);
  } catch (e) {
    console.error(e);
    storage = null;
    msg("記録を保存できません", "error");
    updateControls();
    showStartupError(new StorageError("no-storage", "localStorage が使えません", e));
    return;
  }

  try {
    data = loadData(storage).data;
  } catch (e) {
    console.error(e);
    data = null;
    msg(errorText(e), "error");
    updateControls();
    showStartupError(e);
    return;
  }

  renderSettings();
  // 盤面の一覧づくり（約0.2秒）は、画面を一度表示してから行う
  setTimeout(() => {
    const t0 = performance.now();
    getBoardTable();
    console.info(`盤面の一覧を作りました：${Math.round(performance.now() - t0)} ms`);

    if (data.last) showGrid(data.last.grid);
    renderHistory();
    if (data.last && !data.last.revealed) {
      showResult(data.last, { resumed: true });   // 前回、結果を表示している途中で閉じられた
    } else {
      idleMessage();
      updateControls();
    }
  }, 30);
}

init();
