import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAnalytics, isSupported as isAnalyticsSupported, logEvent, type Analytics } from 'firebase/analytics';
import { getMessaging, getToken, isSupported as isMessagingSupported, onMessage, type Messaging } from 'firebase/messaging';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || '',
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId,
);

export type NotificationPermissionStatus = 'granted' | 'denied' | 'prompt' | 'unsupported';
export type PushPlatform = 'android' | 'ios' | 'web';

let appInstance: FirebaseApp | null = null;
let analyticsInstance: Analytics | null = null;
let messagingInstance: Messaging | null = null;

function getCurrentPushPlatform(): PushPlatform {
  if (!Capacitor.isNativePlatform()) return 'web';
  return Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';
}

export async function initFirebaseServices(): Promise<void> {
  if (Capacitor.isNativePlatform() || !isFirebaseConfigured) return;

  try {
    if (!getApps().length) {
      appInstance = initializeApp(firebaseConfig);
    } else {
      appInstance = getApps()[0];
    }

    if (await isAnalyticsSupported()) {
      analyticsInstance = getAnalytics(appInstance);
    }

    if (await isMessagingSupported()) {
      messagingInstance = getMessaging(appInstance);
    }
  } catch {
    // Firebase is optional for notifications/analytics; fail silently without blocking app
  }
}

export function trackAppEvent(eventName: string, params?: Record<string, string | number>): void {
  if (!analyticsInstance) return;
  try {
    logEvent(analyticsInstance, eventName, params);
  } catch {
    // Ignore analytics errors
  }
}

export async function getNotificationPermissionStatus(): Promise<NotificationPermissionStatus> {
  if (Capacitor.isNativePlatform()) {
    try {
      const status = await PushNotifications.checkPermissions();
      if (status.receive === 'granted') return 'granted';
      if (status.receive === 'denied') return 'denied';
      return 'prompt';
    } catch {
      return 'unsupported';
    }
  }

  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  return 'prompt';
}

async function getNativeFcmToken(): Promise<string | undefined> {
  return new Promise<string | undefined>((resolve) => {
    let settled = false;
    let regHandle: { remove: () => Promise<void> } | null = null;
    let errHandle: { remove: () => Promise<void> } | null = null;
    let timeoutId: number | undefined;

    const finish = (token?: string) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      void regHandle?.remove().catch(() => undefined);
      void errHandle?.remove().catch(() => undefined);
      resolve(token);
    };

    timeoutId = window.setTimeout(() => finish(undefined), 10000);

    void (async () => {
      try {
        regHandle = await PushNotifications.addListener('registration', (token) => {
          finish(token?.value?.trim() || undefined);
        });
        errHandle = await PushNotifications.addListener('registrationError', () => {
          finish(undefined);
        });
        await PushNotifications.register();
      } catch {
        finish(undefined);
      }
    })();
  });
}

export async function requestPushPermission(): Promise<{
  supported: boolean;
  granted: boolean;
  status: NotificationPermissionStatus;
  platform: PushPlatform;
  token?: string;
  reason?: string;
}> {
  const platform = getCurrentPushPlatform();

  if (Capacitor.isNativePlatform()) {
    try {
      let perm = await PushNotifications.checkPermissions();
      if (perm.receive !== 'granted') {
        perm = await PushNotifications.requestPermissions();
      }
      if (perm.receive !== 'granted') {
        const mappedStatus: NotificationPermissionStatus =
          perm.receive === 'denied' ? 'denied' : 'prompt';
        return {
          supported: true,
          granted: false,
          status: mappedStatus,
          platform,
          reason: 'لم يتم منح إذن الإشعارات',
        };
      }

      const token = await getNativeFcmToken();
      return {
        supported: true,
        granted: true,
        status: 'granted',
        platform,
        token,
      };
    } catch {
      return {
        supported: true,
        granted: false,
        status: 'prompt',
        platform,
        reason: 'تعذّر تفعيل الإشعارات حالياً',
      };
    }
  }

  if (typeof window === 'undefined' || !('Notification' in window)) {
    return {
      supported: false,
      granted: false,
      status: 'unsupported',
      platform,
      reason: 'المتصفح لا يدعم الإشعارات',
    };
  }

  try {
    const permission =
      Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();
    if (permission !== 'granted') {
      return {
        supported: true,
        granted: false,
        status: permission === 'denied' ? 'denied' : 'prompt',
        platform,
        reason: 'لم يتم منح إذن الإشعارات',
      };
    }

    if (isFirebaseConfigured && !messagingInstance) {
      await initFirebaseServices();
    }

    const vapidKey = (import.meta.env.VITE_FIREBASE_VAPID_KEY || '').trim();
    if (messagingInstance && vapidKey) {
      let serviceWorkerRegistration: ServiceWorkerRegistration | undefined;
      if ('serviceWorker' in navigator) {
        try {
          serviceWorkerRegistration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
        } catch {
          // Fall back to default Firebase Messaging service worker lookup
        }
      }
      const token = await getToken(messagingInstance, {
        vapidKey,
        ...(serviceWorkerRegistration ? { serviceWorkerRegistration } : {}),
      });
      return {
        supported: true,
        granted: true,
        status: 'granted',
        platform,
        token: token?.trim() || undefined,
      };
    }

    return { supported: true, granted: true, status: 'granted', platform };
  } catch {
    return {
      supported: true,
      granted: false,
      status: Notification.permission === 'denied' ? 'denied' : 'prompt',
      platform,
      reason: 'تعذّر تفعيل الإشعارات حالياً',
    };
  }
}

export function subscribeForegroundNotifications(
  onNotify: (payload: { title: string; body: string }) => void,
): () => void {
  if (Capacitor.isNativePlatform()) {
    let active = true;
    let nativeHandle: { remove: () => Promise<void> } | null = null;
    void PushNotifications.addListener('pushNotificationReceived', (notification) => {
      if (!active) return;
      onNotify({
        title: notification.title || 'بوصلة التطبيقات',
        body: notification.body || '',
      });
    })
      .then((handle) => {
        if (!active) {
          void handle.remove().catch(() => undefined);
        } else {
          nativeHandle = handle;
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
      void nativeHandle?.remove().catch(() => undefined);
    };
  }

  if (!messagingInstance) return () => {};
  try {
    return onMessage(messagingInstance, (payload) => {
      const title = payload.notification?.title || 'بوصلة التطبيقات';
      const body = payload.notification?.body || '';
      onNotify({ title, body });
    });
  } catch {
    return () => {};
  }
}
