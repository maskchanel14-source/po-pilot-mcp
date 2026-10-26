import { toShopifyDraftPoCsv, toShopifyTransferImportCsv } from "../csvUtils.js";
import type { ReplenishmentItemResult, SupplierRule } from "../types.js";

export interface SupplierPurchaseOrderLine {
  sku: string;
  barcode?: string;
  title: string;
  abc_class: "A" | "B" | "C";
  case_pack: number;
  cartons: number;
  order_qty: number;
  unit_cost_usd: number;
  line_total_usd: number;
  landed_unit_cost_usd: number;
  landed_line_total_usd: number;
  landed_gross_margin_pct: number;
  margin_erosion_warning: boolean;
}

export interface SupplierPurchaseOrder {
  po_number: string;
  vendor: string;
  contact_email: string;
  payment_terms: string;
  ship_to_location: string;
  expected_arrival_date: string;
  total_units: number;
  subtotal_usd: number;
  import_duty_pct: number;
  estimated_duty_usd: number;
  estimated_freight_usd: number;
  total_landed_cost_usd: number;
  margin_erosion_skus_count: number;
  moq_top_up_applied: boolean;
  moq_notes: string;
  lines: SupplierPurchaseOrderLine[];
  shopify_draft_po_csv: string;
  shopify_transfer_import_csv: string;
  vendor_email_markdown: string;
}

export interface OpenToBuySummary {
  max_cash_budget_usd: number;
  uncapped_landed_spend_usd: number;
  final_landed_spend_usd: number;
  spend_trimmed_usd: number;
  cartons_trimmed: number;
  budget_respected: boolean;
  vendor_moq_waived_for_otb: boolean;
}

export interface PurchaseOrderBuildOptions {
  maxCashBudgetUsd?: number;
  defaultImportDutyPct?: number;
  minGrossMarginPct?: number;
}

const ABC_PRIORITY: Record<"A" | "B" | "C", number> = { A: 0, B: 1, C: 2 };
const TRIM_RISK_ORDER: Record<ReplenishmentItemResult["stockout_risk"], number> = {
  OVERSTOCK: 0,
  HEALTHY: 1,
  WATCH: 2,
  REORDER_NOW: 3,
  CRITICAL: 4
};
const TRIM_ABC_ORDER: Record<"A" | "B" | "C", number> = { C: 0, B: 1, A: 2 };

interface WorkingLine extends ReplenishmentItemResult {
  finalQty: number;
}

interface VendorDraft {
  vendorKey: string;
  vendor: string;
  rule?: SupplierRule;
  minUnits: number;
  minUsd: number;
  dutyPct: number;
  freightUsd: number;
  topUpApplied: boolean;
  unachievableUsdMinimum: boolean;
  otbTrimmedBelowMoq: boolean;
  working: WorkingLine[];
}

function computeDraftLandedTotal(draft: VendorDraft): number {
  const activeUnits = draft.working.reduce((s, w) => s + w.finalQty, 0);
  if (activeUnits <= 0) return 0;
  const fob = Number(
    draft.working.reduce((s, w) => s + Number((w.finalQty * w.unit_cost_usd).toFixed(2)), 0).toFixed(2)
  );
  const duty = Number((fob * (draft.dutyPct / 100)).toFixed(2));
  const freight = Number(draft.freightUsd.toFixed(2));
  return Number((fob + duty + freight).toFixed(2));
}

function sumAllDraftsLanded(drafts: VendorDraft[]): number {
  return Number(drafts.reduce((s, d) => s + computeDraftLandedTotal(d), 0).toFixed(2));
}

/**
 * Groups replenishment items by vendor, enforces carton multiples + vendor MOQ (units & USD),
 * computes US import tariff + allocated freight landed unit costs and margin-erosion alerts,
 * optionally enforces an Open-to-Buy (OTB) cash ceiling by trimming lowest-priority C/B cartons first,
 * and emits Shopify Draft PO CSV + Shopify POS Transfer Import CSV + vendor email markdown.
 */
export function generateSupplierPurchaseOrders(
  items: ReplenishmentItemResult[],
  supplierRules: SupplierRule[] = [],
  poPrefix = "PO-2026",
  options: PurchaseOrderBuildOptions = {}
): {
  purchase_orders: SupplierPurchaseOrder[];
  total_po_spend_usd: number;
  total_landed_po_spend_usd: number;
  otb_summary?: OpenToBuySummary;
} {
  const defaultDutyPct = Math.max(0, options.defaultImportDutyPct ?? 0);
  const minGrossMarginPct = options.minGrossMarginPct ?? 40;
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

  const drafts: VendorDraft[] = [];

  for (const [vendorKey, group] of byVendor.entries()) {
    const vendor = group.displayVendor;
    const actionable = group.items.filter((i) => i.recommended_order_units > 0);
    if (actionable.length === 0) continue;

    const rule = ruleMap.get(vendorKey);
    const minUnits = rule?.min_order_units ?? 0;
    const minUsd = rule?.min_order_value_usd ?? 0;
    const dutyPct = Math.max(0, rule?.import_duty_pct ?? defaultDutyPct);
    const freightUsd = Math.max(0, rule?.estimated_freight_usd ?? 0);

    const working: WorkingLine[] = actionable.map((i) => ({ ...i, finalQty: i.recommended_order_units }));
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

    drafts.push({
      vendorKey,
      vendor,
      rule,
      minUnits,
      minUsd,
      dutyPct,
      freightUsd,
      topUpApplied,
      unachievableUsdMinimum,
      otbTrimmedBelowMoq: false,
      working
    });
  }

  let otbSummary: OpenToBuySummary | undefined;
  if (typeof options.maxCashBudgetUsd === "number" && Number.isFinite(options.maxCashBudgetUsd) && options.maxCashBudgetUsd >= 0) {
    const budgetCap = Number(options.maxCashBudgetUsd.toFixed(2));
    const uncappedSpend = sumAllDraftsLanded(drafts);
    let cartonsTrimmed = 0;

    if (uncappedSpend > budgetCap + 1e-9) {
      const candidates = drafts.flatMap((draft) => draft.working.map((line) => ({ draft, line })));
      candidates.sort((a, b) => {
        const riskDiff = TRIM_RISK_ORDER[a.line.stockout_risk] - TRIM_RISK_ORDER[b.line.stockout_risk];
        if (riskDiff !== 0) return riskDiff;
        const abcDiff = TRIM_ABC_ORDER[a.line.abc_class] - TRIM_ABC_ORDER[b.line.abc_class];
        if (abcDiff !== 0) return abcDiff;
        const marginA =
          a.line.retail_price_usd > 0
            ? (a.line.retail_price_usd - a.line.unit_cost_usd * (1 + a.draft.dutyPct / 100)) / a.line.retail_price_usd
            : -1;
        const marginB =
          b.line.retail_price_usd > 0
            ? (b.line.retail_price_usd - b.line.unit_cost_usd * (1 + b.draft.dutyPct / 100)) / b.line.retail_price_usd
            : -1;
        if (Math.abs(marginA - marginB) > 1e-6) return marginA - marginB;
        return a.line.adjusted_daily_velocity - b.line.adjusted_daily_velocity;
      });

      // Pass A protects at least 1 carton of CRITICAL stockout SKUs; Pass B enforces hard cash ceiling if still exceeded
      for (const protectCritical of [true, false]) {
        for (const { draft, line } of candidates) {
          let curSpend = sumAllDraftsLanded(drafts);
          if (curSpend <= budgetCap + 1e-9) break;

          const floorQty = protectCritical && line.stockout_risk === "CRITICAL" ? line.case_pack : 0;
          const removableCartons = Math.floor((line.finalQty - floorQty) / line.case_pack);
          if (removableCartons <= 0) continue;

          const cartonLandedCost = line.case_pack * line.unit_cost_usd * (1 + draft.dutyPct / 100);
          if (cartonLandedCost <= 0) {
            const otherPaidUnits = draft.working.reduce(
              (s, w) => (w === line || w.unit_cost_usd <= 0 ? s : s + w.finalQty),
              0
            );
            if (floorQty === 0 && draft.freightUsd > 0 && otherPaidUnits === 0) {
              for (const zeroLine of draft.working) {
                if (zeroLine.unit_cost_usd <= 0 && zeroLine.finalQty > 0) {
                  cartonsTrimmed += Math.floor(zeroLine.finalQty / zeroLine.case_pack);
                  zeroLine.finalQty = 0;
                }
              }
            }
            continue;
          }

          const excess = curSpend - budgetCap;
          const cutCartons = Math.min(
            removableCartons,
            Math.max(1, Math.ceil((excess - 1e-9) / cartonLandedCost))
          );
          line.finalQty -= cutCartons * line.case_pack;
          cartonsTrimmed += cutCartons;

          curSpend = sumAllDraftsLanded(drafts);
          if (curSpend > budgetCap + 1e-9 && line.finalQty - line.case_pack >= floorQty) {
            line.finalQty -= line.case_pack;
            cartonsTrimmed += 1;
          }
        }
      }

      for (const d of drafts) {
        const unitsNow = d.working.reduce((s, w) => s + w.finalQty, 0);
        const fobNow = d.working.reduce((s, w) => s + w.finalQty * w.unit_cost_usd, 0);
        if (unitsNow > 0 && (unitsNow < d.minUnits || fobNow + 1e-9 < d.minUsd)) {
          d.otbTrimmedBelowMoq = true;
        }
      }
    }

    const finalSpend = sumAllDraftsLanded(drafts);
    otbSummary = {
      max_cash_budget_usd: budgetCap,
      uncapped_landed_spend_usd: uncappedSpend,
      final_landed_spend_usd: finalSpend,
      spend_trimmed_usd: Number(Math.max(0, uncappedSpend - finalSpend).toFixed(2)),
      cartons_trimmed: cartonsTrimmed,
      budget_respected: finalSpend <= budgetCap + 1e-9,
      vendor_moq_waived_for_otb: drafts.some((d) => d.otbTrimmedBelowMoq)
    };
  }

  const purchaseOrders: SupplierPurchaseOrder[] = [];
  let seq = 101;

  for (const draft of drafts) {
    const activeWorking = draft.working.filter((w) => w.finalQty > 0);
    if (activeWorking.length === 0) continue;

    const { vendor, rule, minUnits, minUsd, dutyPct, freightUsd } = draft;
    const maxLead = Math.max(...activeWorking.map((w) => rule?.lead_time_days ?? w.lead_time_days));
    const eta = new Date(Date.now() + maxLead * 86_400_000).toISOString().slice(0, 10);
    const poNumber = `${poPrefix}-${seq++}`;

    const totalUnits = activeWorking.reduce((s, w) => s + w.finalQty, 0);
    const rawLineTotals = activeWorking.map((w) => Number((w.finalQty * w.unit_cost_usd).toFixed(2)));
    const subtotalUsd = Number(rawLineTotals.reduce((s, v) => s + v, 0).toFixed(2));
    const estimatedDutyUsd = Number((subtotalUsd * (dutyPct / 100)).toFixed(2));
    const estimatedFreightUsd = Number(freightUsd.toFixed(2));
    const totalLandedCostUsd = Number((subtotalUsd + estimatedDutyUsd + estimatedFreightUsd).toFixed(2));

    const lines: SupplierPurchaseOrderLine[] = activeWorking.map((w, idx) => {
      const lineTotalUsd = rawLineTotals[idx];
      const lineDuty = lineTotalUsd * (dutyPct / 100);
      const lineFreight =
        subtotalUsd > 0
          ? (lineTotalUsd / subtotalUsd) * estimatedFreightUsd
          : totalUnits > 0
            ? (w.finalQty / totalUnits) * estimatedFreightUsd
            : 0;
      const rawLandedLine = lineTotalUsd + lineDuty + lineFreight;
      const landedLineTotalUsd = Number(rawLandedLine.toFixed(2));
      const landedUnitCostUsd = w.finalQty > 0 ? Number((rawLandedLine / w.finalQty).toFixed(2)) : w.unit_cost_usd;
      const landedGrossMarginPct =
        w.retail_price_usd > 0
          ? Number((((w.retail_price_usd - landedUnitCostUsd) / w.retail_price_usd) * 100).toFixed(1))
          : 0;
      const marginErosionWarning = w.retail_price_usd > 0 ? landedGrossMarginPct < minGrossMarginPct : false;

      return {
        sku: w.sku,
        ...(w.barcode ? { barcode: w.barcode } : {}),
        title: w.title,
        abc_class: w.abc_class,
        case_pack: w.case_pack,
        cartons: Math.ceil(w.finalQty / w.case_pack),
        order_qty: w.finalQty,
        unit_cost_usd: w.unit_cost_usd,
        line_total_usd: lineTotalUsd,
        landed_unit_cost_usd: landedUnitCostUsd,
        landed_line_total_usd: landedLineTotalUsd,
        landed_gross_margin_pct: landedGrossMarginPct,
        margin_erosion_warning: marginErosionWarning
      };
    });

    const csv = toShopifyDraftPoCsv(
      lines.map((l) => ({ sku: l.sku, quantity: l.order_qty, unit_cost_usd: l.unit_cost_usd }))
    );
    const transferCsv = toShopifyTransferImportCsv(
      lines.map((l) => ({ sku: l.sku, barcode: l.barcode, quantity: l.order_qty }))
    );

    const escapeMd = (s: string): string => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
    const tableRows = lines
      .map(
        (l) =>
          `| ${escapeMd(l.sku)} | ${escapeMd(l.title)} | ${l.cartons} (${l.case_pack}/ctn) | ${l.order_qty} | $${l.unit_cost_usd.toFixed(2)} | $${l.line_total_usd.toFixed(2)} |`
      )
      .join("\n");

    const landedSummaryLine =
      dutyPct > 0 || estimatedFreightUsd > 0
        ? `**Est. Tariff (${dutyPct}%):** $${estimatedDutyUsd.toFixed(2)} | **Est. Freight:** $${estimatedFreightUsd.toFixed(2)} | **Est. Landed Total (USD):** $${totalLandedCostUsd.toFixed(2)}`
        : "";

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
      `**Total Units:** ${totalUnits} | **PO Subtotal (USD):** $${subtotalUsd.toFixed(2)}`,
      ...(landedSummaryLine ? [landedSummaryLine] : [])
    ].join("\n");

    let moqNotes = "Natural replenishment quantities already met vendor MOQ.";
    if (draft.otbTrimmedBelowMoq) {
      moqNotes = `Open-to-Buy cash cap ($${otbSummary?.max_cash_budget_usd.toFixed(2)}) trimmed order below vendor MOQ (${minUnits} units / $${minUsd.toFixed(2)}); request MOQ waiver or combine shipment.`;
    } else if (draft.unachievableUsdMinimum) {
      moqNotes = `Warning: Could not reach $${minUsd.toFixed(2)} vendor minimum because SKU unit costs are $0.00.`;
    } else if (draft.topUpApplied) {
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
      import_duty_pct: dutyPct,
      estimated_duty_usd: estimatedDutyUsd,
      estimated_freight_usd: estimatedFreightUsd,
      total_landed_cost_usd: totalLandedCostUsd,
      margin_erosion_skus_count: lines.filter((l) => l.margin_erosion_warning).length,
      moq_top_up_applied: draft.topUpApplied && !draft.otbTrimmedBelowMoq,
      moq_notes: moqNotes,
      lines,
      shopify_draft_po_csv: csv,
      shopify_transfer_import_csv: transferCsv,
      vendor_email_markdown: emailMd
    });
  }

  return {
    purchase_orders: purchaseOrders,
    total_po_spend_usd: Number(purchaseOrders.reduce((s, p) => s + p.subtotal_usd, 0).toFixed(2)),
    total_landed_po_spend_usd: Number(
      purchaseOrders.reduce((s, p) => s + p.total_landed_cost_usd, 0).toFixed(2)
    ),
    ...(otbSummary ? { otb_summary: otbSummary } : {})
  };
}
