import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
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

describe("Open-Core Entitlements & 25-SKU Local Soft-Gate", () => {
  it("verifies Ed25519 offline tokens and rejects tampered or expired keys", async () => {
    clearEntitlementCache();
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const pubSpkiB64 = (publicKey.export({ type: "spki", format: "der" }) as Buffer).toString("base64");
    const privPkcs8Pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;

    const validToken = mintEd25519LicenseToken(
      { sub: "merchant@austinhome.com", tier: "pro", exp: Math.floor(Date.now() / 1000) + 3600 },
      privPkcs8Pem
    );

    const granted = await resolveEntitlement({
      licenseKey: validToken,
      publicKeySpkiB64: pubSpkiB64
    });
    assert.equal(granted.unlocked, true);
    assert.equal(granted.tier, "pro");

    // Tamper payload -> must fail cryptographic verification
    const parts = validToken.split(".");
    const tampered = `POP1.${Buffer.from(JSON.stringify({ sub: "hacker", tier: "agency" })).toString("base64url")}.${parts[2]}`;
    const rejected = await resolveEntitlement({
      licenseKey: tampered,
      publicKeySpkiB64: pubSpkiB64
    });
    assert.equal(rejected.unlocked, false);

    // Expired token -> must reject
    const expiredToken = mintEd25519LicenseToken(
      { sub: "old@store.com", tier: "pro", exp: Math.floor(Date.now() / 1000) - 60 },
      privPkcs8Pem
    );
    const expiredRes = await resolveEntitlement({
      licenseKey: expiredToken,
      publicKeySpkiB64: pubSpkiB64
    });
    assert.equal(expiredRes.unlocked, false);
  });

  it("validates Polar.sh customer-portal license keys (<org_uuid>:<key>) without private keys", async () => {
    clearEntitlementCache();
    const orgId = "fda84e25-7b55-4d67-916d-60ead04ff61f";
    const mockPolar = createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body) as { key: string; organization_id: string };
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
      const okRes = await resolveEntitlement({
        licenseKey: `${orgId}:POLAR-LIVE-VALID`,
        polarApiBaseUrl: apiBaseUrl
      });
      assert.equal(okRes.unlocked, true);

      const badRes = await resolveEntitlement({
        licenseKey: `${orgId}:POLAR-INVALID`,
        polarApiBaseUrl: apiBaseUrl
      });
      assert.equal(badRes.unlocked, false);
    } finally {
      mockPolar.close();
    }
  });

  it("soft-gates >25 SKUs and Live Shopify locally when unlicensed, and unlocks full catalog with a valid license", async () => {
    assert.equal(FREE_LOCAL_MAX_SKUS, 25);
    assert.equal(FREE_LOCAL_MAX_INVOICE_LINES, 15);

    const thirtySkus = Array.from({ length: 30 }, (_, idx) => ({
      ...DEMO_SKU_SIGNALS[0],
      sku: `BULK-SKU-${String(idx + 1).padStart(3, "0")}`
    }));

    // 1. Unlicensed local MCP run: >25 SKUs is soft-gated to 25 SKUs + upgrade notice, and live Shopify is gated
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
      assert.ok(String(repJson.upgrade_notice).includes("Polar.sh"));

      const liveGateRes = await unlicensedClient.callTool({
        name: "build_supplier_purchase_orders",
        arguments: { use_live_shopify: true }
      });
      const liveGateJson = JSON.parse((liveGateRes.content as Array<{ type: string; text: string }>)[0].text);
      assert.equal(liveGateJson.upgrade_required, true);
    } finally {
      await unlicensedClient.close();
    }

    // 2. Licensed local MCP run: processes all 30 SKUs with zero truncation
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
});
