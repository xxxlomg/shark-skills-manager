#!/usr/bin/env python3
"""Generate a skill scaffold (SKILL.md + optional resource dirs).

Ecosystem-agnostic: only writes the core skill structure
(SKILL.md / references/ / scripts/ / assets/). Platform layers
(manifest, evals, metadata) are intentionally NOT created here.

Usage:
    python init_skill.py <skill-name> --path <output-dir> [--resources scripts,references,assets]

Examples:
    python init_skill.py springboot-startup-error-diagnosis --path ./skills
    python init_skill.py my-skill --path ./skills --resources scripts,references
"""

import argparse
import re
import sys
from pathlib import Path

NAME_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$")
RESOURCE_DIRS = ("references", "scripts", "assets")

SKILL_TEMPLATE = """---
name: {name}
description: TODO: WHAT does this skill do + WHEN to use it. Include trigger terms. (<=1024 chars)
---

# {title}

## When to use

TODO: describe trigger scenarios (also mirrored in frontmatter description).

## Workflow

1. TODO: step 1
2. TODO: step 2
3. TODO: step 3

## Resources

- {resource_notes}
"""


def validate_name(name: str) -> None:
    if len(name) > 64:
        sys.exit(f"error: skill name too long ({len(name)} > 64 chars): {name}")
    if not NAME_RE.match(name):
        sys.exit(
            "error: skill name must be lowercase letters/digits/hyphens "
            "(no leading/trailing hyphen, no spaces or uppercase): "
            f"{name!r}"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a skill scaffold.")
    parser.add_argument("skill_name", help="skill name (lowercase, hyphens)")
    parser.add_argument("--path", required=True, help="output directory (parent)")
    parser.add_argument(
        "--resources",
        default="",
        help="comma-separated resource dirs to create: scripts,references,assets",
    )
    args = parser.parse_args()

    name = args.skill_name
    validate_name(name)

    out_root = Path(args.path).expanduser().resolve()
    if not out_root.exists():
        sys.exit(f"error: output directory does not exist: {out_root}")
    skill_dir = out_root / name
    if skill_dir.exists() and any(skill_dir.iterdir()):
        sys.exit(f"error: target already exists and is not empty: {skill_dir}")

    wanted = {d.strip() for d in args.resources.split(",") if d.strip()}
    unknown = wanted - set(RESOURCE_DIRS)
    if unknown:
        sys.exit(f"error: unknown resource dirs: {sorted(unknown)} (allowed: {RESOURCE_DIRS})")

    skill_dir.mkdir(parents=True, exist_ok=True)

    title = " ".join(w.capitalize() for w in name.split("-"))
    if wanted:
        resource_notes = "\n".join(f"- See {d}/ for details." for d in sorted(wanted))
    else:
        resource_notes = "None yet. Externalize deep knowledge / deterministic work when it grows."

    (skill_dir / "SKILL.md").write_text(
        SKILL_TEMPLATE.format(name=name, title=title, resource_notes=resource_notes),
        encoding="utf-8",
    )
    for d in sorted(wanted):
        (skill_dir / d).mkdir(exist_ok=True)

    print(f"created: {skill_dir}")
    print("next: fill SKILL.md (name + description + workflow), add resources, "
          "then run validate_skill.py.")


if __name__ == "__main__":
    main()
