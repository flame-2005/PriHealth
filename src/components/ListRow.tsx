import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { Colors, Spacing, Typography } from '../theme';

interface Props {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  right?: React.ReactNode | string;
  onPress?: () => void;
  onLongPress?: () => void;
  chevron?: boolean;
  last?: boolean;
}

export function ListRow({ icon, title, subtitle, right, onPress, onLongPress, chevron, last }: Props) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      style={({ pressed }) => [styles.row, !last && styles.divider, pressed && styles.pressed]}>
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      <View style={styles.text}>
        <Text style={Typography.body} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {typeof right === 'string' ? <Text style={styles.right}>{right}</Text> : right}
      {chevron ? <ChevronRight color={Colors.textDim} size={18} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  pressed: { opacity: 0.7 },
  icon: { width: 32, alignItems: 'center', marginRight: Spacing.sm },
  text: { flex: 1 },
  subtitle: { ...Typography.caption, marginTop: 2 },
  right: { ...Typography.bodySecondary, marginRight: Spacing.sm },
});
