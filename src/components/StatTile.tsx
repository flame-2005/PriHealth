import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors, Radius, Spacing, Typography } from '../theme';

interface Props {
  label: string;
  value: string;
  unit?: string;
  color?: string;
  icon?: React.ReactNode;
  hint?: string;
  onPress?: () => void;
}

export function StatTile({ label, value, unit, color = Colors.primary, icon, hint, onPress }: Props) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.tile, pressed && styles.pressed]}>
      <View style={styles.top}>
        {icon ? <View style={[styles.iconWrap, { backgroundColor: `${color}22` }]}>{icon}</View> : null}
        <Text style={styles.label}>{label}</Text>
      </View>
      <View style={styles.valueRow}>
        <Text style={[styles.value, { color }]} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Text>
        {unit ? <Text style={styles.unit}>{unit}</Text> : null}
      </View>
      {hint ? (
        <Text style={styles.hint} numberOfLines={1}>
          {hint}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    minHeight: 104,
  },
  pressed: { opacity: 0.8 },
  top: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.sm },
  iconWrap: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.sm,
  },
  label: { ...Typography.label, flex: 1 },
  valueRow: { flexDirection: 'row', alignItems: 'baseline' },
  value: { fontSize: 26, fontWeight: '700' },
  unit: { ...Typography.caption, marginLeft: 4 },
  hint: { ...Typography.caption, color: Colors.textDim, marginTop: 4 },
});
