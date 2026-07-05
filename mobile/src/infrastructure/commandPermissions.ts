/**
 * Runtime permission onboarding for the phone-command pipe (Android only).
 *
 * The background command service reads location / SMS / contacts / media
 * natively; those runtime permissions must be granted by the user once. This
 * requests them from JS (PermissionsAndroid). Background location must be asked
 * AFTER foreground location (Android 10+), and lands the user on the system
 * "Allow all the time" screen.
 */
import { PermissionsAndroid, Platform } from "react-native";

type Perm = (typeof PermissionsAndroid.PERMISSIONS)[keyof typeof PermissionsAndroid.PERMISSIONS];

function mediaPerms(): Perm[] {
  const P = PermissionsAndroid.PERMISSIONS;
  if (typeof Platform.Version === "number" && Platform.Version >= 33) {
    return [P.READ_MEDIA_IMAGES, P.READ_MEDIA_VIDEO];
  }
  return [P.READ_EXTERNAL_STORAGE];
}

/** The foreground runtime permissions the command tools need (excludes background location). */
function foregroundPerms(): Perm[] {
  const P = PermissionsAndroid.PERMISSIONS;
  return [P.ACCESS_FINE_LOCATION, P.READ_SMS, P.SEND_SMS, P.READ_CONTACTS, ...mediaPerms()];
}

export interface CommandPermissionStatus {
  granted: number;
  total: number;
  backgroundLocation: boolean;
}

export const commandPermissions = {
  supported(): boolean {
    return Platform.OS === "android";
  },

  async status(): Promise<CommandPermissionStatus> {
    if (Platform.OS !== "android") return { granted: 0, total: 0, backgroundLocation: false };
    const perms = foregroundPerms();
    let granted = 0;
    for (const p of perms) {
      if (await PermissionsAndroid.check(p)) granted += 1;
    }
    const bg = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION);
    return { granted, total: perms.length, backgroundLocation: bg };
  },

  /** Request all foreground perms, then background location (separate step). */
  async requestAll(): Promise<CommandPermissionStatus> {
    if (Platform.OS !== "android") return { granted: 0, total: 0, backgroundLocation: false };
    await PermissionsAndroid.requestMultiple(foregroundPerms());
    // Background location can only be requested after foreground location is granted.
    const fine = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
    if (fine) {
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION);
    }
    return this.status();
  },
};
