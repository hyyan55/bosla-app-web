// Firebase Cloud Messaging background service worker placeholder.
// Configure Firebase project credentials when deploying FCM.
self.addEventListener('push', (event) => {
  if (!event.data) return;
  try {
    const payload = event.data.json();
    const title = payload?.notification?.title || 'بوصلة التطبيقات';
    const options = {
      body: payload?.notification?.body || '',
      dir: 'rtl',
      lang: 'ar',
    };
    event.waitUntil(self.registration.showNotification(title, options));
  } catch {
    // ignore malformed push payloads
  }
});
