// src/main/local-factory/runner.ts
import * as fs from 'fs'
import * as path from 'path'
import { ulid } from 'ulidx'
import { validateAuftrag, buildAuftragMd, type AuftragInput } from './auftrag'
import { decideGate, type GateResult } from './gate'
import {
  newLauf, beginVersuch, endVersuch, countWeckruf, markAbgenommen, markBeurteilt,
  loadLauf, saveLauf, abortRunning, MAX_VERSUCHE, type Lauf,
} from './lauf'
import { classifyWorker, IDLE_SIGNAL_FILENAME } from './worker-done'
import {
  runShell, dirtyFiles, headCommit, commitPaths, commitAll, changedSince,
  checksums, savePatchAndReset, toRepoRelative, isRepoRoot, currentBranch, diffStat,
} from './git-ops'
import { PROTECTED_PATHS_FILENAME } from '../session/entity-boundaries'
import { createWorkerLock, type WorkerLock } from './worker-lock'
import { validateUrteil, buildBilanzZeile, type Urteil } from './bilanz'
import type { BilanzSink } from './bilanz-sink'

/**
 * Der Läufer (Spec §7). Kein Modell: er startet, wartet, prüft und weckt.
 * Der Architekt verbraucht nur Züge, wenn es etwas zu entscheiden gibt —
 * das ist der ganze Grund, warum er existiert (Keel: Warten kostete Tokens).
 */

export interface WorkerHost {
  /**
   * Bereitschaft (Ruling R15): null = bereit, sonst der Grund, warum nicht —
   * nicht konfiguriert, skipPermissions aus, Endpunkt antwortet nicht mit 2xx.
   */
  workerReady(profil?: string): Promise<string | null>
  /**
   * Schreibt das aufgelöste Profil ins Run-Verzeichnis, bevor der Adapter es liest.
   * profil/modell optional, damit Hosts ohne Profile gültig bleiben.
   */
  startFreshWorker(
    projekt: string,
    profil?: string,
  ): Promise<{ runDir: string; sessionId: string; profil?: string; modell?: string }>
  sendToWorker(sessionId: string, line: string): Promise<void>
  stopWorker(sessionId: string): Promise<void>
  lastActivityAt(sessionId: string): number
  tokensAt(sessionId: string): { input: number; output: number } | null
  wakeArchitect(line: string, rolle?: RunnerRolle): Promise<void>
}

export type RunnerRolle = 'local-factory' | 'local-workshop'

export interface RunnerOpts {
  host: WorkerHost
  /** Wurzel für Läufe: <laufDir>/<laufId>/lauf.json, gate-*.json, *.patch */
  laufDir: string
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  pollMs?: number
  startupWaitMs?: number
  quietMs?: number
  stallMs?: number
  timeoutMs?: number
  testTimeoutMs?: number
  /** Wer beauftragt. Bestimmt Weckziel, Präfix, Testpflicht, Ausschöpfungstext. Default: local-factory. */
  rolle?: RunnerRolle
  /** Sperre „ein Worker pro Workspace“. Default: eine eigene je Läufer, also ohne Wirkung über Läufer hinweg. */
  workerLock?: WorkerLock
  /** Schlüssel der Sperre (Workspace). */
  workspaceKey?: string
  /** Senke für Urteile (nur local-workshop). Ohne sie bleibt ein Urteil ohne Bilanz-Zeile. */
  bilanz?: BilanzSink
  /** Workspace für die Bilanz-Zeile; null = ungebunden. */
  workspaceId?: string | null
}

export interface DispatchArgs extends AuftragInput {
  laufId?: string
  haeppchen?: number
  /** Modellprofil (Spec 2026-10-12 §4.4); fehlt = Standardprofil. */
  profil?: string
}

export type DispatchAccepted = { ok: true; laufId: string; nummer: number; versuch: number; laufPfad: string }
export type DispatchRejected = { ok: false; error: string }
export type AcceptResult = { ok: true } | { ok: false; error: string }

/** Höchstlänge einer Weckzeile. Sie geht per send-keys in ein Eingabefeld. */
export const MAX_WECKZEILE = 400

/**
 * Eine Weckzeile ist genau eine Zeile: ein Zeilenumbruch darin (aus ziel oder
 * einem Fehlertext) schickte per send-keys eine Teilzeile ab.
 */
export function oneLine(s: string, max = MAX_WECKZEILE): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat
}

const LAUF_ID = /^[A-Za-z0-9_-]{1,64}$/

interface Attempt {
  args: DispatchArgs; prot: string[]; base: string; branch: string; sumsBefore: Record<string, string>
  laufId: string; laufPfad: string; nummer: number; versuch: number
  vorherigesGate?: { reasons: string[]; testOutput: string }
}

interface GateRecord extends GateResult { testOutput: string }

export class LocalFactoryRunner {
  private readonly o: Required<Omit<RunnerOpts, 'host' | 'laufDir' | 'bilanz' | 'workspaceId'>> & Pick<RunnerOpts, 'host' | 'laufDir' | 'bilanz' | 'workspaceId'>
  private running: Promise<void> = Promise.resolve()
  private busy = false
  /** Laufende Urteile, `${laufId}#${nummer}` — verhindert doppelte Bilanz-Zeilen. */
  private readonly judging = new Set<string>()

  constructor(opts: RunnerOpts) {
    this.o = {
      now: () => Date.now(),
      sleep: ms => new Promise(r => setTimeout(r, ms)),
      pollMs: 15_000,
      startupWaitMs: 12_000,
      quietMs: 30_000,
      stallMs: 10 * 60_000,
      timeoutMs: 60 * 60_000,
      testTimeoutMs: 15 * 60_000,
      rolle: 'local-factory',
      workerLock: createWorkerLock(),
      workspaceKey: '__unbound__',
      ...opts,
    }
  }

  whenIdle(): Promise<void> {
    return this.running
  }

  private laufFile(laufId: string): string {
    return path.join(this.o.laufDir, laufId, 'lauf.json')
  }

  /** Ehrlicher Status: ok nur, wenn tatsächlich etwas abgenommen wurde. */
  accept(laufId: string, nummer: number): AcceptResult {
    if (!LAUF_ID.test(laufId)) return { ok: false, error: 'laufId ungültig.' }
    const f = this.laufFile(laufId)
    const lauf = loadLauf(f)
    if (!lauf) return { ok: false, error: `Lauf ${laufId} unbekannt.` }
    const next = markAbgenommen(lauf, nummer)
    if (next === lauf) {
      const h = lauf.haeppchen.find(x => x.nummer === nummer)
      return {
        ok: false,
        error: h
          ? `Häppchen #${nummer} ist nicht grün-wartend (Status ${h.status}, letztes Urteil ${h.versuche.at(-1)?.verdict ?? 'keins'}).`
          : `Häppchen #${nummer} gibt es in Lauf ${laufId} nicht.`,
      }
    }
    saveLauf(f, next)
    return { ok: true }
  }

  /** Urteil des Workshops: Lauf markieren, Bilanz-Zeile schreiben (Spec 2026-10-12 §5). */
  async judge(laufId: string, nummer: number, u: Partial<Urteil>): Promise<AcceptResult> {
    const errs = validateUrteil(u)
    if (errs.length) return { ok: false, error: `Urteil ungültig: ${errs.join('; ')}` }
    if (!LAUF_ID.test(laufId)) return { ok: false, error: 'laufId ungültig.' }
    // Vor dem ersten await: zwei gleichzeitige Urteile zum selben Häppchen würden sonst beide
    // die Prüfung bestehen und zwei Bilanz-Zeilen schreiben.
    const claim = `${laufId}#${nummer}`
    if (this.judging.has(claim)) return { ok: false, error: `Urteil zu Häppchen #${nummer} läuft bereits.` }
    this.judging.add(claim)
    try {
      const f = this.laufFile(laufId)
      const lauf = loadLauf(f)
      if (!lauf) return { ok: false, error: `Lauf ${laufId} unbekannt.` }
      const probe = markBeurteilt(lauf, nummer)
      if (probe === lauf) {
        const h = lauf.haeppchen.find(x => x.nummer === nummer)
        return { ok: false, error: h ? `Häppchen #${nummer} ist nicht zu beurteilen (Status ${h.status}).` : `Häppchen #${nummer} gibt es nicht.` }
      }
      const h = probe.haeppchen.find(x => x.nummer === nummer)!
      // Erst die Zeile, dann der Status: wirft das Anhängen, bleibt das Häppchen beurteilbar und ein
      // Retry ist möglich. Schlimmstenfalls steht eine Zeile da und der Aufruf meldet Fehler — der
      // Retry schreibt eine zweite sichtbare Zeile; besser als ein Urteil, das nie verbucht werden kann.
      // Weil `record` echte I/O ist, wird der Status danach auf einem FRISCH geladenen Lauf gesetzt
      // (ohne await bis zum Speichern): ein `prepare` kann dazwischen ein neues Häppchen gespeichert haben.
      await this.o.bilanz?.record(buildBilanzZeile(probe, nummer, u as Urteil, {
        now: new Date(this.o.now()).toISOString(), workspaceId: this.o.workspaceId ?? null, mitTest: h.mitTest ?? true,
      }))
      const frisch = loadLauf(f)
      const next = frisch ? markBeurteilt(frisch, nummer) : null
      if (!frisch || !next || next === frisch) {
        const grund = !frisch ? 'Lauf nicht mehr lesbar' : `Status ${frisch.haeppchen.find(x => x.nummer === nummer)?.status ?? 'unbekannt'}`
        return { ok: false, error: `Bilanz-Zeile geschrieben, Status nicht gesetzt: ${grund}.` }
      }
      saveLauf(f, next)
      return { ok: true }
    } finally {
      this.judging.delete(claim)
    }
  }

  private get testPflicht(): boolean { return this.o.rolle === 'local-factory' }
  private get praefix(): string { return `[${this.o.rolle}]` }

  private wake(line: string): Promise<void> {
    return this.o.host.wakeArchitect(oneLine(line), this.o.rolle)
  }

  async dispatch(args: DispatchArgs): Promise<DispatchAccepted | DispatchRejected> {
    const errs = validateAuftrag(args, { testPflicht: this.testPflicht })
    if (errs.length) return { ok: false, error: `Auftrag ungültig: ${errs.join('; ')}` }
    if (args.laufId !== undefined && !LAUF_ID.test(args.laufId)) {
      return { ok: false, error: 'laufId ungültig: nur A-Z, a-z, 0-9, _ und -, höchstens 64 Zeichen.' }
    }
    if (this.busy) return { ok: false, error: 'Es läuft bereits ein Worker. Nacheinander (Spec E2).' }
    // Vor jeder Datei und jedem await: eine belegte Sperre legt keinen Lauf an und zählt keinen Versuch.
    const haelt = this.o.workerLock.claim(this.o.workspaceKey, this.o.rolle)
    if (haelt) {
      return { ok: false, error: `Nicht bereit: Worker belegt durch ${haelt} — kein Versuch gezählt.` }
    }
    // Synchron setzen: zwischen Prüfung und Start liegen mehrere awaits (Spec E2).
    this.busy = true
    let res: DispatchAccepted | DispatchRejected
    try {
      res = await this.prepare(args)
    } catch (err) {
      res = { ok: false, error: `Vorprüfung fehlgeschlagen: ${String(err)}` }
    }
    if (!res.ok) this.release()
    return res
  }

  /** busy und Workersperre gehören zusammen: nie eines ohne das andere freigeben. */
  private release(): void {
    this.busy = false
    this.o.workerLock.release(this.o.workspaceKey, this.o.rolle)
  }

  private async prepare(args: DispatchArgs): Promise<DispatchAccepted | DispatchRejected> {
    if (!(await isRepoRoot(args.projekt))) {
      return { ok: false, error: `projekt ist nicht die Wurzel eines git-Repos: ${args.projekt}` }
    }

    // Branch-Bindung: Ein Lauf bleibt auf dem Branch, auf dem er begann. Ein
    // Worker, der den Branch wechselt, hinterlässt dort womöglich einen
    // geschwächten Abnahmetest; der Gate wird dann rot ohne Reset (fremder
    // Branch). Ohne diese Prüfung würde der nächste Dispatch genau diesen Stand
    // als neue Basis nehmen.
    const branchJetzt = await currentBranch(args.projekt)
    if (branchJetzt === 'HEAD') {
      return { ok: false, error: 'HEAD ist losgelöst — ein Lauf braucht einen ausgecheckten Branch.' }
    }
    if (args.laufId !== undefined) {
      const vorhanden = loadLauf(this.laufFile(args.laufId))
      if (vorhanden && path.resolve(vorhanden.projekt) !== path.resolve(args.projekt)) {
        return { ok: false, error: `Lauf ${args.laufId} gehört zu einem anderen Projekt: ${vorhanden.projekt}` }
      }
      if (vorhanden?.branch && vorhanden.branch !== branchJetzt) {
        return {
          ok: false,
          error: `Lauf ${args.laufId} gehört zu Branch ${vorhanden.branch}, ausgecheckt ist ${branchJetzt}. `
            + `Vermutlich hat der Worker den Branch gewechselt — zurück auf ${vorhanden.branch} `
            + `und den Branch ${branchJetzt} von Hand prüfen.`,
        }
      }
    }
    const nichtBereit = await this.o.host.workerReady(args.profil)
    if (nichtBereit !== null) {
      await this.wake(`${this.praefix} Nicht bereit: ${nichtBereit} — kein Versuch gezählt.`)
      return { ok: false, error: oneLine(`Nicht bereit: ${nichtBereit}. Kein Versuch gezählt.`) }
    }

    const projekt = args.projekt
    const prot = args.geschuetzteTests.map(t => toRepoRelative(projekt, t))

    // Offene Dateien dürfen nur die geschützten Tests sein — die committet der Läufer als Basis.
    const dirty = await dirtyFiles(projekt)
    const fremd = dirty.filter(f => !prot.includes(f))
    if (fremd.length) {
      // Ein „laeuft“ im Lauf heißt: ein Versuch wurde unterbrochen (App-Neustart),
      // und die offenen Dateien sind sehr wahrscheinlich seine Reste.
      const rest = args.laufId !== undefined
        ? loadLauf(this.laufFile(args.laufId))?.haeppchen.find(h => h.status === 'laeuft')
        : undefined
      const hinweis = rest
        ? ` — vermutlich Rest eines unterbrochenen Versuchs #${rest.nummer} — Patch sichern oder Baum zurücksetzen`
        : ''
      return { ok: false, error: `Arbeitsbaum nicht sauber, außer den Abnahmetests offen: ${fremd.join(', ')}${hinweis}` }
    }
    const fehlend = prot.filter(f => !fs.existsSync(path.join(projekt, f)))
    if (fehlend.length) return { ok: false, error: `Abnahmetest fehlt: ${fehlend.join(', ')}` }

    // Ohne Abnahmetest (Workshop) gibt es nichts, was vorab rot sein müsste.
    if (prot.length > 0) {
      const vorher = await runShell(args.testBefehl, projekt, this.o.testTimeoutMs)
      if (vorher.exitCode === 0) {
        return { ok: false, error: 'Der Abnahmetest ist vor der Arbeit schon grün — er prüft nichts.' }
      }
    }

    const laufId = args.laufId ?? ulid()
    const laufPfad = this.laufFile(laufId)
    let lauf0: Lauf = loadLauf(laufPfad) ?? newLauf(laufId, projekt, this.o.now(), branchJetzt)
    // Läufe aus älteren Fassungen tragen keinen Branch: ab jetzt gilt der aktuelle.
    if (!lauf0.branch) lauf0 = { ...lauf0, branch: branchJetzt }
    // busy war beim Eintritt frei: ein „laeuft“ ohne lebenden Durchlauf in diesem Prozess ist ein Rest eines App-Neustarts (Spec §9).
    if (lauf0.haeppchen.some(h => h.status === 'laeuft')) {
      lauf0 = abortRunning(lauf0)
      saveLauf(laufPfad, lauf0)
    }
    const begun = beginVersuch(lauf0, { nummer: args.haeppchen, ziel: args.ziel, now: this.o.now(), mitTest: prot.length > 0 })
    if ('error' in begun) return { ok: false, error: begun.error }

    const offeneTests = dirty.filter(f => prot.includes(f))
    if (offeneTests.length) await commitPaths(projekt, offeneTests, `lf: Abnahmetest #${begun.nummer}`)
    const base = await headCommit(projekt)
    const branch = branchJetzt
    const sumsBefore = checksums(projekt, prot)
    // Frisch laden und ohne await dazwischen speichern: `judge` ist nicht durch busy
    // geschützt und kann während der awaits oben ein Urteil geschrieben haben. Ein
    // Speichern des veralteten `begun.lauf` hätte es überschrieben (zweites Urteil, zweite Bilanz-Zeile).
    const frisch = beginVersuch(loadLauf(laufPfad) ?? lauf0, {
      nummer: args.haeppchen, ziel: args.ziel, now: this.o.now(), mitTest: prot.length > 0,
    })
    if ('error' in frisch) return { ok: false, error: frisch.error }
    saveLauf(laufPfad, frisch.lauf)

    // Vorheriges Gate für einen zweiten Versuch — aus der Datei, nicht vom Architekten.
    const prevV = args.haeppchen !== undefined
      ? lauf0.haeppchen.find(h => h.nummer === begun.nummer)?.versuche.at(-1)
      : undefined
    let vorherigesGate: { reasons: string[]; testOutput: string } | undefined
    if (prevV?.gatePfad) {
      try {
        const g = JSON.parse(fs.readFileSync(prevV.gatePfad, 'utf-8')) as GateRecord
        vorherigesGate = { reasons: g.reasons ?? [], testOutput: g.testOutput ?? '' }
      } catch { /* kein lesbares Gate — dann ohne */ }
    }

    this.running = this.runAttempt({
      args, prot, base, branch, sumsBefore, laufId, laufPfad,
      nummer: begun.nummer, versuch: begun.versuch, vorherigesGate,
    })
      .catch(err => this.wake(`${this.praefix} #${begun.nummer} Läuferfehler: ${String(err)}`).catch(() => {}))
      .finally(() => { this.release() })

    return { ok: true, laufId, nummer: begun.nummer, versuch: begun.versuch, laufPfad }
  }

  private async runAttempt(a: Attempt): Promise<void> {
    const started: { sessionId?: string; settled?: boolean } = {}
    try {
      await this.runAttemptInner(a, started)
    } catch (err) {
      // Nach dem Commit bzw. dem regulären Patch+Reset ist der Versuch entschieden;
      // ein späterer Fehler (Lauf speichern, Wecken) darf daran nichts mehr ändern.
      if (started.settled) throw err
      // Aufräumen: Häppchen nicht in „laeuft“ lassen, Baum zurück auf Basis.
      try {
        const dir = path.dirname(a.laufPfad)
        const patch = path.join(dir, `versuch-${a.nummer}-${a.versuch}.patch`)
        // Auf einem fremden Branch kein reset --hard: er zöge diesen Branch auf die Basis.
        if ((await currentBranch(a.args.projekt)) === a.branch) {
          await savePatchAndReset(a.args.projekt, a.base, patch)
        }
      } catch { /* Patch/Reset best effort */ }
      try {
        const lauf = loadLauf(a.laufPfad)
        if (lauf) saveLauf(a.laufPfad, endVersuch(lauf, a.nummer, { verdict: 'haengt' }, this.o.now()))
      } catch { /* */ }
      throw err
    } finally {
      if (started.sessionId) {
        try { await this.o.host.stopWorker(started.sessionId) } catch { /* */ }
      }
    }
  }

  private async runAttemptInner(a: Attempt, started: { sessionId?: string; settled?: boolean }): Promise<void> {
    const { host } = this.o
    const projekt = a.args.projekt
    const { runDir, sessionId, profil, modell } = await host.startFreshWorker(projekt, a.args.profil)
    started.sessionId = sessionId

    fs.writeFileSync(
      path.join(runDir, PROTECTED_PATHS_FILENAME),
      JSON.stringify(a.prot.map(p => path.join(projekt, p))),
      'utf-8',
    )
    const auftragPfad = path.join(runDir, 'AUFTRAG.md')
    fs.writeFileSync(
      auftragPfad,
      buildAuftragMd(a.args, { nummer: a.nummer, versuch: a.versuch, vorherigesGate: a.vorherigesGate }),
      'utf-8',
    )
    for (const f of ['REPORT.md', IDLE_SIGNAL_FILENAME]) {
      try { fs.unlinkSync(path.join(runDir, f)) } catch { /* nicht da */ }
    }

    await this.o.sleep(this.o.startupWaitMs)
    const startedAt = this.o.now()
    await host.sendToWorker(sessionId, `Lies ${auftragPfad}, arbeite ihn ab, schreib REPORT.md.`)

    let state = classifyWorker(this.observe(runDir, sessionId, startedAt), this.cfg())
    while (state === 'arbeitet') {
      await this.o.sleep(this.o.pollMs)
      state = classifyWorker(this.observe(runDir, sessionId, startedAt), this.cfg())
    }
    const tokens = host.tokensAt(sessionId)
    await host.stopWorker(sessionId)
    started.sessionId = undefined

    // Branch gewechselt: reset --soft/--hard würde den fremden Branch auf die
    // Basis ziehen, ein checkout zurück kann an offenen Dateien scheitern oder
    // sie mitnehmen. Konservativ: rot, nichts anfassen, Grund nennen.
    const branchJetzt = await currentBranch(projekt)
    const branchGewechselt = branchJetzt !== a.branch

    const test = state === 'fertig' && !branchGewechselt
      ? await runShell(a.args.testBefehl, projekt, this.o.testTimeoutMs)
      : { exitCode: null, output: '' }
    const gate: GateResult = branchGewechselt
      ? {
          verdict: 'rot',
          reasons: [`Worker hat den Branch gewechselt (${a.branch} → ${branchJetzt}). Nichts zurückgesetzt — Baum von Hand prüfen.`],
        }
      : decideGate({
          workerFinished: state === 'fertig',
          testExitCode: test.exitCode,
          checksumsBefore: a.sumsBefore,
          checksumsAfter: checksums(projekt, a.prot),
          changedFiles: await changedSince(projekt, a.base),
          protectedFiles: a.prot,
          testPflicht: this.testPflicht,
        })

    const dir = path.dirname(a.laufPfad)
    const gatePfad = path.join(dir, `gate-${a.nummer}-${a.versuch}.json`)
    fs.writeFileSync(gatePfad, JSON.stringify({ ...gate, testOutput: test.output } satisfies GateRecord, null, 2), 'utf-8')

    let commit: string | undefined
    let patchPfad: string | undefined
    let stat: { dateien: number; zeilen: number } | undefined
    if (branchGewechselt) {
      started.settled = true
    } else if (gate.verdict === 'gruen') {
      await commitAll(projekt, a.base, `lf: ${oneLine(a.args.ziel, 200)}`)
      // Direkt nach dem commit, vor jedem weiteren await: ab hier ist der
      // Versuch entschieden; ein Fehler in headCommit darf nicht zum Reset führen.
      started.settled = true
      commit = await headCommit(projekt)
      // Messwert für die Bilanz; fehlt er, fehlt er — der Versuch ist schon entschieden.
      try { stat = await diffStat(projekt, a.base, commit) } catch { /* */ }
    } else {
      patchPfad = path.join(dir, `versuch-${a.nummer}-${a.versuch}.patch`)
      await savePatchAndReset(projekt, a.base, patchPfad)
      started.settled = true
    }

    let lauf = loadLauf(a.laufPfad) ?? newLauf(a.laufId, projekt, this.o.now())
    lauf = endVersuch(lauf, a.nummer, {
      verdict: gate.verdict, gatePfad, ...(patchPfad ? { patchPfad } : {}), ...(commit ? { commit } : {}),
      ...(stat ? { dateien: stat.dateien, diffZeilen: stat.zeilen } : {}),
      ...(tokens ? { tokensAmEnde: tokens } : {}),
      ...(profil ? { profil } : {}), ...(modell ? { modell } : {}),
    }, this.o.now())
    lauf = countWeckruf(lauf)
    saveLauf(a.laufPfad, lauf)

    const h = lauf.haeppchen.find(x => x.nummer === a.nummer)
    // ziel gekappt, damit Gate- bzw. Laufpfad am Ende der Zeile nicht abgeschnitten wird.
    const kopf = `${this.praefix} #${a.nummer} „${oneLine(a.args.ziel, 120)}“`
    const zahl = `Versuch ${a.versuch}/${MAX_VERSUCHE}`
    const line = gate.verdict === 'gruen'
      ? `${kopf}: GRÜN, ${zahl}, Commit ${commit!.slice(0, 8)}, Lauf: ${a.laufPfad}`
      : `${kopf}: ${gate.verdict === 'rot' ? 'ROT' : 'HÄNGT'}, ${zahl}, Gate: ${gatePfad}`
        + (branchGewechselt ? ' — Worker hat den Branch gewechselt, Baum nicht zurückgesetzt' : '')
        + (h?.status === 'eskaliert'
          ? (this.o.rolle === 'local-workshop' ? ' — ausgeschöpft, selbst übernehmen' : ' — ESKALIERT, an den User melden')
          : '')
    await this.wake(line)
  }

  private cfg() {
    return { quietMs: this.o.quietMs, timeoutMs: this.o.timeoutMs, stallMs: this.o.stallMs }
  }

  private observe(runDir: string, sessionId: string, startedAt: number) {
    const mtime = (f: string): number | null => {
      try { return fs.statSync(path.join(runDir, f)).mtimeMs } catch { return null }
    }
    let idle: number | null = null
    try { idle = Number(fs.readFileSync(path.join(runDir, IDLE_SIGNAL_FILENAME), 'utf-8')) || null } catch { /* */ }
    return {
      now: this.o.now(),
      startedAt,
      reportMtime: mtime('REPORT.md'),
      idleSignalAt: idle,
      lastActivityAt: Math.max(startedAt, this.o.host.lastActivityAt(sessionId)),
    }
  }
}
