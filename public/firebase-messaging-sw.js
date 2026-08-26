/* global firebase */
importScripts("https://www.gstatic.com/firebasejs/12.18.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyCVkyfh8kNeoiqIuFp3rZu4wl01L6R_os0",
  authDomain: "soya-e12cd.firebaseapp.com",
  projectId: "soya-e12cd",
  storageBucket: "soya-e12cd.firebasestorage.app",
  messagingSenderId: "641439217344",
  appId: "1:641439217344:web:5f16c3cab445dbe2c8df25",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const data = payload?.data || {};
  return self.registration.showNotification(data.title || "SOYA", {
    body: data.body || "기록할 시간이 왔어요.",
    icon: "/tiger-icon-192.png",
    badge: "/tiger-icon-192.png",
    data: { kind: data.kind, url: data.url || "/" },
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destination = event.notification?.data?.FCM_MSG?.fcmOptions?.link
    || event.notification?.data?.url
    || "/";
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const absoluteDestination = new URL(destination, self.location.origin).toString();
    const existing = windows.find((client) => "focus" in client && new URL(client.url).origin === self.location.origin);
    if (!existing) return clients.openWindow(destination);
    existing.postMessage({ type: "SOYA_NOTIFICATION_CLICK", url: absoluteDestination });
    return existing.focus();
  }));
});
