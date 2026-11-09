import { fromKnownDevice, isListable, kindFromServices, mergeFound, type FoundDevice } from '../src/integrations/ble/discovery';

const found = (over: Partial<FoundDevice> = {}): FoundDevice => ({
  id: 'AA:BB:CC:DD:EE:FF',
  name: 'Icon Plus',
  rssi: null,
  kind: 'unknown',
  source: 'scan',
  ...over,
});

describe('device discovery', () => {
  it('classifies by service UUID in short, 32-bit and full form', () => {
    expect(kindFromServices(['180D'])).toBe('strap');
    expect(kindFromServices(['0000180d'])).toBe('strap');
    expect(kindFromServices(['0000181b-0000-1000-8000-00805f9b34fb', '180f'])).toBe('scale');
    expect(kindFromServices(['181D'])).toBe('scale');
    expect(kindFromServices(['180f', 'feea'])).toBe('unknown');
    expect(kindFromServices(null)).toBe('unknown');
    // A watch carries the pedometer, usually next to heart rate; the pedometer decides.
    expect(kindFromServices(['180d', 'fee7', 'feea'])).toBe('watch');
    expect(kindFromServices(['fee7'])).toBe('watch');
  });

  it('lists named devices and standard sensors, not anonymous adverts', () => {
    expect(isListable('Icon Plus', 'unknown')).toBe(true);
    expect(isListable(null, 'strap')).toBe(true);
    expect(isListable(null, 'unknown')).toBe(false);
    expect(isListable('  ', 'unknown')).toBe(false);
  });

  it('maps what the phone knows, marking a live connection over a bare pairing', () => {
    const paired = fromKnownDevice({ id: 'A', name: 'Icon Plus', connected: false, serviceUuids: [] });
    const live = fromKnownDevice({ id: 'B', name: 'Polar H10', connected: true, serviceUuids: ['180d'] });
    expect(paired).toEqual({ id: 'A', name: 'Icon Plus', rssi: null, kind: 'unknown', source: 'paired' });
    expect(live).toEqual({ id: 'B', name: 'Polar H10', rssi: null, kind: 'strap', source: 'connected' });
  });

  it('appends a new device', () => {
    const list = mergeFound([], found());
    expect(list).toHaveLength(1);
    expect(mergeFound(list, found({ id: 'other' }))).toHaveLength(2);
  });

  it('folds a scan sighting into the paired entry, keeping what the phone knows', () => {
    const list = [found({ source: 'connected' })];
    const merged = mergeFound(list, found({ name: null, rssi: -58, kind: 'strap' }));
    expect(merged).toEqual([found({ name: 'Icon Plus', rssi: -58, kind: 'strap', source: 'connected' })]);
  });

  it('upgrades the source when the phone turns out to know a scanned device', () => {
    const merged = mergeFound([found({ rssi: -70 })], found({ source: 'paired' }));
    expect(merged[0]).toMatchObject({ rssi: -70, source: 'paired' });
  });

  it('returns the same array while a device keeps advertising with nothing new', () => {
    const list = [found({ rssi: -60 })];
    expect(mergeFound(list, found({ rssi: -61 }))).toBe(list);
    expect(mergeFound(list, found({ rssi: -62, source: 'scan' }))).toBe(list);
  });
});
