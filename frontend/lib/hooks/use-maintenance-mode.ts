import { useEffect, useState } from "react";
import { checkHealthReady } from "@/lib/api/http";

/**
 * Polls GET /health/ready every 30 seconds while enabled.
 * Returns whether the backend is in maintenance mode.
 */
export function useMaintenanceMode(enabled: boolean): boolean {
  const [maintenanceMode, setMaintenanceMode] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    const poll = () => {
      checkHealthReady()
        .then((data) => setMaintenanceMode(data.maintenance_mode === true))
        .catch(() => {});
    };
    poll();
    const id = window.setInterval(poll, 30_000);
    return () => window.clearInterval(id);
  }, [enabled]);

  return maintenanceMode;
}
