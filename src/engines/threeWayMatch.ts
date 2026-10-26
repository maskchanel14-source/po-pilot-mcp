import type { InvoiceLine, PoLine, ReceivingLine } from "../types.js";

export interface ThreeWayDiscrepancy {
  sku: string;
  issue_type: "UNIT_PRICE_OVERCHARGE" | "SHORT_SHIP_BILLED" | "UNAPPROVED_LINE_ITEM" | "FREIGHT_CAP_EXCEEDED";
  po_expected: string;
  warehouse_received: string;
  vendor_billed: string;
  overcharge_usd: number;
}

export interface ThreeWayMatchResult {
  po_number: string;
  vendor: string;
  payment_recommendation: "APPROVE_IN_FULL" | "HOLD_AND_ISSUE_DEBIT_MEMO";
  total_po_amount_usd: number;
  total_invoice_billed_usd: number;
  verified_payable_amount_usd: number;
  total_overcharge_recovered_usd: number;
  discrepancies: ThreeWayDiscrepancy[];
  debit_memo_email_markdown: string;
}

/**
 * Deterministic Accounts Payable 3-Way Match engine:
 * Cross-checks Purchase Order vs Warehouse Dock Receiving vs Supplier Invoice.
 */
export function runThreeWayMatch(input: {
  po_number: string;
  vendor: string;
  po_lines: PoLine[];
  receiving_lines: ReceivingLine[];
  invoice_lines: InvoiceLine[];
  invoice_extra_fees_usd?: number;
  agreed_freight_cap_usd?: number;
}): ThreeWayMatchResult {
  const poMap = new Map(input.po_lines.map((l) => [l.sku, l]));
  const recMap = new Map(input.receiving_lines.map((l) => [l.sku, l]));
  const discrepancies: ThreeWayDiscrepancy[] = [];

  let totalBilled = input.invoice_extra_fees_usd ?? 0;
  let verifiedPayable = Math.min(input.invoice_extra_fees_usd ?? 0, input.agreed_freight_cap_usd ?? Infinity);

  if ((input.invoice_extra_fees_usd ?? 0) > (input.agreed_freight_cap_usd ?? Infinity)) {
    const diff = Number(((input.invoice_extra_fees_usd ?? 0) - (input.agreed_freight_cap_usd ?? 0)).toFixed(2));
    discrepancies.push({
      sku: "FREIGHT_AND_FEES",
      issue_type: "FREIGHT_CAP_EXCEEDED",
      po_expected: `$${(input.agreed_freight_cap_usd ?? 0).toFixed(2)} cap`,
      warehouse_received: "N/A",
      vendor_billed: `$${(input.invoice_extra_fees_usd ?? 0).toFixed(2)}`,
      overcharge_usd: diff
    });
  }

  for (const inv of input.invoice_lines) {
    const lineBilled = inv.billed_qty * inv.billed_unit_cost_usd;
    totalBilled += lineBilled;

    const po = poMap.get(inv.sku);
    if (!po) {
      discrepancies.push({
        sku: inv.sku,
        issue_type: "UNAPPROVED_LINE_ITEM",
        po_expected: "Not on PO",
        warehouse_received: "0 units",
        vendor_billed: `${inv.billed_qty} @ $${inv.billed_unit_cost_usd.toFixed(2)}`,
        overcharge_usd: Number(lineBilled.toFixed(2))
      });
      continue;
    }

    const rec = recMap.get(inv.sku);
    const payableQty = Math.min(po.ordered_qty, rec ? rec.received_good_qty : po.ordered_qty, inv.billed_qty);
    const payableUnitCost = Math.min(po.unit_cost_usd, inv.billed_unit_cost_usd);
    verifiedPayable += payableQty * payableUnitCost;

    if (inv.billed_qty > payableQty) {
      const qtyDiff = inv.billed_qty - payableQty;
      discrepancies.push({
        sku: inv.sku,
        issue_type: "SHORT_SHIP_BILLED",
        po_expected: `${po.ordered_qty} ordered`,
        warehouse_received: `${rec?.received_good_qty ?? 0} good (${rec?.damaged_qty ?? 0} damaged)`,
        vendor_billed: `${inv.billed_qty} billed`,
        overcharge_usd: Number((qtyDiff * payableUnitCost).toFixed(2))
      });
    }

    if (inv.billed_unit_cost_usd > po.unit_cost_usd + 0.001) {
      const priceDiff = inv.billed_unit_cost_usd - po.unit_cost_usd;
      discrepancies.push({
        sku: inv.sku,
        issue_type: "UNIT_PRICE_OVERCHARGE",
        po_expected: `$${po.unit_cost_usd.toFixed(2)}/unit`,
        warehouse_received: `${payableQty} good units`,
        vendor_billed: `$${inv.billed_unit_cost_usd.toFixed(2)}/unit on ${inv.billed_qty} units`,
        overcharge_usd: Number((priceDiff * inv.billed_qty).toFixed(2))
      });
    }
  }

  const totalPo = Number(input.po_lines.reduce((s, l) => s + l.ordered_qty * l.unit_cost_usd, 0).toFixed(2));
  totalBilled = Number(totalBilled.toFixed(2));
  verifiedPayable = Number(verifiedPayable.toFixed(2));
  const recovered = Number(Math.max(0, totalBilled - verifiedPayable).toFixed(2));

  const memoLines = discrepancies
    .map((d) => `- **${d.sku}** (${d.issue_type}): Expected ${d.po_expected} | Received ${d.warehouse_received} | Billed ${d.vendor_billed} → **-$${d.overcharge_usd.toFixed(2)}**`)
    .join("\n");

  const debitMemo =
    discrepancies.length === 0
      ? `3-Way Match PASSED for ${input.po_number} (${input.vendor}). Approve payment of $${verifiedPayable.toFixed(2)}.`
      : [
          `Subject: Debit Memo / Invoice Adjustment Request — ${input.po_number} (${input.vendor})`,
          "",
          `Hi ${input.vendor} Accounts Receivable,`,
          "",
          `During our 3-way match against **${input.po_number}** and warehouse dock receiving logs, we identified **$${recovered.toFixed(2)}** in billing variances:`,
          "",
          memoLines,
          "",
          `**Invoice Billed Total:** $${totalBilled.toFixed(2)}`,
          `**Verified Payable Amount:** $${verifiedPayable.toFixed(2)}`,
          "",
          `Please issue a revised invoice or credit memo for **$${recovered.toFixed(2)}** so we can release payment of **$${verifiedPayable.toFixed(2)}** on schedule.`
        ].join("\n");

  return {
    po_number: input.po_number,
    vendor: input.vendor,
    payment_recommendation: discrepancies.length === 0 ? "APPROVE_IN_FULL" : "HOLD_AND_ISSUE_DEBIT_MEMO",
    total_po_amount_usd: totalPo,
    total_invoice_billed_usd: totalBilled,
    verified_payable_amount_usd: verifiedPayable,
    total_overcharge_recovered_usd: recovered,
    discrepancies,
    debit_memo_email_markdown: debitMemo
  };
}
