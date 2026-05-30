"use client";

// 'use client' needed for tab state, SWR, and interactive fix-it buttons.

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { fetcher, sendChat, listThreads, createThread, getMessages } from "@/lib/api-client";
import { useRepoScope } from "@/lib/repo-scope";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/Skeleton";
import { OtisMark } from "@/components/icons/OtisMark";
import { cn } from "@/lib/utils";

const spring = { type: "spring" as const, stiffness: 320, damping: 36, mass: 0.8 };
import {
  Sparkles,
  Loader2,
  ExternalLink,
  Bug,
  GitPullRequest,
  CheckCircle2,
  AlertTriangle,
  CircleDashed,
  Send,
  Bot,
  User,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type Issue = {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: "open" | "closed";
  url: string;
  updated_at: string;
  repo: string;
  owner: string;
  name: string;
  source: "bot-found" | "bot-please" | "both";
  severity: "low" | "medium" | "high" | null;
  type: string | null;
  run_id: number | null;
  run_status: string | null;
  pr_number: number | null;
  pr_url: string | null;
};

type IssuesResponse = { issues: Issue[]; repos: number };

type Thread = { id: number; title: string; updated_at: number };
type Message = {
  id: number;
  role: "user" | "assistant";
  content: string;
  citations: Array<{ runId: number; title: string; snippet: string }>;
  created_at: number;
};

const ACTIVE_STATUSES = new Set([
  "queued",
  "planning",
  "implementing",
  "verifying",
  "iterating",
]);

// ── Main page ─────────────────────────────────────────────────────────────────

function InboxContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const rawTab = searchParams.get("tab");
  const tab: "queue" | "chat" =
    rawTab === "queue" || rawTab === "chat" ? rawTab : "queue";

  function setTab(t: "queue" | "chat") {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", t);
    router.replace(`/inbox?${params.toString()}`);
  }

  return (
    <div className="max-w-5xl mx-auto px-8 py-10">
      {/* Tabs */}
      <div className="flex items-center gap-1 mb-8 border-b border-[var(--border)]">
        {(["queue", "chat"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-4 py-2.5 text-sm font-medium capitalize transition-colors relative",
              tab === t
                ? "text-[var(--fg)]"
                : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
            )}
          >
            {t === "queue" ? "Queue" : "Conversation"}
            {tab === t && (
              <motion.span
                layoutId="inbox-tab-underline"
                className="absolute bottom-0 left-0 right-0 h-px bg-[var(--accent)]"
                transition={spring}
              />
            )}
          </button>
        ))}
      </div>

      {tab === "queue" ? <QueueTab /> : <ConversationTab />}
    </div>
  );
}

export default function InboxPage() {
  return (
    <Suspense fallback={<div className="p-10 text-sm text-[var(--fg-muted)]">Loading…</div>}>
      <InboxContent />
    </Suspense>
  );
}

// ── Queue tab (issues list) ───────────────────────────────────────────────────

function QueueTab() {
  const { apiSuffix } = useRepoScope();
  const { data, mutate } = useSWR<IssuesResponse>(
    `/api/issues${apiSuffix}`,
    fetcher,
    { refreshInterval: 5000 },
  );
  const [fixing, setFixing] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "found" | "active" | "done">("all");

  async function fixIt(issue: Issue) {
    const key = `${issue.repo}#${issue.number}`;
    setFixing(key);
    // QA3 (R3 finding 22): optimistic update with rollback. Mark the issue
    // as queued locally so the card transitions immediately and a 5s SWR
    // poll landing mid-request can't flash it back to "not started". The
    // `false` arg means "don't revalidate yet" — we control the data.
    const optimistic: IssuesResponse | undefined = data
      ? {
          ...data,
          issues: data.issues.map((i) =>
            i.repo === issue.repo && i.number === issue.number
              ? { ...i, run_status: "queued" }
              : i,
          ),
        }
      : undefined;
    if (optimistic) mutate(optimistic, false);
    try {
      const res = await fetch("/api/issues/fix", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          owner: issue.owner,
          repo: issue.name,
          issue_number: issue.number,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `${res.status}`);
      toast.success(`Queued — ${issue.repo}#${issue.number}`);
      mutate(); // revalidate from the server now that it's committed
    } catch (err) {
      toast.error((err as Error).message);
      if (data) mutate(data, false); // roll back to pre-click state
    } finally {
      setFixing(null);
    }
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <div className="flex items-end justify-between">
          <div className="space-y-2">
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-4 w-72" />
          </div>
          <div className="flex gap-1">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-16" />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      </div>
    );
  }

  const stats = {
    total: data.issues.length,
    found: data.issues.filter((i) => i.source === "bot-found").length,
    active: data.issues.filter(isActive).length,
    done: data.issues.filter(isDone).length,
  };

  const filtered = data.issues.filter((i) => {
    if (filter === "all") return true;
    if (filter === "found") return i.source === "bot-found";
    if (filter === "active") return isActive(i);
    if (filter === "done") return isDone(i);
    return true;
  });

  return (
    <>
      <header className="mb-6 flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-serif text-2xl tracking-tight">Issues</h1>
          <p className="mt-1 text-sm text-[var(--fg-muted)]">
            Every{" "}
            <code className="font-mono text-xs bg-[var(--bg-sunken)] px-1.5 py-0.5 rounded">
              bot-found
            </code>{" "}
            and{" "}
            <code className="font-mono text-xs bg-[var(--bg-sunken)] px-1.5 py-0.5 rounded">
              bot-please
            </code>{" "}
            issue across {data.repos} connected{" "}
            {data.repos === 1 ? "repo" : "repos"}.
          </p>
        </div>
        <div className="flex gap-1">
          {(["all", "found", "active", "done"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "relative px-3 h-8 rounded-md text-xs uppercase tracking-wider transition-colors",
                filter === f
                  ? "bg-[var(--fg)] text-[var(--bg)]"
                  : "text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--bg-elev)]",
              )}
            >
              {f}{" "}
              <span className="ml-1 font-mono">
                {f === "all"
                  ? stats.total
                  : f === "found"
                    ? stats.found
                    : f === "active"
                      ? stats.active
                      : stats.done}
              </span>
            </button>
          ))}
        </div>
      </header>

      {filtered.length === 0 ? (
        <IssueEmptyState filter={filter} hasRepos={data.repos > 0} />
      ) : (
        <motion.div
          className="grid grid-cols-1 md:grid-cols-2 gap-3"
          initial="hidden"
          animate="visible"
          variants={{ visible: { transition: { staggerChildren: 0.04 } } }}
        >
          {filtered.map((i) => (
            <motion.div
              key={`${i.repo}#${i.number}`}
              variants={{
                hidden: { opacity: 0, y: 8 },
                visible: { opacity: 1, y: 0, transition: spring },
              }}
            >
              <IssueCard
                issue={i}
                fixing={fixing === `${i.repo}#${i.number}`}
                onFix={() => fixIt(i)}
              />
            </motion.div>
          ))}
        </motion.div>
      )}
    </>
  );
}

function IssueCard({
  issue,
  fixing,
  onFix,
}: {
  issue: Issue;
  fixing: boolean;
  onFix: () => void;
}) {
  const active = isActive(issue);
  const done = isDone(issue);
  const [pulsing, setPulsing] = useState(false);

  function handleFix() {
    setPulsing(true);
    setTimeout(() => setPulsing(false), 1000);
    onFix();
  }

  const severityClass: Record<string, string> = {
    high: "bg-[var(--fail-soft)] text-[var(--fail)] border-[var(--fail)]",
    medium: "bg-[var(--warn-soft)] text-[var(--warn)] border-[var(--warn)]",
    low: "bg-[var(--plan-soft)] text-[var(--plan)] border-[var(--plan)]",
  };
  return (
    <motion.div
      className={cn(
        "rounded-xl border p-4 transition-shadow hover:shadow-sm",
        pulsing
          ? "border-[var(--plan)]"
          : active
            ? "border-[var(--plan-soft)] bg-[var(--plan-soft)]"
            : done
              ? "border-[var(--accent-soft)] bg-[var(--accent-soft)]"
              : "border-[var(--border)] bg-[var(--bg)]",
      )}
      animate={pulsing ? {
        boxShadow: ["0 0 0 0 transparent", "0 0 0 4px color-mix(in oklab, var(--plan) 30%, transparent)", "0 0 0 0 transparent"],
      } : {}}
      transition={{ duration: 0.9 }}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <a
              href={issue.url}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-sm hover:underline truncate"
            >
              {issue.title}
            </a>
            <ExternalLink className="h-3 w-3 text-[var(--fg-muted)] shrink-0" />
          </div>
          <div className="flex flex-wrap gap-1.5 items-center text-[11px] text-[var(--fg-muted)]">
            <span className="font-mono">
              {issue.repo}#{issue.number}
            </span>
            {issue.type && (
              <Badge variant="default" className="text-[10px]">
                {issue.type}
              </Badge>
            )}
            {issue.severity && (
              <span
                className={cn(
                  "border px-1.5 py-0.5 rounded font-mono text-[10px] uppercase tracking-wider",
                  severityClass[issue.severity],
                )}
              >
                {issue.severity}
              </span>
            )}
            {issue.source === "bot-found" && (
              <Badge
                variant="default"
                className="text-[10px] inline-flex items-center gap-1"
              >
                <Bug className="h-2.5 w-2.5" />
                bot-found
              </Badge>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <IssueStatusLine issue={issue} />
        <IssueActionButton
          issue={issue}
          fixing={fixing}
          onFix={handleFix}
          active={active}
          done={done}
        />
      </div>
    </motion.div>
  );
}

function IssueStatusLine({ issue }: { issue: Issue }) {
  if (issue.pr_url) {
    return (
      <a
        href={issue.pr_url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-xs text-emerald-700 hover:underline"
      >
        <GitPullRequest className="h-3.5 w-3.5" />
        PR #{issue.pr_number} opened
      </a>
    );
  }
  if (issue.run_status && ACTIVE_STATUSES.has(issue.run_status)) {
    return (
      <Link
        href={`/sessions/${issue.run_id}`}
        className="inline-flex items-center gap-1.5 text-xs text-violet-700 hover:underline"
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {issue.run_status}…
      </Link>
    );
  }
  if (issue.run_status === "needs-review") {
    return (
      <Link
        href={`/sessions/${issue.run_id}`}
        className="inline-flex items-center gap-1.5 text-xs text-amber-700 hover:underline"
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        Needs review
      </Link>
    );
  }
  if (issue.run_status === "succeeded") {
    return (
      <Link
        href={`/sessions/${issue.run_id}`}
        className="inline-flex items-center gap-1.5 text-xs text-emerald-700 hover:underline"
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
        Succeeded
      </Link>
    );
  }
  if (issue.run_status === "failed") {
    return (
      <Link
        href={`/sessions/${issue.run_id}`}
        className="inline-flex items-center gap-1.5 text-xs text-red-700 hover:underline"
      >
        Failed — retry?
      </Link>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-[var(--fg-muted)]">
      <CircleDashed className="h-3.5 w-3.5" />
      Not started
    </span>
  );
}

function IssueActionButton({
  issue,
  fixing,
  onFix,
  active,
  done,
}: {
  issue: Issue;
  fixing: boolean;
  onFix: () => void;
  active: boolean;
  done: boolean;
}) {
  if (done) {
    return (
      <Button variant="outline" size="sm" disabled>
        Done
      </Button>
    );
  }
  if (active) {
    return (
      <Button variant="outline" size="sm" disabled>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Working
      </Button>
    );
  }
  if (issue.source === "both" || issue.source === "bot-please") {
    return (
      <Button variant="outline" size="sm" onClick={onFix} disabled={fixing}>
        {fixing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Sparkles className="h-3.5 w-3.5" />
        )}
        Re-dispatch
      </Button>
    );
  }
  return (
    <Button variant="primary" size="sm" onClick={onFix} disabled={fixing}>
      {fixing ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Queueing…
        </>
      ) : (
        <>
          <Sparkles className="h-3.5 w-3.5" /> Fix it
        </>
      )}
    </Button>
  );
}

function IssueEmptyState({
  filter,
  hasRepos,
}: {
  filter: "all" | "found" | "active" | "done";
  hasRepos: boolean;
}) {
  if (!hasRepos) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
        <OtisMark className="h-12 w-12 opacity-30" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-[var(--fg-muted)]">No repos connected</p>
          <p className="text-xs text-[var(--fg-subtle)]">Install the GitHub App to get started.</p>
        </div>
        <Link
          href="/settings"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--accent)] text-[var(--accent-fg)] text-xs font-medium hover:opacity-90 transition-opacity"
        >
          Go to Settings
        </Link>
      </div>
    );
  }

  const hints: Record<typeof filter, { message: string; sub: string }> = {
    all: {
      message: "No issues yet",
      sub: "Click Find Issues on a repo card to have Otis scan for bugs.",
    },
    found: {
      message: "Nothing found yet",
      sub: "Otis hasn't filed any issues from its last review.",
    },
    active: {
      message: "Nothing in flight",
      sub: "No sessions are running right now.",
    },
    done: {
      message: "Nothing shipped yet",
      sub: "Completed fixes will appear here.",
    },
  };
  const { message, sub } = hints[filter];
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
      <OtisMark className="h-12 w-12 opacity-30" />
      <div className="space-y-1">
        <p className="text-sm font-medium text-[var(--fg-muted)]">{message}</p>
        <p className="text-xs text-[var(--fg-subtle)] max-w-64">{sub}</p>
      </div>
    </div>
  );
}

function isActive(i: Issue): boolean {
  return !!i.run_status && ACTIVE_STATUSES.has(i.run_status);
}
function isDone(i: Issue): boolean {
  return !!i.pr_url || i.run_status === "succeeded";
}

// ── Conversation tab (chat) ───────────────────────────────────────────────────

function ConversationTab() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listThreads()
      .then(({ threads: t }) => {
        setThreads(t);
        if (t.length > 0) {
          setActiveThreadId(t[0].id);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!activeThreadId) {
      setMessages([]);
      return;
    }
    getMessages(activeThreadId)
      .then(({ messages: m }) => setMessages(m))
      .catch(() => {});
  }, [activeThreadId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || sending) return;
    setSending(true);
    const optimistic: Message = {
      id: Date.now(),
      role: "user",
      content: trimmed,
      citations: [],
      created_at: Date.now(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setInput("");
    try {
      const result = await sendChat(activeThreadId, trimmed);
      if (!activeThreadId) {
        setActiveThreadId(result.threadId);
        // Refresh threads list
        listThreads()
          .then(({ threads: t }) => setThreads(t))
          .catch(() => {});
      }
      const reply: Message = {
        id: Date.now() + 1,
        role: "assistant",
        content: result.answer,
        citations: result.citations,
        created_at: Date.now(),
      };
      setMessages((prev) => [...prev, reply]);
    } catch (err) {
      toast.error((err as Error).message);
      // Remove the optimistic message on failure
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setInput(trimmed);
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  }

  if (loading) {
    return <div className="text-sm text-[var(--fg-muted)]">Loading…</div>;
  }

  return (
    <div className="flex gap-6 h-[calc(100vh-240px)]">
      {/* Thread sidebar */}
      {threads.length > 0 && (
        <aside className="w-48 shrink-0 flex flex-col gap-1">
          <button
            onClick={async () => {
              const { threadId } = await createThread();
              setActiveThreadId(threadId);
              setMessages([]);
              listThreads()
                .then(({ threads: t }) => setThreads(t))
                .catch(() => {});
            }}
            className="mb-2 h-8 w-full rounded-md border border-dashed border-[var(--border)] text-xs text-[var(--fg-muted)] hover:text-[var(--fg)] hover:border-[var(--border-strong)] transition-colors"
          >
            + New thread
          </button>
          {threads.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveThreadId(t.id)}
              className={cn(
                "w-full text-left px-3 py-2 rounded-lg text-xs transition-colors truncate",
                activeThreadId === t.id
                  ? "bg-[var(--bg-elev)] text-[var(--fg)]"
                  : "text-[var(--fg-muted)] hover:bg-[var(--bg-elev)] hover:text-[var(--fg)]",
              )}
            >
              {t.title || `Thread ${t.id}`}
            </button>
          ))}
        </aside>
      )}

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex-1 overflow-y-auto space-y-4 pr-1 mb-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--fg-muted)]">
              <Bot className="h-8 w-8 opacity-40" />
              <p className="text-sm">Ask Otis about sessions, PRs, or the codebase.</p>
            </div>
          ) : (
            messages.map((m) => (
              <ChatBubble key={m.id} message={m} />
            ))
          )}
          {sending && (
            <div className="flex items-center gap-2 text-xs text-[var(--fg-muted)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Otis is thinking…
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elev)] overflow-hidden">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Otis…"
            rows={2}
            className="w-full resize-none bg-transparent px-4 pt-3 pb-2 text-sm text-[var(--fg)] placeholder:text-[var(--fg-subtle)] focus:outline-none"
            aria-label="Message"
            disabled={sending}
          />
          <div className="px-3 pb-3 flex justify-end">
            <button
              onClick={handleSend}
              disabled={!input.trim() || sending}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-[var(--accent)] text-[var(--accent-fg)] text-xs font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
              aria-label="Send message"
            >
              <Send className="h-3.5 w-3.5" />
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
      <div
        className={cn(
          "h-7 w-7 rounded-full shrink-0 flex items-center justify-center",
          isUser
            ? "bg-[var(--bg-elev)] border border-[var(--border)]"
            : "bg-[var(--accent-soft)]",
        )}
        aria-hidden="true"
      >
        {isUser ? (
          <User className="h-3.5 w-3.5 text-[var(--fg-muted)]" />
        ) : (
          <Bot className="h-3.5 w-3.5 text-[var(--accent)]" />
        )}
      </div>
      <div className={cn("max-w-[80%]", isUser ? "items-end" : "items-start")}>
        <div
          className={cn(
            "rounded-xl px-4 py-2.5 text-sm leading-relaxed",
            isUser
              ? "bg-[var(--bg-elev)] border border-[var(--border)] text-[var(--fg)]"
              : "bg-[var(--bg-sunken)] text-[var(--fg)]",
          )}
        >
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
        {message.citations.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {message.citations.map((c) => (
              <Link
                key={c.runId}
                href={`/sessions/${c.runId}`}
                className="text-[10px] font-mono text-[var(--fg-muted)] hover:text-[var(--fg)] underline"
              >
                session #{c.runId}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
