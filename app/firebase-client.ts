"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithRedirect,
  signOut,
  type User,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

export const firebaseConfig = {
  apiKey: "AIzaSyCVkyfh8kNeoiqIuFp3rZu4wl01L6R_os0",
  authDomain: "soya-e12cd.firebaseapp.com",
  projectId: "soya-e12cd",
  storageBucket: "soya-e12cd.firebasestorage.app",
  messagingSenderId: "641439217344",
  appId: "1:641439217344:web:5f16c3cab445dbe2c8df25",
  measurementId: "G-42P9BCZPQL",
};

export const firebaseApp = () => getApps().length ? getApp() : initializeApp(firebaseConfig);
export const firebaseAuth = () => getAuth(firebaseApp());
export const firebaseDb = () => getFirestore(firebaseApp());

export function observeGoogleUser(callback: (user: User | null) => void) {
  return onAuthStateChanged(firebaseAuth(), callback);
}

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  await signInWithRedirect(firebaseAuth(), provider);
}

export async function signOutGoogleUser() {
  await signOut(firebaseAuth());
}

export type { User };
