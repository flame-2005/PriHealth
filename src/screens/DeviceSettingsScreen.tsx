import React, { useState } from 'react';
import { Alert, StyleSheet, Switch, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { ArrowLeft } from 'lucide-react-native';
import { Screen } from '../components/Screen';
import { Card, EmptyState, SectionHeader } from '../components/Card';
import { Button } from '../components/Button';
import { ChipRow } from '../components/Field';
import { ListRow } from '../components/ListRow';
import { Colors, Spacing, Typography } from '../theme';
import { useAsyncData } from '../hooks/useData';
import { bodyRepo } from '../db/repositories/bodyRepo';
import { devicesRepo } from '../db/repositories/devicesRepo';
import { capabilityChips, EXPERIMENTAL_PLATFORMS, FORM_LABEL, PLATFORM_LABEL, type DeviceSettings } from '../domain/devices';
import { formatTime } from '../domain/time';
import { kgToDisplay, round, weightUnitLabel } from '../domain/units';
import { ExportFile } from '../bridge/exportFile';
import { NotificationRelay } from '../bridge/notificationRelay';
import { DRIVER_COMMANDS } from '../integrations/devices/drivers';
import { HR_INTERVALS } from '../integrations/devices/drivers/moyoung';
import { deviceTranscript, driverSessions, forgetDevice, setAutoConnect } from '../integrations/devices/session';
import { useAppStore } from '../store/useAppStore';
import type { RootNav, RootStackParamList } from '../navigation/types';

const INTERVAL_LABEL: Record<string, string> = { '0': 'Off', '5': '5 min', '10': '10 min', '20': '20 min', '30': '30 min' };

function fail(e: unknown) {
  Alert.alert('Could not reach the device', e instanceof Error ? e.message : String(e));
}

export default function DeviceSettingsScreen() {
  const nav = useNavigation<RootNav>();
  const { params } = useRoute<RouteProp<RootStackParamList, 'DeviceSettings'>>();
  const id = params.id;
  const connected = useAppStore(s => s.connected[id]);
  const unit = useAppStore(s => s.unitSystem);
  const profile = useAppStore(s => s.profile);
  const bump = useAppStore(s => s.bump);
  const [busy, setBusy] = useState<string | null>(null);

  const { data } = useAsyncData(async () => ({ device: await devicesRepo.get(id), weight: await bodyRepo.latest('weight') }), [id]);
  const device = data?.device;
  const settings: DeviceSettings = device?.settings ?? {};
  const caps = connected?.capabilities ?? device?.capabilities ?? [];
  const platform = connected?.platform ?? device?.platform ?? 'gatt';
  const kind = connected?.kind ?? device?.kind ?? 'unknown';
  const name = connected?.name ?? device?.name ?? id;
  const session = (pick: 'setTime' | 'setProfile' | 'setHrInterval' | 'findDevice') => driverSessions(id).find(s => s[pick]);

  const saveSettings = async (patch: Partial<DeviceSettings>) => {
    await devicesRepo.setSettings(id, { ...settings, ...patch });
    bump();
  };

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const setClock = () =>
    run('clock', async () => {
      const s = session('setTime');
      if (!s) throw new Error('Connect the device first.');
      await s.setTime!(Date.now(), -new Date().getTimezoneOffset());
      Alert.alert('Clock set', `The device was told it is ${formatTime(Date.now())}. Check its face: if it shows a different time, turn "Set the clock on connect" off and report the difference.`);
    });

  const sendProfile = () =>
    run('profile', async () => {
      const s = session('setProfile');
      if (!s) throw new Error('Connect the device first.');
      await s.setProfile!({ heightCm: profile.heightCm, weightKg: data?.weight?.value ?? null, age: null, male: null });
    });

  const applyInterval = (minutes: number) =>
    run('interval', async () => {
      await saveSettings({ hrIntervalMin: minutes });
      const s = session('setHrInterval');
      if (s) await s.setHrInterval!(minutes);
    });

  const find = () =>
    run('find', async () => {
      const s = session('findDevice');
      if (!s) throw new Error('Connect the device first.');
      await s.findDevice!();
    });

  const exportTranscript = () =>
    run('transcript', async () => {
      const t = deviceTranscript(id);
      if (!t) throw new Error('Connect the device first.');
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const path = await ExportFile.saveToDownloads(`privatefit-transcript-${id.replace(/:/g, '')}-${stamp}.json`, 'application/json', JSON.stringify({ device: id, name, platform, frames: t }, null, 2));
      Alert.alert('Transcript saved', path);
    });

  const forget = () =>
    Alert.alert('Forget device?', name, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Forget',
        style: 'destructive',
        onPress: async () => {
          await forgetDevice(id);
          bump();
          nav.goBack();
        },
      },
    ]);

  const hasProfile = profile.heightCm != null && data?.weight != null;
  const interval = String(settings.hrIntervalMin ?? 0);
  const commands = DRIVER_COMMANDS[platform];

  return (
    <Screen
      title={name}
      subtitle={[FORM_LABEL[kind], platform !== 'gatt' ? PLATFORM_LABEL[platform] : null, device?.firmware ? `firmware ${device.firmware}` : null].filter(Boolean).join(' · ')}
      right={<Button title="Back" variant="ghost" small icon={<ArrowLeft color={Colors.text} size={16} />} onPress={() => nav.goBack()} />}>
      {!device && data ? <EmptyState title="This device is not saved" body="Connect it once from the Devices screen." /> : null}
      {EXPERIMENTAL_PLATFORMS.includes(platform) ? (
        <Card style={styles.warn}>
          <Text style={styles.warnText}>Experimental: this platform has not been checked on a real device yet. Turn commands off below if the device misbehaves.</Text>
        </Card>
      ) : null}

      <SectionHeader title="What this device shares" />
      <Card>
        <Text style={Typography.body}>{capabilityChips(caps).join(' · ') || 'Nothing readable yet'}</Text>
        <Text style={styles.note}>{connected ? 'Connected now.' : 'Not connected. Settings that talk to the device need it connected.'}</Text>
      </Card>

      {caps.includes('set_time') ? (
        <>
          <SectionHeader title="Clock" />
          <Card>
            <Text style={Typography.body}>The device will be set to {formatTime(Date.now())}, this phone's time.</Text>
            <Text style={styles.note}>Da Fit watches keep their clock in a fixed-zone convention; the first time, check the watch face after setting it.</Text>
            <Button title="Set clock now" variant="secondary" onPress={setClock} loading={busy === 'clock'} style={styles.btn} />
          </Card>
        </>
      ) : null}

      {caps.includes('user_profile') ? (
        <>
          <SectionHeader title="Profile" />
          <Card>
            <Text style={Typography.body}>
              {hasProfile
                ? `Height ${profile.heightCm} cm, weight ${round(kgToDisplay(data!.weight!.value, unit), 1)} ${weightUnitLabel(unit)}. The device uses them for its own distance and calorie maths.`
                : 'Set your height under Settings and log a weight on the Body tab, then send them to the device.'}
            </Text>
            <Button title="Send to device" variant="secondary" onPress={sendProfile} loading={busy === 'profile'} disabled={!hasProfile} style={styles.btn} />
          </Card>
        </>
      ) : null}

      {caps.includes('hr_interval') ? (
        <>
          <SectionHeader title="Automatic heart-rate measurement" />
          <ChipRow options={HR_INTERVALS.map(String)} value={interval} onChange={v => applyInterval(Number(v))} labels={INTERVAL_LABEL} color={Colors.heart} />
          <Text style={styles.note}>How often the device measures on its own. More often costs battery; off keeps only manual and workout readings.</Text>
        </>
      ) : null}

      {caps.includes('find_device') ? (
        <>
          <SectionHeader title="Find" />
          <Card>
            <Button title="Make the device vibrate" variant="secondary" onPress={find} loading={busy === 'find'} />
          </Card>
        </>
      ) : null}

      {caps.includes('notifications') ? (
        <>
          <SectionHeader title="Phone notifications" />
          <Card>
            <View style={styles.switchRow}>
              <View style={styles.flex}>
                <Text style={Typography.body}>Forward to this device</Text>
                <Text style={styles.note}>Calls, messages and app alerts, sent over Bluetooth and never stored. Needs notification access and auto-connect to work with the app closed.</Text>
              </View>
              <Switch
                value={!!settings.notifications}
                onValueChange={async v => {
                  if (v && !(await NotificationRelay.isEnabled())) {
                    Alert.alert('Allow notification access', 'Android asks for this on a system page. Sideloaded apps may first need Settings > Apps > PrivateFit > Allow restricted settings.', [
                      { text: 'Not now', style: 'cancel' },
                      { text: 'Open settings', onPress: () => NotificationRelay.openSettings() },
                    ]);
                  }
                  await saveSettings({ notifications: v });
                }}
                trackColor={{ true: Colors.primary, false: Colors.border }}
              />
            </View>
          </Card>
        </>
      ) : null}

      <SectionHeader title="Connection" />
      <Card>
        <View style={styles.switchRow}>
          <View style={styles.flex}>
            <Text style={Typography.body}>Auto-connect</Text>
            <Text style={styles.note}>Reconnect whenever the device is in range, keep the link with the app closed, and bring it back after a restart.</Text>
          </View>
          <Switch
            value={!!device?.autoConnect}
            onValueChange={async v => {
              await setAutoConnect(id, v);
              bump();
            }}
            trackColor={{ true: Colors.primary, false: Colors.border }}
          />
        </View>
      </Card>

      {commands ? (
        <>
          <SectionHeader title="Commands" />
          <Card>
            {Object.entries(commands).map(([cmd, sw], i, all) => (
              <ListRow
                key={cmd}
                title={sw.label}
                right={
                  <Switch
                    value={settings.commands?.[cmd] ?? sw.default}
                    onValueChange={v => saveSettings({ commands: { ...settings.commands, [cmd]: v } })}
                    trackColor={{ true: Colors.primary, false: Colors.border }}
                  />
                }
                last={i === all.length - 1}
              />
            ))}
          </Card>
          <Text style={styles.note}>Unconfirmed commands come from published protocol notes and have not been checked against this device yet. Switches apply from the next sync or connect.</Text>
        </>
      ) : null}

      <SectionHeader title="Maintenance" />
      <Card>
        {__DEV__ ? (
          <Button title="Export Bluetooth transcript" variant="secondary" onPress={exportTranscript} loading={busy === 'transcript'} style={styles.btn} />
        ) : null}
        <Button title="Forget this device" variant="danger" onPress={forget} style={styles.btn} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  warn: { backgroundColor: Colors.warningDim, borderColor: Colors.warning, marginBottom: Spacing.md },
  warnText: { ...Typography.body },
  note: { ...Typography.caption, marginTop: Spacing.xs },
  btn: { marginTop: Spacing.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', columnGap: Spacing.sm },
  flex: { flex: 1 },
});
