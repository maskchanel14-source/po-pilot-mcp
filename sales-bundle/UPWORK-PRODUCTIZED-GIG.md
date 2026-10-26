# Upwork & Contra Productized Service ($750 – $2,500 USD)

*Crafted with `marketing-campaign`, `avoid-ai-writing`, and `finance-billing-ops` skills.*

---

## Project Catalog Title (Max 75 chars)
**Shopify Post-Stocky PO, Landed Cost OTB & QuickBooks/Xero 3-Way Match**

### Alternative Search-Optimized Title (Direct Proposals)
**Replace Shopify Stocky: Automated POs, POS Transfers & AP Invoice 3-Way Match**

---

## Tiered Pricing Packages (Upwork Project Catalog / Contra)

| Deliverable | Starter ($750) | Growth Ops ($1,450) | Multi-Warehouse + AP ($2,500) |
| --- | --- | --- | --- |
| **Delivery Time** | 3 Business Days | 5 Business Days | 10 Business Days |
| **Stocky CSV Supplier & Lead-Time Recovery** | Up to 15 Suppliers | Up to 50 Suppliers | Unlimited Suppliers |
| **Custom `po-pilot-mcp` Deployment (Claude + HTTP)** | Included | Included | Included |
| **Live Read-Only Shopify Admin GraphQL Wiring** | 1 Shopify Store | Up to 2 Stores | Multi-Location / Plus |
| **US Tariff Landed Cost + Open-to-Buy + POS Transfer CSV** | Included | Included | Included |
| **Automated Monday Slack/Email PO Workflow (`n8n #01`)** | — | Included | Included |
| **Email PDF Invoice 3-Way Match + QuickBooks/Xero CSVs (`n8n #02 & #03`)** | — | — | Included (IMAP PDF + QBO/Xero) |
| **Recorded Loom Handoff + Team SOP** | 15-min Loom | 30-min Live + Loom | 60-min Live + 14-Day Support |

---

## Full Upwork Description (Copy-Paste Ready)

Did your purchasing workflow break when Shopify shut down **Stocky on August 31, 2026**?

Native Shopify Admin lets you store inventory counts and upload draft Purchase Orders, yet it dropped reorder point math, carton/case-pack rounding, supplier minimum order thresholds, and supplier directory exports. Most brands are either back to fragile Monday-morning Excel VLOOKUPs or paying $199–$399/month forever for bloated ERP software.

I deploy a private, zero-subscription **Purchasing & Accounts Payable MCP + n8n Automation System** tailored to your Shopify catalog and vendor rules in 3 to 10 days.

### What You Get

1. **Stocky Historical Data Rescue (Before the Read-Only Window Closes)**
   I ingest your historical Stocky Purchase Order CSVs and reconstruct every vendor's true observed lead time (mean + variance from order-to-receipt timestamps), SKU unit costs, carton pack multiples, and minimum order sizes.
2. **Stockout-Adjusted Replenishment & MOQ Engine (`po-pilot-mcp`)**
   Connected directly to your Shopify Admin API (read-only scopes: `read_products`, `read_inventory`, `read_orders`). Calculates true daily velocity excluding stockout days, Z-score safety stock (90%–99% service levels), carton rounding, and automatic A-SKU top-ups when an order sits just below your supplier's wholesale minimum or free-freight threshold.
3. **One-Click Shopify Draft PO CSVs + POS Barcode Transfer CSVs + Monday Slack Digest**
   Every Monday at 8:00 AM, your purchasing channel receives ready-to-import Shopify Native Draft PO CSVs (`SKU,Supplier SKU,Quantity,Cost,Tax %`), Shopify POS Inventory Transfer CSVs (`SKU,Barcode,Quantity` for retail scanner receiving), US import tariff + freight landed-cost checks, Open-to-Buy cashflow rationing, and pre-addressed vendor PO emails.
4. **Automated Email PDF Invoice 3-Way Match + QuickBooks/Xero Bill CSVs ($2,500 Tier)**
   When a supplier emails a PDF invoice to your AP inbox, n8n extracts the PDF lines and cross-checks your original PO vs warehouse receiving counts vs the billed invoice — catching silent unit-price hikes, damaged/short-shipped cartons, and freight cap overages, drafting the Vendor Debit Memo, and emitting verified-only **QuickBooks Online** and **Xero** Bill CSVs.

### Why Clients Pick This Over a $250/mo App
- **Zero recurring SaaS bloat**: Runs on your own Claude Desktop, Cursor, or free/self-hosted n8n + Cloudflare/Railway worker.
- **Deterministic math, zero hallucinated numbers**: Every safety stock, carton multiple, and dollar variance is computed by strict TypeScript formulas covered by automated tests — never guessed by an LLM.
- **Safe by design**: Uses read-only Shopify Admin tokens; nothing can accidentally overwrite your live product catalog or trigger unauthorized payments.

### Requirements to Start
1. Read-only Shopify Custom App token (`read_products`, `read_inventory`, `read_orders`) — I provide a 2-minute screenshot guide to generate this safely.
2. Any exported Stocky PO CSVs or your current vendor MOQ / carton-size sheet.
3. Your preferred alert destination (Slack webhook, Gmail, or Microsoft Teams).
