import { toShopifyDraftPoCsv } from "../csvUtils.js";
import type { ReplenishmentItemResult, SupplierRule } from "../types.js";

export interface SupplierPurchaseOrder {
  po_number: string;
  vendor: string;
  contact_email: string;
  payment_terms: string;
  ship_to_location: string;
  expected_arrival_date: string;
  total_units: number;
  subtotal_usd: number;
  moq_top_up_applied: boolean;
  moq_notes: string;
  lines: Array<{
    sku: string;
    title: string;
    abc_class: "A" | "B" | "C";
    case_pack: number;
    cartons: number;
    order_qty: number;
    unit_cost_usd: number;
    line_total_usd: number;
  }>;
  shopify_draft_po_csv: string;
  vendor_email_markdown: string;
}

/**
 * Groups replenishment items by vendor, enforces carton multiples + vendor MOQ (units & USD),
 * tops up highest-velocity A-items when just short of vendor minimum/free-freight, and renders CSV + email.
 */
export function generateSupplierPurchaseOrders(
  items: ReplenishmentItemResult[],
  supplierRules: SupplierRule[] = [],
  poPrefix = "PO-2026"
): { purchase_orders: SupplierPurchaseOrder[]; total_po_spend_usd: number } {
  const ruleMap = new Map<string, SupplierRule>();
  for (const r of supplierRules) ruleMap.set(r.vendor.toLowerCase(), r);

  const byVendor = new Map<string, ReplenishmentItemResult[]>();
  for (const item of items) {
    const bucket = byVendor.get(item.vendor) ?? [];
    bucket.push(item);
    byVendor.set(item.vendor, bucket);
  }

  const purchaseOrders: SupplierPurchaseOrder[] = [];
  let seq = 101;

  for (const [vendor, vendorItems] of byVendor.entries()) {
    const actionable = vendorItems.filter((i) => i.recommended_order_units > 0);
    if (actionable.length === 0) continue;

    const rule = ruleMap.get(vendor.toLowerCase());
    const minUnits = rule?.min_order_units ?? 0;
    const minUsd = rule?.min_order_value_usd ?? 0;

    const working = actionable.map((i) => ({ ...i, finalQty: i.recommended_order_units }));
    working.sort((a, b) => b.adjusted_daily_velocity - a.adjusted_daily_velocity);

    let topUpApplied = false;
    let safetyCounter = 0;
    while (safetyCounter < 500) {
      const curUnits = working.reduce((s, w) => s + w.finalQty, 0);
      const curUsd = working.reduce((s, w) => s + w.finalQty * w.unit_cost_usd, 0);
      if (curUnits >= minUnits && curUsd >= minUsd) break;
      const best = working[0];
      if (!best || best.unit_cost_usd <= 0) break;
      best.finalQty += best.case_pack;
      topUpApplied = true;
      safetyCounter++;
    }

    const maxLead = Math.max(...working.map((w) => rule?.lead_time_days ?? w.lead_time_days));
    const eta = new Date(Date.now() + maxLead * 86_400_000).toISOString().slice(0, 10);
    const poNumber = `${poPrefix}-${seq++}`;

    const lines = working.map((w) => ({
      sku: w.sku,
      title: w.title,
      abc_class: w.abc_class,
      case_pack: w.case_pack,
      cartons: Math.ceil(w.finalQty / w.case_pack),
      order_qty: w.finalQty,
      unit_cost_usd: w.unit_cost_usd,
      line_total_usd: Number((w.finalQty * w.unit_cost_usd).toFixed(2))
    }));

    const totalUnits = lines.reduce((s, l) => s + l.order_qty, 0);
    const subtotalUsd = Number(lines.reduce((s, l) => s + l.line_total_usd, 0).toFixed(2));
    const csv = toShopifyDraftPoCsv(
      lines.map((l) => ({ sku: l.sku, quantity: l.order_qty, unit_cost_usd: l.unit_cost_usd }))
    );

    const tableRows = lines
      .map((l) => `| ${l.sku} | ${l.title} | ${l.cartons} (${l.case_pack}/ctn) | ${l.order_qty} | $${l.unit_cost_usd.toFixed(2)} | $${l.line_total_usd.toFixed(2)} |`)
      .join("\n");

    const emailMd = [
      `Subject: Purchase Order ${poNumber} — ${vendor} (Requested ETA: ${eta})`,
      `To: ${rule?.contact_email ?? "purchasing@supplier.com"}`,
      "",
      `Hi ${vendor} Orders Team,`,
      "",
      `Please confirm receipt and ship date for Purchase Order **${poNumber}** under **${rule?.payment_terms ?? "Net 30"}** terms to **${rule?.ship_to_location ?? "Main US Warehouse"}**:`,
      "",
      "| SKU | Description | Cartons | Total Units | Unit Cost | Line Total |",
      "| --- | --- | ---: | ---: | ---: | ---: |",
      tableRows,
      "",
      `**Total Units:** ${totalUnits} | **PO Subtotal (USD):** $${subtotalUsd.toFixed(2)}`
    ].join("\n");

    purchaseOrders.push({
      po_number: poNumber,
      vendor,
      contact_email: rule?.contact_email ?? "unassigned@supplier.com",
      payment_terms: rule?.payment_terms ?? "Net 30",
      ship_to_location: rule?.ship_to_location ?? "Main US Warehouse",
      expected_arrival_date: eta,
      total_units: totalUnits,
      subtotal_usd: subtotalUsd,
      moq_top_up_applied: topUpApplied,
      moq_notes: topUpApplied
        ? `Auto-topped fastest A-SKU by carton multiples to satisfy vendor minimum (${minUnits} units / $${minUsd.toFixed(2)}).`
        : "Natural replenishment quantities already met vendor MOQ.",
      lines,
      shopify_draft_po_csv: csv,
      vendor_email_markdown: emailMd
    });
  }

  return {
    purchase_orders: purchaseOrders,
    total_po_spend_usd: Number(purchaseOrders.reduce((s, p) => s + p.subtotal_usd, 0).toFixed(2))
  };
}
