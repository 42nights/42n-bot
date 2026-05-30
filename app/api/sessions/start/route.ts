import { NextRequest, NextResponse } from "next/server";
import { ensureSchema } from "@/src/db/migrate";
import { addLabel, ghFor } from "@/src/github/client";
import { activeRepos } from "@/src/repo-store";
import { botConfig } from "@/bot.config";
import { requestDispatch } from "@/src/coordinator/dispatch";
import { log } from "@/src/shared/logger";

export const runtime = "nodejs";

/**
 * Creates a GitHub issue with the user's prompt as the body, labels it
 * `bot-please`, then kicks the coordinator. Returns the issue number.
 *
 * Body: { prompt: string; repo?: "owner/name" | null }
 */
export async function POST(req: NextRequest) {
  ensureSchema();
  const body = (await req.json().catch(() => ({}))) as {
    prompt?: string;
    repo?: string | null;
  };
  if (!body.prompt?.trim()) {
    return NextResponse.json({ error: "prompt required" }, { status: 400 });
  }

  // Resolve which repo to use: explicit arg > first enabled connected repo.
  let owner: string;
  let name: string;

  if (body.repo) {
    const parts = body.repo.split("/");
    if (parts.length !== 2) {
      return NextResponse.json(
        { error: "repo must be 'owner/name'" },
        { status: 400 },
      );
    }
    [owner, name] = parts;
  } else {
    const repos = activeRepos();
    if (repos.length === 0) {
      return NextResponse.json(
        { error: "No repos connected. Add one in Settings." },
        { status: 422 },
      );
    }
    owner = repos[0].owner;
    name = repos[0].name;
  }

  try {
    const gh = ghFor(owner, name);
    const { data: issue } = await gh.issues.create({
      owner,
      repo: name,
      title: body.prompt.trim().slice(0, 120),
      body: body.prompt.trim(),
      labels: [botConfig.labels.request],
    });

    requestDispatch("implementer");
    log.info(
      "sessions",
      `start: created ${owner}/${name}#${issue.number} → coordinator dispatched`,
    );

    return NextResponse.json({
      issue_number: issue.number,
      issue_url: issue.html_url,
      repo: `${owner}/${name}`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = (err as { status?: number }).status ?? 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
