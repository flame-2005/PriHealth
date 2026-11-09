/* eslint-disable no-bitwise */
export interface PedometerMeasurement {
  /** Steps so far today, as the device counts them. */
  steps: number;
  distanceM: number | null;
  kcal: number | null;
}

/**
 * Current Pedometer Measurement (0xFEA1) of the WeChat Sports profile, which many Chinese-ODM
 * watches (MoYoung/Da Fit among them) expose for third-party apps: a flags byte, then up to three
 * little-endian 24-bit fields. Bit 0: step count, bit 1: distance in metres, bit 2: calories in kcal.
 */
export function parsePedometer(bytes: Uint8Array): PedometerMeasurement | null {
  if (bytes.length < 4) return null;
  const flags = bytes[0];
  if ((flags & 0x01) === 0) return null;
  let offset = 1;
  const next = (): number | null => {
    if (bytes.length < offset + 3) return null;
    const v = bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
    offset += 3;
    return v;
  };
  const steps = next();
  if (steps == null) return null;
  const distanceM = (flags & 0x02) !== 0 ? next() : null;
  const kcal = (flags & 0x04) !== 0 ? next() : null;
  return { steps, distanceM, kcal };
}
