import { dayKey } from '../../../../domain/time';
import { UUID } from '../../../ble/uuids';
import type { GattLink } from '../../link';
import type { Capability, DeviceDriver, DeviceRecord, DriverContext, DriverSession, UserProfile } from '../../types';
import {
  CMD,
  decodeMeasurement,
  decodePastDay,
  decodePastHeartRate,
  decodePhoneOperation,
  decodeSleepEntries,
  encodeFindWatch,
  encodeHrInterval,
  encodeMessage,
  encodeQuery,
  encodeSyncTime,
  encodeUserInfo,
  HR_INTERVAL_CODE,
  MESSAGE_TYPE,
  MOYOUNG,
  sleepRecord,
  Unframer,
  type Frame,
} from './protocol';

/**
 * Da Fit / MoYoung watches (Noise Icon Plus and most budget watches with `MOY-` firmware). The
 * standard handlers keep the live heart rate (0x180D) and step total (0xFEE7); this driver adds
 * what the vendor app did: clock, profile, measurement interval, find, notifications and history.
 *
 * Every command is behind a switch in the device's settings (`commands`). The ones whose layout a
 * capture has confirmed default to on; history sync stays off until the watch's replies have been
 * captured and turned into fixtures (docs/DEVICES.md, "Capturing a device").
 */
export const MOYOUNG_COMMANDS = {
  set_time: true,
  user_profile: true,
  hr_interval: true,
  sync_sleep: false,
  sync_past_days: false,
  sync_hr: false,
} as const;

export type MoyoungCommand = keyof typeof MOYOUNG_COMMANDS;

const REPLY_TIMEOUT_MS = 4000;
/** A multi-frame reply is complete once the watch has been quiet this long. */
const REPLY_IDLE_MS = 600;

const CAPABILITIES: Capability[] = [
  'set_time',
  'user_profile',
  'hr_interval',
  'find_device',
  'notifications',
  'history_sleep',
  'history_steps',
  'history_hr',
  'spo2',
];

interface Waiter {
  cmd: number;
  frames: Frame[];
  resolve: (frames: Frame[]) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
  multi: boolean;
}

function tzOffsetMin(): number {
  return -new Date().getTimezoneOffset();
}

export function isMoyoung(info: { services: string[]; manufacturer: string | null }): boolean {
  return info.services.includes(MOYOUNG.SERVICE) || (info.manufacturer ?? '').toUpperCase().startsWith('MOYOUNG');
}

class MoyoungSession implements DriverSession {
  capabilities = CAPABILITIES;
  private unframer = new Unframer();
  private waiters: Waiter[] = [];
  private stop: () => void;
  private dataMtu: number;

  constructor(private link: GattLink, private ctx: DriverContext) {
    // A "MOYOUNG-V2" watch frames its own messages in the long size form (seen on the Noise Icon
    // Plus, which answers `FE EA 20 ...` whatever the link's MTU), so match it; writes are still
    // chunked to the link's MTU by the link itself.
    const v2 = /V2/i.test(ctx.info.manufacturer ?? '');
    this.dataMtu = v2 ? Math.max(244, link.mtu - 3) : Math.max(20, link.mtu - 3);
    this.stop = link.monitor(MOYOUNG.SERVICE, MOYOUNG.DATA_IN, chunk => {
      for (const f of this.unframer.push(chunk)) this.onFrame(f);
    });
  }

  enabled(cmd: MoyoungCommand): boolean {
    return this.ctx.settings.commands?.[cmd] ?? MOYOUNG_COMMANDS[cmd];
  }

  private onFrame(f: Frame): void {
    const w = this.waiters.find(x => x.cmd === f.cmd);
    if (w) {
      w.frames.push(f);
      if (!w.multi) this.settle(w, null);
      else {
        if (w.timer) clearTimeout(w.timer);
        w.timer = setTimeout(() => this.settle(w, null), REPLY_IDLE_MS);
      }
      return;
    }
    if (f.cmd === CMD.NOTIFY_PHONE_OPERATION) {
      const op = decodePhoneOperation(f.payload);
      if (op) this.ctx.emit({ type: 'phone_op', op });
      return;
    }
    // A measurement started on the watch itself reports back: 0xFF while measuring, then the value.
    const value = decodeMeasurement(f);
    if (value == null) return;
    if (f.cmd === CMD.TRIGGER_MEASURE_HEARTRATE) this.ctx.emit({ type: 'hr', bpm: value, atMs: Date.now() });
    else if (f.cmd === CMD.TRIGGER_MEASURE_BLOOD_OXYGEN) this.ctx.emit({ type: 'spo2', percent: value, atMs: Date.now() });
  }

  private settle(w: Waiter, err: Error | null): void {
    const i = this.waiters.indexOf(w);
    if (i < 0) return;
    this.waiters.splice(i, 1);
    if (w.timer) clearTimeout(w.timer);
    if (err) w.reject(err);
    else w.resolve(w.frames);
  }

  private send(bytes: Uint8Array): Promise<void> {
    return this.link.write(MOYOUNG.SERVICE, MOYOUNG.DATA_OUT, bytes);
  }

  /** Writes a query and collects the frames that echo its command byte; the waiter is armed before the write. */
  private exchange(cmd: number, bytes: Uint8Array, multi = false): Promise<Frame[]> {
    return new Promise<Frame[]>((resolve, reject) => {
      const w: Waiter = { cmd, frames: [], resolve, reject, timer: null, multi };
      w.timer = setTimeout(() => this.settle(w, new Error(`The watch did not answer command ${cmd}.`)), REPLY_TIMEOUT_MS);
      this.waiters.push(w);
      this.send(bytes).catch(e => this.settle(w, e instanceof Error ? e : new Error(String(e))));
    });
  }

  async start(): Promise<void> {
    // A cheap read after the monitor is a barrier: the notification subscription lands before the first command.
    if (this.link.has(UUID.BATTERY_SERVICE, UUID.BATTERY_LEVEL)) await this.link.read(UUID.BATTERY_SERVICE, UUID.BATTERY_LEVEL).catch(() => {});
    if (this.enabled('set_time')) await this.setTime(Date.now(), tzOffsetMin()).catch(() => {});
    if (this.enabled('user_profile')) await this.setProfile(this.ctx.profile).catch(() => {});
    const interval = this.ctx.settings.hrIntervalMin;
    if (this.enabled('hr_interval') && interval != null && HR_INTERVAL_CODE[interval] != null) await this.setHrInterval(interval).catch(() => {});
  }

  async setTime(nowMs: number, tz: number): Promise<void> {
    await this.send(encodeSyncTime(nowMs, tz, this.dataMtu));
  }

  async setProfile(p: UserProfile): Promise<void> {
    if (p.heightCm == null || p.weightKg == null) return;
    await this.send(encodeUserInfo({ heightCm: p.heightCm, weightKg: p.weightKg, age: p.age ?? 30, male: p.male ?? true }, this.dataMtu));
  }

  async setHrInterval(minutes: number): Promise<void> {
    await this.send(encodeHrInterval(minutes, this.dataMtu));
  }

  async findDevice(): Promise<void> {
    await this.send(encodeFindWatch(this.dataMtu));
  }

  async sendNotification(n: { app: string; title: string; text: string; category: 'call' | 'sms' | 'whatsapp' | 'other' }): Promise<void> {
    await this.send(encodeMessage(MESSAGE_TYPE[n.category], n.title || n.app, n.text, this.dataMtu));
  }

  async sync(): Promise<DeviceRecord[]> {
    const today = dayKey(Date.now());
    const out: DeviceRecord[] = [];
    if (this.enabled('sync_sleep')) {
      const frames = await this.exchange(CMD.SYNC_SLEEP, encodeQuery(CMD.SYNC_SLEEP, undefined, this.dataMtu), true);
      const night = sleepRecord(decodeSleepEntries(frames.length ? frames.map(f => f.payload).reduce((a, b) => Uint8Array.from([...a, ...b])) : new Uint8Array(0)), today);
      if (night) out.push(night);
    }
    if (this.enabled('sync_past_days')) {
      for (const daysBack of [1, 2]) {
        const frames = await this.exchange(CMD.SYNC_PAST_SLEEP_AND_STEP, encodeQuery(CMD.SYNC_PAST_SLEEP_AND_STEP, Uint8Array.from([daysBack]), this.dataMtu), true);
        for (const f of frames) out.push(...decodePastDay(f.payload, today));
      }
    }
    if (this.enabled('sync_hr')) {
      const frames = await this.exchange(CMD.QUERY_PAST_HEART_RATE_1, encodeQuery(CMD.QUERY_PAST_HEART_RATE_1, undefined, this.dataMtu), true);
      for (const f of frames) out.push(...decodePastHeartRate(f.payload, today));
    }
    return out;
  }

  async close(): Promise<void> {
    this.stop();
    for (const w of [...this.waiters]) this.settle(w, new Error('Disconnected.'));
  }
}

export const moyoungDriver: DeviceDriver = {
  id: 'moyoung',
  platform: 'moyoung',
  vendor: true,
  detect: info => (isMoyoung(info) ? { form: 'watch', capabilities: CAPABILITIES } : null),
  async open(link, ctx) {
    const session = new MoyoungSession(link, ctx);
    await session.start();
    return session;
  },
};
