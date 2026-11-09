import { wipeAll } from '../src/db';
import { devicesRepo } from '../src/db/repositories/devicesRepo';
import { bytesToHex } from '../src/domain/bytes';
import { readDeviceInfo } from '../src/integrations/devices/link';
import { forwardNotification } from '../src/integrations/devices/notifications';
import { connectDevice, disconnectAll, setLinkFactory } from '../src/integrations/devices/session';
import { FakeLink, type FakeLinkSpec } from '../src/integrations/devices/testing/fakeLink';
import { useAppStore } from '../src/store/useAppStore';

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

const WATCH: FakeLinkSpec = {
  id: 'FC:75',
  services: { '180d': ['2a37'], '180a': ['2a29'], feea: ['fee1', 'fee2', 'fee3'] },
  reads: { '180a/2a29': ascii('MOYOUNG-V2') },
};
const STRAP: FakeLinkSpec = { id: 'AA:BB', services: { '180d': ['2a37'] } };

suite('phone notification relay', () => {
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

  it('forwards only to devices that asked for it, honouring the app allowlist', async () => {
    const watch = new FakeLink(WATCH);
    const strap = new FakeLink(STRAP);
    links.set(watch.id, watch);
    links.set(strap.id, strap);
    await devicesRepo.upsert({ id: 'FC:75', name: 'Icon Plus', kind: 'watch', lastSeenMs: 1, settings: { commands: { set_time: false, user_profile: false } } });
    await connectDevice('FC:75', 'Icon Plus');
    await connectDevice('AA:BB', 'Polar H10');
    const outgoing = () => watch.writes.filter(w => w.hex.startsWith('feea') && w.hex[8] === '4' && w.hex[9] === '1');
    const note = { package: 'com.whatsapp', title: 'Mum', text: 'Dinner at 8', category: 'whatsapp' as const, whenMs: 1 };

    // Off by default: nothing goes out.
    expect(await forwardNotification(note)).toBe(0);
    expect(outgoing()).toHaveLength(0);

    await devicesRepo.setSettings('FC:75', { notifications: true, commands: { set_time: false, user_profile: false } });
    expect(await forwardNotification(note)).toBe(1);
    expect(outgoing()).toHaveLength(1);
    expect(outgoing()[0].hex.slice(0, 12)).toBe('feea20174108');

    await devicesRepo.setSettings('FC:75', { notifications: true, notifyApps: ['com.android.mms'] });
    expect(await forwardNotification(note)).toBe(0);
    expect(await forwardNotification({ ...note, package: 'com.android.mms', category: 'sms' })).toBe(1);
    expect(outgoing()[1].hex.slice(8, 12)).toBe('4101');
  });
});
