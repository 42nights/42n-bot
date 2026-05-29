import { NextRequest, NextResponse } from "next/server";
import { ensureSchema } from "@/src/db/migrate";
import { db } from "@/src/db";
import { answerChat } from "@/src/chat/answer";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  ensureSchema();
  const body = (await req.json().catch(() => ({}))) as {
    threadId?: number | null;
    message?: string;
  };
  const message = (body.message ?? "").trim();
  if (!message) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }
  if (message.length > 4000) {
    return NextResponse.json({ error: "message too long" }, { status: 400 });
  }

  let threadId = body.threadId ?? null;
  if (!threadId) {
    const info = db
      .prepare(
        `INSERT INTO chat_threads (title, created_at, updated_at) VALUES (?, ?, ?)`,
      )
      .run(message.slice(0, 80), Date.now(), Date.now());
    threadId = Number(info.lastInsertRowid);
  } else {
    const t = db
      .prepare(`SELECT id FROM chat_threads WHERE id = ?`)
      .get(threadId);
    if (!t) {
      return NextResponse.json({ error: "thread not found" }, { status: 404 });
    }
    db.prepare(`UPDATE chat_threads SET updated_at=? WHERE id=?`).run(
      Date.now(),
      threadId,
    );
  }

  db.prepare(
    `INSERT INTO chat_messages (thread_id, role, content, created_at) VALUES (?, 'user', ?, ?)`,
  ).run(threadId, message, Date.now());

  const result = await answerChat(message);

  db.prepare(
    `INSERT INTO chat_messages (thread_id, role, content, citations_json, created_at) VALUES (?, 'assistant', ?, ?, ?)`,
  ).run(
    threadId,
    result.answer,
    JSON.stringify(result.citations),
    Date.now(),
  );

  return NextResponse.json({
    threadId,
    answer: result.answer,
    citations: result.citations,
  });
}
