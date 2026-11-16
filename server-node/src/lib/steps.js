// Pure step-report logic (no I/O) — unit-tested in server/test/steps.test.js.
// The SAME delta algorithm is implemented in the app (app/src/stepLogic.ts)
// and mirrored by the Kotlin sensor module's raw counter values.

// TYPE_STEP_COUNTER is cumulative since device boot.
// - first reading: baseline only, delta 0
// - current >= previous: delta = current - previous
// - current < previous: the device rebooted (counter reset to 0),
//   so the whole current value is the delta since boot.
export function computeStepDelta(previousCounter, currentCounter) {
  if (currentCounter == null || !Number.isFinite(currentCounter) || currentCounter < 0) {
    throw new Error("invalid current counter");
  }
  if (previousCounter == null) {
    return { delta: 0, rebooted: false, baseline: currentCounter };
  }
  if (currentCounter >= previousCounter) {
    return { delta: Math.floor(currentCounter - previousCounter), rebooted: false, baseline: currentCounter };
  }
  return { delta: Math.floor(currentCounter), rebooted: true, baseline: currentCounter };
}

// Convert accepted steps to whole points, carrying the sub-100-step remainder.
export function convertSteps(carrySteps, steps, stepsPerPoint) {
  const total = carrySteps + steps;
  return { points: Math.floor(total / stepsPerPoint), newCarry: total % stepsPerPoint };
}

// Validate one report against the daily cap and a plausibility ceiling.
// Returns how many steps may be credited and any flags for human review.
// Flagged reports are still capped, never silently dropped (DESIGN.md §7).
export function validateStepReport({ deltaSteps, elapsedMs, alreadyCreditedToday }, config) {
  const flags = [];
  if (!Number.isInteger(deltaSteps) || deltaSteps < 0) throw new Error("invalid deltaSteps");

  const remainingCap = Math.max(0, config.dailyStepCap - alreadyCreditedToday);
  const accepted = Math.min(deltaSteps, remainingCap);
  if (deltaSteps > remainingCap) flags.push("daily_cap_reached");

  if (elapsedMs != null && elapsedMs > 0 && deltaSteps > 0) {
    const minutes = elapsedMs / 60000;
    const plausibleMax = minutes * config.maxStepsPerMinute + config.plausibilitySlackSteps;
    if (deltaSteps > plausibleMax) flags.push("implausible_rate");
  }
  return { acceptedSteps: accepted, flags };
}
