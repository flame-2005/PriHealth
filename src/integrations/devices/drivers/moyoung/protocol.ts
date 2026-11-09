/* eslint-disable no-bitwise */
import { concatBytes, u24le, u32be } from '../../../../domain/bytes';
import { dayKey, parseDay } from '../../../../domain/time';
import type { SleepStageKind } from '../../../../domain/types';
import { normalizeUuid } from '../../../ble/uuids';
import type { DeviceRecord } from '../../types';

/**
 * MoYoung / Da Fit protocol, pure: frames in and out, nothing else. Facts and their sources are in
 * docs/PROTOCOLS.md; anything marked unconfirmed there is decoded here from the published summary
 * and stays switched off in the driver until a capture from a real watch confirms the layout.
 */
export const MOYOUNG = {
  SERVICE: normalizeUuid('feea'),
  STEPS: normalizeUuid('fee1'),
  DATA_OUT: normalizeUuid('fee2'),
  DATA_IN: normalizeUuid('fee3'),
} as const;

export const CMD = {
  SET_ALARM: 17,
  SET_USER_INFO: 18,
  SET_TIME_SYSTEM: 23,
  SET_TIMING_HR: 31,
  QUERY_ALARM: 33,
  QUERY_TIME_SYSTEM: 39,
  QUERY_DEVICE_VERSION: 46,
  QUERY_TIMING_HR: 47,
  SYNC_TIME: 49,
  SYNC_SLEEP: 50,
  SYNC_PAST_SLEEP_AND_STEP: 51,
  QUERY_LAST_DYNAMIC_RATE: 52,
  QUERY_PAST_HEART_RATE_1: 53,
  QUERY_PAST_HEART_RATE_2: 54,
  QUERY_MOVEMENT_HEART_RATE: 55,
  SEND_MESSAGE: 65,
  FIND_MY_WATCH: 97,
  FIND_MY_PHONE: 98,
  NOTIFY_PHONE_OPERATION: 103,
  TRIGGER_MEASURE_BLOOD_PRESSURE: 105,
  TRIGGER_MEASURE_BLOOD_OXYGEN: 107,
  TRIGGER_MEASURE_HEARTRATE: 109,
  QUERY_V2_WORKOUT: 0xb2,
  ADVANCED_QUERY: 0xb9,
} as const;

/** Timed heart-rate measurement: minutes between measurements to the byte the watch takes. */
export const HR_INTERVAL_CODE: Record<number, number> = { 0: 0, 5: 1, 10: 2, 20: 4, 30: 6 };
export const HR_INTERVALS = [0, 5, 10, 20, 30];

export const MESSAGE_TYPE = { call: 0, sms: 1, whatsapp: 8, other: 11 } as const;

/** The watch keeps its clock as epoch seconds of the local wall-clock time read as this zone. */
export const WATCH_TZ_OFFSET_MIN = 8 * 60;

/** Sleep entry types in sync-sleep replies. */
const STAGE: Record<number, SleepStageKind> = { 0: 'awake', 1: 'light', 2: 'deep', 3: 'rem' };

export interface Frame {
  cmd: number;
  payload: Uint8Array;
}

/**
 * `FE EA | size | command | payload`. With a 20-byte data MTU the size is `0x10, length`; with a
 * larger one `0x20 | length >> 8, length & 0xFF`. The length counts every byte of the frame.
 */
export function frame(cmd: number, payload: Uint8Array = new Uint8Array(0), dataMtu = 20): Uint8Array {
  const len = 5 + payload.length;
  const out = new Uint8Array(len);
  out[0] = 0xfe;
  out[1] = 0xea;
  if (dataMtu <= 20) {
    out[2] = 0x10;
    out[3] = len & 0xff;
  } else {
    out[2] = 0x20 | ((len >> 8) & 0x0f);
    out[3] = len & 0xff;
  }
  out[4] = cmd & 0xff;
  out.set(payload, 5);
  return out;
}

/** Frame length from a header, or null when the bytes do not start a frame. */
export function frameLength(b: Uint8Array): number | null {
  if (b.length < 4 || b[0] !== 0xfe || b[1] !== 0xea) return null;
  return b[2] & 0x20 ? ((b[2] & 0x0f) << 8) | b[3] : b[3];
}

/** Reassembles notification chunks into whole frames; tolerates garbage between frames. */
export class Unframer {
  private buf: Uint8Array = new Uint8Array(0);

  push(chunk: Uint8Array): Frame[] {
    this.buf = this.buf.length ? concatBytes([this.buf, chunk]) : chunk.slice();
    const out: Frame[] = [];
    for (;;) {
      let i = 0;
      while (i < this.buf.length && !(this.buf[i] === 0xfe && this.buf[i + 1] === 0xea)) i++;
      if (i >= this.buf.length) {
        // Keep a trailing FE in case EA follows in the next chunk.
        this.buf = this.buf.length && this.buf[this.buf.length - 1] === 0xfe ? this.buf.slice(-1) : new Uint8Array(0);
        return out;
      }
      if (i) this.buf = this.buf.slice(i);
      if (this.buf.length < 4) return out;
      const len = frameLength(this.buf)!;
      if (len < 5) {
        this.buf = this.buf.slice(2);
        continue;
      }
      if (this.buf.length < len) return out;
      out.push({ cmd: this.buf[4], payload: this.buf.slice(5, len) });
      this.buf = this.buf.slice(len);
    }
  }
}

/** Local wall-clock time as the watch wants it: epoch seconds of that wall-clock time read as GMT+8. */
export function toWatchTime(nowMs: number, tzOffsetMin: number): number {
  return Math.floor(nowMs / 1000) + tzOffsetMin * 60 - WATCH_TZ_OFFSET_MIN * 60;
}

export function fromWatchTime(seconds: number, tzOffsetMin: number): number {
  return (seconds - tzOffsetMin * 60 + WATCH_TZ_OFFSET_MIN * 60) * 1000;
}

/** Command 49: big-endian seconds followed by the zone byte (8), as in the documented example frame. */
export function encodeSyncTime(nowMs: number, tzOffsetMin: number, dataMtu = 20): Uint8Array {
  const t = toWatchTime(nowMs, tzOffsetMin);
  return frame(CMD.SYNC_TIME, Uint8Array.from([(t >>> 24) & 0xff, (t >>> 16) & 0xff, (t >>> 8) & 0xff, t & 0xff, 8]), dataMtu);
}

/** The time a sync-time frame would set, so a screen can show it before the first write. */
export function decodeSyncTime(payload: Uint8Array, tzOffsetMin: number): number | null {
  return payload.length >= 4 ? fromWatchTime(u32be(payload, 0), tzOffsetMin) : null;
}

/** Command 18: height cm, weight kg, age, gender (0 male, 1 female). Unconfirmed on hardware. */
export function encodeUserInfo(p: { heightCm: number; weightKg: number; age: number; male: boolean }, dataMtu = 20): Uint8Array {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return frame(CMD.SET_USER_INFO, Uint8Array.from([clamp(p.heightCm), clamp(p.weightKg), clamp(p.age), p.male ? 0 : 1]), dataMtu);
}

/** Command 31: timed heart-rate measurement interval. */
export function encodeHrInterval(minutes: number, dataMtu = 20): Uint8Array {
  const code = HR_INTERVAL_CODE[minutes];
  if (code == null) throw new Error(`Unsupported heart-rate interval: ${minutes} min`);
  return frame(CMD.SET_TIMING_HR, Uint8Array.from([code]), dataMtu);
}

export function encodeFindWatch(dataMtu = 20): Uint8Array {
  return frame(CMD.FIND_MY_WATCH, new Uint8Array(0), dataMtu);
}

export function encodeTriggerSpo2(start: boolean, dataMtu = 20): Uint8Array {
  return frame(CMD.TRIGGER_MEASURE_BLOOD_OXYGEN, Uint8Array.from([start ? 1 : 0]), dataMtu);
}

/** A query carries no payload; the reply echoes the command byte. */
export function encodeQuery(cmd: number, payload: Uint8Array = new Uint8Array(0), dataMtu = 20): Uint8Array {
  return frame(cmd, payload, dataMtu);
}

function utf8(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return Uint8Array.from(out);
}

/** Command 65: type byte, then "title₀text" in UTF-8, trimmed to what one frame can carry. */
export function encodeMessage(type: number, title: string, text: string, dataMtu = 20, maxBytes = 200): Uint8Array {
  let body = utf8(`${title}₀${text}`);
  if (body.length > maxBytes) {
    // Cut on a character boundary.
    let end = maxBytes;
    while (end > 0 && (body[end] & 0xc0) === 0x80) end--;
    body = body.slice(0, end);
  }
  return frame(CMD.SEND_MESSAGE, concatBytes([Uint8Array.from([type & 0xff]), body]), dataMtu);
}

/**
 * Commands 109 (heart rate) and 107 (SpO2) come back from the watch on their own when a measurement
 * is started on it: `FF` while it measures, then the value. Seen on the Noise Icon Plus as
 * `FE EA 20 06 6D FF` followed by `FE EA 20 06 6D 4A` (74 bpm). Null for the in-progress marker
 * and for anything out of range.
 */
export function decodeMeasurement(f: Frame): number | null {
  if (f.cmd !== CMD.TRIGGER_MEASURE_HEARTRATE && f.cmd !== CMD.TRIGGER_MEASURE_BLOOD_OXYGEN) return null;
  const v = f.payload[0];
  if (v == null || v === 0xff || v === 0) return null;
  if (f.cmd === CMD.TRIGGER_MEASURE_HEARTRATE && (v < 30 || v > 220)) return null;
  if (f.cmd === CMD.TRIGGER_MEASURE_BLOOD_OXYGEN && (v < 50 || v > 100)) return null;
  return v;
}

export type PhoneOp = 'play' | 'prev' | 'next' | 'reject_call' | 'find_phone';

/** Command 103 from the watch: what the user pressed. */
export function decodePhoneOperation(payload: Uint8Array): PhoneOp | null {
  switch (payload[0]) {
    case 0:
    case 6:
    case 7:
      return 'play';
    case 1:
      return 'prev';
    case 2:
      return 'next';
    case 3:
      return 'reject_call';
    default:
      return null;
  }
}

export interface SleepEntry {
  stage: SleepStageKind;
  hour: number;
  minute: number;
}

/** Sync-sleep payload: repeating `{type, hour, minute}`; each entry starts a stage that lasts until the next. */
export function decodeSleepEntries(payload: Uint8Array): SleepEntry[] {
  const out: SleepEntry[] = [];
  for (let i = 0; i + 2 < payload.length; i += 3) {
    const stage = STAGE[payload[i]];
    if (!stage || payload[i + 1] > 23 || payload[i + 2] > 59) continue;
    out.push({ stage, hour: payload[i + 1], minute: payload[i + 2] });
  }
  return out;
}

/**
 * Entries into a night that ends on `wakeDay`: times from the evening belong to the day before. The
 * last entry is the wake-up marker, so it ends the night and starts no stage.
 */
export function sleepRecord(entries: readonly SleepEntry[], wakeDay: string): DeviceRecord | null {
  if (entries.length < 2) return null;
  const dayStart = parseDay(wakeDay);
  const times = entries.map(e => {
    const minutes = e.hour * 60 + e.minute;
    const evening = e.hour >= 18;
    return dayStart + (evening ? -24 * 60 : 0) * 60_000 + minutes * 60_000;
  });
  const stages: Array<{ stage: SleepStageKind; startMs: number; endMs: number }> = [];
  for (let i = 0; i + 1 < entries.length; i++) {
    if (times[i + 1] <= times[i]) continue;
    stages.push({ stage: entries[i].stage, startMs: times[i], endMs: times[i + 1] });
  }
  if (!stages.length) return null;
  const startMs = stages[0].startMs;
  const endMs = stages[stages.length - 1].endMs;
  return { kind: 'sleep', startMs, endMs, externalId: `sleep:${startMs}`, stages };
}

/**
 * Past sleep-and-steps reply (command 51). Published summary only: a day index, the day's
 * `{distance u24, steps u24, calories u24}`, then sleep entries. Unconfirmed on hardware.
 */
export function decodePastDay(payload: Uint8Array, todayKey: string): DeviceRecord[] {
  if (payload.length < 10) return [];
  const daysBack = payload[0];
  const day = dayKey(parseDay(todayKey) - daysBack * 86_400_000 + 12 * 3600_000);
  const dayStart = parseDay(day);
  const out: DeviceRecord[] = [];
  const steps = u24le(payload, 4);
  if (steps > 0) {
    out.push({ kind: 'daily_total', metric: 'steps', day, value: steps, unit: 'count', firstMs: dayStart, atMs: dayStart + 86_400_000 - 1 });
    const distance = u24le(payload, 1);
    if (distance > 0) out.push({ kind: 'daily_total', metric: 'distance', day, value: distance, unit: 'm', firstMs: dayStart, atMs: dayStart + 86_400_000 - 1 });
    const kcal = u24le(payload, 7);
    if (kcal > 0) out.push({ kind: 'daily_total', metric: 'active_kcal', day, value: kcal, unit: 'kcal', firstMs: dayStart, atMs: dayStart + 86_400_000 - 1 });
  }
  const night = sleepRecord(decodeSleepEntries(payload.slice(10)), day);
  if (night) out.push(night);
  return out;
}

/**
 * Past heart-rate reply (command 53): packets of five-minute samples, four per day, today first
 * then yesterday; the first byte is the packet index, a zero sample is "no reading". Unconfirmed.
 */
export function decodePastHeartRate(payload: Uint8Array, todayKey: string): DeviceRecord[] {
  if (payload.length < 2) return [];
  const index = payload[0];
  const samples = payload.slice(1);
  const perPacket = 72; // 288 five-minute slots a day over four packets
  const daysBack = index >= 4 ? 1 : 0;
  const dayStart = parseDay(todayKey) - daysBack * 86_400_000;
  const slot0 = (index % 4) * perPacket;
  const out: DeviceRecord[] = [];
  for (let i = 0; i < samples.length && i < perPacket; i++) {
    const bpm = samples[i];
    if (bpm < 30 || bpm > 220) continue;
    const atMs = dayStart + (slot0 + i) * 5 * 60_000;
    out.push({ kind: 'sample', metric: 'heart_rate', value: bpm, unit: 'bpm', atMs, externalId: `hr:${Math.floor(atMs / 60_000)}` });
  }
  return out;
}
