import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { ArrowLeft } from 'lucide-react-native';
import { Screen } from '../components/Screen';
import { Card, EmptyState } from '../components/Card';
import { Button } from '../components/Button';
import { ChipRow } from '../components/Field';
import { TrendChart } from '../components/TrendChart';
import { StatTile } from '../components/StatTile';
import { Colors, MetricColor, Spacing } from '../theme';
import { useAsyncData } from '../hooks/useData';
import { loadSeries, SERIES_LABEL, SERIES_UNIT, type SeriesKey } from '../hooks/useSeries';
import { movingAverage, stats } from '../domain/aggregate';
import { formatMinutes } from '../domain/time';
import { kgToDisplay, round, weightUnitLabel } from '../domain/units';
import { useAppStore } from '../store/useAppStore';
import type { RootNav, RootStackParamList } from '../navigation/types';

const SERIES: SeriesKey[] = ['steps', 'active_minutes', 'active_kcal', 'heart_rate', 'resting_hr', 'sleep', 'weight', 'spo2', 'stress'];
type Range = '7' | '30' | '90';
const LINE_SERIES: SeriesKey[] = ['heart_rate', 'resting_hr', 'weight', 'spo2', 'stress'];

export default function TrendsScreen() {
  const nav = useNavigation<RootNav>();
  const { params } = useRoute<RouteProp<RootStackParamList, 'Trends'>>();
  const unit = useAppStore(s => s.unitSystem);
  const goals = useAppStore(s => s.goals);
  const [series, setSeries] = useState<SeriesKey>(params?.series ?? 'steps');
  const [range, setRange] = useState<Range>('7');

  const { data } = useAsyncData(async () => {
    const rows = await loadSeries(series, Number(range));
    if (series === 'weight') {
      return rows.map(d => ({ day: d.day, value: Number.isFinite(d.value) ? kgToDisplay(d.value, unit) : NaN }));
    }
    return rows;
  }, [series, range, unit]);

  const color = MetricColor[series] ?? Colors.primary;
  const isLine = LINE_SERIES.includes(series);
  const values = (data ?? []).map(d => d.value).filter(v => Number.isFinite(v) && (isLine ? true : v > 0));
  const s = stats(values);
  const unitLabel = series === 'weight' ? weightUnitLabel(unit) : SERIES_UNIT[series];
  const fmt = (v: number) => (series === 'sleep' ? formatMinutes(v) : series === 'weight' ? String(round(v, 1)) : String(Math.round(v)));
  const goal =
    series === 'steps'
      ? goals.steps
      : series === 'active_minutes'
      ? goals.activeMinutes
      : series === 'sleep'
      ? goals.sleepMinutes
      : series === 'weight' && goals.weightKg
      ? kgToDisplay(goals.weightKg, unit)
      : null;
  const hasData = values.length > 0;

  return (
    <Screen
      title="Trends"
      right={<Button title="Back" variant="ghost" small icon={<ArrowLeft color={Colors.text} size={16} />} onPress={() => nav.goBack()} />}>
      <ChipRow options={SERIES} value={series} onChange={setSeries} labels={SERIES_LABEL} color={color} />
      <View style={styles.rangeRow}>
        <ChipRow options={['7', '30', '90'] as Range[]} value={range} onChange={setRange} labels={{ '7': '7 days', '30': '30 days', '90': '90 days' }} color={color} />
      </View>

      <Card>
        {hasData ? (
          <TrendChart
            data={data ?? []}
            color={color}
            kind={isLine ? 'line' : 'bar'}
            height={200}
            goal={goal}
            overlay={isLine && Number(range) > 7 ? movingAverage(data ?? [], 7) : undefined}
            formatValue={fmt}
          />
        ) : (
          <EmptyState title={`No ${SERIES_LABEL[series].toLowerCase()} data in this range`} />
        )}
      </Card>

      <View style={styles.statsRow}>
        <StatTile label="Min" value={hasData ? fmt(s.min) : '--'} unit={unitLabel} color={color} />
        <View style={styles.gap} />
        <StatTile label="Average" value={hasData ? fmt(s.avg) : '--'} unit={unitLabel} color={color} />
        <View style={styles.gap} />
        <StatTile label="Max" value={hasData ? fmt(s.max) : '--'} unit={unitLabel} color={color} />
      </View>
      {series === 'resting_hr' ? (
        <Text style={styles.note}>Resting HR is the lowest reading recorded each day from a connected sensor.</Text>
      ) : null}
      {series === 'steps' ? <Text style={styles.note}>Steps come from a connected watch for the days it reported, otherwise from the phone sensor, attributed by time when the app was closed.</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  rangeRow: { marginBottom: Spacing.sm },
  statsRow: { flexDirection: 'row', marginTop: Spacing.md },
  gap: { width: Spacing.sm },
  note: { color: Colors.textDim, fontSize: 12, marginTop: Spacing.md, textAlign: 'center' },
});
