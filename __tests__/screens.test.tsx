import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from '../src/app/App';
import { bodyRepo } from '../src/db/repositories/bodyRepo';
import { devicesRepo } from '../src/db/repositories/devicesRepo';
import { samplesRepo } from '../src/db/repositories/samplesRepo';
import { sleepRepo } from '../src/db/repositories/sleepRepo';
import { workoutsRepo } from '../src/db/repositories/workoutsRepo';
import { dayKey } from '../src/domain/time';
import { useAppStore } from '../src/store/useAppStore';
import { IDLE_SESSION, startSession } from '../src/tracking/workoutSession';
import ActivityScreen from '../src/screens/ActivityScreen';
import BodyScreen from '../src/screens/BodyScreen';
import DevicesScreen from '../src/screens/DevicesScreen';
import HeartRateScreen from '../src/screens/HeartRateScreen';
import DeviceSettingsScreen from '../src/screens/DeviceSettingsScreen';
import ManualWorkoutScreen from '../src/screens/ManualWorkoutScreen';
import MoreScreen from '../src/screens/MoreScreen';
import OnboardingScreen from '../src/screens/OnboardingScreen';
import PermissionsScreen from '../src/screens/PermissionsScreen';
import PrivacyScreen from '../src/screens/PrivacyScreen';
import SettingsScreen from '../src/screens/SettingsScreen';
import SleepScreen from '../src/screens/SleepScreen';
import TodayScreen from '../src/screens/TodayScreen';
import TrendsScreen from '../src/screens/TrendsScreen';
import WorkoutDetailScreen from '../src/screens/WorkoutDetailScreen';
import WorkoutSessionScreen from '../src/screens/WorkoutSessionScreen';

/**
 * Mounts every screen, and the whole app, on top of the real schema and queries. There is no
 * device in the loop, so this is what catches a screen that throws while rendering its data.
 */
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest'));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
jest.mock('react-native-ble-plx', () => ({
  ScanMode: { LowPower: 0, Balanced: 1, LowLatency: 2 },
  BleManager: class {
    state = async () => 'PoweredOn';
    startDeviceScan = async () => {};
    stopDeviceScan = async () => {};
    cancelDeviceConnection = async () => {};
    onDeviceDisconnected = () => ({ remove() {} });
    onStateChange = () => ({ remove() {} });
    connectToDevice = async () => {
      throw new Error('no radio');
    };
    isDeviceConnected = async () => false;
  },
}));

const suite = (globalThis as any).process.getBuiltinModule?.('node:sqlite') ? describe : describe.skip;

const Stack = createNativeStackNavigator();

/** One turn of the event loop inside act, so pending loads and their re-renders can run. */
const settle = () => act(async () => new Promise<void>(resolve => setTimeout(resolve, 5)));

async function render(element: React.ReactElement): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(element);
  });
  return tree;
}

function mount(component: React.ComponentType<any>, params?: object): Promise<ReactTestRenderer> {
  return render(
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Probe" component={component} initialParams={params} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>,
  );
}

function textOf(tree: ReactTestRenderer): string {
  const flatten = (c: unknown): string =>
    Array.isArray(c) ? c.map(flatten).join('') : typeof c === 'string' || typeof c === 'number' ? String(c) : '';
  return tree.root
    .findAllByType(Text)
    .map(t => flatten(t.props.children))
    .join(' | ');
}

/** Screen text once every expected string has appeared, or whatever is there after ~1 s. */
async function textWhenReady(tree: ReactTestRenderer, expected: string[]): Promise<string> {
  for (let i = 0; i < 200 && !expected.every(s => textOf(tree).includes(s)); i++) await settle();
  return textOf(tree);
}

const NOW = Date.now();
const TODAY = dayKey(NOW);
const HOUR = 3600_000;
const errors: string[] = [];
let runId: number | undefined;

suite('screens', () => {
  beforeAll(async () => {
    jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });

    await samplesRepo.insert({ metric: 'steps', value: 950, unit: 'count', startMs: NOW - 1000, endMs: NOW, day: TODAY, sourceId: 'phone' });
    runId = await workoutsRepo.insert({
      type: 'run',
      startMs: NOW - HOUR,
      endMs: NOW - HOUR / 2,
      day: TODAY,
      durationS: 1800,
      distanceM: 5000,
      kcal: 315,
      avgHr: 150,
      maxHr: 171,
      effort: 7,
      notes: 'felt good',
      sourceId: 'manual',
    });
    await samplesRepo.insertMany(
      [148, 152, 171].map((bpm, i) => ({
        metric: 'heart_rate' as const,
        value: bpm,
        unit: 'bpm',
        startMs: NOW - HOUR + i * 60_000,
        endMs: NOW - HOUR + i * 60_000,
        day: TODAY,
        sourceId: 'ble:AA',
        externalId: `workout:${runId}:${i}`,
      })),
    );
    await sleepRepo.insert({ startMs: NOW - 9 * HOUR, endMs: NOW - 2 * HOUR, day: TODAY, sourceId: 'manual' });
    await bodyRepo.insert({ kind: 'weight', value: 72.1, unit: 'kg', atMs: NOW - 5000, day: TODAY, sourceId: 'manual' });
    await devicesRepo.upsert({ id: 'AA:BB', name: 'Polar H10', kind: 'strap', lastSeenMs: NOW, capabilities: ['live_hr', 'battery'] });
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  afterEach(() => {
    // React reports render and effect failures through console.error instead of throwing.
    const unexpected = errors.filter(e => !e.includes('not wrapped in act'));
    errors.length = 0;
    expect(unexpected).toEqual([]);
  });

  // name, component, route params, text that must appear, text that must not
  const cases: Array<[string, React.ComponentType<any>, object | undefined, string[], string[]]> = [
    ['Onboarding', OnboardingScreen, undefined, ['Nothing leaves your phone', 'stored only on this device.'], ['encrypted database']],
    ['Permissions', PermissionsScreen, undefined, ['Physical activity', 'Nearby devices'], []],
    ['Today', TodayScreen, undefined, ['Today', '950', 'Start workout'], []],
    ['Activity', ActivityScreen, undefined, ['Run · 30m', '5.00 km', '315 kcal'], []],
    ['Sleep', SleepScreen, undefined, ['Last night: 7h 00m'], []],
    ['Body', BodyScreen, undefined, ['Current weight', '72.1'], []],
    ['More', MoreScreen, undefined, ['Trends', 'Devices', 'Settings', 'Privacy'], []],
    ['Manual workout', ManualWorkoutScreen, undefined, ['Log a workout', 'Save workout'], []],
    ['Trends, steps', TrendsScreen, undefined, ['Min | 950 | steps'], []],
    // Days without a reading are gaps: they must not pull the minimum and average down to zero.
    ['Trends, heart rate', TrendsScreen, { series: 'heart_rate' }, ['Min | 157 | bpm | Average | 157 | bpm | Max | 157 | bpm'], []],
    ['Trends, resting heart rate', TrendsScreen, { series: 'resting_hr' }, ['Min | 148 | bpm | Average | 148 | bpm'], []],
    ['Trends, weight', TrendsScreen, { series: 'weight' }, ['Min | 72.1 | kg'], ['No weight data']],
    // The run's trace (148, 152, 171) is today's data: last reading, low/average/high and the recent list.
    ['Heart rate', HeartRateScreen, undefined, ['Heart rate', '171', 'last reading', 'Low | 148', 'High | 171', '3 readings today', 'Recent readings', 'Connect a watch, ring or strap'], ['No readings today']],
    ['Devices', DevicesScreen, undefined, ['Scan for devices', 'Polar H10'], []],
    ['Device settings, a saved strap', DeviceSettingsScreen, { id: 'AA:BB' }, ['Polar H10', 'Heart-rate sensor', 'Heart rate', 'Auto-connect', 'Forget this device'], ['Commands']],
    ['Device settings, an unknown id', DeviceSettingsScreen, { id: 'ZZ:ZZ' }, ['This device is not saved'], []],
    ['Settings', SettingsScreen, undefined, ['Sources', 'Steps', 'Watch', 'Phone', 'Daily steps', 'Export JSON', 'Delete all data'], []],
    ['Privacy', PrivacyScreen, undefined, ['No account, no server'], []],
  ];

  it.each(cases)('%s', async (_name, component, params, present, absent) => {
    const tree = await mount(component, params);
    const text = await textWhenReady(tree, present);
    for (const s of present) expect(text).toContain(s);
    for (const s of absent) expect(text).not.toContain(s);
    await act(async () => tree.unmount());
  });

  it('Devices, with a watch connected: live row, saved reading and watch steps', async () => {
    const steps = { steps: 1067, atMs: NOW, deviceId: 'AA' };
    useAppStore.setState({
      connected: {
        AA: { id: 'AA', name: 'Icon Plus', kind: 'watch', platform: 'gatt', capabilities: ['live_hr', 'live_steps', 'battery'], battery: 51, syncing: false, lastSyncMs: null },
      },
      liveByDevice: { AA: { hr: null, steps, spo2: null } },
      liveSteps: steps,
    });
    const tree = await mount(DevicesScreen);
    const text = await textWhenReady(tree, ['Last saved 171 bpm']);
    expect(text).toContain('Watch');
    expect(text).toContain('battery 51%');
    expect(text).toContain('Shares: Steps · Heart rate');
    expect(text).toContain('bpm live');
    expect(text).toContain('Last saved 171 bpm');
    expect(text).toContain('steps today from the watch');
    await act(async () => tree.unmount());
    useAppStore.setState({ connected: {}, liveByDevice: {}, liveSteps: null });
  });

  it('Workout detail', async () => {
    const tree = await mount(WorkoutDetailScreen, { id: runId });
    const present = ['Run', '30:00', '315', '7/10', 'felt good', 'Heart rate'];
    const text = await textWhenReady(tree, present);
    for (const s of present) expect(text).toContain(s);
    await act(async () => tree.unmount());
  });

  it('Workout session, while one is running', async () => {
    await act(async () => useAppStore.getState().setSession(startSession('cycle', Date.now() - 65_000)));
    const tree = await mount(WorkoutSessionScreen);
    const text = await textWhenReady(tree, ['Recording']);
    expect(text).toContain('Cycle');
    expect(text).toContain('Recording');
    expect(text).toMatch(/1:0\d/);
    await act(async () => tree.unmount());
    await act(async () => useAppStore.getState().setSession(IDLE_SESSION));
  });

  it('the app opens on onboarding for a new install', async () => {
    await AsyncStorage.clear();
    useAppStore.setState({ hydrated: false, onboarded: false });
    const tree = await render(<App />);
    expect(await textWhenReady(tree, ['Nothing leaves your phone'])).toContain('Nothing leaves your phone');
    await act(async () => tree.unmount());
  });

  it('the app opens on Today once onboarded', async () => {
    await AsyncStorage.setItem('pf.onboarded', 'true');
    // A launch starts with a fresh store; the test before this one left it hydrated.
    useAppStore.setState({ hydrated: false, onboarded: false });
    const tree = await render(<App />);
    const text = await textWhenReady(tree, ['Today', '950']);
    expect(text).toContain('Today');
    expect(text).toContain('950');
    await act(async () => tree.unmount());
  });
});
