import type { InvoiceLine, PoLine, ReceivingLine, SkuSignal, SupplierRule } from "./types.js";

export const DEMO_STORE_NAME = "Harbor & Oak Supply Co. (Austin, TX — Demo Store)";

export const DEMO_SKU_SIGNALS: SkuSignal[] = [
  {
    sku: "HO-MUG-12OZ-BLK",
    barcode: "850041920101",
    title: "Double-Wall Camp Mug 12oz - Matte Black",
    vendor: "Pacific Stainless Works",
    on_hand: 42,
    committed: 14,
    on_order: 0,
    backorders: 0,
    units_sold_window: 210,
    window_days: 30,
    stockout_days: 5,
    unit_cost_usd: 6.40,
    retail_price_usd: 28.00,
    lead_time_days: 21,
    lead_time_std_dev_days: 4,
    case_pack: 24,
    sku_moq: 48
  },
  {
    sku: "HO-MUG-12OZ-OLV",
    barcode: "850041920102",
    title: "Double-Wall Camp Mug 12oz - Olive Drab",
    vendor: "Pacific Stainless Works",
    on_hand: 95,
    committed: 5,
    on_order: 48,
    backorders: 0,
    units_sold_window: 120,
    window_days: 30,
    stockout_days: 0,
    unit_cost_usd: 6.40,
    retail_price_usd: 28.00,
    lead_time_days: 21,
    lead_time_std_dev_days: 4,
    case_pack: 24,
    sku_moq: 48
  },
  {
    sku: "HO-FLASK-32OZ-RAW",
    barcode: "850041920103",
    title: "Trail Vacuum Flask 32oz - Brushed Steel",
    vendor: "Pacific Stainless Works",
    on_hand: 18,
    committed: 6,
    on_order: 0,
    backorders: 0,
    units_sold_window: 96,
    window_days: 30,
    stockout_days: 0,
    unit_cost_usd: 9.25,
    retail_price_usd: 38.00,
    lead_time_days: 21,
    lead_time_std_dev_days: 4,
    case_pack: 12,
    sku_moq: 36
  },
  {
    sku: "HO-APRON-WAX-TAN",
    barcode: "850041920201",
    title: "Heavyweight Waxed Canvas Shop Apron - Field Tan",
    vendor: "Blue Ridge Textiles LLC",
    on_hand: 11,
    committed: 4,
    on_order: 0,
    backorders: 2,
    units_sold_window: 68,
    window_days: 30,
    stockout_days: 3,
    unit_cost_usd: 22.50,
    retail_price_usd: 79.00,
    lead_time_days: 10,
    lead_time_std_dev_days: 1.5,
    case_pack: 10,
    sku_moq: 20
  },
  {
    sku: "HO-TOTE-WAX-NVY",
    barcode: "850041920202",
    title: "Utility Market Tote 18oz Canvas - Navy",
    vendor: "Blue Ridge Textiles LLC",
    on_hand: 26,
    committed: 2,
    on_order: 0,
    backorders: 0,
    units_sold_window: 54,
    window_days: 30,
    stockout_days: 0,
    unit_cost_usd: 16.00,
    retail_price_usd: 58.00,
    lead_time_days: 10,
    lead_time_std_dev_days: 1.5,
    case_pack: 10,
    sku_moq: 20
  },
  {
    sku: "HO-WAX-TIN-4OZ",
    barcode: "850041920301",
    title: "Beeswax Canvas Reproofing Tin 4oz",
    vendor: "Ozark Apothecary Co.",
    on_hand: 410,
    committed: 8,
    on_order: 0,
    backorders: 0,
    units_sold_window: 30,
    window_days: 30,
    stockout_days: 0,
    unit_cost_usd: 3.10,
    retail_price_usd: 14.00,
    lead_time_days: 7,
    lead_time_std_dev_days: 1,
    case_pack: 24,
    sku_moq: 48
  }
];

export const DEMO_SUPPLIER_RULES: SupplierRule[] = [
  {
    vendor: "Pacific Stainless Works",
    contact_email: "orders@pacificstainless-demo.com",
    payment_terms: "30% Deposit / 70% Net 30",
    currency: "USD",
    min_order_units: 120,
    min_order_value_usd: 2200,
    import_duty_pct: 10,
    estimated_freight_usd: 150,
    ship_to_location: "Austin 3PL Fulfillment Center"
  },
  {
    vendor: "Blue Ridge Textiles LLC",
    contact_email: "wholesale@blueridgetextiles-demo.com",
    payment_terms: "Net 30",
    currency: "USD",
    min_order_units: 30,
    min_order_value_usd: 1200,
    import_duty_pct: 0,
    estimated_freight_usd: 85,
    ship_to_location: "Austin 3PL Fulfillment Center"
  },
  {
    vendor: "Ozark Apothecary Co.",
    contact_email: "sales@ozarkapothecary-demo.com",
    payment_terms: "Net 15",
    currency: "USD",
    min_order_units: 48,
    min_order_value_usd: 300,
    import_duty_pct: 0,
    estimated_freight_usd: 45,
    ship_to_location: "Austin 3PL Fulfillment Center"
  }
];

export const DEMO_THREE_WAY_MATCH: {
  po_number: string;
  vendor: string;
  po_lines: PoLine[];
  receiving_lines: ReceivingLine[];
  invoice_lines: InvoiceLine[];
  invoice_extra_fees_usd: number;
  agreed_freight_cap_usd: number;
} = {
  po_number: "PO-2026-1042",
  vendor: "Pacific Stainless Works",
  po_lines: [
    { sku: "HO-MUG-12OZ-BLK", title: "Double-Wall Camp Mug 12oz - Matte Black", ordered_qty: 240, unit_cost_usd: 6.40 },
    { sku: "HO-FLASK-32OZ-RAW", title: "Trail Vacuum Flask 32oz - Brushed Steel", ordered_qty: 96, unit_cost_usd: 9.25 }
  ],
  receiving_lines: [
    { sku: "HO-MUG-12OZ-BLK", received_good_qty: 228, damaged_qty: 12 },
    { sku: "HO-FLASK-32OZ-RAW", received_good_qty: 84, damaged_qty: 0 }
  ],
  invoice_lines: [
    { sku: "HO-MUG-12OZ-BLK", billed_qty: 240, billed_unit_cost_usd: 6.85 },
    { sku: "HO-FLASK-32OZ-RAW", billed_qty: 96, billed_unit_cost_usd: 9.25 },
    { sku: "PALLET-WRAP-SURCHARGE", billed_qty: 1, billed_unit_cost_usd: 65.00 }
  ],
  invoice_extra_fees_usd: 240,
  agreed_freight_cap_usd: 150
};

export const DEMO_STOCKY_PO_CSV = [
  "PO Number,Supplier,SKU,Product Title,Quantity Ordered,Quantity Received,Cost Price,Created At,Received At,Status",
  "PO-881,Pacific Stainless Works,HO-MUG-12OZ-BLK,Double-Wall Camp Mug 12oz - Matte Black,192,192,6.25,2026-04-02,2026-04-22,received",
  "PO-894,Pacific Stainless Works,HO-MUG-12OZ-BLK,Double-Wall Camp Mug 12oz - Matte Black,240,240,6.40,2026-06-10,2026-07-04,received",
  "PO-894,Pacific Stainless Works,HO-FLASK-32OZ-RAW,Trail Vacuum Flask 32oz - Brushed Steel,72,72,9.25,2026-06-10,2026-07-04,received",
  "PO-907,Blue Ridge Textiles LLC,HO-APRON-WAX-TAN,Heavyweight Waxed Canvas Shop Apron - Field Tan,40,40,22.50,2026-05-15,2026-05-24,received",
  "PO-921,Blue Ridge Textiles LLC,HO-APRON-WAX-TAN,Heavyweight Waxed Canvas Shop Apron - Field Tan,50,50,22.50,2026-07-18,2026-07-29,received",
  "PO-921,Blue Ridge Textiles LLC,HO-TOTE-WAX-NVY,Utility Market Tote 18oz Canvas - Navy,30,30,16.00,2026-07-18,2026-07-29,received"
].join("\n");
