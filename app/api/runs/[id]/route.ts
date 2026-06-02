import { NextRequest, NextResponse } from "next/server";
import { getRun } from "@/src/db/ops/runs";
import { listEventsByRun } from "@/src/db/ops/events";
import { listVerdictsByRun } from "@/src/db/ops/verdicts";
import { listArtifactsByRun } from "@/src/db/ops/artifacts";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const run = await getRun(id);
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [events, verdicts, rawArtifacts] = await Promise.all([
    listEventsByRun(id),
    listVerdictsByRun(id),
    listArtifactsByRun(id),
  ]);

  // Expose byte size instead of full content (same as before).
  const artifacts = rawArtifacts.map((a) => ({
    _id: a._id,
    kind: a.kind,
    bytes: a.content.length,
    created_at: a.created_at,
  }));

  return NextResponse.json({ run, events, verdicts, artifacts });
}
