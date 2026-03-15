import { ApiRequestError } from "@/lib/api/http";

type ApiErrorDetailPayload = {
  code?: string;
  message?: string;
};

type ParsedApiError = {
  status?: number;
  code?: string;
  message?: string;
  raw?: string;
};

export type MappedUiError = {
  message: string;
  inlineMessage: string;
  debug?: string;
};

function parseApiErrorDetail(body: string): ApiErrorDetailPayload | null {
  if (!body) {
    return null;
  }

  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const maybeDetail = (parsed as { detail?: unknown }).detail;
    if (maybeDetail && typeof maybeDetail === "object") {
      const detailObj = maybeDetail as { code?: unknown; message?: unknown };
      return {
        code: typeof detailObj.code === "string" ? detailObj.code : undefined,
        message: typeof detailObj.message === "string" ? detailObj.message : undefined,
      };
    }

    // Also handle {error: {code, message}} envelope
    const maybeError = (parsed as { error?: unknown }).error;
    if (maybeError && typeof maybeError === "object") {
      const errorObj = maybeError as { code?: unknown; message?: unknown };
      return {
        code: typeof errorObj.code === "string" ? errorObj.code : undefined,
        message: typeof errorObj.message === "string" ? errorObj.message : undefined,
      };
    }

    return null;
  } catch {
    return null;
  }
}

function parseError(error: unknown): ParsedApiError {
  if (error instanceof ApiRequestError) {
    const detail = parseApiErrorDetail(error.body);
    return {
      status: error.status,
      code: detail?.code,
      message: detail?.message,
      raw: error.body,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      raw: error.stack ?? error.message,
    };
  }

  return {};
}

export function mapApiError(
  error: unknown,
  options?: {
    defaultMessage?: string;
    queuedOfflineMessage?: string;
  },
): MappedUiError {
  const parsed = parseError(error);
  const status = parsed.status;
  const code = (parsed.code ?? "").toUpperCase();
  const message = (parsed.message ?? "").toLowerCase();

  const queuedOfflineMessage = options?.queuedOfflineMessage ?? "Нет сети — сохранили в очередь";

  let userMessage = options?.defaultMessage ?? "Произошла ошибка. Повторите попытку";

  if (status === 0) {
    userMessage = queuedOfflineMessage;
  } else if (code === "MAINTENANCE_MODE" || status === 503) {
    userMessage = "Система находится в режиме обслуживания";
  } else if (code === "SESSION_CLOSED" || message.includes("session is closed")) {
    userMessage = "Сессия закрыта";
  } else if (status === 403 || code === "SESSION_READ_ONLY") {
    userMessage = "Нет доступа";
  } else if (status === 409 || code === "VERSION_CONFLICT" || message.includes("conflict")) {
    userMessage = "Конфликт: кто-то уже изменил";
  } else if (code === "VALIDATION_STEP_MISMATCH") {
    userMessage = "Количество не соответствует шагу товара";
  } else if (code === "ITEM_INACTIVE") {
    userMessage = "Позиция недоступна для изменений";
  }

  const debug = process.env.NODE_ENV !== "production" ? parsed.raw : undefined;

  return {
    message: userMessage,
    inlineMessage: userMessage,
    debug,
  };
}
