import { test } from "node:test";
import assert from "node:assert/strict";
import { computeStepDelta, convertSteps, validateStepReport } from "../src/lib/steps.js";
import { CONFIG } from "../src/config.js";

test("first reading is baseline only", () => {
  assert.deepEqual(computeStepDelta(null, 12345), { delta: 0, rebooted: false, baseline: 12345 });
});

test("normal delta", () => {
  assert.equal(computeStepDelta(1000, 3500).delta, 2500);
});

test("no movement", () => {
  assert.equal(computeStepDelta(500, 500).delta, 0);
});

test("reboot reset: current < previous counts the whole current value", () => {
  const r = computeStepDelta(98000, 1200);
  assert.equal(r.delta, 1200);
  assert.equal(r.rebooted, true);
});

test("invalid counter throws", () => {
  assert.throws(() => computeStepDelta(0, -1));
  assert.throws(() => computeStepDelta(0, NaN));
});

test("convertSteps carries the remainder", () => {
  assert.deepEqual(convertSteps(0, 250, 100), { points: 2, newCarry: 50 });
  assert.deepEqual(convertSteps(50, 60, 100), { points: 1, newCarry: 10 });
  assert.deepEqual(convertSteps(99, 1, 100), { points: 1, newCarry: 0 });
});

test("daily cap clips accepted steps", () => {
  const r = validateStepReport({ deltaSteps: 9000, elapsedMs: null, alreadyCreditedToday: 15000 }, CONFIG);
  assert.equal(r.acceptedSteps, 5000);
  assert.ok(r.flags.includes("daily_cap_reached"));
});

test("implausible rate is flagged but not dropped", () => {
  // 10,000 steps in 1 minute is not humanly possible.
  const r = validateStepReport({ deltaSteps: 10000, elapsedMs: 60000, alreadyCreditedToday: 0 }, CONFIG);
  assert.ok(r.flags.includes("implausible_rate"));
  assert.equal(r.acceptedSteps, 10000);
});

test("normal walking rate is not flagged", () => {
  // 6,000 steps over 60 minutes is a normal walk.
  const r = validateStepReport({ deltaSteps: 6000, elapsedMs: 3600000, alreadyCreditedToday: 0 }, CONFIG);
  assert.deepEqual(r.flags, []);
});
