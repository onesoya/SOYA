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
type Modal = null | "quick" | "body" | "meal-plan" | "meal-actual" | "workout-plan" | "workout-actual" | "cycle";
type NextAction =
  | { type: "body"; eyebrow: string; title: string; detail: string }
  | { type: "workout"; eyebrow: string; title: string; detail: string }
  | { type: "meal"; mealType: MealType; eyebrow: string; title: string; detail: string };

const tabs: { id: Tab; label: string; icon: string }[] = [
  { id: "today", label: "오늘", icon: "⌂" },
  { id: "food", label: "식단", icon: "◒" },
  { id: "workout", label: "운동", icon: "△" },
  { id: "change", label: "변화", icon: "⌁" },
  { id: "consult", label: "상담", icon: "✦" },
];

const todayKey = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
};

const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const number = (value: FormDataEntryValue | null) => Number(value || 0);
const dateLabel = (value: string) => new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "long" }).format(new Date(`${value}T12:00:00`));

export function HealthApp() {
  const [state, setState] = useState<AppState>(initialState);
  const [tab, setTab] = useState<Tab>("today");
  const [modal, setModal] = useState<Modal>(null);
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
    const currentMeal: MealType = hour < 10 ? "breakfast" : hour < 15 ? "lunch" : "dinner";
    if (!mealActual(currentMeal)) {
      const plan = mealPlan(currentMeal);
      return { type: "meal" as const, mealType: currentMeal, eyebrow: `${mealLabels[currentMeal]} 기록`, title: `${mealLabels[currentMeal]} 식사를 기록할 시간이에요`, detail: plan ? `계획: ${plan.title}` : "계획은 없어요. 먹은 내용을 바로 남겨보세요." };
    }
    if (plannedWorkout && !actualWorkouts.length && hour >= 17 && !state.skippedTasks.includes(`${today}:workout`)) {
      return { type: "workout" as const, eyebrow: "오늘의 운동", title: "계획한 운동을 마쳤나요?", detail: `${plannedWorkout.title} · ${plannedWorkout.minutes}분` };
    }
    const upcoming: MealType = hour < 12 ? "lunch" : "dinner";
    const plan = mealPlan(upcoming);
    return { type: "meal" as const, mealType: upcoming, eyebrow: "다음 일정", title: `${mealLabels[upcoming]} 기록이 다음이에요`, detail: plan ? `계획: ${plan.title}` : "필요하면 미리 식사를 계획해두세요." };
  }, [actualWorkouts.length, mealActual, mealPlan, plannedWorkout, state.skippedTasks, today, todayBody]);

  const openNextAction = () => {
    if (nextAction.type === "body") setModal("body");
    else if (nextAction.type === "workout") setModal("workout-actual");
    else setModal("meal-actual");
  };

  const skipNextAction = () => {
    if (nextAction.type === "meal") {
      const skipped = {
        id: id("meal"), date: today, mealType: nextAction.mealType, kind: "actual" as const,
        title: "먹지 않음", calories: 0, protein: 0, carbs: 0, fat: 0, sugar: 0, fiber: 0,
        confidence: "높음" as const, skipped: true,
      };
      commit((current) => ({ ...current, meals: [...current.meals, skipped] }));
    } else {
      const key = `${today}:${nextAction.type}`;
      commit((current) => ({ ...current, skippedTasks: [...new Set([...current.skippedTasks, key])] }));
    }
  };

  const saveBody = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const record: BodyRecord = {
      id: id("body"), date: String(data.get("date")), time: String(data.get("time")),
      weight: number(data.get("weight")), skeletalMuscle: number(data.get("skeletalMuscle")),
      bodyFatMass: number(data.get("bodyFatMass")), bodyFatRate: number(data.get("bodyFatRate")),
      visceralFat: number(data.get("visceralFat")), condition: String(data.get("condition")),
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
      confidence: String(data.get("confidence") || "추정") as "높음" | "보통" | "추정" | "낮음",
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
    const workout: WorkoutEntry = {
      id: id("workout"), date: String(data.get("date")), kind,
      type: String(data.get("type")) as WorkoutEntry["type"], title: String(data.get("title")),
      minutes: number(data.get("minutes")), intensity: String(data.get("intensity")), details: String(data.get("details")),
    };
    commit((current) => ({ ...current, workouts: [...current.workouts, workout] }));
    setModal(null);
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
        <nav>{tabs.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}><span>{item.icon}</span>{item.label}</button>)}</nav>
        <div className="side-note"><span>감량기 {state.profile.goalWeek}주차</span><strong>체중보다 변화를 봐요</strong><p>체지방량과 골격근량의 7일 흐름을 중심으로 확인해요.</p></div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-heading"><Image className="topbar-tiger" src="/tiger-icon-192.png" width={48} height={48} alt="호랑이 마스코트" /><div><p className="date-text">{dateLabel(today)}</p><h1>{tab === "today" ? "오늘도 가볍게 기록해요" : tabs.find((item) => item.id === tab)?.label}</h1></div></div>
          <div className="header-actions"><span className={`save-state ${saveState}`}>{saveState === "saving" ? "저장 중" : saveState === "offline" ? "임시 저장" : "저장됨"}</span><button className="icon-button" onClick={exportData} aria-label="전체 기록 내보내기">↓</button></div>
        </header>

        {tab === "today" && (
          <TodayView state={state} today={today} todayBody={todayBody} nutrition={nutrition} completedCount={completedCount} totalCount={completed.length} nextAction={nextAction} mealActual={mealActual} mealPlan={mealPlan} actualWorkouts={actualWorkouts} plannedWorkout={plannedWorkout} openNextAction={openNextAction} skipNextAction={skipNextAction} setModal={setModal} />
        )}
        {tab === "food" && <FoodView state={state} today={today} setModal={setModal} />}
        {tab === "workout" && <WorkoutView state={state} today={today} setModal={setModal} />}
        {tab === "change" && <ChangeView state={state} setModal={setModal} />}
        {tab === "consult" && <ConsultView state={state} commit={commit} />}
      </main>

      <button className="fab" onClick={() => setModal("quick")} aria-label="빠른 추가">+</button>
      <nav className="mobile-nav">{tabs.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}><span>{item.icon}</span><small>{item.label}</small></button>)}</nav>

      {modal === "quick" && <QuickSheet close={() => setModal(null)} select={setModal} />}
      {modal === "body" && <BodySheet today={today} latest={state.bodyRecords[0]} close={() => setModal(null)} save={saveBody} />}
      {(modal === "meal-plan" || modal === "meal-actual") && <MealSheet today={today} kind={modal === "meal-plan" ? "plan" : "actual"} plans={todayMeals} close={() => setModal(null)} save={saveMeal} />}
      {(modal === "workout-plan" || modal === "workout-actual") && <WorkoutSheet today={today} kind={modal === "workout-plan" ? "plan" : "actual"} planned={plannedWorkout} close={() => setModal(null)} save={saveWorkout} />}
      {modal === "cycle" && <CycleSheet today={today} close={() => setModal(null)} save={saveCycle} />}
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
};

function TodayView(props: TodayViewProps) {
  const { state, today, todayBody, nutrition, completedCount, totalCount, nextAction, mealActual, mealPlan, actualWorkouts, plannedWorkout, openNextAction, skipNextAction, setModal } = props;
  const goal = state.nutritionGoal;
  const latest = todayBody ?? state.bodyRecords[0];
  const prev = state.bodyRecords.find((item: BodyRecord) => item.id !== latest?.id);
  const cycle = state.cycles.find((item: CycleEntry) => item.date === today);
  return <div className="dashboard-grid">
    <section className="next-card full-card">
      <div><span className="eyebrow">{nextAction.eyebrow}</span><h2>{nextAction.title}</h2><p>{nextAction.detail}</p></div>
      <div className="next-actions"><button className="ghost-button" onClick={skipNextAction}>오늘은 건너뛰기</button><button className="primary-button" onClick={openNextAction}>기록하기 <span>→</span></button></div>
    </section>

    <section className="card records-card">
      <CardTitle title="오늘 기록" aside={`${completedCount}/${totalCount}`} />
      <div className="record-list">
        <RecordRow label="인바디" detail={todayBody ? `${todayBody.bodyFatMass}kg 체지방 · ${todayBody.skeletalMuscle}kg 골격근` : "아직 기록하지 않음"} done={Boolean(todayBody)} onClick={() => setModal("body")} />
        {(["breakfast", "lunch", "dinner"] as MealType[]).map((type) => { const actual = mealActual(type); const plan = mealPlan(type); return <RecordRow key={type} label={mealLabels[type]} detail={actual ? actual.title : plan ? `계획 · ${plan.title}` : "아직 기록하지 않음"} done={Boolean(actual)} onClick={() => setModal("meal-actual")} />; })}
        {plannedWorkout && <RecordRow label="운동" detail={actualWorkouts[0]?.title ?? `계획 · ${plannedWorkout.title}`} done={actualWorkouts.length > 0} onClick={() => setModal("workout-actual")} />}
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
      <CardTitle title="최근 체성분" aside={<button className="text-button">변화 보기</button>} />
      <div className="body-highlight"><div><span>체지방량</span><strong>{latest?.bodyFatMass ?? "-"}<small>kg</small></strong><em>{prev ? `${latest.bodyFatMass - prev.bodyFatMass >= 0 ? "+" : ""}${(latest.bodyFatMass - prev.bodyFatMass).toFixed(1)}kg` : "첫 기록"}</em></div><div><span>골격근량</span><strong>{latest?.skeletalMuscle ?? "-"}<small>kg</small></strong><em>{prev ? `${latest.skeletalMuscle - prev.skeletalMuscle >= 0 ? "+" : ""}${(latest.skeletalMuscle - prev.skeletalMuscle).toFixed(1)}kg` : "첫 기록"}</em></div></div>
      <p className="card-note">하루 차이보다 7일 평균의 방향을 중심으로 보여드려요.</p>
    </section>

    <section className="card week-card">
      <CardTitle title="이번 주" aside="일요일 상담까지 2일" />
      <div className="weekly-line"><div><span>유산소</span><strong>1 / 2회</strong></div><div className="progress-track"><i style={{ width: "50%" }} /></div></div>
      <div className="weekly-line"><div><span>누적 시간</span><strong>35 / 90분</strong></div><div className="progress-track"><i style={{ width: "39%" }} /></div></div>
      <button className="secondary-button" onClick={() => setModal("workout-actual")}>운동 기록 추가</button>
    </section>
  </div>;
}

function FoodView({ state, today, setModal }: { state: AppState; today: string; setModal: (modal: Modal) => void }) {
  const dates = Array.from({ length: 7 }, (_, index) => { const date = new Date(`${today}T12:00:00`); date.setDate(date.getDate() + index); return date.toISOString().slice(0, 10); });
  return <div className="section-stack"><section className="section-hero food-hero"><div><span className="eyebrow">7일 식단</span><h2>종류는 가볍게 계획하고<br />먹은 양은 정확하게 기록해요.</h2></div><button className="primary-button" onClick={() => setModal("meal-plan")}>+ 식사 계획</button></section>
    <div className="week-days">{dates.map((date, index) => <button className={index === 0 ? "active" : ""} key={date}><small>{new Intl.DateTimeFormat("ko-KR", { weekday: "short" }).format(new Date(`${date}T12:00:00`))}</small><strong>{Number(date.slice(-2))}</strong></button>)}</div>
    <section className="card"><CardTitle title={`${dateLabel(today)} 식단`} aside={<button className="text-button" onClick={() => setModal("meal-actual")}>먹은 식사 추가</button>} />
      <div className="meal-cards">{(["breakfast", "lunch", "dinner", "snack"] as MealType[]).map((type) => { const plan = state.meals.find((m) => m.date === today && m.mealType === type && m.kind === "plan"); const actual = state.meals.find((m) => m.date === today && m.mealType === type && m.kind === "actual"); return <article key={type} className="meal-card"><div><span>{mealLabels[type]}</span>{actual && <b>기록 완료</b>}</div><h3>{actual?.title ?? plan?.title ?? "아직 계획 없음"}</h3><p>{actual ? `${actual.calories} kcal · 단백질 ${actual.protein}g` : plan ? "계획을 실제 기록으로 불러올 수 있어요" : "원하는 음식 종류만 간단히 적어두세요"}</p><button onClick={() => setModal(actual ? "meal-actual" : plan ? "meal-actual" : "meal-plan")}>{actual ? "수정하기" : plan ? "계획 불러오기" : "계획하기"}</button></article>; })}</div>
    </section>
    <section className="card confidence-guide"><CardTitle title="계산 신뢰도" /><div className="confidence-row"><span className="confidence high">높음</span><p>제품 영양표 또는 계량한 레시피</p></div><div className="confidence-row"><span className="confidence medium">보통</span><p>저장된 레시피를 1인분으로 계산</p></div><div className="confidence-row"><span className="confidence estimate">추정</span><p>일반 음식의 대표값</p></div><div className="confidence-row"><span className="confidence low">낮음</span><p>외식·배달·사진 기반 추정</p></div></section>
  </div>;
}

function WorkoutView({ state, today, setModal }: { state: AppState; today: string; setModal: (modal: Modal) => void }) {
  const entries = state.workouts.filter((item) => item.date === today);
  return <div className="section-stack"><section className="section-hero workout-hero"><div><span className="eyebrow">주간 운동</span><h2>횟수보다 꾸준함을,<br />칼로리보다 수행을 기록해요.</h2></div><div className="hero-actions"><button className="ghost-button" onClick={() => setModal("workout-plan")}>계획하기</button><button className="primary-button" onClick={() => setModal("workout-actual")}>+ 한 운동</button></div></section>
    <div className="metric-grid"><MetricCard label="개인 유산소" value="1 / 2" unit="회" hint="최소 주간 목표" /><MetricCard label="누적시간" value="35 / 90" unit="분" hint="이번 주 범위" /><MetricCard label="타깃 심박" value="130~140" unit="bpm" hint="개인 유산소 기준" /></div>
    <section className="card"><CardTitle title="오늘 운동" aside={dateLabel(today)} />{entries.length ? <div className="timeline">{entries.map((entry) => <article key={entry.id}><span className={`timeline-dot ${entry.kind}`} /><div><small>{entry.kind === "plan" ? "계획" : "완료"} · {entry.type}</small><h3>{entry.title}</h3><p>{entry.minutes}분 · {entry.intensity}</p>{entry.details && <em>{entry.details}</em>}</div></article>)}</div> : <EmptyState text="오늘 운동 계획이나 기록이 없어요." action="운동 계획하기" onClick={() => setModal("workout-plan")} />}</section>
    <section className="card"><CardTitle title="PT 빠른 기록" /><p className="large-copy">수업 직후 기억나는 내용을 문장으로 적어주세요. 아이폰 받아쓰기를 사용해도 좋아요.</p><div className="example-note">“고블릿 스쿼트 8kg 12회 3세트, 밴드 로우 15회 3세트, 마지막에 고관절 스트레칭”</div><button className="secondary-button" onClick={() => setModal("workout-actual")}>PT 내용 기록하기</button></section>
  </div>;
}

function ChangeView({ state, setModal }: { state: AppState; setModal: (modal: Modal) => void }) {
  const latest = state.bodyRecords[0];
  const records = state.bodyRecords.slice(0, 7).reverse();
  const maxFat = Math.max(...records.map((item) => item.bodyFatMass), 1);
  return <div className="section-stack"><section className="section-hero change-hero"><div><span className="eyebrow">체성분 변화</span><h2>하루 숫자보다<br />방향을 선명하게 봐요.</h2></div><button className="primary-button" onClick={() => setModal("body")}>+ 인바디</button></section>
    <div className="metric-grid"><MetricCard label="체지방량" value={String(latest?.bodyFatMass ?? "-")} unit="kg" hint="가장 중요한 감량 지표" /><MetricCard label="골격근량" value={String(latest?.skeletalMuscle ?? "-")} unit="kg" hint="유지·증가 목표" /><MetricCard label="내장지방" value={String(latest?.visceralFat ?? "-")} unit="Lv" hint="최근 측정값" /></div>
    <section className="card chart-card"><CardTitle title="최근 체지방량" aside="7일 흐름" /><div className="bar-chart">{records.map((record) => <div key={record.id}><span style={{ height: `${Math.max(24, (record.bodyFatMass / maxFat) * 100)}%` }} /><small>{record.date.slice(5).replace("-", "/")}</small></div>)}</div><div className="chart-legend"><span>일별 측정값</span><p>측정 조건과 생리 상태가 다르면 단기 변동이 커질 수 있어요.</p></div></section>
    <section className="card"><CardTitle title="측정 기록" aside={`${state.bodyRecords.length}개`} /><div className="data-table">{state.bodyRecords.slice(0, 8).map((record) => <div key={record.id}><span><strong>{record.date}</strong><small>{record.time} · {record.condition.split(" · ")[0]}</small></span><span>{record.bodyFatMass}<small>kg 지방</small></span><span>{record.skeletalMuscle}<small>kg 골격근</small></span></div>)}</div></section>
  </div>;
}

function ConsultView({ state, commit }: { state: AppState; commit: (updater: (current: AppState) => AppState) => void }) {
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
  return <div className="section-stack"><section className="section-hero consult-hero"><div><span className="eyebrow">일요일 주간 상담</span><h2>기록을 모아보고,<br />다음 한 주를 조정해요.</h2><p>AI의 제안은 확인 후에만 실제 목표에 적용돼요.</p></div><button className="primary-button" onClick={requestReview} disabled={loading}>{loading ? "기록을 살펴보는 중…" : "✦ 상담 시작"}</button></section>
    <div className="consult-checks"><div><span>01</span><p><strong>체성분 흐름</strong>체지방량과 골격근량의 7일 평균</p></div><div><span>02</span><p><strong>식사의 균형</strong>칼로리·탄단지·당류·식이섬유</p></div><div><span>03</span><p><strong>운동 수행</strong>PT·유산소 횟수와 누적시간</p></div></div>
    <section className="card consultation-card"><CardTitle title={latest ? "최근 상담" : "첫 상담을 준비했어요"} aside={latest ? latest.date : ""} />{latest ? <><span className={`source-badge ${latest.source}`}>{latest.source === "openai" ? "ChatGPT 상담" : "AI 연결 전 미리보기"}</span><div className="consultation-text">{latest.text}</div><div className="consult-buttons"><button className="ghost-button">대화 이어가기</button><button className="primary-button">다음 주 계획하기</button></div></> : <EmptyState text="체성분·식사·운동 기록을 바탕으로 이번 주를 함께 정리해요." action="첫 상담 시작" onClick={requestReview} />}</section>
  </div>;
}

function CardTitle({ title, aside }: { title: string; aside?: React.ReactNode }) { return <div className="card-title"><h2>{title}</h2>{aside && <div>{aside}</div>}</div>; }
function RecordRow({ label, detail, done, onClick }: { label: string; detail: string; done: boolean; onClick: () => void }) { return <button className="record-row" onClick={onClick}><span className={`check ${done ? "done" : ""}`}>{done ? "✓" : ""}</span><span><strong>{label}</strong><small>{detail}</small></span><b>›</b></button>; }
function NutrientBar({ label, value, min, max, unit, tone }: { label: string; value: number; min: number; max: number; unit: string; tone: string }) { const width = Math.min(100, (value / max) * 100); return <div className="nutrient"><div><span>{label}</span><strong>{value} / {min}~{max}{unit}</strong></div><div className="nutrient-track"><i className={tone} style={{ width: `${width}%` }} /></div></div>; }
function MicroStat({ label, value, hint }: { label: string; value: string; hint: string }) { return <div className="micro-stat"><span>{label}</span><strong>{value}</strong><small>{hint}</small></div>; }
function MetricCard({ label, value, unit, hint }: { label: string; value: string; unit: string; hint: string }) { return <article className="metric-card"><span>{label}</span><strong>{value}<small>{unit}</small></strong><p>{hint}</p></article>; }
function EmptyState({ text, action, onClick }: { text: string; action: string; onClick: () => void }) { return <div className="empty-state"><span>○</span><p>{text}</p><button onClick={onClick}>{action}</button></div>; }

function Sheet({ title, subtitle, close, children }: { title: string; subtitle?: string; close: () => void; children: React.ReactNode }) { return <div className="sheet-backdrop"><section className="sheet" role="dialog" aria-modal="true"><div className="sheet-handle" /><header><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button onClick={close} aria-label="닫기">×</button></header>{children}</section></div>; }

function QuickSheet({ close, select }: { close: () => void; select: (modal: Modal) => void }) { return <Sheet title="무엇을 추가할까요?" subtitle="필요한 기록으로 바로 이동해요." close={close}><h3 className="sheet-section-title">지금 기록하기</h3><div className="quick-grid"><QuickButton icon="◇" label="인바디" onClick={() => select("body")} /><QuickButton icon="◒" label="먹은 식사" onClick={() => select("meal-actual")} /><QuickButton icon="△" label="한 운동" onClick={() => select("workout-actual")} /><QuickButton icon="○" label="생리 상태" onClick={() => select("cycle")} /></div><h3 className="sheet-section-title">미리 계획하기</h3><div className="quick-grid two"><QuickButton icon="◐" label="식사 계획" onClick={() => select("meal-plan")} /><QuickButton icon="□" label="운동 계획" onClick={() => select("workout-plan")} /></div></Sheet>; }
function QuickButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) { return <button className="quick-button" onClick={onClick}><span>{icon}</span><strong>{label}</strong></button>; }

function BodySheet({ today, latest, close, save }: { today: string; latest: BodyRecord; close: () => void; save: (event: FormEvent<HTMLFormElement>) => void }) { return <Sheet title="인바디 기록" subtitle="인바디다이얼 H30에 보이는 순서대로 입력해요." close={close}><form className="form-stack" onSubmit={save}><div className="two-fields"><Field label="측정일"><input type="date" name="date" defaultValue={today} required /></Field><Field label="측정시간"><input type="time" name="time" defaultValue={new Date().toTimeString().slice(0, 5)} required /></Field></div><MeasureField label="체중" name="weight" unit="kg" previous={latest?.weight} /><MeasureField label="골격근량" name="skeletalMuscle" unit="kg" previous={latest?.skeletalMuscle} /><MeasureField label="체지방량" name="bodyFatMass" unit="kg" previous={latest?.bodyFatMass} /><MeasureField label="체지방률" name="bodyFatRate" unit="%" previous={latest?.bodyFatRate} /><MeasureField label="내장지방레벨" name="visceralFat" unit="Lv" previous={latest?.visceralFat} step="1" /><Field label="측정 조건"><select name="condition" defaultValue="아침 공복 · InBody Dial H30"><option>아침 공복 · InBody Dial H30</option><option>평소와 다른 시간 · InBody Dial H30</option><option>식후 측정 · InBody Dial H30</option><option>운동 후 측정 · InBody Dial H30</option></select></Field><button className="primary-button submit-button" type="submit">저장하기</button></form></Sheet>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="field"><span>{label}</span>{children}</label>; }
function MeasureField({ label, name, unit, previous, step = "0.1" }: { label: string; name: string; unit: string; previous?: number; step?: string }) { return <label className="measure-field"><div><span>{label}</span>{previous !== undefined && <small>이전 측정 {previous}{unit}</small>}</div><div><input inputMode="decimal" type="number" step={step} min="0" name={name} required /><b>{unit}</b></div></label>; }

function MealSheet({ today, kind, plans, close, save }: { today: string; kind: EntryKind; plans: AppState["meals"]; close: () => void; save: (event: FormEvent<HTMLFormElement>, kind: EntryKind) => void }) { const hour = new Date().getHours(); const defaultType: MealType = hour < 10 ? "breakfast" : hour < 15 ? "lunch" : "dinner"; const plan = plans.find((item) => item.kind === "plan" && item.mealType === defaultType); return <Sheet title={kind === "plan" ? "식사 계획" : "먹은 식사 기록"} subtitle={kind === "plan" ? "음식의 종류만 가볍게 계획해요." : "계획을 불러온 뒤 실제 먹은 양에 맞게 수정해요."} close={close}><form className="form-stack" onSubmit={(event) => save(event, kind)}><div className="two-fields"><Field label="날짜"><input type="date" name="date" defaultValue={today} required /></Field><Field label="끼니"><select name="mealType" defaultValue={defaultType}>{Object.entries(mealLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field></div><Field label={kind === "plan" ? "먹고 싶은 음식" : "먹은 음식"}><textarea name="title" defaultValue={kind === "actual" ? plan?.title : ""} placeholder="예: 그릭요거트와 단백질바" required /></Field>{kind === "actual" && <><div className="macro-grid"><Field label="칼로리"><input type="number" name="calories" min="0" placeholder="kcal" /></Field><Field label="단백질"><input type="number" name="protein" min="0" step="0.1" placeholder="g" /></Field><Field label="탄수화물"><input type="number" name="carbs" min="0" step="0.1" placeholder="g" /></Field><Field label="지방"><input type="number" name="fat" min="0" step="0.1" placeholder="g" /></Field><Field label="당류"><input type="number" name="sugar" min="0" step="0.1" placeholder="g" /></Field><Field label="식이섬유"><input type="number" name="fiber" min="0" step="0.1" placeholder="g" /></Field></div><Field label="계산 신뢰도"><select name="confidence" defaultValue="추정"><option>높음</option><option>보통</option><option>추정</option><option>낮음</option></select></Field></>}<button className="primary-button submit-button" type="submit">{kind === "plan" ? "계획 저장" : "식사 기록 저장"}</button></form></Sheet>; }

function WorkoutSheet({ today, kind, planned, close, save }: { today: string; kind: EntryKind; planned?: WorkoutEntry; close: () => void; save: (event: FormEvent<HTMLFormElement>, kind: EntryKind) => void }) { return <Sheet title={kind === "plan" ? "운동 계획" : "한 운동 기록"} subtitle={kind === "actual" ? "PT는 기억나는 대로 문장으로 적어도 좋아요." : "주간 횟수와 시간을 채울 수 있게 계획해요."} close={close}><form className="form-stack" onSubmit={(event) => save(event, kind)}><div className="two-fields"><Field label="날짜"><input type="date" name="date" defaultValue={today} required /></Field><Field label="운동 종류"><select name="type" defaultValue={planned?.type ?? "유산소"}><option>PT</option><option>유산소</option><option>걷기</option><option>자전거</option><option>기타</option></select></Field></div><Field label="운동 이름"><input name="title" defaultValue={kind === "actual" ? planned?.title : ""} placeholder="예: 인클라인 트레드밀" required /></Field><div className="two-fields"><Field label="시간"><input type="number" name="minutes" defaultValue={kind === "actual" ? planned?.minutes : ""} min="1" placeholder="분" required /></Field><Field label="강도"><input name="intensity" defaultValue={kind === "actual" ? planned?.intensity : ""} placeholder="예: 심박수 130~140" /></Field></div><Field label="운동 내용"><textarea name="details" defaultValue={kind === "actual" ? planned?.details : ""} placeholder="종목, 중량, 횟수, 세트 또는 컨디션을 적어주세요." /></Field><button className="primary-button submit-button" type="submit">{kind === "plan" ? "운동 계획 저장" : "운동 기록 저장"}</button></form></Sheet>; }

function CycleSheet({ today, close, save }: { today: string; close: () => void; save: (event: FormEvent<HTMLFormElement>) => void }) { return <Sheet title="생리 상태 기록" subtitle="첫 버전에서는 체성분 해석에 필요한 상태만 간단히 남겨요." close={close}><form className="form-stack" onSubmit={save}><Field label="날짜"><input type="date" name="date" defaultValue={today} required /></Field><Field label="오늘 상태"><select name="state"><option>없음</option><option>갈색 출혈</option><option>본 출혈</option><option>부정출혈</option></select></Field><Field label="메모 · 선택"><textarea name="note" placeholder="평소와 다른 점이 있다면 적어주세요." /></Field><button className="primary-button submit-button" type="submit">상태 저장</button></form></Sheet>; }
