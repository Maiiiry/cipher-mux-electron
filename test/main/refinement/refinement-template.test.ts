import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { isV2Template, generateV2Template, syncRefinementTemplate } from '../../../src/main/refinement/refinement-template'

const ENTITIES_DIR = path.join(os.homedir(), '.config/cipher-mux/entities')
const REFINEMENT_DIR = path.join(ENTITIES_DIR, 'refinement')
const CLAUDE_MD_PATH = path.join(REFINEMENT_DIR, 'CLAUDE.md')
const BACKUP_PATH = path.join(REFINEMENT_DIR, 'CLAUDE.md.v1-backup')

// Save original content before tests
let originalContent: string | null = null
let originalBackup: string | null = null

beforeEach(() => {
  try { originalContent = fs.readFileSync(CLAUDE_MD_PATH, 'utf-8') } catch { originalContent = null }
  try { originalBackup = fs.readFileSync(BACKUP_PATH, 'utf-8') } catch { originalBackup = null }
})

afterEach(() => {
  // Restore original files
  if (originalContent !== null) {
    fs.writeFileSync(CLAUDE_MD_PATH, originalContent, 'utf-8')
  }
  if (originalBackup !== null) {
    fs.writeFileSync(BACKUP_PATH, originalBackup, 'utf-8')
  } else if (fs.existsSync(BACKUP_PATH)) {
    fs.unlinkSync(BACKUP_PATH)
  }
})

describe('generateV2Template', () => {
  it('contains the v2 marker', () => {
    const template = generateV2Template()
    assert.ok(template.includes('<!-- refinement-v3 -->'))
  })

  it('contains 7-phase model', () => {
    const template = generateV2Template()
    assert.ok(template.includes('Phase 1'))
    assert.ok(template.includes('Phase 7'))
    assert.ok(template.includes('Required Fields Check'))
    assert.ok(template.includes('REQ-IDs'))
  })

  it('mentions handoff tools', () => {
    const template = generateV2Template()
    assert.ok(template.includes('mux_refinement_handoff_cyber_factory'))
    assert.ok(template.includes('mux_refinement_handoff_ideation'))
  })

  it('does NOT mention scaffolding as own task', () => {
    const template = generateV2Template()
    // Scaffolding is mentioned as "not our job" (Cyber Factory does it)
    const lines = template.split('\n')
    const scaffoldLines = lines.filter(l => l.toLowerCase().includes('scaffolding'))
    for (const line of scaffoldLines) {
      assert.ok(
        line.includes('Cyber Factory') || line.includes('nicht') || line.includes('not'),
        `Scaffolding line should reference Cyber Factory or negation: ${line}`
      )
    }
  })
})

describe('isV2Template', () => {
  it('returns false for v1 content', () => {
    fs.mkdirSync(REFINEMENT_DIR, { recursive: true })
    fs.writeFileSync(CLAUDE_MD_PATH, '# Refinement — Ideation Partner\n\nOld content.', 'utf-8')
    assert.equal(isV2Template(), false)
  })

  it('returns true for v2 content', () => {
    fs.mkdirSync(REFINEMENT_DIR, { recursive: true })
    fs.writeFileSync(CLAUDE_MD_PATH, generateV2Template(), 'utf-8')
    assert.equal(isV2Template(), true)
  })
})

describe('syncRefinementTemplate', () => {
  it('writes v2 template when enabled and currently v1', () => {
    fs.mkdirSync(REFINEMENT_DIR, { recursive: true })
    fs.writeFileSync(CLAUDE_MD_PATH, '# Old v1 content', 'utf-8')
    syncRefinementTemplate(true)
    assert.equal(isV2Template(), true)
  })

  it('creates backup when overwriting v1', () => {
    fs.mkdirSync(REFINEMENT_DIR, { recursive: true })
    // Remove any existing backup
    if (fs.existsSync(BACKUP_PATH)) fs.unlinkSync(BACKUP_PATH)
    fs.writeFileSync(CLAUDE_MD_PATH, '# Old v1 content', 'utf-8')
    syncRefinementTemplate(true)
    assert.ok(fs.existsSync(BACKUP_PATH))
    assert.equal(fs.readFileSync(BACKUP_PATH, 'utf-8'), '# Old v1 content')
  })

  it('does not overwrite when already v2', () => {
    fs.mkdirSync(REFINEMENT_DIR, { recursive: true })
    const v2 = generateV2Template()
    const modified = v2 + '\n<!-- user edit -->'
    fs.writeFileSync(CLAUDE_MD_PATH, modified, 'utf-8')
    syncRefinementTemplate(true)
    // Should NOT have overwritten the user-modified v2
    assert.equal(fs.readFileSync(CLAUDE_MD_PATH, 'utf-8'), modified)
  })

  it('does nothing when disabled', () => {
    fs.mkdirSync(REFINEMENT_DIR, { recursive: true })
    fs.writeFileSync(CLAUDE_MD_PATH, '# Old v1 content', 'utf-8')
    syncRefinementTemplate(false)
    assert.equal(fs.readFileSync(CLAUDE_MD_PATH, 'utf-8'), '# Old v1 content')
  })
})
