/**
 * Normalize a unit code to its Russian display abbreviation.
 *   kg -> кг
 *   l  -> л
 *   pcs / piece / pieces -> шт
 * Already-Russian values pass through unchanged.
 */
export function formatUnit(unit: string | null | undefined): string {
  const raw = (unit ?? "").trim();
  const lower = raw.toLowerCase();
  if (lower === "kg" || lower === "кг") return "кг";
  if (lower === "l" || lower === "л") return "л";
  if (lower === "pcs" || lower === "piece" || lower === "pieces" || lower === "шт") return "шт";
  return raw;
}

/** Returns true when the unit represents "pieces" (integer-only). */
function isPiecesUnit(unit: string | null | undefined): boolean {
  const lower = (unit ?? "").trim().toLowerCase();
  return lower === "pcs" || lower === "шт" || lower === "piece" || lower === "pieces";
}

export function formatQuantity(
  value: number | string | null | undefined,
  unit?: string | null,
): string {
  const numeric = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(numeric)) {
    return "0";
  }

  const decimals = isPiecesUnit(unit) ? 0 : 3;
  const rounded =
    decimals === 0 ? Math.round(numeric) : Number.parseFloat(numeric.toFixed(decimals));

  if (!Number.isFinite(rounded)) {
    return "0";
  }

  const fixed = decimals === 0 ? String(Math.round(rounded)) : rounded.toFixed(decimals);
  const trimmed = fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
  if (trimmed === "-0" || trimmed === "") {
    return "0";
  }
  return trimmed;
}

export function formatQuantityWithUnit(
  value: number | string | null | undefined,
  unit?: string | null,
): string {
  const qty = formatQuantity(value, unit);
  const displayUnit = formatUnit(unit);
  return displayUnit ? `${qty} ${displayUnit}` : qty;
}
