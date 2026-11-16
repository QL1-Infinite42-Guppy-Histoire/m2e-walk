// Step-delta logic shared by the app UI. The server implements the same
// algorithm (server/src/lib/steps.js); unit tests live in app/test/.
//
// TYPE_STEP_COUNTER is cumulative since device boot:
// - first reading: baseline only, delta 0
// - current >= previous: delta = current - previous
// - current < previous: device rebooted (counter reset), delta = current

export interface StepDelta {
  delta: number;
  rebooted: boolean;
  baseline: number;
}

export function computeStepDelta(previousCounter: number | null, currentCounter: number): StepDelta {
  if (!Number.isFinite(currentCounter) || currentCounter < 0) {
    throw new Error('invalid current counter');
  }
  if (previousCounter === null) {
    return { delta: 0, rebooted: false, baseline: currentCounter };
  }
  if (currentCounter >= previousCounter) {
    return { delta: Math.floor(currentCounter - previousCounter), rebooted: false, baseline: currentCounter };
  }
  return { delta: Math.floor(currentCounter), rebooted: true, baseline: currentCounter };
}

export function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
