// ホーム画面用アイコンを作る（npm run icons）
// 「7」の絵柄（写真の切り抜き）を赤い背景に置き、Edge で描いて PNG に書き出す。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tileSVG } from "../tiles.js";
import { launchEdge } from "./cdp.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const seven = "data:image/png;base64," + fs.readFileSync(path.join(ROOT, "assets", "seven.png")).toString("base64");

// maskable：Android などで丸く切り抜かれても欠けないよう、絵柄を中央の安全な範囲に小さめに置く
function iconSVG(size, maskable) {
  const t = maskable ? 52 : 68;          // 絵柄の大きさ（全体を100としたとき）
  const o = (100 - t) / 2;
  const rays = Array.from({ length: 12 }, (_, i) => {
    const a = (i * 30 - 90) * Math.PI / 180, w = 4 * Math.PI / 180, r = 90;
    const p = (ang) => `${50 + r * Math.cos(ang)},${50 + r * Math.sin(ang)}`;
    return `<polygon points="50,50 ${p(a - w)} ${p(a + w)}" fill="#ffd54a" opacity=".16"/>`;
  }).join("");
  const tile = tileSVG("seven", seven).replace("<svg ", `<svg x="${o}" y="${o}" width="${t}" height="${t}" `);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}">
    <defs>
      <radialGradient id="bg" cx=".5" cy=".45" r=".75"><stop offset="0" stop-color="#d4142f"/><stop offset=".6" stop-color="#8f0f1d"/><stop offset="1" stop-color="#3a050c"/></radialGradient>
      <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1b8"/><stop offset=".5" stop-color="#e0a91c"/><stop offset="1" stop-color="#8a5d00"/></linearGradient>
      <filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="1.5" stdDeviation="1.5" flood-opacity=".55"/></filter>
    </defs>
    <rect width="100" height="100" fill="url(#bg)"/>${rays}
    <rect x="${o - 2.6}" y="${o - 2.6}" width="${t + 5.2}" height="${t + 5.2}" rx="3" fill="url(#rim)" filter="url(#sh)"/>
    ${tile}
  </svg>`;
}

const OUTPUTS = [
  { file: "icon-180.png", size: 180, maskable: false },   // iPhone のホーム画面
  { file: "icon-192.png", size: 192, maskable: false },
  { file: "icon-512.png", size: 512, maskable: false },
  { file: "icon-maskable-512.png", size: 512, maskable: true },
];

const edge = await launchEdge({ port: 9335, width: 600, height: 600 });
try {
  await edge.send("Page.enable");
  const { frameTree } = await edge.send("Page.getFrameTree");
  for (const o of OUTPUTS) {
    await edge.send("Emulation.setDeviceMetricsOverride", { width: o.size, height: o.size, deviceScaleFactor: 1, mobile: false });
    await edge.send("Page.setDocumentContent", {
      frameId: frameTree.frame.id,
      html: `<!doctype html><html><body style="margin:0;background:#000;overflow:hidden">${iconSVG(o.size, o.maskable)}</body></html>`,
    });
    await edge.waitFor(`[...document.images].length === 0 && document.querySelector("image") !== null`);
    await new Promise((r) => setTimeout(r, 300));   // 埋め込み画像の描画を待つ
    const out = path.join(ROOT, "assets", o.file);
    await edge.screenshot(out, { x: 0, y: 0, width: o.size, height: o.size });
    console.log(`作成: assets/${o.file}（${o.size}×${o.size}）`);
  }
} finally {
  await edge.close();
}
