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
    tags: [] as string[][],
    async create(title: string, body: string, tags?: string[]) { this.tags.push(tags ?? []); const id = `N${++n}`; store.set(id, body); return { id } as any },
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
    assert.deepEqual(notes.tags, [['kind:reference', 'entity:local-workshop']])
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

describe('BilanzSink — Ausfälle', () => {
  it('Note-Manager wirft: record löst auf, die jsonl hat die Zeile', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bil-'))
    const kaputt = {
      async create(): Promise<never> { throw new Error('platte voll') },
      async save(): Promise<never> { throw new Error('platte voll') },
      async read(): Promise<never> { throw new Error('platte voll') },
    }
    const warn = console.warn; console.warn = () => {}
    try { await createBilanzSink({ dir, notes: kaputt as any }).record(zeile(1)) } finally { console.warn = warn }
    assert.equal(fs.readFileSync(path.join(dir, 'bilanz.jsonl'), 'utf-8').trim().split('\n').length, 1)
  })
  it('ohne Note-Manager: nur die jsonl', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bil-'))
    await createBilanzSink({ dir }).record(zeile(1))
    assert.equal(fs.readFileSync(path.join(dir, 'bilanz.jsonl'), 'utf-8').trim().split('\n').length, 1)
  })
})

/**
 * Die Rolle liest ihre Bilanz beim Start über `mux_notes_search`, und die Suche
 * fragt den Suchindex, nicht das Verzeichnis. Gemessen in der Abnahme am
 * 2026-10-12: Note geschrieben, Suche fand sie nicht — der Lernkreis hatte keine
 * Quelle. Die Senke muss den Index mitführen, wie `mux_notes_create` es tut.
 */
describe('BilanzSink — Suchindex', () => {
  it('neue und neu geschriebene Note landen im Index, mit aktuellem Body', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bil-'))
    const notes = fakeNotes()
    const indexed: { id: string; body: string }[] = []
    const index = { addOrUpdate: (c: { info: { id: string }; body: string }) => { indexed.push({ id: c.info.id, body: c.body }) } }
    const s = createBilanzSink({ dir, notes, index })
    await s.record(zeile(1))
    await s.record(zeile(2))
    assert.equal(indexed.length, 2)
    assert.equal(indexed[0].id, indexed[1].id)
    assert.match(indexed[1].body, /Stand: 2 Aufträge/)
  })
})
