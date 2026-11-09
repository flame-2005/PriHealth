import { bytesToHex, hexToBytes } from '../../../domain/bytes';
import { normalizeUuid } from '../../ble/uuids';
import { BaseLink, type CharInfo } from '../link';

export interface FakeScriptStep {
  /** The write (hex) that triggers the replies. Matched once, in order of appearance. */
  tx: string;
  /** Replies (hex), delivered as notifications before the write resolves, like a fast device. */
  rx?: string[];
  rxService?: string;
  rxChar?: string;
}

export interface FakeLinkSpec {
  id?: string;
  mtu?: number;
  /** service uuid -> characteristic uuids (short or long). */
  services: Record<string, string[]>;
  /** `service/char` (short or long) -> hex returned by a read. */
  reads?: Record<string, string>;
  script?: FakeScriptStep[];
  /** Characteristic replies go to when a step names none; `service/char`. */
  notify?: string;
}

/**
 * A `GattLink` with no radio, driven by a spec: what the device exposes, what reads return, and
 * which notifications answer which writes. Drivers are tested against transcripts captured from
 * real devices without the devices.
 */
export class FakeLink extends BaseLink {
  readonly id: string;
  readonly services: readonly string[];
  protected chars: Map<string, CharInfo>;
  mtu: number;
  closed = false;
  readonly writes: Array<{ service: string; char: string; hex: string }> = [];
  private reads = new Map<string, string>();
  private script: Array<FakeScriptStep & { used?: boolean }>;
  private notify: { service: string; char: string } | null;
  private listeners = new Map<string, Set<(bytes: Uint8Array) => void>>();
  private disconnectCbs = new Set<(err: Error | null) => void>();

  constructor(spec: FakeLinkSpec) {
    super();
    this.id = spec.id ?? 'FA:KE:00:00:00:01';
    this.mtu = spec.mtu ?? 23;
    this.chars = new Map();
    for (const [service, chars] of Object.entries(spec.services)) {
      const s = normalizeUuid(service);
      for (const c of chars) {
        const uuid = normalizeUuid(c);
        this.chars.set(`${s}/${uuid}`, {
          service: s,
          uuid,
          readable: true,
          writable: true,
          writableWithoutResponse: true,
          notifiable: true,
          indicatable: true,
        });
      }
    }
    this.services = Object.keys(spec.services).map(normalizeUuid);
    for (const [k, hex] of Object.entries(spec.reads ?? {})) {
      const [s, c] = k.split('/');
      this.reads.set(`${normalizeUuid(s)}/${normalizeUuid(c)}`, hex);
    }
    this.script = (spec.script ?? []).map(s => ({ ...s }));
    if (spec.notify) {
      const [s, c] = spec.notify.split('/');
      this.notify = { service: normalizeUuid(s), char: normalizeUuid(c) };
    } else this.notify = null;
  }

  protected async rawRead(service: string, char: string): Promise<Uint8Array> {
    const hex = this.reads.get(`${service}/${char}`);
    if (hex == null) throw new Error(`FakeLink: nothing to read at ${char}`);
    return hexToBytes(hex);
  }

  protected async rawWrite(service: string, char: string, bytes: Uint8Array): Promise<void> {
    const hex = bytesToHex(bytes);
    this.writes.push({ service, char, hex });
    const step = this.script.find(s => !s.used && s.tx.replace(/[^0-9a-f]/gi, '').toLowerCase() === hex);
    if (!step) return;
    step.used = true;
    const target = {
      service: step.rxService ? normalizeUuid(step.rxService) : this.notify?.service ?? service,
      char: step.rxChar ? normalizeUuid(step.rxChar) : this.notify?.char ?? char,
    };
    for (const rx of step.rx ?? []) this.emit(target.service, target.char, rx);
  }

  protected rawMonitor(service: string, char: string, cb: (bytes: Uint8Array) => void): () => void {
    const k = `${service}/${char}`;
    let set = this.listeners.get(k);
    if (!set) {
      set = new Set();
      this.listeners.set(k, set);
    }
    set.add(cb);
    return () => {
      set!.delete(cb);
    };
  }

  /** Delivers a notification as the device would. */
  emit(service: string, char: string, hex: string): void {
    const set = this.listeners.get(`${normalizeUuid(service)}/${normalizeUuid(char)}`);
    if (!set) return;
    const bytes = hexToBytes(hex);
    for (const cb of [...set]) cb(bytes);
  }

  listenerCount(): number {
    let n = 0;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }

  /** The link dropped on its own. */
  disconnect(err: Error | null = null): void {
    for (const cb of [...this.disconnectCbs]) cb(err);
  }

  async requestMtu(n: number): Promise<number> {
    this.mtu = n;
    return n;
  }

  onDisconnected(cb: (err: Error | null) => void): () => void {
    this.disconnectCbs.add(cb);
    return () => {
      this.disconnectCbs.delete(cb);
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.listeners.clear();
  }
}
