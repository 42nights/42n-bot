export type SmokeResult = {
  pass: boolean;
  status: number;
  bodyExcerpt: string;
  error?: string;
};

/**
 * Hit a single endpoint and check for a healthy response.
 * Pass rule: 2xx or 3xx. 4xx/5xx are failures — a 404/405 on the changed
 * endpoint is not healthy. Exception: 401/403 may be expected on auth-
 * protected endpoints without credentials, but we still fail them here
 * because the caller can override if they know the endpoint is auth-gated.
 * This is a smoke test, not contract testing.
 */
export async function smokeTestEndpoint(args: {
  baseUrl: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
}): Promise<SmokeResult> {
  const { baseUrl, method, path } = args;
  const url = baseUrl + path;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url, {
      method,
      headers: { "content-type": "application/json" },
      // Send a minimal valid JSON body so endpoints expecting JSON don't 400
      // spuriously. GET/DELETE have no body per HTTP semantics.
      body: method === "GET" || method === "DELETE" ? undefined : "{}",
      signal: controller.signal,
    });
    clearTimeout(timer);

    const text = await res.text();
    return {
      pass: res.status >= 200 && res.status < 400,
      status: res.status,
      bodyExcerpt: text.slice(0, 500),
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      pass: false,
      status: 0,
      bodyExcerpt: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
