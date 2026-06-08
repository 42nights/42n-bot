"use client";

import { useEffect, useState } from "react";
import { Toaster } from "sonner";

/**
 * Toaster that follows the app theme. Light is the default; it flips to dark
 * only when the user has opted in (the `.dark` class the pre-hydration script
 * adds from localStorage). A MutationObserver keeps it in sync with the live
 * toggle in Settings / the command palette without a reload.
 */
export function ThemedToaster() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const root = document.documentElement;
    const sync = () =>
      setTheme(root.classList.contains("dark") ? "dark" : "light");
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  return <Toaster position="top-right" theme={theme} />;
}
