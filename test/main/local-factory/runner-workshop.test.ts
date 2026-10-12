// test/main/local-factory/runner.test.ts
import { describe, it, beforeEach } from 'node:test'
import * as assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'
import { LocalFactoryRunner, type WorkerHost, type RunnerRolle } from '../../../src/main/local-factory/runner'
import { createWorkerLock } from '../../../src/main/local-factory/worker-lock'
import { loadLauf } from '../../../src/main/local-factory/lauf'
import { IDLE_SIGNAL_FILENAME } from '../../../src/main/local-factory/worker-done'

let repo: string
let laufDir: string
const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, encoding: 'utf-8' }).trim()

// Abnahmetest: rot, solange impl.txt nicht "ok" enthält.
const TEST_CMD = 'grep -q ok impl.txt'

type Behaviour = 'brav' | 'schummelt' | 'haengt' | 'nicht-bereit' | 'committet' | 'wechselt-branch'

function fakeHost(behaviour: Behaviour): WorkerHost & { wakes: string[]; sent: string[]; wakeRollen: (string | undefined)[]; startedWith: (string | undefined)[] } {
  let runDir = ''
  const wakes: string[] = []
  const sent: string[] = []
  const wakeRollen: (string | undefined)[] = []
  const startedWith: (string | undefined)[] = []
  return {
    wakes, sent, wakeRollen, startedWith,
    async workerReady() {
      return behaviour === 'nicht-bereit' ? 'Endpunkt des lokalen Modells antwortet nicht (HTTP 404)' : null
    },
    async startFreshWorker(_projekt, profil) {
      startedWith.push(profil)
      runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-run-'))
      return { runDir, sessionId: 's1', profil: 'mac', modell: 'm-mac' }
    },
    async sendToWorker(_id, line) {
      sent.push(line)
      if (behaviour === 'haengt') return
      if (behaviour === 'wechselt-branch') git('checkout', '-qb', 'worker-eigen')
      fs.writeFileSync(path.join(repo, 'impl.txt'), 'ok\n')
      if (behaviour === 'committet') {
        git('add', '-A'); git('commit', '-qm', 'worker: eigener Commit')
        fs.writeFileSync(path.join(repo, 'extra.txt'), 'x\n')
      }
      if (behaviour === 'schummelt') fs.writeFileSync(path.join(repo, 'test', 'accept.sh'), 'exit 0\n')
      fs.writeFileSync(path.join(runDir, 'REPORT.md'), 'fertig')
      // Idle nach dem Report — sonst wartet der Läufer bis zum Timeout und wertet „hängt“.
      fs.writeFileSync(path.join(runDir, IDLE_SIGNAL_FILENAME), String(Date.now() + 1000))
    },
    async stopWorker() {},
    lastActivityAt() { return behaviour === 'haengt' ? 0 : Date.now() - 60_000 },
    tokensAt() { return { input: 10, output: 5 } },
    async wakeArchitect(line, rolle?: RunnerRolle) { wakes.push(line); wakeRollen.push(rolle) },
  }
}

const args = () => ({
  projekt: repo,
  ziel: 'impl sagt ok',
  dateien: ['impl.txt'],
  akzeptanzkriterium: 'impl.txt enthält ok',
  geschuetzteTests: ['test/accept.sh'],
  testBefehl: TEST_CMD,
  nichtZiele: [],
})

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-proj-'))
  laufDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-lauf-'))
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  fs.writeFileSync(path.join(repo, 'impl.txt'), 'nein\n')
  git('add', '.'); git('commit', '-qm', 'init')
  // Architekt hat den Abnahmetest geschrieben, nicht committet
  fs.mkdirSync(path.join(repo, 'test'))
  fs.writeFileSync(path.join(repo, 'test', 'accept.sh'), `${TEST_CMD}\n`)
})

const ws = (host: WorkerHost) => new LocalFactoryRunner({
  host, laufDir, rolle: 'local-workshop', sleep: async () => {}, pollMs: 0, startupWaitMs: 0,
  quietMs: 1000, stallMs: 5000, timeoutMs: 5000, testTimeoutMs: 5000,
})

describe('LocalFactoryRunner als local-workshop', () => {
  it('weckt die eigene Rolle und mit eigenem Präfix', async () => {
    const host = fakeHost('brav')
    const r = ws(host)
    await r.dispatch(args()); await r.whenIdle()
    assert.equal(host.wakeRollen[0], 'local-workshop')
    assert.match(host.wakes[0], /^\[local-workshop\] #1 „impl sagt ok“: GRÜN/)
  })

  it('ohne Abnahmetest: keine Rot-Prüfung vorab, Testbefehl entscheidet', async () => {
    // Testbefehl, der schon vorher grün ist — bei der Factory ein Ablehnungsgrund.
    fs.rmSync(path.join(repo, 'test'), { recursive: true })
    const host = fakeHost('brav')
    const r = ws(host)
    const res: any = await r.dispatch({ ...args(), geschuetzteTests: [], testBefehl: 'true' })
    assert.equal(res.ok, true, res.error)
    await r.whenIdle()
    assert.match(host.wakes[0], /GRÜN/)
  })

  it('ohne Abnahmetest und ohne Testbefehl: abgelehnt', async () => {
    const r = ws(fakeHost('brav'))
    const res: any = await r.dispatch({ ...args(), geschuetzteTests: [], testBefehl: '' })
    assert.equal(res.ok, false)
    assert.match(res.error, /testBefehl: leer/)
  })

  it('mit Abnahmetest: wie bei der Factory — vorher grün wird abgelehnt', async () => {
    fs.writeFileSync(path.join(repo, 'impl.txt'), 'ok\n'); git('add', '.'); git('commit', '-qm', 'schon ok')
    const res: any = await ws(fakeHost('brav')).dispatch(args())
    assert.match(res.error, /schon grün/)
  })

  it('nach zwei roten Anläufen: „ausgeschöpft, selbst übernehmen“ statt ESKALIERT', async () => {
    const host = fakeHost('haengt')
    const r = ws(host)
    const first: any = await r.dispatch(args()); await r.whenIdle()
    await r.dispatch({ ...args(), laufId: first.laufId, haeppchen: 1 }); await r.whenIdle()
    assert.match(host.wakes[1], /ausgeschöpft, selbst übernehmen$/)
    assert.doesNotMatch(host.wakes[1], /ESKALIERT/)
  })

  it('Profil und Modell stehen am Versuch', async () => {
    const host = fakeHost('brav')
    const r = ws(host)
    const res: any = await r.dispatch({ ...args(), profil: 'mac' }); await r.whenIdle()
    const v = loadLauf(res.laufPfad)!.haeppchen[0].versuche[0]
    assert.equal(v.profil, 'mac'); assert.equal(v.modell, 'm-mac')
    assert.equal(host.startedWith[0], 'mac')
  })

  it('Workshop-Session weg: Weckzeile verloren, lauf.json trotzdem vollständig (Review Focus 3)', async () => {
    const host = fakeHost('brav')
    host.wakeArchitect = async () => { /* niemand da — wie worker-host ohne Ziel */ }
    const r = ws(host)
    const res: any = await r.dispatch(args()); await r.whenIdle()
    const h = loadLauf(res.laufPfad)!.haeppchen[0]
    assert.equal(h.status, 'wartet')
    assert.ok(h.versuche[0].commit)
  })
})

describe('Factory unverändert', () => {
  it('leerer geschuetzteTests bleibt bei der Factory ein Fehler', async () => {
    const r = new LocalFactoryRunner({ host: fakeHost('brav'), laufDir })
    const res: any = await r.dispatch({ ...args(), geschuetzteTests: [] })
    assert.match(res.error, /mindestens ein Abnahmetest/)
  })
})

describe('Ein Worker zur Zeit', () => {
  const mk = (host: WorkerHost, lock: ReturnType<typeof createWorkerLock>) => new LocalFactoryRunner({
    host, laufDir, rolle: 'local-workshop', workerLock: lock, workspaceKey: 'ws',
    sleep: async () => {}, pollMs: 0, startupWaitMs: 0, quietMs: 1000, stallMs: 5000, timeoutMs: 5000, testTimeoutMs: 5000,
  })
  it('Worker belegt durch die andere Rolle: nicht bereit, kein Versuch, kein Lauf angelegt', async () => {
    const lock = createWorkerLock()
    lock.claim('ws', 'local-factory')
    const host = fakeHost('brav')
    const res: { ok: boolean; error?: string } = await mk(host, lock).dispatch(args())
    assert.equal(res.ok, false)
    assert.match(res.error ?? '', /Worker belegt durch local-factory/)
    assert.equal(fs.readdirSync(laufDir).length, 0)
    assert.equal(host.sent.length, 0)
  })
  it('nach dem Versuch wird der Worker freigegeben', async () => {
    const lock = createWorkerLock()
    const r = mk(fakeHost('brav'), lock)
    await r.dispatch(args()); await r.whenIdle()
    assert.equal(lock.claim('ws', 'local-factory'), null)
  })
  it('eine Ablehnung nach dem Holen (nicht bereit) gibt den Worker frei', async () => {
    const lock = createWorkerLock()
    const res: { ok: boolean; error?: string } = await mk(fakeHost('nicht-bereit'), lock).dispatch(args())
    assert.equal(res.ok, false)
    assert.equal(lock.claim('ws', 'local-factory'), null)
  })
  it('eine Validierungsablehnung holt den Worker gar nicht erst', async () => {
    const lock = createWorkerLock()
    const res: { ok: boolean; error?: string } = await mk(fakeHost('brav'), lock).dispatch({ ...args(), ziel: '' })
    assert.equal(res.ok, false)
    assert.equal(lock.claim('ws', 'local-factory'), null)
  })
})

describe('LocalFactoryRunner — Urteil und Bilanz', () => {
  it('Urteil: schreibt eine Bilanz-Zeile, zweites Urteil abgelehnt', async () => {
    const rec: any[] = []
    const host = fakeHost('brav')
    const r = new LocalFactoryRunner({ host, laufDir, rolle: 'local-workshop', bilanz: { record: async z => { rec.push(z) } },
      sleep: async () => {}, pollMs: 0, startupWaitMs: 0, quietMs: 1000, stallMs: 5000, timeoutMs: 5000, testTimeoutMs: 5000 })
    const res: any = await r.dispatch(args()); await r.whenIdle()
    assert.deepEqual(await r.judge(res.laufId, 1, { ergebnis: 'uebernommen', kategorie: 'ui' }), { ok: true })
    assert.equal(rec.length, 1)
    assert.equal(rec[0].dateien, 1); assert.ok(rec[0].diffZeilen >= 1)
    const zweites = await r.judge(res.laufId, 1, { ergebnis: 'uebernommen', kategorie: 'ui' })
    assert.equal(zweites.ok, false)
    assert.equal(rec.length, 1)
  })

  it('ein beurteiltes Häppchen lässt sich nicht erneut dispatchen', async () => {
    // Ohne Abnahmetest, sonst träfe die „schon grün“-Vorprüfung vor der Statusprüfung.
    fs.rmSync(path.join(repo, 'test'), { recursive: true })
    const a = { ...args(), geschuetzteTests: [], testBefehl: 'true' }
    const r = ws(fakeHost('brav'))
    const res: any = await r.dispatch(a); await r.whenIdle()
    await r.judge(res.laufId, 1, { ergebnis: 'uebernommen', kategorie: 'ui' })
    const again: any = await r.dispatch({ ...a, laufId: res.laufId, haeppchen: 1 })
    assert.equal(again.ok, false)
    assert.match(again.error, /schon beurteilt/)
  })

  it('Urteil ohne Felder wird abgelehnt', async () => {
    const r = ws(fakeHost('brav'))
    const res: any = await r.dispatch(args()); await r.whenIdle()
    const u = await r.judge(res.laufId, 1, {})
    assert.equal(u.ok, false)
  })

  it('selbst-uebernommen gilt auch für ein ausgeschöpftes Häppchen', async () => {
    const rec: any[] = []
    const host = fakeHost('haengt')
    const r = new LocalFactoryRunner({ host, laufDir, rolle: 'local-workshop', bilanz: { record: async z => { rec.push(z) } },
      sleep: async () => {}, pollMs: 0, startupWaitMs: 0, quietMs: 1000, stallMs: 5000, timeoutMs: 50, testTimeoutMs: 5000 })
    const a: any = await r.dispatch(args()); await r.whenIdle()
    await r.dispatch({ ...args(), laufId: a.laufId, haeppchen: 1 }); await r.whenIdle()
    assert.deepEqual(await r.judge(a.laufId, 1, { ergebnis: 'selbst-uebernommen', kategorie: 'logik' }), { ok: true })
    assert.equal(rec[0].anlaeufe, 2)
  })

  it('Urteil zu einem laufenden Häppchen: abgelehnt', async () => {
    const r = ws(fakeHost('brav'))
    const res: any = await r.dispatch(args())   // nicht abwarten
    const u = await r.judge(res.laufId, 1, { ergebnis: 'uebernommen', kategorie: 'ui' })
    assert.equal(u.ok, false)
    await r.whenIdle()
  })
})

describe('LocalFactoryRunner — Urteil: Reihenfolge und Rennen', () => {
  const mkr = (bilanz: { record(z: unknown): Promise<void> }) => new LocalFactoryRunner({
    host: fakeHost('brav'), laufDir, rolle: 'local-workshop', bilanz: bilanz as any,
    sleep: async () => {}, pollMs: 0, startupWaitMs: 0, quietMs: 1000, stallMs: 5000, timeoutMs: 5000, testTimeoutMs: 5000,
  })

  it('wirft die Senke, bleibt das Häppchen beurteilbar', async () => {
    let n = 0
    const r = mkr({ record: async () => { if (n++ === 0) throw new Error('jsonl') } })
    const res: any = await r.dispatch(args()); await r.whenIdle()
    const u1 = await r.judge(res.laufId, 1, { ergebnis: 'uebernommen', kategorie: 'ui' }).catch(e => ({ ok: false, e }))
    assert.equal(u1.ok, false)
    assert.notEqual(loadLauf(path.join(laufDir, res.laufId, 'lauf.json'))!.haeppchen[0].status, 'beurteilt')
    assert.deepEqual(await r.judge(res.laufId, 1, { ergebnis: 'uebernommen', kategorie: 'ui' }), { ok: true })
  })

  it('judge während prepare eines Folge-Dispatch: das Urteil bleibt, ein zweites wird abgelehnt', async () => {
    const rec: unknown[] = []
    const r = mkr({ record: async z => { rec.push(z) } })
    const a: any = await r.dispatch(args()); await r.whenIdle()
    // Zweiter Auftrag mit eigenem, noch offenem Abnahmetest — dessen Commit in prepare ist das Fenster.
    fs.writeFileSync(path.join(repo, 'test', 'accept2.sh'), 'grep -q ok2 impl2.txt\n')
    const marker = path.join(os.tmpdir(), `lf-marker-${Date.now()}`)
    const hook = path.join(repo, '.git', 'hooks', 'post-commit')
    fs.writeFileSync(hook, `#!/bin/sh\ntouch ${marker}\nsleep 1\n`, { mode: 0o755 })
    const p = r.dispatch({ ...args(), laufId: a.laufId, ziel: 'zwei', geschuetzteTests: ['test/accept2.sh'], testBefehl: 'grep -q ok2 impl2.txt' })
    for (let i = 0; i < 200 && !fs.existsSync(marker); i++) await new Promise(res => setTimeout(res, 25))
    assert.ok(fs.existsSync(marker), 'Fenster nicht erreicht')
    assert.deepEqual(await r.judge(a.laufId, 1, { ergebnis: 'uebernommen', kategorie: 'ui' }), { ok: true })
    const d: any = await p
    assert.equal(d.ok, true, d.error)
    await r.whenIdle()
    const lauf = loadLauf(path.join(laufDir, a.laufId, 'lauf.json'))!
    assert.equal(lauf.haeppchen.find(h => h.nummer === 1)!.status, 'beurteilt')
    assert.equal((await r.judge(a.laufId, 1, { ergebnis: 'uebernommen', kategorie: 'ui' })).ok, false)
    assert.equal(rec.length, 1)
  })
})
