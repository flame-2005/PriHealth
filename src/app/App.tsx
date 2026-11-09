import React, { useEffect, useRef } from 'react';
import {
  Alert,
  Appearance,
  AppState,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Navigation from '../navigation';
import { Colors } from '../theme';
import { useAppStore } from '../store/useAppStore';
import { DEMO_SEED } from '../config';
import { getDb } from '../db';
import { bodyRepo } from '../db/repositories/bodyRepo';
import { dayKey } from '../domain/time';
import { kgToDisplay, round, weightUnitLabel } from '../domain/units';
import { startNotificationRelay } from '../integrations/devices/notifications';
import { onEvent, restoreAutoConnect, syncAll } from '../integrations/devices/session';
import { hasActivityPermission } from '../permissions';
import { clearDemoData, seedDemoData } from '../tracking/demoSeed';
import { startLiveSteps, syncSteps } from '../tracking/stepTracker';
import { addHeartRate } from '../tracking/workoutSession';

/** Reads the phone step counter on launch, on every foreground, and live while open. */
function useStepTracking(enabled: boolean) {
  const bump = useAppStore(s => s.bump);
  const lastBump = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let stopLive: (() => void) | null = null;
    const throttledBump = () => {
      const now = Date.now();
      if (now - lastBump.current > 4000) {
        lastBump.current = now;
        bump();
      }
    };
    const start = async () => {
      if (!(await hasActivityPermission())) return;
      // Cleaned up while the permission check was pending: starting now would leak the sensor listener.
      if (cancelled) return;
      syncSteps()
        .then(added => {
          if (added > 0) bump();
        })
        .catch(() => {});
      stopLive?.();
      stopLive = startLiveSteps(throttledBump);
    };
    start();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') start();
      else {
        stopLive?.();
        stopLive = null;
      }
    });
    return () => {
      cancelled = true;
      sub.remove();
      stopLive?.();
    };
  }, [enabled, bump]);
}

/** Brings back the devices marked auto-connect on launch, and pulls their history on every foreground. */
function useDeviceLinks(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    restoreAutoConnect().catch(() => {});
    const stopRelay = startNotificationRelay();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') syncAll().catch(() => {});
    });
    return () => {
      sub.remove();
      stopRelay();
    };
  }, [enabled]);
}

/** Feeds live heart rate from a connected strap into a running workout and persists it periodically. */
function useSessionHeartRate() {
  const liveHr = useAppStore(s => s.liveHr);
  const status = useAppStore(s => s.session.status);

  useEffect(() => {
    if (!liveHr) return;
    const st = useAppStore.getState();
    if (st.session.status === 'running')
      st.setSession(addHeartRate(st.session, liveHr.bpm, liveHr.atMs), false);
  }, [liveHr]);

  useEffect(() => {
    if (status === 'idle') return;
    const id = setInterval(
      () => useAppStore.getState().persistSession(),
      15_000,
    );
    return () => clearInterval(id);
  }, [status]);
}

/** Offers to save readings from a connected Bluetooth scale, whichever screen is open. */
function useScaleReadings() {
  useEffect(
    () =>
      onEvent((deviceId, e) => {
        if (e.type !== 'scale') return;
        const { unitSystem, bump } = useAppStore.getState();
        const now = Date.now();
        const sourceId = `ble:${deviceId}`;
        if (e.weight) {
          const kg = e.weight.kg;
          Alert.alert(
            'Scale reading',
            `Save ${round(kgToDisplay(kg, unitSystem), 1)} ${weightUnitLabel(
              unitSystem,
            )}?`,
            [
              { text: 'Ignore', style: 'cancel' },
              {
                text: 'Save',
                onPress: () => {
                  bodyRepo
                    .insert({
                      kind: 'weight',
                      value: kg,
                      unit: 'kg',
                      atMs: now,
                      day: dayKey(now),
                      sourceId,
                    })
                    .then(bump)
                    .catch(() => {});
                },
              },
            ],
          );
        }
        const fat = e.body?.bodyFatPercent;
        if (fat != null) {
          bodyRepo
            .insert({
              kind: 'body_fat',
              value: fat,
              unit: '%',
              atMs: now,
              day: dayKey(now),
              sourceId,
            })
            .then(bump)
            .catch(() => {});
        }
      }),
    [],
  );
}

export default function App() {
  const hydrated = useAppStore(s => s.hydrated);
  const onboarded = useAppStore(s => s.onboarded);

  useEffect(() => {
    Appearance.setColorScheme('dark');
    getDb()
      // A real build also sweeps out rows left behind by an earlier demo build.
      .then(() => (DEMO_SEED ? seedDemoData() : clearDemoData()))
      .then(changed => {
        if (changed) useAppStore.getState().bump();
      })
      .catch(() => {});
    useAppStore.getState().hydrate();
  }, []);

  useStepTracking(hydrated && onboarded);
  useDeviceLinks(hydrated && onboarded);
  useSessionHeartRate();
  useScaleReadings();

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />
      {hydrated ? (
        <Navigation initialRoute={onboarded ? 'Main' : 'Onboarding'} />
      ) : (
        <View style={styles.splash} />
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, backgroundColor: Colors.background },
});
