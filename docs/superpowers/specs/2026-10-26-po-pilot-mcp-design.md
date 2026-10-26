# Design Spec: `po-pilot-mcp` (Shopify Replenishment, MOQ Purchase Order & 3-Way Match MCP)

> **Historical Phase-2 Spec Note:** This document captures the initial MVP architecture prior to the v1.0.0 value-multiplier upgrades (Shopify POS Transfer CSV, US Tariff Landed Cost + Open-to-Buy cap, QuickBooks/Xero Verified Bill CSVs, n8n Workflow `#03`, and updated `$49` Early-Bird / `$99` Solo / `$249` Agency + `$29/$79` Cloud tiers). Refer to [`README.md`](../../../README.md) as the authoritative production specification.

- **Date**: 2026-10-26
- **Author**: Senior MCP Architect + Indie Hacker Workflow (`brainstorming` skill spec)
- **Target Market**: US Shopify merchants, omnichannel wholesalers, and e-commerce finance ops
- **Infra Cost**: $0.00 (Node.js/TypeScript stdio + optional Streamable HTTP, npm + MCPize + GitHub)

## 1. Intent & Why
Shopify retired **Stocky** on August 31, 2026, leaving merchants without native reorder-point calculation, supplier MOQ/case-pack rounding, supplier directory migration, or PO-to-invoice variance auditing. Meanwhile, Shopify's official Storefront/UCP MCP servers strictly serve shopper-facing catalog, cart, and checkout flows. `po-pilot-mcp` turns any MCP client (Claude Desktop, Claude Code, Cursor, n8n AI Agent) into an automated **Purchasing & AP Reconciliation Buyer** in under 60 seconds.

## 2. Goals, Non-Goals & Anti-Goals
- **Goals**:
  1. Ship 4 high-leverage, deterministic workflow tools (`calculate_replenishment_plan`, `build_supplier_purchase_orders`, `reconcile_po_three_way_match`, `migrate_stocky_csv_snapshot`).
  2. Support **Zero-Key Instant Evaluation** (`demo_mode: true` or pasted CSV/JSON) AND **Optional Live Shopify Admin GraphQL (`2026-04`)** via `SHOPIFY_STORE_DOMAIN` + `SHOPIFY_ACCESS_TOKEN`.
  3. Achieve Top 13% (>85/100) MCP directory quality/trust score via strict Zod input validation, MCP tool annotations (`readOnlyHint`, `idempotentHint`, `openWorldHint`), structured error envelopes (never throwing uncaught exceptions), MIT license, automated tests, and complete registry manifests (`mcpize.yaml`, `glama.json`, `smithery.yaml`, `server.json`).
- **Non-Goals**:
  - Storefront cart/checkout tools (already handled by Shopify UCP MCP).
  - Full ERP warehouse barcode hardware drivers.
- **Anti-Goals**:
  - Crashing on startup when `SHOPIFY_ACCESS_TOKEN` is absent.
  - Returning fabricated/random numbers labeled as live market data.

## 3. Architecture & File Layout
- `src/types.ts`: Shared TypeScript interfaces & Zod schemas with detailed `.describe()` metadata for LLMs.
- `src/demoData.ts`: Realistic US DTC/wholesale Shopify store fixture (8 SKUs across 3 US/overseas suppliers, Stocky PO CSV snapshot, and a realistic supplier invoice with hidden price creep & short-ship discrepancies).
- `src/shopifyClient.ts`: Optional zero-dependency (`fetch`) Shopify Admin GraphQL `2026-04` reader for pulling live variant stock, SKU costs, vendors, and 30/60/90-day order line-item velocity when credentials are configured.
- `src/csvUtils.ts`: Deterministic RFC-4180 CSV parser & Shopify Native Draft PO CSV serializer.
- `src/engines/replenishment.ts`: Stockout-adjusted daily velocity, Z-score safety stock, reorder point, days-of-cover, and ABC revenue classification (<90 lines).
- `src/engines/purchaseOrder.ts`: Vendor grouping, case-pack ceiling rounding, MOQ unit & minimum-spend USD enforcement with smart A-item top-up, Shopify Draft PO CSV builder, and vendor PO email generator (<95 lines).
- `src/engines/threeWayMatch.ts`: Deterministic 3-Way Match engine comparing PO lines vs Warehouse Receiving vs Supplier Invoice lines + automated Vendor Debit Memo / Dispute Email (<90 lines).
- `src/engines/stockyMigration.ts`: Rebuilds lost supplier profiles (observed lead-time stats, unit cost history, inferred pack multiples, SKU map) from Stocky PO CSV exports (<85 lines).
- `src/server.ts` & `src/index.ts`: `McpServer` registration (4 tools, 1 prompt, 1 resource) supporting both `stdio` (default) and Streamable HTTP (`--http` / `PORT` env for remote cloud gateways).
