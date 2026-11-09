import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { ArrowLeft, Download, Trash2 } from 'lucide-react-native';
import { Screen } from '../components/Screen';
import { Card, SectionHeader } from '../components/Card';
import { Button } from '../components/Button';
import { ChipRow, Field } from '../components/Field';
import { Colors, Spacing, Typography } from '../theme';
import { useAppStore } from '../store/useAppStore';
import { displayToKg, kgToDisplay, parseDecimal, round, weightUnitLabel } from '../domain/units';
import { mergeRanking, POLICY_LABEL, POLICY_METRICS, type PolicyMetric } from '../domain/sources';
import type { UnitSystem } from '../domain/types';
import { exportCsv, exportJson } from '../export';
import { wipeAll } from '../db';
import { prefs } from '../store/prefs';
import { disconnectAll } from '../integrations/devices/session';
import type { RootNav } from '../navigation/types';

/** Source classes as a person reads them; `demo` and `unknown` are never offered. */
const CLASS_LABEL: Record<string, string> = {
  watch: 'Watch',
  band: 'Band',
  ring: 'Ring',
  strap: 'Strap',
  scale: 'Scale',
  phone: 'Phone',
  manual: 'Manual entry',
};

export default function SettingsScreen() {
  const nav = useNavigation<RootNav>();
  const unit = useAppStore(s => s.unitSystem);
  const setUnitSystem = useAppStore(s => s.setUnitSystem);
  const sourcePolicy = useAppStore(s => s.sourcePolicy);
  const setSourcePolicy = useAppStore(s => s.setSourcePolicy);
  const ranking = mergeRanking(sourcePolicy);
  /** Moves a class to the front of a metric's ranking: "for steps, prefer the phone". */
  const prefer = (m: PolicyMetric, cls: string) =>
    setSourcePolicy({ ...sourcePolicy, [m]: [cls, ...ranking[m].filter(c => c !== cls)] });
  const goals = useAppStore(s => s.goals);
  const setGoals = useAppStore(s => s.setGoals);
  const profile = useAppStore(s => s.profile);
  const setProfile = useAppStore(s => s.setProfile);
  const bump = useAppStore(s => s.bump);

  const [steps, setSteps] = useState(String(goals.steps));
  const [active, setActive] = useState(String(goals.activeMinutes));
  const [sleepH, setSleepH] = useState(String(round(goals.sleepMinutes / 60, 1)));
  const [weight, setWeight] = useState(goals.weightKg ? String(round(kgToDisplay(goals.weightKg, unit), 1)) : '');
  const [maxHr, setMaxHr] = useState(profile.maxHr ? String(profile.maxHr) : '');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setWeight(goals.weightKg ? String(round(kgToDisplay(goals.weightKg, unit), 1)) : '');
  }, [unit, goals.weightKg]);

  const saveGoals = async () => {
    const s = Number(steps);
    const a = Number(active);
    const h = parseDecimal(sleepH);
    const w = weight.trim() ? parseDecimal(weight) : null;
    const m = maxHr.trim() ? Number(maxHr) : null;
    await setGoals({
      steps: Number.isFinite(s) && s > 0 ? Math.round(s) : goals.steps,
      activeMinutes: Number.isFinite(a) && a > 0 ? Math.round(a) : goals.activeMinutes,
      sleepMinutes: Number.isFinite(h) && h > 0 ? Math.round(h * 60) : goals.sleepMinutes,
      weightKg: w != null && Number.isFinite(w) && w > 0 ? displayToKg(w, unit) : null,
    });
    await setProfile({ maxHr: m != null && Number.isFinite(m) && m > 100 ? Math.round(m) : null });
    Alert.alert('Saved');
  };

  const doExport = async (kind: 'json' | 'csv') => {
    setBusy(kind);
    try {
      const out = kind === 'json' ? [await exportJson()] : await exportCsv();
      Alert.alert('Exported', out.length ? `Saved to Downloads:\n${out.map(p => p.split('/').pop()).join('\n')}` : 'Nothing to export yet.');
    } catch (e) {
      Alert.alert('Export failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const deleteAll = () =>
    Alert.alert('Delete all data?', 'Every step, workout, night and weight on this phone will be erased. There is no cloud copy.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete everything',
        style: 'destructive',
        onPress: () =>
          Alert.alert('Are you sure?', 'This cannot be undone.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Yes, delete',
              style: 'destructive',
              onPress: async () => {
                try {
                  await disconnectAll();
                  await wipeAll();
                  await prefs.clearAll();
                  await useAppStore.getState().hydrate();
                  bump();
                  nav.dispatch(CommonActions.reset({ index: 0, routes: [{ name: 'Onboarding' }] }));
                } catch (e) {
                  Alert.alert('Delete failed', e instanceof Error ? e.message : String(e));
                }
              },
            },
          ]),
      },
    ]);

  return (
    <Screen
      title="Settings"
      right={<Button title="Back" variant="ghost" small icon={<ArrowLeft color={Colors.text} size={16} />} onPress={() => nav.goBack()} />}>
      <SectionHeader title="Units" />
      <ChipRow options={['metric', 'imperial'] as UnitSystem[]} value={unit} onChange={setUnitSystem} labels={{ metric: 'Metric (kg, km)', imperial: 'Imperial (lb, mi)' }} />

      <SectionHeader title="Sources" />
      <Card>
        <Text style={styles.body}>When two devices report the same thing, the one you pick first counts for the day. The others are kept and never added to it.</Text>
        {POLICY_METRICS.map(m => (
          <View key={m} style={styles.sourceRow}>
            <Text style={styles.sourceLabel}>{POLICY_LABEL[m]}</Text>
            <ChipRow
              options={ranking[m].filter(c => CLASS_LABEL[c])}
              value={ranking[m].find(c => CLASS_LABEL[c]) ?? ranking[m][0]}
              onChange={cls => prefer(m, cls)}
              labels={CLASS_LABEL}
            />
          </View>
        ))}
      </Card>

      <SectionHeader title="Goals" />
      <Card>
        <Field label="Daily steps" value={steps} onChangeText={setSteps} keyboardType="numeric" suffix="steps" />
        <Field label="Active minutes per day" value={active} onChangeText={setActive} keyboardType="numeric" suffix="min" />
        <Field label="Sleep per night" value={sleepH} onChangeText={setSleepH} keyboardType="decimal-pad" suffix="hours" />
        <Field label="Target weight (optional)" value={weight} onChangeText={setWeight} keyboardType="decimal-pad" suffix={weightUnitLabel(unit)} placeholder="none" />
        <Field label="Max heart rate (optional)" value={maxHr} onChangeText={setMaxHr} keyboardType="numeric" suffix="bpm" placeholder="190" />
        <Button title="Save" onPress={saveGoals} variant="secondary" />
      </Card>

      <SectionHeader title="Your data" />
      <Card>
        <Text style={styles.body}>Exports are written to your Downloads folder. They are plain files you own; move or back them up however you like.</Text>
        <Button title="Export JSON" icon={<Download color={Colors.black} size={16} />} onPress={() => doExport('json')} loading={busy === 'json'} style={styles.btn} />
        <Button title="Export CSV" variant="secondary" icon={<Download color={Colors.text} size={16} />} onPress={() => doExport('csv')} loading={busy === 'csv'} style={styles.btn} />
        <Button title="Delete all data" variant="danger" icon={<Trash2 color={Colors.danger} size={16} />} onPress={deleteAll} style={styles.btn} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { ...Typography.bodySecondary, marginBottom: Spacing.sm, lineHeight: 20 },
  btn: { marginTop: Spacing.sm },
  sourceRow: { marginTop: Spacing.sm },
  sourceLabel: { ...Typography.label, marginBottom: 2 },
});
