import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m${s}s`;
}

export function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export function statusColor(status: string): string {
  switch (status) {
    case "pr-opened":
    case "succeeded":
      return "text-emerald-600 bg-emerald-50 border-emerald-200";
    case "needs-review":
      return "text-amber-700 bg-amber-50 border-amber-200";
    case "failed":
      return "text-red-700 bg-red-50 border-red-200";
    case "abandoned":
      return "text-zinc-600 bg-zinc-100 border-zinc-200";
    case "planning":
    case "implementing":
    case "verifying":
    case "iterating":
      return "text-sky-700 bg-sky-50 border-sky-200";
    default:
      return "text-zinc-600 bg-zinc-50 border-zinc-200";
  }
}

export function formatUsd(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}
