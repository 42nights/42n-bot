import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Newsreader } from "next/font/google";
import { Toaster } from "sonner";
import { Shell } from "@/components/Shell";
import { CommandPalette } from "@/components/CommandPalette";
import { tenant } from "@/lib/tenant";
import "./globals.css";

const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: `${tenant.displayName} — AI engineer at 42nights`,
  description:
    `${tenant.displayName} reads issues. Writes PRs. Asks before doing anything risky.`,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      // Dark by default. The .dark token set in globals.css activates here.
      className={`dark ${GeistSans.variable} ${GeistMono.variable} ${newsreader.variable}`}
      style={
        {
          // Map Geist's emitted CSS variables onto our generic display/mono
          // family vars so the rest of the system stays font-agnostic.
          "--font-display": "var(--font-geist-sans)",
          "--font-mono-family": "var(--font-geist-mono)",
        } as React.CSSProperties
      }
    >
      <head>
        {tenant.logoUrl && (
          <link rel="icon" href={tenant.logoUrl} />
        )}
        {tenant.primaryColor && (
          <style>{`:root { --tenant-primary: ${tenant.primaryColor}; } .dark { --tenant-primary: ${tenant.primaryColor}; }`}</style>
        )}
      </head>
      <body className="min-h-screen antialiased bg-[var(--bg)] text-[var(--fg)]">
        <Shell>{children}</Shell>
        <Toaster position="top-right" theme="dark" />
        <CommandPalette />
      </body>
    </html>
  );
}
