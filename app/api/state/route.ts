import { getChatGPTUser } from "../../chatgpt-auth";
import { readState, writeState } from "../../../db/state-store";
import { initialState } from "../../data";

export const dynamic = "force-dynamic";

async function userKey() {
  const user = await getChatGPTUser();
  return user?.userId ?? "local-preview";
}

export async function GET() {
  try {
    const row = await readState(await userKey());
    return Response.json({ state: row ? JSON.parse(row.state_json) : initialState });
  } catch {
    return Response.json({ state: initialState, preview: true });
  }
}

export async function PUT(request: Request) {
  const state = await request.json();
  const serialized = JSON.stringify(state);
  if (serialized.length > 1_500_000) {
    return Response.json({ error: "저장할 기록이 너무 큽니다." }, { status: 413 });
  }
  try {
    const updatedAt = await writeState(await userKey(), serialized);
    return Response.json({ ok: true, updatedAt });
  } catch {
    return Response.json({ error: "기록을 저장하지 못했습니다." }, { status: 503 });
  }
}
