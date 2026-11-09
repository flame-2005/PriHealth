import React from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { ArrowLeft, Trash2 } from 'lucide-react-native';
import { Screen } from '../components/Screen';
import { Card, SectionHeader } from '../components/Card';
import { Button } from '../components/Button';
import { StatTile } from '../components/StatTile';
import { TrendChart } from '../components/TrendChart';
import { Colors, Spacing, Typography } from '../theme';
import { useAsyncData } from '../hooks/useData';
import { workoutsRepo } from '../db/repositories/workoutsRepo';
import { samplesRepo } from '../db/repositories/samplesRepo';
import { downsample } from '../domain/aggregate';
import { formatDayLabel, formatDuration, formatTime } from '../domain/time';
import { WORKOUT_LABEL } from '../domain/types';
import { distanceUnitLabel, metersToDisplay, round } from '../domain/units';
import { useAppStore } from '../store/useAppStore';
import type { RootNav, RootStackParamList } from '../navigation/types';

export default function WorkoutDetailScreen() {
  const nav = useNavigation<RootNav>();
  const { params } = useRoute<RouteProp<RootStackParamList, 'WorkoutDetail'>>();
  const unit = useAppStore(s => s.unitSystem);
  const bump = useAppStore(s => s.bump);

  const { data } = useAsyncData(async () => {
    const w = await workoutsRepo.byId(params.id);
    if (!w) return null;
    const hr = await samplesRepo.range('heart_rate', w.startMs, w.endMs + 1);
    const pts = downsample(
      hr.map(s => ({ x: s.startMs, y: s.value })),
      120,
    );
    return { w, hr: pts.map((p, i) => ({ day: String(i), value: p.y })) };
  }, [params.id]);

  const remove = () =>
    Alert.alert('Delete workout?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await workoutsRepo.remove(params.id);
          bump();
          nav.goBack();
        },
      },
    ]);

  const w = data?.w;
  return (
    <Screen
      title={w ? WORKOUT_LABEL[w.type] : 'Workout'}
      subtitle={w ? `${formatDayLabel(w.day)} · ${formatTime(w.startMs)} - ${formatTime(w.endMs)}` : undefined}
      right={
        <Button title="Back" variant="ghost" small icon={<ArrowLeft color={Colors.text} size={16} />} onPress={() => nav.goBack()} />
      }>
      {w ? (
        <>
          <View style={styles.row}>
            <StatTile label="Duration" value={formatDuration(w.durationS)} color={Colors.primary} />
            <View style={styles.gap} />
            <StatTile label="Calories" value={w.kcal ? String(Math.round(w.kcal)) : '--'} unit="kcal" color={Colors.energy} />
          </View>
          <View style={styles.row}>
            <StatTile label="Avg HR" value={w.avgHr ? String(Math.round(w.avgHr)) : '--'} unit="bpm" color={Colors.heart} />
            <View style={styles.gap} />
            <StatTile label="Max HR" value={w.maxHr ? String(Math.round(w.maxHr)) : '--'} unit="bpm" color={Colors.heart} />
          </View>
          <View style={styles.row}>
            <StatTile
              label="Distance"
              value={w.distanceM ? String(round(metersToDisplay(w.distanceM, unit), 2)) : '--'}
              unit={distanceUnitLabel(unit)}
              color={Colors.steps}
            />
            <View style={styles.gap} />
            <StatTile label="Effort" value={w.effort ? `${w.effort}/10` : '--'} color={Colors.sleep} />
          </View>

          {data?.hr.length ? (
            <>
              <SectionHeader title="Heart rate" />
              <Card>
                <TrendChart data={data.hr} color={Colors.heart} kind="line" height={180} xLabel={() => null} />
                <Text style={styles.axis}>start to finish</Text>
              </Card>
            </>
          ) : null}

          {w.notes ? (
            <>
              <SectionHeader title="Notes" />
              <Card>
                <Text style={Typography.body}>{w.notes}</Text>
              </Card>
            </>
          ) : null}

          <Button
            title="Delete workout"
            variant="danger"
            icon={<Trash2 color={Colors.danger} size={16} />}
            onPress={remove}
            style={styles.delete}
          />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', marginBottom: Spacing.md },
  gap: { width: Spacing.md },
  axis: { ...Typography.caption, textAlign: 'center', marginTop: 4 },
  delete: { marginTop: Spacing.xl },
});
