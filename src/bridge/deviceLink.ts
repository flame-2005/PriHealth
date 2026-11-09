import { NativeModules, Platform } from 'react-native';

const { DeviceLinkModule } = NativeModules;

/**
 * The foreground service that keeps the process, and the Bluetooth links, alive with the app
 * closed. Android 12+ only lets it start while the app is in the foreground, and Android 14+
 * only with a Bluetooth runtime permission granted; `start` resolves false when refused.
 */
export const DeviceLink = {
  start(title: string, text: string): Promise<boolean> {
    if (Platform.OS !== 'android' || !DeviceLinkModule?.start) return Promise.resolve(false);
    return DeviceLinkModule.start(title, text);
  },
  update(title: string, text: string): void {
    DeviceLinkModule?.update?.(title, text);
  },
  stop(): void {
    DeviceLinkModule?.stop?.();
  },
  isRunning(): Promise<boolean> {
    if (!DeviceLinkModule?.isRunning) return Promise.resolve(false);
    return DeviceLinkModule.isRunning();
  },
};
