import React, { useRef, useState } from 'react';
import { Dimensions, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Lock, ShieldCheck, WifiOff } from 'lucide-react-native';
import { Screen } from '../components/Screen';
import { Button } from '../components/Button';
import { Colors, Radius, Spacing, Typography } from '../theme';
import { ENCRYPTED_DB } from '../config';
import type { RootNav } from '../navigation/types';

// Only promise encryption when the SQLCipher build is actually switched on (see config.ts).
const ENCRYPTION_NOTE = ENCRYPTED_DB ? ', in an encrypted database' : '';

const PAGES = [
  {
    icon: <WifiOff color={Colors.primary} size={40} />,
    title: 'Nothing leaves your phone',
    body: `PrivateFit has no account and asks for no internet access at all. Steps, workouts, sleep and weight are stored only on this device${ENCRYPTION_NOTE}.`,
  },
  {
    icon: <ShieldCheck color={Colors.steps} size={40} />,
    title: 'Works with just your phone',
    body: 'The phone step sensor counts your steps. Time workouts, log sleep and record your weight without any wearable. Add a watch, ring, heart-rate strap or smart scale over Bluetooth when you want more: no vendor app needed.',
  },
  {
    icon: <Lock color={Colors.sleep} size={40} />,
    title: 'Your data is a file you own',
    body: 'Export everything as CSV or JSON any time, or delete it all with one tap. There is no cloud copy to chase.',
  },
];

export default function OnboardingScreen() {
  const nav = useNavigation<RootNav>();
  const [page, setPage] = useState(0);
  const ref = useRef<ScrollView>(null);
  const width = Dimensions.get('window').width - Spacing.md * 2;
  const last = page === PAGES.length - 1;

  return (
    <Screen scroll={false} contentStyle={styles.content}>
      <View style={styles.brandRow}>
        <Text style={styles.brand}>PrivateFit</Text>
      </View>
      <ScrollView
        ref={ref}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={e => setPage(Math.round(e.nativeEvent.contentOffset.x / width))}
        style={styles.pager}>
        {PAGES.map(p => (
          <View key={p.title} style={[styles.page, { width }]}>
            <View style={styles.iconWrap}>{p.icon}</View>
            <Text style={styles.title}>{p.title}</Text>
            <Text style={styles.body}>{p.body}</Text>
          </View>
        ))}
      </ScrollView>
      <View style={styles.dots}>
        {PAGES.map((_, i) => (
          <View key={i} style={[styles.dot, i === page && styles.dotActive]} />
        ))}
      </View>
      <Button
        title={last ? 'Set up permissions' : 'Next'}
        onPress={() => {
          if (last) nav.navigate('Permissions');
          else {
            ref.current?.scrollTo({ x: width * (page + 1), animated: true });
            setPage(page + 1);
          }
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, justifyContent: 'space-between' },
  brandRow: { alignItems: 'center', marginTop: Spacing.lg },
  brand: { ...Typography.label, color: Colors.primary, letterSpacing: 2, textTransform: 'uppercase' },
  pager: { flexGrow: 0 },
  page: { justifyContent: 'center', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: Spacing.xl },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: Radius.xl,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.lg,
  },
  title: { ...Typography.h2, textAlign: 'center', marginBottom: Spacing.md },
  body: { ...Typography.bodySecondary, textAlign: 'center', lineHeight: 22 },
  dots: { flexDirection: 'row', justifyContent: 'center', marginBottom: Spacing.lg },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.border, marginHorizontal: 4 },
  dotActive: { backgroundColor: Colors.primary, width: 20 },
});
