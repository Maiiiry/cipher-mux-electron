import * as path from 'path'

/**
 * Der Auftrag an den Worker. Pflichtfelder statt Freitext, weil in Keel Regeln
 * nur im Schema hielten (Spec §3). Die Gate-Ausgabe eines Fehlversuchs geht
 * wörtlich mit — nacherzählt verlor sie in Keel den Fehlerort.
 */

export interface AuftragInput {
  projekt: string
  ziel: string
  dateien: string[]
  akzeptanzkriterium: string
  geschuetzteTests: string[]
  testBefehl: string
  nichtZiele: string[]
}

/** Testausgaben enden mit dem Wichtigen; gekürzt wird vorne. */
export const MAX_GATE_OUTPUT_CHARS = 6000

const blank = (s: unknown): boolean => typeof s !== 'string' || s.trim() === ''

export function validateAuftrag(a: AuftragInput, opts: { testPflicht?: boolean } = {}): string[] {
  const errs: string[] = []
  if (blank(a.projekt) || !path.isAbsolute(a.projekt)) errs.push('projekt: absoluter Pfad erforderlich')
  if (blank(a.ziel)) errs.push('ziel: leer')
  if (blank(a.akzeptanzkriterium)) errs.push('akzeptanzkriterium: leer')
  if (blank(a.testBefehl)) errs.push('testBefehl: leer')

  // geschuetzteTests: Element-Validierung
  // Der Workshop darf ohne Abnahmetest arbeiten (Testbefehl entscheidet); Elemente und Pfade prüft er trotzdem.
  if (!Array.isArray(a.geschuetzteTests)) {
    // Die Factory meldet wie vor dem Workshop; „Liste erforderlich“ nur dort, wo Tests optional sind.
    errs.push(opts.testPflicht !== false ? 'geschuetzteTests: mindestens ein Abnahmetest' : 'geschuetzteTests: Liste erforderlich')
  } else if (a.geschuetzteTests.length === 0 && opts.testPflicht !== false) {
    errs.push('geschuetzteTests: mindestens ein Abnahmetest')
  } else {
    for (let i = 0; i < a.geschuetzteTests.length; i++) {
      const t = a.geschuetzteTests[i]
      if (blank(t)) {
        errs.push(`geschuetzteTests[${i}]: kein Text`)
      }
    }
    // Pfad-Prüfung nur auf gültigen Strings, wenn projekt valide ist
    if (!blank(a.projekt) && path.isAbsolute(a.projekt)) {
      for (let i = 0; i < a.geschuetzteTests.length; i++) {
        const t = a.geschuetzteTests[i]
        if (!blank(t)) {
          const abs = path.resolve(a.projekt, t)
          if (!abs.startsWith(path.resolve(a.projekt) + path.sep)) {
            errs.push(`geschuetzteTests[${i}]: ${t} liegt außerhalb des Projekts`)
          }
        }
      }
    }
  }

  // dateien: Element-Validierung
  if (!Array.isArray(a.dateien)) {
    errs.push('dateien: Liste erforderlich')
  } else {
    for (let i = 0; i < a.dateien.length; i++) {
      if (blank(a.dateien[i])) {
        errs.push(`dateien[${i}]: kein Text`)
      }
    }
  }

  // nichtZiele: Element-Validierung
  if (!Array.isArray(a.nichtZiele)) {
    errs.push('nichtZiele: Liste erforderlich')
  } else {
    for (let i = 0; i < a.nichtZiele.length; i++) {
      if (blank(a.nichtZiele[i])) {
        errs.push(`nichtZiele[${i}]: kein Text`)
      }
    }
  }

  return errs
}

function tail(s: string): string {
  return s.length <= MAX_GATE_OUTPUT_CHARS ? s : '… (gekürzt)\n' + s.slice(-MAX_GATE_OUTPUT_CHARS)
}

const list = (xs: string[]): string => (xs.length ? xs.map(x => `- ${x}`).join('\n') : '- (keine)')

export function buildAuftragMd(
  a: AuftragInput,
  opts: { nummer: number; versuch: number; vorherigesGate?: { reasons: string[]; testOutput: string } },
): string {
  const parts = [
    `# Auftrag #${opts.nummer} — Versuch ${opts.versuch}`,
    '',
    `**Projekt:** \`${a.projekt}\``,
    '',
    `## Ziel\n\n${a.ziel}`,
    `## Akzeptanzkriterium\n\n${a.akzeptanzkriterium}`,
    `## Dateien\n\n${list(a.dateien)}`,
    ...(a.geschuetzteTests.length ? [`## Abnahmetests — gesperrt, bestehen statt ändern\n\n${list(a.geschuetzteTests)}`] : []),
    `## Testbefehl (im Projekt ausführen)\n\n\`\`\`\n${a.testBefehl}\n\`\`\``,
    `## Nicht-Ziele\n\n${list(a.nichtZiele)}`,
  ]
  if (opts.vorherigesGate) {
    parts.push(
      `## Der vorige Versuch ist durchgefallen\n\n${list(opts.vorherigesGate.reasons)}\n\n`
      + `Ausgabe des Testbefehls, wörtlich:\n\n\`\`\`\n${tail(opts.vorherigesGate.testOutput)}\n\`\`\``,
    )
  }
  parts.push('## Zum Schluss\n\nSchreibe `REPORT.md` in dein Arbeitsverzeichnis. Nicht committen.')
  return parts.join('\n\n') + '\n'
}
