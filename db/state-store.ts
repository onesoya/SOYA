import { env } from "cloudflare:workers";

let initialized = false;

async function ensureTable() {
  if (initialized) return;
  if (!env.DB) throw new Error("DB binding is unavailable");
  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS app_state (
      user_id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `).run();
  initialized = true;
}

export async function readState(userId: string) {
  await ensureTable();
  return env.DB.prepare("SELECT state_json FROM app_state WHERE user_id = ?")
    .bind(userId)
    .first<{ state_json: string }>();
}

export async function writeState(userId: string, stateJson: string) {
  await ensureTable();
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO app_state (user_id, state_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      state_json = excluded.state_json,
      updated_at = excluded.updated_at
  `).bind(userId, stateJson, now).run();
  return now;
}
