"use client";

import { useEffect, useState } from "react";

import { PageStub } from "@/components/layout/page-stub";
import { mapApiError } from "@/lib/api/error-mapper";
import { getCurrentUser, getInventoryProgress, type InventoryZoneProgress } from "@/lib/api/http";

// Set page title
const PAGE_TITLE = "RESINT \u2014 \u041f\u0430\u043d\u0435\u043b\u044c";

const ROLE_LABELS_RU: Record<string, string> = {
  cook: "Повар",
  souschef: "Су-шеф",
  chef: "Шеф-повар",
  admin: "Шеф-повар",
};

function toRoleLabelRu(role: string): string {
  return ROLE_LABELS_RU[role] ?? role;
}

export default function DashboardPage() {
  const [status, setStatus] = useState("Загрузка...");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState("");
  const [progressRows, setProgressRows] = useState<InventoryZoneProgress[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorDebug, setErrorDebug] = useState<string | null>(null);

  useEffect(() => {
    document.title = PAGE_TITLE;
  }, []);

  useEffect(() => {
    let active = true;

    Promise.all([getCurrentUser(), getInventoryProgress({ includeClosed: false })])
      .then(([user, progress]) => {
        if (!active) return;
        setUsername(user.username);
        setRole(user.role_label || toRoleLabelRu(user.role));
        setProgressRows(progress);
        setErrorMessage(null);
        setErrorDebug(null);
        setStatus("Данные успешно загружены");
      })
      .catch((error) => {
        if (!active) return;
        const mapped = mapApiError(error, {
          defaultMessage: "Не удалось загрузить дашборд",
        });
        setStatus(mapped.message);
        setErrorMessage(mapped.inlineMessage);
        setErrorDebug(mapped.debug ?? null);
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <PageStub title="Панель" description="Сводка по текущей работе.">
      <div className="rounded-lg border bg-background p-4 text-sm">
        <p className="font-medium">Статус: {status}</p>
        {username ? <p className="mt-1 text-muted-foreground">Пользователь: {username}</p> : null}
        {role ? <p className="text-muted-foreground">Роль: {role}</p> : null}
        {errorMessage ? <p className="mt-2 text-amber-700">{errorMessage}</p> : null}
        {errorDebug ? <p className="mt-1 text-xs text-muted-foreground">отладка: {errorDebug}</p> : null}
      </div>
      <div className="rounded-lg border bg-background p-4 text-sm">
        <p className="font-medium">Прогресс по зонам</p>
        {progressRows.length === 0 ? (
          <p className="mt-1 text-muted-foreground">Пока нет активного прогресса по зонам.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {progressRows.map((row) => (
              <div key={row.session_id} className="rounded border px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium">
                    {row.zone_name} / {row.warehouse_name}
                  </span>
                  <span className={row.is_completed ? "text-emerald-600" : "text-amber-600"}>
                    {row.is_completed ? "Завершено" : "Не завершено"}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Внесено позиций: {row.entered_items_count}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </PageStub>
  );
}
