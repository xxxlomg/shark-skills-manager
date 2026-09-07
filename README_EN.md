# shark skills

<p align="center">
  <img src="src/assets/brand/fin-light.png" width="48" height="48" alt="shark skills">
</p>

<p align="center"><strong>A local desktop tool to scan, translate, manage, and package Agent Skills — read them at a glance, use them with ease.</strong></p>

<p align="center">Shark means keen, precise, and fast. shark skills gathers the skills scattered across your AI tools in one place: understand them (streaming bilingual Chinese–English translations), manage them (categorize / search / track status), and share them (package as <code>.skillpack</code> files for circulation between tools).</p>

<p align="center">
  <a href="README.md">简体中文</a> |
  <a href="https://gitee.com/xxxlomg/shark-skills-manager">Gitee</a>
</p>

**Official release**: [gitee.com/xxxlomg/shark-skills-manager](https://gitee.com/xxxlomg/shark-skills-manager) · Current distribution: **Windows x64 portable build** (`shark-skills-manager.exe` sits next to `skills/`; no installation needed).

## What It Does

- **Multi-source scanning** — configure multiple skills directories (path / label / enable toggle) and scan them together, grouped by label; deletions in source directories are detected and flagged automatically.
- **Streaming translation** — calls an OpenAI-compatible LLM API to generate bilingual Chinese–English renderings in real time; large files are chunked automatically and unchanged sources are skipped via a content hash.
- **Browsing views** — three-level navigation (home categories → category detail → detail drawer), grid/list layouts, nested collection folding, and a global `Ctrl+K` search.
- **Hub reference ledger** — manages links/copies between skills and each AI tool in one place: source → destination visibility with health status; batch link / unlink.
- **Skill Packs** — select skills and pack them into `.skillpack` bundles; import / export / install / rename; each pack ships `pack.json` + `README.md` + a translation sidecar.
- **Import pipeline** — two sources, local zip and Git URL; safe pre-extract preview; nested folders flattened and name collisions auto-renamed on commit.
- **Creation Workbench** — an immersive, full-page skill authoring flow with seven stages (Discover → Scope → Model → Design → Generate → Evaluate → Package), Markdown editing / split panes / preview, a built-in asset editor with template library and AI writing help, and one-click generation of real `references/scripts` attachments from the draft body.
- **AI-assisted authoring** — the model streams SKILL.md drafts in the left-hand conversation pane; you can append, rewrite, or adopt the result as your body.
- **Unified AI layer** — translation, AI authoring, and connection tests all share the LLM configuration from the settings page; prompts live in one place under `src/lib/ai/prompts/`.
- **Layout & appearance** — top bar ↔ sidebar modes; sidebar skill tree; dark/light themes plus four accent presets.
- **Externalized data** — configuration, translations, Packs, and the import library live in the system data directory; reinstalls keep your data and old directories migrate automatically.

## How It Works

```text
Your skills across AI tools
  -> multi-source scan (paths + labels)
  -> browse / categorize / search
  -> streaming bilingual translation (chunked + content-hash incremental)
  -> Hub references into tool skills directories (junction / copy / move)
  -> .skillpack export / import / install
  -> Creation Workbench for new skills
```

## Installation & Running

### Portable build (recommended, current release form)

1. Download `shark-skills-manager_<version>_win64.zip` from the [official release page](https://gitee.com/xxxlomg/shark-skills-manager);
2. Unzip and enter `shark-skills-manager/`, then double-click `shark-skills-manager.exe`;
3. If Windows shows “Windows protected your PC”: click **More info → Run anyway** (normal prompt for an unsigned portable app).

### Building from source

Requirements: Node 18+, a stable Rust toolchain (with Tauri [platform prerequisites](https://v2.tauri.app/start/prerequisites/)).

```bash
npm install
npm run tauri:dev      # desktop dev mode (front-end HMR + Rust hot reload)
```

Front-end only preview (no backend, mock data):

```bash
npm run dev
# open http://localhost:5173/?mock=1 in a browser
```

Production build:

```bash
npm run tauri:build    # Windows .exe / macOS .dmg / Linux .AppImage
scripts/build-portable.bat   # Windows portable package -> dist-portable/
scripts/build-portable.sh    # macOS / Linux portable package
```

Rust unit tests:

```bash
cd src-tauri
cargo test
```

## Architecture Overview

### Tech stack

| Layer | Technology |
| --- | --- |
| Desktop framework | Tauri 2 (Rust) |
| Front end | React 19 + TypeScript |
| Build tooling | Vite 8 |
| Styling | Tailwind CSS v4 + shadcn/ui (Radix) |
| Icons / notifications | lucide-react / sonner |

### Directory layout

```
shark-skills-manager/
├── src/                  # React front end
│   ├── components/       #   ui / layout / skill / settings / common
│   ├── hooks/            #   data loading and state
│   ├── lib/              #   api wrappers / translation / AI layer / markdown …
│   ├── assets/brand/     #   brand asset pipeline
│   ├── App.tsx           #   main app and global state
│   └── index.css         #   theme variables + accent presets
├── src-tauri/            # Rust backend (scanner / translations / pack / import / authoring, incl. unit tests)
├── public/               # static assets (favicon / bundled example skills)
├── skills/               # example skills + built-in assets (shipped, hidden from scan)
├── scripts/              # portable packaging scripts + merge unit tests
└── docs/                 # design-tracking docs (PLAN-*.md, not committed)
```

## Configuration

All configuration happens inside the app’s **Settings** panel and is persisted to the system data directory (see below). **API keys are stored locally only.**

| Setting | Description |
| --- | --- |
| **Scan paths** | Add skills directories of multiple AI tools with custom labels and enable toggles; common default paths are auto-detected |
| **LLM** | OpenAI-compatible endpoint: `api_key` / `base_url` / `model`; the **Test connection** button verifies it instantly |
| **Thinking mode** | On/off (default off) with effort levels `low` / `high` / `max` (default `low`); sent only to DeepSeek endpoints (ignored by other endpoints) |
| **Appearance** | Top bar / sidebar layout; dark / light theme and accent colors switch instantly and persist |
| **Download / import folders** | Custom target directories for Pack export and skill import |

## Skillpack: Install & Create

**Installing a pack**: import a `.skillpack` from the Packs page, or simply drag `.skillpack` / `.zip` files into the app window. Imports run three checks:

- **Version gate** — rejected when the pack’s `format_version` is newer than the app supports;
- **sha256 self-verification** — every file listed in the manifest is hashed; any mismatch rejects the whole pack;
- **No overwrite** — id conflicts with existing packs are auto-renamed; existing packs are never touched.

After import the pack lands in the Packs library; click **Install** to materialize it into the skill library (`imported/<pack-name>/`, with a `.import.json` source record), where you can browse / translate / reference it into each AI tool.

**Creating & exporting**: Packs page → **New Pack** → select skills from the whole library (max 40 per pack) → generates `pack.json` metadata and a `README.md` → **Export** produces a shareable `.skillpack` file.

**Deleting**: removes only the pack itself and does **not** affect already-installed copies in the skill library or existing Hub references.

## Data Directory

Runtime data is kept separate from the code, in the system data directory (Windows: `%AppData%\shark\shark-skills-manager`):

```
shark-skills-manager/
├── config.json          # scan paths / LLM config (stored locally only)
├── translations.json    # translation index
├── translations/        # bilingual translation files
├── sessions/            # authoring session JSONL logs + body-mapping index
├── packs/               # created Skill Packs
└── imported/            # skills installed from zip / URL / Pack
```

On first launch, legacy data directories are migrated and self-verified automatically.

## FAQ

**Q: Translation doesn’t work / “API key not configured”?**
A: Fill in an OpenAI-compatible `api_key` / `base_url` / `model` under Settings → LLM, and confirm with **Test connection** before translating.

**Q: Windows says “Windows protected your PC”?**
A: The portable build is unsigned, which is normal. Click **More info → Run anyway**.

**Q: Where do skills come from?**
A: Three sources: ① scan paths configured in Settings (existing local skills directories); ② the import pipeline (zip / Git URL; the Packs page can also import `.skillpack`); ③ skills you create in the Creation Workbench.

**Q: Does deleting a skill lose files?**
A: No. Batch deletions are fully backed up to `merge-backups` first and then moved to the system **Recycle Bin** (recoverable); skills referenced by the Hub go through “unlink” (a two-step delete that never physically removes files).

**Q: Where are config and data stored? Do reinstalls lose them?**
A: In the system data directory (Windows: `%AppData%\shark\shark-skills-manager`), separate from the program itself — reinstalling or moving the portable folder keeps your data.

**Q: How do skills reach Claude Code / Codex CLI and similar tools?**
A: Use the **Reference** button in the detail drawer or **New reference** on the Hub page — choose link (junction, recommended) / copy / move to place the skill into a registered tool’s skills directory; references are managed centrally in the Hub.

## Contributing

Developed by xxxlomg for learning and personal use.
For issues and suggestions, please open one at the [official release page](https://gitee.com/xxxlomg/shark-skills-manager).

## License

Licensed under the **Apache License 2.0**. See the [LICENSE](LICENSE) file for details.
