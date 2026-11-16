# M2E Walk — server (Cloudflare Worker + D1)

ポイント基盤のサーバー側です。**まだデプロイしていません**（コード・設定・スキーマ・ローカルテストまで）。

Points foundation for the M2E walking app. **Not deployed yet.**

## Layout

- `src/index.js` — Worker fetch handler / router
- `src/config.js` — **all rates and limits live here** (steps→points, daily caps, ad unlock chunk, exchange tiers, monthly budget). Rates are NOT final; they change here only, after the user's approval.
- `src/lib/ledger.js` — pure append-only ledger logic (earn / unlock / hold / redeem / refund / adjust)
- `src/lib/steps.js` — pure step-delta + validation logic (daily cap 20,000 steps, plausibility flags)
- `src/lib/ssv.js` — AdMob SSV signature verification (Google verifier keys, transaction_id dedup is enforced by a UNIQUE constraint in D1)
- `schema.sql` — D1 schema
- `test/` — `npm test` (node:test, no dependencies)

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | – | liveness + whether SSV is enabled |
| POST | `/register` | – | create a device account, returns device token + recovery code (shown once) |
| POST | `/steps/report` | device | report a step delta; server caps and converts to pending points |
| GET | `/me` | device | balances (from the ledger), today's accepted steps, public config |
| POST | `/unlock-token` | device | one-time token placed in AdMob SSV `custom_data` |
| GET | `/admob/ssv` | Google signature | SSV callback; **disabled (503) until `ADMOB_SSV_ENABLED=true`** |
| POST | `/exchange/request` | device | request a gift-card exchange (points are held) |
| GET | `/me/exchanges` | device | exchange history / status |
| POST | `/admin/inventory` | admin secret | register an **already-encrypted** gift code |
| POST | `/admin/exchanges/:id/approve` | admin secret | assign a stocked code, redeem held points |
| POST | `/admin/exchanges/:id/reject` | admin secret | refund held points |

Device auth header: `X-Device-Token: <accountId>.<secret>` (only the sha256 hash is stored).
Admin auth header: `X-Admin-Secret: <ADMIN_SECRET>`.

## Deploy (operator steps — not done yet)

```bash
cd server
npm install            # wrangler (devDependency)
npx wrangler login
npx wrangler d1 create m2e-walk        # paste the returned id into wrangler.toml
npx wrangler d1 execute m2e-walk --remote --file=./schema.sql
npx wrangler secret put ADMIN_SECRET
npx wrangler secret put GIFT_CODE_KEY  # base64 of 32 random bytes (AES-GCM key)
npm run deploy
```

Then set `extra.apiBaseUrl` in `app/app.json` to the deployed Worker URL and rebuild the app.

## AdMob setup (operator steps — not done yet)

1. Register the app in AdMob, create a **rewarded** ad unit.
2. In AdMob, set the SSV callback URL to `https://<worker-host>/admob/ssv`.
3. Put the app ID / ad unit ID into the app config (placeholders in `app/app.json` — never commit real IDs before release decisions).
4. Set the worker secret `ADMOB_SSV_ENABLED` to `true`.
5. Use **test ads only** during development. Never view live ads on your own app (invalid traffic).

Until step 4, `/admob/ssv` returns 503 and no points can be confirmed — by design.
