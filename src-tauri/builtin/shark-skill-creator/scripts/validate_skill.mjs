#!/usr/bin/env node
/**
 * Validate a skill folder against the core structure rules.
 * Node counterpart of validate_skill.py.
 *
 * Checks (ecosystem-agnostic, mirrors the standard Agent Skills core rules):
 *   - SKILL.md exists with YAML frontmatter containing name + description
 *   - name matches lowercase/letters/digits/hyphens convention and equals dir name
 *   - description is non-empty and mentions WHAT/WHEN
 *   - resource dirs (references/scripts/assets) referenced correctly
 *   - links inside SKILL.md to local files resolve to existing files
 *   - SKILL.md body stays reasonably lean (<500 lines, warning only)
 *
 * Exit code: 0 = pass (errors=0), 1 = validation errors found, 2 = usage error.
 *
 * Usage:
 *   node validate_skill.mjs <skill-dir>
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$/
const MAX_BODY_LINES = 500
const MAX_DESC_LEN = 1024

function parseFrontmatter(text) {
  if (!text.startsWith('---')) return { fm: null, body: text.split('\n') }
  const end = text.indexOf('\n---', 3)
  if (end === -1) return { fm: null, body: text.split('\n') }
  const block = text.slice(3, end)
  const body = text.slice(end + 4).split('\n')
  const fm = {}
  for (const line of block.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '')
    fm[key] = value
  }
  return { fm, body }
}

function main() {
  const dir = process.argv[2]
  if (dir === undefined) {
    console.error('usage: node validate_skill.mjs <skill-dir>')
    process.exit(2)
  }
  const root = resolve(dir)
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`error: not a directory: ${root}`)
    process.exit(2)
  }

  const errors = []
  const warnings = []
  const infos = []

  const skillMd = join(root, 'SKILL.md')
  if (!existsSync(skillMd)) {
    errors.push('SKILL.md: missing (required entry file)')
    report(basename(root), errors, warnings, infos)
    process.exit(1)
  }

  const text = readFileSync(skillMd, 'utf8')
  const { fm, body } = parseFrontmatter(text)
  if (fm === null) {
    errors.push('SKILL.md: frontmatter missing or malformed (must start with --- ... ---)')
  } else {
    const name = fm.name ?? ''
    const desc = fm.description ?? ''
    if (!name) errors.push('name: empty')
    else if (name.length > 64) errors.push(`name: too long (${name.length} > 64)`)
    else if (!NAME_RE.test(name)) errors.push(`name: invalid (${JSON.stringify(name)}; lowercase letters/digits/hyphens only)`)
    if (basename(root) !== name) warnings.push(`name: folder ${JSON.stringify(basename(root))} != frontmatter name ${JSON.stringify(name)}`)
    if (!desc) errors.push('description: empty (required for discovery/triggering)')
    else {
      if (desc.length > MAX_DESC_LEN) warnings.push(`description: very long (${desc.length} > ${MAX_DESC_LEN} chars)`)
      if (!/[Ww]hen|use|触发|使用/.test(desc)) warnings.push('description: no obvious WHEN/trigger wording found')
    }
  }

  if (body.length > MAX_BODY_LINES) {
    warnings.push(`SKILL.md: body has ${body.length} lines (keep < ${MAX_BODY_LINES}; externalize deep knowledge to references/)`)
  }

  // Local markdown links must resolve.
  for (const m of text.matchAll(/\]\(([^)]+)\)/g)) {
    const target = m[1]
    if (/^(https?:\/\/|#|mailto:)/.test(target)) continue
    const pathPart = target.split('#')[0].split('?')[0]
    if (!pathPart) continue
    const candidate = resolve(root, pathPart)
    if (!existsSync(candidate)) errors.push(`SKILL.md: broken local link -> ${JSON.stringify(target)}`)
  }

  // Resource dirs: warn when present but unreferenced.
  for (const d of ['references', 'scripts', 'assets']) {
    const p = join(root, d)
    if (existsSync(p) && statSync(p).isDirectory()) {
      if (!text.includes(d)) warnings.push(`${d}/: directory exists but is never referenced in SKILL.md`)
    } else {
      infos.push(`${d}/: not present (fine if not needed)`)
    }
  }

  report(basename(root), errors, warnings, infos)
  process.exit(errors.length > 0 ? 1 : 0)
}

function report(name, errors, warnings, infos) {
  console.log(`skill: ${name}`)
  for (const e of errors) console.log(`  [error]   ${e}`)
  for (const w of warnings) console.log(`  [warning] ${w}`)
  for (const i of infos) console.log(`  [info]    ${i}`)
  console.log(`result: ${errors.length > 0 ? 'FAIL' : warnings.length > 0 ? 'PASS with warnings' : 'PASS'} (${errors.length} errors, ${warnings.length} warnings)`)
}

main()
