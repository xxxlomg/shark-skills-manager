#!/usr/bin/env bash
# ===========================================================================
#  SkillsShark portable build script (green / unzip-and-run) - macOS / Linux
#  Output :
#    macOS : dist-portable/SkillsShark_<version>_macos.zip
#            SkillsShark.app + skills/ side by side, double-click to run
#    Linux : dist-portable/SkillsShark_<version>_linux-x86_64.zip
#            skills-shark + skills/ side by side, chmod +x then run
#
#  ASCII-only on purpose (same as the .bat sibling): keeps the script safe
#  under any locale. Linux uses --no-bundle to get the raw binary; macOS uses
#  --bundles app to get a double-clickable .app (add bundle.macOS config if
#  you need signing / notarization).
# ===========================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTROOT="$ROOT/dist-portable"
OUT="$OUTROOT/SkillsShark"

# --- read version (tauri.conf.json.version) ---
VERSION="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ROOT/src-tauri/tauri.conf.json" | head -n1)"
[ -n "$VERSION" ] || { echo "[ERROR] cannot read version" >&2; exit 1; }

OS="$(uname -s)"
case "$OS" in
  Darwin*)
    PLAT="macos"
    echo "=== [1/3] building release (npx tauri build --bundles app) ==="
    ( cd "$ROOT" && npx tauri build --bundles app )
    APP="$ROOT/src-tauri/target/release/bundle/macos/SkillsShark.app"
    [ -d "$APP" ] || { echo "[ERROR] .app not found: $APP" >&2; exit 1; }
    echo "=== [2/3] assembling portable directory ==="
    rm -rf "$OUT"; mkdir -p "$OUT"
    cp -R "$APP" "$OUT/"
    cp -R "$ROOT/skills" "$OUT/skills"
    ;;
  Linux*)
    PLAT="linux-x86_64"
    echo "=== [1/3] building release (npx tauri build --no-bundle) ==="
    ( cd "$ROOT" && npx tauri build --no-bundle )
    BIN="$ROOT/src-tauri/target/release/skills-shark"
    [ -x "$BIN" ] || { echo "[ERROR] binary not found: $BIN" >&2; exit 1; }
    echo "=== [2/3] assembling portable directory ==="
    rm -rf "$OUT"; mkdir -p "$OUT"
    cp "$BIN" "$OUT/skills-shark"
    cp -R "$ROOT/skills" "$OUT/skills"
    ;;
  *)
    echo "[ERROR] unsupported platform: $OS" >&2
    exit 1
    ;;
esac

ZIP="$OUTROOT/SkillsShark_${VERSION}_${PLAT}.zip"

echo "=== [3/3] packing zip ==="
rm -f "$ZIP"
if command -v zip >/dev/null 2>&1; then
  ( cd "$OUTROOT" && zip -r -q "$(basename "$ZIP")" SkillsShark )
else
  python3 -m zipfile -c "$ZIP" "$OUT"
fi

echo ""
echo "Done: $ZIP"
echo "Extracted layout:"
echo "  SkillsShark/{"
if [ "$OS" = "Darwin" ]; then
  echo "    SkillsShark.app    <- double-click to run"
else
  echo "    skills-shark       <- chmod +x skills-shark, then ./skills-shark"
fi
echo "    skills/             <- built-in sample skills (editable)"
echo "  }"