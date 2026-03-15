import { useEffect } from "react";
import { sendHeartbeat } from "@/lib/api/http";

/**
 * Sends a heartbeat POST every 30 seconds while enabled.
 * Fire-and-forget — errors are silently swallowed.
 */
export function useHeartbeat(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    sendHeartbeat().catch(() => {});
    const id = window.setInterval(() => {
      sendHeartbeat().catch(() => {});
    }, 30_000);
    return () => window.clearInterval(id);
  }, [enabled]);
}
