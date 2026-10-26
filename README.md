# PO Pilot MCP (`po-pilot-mcp`)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js >= 20](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](package.json)
[![MCP SDK 1.32.2](https://img.shields.io/badge/MCP_SDK-1.32.2-purple.svg)](package.json)
[![Zero Required Secrets](https://img.shields.io/badge/Cold_Start-Zero_Keys_Required-success.svg)](mcpize.yaml)

**Post-Stocky replenishment math, vendor MOQ Purchase Orders, Stocky CSV supplier recovery, and Accounts Payable 3-way invoice matching for Shopify merchants and US wholesalers.**

Shopify retired **Stocky** on August 31, 2026. Native Shopify Admin stores inventory counts and draft PO records, yet drops the purchasing logic merchants relied on: reorder point calculation, carton/case-pack rounding, vendor minimum order thresholds, supplier export, and invoice discrepancy checks. Meanwhile, Shopify's official Storefront and UCP MCP endpoints (`catalog`, `cart`, `checkout`, `policies`) serve front-office shoppers only.

`po-pilot-mcp` connects Claude Desktop, Claude Code, Cursor, or n8n to four deterministic back-office purchasing tools. Every tool runs locally or over Streamable HTTP with **zero required credentials** in `demo_mode` or CSV mode, and optionally connects to live **Shopify Admin GraphQL (`2026-04`)** when read-only store credentials are supplied.

---

## Setup in Under 60 Seconds

### Option A: Zero-Key Quickstart (Claude Desktop / Cursor)

Add this block to `claude_desktop_config.json` or `.cursor/mcp.json` (exact version pin recommended for reproducible deployments):

```json
{
  "mcpServers": {
    "po-pilot": {
      "command": "npx",
      "args": ["-y", "po-pilot-mcp@1.0.0"]
    }
  }
}
```

### Option B: Claude Code CLI (One Command)

```bash
claude mcp add po-pilot -- npx -y po-pilot-mcp@1.0.0
```

### Option C: Live Shopify Store Mode (Optional Read-Only Admin Token)

Create a custom app in **Shopify Admin -> Settings -> Apps and sales channels -> Develop apps** with three read-only scopes: `read_products`, `read_inventory`, and `read_orders`.

```json
{
  "mcpServers": {
    "po-pilot": {
      "command": "npx",
      "args": ["-y", "po-pilot-mcp@1.0.0"],
      "env": {
        "SHOPIFY_STORE_DOMAIN": "your-store.myshopify.com",
        "SHOPIFY_ACCESS_TOKEN": "shpat_your_read_only_token"
      }
    }
  }
}
```

### Option D: Remote Streamable HTTP (n8n / Cloud Gateways / MCPize)

```bash
npx -y po-pilot-mcp@1.0.0 --http
# Listening on http://0.0.0.0:8080/mcp (Health check: GET /health)
```

---

## 3 Copy-Paste Prompts (Test Immediately)

### Prompt 1: Monday Morning Vendor PO Run (Zero API Keys Needed)
```text
Use po-pilot to run `build_supplier_purchase_orders` with `demo_mode: true` and `service_level: "95%"`. Show me:
1. Which SKUs are at CRITICAL stockout risk after adjusting for past stockout days,
2. Which suppliers required an automatic carton top-up on A-class SKUs to hit their minimum dollar order,
3. The exact CSV block I can import into Shopify Admin -> Purchase Orders, and
4. The ready-to-send PO emails for each vendor.
```

### Prompt 2: Rescue Un-Exportable Supplier Data from Stocky CSV
```text
Shopify Stocky never exported our supplier directory before shutting down. Run `migrate_stocky_csv_snapshot` with `demo_mode: true` (or use the Stocky Purchase Orders CSV I paste below) to reconstruct each vendor's real observed lead time in days, inferred carton pack sizes, latest unit costs, and a ready `supplier_rules` JSON configuration.
```

### Prompt 3: Finance Ops 3-Way Match Audit (PO vs Receiving vs Vendor Invoice)
```text
Run `reconcile_po_three_way_match` with `demo_mode: true`. Cross-check our original Purchase Order against warehouse dock receiving counts and the supplier's billed invoice. List every unit-price overcharge, short-shipment billed in full, unapproved surcharge, and freight cap overage, then give me the verified USD amount to pay plus the Debit Memo email to send their AR team.
```

---

## Tool Reference (4 Workflow Tools)

| Tool Name | Purpose | Inputs | Key Outputs | Annotations |
| --- | --- | --- | --- | --- |
| `calculate_replenishment_plan` | Margin-weighted ABC classification, stockout-adjusted daily velocity, Z-score safety stock, and reorder points | `skus[]`, `inventory_csv`, `use_live_shopify`, `demo_mode`, `service_level`, `review_period_days` | Per-SKU `abc_class`, `inventory_position`, `safety_stock_units`, `reorder_point_units`, `recommended_order_units`, `stockout_risk` | `readOnlyHint: true`, `idempotentHint: true` |
| `build_supplier_purchase_orders` | Groups SKUs per vendor, rounds up to carton multiples, enforces vendor unit/USD minimums via A-SKU top-ups, and formats Shopify Draft PO CSVs | Same as above + `supplier_rules[]`, `po_prefix` | Per-vendor `shopify_draft_po_csv`, `vendor_email_markdown`, `subtotal_usd`, `moq_top_up_applied` | `readOnlyHint: true`, `idempotentHint: true` |
| `reconcile_po_three_way_match` | Accounts Payable 3-way match comparing PO vs warehouse receiving vs supplier invoice | `po_number`, `vendor`, `po_lines[]`, `receiving_lines[]`, `invoice_lines[]`, `agreed_freight_cap_usd`, `demo_mode` | `payment_recommendation`, `verified_payable_amount_usd`, `total_overcharge_recovered_usd`, `discrepancies[]`, `debit_memo_email_markdown` | `readOnlyHint: true`, `idempotentHint: true` |
| `migrate_stocky_csv_snapshot` | Rebuilds supplier profiles, real lead-time averages/std-dev, and carton multiples from Stocky PO CSV exports | `stocky_po_csv`, `demo_mode` | `profiles[]`, `ready_supplier_rules_json[]`, `suppliers_recovered`, `skus_recovered` | `readOnlyHint: true`, `idempotentHint: true` |

---

## Deterministic Math Under the Hood

1. **Inventory Position** (prevents double-ordering while stock is in transit):
   $$\text{IP} = \text{OnHand} + \text{OnOrder} - \text{Committed} - \text{Backorders}$$
2. **Stockout-Adjusted Daily Velocity** (prevents artificially depressed velocity when a bestseller was out of stock for part of the month):
   $$d = \frac{\text{UnitsSold}}{\max(1,\; \text{WindowDays} - \text{StockoutDays})}$$
3. **Demand + Lead-Time Variability Safety Stock**:
   $$\text{SS} = \left\lceil Z \cdot \sqrt{\text{LT} \cdot \sigma_d^2 + d^2 \cdot \sigma_{\text{LT}}^2} \right\rceil$$
   where $Z \in \{1.04, 1.28, 1.65, 1.96, 2.33\}$ for $85\%, 90\%, 95\%, 97.5\%, 99\%$ cycle service levels.
4. **Periodic Review Order Quantity & Carton Rounding**:
   $$\text{ROP} = \lceil d \cdot \text{LT} + \text{SS} \rceil, \quad S = \lceil d \cdot (\text{LT} + R) + \text{SS} \rceil$$
   When $\text{IP} \le \text{ROP}$, raw order need $Q_0 = \max(\text{SKU\_MOQ}, S - \text{IP})$ is rounded to carton multiples $\lceil Q_0 / \text{CasePack} \rceil \times \text{CasePack}$. If a vendor PO falls short of `min_order_value_usd` (such as a $2,200 wholesale minimum or free-freight tier), the engine adds carton increments to the highest-velocity A-class SKU rather than padding slow C-items.

---

## Security, Privacy & Reliability Guarantees

- **Zero Credential Persistence**: Tokens passed via `SHOPIFY_ACCESS_TOKEN` remain in memory for the request lifetime only and are never logged, written to disk, or echoed in error payloads.
- **Read-Only Store Access**: Live Shopify GraphQL integration issues `POST` queries solely for read operations (`productVariants` and `orders`) and enforces a strict 15-second `AbortSignal` timeout.
- **Crash-Proof Error Envelopes**: Invalid CSV headers, missing parameters, or network timeouts return structured MCP `isError: true` responses with remediation steps instead of terminating the stdio process.
- **Zero Known Dependency Advisories**: Verified clean under `npm audit`.

---

## Pricing & Entitlements (`mcpize.yaml`)

- **Local Free Sandbox (`npx -y po-pilot-mcp`)**: `$0` — unlimited Stocky CSV supplier recovery (`migrate_stocky_csv_snapshot`), full `demo_mode`, and up to **25 SKUs / 15 invoice lines per call** via CSV or JSON.
- **Self-Hosted Lifetime Kit ($49 one-time on Polar.sh / Gumroad)**: Unlocks **Unlimited SKUs**, **Live Shopify Admin GraphQL**, and includes **2 ready-to-import n8n workflows** (Monday Morning Slack/Email PO Generator + Supplier Invoice 3-Way Match Guard) via `PO_PILOT_LICENSE_KEY`.
- **MCPize Managed Cloud**:
  - **Free Sandbox**: `$0/month` — **15 requests/month** (instant zero-setup evaluation).
  - **Pro Store**: `$19/month` — **300 requests/month** (unlimited SKUs + Live Shopify sync for weekly store purchasing & AP invoice audits).
  - **Agency / Multi-Store**: `$59/month` — **2,500 requests/month** (for multi-brand operators, aggregators, and daily automated n8n monitors).

### Maintainer Publish & Deploy Commands

```bash
# 1. Verify build, 11 automated tests, and zero security advisories
npm test && npm audit

# 2. Publish to npm
npm login
npm publish --access public

# 3. Deploy & activate Free/Pro tiers on MCPize
npx mcpize login
npx mcpize deploy
```

See [`docs/LOOM-SCRIPT.md`](docs/LOOM-SCRIPT.md) for the 3-minute product walkthrough script and [`docs/RESEARCH-REPORT.md`](docs/RESEARCH-REPORT.md) for the market audit behind this build.

## License

MIT License — see [LICENSE](LICENSE).
