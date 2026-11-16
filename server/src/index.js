// M2E Walk — Cloudflare Worker API (points foundation, Phase 2 base).
//
// NOT DEPLOYED yet. Deploy steps live in server/README.md.
// Secrets (set with `wrangler secret put`, never in this repo):
//   ADMIN_SECRET          — required in the X-Admin-Secret header for /admin/*
//   GIFT_CODE_KEY         — base64 32-byte AES-GCM key for gift code encryption
//   ADMOB_SSV_ENABLED     — "true" only after AdMob registration is complete
//
// Device auth: header `X-Device-Token: <accountId>.<secret>`.
// Only the sha256 hash of the secret is stored.

import { CONFIG } from "./config.js";
import {
  computeBalances, earnEntry, unlockEntry, holdEntry, redeemEntry, refundEntry,
} from "./lib/ledger.js";
import { validateStepReport, convertSteps } from "./lib/steps.js";
import { verifySsvSignature } from "./lib/ssv.js";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const err = (status, code) => json({ error: code }, status);
const now = () => Date.now();

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const randomToken = (bytes = 24) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

async function getAccount(env, accountId) {
  return env.DB.prepare("SELECT * FROM accounts WHERE id = ?").bind(accountId).first();
}

async function ledgerEntries(env, accountId) {
  const { results } = await env.DB.prepare(
    "SELECT type, pending_delta AS pendingDelta, confirmed_delta AS confirmedDelta, held_delta AS heldDelta, spent_delta AS spentDelta FROM ledger WHERE account_id = ? ORDER BY id",
  ).bind(accountId).all();
  return results;
}
const balancesOf = async (env, accountId) => computeBalances(await ledgerEntries(env, accountId));

async function addLedger(env, accountId, entry, ref = null, memo = null) {
  await env.DB.prepare(
    "INSERT INTO ledger (account_id, type, pending_delta, confirmed_delta, held_delta, spent_delta, ref, memo, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
  ).bind(accountId, entry.type, entry.pendingDelta, entry.confirmedDelta, entry.heldDelta, entry.spentDelta, ref, memo, now()).run();
}

async function authenticate(request, env) {
  const header = request.headers.get("x-device-token") || "";
  const dot = header.indexOf(".");
  if (dot < 1) return null;
  const accountId = header.slice(0, dot);
  const secret = header.slice(dot + 1);
  const account = await getAccount(env, accountId);
  if (!account || account.suspended) return null;
  if ((await sha256Hex(secret)) !== account.token_hash) return null;
  return account;
}

function isAdmin(request, env) {
  const secret = request.headers.get("x-admin-secret");
  return !!env.ADMIN_SECRET && !!secret && secret === env.ADMIN_SECRET;
}

// ---------- handlers ----------

async function handleRegister(request, env) {
  const accountId = crypto.randomUUID();
  const secret = randomToken(32);
  const recoveryCode = randomToken(6).toUpperCase(); // 12 hex chars, shown once in-app
  await env.DB.prepare(
    "INSERT INTO accounts (id, token_hash, recovery_code_hash, created_at, last_seen_at) VALUES (?,?,?,?,?)",
  ).bind(accountId, await sha256Hex(secret), await sha256Hex(recoveryCode), now(), now()).run();
  return json({ accountId, deviceToken: `${accountId}.${secret}`, recoveryCode }, 201);
}

async function handleStepReport(request, env, account) {
  const body = await request.json().catch(() => null);
  if (!body) return err(400, "bad_json");
  const deltaSteps = body.deltaSteps;
  const clientDate = String(body.clientDate || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clientDate)) return err(400, "bad_date");

  const { results } = await env.DB.prepare(
    "SELECT COALESCE(SUM(accepted_steps),0) AS credited FROM step_reports WHERE account_id = ? AND client_date = ?",
  ).bind(account.id, clientDate).all();
  const alreadyCredited = results[0]?.credited || 0;

  let validated;
  try {
    validated = validateStepReport(
      { deltaSteps, elapsedMs: body.elapsedMs ?? null, alreadyCreditedToday: alreadyCredited },
      CONFIG,
    );
  } catch {
    return err(400, "bad_steps");
  }
  const { acceptedSteps, flags } = validated;

  await env.DB.prepare(
    "INSERT INTO step_reports (account_id, client_date, delta_steps, accepted_steps, counter_value, prev_counter, reboot_detected, flags, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
  ).bind(account.id, clientDate, deltaSteps, acceptedSteps, body.counterValue ?? null, body.prevCounter ?? null, body.rebootDetected ? 1 : 0, JSON.stringify(flags), now()).run();

  const { points, newCarry } = convertSteps(account.step_carry, acceptedSteps, CONFIG.stepsPerPoint);
  await env.DB.prepare("UPDATE accounts SET step_carry = ?, last_seen_at = ? WHERE id = ?")
    .bind(newCarry, now(), account.id).run();
  if (points > 0) await addLedger(env, account.id, earnEntry(points), null, `steps:${clientDate}`);

  return json({ acceptedSteps, pointsEarned: points, flags, balances: await balancesOf(env, account.id) });
}

async function handleMe(env, account) {
  const today = new Date().toISOString().slice(0, 10);
  const { results } = await env.DB.prepare(
    "SELECT COALESCE(SUM(accepted_steps),0) AS steps FROM step_reports WHERE account_id = ? AND client_date = ?",
  ).bind(account.id, today).all();
  return json({
    accountId: account.id,
    balances: await balancesOf(env, account.id),
    todayAcceptedSteps: results[0]?.steps || 0,
    config: {
      stepsPerPoint: CONFIG.stepsPerPoint,
      dailyStepCap: CONFIG.dailyStepCap,
      unlockChunkPoints: CONFIG.unlockChunkPoints,
      maxUnlocksPerDay: CONFIG.maxUnlocksPerDay,
      exchangeTiers: CONFIG.exchangeTiers,
      ratesFinal: false, // rates are still being finalized (user approval pending)
    },
  });
}

// The app asks for a one-time token before showing a rewarded ad; the token
// travels in the SSV custom_data and binds the callback to this account.
async function handleUnlockToken(env, account) {
  const token = randomToken(16);
  await env.DB.prepare("INSERT INTO unlock_tokens (token, account_id, expires_at) VALUES (?,?,?)")
    .bind(token, account.id, now() + 10 * 60 * 1000).run();
  return json({ unlockToken: token, chunkPoints: CONFIG.unlockChunkPoints });
}

async function handleSsv(request, env) {
  if (env.ADMOB_SSV_ENABLED !== "true") {
    // AdMob is not registered yet: the endpoint exists but grants nothing.
    return err(503, "ssv_disabled");
  }
  const url = new URL(request.url);
  const queryString = url.search.slice(1);
  let keys;
  try {
    keys = await (await fetch("https://www.gstatic.com/admob/reward/verifier-keys.json")).json();
  } catch {
    return err(502, "keys_unavailable");
  }
  const { ok, reason, params } = await verifySsvSignature(queryString, keys).catch(() => ({ ok: false, reason: "verify_error" }));
  if (!ok) return err(400, `ssv_${reason}`);

  const transactionId = params.get("transaction_id");
  const customData = params.get("custom_data");
  if (!transactionId || !customData) return err(400, "missing_fields");

  const tokenRow = await env.DB.prepare("SELECT * FROM unlock_tokens WHERE token = ?").bind(customData).first();
  if (!tokenRow || tokenRow.used_at || tokenRow.expires_at < now()) return err(400, "bad_unlock_token");
  const account = await getAccount(env, tokenRow.account_id);
  if (!account) return err(400, "bad_account");

  // Daily unlock cap.
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const { results } = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM ad_unlocks WHERE account_id = ? AND created_at >= ?",
  ).bind(account.id, dayStart.getTime()).all();
  if ((results[0]?.n || 0) >= CONFIG.maxUnlocksPerDay) return err(429, "daily_unlock_cap");

  const balances = await balancesOf(env, account.id);
  const { moved, entry } = unlockEntry(balances, CONFIG.unlockChunkPoints);
  try {
    // transaction_id UNIQUE: a replayed callback throws here and grants nothing twice.
    await env.DB.prepare("INSERT INTO ad_unlocks (account_id, transaction_id, points, created_at) VALUES (?,?,?,?)")
      .bind(account.id, transactionId, moved, now()).run();
  } catch {
    return err(409, "duplicate_transaction");
  }
  await env.DB.prepare("UPDATE unlock_tokens SET used_at = ? WHERE token = ?").bind(now(), customData).run();
  if (entry) await addLedger(env, account.id, entry, transactionId, "admob_ssv_unlock");
  return json({ ok: true, unlockedPoints: moved });
}

async function handleExchangeRequest(request, env, account) {
  const body = await request.json().catch(() => null);
  const tier = CONFIG.exchangeTiers.find((t) => t.points === body?.points);
  if (!tier) return err(400, "bad_tier");

  const balances = await balancesOf(env, account.id);
  // Monthly budget guard: stop new requests once this month's payouts + holds reach the cap.
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const { results } = await env.DB.prepare(
    "SELECT COALESCE(SUM(amount_yen),0) AS yen FROM exchange_requests WHERE created_at >= ? AND status IN ('pending_review','approved')",
  ).bind(monthStart.getTime()).all();
  if ((results[0]?.yen || 0) + tier.yen > CONFIG.monthlyBudgetYen) return err(429, "monthly_budget_reached");

  const ageDays = (now() - account.created_at) / 86400000;
  const flags = ageDays < CONFIG.firstExchangeMinAgeDays ? ["first_exchange_age_under_min"] : [];
  try {
    await addLedger(env, account.id, holdEntry(balances, tier.points), null, "exchange_hold");
  } catch {
    return err(400, "insufficient_confirmed");
  }
  const res = await env.DB.prepare(
    "INSERT INTO exchange_requests (account_id, points, amount_yen, created_at, updated_at) VALUES (?,?,?,?,?)",
  ).bind(account.id, tier.points, tier.yen, now(), now()).run();
  return json({ exchangeId: res.meta.last_row_id, status: "pending_review", flags }, 201);
}

async function handleMyExchanges(env, account) {
  const { results } = await env.DB.prepare(
    "SELECT id, points, amount_yen AS amountYen, status, reject_reason AS rejectReason, created_at AS createdAt FROM exchange_requests WHERE account_id = ? ORDER BY id DESC LIMIT 50",
  ).bind(account.id).all();
  return json({ exchanges: results });
}

// ---------- admin (X-Admin-Secret required) ----------

async function handleAdminApprove(request, env, exchangeId) {
  const ex = await env.DB.prepare("SELECT * FROM exchange_requests WHERE id = ?").bind(exchangeId).first();
  if (!ex || ex.status !== "pending_review") return err(404, "not_pending");
  const gift = await env.DB.prepare(
    "SELECT * FROM gift_inventory WHERE status = 'available' AND amount_yen = ? ORDER BY id LIMIT 1",
  ).bind(ex.amount_yen).first();
  const balances = await balancesOf(env, ex.account_id);
  if (!gift) {
    await env.DB.prepare("UPDATE exchange_requests SET status = 'no_stock', updated_at = ? WHERE id = ?").bind(now(), exchangeId).run();
    return json({ ok: false, reason: "no_stock" });
  }
  await addLedger(env, ex.account_id, redeemEntry(balances, ex.points), `exchange:${exchangeId}`);
  await env.DB.prepare("UPDATE gift_inventory SET status = 'assigned', assigned_exchange_id = ? WHERE id = ?").bind(exchangeId, gift.id).run();
  await env.DB.prepare("UPDATE exchange_requests SET status = 'approved', gift_id = ?, updated_at = ? WHERE id = ?").bind(gift.id, now(), exchangeId).run();
  await env.DB.prepare("INSERT INTO admin_audit (action, detail, created_at) VALUES (?,?,?)").bind("approve", `exchange:${exchangeId}`, now()).run();
  return json({ ok: true });
}

async function handleAdminReject(request, env, exchangeId) {
  const body = await request.json().catch(() => ({}));
  const ex = await env.DB.prepare("SELECT * FROM exchange_requests WHERE id = ?").bind(exchangeId).first();
  if (!ex || ex.status !== "pending_review") return err(404, "not_pending");
  const balances = await balancesOf(env, ex.account_id);
  await addLedger(env, ex.account_id, refundEntry(balances, ex.points), `exchange:${exchangeId}`, "exchange_rejected");
  await env.DB.prepare("UPDATE exchange_requests SET status = 'rejected', reject_reason = ?, updated_at = ? WHERE id = ?")
    .bind(String(body?.reason || ""), now(), exchangeId).run();
  await env.DB.prepare("INSERT INTO admin_audit (action, detail, created_at) VALUES (?,?,?)").bind("reject", `exchange:${exchangeId}`, now()).run();
  return json({ ok: true });
}

// Gift codes are registered already-encrypted by the operator tooling
// (AES-GCM with GIFT_CODE_KEY); this endpoint never sees plaintext codes.
async function handleAdminInventory(request, env) {
  const body = await request.json().catch(() => null);
  if (!body?.codeCipher || !Number.isInteger(body?.amountYen)) return err(400, "bad_inventory");
  const res = await env.DB.prepare("INSERT INTO gift_inventory (code_cipher, amount_yen, created_at) VALUES (?,?,?)")
    .bind(body.codeCipher, body.amountYen, now()).run();
  return json({ giftId: res.meta.last_row_id }, 201);
}

// ---------- router ----------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";
    try {
      if (path === "/health") return json({ ok: true, service: "m2e-walk", ssvEnabled: env.ADMOB_SSV_ENABLED === "true" });
      if (path === "/register" && request.method === "POST") return handleRegister(request, env);
      if (path === "/admob/ssv" && request.method === "GET") return handleSsv(request, env);

      if (path.startsWith("/admin/")) {
        if (!isAdmin(request, env)) return err(401, "admin_auth_required");
        if (path === "/admin/inventory" && request.method === "POST") return handleAdminInventory(request, env);
        const m = path.match(/^\/admin\/exchanges\/(\d+)\/(approve|reject)$/);
        if (m && request.method === "POST") {
          return m[2] === "approve" ? handleAdminApprove(request, env, Number(m[1])) : handleAdminReject(request, env, Number(m[1]));
        }
        return err(404, "not_found");
      }

      const account = await authenticate(request, env);
      if (!account) return err(401, "unauthorized");
      if (path === "/steps/report" && request.method === "POST") return handleStepReport(request, env, account);
      if (path === "/me" && request.method === "GET") return handleMe(env, account);
      if (path === "/unlock-token" && request.method === "POST") return handleUnlockToken(env, account);
      if (path === "/exchange/request" && request.method === "POST") return handleExchangeRequest(request, env, account);
      if (path === "/me/exchanges" && request.method === "GET") return handleMyExchanges(env, account);
      return err(404, "not_found");
    } catch (e) {
      return json({ error: "internal", detail: String(e?.message || e) }, 500);
    }
  },
};
