import { NextRequest, NextResponse } from "next/server";
import { ensureSchema } from "@/src/db/migrate";
import {
  appConfigured,
  listInstallationRepos,
} from "@/src/github/app";
import { upsertRepoFromInstallation } from "@/src/repo-store";
import { ensureLocalClone } from "@/src/repo-clone";
import { log } from "@/src/shared/logger";

export const runtime = "nodejs";
// QA6: bound the install-callback response time — it lists every installation
// repo and clones in the background.
export const maxDuration = 60;

/**
 * GitHub's "Setup URL" post-install redirect lands here. The query string
 * carries:
 *   - installation_id  (always)
 *   - setup_action     ("install" | "update")
 *
 * We list every repo this installation can see and upsert them into the
 * `repos` table tagged with this installation_id, then bounce the user back
 * to /repos.
 */
export async function GET(req: NextRequest) {
  ensureSchema();

  const url = new URL(req.url);
  const installationIdRaw = url.searchParams.get("installation_id");
  if (!installationIdRaw) {
    return NextResponse.redirect(
      new URL("/repos?install=missing-installation-id", req.url),
    );
  }
  const installationId = Number(installationIdRaw);
  if (!Number.isFinite(installationId)) {
    return NextResponse.redirect(
      new URL("/repos?install=bad-installation-id", req.url),
    );
  }

  if (!appConfigured()) {
    return NextResponse.redirect(
      new URL("/repos?install=app-not-configured", req.url),
    );
  }

  try {
    const repos = await listInstallationRepos(installationId);
    let added = 0;
    const upserted: number[] = [];
    for (const r of repos) {
      const row = upsertRepoFromInstallation({
        owner: r.owner,
        name: r.name,
        defaultBranch: r.default_branch,
        installationId,
        htmlUrl: r.html_url,
        description: r.description,
      });
      upserted.push(row.id);
      added++;
    }
    log.info("gh-app", `installation ${installationId} connected ${added} repo(s)`);

    // Kick off local clones in the background. We don't await — large repos
    // can take a while and we don't want to block the redirect. The UI shows
    // the cloning state and the user can manually retry if it fails.
    Promise.all(
      upserted.map((id) =>
        ensureLocalClone(id).catch((err) =>
          log.warn("clone", `bg clone of repo ${id} failed: ${err}`),
        ),
      ),
    );

    return NextResponse.redirect(
      new URL(`/repos?install=ok&count=${added}`, req.url),
    );
  } catch (err) {
    log.error("gh-app", `install callback failed: ${err}`);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.redirect(
      new URL(
        `/repos?install=error&msg=${encodeURIComponent(msg.slice(0, 200))}`,
        req.url,
      ),
    );
  }
}
