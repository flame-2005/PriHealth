import { NativeModules, Platform } from 'react-native';

const { BondedDevicesModule } = NativeModules;

/** A Bluetooth LE device the phone is paired with or connected to, as its Bluetooth settings know it. */
export interface KnownDevice {
  id: string;
  name: string | null;
  connected: boolean;
  /** Service UUIDs the phone has cached for the device; often empty for LE devices, so only a hint. */
  serviceUuids: string[];
}

export const BondedDevices = {
  /** Connected devices first, then the rest of the paired list. Empty off Android or without the module. */
  list(): Promise<KnownDevice[]> {
    if (Platform.OS !== 'android' || !BondedDevicesModule?.list) return Promise.resolve([]);
    return BondedDevicesModule.list();
  },
};
