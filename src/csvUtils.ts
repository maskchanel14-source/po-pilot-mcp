import type { SkuSignal } from "./types.js";

function detectDelimiter(text: string): string {
  let inQuotes = false;
  let commas = 0;
  let tabs = 0;
  let semicolons = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') i++;
      else inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && (ch === "\n" || ch === "\r")) break;
    if (!inQuotes) {
      if (ch === ",") commas++;
      else if (ch === "\t") tabs++;
      else if (ch === ";") semicolons++;
    }
  }
  if (commas > 0) return ",";
  if (tabs > 0) return "\t";
  if (semicolons > 0) return ";";
  return ",";
}

/**
 * Minimal RFC-4180 compliant CSV/TSV parser supporting quoted fields, escaped quotes,
 * CRLF/LF, UTF-8 BOM, and auto-detected delimiters (comma CSV, Google Sheets/Excel TSV, semicolon CSV).
 */
export function parseCsv(rawCsv: string): Array<Record<string, string>> {
  const text = rawCsv.replace(/^\uFEFF/, "").trim();
  if (!text) return [];

  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        currentRow.push(field.trim());
        field = "";
      } else if (ch === "\r" && next === "\n") {
        currentRow.push(field.trim());
        rows.push(currentRow);
        currentRow = [];
        field = "";
        i++;
      } else if (ch === "\n" || ch === "\r") {
        currentRow.push(field.trim());
        rows.push(currentRow);
        currentRow = [];
        field = "";
      } else {
        field += ch;
      }
    }
  }
  currentRow.push(field.trim());
  if (currentRow.some((cell) => cell.length > 0)) {
    rows.push(currentRow);
  }

  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (h) record[h] = cells[idx] ?? "";
    });
    return record;
  });
}

export function escapeCsvCell(value: string | number): string {
  let str = String(value);
  // OWASP CWE-1236: neutralize spreadsheet formula/DDE injection on string cells
  if (typeof value === "string" && (/^[=@\t\r]/.test(str) || /^[+-](?![0-9])/.test(str))) {
    str = `'${str}`;
  }
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Formats line items into Shopify Admin Native Draft Purchase Order CSV upload format.
 */
export function toShopifyDraftPoCsv(
  lines: Array<{
    sku: string;
    supplier_sku?: string;
    quantity: number;
    unit_cost_usd: number;
    tax_percent?: number;
  }>
): string {
  const header = ["SKU", "Supplier SKU", "Quantity", "Cost", "Tax %"];
  const body = lines.map((line) =>
    [
      escapeCsvCell(line.sku),
      escapeCsvCell(line.supplier_sku ?? line.sku),
      escapeCsvCell(line.quantity),
      escapeCsvCell(line.unit_cost_usd.toFixed(2)),
      escapeCsvCell((line.tax_percent ?? 0).toFixed(2))
    ].join(",")
  );
  return [header.join(","), ...body].join("\n");
}

/**
 * Formats line items into Shopify Admin Official Inventory Transfers CSV format
 * (`SKU,Barcode,Quantity` matching Shopify CDN `add_products_template.csv`) for
 * Shopify POS barcode scanner receiving and retail barcode label printing.
 */
export function toShopifyTransferImportCsv(
  lines: Array<{
    sku: string;
    barcode?: string;
    quantity: number;
  }>
): string {
  const header = ["SKU", "Barcode", "Quantity"];
  const body = lines.map((line) =>
    [
      escapeCsvCell(line.sku),
      escapeCsvCell(line.barcode ?? ""),
      escapeCsvCell(line.quantity)
    ].join(",")
  );
  return [header.join(","), ...body].join("\n");
}

export function pickField(row: Record<string, string>, aliases: string[]): string {
  const lowerMap = new Map<string, string>();
  for (const [k, v] of Object.entries(row)) {
    lowerMap.set(k.toLowerCase().replace(/[^a-z0-9]/g, ""), v);
  }
  for (const alias of aliases) {
    const found = lowerMap.get(alias.toLowerCase().replace(/[^a-z0-9]/g, ""));
    if (found !== undefined && found !== "") return found;
  }
  return "";
}

export function parseNumber(val: string, fallback: number): number {
  if (!val) return fallback;
  const trimmed = val.trim();
  const unwrapped = /^\(.+\)$/.test(trimmed) ? `-${trimmed.slice(1, -1)}` : trimmed;
  const cleaned = unwrapped.replace(/[$,%\s]/g, "");
  if (!cleaned) return fallback;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : fallback;
}

/**
 * Maps a Shopify Products/Inventory CSV export (or merchant reorder sheet CSV) into SkuSignal[].
 */
export function mapInventoryCsvToSignals(rawCsv: string, defaultWindowDays = 30): SkuSignal[] {
  const rows = parseCsv(rawCsv);
  const signals: SkuSignal[] = [];

  for (const row of rows) {
    const sku = pickField(row, ["Variant SKU", "SKU", "sku"]).trim();
    if (!sku) continue;
    const barcode = pickField(row, ["Variant Barcode", "Barcode", "UPC", "EAN", "GTIN", "barcode"]).trim() || undefined;
    const title = pickField(row, ["Title", "Product Title", "Name", "Product"]).trim() || sku;
    const vendor = pickField(row, ["Vendor", "Supplier", "Supplier Name"]).trim() || "Unassigned Vendor";
    const onHand = Math.max(
      -100000,
      Math.min(10000000, Math.round(parseNumber(pickField(row, ["Variant Inventory Qty", "On Hand", "Available", "on_hand"]), 0)))
    );
    const committed = Math.max(0, Math.round(parseNumber(pickField(row, ["Committed", "committed"]), 0)));
    const onOrder = Math.max(0, Math.round(parseNumber(pickField(row, ["Incoming", "On Order", "on_order"]), 0)));
    const backorders = Math.max(0, Math.round(parseNumber(pickField(row, ["Backorders", "backorders"]), 0)));
    const unitsSold = Math.max(0, parseNumber(pickField(row, ["Units Sold", "Net Quantity", "Sold", "units_sold_window"]), 0));
    const windowDays = Math.max(1, Math.min(365, Math.round(parseNumber(pickField(row, ["Window Days", "window_days"]), defaultWindowDays))));
    const stockoutDays = Math.max(0, Math.round(parseNumber(pickField(row, ["Stockout Days", "stockout_days"]), 0)));
    const unitCost = Math.max(0, parseNumber(pickField(row, ["Cost per item", "Unit Cost", "Cost", "unit_cost_usd"]), 0));
    const retailPrice = Math.max(0, parseNumber(pickField(row, ["Variant Price", "Price", "Retail Price", "retail_price_usd"]), unitCost * 2.5));
    const leadTime = Math.max(1, Math.min(365, parseNumber(pickField(row, ["Lead Time", "Lead Time Days", "lead_time_days"]), 14)));
    const casePack = Math.max(1, Math.round(parseNumber(pickField(row, ["Case Pack", "Pack Size", "case_pack"]), 1)));
    const skuMoq = Math.max(1, Math.round(parseNumber(pickField(row, ["MOQ", "SKU MOQ", "sku_moq"]), 1)));

    signals.push({
      sku,
      ...(barcode ? { barcode } : {}),
      title,
      vendor,
      on_hand: onHand,
      committed,
      on_order: onOrder,
      backorders,
      units_sold_window: unitsSold,
      window_days: windowDays,
      stockout_days: Math.min(stockoutDays, windowDays - 1),
      unit_cost_usd: unitCost,
      retail_price_usd: retailPrice,
      lead_time_days: leadTime,
      lead_time_std_dev_days: 2,
      case_pack: casePack,
      sku_moq: skuMoq
    });
  }

  return signals;
}
