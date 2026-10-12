import * as fs from 'fs'
import * as path from 'path'
import type { NoteManager } from '../notes/note-manager'
import type { NoteSearchIndex } from '../notes/note-search-index'
import { renderBilanzNote, type BilanzZeile } from './bilanz'

export const BILANZ_NOTE_TITLE = 'Local Workshop: Bilanz'
export interface BilanzSink { record(z: BilanzZeile): Promise<void> }

/**
 * Hängt eine Zeile an `bilanz.jsonl` und schreibt die Note neu. Die Note-ID liegt
 * neben der Datei; ist die Note weg (vom User gelöscht), entsteht eine neue —
 * die jsonl ist die Wahrheit, die Note nur ihre Ansicht.
 *
 * Der Body trägt die einzige Titelzeile: `create` legt den Body unverändert ab
 * (der Titel steht im Frontmatter), `save` liest den Titel aus der ersten
 * `# `-Zeile des Bodys.
 *
 * Der Suchindex wird mitgeführt wie bei `mux_notes_create`: die Rolle liest ihre
 * Bilanz beim Start über `mux_notes_search`, und die fragt den Index, nicht das
 * Verzeichnis. Ohne das fand die Abnahme am 2026-10-12 die Note nicht.
 */
export function createBilanzSink(opts: {
  dir: string
  notes?: Pick<NoteManager, 'create' | 'save' | 'read'>
  index?: Pick<NoteSearchIndex, 'addOrUpdate'>
}): BilanzSink {
  const jsonl = path.join(opts.dir, 'bilanz.jsonl')
  const idFile = path.join(opts.dir, 'bilanz-note.json')
  const readAll = (): BilanzZeile[] => {
    let raw = ''
    try { raw = fs.readFileSync(jsonl, 'utf-8') } catch { return [] }
    const out: BilanzZeile[] = []
    for (const l of raw.split('\n')) {
      if (!l.trim()) continue
      try { out.push(JSON.parse(l) as BilanzZeile) } catch { /* kaputte Zeile: überspringen */ }
    }
    return out
  }
  return {
    async record(z) {
      fs.mkdirSync(opts.dir, { recursive: true })
      fs.appendFileSync(jsonl, JSON.stringify(z) + '\n', 'utf-8')
      // Die jsonl ist die Wahrheit, die Note nur eine Ansicht: ihr Scheitern darf das Urteil nicht kippen.
      const notes = opts.notes
      if (!notes) return
      try {
        const body = `# ${BILANZ_NOTE_TITLE}\n\n${renderBilanzNote(readAll())}`
        let id: string | null = null
        try { id = (JSON.parse(fs.readFileSync(idFile, 'utf-8')) as { id?: string }).id ?? null } catch { /* noch keine */ }
        if (id && (await notes.read(id))) {
          const info = await notes.save(id, body)
          opts.index?.addOrUpdate({ info, body })
          return
        }
        // `entity:local-workshop` ist ein Achsenwert (ENTITY_VALUES), die Note gehört dieser Rolle.
        const created = await notes.create(BILANZ_NOTE_TITLE, body, ['kind:reference', 'entity:local-workshop'])
        fs.writeFileSync(idFile, JSON.stringify({ id: created.id }) + '\n', 'utf-8')
        opts.index?.addOrUpdate({ info: created, body })
      } catch (err) {
        console.warn('[bilanz] Note nicht aktualisiert:', err)
      }
    },
  }
}
