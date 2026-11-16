import { test } from "node:test";
import assert from "node:assert/strict";
import { splitSignedContent, verifySsvSignature } from "../src/lib/ssv.js";

// Generate a throwaway RSA keypair, sign like AdMob would, and verify.
async function makeSignedCallback() {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"],
  );
  const spki = await crypto.subtle.exportKey("spki", pair.publicKey);
  const pem = "-----BEGIN PUBLIC KEY-----\n" +
    Buffer.from(spki).toString("base64").replace(/(.{64})/g, "$1\n") +
    "\n-----END PUBLIC KEY-----";
  const content = "ad_network=5450213213286189855&custom_data=tok123&key_id=1&transaction_id=tx-abc&user_id=u1";
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, new TextEncoder().encode(content));
  const sigB64Url = Buffer.from(sig).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { query: `${content}&signature=${sigB64Url}`, keys: { keys: [{ keyId: 1, pem }] }, content };
}

test("splitSignedContent separates the signed part", () => {
  const { content, signature } = splitSignedContent("a=1&b=2&signature=xyz");
  assert.equal(content, "a=1&b=2");
  assert.equal(signature, "xyz");
});

test("valid AdMob-style signature verifies", async () => {
  const { query, keys } = await makeSignedCallback();
  const r = await verifySsvSignature(query, keys);
  assert.equal(r.ok, true);
  assert.equal(r.params.get("transaction_id"), "tx-abc");
});

test("tampered callback fails verification", async () => {
  const { query, keys } = await makeSignedCallback();
  const r = await verifySsvSignature(query.replace("tx-abc", "tx-evil"), keys);
  assert.equal(r.ok, false);
});

test("unknown key_id is rejected", async () => {
  const { query } = await makeSignedCallback();
  const r = await verifySsvSignature(query, { keys: [{ keyId: 999, pem: "x" }] });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "unknown_key_id");
});

test("missing signature is rejected", async () => {
  const r = await verifySsvSignature("transaction_id=tx-abc", { keys: [] });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "missing_signature");
});
