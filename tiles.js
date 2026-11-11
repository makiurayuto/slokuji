// 絵柄（写真から切り抜いた文字＋枠・波・王冠などの飾り）を SVG の文字列で作る。
// アプリ本体（app.js）とアイコン作り（tools/make-icons.mjs）の両方で使う。
//
// アプリでは、光らせるための層を重ねる（effects: true）。
//   t-glow   ：文字と色の部分を金色にしてぼかした「光の輪」
//   t-parts  ：ふだんの絵柄
//   t-bright ：文字と色の部分を明るく・鮮やかにした絵柄（点滅で出したり消したりする）
//   t-shine  ：斜めに横切る光の筋（当たったマスだけ）
// 出し入れは style.css と app.js で行う（全部のマスで同じタイミングになるよう、リール全体の合図で切り替える）。

import { PRIZE_NAMES } from "./logic/lottery.js";

function corners(color) {
  const s = `fill="none" stroke="${color}" stroke-width="2.2"`;
  return `<path ${s} d="M7 19 H12 V12 H19 V7"/><path ${s} d="M93 19 H88 V12 H81 V7"/><path ${s} d="M7 81 H12 V88 H19 V93"/><path ${s} d="M93 81 H88 V88 H81 V93"/>`;
}
function waves(color, withBack = true) {
  const one = (cx) => (withBack ? `<circle cx="${cx}" cy="94" r="10.6" fill="#fff"/>` : "") +
    [10, 6.6, 3.2].map((r) => `<circle cx="${cx}" cy="94" r="${r}" fill="none" stroke="${color}" stroke-width="1.3"/>`).join("");
  // 枠の外にはみ出す部分は白で隠す
  return one(33) + one(67) + one(50) + (withBack ? `<rect x="0" y="95.5" width="100" height="4.5" fill="#fff"/>` : "");
}
function rays(color) {
  return [[-30, 13, -26, 17], [-17, 8, -15, 13], [0, 5, 0, 11], [17, 8, 15, 13], [30, 13, 26, 17]]
    .map(([a, b, c, d]) => `<line x1="${50 + a}" y1="${b}" x2="${50 + c}" y2="${d}" stroke="${color}" stroke-width="2.4" stroke-linecap="round"/>`).join("");
}
const CROWN = `<path d="M38 19 L36 8 L43 13 L50 5 L57 13 L64 8 L62 19 Z" fill="#e0a91c" stroke="#b8860b" stroke-width="1" stroke-linejoin="round"/>`;

/** 絵柄の画像ファイルの場所（アプリ内） */
export const symbolImage = (sym) => `assets/${sym}.png`;

/**
 * 光らせる層が使う共通の定義。ページに1回だけ置く（app.js が body に入れる）。
 * 絵柄は36枚以上並ぶので、定義を1か所にまとめて使い回す。
 */
export const TILE_DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
  <filter id="tgGlow" x="-30%" y="-30%" width="160%" height="160%" color-interpolation-filters="sRGB">
    <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 0.82  0 0 0 0 0.25  -0.5 -0.5 -0.5 1.5 0"/>
    <feGaussianBlur stdDeviation="3"/>
    <feMerge><feMergeNode/><feMergeNode/></feMerge>
  </filter>
  <filter id="tgBright" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
    <feColorMatrix type="saturate" values="1.5"/>
    <feComponentTransfer><feFuncR type="linear" slope="1.45"/><feFuncG type="linear" slope="1.45"/><feFuncB type="linear" slope="1.45"/></feComponentTransfer>
  </filter>
  <linearGradient id="tgShine" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
  </linearGradient>
  <clipPath id="tgClip"><rect width="100" height="100"/></clipPath>
</defs></svg>`;

/**
 * 絵柄1枚分の SVG。
 * @param sym "tou" | "dai" | "toku" | "seven"
 * @param imageHref 文字画像の場所（アイコン作りでは画像を埋め込むので差し替える）
 * @param options.effects 光らせるための層を入れるか（アプリでは true、アイコンでは false）
 */
export function tileSVG(sym, imageHref = symbolImage(sym), { effects = false } = {}) {
  const inner = (sym === "dai" || sym === "toku") ? `<rect x="9" y="9" width="82" height="82" fill="none" stroke="#e0a91c" stroke-width="1.4"/>` : "";
  const top = sym === "toku" ? CROWN : rays("#c8102e");
  const deco = (withBack) => `${waves("#e0a91c", withBack)}` +
    `<rect x="3.5" y="3.5" width="93" height="93" fill="none" stroke="#c8102e" stroke-width="3"/>${inner}${corners("#c8102e")}${top}`;
  const img = (blend) => `<image href="${imageHref}" x="22" y="18" width="56" height="62" preserveAspectRatio="xMidYMid meet"${blend ? ` style="mix-blend-mode:multiply"` : ""}/>`;
  const parts = `${deco(true)}${img(true)}`;

  const open = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${PRIZE_NAMES[sym]}"><rect width="100" height="100" fill="#fff"/>`;
  if (!effects) return `${open}${parts}</svg>`;
  return `${open}` +
    `<g class="t-glow" filter="url(#tgGlow)">${deco(false)}${img(false)}</g>` +
    `<g class="t-parts">${parts}</g>` +
    `<g class="t-bright" filter="url(#tgBright)">${parts}</g>` +
    `<g clip-path="url(#tgClip)"><g transform="rotate(22 50 50)"><rect class="t-shine" x="-90" y="-40" width="36" height="180" fill="url(#tgShine)" style="mix-blend-mode:screen"/></g></g>` +
    `</svg>`;
}
