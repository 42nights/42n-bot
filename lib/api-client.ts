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
