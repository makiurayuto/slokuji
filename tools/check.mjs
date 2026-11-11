// ブラウザでの総点検（npm run check）
// PCの Edge を画面なしで起動し、iPhone と同じ画面サイズでアプリを操作して確かめる。
// 外部の部品は使わない（Node.js の WebSocket と fetch、Edge の DevTools プロトコルだけ）。
// ※ iPhone の Safari そのものでの確認ではない。

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInitialData, drawAndSave, saveData, markRevealed, STORAGE_KEY, BACKUP_KEY } from "../logic/storage.js";
import { launchEdge, sleep } from "./cdp.mjs";
import { readSwFiles } from "./sw-files.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_PORT = 8099;
const APP_URL = `http://localhost:${APP_PORT}/`;
const SHOT_DIR = path.join(os.tmpdir(), "slokuji-check");
fs.rmSync(SHOT_DIR, { recursive: true, force: true });

/* ---------- 保存データを作る（16回引いた状態など） ---------- */
class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}
/** n回引いた保存データ。unrevealed=true なら最後の結果を「表示前」にしておく。prize を指定すると最後がその景品になるまで作り直す */
function savedAfter(n, { settings, unrevealed = false, lastPrize } = {}) {
  for (let tries = 0; tries < 500; tries++) {
    const st = new MemoryStorage();
    let d = createInitialData(settings);
    for (let i = 0; i < n; i++) d = saveData(st, markRevealed(drawAndSave(st, d).data));
    if (lastPrize && d.last?.prize !== lastPrize) continue;
    if (unrevealed && d.last) d = { ...d, last: { ...d.last, revealed: false } };
    return JSON.stringify(d);
  }
  throw new Error(`最後が ${lastPrize} の保存データを作れませんでした`);
}

/* ---------- サーバー ---------- */
let server = null;
async function startServer(root = ROOT) {
  server = spawn(process.execPath, [path.join(root, "tools", "serve.js")], { env: { ...process.env, PORT: String(APP_PORT) }, stdio: "ignore" });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(APP_URL)).ok) return; } catch { /* 起動中 */ } await sleep(100); }
  throw new Error("確認用サーバーが起動しませんでした");
}
async function stopServer() {
  if (!server) return;
  const s = server; server = null;
  s.kill();
  for (let i = 0; i < 50; i++) { try { await fetch(APP_URL); } catch { return; } await sleep(100); }
}
/** 「新しい版のアプリ」を一時フォルダに作る（中身は同じで、版の番号だけ変える） */
function makeUpdatedCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slokuji-update-"));
  const copy = (f) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.copyFileSync(path.join(ROOT, f), path.join(dir, f)); };
  readSwFiles().filter((f) => f !== "./").forEach(copy);
  copy("tools/serve.js");
  copy("package.json");
  const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8").replace(/const VERSION = "[^"]*";/, 'const VERSION = "update-test";');
  fs.writeFileSync(path.join(dir, "sw.js"), sw);
  return dir;
}

/* ---------- ブラウザ ---------- */
const edge = await launchEdge({ port: 9334 });
const { send, js, waitFor } = edge;
const exceptions = [];
let dialogAnswers = [];
let dialogsSeen = [];
edge.on((msg) => {
  if (msg.method === "Runtime.exceptionThrown") exceptions.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  if (msg.method === "Page.javascriptDialogOpening") {
    dialogsSeen.push(msg.params.message);
    send("Page.handleJavaScriptDialog", { accept: dialogAnswers.length ? dialogAnswers.shift() : false }).catch(() => {});
  }
});
async function setupPage(width = 390, height = 844) {
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: true });
}
const shot = (name) => edge.screenshot(path.join(SHOT_DIR, name + ".png"));
const click = (sel) => js(`document.querySelector(${JSON.stringify(sel)}).click()`);
const ready = `document.readyState === "complete" && document.getElementById("msg").textContent !== "準備中…"`;
async function navigate(url) { await send("Page.navigate", { url }); if (url.startsWith("http")) { await waitFor(ready, 8000); await sleep(200); } }
async function reload() { await send("Page.reload"); await waitFor(ready, 8000); await sleep(200); }
async function open({ saved } = {}) {
  await navigate(APP_URL);
  await js(`localStorage.clear()`);
  if (saved !== undefined) await js(`localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, ${JSON.stringify(saved)})`);
  await reload();
}
const S = () => js(`(() => {
  const raw = localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
  let d = null; try { d = JSON.parse(raw); } catch {}
  const $ = (id) => document.getElementById(id);
  return {
    msg: $("msg").textContent, startDisabled: $("start").disabled, resetDisabled: $("reset").disabled,
    spinning: document.querySelectorAll(".reel.spinning").length,
    burst: $("burst").classList.contains("on"), tapcatch: $("tapcatch").classList.contains("on"),
    dialog: !$("dialog").hidden, dialogTitle: $("dlgTitle").textContent,
    histCount: $("hist").querySelectorAll("li:not(.empty)").length,
    speed: document.querySelector(".seg button.on")?.dataset.speed,
    offline: $("offline").dataset.state,
    drawn: d?.lottery?.drawn ?? null, remain: d?.lottery?.remain ?? null, history: d?.history ?? null,
    last: d?.last ? { n: d.last.n, prize: d.last.prize, revealed: d.last.revealed } : null,
    backup: localStorage.getItem(${JSON.stringify(BACKUP_KEY)}),
  };
})()`);
const breakSaving = () => js(`window.__set = Storage.prototype.setItem; Storage.prototype.setItem = function () { throw new DOMException("quota exceeded", "QuotaExceededError"); }`);
const fixSaving = () => js(`Storage.prototype.setItem = window.__set`);
const resultShown = `document.getElementById("tapcatch").classList.contains("on")`;
const swVersion = () => js(`new Promise((res) => {
  const c = navigator.serviceWorker.controller; if (!c) return res(null);
  const ch = new MessageChannel(); ch.port1.onmessage = (e) => res(e.data); c.postMessage("version", [ch.port2]);
  setTimeout(() => res("応答なし"), 2000);
})`);

/* ---------- 確かめる場面 ---------- */
const results = [];
async function scenario(name, fn) {
  dialogAnswers = []; dialogsSeen = [];
  const checks = [];
  const expect = (ok, what) => checks.push({ ok: !!ok, what });
  try { await fn(expect); } catch (e) { checks.push({ ok: false, what: "途中で失敗: " + e.message }); }
  results.push({ name, checks });
}

try {
  await startServer();
  await setupPage();

  await scenario("1. 連打しても1回しか引かれない", async (expect) => {
    await open();
    await js(`(() => { const b = document.getElementById("start"); for (let i = 0; i < 10; i++) b.click(); })()`);
    await sleep(100);
    let s = await S();
    expect(s.drawn === 1, `START 10連打で1回だけ引かれる（引いた回数 ${s.drawn}）`);
    await click('.seg button[data-speed="fast"]');
    expect((await S()).speed === "normal", "回転中は速さを変えられない");
    await waitFor(`document.getElementById("burst").classList.contains("on")`);
    for (let i = 0; i < 5; i++) await click("#tapcatch");
    expect((await S()).burst, "当選表示が出て0.6秒以内のタップでは閉じない");
    await waitFor(resultShown);
    await js(`(() => { const t = document.getElementById("tapcatch"); for (let i = 0; i < 5; i++) t.click(); document.getElementById("start").click(); })()`);
    await sleep(100);
    s = await S();
    expect(s.drawn === 2, `閉じるタップの連打の直後にSTARTを押しても、引くのは次の1回だけ（引いた回数 ${s.drawn}）`);
  });

  await scenario("2. 回転中・当選表示中はリセットできない", async (expect) => {
    await open();
    await click("#start");
    await sleep(100);
    dialogAnswers = [true, true];
    await click("#reset");
    await sleep(100);
    let s = await S();
    expect(s.resetDisabled && dialogsSeen.length === 0 && s.drawn === 1, "回転中：リセットボタンは押せず、確認も出ない");
    await waitFor(resultShown);
    await click("#reset");
    await sleep(100);
    s = await S();
    expect(s.resetDisabled && dialogsSeen.length === 0 && s.drawn === 1, "当選表示中：リセットボタンは押せず、確認も出ない");
  });

  await scenario("3. 17回目の途中で再読み込みしても、7は1回だけ", async (expect) => {
    await open({ saved: savedAfter(16) });
    await click("#start");
    await sleep(300);
    await reload();
    let s = await S();
    expect(s.burst && s.last.n === 17 && s.last.prize === "seven", "再読み込み後、17回目のラッキーセブンがすぐ表示される");
    expect(s.drawn === 17 && s.remain.seven === 0, "回数は17、7の残りは0");
    expect(s.history.filter((h) => h.prize === "seven").length === 1, "履歴の7は1回だけ");
    await shot("17回目の再開");
    await click("#tapcatch");
    await click("#start");
    await sleep(100);
    s = await S();
    expect(s.last.n === 18 && s.last.prize !== "seven", `次に引くのは18回目で、7ではない（${s.last.n}回目 ${s.last.prize}）`);
  });

  await scenario("4. 21回目の途中で再読み込みしたら、結果を表示してから「終了」", async (expect) => {
    await open({ saved: savedAfter(20) });
    await click("#start");
    await sleep(300);
    await reload();
    let s = await S();
    expect(s.burst && s.last.n === 21 && !s.last.revealed, "再読み込み後、21回目の結果がすぐ表示される");
    await click("#tapcatch");
    await sleep(100);
    s = await S();
    expect(s.msg === "終了" && s.startDisabled, `閉じると「終了」になり、STARTは押せない（${s.msg}）`);
    const c = { tou: 0, dai: 0, toku: 0, seven: 0 };
    s.history.forEach((h) => c[h.prize]++);
    expect(c.tou === 11 && c.dai === 6 && c.toku === 3 && c.seven === 1, `合計は 当11・大6・特3・7が1（${JSON.stringify(c)}）`);
    await click("#start");
    await sleep(100);
    expect((await S()).drawn === 21, "終了後にSTARTを押しても22回目は引かれない");
  });

  await scenario("5. 保存に失敗したら抽選しない／次は普通に引ける", async (expect) => {
    await open({ saved: savedAfter(3) });
    await breakSaving();
    await click("#start");
    await sleep(150);
    let s = await S();
    expect(s.msg.includes("保存できなかった"), `エラーが表示される（${s.msg}）`);
    expect(s.drawn === 3 && s.spinning === 0 && !s.startDisabled, "回数は増えず、リールも回らず、STARTはまた押せる");
    await shot("保存失敗");
    await fixSaving();
    await click("#start");
    await sleep(100);
    s = await S();
    expect(s.drawn === 4 && s.last.n === 4, "保存できるようになったら、次は4回目として普通に引ける");
  });

  await scenario("6. 表示済みの記録が保存できなくても、結果は失われない", async (expect) => {
    await open();
    await click("#start");
    await waitFor(resultShown);
    await breakSaving();
    await click("#tapcatch");
    await sleep(100);
    let s = await S();
    expect(s.msg.includes("表示済み"), `控えめにエラーが出る（${s.msg}）`);
    await fixSaving();
    await reload();
    s = await S();
    expect(s.burst && s.drawn === 1 && s.last.n === 1, "開き直すと、同じ1回目の結果がもう一度表示される（引き直しではない）");
  });

  await scenario("7. 壊れたデータ：説明の枠が出て、消さずに退避し、リセットで直る", async (expect) => {
    await open({ saved: "{こわれたデータ" });
    let s = await S();
    expect(s.dialog && s.dialogTitle === "保存データが壊れています", `説明の枠が出る（${s.dialogTitle}）`);
    expect(s.startDisabled, "STARTは押せない");
    expect(s.backup === "{こわれたデータ", "壊れたデータは別の場所に残っている");
    await shot("壊れたデータ");
    dialogAnswers = [false];
    await click('#dlgActions button[data-act="reset"]');
    await sleep(100);
    s = await S();
    expect(s.dialog && s.drawn === null, "確認で「キャンセル」なら何も変わらない");
    dialogAnswers = [true];
    await click('#dlgActions button[data-act="reset"]');
    await sleep(100);
    s = await S();
    expect(!s.dialog && s.drawn === 0 && !s.startDisabled, "確認で「OK」なら最初の状態に戻り、引けるようになる");
    expect(s.backup === "{こわれたデータ", "リセット後も退避したデータは残っている");
  });

  await scenario("8. 新しい版のデータ：リセットは2回確認", async (expect) => {
    const newer = JSON.parse(savedAfter(2)); newer.version = 2;
    await open({ saved: JSON.stringify(newer) });
    let s = await S();
    expect(s.dialog && s.dialogTitle.includes("新しい版"), `説明の枠が出る（${s.dialogTitle}）`);
    dialogAnswers = [true, false];
    await click('#dlgActions button[data-act="reset"]');
    await sleep(100);
    s = await S();
    expect(dialogsSeen.length === 2 && s.dialog && JSON.parse(await js(`localStorage.getItem("slokuji")`)).version === 2, "2回目の確認で「キャンセル」ならデータはそのまま");
    dialogAnswers = [true, true];
    await click('#dlgActions button[data-act="reset"]');
    await sleep(100);
    s = await S();
    expect(!s.dialog && s.drawn === 0, "2回とも「OK」でリセットされる");
  });

  await scenario("9. リセットの確認（キャンセル／OK）と設定の引き継ぎ", async (expect) => {
    await open({ saved: savedAfter(5, { settings: { speed: "slow", sound: true } }) });
    dialogAnswers = [false];
    await click("#reset");
    await sleep(100);
    let s = await S();
    expect(dialogsSeen.length === 1 && s.drawn === 5, "「キャンセル」なら何も変わらない");
    dialogAnswers = [true];
    await click("#reset");
    await sleep(100);
    s = await S();
    expect(s.drawn === 0 && s.histCount === 0 && s.msg === "スタートを押してください", "「OK」なら回数・履歴が最初に戻る");
    expect(s.speed === "slow" && (await js(`JSON.parse(localStorage.getItem("slokuji")).settings.sound`)) === true, "速さと音の設定は残る");
    await reload();
    s = await S();
    expect(s.drawn === 0 && s.speed === "slow", "再読み込みしても、リセット後の状態のまま");
  });

  await scenario("10. 画面サイズ：iPhone SE〜大きいiPhoneで見切れない", async (expect) => {
    const sizes = [[320, 568, "iPhone SE（初代）"], [375, 667, "iPhone SE（第2・3世代）"], [390, 844, "iPhone 標準"], [430, 932, "iPhone Pro Max"]];
    const results7 = savedAfter(17, { unrevealed: true });
    const resultsToku = savedAfter(5, { unrevealed: true, lastPrize: "toku" });
    for (const [w, h, label] of sizes) {
      await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: true });
      await open();
      const m = await js(`(() => {
        const r = (sel) => document.querySelector(sel).getBoundingClientRect();
        const over = (sel) => { const e = document.querySelector(sel); return e.scrollWidth > e.clientWidth + 1; };
        return { pageOver: document.documentElement.scrollWidth > innerWidth + 1, startBottom: r("#start").bottom, h: innerHeight,
          titleOver: over(".topper .title"), msgOver: over("#msg"), segRight: r(".seg").right, w: innerWidth,
          titleLeft: r(".topper .title").left, lampRight: r("#offline").right, reelsRight: r("#reels").right };
      })()`);
      expect(!m.pageOver && !m.titleOver && !m.msgOver && m.segRight <= m.w && m.reelsRight <= m.w, `${label} ${w}×${h}：横にはみ出す部品がない`);
      expect(m.startBottom <= m.h, `${label}：STARTボタンがスクロールなしで押せる位置にある（下端 ${Math.round(m.startBottom)} / 画面 ${m.h}）`);
      expect(m.lampRight <= m.titleLeft, `${label}：オフラインのランプが看板の文字に重ならない`);
      if (w === 320) await shot("画面サイズ_320x568");
      for (const [saved, name] of [[resultsToku, "特大当たり"], [results7, "ラッキーセブン"]]) {
        await open({ saved });
        const lb = await js(`(() => { const b = document.getElementById("burstLabel").getBoundingClientRect(); return { l: b.left, r: b.right, w: innerWidth }; })()`);
        expect(lb.l >= 0 && lb.r <= lb.w, `${label}：「${name}！」の表示が画面からはみ出さない`);
        if (w === 320 && name === "特大当たり") await shot("画面サイズ_320_特大当たり");
      }
    }
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  });

  await scenario("11. 効果音が鳴らせなくても、抽選は止まらない", async (expect) => {
    const variants = [
      ["音の機能そのものが無い", `window.AudioContext = undefined; window.webkitAudioContext = undefined;`],
      ["音の機能を作るとエラーになる", `window.AudioContext = function () { throw new Error("no audio"); }; window.webkitAudioContext = window.AudioContext;`],
      ["音を鳴らすとエラーになる", `window.AudioContext = function () { return { state: "running", resume() {}, currentTime: 0, destination: {}, createOscillator() { throw new Error("no osc"); }, createGain() { throw new Error("no gain"); } }; };`],
    ];
    for (const [name, src] of variants) {
      const { identifier } = await send("Page.addScriptToEvaluateOnNewDocument", { source: src });
      await open({ saved: savedAfter(0, { settings: { speed: "fast", sound: true } }) });
      await click("#start");
      await waitFor(resultShown, 5000).catch(() => {});
      const s = await S();
      expect(s.drawn === 1 && s.burst, `${name}：音ONでも普通に引けて結果が出る`);
      await send("Page.removeScriptToEvaluateOnNewDocument", { identifier });
    }
  });

  await scenario("11b. 右リールが止まってから、少し間をおいて当選表示が出る", async (expect) => {
    // 右リールが止まり始める時間 + 止まりきるまで0.3秒 + ため
    const plan = { slow: [1900, 400], normal: [1100, 400], fast: [560, 200] };
    for (const [speed, [stop, delay]] of Object.entries(plan)) {
      await open({ saved: savedAfter(0, { settings: { speed, sound: false } }) });
      const landed = stop + 300, expected = landed + delay;
      const ms = await js(`new Promise((res) => {
        const b = document.getElementById("burst");
        const mo = new MutationObserver(() => { if (b.classList.contains("on")) { mo.disconnect(); res(Math.round(performance.now() - t0)); } });
        mo.observe(b, { attributes: true });
        const t0 = performance.now();
        document.getElementById("start").click();
        setTimeout(() => res(-1), 6000);
      })`);
      expect(ms >= expected - 40 && ms <= expected + 300,
        `${speed === "slow" ? "遅い" : speed === "normal" ? "普通" : "速い"}：止まりきってから約${delay / 1000}秒後に表示（START から ${ms}ms、目安 ${expected}ms、止まりきるのは ${landed}ms）`);
    }
  });

  await scenario("12. アプリを更新しても記録は消えず、新しい版は次に開いたときに反映", async (expect) => {
    await open({ saved: savedAfter(3) });
    await waitFor(`document.getElementById("offline").dataset.state === "ok"`, 10000);
    await waitFor(`!!navigator.serviceWorker.controller`, 5000);
    const before = await swVersion();
    // 新しい版を同じアドレスで出す
    await stopServer();
    const dir = makeUpdatedCopy();
    await startServer(dir);
    await reload();
    await js(`navigator.serviceWorker.getRegistration().then((r) => r && r.update())`);
    await waitFor(`navigator.serviceWorker.getRegistration().then((r) => !!(r && r.waiting))`, 10000);
    let s = await S();
    expect((await swVersion()) === before, `使っている最中は前の版のまま（${before}）`);
    expect(s.drawn === 3, "新しい版を受け取っても、記録は3回のまま");
    // アプリを閉じて開き直す
    await navigate("about:blank");
    await sleep(800);
    await navigate(APP_URL);
    await waitFor(`!!navigator.serviceWorker.controller`, 5000);
    let v = null;
    for (let i = 0; i < 40 && v !== "update-test"; i++) { v = await swVersion(); if (v !== "update-test") await sleep(100); }
    expect(v === "update-test", `開き直すと新しい版になる（${v}）`);
    s = await S();
    expect(s.drawn === 3 && s.history.length === 3, "更新後も記録は3回のまま");
    const keys = await js(`caches.keys()`);
    expect(keys.length === 1 && keys[0] === "slokuji-update-test", `古い版のファイルは片付けられる（${keys.join(", ")}）`);
    expect(s.offline === "ok", "更新後もオフラインの準備はできている");
    globalThis.__updatedDir = dir;
  });

  await scenario("13. 電波がなくても開けて、引ける", async (expect) => {
    await open({ saved: savedAfter(4) });
    await waitFor(`document.getElementById("offline").dataset.state === "ok"`, 10000);
    await shot("オフライン準備完了");
    await stopServer();                                   // サーバーを止める＝電波がない状態
    let reachable = true;
    try { await fetch(APP_URL); } catch { reachable = false; }
    expect(!reachable, "サーバーに届かない状態になっている");
    await navigate("about:blank");
    await sleep(300);
    await navigate(APP_URL);                              // 開き直す
    let s = await S();
    expect(s.msg !== "" && s.drawn === 4 && s.offline === "ok", "電波なしでも開けて、記録も読み込める");
    const imgs = await js(`Promise.all(["assets/tou.png", "assets/dai.png", "assets/toku.png", "assets/seven.png", "assets/icon-180.png"]
      .map((u) => fetch(u).then((r) => r.ok && r.headers.get("content-type") === "image/png").catch(() => false)))`);
    expect(imgs.every(Boolean), `電波なしでも、絵柄4枚とアイコンを端末から取り出せる（${imgs.join(",")}）`);
    await click("#start");
    await waitFor(resultShown, 5000);
    s = await S();
    expect(s.drawn === 5 && s.burst, "電波なしでも5回目を引けて、結果が出る");
    await shot("オフラインで抽選");
    await click("#tapcatch");
    await reload();
    s = await S();
    expect(s.drawn === 5, "電波なしで再読み込みしても、記録は5回のまま");
  });

  await scenario("14. ページ内で予期しないエラーが起きていない", async (expect) => {
    expect(exceptions.length === 0, exceptions.length ? exceptions.join(" / ") : "エラーなし");
  });
} catch (e) {
  results.push({ name: "点検の準備", checks: [{ ok: false, what: String(e.stack || e) }] });
} finally {
  await edge.close();
  await stopServer();
  if (globalThis.__updatedDir) { try { fs.rmSync(globalThis.__updatedDir, { recursive: true, force: true }); } catch { /* 消せなくてもよい */ } }
}

let fails = 0, total = 0;
for (const r of results) {
  console.log(`\n${r.name}`);
  for (const c of r.checks) { total++; console.log(`  ${c.ok ? "✔" : "✖"} ${c.what}`); if (!c.ok) fails++; }
}
console.log(`\n${fails === 0 ? `すべて成功（${total}項目）` : `${fails}件 失敗（全${total}項目）`}（画面の写真: ${SHOT_DIR}）`);
process.exit(fails === 0 ? 0 : 1);
