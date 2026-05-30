import { log } from "../shared/logger";
import { activeRepos } from "../repo-store";
import { runReviewer } from "../coordinator/reviewer";
import {
  addLabel,
  createBotIssue,
} from "../github/client";
import { botConfig } from "../../bot.config";
import { requestDispatch } from "../coordinator/dispatch";
import {
  dueCrons,
  markCronFired,
  type CronRow,
} from "./store";

/**
 * Process every cron whose next_run_at has elapsed. Idempotent — a cron that
 * fired this tick gets a fresh `next_run_at` computed from its schedule, so
 * the next tick won't re-fire it.
 *
 * Called by the coordinator's main loop on a 30s tick.
 */
// QA2: `reviewer` crons each spawn a full Claude subprocess + worktree +
// budget. A misconfigured schedule (e.g. `* * * * *`) firing on many ticks
// after a restart could spawn 10 concurrent reviewers — resource exhaustion
// AND duplicate-issue races (two reviewers reading the same open-issue set
// before either files). Cap heavy reviewer crons to 1 concurrent; the cheap
// `fix_issue` / `send_otis` actions (just an API call + dispatch) run fully
// parallel.
const MAX_CONCURRENT_REVIEWER_CRONS = 1;

async function fireAndRecord(cron: CronRow): Promise<boolean> {
  try {
    const result = await fireCron(cron);
    markCronFired({ id: cron.id, schedule: cron.schedule }, result);
    log.info(
      "cron",
      `fired #${cron.id} (${cron.name}): ${result.ok ? "ok" : "failed"} — ${result.message.slice(0, 200)}`,
    );
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    markCronFired(
      { id: cron.id, schedule: cron.schedule },
      { ok: false, message: msg },
    );
    log.error("cron", `cron #${cron.id} threw: ${msg}`);
    return false;
  }
}

// QA2: re-entrancy guard. The coordinator ticks the scheduler every 30s. A
// slow reviewer cron can take minutes — without this flag, the next interval
// fires while the first is still running, calls dueCrons() which returns the
// SAME cron (its next_run_at hasn't advanced yet because markCronFired runs
// after fireCron completes), and double-fires it.
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
  const due = dueCrons(10);
  if (due.length === 0) return { fired: 0 };

  const heavy = due.filter((c) => c.action === "reviewer");
  const light = due.filter((c) => c.action !== "reviewer");

  // Light crons fully parallel.
  const lightResults = await Promise.allSettled(light.map(fireAndRecord));

  // Heavy (reviewer) crons through a small concurrency gate.
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
): Promise<{ ok: boolean; message: string; runId?: number }> {
  const payload = parsePayload(cron.payload_json);
  const targetRepo = pickRepo(cron.repo);

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
      // payload: { owner, repo, issue_number } — labels the issue so the
      // implementer picks it up on its next tick.
      const { owner, repo, issue_number } = payload as {
        owner?: string;
        repo?: string;
        issue_number?: number;
      };
      if (!owner || !repo || !issue_number) {
        return {
          ok: false,
          message: "payload missing owner/repo/issue_number",
        };
      }
      await addLabel({
        owner,
        repo,
        issue_number,
        label: botConfig.labels.request,
      });
      requestDispatch("implementer");
      return { ok: true, message: `dispatched ${owner}/${repo}#${issue_number}` };
    }

    case "send_otis": {
      // payload: { title, body } — opens a new GitHub issue tagged
      // `bot-please` on the target repo.
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

function pickRepo(scoped: string | null): {
  owner: string;
  name: string;
  repo_dir: string | null;
} | null {
  const enabled = activeRepos().filter((r) => r.enabled);
  if (!enabled.length) return null;
  if (scoped) {
    const match = enabled.find((r) => `${r.owner}/${r.name}` === scoped);
    if (match) return match;
  }
  return enabled[0];
}
