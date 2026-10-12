import { describe, it, beforeEach } from 'node:test'
import * as assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'
import {
  runShell, dirtyFiles, headCommit, commitPaths, commitAll, changedSince,
  checksums, savePatchAndReset, toRepoRelative, currentBranch, loginShell, diffStat,
} from '../../../src/main/local-factory/git-ops'

let repo: string
const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, encoding: 'utf-8' }).trim()

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'lf-git-'))
  git('init', '-q')
  git('config', 'user.email', 't@t')
  git('config', 'user.name', 't')
  fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n')
  git('add', '.')
  git('commit', '-qm', 'init')
})

describe('git-ops', () => {
  it('runShell: Exitcode und Ausgabe, Timeout → null', async () => {
    assert.deepEqual(await runShell('echo hi; exit 3', repo, 5000), { exitCode: 3, output: 'hi\n' })
    assert.equal((await runShell('sleep 5', repo, 200)).exitCode, null)
  })
  it('dirtyFiles sieht geänderte und neue Dateien', async () => {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'b\n')
    fs.mkdirSync(path.join(repo, 'test'))
    fs.writeFileSync(path.join(repo, 'test', 'x.test.ts'), 'x')
    assert.deepEqual((await dirtyFiles(repo)).sort(), ['a.txt', 'test/x.test.ts'])
  })
  it('commitPaths committet nur die genannten Pfade', async () => {
    fs.writeFileSync(path.join(repo, 'a.txt'), 'b\n')
    fs.writeFileSync(path.join(repo, 'n.txt'), 'n')
    const h = await commitPaths(repo, ['n.txt'], 'nur n')
    assert.equal(h, await headCommit(repo))
    assert.deepEqual(await dirtyFiles(repo), ['a.txt'])
  })
  it('changedSince inkl. untracked; savePatchAndReset stellt die Basis her', async () => {
    const base = await headCommit(repo)
    fs.writeFileSync(path.join(repo, 'a.txt'), 'b\n')
    fs.writeFileSync(path.join(repo, 'neu.txt'), 'n')
    assert.deepEqual((await changedSince(repo, base)).sort(), ['a.txt', 'neu.txt'])
    const patch = path.join(os.tmpdir(), `lf-${Date.now()}.patch`)
    await savePatchAndReset(repo, base, patch)
    assert.match(fs.readFileSync(patch, 'utf-8'), /neu\.txt/)
    assert.deepEqual(await dirtyFiles(repo), [])
    assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf-8'), 'a\n')
  })
  it('changedSince nennt bei einem Rename alt und neu', async () => {
    const base = await headCommit(repo)
    git('mv', 'a.txt', 'b.txt')
    git('commit', '-qm', 'rename')
    assert.deepEqual((await changedSince(repo, base)).sort(), ['a.txt', 'b.txt'])
  })
  it('runShell: Timeout trifft auch Enkelprozesse', async () => {
    const t0 = Date.now()
    const r = await runShell('sleep 5; echo x', repo, 200)
    assert.equal(r.exitCode, null)
    assert.ok(Date.now() - t0 < 2000)
    const marker = path.join(repo, 'marker.tmp')
    await runShell(`sh -c 'sleep 3 && touch ${marker}'`, repo, 200)
    await new Promise(r2 => setTimeout(r2, 3500))
    assert.equal(fs.existsSync(marker), false)
  })
  it('savePatchAndReset verweigert ein Unterverzeichnis und fasst die Wurzel nicht an', async () => {
    fs.mkdirSync(path.join(repo, 'sub'))
    fs.writeFileSync(path.join(repo, 'sub', 's.txt'), 's')
    git('add', '.')
    git('commit', '-qm', 'sub')
    const base = await headCommit(repo)
    fs.writeFileSync(path.join(repo, 'a.txt'), 'dirty\n')
    await assert.rejects(savePatchAndReset(path.join(repo, 'sub'), base, path.join(os.tmpdir(), `lf-s-${Date.now()}.patch`)), /nicht die Wurzel/)
    assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf-8'), 'dirty\n')
  })
  it('savePatchAndReset sichert Binärdateien', async () => {
    const base = await headCommit(repo)
    fs.writeFileSync(path.join(repo, 'b.bin'), Buffer.from([0, 1, 2, 255]))
    const patch = path.join(os.tmpdir(), `lf-b-${Date.now()}.patch`)
    await savePatchAndReset(repo, base, patch)
    assert.match(fs.readFileSync(patch, 'utf-8'), /GIT binary patch/)
  })
  it('commitAll nimmt auch neue Dateien mit', async () => {
    const base = await headCommit(repo)
    fs.writeFileSync(path.join(repo, 'neu.txt'), 'n')
    await commitAll(repo, base, 'alles')
    assert.deepEqual(await dirtyFiles(repo), [])
  })
  it('commitAll faltet eigene Commits seit der Basis in genau einen ein (R14)', async () => {
    const base = await headCommit(repo)
    fs.writeFileSync(path.join(repo, 'w1.txt'), '1')
    git('add', '.'); git('commit', '-qm', 'worker 1')
    fs.writeFileSync(path.join(repo, 'w2.txt'), '2')
    await commitAll(repo, base, 'lf: zusammen')
    assert.equal(git('rev-parse', 'HEAD~1'), base)
    assert.equal(git('log', '-1', '--format=%s'), 'lf: zusammen')
    assert.deepEqual(git('show', '--name-only', '--format=', 'HEAD').split('\n').sort(), ['w1.txt', 'w2.txt'])
  })
  it('pre-commit-Hook mit exit 1 hält commitPaths und commitAll nicht auf (R14)', async () => {
    const hook = path.join(repo, '.git', 'hooks', 'pre-commit')
    fs.mkdirSync(path.dirname(hook), { recursive: true })
    fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 })
    const base = await headCommit(repo)
    fs.writeFileSync(path.join(repo, 't.txt'), 't')
    await commitPaths(repo, ['t.txt'], 'lf: Abnahmetest #1')
    fs.writeFileSync(path.join(repo, 'a.txt'), 'neu\n')
    await commitAll(repo, base, 'lf: gruen')
    assert.equal(git('log', '-1', '--format=%s'), 'lf: gruen')
    assert.deepEqual(await dirtyFiles(repo), [])
  })
  it('currentBranch nennt den ausgecheckten Branch', async () => {
    git('checkout', '-qb', 'feature')
    assert.equal(await currentBranch(repo), 'feature')
  })
  it('Nicht-ASCII-Dateinamen kommen unmaskiert zurück (core.quotepath=off)', async () => {
    const base = await headCommit(repo)
    fs.writeFileSync(path.join(repo, 'grün.txt'), 'g')
    fs.writeFileSync(path.join(repo, 'a.txt'), 'b\n')
    git('add', 'a.txt')
    git('mv', 'a.txt', 'ä.txt')
    assert.ok((await dirtyFiles(repo)).includes('grün.txt'))
    assert.ok((await dirtyFiles(repo)).includes('ä.txt'))
    assert.ok((await changedSince(repo, base)).includes('ä.txt'))
  })
  it('savePatchAndReset schreibt den Patch byte-genau (kein UTF-8-Umweg)', async () => {
    const base = await headCommit(repo)
    const latin1 = Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]) // "café" in Latin-1
    fs.writeFileSync(path.join(repo, 'a.txt'), latin1)
    const patch = path.join(os.tmpdir(), `lf-l1-${Date.now()}.patch`)
    await savePatchAndReset(repo, base, patch)
    git('apply', patch)
    assert.deepEqual(fs.readFileSync(path.join(repo, 'a.txt')), latin1)
  })
  it('checksums: fehlende Datei fehlt im Ergebnis', () => {
    const c = checksums(repo, ['a.txt', 'fehlt.txt'])
    assert.equal(Object.keys(c).length, 1)
    assert.equal(c['a.txt'].length, 64)
  })
  it('toRepoRelative', () => {
    assert.equal(toRepoRelative('/p', '/p/test/x.ts'), 'test/x.ts')
    assert.equal(toRepoRelative('/p', 'test/x.ts'), 'test/x.ts')
    assert.equal(toRepoRelative('/p', './test/x.ts'), 'test/x.ts')
  })
})

describe('diffStat', () => {
  it('zählt Dateien und geänderte Zeilen zwischen zwei Commits', async () => {
    const base = await headCommit(repo)
    fs.writeFileSync(path.join(repo, 'b.txt'), 'x\ny\n'); git('add', '.'); git('commit', '-qm', 'b')
    const head = git('rev-parse', 'HEAD')
    assert.deepEqual(await diffStat(repo, base, head), { dateien: 1, zeilen: 2 })
  })
})

describe('loginShell', () => {
  it('zsh, wo es sie gibt; sonst /bin/sh (Linux-CI hat keine zsh)', () => {
    assert.equal(loginShell(() => true), '/bin/zsh')
    assert.equal(loginShell(() => false), '/bin/sh')
  })
})
