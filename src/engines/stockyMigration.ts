import { parseCsv, parseNumber, pickField } from "../csvUtils.js";
import type { SupplierRule } from "../types.js";

export interface ReconstructedSupplierProfile {
  vendor: string;
  historical_po_count: number;
  observed_avg_lead_time_days: number;
  observed_lead_time_std_dev_days: number;
  inferred_min_order_units: number;
  inferred_min_order_value_usd: number;
  skus: Array<{
    sku: string;
    title: string;
    latest_unit_cost_usd: number;
    inferred_case_pack: number;
    total_units_ordered: number;
  }>;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y > 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

/**
 * Rebuilds un-exportable supplier directory, real lead times, carton multiples,
 * and chronological latest cost history from Stocky Purchase Order CSV exports.
 */
export function migrateStockyPoCsv(rawCsv: string): {
  suppliers_recovered: number;
  skus_recovered: number;
  profiles: ReconstructedSupplierProfile[];
  ready_supplier_rules_json: SupplierRule[];
} {
  const rows = parseCsv(rawCsv);
  const vendorBuckets = new Map<
    string,
    { displayVendor: string; entries: Array<{ row: Record<string, string>; createdMs: number | null; rowIdx: number }> }
  >();

  rows.forEach((row, rowIdx) => {
    const vendor = pickField(row, ["Supplier", "Vendor", "Supplier Name"]).trim();
    if (!vendor) return;
    const vendorKey = vendor.toLowerCase();
    const createdStr = pickField(row, ["Created At", "Order Date", "PO Date", "Date"]);
    const parsedCreated = createdStr ? Date.parse(createdStr) : NaN;
    const bucket = vendorBuckets.get(vendorKey) ?? { displayVendor: vendor, entries: [] };
    bucket.entries.push({
      row,
      createdMs: Number.isFinite(parsedCreated) ? parsedCreated : null,
      rowIdx
    });
    vendorBuckets.set(vendorKey, bucket);
  });

  const profiles: ReconstructedSupplierProfile[] = [];
  const rules: SupplierRule[] = [];
  let totalSkus = 0;

  for (const { displayVendor: vendor, entries } of vendorBuckets.values()) {
    // Sort chronologically oldest -> newest so latestCost always reflects the most recent PO
    // even when Stocky/Shopify exports rows newest-first (descending).
    const chronological = [...entries].sort((a, b) => {
      if (a.createdMs !== null && b.createdMs !== null && a.createdMs !== b.createdMs) {
        return a.createdMs - b.createdMs;
      }
      return a.rowIdx - b.rowIdx;
    });

    const poTotals = new Map<string, { units: number; usd: number; leadDays: number | null }>();
    const skuStats = new Map<string, { displaySku: string; title: string; latestCost: number; quantities: number[] }>();

    for (const { row: r, createdMs } of chronological) {
      const poNum = pickField(r, ["PO Number", "Purchase Order", "PO", "ID"]).trim() || "PO-UNKNOWN";
      const sku = pickField(r, ["SKU", "Variant SKU"]).trim();
      const title = pickField(r, ["Product Title", "Product", "Title", "Name"]).trim() || sku;
      const qty = Math.max(0, Math.round(parseNumber(pickField(r, ["Quantity Ordered", "Ordered Qty", "Quantity"]), 0)));
      const cost = Math.max(0, parseNumber(pickField(r, ["Cost Price", "Unit Cost", "Cost", "Cost per item"]), 0));

      const receivedStr = pickField(r, ["Received At", "Delivery Date", "Closed At"]);
      const receivedMs = receivedStr ? Date.parse(receivedStr) : NaN;
      const leadDays =
        createdMs !== null && Number.isFinite(receivedMs) && receivedMs >= createdMs
          ? Math.max(1, Math.round((receivedMs - createdMs) / 86_400_000))
          : null;

      const curPo = poTotals.get(poNum) ?? { units: 0, usd: 0, leadDays };
      curPo.units += qty;
      curPo.usd += qty * cost;
      if (leadDays !== null) curPo.leadDays = leadDays;
      poTotals.set(poNum, curPo);

      if (sku) {
        const skuKey = sku.toUpperCase();
        const curSku = skuStats.get(skuKey) ?? { displaySku: sku, title, latestCost: cost, quantities: [] };
        curSku.displaySku = sku;
        if (title) curSku.title = title;
        if (cost > 0) curSku.latestCost = cost;
        if (qty > 0) curSku.quantities.push(qty);
        skuStats.set(skuKey, curSku);
      }
    }

    const leads = [...poTotals.values()].map((p) => p.leadDays).filter((d): d is number => d !== null);
    const avgLead = leads.length > 0 ? Number((leads.reduce((a, b) => a + b, 0) / leads.length).toFixed(1)) : 14;
    const variance = leads.length > 1 ? leads.reduce((s, d) => s + (d - avgLead) ** 2, 0) / leads.length : 4;
    const stdLead = Number(Math.sqrt(variance).toFixed(1));

    const poUnits = [...poTotals.values()].map((p) => p.units).filter((u) => u > 0);
    const poUsd = [...poTotals.values()].map((p) => p.usd).filter((v) => v > 0);
    const minUnits = poUnits.length > 0 ? Math.min(...poUnits) : 0;
    const minUsd = poUsd.length > 0 ? Math.floor(Math.min(...poUsd) / 50) * 50 : 0;

    const skus = [...skuStats.values()].map((st) => {
      const pack = st.quantities.length >= 2 ? st.quantities.reduce((acc, q) => gcd(acc, q)) : 1;
      return {
        sku: st.displaySku,
        title: st.title,
        latest_unit_cost_usd: Number(st.latestCost.toFixed(2)),
        inferred_case_pack: pack > 100 ? 1 : pack,
        total_units_ordered: st.quantities.reduce((a, b) => a + b, 0)
      };
    });

    totalSkus += skus.length;
    profiles.push({
      vendor,
      historical_po_count: poTotals.size,
      observed_avg_lead_time_days: avgLead,
      observed_lead_time_std_dev_days: stdLead,
      inferred_min_order_units: minUnits,
      inferred_min_order_value_usd: minUsd,
      skus
    });

    rules.push({
      vendor,
      payment_terms: "Net 30",
      currency: "USD",
      lead_time_days: Math.max(1, Math.round(avgLead)),
      min_order_units: minUnits,
      min_order_value_usd: minUsd,
      ship_to_location: "Main US Warehouse"
    });
  }

  return {
    suppliers_recovered: profiles.length,
    skus_recovered: totalSkus,
    profiles,
    ready_supplier_rules_json: rules
  };
}
