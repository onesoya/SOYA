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

type WeeklyRequest = { kind: "weekly"; week: unknown };
type FollowUpRequest = { kind: "followup"; question: string; previousConsultation: string };

export async function requestAiConsultation(payload: WeeklyRequest | FollowUpRequest) {
  const functions = getFunctions(firebaseApp(), "asia-northeast3");
  const callable = httpsCallable<WeeklyRequest | FollowUpRequest, AiConsultationResult>(functions, "createWeeklyConsultation");
  const response = await callable(payload);
  return response.data;
}

export async function requestAiUsageSummary() {
  const functions = getFunctions(firebaseApp(), "asia-northeast3");
  const callable = httpsCallable<Record<string, never>, AiUsageSummary>(functions, "getAiUsageSummary");
  const response = await callable({});
  return response.data;
}
