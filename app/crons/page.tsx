"use client";

// Client needed: SWR, modal state, interactive forms, toast.

import { useState, useEffect, useCallback, useRef } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { fetcher } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  Sparkles,
  Pencil,
  Trash2,
  Plus,
  X,
  Loader2,
  Clock,
} from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";

// ── Types ────────────────────────────────────────────────────────────────────

type CronAction = "reviewer" | "fix_issue" | "send_otis";

type CronRow = {
  id: number;
  name: string;
  schedule: string;
  action: CronAction;
  payload_json: string;
  repo: string | null;
  enabled: number;
  last_run_at: number | null;
  next_run_at: number | null;
  created_at: number;
  updated_at: number;
};

type CronRunRow = {
  id: number;
  cron_id: number;
  started_at: number;
  finished_at: number | null;
  ok: number;
  message: string | null;
  run_id: number | null;
};

type Repo = {
  id: number;
  owner: string;
  name: string;
  enabled: number;
};

type FormValues = {
  name: string;
  schedule: string;
  action: CronAction;
  repo: string;
  enabled: boolean;
  // fix_issue payload
  owner: string;
  repoName: string;
  issueNumber: string;
  // send_otis payload
  title: string;
  body: string;
};

// ── Constants ────────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<CronAction, string> = {
  reviewer: "Reviewer pass",
  fix_issue: "Fix issue",
  send_otis: "Send Otis",
};

const PRESETS: Array<{
  label: string;
  schedule: string;
  action: CronAction;
  title?: string;
}> = [
  { label: "Hourly reviewer", schedule: "0 * * * *", action: "reviewer" },
  {
    label: "Daily standup",
    schedule: "0 9 * * 1-5",
    action: "send_otis",
    title: "Daily standup digest",
  },
  {
    label: "Weekly cleanup",
    schedule: "0 9 * * 1",
    action: "send_otis",
    title: "Weekly cleanup pass",
  },
];

const EMPTY_FORM: FormValues = {
  name: "",
  schedule: "",
  action: "reviewer",
  repo: "",
  enabled: true,
  owner: "",
  repoName: "",
  issueNumber: "",
  title: "",
  body: "",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function timeUntil(ts: number): string {
  const diff = ts - Date.now();
  if (diff <= 0) return "now";
  if (diff < 60_000) return `in ${Math.ceil(diff / 1000)}s`;
  if (diff < 3_600_000) return `in ${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) {
    const h = Math.floor(diff / 3_600_000);
    const m = Math.floor((diff % 3_600_000) / 60_000);
    return m > 0 ? `in ${h}h ${m}m` : `in ${h}h`;
  }
  return `in ${Math.floor(diff / 86_400_000)}d`;
}

function buildPayload(v: FormValues): Record<string, unknown> {
  if (v.action === "fix_issue") {
    return {
      owner: v.owner,
      repo: v.repoName,
      issue_number: Number(v.issueNumber),
    };
  }
  if (v.action === "send_otis") {
    return { title: v.title, body: v.body };
  }
  return {};
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CronsPage() {
  const { data, mutate } = useSWR<{ crons: CronRow[] }>(
    "/api/crons",
    fetcher,
    { refreshInterval: 5000 },
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CronRow | null>(null);

  const crons = data?.crons ?? [];

  function openNew() {
    setEditTarget(null);
    setModalOpen(true);
  }

  function openEdit(cron: CronRow) {
    setEditTarget(cron);
    setModalOpen(true);
  }

  function handleClose() {
    setModalOpen(false);
    setEditTarget(null);
  }

  return (
    <div className="max-w-4xl mx-auto px-6 sm:px-8 py-10">
      {/* Header */}
      <header className="mb-8 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-serif text-3xl tracking-tight">Crons</h1>
          <p className="mt-1.5 text-sm text-[var(--fg-muted)]">
            Recurring actions — reviewer passes, issue fixes, Otis dispatches.
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={openNew}
          className="shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
          New cron
        </Button>
      </header>

      {/* List */}
      {crons.length === 0 ? (
        <EmptyState onNew={openNew} />
      ) : (
        <div className="space-y-3">
          {crons.map((c) => (
            <CronCard
              key={c.id}
              cron={c}
              onEdit={() => openEdit(c)}
              onMutate={mutate}
            />
          ))}
        </div>
      )}

      {/* Create / Edit modal */}
      <CronModal
        open={modalOpen}
        editTarget={editTarget}
        onClose={handleClose}
        onMutate={mutate}
      />
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--border)] p-12 text-center flex flex-col items-center gap-5">
      <Clock className="h-10 w-10 text-[var(--fg-subtle)]" />
      <div>
        <p className="text-sm font-medium text-[var(--fg)]">No crons yet</p>
        <p className="mt-1 text-sm text-[var(--fg-muted)]">
          Schedule a recurring reviewer pass or a daily issue from Otis.
        </p>
      </div>
      <Button variant="primary" onClick={onNew}>
        <Plus className="h-4 w-4" />
        Schedule your first cron
      </Button>
    </div>
  );
}

// ── Cron card ─────────────────────────────────────────────────────────────────

function CronCard({
  cron,
  onEdit,
  onMutate,
}: {
  cron: CronRow;
  onEdit: () => void;
  onMutate: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [running, setRunning] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Lazy-load history only when card is expanded
  const { data: detail } = useSWR<{ cron: CronRow; history: CronRunRow[] }>(
    expanded ? `/api/crons/${cron.id}` : null,
    fetcher,
    { refreshInterval: 5000 },
  );

  const history = detail?.history ?? [];
  const recentRuns = history.slice(0, 5);

  async function runNow() {
    setRunning(true);
    try {
      const res = await fetch(`/api/crons/${cron.id}/trigger`, {
        method: "POST",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `${res.status}`);
      toast.success(`Cron "${cron.name}" triggered`);
      onMutate();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  async function deleteCron() {
    if (!confirm(`Delete "${cron.name}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/crons/${cron.id}`, { method: "DELETE" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `${res.status}`);
      toast.success(`Deleted "${cron.name}"`);
      onMutate();
    } catch (err) {
      toast.error((err as Error).message);
      setDeleting(false);
    }
  }

  const enabled = cron.enabled === 1;

  return (
    <div
      className={cn(
        "rounded-xl border transition-colors",
        enabled
          ? "border-[var(--border)] bg-[var(--bg-elev)]"
          : "border-[var(--border)] bg-[var(--bg)] opacity-60",
      )}
    >
      {/* Main row */}
      <div className="px-4 py-4 flex items-center gap-4 flex-wrap sm:flex-nowrap">
        {/* Left: name + schedule + action */}
        <div
          className="flex-1 min-w-0 cursor-pointer"
          onClick={() => setExpanded((v) => !v)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={`Expand ${cron.name}`}
        >
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm truncate">{cron.name}</span>
            <Badge
              variant="default"
              className="text-[10px] shrink-0 border-[var(--border)] bg-[var(--bg-sunken)] text-[var(--fg-muted)]"
            >
              {ACTION_LABELS[cron.action]}
            </Badge>
            {!enabled && (
              <Badge variant="default" className="text-[10px] shrink-0">
                disabled
              </Badge>
            )}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-[var(--fg-muted)]">
            {cron.schedule}
          </div>
        </div>

        {/* Middle: timing */}
        <div className="text-xs text-[var(--fg-muted)] shrink-0 space-y-0.5 text-right sm:text-left">
          {cron.next_run_at ? (
            <div>
              Next run{" "}
              <span className="text-[var(--fg)]">
                {timeUntil(cron.next_run_at)}
              </span>
            </div>
          ) : (
            <div className="text-[var(--fg-subtle)]">No next run</div>
          )}
          {cron.last_run_at ? (
            <div>
              Last run &middot;{" "}
              <span className="text-[var(--fg)]">
                {relativeTime(cron.last_run_at)}
              </span>
            </div>
          ) : (
            <div className="text-[var(--fg-subtle)]">Never run</div>
          )}
        </div>

        {/* Right: actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={runNow}
            disabled={running}
            className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--bg-sunken)] transition-colors disabled:opacity-40"
            aria-label="Run now"
            title="Run now"
          >
            {running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            onClick={onEdit}
            className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--bg-sunken)] transition-colors"
            aria-label="Edit cron"
            title="Edit"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={deleteCron}
            disabled={deleting}
            className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-[var(--fg-muted)] hover:text-[var(--fail)] hover:bg-[var(--bg-sunken)] transition-colors disabled:opacity-40"
            aria-label="Delete cron"
            title="Delete"
          >
            {deleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* History dots row — always visible when there's a last_run_at */}
      {expanded && (
        <div className="px-4 pb-3 border-t border-[var(--border)] pt-3">
          <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--fg-subtle)] mb-2">
            Recent runs
          </div>
          {recentRuns.length === 0 ? (
            <span className="text-xs text-[var(--fg-subtle)]">
              No history yet.
            </span>
          ) : (
            <div className="flex items-center gap-1.5">
              {recentRuns.map((run) => (
                <RunDot key={run.id} run={run} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RunDot({ run }: { run: CronRunRow }) {
  const ok = run.ok === 1;
  return (
    <div className="relative group">
      <div
        className={cn(
          "h-3 w-3 rounded-full border",
          ok
            ? "bg-[var(--accent)] border-[var(--accent)]"
            : "bg-[var(--fail)] border-[var(--fail)]",
        )}
        aria-label={ok ? "ok" : "failed"}
      />
      {/* Tooltip on hover */}
      <div className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 z-10 hidden group-hover:block min-w-max">
        <div className="bg-[var(--bg-elev)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-[11px] text-[var(--fg)] shadow-lg max-w-[240px] break-words">
          <div className="font-mono text-[var(--fg-muted)] mb-0.5">
            {new Date(run.started_at).toLocaleString()}
          </div>
          {run.message ?? (ok ? "Success" : "Failed")}
        </div>
        <div className="mx-auto w-2 h-2 bg-[var(--bg-elev)] border-b border-r border-[var(--border)] rotate-45 -mt-1" />
      </div>
    </div>
  );
}

// ── Create / Edit Modal ───────────────────────────────────────────────────────

function CronModal({
  open,
  editTarget,
  onClose,
  onMutate,
}: {
  open: boolean;
  editTarget: CronRow | null;
  onClose: () => void;
  onMutate: () => void;
}) {
  const { data: reposData } = useSWR<{ connected: Repo[] }>(
    "/api/repos",
    fetcher,
  );
  const repos = reposData?.connected ?? [];

  const [form, setForm] = useState<FormValues>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [scheduleHint, setScheduleHint] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Populate form when editing
  useEffect(() => {
    if (!open) return;
    if (editTarget) {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(editTarget.payload_json) as Record<
          string,
          unknown
        >;
      } catch {}
      setForm({
        name: editTarget.name,
        schedule: editTarget.schedule,
        action: editTarget.action,
        repo: editTarget.repo ?? "",
        enabled: editTarget.enabled === 1,
        owner: (payload.owner as string) ?? "",
        repoName: (payload.repo as string) ?? "",
        issueNumber: String(payload.issue_number ?? ""),
        title: (payload.title as string) ?? "",
        body: (payload.body as string) ?? "",
      });
    } else {
      setForm(EMPTY_FORM);
    }
    setScheduleHint(null);
  }, [open, editTarget]);

  // Debounced schedule validation via cron-parser on client
  const validateSchedule = useCallback((schedule: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!schedule.trim()) {
      setScheduleHint(null);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        // Use the validate endpoint by checking the POST error path
        const res = await fetch("/api/crons", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "__validate__",
            schedule,
            action: "reviewer",
            enabled: false,
          }),
        });
        if (res.ok) {
          const body = (await res.json()) as { cron: CronRow };
          // Clean up the test cron
          fetch(`/api/crons/${body.cron.id}`, { method: "DELETE" }).catch(
            () => {},
          );
          if (body.cron.next_run_at) {
            setScheduleHint(
              `Next: ${new Date(body.cron.next_run_at).toLocaleString()}`,
            );
          }
        } else {
          const body = (await res.json()) as { error?: string };
          setScheduleHint(body.error ? `Invalid: ${body.error}` : "Invalid schedule");
        }
      } catch {
        setScheduleHint(null);
      }
    }, 600);
  }, []);

  function setField<K extends keyof FormValues>(k: K, v: FormValues[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
    if (k === "schedule") {
      validateSchedule(v as string);
    }
  }

  function applyPreset(p: (typeof PRESETS)[number]) {
    setForm((prev) => ({
      ...prev,
      schedule: p.schedule,
      action: p.action,
      title: p.title ?? prev.title,
      name: prev.name || p.label,
    }));
    validateSchedule(p.schedule);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.schedule.trim()) {
      toast.error("Name and schedule are required");
      return;
    }
    setSubmitting(true);
    const body = {
      name: form.name.trim(),
      schedule: form.schedule.trim(),
      action: form.action,
      payload: buildPayload(form),
      repo: form.repo || null,
      enabled: form.enabled,
    };
    try {
      if (editTarget) {
        const res = await fetch(`/api/crons/${editTarget.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok)
          throw new Error((data as { error?: string }).error ?? `${res.status}`);
        toast.success(`Updated "${form.name}"`);
      } else {
        const res = await fetch("/api/crons", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok)
          throw new Error((data as { error?: string }).error ?? `${res.status}`);
        toast.success(`Created "${form.name}"`);
      }
      onMutate();
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          className={cn(
            "fixed z-50 bg-[var(--bg)] border border-[var(--border)] shadow-2xl",
            "inset-x-0 bottom-0 sm:bottom-auto sm:inset-auto",
            "sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2",
            "w-full sm:max-w-lg",
            "rounded-t-2xl sm:rounded-2xl",
            "max-h-[90dvh] overflow-y-auto",
          )}
          aria-describedby="cron-modal-desc"
        >
          <div className="px-6 pt-6 pb-2 flex items-center justify-between">
            <Dialog.Title className="text-base font-semibold">
              {editTarget ? "Edit cron" : "New cron"}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-[var(--fg-muted)] hover:text-[var(--fg)] hover:bg-[var(--bg-elev)] transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description id="cron-modal-desc" className="sr-only">
            {editTarget ? "Edit an existing cron" : "Create a new scheduled cron action"}
          </Dialog.Description>

          <form onSubmit={handleSubmit} className="px-6 pb-6 space-y-5">
            {/* Presets */}
            {!editTarget && (
              <div>
                <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--fg-subtle)] mb-2">
                  Quick presets
                </div>
                <div className="flex flex-wrap gap-2">
                  {PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => applyPreset(p)}
                      className="px-2.5 py-1 text-xs rounded-lg border border-[var(--border)] text-[var(--fg-muted)] hover:border-[var(--border-strong)] hover:text-[var(--fg)] hover:bg-[var(--bg-elev)] transition-colors"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Name */}
            <FormField label="Name" htmlFor="cron-name">
              <input
                id="cron-name"
                type="text"
                value={form.name}
                onChange={(e) => setField("name", e.target.value)}
                placeholder="Hourly reviewer pass"
                required
                className={inputCls}
              />
            </FormField>

            {/* Schedule */}
            <FormField label="Schedule (cron expression)" htmlFor="cron-schedule">
              <input
                id="cron-schedule"
                type="text"
                value={form.schedule}
                onChange={(e) => setField("schedule", e.target.value)}
                placeholder="0 * * * *"
                required
                className={cn(inputCls, "font-mono")}
                spellCheck={false}
              />
              {scheduleHint && (
                <div
                  className={cn(
                    "mt-1 text-[11px] font-mono",
                    scheduleHint.startsWith("Invalid")
                      ? "text-[var(--fail)]"
                      : "text-[var(--accent)]",
                  )}
                >
                  {scheduleHint}
                </div>
              )}
            </FormField>

            {/* Action */}
            <FormField label="Action" htmlFor="cron-action">
              <select
                id="cron-action"
                value={form.action}
                onChange={(e) =>
                  setField("action", e.target.value as CronAction)
                }
                className={cn(inputCls, "cursor-pointer")}
              >
                <option value="reviewer">Reviewer pass</option>
                <option value="fix_issue">Fix issue</option>
                <option value="send_otis">Send Otis</option>
              </select>
            </FormField>

            {/* Action-specific payload */}
            {form.action === "fix_issue" && (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-sunken)] px-4 py-3 space-y-3">
                <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--fg-subtle)]">
                  Issue payload
                </div>
                <FormField label="Owner" htmlFor="payload-owner">
                  <input
                    id="payload-owner"
                    type="text"
                    value={form.owner}
                    onChange={(e) => setField("owner", e.target.value)}
                    placeholder="acme-corp"
                    className={inputCls}
                  />
                </FormField>
                <FormField label="Repo" htmlFor="payload-repo">
                  <input
                    id="payload-repo"
                    type="text"
                    value={form.repoName}
                    onChange={(e) => setField("repoName", e.target.value)}
                    placeholder="my-repo"
                    className={inputCls}
                  />
                </FormField>
                <FormField label="Issue number" htmlFor="payload-issue">
                  <input
                    id="payload-issue"
                    type="number"
                    value={form.issueNumber}
                    onChange={(e) => setField("issueNumber", e.target.value)}
                    placeholder="42"
                    className={inputCls}
                    min={1}
                  />
                </FormField>
              </div>
            )}

            {form.action === "send_otis" && (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-sunken)] px-4 py-3 space-y-3">
                <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--fg-subtle)]">
                  Message payload
                </div>
                <FormField label="Title" htmlFor="payload-title">
                  <input
                    id="payload-title"
                    type="text"
                    value={form.title}
                    onChange={(e) => setField("title", e.target.value)}
                    placeholder="Daily standup digest"
                    className={inputCls}
                  />
                </FormField>
                <FormField label="Body" htmlFor="payload-body">
                  <textarea
                    id="payload-body"
                    value={form.body}
                    onChange={(e) => setField("body", e.target.value)}
                    placeholder="Optional message body…"
                    rows={3}
                    className={cn(inputCls, "resize-none")}
                  />
                </FormField>
              </div>
            )}

            {/* Repo */}
            <FormField label="Repo" htmlFor="cron-repo">
              <select
                id="cron-repo"
                value={form.repo}
                onChange={(e) => setField("repo", e.target.value)}
                className={cn(inputCls, "cursor-pointer")}
              >
                <option value="">Any (first enabled)</option>
                {repos.map((r) => (
                  <option key={r.id} value={`${r.owner}/${r.name}`}>
                    {r.owner}/{r.name}
                  </option>
                ))}
              </select>
            </FormField>

            {/* Enabled toggle */}
            <div className="flex items-center justify-between">
              <label
                htmlFor="cron-enabled"
                className="text-sm text-[var(--fg-muted)]"
              >
                Enabled
              </label>
              <button
                id="cron-enabled"
                type="button"
                role="switch"
                aria-checked={form.enabled}
                onClick={() => setField("enabled", !form.enabled)}
                className={cn(
                  "relative inline-flex h-5 w-9 items-center rounded-full border transition-colors",
                  form.enabled
                    ? "bg-[var(--accent)] border-[var(--accent)]"
                    : "bg-[var(--bg-sunken)] border-[var(--border)]",
                )}
              >
                <span
                  className={cn(
                    "inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform",
                    form.enabled ? "translate-x-4" : "translate-x-1",
                  )}
                />
              </button>
            </div>

            {/* Submit */}
            <div className="flex items-center justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-[var(--fg-muted)] hover:text-[var(--fg)] transition-colors"
              >
                Cancel
              </button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={submitting}
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Saving…
                  </>
                ) : editTarget ? (
                  "Save changes"
                ) : (
                  "Create cron"
                )}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ── Shared form helpers ───────────────────────────────────────────────────────

const inputCls =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--bg-sunken)] px-3 py-2 text-sm text-[var(--fg)] placeholder:text-[var(--fg-subtle)] focus:outline-none focus:border-[var(--border-strong)] transition-colors";

function FormField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="text-xs font-medium text-[var(--fg-muted)] uppercase tracking-[0.1em]"
      >
        {label}
      </label>
      {children}
    </div>
  );
}
