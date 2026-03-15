"use client";

import { useEffect } from "react";
import { healStaleClientState } from "@/lib/client-version";

/**
 * Registers the service worker on page load.
 * Checks for SW updates when the app regains visibility so new
 * deployments are picked up without waiting for the 24-hour default.
 * Also runs stale-state healing on every mount (no-op if build hasn't changed).
 */
export function SwRegistrar() {
  useEffect(() => {
    // Detect deployment change and clear stale caches before anything else
    healStaleClientState().catch(() => {});

    if (!("serviceWorker" in navigator)) return;

    let reg: ServiceWorkerRegistration | undefined;

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((r) => {
        reg = r;
      })
      .catch((err) => {
        console.warn("SW registration failed:", err);
      });

    const onVisChange = () => {
      if (document.visibilityState === "visible" && reg) {
        reg.update().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVisChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisChange);
    };
  }, []);

  return null;
}
