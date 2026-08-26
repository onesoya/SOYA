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
  | "loveRecords"
  | "consultations"
  | "weeklyReviews";

const recordKeys = [
  "bodyRecords",
  "circumferenceRecords",
  "foodLibrary",
  "meals",
  "workouts",
  "dailyActivities",
  "cycles",
  "loveRecords",
  "consultations",
  "weeklyReviews",
] as const satisfies readonly RecordKey[];

const coreKeys = [
  "profile",
  "nutritionGoal",
  "workoutGoal",
  "reminderSettings",
  "skippedTasks",
  "lastBackupAt",
] as const satisfies readonly (keyof AppState)[];

type StoredStateKey = typeof recordKeys[number] | typeof coreKeys[number];
type AssertAllStateKeysAreStored<T extends never> = T;
type AppStateStorageCoverage = AssertAllStateKeysAreStored<Exclude<keyof AppState, StoredStateKey>>;
const appStateStorageCoverage: AppStateStorageCoverage | true = true;
void appStateStorageCoverage;

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

  const coreData = clean(core.data()) as Partial<AppState>;

  const snapshots = await Promise.all(
    recordKeys.map((key) => getDocs(collection(db, "users", uid, key))),
  );
  const records = Object.fromEntries(recordKeys.map((key, index) => [
    key,
    snapshots[index].docs.length
      ? snapshots[index].docs.map((entry) => entry.data())
      : key === "loveRecords" && Array.isArray(coreData.loveRecords)
        ? coreData.loveRecords
        : [],
  ]));

  const loveSnapshot = snapshots[recordKeys.indexOf("loveRecords")];
  const legacyLoveRecords = !loveSnapshot.docs.length && Array.isArray(coreData.loveRecords)
    ? coreData.loveRecords
    : [];
  for (let index = 0; index < legacyLoveRecords.length; index += 450) {
    const batch = writeBatch(db);
    for (const entry of legacyLoveRecords.slice(index, index + 450)) {
      batch.set(doc(db, "users", uid, "loveRecords", entry.id), clean(entry));
    }
    await batch.commit();
  }

  return {
    ...createFreshState(),
    ...coreData,
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
