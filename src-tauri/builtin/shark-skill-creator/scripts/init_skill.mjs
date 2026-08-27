#!/usr/bin/env node
/**
 * Generate a skill scaffold (SKILL.md + optional resource dirs).
 * Node counterpart of init_skill.py.
 *
 * Ecosystem-agnostic: only writes the core skill structure
 * (SKILL.md / references/ / scripts/ / assets/). Platform layers
 * (manifest, evals, metadata) are intentionally NOT created here.
 *
 * Usage:
 *   node init_skill.mjs <skill-name> --path <output-dir> [--resources scripts,references,assets]
 *
 * Examples:
 *   node init_skill.mjs springboot-startup-error-diagnosis --path ./skills
 *   node init_skill.mjs my-skill --path ./skills --resources scripts,references
 */
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

const RESOURCE_DIRS = ['references', 'scripts', 'assets']

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$|^[a-z0-9]$/

const SKILL_TEMPLATE = `---
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
`

function usage(message = '') {
  if (message) console.error(`error: ${message}`)
  console.error('usage: node init_skill.mjs <skill-name> --path <output-dir> [--resources scripts,references,assets]')
  process.exit(2)
}

function parseArgs(argv) {
  const args = { resources: '' }
  const positional = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--path') args.path = argv[++i]
    else if (a === '--resources') args.resources = argv[++i]
    else if (a.startsWith('-')) usage(`unknown option ${a}`)
    else positional.push(a)
  }
  if (positional.length !== 1) usage('exactly one skill name is required')
  if (args.path === undefined) usage('--path is required')
  args.name = positional[0]
  return args
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const name = args.name

  if (name.length > 64) {
    console.error(`error: skill name too long (${name.length} > 64 chars): ${name}`)
    process.exit(2)
  }
  if (!NAME_RE.test(name)) {
    console.error(
      'error: skill name must be lowercase letters/digits/hyphens ' +
      `(no leading/trailing hyphen, no spaces or uppercase): ${JSON.stringify(name)}`,
    )
    process.exit(2)
  }

  const outRoot = resolve(args.path.replace(/^~/, homedir()))
  if (!existsSync(outRoot)) {
    console.error(`error: output directory does not exist: ${outRoot}`)
    process.exit(2)
  }
  const skillDir = join(outRoot, name)
  if (existsSync(skillDir) && readdirSync(skillDir).length > 0) {
    console.error(`error: target already exists and is not empty: ${skillDir}`)
    process.exit(2)
  }

  const wanted = new Set(args.resources.split(',').map((s) => s.trim()).filter(Boolean))
  const unknown = [...wanted].filter((d) => !RESOURCE_DIRS.includes(d))
  if (unknown.length > 0) {
    console.error(`error: unknown resource dirs: ${unknown.sort()} (allowed: ${RESOURCE_DIRS.join(',')})`)
    process.exit(2)
  }

  mkdirSync(skillDir, { recursive: true })

  const title = name.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  const resourceNotes = wanted.size > 0
    ? [...wanted].sort().map((d) => `- See ${d}/ for details.`).join('\n')
    : 'None yet. Externalize deep knowledge / deterministic work when it grows.'

  writeFileSync(
    join(skillDir, 'SKILL.md'),
    SKILL_TEMPLATE.replace('{name}', name).replace('{title}', title).replace('{resource_notes}', resourceNotes),
    'utf8',
  )
  for (const d of [...wanted].sort()) mkdirSync(join(skillDir, d), { recursive: true })

  console.log(`created: ${skillDir}`)
  console.log('next: fill SKILL.md (name + description + workflow), add resources, then run validate_skill.mjs (or validate_skill.py).')
}

main()
