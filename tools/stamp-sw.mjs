// sw.js の版の番号を、ファイルの中身から計算して書き換える（npm test の前に自動で実行される）
// アプリのファイルを変えると番号が変わり、iPhone 側で「新しい版」として受け取られる。
import fs from "node:fs";
import { SW_PATH, computeVersion, readSwVersion } from "./sw-files.mjs";

const source = fs.readFileSync(SW_PATH, "utf8");
const next = computeVersion(source);
if (readSwVersion(source) === next) {
  console.log(`sw.js の版の番号: ${next}（変更なし）`);
} else {
  fs.writeFileSync(SW_PATH, source.replace(/const VERSION = "[^"]*";/, `const VERSION = "${next}";`));
  console.log(`sw.js の版の番号を更新: ${next}`);
}
