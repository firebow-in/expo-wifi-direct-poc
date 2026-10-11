import { PermissionsAndroid, Permission, Platform } from 'react-native';

const NEARBY_WIFI_DEVICES = (PermissionsAndroid.PERMISSIONS.NEARBY_WIFI_DEVICES ??
  'android.permission.NEARBY_WIFI_DEVICES') as Permission;

export async function ensureWifiDirectPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;

  const apiLevel = typeof Platform.Version === 'number' ? Platform.Version : 0;

  const perms: Permission[] = [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  if (apiLevel >= 33) {
    perms.push(NEARBY_WIFI_DEVICES);
  }

  const results = await PermissionsAndroid.requestMultiple(perms);

  for (const p of perms) {
    if (results[p] !== PermissionsAndroid.RESULTS.GRANTED) {
      return false;
    }
  }
  return true;
}
