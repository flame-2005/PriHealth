import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { Activity, Flame, Heart, Play, Scale, Timer, TrendingUp } from 'lucide-react-native';
import { Screen } from '../components/Screen';
import { Card, SectionHeader } from '../components/Card';
import { Button } from '../components/Button';
import { RingProgress } from '../components/RingProgress';
import { StatTile } from '../components/StatTile';
import { Sheet } from '../components/Sheet';
import { Chip } from '../components/Field';
import { Colors, Spacing, Typography } from '../theme';
import { useAsyncData } from '../hooks/useData';
import { useLiveHr } from '../hooks/useLiveHr';
import { loadSeries } from '../hooks/useSeries';
import { samplesRepo } from '../db/repositories/samplesRepo';
import { workoutsRepo } from '../db/repositories/workoutsRepo';
import { sleepRepo } from '../db/repositories/sleepRepo';
import { bodyRepo } from '../db/repositories/bodyRepo';
import { currentStreak } from '../domain/aggregate';
import { dayKey, describeWhen, formatDuration, formatMinutes, formatTime } from '../domain/time';
import { WORKOUT_LABEL, WORKOUT_TYPES, type WorkoutType } from '../domain/types';
import { kgToDisplay, round, weightUnitLabel } from '../domain/units';
import { useAppStore } from '../store/useAppStore';
import { devicesRepo } from '../db/repositories/devicesRepo';
import { stepsPickForDay } from '../tracking/daySteps';
import { elapsedSeconds, startSession } from '../tracking/workoutSession';
import type { RootNav } from '../navigation/types';

export default function TodayScreen() {
  const nav = useNavigation<RootNav>();
  const goals = useAppStore(s => s.goals);
  const unit = useAppStore(s => s.unitSystem);
  const { hr: liveHr, live } = useLiveHr();
  const session = useAppStore(s => s.session);
  const setSession = useAppStore(s => s.setSession);
  const [picker, setPicker] = useState(false);
  const [type, setType] = useState<WorkoutType>('walk');
  const focused = useIsFocused();
  const [, setTick] = useState(0);

  // Keeps the "in progress" card's timer moving; nothing else re-renders this screen every second.
  useEffect(() => {
    if (!focused || session.status !== 'running') return;
    const id = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, [focused, session.status]);

  const { data } = useAsyncData(async () => {
    const today = dayKey(Date.now());
    const [pick, workouts, sleep, weight, lastHr, monthSteps] = await Promise.all([
      stepsPickForDay(today),
      workoutsRepo.forDay(today),
      sleepRepo.latest(),
      bodyRepo.latest('weight'),
      samplesRepo.latest('heart_rate'),
      loadSeries('steps', 30),
    ]);
    const steps = pick?.value ?? 0;
    // A device's count stands in for the phone's; say so, and since when, so a watch put on at lunch is not a surprise.
    const src = pick?.sourceIds[0];
    const device = src?.startsWith('ble:') ? await devicesRepo.get(src.slice(4)) : null;
    const stepsNote = device && pick ? `${device.name ?? 'device'} since ${formatTime(pick.firstMs)}` : null;
    const activeMin = workouts.reduce((a, w) => a + w.durationS / 60, 0);
    const kcal = workouts.reduce((a, w) => a + (w.kcal ?? 0), 0);
    const yesterday = dayKey(Date.now() - 24 * 3600 * 1000);
    const lastNight = sleep && (sleep.day === today || sleep.day === yesterday) ? sleep : null;
    const sleepMin = lastNight ? (lastNight.endMs - lastNight.startMs) / 60000 : 0;
    // Today only counts once its goal is met; until then the streak is the run that ended yesterday,
    // otherwise it would read 0 every morning.
    const streakDays = steps >= goals.steps ? monthSteps : monthSteps.slice(0, -1);
    return { steps, stepsNote, workouts, activeMin, kcal, sleepMin, weight, lastHr, streak: currentStreak(streakDays, goals.steps) };
  }, [goals.steps]);

  const start = async () => {
    setPicker(false);
    await setSession(startSession(type));
    nav.navigate('WorkoutSession');
  };

  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  // Live while a device streams; the saved reading, kept every few seconds from that stream, otherwise.
  const savedHr = data?.lastHr ? Math.round(data.lastHr.value) : null;
  const hrValue = live && liveHr ? String(liveHr.bpm) : savedHr != null ? String(savedHr) : '--';
  const hrHint =
    live && liveHr
      ? savedHr != null
        ? `live, saved ${savedHr}`
        : 'live'
      : data?.lastHr
      ? `saved ${describeWhen(data.lastHr.endMs)}`
      : 'no readings yet';

  return (
    <Screen title="Today" subtitle={dateLabel}>
      {session.status !== 'idle' ? (
        <Card onPress={() => nav.navigate('WorkoutSession')} style={styles.sessionCard}>
          <View style={styles.sessionRow}>
            <Timer color={Colors.primary} size={20} />
            <Text style={styles.sessionText}>
              {WORKOUT_LABEL[session.type]} in progress · {formatDuration(elapsedSeconds(session))}
            </Text>
          </View>
        </Card>
      ) : null}

      {/* Every number on this screen opens its own history or tab; the rings are summaries, not controls. */}
      <Card style={styles.rings}>
        <RingProgress
          progress={(data?.steps ?? 0) / goals.steps}
          color={Colors.steps}
          label="Steps"
          value={Math.round(data?.steps ?? 0).toLocaleString()}
          sub={data?.stepsNote ?? `of ${goals.steps.toLocaleString()}`}
          onPress={() => nav.navigate('Trends', { series: 'steps' })}
        />
        <RingProgress
          progress={(data?.activeMin ?? 0) / goals.activeMinutes}
          color={Colors.primary}
          label="Active"
          value={`${Math.round(data?.activeMin ?? 0)}m`}
          sub={`of ${goals.activeMinutes}m`}
          onPress={() => nav.navigate('Main', { screen: 'Activity' })}
        />
        <RingProgress
          progress={(data?.sleepMin ?? 0) / goals.sleepMinutes}
          color={Colors.sleep}
          label="Sleep"
          value={data?.sleepMin ? formatMinutes(data.sleepMin) : '--'}
          sub={`goal ${formatMinutes(goals.sleepMinutes)}`}
          onPress={() => nav.navigate('Main', { screen: 'Sleep' })}
        />
      </Card>

      <View style={styles.tileRow}>
        <StatTile
          label="Heart rate"
          value={hrValue}
          unit="bpm"
          color={Colors.heart}
          icon={<Heart color={Colors.heart} size={14} />}
          hint={hrHint}
          onPress={() => nav.navigate('HeartRate')}
        />
        <View style={styles.gap} />
        <StatTile
          label="Weight"
          value={data?.weight ? String(round(kgToDisplay(data.weight.value, unit), 1)) : '--'}
          unit={weightUnitLabel(unit)}
          color={Colors.weight}
          icon={<Scale color={Colors.weight} size={14} />}
          hint={data?.weight ? `latest ${describeWhen(data.weight.atMs)}` : 'add on Body tab'}
          onPress={() => nav.navigate('Main', { screen: 'Body' })}
        />
      </View>
      <View style={styles.tileRow}>
        <StatTile
          label="Workouts"
          value={String(data?.workouts.length ?? 0)}
          unit="today"
          color={Colors.primary}
          icon={<Activity color={Colors.primary} size={14} />}
          hint={data?.kcal ? `${Math.round(data.kcal)} kcal` : 'none yet'}
          onPress={() => nav.navigate('Main', { screen: 'Activity' })}
        />
        <View style={styles.gap} />
        <StatTile
          label="Step streak"
          value={String(data?.streak ?? 0)}
          unit="days"
          color={Colors.energy}
          icon={<Flame color={Colors.energy} size={14} />}
          hint="days at goal"
          onPress={() => nav.navigate('Trends', { series: 'steps' })}
        />
      </View>

      <Button
        title="Start workout"
        icon={<Play color={Colors.black} size={18} />}
        onPress={() => setPicker(true)}
        style={styles.start}
        disabled={session.status !== 'idle'}
      />

      <SectionHeader title="Explore" />
      <Card onPress={() => nav.navigate('Trends')}>
        <View style={styles.exploreRow}>
          <TrendingUp color={Colors.primary} size={20} />
          <Text style={styles.exploreText}>Trends: 7, 30 and 90-day views of every metric</Text>
        </View>
      </Card>

      <Sheet visible={picker} title="Start a workout" onClose={() => setPicker(false)}>
        <View style={styles.typeGrid}>
          {WORKOUT_TYPES.map(t => (
            <Chip key={t} label={WORKOUT_LABEL[t]} selected={t === type} onPress={() => setType(t)} />
          ))}
        </View>
        <Button title="Start" onPress={start} style={styles.sheetBtn} />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sessionCard: { marginBottom: Spacing.md, backgroundColor: Colors.primaryDim, borderColor: Colors.primary },
  sessionRow: { flexDirection: 'row', alignItems: 'center' },
  sessionText: { ...Typography.body, marginLeft: Spacing.sm, fontWeight: '600' },
  rings: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: Spacing.lg },
  tileRow: { flexDirection: 'row', marginTop: Spacing.md },
  gap: { width: Spacing.md },
  start: { marginTop: Spacing.lg },
  exploreRow: { flexDirection: 'row', alignItems: 'center' },
  exploreText: { ...Typography.body, marginLeft: Spacing.sm, flex: 1 },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: Spacing.sm },
  sheetBtn: { marginTop: Spacing.lg },
});
