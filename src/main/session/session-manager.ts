import { EventEmitter } from 'events'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { ulid } from 'ulidx'
import type { SessionInfo, StartSessionOpts, RecoveryResult, EntityId } from '../../shared/types'
import { MAX_SESSIONS } from '../../shared/constants'
import { BRAND } from '../../shared/brand'
import { TmuxManager } from '../tmux/tmux-manager'
import { generateAuditClaudeMd } from '../audit/audit-template'
import { generateVoiceRelayClaudeMd } from './voice-relay-template'
import { generateDebuggerClaudeMd } from '../debugger/debugger-template'
import {
  generateCompanionClaudeMd,
  deployCompanionStartup,
  deployCompanionGuides,
  deployCompanionRef,
  deployCompanionInfoPopup,
  generateRefinementClaudeMd,
  deployRefinementSkills,
  deployRefinementDirs,
  generateIdeationPartnerClaudeMd,
} from '../entity-content'
import { EntityRegistry } from './entity-registry'
import { SessionStore, toPersistedSession } from './session-store'
import { runCommand } from '../util/exec-util'
import { injectStatusLineHook } from '../monitoring/statusline-hook'
import { COMPANION_ENTITY_ID } from '../mcp/entity-header'
import { getEntityBoundary, buildBoundaryHookScript, buildBoundaryHookSettings } from './entity-boundaries'
import { resolveEntityRuntime, type EntityRuntimeConfig } from './entity-runtime'
import type { PersistedGridState } from './session-store'
import type { AgentAdapter } from '../agent/agent-adapter'
import type { AdapterRegistry } from '../agent/registry'
import { configStore } from '../config/config-store'
import { resolveEntityWorkspace } from '../workspace/workspace-utils'
import { getCachedGlobalRules } from '../config/global-rules'
import { extractCharacterBlock } from '../character/character-defaults'
import { resolvePersonaForPreset } from './persona-resolver'
import { ensureRunDir, resolveRunDir } from './entity-run-dir'
import { claudeMdExemptions } from './entity-claudemd-exemptions'
import { buildMcpServerConfig } from '../mcp/workspace-header'
import { buildBoundToken, BOUND_TOKEN_ENV_VAR } from '../mcp/bound-token'
import { findEntitySessions, entityStartKey } from './entity-session-lookup'
import type { Workspace } from '../../shared/persona-types'
import {
  resolveWorkspaceSections,
  buildFolderAutoLaunch,
  restoreAdapterId,
  formatWorkspacePrompt,
  newInstructionsFile,
  workspaceProjects,
} from './folder-session'

/** Role directories — a workspace cell pointing here is a role, not a project. */
const ENTITIES_ROOT = path.join(os.homedir(), '.config', 'cipher-mux', 'entities')
import type { WorkspaceSectionSource } from './folder-session'
import { generateLocalWorkshopPreset } from '../local-factory/workshop-preset'
import { generateLocalFactoryPreset, generateLocalWorkerPreset, LOCAL_WORKER_DISPATCH_TOOL } from '../local-factory/presets'
import type { PaneSnapshot } from '../../shared/terminal-resync'

/**
 * Generate the ## Voice Output section content based on ttsLevel.
 * Level 1: Minimal — summaries, milestones, direct answers only.
 * Level 2: Alles Relevante — full speech adaptation for accessibility.
 */
function getVoiceOutputSection(level: 1 | 2): string {
  if (level === 2) {
    return `Use \`mux_tts_speak\` for all relevant content — questions, explanations, results, decisions, summaries, milestones.

**Speech-Adaptation-Regeln:**

- Prosa statt Bullet-Listen. Kein Markdown gesprochen.
- Aufzaehlungen als Fliesstext: "Erstens... Zweitens... Drittens..."
- Max 4-5 Saetze pro Turn, dann Pause oder Rueckfrage.
- Vor Tool-Calls: kurze Ankuendigung was du gleich tust.
- Aufzaehlungen mit mehr als 5 Punkten: frage ob vorlesen oder lieber anschauen.
- Dateinamen und Pfade umschreiben: "im Session-Manager" statt "src/main/session/session-manager.ts".
- Komplexe Inhalte (grosse Listen, Tabellen) als Note ablegen, Kernpunkte vorlesen anbieten.
- **Nie per TTS:** Code-Bloecke, rohe IDs, Stack-Traces, technische Details — die gehoeren in den schriftlichen Output.`
  }

  return `Use \`mux_tts_speak\` for key statements only: summaries, milestones, phase gates, direct answers. Keep sentences short and clear.

- Primary channel is written text. TTS is supplementary.
- **Nie per TTS:** Code, Pfade, IDs, technische Details — gehoeren in schriftlichen Output.`
}

/**
 * Sanitize a name for use as tmux session suffix.
 * Lowercase, special chars → dash, max 32 chars, no leading/trailing dashes.
 */
function sanitizeTmuxName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32)
    || 'session'
}

/** MCP tool permission prefix. */
const MCP_PREFIX = 'mcp__cipher-mux__'

/**
 * Return pre-approved MCP tool permissions for a given entity.
 * All entities get the full base set; workshop/cyber-factory also get tmux + kickoff.
 */
/** Base permissions every entity gets. */
const BASE_PERMISSIONS = [
  `${MCP_PREFIX}mux_sessions`,
  `${MCP_PREFIX}mux_status`,
  `${MCP_PREFIX}mux_read`,
  `${MCP_PREFIX}mux_send`,
  `${MCP_PREFIX}mux_context_usage`,
  `${MCP_PREFIX}mux_create_session`,
  `${MCP_PREFIX}mux_kill_session`,
  `${MCP_PREFIX}mux_task_create`,
  `${MCP_PREFIX}mux_task_update`,
  `${MCP_PREFIX}mux_task_list`,
  `${MCP_PREFIX}mux_task_get`,
  `${MCP_PREFIX}mux_notes_create`,
  `${MCP_PREFIX}mux_notes_list`,
  `${MCP_PREFIX}mux_notes_search`,
  `${MCP_PREFIX}mux_notes_read`,
  `${MCP_PREFIX}mux_notes_update`,
  `${MCP_PREFIX}mux_notes_delete`,
  `${MCP_PREFIX}mux_notes_open`,
  `${MCP_PREFIX}mux_readiness_stats`,
  `${MCP_PREFIX}mux_mirror_sync`,
  `${MCP_PREFIX}mux_notes_handoff_create`,
  `${MCP_PREFIX}mux_notes_handoff_search`,
  `${MCP_PREFIX}mux_notes_handoff_dispatch`,
  `${MCP_PREFIX}mux_bugreport_resolve`,
  `${MCP_PREFIX}mux_grid_resize`,
  `${MCP_PREFIX}mux_grid_place`,
  `${MCP_PREFIX}mux_session_focus`,
  `${MCP_PREFIX}mux_session_eject`,
  `${MCP_PREFIX}mux_sidebar_toggle`,
  `${MCP_PREFIX}mux_tts_speak`,
  `${MCP_PREFIX}mux_ui_open`,
  `${MCP_PREFIX}mux_ui_highlight`,
  `${MCP_PREFIX}mux_theme_set`,
]

/**
 * Companion memory tools. Only the Companion role gets them pre-approved,
 * because only that role gets them registered at all — the MCP server decides
 * that per connection from the X-Mux-Entity header (see entity-header.ts).
 *
 * Listing them for every entity, as this did, was misleading rather than
 * harmful: a permission for a tool that was never registered does nothing.
 */
const COMPANION_MEMORY_PERMISSIONS = [
  `${MCP_PREFIX}companion_memory_write`,
  `${MCP_PREFIX}companion_memory_recall`,
  `${MCP_PREFIX}companion_memory_search`,
  `${MCP_PREFIX}companion_memory_forget`,
]

function getMcpPermissionsForEntity(entityId: EntityId): string[] {
  // All entities get the full base set. Workshop/Cyber Factory also get tmux + kickoff.
  const perms = [...BASE_PERMISSIONS]
  switch (entityId) {
    case 'workshop':
    case 'cyber-factory':
    case 'launcher':
      perms.push(`${MCP_PREFIX}kickoff_complete`, 'Bash(tmux:*)')
      break
  }
  if (entityId === 'local-factory' || entityId === 'local-workshop') {
    perms.push(`${MCP_PREFIX}${LOCAL_WORKER_DISPATCH_TOOL}`)
  }
  if (entityId === COMPANION_ENTITY_ID) {
    perms.push(...COMPANION_MEMORY_PERMISSIONS)
  }
  return perms
}

/**
 * SessionManager — Registry for cipher-mux sessions.
 *
 * Manages session lifecycle (create, stop, recover) and enforces
 * the MAX_SESSIONS limit. Each session maps to a tmux session.
 */
export interface WorkshopConfig {
  mcpHost: string
  mcpPort: number
  mcpApiKey: string
}

export class SessionManager extends EventEmitter {
  private sessions: Map<string, SessionInfo> = new Map()
  private tmux: TmuxManager
  private adapterRegistry: AdapterRegistry
  private sessionAdapters: Map<string, AgentAdapter> = new Map()
  private workshopSessionId: string | null = null
  private cyberFactorySessionId: string | null = null
  private mcpConfig: WorkshopConfig | null = null
  /** Entity registry for functional entities. */
  private entityRegistry: EntityRegistry
  /** Maps entity IDs to their active session IDs (supports multi-instance). */
  private entitySessionIds: Map<EntityId, Set<string>> = new Map()
  /** Mutex: (entity, workspace) pairs currently being started — prevents double-start races. */
  private startingEntities: Set<string> = new Set()
  /**
   * Commands queued to be sent to a session once its terminal reports
   * the real (post-mount) size via markReady(). Prevents launching TUIs
   * like Claude at the default 80x24 before xterm has fitted.
   */
  private pendingLaunch: Map<string, { command: string; timer: NodeJS.Timeout }> = new Map()
  /** Sessions that had an autoLaunch command (Claude CLI). Plain terminal sessions are NOT in this set. */
  private autoLaunchedSessions: Set<string> = new Set()
  /** Persistent session store — survives app restarts. */
  private sessionStore: SessionStore

  constructor(tmux: TmuxManager, adapterRegistry: AdapterRegistry, entityRegistry?: EntityRegistry, _appRoot?: string) {
    super()
    this.tmux = tmux
    this.adapterRegistry = adapterRegistry
    this.entityRegistry = entityRegistry ?? new EntityRegistry()
    this.sessionStore = new SessionStore()
  }

  // ─── Entity Session Tracking Helpers ─────────────────────
  private addEntitySession(entityId: EntityId, sessionId: string): void {
    let set = this.entitySessionIds.get(entityId)
    if (!set) {
      set = new Set()
      this.entitySessionIds.set(entityId, set)
    }
    set.add(sessionId)
  }

  private removeEntitySession(entityId: EntityId, sessionId: string): void {
    const set = this.entitySessionIds.get(entityId)
    if (!set) return
    set.delete(sessionId)
    if (set.size === 0) this.entitySessionIds.delete(entityId)
  }

  private getFirstEntitySessionId(entityId: EntityId): string | undefined {
    const set = this.entitySessionIds.get(entityId)
    if (!set || set.size === 0) return undefined
    return set.values().next().value as string
  }

  private getAllEntitySessionIds(entityId: EntityId): string[] {
    const set = this.entitySessionIds.get(entityId)
    return set ? Array.from(set) : []
  }

  /** Get the session store for external grid-state persistence. */
  getSessionStore(): SessionStore {
    return this.sessionStore
  }

  /** Whether this session was auto-launched with Claude CLI (not a plain terminal). */
  isAutoLaunched(sessionId: string): boolean {
    return this.autoLaunchedSessions.has(sessionId)
  }

  /** Get the entity registry. */
  getEntityRegistry(): EntityRegistry {
    return this.entityRegistry
  }

  /**
   * Set MCP config for auto-injection into new sessions.
   * When set, every new session gets CIPHER_MUX_MCP_URL and CIPHER_MUX_MCP_KEY
   * as environment variables.
   */
  setMcpConfig(config: WorkshopConfig | null): void {
    this.mcpConfig = config
  }

  /**
   * Start a new session.
   */
  async start(opts: StartSessionOpts): Promise<SessionInfo> {
    if (this.sessions.size >= MAX_SESSIONS) {
      throw new Error(`Maximum sessions (${MAX_SESSIONS}) reached`)
    }

    const id = ulid()
    const shortId = id.slice(-4).toLowerCase()
    const tmuxName = opts.name
      ? `cmux-${sanitizeTmuxName(opts.name)}-${shortId}`
      : `cmux-${id.slice(-8).toLowerCase()}`
    const now = Date.now()

    // Inject CIPHER_MUX_SESSION_ID so the StatusLine hook writes to the
    // correct per-session file in /tmp/cipher-mux/context/.
    let env: Record<string, string> = {
      ...opts.env,
      CIPHER_MUX_SESSION_ID: id,
    }

    // Resolve adapter for this session.
    //
    // **Auf demselben Weg wie `queueEntityClaude`**, und das ist kein Detail:
    // dort wird das Startkommando mit dem Rollen-Adapter gebaut
    // (`resolveEntityRuntime` → `resolveAdapter`). Stünde hier `getDefault()`,
    // liefen die beiden auseinander, sobald eine Rolle einen anderen Adapter
    // traegt als der globale Default — die Session wuerde `codex` starten und
    // danach eine `.claude/settings.local.json` samt `claude mcp add-json`
    // bekommen. Mit nur einem Adapter war das latent; mit zwei ist es ein Fehler.
    // Eine ausdrueckliche Wahl (Ordner-Start, Fork) schlaegt die Rolle.
    const adapter = opts.adapterId
      ? this.resolveAdapter(opts.adapterId)
      : this.adapterForEntity(opts.entityId ?? null)

    // Merge MCP env vars if config is set
    if (this.mcpConfig) {
      const mcpUrl = `http://${this.mcpConfig.mcpHost}:${this.mcpConfig.mcpPort}`
      env = {
        ...env,
        CIPHER_MUX_MCP_URL: mcpUrl,
        CIPHER_MUX_MCP_KEY: this.mcpConfig.mcpApiKey,
        // Derselbe Schluessel, aber mit Workspace und Rolle darin — fuer CLIs,
        // die dem MCP-Server keine freien Header mitgeben koennen (Codex).
        // Ohne Bindung ist das Token Zeichen fuer Zeichen der blanke Schluessel.
        // Siehe mcp/bound-token.ts.
        [BOUND_TOKEN_ENV_VAR]: buildBoundToken(
          this.mcpConfig.mcpApiKey,
          opts.workspaceId ?? null,
          opts.entityId ?? null,
        ),
      }

      // Inject MCP config via adapter (handles CLI + direct settings.json)
      if (opts.projectPath && adapter.supports('mcp-injection') && adapter.postLaunchInjection) {
        const mcpFullUrl = `http://${this.mcpConfig.mcpHost}:${this.mcpConfig.mcpPort}/mcp`
        try {
          await adapter.postLaunchInjection({
            projectPath: opts.projectPath,
            mcpUrl: mcpFullUrl,
            mcpApiKey: this.mcpConfig.mcpApiKey,
            sessionId: id,
            workspaceId: opts.workspaceId ?? null,
            entityId: opts.entityId ?? null,
          })
        } catch (err) {
          console.warn('[SessionManager] Adapter MCP injection failed:', err)
        }
      }
    }

    // Inject status hook via adapter
    if (opts.projectPath && adapter.supports('status-line') && adapter.attachStatusHook) {
      try {
        await adapter.attachStatusHook(opts.projectPath)
      } catch (err) {
        console.warn('[SessionManager] Adapter statusline hook injection failed:', err)
      }
    }

    // Inject workspace prompt + context directories into project CLAUDE.md.
    // Entity sessions handle this in assembleEntityClaudeMd (no regex — pure append).
    //
    // Abgleichen, nicht nur hinzufuegen: eine Session, die ausdruecklich ohne
    // Workspace startet, entfernt die Sektionen. Bis 0.12.0 blieb dort stehen,
    // was der letzte Workspace-Start geschrieben hatte. Wer `workspaceId` gar
    // nicht setzt (Shell aus dem Zellenkopf), laesst die Datei weiter in Ruhe.
    // Die Datei, die die CLI wirklich liest. Nur fuer einen Ordner-Start mit
    // CLI — eine Shell aus dem Zellenkopf startet nichts, das eine neu angelegte
    // AGENTS.md lesen wuerde, und bleibt bei der CLAUDE.md wie bisher.
    let instructionsFile = 'CLAUDE.md'
    if (opts.projectPath && !opts._entityInjected && opts.folderLaunch && !opts.folderLaunch.shellOnly) {
      try {
        instructionsFile = this.prepareInstructionsFile(opts.projectPath, adapter)
      } catch (err) {
        console.warn('[SessionManager] Instructions file preparation failed:', err)
      }
    }

    if (opts.projectPath && !opts._entityInjected) {
      try {
        const sections = resolveWorkspaceSections(
          { workspaceId: opts.workspaceId, workspacePrompt: opts.workspacePrompt, contextPaths: opts.contextPaths },
          configStore.get('workspaces') as WorkspaceSectionSource[] | undefined,
          ENTITIES_ROOT,
        )
        if (sections.reconcile) {
          this.injectWorkspaceSections(
            opts.projectPath,
            formatWorkspacePrompt(sections),
            sections.contextPaths,
            instructionsFile,
          )
        }
      } catch (err) {
        console.warn('[SessionManager] Workspace section injection failed:', err)
      }
    }

    // REQ-GLOBAL-002: Inject global rules into manual (non-entity) sessions.
    // Entity sessions are handled in startEntity() before this point.
    if (opts.projectPath && !opts._entityInjected) {
      try { this.injectGlobalRulesSection(opts.projectPath, instructionsFile) } catch (e) {
        console.warn('[SessionManager] Failed to inject global rules:', e)
      }
    }

    // Create tmux session (empty projectPath → home dir)
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- synchrones Lazy-Load, CommonJS-Ziel
    const cwd = opts.projectPath || require('os').homedir()
    const tmuxSession = await this.tmux.createSession(tmuxName, {
      cwd,
      command: opts.command,
      env,
    })

    const session: SessionInfo = {
      id,
      name: opts.name,
      projectPath: opts.projectPath,
      tmuxSession: tmuxName,
      tmuxPane: tmuxSession,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      adapterId: adapter.id,
      capabilities: adapter.getCapabilities(),
      workspaceId: opts.workspaceId ?? null,
    }

    this.sessions.set(id, session)
    this.sessionAdapters.set(id, adapter)

    // Persist to disk
    this.persistSession(session)

    // Start output watcher — emits terminal data with session ULID as ID
    this.tmux.watchSession(tmuxName, id)

    // Ordner-Start: die Zeile baut derselbe Adapter, der oben injiziert hat.
    const autoLaunch = opts.autoLaunch ?? (opts.folderLaunch
      ? buildFolderAutoLaunch(opts.projectPath || os.homedir(), opts.folderLaunch.shellOnly
        ? null
        : adapter.buildLaunchCommand({
          projectPath: opts.projectPath || os.homedir(),
          sessionName: opts.name,
          resume: opts.folderLaunch.resume,
          forkLatest: opts.folderLaunch.forkLatest,
          skipPermissions: opts.folderLaunch.skipPermissions,
          model: opts.model,
        }))
      : undefined)

    // Queue auto-launch (e.g. `claude --...`) to fire once the renderer
    // reports the real terminal size, so TUIs start at the correct dims.
    if (autoLaunch) {
      this.autoLaunchedSessions.add(id)
      this.setPendingLaunch(id, autoLaunch)
    } else if (opts.forkFromClaudeSessionId) {
      // Build auto-launch with fork flag via adapter
      this.autoLaunchedSessions.add(id)
      const launchCmd = adapter.buildLaunchCommand({
        projectPath: opts.projectPath || os.homedir(),
        sessionName: opts.name,
        forkFromClaudeSessionId: opts.forkFromClaudeSessionId,
        model: opts.model,
      })
      const cmdStr = [launchCmd.cmd, ...launchCmd.args].join(' ')
      this.setPendingLaunch(id, `clear; ${cmdStr}\n`)
    }

    this.emit('session-changed', session)
    return session
  }

  /**
   * Graceful stop: immediately removes the session from the grid (cell becomes
   * free), then sends a shutdown prompt to the tmux session in the background.
   * The session has up to timeoutMs to clean up before a hard kill.
   */
  async gracefulStop(sessionId: string, timeoutMs = 30_000): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }

    // 1. Immediately free the cell — stop watching, remove from grid + state
    this.tmux.unwatchSession(session.tmuxSession)
    const tmuxName = session.tmuxSession
    session.status = 'stopped'
    session.updatedAt = Date.now()
    this.emit('session-stopped', session)
    this.sessions.delete(sessionId)
    this.sessionAdapters.delete(sessionId)
    this.autoLaunchedSessions.delete(sessionId)
    if (session.entityId) {
      const entityId = session.entityId as EntityId
      this.removeEntitySession(entityId, sessionId)
      this.entityRegistry.unlinkSession(sessionId)
      if (entityId === 'workshop') this.workshopSessionId = null
      if (entityId === 'cyber-factory') this.cyberFactorySessionId = null
    }
    this.sessionStore.removeSession(sessionId)
    this._cleanupGridSlot(sessionId)

    // 2. Send shutdown prompt and wait in background — fire-and-forget
    const hadInteraction = (session.interactionCount ?? 0) > 0
    this._backgroundGracefulKill(tmuxName, timeoutMs, hadInteraction).catch((err) => {
      console.error(`[SessionManager] Background graceful kill error:`, (err as Error).message)
    })
  }

  /** Background: send shutdown prompt, poll, then hard-kill on timeout. */
  private async _backgroundGracefulKill(tmuxName: string, timeoutMs: number, hadInteraction: boolean): Promise<void> {
    if (!hadInteraction) {
      console.log(`[SessionManager] Empty session "${tmuxName}", skipping graceful prompt`)
      try { await this.tmux.killSession(tmuxName) } catch { /* already gone */ }
      return
    }

    const shutdownPrompt = [
      'Deine Session wird beendet. Bevor du gehst:',
      '1. Gibt es ungespeicherte Ergebnisse? → Als Note anlegen oder ins Memory schreiben',
      '2. Gibt es offene Findings? → Dokumentieren',
      '3. Gibt es laufende Aufgaben? → Status melden',
      'Wenn alles erledigt ist, beende dich mit /exit.',
    ].join('\n')

    try {
      await this.tmux.sendKeys(tmuxName, shutdownPrompt + '\r')
    } catch {
      // Can't send keys — just kill it
      console.warn(`[SessionManager] Could not send graceful prompt to tmux "${tmuxName}", hard-killing`)
      try { await this.tmux.killSession(tmuxName) } catch { /* already gone */ }
      return
    }

    // Poll until tmux session disappears or timeout
    const pollInterval = 2_000
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollInterval))
      try {
        await runCommand('tmux', ['has-session', '-t', tmuxName])
        // Still alive, keep waiting
      } catch {
        // Session exited gracefully
        console.log(`[SessionManager] tmux "${tmuxName}" exited gracefully`)
        return
      }
    }

    // Timeout — hard kill
    console.warn(`[SessionManager] Graceful shutdown timed out for tmux "${tmuxName}", hard-killing`)
    try { await this.tmux.killSession(tmuxName) } catch { /* already gone */ }
  }

  /** Clean up grid slots referencing a session. */
  private _cleanupGridSlot(sessionId: string): void {
    const gridState = this.sessionStore.getGridState()
    if (gridState) {
      let dirty = false
      for (const slot of gridState.slots) {
        if (slot.sessionId === sessionId) {
          slot.sessionId = null
          dirty = true
        }
      }
      if (dirty) {
        this.sessionStore.saveGridState(gridState)
      }
    }
  }

  /**
   * Stop a session and kill its tmux session.
   */
  async stop(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }

    // Stop output watcher before killing session
    this.tmux.unwatchSession(session.tmuxSession)

    // Kill tmux session — retry once if first attempt fails (e.g. control-mode lag)
    const tmuxName = session.tmuxSession
    try {
      await this.tmux.killSession(tmuxName)
    } catch {
      // Retry after short delay
      try {
        await new Promise((r) => setTimeout(r, 200))
        await this.tmux.killSession(tmuxName)
      } catch {
        console.warn(`[SessionManager] tmux kill-session failed for "${tmuxName}", session may linger as orphan`)
      }
    }

    session.status = 'stopped'
    session.updatedAt = Date.now()
    this.emit('session-stopped', session)
    this.sessions.delete(sessionId)
    this.sessionAdapters.delete(sessionId)
    this.autoLaunchedSessions.delete(sessionId)

    // Clean up entity links if this was an entity session
    if (session.entityId) {
      const entityId = session.entityId as EntityId
      this.removeEntitySession(entityId, sessionId)
      this.entityRegistry.unlinkSession(sessionId)
      if (entityId === 'workshop') this.workshopSessionId = null
      if (entityId === 'cyber-factory') this.cyberFactorySessionId = null
    }

    // Remove from persistent store — must happen AFTER in-memory cleanup
    // so that any concurrent persistGridState() call (debounced from renderer)
    // will also filter this session out via the this.sessions.has() check.
    this.sessionStore.removeSession(sessionId)
    this._cleanupGridSlot(sessionId)
  }

  /**
   * Recover sessions by cross-referencing sessions.json with live tmux sessions.
   *
   * Flow:
   * 1. Load sessions.json → for each entry, check if tmux session is still alive
   *    - alive → recovered (entity links restored from file)
   *    - gone  → cleaned up (removed from store)
   * 2. Scan tmux for cmux-* sessions NOT in sessions.json → orphaned
   * 3. Auto-kill launcher/kickoff orphans
   * 4. If no sessions.json: fall back to tmux-only enumeration with entityNameMap
   */
  async recover(): Promise<RecoveryResult> {
    // Retry up to 3 times with a short delay — tmux may still be
    // initialising right after the control-mode attach.
    let tmuxSessions = await this.tmux.listSessions()
    if (tmuxSessions.length <= 1) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        console.log(`[SessionManager] recover: only ${tmuxSessions.length} sessions found, retry ${attempt}/2 in 500ms`)
        await new Promise((r) => setTimeout(r, 500))
        tmuxSessions = await this.tmux.listSessions()
        if (tmuxSessions.length > 1) break
      }
    }

    const recovered: SessionInfo[] = []
    const orphaned: SessionInfo[] = []
    const killed: SessionInfo[] = []

    console.log(`[SessionManager] recover: ${tmuxSessions.length} tmux sessions found`)

    // Build a set of live tmux session names for quick lookup
    const liveTmuxNames = new Set(tmuxSessions.map(s => s.name))
    // Track which tmux sessions are claimed by sessions.json
    const claimedTmuxNames = new Set<string>()

    // ── Step 1: Try sessions.json-based recovery ──
    const hasStore = this.sessionStore.load()

    if (hasStore) {
      const persisted = this.sessionStore.getSessions()
      console.log(`[SessionManager] recover: sessions.json has ${persisted.length} entries`)

      for (const ps of persisted) {
        if (liveTmuxNames.has(ps.tmuxSession)) {
          // tmux session still alive → recover
          const session: SessionInfo = {
            id: ps.id,
            name: ps.name,
            projectPath: ps.projectPath,
            tmuxSession: ps.tmuxSession,
            tmuxPane: null,
            status: 'active',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            entityId: ps.entityId ?? undefined,
            workspaceId: ps.workspaceId ?? null,
            // Defensive: absent in stores written before this field existed.
            ...(ps.claudeSessionId ? { claudeSessionId: ps.claudeSessionId } : {}),
          }
          // Defensiv: eine unbekannte oder fehlende CLI ist kein Fehler, sondern
          // „Rolle bzw. Default entscheidet" — ein Wurf hier kostete den Restore.
          const restoredAdapterId = restoreAdapterId(ps, (aid) => !!this.adapterRegistry.get(aid))
          if (restoredAdapterId) {
            session.adapterId = restoredAdapterId
            this.sessionAdapters.set(session.id, this.adapterRegistry.get(restoredAdapterId)!)
          }
          this.sessions.set(session.id, session)
          this.tmux.watchSession(ps.tmuxSession, session.id)
          recovered.push(session)
          claimedTmuxNames.add(ps.tmuxSession)

          // Restore entity links
          if (ps.entityId) {
            this.addEntitySession(ps.entityId, session.id)
            this.entityRegistry.linkSession(session.id, ps.entityId)
            if (ps.entityId === 'workshop') this.workshopSessionId = session.id
            if (ps.entityId === 'cyber-factory') this.cyberFactorySessionId = session.id
          }
        } else {
          // tmux session gone → clean up from store
          console.log(`[SessionManager] recover: tmux session "${ps.tmuxSession}" gone, removing from store`)
          this.sessionStore.removeSession(ps.id)
        }
      }
    }

    // ── Step 2: Find orphaned tmux sessions (not in sessions.json) ──
    for (const tmuxSession of tmuxSessions) {
      if (!tmuxSession.name) continue // skip entries with missing/undefined name
      if (tmuxSession.name === 'cipher-mux-control') continue
      if (!tmuxSession.name.startsWith('cmux-')) continue
      if (claimedTmuxNames.has(tmuxSession.name)) continue

      // Also check in-memory registry (sessions already known this run)
      let alreadyKnown = false
      for (const session of this.sessions.values()) {
        if (session.tmuxSession === tmuxSession.name) {
          alreadyKnown = true
          break
        }
      }
      if (alreadyKnown) continue

      const lowerName = tmuxSession.name.toLowerCase()
      const isLauncher = lowerName.includes('launcher') || lowerName.includes('kickoff')
      const projectPath = tmuxSession.paneCwd || null

      const sessionInfo: SessionInfo = {
        id: ulid(),
        name: tmuxSession.name,
        projectPath,
        tmuxSession: tmuxSession.name,
        tmuxPane: null,
        status: 'orphaned',
        createdAt: tmuxSession.created * 1000,
        updatedAt: Date.now(),
      }

      if (isLauncher) {
        console.log(`[SessionManager] auto-killing launcher/kickoff session: ${tmuxSession.name}`)
        try { await this.tmux.killSession(tmuxSession.name) } catch { /* ok */ }
        killed.push(sessionInfo)
      } else {
        console.log(`[SessionManager] orphaned session: ${tmuxSession.name} (cwd: ${projectPath ?? 'unknown'})`)
        orphaned.push(sessionInfo)
      }
    }

    // ── Step 3: Fallback entity name matching for sessions recovered without store ──
    if (!hasStore) {
      const entityNameMap: Record<string, EntityId> = {
        'Workshop': 'workshop',
        'Orchestrator': 'workshop',
        'Cyber Factory': 'cyber-factory',
        'Coding Companion': 'companion',
        'Refinement': 'refinement',
        'Voice': 'voice-relay',
      }
      for (const session of recovered) {
        const entityId = entityNameMap[session.name]
        if (entityId) {
          session.entityId = entityId
          this.addEntitySession(entityId, session.id)
          this.entityRegistry.linkSession(session.id, entityId)
          if (entityId === 'workshop') this.workshopSessionId = session.id
          if (entityId === 'cyber-factory') this.cyberFactorySessionId = session.id
        }
      }
    }

    console.log(`[SessionManager] recover result: ${recovered.length} recovered, ${orphaned.length} orphaned, ${killed.length} killed`)
    return { recovered, orphaned, killed, gridState: hasStore ? this.sessionStore.getGridState() : null }
  }

  /**
   * Adopt an orphaned tmux session into the session registry.
   */
  async adoptOrphan(tmuxSessionName: string, displayName?: string): Promise<SessionInfo> {
    const id = ulid()
    const now = Date.now()
    const session: SessionInfo = {
      id,
      name: displayName ?? tmuxSessionName,
      projectPath: null,
      tmuxSession: tmuxSessionName,
      tmuxPane: tmuxSessionName,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }
    this.sessions.set(id, session)
    this.tmux.watchSession(tmuxSessionName, id)
    console.log(`[SessionManager] adopted orphan "${tmuxSessionName}" as session ${id}`)
    this.emit('session-changed', session)
    return session
  }

  /**
   * Kill an orphaned tmux session (no registry entry).
   */
  async killOrphan(tmuxSessionName: string): Promise<void> {
    try { await this.tmux.killSession(tmuxSessionName) } catch { /* may be gone */ }
  }

  /**
   * Get all sessions.
   */
  list(): SessionInfo[] {
    return Array.from(this.sessions.values())
  }

  /**
   * Get a single session by ID.
   */
  get(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId)
  }

  /**
   * Get count of active sessions.
   */
  activeCount(): number {
    let count = 0
    for (const s of this.sessions.values()) {
      if (s.status === 'active') count++
    }
    return count
  }

  /**
   * Send keys to a session's tmux pane.
   */
  async sendKeys(sessionId: string, keys: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)
    session.interactionCount = (session.interactionCount ?? 0) + 1
    const target = session.tmuxPane ?? session.tmuxSession
    await this.tmux.sendKeys(target, keys)
  }

  /**
   * Send a named key (Escape, Enter, C-c ...) rather than literal text.
   * sendKeys types its argument character by character — 'Escape' there ends
   * up as the word, not the key.
   */
  async sendKey(sessionId: string, keyName: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)
    const target = session.tmuxPane ?? session.tmuxSession
    await this.tmux.sendKey(target, keyName)
  }

  /**
   * Resize a session's tmux pane.
   */
  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)
    const target = session.tmuxPane ?? session.tmuxSession
    await this.tmux.resizePane(target, cols, rows)
  }

  /**
   * Queue a command to be sent once the renderer reports its real
   * terminal size via markReady(). Falls back to firing after 4s.
   */
  setPendingLaunch(sessionId: string, command: string): void {
    const existing = this.pendingLaunch.get(sessionId)
    if (existing) clearTimeout(existing.timer)
    const timer = setTimeout(() => {
      console.warn(`[SessionManager] pending launch fallback fired for ${sessionId}`)
      this.flushPendingLaunch(sessionId).catch((err) => {
        console.error('[SessionManager] pending launch flush error:', err)
      })
    }, 4000)
    this.pendingLaunch.set(sessionId, { command, timer })
  }

  /**
   * Called by the renderer after xterm has mounted and applied its first
   * real resize. Resizes the pane once more (defensive) and flushes any
   * pending launch command so the TUI starts at the right size.
   */
  async markReady(sessionId: string, cols: number, rows: number): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return
    // Apply the resize defensively — renderer already did it, but a second
    // pass ensures tmux state matches before we launch a TUI.
    const target = session.tmuxPane ?? session.tmuxSession
    try {
      await this.tmux.resizePane(target, cols, rows)
    } catch (err) {
      console.warn('[SessionManager] markReady resize failed:', err)
    }
    // Give tmux time to propagate the new size to the pane's process group
    // before spawning a TUI that reads size once at startup. 250ms is a
    // conservative upper bound — on slow machines 100ms was racy and claude
    // would start at 80x24, ending up with the input line in the wrong row.
    await new Promise((r) => setTimeout(r, 250))
    await this.flushPendingLaunch(sessionId)
  }

  private async flushPendingLaunch(sessionId: string): Promise<void> {
    const pending = this.pendingLaunch.get(sessionId)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pendingLaunch.delete(sessionId)
    try {
      await this.sendKeys(sessionId, pending.command)
    } catch (err) {
      console.warn('[SessionManager] sending pending launch failed:', err)
    }
  }

  /**
   * Capture content from a session's pane.
   */
  async capture(sessionId: string, lines?: number): Promise<string> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)
    const target = session.tmuxPane ?? session.tmuxSession
    return this.tmux.capturePane(target, lines)
  }

  /** Schnappschuss samt Cursor fuer den Neuaufbau im Renderer. */
  async snapshot(sessionId: string, lines?: number): Promise<PaneSnapshot> {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session ${sessionId} not found`)
    const target = session.tmuxPane ?? session.tmuxSession
    return this.tmux.snapshotPane(target, lines)
  }

  // ─── Adapter ──────────────────────────────────────────

  /**
   * Get the adapter associated with a session.
   */
  getAdapterForSession(sessionId: string): AgentAdapter | undefined {
    return this.sessionAdapters.get(sessionId)
  }

  /** Get the active character block (tone, style, rules) — NOT companion tasks. */
  private getActiveCharacterBlock(): string {
    try {
      const activeId = configStore.get('activeCharacterId')
      const characters = configStore.get('characters')
      const active = characters.find(c => c.id === activeId)
      if (!active) return ''
      return extractCharacterBlock(active)
    } catch {
      return ''
    }
  }

  /** Get the character block for a specific entity, using the persona resolver. */
  private getCharacterBlockForEntity(entityId: string): string {
    try {
      const overrides = configStore.get('entityPersonaOverrides') ?? {}
      const resolved = resolvePersonaForPreset(entityId, {
        getCharacters: () => configStore.get('characters'),
        getActiveCharacterId: () => configStore.get('activeCharacterId'),
        getGlobalActivePersonaId: () => configStore.get('globalActivePersonaId'),
      }, overrides[entityId] ?? null)
      return extractCharacterBlock(resolved)
    } catch {
      return this.getActiveCharacterBlock()
    }
  }

  /** Get the display name of the active character (e.g. "Relay", "Wayne"). */
  private getActiveCharacterName(): string {
    try {
      const activeId = configStore.get('activeCharacterId')
      const characters = configStore.get('characters')
      const active = characters.find(c => c.id === activeId)
      return active?.name ?? 'Relay'
    } catch {
      return 'Relay'
    }
  }

  /**
   * Inject or replace a ## Persona section in a CLAUDE.md string.
   * If a ## Persona section already exists, it is replaced.
   * Otherwise, the section is appended after the first heading.
   */
  private injectPersonaSection(claudeMd: string, characterBlock: string): string {
    if (!characterBlock) return claudeMd

    const personaSection = `\n\n## Persona\n\n**WICHTIG: Diese Persona ueberschreibt alle globalen Persona-Definitionen aus ~/.claude/CLAUDE.md.**\n\n${characterBlock}`

    // Replace existing persona section
    const personaRegex = /\n*## Persona\n[\s\S]*?(?=\n## |\n*$)/
    if (personaRegex.test(claudeMd)) {
      return claudeMd.replace(personaRegex, personaSection)
    }

    // Insert after the first heading line
    const firstHeadingEnd = claudeMd.indexOf('\n')
    if (firstHeadingEnd > 0) {
      return claudeMd.substring(0, firstHeadingEnd) + personaSection + claudeMd.substring(firstHeadingEnd)
    }

    return claudeMd + personaSection
  }

  /**
   * Inject, replace, or remove a named ## section in a CLAUDE.md string.
   * body === null removes the section entirely.
   */
  private injectSection(claudeMd: string, sectionName: string, body: string | null): string {
    const sectionRegex = new RegExp(`\\n*## ${sectionName}\\n[\\s\\S]*?(?=\\n## |\\n*$)`)

    if (body === null) {
      // Remove the section if it exists
      return claudeMd.replace(sectionRegex, '')
    }

    const sectionBlock = `\n\n## ${sectionName}\n\n${body}`

    if (sectionRegex.test(claudeMd)) {
      return claudeMd.replace(sectionRegex, sectionBlock)
    }

    // Append at end
    return claudeMd + sectionBlock
  }

  /**
   * The instructions file this session's CLI reads, created if the CLI needs
   * one that is missing (Codex: AGENTS.md, with a pointer to an existing
   * CLAUDE.md so opencode does not lose it). Returns the file name.
   */
  private prepareInstructionsFile(projectPath: string, adapter: AgentAdapter): string {
    const present = {
      agentsMd: fs.existsSync(path.join(projectPath, 'AGENTS.md')),
      claudeMd: fs.existsSync(path.join(projectPath, 'CLAUDE.md')),
    }
    const target = adapter.instructionsTarget?.(present) ?? { file: 'CLAUDE.md' as const }
    if (target.file === 'AGENTS.md' && !present.agentsMd && fs.existsSync(projectPath)) {
      fs.writeFileSync(path.join(projectPath, 'AGENTS.md'), newInstructionsFile(target), 'utf-8')
    }
    return target.file
  }

  /**
   * Inject global rules (Layer 1) into a project's CLAUDE.md.
   * REQ-GLOBAL-002: Content from ~/.config/cipher-mux/global-rules.md is injected
   * as ## Global Rules section before persona/entity content.
   */
  private injectGlobalRulesSection(projectPath: string, fileName = 'CLAUDE.md'): void {
    const globalRules = getCachedGlobalRules()
    if (!globalRules.trim()) return

    const claudeMdPath = path.join(projectPath, fileName)
    if (!fs.existsSync(claudeMdPath)) return

    const content = fs.readFileSync(claudeMdPath, 'utf-8')
    const updated = this.injectSection(content, 'Global Rules', globalRules.trim())
    fs.writeFileSync(claudeMdPath, updated, 'utf-8')
  }

  /**
   * Assemble a CLAUDE.md for an entity session from preset.md content.
   * Pure concatenation — no regex-replace. Used only for entity sessions.
   *
   * Assembly order:
   * 1. preset.md content (verbatim)
   * 2. ## Persona (inserted after first H1)
   * 3. ## Voice Output (injected based on ttsLevel, except voice-relay)
   * 4. ## Global Rules (appended at end)
   */
  private assembleEntityClaudeMd(
    presetContent: string,
    entityId: string,
    workspacePrompt?: string,
    contextPaths?: string[],
  ): string {
    let result = presetContent
    const skip = claudeMdExemptions(entityId)

    // Insert Persona after first H1 heading (not for local-worker, R16)
    const characterBlock = skip.persona ? '' : this.getCharacterBlockForEntity(entityId)
    if (characterBlock) {
      const personaSection = `\n\n## Persona\n\n**WICHTIG: Diese Persona ueberschreibt alle globalen Persona-Definitionen aus ~/.claude/CLAUDE.md.**\n\n${characterBlock}`
      const firstNewline = result.indexOf('\n')
      if (firstNewline > 0) {
        result = result.substring(0, firstNewline) + personaSection + result.substring(firstNewline)
      } else {
        result = result + personaSection
      }
    }

    // Inject Voice Output section (except voice-relay and bugreport which use TTS
    // as primary channel, and local-worker — see entity-claudemd-exemptions.ts)
    if (!skip.voiceOutput) {
      const voiceSection = getVoiceOutputSection(configStore.get('ttsLevel') ?? 1)
      result = result + `\n\n## Voice Output\n\n${voiceSection}`
    }

    // Append Global Rules at end (not for local-worker, R16)
    const globalRules = skip.globalRules ? '' : getCachedGlobalRules()
    if (globalRules.trim()) {
      result = result + `\n\n## Global Rules\n\n${globalRules.trim()}`
    }

    // Append Workspace Prompt (optional, from workspace apply)
    if (workspacePrompt && workspacePrompt.trim()) {
      result = result + `\n\n## Workspace Prompt\n\n${workspacePrompt.trim()}`
    }

    // Append Context Directories (optional, from workspace apply)
    if (contextPaths && contextPaths.length > 0) {
      const body = contextPaths.map((p) => `- \`${p}\``).join('\n')
      result = result + `\n\n## Context Directories\n\n${body}`
    }

    return result
  }

  /**
   * Inject workspace prompt and context directories into a project's CLAUDE.md.
   * Called during workspace apply for project-path cells.
   */
  injectWorkspaceSections(
    projectPath: string,
    workspacePrompt?: string,
    contextPaths?: string[],
    fileName = 'CLAUDE.md',
  ): void {
    const claudeMdPath = path.join(projectPath, fileName)
    let content = ''
    try {
      content = fs.readFileSync(claudeMdPath, 'utf-8')
    } catch {
      // CLAUDE.md doesn't exist yet — start fresh
    }

    // Inject or remove Workspace Prompt section
    if (workspacePrompt && workspacePrompt.trim()) {
      content = this.injectSection(content, 'Workspace Prompt', workspacePrompt.trim())
    } else {
      content = this.injectSection(content, 'Workspace Prompt', null)
    }

    // Inject or remove Context Directories section
    if (contextPaths && contextPaths.length > 0) {
      const body = contextPaths.map((p) => `- \`${p}\``).join('\n')
      content = this.injectSection(content, 'Context Directories', body)
    } else {
      content = this.injectSection(content, 'Context Directories', null)
    }

    fs.writeFileSync(claudeMdPath, content, 'utf-8')
  }

  // ─── Entity Framework ───────────────────────────────────

  /**
   * Start an entity session by ID. Deploys assets if needed, creates
   * the session, and tags it with the entity ID.
   */
  async startEntity(entityId: EntityId, opts?: Partial<StartSessionOpts>): Promise<SessionInfo> {
    const config = this.entityRegistry.get(entityId)
    if (!config) {
      throw new Error(`Unknown entity: ${entityId}`)
    }

    const targetWorkspace = resolveEntityWorkspace(
      opts?.workspaceId,
      (configStore.get('workspaces') ?? []) as Workspace[],
      (configStore.get('activeWorkspaceId') ?? null) as string | null,
    )
    const workspaceId = targetWorkspace?.id ?? null
    // The caller's projectPath (e.g. mux_entity_start override, or the CF
    // handoff's required project directory) no longer becomes the session's
    // cwd — the run dir always does. It survives as a Context Directories
    // entry instead (see the assembly block below and the start() call).
    const { projectPath: callerProjectPath, ...restOpts } = opts ?? {}
    // Authored artefacts (preset.md, skills, guides) stay in the entity dir.
    // Generated artefacts (CLAUDE.md, .mcp.json, settings) go to the run dir,
    // which is separate per workspace — that is what stops two instances in
    // different workspaces from overwriting each other's CLAUDE.md.
    const entityDir = config.projectPath
    // Path only — no disk access yet. The directory itself is needed right
    // below (preset.md / .mcp-connection.md / settings.local.json writes),
    // but the authored-asset symlinks must wait until AFTER the deploy*()
    // calls below have populated their targets (skills/, guides/, ...) —
    // otherwise ensureRunDir would silently skip every one of them on a
    // brand-new entity. See the ensureRunDir(...) call after the deploy block.
    const runDir = resolveRunDir(workspaceId, entityId)
    fs.mkdirSync(runDir, { recursive: true })

    // Mutex: prevent concurrent starts of the same entity in the same workspace
    const startKey = entityStartKey(entityId, workspaceId)
    if (this.startingEntities.has(startKey)) {
      throw new Error(`${config.displayName} is already starting`)
    }
    this.startingEntities.add(startKey)

    try {
    // Singleton check — singleInstance means "once per workspace", not app-wide.
    if (config.singleInstance) {
      const active = findEntitySessions(this.list(), entityId, workspaceId)
      if (active.length > 0) {
        throw new Error(`${config.displayName} is already running`)
      }
      // Drop stale links for this entity whose sessions are gone.
      for (const eid of this.getAllEntitySessionIds(entityId)) {
        if (!this.sessions.has(eid)) {
          this.removeEntitySession(entityId, eid)
          this.entityRegistry.unlinkSession(eid)
        }
      }
    }

    // Ensure entity directory exists
    fs.mkdirSync(config.projectPath, { recursive: true })

    // Write preset.md — source-of-truth for preset-owned content.
    // CLAUDE.md is generated at session start by assembling preset.md + injected layers.
    // Code-generated presets (voice-relay, audit) are always refreshed so
    // updates propagate on next session start. Workshop and Cyber Factory use
    // pre-authored preset.md in their entity directories (no code generation).
    // Only truly generic fallback preset.md is write-once (preserves manual edits).
    {
      const presetMdPath = path.join(config.projectPath, 'preset.md')
      if (config.id === 'audit') {
        fs.writeFileSync(presetMdPath, generateAuditClaudeMd(), 'utf-8')
      } else if (config.id === 'voice-relay') {
        fs.writeFileSync(presetMdPath, generateVoiceRelayClaudeMd(), 'utf-8')
      } else if (config.id === 'debugger') {
        // Write-once: preserve manual edits to the debugger's preset.md
        if (!fs.existsSync(presetMdPath)) {
          fs.writeFileSync(presetMdPath, generateDebuggerClaudeMd(), 'utf-8')
        }
      } else if (config.id === 'companion') {
        if (!fs.existsSync(presetMdPath)) {
          fs.writeFileSync(presetMdPath, generateCompanionClaudeMd(), 'utf-8')
        }
        deployCompanionGuides(config.projectPath)
        deployCompanionRef(config.projectPath)
        deployCompanionStartup(config.projectPath)
        deployCompanionInfoPopup(config.projectPath)
      } else if (config.id === 'refinement') {
        if (!fs.existsSync(presetMdPath)) {
          fs.writeFileSync(presetMdPath, generateRefinementClaudeMd(), 'utf-8')
        }
        deployRefinementSkills(config.projectPath)
        deployRefinementDirs(config.projectPath)
      } else if (config.id === 'ideation-partner') {
        if (!fs.existsSync(presetMdPath)) {
          fs.writeFileSync(presetMdPath, generateIdeationPartnerClaudeMd(), 'utf-8')
        }
      } else if (config.id === 'local-factory') {
        if (!fs.existsSync(presetMdPath)) {
          fs.writeFileSync(presetMdPath, generateLocalFactoryPreset(), 'utf-8')
        }
      } else if (config.id === 'local-workshop') {
        if (!fs.existsSync(presetMdPath)) {
          fs.writeFileSync(presetMdPath, generateLocalWorkshopPreset(), 'utf-8')
        }
      } else if (config.id === 'local-worker') {
        // Bei jedem Start neu: der Worker hat keine Handarbeit zu bewahren,
        // und ein veralteter Rollentext wäre still wirksam.
        fs.writeFileSync(presetMdPath, generateLocalWorkerPreset(), 'utf-8')
      } else if (!fs.existsSync(presetMdPath)) {
        // Generic fallback — only write once to preserve manual edits
        fs.writeFileSync(presetMdPath, `# ${config.displayName}\n\n${config.displayName} Persona — wird vom User konfiguriert.\n`, 'utf-8')
      }

      // Link authored assets into the run dir now that the deploy*() calls
      // above have populated their targets in the entity dir (on a brand-new
      // entity these targets do not exist before this point — ensureRunDir
      // silently skips names whose target is missing).
      ensureRunDir(workspaceId, entityId, entityDir, ['skills', 'guides', 'ref', 'brain', 'deliverables', '.claude/commands'])

      // Always update MCP connection file for entities that use MCP
      if (config.features.includes('mcp') && this.mcpConfig) {
        const mcpUrl = `http://${this.mcpConfig.mcpHost}:${this.mcpConfig.mcpPort}/mcp`
        fs.writeFileSync(
          path.join(runDir, '.mcp-connection.md'),
          `# MCP-Verbindung (auto-generiert, nicht editieren)\n\n- **URL:** ${mcpUrl}\n- **Auth:** Bearer ${this.mcpConfig.mcpApiKey}\n`,
          'utf-8',
        )
      }

      // Ensure MCP tool permissions for entities that use MCP.
      // Without pre-approved permissions, Claude Code blocks on tool approval
      // prompts — fatal for non-interactive sessions like voice-relay.
      if (config.features.includes('mcp') && this.mcpConfig) {
        const claudeDir = path.join(runDir, '.claude')
        const settingsPath = path.join(claudeDir, 'settings.local.json')
        fs.mkdirSync(claudeDir, { recursive: true })

        let settings: Record<string, unknown> = {}
        try {
          settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
        } catch { /* doesn't exist yet */ }

        // Always ensure full permissions via union-merge (new tools propagate automatically)
        const mcpPerms = getMcpPermissionsForEntity(config.id)
        if (mcpPerms.length > 0) {
          const existing = ((settings.permissions as any)?.allow as string[]) ?? []
          const union = [...new Set([...mcpPerms, ...existing])]
          settings.permissions = { ...((settings.permissions as any) ?? {}), allow: union }
          fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
        }
      }

      // Role boundary as a PreToolUse hook. Measured before choosing this
      // route: entity sessions run with --dangerously-skip-permissions, which
      // bypasses permissions.deny entirely, while a PreToolUse hook still
      // fires. A deny rule here would have looked enforced and done nothing.
      // See entity-boundaries.ts.
      try {
        const boundary = getEntityBoundary(config.id)
        const claudeDir = path.join(runDir, '.claude')
        const hookPath = path.join(claudeDir, 'role-boundary.js')
        const settingsPath = path.join(claudeDir, 'settings.local.json')
        fs.mkdirSync(claudeDir, { recursive: true })

        let settings: Record<string, unknown> = {}
        try {
          settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
        } catch { /* doesn't exist yet */ }

        if (boundary) {
          fs.writeFileSync(
            hookPath,
            buildBoundaryHookScript(boundary.denyPathPatterns, boundary.reason),
            { encoding: 'utf-8', mode: 0o755 },
          )
          settings.hooks = {
            ...((settings.hooks as Record<string, unknown>) ?? {}),
            ...buildBoundaryHookSettings(hookPath),
          }
          fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
        } else if ((settings.hooks as { PreToolUse?: unknown })?.PreToolUse) {
          // A role that lost its boundary must lose the hook too — otherwise a
          // stale generated script keeps enforcing a rule nobody declares.
          const hooks = { ...(settings.hooks as Record<string, unknown>) }
          delete hooks.PreToolUse
          settings.hooks = hooks
          if (Object.keys(hooks).length === 0) delete settings.hooks
          fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
          try { fs.unlinkSync(hookPath) } catch { /* already gone */ }
        }
      } catch (err) {
        console.warn(`[SessionManager] role boundary for ${config.id} failed:`, err)
      }

      // Status-line hook into the RUN dir — the session's actual cwd, which is
      // where Claude Code reads settings from. It was only ever written to the
      // authored entity dir, so for entity sessions the hook never fired: no
      // report in statusLineDir, so no claude-session-id event, so
      // claudeSessionId stayed null, so a Keep Working restore had no
      // conversation to name and fell back to the interactive picker — where an
      // unattended session then sat instead of reaching a prompt.
      // Merges into the settings written above rather than replacing them.
      try {
        injectStatusLineHook(runDir)
      } catch (err) {
        console.warn(`[SessionManager] status-line hook for ${config.id} failed:`, err)
      }
    }

    // Write .mcp.json for MCP auto-discovery (if entity uses MCP)
    if (config.features.includes('mcp') && this.mcpConfig) {
      const mcpUrl = `http://${this.mcpConfig.mcpHost}:${this.mcpConfig.mcpPort}/mcp`
      const mcpJsonPath = path.join(runDir, '.mcp.json')
      const mcpJson = {
        mcpServers: {
          // config.id rides along as X-Mux-Entity: the MCP server has no other
          // way to know which role is calling, and that decides which tools
          // it registers for the connection.
          'cipher-mux': buildMcpServerConfig(mcpUrl, this.mcpConfig.mcpApiKey, workspaceId, config.id),
        },
      }
      fs.writeFileSync(mcpJsonPath, JSON.stringify(mcpJson, null, 2), 'utf-8')
    }

    // ─── Assembly: preset.md + Persona + Global Rules → CLAUDE.md ──────
    // Read preset.md as source-of-truth, assemble with injected layers,
    // write result as CLAUDE.md. No regex-replace — pure concatenation.
    {
      // Source of truth stays in the entity dir; the assembled result lands in
      // the run dir, which is the session's cwd.
      const presetMdPath = path.join(config.projectPath, 'preset.md')
      const legacyClaudeMdPath = path.join(config.projectPath, 'CLAUDE.md')
      const claudeMdPath = path.join(runDir, 'CLAUDE.md')

      // Read preset.md; fallback to existing CLAUDE.md if preset.md missing
      let presetContent: string | null = null
      if (fs.existsSync(presetMdPath)) {
        presetContent = fs.readFileSync(presetMdPath, 'utf-8')
      } else if (fs.existsSync(legacyClaudeMdPath)) {
        presetContent = fs.readFileSync(legacyClaudeMdPath, 'utf-8')
      }

      if (presetContent !== null) {
        // Explicit opts win; otherwise the workspace this session is bound to
        // (already resolved above — no second lookup, no getActiveWorkspace()).
        let wsPrompt = opts?.workspacePrompt
        let wsPaths = opts?.contextPaths
        if (!wsPrompt && !wsPaths && targetWorkspace) {
          if (targetWorkspace.workspacePrompt?.trim()) wsPrompt = targetWorkspace.workspacePrompt.trim()
          if (targetWorkspace.contextPaths?.length) wsPaths = targetWorkspace.contextPaths
        }
        // The caller's projectPath is no longer the session cwd — it still
        // needs to reach the entity, so it goes into Context Directories.
        // Unconditional: independent of the workspace-fallback branch above.
        if (callerProjectPath) {
          wsPaths = [...(wsPaths ?? []), callerProjectPath].filter((v, i, a) => a.indexOf(v) === i)
        }
        // Auch eine Rolle soll wissen, in welchem Workspace sie laeuft und was
        // dazugehoert — dieselbe Sektion wie bei Ordner-Sessions.
        if (targetWorkspace) {
          wsPrompt = formatWorkspacePrompt({
            workspaceId: targetWorkspace.id,
            workspaceName: targetWorkspace.name?.trim() || undefined,
            workspaceProjects: workspaceProjects(targetWorkspace, ENTITIES_ROOT),
            contextPaths: wsPaths,
            workspacePrompt: wsPrompt,
          })
        }
        const assembled = this.assembleEntityClaudeMd(
          presetContent,
          entityId,
          wsPrompt,
          wsPaths,
        )
        fs.writeFileSync(claudeMdPath, assembled, 'utf-8')
      }
    }

    // For multi-instance entities, append instance number to display name
    let displayName = config.displayName
    if (!config.singleInstance) {
      const existingCount = this.getAllEntitySessionIds(entityId).length
      if (existingCount > 0) {
        displayName = `${config.displayName} #${existingCount + 1}`
      }
    }

    // Start session
    const session = await this.start({
      name: displayName,
      ...restOpts,
      projectPath: runDir,
      workspaceId,
      entityId,
      _entityInjected: true,
    })

    // Inject session ID into CLAUDE.md so the entity can pass it to mux_tts_speak (focus gate)
    // Voice-relay and bugreport use TTS as primary channel and are exempt from focus gate.
    if (entityId !== 'voice-relay' && entityId !== 'bugreport') {
      try {
        const claudeMdPath = path.join(runDir, 'CLAUDE.md')
        if (fs.existsSync(claudeMdPath)) {
          const content = fs.readFileSync(claudeMdPath, 'utf-8')
          const section = `Your cipher-mux session ID is \`${session.id}\`. Pass this as \`sessionId\` parameter in every \`mux_tts_speak\` call.`
          const updated = this.injectSection(content, 'Session Identity', section)
          fs.writeFileSync(claudeMdPath, updated, 'utf-8')
        }
      } catch (err) {
        console.warn('[SessionManager] Session identity injection failed:', err)
      }
    }

    // Tag session with entity
    session.entityId = entityId
    this.addEntitySession(entityId, session.id)
    this.entityRegistry.linkSession(session.id, entityId)

    // Backward compat: update workshop/cyber-factory session ID refs
    if (entityId === 'workshop') this.workshopSessionId = session.id
    if (entityId === 'cyber-factory') this.cyberFactorySessionId = session.id

    // Re-persist with entity ID and notify renderer so entityStatus updates
    this.persistSession(session)
    this.emit('session-changed', session)

    this.emit('entity-started', { entityId, session })
    return session
    } finally {
      this.startingEntities.delete(startKey)
    }
  }

  /**
   * Queue Claude Code launch for an entity session.
   * For multi-instance entities, targets the most recently added session.
   * Use queueEntityClaudeForSession() to target a specific session.
   */
  queueEntityClaude(entityId: EntityId, targetSessionId?: string): void {
    const sessionId = targetSessionId ?? this.getFirstEntitySessionId(entityId)
    if (!sessionId) {
      throw new Error(`${entityId} is not running`)
    }
    const config = this.entityRegistry.get(entityId)
    if (!config) return

    // Role -> model / adapter. Absent values keep the previous behaviour
    // exactly: registry default adapter, no --model, CLI decides.
    const runtime = resolveEntityRuntime(config, configStore.get('app') as EntityRuntimeConfig)
    const adapter = this.resolveAdapter(runtime.adapterId)
    const launchCmd = adapter.buildLaunchCommand({
      projectPath: config.projectPath,
      sessionName: config.displayName,
      isWorkshop: entityId === 'workshop',
      isCyberFactory: entityId === 'cyber-factory',
      entityId,
      workDir: this.sessions.get(sessionId)?.projectPath ?? undefined,
      ...(runtime.model ? { model: runtime.model } : {}),
    })
    const cmdStr = [launchCmd.cmd, ...launchCmd.args].join(' ')
    this.autoLaunchedSessions.add(sessionId)
    this.setPendingLaunch(sessionId, `clear; ${cmdStr}\n`)
  }

  /**
   * Adapter fuer eine Rolle, ueber dieselbe Auflösungskette wie das
   * Startkommando: `entityAdapters` > Rollen-Default > globaler Default.
   *
   * Ohne Rolle — eine freie Session, kein Entity — gilt der globale Default.
   * Ein unbekannter Rollenname ist keine Ausnahme: die Registry kennt ihn dann
   * nicht, und es bleibt beim Default.
   */
  adapterForEntity(entityId: string | null): AgentAdapter {
    if (!entityId) return this.adapterRegistry.getDefault()
    const config = this.entityRegistry.get(entityId as EntityId)
    if (!config) return this.adapterRegistry.getDefault()
    try {
      const runtime = resolveEntityRuntime(config, configStore.get('app') as EntityRuntimeConfig)
      return this.resolveAdapter(runtime.adapterId)
    } catch (err) {
      // Ein Wurf hier liegt in der Init-Kette einer Session. Der Default ist
      // immer eine gueltige Antwort; ein Abbruch waere es nicht.
      console.warn('[SessionManager] Adapter-Auflösung fuer Rolle fehlgeschlagen:', err)
      return this.adapterRegistry.getDefault()
    }
  }

  /**
   * Adapter for a role, falling back to the registry default.
   *
   * An unknown id is a misconfiguration, not a reason to refuse to start a
   * session — it is named in the log and the default takes over.
   */
  private resolveAdapter(adapterId: string | undefined): AgentAdapter {
    if (!adapterId) return this.adapterRegistry.getDefault()
    const adapter = this.adapterRegistry.get(adapterId)
    if (adapter) return adapter
    console.warn(`[SessionManager] unknown adapter '${adapterId}' — using the default`)
    return this.adapterRegistry.getDefault()
  }

  /**
   * Queue Claude Code launch with --resume for an entity session.
   * For singleInstance entities or when targetSessionId is given: stops the
   * targeted session first. For multi-instance entities without a target:
   * starts a new session without killing existing ones.
   *
   * `workspaceId` follows the usual three states (undefined = no preference →
   * active workspace, null = explicitly unbound, string = that workspace) and
   * scopes BOTH halves of the resume: which instance gets stopped and where
   * the replacement starts. Without it a resume clicked in workspace A would
   * stop a singleInstance entity's instance in workspace B and recreate it in
   * A — the run dir, MCP workspace header and badge of that session would all
   * silently move workspaces.
   */
  async resumeEntity(
    entityId: EntityId,
    targetSessionId?: string,
    workspaceId?: string | null,
  ): Promise<SessionInfo> {
    const config = this.entityRegistry.get(entityId)
    if (!config) throw new Error(`Unknown entity: ${entityId}`)

    // Resolve the target workspace exactly as startEntity does, so the stop
    // below and the start further down cannot disagree about which instance
    // this resume is about (e.g. for an id pointing at a deleted workspace,
    // where both must land on "unbound").
    const targetWorkspace = resolveEntityWorkspace(
      workspaceId,
      (configStore.get('workspaces') ?? []) as Workspace[],
      (configStore.get('activeWorkspaceId') ?? null) as string | null,
    )
    const effectiveWorkspaceId = targetWorkspace?.id ?? null

    // Stop only the targeted session, or — for singleInstance entities — the
    // instance in the target workspace. Deliberately NOT isEntityRunning() /
    // stopEntity(entityId): both are app-wide and would tear down instances in
    // other workspaces. singleInstance means "once per workspace" here, same
    // rule as the singleton check in startEntity.
    // Remember which conversation the outgoing instance was holding, before
    // it is gone. Knowing it lets the replacement resume that exact one
    // instead of falling back to "whatever is newest in this directory".
    let priorClaudeSessionId: string | undefined
    if (targetSessionId) {
      priorClaudeSessionId = this.sessions.get(targetSessionId)?.claudeSessionId ?? undefined
      await this.stopEntity(entityId, targetSessionId)
    } else if (config.singleInstance) {
      for (const s of findEntitySessions(this.list(), entityId, effectiveWorkspaceId)) {
        priorClaudeSessionId ??= s.claudeSessionId ?? undefined
        await this.stopEntity(entityId, s.id)
      }
    }
    // Multi-instance without target: don't kill existing sessions

    // Start fresh session — in the same workspace the stop above was scoped to
    const session = await this.startEntity(entityId, { workspaceId: effectiveWorkspaceId })

    // Queue Claude launch resuming the prior conversation
    const runtime = resolveEntityRuntime(config, configStore.get('app') as EntityRuntimeConfig)
    const adapter = this.resolveAdapter(runtime.adapterId)
    const launchCmd = adapter.buildLaunchCommand({
      projectPath: config.projectPath,
      sessionName: config.displayName,
      isWorkshop: entityId === 'workshop',
      isCyberFactory: entityId === 'cyber-factory',
      resume: true,
      ...(runtime.model ? { model: runtime.model } : {}),
      ...(priorClaudeSessionId ? { resumeClaudeSessionId: priorClaudeSessionId } : {}),
    })
    const cmdStr = [launchCmd.cmd, ...launchCmd.args].join(' ')
    this.autoLaunchedSessions.add(session.id)
    this.setPendingLaunch(session.id, `clear; ${cmdStr}\n`)

    return session
  }

  /**
   * Schedule a startup greeting to be sent after Claude is ready.
   * Waits ~12s for Claude CLI to boot, then sends the greeting via tmux.
   */
  scheduleStartupGreeting(entityId: EntityId): void {
    const config = this.entityRegistry.get(entityId)
    if (!config?.startupGreeting) return

    const sessionId = this.getFirstEntitySessionId(entityId)
    if (!sessionId) return

    setTimeout(async () => {
      try {
        const session = this.sessions.get(sessionId)
        if (!session || session.status !== 'active') return
        await this.sendKeys(sessionId, config.startupGreeting + '\r')
      } catch (err) {
        console.warn(`[SessionManager] startup greeting failed for ${entityId}:`, err)
      }
    }, 12_000)
  }

  /**
   * Stop an entity session. For singleInstance entities, stops the one session.
   * For multi-instance, stops a specific session (by targetSessionId) or ALL sessions.
   *
   * Scope note: without targetSessionId this is APP-WIDE (all workspaces) on
   * purpose — "stop this entity everywhere" is what the shutdown and entity-off
   * paths want. Callers that mean one workspace must pass a session id.
   */
  async stopEntity(entityId: EntityId, targetSessionId?: string): Promise<void> {
    const sessionIds = targetSessionId
      ? [targetSessionId]
      : this.getAllEntitySessionIds(entityId)
    if (sessionIds.length === 0) return // already stopped

    for (const sessionId of sessionIds) {
      try {
        await this.stop(sessionId)
      } catch {
        // Session may already be gone
      }
      // stop() already calls removeEntitySession via the entity cleanup block,
      // but unlinkSession is also called there — no extra cleanup needed.
    }

    // Backward compat
    if (entityId === 'workshop') this.workshopSessionId = null
    if (entityId === 'cyber-factory') this.cyberFactorySessionId = null

    this.emit('entity-stopped', { entityId })
  }

  /**
   * Check if an entity is currently running (any instance).
   *
   * Scope note: APP-WIDE by design, across all workspaces — not an oversight
   * next to the per-workspace singleton check in startEntity(). Use
   * hasActiveEntitySession(this.list(), entityId, workspaceId) when the
   * question is "does it run in THIS workspace".
   */
  isEntityRunning(entityId: EntityId): boolean {
    for (const sid of this.getAllEntitySessionIds(entityId)) {
      const session = this.sessions.get(sid)
      if (session?.status === 'active') return true
    }
    return false
  }

  /**
   * Get the first session ID for an entity (or null).
   * For multi-instance entities, returns the most recently tracked session.
   *
   * Scope note: APP-WIDE by design — it answers "any instance anywhere" and is
   * used that way by callers outside the workspace feature. The renderer's
   * workspace-scoped counterpart is findEntitySessionId() in
   * shared/entity-status.ts.
   */
  getEntitySessionId(entityId: EntityId): string | null {
    return this.getFirstEntitySessionId(entityId) ?? null
  }

  /**
   * Get all session IDs for an entity.
   */
  getEntitySessionIds(entityId: EntityId): string[] {
    return this.getAllEntitySessionIds(entityId)
  }

  /**
   * Link an existing session to an entity (used by keepWorking restore to
   * re-establish entity links on recovered sessions).
   */
  linkEntity(sessionId: string, entityId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.entityId = entityId
    this.addEntitySession(entityId as EntityId, sessionId)
    if (this.entityRegistry) {
      this.entityRegistry.linkSession(sessionId, entityId as EntityId)
    }
    if (entityId === 'workshop') this.workshopSessionId = sessionId
    if (entityId === 'cyber-factory') this.cyberFactorySessionId = sessionId
    this.persistSession(session)
    this.emit('session-changed', session)
  }

  /**
   * Re-bind a recovered session to a workspace (used by keepWorking restore).
   * No-op for unknown session IDs — never throws into the init chain.
   */
  bindWorkspace(sessionId: string, workspaceId: string | null): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.workspaceId = workspaceId
    this.persistSession(session)
  }

  // ─── Session Resume / Fork ──────────────────────────────

  /**
   * Update the Claude Code session ID for a session (tracked from statusline).
   */
  updateClaudeSessionId(sessionId: string, claudeSessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    if (session.claudeSessionId === claudeSessionId) return
    session.claudeSessionId = claudeSessionId
    session.updatedAt = Date.now()
    // Persist it: the id is needed after a restart, which is exactly when the
    // in-memory copy is gone. Without this the whole chain ends here.
    this.persistSession(session)
  }

  /**
   * Fork an existing session: creates a new session with --fork-session <id>.
   */
  async forkSession(sourceSessionId: string): Promise<SessionInfo> {
    const source = this.sessions.get(sourceSessionId)
    if (!source) throw new Error(`Source session ${sourceSessionId} not found`)

    // Try to read Claude session ID from statusline file if not already set
    if (!source.claudeSessionId) {
      const statusFile = path.join(BRAND.statusLineDir, `${sourceSessionId}.json`)
      try {
        const raw = fs.readFileSync(statusFile, 'utf-8')
        const data = JSON.parse(raw)
        const sid = data?.session_id || data?.sessionId
        if (typeof sid === 'string' && sid) {
          source.claudeSessionId = sid
          source.updatedAt = Date.now()
        }
      } catch {
        // File may not exist or be invalid
      }
    }
    if (!source.claudeSessionId) {
      throw new Error('Source session has no Claude session ID — cannot fork')
    }

    // Ein Fork laeuft in derselben CLI wie die Quelle. `sessionAdapters` haelt
    // fest, womit die Session wirklich gestartet wurde — das ist genauer als
    // jede Neuauflösung, weil die Konfiguration sich seitdem geaendert haben
    // kann. Die Rolle ist der Rueckfall, der globale Default der letzte.
    const adapter = this.getAdapterForSession(sourceSessionId)
      ?? this.adapterForEntity(source.entityId ?? null)
    const launchCmd = adapter.buildLaunchCommand({
      projectPath: source.projectPath || os.homedir(),
      sessionName: `${source.name}-fork`,
      forkFromClaudeSessionId: source.claudeSessionId,
    })
    const cmdStr = [launchCmd.cmd, ...launchCmd.args].join(' ')

    const newSession = await this.start({
      name: `${source.name}-fork`,
      projectPath: source.projectPath || '',
      // Sonst richtet start() MCP fuer die Default-CLI ein, waehrend die Zeile
      // unten die CLI der Quelle startet.
      adapterId: adapter.id,
    })

    this.setPendingLaunch(newSession.id, `clear; ${cmdStr}\n`)
    return newSession
  }

  // ─── Orphan Detection ─────────────────────────────────

  private orphanTimer: NodeJS.Timeout | null = null

  /**
   * Start periodic orphan detection (every 5 minutes).
   */
  startOrphanDetection(): void {
    if (this.orphanTimer) return
    this.orphanTimer = setInterval(() => {
      this.detectOrphans().catch((err) => {
        console.error('[SessionManager] orphan detection error:', err)
      })
    }, 5 * 60 * 1000)
  }

  /**
   * Stop periodic orphan detection.
   */
  stopOrphanDetection(): void {
    if (this.orphanTimer) {
      clearInterval(this.orphanTimer)
      this.orphanTimer = null
    }
  }

  /**
   * Detect orphaned cmux-* sessions not in the registry.
   */
  async detectOrphans(): Promise<SessionInfo[]> {
    let tmuxSessions: Array<{ name: string; created: number; paneCwd?: string | null }>
    try {
      tmuxSessions = await this.tmux.listSessions()
    } catch {
      return []
    }

    const knownTmuxNames = new Set<string>()
    for (const session of this.sessions.values()) {
      knownTmuxNames.add(session.tmuxSession)
    }

    const orphans: SessionInfo[] = []
    for (const ts of tmuxSessions) {
      if (ts.name === 'cipher-mux-control') continue
      if (!ts.name.startsWith('cmux-')) continue
      if (knownTmuxNames.has(ts.name)) continue

      orphans.push({
        id: ulid(),
        name: ts.name,
        projectPath: ts.paneCwd || null,
        tmuxSession: ts.name,
        tmuxPane: null,
        status: 'orphaned',
        createdAt: ts.created * 1000,
        updatedAt: Date.now(),
      })
    }

    if (orphans.length > 0) {
      this.emit('orphans-detected', orphans)
    }
    return orphans
  }

  // ─── Session Exit Detection ─────────────────────────────

  private exitCheckTimer: NodeJS.Timeout | null = null

  /**
   * Start periodic check for ended Claude processes (every 5s).
   * Detects when the Claude CLI exits within a tmux session and
   * marks the session as stopped, freeing the grid cell.
   */
  startExitDetection(): void {
    if (this.exitCheckTimer) return
    this.exitCheckTimer = setInterval(() => {
      this.checkSessionExits().catch((err) => {
        console.error('[SessionManager] exit detection error:', err)
      })
    }, 5_000)
  }

  /**
   * Stop periodic exit detection.
   */
  stopExitDetection(): void {
    if (this.exitCheckTimer) {
      clearInterval(this.exitCheckTimer)
      this.exitCheckTimer = null
    }
  }

  /**
   * Check all active sessions for exited Claude processes.
   * When the pane command is a shell (zsh, bash, fish, sh) instead of
   * 'claude', the Claude process has ended. The session is removed from
   * the registry (freeing the grid cell) and the tmux session is killed.
   *
   * Grid-visible sessions are skipped — they belong to the user's active
   * workspace and should not be auto-reaped even if Claude has exited.
   * Only background sessions (not in grid) are reaped.
   */
  private async checkSessionExits(): Promise<void> {
    const shellCommands = new Set(['zsh', 'bash', 'fish', 'sh', 'dash'])
    const checks: Promise<void>[] = []

    // Build set of session IDs currently visible in the grid.
    // Use BOTH sessionStore grid state AND configStore ui.grid for robustness —
    // after recovery, sessionStore may have stale IDs while configStore is more current.
    const gridVisibleIds = new Set<string>()
    const storeGridState = this.sessionStore.getGridState()
    if (storeGridState) {
      for (const slot of storeGridState.slots) {
        if (slot.sessionId) gridVisibleIds.add(slot.sessionId)
      }
    }
    try {
      const uiGrid = configStore.get('ui')?.grid
      if (uiGrid?.slots) {
        for (const slot of uiGrid.slots) {
          if (slot.sessionId) gridVisibleIds.add(slot.sessionId)
        }
      }
    } catch { /* configStore not available */ }

    for (const [sessionId, session] of this.sessions) {
      if (session.status !== 'active') continue
      // Skip sessions that have a pending launch (Claude hasn't started yet)
      if (this.pendingLaunch.has(sessionId)) continue
      // Skip plain terminal sessions (no autoLaunch/Claude) — they naturally run a shell
      if (!this.autoLaunchedSessions.has(sessionId)) continue
      // Skip sessions visible in the grid — user's active workspace
      if (gridVisibleIds.has(sessionId)) continue

      checks.push(
        this.tmux.getPaneCommand(session.tmuxSession).then(async (cmd) => {
          if (!cmd) return // pane doesn't exist or couldn't be queried
          if (shellCommands.has(cmd)) {
            console.log(`[SessionManager] session ${session.name} (${sessionId}): Claude exited (pane command: ${cmd}), reaping background session`)
            session.status = 'stopped'
            session.updatedAt = Date.now()
            this.tmux.unwatchSession(session.tmuxSession)
            try { await this.tmux.killSession(session.tmuxSession) } catch { /* already gone */ }
            // Clean up entity links if this was an entity session
            if (session.entityId) {
              const entityId = session.entityId as EntityId
              this.removeEntitySession(entityId, sessionId)
              this.entityRegistry.unlinkSession(sessionId)
              if (entityId === 'workshop') this.workshopSessionId = null
              if (entityId === 'cyber-factory') this.cyberFactorySessionId = null
            }
            this.emit('session-stopped', session)
            this.sessions.delete(sessionId)
            this.sessionAdapters.delete(sessionId)
            this.autoLaunchedSessions.delete(sessionId)
            this.sessionStore.removeSession(sessionId)
          }
        }),
      )
    }

    await Promise.allSettled(checks)
  }

  // ─── Session Persistence ──────────────────────────────

  /**
   * Persist a session to the SessionStore.
   * Grid slot is set to null (background) by default — the renderer
   * calls persistGridState() to update slot assignments.
   */
  private persistSession(session: SessionInfo): void {
    const ps = toPersistedSession(session, null)
    ps.status = 'active'
    this.sessionStore.upsertSession(ps)
  }

  /**
   * Save the current grid state to the session store.
   * Called by IpcHub whenever the grid changes so recovery
   * can restore sessions to their correct slots.
   */
  persistGridState(gridState: PersistedGridState): void {
    // Also update gridSlot on each persisted session
    // Filter out sessions no longer in the in-memory registry — prevents
    // a stale grid-save from re-adding sessions that were already stopped.
    const sessions = this.sessionStore.getSessions()
      .filter(ps => this.sessions.has(ps.id))

    // Build set of valid session IDs for slot cleanup
    const validIds = new Set(sessions.map(s => s.id))

    // Clean grid slots that reference sessions no longer in the registry
    for (const slot of gridState.slots) {
      if (slot.sessionId && !validIds.has(slot.sessionId)) {
        slot.sessionId = null
      }
    }

    for (const ps of sessions) {
      const slotIdx = gridState.slots.findIndex(s => s.sessionId === ps.id)
      ps.gridSlot = slotIdx >= 0 ? slotIdx : null
      ps.status = slotIdx >= 0 ? 'active' : 'background'
    }
    this.sessionStore.saveSessions(sessions, gridState)
  }

  /**
   * Disconnect from tmux without killing sessions.
   * Sessions survive app quit and are recovered on next launch.
   */
  async destroy(): Promise<void> {
    this.stopOrphanDetection()
    this.stopExitDetection()
    this.sessions.clear()
    this.tmux.disconnect()
  }
}
