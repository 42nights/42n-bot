import { NextResponse } from "next/server";
import { listChatThreads, createChatThread } from "@/src/db/ops/chat";

export const runtime = "nodejs";

export async function GET() {
  const threads = await listChatThreads();
  return NextResponse.json({ threads });
}

export async function POST() {
  const threadId = await createChatThread("New chat");
  return NextResponse.json({ threadId });
}
