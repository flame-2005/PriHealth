import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Heart, Pause, Play, Square } from 'lucide-react-native';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { Card } from '../components/Card';
import { Colors, Spacing, Typography } from '../theme';
import { useAppStore } from '../store/useAppStore';
import { finishSession, elapsedSeconds, hrSummary, IDLE_SESSION, pauseSession, resumeSession } from '../tracking/workoutSession';
import { formatDuration } from '../domain/time';
import { WORKOUT_LABEL } from '../domain/types';
import { workoutsRepo } from '../db/repositories/workoutsRepo';
import { samplesRepo } from '../db/repositories/samplesRepo';
import { bodyRepo } from '../db/repositories/bodyRepo';
import { hrZone } from '../domain/aggregate';
import type { RootNav } from '../navigation/types';

const ZONE_COLORS = [Colors.textSecondary, Colors.weight, Colors.steps, Colors.energy, Colors.heart];

export default function WorkoutSessionScreen() {
  const nav = useNavigation<RootNav>();
  const session = useAppStore(s => s.session);
  const setSession = useAppStore(s => s.setSession);
  const liveHr = useAppStore(s => s.liveHr);
  const hasDevice = useAppStore(s => Object.keys(s.connected).length > 0);
  const profile = useAppStore(s => s.profile);
  const bump = useAppStore(s => s.bump);
  const [now, setNow] = useState(Date.now());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (session.status === 'idle' && !saving) nav.goBack();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.status]);

  const elapsed = elapsedSeconds(session, now);
  const { avg, max } = hrSummary(session.hr);
  const zone = liveHr ? hrZone(liveHr.bpm, profile.maxHr ?? 190) : null;

  const finish = () =>
    Alert.alert('Finish workout?', `${formatDuration(elapsed)} of ${WORKOUT_LABEL[session.type]}`, [
      { text: 'Keep going', style: 'cancel' },
      {
        text: 'Finish',
        onPress: async () => {
          setSaving(true);
          try {
            const weight = await bodyRepo.latest('weight');
            // Read the session again: heart-rate samples keep arriving while the dialog is open.
            const { workout, samples } = finishSession(useAppStore.getState().session, {
              weightKg: weight?.value ?? null,
              deviceId: useAppStore.getState().liveHr?.deviceId ?? null,
            });
            const id = await workoutsRepo.insert(workout);
            if (samples.length && id != null) {
              // The workout row already holds avg/max HR, so a failure here only costs the chart.
              // It must not stop the session from closing, or a retry would save the workout twice.
              await samplesRepo
                .insertMany(samples.map((s, i) => ({ ...s, externalId: `workout:${id}:${i}` })))
                .catch(() => {});
            }
            await setSession(IDLE_SESSION);
            bump();
            if (id != null) nav.replace('WorkoutDetail', { id });
            else nav.goBack();
          } catch (e) {
            Alert.alert('Could not save workout', e instanceof Error ? e.message : String(e));
          } finally {
            setSaving(false);
          }
        },
      },
    ]);

  const discard = () =>
    Alert.alert('Discard workout?', 'Nothing will be saved.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        // The effect above leaves this screen once the session is idle. A goBack here as well would
        // pop twice, and the extra one lands on the tab bar underneath and switches it to Today.
        onPress: () => setSession(IDLE_SESSION),
      },
    ]);

  return (
    <Screen scroll={false} contentStyle={styles.content} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.top}>
        <Text style={styles.type}>{WORKOUT_LABEL[session.type]}</Text>
        <Text style={styles.status}>{session.status === 'paused' ? 'Paused' : 'Recording'}</Text>
      </View>

      <View style={styles.center}>
        <Text style={styles.timer}>{formatDuration(elapsed)}</Text>
        <Card style={styles.hrCard}>
          <View style={styles.hrRow}>
            <Heart color={zone ? ZONE_COLORS[zone - 1] : Colors.textDim} size={28} />
            <Text style={[styles.hr, { color: zone ? ZONE_COLORS[zone - 1] : Colors.textDim }]}>
              {liveHr ? liveHr.bpm : '--'}
            </Text>
            <Text style={styles.bpm}>bpm{zone ? ` · zone ${zone}` : ''}</Text>
          </View>
          <Text style={styles.hrHint}>
            {liveHr
              ? `avg ${avg ?? '--'} · max ${max ?? '--'} · ${session.hr.length} samples`
              : hasDevice
              ? 'Waiting for the sensor...'
              : 'Connect a heart-rate strap under More > Devices to record HR.'}
          </Text>
        </Card>
      </View>

      <View style={styles.controls}>
        {session.status === 'running' ? (
          <Button
            title="Pause"
            variant="secondary"
            icon={<Pause color={Colors.text} size={18} />}
            onPress={() => setSession(pauseSession(session))}
            style={styles.control}
          />
        ) : (
          <Button
            title="Resume"
            icon={<Play color={Colors.black} size={18} />}
            onPress={() => setSession(resumeSession(session))}
            style={styles.control}
          />
        )}
        <View style={styles.gap} />
        <Button
          title="Finish"
          icon={<Square color={Colors.black} size={18} />}
          onPress={finish}
          style={styles.control}
          loading={saving}
        />
      </View>
      <Button title="Discard" variant="ghost" onPress={discard} style={styles.discard} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: 'space-between' },
  top: { alignItems: 'center', marginTop: Spacing.lg },
  type: { ...Typography.h2 },
  status: { ...Typography.label, color: Colors.primary, marginTop: 4, textTransform: 'uppercase', letterSpacing: 1 },
  center: { alignItems: 'center' },
  timer: { fontSize: 72, fontWeight: '700', color: Colors.text, fontVariant: ['tabular-nums'] },
  hrCard: { marginTop: Spacing.lg, width: '100%', alignItems: 'center' },
  hrRow: { flexDirection: 'row', alignItems: 'baseline' },
  hr: { fontSize: 44, fontWeight: '700', marginLeft: Spacing.sm },
  bpm: { ...Typography.bodySecondary, marginLeft: 6 },
  hrHint: { ...Typography.caption, marginTop: Spacing.sm, textAlign: 'center' },
  controls: { flexDirection: 'row' },
  control: { flex: 1 },
  gap: { width: Spacing.sm },
  discard: { marginTop: Spacing.sm },
});
