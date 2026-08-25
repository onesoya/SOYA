"use client";

import { getFunctions, httpsCallable } from "firebase/functions";
import { firebaseApp } from "./firebase-client";

export type AppleHealthConnectionStatus = {
  connected: boolean;
  createdAt?: string;
  lastImportAt?: string;
  lastImportDate?: string;
};

export type AppleHealthConnectionKey = {
  token: string;
  endpoint: string;
  createdAt: string;
};

const healthFunctions = () => getFunctions(firebaseApp(), "asia-northeast3");

export async function getAppleHealthConnectionStatus() {
  const callable = httpsCallable<Record<string, never>, AppleHealthConnectionStatus>(healthFunctions(), "getAppleHealthConnectionStatus");
  return (await callable({})).data;
}

export async function createAppleHealthConnectionKey() {
  const callable = httpsCallable<Record<string, never>, AppleHealthConnectionKey>(healthFunctions(), "createAppleHealthConnectionKey");
  return (await callable({})).data;
}

export async function revokeAppleHealthConnection() {
  const callable = httpsCallable<Record<string, never>, { revoked: true }>(healthFunctions(), "revokeAppleHealthConnection");
  return (await callable({})).data;
}
