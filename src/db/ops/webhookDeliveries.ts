import { convex, api } from "../convex-client";

export async function claimWebhookDelivery(
  delivery_id: string,
  event: string,
): Promise<boolean> {
  return convex.mutation(api.webhookDeliveries.claimDelivery, {
    delivery_id,
    event,
    received_at: Date.now(),
  });
}

export async function pruneOldWebhookDeliveries(
  cutoff: number,
): Promise<number> {
  return convex.mutation(api.webhookDeliveries.pruneOld, { cutoff });
}
