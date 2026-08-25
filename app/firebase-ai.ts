"use client";

import { getFunctions, httpsCallable } from "firebase/functions";
import { firebaseApp } from "./firebase-client";

export type AiConsultationResult = {
  text: string;
  source: "openai";
  model: string;
  reasoningEffort: "high";
  used: number;
  limit: number;
  inputTokens: number;
  outputTokens: number;
};

type WeeklyRequest = { kind: "weekly"; week: unknown };
type FollowUpRequest = { kind: "followup"; question: string; previousConsultation: string };

export async function requestAiConsultation(payload: WeeklyRequest | FollowUpRequest) {
  const functions = getFunctions(firebaseApp(), "asia-northeast3");
  const callable = httpsCallable<WeeklyRequest | FollowUpRequest, AiConsultationResult>(functions, "createWeeklyConsultation");
  const response = await callable(payload);
  return response.data;
}
