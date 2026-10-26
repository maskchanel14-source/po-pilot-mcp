# 3-Minute Loom Walkthrough Script — `po-pilot-mcp`

**Target Viewer**: US Shopify store owners, wholesale purchasing managers, and e-commerce finance operators migrating off Shopify Stocky.
**Runtime**: ~2 minutes 45 seconds
**Screen Setup**: Split screen or 3 tabs ready:
1. Tab 1: Shopify Help Center notice ("Stocky stopped working after August 31, 2026")
2. Tab 2: Claude Desktop with `po-pilot-mcp` connected (`npx -y po-pilot-mcp@1.0.0`)
3. Tab 3: n8n canvas showing the automated Monday Morning PO + 3-Way Match workflows

---

## [0:00 – 0:25] The Hook (Show Tab 1: Stocky Shutdown Notice)

> "If you run a Shopify brand or wholesale catalog, Stocky shut off on August 31st. Native Shopify Admin still lets you type in a draft Purchase Order by hand, and it won't export your old Stocky supplier lead times or MOQs. Worse, you're stuck every Monday exporting two CSVs, fixing broken VLOOKUPs, rounding carton sizes by hand, and hoping your supplier didn't quietly bump unit costs on the invoice.
>
> In the next two minutes I'll show you how to run that entire purchasing and invoice-audit loop inside Claude or n8n in under 60 seconds."

## [0:25 – 0:55] Step 1: Recover Lost Stocky Supplier Rules (Switch to Tab 2: Claude Desktop)

> "First, let's rescue the supplier directory Stocky refused to export. I only added three lines to Claude Desktop config: `npx -y po-pilot-mcp@1.0.0`. No database, no API keys needed to test.
>
> I paste my old Stocky Purchase Orders CSV — or run `demo_mode: true` — and call `migrate_stocky_csv_snapshot`."

*(Run Prompt 2 on screen; highlight JSON/table output)*

> "Look at what comes back in half a second: PO Pilot calculates each supplier's actual observed lead time from order-to-receive dates — 22 days for Pacific Stainless, 10 days for Blue Ridge — infers your carton pack multiples using greatest common divisor across past orders, and hands you a clean `supplier_rules` block."

## [0:55 – 1:45] Step 2: Stockout-Adjusted Reorder + MOQ Top-Up + Shopify PO CSV

> "Now let's run Monday morning purchasing with `build_supplier_purchase_orders` at a 95% service level."

*(Run Prompt 1 on screen; scroll to the generated POs)*

> "Notice three things spreadsheets usually get wrong:
> 1. Our Matte Black Camp Mug sold 210 units in 30 days, and it was out of stock for 5 of those days. Instead of dividing by 30 and under-ordering, PO Pilot divides by 25 active days — catching the real 8.4 units/day velocity.
> 2. Every line is rounded cleanly to vendor carton multiples — 24 per box for mugs, 12 for flasks.
> 3. Pacific Stainless has a $2,200 minimum order for wholesale terms. When natural restock came in just short, PO Pilot automatically added cartons to our fastest A-class SKU instead of padding dead stock.
>
> Right below that, it spits out the exact `SKU,Supplier SKU,Quantity,Cost,Tax %` CSV ready to drop straight into **Shopify Admin -> Purchase Orders -> Import CSV**, plus the formatted vendor email."

## [1:45 – 2:25] Step 3: Finance Ops 3-Way Match Audit (Catching Vendor Overcharges)

> "Finally, three weeks later the shipment hits your 3PL and the vendor sends a PDF invoice. Watch what happens when we run `reconcile_po_three_way_match`."

*(Run Prompt 3 on screen)*

> "PO Pilot flags `$429.80` in overcharges instantly:
> - A silent 45-cent unit price hike on 240 mugs (`$108.00`),
> - 12 damaged mugs and 12 short-shipped flasks billed as if they arrived (`$187.80`),
> - An unapproved `$65` pallet-wrap surcharge, and `$90` above our agreed freight cap.
>
> It tells Finance Ops: **HOLD_AND_ISSUE_DEBIT_MEMO**, computes the exact verified payable dollar amount, and writes the Debit Memo email to the vendor's AR team."

## [2:25 – 2:45] CTA (Switch to Tab 3: n8n Workflow Canvas)

> "You can install `po-pilot-mcp` free right now via `npx` or on MCPize — the first 1,000 calls every month are free, and Pro is $19/month vs $150 to $250 for legacy forecasting apps.
>
> If you want this running hands-free every Monday morning in Slack and Gmail, grab the $49 Gumroad bundle below with the full TypeScript source code and both pre-wired n8n templates — or reach out if you want our team to wire it into your multi-warehouse Shopify + QuickBooks stack."
