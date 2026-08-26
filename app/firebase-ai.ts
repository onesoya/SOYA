"use client";

import { getFunctions, httpsCallable } from "firebase/functions";
import { firebaseApp } from "./firebase-client";
import type { ConsultationPlanSuggestion } from "./data";

export type AiConsultationResult = {
  text: string;
  source: "openai";
  model: string;
  reasoningEffort: "high";
  used: number;
  limit: number;
  inputTokens: number;
  outputTokens: number;
  remaining: number;
  estimatedUsd: number;
  krwReferenceRate: number;
  planSuggestions?: ConsultationPlanSuggestion[];
};

export type AiUsageSummary = {
  month: string;
  used: number;
  limit: number;
  remaining: number;
  inputTokens: number;
  outputTokens: number;
  estimatedUsd: number;
  krwReferenceRate: number;
};

export type AiBodyImportRecord = {
  date: string;
  time?: string;
  weight: number;
  skeletalMuscle: number;
  bodyFatMass: number;
  bodyFatRate: number;
  visceralFat: number;
  confidence: number;
};

export type AiBodyImportResult = {
  records: AiBodyImportRecord[];
  warnings: string[];
};

type WeeklySummaryRequest = { kind: "weekly-summary"; week: unknown };
type WeeklyPlanRequest = { kind: "weekly-plan"; week: unknown; summary: string; userResponse: string };
type FollowUpRequest = { kind: "followup"; question: string; previousConsultation: string };

type AiConsultationRequest = WeeklySummaryRequest | WeeklyPlanRequest | FollowUpRequest;

export async function requestAiConsultation(payload: AiConsultationRequest) {
  const functions = getFunctions(firebaseApp(), "asia-northeast3");
  const callable = httpsCallable<AiConsultationRequest, AiConsultationResult>(functions, "createWeeklyConsultation");
  const response = await callable(payload);
  return response.data;
}

export async function requestAiUsageSummary() {
  const functions = getFunctions(firebaseApp(), "asia-northeast3");
  const callable = httpsCallable<Record<string, never>, AiUsageSummary>(functions, "getAiUsageSummary");
  const response = await callable({});
  return response.data;
}

export async function requestAiBodyImport(images: string[]) {
  const functions = getFunctions(firebaseApp(), "asia-northeast3");
  const callable = httpsCallable<{ images: string[] }, AiBodyImportResult>(functions, "extractInBodyRecords");
  const response = await callable({ images });
  return response.data;
}
