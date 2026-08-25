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

// 알림 페이로드는 FCM이 표시하므로 여기서 다시 표시하지 않습니다.
messaging.onBackgroundMessage(() => undefined);

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destination = event.notification?.data?.FCM_MSG?.fcmOptions?.link
    || event.notification?.data?.url
    || "/";
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((client) => "focus" in client);
    return existing ? existing.focus() : clients.openWindow(destination);
  }));
});
