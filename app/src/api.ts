import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

// The app talks to the points Worker at app.json extra.apiBaseUrl.
// If that is ever empty, the app falls back to local verification mode
// (steps are counted and shown, points are provisional on-device only).
export const API_BASE_URL: string =
  (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)?.apiBaseUrl ?? '';
export const SERVER_CONNECTED = API_BASE_URL.length > 0;

const KEY_DEVICE_TOKEN = 'm2e_device_token';
const KEY_ACCOUNT_ID = 'm2e_account_id';
const KEY_RECOVERY_CODE = 'm2e_recovery_code';

export interface Balances {
  pending: number;
  confirmed: number;
  held: number;
  spent: number;
}

export async function getStoredToken(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY_DEVICE_TOKEN);
}
export async function getStoredAccountId(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY_ACCOUNT_ID);
}
export async function getStoredRecoveryCode(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY_RECOVERY_CODE);
}

// Registers the device with the server when one is configured; otherwise
// creates a local-only identity so the verification build works standalone.
export async function ensureDeviceRegistration(): Promise<{ accountId: string; localOnly: boolean }> {
  const existing = await getStoredToken();
  const existingId = await getStoredAccountId();
  // A token created by a pre-server build ("local.<uuid>") is not a server
  // credential: when a server is configured, fall through and register for
  // real instead of sending the local token (which would 401 forever).
  const usableServerToken = !!existing && !existing.startsWith('local.');
  if (existing && existingId && (!SERVER_CONNECTED || usableServerToken)) {
    return { accountId: existingId, localOnly: !SERVER_CONNECTED };
  }

  if (!SERVER_CONNECTED) {
    const localId = Crypto.randomUUID();
    await SecureStore.setItemAsync(KEY_DEVICE_TOKEN, `local.${localId}`);
    await SecureStore.setItemAsync(KEY_ACCOUNT_ID, localId);
    return { accountId: localId, localOnly: true };
  }

  const res = await fetch(`${API_BASE_URL}/register`, { method: 'POST' });
  if (!res.ok) throw new Error(`register failed: ${res.status}`);
  const data = (await res.json()) as { accountId: string; deviceToken: string; recoveryCode: string };
  await SecureStore.setItemAsync(KEY_DEVICE_TOKEN, data.deviceToken);
  await SecureStore.setItemAsync(KEY_ACCOUNT_ID, data.accountId);
  await SecureStore.setItemAsync(KEY_RECOVERY_CODE, data.recoveryCode);
  return { accountId: data.accountId, localOnly: false };
}

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getStoredToken();
  return fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-device-token': token ?? '', ...(init?.headers ?? {}) },
  });
}

export async function reportSteps(body: {
  deltaSteps: number;
  clientDate: string;
  counterValue: number;
  prevCounter: number | null;
  rebootDetected: boolean;
  elapsedMs: number | null;
}): Promise<{ acceptedSteps: number; pointsEarned: number; balances: Balances } | null> {
  if (!SERVER_CONNECTED) return null;
  const res = await authedFetch('/steps/report', { method: 'POST', body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`report failed: ${res.status}`);
  return res.json();
}

export async function fetchMe(): Promise<{ balances: Balances; todayAcceptedSteps: number } | null> {
  if (!SERVER_CONNECTED) return null;
  const res = await authedFetch('/me');
  if (!res.ok) throw new Error(`me failed: ${res.status}`);
  return res.json();
}
