import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Newsreader } from "next/font/google";
import { Shell } from "@/components/Shell";
import { ThemedToaster } from "@/components/ThemedToaster";
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
  metadataBase: new URL("https://otis-two.vercel.app"),
  title: `${tenant.displayName} — AI engineer at 42nights`,
  description: `${tenant.displayName} reads issues. Writes PRs. Asks before doing anything risky.`,
  openGraph: {
    title: `${tenant.displayName} — AI engineer at 42nights`,
    description: `${tenant.displayName} reads issues. Writes PRs. Asks before doing anything risky.`,
    url: "https://otis-two.vercel.app",
    siteName: "42nights",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `${tenant.displayName} — AI engineer at 42nights`,
    description: `${tenant.displayName} reads issues. Writes PRs.`,
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      // Light by default (the :root tokens in globals.css). A returning user's
      // dark choice is applied pre-paint by the inline script below, which adds
      // the .dark class before first paint — so there's no light→dark flash.
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable} ${newsreader.variable}`}
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
        {/* Pre-hydration theme bootstrap: light default, dark only on explicit
            opt-in stored in localStorage. Runs before paint to avoid a flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('otis-theme')==='dark'){document.documentElement.classList.add('dark')}}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-screen antialiased bg-[var(--bg)] text-[var(--fg)]">
        <Shell>{children}</Shell>
        <ThemedToaster />
        <CommandPalette />
      </body>
    </html>
  );
}
