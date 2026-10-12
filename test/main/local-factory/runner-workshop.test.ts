// test/main/local-factory/runner.test.ts
import { describe, it, beforeEach } from 'node:test'
import * as assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'
import { LocalFactoryRunner, type WorkerHost, type RunnerRolle } from '../../../src/main/local-factory/runner'
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
