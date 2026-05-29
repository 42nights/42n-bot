"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Activity, ListChecks, MessagesSquare, Boxes, Settings } from "lucide-react";

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const nav = [
    { href: "/", label: "Live", icon: Activity },
    { href: "/runs", label: "Runs", icon: ListChecks },
    { href: "/chat", label: "Chat", icon: MessagesSquare },
    { href: "/repos", label: "Repos", icon: Boxes },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 border-r border-border bg-background/50 flex flex-col">
        <div className="p-6 border-b border-border">
          <Link href="/" className="block">
            <div className="font-serif text-2xl tracking-tight flex items-baseline gap-1.5">
              <span>42n</span>
              <span className="text-[hsl(var(--primary))]">·</span>
              <span className="font-mono text-base">bot</span>
            </div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mt-0.5">
              Autonomous coding agent
            </div>
          </Link>
        </div>

        <nav className="p-3 flex flex-col gap-0.5">
          {nav.map(({ href, label, icon: Icon }) => {
            const active =
              pathname === href || (href !== "/" && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 text-sm rounded-md transition-colors",
                  active
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto p-4 border-t border-border">
          <div className="text-[11px] text-muted-foreground">
            v0.1 · local
          </div>
        </div>
      </aside>
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
