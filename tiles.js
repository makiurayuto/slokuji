// 絵柄（写真から切り抜いた文字＋枠・波・王冠などの飾り）を SVG の文字列で作る。
// アプリ本体（app.js）とアイコン作り（tools/make-icons.mjs）の両方で使う。

import { PRIZE_NAMES } from "./logic/lottery.js";

function corners(color) {
  const s = `fill="none" stroke="${color}" stroke-width="2.2"`;
  return `<path ${s} d="M7 19 H12 V12 H19 V7"/><path ${s} d="M93 19 H88 V12 H81 V7"/><path ${s} d="M7 81 H12 V88 H19 V93"/><path ${s} d="M93 81 H88 V88 H81 V93"/>`;
}
function waves(color) {
  const one = (cx) => `<circle cx="${cx}" cy="94" r="10.6" fill="#fff"/>` +
    [10, 6.6, 3.2].map((r) => `<circle cx="${cx}" cy="94" r="${r}" fill="none" stroke="${color}" stroke-width="1.3"/>`).join("");
  // 枠の外にはみ出す部分は白で隠す
  return one(33) + one(67) + one(50) + `<rect x="0" y="95.5" width="100" height="4.5" fill="#fff"/>`;
}
function rays(color) {
  return [[-30, 13, -26, 17], [-17, 8, -15, 13], [0, 5, 0, 11], [17, 8, 15, 13], [30, 13, 26, 17]]
    .map(([a, b, c, d]) => `<line x1="${50 + a}" y1="${b}" x2="${50 + c}" y2="${d}" stroke="${color}" stroke-width="2.4" stroke-linecap="round"/>`).join("");
}
const CROWN = `<path d="M38 19 L36 8 L43 13 L50 5 L57 13 L64 8 L62 19 Z" fill="#e0a91c" stroke="#b8860b" stroke-width="1" stroke-linejoin="round"/>`;

/** 絵柄の画像ファイルの場所（アプリ内） */
export const symbolImage = (sym) => `assets/${sym}.png`;

/**
 * 絵柄1枚分の SVG。
 * @param sym "tou" | "dai" | "toku" | "seven"
 * @param imageHref 文字画像の場所（アイコン作りでは画像を埋め込むので差し替える）
 */
export function tileSVG(sym, imageHref = symbolImage(sym)) {
  const inner = (sym === "dai" || sym === "toku") ? `<rect x="9" y="9" width="82" height="82" fill="none" stroke="#e0a91c" stroke-width="1.4"/>` : "";
  const top = sym === "toku" ? CROWN : rays("#c8102e");
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${PRIZE_NAMES[sym]}">` +
    `<rect width="100" height="100" fill="#fff"/>${waves("#e0a91c")}` +
    `<rect x="3.5" y="3.5" width="93" height="93" fill="none" stroke="#c8102e" stroke-width="3"/>${inner}${corners("#c8102e")}${top}` +
    `<image href="${imageHref}" x="22" y="18" width="56" height="62" preserveAspectRatio="xMidYMid meet" style="mix-blend-mode:multiply"/></svg>`;
}
