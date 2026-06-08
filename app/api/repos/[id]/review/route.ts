import { NextRequest, NextResponse } from "next/server";
import { getConnectedRepo } from "@/src/repo-store";
import { runReviewer } from "@/src/coordinator/reviewer";
import { requireAdmin } from "@/src/shared/auth";
import { log } from "@/src/shared/logger";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const repo = await getConnectedRepo(id);
  if (!repo) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }
  const repoDir = repo.repo_dir ?? process.env.REPO_DIR;
  if (!repoDir) {
    return NextResponse.json(
      { error: "no local clone path set for this repo. Add one in the repo card." },
      { status: 400 },
    );
  }

  try {
    const result = await runReviewer({
      repoDir,
      owner: repo.owner,
      repo: repo.name,
    });
    log.info(
      "review",
      `manual: ${repo.owner}/${repo.name} proposed=${result.proposed} opened=${result.opened} deduped=${result.deduped}`,
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("review", `manual trigger failed: ${msg}`);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
