"use client";

import { doc, getFirestore, serverTimestamp, setDoc } from "firebase/firestore";
import { deleteToken, getMessaging, getToken, isSupported, onMessage } from "firebase/messaging";
import type { ReminderSettings } from "./data";
import { firebaseApp, firebaseAuth } from "./firebase-client";

const vapidKey = "BHn6dE3c8zTwK_bAJ6hLB9cCy7VNkevK9xwr-yh8u-itzjNVRM24ICs-usqthDmE-G03uWJdAvdj0IfKLJrjYeg";

export type PushStatus = "unsupported" | "off" | "blocked" | "working" | "enabled" | "error";

export type PushSyncPayload = {
  settings: ReminderSettings;
  workoutPlans: Array<{
    id: string;
    date: string;
    title: string;
    startTime?: string;
  }>;
  workoutActualDates: string[];
  completion: {
    date: string;
    body: boolean;
    meals: Record<"breakfast" | "lunch" | "dinner", boolean>;
    workoutPlanned: boolean;
    workout: boolean;
    nextWeekPlanned: boolean;
  };
  travel: {
    active: boolean;
    startDate?: string;
    endDate?: string;
  };
  cycle: {
    nextPeriod?: string;
    nextOvulation?: string;
  };
};

async function supported() {
  return typeof window !== "undefined"
    && "serviceWorker" in navigator
    && "Notification" in window
    && await isSupported();
}

async function registration() {
  return navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope: "/" });
}

async function signedInUser() {
  const user = firebaseAuth().currentUser;
  if (!user) throw new Error("Google 로그인 후 알림을 켜주세요.");
  return user;
}

async function tokenForDevice() {
  const messaging = getMessaging(firebaseApp());
  const serviceWorkerRegistration = await registration();
  const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration });
  if (!token) throw new Error("이 기기의 알림 토큰을 만들지 못했습니다.");
  return { messaging, token };
}

async function writeSubscription(payload: PushSyncPayload, enabled: boolean) {
  const user = await signedInUser();
  const { token } = await tokenForDevice();
  const cleanPayload = JSON.parse(JSON.stringify(payload)) as PushSyncPayload;
  await setDoc(doc(getFirestore(firebaseApp()), "pushSubscriptions", user.uid), {
    enabled,
    token,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Seoul",
    appUrl: window.location.origin,
    ...cleanPayload,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function getPushStatus(): Promise<PushStatus> {
  if (!await supported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  return Notification.permission === "granted" ? "enabled" : "off";
}

export async function enablePushNotifications(payload: PushSyncPayload) {
  if (!await supported()) throw new Error("이 브라우저에서는 실제 알림을 사용할 수 없습니다.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied" ? "알림 권한이 차단됐습니다." : "알림 권한이 아직 허용되지 않았습니다.");
  await writeSubscription(payload, true);
}

export async function syncPushSubscription(payload: PushSyncPayload) {
  if (!await supported() || Notification.permission !== "granted") return;
  await writeSubscription(payload, true);
}

export async function disablePushNotifications(payload: PushSyncPayload) {
  if (!await supported()) return;
  const user = await signedInUser();
  const messaging = getMessaging(firebaseApp());
  const token = await getToken(messaging, { vapidKey, serviceWorkerRegistration: await registration() });
  if (token) {
    const cleanPayload = JSON.parse(JSON.stringify(payload)) as PushSyncPayload;
    await setDoc(doc(getFirestore(firebaseApp()), "pushSubscriptions", user.uid), {
      enabled: false,
      token,
      ...cleanPayload,
      updatedAt: serverTimestamp(),
    }, { merge: true });
    await deleteToken(messaging);
  }
}

export async function observeForegroundNotifications() {
  if (!await supported()) return () => undefined;
  const messaging = getMessaging(firebaseApp());
  return onMessage(messaging, async (payload) => {
    if (Notification.permission !== "granted") return;
    const serviceWorkerRegistration = await registration();
    await serviceWorkerRegistration.showNotification(payload.notification?.title ?? "SOYA", {
      body: payload.notification?.body ?? "기록할 시간이 왔어요.",
      icon: "/tiger-icon-192.png",
      badge: "/tiger-icon-192.png",
      data: { url: payload.fcmOptions?.link ?? "/" },
    });
  });
}
