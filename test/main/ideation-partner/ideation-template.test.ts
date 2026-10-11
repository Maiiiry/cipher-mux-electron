import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  isV2Template,
  syncIdeationTemplate,
  generateV2Template,
} from '../../../src/main/ideation-partner/ideation-template'

const ENTITIES_DIR = path.join(os.homedir(), '.config/cipher-mux/entities')
const IDEATION_DIR = path.join(ENTITIES_DIR, 'ideation-partner')
const CLAUDE_MD_PATH = path.join(IDEATION_DIR, 'CLAUDE.md')
const BACKUP_PATH = path.join(IDEATION_DIR, 'CLAUDE.md.v1-backup')

let originalContent: string | null = null
let originalBackup: string | null = null

beforeEach(() => {
  try { originalContent = fs.readFileSync(CLAUDE_MD_PATH, 'utf-8') } catch { originalContent = null }
  try { originalBackup = fs.readFileSync(BACKUP_PATH, 'utf-8') } catch { originalBackup = null }
})

afterEach(() => {
  if (originalContent !== null) {
    fs.writeFileSync(CLAUDE_MD_PATH, originalContent, 'utf-8')
  } else if (fs.existsSync(CLAUDE_MD_PATH)) {
    fs.unlinkSync(CLAUDE_MD_PATH)
  }
  if (originalBackup !== null) {
    fs.writeFileSync(BACKUP_PATH, originalBackup, 'utf-8')
  } else if (fs.existsSync(BACKUP_PATH)) {
    fs.unlinkSync(BACKUP_PATH)
  }
})

describe('generateV2Template', () => {
  it('contains the v2 marker', () => {
    assert.ok(generateV2Template().includes('<!-- ideation-partner-v3 -->'))
  })

  it('contains 5-phase model', () => {
    const t = generateV2Template()
    assert.ok(t.includes('Phase 0'))
    assert.ok(t.includes('Phase 1'))
    assert.ok(t.includes('Phase 2'))
    assert.ok(t.includes('Phase 3'))
    assert.ok(t.includes('Phase 4'))
  })

  it('mentions handoff and skill tools', () => {
    const t = generateV2Template()
    assert.ok(t.includes('mux_ideation_handoff_refinement'))
    assert.ok(t.includes('mux_ideation_skill_run'))
  })

  it('includes uncertainty markers requirement', () => {
    const t = generateV2Template()
    assert.ok(t.includes('uncertainty markers'))
  })

  it('includes anti-patterns', () => {
    const t = generateV2Template()
    assert.ok(t.includes('grossartige Idee'))
    assert.ok(t.includes('confirmation bias') || t.includes('Confirmation bias'))
  })
})

describe('isV2Template', () => {
  it('returns false for v1 content', () => {
    fs.mkdirSync(IDEATION_DIR, { recursive: true })
    fs.writeFileSync(CLAUDE_MD_PATH, '# Ideation Partner\nOld.', 'utf-8')
    assert.equal(isV2Template(), false)
  })

  it('returns true for v2 content', () => {
    fs.mkdirSync(IDEATION_DIR, { recursive: true })
    fs.writeFileSync(CLAUDE_MD_PATH, generateV2Template(), 'utf-8')
    assert.equal(isV2Template(), true)
  })
})

describe('syncIdeationTemplate', () => {
  it('writes v2 when enabled and currently v1', () => {
    fs.mkdirSync(IDEATION_DIR, { recursive: true })
    fs.writeFileSync(CLAUDE_MD_PATH, '# Old', 'utf-8')
    syncIdeationTemplate(true)
    assert.equal(isV2Template(), true)
  })

  it('creates backup', () => {
    fs.mkdirSync(IDEATION_DIR, { recursive: true })
    if (fs.existsSync(BACKUP_PATH)) fs.unlinkSync(BACKUP_PATH)
    fs.writeFileSync(CLAUDE_MD_PATH, '# Old', 'utf-8')
    syncIdeationTemplate(true)
    assert.ok(fs.existsSync(BACKUP_PATH))
    assert.equal(fs.readFileSync(BACKUP_PATH, 'utf-8'), '# Old')
  })

  it('does nothing when disabled', () => {
    fs.mkdirSync(IDEATION_DIR, { recursive: true })
    fs.writeFileSync(CLAUDE_MD_PATH, '# Old', 'utf-8')
    syncIdeationTemplate(false)
    assert.equal(fs.readFileSync(CLAUDE_MD_PATH, 'utf-8'), '# Old')
  })

  it('is idempotent when already v2', () => {
    fs.mkdirSync(IDEATION_DIR, { recursive: true })
    const v2 = generateV2Template()
    fs.writeFileSync(CLAUDE_MD_PATH, v2 + '\n<!-- user edit -->', 'utf-8')
    syncIdeationTemplate(true)
    assert.ok(fs.readFileSync(CLAUDE_MD_PATH, 'utf-8').includes('<!-- user edit -->'))
  })
})
