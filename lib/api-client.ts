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

export async function cancelRun(id: number) {
  const r = await fetch(`/api/runs/${id}/cancel`, { method: "POST" });
  return jsonOrThrow(r);
}

export async function sendChat(threadId: number | null, message: string) {
  const r = await fetch(`/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ threadId, message }),
  });
  return jsonOrThrow<{
    threadId: number;
    answer: string;
    citations: Array<{ runId: number; title: string; snippet: string }>;
  }>(r);
}

export async function listThreads() {
  return (await fetcher("/api/chat/threads")) as { threads: Array<{ id: number; title: string; updated_at: number }> };
}

export async function createThread() {
  const r = await fetch(`/api/chat/threads`, { method: "POST" });
  return jsonOrThrow<{ threadId: number }>(r);
}

export async function getMessages(threadId: number) {
  return (await fetcher(`/api/chat/threads/${threadId}/messages`)) as {
    messages: Array<{
      id: number;
      role: "user" | "assistant";
      content: string;
      citations: Array<{ runId: number; title: string; snippet: string }>;
      created_at: number;
    }>;
  };
}
