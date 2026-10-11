import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import path from 'path'
import { buildRestoreSequence, parsePaneSnapshot } from '../../src/shared/terminal-resync'
import { TmuxManager } from '../../src/main/tmux/tmux-manager'

/**
 * Der Neuaufbau aus dem tmux-Schnappschuss muss den Bildschirm **an derselben
 * Stelle** und den Cursor **in derselben Zeile** hinterlassen wie tmux.
 *
 * Gemessen am 2026-10-11 an einer Claude-Code-Session: tmux hatte den Cursor in
 * Zeile 24 von 33 (das Eingabefeld, darunter acht Zeilen Statusleiste). Der alte
 * Neuaufbau liess ihn ans Ende des geschriebenen Texts fallen, und `trim()` in
 * `runCommand` schnitt die leeren Zeilen am Ende ab. Claude Code malt relativ zum
 * Cursor („n Zeilen hoch, löschen, neu schreiben“) — der nächste Neuzeichnen-Zug
 * landete deshalb zu tief, und darüber blieben Reste alter Dialoge und eine
 * doppelte Statuszeile stehen.
 */

describe('buildRestoreSequence', () => {
  it('setzt den Cursor auf die Zeile und Spalte, die tmux meldet', () => {
    const seq = buildRestoreSequence({ content: 'a\nb\nc\nd', cursorX: 2, cursorY: 1 })
    assert.ok(seq.endsWith('\x1b[2;3H'), `endet nicht mit der Cursorposition: ${JSON.stringify(seq.slice(-12))}`)
  })

  it('behält leere Zeilen am Ende — sie sind Teil des Bildschirms', () => {
    const seq = buildRestoreSequence({ content: 'oben\n\n\n', cursorX: 0, cursorY: 0 })
    // vier Zeilen → drei Zeilenwechsel; keiner mehr, sonst rollt alles um eine hoch
    const body = seq.split('\x1b[0m')[0]
    assert.equal(body, 'oben\r\n\r\n\r\n')
  })

  it('hängt keinen Zeilenwechsel ans Ende — der würde den Bildschirm um eine Zeile rollen', () => {
    const seq = buildRestoreSequence({ content: 'x\ny', cursorX: 0, cursorY: 0 })
    assert.ok(!seq.includes('y\r\n'))
  })
})

describe('parsePaneSnapshot', () => {
  it('liest Cursor aus der Kopfzeile und lässt den Inhalt unangetastet', () => {
    const s = parsePaneSnapshot('3 7\n  eingerückt\nmitte\n\n\n')
    assert.deepEqual(s, { cursorX: 3, cursorY: 7, content: '  eingerückt\nmitte\n\n' })
  })
})

const SESSION = 'cmux-test-snapshot'
function tmux(...args: string[]): string {
  return execFileSync('tmux', args, { encoding: 'utf-8', timeout: 15_000 })
}
function tmuxAvailable(): boolean {
  try { execFileSync('tmux', ['-V'], { stdio: 'ignore' }); return true } catch { return false }
}

describe('snapshotPane gegen echtes tmux', { skip: !tmuxAvailable() }, () => {
  before(() => {
    try { tmux('kill-session', '-t', SESSION) } catch { /* nicht da */ }
    // 10 Zeilen hoch; Text oben, Cursor in Zeile 3, darunter leer — wie ein
    // Eingabefeld mit Statusleiste darunter.
    tmux('new-session', '-d', '-s', SESSION, '-x', '40', '-y', '10',
      "printf '\\033[2J\\033[1;1Hkopf\\033[9;1Hstatus\\033[3;5H'; sleep 30")
    execFileSync('sleep', ['0.5'])
  })
  after(() => { try { tmux('kill-session', '-t', SESSION) } catch { /* weg */ } })

  it('liefert Cursor und alle sichtbaren Zeilen, auch die leeren am Ende', async () => {
    const tm = new TmuxManager()
    const s = await tm.snapshotPane(SESSION, 0)
    tm.disconnect()
    assert.equal(s.cursorY, 2)
    assert.equal(s.cursorX, 4)
    const lines = s.content.split('\n')
    assert.equal(lines.length, 10, `erwartet 10 Zeilen, waren ${lines.length}`)
    assert.equal(lines[0].trimEnd(), 'kopf')
    assert.equal(lines[8].trimEnd(), 'status')
  })
})

describe('useTerminal baut über den Schnappschuss neu auf', () => {
  it('kein terminal.capture mehr im Hook, jeder Neuaufbau geht über buildRestoreSequence', () => {
    const src = readFileSync(path.join(__dirname, '../../src/renderer/hooks/useTerminal.ts'), 'utf-8')
    assert.equal([...src.matchAll(/terminal\.capture\(/g)].length, 0)
    const snaps = [...src.matchAll(/terminal\.snapshot\(/g)].length
    const builds = [...src.matchAll(/buildRestoreSequence\(/g)].length
    assert.ok(snaps >= 2, `erwartet mindestens zwei Schnappschüsse, waren ${snaps}`)
    assert.equal(builds, snaps)
  })
})
