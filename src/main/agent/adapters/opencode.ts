import * as fs from 'fs'
import * as path from 'path'
import type {
  AgentAdapter,
  AdapterModel,
  LaunchCommand,
  LaunchOpts,
  AdapterContext,
  ProjectInstructions,
  InstructionsTarget,
  SendOpts,
} from '../agent-adapter'
import type { AdapterFeature, AdapterCapabilities, ContextUsage } from '../../../shared/types'
import { buildMcpServerConfig } from '../../mcp/workspace-header'
import {
  getEntityBoundary,
  buildOpenCodeBoundaryPlugin,
  OPENCODE_BOUNDARY_PLUGIN_FILENAME,
} from '../../session/entity-boundaries'
import {
  writeOpenCodeUsagePlugin,
  OPENCODE_USAGE_PLUGIN_FILENAME,
} from '../../monitoring/opencode-usage-plugin'
import {
  buildIdlePlugin,
  IDLE_PLUGIN_FILENAME,
  IDLE_SIGNAL_FILENAME,
} from '../../local-factory/worker-done'
import { parseOpenCodeModels } from '../adapter-models'
import { runCommand } from '../../util/exec-util'
import {
  readLocalProfileFile,
  resolveLocalWorkerProfile,
  buildLocalProviderBlock,
  localModelSpec,
  LOCAL_PROVIDER_ID,
  type LocalWorkerConfig,
} from '../../local-factory/local-provider'

/**
 * opencode-Adapter — Tier-2.
 *
 * Gemessen an **opencode 1.18.34 vom 2026-10-01**, erst gegen die Unit-Tests und
 * dann gegen die laufende CLI. Die zweite Runde ist die, die zaehlt: beim
 * Codex-Adapter fand die Abnahme vier Fehler, die keine Testsuite zeigte, und
 * drei davon liessen die Session hochkommen und aussehen wie Erfolg. Was hier
 * steht, steht in keinem Diff und kann mit der naechsten CLI-Version kippen.
 *
 * 1. **`AGENTS.md` ist die Projektanweisung, `CLAUDE.md` nur der Ersatz.**
 *    Gemessen am 2026-10-09 (1.18.35): liegt nur eine CLAUDE.md im Verzeichnis,
 *    liest opencode sie; liegt eine AGENTS.md daneben, liest es **nur** die —
 *    nicht „zusaetzlich", wie es hier bis dahin stand. Die Injektionsmechanik
 *    traegt, aber nur in die richtige Datei: siehe `instructionsTarget`.
 *
 * 2. **MCP mit freien HTTP-Headern funktioniert.** Gegen einen Horchposten
 *    belegt: `authorization`, `x-mux-workspace` und `x-mux-entity` kamen alle an,
 *    unter `user-agent: opencode/1.18.34`. Deshalb nutzt dieser Adapter den
 *    **normalen** Weg — `buildMcpServerConfig` aus `mcp/workspace-header.ts`,
 *    also dieselben Kopfnamen, die Claude Code schreibt — und **nicht** die
 *    Token-Bindung aus `mcp/bound-token.ts`. Die existiert einzig, weil Codex
 *    keine Header senden kann; sie hier zu nehmen hiesse, Identitaet und
 *    Berechtigung ohne Not zu vermischen.
 *
 * 3. **Kein positionales Projektargument.** `opencode [project]` nimmt ein
 *    Verzeichnis entgegen, und der Adapter gab `opts.projectPath` dorthin — bis
 *    die Abnahme zeigte, dass genau das die Session aus dem richtigen
 *    Verzeichnis herauszieht. Es ist derselbe Fehler, den Codex' `-C` hatte, und
 *    er ist hier nachgemessen: mit `tmux`-cwd = Run-Verzeichnis und dem Argument
 *    auf das authored-Verzeichnis zeigte `pane_current_path` **und** die
 *    Statuszeile von opencode das authored-Verzeichnis, und am Horchposten kam
 *    **null** Verbindung an — statt der zwoelf Anfragen ohne das Argument. Die
 *    generierte `opencode.json` lag im Run-Verzeichnis und wurde nie gelesen:
 *    keine MCP-Werkzeuge, keine Rollengrenze, kein Usage. Und zwar lautlos, die
 *    Session steht am Prompt und sieht gesund aus.
 *
 *    Grund wie bei Codex: `LaunchOpts.projectPath` ist bei einer Entity-Session
 *    das **authored**-Verzeichnis (`entities/<id>`), waehrend
 *    `postLaunchInjection` ins **Run**-Verzeichnis schreibt, wo der tmux-Pane
 *    schon steht. Also wird das cwd geerbt, so wie Claude Code es tut.
 *
 * 4. **Rollengrenzen laufen ueber ein Plugin — und sie feuern.** opencode kennt
 *    keine `PreToolUse`-Konfiguration, sondern Plugin-Module. Von seinen Events
 *    kann nur `tool.execute.before` einen Aufruf aufhalten: ein Wurf dort
 *    verhindert die Ausfuehrung, der Aufruf endet als `state.status: "error"`
 *    mit dem Grund in `state.error`, und das Modell liest ihn wortwoertlich.
 *    Nachgemessen in `opencode run` **und** in der TUI unter `--auto`, mit einem
 *    echten Modell: der verbotene Pfad entstand nicht, der erlaubte entstand,
 *    und die Session lief weiter. Begruendung und Messprotokoll in
 *    `session/entity-boundaries.ts`.
 *
 *    Zwei stille Fehlschlaege rund darum, beide gemessen:
 *    **(a)** Ein CommonJS-Plugin wird mit „Plugin export is not a function"
 *    abgewiesen — sichtbar nur unter `--print-logs`. Es muss ein ESM-Default-
 *    Export sein, der eine Funktion ist.
 *    **(b)** Der in opencodes eigener Hilfe aufgefuehrte Hook `permission.ask`
 *    wird vom Binary **nie** ausgeloest. Eine darauf gebaute Grenze waere
 *    geschrieben und tot.
 *
 * 5. **Context-Usage ohne Statusline, ueber dasselbe Plugin-System.** Ein
 *    `event`-Hook sieht jedes Bus-Ereignis; `message.updated` traegt pro
 *    Assistentennachricht `sessionID`, `modelID` und `tokens`. Daraus entsteht
 *    genau das JSON, das der bestehende `StatusLineMonitor` liest — ein weiterer
 *    Schreiber, kein zweiter Leser. Einzelheiten und die Grenze der Messung
 *    (das Kontextfenster ist geschaetzt, die Tokenzahlen nicht) in
 *    `monitoring/opencode-usage-plugin.ts`.
 *
 * Und eine Eigenschaft, die den Bau erst traegt: eine **projektlokale**
 * `opencode.json` im Arbeitsverzeichnis greift (`opencode debug config` zeigt
 * sie aufgeloest), und ein Plugin wird aus `.opencode/plugin/` **auto-entdeckt**
 * *und* laesst sich gleichzeitig in `plugin` eintragen, ohne doppelt zu laden
 * (gemessen: ein Ladevorgang, ein `plugin_origins`-Eintrag). Deshalb schreibt
 * dieser Adapter beides — die Datei dorthin, wo sie von sich aus gefunden wird,
 * und den Eintrag dazu, damit die Verdrahtung in `debug config` nachlesbar ist.
 *
 * **Nicht benutzen: `--pure`.** Das Flag laedt die Session ohne externe Plugins,
 * und damit ohne Rollengrenze und ohne Usage.
 */

/** Minimale Sicht auf die Agent-Konfiguration. Spiegelbild zu CodexConfigReader. */
export interface OpenCodeConfigReader {
  getSkipPermissions(): boolean
  /** Lokales Modell für `local-worker`, aus der Profil-Datei des Run-Verzeichnisses. Spec 2026-10-12 §4.4. */
  getLocalWorker?(runDir: string): LocalWorkerConfig | null
}

const defaultConfigReader: OpenCodeConfigReader = {
  getSkipPermissions(): boolean {
    // Lazy require, damit der Adapter ohne Electron testbar bleibt.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { configStore } = require('../../config/config-store')
    return configStore.get('agent').skipPermissions
  },
  getLocalWorker(runDir: string): LocalWorkerConfig | null {
    // Die Datei schreibt der Worker-Host vor dem Start. Fehlt sie, gilt das Standardprofil.
    // Achtung: ein von Hand gestarteter Worker liest eine liegengebliebene Datei des
    // letzten Laufs -- das Standardprofil gilt nur, wenn gar keine da ist.
    const fromFile = readLocalProfileFile(runDir)
    if (fromFile) return fromFile.cfg
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { configStore } = require('../../config/config-store')
    const r = resolveLocalWorkerProfile(configStore.get('agent') ?? {})
    return r.ok ? r.cfg : null
  },
}

/** Die Rolle, für die der lokale Anbieter geschrieben wird. */
export const LOCAL_WORKER_ENTITY_ID = 'local-worker'

/** Name der Konfigurationsdatei, die dieser Adapter schreibt. */
export const OPENCODE_CONFIG_FILENAME = 'opencode.json'

/**
 * Variante, die der Mux **nicht** schreibt, aber kennen muss.
 *
 * opencode liest `opencode.json` oder `opencode.jsonc`. Welche von beiden
 * gewinnt, wenn beide liegen, ist nicht gemessen — und JSONC laesst sich ohne
 * neue Abhaengigkeit nicht verlustfrei lesen-mergen-schreiben. Deshalb schreibt
 * der Adapter nur die `.json` und sagt es laut, wenn daneben eine `.jsonc`
 * liegt, statt stillschweigend eine Datei zu pflegen, die vielleicht ignoriert
 * wird.
 */
export const OPENCODE_CONFIG_FILENAME_JSONC = 'opencode.jsonc'

/** Schema-Verweis, den opencode in seinen Beispielen fuehrt. */
export const OPENCODE_SCHEMA_URL = 'https://opencode.ai/config.json'

/**
 * Verzeichnis, aus dem opencode Plugins von sich aus laedt.
 *
 * Gemessen: sowohl `.opencode/plugin/` als auch `.opencode/plugins/` werden
 * gescannt, jede `*.ts`- und jede ESM-`*.js`-Datei darin wird geladen. Der Mux
 * nimmt den Singular, weil die eingebaute Hilfe ihn zuerst nennt — und nur
 * eines von beiden, damit dieselbe Datei nicht zweimal liegt.
 */
export const OPENCODE_PLUGIN_SUBDIR = path.join('.opencode', 'plugin')

/**
 * Die beiden Plugins, die der Mux besitzt — und nur die.
 *
 * `mergeOpenCodeConfig` raeumt genau diese Namen aus dem `plugin`-Feld und
 * schreibt sie neu; jeder fremde Eintrag bleibt. Ohne diese Liste waere die
 * Alternative, das ganze Feld zu uebernehmen, und damit ein Plugin des Projekts
 * beim ersten Sessionstart zu verlieren.
 */
export const OPENCODE_OWNED_PLUGIN_FILENAMES: readonly string[] = [
  OPENCODE_USAGE_PLUGIN_FILENAME,
  OPENCODE_BOUNDARY_PLUGIN_FILENAME,
  IDLE_PLUGIN_FILENAME,
]

/**
 * Plugin-Eintrag in der Form, die opencode sicher aufloest.
 *
 * `file://` plus absoluter Pfad, nicht relativ: ein relativer Pfad gilt laut
 * Doku „relative to the declaring config", und das ist eine Annahme mehr als
 * noetig. Die URL-Form ist gemessen — ein Plugin ausserhalb von
 * `.opencode/plugin/` wurde allein durch diesen Eintrag geladen.
 */
export function toOpenCodePluginSpec(absolutePath: string): string {
  return `file://${absolutePath}`
}

/**
 * Kontextfenster, wenn es sich nicht erfragen laesst — und das ist hier der
 * Normalfall.
 *
 * Gemessen: `GET /api/model` eines laufenden opencode liefert ohne angemeldeten
 * Anbieter eine **leere** Liste, und einen selbst eingetragenen Anbieter kennt
 * der Katalog nie. Es gibt damit keinen gepruefften Weg, pro Modell die echte
 * Grenze zu lesen. Der Wert steht hier als Rueckfalloption, nicht als Wahrheit —
 * dieselbe Entscheidung wie `CODEX_FALLBACK_CONTEXT_WINDOW`: die Tokenzahlen in
 * der Anzeige sind gemessen, die Prozentzahl ist eine Schaetzung.
 */
export const OPENCODE_FALLBACK_CONTEXT_WINDOW = 200_000

/** Der `mcp.<name>`-Eintrag, wie opencode ihn erwartet. */
export interface OpenCodeMcpEntry {
  type: 'remote'
  url: string
  enabled: true
  headers: Record<string, string>
}

/**
 * Baut den MCP-Eintrag fuer opencode.
 *
 * Die Kopfzeilen kommen aus `buildMcpServerConfig`, damit die Kopfnamen an genau
 * einer Stelle stehen: `WORKSPACE_HEADER_CANONICAL` und
 * `ENTITY_HEADER_CANONICAL` sind dieselben Namen, die der Server beim
 * `initialize` bindet. Umgeformt wird nur die Huelle — opencode nennt den Typ
 * `remote`, wo Claude Code `http` sagt, und will ein ausdrueckliches `enabled`.
 */
export function buildOpenCodeMcpEntry(
  mcpUrl: string,
  apiKey: string,
  workspaceId: string | null,
  entityId?: string | null,
): OpenCodeMcpEntry {
  const { headers } = buildMcpServerConfig(mcpUrl, apiKey, workspaceId, entityId)
  return { type: 'remote', url: mcpUrl, enabled: true, headers }
}

/**
 * Mischt den Mux-Eintrag in eine bestehende `opencode.json`.
 *
 * Lesen-mergen-schreiben wie `claude-code.ts` es mit `settings.local.json` tut,
 * und aus demselben Grund: die Datei gehoert dem Projekt, nicht dem Mux. Besitz
 * hat der Mux nur an `mcp['cipher-mux']` — alles andere, auch fremde
 * MCP-Server, bleibt unberuehrt.
 *
 * `$schema` wird nur **ergaenzt**, wenn es fehlt. Einen vorhandenen Wert zu
 * ueberschreiben hiesse, dem Projekt eine Entscheidung wegzunehmen, die es
 * schon getroffen hat.
 *
 * Beim `plugin`-Feld reicht „nicht anfassen" nicht: eine Rolle kann ihre Grenze
 * verlieren, und dann muss der Eintrag weg, sonst erzwingt ein stehengebliebenes
 * Plugin weiter eine Regel, die niemand mehr erklaert. Deshalb werden die
 * **eigenen** Namen herausgefiltert und durch die uebergebenen ersetzt; alles
 * andere im Feld bleibt in seiner Reihenfolge stehen.
 */
export function mergeOpenCodeConfig(
  existing: Record<string, unknown>,
  entry: OpenCodeMcpEntry,
  pluginSpecs: readonly string[] = [],
  local: { provider: Record<string, unknown>; model: string } | null = null,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...existing }

  if (typeof merged.$schema !== 'string') {
    merged.$schema = OPENCODE_SCHEMA_URL
  }

  const mcp =
    merged.mcp && typeof merged.mcp === 'object' && !Array.isArray(merged.mcp)
      ? { ...(merged.mcp as Record<string, unknown>) }
      : {}
  mcp['cipher-mux'] = entry
  merged.mcp = mcp

  const foreign = (Array.isArray(merged.plugin) ? merged.plugin : []).filter(
    spec =>
      typeof spec !== 'string'
      || !OPENCODE_OWNED_PLUGIN_FILENAMES.some(name => spec.endsWith(name)),
  )
  const plugin = [...foreign, ...pluginSpecs]
  // Ein leeres Feld ist kein Fortschritt gegenueber keinem Feld — und wenn das
  // Projekt gar keines hatte, soll der Mux auch keines hinterlassen.
  if (plugin.length > 0) merged.plugin = plugin
  else delete merged.plugin

  // Lokaler Anbieter (Local Cyber Factory). Besitz hat der Mux nur an
  // provider['cipher-local'] und an einem model, das darauf zeigt — ein vom
  // Projekt gesetztes anderes model bleibt, wenn die Rolle keinen lokalen
  // Anbieter (mehr) hat.
  const provider =
    merged.provider && typeof merged.provider === 'object' && !Array.isArray(merged.provider)
      ? { ...(merged.provider as Record<string, unknown>) }
      : {}
  const ownModel =
    typeof merged.model === 'string' && merged.model.startsWith(`${LOCAL_PROVIDER_ID}/`)
  if (local) {
    provider[LOCAL_PROVIDER_ID] = local.provider
    merged.model = local.model
  } else {
    delete provider[LOCAL_PROVIDER_ID]
    if (ownModel) delete merged.model
  }
  if (Object.keys(provider).length > 0) merged.provider = provider
  else delete merged.provider

  return merged
}

export class OpenCodeAdapter implements AgentAdapter {
  readonly id = 'opencode'
  readonly displayName = 'opencode'
  readonly tier = 'tier-2' as const

  private readonly configReader: OpenCodeConfigReader

  constructor(configReader?: OpenCodeConfigReader) {
    this.configReader = configReader ?? defaultConfigReader
  }

  buildLaunchCommand(opts: LaunchOpts): LaunchCommand {
    const args: string[] = []

    // **Kein positionales Projektargument.** `opencode [project]` nimmt eines
    // entgegen, und hier stand es auch — bis die Abnahme zeigte, dass es die
    // Session aus dem richtigen Verzeichnis herauszieht. Siehe Kopfkommentar
    // Punkt 3: `opts.projectPath` ist bei einer Entity-Session das
    // authored-Verzeichnis, geschrieben wird aber ins Run-Verzeichnis, und der
    // tmux-Pane steht schon dort. Das Argument hat opencode genau daraus
    // herausgeholt — gemessen, mit null MCP-Verbindungen als Folge.
    //
    // `opts.projectPath` bleibt Teil des Vertrags und wird hier bewusst nicht
    // benutzt: das cwd des Panes ist die Wahrheit, wie bei Claude Code.

    // Fork schlaegt Resume — dieselbe Entscheidung wie bei den anderen beiden:
    // wer forken will, will keine Fortsetzung derselben Unterhaltung.
    //
    // `--fork` ist laut `--help` nur **zusammen mit** `--session` oder
    // `--continue` gueltig. Weil hier eine ID bekannt ist, ist `--session <id>`
    // die praezisere der beiden Varianten: sie benennt, was geforkt wird,
    // statt es aus „die letzte" zu erraten.
    if (opts.forkFromClaudeSessionId) {
      args.push('--session', opts.forkFromClaudeSessionId, '--fork')
    } else if (opts.forkLatest) {
      // Die andere der beiden gueltigen Formen: `--fork` mit `--continue`.
      args.push('--continue', '--fork')
    } else if (opts.resumeClaudeSessionId) {
      args.push('--session', opts.resumeClaudeSessionId)
    } else if (opts.resume) {
      // Ohne ID bleibt nur „die letzte Unterhaltung dieses Verzeichnisses".
      // Das ist genau die Lesart, die `LaunchOpts.resume` vorschreibt — kein
      // interaktiver Picker, in dem eine unbeaufsichtigte Entity-Session
      // sitzen bleibt.
      args.push('--continue')
    }

    // Beim lokalen Worker bestimmt das Profil das Modell (opencode.json, von der Bilanz notiert).
    // Ein `--model` aus dem Rollen-Override (entityModels) würde es still überstimmen, und die
    // Bilanz führte ein Modell, das nie lief. Ohne Profil-Datei (von Hand gestartet) bleibt es beim Alten.
    const profilBestimmtModell = opts.entityId === LOCAL_WORKER_ENTITY_ID
      && readLocalProfileFile(opts.workDir ?? opts.projectPath) !== null
    if (opts.model && !profilBestimmtModell) {
      // Erwartet `provider/model`. Der Mux gibt weiter, was die Rolle oder der
      // Nutzer gesetzt hat, und validiert es nicht: eine Liste gueltiger
      // Modell-IDs waere eine Kopie, die veraltet.
      args.push('--model', opts.model)
    }

    if (opts.skipPermissions ?? this.configReader.getSkipPermissions()) {
      // Das Gegenstueck zu `--dangerously-skip-permissions`: Permissions
      // werden automatisch erlaubt. Ohne das bleibt eine Entity-Session an der
      // ersten Rueckfrage stehen, und niemand antwortet.
      args.push('--auto')
    }

    return { cmd: 'opencode', args }
  }

  /**
   * Schreibt `opencode.json` plus die beiden Plugins ins Projekt.
   *
   * **Die Bindung reist im Kopf, nicht im Token.** Workspace (`ctx.workspaceId`)
   * und Rolle (`ctx.entityId`) gehen als `X-Mux-Workspace` und `X-Mux-Entity`
   * mit; dass opencode freie Header sendet, ist gegen einen Horchposten belegt.
   * Damit ist dies der Normalfall des Vertrags und nicht der Sonderweg, den
   * Codex gehen muss.
   *
   * **Die Rollengrenze entsteht hier und nicht im SessionManager.** Dort wird
   * sie fuer Claude Code geschrieben — als Hook in `.claude/settings.local.json`,
   * eine Datei, die opencode nicht liest. Eine Grenze gehoert dorthin, wo die
   * Datei entsteht, die sie traegt; sonst schreibt eine Stelle die Regel und
   * eine andere vergisst, sie zu verdrahten.
   *
   * Projektlokal und nicht global, aus demselben Grund wie bei Codex: die
   * globale Konfiguration gehoert dem Nutzer, und zwei Workspaces wuerden sich
   * darin gegenseitig ueberschreiben.
   *
   * Ein Fehlschlag wird geloggt, nicht geworfen: `postLaunchInjection` haengt an
   * der Session-Init-Kette, und ein Wurf dort kostet still den gesamten
   * Restore.
   */
  async postLaunchInjection(ctx: AdapterContext): Promise<void> {
    try {
      const configPath = path.join(ctx.projectPath, OPENCODE_CONFIG_FILENAME)

      if (fs.existsSync(path.join(ctx.projectPath, OPENCODE_CONFIG_FILENAME_JSONC))) {
        // Welche der beiden Dateien gewinnt, ist nicht gemessen. Lieber eine
        // Logzeile als die Annahme, der Mux habe hier etwas erreicht.
        console.warn(
          `[OpenCodeAdapter] ${OPENCODE_CONFIG_FILENAME_JSONC} liegt daneben — Vorrang ungemessen, geschrieben wird ${OPENCODE_CONFIG_FILENAME}`,
        )
      }

      let existing: Record<string, unknown> = {}
      try {
        const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          existing = parsed as Record<string, unknown>
        }
      } catch {
        // Datei fehlt oder ist kein brauchbares JSON — dann faengt der Mux neu
        // an. Bewusst nicht: eine unlesbare Datei als Grund, nichts zu tun.
      }

      const localCfg =
        ctx.entityId === LOCAL_WORKER_ENTITY_ID ? (this.configReader.getLocalWorker?.(ctx.projectPath) ?? null) : null
      const local = localCfg
        ? { provider: buildLocalProviderBlock(localCfg), model: localModelSpec(localCfg) }
        : null

      const pluginSpecs = this.writePlugins(ctx.projectPath, ctx.entityId, localCfg?.contextWindow)

      const entry = buildOpenCodeMcpEntry(ctx.mcpUrl, ctx.mcpApiKey, ctx.workspaceId, ctx.entityId)
      const merged = mergeOpenCodeConfig(existing, entry, pluginSpecs, local)

      fs.writeFileSync(configPath, JSON.stringify(merged, null, 2) + '\n', 'utf-8')
    } catch (err) {
      console.warn('[OpenCodeAdapter] opencode.json write failed:', err)
    }
  }

  /**
   * Legt Usage-Plugin und — falls die Rolle eine Grenze hat — Grenzen-Plugin
   * an und gibt ihre Eintraege fuer `opencode.json` zurueck.
   *
   * **Eine Rolle ohne Grenze verliert ihre Datei.** Nicht aus Ordnungsliebe: ein
   * stehengebliebenes Plugin wird weiter auto-entdeckt und erzwingt eine Regel,
   * die in `entity-boundaries.ts` niemand mehr nennt. Dasselbe tut der
   * SessionManager fuer den Claude-Code-Hook, und aus demselben Grund.
   */
  private writePlugins(
    projectPath: string,
    entityId?: string | null,
    contextWindow?: number,
  ): string[] {
    const pluginDir = path.join(projectPath, OPENCODE_PLUGIN_SUBDIR)
    const specs: string[] = []

    specs.push(
      toOpenCodePluginSpec(
        writeOpenCodeUsagePlugin(pluginDir, {
          contextWindowSize: contextWindow ?? OPENCODE_FALLBACK_CONTEXT_WINDOW,
        }),
      ),
    )

    const boundaryPath = path.join(pluginDir, OPENCODE_BOUNDARY_PLUGIN_FILENAME)
    const boundary = getEntityBoundary(entityId)
    if (boundary) {
      fs.writeFileSync(
        boundaryPath,
        buildOpenCodeBoundaryPlugin(
          boundary.denyPathPatterns,
          boundary.reason,
          boundary.denyListFile ? path.join(projectPath, boundary.denyListFile) : undefined,
        ),
        { encoding: 'utf-8', mode: 0o644 },
      )
      specs.push(toOpenCodePluginSpec(boundaryPath))
    } else {
      try { fs.unlinkSync(boundaryPath) } catch { /* war nie da */ }
    }

    // Idle-Signal nur für den lokalen Worker — der Läufer liest es.
    const idlePath = path.join(pluginDir, IDLE_PLUGIN_FILENAME)
    if (entityId === LOCAL_WORKER_ENTITY_ID) {
      fs.writeFileSync(idlePath, buildIdlePlugin(path.join(projectPath, IDLE_SIGNAL_FILENAME)), {
        encoding: 'utf-8', mode: 0o644,
      })
      specs.push(toOpenCodePluginSpec(idlePath))
    } else {
      try { fs.unlinkSync(idlePath) } catch { /* war nie da */ }
    }

    return specs
  }

  /**
   * Gemessen am 2026-10-09 (1.18.35): liegt nur CLAUDE.md im Verzeichnis, liest
   * opencode sie; liegt eine AGENTS.md daneben, liest es **nur** die. Der Mux
   * schreibt dorthin, wo opencode tatsaechlich liest — und legt keine AGENTS.md
   * an, die die CLAUDE.md verdecken wuerde.
   */
  instructionsTarget(present: { agentsMd: boolean; claudeMd: boolean }): InstructionsTarget {
    return { file: present.agentsMd ? 'AGENTS.md' : 'CLAUDE.md' }
  }

  getProjectMarkers(): string[] {
    return ['AGENTS.md', 'opencode.json', '.opencode']
  }

  async readProjectInstructions(projectPath: string): Promise<ProjectInstructions | null> {
    // Nur `AGENTS.md` — die Datei, die opencode bevorzugt. Wohin der Mux bei
    // einer Ordner-Session schreibt, entscheidet `instructionsTarget`.
    const filePath = path.join(projectPath, 'AGENTS.md')
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      return { content, filePath }
    } catch {
      return null
    }
  }

  supports(feature: AdapterFeature): boolean {
    return this.getCapabilities()[feature]
  }

  getCapabilities(): AdapterCapabilities {
    return {
      // Gemessen: die Config-Form mit `type: "remote"` und `headers` laeuft
      // durch, die Verbindung kommt am Server an.
      'mcp-injection': true,
      // Nicht ueber eine Statusline und nicht ueber `stats` — das Unterkommando
      // zaehlt nur ueber alle Sessions zusammen und kennt keine einzelne.
      // Sondern ueber den `event`-Hook eines Plugins, der pro
      // Assistentennachricht Tokenzahlen und die opencode-Session-ID sieht.
      // Siehe monitoring/opencode-usage-plugin.ts.
      'status-line': true,
      // `--auto` erlaubt Permissions automatisch.
      'skip-permissions': true,
      // **Nicht gemessen.** Es gibt `--agent <name>` und ein
      // `agent`-Unterkommando; dass eine laufende Session daraus Unteragenten
      // startet und der Mux sie sieht, ist damit nicht belegt. Ein Gate, das
      // auf einer Vermutung `true` sagt, laesst den Mux ins Leere greifen.
      'sub-agents': false,
      // AGENTS.md wird befolgt.
      'project-instructions': true,
      // Folgt aus 'mcp-injection': der Message Bus ist nichts als die
      // MCP-Werkzeuge `mux_send` / `mux_read`, und die sind erreichbar.
      'message-bus-participant': true,
      // Haengt an der Rollenbindung — und `X-Mux-Entity` kam an. Damit
      // registriert der Server die vier `companion_memory_*` fuer eine
      // Companion-Verbindung genauso wie bei Claude Code.
      'companion-mcp': true,
    }
  }

  /**
   * Liest die zuletzt vom Usage-Plugin geschriebene Messung.
   *
   * Dieselbe Form und dasselbe Verzeichnis wie bei Claude Code und Codex, weil
   * der StatusLineMonitor sie ohnehin liest. Im Normalbetrieb kommt die Zahl von
   * dort ueber `usage-updated`; diese Methode ist der direkte Griff danach, wie
   * der Vertrag ihn fuer `supports('status-line')` vorsieht.
   */
  async getContextUsage(sessionId: string): Promise<ContextUsage | null> {
    try {
      // Lazy, damit der Adapter ohne Electron-Pfade testbar bleibt.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { BRAND } = require('../../../shared/brand')
      const file = path.join(BRAND.statusLineDir, `${sessionId}.json`)
      const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>
      const cw = data.context_window as Record<string, unknown> | undefined
      if (!cw || typeof cw.used_percentage !== 'number') return null
      const model = data.model as Record<string, unknown> | undefined
      return {
        usedPercentage: cw.used_percentage,
        remainingPercentage:
          typeof cw.remaining_percentage === 'number'
            ? cw.remaining_percentage
            : 100 - cw.used_percentage,
        totalInputTokens: typeof cw.total_input_tokens === 'number' ? cw.total_input_tokens : 0,
        totalOutputTokens: typeof cw.total_output_tokens === 'number' ? cw.total_output_tokens : 0,
        contextWindowSize: typeof cw.context_window_size === 'number' ? cw.context_window_size : 0,
        modelId: typeof model?.id === 'string' ? model.id : '',
        updatedAt: Date.now(),
      }
    } catch {
      return null
    }
  }

  /**
   * Schreibt das Usage-Plugin nach.
   *
   * `postLaunchInjection` tut das schon und traegt es zusaetzlich in
   * `opencode.json` ein. Hier wird nur die Datei gelegt — der Eintrag fehlt dann,
   * aber die Auto-Entdeckung aus `.opencode/plugin/` greift auch ohne ihn
   * (gemessen). Das ist der Grund, warum beide Wege geschrieben werden: dieser
   * Pfad des Vertrags kann die Konfiguration nicht mitpflegen.
   */
  async attachStatusHook(projectPath: string): Promise<void> {
    writeOpenCodeUsagePlugin(path.join(projectPath, OPENCODE_PLUGIN_SUBDIR), {
      contextWindowSize: OPENCODE_FALLBACK_CONTEXT_WINDOW,
    })
  }

  async sendPrompt(_tmuxTarget: string, _prompt: string, _opts?: SendOpts): Promise<void> {
    // Wie bei den anderen beiden: Klartext via tmux send-keys, das macht der
    // SessionManager.
    throw new Error('sendPrompt should be called via SessionManager.sendKeys')
  }

  /**
   * `opencode models` listet, was **angemeldet** ist.
   *
   * Ohne angemeldeten Anbieter kommen nur die freien `opencode/*` zurueck —
   * gemessen: acht. Das ist kein Mangel der Abfrage, sondern die Wahrheit ueber
   * diese Installation: mehr ist dort gerade nicht benutzbar.
   *
   * Scheitert der Aufruf, kommt eine leere Liste. Siehe CodexAdapter.
   */
  async listModels(): Promise<AdapterModel[]> {
    try {
      const out = await runCommand('opencode', ['models'], { timeout: 25_000 })
      return parseOpenCodeModels(out)
    } catch {
      return []
    }
  }

  buildWorkshopPromptFragment(lang: 'de' | 'en'): string {
    if (lang === 'de') {
      return `### Worker-Session-Startup (opencode)

Starte Worker mit: \`opencode --auto\` — **im Projektverzeichnis**, ohne Pfadargument.
Ein positionales Verzeichnis zieht opencode aus dem Verzeichnis heraus, in dem
seine Konfiguration liegt; dann fehlen MCP-Werkzeuge, ohne jede Meldung.
Niemals \`--pure\` — das laedt die Session ohne Plugins, also ohne Rollengrenze.
Projektanweisungen liest opencode aus \`AGENTS.md\`; \`CLAUDE.md\` nur zusaetzlich.
Instruktionen DIREKT via tmux send-keys in den Pane schicken — nicht via mux_send.
`
    }
    return `### Worker Session Startup (opencode)

Start workers with: \`opencode --auto\` — **inside the project directory**, no path argument.
A positional directory moves opencode out of the directory holding its config;
MCP tools then go missing with no message at all.
Never \`--pure\` — it loads the session without plugins, so without role boundaries.
opencode reads project instructions from \`AGENTS.md\`; \`CLAUDE.md\` only in addition.
Send instructions DIRECTLY via tmux send-keys — not via mux_send.
`
  }

  buildLauncherPromptFragment(lang: 'de' | 'en'): string {
    if (lang === 'de') {
      return `opencode kennt kein \`/launch\`. Nenne das Vorhaben als Klartext-Prompt.
`
    }
    return `opencode has no \`/launch\` command. State the task as a plain prompt.
`
  }

  buildCyberFactoryPromptFragment(lang: 'de' | 'en'): string {
    if (lang === 'de') {
      return `### opencode-Besonderheiten

Projektanweisungen stehen in \`AGENTS.md\`. Eine direkte Instruktion schlaegt sie.
MCP-Server und Kopfzeilen stehen in \`opencode.json\` — die Datei wird gemischt,
nicht ersetzt; fremde Eintraege darin bleiben.
Rollengrenzen laufen hier ueber ein Plugin in \`.opencode/plugin/\`
(\`tool.execute.before\`), nicht ueber Hook-Dateien. Ein abgelehnter Aufruf
erscheint als Werkzeugfehler mit dem Grund im Text — er wurde nicht ausgefuehrt.
`
    }
    return `### opencode specifics

Project instructions live in \`AGENTS.md\`. A direct instruction overrides them.
MCP server and headers live in \`opencode.json\` — the file is merged, not
replaced; foreign entries survive.
Role boundaries run through a plugin in \`.opencode/plugin/\`
(\`tool.execute.before\`), not hook files. A refused call shows up as a tool
error carrying the reason — it was not executed.
`
  }
}
