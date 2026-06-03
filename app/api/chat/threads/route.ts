import { NextResponse } from "next/server";
import { listChatThreads, createChatThread } from "@/src/db/ops/chat";
import { withIds } from "@/src/db/serialize";

export const runtime = "nodejs";

export async function GET() {
  const threads = await listChatThreads();
  return NextResponse.json({ threads: withIds(threads) });
}

export async function POST() {
  const threadId = await createChatThread("New chat");
  return NextResponse.json({ threadId });
}
