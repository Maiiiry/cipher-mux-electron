import { describe, it } from 'node:test'
import * as assert from 'node:assert/strict'
import { validateAuftrag, buildAuftragMd, MAX_GATE_OUTPUT_CHARS } from '../../../src/main/local-factory/auftrag'

const a = {
  projekt: '/abs/projekt',
  ziel: 'Login-Formular validiert E-Mail',
  dateien: ['src/login.ts'],
  akzeptanzkriterium: 'Ungültige E-Mail zeigt Fehlermeldung',
  geschuetzteTests: ['test/login.accept.test.ts'],
  testBefehl: 'npm test -- test/login.accept.test.ts',
  nichtZiele: ['Kein Styling'],
}

describe('validateAuftrag', () => {
  it('gültiger Auftrag → keine Fehler', () => {
    assert.deepEqual(validateAuftrag(a), [])
  })
  it('leere Pflichtfelder werden einzeln benannt', () => {
    const errs = validateAuftrag({ ...a, ziel: ' ', geschuetzteTests: [], testBefehl: '' })
    assert.equal(errs.length, 3)
    assert.match(errs.join(), /ziel/)
    assert.match(errs.join(), /geschuetzteTests/)
    assert.match(errs.join(), /testBefehl/)
  })
  it('projekt muss absolut sein', () => {
    assert.match(validateAuftrag({ ...a, projekt: 'rel' }).join(), /absolut/)
  })
  it('geschützter Test außerhalb des Projekts wird abgelehnt', () => {
    assert.match(validateAuftrag({ ...a, geschuetzteTests: ['/anderswo/x.test.ts'] }).join(), /außerhalb/)
  })
  it('nicht-String in geschuetzteTests → Fehler statt Wurf', () => {
    const errs = validateAuftrag({ ...a, geschuetzteTests: [123 as never] })
    assert.ok(errs.length > 0)
    assert.match(errs.join(), /geschuetzteTests/)
  })
  it('leerer String in geschuetzteTests → Fehler', () => {
    const errs = validateAuftrag({ ...a, geschuetzteTests: [''] })
    assert.ok(errs.length > 0)
    assert.match(errs.join(), /geschuetzteTests/)
  })
  it('nicht-String in dateien → Fehler', () => {
    const errs = validateAuftrag({ ...a, dateien: [null as never] })
    assert.ok(errs.length > 0)
    assert.match(errs.join(), /dateien/)
  })
})

describe('buildAuftragMd', () => {
  it('enthält Projektpfad, Kriterium, geschützte Tests, Testbefehl', () => {
    const md = buildAuftragMd(a, { nummer: 3, versuch: 1 })
    for (const s of ['/abs/projekt', a.akzeptanzkriterium, 'test/login.accept.test.ts', a.testBefehl, '#3']) {
      assert.ok(md.includes(s), s)
    }
  })
  it('zweiter Versuch: Gate-Ausgabe wörtlich, in einem Codeblock', () => {
    const md = buildAuftragMd(a, {
      nummer: 3, versuch: 2,
      vorherigesGate: { reasons: ['Testbefehl rot (Exit 1).'], testOutput: 'AssertionError: expected "x"' },
    })
    assert.ok(md.includes('AssertionError: expected "x"'))
    assert.ok(md.includes('Versuch 2'))
  })
  it('lange Gate-Ausgabe wird vorne gekürzt, das Ende bleibt', () => {
    const out = 'A'.repeat(MAX_GATE_OUTPUT_CHARS * 2) + 'ENDE'
    const md = buildAuftragMd(a, { nummer: 1, versuch: 2, vorherigesGate: { reasons: [], testOutput: out } })
    // Prüfung: ENDE ist vorhanden
    assert.ok(md.includes('ENDE'), 'ENDE sollte im Output sein')
    // Prüfung: Kürzungsmarker ist vorhanden
    assert.ok(md.includes('… (gekürzt)'), 'Kürzungsmarker sollte vorhanden sein')
    // Prüfung: nicht alle 'A's sind vorhanden (vorne gekürzt)
    const aCount = md.split('A').length - 1
    assert.ok(aCount < MAX_GATE_OUTPUT_CHARS * 2, `md sollte weniger als ${MAX_GATE_OUTPUT_CHARS * 2} 'A's enthalten, aber ${aCount} gefunden`)
  })
})

describe('validateAuftrag ohne Testpflicht', () => {
  it('testPflicht false: leere geschuetzteTests ist gültig, testBefehl bleibt Pflicht', () => {
    const x = { ...a, geschuetzteTests: [] }
    assert.deepEqual(validateAuftrag(x, { testPflicht: false }), [])
    assert.deepEqual(validateAuftrag({ ...x, testBefehl: ' ' }, { testPflicht: false }), ['testBefehl: leer'])
  })
  it('ohne Abnahmetests fehlt der Abschnitt „gesperrt“ im Auftrag', () => {
    const md = buildAuftragMd({ ...a, geschuetzteTests: [] }, { nummer: 1, versuch: 1 })
    assert.doesNotMatch(md, /gesperrt/)
  })
})
