import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { DEMO_SKU_SIGNALS, DEMO_STOCKY_PO_CSV, DEMO_SUPPLIER_RULES, DEMO_THREE_WAY_MATCH } from "../demoData.js";
import { generateSupplierPurchaseOrders } from "../engines/purchaseOrder.js";
import { computeReplenishmentPlan } from "../engines/replenishment.js";
import { migrateStockyPoCsv } from "../engines/stockyMigration.js";
import { runThreeWayMatch } from "../engines/threeWayMatch.js";

describe("PO Pilot Domain Engines", () => {
  it("computes stockout-adjusted velocity, ABC tiers, and carton-rounded quantities", () => {
    const plan = computeReplenishmentPlan(DEMO_SKU_SIGNALS, { serviceLevel: "95%", reviewPeriodDays: 14 });
    assert.equal(plan.total_skus_analyzed, 6);
    assert.ok(plan.critical_stockout_skus >= 2);

    const blackMug = plan.items.find((i) => i.sku === "HO-MUG-12OZ-BLK");
    assert.ok(blackMug);
    // 210 units over (30 - 5 stockout days) = 8.4/day true velocity (not 7.0!)
    assert.equal(blackMug.adjusted_daily_velocity, 8.4);
    assert.equal(blackMug.recommended_order_units % 24, 0);
    assert.equal(blackMug.abc_class, "A");

    const waxTin = plan.items.find((i) => i.sku === "HO-WAX-TIN-4OZ");
    assert.ok(waxTin);
    assert.equal(waxTin.stockout_risk, "OVERSTOCK");
    assert.equal(waxTin.recommended_order_units, 0);
  });

  it("enforces vendor USD minimum order value via A-item carton top-up and emits Shopify CSV", () => {
    const plan = computeReplenishmentPlan(DEMO_SKU_SIGNALS, { serviceLevel: "95%", reviewPeriodDays: 14 });
    const bundle = generateSupplierPurchaseOrders(plan.items, DEMO_SUPPLIER_RULES, "PO-TEST");
    assert.equal(bundle.purchase_orders.length, 2);

    const pacificPo = bundle.purchase_orders.find((p) => p.vendor === "Pacific Stainless Works");
    assert.ok(pacificPo);
    assert.ok(pacificPo.subtotal_usd >= 2200);
    assert.ok(pacificPo.shopify_draft_po_csv.startsWith("SKU,Supplier SKU,Quantity,Cost,Tax %"));

    const blueRidgePo = bundle.purchase_orders.find((p) => p.vendor === "Blue Ridge Textiles LLC");
    assert.ok(blueRidgePo);
    assert.ok(blueRidgePo.subtotal_usd >= 1200);
  });

  it("catches silent unit price creep, short-ships, unapproved fees, and freight overages in 3-way match", () => {
    const audit = runThreeWayMatch(DEMO_THREE_WAY_MATCH);
    assert.equal(audit.payment_recommendation, "HOLD_AND_ISSUE_DEBIT_MEMO");
    assert.equal(audit.discrepancies.length, 5);
    const itemizedSum = Number(audit.discrepancies.reduce((s, d) => s + d.overcharge_usd, 0).toFixed(2));
    assert.equal(itemizedSum, audit.total_overcharge_recovered_usd);
    assert.ok(audit.total_overcharge_recovered_usd > 400);
    assert.ok(audit.debit_memo_email_markdown.includes("Debit Memo"));
  });

  it("reconstructs un-exportable supplier lead times and pack multiples from Stocky PO CSV", () => {
    const migrated = migrateStockyPoCsv(DEMO_STOCKY_PO_CSV);
    assert.equal(migrated.suppliers_recovered, 2);
    assert.equal(migrated.skus_recovered, 4);
    const pacific = migrated.profiles.find((p) => p.vendor === "Pacific Stainless Works");
    assert.ok(pacific);
    assert.equal(pacific.observed_avg_lead_time_days, 22);
    const mug = pacific.skus.find((s) => s.sku === "HO-MUG-12OZ-BLK");
    assert.equal(mug?.inferred_case_pack, 48);
  });
});

describe("End-to-End MCP Stdio Protocol Contract", () => {
  it("boots cleanly with zero env vars, lists 4 tools, executes all tools, and handles errors gracefully", async () => {
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
      const names = toolsRes.tools.map((t) => t.name).sort();
      assert.deepEqual(names, [
        "build_supplier_purchase_orders",
        "calculate_replenishment_plan",
        "migrate_stocky_csv_snapshot",
        "reconcile_po_three_way_match"
      ]);

      // Call Tool 2 in demo mode
      const poCall = await client.callTool({
        name: "build_supplier_purchase_orders",
        arguments: { demo_mode: true }
      });
      assert.ok(!poCall.isError);
      const poJson = JSON.parse((poCall.content as Array<{ type: string; text: string }>)[0].text);
      assert.equal(poJson.ok, true);
      assert.equal(poJson.purchase_orders_count, 2);

      // Call Tool 3 in demo mode
      const matchCall = await client.callTool({
        name: "reconcile_po_three_way_match",
        arguments: { demo_mode: true }
      });
      assert.ok(!matchCall.isError);
      const matchJson = JSON.parse((matchCall.content as Array<{ type: string; text: string }>)[0].text);
      assert.equal(matchJson.payment_recommendation, "HOLD_AND_ISSUE_DEBIT_MEMO");

      // Graceful error test (empty call without demo_mode or credentials must NOT crash server!)
      const errCall = await client.callTool({
        name: "calculate_replenishment_plan",
        arguments: { demo_mode: false }
      });
      assert.equal(errCall.isError, true);

      // Confirm server is STILL alive after error!
      const stockyCall = await client.callTool({
        name: "migrate_stocky_csv_snapshot",
        arguments: { demo_mode: true }
      });
      assert.ok(!stockyCall.isError);
    } finally {
      await client.close();
    }
  });

  it("serves /health and /.well-known/mcp/server-card.json cleanly in --http mode", async () => {
    const { spawn } = await import("node:child_process");
    const port = 18941;
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
      const healthJson = (await healthRes.json()) as { status: string; server: string };
      assert.equal(healthJson.status, "ok");
      assert.equal(healthJson.server, "po-pilot-mcp");

      const cardRes = await fetch(`http://127.0.0.1:${port}/.well-known/mcp/server-card.json`);
      assert.equal(cardRes.status, 200);
      const cardJson = (await cardRes.json()) as { tools: string[] };
      assert.equal(cardJson.tools.length, 4);
    } finally {
      proc.kill("SIGTERM");
    }
  });
});
