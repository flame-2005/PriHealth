/* eslint-disable no-bitwise */
import { dayKey, parseDay } from '../../../../domain/time';
import type { DeviceRecord } from '../../types';

/**
 * Colmi / QRing rings (R02, R06, R10 and rebrands), pure. Layouts come from the MIT-licensed
 * `colmi_r02_client` (docs/PROTOCOLS.md). Packets are 16 bytes: command, up to 14 payload bytes,
 * and a checksum that is the sum of the first 15 bytes masked to a byte.
 *
 * Clock convention: the reference client sets the ring to UTC; we set it to local wall-clock time
 * so the ring's day boundaries are the user's, and read its timestamps back the same way.
 */
export const COLMI = {
  SERVICE: '6e40fff0-b5a3-f393-e0a9-e50e24dcca9e',
  RX: '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
  TX: '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
} as const;

export const CMD = {
  SET_TIME: 1,
  BATTERY: 3,
  HR_LOG: 21,
  HR_LOG_SETTINGS: 22,
  REAL_TIME_HR_KEEPALIVE: 30,
  STEPS: 67,
  START_REAL_TIME: 105,
  STOP_REAL_TIME: 106,
} as const;

export const READING = { HEART_RATE: 1, SPO2: 3 } as const;
export const ACTION = { START: 1, PAUSE: 2, CONTINUE: 3, STOP: 4 } as const;

export const PACKET_LENGTH = 16;
const SLOT_MINUTES = 15;
const HR_SLOTS = 288;

export function checksum(p: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < PACKET_LENGTH - 1; i++) sum += p[i];
  return sum & 0xff;
}

export function packet(cmd: number, sub: readonly number[] = []): Uint8Array {
  if (sub.length > 14) throw new Error('Colmi payload is at most 14 bytes.');
  const p = new Uint8Array(PACKET_LENGTH);
  p[0] = cmd & 0xff;
  for (let i = 0; i < sub.length; i++) p[i + 1] = sub[i] & 0xff;
  p[PACKET_LENGTH - 1] = checksum(p);
  return p;
}

export function isValidPacket(p: Uint8Array): boolean {
  return p.length === PACKET_LENGTH && p[PACKET_LENGTH - 1] === checksum(p);
}

export function bcd(n: number): number {
  const v = Math.max(0, Math.min(99, Math.round(n)));
  return ((v / 10) << 4) | v % 10;
}

export function fromBcd(b: number): number {
  return (b >> 4) * 10 + (b & 0x0f);
}

/** Command 1: year-2000, month, day, hour, minute, second as BCD, then language 1 (0 is Chinese). */
export function encodeSetTime(nowMs: number): Uint8Array {
  const d = new Date(nowMs);
  return packet(CMD.SET_TIME, [
    bcd(d.getFullYear() - 2000),
    bcd(d.getMonth() + 1),
    bcd(d.getDate()),
    bcd(d.getHours()),
    bcd(d.getMinutes()),
    bcd(d.getSeconds()),
    1,
  ]);
}

export function encodeBatteryRequest(): Uint8Array {
  return packet(CMD.BATTERY);
}

export function decodeBattery(p: Uint8Array): { percent: number; charging: boolean } | null {
  if (p[0] !== CMD.BATTERY) return null;
  return { percent: p[1], charging: p[2] !== 0 };
}

/** Command 67: the day (0 today, 1 yesterday...) and four bytes the reference client keeps constant. */
export function encodeStepsRequest(dayOffset: number): Uint8Array {
  return packet(CMD.STEPS, [dayOffset & 0xff, 0x0f, 0x00, 0x5f, 0x01]);
}

export interface StepSlot {
  day: string;
  /** 15-minute slot within the day. */
  slot: number;
  steps: number;
  distanceM: number;
}

/**
 * Collects the multi-packet reply to a steps request: a header (byte 1 = 240) then one packet
 * per 15-minute slot with activity, byte 5 the packet index and byte 6 the count; byte 1 = 255
 * means the day holds nothing.
 */
export class StepsCollector {
  readonly slots: StepSlot[] = [];
  private started = false;

  push(p: Uint8Array): 'more' | 'done' | 'none' {
    if (p[0] !== CMD.STEPS) return 'more';
    if (!this.started) {
      if (p[1] === 255) return 'none';
      if (p[1] === 240) {
        this.started = true;
        return 'more';
      }
    }
    this.started = true;
    const day = `${2000 + fromBcd(p[1])}-${String(fromBcd(p[2])).padStart(2, '0')}-${String(fromBcd(p[3])).padStart(2, '0')}`;
    this.slots.push({ day, slot: p[4], steps: p[9] | (p[10] << 8), distanceM: p[11] | (p[12] << 8) });
    return p[5] >= p[6] - 1 ? 'done' : 'more';
  }
}

/** A day's slots as the running totals the rest of the app stores. */
export function stepsDailyTotals(slots: readonly StepSlot[]): DeviceRecord[] {
  const byDay = new Map<string, StepSlot[]>();
  for (const s of slots) {
    const arr = byDay.get(s.day);
    if (arr) arr.push(s);
    else byDay.set(s.day, [s]);
  }
  const out: DeviceRecord[] = [];
  for (const [day, list] of byDay) {
    const start = parseDay(day);
    if (Number.isNaN(start)) continue;
    const first = Math.min(...list.map(s => s.slot));
    const last = Math.max(...list.map(s => s.slot));
    const firstMs = start + first * SLOT_MINUTES * 60_000;
    const atMs = start + (last + 1) * SLOT_MINUTES * 60_000;
    const steps = list.reduce((a, s) => a + s.steps, 0);
    const distance = list.reduce((a, s) => a + s.distanceM, 0);
    if (steps > 0) out.push({ kind: 'daily_total', metric: 'steps', day, value: steps, unit: 'count', firstMs, atMs });
    if (distance > 0) out.push({ kind: 'daily_total', metric: 'distance', day, value: distance, unit: 'm', firstMs, atMs });
  }
  return out;
}

/** The ring reads its clock as if it were UTC, so a local day is sent as that date at 00:00 UTC. */
export function ringDaySeconds(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 1000);
}

/** Command 21: the day's start as the ring counts it, little-endian. */
export function encodeHrLogRequest(day: string): Uint8Array {
  const t = ringDaySeconds(day);
  return packet(CMD.HR_LOG, [t & 0xff, (t >>> 8) & 0xff, (t >>> 16) & 0xff, (t >>> 24) & 0xff]);
}

/**
 * Collects a heart-rate log: sub-type 0 announces how many packets follow, sub-type 1 carries the
 * day's timestamp and the first nine readings, later sub-types thirteen readings each; 255 means
 * no data. Readings are five minutes apart from midnight; 0 is "no reading".
 */
export class HrLogCollector {
  readonly readings: number[] = [];
  private size = 0;

  push(p: Uint8Array): 'more' | 'done' | 'none' {
    if (p[0] !== CMD.HR_LOG) return 'more';
    const sub = p[1];
    if (sub === 255) return 'none';
    if (sub === 0) {
      this.size = p[2];
      return this.size === 0 ? 'none' : 'more';
    }
    if (sub === 1) this.readings.push(...p.subarray(6, 15));
    else this.readings.push(...p.subarray(2, 15));
    return sub >= this.size - 1 ? 'done' : 'more';
  }
}

export function hrLogRecords(readings: readonly number[], day: string): DeviceRecord[] {
  const start = parseDay(day);
  const out: DeviceRecord[] = [];
  for (let i = 0; i < Math.min(readings.length, HR_SLOTS); i++) {
    const bpm = readings[i];
    if (bpm < 30 || bpm > 220) continue;
    const atMs = start + i * 5 * 60_000;
    out.push({ kind: 'sample', metric: 'heart_rate', value: bpm, unit: 'bpm', atMs, externalId: `hr:${Math.floor(atMs / 60_000)}` });
  }
  return out;
}

export function encodeHrSettingsRead(): Uint8Array {
  return packet(CMD.HR_LOG_SETTINGS, [1]);
}

/** Byte 2 is 1 for enabled and 2 for disabled; byte 3 the interval in minutes. */
export function decodeHrSettings(p: Uint8Array): { enabled: boolean; intervalMin: number } | null {
  if (p[0] !== CMD.HR_LOG_SETTINGS) return null;
  return { enabled: p[2] === 1, intervalMin: p[3] };
}

export function encodeHrSettingsWrite(enabled: boolean, intervalMin: number): Uint8Array {
  const interval = Math.max(1, Math.min(255, Math.round(intervalMin)));
  return packet(CMD.HR_LOG_SETTINGS, [2, enabled ? 1 : 2, interval]);
}

export function encodeRealTime(type: number, action: number): Uint8Array {
  return packet(CMD.START_REAL_TIME, [type, action]);
}

export function encodeStopRealTime(type: number): Uint8Array {
  return packet(CMD.STOP_REAL_TIME, [type, 0, 0]);
}

/** Byte 1 the reading type, byte 2 an error code (0 is fine), byte 3 the value. */
export function decodeRealTime(p: Uint8Array): { type: number; error: number; value: number } | null {
  if (p[0] !== CMD.START_REAL_TIME) return null;
  return { type: p[1], error: p[2], value: p[3] };
}

export function todayAndYesterday(nowMs: number): [string, string] {
  return [dayKey(nowMs), dayKey(nowMs - 86_400_000)];
}
