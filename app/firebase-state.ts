"use client";

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { createFreshState, type AppState } from "./data";
import { firebaseDb } from "./firebase-client";

type RecordKey =
  | "bodyRecords"
  | "circumferenceRecords"
  | "foodLibrary"
  | "meals"
  | "workouts"
  | "dailyActivities"
  | "cycles"
  | "consultations"
  | "weeklyReviews";

const recordKeys: RecordKey[] = [
  "bodyRecords",
  "circumferenceRecords",
  "foodLibrary",
  "meals",
  "workouts",
  "dailyActivities",
  "cycles",
  "consultations",
  "weeklyReviews",
];

const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function coreState(state: AppState) {
  return clean({
    profile: state.profile,
    nutritionGoal: state.nutritionGoal,
    workoutGoal: state.workoutGoal,
    reminderSettings: state.reminderSettings,
    skippedTasks: state.skippedTasks,
    lastBackupAt: state.lastBackupAt,
  });
}

export async function loadUserState(uid: string): Promise<AppState> {
  const db = firebaseDb();
  const core = await getDoc(doc(db, "users", uid, "settings", "app"));
  if (!core.exists()) return createFreshState();

  const snapshots = await Promise.all(
    recordKeys.map((key) => getDocs(collection(db, "users", uid, key))),
  );
  const records = Object.fromEntries(recordKeys.map((key, index) => [
    key,
    snapshots[index].docs.map((entry) => entry.data()),
  ]));

  return {
    ...createFreshState(),
    ...clean(core.data()),
    ...records,
  } as AppState;
}

function same(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export async function saveUserState(uid: string, next: AppState, previous?: AppState) {
  const db = firebaseDb();
  await setDoc(doc(db, "users", uid), {
    updatedAt: serverTimestamp(),
  }, { merge: true });
  await setDoc(doc(db, "users", uid, "settings", "app"), {
    ...coreState(next),
    updatedAt: serverTimestamp(),
  });

  const operations: Array<
    | { kind: "set"; path: ReturnType<typeof doc>; value: object }
    | { kind: "delete"; path: ReturnType<typeof doc> }
  > = [];

  for (const key of recordKeys) {
    const before = new Map(((previous?.[key] ?? []) as Array<{ id: string }>).map((item) => [item.id, item]));
    const after = new Map(((next[key] ?? []) as Array<{ id: string }>).map((item) => [item.id, item]));
    for (const [id, value] of after) {
      if (!same(value, before.get(id))) {
        operations.push({ kind: "set", path: doc(db, "users", uid, key, id), value: clean(value) });
      }
    }
    for (const id of before.keys()) {
      if (!after.has(id)) operations.push({ kind: "delete", path: doc(db, "users", uid, key, id) });
    }
  }

  for (let index = 0; index < operations.length; index += 450) {
    const batch = writeBatch(db);
    for (const operation of operations.slice(index, index + 450)) {
      if (operation.kind === "set") batch.set(operation.path, operation.value);
      else batch.delete(operation.path);
    }
    await batch.commit();
  }
}

export async function deleteAllUserData(uid: string) {
  const db = firebaseDb();
  for (const key of recordKeys) {
    const snapshot = await getDocs(collection(db, "users", uid, key));
    for (const entry of snapshot.docs) await deleteDoc(entry.ref);
  }
  await deleteDoc(doc(db, "users", uid, "settings", "app"));
}
