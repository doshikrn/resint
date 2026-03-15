"use client";

import React, { useEffect, useRef } from "react";

/* ------------------------------------------------------------------ */
/*  Keyframes injected once into <head>                                */
/* ------------------------------------------------------------------ */
const STYLE_ID = "success-glow-kf";

function ensureKeyframes() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
@keyframes _sgGlow {
  0%   { opacity: 0; }
  18%  { opacity: 0.85; }
  38%  { opacity: 1; }
  100% { opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  @keyframes _sgGlow {
    0%   { opacity: 0; }
    30%  { opacity: 0.5; }
    100% { opacity: 0; }
  }
}`;
  document.head.appendChild(style);
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

type SuccessGlowProps = { active: boolean };

/**
 * Full-height green glow on the left & right viewport edges.
 *
 * Renders only while `active` is true. Use a changing `key` prop from the
 * parent to force remount on rapid successive saves — this restarts the
 * CSS animation from scratch.
 *
 * - `pointer-events: none` — won't block input
 * - `position: fixed`       — no layout shift
 * - `prefers-reduced-motion` — simpler opacity fade, no peak
 */
function SuccessGlowInner({ active }: SuccessGlowProps) {
  const injected = useRef(false);
  useEffect(() => {
    if (!injected.current) {
      ensureKeyframes();
      injected.current = true;
    }
  }, []);

  if (!active) return null;

  const base: React.CSSProperties = {
    position: "fixed",
    top: 0,
    bottom: 0,
    width: 8,
    zIndex: 50,
    pointerEvents: "none",
    animationName: "_sgGlow",
    animationDuration: "1100ms",
    animationTimingFunction: "ease-out",
    animationFillMode: "forwards",
  };

  return (
    <>
      <div
        aria-hidden
        style={{
          ...base,
          left: 0,
          background:
            "linear-gradient(to right, rgba(34,197,94,0.92), transparent)",
        }}
      />
      <div
        aria-hidden
        style={{
          ...base,
          right: 0,
          background:
            "linear-gradient(to left, rgba(34,197,94,0.92), transparent)",
        }}
      />
    </>
  );
}

export const SuccessGlow = React.memo(SuccessGlowInner);
