import { NextRequest, NextResponse } from "next/server";
import { answerChat } from "@/src/chat/answer";
import {
  createChatThread,
  getChatThread,
  touchChatThread,
  insertChatMessage,
} from "@/src/db/ops/chat";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    threadId?: string | null;
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
    threadId = await createChatThread(message.slice(0, 80));
  } else {
    const t = await getChatThread(threadId);
    if (!t) {
      return NextResponse.json({ error: "thread not found" }, { status: 404 });
    }
    await touchChatThread(threadId);
  }

  await insertChatMessage({ thread_id: threadId, role: "user", content: message });

  const result = await answerChat(message);

  await insertChatMessage({
    thread_id: threadId,
    role: "assistant",
    content: result.answer,
    citations_json: JSON.stringify(result.citations),
  });

  return NextResponse.json({
    threadId,
    answer: result.answer,
    citations: result.citations,
  });
}
