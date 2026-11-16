# M2E Walk — server (Node + SQLite, VPS build)

ポイント基盤のサーバー側、**本線**（2026-11-17 ユーザー決定：有料VPS路線）。
Cloudflare Worker + D1 版（`../server/`）は予備として残してあります。

Points foundation for the M2E walking app — the **main-line** build since
2026-11-17 (user decision: paid VPS route). The Cloudflare Worker + D1
build in `../server/` is kept as a fallback. Behaviour is identical:
same routes, same ledger logic, same config values, same schema.

## Why this build exists

The Cloudflare API token available to the project has Workers/KV rights
but **no D1 rights** (D1 endpoints return 401), so the Worker build could
not be deployed. This build runs the same code on a plain VPS with
Node.js + SQLite instead — SQLite is the same engine D1 is built on.

## Layout

- `src/app.js` — the application (fetch-style handler, ported 1:1 from
  `../server/src/index.js`); routes / auth / exchange flow live here
- `src/main.js` — node:http bootstrap; configuration via environment
- `src/db.js` — D1-compatible shim over `node:sqlite` (built into Node 24;
  zero npm dependencies in this whole directory)
- `src/config.js` — **all rates and limits live here** (identical values to
  the Worker build). Rates are NOT final; they change here only, after
  the user's approval.
- `src/lib/` — pure logic (ledger / steps / ssv), shared with the Worker build
- `schema.sql` — the same schema as the D1 build, applied automatically
  on first start
- `test/` — `npm test` (node:test, no dependencies): the 23 shared
  logic tests + HTTP integration tests for this build
- `deploy/` — systemd unit, installer, Caddy example, backup tooling
- `VPS_DEPLOY.md` — the full deployment runbook (read this to deploy)

## API

Identical to the Worker build — see `../server/README.md` for the table.
Device auth header: `X-Device-Token: <accountId>.<secret>` (only the
sha256 hash is stored). Admin auth header: `X-Admin-Secret: <ADMIN_SECRET>`.
`/admob/ssv` returns **503** until `ADMOB_SSV_ENABLED=true` (AdMob
registration is an operator step that has not happened yet).

## Run locally

```bash
cd server-node
cp .env.example .env   # fill in ADMIN_SECRET / GIFT_CODE_KEY for admin tests
npm test               # 27 tests
node src/main.js       # http://127.0.0.1:8787 — curl /health to check
```
