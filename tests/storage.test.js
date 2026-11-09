import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STORAGE_KEY, BACKUP_KEY, StorageError,
  createInitialData, loadData, saveData, drawAndSave, markRevealed, resetData, updateSettings, validateData,
} from "../logic/storage.js";
import { LotteryError } from "../logic/lottery.js";
import { isValidBoard } from "../logic/board.js";

/** localStorage の代わり（メモリ上） */
class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}
/** 書き込みに失敗する保存領域（端末の容量不足を想定） */
class FullStorage extends MemoryStorage {
  setItem() { const e = new Error("The quota has been exceeded."); e.name = "QuotaExceededError"; throw e; }
}
/** 書き込んだふりをして実は書かない保存領域 */
class LyingStorage extends MemoryStorage {
  setItem() { /* 何もしない */ }
}

/** 「アプリを閉じて開き直す」代わり：保存領域から読み直す */
const reopen = (storage) => loadData(storage).data;

/** n回引いて、そのたびに表示済みにして保存する */
function drawTimes(storage, data, n) {
  for (let i = 0; i < n; i++) {
    data = drawAndSave(storage, data).data;
    data = saveData(storage, markRevealed(data));
  }
  return data;
}

test("初めて開いたときは最初の状態（速さ普通・音OFF）", () => {
  const { data, fresh } = loadData(new MemoryStorage());
  assert.equal(fresh, true);
  assert.deepEqual(data, {
    version: 1,
    lottery: { drawn: 0, remain: { tou: 11, dai: 6, toku: 3, seven: 1 } },
    history: [], last: null, settings: { speed: "normal", sound: false },
  });
});

test("保存して開き直すと、同じ状態に戻る", () => {
  const st = new MemoryStorage();
  const data = drawTimes(st, createInitialData(), 5);
  const { data: loaded, fresh } = loadData(st);
  assert.equal(fresh, false);
  assert.deepEqual(loaded, data);
  assert.equal(loaded.history.length, 5);
});

test("演出の途中で閉じても、引き直しや二重消費は起きない（同じ結果が未表示のまま残る）", () => {
  const st = new MemoryStorage();
  let data = drawTimes(st, createInitialData(), 3);
  const r = drawAndSave(st, data);            // 4回目を引いて保存 → ここで演出が始まる
  // ── 演出の途中でアプリが閉じられた ──
  const again = reopen(st);
  assert.equal(again.lottery.drawn, 4);
  assert.equal(again.history.length, 4);
  assert.deepEqual(again.last, { n: 4, prize: r.prize, grid: r.board.grid, revealed: false });
  assert.deepEqual(again.lottery.remain, r.data.lottery.remain);
  // 開き直しを何度くり返しても、回数も残数も変わらない
  for (let i = 0; i < 5; i++) assert.deepEqual(reopen(st), again);
  // 結果を表示して閉じた後、次に引くのは5回目
  data = saveData(st, markRevealed(again));
  assert.equal(reopen(st).last.revealed, true);
  assert.equal(drawAndSave(st, data).drawNumber, 5);
});

test("17回目の途中で閉じて開き直しても、7が消えたり2回出たりしない", () => {
  const st = new MemoryStorage();
  let data = drawTimes(st, createInitialData(), 16);
  assert.equal(data.lottery.remain.seven, 1);
  const r = drawAndSave(st, data);            // 17回目
  assert.equal(r.prize, "seven");
  // ── 演出の途中で閉じた ──
  const again = reopen(st);
  assert.equal(again.lottery.drawn, 17);
  assert.equal(again.lottery.remain.seven, 0);
  assert.equal(again.last.prize, "seven");
  assert.equal(again.last.revealed, false);
  assert.deepEqual(again.last.grid[1], ["seven", "seven", "seven"]);
  assert.equal(again.history.filter((h) => h.prize === "seven").length, 1);
  // 続きを最後まで引くと、18回目以降に7は出ず、合計は 11・6・3・1
  data = drawTimes(st, saveData(st, markRevealed(again)), 4);
  const counts = { tou: 0, dai: 0, toku: 0, seven: 0 };
  data.history.forEach((h) => counts[h.prize]++);
  assert.deepEqual(counts, { tou: 11, dai: 6, toku: 3, seven: 1 });
  assert.ok(data.history.slice(17).every((h) => h.prize !== "seven"));
});

test("保存に失敗したらエラーになり、保存済みのデータも手元のデータも変わらない", () => {
  const ok = new MemoryStorage();
  const data = drawTimes(ok, createInitialData(), 2);
  const before = ok.getItem(STORAGE_KEY);
  const snapshot = structuredClone(data);

  const full = new FullStorage();
  full.map = ok.map;                          // 同じ中身で、書き込みだけ失敗する
  assert.throws(() => drawAndSave(full, data), (e) => e instanceof StorageError && e.code === "save-failed");
  assert.equal(full.getItem(STORAGE_KEY), before);
  assert.deepEqual(data, snapshot);
  assert.equal(reopen(full).lottery.drawn, 2);
});

test("書いたふりをして書けていない場合も、エラーとして見つける", () => {
  assert.throws(() => drawAndSave(new LyingStorage(), createInitialData()),
    (e) => e instanceof StorageError && e.code === "verify-failed");
});

test("壊れたデータは受け付けず、黙って消さずに別の場所へ退避する", () => {
  const st = new MemoryStorage();
  st.setItem(STORAGE_KEY, "{これはJSONではない");
  assert.throws(() => loadData(st), (e) => e instanceof StorageError && e.code === "corrupt");
  assert.equal(st.getItem(BACKUP_KEY), "{これはJSONではない");
  assert.equal(st.getItem(STORAGE_KEY), "{これはJSONではない");   // 元のデータも消していない
});

test("矛盾したデータは受け付けない", () => {
  const st = new MemoryStorage();
  const good = drawTimes(st, createInitialData(), 17);
  const variants = {
    "履歴が1件足りない": (d) => { d.history.pop(); },
    "履歴の景品が残数と合わない": (d) => { d.history[0].prize = d.history[0].prize === "tou" ? "dai" : "tou"; },
    "7が17回目以外にある": (d) => { const i = d.history.findIndex((h) => h.prize === "dai"); d.history[i].prize = "seven"; d.history[16].prize = "dai"; },
    "最後の結果が履歴と合わない": (d) => { d.last.n = 3; },
    "最後の盤面が当たりと合わない": (d) => { d.last.grid[1] = ["tou", "tou", "tou"]; },
    "残数がマイナス": (d) => { d.lottery.remain.tou = -1; },
    "速さの設定が不明": (d) => { d.settings.speed = "turbo"; },
    "音の設定が真偽値でない": (d) => { d.settings.sound = "on"; },
    "版番号がない": (d) => { delete d.version; },
  };
  for (const [name, mutate] of Object.entries(variants)) {
    const d = structuredClone(good);
    mutate(d);
    st.setItem(STORAGE_KEY, JSON.stringify(d));
    assert.throws(() => loadData(st), (e) => e instanceof StorageError && e.code === "corrupt", name);
  }
});

test("前の版の作り方で保存された盤面（同じ種類のリーチがある）も、正しいデータとして読み込める", () => {
  const st = new MemoryStorage();
  const data = drawAndSave(st, createInitialData()).data;   // 1回目（当・大・特のどれか）
  const p = data.last.prize;
  const [o1, o2, o3] = ["tou", "dai", "toku", "seven"].filter((s) => s !== p);
  const oldStyle = structuredClone(data);
  oldStyle.last.grid = [[p, p, p], [p, p, o1], [o2, o3, o1]];   // 上段だけ揃い、リーチは全部 p
  st.setItem(STORAGE_KEY, JSON.stringify(oldStyle));
  assert.deepEqual(reopen(st).last.grid, oldStyle.last.grid);
});

test("新しい版のアプリで保存されたデータは、壊さずにエラーで知らせる", () => {
  const st = new MemoryStorage();
  const raw = JSON.stringify({ ...createInitialData(), version: 2 });
  st.setItem(STORAGE_KEY, raw);
  assert.throws(() => loadData(st), (e) => e instanceof StorageError && e.code === "newer-version");
  assert.equal(st.getItem(STORAGE_KEY), raw);
});

test("リセットすると最初の状態に戻り、速さと音の設定は残る", () => {
  const st = new MemoryStorage();
  let data = updateSettings(createInitialData(), { speed: "fast", sound: true });
  data = drawTimes(st, data, 18);
  saveData(st, resetData(data));
  const after = reopen(st);
  assert.deepEqual(after.lottery, { drawn: 0, remain: { tou: 11, dai: 6, toku: 3, seven: 1 } });
  assert.deepEqual(after.history, []);
  assert.equal(after.last, null);
  assert.deepEqual(after.settings, { speed: "fast", sound: true });
  // リセット後も17回目はラッキーセブン
  const again = drawTimes(st, after, 17);
  assert.equal(again.history[16].prize, "seven");
});

test("21回引き終えた状態も保存・読み込みでき、22回目は引けない", () => {
  const st = new MemoryStorage();
  const data = drawTimes(st, createInitialData(), 21);
  const loaded = reopen(st);
  assert.equal(loaded.lottery.drawn, 21);
  const before = st.getItem(STORAGE_KEY);
  assert.throws(() => drawAndSave(st, loaded), (e) => e instanceof LotteryError && e.code === "finished");
  assert.equal(st.getItem(STORAGE_KEY), before);
  assert.deepEqual(loaded, data);
});

test("毎回の保存データは、盤面が条件を満たし、回数・残数・履歴が一致している", () => {
  const st = new MemoryStorage();
  let data = createInitialData();
  for (let i = 0; i < 21; i++) {
    data = drawAndSave(st, data).data;
    const loaded = reopen(st);
    assert.ok(validateData(loaded));
    assert.ok(isValidBoard(loaded.last.grid, loaded.last.prize));
    data = saveData(st, markRevealed(loaded));
  }
});

test("設定の変更は保存され、おかしな値は受け付けない", () => {
  const st = new MemoryStorage();
  saveData(st, updateSettings(createInitialData(), { speed: "slow" }));
  assert.equal(reopen(st).settings.speed, "slow");
  assert.throws(() => updateSettings(createInitialData(), { speed: "x" }), StorageError);
});

test("保存データは小さい（21回引き終えても 5KB 未満）", (t) => {
  const st = new MemoryStorage();
  drawTimes(st, createInitialData(), 21);
  const size = st.getItem(STORAGE_KEY).length;
  t.diagnostic(`保存データの大きさ: ${size} 文字`);
  assert.ok(size < 5000);
});
