import { parseCsv } from "../csvUtils.js";
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
 * and cost history from Stocky Purchase Order CSV exports before read-only sunset.
 */
export function migrateStockyPoCsv(rawCsv: string): {
  suppliers_recovered: number;
  skus_recovered: number;
  profiles: ReconstructedSupplierProfile[];
  ready_supplier_rules_json: SupplierRule[];
} {
  const rows = parseCsv(rawCsv);
  const vendorBuckets = new Map<string, Array<Record<string, string>>>();

  for (const row of rows) {
    const vendor = (row["Supplier"] || row["Vendor"] || row["Supplier Name"] || "").trim();
    if (!vendor) continue;
    const list = vendorBuckets.get(vendor) ?? [];
    list.push(row);
    vendorBuckets.set(vendor, list);
  }

  const profiles: ReconstructedSupplierProfile[] = [];
  const rules: SupplierRule[] = [];
  let totalSkus = 0;

  for (const [vendor, vRows] of vendorBuckets.entries()) {
    const poTotals = new Map<string, { units: number; usd: number; leadDays: number | null }>();
    const skuStats = new Map<string, { title: string; latestCost: number; quantities: number[] }>();

    for (const r of vRows) {
      const poNum = (r["PO Number"] || r["Purchase Order"] || r["ID"] || "PO-UNKNOWN").trim();
      const sku = (r["SKU"] || r["Variant SKU"] || "").trim();
      const title = (r["Product Title"] || r["Product"] || r["Title"] || sku).trim();
      const qty = Math.max(0, Math.round(Number((r["Quantity Ordered"] || r["Quantity"] || "0").replace(/[^0-9.-]/g, "")) || 0));
      const cost = Math.max(0, Number((r["Cost Price"] || r["Unit Cost"] || r["Cost"] || "0").replace(/[^0-9.-]/g, "")) || 0);

      const created = Date.parse(r["Created At"] || r["Order Date"] || "");
      const received = Date.parse(r["Received At"] || r["Delivery Date"] || "");
      const leadDays = Number.isFinite(created) && Number.isFinite(received) && received >= created
        ? Math.max(1, Math.round((received - created) / 86_400_000))
        : null;

      const curPo = poTotals.get(poNum) ?? { units: 0, usd: 0, leadDays };
      curPo.units += qty;
      curPo.usd += qty * cost;
      if (leadDays !== null) curPo.leadDays = leadDays;
      poTotals.set(poNum, curPo);

      if (sku) {
        const curSku = skuStats.get(sku) ?? { title, latestCost: cost, quantities: [] };
        if (cost > 0) curSku.latestCost = cost;
        if (qty > 0) curSku.quantities.push(qty);
        skuStats.set(sku, curSku);
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

    const skus = [...skuStats.entries()].map(([sku, st]) => {
      const pack = st.quantities.length > 0 ? st.quantities.reduce((acc, q) => gcd(acc, q)) : 1;
      return {
        sku,
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
      lead_time_days: Math.round(avgLead),
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
