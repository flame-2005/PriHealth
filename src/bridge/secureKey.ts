import { NativeModules } from 'react-native';

const { SecureKeyModule } = NativeModules;

/** Random secret generated once and kept encrypted by the Android Keystore. */
export const SecureKey = {
  getOrCreateKey(alias: string): Promise<string> {
    if (!SecureKeyModule?.getOrCreateKey) return Promise.reject(new Error('SecureKeyModule unavailable'));
    return SecureKeyModule.getOrCreateKey(alias);
  },
  deleteKey(alias: string): Promise<void> {
    if (!SecureKeyModule?.deleteKey) return Promise.resolve();
    return SecureKeyModule.deleteKey(alias);
  },
};
