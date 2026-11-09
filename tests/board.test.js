import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LINES, SYMBOLS, BOARD_COUNT, BoardError,
  reachLines, reachSymbols, winLines, isValidBoard, isWinningBoard, decodeBoard, encodeBoard, buildBoardTable, getBoardTable, pickBoard,
} from "../logic/board.js";
import { createInitialState, drawNext, isFinished, secureRandomInt } from "../logic/lottery.js";

const table = getBoardTable();

test("判定ラインは横3本と斜め2本の計5本だけ（縦は含まない）", () => {
  const key = (l) => l.cells.map(([r, c]) => `${r}${c}`).join(",");
  assert.deepEqual(LINES.map((l) => [l.no, key(l)]), [
    [2, "00,01,02"], // 上段
    [1, "10,11,12"], // 中段
    [3, "20,21,22"], // 下段
    [4, "00,11,22"], // 左上→右下
    [5, "20,11,02"], // 左下→右上
  ]);
  // どのラインも 左の列→中の列→右の列 の順に並んでいる（リーチ判定の前提）
  LINES.forEach((l) => assert.deepEqual(l.cells.map(([, c]) => c), [0, 1, 2]));
});

test("縦に3つ揃っても当たりにならない", () => {
  const grid = [
    ["tou", "dai", "toku"],
    ["tou", "toku", "dai"],
    ["tou", "seven", "seven"],
  ];
  assert.equal(winLines(grid).length, 0);
  assert.equal(isValidBoard(grid, "tou"), false);
});

test("盤面の番号と並びは相互に変換できる（全262,144通り）", () => {
  for (let code = 0; code < BOARD_COUNT; code++) assert.equal(encodeBoard(decodeBoard(code)), code);
});

test("景品ごとの盤面の一覧ができていて、重複がない", (t) => {
  for (const s of SYMBOLS) {
    const list = table[s];
    assert.ok(list.length > 0, `${s} の盤面が0件`);
    assert.equal(new Set(list).size, list.length, `${s} に重複がある`);
    t.diagnostic(`${s}: ${list.length.toLocaleString()} 通り`);
  }
});

test("一覧の全盤面で：中央の列が止まった時点のリーチが2本以上", () => {
  for (const s of SYMBOLS) for (const code of table[s]) {
    assert.ok(reachLines(decodeBoard(code)).length >= 2, `${s} #${code}`);
  }
});

test("一覧の全盤面で：リーチの絵柄はすべて別の種類（「当」と「当」のような同じ種類のリーチはない）", () => {
  for (const s of SYMBOLS) for (const code of table[s]) {
    const syms = reachSymbols(decodeBoard(code));
    assert.equal(new Set(syms).size, syms.length, `${s} #${code}: ${syms}`);
  }
});

test("同じ種類のリーチがある盤面は、揃い方が正しくても新しくは出さない", () => {
  const grid = [
    ["tou", "tou", "tou"],
    ["tou", "tou", "dai"],
    ["toku", "seven", "dai"],
  ];
  assert.deepEqual(reachSymbols(grid), ["tou", "tou", "tou"]);   // 上段・中段・左上→右下
  assert.equal(isWinningBoard(grid, "tou"), true);
  assert.equal(isValidBoard(grid, "tou"), false);
  assert.ok(![...table.tou].includes(encodeBoard(grid)));
});

test("リーチの絵柄の組み合わせは、当たる絵柄＋別の種類になる（例：当が当たるときは 当＋大、当＋7 など）", () => {
  for (const s of SYMBOLS) for (const code of table[s]) {
    const syms = reachSymbols(decodeBoard(code));
    assert.equal(syms.filter((x) => x === s).length, 1, `${s} #${code}`);
    assert.ok(syms.some((x) => x !== s));
  }
});

test("一覧の全盤面で：揃うラインはちょうど1本で、絵柄は当たった景品と同じ", () => {
  for (const s of SYMBOLS) for (const code of table[s]) {
    const grid = decodeBoard(code);
    const wins = winLines(grid);
    assert.equal(wins.length, 1, `${s} #${code}`);
    const [r, c] = wins[0].cells[0];
    assert.equal(grid[r][c], s, `${s} #${code}`);
  }
});

test("ラッキーセブンは真ん中の段（1番ライン）だけで揃う", () => {
  for (const code of table.seven) {
    const grid = decodeBoard(code);
    assert.equal(winLines(grid)[0].no, 1);
    assert.deepEqual(grid[1], ["seven", "seven", "seven"]);
  }
});

test("一覧に漏れがない（別の方法で数え直した結果と完全に一致）", () => {
  // 別実装：9重ループで全盤面を作り、ラインも別に書いて判定する
  const S = ["tou", "dai", "toku", "seven"];
  const L = [
    { no: 2, p: [[0, 0], [0, 1], [0, 2]] }, { no: 1, p: [[1, 0], [1, 1], [1, 2]] }, { no: 3, p: [[2, 0], [2, 1], [2, 2]] },
    { no: 4, p: [[0, 0], [1, 1], [2, 2]] }, { no: 5, p: [[2, 0], [1, 1], [0, 2]] },
  ];
  const expected = { tou: [], dai: [], toku: [], seven: [] };
  const v = new Array(9);
  const rec = (k) => {
    if (k === 9) {
      const g = [[v[0], v[1], v[2]], [v[3], v[4], v[5]], [v[6], v[7], v[8]]];
      const at = ([r, c]) => g[r][c];
      const reachSyms = L.filter((l) => at(l.p[0]) === at(l.p[1])).map((l) => at(l.p[0]));
      const distinct = reachSyms.every((x, i) => reachSyms.indexOf(x) === i);
      const wins = L.filter((l) => at(l.p[0]) === at(l.p[1]) && at(l.p[1]) === at(l.p[2]));
      if (reachSyms.length >= 2 && distinct && wins.length === 1) {
        const sym = at(wins[0].p[0]);
        if (sym !== "seven" || wins[0].no === 1) expected[sym].push(encodeBoard(g));
      }
      return;
    }
    for (const s of S) { v[k] = s; rec(k + 1); }
  };
  rec(0);
  for (const s of SYMBOLS) {
    assert.deepEqual([...table[s]].sort((a, b) => a - b), expected[s].sort((a, b) => a - b), s);
  }
});

test("売り切れた景品の絵柄も、揃わない場所なら盤面に出てくる", () => {
  // 例：当たりの盤面に7が出る／ラッキーセブンの盤面に当・大・特が出る
  const has = (code, sym) => decodeBoard(code).flat().includes(sym);
  assert.ok([...table.tou].some((c) => has(c, "seven")));
  for (const s of ["tou", "dai", "toku"]) assert.ok([...table.seven].some((c) => has(c, s)));
});

test("選ばれ方に偏りがない（乱数の目と一覧の盤面が1対1で対応）", () => {
  for (const s of SYMBOLS) {
    const list = table[s];
    let seenMax = null;
    for (const i of [0, 1, Math.floor(list.length / 2), list.length - 1]) {
      const { grid } = pickBoard(s, (max) => { seenMax = max; return i; });
      assert.equal(encodeBoard(grid), list[i]);
    }
    assert.equal(seenMax, list.length, "乱数は一覧の件数から選ぶ");
  }
});

test("pickBoard は揃うラインとリーチのラインも返す", () => {
  for (let i = 0; i < 2000; i++) {
    const s = SYMBOLS[i % 4];
    const { grid, winLine, reachLines: reaches } = pickBoard(s);
    assert.ok(isValidBoard(grid, s));
    assert.deepEqual(winLine, winLines(grid)[0]);
    assert.ok(reaches.length >= 2);
    assert.ok(reaches.includes(winLine), "揃うラインは必ずリーチだったライン");
    const syms = reachSymbols(grid);
    assert.equal(new Set(syms).size, syms.length, "リーチは全部別の種類");
  }
});

test("おかしな景品名や範囲外の乱数ではエラー", () => {
  assert.throws(() => pickBoard("hazure"), (e) => e instanceof BoardError && e.code === "unknown-prize");
  for (const bad of [-1, table.tou.length, 0.5, NaN]) {
    assert.throws(() => pickBoard("tou", () => bad), (e) => e instanceof BoardError && e.code === "bad-random");
  }
});

test("抽選→盤面を1箱21回通しても、毎回条件を満たす（200箱）", () => {
  for (let box = 0; box < 200; box++) {
    let state = createInitialState();
    while (!isFinished(state)) {
      const r = drawNext(state, secureRandomInt);
      const { grid } = pickBoard(r.prize);
      assert.ok(isValidBoard(grid, r.prize), `${r.drawNumber}回目 ${r.prize}`);
      if (r.drawNumber === 17) assert.deepEqual(grid[1], ["seven", "seven", "seven"]);
      state = r.state;
    }
  }
});

test("一覧づくりにかかる時間（参考値）", (t) => {
  const t0 = performance.now();
  buildBoardTable();
  const ms = performance.now() - t0;
  t.diagnostic(`一覧づくり: ${ms.toFixed(0)} ms（このPCでの値）`);
  assert.ok(ms < 5000);
});
