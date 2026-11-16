import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStepDelta, localDateString } from "../src/stepLogic.ts";

test("first reading is baseline only", () => {
  assert.deepEqual(computeStepDelta(null, 5000), { delta: 0, rebooted: false, baseline: 5000 });
});

test("normal delta", () => {
  assert.equal(computeStepDelta(5000, 8123).delta, 3123);
});

test("reboot reset counts the whole current value", () => {
  const r = computeStepDelta(99999, 42);
  assert.equal(r.delta, 42);
  assert.equal(r.rebooted, true);
});

test("invalid counter throws", () => {
  assert.throws(() => computeStepDelta(0, -5));
});

test("localDateString formats with zero padding", () => {
  assert.equal(localDateString(new Date(2026, 0, 5)), "2026-01-05");
  assert.equal(localDateString(new Date(2026, 10, 16)), "2026-11-16");
});
