import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import path from 'path'
import { RESYNC_SCROLLBACK_LINES, needsReflowResync } from '../../src/shared/terminal-resync'

/**
 * Der Resync nach einem Resize — zwei Behauptungen, und beide stehen gegen etwas
 * Echtes.
 *
 * Die eine ist eine ueber **unseren Code**: dass eine reine Hoehenaenderung keinen
 * Resync bekommt. Die andere ist eine ueber **tmux**: dass `capture-pane` ohne `-S`
 * nur den sichtbaren Bereich liefert und eine reine Hoehenaenderung keine Zeile
 * umbricht. Die zweite laeuft deshalb gegen das echte tmux, wie bei
 * `capture-pane-join.test.ts` — ein Mock wuerde genau die Annahme festschreiben,
 * die zu pruefen ist.
 *
 * Woran das haengt: `term.reset()` ersetzt den Scrollback durch einen neuen Puffer.
 * Was der Schnappschuss nicht enthaelt, ist danach weg. Vor dem 2026-10-02 holte der
 * Resync nur den sichtbaren Bereich — jeder Resize kostete also die Historie, und
 * hochscrollen ging danach nicht mehr.
 */

const SESSION = 'cmux-test-resync'
const WIDTH = 80
const SHORT_ROWS = 15
const TALL_ROWS = 30
const COUNT = 400
/** Breiter als der Pane, also sicher umgebrochen — und mit -J wieder zusammenfuegbar. */
const LONG_LINE_LENGTH = 95

function tmux(...args: string[]): string {
  return execFileSync('tmux', args, { encoding: 'utf-8', timeout: 15_000 })
}

function tmuxAvailable(): boolean {
  try {
    execFileSync('tmux', ['-V'], { stdio: 'ignore', timeout: 5_000 })
    return true
  } catch {
    return false
  }
}

/** Alle reinen Zahlenzeilen aus einem Capture, als Text ohne Leerzeichen am Ende. */
function numberedLines(out: string): string[] {
  return out
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => /^\d+$/.test(l))
}

function resize(rows: number): void {
  tmux('resize-window', '-t', SESSION, '-x', String(WIDTH), '-y', String(rows))
  tmux('resize-pane', '-t', SESSION, '-x', String(WIDTH), '-y', String(rows))
}

describe('needsReflowResync', () => {
  it('eine reine Hoehenaenderung braucht keinen Resync', () => {
    // Der Fall, der in der Praxis vorkommt: eine Zelle auf doppelte Hoehe und
    // zurueck. Bis zum 2026-10-02 kostete jeder dieser Griffe den Scrollback.
    assert.equal(needsReflowResync({ cols: 81, rows: 15 }, { cols: 81, rows: 30 }), false)
    assert.equal(needsReflowResync({ cols: 81, rows: 30 }, { cols: 81, rows: 15 }), false)
  })

  it('ein Spaltenwechsel braucht ihn', () => {
    assert.equal(needsReflowResync({ cols: 81, rows: 15 }, { cols: 60, rows: 15 }), true)
  })

  it('beides zugleich auch', () => {
    assert.equal(needsReflowResync({ cols: 81, rows: 15 }, { cols: 60, rows: 30 }), true)
  })

  it('der erste Fit aus {0,0} ist ein Resync', () => {
    // Dort wird der Puffer erstmals gegen tmux gestellt — das soll passieren.
    assert.equal(needsReflowResync({ cols: 0, rows: 0 }, { cols: 81, rows: 15 }), true)
  })

  it('keine Aenderung braucht keinen', () => {
    assert.equal(needsReflowResync({ cols: 81, rows: 15 }, { cols: 81, rows: 15 }), false)
  })
})

describe('RESYNC_SCROLLBACK_LINES haengt an xterms Scrollback', () => {
  it('ist genau so gross wie xterms Default', () => {
    // Die 1000 sind keine runde Zahl aus dem Bauch: mehr zu holen hiesse, tmux
    // Zeilen zu entnehmen, die xterm beim Schreiben sofort wieder verwirft.
    // Steigt xterms Default mit einem Upgrade, soll das hier auffallen und nicht
    // stillschweigend Historie kosten.
    const file = path.join(
      __dirname,
      '../../node_modules/@xterm/xterm/src/common/services/OptionsService.ts',
    )
    const src = readFileSync(file, 'utf-8')
    const m = src.match(/^\s*scrollback:\s*(\d+)/m)
    assert.ok(m, 'scrollback-Default in xterms OptionsService.ts nicht gefunden')
    assert.equal(
      RESYNC_SCROLLBACK_LINES,
      Number(m[1]),
      `xterms Scrollback-Default ist ${m[1]}, RESYNC_SCROLLBACK_LINES ist ${RESYNC_SCROLLBACK_LINES} — angleichen oder die Begruendung in shared/terminal-resync.ts korrigieren`,
    )
  })
})

describe('die Aufrufstellen geben die Tiefe mit', () => {
  it('jeder Schnappschuss in useTerminal traegt RESYNC_SCROLLBACK_LINES', () => {
    // Das war der unsichtbare Teil des Defekts: der Parameter existierte auf dem
    // ganzen Weg — `capturePane(target, lines)`, `lines` im IPC-Handler — und wurde
    // vom Renderer nur nie mitgegeben. Ein Aufruf ohne zweites Argument sieht
    // voellig in Ordnung aus und kostet den Nutzer seine Historie. Geprueft wird
    // deshalb der Quelltext, so wie `code-writes-axis-tags.test.ts` es tut: die
    // Stelle laesst sich ohne DOM nicht ausfuehren, aber lesen laesst sie sich.
    const file = path.join(__dirname, '../../src/renderer/hooks/useTerminal.ts')
    const src = readFileSync(file, 'utf-8')
    const calls = [...src.matchAll(/terminal\.snapshot\(([^)]*)\)/g)]
    assert.ok(calls.length >= 2, `erwartet: mindestens zwei Aufrufe, waren ${calls.length}`)
    for (const [ganz, args] of calls) {
      assert.match(
        args,
        /,\s*RESYNC_SCROLLBACK_LINES/,
        `ohne Scrollback-Tiefe: ${ganz.trim()} — term.reset() wirft den Puffer weg, der Schnappschuss muss die Historie tragen`,
      )
    }
  })
})

describe('der Resync wartet den Resize ab', () => {
  // Die Invariante: **nie erfassen, bevor tmux die neue Breite hat.** Sonst
  // liefert `capture-pane` den Inhalt in der alten Breite, er wird in ein
  // Terminal der neuen geschrieben, und der falsche Umbruch bleibt bis zum
  // naechsten Resize stehen — `lastSizeRef` ist dann schon aktualisiert, ein
  // zweiter Resync kommt also nicht. Vor dem 2026-10-02 wurde das mit 200 ms
  // geraten, weil die Resize-IPC ein `send` ohne Rueckgabe war.
  //
  // Geprueft wird der Quelltext, weil die drei Stellen auf drei Ebenen liegen
  // (Preload, IPC-Handler, Hook) und keine davon ohne Electron laeuft. Eine
  // halbe Rueckkehr faellt ohnehin laut auf: mit `send` gibt das Preload
  // `undefined` zurueck und `resized.finally` wirft. Still waere nur die
  // vollstaendige — und genau die faengt das hier.

  it('das Preload gibt ein Promise zurueck, kein send', () => {
    const src = readFileSync(path.join(__dirname, '../../src/main/preload.ts'), 'utf-8')
    const m = src.match(/resize:[^\n]*\n?[^\n]*TERMINAL_RESIZE/)
    assert.ok(m, 'resize-Eintrag im Preload nicht gefunden')
    assert.match(
      m[0],
      /ipcRenderer\.invoke/,
      'terminal.resize muss `invoke` sein — mit `send` kann der Aufrufer nicht warten',
    )
  })

  it('der Main-Handler ist handle, nicht on', () => {
    const src = readFileSync(path.join(__dirname, '../../src/main/ipc-hub.ts'), 'utf-8')
    assert.match(
      src,
      /ipcMain\.handle\(IPC\.TERMINAL_RESIZE/,
      'TERMINAL_RESIZE braucht `handle` — `on` hat keine Rueckgabe',
    )
    assert.doesNotMatch(src, /ipcMain\.on\(IPC\.TERMINAL_RESIZE/)
  })

  it('jeder scheduleResync-Aufruf haengt an der Resize-Zusage', () => {
    const src = readFileSync(path.join(__dirname, '../../src/renderer/hooks/useTerminal.ts'), 'utf-8')
    // Aufrufe, nicht Erwaehnungen: `scheduleResync(` mit Klammer. Die Definition
    // (`const scheduleResync = useCallback(`) und das Dependency-Array tragen
    // keine, fallen also von selbst heraus.
    const istKommentar = (text: string) => /^\s*(\/\/|\*|\/\*)/.test(text)
    const zeilen = src
      .split('\n')
      .map((text, i) => ({ nr: i + 1, text }))
      .filter(({ text }) => /scheduleResync\(\)/.test(text) && !istKommentar(text))
    assert.ok(zeilen.length >= 2, `erwartet: mindestens zwei Aufrufe, waren ${zeilen.length}`)
    for (const { nr, text } of zeilen) {
      assert.match(
        text,
        /\.finally\(\s*\(\)\s*=>\s*scheduleResync\(\)\s*\)/,
        `Zeile ${nr} ruft scheduleResync ohne auf den Resize zu warten: ${text.trim()}`,
      )
    }
  })
})

describe('capture-pane, Scrollback und reine Hoehenaenderung', { skip: tmuxAvailable() ? false : 'tmux nicht verfuegbar' }, () => {
  before(() => {
    try { tmux('kill-session', '-t', SESSION) } catch { /* lief nicht */ }
    tmux('new-session', '-d', '-s', SESSION, '-x', String(WIDTH), '-y', String(SHORT_ROWS))
    // Nicht auf den globalen Default verlassen — die Historie muss sicher reichen.
    tmux('set-option', '-t', SESSION, 'history-limit', '2000')
    tmux('send-keys', '-t', SESSION, `clear; seq 1 ${COUNT}; printf 'B%.0s' {1..${LONG_LINE_LENGTH}}; echo`, 'Enter')
    execFileSync('sh', ['-c', 'sleep 3'])
  })

  after(() => {
    try { tmux('kill-session', '-t', SESSION) } catch { /* schon weg */ }
  })

  it('OHNE -S liefert capture-pane nur den sichtbaren Bereich', () => {
    // Das ist der Defekt: in einen zurueckgesetzten xterm-Puffer geschrieben
    // ergibt das genau einen Bildschirm und null Scrollback.
    const sichtbar = numberedLines(tmux('capture-pane', '-t', SESSION, '-p', '-e', '-J'))
    assert.ok(
      sichtbar.length < COUNT / 4,
      `erwartet: deutlich weniger als ${COUNT} Zeilen, waren ${sichtbar.length}`,
    )
  })

  it('MIT -S kommt die Historie mit', () => {
    const mit = numberedLines(
      tmux('capture-pane', '-t', SESSION, '-p', '-e', '-J', '-S', `-${RESYNC_SCROLLBACK_LINES}`),
    )
    const ohne = numberedLines(tmux('capture-pane', '-t', SESSION, '-p', '-e', '-J'))
    assert.ok(mit.length > ohne.length * 3, `mit -S ${mit.length}, ohne ${ohne.length}`)
    // Und sie reicht bis zum Anfang zurueck, nicht nur ein Stueck weit.
    assert.equal(mit[0], '1', `erste Zeile der Historie war "${mit[0]}"`)
  })

  it('eine reine Hoehenaenderung aendert den Inhalt nicht', () => {
    // Die Begruendung dafuer, dass hier kein Resync laufen muss: es gibt keinen
    // Unterschied auszugleichen. Geprueft wird ueber die Historie mit, weil beim
    // Verkleinern Zeilen aus dem sichtbaren Bereich hinausrutschen — das ist
    // Verschieben, nicht Verlieren.
    const lies = () =>
      numberedLines(
        tmux('capture-pane', '-t', SESSION, '-p', '-e', '-J', '-S', `-${RESYNC_SCROLLBACK_LINES}`),
      )

    const vorher = lies()
    resize(TALL_ROWS)
    execFileSync('sh', ['-c', 'sleep 0.5'])
    const hoch = lies()
    resize(SHORT_ROWS)
    execFileSync('sh', ['-c', 'sleep 0.5'])
    const zurueck = lies()

    assert.deepEqual(hoch, vorher, 'nach dem Vergroessern')
    assert.deepEqual(zurueck, vorher, 'nach dem Zurueckstellen')
  })

  it('und sie bricht eine umgebrochene Zeile nicht anders um', () => {
    // Der eigentliche Zweck des Resync ist der Reflow-Unterschied. Bleibt die
    // umgebrochene Zeile ueber eine Hoehenaenderung hinweg vollstaendig, gibt es
    // fuer diesen Fall nichts zu reparieren.
    const zaehle = () => {
      const out = tmux('capture-pane', '-t', SESSION, '-p', '-e', '-J', '-S', `-${RESYNC_SCROLLBACK_LINES}`)
      const line = out.split('\n').find((l) => l.includes('BBB')) ?? ''
      return (line.match(/B/g) ?? []).length
    }
    const vorher = zaehle()
    assert.equal(vorher, LONG_LINE_LENGTH, 'Ausgangszustand')
    resize(TALL_ROWS)
    execFileSync('sh', ['-c', 'sleep 0.5'])
    assert.equal(zaehle(), LONG_LINE_LENGTH, 'nach dem Vergroessern')
    resize(SHORT_ROWS)
    execFileSync('sh', ['-c', 'sleep 0.5'])
    assert.equal(zaehle(), LONG_LINE_LENGTH, 'nach dem Zurueckstellen')
  })
})
