import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mapInventoryCsvToSignals } from "./csvUtils.js";
import {
  DEMO_SKU_SIGNALS,
  DEMO_STOCKY_PO_CSV,
  DEMO_STORE_NAME,
  DEMO_SUPPLIER_RULES,
  DEMO_THREE_WAY_MATCH
} from "./demoData.js";
import { generateSupplierPurchaseOrders } from "./engines/purchaseOrder.js";
import { computeReplenishmentPlan } from "./engines/replenishment.js";
import { migrateStockyPoCsv } from "./engines/stockyMigration.js";
import { runThreeWayMatch } from "./engines/threeWayMatch.js";
import { fetchLiveShopifySignals, resolveShopifyConfig } from "./shopifyClient.js";
import {
  InvoiceLineSchema,
  PoLineSchema,
  ReceivingLineSchema,
  ServiceLevelSchema,
  SkuSignalSchema,
  SupplierRuleSchema,
  type SkuSignal
} from "./types.js";

export const SERVER_NAME = "po-pilot-mcp";
export const SERVER_VERSION = "1.0.0";

function formatError(toolName: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    isError: true as const,
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            ok: false,
            tool: toolName,
            error: message,
            remediation:
              "Pass `demo_mode: true` to test with sample US merchant data, paste `inventory_csv` / structured `skus`, or set valid SHOPIFY_STORE_DOMAIN and SHOPIFY_ACCESS_TOKEN environment variables."
          },
          null,
          2
        )
      }
    ]
  };
}

async function resolveSkuInputs(params: {
  skus?: SkuSignal[];
  inventory_csv?: string;
  use_live_shopify?: boolean;
  demo_mode?: boolean;
  window_days?: number;
}): Promise<{ source: string; signals: SkuSignal[] }> {
  if (params.demo_mode) {
    return { source: `demo_fixture (${DEMO_STORE_NAME})`, signals: DEMO_SKU_SIGNALS };
  }
  if (params.skus && params.skus.length > 0) {
    return { source: "structured_json_input", signals: params.skus };
  }
  if (params.inventory_csv && params.inventory_csv.trim().length > 0) {
    const parsed = mapInventoryCsvToSignals(params.inventory_csv, params.window_days ?? 30);
    if (parsed.length === 0) {
      throw new Error("Parsed 0 SKUs from `inventory_csv`. Ensure header includes `SKU` (or `Variant SKU`) and quantity columns.");
    }
    return { source: "csv_input", signals: parsed };
  }
  if (params.use_live_shopify) {
    const cfg = resolveShopifyConfig();
    if (!cfg) {
      throw new Error("Live Shopify mode requested, but SHOPIFY_STORE_DOMAIN or SHOPIFY_ACCESS_TOKEN is not set.");
    }
    const live = await fetchLiveShopifySignals(cfg, params.window_days ?? 30);
    return { source: `shopify_admin_graphql (${cfg.storeDomain})`, signals: live };
  }

  const autoCfg = resolveShopifyConfig();
  if (autoCfg) {
    const live = await fetchLiveShopifySignals(autoCfg, params.window_days ?? 30);
    return { source: `shopify_admin_graphql (${autoCfg.storeDomain})`, signals: live };
  }

  throw new Error(
    "No SKU data supplied. Provide `skus` array, paste `inventory_csv`, configure SHOPIFY_STORE_DOMAIN + SHOPIFY_ACCESS_TOKEN, or set `demo_mode: true`."
  );
}

export function createPoPilotServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION
  });

  // Tool 1: Replenishment & Reorder Point Engine
  server.registerTool(
    "calculate_replenishment_plan",
    {
      title: "Calculate Stockout-Adjusted Replenishment & Reorder Points",
      description:
        "Replaces Shopify Stocky's retired forecasting brain. Computes margin-weighted ABC classes, stockout-adjusted daily sales velocity, demand + lead-time variability safety stock (SS = Z * sqrt(LT*sigma_d^2 + d^2*sigma_LT^2)), reorder points, inventory position (On-Hand + On-Order - Committed - Backorders), days of cover, and carton-rounded order recommendations. Accepts structured `skus`, pasted Shopify `inventory_csv`, live Shopify Admin GraphQL (`use_live_shopify: true`), or zero-key `demo_mode: true`.",
      inputSchema: {
        skus: z.array(SkuSignalSchema).max(2500).optional().describe("Structured SKU inventory + velocity rows."),
        inventory_csv: z.string().max(2_000_000).optional().describe("Raw CSV exported from Shopify Admin Products or merchant reorder spreadsheet."),
        use_live_shopify: z.boolean().default(false).describe("Pull live variants and paid order velocity from configured Shopify Admin GraphQL API."),
        demo_mode: z.boolean().default(false).describe("Run immediately against the built-in US Shopify merchant dataset (no API keys required)."),
        service_level: ServiceLevelSchema,
        review_period_days: z.number().int().min(1).max(180).default(14).describe("Days between purchasing review cycles (e.g., 7 for weekly, 14 for bi-weekly)."),
        window_days: z.number().int().min(1).max(365).default(30).describe("Lookback window in days when parsing CSV or querying live Shopify orders.")
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (args) => {
      try {
        const { source, signals } = await resolveSkuInputs(args);
        const summary = computeReplenishmentPlan(signals, {
          serviceLevel: args.service_level,
          reviewPeriodDays: args.review_period_days
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ok: true, data_source: source, ...summary }, null, 2)
            }
          ]
        };
      } catch (err) {
        return formatError("calculate_replenishment_plan", err);
      }
    }
  );

  // Tool 2: Vendor MOQ Purchase Order & Shopify Draft PO CSV Builder
  server.registerTool(
    "build_supplier_purchase_orders",
    {
      title: "Build MOQ-Compliant Supplier POs & Shopify Draft PO CSVs",
      description:
        "Turns SKU demand signals into ready-to-send Purchase Orders grouped by vendor. Enforces carton/case-pack multiples, per-SKU MOQs, and supplier-level minimum units or minimum dollar order thresholds (smartly topping up fastest-moving A-class SKUs to hit free-freight or vendor minimums without buying dead stock). Outputs both ready-to-import Shopify Native Draft PO CSV (`SKU,Supplier SKU,Quantity,Cost,Tax %`) and formatted vendor PO emails.",
      inputSchema: {
        skus: z.array(SkuSignalSchema).max(2500).optional().describe("Structured SKU inventory + velocity rows."),
        inventory_csv: z.string().max(2_000_000).optional().describe("Raw Shopify Products/Inventory CSV text."),
        supplier_rules: z.array(SupplierRuleSchema).max(500).optional().describe("Per-vendor MOQ, minimum USD spend, payment terms, email, and ship-to location rules."),
        use_live_shopify: z.boolean().default(false).describe("Pull live store SKUs from Shopify Admin GraphQL."),
        demo_mode: z.boolean().default(false).describe("Generate full multi-vendor POs using the built-in Austin, TX merchant demo dataset."),
        service_level: ServiceLevelSchema,
        review_period_days: z.number().int().min(1).max(180).default(14).describe("Days of forward cover to buy beyond lead time."),
        po_prefix: z.string().min(1).max(40).default("PO-2026").describe("Prefix for generated Purchase Order numbers.")
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (args) => {
      try {
        const { source, signals } = await resolveSkuInputs(args);
        const plan = computeReplenishmentPlan(signals, {
          serviceLevel: args.service_level,
          reviewPeriodDays: args.review_period_days
        });
        const rules = args.demo_mode && (!args.supplier_rules || args.supplier_rules.length === 0)
          ? DEMO_SUPPLIER_RULES
          : args.supplier_rules ?? [];
        const poBundle = generateSupplierPurchaseOrders(plan.items, rules, args.po_prefix);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: true,
                  data_source: source,
                  purchase_orders_count: poBundle.purchase_orders.length,
                  total_po_spend_usd: poBundle.total_po_spend_usd,
                  purchase_orders: poBundle.purchase_orders
                },
                null,
                2
              )
            }
          ]
        };
      } catch (err) {
        return formatError("build_supplier_purchase_orders", err);
      }
    }
  );

  // Tool 3: Accounts Payable 3-Way Match Audit
  server.registerTool(
    "reconcile_po_three_way_match",
    {
      title: "Audit PO vs Warehouse Receiving vs Supplier Invoice (3-Way Match)",
      description:
        "Deterministic Finance Ops 3-way match engine for wholesalers and Shopify merchants. Cross-examines approved Purchase Order lines, warehouse dock receiving counts (good vs damaged units), and billed supplier invoice lines to catch silent unit-price creep, short-shipments billed in full, unapproved surcharges, and freight cap overages. Calculates exact verified payable USD and drafts a ready-to-send Vendor Debit Memo / Dispute Email.",
      inputSchema: {
        po_number: z.string().max(80).default("PO-2026-1042").describe("Purchase Order reference number."),
        vendor: z.string().max(160).default("Supplier").describe("Vendor or distributor name."),
        po_lines: z.array(PoLineSchema).max(2000).optional().describe("Approved Purchase Order line items."),
        receiving_lines: z.array(ReceivingLineSchema).max(2000).optional().describe("Warehouse receiving counts per SKU."),
        invoice_lines: z.array(InvoiceLineSchema).max(2000).optional().describe("Billed lines extracted from the supplier PDF/CSV invoice."),
        invoice_extra_fees_usd: z.number().min(0).max(10000000).default(0).describe("Freight, pallet, or handling charges billed on the invoice."),
        agreed_freight_cap_usd: z.number().min(0).max(10000000).optional().describe("Maximum freight/shipping charge agreed on the PO, if applicable."),
        demo_mode: z.boolean().default(false).describe("Run a realistic 3-way match audit catching silent price creep, damaged units, and unapproved pallet fees.")
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (args) => {
      try {
        const payload = args.demo_mode
          ? DEMO_THREE_WAY_MATCH
          : {
              po_number: args.po_number,
              vendor: args.vendor,
              po_lines: args.po_lines ?? [],
              receiving_lines: args.receiving_lines ?? [],
              invoice_lines: args.invoice_lines ?? [],
              invoice_extra_fees_usd: args.invoice_extra_fees_usd,
              agreed_freight_cap_usd: args.agreed_freight_cap_usd
            };

        if (!args.demo_mode && (payload.po_lines.length === 0 || payload.invoice_lines.length === 0)) {
          throw new Error("Provide non-empty `po_lines` and `invoice_lines`, or pass `demo_mode: true` to inspect a sample audit.");
        }

        const result = runThreeWayMatch(payload);
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, ...result }, null, 2) }]
        };
      } catch (err) {
        return formatError("reconcile_po_three_way_match", err);
      }
    }
  );

  // Tool 4: Stocky CSV Supplier & Lead-Time Recovery
  server.registerTool(
    "migrate_stocky_csv_snapshot",
    {
      title: "Recover Supplier Directory, Real Lead Times & MOQs from Stocky PO CSV",
      description:
        "Shopify Stocky shut down on August 31, 2026 and never provided a Supplier Directory export. Paste a historical Stocky Purchase Orders CSV export (or pass `demo_mode: true`) and this tool reconstructs every supplier profile: actual observed lead-time average and standard deviation from Created-to-Received timestamps, latest SKU unit cost, GCD-inferred carton pack sizes, historical minimum PO spend, and ready-to-use `supplier_rules` JSON for `build_supplier_purchase_orders`.",
      inputSchema: {
        stocky_po_csv: z.string().max(5_000_000).optional().describe("Raw CSV content from Stocky Purchase Orders export."),
        demo_mode: z.boolean().default(false).describe("Test supplier reconstruction using the built-in Stocky PO CSV fixture.")
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async (args) => {
      try {
        const csvText = args.demo_mode ? DEMO_STOCKY_PO_CSV : args.stocky_po_csv ?? "";
        if (!csvText.trim()) {
          throw new Error("Provide `stocky_po_csv` text from your Stocky PO export, or set `demo_mode: true`.");
        }
        const recovered = migrateStockyPoCsv(csvText);
        if (recovered.suppliers_recovered === 0) {
          throw new Error("Could not find supplier rows in `stocky_po_csv`. Ensure columns include `Supplier` (or `Vendor`) and `SKU`.");
        }
        return {
          content: [{ type: "text", text: JSON.stringify({ ok: true, ...recovered }, null, 2) }]
        };
      } catch (err) {
        return formatError("migrate_stocky_csv_snapshot", err);
      }
    }
  );

  // Resource: Shopify Native Draft PO CSV Specification
  server.registerResource(
    "shopify-po-csv-spec",
    "popilot://guide/shopify-po-csv-spec",
    {
      title: "Shopify Native Draft Purchase Order CSV Upload Format",
      description: "Column contract and post-Stocky workflow instructions for importing POs into Shopify Admin.",
      mimeType: "text/markdown"
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: [
            "# Shopify Admin Native Draft PO CSV Specification (Post-Stocky 2026)",
            "",
            "Columns generated by `build_supplier_purchase_orders`:",
            "- `SKU` (exact Variant SKU in Shopify Admin)",
            "- `Supplier SKU` (vendor catalog code)",
            "- `Quantity` (positive integer rounded to vendor carton multiple)",
            "- `Cost` (unit cost in store currency, e.g. `6.40`)",
            "- `Tax %` (optional tax percentage, e.g. `0.00`)",
            "",
            "Upload path: **Shopify Admin → Products → Purchase orders → Create purchase order → Add products → Import CSV**."
          ].join("\n")
        }
      ]
    })
  );

  // Prompt: Monday Morning Reorder Run
  server.registerPrompt(
    "monday_morning_reorder_run",
    {
      title: "Monday Morning Shopify Replenishment & Vendor PO Run",
      description: "Runs a complete stockout-adjusted reorder audit and builds MOQ-compliant Shopify Draft PO CSVs.",
      argsSchema: {
        service_level: z.string().optional().describe("Target service level: 90%, 95%, 97.5%, or 99% (default 95%).")
      }
    },
    async ({ service_level }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Run \`build_supplier_purchase_orders\` with service_level="${service_level ?? "95%"}" (use demo_mode=true if I haven't pasted a CSV or connected live Shopify yet). Show me: (1) CRITICAL stockout SKUs, (2) whether any vendor needed an MOQ carton top-up, (3) the copy-paste Shopify Draft PO CSV per supplier, and (4) the supplier PO emails.`
          }
        }
      ]
    })
  );

  return server;
}
