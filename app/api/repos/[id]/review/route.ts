import { NextRequest, NextResponse } from "next/server";
import { ensureSchema } from "@/src/db/migrate";
import { getConnectedRepo } from "@/src/repo-store";
import { runReviewer } from "@/src/coordinator/reviewer";
import { log } from "@/src/shared/logger";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Manual trigger for the reviewer on a single connected repo. Same code path
 * the scheduled reviewer uses — just kicked from the UI instead of waiting
 * for the next 6-hour tick. Useful when the repo has no `bot-please` issues
 * yet and you want the bot to surface some.
 */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  ensureSchema();
  const { id } = await ctx.params;
  const repo = getConnectedRepo(Number(id));
  if (!repo) {
    return NextResponse.json({ error: "repo not found" }, { status: 404 });
  }
  const repoDir = repo.repo_dir ?? process.env.REPO_DIR;
  if (!repoDir) {
    return NextResponse.json(
      {
        error:
          "no local clone path set for this repo. Add one in the repo card.",
      },
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
