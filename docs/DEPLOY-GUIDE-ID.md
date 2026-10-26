# Panduan Lengkap Deploy `po-pilot-mcp` ($0 Modal Awal)

Semua file konfigurasi deploy sudah siap di root repo ini (`package.json`, `Dockerfile`, `docker-compose.yml`, `mcpize.yaml`, `smithery.yaml`, `glama.json`, `server.json`, dan `.github/workflows/publish-mcp.yml`).

Ikuti urutan **6 langkah** di bawah ini karena beberapa registry saling membutuhkan (misalnya: **Official MCP Registry** mewajibkan paket sudah tayang di **npm** terlebih dahulu, sedangkan **Glama/Smithery/MCPize** membaca branch **`main`** di GitHub).

---

## Langkah 1: Push & Merge ke Branch `main` di GitHub

Saat ini seluruh kode berada di working branch Arena (`arena/c9d6d95d-po-pilot-mcp`). Agar marketplace membaca kode Anda dari repo publik `https://github.com/maskchanel14-source/po-pilot-mcp`:

1. Commit & push branch ini lalu buat Pull Request ke `main` (bisa minta saya jalankan langsung di chat ini: *"tolong commit, push, dan buat/merge PR ke main"*).
2. Pastikan repo GitHub berstatus **Public** agar skor inspeksi Glama, Smithery, dan GitHub OIDC berjalan gratis.

---

## Langkah 2: Publish ke `npm` (Agar User Bisa `npx -y po-pilot-mcp`)

Ada **2 cara** (pilih salah satu):

### Cara A — Otomatis Lewat GitHub Actions (Sekalian Tembus Official MCP Registry!)
1. Buat akun gratis di [npmjs.com](https://www.npmjs.com) → buka **Access Tokens** → **Generate New Token (Granular Access Token)** dengan izin *Read and write* untuk semua paket (tanpa 2FA prompt untuk CI).
2. Buka GitHub repo `maskchanel14-source/po-pilot-mcp` → **Settings → Secrets and variables → Actions → New repository secret**:
   - Name: `NPM_TOKEN`
   - Value: *(paste token npm Anda)*
3. Di terminal lokal Anda (setelah pull `main`), dorong tag rilis `v1.0.0`:
   ```bash
   git checkout main && git pull
   git tag v1.0.0
   git push origin v1.0.0
   ```
   GitHub Actions (`.github/workflows/publish-mcp.yml`) akan otomatis menjalankan `npm test`, merilis `po-pilot-mcp@1.0.0` ke **npm**, sekaligus mempublikasikan `server.json` ke **Official MCP Registry (`registry.modelcontextprotocol.io`)** menggunakan GitHub OIDC tanpa perlu instal CLI tambahan!

### Cara B — Manual dari Terminal Laptop
```bash
npm login
npm test
npm publish --access public
```
*(Catatan Keamanan Penting: **JANGAN** jalankan `npm i -g mcp-publisher` dari npm karena paket bernama `mcp-publisher` di npm adalah paket pihak ketiga Rusia yang tidak ada hubungannya dengan Anthropic/MCP! Untuk Official MCP Registry, gunakan workflow GitHub Actions pada Cara A atau unduh binary resmi dari `https://github.com/modelcontextprotocol/registry/releases`).*

---

## Langkah 3: Deploy & Monetisasi ke MCPize Cloud (Free + Pro $19/bln + USDC `x402`)

File `mcpize.yaml` sudah terkonfigurasi dengan tier **Free Sandbox (15 req/bln)**, **Pro ($19/bln — 300 req/bln)**, dan **Agency ($59/bln — 2.500 req/bln)**, sementara mode lokal mengunci lembut di **25 SKU/panggilan** (kecuali memiliki `PO_PILOT_LICENSE_KEY` dari Polar.sh $49 atau `scripts/mint-license.mjs`).

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
```bash
npm install -g @smithery/cli
smithery login
smithery deploy
```
*(Atau buka `https://smithery.ai/new` → pilih repo `maskchanel14-source/po-pilot-mcp` → Deploy).*

---

## Langkah 5: Deploy Endpoint HTTP untuk Workflow n8n (Cloud Gratis / VPS / Klien $950)

Kedua template n8n di `sales-bundle/n8n-templates/` memanggil endpoint Streamable HTTP `POST /mcp`. Anda punya **2 opsi gratis/murah**:

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

## Langkah 6: Bungkus ZIP Produk Digital $49 untuk Polar.sh / Lemon Squeezy / Gumroad

Jalankan perintah ini di root repo untuk membuat file ZIP siap upload ke Polar.sh, Lemon Squeezy, dan Gumroad:

```bash
zip -r po-pilot-post-stocky-kit-v1.0.0.zip \
  README.md LICENSE .env.example Dockerfile docker-compose.yml \
  package.json tsconfig.json src/ \
  sales-bundle/n8n-templates/
```
