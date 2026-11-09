/** What a device is, physically. Drives icons, labels and the default source ranking. */
export type DeviceForm = 'watch' | 'band' | 'ring' | 'strap' | 'scale' | 'unknown';

/** The protocol family a device speaks; `gatt` means standard Bluetooth profiles only. */
export type DevicePlatform = 'gatt' | 'moyoung' | 'colmi' | 'fitcloudpro' | 'gloryfit' | 'xiaomi';

/** What a device can give or take. Drivers declare these; screens and the sync loop act on them. */
export type Capability =
  | 'live_hr'
  | 'live_steps'
  | 'history_steps'
  | 'history_sleep'
  | 'history_hr'
  | 'spo2'
  | 'stress'
  | 'workouts'
  | 'weight'
  | 'body_composition'
  | 'battery'
  | 'set_time'
  | 'user_profile'
  | 'hr_interval'
  | 'alarms'
  | 'find_device'
  | 'notifications'
  | 'music_control';

export const FORM_LABEL: Record<DeviceForm, string> = {
  watch: 'Watch',
  band: 'Band',
  ring: 'Ring',
  strap: 'Heart-rate sensor',
  scale: 'Smart scale',
  unknown: 'Bluetooth device',
};

export const PLATFORM_LABEL: Record<DevicePlatform, string> = {
  gatt: 'Standard Bluetooth',
  moyoung: 'Da Fit',
  colmi: 'Colmi / QRing',
  fitcloudpro: 'FitCloudPro',
  gloryfit: 'GloryFit',
  xiaomi: 'Xiaomi / Zepp',
};

/** Platforms whose driver has not been validated on a real device yet. */
export const EXPERIMENTAL_PLATFORMS: readonly DevicePlatform[] = ['colmi', 'fitcloudpro', 'gloryfit', 'xiaomi'];

/** Per-device preferences, kept as JSON in `devices.settings`. Drivers read what they understand. */
export interface DeviceSettings {
  /** Automatic heart-rate measurement interval the device should use, in minutes; 0 is off. */
  hrIntervalMin?: number;
  /** Forward phone notifications to this device. Off until the user turns it on. */
  notifications?: boolean;
  /** Packages whose notifications are forwarded; empty means all. */
  notifyApps?: string[];
  /** Per-command switches, so an unconfirmed protocol command can be turned off without a rebuild. */
  commands?: Record<string, boolean>;
}

/**
 * The short list a screen shows for "what this device shares". Live and history variants of the
 * same thing collapse into one chip.
 */
export function capabilityChips(caps: readonly Capability[]): string[] {
  const set = new Set(caps);
  const out: string[] = [];
  if (set.has('live_steps') || set.has('history_steps')) out.push('Steps');
  if (set.has('live_hr') || set.has('history_hr')) out.push('Heart rate');
  if (set.has('history_sleep')) out.push('Sleep');
  if (set.has('spo2')) out.push('SpO2');
  if (set.has('stress')) out.push('Stress');
  if (set.has('workouts')) out.push('Workouts');
  if (set.has('weight')) out.push('Weight');
  if (set.has('body_composition')) out.push('Body composition');
  return out;
}

/** A device's advertised name often says what it is when its services do not. */
export function formFromName(name: string | null | undefined): DeviceForm | null {
  if (!name) return null;
  if (/\bring\b/i.test(name) || /^R0\d\b/i.test(name)) return 'ring';
  if (/\bband\b/i.test(name)) return 'band';
  return null;
}
