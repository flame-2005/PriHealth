/* eslint-disable no-bitwise */
import { wipeAll } from '../src/db';
import { devicesRepo } from '../src/db/repositories/devicesRepo';
import { samplesRepo } from '../src/db/repositories/samplesRepo';
import { bytesToHex, hexToBytes } from '../src/domain/bytes';
import { dayKey, parseDay } from '../src/domain/time';
import { readDeviceInfo } from '../src/integrations/devices/link';
import { detect } from '../src/integrations/devices/registry';
import { connectDevice, disconnectAll, driverSessions, setLinkFactory, syncNow } from '../src/integrations/devices/session';
import { FakeLink, type FakeScriptStep } from '../src/integrations/devices/testing/fakeLink';
import {
  bcd,
  checksum,
  CMD,
  decodeBattery,
  decodeHrSettings,
  decodeRealTime,
  encodeHrLogRequest,
  encodeHrSettingsWrite,
  encodeRealTime,
  encodeSetTime,
  encodeStepsRequest,
  fromBcd,
  HrLogCollector,
  hrLogRecords,
  isValidPacket,
  packet,
  ringDaySeconds,
  StepsCollector,
  stepsDailyTotals,
} from '../src/integrations/devices/drivers/colmi/protocol';
import { useAppStore } from '../src/store/useAppStore';

jest.mock('react-native-ble-plx', () => ({
  ScanMode: { LowPower: 0, Balanced: 1, LowLatency: 2 },
  BleManager: class {
    state = async () => 'PoweredOn';
    cancelDeviceConnection = async () => {};
    onDeviceDisconnected = () => ({ remove() {} });
  },
}));

const hex = (p: Uint8Array) => bytesToHex(p);
const settle = () => new Promise<void>(r => setTimeout(r, 20));

describe('Colmi protocol', () => {
  it('builds 16-byte packets with a byte-masked sum as checksum', () => {
    const p = packet(CMD.BATTERY);
    expect(p).toHaveLength(16);
    expect(hex(p)).toBe('03000000000000000000000000000003');
    expect(isValidPacket(p)).toBe(true);
    expect(isValidPacket(hexToBytes('03000000000000000000000000000004'))).toBe(false);
    expect(checksum(packet(0xff, [0xff, 0xff]))).toBe((0xff * 3) & 0xff);
    expect(() => packet(1, new Array(15).fill(0))).toThrow(/14 bytes/);
    expect(bcd(26)).toBe(0x26);
    expect(fromBcd(0x59)).toBe(59);
  });

  it('sets the clock in BCD local time with the language flag', () => {
    const p = encodeSetTime(new Date(2026, 9, 12, 21, 7, 9).getTime());
    expect(hex(p.subarray(0, 8))).toBe('0126101221070901');
    expect(isValidPacket(p)).toBe(true);
  });

  it('asks for a day of steps and totals the 15-minute slots', () => {
    expect(hex(encodeStepsRequest(1).subarray(0, 6))).toBe('43010f005f01');
    const c = new StepsCollector();
    const header = packet(CMD.STEPS, [240, 0, 1]);
    // 2026-10-11, slot 32 (08:00) and slot 33, two of two packets; steps and distance little-endian.
    const slot = (idx: number, n: number, total: number, steps: number, distance: number) =>
      packet(CMD.STEPS, [bcd(26), bcd(10), bcd(11), idx, n, total, 0, 0, steps & 0xff, steps >> 8, distance & 0xff, distance >> 8]);
    expect(c.push(header)).toBe('more');
    expect(c.push(slot(32, 0, 2, 420, 300))).toBe('more');
    expect(c.push(slot(33, 1, 2, 1000, 700))).toBe('done');
    const totals = stepsDailyTotals(c.slots);
    const start = parseDay('2026-10-11');
    expect(totals).toEqual([
      { kind: 'daily_total', metric: 'steps', day: '2026-10-11', value: 1420, unit: 'count', firstMs: start + 8 * 3600_000, atMs: start + 8.5 * 3600_000 },
      { kind: 'daily_total', metric: 'distance', day: '2026-10-11', value: 1000, unit: 'm', firstMs: start + 8 * 3600_000, atMs: start + 8.5 * 3600_000 },
    ]);
    expect(new StepsCollector().push(packet(CMD.STEPS, [255]))).toBe('none');
  });

  it('asks for a heart-rate log by the ring-clock day and places readings five minutes apart', () => {
    expect(ringDaySeconds('2026-10-12')).toBe(Date.UTC(2026, 9, 12) / 1000);
    const req = encodeHrLogRequest('2026-10-12');
    const t = ringDaySeconds('2026-10-12');
    expect(hex(req.subarray(1, 5))).toBe(hex(Uint8Array.from([t & 0xff, (t >>> 8) & 0xff, (t >>> 16) & 0xff, (t >>> 24) & 0xff])));
    const c = new HrLogCollector();
    expect(c.push(packet(CMD.HR_LOG, [0, 3, 1]))).toBe('more');
    expect(c.push(packet(CMD.HR_LOG, [1, 0, 0, 0, 0, 60, 0, 62, 63, 0, 0, 0, 0, 0]))).toBe('more');
    expect(c.push(packet(CMD.HR_LOG, [2, 64, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('done');
    expect(c.readings).toHaveLength(9 + 13);
    const recs = hrLogRecords(c.readings, '2026-10-12');
    const start = parseDay('2026-10-12');
    expect(recs.map(r => (r.kind === 'sample' ? [r.value, (r.atMs - start) / 60_000] : null))).toEqual([
      [60, 0],
      [62, 10],
      [63, 15],
      [64, 45],
    ]);
    expect(new HrLogCollector().push(packet(CMD.HR_LOG, [255]))).toBe('none');
  });

  it('reads and writes the log interval and decodes real-time readings', () => {
    expect(decodeHrSettings(hexToBytes('1601013c00000000000000000000000054'))).toEqual({ enabled: true, intervalMin: 60 });
    expect(hex(encodeHrSettingsWrite(true, 5).subarray(0, 4))).toBe('16020105');
    expect(hex(encodeHrSettingsWrite(false, 5).subarray(0, 4))).toBe('16020205');
    expect(hex(encodeRealTime(1, 1).subarray(0, 3))).toBe('690101');
    expect(decodeRealTime(packet(CMD.START_REAL_TIME, [3, 0, 97]))).toEqual({ type: 3, error: 0, value: 97 });
    expect(decodeBattery(packet(CMD.BATTERY, [64, 0]))).toEqual({ percent: 64, charging: false });
  });
});

const suite = (globalThis as any).process.getBuiltinModule?.('node:sqlite') ? describe : describe.skip;

suite('Colmi driver on a fake ring', () => {
  const links = new Map<string, FakeLink>();
  const today = dayKey(Date.now());
  const yesterday = dayKey(Date.now() - 86_400_000);
  const [ty, tm, td] = today.split('-').map(Number);

  const ring = (extra: FakeScriptStep[] = [], withHistory = true): FakeLink => {
    const slot = (idx: number, n: number, total: number, steps: number) =>
      hex(packet(CMD.STEPS, [bcd(ty - 2000), bcd(tm), bcd(td), idx, n, total, 0, 0, steps & 0xff, steps >> 8, 0, 0]));
    const history: FakeScriptStep[] = [
      { tx: hex(encodeStepsRequest(0)), rx: [hex(packet(CMD.STEPS, [240, 0, 1])), slot(40, 0, 2, 500), slot(41, 1, 2, 250)] },
      { tx: hex(encodeStepsRequest(1)), rx: [hex(packet(CMD.STEPS, [255]))] },
      { tx: hex(encodeHrLogRequest(yesterday)), rx: [hex(packet(CMD.HR_LOG, [255]))] },
      { tx: hex(encodeHrLogRequest(today)), rx: [hex(packet(CMD.HR_LOG, [0, 2, 1])), hex(packet(CMD.HR_LOG, [1, 0, 0, 0, 0, 58, 0, 0, 0, 0, 0, 0, 0, 0]))] },
    ];
    const link = new FakeLink({
      id: 'R0:02',
      services: { '6e40fff0-b5a3-f393-e0a9-e50e24dcca9e': ['6e400002-b5a3-f393-e0a9-e50e24dcca9e', '6e400003-b5a3-f393-e0a9-e50e24dcca9e'], '180a': ['2a26'] },
      reads: { '180a/2a26': '5231' },
      notify: '6e40fff0-b5a3-f393-e0a9-e50e24dcca9e/6e400003-b5a3-f393-e0a9-e50e24dcca9e',
      script: [{ tx: hex(packet(CMD.BATTERY)), rx: [hex(packet(CMD.BATTERY, [64, 0]))] }, ...(withHistory ? history : []), ...extra],
    });
    links.set(link.id, link);
    return link;
  };

  beforeAll(() => {
    setLinkFactory(async id => {
      const link = links.get(id);
      if (!link) throw new Error('out of range');
      return { link, info: await readDeviceInfo(link) };
    });
  });
  afterAll(async () => {
    // Leaves no session timers behind: an in-band run would otherwise never exit.
    await disconnectAll();
    setLinkFactory(null);
  });
  beforeEach(async () => {
    await disconnectAll();
    links.clear();
    useAppStore.setState({ liveHr: null, liveSteps: null, connected: {}, liveByDevice: {} });
    await wipeAll();
  });

  it('is a ring by its service, reads battery and clock on connect, and syncs steps and the heart-rate log', async () => {
    const link = ring();
    const det = detect({ id: 'R0:02', name: 'R02_1A2B', services: link.services as string[], manufacturer: null, model: null, firmware: null })!;
    expect(det).toMatchObject({ form: 'ring', platform: 'colmi' });
    expect(det.capabilities).toEqual(['battery', 'set_time', 'hr_interval', 'history_steps', 'history_hr']);

    await connectDevice('R0:02', 'R02_1A2B');
    for (let i = 0; i < 100 && useAppStore.getState().connected['R0:02']?.syncing !== false; i++) await settle();
    expect(useAppStore.getState().connected['R0:02']).toMatchObject({ kind: 'ring', platform: 'colmi', battery: 64 });
    expect(await devicesRepo.get('R0:02')).toMatchObject({ kind: 'ring', firmware: 'R1' });
    // Clock frame: command 1 with today's BCD date; writes go without response.
    const clock = link.writes.find(w => w.hex.startsWith('01'));
    expect(clock?.hex.slice(2, 8)).toBe(hex(Uint8Array.from([bcd(ty - 2000), bcd(tm), bcd(td)])));

    const steps = await samplesRepo.totalsBySourceByDay('steps', today, today);
    expect(steps).toEqual([{ day: today, sourceId: 'ble:R0:02', value: 750, firstMs: parseDay(today) + 10 * 3600_000, lastMs: parseDay(today) + 10.5 * 3600_000 }]);
    const hr = await samplesRepo.range('heart_rate', parseDay(today), parseDay(today) + 86_400_000);
    expect(hr.map(s => s.value)).toEqual([58]);
    expect(hr[0]).toMatchObject({ sourceId: 'ble:R0:02', externalId: `hr:${Math.floor(parseDay(today) / 60_000)}` });
  });

  it('applies a heart-rate log interval, picks up switches flipped later, and gives up on a silent ring', async () => {
    const link = ring([{ tx: hex(encodeHrSettingsWrite(true, 10)), rx: [hex(packet(CMD.HR_LOG_SETTINGS, [2, 1, 10]))] }], false);
    await devicesRepo.upsert({ id: 'R0:02', name: 'R02', kind: 'ring', lastSeenMs: 1, settings: { commands: { sync_steps: false, sync_hr: false } } });
    await connectDevice('R0:02', 'R02');
    for (let i = 0; i < 100 && useAppStore.getState().connected['R0:02']?.syncing !== false; i++) await settle();
    // Both history switches were off: no steps or heart-rate query went out.
    expect(link.writes.some(w => w.hex.startsWith('43') || w.hex.startsWith('15'))).toBe(false);

    const session = driverSessions('R0:02').find(s => s.setHrInterval)!;
    await session.setHrInterval!(10);
    expect(link.writes.some(w => w.hex.startsWith('1602010a'))).toBe(true);
    // A disabled log keeps a sane interval byte rather than zero.
    await session.setHrInterval!(0);
    expect(link.writes.some(w => w.hex.startsWith('1602023c'))).toBe(true);

    // Turning the steps switch on applies from the next sync; with no reply scripted, it times out instead of hanging.
    await devicesRepo.setSettings('R0:02', { commands: { sync_steps: true, sync_hr: false } });
    await expect(syncNow('R0:02')).rejects.toThrow(/did not answer/);
    expect(link.writes.some(w => w.hex.startsWith('43'))).toBe(true);
    expect(useAppStore.getState().connected['R0:02'].syncing).toBe(false);
  }, 20_000);
});
