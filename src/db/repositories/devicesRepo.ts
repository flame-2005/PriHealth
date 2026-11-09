import { batch, query, run } from '..';
import type { Capability, DeviceForm, DevicePlatform, DeviceSettings } from '../../domain/devices';

/** The form factor; `strap` is a single-profile heart-rate sensor, `unknown` has no profile we read. */
export type DeviceKind = DeviceForm;

export interface SavedDevice {
  id: string;
  name: string | null;
  kind: DeviceKind;
  lastSeenMs: number;
  platform: DevicePlatform;
  capabilities: Capability[];
  manufacturer: string | null;
  model: string | null;
  firmware: string | null;
  autoConnect: boolean;
  lastSyncMs: number | null;
  settings: DeviceSettings;
}

/** What a connect learns. Anything omitted (or null) keeps its stored value. */
export type DeviceUpsert = Pick<SavedDevice, 'id' | 'kind' | 'lastSeenMs'> & {
  name: string | null;
} & Partial<Pick<SavedDevice, 'platform' | 'capabilities' | 'manufacturer' | 'model' | 'firmware' | 'autoConnect' | 'settings'>>;

function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw == null || raw === '') return fallback;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return fallback;
  }
}

function fromRow(r: Record<string, unknown>): SavedDevice {
  return {
    id: String(r.id),
    name: (r.name as string | null) ?? null,
    kind: r.kind as DeviceKind,
    lastSeenMs: Number(r.last_seen_ms),
    platform: ((r.platform as string | null) ?? 'gatt') as DevicePlatform,
    capabilities: parseJson<Capability[]>(r.capabilities, []),
    manufacturer: (r.manufacturer as string | null) ?? null,
    model: (r.model as string | null) ?? null,
    firmware: (r.firmware as string | null) ?? null,
    autoConnect: Number(r.auto_connect ?? 0) === 1,
    lastSyncMs: r.last_sync_ms == null ? null : Number(r.last_sync_ms),
    settings: parseJson<DeviceSettings>(r.settings, {}),
  };
}

export const devicesRepo = {
  /** Creates the row or refreshes it; fields the caller does not know keep their stored value. */
  async upsert(d: DeviceUpsert): Promise<void> {
    await batch([
      ['INSERT OR IGNORE INTO devices (id, name, kind, last_seen_ms) VALUES (?, ?, ?, ?)', [d.id, d.name, d.kind, d.lastSeenMs]],
      [
        `UPDATE devices SET name = COALESCE(?, name), kind = ?, last_seen_ms = ?,
           platform = COALESCE(?, platform), capabilities = COALESCE(?, capabilities),
           manufacturer = COALESCE(?, manufacturer), model = COALESCE(?, model), firmware = COALESCE(?, firmware),
           auto_connect = COALESCE(?, auto_connect), settings = COALESCE(?, settings)
         WHERE id = ?`,
        [
          d.name,
          d.kind,
          d.lastSeenMs,
          d.platform ?? null,
          d.capabilities ? JSON.stringify(d.capabilities) : null,
          d.manufacturer ?? null,
          d.model ?? null,
          d.firmware ?? null,
          d.autoConnect == null ? null : d.autoConnect ? 1 : 0,
          d.settings ? JSON.stringify(d.settings) : null,
          d.id,
        ],
      ],
    ]);
  },

  async get(id: string): Promise<SavedDevice | null> {
    const rows = await query('SELECT * FROM devices WHERE id = ?', [id]);
    return rows.length ? fromRow(rows[0]) : null;
  },

  async list(): Promise<SavedDevice[]> {
    return (await query('SELECT * FROM devices ORDER BY last_seen_ms DESC')).map(fromRow);
  },

  async setAutoConnect(id: string, on: boolean): Promise<void> {
    await run('UPDATE devices SET auto_connect = ? WHERE id = ?', [on ? 1 : 0, id]);
  },

  async markSynced(id: string, atMs: number): Promise<void> {
    await run('UPDATE devices SET last_sync_ms = ? WHERE id = ?', [atMs, id]);
  },

  async setSettings(id: string, settings: DeviceSettings): Promise<void> {
    await run('UPDATE devices SET settings = ? WHERE id = ?', [JSON.stringify(settings), id]);
  },

  async remove(id: string): Promise<void> {
    await run('DELETE FROM devices WHERE id = ?', [id]);
  },
};
