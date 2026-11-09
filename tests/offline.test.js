import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT, readSwFiles, readSwVersion, computeVersion } from "../tools/sw-files.mjs";
import { SYMBOLS } from "../logic/board.js";

const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const files = readSwFiles();
const listed = new Set(files);

/** JS ファイルが import しているファイル（./ や ../ で始まるもの）を、たどれるだけたどる */
function jsDependencies(entry) {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const m of read(file).matchAll(/(?:import|export)\s[^"']*?from\s+["'](\.{1,2}\/[^"']+)["']/g)) {
      visit(path.posix.normalize(path.posix.join(path.posix.dirname(file), m[1])));
    }
  };
  visit(entry);
  return [...seen];
}

test("一覧のファイルはすべて実在する", () => {
  for (const f of files) {
    if (f === "./") continue;
    assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} がありません`);
  }
});

test("index.html が読み込むファイルは、すべて一覧に入っている", () => {
  const html = read("index.html");
  const refs = [...html.matchAll(/(?:href|src)="([^"#:]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 5, "参照が見つからない");
  for (const r of refs) assert.ok(listed.has(r), `${r} が一覧にない`);
  assert.ok(listed.has("./") && listed.has("index.html"));
});

test("app.js からたどれる JavaScript は、すべて一覧に入っている", () => {
  const deps = jsDependencies("app.js");
  assert.ok(deps.includes("logic/storage.js") && deps.includes("tiles.js"));
  for (const d of deps) assert.ok(listed.has(d), `${d} が一覧にない`);
});

test("絵柄の画像とアイコンは、すべて一覧に入っている", () => {
  for (const s of SYMBOLS) assert.ok(listed.has(`assets/${s}.png`), `assets/${s}.png が一覧にない`);
  const manifest = JSON.parse(read("manifest.webmanifest"));
  for (const icon of manifest.icons) assert.ok(listed.has(icon.src), `${icon.src} が一覧にない`);
});

test("開発用のファイルや元の写真は、一覧に入っていない", () => {
  for (const f of files) {
    assert.ok(!/^(tools|tests|node_modules)\//.test(f), `${f} は開発用`);
    assert.ok(!["gatya.jpg", "package.json", "sw.js"].includes(f), `${f} は入れない`);
  }
});

test("版の番号はファイルの中身と合っている（アプリを変えたら番号も変わる）", () => {
  assert.equal(readSwVersion(), computeVersion(), "npm run stamp で版の番号を更新してください");
  assert.match(readSwVersion(), /^[0-9a-f]{12}$/);
});

test("オフライン用の仕組みは、抽選の記録（localStorage）に触れない", () => {
  const sw = read("sw.js").replace(/\/\/.*$/gm, "");
  assert.ok(!/localStorage|indexedDB|clear\(\)/.test(sw));
  assert.ok(!/skipWaiting/.test(sw), "使っている最中に切り替えない（次に開いたときに反映）");
});

test("ホーム画面用の設定がそろっている", () => {
  const html = read("index.html");
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  assert.match(html, /<link rel="apple-touch-icon" href="assets\/icon-180\.png">/);
  assert.match(html, /apple-mobile-web-app-capable/);
  const m = JSON.parse(read("manifest.webmanifest"));
  assert.equal(m.display, "standalone");
  assert.equal(m.start_url, "./");
  assert.ok(m.icons.some((i) => i.sizes === "512x512" && i.purpose === "maskable"));
});
