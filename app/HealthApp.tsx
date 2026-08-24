"use client";

import Image from "next/image";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  AppState,
  BodyRecord,
  CycleEntry,
  EntryKind,
  initialState,
  mealLabels,
  MealEntry,
  MealType,
  WorkoutEntry,
} from "./data";

type Tab = "today" | "food" | "workout" | "change" | "consult";
type Modal = null | "quick" | "body" | "body-detail" | "meal-plan" | "meal-actual" | "workout-plan" | "workout-actual" | "workout-goal" | "cycle" | "consultation-detail";
type Consultation = AppState["consultations"][number];
type NextAction =
  | { type: "body"; eyebrow: string; title: string; detail: string }
  | { type: "workout"; eyebrow: string; title: string; detail: string }
  | { type: "meal"; mealType: MealType; eyebrow: string; title: string; detail: string }
  | { type: "done"; eyebrow: string; title: string; detail: string };

const tabs: { id: Tab; label: string }[] = [
  { id: "food", label: "식단" },
  { id: "workout", label: "운동" },
  { id: "today", label: "홈" },
  { id: "change", label: "변화" },
  { id: "consult", label: "상담" },
];

const navIcons: Record<Tab, string> = {
  food: "/nav-food-v3-small.png",
  workout: "/nav-workout-v3-small.png",
  today: "/nav-home-v3-small.png",
  change: "/nav-change-v3-small.png",
  consult: "/nav-consult-v3-small.png",
};

const confidenceFromSource = (source: string): MealEntry["confidence"] => ({
  product: "높음",
  recipe: "보통",
  database: "추정",
  manual: "추정",
  restaurant: "낮음",
  photo: "낮음",
})[source] as MealEntry["confidence"] ?? "추정";

const todayKey = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
};

const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const number = (value: FormDataEntryValue | null) => Number(value || 0);
const dateLabel = (value: string) => new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "long" }).format(new Date(`${value}T12:00:00`));
const monthLabel = (value: string) => new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long" }).format(new Date(`${value.slice(0, 7)}-01T12:00:00`));
const signed = (value: number) => `${value > 0 ? "+" : ""}${value.toFixed(1)}`;

function monthCells(anchor: string) {
  const [year, month] = anchor.split("-").map(Number);
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const days = new Date(year, month, 0).getDate();
  return [...Array(firstWeekday).fill(null), ...Array.from({ length: days }, (_, index) => `${year}-${String(month).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`)] as (string | null)[];
}

function monthOptions(anchor: string, count = 36) {
  const date = new Date(`${anchor.slice(0, 7)}-01T12:00:00`);
  return Array.from({ length: count }, (_, index) => {
    const value = new Date(date.getFullYear(), date.getMonth() - index, 1);
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
  });
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

export function HealthApp() {
  const [state, setState] = useState<AppState>(initialState);
  const [tab, setTab] = useState<Tab>("today");
  const [modal, setModal] = useState<Modal>(null);
  const [mealPresetType, setMealPresetType] = useState<MealType>();
  const [workoutDraft, setWorkoutDraft] = useState<WorkoutEntry>();
  const [workoutPresetType, setWorkoutPresetType] = useState<WorkoutEntry["type"]>();
  const [selectedBodyRecord, setSelectedBodyRecord] = useState<BodyRecord>();
  const [selectedConsultation, setSelectedConsultation] = useState<Consultation>();
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "offline">("saved");
  const today = todayKey();

  useEffect(() => {
    fetch("/api/state")
      .then((response) => response.json() as Promise<{ state?: AppState }>)
      .then((data) => setState(data.state ?? initialState))
      .catch(() => setSaveState("offline"))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [tab]);

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

  const persist = async (next: AppState) => {
    setSaveState("saving");
    try {
      const response = await fetch("/api/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      setSaveState(response.ok ? "saved" : "offline");
    } catch {
      setSaveState("offline");
    }
  };

  const commit = (updater: (current: AppState) => AppState) => {
    setState((current) => {
      const next = updater(current);
      void persist(next);
      return next;
    });
  };

  const todayBody = state.bodyRecords.find((entry) => entry.date === today);
  const todayMeals = state.meals.filter((entry) => entry.date === today);
  const actualMeals = todayMeals.filter((entry) => entry.kind === "actual" && !entry.skipped);
  const todayWorkouts = state.workouts.filter((entry) => entry.date === today);
  const actualWorkouts = todayWorkouts.filter((entry) => entry.kind === "actual");
  const plannedWorkout = todayWorkouts.find((entry) => entry.kind === "plan");

  const nutrition = actualMeals.reduce(
    (sum, meal) => ({
      calories: sum.calories + meal.calories,
      protein: sum.protein + meal.protein,
      carbs: sum.carbs + meal.carbs,
      fat: sum.fat + meal.fat,
      sugar: sum.sugar + meal.sugar,
      fiber: sum.fiber + meal.fiber,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0, sugar: 0, fiber: 0 },
  );

  const mealActual = useCallback((type: MealType) => todayMeals.find((entry) => entry.kind === "actual" && entry.mealType === type), [todayMeals]);
  const mealPlan = useCallback((type: MealType) => todayMeals.find((entry) => entry.kind === "plan" && entry.mealType === type), [todayMeals]);
  const workoutExpected = Boolean(plannedWorkout || actualWorkouts.length);
  const completed = [Boolean(todayBody), ...(["breakfast", "lunch", "dinner"] as MealType[]).map((type) => Boolean(mealActual(type))), ...(workoutExpected ? [actualWorkouts.length > 0] : [])];
  const completedCount = completed.filter(Boolean).length;

  const nextAction = useMemo(() => {
    const hour = new Date().getHours();
    if (!todayBody && hour < 11 && !state.skippedTasks.includes(`${today}:body`)) {
      return { type: "body" as const, eyebrow: "아침 공복 기록", title: "오늘 인바디를 기록할까요?", detail: "체지방량과 골격근량의 흐름을 이어가요." };
    }
    const mealOrder: MealType[] = hour < 10 ? ["breakfast", "lunch", "dinner"] : hour < 15 ? ["lunch", "dinner"] : ["dinner"];
    const pendingMeal = mealOrder.find((mealType) => !mealActual(mealType));
    if (pendingMeal) {
      const plan = mealPlan(pendingMeal);
      return { type: "meal" as const, mealType: pendingMeal, eyebrow: `${mealLabels[pendingMeal]} 기록`, title: `${mealLabels[pendingMeal]} 식사를 기록할 시간이에요`, detail: plan ? `계획: ${plan.title}` : "계획은 없어요. 먹은 내용을 바로 남겨보세요." };
    }
    if (plannedWorkout && !actualWorkouts.length && hour >= 17 && !state.skippedTasks.includes(`${today}:workout`)) {
      return { type: "workout" as const, eyebrow: "오늘의 운동", title: "계획한 운동을 마쳤나요?", detail: `${plannedWorkout.title} · ${plannedWorkout.minutes}분` };
    }
    return { type: "done" as const, eyebrow: "오늘 기록", title: "오늘 기록을 모두 마쳤어요", detail: "필요한 기록이 생기면 아래 + 버튼으로 언제든 추가할 수 있어요." };
  }, [actualWorkouts.length, mealActual, mealPlan, plannedWorkout, state.skippedTasks, today, todayBody]);

  const openNextAction = () => {
    if (nextAction.type === "body") setModal("body");
    else if (nextAction.type === "workout") {
      setWorkoutDraft(plannedWorkout);
      setWorkoutPresetType(undefined);
      setModal("workout-actual");
    }
    else if (nextAction.type === "meal") {
      setMealPresetType(nextAction.mealType);
      setModal("meal-actual");
    }
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

  const saveBody = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const measurementTiming = String(data.get("measurementTiming"));
    const device = String(data.get("device"));
    const record: BodyRecord = {
      id: id("body"), date: String(data.get("date")), time: String(data.get("time")),
      weight: number(data.get("weight")), skeletalMuscle: number(data.get("skeletalMuscle")),
      bodyFatMass: number(data.get("bodyFatMass")), bodyFatRate: number(data.get("bodyFatRate")),
      visceralFat: number(data.get("visceralFat")), measurementTiming, device,
      condition: `${measurementTiming} · ${device}`,
    };
    commit((current) => ({ ...current, bodyRecords: [record, ...current.bodyRecords.filter((item) => item.date !== record.date)] }));
    setModal(null);
  };

  const saveMeal = (event: FormEvent<HTMLFormElement>, kind: EntryKind) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const mealType = String(data.get("mealType")) as MealType;
    const meal = {
      id: id("meal"), date: String(data.get("date")), mealType, kind,
      title: String(data.get("title")), calories: kind === "actual" ? number(data.get("calories")) : 0,
      protein: kind === "actual" ? number(data.get("protein")) : 0, carbs: kind === "actual" ? number(data.get("carbs")) : 0,
      fat: kind === "actual" ? number(data.get("fat")) : 0, sugar: kind === "actual" ? number(data.get("sugar")) : 0,
      fiber: kind === "actual" ? number(data.get("fiber")) : 0,
      confidence: confidenceFromSource(String(data.get("nutritionSource") || "manual")),
    };
    commit((current) => ({
      ...current,
      meals: [...current.meals.filter((item) => !(item.date === meal.date && item.mealType === meal.mealType && item.kind === kind)), meal],
    }));
    setModal(null);
  };

  const saveWorkout = (event: FormEvent<HTMLFormElement>, kind: EntryKind) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const editingId = String(data.get("editingId") || "");
    const workout: WorkoutEntry = {
      id: editingId || id("workout"), date: String(data.get("date")), kind,
      type: String(data.get("type")) as WorkoutEntry["type"], title: String(data.get("title")),
      minutes: number(data.get("minutes")), intensity: number(data.get("intensity")),
      heartRate: String(data.get("heartRate") || ""), overlapsSteps: data.get("overlapsSteps") === "on",
      details: String(data.get("details")),
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

  const openMeal = (kind: EntryKind, presetType?: MealType) => {
    setMealPresetType(presetType);
    setModal(kind === "plan" ? "meal-plan" : "meal-actual");
  };

  const saveCycle = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const cycle: CycleEntry = { id: id("cycle"), date: String(data.get("date")), state: String(data.get("state")) as CycleEntry["state"], note: String(data.get("note")) };
    commit((current) => ({ ...current, cycles: [...current.cycles.filter((item) => item.date !== cycle.date), cycle] }));
    setModal(null);
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `나의-밸런스-${today}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (!loaded) return <div className="loading-screen"><Image className="loading-mark" src="/tiger-icon-192.png" width={64} height={64} alt="" /><p>오늘의 기록을 준비하고 있어요</p></div>;

  return (
    <div className="app-shell">
      <aside className="desktop-nav">
        <div className="brand"><Image className="brand-mark" src="/tiger-icon-192.png" width={46} height={46} alt="" /><div><strong>나의 밸런스</strong><small>온전히 나를 위한 기록</small></div></div>
        <nav>{tabs.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}><NavPixelIcon tab={item.id} />{item.label}</button>)}</nav>
        <div className="side-note"><span>감량기 {state.profile.goalWeek}주차</span><strong>체중보다 변화를 봐요</strong></div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-heading"><Image className="topbar-tiger" src="/mascot-top-transparent.png" width={76} height={76} alt="호랑이 마스코트" /><div><p className="date-text">{dateLabel(today)}</p><h1>{tab === "today" ? "오늘도 가볍게 기록해요" : tabs.find((item) => item.id === tab)?.label}</h1></div></div>
          <div className="header-actions"><span className={`save-state ${saveState}`}>{saveState === "saving" ? "저장 중" : saveState === "offline" ? "임시 저장" : "저장됨"}</span><button className="icon-button" onClick={exportData} aria-label="전체 기록 내보내기">↓</button></div>
        </header>

        {tab === "today" && (
          <TodayView state={state} today={today} todayBody={todayBody} nutrition={nutrition} completedCount={completedCount} totalCount={completed.length} nextAction={nextAction} mealActual={mealActual} mealPlan={mealPlan} actualWorkouts={actualWorkouts} plannedWorkout={plannedWorkout} openNextAction={openNextAction} skipNextAction={skipNextAction} setModal={setModal} setTab={setTab} openMeal={openMeal} openWorkout={openWorkout} />
        )}
        {tab === "food" && <FoodView state={state} today={today} openMeal={openMeal} />}
        {tab === "workout" && <WorkoutView state={state} today={today} openWorkout={openWorkout} openGoal={() => setModal("workout-goal")} />}
        {tab === "change" && <ChangeView state={state} setModal={setModal} openDetail={(record) => { setSelectedBodyRecord(record); setModal("body-detail"); }} />}
        {tab === "consult" && <ConsultView state={state} commit={commit} openDetail={(consultation) => { setSelectedConsultation(consultation); setModal("consultation-detail"); }} />}
      </main>

      <button className="fab" onClick={() => setModal("quick")} aria-label="빠른 추가">+</button>
      <nav className="mobile-nav">{tabs.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}><NavPixelIcon tab={item.id} /><small>{item.label}</small></button>)}</nav>

      {modal === "quick" && <QuickSheet close={() => setModal(null)} select={(next) => { if (next === "workout-plan" || next === "workout-actual") { setWorkoutDraft(undefined); setWorkoutPresetType(undefined); } if (next === "meal-plan" || next === "meal-actual") setMealPresetType(undefined); setModal(next); }} />}
      {modal === "body" && <BodySheet today={today} latest={state.bodyRecords[0]} close={() => setModal(null)} save={saveBody} />}
      {modal === "body-detail" && selectedBodyRecord && <BodyDetailSheet record={selectedBodyRecord} close={() => setModal(null)} />}
      {(modal === "meal-plan" || modal === "meal-actual") && <MealSheet today={today} kind={modal === "meal-plan" ? "plan" : "actual"} plans={todayMeals} presetType={mealPresetType} close={() => { setMealPresetType(undefined); setModal(null); }} save={saveMeal} />}
      {(modal === "workout-plan" || modal === "workout-actual") && <WorkoutSheet today={today} kind={modal === "workout-plan" ? "plan" : "actual"} draft={workoutDraft} presetType={workoutPresetType} close={() => { setWorkoutDraft(undefined); setWorkoutPresetType(undefined); setModal(null); }} save={saveWorkout} />}
      {modal === "workout-goal" && <WorkoutGoalSheet goal={state.workoutGoal ?? initialState.workoutGoal!} close={() => setModal(null)} save={saveWorkoutGoal} />}
      {modal === "cycle" && <CycleSheet today={today} close={() => setModal(null)} save={saveCycle} />}
      {modal === "consultation-detail" && selectedConsultation && <ConsultationDetailSheet consultation={selectedConsultation} close={() => setModal(null)} />}
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
  openMeal: (kind: EntryKind, presetType?: MealType) => void;
  openWorkout: (kind: EntryKind, draft?: WorkoutEntry, presetType?: WorkoutEntry["type"]) => void;
};

function TodayView(props: TodayViewProps) {
  const { state, today, todayBody, nutrition, completedCount, totalCount, nextAction, mealActual, mealPlan, actualWorkouts, plannedWorkout, openNextAction, skipNextAction, setModal, setTab, openMeal, openWorkout } = props;
  const goal = state.nutritionGoal;
  const latest = todayBody ?? state.bodyRecords[0];
  const prev = state.bodyRecords.find((item: BodyRecord) => item.id !== latest?.id);
  const cycle = state.cycles.find((item: CycleEntry) => item.date === today);
  const workoutGoal = state.workoutGoal ?? initialState.workoutGoal!;
  const cardio = weeklyCardio(state, today);
  return <div className="dashboard-grid">
    <section className="next-card full-card">
      <div><span className="eyebrow">{nextAction.eyebrow}</span><h2>{nextAction.title}</h2><p>{nextAction.detail}</p></div>
      {nextAction.type !== "done" && <div className="next-actions"><button className="ghost-button" onClick={skipNextAction}>오늘은 건너뛰기</button><button className="primary-button" onClick={openNextAction}>기록하기 <span>→</span></button></div>}
    </section>

    <section className="card records-card">
      <CardTitle title="오늘 기록" aside={`${completedCount}/${totalCount}`} />
      <div className="record-list">
        <RecordRow label="인바디" detail={todayBody ? `${todayBody.bodyFatMass}kg 체지방 · ${todayBody.skeletalMuscle}kg 골격근` : "아직 기록하지 않음"} done={Boolean(todayBody)} onClick={() => setModal("body")} />
        {(["breakfast", "lunch", "dinner"] as MealType[]).map((type) => { const actual = mealActual(type); const plan = mealPlan(type); return <RecordRow key={type} label={mealLabels[type]} detail={actual ? actual.title : plan ? `계획 · ${plan.title}` : "아직 기록하지 않음"} done={Boolean(actual)} onClick={() => openMeal("actual", type)} />; })}
        {plannedWorkout && <RecordRow label="운동" detail={actualWorkouts[0]?.title ?? `계획 · ${plannedWorkout.title}`} done={actualWorkouts.length > 0} onClick={() => openWorkout("actual", plannedWorkout)} />}
        {cycle && <RecordRow label="몸 상태" detail={cycle.state} done onClick={() => setModal("cycle")} />}
      </div>
    </section>

    <section className="card nutrition-card">
      <CardTitle title="오늘의 영양" aside={<span className="soft-badge">임시 목표</span>} />
      <div className="calorie-total"><strong>{nutrition.calories.toLocaleString()}</strong><span>kcal</span><small>/ {goal.caloriesMin.toLocaleString()}~{goal.caloriesMax.toLocaleString()}</small></div>
      <NutrientBar label="단백질" value={nutrition.protein} min={goal.proteinMin} max={goal.proteinMax} unit="g" tone="coral" />
      <NutrientBar label="탄수화물" value={nutrition.carbs} min={goal.carbsMin} max={goal.carbsMax} unit="g" tone="gold" />
      <NutrientBar label="지방" value={nutrition.fat} min={goal.fatMin} max={goal.fatMax} unit="g" tone="sage" />
      <div className="micro-grid"><MicroStat label="당류" value={`${nutrition.sugar} / ${goal.sugarMax}g`} hint="상한 기준" /><MicroStat label="식이섬유" value={`${nutrition.fiber} / ${goal.fiberMin}g`} hint="최소 목표" /></div>
    </section>

    <section className="card body-card">
      <CardTitle title="최근 체성분" aside={<button className="text-button" onClick={() => setTab("change")}>변화 보기</button>} />
      <div className="body-highlight"><div><span>체지방량</span><strong>{latest?.bodyFatMass ?? "-"}<small>kg</small></strong><em>{prev ? `${latest.bodyFatMass - prev.bodyFatMass >= 0 ? "+" : ""}${(latest.bodyFatMass - prev.bodyFatMass).toFixed(1)}kg` : "첫 기록"}</em></div><div><span>골격근량</span><strong>{latest?.skeletalMuscle ?? "-"}<small>kg</small></strong><em>{prev ? `${latest.skeletalMuscle - prev.skeletalMuscle >= 0 ? "+" : ""}${(latest.skeletalMuscle - prev.skeletalMuscle).toFixed(1)}kg` : "첫 기록"}</em></div></div>
    </section>

    <section className="card week-card">
      <CardTitle title="이번 주" aside={<button className="text-button" onClick={() => setModal("workout-goal")}>목표 설정</button>} />
      <div className="weekly-line"><div><span>유산소</span><strong>{cardio.sessions} / {workoutGoal.cardioSessions}회</strong></div><div className="progress-track"><i style={{ width: `${Math.min(100, cardio.sessions / workoutGoal.cardioSessions * 100)}%` }} /></div></div>
      <div className="weekly-line"><div><span>누적 시간</span><strong>{cardio.minutes} / {workoutGoal.cardioMinutes}분</strong></div><div className="progress-track"><i style={{ width: `${Math.min(100, cardio.minutes / workoutGoal.cardioMinutes * 100)}%` }} /></div></div>
      <button className="secondary-button" onClick={() => openWorkout("actual")}>운동 기록 추가</button>
    </section>
  </div>;
}

function FoodView({ state, today, openMeal }: { state: AppState; today: string; openMeal: (kind: EntryKind, presetType?: MealType) => void }) {
  const [selectedMonth, setSelectedMonth] = useState(today.slice(0, 7));
  const cells = monthCells(`${selectedMonth}-01`);
  const mealStatus = (date: string) => {
    const meals = state.meals.filter((item) => item.date === date && item.kind === "actual" && !item.skipped);
    if (!meals.length) return "none";
    const totals = meals.reduce((sum, item) => ({ calories: sum.calories + item.calories, protein: sum.protein + item.protein, sugar: sum.sugar + item.sugar, fiber: sum.fiber + item.fiber }), { calories: 0, protein: 0, sugar: 0, fiber: 0 });
    if (meals.length < 3) return "partial";
    if (totals.sugar > state.nutritionGoal.sugarMax * 1.25 || totals.calories > state.nutritionGoal.caloriesMax * 1.15 || totals.protein < state.nutritionGoal.proteinMin * 0.65) return "attention";
    if (totals.calories >= state.nutritionGoal.caloriesMin && totals.calories <= state.nutritionGoal.caloriesMax && totals.protein >= state.nutritionGoal.proteinMin && totals.sugar <= state.nutritionGoal.sugarMax && totals.fiber >= state.nutritionGoal.fiberMin) return "balanced";
    return "partial";
  };
  return <div className="section-stack"><section className="card pixel-calendar-card"><div className="calendar-heading"><div><span className="eyebrow">식단 밸런스</span><label className="month-picker"><span>{monthLabel(`${selectedMonth}-01`)}</span><select value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)} aria-label="확인할 달 선택">{monthOptions(today).map((month) => <option value={month} key={month}>{monthLabel(`${month}-01`)}</option>)}</select></label></div><button className="primary-button" onClick={() => openMeal("plan")}>식사 계획</button></div><div className="calendar-weekdays">{["일", "월", "화", "수", "목", "금", "토"].map((day) => <span key={day}>{day}</span>)}</div><div className="month-grid">{cells.map((date, index) => date ? <div key={date} className={`calendar-day ${mealStatus(date)} ${date === today ? "today" : ""}`}><b>{Number(date.slice(-2))}</b></div> : <span className="calendar-blank" key={`blank-${index}`} />)}</div><div className="calendar-legend"><span><i className="balanced" />잘했어요</span><span><i className="partial" />괜찮아요</span><span><i className="attention" />아쉬워요</span></div></section>
    <section className="card"><CardTitle title={`${dateLabel(today)} 식단`} aside={<button className="text-button" onClick={() => openMeal("actual")}>먹은 식사 추가</button>} />
      <div className="meal-cards">{(["breakfast", "lunch", "dinner", "snack"] as MealType[]).map((type) => { const plan = state.meals.find((m) => m.date === today && m.mealType === type && m.kind === "plan"); const actual = state.meals.find((m) => m.date === today && m.mealType === type && m.kind === "actual"); return <article key={type} className="meal-card"><div><span>{mealLabels[type]}</span>{actual && <b>기록 완료</b>}</div><h3>{actual?.title ?? plan?.title ?? "아직 계획 없음"}</h3>{actual && <p>{actual.calories} kcal · 단백질 {actual.protein}g</p>}<button onClick={() => openMeal(actual || plan ? "actual" : "plan", type)}>{actual ? "수정하기" : plan ? "계획 불러오기" : "계획하기"}</button></article>; })}</div>
    </section>
  </div>;
}

function WorkoutView({ state, today, openWorkout, openGoal }: { state: AppState; today: string; openWorkout: (kind: EntryKind, draft?: WorkoutEntry, presetType?: WorkoutEntry["type"]) => void; openGoal: () => void }) {
  const entries = state.workouts.filter((item) => item.date === today);
  const cells = monthCells(today);
  const goal = state.workoutGoal ?? initialState.workoutGoal!;
  const cardio = weeklyCardio(state, today);
  return <div className="section-stack"><section className="card pixel-calendar-card"><div className="calendar-heading"><div><span className="eyebrow">운동 해빗</span><h2>{monthLabel(today)}</h2></div><div className="calendar-actions"><button className="ghost-button" onClick={() => openWorkout("plan")}>계획</button><button className="primary-button" onClick={() => openWorkout("actual")}>기록</button></div></div><div className="calendar-weekdays">{["일", "월", "화", "수", "목", "금", "토"].map((day) => <span key={day}>{day}</span>)}</div><div className="month-grid">{cells.map((date, index) => { if (!date) return <span className="calendar-blank" key={`blank-${index}`} />; const dayEntries = state.workouts.filter((item) => item.date === date); return <div key={date} className={`calendar-day workout-day ${date === today ? "today" : ""}`}><b>{Number(date.slice(-2))}</b><span className="workout-marks">{dayEntries.slice(0, 3).map((item) => <WorkoutMark key={item.id} type={item.type} kind={item.kind} />)}</span></div>; })}</div><div className="calendar-legend workout-legend"><span><WorkoutMark type="PT" kind="actual" />PT 완료</span><span><WorkoutMark type="유산소" kind="actual" />개인운동 완료</span><span><WorkoutMark type="PT" kind="plan" />PT 계획</span><span><WorkoutMark type="유산소" kind="plan" />개인운동 계획</span></div></section>
    <section className="workout-goal-block"><div className="workout-goal-heading"><h2>주간 목표</h2><button className="text-button" onClick={openGoal}>목표 설정</button></div><div className="metric-grid workout-metrics"><MetricCard label="개인 유산소" value={`${cardio.sessions} / ${goal.cardioSessions}`} unit="회" hint="최소 주간 목표" /><MetricCard label="누적시간" value={`${cardio.minutes} / ${goal.cardioMinutes}`} unit="분" hint="이번 주 목표" /></div></section>
    <section className="card"><CardTitle title="오늘 운동" aside={dateLabel(today)} />{entries.length ? <div className="timeline">{entries.map((entry) => <article key={entry.id}><span className={`timeline-dot ${entry.kind}`} /><div><small>{entry.kind === "plan" ? "계획" : "완료"} · {entry.type}</small><h3>{entry.title}</h3><p>{entry.minutes}분 · 강도 {typeof entry.intensity === "number" ? `${entry.intensity}/10` : entry.intensity || "미기록"}{entry.heartRate ? ` · 심박 ${entry.heartRate}` : ""}</p>{entry.overlapsSteps && <span className="overlap-badge">걸음 수 중복</span>}{entry.details && <em>{entry.details}</em>}<button className="timeline-action" onClick={() => openWorkout("actual", entry)}>{entry.kind === "plan" ? "계획대로 기록" : "수정"}</button></div></article>)}</div> : <EmptyState text="오늘 운동 계획이나 기록이 없어요." action="운동 계획하기" onClick={() => openWorkout("plan")} showIcon={false} />}</section>
    <section className="card"><CardTitle title="PT 빠른 기록" /><button className="secondary-button" onClick={() => openWorkout("actual", undefined, "PT")}>PT 내용 기록하기</button></section>
  </div>;
}

function ChangeView({ state, setModal, openDetail }: { state: AppState; setModal: (modal: Modal) => void; openDetail: (record: BodyRecord) => void }) {
  const latest = state.bodyRecords[0];
  const records = state.bodyRecords.slice(0, 7).reverse();
  const oldest = records[0];
  const measuredAt = latest ? `${latest.date.replaceAll("-", ".")} · ${latest.time}` : "기록 없음";
  return <div className="section-stack"><section className="card change-overview"><div><span className="eyebrow">최근 측정 흐름</span><h2>체지방 {oldest && latest ? `${signed(latest.bodyFatMass - oldest.bodyFatMass)}kg` : "-"} · 골격근 {oldest && latest ? `${signed(latest.skeletalMuscle - oldest.skeletalMuscle)}kg` : "-"}</h2></div><button className="primary-button" onClick={() => setModal("body")}>인바디 입력</button></section>
    <div className="metric-grid change-metric-grid"><MetricCard label="체지방량" value={String(latest?.bodyFatMass ?? "-")} unit="kg" hint={measuredAt} /><MetricCard label="골격근량" value={String(latest?.skeletalMuscle ?? "-")} unit="kg" hint={measuredAt} /><MetricCard label="체중" value={String(latest?.weight ?? "-")} unit="kg" hint={measuredAt} /><MetricCard label="내장지방" value={String(latest?.visceralFat ?? "-")} unit="Lv" hint={measuredAt} /></div>
    <section className="card chart-card"><CardTitle title="최근 체지방량" aside="kg · 최근 7회" /><FatTrendChart records={records} /></section>
    <section className="card"><CardTitle title="측정 기록" aside={`${state.bodyRecords.length}개`} /><div className="data-table">{state.bodyRecords.slice(0, 8).map((record) => <button type="button" key={record.id} onClick={() => openDetail(record)} aria-label={`${record.date} 인바디 상세 보기`}><span><strong>{record.date}</strong><small>{record.time} · {record.measurementTiming ?? record.condition.split(" · ")[0]} · {record.device ?? record.condition.split(" · ")[1]}</small></span><span>{record.bodyFatMass}<small>kg 지방</small></span><span>{record.skeletalMuscle}<small>kg 골격근</small></span><b aria-hidden="true">›</b></button>)}</div></section>
  </div>;
}

function ConsultView({ state, commit, openDetail }: { state: AppState; commit: (updater: (current: AppState) => AppState) => void; openDetail: (consultation: Consultation) => void }) {
  const [loading, setLoading] = useState(false);
  const latest = state.consultations[0];
  const requestReview = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/ai-review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state) });
      const data = await response.json() as { text: string; source: "openai" | "preview" };
      commit((current) => ({ ...current, consultations: [{ id: id("consult"), date: todayKey(), text: data.text, source: data.source }, ...current.consultations] }));
    } finally { setLoading(false); }
  };
  return <div className="section-stack"><section className="section-hero consult-hero"><div><span className="eyebrow">일요일 주간 상담</span><h2>기록을 모아보고,<br />다음 한 주를 조정해요.</h2></div><button className="primary-button" onClick={requestReview} disabled={loading}>{loading ? "기록을 살펴보는 중…" : "✦ 상담 시작"}</button></section>
    <section className="card consultation-card"><CardTitle title={latest ? "최근 상담" : "첫 상담을 준비했어요"} aside={latest ? latest.date : ""} />{latest ? <><span className={`source-badge ${latest.source}`}>{latest.source === "openai" ? "ChatGPT 상담" : "AI 연결 전 미리보기"}</span><div className="consultation-text">{latest.text}</div><div className="consult-buttons"><button className="ghost-button">대화 이어가기</button><button className="primary-button">다음 주 계획하기</button></div></> : <EmptyState text="체성분·식사·운동 기록을 바탕으로 이번 주를 함께 정리해요." action="첫 상담 시작" onClick={requestReview} />}</section>
    <section className="card consultation-history"><CardTitle title="과거 상담" aside={`${Math.max(0, state.consultations.length - 1)}개`} />{state.consultations.length > 1 ? <div className="history-list">{state.consultations.slice(1).map((item) => <button key={item.id} onClick={() => openDetail(item)} aria-label={`${item.date} 상담 보기`}><strong>{item.date}</strong><b aria-hidden="true">›</b></button>)}</div> : <p className="history-empty">상담이 쌓이면 이전 내용을 여기에서 다시 볼 수 있어요.</p>}</section>
  </div>;
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
function EmptyState({ text, action, onClick, showIcon = true }: { text: string; action: string; onClick: () => void; showIcon?: boolean }) { return <div className={`empty-state ${showIcon ? "" : "without-icon"}`}>{showIcon && <span>○</span>}<p>{text}</p><button onClick={onClick}>{action}</button></div>; }

function Sheet({ title, subtitle, close, children }: { title: string; subtitle?: string; close: () => void; children: React.ReactNode }) { return <div className="sheet-backdrop"><section className="sheet" role="dialog" aria-modal="true"><div className="sheet-handle" /><header><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button onClick={close} aria-label="닫기">×</button></header>{children}</section></div>; }

function QuickSheet({ close, select }: { close: () => void; select: (modal: Modal) => void }) { return <Sheet title="무엇을 추가할까요?" close={close}><h3 className="sheet-section-title">지금 기록하기</h3><div className="quick-grid"><QuickButton label="인바디" onClick={() => select("body")} /><QuickButton label="생리 상태" onClick={() => select("cycle")} /><QuickButton label="먹은 식사" onClick={() => select("meal-actual")} /><QuickButton label="한 운동" onClick={() => select("workout-actual")} /></div><h3 className="sheet-section-title">미리 계획하기</h3><div className="quick-grid two"><QuickButton label="식사 계획" onClick={() => select("meal-plan")} /><QuickButton label="운동 계획" onClick={() => select("workout-plan")} /></div></Sheet>; }
function QuickButton({ label, onClick }: { label: string; onClick: () => void }) { return <button className="quick-button" onClick={onClick}><strong>{label}</strong></button>; }

function FatTrendChart({ records }: { records: BodyRecord[] }) {
  if (!records.length) return <div className="empty-chart">체성분 기록을 입력하면 흐름이 보여요.</div>;
  const width = 700;
  const height = 250;
  const left = 52;
  const right = 28;
  const top = 34;
  const bottom = 46;
  const values = records.map((item) => item.bodyFatMass);
  const min = Math.floor((Math.min(...values) - 0.2) * 10) / 10;
  const max = Math.ceil((Math.max(...values) + 0.2) * 10) / 10;
  const range = Math.max(max - min, 0.4);
  const points = records.map((record, index) => ({
    record,
    x: left + (records.length === 1 ? (width - left - right) / 2 : index * ((width - left - right) / (records.length - 1))),
    y: top + ((max - record.bodyFatMass) / range) * (height - top - bottom),
  }));
  return <div className="trend-chart-wrap"><svg className="trend-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="최근 체지방량 변화 선 그래프">
    {[0, 0.5, 1].map((ratio) => { const y = top + ratio * (height - top - bottom); const value = max - ratio * range; return <g key={ratio}><line x1={left} x2={width - right} y1={y} y2={y} className="chart-grid-line" /><text x={left - 10} y={y + 4} textAnchor="end" className="chart-axis-value">{value.toFixed(1)}</text></g>; })}
    <polyline points={points.map((point) => `${point.x},${point.y}`).join(" ")} className="trend-line" />
    {points.map(({ record, x, y }) => <g key={record.id}><circle cx={x} cy={y} r="6" className="trend-point" /><text x={x} y={y - 14} textAnchor="middle" className="trend-value">{record.bodyFatMass}kg</text><text x={x} y={height - 16} textAnchor="middle" className="trend-date">{record.date.slice(5).replace("-", "/")}</text></g>)}
  </svg></div>;
}

function BodySheet({ today, latest, close, save }: { today: string; latest: BodyRecord; close: () => void; save: (event: FormEvent<HTMLFormElement>) => void }) { const [legacyTiming = "아침 공복", legacyDevice = "InBody Dial H30"] = latest?.condition?.split(" · ") ?? []; return <Sheet title="인바디 기록" close={close}><form className="form-stack" onSubmit={save}><div className="two-fields sheet-leading-fields"><Field label="측정일"><input type="date" name="date" defaultValue={today} required /></Field><Field label="측정시간"><input type="time" name="time" defaultValue={new Date().toTimeString().slice(0, 5)} required /></Field></div><MeasureField label="체중" name="weight" unit="kg" previous={latest?.weight} /><MeasureField label="골격근량" name="skeletalMuscle" unit="kg" previous={latest?.skeletalMuscle} /><MeasureField label="체지방량" name="bodyFatMass" unit="kg" previous={latest?.bodyFatMass} /><MeasureField label="체지방률" name="bodyFatRate" unit="%" previous={latest?.bodyFatRate} /><MeasureField label="내장지방레벨" name="visceralFat" unit="Lv" previous={latest?.visceralFat} step="1" /><div className="two-fields"><Field label="측정 시점"><select name="measurementTiming" defaultValue={latest?.measurementTiming ?? legacyTiming}><option>아침 공복</option><option>평소와 다른 시간</option><option>식후</option><option>운동 후</option></select></Field><Field label="측정 기기"><select name="device" defaultValue={latest?.device ?? legacyDevice}><option>InBody Dial H30</option><option>헬스장 InBody</option><option>병원 InBody</option><option>다른 체성분 기기</option></select></Field></div><button className="primary-button submit-button" type="submit">저장하기</button></form></Sheet>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="field"><span>{label}</span>{children}</label>; }
function MeasureField({ label, name, unit, previous, step = "0.1" }: { label: string; name: string; unit: string; previous?: number; step?: string }) { return <label className="measure-field"><div><span>{label}</span>{previous !== undefined && <small>이전 측정 {previous}{unit}</small>}</div><div><input inputMode="decimal" type="number" step={step} min="0" name={name} defaultValue={previous} required /><b>{unit}</b></div></label>; }

function MealSheet({ today, kind, plans, presetType, close, save }: { today: string; kind: EntryKind; plans: AppState["meals"]; presetType?: MealType; close: () => void; save: (event: FormEvent<HTMLFormElement>, kind: EntryKind) => void }) { const hour = new Date().getHours(); const defaultType: MealType = presetType ?? (hour < 10 ? "breakfast" : hour < 15 ? "lunch" : "dinner"); const plan = plans.find((item) => item.kind === "plan" && item.mealType === defaultType); return <Sheet title={kind === "plan" ? "식사 계획" : "먹은 식사 기록"} close={close}><form className="form-stack meal-form" onSubmit={(event) => save(event, kind)}><div className="two-fields sheet-leading-fields"><Field label="날짜"><input type="date" name="date" defaultValue={today} required /></Field><Field label="끼니"><select name="mealType" defaultValue={defaultType}>{Object.entries(mealLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field></div><Field label={kind === "plan" ? "먹고 싶은 음식" : "먹은 음식"}><textarea className="meal-food-input" rows={2} name="title" defaultValue={kind === "actual" ? plan?.title : ""} placeholder="예: 그릭요거트와 단백질바" required /></Field>{kind === "actual" && <><input type="hidden" name="nutritionSource" value="manual" /><div className="macro-grid"><Field label="칼로리"><input type="number" name="calories" min="0" placeholder="kcal" /></Field><Field label="단백질"><input type="number" name="protein" min="0" step="0.1" placeholder="g" /></Field><Field label="탄수화물"><input type="number" name="carbs" min="0" step="0.1" placeholder="g" /></Field><Field label="지방"><input type="number" name="fat" min="0" step="0.1" placeholder="g" /></Field><Field label="당류"><input type="number" name="sugar" min="0" step="0.1" placeholder="g" /></Field><Field label="식이섬유"><input type="number" name="fiber" min="0" step="0.1" placeholder="g" /></Field></div></>}<button className="primary-button submit-button" type="submit">{kind === "plan" ? "계획 저장" : "식사 기록 저장"}</button></form></Sheet>; }

function WorkoutGoalSheet({ goal, close, save }: { goal: NonNullable<AppState["workoutGoal"]>; close: () => void; save: (event: FormEvent<HTMLFormElement>) => void }) {
  return <Sheet title="주간 운동 목표" close={close}><form className="form-stack" onSubmit={save}><Field label="개인 유산소 최소 횟수"><input type="number" name="cardioSessions" min="1" max="14" defaultValue={goal.cardioSessions} required /></Field><Field label="개인 유산소 누적시간 (분)"><input type="number" name="cardioMinutes" min="1" max="1000" defaultValue={goal.cardioMinutes} required /></Field><button className="primary-button submit-button" type="submit">목표 저장</button></form></Sheet>;
}

function WorkoutSheet({ today, kind, draft, presetType, close, save }: { today: string; kind: EntryKind; draft?: WorkoutEntry; presetType?: WorkoutEntry["type"]; close: () => void; save: (event: FormEvent<HTMLFormElement>, kind: EntryKind) => void }) {
  const editing = draft?.kind === kind;
  const initialType = draft?.type ?? presetType ?? "유산소";
  const [workoutType, setWorkoutType] = useState<WorkoutEntry["type"]>(initialType);
  const previousHeartRate = draft?.heartRate ?? (typeof draft?.intensity === "string" && draft.intensity.includes("심박수") ? draft.intensity.replace("심박수", "").trim() : "");
  const previousIntensity = typeof draft?.intensity === "number" ? draft.intensity : 5;
  return <Sheet title={kind === "plan" ? "운동 계획" : editing ? "운동 기록 수정" : "한 운동 기록"} close={close}><form className="form-stack" onSubmit={(event) => save(event, kind)}><input type="hidden" name="editingId" value={editing ? draft.id : ""} /><div className="two-fields sheet-leading-fields"><Field label="날짜"><input type="date" name="date" defaultValue={draft?.date ?? today} required /></Field><Field label="운동 종류"><select name="type" value={workoutType} onChange={(event) => setWorkoutType(event.target.value as WorkoutEntry["type"])}><option>PT</option><option>유산소</option></select></Field></div><Field label="운동 이름"><input name="title" defaultValue={draft?.title ?? ""} placeholder={workoutType === "PT" ? "예: 필라테스 + 기능운동" : "예: 인클라인 트레드밀"} required /></Field>{workoutType === "유산소" && <div className="check-field step-overlap-check"><input id="overlapsSteps" type="checkbox" name="overlapsSteps" defaultChecked={draft?.overlapsSteps} /><label htmlFor="overlapsSteps"><strong>일상 걸음 수와 중복되는 운동은 체크해주세요.</strong></label></div>}<div className="two-fields"><Field label="시간 (분)"><input type="number" name="minutes" defaultValue={draft?.minutes ?? ""} min="1" placeholder="예: 35" required /></Field><Field label="체감 강도 (1~10)"><select name="intensity" defaultValue={previousIntensity}>{[1,2,3,4,5,6,7,8,9,10].map((value) => <option value={value} key={value}>{value}</option>)}</select></Field></div><div className="rpe-scale"><span>1–2 아주 가벼움</span><span>3–4 가벼움</span><span>5–6 보통</span><span>7–8 힘듦</span><span>9–10 매우 힘듦</span></div><Field label="평균 심박수 (선택)"><input name="heartRate" defaultValue={previousHeartRate} placeholder="예: 130~140" /></Field><Field label="운동 내용"><textarea name="details" defaultValue={draft?.details ?? ""} placeholder="종목, 중량, 횟수, 세트 또는 컨디션을 적어주세요." /></Field><button className="primary-button submit-button" type="submit">{kind === "plan" ? "운동 계획 저장" : editing ? "수정 저장" : "운동 기록 저장"}</button></form></Sheet>;
}

function BodyDetailSheet({ record, close }: { record: BodyRecord; close: () => void }) {
  const measurementTiming = record.measurementTiming ?? record.condition.split(" · ")[0];
  const device = record.device ?? record.condition.split(" · ")[1];
  const metrics = [
    ["체중", record.weight, "kg"], ["골격근량", record.skeletalMuscle, "kg"],
    ["체지방량", record.bodyFatMass, "kg"], ["체지방률", record.bodyFatRate, "%"],
    ["내장지방", record.visceralFat, "Lv"],
  ];
  return <Sheet title="인바디 상세" close={close}><div className="detail-date"><strong>{record.date}</strong><span>{record.time}</span></div><div className="body-detail-grid">{metrics.map(([label, value, unit]) => <article key={String(label)}><span>{label}</span><strong>{value}<small>{unit}</small></strong></article>)}</div><dl className="detail-meta"><div><dt>측정 시점</dt><dd>{measurementTiming}</dd></div><div><dt>측정 기기</dt><dd>{device}</dd></div></dl></Sheet>;
}

function ConsultationDetailSheet({ consultation, close }: { consultation: Consultation; close: () => void }) {
  return <Sheet title="상담 다시보기" close={close}><div className="detail-date"><strong>{consultation.date}</strong></div><span className={`source-badge ${consultation.source}`}>{consultation.source === "openai" ? "ChatGPT 상담" : "AI 연결 전 미리보기"}</span><div className="consultation-text consultation-popup-text">{consultation.text}</div></Sheet>;
}

function CycleSheet({ today, close, save }: { today: string; close: () => void; save: (event: FormEvent<HTMLFormElement>) => void }) { return <Sheet title="생리 상태 기록" close={close}><form className="form-stack" onSubmit={save}><Field label="날짜"><input type="date" name="date" defaultValue={today} required /></Field><Field label="오늘 상태"><select name="state"><option>없음</option><option>갈색 출혈</option><option>본 출혈</option><option>부정출혈</option></select></Field><Field label="메모 · 선택"><textarea name="note" placeholder="평소와 다른 점이 있다면 적어주세요." /></Field><button className="primary-button submit-button" type="submit">상태 저장</button></form></Sheet>; }
