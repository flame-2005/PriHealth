import { create } from 'zustand';
import type { Capability, DevicePlatform } from '../domain/devices';
import type { RankingOverride } from '../domain/sources';
import { DEFAULT_GOALS, type Goals, type UnitSystem } from '../domain/types';
import { IDLE_SESSION, type SessionState } from '../tracking/workoutSession';
import { KEYS, prefs } from './prefs';
import type { DeviceKind } from '../db/repositories/devicesRepo';

export interface LiveHr {
  bpm: number;
  atMs: number;
  deviceId: string;
}

/** A connected watch's running step total for today. */
export interface LiveSteps {
  steps: number;
  atMs: number;
  deviceId: string;
}

export interface LiveSpo2 {
  percent: number;
  atMs: number;
  deviceId: string;
}

/** The latest live values of one connected device, whichever device the headline numbers follow. */
export interface DeviceLive {
  hr: LiveHr | null;
  steps: LiveSteps | null;
  spo2: LiveSpo2 | null;
}

export interface ConnectedDevice {
  id: string;
  name: string | null;
  kind: DeviceKind;
  platform: DevicePlatform;
  capabilities: Capability[];
  battery: number | null;
  syncing: boolean;
  lastSyncMs: number | null;
}

export interface Profile {
  heightCm: number | null;
  maxHr: number | null;
}

const EMPTY_LIVE: DeviceLive = { hr: null, steps: null, spo2: null };

interface AppState {
  hydrated: boolean;
  onboarded: boolean;
  unitSystem: UnitSystem;
  goals: Goals;
  profile: Profile;
  sourcePolicy: RankingOverride;
  dataVersion: number;
  /** The headline readings: whichever connected device the source policy ranks first for each. */
  liveHr: LiveHr | null;
  liveSteps: LiveSteps | null;
  /** Every connected device, keyed by id. Select one entry or a derived scalar, never the whole record inline. */
  connected: Record<string, ConnectedDevice>;
  liveByDevice: Record<string, DeviceLive>;
  session: SessionState;

  hydrate: () => Promise<void>;
  setOnboarded: (v: boolean) => Promise<void>;
  setUnitSystem: (u: UnitSystem) => Promise<void>;
  setGoals: (g: Partial<Goals>) => Promise<void>;
  setProfile: (p: Partial<Profile>) => Promise<void>;
  setSourcePolicy: (p: RankingOverride) => Promise<void>;
  bump: () => void;
  setLiveHr: (hr: LiveHr | null) => void;
  setLiveSteps: (s: LiveSteps | null) => void;
  /** Adds or replaces a connected device; null removes it and its live values. */
  setConnected: (id: string, d: ConnectedDevice | null) => void;
  updateConnected: (id: string, patch: Partial<ConnectedDevice>) => void;
  setDeviceLive: (id: string, patch: Partial<DeviceLive>) => void;
  /** `persist` defaults to true; pass false for high-frequency updates (live HR) and persist on a timer. */
  setSession: (s: SessionState, persist?: boolean) => Promise<void>;
  persistSession: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  hydrated: false,
  onboarded: false,
  unitSystem: 'metric',
  goals: DEFAULT_GOALS,
  profile: { heightCm: null, maxHr: null },
  sourcePolicy: {},
  dataVersion: 0,
  liveHr: null,
  liveSteps: null,
  connected: {},
  liveByDevice: {},
  session: IDLE_SESSION,

  hydrate: async () => {
    const [onboarded, unitSystem, goals, profile, sourcePolicy, session] = await Promise.all([
      prefs.getJson<boolean>(KEYS.onboarded),
      prefs.getJson<UnitSystem>(KEYS.unitSystem),
      prefs.getJson<Goals>(KEYS.goals),
      prefs.getJson<Profile>(KEYS.profile),
      prefs.getJson<RankingOverride>(KEYS.sourcePolicy),
      prefs.getJson<SessionState>(KEYS.session),
    ]);
    set({
      hydrated: true,
      onboarded: !!onboarded,
      unitSystem: unitSystem ?? 'metric',
      goals: { ...DEFAULT_GOALS, ...(goals ?? {}) },
      profile: { heightCm: null, maxHr: null, ...(profile ?? {}) },
      sourcePolicy: sourcePolicy ?? {},
      session: session && session.status !== 'idle' ? session : IDLE_SESSION,
    });
  },

  setOnboarded: async v => {
    set({ onboarded: v });
    await prefs.setJson(KEYS.onboarded, v);
  },

  setUnitSystem: async u => {
    set({ unitSystem: u });
    await prefs.setJson(KEYS.unitSystem, u);
  },

  setGoals: async g => {
    const goals = { ...get().goals, ...g };
    set({ goals });
    await prefs.setJson(KEYS.goals, goals);
  },

  setProfile: async p => {
    const profile = { ...get().profile, ...p };
    set({ profile });
    await prefs.setJson(KEYS.profile, profile);
  },

  setSourcePolicy: async p => {
    set({ sourcePolicy: p, dataVersion: get().dataVersion + 1 });
    await prefs.setJson(KEYS.sourcePolicy, p);
  },

  bump: () => set(s => ({ dataVersion: s.dataVersion + 1 })),

  setLiveHr: liveHr => set({ liveHr }),

  setLiveSteps: liveSteps => set({ liveSteps }),

  setConnected: (id, d) =>
    set(s => {
      const connected = { ...s.connected };
      const liveByDevice = { ...s.liveByDevice };
      if (d) connected[id] = d;
      else {
        delete connected[id];
        delete liveByDevice[id];
      }
      return { connected, liveByDevice };
    }),

  updateConnected: (id, patch) =>
    set(s => {
      const cur = s.connected[id];
      if (!cur) return {};
      return { connected: { ...s.connected, [id]: { ...cur, ...patch } } };
    }),

  setDeviceLive: (id, patch) =>
    set(s => ({ liveByDevice: { ...s.liveByDevice, [id]: { ...EMPTY_LIVE, ...s.liveByDevice[id], ...patch } } })),

  setSession: async (session, persist = true) => {
    set({ session });
    if (!persist) return;
    if (session.status === 'idle') await prefs.remove(KEYS.session);
    else await prefs.setJson(KEYS.session, session);
  },

  persistSession: async () => {
    const { session } = get();
    if (session.status === 'idle') await prefs.remove(KEYS.session);
    else await prefs.setJson(KEYS.session, session);
  },
}));
