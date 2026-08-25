import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { onSchedule } from "firebase-functions/v2/scheduler";

initializeApp();

const db = getFirestore();

function localClock(date, timezone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  return { day, time: `${parts.hour}:${parts.minute}`, weekday: new Date(`${day}T00:00:00Z`).getUTCDay() };
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function inTravel(data, day) {
  return Boolean(data.travel?.active
    && (!data.travel.startDate || day >= data.travel.startDate)
    && (!data.travel.endDate || day <= data.travel.endDate));
}

function remindersFor(data, clock) {
  const settings = data.settings || {};
  const completed = data.completion?.date === clock.day ? data.completion : {};
  const travelBehavior = inTravel(data, clock.day) ? settings.travelBehavior : "기본 유지";
  if (travelBehavior === "모두 끄기") return [];

  const reminders = [];
  const add = (key, time, title, body) => {
    if (time === clock.time && data.lastSent?.[key] !== clock.day) reminders.push({ key, title, body });
  };

  if (travelBehavior !== "핵심만" && settings.bodyEnabled && !completed.body) {
    add("body", settings.bodyTime, "아침 인바디를 기록할까요?", "공복 측정 흐름을 이어가요.");
  }

  const meals = [
    ["breakfast", "아침"],
    ["lunch", "점심"],
    ["dinner", "저녁"],
  ];
  for (const [meal, label] of meals) {
    if (settings.mealEnabled?.[meal] && !completed.meals?.[meal]) {
      add(`meal_${meal}`, settings.mealTimes?.[meal], `${label} 식사를 기록할 시간이에요`, "먹은 내용을 SOYA에 가볍게 남겨보세요.");
    }
  }

  if (travelBehavior !== "핵심만" && settings.workoutEnabled && completed.workoutPlanned && !completed.workout) {
    add("workout", settings.workoutTime, "계획한 운동을 마쳤나요?", "오늘의 움직임을 기록해보세요.");
  }

  if (travelBehavior !== "핵심만" && settings.weeklyEnabled && settings.weeklyDay === clock.weekday && !completed.nextWeekPlanned) {
    add("weekly", settings.weeklyTime, "다음 주를 함께 계획할까요?", "식단과 운동을 미리 준비해요.");
  }

  if (travelBehavior !== "핵심만" && settings.cycleEnabled) {
    if (data.cycle?.nextOvulation === clock.day) add("cycle_ovulation", settings.cycleTime, "오늘은 예상 배란일이에요", "기록을 바탕으로 계산한 예상일이에요.");
    if (data.cycle?.nextPeriod === clock.day) add("cycle_period", settings.cycleTime, "오늘은 예상 월경일이에요", "출혈이 시작되면 SOYA에 기록해주세요.");
    if (data.cycle?.nextPeriod && addDays(data.cycle.nextPeriod, 3) === clock.day) add("cycle_late", settings.cycleTime, "예상 월경일이 3일 지났어요", "아직 기록하지 않았다면 오늘 상태를 확인해주세요.");
  }

  return reminders;
}

export const sendSoyaReminders = onSchedule({
  schedule: "every 1 minutes",
  timeZone: "Asia/Seoul",
  region: "asia-northeast3",
  memory: "256MiB",
  timeoutSeconds: 60,
}, async () => {
  const snapshot = await db.collection("pushSubscriptions").where("enabled", "==", true).get();
  await Promise.all(snapshot.docs.map(async (subscription) => {
    const data = subscription.data();
    if (!data.token) return;
    const clock = localClock(new Date(), data.timezone);
    const reminders = remindersFor(data, clock);
    if (!reminders.length) return;

    const sent = {};
    try {
      for (const reminder of reminders) {
        await getMessaging().send({
          token: data.token,
          notification: { title: reminder.title, body: reminder.body },
          data: { kind: reminder.key },
          webpush: {
            headers: { Urgency: "high" },
            fcmOptions: { link: data.appUrl || "https://my-balance-tiger.onesoya.chatgpt.site/" },
          },
        });
        sent[`lastSent.${reminder.key}`] = clock.day;
      }
      await subscription.ref.update({ ...sent, lastDeliveryAt: FieldValue.serverTimestamp() });
    } catch (error) {
      const code = String(error?.code || "");
      if (code.includes("registration-token-not-registered") || code.includes("invalid-registration-token")) {
        await subscription.ref.update({ enabled: false, disabledAt: FieldValue.serverTimestamp() });
        return;
      }
      console.error("SOYA reminder delivery failed", subscription.id, error);
    }
  }));
});
