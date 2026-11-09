import type { Device, Subscription } from 'react-native-ble-plx';
import { base64ToBytes, bytesToBase64 } from '../../domain/base64';
import { bytesToHex, bytesToText } from '../../domain/bytes';
import { getBle } from '../ble/manager';
import { normalizeUuid, UUID } from '../ble/uuids';

export interface CharInfo {
  service: string;
  uuid: string;
  readable: boolean;
  writable: boolean;
  writableWithoutResponse: boolean;
  notifiable: boolean;
  indicatable: boolean;
}

/** One line of what went over the air; `rd` is a read, `tx` a write, `rx` a notification. */
export interface TranscriptEntry {
  t: number;
  dir: 'tx' | 'rx' | 'rd';
  uuid: string;
  hex: string;
}

export interface WriteOptions {
  /** Write with response (default when the characteristic supports it). */
  response?: boolean;
}

export interface RequestOptions extends WriteOptions {
  service: string;
  write: string;
  notify: string;
  bytes: Uint8Array;
  /** Which notifications belong to this request. */
  match: (frame: Uint8Array) => boolean;
  /** When given, frames are collected until one satisfies it; otherwise the first match resolves. */
  until?: (frame: Uint8Array) => boolean;
  timeoutMs?: number;
}

/**
 * One connected device, as drivers see it. Characteristic UUIDs may be short or long. `write`
 * chunks to the MTU, `request` arms its matcher before writing (a reply can arrive before the
 * write promise resolves), and `transcript` keeps the last frames so a session on a real device
 * can be exported as a regression fixture.
 */
export interface GattLink {
  readonly id: string;
  readonly mtu: number;
  readonly services: readonly string[];
  has(service: string, char?: string): boolean;
  read(service: string, char: string): Promise<Uint8Array>;
  write(service: string, char: string, bytes: Uint8Array, opts?: WriteOptions): Promise<void>;
  monitor(service: string, char: string, cb: (bytes: Uint8Array) => void): () => void;
  request(o: RequestOptions): Promise<Uint8Array[]>;
  requestMtu(n: number): Promise<number>;
  onDisconnected(cb: (err: Error | null) => void): () => void;
  /** Removes every monitor and drops the connection. */
  close(): Promise<void>;
  transcript(): TranscriptEntry[];
}

export const DEFAULT_MTU = 23;
export const REQUEST_TIMEOUT_MS = 5000;
const TRANSCRIPT_MAX = 2000;

export abstract class BaseLink implements GattLink {
  abstract readonly id: string;
  abstract readonly mtu: number;
  abstract readonly services: readonly string[];
  protected abstract chars: Map<string, CharInfo>;
  protected abstract rawRead(service: string, char: string): Promise<Uint8Array>;
  protected abstract rawWrite(service: string, char: string, bytes: Uint8Array, response: boolean): Promise<void>;
  protected abstract rawMonitor(service: string, char: string, cb: (bytes: Uint8Array) => void): () => void;
  abstract requestMtu(n: number): Promise<number>;
  abstract onDisconnected(cb: (err: Error | null) => void): () => void;
  abstract close(): Promise<void>;

  private log: TranscriptEntry[] = [];

  protected record(dir: TranscriptEntry['dir'], uuid: string, bytes: Uint8Array): void {
    this.log.push({ t: Date.now(), dir, uuid: normalizeUuid(uuid), hex: bytesToHex(bytes) });
    if (this.log.length > TRANSCRIPT_MAX) this.log.splice(0, this.log.length - TRANSCRIPT_MAX);
  }

  transcript(): TranscriptEntry[] {
    return [...this.log];
  }

  protected key(service: string, char: string): string {
    return `${normalizeUuid(service)}/${normalizeUuid(char)}`;
  }

  has(service: string, char?: string): boolean {
    const s = normalizeUuid(service);
    if (!this.services.includes(s)) return false;
    return char ? this.chars.has(this.key(service, char)) : true;
  }

  info(service: string, char: string): CharInfo | undefined {
    return this.chars.get(this.key(service, char));
  }

  async read(service: string, char: string): Promise<Uint8Array> {
    const bytes = await this.rawRead(normalizeUuid(service), normalizeUuid(char));
    this.record('rd', char, bytes);
    return bytes;
  }

  async write(service: string, char: string, bytes: Uint8Array, opts?: WriteOptions): Promise<void> {
    const s = normalizeUuid(service);
    const c = normalizeUuid(char);
    const info = this.chars.get(`${s}/${c}`);
    const response = opts?.response ?? (info ? info.writable || !info.writableWithoutResponse : true);
    const size = Math.max(1, this.mtu - 3);
    if (!bytes.length) {
      await this.rawWrite(s, c, bytes, response);
      this.record('tx', char, bytes);
      return;
    }
    for (let i = 0; i < bytes.length; i += size) {
      const chunk = bytes.subarray(i, i + size);
      await this.rawWrite(s, c, chunk, response);
      this.record('tx', char, chunk);
    }
  }

  monitor(service: string, char: string, cb: (bytes: Uint8Array) => void): () => void {
    return this.rawMonitor(normalizeUuid(service), normalizeUuid(char), bytes => {
      this.record('rx', char, bytes);
      cb(bytes);
    });
  }

  request(o: RequestOptions): Promise<Uint8Array[]> {
    return new Promise<Uint8Array[]>((resolve, reject) => {
      const frames: Uint8Array[] = [];
      let done = false;
      let stop = () => {};
      let timer: ReturnType<typeof setTimeout> | null = null;
      const finish = (err: Error | null) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        stop();
        if (err) reject(err);
        else resolve(frames);
      };
      timer = setTimeout(() => finish(new Error(`No reply from ${this.id} within ${o.timeoutMs ?? REQUEST_TIMEOUT_MS} ms.`)), o.timeoutMs ?? REQUEST_TIMEOUT_MS);
      // The matcher is live before the write goes out: notifications arrive on another thread.
      stop = this.monitor(o.service, o.notify, frame => {
        if (done || !o.match(frame)) return;
        frames.push(frame);
        if (!o.until || o.until(frame)) finish(null);
      });
      this.write(o.service, o.write, o.bytes, { response: o.response }).catch(finish);
    });
  }
}

interface Fanout {
  sub: Subscription;
  listeners: Set<(bytes: Uint8Array) => void>;
}

/** A react-native-ble-plx connection. One native monitor per characteristic, shared by its listeners. */
export class BleLink extends BaseLink {
  readonly id: string;
  readonly services: readonly string[];
  protected chars: Map<string, CharInfo>;
  private device: Device;
  private fanouts = new Map<string, Fanout>();

  constructor(device: Device, chars: readonly CharInfo[]) {
    super();
    this.device = device;
    this.id = device.id;
    this.chars = new Map(chars.map(c => [`${c.service}/${c.uuid}`, c]));
    this.services = [...new Set(chars.map(c => c.service))];
  }

  get mtu(): number {
    return this.device.mtu || DEFAULT_MTU;
  }

  protected async rawRead(service: string, char: string): Promise<Uint8Array> {
    const ch = await this.device.readCharacteristicForService(service, char);
    return ch.value ? base64ToBytes(ch.value) : new Uint8Array(0);
  }

  protected async rawWrite(service: string, char: string, bytes: Uint8Array, response: boolean): Promise<void> {
    const value = bytesToBase64(bytes);
    if (response) await this.device.writeCharacteristicWithResponseForService(service, char, value);
    else await this.device.writeCharacteristicWithoutResponseForService(service, char, value);
  }

  protected rawMonitor(service: string, char: string, cb: (bytes: Uint8Array) => void): () => void {
    const k = `${service}/${char}`;
    let entry = this.fanouts.get(k);
    if (!entry) {
      const listeners = new Set<(bytes: Uint8Array) => void>();
      const sub = this.device.monitorCharacteristicForService(service, char, (error, ch) => {
        // Errors here mean the link dropped; onDeviceDisconnected tears everything down.
        if (error || !ch?.value) return;
        const bytes = base64ToBytes(ch.value);
        for (const l of listeners) l(bytes);
      });
      entry = { sub, listeners };
      this.fanouts.set(k, entry);
    }
    const fan = entry;
    fan.listeners.add(cb);
    return () => {
      fan.listeners.delete(cb);
      if (!fan.listeners.size && this.fanouts.get(k) === fan) {
        fan.sub.remove();
        this.fanouts.delete(k);
      }
    };
  }

  /** Android 14+ grants 517 on the first request per link and ignores later ones; the real value is what counts. */
  async requestMtu(n: number): Promise<number> {
    try {
      this.device = await this.device.requestMTU(n);
    } catch {
      // Keep whatever the link has (23 when nothing was negotiated).
    }
    return this.mtu;
  }

  onDisconnected(cb: (err: Error | null) => void): () => void {
    const sub = getBle().onDeviceDisconnected(this.id, err => cb(err));
    return () => sub.remove();
  }

  async close(): Promise<void> {
    for (const f of this.fanouts.values()) f.sub.remove();
    this.fanouts.clear();
    try {
      await getBle().cancelDeviceConnection(this.id);
    } catch {
      // already disconnected
    }
  }
}

/** Wraps a connected, discovered device. */
export async function createBleLink(device: Device): Promise<BleLink> {
  const services = await device.services();
  const chars: CharInfo[] = [];
  for (const s of services) {
    const list = await device.characteristicsForService(s.uuid);
    for (const c of list) {
      chars.push({
        service: normalizeUuid(s.uuid),
        uuid: normalizeUuid(c.uuid),
        readable: c.isReadable,
        writable: c.isWritableWithResponse,
        writableWithoutResponse: c.isWritableWithoutResponse,
        notifiable: c.isNotifiable,
        indicatable: c.isIndicatable,
      });
    }
  }
  return new BleLink(device, chars);
}

/** Device Information (0x180A) strings, which is how vendor platforms are told apart. */
export async function readDeviceInfo(link: GattLink): Promise<{ manufacturer: string | null; model: string | null; firmware: string | null }> {
  const out = { manufacturer: null as string | null, model: null as string | null, firmware: null as string | null };
  if (!link.has(UUID.DEVICE_INFO_SERVICE)) return out;
  const text = async (char: string) => {
    if (!link.has(UUID.DEVICE_INFO_SERVICE, char)) return null;
    try {
      const v = bytesToText(await link.read(UUID.DEVICE_INFO_SERVICE, char));
      return v || null;
    } catch {
      return null;
    }
  };
  out.manufacturer = await text(UUID.MANUFACTURER_NAME);
  out.model = await text(UUID.MODEL_NUMBER);
  out.firmware = await text(UUID.FIRMWARE_REVISION);
  return out;
}
