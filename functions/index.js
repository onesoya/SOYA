import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { createHash } from "node:crypto";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";

initializeApp();

const db = getFirestore();
const openAiApiKey = defineSecret("OPENAI_API_KEY");
const monthlyConsultationLimit = 6;

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

function timeBefore(time, minutesBefore) {
  const [hour, minute] = String(time || "").split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return time;
  const minutes = (hour * 60 + minute - Number(minutesBefore || 0) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
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

  const workoutPlans = Array.isArray(data.workoutPlans) ? data.workoutPlans.filter((plan) => plan.date === clock.day) : [];
  const workoutDone = Array.isArray(data.workoutActualDates) ? data.workoutActualDates.includes(clock.day) : Boolean(completed.workout);
  if (travelBehavior !== "핵심만" && settings.workoutEnabled && !workoutDone) {
    if (workoutPlans.length) {
      for (const plan of workoutPlans) {
        const reminderTime = plan.startTime
          ? timeBefore(plan.startTime, settings.workoutLeadMinutes ?? 30)
          : settings.workoutTime;
        add(
          `workout_${plan.id}`,
          reminderTime,
          plan.startTime ? "곧 운동을 시작할 시간이에요" : "계획한 운동을 마쳤나요?",
          plan.startTime ? `${plan.title || "계획한 운동"} · ${plan.startTime} 시작` : "오늘의 움직임을 기록해보세요.",
        );
      }
    } else if (completed.workoutPlanned) {
      add("workout", settings.workoutTime, "계획한 운동을 마쳤나요?", "오늘의 움직임을 기록해보세요.");
    }
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

function outputText(data) {
  if (typeof data?.output_text === "string") return data.output_text.trim();
  return (data?.output || [])
    .flatMap((item) => item?.content || [])
    .filter((item) => item?.type === "output_text" && typeof item?.text === "string")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

function safeText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export const createWeeklyConsultation = onCall({
  region: "asia-northeast3",
  memory: "256MiB",
  timeoutSeconds: 120,
  secrets: [openAiApiKey],
}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Google 로그인 후 상담할 수 있어요.");

  const kind = request.data?.kind === "followup" ? "followup" : "weekly";
  const week = request.data?.week;
  const question = safeText(request.data?.question, 1000);
  const previousConsultation = safeText(request.data?.previousConsultation, 10000);
  const weekJson = week ? JSON.stringify(week) : "";
  if (kind === "weekly" && (!weekJson || weekJson.length > 50000)) throw new HttpsError("invalid-argument", "상담할 주간 기록을 확인해주세요.");
  if (kind === "followup" && (!question || !previousConsultation)) throw new HttpsError("invalid-argument", "이어갈 질문을 입력해주세요.");

  const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).format(new Date());
  const usageRef = db.collection("aiUsage").doc(`${request.auth.uid}_${month}`);
  const used = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(usageRef);
    const current = Number(snapshot.data()?.count || 0);
    if (current >= monthlyConsultationLimit) throw new HttpsError("resource-exhausted", `이번 달 상담 ${monthlyConsultationLimit}회를 모두 사용했어요.`);
    transaction.set(usageRef, { uid: request.auth.uid, month, count: current + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return current + 1;
  });

  const instructions = kind === "weekly"
    ? "당신은 SOYA 앱의 신중한 한국어 주간 코치입니다. 사용자는 체중 자체보다 체지방량 감소와 골격근량 유지·증가를 중요하게 봅니다. 제공된 한 주의 요약만 근거로 삼고, 기록된 사실과 추정을 분명히 구분하세요. 단백질·당류·식이섬유, 운동 수행, 월경 단계와 에너지·식욕을 함께 보되 월경으로 모든 변화를 단정하지 마세요. 의학적 진단이나 치료 지시를 하지 마세요. 답변은 '이번 주 한줄 요약', '잘한 점', '조정할 점', '체성분 흐름', '식사', '운동', '월경·컨디션 고려', '다음 주 행동 3가지' 순서로 구체적이고 따뜻하게 작성하세요. 기록이 부족한 항목은 부족하다고 말하세요."
    : "당신은 SOYA 앱에서 직전 주간 상담을 이어가는 신중한 한국어 코치입니다. 앞선 상담과 사용자의 질문에 직접 답하세요. 제공되지 않은 건강 정보를 만들어내지 말고, 의학적 진단이나 치료 지시를 하지 마세요. 답변은 간결하지만 실제로 실행할 수 있게 구체적으로 작성하세요.";
  const input = kind === "weekly"
    ? `다음은 사용자가 선택한 한 주의 정리된 기록입니다.\n${weekJson}`
    : `직전 상담:\n${previousConsultation}\n\n사용자의 추가 질문:\n${question}`;

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${openAiApiKey.value()}` },
      body: JSON.stringify({
        model: "gpt-5.6-sol",
        instructions,
        input,
        reasoning: { effort: "high" },
        max_output_tokens: kind === "weekly" ? 3000 : 2000,
        store: false,
        safety_identifier: createHash("sha256").update(request.auth.uid).digest("hex").slice(0, 64),
      }),
    });
    if (!response.ok) throw new Error(`OpenAI ${response.status}`);
    const data = await response.json();
    const text = outputText(data);
    if (!text) throw new Error("Empty OpenAI response");
    const inputTokens = Number(data?.usage?.input_tokens || 0);
    const outputTokens = Number(data?.usage?.output_tokens || 0);
    await usageRef.set({
      inputTokens: FieldValue.increment(inputTokens),
      outputTokens: FieldValue.increment(outputTokens),
      lastUsedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { text, source: "openai", model: "gpt-5.6-sol", reasoningEffort: "high", used, limit: monthlyConsultationLimit, inputTokens, outputTokens };
  } catch (error) {
    await usageRef.set({ count: FieldValue.increment(-1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    console.error("SOYA consultation failed", error);
    throw new HttpsError("internal", "지금은 상담을 불러오지 못했어요. 잠시 후 다시 시도해주세요.");
  }
});
