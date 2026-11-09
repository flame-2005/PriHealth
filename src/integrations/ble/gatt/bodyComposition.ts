/* eslint-disable no-bitwise */
import { KG_PER_LB } from '../../../domain/units';
import { parseDateTime } from './weightScale';

export interface BodyCompositionMeasurement {
  bodyFatPercent: number | null;
  timestampMs: number | null;
  userId: number | null;
  basalMetabolismKj: number | null;
  musclePercent: number | null;
  muscleMassKg: number | null;
  fatFreeMassKg: number | null;
  softLeanMassKg: number | null;
  bodyWaterMassKg: number | null;
  impedanceOhm: number | null;
  weightKg: number | null;
  heightM: number | null;
}

function u16(b: Uint8Array, i: number): number {
  return b[i] | (b[i + 1] << 8);
}

/** Body Composition Measurement characteristic (0x2A9C), BCS 1.0. */
export function parseBodyComposition(bytes: Uint8Array): BodyCompositionMeasurement | null {
  if (bytes.length < 4) return null;
  const flags = u16(bytes, 0);
  const imperial = (flags & 0x0001) !== 0;
  const massRes = imperial ? 0.01 * KG_PER_LB : 0.005;
  let offset = 2;

  const fatRaw = u16(bytes, offset);
  offset += 2;
  const out: BodyCompositionMeasurement = {
    bodyFatPercent: fatRaw === 0xffff ? null : fatRaw * 0.1,
    timestampMs: null,
    userId: null,
    basalMetabolismKj: null,
    musclePercent: null,
    muscleMassKg: null,
    fatFreeMassKg: null,
    softLeanMassKg: null,
    bodyWaterMassKg: null,
    impedanceOhm: null,
    weightKg: null,
    heightM: null,
  };

  const take16 = (): number | null => {
    if (bytes.length < offset + 2) return null;
    const v = u16(bytes, offset);
    offset += 2;
    return v === 0xffff ? null : v;
  };

  if (flags & 0x0002) {
    out.timestampMs = parseDateTime(bytes, offset);
    offset += 7;
  }
  if (flags & 0x0004) {
    out.userId = bytes.length > offset ? bytes[offset] : null;
    offset += 1;
  }
  if (flags & 0x0008) out.basalMetabolismKj = take16();
  if (flags & 0x0010) {
    const v = take16();
    out.musclePercent = v == null ? null : v * 0.1;
  }
  if (flags & 0x0020) {
    const v = take16();
    out.muscleMassKg = v == null ? null : v * massRes;
  }
  if (flags & 0x0040) {
    const v = take16();
    out.fatFreeMassKg = v == null ? null : v * massRes;
  }
  if (flags & 0x0080) {
    const v = take16();
    out.softLeanMassKg = v == null ? null : v * massRes;
  }
  if (flags & 0x0100) {
    const v = take16();
    out.bodyWaterMassKg = v == null ? null : v * massRes;
  }
  if (flags & 0x0200) {
    const v = take16();
    out.impedanceOhm = v == null ? null : v * 0.1;
  }
  if (flags & 0x0400) {
    const v = take16();
    out.weightKg = v == null ? null : v * massRes;
  }
  if (flags & 0x0800) {
    const v = take16();
    out.heightM = v == null ? null : imperial ? v * 0.1 * 0.0254 : v * 0.001;
  }

  const r2 = (n: number | null) => (n == null ? null : Math.round(n * 100) / 100);
  out.muscleMassKg = r2(out.muscleMassKg);
  out.fatFreeMassKg = r2(out.fatFreeMassKg);
  out.softLeanMassKg = r2(out.softLeanMassKg);
  out.bodyWaterMassKg = r2(out.bodyWaterMassKg);
  out.weightKg = r2(out.weightKg);
  return out;
}
