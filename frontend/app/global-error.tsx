"use client";

import { useEffect } from "react";
import { nuclearReset } from "@/lib/client-version";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GlobalError]", error);

    // ChunkLoadError means a new deployment invalidated cached chunks — hard reload once
    if (
      error.name === "ChunkLoadError" ||
      error.message?.includes("Loading chunk") ||
      error.message?.includes("Failed to fetch dynamically imported module")
    ) {
      const key = "__RESINT_CLE";
      const last = sessionStorage.getItem(key);
      if (!last || Date.now() - Number(last) > 10_000) {
        sessionStorage.setItem(key, String(Date.now()));
        window.location.reload();
        return;
      }
    }
  }, [error]);

  return (
    <html lang="ru">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>
        <div
          style={{
            display: "flex",
            minHeight: "100dvh",
            alignItems: "center",
            justifyContent: "center",
            padding: "1rem",
            textAlign: "center",
          }}
        >
          <div
            style={{
              maxWidth: "28rem",
              borderRadius: "1rem",
              border: "1px solid #fcd34d",
              backgroundColor: "#fffbeb",
              padding: "1.5rem",
            }}
          >
            <p style={{ fontSize: "1.125rem", fontWeight: 600, color: "#78350f" }}>
              Произошла ошибка
            </p>
            <p style={{ marginTop: "0.5rem", fontSize: "0.875rem", color: "#92400e" }}>
              Что-то пошло не так. Попробуйте обновить страницу.
            </p>
            <div
              style={{
                marginTop: "1rem",
                display: "flex",
                gap: "0.5rem",
                justifyContent: "center",
              }}
            >
              <button
                type="button"
                onClick={reset}
                style={{
                  borderRadius: "0.5rem",
                  backgroundColor: "#18181b",
                  color: "#fafafa",
                  padding: "0.5rem 1rem",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                Повторить
              </button>
              <button
                type="button"
                onClick={() => (window.location.href = "/inventory")}
                style={{
                  borderRadius: "0.5rem",
                  backgroundColor: "#fff",
                  color: "#18181b",
                  padding: "0.5rem 1rem",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                  border: "1px solid #e4e4e7",
                  cursor: "pointer",
                }}
              >
                На главную
              </button>
            </div>
            <button
              type="button"
              onClick={nuclearReset}
              style={{
                marginTop: "0.75rem",
                fontSize: "0.75rem",
                color: "#a1a1aa",
                textDecoration: "underline",
                background: "none",
                border: "none",
                cursor: "pointer",
              }}
            >
              Сбросить кэш и перезагрузить
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
