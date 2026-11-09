import type { DeviceKind } from '../../db/repositories/devicesRepo';
import type { KnownDevice } from '../../bridge/bondedDevices';
import { formFromName } from '../../domain/devices';
import { normalizeUuid, UUID } from './uuids';

/** How the phone came to know a device: it advertised during a scan, or the phone's own Bluetooth settings list it. */
export type FoundSource = 'scan' | 'paired' | 'connected';

export interface FoundDevice {
  id: string;
  name: string | null;
  rssi: number | null;
  kind: DeviceKind;
  source: FoundSource;
}

/**
 * A first guess at what a device is from the services it advertises; 16-bit, 32-bit and 128-bit
 * forms all count. Connect decides for real from what the device exposes (`devices/registry.ts`).
 */
export function kindFromServices(uuids: readonly string[] | null | undefined, name?: string | null): DeviceKind {
  const set = new Set((uuids ?? []).map(normalizeUuid));
  const named = formFromName(name);
  if (named) return named;
  // A watch usually carries the heart-rate service too; its pedometer is what sets it apart from a strap.
  if (set.has(UUID.PEDOMETER_SERVICE)) return 'watch';
  if (set.has(UUID.HEART_RATE_SERVICE)) return 'strap';
  if (set.has(UUID.WEIGHT_SCALE_SERVICE) || set.has(UUID.BODY_COMPOSITION_SERVICE)) return 'scale';
  return 'unknown';
}

/**
 * Whether an advert deserves a row. An unfiltered scan also hears phones, TVs and beacons, which
 * advertise anonymously; anything a person would want to connect to carries a name.
 */
export function isListable(name: string | null, kind: DeviceKind): boolean {
  return kind !== 'unknown' || (name?.trim().length ?? 0) > 0;
}

export function fromKnownDevice(k: KnownDevice): FoundDevice {
  return {
    id: k.id,
    name: k.name,
    rssi: null,
    kind: kindFromServices(k.serviceUuids, k.name),
    source: k.connected ? 'connected' : 'paired',
  };
}

const SOURCE_RANK: Record<FoundSource, number> = { scan: 0, paired: 1, connected: 2 };

/**
 * Adds `d` to `list` or folds it into the entry with the same id. A later sighting can fill in a
 * missing name, a more specific kind, a first signal reading or a stronger source. A device that
 * keeps advertising must not churn the list, so when nothing new is learned the same array comes back.
 */
export function mergeFound(list: FoundDevice[], d: FoundDevice): FoundDevice[] {
  const i = list.findIndex(p => p.id === d.id);
  if (i < 0) return [...list, d];
  const prev = list[i];
  const merged: FoundDevice = {
    id: prev.id,
    name: prev.name ?? d.name,
    rssi: prev.rssi ?? d.rssi,
    kind: prev.kind === 'unknown' ? d.kind : prev.kind,
    source: SOURCE_RANK[d.source] > SOURCE_RANK[prev.source] ? d.source : prev.source,
  };
  const unchanged = (Object.keys(merged) as (keyof FoundDevice)[]).every(k => merged[k] === prev[k]);
  return unchanged ? list : list.map((p, j) => (j === i ? merged : p));
}
