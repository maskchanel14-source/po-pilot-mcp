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

const ABC_PRIORITY: Record<"A" | "B" | "C", number> = { A: 0, B: 1, C: 2 };

/**
 * Groups replenishment items by vendor, enforces carton multiples + vendor MOQ (units & USD),
 * tops up highest-velocity A-class SKUs using exact closed-form carton math when below vendor MOQ,
 * and renders Shopify Native Draft PO CSV + vendor email markdown.
 */
export function generateSupplierPurchaseOrders(
  items: ReplenishmentItemResult[],
  supplierRules: SupplierRule[] = [],
  poPrefix = "PO-2026"
): { purchase_orders: SupplierPurchaseOrder[]; total_po_spend_usd: number } {
  const ruleMap = new Map<string, SupplierRule>();
  for (const r of supplierRules) ruleMap.set(r.vendor.trim().toLowerCase(), r);

  const byVendor = new Map<string, { displayVendor: string; items: ReplenishmentItemResult[] }>();
  for (const item of items) {
    const key = item.vendor.trim().toLowerCase() || "unassigned vendor";
    const existing = byVendor.get(key);
    if (!existing) {
      const ruleDisplay = ruleMap.get(key)?.vendor.trim();
      byVendor.set(key, {
        displayVendor: ruleDisplay || item.vendor.trim() || "Unassigned Vendor",
        items: [item]
      });
    } else {
      existing.items.push(item);
    }
  }

  const purchaseOrders: SupplierPurchaseOrder[] = [];
  let seq = 101;

  for (const [vendorKey, group] of byVendor.entries()) {
    const vendor = group.displayVendor;
    const vendorItems = group.items;
    const actionable = vendorItems.filter((i) => i.recommended_order_units > 0);
    if (actionable.length === 0) continue;

    const rule = ruleMap.get(vendorKey);
    const minUnits = rule?.min_order_units ?? 0;
    const minUsd = rule?.min_order_value_usd ?? 0;

    const working = actionable.map((i) => ({ ...i, finalQty: i.recommended_order_units }));
    // Prioritize A-class > B-class > C-class, breaking ties by fastest daily velocity
    working.sort((a, b) => {
      const classDiff = ABC_PRIORITY[a.abc_class] - ABC_PRIORITY[b.abc_class];
      if (classDiff !== 0) return classDiff;
      return b.adjusted_daily_velocity - a.adjusted_daily_velocity;
    });

    let topUpApplied = false;
    let unachievableUsdMinimum = false;

    const bestUnitTarget = working[0];
    if (bestUnitTarget) {
      const curUnits = working.reduce((s, w) => s + w.finalQty, 0);
      if (curUnits < minUnits) {
        const extraCartons = Math.ceil((minUnits - curUnits) / bestUnitTarget.case_pack);
        bestUnitTarget.finalQty += extraCartons * bestUnitTarget.case_pack;
        topUpApplied = true;
      }
    }

    const curUsdAfterUnits = working.reduce((s, w) => s + w.finalQty * w.unit_cost_usd, 0);
    if (curUsdAfterUnits + 1e-9 < minUsd) {
      const bestCostTarget = working.find((w) => w.unit_cost_usd > 0);
      if (bestCostTarget) {
        const cartonCost = bestCostTarget.case_pack * bestCostTarget.unit_cost_usd;
        const extraCartons = Math.ceil((minUsd - curUsdAfterUnits - 1e-9) / cartonCost);
        if (extraCartons > 0) {
          bestCostTarget.finalQty += extraCartons * bestCostTarget.case_pack;
          topUpApplied = true;
        }
      } else {
        unachievableUsdMinimum = true;
      }
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

    const escapeMd = (s: string): string => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
    const tableRows = lines
      .map(
        (l) =>
          `| ${escapeMd(l.sku)} | ${escapeMd(l.title)} | ${l.cartons} (${l.case_pack}/ctn) | ${l.order_qty} | $${l.unit_cost_usd.toFixed(2)} | $${l.line_total_usd.toFixed(2)} |`
      )
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

    let moqNotes = "Natural replenishment quantities already met vendor MOQ.";
    if (unachievableUsdMinimum) {
      moqNotes = `Warning: Could not reach $${minUsd.toFixed(2)} vendor minimum because SKU unit costs are $0.00.`;
    } else if (topUpApplied) {
      moqNotes = `Auto-topped highest-priority A-SKU by carton multiples to satisfy vendor minimum (${minUnits} units / $${minUsd.toFixed(2)}).`;
    }

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
      moq_notes: moqNotes,
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
