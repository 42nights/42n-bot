/**
 * Map a raw error (a thrown server message, GitHub/Octokit string, OS clone
 * error, …) to one clear, recoverable sentence for a toast. The raw text is
 * kept in the console for debugging — it never reaches the user. Falls back to
 * a generic line so an unrecognized error is never surfaced verbatim.
 */
export function friendlyError(err: unknown, fallback = "Something went wrong. Try again."): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  // Keep the real error for debugging; the user only sees friendly copy.
  if (raw) console.error("[otis]", raw);
  const m = raw.toLowerCase();

  if (m.includes("no repos connected") || raw.includes("422"))
    return "Connect a repo in Settings first.";
  if (m.includes("github_token is not set") || m.includes("bad credentials") || m.includes("401"))
    return "GitHub auth failed. Check your token or reinstall the GitHub App in Settings.";
  if (m.includes("403") || m.includes("forbidden") || m.includes("permission"))
    return "GitHub denied that request. Otis may not have access to this repo.";
  if (m.includes("404") || m.includes("not found"))
    return "Couldn't find that on GitHub. Check the repo and try again.";
  if (m.includes("validation failed") || m.includes("422"))
    return "GitHub rejected that request. Check the repo settings.";
  if (m.includes("enoent") || m.includes("eacces") || m.includes("erofs") || m.includes("mkdir") || m.includes("no git"))
    return "Couldn't provision a workspace to clone into. Run Otis locally or set WORKTREE_ROOT.";
  if (m.includes("clone failed") || m.includes("fetch failed"))
    return "Clone failed. Check the repo URL and your GitHub access, then retry.";
  if (m.includes("unauthorized"))
    return "Not authorized for that action.";
  if (m.includes("failed to fetch") || m.includes("networkerror") || m.includes("network"))
    return "Network error. Check your connection and try again.";
  return fallback;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = "";
    try {
      const j = await res.json();
      msg = (j as { error?: string }).error ?? "";
    } catch {
      msg = await res.text();
    }
    throw new Error(msg || `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const fetcher = async (url: string) => {
  const r = await fetch(url);
  return jsonOrThrow<any>(r);
};

export async function cancelRun(id: string) {
  const r = await fetch(`/api/runs/${id}/cancel`, { method: "POST" });
  return jsonOrThrow(r);
}

export async function sendChat(threadId: string | null, message: string) {
  const r = await fetch(`/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ threadId, message }),
  });
  return jsonOrThrow<{
    threadId: string;
    answer: string;
    citations: Array<{ runId: string; title: string; snippet: string }>;
  }>(r);
}

export async function listThreads() {
  return (await fetcher("/api/chat/threads")) as { threads: Array<{ id: string; title: string; updated_at: number }> };
}

export async function createThread() {
  const r = await fetch(`/api/chat/threads`, { method: "POST" });
  return jsonOrThrow<{ threadId: string }>(r);
}

export async function getMessages(threadId: string) {
  return (await fetcher(`/api/chat/threads/${threadId}/messages`)) as {
    messages: Array<{
      id: string;
      role: "user" | "assistant";
      content: string;
      citations: Array<{ runId: string; title: string; snippet: string }>;
      created_at: number;
    }>;
  };
}
