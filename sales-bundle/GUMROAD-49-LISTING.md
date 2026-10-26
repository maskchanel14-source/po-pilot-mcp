# Gumroad $49 Bundle — Copy & Packaging Guide (`po-pilot-mcp`)

*Crafted with `marketing-campaign`, `avoid-ai-writing`, and `finance-billing-ops` skills.*

---

## 1. Positioning Brief (`marketing-campaign` Phase 2)

- **Core Benefit Statement**: Turn Shopify SKU sales and Stocky CSV exports into carton-rounded supplier Purchase Orders and 3-way matched vendor invoices in 60 seconds without paying $150–$250/month for an inventory SaaS.
- **Positioning Formula**: **PO Pilot Automation Kit** helps **US Shopify merchants, 3PL brands, and wholesale finance teams** **replace Stocky's retired purchasing workflow, optimize Open-to-Buy landed costs, and block supplier invoice overcharges** by **combining a deterministic TypeScript MCP server with 3 ready-to-import n8n Slack/Email/QuickBooks/Xero workflows**.
- **Campaign Angle**: Stocky shut down on August 31, 2026, and its 90-day read-only CSV export window closes at the end of November 2026. Native Shopify Admin keeps inventory counts, yet leaves merchants doing carton rounding, US tariff landed-cost math, POS transfer receiving CSVs, and vendor invoice 3-way matching by hand in spreadsheets.
- **Tiered Pricing Strategy (Polar.sh / Gumroad)**:
  - **Early-Bird Launch (First 25 Buyers)**: **$49 USD One-Time** (`Solo Store Unlimited`)
  - **Regular Solo Store License**: **$99 USD One-Time** (1 Shopify Store, Unlimited SKUs & Invoices + 3 n8n Workflows)
  - **3PL / Fractional CFO / Agency License**: **$249 USD One-Time** (Up to 10 Client Stores + White-Label PO/Debit Memo/Accounting CSV Deployment)

---

## 2. Polar.sh / Gumroad Product Page Copy (Copy-Paste Ready)

### Product Name
**Post-Stocky Shopify PO, Landed-Cost OTB & 3-Way Invoice Match Kit (MCP Server + 3 n8n Workflows)**

### URL Slug
`po-pilot-shopify-kit`

### Summary (Above the Fold)
Shopify turned Stocky off on August 31, 2026. Replace your broken Monday morning reorder spreadsheets with a local-first TypeScript MCP server + 3 pre-built n8n workflows that recover your Stocky supplier rules, enforce Open-to-Buy cash caps & US tariff landed costs, generate Shopify Draft PO + POS Barcode Transfer CSVs, and auto-audit emailed PDF supplier invoices into verified QuickBooks/Xero Bill CSVs.

### Body Copy

#### What broke when Stocky shut down
Shopify Admin handles inventory counts and basic draft PO storage. It dropped the four parts of purchasing that actually save money:
1. **Supplier directory export**: Stocky never exported vendor lead times, MOQs, or carton multiples.
2. **Stockout-adjusted reorder math**: Dividing 30-day sales by 30 when your bestseller was out of stock for 6 days causes chronic under-ordering.
3. **Carton & MOQ rounding**: Suppliers ship in cases of 12 or 24 and enforce $1,500–$2,500 minimum orders for wholesale pricing or free freight.
4. **3-way invoice matching**: Catching a $0.45/unit silent price increase or 12 damaged units billed in full before Accounts Payable wires funds.

Legacy inventory + AP suites (Prediko, Inventory Planner, Lightyear) charge **$119 to $350+/month** ($1,400–$4,200/year) to get those workflows back. Grab the complete self-hosted kit for **$49 Early-Bird** (first 25 buyers; **$99** regular Solo / **$249** 10-store Agency).

#### What's Inside the ZIP Bundle

1. **Full TypeScript Source Code (`po-pilot-mcp` v1.0.0 — MIT + Unlimited License Key)**
   - 4 deterministic MCP tools (`calculate_replenishment_plan`, `build_supplier_purchase_orders`, `reconcile_po_three_way_match`, `migrate_stocky_csv_snapshot`).
   - Built-in **Open-to-Buy (`max_cash_budget_usd`) cashflow optimizer**, **US Import Tariff + Freight landed cost & margin-erosion alerts**, **Shopify POS Inventory Transfer CSV (`SKU,Barcode,Quantity`)**, and **QuickBooks Online + Xero Verified Bill CSVs**.
   - Runs locally in Claude Desktop, Claude Code, or Cursor via `stdio`, OR self-hosted on Cloudflare/Docker/Render via Streamable HTTP (`--http`).
2. **n8n Workflow #1: `01-monday-shopify-po-generator.json`**
   - Runs every Monday at 08:00 AM, pulls live SKU velocity & barcodes, calculates Z-score safety stock (95% service level), tops up A-class cartons to satisfy vendor minimums, computes landed cost, and posts **Shopify Draft PO CSVs + Shopify POS Transfer CSVs** straight to `#purchasing-ops` in Slack.
3. **n8n Workflow #2: `02-supplier-invoice-3way-match-guard.json`**
   - Webhook-triggered AP guard that cross-checks incoming supplier invoice JSON payloads against your original PO and warehouse receiving counts, alerting `#finance-ap` with a pre-written **Vendor Debit Memo**.
4. **n8n Workflow #3: `03-email-pdf-invoice-auto-3way-match.json`**
   - Watches your AP email inbox via IMAP (`emailReadImap`), extracts text from attached supplier PDF invoices (`extractFromFile`), runs a deterministic 3-way match via `po-pilot-mcp`, routes overcharged invoices to `#ap-exceptions` with a Debit Memo, and routes verified bills to `#ap-approved-bills` with ready-to-import **QuickBooks Online & Xero Bill CSVs**.
5. **3-Minute Setup & Walkthrough Guide + Loom Video**
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
