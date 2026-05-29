import { NextRequest, NextResponse } from "next/server";
import { ensureSchema } from "@/src/db/migrate";
import { db } from "@/src/db";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  ensureSchema();
  const { id } = await ctx.params;
  const n = Number(id);
  if (!Number.isFinite(n))
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  const rows = db
    .prepare(
      `SELECT id, role, content, citations_json, created_at FROM chat_messages WHERE thread_id=? ORDER BY created_at ASC`,
    )
    .all(n) as Array<{
    id: number;
    role: "user" | "assistant";
    content: string;
    citations_json: string | null;
    created_at: number;
  }>;
  return NextResponse.json({
    messages: rows.map((r) => ({
      ...r,
      citations: r.citations_json ? JSON.parse(r.citations_json) : [],
    })),
  });
}
