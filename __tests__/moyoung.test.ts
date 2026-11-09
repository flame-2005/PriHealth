import { bytesToHex, hexToBytes } from '../src/domain/bytes';
import { parseDay } from '../src/domain/time';
import { readDeviceInfo } from '../src/integrations/devices/link';
import { detect } from '../src/integrations/devices/registry';
import { connectDevice, disconnectAll, driverSessions, setLinkFactory, syncNow } from '../src/integrations/devices/session';
import { FakeLink, type FakeLinkSpec } from '../src/integrations/devices/testing/fakeLink';
import {
  CMD,
  decodeMeasurement,
  decodePastDay,
  decodePastHeartRate,
  decodePhoneOperation,
  decodeSleepEntries,
  decodeSyncTime,
  encodeHrInterval,
  encodeMessage,
  encodeSyncTime,
  encodeUserInfo,
  frame,
  frameLength,
  fromWatchTime,
  sleepRecord,
  toWatchTime,
  Unframer,
} from '../src/integrations/devices/drivers/moyoung/protocol';
import { sleepRepo } from '../src/db/repositories/sleepRepo';
import { devicesRepo } from '../src/db/repositories/devicesRepo';
import { wipeAll } from '../src/db';
import { useAppStore } from '../src/store/useAppStore';
import timeFixture from './fixtures/moyoung/time.json';
import connectFixture from './fixtures/moyoung/icon-plus-connect.json';

jest.mock('react-native-ble-plx', () => ({
  ScanMode: { LowPower: 0, Balanced: 1, LowLatency: 2 },
  BleManager: class {
    state = async () => 'PoweredOn';
    cancelDeviceConnection = async () => {};
    onDeviceDisconnected = () => ({ remove() {} });
  },
}));

const ascii = (s: string) => bytesToHex(Uint8Array.from([...s].map(c => c.charCodeAt(0))));
const settle = () => new Promise<void>(r => setTimeout(r, 20));

describe('MoYoung protocol', () => {
  it('frames commands in both size forms and reads the length back', () => {
    expect(bytesToHex(frame(49, hexToBytes('68a3100308'), 20))).toBe('feea100a3168a3100308');
    expect(bytesToHex(frame(49, hexToBytes('68a3100308'), 244))).toBe('feea200a3168a3100308');
    expect(bytesToHex(frame(0x21, undefined, 20))).toBe('feea100521');
    expect(frameLength(hexToBytes('feea100a31'))).toBe(10);
    expect(frameLength(hexToBytes('feea2105'))).toBe(261);
    expect(frameLength(hexToBytes('ffea100a'))).toBeNull();
    expect(frameLength(hexToBytes('feea'))).toBeNull();
  });

  it('reproduces the documented sync-time frame from its wall-clock time', () => {
    const fx = timeFixture.frames[0];
    const payload = hexToBytes(fx.hex).slice(5);
    // Whatever zone the capture was made in, encoding the decoded instant back gives the same bytes.
    const tz = 120;
    const ms = decodeSyncTime(payload, tz)!;
    expect(bytesToHex(encodeSyncTime(ms, tz, 244))).toBe(fx.hex);
    expect(fromWatchTime(toWatchTime(1_700_000_000_000, 330), 330)).toBe(1_700_000_000_000);
    // The watch reads the value as GMT+8, so a phone in IST (+5:30) sends its wall clock shifted by -2:30.
    expect(toWatchTime(1_700_000_000_000, 330)).toBe(1_700_000_000 + 330 * 60 - 8 * 3600);
  });

  it('matches the frames captured from the Noise Icon Plus', () => {
    const tx = (note: string) => hexToBytes(connectFixture.frames.find(f => f.note.startsWith(note))!.hex);
    // The clock frame the app sent at 16:23:01 UTC decodes back to that instant for a phone in IST.
    const payload = tx('command 49 sync time').slice(5);
    expect(new Date(decodeSyncTime(payload, 330)!).toISOString()).toBe('2026-10-13T16:23:01.000Z');
    expect(bytesToHex(encodeSyncTime(Date.UTC(2026, 9, 13, 16, 23, 1), 330, 20))).toBe(connectFixture.frames[3].hex);
    expect(connectFixture.frames[9].hex).toBe(bytesToHex(frame(CMD.FIND_MY_WATCH, undefined, 20)));
    // What the watch said on its own, framed the long way: measuring, then 74 bpm.
    const u = new Unframer();
    const frames = [...u.push(hexToBytes('feea20066dff')), ...u.push(hexToBytes('feea20066d4a'))];
    expect(frames.map(f => [f.cmd, bytesToHex(f.payload)])).toEqual([
      [109, 'ff'],
      [109, '4a'],
    ]);
    expect(decodeMeasurement(frames[0])).toBeNull();
    expect(decodeMeasurement(frames[1])).toBe(74);
    expect(decodeMeasurement({ cmd: 107, payload: Uint8Array.from([97]) })).toBe(97);
    expect(decodeMeasurement({ cmd: 49, payload: Uint8Array.from([97]) })).toBeNull();
  });

  it('reassembles frames split across notifications, with noise between them', () => {
    const u = new Unframer();
    const whole = hexToBytes('feea200a3168a3100308');
    expect(u.push(whole.slice(0, 3))).toEqual([]);
    expect(u.push(whole.slice(3, 7))).toEqual([]);
    const frames = u.push(hexToBytes(bytesToHex(whole.slice(7)) + '00' + 'feea100567'));
    expect(frames.map(f => [f.cmd, bytesToHex(f.payload)])).toEqual([
      [49, '68a3100308'],
      [103, ''],
    ]);
    // A length that cannot be a frame is skipped, and a dangling FE waits for its EA.
    expect(u.push(hexToBytes('feea1002fe'))).toEqual([]);
    expect(u.push(hexToBytes('ea100500'))).toEqual([{ cmd: 0, payload: new Uint8Array(0) }]);
  });

  it('encodes settings and notifications', () => {
    expect(bytesToHex(encodeHrInterval(10))).toBe('feea10061f02');
    expect(bytesToHex(encodeHrInterval(0))).toBe('feea10061f00');
    expect(() => encodeHrInterval(7)).toThrow(/interval/);
    expect(bytesToHex(encodeUserInfo({ heightCm: 175, weightKg: 70.4, age: 30, male: true }))).toBe('feea100912af461e00');
    const msg = encodeMessage(8, 'Mum', 'Dinner at 8');
    expect(msg[4]).toBe(CMD.SEND_MESSAGE);
    expect(msg[5]).toBe(8);
    expect(bytesToHex(msg.slice(6))).toBe(ascii('Mum') + 'e28280' + ascii('Dinner at 8'));
    // Long text is cut on a character boundary, never inside a multi-byte sequence.
    const long = encodeMessage(11, 'x', 'é'.repeat(300), 244, 21);
    expect(long.length - 6).toBe(20);
  });

  it('turns sleep entries into a night that ends on the wake-up day', () => {
    // light 23:30, deep 23:45, REM 00:10, light 05:00, awake 06:30, then a junk entry that is skipped.
    const entries = decodeSleepEntries(hexToBytes('01 17 1e 02 17 2d 03 00 0a 01 05 00 00 06 1e ff 99 99'));
    expect(entries).toEqual([
      { stage: 'light', hour: 23, minute: 30 },
      { stage: 'deep', hour: 23, minute: 45 },
      { stage: 'rem', hour: 0, minute: 10 },
      { stage: 'light', hour: 5, minute: 0 },
      { stage: 'awake', hour: 6, minute: 30 },
    ]);
    const night = sleepRecord(entries, '2026-09-27')!;
    const d26 = parseDay('2026-09-26');
    const d27 = parseDay('2026-09-27');
    expect(night).toMatchObject({ kind: 'sleep', startMs: d26 + 23.5 * 3600_000, endMs: d27 + 6.5 * 3600_000, externalId: `sleep:${d26 + 23.5 * 3600_000}` });
    expect(night.kind === 'sleep' && night.stages.map(s => s.stage)).toEqual(['light', 'deep', 'rem', 'light']);
    expect(sleepRecord(entries.slice(0, 1), '2026-09-27')).toBeNull();
    expect(decodePhoneOperation(Uint8Array.from([2]))).toBe('next');
    expect(decodePhoneOperation(Uint8Array.from([9]))).toBeNull();
  });

  it('decodes the unconfirmed history layouts defensively', () => {
    // Day index 1, distance 4200 m, 6100 steps, 230 kcal, then a two-entry night.
    const past = decodePastDay(hexToBytes('01 68 10 00 d4 17 00 e6 00 00 01 17 00 00 06 00'), '2026-09-27');
    expect(past.map(r => r.kind)).toEqual(['daily_total', 'daily_total', 'daily_total', 'sleep']);
    expect(past[0]).toMatchObject({ metric: 'steps', day: '2026-09-26', value: 6100 });
    expect(decodePastDay(hexToBytes('01 00'), '2026-09-27')).toEqual([]);
    const hr = decodePastHeartRate(Uint8Array.from([5, 0, 62, 250, 70]), '2026-09-27');
    expect(hr).toHaveLength(2);
    expect(hr[0]).toMatchObject({ metric: 'heart_rate', value: 62, atMs: parseDay('2026-09-26') + (72 + 1) * 5 * 60_000 });
  });
});

const suite = (globalThis as any).process.getBuiltinModule?.('node:sqlite') ? describe : describe.skip;

const WATCH: FakeLinkSpec = {
  id: 'FC:75',
  mtu: 23,
  services: { '180d': ['2a37'], '180f': ['2a19'], '180a': ['2a29', '2a26'], fee7: ['fea1'], feea: ['fee1', 'fee2', 'fee3'] },
  reads: { '180f/2a19': '51', '180a/2a29': ascii('MOYOUNG-V2'), '180a/2a26': ascii('MOY-BEU3-2.3.5'), 'fee7/fea1': '012b0400' },
  notify: 'feea/fee3',
};

suite('MoYoung driver on a fake watch', () => {
  const links = new Map<string, FakeLink>();
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

  it('is picked by the vendor service or manufacturer string and keeps the standard handlers', () => {
    const base = { id: 'X', name: null, manufacturer: null, model: null, firmware: null };
    const byService = detect({ ...base, services: new FakeLink(WATCH).services as string[] })!;
    expect(byService.platform).toBe('moyoung');
    expect(byService.handlers.map(h => h.driver.id).sort()).toEqual(['gatt-battery', 'gatt-hr', 'gatt-pedometer', 'moyoung']);
    expect(byService.capabilities).toEqual(expect.arrayContaining(['live_hr', 'live_steps', 'battery', 'set_time', 'history_sleep', 'notifications']));
    const byName = detect({ ...base, manufacturer: 'MOYOUNG', services: ['0000180d-0000-1000-8000-00805f9b34fb'] })!;
    expect(byName.platform).toBe('moyoung');
    expect(byName.form).toBe('watch');
  });

  it('sets the clock and profile on connect, and only the switched-on commands', async () => {
    const link = new FakeLink(WATCH);
    links.set(link.id, link);
    useAppStore.setState({ profile: { heightCm: 175, maxHr: null } });
    await connectDevice('FC:75', 'Icon Plus');
    await settle();
    const out = link.writes.filter(w => w.char.startsWith('0000fee2'));
    // The clock goes first, in the long frame form this V2 watch uses; no weight is known, so no profile frame.
    expect(out).toHaveLength(1);
    expect(out[0].hex.slice(0, 10)).toBe('feea200a31');
    expect(out[0].hex.slice(-2)).toBe('08');
    expect(useAppStore.getState().connected['FC:75']).toMatchObject({ platform: 'moyoung', kind: 'watch', battery: 81 });
    // Sync ran on connect with every history switch off: no queries went out.
    expect(link.writes.filter(w => w.char.startsWith('0000fee2'))).toHaveLength(1);
    expect(useAppStore.getState().connected['FC:75'].lastSyncMs).toBeGreaterThan(0);

    const session = driverSessions('FC:75').find(s => s.findDevice)!;
    await session.findDevice!();
    await session.setHrInterval!(10);
    await session.sendNotification!({ app: 'com.whatsapp', title: 'Mum', text: 'Dinner at 8', category: 'whatsapp' });
    const after = link.writes.filter(w => w.char.startsWith('0000fee2')).map(w => w.hex);
    expect(after[1]).toBe('feea200561');
    expect(after[2]).toBe('feea20061f02');
    // 23-byte message frame, chunked to the 20-byte data MTU: WhatsApp type 8 after the header.
    expect(after[3].slice(0, 12)).toBe('feea20174108');
    expect(after[3].length / 2).toBe(20);
    expect(after[4].length / 2).toBe(3);
  });

  it('syncs last night when that switch is on, reassembling the reply and storing it once', async () => {
    const link = new FakeLink({
      ...WATCH,
      // One 20-byte reply split over two notifications: light 23:00, deep 01:00, REM 03:00, light 05:00, awake 06:00.
      script: [1, 2].map(() => ({ tx: 'feea200532', rx: ['feea101432011700020100', '030300010500000600'] })),
    });
    links.set(link.id, link);
    await devicesRepo.upsert({ id: 'FC:75', name: 'Icon Plus', kind: 'watch', lastSeenMs: 1, settings: { commands: { set_time: false, user_profile: false, sync_sleep: true } } });
    await connectDevice('FC:75', 'Icon Plus');
    await settle();
    for (let i = 0; i < 100 && useAppStore.getState().connected['FC:75']?.syncing !== false; i++) await settle();
    const nights = await sleepRepo.list();
    expect(nights).toHaveLength(1);
    expect(nights[0]).toMatchObject({ sourceId: 'ble:FC:75', device: 'Icon Plus' });
    const stages = await sleepRepo.stagesFor([nights[0].id!]);
    expect(stages.get(nights[0].id!)?.map(s => s.stage)).toEqual(['light', 'deep', 'rem', 'light']);
    // No clock frame went out: the switch was off.
    expect(link.writes.filter(w => w.hex.startsWith('feea200a31'))).toHaveLength(0);
    await syncNow('FC:75');
    expect(await sleepRepo.list()).toHaveLength(1);
  });

  it('reports a watch that does not answer a query instead of hanging', async () => {
    const link = new FakeLink(WATCH);
    links.set(link.id, link);
    await devicesRepo.upsert({ id: 'FC:75', name: 'Icon Plus', kind: 'watch', lastSeenMs: 1, settings: { commands: { sync_hr: true } } });
    await connectDevice('FC:75', 'Icon Plus');
    const session = driverSessions('FC:75').find(s => s.sync)!;
    await expect(session.sync!(null)).rejects.toThrow(/did not answer/);
  }, 15_000);
});
