import { ExportFile } from '../bridge/exportFile';
import { bodyRepo } from '../db/repositories/bodyRepo';
import { devicesRepo } from '../db/repositories/devicesRepo';
import { samplesRepo } from '../db/repositories/samplesRepo';
import { sleepRepo } from '../db/repositories/sleepRepo';
import { workoutsRepo } from '../db/repositories/workoutsRepo';
import { requestExportPermission } from '../permissions';

function csvEscape(v: unknown): string {
  if (v == null) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function assertCanWrite(): Promise<void> {
  if (!(await requestExportPermission())) throw new Error('Storage permission is needed to save to Downloads.');
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map(c => csvEscape(r[c])).join(','));
  return lines.join('\n');
}

export async function collectAll() {
  const [samples, workouts, sleep, sleepStages, body, devices] = await Promise.all([
    samplesRepo.all(),
    workoutsRepo.all(),
    sleepRepo.all(),
    sleepRepo.allStages(),
    bodyRepo.all(),
    devicesRepo.list(),
  ]);
  return { exportedAt: new Date().toISOString(), app: 'PrivateFit', samples, workouts, sleep, sleepStages, body, devices };
}

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

/** Writes one JSON bundle to Downloads. Returns the saved path/URI. */
export async function exportJson(): Promise<string> {
  await assertCanWrite();
  const data = await collectAll();
  return ExportFile.saveToDownloads(`privatefit-${stamp()}.json`, 'application/json', JSON.stringify(data, null, 2));
}

/** Writes one CSV per table to Downloads. Returns the saved paths. */
export async function exportCsv(): Promise<string[]> {
  await assertCanWrite();
  const data = await collectAll();
  const s = stamp();
  const out: string[] = [];
  const tables: Array<[string, Record<string, unknown>[]]> = [
    ['samples', data.samples as unknown as Record<string, unknown>[]],
    ['workouts', data.workouts as unknown as Record<string, unknown>[]],
    ['sleep', data.sleep as unknown as Record<string, unknown>[]],
    ['sleep-stages', data.sleepStages as unknown as Record<string, unknown>[]],
    ['body', data.body as unknown as Record<string, unknown>[]],
    ['devices', data.devices as unknown as Record<string, unknown>[]],
  ];
  for (const [name, rows] of tables) {
    if (!rows.length) continue;
    out.push(await ExportFile.saveToDownloads(`privatefit-${name}-${s}.csv`, 'text/csv', toCsv(rows)));
  }
  return out;
}
