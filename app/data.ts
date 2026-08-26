export type MealType = "breakfast" | "lunch" | "dinner" | "snack";
export type EntryKind = "plan" | "actual";
export type FoodUnit = "g" | "kg" | "개" | "인분";

export type FoodSetComponent = {
  foodId: string;
  amount: number;
};

export type FoodLibraryItem = {
  id: string;
  name: string;
  kind?: "food" | "set";
  baseAmount?: number;
  unit?: FoodUnit;
  components?: FoodSetComponent[];
  servingLabel?: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  sugar: number;
  fiber: number;
  dataSource?: "mfds" | "manual";
  sourceCode?: string;
  category?: "product" | "measured_recipe" | "saved_recipe" | "general" | "restaurant";
  confidence?: "높음" | "보통" | "추정" | "낮음";
};

export type MealFoodComponent = {
  id: string;
  foodLibraryId?: string;
  dataSource?: "mfds" | "manual";
  sourceCode?: string;
  name: string;
  quantity?: number;
  unit?: FoodUnit;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  sugar: number;
  fiber: number;
};

export type BodyRecord = {
  id: string;
  date: string;
  time: string;
  weight: number;
  skeletalMuscle: number;
  bodyFatMass: number;
  bodyFatRate: number;
  visceralFat: number;
  condition: string;
  measurementTiming?: string;
  device?: string;
};

export type CircumferenceRecord = {
  id: string;
  date: string;
  waistIn: number;
  hipIn: number;
  note?: string;
};

export type MealEntry = {
  id: string;
  date: string;
  mealType: MealType;
  kind: EntryKind;
  title: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  sugar: number;
  fiber: number;
  confidence?: "높음" | "보통" | "추정" | "낮음";
  foodLibraryId?: string;
  servings?: number;
  quantity?: number;
  servingLabel?: string;
  components?: MealFoodComponent[];
  skipped?: boolean;
};

export type WorkoutEntry = {
  id: string;
  date: string;
  startTime?: string;
  kind: EntryKind;
  type: "PT" | "유산소";
  title: string;
  minutes: number;
  intensity: number | string;
  heartRate?: string;
  overlapsSteps?: boolean;
  details: string;
  source?: "manual" | "apple_health";
  externalId?: string;
  importedAt?: string;
};

export type DailyActivity = {
  id: string;
  date: string;
  watchWorn: boolean;
  steps: number;
  activeCalories?: number;
  note?: string;
  source?: "manual" | "apple_health";
  importedAt?: string;
};

export type CycleEntry = {
  id: string;
  date: string;
  state: "없음" | "갈색 출혈" | "본 출혈" | "부정출혈";
  flow?: "없음" | "소량" | "보통" | "많음";
  pain?: "없음" | "약함" | "보통" | "심함";
  energy?: number;
  appetite?: number;
  symptoms?: string[];
  sexCount?: number;
  contraception?: "해당 없음" | "피임함" | "피임하지 않음";
  note: string;
  source?: "period-fill";
  periodId?: string;
};

export type LoveRecord = {
  id: string;
  date: string;
  count: number;
  contraception: "피임함" | "피임하지 않음";
  note?: string;
};

export type Consultation = {
  id: string;
  date: string;
  weekStart?: string;
  weekEnd?: string;
  text: string;
  source: "openai" | "preview";
  model?: string;
};

export type WeeklyReview = {
  id: string;
  weekStart: string;
  note: string;
  updatedAt: string;
};

export type TravelLevel = "가볍게 기록" | "균형 유지" | "목표 유지";

export type ReminderSettings = {
  bodyEnabled: boolean;
  bodyTime: string;
  mealEnabled: Record<MealType, boolean>;
  mealTimes: Record<MealType, string>;
  workoutEnabled: boolean;
  workoutTime: string;
  workoutLeadMinutes: number;
  weeklyEnabled: boolean;
  weeklyDay: number;
  weeklyTime: string;
  cycleEnabled: boolean;
  cycleTime: string;
  travelBehavior: "기본 유지" | "핵심만" | "모두 끄기";
};

export type AppState = {
  lastBackupAt?: string;
  profile: {
    nickname?: string;
    mode: "감량기" | "유지기";
    goalWeek: number;
    goalStartDate?: string;
    goalEndDate: string;
    targetBodyFatChange: number;
    targetMuscleChange: number;
    travelActive?: boolean;
    travelStartDate?: string;
    travelEndDate?: string;
    travelLevel?: TravelLevel;
    travelDailyLevels?: Record<string, TravelLevel>;
    birthDate?: string;
    heightCm?: number;
    sex?: "여성" | "남성" | "기타";
  };
  nutritionGoal: {
    caloriesMin: number;
    caloriesMax: number;
    proteinMin: number;
    proteinMax: number;
    carbsMin: number;
    carbsMax: number;
    fatMin: number;
    fatMax: number;
    sugarMax: number;
    fiberMin: number;
  };
  workoutGoal?: {
    cardioSessions: number;
    cardioMinutes: number;
  };
  bodyRecords: BodyRecord[];
  circumferenceRecords?: CircumferenceRecord[];
  foodLibrary?: FoodLibraryItem[];
  meals: MealEntry[];
  workouts: WorkoutEntry[];
  dailyActivities?: DailyActivity[];
  cycles: CycleEntry[];
  loveRecords?: LoveRecord[];
  consultations: Consultation[];
  weeklyReviews?: WeeklyReview[];
  reminderSettings?: ReminderSettings;
  skippedTasks: string[];
};

export const mealLabels: Record<MealType, string> = {
  breakfast: "아침",
  lunch: "점심",
  dinner: "저녁",
  snack: "간식",
};

export const initialState: AppState = {
  profile: {
    nickname: "소야",
    mode: "감량기",
    goalWeek: 1,
    goalStartDate: "2026-08-14",
    goalEndDate: "2026-10-25",
    targetBodyFatChange: -2.5,
    targetMuscleChange: 0.3,
    travelActive: false,
    travelDailyLevels: {},
    birthDate: "1998-04-15",
    heightCm: 171,
    sex: "여성",
  },
  nutritionGoal: {
    caloriesMin: 1650,
    caloriesMax: 1800,
    proteinMin: 100,
    proteinMax: 115,
    carbsMin: 180,
    carbsMax: 220,
    fatMin: 45,
    fatMax: 60,
    sugarMax: 50,
    fiberMin: 25,
  },
  workoutGoal: {
    cardioSessions: 2,
    cardioMinutes: 90,
  },
  reminderSettings: {
    bodyEnabled: true,
    bodyTime: "07:00",
    mealEnabled: { breakfast: true, lunch: true, dinner: true, snack: false },
    mealTimes: { breakfast: "07:30", lunch: "12:00", dinner: "18:00", snack: "15:00" },
    workoutEnabled: true,
    workoutTime: "19:00",
    workoutLeadMinutes: 30,
    weeklyEnabled: true,
    weeklyDay: 0,
    weeklyTime: "10:00",
    cycleEnabled: true,
    cycleTime: "09:00",
    travelBehavior: "핵심만",
  },
  bodyRecords: [
    { id: "body-20260814", date: "2026-08-14", time: "09:06", weight: 61.9, skeletalMuscle: 23.3, bodyFatMass: 18.9, bodyFatRate: 30.5, visceralFat: 8, measurementTiming: "아침 공복", device: "InBody Dial H30", condition: "아침 공복 · InBody Dial H30" },
    { id: "body-20260813", date: "2026-08-13", time: "07:21", weight: 61.8, skeletalMuscle: 23.3, bodyFatMass: 18.8, bodyFatRate: 30.4, visceralFat: 8, measurementTiming: "아침 공복", device: "InBody Dial H30", condition: "아침 공복 · InBody Dial H30" },
    { id: "body-20260812", date: "2026-08-12", time: "07:18", weight: 62.0, skeletalMuscle: 23.2, bodyFatMass: 19.0, bodyFatRate: 30.6, visceralFat: 8, measurementTiming: "아침 공복", device: "InBody Dial H30", condition: "아침 공복 · InBody Dial H30" },
  ],
  circumferenceRecords: [],
  foodLibrary: [],
  meals: [
    { id: "plan-b", date: "2026-08-14", mealType: "breakfast", kind: "plan", title: "무가당 그릭요거트와 단백질바", calories: 0, protein: 0, carbs: 0, fat: 0, sugar: 0, fiber: 0, confidence: "높음" },
    { id: "actual-b", date: "2026-08-14", mealType: "breakfast", kind: "actual", title: "무가당 그릭요거트 200g, 단백질바", calories: 365, protein: 31, carbs: 34, fat: 12, sugar: 10, fiber: 7, confidence: "높음" },
    { id: "plan-l", date: "2026-08-14", mealType: "lunch", kind: "plan", title: "달걀샌드위치", calories: 0, protein: 0, carbs: 0, fat: 0, sugar: 0, fiber: 0, confidence: "추정" },
    { id: "plan-d", date: "2026-08-14", mealType: "dinner", kind: "plan", title: "불고기 샐러드", calories: 0, protein: 0, carbs: 0, fat: 0, sugar: 0, fiber: 0, confidence: "추정" },
  ],
  workouts: [
    { id: "workout-plan", date: "2026-08-14", kind: "plan", type: "유산소", title: "인클라인 트레드밀", minutes: 35, intensity: 6, heartRate: "130~140", overlapsSteps: true, details: "컨디션에 따라 25~40분" },
  ],
  dailyActivities: [],
  cycles: [],
  loveRecords: [],
  consultations: [],
  weeklyReviews: [],
  skippedTasks: [],
};

/**
 * A new Firebase account starts with the user's defaults, but never with the
 * sample records used while the SOYA interface was being designed.
 */
export function createFreshState(): AppState {
  return {
    ...initialState,
    profile: { ...initialState.profile, travelDailyLevels: {} },
    nutritionGoal: { ...initialState.nutritionGoal },
    workoutGoal: initialState.workoutGoal ? { ...initialState.workoutGoal } : undefined,
    reminderSettings: initialState.reminderSettings
      ? {
          ...initialState.reminderSettings,
          mealEnabled: { ...initialState.reminderSettings.mealEnabled },
          mealTimes: { ...initialState.reminderSettings.mealTimes },
        }
      : undefined,
    bodyRecords: [],
    circumferenceRecords: [],
    foodLibrary: [],
    meals: [],
    workouts: [],
    dailyActivities: [],
    cycles: [],
    loveRecords: [],
    consultations: [],
    weeklyReviews: [],
    skippedTasks: [],
    lastBackupAt: undefined,
  };
}
