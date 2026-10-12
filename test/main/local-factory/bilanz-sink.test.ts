import { describe, it } from 'node:test'
import * as assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createBilanzSink } from '../../../src/main/local-factory/bilanz-sink'

function fakeNotes() {
  const store = new Map<string, string>()
  let n = 0
  return {
    store,
    async create(title: string, body: string) { const id = `N${++n}`; store.set(id, body); return { id } as any },
    async save(id: string, body: string) { store.set(id, body); return { id } as any },
    async read(id: string) { return store.has(id) ? ({ id, body: store.get(id) } as any) : null },
  }
}
const zeile = (i: number) => ({ ts: `2026-10-12T0${i}:00:00Z`, projekt: '/p', workspaceId: null, laufId: 'L', haeppchen: i,
  profil: 'mac', modell: 'm', mitTest: true, anlaeufe: 1, dauerSek: 1, dateien: 1, diffZeilen: 1, workerTokens: null,
  ergebnis: 'uebernommen' as const, kategorie: 'ui' as const, notiz: null })

describe('BilanzSink', () => {
  it('hängt an und schreibt dieselbe Note neu', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bil-'))
    const notes = fakeNotes()
    const s = createBilanzSink({ dir, notes })
    await s.record(zeile(1)); await s.record(zeile(2))
    assert.equal(fs.readFileSync(path.join(dir, 'bilanz.jsonl'), 'utf-8').trim().split('\n').length, 2)
    assert.equal(notes.store.size, 1)
    assert.match([...notes.store.values()][0], /\| m \| ui \| 2 \|/)
  })
  it('die Note trägt genau eine Titelzeile', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bil-'))
    const notes = fakeNotes()
    await createBilanzSink({ dir, notes }).record(zeile(1))
    const body = [...notes.store.values()][0]
    assert.equal(body.split('\n').filter(l => /^#\s/.test(l)).length, 1)
  })
  it('Note vom User gelöscht: beim nächsten Eintrag neu anlegen', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bil-'))
    const notes = fakeNotes()
    const s = createBilanzSink({ dir, notes })
    await s.record(zeile(1))
    notes.store.clear()
    await s.record(zeile(2))
    assert.equal(notes.store.size, 1)
  })
  it('kaputte Zeile in der jsonl: übersprungen, nicht geworfen', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bil-'))
    fs.writeFileSync(path.join(dir, 'bilanz.jsonl'), '{kaputt\n')
    const notes = fakeNotes()
    await createBilanzSink({ dir, notes }).record(zeile(1))
    assert.match([...notes.store.values()][0], /\| m \| ui \| 1 \|/)
  })
})
