# Playbook Distribusi & Tempat Jualan `po-pilot-mcp` (Khusus Indie Hacker Surabaya → Pasar USD)

*Disusun dengan skill `market-research` & `finance-billing-ops` — diverifikasi per Oktober 2026.*

Jangan pernah bergantung pada Gumroad saja (Gumroad memotong **10% + $0.50** untuk link langsung dan **30%** dari fitur Gumroad Discover). Aset yang sudah Anda miliki di repo ini (**MCP Server TypeScript + 2 Workflow n8n + Keahlian Domain Post-Stocky**) bisa dijual serentak di **12 kanal $0 modal awal** yang ramah pencairan dana ke Indonesia (Rekening BCA/Mandiri, Wise USD, Payoneer, PayPal, atau USDC Base).

---

## Ringkasan Perbandingan Tempat Jualan (Urut Margin & Kecepatan Cuan)

| # | Platform | Apa yang Dijual | Potongan / Bagi Hasil | Cara Cair ke Surabaya (ID) | Prioritas |
| --- | --- | --- | --- | --- | --- |
| 1 | **Polar.sh** | Bundle $49, License Key, Private Repo Pro $19/bln | **5% + $0.50** (MoR, pajak AS beres) | Stripe Connect Express (**🇮🇩 Indonesia didukung resmi**) → Bank Lokal | **WAJIB #1** |
| 2 | **Lemon Squeezy** | Bundle $49 (Source + n8n + SOP PDF) | **5% + $0.50** (MoR) | Transfer Bank Lokal Indonesia / PayPal | **WAJIB #2** |
| 3 | **MCPize** | Hosted MCP Pro ($19/bln) + **x402 Pay-Per-Call** | Kreator dapat **80%** | **USDC di jaringan Base (x402)** instan ke wallet crypto / Stripe | **WAJIB #3** |
| 4 | **Apify Store** | Hosted MCP Server (*Pay-Per-Event*, misal $0.05/PO) | **80%** dikurangi compute (~70–75% bersih) | PayPal (min. $20) / Bank Transfer (min. $100) tiap bulan | Tinggi |
| 5 | **n8n Creator Hub** | 3 Workflow Gratis → buka akses **Paid Templates** + Affiliate | **0%** dari n8n (pakai link Polar/Gumroad) + **30% komisi afiliasi 12 bln** | Sesuai link checkout Anda + payout afiliasi n8n | Tinggi |
| 6 | **n8n Markets & AutomationWorkflows.io** | Template n8n `#01` & `#02` ($39–$79) | **15%** (AutomationWorkflows.io) | PayPal / Wise / Stripe Express | Menengah |
| 7 | **Upwork** | Jasa Setup Post-Stocky ($500 / $950 / $1.500) | **10%** freelancer fee | Direct to Local Bank (BCA/Mandiri) / Wise USD / Payoneer | **UANG TERCEPAT** |
| 8 | **Contra.com** | Productized Service Setup ($750–$1.500) | **0% komisi kreator!** | Wise USD / Bank Lokal | **UANG TERCEPAT** |
| 9 | **n8n Forum (`community.n8n.io/c/jobs`)** | Subkontrak agensi AS & klien langsung ($500–$2.500) | **0%** (invoice langsung) | Wise USD Invoice / Crypto USDC | Tinggi |
| 10 | **Fiverr** | Paket instalasi MCP + Shopify PO Bot ($150 / $450 / $950) | **20%** | Payoneer / PayPal | Menengah |
| 11 | **Smithery, Glama & Official MCP Registry** | Listing gratis sebagai **mesin trafik B2B** ke Polar/MCPize | Gratis (0%) | Mengalirkan pembeli ke Polar / MCPize / Upwork | Wajib SEO |
| 12 | **Cold Loom Outbound (StoreLeads Free)** | Audit 2 menit penyelamatan CSV Stocky ($500 flat setup) | **0%** (bayar via link Polar.sh) | Polar.sh → Bank Lokal / Wise | Margin 95% |

---

## Strategi Eksekusi 4 Lapis (Biar Satu Produk Menghasilkan dari 4 Pintu)

### Lapis 1: Ganti/Dampingi Gumroad dengan Polar.sh (Hemat Separuh Biaya Komisi!)
- Buka `https://polar.sh`, hubungkan akun GitHub `maskchanel14-source`.
- Buat produk **$49 Post-Stocky Automation Kit** (otomatis mengizinkan pembeli mengunduh ZIP n8n + mendapatkan License Key).
- Karena Polar bertindak sebagai *Merchant of Record*, Anda **tidak perlu mendirikan US LLC ($500)** dan tidak pusing mengurus pajak negara bagian AS (US Sales Tax) — Polar yang memungut dan menyetorkannya, lalu mencairkan bersih ke rekening Indonesia Anda.

### Lapis 2: Trik Anti-Blokir Pembayaran di MCPize & Agent Economy (`x402` USDC)
- Banyak kreator Indonesia mentok saat platform meminta akun Stripe standar AS.
- Di **MCPize** (atau Cloudflare Worker gratis milik Anda sendiri), aktifkan pembayaran **x402 Protocol (USDC di jaringan Base)**. Agent milik user AS bisa membayar misal `$0.03 USDC` per eksekusi `build_supplier_purchase_orders` atau `$0.08 USDC` per audit invoice `reconcile_po_three_way_match` langsung ke alamat wallet Base Anda tanpa perlu akun bank AS sama sekali.

### Lapis 3: Bungkus Jadi Apify MCP Actor (`apify.com/store`)
- Bungkus `dist/index.js` ke **Apify Store** sebagai MCP Server berbasis *Pay-Per-Event (PPE)*.
- Apify sudah punya puluhan ribu pengguna bisnis aktif yang punya saldo kredit bulanan ($19–$499/bln), sehingga mereka tidak perlu memasukkan kartu kredit baru untuk memakai tool Anda. Pencairan ke PayPal hanya butuh saldo minimum **$20**.

### Lapis 4: Funnel "Template Gratis → Paid n8n + Klien $950" di Ekosistem n8n
1. Pecah fitur `migrate_stocky_csv_snapshot` menjadi **1 workflow gratis** lalu submit ke `n8n.io/workflows` (sertakan link afiliasi n8n Cloud Anda untuk komisi pasif **30% selama 12 bulan**). Submit 2 workflow utilitas kecil lainnya agar akun Anda naik status jadi **Verified Creator** dan membuka tombol **"Buy for $49"** resmi di galeri n8n!
2. Upload 2 workflow lengkap di folder `sales-bundle/n8n-templates/` ke **AutomationWorkflows.io** dan **n8n Markets** seharga **$49–$79**.
3. Posting studi kasus singkat di **`community.n8n.io/c/jobs`**, **Contra.com** (0% fee!), dan **Upwork** untuk menangkap pemilik toko Shopify AS yang tidak mau pusing setup sendiri dan lebih suka membayar **$500–$1.500** terima beres sebelum jendela read-only Stocky ditutup akhir November 2026.
