# Reddit Launch Posts (`r/shopify` Primary + Wholesale Variant)

*Audited with `avoid-ai-writing` (`--context casual`) — zero promotional fluff, concrete math, transparent open-source link first.*

---

## Option A: Primary Launch Post for `r/shopify`

**Title:**
Stocky shut down Aug 31 and didn't let us export suppliers, so I open-sourced a tool that rebuilds vendor lead times/MOQs from Stocky PO CSVs and outputs Shopify Draft PO CSVs

**Body:**
When Stocky went read-only after August 31, two things bit our purchasing workflow right away:

1. Shopify never built a "Download Suppliers" button in Stocky, and the 90-day read-only CSV window runs out around late November.
2. Native Purchase Orders in Shopify Admin work fine as a filing cabinet, except Admin doesn't calculate reorder points, doesn't adjust velocity for days an item was out of stock, and doesn't round order quantities to supplier case packs (12/24 per carton) or vendor dollar minimums.

Most of the Stocky replacement apps we looked at wanted $99–$249/month once you cross a few hundred SKUs, and Shopify's own Storefront MCP only handles shopper carts/checkouts.

So I built a small MIT-licensed MCP server in TypeScript (`po-pilot-mcp`) that runs locally in Claude Desktop / Cursor (or via n8n) with no database and no required API keys:

- **`migrate_stocky_csv_snapshot`**: Drop in your exported Stocky Purchase Orders CSV. It computes each vendor's actual observed lead time (average + standard deviation between Created At and Received At dates), infers carton pack multiples from historical order quantities, grabs your latest unit cost per SKU, and outputs a clean supplier rules file.
- **`build_supplier_purchase_orders`**: Takes a Shopify Products/Inventory CSV (or optional read-only Shopify Admin API token), calculates stockout-adjusted daily velocity + Z-score safety stock, rounds up to carton multiples, tops up your fastest-selling A-tier SKU if a PO is $80 shy of a vendor's free-freight/MOQ minimum, and spits out the exact `SKU,Supplier SKU,Quantity,Cost,Tax %` CSV that Shopify Admin's native Draft PO uploader expects.
- **`reconcile_po_three_way_match`**: Compares your PO lines vs warehouse dock receiving vs the supplier's invoice so you catch silent $0.35/unit price hikes or short-shipped cartons before paying the bill.

It's free and MIT-licensed on GitHub / npm (`npx -y po-pilot-mcp@1.0.0`), and includes a `demo_mode: true` flag if you want to test the math before touching any store data:

GitHub: `https://github.com/maskchanel14-source/po-pilot-mcp`

If anyone here has weird Stocky CSV column edge cases or multi-location transfer quirks they're still untangling before the read-only window closes next month, drop a sample header row in the comments and I'll add parser support for it.

---

## Option B: Alternate Launch Post for `r/wholesalerealestate` (Bonus Adaptation if Testing RE Vertical Next)

> *Note: Included per Phase 4 brief in case you also test audience demand in `r/wholesalerealestate` for custom MCP/n8n deal-desk builds.*

**Title:**
How are you auditing rehab material POs and contractor supplier invoices across multiple flips without paying for construction ERP?

**Body:**
Quick ops question for wholesalers/flippers doing 3+ rehabs or holding wholesale supply accounts (cabinets, LVP flooring, fixtures):

We kept seeing contractors and material suppliers bill full carton quantities when 10–15% arrived cracked at the job site, or quietly bump unit prices by 6–8% vs the original quote sheet.

I wired up a small open-source 3-way match + MOQ Purchase Order MCP tool (`po-pilot-mcp`, MIT license on GitHub) that cross-checks original PO unit prices vs on-sitegood received counts vs the vendor invoice inside Claude, then writes the exact credit/debit memo before releasing final draw payment.

Curious if anyone else here automates material POs / draw audits in n8n or if everyone still tracks SKU quotes in Google Sheets?
