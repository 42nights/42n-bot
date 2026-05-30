import { NextRequest, NextResponse } from "next/server";
import { ensureSchema } from "@/src/db/migrate";
import { db } from "@/src/db";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  ensureSchema();
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const type = url.searchParams.get("type");
  const repo = url.searchParams.get("repo"); // "owner/name", null = all repos
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);

  const wheres: string[] = [];
  const params: unknown[] = [];
  if (status) {
    wheres.push("status = ?");
    params.push(status);
  }
  if (type) {
    wheres.push("type = ?");
    params.push(type);
  }
  if (repo) {
    wheres.push("repo = ?");
    params.push(repo);
  }
  const sql = `SELECT * FROM runs ${wheres.length ? `WHERE ${wheres.join(" AND ")}` : ""} ORDER BY started_at DESC LIMIT ?`;
  params.push(limit);
  const runs = db.prepare(sql).all(...params);

  // Rolling 24-hour rollup — repo-scoped if a repo was requested.
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const rollup = db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status IN ('pr-opened','succeeded') THEN 1 ELSE 0 END) AS shipped,
         SUM(CASE WHEN status='needs-review' THEN 1 ELSE 0 END) AS needs_review,
         SUM(CASE WHEN status='abandoned' THEN 1 ELSE 0 END) AS abandoned,
         SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
         COALESCE(SUM(cost_usd), 0) AS cost_usd
       FROM runs
       WHERE started_at >= ?
         ${repo ? "AND repo = ?" : ""}`,
    )
    .get(...(repo ? [since, repo] : [since]));

  return NextResponse.json({ runs, today: rollup });
}
