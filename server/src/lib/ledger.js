// Pure ledger logic (no I/O) — unit-tested in server/test/ledger.test.js.
//
// Points are NEVER stored as a mutable balance. Every movement is an
// append-only ledger entry carrying explicit bucket deltas:
//   pending   : earned from steps, not yet unlocked by a verified ad view
//   confirmed : unlocked, spendable on gift-card exchange
//   held      : temporarily reserved by a pending exchange request
//   spent     : paid out (terminal)
// Balances are always the SUM of the ledger, so history can be re-audited.

export const ENTRY_TYPES = ["earn", "unlock", "hold", "redeem", "refund", "adjust"];

export function emptyDeltas() {
  return { pending: 0, confirmed: 0, held: 0, spent: 0 };
}

export function computeBalances(entries) {
  const b = emptyDeltas();
  for (const e of entries) {
    b.pending += e.pendingDelta || 0;
    b.confirmed += e.confirmedDelta || 0;
    b.held += e.heldDelta || 0;
    b.spent += e.spentDelta || 0;
  }
  return b;
}

function assertPositiveInt(name, v) {
  if (!Number.isInteger(v) || v <= 0) throw new Error(`${name} must be a positive integer`);
}

// earn: steps converted -> pending grows.
export function earnEntry(points) {
  assertPositiveInt("points", points);
  return { type: "earn", pendingDelta: points, confirmedDelta: 0, heldDelta: 0, spentDelta: 0 };
}

// unlock: one SSV-verified ad view moves up to `chunk` points pending -> confirmed.
// Moves less when the pending balance is smaller; 0 when nothing is pending.
export function unlockEntry(balances, chunk) {
  assertPositiveInt("chunk", chunk);
  const move = Math.min(chunk, Math.max(0, balances.pending));
  return {
    moved: move,
    entry:
      move > 0
        ? { type: "unlock", pendingDelta: -move, confirmedDelta: move, heldDelta: 0, spentDelta: 0 }
        : null,
  };
}

// hold: an exchange request reserves confirmed points.
export function holdEntry(balances, points) {
  assertPositiveInt("points", points);
  if (balances.confirmed < points) throw new Error("insufficient confirmed points");
  return { type: "hold", pendingDelta: 0, confirmedDelta: -points, heldDelta: points, spentDelta: 0 };
}

// redeem: approval pays out held points (terminal).
export function redeemEntry(balances, points) {
  assertPositiveInt("points", points);
  if (balances.held < points) throw new Error("insufficient held points");
  return { type: "redeem", pendingDelta: 0, confirmedDelta: 0, heldDelta: -points, spentDelta: points };
}

// refund: rejection returns held points to confirmed.
export function refundEntry(balances, points) {
  assertPositiveInt("points", points);
  if (balances.held < points) throw new Error("insufficient held points");
  return { type: "refund", pendingDelta: 0, confirmedDelta: points, heldDelta: -points, spentDelta: 0 };
}

// adjust: operator correction. Signed, applies to confirmed, may not drive it negative.
export function adjustEntry(balances, delta) {
  if (!Number.isInteger(delta) || delta === 0) throw new Error("delta must be a non-zero integer");
  if (balances.confirmed + delta < 0) throw new Error("adjust would make confirmed negative");
  return { type: "adjust", pendingDelta: 0, confirmedDelta: delta, heldDelta: 0, spentDelta: 0 };
}
