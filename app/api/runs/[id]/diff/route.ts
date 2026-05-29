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
  const row = db
    .prepare(
      `SELECT content FROM artifacts WHERE run_id = ? AND kind = 'diff' ORDER BY id DESC LIMIT 1`,
    )
    .get(n) as { content: string } | undefined;
  if (!row) return NextResponse.json({ diff: "" });
  return NextResponse.json({ diff: row.content });
}
