# Gumroad $49 Bundle — Copy & Packaging Guide (`po-pilot-mcp`)

*Crafted with `marketing-campaign`, `avoid-ai-writing`, and `finance-billing-ops` skills.*

---

## 1. Positioning Brief (`marketing-campaign` Phase 2)

- **Core Benefit Statement**: Turn Shopify SKU sales and Stocky CSV exports into carton-rounded supplier Purchase Orders and 3-way matched vendor invoices in 60 seconds without paying $150–$250/month for an inventory SaaS.
- **Positioning Formula**: **PO Pilot Automation Kit** helps **US Shopify merchants and wholesale buyers** **replace Stocky's retired purchasing workflow and catch supplier billing errors** by **combining a deterministic TypeScript MCP server with two ready-to-import n8n Slack/AP workflows**.
- **Campaign Angle**: Stocky shut down on August 31, 2026, and its 90-day read-only CSV export window closes at the end of November 2026. Native Shopify Admin keeps inventory counts, yet leaves merchants doing carton rounding, MOQ math, and vendor invoice checks by hand in spreadsheets.
- **Price**: **$49 USD (One-Time Purchase)** — zero recurring Gumroad platform subscription cost (Gumroad charges 10% + $0.50 only when a sale happens).

---

## 2. Gumroad Product Page Copy (Copy-Paste Ready)

### Product Name
**Post-Stocky Shopify Purchase Order & 3-Way Invoice Match Kit (MCP Server + 2 n8n Workflows)**

### URL Slug
`po-pilot-shopify-kit`

### Summary (Above the Fold)
Shopify turned Stocky off on August 31, 2026. Replace your broken Monday morning reorder spreadsheets with a local-first TypeScript MCP server + 2 pre-built n8n workflows that recover your Stocky supplier rules, generate MOQ-compliant Shopify Draft PO CSVs, and block overbilled vendor invoices before you pay them.

### Body Copy

#### What broke when Stocky shut down
Shopify Admin handles inventory counts and basic draft PO storage. It dropped the four parts of purchasing that actually save money:
1. **Supplier directory export**: Stocky never exported vendor lead times, MOQs, or carton multiples.
2. **Stockout-adjusted reorder math**: Dividing 30-day sales by 30 when your bestseller was out of stock for 6 days causes chronic under-ordering.
3. **Carton & MOQ rounding**: Suppliers ship in cases of 12 or 24 and enforce $1,500–$2,500 minimum orders for wholesale pricing or free freight.
4. **3-way invoice matching**: Catching a $0.45/unit silent price increase or 12 damaged units billed in full before Accounts Payable wires funds.

Legacy inventory suites charge **$99 to $249/month** ($1,200–$3,000/year) to get those workflows back. This kit gives your team the complete source code and automation templates for **$49 once**.

#### What's Inside the $49 ZIP Bundle

1. **Full TypeScript Source Code (`po-pilot-mcp` v1.0.0 — MIT Commercial Use)**
   - 4 deterministic MCP tools (`calculate_replenishment_plan`, `build_supplier_purchase_orders`, `reconcile_po_three_way_match`, `migrate_stocky_csv_snapshot`).
   - Runs locally in Claude Desktop, Claude Code, or Cursor via `stdio`, OR self-hosted on Cloudflare/Docker/Railway via Streamable HTTP (`--http`).
   - Optional read-only Shopify Admin GraphQL (`2026-04`) connector + CSV paste mode + zero-key demo fixture.
2. **n8n Workflow #1: `01-monday-shopify-po-generator.json`**
   - Runs every Monday at 08:00 AM, pulls live SKU velocity, calculates Z-score safety stock (95% service level), tops up A-class cartons to satisfy vendor minimums, and posts ready-to-import **Shopify Draft PO CSVs** + supplier emails straight to `#purchasing-ops` in Slack.
3. **n8n Workflow #2: `02-supplier-invoice-3way-match-guard.json`**
   - Cross-checks incoming supplier invoice lines against your original PO and warehouse receiving counts. Automatically flags unit-price creep, short-ships, and freight cap overages in `#finance-ap` with a pre-written **Vendor Debit Memo**.
4. **3-Minute Setup & Walkthrough Guide + Loom Video**
   - Step-by-step instructions to rescue your Stocky PO CSV exports before Shopify's 90-day read-only window closes in late November 2026.

#### Who This Is Built For
- **Shopify & Shopify Plus stores (50–2,500 SKUs)** replacing Stocky without adding another $200/month app bill.
- **US wholesale distributors & 3PL brands** ordering in carton multiples with strict vendor dollar minimums.
- **Ecommerce finance & operations agencies** deploying repeatable purchasing automations for clients.

#### CTA Button Text
**Download the PO Pilot Kit ($49)**

---

## 3. One-Command Gumroad ZIP Builder

Run this from the repository root before uploading to Gumroad (`https://app.gumroad.com/products`):

```bash
zip -r po-pilot-gumroad-bundle-v1.0.0.zip \
  src/ package.json tsconfig.json Dockerfile docker-compose.yml \
  mcpize.yaml smithery.yaml glama.json server.json .well-known/ \
  README.md LICENSE .env.example \
  docs/LOOM-SCRIPT.md docs/RESEARCH-REPORT.md \
  sales-bundle/n8n-templates/
```
