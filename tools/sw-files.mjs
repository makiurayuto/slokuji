// sw.js の「端末に保存するファイル」一覧と版の番号を扱う小さな部品
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SW_PATH = path.join(ROOT, "sw.js");

/** sw.js に書かれたファイル一覧 */
export function readSwFiles(source = fs.readFileSync(SW_PATH, "utf8")) {
  const m = source.match(/const FILES = (\[[\s\S]*?\]);/);
  if (!m) throw new Error("sw.js にファイル一覧（const FILES = [...]）が見つかりません");
  return JSON.parse(m[1]);
}

/** sw.js に書かれた版の番号 */
export function readSwVersion(source = fs.readFileSync(SW_PATH, "utf8")) {
  const m = source.match(/const VERSION = "([^"]*)";/);
  if (!m) throw new Error("sw.js に版の番号（const VERSION = \"...\"）が見つかりません");
  return m[1];
}

/** ファイル一覧の中身（と sw.js 自身の版の番号以外の部分）から版の番号を計算する */
export function computeVersion(source = fs.readFileSync(SW_PATH, "utf8")) {
  const hash = crypto.createHash("sha256");
  hash.update(source.replace(/const VERSION = "[^"]*";/, ""));
  for (const f of readSwFiles(source).filter((f) => f !== "./").sort()) {
    hash.update("\0" + f + "\0");
    hash.update(fs.readFileSync(path.join(ROOT, f)));
  }
  return hash.digest("hex").slice(0, 12);
}
