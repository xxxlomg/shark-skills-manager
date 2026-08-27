---
name: skills-shark-quickstart
description: "First-run guide for shark skills: configure scan sources, browse and search skills, set up an LLM, and produce bilingual (EN/ZH) translations. Use when a user opens shark skills for the first time or asks how to scan, view, or translate Agent Skills."
metadata:
  skills_shark:
    emoji: "🦈"
---

# shark skills Quickstart

shark skills is a desktop app that unifies the Agent Skills scattered across your AI tools (QwenPaw, Claude Code, Cursor, Aider, ...). Three verbs: **understand** (bilingual translation), **organize** (multi-source scan, search, status), **share** (Skill Packs).

## 1. First Launch

- A built-in source (`builtin`) is preconfigured and enabled; it contains these guide skills. Try translating this very skill to experience the core workflow.
- Common local skill directories are auto-detected. Review them under **Settings → Scan Sources**.

## 2. Scan Sources

**Settings → Scan Sources**:

1. Click **Add**, choose a directory that contains skill folders (each folder holds a `SKILL.md`).
2. Give it a short **label** — the home page groups skills by this label.
3. Toggle **enabled** per source. Deleted directories are marked automatically on the next sync.

The **Imported** library (skills installed from zips, Git URLs, or Packs) is scanned automatically.

## 3. Browse & Search

- **Home → category cards** group skills by source label; open one to list its skills.
- Toggle **grid / list** layout (top right); the choice is remembered.
- Collections (nested skill folders) collapse/expand; searching auto-expands matches.
- **Ctrl+K** opens global search across names (original and Chinese), titles, and descriptions.
- Click any skill card to open the **detail drawer** with the full `SKILL.md`.

## 4. Translation Setup

Translation calls an **OpenAI-compatible** chat API directly from your machine:

1. **Settings → LLM**: enter **Base URL**, **API Key**, **Model**.
2. Click **Test Connection** (sends a 5-token probe, 15s timeout) before saving.
3. The key stays on your machine (local config file) and is masked in the UI.

## 5. Translate a Skill

1. Open a skill's detail drawer, click **Translate**.
2. Text streams in live (large files are chunked automatically).
3. Result: a bilingual side-by-side view; Chinese title and description are derived automatically and shown on cards.

Incremental by design: the original's hash is stored with each translation. Unchanged sources are skipped; changed sources are flagged **stale** so you can re-translate. Status badges: **translated / stale / not translated**.

## 6. Your Data

Everything lives in one system data directory, separate from the app binaries — reinstalling or upgrading never loses data:

- Windows: `%AppData%\shark\shark-skills-manager`
- Contents: `config.json` (scan paths, LLM settings), `translations/`, `packs/`, `imported/`

## 7. Appearance

Top-bar controls switch **dark / light** theme and **four accent presets** instantly; both persist.

## Troubleshooting

- **SmartScreen warns on first launch** — the build is unsigned; choose *More info → Run anyway*.
- **Translate button does nothing / errors** — LLM not configured or connection test failing; re-check Base URL (no trailing `chat/completions`), Key, and Model.
- **A skill disappeared** — its source folder was deleted or the source is disabled; check Settings → Scan Sources, then sync.
