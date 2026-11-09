import { bodyRepo } from '../../db/repositories/bodyRepo';
import { samplesRepo } from '../../db/repositories/samplesRepo';
import { sleepRepo } from '../../db/repositories/sleepRepo';
import { workoutsRepo } from '../../db/repositories/workoutsRepo';
import { dayKey } from '../../domain/time';
import type { Sample } from '../../domain/types';
import { useAppStore } from '../../store/useAppStore';
import type { DeviceRecord } from './types';

/**
 * Stores what a driver synced. Every write is keyed by (source, external id), so the same span
 * synced again changes nothing. Returns how many records were handled.
 */
export async function writeRecords(deviceId: string, deviceName: string | null, records: readonly DeviceRecord[]): Promise<number> {
  const sourceId = `ble:${deviceId}`;
  const samples: Sample[] = [];
  let n = 0;
  for (const r of records) {
    switch (r.kind) {
      case 'sample':
        samples.push({
          metric: r.metric,
          value: r.value,
          unit: r.unit,
          startMs: r.atMs,
          endMs: r.atMs,
          day: dayKey(r.atMs),
          sourceId,
          externalId: r.externalId,
          device: deviceName,
        });
        break;
      case 'daily_total':
        await samplesRepo.upsertTotal({
          metric: r.metric,
          value: r.value,
          unit: r.unit,
          startMs: r.firstMs,
          endMs: r.atMs,
          day: r.day,
          sourceId,
          externalId: `day:${r.day}`,
          device: deviceName,
        });
        break;
      case 'sleep':
        await sleepRepo.upsertExternal(
          { startMs: r.startMs, endMs: r.endMs, day: dayKey(r.endMs), sourceId, externalId: r.externalId, device: deviceName },
          r.stages,
        );
        break;
      case 'workout': {
        await workoutsRepo.upsertExternal({
          type: r.type,
          title: null,
          startMs: r.startMs,
          endMs: r.endMs,
          day: dayKey(r.startMs),
          durationS: r.durationS,
          distanceM: r.distanceM ?? null,
          kcal: r.kcal ?? null,
          avgHr: r.avgHr ?? null,
          maxHr: r.maxHr ?? null,
          effort: null,
          notes: null,
          sourceId,
          externalId: r.externalId,
          device: deviceName,
        });
        r.hr.forEach((p, i) =>
          samples.push({
            metric: 'heart_rate',
            value: p.bpm,
            unit: 'bpm',
            startMs: p.atMs,
            endMs: p.atMs,
            day: dayKey(p.atMs),
            sourceId,
            externalId: `wk:${r.externalId}:${i}`,
            device: deviceName,
          }),
        );
        break;
      }
      case 'body':
        await bodyRepo.upsertExternal({
          kind: r.bodyKind,
          value: r.value,
          unit: r.unit,
          atMs: r.atMs,
          day: dayKey(r.atMs),
          sourceId,
          externalId: r.externalId,
        });
        break;
    }
    n++;
  }
  if (samples.length) await samplesRepo.insertMany(samples);
  return n;
}

let bumpTimer: ReturnType<typeof setTimeout> | null = null;

/** One screen refresh for a burst of writes: three devices logging every few seconds would otherwise reload every loader each time. */
export function scheduleBump(delayMs = 500): void {
  if (bumpTimer) return;
  bumpTimer = setTimeout(() => {
    bumpTimer = null;
    useAppStore.getState().bump();
  }, delayMs);
}
