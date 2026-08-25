import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { createHash, randomBytes } from "node:crypto";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";

initializeApp();

const db = getFirestore();
const openAiApiKey = defineSecret("OPENAI_API_KEY");
const monthlyConsultationLimit = 6;
const solInputUsdPerMillion = 4;
const solOutputUsdPerMillion = 20;

function currentUsageMonth() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit" }).format(new Date());
}

function usageSummary(data = {}) {
  const used = Math.max(0, Number(data.count || 0));
  const inputTokens = Math.max(0, Number(data.inputTokens || 0));
  const outputTokens = Math.max(0, Number(data.outputTokens || 0));
  const estimatedUsd = inputTokens / 1_000_000 * solInputUsdPerMillion
    + outputTokens / 1_000_000 * solOutputUsdPerMillion;
  return {
    used,
    limit: monthlyConsultationLimit,
    remaining: Math.max(0, monthlyConsultationLimit - used),
    inputTokens,
    outputTokens,
    estimatedUsd: Number(estimatedUsd.toFixed(6)),
    krwReferenceRate: 1400,
  };
}

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

const appleHealthEndpoint = "https://asia-northeast3-soya-e12cd.cloudfunctions.net/importAppleHealth";

function isoTimestamp(value) {
  return value?.toDate instanceof Function ? value.toDate().toISOString() : undefined;
}

function healthTokenHash(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

function validHealthDate(value) {
  return /^20\d{2}-\d{2}-\d{2}$/.test(String(value || ""));
}

function boundedNumber(value, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(max, Math.max(min, parsed));
}

export const getAppleHealthConnectionStatus = onCall({
  region: "asia-northeast3",
  memory: "128MiB",
  timeoutSeconds: 30,
}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Google 로그인 후 연결할 수 있어요.");
  const snapshot = await db.collection("appleHealthConnections").doc(request.auth.uid).get();
  if (!snapshot.exists || snapshot.data()?.revokedAt) return { connected: false };
  const data = snapshot.data();
  return {
    connected: true,
    createdAt: isoTimestamp(data.createdAt),
    lastImportAt: isoTimestamp(data.lastImportAt),
    lastImportDate: data.lastImportDate || undefined,
  };
});

export const createAppleHealthConnectionKey = onCall({
  region: "asia-northeast3",
  memory: "128MiB",
  timeoutSeconds: 30,
}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Google 로그인 후 연결할 수 있어요.");
  const token = `soya_health_${randomBytes(32).toString("base64url")}`;
  await db.collection("appleHealthConnections").doc(request.auth.uid).set({
    uid: request.auth.uid,
    tokenHash: healthTokenHash(token),
    createdAt: FieldValue.serverTimestamp(),
    revokedAt: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { token, endpoint: appleHealthEndpoint, createdAt: new Date().toISOString() };
});

export const revokeAppleHealthConnection = onCall({
  region: "asia-northeast3",
  memory: "128MiB",
  timeoutSeconds: 30,
}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Google 로그인 후 연결을 해제할 수 있어요.");
  await db.collection("appleHealthConnections").doc(request.auth.uid).set({
    tokenHash: FieldValue.delete(),
    revokedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { revoked: true };
});

export const importAppleHealth = onRequest({
  region: "asia-northeast3",
  memory: "256MiB",
  timeoutSeconds: 30,
}, async (request, response) => {
  if (request.method !== "POST") {
    response.status(405).json({ ok: false, error: "POST 요청만 사용할 수 있어요." });
    return;
  }
  const authorization = String(request.headers.authorization || "");
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) {
    response.status(401).json({ ok: false, error: "SOYA 연결 키가 필요해요." });
    return;
  }
  const connection = await db.collection("appleHealthConnections")
    .where("tokenHash", "==", healthTokenHash(token)).limit(1).get();
  if (connection.empty || connection.docs[0].data()?.revokedAt) {
    response.status(401).json({ ok: false, error: "연결 키를 확인해주세요." });
    return;
  }

  const connectionRef = connection.docs[0].ref;
  const uid = connection.docs[0].id;
  const suppliedDays = Array.isArray(request.body?.days) ? request.body.days : [request.body];
  const days = suppliedDays.slice(0, 31).filter((day) => validHealthDate(day?.date));
  if (!days.length) {
    response.status(400).json({ ok: false, error: "가져올 날짜와 건강 데이터를 확인해주세요." });
    return;
  }

  let importedActivities = 0;
  let importedWorkouts = 0;
  let protectedManualRecords = 0;
  let lastImportDate = "";

  for (const rawDay of days) {
    const date = String(rawDay.date);
    lastImportDate = date > lastImportDate ? date : lastImportDate;
    const steps = Math.round(boundedNumber(rawDay.steps, 0, 200000) ?? 0);
    const activeCalories = boundedNumber(rawDay.activeCalories, 0, 20000);
    const watchWorn = typeof rawDay.watchWorn === "boolean" ? rawDay.watchWorn : Boolean(activeCalories && activeCalories > 0);
    const activities = db.collection("users").doc(uid).collection("dailyActivities");
    const existingActivities = await activities.where("date", "==", date).get();
    const manualActivity = existingActivities.docs.find((entry) => entry.data().source !== "apple_health");
    const importedActivity = existingActivities.docs.find((entry) => entry.data().source === "apple_health");
    if (manualActivity) {
      protectedManualRecords += 1;
    } else {
      const value = {
        id: importedActivity?.id || `activity-health-${date.replaceAll("-", "")}`,
        date,
        watchWorn,
        steps,
        source: "apple_health",
        importedAt: new Date().toISOString(),
        ...(activeCalories && activeCalories > 0 ? { activeCalories: Math.round(activeCalories) } : {}),
      };
      await (importedActivity?.ref || activities.doc(value.id)).set(value);
      importedActivities += 1;
    }

    const rawWorkouts = Array.isArray(rawDay.workouts) ? rawDay.workouts.slice(0, 50) : [];
    const workouts = db.collection("users").doc(uid).collection("workouts");
    for (const rawWorkout of rawWorkouts) {
      const minutes = Math.round(boundedNumber(rawWorkout?.minutes, 1, 1440) ?? 0);
      const title = safeText(rawWorkout?.title, 100);
      if (!minutes || !title) continue;
      const startTime = /^\d{2}:\d{2}$/.test(String(rawWorkout?.startTime || "")) ? String(rawWorkout.startTime) : undefined;
      const externalId = safeText(rawWorkout?.id, 160) || createHash("sha256").update(`${date}|${startTime || ""}|${title}|${minutes}`).digest("hex").slice(0, 20);
      const importedId = `workout-health-${createHash("sha256").update(externalId).digest("hex").slice(0, 24)}`;
      const existingWorkout = await workouts.doc(importedId).get();
      const sameDayWorkouts = await workouts.where("date", "==", date).get();
      const matchingManualWorkout = sameDayWorkouts.docs.find((entry) => {
        const value = entry.data();
        return value.source !== "apple_health" && value.title === title && (value.startTime || "") === (startTime || "");
      });
      const workoutValue = {
        id: importedId,
        date,
        kind: "actual",
        type: rawWorkout?.type === "PT" ? "PT" : "유산소",
        title,
        minutes,
        intensity: Math.round(boundedNumber(rawWorkout?.intensity, 1, 10) ?? 5),
        heartRate: safeText(rawWorkout?.heartRate, 40),
        overlapsSteps: Boolean(rawWorkout?.overlapsSteps),
        details: safeText(rawWorkout?.details, 1000),
        source: "apple_health",
        externalId,
        importedAt: new Date().toISOString(),
        ...(startTime ? { startTime } : {}),
      };
      if (matchingManualWorkout) {
        protectedManualRecords += 1;
      } else if (!existingWorkout.exists || existingWorkout.data()?.source === "apple_health") {
        await workouts.doc(importedId).set(workoutValue);
        importedWorkouts += 1;
      } else {
        protectedManualRecords += 1;
      }
    }
  }

  await connectionRef.set({
    lastImportAt: FieldValue.serverTimestamp(),
    lastImportDate,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  await db.collection("users").doc(uid).set({ updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  response.status(200).json({ ok: true, importedActivities, importedWorkouts, protectedManualRecords, lastImportDate });
});

export const getAiUsageSummary = onCall({
  region: "asia-northeast3",
  memory: "128MiB",
  timeoutSeconds: 30,
}, async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Google 로그인 후 확인할 수 있어요.");
  const month = currentUsageMonth();
  const snapshot = await db.collection("aiUsage").doc(`${request.auth.uid}_${month}`).get();
  return { month, ...usageSummary(snapshot.data()) };
});

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

  const month = currentUsageMonth();
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
    return { text, source: "openai", model: "gpt-5.6-sol", reasoningEffort: "high", ...usageSummary({ count: used, inputTokens, outputTokens }) };
  } catch (error) {
    await usageRef.set({ count: FieldValue.increment(-1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    console.error("SOYA consultation failed", error);
    throw new HttpsError("internal", "지금은 상담을 불러오지 못했어요. 잠시 후 다시 시도해주세요.");
  }
});
