import type { NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { SeriesKey } from '../hooks/useSeries';

export type MainTabParamList = {
  Today: undefined;
  Activity: undefined;
  Sleep: undefined;
  Body: undefined;
  More: undefined;
};

export type RootStackParamList = {
  Onboarding: undefined;
  Permissions: undefined;
  /** A tab can be named, so a tile on Today can open the Activity, Sleep or Body tab directly. */
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  WorkoutSession: undefined;
  WorkoutDetail: { id: number };
  ManualWorkout: undefined;
  Trends: { series?: SeriesKey } | undefined;
  HeartRate: undefined;
  Devices: undefined;
  DeviceSettings: { id: string };
  Settings: undefined;
  Privacy: undefined;
};

export type RootNav = NativeStackNavigationProp<RootStackParamList>;
