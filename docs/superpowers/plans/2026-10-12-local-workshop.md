# Local Workshop — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine Rolle `local-workshop`, die den normalen Claude-Prozess fährt und Routine-Tasks über den vorhandenen Local-Factory-Läufer an ein lokales Modell gibt — mit Modellprofilen und einer ehrlichen Bilanz.

**Architecture:** Der `LocalFactoryRunner` bekommt eine `rolle` (`local-factory` | `local-workshop`) und leitet daraus Weckziel, Präfix, Testpflicht und Ausschöpfungstext ab. Modellprofile werden in `local-provider.ts` aufgelöst und reisen als Datei `local-profile.json` im Run-Verzeichnis des Workers zum opencode-Adapter. Die Bilanz ist eine reine Datenschicht (`local-factory/bilanz.ts`) plus eine Senke, die `bilanz.jsonl` anhängt und eine Note neu schreibt.

**Tech Stack:** TypeScript strict, Node `node:test` + `tsx`, Electron-Main, opencode-Adapter, tmux.

**Spec:** `docs/superpowers/specs/2026-10-12-local-workshop-design.md`

## Global Constraints

- Tests nur mit Node 22: `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"` vor jedem Test-/Typecheck-Befehl.
- Einzeltests: einmal `npm run rebuild:node`, dann `node --test --import tsx <datei>`. Abschluss jedes Tasks: `npm run test` grün (Stand vorher: 2538/2538).
- Typecheck: `npx tsc -p tsconfig.main.json --noEmit` und `npx tsc -p tsconfig.renderer.json --noEmit`, beide null Fehler.
- Lint-Gate: keine neuen Probleme in geänderten Dateien (`npx eslint <dateien>` vorher/nachher vergleichen). `npm run lint` ist projektweit rot, kein Kriterium.
- Die Local Cyber Factory verhält sich unverändert. **Bestehende Tests unter `test/main/local-factory/` werden nicht geändert**, nur ergänzt. Einzige Ausnahme: Aufrufe von `WorkerHost`-Methoden, deren Signatur um einen optionalen Parameter wächst — die alten Aufrufe bleiben gültig.
- Bestehende Configs laufen unverändert: ohne `localWorkerProfiles` gilt `agent.localWorker` als Profil `default`.
- Tags in Code und Rollentext nur aus den Achsen (`kind`, `phase`, `status`, `severity`, `component`); `entity:`/`workspace:` setzt der Mux.
- Keine Companion-Memory-Werkzeuge im Rollentext; nur registrierte Werkzeugnamen.
- `src/shared/version.ts` nie committen.
- Commit-Nachrichten enden mit `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Factory und Workshop im selben Workspace** — der zweite Dispatch muss „Worker belegt durch <rolle>" bekommen, nicht den laufenden Worker abschießen. → Test in Task 4.
2. **Profil verschwindet zwischen Dispatch und Worker-Start** (Config editiert) — der Worker darf nicht still mit dem Default-Modell laufen, während die Bilanz das gewählte Profil nennt. → Task 2: die Bilanz liest Profil und Modell aus derselben `local-profile.json`, die der Adapter liest.
3. **Workshop-Session nicht offen, wenn die Weckzeile kommt** — das Ergebnis darf nicht verloren gehen; `lauf.json` ist vollständig, die Abnahme geht später. → Test in Task 3.
4. **Abnahme-Urteil zu einem Häppchen, das noch läuft oder schon beurteilt ist** — muss abgelehnt werden, keine doppelte Bilanz-Zeile. → Test in Task 5.
5. **Bilanz-Note vom User gelöscht** — beim nächsten Eintrag neu anlegen statt zu werfen. → Test in Task 5.

---

## Dateistruktur

| Datei | Verantwortung | Task |
|---|---|---|
| `src/main/local-factory/local-provider.ts` | + Profile auflösen (`resolveLocalWorkerProfile`), Profil-Datei lesen/schreiben | 1, 2 |
| `src/shared/types.ts` | + `localWorkerProfiles`, `localWorkerDefaultProfile`; `BuiltinEntityId` + `local-workshop` | 1, 6 |
| `src/main/config/config-store.ts` | Defaults für die zwei neuen Felder | 1 |
| `src/main/agent/adapters/opencode.ts` | `getLocalWorker(runDir)` liest die Profil-Datei | 2 |
| `src/main/local-factory/worker-host-util.ts` | `checkWorkerReady` nimmt eine aufgelöste Config | 2 |
| `src/main/local-factory/worker-host.ts` | Profil auflösen, Datei schreiben, Weckziel = Rolle | 2, 3 |
| `src/main/local-factory/runner.ts` | `rolle`, optionaler Test, Präfix, Ausschöpfungstext, Messwerte, Urteil | 3, 5 |
| `src/main/local-factory/auftrag.ts` | `validateAuftrag(a, { testPflicht })`, AUFTRAG.md ohne Testblock | 3 |
| `src/main/local-factory/gate.ts` | leere Schutzliste nur bei `testPflicht` rot | 3 |
| `src/main/local-factory/lauf.ts` | `profil`, `modell`, `diffZeilen`, `dateien` am Versuch; Status `beurteilt` | 3, 5 |
| `src/main/local-factory/git-ops.ts` | `diffStat(projekt, base, head)` | 5 |
| `src/main/local-factory/bilanz.ts` (neu) | Zeilentyp, Urteil prüfen, Zeile bauen, Tabelle rendern | 5 |
| `src/main/local-factory/bilanz-sink.ts` (neu) | jsonl anhängen, Note neu schreiben | 5 |
| `src/main/local-factory/tool-call.ts` | `profil`, Urteil bei accept | 4, 5 |
| `src/main/mcp/local-factory-tool.ts` | Läufer pro Workspace × Rolle, Worker-Sperre, Schema | 4, 5 |
| `src/main/mcp/entity-header.ts` | Freigabe für `local-workshop` | 4 |
| `src/main/local-factory/workshop-preset.ts` (neu) | Rollentext `generateLocalWorkshopPreset` | 6 |
| `src/main/session/entity-registry.ts`, `session-manager.ts`, `entity-content/preset-templates.ts`, `shared/tag-axes.ts`, `renderer/components/SessionCell.tsx`, `PaneHeader.tsx` | Rolle registrieren, Preset write-once, Farbe, Tag-Wert, Permission | 6 |

---

### Task 1: Modellprofile auflösen

**Files:**
- Modify: `src/shared/types.ts` (Abschnitt `agent`, bei `localWorker: LocalWorkerConfig | null`)
- Modify: `src/main/config/config-store.ts:60-73`
- Modify: `src/main/local-factory/local-provider.ts`
- Test: `test/main/local-factory/local-profiles.test.ts` (neu)

**Interfaces:**
- Produces: `resolveLocalWorkerProfile(agent: AgentProfileSource, name?: string): { ok: true; profil: string; cfg: LocalWorkerConfig } | { ok: false; error: string }`
- Produces: `type AgentProfileSource = { localWorker?: unknown; localWorkerProfiles?: unknown; localWorkerDefaultProfile?: unknown }`
- Produces: `DEFAULT_PROFILE = 'default'`

- [ ] **Step 1: Failing test schreiben**

```ts
// test/main/local-factory/local-profiles.test.ts
import { describe, it } from 'node:test'
import * as assert from 'node:assert/strict'
import { resolveLocalWorkerProfile, DEFAULT_PROFILE } from '../../../src/main/local-factory/local-provider'

const dgx = { baseUrl: 'http://h:8000/v1', model: 'qwen3.8-27b', contextWindow: 131072, maxOutputTokens: 16384 }
const mac = { baseUrl: 'http://127.0.0.1:11433/v1', model: 'qwen38-27b-64k', contextWindow: 65536, maxOutputTokens: 16384 }

describe('resolveLocalWorkerProfile', () => {
  it('ohne Profile: localWorker gilt als Profil default — bestehende Configs laufen wie heute', () => {
    const r = resolveLocalWorkerProfile({ localWorker: dgx })
    assert.deepEqual(r, { ok: true, profil: DEFAULT_PROFILE, cfg: dgx })
  })
  it('ohne Profile und ohne Namen, aber mit Namen default: dasselbe', () => {
    assert.equal((resolveLocalWorkerProfile({ localWorker: dgx }, 'default') as any).profil, 'default')
  })
  it('ohne Profile: ein anderer Name ist unbekannt', () => {
    const r = resolveLocalWorkerProfile({ localWorker: dgx }, 'mac')
    assert.equal(r.ok, false)
    assert.match((r as any).error, /Profil „mac" unbekannt/)
  })
  it('mit Profilen: Name wählt, ohne Namen gilt localWorkerDefaultProfile', () => {
    const agent = { localWorker: null, localWorkerProfiles: { dgx, mac }, localWorkerDefaultProfile: 'mac' }
    assert.deepEqual(resolveLocalWorkerProfile(agent), { ok: true, profil: 'mac', cfg: mac })
    assert.deepEqual(resolveLocalWorkerProfile(agent, 'dgx'), { ok: true, profil: 'dgx', cfg: dgx })
  })
  it('mit Profilen ohne gültigen Default: der Fehler nennt die vorhandenen', () => {
    const r = resolveLocalWorkerProfile({ localWorkerProfiles: { dgx, mac } })
    assert.equal(r.ok, false)
    assert.match((r as any).error, /dgx, mac/)
  })
  it('ein halbes Profil gilt als keins', () => {
    const r = resolveLocalWorkerProfile({ localWorkerProfiles: { kaputt: { baseUrl: 'x' } }, localWorkerDefaultProfile: 'kaputt' })
    assert.equal(r.ok, false)
    assert.match((r as any).error, /unvollständig/)
  })
  it('gar nichts konfiguriert: derselbe Grund wie bisher', () => {
    const r = resolveLocalWorkerProfile({ localWorker: null })
    assert.match((r as any).error, /Local Worker nicht konfiguriert/)
  })
})
```

- [ ] **Step 2: Rot sehen**

Run: `node --test --import tsx test/main/local-factory/local-profiles.test.ts`
Expected: FAIL — `resolveLocalWorkerProfile` ist kein Export.

- [ ] **Step 3: Implementieren**

In `src/main/local-factory/local-provider.ts` anhängen:

```ts
/** Name des Profils, das ein einzelnes `agent.localWorker` darstellt. */
export const DEFAULT_PROFILE = 'default'

export type AgentProfileSource = {
  localWorker?: unknown
  localWorkerProfiles?: unknown
  localWorkerDefaultProfile?: unknown
}

export type ProfileResult =
  | { ok: true; profil: string; cfg: LocalWorkerConfig }
  | { ok: false; error: string }

/**
 * Welches lokale Modell ein Auftrag bekommt (Spec 2026-10-12 §4.4).
 *
 * Ohne `localWorkerProfiles` ist `agent.localWorker` das einzige Profil und
 * heißt `default` — bestehende Configs laufen unverändert. Freie Modellnamen
 * gibt es nicht: ein Tippfehler würde in der Bilanz als eigenes Modell zählen.
 */
export function resolveLocalWorkerProfile(agent: AgentProfileSource, name?: string): ProfileResult {
  const raw = agent.localWorkerProfiles
  const profiles = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null
  if (!profiles || Object.keys(profiles).length === 0) {
    const wanted = name ?? DEFAULT_PROFILE
    if (wanted !== DEFAULT_PROFILE) {
      return { ok: false, error: `Profil „${wanted}" unbekannt — eingerichtet ist nur „${DEFAULT_PROFILE}" (agent.localWorker).` }
    }
    const cfg = readLocalWorkerConfig(agent.localWorker)
    return cfg
      ? { ok: true, profil: DEFAULT_PROFILE, cfg }
      : { ok: false, error: 'Local Worker nicht konfiguriert (agent.localWorker fehlt oder ist unvollständig)' }
  }
  const names = Object.keys(profiles).sort()
  const def = typeof agent.localWorkerDefaultProfile === 'string' ? agent.localWorkerDefaultProfile : undefined
  const wanted = name ?? def
  if (!wanted || !(wanted in profiles)) {
    const was = wanted ? `Profil „${wanted}" unbekannt` : 'Kein Standardprofil (agent.localWorkerDefaultProfile)'
    return { ok: false, error: `${was} — vorhanden: ${names.join(', ')}.` }
  }
  const cfg = readLocalWorkerConfig(profiles[wanted])
  return cfg
    ? { ok: true, profil: wanted, cfg }
    : { ok: false, error: `Profil „${wanted}" ist unvollständig (baseUrl, model, contextWindow, maxOutputTokens).` }
}
```

In `src/shared/types.ts` direkt unter `localWorker: LocalWorkerConfig | null`:

```ts
    /**
     * Benannte Modellprofile für lokale Worker (Spec 2026-10-12 §4.4). Leer oder
     * fehlend: `localWorker` ist das Profil `default`. Gelesen über
     * `resolveLocalWorkerProfile`, nie direkt.
     */
    localWorkerProfiles?: Record<string, LocalWorkerConfig>
    /** Profil, das ein Auftrag ohne `profil` bekommt. */
    localWorkerDefaultProfile?: string
```

`config-store.ts` braucht keinen Default (beide Felder optional) — **nicht** eintragen, sonst schreibt der Store `{}` in jede bestehende Config.

**Modelloptionen pro Profil.** Das Mac-Profil braucht den Denkmodus aus (Recherche 2026-10-12: Denken frisst das Ausgabebudget, Spec Local Factory §10a; bei ~15 tok/s kosten 3k Denk-Tokens gut drei Minuten pro Zug). `LocalWorkerConfig` bekommt deshalb ein optionales Feld, das unverändert an opencode durchgereicht wird:

```ts
  /** Modelloptionen, unverändert an opencode (`provider.<id>.models.<m>.options`), z. B. `{ reasoning_effort: 'none' }`. */
  modelOptions?: Record<string, unknown>
```

`readLocalWorkerConfig` übernimmt es nur, wenn es ein einfaches Objekt ist (sonst weglassen, nicht ablehnen); `buildLocalProviderBlock` setzt es als `options` am Modell. Test in `local-profiles.test.ts` ergänzen:

```ts
it('modelOptions reisen bis in den Provider-Block, ein Nicht-Objekt fällt weg', () => {
  const cfg = readLocalWorkerConfig({ ...mac, modelOptions: { reasoning_effort: 'none' } })!
  assert.deepEqual((buildLocalProviderBlock(cfg) as any).models[mac.model].options, { reasoning_effort: 'none' })
  assert.equal(readLocalWorkerConfig({ ...mac, modelOptions: 'x' })!.modelOptions, undefined)
})
```

> Welcher Schlüssel bei Ollama über `/v1` das Denken wirklich abschaltet (`reasoning_effort` oder `think`), ist laut Recherche **ungeprüft** — das klärt Task 8, Step 3. Der Code reicht nur durch, er rät nicht.

- [ ] **Step 4: Grün sehen**

Run: `node --test --import tsx test/main/local-factory/local-profiles.test.ts test/main/local-factory/local-provider.test.ts`
Expected: PASS, alle.

- [ ] **Step 5: Commit**

```bash
git add src/main/local-factory/local-provider.ts src/shared/types.ts test/main/local-factory/local-profiles.test.ts
git commit -m "feat(local-factory): Modellprofile -- localWorker bleibt Profil default"
```

---

### Task 2: Das gewählte Profil erreicht den Worker

**Files:**
- Modify: `src/main/local-factory/local-provider.ts` (Profil-Datei)
- Modify: `src/main/local-factory/worker-host-util.ts:62-73` (`checkWorkerReady`)
- Modify: `src/main/local-factory/runner.ts:24-36` (`WorkerHost`)
- Modify: `src/main/local-factory/worker-host.ts`
- Modify: `src/main/agent/adapters/opencode.ts:118-136, 418-420`
- Test: `test/main/local-factory/local-profiles.test.ts`, `test/main/local-factory/worker-host.test.ts`, `test/main/opencode-local-provider.test.ts`

**Interfaces:**
- Consumes: `resolveLocalWorkerProfile` (Task 1)
- Produces: `LOCAL_PROFILE_FILENAME = 'local-profile.json'`; `writeLocalProfileFile(runDir: string, p: { profil: string; cfg: LocalWorkerConfig }): void`; `readLocalProfileFile(runDir: string): { profil: string; cfg: LocalWorkerConfig } | null`
- Produces: `WorkerHost.workerReady(profil?: string): Promise<string | null>`; `WorkerHost.startFreshWorker(projekt: string, profil?: string): Promise<{ runDir: string; sessionId: string; profil: string; modell: string }>`
- Produces: `checkWorkerReady(deps: { resolved: ProfileResult; skipPermissions: boolean; probe })`
- Produces: `OpenCodeConfigReader.getLocalWorker?(runDir: string): LocalWorkerConfig | null`

Die Datei im Run-Verzeichnis ist die **eine** Quelle für Adapter und Bilanz (Review Focus 2): der Adapter baut daraus `provider`/`model`, der Läufer liest Profil und Modell aus dem Rückgabewert von `startFreshWorker`, der dieselbe Datei geschrieben hat.

- [ ] **Step 1: Failing tests schreiben**

In `test/main/local-factory/local-profiles.test.ts` ergänzen:

```ts
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { writeLocalProfileFile, readLocalProfileFile, LOCAL_PROFILE_FILENAME } from '../../../src/main/local-factory/local-provider'

describe('Profil-Datei im Run-Verzeichnis', () => {
  it('rund: geschrieben = gelesen', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-'))
    writeLocalProfileFile(dir, { profil: 'mac', cfg: mac })
    assert.deepEqual(readLocalProfileFile(dir), { profil: 'mac', cfg: mac })
  })
  it('fehlt oder kaputt → null, nicht werfen', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-'))
    assert.equal(readLocalProfileFile(dir), null)
    fs.writeFileSync(path.join(dir, LOCAL_PROFILE_FILENAME), '{kaputt')
    assert.equal(readLocalProfileFile(dir), null)
  })
})
```

In `test/main/local-factory/worker-host.test.ts` die bestehenden `checkWorkerReady`-Aufrufe **nicht ändern**, sondern einen neuen Block ergänzen (die alte Form `localWorker:` bleibt als Kompatibilitätsweg erhalten, siehe Step 3):

```ts
import { resolveLocalWorkerProfile } from '../../../src/main/local-factory/local-provider'

describe('checkWorkerReady mit Profil', () => {
  it('prüft den Endpunkt des gewählten Profils', async () => {
    const seen: string[] = []
    const agent = { localWorkerProfiles: { a: okCfg, b: { ...okCfg, baseUrl: 'http://mac:11433/v1' } }, localWorkerDefaultProfile: 'a' }
    await checkWorkerReady({
      resolved: resolveLocalWorkerProfile(agent, 'b'), skipPermissions: true,
      probe: async (u) => { seen.push(u); return { ok: true } },
    })
    assert.deepEqual(seen, ['http://mac:11433/v1/models'])
  })
  it('unbekanntes Profil: Grund kommt durch, keine Probe', async () => {
    let probed = false
    const r = await checkWorkerReady({
      resolved: resolveLocalWorkerProfile({ localWorker: okCfg }, 'mac'), skipPermissions: true,
      probe: async () => { probed = true; return { ok: true } },
    })
    assert.match(r!, /Profil „mac" unbekannt/)
    assert.equal(probed, false)
  })
})
```

In `test/main/opencode-local-provider.test.ts` ergänzen (vorher die Datei lesen, um den vorhandenen Fake-Reader und die Hilfsfunktion zum Ausführen von `postLaunchInjection` zu übernehmen; der neue Test nutzt denselben Aufbau, nur mit `getLocalWorker: (runDir) => readLocalProfileFile(runDir)?.cfg ?? null` und einer vorab geschriebenen Profil-Datei im Run-Verzeichnis):

```ts
it('nimmt Provider und Modell aus der Profil-Datei des Run-Verzeichnisses', async () => {
  // runDir = ctx.projectPath der Worker-Session
  writeLocalProfileFile(runDir, { profil: 'mac', cfg: { baseUrl: 'http://127.0.0.1:11433/v1', model: 'm-mac', contextWindow: 65536, maxOutputTokens: 16384 } })
  // … postLaunchInjection für entityId 'local-worker' wie im bestehenden Test …
  const written = JSON.parse(fs.readFileSync(path.join(runDir, 'opencode.json'), 'utf-8'))
  assert.equal(written.model, 'cipher-local/m-mac')
  assert.equal(written.provider['cipher-local'].options.baseURL, 'http://127.0.0.1:11433/v1')
})
```

- [ ] **Step 2: Rot sehen**

Run: `node --test --import tsx test/main/local-factory/local-profiles.test.ts test/main/local-factory/worker-host.test.ts test/main/opencode-local-provider.test.ts`
Expected: FAIL — fehlende Exporte, `resolved` unbekannt, Modell kommt aus dem alten Reader.

- [ ] **Step 3: Implementieren**

`local-provider.ts`:

```ts
import * as fs from 'fs'
import * as path from 'path'

/**
 * Das Profil eines Worker-Starts, im Run-Verzeichnis des Workers. Eine Datei
 * statt eines Startparameters, weil Adapter und Bilanz dieselbe Quelle lesen
 * müssen: was der Worker bekam, ist, was gezählt wird.
 */
export const LOCAL_PROFILE_FILENAME = 'local-profile.json'

export function writeLocalProfileFile(runDir: string, p: { profil: string; cfg: LocalWorkerConfig }): void {
  fs.mkdirSync(runDir, { recursive: true })
  fs.writeFileSync(path.join(runDir, LOCAL_PROFILE_FILENAME), JSON.stringify(p, null, 2) + '\n', 'utf-8')
}

export function readLocalProfileFile(runDir: string): { profil: string; cfg: LocalWorkerConfig } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(runDir, LOCAL_PROFILE_FILENAME), 'utf-8')) as Record<string, unknown>
    const cfg = readLocalWorkerConfig(raw.cfg)
    return cfg && typeof raw.profil === 'string' ? { profil: raw.profil, cfg } : null
  } catch {
    return null
  }
}
```

`worker-host-util.ts` — `checkWorkerReady` nimmt **entweder** `resolved` **oder** das alte `localWorker` (die bestehenden Tests rufen es so):

```ts
export async function checkWorkerReady(deps: {
  localWorker?: unknown
  resolved?: ProfileResult
  skipPermissions: boolean
  probe: (url: string) => Promise<ProbeResult>
}): Promise<string | null> {
  const r = deps.resolved ?? resolveLocalWorkerProfile({ localWorker: deps.localWorker })
  if (!r.ok) return r.error
  if (!deps.skipPermissions) return 'Worker braucht agent.skipPermissions — sonst hängt opencode im Rückfrage-Dialog'
  const url = endpointProbeUrl(r.cfg.baseUrl)
  const p = await deps.probe(url)
  return p.ok ? null : `Endpunkt des lokalen Modells nicht erreichbar: ${url} (${p.detail})`
}
```

(Import `resolveLocalWorkerProfile, type ProfileResult` aus `./local-provider`; den bisherigen `readLocalWorkerConfig`-Import entfernen, falls dann unbenutzt.)

`runner.ts`, `WorkerHost`:

```ts
  workerReady(profil?: string): Promise<string | null>
  /** Schreibt das aufgelöste Profil ins Run-Verzeichnis, bevor der Adapter es liest. */
  startFreshWorker(projekt: string, profil?: string): Promise<{ runDir: string; sessionId: string; profil?: string; modell?: string }>
```

(`profil`/`modell` im Rückgabewert optional, damit der Fake-Host der bestehenden Läufertests unverändert gültig bleibt.)

`worker-host.ts`:

```ts
import { resolveLocalWorkerProfile, writeLocalProfileFile } from './local-provider'
import { resolveRunDir } from '../session/entity-run-dir'

    async workerReady(profil) {
      const { configStore } = await import('../config/config-store')
      const agent = configStore.get('agent')
      return checkWorkerReady({
        resolved: resolveLocalWorkerProfile(agent ?? {}, profil),
        skipPermissions: agent?.skipPermissions === true,
        probe: url => probeEndpoint(url),
      })
    },
    async startFreshWorker(projekt, profil) {
      const { configStore } = await import('../config/config-store')
      const r = resolveLocalWorkerProfile(configStore.get('agent') ?? {}, profil)
      if (!r.ok) throw new Error(r.error)
      for (const s of findEntitySessions(sm.list(), 'local-worker', ws)) {
        await sm.stopEntity('local-worker', s.id)
      }
      // Vor dem Start: postLaunchInjection liest die Datei beim Schreiben der opencode.json.
      writeLocalProfileFile(resolveRunDir(ws, 'local-worker'), { profil: r.profil, cfg: r.cfg })
      const session = await startEntitySession(ctx, 'local-worker', { projectPath: projekt })
      if (!session.projectPath) {
        await sm.stopEntity('local-worker', session.id).catch(() => {})
        throw new Error('Worker-Session ohne Arbeitsverzeichnis gestartet')
      }
      // startEntity löst einen gelöschten Workspace zu „ungebunden" auf; dann liegt die
      // Datei im falschen Verzeichnis. Nachziehen statt raten.
      if (session.projectPath !== resolveRunDir(ws, 'local-worker')) {
        writeLocalProfileFile(session.projectPath, { profil: r.profil, cfg: r.cfg })
      }
      return { runDir: session.projectPath, sessionId: session.id, profil: r.profil, modell: r.cfg.model }
    },
```

> Prüfen beim Bauen: läuft `postLaunchInjection` synchron innerhalb von `startEntitySession`? Wenn ja, greift das Nachziehen im Sonderfall zu spät — dann im Sonderfall die Session stoppen und mit Fehler „Workspace nicht mehr vorhanden" abbrechen (Läuferfehler, kein stiller Default). Den Befund als Kommentar an die Stelle schreiben.

`opencode.ts`:

```ts
  /** Lokales Modell für `local-worker`, aus der Profil-Datei des Run-Verzeichnisses. Spec 2026-10-12 §4.4. */
  getLocalWorker?(runDir: string): LocalWorkerConfig | null
…
  getLocalWorker(runDir: string): LocalWorkerConfig | null {
    // Die Datei schreibt der Worker-Host vor dem Start. Fehlt sie (Worker von Hand
    // gestartet), gilt das Standardprofil — wie vor den Profilen.
    const fromFile = readLocalProfileFile(runDir)
    if (fromFile) return fromFile.cfg
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { configStore } = require('../../config/config-store')
    const r = resolveLocalWorkerProfile(configStore.get('agent') ?? {})
    return r.ok ? r.cfg : null
  },
…
      const localCfg =
        ctx.entityId === LOCAL_WORKER_ENTITY_ID ? (this.configReader.getLocalWorker?.(ctx.projectPath) ?? null) : null
```

- [ ] **Step 4: Grün sehen**

Run: `node --test --import tsx test/main/local-factory/*.test.ts test/main/opencode-local-provider.test.ts`
Expected: PASS, inklusive aller unveränderten Läufertests.

- [ ] **Step 5: Commit**

```bash
git add src/main/local-factory src/main/agent/adapters/opencode.ts test/main/local-factory test/main/opencode-local-provider.test.ts
git commit -m "feat(local-factory): das gewählte Profil erreicht den Worker -- eine Datei für Adapter und Bilanz"
```

---

### Task 3: Der Läufer kennt seine Rolle

**Files:**
- Modify: `src/main/local-factory/runner.ts`
- Modify: `src/main/local-factory/auftrag.ts`
- Modify: `src/main/local-factory/gate.ts`
- Modify: `src/main/local-factory/lauf.ts`
- Modify: `src/main/local-factory/worker-host.ts` (`wakeArchitect`)
- Test: `test/main/local-factory/runner-workshop.test.ts` (neu), `test/main/local-factory/auftrag.test.ts`, `test/main/local-factory/gate.test.ts` (nur ergänzen)

**Interfaces:**
- Consumes: `WorkerHost.startFreshWorker(projekt, profil)` (Task 2)
- Produces: `type RunnerRolle = 'local-factory' | 'local-workshop'`; `RunnerOpts.rolle?: RunnerRolle` (Default `'local-factory'`)
- Produces: `DispatchArgs.profil?: string`
- Produces: `validateAuftrag(a, opts?: { testPflicht?: boolean })` (Default `true`)
- Produces: `GateInput.testPflicht?: boolean` (Default `true`)
- Produces: `WorkerHost.wakeArchitect(line: string, rolle?: RunnerRolle)`
- Produces: `Versuch.profil?: string`, `Versuch.modell?: string`

- [ ] **Step 1: Failing tests schreiben**

Neue Datei `test/main/local-factory/runner-workshop.test.ts`. Den Repo-Aufbau (`beforeEach`, `git`, `fakeHost`) aus `runner.test.ts` kopieren — nicht importieren, die Datei exportiert nichts — und den Fake-Host so erweitern, dass er `wakeArchitect(line, rolle)` mitschreibt und `startFreshWorker` `{ runDir, sessionId: 's1', profil: 'mac', modell: 'm-mac' }` liefert.

```ts
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
```

In `auftrag.test.ts` und `gate.test.ts` je einen Test **ergänzen**:

```ts
it('testPflicht false: leere geschuetzteTests ist gültig, testBefehl bleibt Pflicht', () => {
  const a = { ...gueltig(), geschuetzteTests: [] }
  assert.deepEqual(validateAuftrag(a, { testPflicht: false }), [])
  assert.deepEqual(validateAuftrag({ ...a, testBefehl: ' ' }, { testPflicht: false }), ['testBefehl: leer'])
})
```

```ts
it('testPflicht false: leere Schutzliste und Test grün → grün', () => {
  assert.equal(decideGate({ workerFinished: true, testExitCode: 0, checksumsBefore: {}, checksumsAfter: {},
    changedFiles: ['a.ts'], protectedFiles: [], testPflicht: false }).verdict, 'gruen')
})
```

(`gueltig()` ist die vorhandene Hilfsfunktion in `auftrag.test.ts` — beim Bauen den tatsächlichen Namen nachsehen und verwenden.)

- [ ] **Step 2: Rot sehen**

Run: `node --test --import tsx test/main/local-factory/runner-workshop.test.ts test/main/local-factory/auftrag.test.ts test/main/local-factory/gate.test.ts`
Expected: FAIL — `rolle` unbekannt, Präfix `[local-factory]`, leere Schutzliste abgelehnt.

- [ ] **Step 3: Implementieren**

`auftrag.ts`: Signatur `validateAuftrag(a: AuftragInput, opts: { testPflicht?: boolean } = {})`; der Block `geschuetzteTests` prüft „mindestens ein Abnahmetest" nur bei `opts.testPflicht !== false`, die Element- und Pfadprüfung läuft immer. In `buildAuftragMd` den Abschnitt „Abnahmetests — gesperrt" nur bei nicht-leerer Liste ausgeben.

`gate.ts`: `testPflicht?: boolean` in `GateInput`; die Prüfung `protectedFiles.length === 0` nur bei `input.testPflicht !== false`.

`lauf.ts`: am `Versuch` zwei optionale Felder:

```ts
  /** Profil und Modell, die der Worker bekam (aus local-profile.json). Spec 2026-10-12 §5. */
  profil?: string
  modell?: string
```

`runner.ts`:

```ts
export type RunnerRolle = 'local-factory' | 'local-workshop'
// RunnerOpts:
  /** Wer beauftragt. Bestimmt Weckziel, Präfix, Testpflicht, Ausschöpfungstext. Default: local-factory. */
  rolle?: RunnerRolle
// DispatchArgs:
  /** Modellprofil (Spec 2026-10-12 §4.4); fehlt = Standardprofil. */
  profil?: string
```

Im Konstruktor `rolle: 'local-factory'` in die Defaults; `Required<…>` deckt es ab. Eine private Hilfe:

```ts
  private get testPflicht(): boolean { return this.o.rolle === 'local-factory' }
  private get praefix(): string { return `[${this.o.rolle}]` }
```

Ersetzungen:
- `validateAuftrag(args)` → `validateAuftrag(args, { testPflicht: this.testPflicht })`
- jedes Literal `[local-factory]` im Läufer → `${this.praefix}` (vier Stellen: Nicht bereit, Läuferfehler, `kopf`)
- `workerReady()` → `workerReady(args.profil)`
- Rot-Prüfung vorab nur, wenn `prot.length > 0`:

```ts
    if (prot.length > 0) {
      const vorher = await runShell(args.testBefehl, projekt, this.o.testTimeoutMs)
      if (vorher.exitCode === 0) {
        return { ok: false, error: 'Der Abnahmetest ist vor der Arbeit schon grün — er prüft nichts.' }
      }
    }
```

  (Bei der Factory ist `prot` nie leer — `validateAuftrag` lehnt das vorher ab. Ihr Verhalten bleibt gleich.)
- `host.startFreshWorker(projekt)` → `host.startFreshWorker(projekt, a.args.profil)`, Rückgabe `profil`/`modell` in `endVersuch(... { ...(profil ? { profil } : {}), ...(modell ? { modell } : {}) })` übernehmen
- `decideGate({...})` bekommt `testPflicht: this.testPflicht`
- Ausschöpfung:

```ts
        + (h?.status === 'eskaliert'
          ? (this.o.rolle === 'local-workshop' ? ' — ausgeschöpft, selbst übernehmen' : ' — ESKALIERT, an den User melden')
          : '')
```
- `wake(line)` → `this.o.host.wakeArchitect(oneLine(line), this.o.rolle)`

`worker-host.ts`:

```ts
    async wakeArchitect(line, rolle = 'local-factory') {
      const target = findEntitySessions(sm.list(), rolle, ws)[0]
      if (!target) {
        console.warn(`[${rolle}] Auftraggeber nicht gefunden, Weckzeile verloren:`, line)
        return
      }
      await submitLine(k => sm.sendKeys(target.id, k), n => sm.sendKey(target.id, n), line)
    },
```

- [ ] **Step 4: Grün sehen**

Run: `node --test --import tsx test/main/local-factory/*.test.ts`
Expected: PASS — neue Tests und alle bestehenden, unverändert.

- [ ] **Step 5: Commit**

```bash
git add src/main/local-factory test/main/local-factory
git commit -m "feat(local-factory): der Läufer kennt seine Rolle -- Weckziel, Präfix, Test optional für den Workshop"
```

---

### Task 4: Werkzeug-Freigabe, ein Läufer pro Rolle, ein Worker zur Zeit

**Files:**
- Modify: `src/main/mcp/entity-header.ts:75-85`
- Modify: `src/main/mcp/local-factory-tool.ts`
- Modify: `src/main/local-factory/tool-call.ts`
- Modify: `src/main/session/session-manager.ts:170-172` (Permission)
- Test: `test/main/local-factory/tool-call.test.ts` (ergänzen), `test/main/mcp/local-factory-tool.test.ts` (neu), Test zu `entity-header` (vorhandene Datei per `grep -rln mayUseLocalWorkerDispatch test` finden und ergänzen)

**Interfaces:**
- Consumes: `RunnerRolle`, `RunnerOpts.rolle`, `DispatchArgs.profil` (Task 3)
- Produces: `mayUseLocalWorkerDispatch(entityId)` → true für `local-factory` und `local-workshop`
- Produces: `getRunner(ctx: ToolContext): LocalFactoryRunner` — Schlüssel `<ws>::<rolle>`
- Produces: `workerLock` — `claimWorker(ws: string, rolle: RunnerRolle): string | null` (null = frei/geholt, sonst Name der Rolle, die ihn hält), `releaseWorker(ws, rolle)`; in `src/main/local-factory/worker-lock.ts` (neu)

- [ ] **Step 1: Failing tests schreiben**

`test/main/local-factory/worker-lock.test.ts` (neu):

```ts
import { describe, it } from 'node:test'
import * as assert from 'node:assert/strict'
import { createWorkerLock } from '../../../src/main/local-factory/worker-lock'

describe('Ein Worker zur Zeit pro Workspace', () => {
  it('die zweite Rolle bekommt den Namen der ersten', () => {
    const l = createWorkerLock()
    assert.equal(l.claim('ws1', 'local-factory'), null)
    assert.equal(l.claim('ws1', 'local-workshop'), 'local-factory')
  })
  it('andere Workspaces sind unabhängig', () => {
    const l = createWorkerLock()
    l.claim('ws1', 'local-factory')
    assert.equal(l.claim('ws2', 'local-workshop'), null)
  })
  it('nach release frei; release einer fremden Rolle gibt nichts frei', () => {
    const l = createWorkerLock()
    l.claim('ws1', 'local-factory')
    l.release('ws1', 'local-workshop')
    assert.equal(l.claim('ws1', 'local-workshop'), 'local-factory')
    l.release('ws1', 'local-factory')
    assert.equal(l.claim('ws1', 'local-workshop'), null)
  })
})
```

`test/main/local-factory/runner-workshop.test.ts` ergänzen (Review Focus 1):

```ts
it('Worker belegt durch die andere Rolle: nicht bereit, kein Versuch, kein Lauf angelegt', async () => {
  const lock = createWorkerLock()
  lock.claim('ws', 'local-factory')
  const host = fakeHost('brav')
  const r = new LocalFactoryRunner({ host, laufDir, rolle: 'local-workshop', workerLock: lock, workspaceKey: 'ws',
    sleep: async () => {}, pollMs: 0, startupWaitMs: 0, quietMs: 1000, stallMs: 5000, timeoutMs: 5000, testTimeoutMs: 5000 })
  const res: any = await r.dispatch(args())
  assert.equal(res.ok, false)
  assert.match(res.error, /Worker belegt durch local-factory/)
  assert.equal(fs.readdirSync(laufDir).length, 0)
  assert.equal(host.sent.length, 0)
})

it('nach dem Versuch wird der Worker freigegeben', async () => {
  const lock = createWorkerLock()
  const r = new LocalFactoryRunner({ host: fakeHost('brav'), laufDir, rolle: 'local-workshop', workerLock: lock, workspaceKey: 'ws',
    sleep: async () => {}, pollMs: 0, startupWaitMs: 0, quietMs: 1000, stallMs: 5000, timeoutMs: 5000, testTimeoutMs: 5000 })
  await r.dispatch(args()); await r.whenIdle()
  assert.equal(lock.claim('ws', 'local-factory'), null)
})
```

`tool-call.test.ts` ergänzen:

```ts
it('profil wird an dispatch durchgereicht', async () => {
  let seen: any
  await handleLocalFactoryCall({ dispatch: async (a: any) => { seen = a; return { ok: false, error: 'x' } }, accept: () => ({ ok: true }) } as any,
    { projekt: '/p', profil: 'mac' } as any)
  assert.equal(seen.profil, 'mac')
})
```

Entity-Header-Test ergänzen:

```ts
it('local-workshop darf dispatchen, andere Rollen und rollenlose Verbindungen nicht', () => {
  assert.equal(mayUseLocalWorkerDispatch('local-workshop'), true)
  assert.equal(mayUseLocalWorkerDispatch('local-factory'), true)
  assert.equal(mayUseLocalWorkerDispatch('workshop'), false)
  assert.equal(mayUseLocalWorkerDispatch(null), false)
})
```

- [ ] **Step 2: Rot sehen**

Run: `node --test --import tsx test/main/local-factory/worker-lock.test.ts test/main/local-factory/runner-workshop.test.ts test/main/local-factory/tool-call.test.ts` plus die Entity-Header-Testdatei
Expected: FAIL.

- [ ] **Step 3: Implementieren**

`src/main/local-factory/worker-lock.ts`:

```ts
import type { RunnerRolle } from './runner'

/**
 * Ein lokaler Worker pro Workspace, gleich welche Rolle beauftragt (Spec
 * 2026-10-12 §4.5). `local-worker` ist singleInstance, und `startFreshWorker`
 * beendet jeden laufenden Worker — ohne diese Sperre schössen Factory und
 * Workshop sich gegenseitig den Worker ab. Es ist auch die Hardware: ein
 * lokales Modell, eine Aufgabe.
 */
export interface WorkerLock {
  /** null = geholt; sonst die Rolle, die ihn hält. */
  claim(ws: string, rolle: RunnerRolle): RunnerRolle | null
  release(ws: string, rolle: RunnerRolle): void
}

export function createWorkerLock(): WorkerLock {
  const held = new Map<string, RunnerRolle>()
  return {
    claim(ws, rolle) {
      const h = held.get(ws)
      if (h && h !== rolle) return h
      held.set(ws, rolle)
      return null
    },
    release(ws, rolle) {
      if (held.get(ws) === rolle) held.delete(ws)
    },
  }
}

/** Die eine Sperre des Prozesses. */
export const workerLock = createWorkerLock()
```

`runner.ts` — `RunnerOpts` um `workerLock?: WorkerLock` und `workspaceKey?: string` erweitern (Defaults: `createWorkerLock()` je Läufer — also für Tests ohne Sperre wirkungslos — und `'__unbound__'`). In `dispatch` nach der `busy`-Prüfung:

```ts
    const haelt = this.o.workerLock.claim(this.o.workspaceKey, this.o.rolle)
    if (haelt) {
      return { ok: false, error: `Nicht bereit: Worker belegt durch ${haelt} — kein Versuch gezählt.` }
    }
```

Freigabe überall dort, wo `busy = false` gesetzt wird (`if (!res.ok) …` und im `.finally` von `runAttempt`): `this.o.workerLock.release(this.o.workspaceKey, this.o.rolle)`.

`local-factory-tool.ts`:

```ts
import { workerLock } from '../local-factory/worker-lock'
import type { RunnerRolle } from '../local-factory/runner'

export function getRunner(ctx: ToolContext): LocalFactoryRunner {
  const ws = ctx.workspaceId ?? '__unbound__'
  const rolle = (ctx.entityId === 'local-workshop' ? 'local-workshop' : 'local-factory') as RunnerRolle
  const key = `${ws}::${rolle}`
  let r = runners.get(key)
  if (!r) {
    r = new LocalFactoryRunner({
      host: createWorkerHost(ctx),
      laufDir: path.join(resolveRunDir(ctx.workspaceId ?? null, rolle), 'laeufe'),
      rolle, workerLock, workspaceKey: ws,
    })
    runners.set(key, r)
  }
  return r
}
```

Schema: `profil: z.string().optional().describe('Dispatch: model profile name from the settings; omit for the default')`. Beschreibung des Werkzeugs um einen Satz ergänzen: `'For local-workshop: geschuetzteTests may be empty (routine without its own test); testBefehl is still required.'`

`tool-call.ts`: `ToolArgs` erbt `profil` schon über `Partial<DispatchArgs>` — nur sicherstellen, dass nichts es herausfiltert (es wird `args as DispatchArgs` durchgereicht; Test aus Step 1 belegt es).

`entity-header.ts`:

```ts
/** Rollen, die lokale Worker beauftragen dürfen (Spec 2026-10-12 §4.1). */
const LOCAL_DISPATCH_ROLES = new Set(['local-factory', 'local-workshop'])

export function mayUseLocalWorkerDispatch(entityId: string | null | undefined): boolean {
  return !!entityId && LOCAL_DISPATCH_ROLES.has(entityId)
}
```

`session-manager.ts:170`: `if (entityId === 'local-factory' || entityId === 'local-workshop')`. Und `test/main/role-templates-name-real-tools.test.ts:25` muss nichts ändern (das Werkzeug ist schon über `local-factory` registriert).

- [ ] **Step 4: Grün sehen**

Run: `npm run test`
Expected: PASS, alle.

- [ ] **Step 5: Commit**

```bash
git add src/main/local-factory src/main/mcp src/main/session/session-manager.ts test/main
git commit -m "feat(local-factory): Workshop darf dispatchen -- ein Läufer pro Rolle, ein Worker zur Zeit"
```

---

### Task 5: Urteil und Bilanz

**Files:**
- Create: `src/main/local-factory/bilanz.ts`
- Create: `src/main/local-factory/bilanz-sink.ts`
- Modify: `src/main/local-factory/git-ops.ts` (`diffStat`)
- Modify: `src/main/local-factory/lauf.ts` (`dateien`, `diffZeilen` am Versuch; Status `beurteilt`; `markBeurteilt`)
- Modify: `src/main/local-factory/runner.ts` (`diffStat` nach Commit, `judge`)
- Modify: `src/main/local-factory/tool-call.ts`, `src/main/mcp/local-factory-tool.ts`
- Test: `test/main/local-factory/bilanz.test.ts` (neu), `test/main/local-factory/bilanz-sink.test.ts` (neu), `test/main/local-factory/runner-workshop.test.ts` (ergänzen), `test/main/local-factory/git-ops.test.ts` (ergänzen)

**Interfaces:**
- Produces (`bilanz.ts`):

```ts
export const ERGEBNISSE = ['uebernommen', 'nachgebessert', 'neu-geschnitten', 'selbst-uebernommen'] as const
export const KATEGORIEN = ['test', 'boilerplate', 'refactor', 'doku', 'ui', 'config', 'logik'] as const
export type Ergebnis = typeof ERGEBNISSE[number]
export type Kategorie = typeof KATEGORIEN[number]
export interface Urteil { ergebnis: Ergebnis; kategorie: Kategorie; notiz?: string }
export interface BilanzZeile {
  ts: string; projekt: string; workspaceId: string | null; laufId: string; haeppchen: number
  profil: string | null; modell: string | null; mitTest: boolean; anlaeufe: number; dauerSek: number
  dateien: number; diffZeilen: number; workerTokens: { input: number; output: number } | null
  ergebnis: Ergebnis; kategorie: Kategorie; notiz: string | null
}
export function validateUrteil(u: Partial<Urteil>): string[]
export function buildBilanzZeile(lauf: Lauf, nummer: number, u: Urteil, ctx: { now: string; workspaceId: string | null; mitTest: boolean }): BilanzZeile
export function renderBilanzNote(zeilen: BilanzZeile[]): string
```

- Produces (`bilanz-sink.ts`): `interface BilanzSink { record(z: BilanzZeile): Promise<void> }`; `createBilanzSink(opts: { dir: string; notes: Pick<NoteManager, 'create' | 'save' | 'read'> }): BilanzSink`
- Produces (`git-ops.ts`): `diffStat(projekt: string, from: string, to: string): Promise<{ dateien: number; zeilen: number }>`
- Produces (`runner.ts`): `judge(laufId: string, nummer: number, u: Partial<Urteil>): Promise<AcceptResult>`; `RunnerOpts.bilanz?: BilanzSink`, `RunnerOpts.workspaceId?: string | null`
- `mitTest` steht am Häppchen: `Haeppchen.mitTest?: boolean` (beim ersten `beginVersuch` gesetzt aus `prot.length > 0`).

- [ ] **Step 1: Failing tests schreiben**

`test/main/local-factory/bilanz.test.ts`:

```ts
import { describe, it } from 'node:test'
import * as assert from 'node:assert/strict'
import { validateUrteil, buildBilanzZeile, renderBilanzNote, type BilanzZeile } from '../../../src/main/local-factory/bilanz'
import type { Lauf } from '../../../src/main/local-factory/lauf'

const lauf: Lauf = {
  id: 'L1', projekt: '/p', erstellt: 0, weckrufe: 2,
  haeppchen: [{ nummer: 1, ziel: 'z', status: 'wartet', mitTest: false, versuche: [
    { nr: 1, gestartet: 1000, beendet: 61000, verdict: 'rot', profil: 'mac', modell: 'm-mac' },
    { nr: 2, gestartet: 70000, beendet: 130000, verdict: 'gruen', profil: 'mac', modell: 'm-mac',
      commit: 'abc', dateien: 2, diffZeilen: 14, tokensAmEnde: { input: 900, output: 120 } },
  ] }],
}

describe('validateUrteil', () => {
  it('gültig', () => assert.deepEqual(validateUrteil({ ergebnis: 'uebernommen', kategorie: 'ui' }), []))
  it('unbekanntes Ergebnis und Kategorie', () => {
    assert.equal(validateUrteil({ ergebnis: 'super' as any, kategorie: 'x' as any }).length, 2)
  })
  it('nachgebessert braucht eine Notiz', () => {
    assert.match(validateUrteil({ ergebnis: 'nachgebessert', kategorie: 'ui' }).join(), /notiz/)
  })
})

describe('buildBilanzZeile', () => {
  it('nimmt Messwerte aus dem letzten Versuch, Anläufe = Zahl der Versuche, Dauer über alle', () => {
    const z = buildBilanzZeile(lauf, 1, { ergebnis: 'nachgebessert', kategorie: 'ui', notiz: 'Import fehlte' },
      { now: '2026-10-12T10:00:00Z', workspaceId: 'ws', mitTest: false })
    assert.equal(z.anlaeufe, 2)
    assert.equal(z.dauerSek, 120)
    assert.equal(z.profil, 'mac'); assert.equal(z.modell, 'm-mac')
    assert.equal(z.dateien, 2); assert.equal(z.diffZeilen, 14)
    assert.deepEqual(z.workerTokens, { input: 900, output: 120 })
    assert.equal(z.notiz, 'Import fehlte')
  })
})

describe('renderBilanzNote', () => {
  const z = (modell: string, kategorie: any, ergebnis: any, anlaeufe = 1, notiz: string | null = null): BilanzZeile => ({
    ts: '2026-10-12T10:00:00Z', projekt: '/p', workspaceId: null, laufId: 'L', haeppchen: 1, profil: 'mac', modell,
    mitTest: true, anlaeufe, dauerSek: 60, dateien: 1, diffZeilen: 5, workerTokens: null, ergebnis, kategorie, notiz,
  })
  it('zählt pro Modell × Kategorie: Aufträge, ohne Nachbesserung übernommen, Anläufe im Schnitt', () => {
    const md = renderBilanzNote([
      z('m-mac', 'ui', 'uebernommen'), z('m-mac', 'ui', 'nachgebessert', 2, 'Typ falsch'), z('m-dgx', 'test', 'selbst-uebernommen', 2),
    ])
    assert.match(md, /\| m-mac \| ui \| 2 \| 1 \| 1,5 \|/)
    assert.match(md, /\| m-dgx \| test \| 1 \| 0 \| 2,0 \|/)
    assert.match(md, /Typ falsch/)
  })
  it('höchstens zehn Nachbesserungs-Notizen, die neuesten zuerst', () => {
    const zs = Array.from({ length: 12 }, (_, i) => ({ ...z('m', 'ui', 'nachgebessert', 1, `n${i}`), ts: `2026-10-${String(i + 1).padStart(2, '0')}T00:00:00Z` }))
    const md = renderBilanzNote(zs)
    assert.match(md, /n11/); assert.doesNotMatch(md, /\bn1\b/)
  })
  it('leer: ein Satz statt einer leeren Tabelle', () => {
    assert.match(renderBilanzNote([]), /Noch keine Aufträge/)
  })
})
```

`test/main/local-factory/bilanz-sink.test.ts` (Review Focus 5):

```ts
import { describe, it } from 'node:test'
import * as assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { createBilanzSink } from '../../../src/main/local-factory/bilanz-sink'

function fakeNotes() {
  const store = new Map<string, string>()
  let n = 0
  return {
    store,
    async create(title: string, body: string) { const id = `N${++n}`; store.set(id, body); return { id } as any },
    async save(id: string, body: string) { store.set(id, body); return { id } as any },
    async read(id: string) { return store.has(id) ? ({ id, body: store.get(id) } as any) : null },
  }
}
const zeile = (i: number) => ({ ts: `2026-10-12T0${i}:00:00Z`, projekt: '/p', workspaceId: null, laufId: 'L', haeppchen: i,
  profil: 'mac', modell: 'm', mitTest: true, anlaeufe: 1, dauerSek: 1, dateien: 1, diffZeilen: 1, workerTokens: null,
  ergebnis: 'uebernommen' as const, kategorie: 'ui' as const, notiz: null })

describe('BilanzSink', () => {
  it('hängt an und schreibt dieselbe Note neu', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bil-'))
    const notes = fakeNotes()
    const s = createBilanzSink({ dir, notes })
    await s.record(zeile(1)); await s.record(zeile(2))
    assert.equal(fs.readFileSync(path.join(dir, 'bilanz.jsonl'), 'utf-8').trim().split('\n').length, 2)
    assert.equal(notes.store.size, 1)
    assert.match([...notes.store.values()][0], /\| m \| ui \| 2 \|/)
  })
  it('Note vom User gelöscht: beim nächsten Eintrag neu anlegen', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bil-'))
    const notes = fakeNotes()
    const s = createBilanzSink({ dir, notes })
    await s.record(zeile(1))
    notes.store.clear()
    await s.record(zeile(2))
    assert.equal(notes.store.size, 1)
  })
  it('kaputte Zeile in der jsonl: übersprungen, nicht geworfen', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bil-'))
    fs.writeFileSync(path.join(dir, 'bilanz.jsonl'), '{kaputt\n')
    const notes = fakeNotes()
    await createBilanzSink({ dir, notes }).record(zeile(1))
    assert.match([...notes.store.values()][0], /\| m \| ui \| 1 \|/)
  })
})
```

`runner-workshop.test.ts` ergänzen (Review Focus 4):

```ts
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
```

`git-ops.test.ts` ergänzen:

```ts
it('diffStat zählt Dateien und geänderte Zeilen zwischen zwei Commits', async () => {
  // Aufbau wie die übrigen Tests dieser Datei: Repo mit init-Commit als base
  fs.writeFileSync(path.join(repo, 'a.txt'), 'x\ny\n'); git('add', '.'); git('commit', '-qm', 'a')
  const head = git('rev-parse', 'HEAD')
  assert.deepEqual(await diffStat(repo, base, head), { dateien: 1, zeilen: 2 })
})
```

- [ ] **Step 2: Rot sehen**

Run: `node --test --import tsx test/main/local-factory/bilanz.test.ts test/main/local-factory/bilanz-sink.test.ts test/main/local-factory/runner-workshop.test.ts test/main/local-factory/git-ops.test.ts`
Expected: FAIL — Module fehlen, `judge` fehlt.

- [ ] **Step 3: Implementieren**

`git-ops.ts`:

```ts
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
```

`lauf.ts`:
- `HaeppchenStatus` um `'beurteilt'` erweitern und in `STATUS` aufnehmen.
- `Haeppchen.mitTest?: boolean`; `beginVersuch(lauf, { …, mitTest?: boolean })` setzt es beim Neuanlegen.
- `Versuch.dateien?: number`, `Versuch.diffZeilen?: number`.
- Neu:

```ts
/**
 * Urteil des Workshops (Spec 2026-10-12 §5). Anders als `markAbgenommen` auch für
 * ein ausgeschöpftes Häppchen — „selbst übernommen" ist ein Urteil über einen
 * roten Lauf. Nie für ein laufendes oder schon beurteiltes.
 */
export function markBeurteilt(lauf: Lauf, nummer: number): Lauf {
  const h = lauf.haeppchen.find(x => x.nummer === nummer)
  if (!h || (h.status !== 'wartet' && h.status !== 'eskaliert')) return lauf
  return replaceH(lauf, { ...h, status: 'beurteilt' })
}
```

`bilanz.ts`:

```ts
import type { Lauf } from './lauf'

/**
 * Die Bilanz des Local Workshops (Spec 2026-10-12 §5). Fakten misst der Läufer,
 * das Urteil gibt Claude — so kann die Rolle die Zahlen nicht schönreden.
 */

export const ERGEBNISSE = ['uebernommen', 'nachgebessert', 'neu-geschnitten', 'selbst-uebernommen'] as const
export const KATEGORIEN = ['test', 'boilerplate', 'refactor', 'doku', 'ui', 'config', 'logik'] as const
export type Ergebnis = typeof ERGEBNISSE[number]
export type Kategorie = typeof KATEGORIEN[number]
export interface Urteil { ergebnis: Ergebnis; kategorie: Kategorie; notiz?: string }

export interface BilanzZeile {
  ts: string; projekt: string; workspaceId: string | null; laufId: string; haeppchen: number
  profil: string | null; modell: string | null; mitTest: boolean; anlaeufe: number; dauerSek: number
  dateien: number; diffZeilen: number; workerTokens: { input: number; output: number } | null
  ergebnis: Ergebnis; kategorie: Kategorie; notiz: string | null
}

export function validateUrteil(u: Partial<Urteil>): string[] {
  const errs: string[] = []
  if (!ERGEBNISSE.includes(u.ergebnis as Ergebnis)) errs.push(`ergebnis: eins von ${ERGEBNISSE.join(', ')}`)
  if (!KATEGORIEN.includes(u.kategorie as Kategorie)) errs.push(`kategorie: eins von ${KATEGORIEN.join(', ')}`)
  if (u.ergebnis === 'nachgebessert' && !(typeof u.notiz === 'string' && u.notiz.trim())) {
    errs.push('notiz: Pflicht bei nachgebessert — eine Zeile, was nicht stimmte')
  }
  return errs
}

export function buildBilanzZeile(
  lauf: Lauf, nummer: number, u: Urteil, ctx: { now: string; workspaceId: string | null; mitTest: boolean },
): BilanzZeile {
  const h = lauf.haeppchen.find(x => x.nummer === nummer)!
  const last = h.versuche.at(-1)
  const dauerMs = h.versuche.reduce((s, v) => s + Math.max(0, (v.beendet ?? v.gestartet) - v.gestartet), 0)
  return {
    ts: ctx.now, projekt: lauf.projekt, workspaceId: ctx.workspaceId, laufId: lauf.id, haeppchen: nummer,
    profil: last?.profil ?? null, modell: last?.modell ?? null, mitTest: ctx.mitTest,
    anlaeufe: h.versuche.length, dauerSek: Math.round(dauerMs / 1000),
    dateien: last?.dateien ?? 0, diffZeilen: last?.diffZeilen ?? 0, workerTokens: last?.tokensAmEnde ?? null,
    ergebnis: u.ergebnis, kategorie: u.kategorie, notiz: u.notiz?.trim() || null,
  }
}

const komma = (n: number): string => n.toFixed(1).replace('.', ',')

export function renderBilanzNote(zeilen: BilanzZeile[]): string {
  if (zeilen.length === 0) return 'Noch keine Aufträge. Die erste Zeile entsteht beim ersten Urteil.\n'
  const gruppen = new Map<string, BilanzZeile[]>()
  for (const z of zeilen) {
    const k = `${z.modell ?? '(unbekannt)'}\u0000${z.kategorie}`
    gruppen.set(k, [...(gruppen.get(k) ?? []), z])
  }
  const rows = [...gruppen.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, zs]) => {
    const [modell, kategorie] = k.split('\u0000')
    const ohne = zs.filter(z => z.ergebnis === 'uebernommen').length
    const schnitt = zs.reduce((s, z) => s + z.anlaeufe, 0) / zs.length
    return `| ${modell} | ${kategorie} | ${zs.length} | ${ohne} | ${komma(schnitt)} |`
  })
  const notizen = zeilen
    .filter(z => z.ergebnis === 'nachgebessert' && z.notiz)
    .sort((a, b) => b.ts.localeCompare(a.ts))
    .slice(0, 10)
    .map(z => `- ${z.ts.slice(0, 10)} · ${z.modell ?? '?'} · ${z.kategorie}: ${z.notiz}`)
  return [
    `Stand: ${zeilen.length} Aufträge. Quelle: \`bilanz.jsonl\` — diese Note wird bei jedem Urteil neu geschrieben.`,
    '',
    '| Modell | Kategorie | Aufträge | ohne Nachbesserung übernommen | Anläufe im Schnitt |',
    '|---|---|---|---|---|',
    ...rows,
    '',
    '## Zuletzt nachgebessert',
    '',
    ...(notizen.length ? notizen : ['- (noch nichts)']),
    '',
  ].join('\n')
}
```

`bilanz-sink.ts`:

```ts
import * as fs from 'fs'
import * as path from 'path'
import type { NoteManager } from '../notes/note-manager'
import { renderBilanzNote, type BilanzZeile } from './bilanz'

export const BILANZ_NOTE_TITLE = 'Local Workshop: Bilanz'
export interface BilanzSink { record(z: BilanzZeile): Promise<void> }

/**
 * Hängt eine Zeile an `bilanz.jsonl` und schreibt die Note neu. Die Note-ID liegt
 * neben der Datei; ist die Note weg (vom User gelöscht), entsteht eine neue —
 * die jsonl ist die Wahrheit, die Note nur ihre Ansicht.
 */
export function createBilanzSink(opts: { dir: string; notes: Pick<NoteManager, 'create' | 'save' | 'read'> }): BilanzSink {
  const jsonl = path.join(opts.dir, 'bilanz.jsonl')
  const idFile = path.join(opts.dir, 'bilanz-note.json')
  const readAll = (): BilanzZeile[] => {
    let raw = ''
    try { raw = fs.readFileSync(jsonl, 'utf-8') } catch { return [] }
    const out: BilanzZeile[] = []
    for (const l of raw.split('\n')) {
      if (!l.trim()) continue
      try { out.push(JSON.parse(l) as BilanzZeile) } catch { /* kaputte Zeile: überspringen */ }
    }
    return out
  }
  return {
    async record(z) {
      fs.mkdirSync(opts.dir, { recursive: true })
      fs.appendFileSync(jsonl, JSON.stringify(z) + '\n', 'utf-8')
      const body = `# ${BILANZ_NOTE_TITLE}\n\n${renderBilanzNote(readAll())}`
      let id: string | null = null
      try { id = (JSON.parse(fs.readFileSync(idFile, 'utf-8')) as { id?: string }).id ?? null } catch { /* */ }
      if (id && (await opts.notes.read(id))) {
        await opts.notes.save(id, body)
        return
      }
      const created = await opts.notes.create(BILANZ_NOTE_TITLE, body, ['kind:reference', 'entity:local-workshop'])
      fs.writeFileSync(idFile, JSON.stringify({ id: created.id }) + '\n', 'utf-8')
    },
  }
}
```

> Beim Bauen prüfen: Erwartet `save` den Body mit oder ohne `# Titel`? `extractTitle(body)` liest den Titel aus dem Body — dann ist „mit" richtig. Die Note wird mit `create(title, body)` angelegt; ob `create` den Titel zusätzlich voranstellt, an `note-manager.ts:291` nachsehen und den Body entsprechend bauen, damit kein doppelter Titel entsteht.

`runner.ts`:
- `RunnerOpts`: `bilanz?: BilanzSink`, `workspaceId?: string | null`.
- In `prepare`: `beginVersuch(lauf0, { …, mitTest: prot.length > 0 })`.
- In `runAttemptInner` nach dem grünen Commit: `const stat = await diffStat(projekt, a.base, commit)` und `dateien: stat.dateien, diffZeilen: stat.zeilen` in `endVersuch`. Fehler dort fangen und auslassen (Messwert fehlt lieber, als dass ein entschiedener Versuch kippt — `started.settled` ist schon gesetzt).
- Neu:

```ts
  /** Urteil des Workshops: Lauf markieren, Bilanz-Zeile schreiben (Spec 2026-10-12 §5). */
  async judge(laufId: string, nummer: number, u: Partial<Urteil>): Promise<AcceptResult> {
    const errs = validateUrteil(u)
    if (errs.length) return { ok: false, error: `Urteil ungültig: ${errs.join('; ')}` }
    if (!LAUF_ID.test(laufId)) return { ok: false, error: 'laufId ungültig.' }
    const f = this.laufFile(laufId)
    const lauf = loadLauf(f)
    if (!lauf) return { ok: false, error: `Lauf ${laufId} unbekannt.` }
    const next = markBeurteilt(lauf, nummer)
    if (next === lauf) {
      const h = lauf.haeppchen.find(x => x.nummer === nummer)
      return { ok: false, error: h ? `Häppchen #${nummer} ist nicht zu beurteilen (Status ${h.status}).` : `Häppchen #${nummer} gibt es nicht.` }
    }
    saveLauf(f, next)
    const h = next.haeppchen.find(x => x.nummer === nummer)!
    await this.o.bilanz?.record(buildBilanzZeile(next, nummer, u as Urteil, {
      now: new Date(this.o.now()).toISOString(), workspaceId: this.o.workspaceId ?? null, mitTest: h.mitTest ?? true,
    }))
    return { ok: true }
  }
```

  (`bilanz` und `workspaceId` aus dem `Required<…>`-Typ der Optionen herausnehmen wie `host`/`laufDir`.)

`tool-call.ts`:

```ts
export type ToolArgs = Partial<DispatchArgs> & { accept?: boolean } & Partial<Urteil>

  if (args.accept) {
    if (!args.laufId || args.haeppchen === undefined) { … wie bisher … }
    if (rolle === 'local-workshop') {
      const r = await runner.judge(args.laufId, args.haeppchen, { ergebnis: args.ergebnis, kategorie: args.kategorie, notiz: args.notiz })
      return r.ok ? { result: { ok: true, beurteilt: args.haeppchen }, isError: false } : { result: r, isError: true }
    }
    … bisheriger accept-Weg …
  }
```

  Signatur: `handleLocalFactoryCall(runner, args, rolle: RunnerRolle = 'local-factory')`; `Pick<…, 'dispatch' | 'accept' | 'judge'>`.

`local-factory-tool.ts`: Schema um `ergebnis: z.enum(ERGEBNISSE).optional()`, `kategorie: z.enum(KATEGORIEN).optional()`, `notiz: z.string().optional()` erweitern; Beschreibung: `'local-workshop: accept=true carries the verdict (ergebnis, kategorie, notiz — notiz required for nachgebessert) and also works for an exhausted item.'` Beim Anlegen des Läufers für `local-workshop`:

```ts
      bilanz: rolle === 'local-workshop' && ctx.noteManager
        ? createBilanzSink({ dir: path.join(ENTITIES_BASE, 'local-workshop'), notes: ctx.noteManager })
        : undefined,
      workspaceId: ctx.workspaceId ?? null,
```

  `ENTITIES_BASE`: denselben Ausdruck verwenden, mit dem `entity-registry.ts` `entitiesBase` bildet (dort nachsehen; nicht neu erfinden). Aufruf: `handleLocalFactoryCall(getRunner(ctx), args, rolle)`.

- [ ] **Step 4: Grün sehen**

Run: `npm run test`
Expected: PASS, alle.

- [ ] **Step 5: Commit**

```bash
git add src/main/local-factory src/main/mcp/local-factory-tool.ts test/main/local-factory
git commit -m "feat(local-workshop): Urteil und Bilanz -- Fakten vom Läufer, Urteil von Claude"
```

---

### Task 6: Die Rolle

**Files:**
- Create: `src/main/local-factory/workshop-preset.ts`
- Modify: `src/shared/types.ts:21` (`BuiltinEntityId`)
- Modify: `src/shared/tag-axes.ts:85-89` (`ENTITY_VALUES`)
- Modify: `src/main/session/entity-registry.ts` (nach `local-worker`)
- Modify: `src/main/session/session-manager.ts:1254-1258` (Preset write-once)
- Modify: `src/main/entity-content/preset-templates.ts`
- Modify: `src/renderer/components/SessionCell.tsx:171`, `src/renderer/components/PaneHeader.tsx:34`
- Test: `test/main/local-factory/workshop-preset.test.ts` (neu), `test/main/role-templates-render-clean.test.ts`, `test/main/role-templates-name-real-tools.test.ts:25`

**Interfaces:**
- Consumes: `LOCAL_WORKER_DISPATCH_TOOL`, `ERGEBNISSE`, `KATEGORIEN`, `BILANZ_NOTE_TITLE`
- Produces: `generateLocalWorkshopPreset(): string`, Marker `<!-- local-workshop-v1 -->`

- [ ] **Step 1: Failing tests schreiben**

`test/main/local-factory/workshop-preset.test.ts`:

```ts
import { describe, it } from 'node:test'
import * as assert from 'node:assert/strict'
import { generateLocalWorkshopPreset } from '../../../src/main/local-factory/workshop-preset'
import { LOCAL_WORKER_DISPATCH_TOOL } from '../../../src/main/local-factory/presets'
import { ERGEBNISSE, KATEGORIEN } from '../../../src/main/local-factory/bilanz'
import { BILANZ_NOTE_TITLE } from '../../../src/main/local-factory/bilanz-sink'
import { PRESET_TEMPLATES } from '../../../src/main/entity-content/preset-templates'

const p = generateLocalWorkshopPreset()

describe('Local-Workshop-Rollentext', () => {
  it('trägt den Versionsmarker und steht in PRESET_TEMPLATES', () => {
    assert.match(p, /^<!-- local-workshop-v1 -->/)
    assert.equal(PRESET_TEMPLATES['local-workshop'](), p)
  })
  it('nennt das Werkzeug, die Etiketten lokal/selbst und die Bilanz-Note', () => {
    assert.match(p, new RegExp(LOCAL_WORKER_DISPATCH_TOOL))
    assert.match(p, /\*\*lokal\*\*/); assert.match(p, /\*\*selbst\*\*/)
    assert.ok(p.includes(BILANZ_NOTE_TITLE))
  })
  it('nennt jedes Ergebnis und jede Kategorie genau so, wie das Werkzeug sie annimmt', () => {
    for (const e of ERGEBNISSE) assert.ok(p.includes(`\`${e}\``), e)
    for (const k of KATEGORIEN) assert.ok(p.includes(`\`${k}\``), k)
  })
  it('kein Polling, Spec spiegeln, Plan als Note, Profil nur auf Ansage', () => {
    assert.match(p, /kein Polling/i)
    assert.match(p, /mux_mirror_sync/)
    assert.match(p, /kind:plan/)
    assert.match(p, /nur, wenn der User/i)
  })
  it('nach zwei Anläufen selbst übernehmen, nicht eskalieren', () => {
    assert.match(p, /selbst übernehmen/)
    assert.doesNotMatch(p, /ESKALIERT/)
  })
})
```

In `role-templates-render-clean.test.ts` die Map `rendered` um `'local-workshop': generateLocalWorkshopPreset` ergänzen (Import dazu). In `role-templates-name-real-tools.test.ts:25` `'local-workshop'` in die Liste der Rollen aufnehmen, für die registriert wird: `for (const entityId of [null, 'local-factory', 'local-workshop'])`.

- [ ] **Step 2: Rot sehen**

Run: `node --test --import tsx test/main/local-factory/workshop-preset.test.ts test/main/role-templates-render-clean.test.ts`
Expected: FAIL — Modul fehlt.

- [ ] **Step 3: Implementieren**

`src/main/local-factory/workshop-preset.ts`:

```ts
import { LOCAL_WORKER_DISPATCH_TOOL } from './presets'
import { ERGEBNISSE, KATEGORIEN } from './bilanz'
import { BILANZ_NOTE_TITLE } from './bilanz-sink'

/**
 * Rollentext des Local Workshops (Spec 2026-10-12 §3). write-once wie die
 * übrigen Rollen mit Vorlage; der Marker macht einen Rückstand sichtbar
 * (entity-content/preset-version.ts). Beim Ändern des Inhalts hochzählen.
 */
export function generateLocalWorkshopPreset(): string {
  const code = (xs: readonly string[]) => xs.map(x => `\`${x}\``).join(', ')
  return `<!-- local-workshop-v1 -->
# Local Workshop — Alltag mit lokalem Worker

Du arbeitest wie eine normale Claude-Code-Session: verstehen, klären, planen, umsetzen.
Der Unterschied: Routine gibst du an ein lokales Modell (Local Worker, opencode) und prüfst
das Ergebnis. Heikles machst du selbst. Das Ziel ist zweifach — Claude-Kontingent für Routine
sparen, und ehrlich lernen, was das lokale Modell kann.

## Zu Beginn jeder Session

Lies die Note **„${BILANZ_NOTE_TITLE}"** (\`mux_notes_search\`). Sie zeigt pro Modell und
Kategorie, wie viele Aufträge ohne Nachbesserung durchgingen, und die letzten Nachbesserungen.
Schneide danach zu: was ein Modell in einer Kategorie verlässlich schafft, wird **lokal**;
woran es wiederholt scheitert, wird **selbst**. Gibt es die Note noch nicht, fang vorsichtig an —
kleine, klar umrissene Tasks.

## Ablauf

1. **Verstehen.** Brainstorming, Fragen klären. Kleines bleibt im Chat; Größeres bekommt eine
   Spec unter \`docs/superpowers/specs/\`.
2. **Plan mit Zuschnitt.** Jeder Task trägt ein Etikett:
   - **lokal** — Routine: klares Ziel, wenige Dateien, keine Designentscheidung. Typisch: Tests
     nach Vorlage, Boilerplate, Umbenennung, Doku, kleine UI-Anpassung, Datenabbildung, ein Feld mehr.
   - **selbst** — Urteil gefragt: Architektur, Sicherheit, Datenmigration, knifflige Fehlersuche,
     alles in den fragilen Zonen des Projekts.
   Zeig dem User den Plan mit Etiketten, bevor es losgeht. Er kann Tasks umhängen.
3. **Spiegeln.** Damit der User beides in den Notes liest: die Spec committen und mit
   \`mux_mirror_sync\` spiegeln; den Plan als Note mit \`mux_notes_create\` und \`kind:plan\`
   anlegen und beim Abarbeiten nachführen (erledigte Tasks abhaken, \`status:\`-Tag pflegen).
4. **Abarbeiten.** selbst-Tasks machst du direkt. Vor jedem Dispatch: eigenen Stand committen —
   der Läufer verlangt einen sauberen Arbeitsbaum. lokal-Tasks per \`${LOCAL_WORKER_DISPATCH_TOOL}\`.
5. **Durchsicht und Urteil** (siehe unten).

## Dispatch

Pflichtfelder: \`projekt\`, \`ziel\`, \`dateien\`, \`akzeptanzkriterium\`, \`geschuetzteTests\`,
\`testBefehl\`, \`nichtZiele\`.

- **Mit Abnahmetest**, wo der Task einen eigenen Test verdient: Test schreiben, er muss jetzt rot
  sein, nicht committen, in \`geschuetzteTests\` nennen — zusammen mit allem, worauf der Testbefehl
  angewiesen ist (Testskript, Setup, Fixtures).
- **Ohne Abnahmetest** für Routine ohne eigenen Test (Doku, Umbenennung, Config):
  \`geschuetzteTests: []\`. Der \`testBefehl\` bleibt Pflicht — mindestens Typecheck oder Suite.
- **laufId:** Der erste Dispatch gibt eine zurück. Bei jedem weiteren Task desselben Plans und bei
  jedem neuen Anlauf mitgeben.
- **profil:** Weglassen — dann gilt das Standardprofil. Ein anderes Profil nur, wenn der User es
  ausdrücklich sagt („heute vergleichen wir mit …"); sonst wird die Bilanz ein Durcheinander.

Dann **warten**. Der Mux weckt dich mit einer Zeile \`[local-workshop] …\`. Kein Polling, kein
capture-pane, kein mux_context_usage auf den Worker. Während der Worker läuft, das Ziel-Repo nicht
anfassen — keine Datei, kein git-Befehl.

## Weckzeilen

- \`… GRÜN, Versuch V/2, Commit <hash>\` — Commit lesen (\`git show\`), dann Urteil.
- \`… ROT\` oder \`… HÄNGT\` — neu anlaufen mit derselben \`laufId\` und \`haeppchen\`-Nummer; die
  Gate-Ausgabe geht von selbst in den neuen Auftrag. Oder kleiner neu schneiden.
- Endet sie auf \`— ausgeschöpft, selbst übernehmen\`: zwei Anläufe sind durch. Mach den Task
  selbst und gib das Urteil \`selbst-uebernommen\`.
- \`Nicht bereit: …\` — kein Versuch gezählt. Typisch: das Modell ist nicht erreichbar oder der
  Worker ist durch eine andere Rolle belegt. Sag es dem User einmal und mach selbst weiter.

## Urteil

Zu **jedem** Häppchen, das ein Modell bearbeitet hat, genau ein Urteil:
\`${LOCAL_WORKER_DISPATCH_TOOL}\` mit \`accept: true\`, \`laufId\`, \`haeppchen\` und

- \`ergebnis\`: ${code(ERGEBNISSE)}
  - \`uebernommen\` — so wie es ist.
  - \`nachgebessert\` — du hast korrigiert. \`notiz\` ist Pflicht: eine Zeile, was nicht stimmte.
  - \`neu-geschnitten\` — zu groß oder zu unklar, du schneidest kleiner neu.
  - \`selbst-uebernommen\` — nach zwei Anläufen selbst gemacht.
- \`kategorie\`: ${code(KATEGORIEN)}

Sei ehrlich, auch wenn es knapp war. Die Bilanz ist nur so viel wert wie diese Urteile, und aus
ihr schneidest du beim nächsten Mal zu.

## Notes-Tagging

Spec und Plan spiegelt \`mux_mirror_sync\` (Typ \`spec\`). Eigene Notes mit
\`mux_notes_create\` und passenden Tags: \`kind:plan\`, \`kind:finding\`, \`phase:coding\`,
\`status:open\` → \`status:in-progress\` → \`status:done\`.

## Jenseits der Session

Companion Memory gehört dem Companion — du hast diese Werkzeuge nicht. Was die Session
überdauern soll, wird eine Note (\`mux_notes_create\`), wiedergefunden mit \`mux_notes_search\`.
`
}
```

`src/shared/types.ts:21`: `| 'local-workshop'` an `BuiltinEntityId` anhängen.

`src/shared/tag-axes.ts`: `'local-factory', 'local-worker', 'local-workshop',`.

`entity-registry.ts` nach `local-worker`:

```ts
  registry.register({
    id: 'local-workshop',
    displayName: 'Local Workshop',
    icon: '🛠️',
    color: '#00897b',
    projectPath: `${entitiesBase}/local-workshop`,
    features: ['mcp'],
    visible: true,
    sortOrder: 43,
    singleInstance: true,
  })
```

`session-manager.ts` — neuer Zweig neben `local-factory`:

```ts
      } else if (config.id === 'local-workshop') {
        if (!fs.existsSync(presetMdPath)) {
          fs.writeFileSync(presetMdPath, generateLocalWorkshopPreset(), 'utf-8')
        }
```

`preset-templates.ts`: `'local-workshop': generateLocalWorkshopPreset,` und Import.

`SessionCell.tsx` und `PaneHeader.tsx`: `'local-workshop': '#00897b',` neben `'local-worker'`.

- [ ] **Step 4: Grün sehen**

Run: `npm run test`, dann beide Typechecks.
Expected: alle grün. Insbesondere `role-templates-*` und `code-writes-axis-tags`.

- [ ] **Step 5: Commit**

```bash
git add src test
git commit -m "feat(local-workshop): die Rolle -- Claude-Alltag, Routine an den lokalen Worker"
```

---

### Task 7: Doku und Release-Vorbereitung

**Files:**
- Modify: `CLAUDE.md` (Projekt, gitignored — Abschnitt nach „Local Cyber Factory")
- Modify: `docs/mcp-tools.md` (Eintrag `mux_local_worker_dispatch`: Felder `profil`, `ergebnis`, `kategorie`, `notiz`; Rollen)
- Modify: `CHANGELOG.md` (`[Unreleased]`)
- Modify: `README.md` (Rollenliste, falls dort Rollen gezählt werden — mit `grep -n "roles\|Rollen" README.md` prüfen), `ARCHITECTURE.md:11` (Zahl der Rollen 12 → 13, `Local Workshop` in die Aufzählung)

- [ ] **Step 1:** CLAUDE.md-Abschnitt „Local Workshop" (Zweck, Unterschied zur Factory in drei Zeilen, Profile in `agent.localWorkerProfiles`, Bilanz unter `entities/local-workshop/bilanz.jsonl` + Note, Worker-Sperre pro Workspace, und die Ollama-Falle mit dem Kontextfenster).
- [ ] **Step 2:** CHANGELOG-Eintrag unter `[Unreleased]` / `### Added`.
- [ ] **Step 3:** `docs/mcp-tools.md` und ARCHITECTURE nachziehen. Prüfen: `grep -rn "12 roles\|12 Rollen" README.md ARCHITECTURE.md docs`.
- [ ] **Step 4:** `npm run test` grün; Commit `docs(local-workshop): Rolle, Profile, Bilanz dokumentiert`.

---

### Task 8: Mac-Profil einrichten und echte Abnahme

Kein Code-Task — hier wird gegen das echte Modell geprüft.

**Recherche-Ergebnis (2026-10-12, Mac mini M4 Pro, 64 GB, Ollama 0.33.2):** Ollama mit dem MLX-Tag `qwen3.8:27b-mlx`, Denkmodus aus, Kontext fest 64k. Gründe: Qwen3.8 ist hybrid (48 DeltaNet-, 16 Attention-Schichten); `llama-server` verarbeitet bei mehreren Runden teils den ganzen Prompt neu (llama.cpp #20225, nennt opencode), Ollamas MLX-Läufer hat Cache-Wiederherstellungspunkte (ab 0.33.0, Quelle schwach). Speicher gerechnet: ~18 GB Gewichte + 4 GiB KV bei 64k ≈ 23–24 GB; mit gemma4 (18,4 GB) ≈ 43 GB, unter dem geschätzten GPU-Limit von ~48 GB. Erwartet: Generierung ~11–16 tok/s, kalter Prefill von 15k ≈ 2 min (Schätzung). Zweite Wahl: `llama-server` mit unsloth `Qwen3.8-27B-UD-Q4_K_XL.gguf`, gepatchtes Template, `--reasoning off -c 65536 -fa on -ctk q8_0 -ctv q8_0 --parallel 1`.

- [ ] **Step 1: Modell bereitstellen.** `ollama pull qwen3.8:27b-mlx` (Port: `OLLAMA_HOST=127.0.0.1:11433`). Dann eine Modelldatei als **neues** Modell, bestehende bleiben unberührt:

```
FROM qwen3.8:27b-mlx
PARAMETER num_ctx 65536
PARAMETER temperature 0.7
PARAMETER top_p 0.8
PARAMETER top_k 20
PARAMETER presence_penalty 1.5
```

`ollama create qwen38-27b-mlx-64k -f <datei>`. **Nicht** `OLLAMA_CONTEXT_LENGTH` setzen — das gilt global und träfe gemma4.
- [ ] **Step 2: Kontextfenster nachweisen.** Modell laden, `ollama ps` muss 65536 Kontext zeigen (Ollama nimmt sonst bei ≥ 48 GiB bis zu 256k — 16 GB KV-Cache; ob der MLX-Läufer `num_ctx` beachtet, ist ungeprüft). Dann eine Anfrage über `/v1/chat/completions` mit > 20k Tokens Prompt; die Antwort muss sich auf das **Ende** des Prompts beziehen.
- [ ] **Step 3: Denkmodus aus und Werkzeugaufruf nachweisen.** Anfrage mit `tools` im OpenAI-Format, einmal mit `reasoning_effort: "none"`, einmal mit `think: false`. Gewählt wird der Schlüssel, bei dem die Antwort **kein** `reasoning`-Feld enthält und `tool_calls` liefert (nicht Text, der wie ein Aufruf aussieht). Diesen Schlüssel als `modelOptions` ins Mac-Profil.
- [ ] **Step 3a: Timeout prüfen.** Ein kalter Prefill dauert Minuten. Bricht opencode vorher ab, kann der MLX-Prefix-Cache kaputtgehen und jeder Versuch beginnt von vorn. Den ersten Zug des Workers warm laufen lassen und im Ollama-Log prüfen, dass der zweite Zug den Cache nutzt; bei Abbrüchen das Timeout des Providers in opencode hochsetzen (als `modelOptions` bzw. Provider-Option — dann im Plan nachtragen).
- [ ] **Step 4: Profile eintragen** in `~/Library/Application Support/cipher-mux-electron/cipher-mux-config.json` (die Datei, die der Mux liest — **nicht** `~/.config/cipher-mux/config.json`): `localWorkerProfiles: { dgx: <bisheriger localWorker>, mac: {…} }`, `localWorkerDefaultProfile: 'mac'` solange der DGX trainiert. Vorher Sicherung der Config anlegen. App vorher beenden (sonst überschreibt der laufende Store die Datei).
- [ ] **Step 5: Release bauen und installieren** (Ablauf wie 0.12.7: Version, CHANGELOG, Commit, Tag, `npm run dist`, `git checkout src/shared/version.ts`, `gh release create`, Quit + rsync + open, `/tmp/kw-debug.json` prüfen).
- [ ] **Step 6: Echte Abnahme:** In einem Spielprojekt (eigenes git-Repo unter dem Scratchpad, nicht ein Projekt des Users) den Local Workshop aus dem Launcher starten. Auftrag: ein kleiner Plan mit einem lokal-Task mit Test und einem ohne Test. Nachweisen:
  - Die Weckzeile kommt in der Workshop-Session an, mit Präfix `[local-workshop]`.
  - `opencode.json` im Run-Verzeichnis des Workers nennt das Mac-Modell; `local-profile.json` liegt daneben.
  - Nach dem Urteil: eine Zeile in `bilanz.jsonl`, Note „Local Workshop: Bilanz" zeigt sie.
  - Eine parallel gestartete Local Factory im selben Workspace bekommt „Worker belegt durch local-workshop".
  Jeden Befund, der dabei auftaucht, als eigenen Fix mit Test vor dem Release nachziehen.
- [ ] **Step 7: Testcase für den User** in der Testcase-Note (`01KQNBDCH1D4G11PMAEM60TPTX`) ans Ende, offen: `## Local Workshop` / `- [ ] **T-LW.1** Im Alltag: eine kleine Idee mit dem Local Workshop umsetzen — Plan mit Etiketten gesehen, ein lokal-Task lief durch, Bilanz-Note zeigt ihn.` Nicht abhaken.
- [ ] **Step 8:** Die Plan-Note (`kind:plan`, angelegt beim Schreiben dieses Plans) auf den Endstand bringen: erledigte Tasks abgehakt, Befunde aus der Abnahme ergänzt, `status:done`.

> **Offene Lücke, nicht in v1:** `mux_mirror_sync` kennt nur die Typen spec/requirements/research, also keine Pläne. Der Rollentext sagt „Spec und Plan spiegeln" — für den Plan legt die Rolle bis dahin eine Note `kind:plan` von Hand an. Im Rollentext (Task 6) so formulieren: Spec über `mux_mirror_sync`, Plan als Note mit `mux_notes_create` und `kind:plan`.
