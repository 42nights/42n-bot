import { convex, api } from "../convex-client";
import type { Id } from "../../../convex/_generated/dataModel";
import type { EventKind } from "../../shared/events";

export type EventRow = {
  _id: string;
  _creationTime: number;
  run_id: string;
  ts: number;
  kind: string;
  payload_json: string;
};

export async function insertEvent(
  run_id: string,
  kind: EventKind,
  payload: unknown,
): Promise<void> {
  await convex.mutation(api.events.insertEvent, {
    run_id: run_id as Id<"runs">,
    ts: Date.now(),
    kind,
    payload_json: JSON.stringify(payload),
  });
}

export async function listEventsByRun(run_id: string): Promise<EventRow[]> {
  const rows = await convex.query(api.events.listByRun, {
    run_id: run_id as Id<"runs">,
  });
  return rows as EventRow[];
}

export async function listEventsByRunAfterCursor(
  run_id: string,
  after_created?: number,
): Promise<EventRow[]> {
  const rows = await convex.query(api.events.listByRunAfterCursor, {
    run_id: run_id as Id<"runs">,
    after_created,
  });
  return rows as EventRow[];
}
