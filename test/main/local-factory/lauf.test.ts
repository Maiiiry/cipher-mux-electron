import { describe, it } from 'node:test'
import * as assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  newLauf, beginVersuch, endVersuch, markAbgenommen, markBeurteilt, abortRunning, countWeckruf,
  parseLauf, loadLauf, saveLauf, MAX_VERSUCHE, type Lauf,
} from '../../../src/main/local-factory/lauf'

const ok = <T>(r: T | { error: string }): T => {
  if ('error' in (r as object)) throw new Error((r as { error: string }).error)
  return r as T
}

describe('Lauf-Zustand', () => {
  it('neues Häppchen bekommt die nächste Nummer, Versuch 1', () => {
    const r = ok(beginVersuch(newLauf('L', '/p', 0), { ziel: 'a', now: 1 }))
    assert.equal(r.nummer, 1)
    assert.equal(r.versuch, 1)
    assert.equal(r.lauf.haeppchen[0].status, 'laeuft')
  })

  it('zweiter Versuch auf dasselbe Häppchen nach rot', () => {
    let l = ok(beginVersuch(newLauf('L', '/p', 0), { ziel: 'a', now: 1 })).lauf
    l = endVersuch(l, 1, { verdict: 'rot' }, 2)
    const r = ok(beginVersuch(l, { nummer: 1, ziel: 'a', now: 3 }))
    assert.equal(r.versuch, 2)
  })

  it(`nach ${MAX_VERSUCHE} Fehlschlägen: eskaliert und kein dritter Versuch`, () => {
    let l = ok(beginVersuch(newLauf('L', '/p', 0), { ziel: 'a', now: 1 })).lauf
    l = endVersuch(l, 1, { verdict: 'rot' }, 2)
    l = ok(beginVersuch(l, { nummer: 1, ziel: 'a', now: 3 })).lauf
    l = endVersuch(l, 1, { verdict: 'haengt' }, 4)
    assert.equal(l.haeppchen[0].status, 'eskaliert')
    const r = beginVersuch(l, { nummer: 1, ziel: 'a', now: 5 })
    assert.ok('error' in r)
    assert.match((r as { error: string }).error, /eskaliert/)
  })

  it('kein neuer Versuch, solange einer läuft (nacheinander)', () => {
    const l = ok(beginVersuch(newLauf('L', '/p', 0), { ziel: 'a', now: 1 })).lauf
    assert.ok('error' in beginVersuch(l, { ziel: 'b', now: 2 }))
  })

  it('grün → wartet; abgenommen erst durch den Architekten', () => {
    let l = ok(beginVersuch(newLauf('L', '/p', 0), { ziel: 'a', now: 1 })).lauf
    l = endVersuch(l, 1, { verdict: 'gruen', commit: 'abc' }, 2)
    assert.equal(l.haeppchen[0].status, 'wartet')
    assert.equal(markAbgenommen(l, 1).haeppchen[0].status, 'abgenommen')
  })

  it('unbekannte Nummer → Fehler', () => {
    assert.ok('error' in beginVersuch(newLauf('L', '/p', 0), { nummer: 7, ziel: 'a', now: 1 }))
  })

  it('abortRunning markiert laufende Häppchen als abgebrochen', () => {
    const l = ok(beginVersuch(newLauf('L', '/p', 0), { ziel: 'a', now: 1 })).lauf
    assert.equal(abortRunning(l).haeppchen[0].status, 'abgebrochen')
  })

  it('countWeckruf zählt hoch', () => {
    assert.equal(countWeckruf(newLauf('L', '/p', 0)).weckrufe, 1)
  })

  it('endVersuch auf eskaliert: bleibt eskaliert auch mit grün-Verdict', () => {
    let l = ok(beginVersuch(newLauf('L', '/p', 0), { ziel: 'a', now: 1 })).lauf
    l = endVersuch(l, 1, { verdict: 'rot' }, 2)
    l = ok(beginVersuch(l, { nummer: 1, ziel: 'a', now: 3 })).lauf
    l = endVersuch(l, 1, { verdict: 'haengt' }, 4)
    assert.equal(l.haeppchen[0].status, 'eskaliert')
    l = endVersuch(l, 1, { verdict: 'gruen' }, 5)
    assert.equal(l.haeppchen[0].status, 'eskaliert')
  })

  it('markAbgenommen auf laeuft: unverändert', () => {
    const l = ok(beginVersuch(newLauf('L', '/p', 0), { ziel: 'a', now: 1 })).lauf
    assert.equal(l.haeppchen[0].status, 'laeuft')
    const marked = markAbgenommen(l, 1)
    assert.equal(marked.haeppchen[0].status, 'laeuft')
  })

  it('markAbgenommen nach rot-Verdict (nicht grün): unverändert', () => {
    let l = ok(beginVersuch(newLauf('L', '/p', 0), { ziel: 'a', now: 1 })).lauf
    l = endVersuch(l, 1, { verdict: 'rot' }, 2)
    assert.equal(l.haeppchen[0].status, 'wartet')
    const marked = markAbgenommen(l, 1)
    assert.equal(marked.haeppchen[0].status, 'wartet')
  })

  it('abgebrochen + Versuch rot → eskaliert, kein Versuch möglich', () => {
    let l = ok(beginVersuch(newLauf('L', '/p', 0), { ziel: 'a', now: 1 })).lauf
    l = abortRunning(l)
    assert.equal(l.haeppchen[0].status, 'abgebrochen')
    const r = ok(beginVersuch(l, { nummer: 1, ziel: 'a', now: 2 }))
    l = endVersuch(r.lauf, 1, { verdict: 'rot' }, 3)
    assert.equal(l.haeppchen[0].status, 'eskaliert')
    assert.ok('error' in beginVersuch(l, { nummer: 1, ziel: 'a', now: 4 }))
  })

  it('parseLauf mit gemischten versuche: alle behalten, ungültige durch Stub ersetzen', () => {
    const l = parseLauf({
      id: 'L',
      projekt: '/p',
      haeppchen: [{ nummer: 1, ziel: 'a', versuche: [{ nr: 1, gestartet: 100 }, 'kaputt'] }],
    })!
    assert.equal(l.haeppchen[0].versuche.length, 2)
    assert.deepEqual(l.haeppchen[0].versuche[0], { nr: 1, gestartet: 100 })
    assert.deepEqual(l.haeppchen[0].versuche[1], { nr: 2, gestartet: 0, verdict: 'haengt' })
    const r = beginVersuch(l, { nummer: 1, ziel: 'a', now: 1 })
    assert.ok('error' in r)
  })
})

describe('parseLauf / loadLauf defensiv', () => {
  it('Müll → null', () => {
    assert.equal(parseLauf(null), null)
    assert.equal(parseLauf('x'), null)
    assert.equal(parseLauf({ id: 1 }), null)
  })
  it('fehlende Felder werden aufgefüllt, kaputte Häppchen fallen weg', () => {
    const l = parseLauf({ id: 'L', projekt: '/p', haeppchen: [{ nummer: 1, ziel: 'a' }, 'kaputt'] })!
    assert.equal(l.weckrufe, 0)
    assert.equal(l.haeppchen.length, 1)
    assert.deepEqual(l.haeppchen[0].versuche, [])
    assert.equal(l.haeppchen[0].status, 'abgebrochen')
  })
  it('Roundtrip über die Platte; kaputte Datei → null', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauf-'))
    const f = path.join(dir, 'x', 'lauf.json')
    const l: Lauf = newLauf('L', '/p', 0)
    saveLauf(f, l)
    assert.deepEqual(loadLauf(f), l)
    fs.writeFileSync(f, '{kaputt')
    assert.equal(loadLauf(f), null)
    assert.equal(loadLauf(path.join(dir, 'fehlt.json')), null)
  })
})

describe('Lauf — Branch', () => {
  it('newLauf übernimmt den Branch, parseLauf liest ihn defensiv', () => {
    assert.equal(newLauf('L', '/p', 0, 'main').branch, 'main')
    assert.equal(parseLauf({ id: 'L', projekt: '/p', branch: 'main' })!.branch, 'main')
    assert.equal(parseLauf({ id: 'L', projekt: '/p' })!.branch, undefined)
    assert.equal(parseLauf({ id: 'L', projekt: '/p', branch: 42 })!.branch, undefined)
  })
})

describe('Lauf — Urteil', () => {
  it('markBeurteilt: grün-wartend und eskaliert ja, laufend und beurteilt nein', () => {
    let l = ok(beginVersuch(newLauf('L', '/p', 0), { ziel: 'a', now: 1, mitTest: true })).lauf
    assert.equal(l.haeppchen[0].mitTest, true)
    assert.equal(markBeurteilt(l, 1), l)
    l = endVersuch(l, 1, { verdict: 'gruen' }, 2)
    const b = markBeurteilt(l, 1)
    assert.equal(b.haeppchen[0].status, 'beurteilt')
    assert.equal(markBeurteilt(b, 1), b)
  })
  it('beginVersuch lehnt ein beurteiltes Häppchen ab', () => {
    let l = ok(beginVersuch(newLauf('L', '/p', 0), { ziel: 'a', now: 1 })).lauf
    l = markBeurteilt(endVersuch(l, 1, { verdict: 'gruen' }, 2), 1)
    const r = beginVersuch(l, { nummer: 1, ziel: 'a', now: 3 })
    assert.deepEqual(r, { error: 'Häppchen #1 ist schon beurteilt.' })
  })
  it('parseLauf kennt den Status beurteilt', () => {
    const l = parseLauf({ id: 'L', projekt: '/p', haeppchen: [{ nummer: 1, ziel: 'a', status: 'beurteilt', versuche: [] }] })!
    assert.equal(l.haeppchen[0].status, 'beurteilt')
  })
})
