"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { useActiveCount } from "@/lib/hooks";
import { OtisMark } from "./icons/OtisMark";
import { LiveDot } from "./icons/LiveDot";
import { CommandHint } from "./CommandHint";
import { RepoSelector } from "./RepoSelector";

/**
 * Layout chrome. The reactive bits (search params, live counts, repo
 * scoping) hide behind a Suspense boundary so `/_not-found` and other static
 * pages can still prerender — Next 16's prerender CSR-bailout otherwise.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen flex flex-col">
      <Suspense fallback={<TopBarSkeleton />}>
        <TopBar />
      </Suspense>
      <Suspense fallback={<NavStripSkeleton pathname={pathname} />}>
        <NavStrip pathname={pathname} />
      </Suspense>
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}

function TopBar() {
  const active = useActiveCount();
  return (
    <header className="h-14 px-6 flex items-center justify-between border-b border-border bg-[var(--bg)]">
      <BrandLink />
      <div className="flex items-center gap-3">
        <RepoSelector />
        <div className="flex items-center gap-2 px-2.5 py-1 rounded border border-border bg-[var(--bg-elev)]">
          <LiveDot active={active > 0} />
          <span className="text-xs text-[var(--fg-muted)] tabular-nums">
            {active > 0 ? `${active} in flight` : "idle"}
          </span>
        </div>
        <CommandHint />
      </div>
    </header>
  );
}

function TopBarSkeleton() {
  return (
    <header className="h-14 px-6 flex items-center justify-between border-b border-border bg-[var(--bg)]">
      <BrandLink />
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-2.5 py-1 rounded border border-border bg-[var(--bg-elev)]">
          <LiveDot active={false} />
          <span className="text-xs text-[var(--fg-muted)]">idle</span>
        </div>
        <CommandHint />
      </div>
    </header>
  );
}

function BrandLink() {
  return (
    <Link href="/" className="flex items-center gap-3 group">
      <OtisMark className="h-8 w-8" />
      <div className="leading-tight">
        <div className="font-serif text-lg text-[var(--fg)] group-hover:opacity-90 transition-opacity">
          Otis
        </div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-[var(--fg-muted)]">
          AI engineer · 42nights
        </div>
      </div>
    </Link>
  );
}

const NAV = [
  { href: "/", label: "Home" },
  { href: "/sessions", label: "Sessions" },
  { href: "/inbox", label: "Inbox" },
  { href: "/settings", label: "Settings" },
] as const;

function NavStrip({ pathname }: { pathname: string }) {
  const search = useSearchParams();
  const repoParam = search.get("repo");
  const navQs = repoParam ? `?repo=${encodeURIComponent(repoParam)}` : "";
  return <NavStripBase pathname={pathname} navQs={navQs} />;
}

function NavStripSkeleton({ pathname }: { pathname: string }) {
  return <NavStripBase pathname={pathname} navQs="" />;
}

function NavStripBase({
  pathname,
  navQs,
}: {
  pathname: string;
  navQs: string;
}) {
  return (
    <nav className="h-11 px-6 flex items-end gap-1 border-b border-border bg-[var(--bg)]">
      {NAV.map(({ href, label }) => {
        const active =
          pathname === href || (href !== "/" && pathname.startsWith(href));
        return (
          <Link
            key={href}
            href={`${href}${navQs}`}
            className={cn(
              "px-3 h-full inline-flex items-center text-sm transition-colors relative",
              active
                ? "text-[var(--fg)]"
                : "text-[var(--fg-muted)] hover:text-[var(--fg)]",
            )}
          >
            {label}
            {active && (
              <span className="absolute bottom-0 left-3 right-3 h-px bg-[var(--accent)]" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
