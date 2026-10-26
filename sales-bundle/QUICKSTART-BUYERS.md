# PO Pilot MCP v1.0.0 — 3-Minute Buyer Quickstart

Thank you for purchasing the **PO Pilot Post-Stocky Replenishment, Landed-Cost PO & 3-Way Match Kit**.

---

## 1. Activate Your Unlimited License Key

Set `PO_PILOT_LICENSE_KEY` to the key from your Polar.sh / Gumroad / Direct order receipt:
- **Polar.sh key format**: `<organization_uuid>:<your_license_key>`
- **Offline `POP1.*` key format**: `POP1.<payload>.<signature>`

Unlocking `PO_PILOT_LICENSE_KEY` removes the 25-SKU / 15-invoice-line sandbox limit and enables Live Read-Only Shopify Admin GraphQL (`read_products`, `read_inventory`, `read_orders`).

---

## 2. Option A — Use Inside Claude Desktop, Cursor, or VS Code (Stdio MCP)

Add this block to your `claude_desktop_config.json` or `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "po-pilot": {
      "command": "npx",
      "args": ["-y", "po-pilot-mcp@1.0.0"],
      "env": {
        "PO_PILOT_LICENSE_KEY": "PASTE_YOUR_LICENSE_KEY_HERE",
        "SHOPIFY_STORE_DOMAIN": "your-store.myshopify.com",
        "SHOPIFY_ACCESS_TOKEN": "shpat_your_readonly_token"
      }
    }
  }
}
```

> **CSV-only mode (no Shopify API token needed):** Leave `SHOPIFY_STORE_DOMAIN` and `SHOPIFY_ACCESS_TOKEN` blank and paste your Stocky PO export (`migrate_stocky_csv_snapshot`) or Shopify `products_export.csv` (`build_supplier_purchase_orders`) directly in chat.

---

## 3. Option B — Run Streamable HTTP Server + n8n Automation Stack (Docker Compose)

1. Copy `.env.example` to `.env` in this folder and paste your `PO_PILOT_LICENSE_KEY` (plus optional Shopify read-only credentials):
   ```bash
   cp .env.example .env
   docker compose up -d --build
   curl http://localhost:8080/health
   ```
2. Open n8n at `http://localhost:5678` and import the 3 workflows from `sales-bundle/n8n-templates/`:
   - `01-monday-shopify-po-generator.json` — Every Monday 08:00 AM, builds MOQ/OTB-compliant supplier POs + Shopify Draft PO CSV + Shopify POS Transfer CSV (`SKU,Barcode,Quantity`) and posts them to Slack `#purchasing-ops`.
   - `02-supplier-invoice-3way-match-guard.json` — Webhook endpoint (`/webhook/ap-invoice-intake`) that audits PO vs. Warehouse Dock Receiving vs. Supplier Invoice and alerts `#finance-ap` with a ready-to-send Debit Memo when variances are found.
   - `03-email-pdf-invoice-auto-3way-match.json` — Watches your AP IMAP inbox for supplier PDF invoices, extracts line items & freight, runs deterministic 3-way matching, and posts verified-only **QuickBooks Online** & **Xero** Purchase Bill CSVs to `#ap-approved-bills` (or holds discrepancies in `#ap-exceptions`).

---

## 4. Importing Generated CSVs into Shopify, QuickBooks Online & Xero

- **Shopify Draft PO CSV (`shopify_draft_po_csv`)**: `Shopify Admin -> Products -> Purchase orders -> Create purchase order -> Import`.
- **Shopify POS Inventory Transfer CSV (`shopify_transfer_import_csv`)**: `Shopify Admin -> Products -> Transfers -> Create transfer -> Import`.
- **QuickBooks Online Verified Bill CSV (`quickbooks_bill_csv`)**: Import via QBO Bill CSV importer (`BillNo,Supplier,BillDate,DueDate,LineDescription,LineAmount,Account,LineTaxCode,Currency`).
- **Xero Purchase Bill CSV (`xero_bill_csv`)**: `Xero -> Business -> Bills to pay -> Import` (`*ContactName,*InvoiceNumber,*InvoiceDate,*DueDate,InventoryItemCode,Description,*Quantity,*UnitAmount,*AccountCode,*TaxType,Currency`).
