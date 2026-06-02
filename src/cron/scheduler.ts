import { log } from "../shared/logger";
import { activeRepos } from "../repo-store";
import { runReviewer } from "../coordinator/reviewer";
import { addLabel, createBotIssue } from "../github/client";
import { botConfig } from "../../bot.config";
import { requestDispatch } from "../coordinator/dispatch";
import {
  dueCrons,
  claimDueCron,
  recordCronRun,
  type CronRow,
} from "./store";

const MAX_CONCURRENT_REVIEWER_CRONS = 1;

async function fireAndRecord(cron: CronRow): Promise<boolean> {
  if (!await claimDueCron(cron)) {
    return false;
  }
  try {
    const result = await fireCron(cron);
    await recordCronRun(cron._id, result);
    log.info(
      "cron",
      `fired #${cron._id} (${cron.name}): ${result.ok ? "ok" : "failed"} — ${result.message.slice(0, 200)}`,
    );
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await recordCronRun(cron._id, { ok: false, message: msg });
    log.error("cron", `cron #${cron._id} threw: ${msg}`);
    return false;
  }
}

let ticking = false;

export async function tickScheduler(): Promise<{ fired: number }> {
  if (ticking) return { fired: 0 };
  ticking = true;
  try {
    return await tickSchedulerInner();
  } finally {
    ticking = false;
  }
}

async function tickSchedulerInner(): Promise<{ fired: number }> {
  const due = await dueCrons(10);
  if (due.length === 0) return { fired: 0 };

  const heavy = due.filter((c) => c.action === "reviewer");
  const light = due.filter((c) => c.action !== "reviewer");

  const lightResults = await Promise.allSettled(light.map(fireAndRecord));

  const heavyResults: PromiseSettledResult<boolean>[] = [];
  for (let i = 0; i < heavy.length; i += MAX_CONCURRENT_REVIEWER_CRONS) {
    const batch = heavy.slice(i, i + MAX_CONCURRENT_REVIEWER_CRONS);
    const settled = await Promise.allSettled(batch.map(fireAndRecord));
    heavyResults.push(...settled);
  }

  const fired = [...lightResults, ...heavyResults].filter(
    (r) => r.status === "fulfilled" && r.value === true,
  ).length;
  return { fired };
}

async function fireCron(
  cron: CronRow,
): Promise<{ ok: boolean; message: string; runId?: string }> {
  const payload = parsePayload(cron.payload_json);
  const targetRepo = await pickRepo(cron.repo ?? null);

  switch (cron.action) {
    case "reviewer": {
      if (!targetRepo) {
        return { ok: false, message: "no enabled repo to run reviewer against" };
      }
      const repoDir = targetRepo.repo_dir ?? process.env.REPO_DIR;
      if (!repoDir) {
        return {
          ok: false,
          message: `no local clone for ${targetRepo.owner}/${targetRepo.name}`,
        };
      }
      const result = await runReviewer({
        repoDir,
        owner: targetRepo.owner,
        repo: targetRepo.name,
      });
      return {
        ok: true,
        runId: result.runId,
        message: `proposed ${result.proposed}, opened ${result.opened}, deduped ${result.deduped}`,
      };
    }

    case "fix_issue": {
      const { owner, repo, issue_number } = payload as {
        owner?: string;
        repo?: string;
        issue_number?: number;
      };
      if (!owner || !repo || !issue_number) {
        return { ok: false, message: "payload missing owner/repo/issue_number" };
      }
      await addLabel({ owner, repo, issue_number, label: botConfig.labels.request });
      requestDispatch("implementer");
      return { ok: true, message: `dispatched ${owner}/${repo}#${issue_number}` };
    }

    case "send_otis": {
      const { title, body } = payload as { title?: string; body?: string };
      if (!title) return { ok: false, message: "payload missing title" };
      if (!targetRepo) {
        return { ok: false, message: "no enabled repo to send_otis on" };
      }
      const created = await createBotIssue({
        owner: targetRepo.owner,
        repo: targetRepo.name,
        title,
        body: body ?? "",
        labels: [botConfig.labels.request],
      });
      requestDispatch("implementer");
      return {
        ok: true,
        message: `opened ${targetRepo.owner}/${targetRepo.name}#${created.number}`,
      };
    }

    default:
      return { ok: false, message: `unknown cron action: ${cron.action}` };
  }
}

function parsePayload(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function pickRepo(scoped: string | null): Promise<{
  owner: string;
  name: string;
  repo_dir: string | null;
} | null> {
  const enabled = (await activeRepos()).filter((r) => r.enabled);
  if (!enabled.length) return null;
  if (scoped) {
    const match = enabled.find((r) => `${r.owner}/${r.name}` === scoped);
    if (match) return match;
  }
  return enabled[0];
}
