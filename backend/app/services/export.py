from __future__ import annotations

import csv
import re
from collections.abc import Iterable
from datetime import UTC, datetime, timezone, timedelta
from io import BytesIO, StringIO
from pathlib import Path

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font

ALMATY_TZ = timezone(timedelta(hours=6))

ENTRY_COLUMNS = [
    "ProductCode",
    "Zone",
    "Warehouse",
    "SessionId",
    "SessionStatus",
    "Item",
    "Unit",
    "Qty",
    "Category",
    "CountedOutsideZone",
    "CountedByZone",
    "UpdatedAt",
    "UpdatedBy",
    "Station",
    "Department",
]

ACCOUNTING_TEMPLATE_PATH = (
    Path(__file__).resolve().parent.parent / "templates" / "accounting_v1.xlsx"
)


def _safe_slug(value: str) -> str:
    normalized = re.sub(r"\s+", "_", value.strip().lower())
    normalized = re.sub(r"[^a-z0-9_\-]+", "", normalized)
    return normalized or "warehouse"


def build_export_filename(
    warehouse_name: str, session_created_at: datetime, status: str, file_ext: str
) -> str:
    date_part = session_created_at.date().isoformat()
    warehouse_part = _safe_slug(warehouse_name)
    status_part = _safe_slug(status).upper()
    return f"inventory_{warehouse_part}_{date_part}_{status_part}.{file_ext}"


def _excel_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(ALMATY_TZ).replace(tzinfo=None)


def _qty_number_format(unit: str) -> str:
    normalized = (unit or "").strip().lower()
    if normalized in {"kg", "l", "кг", "л"}:
        return "0.00"
    if normalized in {"pcs", "шт"}:
        return "0"
    return "0.00"


def build_csv_export(rows: Iterable[dict]) -> bytes:
    buffer = StringIO(newline="")
    writer = csv.writer(buffer)
    writer.writerow(ENTRY_COLUMNS)
    for row in rows:
        updated_at = row.get("UpdatedAt")
        writer.writerow(
            [
                row.get("ProductCode", ""),
                row.get("Zone", ""),
                row.get("Warehouse", ""),
                row.get("SessionId", ""),
                row.get("SessionStatus", ""),
                row.get("Item", ""),
                _unit_label_ru(row.get("Unit", "")),
                row.get("Qty", ""),
                row.get("Category", ""),
                row.get("CountedOutsideZone", ""),
                row.get("CountedByZone", ""),
                updated_at.isoformat() if isinstance(updated_at, datetime) else "",
                row.get("UpdatedBy", ""),
                row.get("Station", ""),
                row.get("Department", ""),
            ]
        )
    return buffer.getvalue().encode("utf-8")


def build_xlsx_export(
    rows: Iterable[dict],
    summary: dict,
) -> bytes:
    workbook = Workbook()

    entries_sheet = workbook.active
    entries_sheet.title = "Entries"
    entries_sheet.append(ENTRY_COLUMNS)
    for index, column_name in enumerate(ENTRY_COLUMNS, start=1):
        entries_sheet.cell(row=1, column=index).font = Font(bold=True)

    for row in rows:
        entries_sheet.append(
            [
                row.get("ProductCode", ""),
                row.get("Zone", ""),
                row.get("Warehouse", ""),
                int(row.get("SessionId", 0)),
                row.get("SessionStatus", ""),
                row.get("Item", ""),
                _unit_label_ru(row.get("Unit", "")),
                row.get("Qty", 0),
                row.get("Category", ""),
                row.get("CountedOutsideZone", ""),
                row.get("CountedByZone", ""),
                _excel_datetime(row.get("UpdatedAt")),
                row.get("UpdatedBy", ""),
                row.get("Station", ""),
                row.get("Department", ""),
            ]
        )

    entries_sheet.freeze_panes = "A2"

    for data_row in range(2, entries_sheet.max_row + 1):
        unit_value = str(entries_sheet.cell(row=data_row, column=7).value or "")
        qty_cell = entries_sheet.cell(row=data_row, column=8)
        qty_cell.number_format = _qty_number_format(unit_value)

        updated_at_cell = entries_sheet.cell(row=data_row, column=12)
        if updated_at_cell.value is not None:
            updated_at_cell.number_format = "yyyy-mm-dd hh:mm:ss"

    item_col_width = max(20, len("Item") + 2)
    for data_row in range(2, entries_sheet.max_row + 1):
        item_value = str(entries_sheet.cell(row=data_row, column=6).value or "")
        item_col_width = max(item_col_width, len(item_value) + 2)
    entries_sheet.column_dimensions["F"].width = item_col_width

    summary_sheet = workbook.create_sheet(title="Summary")
    summary_rows = [
        ("ReportVersion", summary.get("ReportVersion", "v1")),
        ("GeneratedAt", _excel_datetime(summary.get("GeneratedAt"))),
        ("Zone", summary.get("Zone", "")),
        ("Warehouse", summary.get("Warehouse", "")),
        ("SessionId", summary.get("SessionId", "")),
        ("SessionStatus", summary.get("SessionStatus", "")),
        ("SessionStartedAt", _excel_datetime(summary.get("SessionStartedAt"))),
        ("SessionClosedAt", _excel_datetime(summary.get("SessionClosedAt"))),
        ("TotalLines", summary.get("TotalLines", 0)),
    ]

    for key, value in summary_rows:
        summary_sheet.append([key, value])

    for row_index in (2, 7, 8):
        value_cell = summary_sheet.cell(row=row_index, column=2)
        if value_cell.value is not None:
            value_cell.number_format = "yyyy-mm-dd hh:mm:ss"

    unit_start_row = summary_sheet.max_row + 2
    summary_sheet.cell(row=unit_start_row, column=1, value="TotalQtyByUnit")
    summary_sheet.cell(row=unit_start_row, column=1).font = Font(bold=True)
    summary_sheet.cell(row=unit_start_row + 1, column=1, value="Unit")
    summary_sheet.cell(row=unit_start_row + 1, column=2, value="SumQty")
    summary_sheet.cell(row=unit_start_row + 1, column=1).font = Font(bold=True)
    summary_sheet.cell(row=unit_start_row + 1, column=2).font = Font(bold=True)

    row_ptr = unit_start_row + 2
    for unit, qty in sorted(
        (summary.get("TotalQtyByUnit") or {}).items(), key=lambda pair: pair[0]
    ):
        summary_sheet.cell(row=row_ptr, column=1, value=_unit_label_ru(unit))
        cell = summary_sheet.cell(row=row_ptr, column=2, value=qty)
        cell.number_format = _qty_number_format(str(unit))
        row_ptr += 1

    totals_by_category = summary.get("TotalsByCategory") or {}
    if totals_by_category:
        category_start_row = row_ptr + 1
        summary_sheet.cell(row=category_start_row, column=1, value="TotalsByCategory")
        summary_sheet.cell(row=category_start_row, column=1).font = Font(bold=True)
        summary_sheet.cell(row=category_start_row + 1, column=1, value="Category")
        summary_sheet.cell(row=category_start_row + 1, column=2, value="Lines")
        summary_sheet.cell(row=category_start_row + 1, column=3, value="SumQty")
        summary_sheet.cell(row=category_start_row + 1, column=1).font = Font(bold=True)
        summary_sheet.cell(row=category_start_row + 1, column=2).font = Font(bold=True)
        summary_sheet.cell(row=category_start_row + 1, column=3).font = Font(bold=True)

        category_row = category_start_row + 2
        for category_name, stats in sorted(totals_by_category.items(), key=lambda pair: pair[0]):
            summary_sheet.cell(row=category_row, column=1, value=category_name)
            summary_sheet.cell(row=category_row, column=2, value=int(stats.get("lines", 0)))
            summary_sheet.cell(row=category_row, column=3, value=stats.get("sum_qty", 0))
            category_row += 1

    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


def _unit_label_ru(unit: str) -> str:
    normalized = (unit or "").strip().lower()
    if normalized == "kg":
        return "кг"
    if normalized == "l":
        return "л"
    if normalized == "pcs":
        return "шт"
    return unit


def build_xlsx_accounting_template_export(rows: Iterable[dict], template_rows: int = 2000) -> bytes:
    if ACCOUNTING_TEMPLATE_PATH.exists():
        workbook = load_workbook(filename=ACCOUNTING_TEMPLATE_PATH)
        if "Товары" not in workbook.sheetnames:
            raise ValueError("Template sheet 'Товары' not found")
        goods_sheet = workbook["Товары"]
    else:
        workbook = Workbook()
        goods_sheet = workbook.active
        goods_sheet.title = "Товары"
        goods_sheet.cell(row=7, column=1, value="Код").font = Font(bold=True)
        goods_sheet.cell(row=7, column=2, value="Наименование").font = Font(bold=True)
        goods_sheet.cell(row=7, column=3, value="Ед. изм.").font = Font(bold=True)
        goods_sheet.cell(row=7, column=4, value="Остаток фактический").font = Font(bold=True)

    data_start_row = 8
    normalized_rows = list(rows)
    rows_to_render = max(template_rows, len(normalized_rows))

    for index in range(rows_to_render):
        excel_row = data_start_row + index
        if index < len(normalized_rows):
            row = normalized_rows[index]
            goods_sheet.cell(row=excel_row, column=1, value=str(row.get("ProductCode", "")))
            goods_sheet.cell(row=excel_row, column=2, value=str(row.get("Item", "")))
            goods_sheet.cell(
                row=excel_row, column=3, value=_unit_label_ru(str(row.get("Unit", "")))
            )

            qty = row.get("Qty")
            qty_cell = goods_sheet.cell(row=excel_row, column=4)
            if qty is None:
                qty_cell.value = "-"
            else:
                qty_cell.value = qty
                qty_cell.number_format = "0.###"
        else:
            goods_sheet.cell(row=excel_row, column=1, value="")
            goods_sheet.cell(row=excel_row, column=2, value="")
            goods_sheet.cell(row=excel_row, column=3, value="")
            goods_sheet.cell(row=excel_row, column=4, value="")

    output = BytesIO()
    workbook.save(output)
    return output.getvalue()
