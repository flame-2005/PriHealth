import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ArrowLeft } from 'lucide-react-native';
import { Screen } from '../components/Screen';
import { Card, SectionHeader } from '../components/Card';
import { Button } from '../components/Button';
import { Colors, Spacing, Typography } from '../theme';
import type { RootNav } from '../navigation/types';

const SECTIONS: Array<{ title: string; body: string }> = [
  {
    title: 'No account, no server',
    body: 'There is nothing to sign up for. PrivateFit has no backend and no analytics. The app never asks Android for internet access, which you can verify under Settings > Apps > PrivateFit > Permissions: there is no network permission to grant.',
  },
  {
    title: 'What is stored, and where',
    body: 'Steps (from the phone sensor, or from a connected device), workouts, sleep, heart rate, SpO2, weight and body-composition readings, and the Bluetooth devices you have paired. All of it lives in a database inside the app sandbox on this phone. Android backups are disabled for this app.',
  },
  {
    title: 'Bluetooth devices',
    body: 'Watches, bands, rings, heart-rate straps and scales are read directly over Bluetooth, so no vendor app, cloud or login is involved. The app only sends a device what it needs to read your data and to set its clock, your profile and its measurement settings. Nothing about you leaves the phone. A device connects when you tap Connect, or on its own if you turn on auto-connect for it.',
  },
  {
    title: 'Phone notifications on your watch',
    body: 'Off unless you turn it on for a device. It needs Android notification access, which you grant on a system page. Each notification is passed to that device over Bluetooth once and is never stored or sent anywhere else.',
  },
  {
    title: 'Why this matters',
    body: 'Research shows that "anonymised" wearable data is not anonymous: one day of raw movement data can re-identify a person with about 96% accuracy. The only safe design is to never upload it, so this app does not.',
  },
  {
    title: 'You can leave any time',
    body: 'Export everything as JSON or CSV from Settings, or delete all data with one tap. Uninstalling the app removes everything as well.',
  },
];

export default function PrivacyScreen() {
  const nav = useNavigation<RootNav>();
  return (
    <Screen
      title="Privacy"
      subtitle="The whole policy fits on one screen"
      right={<Button title="Back" variant="ghost" small icon={<ArrowLeft color={Colors.text} size={16} />} onPress={() => nav.goBack()} />}>
      {SECTIONS.map(s => (
        <React.Fragment key={s.title}>
          <SectionHeader title={s.title} />
          <Card>
            <Text style={styles.body}>{s.body}</Text>
          </Card>
        </React.Fragment>
      ))}
      <Text style={styles.foot}>Last updated October 2026.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { ...Typography.body, lineHeight: 22, color: Colors.text },
  foot: { ...Typography.caption, color: Colors.textDim, textAlign: 'center', marginTop: Spacing.lg },
});
