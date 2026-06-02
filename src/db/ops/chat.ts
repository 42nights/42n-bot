import { convex, api } from "../convex-client";
import type { Id } from "../../../convex/_generated/dataModel";

export type ChatThreadRow = {
  _id: string;
  title: string;
  created_at: number;
  updated_at: number;
};

export type ChatMessageRow = {
  _id: string;
  thread_id: string;
  role: string;
  content: string;
  citations_json?: string;
  created_at: number;
};

export async function listChatThreads(): Promise<ChatThreadRow[]> {
  const rows = await convex.query(api.chat.listThreads, {});
  return rows as ChatThreadRow[];
}

export async function createChatThread(title: string): Promise<string> {
  const now = Date.now();
  return convex.mutation(api.chat.createThread, {
    title,
    created_at: now,
    updated_at: now,
  }) as Promise<string>;
}

export async function getChatThread(id: string): Promise<ChatThreadRow | null> {
  const row = await convex.query(api.chat.getThread, {
    id: id as Id<"chat_threads">,
  });
  return (row as ChatThreadRow | null) ?? null;
}

export async function touchChatThread(id: string): Promise<void> {
  await convex.mutation(api.chat.touchThread, {
    id: id as Id<"chat_threads">,
    updated_at: Date.now(),
  });
}

export async function listChatMessages(
  thread_id: string,
): Promise<ChatMessageRow[]> {
  const rows = await convex.query(api.chat.listMessages, {
    thread_id: thread_id as Id<"chat_threads">,
  });
  return rows as ChatMessageRow[];
}

export async function insertChatMessage(args: {
  thread_id: string;
  role: string;
  content: string;
  citations_json?: string | null;
}): Promise<void> {
  await convex.mutation(api.chat.insertMessage, {
    thread_id: args.thread_id as Id<"chat_threads">,
    role: args.role,
    content: args.content,
    citations_json: args.citations_json ?? undefined,
    created_at: Date.now(),
  });
}
