import { backend } from './backend';
import {
  getNotificationPermissionStatus,
  requestPushPermission,
  type NotificationPermissionStatus,
  type PushPlatform,
} from './firebase';

const NOTIF_DENIED_STORAGE_KEY = 'bosla-notif-denied';

export interface PushRegistrationResult {
  supported: boolean;
  granted: boolean;
  status: NotificationPermissionStatus;
  platform: PushPlatform;
  token?: string;
  tokenSaved: boolean;
  reason?: string;
}

export function isNotificationDeniedRemembered(): boolean {
  try {
    return localStorage.getItem(NOTIF_DENIED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setNotificationDeniedRemembered(denied: boolean): void {
  try {
    if (denied) {
      localStorage.setItem(NOTIF_DENIED_STORAGE_KEY, '1');
    } else {
      localStorage.removeItem(NOTIF_DENIED_STORAGE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export async function getBuildNotificationStatus(): Promise<{
  status: NotificationPermissionStatus;
  rememberedDenied: boolean;
}> {
  const status = await getNotificationPermissionStatus();
  if (status === 'granted') {
    setNotificationDeniedRemembered(false);
    return { status: 'granted', rememberedDenied: false };
  }
  return {
    status,
    rememberedDenied: status === 'denied' || isNotificationDeniedRemembered(),
  };
}

export async function requestAndRegisterBuildNotifications(): Promise<PushRegistrationResult> {
  const res = await requestPushPermission();
  if (res.granted) {
    setNotificationDeniedRemembered(false);
    let tokenSaved = false;
    if (res.token) {
      const saveRes = await backend.registerDeviceToken({
        fcmToken: res.token,
        platform: res.platform,
      });
      tokenSaved = saveRes.ok;
    }
    return { ...res, tokenSaved };
  }

  if (res.supported) {
    setNotificationDeniedRemembered(true);
  }
  return { ...res, tokenSaved: false };
}
