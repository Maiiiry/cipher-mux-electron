import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import { spawn, execFile } from 'child_process'
import { promisify } from 'util'
import { runCommand, getEnhancedPath } from '../util/exec-util'

/**
 * git und Shell für den Läufer. Alles, was der Gate prüft, kommt von hier —
 * nicht aus dem, was der Worker berichtet.
 */

/**
 * Die Shell für Testbefehle: zsh, wie im Terminal des Users (macOS-Standard,
 * dort kommt node/npm aus dem Profil). Wo es keine zsh gibt — die Linux-CI —
 * `/bin/sh`; ein fest verdrahtetes /bin/zsh ließ dort jeden runShell-Aufruf
 * mit ENOENT scheitern.
 */
export function loginShell(exists: (p: string) => boolean = fs.existsSync): string {
  return exists('/bin/zsh') ? '/bin/zsh' : '/bin/sh'
}

export async function runShell(
  cmd: string,
  cwd: string,
  timeoutMs: number,
): Promise<{ exitCode: number | null; output: string }> {
  return new Promise(resolve => {
    // -l: der Testbefehl soll dieselbe Umgebung sehen wie im Terminal (node,
    // npm, flutter aus dem Profil-PATH).
    // detached: eigene Prozessgruppe, damit der Timeout auch Enkelprozesse
    // (npm test, a && b) trifft und nicht nur die Shell.
    const child = spawn(loginShell(), ['-lc', cmd], {
      cwd,
      env: { ...process.env, PATH: getEnhancedPath() },
      detached: true,
    })
    let output = ''
    let done = false
    const finish = (exitCode: number | null, extra = ''): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ exitCode, output: output + extra })
    }
    child.stdout.on('data', d => { output += d })
    child.stderr.on('data', d => { output += d })
    const timer = setTimeout(() => {
      try { process.kill(-child.pid!, 'SIGKILL') } catch { /* Gruppe schon weg */ }
      finish(null)
    }, timeoutMs)
    child.on('close', code => finish(code))
    child.on('error', err => finish(null, String(err)))
  })
}

export function toRepoRelative(projekt: string, p: string): string {
  const rel = path.isAbsolute(p) ? path.relative(projekt, p) : p
  return rel.replace(/^\.\//, '')
}

const git = (projekt: string, args: string[]): Promise<string> =>
  runCommand('git', args, { cwd: projekt, timeout: 30_000 })

const lines = (s: string): string[] => s.split('\n').map(l => l.trim()).filter(Boolean)

// core.quotepath=off: sonst maskiert git Nicht-ASCII-Namen als "\303\244.txt",
// und der Vergleich mit den geschützten Pfaden schlägt still fehl.
const NO_QUOTE = ['-c', 'core.quotepath=off']

export async function dirtyFiles(projekt: string): Promise<string[]> {
  const tracked = lines(await git(projekt, [...NO_QUOTE, 'diff', '--name-only', '--no-renames', 'HEAD']))
  const untracked = lines(await git(projekt, [...NO_QUOTE, 'ls-files', '--others', '--exclude-standard']))
  return [...new Set([...tracked, ...untracked])]
}

/** Ausgecheckter Branch; „HEAD“ bei losgelöstem HEAD. */
export async function currentBranch(projekt: string): Promise<string> {
  return git(projekt, ['rev-parse', '--abbrev-ref', 'HEAD'])
}

export async function headCommit(projekt: string): Promise<string> {
  return git(projekt, ['rev-parse', 'HEAD'])
}

// --no-verify (Ruling R14): Hooks des Ziel-Repos (z. B. husky mit Tests) würden
// den absichtlich roten Abnahmetest-Commit blockieren. Die Qualitätsprüfung ist
// der Gate, nicht der Hook.
export async function commitPaths(projekt: string, paths: string[], message: string): Promise<string> {
  await git(projekt, ['add', '--', ...paths])
  await git(projekt, ['commit', '-q', '--no-verify', '-m', message, '--', ...paths])
  return headCommit(projekt)
}

/**
 * Grüner Abschluss (R14): alles seit `base` — auch Commits, die der Worker
 * selbst gemacht hat — wird zu genau einem Commit. Gibt bewusst keinen Hash
 * zurück: der Läufer muss den Versuch direkt nach dem erfolgreichen commit als
 * entschieden markieren, bevor ein weiterer Aufruf (headCommit) scheitern kann.
 */
export async function commitAll(projekt: string, base: string, message: string): Promise<void> {
  await git(projekt, ['reset', '-q', '--soft', base])
  await git(projekt, ['add', '-A'])
  await git(projekt, ['commit', '-q', '--no-verify', '-m', message])
}

export async function changedSince(projekt: string, base: string): Promise<string[]> {
  // --no-renames: ein umbenannter Test erscheint sonst nur mit dem Zielpfad,
  // und der Gate übersähe, dass ein geschützter Pfad verschwunden ist.
  const tracked = lines(await git(projekt, [...NO_QUOTE, 'diff', '--name-only', '--no-renames', base]))
  const untracked = lines(await git(projekt, [...NO_QUOTE, 'ls-files', '--others', '--exclude-standard']))
  return [...new Set([...tracked, ...untracked])]
}

export function checksums(projekt: string, files: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const f of files) {
    try {
      out[f] = crypto.createHash('sha256').update(fs.readFileSync(path.join(projekt, f))).digest('hex')
    } catch {
      // fehlt → fehlt im Ergebnis; decideGate wertet das als Abweichung
    }
  }
  return out
}

const execFileP = promisify(execFile)

export async function isRepoRoot(projekt: string): Promise<boolean> {
  try {
    const top = await git(projekt, ['rev-parse', '--show-toplevel'])
    return fs.realpathSync(top) === fs.realpathSync(projekt)
  } catch {
    return false
  }
}

/** Achtung: git reset --hard + clean -fd. Läuft nur, wenn projekt die Repo-Wurzel ist. */
export async function savePatchAndReset(projekt: string, base: string, patchFile: string): Promise<void> {
  // reset --hard würde sonst ein umschließendes Repo komplett zurücksetzen.
  if (!(await isRepoRoot(projekt))) {
    throw new Error(`projekt ist nicht die Wurzel eines git-Repos: ${projekt}`)
  }
  // Untracked erst in den Index (intent-to-add), damit der Patch sie enthält.
  await git(projekt, ['add', '-N', '.'])
  // Eigener Aufruf: großer Puffer, --binary, unbeschnitten.
  // encoding 'buffer': der Patch wird roh geschrieben. Ein UTF-8-Umweg machte
  // aus jedem Nicht-UTF-8-Byte (Latin-1-Text) ein U+FFFD, und der Patch ließe
  // sich nicht mehr anwenden.
  const { stdout } = await execFileP('git', ['diff', '--binary', base], {
    cwd: projekt,
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, PATH: getEnhancedPath() },
    encoding: 'buffer',
  })
  fs.mkdirSync(path.dirname(patchFile), { recursive: true })
  fs.writeFileSync(patchFile, stdout)
  await git(projekt, ['reset', '-q', '--hard', base])
  await git(projekt, ['clean', '-fdq'])
}

/** Umfang eines Commits für die Bilanz: Dateien und Zeilen (hinzu + weg). Binärdateien zählen als Datei, nicht als Zeilen. */
export async function diffStat(projekt: string, from: string, to: string): Promise<{ dateien: number; zeilen: number }> {
  const out = lines(await git(projekt, [...NO_QUOTE, 'diff', '--numstat', '--no-renames', from, to]))
  let zeilen = 0
  for (const l of out) {
    const [add, del] = l.split('\t')
    zeilen += (Number(add) || 0) + (Number(del) || 0)
  }
  return { dateien: out.length, zeilen }
}
