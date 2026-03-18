"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME ?? "Resint";
const BRAND_LOGO_SRC = process.env.NEXT_PUBLIC_BRAND_LOGO_SRC ?? "/new_logo.svg";

export default function LoginPage() {
  const router = useRouter();
  const [logoLoadFailed, setLogoLoadFailed] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    document.title = "RESINT — Вход";
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        const status = response.status;
        let message = "";
        try {
          const contentType = response.headers.get("content-type") ?? "";
          if (contentType.includes("application/json")) {
            const data = (await response.json()) as { error?: string };
            message = data?.error ?? "";
          } else {
            message = await response.text();
          }
        } catch {
          message = "";
        }

        if (status === 401) {
          throw new Error("Неверный логин или пароль");
        }

        if (status === 403) {
          throw new Error("Аккаунт заблокирован. Обратитесь к менеджеру.");
        }

        if (status === 502 || status === 504) {
          throw new Error("Сервер недоступен. Проверьте, что backend и база данных запущены.");
        }

        throw new Error(message || "Не удалось войти");
      }
      router.replace("/inventory");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось войти");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-7rem)] w-full max-w-md items-center px-1">
      <div className="w-full rounded-3xl border border-border/70 bg-card/95 p-5 shadow-md md:p-7">
        <div className="mb-5 flex justify-center">
          <div className="inline-flex items-center gap-2 rounded-2xl border border-border/70 bg-background/70 px-4 py-2.5 shadow-sm backdrop-blur-sm">
            {!logoLoadFailed ? (
              <img
                src={BRAND_LOGO_SRC}
                alt={BRAND_NAME}
                className="h-11 w-auto shrink-0 object-contain"
                onError={() => setLogoLoadFailed(true)}
              />
            ) : (
              <span className="text-sm font-semibold text-foreground">{BRAND_NAME}</span>
            )}
          </div>
        </div>

        <div className="mb-5 flex justify-center">
          <div className="flex flex-col items-center">
            <p className="text-[13px] font-bold uppercase tracking-[0.2em] text-foreground/50">
              RESINT
            </p>
            <p className="-mt-0.5 text-[10px] font-normal tracking-wide text-muted-foreground/70">
              restaurant system
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-border/70 bg-background/65 px-4 py-4 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">Вход</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            Используйте свои учетные данные.
          </p>
        </div>

        <form onSubmit={onSubmit} className="mt-4 grid gap-3">
          <div className="rounded-2xl border border-border/70 bg-background/75 p-3.5 shadow-sm">
            <div className="grid gap-2">
              <label className="text-sm font-medium tracking-tight">Логин</label>
              <Input
                data-testid="login-username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Введите логин"
                autoComplete="username"
                required
                className="h-11 rounded-xl"
              />
            </div>
          </div>

          <div className="rounded-2xl border border-border/70 bg-background/75 p-3.5 shadow-sm">
            <div className="grid gap-2">
              <label className="text-sm font-medium tracking-tight">Пароль</label>
              <Input
                data-testid="login-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
                className="h-11 rounded-xl"
              />
            </div>
          </div>

          {error ? (
            <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <Button
            data-testid="login-submit"
            type="submit"
            className="mt-1 h-11 rounded-xl font-medium"
            disabled={pending}
          >
            {pending ? "Входим..." : "Войти"}
          </Button>
        </form>
      </div>
    </div>
  );
}
