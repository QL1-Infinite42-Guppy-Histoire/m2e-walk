// Integration test for the Node build: boots the real server (src/main.js)
// on an ephemeral port with a throwaway SQLite file and walks the main
// flows over HTTP — register -> step report -> daily cap -> balances ->
// exchange guard -> SSV disabled -> admin auth.
// The pure-logic tests (ledger/steps/ssv) live in the sibling test files,
// shared with the Worker build.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ADMIN = "test-admin-secret-for-integration-test";

let base;
let proc;
let tmp;

async function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

async function waitForHealth(port) {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("server did not come up");
}

before(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  tmp = mkdtempSync(join(tmpdir(), "m2e-walk-test-"));
  proc = spawn(process.execPath, [join(root, "src", "main.js")], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      DB_PATH: join(tmp, "test.db"),
      ADMIN_SECRET: ADMIN,
      ADMOB_SSV_ENABLED: "off",
    },
    stdio: "ignore",
  });
  await waitForHealth(port);
});

after(() => {
  proc?.kill("SIGTERM");
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

async function call(method, path, { token, admin, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers["x-device-token"] = token;
  if (admin) headers["x-admin-secret"] = admin;
  const r = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}

const today = () => new Date().toISOString().slice(0, 10);

test("health reports SSV disabled", async () => {
  const { status, json } = await call("GET", "/health");
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.equal(json.ssvEnabled, false);
});

test("SSV endpoint is 503 while AdMob is not registered", async () => {
  const { status, json } = await call("GET", "/admob/ssv?transaction_id=x&custom_data=y");
  assert.equal(status, 503);
  assert.equal(json.error, "ssv_disabled");
});

test("full flow: register -> report -> cap -> balances -> guards", async () => {
  // register
  const reg = await call("POST", "/register", { body: {} });
  assert.equal(reg.status, 201);
  const token = reg.json.deviceToken;
  assert.ok(token && token.includes("."));

  // unauthenticated /me is rejected
  const noAuth = await call("GET", "/me");
  assert.equal(noAuth.status, 401);

  // first report: 15,000 steps over 2 hours (plausible) -> 150 pt pending
  const r1 = await call("POST", "/steps/report", {
    token,
    body: { deltaSteps: 15000, clientDate: today(), elapsedMs: 2 * 3600 * 1000 },
  });
  assert.equal(r1.status, 200);
  assert.equal(r1.json.acceptedSteps, 15000);
  assert.equal(r1.json.pointsEarned, 150);
  assert.equal(r1.json.balances.pending, 150);

  // second report the same day: only 5,000 more fit under the 20,000 cap
  const r2 = await call("POST", "/steps/report", {
    token,
    body: { deltaSteps: 10000, clientDate: today(), elapsedMs: 2 * 3600 * 1000 },
  });
  assert.equal(r2.status, 200);
  assert.equal(r2.json.acceptedSteps, 5000);
  assert.ok(r2.json.flags.includes("daily_cap_reached"));

  // balances + today's steps via /me
  const me = await call("GET", "/me", { token });
  assert.equal(me.status, 200);
  assert.equal(me.json.balances.pending, 200);
  assert.equal(me.json.balances.confirmed, 0);
  assert.equal(me.json.todayAcceptedSteps, 20000);
  assert.equal(me.json.config.ratesFinal, false);

  // exchange needs CONFIRMED points: pending-only balance must be refused
  const ex = await call("POST", "/exchange/request", { token, body: { points: 2500 } });
  assert.equal(ex.status, 400);
  assert.equal(ex.json.error, "insufficient_confirmed");

  // unknown tier is refused too
  const badTier = await call("POST", "/exchange/request", { token, body: { points: 999 } });
  assert.equal(badTier.status, 400);
  assert.equal(badTier.json.error, "bad_tier");

  // unlock token can be issued (SSV itself stays disabled, so it can
  // never be redeemed in this configuration — by design)
  const ut = await call("POST", "/unlock-token", { token, body: {} });
  assert.equal(ut.status, 200);
  assert.ok(ut.json.unlockToken);
  assert.equal(ut.json.chunkPoints, 20);
});

test("admin endpoints require the admin secret", async () => {
  const noSecret = await call("POST", "/admin/inventory", { body: { codeCipher: "x", amountYen: 500 } });
  assert.equal(noSecret.status, 401);
  const wrong = await call("POST", "/admin/inventory", { admin: "nope", body: { codeCipher: "x", amountYen: 500 } });
  assert.equal(wrong.status, 401);
  const okRes = await call("POST", "/admin/inventory", { admin: ADMIN, body: { codeCipher: "dGVzdC1jaXBoZXI=", amountYen: 500 } });
  assert.equal(okRes.status, 201);
  assert.ok(Number.isInteger(okRes.json.giftId));
});
