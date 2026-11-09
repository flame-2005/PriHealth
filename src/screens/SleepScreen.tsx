import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Bed, Moon, Sun } from 'lucide-react-native';
import Svg, { Rect } from 'react-native-svg';
import { Screen } from '../components/Screen';
import { Card, EmptyState, SectionHeader } from '../components/Card';
import { Button } from '../components/Button';
import { ListRow } from '../components/ListRow';
import { Sheet } from '../components/Sheet';
import { Chip, Field } from '../components/Field';
import { TrendChart } from '../components/TrendChart';
import { Colors, Spacing, Typography } from '../theme';
import { useAsyncData } from '../hooks/useData';
import { loadSeries } from '../hooks/useSeries';
import { sleepRepo } from '../db/repositories/sleepRepo';
import { addDays, dayKey, formatDayLabel, formatMinutes, formatTime } from '../domain/time';
import { useAppStore } from '../store/useAppStore';
import { getPendingBedtime, markBedtime, markWakeUp, sessionFromClock, clearBedtime } from '../tracking/sleepLog';
import { SLEEP_STAGE_LABEL, type SleepSession, type SleepStage, type SleepStageKind } from '../domain/types';

const STAGE_COLOR: Record<SleepStageKind, string> = {
  awake: Colors.energy,
  light: `${Colors.sleep}80`,
  deep: Colors.sleep,
  rem: Colors.primary,
};

/** The night as a strip of stages, and how long was spent in each. */
function StageStrip({ session, stages }: { session: SleepSession; stages: SleepStage[] }) {
  const span = Math.max(1, session.endMs - session.startMs);
  const minutes = new Map<SleepStageKind, number>();
  for (const s of stages) minutes.set(s.stage, (minutes.get(s.stage) ?? 0) + (s.endMs - s.startMs) / 60000);
  const summary = (['deep', 'rem', 'light', 'awake'] as SleepStageKind[])
    .filter(k => minutes.has(k))
    .map(k => `${SLEEP_STAGE_LABEL[k]} ${formatMinutes(minutes.get(k)!)}`)
    .join(' · ');
  return (
    <View style={styles.strip}>
      <Svg width="100%" height={8} viewBox={`0 0 ${span} 8`} preserveAspectRatio="none">
        {stages.map(s => (
          <Rect key={s.id ?? s.startMs} x={s.startMs - session.startMs} y={0} width={Math.max(0, s.endMs - s.startMs)} height={8} fill={STAGE_COLOR[s.stage]} />
        ))}
      </Svg>
      <Text style={styles.stripText}>{summary}</Text>
    </View>
  );
}

export default function SleepScreen() {
  const goals = useAppStore(s => s.goals);
  const bump = useAppStore(s => s.bump);
  const [sheet, setSheet] = useState(false);
  const [wakeDay, setWakeDay] = useState<'today' | 'yesterday'>('today');
  const [bed, setBed] = useState('23:00');
  const [wake, setWake] = useState('07:00');

  const { data } = useAsyncData(async () => {
    const [pending, sessions, series] = await Promise.all([getPendingBedtime(), sleepRepo.list(30), loadSeries('sleep', 14)]);
    const stages = await sleepRepo.stagesFor(sessions.filter(s => s.externalId).map(s => s.id!));
    return { pending, sessions, series, stages };
  });

  const today = dayKey(Date.now());
  const last = data?.sessions[0] ?? null;
  const lastIsRecent = last && (last.day === today || last.day === addDays(today, -1));
  const lastMin = last ? (last.endMs - last.startMs) / 60000 : 0;

  const saveManual = async () => {
    const day = wakeDay === 'today' ? today : addDays(today, -1);
    const s = sessionFromClock(day, bed, wake);
    if (!s) {
      Alert.alert('Check the times', 'Use 24-hour HH:MM, for example 23:15.');
      return;
    }
    if (s.endMs > Date.now()) {
      Alert.alert('Check the times', 'That wake-up time has not happened yet.');
      return;
    }
    await sleepRepo.insert(s);
    setSheet(false);
    bump();
  };

  const remove = (s: SleepSession) =>
    Alert.alert('Delete this night?', `${formatDayLabel(s.day)} · ${formatMinutes((s.endMs - s.startMs) / 60000)}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (s.id != null) await sleepRepo.remove(s.id);
          bump();
        },
      },
    ]);

  return (
    <Screen title="Sleep">
      <Card style={styles.hero}>
        {data?.pending ? (
          <>
            <View style={styles.heroRow}>
              <Bed color={Colors.sleep} size={22} />
              <Text style={styles.heroText}>In bed since {formatTime(data.pending)}</Text>
            </View>
            <View style={styles.heroActions}>
              <Button
                title="I woke up"
                icon={<Sun color={Colors.black} size={16} />}
                onPress={async () => {
                  await markWakeUp();
                  bump();
                }}
                style={styles.flex}
              />
              <View style={styles.gap} />
              <Button
                title="Cancel"
                variant="ghost"
                onPress={async () => {
                  await clearBedtime();
                  bump();
                }}
              />
            </View>
          </>
        ) : (
          <>
            <View style={styles.heroRow}>
              <Moon color={Colors.sleep} size={22} />
              <Text style={styles.heroText}>
                {lastIsRecent ? `Last night: ${formatMinutes(lastMin)}` : 'No sleep logged for last night'}
              </Text>
            </View>
            {lastIsRecent && last ? (
              <Text style={styles.heroSub}>
                {formatTime(last.startMs)} - {formatTime(last.endMs)} · goal {formatMinutes(goals.sleepMinutes)}
              </Text>
            ) : null}
            <View style={styles.heroActions}>
              <Button
                title="Going to bed"
                icon={<Bed color={Colors.black} size={16} />}
                onPress={async () => {
                  await markBedtime();
                  bump();
                }}
                style={styles.flex}
              />
              <View style={styles.gap} />
              <Button title="Log manually" variant="secondary" onPress={() => setSheet(true)} style={styles.flex} />
            </View>
          </>
        )}
      </Card>

      <SectionHeader title="Last 14 nights" />
      <Card>
        <TrendChart
          data={data?.series ?? []}
          color={Colors.sleep}
          goal={goals.sleepMinutes}
          formatValue={v => formatMinutes(v)}
        />
      </Card>

      <SectionHeader title="History" />
      <Card>
        {!data?.sessions.length ? (
          <EmptyState title="No nights logged" body="Tap Going to bed tonight, or log a night manually." />
        ) : (
          data.sessions.map((s, i) => {
            const stages = s.id != null ? data.stages.get(s.id) : undefined;
            return (
              <React.Fragment key={s.id}>
                <ListRow
                  icon={<Moon color={Colors.sleep} size={18} />}
                  title={formatMinutes((s.endMs - s.startMs) / 60000)}
                  subtitle={`${formatDayLabel(s.day)} · ${formatTime(s.startMs)} - ${formatTime(s.endMs)}${s.device ? ` · ${s.device}` : ''}`}
                  onLongPress={() => remove(s)}
                  last={i === data.sessions.length - 1 || !!stages?.length}
                />
                {stages?.length ? <StageStrip session={s} stages={stages} /> : null}
              </React.Fragment>
            );
          })
        )}
      </Card>
      <Text style={styles.hint}>Long-press an entry to delete it. Device nights show their stages: deep, REM, light, awake.</Text>

      <Sheet visible={sheet} title="Log a night" onClose={() => setSheet(false)}>
        <Text style={styles.label}>Woke up</Text>
        <View style={styles.chips}>
          <Chip label="Today" selected={wakeDay === 'today'} onPress={() => setWakeDay('today')} color={Colors.sleep} />
          <Chip label="Yesterday" selected={wakeDay === 'yesterday'} onPress={() => setWakeDay('yesterday')} color={Colors.sleep} />
        </View>
        <Field label="Went to bed (HH:MM)" value={bed} onChangeText={setBed} keyboardType="numbers-and-punctuation" />
        <Field label="Woke up (HH:MM)" value={wake} onChangeText={setWake} keyboardType="numbers-and-punctuation" />
        <Button title="Save" onPress={saveManual} />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { backgroundColor: Colors.surfaceElevated },
  heroRow: { flexDirection: 'row', alignItems: 'center' },
  heroText: { ...Typography.h3, marginLeft: Spacing.sm, flex: 1 },
  heroSub: { ...Typography.caption, marginTop: 6, marginLeft: 30 },
  heroActions: { flexDirection: 'row', marginTop: Spacing.md },
  flex: { flex: 1 },
  gap: { width: Spacing.sm },
  hint: { ...Typography.caption, color: Colors.textDim, textAlign: 'center', marginTop: Spacing.sm },
  label: { ...Typography.label, marginBottom: 6 },
  chips: { flexDirection: 'row', marginBottom: Spacing.md },
  strip: { paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  stripText: { ...Typography.caption, marginTop: 6 },
});
