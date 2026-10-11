/**
 * Ausgelieferte Rollen-Anweisungen enthalten keine maskierten Backticks.
 *
 * Die Vorlagen sind Template-Strings; ein Backtick darin wird als `\``
 * geschrieben. Steht dort `\\\``, kommt bei der Rolle `\`` an — ein Codeblock,
 * der keiner ist. Am 2026-10-01 in den deutschen Refinement- und Companion-
 * Inhalten behoben (32 Stellen), in der englischen Refinement- und
 * Ideation-Vorlage — die tatsaechlich ausgelieferte — nicht. Gefunden am
 * 2026-10-11 beim Zusammenlegen der beiden Fassungen.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { generateRefinementClaudeMd, generateIdeationPartnerClaudeMd, generateCompanionClaudeMd } from '../../src/main/entity-content'
import { generateDebuggerClaudeMd } from '../../src/main/debugger/debugger-template'
import { generateTestingAssistantClaudeMd } from '../../src/main/testing-assistant/testing-template'
import { generateWorkshopClaudeMd } from '../../src/main/workshop/workshop-template'
import { generateCyberFactoryClaudeMd } from '../../src/main/cyber-factory/cyber-factory-template'
import { generateAuditClaudeMd } from '../../src/main/audit/audit-template'

const mcp = { mcpHost: '127.0.0.1', mcpPort: 3100, mcpApiKey: 'k' }
const rendered: Record<string, () => string> = {
  refinement: generateRefinementClaudeMd,
  'ideation-partner': generateIdeationPartnerClaudeMd,
  companion: generateCompanionClaudeMd,
  debugger: generateDebuggerClaudeMd,
  'testing-assistant': generateTestingAssistantClaudeMd,
  workshop: () => generateWorkshopClaudeMd(mcp),
  'cyber-factory': () => generateCyberFactoryClaudeMd(mcp),
  audit: generateAuditClaudeMd,
}

describe('Rollen-Anweisungen: keine maskierten Backticks', () => {
  for (const [name, gen] of Object.entries(rendered)) {
    it(name, () => {
      const lines = gen().split('\n').filter(l => l.includes('\\`'))
      assert.deepEqual(lines, [])
    })
  }
})
