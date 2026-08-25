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
  kind: EntryKind;
  type: "PT" | "유산소";
  title: string;
  minutes: number;
  intensity: number | string;
  heartRate?: string;
  overlapsSteps?: boolean;
  details: string;
};

export type CycleEntry = {
  id: string;
  date: string;
  state: "없음" | "갈색 출혈" | "본 출혈" | "부정출혈";
  note: string;
};

export type Consultation = {
  id: string;
  date: string;
  text: string;
  source: "openai" | "preview";
};

export type AppState = {
  profile: {
    mode: "감량기" | "유지기";
    goalWeek: number;
    goalEndDate: string;
    targetBodyFatChange: number;
    targetMuscleChange: number;
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
  foodLibrary?: FoodLibraryItem[];
  meals: MealEntry[];
  workouts: WorkoutEntry[];
  cycles: CycleEntry[];
  consultations: Consultation[];
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
    mode: "감량기",
    goalWeek: 1,
    goalEndDate: "2026-10-25",
    targetBodyFatChange: -2.5,
    targetMuscleChange: 0.3,
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
  bodyRecords: [
    { id: "body-20260814", date: "2026-08-14", time: "09:06", weight: 61.9, skeletalMuscle: 23.3, bodyFatMass: 18.9, bodyFatRate: 30.5, visceralFat: 8, measurementTiming: "아침 공복", device: "InBody Dial H30", condition: "아침 공복 · InBody Dial H30" },
    { id: "body-20260813", date: "2026-08-13", time: "07:21", weight: 61.8, skeletalMuscle: 23.3, bodyFatMass: 18.8, bodyFatRate: 30.4, visceralFat: 8, measurementTiming: "아침 공복", device: "InBody Dial H30", condition: "아침 공복 · InBody Dial H30" },
    { id: "body-20260812", date: "2026-08-12", time: "07:18", weight: 62.0, skeletalMuscle: 23.2, bodyFatMass: 19.0, bodyFatRate: 30.6, visceralFat: 8, measurementTiming: "아침 공복", device: "InBody Dial H30", condition: "아침 공복 · InBody Dial H30" },
  ],
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
  cycles: [],
  consultations: [],
  skippedTasks: [],
};
