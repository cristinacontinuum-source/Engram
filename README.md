# Engram — Agent Memory Hub & MCP Console

**Engram** adalah *single-container AI Memory Engine* dan konsol observabilitas berbasis web untuk agen AI (seperti **Hermes Agent**, **Claude Desktop**, **Claude Code**, **Cursor**, **Windsurf**, dan **Continue**). Engram menggabungkan penyimpanan vektor `sqlite-vec`, **Knowledge Graph 1-hop**, **bi-temporal memory versioning**, *auto-redaction* kredensial sensitif, dan **Dual-Transport MCP Server** (Streamable HTTP + Legacy SSE) dalam satu layanan ringan.

---

## Fitur Utama

- **Dual-Transport MCP Server**: Mendukung **Streamable HTTP (`/mcp`)** dan **Legacy SSE (`/sse` + `/messages`)** di port tunggal (`8080`).
- **4 MCP Tools & 2 MCP Resources**:
  - Tools: `recall_memory`, `store_memory`, `learn_from_mistake`, `supersede_memory`.
  - Resources: `memory://core-directives/{workspace}` dan `memory://session-summary/{workspace}`.
- **Hybrid Recall Engine + Context Distillation**: Peringkat gabungan (`Vector + 1-hop Graph + Recency + Confidence + Pinned`) dengan kompresi konteks via Fast LLM untuk menghemat pemakaian token.
- **Zero-RAM Embedding Switcher**:
  - **External API** *(default — 0 MB RAM lokal)*: terhubung ke `9Router`, OpenAI, Ollama, atau endpoint OpenAI-kompatibel lainnya.
  - **Local In-Container (FastEmbed ONNX)**: dimuat *lazy* ke RAM hanya saat aktif dan otomatis dilepas (`gc.collect()`) saat beralih kembali ke mode eksternal.
- **Smart Model Autocomplete (`/models`)**: Di halaman **Settings**, kolom **Fast Model Name** dan **Embedding Model Name** otomatis mengambil daftar model yang tersedia dari *Base URL* terkonfigurasi serta menyesuaikan **Vector Dimension** secara otomatis.
- **Konsol Observabilitas Lengkap (EN / ID, Dark & Light Mode)**:
  - **Overview**: KPI memori, penghematan token, status worker & indeks vektor.
  - **Knowledge Graph**: Visualisasi interaktif relasi entitas (*entity-relation triples*).
  - **Memory Explorer**: Cari, pin, edit, hapus, lihat riwayat bi-temporal (*supersede chain*), serta **Bulk Seed / JSON Import & Backup Export**.
  - **Core Directives**: Kelola aturan wajib & anti-pola `learn_from_mistake` serta pratinjau token injeksi MCP.
  - **Retrieval Playground**: Uji kueri *hybrid recall* dan bandingkan token mentah vs terdistilasi.
  - **Worker Activity**: Pantau antrean `asyncio.Queue`, *TTL cleanup*, dan *secret redaction*.
  - **Hygiene & Conflicts**: Audit konflik memori, duplikat, memori kedaluwarsa/usang, lalu gabungkan (*merge*) atau arsipkan.
  - **Token & Cost Analytics**: Proyeksi penghematan biaya (USD) per model & workspace + ekspor CSV.
  - **MCP Integrations**: Generator konfigurasi siap tempel untuk **Hermes Agent**, **Claude Desktop**, **Claude Code CLI**, **Cursor**, **Windsurf**, dan **Continue**, lengkap dengan *Endpoint Probe*.

---

## Arsitektur & Batas Keamanan (Dual-Auth)

Semua trafik dilayani melalui satu port (`8080` pada Docker / produksi) dengan pemisahan otentikasi ketat:

| Endpoint | Autentikasi | Fungsi |
| :--- | :--- | :--- |
| `GET /health` | Publik (tanpa auth) | Healthcheck Docker / load balancer |
| `/mcp`, `/sse`, `/messages` | `Authorization: Bearer <MCP_API_KEY>` | Transport MCP untuk agen AI & IDE |
| `POST /api/v1/ingest` | Bearer Token (`MCP_API_KEY`) atau Basic Auth | Webhook ekstraksi transkrip percakapan *(opsional, HTTP 403 bila nonaktif)* |
| `/*` & `/api/v1/*` | HTTP Basic Auth (`DASHBOARD_USER` / `DASHBOARD_PASS`) | Web Console & REST API manajemen |

---

## Persyaratan Sistem

- **Docker Engine** & **Docker Compose v2+** *(untuk deployment kontainer yang direkomendasikan)*.
- **Untuk instalasi lokal tanpa Docker**:
  - **Python 3.12+** (dengan `pip` & `venv`)
  - **Node.js 20+** & **npm**

---

## Cara Install & Menjalankan

### Opsi 1: Menggunakan Docker Compose (Direkomendasikan)

1. **Salin file konfigurasi `.env`** dari template yang sudah disediakan:

   ```bash
   cp .env.example .env
   ```

2. **Sesuaikan `.env`** (minimal ubah token & kredensial provider LLM/Embedding Anda):
   - Jika `9router` / Ollama berjalan di host (bukan dalam *docker network* yang sama), gunakan `http://host.docker.internal:20128/v1` (atau `http://host.docker.internal:11434/v1` untuk Ollama).
   - Pastikan `MCP_API_KEY`, `DASHBOARD_USER`, dan `DASHBOARD_PASS` diubah sebelum dipakai di produksi.

3. **Build dan jalankan kontainer di background**:

   ```bash
   docker compose up -d --build
   ```

4. **Verifikasi layanan berjalan sehat**:

   ```bash
   curl http://localhost:8080/health
   ```

5. **Buka Web Console** di browser:
   - URL: `http://localhost:8080`
   - Login HTTP Basic Auth menggunakan `DASHBOARD_USER` dan `DASHBOARD_PASS` dari `.env` (bawaan: `admin` / `admin123`).
   - Data SQLite (`memory.db`) dan cache model lokal tersimpan persisten di folder `./memory-data` pada host.

---

### Opsi 2: Menggunakan Docker CLI Manual (`docker build` & `docker run`)

Jika tidak menggunakan `docker compose`:

```bash
# 1. Build image multi-stage (Frontend Vite + Backend FastAPI)
docker build -t engram:latest .

# 2. Buat folder penyimpanan persisten di host
mkdir -p ./memory-data

# 3. Jalankan container
docker run -d \
  --name agent-memory \
  --restart unless-stopped \
  -p 8080:8080 \
  -v "$(pwd)/memory-data:/data" \
  -e LLM_BASE_URL="http://host.docker.internal:20128/v1" \
  -e LLM_API_KEY="sk-your-key" \
  -e FAST_MODEL="gemini-2.5-flash" \
  -e EMBEDDING_MODE="external" \
  -e EMBEDDING_BASE_URL="http://host.docker.internal:20128/v1" \
  -e EMBEDDING_API_KEY="sk-your-key" \
  -e EMBEDDING_MODEL="text-embedding-3-small" \
  -e EMBEDDING_DIMENSION="1536" \
  -e MCP_API_KEY="sk-mem-hermes-secret" \
  -e DASHBOARD_USER="admin" \
  -e DASHBOARD_PASS="admin123" \
  engram:latest
```

Untuk melihat log container atau menghentikan layanan:

```bash
docker logs -f agent-memory
docker stop agent-memory && docker rm agent-memory
```

---

### Opsi 3: Instalasi Lokal (Tanpa Docker / Mode Development)

#### A. Menjalankan Backend FastAPI (`port 8080`)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Atur path penyimpanan lokal agar tidak menulis ke /data root
export DB_PATH="$(pwd)/../memory-data/memory.db"
export LOCAL_MODELS_DIR="$(pwd)/../memory-data/models"
mkdir -p ../memory-data/models

uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload
```

#### B. Menjalankan Frontend Web Console

1. **Mode Produksi (disajikan langsung oleh FastAPI di `http://localhost:8080`)**:

   ```bash
   npm install
   npm run build
   mkdir -p backend/static
   cp -r dist/* backend/static/
   ```

2. **Mode Development UI (`port 3000`)**:

   ```bash
   npm install
   npm run dev
   ```

   > Catatan: Secara bawaan pada port `3000` (tanpa backend), UI berjalan dalam mode pratinjau mandiri menggunakan data demo & `localStorage`. Untuk menyambungkan dev server UI port `3000` ke backend FastAPI, aktifkan proxy/env `VITE_ENABLE_BACKEND_PROXY=true`.

#### C. Menjalankan Unit Test & Pemeriksaan Tipe

```bash
# Jalankan seluruh unit test logika murni
npx --yes tsx --test src/utils/*.test.ts src/utils/__tests__/*.test.ts

# Type check TypeScript & build check
npm run lint
npm run build
```

---

## Referensi Variabel Lingkungan (`.env`)

| Variabel | Default | Keterangan |
| :--- | :--- | :--- |
| `DB_PATH` | `/data/memory.db` | Lokasi file SQLite + `sqlite-vec` |
| `LOCAL_MODELS_DIR` | `/data/models` | Direktori cache model FastEmbed ONNX lokal |
| `LLM_BASE_URL` | `http://9router:20128/v1` | Endpoint LLM OpenAI-kompatibel untuk distilasi & smart merge |
| `LLM_API_KEY` / `ROUTER_API_KEY` | `dummy-key` | API Key untuk provider LLM |
| `FAST_MODEL` | `gemini-2.5-flash` | ID model LLM cepat |
| `EMBEDDING_MODE` | `external` | `external` (0 MB RAM lokal) atau `local` (FastEmbed ONNX) |
| `EMBEDDING_BASE_URL` | `http://9router:20128/v1` | Endpoint embedding eksternal |
| `EMBEDDING_API_KEY` | `dummy-key` | API Key provider embedding |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Nama model embedding eksternal |
| `EMBEDDING_DIMENSION` | `1536` | Dimensi vektor aktif (`384`, `768`, `1024`, `1536`, `3072`) |
| `LOCAL_EMBEDDING_MODEL` | `intfloat/multilingual-e5-small` | Model ONNX bila `EMBEDDING_MODE=local` |
| `ENABLE_INGEST_WEBHOOK` | `false` | Mengaktifkan `POST /api/v1/ingest` (`true` = 202, `false` = 403) |
| `MCP_API_KEY` | `sk-mem-hermes-secret` | Bearer token untuk autentikasi MCP & webhook |
| `DASHBOARD_USER` | `admin` | Username HTTP Basic Auth Web Console |
| `DASHBOARD_PASS` | `admin123` | Password HTTP Basic Auth Web Console |

---

## Cara Menggunakan

### 1. Konfigurasi LLM, Embedding & Auto-Complete Model
1. Buka tab **Settings** di sidebar Web Console.
2. Pada bagian **1. Reasoning & Distillation LLM**, isi **LLM Base URL** dan **LLM API Key**.
3. Klik field **Fast Model Name** — Engram otomatis memanggil endpoint `GET /models` dari Base URL Anda dan menampilkan daftar model yang tersedia (atau ketik nama model kustom secara bebas). Klik **Test LLM Connection** untuk memverifikasi *handshake*.
4. Pada bagian **2. Embedding Provider (Zero-RAM Switcher)**:
   - Pilih **External API** (direkomendasikan agar pemakaian RAM kontainer tetap minimal) atau **Local In-Container (FastEmbed ONNX)**.
   - Saat memilih model dari autocomplete **Embedding Model Name** (mis. `text-embedding-3-small` = `1536d`, `text-embedding-3-large` = `3072d`), dimensi vektor otomatis disesuaikan.
   - Jika muncul banner **Vector Dimension Mismatch Detected**, klik **Re-index All Memories** untuk membangun ulang tabel `vec_memories` dengan aman sesuai dimensi baru.
5. Klik **Save Configuration**.

### 2. Menghubungkan Agen AI / IDE via MCP

Buka tab **MCP Integrations** di sidebar untuk memilih klien (**Hermes Agent**, **Claude Desktop**, **Claude Code CLI**, **Cursor**, **Windsurf**, atau **Continue**) dan langsung menyalin konfigurasi JSON/CLI yang sudah disesuaikan dengan workspace Anda.

Contoh konfigurasi JSON umum (**Streamable HTTP**):

```json
{
  "mcpServers": {
    "engram": {
      "type": "http",
      "url": "http://localhost:8080/mcp",
      "headers": {
        "Authorization": "Bearer sk-mem-hermes-secret"
      }
    }
  }
}
```

Untuk klien yang masih memakai **Legacy SSE**, arahkan URL ke `http://localhost:8080/sse` dengan header `Authorization: Bearer <MCP_API_KEY>`.

#### Daftar MCP Tools & Resources untuk Agen
- `recall_memory(query, workspace, top_k, distill)` — Mengambil memori relevan lintas `workspace` + `global`.
- `store_memory(content, memory_type, workspace, source, confidence, ttl_hours)` — Menyimpan fakta (`semantic`), aturan (`procedural`), atau catatan sementara (`episodic`).
- `learn_from_mistake(context, mistake_or_error, rule_learned, workspace)` — Menyimpan guardrail anti-pola (`is_pinned=True`) agar kesalahan tidak berulang.
- `supersede_memory(old_memory_id, new_content, reason, workspace)` — Mengganti memori lama dengan fakta baru secara *bi-temporal*.
- `memory://core-directives/{workspace}` & `memory://session-summary/{workspace}` — Resource injeksi konteks awal agen.

### 3. Mengisi Memori Awal & Backup
- Masuk ke **Memory Explorer** → klik **Store Memory** untuk menambah memori satu per satu, atau gunakan **Seed / Import** untuk mengimpor baris aturan/JSON sekaligus (*bulk import*).
- Klik **Export JSON** untuk mengunduh cadangan seluruh memori, entitas graf, dan relasi sesuai filter workspace aktif.

### 4. Auto-Ingest Percakapan via Webhook (`POST /api/v1/ingest`)
1. Aktifkan toggle **Enable Auto-Ingest Webhook** pada **Settings → Card 3** lalu klik **Save Configuration**.
2. Kirim transkrip percakapan dari orkestrator eksternal ke Engram:

   ```bash
   curl -X POST http://localhost:8080/api/v1/ingest \
     -H "Authorization: Bearer sk-mem-hermes-secret" \
     -H "Content-Type: application/json" \
     -d '{
       "workspace": "hermes",
       "messages": [
         {"role": "user", "content": "Selalu jalankan health probe sebelum rotasi API key."},
         {"role": "assistant", "content": "Dicatat, akan dicek ke /health terlebih dahulu."}
       ]
     }'
   ```

   Engram langsung membalas `202 Accepted` dan mengekstrak fakta ke memori secara asinkron di *background worker* sembari menyensor token rahasia secara otomatis.

---

## Troubleshooting

- **Container tidak bisa menghubungi `9router` / `Ollama` di host**:
  Jika tidak berada dalam satu jaringan Docker Compose yang sama, ganti `http://9router:20128/v1` pada `.env` atau halaman **Settings** menjadi `http://host.docker.internal:20128/v1` (atau IP host Linux Anda).
- **Muncul peringatan `Vector Dimension Mismatch Detected`**:
  Terjadi ketika Anda mengganti model embedding (misal dari `1536d` ke `3072d` atau `384d`). Klik tombol **Re-index All Memories** di **Settings** agar tabel `vec_memories` dibangun ulang sesuai dimensi baru.
- **Endpoint `/api/v1/ingest` mengembalikan `HTTP 403 Forbidden`**:
  Fitur webhook *auto-ingest* terkunci secara default demi keamanan. Aktifkan melalui halaman **Settings → Automation & Webhook Ingestion** atau set `ENABLE_INGEST_WEBHOOK=true` di `.env`.
