import { escapeCsvCell } from "../csvUtils.js";
import type { InvoiceLine, PoLine, ReceivingLine } from "../types.js";

export interface ThreeWayDiscrepancy {
  sku: string;
  issue_type: "UNIT_PRICE_OVERCHARGE" | "SHORT_SHIP_BILLED" | "UNAPPROVED_LINE_ITEM" | "FREIGHT_CAP_EXCEEDED";
  po_expected: string;
  warehouse_received: string;
  vendor_billed: string;
  overcharge_usd: number;
}

export interface VerifiedBillLine {
  sku: string;
  description: string;
  verified_qty: number;
  verified_unit_cost_usd: number;
  verified_line_total_usd: number;
  is_freight: boolean;
}

export interface ThreeWayMatchResult {
  po_number: string;
  vendor: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  currency: string;
  payment_recommendation: "APPROVE_IN_FULL" | "HOLD_AND_ISSUE_DEBIT_MEMO";
  total_po_amount_usd: number;
  total_invoice_billed_usd: number;
  verified_payable_amount_usd: number;
  total_overcharge_recovered_usd: number;
  discrepancies: ThreeWayDiscrepancy[];
  verified_bill_lines: VerifiedBillLine[];
  quickbooks_bill_csv: string;
  xero_bill_csv: string;
  debit_memo_email_markdown: string;
}

function resolveIsoDate(raw: string | undefined, fallbackDate: Date): string {
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
    const ms = Date.parse(`${raw.trim()}T00:00:00Z`);
    if (Number.isFinite(ms)) return raw.trim();
  }
  return fallbackDate.toISOString().slice(0, 10);
}

function formatXeroUnitAmount(val: number): string {
  const twoDec = Number(val.toFixed(2));
  if (Math.abs(val - twoDec) < 1e-6) return twoDec.toFixed(2);
  return Number(val.toFixed(4)).toString();
}

function buildQuickBooksBillCsv(params: {
  billNo: string;
  vendor: string;
  billDate: string;
  dueDate: string;
  currency: string;
  cogsAccount: string;
  freightAccount: string;
  lines: VerifiedBillLine[];
}): string {
  const header = [
    "BillNo",
    "Supplier",
    "BillDate",
    "DueDate",
    "LineDescription",
    "LineAmount",
    "Account",
    "LineTaxCode",
    "Currency"
  ];
  const rows = params.lines.map((l) =>
    [
      escapeCsvCell(params.billNo),
      escapeCsvCell(params.vendor),
      escapeCsvCell(params.billDate),
      escapeCsvCell(params.dueDate),
      escapeCsvCell(l.description),
      escapeCsvCell(l.verified_line_total_usd.toFixed(2)),
      escapeCsvCell(l.is_freight ? params.freightAccount : params.cogsAccount),
      escapeCsvCell("NON"),
      escapeCsvCell(params.currency)
    ].join(",")
  );
  return [header.join(","), ...rows].join("\n");
}

function buildXeroBillCsv(params: {
  billNo: string;
  vendor: string;
  billDate: string;
  dueDate: string;
  currency: string;
  cogsAccountCode: string;
  freightAccountCode: string;
  lines: VerifiedBillLine[];
}): string {
  const header = [
    "*ContactName",
    "*InvoiceNumber",
    "*InvoiceDate",
    "*DueDate",
    "InventoryItemCode",
    "Description",
    "*Quantity",
    "*UnitAmount",
    "*AccountCode",
    "*TaxType",
    "Currency"
  ];
  const rows = params.lines.map((l) =>
    [
      escapeCsvCell(params.vendor),
      escapeCsvCell(params.billNo),
      escapeCsvCell(params.billDate),
      escapeCsvCell(params.dueDate),
      escapeCsvCell(l.sku),
      escapeCsvCell(l.description),
      escapeCsvCell(l.verified_qty),
      escapeCsvCell(formatXeroUnitAmount(l.verified_unit_cost_usd)),
      escapeCsvCell(l.is_freight ? params.freightAccountCode : params.cogsAccountCode),
      escapeCsvCell("Tax Exempt"),
      escapeCsvCell(params.currency)
    ].join(",")
  );
  return [header.join(","), ...rows].join("\n");
}

/**
 * Deterministic Accounts Payable 3-Way Match engine:
 * Aggregates split-pallet / multi-row SKUs, cross-checks Purchase Order vs
 * Warehouse Dock Receiving vs Supplier Invoice, and emits verified-only
 * QuickBooks Online (`quickbooks_bill_csv`) & Xero (`xero_bill_csv`) Bill CSVs.
 */
export function runThreeWayMatch(input: {
  po_number: string;
  vendor: string;
  invoice_number?: string;
  invoice_date?: string;
  due_date?: string;
  currency?: string;
  qbo_expense_account?: string;
  xero_account_code?: string;
  po_lines: PoLine[];
  receiving_lines: ReceivingLine[];
  invoice_lines: InvoiceLine[];
  invoice_extra_fees_usd?: number;
  agreed_freight_cap_usd?: number;
}): ThreeWayMatchResult {
  // Aggregate duplicate SKU lines safely (e.g., split-pallet receiving or split-line invoices) using case-insensitive SKU keys
  const displaySku = new Map<string, string>();
  const poMap = new Map<
    string,
    { sku: string; title?: string; ordered_qty: number; total_cost: number; unit_cost_usd: number }
  >();
  for (const l of input.po_lines) {
    const raw = l.sku.trim();
    const key = raw.toUpperCase();
    if (!displaySku.has(key)) displaySku.set(key, raw);
    const cur = poMap.get(key) ?? {
      sku: displaySku.get(key) ?? raw,
      title: l.title?.trim() || undefined,
      ordered_qty: 0,
      total_cost: 0,
      unit_cost_usd: l.unit_cost_usd
    };
    if (!cur.title && l.title?.trim()) cur.title = l.title.trim();
    cur.ordered_qty += l.ordered_qty;
    cur.total_cost += l.ordered_qty * l.unit_cost_usd;
    cur.unit_cost_usd = cur.ordered_qty > 0 ? cur.total_cost / cur.ordered_qty : l.unit_cost_usd;
    poMap.set(key, cur);
  }

  const hasReceivingLog = input.receiving_lines.length > 0;
  const recMap = new Map<string, { sku: string; received_good_qty: number; damaged_qty: number }>();
  for (const r of input.receiving_lines) {
    const raw = r.sku.trim();
    const key = raw.toUpperCase();
    if (!displaySku.has(key)) displaySku.set(key, raw);
    const cur = recMap.get(key) ?? { sku: displaySku.get(key) ?? raw, received_good_qty: 0, damaged_qty: 0 };
    cur.received_good_qty += r.received_good_qty;
    cur.damaged_qty += r.damaged_qty ?? 0;
    recMap.set(key, cur);
  }

  const invMap = new Map<
    string,
    { key: string; sku: string; billed_qty: number; total_billed: number; billed_unit_cost_usd: number }
  >();
  for (const inv of input.invoice_lines) {
    const raw = inv.sku.trim();
    const key = raw.toUpperCase();
    if (!displaySku.has(key)) displaySku.set(key, raw);
    const cur = invMap.get(key) ?? {
      key,
      sku: displaySku.get(key) ?? raw,
      billed_qty: 0,
      total_billed: 0,
      billed_unit_cost_usd: inv.billed_unit_cost_usd
    };
    cur.billed_qty += inv.billed_qty;
    cur.total_billed += inv.billed_qty * inv.billed_unit_cost_usd;
    cur.billed_unit_cost_usd = cur.billed_qty > 0 ? cur.total_billed / cur.billed_qty : inv.billed_unit_cost_usd;
    invMap.set(key, cur);
  }

  const discrepancies: ThreeWayDiscrepancy[] = [];
  const verifiedBillLines: VerifiedBillLine[] = [];
  const extraFees = input.invoice_extra_fees_usd ?? 0;
  const freightCap = input.agreed_freight_cap_usd ?? Infinity;

  let totalBilled = extraFees;
  const verifiedFreight = Number(Math.min(extraFees, freightCap).toFixed(2));
  let verifiedPayable = 0;

  if (extraFees > freightCap) {
    const diff = Number((extraFees - (input.agreed_freight_cap_usd ?? 0)).toFixed(2));
    discrepancies.push({
      sku: "FREIGHT_AND_FEES",
      issue_type: "FREIGHT_CAP_EXCEEDED",
      po_expected: `$${(input.agreed_freight_cap_usd ?? 0).toFixed(2)} cap`,
      warehouse_received: "N/A",
      vendor_billed: `$${extraFees.toFixed(2)}`,
      overcharge_usd: diff
    });
  }

  for (const inv of invMap.values()) {
    const lineBilled = inv.total_billed;
    totalBilled += lineBilled;

    const po = poMap.get(inv.key);
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

    const rec = recMap.get(inv.key);
    // Critical AP rule: when a warehouse receiving log IS supplied (`hasReceivingLog === true`),
    // an unlisted SKU means 0 units arrived at the dock (never assume `po.ordered_qty`!).
    const verifiedReceivedGoodQty = hasReceivingLog ? (rec?.received_good_qty ?? 0) : po.ordered_qty;
    const payableQty = Math.min(po.ordered_qty, verifiedReceivedGoodQty, inv.billed_qty);
    const payableUnitCost = Math.min(po.unit_cost_usd, inv.billed_unit_cost_usd);
    const verifiedLineTotal = Number((payableQty * payableUnitCost).toFixed(2));
    verifiedPayable += verifiedLineTotal;

    if (payableQty > 0 && verifiedLineTotal >= 0) {
      const cleanDesc = `${po.sku} - ${po.title ?? po.sku} (${payableQty} good units @ $${payableUnitCost.toFixed(2)} | PO ${input.po_number})`;
      verifiedBillLines.push({
        sku: po.sku,
        description: cleanDesc,
        verified_qty: payableQty,
        verified_unit_cost_usd: payableUnitCost,
        verified_line_total_usd: verifiedLineTotal,
        is_freight: false
      });
    }

    if (inv.billed_qty > payableQty) {
      const qtyDiff = inv.billed_qty - payableQty;
      discrepancies.push({
        sku: inv.sku,
        issue_type: "SHORT_SHIP_BILLED",
        po_expected: `${po.ordered_qty} ordered`,
        warehouse_received: `${verifiedReceivedGoodQty} good (${rec?.damaged_qty ?? 0} damaged)`,
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

  if (verifiedFreight > 0) {
    verifiedPayable += verifiedFreight;
    verifiedBillLines.push({
      sku: "FREIGHT",
      description: `Approved Freight & Handling (PO ${input.po_number})`,
      verified_qty: 1,
      verified_unit_cost_usd: verifiedFreight,
      verified_line_total_usd: verifiedFreight,
      is_freight: true
    });
  }

  const totalPo = Number([...poMap.values()].reduce((s, l) => s + l.total_cost, 0).toFixed(2));
  totalBilled = Number(totalBilled.toFixed(2));
  verifiedPayable = Number(verifiedPayable.toFixed(2));
  const recovered = Number(Math.max(0, totalBilled - verifiedPayable).toFixed(2));

  const now = new Date();
  const invoiceDate = resolveIsoDate(input.invoice_date, now);
  const defaultDue = new Date(Date.parse(`${invoiceDate}T00:00:00Z`) + 30 * 86_400_000);
  const proposedDue = resolveIsoDate(input.due_date, defaultDue);
  const dueDate = proposedDue >= invoiceDate ? proposedDue : invoiceDate;
  const invoiceNumber = input.invoice_number?.trim() || `INV-${input.po_number}`;
  const currency = (input.currency?.trim().toUpperCase() || "USD").slice(0, 3);
  const qboCogsAccount = input.qbo_expense_account?.trim() || "Cost of Goods Sold";
  const xeroCogsCode = input.xero_account_code?.trim() || "310";

  const quickbooksBillCsv = buildQuickBooksBillCsv({
    billNo: invoiceNumber,
    vendor: input.vendor,
    billDate: invoiceDate,
    dueDate,
    currency,
    cogsAccount: qboCogsAccount,
    freightAccount: "Freight & Shipping",
    lines: verifiedBillLines
  });

  const xeroBillCsv = buildXeroBillCsv({
    billNo: invoiceNumber,
    vendor: input.vendor,
    billDate: invoiceDate,
    dueDate,
    currency,
    cogsAccountCode: xeroCogsCode,
    freightAccountCode: "425",
    lines: verifiedBillLines
  });

  const memoLines = discrepancies
    .map(
      (d) =>
        `- **${d.sku}** (${d.issue_type}): Expected ${d.po_expected} | Received ${d.warehouse_received} | Billed ${d.vendor_billed} → **-$${d.overcharge_usd.toFixed(2)}**`
    )
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
    invoice_number: invoiceNumber,
    invoice_date: invoiceDate,
    due_date: dueDate,
    currency,
    payment_recommendation: discrepancies.length === 0 ? "APPROVE_IN_FULL" : "HOLD_AND_ISSUE_DEBIT_MEMO",
    total_po_amount_usd: totalPo,
    total_invoice_billed_usd: totalBilled,
    verified_payable_amount_usd: verifiedPayable,
    total_overcharge_recovered_usd: recovered,
    discrepancies,
    verified_bill_lines: verifiedBillLines,
    quickbooks_bill_csv: quickbooksBillCsv,
    xero_bill_csv: xeroBillCsv,
    debit_memo_email_markdown: debitMemo
  };
}
