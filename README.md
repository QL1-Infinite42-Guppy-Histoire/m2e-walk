# M2E Walk — 歩数アプリ（仮称）

歩くとポイントが貯まり、ギフト券（Amazonギフトカードなど）に交換できる歩数アプリです。
**開発中・未公開です。** これは歩数カウント検証用の初期ビルドで、ギフト券への交換はまだできません。
ポイントの交換レートは調整中です（確定値はサーバー側の設定にのみ置かれ、決まるまでアプリにもこのREADMEにも書きません）。

コミュニティによる開発です（公式アプリではありません）。設計書は別途管理しています。

A walking app (Move to Earn): steps earn points that can be exchanged for gift cards.
**Under development — not released.** This is an early step-counting verification build;
gift-card exchange is not available yet, and point rates are still being finalized
(they live only in the server config, never hard-coded in the app).

Developed by the community. Not an official app.

## Structure

- `app/` — Expo (React Native) Android app
  - `app/modules/step-counter/` — custom Kotlin Expo module reading `Sensor.TYPE_STEP_COUNTER`
    (cumulative value + delta method, reboot-reset detection). Expo Pedometer is NOT used:
    on Android it cannot deliver background updates (see design notes).
  - `app/src/stepLogic.ts` — delta logic shared with the server, unit-tested
- `server/` — Cloudflare Worker + D1 points foundation (append-only ledger,
  step reporting with daily caps, AdMob SSV endpoint — disabled until AdMob
  registration, admin endpoints behind a secret header). Kept as a fallback:
  the available Cloudflare token has no D1 rights, so this build cannot
  be deployed as-is.
- `server-node/` — **the main-line server since 2026-11-17 (user decision:
  paid VPS route).** The same points foundation ported to Node.js + SQLite
  (zero dependencies, D1-compatible DB shim, same tests plus HTTP
  integration tests). Deployment runbook: `server-node/VPS_DEPLOY.md`.
- `.github/workflows/build-apk.yml` — builds the verification APK

## Verification APK

Built by GitHub Actions and published on the GitHub Releases page as a
prerelease (e.g. "歩数検証用 v0.1.0"). It is signed with the debug key so it
can be installed directly for testing.

## What works in v0.1.0

- Hardware step counting on a real device (permission request included)
- Today's steps, provisional pending points, device registration (local mode
  while the server is not deployed)
- Server code: registration / step reports / balances / exchange hold flow /
  SSV verification structure — covered by unit tests, not yet deployed

## Not yet

- Server deployment — the Node + SQLite build (`server-node/`) is ready
  and fully tested; it goes onto the existing VPS once SSH access is
  arranged (see `server-node/VPS_DEPLOY.md`)
- AdMob registration (SSV stays disabled), gift-card inventory (empty),
  public release

## License

MIT
