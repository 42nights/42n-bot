import { createRun, patchRun, incrementRunCost } from "../db/ops/runs";
import { insertArtifact } from "../db/ops/artifacts";
import { emitEvent } from "../shared/events";
import type { SwebenchInstance } from "./types";
import type { RunOutcome } from "./types";

export async function createSwebenchRun(inst: SwebenchInstance): Promise<string> {
  const title = inst.problem_statement
    .split("\n")
    .find((l) => l.trim().length > 0)
    ?.trim()
    .slice(0, 200) ?? inst.instance_id;

  const runId = await createRun({
    type: "implement",
    repo: inst.repo,
    issue_number: Math.abs(hashInt(inst.instance_id)) || 1,
    issue_title: title,
    issue_body: inst.problem_statement,
    status: "planning",
    started_at: Date.now(),
  });

  emitEvent(runId, "run.created", { instance_id: inst.instance_id, repo: inst.repo });
  return runId;
}

export async function updateRunStatus(
  runId: string,
  status: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await patchRun(runId, { status, ...extra });
}

export async function incRunCost(runId: string, deltaUsd: number): Promise<void> {
  await incrementRunCost(runId, deltaUsd);
}

export async function saveRunArtifact(
  runId: string,
  kind: string,
  content: string,
): Promise<void> {
  await insertArtifact(runId, kind, content);
}

export async function finishRun(runId: string, outcome: RunOutcome): Promise<void> {
  await updateRunStatus(runId, outcome, { finished_at: Date.now() });
  emitEvent(runId, "run.finished", { outcome });
}

function hashInt(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h;
}
