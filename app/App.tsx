import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, PermissionsAndroid, Platform, ScrollView, StyleSheet,
  Text, TouchableOpacity, View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

import {
  getCurrentStepCounter, hasActivityRecognitionPermission, isStepCounterAvailable,
} from './modules/step-counter/src/index';
import { computeStepDelta, localDateString } from './src/stepLogic';
import {
  SERVER_CONNECTED, ensureDeviceRegistration, fetchMe, getStoredRecoveryCode, reportSteps,
  type Balances,
} from './src/api';

const APP_VERSION = Constants.expoConfig?.version ?? '';

const K_LAST_COUNTER = 'sc_last_counter';
const K_TODAY_DATE = 'sc_today_date';
const K_TODAY_STEPS = 'sc_today_steps';
const K_LAST_SYNC = 'sc_last_sync_ms';
const K_LOCAL_TOTAL_STEPS = 'sc_local_total_steps';

async function requestActivityRecognition(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (hasActivityRecognitionPermission()) return true;
  try {
    const perm =
      (PermissionsAndroid.PERMISSIONS as unknown as Record<string, string>).ACTIVITY_RECOGNITION ??
      'android.permission.ACTIVITY_RECOGNITION';
    const result = await PermissionsAndroid.request(perm as never, {
      title: '歩数カウントの許可',
      message: '歩数を数えるために、身体活動（歩数センサー）へのアクセスを許可してください。位置情報は使いません。',
      buttonPositive: '許可する',
      buttonNegative: 'あとで',
    });
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [localOnly, setLocalOnly] = useState(true);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [sensorOk, setSensorOk] = useState(false);
  const [permissionOk, setPermissionOk] = useState(false);
  const [todaySteps, setTodaySteps] = useState(0);
  const [balances, setBalances] = useState<Balances>({ pending: 0, confirmed: 0, held: 0, spent: 0 });
  const [localPendingSteps, setLocalPendingSteps] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);

  const stars = useMemo(
    () =>
      Array.from({ length: 70 }, (_, i) => ({
        left: ((i * 37) % 100) + (i % 5) * 0.7,
        top: ((i * 53) % 100) + (i % 3) * 0.9,
        size: (i % 3) + 1,
        opacity: 0.25 + ((i * 7) % 10) / 18,
      })),
    [],
  );

  const syncSteps = useCallback(async (manual: boolean) => {
    if (!isStepCounterAvailable()) {
      if (manual) setMessage('この端末では歩数センサー（TYPE_STEP_COUNTER）が使えませんでした。');
      return;
    }
    const granted = await requestActivityRecognition();
    setPermissionOk(granted);
    if (!granted) {
      if (manual) setMessage('歩数センサーの許可が必要です。「歩数を更新」から許可してください。');
      return;
    }
    setSyncing(true);
    try {
      const counter = await getCurrentStepCounter();
      const prevRaw = await SecureStore.getItemAsync(K_LAST_COUNTER);
      const prev = prevRaw === null ? null : Number(prevRaw);
      const { delta, rebooted } = computeStepDelta(prev, counter);

      const today = localDateString(new Date());
      const storedDate = await SecureStore.getItemAsync(K_TODAY_DATE);
      const storedToday = storedDate === today ? Number((await SecureStore.getItemAsync(K_TODAY_STEPS)) ?? 0) : 0;
      const newToday = storedToday + delta;
      const lastSyncRaw = await SecureStore.getItemAsync(K_LAST_SYNC);
      const elapsedMs = lastSyncRaw ? Date.now() - Number(lastSyncRaw) : null;

      await SecureStore.setItemAsync(K_LAST_COUNTER, String(counter));
      await SecureStore.setItemAsync(K_TODAY_DATE, today);
      await SecureStore.setItemAsync(K_TODAY_STEPS, String(newToday));
      await SecureStore.setItemAsync(K_LAST_SYNC, String(Date.now()));
      setTodaySteps(newToday);
      setLastSyncAt(Date.now());

      if (SERVER_CONNECTED && delta > 0) {
        const res = await reportSteps({
          deltaSteps: delta,
          clientDate: today,
          counterValue: Math.floor(counter),
          prevCounter: prev === null ? null : Math.floor(prev),
          rebootDetected: rebooted,
          elapsedMs,
        });
        if (res) setBalances(res.balances);
      } else if (!SERVER_CONNECTED) {
        const totalRaw = await SecureStore.getItemAsync(K_LOCAL_TOTAL_STEPS);
        const total = Number(totalRaw ?? 0) + delta;
        await SecureStore.setItemAsync(K_LOCAL_TOTAL_STEPS, String(total));
        setLocalPendingSteps(total);
      }
      if (manual) {
        setMessage(delta > 0 ? `${delta.toLocaleString()} 歩ぶんを同期しました。` : '新しい歩数はありませんでした（基準値を記録しました）。');
      }
    } catch (e) {
      if (manual) setMessage(`歩数を読み取れませんでした: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const reg = await ensureDeviceRegistration();
        setAccountId(reg.accountId);
        setLocalOnly(reg.localOnly);
        setRecoveryCode(await getStoredRecoveryCode());
        setSensorOk(isStepCounterAvailable());
        setPermissionOk(hasActivityRecognitionPermission());
        const storedDate = await SecureStore.getItemAsync(K_TODAY_DATE);
        if (storedDate === localDateString(new Date())) {
          setTodaySteps(Number((await SecureStore.getItemAsync(K_TODAY_STEPS)) ?? 0));
        }
        const totalRaw = await SecureStore.getItemAsync(K_LOCAL_TOTAL_STEPS);
        if (totalRaw) setLocalPendingSteps(Number(totalRaw));
        const lastRaw = await SecureStore.getItemAsync(K_LAST_SYNC);
        if (lastRaw) setLastSyncAt(Number(lastRaw));
        if (SERVER_CONNECTED) {
          const me = await fetchMe();
          if (me) setBalances(me.balances);
        }
        await syncSteps(false);
      } catch (e) {
        setMessage(`初期化でエラー: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setReady(true);
      }
    })();
  }, [syncSteps]);

  const pendingPoints = SERVER_CONNECTED ? balances.pending : Math.floor(localPendingSteps / 100);
  const confirmedPoints = balances.confirmed;

  return (
    <LinearGradient colors={['#0b1030', '#1b2452', '#3a2a63', '#101b3c']} style={styles.root}>
      {stars.map((s, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            left: `${s.left}%` as never,
            top: `${s.top}%` as never,
            width: s.size,
            height: s.size,
            borderRadius: s.size / 2,
            backgroundColor: '#ffffff',
            opacity: s.opacity,
          }}
        />
      ))}
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.title}>M2E歩数アプリ（仮）</Text>
          <Text style={styles.subtitle}>歩いてポイント、ギフト券に交換</Text>
          <View style={styles.chipRow}>
            <View style={styles.chip}><Text style={styles.chipText}>{`検証用 v${APP_VERSION}`}</Text></View>
            <View style={styles.chip}>
              <Text style={styles.chipText}>{SERVER_CONNECTED ? 'サーバー接続中' : 'サーバー未接続（端末内のみ）'}</Text>
            </View>
            <View style={styles.chip}><Text style={styles.chipText}>コミュニティによる開発</Text></View>
          </View>

          {!ready ? (
            <View style={styles.card}><ActivityIndicator color="#2563eb" /><Text style={styles.note}>読み込み中…</Text></View>
          ) : (
            <>
              <View style={styles.card}>
                <Text style={styles.cardLabel}>今日の歩数</Text>
                <Text style={styles.bigNumber}>{todaySteps.toLocaleString()}<Text style={styles.unit}> 歩</Text></Text>
                <Text style={styles.note}>
                  {sensorOk
                    ? permissionOk
                      ? '端末の歩数センサーで数えています。アプリを閉じている間の歩数も、次に開いたときにまとめて同期されます。'
                      : '歩数センサーの許可が必要です。下のボタンから許可してください。'
                    : 'この端末では歩数センサーが使えませんでした。'}
                </Text>
                {lastSyncAt ? (
                  <Text style={styles.note}>最終同期: {new Date(lastSyncAt).toLocaleTimeString('ja-JP')}</Text>
                ) : null}
                <TouchableOpacity style={styles.primaryBtn} onPress={() => syncSteps(true)} disabled={syncing}>
                  <Text style={styles.primaryBtnText}>{syncing ? '同期中…' : '歩数を更新'}</Text>
                </TouchableOpacity>
                {message ? <Text style={styles.message}>{message}</Text> : null}
              </View>

              <View style={styles.card}>
                <Text style={styles.cardLabel}>ポイント</Text>
                <View style={styles.pointsRow}>
                  <View style={styles.pointBox}>
                    <Text style={styles.pointLabel}>未確定ポイント</Text>
                    <Text style={styles.pointValue}>{pendingPoints.toLocaleString()} pt</Text>
                  </View>
                  <View style={styles.pointBox}>
                    <Text style={styles.pointLabel}>確定ポイント</Text>
                    <Text style={styles.pointValue}>{confirmedPoints.toLocaleString()} pt</Text>
                  </View>
                </View>
                <Text style={styles.note}>
                  {SERVER_CONNECTED
                    ? '確定ポイントは、広告視聴がサーバーで確認できた分だけ増えます。'
                    : 'いまはサーバー未接続のため、未確定ポイントはこの端末の中だけの暫定表示です。'}
                  ポイントの交換レートは調整中です（決まり次第お知らせします）。
                </Text>
                <TouchableOpacity style={styles.disabledBtn} disabled>
                  <Text style={styles.disabledBtnText}>広告を見てポイントを確定する（準備中）</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.disabledBtn} disabled>
                  <Text style={styles.disabledBtnText}>ギフト券に交換する（準備中）</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.card}>
                <Text style={styles.cardLabel}>アカウント</Text>
                <Text style={styles.note}>
                  端末登録: {accountId ? '完了' : '未完了'}
                  {localOnly ? '（この端末内での仮登録。サーバー公開後に正式登録されます）' : ''}
                </Text>
                {accountId ? <Text style={styles.mono}>ID: {accountId.slice(0, 8)}…</Text> : null}
                {recoveryCode ? (
                  <Text style={styles.note}>復旧コード: {recoveryCode}（機種変更のときに必要です。メモしておいてください）</Text>
                ) : null}
              </View>

              <View style={styles.card}>
                <Text style={styles.cardLabel}>正直な注意書き</Text>
                <Text style={styles.note}>・歩数の数え方には端末ごとの差があります。</Text>
                <Text style={styles.note}>・同期した日の歩数として数えます。日をまたいで歩いた分は、開いた日の分になります。</Text>
                <Text style={styles.note}>・ポイントは歩いた分の小さなごほうびです。お金が稼げるものではありません。</Text>
                <Text style={styles.note}>・このビルドは歩数カウントの検証用です。ギフト券への交換はまだできません。</Text>
              </View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1 },
  scroll: { padding: 16, paddingBottom: 32 },
  title: { color: '#ffffff', fontSize: 26, fontWeight: '800', marginTop: 8 },
  subtitle: { color: '#cfd8ff', fontSize: 15, marginTop: 4, marginBottom: 12 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { color: '#ffffff', fontSize: 12, fontWeight: '600' },
  card: {
    backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 16, padding: 20, marginBottom: 16,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, elevation: 3,
  },
  cardLabel: { color: '#5c6572', fontSize: 13, fontWeight: '700', marginBottom: 6 },
  bigNumber: { color: '#14181f', fontSize: 44, fontWeight: '800' },
  unit: { fontSize: 18, fontWeight: '600', color: '#5c6572' },
  note: { color: '#374151', fontSize: 14, lineHeight: 21, marginTop: 6 },
  message: { color: '#1d4ed8', fontSize: 14, marginTop: 10, lineHeight: 20 },
  primaryBtn: { backgroundColor: '#2563eb', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, marginTop: 14, alignItems: 'center', minHeight: 48, justifyContent: 'center' },
  primaryBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  disabledBtn: { backgroundColor: '#e5e7eb', borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, marginTop: 10, alignItems: 'center', minHeight: 48, justifyContent: 'center' },
  disabledBtnText: { color: '#6b7280', fontSize: 15, fontWeight: '600' },
  pointsRow: { flexDirection: 'row', gap: 12 },
  pointBox: { flex: 1, backgroundColor: '#eef1f5', borderRadius: 12, padding: 12 },
  pointLabel: { color: '#5c6572', fontSize: 12, fontWeight: '700' },
  pointValue: { color: '#14181f', fontSize: 24, fontWeight: '800', marginTop: 4 },
  mono: { color: '#374151', fontSize: 13, marginTop: 4, fontFamily: 'monospace' },
});
