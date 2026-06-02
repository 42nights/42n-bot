import { NextRequest, NextResponse } from "next/server";
import { getLatestDiff } from "@/src/db/ops/artifacts";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const row = await getLatestDiff(id);
  return NextResponse.json({ diff: row?.content ?? "" });
}
