/**
 * Gate ohne Modell (Spec §7, Schritt 6).
 *
 * Zwei unabhängige Wege prüfen den Testschutz, weil jeder eine Lücke des
 * anderen schließt: die Prüfsumme sieht Inhaltsänderungen auch an Dateien, die
 * git ignoriert; der Diff sieht jede Änderung, gleichgültig ob sie über das
 * Edit-Werkzeug oder die Shell kam — dort hat die Plugin-Grenze keine Augen.
 *
 * Ruling R6: Vollständige Normalisierung und fail-safe Iterationen.
 */

import { normalize } from 'path/posix'

export type GateVerdict = 'gruen' | 'rot' | 'haengt'

export interface GateInput {
  workerFinished: boolean
  /** null = Testbefehl lief nicht (Start fehlgeschlagen, Timeout). */
  testExitCode: number | null
  checksumsBefore: Record<string, string>
  checksumsAfter: Record<string, string>
  /** Repo-relativ, wie `git diff --name-only` sie liefert. */
  changedFiles: string[]
  /** Repo-relativ. */
  protectedFiles: string[]
  /** Default true. Der Workshop darf ohne geschützte Tests arbeiten; der Testbefehl entscheidet dann allein. */
  testPflicht?: boolean
}

export interface GateResult {
  verdict: GateVerdict
  reasons: string[]
}

const norm = (p: string): string => normalize(p).replace(/^\.\//, '')

export function touchedProtected(changed: string[], protectedFiles: string[]): string[] {
  const prot = new Set(protectedFiles.map(norm))
  return changed.map(norm).filter(f => prot.has(f))
}

export function decideGate(input: GateInput): GateResult {
  const reasons: string[] = []

  // Check protected files (empty list is an error condition)
  if (input.protectedFiles.length === 0 && input.testPflicht !== false) {
    reasons.push('Keine geschützten Abnahmetests angegeben.')
    return { verdict: 'rot', reasons }
  }

  // Normalize checksums
  const beforeNorm = Object.fromEntries(Object.entries(input.checksumsBefore).map(([k, v]) => [norm(k), v]))
  const afterNorm = Object.fromEntries(Object.entries(input.checksumsAfter).map(([k, v]) => [norm(k), v]))

  // Check if worker finished (but still compute protection reasons)
  const touched = touchedProtected(input.changedFiles, input.protectedFiles)
  if (touched.length > 0) reasons.push(`Geschützte Tests verändert: ${touched.join(', ')}`)

  // Separate baseline missing from checksum changed
  const baseline: string[] = []
  const changed: string[] = []
  for (const f of input.protectedFiles) {
    const nf = norm(f)
    if (touched.includes(nf)) continue // Already reported via diff
    if (beforeNorm[nf] === undefined || afterNorm[nf] === undefined) {
      baseline.push(nf)
    } else if (afterNorm[nf] !== beforeNorm[nf]) {
      changed.push(nf)
    }
  }

  if (baseline.length > 0) reasons.push(`Baseline fehlt für geschützten Test: ${baseline.join(', ')}`)
  if (changed.length > 0) reasons.push(`Prüfsumme geschützter Tests abweichend: ${changed.join(', ')}`)

  if (!input.workerFinished) {
    return {
      verdict: 'haengt',
      reasons: ['Worker ist nicht fertig geworden (Timeout oder Stillstand).'].concat(reasons),
    }
  }

  if (input.testExitCode === null) reasons.push('Testbefehl ist nicht gelaufen.')
  else if (input.testExitCode !== 0) reasons.push(`Testbefehl rot (Exit ${input.testExitCode}).`)

  return { verdict: reasons.length === 0 ? 'gruen' : 'rot', reasons }
}
