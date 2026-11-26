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

let appInstance: FirebaseApp | null = null;
let analyticsInstance: Analytics | null = null;
let messagingInstance: Messaging | null = null;

export async function initFirebaseServices(): Promise<void> {
  if (!isFirebaseConfigured) return;

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

export async function requestPushPermission(): Promise<{
  supported: boolean;
  granted: boolean;
  token?: string;
  reason?: string;
}> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return { supported: false, granted: false, reason: 'المتصفح لا يدعم الإشعارات' };
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return { supported: true, granted: false, reason: 'لم يتم منح إذن الإشعارات' };
    }

    if (isFirebaseConfigured && !messagingInstance) {
      await initFirebaseServices();
    }

    if (messagingInstance && import.meta.env.VITE_FIREBASE_VAPID_KEY) {
      const token = await getToken(messagingInstance, {
        vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
      });
      return { supported: true, granted: true, token };
    }

    return { supported: true, granted: true };
  } catch {
    return { supported: true, granted: false, reason: 'تعذّر تفعيل الإشعارات حالياً' };
  }
}

export function subscribeForegroundNotifications(
  onNotify: (payload: { title: string; body: string }) => void,
): () => void {
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
