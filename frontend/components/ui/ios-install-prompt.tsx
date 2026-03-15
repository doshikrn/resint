"use client";

import { useEffect, useState } from "react";
import { Share, X } from "lucide-react";
import { useLanguage } from "@/lib/i18n/language-provider";

const DISMISS_KEY = "resint-ios-install-dismissed";

/**
 * Detects iOS Safari (not already in standalone PWA mode) and shows
 * a one-time dismissable banner explaining how to add to Home Screen.
 */
export function IosInstallPrompt() {
  const { t } = useLanguage();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Only show on iOS Safari, not in standalone mode
    const isIos =
      /iP(hone|ad|od)/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const isStandalone =
      "standalone" in navigator && (navigator as { standalone?: boolean }).standalone === true;
    const dismissed = localStorage.getItem(DISMISS_KEY) === "1";

    if (isIos && !isStandalone && !dismissed) {
      // Delay slightly so the page loads first
      const timer = setTimeout(() => setVisible(true), 2000);
      return () => clearTimeout(timer);
    }
  }, []);

  if (!visible) return null;

  function dismiss() {
    setVisible(false);
    localStorage.setItem(DISMISS_KEY, "1");
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]">
      <div className="relative w-full max-w-sm rounded-2xl border border-border/70 bg-card p-4 shadow-lg">
        <button
          onClick={dismiss}
          className="absolute right-2 top-2 rounded-full p-1.5 text-muted-foreground/60 hover:bg-muted/50 hover:text-foreground"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex items-start gap-3 pr-6">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Share className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-medium leading-snug text-foreground">
              {t("pwa.ios_install_title")}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t("pwa.ios_install_body")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
