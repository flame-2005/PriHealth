/** Bluetooth SIG assigned numbers, full 128-bit form as react-native-ble-plx reports them. */
const base = (short: string) => `0000${short.toLowerCase()}-0000-1000-8000-00805f9b34fb`;

export const UUID = {
  HEART_RATE_SERVICE: base('180d'),
  HEART_RATE_MEASUREMENT: base('2a37'),
  WEIGHT_SCALE_SERVICE: base('181d'),
  WEIGHT_MEASUREMENT: base('2a9d'),
  BODY_COMPOSITION_SERVICE: base('181b'),
  BODY_COMPOSITION_MEASUREMENT: base('2a9c'),
  BATTERY_SERVICE: base('180f'),
  BATTERY_LEVEL: base('2a19'),
  DEVICE_INFO_SERVICE: base('180a'),
  MANUFACTURER_NAME: base('2a29'),
  MODEL_NUMBER: base('2a24'),
  FIRMWARE_REVISION: base('2a26'),
  // WeChat Sports pedometer profile (Tencent), carried by many Chinese-ODM watches for third-party apps.
  PEDOMETER_SERVICE: base('fee7'),
  PEDOMETER_MEASUREMENT: base('fea1'),
} as const;

/** 16-bit and 32-bit short forms become the full SIG form; everything else is lower-cased. */
export function normalizeUuid(u: string): string {
  const s = u.toLowerCase();
  if (s.length === 4) return base(s);
  if (s.length === 8) return `${s}-0000-1000-8000-00805f9b34fb`;
  return s;
}
