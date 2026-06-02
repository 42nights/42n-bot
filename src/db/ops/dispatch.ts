import { convex, api } from "../convex-client";

export async function requestDispatchOp(name: string): Promise<void> {
  await convex.mutation(api.dispatch.request, {
    name,
    updated_at: Date.now(),
  });
}

export async function consumeDispatchOp(name: string): Promise<boolean> {
  return convex.mutation(api.dispatch.consume, {
    name,
    updated_at: Date.now(),
  });
}
