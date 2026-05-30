export type SmokeResult = {
  pass: boolean;
  status: number;
  bodyExcerpt: string;
  error?: string;
};

/** Hit a single endpoint and check that it doesn't 5xx on first contact. */
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
      body: method === "GET" || method === "DELETE" ? undefined : "{}",
      signal: controller.signal,
    });
    clearTimeout(timer);

    const text = await res.text();
    return {
      pass: res.status < 500,
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
