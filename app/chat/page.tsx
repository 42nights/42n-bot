"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { fetcher, sendChat } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Send, Loader2 } from "lucide-react";

type Msg = {
  id: number;
  role: "user" | "assistant";
  content: string;
  citations: { runId: number; title: string; snippet: string }[];
  created_at: number;
};

export default function ChatPage() {
  const [threadId, setThreadId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const { data, mutate } = useSWR<{ messages: Msg[] }>(
    threadId ? `/api/chat/threads/${threadId}/messages` : null,
    fetcher,
  );
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [data?.messages?.length, pending]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const message = input.trim();
    if (!message || pending) return;
    setInput("");
    setPending(true);
    try {
      const res = await sendChat(threadId, message);
      setThreadId(res.threadId);
      mutate();
    } catch {/* show as error */}
    finally {
      setPending(false);
    }
  }

  const examples = [
    "What did you do in the past 24 hours?",
    "Which runs ended in needs-review?",
    "Which issue cost the most?",
    "Show me the runs the critic rejected.",
  ];

  return (
    <div className="flex flex-col h-screen">
      <header className="border-b border-border px-8 py-4">
        <div className="max-w-3xl mx-auto">
          <h1 className="font-serif text-2xl tracking-tight">Ask the bot</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Grounded in the bot's own run log. Answers cite specific run IDs.
          </p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-8 py-8">
        <div className="max-w-3xl mx-auto space-y-5">
          {!data?.messages?.length && !pending && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                Try one of these:
              </div>
              <div className="flex flex-wrap gap-2">
                {examples.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setInput(q)}
                    className="text-xs rounded-full border border-border px-3 py-1.5 hover:bg-muted"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {data?.messages?.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="flex justify-end">
                <div className="bg-foreground text-background rounded-2xl rounded-br-sm px-4 py-2 max-w-[80%] whitespace-pre-wrap text-sm">
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={m.id} className="space-y-3">
                <div className="text-sm whitespace-pre-wrap leading-relaxed">
                  {m.content}
                </div>
                {m.citations?.length > 0 && (
                  <div className="grid sm:grid-cols-2 gap-2">
                    {m.citations.map((c, i) => (
                      <Link
                        key={i}
                        href={`/runs/${c.runId}`}
                        className="block text-xs border border-border rounded-md p-2 bg-muted/30 hover:bg-muted transition-colors"
                      >
                        <div className="font-medium truncate">{c.title}</div>
                        <div className="text-muted-foreground line-clamp-2 mt-0.5">
                          {c.snippet}
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            ),
          )}

          {pending && (
            <div className="text-sm text-muted-foreground inline-flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Searching the run log…
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <form onSubmit={submit} className="border-t border-border px-8 py-4">
        <div className="max-w-3xl mx-auto flex items-end gap-2">
          <textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(e as unknown as React.FormEvent);
              }
            }}
            placeholder="What did you do today? Which runs failed verification? …"
            disabled={pending}
            className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
          <Button
            type="submit"
            variant="primary"
            size="icon"
            disabled={pending || !input.trim()}
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </form>
    </div>
  );
}
