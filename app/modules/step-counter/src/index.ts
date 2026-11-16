import { requireNativeModule } from 'expo';

interface StepCounterNative {
  hasStepCounter(): boolean;
  hasActivityRecognitionPermission(): boolean;
  getCurrentStepCounter(): Promise<number>;
}

let native: StepCounterNative | null = null;
try {
  native = requireNativeModule<StepCounterNative>('StepCounter');
} catch {
  native = null; // e.g. Expo Go — the sensor module only exists in a dev/release build.
}

export function isStepCounterAvailable(): boolean {
  try {
    return !!native && native.hasStepCounter();
  } catch {
    return false;
  }
}

export function hasActivityRecognitionPermission(): boolean {
  try {
    return !!native && native.hasActivityRecognitionPermission();
  } catch {
    return false;
  }
}

/** Raw TYPE_STEP_COUNTER value (cumulative since boot). Throws on no sensor / no permission / timeout. */
export async function getCurrentStepCounter(): Promise<number> {
  if (!native) throw new Error('STEP_MODULE_UNAVAILABLE');
  return native.getCurrentStepCounter();
}
