# UI Design System — Raycast / Linear Developer Console

## 1. Visual Identity & Aesthetic Direction
Design the frontend as a high-precision **Developer Console** inspired by **Raycast** and **Linear**, featuring a seamless **Dark / Light Mode toggle** (Dark Mode default) and **i18n localization** (`en.json` default, `id.json` included, switcher in top header).

### Color Tokens (CSS Variables)
| Token | Dark Mode (Default) | Light Mode | Usage |
| :--- | :--- | :--- | :--- |
| `--bg-canvas` | `#0A0B0E` | `#F8F9FB` | Main viewport background |
| `--bg-surface` | `#12141A` | `#FFFFFF` | Cards, tables, drawers |
| `--bg-elevated` | `#181B23` | `#F1F3F7` | Hover states, inputs, command palette |
| `--border-hairline` | `rgba(255, 255, 255, 0.08)` | `rgba(15, 23, 42, 0.09)` | 1px structural borders (no heavy drop shadows) |
| `--text-primary` | `#F3F4F6` | `#0F172A` | Primary headings & content |
| `--text-secondary` | `#8E95A5` | `#475569` | Labels, metadata, subtitles |
| `--accent-primary` | `#6366F1` (Indigo) | `#4F46E5` | Primary actions, active nav indicator |
| `--status-active` | `#10B981` (Emerald) | `#059669` | `active` status, connection healthy |
| `--status-superseded` | `#F59E0B` (Amber) | `#D97706` | `superseded` history state |
| `--status-procedural` | `#A855F7` (Purple) | `#9333EA` | `procedural` rule badge |

### Typography & Micro-Details
- **UI Sans:** `Inter, -apple-system, BlinkMacSystemFont, sans-serif`
- **Data Monospace:** `JetBrains Mono, Fira Code, monospace` — mandatory for similarity scores (`0.924`), token counts (`1,840 -> 240 tok`), latencies (`14ms`), vector dimensions (`1536d`), and memory IDs.
- **Zero Visual Clutter:** Use `1px solid var(--border-hairline)` dividers instead of heavy shadows. Keep corner radii crisp (`6px` buttons/inputs, `8px` cards).

---

## 2. Global Navigation & Command Palette (`Cmd/Ctrl + K`)
- **Left Sidebar (220px collapsible):** Workspace switcher dropdown (`All Workspaces`, `global`, `hermes`, etc.) + 5 navigation tabs + bottom status pill showing active Embedding Mode (`External API` or `Local ONNX`) and RAM usage.
- **Top Header (48px):** Breadcrumb title, `Cmd/Ctrl + K` quick-search trigger button, Language toggle (`EN` / `ID`), and Theme toggle (`Dark` / `Light`).
- **Command Palette Modal (`Cmd/Ctrl + K`):** Keyboard-navigable overlay allowing instant jump to any tab, quick semantic memory search, triggering `Re-index`, or opening `Bulk Seed Rules`.

---

## 3. Five Core Views

### View 1: Overview & Telemetry
- **4 KPI Cards:** Active Memories, Token Compression Savings (`%` + total tokens saved), Avg Retrieval Latency (`ms`), Background Worker Queue Depth.
- **Token Efficiency Chart:** Clean SVG/Canvas area/bar chart comparing `Raw Tokens` vs. `Distilled Tokens` over recent queries.
- **Recent Procedural Rules Feed:** Quick list of latest learned anti-patterns/rules.

### View 2: Memory Explorer (with Temporal Rollback & Import/Export)
- **Toolbar:** Search input, Workspace filter, Type filter (`All`, `Semantic`, `Procedural`, `Episodic`), Status filter (`Active`, `Superseded`), plus **Import / Bulk Seed** button and **Export JSON** button.
- **Data Table:** Displays content preview, Workspace pill, Type badge, Source provenance (`user_explicit`, `tool_error`, etc.), Confidence monospace pill, Pin toggle icon, and Actions (`Edit`, `History`, `Delete`).
- **Temporal Diff & 1-Click Rollback Drawer:** Opens on `superseded` memories, showing side-by-side comparison of old vs. new content, superseding reason, and a **Rollback to This Version** button.
- **Import / Bulk Seed Modal:** Two tabs—(1) Upload `.json` backup file, (2) Paste multiline rules/facts (one per line or markdown bullets) with target `Workspace` selector and `Auto-Pin All` checkbox.

### View 3: Knowledge Graph Visualizer
- Interactive HTML5 Canvas / SVG force-directed graph (zero fragile external graph libraries) rendering `entities` as nodes and `edges` as labeled directional links.
- Filterable by `workspace`. Clicking any node opens a right-hand inspector drawer listing all connected entities and linked memories.

### View 4: Retrieval Playground & Token Debugger
- Input box for test query + `Workspace` selector + `Distill Context` toggle + `top_k` slider.
- **Split Results View:**
  - **Left:** Distilled output preview (exact text sent to the AI Agent) + token badge (`e.g., 1,920 raw -> 265 distilled (-86%)`).
  - **Right:** Ranked memory cards showing exact score breakdown bars (`Vector`, `Graph Boost`, `Recency`, `Confidence`).

### View 5: Settings & Provider Config
- **Card 1 — Reasoning & Distillation LLM:** `Base URL`, `API Key` (masked), `Fast Model Name` (e.g., `gemini-2.5-flash`), plus `Test LLM` button.
- **Card 2 — Embedding Provider (Zero-RAM Switcher):**
  - Segmented toggle: `External API (Custom / 9Router)` vs. `Local In-Container (FastEmbed)`.
  - Conditional fields + **"Test Connection & Detect Dimension"** button displaying latency and detected dimension (e.g., `Connected • 118ms • 1536d`).
  - Warning banner if detected dimension differs from current `vec_memories` table dimension, paired with **"Re-index All Memories"** button and live progress bar.
- **Card 3 — Automation & Ingestion:** Toggle switch for **Auto-Ingest Webhook (`/api/v1/ingest`)** showing the endpoint URL and copyable `curl` example when enabled.
