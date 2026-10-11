/**
 * Rollen-Vorlagen und Companion-Wissen nennen nur Werkzeuge, die es gibt.
 *
 * Gemessen am 2026-10-10: neun Vorlagen nannten vier Werkzeuge, die der Server
 * nicht (mehr) registriert — `mux_input_request_create` (Rueckfrage als
 * Sidebar-Blase, entfernt), `mux_companion_recall`, `mux_companion_memory_recall`,
 * `mux_workspace_apply`. Eine Rolle, die in ihrer Eskalationsstufe ein
 * fehlendes Werkzeug ruft, bleibt genau dort haengen, wo sie den Menschen
 * braucht. Der Test liest den Quelltext, weil die Vorlagen Template-Strings
 * sind und sich nicht als Daten durchlaufen lassen.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'fs'
import * as path from 'path'
import { registerTools } from '../../src/main/mcp/mcp-tools'
import type { ToolContext } from '../../src/main/mcp/mcp-tools'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

const SRC = path.join(__dirname, '../../src/main')

function registeredNames(): Set<string> {
  const names = new Set<string>()
  const fake = { registerTool: (n: string) => { names.add(n) } } as unknown as McpServer
  for (const entityId of [null, 'local-factory']) {
    registerTools(fake, { sessionManager: {}, entityId } as unknown as ToolContext)
  }
  return names
}

/** Vorlagen, Presets und Companion-Inhalte — alles, was eine Rolle als Anweisung liest. */
function instructionSources(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f)
      if (fs.statSync(p).isDirectory()) walk(p)
      else if (p.endsWith('.ts') && !p.includes('.generated.')
        && /(template|preset|entity-content|skills)/.test(path.relative(SRC, p))) out.push(p)
    }
  }
  walk(SRC)
  return out
}

describe('Rollen-Anweisungen nennen nur echte Werkzeuge', () => {
  it('findet die Quellen ueberhaupt', () => {
    assert.ok(instructionSources().length >= 10)
  })

  it('jeder mux_/companion_/kickoff_-Name ist registriert', () => {
    const known = registeredNames()
    assert.ok(known.size >= 68)
    const phantoms: string[] = []
    for (const file of instructionSources()) {
      const text = fs.readFileSync(file, 'utf-8')
      for (const name of new Set(text.match(/\b(?:mux|companion|kickoff)_[a-z_]+[a-z]\b/g) ?? [])) {
        if (!known.has(name)) phantoms.push(`${path.relative(SRC, file)}: ${name}`)
      }
    }
    assert.deepEqual(phantoms, [])
  })
})

/**
 * Companion-Memory gibt es nur fuer den Companion — der Server registriert die
 * vier `companion_memory_*` fuer keine andere Rolle (`mcp/entity-header.ts`).
 * Gemessen am 2026-10-11: neun Vorlagen anderer Rollen schickten trotzdem dorthin,
 * meist im Lessons-Learned-Baum, Cyber Factory und Workshop sogar in der
 * Werkzeugliste. Der Phantom-Test oben sieht das nicht: die Namen sind
 * registriert, nur nicht fuer diese Rolle.
 */
describe('Companion-Memory nennen nur Companion-Inhalte', () => {
  it('keine andere Rollen-Vorlage nennt companion_memory_*', () => {
    const offenders = instructionSources()
      .filter(f => !path.basename(f).includes('companion'))
      .filter(f => /\bcompanion_memory_[a-z]+/.test(fs.readFileSync(f, 'utf-8')))
      .map(f => path.relative(SRC, f))
    assert.deepEqual(offenders, [])
  })
})
