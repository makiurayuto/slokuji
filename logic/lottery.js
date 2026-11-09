// 箱くじの抽選ロジック（画面から独立。ブラウザとNode.jsの両方で動く）
//
// ルール
// - 初期状態は 当たり11・大当たり6・特大当たり3・ラッキーセブン1 の計21本
// - 17回目は必ずラッキーセブン。それ以外の回ではラッキーセブンは出ない
// - 17回目以外は、残っている当たり・大当たり・特大当たりのくじ1本1本が等確率
// - 引いたくじは戻さない。21回で全部引き切り、22回目は引けない
// - 状態は書き換えず、新しい状態を返す（保存に失敗したら元の状態のまま扱えるように）

export const PRIZES = Object.freeze(["tou", "dai", "toku", "seven"]);
export const NORMAL_PRIZES = Object.freeze(["tou", "dai", "toku"]);
export const PRIZE_NAMES = Object.freeze({
  tou: "当たり",
  dai: "大当たり",
  toku: "特大当たり",
  seven: "ラッキーセブン",
});
export const INITIAL_REMAIN = Object.freeze({ tou: 11, dai: 6, toku: 3, seven: 1 });
export const TOTAL_DRAWS = 21;
export const SEVEN_DRAW = 17;

export class LotteryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LotteryError";
    this.code = code;
  }
}

/** 最初の状態（何も引いていない箱） */
export function createInitialState() {
  return { drawn: 0, remain: { ...INITIAL_REMAIN } };
}

/** 箱の残りの総本数 */
export function remainingTotal(state) {
  return PRIZES.reduce((sum, p) => sum + state.remain[p], 0);
}

/** 21回引き終えたか */
export function isFinished(state) {
  return state.drawn >= TOTAL_DRAWS;
}

/**
 * 状態に矛盾がないか確かめる。おかしければ LotteryError("invalid-state") を投げる。
 * 保存データの読み込み時にも使う。
 */
export function validateState(state) {
  const fail = (why) => { throw new LotteryError("invalid-state", `抽選の状態が正しくありません: ${why}`); };
  if (!state || typeof state !== "object") fail("状態がありません");
  const { drawn, remain } = state;
  if (!Number.isInteger(drawn) || drawn < 0 || drawn > TOTAL_DRAWS) fail(`引いた回数 ${drawn}`);
  if (!remain || typeof remain !== "object") fail("残数がありません");
  for (const p of PRIZES) {
    const n = remain[p];
    if (!Number.isInteger(n) || n < 0 || n > INITIAL_REMAIN[p]) fail(`${p} の残数 ${n}`);
  }
  if (remainingTotal(state) !== TOTAL_DRAWS - drawn) fail("残数の合計と引いた回数が合いません");
  const sevenLeft = drawn >= SEVEN_DRAW ? 0 : 1;
  if (remain.seven !== sevenLeft) fail(`${drawn}回引いた時点のラッキーセブンの残数 ${remain.seven}`);
  return true;
}

/**
 * 0 以上 max 未満の整数を、偏りなく返す（ブラウザ／Node.js の暗号用乱数を使用）。
 * 2^32 を max で割り切れない端の部分だけ引き直す（引き直しになる確率は max/2^32 未満で、実質起きない）。
 */
export function secureRandomInt(max) {
  if (!Number.isInteger(max) || max <= 0 || max > 2 ** 32) {
    throw new RangeError(`max は 1〜2^32 の整数にしてください: ${max}`);
  }
  const limit = Math.floor(2 ** 32 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    globalThis.crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
}

/**
 * 次の1回を引く。
 * @param state 現在の状態（書き換えない）
 * @param randomInt 乱数関数 (max) => 0〜max-1 の整数。テストでは差し替える
 * @returns { drawNumber: 何回目か, prize: 当たった景品, state: 引いた後の新しい状態 }
 */
export function drawNext(state, randomInt = secureRandomInt) {
  validateState(state);
  if (isFinished(state)) {
    throw new LotteryError("finished", "21回引き終えたので、これ以上は引けません");
  }

  const drawNumber = state.drawn + 1;
  let prize;

  if (drawNumber === SEVEN_DRAW) {
    prize = "seven";
  } else {
    const total = NORMAL_PRIZES.reduce((sum, p) => sum + state.remain[p], 0);
    const r = randomInt(total);
    if (!Number.isInteger(r) || r < 0 || r >= total) {
      throw new LotteryError("bad-random", `乱数が範囲外です: ${r}（0〜${total - 1}）`);
    }
    // くじを 当→大→特 の順に一列に並べたとき、r 番目のくじが当たり
    let acc = 0;
    for (const p of NORMAL_PRIZES) {
      acc += state.remain[p];
      if (r < acc) { prize = p; break; }
    }
  }

  const next = {
    drawn: drawNumber,
    remain: { ...state.remain, [prize]: state.remain[prize] - 1 },
  };
  validateState(next);
  return { drawNumber, prize, state: next };
}
