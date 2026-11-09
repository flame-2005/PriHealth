import AsyncStorage from '@react-native-async-storage/async-storage';

/** Small typed wrapper over AsyncStorage for preferences and tracker state. */
export const prefs = {
  async getJson<T>(key: string): Promise<T | null> {
    try {
      const raw = await AsyncStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  },
  async setJson(key: string, value: unknown): Promise<void> {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  },
  async remove(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
  },
  async clearAll(): Promise<void> {
    await AsyncStorage.clear();
  },
};

export const KEYS = {
  onboarded: 'pf.onboarded',
  unitSystem: 'pf.unitSystem',
  goals: 'pf.goals',
  stepState: 'pf.stepState',
  session: 'pf.session',
  pendingBedtime: 'pf.pendingBedtime',
  profile: 'pf.profile',
  demoSeeded: 'pf.demoSeeded',
  /** Per-metric source ranking the user set (see domain/sources.ts); absent means the defaults. */
  sourcePolicy: 'pf.sourcePolicy',
} as const;
