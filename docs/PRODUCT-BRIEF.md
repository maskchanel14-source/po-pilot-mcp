# PRODUCT-BRIEF: PO Pilot MCP (`po-pilot-mcp`)
*Generated: 2026-10-26 | Skills Invoked: `brainstorming` (`obra`), `council` (`affan`), `product-lens` (`affan`), `before-you-build` (`agents`)*

---

## 1. Evaluasi 3 Ide MCP Berdasarkan Temuan Riset Phase 1

| Kriteria (Skor 1–10) | Ide 1: **`po-pilot-mcp`** (Shopify Post-Stocky Replenishment, MOQ PO & 3-Way Invoice Audit) | Ide 2: **`wholesale-mao-mcp`** (US Real Estate Comps Adjuster & MAO Dispo Engine) | Ide 3: **`payout-recon-mcp`** (US E-Commerce Stripe/Shopify Payout-to-Bank Recon) |
| --- | :---: | :---: | :---: |
| **Demand** *(Sudah bayar untuk ini?)* | **9.5** *(Stocky mati 31 Agu 2026; merchant bayar $29–$249/bln)* | **8.0** *(PropStream $99/bln, REsimpli $149/bln)* | **8.5** *(A2X / Synder $60–$200/bln)* |
| **WTP (Willingness to Pay)** | **9.0** *(1 cegah stockout / salah harga invoice = hemat $200–$1.500)* | **7.5** *(Banyak pemula cari sheet gratis sebelum deal pertama)* | **8.5** *(Tim finance ops & CPA bayar USD rutin)* |
| **Competition** *(Peluang / minimnya server berkualitas)* | **9.0** *(0 dari 99 repo Shopify MCP punya PO + MOQ + 3-way match)* | **8.0** *(Server Glama pakai data palsu, tapi butuh API MLS berbayar)* | **6.5** *(Sudah ada Synder `gl-importer-mcp` 83/100, FinCon, Stripe MCP)* |
| **Build Complexity** *(Simpel, zero-cost, <100 baris/handler)* | **8.5** *(Matematika deterministik + CSV/GraphQL opsional, $0 API)* | **7.0** *(Tanpa API RentCast/Zillow berbayar, akuisisi comps terkendala)* | **6.5** *(Edge-case reserve, multi-currency FX, & pajak negara bagian AS)* |
| **Monetization Fit** *(Free 1K + $19 Pro + $49 Bundle + $500 Custom)* | **9.5** *(Siklus mingguan + n8n Monday PO + Upwork migrasi Stocky)* | **7.5** *(Cocok template $49, volume panggilan bulanan lebih fluktuatif)* | **8.0** *(Kuat di Upwork, tapi friksi trust/SOC2 tinggi untuk akses bank)* |
| **TOTAL SKOR (/50)** | **45.5 / 50 (PEMENANG)** | **38.0 / 50** | **38.0 / 50** |

---

## 2. Sidang 4-Suara (`council` Skill — Architect, Skeptic, Pragmatist, Critic)

**Pertanyaan Keputusan**: *Di antara 3 workflow manual bisnis AS di atas, server MCP mana yang harus kita bangun sekarang dengan biaya infrastruktur $0 agar bisa langsung dimonetisasi di MCPize ($19/bln), Gumroad ($49), dan Upwork ($500–$1.500)?*

- **Architect**: Pilih **`po-pilot-mcp`** dengan arsitektur *hybrid stateless* (menerima baik input CSV/JSON langsung dari ekspor Shopify/Stocky maupun tarikan langsung dari Shopify Admin GraphQL `2026-04` bila kredensial disuplai). Arsitektur ini menjaga *cold-start* <20ms, lolos 100% *health check* otomatis Glama/MCPize/Smithery tanpa API key, dan memisahkan *pure domain engine* dari layer transport MCP.
- **Skeptic**: Hati-hati terjebak membuat klon ERP raksasa atau CRUD wrapper Shopify ke-100. Mengapa orang tidak pakai Google Sheets atau aplikasi FillShelves $15/bln saja? Jawabannya: Google Sheets hancur saat membulatkan *case-pack* + *MOQ minimum dolar lintas-SKU* per vendor DAN tidak bisa membaca/mengaudit selisih baris invoice PDF/teks dari distributor di dalam chat Claude! Jadi fokuskan tool pada **keputusan pembelian + pembulatan MOQ + ekspor CSV PO Shopify + audit 3-way match invoice**.
- **Pragmatist**: *Timing* adalah segalanya — Stocky baru saja dimatikan pada **31 Agustus 2026** dan jendela ekspor CSV read-only ditutup akhir **November 2026** (sekitar 35 hari dari hari ini, 26 Oktober 2026). Ribuan pemilik toko AS sedang mencari kata kunci *"Stocky replacement purchase order"* di Reddit `r/shopify` dan Upwork hari ini. Kita bisa merilis MVP TypeScript yang bersih dalam satu sesi dengan 4 tool tajam.
- **Critic**: Risiko terbesar adalah: (1) kredensial `SHOPIFY_ACCESS_TOKEN` di-set `required: true` sehingga gagal di *scanner* kualitas otomatis (solusi: buat `required: false` + `demo_mode` bawaan), dan (2) perhitungan *velocity* salah ketika barang sempat kosong/*stockout* (solusi: hitung `stockout_days` agar *true daily velocity* tidak tertekan rendah secara palsu).

### Verdict (`council`)
- **Consensus**: **`po-pilot-mcp`** menang mutlak karena menggabungkan urgensi waktu nyata pasca-penutupan Stocky, nol biaya API pihak ketiga, dan ketiadaan kompetitor MCP di ceruk *Purchase Order + MOQ + 3-Way Match*.
- **Strongest dissent**: Ide 3 (`payout-recon-mcp`) punya ACV tinggi di firma akuntansi, namun kehadiran resmi Synder (`gl-importer-mcp`) dan hambatan kepercayaan akses data bank menggerus konversi self-serve untuk kreator solo.
- **Premise check**: Skeptic mengoreksi cakupan produk — jangan hanya membuat kalkulator *reorder point*, melainkan sambungkan siklus penuh dari **Stok Rendah -> Draft PO per Vendor (MOQ & Case-Pack) -> CSV Upload Shopify Native -> Audit 3-Way Match Invoice Supplier**.
- **Recommendation**: Bangun **`po-pilot-mcp`** menggunakan TypeScript (`@modelcontextprotocol/sdk` + `zod`), 4 workflow tools deterministik, manifest `mcpize.yaml` + `glama.json` + `smithery.yaml`, dan paket penjualan Gumroad/Upwork/Reddit berfokus pada krisis pasca-Stocky.

---

## 3. YC Product Diagnostic (`product-lens` Mode 1)

1. **Siapa target spesifiknya?**: Manajer operasional / pemilik toko Shopify & distributor grosir AS dengan 50–2.500 SKU dan 3–30 supplier yang kehilangan aplikasi Stocky pasca 31 Agustus 2026.
2. **Apa rasa sakitnya (Pain)?**: Menghabiskan 3–5 jam setiap Senin pagi mengekspor CSV Shopify, menyalin aturan MOQ/lead-time vendor di Excel, menghitung ulang stok aman, memecah CSV Draft PO per supplier, dan kehilangan ribuan dolar akibat *stockout* SKU terlaris atau tagihan vendor yang diam-diam naik harga.
3. **Why Now?**:
   - Shopify mematikan **Stocky** secara permanen pada **31 Agustus 2026**; jendela read-only berakhir akhir November 2026.
   - **Official Shopify Storefront MCP / UCP** hanya mengurus *front-office shopper* (`catalog`, `cart`, `checkout`), nol dukungan *Purchase Order* atau *Finance Ops*.
4. **Versi 10-Bintang**: Agen otonom yang memantau penjualan harian, menego harga dengan supplier via email, membuat Draft PO otomatis, dan memblokir pembayaran tagihan yang tidak cocok dengan barang datang di gudang.
5. **MVP (4 Tools Inti — via ICE Prioritization `product-lens` Mode 4)**:
   - `calculate_replenishment_plan` (ICE: 5×5÷1 = **25.0**): Hitung *true daily velocity* (koreksi hari *stockout*), *safety stock* (Z-score service level), *reorder point*, risiko kehabisan stok, dan klasifikasi ABC pendapatan — dari CSV/JSON atau live Shopify Admin API + mode demo.
   - `build_supplier_purchase_orders` (ICE: 5×5÷1 = **25.0**): Kelompokkan SKU per vendor, bulatkan ke kelipatan karton (*case-pack*), tegakkan *MOQ unit* & *minimum order USD* (otomatis *top-up* SKU fast-moving A-class jika kurang sedikit dari ambang *free-freight*/MOQ!), lalu hasilkan **CSV Draft PO siap-impor ke Shopify Admin** + draf email PO profesional ke supplier.
   - `reconcile_po_three_way_match` (ICE: 5×4.5÷1 = **22.5**): Audit Finance Ops *3-Way Match* (PO Asli vs Barang Diterima Gudang vs Invoice Supplier) — mendeteksi kenaikan harga unit diam-diam, *short-ship*, *over-billing*, *unapproved SKU*, serta menghasilkan klaim *debit memo* siap kirim ke vendor.
   - `migrate_stocky_csv_snapshot` (ICE: 4.5×5÷1 = **22.5**): Ekstrak & rekonstruksi profil supplier (*actual lead time* dari selisih tanggal order-terima, rata-rata unit cost, estimasi MOQ/pack size, daftar SKU per vendor) langsung dari CSV histori PO Stocky sebelum jendela read-only Stocky ditutup!
6. **Anti-Goal (Yang Eksplisit TIDAK Dibangun)**:
   - Bukan CRUD produk/tema/diskon generik Shopify.
   - Tidak memaksa database eksternal berbayar (Postgres/Redis) — murni *stateless* zero-cost.
   - Tidak pernah mengeksekusi pembayaran uang atau menghapus katalog merchant.
7. **Metrik Keberhasilan**:
   - Setup < 60 detik (`npx -y po-pilot-mcp`), waktu respons tool < 30ms untuk 500 SKU.
   - Skor dokumentasi & kepercayaan Glama / MCPize > 85/100 (Top 5%).

---

## 4. Pre-Mortem Risk Review (`before-you-build` Skill)

1. **Risk verdict**: **Low-to-Medium Risk** — Permintaan pasar dan WTP sudah divalidasi oleh ribuan eks-pengguna Stocky yang saat ini bermigrasi ke aplikasi berbayar $29–$249/bulan.
2. **Main assumption**: Pemilik toko / operator bersedia menjalankan alur PO dari Claude Desktop, Cursor, atau template otomatis n8n dibandingkan membeli dashboard SaaS $199/bulan.
3. **Evidence to find first**: Konversi instalasi gratis (1.000 request/bln) dari postingan peluncuran di `r/shopify` menggunakan fitur pemulihan data CSV Stocky (`migrate_stocky_csv_snapshot`) sebagai *lead magnet* utama.
4. **Do next**: Rilis paket npm `po-pilot-mcp` + `mcpize.yaml` dengan `demo_mode: true` agar calon pembeli dapat menguji 3 copy-paste prompt dalam 30 detik tanpa perlu memasukkan token rahasia toko mereka terlebih dahulu.
5. **Delay**: Tunda pembuatan dashboard web multi-user dengan autentikasi OAuth Shopify publik sampai ada minimal 20 pelanggan berbayar Pro ($19/bln) atau 3 klien kustom Upwork ($500–$1.500).
