import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Colors, Typography } from '../theme';

interface Props {
  size?: number;
  stroke?: number;
  progress: number; // 0..1 (values above 1 are clamped)
  color: string;
  label: string;
  value: string;
  sub?: string;
  /** Opens the metric's own screen; the ring is a summary, the detail lives elsewhere. */
  onPress?: () => void;
}

export function RingProgress({ size = 104, stroke = 10, progress, color, label, value, sub, onPress }: Props) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.wrap, { width: size }, pressed && styles.pressed]}>
      <Svg width={size} height={size}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={Colors.surfaceElevated} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c} ${c}`}
          strokeDashoffset={c * (1 - p)}
          rotation={-90}
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View style={[styles.center, { width: size, height: size }]}>
        <Text style={[styles.value, { color }]} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Text>
        {sub ? (
          <Text style={styles.sub} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  pressed: { opacity: 0.7 },
  center: { position: 'absolute', top: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  value: { fontSize: 20, fontWeight: '700' },
  sub: { ...Typography.caption, fontSize: 10, color: Colors.textDim },
  label: { ...Typography.caption, marginTop: 6 },
});
