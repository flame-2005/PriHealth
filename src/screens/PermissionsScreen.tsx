import React, { useCallback, useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { Bell, Bluetooth, Check, Footprints } from 'lucide-react-native';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Colors, Spacing, Typography } from '../theme';
import { hasActivityPermission, hasNotificationPermission, requestActivityPermission, requestNotificationPermission } from '../permissions';
import { ensureBlePermissions, hasBlePermissions } from '../integrations/ble/manager';
import { StepCounter } from '../bridge/stepCounter';
import { NotificationRelay } from '../bridge/notificationRelay';
import { useAppStore } from '../store/useAppStore';
import type { RootNav } from '../navigation/types';

function PermissionCard({
  icon,
  title,
  body,
  granted,
  optional,
  onRequest,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  granted: boolean;
  optional?: boolean;
  onRequest: () => void;
}) {
  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <View style={styles.icon}>{icon}</View>
        <View style={styles.text}>
          <Text style={Typography.h3}>
            {title}
            {optional ? <Text style={styles.optional}>  optional</Text> : null}
          </Text>
          <Text style={styles.body}>{body}</Text>
        </View>
      </View>
      {granted ? (
        <View style={styles.granted}>
          <Check color={Colors.success} size={16} />
          <Text style={styles.grantedText}>Allowed</Text>
        </View>
      ) : (
        <Button title="Allow" onPress={onRequest} small variant="secondary" style={styles.btn} />
      )}
    </Card>
  );
}

export default function PermissionsScreen() {
  const nav = useNavigation<RootNav>();
  const setOnboarded = useAppStore(s => s.setOnboarded);
  const [activity, setActivity] = useState(false);
  const [ble, setBle] = useState(false);
  const [notify, setNotify] = useState(false);
  const [relay, setRelay] = useState(false);
  const [sensor, setSensor] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    setActivity(await hasActivityPermission());
    setBle(await hasBlePermissions());
    setNotify(await hasNotificationPermission());
    setRelay(await NotificationRelay.isEnabled());
    setSensor(await StepCounter.isSupported());
  }, []);

  useEffect(() => {
    refresh();
    // Notification access is granted on a system page; re-check when the user comes back.
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const finish = async () => {
    await setOnboarded(true);
    nav.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'Main' }] }));
  };

  return (
    <Screen title="Permissions" subtitle="Everything stays on this phone. Nothing is uploaded.">
      <PermissionCard
        icon={<Footprints color={Colors.steps} size={24} />}
        title="Physical activity"
        body={
          sensor === false
            ? 'This phone has no hardware step counter. You can still log workouts, sleep and weight.'
            : 'Reads the phone step sensor to count steps in the background.'
        }
        granted={activity}
        onRequest={async () => {
          await requestActivityPermission();
          refresh();
        }}
      />
      <PermissionCard
        icon={<Bluetooth color={Colors.weight} size={24} />}
        title="Nearby devices"
        body="Connect a watch, ring, heart-rate strap or smart scale directly over Bluetooth. No vendor app or account is needed."
        granted={ble}
        optional
        onRequest={async () => {
          await ensureBlePermissions();
          refresh();
        }}
      />
      <PermissionCard
        icon={<Bell color={Colors.energy} size={24} />}
        title="Notifications"
        body="Shows one quiet notification while a watch, band or ring stays connected in the background."
        granted={notify}
        optional
        onRequest={async () => {
          await requestNotificationPermission();
          refresh();
        }}
      />
      <PermissionCard
        icon={<Bell color={Colors.primary} size={24} />}
        title="Notification access"
        body="Lets the app forward calls, messages and app alerts to your watch. Only used for devices where you turn that on; nothing is stored. Sideloaded apps may need Settings > Apps > PrivateFit > Allow restricted settings first."
        granted={relay}
        optional
        onRequest={() => NotificationRelay.openSettings()}
      />
      <Button title="Continue" onPress={finish} style={styles.continue} />
      <Text style={styles.footnote}>
        You can change these later in Android settings. The app never asks for internet access.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: Spacing.md },
  row: { flexDirection: 'row' },
  icon: { width: 36, marginRight: Spacing.sm, paddingTop: 2 },
  text: { flex: 1 },
  body: { ...Typography.bodySecondary, marginTop: 4, lineHeight: 20 },
  optional: { ...Typography.caption, color: Colors.textDim },
  granted: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.md },
  grantedText: { ...Typography.label, color: Colors.success, marginLeft: 6 },
  btn: { alignSelf: 'flex-start', marginTop: Spacing.md },
  continue: { marginTop: Spacing.lg },
  footnote: { ...Typography.caption, textAlign: 'center', marginTop: Spacing.md },
});
