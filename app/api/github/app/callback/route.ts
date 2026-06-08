import { NextRequest, NextResponse } from "next/server";
import {
  appConfigured,
  listInstallationRepos,
} from "@/src/github/app";
import { upsertRepoFromInstallation } from "@/src/repo-store";
import { ensureLocalClone } from "@/src/repo-clone";
import { log } from "@/src/shared/logger";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const installationIdRaw = url.searchParams.get("installation_id");
  if (!installationIdRaw) {
    return NextResponse.redirect(
      new URL("/settings?install=missing-installation-id#repos", req.url),
    );
  }
  const installationId = Number(installationIdRaw);
  if (!Number.isFinite(installationId)) {
    return NextResponse.redirect(
      new URL("/settings?install=bad-installation-id#repos", req.url),
    );
  }

  if (!await appConfigured()) {
    return NextResponse.redirect(
      new URL("/settings?install=app-not-configured#repos", req.url),
    );
  }

  try {
    const repos = await listInstallationRepos(installationId);
    let added = 0;
    const upserted: string[] = [];
    for (const r of repos) {
      const row = await upsertRepoFromInstallation({
        owner: r.owner,
        name: r.name,
        defaultBranch: r.default_branch,
        installationId,
        htmlUrl: r.html_url,
        description: r.description,
      });
      upserted.push(row._id);
      added++;
    }
    log.info("gh-app", `installation ${installationId} connected ${added} repo(s)`);

    Promise.all(
      upserted.map((id) =>
        ensureLocalClone(id).catch((err) =>
          log.warn("clone", `bg clone of repo ${id} failed: ${err}`),
        ),
      ),
    );

    return NextResponse.redirect(
      new URL(`/settings?install=ok&count=${added}#repos`, req.url),
    );
  } catch (err) {
    log.error("gh-app", `install callback failed: ${err}`);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.redirect(
      new URL(
        `/settings?install=error&msg=${encodeURIComponent(msg.slice(0, 200))}#repos`,
        req.url,
      ),
    );
  }
}
