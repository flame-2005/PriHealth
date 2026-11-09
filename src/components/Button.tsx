import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Colors, Radius, Spacing } from '../theme';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface Props {
  title: string;
  onPress: () => void;
  variant?: Variant;
  icon?: React.ReactNode;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
}

export function Button({ title, onPress, variant = 'primary', icon, disabled, loading, style, small }: Props) {
  const bg =
    variant === 'primary'
      ? Colors.primary
      : variant === 'danger'
      ? Colors.dangerDim
      : variant === 'secondary'
      ? Colors.surfaceElevated
      : Colors.transparent;
  const fg = variant === 'primary' ? Colors.black : variant === 'danger' ? Colors.danger : Colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        small && styles.small,
        { backgroundColor: bg },
        variant === 'ghost' && styles.ghost,
        (disabled || pressed) && styles.dim,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.row}>
          {icon ? <View style={styles.icon}>{icon}</View> : null}
          <Text style={[styles.text, small && styles.smallText, { color: fg }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: Radius.md,
    paddingVertical: 14,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  small: { paddingVertical: 8, paddingHorizontal: Spacing.md },
  ghost: { borderWidth: 1, borderColor: Colors.border },
  dim: { opacity: 0.6 },
  row: { flexDirection: 'row', alignItems: 'center' },
  icon: { marginRight: Spacing.sm },
  text: { fontSize: 16, fontWeight: '600' },
  smallText: { fontSize: 14 },
});
