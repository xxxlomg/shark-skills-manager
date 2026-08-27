#!/usr/bin/env python3
"""Validate a skill folder against the core structure rules.

Checks (ecosystem-agnostic, mirrors the standard Agent Skills core rules):
  - SKILL.md exists with YAML frontmatter containing name + description
  - name matches lowercase/letters/digits/hyphens convention and equals dir name
  - description is non-empty and mentions WHAT/WHEN
  - resource dirs (references/scripts/assets) referenced correctly
  - links inside SKILL.md to local files resolve to existing files
  - SKILL.md body stays reasonably lean (<500 lines, warning only)

Exit code: 0 = pass (errors=0), 1 = validation errors found, 2 = usage error.

Usage:
    python validate_skill.py <skill-dir>
"""

import argparse
import re
import sys
from pathlib import Path

NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$")
MAX_BODY_LINES = 500
MAX_DESC_LEN = 1024


def parse_frontmatter(text: str):
    """Return (frontmatter_dict, body_lines). None frontmatter if malformed."""
    if not text.startswith("---"):
        return None, text.splitlines()
    end = text.find("\n---", 3)
    if end == -1:
        return None, text.splitlines()
    fm_block = text[3:end]
    body = text[end + 4 :]
    fm: dict = {}
    for line in fm_block.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        fm[key.strip()] = value.strip().strip("'\"")
    return fm, body.splitlines()


def check_name(name: str) -> list:
    errs = []
    if not name:
        errs.append("name: empty")
    elif len(name) > 64:
        errs.append(f"name: too long ({len(name)} > 64)")
    elif not NAME_RE.match(name):
        errs.append(f"name: invalid ({name!r}; lowercase letters/digits/hyphens only)")
    return errs


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate a skill folder.")
    parser.add_argument("skill_dir", help="path to the skill folder")
    args = parser.parse_args()

    root = Path(args.skill_dir).expanduser().resolve()
    if not root.is_dir():
        print(f"error: not a directory: {root}", file=sys.stderr)
        sys.exit(2)

    errors: list = []
    warnings: list = []
    infos: list = []

    skill_md = root / "SKILL.md"
    if not skill_md.is_file():
        errors.append("SKILL.md: missing (required entry file)")
        _report(root.name, errors, warnings, infos)
        sys.exit(1)

    text = skill_md.read_text(encoding="utf-8-sig")
    fm, body_lines = parse_frontmatter(text)
    if fm is None:
        errors.append("SKILL.md: frontmatter missing or malformed (must start with --- ... ---)")
    else:
        name = fm.get("name", "")
        desc = fm.get("description", "")
        errors += [f"frontmatter: {e}" for e in check_name(name)]
        if root.name != name:
            warnings.append(f"name: folder {root.name!r} != frontmatter name {name!r}")
        if not desc:
            errors.append("description: empty (required for discovery/triggering)")
        else:
            if len(desc) > MAX_DESC_LEN:
                warnings.append(f"description: very long ({len(desc)} > {MAX_DESC_LEN} chars)")
            if not re.search(r"[Ww]hen|use|触发|使用|when", desc):
                warnings.append("description: no obvious WHEN/trigger wording found")

    if len(body_lines) > MAX_BODY_LINES:
        warnings.append(f"SKILL.md: body has {len(body_lines)} lines (keep < {MAX_BODY_LINES}; "
                        "externalize deep knowledge to references/)")

    # Local markdown links must resolve.
    for m in re.finditer(r"\]\(([^)]+)\)", text):
        target = m.group(1)
        if target.startswith(("http://", "https://", "#", "mailto:")):
            continue
        path_part = target.split("#")[0].split("?")[0]
        if not path_part:
            continue
        candidate = (root / path_part).resolve()
        if not candidate.exists():
            errors.append(f"SKILL.md: broken local link -> {target!r}")

    # Resource dirs: warn when present but unreferenced.
    for d in ("references", "scripts", "assets"):
        if (root / d).is_dir():
            if d not in text:
                warnings.append(f"{d}/: directory exists but is never referenced in SKILL.md")
        else:
            infos.append(f"{d}/: not present (fine if not needed)")

    _report(root.name, errors, warnings, infos)
    sys.exit(1 if errors else 0)


def _report(name: str, errors: list, warnings: list, infos: list) -> None:
    print(f"skill: {name}")
    for e in errors:
        print(f"  [error]   {e}")
    for w in warnings:
        print(f"  [warning] {w}")
    for i in infos:
        print(f"  [info]    {i}")
    print(f"result: {'FAIL' if errors else ('PASS with warnings' if warnings else 'PASS')} "
          f"({len(errors)} errors, {len(warnings)} warnings)")


if __name__ == "__main__":
    main()
