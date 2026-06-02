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
      new URL("/repos?install=missing-installation-id", req.url),
    );
  }
  const installationId = Number(installationIdRaw);
  if (!Number.isFinite(installationId)) {
    return NextResponse.redirect(
      new URL("/repos?install=bad-installation-id", req.url),
    );
  }

  if (!await appConfigured()) {
    return NextResponse.redirect(
      new URL("/repos?install=app-not-configured", req.url),
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
