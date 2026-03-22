/**
 * Pure quantity-validation logic extracted from useFastEntry.
 *
 * All inputs are plain values — no React hooks required.
 */

import type { ItemSearchResult } from "@/lib/api/http";
import type { DictionaryKeys } from "@/lib/i18n";

export type QtyValidationResult = {
  normalizedQty: number | null;
  error: string | null;
  wasRounded: boolean;
  roundedFrom: number | null;
  roundedTo: number | null;
  softWarning: string | null;
  confirmWarnings: string[];
};

const EMPTY: QtyValidationResult = {
  normalizedQty: null,
  error: null,
  wasRounded: false,
  roundedFrom: null,
  roundedTo: null,
  softWarning: null,
  confirmWarnings: [],
};

export function validateItemQty(
  item: ItemSearchResult | null,
  rawQty: string,
  isPiecesUnit: boolean,
  averageQty: number | null,
  t: (key: DictionaryKeys) => string,
): QtyValidationResult {
  const minQty = 0.01;

  if (!item) return EMPTY;

  const raw = rawQty.trim();
  if (!raw) return EMPTY;

  const parsedQty = Number.parseFloat(raw.replace(",", "."));
  if (!Number.isFinite(parsedQty)) {
    return { ...EMPTY, error: t("inventory.qty.error_not_number") };
  }

  if (parsedQty < 0) {
    return { ...EMPTY, error: t("inventory.qty.error_negative") };
  }

  if (parsedQty <= minQty) {
    return { ...EMPTY, error: t("inventory.qty.error_positive") };
  }

  if (isPiecesUnit && !Number.isInteger(parsedQty)) {
    return { ...EMPTY, error: t("inventory.qty.error_integer_pcs") };
  }

  const hardMax = isPiecesUnit ? 99999 : 99999.999;
  if (parsedQty > hardMax) {
    return { ...EMPTY, error: t("inventory.qty.error_too_large") };
  }

  const normalizedQty = parsedQty;

  const confirmWarnings: string[] = [];
  if (item.max_qty !== null && normalizedQty > item.max_qty) {
    confirmWarnings.push(
      `Количество ${normalizedQty} больше max_qty (${item.max_qty})`,
    );
  }

  const ratio =
    averageQty && averageQty > 0 ? normalizedQty / averageQty : null;
  let softWarning: string | null = null;
  if (ratio !== null && ratio >= 10) {
    confirmWarnings.push(
      `Количество в ${ratio.toFixed(1)} раз выше среднего по товару за сессию`,
    );
  } else if (ratio !== null && ratio >= 5) {
    softWarning = `Необычно: в ${ratio.toFixed(1)} раз выше среднего по товару`;
  }

  return {
    normalizedQty,
    error: null,
    wasRounded: false,
    roundedFrom: null,
    roundedTo: null,
    softWarning,
    confirmWarnings,
  };
}

/**
 * Compute the average after_quantity for a given item from session audit events.
 */
export function computeAverageQty(
  itemId: number | null,
  auditEvents: { item_id: number; after_quantity: number }[] | undefined,
): number | null {
  if (!itemId || !auditEvents) return null;

  const values = auditEvents
    .filter((e) => e.item_id === itemId)
    .map((e) => e.after_quantity)
    .filter((v) => Number.isFinite(v) && v > 0);

  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
