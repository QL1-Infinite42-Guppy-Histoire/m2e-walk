// M2E Walk — Node/VPS server bootstrap.
//
// Serves the exact same application logic as the Cloudflare Worker build
// (src/app.js, ported from server/src/index.js) over node:http, backed by
// SQLite via the D1-compatible shim in src/db.js. No dependencies:
// Node 24 built-ins only (node:http, node:sqlite, global fetch/Request/
// Response/WebCrypto).
//
// Configuration is via environment variables (see .env.example):
//   PORT               listen port            (default 8787)
//   HOST               listen address         (default 127.0.0.1 —
//                      keep it on localhost behind Caddy / a tunnel)
//   DB_PATH            SQLite file            (default ./data/m2e-walk.db)
//   ADMIN_SECRET       required for /admin/*  (unset = admin API disabled)
//   GIFT_CODE_KEY      gift-code AES-GCM key  (operator tooling only)
//   ADMOB_SSV_ENABLED  "true" enables /admob/ssv (default off)
//
// Run:  node src/main.js        (or via the systemd unit in deploy/)

import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import app from "./app.js";
import { openDatabase, loadSchema } from "./db.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const DB_PATH = process.env.DB_PATH
  ? resolve(process.env.DB_PATH)
  : join(root, "data", "m2e-walk.db");

const db = openDatabase(DB_PATH, loadSchema(join(root, "schema.sql")));

const env = {
  DB: db,
  ADMIN_SECRET: process.env.ADMIN_SECRET || "",
  GIFT_CODE_KEY: process.env.GIFT_CODE_KEY || "",
  ADMOB_SSV_ENABLED: process.env.ADMOB_SSV_ENABLED || "off",
};

if (!env.ADMIN_SECRET) {
  console.warn("[m2e-walk] ADMIN_SECRET is not set — /admin/* will reject all requests.");
}
if (env.ADMOB_SSV_ENABLED === "true") {
  console.warn("[m2e-walk] ADMOB_SSV_ENABLED=true — SSV callback is LIVE.");
}

const MAX_BODY_BYTES = 1024 * 1024; // 1 MiB is far above any legit payload here

const server = createServer(async (req, res) => {
  const started = Date.now();
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        res.writeHead(413, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "payload_too_large" }));
        return;
      }
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    const url = `http://${req.headers.host || `${HOST}:${PORT}`}${req.url}`;
    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
    });
    const response = await app.fetch(request, env);
    const out = Buffer.from(await response.arrayBuffer());
    const headers = {};
    response.headers.forEach((v, k) => { headers[k] = v; });
    res.writeHead(response.status, headers);
    res.end(out);
    // Access log: method/path/status only — never headers or bodies
    // (device tokens and admin secrets must not land in logs).
    console.log(`[m2e-walk] ${req.method} ${new URL(url).pathname} -> ${response.status} (${Date.now() - started}ms)`);
  } catch (e) {
    console.error("[m2e-walk] request failed:", e?.message || e);
    if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "internal" }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[m2e-walk] listening on http://${HOST}:${PORT} (db: ${DB_PATH}, ssv: ${env.ADMOB_SSV_ENABLED === "true" ? "on" : "off"})`);
});

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    console.log(`[m2e-walk] ${signal} — shutting down`);
    server.close(() => {
      try { db.close(); } catch { /* already closed */ }
      process.exit(0);
    });
    // Do not hang forever on a stuck connection.
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
