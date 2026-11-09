import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ArrowLeft, Bluetooth, BluetoothOff, Circle, Heart, RefreshCw, Scale, Watch } from 'lucide-react-native';
import { Screen } from '../components/Screen';
import { Card, EmptyState, SectionHeader } from '../components/Card';
import { Button } from '../components/Button';
import { ListRow } from '../components/ListRow';
import { Colors, Spacing, Typography } from '../theme';
import { useAsyncData } from '../hooks/useData';
import { useLiveHr } from '../hooks/useLiveHr';
import { devicesRepo, type DeviceKind, type SavedDevice } from '../db/repositories/devicesRepo';
import { samplesRepo } from '../db/repositories/samplesRepo';
import { capabilityChips, EXPERIMENTAL_PLATFORMS, FORM_LABEL, PLATFORM_LABEL } from '../domain/devices';
import { isLiveHr } from '../domain/heartRate';
import { describeWhen } from '../domain/time';
import { ensureBlePermissions, hasBlePermissions, isBluetoothOn, listKnownDevices, startScan, type FoundDevice } from '../integrations/ble/manager';
import { mergeFound } from '../integrations/ble/discovery';
import { connectDevice, disconnectDevice, forgetDevice, setAutoConnect, syncNow } from '../integrations/devices/session';
import { useAppStore, type ConnectedDevice, type DeviceLive } from '../store/useAppStore';
import type { RootNav } from '../navigation/types';
import type { Sample } from '../domain/types';

function KindIcon({ kind, color }: { kind: DeviceKind; color: string }) {
  if (kind === 'strap') return <Heart color={color} size={18} />;
  if (kind === 'scale') return <Scale color={color} size={18} />;
  if (kind === 'watch' || kind === 'band') return <Watch color={color} size={18} />;
  if (kind === 'ring') return <Circle color={color} size={18} />;
  return <Bluetooth color={color} size={18} />;
}

const SOURCE_LABEL: Record<FoundDevice['source'], string | null> = { scan: null, paired: 'Paired with phone', connected: 'Connected to phone' };

function foundSubtitle(d: FoundDevice): string {
  return [FORM_LABEL[d.kind], SOURCE_LABEL[d.source], d.rssi != null ? `${d.rssi} dBm` : null].filter(Boolean).join(' · ');
}

/** "the watch", "the ring"; a strap or an unknown device is just "the device". */
function wornName(kind: DeviceKind): string {
  return kind === 'watch' || kind === 'band' || kind === 'ring' ? kind : 'device';
}

function ConnectedCard({ d, live, lastHr, nav }: { d: ConnectedDevice; live: DeviceLive | undefined; lastHr: Sample | null | undefined; nav: RootNav }) {
  const hrLive = isLiveHr(live?.hr);
  const caps = d.capabilities;
  const showsHr = caps.includes('live_hr') || caps.includes('history_hr');
  const history = caps.some(c => c.startsWith('history_') || c === 'workouts');
  const experimental = EXPERIMENTAL_PLATFORMS.includes(d.platform);
  const meta = [FORM_LABEL[d.kind], d.platform !== 'gatt' ? PLATFORM_LABEL[d.platform] : null, d.battery != null ? `battery ${d.battery}%` : null]
    .filter(Boolean)
    .join(' · ');
  const chips = capabilityChips(caps);
  return (
    <Card style={styles.connected}>
      <View style={styles.row}>
        <KindIcon kind={d.kind} color={Colors.primary} />
        <View style={styles.flex}>
          <Text style={Typography.h3}>{d.name ?? 'Unnamed device'}</Text>
          <Text style={Typography.caption}>{meta}</Text>
        </View>
        <Button title="Settings" small variant="ghost" onPress={() => nav.navigate('DeviceSettings', { id: d.id })} />
        <Button title="Disconnect" small variant="secondary" onPress={() => disconnectDevice(d.id)} />
      </View>
      {chips.length ? <Text style={styles.chips}>Shares: {chips.join(' · ')}</Text> : null}
      {experimental ? <Text style={styles.experimental}>Experimental: this platform has not been checked on a real device yet.</Text> : null}
      {showsHr ? (
        <>
          <View style={styles.hrRow}>
            <Heart color={Colors.heart} size={26} />
            <Text style={styles.hr}>{hrLive && live?.hr ? live.hr.bpm : '--'}</Text>
            <Text style={Typography.bodySecondary}>bpm live</Text>
          </View>
          <Text style={styles.hint}>
            {lastHr ? `Last saved ${Math.round(lastHr.value)} bpm ${describeWhen(lastHr.endMs)}.` : 'No reading saved yet.'}
            {d.kind !== 'strap' && !hrLive ? ` Heart rate streams while the ${wornName(d.kind)} is measuring it, for example in a workout.` : ''}
          </Text>
        </>
      ) : null}
      {d.kind === 'scale' ? <Text style={styles.hint}>Step on the scale. Readings will prompt to save.</Text> : null}
      {live?.steps ? (
        <Text style={styles.hint}>
          {live.steps.steps > 0
            ? `${live.steps.steps.toLocaleString()} steps today from the ${wornName(d.kind)}. Today uses this count.`
            : `No steps counted on the ${wornName(d.kind)} yet today. Today keeps the phone's count until it does.`}
        </Text>
      ) : null}
      {history ? (
        <View style={styles.syncRow}>
          <Text style={[Typography.caption, styles.flex]}>
            {d.syncing ? 'Syncing...' : d.lastSyncMs ? `Synced ${describeWhen(d.lastSyncMs)}` : 'Not synced yet'}
          </Text>
          <Button title="Sync now" small variant="secondary" onPress={() => syncNow(d.id).catch(e => Alert.alert('Sync failed', e instanceof Error ? e.message : String(e)))} loading={d.syncing} />
        </View>
      ) : null}
    </Card>
  );
}

export default function DevicesScreen() {
  const nav = useNavigation<RootNav>();
  const connected = useAppStore(s => s.connected);
  const liveByDevice = useAppStore(s => s.liveByDevice);
  // Ticks every few seconds while any reading exists, so "live" turns into the saved reading when a stream stops.
  useLiveHr();
  const bump = useAppStore(s => s.bump);
  const [permission, setPermission] = useState(false);
  const [powered, setPowered] = useState<boolean | null>(null);
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<FoundDevice[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data } = useAsyncData(async () => ({ saved: await devicesRepo.list(), lastHr: await samplesRepo.latest('heart_rate') }));
  const saved = data?.saved;
  const lastHr = data?.lastHr;
  const connectedList = Object.values(connected);

  const refresh = useCallback(async () => {
    setPermission(await hasBlePermissions());
    try {
      setPowered(await isBluetoothOn());
    } catch {
      setPowered(false);
    }
  }, []);

  /** Ends the running scan and its timeout, so an old timeout cannot cut a later scan short. */
  const stopScan = useCallback(() => {
    if (scanTimer.current) clearTimeout(scanTimer.current);
    scanTimer.current = null;
    stopRef.current?.();
    stopRef.current = null;
  }, []);

  useEffect(() => {
    refresh();
    return stopScan;
  }, [refresh, stopScan]);

  const scan = async () => {
    if (!(await ensureBlePermissions())) {
      refresh();
      return;
    }
    setPermission(true);
    if (!(await isBluetoothOn())) {
      setPowered(false);
      return;
    }
    setPowered(true);
    stopScan();
    setFound([]);
    setScanning(true);
    // Devices the phone already knows come first: a watch that is connected to its own app does not
    // advertise, so the scan alone would never show it.
    listKnownDevices().then(known => setFound(prev => known.reduce(mergeFound, prev)));
    stopRef.current = startScan(
      d => setFound(prev => mergeFound(prev, d)),
      e => {
        stopScan();
        setScanning(false);
        Alert.alert('Scan failed', e.message);
      },
    );
    scanTimer.current = setTimeout(() => {
      stopScan();
      setScanning(false);
    }, 12_000);
  };

  const connect = async (id: string, name: string | null) => {
    // A scan and a connect at the same time is how Android hands out error 133.
    stopScan();
    setScanning(false);
    setBusy(id);
    try {
      await connectDevice(id, name);
      bump();
    } catch (e) {
      Alert.alert('Could not connect', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const options = (d: SavedDevice) =>
    Alert.alert(d.name ?? d.id, d.autoConnect ? 'Reconnects on its own whenever it is in range.' : 'Connects only when you tap Connect.', [
      {
        text: d.autoConnect ? 'Stop auto-connect' : 'Auto-connect',
        onPress: async () => {
          await setAutoConnect(d.id, !d.autoConnect);
          bump();
        },
      },
      {
        text: 'Forget',
        style: 'destructive',
        onPress: () =>
          Alert.alert('Forget device?', d.name ?? d.id, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Forget',
              style: 'destructive',
              onPress: async () => {
                await forgetDevice(d.id);
                bump();
              },
            },
          ]),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);

  return (
    <Screen
      title="Devices"
      subtitle="Direct Bluetooth, no vendor app"
      right={<Button title="Back" variant="ghost" small icon={<ArrowLeft color={Colors.text} size={16} />} onPress={() => nav.goBack()} />}>
      {!permission || powered === false ? (
        <Card style={styles.warn}>
          <View style={styles.row}>
            <BluetoothOff color={Colors.warning} size={20} />
            <Text style={styles.warnText}>
              {!permission ? 'Nearby-devices permission is needed to scan.' : 'Bluetooth is turned off.'}
            </Text>
          </View>
          {!permission ? (
            <Button
              title="Allow"
              small
              variant="secondary"
              style={styles.warnBtn}
              onPress={async () => {
                await ensureBlePermissions();
                refresh();
              }}
            />
          ) : null}
        </Card>
      ) : null}

      {connectedList.map(d => (
        <ConnectedCard key={d.id} d={d} live={liveByDevice[d.id]} lastHr={lastHr} nav={nav} />
      ))}

      <Button
        title={scanning ? 'Scanning...' : 'Scan for devices'}
        icon={scanning ? <RefreshCw color={Colors.black} size={16} /> : <Bluetooth color={Colors.black} size={16} />}
        onPress={scan}
        disabled={scanning}
        style={styles.scan}
      />

      {found.length ? (
        <>
          <SectionHeader title="Found nearby" />
          <Card>
            {found.map((d, i) => (
              <ListRow
                key={d.id}
                icon={<KindIcon kind={d.kind} color={Colors.textSecondary} />}
                title={d.name ?? 'Unnamed device'}
                subtitle={foundSubtitle(d)}
                right={
                  connected[d.id] ? (
                    'Connected'
                  ) : (
                    <Button title={busy === d.id ? '...' : 'Connect'} small onPress={() => connect(d.id, d.name)} disabled={busy != null} />
                  )
                }
                last={i === found.length - 1}
              />
            ))}
          </Card>
        </>
      ) : null}

      <SectionHeader title="Saved devices" />
      <Card>
        {!saved?.length ? (
          <EmptyState
            title="No devices yet"
            body="Works now: heart-rate straps (Polar, Garmin HRM, Wahoo, Coospo), watches that expose the standard heart-rate or step profiles (Da Fit based, such as Noise, Fire-Boltt and Colmi), and scales using the standard profiles. Full history sync for Da Fit watches and Colmi rings is in progress."
          />
        ) : (
          saved.map((d, i) => (
            <ListRow
              key={d.id}
              icon={<KindIcon kind={d.kind} color={connected[d.id] ? Colors.primary : Colors.textSecondary} />}
              title={d.name ?? d.id}
              subtitle={connected[d.id] ? 'Connected' : `${FORM_LABEL[d.kind]}${d.autoConnect ? ' · auto-connect' : ''}`}
              right={
                connected[d.id] ? undefined : (
                  <Button title={busy === d.id ? '...' : 'Connect'} small variant="secondary" onPress={() => connect(d.id, d.name)} disabled={busy != null} />
                )
              }
              onPress={() => nav.navigate('DeviceSettings', { id: d.id })}
              onLongPress={() => options(d)}
              chevron
              last={i === saved.length - 1}
            />
          ))
        )}
      </Card>
      <Text style={styles.footer}>Tap a saved device for its settings; long-press for auto-connect or to forget it.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  warn: { backgroundColor: Colors.warningDim, borderColor: Colors.warning, marginBottom: Spacing.md },
  warnText: { ...Typography.body, marginLeft: Spacing.sm, flex: 1 },
  warnBtn: { alignSelf: 'flex-start', marginTop: Spacing.sm },
  connected: { backgroundColor: Colors.primaryDim, borderColor: Colors.primary, marginBottom: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', columnGap: Spacing.sm },
  flex: { flex: 1 },
  chips: { ...Typography.caption, marginTop: Spacing.sm, color: Colors.text },
  experimental: { ...Typography.caption, marginTop: Spacing.xs, color: Colors.warning },
  hrRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: Spacing.md, columnGap: 8 },
  hr: { fontSize: 40, fontWeight: '700', color: Colors.heart },
  hint: { ...Typography.caption, marginTop: Spacing.sm },
  syncRow: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.sm, columnGap: Spacing.sm },
  scan: { marginTop: Spacing.sm },
  footer: { ...Typography.caption, color: Colors.textDim, textAlign: 'center', marginTop: Spacing.sm },
});
