import * as fs from 'fs'
import * as path from 'path'

/**
 * Zustand und Zählung eines Laufs (Spec §8). JSON statt SQLite-Spalten: das
 * wäre eine Migration, und die Datei ist direkt lesbar. Alle Übergänge sind
 * rein; nur load/save berühren die Platte.
 *
 * MAX_VERSUCHE ist hier und nicht im Prompt erzwungen (Spec E3).
 */

export const MAX_VERSUCHE = 2

export type HaeppchenStatus = 'laeuft' | 'wartet' | 'abgenommen' | 'eskaliert' | 'abgebrochen'
type Verdict = 'gruen' | 'rot' | 'haengt'

export interface Versuch {
  nr: number
  gestartet: number
  beendet?: number
  verdict?: Verdict
  gatePfad?: string
  patchPfad?: string
  commit?: string
  tokensAmEnde?: { input: number; output: number }
  /** Profil und Modell, die der Worker bekam (aus local-profile.json). Spec 2026-10-12 §5. */
  profil?: string
  modell?: string
}

export interface Haeppchen {
  nummer: number
  ziel: string
  status: HaeppchenStatus
  versuche: Versuch[]
}

export interface Lauf {
  id: string
  projekt: string
  erstellt: number
  weckrufe: number
  haeppchen: Haeppchen[]
  /**
   * Branch, auf dem der Lauf begann. Ein späterer Dispatch auf einem anderen
   * Branch wird abgelehnt — sonst setzt ein Worker, der den Branch gewechselt
   * und dort den Abnahmetest geschwächt hat, die neue Basis.
   * Fehlt in Läufen aus älteren Fassungen.
   */
  branch?: string
}

export function newLauf(id: string, projekt: string, now: number, branch?: string): Lauf {
  return { id, projekt, erstellt: now, weckrufe: 0, haeppchen: [], ...(branch ? { branch } : {}) }
}

const replaceH = (lauf: Lauf, h: Haeppchen): Lauf => ({
  ...lauf,
  haeppchen: lauf.haeppchen.map(x => (x.nummer === h.nummer ? h : x)),
})

export function beginVersuch(
  lauf: Lauf,
  opts: { nummer?: number; ziel: string; now: number },
): { lauf: Lauf; nummer: number; versuch: number } | { error: string } {
  if (lauf.haeppchen.some(h => h.status === 'laeuft')) {
    return { error: 'Es läuft bereits ein Worker. Nacheinander (Spec E2).' }
  }
  if (opts.nummer === undefined) {
    const nummer = lauf.haeppchen.reduce((m, h) => Math.max(m, h.nummer), 0) + 1
    const h: Haeppchen = {
      nummer, ziel: opts.ziel, status: 'laeuft', versuche: [{ nr: 1, gestartet: opts.now }],
    }
    return { lauf: { ...lauf, haeppchen: [...lauf.haeppchen, h] }, nummer, versuch: 1 }
  }
  const h = lauf.haeppchen.find(x => x.nummer === opts.nummer)
  if (!h) return { error: `Häppchen #${opts.nummer} gibt es in diesem Lauf nicht.` }
  if (h.status === 'eskaliert') {
    return { error: `Häppchen #${h.nummer} ist eskaliert (${MAX_VERSUCHE} Versuche). An den User melden.` }
  }
  if (h.status === 'abgenommen') return { error: `Häppchen #${h.nummer} ist schon abgenommen.` }
  if (h.versuche.length >= MAX_VERSUCHE) {
    return { error: `Häppchen #${h.nummer} hat ${MAX_VERSUCHE} Versuche hinter sich. An den User melden.` }
  }
  const versuch = h.versuche.length + 1
  const next: Haeppchen = {
    ...h, ziel: opts.ziel, status: 'laeuft', versuche: [...h.versuche, { nr: versuch, gestartet: opts.now }],
  }
  return { lauf: replaceH(lauf, next), nummer: h.nummer, versuch }
}

export function endVersuch(
  lauf: Lauf,
  nummer: number,
  patch: Partial<Versuch> & { verdict: Verdict },
  now: number,
): Lauf {
  const h = lauf.haeppchen.find(x => x.nummer === nummer)
  if (!h || h.versuche.length === 0) return lauf
  if (h.status !== 'laeuft') return lauf
  const versuche = [...h.versuche]
  versuche[versuche.length - 1] = { ...versuche[versuche.length - 1], ...patch, beendet: now }
  const status: HaeppchenStatus =
    patch.verdict === 'gruen' ? 'wartet' : versuche.length >= MAX_VERSUCHE ? 'eskaliert' : 'wartet'
  return replaceH(lauf, { ...h, versuche, status })
}

export function markAbgenommen(lauf: Lauf, nummer: number): Lauf {
  const h = lauf.haeppchen.find(x => x.nummer === nummer)
  if (!h || h.status !== 'wartet') return lauf
  const lastVersuch = h.versuche[h.versuche.length - 1]
  if (!lastVersuch || lastVersuch.verdict !== 'gruen') return lauf
  return replaceH(lauf, { ...h, status: 'abgenommen' })
}

export function countWeckruf(lauf: Lauf): Lauf {
  return { ...lauf, weckrufe: lauf.weckrufe + 1 }
}

export function abortRunning(lauf: Lauf): Lauf {
  return {
    ...lauf,
    haeppchen: lauf.haeppchen.map(h => (h.status === 'laeuft' ? { ...h, status: 'abgebrochen' } : h)),
  }
}

const STATUS: readonly HaeppchenStatus[] = ['laeuft', 'wartet', 'abgenommen', 'eskaliert', 'abgebrochen']
const num = (n: unknown, d: number): number => (typeof n === 'number' && Number.isFinite(n) ? n : d)

/** Defensiv wie alles Persistierte: eine Datei aus einer älteren Fassung wird aufgefüllt. */
export function parseLauf(raw: unknown): Lauf | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || typeof r.projekt !== 'string') return null
  const haeppchen: Haeppchen[] = []
  for (const x of Array.isArray(r.haeppchen) ? r.haeppchen : []) {
    if (!x || typeof x !== 'object') continue
    const h = x as Record<string, unknown>
    if (typeof h.nummer !== 'number' || typeof h.ziel !== 'string') continue
    const versuche: Versuch[] = []
    if (Array.isArray(h.versuche)) {
      for (let i = 0; i < h.versuche.length; i++) {
        const v = h.versuche[i]
        if (v && typeof v === 'object' && typeof (v as Versuch).nr === 'number') {
          versuche.push(v as Versuch)
        } else {
          versuche.push({ nr: i + 1, gestartet: 0, verdict: 'haengt' })
        }
      }
    }
    haeppchen.push({
      nummer: h.nummer,
      ziel: h.ziel,
      // Ohne Status weiß niemand, was daraus wurde — „abgebrochen" behauptet am wenigsten.
      status: STATUS.includes(h.status as HaeppchenStatus) ? (h.status as HaeppchenStatus) : 'abgebrochen',
      versuche,
    })
  }
  return {
    id: r.id, projekt: r.projekt, erstellt: num(r.erstellt, 0), weckrufe: num(r.weckrufe, 0), haeppchen,
    ...(typeof r.branch === 'string' && r.branch ? { branch: r.branch } : {}),
  }
}

export function loadLauf(file: string): Lauf | null {
  try {
    return parseLauf(JSON.parse(fs.readFileSync(file, 'utf-8')))
  } catch {
    return null
  }
}

export function saveLauf(file: string, lauf: Lauf): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(lauf, null, 2) + '\n', 'utf-8')
  fs.renameSync(tmp, file)
}
