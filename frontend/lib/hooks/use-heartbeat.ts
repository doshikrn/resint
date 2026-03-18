import { useCallback, useEffect, useRef } from "react";
import { sendHeartbeat } from "@/lib/api/http";

/**
 * Sends a heartbeat POST every 30 seconds while enabled.
 * Pauses when the tab is hidden (visibilitychange) so background tabs
 * don't keep the user artificially "online".
 * Fire-and-forget — errors are silently swallowed.
 */
export function useHeartbeat(enabled: boolean) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const start = useCallback(() => {
    if (intervalRef.current !== null) return;
    sendHeartbeat().catch(() => {});
    intervalRef.current = setInterval(() => {
      sendHeartbeat().catch(() => {});
    }, 30_000);
  }, []);

  const stop = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      stop();
      return;
    }

    // Only heartbeat when the tab is visible
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      start();
    }

    const onVisibility = () => {
      if (!enabledRef.current) return;
      if (document.visibilityState === "visible") {
        start();
      } else {
        stop();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, start, stop]);
}
