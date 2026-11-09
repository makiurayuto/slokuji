// 保存と読み込み（画面から独立。ブラウザでは localStorage、テストではメモリ上の保存領域を使う）
//
// 保存データ（版番号1）は1つのまとまりとして、1つのキーにいっぺんに書き込む。
// 途中まで書かれた状態は起こらないので、回数・残数・履歴・盤面が食い違わない。
//
// {
//   version: 1,
//   lottery: { drawn, remain: { tou, dai, toku, seven } },
//   history: [ { n, prize }, ... ],                     // 1回目から順に
//   last: null | { n, prize, grid, revealed },          // 最後に引いた結果。revealed=false は当選表示を閉じる前
//   settings: { speed: "slow"|"normal"|"fast", sound: true|false }
// }

import { createInitialState, validateState, drawNext, secureRandomInt, PRIZES, INITIAL_REMAIN, SEVEN_DRAW } from "./lottery.js";
import { pickBoard, isWinningBoard } from "./board.js";

export const STORAGE_KEY = "slokuji";
export const BACKUP_KEY = "slokuji.backup";
export const SAVE_VERSION = 1;
export const SPEEDS = Object.freeze(["slow", "normal", "fast"]);
export const DEFAULT_SETTINGS = Object.freeze({ speed: "normal", sound: false });

export class StorageError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = "StorageError";
    this.code = code;
    if (cause) this.cause = cause;
  }
}

/** 最初の状態の保存データ（設定は引き継げる） */
export function createInitialData(settings = DEFAULT_SETTINGS) {
  return {
    version: SAVE_VERSION,
    lottery: createInitialState(),
    history: [],
    last: null,
    settings: { speed: settings.speed, sound: settings.sound },
  };
}

/** 保存データに矛盾がないか確かめる。おかしければ StorageError("invalid-data") */
export function validateData(data) {
  const fail = (why) => { throw new StorageError("invalid-data", `保存データが正しくありません: ${why}`); };
  if (!data || typeof data !== "object") fail("データがありません");
  if (data.version !== SAVE_VERSION) fail(`版番号 ${data.version}`);

  try { validateState(data.lottery); } catch (e) { fail(e.message); }
  const { drawn, remain } = data.lottery;

  const { history } = data;
  if (!Array.isArray(history) || history.length !== drawn) fail("履歴の件数が引いた回数と合いません");
  const counts = { tou: 0, dai: 0, toku: 0, seven: 0 };
  history.forEach((h, i) => {
    if (!h || h.n !== i + 1 || !PRIZES.includes(h.prize)) fail(`履歴の ${i + 1} 件目`);
    if ((h.prize === "seven") !== (h.n === SEVEN_DRAW)) fail(`${h.n}回目に ${h.prize}`);
    counts[h.prize]++;
  });
  for (const p of PRIZES) if (INITIAL_REMAIN[p] - remain[p] !== counts[p]) fail(`${p} の残数と履歴が合いません`);

  const { last } = data;
  if (drawn === 0) {
    if (last !== null) fail("まだ引いていないのに最後の結果があります");
  } else {
    if (!last || typeof last !== "object") fail("最後の結果がありません");
    if (last.n !== drawn || last.prize !== history[drawn - 1].prize) fail("最後の結果が履歴と合いません");
    if (typeof last.revealed !== "boolean") fail("表示済みかどうかが不明です");
    const okGrid = Array.isArray(last.grid) && last.grid.length === 3 &&
      last.grid.every((row) => Array.isArray(row) && row.length === 3 && row.every((s) => PRIZES.includes(s)));
    // 盤面の作り方の条件（リーチの本数・種類）は版によって変わりうるので、ここでは「当選と一致して1本だけ揃う」ことだけを確かめる
    if (!okGrid || !isWinningBoard(last.grid, last.prize)) fail("最後の盤面が当選と合っていません");
  }

  const { settings } = data;
  if (!settings || !SPEEDS.includes(settings.speed) || typeof settings.sound !== "boolean") fail("設定");
  return true;
}

function backupRaw(storage, raw) {
  try { storage.setItem(BACKUP_KEY, raw); } catch { /* 退避できなくても読み込みエラーは知らせる */ }
}

/**
 * 保存データを読み込む。
 * @returns { data, fresh }  fresh=true は保存データが無かった（初めて開いた）
 * 壊れている・矛盾している場合は、元の文字列を BACKUP_KEY に退避して StorageError("corrupt") を投げる。
 * 自動で初期化はしない（消すかどうかは使う人が決める）。
 */
export function loadData(storage) {
  let raw;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch (e) {
    throw new StorageError("read-failed", "保存データを読み込めませんでした", e);
  }
  if (raw === null || raw === undefined) return { data: createInitialData(), fresh: true };

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    backupRaw(storage, raw);
    throw new StorageError("corrupt", "保存データが壊れています", e);
  }
  if (data && typeof data === "object" && Number.isInteger(data.version) && data.version > SAVE_VERSION) {
    throw new StorageError("newer-version", "新しい版のアプリで保存されたデータです。アプリを最新にしてください");
  }
  try {
    validateData(data);
  } catch (e) {
    backupRaw(storage, raw);
    throw new StorageError("corrupt", e.message, e);
  }
  return { data, fresh: false };
}

/**
 * 保存データを書き込む。書いた後に読み直して、同じ内容か確かめる。
 * 失敗したら StorageError("save-failed" | "verify-failed")。
 */
export function saveData(storage, data) {
  validateData(data);
  const json = JSON.stringify(data);
  try {
    storage.setItem(STORAGE_KEY, json);
  } catch (e) {
    throw new StorageError("save-failed", "保存できませんでした（端末の空き容量などを確認してください）", e);
  }
  let check;
  try { check = storage.getItem(STORAGE_KEY); } catch (e) {
    throw new StorageError("verify-failed", "保存できたか確認できませんでした", e);
  }
  if (check !== json) throw new StorageError("verify-failed", "保存した内容を確認できませんでした");
  return data;
}

/** 抽選結果と盤面を反映した、新しい保存データを作る（元のデータは書き換えない） */
export function applyDraw(data, drawResult, board) {
  if (drawResult.drawNumber !== data.lottery.drawn + 1) {
    throw new StorageError("invalid-data", "抽選結果の回数が合いません");
  }
  const next = {
    version: SAVE_VERSION,
    lottery: drawResult.state,
    history: [...data.history, { n: drawResult.drawNumber, prize: drawResult.prize }],
    last: { n: drawResult.drawNumber, prize: drawResult.prize, grid: board.grid.map((row) => [...row]), revealed: false },
    settings: { ...data.settings },
  };
  validateData(next);
  return next;
}

/**
 * 1回引いて、盤面を決めて、保存する。
 * 保存に成功したときだけ新しいデータを返す。失敗したら例外を投げ、保存済みのデータも渡したデータも変わらない。
 * @returns { data: 新しいデータ, drawNumber, prize, board }
 */
export function drawAndSave(storage, data, randomInt = secureRandomInt) {
  const result = drawNext(data.lottery, randomInt);
  const board = pickBoard(result.prize, randomInt);
  const next = applyDraw(data, result, board);
  saveData(storage, next);
  return { data: next, drawNumber: result.drawNumber, prize: result.prize, board };
}

/** 当選表示を閉じたことを記録した新しいデータ */
export function markRevealed(data) {
  if (!data.last || data.last.revealed) return data;
  return { ...data, last: { ...data.last, revealed: true } };
}

/** リセット後のデータ（設定は残す） */
export function resetData(data) {
  return createInitialData(data.settings);
}

/** 設定を変えた新しいデータ */
export function updateSettings(data, patch) {
  const next = { ...data, settings: { ...data.settings, ...patch } };
  validateData(next);
  return next;
}
