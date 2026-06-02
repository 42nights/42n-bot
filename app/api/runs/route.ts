import { NextRequest, NextResponse } from "next/server";
import { listRuns, rollup24h } from "@/src/db/ops/runs";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;
  const type = url.searchParams.get("type") ?? undefined;
  const repo = url.searchParams.get("repo") ?? undefined;
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);

  const [runs, today] = await Promise.all([
    listRuns({ status, type, repo, limit }),
    rollup24h(repo),
  ]);

  return NextResponse.json({ runs, today });
}
