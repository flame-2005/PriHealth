import type { Capability, DeviceForm, DevicePlatform, DeviceSettings } from '../../domain/devices';
import type { BodyKind, Metric, SleepStageKind, WorkoutType } from '../../domain/types';
import type { BodyCompositionMeasurement } from '../ble/gatt/bodyComposition';
import type { WeightMeasurement } from '../ble/gatt/weightScale';
import type { GattLink } from './link';

export type { Capability, DeviceForm, DevicePlatform, DeviceSettings };

/** What is known about a device once connected: its services and, when it has them, its Device Information strings. */
export interface DeviceInfo {
  id: string;
  name: string | null;
  /** Full 128-bit, lower-case, as `normalizeUuid` gives them. */
  services: string[];
  manufacturer: string | null;
  model: string | null;
  firmware: string | null;
}

/**
 * What a driver hands back from a history sync. Every record carries a deterministic external id,
 * so syncing the same span twice stores it once (see `sync.ts`).
 */
export type DeviceRecord =
  | { kind: 'sample'; metric: Metric; value: number; unit: string; atMs: number; externalId: string }
  | {
      kind: 'daily_total';
      metric: 'steps' | 'distance' | 'active_kcal';
      day: string;
      value: number;
      unit: string;
      /** When the device first and last reported for the day. */
      firstMs: number;
      atMs: number;
    }
  | {
      kind: 'sleep';
      startMs: number;
      endMs: number;
      externalId: string;
      stages: Array<{ stage: SleepStageKind; startMs: number; endMs: number }>;
    }
  | {
      kind: 'workout';
      type: WorkoutType;
      startMs: number;
      endMs: number;
      durationS: number;
      distanceM?: number | null;
      kcal?: number | null;
      avgHr?: number | null;
      maxHr?: number | null;
      externalId: string;
      hr: Array<{ atMs: number; bpm: number }>;
    }
  | { kind: 'body'; bodyKind: BodyKind; value: number; unit: string; atMs: number; externalId: string };

/** Live things a device says while connected. */
export type DeviceEvent =
  | { type: 'hr'; bpm: number; atMs: number }
  | { type: 'steps'; steps: number; distanceM: number | null; kcal: number | null; atMs: number }
  | { type: 'spo2'; percent: number; atMs: number }
  | { type: 'battery'; percent: number }
  | { type: 'scale'; weight?: WeightMeasurement; body?: BodyCompositionMeasurement }
  | { type: 'records'; records: DeviceRecord[] }
  | { type: 'phone_op'; op: 'find_phone' | 'play' | 'pause' | 'next' | 'prev' | 'reject_call' }
  | { type: 'sync'; status: 'started' | 'done' | 'failed'; message?: string };

export interface UserProfile {
  heightCm: number | null;
  weightKg: number | null;
  age: number | null;
  male: boolean | null;
}

export interface DriverContext {
  info: DeviceInfo;
  emit: (e: DeviceEvent) => void;
  settings: DeviceSettings;
  profile: UserProfile;
}

export type HandlerId =
  | 'gatt-hr'
  | 'gatt-pedometer'
  | 'gatt-scale'
  | 'gatt-battery'
  | 'moyoung'
  | 'colmi'
  | 'fitcloudpro'
  | 'gloryfit'
  | 'xiaomi';

export interface Detection {
  /** What the device is, when the handler can tell; null leaves it to the others. */
  form: DeviceForm | null;
  capabilities: Capability[];
  /** Standard handlers a vendor driver replaces because it owns their data. */
  suppress?: HandlerId[];
}

/** One protocol handler. Standard handlers cover one SIG profile each; a vendor driver covers a platform. */
export interface DeviceDriver {
  id: HandlerId;
  platform: DevicePlatform;
  /** At most one vendor driver runs per link. */
  vendor: boolean;
  detect(info: DeviceInfo): Detection | null;
  open(link: GattLink, ctx: DriverContext): Promise<DriverSession>;
}

/** A handler running on a connection. Everything beyond `close` is optional and matches a capability. */
export interface DriverSession {
  capabilities: Capability[];
  /** History since `sinceMs` (null for everything the device holds). Safe to repeat. */
  sync?(sinceMs: number | null): Promise<DeviceRecord[]>;
  /** Re-reads slow values such as battery; called every few minutes while connected. */
  poll?(): Promise<void>;
  setTime?(nowMs: number, tzOffsetMin: number): Promise<void>;
  setProfile?(p: UserProfile): Promise<void>;
  setHrInterval?(minutes: number): Promise<void>;
  setAlarms?(alarms: Array<{ id: number; hour: number; minute: number; repeatMask: number; on: boolean }>): Promise<void>;
  findDevice?(): Promise<void>;
  sendNotification?(n: { app: string; title: string; text: string; category: 'call' | 'sms' | 'whatsapp' | 'other' }): Promise<void>;
  close(): Promise<void>;
}
