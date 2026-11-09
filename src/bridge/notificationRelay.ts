import { NativeEventEmitter, NativeModules, Platform, type EmitterSubscription } from 'react-native';

const { NotificationRelayModule } = NativeModules;

export interface PhoneNotification {
  package: string;
  title: string;
  text: string;
  category: 'call' | 'sms' | 'whatsapp' | 'other';
  whenMs: number;
}

const EVENT = 'PfNotification';

/** Phone notifications, once the user has granted notification access in Android settings. */
export const NotificationRelay = {
  isEnabled(): Promise<boolean> {
    if (Platform.OS !== 'android' || !NotificationRelayModule?.isEnabled) return Promise.resolve(false);
    return NotificationRelayModule.isEnabled();
  },
  openSettings(): void {
    NotificationRelayModule?.openSettings?.();
  },
  rebind(): void {
    NotificationRelayModule?.rebind?.();
  },
  addListener(cb: (n: PhoneNotification) => void): EmitterSubscription | null {
    if (!NotificationRelayModule) return null;
    const emitter = new NativeEventEmitter(NotificationRelayModule);
    return emitter.addListener(EVENT, cb);
  },
};
