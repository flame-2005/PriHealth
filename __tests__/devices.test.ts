import { wipeAll } from '../src/db';
import { devicesRepo } from '../src/db/repositories/devicesRepo';
import { samplesRepo } from '../src/db/repositories/samplesRepo';
import { sleepRepo } from '../src/db/repositories/sleepRepo';
import { bytesToHex, hexToBytes } from '../src/domain/bytes';
import { dayKey } from '../src/domain/time';
import { readDeviceInfo } from '../src/integrations/devices/link';
import { detect, registerDriver } from '../src/integrations/devices/registry';
import {
  connectDevice,
  connectedIds,
  disconnectAll,
  disconnectDevice,
  isConnected,
  onEvent,
  setLinkFactory,
  syncNow,
} from '../src/integrations/devices/session';
import { FakeLink, type FakeLinkSpec } from '../src/integrations/devices/testing/fakeLink';
import type { DeviceDriver, DeviceEvent } from '../src/integrations/devices/types';
import { useAppStore } from '../src/store/useAppStore';

/**
 * The device layer against fake links: what a connect learns, where live values go, how several
 * devices share the headline numbers, and how a link that drops is cleaned up. No radio: the
 * ble-plx mock below is never asked to connect because the link factory is swapped for FakeLink.
 */
jest.mock('react-native-ble-plx', () => ({
  ScanMode: { LowPower: 0, Balanced: 1, LowLatency: 2 },
  BleManager: class {
    state = async () => 'PoweredOn';
    cancelDeviceConnection = async () => {};
    onDeviceDisconnected = () => ({ remove() {} });
  },
}));

const suite = (globalThis as any).process.getBuiltinModule?.('node:sqlite') ? describe : describe.skip;

const ascii = (s: string) => bytesToHex(Uint8Array.from([...s].map(c => c.charCodeAt(0))));
const settle = () => new Promise<void>(r => setTimeout(r, 20));

const WATCH: FakeLinkSpec = {
  id: 'FC:75',
  services: { '180d': ['2a37'], '180f': ['2a19'], '180a': ['2a29', '2a24', '2a26'], fee7: ['fea1'], feea: ['fee1', 'fee2', 'fee3'] },
  reads: { '180f/2a19': '51', '180a/2a29': ascii('MOYOUNG-V2'), '180a/2a26': ascii('MOY-BEU3-2.3.5'), 'fee7/fea1': '012b0400' },
};
const STRAP: FakeLinkSpec = { id: 'AA:BB', services: { '180d': ['2a37'], '180f': ['2a19'] }, reads: { '180f/2a19': '64' } };

const links = new Map<string, FakeLink>();
const add = (spec: FakeLinkSpec) => {
  const link = new FakeLink(spec);
  links.set(link.id, link);
  return link;
};

suite('device sessions', () => {
  beforeAll(() => {
    setLinkFactory(async id => {
      const link = links.get(id);
      if (!link) throw new Error(`No device ${id} in range.`);
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

  it('connects a watch, learns what it is, and feeds live values into the store and the database', async () => {
    const link = add(WATCH);
    await connectDevice('FC:75', 'Icon Plus');
    await settle();

    expect(isConnected('FC:75')).toBe(true);
    const st = useAppStore.getState();
    // The manufacturer string and vendor service pick the Da Fit driver next to the standard handlers.
    expect(st.connected['FC:75']).toMatchObject({ kind: 'watch', platform: 'moyoung', battery: 81 });
    expect(st.connected['FC:75'].capabilities).toEqual(expect.arrayContaining(['live_hr', 'live_steps', 'battery']));
    expect(await devicesRepo.get('FC:75')).toMatchObject({
      name: 'Icon Plus',
      kind: 'watch',
      manufacturer: 'MOYOUNG-V2',
      firmware: 'MOY-BEU3-2.3.5',
      capabilities: expect.arrayContaining(['live_hr', 'live_steps']),
    });
    // The first step total was read on connect and saved as today's running total.
    expect(st.liveSteps).toMatchObject({ steps: 1067, deviceId: 'FC:75' });
    const today = dayKey(Date.now());
    expect((await samplesRepo.all()).find(s => s.metric === 'steps')).toMatchObject({ value: 1067, sourceId: 'ble:FC:75', externalId: `day:${today}` });

    link.emit('180d', '2a37', '0048');
    link.emit('180d', '2a37', '0000');
    await settle();
    expect(useAppStore.getState().liveHr).toMatchObject({ bpm: 72, deviceId: 'FC:75' });
    expect(useAppStore.getState().liveByDevice['FC:75'].hr?.bpm).toBe(72);
    expect((await samplesRepo.latest('heart_rate'))?.value).toBe(72);
    // Transcript keeps what went over the air, for fixtures.
    expect(link.transcript().map(t => t.dir)).toEqual(expect.arrayContaining(['rd', 'rx']));
  });

  it('two devices at once: the strap leads heart rate, and the watch takes over when the strap drops', async () => {
    const watch = add(WATCH);
    const strap = add(STRAP);
    await connectDevice('FC:75', 'Icon Plus');
    await connectDevice('AA:BB', 'Polar H10');
    await settle();
    expect(connectedIds().sort()).toEqual(['AA:BB', 'FC:75']);
    expect(useAppStore.getState().connected['AA:BB']).toMatchObject({ kind: 'strap', battery: 100 });

    watch.emit('180d', '2a37', '0046');
    expect(useAppStore.getState().liveHr).toMatchObject({ bpm: 70, deviceId: 'FC:75' });
    strap.emit('180d', '2a37', '0096');
    expect(useAppStore.getState().liveHr).toMatchObject({ bpm: 150, deviceId: 'AA:BB' });
    // While the strap streams, the watch's reading stays its own, not the headline.
    watch.emit('180d', '2a37', '0047');
    expect(useAppStore.getState().liveHr).toMatchObject({ bpm: 150, deviceId: 'AA:BB' });
    expect(useAppStore.getState().liveByDevice['FC:75'].hr?.bpm).toBe(71);

    strap.disconnect();
    await settle();
    expect(connectedIds()).toEqual(['FC:75']);
    expect(useAppStore.getState().connected['AA:BB']).toBeUndefined();
    expect(useAppStore.getState().liveHr).toMatchObject({ bpm: 71, deviceId: 'FC:75' });
    expect(strap.listenerCount()).toBe(0);
  });

  it('releases a device nothing here can read, with an explanation', async () => {
    const link = add({ id: 'BE:EF', services: { '180f': ['2a19'] }, reads: { '180f/2a19': '10' } });
    await expect(connectDevice('BE:EF', 'Mystery')).rejects.toThrow(/Mystery does not share heart rate, steps, sleep or weight/);
    expect(connectedIds()).toEqual([]);
    expect(link.closed).toBe(true);
    expect(await devicesRepo.get('BE:EF')).toBeNull();
  });

  it('disconnecting removes every monitor and clears the device from the store', async () => {
    const link = add(WATCH);
    await connectDevice('FC:75', 'Icon Plus');
    link.emit('180d', '2a37', '0048');
    expect(link.listenerCount()).toBeGreaterThan(0);
    await disconnectDevice('FC:75');
    expect(link.listenerCount()).toBe(0);
    expect(link.closed).toBe(true);
    const st = useAppStore.getState();
    expect(st.connected).toEqual({});
    expect(st.liveHr).toBeNull();
    expect(st.liveSteps).toBeNull();
    expect(st.liveByDevice).toEqual({});
  });

  it('forwards scale readings to listeners with the device they came from', async () => {
    const link = add({ id: 'SC:01', services: { '181d': ['2a9d'], '181b': ['2a9c'] } });
    const seen: Array<[string, DeviceEvent]> = [];
    const off = onEvent((id, e) => seen.push([id, e]));
    await connectDevice('SC:01', 'Scale');
    expect(useAppStore.getState().connected['SC:01']).toMatchObject({ kind: 'scale', capabilities: ['weight', 'body_composition'] });
    // Weight Scale Measurement: flags 0 (SI, no extras), 72.40 kg in units of 0.005 kg = 14480 = 0x3890.
    link.emit('181d', '2a9d', '009038');
    off();
    expect(seen.find(([, e]) => e.type === 'scale')).toEqual(['SC:01', { type: 'scale', weight: expect.objectContaining({ kg: 72.4 }) }]);
  });

  it('a link answers requests that arrive before the write resolves, chunks to the MTU, and gives up on silence', async () => {
    const link = new FakeLink({
      services: { feea: ['fee2', 'fee3'] },
      notify: 'feea/fee3',
      script: [{ tx: 'feea200531', rx: ['feea2007310102', 'feea2006319a'] }],
    });
    const frames = await link.request({
      service: 'feea',
      write: 'fee2',
      notify: 'fee3',
      bytes: hexToBytes('feea200531'),
      match: f => f[4] === 0x31,
      until: f => f.length === 6,
    });
    expect(frames.map(bytesToHex)).toEqual(['feea2007310102', 'feea2006319a']);
    expect(link.listenerCount()).toBe(0);

    await expect(
      link.request({ service: 'feea', write: 'fee2', notify: 'fee3', bytes: hexToBytes('feea200599'), match: () => true, timeoutMs: 20 }),
    ).rejects.toThrow(/No reply/);

    await link.write('feea', 'fee2', new Uint8Array(25));
    expect(link.writes.slice(-2).map(w => w.hex.length / 2)).toEqual([20, 5]);
    await link.requestMtu(200);
    await link.write('feea', 'fee2', new Uint8Array(25));
    expect(link.writes[link.writes.length - 1].hex.length / 2).toBe(25);
  });

  it('a vendor driver composes with the standard handlers, can suppress one, and syncs history on connect', async () => {
    const VENDOR: FakeLinkSpec = {
      id: 'FC:76',
      services: { '180d': ['2a37'], '180f': ['2a19'], '180a': ['2a29'], fee7: ['fea1'] },
      reads: { '180f/2a19': '51', '180a/2a29': ascii('TESTVENDOR'), 'fee7/fea1': '012b0400' },
    };
    const vendor: DeviceDriver = {
      id: 'fitcloudpro',
      platform: 'fitcloudpro',
      vendor: true,
      detect: info =>
        info.manufacturer?.startsWith('TESTVENDOR') ? { form: 'watch', capabilities: ['history_sleep', 'history_steps'], suppress: ['gatt-battery'] } : null,
      async open() {
        const night = Date.now() - 8 * 3600_000;
        return {
          capabilities: ['history_sleep', 'history_steps'],
          sync: async () => [
            { kind: 'sleep', startMs: night, endMs: night + 7 * 3600_000, externalId: `sleep:${night}`, stages: [{ stage: 'deep', startMs: night, endMs: night + 3600_000 }] },
            { kind: 'daily_total', metric: 'steps', day: '2026-09-26', value: 8200, unit: 'count', firstMs: 1, atMs: 2 },
          ],
          close: async () => {},
        };
      },
    };
    registerDriver(vendor);
    const info = { id: 'FC:76', name: 'Test Watch', services: new FakeLink(VENDOR).services as string[], manufacturer: 'TESTVENDOR', model: null, firmware: null };
    const det = detect(info)!;
    expect(det.handlers.map(h => h.driver.id).sort()).toEqual(['fitcloudpro', 'gatt-hr', 'gatt-pedometer']);
    expect(det).toMatchObject({ form: 'watch', platform: 'fitcloudpro' });
    expect(det.capabilities).toEqual(expect.arrayContaining(['live_hr', 'live_steps', 'history_sleep', 'history_steps']));
    expect(det.capabilities).not.toContain('battery');
    // A strap-only device named like a ring is shown as a ring.
    expect(detect({ ...info, name: 'R02 Ring', services: ['0000180d-0000-1000-8000-00805f9b34fb'], manufacturer: null })?.form).toBe('ring');

    add(VENDOR);
    await connectDevice('FC:76', 'Test Watch');
    await settle();
    expect(useAppStore.getState().connected['FC:76']).toMatchObject({ platform: 'fitcloudpro', syncing: false });
    expect(useAppStore.getState().connected['FC:76'].lastSyncMs).toBeGreaterThan(0);
    const nights = await sleepRepo.list();
    expect(nights).toHaveLength(1);
    expect(nights[0]).toMatchObject({ sourceId: 'ble:FC:76', device: 'Test Watch' });
    expect((await samplesRepo.totalsBySourceByDay('steps', '2026-09-26', '2026-09-26'))[0]).toMatchObject({ value: 8200 });
    expect((await devicesRepo.get('FC:76'))?.lastSyncMs).toBeGreaterThan(0);
    // Syncing again changes nothing.
    await syncNow('FC:76');
    expect(await sleepRepo.list()).toHaveLength(1);
  });
});
