import type { ItemBulkUpsertRow } from "@/lib/api/http";

type ParsedBulkRow = Pick<ItemBulkUpsertRow, "product_code" | "name" | "unit">;
export type ParsedBulkError = {
  lineNumber: number;
  lineText: string;
  reason: string;
};

const PRODUCT_CODE_RE = /^\d{5}$/;

const UNIT_ALIASES: Record<string, string> = {
  kg: "kg",
  кг: "kg",
  kilogram: "kg",
  килограмм: "kg",
  l: "l",
  л: "l",
  liter: "l",
  литр: "l",
  pcs: "pcs",
  pc: "pcs",
  piece: "pcs",
  шт: "pcs",
  штука: "pcs",
  штук: "pcs",
  pack: "pack",
  пачка: "pack",
  bottle: "bottle",
  бутылка: "bottle",
};

function normalizeUnit(raw: string): string | null {
  const normalized = raw.trim().toLowerCase().replace(/\.$/, "");
  return UNIT_ALIASES[normalized] ?? null;
}

function splitFlexible(line: string): string[] {
  if (line.includes("\t")) {
    return line
      .split(/\t+/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  if (line.includes(";")) {
    return line
      .split(/\s*;\s*/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  if (line.includes(",")) {
    return line
      .split(/\s*,\s*/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  if (/\s[-–—]\s/.test(line)) {
    return line
      .split(/\s[-–—]\s/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  return line
    .split(/\s{2,}|\s\|\s/)
    .map((part) => part.trim())
    .filter(Boolean);
}

type ParseResult =
  | { ok: true; code: string | undefined; name: string; unit: string }
  | { ok: false; reason: string };

/**
 * Supports 4 formats (code is optional):
 *   12345 - Название - ед.изм.
 *   12345 Название ед.изм.
 *   Название - ед.изм.
 *   Название ед.изм.
 */
function parseLine(line: string): ParseResult {
  const parts = splitFlexible(line);

  if (parts.length === 0) {
    return { ok: false, reason: "Пустая строка" };
  }

  let code: string | undefined;
  let nameParts: string[];
  let unitRaw: string;

  const firstIsCode = PRODUCT_CODE_RE.test(parts[0]!);

  if (firstIsCode) {
    // Format: CODE ... NAME ... UNIT
    if (parts.length < 3) {
      // Try regex fallback for "12345 Some Name шт"
      const fallback = line.match(/^(\d{5})\s+(.+)\s+(\S+)$/);
      if (fallback) {
        code = fallback[1];
        const normalizedUnit = normalizeUnit(fallback[3]!);
        if (!normalizedUnit) {
          return { ok: false, reason: `Не распознана единица измерения: «${fallback[3]}»` };
        }
        const name = fallback[2]!.trim();
        if (!name) {
          return { ok: false, reason: "Пустое название" };
        }
        return { ok: true, code, name, unit: normalizedUnit };
      }
      return { ok: false, reason: "После кода нужно указать название и единицу измерения" };
    }
    code = parts[0];
    unitRaw = parts[parts.length - 1]!;
    nameParts = parts.slice(1, -1);
  } else {
    // No code — Format: NAME ... UNIT
    if (parts.length < 2) {
      // Try regex fallback for "Some Name шт"
      const fallback = line.match(/^(.+)\s+(\S+)$/);
      if (fallback) {
        const normalizedUnit = normalizeUnit(fallback[2]!);
        if (!normalizedUnit) {
          return { ok: false, reason: `Не распознана единица измерения: «${fallback[2]}»` };
        }
        const name = fallback[1]!.trim();
        if (!name) {
          return { ok: false, reason: "Пустое название" };
        }
        return { ok: true, code: undefined, name, unit: normalizedUnit };
      }
      return { ok: false, reason: "Нужно указать название и единицу измерения" };
    }
    code = undefined;
    unitRaw = parts[parts.length - 1]!;
    nameParts = parts.slice(0, -1);
  }

  const normalizedUnit = normalizeUnit(unitRaw);
  if (!normalizedUnit) {
    return { ok: false, reason: `Не распознана единица измерения: «${unitRaw}»` };
  }

  const name = nameParts.join(" ").trim();
  if (!name) {
    return { ok: false, reason: "Пустое название" };
  }

  return { ok: true, code, name, unit: normalizedUnit };
}

export function parseBulkLines(raw: string): {
  rows: ParsedBulkRow[];
  errors: ParsedBulkError[];
  totalLines: number;
} {
  const rows: ParsedBulkRow[] = [];
  const errors: ParsedBulkError[] = [];
  let totalLines = 0;

  raw
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\u00A0/g, " "))
    .forEach((line, index) => {
      if (!line) return;
      totalLines += 1;
      const parsed = parseLine(line);
      if (!parsed.ok) {
        errors.push({
          lineNumber: index + 1,
          lineText: line,
          reason: parsed.reason,
        });
        return;
      }
      rows.push({ product_code: parsed.code, name: parsed.name, unit: parsed.unit });
    });

  return { rows, errors, totalLines };
}
