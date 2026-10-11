/**
 * Die Audit-Rolle liest ihre preset.md, und die entsteht bei jedem Start aus
 * `generateAuditClaudeMd`. Bis zum 2026-10-11 gab es zwei Vorlagen: die gepflegte
 * (Werkzeuge, Urteil, Tag-Achsen) schrieb nur eine CLAUDE.md, die niemand las,
 * die ausgelieferte kannte keines der drei Audit-Werkzeuge. Dieser Test haelt
 * fest, was die eine Vorlage tragen muss.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import { generateAuditClaudeMd } from '../../../src/main/audit/audit-template'

describe('Audit-Vorlage', () => {
  const text = generateAuditClaudeMd()

  it('nennt die eigenen Werkzeuge, auch die Rueckgabe an die Cyber Factory', () => {
    for (const tool of ['mux_audit_run_start', 'mux_audit_run_complete', 'mux_audit_handoff_cyber_factory']) {
      assert.ok(text.includes(tool), tool)
    }
  })

  it('traegt Urteilsregeln und Tag-Pflicht', () => {
    assert.match(text, /## Verdict Rules/)
    assert.ok(text.includes('kind:report'))
    assert.ok(text.includes('entity:audit'))
  })

  it('es gibt nur eine Vorlage', () => {
    assert.equal(fs.existsSync(path.join(__dirname, '../../../src/main/session/audit-template.ts')), false)
  })
})
