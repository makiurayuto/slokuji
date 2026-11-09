// 確認用の小さなWebサーバー（外部の部品なし）
// 使い方: npm start  → http://localhost:8080 を開く
// 同じWi-FiのiPhoneからは、表示される http://192.168.x.x:8080 を開く

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT) || 8080;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith("/")) rel += "index.html";
    const file = path.resolve(ROOT, "." + rel);
    // 作業フォルダの外や、隠しフォルダ・開発用フォルダは見せない
    const inside = path.relative(ROOT, file);
    if (inside.startsWith("..") || path.isAbsolute(inside) || /(^|[\\/])(\.|node_modules)/.test(inside)) {
      res.writeHead(403).end("Forbidden");
      return;
    }
    const body = await fs.readFile(file);
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch (e) {
    res.writeHead(e.code === "ENOENT" ? 404 : 500).end(e.code === "ENOENT" ? "Not Found" : "Server Error");
  }
});

// ホストを指定しない＝IPv6とIPv4の両方で待ち受ける（Windowsで localhost が ::1 になっても開ける）
server.listen(PORT, () => {
  console.log("スロくじ 確認用サーバーを起動しました（止めるときは Ctrl + C）\n");
  console.log(`  このPC     : http://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === "IPv4" && !a.internal) console.log(`  同じWi-Fi  : http://${a.address}:${PORT}`);
    }
  }
  console.log("");
});
