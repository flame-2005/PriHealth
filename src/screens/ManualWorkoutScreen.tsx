import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ArrowLeft } from 'lucide-react-native';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { Chip, Field } from '../components/Field';
import { SectionHeader } from '../components/Card';
import { Colors, Spacing } from '../theme';
import { WORKOUT_LABEL, WORKOUT_TYPES, type WorkoutType } from '../domain/types';
import { dayKey } from '../domain/time';
import { displayToMeters, distanceUnitLabel, estimateKcal, parseDecimal } from '../domain/units';
import { workoutsRepo } from '../db/repositories/workoutsRepo';
import { bodyRepo } from '../db/repositories/bodyRepo';
import { useAppStore } from '../store/useAppStore';
import type { RootNav } from '../navigation/types';

export default function ManualWorkoutScreen() {
  const nav = useNavigation<RootNav>();
  const unit = useAppStore(s => s.unitSystem);
  const bump = useAppStore(s => s.bump);
  const [type, setType] = useState<WorkoutType>('walk');
  const [minutes, setMinutes] = useState('30');
  const [distance, setDistance] = useState('');
  const [effort, setEffort] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const durationS = Math.round(Number(minutes) * 60);
  const valid = Number.isFinite(durationS) && durationS > 0;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const weight = await bodyRepo.latest('weight');
      const endMs = Date.now();
      const startMs = endMs - durationS * 1000;
      const dist = distance.trim() ? displayToMeters(parseDecimal(distance), unit) : null;
      await workoutsRepo.insert({
        type,
        startMs,
        endMs,
        day: dayKey(startMs),
        durationS,
        distanceM: dist != null && Number.isFinite(dist) && dist > 0 ? Math.round(dist) : null,
        kcal: estimateKcal(type, durationS, weight?.value ?? null),
        effort,
        notes: notes.trim() || null,
        sourceId: 'manual',
      });
      bump();
      nav.goBack();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen
      title="Log a workout"
      right={<Button title="Back" variant="ghost" small icon={<ArrowLeft color={Colors.text} size={16} />} onPress={() => nav.goBack()} />}>
      <SectionHeader title="Type" />
      <View style={styles.grid}>
        {WORKOUT_TYPES.map(t => (
          <Chip key={t} label={WORKOUT_LABEL[t]} selected={t === type} onPress={() => setType(t)} />
        ))}
      </View>

      <SectionHeader title="Details" />
      <Field label="Duration" value={minutes} onChangeText={setMinutes} keyboardType="numeric" suffix="min" />
      <Field
        label="Distance (optional)"
        value={distance}
        onChangeText={setDistance}
        keyboardType="decimal-pad"
        suffix={distanceUnitLabel(unit)}
        placeholder="0"
      />

      <SectionHeader title="Effort (optional)" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
          <Chip key={n} label={String(n)} selected={effort === n} onPress={() => setEffort(effort === n ? null : n)} />
        ))}
      </ScrollView>

      <SectionHeader title="Notes" />
      <Field label="" value={notes} onChangeText={setNotes} placeholder="How did it go?" multiline />

      <Button title="Save workout" onPress={save} disabled={!valid} loading={saving} style={styles.save} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: Spacing.sm },
  save: { marginTop: Spacing.lg },
});
