import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeBalances, earnEntry, unlockEntry, holdEntry, redeemEntry, refundEntry, adjustEntry,
} from "../src/lib/ledger.js";

test("earn accumulates into pending", () => {
  const b = computeBalances([earnEntry(100), earnEntry(50)]);
  assert.deepEqual(b, { pending: 150, confirmed: 0, held: 0, spent: 0 });
});

test("unlock moves a chunk pending -> confirmed", () => {
  const entries = [earnEntry(100)];
  const { moved, entry } = unlockEntry(computeBalances(entries), 20);
  assert.equal(moved, 20);
  entries.push(entry);
  const b = computeBalances(entries);
  assert.equal(b.pending, 80);
  assert.equal(b.confirmed, 20);
});

test("unlock moves less when pending is smaller than the chunk", () => {
  const { moved, entry } = unlockEntry(computeBalances([earnEntry(7)]), 20);
  assert.equal(moved, 7);
  assert.equal(entry.pendingDelta, -7);
});

test("unlock with zero pending is a no-op", () => {
  const { moved, entry } = unlockEntry(computeBalances([]), 20);
  assert.equal(moved, 0);
  assert.equal(entry, null);
});

test("hold -> redeem spends held points", () => {
  const entries = [earnEntry(100)];
  entries.push(unlockEntry(computeBalances(entries), 100).entry);
  entries.push(holdEntry(computeBalances(entries), 60));
  let b = computeBalances(entries);
  assert.deepEqual([b.confirmed, b.held], [40, 60]);
  entries.push(redeemEntry(computeBalances(entries), 60));
  b = computeBalances(entries);
  assert.deepEqual([b.held, b.spent], [0, 60]);
});

test("hold -> refund returns points to confirmed", () => {
  const entries = [earnEntry(50)];
  entries.push(unlockEntry(computeBalances(entries), 50).entry);
  entries.push(holdEntry(computeBalances(entries), 50));
  entries.push(refundEntry(computeBalances(entries), 50));
  const b = computeBalances(entries);
  assert.deepEqual([b.confirmed, b.held, b.spent], [50, 0, 0]);
});

test("hold beyond confirmed balance throws", () => {
  assert.throws(() => holdEntry(computeBalances([earnEntry(10)]), 20), /insufficient/);
});

test("adjust cannot drive confirmed negative", () => {
  const b = computeBalances([earnEntry(10)]);
  assert.throws(() => adjustEntry(b, -5), /negative/); // confirmed is 0
  const ok = adjustEntry({ ...b, confirmed: 10 }, -5);
  assert.equal(ok.confirmedDelta, -5);
});

test("entries reject non-positive amounts", () => {
  assert.throws(() => earnEntry(0));
  assert.throws(() => earnEntry(1.5));
});
