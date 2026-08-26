"use client";

import Image from "next/image";
import { FormEvent, isValidElement, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  BodyRecord,
  CircumferenceRecord,
  createFreshState,
  CycleEntry,
  DailyActivity,
  EntryKind,
  FoodLibraryItem,
  FoodUnit,
  GoalHistoryEntry,
  initialState,
  LoveRecord,
  MealFoodComponent,
  mealLabels,
  MealEntry,
  MealType,
  ReminderSettings,
  TrashItem,
  TrashPayload,
  TravelLevel,
  WorkoutEntry,
} from "./data";
import {
  observeGoogleUser,
  signInWithGoogle,
  signOutGoogleUser,
  type User,
} from "./firebase-client";
import { loadUserState, saveUserState } from "./firebase-state";
import { requestAiBodyImport, requestAiConsultation, requestAiUsageSummary, type AiBodyImportRecord, type AiUsageSummary } from "./firebase-ai";
import { prepareBodyMedia } from "./body-media";
import {
  createAppleHealthConnectionKey,
  getAppleHealthConnectionStatus,
  revokeAppleHealthConnection,
  type AppleHealthConnectionKey,
  type AppleHealthConnectionStatus,
} from "./firebase-health";
import {
  disablePushNotifications,
  enablePushNotifications,
  getPushStatus,
  observeNotificationClicks,
  observeForegroundNotifications,
  syncPushSubscription,
  type PushStatus,
  type PushSyncPayload,
} from "./firebase-notifications";

type Tab = "today" | "food" | "workout" | "menstrual" | "change";
type Modal = null | "quick" | "measurement-picker" | "movement-picker" | "body" | "body-bulk" | "body-detail" | "circumference" | "activity" | "apple-health" | "meal-plan" | "meal-actual" | "food-library" | "nutrition-goal" | "profile-goal" | "goal-complete" | "goal-history-detail" | "profile-settings" | "account" | "workout-plan" | "workout-actual" | "workout-goal" | "weekly-plan" | "cycle" | "love" | "consultation-detail" | "reminders" | "data-management" | "data-audit";
type Consultation = AppState["consultations"][number];
type WeeklyReview = NonNullable<AppState["weeklyReviews"]>[number];
type BleedingState = Exclude<CycleEntry["state"], "없음">;
type CycleRange = { id: string; start: string; end: string; states?: Record<string, BleedingState> };
type CycleHistory = {
  start: string;
  end: string;
  cycleLength?: number;
  mainBleedingDays: number;
  brownBefore: number;
  brownAfter: number;
  irregularDays: number;
};
type WeeklyWorkoutDraft = {
  id: string;
  startTime: string;
  type: WorkoutEntry["type"];
  title: string;
  minutes: string;
  intensity: number;
  heartRate: string;
  overlapsSteps: boolean;
  details: string;
};
type WeeklyDayDraft = { meals: Record<MealType, string[]>; workouts: WeeklyWorkoutDraft[] };
type WeeklyDraft = Record<string, WeeklyDayDraft>;
type OfficialFoodResult = {
  code: string;
  name: string;
  baseAmount: number;
  unit: FoodUnit;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  sugar: number;
  fiber: number;
  maker?: string;
};
type NutritionTotal = { calories: number; protein: number; carbs: number; fat: number; sugar: number; fiber: number };
type BulkBodyDraft = {
  rowId: string;
  date: string;
  time: string;
  weight: string;
  skeletalMuscle: string;
  bodyFatMass: string;
  bodyFatRate: string;
  visceralFat: string;
  measurementTiming: string;
  device: string;
};
type BackupEnvelope = { format: "SOYA_BACKUP"; version: 1; exportedAt: string; state: AppState };
type RestoreMode = "merge" | "replace";
type CsvKind = "body" | "circumference" | "meals" | "workouts" | "activity" | "cycles";
type GoalCompletionChoice = {
  outcome: NonNullable<AppState["goalHistory"]>[number]["outcome"];
  mode: AppState["profile"]["mode"];
  goalEndDate: string;
  targetBodyFatChange: number;
  targetMuscleChange: number;
  note: string;
};
type RecordAuditTarget =
  | { kind: "body"; record: BodyRecord }
  | { kind: "circumference"; record: CircumferenceRecord }
  | { kind: "meal"; record: MealEntry }
  | { kind: "meal-actual"; record: MealEntry }
  | { kind: "workout"; record: WorkoutEntry }
  | { kind: "workout-actual"; record: WorkoutEntry }
  | { kind: "activity"; record: DailyActivity }
  | { kind: "cycle"; date: string }
  | { kind: "love"; date: string }
  | { kind: "food-library" };
type RecordAuditIssue = { id: string; title: string; detail: string; target?: RecordAuditTarget; action?: string };
type RecordAuditResult = {
  duplicates: RecordAuditIssue[];
  cycles: RecordAuditIssue[];
  bodyChanges: RecordAuditIssue[];
  missingActuals: RecordAuditIssue[];
};

type AppleHealthSyncRange = { startDate: string; endDate: string };
type OnboardingDraft = {
  nickname: string;
  birthDate: string;
  heightCm: string;
  sex: NonNullable<AppState["profile"]["sex"]>;
  mode: AppState["profile"]["mode"];
  goalStartDate: string;
  goalEndDate: string;
  targetBodyFatChange: string;
  targetMuscleChange: string;
  nutritionGoal: Record<keyof AppState["nutritionGoal"], string>;
  cardioSessions: string;
  cardioMinutes: string;
  menstrualTrackingEnabled: boolean;
  remindersEnabled: boolean;
};
type NextAction =
  | { type: "body"; eyebrow: string; title: string; detail: string; time: string; due: boolean }
  | { type: "workout"; eyebrow: string; title: string; detail: string; time: string; due: boolean }
  | { type: "meal"; mealType: MealType; eyebrow: string; title: string; detail: string; time: string; due: boolean }
  | { type: "weekly"; eyebrow: string; title: string; detail: string; time: string; due: boolean }
  | { type: "done"; eyebrow: string; title: string; detail: string };

const defaultReminders = initialState.reminderSettings!;

const tabs: { id: Tab; label: string }[] = [
  { id: "food", label: "식단" },
  { id: "workout", label: "운동" },
  { id: "today", label: "홈" },
  { id: "menstrual", label: "월경" },
  { id: "change", label: "변화와 상담" },
];

const navIcons: Record<Tab, string> = {
  food: "/nav-food-v3-small.png",
  workout: "/nav-workout-v3-small.png",
  today: "/nav-home-v3-small.png",
  menstrual: "/nav-menstrual-v3-small.png",
  change: "/nav-consult-v3-small.png",
};

const roundNutrient = (value: number) => Math.round(value * 10) / 10;
const foodUnits: FoodUnit[] = ["g", "kg", "개", "인분"];
const conditionLabels = ["매우 적음", "적음", "보통", "많음", "매우 많음"];
const emptyNutrition = (): NutritionTotal => ({ calories: 0, protein: 0, carbs: 0, fat: 0, sugar: 0, fiber: 0 });
const mealNutrition = (meal: MealEntry): NutritionTotal => {
  if (meal.kind === "actual" || !meal.components?.length) return { calories: meal.calories, protein: meal.protein, carbs: meal.carbs, fat: meal.fat, sugar: meal.sugar, fiber: meal.fiber };
  return meal.components.reduce((sum, item) => ({
    calories: roundNutrient(sum.calories + item.calories), protein: roundNutrient(sum.protein + item.protein),
    carbs: roundNutrient(sum.carbs + item.carbs), fat: roundNutrient(sum.fat + item.fat),
    sugar: roundNutrient(sum.sugar + item.sugar), fiber: roundNutrient(sum.fiber + item.fiber),
  }), emptyNutrition());
};
const nutritionTotal = (meals: MealEntry[]) => meals.reduce((sum, meal) => {
  const value = mealNutrition(meal);
  return {
    calories: roundNutrient(sum.calories + value.calories), protein: roundNutrient(sum.protein + value.protein),
    carbs: roundNutrient(sum.carbs + value.carbs), fat: roundNutrient(sum.fat + value.fat),
    sugar: roundNutrient(sum.sugar + value.sugar), fiber: roundNutrient(sum.fiber + value.fiber),
  };
}, emptyNutrition());

function foodBasis(item: FoodLibraryItem): { amount: number; unit: FoodUnit } {
  if (item.baseAmount && item.unit) return { amount: item.baseAmount, unit: item.unit };
  const match = item.servingLabel?.trim().match(/^([\d.]+)\s*(kg|g|개|인분)$/);
  if (match) return { amount: Math.max(0.1, Number(match[1]) || 1), unit: match[2] as FoodUnit };
  return { amount: 1, unit: "인분" };
}

const foodBasisLabel = (item: FoodLibraryItem) => {
  const basis = foodBasis(item);
  return `${basis.amount}${basis.unit}`;
};

const normalizeFoodLibraryItem = (item: FoodLibraryItem): FoodLibraryItem => {
  const basis = foodBasis(item);
  return {
    ...item,
    kind: item.kind ?? "food",
    baseAmount: basis.amount,
    unit: basis.unit,
    servingLabel: `${basis.amount}${basis.unit}`,
  };
};

const todayKey = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
};

const appleHealthShortcutName = "SOYA 건강 보내기";
const appleHealthSyncPendingKey = "soya-apple-health-sync-pending";

const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const number = (value: FormDataEntryValue | null) => Number(value || 0);
const dateLabel = (value: string) => new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "long" }).format(new Date(`${value}T12:00:00`));
const monthLabel = (value: string) => new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long" }).format(new Date(`${value.slice(0, 7)}-01T12:00:00`));
const signed = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1)}`;

function moveToTrash(current: AppState, label: string, payload: TrashPayload): AppState {
  const trashItem: TrashItem = { id: id("trash"), deletedAt: new Date().toISOString(), label, payload };
  return { ...current, trash: [trashItem, ...(current.trash ?? [])].slice(0, 100) };
}

function normalizeCircumferenceRecord(value: unknown): CircumferenceRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<CircumferenceRecord> & { waistCm?: number; hipCm?: number };
  if (!record.id || !record.date) return null;
  const waistIn = Number(record.waistIn ?? (record.waistCm === undefined ? 0 : (record.waistCm / 2.54).toFixed(1)));
  const hipIn = Number(record.hipIn ?? (record.hipCm === undefined ? 0 : (record.hipCm / 2.54).toFixed(1)));
  return { id: record.id, date: record.date, waistIn, hipIn, note: record.note };
}

function normalizeAppState(value: unknown): AppState {
  const saved = value && typeof value === "object" ? value as Partial<AppState> : {};
  const savedProfile = saved.profile && typeof saved.profile === "object" ? saved.profile : initialState.profile;
  const savedMode = String(savedProfile.mode ?? initialState.profile.mode);
  const legacyTravel = savedMode === "여행";
  const hasExistingRecords = [saved.bodyRecords, saved.meals, saved.workouts, saved.cycles, saved.consultations]
    .some((records) => Array.isArray(records) && records.length > 0);
  const onboardingCompleted = typeof savedProfile.onboardingCompleted === "boolean"
    ? savedProfile.onboardingCompleted
    : hasExistingRecords || Boolean(savedProfile.nickname?.trim());
  const reminders = saved.reminderSettings && typeof saved.reminderSettings === "object" ? saved.reminderSettings : defaultReminders;
  const legacyCycleEnabled = reminders.cycleEnabled ?? defaultReminders.ovulationEnabled;
  const legacyCycleTime = reminders.cycleTime ?? defaultReminders.ovulationTime;
  const legacyLoveRecords: LoveRecord[] = (Array.isArray(saved.cycles) ? saved.cycles : [])
    .filter((entry) => (entry.sexCount ?? 0) > 0 && (entry.contraception === "피임함" || entry.contraception === "피임하지 않음"))
    .map((entry) => ({ id: `love-legacy-${entry.id}`, date: entry.date, count: entry.sexCount ?? 1, contraception: entry.contraception as LoveRecord["contraception"] }));
  return {
    ...initialState,
    ...saved,
    profile: {
      ...initialState.profile,
      ...savedProfile,
      onboardingCompleted,
      menstrualTrackingEnabled: savedProfile.menstrualTrackingEnabled ?? true,
      mode: savedMode === "유지기" ? "유지기" : "감량기",
      travelActive: savedProfile.travelActive ?? legacyTravel,
      travelStartDate: savedProfile.travelStartDate ?? (legacyTravel ? savedProfile.goalStartDate : undefined),
      travelEndDate: savedProfile.travelEndDate ?? (legacyTravel ? savedProfile.goalEndDate : undefined),
    },
    nutritionGoal: { ...initialState.nutritionGoal, ...(saved.nutritionGoal ?? {}) },
    workoutGoal: { ...initialState.workoutGoal!, ...(saved.workoutGoal ?? {}) },
    bodyRecords: Array.isArray(saved.bodyRecords) ? saved.bodyRecords : [],
    circumferenceRecords: Array.isArray(saved.circumferenceRecords) ? saved.circumferenceRecords.map(normalizeCircumferenceRecord).filter((record): record is CircumferenceRecord => Boolean(record)) : [],
    foodLibrary: (Array.isArray(saved.foodLibrary) ? saved.foodLibrary : []).map(normalizeFoodLibraryItem),
    meals: Array.isArray(saved.meals) ? saved.meals : [],
    workouts: Array.isArray(saved.workouts) ? saved.workouts : [],
    dailyActivities: Array.isArray(saved.dailyActivities) ? saved.dailyActivities : [],
    cycles: Array.isArray(saved.cycles) ? saved.cycles : [],
    loveRecords: Array.isArray(saved.loveRecords) ? saved.loveRecords : legacyLoveRecords,
    consultations: Array.isArray(saved.consultations) ? saved.consultations : [],
    weeklyReviews: Array.isArray(saved.weeklyReviews) ? saved.weeklyReviews : [],
    goalHistory: Array.isArray(saved.goalHistory) ? saved.goalHistory : [],
    trash: Array.isArray(saved.trash) ? saved.trash : [],
    reminderSettings: {
      ...defaultReminders,
      ...reminders,
      ovulationEnabled: reminders.ovulationEnabled ?? legacyCycleEnabled,
      ovulationTime: reminders.ovulationTime ?? legacyCycleTime,
      periodEnabled: reminders.periodEnabled ?? legacyCycleEnabled,
      periodTime: reminders.periodTime ?? legacyCycleTime,
      latePeriodEnabled: reminders.latePeriodEnabled ?? legacyCycleEnabled,
      latePeriodTime: reminders.latePeriodTime ?? legacyCycleTime,
      mealEnabled: { ...defaultReminders.mealEnabled, ...reminders.mealEnabled },
      mealTimes: { ...defaultReminders.mealTimes, ...reminders.mealTimes },
    },
    skippedTasks: Array.isArray(saved.skippedTasks) ? saved.skippedTasks : [],
  };
}

function parseBackup(value: unknown): AppState | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<BackupEnvelope> & Partial<AppState>;
  const source = candidate.format === "SOYA_BACKUP" && candidate.state ? candidate.state : candidate;
  if (!source || typeof source !== "object") return null;
  if (!Array.isArray(source.bodyRecords) || !Array.isArray(source.meals) || !Array.isArray(source.workouts) || !Array.isArray(source.cycles) || !Array.isArray(source.consultations)) return null;
  return normalizeAppState(source);
}

function mergeById<T extends { id: string }>(current: T[], imported: T[]) {
  const merged = new Map(current.map((item) => [item.id, item]));
  imported.forEach((item) => merged.set(item.id, item));
  return [...merged.values()];
}

function mergeAppState(current: AppState, imported: AppState): AppState {
  return normalizeAppState({
    ...current,
    bodyRecords: mergeById(current.bodyRecords, imported.bodyRecords),
    circumferenceRecords: mergeById(current.circumferenceRecords ?? [], imported.circumferenceRecords ?? []),
    foodLibrary: mergeById(current.foodLibrary ?? [], imported.foodLibrary ?? []),
    meals: mergeById(current.meals, imported.meals),
    workouts: mergeById(current.workouts, imported.workouts),
    dailyActivities: mergeById(current.dailyActivities ?? [], imported.dailyActivities ?? []),
    cycles: mergeById(current.cycles, imported.cycles),
    loveRecords: mergeById(current.loveRecords ?? [], imported.loveRecords ?? []),
    consultations: mergeById(current.consultations, imported.consultations),
    weeklyReviews: mergeById(current.weeklyReviews ?? [], imported.weeklyReviews ?? []),
    goalHistory: mergeById(current.goalHistory ?? [], imported.goalHistory ?? []),
    trash: mergeById(current.trash ?? [], imported.trash ?? []),
    skippedTasks: [...new Set([...current.skippedTasks, ...imported.skippedTasks])],
  });
}

function restoreTrashItem(current: AppState, item: TrashItem): AppState {
  return normalizeAppState({
    ...current,
    bodyRecords: mergeById(current.bodyRecords, item.payload.bodyRecords ?? []),
    circumferenceRecords: mergeById(current.circumferenceRecords ?? [], item.payload.circumferenceRecords ?? []),
    foodLibrary: mergeById(current.foodLibrary ?? [], item.payload.foodLibrary ?? []),
    meals: mergeById(current.meals, item.payload.meals ?? []),
    workouts: mergeById(current.workouts, item.payload.workouts ?? []),
    dailyActivities: mergeById(current.dailyActivities ?? [], item.payload.dailyActivities ?? []),
    cycles: normalizeCycleCoverage(mergeById(current.cycles, item.payload.cycles ?? [])),
    loveRecords: mergeById(current.loveRecords ?? [], item.payload.loveRecords ?? []),
    consultations: mergeById(current.consultations, item.payload.consultations ?? []),
    weeklyReviews: mergeById(current.weeklyReviews ?? [], item.payload.weeklyReviews ?? []),
    trash: (current.trash ?? []).filter((entry) => entry.id !== item.id),
  });
}

function downloadFile(contents: string, filename: string, type: string) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function csvCell(value: string | number | boolean | undefined) {
  let text = value === undefined ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function exportCsv(state: AppState, kind: CsvKind, today: string) {
  const labels: Record<CsvKind, string> = { body: "체성분", circumference: "신체둘레", meals: "식단", workouts: "운동", activity: "하루활동", cycles: "월경" };
  let rows: (string | number | boolean | undefined)[][] = [];
  if (kind === "body") rows = [
    ["날짜", "시간", "체중(kg)", "골격근량(kg)", "체지방량(kg)", "체지방률(%)", "내장지방레벨", "측정 시점", "측정 기기"],
    ...state.bodyRecords.map((item) => [item.date, item.time, item.weight, item.skeletalMuscle, item.bodyFatMass, item.bodyFatRate, item.visceralFat, item.measurementTiming, item.device]),
  ];
  if (kind === "circumference") rows = [
    ["날짜", "허리둘레(inch)", "엉덩이둘레(inch)", "메모"],
    ...(state.circumferenceRecords ?? []).map((item) => [item.date, item.waistIn, item.hipIn, item.note]),
  ];
  if (kind === "meals") rows = [
    ["날짜", "끼니", "구분", "음식", "섭취 없음", "칼로리(kcal)", "단백질(g)", "탄수화물(g)", "지방(g)", "당류(g)", "식이섬유(g)"],
    ...state.meals.map((item) => [item.date, mealLabels[item.mealType], item.kind === "plan" ? "계획" : "기록", item.title, Boolean(item.skipped), item.calories, item.protein, item.carbs, item.fat, item.sugar, item.fiber]),
  ];
  if (kind === "workouts") rows = [
    ["날짜", "구분", "운동 종류", "운동 이름", "시간(분)", "체감 강도", "평균 심박수", "걸음 수 중복", "운동 내용"],
    ...state.workouts.map((item) => [item.date, item.kind === "plan" ? "계획" : "기록", item.type, item.title, item.minutes, item.intensity, item.heartRate, Boolean(item.overlapsSteps), item.details]),
  ];
  if (kind === "activity") rows = [
    ["날짜", "애플워치 착용", "걸음 수", "활동에너지(kcal)", "메모"],
    ...(state.dailyActivities ?? []).map((item) => [item.date, item.watchWorn, item.steps, item.activeCalories, item.note]),
  ];
  if (kind === "cycles") rows = [
    ["날짜", "출혈 상태", "양", "통증", "에너지", "식욕", "증상", "사랑 기록 횟수", "피임", "메모"],
    ...state.cycles.map((item) => [item.date, item.state, item.flow, item.pain, item.energy, item.appetite, (item.symptoms ?? []).join(" · "), item.sexCount, item.contraception, item.note]),
  ];
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
  downloadFile(csv, `SOYA-${labels[kind]}-${today}.csv`, "text/csv;charset=utf-8");
}

function cycleSummary(entry: CycleEntry) {
  const details = [
    entry.state === "없음" ? "출혈 없음" : entry.state,
    entry.flow && entry.flow !== "없음" ? `양 ${entry.flow}` : "",
    entry.pain && entry.pain !== "없음" ? `통증 ${entry.pain}` : "",
    ...(entry.symptoms ?? []),
  ].filter(Boolean);
  return details.join(" · ");
}

function daysBetween(start: string, end: string) {
  return Math.round((new Date(`${end}T12:00:00`).getTime() - new Date(`${start}T12:00:00`).getTime()) / 86_400_000);
}

function median(values: number[]) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function menstrualPrediction(entries: CycleEntry[], today: string) {
  const byDate = new Map(entries.map((entry) => [entry.date, entry]));
  const starts = entries
    .filter((entry) => entry.state === "본 출혈" && byDate.get(addDays(entry.date, -1))?.state !== "본 출혈")
    .map((entry) => entry.date)
    .sort();
  const intervals = starts.slice(1).map((date, index) => daysBetween(starts[index], date)).slice(-7);
  const cycleLength = Math.round(median(intervals) ?? 28);
  const lastStart = starts.at(-1);
  const fertileDates = new Set<string>();
  const ovulationDates = new Set<string>();
  if (!lastStart) return { cycleLength, lastStart: undefined, nextPeriod: undefined, nextOvulation: undefined, periodPredictions: [] as string[], ovulationPredictions: [] as string[], fertileDates, ovulationDates, basedOnCycles: 0 };
  let nextPeriod = addDays(lastStart, cycleLength);
  while (nextPeriod <= today) nextPeriod = addDays(nextPeriod, cycleLength);
  let nextOvulation = addDays(nextPeriod, -14);
  if (nextOvulation < today) {
    nextOvulation = addDays(nextPeriod, cycleLength - 14);
  }
  const periodPredictions = [nextPeriod, addDays(nextPeriod, cycleLength)];
  const previousOvulation = addDays(nextOvulation, -cycleLength);
  const ovulationPredictions = [previousOvulation, nextOvulation, addDays(nextOvulation, cycleLength)];
  for (const ovulation of ovulationPredictions) {
    ovulationDates.add(ovulation);
    for (let offset = -5; offset <= 1; offset += 1) fertileDates.add(addDays(ovulation, offset));
  }
  return { cycleLength, lastStart, nextPeriod, nextOvulation, periodPredictions, ovulationPredictions, fertileDates, ovulationDates, basedOnCycles: intervals.length };
}

type MenstrualPhase = {
  key: "record-needed" | "bleeding" | "focus" | "ovulation" | "premenstrual" | "middle";
  label: string;
  detail: string;
  cycleDay?: number;
};

function menstrualPhase(entries: CycleEntry[], date: string): MenstrualPhase {
  const entriesToDate = entries.filter((entry) => entry.date <= date);
  const prediction = menstrualPrediction(entriesToDate, date);
  if (!prediction.lastStart) {
    return { key: "record-needed", label: "주기 기록이 필요해요", detail: "본 출혈 시작일을 기록하면 주기 구간을 계산해요." };
  }

  const current = entries.find((entry) => entry.date === date);
  const cycleDay = Math.max(1, daysBetween(prediction.lastStart, date) + 1);
  if (current?.state === "본 출혈") {
    return { key: "bleeding", label: "월경 중", detail: `주기 ${cycleDay}일차 · 오늘의 에너지와 통증을 함께 살펴봐요.`, cycleDay };
  }

  const currentCycleBleeding = entriesToDate
    .filter((entry) => entry.state === "본 출혈" && entry.date >= prediction.lastStart)
    .map((entry) => entry.date)
    .sort();
  const lastBleedingDate = currentCycleBleeding.at(-1) ?? prediction.lastStart;
  const daysAfterBleeding = daysBetween(lastBleedingDate, date);
  if (prediction.fertileDates.has(date)) {
    return { key: "ovulation", label: prediction.ovulationDates.has(date) ? "배란 예상일" : "배란 예상 구간", detail: `주기 ${cycleDay}일차 · 기록을 바탕으로 계산한 예상 구간이에요.`, cycleDay };
  }

  if (daysAfterBleeding >= 1 && daysAfterBleeding <= 7) {
    return { key: "focus", label: "월경 후 집중 관찰", detail: `주기 ${cycleDay}일차 · SOYA가 체성분 흐름을 집중해서 보여주는 구간이에요.`, cycleDay };
  }

  const daysToNextPeriod = prediction.nextPeriod ? daysBetween(date, prediction.nextPeriod) : undefined;
  if (daysToNextPeriod !== undefined && daysToNextPeriod >= 0 && daysToNextPeriod <= 7) {
    return { key: "premenstrual", label: "월경 전 영향권", detail: `예상 월경 ${daysToNextPeriod === 0 ? "당일" : `${daysToNextPeriod}일 전`} · 체성분과 식욕·에너지를 함께 봐요.`, cycleDay };
  }

  return { key: "middle", label: "주기 중간", detail: `주기 ${cycleDay}일차 · 평소 흐름과 비교해 기록해요.`, cycleDay };
}

function monthCells(anchor: string) {
  const [year, month] = anchor.split("-").map(Number);
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const days = new Date(year, month, 0).getDate();
  return [...Array(firstWeekday).fill(null), ...Array.from({ length: days }, (_, index) => `${year}-${String(month).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`)] as (string | null)[];
}

function shiftMonth(value: string, amount: number) {
  const [year, month] = value.split("-").map(Number);
  const next = new Date(year, month - 1 + amount, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
}

const dateKey = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;

function weekStart(value: string, offsetWeeks = 0) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7) + offsetWeeks * 7);
  return dateKey(date);
}

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return dateKey(date);
}

function timeBefore(time: string, minutesBefore: number) {
  const [hour, minute] = time.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return time;
  const minutes = (hour * 60 + minute - minutesBefore + 24 * 60) % (24 * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function pushSyncPayload(state: AppState, today: string): PushSyncPayload {
  const todayMeals = state.meals.filter((entry) => entry.date === today && entry.kind === "actual");
  const todayWorkouts = state.workouts.filter((entry) => entry.date === today);
  const nextWeekStart = weekStart(today, 1);
  const nextWeekEnd = addDays(nextWeekStart, 6);
  const prediction = menstrualPrediction(state.cycles, today);
  const reminderSettings = state.reminderSettings ?? defaultReminders;
  const latePeriodDays = Math.max(1, Number(reminderSettings.latePeriodDays) || defaultReminders.latePeriodDays);
  let expectedPeriod = prediction.lastStart ? addDays(prediction.lastStart, prediction.cycleLength) : undefined;
  while (expectedPeriod && addDays(expectedPeriod, latePeriodDays) < today) expectedPeriod = addDays(expectedPeriod, prediction.cycleLength);

  return {
    settings: reminderSettings,
    workoutPlans: state.workouts
      .filter((entry) => entry.kind === "plan" && entry.date >= today && entry.date <= addDays(today, 30))
      .map((entry) => ({ id: entry.id, date: entry.date, title: entry.title, startTime: entry.startTime })),
    workoutActualDates: [...new Set(state.workouts.filter((entry) => entry.kind === "actual" && entry.date >= addDays(today, -1)).map((entry) => entry.date))],
    completion: {
      date: today,
      body: state.bodyRecords.some((entry) => entry.date === today),
      meals: {
        breakfast: todayMeals.some((entry) => entry.mealType === "breakfast"),
        lunch: todayMeals.some((entry) => entry.mealType === "lunch"),
        dinner: todayMeals.some((entry) => entry.mealType === "dinner"),
      },
      workoutPlanned: todayWorkouts.some((entry) => entry.kind === "plan"),
      workout: todayWorkouts.some((entry) => entry.kind === "actual"),
      nextWeekPlanned: state.meals.some((entry) => entry.kind === "plan" && entry.date >= nextWeekStart && entry.date <= nextWeekEnd)
        || state.workouts.some((entry) => entry.kind === "plan" && entry.date >= nextWeekStart && entry.date <= nextWeekEnd),
    },
    travel: {
      active: Boolean(state.profile.travelActive),
      startDate: state.profile.travelStartDate,
      endDate: state.profile.travelEndDate,
    },
    cycle: {
      nextPeriod: expectedPeriod,
      nextOvulation: expectedPeriod ? addDays(expectedPeriod, -14) : undefined,
    },
  };
}

function cycleRangeDates(start: string, end: string) {
  const length = daysBetween(start, end);
  return length < 0 ? [] : Array.from({ length: length + 1 }, (_, index) => addDays(start, index));
}

function normalizeCycleCoverage(entries: CycleEntry[]) {
  const mainBleedingDates = entries.filter((entry) => entry.state === "본 출혈").map((entry) => entry.date).sort();
  const firstRecordedCycle = mainBleedingDates[0];
  const lastRecordedCycle = mainBleedingDates.at(-1);
  const retained = entries.filter((entry) => entry.source !== "period-fill" || (
    firstRecordedCycle && lastRecordedCycle && entry.date >= firstRecordedCycle && entry.date <= lastRecordedCycle
  ));
  if (!firstRecordedCycle || !lastRecordedCycle) return retained.sort((a, b) => a.date.localeCompare(b.date));

  const occupiedDates = new Set(retained.map((entry) => entry.date));
  const noBleedingEntries = cycleRangeDates(firstRecordedCycle, lastRecordedCycle)
    .filter((date) => !occupiedDates.has(date))
    .map((date): CycleEntry => ({
      id: id("cycle-fill"), date, state: "없음", flow: "없음", pain: "없음",
      symptoms: [], sexCount: 0, contraception: "해당 없음", note: "", source: "period-fill",
    }));
  return [...retained, ...noBleedingEntries].sort((a, b) => a.date.localeCompare(b.date));
}

function cycleRangeAround(entries: CycleEntry[], date: string): CycleRange | undefined {
  const selected = entries.find((entry) => entry.date === date);
  if (!selected || selected.state === "없음") return undefined;
  const periodEntries = selected.periodId
    ? entries.filter((entry) => entry.periodId === selected.periodId && entry.state !== "없음")
    : (() => {
      let start = date;
      let end = date;
      while (entries.some((entry) => entry.date === addDays(start, -1) && entry.state !== "없음")) start = addDays(start, -1);
      while (entries.some((entry) => entry.date === addDays(end, 1) && entry.state !== "없음")) end = addDays(end, 1);
      return entries.filter((entry) => entry.date >= start && entry.date <= end && entry.state !== "없음");
    })();
  const dates = periodEntries.map((entry) => entry.date).sort();
  if (!dates.length) return undefined;
  return {
    id: selected.periodId ?? id("cycle-range"),
    start: dates[0],
    end: dates.at(-1)!,
    states: Object.fromEntries(periodEntries.map((entry) => [entry.date, entry.state as BleedingState])),
  };
}

function cycleHistories(entries: CycleEntry[]): CycleHistory[] {
  const byDate = new Map(entries.map((entry) => [entry.date, entry]));
  const starts = entries
    .filter((entry) => entry.state === "본 출혈" && byDate.get(addDays(entry.date, -1))?.state !== "본 출혈")
    .map((entry) => entry.date)
    .sort();

  return starts.map((start, index) => {
    const nextStart = starts[index + 1];
    let brownBefore = 0;
    let cursor = addDays(start, -1);
    while (byDate.get(cursor)?.state === "갈색 출혈") {
      brownBefore += 1;
      cursor = addDays(cursor, -1);
    }

    let end = start;
    cursor = start;
    while (byDate.get(cursor) && byDate.get(cursor)?.state !== "없음") {
      end = cursor;
      cursor = addDays(cursor, 1);
    }
    const bleedingEntries = entries.filter((entry) => entry.date >= start && entry.date <= end);
    const intervalEnd = nextStart ? addDays(nextStart, -1) : end;
    return {
      start,
      end,
      cycleLength: nextStart ? daysBetween(start, nextStart) : undefined,
      mainBleedingDays: bleedingEntries.filter((entry) => entry.state === "본 출혈").length,
      brownBefore,
      brownAfter: bleedingEntries.filter((entry) => entry.state === "갈색 출혈").length,
      irregularDays: entries.filter((entry) => entry.date >= start && entry.date <= intervalEnd && entry.state === "부정출혈").length,
    };
  }).reverse();
}

const auditText = (value: string | undefined) => (value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ko-KR");

function auditDateIsValid(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00`);
  return !Number.isNaN(parsed.getTime()) && dateKey(parsed) === value;
}

function recordAuditFor(state: AppState, today: string): RecordAuditResult {
  const duplicates: RecordAuditIssue[] = [];
  const cycles: RecordAuditIssue[] = [];
  const bodyChanges: RecordAuditIssue[] = [];
  const missingActuals: RecordAuditIssue[] = [];

  const duplicateGroups = <T,>(items: T[], keyFor: (item: T) => string, describe: (items: T[]) => RecordAuditIssue) => {
    const groups = new Map<string, T[]>();
    items.forEach((item) => {
      const key = keyFor(item);
      groups.set(key, [...(groups.get(key) ?? []), item]);
    });
    groups.forEach((group) => { if (group.length > 1) duplicates.push(describe(group)); });
  };

  duplicateGroups(state.bodyRecords, (item) => item.date, (group) => ({
    id: `body-${group[0].date}`,
    title: `${group[0].date} 체성분 ${group.length}건`,
    detail: "같은 날짜에 체성분 기록이 여러 개 있어요.",
    target: { kind: "body", record: group[1] }, action: "확인",
  }));
  duplicateGroups(state.circumferenceRecords ?? [], (item) => item.date, (group) => ({
    id: `circumference-${group[0].date}`,
    title: `${group[0].date} 둘레 기록 ${group.length}건`,
    detail: "같은 날짜에 허리·엉덩이 둘레 기록이 여러 개 있어요.",
    target: { kind: "circumference", record: group[1] }, action: "확인",
  }));
  duplicateGroups(state.dailyActivities ?? [], (item) => item.date, (group) => ({
    id: `activity-${group[0].date}`,
    title: `${group[0].date} 하루 활동 ${group.length}건`,
    detail: "같은 날짜에 하루 활동 기록이 여러 개 있어요.",
    target: { kind: "activity", record: group[1] }, action: "확인",
  }));
  duplicateGroups(state.cycles, (item) => item.date, (group) => ({
    id: `cycle-${group[0].date}`,
    title: `${group[0].date} 월경·컨디션 ${group.length}건`,
    detail: "같은 날짜에 월경·컨디션 기록이 여러 개 있어요.",
    target: { kind: "cycle", date: group[0].date }, action: "확인",
  }));
  duplicateGroups(state.loveRecords ?? [], (item) => item.date, (group) => ({
    id: `love-${group[0].date}`,
    title: `${group[0].date} 사랑 기록 ${group.length}건`,
    detail: "같은 날짜에 사랑 기록이 여러 개 있어요.",
    target: { kind: "love", date: group[0].date }, action: "확인",
  }));
  duplicateGroups(state.foodLibrary ?? [], (item) => auditText(item.name), (group) => ({
    id: `food-${group[0].id}`,
    title: `‘${group[0].name}’ ${group.length}개`,
    detail: "음식 보관함에 이름이 같은 항목이 있어요.",
    target: { kind: "food-library" }, action: "보관함 열기",
  }));

  const componentSignature = (components: MealFoodComponent[] | undefined) => (components ?? []).map((item) => [
    auditText(item.name), item.quantity ?? "", item.unit ?? "", item.calories, item.protein, item.carbs, item.fat, item.sugar, item.fiber,
  ]);
  duplicateGroups(state.meals, (item) => JSON.stringify([
    item.date, item.mealType, item.kind, auditText(item.title), item.calories, item.protein, item.carbs, item.fat, item.sugar, item.fiber,
    item.skipped ?? false, componentSignature(item.components),
  ]), (group) => ({
    id: `meal-${group[0].id}`,
    title: `${group[0].date} ${mealLabels[group[0].mealType]} ${group[0].kind === "plan" ? "계획" : "기록"} ${group.length}건`,
    detail: `‘${group[0].title || "내용 없음"}’이(가) 똑같이 저장되어 있어요.`,
    target: { kind: "meal", record: group[1] }, action: "확인",
  }));
  duplicateGroups(state.workouts, (item) => JSON.stringify([
    item.date, item.kind, item.type, auditText(item.title), item.minutes, item.intensity, item.heartRate ?? "", item.overlapsSteps ?? false, auditText(item.details),
  ]), (group) => ({
    id: `workout-${group[0].id}`,
    title: `${group[0].date} ${group[0].kind === "plan" ? "운동 계획" : "한 운동"} ${group.length}건`,
    detail: `‘${group[0].title || group[0].type}’이(가) 똑같이 저장되어 있어요.`,
    target: { kind: "workout", record: group[1] }, action: "확인",
  }));

  state.cycles.filter((item) => !auditDateIsValid(item.date)).forEach((item) => cycles.push({
    id: `cycle-invalid-${item.id}`,
    title: "날짜를 읽을 수 없는 월경 기록",
    detail: `저장된 날짜 ‘${item.date}’을 확인해주세요.`,
  }));
  const periodRanges = [...new Set(state.cycles.filter((item) => item.periodId && item.state !== "없음" && auditDateIsValid(item.date)).map((item) => item.periodId!))]
    .map((periodId) => {
      const entries = state.cycles.filter((item) => item.periodId === periodId && item.state !== "없음").sort((a, b) => a.date.localeCompare(b.date));
      return { periodId, start: entries[0].date, end: entries.at(-1)!.date };
    }).sort((a, b) => a.start.localeCompare(b.start));
  for (let index = 1; index < periodRanges.length; index += 1) {
    const previous = periodRanges[index - 1];
    const current = periodRanges[index];
    if (current.start <= previous.end) cycles.push({
      id: `cycle-overlap-${previous.periodId}-${current.periodId}`,
      title: `${current.start} 주기 날짜 확인`,
      detail: `${previous.start}~${previous.end} 기록과 ${current.start}~${current.end} 기록이 서로 겹쳐요.`,
      target: { kind: "cycle", date: current.start }, action: "확인",
    });
  }

  const bodySorted = [...state.bodyRecords].filter((item) => auditDateIsValid(item.date)).sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
  const changeRules: Array<{ key: keyof Pick<BodyRecord, "weight" | "bodyFatMass" | "skeletalMuscle" | "bodyFatRate" | "visceralFat">; label: string; limit: number; unit: string }> = [
    { key: "weight", label: "체중", limit: 2.5, unit: "kg" },
    { key: "bodyFatMass", label: "체지방량", limit: 2, unit: "kg" },
    { key: "skeletalMuscle", label: "골격근량", limit: 1.2, unit: "kg" },
    { key: "bodyFatRate", label: "체지방률", limit: 3, unit: "%p" },
    { key: "visceralFat", label: "내장지방레벨", limit: 3, unit: "Lv" },
  ];
  for (let index = 1; index < bodySorted.length; index += 1) {
    const previous = bodySorted[index - 1];
    const current = bodySorted[index];
    const interval = daysBetween(previous.date, current.date);
    if (interval < 1 || interval > 7) continue;
    const changes = changeRules.filter((rule) => previous[rule.key] > 0 && current[rule.key] > 0 && Math.abs(current[rule.key] - previous[rule.key]) >= rule.limit);
    if (!changes.length) continue;
    bodyChanges.push({
      id: `body-change-${current.id}`,
      title: `${current.date} 체성분 변화 확인`,
      detail: changes.map((rule) => `${rule.label} ${current[rule.key] >= previous[rule.key] ? "+" : ""}${roundNutrient(current[rule.key] - previous[rule.key])}${rule.unit}`).join(" · "),
      target: { kind: "body", record: current }, action: "측정값 확인",
    });
  }

  const goalStart = state.profile.goalStartDate && state.profile.goalStartDate < today ? state.profile.goalStartDate : addDays(today, -90);
  const auditStart = goalStart > addDays(today, -90) ? goalStart : addDays(today, -90);
  const pastPlans = state.meals.filter((item) => item.kind === "plan" && item.date >= auditStart && item.date < today);
  const mealPlanGroups = new Map<string, MealEntry[]>();
  pastPlans.forEach((item) => {
    const key = `${item.date}-${item.mealType}`;
    mealPlanGroups.set(key, [...(mealPlanGroups.get(key) ?? []), item]);
  });
  mealPlanGroups.forEach((plans) => {
    const first = plans[0];
    const hasActual = state.meals.some((item) => item.kind === "actual" && item.date === first.date && item.mealType === first.mealType);
    if (!hasActual) missingActuals.push({
      id: `missing-meal-${first.date}-${first.mealType}`,
      title: `${first.date} ${mealLabels[first.mealType]} 기록 없음`,
      detail: plans.map((item) => item.title).filter(Boolean).join(" · ") || "식사 계획은 저장되어 있어요.",
      target: { kind: "meal-actual", record: first }, action: "기록하기",
    });
  });
  const pastWorkoutPlans = state.workouts.filter((item) => item.kind === "plan" && item.date >= auditStart && item.date < today);
  pastWorkoutPlans.forEach((plan) => {
    const sameDayTypePlans = pastWorkoutPlans.filter((item) => item.date === plan.date && item.type === plan.type);
    const sameDayActuals = state.workouts.filter((item) => item.kind === "actual" && item.date === plan.date);
    const matched = sameDayActuals.some((actual) => auditText(actual.title) === auditText(plan.title) && actual.type === plan.type)
      || (sameDayTypePlans.length === 1 && sameDayActuals.some((actual) => actual.type === plan.type));
    if (!matched) missingActuals.push({
      id: `missing-workout-${plan.id}`,
      title: `${plan.date} 운동 기록 없음`,
      detail: `${plan.type} · ${plan.title || "운동 계획"}${plan.minutes ? ` · ${plan.minutes}분` : ""}`,
      target: { kind: "workout-actual", record: plan }, action: "기록하기",
    });
  });

  return { duplicates, cycles, bodyChanges, missingActuals };
}

function recordAuditCount(state: AppState, today: string) {
  const audit = recordAuditFor(state, today);
  return audit.duplicates.length + audit.cycles.length + audit.bodyChanges.length + audit.missingActuals.length;
}

function weekDates(start: string) {
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

function createWeeklyDraft(state: AppState, start: string): WeeklyDraft {
  return Object.fromEntries(weekDates(start).map((date) => {
    const meals = Object.fromEntries((Object.keys(mealLabels) as MealType[]).map((mealType) => {
      const titles = state.meals.filter((item) => item.date === date && item.kind === "plan" && item.mealType === mealType).map((item) => item.title);
      return [mealType, titles.length ? titles : [""]];
    })) as Record<MealType, string[]>;
    const workouts = state.workouts.filter((item) => item.date === date && item.kind === "plan").map((item) => ({
      id: item.id, startTime: item.startTime ?? "", type: item.type, title: item.title, minutes: String(item.minutes || ""), intensity: typeof item.intensity === "number" ? item.intensity : 5,
      heartRate: item.heartRate ?? "", overlapsSteps: Boolean(item.overlapsSteps), details: item.details,
    }));
    return [date, { meals, workouts }];
  }));
}

function MonthNavigator({ value, onChange, onToday }: { value: string; onChange: (value: string) => void; onToday?: () => void }) {
  const [open, setOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(Number(value.slice(0, 4)));
  const openPicker = () => {
    setPickerYear(Number(value.slice(0, 4)));
    setOpen((current) => !current);
  };

  return <div className="month-navigator">
    <button type="button" className="month-arrow" onClick={() => onChange(shiftMonth(value, -1))} aria-label="이전 달">‹</button>
    <button type="button" className="month-current" onClick={openPicker} aria-expanded={open}>{monthLabel(`${value}-01`)} <span>▼</span></button>
    <button type="button" className="month-arrow" onClick={() => onChange(shiftMonth(value, 1))} aria-label="다음 달">›</button>
    <button type="button" className="month-today" onClick={() => { onChange(todayKey().slice(0, 7)); onToday?.(); setOpen(false); }} aria-label="오늘 날짜로 이동">TODAY</button>
    {open && <div className="month-panel">
      <div className="year-row"><button type="button" onClick={() => setPickerYear((year) => year - 1)} aria-label="이전 연도">‹</button><strong>{pickerYear}년</strong><button type="button" onClick={() => setPickerYear((year) => year + 1)} aria-label="다음 연도">›</button></div>
      <div className="month-options">{Array.from({ length: 12 }, (_, index) => {
        const month = `${pickerYear}-${String(index + 1).padStart(2, "0")}`;
        return <button type="button" className={month === value ? "active" : ""} key={month} onClick={() => { onChange(month); setOpen(false); }}>{index + 1}월</button>;
      })}</div>
    </div>}
  </div>;
}

function weeklyCardio(state: AppState, anchor: string) {
  const date = new Date(`${anchor}T12:00:00`);
  const mondayOffset = (date.getDay() + 6) % 7;
  const monday = new Date(date);
  monday.setDate(date.getDate() - mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const key = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  const entries = state.workouts.filter((item) => item.kind === "actual" && item.type === "유산소" && item.date >= key(monday) && item.date <= key(sunday));
  return { sessions: entries.length, minutes: entries.reduce((sum, item) => sum + item.minutes, 0) };
}

function goalTiming(profile: AppState["profile"], today: string) {
  const startKey = profile.goalStartDate ?? today;
  const start = new Date(`${startKey}T12:00:00`).getTime();
  const end = new Date(`${profile.goalEndDate}T12:00:00`).getTime();
  const now = new Date(`${today}T12:00:00`).getTime();
  const day = 86_400_000;
  const totalDays = Math.max(1, Math.round((end - start) / day));
  const elapsedDays = Math.max(0, Math.round((now - start) / day));
  return {
    startKey,
    week: Math.max(1, Math.floor(elapsedDays / 7) + 1),
    daysLeft: Math.max(0, Math.ceil((end - now) / day)),
    progress: Math.min(100, Math.max(0, elapsedDays / totalDays * 100)),
  };
}

function travelLevelForDate(profile: AppState["profile"], date: string): TravelLevel {
  return profile.travelDailyLevels?.[date] ?? profile.travelLevel ?? "균형 유지";
}

function isTravelDate(profile: AppState["profile"], date: string) {
  if (!profile.travelActive) return false;
  if (profile.travelStartDate && date < profile.travelStartDate) return false;
  if (profile.travelEndDate && date > profile.travelEndDate) return false;
  return true;
}

type DailyEnergyGuide = {
  activity?: DailyActivity;
  restingCalories: number;
  activityCalories: number;
  expenditure: number;
  intakeMin: number;
  intakeMax: number;
  source: "health" | "estimate" | "default";
};

function ageOnDate(birthDate: string | undefined, date: string) {
  if (!birthDate) return undefined;
  const birth = new Date(`${birthDate}T12:00:00`);
  const target = new Date(`${date}T12:00:00`);
  let age = target.getFullYear() - birth.getFullYear();
  if (target.getMonth() < birth.getMonth() || (target.getMonth() === birth.getMonth() && target.getDate() < birth.getDate())) age -= 1;
  return age > 0 ? age : undefined;
}

function dailyEnergyGuide(state: AppState, date: string): DailyEnergyGuide {
  const activity = (state.dailyActivities ?? []).find((item) => item.date === date);
  const body = [...state.bodyRecords].sort((a, b) => b.date.localeCompare(a.date)).find((item) => item.date <= date) ?? state.bodyRecords[0];
  const weight = body?.weight || 60;
  const height = state.profile.heightCm || 165;
  const age = ageOnDate(state.profile.birthDate, date);
  const leanMass = body ? Math.max(30, body.weight - body.bodyFatMass) : undefined;
  const resting = age
    ? 10 * weight + 6.25 * height - 5 * age + (state.profile.sex === "남성" ? 5 : -161)
    : leanMass ? 370 + 21.6 * leanMass : 1300;
  let activeCalories = 0;
  let source: DailyEnergyGuide["source"] = "default";
  if (activity?.activeCalories && activity.activeCalories > 0) {
    activeCalories = activity.activeCalories;
    source = "health";
  } else if (activity) {
    const walkingKm = Math.max(0, activity.steps) * (height * 0.413 / 100) / 1000;
    const walkingCalories = 0.5 * weight * walkingKm;
    const workouts = state.workouts.filter((item) => item.date === date && item.kind === "actual" && (!item.overlapsSteps || activity.steps <= 0));
    const workoutCalories = workouts.reduce((sum, item) => {
      const rpe = typeof item.intensity === "number" ? item.intensity : 5;
      const met = 2.5 + 0.45 * Math.max(1, Math.min(10, rpe));
      return sum + Math.max(0, (met - 1) * 3.5 * weight / 200 * item.minutes);
    }, 0);
    activeCalories = walkingCalories + workoutCalories;
    source = "estimate";
  }
  const restingCalories = Math.round(resting);
  const roundedActivity = Math.round(activeCalories);
  const expenditure = Math.round(resting + activeCalories);
  if (!activity) return { activity, restingCalories, activityCalories: 0, expenditure: restingCalories, intakeMin: state.nutritionGoal.caloriesMin, intakeMax: state.nutritionGoal.caloriesMax, source };
  const maintenance = state.profile.mode === "유지기" || (isTravelDate(state.profile, date) && travelLevelForDate(state.profile, date) === "균형 유지");
  const start = new Date(`${state.profile.goalStartDate ?? date}T12:00:00`).getTime();
  const end = new Date(`${state.profile.goalEndDate}T12:00:00`).getTime();
  const days = Math.max(7, Math.round((end - start) / 86_400_000) + 1);
  const requestedDeficit = state.profile.targetBodyFatChange < 0 ? Math.abs(state.profile.targetBodyFatChange) * 7700 / days : 300;
  const deficit = maintenance ? 0 : Math.max(200, Math.min(500, requestedDeficit));
  const center = Math.max(restingCalories, expenditure - deficit);
  return {
    activity,
    restingCalories,
    activityCalories: roundedActivity,
    expenditure,
    intakeMin: Math.max(0, Math.floor((center - 100) / 50) * 50),
    intakeMax: Math.ceil((center + 100) / 50) * 50,
    source,
  };
}

function assessNutrition(total: NutritionTotal, mealCount: number, complete: boolean, profile: AppState["profile"], goal: AppState["nutritionGoal"], date: string, calorieRange?: { min: number; max: number }): "none" | "balanced" | "partial" | "attention" {
  if (!mealCount) return "none";
  const travelLevel = travelLevelForDate(profile, date);
  if (isTravelDate(profile, date) && travelLevel === "가볍게 기록") return complete ? "balanced" : "partial";
  if (!complete) return "partial";
  if (isTravelDate(profile, date) && travelLevel === "균형 유지") {
    if (total.sugar > goal.sugarMax * 1.5 || total.protein < goal.proteinMin * 0.5) return "attention";
    if (total.protein >= goal.proteinMin * 0.8 && total.sugar <= goal.sugarMax * 1.15 && total.fiber >= goal.fiberMin * 0.7) return "balanced";
    return "partial";
  }
  const calorieMin = calorieRange?.min ?? goal.caloriesMin;
  const calorieMax = calorieRange?.max ?? goal.caloriesMax;
  if (total.sugar > goal.sugarMax * 1.25 || total.calories > calorieMax * 1.15 || total.protein < goal.proteinMin * 0.65) return "attention";
  if (total.calories >= calorieMin && total.calories <= calorieMax && total.protein >= goal.proteinMin && total.sugar <= goal.sugarMax && total.fiber >= goal.fiberMin) return "balanced";
  return "partial";
}

function OnboardingFlow({ state, today, googleName, complete }: { state: AppState; today: string; googleName: string; complete: (draft: OnboardingDraft) => void }) {
  const [step, setStep] = useState(0);
  const suggestedName = googleName.trim().split(/\s+/)[0] ?? "";
  const [draft, setDraft] = useState<OnboardingDraft>(() => ({
    nickname: state.profile.nickname?.trim() || suggestedName,
    birthDate: state.profile.birthDate ?? "",
    heightCm: state.profile.heightCm ? String(state.profile.heightCm) : "",
    sex: state.profile.sex ?? "여성",
    mode: state.profile.mode ?? "감량기",
    goalStartDate: today,
    goalEndDate: state.profile.goalEndDate >= today ? state.profile.goalEndDate : addDays(today, 56),
    targetBodyFatChange: String(state.profile.targetBodyFatChange ?? -2),
    targetMuscleChange: String(state.profile.targetMuscleChange ?? 0),
    nutritionGoal: Object.fromEntries(Object.entries(state.nutritionGoal).map(([key, value]) => [key, String(value)])) as OnboardingDraft["nutritionGoal"],
    cardioSessions: String(state.workoutGoal?.cardioSessions ?? 2),
    cardioMinutes: String(state.workoutGoal?.cardioMinutes ?? 90),
    menstrualTrackingEnabled: state.profile.menstrualTrackingEnabled ?? true,
    remindersEnabled: true,
  }));
  const titles = ["나를 알려주세요", "관리 방향을 정해요", "영양 목표를 확인해요", "운동 목표를 정해요", "기록 준비를 마쳐요"];
  const subtitles = ["SOYA가 기록을 내 기준에 맞춰 보여드려요.", "목표는 나중에 언제든 다시 바꿀 수 있어요.", "추천값에서 시작하고 사용하며 조정해도 좋아요.", "개인 유산소의 한 주 기준을 정해요.", "알림과 월경 기록은 선택해서 사용할 수 있어요."];
  const update = <K extends keyof OnboardingDraft>(key: K, value: OnboardingDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const updateNutrition = (key: keyof AppState["nutritionGoal"], value: string) => setDraft((current) => ({ ...current, nutritionGoal: { ...current.nutritionGoal, [key]: value } }));
  const positive = (value: string) => Number(value) > 0;
  const nutritionValid = positive(draft.nutritionGoal.caloriesMin) && Number(draft.nutritionGoal.caloriesMax) >= Number(draft.nutritionGoal.caloriesMin)
    && positive(draft.nutritionGoal.proteinMin) && Number(draft.nutritionGoal.proteinMax) >= Number(draft.nutritionGoal.proteinMin)
    && positive(draft.nutritionGoal.carbsMin) && Number(draft.nutritionGoal.carbsMax) >= Number(draft.nutritionGoal.carbsMin)
    && positive(draft.nutritionGoal.fatMin) && Number(draft.nutritionGoal.fatMax) >= Number(draft.nutritionGoal.fatMin)
    && positive(draft.nutritionGoal.sugarMax) && positive(draft.nutritionGoal.fiberMin);
  const canContinue = [
    Boolean(draft.nickname.trim() && draft.birthDate && positive(draft.heightCm)),
    Boolean(draft.goalStartDate && draft.goalEndDate && draft.goalEndDate >= draft.goalStartDate),
    nutritionValid,
    positive(draft.cardioSessions) && positive(draft.cardioMinutes),
    true,
  ][step];
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canContinue) return;
    if (step < titles.length - 1) setStep((current) => current + 1);
    else complete(draft);
  };

  return <main className="onboarding-screen">
    <section className="onboarding-card">
      <header className="onboarding-brand">
        <Image src="/tiger-icon-192.png" width={72} height={72} alt="SOYA 호랑이" priority />
        <div><span>처음 만나는 SOYA</span><strong>내 기록의 기준을 만들어요</strong></div>
      </header>
      <div className="onboarding-progress" aria-label={`${titles.length}단계 중 ${step + 1}단계`}>
        {titles.map((_, index) => <i key={index} className={index <= step ? "active" : ""} />)}
        <small>{step + 1} / {titles.length}</small>
      </div>
      <form onSubmit={submit}>
        <div className="onboarding-copy"><span>STEP {step + 1}</span><h1>{titles[step]}</h1><p>{subtitles[step]}</p></div>

        {step === 0 && <div className="onboarding-fields two-column">
          <Field label="앱에서 부를 이름"><input value={draft.nickname} onChange={(event) => update("nickname", event.target.value)} placeholder="예: 소야" required /></Field>
          <Field label="생년월일"><input type="date" value={draft.birthDate} max={today} onChange={(event) => update("birthDate", event.target.value)} required /></Field>
          <Field label="키 (cm)"><input type="number" inputMode="decimal" min="1" step="0.1" value={draft.heightCm} onChange={(event) => update("heightCm", event.target.value)} required /></Field>
          <Field label="성별"><select value={draft.sex} onChange={(event) => update("sex", event.target.value as OnboardingDraft["sex"])}><option>여성</option><option>남성</option><option>기타</option></select></Field>
        </div>}

        {step === 1 && <div className="onboarding-fields">
          <div className="onboarding-choice-grid"><button type="button" className={draft.mode === "감량기" ? "selected" : ""} onClick={() => update("mode", "감량기")}><strong>감량기</strong><small>체지방량 감소와 골격근량 변화에 집중</small></button><button type="button" className={draft.mode === "유지기" ? "selected" : ""} onClick={() => update("mode", "유지기")}><strong>유지기</strong><small>현재 상태와 자유로운 식생활의 균형</small></button></div>
          <div className="two-column"><Field label="시작일"><input type="date" value={draft.goalStartDate} onChange={(event) => update("goalStartDate", event.target.value)} required /></Field><Field label="목표일"><input type="date" min={draft.goalStartDate} value={draft.goalEndDate} onChange={(event) => update("goalEndDate", event.target.value)} required /></Field></div>
          <div className="two-column"><Field label="체지방량 변화 목표 (kg)"><input type="number" inputMode="decimal" step="0.1" value={draft.targetBodyFatChange} onChange={(event) => update("targetBodyFatChange", event.target.value)} required /></Field><Field label="골격근량 변화 목표 (kg)"><input type="number" inputMode="decimal" step="0.1" value={draft.targetMuscleChange} onChange={(event) => update("targetMuscleChange", event.target.value)} required /></Field></div>
        </div>}

        {step === 2 && <div className="onboarding-fields nutrition-onboarding-grid">
          <OnboardingRange label="칼로리" unit="kcal" minValue={draft.nutritionGoal.caloriesMin} maxValue={draft.nutritionGoal.caloriesMax} setMin={(value) => updateNutrition("caloriesMin", value)} setMax={(value) => updateNutrition("caloriesMax", value)} />
          <OnboardingRange label="단백질" unit="g" minValue={draft.nutritionGoal.proteinMin} maxValue={draft.nutritionGoal.proteinMax} setMin={(value) => updateNutrition("proteinMin", value)} setMax={(value) => updateNutrition("proteinMax", value)} />
          <OnboardingRange label="탄수화물" unit="g" minValue={draft.nutritionGoal.carbsMin} maxValue={draft.nutritionGoal.carbsMax} setMin={(value) => updateNutrition("carbsMin", value)} setMax={(value) => updateNutrition("carbsMax", value)} />
          <OnboardingRange label="지방" unit="g" minValue={draft.nutritionGoal.fatMin} maxValue={draft.nutritionGoal.fatMax} setMin={(value) => updateNutrition("fatMin", value)} setMax={(value) => updateNutrition("fatMax", value)} />
          <Field label="당류 상한 (g)"><input type="number" min="1" inputMode="decimal" value={draft.nutritionGoal.sugarMax} onChange={(event) => updateNutrition("sugarMax", event.target.value)} required /></Field>
          <Field label="식이섬유 하한 (g)"><input type="number" min="1" inputMode="decimal" value={draft.nutritionGoal.fiberMin} onChange={(event) => updateNutrition("fiberMin", event.target.value)} required /></Field>
        </div>}

        {step === 3 && <div className="onboarding-fields">
          <div className="onboarding-workout-visual"><span aria-hidden="true">▰━▰</span><p>PT는 계획과 기록에서 따로 남기고,<br />여기서는 개인 유산소의 주간 목표를 정해요.</p></div>
          <div className="two-column"><Field label="최소 주간 횟수 (회)"><input type="number" min="1" step="1" inputMode="numeric" value={draft.cardioSessions} onChange={(event) => update("cardioSessions", event.target.value)} required /></Field><Field label="주간 누적시간 (분)"><input type="number" min="1" step="5" inputMode="numeric" value={draft.cardioMinutes} onChange={(event) => update("cardioMinutes", event.target.value)} required /></Field></div>
        </div>}

        {step === 4 && <div className="onboarding-fields onboarding-toggle-list">
          <button type="button" className={draft.menstrualTrackingEnabled ? "selected" : ""} onClick={() => update("menstrualTrackingEnabled", !draft.menstrualTrackingEnabled)}><span><strong>월경 기록 사용</strong><small>주기와 출혈·컨디션을 함께 기록해요</small></span><i>{draft.menstrualTrackingEnabled ? "사용" : "나중에"}</i></button>
          <button type="button" className={draft.remindersEnabled ? "selected" : ""} onClick={() => update("remindersEnabled", !draft.remindersEnabled)}><span><strong>기본 알림 준비</strong><small>아침·식사·운동·주간 계획 알림 시간을 준비해요</small></span><i>{draft.remindersEnabled ? "사용" : "나중에"}</i></button>
          <article className="onboarding-apple-note"><span className="pixel-heart" aria-hidden="true">♥</span><div><strong>Apple 건강 연결은 선택이에요</strong><p>SOYA 시작 후 ‘하루의 움직임’에서 언제든 연결할 수 있어요.</p></div></article>
        </div>}

        {!canContinue && step < 4 && <p className="onboarding-validation">필요한 내용을 모두 입력해주세요.</p>}
        <footer className="onboarding-actions">
          {step > 0 ? <button type="button" className="ghost-button" onClick={() => setStep((current) => current - 1)}>이전</button> : <span />}
          <button type="submit" className="primary-button" disabled={!canContinue}>{step === titles.length - 1 ? "SOYA 시작하기" : "다음"}</button>
        </footer>
      </form>
    </section>
  </main>;
}

function OnboardingRange({ label, unit, minValue, maxValue, setMin, setMax }: { label: string; unit: string; minValue: string; maxValue: string; setMin: (value: string) => void; setMax: (value: string) => void }) {
  return <fieldset className="onboarding-range"><legend>{label} ({unit})</legend><label><span>최소</span><ClearableFieldControl><input type="number" min="1" inputMode="decimal" value={minValue} onChange={(event) => setMin(event.target.value)} required /></ClearableFieldControl></label><b>~</b><label><span>최대</span><ClearableFieldControl><input type="number" min="1" inputMode="decimal" value={maxValue} onChange={(event) => setMax(event.target.value)} required /></ClearableFieldControl></label></fieldset>;
}

export function HealthApp() {
  const [state, setState] = useState<AppState>(() => createFreshState());
  const [tab, setTab] = useState<Tab>("today");
  const [modalStack, setModalStack] = useState<Exclude<Modal, null>[]>([]);
  const modal: Modal = modalStack[modalStack.length - 1] ?? null;
  const setModal = useCallback((next: Modal) => {
    if (next === null) {
      setModalStack([]);
      return;
    }
    setModalStack((current) => current[current.length - 1] === next ? current : [...current, next]);
  }, []);
  const closeModal = useCallback(() => {
    setModalStack([]);
  }, []);
  const closeAppleHealth = useCallback(() => {
    setModalStack((current) => current.length > 1 && current[current.length - 2] === "activity" ? current.slice(0, -1) : []);
  }, []);
  const closeAccountChild = useCallback(() => {
    setModalStack((current) => current.length > 1 && current[current.length - 2] === "account" ? current.slice(0, -1) : []);
  }, []);
  const [mealPresetType, setMealPresetType] = useState<MealType>();
  const [mealDraft, setMealDraft] = useState<MealEntry>();
  const [mealDate, setMealDate] = useState<string>();
  const [workoutDraft, setWorkoutDraft] = useState<WorkoutEntry>();
  const [workoutPresetType, setWorkoutPresetType] = useState<WorkoutEntry["type"]>();
  const [activityDate, setActivityDate] = useState<string>();
  const [cycleDate, setCycleDate] = useState<string>();
  const [cycleRangeDraft, setCycleRangeDraft] = useState<CycleRange>();
  const [loveDate, setLoveDate] = useState<string>();
  const [selectedBodyRecord, setSelectedBodyRecord] = useState<BodyRecord>();
  const [selectedCircumferenceRecord, setSelectedCircumferenceRecord] = useState<CircumferenceRecord>();
  const [selectedConsultation, setSelectedConsultation] = useState<Consultation>();
  const [selectedGoalHistory, setSelectedGoalHistory] = useState<GoalHistoryEntry>();
  const [weeklyPlanStart, setWeeklyPlanStart] = useState<string>();
  const [weeklyPlanConsultation, setWeeklyPlanConsultation] = useState<Consultation>();
  const [loaded, setLoaded] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authMessage, setAuthMessage] = useState("");
  const [authSigningIn, setAuthSigningIn] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "offline">("saved");
  const [pushStatus, setPushStatus] = useState<PushStatus>("off");
  const [pushMessage, setPushMessage] = useState("");
  const [appleHealthSyncing, setAppleHealthSyncing] = useState(false);
  const [fabVisible, setFabVisible] = useState(true);
  const saveQueue = useRef(Promise.resolve());
  const lastPersistedState = useRef<AppState | undefined>(undefined);
  const lastPersistedUid = useRef<string | undefined>(undefined);
  const deepLinkHandled = useRef(false);
  const lastScrollY = useRef(0);
  const fabScrollFrame = useRef(0);
  const today = todayKey();

  useEffect(() => {
    let active = true;
    const stop = observeGoogleUser((user) => {
      if (!active) return;
      setAuthUser(user);
      setAuthReady(true);
      setAuthSigningIn(false);
      setAuthMessage("");
      if (!user) {
        lastPersistedState.current = undefined;
        lastPersistedUid.current = undefined;
        setState(createFreshState());
        setLoaded(false);
        return;
      }
      setLoaded(false);
      void loadUserState(user.uid)
        .then((saved) => {
          if (!active) return;
          const next = normalizeAppState(saved);
          lastPersistedState.current = next;
          lastPersistedUid.current = user.uid;
          setState(next);
          setSaveState("saved");
          void getPushStatus().then((status) => {
            setPushStatus(status);
            if (status === "enabled") void syncPushSubscription(pushSyncPayload(next, today));
          });
        })
        .catch(() => {
          if (active) setSaveState("offline");
        })
        .finally(() => {
          if (active) setLoaded(true);
        });
    });
    return () => { active = false; stop(); };
  }, [today]);

  useEffect(() => {
    let stop: (() => void) | undefined;
    void observeForegroundNotifications().then((unsubscribe) => { stop = unsubscribe; });
    return () => stop?.();
  }, []);

  const openDeepLink = useCallback((destination: string) => {
    if (typeof window === "undefined") return;
    const url = new URL(destination, window.location.origin);
    const params = url.searchParams;
    const requestedTab = params.get("tab");
    const requestedModal = params.get("open") as Modal;
    const requestedDate = /^20\d{2}-\d{2}-\d{2}$/.test(params.get("date") ?? "") ? params.get("date")! : today;
    if (requestedTab && tabs.some((item) => item.id === requestedTab)) setTab(requestedTab as Tab);
    if (requestedModal && ["body", "meal-actual", "workout-actual", "weekly-plan", "cycle"].includes(requestedModal)) {
      if (requestedModal === "body") setSelectedBodyRecord(undefined);
      if (requestedModal === "meal-actual") {
        const mealType = params.get("mealType") as MealType;
        const validMealType = Object.keys(mealLabels).includes(mealType) ? mealType : undefined;
        setMealPresetType(validMealType);
        setMealDate(requestedDate);
        setMealDraft(validMealType ? state.meals.find((item) => item.date === requestedDate && item.mealType === validMealType && item.kind === "plan") : undefined);
      }
      if (requestedModal === "workout-actual") {
        const planId = params.get("planId");
        const plan = state.workouts.find((item) => item.kind === "plan" && item.date === requestedDate && (!planId || planId === "workout" || item.id === planId))
          ?? state.workouts.find((item) => item.kind === "plan" && item.date === requestedDate);
        setWorkoutDraft(plan);
        setWorkoutPresetType(plan?.type);
      }
      if (requestedModal === "weekly-plan") {
        setWeeklyPlanStart(undefined);
        setWeeklyPlanConsultation(undefined);
      }
      if (requestedModal === "cycle") {
        setCycleDate(requestedDate);
        setCycleRangeDraft(undefined);
      }
      setModal(requestedModal);
    }
  }, [setModal, state.meals, state.workouts, today]);

  useEffect(() => {
    if (!authReady || !authUser || !loaded || deepLinkHandled.current || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    openDeepLink(window.location.href);
    deepLinkHandled.current = true;
    if (params.size) window.history.replaceState({}, "", window.location.pathname);
  }, [authReady, authUser, loaded, openDeepLink]);

  useEffect(() => observeNotificationClicks(openDeepLink), [openDeepLink]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
    setFabVisible(true);
  }, [tab]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    lastScrollY.current = Math.max(0, window.scrollY);
    const handleScroll = () => {
      if (fabScrollFrame.current) return;
      fabScrollFrame.current = window.requestAnimationFrame(() => {
        const currentScrollY = Math.max(0, window.scrollY);
        const delta = currentScrollY - lastScrollY.current;
        if (currentScrollY <= 32) setFabVisible(true);
        else if (Math.abs(delta) >= 7) setFabVisible(delta < 0);
        lastScrollY.current = currentScrollY;
        fabScrollFrame.current = 0;
      });
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (fabScrollFrame.current) window.cancelAnimationFrame(fabScrollFrame.current);
    };
  }, []);

  useEffect(() => {
    if (!modal) return;
    const scrollY = window.scrollY;
    const previous = {
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
      overflow: document.body.style.overflow,
    };
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.position = previous.position;
      document.body.style.top = previous.top;
      document.body.style.width = previous.width;
      document.body.style.overflow = previous.overflow;
      window.scrollTo(0, scrollY);
    };
  }, [modal]);

  const persist = (next: AppState) => {
    if (!authUser) return;
    const uid = authUser.uid;
    setSaveState("saving");
    saveQueue.current = saveQueue.current
      .then(async () => {
        const previous = lastPersistedUid.current === uid ? lastPersistedState.current : undefined;
        let lastError: unknown;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            await saveUserState(uid, next, previous);
            lastPersistedState.current = next;
            lastPersistedUid.current = uid;
            return;
          } catch (error) {
            lastError = error;
            if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 500 * (attempt + 1)));
          }
        }
        throw lastError;
      })
      .then(() => {
        setSaveState("saved");
        void syncPushSubscription(pushSyncPayload(next, today));
      })
      .catch(() => setSaveState("offline"));
  };

  const enableActualNotifications = async () => {
    setPushStatus("working");
    setPushMessage("");
    try {
      await enablePushNotifications(pushSyncPayload(state, today));
      setPushStatus("enabled");
      setPushMessage("앱을 닫아도 설정한 시간에 알림이 와요.");
    } catch (error) {
      const status = await getPushStatus();
      setPushStatus(status === "blocked" ? "blocked" : "error");
      setPushMessage(error instanceof Error ? error.message : "알림 연결에 실패했습니다.");
    }
  };

  const disableActualNotifications = async () => {
    setPushStatus("working");
    setPushMessage("");
    try {
      await disablePushNotifications(pushSyncPayload(state, today));
      setPushStatus("off");
      setPushMessage("실제 알림을 껐어요.");
    } catch (error) {
      setPushStatus("error");
      setPushMessage(error instanceof Error ? error.message : "알림 해제에 실패했습니다.");
    }
  };

  const commit = (updater: (current: AppState) => AppState) => {
    setState((current) => {
      const next = updater(current);
      void persist(next);
      return next;
    });
  };

  const refreshFromCloud = useCallback(async () => {
    if (!authUser) return;
    await saveQueue.current;
    const saved = await loadUserState(authUser.uid);
    const next = normalizeAppState(saved);
    lastPersistedState.current = next;
    lastPersistedUid.current = authUser.uid;
    setState(next);
    setSaveState("saved");
  }, [authUser]);

  const startAppleHealthSync = useCallback((range?: AppleHealthSyncRange) => {
    if (typeof window === "undefined") return;
    setAppleHealthSyncing(true);
    setModal(null);
    window.sessionStorage.setItem(appleHealthSyncPendingKey, "1");
    const shortcutInput = range ? JSON.stringify({ mode: "history", ...range, batchDays: 31 }) : undefined;
    const inputQuery = shortcutInput ? `&input=text&text=${encodeURIComponent(shortcutInput)}` : "";
    const standalone = window.matchMedia("(display-mode: standalone)").matches
      || Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
    if (standalone) {
      // An HTTPS callback is always opened by Safari on iOS, even when the
      // request started in an installed Home Screen web app. Keeping the
      // shortcut in the foreground avoids unexpectedly opening a Safari tab;
      // SOYA refreshes as soon as the user returns to the Home Screen app.
      window.location.assign(`shortcuts://run-shortcut?name=${encodeURIComponent(appleHealthShortcutName)}${inputQuery}`);
      return;
    }
    const returnUrl = new URL(window.location.href);
    returnUrl.searchParams.set("healthSync", "1");
    // URLSearchParams serializes spaces as `+`, but the Shortcuts URL scheme
    // treats that plus sign as part of the shortcut name. Encode each value
    // directly so "SOYA 건강 보내기" remains the exact shortcut name on iOS.
    const encodedReturnUrl = encodeURIComponent(returnUrl.toString());
    const shortcutUrl = [
      `shortcuts://x-callback-url/run-shortcut?name=${encodeURIComponent(appleHealthShortcutName)}${inputQuery}`,
      `x-success=${encodedReturnUrl}`,
      `x-cancel=${encodedReturnUrl}`,
      `x-error=${encodedReturnUrl}`,
    ].join("&");
    window.location.assign(shortcutUrl);
  }, [setModal]);

  useEffect(() => {
    if (!authUser || !loaded) return;
    let refreshing = false;
    let timer: number | undefined;
    const finishAppleHealthSync = () => {
      if (refreshing || document.visibilityState !== "visible") return;
      const params = new URLSearchParams(window.location.search);
      const returnedFromShortcut = params.get("healthSync") === "1";
      const pending = window.sessionStorage.getItem(appleHealthSyncPendingKey) === "1";
      if (!returnedFromShortcut && !pending) return;
      refreshing = true;
      setAppleHealthSyncing(true);
      window.sessionStorage.removeItem(appleHealthSyncPendingKey);
      params.delete("healthSync");
      const cleanQuery = params.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ""}${window.location.hash}`);
      timer = window.setTimeout(() => {
        void refreshFromCloud()
          .finally(() => {
            setAppleHealthSyncing(false);
            refreshing = false;
          });
      }, 900);
    };
    finishAppleHealthSync();
    document.addEventListener("visibilitychange", finishAppleHealthSync);
    window.addEventListener("focus", finishAppleHealthSync);
    window.addEventListener("pageshow", finishAppleHealthSync);
    return () => {
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", finishAppleHealthSync);
      window.removeEventListener("focus", finishAppleHealthSync);
      window.removeEventListener("pageshow", finishAppleHealthSync);
    };
  }, [authUser, loaded, refreshFromCloud]);

  const todayBody = state.bodyRecords.find((entry) => entry.date === today);
  const todayMeals = state.meals.filter((entry) => entry.date === today);
  const actualMeals = todayMeals.filter((entry) => entry.kind === "actual" && !entry.skipped);
  const todayWorkouts = state.workouts.filter((entry) => entry.date === today);
  const actualWorkouts = todayWorkouts.filter((entry) => entry.kind === "actual");
  const plannedWorkout = todayWorkouts.find((entry) => entry.kind === "plan");
  const goalClock = goalTiming(state.profile, today);
  const travelToday = isTravelDate(state.profile, today);
  const auditCount = useMemo(() => recordAuditCount(state, today), [state, today]);

  const nutrition = nutritionTotal(actualMeals);

  const mealActual = useCallback((type: MealType) => todayMeals.find((entry) => entry.kind === "actual" && entry.mealType === type), [todayMeals]);
  const mealPlan = useCallback((type: MealType) => todayMeals.find((entry) => entry.kind === "plan" && entry.mealType === type), [todayMeals]);
  const workoutExpected = Boolean(plannedWorkout || actualWorkouts.length);
  const completed = [...(travelToday ? [] : [Boolean(todayBody)]), ...(["breakfast", "lunch", "dinner"] as MealType[]).map((type) => Boolean(mealActual(type))), ...(workoutExpected ? [actualWorkouts.length > 0] : [])];
  const completedCount = completed.filter(Boolean).length;

  const nextAction = useMemo(() => {
    const settings = state.reminderSettings ?? defaultReminders;
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const toMinutes = (time: string) => {
      const [hour, minute] = time.split(":").map(Number);
      return hour * 60 + minute;
    };
    const travelBehavior = travelToday ? settings.travelBehavior : "기본 유지";
    if (travelBehavior === "모두 끄기") {
      return { type: "done" as const, eyebrow: "여행 중 알림 쉼", title: "오늘은 알림 없이 가볍게", detail: "필요한 기록이 생기면\n아래 + 버튼으로 언제든 추가할 수 있어요" };
    }

    const candidates: Exclude<NextAction, { type: "done" }>[] = [];
    const addTiming = <T extends Omit<Exclude<NextAction, { type: "done" }>, "due">>(candidate: T) => candidates.push({ ...candidate, due: nowMinutes >= toMinutes(candidate.time) } as Exclude<NextAction, { type: "done" }>);
    if (!travelToday && settings.bodyEnabled && !todayBody && !state.skippedTasks.includes(`${today}:body`)) {
      addTiming({ type: "body", time: settings.bodyTime, eyebrow: "아침 공복 기록", title: "오늘 인바디를 기록할까요?", detail: "체지방량과 골격근량의 흐름을 이어가요." });
    }
    (["breakfast", "lunch", "dinner"] as MealType[]).forEach((mealType) => {
      if (!settings.mealEnabled[mealType] || mealActual(mealType)) return;
      const plan = mealPlan(mealType);
      addTiming({ type: "meal", mealType, time: settings.mealTimes[mealType], eyebrow: `${mealLabels[mealType]} 기록`, title: `${mealLabels[mealType]} 식사를 기록할 시간이에요`, detail: plan ? `계획: ${plan.title}` : "계획은 없어요. 먹은 내용을 바로 남겨보세요." });
    });
    if (travelBehavior !== "핵심만" && settings.workoutEnabled && plannedWorkout && !actualWorkouts.length && !state.skippedTasks.includes(`${today}:workout`)) {
      const workoutReminderTime = plannedWorkout.startTime
        ? timeBefore(plannedWorkout.startTime, settings.workoutLeadMinutes ?? defaultReminders.workoutLeadMinutes)
        : settings.workoutTime;
      addTiming({
        type: "workout",
        time: workoutReminderTime,
        eyebrow: "오늘의 운동",
        title: plannedWorkout.startTime ? "곧 운동을 시작할 시간이에요" : "계획한 운동을 마쳤나요?",
        detail: `${plannedWorkout.title}${plannedWorkout.startTime ? ` · ${plannedWorkout.startTime} 시작` : ""} · ${plannedWorkout.minutes}분`,
      });
    }
    const nextWeekStart = addDays(weekStart(today), 7);
    const nextWeekEnd = addDays(nextWeekStart, 6);
    const hasNextWeekPlan = state.meals.some((entry) => entry.kind === "plan" && entry.date >= nextWeekStart && entry.date <= nextWeekEnd)
      || state.workouts.some((entry) => entry.kind === "plan" && entry.date >= nextWeekStart && entry.date <= nextWeekEnd);
    if (travelBehavior !== "핵심만" && settings.weeklyEnabled && now.getDay() === settings.weeklyDay && !hasNextWeekPlan && !state.skippedTasks.includes(`${today}:weekly`)) {
      addTiming({ type: "weekly", time: settings.weeklyTime, eyebrow: "일요일 주간 계획", title: "다음 주를 함께 계획할까요?", detail: `${nextWeekStart.replaceAll("-", ".")}부터 식단과 운동을 준비해요.` });
    }
    if (!candidates.length) return { type: "done" as const, eyebrow: "오늘 기록", title: "오늘 기록을 모두 마쳤어요", detail: "필요한 기록이 생기면\n아래 + 버튼으로 언제든 추가할 수 있어요" };
    return [...candidates].sort((a, b) => Number(b.due) - Number(a.due) || toMinutes(a.time) - toMinutes(b.time))[0];
  }, [actualWorkouts.length, mealActual, mealPlan, plannedWorkout, state.meals, state.reminderSettings, state.skippedTasks, state.workouts, today, todayBody, travelToday]);

  const openNextAction = () => {
    if (nextAction.type === "body") setModal("body");
    else if (nextAction.type === "workout") {
      setWorkoutDraft(plannedWorkout);
      setWorkoutPresetType(undefined);
      setModal("workout-actual");
    }
    else if (nextAction.type === "meal") {
      setMealPresetType(nextAction.mealType);
      setMealDraft(mealPlan(nextAction.mealType));
      setModal("meal-actual");
    }
    else if (nextAction.type === "weekly") {
      setWeeklyPlanStart(addDays(weekStart(today), 7));
      setModal("weekly-plan");
    }
  };

  const saveReminders = (settings: ReminderSettings) => {
    commit((current) => ({ ...current, reminderSettings: settings }));
    setModal(null);
  };

  const skipNextAction = () => {
    if (nextAction.type === "meal") {
      const skipped = {
        id: id("meal"), date: today, mealType: nextAction.mealType, kind: "actual" as const,
        title: "먹지 않음", calories: 0, protein: 0, carbs: 0, fat: 0, sugar: 0, fiber: 0,
        confidence: "높음" as const, skipped: true,
      };
      commit((current) => ({ ...current, meals: [...current.meals, skipped] }));
    } else if (nextAction.type !== "done") {
      const key = `${today}:${nextAction.type}`;
      commit((current) => ({ ...current, skippedTasks: [...new Set([...current.skippedTasks, key])] }));
    }
  };

  const saveWorkoutGoal = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    commit((current) => ({
      ...current,
      workoutGoal: {
        cardioSessions: Math.max(1, number(data.get("cardioSessions"))),
        cardioMinutes: Math.max(1, number(data.get("cardioMinutes"))),
      },
    }));
    setModal(null);
  };

  const saveNutritionGoal = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const range = (minName: string, maxName: string) => {
      const min = Math.max(0, number(data.get(minName)));
      const max = Math.max(min, number(data.get(maxName)));
      return [min, max] as const;
    };
    const [caloriesMin, caloriesMax] = range("caloriesMin", "caloriesMax");
    const [proteinMin, proteinMax] = range("proteinMin", "proteinMax");
    const [carbsMin, carbsMax] = range("carbsMin", "carbsMax");
    const [fatMin, fatMax] = range("fatMin", "fatMax");
    commit((current) => ({
      ...current,
      nutritionGoal: {
        caloriesMin, caloriesMax, proteinMin, proteinMax, carbsMin, carbsMax, fatMin, fatMax,
        sugarMax: Math.max(0, number(data.get("sugarMax"))),
        fiberMin: Math.max(0, number(data.get("fiberMin"))),
      },
    }));
    setModal(null);
  };

  const saveProfileGoal = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const mode = String(data.get("mode")) as AppState["profile"]["mode"];
    const goalStartDate = String(data.get("goalStartDate"));
    const requestedEnd = String(data.get("goalEndDate"));
    const goalEndDate = requestedEnd < goalStartDate ? goalStartDate : requestedEnd;
    const travelActive = data.get("travelActive") === "on";
    const travelStartDate = travelActive ? String(data.get("travelStartDate")) : undefined;
    const requestedTravelEnd = travelActive ? String(data.get("travelEndDate")) : undefined;
    const travelEndDate = travelActive && travelStartDate && requestedTravelEnd ? (requestedTravelEnd < travelStartDate ? travelStartDate : requestedTravelEnd) : undefined;
    const travelLevel = (String(data.get("travelLevel") || "균형 유지")) as TravelLevel;
    const elapsed = Math.max(0, Math.floor((new Date(`${today}T12:00:00`).getTime() - new Date(`${goalStartDate}T12:00:00`).getTime()) / 604_800_000));
    commit((current) => {
      const defaultChanged = travelLevel !== (current.profile.travelLevel ?? "균형 유지");
      const pastTravelLevels = defaultChanged ? Object.fromEntries(Object.entries(current.profile.travelDailyLevels ?? {}).filter(([date]) => date < today)) : current.profile.travelDailyLevels;
      return {
        ...current,
        profile: {
          ...current.profile,
          mode,
          goalWeek: elapsed + 1,
          goalStartDate,
          goalEndDate,
          targetBodyFatChange: number(data.get("targetBodyFatChange")),
          targetMuscleChange: number(data.get("targetMuscleChange")),
          travelActive,
          travelStartDate,
          travelEndDate,
          travelLevel,
          travelDailyLevels: pastTravelLevels,
          birthDate: String(data.get("birthDate") || "") || undefined,
          heightCm: number(data.get("heightCm")) || undefined,
          sex: String(data.get("sex") || "여성") as NonNullable<AppState["profile"]["sex"]>,
        },
      };
    });
    setModal(null);
  };

  const finishCurrentGoal = (choice: GoalCompletionChoice) => {
    commit((current) => {
      const progress = bodyGoalProgressFor(current, today);
      const history = {
        id: id("goal-history"),
        startedAt: current.profile.goalStartDate ?? today,
        plannedEndAt: current.profile.goalEndDate,
        completedAt: today,
        mode: current.profile.mode,
        targetBodyFatChange: current.profile.targetBodyFatChange,
        targetMuscleChange: current.profile.targetMuscleChange,
        bodyFatChange: progress.baseline && progress.latestRecord ? progress.bodyFatChange : undefined,
        muscleChange: progress.baseline && progress.latestRecord ? progress.muscleChange : undefined,
        outcome: choice.outcome,
        note: choice.note.trim() || undefined,
        report: goalReportFor(current, today),
      } satisfies NonNullable<AppState["goalHistory"]>[number];
      return {
        ...current,
        profile: {
          ...current.profile,
          mode: choice.mode,
          goalWeek: 1,
          goalStartDate: today,
          goalEndDate: choice.goalEndDate,
          targetBodyFatChange: choice.targetBodyFatChange,
          targetMuscleChange: choice.targetMuscleChange,
        },
        goalHistory: [history, ...(current.goalHistory ?? [])],
      };
    });
    setModal(null);
  };

  const saveProfileSettings = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    commit((current) => ({
      ...current,
      profile: {
        ...current.profile,
        nickname: String(data.get("nickname") ?? "").trim() || "소야",
        birthDate: String(data.get("birthDate") || "") || undefined,
        heightCm: number(data.get("heightCm")) || undefined,
        sex: String(data.get("sex") || "여성") as NonNullable<AppState["profile"]["sex"]>,
      },
    }));
    setModal(null);
  };

  const updateTravelDayLevel = (date: string, level: TravelLevel) => {
    commit((current) => ({
      ...current,
      profile: {
        ...current.profile,
        travelDailyLevels: { ...(current.profile.travelDailyLevels ?? {}), [date]: level },
      },
    }));
  };

  const saveBody = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const editingId = String(data.get("editingId") || "");
    const measurementTiming = String(data.get("measurementTiming"));
    const device = String(data.get("device"));
    const record: BodyRecord = {
      id: editingId || id("body"), date: String(data.get("date")), time: String(data.get("time")),
      weight: number(data.get("weight")), skeletalMuscle: number(data.get("skeletalMuscle")),
      bodyFatMass: number(data.get("bodyFatMass")), bodyFatRate: number(data.get("bodyFatRate")),
      visceralFat: number(data.get("visceralFat")), measurementTiming, device,
      condition: `${measurementTiming} · ${device}`,
    };
    commit((current) => ({ ...current, bodyRecords: [record, ...current.bodyRecords.filter((item) => item.id !== editingId && item.date !== record.date)].sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`)) }));
    setSelectedBodyRecord(undefined);
    setModal(null);
  };

  const saveBodyBulk = (records: BodyRecord[]) => {
    commit((current) => ({
      ...current,
      bodyRecords: [...records, ...current.bodyRecords]
        .sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`)),
    }));
    setModal(null);
  };

  const saveCircumference = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const editingId = String(data.get("editingId") || "");
    const record: CircumferenceRecord = {
      id: editingId || id("circumference"),
      date: String(data.get("date")),
      waistIn: number(data.get("waistIn")),
      hipIn: number(data.get("hipIn")),
      note: String(data.get("note") || "").trim() || undefined,
    };
    commit((current) => ({
      ...current,
      circumferenceRecords: [record, ...(current.circumferenceRecords ?? []).filter((item) => item.id !== editingId && item.date !== record.date)]
        .sort((a, b) => b.date.localeCompare(a.date)),
    }));
    setSelectedCircumferenceRecord(undefined);
    setModal(null);
  };

  const saveActivity = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const editingId = String(data.get("editingId") || "");
    const activeCalories = number(data.get("activeCalories"));
    const activity: DailyActivity = {
      id: editingId || id("activity"),
      date: String(data.get("date")),
      watchWorn: data.get("watchWorn") === "true",
      steps: Math.max(0, number(data.get("steps"))),
      activeCalories: activeCalories > 0 ? activeCalories : undefined,
      note: String(data.get("note") || "").trim() || undefined,
      source: "manual",
    };
    commit((current) => ({
      ...current,
      dailyActivities: [activity, ...(current.dailyActivities ?? []).filter((item) => item.id !== editingId && item.date !== activity.date)].sort((a, b) => b.date.localeCompare(a.date)),
    }));
    setActivityDate(undefined);
    setModal(null);
  };

  const deleteActivity = (entry: DailyActivity) => {
    if (!window.confirm(`${entry.date} 하루 활동 기록을 삭제할까요?`)) return;
    commit((current) => ({ ...moveToTrash(current, `${entry.date} 하루 활동`, { dailyActivities: [entry] }), dailyActivities: (current.dailyActivities ?? []).filter((item) => item.id !== entry.id) }));
    setActivityDate(undefined);
    setModal(null);
  };

  const saveMeal = (event: FormEvent<HTMLFormElement>, kind: EntryKind) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const skipped = kind === "actual" && submitter?.name === "skipped" && submitter.value === "true";
    const editingId = String(data.get("editingId") || "");
    const mealType = String(data.get("mealType")) as MealType;
    let components: MealFoodComponent[] = [];
    try {
      const parsed = JSON.parse(String(data.get("components") || "[]")) as MealFoodComponent[];
      components = parsed.filter((item) => item.name.trim()).map((item) => ({
        ...item,
        name: item.name.trim(),
        calories: Number(item.calories) || 0,
        protein: Number(item.protein) || 0,
        carbs: Number(item.carbs) || 0,
        fat: Number(item.fat) || 0,
        sugar: Number(item.sugar) || 0,
        fiber: Number(item.fiber) || 0,
      }));
    } catch {
      components = [];
    }
    if (!components.length && !skipped) return;
    const singleComponent = components.length === 1 ? components[0] : undefined;
    const libraryId = singleComponent?.foodLibraryId ?? "";
    const libraryItem = (state.foodLibrary ?? []).find((item) => item.id === libraryId);
    const basis = libraryItem ? foodBasis(libraryItem) : undefined;
    const quantity = libraryItem ? Math.max(0.1, singleComponent?.quantity || basis!.amount) : undefined;
    const servings = libraryItem && basis ? quantity! / basis.amount : undefined;
    const meal: MealEntry = {
      id: editingId || id("meal"), date: String(data.get("date")), mealType, kind,
      title: skipped ? "먹지 않음" : String(data.get("title")), calories: kind === "actual" && !skipped ? number(data.get("calories")) : 0,
      protein: kind === "actual" && !skipped ? number(data.get("protein")) : 0, carbs: kind === "actual" && !skipped ? number(data.get("carbs")) : 0,
      fat: kind === "actual" && !skipped ? number(data.get("fat")) : 0, sugar: kind === "actual" && !skipped ? number(data.get("sugar")) : 0,
      fiber: kind === "actual" && !skipped ? number(data.get("fiber")) : 0,
      foodLibraryId: libraryId || undefined,
      servings,
      quantity,
      servingLabel: libraryItem ? foodBasisLabel(libraryItem) : undefined,
      components: skipped ? [] : components,
      skipped,
    };
    commit((current) => ({
      ...current,
      meals: [...current.meals.filter((item) => item.id !== editingId), meal],
    }));
    setMealDraft(undefined);
    setMealDate(undefined);
    setModal(null);
  };

  const saveWorkout = (event: FormEvent<HTMLFormElement>, kind: EntryKind) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const editingId = String(data.get("editingId") || "");
    const workout: WorkoutEntry = {
      id: editingId || id("workout"), date: String(data.get("date")), kind,
      startTime: kind === "plan" ? String(data.get("startTime") || "") || undefined : workoutDraft?.startTime,
      type: String(data.get("type")) as WorkoutEntry["type"], title: String(data.get("title")),
      minutes: number(data.get("minutes")), intensity: number(data.get("intensity")),
      heartRate: String(data.get("heartRate") || ""), overlapsSteps: data.get("overlapsSteps") === "on",
      details: String(data.get("details")),
      source: "manual",
    };
    commit((current) => ({ ...current, workouts: [...current.workouts.filter((item) => item.id !== editingId), workout] }));
    setWorkoutDraft(undefined);
    setModal(null);
  };

  const openWorkout = (kind: EntryKind, draft?: WorkoutEntry, presetType?: WorkoutEntry["type"]) => {
    setWorkoutDraft(draft);
    setWorkoutPresetType(presetType);
    setModal(kind === "plan" ? "workout-plan" : "workout-actual");
  };

  const openMeal = (kind: EntryKind, presetType?: MealType, draft?: MealEntry, date?: string) => {
    setMealPresetType(presetType);
    setMealDraft(draft);
    setMealDate(date ?? draft?.date);
    setModal(kind === "plan" ? "meal-plan" : "meal-actual");
  };

  const openAuditTarget = (target: RecordAuditTarget) => {
    if (target.kind === "body") {
      setSelectedBodyRecord(target.record);
      setModal("body-detail");
    } else if (target.kind === "circumference") {
      setSelectedCircumferenceRecord(target.record);
      setModal("circumference");
    } else if (target.kind === "meal") {
      openMeal(target.record.kind, target.record.mealType, target.record, target.record.date);
    } else if (target.kind === "meal-actual") {
      openMeal("actual", target.record.mealType, { ...target.record, id: "", kind: "actual" }, target.record.date);
    } else if (target.kind === "workout") {
      openWorkout(target.record.kind, target.record);
    } else if (target.kind === "workout-actual") {
      openWorkout("actual", { ...target.record, id: "", kind: "actual" });
    } else if (target.kind === "activity") {
      setActivityDate(target.record.date);
      setModal("activity");
    } else if (target.kind === "cycle") {
      setCycleDate(target.date);
      setCycleRangeDraft(cycleRangeAround(state.cycles, target.date));
      setModal("cycle");
    } else if (target.kind === "love") {
      setLoveDate(target.date);
      setModal("love");
    } else if (target.kind === "food-library") {
      setModal("food-library");
    }
  };

  const deleteMeal = (entry: MealEntry) => {
    if (!window.confirm(`${mealLabels[entry.mealType]} ${entry.kind === "plan" ? "계획" : "기록"}을 삭제할까요?`)) return;
    commit((current) => ({ ...moveToTrash(current, `${entry.date} ${mealLabels[entry.mealType]} ${entry.kind === "plan" ? "계획" : "기록"}`, { meals: [entry] }), meals: current.meals.filter((item) => item.id !== entry.id) }));
  };

  const saveFoodLibraryItem = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const editingId = String(data.get("editingId") || "");
    const baseAmount = Math.max(0.1, number(data.get("baseAmount")) || 1);
    const unit = String(data.get("unit")) as FoodUnit;
    const item: FoodLibraryItem = {
      id: editingId || id("food"),
      name: String(data.get("name")).trim(),
      kind: "food",
      baseAmount,
      unit,
      servingLabel: `${baseAmount}${unit}`,
      calories: number(data.get("calories")),
      protein: number(data.get("protein")),
      carbs: number(data.get("carbs")),
      fat: number(data.get("fat")),
      sugar: number(data.get("sugar")),
      fiber: number(data.get("fiber")),
      dataSource: data.get("dataSource") === "mfds" ? "mfds" : "manual",
      sourceCode: String(data.get("sourceCode") || "") || undefined,
    };
    commit((current) => ({
      ...current,
      foodLibrary: [...(current.foodLibrary ?? []).filter((food) => food.id !== editingId), item].sort((a, b) => a.name.localeCompare(b.name, "ko")),
    }));
    event.currentTarget.reset();
  };

  const deleteFoodLibraryItem = (item: FoodLibraryItem) => {
    const dependentSets = (state.foodLibrary ?? []).filter((food) => food.kind === "set" && food.components?.some((component) => component.foodId === item.id));
    const dependentMessage = dependentSets.length ? ` 이 음식을 사용한 세트 ${dependentSets.length}개도 함께 삭제돼요.` : "";
    if (!window.confirm(`${item.name}을 음식 보관함에서 삭제할까요?${dependentMessage} 기존 식사 기록은 유지돼요.`)) return;
    const deletingIds = new Set([item.id, ...dependentSets.map((food) => food.id)]);
    commit((current) => ({ ...moveToTrash(current, `음식 보관함 · ${item.name}`, { foodLibrary: [item, ...dependentSets] }), foodLibrary: (current.foodLibrary ?? []).filter((food) => !deletingIds.has(food.id)) }));
  };

  const saveFoodSet = (name: string, components: { foodId: string; amount: number }[], editingId?: string) => {
    const foods = state.foodLibrary ?? [];
    const totals = components.reduce((sum, component) => {
      const food = foods.find((item) => item.id === component.foodId && item.kind !== "set");
      if (!food) return sum;
      const factor = component.amount / foodBasis(food).amount;
      return {
        calories: sum.calories + food.calories * factor,
        protein: sum.protein + food.protein * factor,
        carbs: sum.carbs + food.carbs * factor,
        fat: sum.fat + food.fat * factor,
        sugar: sum.sugar + food.sugar * factor,
        fiber: sum.fiber + food.fiber * factor,
      };
    }, { calories: 0, protein: 0, carbs: 0, fat: 0, sugar: 0, fiber: 0 });
    const setItem: FoodLibraryItem = {
      id: editingId || id("food-set"), name: name.trim(), kind: "set", baseAmount: 1, unit: "인분", servingLabel: "1인분", components,
      calories: roundNutrient(totals.calories), protein: roundNutrient(totals.protein), carbs: roundNutrient(totals.carbs),
      fat: roundNutrient(totals.fat), sugar: roundNutrient(totals.sugar), fiber: roundNutrient(totals.fiber),
    };
    commit((current) => ({
      ...current,
      foodLibrary: [...(current.foodLibrary ?? []).filter((food) => food.id !== editingId), setItem].sort((a, b) => a.name.localeCompare(b.name, "ko")),
    }));
  };

  const deleteWorkout = (entry: WorkoutEntry) => {
    if (!window.confirm(`${entry.title} ${entry.kind === "plan" ? "계획" : "기록"}을 삭제할까요?`)) return;
    commit((current) => ({ ...moveToTrash(current, `${entry.date} ${entry.title} ${entry.kind === "plan" ? "계획" : "기록"}`, { workouts: [entry] }), workouts: current.workouts.filter((item) => item.id !== entry.id) }));
  };

  const deleteBody = (record: BodyRecord) => {
    if (!window.confirm(`${record.date} 인바디 기록을 삭제할까요?`)) return;
    commit((current) => ({ ...moveToTrash(current, `${record.date} 인바디`, { bodyRecords: [record] }), bodyRecords: current.bodyRecords.filter((item) => item.id !== record.id) }));
    setSelectedBodyRecord(undefined);
    setModal(null);
  };

  const deleteCircumference = (record: CircumferenceRecord) => {
    if (!window.confirm(`${record.date} 허리·엉덩이둘레 기록을 삭제할까요?`)) return;
    commit((current) => ({ ...moveToTrash(current, `${record.date} 허리·엉덩이둘레`, { circumferenceRecords: [record] }), circumferenceRecords: (current.circumferenceRecords ?? []).filter((item) => item.id !== record.id) }));
    setSelectedCircumferenceRecord(undefined);
    setModal(null);
  };

  const deleteConsultation = (consultation: Consultation) => {
    if (!window.confirm(`${consultation.date} 상담을 삭제할까요?`)) return;
    commit((current) => ({ ...moveToTrash(current, `${consultation.date} 상담`, { consultations: [consultation] }), consultations: current.consultations.filter((item) => item.id !== consultation.id) }));
    setSelectedConsultation(undefined);
    setModal(null);
  };

  const deleteCycle = (entry: CycleEntry) => {
    if (!window.confirm(`${entry.date} 월경·컨디션 기록을 삭제할까요?`)) return;
    commit((current) => ({ ...moveToTrash(current, `${entry.date} 월경·컨디션`, { cycles: [entry] }), cycles: normalizeCycleCoverage(current.cycles.filter((item) => item.id !== entry.id)) }));
    setCycleDate(undefined);
    setCycleRangeDraft(undefined);
    setModal(null);
  };

  const deleteLove = (entry: LoveRecord) => {
    if (!window.confirm(`${entry.date} 사랑 기록을 삭제할까요?`)) return;
    commit((current) => ({ ...moveToTrash(current, `${entry.date} 사랑 기록`, { loveRecords: [entry] }), loveRecords: (current.loveRecords ?? []).filter((item) => item.id !== entry.id) }));
  };

  const deleteCycleRange = (date: string) => {
    const range = cycleRangeAround(state.cycles, date);
    if (!range) return;
    if (!window.confirm(`${range.start} 주기 기록 전체를 삭제할까요?\n이 기간의 월경·컨디션 기록도 함께 삭제됩니다.`)) return;
    const dates = new Set(cycleRangeDates(range.start, range.end));
    const deletedCycles = state.cycles.filter((item) => item.periodId === range.id || dates.has(item.date));
    commit((current) => ({
      ...moveToTrash(current, `${range.start} ~ ${range.end} 월경 주기`, { cycles: deletedCycles }),
      cycles: normalizeCycleCoverage(current.cycles.filter((item) => item.periodId === range.id ? false : !dates.has(item.date))),
    }));
  };

  const saveWeeklyPlan = (start: string, draft: WeeklyDraft) => {
    const dates = new Set(weekDates(start));
    const meals: MealEntry[] = [];
    const workouts: WorkoutEntry[] = [];
    for (const date of dates) {
      const day = draft[date];
      (Object.keys(mealLabels) as MealType[]).forEach((mealType) => {
        day.meals[mealType].forEach((value) => {
          const title = value.trim();
          if (title) meals.push({ id: id("meal-plan"), date, mealType, kind: "plan", title, calories: 0, protein: 0, carbs: 0, fat: 0, sugar: 0, fiber: 0, confidence: "추정" });
        });
      });
      day.workouts.forEach((item) => {
        if (!item.title.trim()) return;
        workouts.push({ id: item.id || id("workout-plan"), date, startTime: item.startTime || undefined, kind: "plan", type: item.type, title: item.title.trim(), minutes: Math.max(1, Number(item.minutes) || 1), intensity: item.intensity, heartRate: item.heartRate.trim(), overlapsSteps: item.type === "유산소" && item.overlapsSteps, details: item.details.trim() });
      });
    }
    commit((current) => ({
      ...current,
      meals: [...current.meals.filter((item) => !(item.kind === "plan" && dates.has(item.date))), ...meals],
      workouts: [...current.workouts.filter((item) => !(item.kind === "plan" && dates.has(item.date))), ...workouts],
    }));
    setWeeklyPlanStart(undefined);
    setWeeklyPlanConsultation(undefined);
    setModal(null);
  };

  const saveCycle = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const editingId = String(data.get("editingId") ?? "");
    const cycleState = String(data.get("state")) as CycleEntry["state"];
    const cycle: CycleEntry = {
      id: editingId || id("cycle"),
      date: String(data.get("date")),
      state: cycleState,
      flow: String(data.get("flow")) as CycleEntry["flow"],
      pain: String(data.get("pain")) as CycleEntry["pain"],
      energy: number(data.get("energy")),
      appetite: number(data.get("appetite")),
      symptoms: data.getAll("symptoms").map(String),
      note: String(data.get("note")),
      periodId: cycleState === "없음" ? undefined : String(data.get("periodId") || "") || undefined,
    };
    commit((current) => ({ ...current, cycles: normalizeCycleCoverage([...current.cycles.filter((item) => item.id !== editingId && item.date !== cycle.date), cycle]) }));
    setCycleDate(undefined);
    setCycleRangeDraft(undefined);
    setModal(null);
  };

  const saveLove = (drafts: Array<{ date: string; count: number; contraception: LoveRecord["contraception"]; note?: string }>) => {
    const selectedDates = [...new Set(drafts.map((draft) => draft.date))].sort();
    commit((current) => {
      const previous = new Map((current.loveRecords ?? []).map((entry) => [entry.date, entry]));
      const nextEntries = drafts.map((draft): LoveRecord => ({
        id: previous.get(draft.date)?.id ?? id("love"),
        date: draft.date,
        count: Math.max(1, draft.count),
        contraception: draft.contraception,
        note: draft.note?.trim() || undefined,
      }));
      return { ...current, loveRecords: [...(current.loveRecords ?? []).filter((item) => !selectedDates.includes(item.date)), ...nextEntries].sort((a, b) => a.date.localeCompare(b.date)) };
    });
    setLoveDate(undefined);
    setModal(null);
  };

  const saveCycleRanges = (ranges: CycleRange[], editingRange?: CycleRange) => {
    commit((current) => {
      const selectedDates = [...new Set(ranges.flatMap((range) => cycleRangeDates(range.start, range.end)))];
      const replaceableDates = new Set(current.cycles.filter((item) => item.source === "period-fill").map((item) => item.date));
      const editingDates = new Set(editingRange ? cycleRangeDates(editingRange.start, editingRange.end) : []);
      const preserved = current.cycles.filter((item) => !editingDates.has(item.date) && (!replaceableDates.has(item.date) || !selectedDates.includes(item.date)));
      const occupiedDates = new Set(preserved.map((item) => item.date));
      const dates = selectedDates.filter((date) => !occupiedDates.has(date));
      const previousByDate = new Map(current.cycles.map((item) => [item.date, item]));
      const rangeByDate = new Map(ranges.flatMap((range) => cycleRangeDates(range.start, range.end).map((date) => [date, range] as const)));
      const imported: CycleEntry[] = dates.map((date) => {
        const range = rangeByDate.get(date)!;
        const previous = previousByDate.get(date);
        return {
          ...(editingDates.has(date) && previous ? previous : {}),
          id: editingDates.has(date) && previous ? previous.id : id("cycle-range"),
          date,
          state: range.states?.[date] ?? "본 출혈",
          flow: previous?.flow ?? "없음",
          pain: previous?.pain ?? "없음",
          symptoms: previous?.symptoms ?? [],
          sexCount: previous?.sexCount ?? 0,
          contraception: previous?.contraception ?? "해당 없음",
          note: previous?.note ?? "",
          source: undefined,
          periodId: range.id,
        };
      });
      return { ...current, cycles: normalizeCycleCoverage([...preserved, ...imported]) };
    });
    setCycleDate(undefined);
    setCycleRangeDraft(undefined);
    setModal(null);
  };

  const backupData = () => {
    const exportedAt = new Date().toISOString();
    const next = { ...state, lastBackupAt: exportedAt };
    const envelope: BackupEnvelope = { format: "SOYA_BACKUP", version: 1, exportedAt, state: next };
    downloadFile(JSON.stringify(envelope, null, 2), `SOYA-전체백업-${today}.json`, "application/json;charset=utf-8");
    commit(() => next);
  };

  const restoreData = (imported: AppState, mode: RestoreMode) => {
    const next = mode === "replace" ? normalizeAppState(imported) : mergeAppState(state, imported);
    commit(() => next);
    setModal(null);
  };

  const restoreDeletedItem = (item: TrashItem) => commit((current) => restoreTrashItem(current, item));
  const permanentlyDeleteTrashItem = (item: TrashItem) => {
    if (!window.confirm(`${item.label}을 휴지통에서도 완전히 삭제할까요?`)) return;
    commit((current) => ({ ...current, trash: (current.trash ?? []).filter((entry) => entry.id !== item.id) }));
  };
  const emptyTrash = () => {
    if (!(state.trash ?? []).length || !window.confirm("휴지통의 기록을 모두 완전히 삭제할까요?")) return;
    commit((current) => ({ ...current, trash: [] }));
  };

  const completeOnboarding = (draft: OnboardingDraft) => {
    const nutritionGoal = Object.fromEntries(
      Object.entries(draft.nutritionGoal).map(([key, value]) => [key, Math.max(0, Number(value) || 0)]),
    ) as AppState["nutritionGoal"];
    commit((current) => ({
      ...current,
      profile: {
        ...current.profile,
        onboardingCompleted: true,
        menstrualTrackingEnabled: draft.menstrualTrackingEnabled,
        nickname: draft.nickname.trim(),
        birthDate: draft.birthDate,
        heightCm: Math.max(1, Number(draft.heightCm) || 1),
        sex: draft.sex,
        mode: draft.mode,
        goalWeek: 1,
        goalStartDate: draft.goalStartDate,
        goalEndDate: draft.goalEndDate,
        targetBodyFatChange: Number(draft.targetBodyFatChange) || 0,
        targetMuscleChange: Number(draft.targetMuscleChange) || 0,
      },
      nutritionGoal,
      workoutGoal: {
        cardioSessions: Math.max(0, Number(draft.cardioSessions) || 0),
        cardioMinutes: Math.max(0, Number(draft.cardioMinutes) || 0),
      },
      reminderSettings: {
        ...(current.reminderSettings ?? defaultReminders),
        bodyEnabled: draft.remindersEnabled,
        mealEnabled: {
          breakfast: draft.remindersEnabled,
          lunch: draft.remindersEnabled,
          dinner: draft.remindersEnabled,
          snack: false,
        },
        workoutEnabled: draft.remindersEnabled,
        weeklyEnabled: draft.remindersEnabled,
        cycleEnabled: draft.remindersEnabled && draft.menstrualTrackingEnabled,
      },
    }));
  };

  const startGoogleSignIn = async () => {
    setAuthMessage("");
    setAuthSigningIn(true);
    try {
      await signInWithGoogle();
    } catch {
      setAuthSigningIn(false);
      setAuthMessage("Google 로그인을 시작하지 못했어요.");
    }
  };

  if (!authReady) return <div className="loading-screen"><Image className="loading-mark" src="/tiger-icon-192.png" width={64} height={64} alt="" /><p>SOYA를 여는 중이에요</p></div>;

  if (authSigningIn && !authUser) return <div className="loading-screen"><Image className="loading-mark" src="/tiger-icon-192.png" width={64} height={64} alt="" /><p>로그인 중...</p></div>;

  if (!authUser) return <main className="login-screen"><section className="login-card"><Image className="login-tiger" src="/tiger-icon-192.png" width={112} height={112} alt="SOYA 호랑이" /><span className="eyebrow">나만의 건강 기록</span><h1>SOYA</h1><p>내 기록은 내 Google 계정에만<br />안전하게 저장돼요.</p><button type="button" className="google-login-button" onClick={() => void startGoogleSignIn()}><span aria-hidden="true">G</span>Google로 로그인</button>{authMessage && <small className="login-error">{authMessage}</small>}</section></main>;

  if (!loaded) return <div className="loading-screen"><Image className="loading-mark" src="/tiger-icon-192.png" width={64} height={64} alt="" /><p>오늘의 기록을 준비하고 있어요</p></div>;

  if (!state.profile.onboardingCompleted) return <OnboardingFlow state={state} today={today} googleName={authUser.displayName ?? ""} complete={completeOnboarding} />;

  return (
    <div className="app-shell">
      <aside className="desktop-nav">
        <div className="brand"><Image className="brand-mark" src="/tiger-icon-192.png" width={46} height={46} alt="" /><div><strong>SOYA</strong><small>온전히 나를 위한 기록</small></div></div>
        <nav>{tabs.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}><NavPixelIcon tab={item.id} />{item.label}</button>)}</nav>
        <div className="side-note"><span>{state.profile.mode} {goalClock.week}주차{travelToday ? " · 여행 중" : ""}</span>{travelToday && <strong>{state.profile.travelLevel ?? "균형 유지"}</strong>}</div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-heading"><span className="topbar-tiger-button" aria-hidden="true"><Image className="topbar-tiger" src="/mascot-top-transparent.png" width={76} height={76} alt="" /></span><div><p className="date-text">{dateLabel(today)}</p><h1>{tab === "today" ? travelToday ? <>여행 중에도<br />내 리듬대로</> : <>오늘도<br />가볍게 기록해요</> : tabs.find((item) => item.id === tab)?.label}</h1></div></div>
          <div className="header-actions"><span className={`save-state ${saveState}`}>{saveState === "saving" ? "저장 중" : saveState === "offline" ? "저장 확인 필요" : "저장됨"}</span><button className="icon-button reminder-button" onClick={() => setModal("reminders")} aria-label="알림 설정"><span className="pixel-bell" aria-hidden="true" /></button><button className={`account-menu-button${auditCount ? " has-audit-alert" : ""}`} type="button" onClick={() => setModal("account")} aria-label={auditCount ? `${state.profile.nickname?.trim() || authUser.displayName?.split(" ")[0] || "사용자"}님, 확인할 기록 ${auditCount}개` : undefined}>{state.profile.nickname?.trim() || authUser.displayName?.split(" ")[0] || "사용자"}님{auditCount > 0 && <span className="account-alert-dot" aria-hidden="true" />}</button></div>
        </header>

        {tab === "today" && (
          <TodayView state={state} today={today} todayBody={todayBody} nutrition={nutrition} completedCount={completedCount} totalCount={completed.length} nextAction={nextAction} mealActual={mealActual} mealPlan={mealPlan} actualWorkouts={actualWorkouts} plannedWorkout={plannedWorkout} openNextAction={openNextAction} skipNextAction={skipNextAction} setModal={setModal} setTab={setTab} openMeal={openMeal} openWorkout={openWorkout} openActivity={(date) => { setActivityDate(date); setModal("activity"); }} syncAppleHealth={() => startAppleHealthSync()} appleHealthSyncing={appleHealthSyncing} updateTravelDayLevel={updateTravelDayLevel} />
        )}
        {tab === "food" && <FoodView state={state} today={today} openMeal={openMeal} deleteMeal={deleteMeal} openGoal={() => setModal("nutrition-goal")} openLibrary={() => setModal("food-library")} openActivity={(date) => { setActivityDate(date); setModal("activity"); }} updateTravelDayLevel={updateTravelDayLevel} />}
        {tab === "workout" && <WorkoutView state={state} today={today} openWorkout={openWorkout} deleteWorkout={deleteWorkout} openGoal={() => setModal("workout-goal")} openActivity={(date) => { setActivityDate(date); setModal("activity"); }} updateTravelDayLevel={updateTravelDayLevel} />}
        {tab === "menstrual" && <MenstrualView state={state} today={today} openRecord={(date) => { setCycleRangeDraft(undefined); setCycleDate(date); setModal("cycle"); }} openLove={(date) => { setLoveDate(date); setModal("love"); }} editRange={(date) => { const range = cycleRangeAround(state.cycles, date); if (range) { setCycleRangeDraft(range); setCycleDate(date); setModal("cycle"); } }} deleteRange={deleteCycleRange} />}
        {tab === "change" && <ChangeConsultView state={state} today={today} setModal={setModal} commit={commit} openWeeklyPlan={(start, consultation) => { setWeeklyPlanStart(start); setWeeklyPlanConsultation(consultation); setModal("weekly-plan"); }} deleteConsultation={deleteConsultation} openBodyDetail={(record) => { setSelectedBodyRecord(record); setModal("body-detail"); }} openCircumference={(record) => { setSelectedCircumferenceRecord(record); setModal("circumference"); }} openConsultationDetail={(consultation) => { setSelectedConsultation(consultation); setModal("consultation-detail"); }} openGoalHistory={(goal) => { setSelectedGoalHistory(goal); setModal("goal-history-detail"); }} />}
      </main>

      <button className={`fab${fabVisible ? "" : " fab-hidden"}`} onClick={() => setModal("quick")} aria-label="빠른 추가" aria-hidden={!fabVisible} tabIndex={fabVisible ? 0 : -1}>+</button>
      <div className="mobile-nav-shield" aria-hidden="true" />
      <nav className="mobile-nav">{tabs.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}><NavPixelIcon tab={item.id} /><small>{item.label}</small></button>)}</nav>

      {modal === "quick" && <QuickSheet close={closeModal} select={(next) => { if (next === "body") setSelectedBodyRecord(undefined); if (next === "circumference") setSelectedCircumferenceRecord(undefined); if (next === "cycle") { setCycleDate(undefined); setCycleRangeDraft(undefined); } if (next === "weekly-plan") { setWeeklyPlanStart(undefined); setWeeklyPlanConsultation(undefined); } if (next === "workout-plan" || next === "workout-actual") { setWorkoutDraft(undefined); setWorkoutPresetType(undefined); } if (next === "meal-plan" || next === "meal-actual") { setMealPresetType(undefined); setMealDraft(undefined); setMealDate(undefined); } setModal(next); }} />}
      {modal === "measurement-picker" && <MeasurementPickerSheet close={closeModal} select={(next) => { setSelectedBodyRecord(undefined); setSelectedCircumferenceRecord(undefined); setModal(next); }} />}
      {modal === "movement-picker" && <MovementPickerSheet close={closeModal} select={(next) => { if (next === "workout-actual") { setWorkoutDraft(undefined); setWorkoutPresetType(undefined); } if (next === "activity") setActivityDate(undefined); setModal(next); }} />}
      {modal === "body" && <BodySheet today={today} latest={state.bodyRecords.find((item) => item.id !== selectedBodyRecord?.id)} draft={selectedBodyRecord} openHistory={() => { setSelectedBodyRecord(undefined); setModal("body-bulk"); }} close={closeModal} save={saveBody} />}
      {modal === "body-bulk" && <BodyBulkSheet existing={state.bodyRecords} close={closeModal} save={saveBodyBulk} />}
      {modal === "body-detail" && selectedBodyRecord && <BodyDetailSheet record={selectedBodyRecord} close={closeModal} edit={() => setModal("body")} remove={() => deleteBody(selectedBodyRecord)} />}
      {modal === "circumference" && <CircumferenceSheet today={today} latest={(state.circumferenceRecords ?? []).find((item) => item.id !== selectedCircumferenceRecord?.id)} draft={selectedCircumferenceRecord} close={closeModal} save={saveCircumference} remove={deleteCircumference} />}
      {modal === "activity" && <ActivitySheet today={activityDate ?? today} draft={(state.dailyActivities ?? []).find((item) => item.date === (activityDate ?? today))} openAppleHealth={() => setModal("apple-health")} close={closeModal} save={saveActivity} remove={deleteActivity} />}
      {modal === "apple-health" && <AppleHealthSheet close={closeAppleHealth} refresh={refreshFromCloud} syncNow={startAppleHealthSync} syncing={appleHealthSyncing} />}
      {(modal === "meal-plan" || modal === "meal-actual") && <MealSheet today={mealDate ?? today} kind={modal === "meal-plan" ? "plan" : "actual"} library={state.foodLibrary ?? []} draft={mealDraft} presetType={mealPresetType} close={closeModal} save={saveMeal} />}
      {modal === "food-library" && <FoodLibrarySheet library={state.foodLibrary ?? []} close={closeModal} save={saveFoodLibraryItem} saveSet={saveFoodSet} remove={deleteFoodLibraryItem} />}
      {modal === "nutrition-goal" && <NutritionGoalSheet goal={state.nutritionGoal} close={closeModal} save={saveNutritionGoal} />}
      {modal === "profile-goal" && <ProfileGoalSheet profile={state.profile} latestBody={[...state.bodyRecords].sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`))[0]} today={today} close={closeModal} save={saveProfileGoal} />}
      {modal === "goal-complete" && <GoalCompletionSheet state={state} today={today} close={closeModal} save={finishCurrentGoal} />}
      {modal === "goal-history-detail" && selectedGoalHistory && <GoalHistoryDetailSheet goal={selectedGoalHistory} close={closeModal} />}
      {modal === "profile-settings" && <ProfileSettingsSheet profile={state.profile} googleName={authUser.displayName ?? undefined} today={today} close={closeAccountChild} save={saveProfileSettings} />}
      {modal === "account" && <AccountSheet nickname={state.profile.nickname?.trim() || authUser.displayName?.split(" ")[0] || "사용자"} auditCount={auditCount} close={closeModal} openProfile={() => setModal("profile-settings")} openAudit={() => setModal("data-audit")} openData={() => setModal("data-management")} logout={async () => { await saveQueue.current; await signOutGoogleUser(); }} />}
      {(modal === "workout-plan" || modal === "workout-actual") && <WorkoutSheet today={today} kind={modal === "workout-plan" ? "plan" : "actual"} draft={workoutDraft} presetType={workoutPresetType} close={closeModal} save={saveWorkout} />}
      {modal === "workout-goal" && <WorkoutGoalSheet goal={state.workoutGoal ?? initialState.workoutGoal!} close={closeModal} save={saveWorkoutGoal} />}
      {modal === "weekly-plan" && <WeeklyPlanSheet state={state} today={today} initialStart={weeklyPlanStart} consultation={weeklyPlanConsultation} close={() => { setWeeklyPlanStart(undefined); setWeeklyPlanConsultation(undefined); closeModal(); }} save={saveWeeklyPlan} />}
      {modal === "cycle" && <CycleSheet today={cycleDate ?? today} draft={state.cycles.find((item) => item.date === (cycleDate ?? today))} previous={state.cycles.find((item) => item.date === addDays(cycleDate ?? today, -1))} existing={state.cycles} initialRange={cycleRangeDraft} openLove={() => { setLoveDate(cycleDate ?? today); setModal("love"); }} close={closeModal} save={saveCycle} saveRanges={saveCycleRanges} remove={deleteCycle} />}
      {modal === "love" && <LoveSheet today={today} anchorDate={loveDate ?? today} existing={state.loveRecords ?? []} close={closeModal} save={saveLove} remove={deleteLove} />}
      {modal === "consultation-detail" && selectedConsultation && <ConsultationDetailSheet consultation={selectedConsultation} close={closeModal} remove={() => deleteConsultation(selectedConsultation)} />}
      {modal === "reminders" && <ReminderSettingsSheet settings={state.reminderSettings ?? defaultReminders} pushStatus={pushStatus} pushMessage={pushMessage} enablePush={() => { void enableActualNotifications(); }} disablePush={() => { void disableActualNotifications(); }} close={closeModal} save={saveReminders} />}
      {modal === "data-management" && <DataManagementSheet state={state} today={today} close={closeAccountChild} backup={backupData} exportCsv={(kind) => exportCsv(state, kind, today)} restore={restoreData} restoreDeleted={restoreDeletedItem} permanentlyDelete={permanentlyDeleteTrashItem} emptyTrash={emptyTrash} />}
      {modal === "data-audit" && <RecordAuditSheet state={state} today={today} close={closeAccountChild} openTarget={openAuditTarget} />}
    </div>
  );
}

type TodayViewProps = {
  state: AppState;
  today: string;
  todayBody?: BodyRecord;
  nutrition: { calories: number; protein: number; carbs: number; fat: number; sugar: number; fiber: number };
  completedCount: number;
  totalCount: number;
  nextAction: NextAction;
  mealActual: (mealType: MealType) => MealEntry | undefined;
  mealPlan: (mealType: MealType) => MealEntry | undefined;
  actualWorkouts: WorkoutEntry[];
  plannedWorkout?: WorkoutEntry;
  openNextAction: () => void;
  skipNextAction: () => void;
  setModal: (modal: Modal) => void;
  setTab: (tab: Tab) => void;
  openMeal: (kind: EntryKind, presetType?: MealType, draft?: MealEntry, date?: string) => void;
  openWorkout: (kind: EntryKind, draft?: WorkoutEntry, presetType?: WorkoutEntry["type"]) => void;
  openActivity: (date: string) => void;
  syncAppleHealth: () => void;
  appleHealthSyncing: boolean;
  updateTravelDayLevel: (date: string, level: TravelLevel) => void;
};

function bodyGoalProgressFor(state: AppState, endDate: string) {
  const goalStart = state.profile.goalStartDate ?? endDate;
  const records = state.bodyRecords
    .filter((item) => item.date >= goalStart && item.date <= endDate)
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  const baseline = records[0];
  const latestRecord = records.at(-1);
  const percent = (change: number, target: number, tolerance: number) => {
    if (target === 0) return Math.abs(change) <= tolerance ? 100 : 0;
    return Math.min(100, Math.max(0, change / target * 100));
  };
  if (!baseline || !latestRecord) return { baseline, latestRecord, bodyFatChange: 0, muscleChange: 0, bodyFatPercent: 0, musclePercent: 0 };
  const bodyFatChange = roundNutrient(latestRecord.bodyFatMass - baseline.bodyFatMass);
  const muscleChange = roundNutrient(latestRecord.skeletalMuscle - baseline.skeletalMuscle);
  return {
    baseline,
    latestRecord,
    bodyFatChange,
    muscleChange,
    bodyFatPercent: percent(bodyFatChange, state.profile.targetBodyFatChange, .2),
    musclePercent: percent(muscleChange, state.profile.targetMuscleChange, .1),
  };
}

function goalReportFor(state: AppState, endDate: string): NonNullable<GoalHistoryEntry["report"]> {
  const startDate = state.profile.goalStartDate ?? endDate;
  const progress = bodyGoalProgressFor(state, endDate);
  const actualMeals = state.meals.filter((entry) => entry.kind === "actual" && !entry.skipped && entry.date >= startDate && entry.date <= endDate);
  const mealDays = new Set(actualMeals.map((entry) => entry.date)).size;
  const average = (key: "calories" | "protein" | "carbs" | "fat" | "sugar" | "fiber") => mealDays
    ? roundNutrient(actualMeals.reduce((sum, entry) => sum + entry[key], 0) / mealDays)
    : undefined;
  const plannedWorkouts = state.workouts.filter((entry) => entry.kind === "plan" && entry.date >= startDate && entry.date <= endDate);
  const completedWorkouts = state.workouts.filter((entry) => entry.kind === "actual" && entry.date >= startDate && entry.date <= endDate);
  const cycleByDate = new Map(state.cycles.map((entry) => [entry.date, entry]));
  const goalCycles = state.cycles.filter((entry) => entry.date >= startDate && entry.date <= endDate);
  const travelStart = state.profile.travelStartDate;
  const travelEnd = state.profile.travelEndDate;
  const travelDays = travelStart && travelEnd
    ? cycleRangeDates(startDate, endDate).filter((date) => date >= travelStart && date <= travelEnd).length
    : 0;
  return {
    bodyFatStart: progress.baseline?.bodyFatMass,
    bodyFatEnd: progress.latestRecord?.bodyFatMass,
    muscleStart: progress.baseline?.skeletalMuscle,
    muscleEnd: progress.latestRecord?.skeletalMuscle,
    bodyFatProgress: Math.round(progress.bodyFatPercent),
    muscleProgress: Math.round(progress.musclePercent),
    mealDays,
    averageCalories: average("calories"),
    averageProtein: average("protein"),
    averageCarbs: average("carbs"),
    averageFat: average("fat"),
    averageSugar: average("sugar"),
    averageFiber: average("fiber"),
    plannedWorkouts: plannedWorkouts.length,
    completedWorkouts: completedWorkouts.length,
    workoutMinutes: completedWorkouts.reduce((sum, entry) => sum + entry.minutes, 0),
    ptSessions: completedWorkouts.filter((entry) => entry.type === "PT").length,
    cardioSessions: completedWorkouts.filter((entry) => entry.type === "유산소").length,
    cardioMinutes: completedWorkouts.filter((entry) => entry.type === "유산소").reduce((sum, entry) => sum + entry.minutes, 0),
    mainBleedingDays: goalCycles.filter((entry) => entry.state === "본 출혈").length,
    cycleStarts: goalCycles.filter((entry) => entry.state === "본 출혈" && cycleByDate.get(addDays(entry.date, -1))?.state !== "본 출혈").length,
    travelDays,
    consultations: state.consultations.filter((entry) => entry.date >= startDate && entry.date <= endDate).length,
  };
}

function BodyGoalProgress({ state, endDate }: { state: AppState; endDate: string }) {
  const progress = bodyGoalProgressFor(state, endDate);
  return <section className="weekly-goal-progress">
    <div className="weekly-goal-progress-heading"><strong>목표 진행</strong><small>{progress.baseline && progress.latestRecord ? `${progress.baseline.date.replaceAll("-", ".")} → ${progress.latestRecord.date.replaceAll("-", ".")}` : "기준 측정 필요"}</small></div>
    <div className="weekly-goal-progress-grid">
      <article><div><span>체지방량</span><strong>{Math.round(progress.bodyFatPercent)}%</strong></div><div className="weekly-progress-track"><i className="body-fat" style={{ width: `${progress.bodyFatPercent}%` }} /></div><p>{progress.baseline ? `${signed(progress.bodyFatChange)}kg` : "-"} / 목표 {signed(state.profile.targetBodyFatChange)}kg</p></article>
      <article><div><span>골격근량</span><strong>{Math.round(progress.musclePercent)}%</strong></div><div className="weekly-progress-track"><i className="muscle" style={{ width: `${progress.musclePercent}%` }} /></div><p>{progress.baseline ? `${signed(progress.muscleChange)}kg` : "-"} / 목표 {signed(state.profile.targetMuscleChange)}kg</p></article>
    </div>
  </section>;
}

function TodayView(props: TodayViewProps) {
  const { state, today, todayBody, nutrition, completedCount, totalCount, nextAction, mealActual, mealPlan, actualWorkouts, plannedWorkout, openNextAction, skipNextAction, setModal, setTab, openMeal, openWorkout, openActivity, syncAppleHealth, appleHealthSyncing, updateTravelDayLevel } = props;
  const goal = state.nutritionGoal;
  const latest = todayBody ?? state.bodyRecords[0];
  const prev = state.bodyRecords.find((item: BodyRecord) => item.id !== latest?.id);
  const cycle = state.cycles.find((item: CycleEntry) => item.date === today);
  const phase = menstrualPhase(state.cycles, today);
  const workoutGoal = state.workoutGoal ?? initialState.workoutGoal!;
  const cardio = weeklyCardio(state, today);
  const targetTiming = goalTiming(state.profile, today);
  const targetProgress = bodyGoalProgressFor(state, today);
  const hasGoalTrend = Boolean(targetProgress.baseline && targetProgress.latestRecord && targetProgress.baseline.id !== targetProgress.latestRecord.id);
  const goalTargetsReached = hasGoalTrend
    && (state.profile.targetBodyFatChange === 0 || targetProgress.bodyFatPercent >= 100)
    && (state.profile.targetMuscleChange === 0 || targetProgress.musclePercent >= 100);
  const goalReady = targetTiming.daysLeft === 0 || goalTargetsReached;
  const todayTravelLevel = travelLevelForDate(state.profile, today);
  const travelToday = isTravelDate(state.profile, today);
  const energy = dailyEnergyGuide(state, today);
  return <div className="dashboard-grid">
    <section className="next-card full-card">
      <div><span className="eyebrow">{nextAction.eyebrow}</span><h2>{nextAction.title}</h2><p>{nextAction.type !== "done" && <b className={`next-time ${nextAction.due ? "due" : "upcoming"}`}>{nextAction.time} {nextAction.due ? "알림" : "예정"}</b>}{nextAction.detail}</p></div>
      {nextAction.type !== "done" && <div className="next-actions"><button className="ghost-button" onClick={skipNextAction}>오늘은 건너뛰기</button><button className="primary-button" onClick={openNextAction}>{nextAction.type === "weekly" ? "계획하기" : "기록하기"} <span>→</span></button></div>}
    </section>

    <div className="home-layout-row home-layout-primary">
      <div className="home-layout-stack home-layout-primary-stack">
        <section className="card goal-summary-card">
          <CardTitle title="현재 목표" aside={<span className="goal-summary-actions">{goalReady ? <button className="text-button" onClick={() => setModal("goal-complete")}>목표 마무리</button> : <button className="text-button" onClick={() => setModal("profile-goal")}>목표 수정</button>}</span>} />
          <div className="goal-mode-line"><span className={`goal-mode-badge mode-${state.profile.mode}`}>{state.profile.mode}</span><strong>{targetTiming.week}주차 · {targetTiming.daysLeft}일 남음</strong></div>
          {goalReady && <button type="button" className="goal-ready-banner" onClick={() => setModal("goal-complete")}><span>{goalTargetsReached && targetTiming.daysLeft > 0 ? "목표를 일찍 달성했어요" : "목표 기간이 끝났어요"}</span><strong>목표 마무리하기 →</strong></button>}
          <div className="goal-target-grid"><div><span>체지방량</span><strong>{signed(state.profile.targetBodyFatChange)}kg</strong></div><div><span>골격근량</span><strong>{signed(state.profile.targetMuscleChange)}kg</strong></div></div>
          {travelToday && <><div className="travel-level"><span>여행 모드 · 기본</span><strong>{state.profile.travelLevel ?? "균형 유지"}</strong></div><TravelDayControl date={today} level={todayTravelLevel} defaultLevel={state.profile.travelLevel ?? "균형 유지"} onChange={updateTravelDayLevel} /></>}
          <BodyGoalProgress state={state} endDate={today} />
        </section>

        <button type="button" className={`card home-cycle-card phase-${phase.key}`} onClick={() => setTab("menstrual")}>
          <span>오늘의 주기</span>
          <strong>{phase.label}</strong>
          <p>{phase.detail}</p>
          <b aria-hidden="true">›</b>
        </button>
      </div>

      <section className="card records-card">
        <CardTitle title="오늘 기록" aside={`${completedCount}/${totalCount}`} />
        <div className="record-list">
          {!travelToday && <RecordRow label="인바디" detail={todayBody ? `${todayBody.bodyFatMass}kg 체지방 · ${todayBody.skeletalMuscle}kg 골격근` : "아직 기록하지 않음"} done={Boolean(todayBody)} onClick={() => setModal("body")} />}
          {(["breakfast", "lunch", "dinner"] as MealType[]).map((type) => { const actual = mealActual(type); const plan = mealPlan(type); return <RecordRow key={type} label={mealLabels[type]} detail={actual ? actual.title : plan ? `계획 · ${plan.title}` : "아직 기록하지 않음"} done={Boolean(actual)} onClick={() => openMeal("actual", type, actual ?? plan, today)} />; })}
          {plannedWorkout && <RecordRow label="운동" detail={actualWorkouts[0]?.title ?? `계획 · ${plannedWorkout.title}`} done={actualWorkouts.length > 0} onClick={() => openWorkout("actual", plannedWorkout)} />}
          {cycle && <RecordRow label="몸 상태" detail={cycleSummary(cycle)} done onClick={() => setModal("cycle")} />}
        </div>
      </section>
    </div>

    <div className="home-layout-row home-layout-secondary">
      <section className="card nutrition-card">
      <CardTitle title="오늘의 영양" aside={<button className="text-button" onClick={() => setModal("nutrition-goal")}>목표 설정</button>} />
      <div className="calorie-total"><strong>{nutrition.calories.toLocaleString()}</strong><span>kcal</span>{!(travelToday && todayTravelLevel === "가볍게 기록") && <small>/ {energy.intakeMin.toLocaleString()}~{energy.intakeMax.toLocaleString()}</small>}</div>
      {!(travelToday && todayTravelLevel === "가볍게 기록") && <div className="energy-guide-mini"><span>{energy.activity ? <><b>걸음 {energy.activity.steps.toLocaleString()}걸음 · 활동 {energy.activityCalories.toLocaleString()} kcal · 총소모 약 {energy.expenditure.toLocaleString()} kcal</b>{energy.activity.source === "apple_health" && energy.activity.importedAt && <small>{new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit" }).format(new Date(energy.activity.importedAt))} 동기화</small>}</> : "활동을 기록하면 오늘의 섭취 범위를 조정해요"}</span><div className="energy-guide-actions"><button type="button" className="health-sync-mini-button" disabled={appleHealthSyncing} onClick={syncAppleHealth}>{appleHealthSyncing ? "동기화 중" : "지금 동기화"}</button><button type="button" onClick={() => openActivity(today)}>{energy.activity ? "수정" : "직접 기록"}</button></div></div>}
      {!(travelToday && todayTravelLevel === "가볍게 기록") && <NutrientBar label="단백질" value={nutrition.protein} min={goal.proteinMin} max={goal.proteinMax} unit="g" tone="coral" />}
      {!(travelToday && todayTravelLevel !== "목표 유지") && <><NutrientBar label="탄수화물" value={nutrition.carbs} min={goal.carbsMin} max={goal.carbsMax} unit="g" tone="gold" /><NutrientBar label="지방" value={nutrition.fat} min={goal.fatMin} max={goal.fatMax} unit="g" tone="sage" /></>}
      <div className="micro-grid"><MicroStat label="당류" value={travelToday && todayTravelLevel === "가볍게 기록" ? `${nutrition.sugar}g` : `${nutrition.sugar} / ${goal.sugarMax}g`} hint={travelToday && todayTravelLevel === "가볍게 기록" ? "기록값" : "상한 기준"} /><MicroStat label="식이섬유" value={travelToday && todayTravelLevel === "가볍게 기록" ? `${nutrition.fiber}g` : `${nutrition.fiber} / ${goal.fiberMin}g`} hint={travelToday && todayTravelLevel === "가볍게 기록" ? "기록값" : "최소 목표"} /></div>
      </section>

      <div className="home-layout-stack home-layout-secondary-stack">
        <section className="card body-card">
          <CardTitle title="최근 체성분" aside={<button className="text-button" onClick={() => setTab("change")}>변화 보기</button>} />
          <div className="body-highlight"><div><span>체지방량</span><strong>{latest?.bodyFatMass ?? "-"}<small>kg</small></strong><em>{prev ? `${latest.bodyFatMass - prev.bodyFatMass >= 0 ? "+" : ""}${(latest.bodyFatMass - prev.bodyFatMass).toFixed(1)}kg` : "첫 기록"}</em></div><div><span>골격근량</span><strong>{latest?.skeletalMuscle ?? "-"}<small>kg</small></strong><em>{prev ? `${latest.skeletalMuscle - prev.skeletalMuscle >= 0 ? "+" : ""}${(latest.skeletalMuscle - prev.skeletalMuscle).toFixed(1)}kg` : "첫 기록"}</em></div></div>
        </section>

        <section className="card week-card">
          <CardTitle title={travelToday && todayTravelLevel !== "목표 유지" ? "이번 주 움직임" : "이번 주"} aside={<button className="text-button" onClick={() => setModal("workout-goal")}>목표 설정</button>} />
          <div className="weekly-line"><div><span>유산소</span><strong>{cardio.sessions}{travelToday && todayTravelLevel !== "목표 유지" ? "회" : ` / ${workoutGoal.cardioSessions}회`}</strong></div>{!(travelToday && todayTravelLevel !== "목표 유지") && <div className="progress-track"><i style={{ width: `${Math.min(100, cardio.sessions / workoutGoal.cardioSessions * 100)}%` }} /></div>}</div>
          <div className="weekly-line"><div><span>누적 시간</span><strong>{cardio.minutes}{travelToday && todayTravelLevel !== "목표 유지" ? "분" : ` / ${workoutGoal.cardioMinutes}분`}</strong></div>{!(travelToday && todayTravelLevel !== "목표 유지") && <div className="progress-track"><i style={{ width: `${Math.min(100, cardio.minutes / workoutGoal.cardioMinutes * 100)}%` }} /></div>}</div>
          <button className="secondary-button" onClick={() => openWorkout("actual")}>운동 기록 추가</button>
        </section>
      </div>
    </div>
  </div>;
}

function FoodView({ state, today, openMeal, deleteMeal, openGoal, openLibrary, openActivity, updateTravelDayLevel }: { state: AppState; today: string; openMeal: (kind: EntryKind, presetType?: MealType, draft?: MealEntry, date?: string) => void; deleteMeal: (entry: MealEntry) => void; openGoal: () => void; openLibrary: () => void; openActivity: (date: string) => void; updateTravelDayLevel: (date: string, level: TravelLevel) => void }) {
  const [selectedMonth, setSelectedMonth] = useState(today.slice(0, 7));
  const [selectedDate, setSelectedDate] = useState(today);
  const [nutritionMode, setNutritionMode] = useState<EntryKind>("actual");
  const cells = monthCells(`${selectedMonth}-01`);
  const mealStatus = (date: string) => {
    const meals = state.meals.filter((item) => item.date === date && item.kind === "actual" && !item.skipped);
    const energy = dailyEnergyGuide(state, date);
    return assessNutrition(nutritionTotal(meals), meals.length, new Set(meals.map((item) => item.mealType)).size >= 3, state.profile, state.nutritionGoal, date, { min: energy.intakeMin, max: energy.intakeMax });
  };
  const hasMealPlan = (date: string) => state.meals.some((item) => item.date === date && item.kind === "plan");
  const changeMonth = (month: string) => {
    setSelectedMonth(month);
    if (!selectedDate.startsWith(month)) setSelectedDate(`${month}-01`);
  };
  const goToday = () => {
    setSelectedMonth(today.slice(0, 7));
    setSelectedDate(today);
  };
  const selectedNutritionMeals = state.meals.filter((item) => item.date === selectedDate && item.kind === nutritionMode && !item.skipped);
  const selectedNutrition = nutritionTotal(selectedNutritionMeals);
  const goal = state.nutritionGoal;
  const selectedTravelLevel = travelLevelForDate(state.profile, selectedDate);
  const selectedIsTravel = isTravelDate(state.profile, selectedDate);
  const energy = dailyEnergyGuide(state, selectedDate);
  const nutritionTone = assessNutrition(selectedNutrition, selectedNutritionMeals.length, new Set(selectedNutritionMeals.map((item) => item.mealType)).size >= 3, state.profile, goal, selectedDate, { min: energy.intakeMin, max: energy.intakeMax });
  const nutritionLabel = nutritionTone === "balanced" ? "잘했어요" : nutritionTone === "attention" ? "아쉬워요" : nutritionTone === "partial" ? "괜찮아요" : nutritionMode === "plan" ? "계획 없음" : "기록 없음";
  const calorieGuide = selectedIsTravel && selectedTravelLevel === "가볍게 기록" ? "이날은 기록을 남긴 것만으로 충분해요" : selectedIsTravel && selectedTravelLevel === "균형 유지" ? "이날은 단백질·당류·식이섬유 중심으로 살펴봐요" : selectedNutrition.calories < energy.intakeMin ? `권장 하한까지 ${Math.round(energy.intakeMin - selectedNutrition.calories)} kcal` : selectedNutrition.calories <= energy.intakeMax ? "오늘의 권장 범위 안" : `권장 상한보다 ${Math.round(selectedNutrition.calories - energy.intakeMax)} kcal 많음`;
  return <div className="section-stack"><section className="card pixel-calendar-card food-calendar-card"><div className="calendar-heading calendar-heading-stacked food-calendar-heading"><span className="eyebrow">식단 밸런스</span><div className="calendar-toolbar"><MonthNavigator value={selectedMonth} onChange={changeMonth} onToday={goToday} /><div className="calendar-toolbar-actions food-calendar-actions"><button className="food-calendar-library-button" onClick={openLibrary}>음식 보관함 추가</button><div className="food-calendar-action-row"><button className="ghost-button" onClick={() => openMeal("plan", undefined, undefined, selectedDate)}>계획</button><button className="primary-button" onClick={() => openMeal("actual", undefined, undefined, selectedDate)}>기록</button></div></div></div></div><div className="calendar-weekdays">{["일", "월", "화", "수", "목", "금", "토"].map((day) => <span key={day}>{day}</span>)}</div><div className="month-grid">{cells.map((date, index) => date ? <button type="button" key={date} onClick={() => setSelectedDate(date)} className={`calendar-day calendar-day-with-spacer ${mealStatus(date)} ${hasMealPlan(date) ? "meal-planned" : ""} ${date === today ? "today" : ""} ${date === selectedDate ? "selected" : ""}`}><b>{Number(date.slice(-2))}</b><span className="calendar-day-spacer" aria-hidden="true" /></button> : <span className="calendar-blank" key={`blank-${index}`} />)}</div><div className="calendar-legend"><span><i className="balanced" />잘했어요</span><span><i className="partial" />괜찮아요</span><span><i className="attention" />아쉬워요</span><span><b className="plan-heart">♥</b>계획</span></div></section>
    <section className="card daily-nutrition-card">
      <CardTitle title={`${dateLabel(selectedDate)} 영양`} aside={<button className="text-button" onClick={openGoal}>목표 설정</button>} />
      {selectedIsTravel && <TravelDayControl date={selectedDate} level={selectedTravelLevel} defaultLevel={state.profile.travelLevel ?? "균형 유지"} onChange={updateTravelDayLevel} />}
      <div className="nutrition-mode-tabs"><button type="button" className={nutritionMode === "actual" ? "active" : ""} onClick={() => setNutritionMode("actual")}>실제 섭취</button><button type="button" className={nutritionMode === "plan" ? "active" : ""} onClick={() => setNutritionMode("plan")}>계획 예상</button></div>
      <div className="nutrition-summary-heading"><div className="calorie-total"><strong>{selectedNutrition.calories.toLocaleString()}</strong><span>kcal</span>{!(selectedIsTravel && selectedTravelLevel === "가볍게 기록") && <small>/ {energy.intakeMin.toLocaleString()}~{energy.intakeMax.toLocaleString()}</small>}</div><span className={`nutrition-status ${nutritionTone}`}>{nutritionLabel}</span></div>
      <p className="calorie-guide">{calorieGuide}</p>
      {!(selectedIsTravel && selectedTravelLevel === "가볍게 기록") && <div className="activity-energy-panel"><div><span>하루 활동</span><strong>{energy.activity ? `${energy.activity.steps.toLocaleString()}걸음` : "기록 필요"}</strong><small>{energy.activity ? `활동 ${energy.activityCalories.toLocaleString()} kcal · 총소모 약 ${energy.expenditure.toLocaleString()} kcal` : "기록하면 권장 범위를 다시 계산해요"}</small></div><button type="button" onClick={() => openActivity(selectedDate)}>{energy.activity ? "수정" : "기록"}</button></div>}
      {!(selectedIsTravel && selectedTravelLevel === "가볍게 기록") && <div className="daily-nutrient-grid"><NutrientBar label="단백질" value={selectedNutrition.protein} min={goal.proteinMin} max={goal.proteinMax} unit="g" tone="coral" />{(!selectedIsTravel || selectedTravelLevel === "목표 유지") && <><NutrientBar label="탄수화물" value={selectedNutrition.carbs} min={goal.carbsMin} max={goal.carbsMax} unit="g" tone="gold" /><NutrientBar label="지방" value={selectedNutrition.fat} min={goal.fatMin} max={goal.fatMax} unit="g" tone="sage" /></>}</div>}
      <div className="micro-grid"><MicroStat label="당류" value={selectedIsTravel && selectedTravelLevel === "가볍게 기록" ? `${selectedNutrition.sugar}g` : `${selectedNutrition.sugar} / ${goal.sugarMax}g`} hint={selectedIsTravel && selectedTravelLevel === "가볍게 기록" ? "기록값" : "상한 기준"} /><MicroStat label="식이섬유" value={selectedIsTravel && selectedTravelLevel === "가볍게 기록" ? `${selectedNutrition.fiber}g` : `${selectedNutrition.fiber} / ${goal.fiberMin}g`} hint={selectedIsTravel && selectedTravelLevel === "가볍게 기록" ? "기록값" : "최소 목표"} /></div>
    </section>
    <section className="card"><CardTitle title={`${dateLabel(selectedDate)} 식단`} aside={<button className="text-button" onClick={() => openMeal("actual", undefined, undefined, selectedDate)}>먹은 식사 추가</button>} />
      <div className="meal-cards">{(["breakfast", "lunch", "dinner", "snack"] as MealType[]).map((type) => {
        const plans = state.meals.filter((m) => m.date === selectedDate && m.mealType === type && m.kind === "plan");
        const actuals = state.meals.filter((m) => m.date === selectedDate && m.mealType === type && m.kind === "actual");
        return <article key={type} className="meal-card editable-meal-card"><div><span>{mealLabels[type]}</span>{actuals.length > 0 && <b>기록 완료</b>}</div>
          {plans.map((plan) => <EntryItem key={plan.id} label="계획" title={plan.title} record={() => openMeal("actual", type, plan, selectedDate)} edit={() => openMeal("plan", type, plan, selectedDate)} remove={() => deleteMeal(plan)} />)}
          {actuals.map((actual) => <EntryItem key={actual.id} label="기록" title={actual.title} detail={actual.skipped ? "건너뜀으로 기록" : `${actual.calories} kcal · 단백질 ${actual.protein}g`} edit={() => openMeal("actual", type, actual, selectedDate)} remove={() => deleteMeal(actual)} />)}
          {!plans.length && !actuals.length && <p className="no-entry">아직 계획이나 기록이 없어요.</p>}
          <div className="meal-add-actions">{!actuals.length && <button onClick={() => openMeal("plan", type, undefined, selectedDate)}>계획 추가</button>}<button onClick={() => openMeal("actual", type, undefined, selectedDate)}>{actuals.length ? "기록 추가" : "기록하기"}</button></div>
        </article>;
      })}</div>
    </section>
  </div>;
}

function WorkoutView({ state, today, openWorkout, deleteWorkout, openGoal, openActivity, updateTravelDayLevel }: { state: AppState; today: string; openWorkout: (kind: EntryKind, draft?: WorkoutEntry, presetType?: WorkoutEntry["type"]) => void; deleteWorkout: (entry: WorkoutEntry) => void; openGoal: () => void; openActivity: (date: string) => void; updateTravelDayLevel: (date: string, level: TravelLevel) => void }) {
  const [selectedMonth, setSelectedMonth] = useState(today.slice(0, 7));
  const [selectedDate, setSelectedDate] = useState(today);
  const entries = state.workouts.filter((item) => item.date === selectedDate);
  const cells = monthCells(`${selectedMonth}-01`);
  const goal = state.workoutGoal ?? initialState.workoutGoal!;
  const cardio = weeklyCardio(state, today);
  const selectedTravelLevel = travelLevelForDate(state.profile, selectedDate);
  const selectedIsTravel = isTravelDate(state.profile, selectedDate);
  const energy = dailyEnergyGuide(state, selectedDate);
  const openForDate = (kind: EntryKind) => openWorkout(kind, { id: "", date: selectedDate, kind, type: "유산소", title: "", minutes: 35, intensity: 5, heartRate: "", overlapsSteps: false, details: "" });
  const changeMonth = (month: string) => {
    setSelectedMonth(month);
    if (!selectedDate.startsWith(month)) setSelectedDate(`${month}-01`);
  };
  const goToday = () => {
    setSelectedMonth(today.slice(0, 7));
    setSelectedDate(today);
  };
  return <div className="section-stack"><section className="card pixel-calendar-card"><div className="calendar-heading calendar-heading-stacked"><span className="eyebrow">운동 해빗</span><div className="calendar-toolbar"><MonthNavigator value={selectedMonth} onChange={changeMonth} onToday={goToday} /><div className="calendar-toolbar-actions"><button className="ghost-button" onClick={() => openForDate("plan")}>계획</button><button className="primary-button" onClick={() => openForDate("actual")}>기록</button></div></div></div><div className="calendar-weekdays">{["일", "월", "화", "수", "목", "금", "토"].map((day) => <span key={day}>{day}</span>)}</div><div className="month-grid">{cells.map((date, index) => { if (!date) return <span className="calendar-blank" key={`blank-${index}`} />; const dayEntries = state.workouts.filter((item) => item.date === date); return <button type="button" onClick={() => setSelectedDate(date)} key={date} className={`calendar-day workout-day ${date === today ? "today" : ""} ${date === selectedDate ? "selected" : ""}`}><b>{Number(date.slice(-2))}</b><span className="workout-marks">{dayEntries.slice(0, 3).map((item) => <WorkoutMark key={item.id} type={item.type} kind={item.kind} />)}</span></button>; })}</div><div className="calendar-legend workout-legend"><span><WorkoutMark type="PT" kind="actual" />PT 완료</span><span><WorkoutMark type="유산소" kind="actual" />개인운동 완료</span><span><WorkoutMark type="PT" kind="plan" />PT 계획</span><span><WorkoutMark type="유산소" kind="plan" />개인운동 계획</span></div></section>
    {selectedIsTravel && <section className="card travel-workout-control"><TravelDayControl date={selectedDate} level={selectedTravelLevel} defaultLevel={state.profile.travelLevel ?? "균형 유지"} onChange={updateTravelDayLevel} /></section>}
    <section className="card daily-activity-card"><CardTitle title={`${dateLabel(selectedDate)} 활동`} aside={<button className="text-button" onClick={() => openActivity(selectedDate)}>{energy.activity ? "수정" : "기록"}</button>} />{energy.activity ? <div className="daily-activity-stats"><div><span>걸음 수</span><strong>{energy.activity.steps.toLocaleString()}<small>걸음</small></strong></div><div><span>활동 칼로리</span><strong>{energy.activityCalories.toLocaleString()}<small>kcal</small></strong></div><div><span>총소모 추정</span><strong>{energy.expenditure.toLocaleString()}<small>kcal</small></strong></div></div> : <EmptyState text="하루 활동을 기록하면 걸음과 운동을 중복 없이 계산해요." action="활동 기록하기" onClick={() => openActivity(selectedDate)} showIcon={false} />}</section>
    <section className="workout-goal-block"><div className="workout-goal-heading"><h2>{selectedIsTravel && selectedTravelLevel !== "목표 유지" ? "여행 중 움직임" : "주간 목표"}</h2><button className="text-button" onClick={openGoal}>목표 설정</button></div><div className="metric-grid workout-metrics"><MetricCard label="개인 유산소" value={selectedIsTravel && selectedTravelLevel !== "목표 유지" ? `${cardio.sessions}` : `${cardio.sessions} / ${goal.cardioSessions}`} unit="회" hint={selectedIsTravel && selectedTravelLevel !== "목표 유지" ? "이번 주 기록" : "최소 주간 목표"} /><MetricCard label="누적시간" value={selectedIsTravel && selectedTravelLevel !== "목표 유지" ? `${cardio.minutes}` : `${cardio.minutes} / ${goal.cardioMinutes}`} unit="분" hint={selectedIsTravel && selectedTravelLevel !== "목표 유지" ? "이번 주 기록" : "이번 주 목표"} /></div></section>
    <section className="card"><CardTitle title="운동 계획·기록" aside={dateLabel(selectedDate)} />{entries.length ? <div className="timeline">{entries.map((entry) => <article key={entry.id}><span className={`timeline-dot ${entry.kind}`} /><div><small>{entry.kind === "plan" ? "계획" : "완료"} · {entry.type}{entry.startTime ? ` · ${entry.startTime}` : ""}</small><h3>{entry.title}</h3><p>{entry.minutes}분 · 강도 {typeof entry.intensity === "number" ? `${entry.intensity}/10` : entry.intensity || "미기록"}{entry.heartRate ? ` · 심박 ${entry.heartRate}` : ""}</p>{entry.overlapsSteps && <span className="overlap-badge">걸음 수 중복</span>}{entry.details && <em>{entry.details}</em>}<div className="entry-button-row">{entry.kind === "plan" && <button className="timeline-action" onClick={() => openWorkout("actual", entry)}>계획대로 기록</button>}<button className="timeline-action" onClick={() => openWorkout(entry.kind, entry)}>수정</button><button className="delete-text-button" onClick={() => deleteWorkout(entry)}>삭제</button></div></div></article>)}</div> : <EmptyState text="이날 운동 계획이나 기록이 없어요." action="운동 계획하기" onClick={() => openForDate("plan")} showIcon={false} />}</section>
    <section className="card"><CardTitle title="PT 빠른 기록" /><button className="secondary-button" onClick={() => openWorkout("actual", undefined, "PT")}>PT 내용 기록하기</button></section>
  </div>;
}

function MenstrualView({ state, today, openRecord, openLove, editRange, deleteRange }: { state: AppState; today: string; openRecord: (date: string) => void; openLove: (date: string) => void; editRange: (date: string) => void; deleteRange: (date: string) => void }) {
  const [selectedMonth, setSelectedMonth] = useState(today.slice(0, 7));
  const [selectedDate, setSelectedDate] = useState(today);
  const cells = monthCells(`${selectedMonth}-01`);
  const prediction = menstrualPrediction(state.cycles, today);
  const histories = cycleHistories(state.cycles);
  const cycleYears = [...new Set(histories.map((history) => history.start.slice(0, 4)))];
  const [cycleYear, setCycleYear] = useState(() => cycleYears.includes(today.slice(0, 4)) ? today.slice(0, 4) : cycleYears[0] ?? "전체");
  const visibleHistories = cycleYear === "전체" ? histories : histories.filter((history) => history.start.startsWith(cycleYear));
  const completedHistories = histories.filter((history) => history.cycleLength);
  const recentBleedingHistories = (completedHistories.length ? completedHistories : histories).slice(0, 7);
  const averageMainBleeding = recentBleedingHistories.length ? Math.round(recentBleedingHistories.reduce((sum, history) => sum + history.mainBleedingDays, 0) / recentBleedingHistories.length * 10) / 10 : undefined;
  const selected = state.cycles.find((entry) => entry.date === selectedDate);
  const selectedLove = (state.loveRecords ?? []).find((entry) => entry.date === selectedDate);
  const selectedPhase = menstrualPhase(state.cycles, selectedDate);
  const selectedIsPredictedPeriod = prediction.periodPredictions.includes(selectedDate) && (!selected || selected.state === "없음");
  const displayedPhase = selectedIsPredictedPeriod
    ? { key: "predicted-period", label: "예상 월경일", detail: `최근 ${prediction.basedOnCycles || 1}주기 기록을 바탕으로 계산한 예상일이에요.` }
    : selectedPhase;
  const changeMonth = (month: string) => {
    setSelectedMonth(month);
    if (!selectedDate.startsWith(month)) setSelectedDate(`${month}-01`);
  };
  const goToday = () => {
    setSelectedMonth(today.slice(0, 7));
    setSelectedDate(today);
  };
  const jumpToCycle = (date: string) => {
    setSelectedMonth(date.slice(0, 7));
    setSelectedDate(date);
    document.querySelector(".menstrual-calendar-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return <div className="section-stack menstrual-view">
    <section className="card pixel-calendar-card menstrual-calendar-card">
      <div className="calendar-heading calendar-heading-stacked menstrual-calendar-heading"><span className="eyebrow">월경 캘린더</span><div className="calendar-toolbar"><MonthNavigator value={selectedMonth} onChange={changeMonth} onToday={goToday} /><div className="calendar-toolbar-actions"><button className="primary-button" onClick={() => openRecord(selectedDate)}>기록</button></div></div></div>
      <div className="calendar-weekdays">{["일", "월", "화", "수", "목", "금", "토"].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="month-grid">{cells.map((date, index) => {
        if (!date) return <span className="calendar-blank" key={`blank-${index}`} />;
        const entry = state.cycles.find((item) => item.date === date);
        const stateClass = entry?.state === "갈색 출혈" ? "brown-bleeding" : entry?.state === "본 출혈" ? "main-bleeding" : entry?.state === "부정출혈" ? "irregular-bleeding" : "";
        const loveEntry = (state.loveRecords ?? []).find((item) => item.date === date);
        const love = loveEntry ? loveEntry.contraception === "피임하지 않음" ? "heart-filled" : "heart-outline" : "";
        const fertile = prediction.fertileDates.has(date);
        const ovulation = prediction.ovulationDates.has(date);
        const predictedPeriodStart = prediction.periodPredictions.includes(date);
        const description = [entry ? cycleSummary(entry) : "", fertile ? "예상 가임기" : "", ovulation ? "예상 배란일" : "", predictedPeriodStart ? "예상 월경 시작일" : ""].filter(Boolean).join(", ");
        return <button type="button" key={date} className={`calendar-day calendar-day-with-spacer menstrual-day ${stateClass} ${date === today ? "today" : ""} ${date === selectedDate ? "selected" : ""}`} onClick={() => setSelectedDate(date)} aria-label={`${date}${description ? `, ${description}` : ""}`}><b>{Number(date.slice(-2))}</b><span className="calendar-day-spacer" aria-hidden="true" />{predictedPeriodStart && <span className="predicted-period-drop" aria-hidden="true" />}{fertile && <span className={`fertile-flower ${ovulation ? "ovulation" : ""}`} aria-hidden="true">✿</span>}{love && <span className={`pixel-love-heart ${love}`} aria-hidden="true" />}</button>;
      })}</div>
    </section>
    <section className="card menstrual-selected-day"><CardTitle title={`${dateLabel(selectedDate)} 기록`} aside={<div className="cycle-detail-actions">{selected && selected.state !== "없음" && <button className="text-button" onClick={() => editRange(selectedDate)}>출혈 구분</button>}<button className="text-button" onClick={() => openRecord(selectedDate)}>{selected ? "월경·컨디션 수정" : "월경·컨디션 기록"}</button></div>} />
      <div className="selected-day-records">
        <div className="selected-day-cycle">{selected ? <><div className="menstrual-summary"><strong>{selected.state === "없음" ? "출혈 없음" : selected.state}</strong>{selected.flow && selected.flow !== "없음" && <span>월경량 {selected.flow}</span>}{selected.pain && selected.pain !== "없음" && <span>월경통 {selected.pain}</span>}{(selected.symptoms ?? []).map((symptom) => <span key={symptom}>{symptom}</span>)}</div><div className="menstrual-detail-grid"><div><span>에너지</span><strong>{selected.energy ? conditionLabels[selected.energy - 1] : "-"}</strong></div><div><span>식욕</span><strong>{selected.appetite ? conditionLabels[selected.appetite - 1] : "-"}</strong></div></div>{selected.note && <p className="menstrual-note">{selected.note}</p>}</> : <p className="selected-day-empty">월경·컨디션 기록 없음</p>}</div>
        {selectedLove && <details className="selected-day-love"><summary>♥ 사랑 기록</summary><div><strong>{selectedLove.count}회 · {selectedLove.contraception}</strong>{selectedLove.note && <p>{selectedLove.note}</p>}<button className="text-button" type="button" onClick={() => openLove(selectedDate)}>수정</button></div></details>}
      </div>
    </section>
    <section className={`card menstrual-phase-card phase-${displayedPhase.key}`}>
      <div><span className="eyebrow">{dateLabel(selectedDate)}의 주기</span><strong>{displayedPhase.label}</strong><p>{displayedPhase.detail}</p></div>
      {!selectedIsPredictedPeriod && selectedPhase.cycleDay && <b>DAY {selectedPhase.cycleDay}</b>}
    </section>
    <div className="metric-grid menstrual-metrics"><MetricCard label="평균 주기" value={prediction.lastStart ? String(prediction.cycleLength) : "-"} unit="일" hint={prediction.basedOnCycles ? `최근 ${prediction.basedOnCycles}주기 기준` : prediction.lastStart ? "기록 1회 · 28일 기준" : "본 출혈 기록 필요"} /><MetricCard label="평균 본 출혈" value={averageMainBleeding ? String(averageMainBleeding) : "-"} unit="일" hint={recentBleedingHistories.length ? `최근 ${recentBleedingHistories.length}주기 기준` : "본 출혈 기록 필요"} /><MetricCard label="다음 예상 월경일" value={prediction.nextPeriod ? prediction.nextPeriod.slice(5).replace("-", ".") : "-"} unit="" hint={prediction.nextPeriod ? `최근 ${prediction.basedOnCycles || 1}주기 기준` : "기록이 쌓이면 계산"} /><MetricCard label="다음 예상 배란일" value={prediction.nextOvulation ? prediction.nextOvulation.slice(5).replace("-", ".") : "-"} unit="" hint={prediction.nextOvulation ? `최근 ${prediction.basedOnCycles || 1}주기 기준 · 예상` : "기록이 쌓이면 계산"} /></div>
    <details className="card cycle-history-card"><summary><span>주기별 기록</span><i aria-hidden="true">⌄</i></summary><div className="cycle-history-controls">{cycleYears.length ? <select className="cycle-year-select" value={cycleYear} onChange={(event) => setCycleYear(event.target.value)} aria-label="주기 기록 연도"><option value="전체">전체</option>{cycleYears.map((year) => <option key={year} value={year}>{year}년</option>)}</select> : undefined}</div>
      {visibleHistories.length ? <div className="cycle-history-list">{visibleHistories.map((history) => <article className="cycle-history-item" key={history.start}><div className="cycle-history-heading"><div><small>{history.cycleLength ? `주기 ${history.cycleLength}일` : "최근 주기"}</small><strong>{history.start.replaceAll("-", ".")} ~ {history.end.replaceAll("-", ".")}</strong></div><div className="cycle-history-actions"><button type="button" onClick={() => jumpToCycle(history.start)}>달력</button><button type="button" onClick={() => editRange(history.start)}>출혈 구분</button><button type="button" className="delete" onClick={() => deleteRange(history.start)}>삭제</button></div></div><div className="cycle-history-facts"><span className="main">본 출혈 <b>{history.mainBleedingDays}일</b></span>{history.brownBefore > 0 && <span className="brown">앞 갈색 <b>{history.brownBefore}일</b></span>}{history.brownAfter > 0 && <span className="brown">뒤 갈색 <b>{history.brownAfter}일</b></span>}{history.irregularDays > 0 && <span className="irregular">부정출혈 <b>{history.irregularDays}일</b></span>}</div></article>)}</div> : <EmptyState text={histories.length ? `${cycleYear}년의 주기 기록이 없어요.` : "기간 기록을 저장하면 주기별로 정리해드려요."} showIcon={false} />}
    </details>
  </div>;
}

function ChangeConsultView({ state, today, setModal, commit, openWeeklyPlan, deleteConsultation, openBodyDetail, openCircumference, openConsultationDetail, openGoalHistory }: { state: AppState; today: string; setModal: (modal: Modal) => void; commit: (updater: (current: AppState) => AppState) => void; openWeeklyPlan: (start?: string, consultation?: Consultation) => void; deleteConsultation: (consultation: Consultation) => void; openBodyDetail: (record: BodyRecord) => void; openCircumference: (record?: CircumferenceRecord) => void; openConsultationDetail: (consultation: Consultation) => void; openGoalHistory: (goal: GoalHistoryEntry) => void }) {
  const [view, setView] = useState<"change" | "consult">("change");
  return <><div className="combined-view-tabs" role="tablist" aria-label="변화와 상담 화면 선택"><button type="button" role="tab" aria-selected={view === "change"} className={view === "change" ? "active" : ""} onClick={() => setView("change")}>변화</button><button type="button" role="tab" aria-selected={view === "consult"} className={view === "consult" ? "active" : ""} onClick={() => setView("consult")}>상담</button></div>{view === "change" ? <ChangeView state={state} today={today} setModal={setModal} openDetail={openBodyDetail} openCircumference={openCircumference} openGoalHistory={openGoalHistory} /> : <ConsultView state={state} commit={commit} openWeeklyPlan={openWeeklyPlan} deleteConsultation={deleteConsultation} openDetail={openConsultationDetail} />}</>;
}

function ChangeView({ state, today, setModal, openDetail, openCircumference, openGoalHistory }: { state: AppState; today: string; setModal: (modal: Modal) => void; openDetail: (record: BodyRecord) => void; openCircumference: (record?: CircumferenceRecord) => void; openGoalHistory: (goal: GoalHistoryEntry) => void }) {
  const [phaseFilter, setPhaseFilter] = useState<"all" | "focus" | "influence">("all");
  const [trendMetric, setTrendMetric] = useState<BodyTrendMetric>("bodyFatMass");
  const latest = state.bodyRecords[0];
  const recentRecords = state.bodyRecords.slice(0, 7).reverse();
  const oldest = recentRecords[0];
  const recordsWithPhase = state.bodyRecords.map((record) => ({ record, phase: menstrualPhase(state.cycles, record.date) }));
  const filteredRecords = recordsWithPhase.filter(({ phase }) => {
    if (phaseFilter === "all") return true;
    if (phaseFilter === "focus") return phase.key === "focus";
    return phase.key === "premenstrual" || phase.key === "bleeding";
  });
  const chartRecords = filteredRecords.map(({ record }) => record).reverse();
  const visibleRecords = filteredRecords.slice(0, 8);
  const circumferenceRecords = [...(state.circumferenceRecords ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  const latestCircumference = circumferenceRecords[0];
  const circumferenceChartRecords = circumferenceRecords.slice(0, 8).reverse();
  const measuredAt = latest ? `${latest.date.replaceAll("-", ".")} · ${latest.time}` : "기록 없음";
  const timing = goalTiming(state.profile, today);
  const targetProgress = bodyGoalProgressFor(state, today);
  const hasGoalTrend = Boolean(targetProgress.baseline && targetProgress.latestRecord && targetProgress.baseline.id !== targetProgress.latestRecord.id);
  const goalTargetsReached = hasGoalTrend
    && (state.profile.targetBodyFatChange === 0 || targetProgress.bodyFatPercent >= 100)
    && (state.profile.targetMuscleChange === 0 || targetProgress.musclePercent >= 100);
  const goalReady = timing.daysLeft === 0 || goalTargetsReached;
  const travelToday = isTravelDate(state.profile, today);
  const goalCopy = `체지방 ${signed(state.profile.targetBodyFatChange)}kg · 골격근 ${signed(state.profile.targetMuscleChange)}kg${travelToday ? ` · 여행 기본 ${state.profile.travelLevel ?? "균형 유지"}` : ""}`;
  const trendInfo = bodyTrendMetrics[trendMetric];
  return <div className="section-stack"><section className={`card change-overview ${travelToday ? "travel-change-overview" : ""}`}><div className="change-overview-main"><div><span className="eyebrow">{state.profile.mode} {timing.week}주차{travelToday ? " · 여행 중" : ""}</span><h2>{travelToday ? "측정 공백도 여행 기록의 일부예요" : <>체지방 {oldest && latest ? `${signed(latest.bodyFatMass - oldest.bodyFatMass)}kg` : "-"} · 골격근 {oldest && latest ? `${signed(latest.skeletalMuscle - oldest.skeletalMuscle)}kg` : "-"}</>}</h2><p>{goalCopy}</p></div><div className="change-overview-actions">{goalReady ? <button className="ghost-button" onClick={() => setModal("goal-complete")}>목표 마무리</button> : <button className="ghost-button" onClick={() => setModal("profile-goal")}>목표 수정</button>}<button className="primary-button" onClick={() => setModal("body")}>인바디 입력</button></div></div><BodyGoalProgress state={state} endDate={today} /></section>
    {(state.goalHistory ?? []).length > 0 && <details className="card goal-history-card"><summary><span>지난 목표</span><small>{state.goalHistory?.length}개</small><i aria-hidden="true">⌄</i></summary><div className="goal-history-list">{(state.goalHistory ?? []).map((goal) => <button type="button" className="goal-history-entry" key={goal.id} onClick={() => openGoalHistory(goal)}><div><span>{goal.mode} · {goal.startedAt.replaceAll("-", ".")} → {goal.completedAt.replaceAll("-", ".")}</span><strong>{goal.outcome}</strong></div><p><span>체지방 <b>{goal.bodyFatChange === undefined ? "-" : `${signed(goal.bodyFatChange)}kg`}</b><small>/ 목표 {signed(goal.targetBodyFatChange)}kg</small></span><span>골격근 <b>{goal.muscleChange === undefined ? "-" : `${signed(goal.muscleChange)}kg`}</b><small>/ 목표 {signed(goal.targetMuscleChange)}kg</small></span></p><i className="goal-history-chevron" aria-hidden="true">›</i></button>)}</div></details>}
    <div className="metric-grid change-metric-grid"><MetricCard label="체지방량" value={String(latest?.bodyFatMass ?? "-")} unit="kg" hint={measuredAt} /><MetricCard label="골격근량" value={String(latest?.skeletalMuscle ?? "-")} unit="kg" hint={measuredAt} /><MetricCard label="체중" value={String(latest?.weight ?? "-")} unit="kg" hint={measuredAt} /><MetricCard label="내장지방" value={String(latest?.visceralFat ?? "-")} unit="Lv" hint={measuredAt} /></div>
    <section className="card chart-card cycle-aware-chart"><CardTitle title={`${trendInfo.label} 흐름`} aside={`${trendInfo.unit} · ${chartRecords.length}회`} /><div className="body-metric-filter" role="tablist" aria-label="체성분 그래프 항목 선택">{(Object.keys(bodyTrendMetrics) as BodyTrendMetric[]).map((metric) => <button type="button" role="tab" aria-selected={trendMetric === metric} className={trendMetric === metric ? "active" : ""} onClick={() => setTrendMetric(metric)} key={metric}>{bodyTrendMetrics[metric].label}</button>)}</div><div className="body-phase-filter" role="tablist" aria-label="월경 주기 구간으로 체성분 기록 보기"><button type="button" role="tab" aria-selected={phaseFilter === "all"} className={phaseFilter === "all" ? "active" : ""} onClick={() => setPhaseFilter("all")}>전체</button><button type="button" role="tab" aria-selected={phaseFilter === "focus"} className={phaseFilter === "focus" ? "active" : ""} onClick={() => setPhaseFilter("focus")}>월경 후 집중</button><button type="button" role="tab" aria-selected={phaseFilter === "influence"} className={phaseFilter === "influence" ? "active" : ""} onClick={() => setPhaseFilter("influence")}>월경 전·중</button></div><BodyTrendChart records={chartRecords} cycles={state.cycles} metric={trendMetric} showMenstrualBands={phaseFilter === "all"} emptyText={phaseFilter === "all" ? "체성분 기록을 입력하면 흐름이 보여요." : "이 주기 구간의 체성분 기록이 아직 없어요."} /></section>
    <section className="card circumference-card"><CardTitle title="허리·엉덩이둘레" aside={<button type="button" className="text-button" onClick={() => openCircumference()}>기록하기</button>} />
      {latestCircumference ? <><div className="circumference-latest"><MetricCard label="허리둘레" value={String(latestCircumference.waistIn)} unit="inch" hint={latestCircumference.date} /><MetricCard label="엉덩이둘레" value={String(latestCircumference.hipIn)} unit="inch" hint={latestCircumference.date} /></div><CircumferenceTrendChart records={circumferenceChartRecords} /><div className="circumference-history">{circumferenceRecords.slice(0, 5).map((record) => <button type="button" key={record.id} onClick={() => openCircumference(record)}><span>{record.date}</span><strong>허리 {record.waistIn}inch</strong><strong>엉덩이 {record.hipIn}inch</strong><b aria-hidden="true">›</b></button>)}</div></> : <EmptyState text="일요일 아침 측정값을 기록해보세요." action="둘레 기록하기" onClick={() => openCircumference()} showIcon={false} />}
    </section>
    <section className="card"><CardTitle title="측정 기록" aside={`${filteredRecords.length}개`} />{visibleRecords.length ? <div className="data-table">{visibleRecords.map(({ record, phase }) => <button type="button" key={record.id} onClick={() => openDetail(record)} aria-label={`${record.date} 인바디 상세 보기, ${phase.label}`}><span><strong>{record.date}</strong><i className={`record-phase-badge phase-${phase.key}`}>{phase.label}</i><small>{record.time} · {record.measurementTiming ?? record.condition.split(" · ")[0]} · {record.device ?? record.condition.split(" · ")[1]}</small></span><span>{record.bodyFatMass}<small>kg 지방</small></span><span>{record.skeletalMuscle}<small>kg 골격근</small></span><b aria-hidden="true">›</b></button>)}</div> : <div className="phase-record-empty">이 구간의 측정 기록이 아직 없어요.</div>}</section>
  </div>;
}

function ConsultView({ state, commit, openWeeklyPlan, deleteConsultation, openDetail }: { state: AppState; commit: (updater: (current: AppState) => AppState) => void; openWeeklyPlan: (start?: string, consultation?: Consultation) => void; deleteConsultation: (consultation: Consultation) => void; openDetail: (consultation: Consultation) => void }) {
  const [loading, setLoading] = useState(false);
  const [planLoading, setPlanLoading] = useState(false);
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpQuestion, setFollowUpQuestion] = useState("");
  const [consultationError, setConsultationError] = useState("");
  const [aiUsage, setAiUsage] = useState<AiUsageSummary>();
  const [reviewStart, setReviewStart] = useState(weekStart(todayKey()));
  const savedReview = (state.weeklyReviews ?? []).find((item) => item.weekStart === reviewStart);
  const [reviewNote, setReviewNote] = useState(savedReview?.note ?? "");
  const [reviewEditing, setReviewEditing] = useState(!savedReview);
  const latest = state.consultations[0];
  const weekConsultation = state.consultations.find((item) => item.weekStart === reviewStart);
  const visibleConsultation = weekConsultation ?? (latest && !latest.flowStage ? latest : undefined);
  const [weeklyAnswer, setWeeklyAnswer] = useState(weekConsultation?.userResponse ?? "");
  const reviewEnd = addDays(reviewStart, 6);

  useEffect(() => {
    const reviewForWeek = (state.weeklyReviews ?? []).find((item) => item.weekStart === reviewStart);
    setReviewNote(reviewForWeek?.note ?? "");
    setReviewEditing(!reviewForWeek);
  }, [reviewStart, state.weeklyReviews]);

  useEffect(() => {
    let active = true;
    requestAiUsageSummary().then((usage) => {
      if (active) setAiUsage(usage);
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const review = useMemo(() => {
    const inWeek = (date: string) => date >= reviewStart && date <= reviewEnd;
    const actualMeals = state.meals.filter((item) => inWeek(item.date) && item.kind === "actual" && !item.skipped);
    const actualMealEntries = state.meals.filter((item) => inWeek(item.date) && item.kind === "actual");
    const plannedMeals = state.meals.filter((item) => inWeek(item.date) && item.kind === "plan");
    const nutrition = nutritionTotal(actualMeals);
    const nutritionDays = new Set(actualMeals.map((item) => item.date)).size;
    const average = (value: number) => nutritionDays ? roundNutrient(value / nutritionDays) : 0;
    const plannedMealSlots = new Set(plannedMeals.map((item) => `${item.date}:${item.mealType}`));
    const actualMealSlots = new Set(actualMealEntries.map((item) => `${item.date}:${item.mealType}`));
    const completedMealPlans = [...plannedMealSlots].filter((slot) => actualMealSlots.has(slot)).length;

    const actualWorkouts = state.workouts.filter((item) => inWeek(item.date) && item.kind === "actual");
    const plannedWorkouts = state.workouts.filter((item) => inWeek(item.date) && item.kind === "plan");
    const cardio = actualWorkouts.filter((item) => item.type === "유산소");
    const pt = actualWorkouts.filter((item) => item.type === "PT");

    const body = state.bodyRecords.filter((item) => inWeek(item.date)).sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    const firstBody = body[0];
    const lastBody = body.at(-1);
    const conditions = state.cycles.filter((item) => inWeek(item.date) && (item.energy || item.appetite || item.symptoms?.length));
    const averageCondition = (key: "energy" | "appetite") => {
      const values = conditions.map((item) => item[key]).filter((value): value is number => Boolean(value));
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    };
    const symptomCounts = new Map<string, number>();
    conditions.flatMap((item) => item.symptoms ?? []).forEach((symptom) => symptomCounts.set(symptom, (symptomCounts.get(symptom) ?? 0) + 1));
    const symptoms = [...symptomCounts.entries()].sort((a, b) => b[1] - a[1]).map(([symptom, count]) => `${symptom} ${count}일`).join(" · ");
    const startPhase = menstrualPhase(state.cycles, reviewStart);
    const endPhase = menstrualPhase(state.cycles, reviewEnd);
    const phaseLabel = startPhase.label === endPhase.label ? startPhase.label : `${startPhase.label} → ${endPhase.label}`;
    const travelDays = weekDates(reviewStart).filter((date) => isTravelDate(state.profile, date)).length;
    const timing = goalTiming(state.profile, reviewEnd);

    return {
      nutritionDays,
      averageNutrition: { calories: average(nutrition.calories), protein: average(nutrition.protein), sugar: average(nutrition.sugar), fiber: average(nutrition.fiber) },
      plannedMealSlots: plannedMealSlots.size,
      completedMealPlans,
      recordedMeals: actualMealEntries.length,
      actualWorkouts: actualWorkouts.length,
      plannedWorkouts: plannedWorkouts.length,
      cardioSessions: cardio.length,
      cardioMinutes: cardio.reduce((sum, item) => sum + item.minutes, 0),
      ptSessions: pt.length,
      bodyCount: body.length,
      bodyStart: firstBody ? { date: firstBody.date, bodyFatMass: firstBody.bodyFatMass, skeletalMuscle: firstBody.skeletalMuscle, weight: firstBody.weight, visceralFat: firstBody.visceralFat } : undefined,
      bodyEnd: lastBody ? { date: lastBody.date, bodyFatMass: lastBody.bodyFatMass, skeletalMuscle: lastBody.skeletalMuscle, weight: lastBody.weight, visceralFat: lastBody.visceralFat } : undefined,
      bodyFatChange: body.length > 1 && firstBody && lastBody ? lastBody.bodyFatMass - firstBody.bodyFatMass : undefined,
      muscleChange: body.length > 1 && firstBody && lastBody ? lastBody.skeletalMuscle - firstBody.skeletalMuscle : undefined,
      bodyPhase: lastBody ? menstrualPhase(state.cycles, lastBody.date).label : phaseLabel,
      energy: averageCondition("energy"),
      appetite: averageCondition("appetite"),
      conditionDays: conditions.length,
      symptoms,
      phaseLabel,
      travelDays,
      timing,
      meals: actualMeals.map((item) => ({ date: item.date, mealType: item.mealType, title: item.title, calories: item.calories, protein: item.protein, carbs: item.carbs, fat: item.fat, sugar: item.sugar, fiber: item.fiber })),
      workouts: actualWorkouts.map((item) => ({ date: item.date, type: item.type, title: item.title, minutes: item.minutes, intensity: item.intensity, heartRate: item.heartRate, details: item.details })),
    };
  }, [reviewEnd, reviewStart, state]);

  const previousReview = useMemo(() => {
    const previousStart = addDays(reviewStart, -7);
    const previousEnd = addDays(reviewStart, -1);
    const inPreviousWeek = (date: string) => date >= previousStart && date <= previousEnd;
    const meals = state.meals.filter((item) => inPreviousWeek(item.date) && item.kind === "actual" && !item.skipped);
    const nutrition = nutritionTotal(meals);
    const nutritionDays = new Set(meals.map((item) => item.date)).size;
    const average = (value: number) => nutritionDays ? roundNutrient(value / nutritionDays) : 0;
    const workouts = state.workouts.filter((item) => inPreviousWeek(item.date) && item.kind === "actual");
    const cardio = workouts.filter((item) => item.type === "유산소");
    const conditions = state.cycles.filter((item) => inPreviousWeek(item.date) && (item.energy || item.appetite || item.symptoms?.length));
    const averageCondition = (key: "energy" | "appetite") => {
      const values = conditions.map((item) => item[key]).filter((value): value is number => Boolean(value));
      return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    };
    return {
      nutritionDays,
      averageNutrition: { protein: average(nutrition.protein), sugar: average(nutrition.sugar), fiber: average(nutrition.fiber) },
      actualWorkouts: workouts.length,
      cardioMinutes: cardio.reduce((sum, item) => sum + item.minutes, 0),
      energy: averageCondition("energy"),
      appetite: averageCondition("appetite"),
      conditionDays: conditions.length,
    };
  }, [reviewStart, state]);

  const automaticReview = useMemo(() => {
    const nutritionGoal = state.nutritionGoal;
    const workoutGoal = state.workoutGoal ?? { cardioSessions: 2, cardioMinutes: 90 };
    const hasCurrentRecords = review.nutritionDays + review.actualWorkouts + review.bodyCount + review.conditionDays > 0;
    const hasPreviousRecords = previousReview.nutritionDays + previousReview.actualWorkouts + previousReview.conditionDays > 0;
    const positives: string[] = [];
    const adjustments: string[] = [];

    if (review.bodyFatChange !== undefined && state.profile.targetBodyFatChange < 0 && review.bodyFatChange <= 0) positives.push(`체지방량이 주간 첫 측정보다 ${Math.abs(review.bodyFatChange).toFixed(1)}kg 낮아졌어요.`);
    if (review.muscleChange !== undefined && review.muscleChange >= 0) positives.push(`골격근량을 ${signed(review.muscleChange)}kg로 지켰어요.`);
    if (review.nutritionDays && review.averageNutrition.protein >= nutritionGoal.proteinMin) positives.push(`단백질 평균 ${review.averageNutrition.protein}g으로 최소 목표를 채웠어요.`);
    if (review.nutritionDays && review.averageNutrition.fiber >= nutritionGoal.fiberMin) positives.push(`식이섬유 평균 ${review.averageNutrition.fiber}g으로 목표를 채웠어요.`);
    if (review.nutritionDays && review.averageNutrition.sugar <= nutritionGoal.sugarMax) positives.push(`당류 평균 ${review.averageNutrition.sugar}g으로 상한 안에 머물렀어요.`);
    if (review.cardioSessions >= workoutGoal.cardioSessions && review.cardioMinutes >= workoutGoal.cardioMinutes) positives.push(`개인 유산소 ${review.cardioSessions}회·${review.cardioMinutes}분으로 주간 목표를 달성했어요.`);
    if (review.plannedMealSlots && review.completedMealPlans / review.plannedMealSlots >= .8) positives.push(`계획한 식사의 ${Math.round(review.completedMealPlans / review.plannedMealSlots * 100)}%를 실제 기록으로 이어갔어요.`);

    if (review.nutritionDays < 3) adjustments.push(`식단 기록이 ${review.nutritionDays}일이라 평균 방향을 보기 어려워요. 먼저 3일 이상 기록해봐요.`);
    else if (review.averageNutrition.protein < nutritionGoal.proteinMin) adjustments.push(`단백질이 하루 평균 ${Math.round(nutritionGoal.proteinMin - review.averageNutrition.protein)}g 부족해요.`);
    if (review.nutritionDays >= 3 && review.averageNutrition.fiber < nutritionGoal.fiberMin) adjustments.push(`식이섬유가 하루 평균 ${Math.round(nutritionGoal.fiberMin - review.averageNutrition.fiber)}g 부족해요.`);
    if (review.nutritionDays >= 3 && review.averageNutrition.sugar > nutritionGoal.sugarMax) adjustments.push(`당류가 하루 평균 상한보다 ${Math.round(review.averageNutrition.sugar - nutritionGoal.sugarMax)}g 높아요.`);
    if (review.cardioSessions < workoutGoal.cardioSessions || review.cardioMinutes < workoutGoal.cardioMinutes) adjustments.push(`개인 유산소 목표까지 ${Math.max(0, workoutGoal.cardioSessions - review.cardioSessions)}회·${Math.max(0, workoutGoal.cardioMinutes - review.cardioMinutes)}분 남았어요.`);

    const comparisonParts: string[] = [];
    if (hasPreviousRecords) {
      const mealDayDifference = review.nutritionDays - previousReview.nutritionDays;
      const workoutDifference = review.actualWorkouts - previousReview.actualWorkouts;
      const cardioDifference = review.cardioMinutes - previousReview.cardioMinutes;
      if (mealDayDifference) comparisonParts.push(`식단 기록 ${mealDayDifference > 0 ? `${mealDayDifference}일 증가` : `${Math.abs(mealDayDifference)}일 감소`}`);
      if (workoutDifference) comparisonParts.push(`운동 ${workoutDifference > 0 ? `${workoutDifference}회 증가` : `${Math.abs(workoutDifference)}회 감소`}`);
      if (cardioDifference) comparisonParts.push(`유산소 ${cardioDifference > 0 ? `${cardioDifference}분 증가` : `${Math.abs(cardioDifference)}분 감소`}`);
      if (!comparisonParts.length) comparisonParts.push("식단 기록일과 운동량이 지난주와 비슷해요");
    }

    let nextAction = "다음 주에는 식단과 운동 계획을 먼저 넣고 실제 기록을 이어가요.";
    if (review.nutritionDays < 3) nextAction = "다음 주에는 우선 3일 이상 식사를 기록해 비교 가능한 평균을 만들어요.";
    else if (review.averageNutrition.protein < nutritionGoal.proteinMin) nextAction = "다음 주 식사마다 단백질 음식을 하나씩 먼저 계획해요.";
    else if (review.averageNutrition.fiber < nutritionGoal.fiberMin) nextAction = "다음 주 점심과 저녁에 채소·과일·통곡물 중 하나를 더해요.";
    else if (review.cardioSessions < workoutGoal.cardioSessions || review.cardioMinutes < workoutGoal.cardioMinutes) nextAction = `다음 주 개인 유산소 ${workoutGoal.cardioSessions}회·${workoutGoal.cardioMinutes}분을 먼저 나눠 계획해요.`;

    return [
      { label: "잘한 점", text: hasCurrentRecords ? (positives[0] ?? `이번 주에 식단 ${review.nutritionDays}일·운동 ${review.actualWorkouts}회를 기록했어요.`) : "기록이 생기면 목표에 맞게 잘한 점을 찾아드려요." },
      { label: "조정할 점", text: hasCurrentRecords ? (adjustments[0] ?? "현재 기록에서는 우선 조정할 큰 항목이 없어요.") : "아직 평가하지 않고 실제 기록을 기다릴게요." },
      { label: "지난주 비교", text: hasPreviousRecords ? `${comparisonParts.join(" · ")}.` : "지난주 기록이 없어 이번 주가 첫 비교 기준이 돼요." },
      { label: "다음 주 제안", text: hasCurrentRecords ? nextAction : "다음 주 계획을 먼저 세우고 기록을 시작해요." },
    ];
  }, [previousReview, review, state.nutritionGoal, state.profile.targetBodyFatChange, state.workoutGoal]);

  const conditionLabel = (value: number) => value ? conditionLabels[Math.min(4, Math.max(0, Math.round(value) - 1))] : "기록 없음";
  const selectReviewWeek = (start: string) => {
    setReviewStart(start);
    setWeeklyAnswer("");
    setFollowUpOpen(false);
  };
  const saveReview = () => {
    const note = reviewNote.trim();
    if (!note) return;
    const weeklyReview: WeeklyReview = { id: savedReview?.id ?? id("weekly-review"), weekStart: reviewStart, note, updatedAt: todayKey() };
    commit((current) => ({ ...current, weeklyReviews: [...(current.weeklyReviews ?? []).filter((item) => item.weekStart !== reviewStart), weeklyReview].sort((a, b) => b.weekStart.localeCompare(a.weekStart)) }));
    setReviewNote(note);
    setReviewEditing(false);
  };
  const deleteReview = () => {
    if (!savedReview || !window.confirm(`${reviewStart} 주간 메모를 삭제할까요?`)) return;
    commit((current) => ({ ...moveToTrash(current, `${reviewStart} 주간 메모`, { weeklyReviews: [savedReview] }), weeklyReviews: (current.weeklyReviews ?? []).filter((item) => item.id !== savedReview.id) }));
    setReviewNote("");
    setReviewEditing(true);
  };
  const consultationWeekPayload = () => {
    const goalProgress = bodyGoalProgressFor(state, reviewEnd);
    const latestCompletedGoal = (state.goalHistory ?? [])[0];
    return {
      weekStart: reviewStart,
      weekEnd: reviewEnd,
      currentGoal: {
        mode: state.profile.mode,
        targetBodyFatChange: state.profile.targetBodyFatChange,
        targetMuscleChange: state.profile.targetMuscleChange,
        goalStartDate: state.profile.goalStartDate,
        goalEndDate: state.profile.goalEndDate,
        progress: {
          bodyFatChange: goalProgress.bodyFatChange,
          muscleChange: goalProgress.muscleChange,
          bodyFatPercent: Math.round(goalProgress.bodyFatPercent),
          musclePercent: Math.round(goalProgress.musclePercent),
        },
      },
      latestCompletedGoal: latestCompletedGoal ? {
        startedAt: latestCompletedGoal.startedAt,
        plannedEndAt: latestCompletedGoal.plannedEndAt,
        completedAt: latestCompletedGoal.completedAt,
        mode: latestCompletedGoal.mode,
        targets: { bodyFat: latestCompletedGoal.targetBodyFatChange, muscle: latestCompletedGoal.targetMuscleChange },
        changes: { bodyFat: latestCompletedGoal.bodyFatChange, muscle: latestCompletedGoal.muscleChange },
        outcome: latestCompletedGoal.outcome,
        note: latestCompletedGoal.note,
        report: latestCompletedGoal.report,
      } : undefined,
      nutritionGoal: state.nutritionGoal,
      workoutGoal: state.workoutGoal,
      weeklyNote: savedReview?.note ?? reviewNote.trim(),
      currentWeek: review,
      previousWeek: previousReview,
      automaticReview,
    };
  };
  const requestReview = async () => {
    setLoading(true);
    setConsultationError("");
    try {
      const data = await requestAiConsultation({
        kind: "weekly-summary",
        week: consultationWeekPayload(),
      });
      commit((current) => ({ ...current, consultations: [{ id: id("consult"), date: todayKey(), weekStart: reviewStart, weekEnd: reviewEnd, text: data.text, summaryText: data.text, flowStage: "summary", source: "openai", model: data.model, planSuggestions: [] }, ...current.consultations] }));
      setAiUsage((current) => ({
        month: current?.month ?? todayKey().slice(0, 7),
        used: data.used,
        limit: data.limit,
        remaining: data.remaining,
        inputTokens: (current?.inputTokens ?? 0) + data.inputTokens,
        outputTokens: (current?.outputTokens ?? 0) + data.outputTokens,
        estimatedUsd: (current?.estimatedUsd ?? 0) + data.estimatedUsd,
        krwReferenceRate: data.krwReferenceRate,
      }));
      setFollowUpOpen(false);
      setFollowUpQuestion("");
      setWeeklyAnswer("");
    } catch (error) {
      setConsultationError(error instanceof Error && error.message ? error.message.replace(/^FirebaseError:\s*/i, "") : "상담을 불러오지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally { setLoading(false); }
  };
  const requestWeeklyPlan = async () => {
    const consultation = weekConsultation;
    const answer = weeklyAnswer.trim();
    if (!consultation || !answer) return;
    setPlanLoading(true);
    setConsultationError("");
    try {
      const summary = consultation.summaryText ?? consultation.text;
      const data = await requestAiConsultation({ kind: "weekly-plan", week: consultationWeekPayload(), summary, userResponse: answer });
      const combinedText = `${summary}\n\n◆ 나의 답변\n${answer}\n\n◆ 다음 주 제안\n${data.text}`;
      commit((current) => ({
        ...current,
        consultations: current.consultations.map((item) => item.id === consultation.id ? {
          ...item,
          text: combinedText,
          summaryText: summary,
          userResponse: answer,
          planText: data.text,
          flowStage: "plan-ready",
          planSuggestions: data.planSuggestions ?? [],
          source: "openai",
          model: data.model,
        } : item),
      }));
      setAiUsage((current) => ({
        month: current?.month ?? todayKey().slice(0, 7),
        used: data.used,
        limit: data.limit,
        remaining: data.remaining,
        inputTokens: (current?.inputTokens ?? 0) + data.inputTokens,
        outputTokens: (current?.outputTokens ?? 0) + data.outputTokens,
        estimatedUsd: (current?.estimatedUsd ?? 0) + data.estimatedUsd,
        krwReferenceRate: data.krwReferenceRate,
      }));
    } catch (error) {
      setConsultationError(error instanceof Error && error.message ? error.message.replace(/^FirebaseError:\s*/i, "") : "다음 주 제안을 불러오지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally { setPlanLoading(false); }
  };
  const requestFollowUp = async () => {
    const question = followUpQuestion.trim();
    if (!visibleConsultation || !question) return;
    setFollowUpLoading(true);
    setConsultationError("");
    try {
      const data = await requestAiConsultation({ kind: "followup", question, previousConsultation: visibleConsultation.text });
      const updatedText = `${visibleConsultation.text}\n\n◆ 나의 질문\n${question}\n\n◆ ChatGPT 답변\n${data.text}`;
      commit((current) => ({ ...current, consultations: current.consultations.map((item) => item.id === visibleConsultation.id ? { ...item, text: updatedText, source: "openai", model: data.model } : item) }));
      setAiUsage((current) => ({
        month: current?.month ?? todayKey().slice(0, 7),
        used: data.used,
        limit: data.limit,
        remaining: data.remaining,
        inputTokens: (current?.inputTokens ?? 0) + data.inputTokens,
        outputTokens: (current?.outputTokens ?? 0) + data.outputTokens,
        estimatedUsd: (current?.estimatedUsd ?? 0) + data.estimatedUsd,
        krwReferenceRate: data.krwReferenceRate,
      }));
      setFollowUpQuestion("");
      setFollowUpOpen(false);
    } catch (error) {
      setConsultationError(error instanceof Error && error.message ? error.message.replace(/^FirebaseError:\s*/i, "") : "답변을 불러오지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally { setFollowUpLoading(false); }
  };
  return <div className="section-stack">
    <section className="card weekly-review-card">
      <div className="weekly-review-heading"><div><span className="eyebrow">일요일 주간 정리</span><h2>이번 주를 한눈에 봐요</h2></div><button type="button" className="week-current-button" onClick={() => selectReviewWeek(weekStart(todayKey()))}>이번 주</button></div>
      <div className="weekly-review-nav"><button type="button" onClick={() => selectReviewWeek(addDays(reviewStart, -7))} aria-label="이전 주">‹</button><strong>{reviewStart.replaceAll("-", ".")} – {reviewEnd.replaceAll("-", ".")}</strong><button type="button" onClick={() => selectReviewWeek(addDays(reviewStart, 7))} aria-label="다음 주">›</button></div>
      <div className="weekly-review-context"><span>{state.profile.mode} {review.timing.week}주차</span><span>{review.phaseLabel}</span>{review.travelDays > 0 && <span>여행 {review.travelDays}일</span>}<span>목표일까지 {review.timing.daysLeft}일</span></div>
      <div className="weekly-review-grid">
        <article className="weekly-review-panel body"><div className="weekly-panel-title"><span>체성분</span><small>{review.bodyCount}회 측정</small></div>{review.bodyCount ? <><strong>체지방 {review.bodyFatChange === undefined ? "-" : `${signed(review.bodyFatChange)}kg`}</strong><b>골격근 {review.muscleChange === undefined ? "-" : `${signed(review.muscleChange)}kg`}</b><p>{review.bodyPhase}</p></> : <p className="weekly-panel-empty">측정 기록 없음</p>}</article>
        <article className="weekly-review-panel nutrition"><div className="weekly-panel-title"><span>식단</span><small>{review.nutritionDays}일 기록</small></div><div className="weekly-nutrition-values"><span><b>{review.averageNutrition.calories}</b> kcal</span><span>단백질 <b>{review.averageNutrition.protein}g</b></span><span>당류 <b>{review.averageNutrition.sugar}g</b></span><span>식이섬유 <b>{review.averageNutrition.fiber}g</b></span></div><p>{review.plannedMealSlots ? `계획 ${review.completedMealPlans}/${review.plannedMealSlots}회 기록` : `실제 ${review.recordedMeals}끼 기록`}</p></article>
        <article className="weekly-review-panel workout"><div className="weekly-panel-title"><span>운동</span><small>{review.actualWorkouts}회 수행</small></div><strong>유산소 {review.cardioSessions}회 · {review.cardioMinutes}분</strong><b>PT {review.ptSessions}회</b><p>{review.plannedWorkouts ? `계획 ${review.plannedWorkouts}회` : "운동 계획 없음"}</p></article>
        <article className="weekly-review-panel condition"><div className="weekly-panel-title"><span>월경·컨디션</span><small>{review.conditionDays}일 기록</small></div><strong>에너지 {conditionLabel(review.energy)}</strong><b>식욕 {conditionLabel(review.appetite)}</b><p>{review.symptoms || review.phaseLabel}</p></article>
      </div>
      <BodyGoalProgress state={state} endDate={reviewEnd} />
      <section className="weekly-auto-review">
        <div className="weekly-auto-review-heading"><strong>이번 주 자동 분석</strong><small>기록 기준</small></div>
        <div className="weekly-auto-review-list">{automaticReview.map((item) => <article key={item.label}><span>{item.label}</span><p>{item.text}</p></article>)}</div>
      </section>
      <section className="weekly-note-card">
        <div className="weekly-note-heading">
          <strong>이번 주 메모</strong>
          {savedReview && !reviewEditing && <div className="weekly-note-actions"><button type="button" onClick={() => { setReviewNote(savedReview.note); setReviewEditing(true); }}>수정</button><button type="button" onClick={deleteReview}>삭제</button></div>}
        </div>
        {savedReview && !reviewEditing ? <p className="weekly-note-content">{savedReview.note}</p> : <div className="weekly-note-editor"><ClearableFieldControl><textarea className="weekly-review-note" aria-label="이번 주 메모" value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="잘된 점, 힘들었던 점, 다음 주에 바꾸고 싶은 점" /></ClearableFieldControl><div>{savedReview && <button type="button" className="weekly-note-cancel" onClick={() => { setReviewNote(savedReview.note); setReviewEditing(false); }}>취소</button>}<button type="button" className="weekly-note-save" onClick={saveReview} disabled={!reviewNote.trim()}>{savedReview ? "수정 저장" : "주간 메모 저장"}</button></div></div>}
      </section>
      <div className="weekly-review-next"><button type="button" className="primary-button" onClick={() => openWeeklyPlan(addDays(reviewStart, 7))}>다음 주 계획하기</button></div>
    </section>
    <section className="section-hero consult-hero"><div><span className="eyebrow">주간 상담</span><h2>정리된 기록으로<br />함께 조정해요.</h2></div><button className="primary-button" onClick={requestReview} disabled={loading}>{loading ? "기록을 살펴보는 중…" : "✦ 상담 시작"}</button></section>
    <section className="card ai-usage-card">
      <div className="ai-usage-heading"><strong>이번 달 AI 사용</strong><span>{aiUsage ? `${aiUsage.used}/${aiUsage.limit}회` : "확인 중"}</span></div>
      <div className="ai-usage-values"><article><small>남은 상담</small><strong>{aiUsage ? `${aiUsage.remaining}회` : "-"}</strong></article><article><small>예상 비용</small><strong>{aiUsage ? `약 ${Math.round(aiUsage.estimatedUsd * aiUsage.krwReferenceRate).toLocaleString()}원` : "-"}</strong></article></div>
      <div className="ai-usage-track"><i style={{ width: `${aiUsage ? Math.min(100, aiUsage.used / aiUsage.limit * 100) : 0}%` }} /></div>
    </section>
    {consultationError && <p className="consultation-error" role="alert">{consultationError}</p>}
    <section className="card consultation-card">
      <CardTitle title={visibleConsultation ? "주간 AI 상담" : "첫 상담을 준비했어요"} aside={visibleConsultation ? `${visibleConsultation.weekStart?.replaceAll("-", ".") ?? visibleConsultation.date}` : ""} />
      {visibleConsultation ? <>
        <div className="consultation-meta"><span className={`source-badge ${visibleConsultation.source}`}>{visibleConsultation.source === "openai" ? visibleConsultation.model === "gpt-5.6-sol" ? "GPT-5.6 Sol · High" : visibleConsultation.model || "ChatGPT 상담" : "AI 연결 전 미리보기"}</span>{aiUsage && <small>이번 달 {aiUsage.used}/{aiUsage.limit}회</small>}</div>
        {visibleConsultation.flowStage ? <div className="consultation-flow">
          <div className="consultation-flow-track" aria-label="주간 상담 진행 단계"><span className="done"><b>1</b>이번 주 요약</span><i /><span className={visibleConsultation.userResponse ? "done" : "active"}><b>2</b>내가 답변</span><i /><span className={visibleConsultation.flowStage === "plan-ready" ? "done" : ""}><b>3</b>다음 주 계획</span></div>
          <section className="consultation-step complete"><div className="consultation-step-heading"><span>1</span><strong>이번 주 요약</strong><small>AI가 목표와 기록을 함께 봤어요</small></div><div className="consultation-text">{visibleConsultation.summaryText ?? visibleConsultation.text}</div></section>
          <section className={`consultation-step ${visibleConsultation.userResponse ? "complete" : "active"}`}><div className="consultation-step-heading"><span>2</span><strong>내가 답변</strong><small>{visibleConsultation.userResponse ? "답변 완료" : "다음 주 조건을 알려주세요"}</small></div>{visibleConsultation.userResponse ? <p className="consultation-user-answer">{visibleConsultation.userResponse}</p> : <div className="consultation-answer-editor"><ClearableFieldControl><textarea value={weeklyAnswer} onChange={(event) => setWeeklyAnswer(event.target.value)} maxLength={4000} placeholder="다음 주 일정, 컨디션, 원하는 관리 강도와 꼭 반영할 점을 자유롭게 답해주세요." aria-label="이번 주 요약에 답변" /></ClearableFieldControl><div><small>{weeklyAnswer.length}/4000</small><button type="button" className="primary-button" onClick={requestWeeklyPlan} disabled={!weeklyAnswer.trim() || planLoading}>{planLoading ? "제안을 만드는 중…" : "답변하고 제안 받기"}</button></div></div>}</section>
          <section className={`consultation-step ${visibleConsultation.flowStage === "plan-ready" ? "complete" : "waiting"}`}><div className="consultation-step-heading"><span>3</span><strong>다음 주 계획</strong><small>{visibleConsultation.flowStage === "plan-ready" ? "확인 후 반영해주세요" : "답변을 기다리고 있어요"}</small></div>{visibleConsultation.flowStage === "plan-ready" ? <><div className="consultation-text">{visibleConsultation.planText}</div>{visibleConsultation.planSuggestions?.length ? <div className="consultation-suggestion-preview">{visibleConsultation.planSuggestions.map((suggestion) => <article key={suggestion.id}><span>{suggestion.category === "meal" ? "식단" : "운동"}</span><strong>{suggestion.title}</strong><p>{suggestion.detail}</p></article>)}</div> : <p className="consultation-no-suggestions">바로 계획표에 넣을 제안은 없어요. 상담 내용을 확인한 뒤 직접 계획할 수 있어요.</p>}<div className="consultation-not-saved"><strong>아직 저장되지 않았어요</strong><span>제안을 확인하고 원하는 항목만 골라 반영할 수 있어요.</span></div></> : <p className="consultation-waiting-text">소야님의 답변을 받은 뒤에만 식단·운동 계획을 제안해요.</p>}</section>
        </div> : <div className="consultation-text">{visibleConsultation.text}</div>}
        <div className="consult-buttons"><button className="delete-text-button" onClick={() => deleteConsultation(visibleConsultation)}>삭제</button>{(!visibleConsultation.flowStage || visibleConsultation.flowStage === "plan-ready") && <button className="ghost-button" onClick={() => setFollowUpOpen((current) => !current)}>대화 이어가기</button>}{visibleConsultation.flowStage === "plan-ready" && <button className="primary-button" onClick={() => openWeeklyPlan(addDays(visibleConsultation.weekStart ?? reviewStart, 7), visibleConsultation)}>제안 확인하고 계획하기</button>}{!visibleConsultation.flowStage && <button className="primary-button" onClick={() => openWeeklyPlan(addDays(visibleConsultation.weekStart ?? reviewStart, 7), visibleConsultation)}>{visibleConsultation.planSuggestions?.length ? "제안 골라 계획하기" : "다음 주 계획하기"}</button>}</div>
        {followUpOpen && <div className="consult-followup"><ClearableFieldControl><textarea value={followUpQuestion} onChange={(event) => setFollowUpQuestion(event.target.value)} maxLength={1000} placeholder="상담 내용에서 더 묻고 싶은 점을 적어주세요." aria-label="ChatGPT에게 이어서 질문" /></ClearableFieldControl><div><small>{followUpQuestion.length}/1000</small><button type="button" className="primary-button" onClick={requestFollowUp} disabled={!followUpQuestion.trim() || followUpLoading}>{followUpLoading ? "답변을 기다리는 중…" : "질문 보내기"}</button></div></div>}
      </> : <EmptyState text={<>체성분·식사·운동 기록을 바탕으로<br />이번 주를 함께 정리해요.</>} action="첫 상담 시작" onClick={requestReview} showIcon={false} />}
    </section>
    <section className="card consultation-history"><CardTitle title="과거 상담" aside={`${Math.max(0, state.consultations.length - 1)}개`} />{state.consultations.length > 1 ? <div className="history-list">{state.consultations.slice(1).map((item) => <button key={item.id} onClick={() => openDetail(item)} aria-label={`${item.date} 상담 보기`}><strong>{item.date}</strong><b aria-hidden="true">›</b></button>)}</div> : <p className="history-empty">상담이 쌓이면 이전 내용을 여기에서 다시 볼 수 있어요.</p>}</section>
  </div>;
}

function TravelDayControl({ date, level, defaultLevel, onChange }: { date: string; level: TravelLevel; defaultLevel: TravelLevel; onChange: (date: string, level: TravelLevel) => void }) {
  const levels: TravelLevel[] = ["가볍게 기록", "균형 유지", "목표 유지"];
  return <div className="travel-day-control"><div><span>이날의 관리</span><small>{level === defaultLevel ? "여행 기본값" : "이날만 변경"}</small></div><div className="travel-day-options">{levels.map((item) => <button type="button" key={item} className={level === item ? "active" : ""} onClick={() => onChange(date, item)}>{item === "가볍게 기록" ? "가볍게" : item === "균형 유지" ? "균형" : "목표대로"}</button>)}</div></div>;
}

function CardTitle({ title, aside }: { title: string; aside?: React.ReactNode }) { return <div className="card-title"><h2>{title}</h2>{aside && <div>{aside}</div>}</div>; }
function WorkoutMark({ type, kind }: { type: WorkoutEntry["type"]; kind: EntryKind }) {
  const isPt = type === "PT";
  const color = kind === "actual" ? (isPt ? "#e9795f" : "#7d8c6b") : "transparent";
  return <svg className={`workout-mark ${kind}`} viewBox="0 0 14 14" aria-hidden="true" shapeRendering="geometricPrecision">
    {isPt ? <circle cx="7" cy="7" r="5" fill={color} stroke="#332e2b" strokeWidth="1.8" strokeDasharray={kind === "plan" ? "2.5 2" : undefined} /> : kind === "plan" ? <path d="M1.5 5V1.5H5 M9 1.5H12.5V5 M12.5 9V12.5H9 M5 12.5H1.5V9" fill="none" stroke="#332e2b" strokeWidth="1.8" strokeLinecap="butt" strokeLinejoin="miter" /> : <rect x="2" y="2" width="10" height="10" fill={color} stroke="#332e2b" strokeWidth="1.8" />}
  </svg>;
}
function NavPixelIcon({ tab }: { tab: Tab }) {
  return <Image className={`nav-pixel-icon nav-icon-${tab}`} src={navIcons[tab]} width={36} height={36} alt="" draggable={false} unoptimized />;
}
function RecordRow({ label, detail, done, onClick }: { label: string; detail: string; done: boolean; onClick: () => void }) { return <button className="record-row" onClick={onClick}><span className={`check ${done ? "done" : ""}`}>{done ? "✓" : ""}</span><span><strong>{label}</strong><small>{detail}</small></span><b>›</b></button>; }
function NutrientBar({ label, value, min, max, unit, tone }: { label: string; value: number; min: number; max: number; unit: string; tone: string }) { const width = Math.min(100, (value / max) * 100); return <div className="nutrient"><div><span>{label}</span><strong>{value} / {min}~{max}{unit}</strong></div><div className="nutrient-track"><i className={tone} style={{ width: `${width}%` }} /></div></div>; }
function MicroStat({ label, value, hint }: { label: string; value: string; hint: string }) { return <div className="micro-stat"><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>; }
function MetricCard({ label, value, unit, hint }: { label: string; value: string; unit: string; hint: string }) { return <article className="metric-card"><span>{label}</span><strong>{value}<small>{unit}</small></strong><p>{hint}</p></article>; }
function EmptyState({ text, action, onClick, showIcon = true }: { text: React.ReactNode; action?: string; onClick?: () => void; showIcon?: boolean }) { return <div className={`empty-state ${showIcon ? "" : "without-icon"}`}>{showIcon && <span>○</span>}<p>{text}</p>{action && onClick && <button onClick={onClick}>{action}</button>}</div>; }
function EntryItem({ label, title, detail, record, edit, remove }: { label: string; title: string; detail?: string; record?: () => void; edit: () => void; remove: () => void }) { return <div className="entry-item"><div><small>{label}</small><strong>{title}</strong>{detail && <span>{detail}</span>}</div><div>{record && <button onClick={record}>기록</button>}<button onClick={edit}>수정</button><button className="delete-text-button" onClick={remove}>삭제</button></div></div>; }

function Sheet({ title, subtitle, titleAction, close, children }: { title: string; subtitle?: string; titleAction?: React.ReactNode; close: () => void; children: React.ReactNode }) { return <div className="sheet-backdrop"><section className="sheet" role="dialog" aria-modal="true"><div className="sheet-handle" /><header><div className="sheet-heading"><div className="sheet-title-row"><h2>{title}</h2>{titleAction}</div>{subtitle && <p>{subtitle}</p>}</div><button className="sheet-close-button" onClick={close} aria-label="닫기">×</button></header>{children}</section></div>; }

function QuickSheet({ close, select }: { close: () => void; select: (modal: Modal) => void }) { return <Sheet title="무엇을 추가할까요?" close={close}><h3 className="sheet-section-title">지금 기록하기</h3><div className="quick-grid two"><QuickButton label="몸의 변화" onClick={() => select("measurement-picker")} /><QuickButton label="월경 상태" onClick={() => select("cycle")} /><QuickButton label="먹은 식사" onClick={() => select("meal-actual")} /><QuickButton label="하루의 움직임" onClick={() => select("movement-picker")} /></div><h3 className="sheet-section-title">미리 계획하기</h3><div className="quick-grid three"><QuickButton label="식사 계획" onClick={() => select("meal-plan")} /><QuickButton label="운동 계획" onClick={() => select("workout-plan")} /><QuickButton label="주간 계획" onClick={() => select("weekly-plan")} /></div></Sheet>; }
function MeasurementPickerSheet({ close, select }: { close: () => void; select: (modal: "body" | "circumference") => void }) { return <Sheet title="몸의 변화" close={close}><div className="quick-grid two measurement-picker-grid"><QuickButton label="인바디" onClick={() => select("body")} /><QuickButton label="허리·엉덩이둘레" onClick={() => select("circumference")} /></div></Sheet>; }
function MovementPickerSheet({ close, select }: { close: () => void; select: (modal: "workout-actual" | "activity") => void }) { return <Sheet title="하루의 움직임" close={close}><div className="quick-grid two measurement-picker-grid"><QuickButton label="한 운동 기록" onClick={() => select("workout-actual")} /><QuickButton label="하루 활동" onClick={() => select("activity")} /></div></Sheet>; }
function QuickButton({ label, onClick }: { label: string; onClick: () => void }) { return <button className="quick-button" onClick={onClick}><strong>{label}</strong></button>; }

type BodyTrendMetric = "bodyFatMass" | "skeletalMuscle" | "weight" | "visceralFat";

const bodyTrendMetrics: Record<BodyTrendMetric, { label: string; unit: string }> = {
  bodyFatMass: { label: "체지방량", unit: "kg" },
  skeletalMuscle: { label: "골격근량", unit: "kg" },
  weight: { label: "체중", unit: "kg" },
  visceralFat: { label: "내장지방", unit: "Lv" },
};

function BodyTrendChart({ records, cycles, metric, showMenstrualBands = false, emptyText = "체성분 기록을 입력하면 흐름이 보여요." }: { records: BodyRecord[]; cycles: CycleEntry[]; metric: BodyTrendMetric; showMenstrualBands?: boolean; emptyText?: string }) {
  const [zoomScale, setZoomScale] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pointerPositions = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ distance: number; scale: number; anchorRatio: number } | undefined>(undefined);
  const zoomAnchor = useRef<{ ratio: number; viewportX: number } | undefined>(undefined);
  useEffect(() => {
    const viewport = scrollRef.current;
    if (viewport) viewport.scrollLeft = viewport.scrollWidth - viewport.clientWidth;
  }, [metric, records.length]);
  useEffect(() => {
    const viewport = scrollRef.current;
    const anchor = zoomAnchor.current;
    if (!viewport || !anchor) return;
    const frame = window.requestAnimationFrame(() => {
      viewport.scrollLeft = anchor.ratio * viewport.scrollWidth - anchor.viewportX;
      zoomAnchor.current = undefined;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [zoomScale]);
  if (!records.length) return <div className="empty-chart">{emptyText}</div>;
  const metricInfo = bodyTrendMetrics[metric];
  const pointGap = 52 * zoomScale;
  const height = 250;
  const left = 52;
  const right = 28;
  const top = 34;
  const bottom = 46;
  const effectiveGap = records.length > 1 ? Math.max(pointGap, (700 - left - right) / (records.length - 1)) : 0;
  const width = Math.min(60000, Math.max(700, left + right + Math.max(1, records.length - 1) * effectiveGap));
  const values = records.map((item) => item[metric]);
  const min = Math.floor((Math.min(...values) - 0.2) * 10) / 10;
  const max = Math.ceil((Math.max(...values) + 0.2) * 10) / 10;
  const range = Math.max(max - min, 0.4);
  const points = records.map((record, index) => ({
    record,
    x: left + (records.length === 1 ? (width - left - right) / 2 : index * effectiveGap),
    y: top + ((max - record[metric]) / range) * (height - top - bottom),
  }));
  const recordTimes = records.map((record) => new Date(`${record.date}T12:00:00`).getTime());
  const xForTime = (time: number) => {
    if (records.length === 1 || time <= recordTimes[0]) return left;
    if (time >= recordTimes.at(-1)!) return width - right;
    const nextIndex = recordTimes.findIndex((recordTime) => recordTime >= time);
    const previousIndex = Math.max(0, nextIndex - 1);
    const timeSpan = Math.max(1, recordTimes[nextIndex] - recordTimes[previousIndex]);
    const ratio = (time - recordTimes[previousIndex]) / timeSpan;
    return points[previousIndex].x + ratio * (points[nextIndex].x - points[previousIndex].x);
  };
  const bleedingRanges = cycles
    .filter((entry) => entry.state === "본 출혈" && entry.date >= records[0].date && entry.date <= records.at(-1)!.date)
    .map((entry) => entry.date)
    .sort()
    .reduce<{ start: string; end: string }[]>((ranges, date) => {
      const latestRange = ranges.at(-1);
      if (latestRange && addDays(latestRange.end, 1) === date) latestRange.end = date;
      else ranges.push({ start: date, end: date });
      return ranges;
    }, []);
  const bleedingBands = showMenstrualBands ? bleedingRanges.map((range) => {
    const startX = xForTime(new Date(`${range.start}T00:00:00`).getTime());
    const endX = xForTime(new Date(`${range.end}T23:59:59`).getTime());
    return { x: startX, width: Math.max(4, endX - startX) };
  }) : [];

  const updatePinchStart = (viewport: HTMLDivElement) => {
    const touches = [...pointerPositions.current.values()];
    if (touches.length !== 2) return;
    const [first, second] = touches;
    const distance = Math.hypot(second.x - first.x, second.y - first.y);
    const rect = viewport.getBoundingClientRect();
    const viewportX = (first.x + second.x) / 2 - rect.left;
    pinchStart.current = {
      distance: Math.max(1, distance),
      scale: zoomScale,
      anchorRatio: (viewport.scrollLeft + viewportX) / Math.max(1, viewport.scrollWidth),
    };
  };
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") return;
    pointerPositions.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointerPositions.current.size === 2) updatePinchStart(event.currentTarget);
  };
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointerPositions.current.has(event.pointerId)) return;
    pointerPositions.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const start = pinchStart.current;
    const touches = [...pointerPositions.current.values()];
    if (!start || touches.length !== 2) return;
    event.preventDefault();
    const [first, second] = touches;
    const distance = Math.hypot(second.x - first.x, second.y - first.y);
    const rect = event.currentTarget.getBoundingClientRect();
    zoomAnchor.current = {
      ratio: start.anchorRatio,
      viewportX: (first.x + second.x) / 2 - rect.left,
    };
    const nextScale = Math.min(4, Math.max(0.5, start.scale * (distance / start.distance)));
    setZoomScale((current) => Math.abs(current - nextScale) >= 0.015 ? nextScale : current);
  };
  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    pointerPositions.current.delete(event.pointerId);
    if (pointerPositions.current.size < 2) pinchStart.current = undefined;
  };

  return <div className="trend-explorer"><div className="trend-explorer-toolbar"><div>{showMenstrualBands && <span className="menstrual-band-legend"><i />본 출혈 구간</span>}<span className="trend-pan-hint">한 손가락으로 이동 · 두 손가락으로 확대</span></div></div><div className="trend-chart-wrap" ref={scrollRef} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerEnd} onPointerCancel={handlePointerEnd}><svg className="trend-chart" style={{ width: `${width}px` }} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${metricInfo.label} 전체 변화 선 그래프`}>
    {bleedingBands.map((band, index) => <rect key={`bleeding-${index}`} x={band.x} y={top - 13} width={band.width} height={height - top - bottom + 26} className="chart-menstrual-band" />)}
    {[0, 0.5, 1].map((ratio) => { const y = top + ratio * (height - top - bottom); const value = max - ratio * range; return <g key={ratio}><line x1={left} x2={width - right} y1={y} y2={y} className="chart-grid-line" /><text x={left - 10} y={y + 4} textAnchor="end" className="chart-axis-value">{value.toFixed(1)}</text></g>; })}
    <polyline points={points.map((point) => `${point.x},${point.y}`).join(" ")} className="trend-line" />
    {points.map(({ record, x, y }) => <g key={record.id}><circle cx={x} cy={y} r="6" className="trend-point" /><text x={x} y={y - 14} textAnchor="middle" className="trend-value">{record[metric]}{metricInfo.unit}</text><text x={x} y={height - 16} textAnchor="middle" className="trend-date">{record.date.slice(5).replace("-", "/")}</text></g>)}
  </svg></div></div>;
}

function CircumferenceTrendChart({ records }: { records: CircumferenceRecord[] }) {
  if (!records.length) return null;
  const width = 700;
  const height = 250;
  const left = 52;
  const right = 28;
  const top = 36;
  const bottom = 46;
  const values = records.flatMap((item) => [item.waistIn, item.hipIn]);
  const min = Math.floor((Math.min(...values) - 1) * 10) / 10;
  const max = Math.ceil((Math.max(...values) + 1) * 10) / 10;
  const range = Math.max(max - min, 2);
  const point = (record: CircumferenceRecord, index: number, value: number) => ({
    record,
    x: left + (records.length === 1 ? (width - left - right) / 2 : index * ((width - left - right) / (records.length - 1))),
    y: top + ((max - value) / range) * (height - top - bottom),
    value,
  });
  const waist = records.map((record, index) => point(record, index, record.waistIn));
  const hip = records.map((record, index) => point(record, index, record.hipIn));
  return <div className="circumference-chart-wrap"><div className="circumference-legend"><span className="waist">허리</span><span className="hip">엉덩이</span></div><svg className="trend-chart circumference-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="허리둘레와 엉덩이둘레 변화 선 그래프">
    {[0, 0.5, 1].map((ratio) => { const y = top + ratio * (height - top - bottom); const value = max - ratio * range; return <g key={ratio}><line x1={left} x2={width - right} y1={y} y2={y} className="chart-grid-line" /><text x={left - 10} y={y + 4} textAnchor="end" className="chart-axis-value">{value.toFixed(1)}</text></g>; })}
    <polyline points={waist.map(({ x, y }) => `${x},${y}`).join(" ")} className="circumference-line waist" />
    <polyline points={hip.map(({ x, y }) => `${x},${y}`).join(" ")} className="circumference-line hip" />
    {waist.map(({ record, x, y, value }) => <g key={`waist-${record.id}`}><circle cx={x} cy={y} r="5" className="circumference-point waist" /><text x={x} y={y - 11} textAnchor="middle" className="circumference-value waist">{value}</text></g>)}
    {hip.map(({ record, x, y, value }) => <g key={`hip-${record.id}`}><circle cx={x} cy={y} r="5" className="circumference-point hip" /><text x={x} y={y + 18} textAnchor="middle" className="circumference-value hip">{value}</text><text x={x} y={height - 16} textAnchor="middle" className="trend-date">{record.date.slice(5).replace("-", "/")}</text></g>)}
  </svg></div>;
}

function CircumferenceSheet({ today, latest, draft, close, save, remove }: { today: string; latest?: CircumferenceRecord; draft?: CircumferenceRecord; close: () => void; save: (event: FormEvent<HTMLFormElement>) => void; remove: (record: CircumferenceRecord) => void }) {
  return <Sheet title={draft ? "허리·엉덩이둘레 수정" : "허리·엉덩이둘레 기록"} close={close}><form className="form-stack" onSubmit={save}>
    <input type="hidden" name="editingId" value={draft?.id ?? ""} />
    <Field label="측정일"><input type="date" name="date" defaultValue={draft?.date ?? today} required /></Field>
    <MeasureField label="허리둘레" name="waistIn" unit="inch" previous={latest?.waistIn} value={draft?.waistIn} />
    <MeasureField label="엉덩이둘레" name="hipIn" unit="inch" previous={latest?.hipIn} value={draft?.hipIn} />
    <Field label="메모 (선택)"><textarea name="note" defaultValue={draft?.note ?? ""} placeholder="측정 조건이나 평소와 다른 점" /></Field>
    <button className="primary-button submit-button" type="submit">{draft ? "수정 저장" : "둘레 기록 저장"}</button>
    {draft && <button className="delete-button full-delete-button" type="button" onClick={() => remove(draft)}>둘레 기록 삭제</button>}
  </form></Sheet>;
}

function BodySheet({ today, latest, draft, openHistory, close, save }: { today: string; latest?: BodyRecord; draft?: BodyRecord; openHistory: () => void; close: () => void; save: (event: FormEvent<HTMLFormElement>) => void }) { const [legacyTiming = "아침 공복", legacyDevice = "InBody Dial H30"] = (draft?.condition ?? latest?.condition)?.split(" · ") ?? []; return <Sheet title={draft ? "인바디 기록 수정" : "인바디 기록"} titleAction={!draft ? <button type="button" className="sheet-title-action" onClick={openHistory}>과거 기록 가져오기</button> : undefined} close={close}><form className="form-stack" onSubmit={save}><input type="hidden" name="editingId" value={draft?.id ?? ""} /><div className="two-fields sheet-leading-fields"><Field label="측정일"><input type="date" name="date" defaultValue={draft?.date ?? today} required /></Field><Field label="측정시간"><input type="time" name="time" defaultValue={draft?.time ?? new Date().toTimeString().slice(0, 5)} required /></Field></div><MeasureField label="체중" name="weight" unit="kg" previous={latest?.weight} value={draft?.weight} /><MeasureField label="골격근량" name="skeletalMuscle" unit="kg" previous={latest?.skeletalMuscle} value={draft?.skeletalMuscle} /><MeasureField label="체지방량" name="bodyFatMass" unit="kg" previous={latest?.bodyFatMass} value={draft?.bodyFatMass} /><MeasureField label="체지방률" name="bodyFatRate" unit="%" previous={latest?.bodyFatRate} value={draft?.bodyFatRate} /><MeasureField label="내장지방레벨" name="visceralFat" unit="Lv" previous={latest?.visceralFat} value={draft?.visceralFat} step="1" /><div className="two-fields"><Field label="측정 시점"><select name="measurementTiming" defaultValue={draft?.measurementTiming ?? latest?.measurementTiming ?? legacyTiming}><option>아침 공복</option><option>평소와 다른 시간</option><option>식후</option><option>운동 후</option></select></Field><Field label="측정 기기"><select name="device" defaultValue={draft?.device ?? latest?.device ?? legacyDevice}><option>InBody Dial H30</option><option>헬스장 InBody</option><option>병원 InBody</option><option>다른 체성분 기기</option></select></Field></div><button className="primary-button submit-button" type="submit">{draft ? "수정 저장" : "저장하기"}</button></form></Sheet>; }

function emptyBulkBodyDraft(): BulkBodyDraft {
  return {
    rowId: id("body-row"), date: "", time: "07:00", weight: "", skeletalMuscle: "",
    bodyFatMass: "", bodyFatRate: "", visceralFat: "", measurementTiming: "아침 공복", device: "InBody Dial H30",
  };
}

function BodyBulkSheet({ existing, close, save }: { existing: BodyRecord[]; close: () => void; save: (records: BodyRecord[]) => void }) {
  const [draft, setDraft] = useState<BulkBodyDraft>(emptyBulkBodyDraft());
  const [pending, setPending] = useState<BulkBodyDraft[]>([]);
  const [editingRowId, setEditingRowId] = useState<string>();
  const [attempted, setAttempted] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [mode, setMode] = useState<"media" | "manual">("media");
  const [files, setFiles] = useState<File[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState("");
  const [importError, setImportError] = useState("");
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const existingDates = useMemo(() => new Set(existing.map((record) => record.date)), [existing]);
  const draftError = () => {
    if (!draft.date || !draft.time || !draft.weight || !draft.skeletalMuscle || !draft.bodyFatMass || !draft.bodyFatRate || !draft.visceralFat) return "비어 있는 항목이 있어요.";
    if ([draft.weight, draft.skeletalMuscle, draft.bodyFatMass, draft.bodyFatRate, draft.visceralFat].some((value) => !Number.isFinite(Number(value)) || Number(value) <= 0)) return "측정값은 0보다 큰 숫자로 적어주세요.";
    if (pending.some((row) => row.rowId !== editingRowId && row.date === draft.date)) return "대기 목록에 같은 날짜가 있어요.";
    if (existingDates.has(draft.date)) return "이 날짜의 인바디 기록이 이미 있어요.";
    return "";
  };
  const error = draftError();
  const hasDraftValues = Boolean(draft.date || draft.weight || draft.skeletalMuscle || draft.bodyFatMass || draft.bodyFatRate || draft.visceralFat);
  const update = (key: keyof BulkBodyDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setAttempted(false);
  };
  const resetDraft = (source = draft) => {
    setDraft({ ...emptyBulkBodyDraft(), time: source.time, measurementTiming: source.measurementTiming, device: source.device });
    setEditingRowId(undefined);
    setAttempted(false);
  };
  const queueDraft = () => {
    setAttempted(true);
    if (error) return;
    setPending((current) => editingRowId
      ? current.map((row) => row.rowId === editingRowId ? draft : row)
      : [...current, draft]);
    resetDraft();
  };
  const copyLatest = () => {
    const source = pending.at(-1) ?? (existing[0] ? {
      weight: String(existing[0].weight), skeletalMuscle: String(existing[0].skeletalMuscle), bodyFatMass: String(existing[0].bodyFatMass),
      bodyFatRate: String(existing[0].bodyFatRate), visceralFat: String(existing[0].visceralFat),
      measurementTiming: existing[0].measurementTiming ?? existing[0].condition.split(" · ")[0] ?? "아침 공복",
      device: existing[0].device ?? existing[0].condition.split(" · ")[1] ?? "InBody Dial H30",
    } : undefined);
    if (!source) return;
    setDraft((current) => ({ ...current, weight: source.weight, skeletalMuscle: source.skeletalMuscle, bodyFatMass: source.bodyFatMass, bodyFatRate: source.bodyFatRate, visceralFat: source.visceralFat, measurementTiming: source.measurementTiming, device: source.device }));
    setAttempted(false);
  };
  const editPending = (row: BulkBodyDraft) => {
    setDraft(row);
    setEditingRowId(row.rowId);
    setAttempted(false);
    setMode("manual");
  };
  const removePending = (rowId: string) => {
    setPending((current) => current.filter((row) => row.rowId !== rowId));
    if (editingRowId === rowId) resetDraft();
  };
  const records = () => pending.map((row): BodyRecord => ({
    id: id("body"), date: row.date, time: row.time, weight: Number(row.weight), skeletalMuscle: Number(row.skeletalMuscle),
    bodyFatMass: Number(row.bodyFatMass), bodyFatRate: Number(row.bodyFatRate), visceralFat: Number(row.visceralFat),
    measurementTiming: row.measurementTiming, device: row.device, condition: `${row.measurementTiming} · ${row.device}`,
  }));

  const importedDraft = (record: AiBodyImportRecord): BulkBodyDraft => ({
    rowId: id("body-row"),
    date: record.date,
    time: record.time ?? "07:00",
    weight: String(record.weight),
    skeletalMuscle: String(record.skeletalMuscle),
    bodyFatMass: String(record.bodyFatMass),
    bodyFatRate: String(record.bodyFatRate),
    visceralFat: String(record.visceralFat),
    measurementTiming: "아침 공복",
    device: "InBody Dial H30",
  });

  const analyzeMedia = async () => {
    if (!files.length || importing) return;
    setImporting(true);
    setImportError("");
    setImportWarnings([]);
    try {
      const frames = await prepareBodyMedia(files, setImportStatus);
      const found: AiBodyImportRecord[] = [];
      const warnings: string[] = [];
      const batches = Math.ceil(frames.length / 6);
      for (let offset = 0; offset < frames.length; offset += 6) {
        setImportStatus(`AI가 체성분 기록을 읽고 있어요 · ${Math.floor(offset / 6) + 1}/${batches}`);
        const result = await requestAiBodyImport(frames.slice(offset, offset + 6));
        found.push(...result.records);
        warnings.push(...result.warnings);
      }
      const bestByDate = new Map<string, AiBodyImportRecord>();
      for (const record of found) {
        const previous = bestByDate.get(record.date);
        if (!previous || record.confidence > previous.confidence) bestByDate.set(record.date, record);
      }
      const occupied = new Set([...existingDates, ...pending.map((row) => row.date)]);
      const additions: BulkBodyDraft[] = [];
      let skipped = 0;
      for (const record of bestByDate.values()) {
        if (occupied.has(record.date)) {
          skipped += 1;
          continue;
        }
        occupied.add(record.date);
        additions.push(importedDraft(record));
      }
      setPending((current) => {
        const currentDates = new Set([...existingDates, ...current.map((row) => row.date)]);
        return [...current, ...additions.filter((row) => !currentDates.has(row.date))];
      });
      setImportWarnings([...new Set(warnings)].slice(0, 5));
      setImportStatus(additions.length
        ? `${additions.length}개 기록을 찾았어요.${skipped ? ` 이미 있는 ${skipped}개는 제외했어요.` : ""}`
        : skipped
          ? `찾은 ${skipped}개 기록은 이미 저장되어 있어요.`
          : "완전한 수치가 보이는 기록을 찾지 못했어요. 다른 사진을 선택하거나 직접 입력해주세요.");
      setFiles([]);
      setFileInputKey((value) => value + 1);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "사진·동영상을 분석하지 못했어요.");
      setImportStatus("");
    } finally {
      setImporting(false);
    }
  };

  return <Sheet title="인바디 과거 기록 가져오기" subtitle="사진·동영상에서 불러오거나 직접 입력한 뒤 확인해서 저장해요." close={close}>
    {!reviewing ? <div className="body-bulk-editor">
      <div className="body-import-tabs"><button type="button" className={mode === "media" ? "active" : ""} onClick={() => setMode("media")}>사진·동영상</button><button type="button" className={mode === "manual" ? "active" : ""} onClick={() => setMode("manual")}>직접 입력</button></div>
      {mode === "media" ? <section className="body-media-import">
        <div className="body-bulk-summary"><strong>인바디 화면 가져오기</strong><span>스크린샷 여러 장이나 화면 녹화 영상을 선택할 수 있어요.</span></div>
        <label className={`body-media-picker${files.length ? " selected" : ""}`}>
          <input key={fileInputKey} type="file" accept="image/*,video/*" multiple disabled={importing} onChange={(event) => { setFiles(Array.from(event.target.files ?? [])); setImportError(""); setImportStatus(""); setImportWarnings([]); }} />
          <strong>{files.length ? `${files.length}개 파일 선택됨` : "사진·동영상 선택"}</strong>
          <span>{files.length ? files.map((file) => file.name).join(" · ") : "사진 최대 24장 · 영상은 장면으로 나누어 분석"}</span>
        </label>
        <button type="button" className="primary-button body-media-analyze" disabled={!files.length || importing} onClick={() => void analyzeMedia()}>{importing ? "분석 중..." : "선택한 파일 분석하기"}</button>
        {(importStatus || importError) && <p className={`body-media-status${importError ? " error" : ""}`}>{importError || importStatus}</p>}
        {importWarnings.length > 0 && <div className="body-media-warnings">{importWarnings.map((warning) => <span key={warning}>{warning}</span>)}</div>}
        <p className="body-media-privacy">원본 파일은 SOYA나 Firebase에 저장하지 않아요. 분석용 장면만 OpenAI로 보내고 결과 숫자만 대기 목록에 남겨요.</p>
      </section> : <article className="body-bulk-entry">
        <div className="body-bulk-row-heading"><strong>{editingRowId ? "기록 수정" : "새 기록"}</strong><div>{(pending.length > 0 || existing.length > 0) && <button type="button" onClick={copyLatest}>직전 값 복사</button>}{editingRowId && <button type="button" onClick={() => resetDraft()}>수정 취소</button>}</div></div>
        <div className="two-fields sheet-leading-fields"><Field label="측정일"><input type="date" value={draft.date} onChange={(event) => update("date", event.target.value)} /></Field><Field label="측정시간"><input type="time" value={draft.time} onChange={(event) => update("time", event.target.value)} /></Field></div>
        <div className="body-bulk-metrics">
          <BulkMetric label="체중" unit="kg" value={draft.weight} onChange={(value) => update("weight", value)} />
          <BulkMetric label="골격근량" unit="kg" value={draft.skeletalMuscle} onChange={(value) => update("skeletalMuscle", value)} />
          <BulkMetric label="체지방량" unit="kg" value={draft.bodyFatMass} onChange={(value) => update("bodyFatMass", value)} />
          <BulkMetric label="체지방률" unit="%" value={draft.bodyFatRate} onChange={(value) => update("bodyFatRate", value)} />
          <BulkMetric label="내장지방" unit="Lv" step="1" value={draft.visceralFat} onChange={(value) => update("visceralFat", value)} />
        </div>
        <div className="two-fields"><Field label="측정 시점"><select value={draft.measurementTiming} onChange={(event) => update("measurementTiming", event.target.value)}><option>아침 공복</option><option>평소와 다른 시간</option><option>식후</option><option>운동 후</option></select></Field><Field label="측정 기기"><select value={draft.device} onChange={(event) => update("device", event.target.value)}><option>InBody Dial H30</option><option>헬스장 InBody</option><option>병원 InBody</option><option>다른 체성분 기기</option></select></Field></div>
        {attempted && error && <p className="body-bulk-error">{error}</p>}
        <button type="button" className="body-bulk-add" onClick={queueDraft}>{editingRowId ? "수정 완료" : "이 기록을 대기 목록에 추가"}</button>
      </article>}
      <section className="body-bulk-queue"><div className="body-bulk-queue-heading"><strong>저장 대기</strong><span>{pending.length}개</span></div>{pending.length ? <div>{pending.slice().sort((a, b) => b.date.localeCompare(a.date)).map((row) => <article key={row.rowId}><div><strong>{row.date}</strong><span>체지방 {row.bodyFatMass}kg · 골격근 {row.skeletalMuscle}kg</span></div><div><button type="button" onClick={() => editPending(row)}>수정</button><button type="button" className="delete" onClick={() => removePending(row.rowId)}>삭제</button></div></article>)}</div> : <p>추가한 과거 기록이 아직 없어요.</p>}</section>
      {mode === "manual" && hasDraftValues && pending.length > 0 && <p className="body-bulk-pending-note">작성 중인 값은 먼저 대기 목록에 추가해주세요.</p>}
      <button type="button" className="primary-button submit-button" disabled={!pending.length || importing || (mode === "manual" && hasDraftValues)} onClick={() => setReviewing(true)}>전체 저장 전 확인</button>
    </div> : <div className="body-bulk-review">
      <div className="body-bulk-review-heading"><span className="eyebrow">저장 전 확인</span><h3>{pending.length}개 기록을 저장할까요?</h3></div>
      <div className="body-bulk-preview-list">{pending.slice().sort((a, b) => b.date.localeCompare(a.date)).map((row) => <article key={row.rowId}><div><strong>{row.date}</strong><span>{row.time} · {row.measurementTiming}</span></div><div><b>체지방 {row.bodyFatMass}kg</b><span>골격근 {row.skeletalMuscle}kg · 체중 {row.weight}kg</span></div></article>)}</div>
      <div className="body-bulk-review-actions"><button type="button" className="ghost-button" onClick={() => setReviewing(false)}>입력 수정</button><button type="button" className="primary-button" onClick={() => save(records())}>{pending.length}개 한 번에 저장</button></div>
    </div>}
  </Sheet>;
}

function BulkMetric({ label, unit, value, step = "0.1", onChange }: { label: string; unit: string; value: string; step?: string; onChange: (value: string) => void }) {
  return <label><span>{label} ({unit})</span><div><ClearableFieldControl><input type="number" min="0" step={step} inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} /></ClearableFieldControl><b>{unit}</b></div></label>;
}
const hasInputValue = (value: unknown) => value !== undefined && value !== null && String(value).length > 0;
function ClearableFieldControl({ children }: { children: React.ReactNode }) {
  const props = isValidElement(children) ? children.props as { value?: unknown; defaultValue?: unknown } : {};
  const [hasValue, setHasValue] = useState(hasInputValue(props.value ?? props.defaultValue));
  useEffect(() => {
    if (props.value !== undefined) setHasValue(hasInputValue(props.value));
  }, [props.value]);
  const clear = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const control = event.currentTarget.parentElement?.querySelector("input, textarea") as HTMLInputElement | HTMLTextAreaElement | null;
    if (!control) return;
    const prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(control, "");
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
    control.focus();
    setHasValue(false);
  };
  return <span className="clearable-field-control" onInput={(event) => setHasValue(hasInputValue((event.target as HTMLInputElement | HTMLTextAreaElement).value))}>{children}{hasValue && <button type="button" className="field-clear-button" onClick={clear} aria-label="입력 내용 전체 지우기">×</button>}</span>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const props = isValidElement(children) ? children.props as { type?: string } : {};
  const clearable = isValidElement(children) && (children.type === "textarea" || (children.type === "input" && [undefined, "text", "search", "email", "url", "tel", "number", "date", "time"].includes(props.type)));
  return <label className="field"><span>{label}</span>{clearable ? <ClearableFieldControl>{children}</ClearableFieldControl> : children}</label>;
}
function MeasureField({ label, name, unit, previous, value, step = "0.1" }: { label: string; name: string; unit: string; previous?: number; value?: number; step?: string }) { return <label className="measure-field"><div><span>{label} ({unit})</span>{previous !== undefined && <small>이전 측정 {previous}{unit}</small>}</div><div><ClearableFieldControl><input inputMode="decimal" type="number" step={step} min="0" name={name} defaultValue={value ?? previous} required /></ClearableFieldControl><b>{unit}</b></div></label>; }

function MealSheet({ today, kind, library, draft, presetType, close, save }: { today: string; kind: EntryKind; library: FoodLibraryItem[]; draft?: MealEntry; presetType?: MealType; close: () => void; save: (event: FormEvent<HTMLFormElement>, kind: EntryKind) => void }) {
  const hour = new Date().getHours();
  const defaultType: MealType = draft?.mealType ?? presetType ?? (hour < 10 ? "breakfast" : hour < 15 ? "lunch" : "dinner");
  const editing = draft?.kind === kind;
  const initialFood = library.find((item) => item.id === draft?.foodLibraryId);
  const initialBasis = initialFood ? foodBasis(initialFood) : undefined;
  const initialQuantity = draft?.quantity ?? (initialBasis ? (draft?.servings ?? 1) * initialBasis.amount : 1);
  const makeFoodComponent = (food: FoodLibraryItem, amount = foodBasis(food).amount, componentId = id("meal-food")): MealFoodComponent => {
    const factor = amount / foodBasis(food).amount;
    return {
      id: componentId,
      foodLibraryId: food.id,
      name: food.name,
      quantity: amount,
      unit: foodBasis(food).unit,
      calories: roundNutrient(food.calories * factor),
      protein: roundNutrient(food.protein * factor),
      carbs: roundNutrient(food.carbs * factor),
      fat: roundNutrient(food.fat * factor),
      sugar: roundNutrient(food.sugar * factor),
      fiber: roundNutrient(food.fiber * factor),
    };
  };
  const makeOfficialComponent = (food: OfficialFoodResult): MealFoodComponent => ({
    id: id("meal-food"),
    dataSource: "mfds",
    sourceCode: food.code,
    name: food.name,
    quantity: food.baseAmount,
    unit: food.unit,
    calories: food.calories,
    protein: food.protein,
    carbs: food.carbs,
    fat: food.fat,
    sugar: food.sugar,
    fiber: food.fiber,
  });
  const manualComponent = (name = "", values?: Pick<MealEntry, "calories" | "protein" | "carbs" | "fat" | "sugar" | "fiber">): MealFoodComponent => ({
    id: id("meal-food"), name,
    calories: values?.calories ?? 0, protein: values?.protein ?? 0, carbs: values?.carbs ?? 0,
    fat: values?.fat ?? 0, sugar: values?.sugar ?? 0, fiber: values?.fiber ?? 0,
  });
  const initialComponents = draft?.components?.length
    ? draft.components.map((item) => ({ ...item, id: item.id || id("meal-food") }))
    : draft?.skipped
      ? []
    : initialFood
      ? [makeFoodComponent(initialFood, initialQuantity)]
      : draft?.title
        ? [manualComponent(draft.title, draft.kind === "actual" ? draft : undefined)]
        : [];
  const sumComponents = (items: MealFoodComponent[]) => items.reduce((sum, item) => ({
    calories: roundNutrient(sum.calories + item.calories),
    protein: roundNutrient(sum.protein + item.protein),
    carbs: roundNutrient(sum.carbs + item.carbs),
    fat: roundNutrient(sum.fat + item.fat),
    sugar: roundNutrient(sum.sugar + item.sugar),
    fiber: roundNutrient(sum.fiber + item.fiber),
  }), { calories: 0, protein: 0, carbs: 0, fat: 0, sugar: 0, fiber: 0 });
  const copiedPlan = kind === "actual" && draft?.kind === "plan";
  const initialTotals = sumComponents(initialComponents);
  const [search, setSearch] = useState("");
  const [components, setComponents] = useState<MealFoodComponent[]>(initialComponents);
  const [nutrients, setNutrients] = useState({
    calories: copiedPlan ? String(initialTotals.calories || "") : draft?.calories ? String(draft.calories) : String(initialTotals.calories || ""),
    protein: copiedPlan ? String(initialTotals.protein || "") : draft?.protein ? String(draft.protein) : String(initialTotals.protein || ""),
    carbs: copiedPlan ? String(initialTotals.carbs || "") : draft?.carbs ? String(draft.carbs) : String(initialTotals.carbs || ""),
    fat: copiedPlan ? String(initialTotals.fat || "") : draft?.fat ? String(draft.fat) : String(initialTotals.fat || ""),
    sugar: copiedPlan ? String(initialTotals.sugar || "") : draft?.sugar ? String(draft.sugar) : String(initialTotals.sugar || ""),
    fiber: copiedPlan ? String(initialTotals.fiber || "") : draft?.fiber ? String(draft.fiber) : String(initialTotals.fiber || ""),
  });
  const results = library.filter((item) => item.name.toLocaleLowerCase("ko").includes(search.trim().toLocaleLowerCase("ko"))).slice(0, 8);
  const syncComponents = (next: MealFoodComponent[]) => {
    setComponents(next);
    if (kind !== "actual") return;
    const totals = sumComponents(next);
    setNutrients(Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, String(value || "")])) as typeof nutrients);
  };
  const addFood = (food: FoodLibraryItem) => syncComponents([...components, makeFoodComponent(food)]);
  const addOfficialFood = (food: OfficialFoodResult) => syncComponents([...components, makeOfficialComponent(food)]);
  const addManual = () => syncComponents([...components, manualComponent()]);
  const removeComponent = (componentId: string) => syncComponents(components.filter((item) => item.id !== componentId));
  const changeName = (componentId: string, name: string) => setComponents((current) => current.map((item) => item.id === componentId ? { ...item, name } : item));
  const changeQuantity = (component: MealFoodComponent, value: number) => {
    const nextAmount = Math.max(0.1, value || component.quantity || 1);
    const food = library.find((item) => item.id === component.foodLibraryId);
    if (food) {
      syncComponents(components.map((item) => item.id === component.id ? makeFoodComponent(food, nextAmount, item.id) : item));
      return;
    }
    const factor = component.quantity ? nextAmount / component.quantity : 1;
    syncComponents(components.map((item) => item.id === component.id ? {
      ...item,
      quantity: nextAmount,
      calories: roundNutrient(item.calories * factor), protein: roundNutrient(item.protein * factor), carbs: roundNutrient(item.carbs * factor),
      fat: roundNutrient(item.fat * factor), sugar: roundNutrient(item.sugar * factor), fiber: roundNutrient(item.fiber * factor),
    } : item));
  };
  const setNutrient = (key: keyof typeof nutrients, value: string) => setNutrients((current) => ({ ...current, [key]: value }));
  const title = components.filter((item) => item.name.trim()).map((item) => item.quantity && item.unit ? `${item.name.trim()} ${item.quantity}${item.unit}` : item.name.trim()).join(", ");

  return <Sheet title={editing ? (kind === "plan" ? "식사 계획 수정" : "먹은 식사 수정") : kind === "plan" ? "식사 계획" : "먹은 식사 기록"} close={close}>
    <form className="form-stack meal-form" onSubmit={(event) => save(event, kind)}>
      <input type="hidden" name="editingId" value={editing ? draft.id : ""} />
      <input type="hidden" name="components" value={JSON.stringify(components)} />
      <input type="hidden" name="title" value={title} />
      <div className="two-fields sheet-leading-fields"><Field label="날짜"><input type="date" name="date" defaultValue={draft?.date ?? today} required /></Field><Field label="끼니"><select name="mealType" defaultValue={defaultType}>{Object.entries(mealLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field></div>
      <section className="saved-food-picker"><div className="saved-food-picker-heading"><strong>음식 보관함에서 추가</strong></div>{library.length ? <><ClearableFieldControl><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="음식 또는 세트 검색" /></ClearableFieldControl><div className="saved-food-results">{results.map((food) => <button type="button" key={food.id} onClick={() => addFood(food)}><strong>{food.name}</strong><span>{foodBasisLabel(food)} · {food.calories}kcal</span><em>추가</em></button>)}</div></> : <p className="saved-food-empty">저장된 음식이 없어요.</p>}</section>
      <OfficialFoodSearch title="식약처에서 바로 추가" actionLabel="추가" onChoose={addOfficialFood} />
      <section className="meal-component-box"><div className="meal-component-heading"><strong>{kind === "plan" ? "먹고 싶은 음식" : "먹은 음식"}</strong><div><span>{components.length}개</span><button type="button" onClick={addManual}>직접 추가</button></div></div>{components.length ? <div className="meal-component-list">{components.map((component) => {
        const measured = Boolean(component.quantity && component.unit);
        return <article key={component.id} className={measured ? "measured-component" : "manual-component"}><div className="meal-component-main">{measured ? <strong>{component.name}</strong> : <ClearableFieldControl><input value={component.name} onChange={(event) => changeName(component.id, event.target.value)} placeholder="음식 이름" aria-label="음식 이름" /></ClearableFieldControl>}{measured && <div className="component-quantity"><ClearableFieldControl><input type="number" min="0.1" step="0.1" value={component.quantity} onChange={(event) => changeQuantity(component, Number(event.target.value))} aria-label={`${component.name} 양`} /></ClearableFieldControl><b>{component.unit}</b></div>}</div><button type="button" className="delete-text-button" onClick={() => removeComponent(component.id)}>삭제</button></article>;
      })}</div> : <p className="meal-component-empty">음식을 추가해주세요.</p>}</section>
      {kind === "actual" && <div className="macro-grid"><Field label="칼로리 (kcal)"><input type="number" name="calories" min="0" value={nutrients.calories} onChange={(event) => setNutrient("calories", event.target.value)} placeholder="kcal" /></Field><Field label="단백질 (g)"><input type="number" name="protein" min="0" step="0.1" value={nutrients.protein} onChange={(event) => setNutrient("protein", event.target.value)} placeholder="g" /></Field><Field label="탄수화물 (g)"><input type="number" name="carbs" min="0" step="0.1" value={nutrients.carbs} onChange={(event) => setNutrient("carbs", event.target.value)} placeholder="g" /></Field><Field label="지방 (g)"><input type="number" name="fat" min="0" step="0.1" value={nutrients.fat} onChange={(event) => setNutrient("fat", event.target.value)} placeholder="g" /></Field><Field label="당류 (g)"><input type="number" name="sugar" min="0" step="0.1" value={nutrients.sugar} onChange={(event) => setNutrient("sugar", event.target.value)} placeholder="g" /></Field><Field label="식이섬유 (g)"><input type="number" name="fiber" min="0" step="0.1" value={nutrients.fiber} onChange={(event) => setNutrient("fiber", event.target.value)} placeholder="g" /></Field></div>}
      <button className="primary-button submit-button" type="submit" disabled={!title}>{editing ? "수정 저장" : kind === "plan" ? "계획 저장" : "식사 기록 저장"}</button>
      {kind === "actual" && <button className="meal-skip-button" type="submit" name="skipped" value="true">{draft?.skipped ? "먹지 않음으로 유지" : "이번 끼니는 먹지 않음"}</button>}
    </form>
  </Sheet>;
}

function FoodLibrarySheet({ library, close, save, saveSet, remove }: { library: FoodLibraryItem[]; close: () => void; save: (event: FormEvent<HTMLFormElement>) => void; saveSet: (name: string, components: { foodId: string; amount: number }[], editingId?: string) => void; remove: (item: FoodLibraryItem) => void }) {
  type ComponentDraft = { id: string; foodId: string; amount: number };
  const foods = library.filter((item) => item.kind !== "set");
  const [mode, setMode] = useState<"food" | "set">("food");
  const [editing, setEditing] = useState<FoodLibraryItem>();
  const [officialDraft, setOfficialDraft] = useState<FoodLibraryItem>();
  const [librarySearch, setLibrarySearch] = useState("");
  const [formVersion, setFormVersion] = useState(0);
  const [setName, setSetName] = useState("");
  const [components, setComponents] = useState<ComponentDraft[]>([
    { id: id("component"), foodId: "", amount: 1 },
    { id: id("component"), foodId: "", amount: 1 },
  ]);

  const reset = (nextMode: "food" | "set") => {
    setMode(nextMode);
    setEditing(undefined);
    setOfficialDraft(undefined);
    setSetName("");
    setComponents([{ id: id("component"), foodId: "", amount: 1 }, { id: id("component"), foodId: "", amount: 1 }]);
    setFormVersion((version) => version + 1);
  };
  const finishSave = (event: FormEvent<HTMLFormElement>) => {
    save(event);
    reset("food");
  };
  const edit = (item: FoodLibraryItem) => {
    setEditing(item);
    setOfficialDraft(undefined);
    setMode(item.kind === "set" ? "set" : "food");
    setSetName(item.kind === "set" ? item.name : "");
    setComponents(item.kind === "set" && item.components?.length
      ? item.components.map((component) => ({ id: id("component"), ...component }))
      : [{ id: id("component"), foodId: "", amount: 1 }, { id: id("component"), foodId: "", amount: 1 }]);
    setFormVersion((version) => version + 1);
  };
  const updateComponent = (componentId: string, patch: Partial<ComponentDraft>) => setComponents((current) => current.map((component) => component.id === componentId ? { ...component, ...patch } : component));
  const chooseComponentFood = (componentId: string, foodId: string) => {
    const food = foods.find((item) => item.id === foodId);
    updateComponent(componentId, { foodId, amount: food ? foodBasis(food).amount : 1 });
  };
  const finishSet = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const valid = components.filter((component) => component.foodId && component.amount > 0);
    if (valid.length < 2) {
      window.alert("세트에는 음식을 2개 이상 넣어주세요.");
      return;
    }
    saveSet(setName, valid.map(({ foodId, amount }) => ({ foodId, amount })), editing?.kind === "set" ? editing.id : undefined);
    reset("set");
  };
  const totals = components.reduce((sum, component) => {
    const food = foods.find((item) => item.id === component.foodId);
    if (!food) return sum;
    const factor = component.amount / foodBasis(food).amount;
    return { calories: sum.calories + food.calories * factor, protein: sum.protein + food.protein * factor };
  }, { calories: 0, protein: 0 });
  const formFood = editing && editing.kind !== "set" ? editing : officialDraft;
  const visibleLibrary = library.filter((item) => item.name.toLocaleLowerCase("ko").includes(librarySearch.trim().toLocaleLowerCase("ko")));
  const chooseOfficialFood = (food: OfficialFoodResult) => {
    setMode("food");
    setEditing(undefined);
    setOfficialDraft({
      id: "",
      name: food.name,
      kind: "food",
      baseAmount: food.baseAmount,
      unit: food.unit,
      servingLabel: `${food.baseAmount}${food.unit}`,
      calories: food.calories,
      protein: food.protein,
      carbs: food.carbs,
      fat: food.fat,
      sugar: food.sugar,
      fiber: food.fiber,
      dataSource: "mfds",
      sourceCode: food.code,
    });
    setFormVersion((version) => version + 1);
  };

  return <Sheet title="음식 보관함 추가" close={close}>
    <div className="library-mode-tabs"><button type="button" className={mode === "food" ? "active" : ""} onClick={() => reset("food")}>음식 추가</button><button type="button" className={mode === "set" ? "active" : ""} onClick={() => reset("set")}>세트 만들기</button></div>
    {mode === "food" ? <form key={`${formFood?.id ?? "new"}-${formVersion}`} className="form-stack food-library-form" onSubmit={finishSave}>
      <OfficialFoodSearch onChoose={chooseOfficialFood} />
      <input type="hidden" name="editingId" value={editing?.kind !== "set" ? editing?.id ?? "" : ""} />
      <input type="hidden" name="dataSource" value={formFood?.dataSource ?? "manual"} />
      <input type="hidden" name="sourceCode" value={formFood?.sourceCode ?? ""} />
      <Field label="음식 이름"><input name="name" defaultValue={formFood?.name ?? ""} placeholder="예: 무가당 그릭요거트" required /></Field>
      <div className="two-fields food-basis-fields"><Field label="영양정보 기준량"><input type="number" name="baseAmount" min="0.1" step="0.1" inputMode="decimal" defaultValue={formFood ? foodBasis(formFood).amount : 1} required /></Field><Field label="단위"><select name="unit" defaultValue={formFood ? foodBasis(formFood).unit : "g"}>{foodUnits.map((unit) => <option key={unit}>{unit}</option>)}</select></Field></div>
      <div className="macro-grid"><Field label="칼로리 (kcal)"><input type="number" name="calories" min="0" step="0.1" defaultValue={formFood?.calories ?? ""} placeholder="kcal" required /></Field><Field label="단백질 (g)"><input type="number" name="protein" min="0" step="0.1" defaultValue={formFood?.protein ?? ""} placeholder="g" /></Field><Field label="탄수화물 (g)"><input type="number" name="carbs" min="0" step="0.1" defaultValue={formFood?.carbs ?? ""} placeholder="g" /></Field><Field label="지방 (g)"><input type="number" name="fat" min="0" step="0.1" defaultValue={formFood?.fat ?? ""} placeholder="g" /></Field><Field label="당류 (g)"><input type="number" name="sugar" min="0" step="0.1" defaultValue={formFood?.sugar ?? ""} placeholder="g" /></Field><Field label="식이섬유 (g)"><input type="number" name="fiber" min="0" step="0.1" defaultValue={formFood?.fiber ?? ""} placeholder="g" /></Field></div>
      <div className="food-library-form-actions">{editing && <button type="button" className="ghost-button" onClick={() => reset("food")}>새 음식</button>}<button className="primary-button" type="submit">{editing ? "수정 저장" : "보관함에 저장"}</button></div>
    </form> : <form className="form-stack food-library-form" onSubmit={finishSet}>
      <Field label="세트 이름"><input value={setName} onChange={(event) => setSetName(event.target.value)} placeholder="예: 아침 요거트 세트" required /></Field>
      <div className="food-set-components">{components.map((component, index) => {
        const food = foods.find((item) => item.id === component.foodId);
        return <div className="food-set-row" key={component.id}><Field label={`음식 ${index + 1}`}><select value={component.foodId} onChange={(event) => chooseComponentFood(component.id, event.target.value)} required><option value="">음식 선택</option>{foods.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></Field><Field label={`양 (${food ? foodBasis(food).unit : "단위"})`}><div className="amount-with-unit"><ClearableFieldControl><input type="number" min="0.1" step="0.1" value={component.amount} onChange={(event) => updateComponent(component.id, { amount: Number(event.target.value) })} required /></ClearableFieldControl><b>{food ? foodBasis(food).unit : "-"}</b></div></Field>{components.length > 2 && <button type="button" className="delete-text-button" onClick={() => setComponents((current) => current.filter((item) => item.id !== component.id))}>삭제</button>}</div>;
      })}</div>
      <button type="button" className="food-set-add" onClick={() => setComponents((current) => [...current, { id: id("component"), foodId: "", amount: 1 }])}>+ 음식 더 넣기</button>
      {!foods.length && <p className="saved-food-empty">먼저 음식을 2개 이상 추가해주세요.</p>}
      <div className="food-set-total"><span>세트 1인분</span><strong>{roundNutrient(totals.calories)} kcal · 단백질 {roundNutrient(totals.protein)}g</strong></div>
      <div className="food-library-form-actions">{editing && <button type="button" className="ghost-button" onClick={() => reset("set")}>새 세트</button>}<button className="primary-button" type="submit" disabled={foods.length < 2}>{editing ? "세트 수정 저장" : "세트 저장"}</button></div>
    </form>}
    <section className="food-library-browser">
      <div className="food-library-browser-heading"><strong>저장된 음식</strong><span>{library.length}개</span></div>
      {library.length > 0 && <ClearableFieldControl><input type="search" value={librarySearch} onChange={(event) => setLibrarySearch(event.target.value)} placeholder="저장된 음식 또는 세트 검색" aria-label="음식 보관함 검색" /></ClearableFieldControl>}
      <div className="food-library-list">{library.length ? visibleLibrary.length ? visibleLibrary.map((item) => <article key={item.id}><div><span>{item.kind === "set" ? `세트 · 음식 ${item.components?.length ?? 0}개` : item.dataSource === "mfds" ? "음식 · 식약처" : "음식"}</span><strong>{item.name}</strong><small>{foodBasisLabel(item)} · {item.calories}kcal · 단백질 {item.protein}g</small></div><div><button type="button" onClick={() => edit(item)}>수정</button><button type="button" className="delete-text-button" onClick={() => remove(item)}>삭제</button></div></article>) : <p>검색 결과가 없어요.</p> : <p>저장된 음식이 없어요.</p>}</div>
    </section>
  </Sheet>;
}

function OfficialFoodSearch({ onChoose, title = "기본 영양정보 찾기", actionLabel }: { onChoose: (food: OfficialFoodResult) => void; title?: string; actionLabel?: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<OfficialFoodResult[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "unconfigured" | "error">("idle");
  const search = async () => {
    if (query.trim().length < 2) return;
    setStatus("loading");
    try {
      const response = await fetch(`/api/food-search?q=${encodeURIComponent(query.trim())}`);
      const data = await response.json() as { configured?: boolean; items?: OfficialFoodResult[] };
      if (!data.configured) {
        setResults([]);
        setStatus("unconfigured");
        return;
      }
      setResults(data.items ?? []);
      setStatus("ready");
    } catch {
      setResults([]);
      setStatus("error");
    }
  };
  return <section className="official-food-search">
    <div className="official-food-search-heading"><strong>{title}</strong><span>식품의약품안전처</span></div>
    <div className="official-food-search-bar"><ClearableFieldControl><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} placeholder="예: 소고기무국" /></ClearableFieldControl><button type="button" onClick={() => void search()} disabled={query.trim().length < 2 || status === "loading"}>{status === "loading" ? "검색 중" : "검색"}</button></div>
    {status === "unconfigured" && <p>공식 데이터 연결키가 준비되면 바로 검색할 수 있어요.</p>}
    {status === "error" && <p>검색하지 못했어요. 잠시 후 다시 시도해주세요.</p>}
    {status === "ready" && !results.length && <p>검색 결과가 없어요. 아래에서 직접 입력할 수 있어요.</p>}
    {results.length > 0 && <div className="official-food-results">{results.map((food) => <button type="button" key={`${food.code}-${food.name}`} onClick={() => onChoose(food)}><strong>{food.name}</strong><span>{food.baseAmount}{food.unit} · {food.calories}kcal{food.maker ? ` · ${food.maker}` : ""}</span>{actionLabel && <em>{actionLabel}</em>}</button>)}</div>}
  </section>;
}

function WeeklyPlanSheet({ state, today, initialStart, consultation, close, save }: { state: AppState; today: string; initialStart?: string; consultation?: Consultation; close: () => void; save: (start: string, draft: WeeklyDraft) => void }) {
  const firstStart = initialStart ?? weekStart(today, 1);
  const [start, setStart] = useState(firstStart);
  const [activeIndex, setActiveIndex] = useState(0);
  const [draft, setDraft] = useState<WeeklyDraft>(() => createWeeklyDraft(state, firstStart));
  const suggestions = consultation?.planSuggestions ?? [];
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<string[]>([]);
  const [suggestionMessage, setSuggestionMessage] = useState("");
  const dates = weekDates(start);
  const activeDate = dates[activeIndex];
  const day = draft[activeDate];
  const goal = state.workoutGoal ?? initialState.workoutGoal!;
  const dayNames = ["월", "화", "수", "목", "금", "토", "일"];
  const loadWeek = (next: string) => {
    setStart(next);
    setActiveIndex(0);
    setDraft(createWeeklyDraft(state, next));
  };
  const updateMeal = (mealType: MealType, index: number, title: string) => setDraft((current) => ({ ...current, [activeDate]: { ...current[activeDate], meals: { ...current[activeDate].meals, [mealType]: current[activeDate].meals[mealType].map((item, itemIndex) => itemIndex === index ? title : item) } } }));
  const addMeal = (mealType: MealType) => setDraft((current) => ({ ...current, [activeDate]: { ...current[activeDate], meals: { ...current[activeDate].meals, [mealType]: [...current[activeDate].meals[mealType], ""] } } }));
  const removeMeal = (mealType: MealType, index: number) => setDraft((current) => {
    const remaining = current[activeDate].meals[mealType].filter((_, itemIndex) => itemIndex !== index);
    return { ...current, [activeDate]: { ...current[activeDate], meals: { ...current[activeDate].meals, [mealType]: remaining.length ? remaining : [""] } } };
  });
  const updateWorkout = (workoutId: string, patch: Partial<WeeklyWorkoutDraft>) => setDraft((current) => ({ ...current, [activeDate]: { ...current[activeDate], workouts: current[activeDate].workouts.map((item) => item.id === workoutId ? { ...item, ...patch } : item) } }));
  const addWorkout = () => setDraft((current) => ({ ...current, [activeDate]: { ...current[activeDate], workouts: [...current[activeDate].workouts, { id: id("weekly-workout"), startTime: "", type: "유산소", title: "", minutes: "35", intensity: 5, heartRate: "", overlapsSteps: false, details: "" }] } }));
  const removeWorkout = (workoutId: string) => setDraft((current) => ({ ...current, [activeDate]: { ...current[activeDate], workouts: current[activeDate].workouts.filter((item) => item.id !== workoutId) } }));
  const hasPlan = (date: string) => Object.values(draft[date].meals).some((items) => items.some((item) => item.trim())) || draft[date].workouts.some((item) => item.title.trim());
  const toggleSuggestion = (suggestionId: string) => setSelectedSuggestionIds((current) => current.includes(suggestionId) ? current.filter((item) => item !== suggestionId) : [...current, suggestionId]);
  const applySuggestions = () => {
    const selected = suggestions.filter((suggestion) => selectedSuggestionIds.includes(suggestion.id));
    if (!selected.length) return;
    setDraft((current) => {
      const next = Object.fromEntries(Object.entries(current).map(([date, item]) => [date, {
        meals: Object.fromEntries((Object.keys(mealLabels) as MealType[]).map((mealType) => [mealType, [...item.meals[mealType]]])) as Record<MealType, string[]>,
        workouts: item.workouts.map((workout) => ({ ...workout })),
      }])) as WeeklyDraft;
      selected.forEach((suggestion) => {
        suggestion.meals.forEach((meal) => {
          const date = addDays(start, Math.min(6, Math.max(0, meal.dayOffset)));
          const title = meal.title.trim();
          if (!next[date] || !title || next[date].meals[meal.mealType].some((item) => item.trim() === title)) return;
          const existing = next[date].meals[meal.mealType];
          next[date].meals[meal.mealType] = existing.length === 1 && !existing[0].trim() ? [title] : [...existing, title];
        });
        suggestion.workouts.forEach((workout) => {
          const date = addDays(start, Math.min(6, Math.max(0, workout.dayOffset)));
          const title = workout.title.trim();
          if (!next[date] || !title || next[date].workouts.some((item) => item.type === workout.type && item.title.trim() === title)) return;
          next[date].workouts.push({
            id: id("ai-workout"), startTime: "", type: workout.type, title,
            minutes: String(Math.max(1, workout.minutes)), intensity: Math.min(10, Math.max(1, workout.intensity)),
            heartRate: workout.heartRate.trim(), overlapsSteps: workout.type === "유산소" && workout.overlapsSteps, details: "",
          });
        });
      });
      return next;
    });
    setSuggestionMessage("선택한 제안을 초안에 넣었어요. 아래에서 자유롭게 수정하세요.");
  };

  return <Sheet title="주간 계획하기" close={close}>
    <div className="week-plan-nav"><button type="button" onClick={() => loadWeek(addDays(start, -7))} aria-label="이전 주">‹</button><strong>{start.replaceAll("-", ".")} – {addDays(start, 6).replaceAll("-", ".")}</strong><button type="button" onClick={() => loadWeek(addDays(start, 7))} aria-label="다음 주">›</button></div>
    <div className="week-plan-jump"><Field label="계획할 주 선택"><input type="date" value={start} onChange={(event) => event.target.value && loadWeek(weekStart(event.target.value))} /></Field><button type="button" onClick={() => loadWeek(weekStart(today, 1))}>다음 주</button></div>
    {suggestions.length > 0 && <section className="ai-plan-suggestions">
      <div className="ai-plan-suggestions-title"><div><span>AI 상담 제안</span><strong>반영할 내용만 골라주세요</strong></div><small>{consultation?.date}</small></div>
      <div className="ai-plan-suggestion-list">{suggestions.map((suggestion) => <label key={suggestion.id} className={selectedSuggestionIds.includes(suggestion.id) ? "selected" : ""}><input type="checkbox" checked={selectedSuggestionIds.includes(suggestion.id)} onChange={() => toggleSuggestion(suggestion.id)} /><span><b>{suggestion.title}</b><small>{suggestion.detail}</small></span><em>{suggestion.category === "meal" ? "식단" : "운동"}</em></label>)}</div>
      <div className="ai-plan-suggestion-action"><button type="button" onClick={applySuggestions} disabled={!selectedSuggestionIds.length}>선택한 제안으로 초안 만들기</button>{suggestionMessage && <p>{suggestionMessage}</p>}</div>
    </section>}
    <div className="week-plan-targets"><span>유산소 {goal.cardioSessions}회 · {goal.cardioMinutes}분</span><span>단백질 {state.nutritionGoal.proteinMin}~{state.nutritionGoal.proteinMax}g</span><span>당류 ≤ {state.nutritionGoal.sugarMax}g</span><span>식이섬유 ≥ {state.nutritionGoal.fiberMin}g</span></div>
    <div className="week-plan-days">{dates.map((date, index) => <button type="button" key={date} className={`${index === activeIndex ? "active" : ""} ${hasPlan(date) ? "has-plan" : ""}`} onClick={() => setActiveIndex(index)}><span>{dayNames[index]}</span><b>{Number(date.slice(-2))}</b></button>)}</div>
    <div className="weekly-editor">
      <div className="weekly-editor-title"><div><span className="eyebrow">{dayNames[activeIndex]}요일</span><h3>{dateLabel(activeDate)}</h3></div></div>
      <h4>식단 계획</h4>
      <datalist id="weekly-food-library">{(state.foodLibrary ?? []).map((food) => <option value={food.name} key={food.id} />)}</datalist>
      <div className="weekly-meal-grid">{(Object.keys(mealLabels) as MealType[]).map((mealType) => <div className="weekly-meal-group" key={mealType}><div className="weekly-meal-heading"><strong>{mealLabels[mealType]}</strong><button type="button" onClick={() => addMeal(mealType)}>+ 음식 추가</button></div><div className="weekly-meal-items">{day.meals[mealType].map((title, index) => <div className={`weekly-meal-item ${day.meals[mealType].length === 1 ? "single" : ""}`} key={`${mealType}-${index}`}><ClearableFieldControl><input list="weekly-food-library" value={title} onChange={(event) => updateMeal(mealType, index, event.target.value)} placeholder="음식 종류" /></ClearableFieldControl>{day.meals[mealType].length > 1 && <button type="button" onClick={() => removeMeal(mealType, index)} aria-label={`${mealLabels[mealType]} 음식 ${index + 1} 삭제`}>×</button>}</div>)}</div></div>)}</div>
      <div className="weekly-workout-heading"><h4>운동 계획</h4><button type="button" onClick={addWorkout}>+ 운동 추가</button></div>
      <div className="weekly-workouts">{day.workouts.map((workout, index) => <article key={workout.id} className="weekly-workout-card">
        <div className="weekly-workout-card-title"><strong>운동 {index + 1}</strong><button type="button" className="delete-text-button" onClick={() => removeWorkout(workout.id)}>삭제</button></div>
        <div className="two-fields"><Field label="운동 종류"><select value={workout.type} onChange={(event) => updateWorkout(workout.id, { type: event.target.value as WorkoutEntry["type"], overlapsSteps: event.target.value === "유산소" && workout.overlapsSteps })}><option>PT</option><option>유산소</option></select></Field><Field label="운동 이름"><input value={workout.title} onChange={(event) => updateWorkout(workout.id, { title: event.target.value })} placeholder={workout.type === "PT" ? "필라테스 + 기능운동" : "인클라인 트레드밀"} /></Field></div>
        <Field label="시작 시간 (선택)"><input type="time" value={workout.startTime} onChange={(event) => updateWorkout(workout.id, { startTime: event.target.value })} /></Field>
        <div className="two-fields"><Field label="시간 (분)"><input type="number" min="1" value={workout.minutes} onChange={(event) => updateWorkout(workout.id, { minutes: event.target.value })} /></Field><Field label="체감 강도 (1~10)"><select value={workout.intensity} onChange={(event) => updateWorkout(workout.id, { intensity: Number(event.target.value) })}>{[1,2,3,4,5,6,7,8,9,10].map((value) => <option value={value} key={value}>{value}</option>)}</select></Field></div>
        <Field label="평균 심박수 (bpm, 선택)"><input value={workout.heartRate} onChange={(event) => updateWorkout(workout.id, { heartRate: event.target.value })} placeholder="예: 130~140" /></Field>
        {workout.type === "유산소" && <label className="check-field step-overlap-check"><input type="checkbox" checked={workout.overlapsSteps} onChange={(event) => updateWorkout(workout.id, { overlapsSteps: event.target.checked })} /><strong>일상 걸음 수와 중복되는 운동</strong></label>}
      </article>)}</div>
      {!day.workouts.length && <p className="weekly-empty">운동 계획 없음</p>}
    </div>
    <button type="button" className="primary-button submit-button" onClick={() => save(start, draft)}>주간 계획 저장</button>
  </Sheet>;
}

function WorkoutGoalSheet({ goal, close, save }: { goal: NonNullable<AppState["workoutGoal"]>; close: () => void; save: (event: FormEvent<HTMLFormElement>) => void }) {
  return <Sheet title="주간 운동 목표" close={close}><form className="form-stack" onSubmit={save}><Field label="개인 유산소 최소 횟수 (회)"><input type="number" name="cardioSessions" min="1" max="14" defaultValue={goal.cardioSessions} required /></Field><Field label="개인 유산소 누적시간 (분)"><input type="number" name="cardioMinutes" min="1" max="1000" defaultValue={goal.cardioMinutes} required /></Field><button className="primary-button submit-button" type="submit">목표 저장</button></form></Sheet>;
}

function DataManagementSheet({ state, today, close, backup, exportCsv: downloadCsv, restore, restoreDeleted, permanentlyDelete, emptyTrash }: { state: AppState; today: string; close: () => void; backup: () => void; exportCsv: (kind: CsvKind) => void; restore: (state: AppState, mode: RestoreMode) => void; restoreDeleted: (item: TrashItem) => void; permanentlyDelete: (item: TrashItem) => void; emptyTrash: () => void }) {
  const [preview, setPreview] = useState<{ state: AppState; name: string }>();
  const [error, setError] = useState("");
  const csvItems: { kind: CsvKind; label: string; count: number }[] = [
    { kind: "body", label: "체성분", count: state.bodyRecords.length },
    { kind: "circumference", label: "신체둘레", count: (state.circumferenceRecords ?? []).length },
    { kind: "meals", label: "식단", count: state.meals.length },
    { kind: "workouts", label: "운동", count: state.workouts.length },
    { kind: "activity", label: "하루 활동", count: (state.dailyActivities ?? []).length },
    { kind: "cycles", label: "월경", count: state.cycles.length },
  ];
  const counts = preview ? [
    ["체성분", preview.state.bodyRecords.length],
    ["신체둘레", (preview.state.circumferenceRecords ?? []).length],
    ["식단", preview.state.meals.length],
    ["운동", preview.state.workouts.length],
    ["하루 활동", (preview.state.dailyActivities ?? []).length],
    ["월경", preview.state.cycles.length],
    ["상담", preview.state.consultations.length],
    ["주간 메모", (preview.state.weeklyReviews ?? []).length],
  ] as const : [];
  const dates = preview ? [
    ...preview.state.bodyRecords.map((item) => item.date),
    ...(preview.state.circumferenceRecords ?? []).map((item) => item.date),
    ...preview.state.meals.map((item) => item.date),
    ...preview.state.workouts.map((item) => item.date),
    ...(preview.state.dailyActivities ?? []).map((item) => item.date),
    ...preview.state.cycles.map((item) => item.date),
    ...preview.state.consultations.map((item) => item.date),
    ...(preview.state.weeklyReviews ?? []).map((item) => item.weekStart),
  ].filter(Boolean).sort() : [];
  const lastBackup = state.lastBackupAt
    ? new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(state.lastBackupAt))
    : "아직 백업하지 않음";
  const trash = [...(state.trash ?? [])].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  const deletedAtLabel = (value: string) => new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));

  const chooseFile = async (file?: File) => {
    setPreview(undefined);
    setError("");
    if (!file) return;
    if (file.size > 5_000_000) { setError("5MB 이하의 SOYA 백업 파일을 선택해주세요."); return; }
    try {
      const restored = parseBackup(JSON.parse(await file.text()));
      if (!restored) throw new Error("invalid");
      setPreview({ state: restored, name: file.name });
    } catch {
      setError("SOYA 백업 파일을 읽지 못했어요.");
    }
  };

  const replaceAll = () => {
    if (!preview) return;
    if (window.confirm("현재 SOYA 기록을 모두 지우고 이 백업으로 교체할까요?")) restore(preview.state, "replace");
  };

  return <Sheet title="데이터 관리" close={close}>
    <div className="data-management-stack">
      <section className="data-management-section backup-section">
        <div className="data-section-heading"><div><strong>전체 백업</strong><small>마지막 백업 · {lastBackup}</small></div><span>JSON</span></div>
        <button type="button" className="primary-button data-wide-button" onClick={backup}>전체 백업 파일 내려받기</button>
      </section>

      <section className="data-management-section">
        <div className="data-section-heading"><div><strong>분야별 내보내기</strong><small>엑셀에서 열 수 있어요</small></div><span>CSV</span></div>
        <div className="csv-export-grid">{csvItems.map((item) => <button type="button" key={item.kind} onClick={() => downloadCsv(item.kind)}><strong>{item.label}</strong><small>{item.count}개</small><b>내려받기</b></button>)}</div>
      </section>

      <section className="data-management-section restore-section">
        <div className="data-section-heading"><div><strong>백업에서 복원</strong><small>기존 SOYA JSON도 사용할 수 있어요</small></div></div>
        <label className="backup-file-picker"><input type="file" accept="application/json,.json" onChange={(event) => { void chooseFile(event.target.files?.[0]); event.currentTarget.value = ""; }} /><span>{preview ? "다른 파일 선택" : "백업 파일 선택"}</span></label>
        {error && <p className="backup-error" role="alert">{error}</p>}
        {preview && <div className="restore-preview">
          <div className="restore-preview-title"><strong>{preview.name}</strong><small>{dates.length ? `${dates[0].replaceAll("-", ".")} – ${dates[dates.length - 1].replaceAll("-", ".")}` : "기록 날짜 없음"}</small></div>
          <div className="restore-count-grid">{counts.map(([label, count]) => <div key={label}><span>{label}</span><strong>{count}</strong></div>)}</div>
          <div className="restore-actions"><button type="button" className="secondary-button" onClick={() => restore(preview.state, "merge")}>현재 기록과 합치기</button><button type="button" className="danger-button" onClick={replaceAll}>전체 교체</button></div>
        </div>}
      </section>

      <section className="data-management-section trash-section">
        <div className="data-section-heading"><div><strong>최근 삭제한 기록</strong><small>실수로 지운 기록을 다시 살릴 수 있어요 · 최대 100개</small></div><span>{trash.length}개</span></div>
        {trash.length ? <>
          <div className="trash-list">{trash.map((item) => <article key={item.id}><div><strong>{item.label}</strong><small>{deletedAtLabel(item.deletedAt)} 삭제</small></div><div><button type="button" className="trash-restore-button" onClick={() => restoreDeleted(item)}>복원</button><button type="button" className="trash-delete-button" onClick={() => permanentlyDelete(item)}>영구 삭제</button></div></article>)}</div>
          <button type="button" className="trash-empty-button" onClick={emptyTrash}>휴지통 비우기</button>
        </> : <p className="trash-empty-copy">최근 삭제한 기록이 없어요.</p>}
      </section>
    </div>
  </Sheet>;
}

function ReminderSettingsSheet({ settings, pushStatus, pushMessage, enablePush, disablePush, close, save }: { settings: ReminderSettings; pushStatus: PushStatus; pushMessage: string; enablePush: () => void; disablePush: () => void; close: () => void; save: (settings: ReminderSettings) => void }) {
  const [draft, setDraft] = useState<ReminderSettings>(settings);
  const update = <K extends keyof ReminderSettings>(key: K, value: ReminderSettings[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const updateMealEnabled = (mealType: MealType, enabled: boolean) => setDraft((current) => ({ ...current, mealEnabled: { ...current.mealEnabled, [mealType]: enabled } }));
  const updateMealTime = (mealType: MealType, time: string) => setDraft((current) => ({ ...current, mealTimes: { ...current.mealTimes, [mealType]: time } }));
  const row = (label: string, enabled: boolean, toggle: (enabled: boolean) => void, time: string, changeTime: (time: string) => void) => <label className={`reminder-row ${enabled ? "active" : ""}`}><input className="reminder-check" type="checkbox" checked={enabled} onChange={(event) => toggle(event.target.checked)} /><span><strong>{label}</strong><small>{enabled ? time : "알림 끔"}</small></span><input className="reminder-time" type="time" value={time} disabled={!enabled} onChange={(event) => changeTime(event.target.value)} aria-label={`${label} 알림 시간`} /></label>;
  const cycleRow = ({ label, enabled, enabledKey, days, daysKey, time, timeKey, direction }: { label: string; enabled: boolean; enabledKey: "ovulationEnabled" | "periodEnabled" | "latePeriodEnabled"; days: number; daysKey: "ovulationLeadDays" | "periodLeadDays" | "latePeriodDays"; time: string; timeKey: "ovulationTime" | "periodTime" | "latePeriodTime"; direction: "before" | "after" }) => {
    const dayLabel = direction === "before" ? (days === 0 ? "당일" : `${days}일 전`) : `${days}일 뒤`;
    const choices = direction === "before" ? Array.from({ length: 8 }, (_, index) => index) : Array.from({ length: 14 }, (_, index) => index + 1);
    return <div className={`reminder-row cycle-relative ${enabled ? "active" : ""}`}><input className="reminder-check" type="checkbox" checked={enabled} onChange={(event) => update(enabledKey, event.target.checked)} aria-label={`${label} 알림 사용`} /><span><strong>{label}</strong><small>{enabled ? `${dayLabel} · ${time}` : "알림 끔"}</small></span><select className="reminder-lead-select" value={days} disabled={!enabled} onChange={(event) => update(daysKey, Number(event.target.value))} aria-label={`${label} 알림 날짜`}>{choices.map((value) => <option value={value} key={value}>{direction === "before" ? (value === 0 ? "당일" : `${value}일 전`) : `${value}일 뒤`}</option>)}</select><input className="reminder-time" type="time" value={time} disabled={!enabled} onChange={(event) => update(timeKey, event.target.value)} aria-label={`${label} 알림 시간`} /></div>;
  };
  const workoutLeadLabel = draft.workoutLeadMinutes === 0 ? "운동 시작 정시" : `운동 시작 ${draft.workoutLeadMinutes}분 전`;
  return <Sheet title="알림 설정" close={close}><form className="form-stack reminder-settings-form" onSubmit={(event) => { event.preventDefault(); save(draft); }}>
    <section className={`reminder-section push-permission-section ${pushStatus}`}><div><strong>실제 알림</strong><span>{pushStatus === "enabled" ? "켜짐" : pushStatus === "working" ? "연결 중" : "꺼짐"}</span></div><p>{pushMessage || (pushStatus === "enabled" ? "앱을 닫아도 설정한 시간에 알림이 와요." : pushStatus === "blocked" ? "아이폰 설정에서 SOYA 알림을 허용해주세요." : pushStatus === "unsupported" ? "아이폰 홈 화면에 추가한 SOYA에서 켤 수 있어요." : "아이폰 홈 화면의 SOYA에서 한 번만 켜주세요.")}</p>{pushStatus === "enabled" ? <button type="button" className="push-toggle-button off" onClick={disablePush}>실제 알림 끄기</button> : pushStatus !== "unsupported" && pushStatus !== "blocked" ? <button type="button" className="push-toggle-button" onClick={enablePush} disabled={pushStatus === "working"}>{pushStatus === "working" ? "연결 중…" : "실제 알림 켜기"}</button> : null}</section>
    <section className="reminder-section"><strong>매일 기록</strong>{row("아침 인바디", draft.bodyEnabled, (enabled) => update("bodyEnabled", enabled), draft.bodyTime, (time) => update("bodyTime", time))}{(["breakfast", "lunch", "dinner"] as MealType[]).map((mealType) => <div key={mealType}>{row(`${mealLabels[mealType]} 기록`, draft.mealEnabled[mealType], (enabled) => updateMealEnabled(mealType, enabled), draft.mealTimes[mealType], (time) => updateMealTime(mealType, time))}</div>)}</section>
    <section className="reminder-section"><strong>운동과 계획</strong><label className={`reminder-row workout-relative ${draft.workoutEnabled ? "active" : ""}`}><input className="reminder-check" type="checkbox" checked={draft.workoutEnabled} onChange={(event) => update("workoutEnabled", event.target.checked)} /><span><strong>계획한 운동</strong><small>{draft.workoutEnabled ? workoutLeadLabel : "알림 끔"}</small></span><select className="reminder-lead-select" value={draft.workoutLeadMinutes} disabled={!draft.workoutEnabled} onChange={(event) => update("workoutLeadMinutes", Number(event.target.value))} aria-label="계획한 운동 알림 시점"><option value={0}>정시</option><option value={10}>10분 전</option><option value={30}>30분 전</option><option value={60}>1시간 전</option></select></label><div className={`reminder-row weekly ${draft.weeklyEnabled ? "active" : ""}`}><input className="reminder-check" type="checkbox" checked={draft.weeklyEnabled} onChange={(event) => update("weeklyEnabled", event.target.checked)} /><span><strong>주간 계획</strong><small>{draft.weeklyEnabled ? "다음 주 식단·운동" : "알림 끔"}</small></span><select value={draft.weeklyDay} disabled={!draft.weeklyEnabled} onChange={(event) => update("weeklyDay", Number(event.target.value))} aria-label="주간 계획 요일">{["일", "월", "화", "수", "목", "금", "토"].map((day, index) => <option value={index} key={day}>{day}요일</option>)}</select><input className="reminder-time" type="time" value={draft.weeklyTime} disabled={!draft.weeklyEnabled} onChange={(event) => update("weeklyTime", event.target.value)} aria-label="주간 계획 알림 시간" /></div></section>
    <section className="reminder-section"><strong>월경</strong>{cycleRow({ label: "예상 배란일", enabled: draft.ovulationEnabled, enabledKey: "ovulationEnabled", days: draft.ovulationLeadDays, daysKey: "ovulationLeadDays", time: draft.ovulationTime, timeKey: "ovulationTime", direction: "before" })}{cycleRow({ label: "예상 월경일", enabled: draft.periodEnabled, enabledKey: "periodEnabled", days: draft.periodLeadDays, daysKey: "periodLeadDays", time: draft.periodTime, timeKey: "periodTime", direction: "before" })}{cycleRow({ label: "월경 기록 없음", enabled: draft.latePeriodEnabled, enabledKey: "latePeriodEnabled", days: draft.latePeriodDays, daysKey: "latePeriodDays", time: draft.latePeriodTime, timeKey: "latePeriodTime", direction: "after" })}</section>
    <section className="reminder-section travel-reminder-section"><div><strong>여행 중 알림</strong><small>여행 모드에만 적용</small></div><div className="travel-reminder-options">{(["기본 유지", "핵심만", "모두 끄기"] as ReminderSettings["travelBehavior"][]).map((behavior) => <button type="button" key={behavior} className={draft.travelBehavior === behavior ? "active" : ""} onClick={() => update("travelBehavior", behavior)}>{behavior}</button>)}</div><p>{draft.travelBehavior === "핵심만" ? "식사 기록만 남기고 인바디·운동·주간 계획 알림은 쉬어요." : draft.travelBehavior === "모두 끄기" ? "여행 기간에는 모든 알림을 쉬어요." : "평소 설정한 알림을 그대로 사용해요."}</p></section>
    <button className="primary-button submit-button" type="submit">알림 설정 저장</button>
  </form></Sheet>;
}

function NutritionGoalSheet({ goal, close, save }: { goal: AppState["nutritionGoal"]; close: () => void; save: (event: FormEvent<HTMLFormElement>) => void }) {
  const RangeFields = ({ label, minName, maxName, minValue, maxValue, unit }: { label: string; minName: string; maxName: string; minValue: number; maxValue: number; unit: string }) => <section className="nutrition-goal-range"><strong>{label} ({unit})</strong><div className="two-fields"><Field label="최소"><input type="number" name={minName} min="0" step="0.1" defaultValue={minValue} required /></Field><Field label="최대"><input type="number" name={maxName} min="0" step="0.1" defaultValue={maxValue} required /></Field></div></section>;
  return <Sheet title="하루 영양 목표" close={close}><form className="form-stack nutrition-goal-form" onSubmit={save}>
    <RangeFields label="칼로리" minName="caloriesMin" maxName="caloriesMax" minValue={goal.caloriesMin} maxValue={goal.caloriesMax} unit="kcal" />
    <RangeFields label="단백질" minName="proteinMin" maxName="proteinMax" minValue={goal.proteinMin} maxValue={goal.proteinMax} unit="g" />
    <RangeFields label="탄수화물" minName="carbsMin" maxName="carbsMax" minValue={goal.carbsMin} maxValue={goal.carbsMax} unit="g" />
    <RangeFields label="지방" minName="fatMin" maxName="fatMax" minValue={goal.fatMin} maxValue={goal.fatMax} unit="g" />
    <div className="two-fields"><Field label="당류 상한 (g)"><input type="number" name="sugarMax" min="0" step="0.1" defaultValue={goal.sugarMax} required /></Field><Field label="식이섬유 하한 (g)"><input type="number" name="fiberMin" min="0" step="0.1" defaultValue={goal.fiberMin} required /></Field></div>
    <button className="primary-button submit-button" type="submit">영양 목표 저장</button>
  </form></Sheet>;
}

function GoalCompletionSheet({ state, today, close, save }: { state: AppState; today: string; close: () => void; save: (choice: GoalCompletionChoice) => void }) {
  const progress = bodyGoalProgressFor(state, today);
  const report = goalReportFor(state, today);
  const [choice, setChoice] = useState<GoalCompletionChoice>({
    outcome: "유지기로 전환",
    mode: "유지기",
    goalEndDate: addDays(today, 28),
    targetBodyFatChange: 0,
    targetMuscleChange: 0,
    note: "",
  });
  const choose = (outcome: GoalCompletionChoice["outcome"]) => {
    setChoice((current) => {
      if (outcome === "유지기로 전환") return { outcome, mode: "유지기", goalEndDate: addDays(today, 28), targetBodyFatChange: 0, targetMuscleChange: 0, note: current.note };
      if (outcome === "강도를 낮춰 이어가기") return { outcome, mode: state.profile.mode, goalEndDate: addDays(today, 28), targetBodyFatChange: roundNutrient(state.profile.targetBodyFatChange / 2), targetMuscleChange: roundNutrient(state.profile.targetMuscleChange / 2), note: current.note };
      return { outcome, mode: state.profile.mode, goalEndDate: addDays(today, 56), targetBodyFatChange: state.profile.targetBodyFatChange, targetMuscleChange: state.profile.targetMuscleChange, note: current.note };
    });
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    save({ ...choice, goalEndDate: choice.goalEndDate < today ? today : choice.goalEndDate });
  };
  return <Sheet title="목표 마무리" close={close}><form className="form-stack goal-completion-form" onSubmit={submit}>
    <section className="goal-result-card"><span>{state.profile.goalStartDate?.replaceAll("-", ".")} → {today.replaceAll("-", ".")}</span><strong>{state.profile.mode} 결과</strong><div><p><small>체지방량</small><b>{progress.baseline && progress.latestRecord ? `${signed(progress.bodyFatChange)}kg` : "측정 부족"}</b><em>목표 {signed(state.profile.targetBodyFatChange)}kg</em></p><p><small>골격근량</small><b>{progress.baseline && progress.latestRecord ? `${signed(progress.muscleChange)}kg` : "측정 부족"}</b><em>목표 {signed(state.profile.targetMuscleChange)}kg</em></p></div></section>
    <GoalReportOverview report={report} compact />
    <section className="goal-next-section"><strong>이제 어떻게 이어갈까요?</strong><div className="goal-completion-options">
      {([
        ["유지기로 전환", "현재 변화를 편안하게 유지해요."],
        ["강도를 낮춰 이어가기", "같은 방향을 절반 정도의 목표로 이어가요."],
        ["새 목표 시작", "기간과 변화량을 새로 정해요."],
      ] as const).map(([outcome, detail]) => <button key={outcome} type="button" className={choice.outcome === outcome ? "active" : ""} onClick={() => choose(outcome)}><span><b>{outcome}</b><small>{detail}</small></span><i aria-hidden="true">{choice.outcome === outcome ? "✓" : ""}</i></button>)}
    </div></section>
    <section className="goal-next-fields"><div className="two-fields"><Field label="다음 관리 모드"><select value={choice.mode} onChange={(event) => setChoice((current) => ({ ...current, mode: event.target.value as GoalCompletionChoice["mode"] }))}><option>감량기</option><option>유지기</option></select></Field><Field label="다음 목표일"><input type="date" min={today} value={choice.goalEndDate} onChange={(event) => setChoice((current) => ({ ...current, goalEndDate: event.target.value }))} required /></Field></div><div className="two-fields"><Field label="체지방량 변화 (kg)"><input type="number" step="0.1" value={choice.targetBodyFatChange} onChange={(event) => setChoice((current) => ({ ...current, targetBodyFatChange: Number(event.target.value) }))} required /></Field><Field label="골격근량 변화 (kg)"><input type="number" step="0.1" value={choice.targetMuscleChange} onChange={(event) => setChoice((current) => ({ ...current, targetMuscleChange: Number(event.target.value) }))} required /></Field></div></section>
    <Field label="이번 목표 회고 (선택)"><textarea value={choice.note} onChange={(event) => setChoice((current) => ({ ...current, note: event.target.value }))} placeholder="잘된 점과 다음 목표에서 바꾸고 싶은 점을 남겨주세요." /></Field>
    <p className="goal-archive-note">지금 목표의 결과는 ‘변화’ 탭에 보관되고, 오늘부터 다음 목표가 시작돼요.</p>
    <button type="submit" className="primary-button submit-button">결과 저장하고 이어가기</button>
  </form></Sheet>;
}

function GoalReportOverview({ report, compact = false }: { report: NonNullable<GoalHistoryEntry["report"]>; compact?: boolean }) {
  const averageCopy = report.mealDays
    ? `${report.averageCalories ?? 0}kcal · 단 ${report.averageProtein ?? 0}g · 탄 ${report.averageCarbs ?? 0}g · 지 ${report.averageFat ?? 0}g`
    : "기록 없음";
  return <section className={`goal-report-overview ${compact ? "compact" : ""}`}>
    <div className="goal-report-heading"><strong>기간 요약</strong><small>기록된 날 기준</small></div>
    <div className="goal-report-grid">
      <article><span>식단</span><strong>{report.mealDays ? `${report.mealDays}일` : "기록 없음"}</strong><small>{averageCopy}</small>{report.mealDays > 0 && <em>당류 {report.averageSugar ?? 0}g · 식이섬유 {report.averageFiber ?? 0}g</em>}</article>
      <article><span>운동</span><strong>{report.completedWorkouts}회 · {report.workoutMinutes}분</strong><small>계획 {report.plannedWorkouts}회 · PT {report.ptSessions}회</small><em>개인 유산소 {report.cardioSessions}회 · {report.cardioMinutes}분</em></article>
      <article><span>월경</span><strong>{report.mainBleedingDays ? `본 출혈 ${report.mainBleedingDays}일` : "기록 없음"}</strong><small>기간 중 시작 주기 {report.cycleStarts}회</small></article>
      <article><span>기타</span><strong>{report.travelDays ? `여행 ${report.travelDays}일` : "여행 없음"}</strong><small>상담 {report.consultations}회</small></article>
    </div>
  </section>;
}

function GoalHistoryDetailSheet({ goal, close }: { goal: GoalHistoryEntry; close: () => void }) {
  return <Sheet title="지난 목표 리포트" close={close}><div className="form-stack goal-history-detail">
    <section className="goal-history-detail-heading"><span>{goal.mode} · {goal.startedAt.replaceAll("-", ".")} → {goal.completedAt.replaceAll("-", ".")}</span><strong>{goal.outcome}</strong></section>
    <section className="goal-result-card goal-history-result"><div><p><small>체지방량</small><b>{goal.bodyFatChange === undefined ? "측정 부족" : `${signed(goal.bodyFatChange)}kg`}</b><em>목표 {signed(goal.targetBodyFatChange)}kg</em></p><p><small>골격근량</small><b>{goal.muscleChange === undefined ? "측정 부족" : `${signed(goal.muscleChange)}kg`}</b><em>목표 {signed(goal.targetMuscleChange)}kg</em></p></div></section>
    {goal.report ? <GoalReportOverview report={goal.report} /> : <p className="goal-report-legacy">이 목표는 상세 리포트 기능을 넣기 전에 저장되어 결과 요약만 볼 수 있어요.</p>}
    {goal.note && <section className="goal-history-note"><strong>나의 회고</strong><p>{goal.note}</p></section>}
  </div></Sheet>;
}

function ProfileGoalSheet({ profile, latestBody, today, close, save }: { profile: AppState["profile"]; latestBody?: BodyRecord; today: string; close: () => void; save: (event: FormEvent<HTMLFormElement>) => void }) {
  const [mode, setMode] = useState<AppState["profile"]["mode"]>(profile.mode);
  const [travelActive, setTravelActive] = useState(Boolean(profile.travelActive));
  const travelLevels: NonNullable<AppState["profile"]["travelLevel"]>[] = ["가볍게 기록", "균형 유지", "목표 유지"];
  return <Sheet title="목표와 모드" close={close}><form className="form-stack profile-goal-form" onSubmit={save}>
    <section className="profile-layer-section"><strong>내 정보</strong><div className="two-fields"><Field label="생년월일 (선택)"><input type="date" name="birthDate" defaultValue={profile.birthDate ?? ""} /></Field><Field label="키 (cm)"><input type="number" name="heightCm" min="100" max="250" step="0.1" defaultValue={profile.heightCm ?? ""} /></Field></div><Field label="성별"><select name="sex" defaultValue={profile.sex ?? "여성"}><option>여성</option><option>남성</option><option>기타</option></select></Field></section>
    <section className="profile-layer-section"><strong>관리 목표</strong><div className="profile-mode-tabs">{(["감량기", "유지기"] as AppState["profile"]["mode"][]).map((item) => <label key={item} className={mode === item ? "active" : ""}><input type="radio" name="mode" value={item} checked={mode === item} onChange={() => setMode(item)} /><span>{item}</span></label>)}</div></section>
    <div className="goal-date-fields"><Field label="시작일"><input type="date" name="goalStartDate" defaultValue={profile.goalStartDate ?? today} required /></Field><Field label="종료일"><input type="date" name="goalEndDate" defaultValue={profile.goalEndDate} required /></Field></div>
    <section className="body-goal-fields"><strong>기간 동안의 변화 목표</strong>{latestBody ? <div className="goal-current-body"><span>최근 측정 · {latestBody.date}</span><div><b>체지방량 {latestBody.bodyFatMass}kg</b><b>골격근량 {latestBody.skeletalMuscle}kg</b></div></div> : <div className="goal-current-body empty"><span>최근 인바디 기록이 없어요</span></div>}<div className="two-fields"><Field label="체지방량 변화 (kg)"><input type="number" name="targetBodyFatChange" step="0.1" defaultValue={profile.targetBodyFatChange} required /></Field><Field label="골격근량 변화 (kg)"><input type="number" name="targetMuscleChange" step="0.1" defaultValue={profile.targetMuscleChange} required /></Field></div></section>
    <section className="profile-layer-section travel-layer-section"><label className="travel-toggle"><span><b>여행 모드</b><small>감량기·유지기 위에 별도로 적용해요</small></span><input type="checkbox" name="travelActive" checked={travelActive} onChange={(event) => setTravelActive(event.target.checked)} /></label>
      {travelActive && <div className="travel-layer-fields"><div className="travel-date-fields"><Field label="여행 시작일"><input type="date" name="travelStartDate" defaultValue={profile.travelStartDate ?? today} required /></Field><Field label="여행 종료일"><input type="date" name="travelEndDate" defaultValue={profile.travelEndDate ?? profile.travelStartDate ?? today} required /></Field></div><section className="travel-level-picker"><strong>여행 기본 관리 수준</strong>{travelLevels.map((level) => <label key={level}><input type="radio" name="travelLevel" value={level} defaultChecked={(profile.travelLevel ?? "균형 유지") === level} /><span><b>{level}</b><small>{level === "가볍게 기록" ? "먹은 것과 활동만 편하게 남겨요" : level === "균형 유지" ? "단백질과 식이섬유, 과식 여부를 살펴요" : "현재 감량기·유지기의 목표를 그대로 이어가요"}</small></span></label>)}</section></div>}
      {!travelActive && <input type="hidden" name="travelLevel" value={profile.travelLevel ?? "균형 유지"} />}
    </section>
    <button className="primary-button submit-button" type="submit">설정 저장</button>
  </form></Sheet>;
}

function ProfileSettingsSheet({ profile, googleName, today, close, save }: { profile: AppState["profile"]; googleName?: string; today: string; close: () => void; save: (event: FormEvent<HTMLFormElement>) => void }) {
  const age = profile.birthDate ? ageOnDate(profile.birthDate, today) : undefined;
  return <Sheet title="내 정보" close={close}><form className="form-stack profile-settings-form" onSubmit={save}>
    <section className="profile-layer-section"><strong>프로필</strong><Field label="별명"><input name="nickname" maxLength={12} defaultValue={profile.nickname ?? googleName?.split(" ")[0] ?? "소야"} placeholder="예: 소야" required /></Field></section>
    <section className="profile-layer-section"><strong>기본 정보</strong><div className="two-fields"><Field label="생년월일"><input type="date" name="birthDate" defaultValue={profile.birthDate ?? ""} /></Field><Field label="키 (cm)"><input type="number" name="heightCm" min="100" max="250" step="0.1" defaultValue={profile.heightCm ?? ""} /></Field></div><Field label="성별"><select name="sex" defaultValue={profile.sex ?? "여성"}><option>여성</option><option>남성</option><option>기타</option></select></Field>{age !== undefined && <p className="profile-age-note">현재 만 {age}세로 계산돼요.</p>}</section>
    <button className="primary-button submit-button" type="submit">내 정보 저장</button>
  </form></Sheet>;
}

function RecordAuditSheet({ state, today, close, openTarget }: { state: AppState; today: string; close: () => void; openTarget: (target: RecordAuditTarget) => void }) {
  const audit = useMemo(() => recordAuditFor(state, today), [state, today]);
  const groups: Array<{ key: keyof RecordAuditResult; label: string; shortLabel: string; empty: string }> = [
    { key: "duplicates", label: "중복 기록", shortLabel: "중복", empty: "똑같이 저장된 기록이 없어요." },
    { key: "cycles", label: "월경 주기 날짜", shortLabel: "월경 날짜", empty: "겹치거나 읽을 수 없는 주기 날짜가 없어요." },
    { key: "bodyChanges", label: "체성분 큰 변화", shortLabel: "체성분", empty: "7일 이내 확인이 필요한 큰 변화가 없어요." },
    { key: "missingActuals", label: "계획 후 실제 기록", shortLabel: "기록 누락", empty: "지난 계획에 대응하는 실제 기록이 모두 있어요." },
  ];
  const total = groups.reduce((sum, group) => sum + audit[group.key].length, 0);
  return <Sheet title="기록 점검" close={close}><div className="record-audit-stack">
    <section className={`record-audit-hero${total ? " has-issues" : " all-clear"}`}>
      <span>{total ? "확인할 기록" : "점검 완료"}</span>
      <strong>{total ? `${total}개를 살펴봐주세요` : "지금은 이상이 없어요"}</strong>
      <p>{total ? "자동 점검 결과예요. 실제 기록이 맞다면 그대로 두어도 괜찮아요." : "중복·날짜·급격한 변화·계획 누락을 모두 확인했어요."}</p>
    </section>

    <section className="record-audit-summary" aria-label="점검 결과 요약">
      {groups.map((group) => <button type="button" key={group.key} onClick={() => document.getElementById(`audit-${group.key}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}>
        <span>{group.shortLabel}</span><strong>{audit[group.key].length}</strong>
      </button>)}
    </section>

    <div className="record-audit-groups">
      {groups.map((group) => {
        const issues = audit[group.key];
        return <section className="record-audit-group" id={`audit-${group.key}`} key={group.key}>
          <header><strong>{group.label}</strong><span className={issues.length ? "has-count" : ""}>{issues.length}</span></header>
          {issues.length ? <div className="record-audit-list">{issues.map((issue) => <article key={issue.id}>
            <div><strong>{issue.title}</strong><p>{issue.detail}</p></div>
            {issue.target && <button type="button" onClick={() => openTarget(issue.target!)}>{issue.action ?? "확인"}<b aria-hidden="true">›</b></button>}
          </article>)}</div> : <p className="record-audit-empty"><span aria-hidden="true">✓</span>{group.empty}</p>}
        </section>;
      })}
    </div>
    <p className="record-audit-footnote">체성분 변화는 7일 안에 체중 2.5kg, 체지방량 2kg, 골격근량 1.2kg, 체지방률 3%p 또는 내장지방레벨 3 이상 변한 경우만 표시해요.</p>
  </div></Sheet>;
}

function AccountSheet({ nickname, auditCount, close, openProfile, openAudit, openData, logout }: { nickname: string; auditCount: number; close: () => void; openProfile: () => void; openAudit: () => void; openData: () => void; logout: () => void | Promise<void> }) {
  return <Sheet title={`${nickname}님`} close={close}><div className="account-sheet-actions">
    <button type="button" onClick={openProfile}><span>내 정보 수정</span><b aria-hidden="true">›</b></button>
    <button type="button" onClick={openAudit}><span className="account-audit-label"><span>기록 점검</span>{auditCount > 0 && <em>{auditCount > 99 ? "99+" : auditCount}개 확인 필요</em>}</span><b aria-hidden="true">›</b></button>
    <button type="button" onClick={openData}><span>데이터 관리</span><b aria-hidden="true">›</b></button>
    <button type="button" className="logout" onClick={() => { if (window.confirm("로그아웃 하시겠습니까?")) void logout(); }}><span>로그아웃</span><b aria-hidden="true">›</b></button>
  </div></Sheet>;
}

function ActivitySheet({ today, draft, openAppleHealth, close, save, remove }: { today: string; draft?: DailyActivity; openAppleHealth: () => void; close: () => void; save: (event: FormEvent<HTMLFormElement>) => void; remove: (entry: DailyActivity) => void }) {
  return <Sheet title={draft ? "하루 활동 수정" : "하루 활동 기록"} titleAction={<button type="button" className="sheet-title-action" onClick={openAppleHealth}>Apple 건강 연결</button>} close={close}><form className="form-stack" onSubmit={save}>
    {draft?.source === "apple_health" && <div className="health-import-badge">Apple 건강에서 가져온 기록 · 수정하면 직접 기록으로 전환돼요</div>}
    <input type="hidden" name="editingId" value={draft?.id ?? ""} />
    <div className="two-fields sheet-leading-fields"><Field label="날짜"><input type="date" name="date" defaultValue={draft?.date ?? today} required /></Field><Field label="애플워치"><select name="watchWorn" defaultValue={String(draft?.watchWorn ?? true)}><option value="true">착용함</option><option value="false">착용하지 않음</option></select></Field></div>
    <div className="two-fields"><Field label="걸음 수 (걸음)"><input type="number" name="steps" min="0" step="1" defaultValue={draft?.steps ?? ""} placeholder="예: 8500" required /></Field><Field label="활동에너지 (kcal, 선택)"><input type="number" name="activeCalories" min="0" step="1" defaultValue={draft?.activeCalories ?? ""} placeholder="예: 420" /></Field></div>
    <div className="activity-priority-note"><strong>중복 없이 계산해요</strong><span>활동에너지를 입력하면 그 값을 우선 사용하고, 걸음과 운동 칼로리를 더하지 않아요.</span></div>
    <Field label="메모 (선택)"><textarea className="activity-note-input" name="note" defaultValue={draft?.note ?? ""} placeholder="워치를 빼고 있던 시간처럼 필요한 내용만 적어주세요." /></Field>
    <button className="primary-button submit-button" type="submit">{draft ? "수정 저장" : "활동 기록 저장"}</button>
    {draft && <button className="delete-button full-delete-button" type="button" onClick={() => remove(draft)}>활동 기록 삭제</button>}
  </form></Sheet>;
}

function AppleHealthSheet({ close, refresh, syncNow, syncing }: { close: () => void; refresh: () => Promise<void>; syncNow: (range?: AppleHealthSyncRange) => void; syncing: boolean }) {
  const [status, setStatus] = useState<AppleHealthConnectionStatus>();
  const [credentials, setCredentials] = useState<AppleHealthConnectionKey>();
  const [working, setWorking] = useState(true);
  const [message, setMessage] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyStart, setHistoryStart] = useState(addDays(todayKey(), -365));
  const [historyEnd, setHistoryEnd] = useState(todayKey());

  useEffect(() => {
    let active = true;
    void getAppleHealthConnectionStatus()
      .then((next) => { if (active) setStatus(next); })
      .catch(() => { if (active) setMessage("연결 상태를 확인하지 못했어요."); })
      .finally(() => { if (active) setWorking(false); });
    return () => { active = false; };
  }, []);

  const createKey = async () => {
    if (status?.connected && !window.confirm("새 연결 키를 만들면 이전 키는 더 이상 사용할 수 없어요. 계속할까요?")) return;
    setWorking(true);
    setMessage("");
    try {
      const next = await createAppleHealthConnectionKey();
      setCredentials(next);
      setStatus({ connected: true, createdAt: next.createdAt });
      setMessage("새 연결 키를 만들었어요. 이 화면을 닫기 전에 단축어에 넣어주세요.");
    } catch {
      setMessage("연결 키를 만들지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setWorking(false);
    }
  };

  const revoke = async () => {
    if (!window.confirm("Apple 건강 연결을 해제할까요? 이미 가져온 기록은 그대로 남아요.")) return;
    setWorking(true);
    setMessage("");
    try {
      await revokeAppleHealthConnection();
      setStatus({ connected: false });
      setCredentials(undefined);
      setMessage("연결을 해제했어요.");
    } catch {
      setMessage("연결을 해제하지 못했어요.");
    } finally {
      setWorking(false);
    }
  };

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`${label}을 복사했어요.`);
    } catch {
      setMessage("복사하지 못했어요. 값을 길게 눌러 복사해주세요.");
    }
  };

  const reload = async () => {
    setWorking(true);
    setMessage("");
    try {
      await refresh();
      const next = await getAppleHealthConnectionStatus();
      setStatus(next);
      setMessage("Apple 건강에서 들어온 최신 기록을 확인했어요.");
    } catch {
      setMessage("최신 기록을 확인하지 못했어요.");
    } finally {
      setWorking(false);
    }
  };

  const formatSyncTime = (value?: string) => value
    ? new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value))
    : "아직 가져온 기록이 없어요";
  const lastSuccess = formatSyncTime(status?.lastSuccessAt ?? status?.lastImportAt);
  const lastAttempt = status?.lastAttemptAt ? formatSyncTime(status.lastAttemptAt) : "아직 시도한 기록이 없어요";
  const resultText = status?.lastResult?.duplicate
    ? "같은 기록이라 중복 저장하지 않았어요"
    : status?.lastResult
      ? `활동 ${status.lastResult.importedActivities}건 · 운동 ${status.lastResult.importedWorkouts}건 반영${status.lastResult.protectedManualRecords ? ` · 직접 기록 ${status.lastResult.protectedManualRecords}건 유지` : ""}`
      : "동기화 결과가 아직 없어요";

  if (historyOpen) {
    const selectedDays = historyStart && historyEnd && historyStart <= historyEnd ? daysBetween(historyStart, historyEnd) + 1 : 0;
    const historyValid = selectedDays > 0 && historyEnd <= todayKey();
    return <Sheet title="Apple 건강 과거 기록" close={() => setHistoryOpen(false)}>
      <form className="form-stack health-history-form" onSubmit={(event) => {
        event.preventDefault();
        if (!historyValid) return;
        syncNow({ startDate: historyStart, endDate: historyEnd });
      }}>
        <section className="health-history-intro"><strong>가져올 기간을 골라주세요</strong><p>SOYA가 선택한 기간을 단축어에 전달해요. 직접 입력한 하루 활동은 덮어쓰지 않고, 같은 Apple 건강 기록은 한 번만 저장해요.</p></section>
        <div className="health-history-dates"><Field label="시작일"><input type="date" value={historyStart} max={historyEnd || todayKey()} onChange={(event) => setHistoryStart(event.target.value)} required /></Field><Field label="종료일"><input type="date" value={historyEnd} min={historyStart} max={todayKey()} onChange={(event) => setHistoryEnd(event.target.value)} required /></Field></div>
        <div className="health-history-presets"><button type="button" onClick={() => setHistoryStart(addDays(todayKey(), -89))}>최근 3개월</button><button type="button" onClick={() => setHistoryStart(addDays(todayKey(), -364))}>최근 1년</button><button type="button" onClick={() => setHistoryStart("2014-01-01")}>가능한 전체</button></div>
        <div className="health-history-summary"><span>선택한 기간</span><strong>{historyValid ? `${selectedDays.toLocaleString("ko-KR")}일` : "날짜 확인 필요"}</strong><small>과거용 단축어 설정에서는 최대 31일씩 나누어 SOYA로 보내요.</small></div>
        <details className="health-history-shortcut-note"><summary>단축어에서 한 번 준비할 내용</summary><p>‘단축어 입력’을 사전으로 읽고 <b>mode가 history</b>이면 startDate부터 endDate까지 건강 데이터를 날짜별로 모아주세요. 한 번에 최대 31일씩 <b>days</b> 배열로 기존 받는 주소에 보내면 돼요.</p><pre>{`mode: history\nstartDate: yyyy-MM-dd\nendDate: yyyy-MM-dd\nbatchDays: 31`}</pre></details>
        {!status?.connected && <p className="health-history-warning">먼저 Apple 건강 연결 키를 만들어주세요.</p>}
        <button className="primary-button submit-button" type="submit" disabled={!historyValid || !status?.connected || syncing}>{syncing ? "가져오는 중" : "과거 기록 가져오기"}</button>
      </form>
    </Sheet>;
  }

  return <Sheet title="Apple 건강 연결" titleAction={<button type="button" className="sheet-title-action" onClick={() => setHistoryOpen(true)}>과거 기록 가져오기</button>} close={close}>
    <div className="health-connection-stack">
      <section className="health-connection-status">
        <div><span className={`health-status-dot ${status?.connected ? "connected" : ""}`} /><div><strong>{working && !status ? "연결 확인 중" : status?.connected ? "연결됨" : "연결되지 않음"}</strong><small>{status?.connected ? `마지막 동기화 · ${lastSuccess}` : "아이폰 단축어를 통해 안전하게 가져와요"}</small></div></div>
        <button type="button" disabled={working} onClick={() => void createKey()}>{status?.connected ? "연결 키 다시 만들기" : "연결 시작"}</button>
      </section>

      {status?.connected && <section className="health-sync-history">
        <strong>최근 동기화 상태</strong>
        <dl><div><dt>마지막 성공</dt><dd>{lastSuccess}</dd></div><div><dt>마지막 시도</dt><dd>{lastAttempt}</dd></div><div><dt>처리 결과</dt><dd>{status.lastSyncState === "processing" ? "건강 데이터를 받는 중이에요" : resultText}</dd></div></dl>
        {status.lastFailureReason && <div className="health-sync-failure" role="alert"><b>실패 이유</b><span>{status.lastFailureReason}</span>{status.lastFailureAt && <small>{formatSyncTime(status.lastFailureAt)}</small>}</div>}
      </section>}

      <section className="health-data-list"><strong>가져올 수 있는 기록</strong><div><span>걸음 수</span><span>활동 에너지</span><span>Apple Watch 운동</span><span>평균 심박수</span></div></section>

      {credentials && <section className="health-key-panel">
        <strong>단축어 연결 정보</strong>
        <p>연결 키는 지금만 보여요. 다른 사람에게 보내지 마세요.</p>
        <div className="health-key-field"><span>받는 주소</span><div><code>{credentials.endpoint}</code><button type="button" onClick={() => void copy(credentials.endpoint, "받는 주소")}>복사</button></div></div>
        <div className="health-key-field"><span>연결 키</span><div><code>{credentials.token}</code><button type="button" onClick={() => void copy(credentials.token, "연결 키")}>복사</button></div></div>
      </section>}

      <section className="health-shortcut-guide">
        <strong>아이폰 단축어에서 한 번만 설정해요</strong>
        <ol><li>건강 앱에서 오늘의 걸음 수와 활동 에너지를 가져와요.</li><li>현재 날짜를 <b>yyyy-MM-dd</b> 형식으로 만들어요.</li><li>‘URL 콘텐츠 가져오기’에서 POST·JSON을 선택하고 위 주소와 연결 키를 넣어요.</li><li>앱의 ‘지금 동기화’ 버튼이나 개인용 자동화로 실행해요.</li></ol>
        <details><summary>매일 정해진 시간에 자동 동기화하기</summary><ol><li>아이폰의 <b>단축어 → 자동화 → + → 개인용 자동화</b>로 들어가요.</li><li><b>시간대</b>에서 원하는 시각과 <b>매일</b>을 선택해요.</li><li><b>단축어 실행</b>에서 ‘SOYA 건강 보내기’를 선택해요.</li><li><b>즉시 실행</b>을 켜고 실행 알림은 원하는 대로 정해요.</li></ol></details>
        <details><summary>보낼 항목 이름 보기</summary><pre>{`date\nsteps\nactiveCalories\nwatchWorn\nworkouts (선택)`}</pre></details>
      </section>

      {message && <p className="health-connection-message" role="status">{message}</p>}
      <div className="health-connection-actions"><button type="button" className="primary-button health-sync-now-button" disabled={working || syncing || !status?.connected} onClick={() => syncNow()}>{syncing ? "동기화 중" : "지금 동기화"}</button><button type="button" className="ghost-button" disabled={working} onClick={() => void reload()}>상태 새로고침</button>{status?.connected && <button type="button" className="delete-button" disabled={working} onClick={() => void revoke()}>연결 해제</button>}</div>
    </div>
  </Sheet>;
}

function WorkoutSheet({ today, kind, draft, presetType, close, save }: { today: string; kind: EntryKind; draft?: WorkoutEntry; presetType?: WorkoutEntry["type"]; close: () => void; save: (event: FormEvent<HTMLFormElement>, kind: EntryKind) => void }) {
  const editing = Boolean(draft?.id) && draft?.kind === kind;
  const initialType = draft?.type ?? presetType ?? "유산소";
  const [workoutType, setWorkoutType] = useState<WorkoutEntry["type"]>(initialType);
  const previousHeartRate = draft?.heartRate ?? (typeof draft?.intensity === "string" && draft.intensity.includes("심박수") ? draft.intensity.replace("심박수", "").trim() : "");
  const previousIntensity = typeof draft?.intensity === "number" ? draft.intensity : 5;
  return <Sheet title={kind === "plan" ? "운동 계획" : editing ? "운동 기록 수정" : "한 운동 기록"} close={close}><form className="form-stack" onSubmit={(event) => save(event, kind)}><input type="hidden" name="editingId" value={editing ? draft.id : ""} /><div className="two-fields sheet-leading-fields"><Field label="날짜"><input type="date" name="date" defaultValue={draft?.date ?? today} required /></Field><Field label="운동 종류"><select name="type" value={workoutType} onChange={(event) => setWorkoutType(event.target.value as WorkoutEntry["type"])}><option>PT</option><option>유산소</option></select></Field></div>{kind === "plan" && <Field label="시작 시간 (선택)"><input type="time" name="startTime" defaultValue={draft?.startTime ?? ""} /></Field>}<Field label="운동 이름"><input name="title" defaultValue={draft?.title ?? ""} placeholder={workoutType === "PT" ? "예: 필라테스 + 기능운동" : "예: 인클라인 트레드밀"} required /></Field>{workoutType === "유산소" && <div className="check-field step-overlap-check"><input id="overlapsSteps" type="checkbox" name="overlapsSteps" defaultChecked={draft?.overlapsSteps} /><label htmlFor="overlapsSteps"><strong>일상 걸음 수와 중복되는 운동은 체크해주세요.</strong></label></div>}<div className="two-fields"><Field label="시간 (분)"><input type="number" name="minutes" defaultValue={draft?.minutes ?? ""} min="1" placeholder="예: 35" required /></Field><Field label="체감 강도 (1~10)"><select name="intensity" defaultValue={previousIntensity}>{[1,2,3,4,5,6,7,8,9,10].map((value) => <option value={value} key={value}>{value}</option>)}</select></Field></div><div className="rpe-scale"><span>1–2 아주 가벼움</span><span>3–4 가벼움</span><span>5–6 보통</span><span>7–8 힘듦</span><span>9–10 매우 힘듦</span></div><Field label="평균 심박수 (bpm, 선택)"><input name="heartRate" defaultValue={previousHeartRate} placeholder="예: 130~140" /></Field><Field label="운동 내용"><textarea name="details" defaultValue={draft?.details ?? ""} placeholder="종목, 중량, 횟수, 세트 또는 컨디션을 적어주세요." /></Field><button className="primary-button submit-button" type="submit">{kind === "plan" ? "운동 계획 저장" : editing ? "수정 저장" : "운동 기록 저장"}</button></form></Sheet>;
}

function BodyDetailSheet({ record, close, edit, remove }: { record: BodyRecord; close: () => void; edit: () => void; remove: () => void }) {
  const measurementTiming = record.measurementTiming ?? record.condition.split(" · ")[0];
  const device = record.device ?? record.condition.split(" · ")[1];
  const metrics = [
    ["체중", record.weight, "kg"], ["골격근량", record.skeletalMuscle, "kg"],
    ["체지방량", record.bodyFatMass, "kg"], ["체지방률", record.bodyFatRate, "%"],
    ["내장지방", record.visceralFat, "Lv"],
  ];
  return <Sheet title="인바디 상세" close={close}><div className="detail-date"><strong>{record.date}</strong><span>{record.time}</span></div><div className="body-detail-grid">{metrics.map(([label, value, unit]) => <article key={String(label)}><span>{label}</span><strong>{value}<small>{unit}</small></strong></article>)}</div><dl className="detail-meta"><div><dt>측정 시점</dt><dd>{measurementTiming}</dd></div><div><dt>측정 기기</dt><dd>{device}</dd></div></dl><div className="detail-actions"><button type="button" className="delete-button" onClick={remove}>기록 삭제</button><button type="button" className="primary-button" onClick={edit}>수정하기</button></div></Sheet>;
}

function ConsultationDetailSheet({ consultation, close, remove }: { consultation: Consultation; close: () => void; remove: () => void }) {
  return <Sheet title="상담 다시보기" close={close}><div className="detail-date"><strong>{consultation.date}</strong></div><span className={`source-badge ${consultation.source}`}>{consultation.source === "openai" ? "ChatGPT 상담" : "AI 연결 전 미리보기"}</span>{consultation.flowStage ? <div className="consultation-detail-flow"><section><strong>1. 이번 주 요약</strong><div className="consultation-text consultation-popup-text">{consultation.summaryText ?? consultation.text}</div></section>{consultation.userResponse && <section><strong>2. 나의 답변</strong><p>{consultation.userResponse}</p></section>}{consultation.planText && <section><strong>3. 다음 주 제안</strong><div className="consultation-text consultation-popup-text">{consultation.planText}</div></section>}</div> : <div className="consultation-text consultation-popup-text">{consultation.text}</div>}<button type="button" className="delete-button full-delete-button" onClick={remove}>상담 삭제</button></Sheet>;
}

type LoveFormDraft = { date: string; count: string; contraception: LoveRecord["contraception"]; note: string };

function LoveSheet({ today, anchorDate, existing, close, save, remove }: { today: string; anchorDate: string; existing: LoveRecord[]; close: () => void; save: (drafts: Array<{ date: string; count: number; contraception: LoveRecord["contraception"]; note?: string }>) => void; remove: (entry: LoveRecord) => void }) {
  const [selectedMonth, setSelectedMonth] = useState(anchorDate.slice(0, 7));
  const [drafts, setDrafts] = useState<LoveFormDraft[]>([]);
  const cells = monthCells(`${selectedMonth}-01`);
  const selectedDates = new Set(drafts.map((draft) => draft.date));
  const selectDate = (date: string) => setDrafts((current) => {
    if (current.some((draft) => draft.date === date)) return current.filter((draft) => draft.date !== date);
    const saved = existing.find((entry) => entry.date === date);
    return [...current, { date, count: saved ? String(saved.count) : "1", contraception: saved?.contraception ?? "피임함", note: saved?.note ?? "" }].sort((a, b) => a.date.localeCompare(b.date));
  });
  const updateDraft = (date: string, patch: Partial<LoveFormDraft>) => setDrafts((current) => current.map((draft) => draft.date === date ? { ...draft, ...patch } : draft));
  const valid = drafts.length > 0 && drafts.every((draft) => Number(draft.count) >= 1);
  return <Sheet title="사랑 기록" close={close}><form className="form-stack love-record-form" onSubmit={(event) => { event.preventDefault(); if (!valid) return; save(drafts.map((draft) => ({ date: draft.date, count: Number(draft.count), contraception: draft.contraception, note: draft.note }))); }}>
    <section className="love-date-picker"><MonthNavigator value={selectedMonth} onChange={setSelectedMonth} onToday={() => setSelectedMonth(today.slice(0, 7))} /><div className="calendar-weekdays">{["일", "월", "화", "수", "목", "금", "토"].map((day) => <span key={day}>{day}</span>)}</div><div className="month-grid">{cells.map((date, index) => { if (!date) return <span className="calendar-blank" key={`blank-${index}`} />; const saved = existing.find((entry) => entry.date === date); const heart = saved?.contraception === "피임하지 않음" ? "heart-filled" : "heart-outline"; return <button type="button" key={date} className={`love-date-cell ${selectedDates.has(date) ? "selected" : ""} ${saved ? "recorded" : ""}`} onClick={() => selectDate(date)} aria-pressed={selectedDates.has(date)}><b>{Number(date.slice(-2))}</b>{saved && <span className={`pixel-love-heart ${heart}`} aria-hidden="true" />}</button>; })}</div></section>
    {drafts.length ? <div className="love-draft-list">{drafts.map((draft) => { const saved = existing.find((entry) => entry.date === draft.date); return <section className="love-draft-card" key={draft.date}><div className="love-draft-heading"><strong>{dateLabel(draft.date)}</strong><button type="button" onClick={() => setDrafts((current) => current.filter((item) => item.date !== draft.date))} aria-label={`${draft.date} 입력 상자 닫기`}>×</button></div><div className="two-fields"><Field label="횟수 (회)"><input type="number" inputMode="numeric" min="1" max="20" value={draft.count} onChange={(event) => updateDraft(draft.date, { count: event.target.value })} placeholder="1" required /></Field><Field label="피임 여부"><select value={draft.contraception} onChange={(event) => updateDraft(draft.date, { contraception: event.target.value as LoveRecord["contraception"] })}><option>피임함</option><option>피임하지 않음</option></select></Field></div><Field label="메모 (선택)"><textarea className="cycle-note-input" value={draft.note} onChange={(event) => updateDraft(draft.date, { note: event.target.value })} placeholder="필요한 내용만 남겨주세요." /></Field>{saved && <button className="delete-text-button love-delete-existing" type="button" onClick={() => { remove(saved); setDrafts((current) => current.filter((item) => item.date !== draft.date)); }}>저장된 기록 삭제</button>}</section>; })}</div> : <p className="love-empty-guide">캘린더에서 기록할 날짜를 선택해주세요.</p>}
    <button className="primary-button submit-button" type="submit" disabled={!valid}>{drafts.length ? `${drafts.length}개 날짜 저장` : "날짜를 선택해주세요"}</button>
  </form></Sheet>;
}

function CycleSheet({ today, draft, previous, existing, initialRange, openLove, close, save, saveRanges, remove }: { today: string; draft?: CycleEntry; previous?: CycleEntry; existing: CycleEntry[]; initialRange?: CycleRange; openLove: () => void; close: () => void; save: (event: FormEvent<HTMLFormElement>) => void; saveRanges: (ranges: CycleRange[], editingRange?: CycleRange) => void; remove: (entry: CycleEntry) => void }) {
  const [mode, setMode] = useState<"day" | "range">(initialRange ? "range" : "day");
  const symptoms = ["졸림", "피로"];
  return <Sheet title="월경·컨디션 기록" titleAction={<button type="button" className="sheet-title-action love-title-action" onClick={openLove}>♥ 기록</button>} close={close}>
    <div className="cycle-record-tabs" role="tablist" aria-label="월경 기록 방식"><button type="button" className={mode === "day" ? "active" : ""} onClick={() => setMode("day")}>하루 기록</button><button type="button" className={mode === "range" ? "active" : ""} onClick={() => setMode("range")}>기간 기록</button></div>
    {mode === "day" ? <form className="form-stack" onSubmit={save}>
      <input type="hidden" name="editingId" value={draft?.id ?? ""} />
      <input type="hidden" name="periodId" value={draft?.periodId ?? ""} />
      <Field label="날짜"><input type="date" name="date" defaultValue={draft?.date ?? today} required /></Field>
      <Field label="오늘 출혈 상태"><select name="state" defaultValue={draft?.state ?? previous?.state ?? "없음"}><option>없음</option><option>갈색 출혈</option><option>본 출혈</option><option>부정출혈</option></select></Field>
      <div className="two-fields"><Field label="월경량"><select name="flow" defaultValue={draft?.flow ?? previous?.flow ?? "없음"}><option>없음</option><option>소량</option><option>보통</option><option>많음</option></select></Field><Field label="월경통"><select name="pain" defaultValue={draft?.pain ?? "없음"}><option>없음</option><option>약함</option><option>보통</option><option>심함</option></select></Field></div>
      <div className="two-fields"><Field label="에너지"><select name="energy" defaultValue={draft?.energy ?? 3}>{conditionLabels.map((label, index) => <option value={index + 1} key={label}>{label}</option>)}</select></Field><Field label="식욕"><select name="appetite" defaultValue={draft?.appetite ?? 3}>{conditionLabels.map((label, index) => <option value={index + 1} key={label}>{label}</option>)}</select></Field></div>
      <fieldset className="cycle-check-group"><legend>오늘 느낀 증상</legend><div>{symptoms.map((symptom) => <label key={symptom}><input type="checkbox" name="symptoms" value={symptom} defaultChecked={draft?.symptoms?.includes(symptom)} /><span>{symptom}</span></label>)}</div></fieldset>
      <Field label="메모 (선택)"><textarea className="cycle-note-input" name="note" defaultValue={draft?.note ?? ""} placeholder="평소와 다른 점이 있다면 적어주세요." /></Field>
      <button className="primary-button submit-button" type="submit">{draft ? "수정 저장" : "기록 저장"}</button>
      {draft && <button className="delete-button full-delete-button" type="button" onClick={() => remove(draft)}>기록 삭제</button>}
    </form> : <CyclePeriodRecorder today={today} existing={existing} initialRange={initialRange} save={saveRanges} />}
  </Sheet>;
}

function CyclePeriodRecorder({ today, existing, initialRange, save }: { today: string; existing: CycleEntry[]; initialRange?: CycleRange; save: (ranges: CycleRange[], editingRange?: CycleRange) => void }) {
  const [selectedMonth, setSelectedMonth] = useState((initialRange?.start ?? today).slice(0, 7));
  const [rangeStart, setRangeStart] = useState<string>();
  const [ranges, setRanges] = useState<CycleRange[]>(initialRange ? [initialRange] : []);
  const [editingRangeId, setEditingRangeId] = useState<string | undefined>(initialRange?.id);
  const [paintState, setPaintState] = useState<BleedingState>("본 출혈");
  const cells = monthCells(`${selectedMonth}-01`);
  const existingDates = useMemo(() => new Set(existing.filter((entry) => entry.source !== "period-fill").map((entry) => entry.date)), [existing]);
  const chosenDates = useMemo(() => new Set(ranges.flatMap((range) => cycleRangeDates(range.start, range.end))), [ranges]);
  const allDates = [...chosenDates];
  const skippedCount = initialRange ? 0 : allDates.filter((date) => existingDates.has(date)).length;
  const saveCount = initialRange ? allDates.length : allDates.length - skippedCount;

  const chooseDate = (date: string) => {
    if (!rangeStart || date < rangeStart) {
      setRangeStart(date);
      return;
    }
    setRanges((current) => [...current, { id: id("cycle-range"), start: rangeStart, end: date }]);
    setRangeStart(undefined);
  };

  const paintDate = (rangeId: string, date: string) => {
    setRanges((current) => current.map((range) => range.id === rangeId
      ? { ...range, states: { ...(range.states ?? {}), [date]: paintState } }
      : range));
  };

  const resetRange = (rangeId: string) => {
    setRanges((current) => current.map((range) => range.id === rangeId ? { ...range, states: {} } : range));
  };

  return <div className="cycle-period-recorder">
    <div className="cycle-period-prompt"><strong>{rangeStart ? "마지막 날짜를 선택해주세요" : "시작 날짜를 선택해주세요"}</strong>{rangeStart && <span>{dateLabel(rangeStart)}부터</span>}</div>
    <div className="cycle-period-calendar"><MonthNavigator value={selectedMonth} onChange={setSelectedMonth} onToday={() => setSelectedMonth(today.slice(0, 7))} /><div className="calendar-weekdays">{["일", "월", "화", "수", "목", "금", "토"].map((day) => <span key={day}>{day}</span>)}</div><div className="month-grid">{cells.map((date, index) => {
      if (!date) return <span className="calendar-blank" key={`blank-${index}`} />;
      const existingEntry = existing.find((entry) => entry.date === date);
      const chosenRange = ranges.find((range) => date >= range.start && date <= range.end);
      const shownState = chosenRange ? chosenRange.states?.[date] ?? "본 출혈" : existingEntry?.state;
      const stateClass = shownState === "갈색 출혈" ? "brown-bleeding" : shownState === "본 출혈" ? "main-bleeding" : shownState === "부정출혈" ? "irregular-bleeding" : "";
      return <button type="button" key={date} onClick={() => { if (!initialRange) chooseDate(date); }} className={`calendar-day menstrual-day ${stateClass} ${chosenDates.has(date) ? "range-selected" : ""} ${date === rangeStart ? "range-start" : ""} ${date === today ? "today" : ""}`}><b>{Number(date.slice(-2))}</b></button>;
    })}</div></div>
    {(rangeStart || ranges.length > 0) && <div className="cycle-period-list">{ranges.map((range) => <section className="cycle-period-item" key={range.id}><div className="cycle-period-row"><span><b>{range.start.replaceAll("-", ".")}</b> ~ <b>{range.end.replaceAll("-", ".")}</b><small>{daysBetween(range.start, range.end) + 1}일</small></span><div><button type="button" onClick={() => setEditingRangeId((current) => current === range.id ? undefined : range.id)}>{editingRangeId === range.id ? "구분 닫기" : "출혈 구분"}</button>{!initialRange && <button type="button" onClick={() => setRanges((current) => current.filter((item) => item.id !== range.id))}>삭제</button>}</div></div>{editingRangeId === range.id && <div className="cycle-bleeding-editor"><div className="bleeding-paint-tools" role="radiogroup" aria-label="선택할 출혈 종류">{(["갈색 출혈", "본 출혈", "부정출혈"] as BleedingState[]).map((state) => <button type="button" role="radio" aria-checked={paintState === state} className={`${state === "갈색 출혈" ? "brown" : state === "본 출혈" ? "main" : "irregular"} ${paintState === state ? "active" : ""}`} key={state} onClick={() => setPaintState(state)}>{state}</button>)}</div><p>출혈 종류를 고른 뒤 날짜를 눌러주세요.</p><div className="bleeding-date-grid">{cycleRangeDates(range.start, range.end).map((date) => { const state = range.states?.[date] ?? "본 출혈"; return <button type="button" className={state === "갈색 출혈" ? "brown" : state === "본 출혈" ? "main" : "irregular"} key={date} onClick={() => paintDate(range.id, date)}><span>{Number(date.slice(5, 7))}/{Number(date.slice(-2))}</span><small>{state.replace(" 출혈", "")}</small></button>; })}</div><button type="button" className="reset-bleeding-button" onClick={() => resetRange(range.id)}>모두 본 출혈로</button></div>}</section>)}{rangeStart && <div className="pending"><span><b>{rangeStart.replaceAll("-", ".")}</b><small>마지막 날짜 선택 전</small></span><button type="button" onClick={() => setRangeStart(undefined)}>취소</button></div>}</div>}
    <p className="cycle-period-skip">첫 주기부터 마지막 주기 사이의 빈 날짜는 출혈 없음으로 저장됩니다. 기존 기록은 그대로 유지됩니다.</p>
    {skippedCount > 0 && <p className="cycle-period-skip">기존 기록 {skippedCount}일은 그대로 두고 건너뜁니다.</p>}
    <button type="button" className="primary-button submit-button" onClick={() => save(ranges, initialRange)} disabled={!saveCount || Boolean(rangeStart)}>{rangeStart ? "마지막 날짜를 선택해주세요" : initialRange ? "주기 출혈 구분 저장" : saveCount ? `${ranges.length}주기 · ${saveCount}일 저장` : "저장할 기간 없음"}</button>
  </div>;
}
