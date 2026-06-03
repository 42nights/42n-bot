"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import useSWR from "swr";
import { useCallback, useMemo } from "react";
import { fetcher } from "./api-client";

export type ConnectedRepoBrief = {
  id: string;
  owner: string;
  name: string;
  enabled: number;
};

/**
 * Repo scoping is URL-driven. The whole dashboard reads `?repo=owner/name`
 * from the current URL and uses it to filter API calls + rollups. "all" means
 * no filter — every connected repo's activity flows through.
 *
 * The selected scope persists across navigation because Next's `<Link>`
 * preserves search params on internal routes (we pass through manually in
 * components that build URLs).
 */
export function useRepoScope(): {
  scope: string;            // "all" or "owner/name"
  repos: ConnectedRepoBrief[];
  setScope: (next: string) => void;
  apiSuffix: string;        // "" or "?repo=owner/name"
  queryParam: string;       // "" or "&repo=owner/name"
} {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const { data } = useSWR<{ connected: ConnectedRepoBrief[] }>(
    "/api/repos",
    fetcher,
    { refreshInterval: 15_000 },
  );
  const repos = useMemo(
    () =>
      (data?.connected ?? []).filter((r) => r.enabled).map((r) => ({
        id: r.id,
        owner: r.owner,
        name: r.name,
        enabled: r.enabled,
      })),
    [data],
  );

  const scope = params.get("repo") ?? "all";

  const setScope = useCallback(
    (next: string) => {
      const newParams = new URLSearchParams(params.toString());
      if (next === "all") {
        newParams.delete("repo");
      } else {
        newParams.set("repo", next);
      }
      const qs = newParams.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, router, pathname],
  );

  const apiSuffix = scope === "all" ? "" : `?repo=${encodeURIComponent(scope)}`;
  const queryParam =
    scope === "all" ? "" : `&repo=${encodeURIComponent(scope)}`;

  return { scope, repos, setScope, apiSuffix, queryParam };
}
