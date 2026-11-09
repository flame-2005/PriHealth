import React, { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Bike, Dumbbell, Footprints, PersonStanding, Play, Plus, Waves, Zap } from 'lucide-react-native';
import { Screen } from '../components/Screen';
import { Card, EmptyState, SectionHeader } from '../components/Card';
import { Button } from '../components/Button';
import { ListRow } from '../components/ListRow';
import { Sheet } from '../components/Sheet';
import { Chip } from '../components/Field';
import { Colors, Spacing } from '../theme';
import { useAsyncData } from '../hooks/useData';
import { workoutsRepo } from '../db/repositories/workoutsRepo';
import { formatDayLabel, formatMinutes, formatTime } from '../domain/time';
import { WORKOUT_LABEL, WORKOUT_TYPES, type Workout, type WorkoutType } from '../domain/types';
import { distanceUnitLabel, metersToDisplay } from '../domain/units';
import { useAppStore } from '../store/useAppStore';
import { startSession } from '../tracking/workoutSession';
import type { RootNav } from '../navigation/types';

export function WorkoutIcon({ type, size = 20, color = Colors.primary }: { type: WorkoutType; size?: number; color?: string }) {
  switch (type) {
    case 'walk':
      return <Footprints color={color} size={size} />;
    case 'run':
      return <PersonStanding color={color} size={size} />;
    case 'cycle':
      return <Bike color={color} size={size} />;
    case 'strength':
      return <Dumbbell color={color} size={size} />;
    case 'hiit':
      return <Zap color={color} size={size} />;
    case 'swim':
      return <Waves color={color} size={size} />;
    default:
      return <PersonStanding color={color} size={size} />;
  }
}

export default function ActivityScreen() {
  const nav = useNavigation<RootNav>();
  const session = useAppStore(s => s.session);
  const setSession = useAppStore(s => s.setSession);
  const unit = useAppStore(s => s.unitSystem);
  const bump = useAppStore(s => s.bump);
  const [picker, setPicker] = useState(false);
  const [type, setType] = useState<WorkoutType>('walk');

  const { data: workouts } = useAsyncData(() => workoutsRepo.list(300));

  const groups: Array<{ day: string; items: Workout[] }> = [];
  for (const w of workouts ?? []) {
    const g = groups[groups.length - 1];
    if (g && g.day === w.day) g.items.push(w);
    else groups.push({ day: w.day, items: [w] });
  }

  const remove = (w: Workout) =>
    Alert.alert('Delete workout?', `${WORKOUT_LABEL[w.type]} on ${formatDayLabel(w.day)}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (w.id != null) await workoutsRepo.remove(w.id);
          bump();
        },
      },
    ]);

  return (
    <Screen title="Activity">
      <View style={styles.actions}>
        <Button
          title="Start"
          icon={<Play color={Colors.black} size={16} />}
          onPress={() => setPicker(true)}
          style={styles.action}
          disabled={session.status !== 'idle'}
        />
        <View style={styles.gap} />
        <Button
          title="Log manually"
          variant="secondary"
          icon={<Plus color={Colors.text} size={16} />}
          onPress={() => nav.navigate('ManualWorkout')}
          style={styles.action}
        />
      </View>

      {!workouts?.length ? (
        <Card style={styles.empty}>
          <EmptyState title="No workouts yet" body="Start a timed workout or log one you already did." />
        </Card>
      ) : (
        groups.map(g => (
          <View key={g.day}>
            <SectionHeader title={formatDayLabel(g.day)} />
            <Card>
              {g.items.map((w, i) => (
                <ListRow
                  key={w.id}
                  icon={<WorkoutIcon type={w.type} />}
                  title={`${WORKOUT_LABEL[w.type]} · ${formatMinutes(w.durationS / 60)}`}
                  subtitle={[
                    w.kcal ? `${Math.round(w.kcal)} kcal` : null,
                    w.avgHr ? `avg ${Math.round(w.avgHr)} bpm` : null,
                    w.distanceM ? `${metersToDisplay(w.distanceM, unit).toFixed(2)} ${distanceUnitLabel(unit)}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  right={formatTime(w.startMs)}
                  onPress={() => w.id != null && nav.navigate('WorkoutDetail', { id: w.id })}
                  onLongPress={() => remove(w)}
                  chevron
                  last={i === g.items.length - 1}
                />
              ))}
            </Card>
          </View>
        ))
      )}

      <Sheet visible={picker} title="Start a workout" onClose={() => setPicker(false)}>
        <View style={styles.typeGrid}>
          {WORKOUT_TYPES.map(t => (
            <Chip key={t} label={WORKOUT_LABEL[t]} selected={t === type} onPress={() => setType(t)} />
          ))}
        </View>
        <Button
          title="Start"
          onPress={async () => {
            setPicker(false);
            await setSession(startSession(type));
            nav.navigate('WorkoutSession');
          }}
          style={styles.sheetBtn}
        />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', marginBottom: Spacing.sm },
  action: { flex: 1 },
  gap: { width: Spacing.sm },
  empty: { marginTop: Spacing.md },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: Spacing.sm },
  sheetBtn: { marginTop: Spacing.lg },
});
