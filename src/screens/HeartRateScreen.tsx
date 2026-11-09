import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ArrowLeft, Bluetooth, Heart } from 'lucide-react-native';
import { Screen } from '../components/Screen';
import { Card, EmptyState, SectionHeader } from '../components/Card';
import { Button } from '../components/Button';
import { ListRow } from '../components/ListRow';
import { StatTile } from '../components/StatTile';
import { TrendChart } from '../components/TrendChart';
import { Colors, Spacing, Typography } from '../theme';
import { useAsyncData } from '../hooks/useData';
import { useLiveHr } from '../hooks/useLiveHr';
import { loadSeries } from '../hooks/useSeries';
import { samplesRepo } from '../db/repositories/samplesRepo';
import { downsample, stats } from '../domain/aggregate';
import { describeWhen, formatTime, startOfDay } from '../domain/time';
import type { DayValue } from '../domain/types';
import { useAppStore } from '../store/useAppStore';
import type { RootNav } from '../navigation/types';

/** Points for the intraday chart: the chart keys by a string, so the key is the time it can label. */
function intraday(samples: Array<{ startMs: number; value: number }>): DayValue[] {
  const pts = downsample(
    samples.map(s => ({ x: s.startMs, y: s.value })),
    120,
  );
  return pts.map(p => ({ day: String(Math.round(p.x)), value: p.y }));
}

export default function HeartRateScreen() {
  const nav = useNavigation<RootNav>();
  const { hr: liveHr, live } = useLiveHr();
  const connected = useAppStore(s => (liveHr ? s.connected[liveHr.deviceId] : undefined));
  const anyDevice = useAppStore(s => Object.keys(s.connected).length > 0);

  const { data } = useAsyncData(async () => {
    const now = Date.now();
    const dayStart = startOfDay(now);
    const [today, last, resting, recent] = await Promise.all([
      samplesRepo.range('heart_rate', dayStart, now + 1),
      samplesRepo.latest('heart_rate'),
      loadSeries('resting_hr', 30),
      samplesRepo.range('heart_rate', now - 7 * 86_400_000, now + 1),
    ]);
    return { today, last, resting, recent: recent.slice(-8).reverse(), todayStats: stats(today.map(s => s.value)) };
  });

  const showLive = live && liveHr;
  const headline = showLive ? String(liveHr!.bpm) : data?.last ? String(Math.round(data.last.value)) : '--';
  const headlineNote = showLive
    ? `live${connected?.name ? ` from ${connected.name}` : ''}`
    : data?.last
    ? `last reading ${describeWhen(data.last.endMs)}${data.last.device ? ` from ${data.last.device}` : ''}`
    : 'No readings yet';
  const todayPoints = data ? intraday(data.today) : [];
  const labelEvery = Math.max(1, Math.floor(todayPoints.length / 4));
  const restingHasData = data?.resting.some(d => Number.isFinite(d.value)) ?? false;

  return (
    <Screen
      title="Heart rate"
      right={<Button title="Back" variant="ghost" small icon={<ArrowLeft color={Colors.text} size={16} />} onPress={() => nav.goBack()} />}>
      <Card style={styles.hero}>
        <View style={styles.heroRow}>
          <Heart color={Colors.heart} size={30} />
          <Text style={styles.heroValue}>{headline}</Text>
          <Text style={styles.heroUnit}>bpm</Text>
        </View>
        <Text style={styles.heroNote}>{headlineNote}</Text>
        <ListRow
          icon={<Bluetooth color={Colors.weight} size={18} />}
          title={anyDevice ? 'Devices' : 'Connect a watch, ring or strap'}
          subtitle={anyDevice ? 'Manage the connected device' : 'Heart rate comes from a device over Bluetooth'}
          onPress={() => nav.navigate('Devices')}
          chevron
          last
        />
      </Card>

      <SectionHeader title="Today" />
      {data && data.today.length ? (
        <>
          <Card>
            <TrendChart
              data={todayPoints}
              color={Colors.heart}
              kind="line"
              height={180}
              formatValue={v => String(Math.round(v))}
              xLabel={(d, i) => (i % labelEvery === 0 || i === todayPoints.length - 1 ? formatTime(Number(d.day)) : null)}
            />
          </Card>
          <View style={styles.statsRow}>
            <StatTile label="Low" value={String(Math.round(data.todayStats.min))} unit="bpm" color={Colors.heart} />
            <View style={styles.gap} />
            <StatTile label="Average" value={String(Math.round(data.todayStats.avg))} unit="bpm" color={Colors.heart} />
            <View style={styles.gap} />
            <StatTile label="High" value={String(Math.round(data.todayStats.max))} unit="bpm" color={Colors.heart} />
          </View>
          <Text style={styles.note}>{data.today.length} readings today. A watch sends them while it measures; a strap all the time.</Text>
        </>
      ) : (
        <Card>
          <EmptyState title="No readings today" body="Readings arrive from a connected device, during a workout or when the device measures on its own." />
        </Card>
      )}

      <SectionHeader title="Resting heart rate, 30 days" action="All trends" onAction={() => nav.navigate('Trends', { series: 'resting_hr' })} />
      <Card>
        {restingHasData ? (
          <TrendChart data={data?.resting ?? []} color={Colors.heart} kind="line" height={160} formatValue={v => String(Math.round(v))} />
        ) : (
          <EmptyState title="No resting heart rate yet" body="The lowest reading of each day, once a day has readings." />
        )}
      </Card>

      {data?.recent.length ? (
        <>
          <SectionHeader title="Recent readings" />
          <Card>
            {data.recent.map((s, i) => (
              <ListRow
                key={s.id ?? `${s.startMs}-${i}`}
                icon={<Heart color={Colors.heart} size={16} />}
                title={`${Math.round(s.value)} bpm`}
                subtitle={`${describeWhen(s.startMs)}${s.device ? ` · ${s.device}` : ''}`}
                last={i === data.recent.length - 1}
              />
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: Colors.surfaceElevated },
  heroRow: { flexDirection: 'row', alignItems: 'baseline', columnGap: Spacing.sm },
  heroValue: { fontSize: 48, fontWeight: '700', color: Colors.heart },
  heroUnit: { ...Typography.bodySecondary },
  heroNote: { ...Typography.caption, marginTop: 2, marginBottom: Spacing.sm },
  statsRow: { flexDirection: 'row', marginTop: Spacing.md },
  gap: { width: Spacing.sm },
  note: { ...Typography.caption, color: Colors.textDim, textAlign: 'center', marginTop: Spacing.sm },
});
