import { requestDispatchOp, consumeDispatchOp } from "../db/ops/dispatch";

export type DispatchName = "implementer" | "reviewer";

export function requestDispatch(name: DispatchName): void {
  requestDispatchOp(name).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`requestDispatch(${name}) failed:`, err);
  });
}

/**
 * Returns a Promise<boolean> — true if the signal was dirty and has been
 * consumed. The coordinator's dispatch tick now awaits this.
 */
export async function consumeDispatch(name: DispatchName): Promise<boolean> {
  return consumeDispatchOp(name);
}
