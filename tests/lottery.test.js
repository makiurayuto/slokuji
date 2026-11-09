import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createInitialState, drawNext, validateState, secureRandomInt, remainingTotal, isFinished,
  LotteryError, INITIAL_REMAIN, NORMAL_PRIZES, SEVEN_DRAW, TOTAL_DRAWS,
} from "../logic/lottery.js";

/** 1箱を最後まで引いて、結果の列を返す */
function drawWholeBox(randomInt) {
  let state = createInitialState();
  const results = [];
  while (!isFinished(state)) {
    const r = drawNext(state, randomInt);
    results.push(r);
    state = r.state;
  }
  return { results, state };
}

/** 中身まで凍結して、書き換えようとしたらエラーになるようにする */
function deepFreeze(obj) {
  Object.values(obj).forEach((v) => { if (v && typeof v === "object") deepFreeze(v); });
  return Object.freeze(obj);
}

test("初期状態は 当11・大6・特3・7が1、引いた回数0", () => {
  const s = createInitialState();
  assert.deepEqual(s, { drawn: 0, remain: { tou: 11, dai: 6, toku: 3, seven: 1 } });
  assert.equal(remainingTotal(s), 21);
  assert.equal(validateState(s), true);
});

test("1箱21回で、景品の数がちょうど 11・6・3・1 になる（ランダムな箱 1,000回）", () => {
  for (let box = 0; box < 1000; box++) {
    const { results, state } = drawWholeBox(secureRandomInt);
    assert.equal(results.length, TOTAL_DRAWS);
    const counts = { tou: 0, dai: 0, toku: 0, seven: 0 };
    results.forEach((r) => counts[r.prize]++);
    assert.deepEqual(counts, { ...INITIAL_REMAIN });
    assert.deepEqual(state.remain, { tou: 0, dai: 0, toku: 0, seven: 0 });
  }
});

test("ラッキーセブンは17回目だけに出て、それ以外の回には出ない（ランダムな箱 1,000回）", () => {
  for (let box = 0; box < 1000; box++) {
    const { results } = drawWholeBox(secureRandomInt);
    results.forEach((r) => {
      assert.equal(r.prize === "seven", r.drawNumber === SEVEN_DRAW, `${r.drawNumber}回目に ${r.prize}`);
    });
  }
});

test("回数は 1〜21 の順に1ずつ進み、残数は一度もマイナスにならない", () => {
  for (let box = 0; box < 200; box++) {
    let state = createInitialState();
    for (let n = 1; n <= TOTAL_DRAWS; n++) {
      const r = drawNext(state, secureRandomInt);
      assert.equal(r.drawNumber, n);
      assert.equal(r.state.drawn, n);
      Object.values(r.state.remain).forEach((v) => assert.ok(v >= 0));
      state = r.state;
    }
  }
});

test("17回目は乱数を使わずにラッキーセブンになり、7の残数が1から0になる", () => {
  let state = createInitialState();
  for (let i = 0; i < SEVEN_DRAW - 1; i++) state = drawNext(state, secureRandomInt).state;
  assert.equal(state.remain.seven, 1);
  let called = 0;
  const r = drawNext(state, () => { called++; return 0; });
  assert.equal(called, 0);
  assert.equal(r.drawNumber, 17);
  assert.equal(r.prize, "seven");
  assert.equal(r.state.remain.seven, 0);
});

test("残数0の景品は当たらない（どの乱数の目でも出ない）", () => {
  // いつも先頭（当たり）を選ぶ乱数で11回引くと、当たりの残りが0になる
  let state = createInitialState();
  for (let i = 0; i < 11; i++) state = drawNext(state, () => 0).state;
  assert.equal(state.remain.tou, 0);
  const total = state.remain.dai + state.remain.toku;
  for (let r = 0; r < total; r++) {
    assert.notEqual(drawNext(state, () => r).prize, "tou", `乱数 ${r} で当たりが出た`);
  }
});

test("当たりやすさは残数に比例する（残り10・5・2本なら、17通りの目に 10・5・2通りずつ割り当て）", () => {
  // 当・大・特を1本ずつ引いて 10・5・2 にする
  const state = { drawn: 3, remain: { tou: 10, dai: 5, toku: 2, seven: 1 } };
  validateState(state);
  const counts = { tou: 0, dai: 0, toku: 0, seven: 0 };
  let seenMax = null;
  for (let r = 0; r < 17; r++) {
    const res = drawNext(state, (max) => { seenMax = max; return r; });
    counts[res.prize]++;
  }
  assert.equal(seenMax, 17, "乱数は残りの当・大・特の合計（17）から選ぶ");
  assert.deepEqual(counts, { tou: 10, dai: 5, toku: 2, seven: 0 });
});

test("22回目は引けない（LotteryError: finished）", () => {
  const { state } = drawWholeBox(secureRandomInt);
  assert.equal(state.drawn, 21);
  assert.throws(() => drawNext(state, secureRandomInt), (e) => e instanceof LotteryError && e.code === "finished");
});

test("抽選しても元の状態は書き換わらない", () => {
  const state = deepFreeze(createInitialState());
  const copy = structuredClone(state);
  const r = drawNext(state, secureRandomInt);
  assert.deepEqual(state, copy);
  assert.notEqual(r.state, state);
  assert.notEqual(r.state.remain, state.remain);
});

test("乱数が範囲外なら抽選しない（LotteryError: bad-random）", () => {
  const state = createInitialState();
  for (const bad of [-1, 20, 1.5, NaN, undefined]) {
    assert.throws(() => drawNext(state, () => bad), (e) => e instanceof LotteryError && e.code === "bad-random");
  }
});

test("矛盾した状態では抽選しない（LotteryError: invalid-state）", () => {
  const bads = [
    null,
    { drawn: -1, remain: { tou: 11, dai: 6, toku: 3, seven: 1 } },
    { drawn: 22, remain: { tou: 0, dai: 0, toku: 0, seven: 0 } },
    { drawn: 0, remain: { tou: -1, dai: 6, toku: 3, seven: 1 } },
    { drawn: 0, remain: { tou: 12, dai: 6, toku: 3, seven: 1 } },
    { drawn: 1, remain: { tou: 11, dai: 6, toku: 3, seven: 1 } },           // 合計が合わない
    { drawn: 17, remain: { tou: 0, dai: 0, toku: 3, seven: 1 } },           // 17回引いたのに7が残っている
    { drawn: 3, remain: { tou: 10, dai: 6, toku: 3, seven: 0 } },           // 17回目より前に7が無い
    { drawn: 0, remain: { tou: 11, dai: 6, toku: 3 } },                     // 7の項目が無い
  ];
  for (const s of bads) {
    assert.throws(() => drawNext(s, secureRandomInt), (e) => e instanceof LotteryError && e.code === "invalid-state", JSON.stringify(s));
  }
});

test("通常抽選の対象は当・大・特だけ", () => {
  assert.deepEqual([...NORMAL_PRIZES], ["tou", "dai", "toku"]);
});

test("暗号用乱数は 0〜max-1 の範囲で、目に偏りがない", () => {
  assert.equal(secureRandomInt(1), 0);
  for (const bad of [0, -3, 1.5, 2 ** 32 + 1]) assert.throws(() => secureRandomInt(bad), RangeError);

  const max = 3, N = 30000;
  const counts = new Array(max).fill(0);
  for (let i = 0; i < N; i++) {
    const v = secureRandomInt(max);
    assert.ok(Number.isInteger(v) && v >= 0 && v < max);
    counts[v]++;
  }
  // 期待値 10,000 回、標準偏差は約82回。±500回（約6標準偏差）を超えたら偏りとみなす
  counts.forEach((c) => assert.ok(Math.abs(c - N / max) < 500, `出た回数 ${counts}`));
});

test("通常抽選の結果も実際の乱数で残数に比例する（残り10・5・2本で 17,000回）", () => {
  const state = { drawn: 3, remain: { tou: 10, dai: 5, toku: 2, seven: 1 } };
  const N = 17000;
  const counts = { tou: 0, dai: 0, toku: 0 };
  for (let i = 0; i < N; i++) counts[drawNext(state, secureRandomInt).prize]++;
  // 期待値 10,000・5,000・2,000。それぞれ約6標準偏差の幅で確認
  assert.ok(Math.abs(counts.tou - 10000) < 400, JSON.stringify(counts));
  assert.ok(Math.abs(counts.dai - 5000) < 350, JSON.stringify(counts));
  assert.ok(Math.abs(counts.toku - 2000) < 250, JSON.stringify(counts));
});
