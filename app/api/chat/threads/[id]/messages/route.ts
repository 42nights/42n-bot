import { NextRequest, NextResponse } from "next/server";
import { listChatMessages } from "@/src/db/ops/chat";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const rows = await listChatMessages(id);
  return NextResponse.json({
    messages: rows.map((r) => ({
      ...r,
      citations: r.citations_json ? JSON.parse(r.citations_json) : [],
    })),
  });
}
