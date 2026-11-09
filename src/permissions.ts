import { PermissionsAndroid, Platform } from 'react-native';

/** Step counting needs ACTIVITY_RECOGNITION on Android 10+ (API 29). */
export async function hasActivityPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (Number(Platform.Version) < 29) return true;
  return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION);
}

export async function requestActivityPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (Number(Platform.Version) < 29) return true;
  const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION, {
    title: 'Count your steps',
    message: 'PrivateFit reads the phone step sensor to count steps. The count never leaves this device.',
    buttonPositive: 'Allow',
    buttonNegative: 'Not now',
  });
  return res === PermissionsAndroid.RESULTS.GRANTED;
}

/** Exports go through MediaStore on Android 10+; older versions write the file directly and need this. */
export async function requestExportPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (Number(Platform.Version) >= 29) return true;
  const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE);
  return res === PermissionsAndroid.RESULTS.GRANTED;
}

/** The "connected to your watch" notification needs POST_NOTIFICATIONS on Android 13+ (API 33). */
export async function hasNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (Number(Platform.Version) < 33) return true;
  return PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (Number(Platform.Version) < 33) return true;
  const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
  return res === PermissionsAndroid.RESULTS.GRANTED;
}
