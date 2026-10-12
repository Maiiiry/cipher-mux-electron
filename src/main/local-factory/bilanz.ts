import type { Lauf } from './lauf'

/**
 * Die Bilanz des Local Workshops (Spec 2026-10-12 §5). Fakten misst der Läufer,
 * das Urteil gibt Claude — so kann die Rolle die Zahlen nicht schönreden.
 */

export const ERGEBNISSE = ['uebernommen', 'nachgebessert', 'neu-geschnitten', 'selbst-uebernommen'] as const
export const KATEGORIEN = ['test', 'boilerplate', 'refactor', 'doku', 'ui', 'config', 'logik'] as const
export type Ergebnis = typeof ERGEBNISSE[number]
export type Kategorie = typeof KATEGORIEN[number]
export interface Urteil { ergebnis: Ergebnis; kategorie: Kategorie; notiz?: string }

export interface BilanzZeile {
  ts: string; projekt: string; workspaceId: string | null; laufId: string; haeppchen: number
  profil: string | null; modell: string | null; mitTest: boolean; anlaeufe: number; dauerSek: number
  dateien: number; diffZeilen: number; workerTokens: { input: number; output: number } | null
  ergebnis: Ergebnis; kategorie: Kategorie; notiz: string | null
}

export function validateUrteil(u: Partial<Urteil>): string[] {
  const errs: string[] = []
  if (!ERGEBNISSE.includes(u.ergebnis as Ergebnis)) errs.push(`ergebnis: eins von ${ERGEBNISSE.join(', ')}`)
  if (!KATEGORIEN.includes(u.kategorie as Kategorie)) errs.push(`kategorie: eins von ${KATEGORIEN.join(', ')}`)
  if (u.ergebnis === 'nachgebessert' && !(typeof u.notiz === 'string' && u.notiz.trim())) {
    errs.push('notiz: Pflicht bei nachgebessert — eine Zeile, was nicht stimmte')
  }
  return errs
}

export function buildBilanzZeile(
  lauf: Lauf, nummer: number, u: Urteil, ctx: { now: string; workspaceId: string | null; mitTest: boolean },
): BilanzZeile {
  const h = lauf.haeppchen.find(x => x.nummer === nummer)!
  const last = h.versuche.at(-1)
  const dauerMs = h.versuche.reduce((s, v) => s + Math.max(0, (v.beendet ?? v.gestartet) - v.gestartet), 0)
  return {
    ts: ctx.now, projekt: lauf.projekt, workspaceId: ctx.workspaceId, laufId: lauf.id, haeppchen: nummer,
    profil: last?.profil ?? null, modell: last?.modell ?? null, mitTest: ctx.mitTest,
    anlaeufe: h.versuche.length, dauerSek: Math.round(dauerMs / 1000),
    dateien: last?.dateien ?? 0, diffZeilen: last?.diffZeilen ?? 0, workerTokens: last?.tokensAmEnde ?? null,
    ergebnis: u.ergebnis, kategorie: u.kategorie, notiz: u.notiz?.trim() || null,
  }
}

const komma = (n: number): string => n.toFixed(1).replace('.', ',')

export function renderBilanzNote(zeilen: BilanzZeile[]): string {
  if (zeilen.length === 0) return 'Noch keine Aufträge. Die erste Zeile entsteht beim ersten Urteil.\n'
  const gruppen = new Map<string, BilanzZeile[]>()
  for (const z of zeilen) {
    const k = `${z.modell ?? '(unbekannt)'}\u0000${z.kategorie}`
    gruppen.set(k, [...(gruppen.get(k) ?? []), z])
  }
  const rows = [...gruppen.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, zs]) => {
    const [modell, kategorie] = k.split('\u0000')
    const ohne = zs.filter(z => z.ergebnis === 'uebernommen').length
    const schnitt = zs.reduce((s, z) => s + z.anlaeufe, 0) / zs.length
    return `| ${modell} | ${kategorie} | ${zs.length} | ${ohne} | ${komma(schnitt)} |`
  })
  const notizen = zeilen
    .filter(z => z.ergebnis === 'nachgebessert' && z.notiz)
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, 10)
    .map(z => `- ${z.ts.slice(0, 10)} · ${z.modell ?? '?'} · ${z.kategorie}: ${z.notiz}`)
  return [
    `Stand: ${zeilen.length} Aufträge. Quelle: \`bilanz.jsonl\` — diese Note wird bei jedem Urteil neu geschrieben.`,
    '',
    '| Modell | Kategorie | Aufträge | ohne Nachbesserung übernommen | Anläufe im Schnitt |',
    '|---|---|---|---|---|',
    ...rows,
    '',
    '## Zuletzt nachgebessert',
    '',
    ...(notizen.length ? notizen : ['- (noch nichts)']),
    '',
  ].join('\n')
}
