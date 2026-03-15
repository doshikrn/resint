import { useCallback, useRef, useState } from "react";

const GLOW_DURATION_MS = 1100;

/**
 * Manages a success-glow animation cycle.
 *
 * Returns `{ glowing, glowKey, trigger }`.
 * - `glowing`  — true while the animation is active.
 * - `glowKey`  — monotonic counter; use as React `key` on the glow overlay
 *                so rapid successive triggers each force a remount and restart
 *                the CSS animation from scratch.
 * - `trigger()` — starts (or restarts) the glow; safe to call rapidly.
 */
export function useSuccessGlow() {
  const [glowing, setGlowing] = useState(false);
  const [glowKey, setGlowKey] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trigger = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }
    setGlowing(true);
    setGlowKey((k) => k + 1);
    timerRef.current = setTimeout(() => {
      setGlowing(false);
      timerRef.current = null;
    }, GLOW_DURATION_MS);
  }, []);

  return { glowing, glowKey, trigger } as const;
}
