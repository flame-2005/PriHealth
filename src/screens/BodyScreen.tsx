import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Bluetooth, Plus, Scale } from 'lucide-react-native';
import { Screen } from '../components/Screen';
import { Card, EmptyState, SectionHeader } from '../components/Card';
import { Button } from '../components/Button';
import { ListRow } from '../components/ListRow';
import { Sheet } from '../components/Sheet';
import { ChipRow, Field } from '../components/Field';
import { TrendChart } from '../components/TrendChart';
import { Colors, Spacing, Typography } from '../theme';
import { useAsyncData } from '../hooks/useData';
import { loadSeries } from '../hooks/useSeries';
import { bodyRepo } from '../db/repositories/bodyRepo';
import { movingAverage } from '../domain/aggregate';
import { dayKey, formatDayLabel, formatTime } from '../domain/time';
import { displayToKg, kgToDisplay, parseDecimal, round, weightUnitLabel } from '../domain/units';
import { useAppStore } from '../store/useAppStore';
import type { RootNav } from '../navigation/types';
import type { BodyMeasurement } from '../domain/types';

type Range = '30' | '90';

export default function BodyScreen() {
  const nav = useNavigation<RootNav>();
  const unit = useAppStore(s => s.unitSystem);
  const goals = useAppStore(s => s.goals);
  const bump = useAppStore(s => s.bump);
  const [sheet, setSheet] = useState(false);
  const [range, setRange] = useState<Range>('30');
  const [weight, setWeight] = useState('');
  const [fat, setFat] = useState('');
  const u = weightUnitLabel(unit);

  const { data } = useAsyncData(async () => {
    const [latest, latestFat, entries, series] = await Promise.all([
      bodyRepo.latest('weight'),
      bodyRepo.latest('body_fat'),
      bodyRepo.list('weight', 30),
      loadSeries('weight', Number(range)),
    ]);
    const display = series.map(d => ({ day: d.day, value: Number.isFinite(d.value) ? kgToDisplay(d.value, unit) : NaN }));
    const weekAgo = entries.find(e => e.atMs <= Date.now() - 7 * 24 * 3600 * 1000);
    return { latest, latestFat, entries, series: display, ma: movingAverage(display, 7), weekAgo };
  }, [range, unit]);

  const save = async () => {
    const w = parseDecimal(weight);
    if (!Number.isFinite(w) || w <= 0) {
      Alert.alert('Enter a weight', `For example 72.4 ${u}.`);
      return;
    }
    const now = Date.now();
    await bodyRepo.insert({ kind: 'weight', value: displayToKg(w, unit), unit: 'kg', atMs: now, day: dayKey(now), sourceId: 'manual' });
    const f = parseDecimal(fat);
    if (fat.trim() && Number.isFinite(f) && f > 0 && f < 80) {
      await bodyRepo.insert({ kind: 'body_fat', value: f, unit: '%', atMs: now, day: dayKey(now), sourceId: 'manual' });
    }
    setSheet(false);
    setWeight('');
    setFat('');
    bump();
  };

  const remove = (m: BodyMeasurement) =>
    Alert.alert('Delete entry?', `${round(kgToDisplay(m.value, unit), 1)} ${u} on ${formatDayLabel(m.day)}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (m.id != null) await bodyRepo.remove(m.id);
          bump();
        },
      },
    ]);

  const latestDisplay = data?.latest ? round(kgToDisplay(data.latest.value, unit), 1) : null;
  const delta =
    data?.latest && data.weekAgo ? round(kgToDisplay(data.latest.value - data.weekAgo.value, unit), 1) : null;

  return (
    <Screen
      title="Body"
      right={<Button title="Add" small icon={<Plus color={Colors.black} size={16} />} onPress={() => setSheet(true)} />}>
      <Card style={styles.hero}>
        <View style={styles.heroRow}>
          <Scale color={Colors.weight} size={22} />
          <Text style={styles.heroLabel}>Current weight</Text>
        </View>
        <View style={styles.valueRow}>
          <Text style={styles.value}>{latestDisplay ?? '--'}</Text>
          <Text style={styles.unit}>{u}</Text>
        </View>
        <Text style={styles.heroSub}>
          {delta != null
            ? `${delta > 0 ? '+' : ''}${delta} ${u} vs 7 days ago`
            : data?.latest
            ? `last entry ${formatDayLabel(data.latest.day)}`
            : 'Add your first weight to start a trend'}
          {data?.latestFat ? ` · body fat ${round(data.latestFat.value, 1)}%` : ''}
          {goals.weightKg ? ` · goal ${round(kgToDisplay(goals.weightKg, unit), 1)} ${u}` : ''}
        </Text>
      </Card>

      <SectionHeader title="Trend" />
      <ChipRow options={['30', '90'] as Range[]} value={range} onChange={setRange} labels={{ '30': '30 days', '90': '90 days' }} color={Colors.weight} />
      <Card>
        {data?.entries.length ? (
          <TrendChart
            data={data.series}
            overlay={data.ma}
            color={Colors.weight}
            kind="line"
            goal={goals.weightKg ? kgToDisplay(goals.weightKg, unit) : null}
            formatValue={v => `${round(v, 1)}`}
          />
        ) : (
          <EmptyState title="No entries yet" />
        )}
        <Text style={styles.legend}>Line: daily entries · grey: 7-day average{goals.weightKg ? ' · dashed: goal' : ''}</Text>
      </Card>

      <Card onPress={() => nav.navigate('Devices')} style={styles.scaleCard}>
        <View style={styles.heroRow}>
          <Bluetooth color={Colors.weight} size={18} />
          <Text style={styles.scaleText}>Have a Bluetooth scale? Connect it under Devices and readings save here.</Text>
        </View>
      </Card>

      <SectionHeader title="Entries" />
      <Card>
        {!data?.entries.length ? (
          <EmptyState title="Nothing logged yet" />
        ) : (
          data.entries.map((m, i) => (
            <ListRow
              key={m.id}
              title={`${round(kgToDisplay(m.value, unit), 1)} ${u}`}
              subtitle={`${formatDayLabel(m.day)} · ${formatTime(m.atMs)}${m.sourceId.startsWith('ble') ? ' · scale' : ''}`}
              onLongPress={() => remove(m)}
              last={i === data.entries.length - 1}
            />
          ))
        )}
      </Card>
      <Text style={styles.hint}>Long-press an entry to delete it.</Text>

      <Sheet visible={sheet} title="Add weight" onClose={() => setSheet(false)}>
        <Field label="Weight" value={weight} onChangeText={setWeight} keyboardType="decimal-pad" suffix={u} autoFocus placeholder="0.0" />
        <Field label="Body fat (optional)" value={fat} onChangeText={setFat} keyboardType="decimal-pad" suffix="%" placeholder="0.0" />
        <Button title="Save" onPress={save} />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: Colors.surfaceElevated },
  heroRow: { flexDirection: 'row', alignItems: 'center' },
  heroLabel: { ...Typography.label, marginLeft: Spacing.sm },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: Spacing.sm },
  value: { ...Typography.display, color: Colors.weight },
  unit: { ...Typography.h3, color: Colors.textSecondary, marginLeft: 6 },
  heroSub: { ...Typography.caption, marginTop: 4 },
  legend: { ...Typography.caption, color: Colors.textDim, marginTop: 6, textAlign: 'center' },
  scaleCard: { marginTop: Spacing.md },
  scaleText: { ...Typography.caption, marginLeft: Spacing.sm, flex: 1 },
  hint: { ...Typography.caption, color: Colors.textDim, textAlign: 'center', marginTop: Spacing.sm },
});
