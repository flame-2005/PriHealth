/* eslint-disable no-bitwise */
import { KG_PER_LB } from '../../../domain/units';

export interface WeightMeasurement {
  kg: number;
  timestampMs: number | null;
  userId: number | null;
  bmi: number | null;
  heightM: number | null;
}

function u16(b: Uint8Array, i: number): number {
  return b[i] | (b[i + 1] << 8);
}

/** Parses the 7-byte SIG date_time structure. Returns null if year is 0 (unknown). */
export function parseDateTime(b: Uint8Array, i: number): number | null {
  if (b.length < i + 7) return null;
  const year = u16(b, i);
  if (year === 0) return null;
  return new Date(year, b[i + 2] - 1, b[i + 3], b[i + 4], b[i + 5], b[i + 6]).getTime();
}

/** Weight Measurement characteristic (0x2A9D), Weight Scale Service 1.0. */
export function parseWeight(bytes: Uint8Array): WeightMeasurement | null {
  if (bytes.length < 3) return null;
  const flags = bytes[0];
  const imperial = (flags & 0x01) !== 0;
  const hasTime = (flags & 0x02) !== 0;
  const hasUser = (flags & 0x04) !== 0;
  const hasBmi = (flags & 0x08) !== 0;

  const raw = u16(bytes, 1);
  if (raw === 0xffff) return null;
  const kg = imperial ? raw * 0.01 * KG_PER_LB : raw * 0.005;
  let offset = 3;

  let timestampMs: number | null = null;
  if (hasTime) {
    timestampMs = parseDateTime(bytes, offset);
    offset += 7;
  }
  let userId: number | null = null;
  if (hasUser && bytes.length > offset) {
    userId = bytes[offset];
    offset += 1;
  }
  let bmi: number | null = null;
  let heightM: number | null = null;
  if (hasBmi && bytes.length >= offset + 4) {
    bmi = u16(bytes, offset) * 0.1;
    const h = u16(bytes, offset + 2);
    heightM = imperial ? h * 0.1 * 0.0254 : h * 0.001;
  }

  return { kg: Math.round(kg * 100) / 100, timestampMs, userId, bmi, heightM };
}
