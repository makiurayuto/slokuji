// Edge を画面なしで起動して操作する小さな部品（外部の部品なし）。
// tools/check.mjs（総点検）と tools/make-icons.mjs（アイコン作り）で使う。

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findEdge() {
  return [
    process.env.EDGE_PATH,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ].find((p) => p && fs.existsSync(p));
}

/**
 * Edge を起動して、最初のタブにつなぐ。
 * @returns ブラウザ操作の道具（send, js, screenshot, openNewTab, close など）
 */
export async function launchEdge({ port = 9334, width = 390, height = 844 } = {}) {
  const exe = findEdge();
  if (!exe) throw new Error("Microsoft Edge が見つかりません（EDGE_PATH で場所を指定できます）");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "slokuji-edge-"));
  const proc = spawn(exe, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    "--no-first-run", "--no-default-browser-check", `--window-size=${width},${height}`, "about:blank"], { stdio: "ignore" });

  const listeners = new Set();
  let ws = null, targetId = null, msgId = 0;
  const pending = new Map();

  async function attach(target) {
    if (ws) { try { ws.close(); } catch { /* 閉じるだけ */ } }
    targetId = target.id;
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.addEventListener("open", r, { once: true }); ws.addEventListener("error", j, { once: true }); });
    ws.addEventListener("message", (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
      if (msg.method) listeners.forEach((fn) => fn(msg));
    });
  }
  const list = async () => (await fetch(`http://127.0.0.1:${port}/json`)).json();

  for (let i = 0; i < 100 && !ws; i++) {
    try { const page = (await list()).find((t) => t.type === "page"); if (page) await attach(page); } catch { /* 起動中 */ }
    if (!ws) await sleep(200);
  }
  if (!ws) { proc.kill(); throw new Error("Edge に接続できませんでした"); }

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const i = ++msgId;
      pending.set(i, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  }
  async function js(expr) {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error("ページ内のエラー: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
  async function screenshot(file, clip) {
    const r = await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(r.data, "base64"));
  }
  async function waitFor(expr, ms = 5000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { try { if (await js(expr)) return true; } catch { /* 読み込み中 */ } await sleep(50); }
    throw new Error(`待っても条件を満たしませんでした: ${expr}`);
  }
  /** 新しいタブを開いてそちらにつなぎ直し、元のタブは閉じる（アプリを閉じて開き直す代わり） */
  async function openNewTab(url = "about:blank") {
    const old = targetId;
    const res = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
    const target = await res.json();
    await attach(target);
    await fetch(`http://127.0.0.1:${port}/json/close/${old}`);
  }
  async function close() {
    try { ws.close(); } catch { /* 閉じるだけ */ }
    proc.kill();
    await sleep(500);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 消せなくてもよい */ }
  }
  return { send, js, screenshot, waitFor, openNewTab, close, on: (fn) => listeners.add(fn) };
}
