"use client";

import useSWR from "swr";
import { fetcher } from "./api-client";
import { useRepoScope } from "./repo-scope";

/**
 * Count of in-flight sessions for the currently-scoped repo (or all repos if
 * scope === "all"). Powers the LiveDot in the top bar.
 */
export function useActiveCount(): number {
  const { apiSuffix } = useRepoScope();
  const { data } = useSWR<{ runs: Array<{ status: string }> }>(
    `/api/runs?limit=80${apiSuffix.replace("?", "&")}`,
    fetcher,
    { refreshInterval: 3000 },
  );
  if (!data) return 0;
  return data.runs.filter((r) =>
    ["queued", "planning", "implementing", "verifying", "iterating"].includes(
      r.status,
    ),
  ).length;
}
