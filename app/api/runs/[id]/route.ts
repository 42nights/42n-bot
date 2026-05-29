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
  const run = db.prepare(`SELECT * FROM runs WHERE id = ?`).get(n);
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  const events = db
    .prepare(`SELECT * FROM events WHERE run_id = ? ORDER BY id ASC`)
    .all(n);
  const verdicts = db
    .prepare(`SELECT * FROM verdicts WHERE run_id = ? ORDER BY attempt ASC`)
    .all(n);
  const artifacts = db
    .prepare(
      `SELECT id, kind, length(content) AS bytes, created_at FROM artifacts WHERE run_id = ? ORDER BY id ASC`,
    )
    .all(n);
  return NextResponse.json({ run, events, verdicts, artifacts });
}
