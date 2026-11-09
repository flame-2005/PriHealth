import { NativeEventEmitter, NativeModules, Platform, type EmitterSubscription } from 'react-native';
import type { StepReading } from './stepCounterTypes';

export type { StepReading } from './stepCounterTypes';

const { StepCounterModule } = NativeModules;

const EVENT = 'StepCounterUpdate';

export const StepCounter = {
  isSupported(): Promise<boolean> {
    if (Platform.OS !== 'android' || !StepCounterModule?.isAvailable) return Promise.resolve(false);
    return StepCounterModule.isAvailable();
  },

  /** One-shot read. Resolves null when the sensor is missing or silent for 3 s. */
  read(): Promise<StepReading | null> {
    if (!StepCounterModule?.read) return Promise.resolve(null);
    return StepCounterModule.read();
  },

  startListening(): void {
    StepCounterModule?.startListening?.();
  },

  stopListening(): void {
    StepCounterModule?.stopListening?.();
  },

  addListener(cb: (r: StepReading) => void): EmitterSubscription | null {
    if (!StepCounterModule) return null;
    const emitter = new NativeEventEmitter(StepCounterModule);
    return emitter.addListener(EVENT, cb);
  },
};
