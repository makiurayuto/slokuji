// 公開するファイルだけを _site フォルダに集める（GitHub Actions で使う。手元でも npm run build で試せる）
// 集めるのは sw.js の一覧にあるファイルと sw.js 自身だけ。テスト・開発用ツール・元の写真は含めない。
import fs from "node:fs";
import path from "node:path";
import { ROOT, readSwFiles, readSwVersion, computeVersion } from "./sw-files.mjs";

const OUT = path.join(ROOT, "_site");

const version = readSwVersion();
if (version !== computeVersion()) {
  console.error("sw.js の版の番号がファイルの中身と合っていません。npm test（または npm run stamp）を実行してから記録してください。");
  process.exit(1);
}

fs.rmSync(OUT, { recursive: true, force: true });
const files = [...readSwFiles().filter((f) => f !== "./"), "sw.js"];
let bytes = 0;
for (const f of files) {
  const from = path.join(ROOT, f), to = path.join(OUT, f);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  bytes += fs.statSync(from).size;
}
console.log(`_site に ${files.length} ファイル（${(bytes / 1024).toFixed(1)} KB）を集めました。版の番号: ${version}`);
