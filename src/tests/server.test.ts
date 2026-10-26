import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { escapeCsvCell, mapInventoryCsvToSignals, parseCsv } from "../csvUtils.js";
import { DEMO_SKU_SIGNALS, DEMO_STOCKY_PO_CSV, DEMO_SUPPLIER_RULES, DEMO_THREE_WAY_MATCH } from "../demoData.js";
import {
  clearEntitlementCache,
  FREE_LOCAL_MAX_INVOICE_LINES,
  FREE_LOCAL_MAX_SKUS,
  mintEd25519LicenseToken,
  resolveEntitlement
} from "../entitlements.js";
import { generateSupplierPurchaseOrders } from "../engines/purchaseOrder.js";
import { computeReplenishmentPlan } from "../engines/replenishment.js";
import { migrateStockyPoCsv } from "../engines/stockyMigration.js";
import { runThreeWayMatch } from "../engines/threeWayMatch.js";
import { fetchLiveShopifySignals, resolveShopifyConfig } from "../shopifyClient.js";

describe("PO Pilot Domain Engines", () => {
  it("computes stockout-adjusted velocity, ABC tiers, and carton-rounded quantities", () => {
    const plan = computeReplenishmentPlan(DEMO_SKU_SIGNALS, { serviceLevel: "95%", reviewPeriodDays: 14 });
    assert.equal(plan.total_skus_analyzed, 6);
    assert.ok(plan.critical_stockout_skus >= 2);

    const blackMug = plan.items.find((i) => i.sku === "HO-MUG-12OZ-BLK");
    assert.ok(blackMug);
    assert.equal(blackMug.adjusted_daily_velocity, 8.4);
    assert.equal(blackMug.recommended_order_units % 24, 0);
    assert.equal(blackMug.abc_class, "A");

    const waxTin = plan.items.find((i) => i.sku === "HO-WAX-TIN-4OZ");
    assert.ok(waxTin);
    assert.equal(waxTin.stockout_risk, "OVERSTOCK");
    assert.equal(waxTin.recommended_order_units, 0);
  });

  it("parses US comma-formatted thousands, TSV/semicolon sheets, accounting negatives, and merges multi-location duplicate SKUs", () => {
    const csv = [
      "Variant SKU,Title,Vendor,On Hand,Committed,Units Sold,Cost per item,Variant Price",
      'SKU-COMMA,"Heavy | Rope","Acme","1,250","-4","3,000","$1,120.50","$2,500.00"',
      'SKU-COMMA,"Heavy | Rope","acme ","250","0","500","$1,120.50","$2,500.00"'
    ].join("\n");
    const signals = mapInventoryCsvToSignals(csv, 30);
    assert.equal(signals.length, 2);
    assert.equal(signals[0].on_hand, 1250);
    assert.equal(signals[0].committed, 0);

    // Replenishment + PO builder must deduplicate multi-location SKU rows & merge vendor casing
    const plan = computeReplenishmentPlan(signals, { serviceLevel: "95%", reviewPeriodDays: 14 });
    assert.equal(plan.total_skus_analyzed, 1);
    assert.equal(plan.items[0].inventory_position, 1500); // 1250 + 250 merged!

    // Semicolon CSV + accounting negative "(6)" On Hand + 0 velocity backorder -> CRITICAL & C-class
    const semiCsv = [
      "Variant SKU;Title;Vendor;On Hand;Committed;Units Sold;Cost per item;Variant Price",
      "SKU-BACKORDER; Custom Valve | Brass ;Indo Vendor;(6);2;0;$12.00;$30.00"
    ].join("\n");
    const semiSignals = mapInventoryCsvToSignals(semiCsv, 30);
    assert.equal(semiSignals.length, 1);
    assert.equal(semiSignals[0].on_hand, -6);
    const backorderPlan = computeReplenishmentPlan(semiSignals);
    assert.equal(backorderPlan.items[0].abc_class, "C");
    assert.equal(backorderPlan.items[0].stockout_risk, "CRITICAL");
    assert.ok(backorderPlan.items[0].recommended_order_units >= 8);

    // Tab-separated (Google Sheets / Excel copy-paste) + pipe escaping in PO Markdown table
    const tsv = [
      "Variant SKU\tTitle\tVendor\tOn Hand\tUnits Sold\tCost per item\tVariant Price",
      "SKU-TSV-1\tMug | 12oz\tVendor One\t0\t90\t5.00\t18.00",
      "SKU-TSV-2\tCap | Lid\tvendor one \t0\t60\t2.00\t9.00"
    ].join("\n");
    const tsvPlan = computeReplenishmentPlan(mapInventoryCsvToSignals(tsv, 30));
    const tsvPos = generateSupplierPurchaseOrders(tsvPlan.items, [], "PO-TSV");
    assert.equal(tsvPos.purchase_orders.length, 1); // Case-insensitive vendor merge!
    assert.ok(tsvPos.purchase_orders[0].vendor_email_markdown.includes("Mug \\| 12oz"));
  });

  it("enforces vendor USD minimum order value via A-item closed-form carton top-up (>500 cartons) and emits Shopify CSV", () => {
    const plan = computeReplenishmentPlan(DEMO_SKU_SIGNALS, { serviceLevel: "95%", reviewPeriodDays: 14 });
    const bundle = generateSupplierPurchaseOrders(plan.items, DEMO_SUPPLIER_RULES, "PO-TEST");
    assert.equal(bundle.purchase_orders.length, 2);

    const pacificPo = bundle.purchase_orders.find((p) => p.vendor === "Pacific Stainless Works");
    assert.ok(pacificPo);
    assert.ok(pacificPo.subtotal_usd >= 2200);
    assert.ok(pacificPo.shopify_draft_po_csv.startsWith("SKU,Supplier SKU,Quantity,Cost,Tax %"));

    // Closed-form >500-carton test + A-class priority over higher-unit-velocity cheap C-item
    const cheapAndHeroPlan = computeReplenishmentPlan([
      {
        sku: "CHEAP-STICKER-C",
        title: "Logo Sticker",
        vendor: "Bulk Co",
        on_hand: 0,
        committed: 0,
        on_order: 0,
        backorders: 0,
        units_sold_window: 300, // 10/day velocity, tiny margin -> C class
        window_days: 30,
        stockout_days: 0,
        unit_cost_usd: 0.2,
        retail_price_usd: 0.5,
        lead_time_days: 10,
        lead_time_std_dev_days: 1,
        case_pack: 1,
        sku_moq: 10
      },
      {
        sku: "HERO-JACKET-A",
        title: "Waxed Field Jacket",
        vendor: "Bulk Co",
        on_hand: 0,
        committed: 0,
        on_order: 0,
        backorders: 0,
        units_sold_window: 150, // 5/day velocity, huge margin -> A class
        window_days: 30,
        stockout_days: 0,
        unit_cost_usd: 2.0,
        retail_price_usd: 65.0,
        lead_time_days: 10,
        lead_time_std_dev_days: 1,
        case_pack: 1,
        sku_moq: 10
      }
    ]);
    const bigMoqBundle = generateSupplierPurchaseOrders(
      cheapAndHeroPlan.items,
      [{ vendor: "Bulk Co", payment_terms: "Net 30", currency: "USD", min_order_units: 0, min_order_value_usd: 5000, ship_to_location: "Main" }],
      "PO-BIG"
    );
    assert.equal(bigMoqBundle.purchase_orders.length, 1);
    const bigPo = bigMoqBundle.purchase_orders[0];
    assert.ok(bigPo.subtotal_usd >= 5000, `Expected subtotal >= 5000, got ${bigPo.subtotal_usd}`);
    // Top-up must go to HERO-JACKET-A (A-class), NOT CHEAP-STICKER-C!
    const heroLine = bigPo.lines.find((l) => l.sku === "HERO-JACKET-A");
    const stickerLine = bigPo.lines.find((l) => l.sku === "CHEAP-STICKER-C");
    assert.ok(heroLine && stickerLine);
    assert.ok(heroLine.order_qty > 2000);
    assert.ok(stickerLine.order_qty < 500);
    assert.ok(bigPo.shopify_transfer_import_csv.startsWith("SKU,Barcode,Quantity\n"));
  });

  it("computes US import tariff landed costs, margin-erosion alerts, Shopify POS Transfer CSVs, and Open-to-Buy (OTB) cashflow rationing", () => {
    const plan = computeReplenishmentPlan([
      {
        sku: "HERO-MUG-A",
        barcode: "850012345001",
        title: "Insulated Mug 16oz",
        vendor: "Shenzhen Drinkware",
        on_hand: 5,
        committed: 10, // net -5 CRITICAL deficit!
        on_order: 0,
        backorders: 0,
        units_sold_window: 300, // 10/day, high margin -> A-class CRITICAL
        window_days: 30,
        stockout_days: 0,
        unit_cost_usd: 5.0,
        retail_price_usd: 30.0,
        lead_time_days: 20,
        lead_time_std_dev_days: 2,
        case_pack: 20,
        sku_moq: 20
      },
      {
        sku: "LOW-MARGIN-LID-C",
        barcode: "850012345002",
        title: "Replacement Plastic Lid",
        vendor: "Shenzhen Drinkware",
        on_hand: 35,
        committed: 0,
        on_order: 0,
        backorders: 0,
        units_sold_window: 60, // 2/day, low margin -> C-class REORDER_NOW
        window_days: 30,
        stockout_days: 0,
        unit_cost_usd: 4.0,
        retail_price_usd: 6.0, // 25% tariff + freight pushes landed cost >= $5.00 (<40% margin!)
        lead_time_days: 20,
        lead_time_std_dev_days: 2,
        case_pack: 10,
        sku_moq: 10
      }
    ]);

    const uncapped = generateSupplierPurchaseOrders(
      plan.items,
      [
        {
          vendor: "Shenzhen Drinkware",
          payment_terms: "Net 30",
          currency: "USD",
          min_order_units: 0,
          min_order_value_usd: 0,
          ship_to_location: "LA 3PL",
          import_duty_pct: 25,
          estimated_freight_usd: 150
        }
      ],
      "PO-IMPORT"
    );
    const uncappedPo = uncapped.purchase_orders[0];
    assert.ok(uncappedPo.estimated_duty_usd > 0);
    assert.equal(uncappedPo.estimated_freight_usd, 150);
    assert.equal(
      uncappedPo.total_landed_cost_usd,
      Number((uncappedPo.subtotal_usd + uncappedPo.estimated_duty_usd + 150).toFixed(2))
    );
    assert.ok(uncappedPo.shopify_transfer_import_csv.includes("HERO-MUG-A,850012345001,"));
    const lidLine = uncappedPo.lines.find((l) => l.sku === "LOW-MARGIN-LID-C");
    assert.ok(lidLine);
    assert.equal(lidLine.margin_erosion_warning, true);

    // Apply Open-to-Buy (OTB) cash ceiling tighter than uncapped total_landed_po_spend_usd
    const budgetCap = 2200;
    assert.ok(uncapped.total_landed_po_spend_usd > budgetCap);

    const rationed = generateSupplierPurchaseOrders(
      plan.items,
      [
        {
          vendor: "Shenzhen Drinkware",
          payment_terms: "Net 30",
          currency: "USD",
          min_order_units: 0,
          min_order_value_usd: 0,
          ship_to_location: "LA 3PL",
          import_duty_pct: 25,
          estimated_freight_usd: 150
        }
      ],
      "PO-OTB",
      { maxCashBudgetUsd: budgetCap, minGrossMarginPct: 40 }
    );
    assert.ok(rationed.otb_summary);
    assert.equal(rationed.otb_summary.budget_respected, true);
    assert.ok(rationed.total_landed_po_spend_usd <= budgetCap);
    assert.ok(rationed.otb_summary.cartons_trimmed > 0);
    // CRITICAL A-class HERO-MUG-A must remain protected with positive cartons while C-class lid is trimmed first!
    const rationedPo = rationed.purchase_orders[0];
    const rationedHero = rationedPo.lines.find((l) => l.sku === "HERO-MUG-A");
    assert.ok(rationedHero && rationedHero.order_qty >= 200);
    assert.ok(rationedPo.shopify_draft_po_csv.includes(`HERO-MUG-A,HERO-MUG-A,${rationedHero.order_qty},`));
    assert.ok(rationedPo.shopify_transfer_import_csv.includes(`HERO-MUG-A,850012345001,${rationedHero.order_qty}`));

    // Edge case: multiple $0.00 promo SKUs with $200 fixed vendor freight under a $100 OTB cap must drop freight-bearing $0 PO
    const zeroCostPlan = computeReplenishmentPlan([
      {
        sku: "PROMO-STICKER-1",
        title: "Free Sticker 1",
        vendor: "Promo Vendor",
        on_hand: 0,
        committed: 0,
        on_order: 0,
        backorders: 0,
        units_sold_window: 60,
        window_days: 30,
        stockout_days: 0,
        unit_cost_usd: 0,
        retail_price_usd: 0,
        lead_time_days: 10,
        lead_time_std_dev_days: 1,
        case_pack: 10,
        sku_moq: 10
      },
      {
        sku: "PROMO-STICKER-2",
        title: "Free Sticker 2",
        vendor: "Promo Vendor",
        on_hand: 0,
        committed: 0,
        on_order: 0,
        backorders: 0,
        units_sold_window: 60,
        window_days: 30,
        stockout_days: 0,
        unit_cost_usd: 0,
        retail_price_usd: 0,
        lead_time_days: 10,
        lead_time_std_dev_days: 1,
        case_pack: 10,
        sku_moq: 10
      }
    ]);
    const zeroCostOtb = generateSupplierPurchaseOrders(
      zeroCostPlan.items,
      [
        {
          vendor: "Promo Vendor",
          payment_terms: "Net 30",
          currency: "USD",
          min_order_units: 0,
          min_order_value_usd: 0,
          estimated_freight_usd: 200,
          ship_to_location: "US Hub"
        }
      ],
      "PO-ZERO",
      { maxCashBudgetUsd: 100 }
    );
    assert.equal(zeroCostOtb.total_landed_po_spend_usd, 0);
    assert.equal(zeroCostOtb.otb_summary?.budget_respected, true);
  });

  it("catches price creep, unshipped missing receiving SKUs, split-pallet receiving, and freight overages in 3-way match", () => {
    const audit = runThreeWayMatch(DEMO_THREE_WAY_MATCH);
    assert.equal(audit.payment_recommendation, "HOLD_AND_ISSUE_DEBIT_MEMO");
    assert.equal(audit.discrepancies.length, 5);
    const itemizedSum = Number(audit.discrepancies.reduce((s, d) => s + d.overcharge_usd, 0).toFixed(2));
    assert.equal(itemizedSum, audit.total_overcharge_recovered_usd);

    // Regression: SKU-MISSING completely absent from non-empty receiving_lines + SKU-SPLIT across 2 pallets
    const splitAndMissingAudit = runThreeWayMatch({
      po_number: "PO-SPLIT-1",
      vendor: "Test Vendor",
      po_lines: [
        { sku: "SKU-SPLIT", ordered_qty: 100, unit_cost_usd: 10 },
        { sku: "SKU-NEVER-ARRIVED", ordered_qty: 50, unit_cost_usd: 20 }
      ],
      receiving_lines: [
        { sku: "SKU-SPLIT", received_good_qty: 60, damaged_qty: 0 },
        { sku: "SKU-SPLIT", received_good_qty: 40, damaged_qty: 0 }
      ],
      invoice_lines: [
        { sku: "SKU-SPLIT", billed_qty: 100, billed_unit_cost_usd: 10 },
        { sku: "SKU-NEVER-ARRIVED", billed_qty: 50, billed_unit_cost_usd: 20 }
      ]
    });
    //SKU-SPLIT received 60+40=100 ($1,000 ok), SKU-NEVER-ARRIVED received 0 ($1,000 overcharge!)
    assert.equal(splitAndMissingAudit.verified_payable_amount_usd, 1000);
    assert.equal(splitAndMissingAudit.total_overcharge_recovered_usd, 1000);
    assert.equal(splitAndMissingAudit.discrepancies.length, 1);
    assert.equal(splitAndMissingAudit.discrepancies[0].sku, "SKU-NEVER-ARRIVED");

    // Case-insensitive SKU matching between lowercase ERP PO and uppercase PDF invoice
    const caseAudit = runThreeWayMatch({
      po_number: "PO-CASE-1",
      vendor: "Case Vendor",
      po_lines: [{ sku: "ho-mug-12oz-blk", ordered_qty: 24, unit_cost_usd: 6.4 }],
      receiving_lines: [{ sku: "Ho-Mug-12Oz-Blk", received_good_qty: 24, damaged_qty: 0 }],
      invoice_lines: [{ sku: "HO-MUG-12OZ-BLK", billed_qty: 24, billed_unit_cost_usd: 6.4 }]
    });
    assert.equal(caseAudit.payment_recommendation, "APPROVE_IN_FULL");
    assert.equal(caseAudit.discrepancies.length, 0);

    // Verify QuickBooks Online & Xero Bill CSV exports contain ONLY verified payable amounts ($2,386.20 on DEMO)
    assert.ok(
      audit.quickbooks_bill_csv.startsWith(
        "BillNo,Supplier,BillDate,DueDate,LineDescription,LineAmount,Account,LineTaxCode,Currency\n"
      )
    );
    assert.ok(!audit.quickbooks_bill_csv.includes("PALLET-WRAP-SURCHARGE"));
    const qboRows = audit.quickbooks_bill_csv.trim().split("\n").slice(1);
    const qboSum = Number(
      qboRows.reduce((acc: number, r: string) => acc + Number(r.split(",")[5]), 0).toFixed(2)
    );
    assert.equal(qboSum, audit.verified_payable_amount_usd);

    assert.ok(
      audit.xero_bill_csv.startsWith(
        "*ContactName,*InvoiceNumber,*InvoiceDate,*DueDate,InventoryItemCode,Description,*Quantity,*UnitAmount,*AccountCode,*TaxType,Currency\n"
      )
    );
    assert.ok(!audit.xero_bill_csv.includes("PALLET-WRAP-SURCHARGE"));
    const xeroRows = audit.xero_bill_csv.trim().split("\n").slice(1);
    const xeroSum = Number(
      xeroRows
        .reduce((acc: number, r: string) => {
          const cols = r.split(",");
          return acc + Number(cols[6]) * Number(cols[7]);
        }, 0)
        .toFixed(2)
    );
    assert.equal(xeroSum, audit.verified_payable_amount_usd);

    // Adversarial CSV check: commas/quotes in vendor/title + OWASP CWE-1236 formula injection neutralization
    const injectionAudit = runThreeWayMatch({
      po_number: "PO-SEC-1",
      vendor: '=CMD|\'/C calc\'!A0, "Inc."',
      invoice_number: "@INV-77",
      po_lines: [{ sku: "SKU-1", title: 'Mug, "Pro" Edition', ordered_qty: 10, unit_cost_usd: 5.0 }],
      receiving_lines: [{ sku: "SKU-1", received_good_qty: 10, damaged_qty: 0 }],
      invoice_lines: [{ sku: "SKU-1", billed_qty: 10, billed_unit_cost_usd: 5.0 }]
    });
    const parsedQbo = parseCsv(injectionAudit.quickbooks_bill_csv);
    assert.equal(parsedQbo.length, 1);
    assert.ok(parsedQbo[0].BillNo.startsWith("'@INV-77"));
    assert.ok(parsedQbo[0].Supplier.startsWith("'=CMD"));
    assert.equal(Number(parsedQbo[0].LineAmount), 50);

    // Pass-5 #2: Advanced OWASP CWE-1236 vectors (+1+SUM, -2+CMD, leading whitespace/newline =CMD) vs valid negative decimal
    assert.ok(escapeCsvCell("+1+SUM(A1:A2)").startsWith("'+1+SUM"));
    assert.ok(escapeCsvCell("-2+CMD|'/C calc'!A0").startsWith("'-2+CMD"));
    assert.ok(escapeCsvCell(" =CMD|'/C calc'!A0").startsWith("' =CMD"));
    assert.ok(escapeCsvCell("\n=CMD|'/C calc'!A0").startsWith("\"'"));
    assert.equal(escapeCsvCell("-12.50"), "-12.50");
    assert.equal(escapeCsvCell("HO-MUG-12OZ-BLK"), "HO-MUG-12OZ-BLK");

    // Pass-5 #1: Sub-mill 4-decimal wholesale price creep (10,000 units @ +$0.0005 = $5.00 overcharge) MUST flag HOLD
    const subMillAudit = runThreeWayMatch({
      po_number: "PO-SUBMILL-1",
      vendor: "Bulk Poly Packaging",
      invoice_date: "2026-02-31", // Pass-5 #4: impossible calendar date must NOT emit 2026-02-31
      po_lines: [{ sku: "POLY-BAG-4MIL", ordered_qty: 10000, unit_cost_usd: 0.12 }],
      receiving_lines: [{ sku: "POLY-BAG-4MIL", received_good_qty: 10000, damaged_qty: 0 }],
      invoice_lines: [{ sku: "POLY-BAG-4MIL", billed_qty: 10000, billed_unit_cost_usd: 0.1205 }]
    });
    assert.equal(subMillAudit.payment_recommendation, "HOLD_AND_ISSUE_DEBIT_MEMO");
    assert.equal(subMillAudit.total_overcharge_recovered_usd, 5);
    assert.equal(subMillAudit.discrepancies.length, 1);
    assert.equal(subMillAudit.discrepancies[0].issue_type, "UNIT_PRICE_OVERCHARGE");
    assert.equal(subMillAudit.discrepancies[0].overcharge_usd, 5);
    assert.notEqual(subMillAudit.invoice_date, "2026-02-31");
    assert.ok(!subMillAudit.quickbooks_bill_csv.includes("2026-02-31"));
    assert.ok(!subMillAudit.xero_bill_csv.includes("2026-02-31"));
  });

  it("reconstructs supplier lead times, lowercase headers, and newest-first chronological cost from Stocky CSV", () => {
    const migrated = migrateStockyPoCsv(DEMO_STOCKY_PO_CSV);
    assert.equal(migrated.suppliers_recovered, 2);
    assert.equal(migrated.skus_recovered, 4);
    const pacific = migrated.profiles.find((p) => p.vendor === "Pacific Stainless Works");
    assert.ok(pacific);
    assert.equal(pacific.observed_avg_lead_time_days, 22);

    // Newest-first (descending) export with lowercase headers & mixed SKU/vendor casing must merge into 1 SKU & keep 2026 cost ($9.75)!
    const descendingCsv = [
      "po_number,supplier,sku,product_title,quantity_ordered,cost_price,created_at,received_at",
      "PO-2026,Summit Gear,SG-BOTTLE,Bottle,48,$9.75,2026-08-01,2026-08-15",
      "PO-2024,summit gear ,sg-bottle,Bottle,24,$7.10,2024-03-01,2024-03-19"
    ].join("\n");
    const descResult = migrateStockyPoCsv(descendingCsv);
    assert.equal(descResult.suppliers_recovered, 1);
    assert.equal(descResult.skus_recovered, 1);
    assert.equal(descResult.profiles[0].skus[0].latest_unit_cost_usd, 9.75);
    assert.equal(descResult.profiles[0].skus[0].inferred_case_pack, 24);
  });

  it("paginates Shopify Admin GraphQL across multiple cursor pages for variants and orders", async () => {
    const mockShopify = createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw) as { query: string; variables: Record<string, string | null> };
      res.writeHead(200, { "Content-Type": "application/json" });

      if (body.query.includes("productVariants")) {
        if (!body.variables.cursor) {
          res.end(
            JSON.stringify({
              data: {
                productVariants: {
                  pageInfo: { hasNextPage: true, endCursor: "CUR_VAR_2" },
                  nodes: [
                    {
                      sku: "PG-SKU-1",
                      title: "Default Title",
                      price: "30.00",
                      inventoryQuantity: 12,
                      product: { title: "Item One", vendor: "Vendor A", status: "ACTIVE" },
                      inventoryItem: { unitCost: { amount: "10.00" } }
                    }
                  ]
                }
              }
            })
          );
        } else {
          res.end(
            JSON.stringify({
              data: {
                productVariants: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [
                    {
                      sku: "PG-SKU-2",
                      title: "Large",
                      price: "50.00",
                      inventoryQuantity: 5,
                      product: { title: "Item Two", vendor: "Vendor B", status: "ACTIVE" },
                      inventoryItem: { unitCost: { amount: "20.00" } }
                    }
                  ]
                }
              }
            })
          );
        }
        return;
      }

      // Orders query pagination
      if (!body.variables.cursor) {
        res.end(
          JSON.stringify({
            data: {
              orders: {
                pageInfo: { hasNextPage: true, endCursor: "CUR_ORD_2" },
                nodes: [{ lineItems: { nodes: [{ sku: "PG-SKU-1", quantity: 15 }] } }]
              }
            }
          })
        );
      } else {
        res.end(
          JSON.stringify({
            data: {
              orders: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    lineItems: {
                      nodes: [
                        { sku: "PG-SKU-1", quantity: 25 },
                        { sku: "PG-SKU-2", quantity: 10 }
                      ]
                    }
                  }
                ]
              }
            }
          })
        );
      }
    });

    await new Promise<void>((resolve) => mockShopify.listen(0, "127.0.0.1", () => resolve()));
    const port = (mockShopify.address() as { port: number }).port;

    try {
      const signals = await fetchLiveShopifySignals(
        {
          storeDomain: "test.myshopify.com",
          accessToken: "shpat_test",
          baseUrlOverride: `http://127.0.0.1:${port}`
        },
        30
      );
      assert.equal(signals.length, 2);
      const sku1 = signals.find((s) => s.sku === "PG-SKU-1");
      const sku2 = signals.find((s) => s.sku === "PG-SKU-2");
      assert.equal(sku1?.units_sold_window, 40); // 15 (page 1) + 25 (page 2)
      assert.equal(sku2?.units_sold_window, 10);
    } finally {
      mockShopify.close();
    }
  });
});

describe("End-to-End MCP Stdio & Streamable HTTP + n8n Workflow Contracts", () => {
  it("boots cleanly with zero env vars, applies supplier_rules lead_time_days to PO math, and handles errors gracefully", async () => {
    const transport = new StdioClientTransport({
      command: "node",
      args: ["dist/index.js"],
      env: { PATH: process.env.PATH ?? "" }
    });
    const client = new Client({ name: "po-pilot-test-client", version: "1.0.0" });

    try {
      await client.connect(transport);

      const toolsRes = await client.listTools();
      assert.equal(toolsRes.tools.length, 4);

      // Verify supplier_rules.lead_time_days actually scales PO order quantities!
      const singleSku = [
        {
          sku: "LT-TEST-SKU",
          title: "Lead Time Test Item",
          vendor: "Slow Boat Vendor",
          on_hand: 10,
          committed: 0,
          on_order: 0,
          backorders: 0,
          units_sold_window: 60, // 2/day
          window_days: 30,
          stockout_days: 0,
          unit_cost_usd: 10,
          retail_price_usd: 25,
          lead_time_days: 7,
          lead_time_std_dev_days: 1,
          case_pack: 1,
          sku_moq: 1
        }
      ];
      const shortLt = await client.callTool({
        name: "build_supplier_purchase_orders",
        arguments: { skus: singleSku, supplier_rules: [{ vendor: "Slow Boat Vendor", lead_time_days: 7 }] }
      });
      const longLt = await client.callTool({
        name: "build_supplier_purchase_orders",
        arguments: { skus: singleSku, supplier_rules: [{ vendor: "Slow Boat Vendor", lead_time_days: 60 }] }
      });
      const shortJson = JSON.parse((shortLt.content as Array<{ type: string; text: string }>)[0].text);
      const longJson = JSON.parse((longLt.content as Array<{ type: string; text: string }>)[0].text);
      assert.ok(longJson.purchase_orders[0].total_units > shortJson.purchase_orders[0].total_units + 80);

      // Graceful error test
      const errCall = await client.callTool({
        name: "calculate_replenishment_plan",
        arguments: { demo_mode: false }
      });
      assert.equal(errCall.isError, true);

      // Confirm server is STILL alive after error
      const stockyCall = await client.callTool({
        name: "migrate_stocky_csv_snapshot",
        arguments: { demo_mode: true }
      });
      assert.ok(!stockyCall.isError);
    } finally {
      await client.close();
    }
  });

  it("returns application/json on POST /mcp and executes all 3 n8n workflow JSON templates (#01, #02, #03) end-to-end", async () => {
    const { spawn } = await import("node:child_process");
    const port = 18942;
    const proc = spawn("node", ["dist/index.js", "--http"], {
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"]
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("HTTP startup timeout")), 4000);
        proc.stderr.on("data", (chunk: Buffer) => {
          if (chunk.toString().includes("listening on")) {
            clearTimeout(timer);
            resolve();
          }
        });
      });

      const healthRes = await fetch(`http://127.0.0.1:${port}/health`);
      assert.equal(healthRes.status, 200);

      // Load-balancer / wget --spider HEAD probe must also return 200 OK (never 404!)
      const headHealthRes = await fetch(`http://127.0.0.1:${port}/health`, { method: "HEAD" });
      assert.equal(headHealthRes.status, 200);

      const cardRes = await fetch(`http://127.0.0.1:${port}/.well-known/mcp/server-card.json`);
      assert.equal(cardRes.status, 200);
      const cardJson = (await cardRes.json()) as { authentication: { optional_env: string[] } };
      const diskCardJson = JSON.parse(readFileSync(".well-known/mcp/server-card.json", "utf8"));
      assert.deepEqual(cardJson, diskCardJson);
      assert.ok(cardJson.authentication.optional_env.includes("PO_PILOT_LICENSE_KEY"));

      // Call POST /mcp directly as n8n httpRequest does -> MUST return application/json!
      const mcpPoRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "build_supplier_purchase_orders", arguments: { demo_mode: true } }
        })
      });
      assert.equal(mcpPoRes.status, 200);
      assert.ok((mcpPoRes.headers.get("content-type") ?? "").includes("application/json"));
      const rawPoJson = await mcpPoRes.json();

      // Execute actual jsCode from n8n template #01!
      const wf01 = JSON.parse(readFileSync("sales-bundle/n8n-templates/01-monday-shopify-po-generator.json", "utf8")) as {
        nodes: Array<{ name: string; parameters: { jsCode?: string } }>;
      };
      const code01 = wf01.nodes.find((n) => n.name === "Parse Supplier POs & Shopify CSVs")?.parameters.jsCode;
      assert.ok(code01);
      const run01 = new Function("$input", code01) as (inp: { first: () => { json: unknown } }) => Array<{ json: Record<string, unknown> }>;
      const out01 = run01({ first: () => ({ json: rawPoJson }) });
      assert.equal(out01.length, 2);
      assert.equal(out01[0].json.hasOrders, true);
      assert.ok(String(out01[0].json.shopify_draft_po_csv).startsWith("SKU,Supplier SKU"));

      // Verify n8n template #01 throws visibly on unlicensed live_shopify error instead of pretending "No SKUs crossed reorder points"
      const mcpLockedRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "build_supplier_purchase_orders", arguments: { use_live_shopify: true } }
        })
      });
      const lockedJson = await mcpLockedRes.json();
      assert.throws(() => run01({ first: () => ({ json: lockedJson }) }), /Polar\.sh|upgrade|License/i);

      // Execute actual jsCode from n8n template #02!
      const mcpMatchRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "reconcile_po_three_way_match", arguments: { demo_mode: true } }
        })
      });
      const rawMatchJson = await mcpMatchRes.json();
      const wf02 = JSON.parse(readFileSync("sales-bundle/n8n-templates/02-supplier-invoice-3way-match-guard.json", "utf8")) as {
        nodes: Array<{ name: string; type: string; webhookId?: string; parameters: Record<string, unknown> }>;
      };
      const code02 = wf02.nodes.find((n) => n.name === "Unpack Audit Verdict")?.parameters.jsCode as string | undefined;
      assert.ok(code02);
      const run02 = new Function("$input", code02) as (inp: { first: () => { json: unknown } }) => Array<{ json: Record<string, unknown> }>;
      const out02 = run02({ first: () => ({ json: rawMatchJson }) });
      assert.equal(out02[0].json.payment_recommendation, "HOLD_AND_ISSUE_DEBIT_MEMO");

      // Validate genuine n8n v2 IfV2, SlackV2 (__rl + select), and Webhook (webhookId) schemas on both $49 templates!
      for (const wf of [wf01 as unknown as typeof wf02, wf02]) {
        const ifNode = wf.nodes.find((n) => n.type === "n8n-nodes-base.if");
        assert.ok(ifNode);
        const conds = ifNode.parameters.conditions as { combinator?: string; conditions?: unknown[] };
        assert.equal(conds.combinator, "and");
        assert.ok(Array.isArray(conds.conditions) && conds.conditions.length === 1);

        const slackNode = wf.nodes.find((n) => n.type === "n8n-nodes-base.slack");
        assert.ok(slackNode);
        assert.equal(slackNode.parameters.select, "channel");
        const chId = slackNode.parameters.channelId as { __rl?: boolean; mode?: string };
        assert.equal(chId.__rl, true);
        assert.equal(chId.mode, "name");
      }
      const whNode = wf02.nodes.find((n) => n.type === "n8n-nodes-base.webhook");
      assert.ok(whNode?.webhookId);

      // Execute actual jsCode & validate schema of n8n template #03 (Email PDF Invoice -> Auto 3-Way Match + QBO/Xero CSVs)!
      const wf03 = JSON.parse(
        readFileSync("sales-bundle/n8n-templates/03-email-pdf-invoice-auto-3way-match.json", "utf8")
      ) as {
        nodes: Array<{ name: string; type: string; typeVersion?: number; parameters: Record<string, unknown> }>;
      };
      const imapNode = wf03.nodes.find((n) => n.type === "n8n-nodes-base.emailReadImap");
      assert.ok(imapNode && imapNode.typeVersion === 2.1);
      const pdfNode = wf03.nodes.find((n) => n.type === "n8n-nodes-base.extractFromFile");
      assert.ok(pdfNode && pdfNode.parameters.operation === "pdf");

      const parsePdfCode = wf03.nodes.find((n) => n.name === "Parse PDF Invoice Text")?.parameters.jsCode as string | undefined;
      assert.ok(parsePdfCode);
      const runParsePdf = new Function("$input", parsePdfCode) as (inp: {
        first: () => { json: Record<string, unknown> };
      }) => Array<{ json: Record<string, unknown> }>;

      const samplePdfText = [
        "COMMERCIAL INVOICE",
        "Date: 2026-10-26",
        "Invoice Number: INV-9921",
        "Purchase Order #: PO-2026-1042",
        "Vendor: Pacific Stainless Works",
        "Freight & Handling: $240.00",
        "HO-MUG-12OZ-BLK   Double-Wall Camp Mug 12oz   240   $6.85   $1,644.00",
        "HO-FLASK-32OZ-RAW  96  $9.25",
        "PALLET-WRAP-SURCHARGE  Pallet Shrink Wrap Fee  1  $65.00  $65.00"
      ].join("\n");
      const parsedPdfPayload = runParsePdf({
        first: () => ({
          json: {
            text: samplePdfText,
            po_lines: DEMO_THREE_WAY_MATCH.po_lines,
            receiving_lines: DEMO_THREE_WAY_MATCH.receiving_lines,
            agreed_freight_cap_usd: DEMO_THREE_WAY_MATCH.agreed_freight_cap_usd
          }
        })
      })[0].json;
      assert.equal(parsedPdfPayload.invoice_number, "INV-9921");
      assert.equal(parsedPdfPayload.po_number, "PO-2026-1042");

      // Unparseable scanned image PDF without demo_mode must throw explicitly rather than faking a demo match!
      assert.throws(() =>
        runParsePdf({
          first: () => ({ json: { text: "   " } })
        })
      );

      // Pass-5 #5: Dotted SKUs ("HO.MUG.12"), 2-char SKUs ("A1"), and currency-less decimal price columns ("6.85  1,644.00")
      const dotAndPlainPdf = runParsePdf({
        first: () => ({
          json: {
            text: [
              "INVOICE: INV-505",
              "PO: PO-505",
              "HO.MUG.12   Camp Mug Matte   240   6.85   1,644.00",
              "A1   Mini Clip   50   3.00   150.00"
            ].join("\n"),
            po_lines: [
              { sku: "HO.MUG.12", ordered_qty: 240, unit_cost_usd: 6.85 },
              { sku: "A1", ordered_qty: 50, unit_cost_usd: 3.0 }
            ]
          }
        })
      })[0].json;
      const dotLines = dotAndPlainPdf.invoice_lines as Array<{ sku: string; billed_qty: number; billed_unit_cost_usd: number }>;
      assert.equal(dotLines.length, 2);
      assert.equal(dotLines[0].sku, "HO.MUG.12");
      assert.equal(dotLines[0].billed_qty, 240);
      assert.equal(dotLines[0].billed_unit_cost_usd, 6.85);
      assert.equal(dotLines[1].sku, "A1");
      assert.equal(dotLines[1].billed_qty, 50);
      assert.equal(dotLines[1].billed_unit_cost_usd, 3);

      const mcpPdfMatchRes = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "reconcile_po_three_way_match", arguments: parsedPdfPayload }
        })
      });
      const rawPdfMatchJson = await mcpPdfMatchRes.json();

      const unpack03Code = wf03.nodes.find((n) => n.name === "Unpack Audit & QBO/Xero CSVs")?.parameters.jsCode as string | undefined;
      assert.ok(unpack03Code);
      const runUnpack03 = new Function("$input", unpack03Code) as (inp: {
        first: () => { json: unknown };
      }) => Array<{ json: Record<string, unknown> }>;
      const out03 = runUnpack03({ first: () => ({ json: rawPdfMatchJson }) })[0].json;
      assert.equal(out03.payment_recommendation, "HOLD_AND_ISSUE_DEBIT_MEMO");
      assert.equal(out03.verified_payable_amount_usd, 2386.2);
      assert.equal(out03.total_overcharge_recovered_usd, 450.8);
      assert.ok(String(out03.quickbooks_bill_csv).startsWith("BillNo,Supplier,"));
      assert.ok(String(out03.xero_bill_csv).startsWith("*ContactName,*InvoiceNumber,"));

      const if03 = wf03.nodes.find((n) => n.type === "n8n-nodes-base.if");
      assert.ok(if03);
      assert.equal((if03.parameters.conditions as { combinator?: string }).combinator, "and");
      const slackNodes03 = wf03.nodes.filter((n) => n.type === "n8n-nodes-base.slack");
      assert.equal(slackNodes03.length, 2);
      for (const sn of slackNodes03) {
        assert.equal(sn.parameters.select, "channel");
        assert.equal((sn.parameters.channelId as { __rl?: boolean }).__rl, true);
      }
    } finally {
      proc.kill("SIGTERM");
    }
  });
});

describe("Open-Core Entitlements & 25-SKU Urgency-Sorted Soft-Gate", () => {
  it("verifies Ed25519 offline tokens and rejects tampered or expired keys", async () => {
    clearEntitlementCache();
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const pubSpkiB64 = (publicKey.export({ type: "spki", format: "der" }) as Buffer).toString("base64");
    const privPkcs8Pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;

    const validToken = mintEd25519LicenseToken(
      { sub: "merchant@austinhome.com", tier: "pro", exp: Math.floor(Date.now() / 1000) + 3600 },
      privPkcs8Pem
    );

    const granted = await resolveEntitlement({ licenseKey: validToken, publicKeySpkiB64: pubSpkiB64 });
    assert.equal(granted.unlocked, true);
    assert.equal(granted.tier, "pro");

    const parts = validToken.split(".");
    const tampered = `POP1.${Buffer.from(JSON.stringify({ sub: "hacker", tier: "agency" })).toString("base64url")}.${parts[2]}`;
    const rejected = await resolveEntitlement({ licenseKey: tampered, publicKeySpkiB64: pubSpkiB64 });
    assert.equal(rejected.unlocked, false);

    const expiredToken = mintEd25519LicenseToken(
      { sub: "old@store.com", tier: "pro", exp: Math.floor(Date.now() / 1000) - 60 },
      privPkcs8Pem
    );
    const expiredRes = await resolveEntitlement({ licenseKey: expiredToken, publicKeySpkiB64: pubSpkiB64 });
    assert.equal(expiredRes.unlocked, false);
  });

  it("validates Polar.sh keys and does NOT cache transient Polar 5xx / network errors", async () => {
    clearEntitlementCache();
    const orgId = "fda84e25-7b55-4d67-916d-60ead04ff61f";
    let shouldFail503 = true;

    const mockPolar = createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body) as { key: string; organization_id: string };
      if (shouldFail503) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Service Unavailable" }));
        return;
      }
      if (req.url === "/v1/customer-portal/license-keys/validate" && parsed.organization_id === orgId && parsed.key === "POLAR-LIVE-VALID") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "granted", benefit_id: "ben_123" }));
        return;
      }
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "revoked" }));
    });

    await new Promise<void>((resolve) => mockPolar.listen(0, "127.0.0.1", () => resolve()));
    const addr = mockPolar.address() as { port: number };
    const apiBaseUrl = `http://127.0.0.1:${addr.port}`;

    try {
      // First attempt hits transient 503 -> locked, but MUST NOT poison cache for 1 hour!
      const transientRes = await resolveEntitlement({
        licenseKey: `${orgId}:POLAR-LIVE-VALID`,
        polarApiBaseUrl: apiBaseUrl
      });
      assert.equal(transientRes.unlocked, false);

      // Immediate retry after Polar recovers -> MUST succeed immediately!
      shouldFail503 = false;
      const recoveredRes = await resolveEntitlement({
        licenseKey: `${orgId}:POLAR-LIVE-VALID`,
        polarApiBaseUrl: apiBaseUrl
      });
      assert.equal(recoveredRes.unlocked, true);

      const badRes = await resolveEntitlement({
        licenseKey: `${orgId}:POLAR-INVALID`,
        polarApiBaseUrl: apiBaseUrl
      });
      assert.equal(badRes.unlocked, false);
    } finally {
      mockPolar.close();
    }
  });

  it("prioritizes urgent out-of-stock SKUs when truncating >25 SKUs on Free Sandbox, and unlocks all SKUs when licensed", async () => {
    assert.equal(FREE_LOCAL_MAX_SKUS, 25);
    assert.equal(FREE_LOCAL_MAX_INVOICE_LINES, 15);

    // 29 overstocked healthy SKUs first, and 1 critically out-of-stock SKU at index #29 (row 30)!
    const thirtySkus = Array.from({ length: 30 }, (_, idx) =>
      idx < 29
        ? {
            ...DEMO_SKU_SIGNALS[5], // healthy/overstock SKU (410 on hand)
            sku: `HEALTHY-SKU-${String(idx + 1).padStart(3, "0")}`
          }
        : {
            ...DEMO_SKU_SIGNALS[0],
            sku: "URGENT-ROW-30",
            on_hand: 0,
            committed: 5,
            units_sold_window: 300
          }
    );

    const unlicensedTransport = new StdioClientTransport({
      command: "node",
      args: ["dist/index.js"],
      env: { PATH: process.env.PATH ?? "" }
    });
    const unlicensedClient = new Client({ name: "unlicensed-test", version: "1.0.0" });

    try {
      await unlicensedClient.connect(unlicensedTransport);

      const repRes = await unlicensedClient.callTool({
        name: "calculate_replenishment_plan",
        arguments: { skus: thirtySkus }
      });
      assert.ok(!repRes.isError);
      const repJson = JSON.parse((repRes.content as Array<{ type: string; text: string }>)[0].text);
      assert.equal(repJson.ok, true);
      assert.equal(repJson.total_skus_analyzed, 25);
      assert.equal(repJson.truncated_by_free_tier, true);
      assert.equal(repJson.skus_omitted, 5);
      // Urgent SKU at row #30 MUST be included in the 25 analyzed SKUs!
      assert.ok(repJson.items.some((i: { sku: string }) => i.sku === "URGENT-ROW-30"));

      // Pass-5 #3: 15 unique SKUs where SKU-15 is split across 2 pallet rows (16 raw rows) MUST NOT chop SKU-15 in half on Free Sandbox!
      const splitFifteenPo = Array.from({ length: 15 }, (_, i) => ({
        sku: `SPLIT-SKU-${i + 1}`,
        ordered_qty: 100,
        unit_cost_usd: 10
      }));
      const splitFifteenRec = Array.from({ length: 15 }, (_, i) => ({
        sku: `SPLIT-SKU-${i + 1}`,
        received_good_qty: 100,
        damaged_qty: 0
      }));
      const splitFifteenInv = [
        ...Array.from({ length: 14 }, (_, i) => ({
          sku: `SPLIT-SKU-${i + 1}`,
          billed_qty: 100,
          billed_unit_cost_usd: 10
        })),
        { sku: "SPLIT-SKU-15", billed_qty: 50, billed_unit_cost_usd: 10 },
        { sku: "split-sku-15", billed_qty: 50, billed_unit_cost_usd: 10 }
      ];
      const splitMatchRes = await unlicensedClient.callTool({
        name: "reconcile_po_three_way_match",
        arguments: {
          po_number: "PO-SPLIT-15",
          vendor: "Pallet Vendor",
          po_lines: splitFifteenPo,
          receiving_lines: splitFifteenRec,
          invoice_lines: splitFifteenInv
        }
      });
      const splitMatchJson = JSON.parse((splitMatchRes.content as Array<{ type: string; text: string }>)[0].text);
      assert.equal(Boolean(splitMatchJson.truncated_by_free_tier), false);
      assert.equal(splitMatchJson.total_po_amount_usd, 15000);
      assert.equal(splitMatchJson.total_invoice_billed_usd, 15000);
      assert.equal(splitMatchJson.verified_payable_amount_usd, 15000);
      assert.equal(splitMatchJson.payment_recommendation, "APPROVE_IN_FULL");
    } finally {
      await unlicensedClient.close();
    }

    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const pubSpkiB64 = (publicKey.export({ type: "spki", format: "der" }) as Buffer).toString("base64");
    const privPkcs8Pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    const proToken = mintEd25519LicenseToken({ sub: "pro@store.com", tier: "pro" }, privPkcs8Pem);

    const licensedTransport = new StdioClientTransport({
      command: "node",
      args: ["dist/index.js"],
      env: {
        PATH: process.env.PATH ?? "",
        PO_PILOT_PUBLIC_KEY_SPKI_B64: pubSpkiB64,
        PO_PILOT_LICENSE_KEY: proToken
      }
    });
    const licensedClient = new Client({ name: "licensed-test", version: "1.0.0" });

    try {
      await licensedClient.connect(licensedTransport);
      const fullRes = await licensedClient.callTool({
        name: "calculate_replenishment_plan",
        arguments: { skus: thirtySkus }
      });
      assert.ok(!fullRes.isError);
      const fullJson = JSON.parse((fullRes.content as Array<{ type: string; text: string }>)[0].text);
      assert.equal(fullJson.total_skus_analyzed, 30);
      assert.equal(Boolean(fullJson.truncated_by_free_tier), false);
    } finally {
      await licensedClient.close();
    }
  });

  it("executes scripts/mint-license.mjs CLI keypair generation, signing, and invalid tier rejection", async () => {
    const keypairOut = execFileSync("node", ["scripts/mint-license.mjs", "--generate-keypair"], { encoding: "utf8" });
    const lines = keypairOut.split("\n").map((l) => l.trim()).filter(Boolean);
    const pubB64 = lines[2];
    const privB64 = lines[4];
    assert.ok(pubB64.length > 20 && privB64.length > 20);

    const signedToken = execFileSync(
      "node",
      ["scripts/mint-license.mjs", "--sign", "--email", "buyer@brand.com", "--tier", "agency", "--days", "365"],
      {
        encoding: "utf8",
        env: { ...process.env, PO_PILOT_SIGNING_PRIVATE_KEY_B64: privB64 }
      }
    ).trim();
    assert.ok(signedToken.startsWith("POP1."));

    clearEntitlementCache();
    const verified = await resolveEntitlement({ licenseKey: signedToken, publicKeySpkiB64: pubB64 });
    assert.equal(verified.unlocked, true);
    assert.equal(verified.tier, "agency");

    // Reject invalid --tier typos with non-zero exit code
    assert.throws(() => {
      execFileSync(
        "node",
        ["scripts/mint-license.mjs", "--sign", "--tier", "typo-tier"],
        {
          encoding: "utf8",
          stdio: "pipe",
          env: { ...process.env, PO_PILOT_SIGNING_PRIVATE_KEY_B64: privB64 }
        }
      );
    });

    // Reject expired ISO-date string `exp` tokens so legacy/manual string dates can NEVER bypass expiration
    const isoExpiredPayload = Buffer.from(
      JSON.stringify({ sub: "expired@brand.com", tier: "pro", exp: "2020-01-01" }),
      "utf8"
    ).toString("base64url");
    const privObj = createPrivateKey({ key: Buffer.from(privB64, "base64"), format: "der", type: "pkcs8" });
    const isoSig = sign(null, Buffer.from(isoExpiredPayload, "utf8"), privObj).toString("base64url");
    clearEntitlementCache();
    const expiredIsoCheck = await resolveEntitlement({
      licenseKey: `POP1.${isoExpiredPayload}.${isoSig}`,
      publicKeySpkiB64: pubB64
    });
    assert.equal(expiredIsoCheck.unlocked, false);
    assert.equal(expiredIsoCheck.reason, "license_expired");

    // Verify docker-compose.yml has valid official n8n registry host, pinned version (no :latest), and env access enabled for n8n 2.x
    const composeText = readFileSync("docker-compose.yml", "utf8");
    assert.ok(!composeText.includes("docker.n8nio.io"), "Must not contain typo domain docker.n8nio.io");
    assert.ok(!composeText.includes(":latest"), "Must pin container image tag instead of mutable :latest");
    assert.ok(composeText.includes("docker.n8n.io/n8nio/n8n:"));
    assert.ok(composeText.includes("N8N_BLOCK_ENV_ACCESS_IN_NODE=false"));
  });
});

describe("Pass-6 Deep Audit Regressions (Shopify CSV Handle Inheritance, Multi-Location Velocity, AP Accounting & HTTP Hardening)", () => {
  it("inherits Handle vendor/title/status across multi-variant Shopify products_export.csv rows and skips archived/draft products", () => {
    const shopifyProductsExport = [
      "Handle,Title,Vendor,Status,Option1 Name,Option1 Value,Variant SKU,Variant Barcode,Variant Inventory Qty,Variant Price,Cost per item",
      "camp-mug,Double-Wall Camp Mug,Pacific Stainless Works,active,Color,Matte Black,HO-MUG-BLK,85001,10,28.00,6.40",
      "camp-mug,,,,Color,Olive Drab,HO-MUG-OLV,85002,5,28.00,6.40",
      "old-hat,Retired 2023 Hat,Old Vendor,archived,Title,Default Title,OLD-HAT-01,,0,20.00,5.00",
      "old-hat,,,,Color,Navy,OLD-HAT-02,,0,20.00,5.00",
      "draft-shirt,Unreleased Tee,Draft Vendor,draft,Size,Large,DRAFT-TEE-L,,25,32.00,8.00"
    ].join("\n");

    const parsed = mapInventoryCsvToSignals(shopifyProductsExport, 30);
    assert.equal(parsed.length, 2, "Must exclude archived and draft parent/child rows");
    assert.equal(parsed[0].sku, "HO-MUG-BLK");
    assert.equal(parsed[0].vendor, "Pacific Stainless Works");
    assert.equal(parsed[0].title, "Double-Wall Camp Mug - Matte Black");
    assert.equal(parsed[1].sku, "HO-MUG-OLV");
    assert.equal(parsed[1].vendor, "Pacific Stainless Works");
    assert.equal(parsed[1].title, "Double-Wall Camp Mug - Olive Drab");
  });

  it("prevents 457% velocity inflation when merging multi-location SKUs with asymmetric stockout days and avoids single-PO GCD pack traps", () => {
    const multiLocPlan = computeReplenishmentPlan([
      {
        sku: "MULTI-LOC-MUG",
        title: "Camp Mug",
        vendor: "Pacific Stainless",
        on_hand: 200,
        committed: 0,
        on_order: 0,
        backorders: 0,
        units_sold_window: 150, // 5.0/day at main warehouse (0 stockout days)
        window_days: 30,
        stockout_days: 0,
        unit_cost_usd: 6.4,
        retail_price_usd: 28,
        lead_time_days: 14,
        lead_time_std_dev_days: 2,
        case_pack: 12,
        sku_moq: 12
      },
      {
        sku: "MULTI-LOC-MUG",
        title: "Camp Mug",
        vendor: "Pacific Stainless",
        on_hand: 0,
        committed: 0,
        on_order: 0,
        backorders: 0,
        units_sold_window: 10, // 2.0/day for 5 active days at popup location (25 stockout days)
        window_days: 30,
        stockout_days: 25,
        unit_cost_usd: 6.4,
        retail_price_usd: 28,
        lead_time_days: 14,
        lead_time_std_dev_days: 2,
        case_pack: 12,
        sku_moq: 12
      }
    ]);
    assert.equal(multiLocPlan.items.length, 1);
    assert.equal(multiLocPlan.items[0].adjusted_daily_velocity, 7);

    // Single-PO SKU in Stocky CSV must NOT infer a prime/launch quantity (37) as carton case_pack
    const singlePoStocky = migrateStockyPoCsv(
      [
        "PO Number,Supplier,SKU,Ordered Qty,Cost Price,Created At,Received At",
        "PO-1,Acme Corp,SKU-PRIME,37,5.00,08/02/2026,08/17/2026"
      ].join("\n")
    );
    assert.equal(singlePoStocky.profiles[0].skus[0].inferred_case_pack, 1);
  });

  it("blocks freight payment on 100%-damaged shipments and guarantees exact penny parity on half-cent wholesale unit prices", () => {
    const shattered = runThreeWayMatch({
      po_number: "PO-SHATTERED",
      vendor: "Glassware Co",
      po_lines: [{ sku: "GLASS-1", ordered_qty: 100, unit_cost_usd: 10 }],
      receiving_lines: [{ sku: "GLASS-1", received_good_qty: 0, damaged_qty: 100 }],
      invoice_lines: [{ sku: "GLASS-1", billed_qty: 100, billed_unit_cost_usd: 10 }],
      invoice_extra_fees_usd: 100
    });
    assert.equal(shattered.payment_recommendation, "HOLD_AND_ISSUE_DEBIT_MEMO");
    assert.equal(shattered.verified_payable_amount_usd, 0);
    assert.equal(shattered.verified_bill_lines.length, 0);
    assert.equal(shattered.total_overcharge_recovered_usd, 1100);
    const shatteredBulletSum = Number(shattered.discrepancies.reduce((s, d) => s + d.overcharge_usd, 0).toFixed(2));
    assert.equal(shatteredBulletSum, shattered.total_overcharge_recovered_usd);

    const halfCent = runThreeWayMatch({
      po_number: "PO-HALFCENT",
      vendor: "Fastener Corp",
      po_lines: [{ sku: "BOLT-M8", ordered_qty: 10, unit_cost_usd: 1.005 }],
      receiving_lines: [{ sku: "BOLT-M8", received_good_qty: 7, damaged_qty: 3 }],
      invoice_lines: [{ sku: "BOLT-M8", billed_qty: 10, billed_unit_cost_usd: 1.005 }]
    });
    const halfCentBulletSum = Number(halfCent.discrepancies.reduce((s, d) => s + d.overcharge_usd, 0).toFixed(2));
    assert.equal(halfCentBulletSum, halfCent.total_overcharge_recovered_usd);
  });

  it("uses currentQuantity and partially_refunded orders in Shopify GraphQL, strips Docker .env quotes, parses tabular PDF freight, and enforces HTTP 413 cleanly", async () => {
    // 1. Docker .env quote stripping on license keys & Shopify config
    clearEntitlementCache();
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const pubSpkiB64 = (publicKey.export({ type: "spki", format: "der" }) as Buffer).toString("base64");
    const privPem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    const token = mintEd25519LicenseToken({ sub: "docker@store.com", tier: "pro" }, privPem);
    const quotedLicenseRes = await resolveEntitlement({
      licenseKey: `"${token}"`,
      publicKeySpkiB64: `"${pubSpkiB64}"`
    });
    assert.equal(quotedLicenseRes.unlocked, true);

    const prevDomain = process.env.SHOPIFY_STORE_DOMAIN;
    const prevToken = process.env.SHOPIFY_ACCESS_TOKEN;
    try {
      process.env.SHOPIFY_STORE_DOMAIN = '"harbor-oak.myshopify.com"';
      process.env.SHOPIFY_ACCESS_TOKEN = "'shpat_docker_quoted'";
      const cfg = resolveShopifyConfig();
      assert.ok(cfg);
      assert.equal(cfg.storeDomain, "harbor-oak.myshopify.com");
      assert.equal(cfg.accessToken, "shpat_docker_quoted");
    } finally {
      if (prevDomain === undefined) delete process.env.SHOPIFY_STORE_DOMAIN;
      else process.env.SHOPIFY_STORE_DOMAIN = prevDomain;
      if (prevToken === undefined) delete process.env.SHOPIFY_ACCESS_TOKEN;
      else process.env.SHOPIFY_ACCESS_TOKEN = prevToken;
    }

    // 2. Live Shopify GraphQL partially_refunded query + currentQuantity net sales subtraction
    let observedOrdersQuery = "";
    const mockShopify = createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw) as { query: string; variables: Record<string, string | null> };
      res.writeHead(200, { "Content-Type": "application/json" });
      if (body.query.includes("productVariants")) {
        res.end(
          JSON.stringify({
            data: {
              productVariants: {
                pageInfo: { hasNextPage: false, endCursor: null },
                nodes: [
                  {
                    sku: "NET-SKU-1",
                    title: "Default Title",
                    price: "40.00",
                    inventoryQuantity: 10,
                    product: { title: "Canvas Hat", vendor: "Hat Co", status: "ACTIVE" },
                    inventoryItem: { unitCost: { amount: "12.00" } }
                  }
                ]
              }
            }
          })
        );
        return;
      }
      observedOrdersQuery = String(body.variables.ordersQuery ?? "");
      res.end(
        JSON.stringify({
          data: {
            orders: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [
                {
                  // Ordered 10, refunded 3 -> currentQuantity is 7!
                  lineItems: { nodes: [{ sku: "NET-SKU-1", quantity: 10, currentQuantity: 7 }] }
                }
              ]
            }
          }
        })
      );
    });
    await new Promise<void>((resolve) => mockShopify.listen(0, "127.0.0.1", () => resolve()));
    const shopifyPort = (mockShopify.address() as { port: number }).port;
    try {
      const signals = await fetchLiveShopifySignals(
        {
          storeDomain: "test.myshopify.com",
          accessToken: "shpat_test",
          baseUrlOverride: `http://127.0.0.1:${shopifyPort}`
        },
        30
      );
      assert.ok(observedOrdersQuery.includes("partially_refunded"));
      assert.equal(signals[0].units_sold_window, 7);
    } finally {
      mockShopify.close();
    }

    // 3. n8n Template #03 tabular freight row ("Shipping & Handling   1   $240.00") + shipping method header ignore + ISO dates
    const wf03 = JSON.parse(
      readFileSync("sales-bundle/n8n-templates/03-email-pdf-invoice-auto-3way-match.json", "utf8")
    ) as { nodes: Array<{ name: string; parameters: { jsCode?: string } }> };
    const runPdf = new Function("$input", wf03.nodes.find((n) => n.name === "Parse PDF Invoice Text")!.parameters.jsCode!) as (inp: {
      first: () => { json: Record<string, unknown> };
    }) => Array<{ json: Record<string, unknown> }>;

    const tabularPdf = runPdf({
      first: () => ({
        json: {
          text: [
            "INVOICE #: INV-7788",
            "Invoice Date: 2026-10-01",
            "Due Date: 2026-10-31",
            "Shipping Method: Route 66 Freight",
            "PO #: PO-2026-1042",
            "Vendor: Pacific Stainless Works",
            "HO-MUG-12OZ-BLK  Camp Mug  240  $6.85  $1,644.00",
            "Subtotal   1   $1,644.00",
            "Shipping & Handling   1   $240.00"
          ].join("\n"),
          po_lines: [{ sku: "HO-MUG-12OZ-BLK", ordered_qty: 240, unit_cost_usd: 6.4 }]
        }
      })
    })[0].json;
    assert.equal(tabularPdf.invoice_extra_fees_usd, 240);
    assert.equal(tabularPdf.invoice_date, "2026-10-01");
    assert.equal(tabularPdf.due_date, "2026-10-31");

    // 4. HTTP --port CLI flag + 413 Payload Too Large clean response & server liveness
    const { spawn } = await import("node:child_process");
    const httpPort = 18977;
    const proc = spawn("node", ["dist/index.js", "--http", "--port", String(httpPort)], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("HTTP --port startup timeout")), 4000);
        proc.stderr.on("data", (chunk: Buffer) => {
          if (chunk.toString().includes(String(httpPort))) {
            clearTimeout(timer);
            resolve();
          }
        });
      });

      const oversizedBody = "x".repeat(10 * 1024 * 1024 + 1024);
      const res413 = await fetch(`http://127.0.0.1:${httpPort}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: oversizedBody
      });
      assert.equal(res413.status, 413);

      const healthAfter413 = await fetch(`http://127.0.0.1:${httpPort}/health`);
      assert.equal(healthAfter413.status, 200);
    } finally {
      proc.kill("SIGTERM");
    }
  });
});

