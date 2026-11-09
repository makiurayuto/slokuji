// スロット盤面の生成と判定（画面から独立。ブラウザとNode.jsの両方で動く）
//
// 盤面は 3段×3列。grid[段][列]、段は 0=上 1=中 2=下、列は 0=左 1=中 2=右。
// 判定ラインは横3本と斜め2本の計5本（縦は判定しない）。
//
// 条件（どの景品でも）
// - 中央の列が止まった時点で、リーチ（左と中の絵柄が同じライン）が2本以上
// - リーチの絵柄はすべて別の種類（「当」と「大」はよいが、「当」と「当」は不可）
// - 最終的に揃うラインはちょうど1本で、その絵柄は当たった景品と同じ
// - ラッキーセブンは真ん中の段（1番ライン）で揃う
//
// 作り方：4種類×9マス＝262,144通りを1回だけ全部調べ、条件を満たす盤面を景品ごとに一覧にする。
// 抽選後はその一覧から1つを等確率で選ぶ。「条件に合うまでランダムに作り直す」処理は使わない。

import { PRIZES, secureRandomInt } from "./lottery.js";

export const SYMBOLS = PRIZES;               // ["tou", "dai", "toku", "seven"]（絵柄と景品は1対1）
export const BOARD_COUNT = 4 ** 9;          // 262,144通り

// ライン番号：1=中段 2=上段 3=下段 4=左上→右下 5=左下→右上
// cells はどれも [左の列, 中の列, 右の列] の順
export const LINES = Object.freeze([
  { no: 2, cells: [[0, 0], [0, 1], [0, 2]] },
  { no: 1, cells: [[1, 0], [1, 1], [1, 2]] },
  { no: 3, cells: [[2, 0], [2, 1], [2, 2]] },
  { no: 4, cells: [[0, 0], [1, 1], [2, 2]] },
  { no: 5, cells: [[2, 0], [1, 1], [0, 2]] },
].map((l) => Object.freeze({ no: l.no, cells: Object.freeze(l.cells.map((c) => Object.freeze(c))) })));

export const SEVEN_LINE_NO = 1;             // ラッキーセブンは真ん中の段で揃う
export const MIN_REACH = 2;                 // 中央の列が止まった時点のリーチの最低本数

export class BoardError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "BoardError";
    this.code = code;
  }
}

/** リーチになっているライン（左の列と中の列の絵柄が同じ） */
export function reachLines(grid) {
  return LINES.filter(({ cells: [a, b] }) => grid[a[0]][a[1]] === grid[b[0]][b[1]]);
}

/** 揃っているライン（3マスとも同じ絵柄） */
export function winLines(grid) {
  return LINES.filter(({ cells: [a, b, c] }) => {
    const s = grid[a[0]][a[1]];
    return s === grid[b[0]][b[1]] && s === grid[c[0]][c[1]];
  });
}

/** 揃うラインがちょうど1本で、その絵柄が景品 prize と同じか（7は真ん中の段）。保存データの確認にも使う */
export function isWinningBoard(grid, prize) {
  const wins = winLines(grid);
  if (wins.length !== 1) return false;
  const [line] = wins;
  const [r, c] = line.cells[0];
  if (grid[r][c] !== prize) return false;
  if (prize === "seven" && line.no !== SEVEN_LINE_NO) return false;
  return true;
}

/** リーチの絵柄の一覧（ラインの順） */
export function reachSymbols(grid) {
  return reachLines(grid).map(({ cells: [[r, c]] }) => grid[r][c]);
}

/** この盤面が、景品 prize の結果として新しく出してよい条件をすべて満たすか */
export function isValidBoard(grid, prize) {
  const syms = reachSymbols(grid);
  if (syms.length < MIN_REACH) return false;
  if (new Set(syms).size !== syms.length) return false;   // リーチは全部別の種類
  return isWinningBoard(grid, prize);
}

/** 盤面の番号（0〜262,143）→ grid[段][列]。マス k=段*3+列 が4進数の k 桁目 */
export function decodeBoard(code) {
  const grid = [[], [], []];
  for (let k = 0; k < 9; k++) {
    grid[Math.floor(k / 3)][k % 3] = SYMBOLS[code % 4];
    code = Math.floor(code / 4);
  }
  return grid;
}

/** grid[段][列] → 盤面の番号 */
export function encodeBoard(grid) {
  let code = 0;
  for (let k = 8; k >= 0; k--) code = code * 4 + SYMBOLS.indexOf(grid[Math.floor(k / 3)][k % 3]);
  return code;
}

/** 全盤面を調べて、景品ごとに条件を満たす盤面番号の一覧を作る */
export function buildBoardTable() {
  const lists = Object.fromEntries(SYMBOLS.map((s) => [s, []]));
  for (let code = 0; code < BOARD_COUNT; code++) {
    const grid = decodeBoard(code);
    const wins = winLines(grid);
    if (wins.length !== 1) continue;
    const [r, c] = wins[0].cells[0];
    const prize = grid[r][c];
    if (isValidBoard(grid, prize)) lists[prize].push(code);
  }
  return Object.freeze(Object.fromEntries(SYMBOLS.map((s) => [s, Uint32Array.from(lists[s])])));
}

let cachedTable = null;
/** 一覧（初回だけ作り、あとは使い回す） */
export function getBoardTable() {
  if (!cachedTable) cachedTable = buildBoardTable();
  return cachedTable;
}

/**
 * 当たった景品に合う盤面を1つ選ぶ。
 * @returns { grid, winLine: 揃うライン, reachLines: 中央の列が止まった時点のリーチ }
 */
export function pickBoard(prize, randomInt = secureRandomInt, table = getBoardTable()) {
  const list = table[prize];
  if (!list) throw new BoardError("unknown-prize", `景品が正しくありません: ${prize}`);
  if (list.length === 0) throw new BoardError("no-board", `${prize} に合う盤面がありません`);
  const i = randomInt(list.length);
  if (!Number.isInteger(i) || i < 0 || i >= list.length) {
    throw new BoardError("bad-random", `乱数が範囲外です: ${i}（0〜${list.length - 1}）`);
  }
  const grid = decodeBoard(list[i]);
  if (!isValidBoard(grid, prize)) throw new BoardError("invalid-board", "盤面が条件を満たしていません");
  return { grid, winLine: winLines(grid)[0], reachLines: reachLines(grid) };
}
