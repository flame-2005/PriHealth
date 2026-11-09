import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, ScanMode, type Device } from 'react-native-ble-plx';
import { BondedDevices } from '../../bridge/bondedDevices';
import { fromKnownDevice, isListable, kindFromServices, type FoundDevice } from './discovery';

export type { FoundDevice } from './discovery';
export { kindFromServices } from './discovery';

let manager: BleManager | null = null;

export function getBle(): BleManager {
  if (!manager) manager = new BleManager();
  return manager;
}

/** Android 12+ needs scan/connect; older versions need fine location for scanning. */
export async function ensureBlePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const api = Number(Platform.Version);
  if (api >= 31) {
    const res = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);
    return Object.values(res).every(v => v === PermissionsAndroid.RESULTS.GRANTED);
  }
  const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
  return res === PermissionsAndroid.RESULTS.GRANTED;
}

export async function hasBlePermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const api = Number(Platform.Version);
  if (api >= 31) {
    const a = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN);
    const b = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
    return a && b;
  }
  return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
}

export async function isBluetoothOn(): Promise<boolean> {
  const state = await getBle().state();
  return state === 'PoweredOn';
}

/**
 * Scan for nearby devices. Resolves the stop function.
 *
 * There is deliberately no service filter: watches and scales that speak their own protocol advertise
 * without the standard service UUIDs even when they expose a standard profile once connected, so a
 * filtered scan never lists them. Anonymous adverts are dropped instead (see `isListable`). Low-latency
 * is the mode Android recommends for a foreground scan; the screen stops it after 12 s.
 */
export function startScan(onFound: (d: FoundDevice) => void, onError?: (e: Error) => void): () => void {
  const ble = getBle();
  ble
    .startDeviceScan(null, { scanMode: ScanMode.LowLatency, allowDuplicates: false }, (error, device) => {
      if (error) {
        onError?.(error);
        return;
      }
      if (!device) return;
      const name = device.name ?? device.localName ?? null;
      const kind = kindFromServices(device.serviceUUIDs, name);
      if (!isListable(name, kind)) return;
      onFound({ id: device.id, name, rssi: device.rssi ?? null, kind, source: 'scan' });
    })
    // The call itself can be refused (as opposed to a scan that starts and then fails).
    .catch(e => onError?.(e));
  return () => {
    ble.stopDeviceScan().catch(() => {});
  };
}

/**
 * Devices the phone is already paired with or connected to over LE. A watch that is connected to its
 * vendor app stops advertising, so this is the only way it can be offered while that app holds it.
 * Android lets several apps share one connection, so connecting to such a device still works.
 */
export async function listKnownDevices(): Promise<FoundDevice[]> {
  try {
    return (await BondedDevices.list()).map(fromKnownDevice);
  } catch {
    return [];
  }
}

/** Connects and discovers everything; the link layer (`devices/link.ts`) takes it from here. */
export async function connect(id: string): Promise<Device> {
  const ble = getBle();
  const device = await ble.connectToDevice(id, { timeout: 10_000 });
  try {
    await device.discoverAllServicesAndCharacteristics();
  } catch (e) {
    await disconnect(id);
    throw e;
  }
  return device;
}

export async function disconnect(id: string): Promise<void> {
  try {
    await getBle().cancelDeviceConnection(id);
  } catch {
    // already disconnected
  }
}
