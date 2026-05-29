import type { Metadata } from "next";
import { Inter, Crimson_Pro, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { Shell } from "@/components/Shell";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const crimson = Crimson_Pro({ subsets: ["latin"], variable: "--font-crimson" });
const jb = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "42n-bot — autonomous coding agent",
  description: "Issues → grounded PRs, overnight. Verification harness in front of every merge.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${crimson.variable} ${jb.variable}`}
    >
      <body className="min-h-screen font-sans antialiased bg-[hsl(240,10%,99%)]">
        <Shell>{children}</Shell>
        <Toaster position="top-right" />
      </body>
    </html>
  );
}
