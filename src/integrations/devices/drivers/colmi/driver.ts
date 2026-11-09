/* eslint-disable no-bitwise */
import { addDays } from '../../../../domain/time';
import type { GattLink } from '../../link';
import type { Capability, DeviceDriver, DeviceRecord, DriverContext, DriverSession } from '../../types';
import {
  CMD,
  COLMI,
  decodeBattery,
  encodeBatteryRequest,
  encodeHrLogRequest,
  encodeHrSettingsWrite,
  encodeSetTime,
  encodeStepsRequest,
  HrLogCollector,
  hrLogRecords,
  isValidPacket,
  StepsCollector,
  stepsDailyTotals,
  todayAndYesterday,
} from './protocol';

/**
 * Colmi / QRing rings. No pairing or key; the ring answers anyone in range. Layouts are the
 * reference client's (docs/PROTOCOLS.md), which runs against real rings, so the commands default
 * to on; the platform still shows as experimental until a ring has been tried with this app.
 */
export const COLMI_COMMANDS = {
  set_time: true,
  hr_interval: true,
  sync_steps: true,
  sync_hr: true,
} as const;

export type ColmiCommand = keyof typeof COLMI_COMMANDS;

const REPLY_TIMEOUT_MS = 6000;
const CAPABILITIES: Capability[] = ['battery', 'set_time', 'hr_interval', 'history_steps', 'history_hr'];

interface Waiter {
  cmd: number;
  done: (p: Uint8Array) => boolean;
  resolve: () => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

class ColmiSession implements DriverSession {
  capabilities = CAPABILITIES;
  private waiters: Waiter[] = [];
  private stop: () => void;

  constructor(private link: GattLink, private ctx: DriverContext) {
    this.stop = link.monitor(COLMI.SERVICE, COLMI.TX, p => this.onPacket(p));
  }

  enabled(cmd: ColmiCommand): boolean {
    return this.ctx.settings.commands?.[cmd] ?? COLMI_COMMANDS[cmd];
  }

  private onPacket(p: Uint8Array): void {
    // The high bit marks an error reply; a bad checksum is noise.
    if (!isValidPacket(p) || p[0] & 0x80) return;
    const w = this.waiters.find(x => x.cmd === p[0]);
    if (!w) return;
    if (w.done(p)) this.settle(w, null);
  }

  private settle(w: Waiter, err: Error | null): void {
    const i = this.waiters.indexOf(w);
    if (i < 0) return;
    this.waiters.splice(i, 1);
    clearTimeout(w.timer);
    if (err) w.reject(err);
    else w.resolve();
  }

  private send(bytes: Uint8Array): Promise<void> {
    return this.link.write(COLMI.SERVICE, COLMI.RX, bytes, { response: false });
  }

  /** Writes a packet and feeds every reply with its command byte to `done` until it says so. */
  private exchange(cmd: number, bytes: Uint8Array, done: (p: Uint8Array) => boolean, timeoutMs = REPLY_TIMEOUT_MS): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const w: Waiter = {
        cmd,
        done,
        resolve,
        reject,
        timer: setTimeout(() => this.settle(w, new Error(`The ring did not answer command ${cmd}.`)), timeoutMs),
      };
      this.waiters.push(w);
      this.send(bytes).catch(e => this.settle(w, e instanceof Error ? e : new Error(String(e))));
    });
  }

  private async readBattery(): Promise<void> {
    await this.exchange(CMD.BATTERY, encodeBatteryRequest(), p => {
      const b = decodeBattery(p);
      if (b) this.ctx.emit({ type: 'battery', percent: b.percent });
      return true;
    }).catch(() => {});
  }

  async start(): Promise<void> {
    await this.readBattery();
    if (this.enabled('set_time')) await this.setTime(Date.now()).catch(() => {});
    const interval = this.ctx.settings.hrIntervalMin;
    if (this.enabled('hr_interval') && interval != null) await this.setHrInterval(interval).catch(() => {});
  }

  poll(): Promise<void> {
    return this.readBattery();
  }

  async setTime(nowMs: number): Promise<void> {
    // The ring answers with a capability bitmask that the reference client ignores; so do we.
    await this.exchange(CMD.SET_TIME, encodeSetTime(nowMs), () => true, 2000).catch(() => {});
  }

  async setHrInterval(minutes: number): Promise<void> {
    await this.exchange(CMD.HR_LOG_SETTINGS, encodeHrSettingsWrite(minutes > 0, minutes > 0 ? minutes : 60), () => true, 2000).catch(() => {});
  }

  async sync(): Promise<DeviceRecord[]> {
    const out: DeviceRecord[] = [];
    const [today, yesterday] = todayAndYesterday(Date.now());
    if (this.enabled('sync_steps')) {
      for (const offset of [0, 1]) {
        const c = new StepsCollector();
        await this.exchange(CMD.STEPS, encodeStepsRequest(offset), p => c.push(p) !== 'more');
        out.push(...stepsDailyTotals(c.slots));
      }
    }
    if (this.enabled('sync_hr')) {
      for (const day of [yesterday, today]) {
        const c = new HrLogCollector();
        await this.exchange(CMD.HR_LOG, encodeHrLogRequest(day), p => c.push(p) !== 'more');
        out.push(...hrLogRecords(c.readings, day));
      }
    }
    return out;
  }

  async close(): Promise<void> {
    this.stop();
    for (const w of [...this.waiters]) this.settle(w, new Error('Disconnected.'));
  }
}

export function isColmi(info: { services: string[] }): boolean {
  return info.services.includes(COLMI.SERVICE);
}

export const colmiDriver: DeviceDriver = {
  id: 'colmi',
  platform: 'colmi',
  vendor: true,
  detect: info => (isColmi(info) ? { form: 'ring', capabilities: CAPABILITIES } : null),
  async open(link, ctx) {
    const session = new ColmiSession(link, ctx);
    await session.start();
    return session;
  },
};

/** The day keys a sync asks the ring about, oldest first; exported for tests. */
export function syncDays(nowMs: number): string[] {
  const [today] = todayAndYesterday(nowMs);
  return [addDays(today, -1), today];
}
