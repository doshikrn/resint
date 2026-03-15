"use client";

import { useEffect } from "react";
import { nuclearReset } from "@/lib/client-version";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[ErrorBoundary]", error);

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
    <div className="mx-auto flex min-h-[60dvh] max-w-md flex-col items-center justify-center px-4 text-center">
      <div className="rounded-2xl border border-amber-300/80 bg-amber-50/80 p-6 shadow-sm">
        <p className="text-lg font-semibold text-amber-900">Произошла ошибка</p>
        <p className="mt-2 text-sm text-amber-800">
          Что-то пошло не так. Попробуйте обновить страницу.
        </p>
        <div className="mt-4 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            Повторить
          </button>
          <button
            type="button"
            onClick={() => (window.location.href = "/inventory")}
            className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground shadow-sm hover:bg-muted"
          >
            На главную
          </button>
        </div>
        <button
          type="button"
          onClick={nuclearReset}
          className="mt-3 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Сбросить кэш и перезагрузить
        </button>
      </div>
    </div>
  );
}
