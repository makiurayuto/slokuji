// オフライン用の仕組み（Service Worker）
// - 初めて開いたときに、アプリのファイルを全部端末に保存する（1つでも失敗したら保存しない）
// - 2回目からは端末に保存したファイルで開く（電波がなくても開ける）
// - 新しい版は裏で受け取っておき、アプリを一度閉じて次に開いたときに切り替わる
// - 抽選の記録（localStorage）には一切触れない

// <files> 端末に保存するファイル（tests/offline.test.js で漏れがないか確かめる）
const FILES = [
  "./",
  "index.html",
  "style.css",
  "app.js",
  "tiles.js",
  "logic/lottery.js",
  "logic/board.js",
  "logic/storage.js",
  "manifest.webmanifest",
  "assets/tou.png",
  "assets/dai.png",
  "assets/toku.png",
  "assets/seven.png",
  "assets/icon-180.png",
  "assets/icon-192.png",
  "assets/icon-512.png",
  "assets/icon-maskable-512.png"
];
// </files>

// 版の番号：上のファイルの中身から自動で計算する（npm test のたびに tools/stamp-sw.mjs が書き換える）
const VERSION = "96e9da8c089a";
const CACHE = `slokuji-${VERSION}`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: "reload" })))),
  );
  // skipWaiting は呼ばない：使っている最中に版が切り替わらないよう、次に開いたときに切り替える
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith("slokuji-") && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = (await cache.match(req, { ignoreSearch: true })) ||
      (req.mode === "navigate" ? await cache.match("index.html") : undefined);
    return hit || fetch(req);
  })());
});

// 版の番号を問い合わせられるようにする（総点検で使う）
self.addEventListener("message", (event) => {
  if (event.data === "version" && event.ports[0]) event.ports[0].postMessage(VERSION);
});
