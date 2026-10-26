# Panduan Lengkap Deploy `po-pilot-mcp` ($0 Modal Awal)

Semua file konfigurasi deploy sudah siap di root repo ini (`package.json`, `Dockerfile`, `docker-compose.yml`, `mcpize.yaml`, `smithery.yaml`, `glama.json`, `server.json`, dan `.github/workflows/publish-mcp.yml`).

Ikuti urutan **6 langkah** di bawah ini karena beberapa registry saling membutuhkan (misalnya: **Official MCP Registry** mewajibkan paket sudah tayang di **npm** terlebih dahulu, sedangkan **Glama/Smithery/MCPize** membaca branch **`main`** di GitHub).

---

## Langkah 1: Pastikan Branch `main` Terbaru & Repo Berstatus Public

Kode utama beserta seluruh perbaikan audit (PR `#1`–`#5` + PR rilis `#6`) berada di repo publik `https://github.com/maskchanel14-source/po-pilot-mcp` sehingga Glama, Smithery, MCPize, dan GitHub OIDC dapat memvalidasinya secara gratis (`$0`).

---

## Langkah 2: Publish ke `npm` & Official MCP Registry (`npx -y po-pilot-mcp@1.0.0`)

Ada **2 cara** (pilih salah satu — **Cara A cukup lewat browser tanpa terminal!**):

### Cara A — 1-Klik Lewat GitHub Release / GitHub Actions (Sekalian Tembus Official MCP Registry!)
1. Buat akun gratis di [npmjs.com](https://www.npmjs.com) → klik profil → **Access Tokens** → **Generate New Token (Granular Access Token)**:
   - Permissions: **Read and write** pada *Packages and scopes* (centang *Bypass two-factor authentication* agar CI bisa publish otomatis).
2. Buka GitHub repo `https://github.com/maskchanel14-source/po-pilot-mcp/settings/secrets/actions` → **New repository secret**:
   - Name: `NPM_TOKEN`
   - Secret: *(paste token npm Anda)*
3. Buka halaman **Releases** di GitHub (`https://github.com/maskchanel14-source/po-pilot-mcp/releases`) → buka Draft Release **`v1.0.0`** yang sudah disiapkan lengkap dengan lampiran ZIP → klik tombol hijau **"Publish release"** *(atau jalankan `Actions -> Release to npm & Official MCP Registry -> Run workflow`)*.
   GitHub Actions (`.github/workflows/publish-mcp.yml`) akan otomatis menjalankan `npm test`, merilis `po-pilot-mcp@1.0.0` ke **npm** (dengan Sigstore Provenance), sekaligus mempublikasikan `server.json` ke **Official MCP Registry (`registry.modelcontextprotocol.io`)** menggunakan GitHub OIDC!

### Cara B — Manual dari Terminal Laptop
```bash
npm login
npm test
npm publish --access public
```
*(Catatan Keamanan Penting: **JANGAN** jalankan `npm i -g mcp-publisher` dari npm karena paket bernama `mcp-publisher` di npm adalah paket pihak ketiga Rusia yang tidak ada hubungannya dengan Anthropic/MCP! Untuk Official MCP Registry, gunakan workflow GitHub Actions pada Cara A atau unduh binary resmi dari `https://github.com/modelcontextprotocol/registry/releases`).*

---

## Langkah 3: Deploy & Monetisasi ke MCPize Cloud (Free + Cloud Pro $29/bln + Agency $79/bln + USDC `x402`)

File `mcpize.yaml` sudah tervalidasi ketat terhadap skema Zod resmi `mcpize@1.2.2`. Setelah `mcpize deploy --yes`, atur tier langganan di **MCPize Developer Dashboard → Monetization**: **Free Sandbox (15 req/bln)**, **Cloud Pro ($29/bln — 500 req/bln)**, dan **Cloud Agency ($79/bln — 3.000 req/bln)**, serta isi secret `PO_PILOT_SERVER_LICENSE_KEY` agar pelanggan cloud Pro/Agency Anda bebas dari batas lokal 25 SKU/panggilan.

```bash
# 1. Install CLI resmi MCPize
npm install -g mcpize

# 2. Login via browser
mcpize login

# 3. Deploy langsung dari folder repo
mcpize deploy --yes
```
- **Alternatif Tanpa Terminal**: Buka `https://mcpize.com/developer/servers/new`, hubungkan repo GitHub `maskchanel14-source/po-pilot-mcp` — MCPize otomatis mendeteksi `mcpize.yaml` dan `Dockerfile`.
- Di dashboard MCPize, aktifkan payout (atau nyalakan **x402 USDC on Base** agar pembayaran per-tool-call langsung cair ke wallet crypto Anda di Surabaya tanpa kendala bank AS).

---

## Langkah 4: Listing Gratis di Glama.ai & Smithery.ai (Mesin Trafik SEO B2B)

Karena kita sudah menyertakan **`Dockerfile`** multi-stage + `glama.json` + `smithery.yaml`, server Anda akan lolos inspeksi otomatis (*Inspectable*):

### A. Glama (`glama.ai`)
1. Buka `https://glama.ai/mcp/servers` → klik **"Add Server"**.
2. Paste URL `https://github.com/maskchanel14-source/po-pilot-mcp`.
3. Setelah terindeks, klik **"Claim Server"** dengan login GitHub `maskchanel14-source` (cocok dengan field `"maintainers"` di `glama.json`) agar mendapat lencana verified & skor **A**.

### B. Smithery (`smithery.ai`)
Buka `https://smithery.ai/new` → hubungkan repo GitHub `maskchanel14-source/po-pilot-mcp` → klik **Deploy** *(atau jika Anda sudah menyalakan endpoint HTTP publik di Render/Koyeb/MCPize, jalankan CLI `@smithery/cli@4.11.1`: `npm install -g @smithery/cli && smithery login && smithery publish https://domain-anda.com/mcp`)*.

---

## Langkah 5: Deploy Endpoint HTTP untuk 3 Workflow n8n (Cloud Gratis / VPS / Klien $1.450)

Ketiga template n8n di `sales-bundle/n8n-templates/` (`#01` Monday PO + POS Transfer CSV, `#02` Webhook 3-Way Match, dan `#03` IMAP Email PDF Invoice → Auto 3-Way Match + QuickBooks/Xero CSV) memanggil endpoint Streamable HTTP `POST /mcp`. Anda punya **2 opsi gratis/murah**:

### Opsi A — Satu Perintah Docker Compose (Lokal / VPS Klien)
File `docker-compose.yml` di repo ini langsung menyalakan `po-pilot-mcp` (`:8080`) + `n8n` (`:5678`) dalam satu jaringan internal yang sudah saling tersambung:
```bash
# Opsional: isi kredensial read-only Shopify jika ingin live mode
cp .env.example .env

# Nyalakan server MCP HTTP + n8n sekaligus
docker compose up -d

# Cek kesehatan server MCP
curl http://localhost:8080/health
```
Lalu buka `http://localhost:5678`, import file JSON dari `sales-bundle/n8n-templates/`, dan workflow langsung jalan tanpa ubah URL!

### Opsi B — Cloud Hosting Gratis 0 Rupiah (Render.com / Koyeb Free Tier)
Jika memakai **n8n Cloud** atau ingin endpoint publik `https://...`:
1. Buka [Render.com](https://render.com) atau [Koyeb.com](https://www.koyeb.com) → **New Web Service** → pilih repo GitHub `maskchanel14-source/po-pilot-mcp`.
2. Runtime: pilih **Docker** (otomatis memakai `Dockerfile` di root repo).
3. Tambahkan Environment Variables:
   - `TRANSPORT` = `http`
   - `PORT` = `8080`
   - *(Opsional untuk klien spesifik)* `SHOPIFY_STORE_DOMAIN` & `SHOPIFY_ACCESS_TOKEN`
4. Health Check Path: `/health`.
5. Setelah live (misal `https://po-pilot-mcp.onrender.com`), masukkan URL `https://po-pilot-mcp.onrender.com/mcp` ke variabel `PO_PILOT_MCP_HTTP_URL` di n8n!

---

## Langkah 6: Bungkus ZIP Produk Digital ($49 Early-Bird → $99 Solo / $249 Agency) untuk Polar.sh / Lemon Squeezy / Gumroad

File **`po-pilot-post-stocky-kit-v1.0.0.zip`** sudah otomatis terlampir di halaman **GitHub Releases (`v1.0.0`)**, atau bisa dibuat ulang kapan saja dengan satu perintah:

```bash
npm run package:release
# Hasil: release-artifacts/po-pilot-post-stocky-kit-v1.0.0.zip
```
*(Script ini otomatis menyertakan `package-lock.json`, `.dockerignore`, `Dockerfile`, `docker-compose.yml`, `QUICKSTART-BUYERS.md`, dan ke-3 template JSON n8n, serta memblokir `scripts/mint-license.mjs` dan `.keys/` agar kunci privat pembuat lisensi tidak pernah ikut terbungkus).*
