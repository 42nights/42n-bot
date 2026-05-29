import { NextResponse } from "next/server";
import { ensureSchema } from "@/src/db/migrate";
import { db } from "@/src/db";

export const runtime = "nodejs";

export async function GET() {
  ensureSchema();
  const threads = db
    .prepare(`SELECT id, title, created_at, updated_at FROM chat_threads ORDER BY updated_at DESC LIMIT 50`)
    .all();
  return NextResponse.json({ threads });
}

export async function POST() {
  ensureSchema();
  const info = db
    .prepare(
      `INSERT INTO chat_threads (title, created_at, updated_at) VALUES ('New chat', ?, ?)`,
    )
    .run(Date.now(), Date.now());
  return NextResponse.json({ threadId: Number(info.lastInsertRowid) });
}
