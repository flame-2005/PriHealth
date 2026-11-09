import React from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Spacing, Typography } from '../theme';

interface Props {
  title?: string;
  subtitle?: string;
  right?: React.ReactNode;
  scroll?: boolean;
  children: React.ReactNode;
  contentStyle?: ViewStyle;
  edges?: Array<'top' | 'bottom' | 'left' | 'right'>;
}

export function Screen({ title, subtitle, right, scroll = true, children, contentStyle, edges }: Props) {
  const header =
    title || right ? (
      <View style={styles.header}>
        <View style={styles.headerText}>
          {title ? <Text style={Typography.h1}>{title}</Text> : null}
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
    ) : null;

  return (
    <SafeAreaView style={styles.safe} edges={edges ?? ['top', 'left', 'right']}>
      {scroll ? (
        // Edge-to-edge windows (Android 15+) are not resized for the keyboard, so make room for it here.
        <KeyboardAvoidingView behavior="padding" style={styles.fill}>
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[styles.content, contentStyle]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {header}
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      ) : (
        <View style={[styles.content, styles.fill, contentStyle]}>
          {header}
          {children}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  fill: { flex: 1 },
  content: { padding: Spacing.md, paddingBottom: Spacing.xxl },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: Spacing.lg,
    marginTop: Spacing.sm,
  },
  headerText: { flex: 1 },
  subtitle: { ...Typography.bodySecondary, marginTop: Spacing.xs },
});
