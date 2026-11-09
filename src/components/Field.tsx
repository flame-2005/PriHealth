import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { Colors, Radius, Spacing, Typography } from '../theme';

interface FieldProps extends TextInputProps {
  label: string;
  suffix?: string;
}

export function Field({ label, suffix, style, ...rest }: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputRow}>
        <TextInput
          placeholderTextColor={Colors.textDim}
          style={[styles.input, style]}
          keyboardAppearance="dark"
          {...rest}
        />
        {suffix ? <Text style={styles.suffix}>{suffix}</Text> : null}
      </View>
    </View>
  );
}

interface ChipProps {
  label: string;
  selected?: boolean;
  onPress: () => void;
  color?: string;
}

export function Chip({ label, selected, onPress, color = Colors.primary }: ChipProps) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, selected && { backgroundColor: `${color}26`, borderColor: color }]}>
      <Text style={[styles.chipText, selected && { color }]}>{label}</Text>
    </Pressable>
  );
}

export function ChipRow<T extends string>({
  options,
  value,
  onChange,
  labels,
  color,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  labels?: Partial<Record<T, string>>;
  color?: string;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
      {options.map(o => (
        <Chip key={o} label={labels?.[o] ?? o} selected={o === value} onPress={() => onChange(o)} color={color} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: Spacing.md },
  label: { ...Typography.label, marginBottom: 6 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
  },
  input: { flex: 1, color: Colors.text, fontSize: 16, paddingVertical: 12 },
  suffix: { ...Typography.bodySecondary },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    marginRight: Spacing.sm,
  },
  chipText: { ...Typography.label, color: Colors.textSecondary },
  chipRow: { paddingVertical: Spacing.xs },
});
