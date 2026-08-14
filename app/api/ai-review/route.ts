import type { AppState } from "../../data";

function previewReview(state: AppState) {
  const latest = state.bodyRecords[0];
  const actualMeals = state.meals.filter((meal) => meal.kind === "actual" && !meal.skipped);
  const protein = actualMeals.reduce((sum, meal) => sum + meal.protein, 0);
  const fiber = actualMeals.reduce((sum, meal) => sum + meal.fiber, 0);
  return `이번 주 기록을 살펴보면 체지방량 ${latest?.bodyFatMass ?? "-"}kg, 골격근량 ${latest?.skeletalMuscle ?? "-"}kg에서 시작하고 있어요. 지금까지 기록된 식사 기준으로 단백질은 ${protein}g, 식이섬유는 ${fiber}g이에요. 남은 식사에서는 단백질이 포함된 주식과 채소를 함께 챙기고, 계획한 유산소는 컨디션에 맞춰 25~40분 안에서 진행해보세요. 하루 수치보다 7일 평균의 방향을 중심으로 판단하는 것이 좋아요.\n\nOpenAI API 키를 연결하면 실제 7일 기록 전체를 바탕으로 더 구체적인 주간 상담을 받을 수 있어요.`;
}

type OpenAIResponse = {
  output_text?: unknown;
  output?: Array<{ content?: Array<{ type?: string; text?: unknown }> }>;
};

function extractOutputText(data: OpenAIResponse): string {
  if (typeof data.output_text === "string") return data.output_text;
  return (data.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text")
    .map((item) => typeof item.text === "string" ? item.text : "")
    .join("\n");
}

export async function POST(request: Request) {
  const state = (await request.json()) as AppState;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ text: previewReview(state), source: "preview" });

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-5-mini",
      input: [
        {
          role: "system",
          content: "당신은 사용자의 체성분 감량 계획을 돕는 신중한 주간 코치입니다. 의학적 진단을 하지 말고, 기록에서 관찰되는 사실과 불확실성을 구분하세요. 체중보다 체지방량 감소와 골격근량 유지·증가를 우선하며, 당류와 식이섬유를 반드시 함께 검토하세요. 생리 상태가 있으면 단기 수분 변동 가능성을 고려하되 단정하지 마세요. 잘된 점, 조정할 점, 다음 주 행동 3가지를 자연스러운 한국어로 작성하세요.",
        },
        { role: "user", content: JSON.stringify(state) },
      ],
      text: { verbosity: "medium" },
    }),
  });

  if (!response.ok) return Response.json({ text: previewReview(state), source: "preview" });
  const data = await response.json() as OpenAIResponse;
  return Response.json({ text: extractOutputText(data) || previewReview(state), source: "openai" });
}
