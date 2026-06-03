// Convex stores document ids as `_id`; the dashboard's client code identifies
// records by `id`. Normalize at the API boundary so the server keeps using
// `_id` while the client gets a stable `id`.

export function withId<T extends { _id: string }>(doc: T): T & { id: string } {
  return { ...doc, id: doc._id };
}

export function withIds<T extends { _id: string }>(
  docs: T[],
): Array<T & { id: string }> {
  return docs.map(withId);
}
