import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Bluetooth, Settings, Shield, TrendingUp, WifiOff } from 'lucide-react-native';
import { Screen } from '../components/Screen';
import { Card } from '../components/Card';
import { ListRow } from '../components/ListRow';
import { Colors, Spacing, Typography } from '../theme';
import type { RootNav } from '../navigation/types';

export default function MoreScreen() {
  const nav = useNavigation<RootNav>();
  return (
    <Screen title="More">
      <Card>
        <ListRow icon={<TrendingUp color={Colors.primary} size={20} />} title="Trends" subtitle="7, 30 and 90-day charts" onPress={() => nav.navigate('Trends')} chevron />
        <ListRow icon={<Bluetooth color={Colors.weight} size={20} />} title="Devices" subtitle="Watches, rings, straps and scales" onPress={() => nav.navigate('Devices')} chevron />
        <ListRow icon={<Settings color={Colors.textSecondary} size={20} />} title="Settings" subtitle="Units, goals, export, delete" onPress={() => nav.navigate('Settings')} chevron />
        <ListRow icon={<Shield color={Colors.steps} size={20} />} title="Privacy" subtitle="What the app does and does not do" onPress={() => nav.navigate('Privacy')} chevron last />
      </Card>

      <View style={styles.badge}>
        <WifiOff color={Colors.steps} size={16} />
        <Text style={styles.badgeText}>This app has no internet permission. Nothing is uploaded, ever.</Text>
      </View>
      <Text style={styles.version}>PrivateFit 0.1.0</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.successDim,
    borderRadius: 12,
    padding: Spacing.md,
    marginTop: Spacing.lg,
  },
  badgeText: { ...Typography.caption, color: Colors.text, marginLeft: Spacing.sm, flex: 1 },
  version: { ...Typography.caption, color: Colors.textDim, textAlign: 'center', marginTop: Spacing.lg },
});
