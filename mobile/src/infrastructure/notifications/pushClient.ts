/**
 * Expo Notifications wrapper (push token + listeners). Background push requires a real
 * device + an EAS dev/standalone build — on a simulator (or in Expo Go),
 * getExpoPushTokenAsync throws, so ensurePermissionAndToken() returns null and every push
 * path becomes a no-op. (No expo-device dependency: the try/catch is the guard.)
 */
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { easProjectId } from "@/infrastructure/config";

// Foreground: show the banner + bump the badge (so an open app still surfaces it).
// The relay pairs every display push with a silent data-only companion (it wakes
// the background preload task) — never render that one.
Notifications.setNotificationHandler({
	  handleNotification: async (notification) => {
	    const data = notification.request.content.data as NotifData | undefined;
	    const silent = data?.silent === true;
	    return {
	      shouldShowAlert: !silent,
	      shouldShowBanner: !silent,
	      shouldShowList: !silent,
	      shouldPlaySound: !silent,
	      shouldSetBadge: !silent,
	    };
	  },
});

export type NotifData = { buddyId?: string; chatId?: number; updateId?: number; silent?: boolean };

export const pushClient = {
  async getPermissionStatus(): Promise<Notifications.PermissionStatus> {
    const { status } = await Notifications.getPermissionsAsync();
    return status;
  },

  /**
   * Ensure permission + return the Expo push token, or null when unavailable
   * (simulator/emulator, denied permission, missing projectId).
   */
  async ensurePermissionAndToken(): Promise<string | null> {
    if (!easProjectId) {
      console.warn("[push] EAS projectId is missing; Expo push token cannot be created.");
      return null;
    }

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "기본",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
      });
    }

    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") {
      ({ status } = await Notifications.requestPermissionsAsync());
    }
    if (status !== "granted") {
      console.warn(`[push] Notification permission is ${status}; Expo push token unavailable.`);
      return null;
    }

    try {
      const { data } = await Notifications.getExpoPushTokenAsync({ projectId: easProjectId });
      return data;
    } catch (error) {
      console.warn("[push] Failed to create Expo push token.", error);
      return null;
    }
  },

  addForegroundListener(cb: (data: NotifData) => void): () => void {
    const sub = Notifications.addNotificationReceivedListener((n) => {
      cb((n.request.content.data ?? {}) as NotifData);
    });
    return () => sub.remove();
  },

  addResponseListener(cb: (data: NotifData) => void): () => void {
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      cb((r.notification.request.content.data ?? {}) as NotifData);
    });
    return () => sub.remove();
  },

  /** Cold-start: the tap that launched the app, if any. */
  async getLastResponseData(): Promise<NotifData | null> {
    const r = await Notifications.getLastNotificationResponseAsync();
    return r ? ((r.notification.request.content.data ?? {}) as NotifData) : null;
  },
};
