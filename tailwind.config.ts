import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "var(--font-display)",
          "var(--font-geist-sans)",
          "ui-sans-serif",
          "system-ui",
        ],
        display: [
          "var(--font-display)",
          "var(--font-geist-sans)",
          "ui-sans-serif",
          "system-ui",
        ],
        mono: [
          "var(--font-mono-family)",
          "var(--font-geist-mono)",
          "ui-monospace",
          "SFMono-Regular",
        ],
        serif: [
          "var(--font-serif)",
          "ui-serif",
          "Georgia",
        ],
      },
      colors: {
        // Map shadcn-style class names onto our oklch CSS vars. We intentionally
        // expose raw `var(--token)` here (not hsl-wrapped) so Tailwind v3 picks
        // up arbitrary color spaces via the CSS-vars escape hatch.
        background: "var(--bg)",
        foreground: "var(--fg)",
        muted: {
          DEFAULT: "var(--bg-sunken)",
          foreground: "var(--fg-muted)",
        },
        border: "var(--border)",
        primary: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-fg)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-fg)",
          soft: "var(--accent-soft)",
        },
        plan: {
          DEFAULT: "var(--plan)",
          soft: "var(--plan-soft)",
        },
        warn: {
          DEFAULT: "var(--warn)",
          soft: "var(--warn-soft)",
        },
        fail: {
          DEFAULT: "var(--fail)",
          soft: "var(--fail-soft)",
        },
        destructive: {
          DEFAULT: "var(--fail)",
          foreground: "var(--accent-fg)",
        },
        success: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-fg)",
        },
        warning: {
          DEFAULT: "var(--warn)",
          foreground: "var(--accent-fg)",
        },
      },
      borderRadius: {
        DEFAULT: "var(--radius)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontSize: {
        display: ["3.5rem", { lineHeight: "1.05", letterSpacing: "-0.025em" }],
      },
      keyframes: {
        pulse: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
