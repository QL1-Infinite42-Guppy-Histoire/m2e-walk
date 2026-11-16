// AdMob Server-Side Verification (SSV) helpers.
//
// AdMob signs the reward callback query string with a private key; the
// matching public keys are published by Google at:
//   https://www.gstatic.com/admob/reward/verifier-keys.json
// The signature covers the whole query string BEFORE the `signature`
// parameter, in the original order, verified with RSASSA-PKCS1-v1_5 + SHA-256.
// `key_id` in the callback selects which published key to use.
//
// This module only verifies signatures. Whether the endpoint is live at all
// is controlled by the ADMOB_SSV_ENABLED worker secret/var: until the
// operator registers the app with AdMob and turns it on, /admob/ssv stays
// disabled (see src/index.js).

export function splitSignedContent(queryString) {
  const idx = queryString.indexOf("&signature=");
  if (idx === -1) {
    // signature may be the first parameter in theory; AdMob appends it last.
    if (queryString.startsWith("signature=")) return { content: "", signature: null, params: new URLSearchParams(queryString) };
    return { content: queryString, signature: null, params: new URLSearchParams(queryString) };
  }
  const params = new URLSearchParams(queryString);
  return {
    content: queryString.slice(0, idx),
    signature: params.get("signature"),
    params,
  };
}

function base64UrlToBytes(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// keysJson: the parsed verifier-keys.json document: { keys: [{keyId, pem, ...}] }
// AdMob publishes PEM (SubjectPublicKeyInfo) per key.
export async function verifySsvSignature(queryString, keysJson, subtle = globalThis.crypto?.subtle) {
  if (!subtle) throw new Error("WebCrypto subtle is not available");
  const { content, signature, params } = splitSignedContent(queryString);
  if (!signature) return { ok: false, reason: "missing_signature" };
  const keyId = params.get("key_id");
  const key = (keysJson?.keys || []).find((k) => String(k.keyId) === String(keyId));
  if (!key) return { ok: false, reason: "unknown_key_id" };

  const pemBody = key.pem.replace(/-----BEGIN PUBLIC KEY-----/, "").replace(/-----END PUBLIC KEY-----/, "").replace(/\s+/g, "");
  const spki = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const publicKey = await subtle.importKey("spki", spki, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await subtle.verify(
    "RSASSA-PKCS1-v1_5",
    publicKey,
    base64UrlToBytes(signature),
    new TextEncoder().encode(content),
  );
  return { ok, reason: ok ? "verified" : "bad_signature", params };
}
