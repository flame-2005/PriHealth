import React from 'react';
import { DarkTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Activity, Footprints, Moon, MoreHorizontal, Scale } from 'lucide-react-native';
import { Colors } from '../theme';
import type { MainTabParamList, RootStackParamList } from './types';

import OnboardingScreen from '../screens/OnboardingScreen';
import PermissionsScreen from '../screens/PermissionsScreen';
import TodayScreen from '../screens/TodayScreen';
import ActivityScreen from '../screens/ActivityScreen';
import SleepScreen from '../screens/SleepScreen';
import BodyScreen from '../screens/BodyScreen';
import MoreScreen from '../screens/MoreScreen';
import WorkoutSessionScreen from '../screens/WorkoutSessionScreen';
import WorkoutDetailScreen from '../screens/WorkoutDetailScreen';
import ManualWorkoutScreen from '../screens/ManualWorkoutScreen';
import TrendsScreen from '../screens/TrendsScreen';
import HeartRateScreen from '../screens/HeartRateScreen';
import DevicesScreen from '../screens/DevicesScreen';
import DeviceSettingsScreen from '../screens/DeviceSettingsScreen';
import SettingsScreen from '../screens/SettingsScreen';
import PrivacyScreen from '../screens/PrivacyScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();

export const NavTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: Colors.background,
    card: Colors.surface,
    text: Colors.text,
    border: Colors.border,
    primary: Colors.primary,
    notification: Colors.primary,
  },
};

type IconProps = { color: string; size: number };
const TodayIcon = ({ color, size }: IconProps) => <Footprints color={color} size={size} />;
const ActivityIcon = ({ color, size }: IconProps) => <Activity color={color} size={size} />;
const SleepIcon = ({ color, size }: IconProps) => <Moon color={color} size={size} />;
const BodyIcon = ({ color, size }: IconProps) => <Scale color={color} size={size} />;
const MoreIcon = ({ color, size }: IconProps) => <MoreHorizontal color={color} size={size} />;

function MainTabs() {
  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.textSecondary,
        tabBarStyle: { backgroundColor: Colors.surface, borderTopColor: Colors.border },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500' },
        sceneStyle: { backgroundColor: Colors.background },
      }}>
      <Tabs.Screen name="Today" component={TodayScreen} options={{ tabBarIcon: TodayIcon }} />
      <Tabs.Screen name="Activity" component={ActivityScreen} options={{ tabBarIcon: ActivityIcon }} />
      <Tabs.Screen name="Sleep" component={SleepScreen} options={{ tabBarIcon: SleepIcon }} />
      <Tabs.Screen name="Body" component={BodyScreen} options={{ tabBarIcon: BodyIcon }} />
      <Tabs.Screen name="More" component={MoreScreen} options={{ tabBarIcon: MoreIcon }} />
    </Tabs.Navigator>
  );
}

export default function Navigation({ initialRoute }: { initialRoute: 'Onboarding' | 'Main' }) {
  return (
    <NavigationContainer theme={NavTheme}>
      <Stack.Navigator
        initialRouteName={initialRoute}
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: Colors.background },
          animation: 'fade_from_bottom',
        }}>
        <Stack.Screen name="Onboarding" component={OnboardingScreen} />
        <Stack.Screen name="Permissions" component={PermissionsScreen} />
        <Stack.Screen name="Main" component={MainTabs} />
        <Stack.Screen name="WorkoutSession" component={WorkoutSessionScreen} options={{ gestureEnabled: false }} />
        <Stack.Screen name="WorkoutDetail" component={WorkoutDetailScreen} />
        <Stack.Screen name="ManualWorkout" component={ManualWorkoutScreen} />
        <Stack.Screen name="Trends" component={TrendsScreen} />
        <Stack.Screen name="HeartRate" component={HeartRateScreen} />
        <Stack.Screen name="Devices" component={DevicesScreen} />
        <Stack.Screen name="DeviceSettings" component={DeviceSettingsScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="Privacy" component={PrivacyScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
