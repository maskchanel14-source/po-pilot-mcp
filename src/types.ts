import { z } from "zod";

export const ServiceLevelSchema = z
  .enum(["85%", "90%", "95%", "97.5%", "99%"])
  .default("95%")
  .describe(
    "Target cycle service level used for Z-score safety stock calculation (85%=1.04, 90%=1.28, 95%=1.65, 97.5%=1.96, 99%=2.33)."
  );

export const SkuSignalSchema = z.object({
  sku: z.string().min(1).max(120).describe("Unique variant SKU code matching Shopify Variant SKU."),
  title: z.string().min(1).max(250).describe("Human-readable product + variant title."),
  vendor: z.string().min(1).max(160).describe("Supplier or vendor name."),
  on_hand: z.number().int().min(-100000).max(10000000).describe("Physical units currently in warehouse."),
  committed: z.number().int().min(0).max(10000000).default(0).describe("Units allocated to unfulfilled customer orders."),
  on_order: z.number().int().min(0).max(10000000).default(0).describe("Units already in transit on open supplier POs."),
  backorders: z.number().int().min(0).max(10000000).default(0).describe("Customer backorder commitments not yet covered."),
  units_sold_window: z.number().min(0).max(10000000).describe("Total units sold during the lookback window."),
  window_days: z.number().int().min(1).max(365).default(30).describe("Total calendar days in the sales lookback window (e.g., 30, 60, or 90)."),
  stockout_days: z.number().int().min(0).max(364).default(0).describe("Days within window_days where the SKU had 0 sellable stock (prevents downward velocity bias)."),
  daily_demand_std_dev: z.number().min(0).max(1000000).optional().describe("Optional daily demand standard deviation. Defaults to 0.35 * adjusted daily velocity when omitted."),
  unit_cost_usd: z.number().min(0).max(1000000).describe("Landed supplier cost per unit in USD."),
  retail_price_usd: z.number().min(0).max(1000000).describe("Selling price per unit in USD (used for margin-weighted ABC classification)."),
  lead_time_days: z.number().min(1).max(365).default(14).describe("Average supplier lead time in calendar days."),
  lead_time_std_dev_days: z.number().min(0).max(180).default(2).describe("Supplier lead-time standard deviation in days (captures port/carrier delay variance)."),
  case_pack: z.number().int().min(1).max(100000).default(1).describe("Vendor carton/case-pack multiple (e.g., 12 or 24 units per box)."),
  sku_moq: z.number().int().min(1).max(1000000).default(1).describe("Minimum order quantity for this specific SKU when ordered.")
});

export type SkuSignal = z.infer<typeof SkuSignalSchema>;

export const SupplierRuleSchema = z.object({
  vendor: z.string().min(1).max(160).describe("Exact vendor/supplier name."),
  contact_email: z.string().max(200).optional().describe("Supplier purchasing contact email."),
  payment_terms: z.string().max(100).default("Net 30").describe("Agreed payment terms (e.g., Net 30, 50% Deposit / 50% BOL)."),
  currency: z.string().length(3).default("USD").describe("3-letter ISO currency code."),
  lead_time_days: z.number().min(1).max(365).optional().describe("Overrides default lead time for all SKUs from this vendor."),
  min_order_units: z.number().int().min(0).max(10000000).default(0).describe("Vendor-wide minimum total units per Purchase Order."),
  min_order_value_usd: z.number().min(0).max(100000000).default(0).describe("Vendor-wide minimum PO dollar subtotal (e.g., $1,500 minimum or free-freight threshold)."),
  ship_to_location: z.string().max(200).default("Main US Warehouse").describe("Destination Shopify warehouse/location name.")
});

export type SupplierRule = z.infer<typeof SupplierRuleSchema>;

export interface ReplenishmentItemResult {
  sku: string;
  title: string;
  vendor: string;
  abc_class: "A" | "B" | "C";
  inventory_position: number;
  adjusted_daily_velocity: number;
  days_of_cover: number | null;
  safety_stock_units: number;
  reorder_point_units: number;
  target_stock_level: number;
  raw_shortfall_units: number;
  recommended_order_units: number;
  estimated_line_cost_usd: number;
  stockout_risk: "CRITICAL" | "REORDER_NOW" | "WATCH" | "HEALTHY" | "OVERSTOCK";
  case_pack: number;
  sku_moq: number;
  unit_cost_usd: number;
  lead_time_days: number;
}

export const PoLineSchema = z.object({
  sku: z.string().min(1).max(120).describe("SKU identifier."),
  title: z.string().max(250).optional().describe("Product variant name."),
  ordered_qty: z.number().min(0).max(10000000).describe("Quantity approved on original Purchase Order."),
  unit_cost_usd: z.number().min(0).max(1000000).describe("Agreed PO unit price in USD.")
});

export const ReceivingLineSchema = z.object({
  sku: z.string().min(1).max(120).describe("SKU identifier scanned at warehouse dock."),
  received_good_qty: z.number().min(0).max(10000000).describe("Undamaged sellable units received."),
  damaged_qty: z.number().min(0).max(10000000).default(0).describe("Damaged/defective units rejected or quarantined on arrival.")
});

export const InvoiceLineSchema = z.object({
  sku: z.string().min(1).max(120).describe("Billed SKU identifier (or fee code) on vendor invoice."),
  billed_qty: z.number().min(0).max(10000000).describe("Quantity billed by the supplier."),
  billed_unit_cost_usd: z.number().min(0).max(1000000).describe("Unit price charged on the supplier invoice in USD.")
});

export type PoLine = z.infer<typeof PoLineSchema>;
export type ReceivingLine = z.infer<typeof ReceivingLineSchema>;
export type InvoiceLine = z.infer<typeof InvoiceLineSchema>;
