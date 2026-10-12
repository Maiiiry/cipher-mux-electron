import { describe, it } from 'node:test'
import * as assert from 'node:assert/strict'
import { validateUrteil, buildBilanzZeile, renderBilanzNote, type BilanzZeile } from '../../../src/main/local-factory/bilanz'
import type { Lauf } from '../../../src/main/local-factory/lauf'

const lauf: Lauf = {
  id: 'L1', projekt: '/p', erstellt: 0, weckrufe: 2,
  haeppchen: [{ nummer: 1, ziel: 'z', status: 'wartet', mitTest: false, versuche: [
    { nr: 1, gestartet: 1000, beendet: 61000, verdict: 'rot', profil: 'mac', modell: 'm-mac' },
    { nr: 2, gestartet: 70000, beendet: 130000, verdict: 'gruen', profil: 'mac', modell: 'm-mac',
      commit: 'abc', dateien: 2, diffZeilen: 14, tokensAmEnde: { input: 900, output: 120 } },
  ] }],
}

describe('validateUrteil', () => {
  it('gültig', () => assert.deepEqual(validateUrteil({ ergebnis: 'uebernommen', kategorie: 'ui' }), []))
  it('unbekanntes Ergebnis und Kategorie', () => {
    assert.equal(validateUrteil({ ergebnis: 'super' as any, kategorie: 'x' as any }).length, 2)
  })
  it('nachgebessert braucht eine Notiz', () => {
    assert.match(validateUrteil({ ergebnis: 'nachgebessert', kategorie: 'ui' }).join(), /notiz/)
  })
})

describe('buildBilanzZeile', () => {
  it('nimmt Messwerte aus dem letzten Versuch, Anläufe = Zahl der Versuche, Dauer über alle', () => {
    const z = buildBilanzZeile(lauf, 1, { ergebnis: 'nachgebessert', kategorie: 'ui', notiz: 'Import fehlte' },
      { now: '2026-10-12T10:00:00Z', workspaceId: 'ws', mitTest: false })
    assert.equal(z.anlaeufe, 2)
    assert.equal(z.dauerSek, 120)
    assert.equal(z.profil, 'mac'); assert.equal(z.modell, 'm-mac')
    assert.equal(z.dateien, 2); assert.equal(z.diffZeilen, 14)
    assert.deepEqual(z.workerTokens, { input: 900, output: 120 })
    assert.equal(z.notiz, 'Import fehlte')
  })
})

describe('renderBilanzNote', () => {
  const z = (modell: string, kategorie: any, ergebnis: any, anlaeufe = 1, notiz: string | null = null): BilanzZeile => ({
    ts: '2026-10-12T10:00:00Z', projekt: '/p', workspaceId: null, laufId: 'L', haeppchen: 1, profil: 'mac', modell,
    mitTest: true, anlaeufe, dauerSek: 60, dateien: 1, diffZeilen: 5, workerTokens: null, ergebnis, kategorie, notiz,
  })
  it('zählt pro Modell × Kategorie: Aufträge, ohne Nachbesserung übernommen, Anläufe im Schnitt', () => {
    const md = renderBilanzNote([
      z('m-mac', 'ui', 'uebernommen'), z('m-mac', 'ui', 'nachgebessert', 2, 'Typ falsch'), z('m-dgx', 'test', 'selbst-uebernommen', 2),
    ])
    assert.match(md, /\| m-mac \| ui \| 2 \| 1 \| 1,5 \|/)
    assert.match(md, /\| m-dgx \| test \| 1 \| 0 \| 2,0 \|/)
    assert.match(md, /Typ falsch/)
  })
  it('höchstens zehn Nachbesserungs-Notizen, die neuesten zuerst', () => {
    const zs = Array.from({ length: 12 }, (_, i) => ({ ...z('m', 'ui', 'nachgebessert', 1, `n${i}`), ts: `2026-10-${String(i + 1).padStart(2, '0')}T00:00:00Z` }))
    const md = renderBilanzNote(zs)
    assert.match(md, /n11/); assert.doesNotMatch(md, /\bn1\b/)
  })
  it('leer: ein Satz statt einer leeren Tabelle', () => {
    assert.match(renderBilanzNote([]), /Noch keine Aufträge/)
  })
})
