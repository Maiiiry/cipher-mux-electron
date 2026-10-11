import { app, BrowserWindow, dialog, ipcMain, screen, shell } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { WindowManager } from './window-manager'
import { SessionManager } from './session/session-manager'
import { TmuxManager } from './tmux/tmux-manager'
import { MessageBus } from './message-bus/message-bus'
import { configStore } from './config/config-store'
import { getActiveWorkspace } from './workspace/workspace-utils'
import { projectsDir } from './hub/hub-paths'
import { StatusLineMonitor } from './monitoring/statusline-monitor'
import { McpServerManager } from './mcp/mcp-server'
import { generateApiKey } from './mcp/mcp-auth'
import { KickoffWorkshop } from './project/kickoff-orchestrator'
import { BugreportManager } from './bugreport/bugreport-manager'
import { VoiceManager } from './voice/voice-manager'
import { BtRemoteManager, parseComboForElectron } from './bluetooth/bt-remote-manager'
import type { ResolvedAction, DeviceStatus } from './bluetooth/bt-remote-types'
import type { ConversationTransport } from './voice/conversation-engine'
import { TaskManager } from './task/task-manager'
import { TaskWatcher } from './task/task-watcher'
import { TaskHooks } from './task/task-hooks'
import { BugreportTaskSource } from './task/sources/bugreport-source'
import { NoteManager } from './notes/note-manager'
import { NoteSearchIndex } from './notes/note-search-index'
import { NoteTagging } from './notes/note-tagging'
import { preserveTypeTags } from './notes/note-type-tags'
import { TagClassRepo } from './notes/tag-repository'
import { TagIndex } from './notes/tag-index'
import { MemoryStore } from './companion/memory-store'
import { TestingAssistantManager } from './testing-assistant/testing-assistant-manager'
import { AuditManager } from './audit/audit-manager'
import { generateTestingAssistantClaudeMd } from './testing-assistant/testing-template'
import { generateAuditClaudeMd } from './audit/audit-template'
import { generateDebuggerClaudeMd } from './debugger/debugger-template'
import { generateCyberFactoryClaudeMd } from './cyber-factory/cyber-factory-template'
import { generateWorkshopClaudeMd } from './workshop/workshop-template'
import { syncIdeationTemplate } from './ideation-partner/ideation-template'
import { syncRefinementTemplate } from './refinement/refinement-template'
import { generateVoiceRelayClaudeMd } from './session/voice-relay-template'
import { generateCompanionClaudeMd } from './entity-content/companion-preset'
import { TASK_SCHEMA_SQL } from './task/task-schema'
import { getGlobalRules, setGlobalRules, ensureGlobalRulesFile, invalidateGlobalRulesCache } from './config/global-rules'
import { AdapterRegistry } from './agent/registry'
import { readEntityOverride, withEntityOverride } from './agent/entity-override-map'
import { comparePresetVersion, presetBackupPath } from './entity-content/preset-version'
import { presetTemplateFor } from './entity-content/preset-templates'
import { EntityRegistry, registerBuiltinEntities } from './session/entity-registry'
import { CyberFactoryManager } from './cyber-factory/cyber-factory-manager'
import { scanAndRegisterEntities } from './session/entity-scanner'
import { resolvePersonaForPreset } from './session/persona-resolver'
import { resolveSessionTopic } from './session/resolve-session-topic'
import { resolveRestoredWorkspaceId } from './session/resolve-restored-workspace'
import { pruneRunDirs, liveWorkspaceIds } from './session/entity-run-dir'
import { restoreAdapterId } from './session/folder-session'
import { IPC } from '../shared/ipc-channels'
import { MCP_DEFAULT_PORT, MCP_DEFAULT_HOST, MAX_MANUAL_TAGS } from '../shared/constants'
import { BRAND } from '../shared/brand'
import type { StartSessionOpts, SendMessage, Topic, ContextUsage, KickoffRequest, EntityId, Character, RecoveryResult, SessionInfo, AppConfig } from '../shared/types'
import type { GridSlot } from '../shared/grid-types'
import type { TestcaseSection } from './notes/testcase-parser'
import type { Persona, Workspace } from '../shared/persona-types'
import { applyWorkspace } from './workspace/workspace-manager'
import { NoteWatcher } from './notes/note-watcher'
import { runTagMigrationOnce } from './notes/tag-migration'
import { checkAll as setupCheckAll } from './setup/dependency-checker'
import { installDependency } from './setup/dependency-installer'
import { deployBundledVoice } from './setup/voice-bundle'
import { checkForUpdate } from './updater/update-checker'

/**
 * IPC Hub — Central router for all IPC channels.
 * Connects renderer requests to main process services.
 */
export class IpcHub {
  private tmux: TmuxManager
  private sessionManager: SessionManager
  private messageBus: MessageBus
  private statusLineMonitor: StatusLineMonitor
  private mcpServer: McpServerManager
  private kickoffWorkshop: KickoffWorkshop
  private bugreportManager: BugreportManager
  private voiceManager: VoiceManager | null = null
  private taskManager: TaskManager | null = null
  private taskWatcher: TaskWatcher | null = null
  private taskHooks: TaskHooks | null = null
  private bugreportSource: BugreportTaskSource | null = null
  private noteManager!: NoteManager
  private noteTagging!: NoteTagging
  private noteSearchIndex!: NoteSearchIndex
  private tagClassRepo!: TagClassRepo
  private tagIndex!: TagIndex
  private noteWatcher!: NoteWatcher
  private memoryStore: MemoryStore | null = null
  private btRemoteManager: BtRemoteManager | null = null
  private cyberFactoryManager: CyberFactoryManager | null = null
  private testingAssistantManager: TestingAssistantManager | null = null
  private auditManager: AuditManager | null = null
  private cachedRecoveryResult: RecoveryResult | null = null
  private cachedKeepWorkingRestore: {
    gridConfig: { cols: number; rows: number }
    slots: Array<{ sessionId: string | null; slotIndex: number }>
  } | null = null

  private adapterRegistry: AdapterRegistry
  private setupCompleted = false
  private setupCompleteResolve: (() => void) | null = null
  private setupCompletePromise: Promise<void>

  constructor(private windowManager: WindowManager) {
    this.setupCompletePromise = new Promise<void>(resolve => {
      this.setupCompleteResolve = resolve
    })
    this.adapterRegistry = new AdapterRegistry()
    // Der CLI-Schalter. Pro Rolle wird der Adapter schon lange aufgelöst
    // (`entity-runtime.ts` → `resolveAdapter`); was fehlte, war der globale
    // Default — und ein zweiter Adapter, auf den er zeigen kann.
    //
    // Defensiv und still: `agent.defaultAdapter` ist JSON auf der Platte und
    // von Hand editierbar. Ein unbekannter Name darf den Start nicht kosten,
    // also bleibt es dann bei claude-code. Ein Wurf hier würde die ganze
    // Init-Kette killen, und das heißt beim Sessionstart: keine Sessions, ohne
    // Fehlermeldung.
    try {
      const configured = configStore.get('agent').defaultAdapter
      if (configured && configured !== this.adapterRegistry.getDefault().id) {
        this.adapterRegistry.setDefault(configured)
        console.log(`[IpcHub] Default-Adapter aus Config: ${configured}`)
      }
    } catch (err) {
      console.warn('[IpcHub] agent.defaultAdapter nicht anwendbar — bleibe bei claude-code:', err)
    }
    // Migrate orchestrator → workshop directory
    const oldDir = path.join(os.homedir(), '.config/cipher-mux/entities/orchestrator')
    const newDir = path.join(os.homedir(), '.config/cipher-mux/entities/workshop')
    if (fs.existsSync(oldDir)) {
      if (!fs.existsSync(newDir)) {
        try {
          fs.renameSync(oldDir, newDir)
          console.log('[IpcHub] Migrated orchestrator → workshop entity directory')
        } catch (err) {
          console.error('[IpcHub] Failed to migrate orchestrator directory:', err)
        }
      } else {
        // Workshop already exists — remove stale orchestrator remnant
        try {
          fs.rmSync(oldDir, { recursive: true, force: true })
          console.log('[IpcHub] Removed stale orchestrator entity directory (workshop already exists)')
        } catch (err) {
          console.error('[IpcHub] Failed to remove stale orchestrator directory:', err)
        }
      }
    }
    // Migrate config key
    const oldConfig = configStore.getLegacy('orchestrator') as AppConfig['workshop'] | undefined
    if (oldConfig) {
      configStore.set('workshop', oldConfig)
      configStore.clearLegacy('orchestrator')
      console.log('[IpcHub] Migrated orchestrator → workshop config key')
    }

    const entityRegistry = new EntityRegistry()
    registerBuiltinEntities(entityRegistry, BRAND.workshopDir, BRAND.cyberFactoryDir)
    // Scan ~/.config/cipher-mux/entities/ for additional entity directories
    const scanned = scanAndRegisterEntities(entityRegistry)
    if (scanned.length > 0) {
      console.log(`[IpcHub] Scanned ${scanned.length} additional entities: ${scanned.map(e => e.id).join(', ')}`)
    }
    this.tmux = new TmuxManager()
    // Resolve app root for entity asset deployment
    const appRoot = path.resolve(__dirname, '..', '..', '..')
    this.sessionManager = new SessionManager(this.tmux, this.adapterRegistry, entityRegistry, appRoot)
    try {
      this.messageBus = new MessageBus({
        dbPath: path.join(app.getPath('userData'), 'messages.db'),
      })
    } catch (err) {
      console.error('[IpcHub] MessageBus init failed (native module mismatch?):', err)
      this.messageBus = null as any
    }
    this.statusLineMonitor = new StatusLineMonitor()
    this.mcpServer = new McpServerManager()
    const appConfig = configStore.get('app')
    this.kickoffWorkshop = new KickoffWorkshop({
      sessionManager: this.sessionManager,
      adapterRegistry: this.adapterRegistry,
      projectlauncherPath: appConfig?.projectlauncherPath || BRAND.projectLauncherDir,
      timeoutMs: ((appConfig?.kickoffTimeoutMinutes ?? 15) * 60_000),
    })
    this.bugreportManager = new BugreportManager({ messageBus: this.messageBus, noteManager: () => this.noteManager })

    const notesDir = path.join(os.homedir(), '.config', 'cipher-mux', 'notes')

    // Einmaliger Umzug der Bestands-Tags auf die Achsen. Laeuft vor TagIndex
    // und TagClassRepo, damit beide den neuen Zustand sehen -- und bewusst ohne
    // await: der Start soll nicht auf 958 Dateien warten, und die Notes sind
    // waehrenddessen vollstaendig lesbar. Wirft nie (siehe tag-migration.ts).
    void runTagMigrationOnce({
      notesDir,
      workspaces: (configStore.get('workspaces') ?? []) as Array<{ id: string; name?: string }>,
    }).then(report => {
      if (!report || report.written === 0) return
      // tagIndex wird erst weiter unten zugewiesen. Der Rueckruf laeuft nach
      // dem Konstruktor, also ist es da -- aber ein geworfener Fehler in der
      // Init-Kette killt den Session-Restore still, deshalb defensiv.
      try {
        this.tagIndex?.rebuild()
        this.windowManager.sendToAllWindows(IPC.NOTES_CHANGED, { action: 'tags-updated' })
      } catch (err) {
        console.warn('[TagMigration] Index nach dem Umzug nicht neu gebaut:', err)
      }
    })

    this.noteManager = new NoteManager(notesDir)
    this.noteTagging = new NoteTagging(notesDir)
    this.noteSearchIndex = new NoteSearchIndex()
    this.tagClassRepo = new TagClassRepo(notesDir)
    // Single-writer wiring: all .tags.json writes go through TagClassRepo
    this.noteTagging.setTagClassRepo(this.tagClassRepo)
    this.tagIndex = new TagIndex(notesDir, this.tagClassRepo)
    this.tagIndex.rebuild()
    this.noteWatcher = new NoteWatcher(notesDir, (noteId) => {
      console.log(`[NoteWatcher] External change detected: ${noteId}`)
      this.tagIndex.rebuild()
      this.windowManager.sendToAllWindows(IPC.NOTES_CHANGED, {
        action: 'external-update',
        id: noteId,
      })
    })
    this.noteWatcher.start()

    // Initialize Companion MemoryStore
    try {
      const companionDbPath = path.join(os.homedir(), '.config', 'cipher-mux', 'companion.db')
      this.memoryStore = new MemoryStore(companionDbPath)
      this.cyberFactoryManager = new CyberFactoryManager(this.memoryStore)
      const companionDb = this.memoryStore.getDatabase()
      this.testingAssistantManager = new TestingAssistantManager(companionDb)
      this.auditManager = new AuditManager(companionDb)

      // Deploy entity CLAUDE.md templates for all Welle 1-4 entities
      const entitiesBase = path.join(os.homedir(), '.config', 'cipher-mux', 'entities')
      const mcpHost = configStore.get('mcp')?.host ?? MCP_DEFAULT_HOST
      const mcpPort = configStore.get('mcp')?.port ?? MCP_DEFAULT_PORT
      const mcpApiKey = configStore.get('mcp')?.apiKey ?? ''

      const deployEntity = (id: string, content: string) => {
        const dir = path.join(entitiesBase, id)
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(path.join(dir, 'CLAUDE.md'), content, 'utf-8')
        // Also write preset.md (source-of-truth for PresetEditor) if missing
        const presetPath = path.join(dir, 'preset.md')
        if (!fs.existsSync(presetPath)) {
          fs.writeFileSync(presetPath, content, 'utf-8')
        }
      }

      deployEntity('testing-assistant', generateTestingAssistantClaudeMd())
      deployEntity('audit', generateAuditClaudeMd())
      deployEntity('debugger', generateDebuggerClaudeMd())
      deployEntity('cyber-factory', generateCyberFactoryClaudeMd({ mcpHost, mcpPort, mcpApiKey }))
      deployEntity('workshop', generateWorkshopClaudeMd({ mcpHost, mcpPort, mcpApiKey }))
      deployEntity('voice-relay', generateVoiceRelayClaudeMd())
      deployEntity('companion', generateCompanionClaudeMd())

      // Sync experimental templates (ideation + refinement)
      const exp = configStore.get('experimental') ?? {}
      syncIdeationTemplate(exp.ideation_partner !== false)
      syncRefinementTemplate(exp.refinement_v2 !== false)

      // Hide legacy entity directories (prevent scanner from picking them up)
      for (const legacyId of ['mpo', 'watchdog', 'projectlauncher', 'ideationpartner']) {
        const legacyDir = path.join(entitiesBase, legacyId)
        if (fs.existsSync(legacyDir) && !fs.existsSync(path.join(legacyDir, '.hidden'))) {
          fs.writeFileSync(path.join(legacyDir, '.hidden'), 'Replaced by Cyber Factory Pack. Delete this directory to fully remove.\n', 'utf-8')
        }
      }
    } catch (err) {
      console.error('[IpcHub] MemoryStore init failed:', err)
    }

    // Initialize TaskManager — reuse MessageBus DB for single-writer consistency
    try {
      if (this.messageBus) {
        const db = this.messageBus.getDatabase()
        db.exec(TASK_SCHEMA_SQL)
        this.taskManager = new TaskManager(db)
      }
    } catch (err) {
      console.error('[IpcHub] TaskManager init failed:', err)
    }
  }

  init(): void {
    this.registerSessionChannels()
    this.registerScreenshotChannel()
    this.registerTerminalChannels()
    this.registerMessageChannels()
    this.registerKickoffChannel()
    this.registerContextChannels()
    this.registerConfigChannels()
    this.registerWindowChannels()
    this.registerDialogChannels()
    this.registerWorkshopChannels()
    this.registerCyberFactoryChannels()
    this.registerBugreportChannels()
    this.registerVoiceChannels()
    this.registerBtRemoteChannels()
    this.registerTaskChannels()
    this.registerPersonaChannels()
    this.registerCharacterChannels()
    this.registerWorkspaceChannels()
    this.registerNoteChannels()
    // Build FlexSearch index async (non-blocking)
    this.noteSearchIndex.buildFromManager(this.noteManager).catch(err =>
      console.error('[IpcHub] NoteSearchIndex build failed:', err)
    )
    this.registerGridControlChannels()
    this.registerEntityChannels()
    this.registerPresetChannels()
    this.registerGlobalRulesChannels()
    this.registerCompanionChannels()
    this.registerHubChannels()
    this.registerSetupChannels()
    this.registerUpdateChannels()
    ipcMain.handle(IPC.OPEN_EXTERNAL, (_e, url: string) => shell.openExternal(url))
    this.registerDetachChannels()
    this.setupEventForwarding()

    // Start context usage monitor
    this.statusLineMonitor.start()

    // Start Task infrastructure
    if (this.taskManager) {
      const orchConfig = configStore.get('workshop')

      this.taskHooks = new TaskHooks(orchConfig?.defaultHooks ? {
        beforeRun: orchConfig.defaultHooks.beforeRun,
        afterRun: orchConfig.defaultHooks.afterRun,
        timeout: orchConfig.defaultHooks.timeout,
      } : undefined)

      this.taskWatcher = new TaskWatcher({
        taskManager: this.taskManager,
        sessionManager: this.sessionManager as any,
        tmuxManager: this.tmux as any,
        watchInterval: orchConfig?.watchInterval,
        defaultStallTimeout: orchConfig?.stallTimeout,
      })
      this.taskWatcher.start()

      // Start bugreport task source
      const sourceConfig = orchConfig?.taskSources?.bugreport
      if (sourceConfig?.enabled !== false) {
        const rawPath = sourceConfig?.path
          ?? path.join(app.getPath('home'), '.config', 'cipher-mux', 'bugreports', 'outbox')
        const outboxPath = rawPath.startsWith('~/')
          ? path.join(app.getPath('home'), rawPath.slice(2))
          : rawPath
        this.bugreportSource = new BugreportTaskSource(outboxPath)
        this.bugreportSource.start((opts) => this.taskManager!.create(opts))
      }
    }

    // Forward orphan detection events to renderer
    this.sessionManager.on('orphans-detected', (orphans: SessionInfo[]) => {
      this.windowManager.sendToMainWindow(IPC.SESSION_ORPHANS_DETECTED, orphans)
    })

    // Clear all messages from previous runs — each app start begins with a clean bus
    if (this.messageBus) {
      this.messageBus.clearAll()
    }

    // activeWorkspaceId is now persistent (replaces defaultWorkspaceId).
    // It survives restarts so handleRecoveryDone can auto-load it.
    // Legacy clear removed — was from when activeWorkspaceId was runtime-only.

    // Clear stale session IDs from ui.grid SYNCHRONOUSLY on startup.
    // These IDs are from the previous app run and won't match recovered sessions.
    // The keepWorking restore (or RecoveryDialog) will set correct IDs once
    // recovery completes. Without this, the renderer loads stale IDs that don't
    // match any live session → empty cells despite correct grid dimensions.
    const startupUi = configStore.get('ui')
    if (startupUi?.grid?.slots?.some((s: GridSlot) => s.sessionId)) {
      const clearedSlots = startupUi.grid.slots.map((s: GridSlot) => ({ ...s, sessionId: null }))
      configStore.set('ui', { ...startupUi, grid: { ...startupUi.grid, slots: clearedSlots } })
      console.log('[IpcHub] Cleared stale session IDs from ui.grid on startup')
    }

    // Deploy bundled voice models on first start
    try {
      const modelsDir = path.join(process.env.HOME ?? '', '.config', 'cipher-mux', 'models', 'piper')
      for (const voiceName of ['de_DE-cipher_reachy3-medium', 'de_DE-dii-high']) {
        deployBundledVoice({
          resourcesPath: process.resourcesPath ?? '',
          modelsDir,
          voiceName,
        })
      }
    } catch (err) {
      console.warn('[init] Voice bundle deploy failed:', (err as Error).message)
    }

    // Start MCP server first — sessions need MCP config injected.
    const mcpConfig = configStore.get('mcp')
    const port = mcpConfig?.port ?? MCP_DEFAULT_PORT
    const host = mcpConfig?.host ?? MCP_DEFAULT_HOST
    const apiKey = mcpConfig?.apiKey || generateApiKey()
    if (!mcpConfig?.apiKey) {
      configStore.set('mcp', { ...mcpConfig, port, host, apiKey })
    }
    this.sessionManager.setMcpConfig({
      mcpHost: host,
      mcpPort: port,
      mcpApiKey: apiKey,
    })

    // Check if setup is needed — if all required deps are present, skip waiting
    setupCheckAll().then(deps => {
      const allRequiredOk = deps.filter(d => d.required).every(d => d.installed)
      if (allRequiredOk) {
        this.setupCompleted = true
        this.onSetupComplete()
      }
    }).catch(() => {
      // If check fails, assume deps are present (don't block existing installs)
      this.setupCompleted = true
      this.onSetupComplete()
    })

    this.mcpServer.start(port, host, apiKey, {
      sessionManager: this.sessionManager,
      messageBus: this.messageBus,
      statusLineMonitor: this.statusLineMonitor,
      kickoffWorkshop: this.kickoffWorkshop,
      taskManager: this.taskManager,
      windowManager: this.windowManager,
      noteManager: this.noteManager,
      noteSearchIndex: this.noteSearchIndex,
      memoryStore: this.memoryStore,
      tagClassRepo: this.tagClassRepo,
      getVoiceManager: () => this.voiceManager,
      testingAssistantManager: this.testingAssistantManager ?? undefined,
      auditManager: this.auditManager ?? undefined,
      getFocusedSessionId: () => this.focusedSessionId,
    }).then(async () => {
      // Wait for setup to complete before connecting tmux
      if (!this.setupCompleted) {
        console.log('[IpcHub] Waiting for setup wizard to complete before tmux connect...')
        await this.setupCompletePromise
        console.log('[IpcHub] Setup complete — proceeding with tmux connect')
      }
      // MCP ready + setup done → connect tmux, recover sessions, then auto-start defaults
      return this.tmux.connect()
    }).then(() => {
      return this.sessionManager.recover()
    }).then(async (result) => {
      console.log(`[IpcHub] recovery complete: ${result.recovered.length} recovered, ${result.orphaned.length} orphaned, gridState=${!!result.gridState}`)
      // Re-read the status files now that the sessions they belong to exist.
      // The initial scan runs during construction, before recovery, so every
      // claude-session-id it emitted was for a session nobody knew yet.
      this.statusLineMonitor.rescan()
      this.sessionManager.startOrphanDetection()
      this.sessionManager.startExitDetection()

      // Keep Working: restore grid layout from snapshot.
      // If sessions survived in tmux (recovered), reuse them — don't kill/recreate.
      // Only start new sessions with --resume for snapshot entries without a match.
      const kwEnabled = configStore.get('keepWorking')
      const rawSnapshot = configStore.get('keepWorkingSnapshot')
      // Debug: write keepWorking state to file for post-mortem analysis
      try {
        const debugInfo = {
          ts: new Date().toISOString(),
          kwEnabled,
          hasSnapshot: !!rawSnapshot,
          snapshotSessions: rawSnapshot && !Array.isArray(rawSnapshot) ? rawSnapshot.sessions?.length : (Array.isArray(rawSnapshot) ? rawSnapshot.length : 0),
          recovered: result.recovered.map(r => ({ id: r.id, name: r.name, workspaceId: r.workspaceId ?? null })),
          orphaned: result.orphaned.length,
        }
        fs.writeFileSync('/tmp/kw-debug.json', JSON.stringify(debugInfo, null, 2))
      } catch { /* ignore */ }
      // Support both old (Array) and new ({ sessions, gridConfig }) formats
      const snapshotSessions = rawSnapshot
        ? (Array.isArray(rawSnapshot) ? rawSnapshot : rawSnapshot.sessions)
        : null
      const snapshotGridConfig = rawSnapshot && !Array.isArray(rawSnapshot)
        ? rawSnapshot.gridConfig
        : undefined
      const snapshotNotesSlots = rawSnapshot && !Array.isArray(rawSnapshot)
        ? rawSnapshot.notesSlots
        : undefined
      if (snapshotSessions && snapshotSessions.length > 0) {
        // keepWorking mode: skip Recovery Dialog, silently kill orphans, restore seamlessly
        console.log(`[IpcHub] keepWorking: restoring ${snapshotSessions.length} sessions from snapshot (${result.recovered.length} recovered, ${result.orphaned.length} orphaned — auto-cleaning)`)
        // Auto-kill orphaned tmux sessions silently
        for (const orphan of result.orphaned) {
          this.sessionManager.killOrphan(orphan.tmuxSession).catch(() => {})
        }
        await this.restoreKeepWorkingFromRecovery(snapshotSessions, snapshotGridConfig, result.recovered, snapshotNotesSlots)
        configStore.clear('keepWorkingSnapshot')
        // Delay setting cachedRecoveryResult: the renderer needs time to process
        // the KEEP_WORKING_RESTORE event (sent by restoreKeepWorkingFromRecovery)
        // and set keepWorkingApplied.current = true. If we set cachedRecoveryResult
        // immediately, RecoveryDialog resolves before keepWorkingApplied is set,
        // triggering default workspace load → duplicate sessions (T-FW.22).
        setTimeout(() => {
          this.cachedRecoveryResult = { recovered: [], orphaned: [], killed: [], gridState: null }
        }, 1500)
      } else {
        // No keepWorking — cache recovery result for pull-based retrieval by RecoveryDialog
        this.cachedRecoveryResult = result
        // Show Recovery Dialog if there are sessions to handle
        if (result.orphaned.length > 0 || result.recovered.length > 0) {
          this.windowManager.sendToMainWindow(IPC.SESSIONS_RECOVERY_RESULT, result)
        }
        if (result.recovered.length === 0) {
          // Only auto-start if no sessions were recovered
          this.autoStartDefault()
        }
      }

      // Remove run dirs of workspaces that no longer exist. Placed after the
      // Keep-Working restore above (not before) so sessions it just recovered
      // still find their run dir on disk. Sessions of a deleted workspace
      // keep running — their dirs survive until the next start after they are
      // gone, because `sessionManager.list()` already reflects both recover()
      // and restoreKeepWorkingFromRecovery() by this point, and its
      // workspaceIds are unioned into the keep-set below. A throw here must
      // never propagate: this sits in the startup init chain, and per
      // CLAUDE.md ("Keep Working Restore — Fragile Zone") an uncaught error
      // anywhere in that chain kills session restore silently.
      try {
        const workspaces = (configStore.get('workspaces') ?? []) as Array<{ id: string }>
        const keepIds = liveWorkspaceIds(
          workspaces.map((w) => w.id),
          this.sessionManager.list().map((s) => s.workspaceId),
        )
        const removed = pruneRunDirs(keepIds)
        if (removed.length > 0) {
          console.log(`[IpcHub] pruned ${removed.length} orphaned run dir(s)`)
        }
      } catch (err) {
        console.warn('[IpcHub] run dir prune failed:', err)
      }

      // Restore detached windows from previous session
      this.restoreDetachedWindows()

      // Start BT Shutter if enabled (independent of voice mode)
      this.startBtRemote()
    }).catch((err) => {
      console.error('[IpcHub] startup failed:', err)
      // Debug: log startup failures for post-mortem
      try {
        const errorDebug = {
          ts: new Date().toISOString(),
          phase: 'startup-error',
          error: err?.message ?? String(err),
          stack: err?.stack?.split('\n').slice(0, 5),
        }
        fs.writeFileSync('/tmp/kw-debug.json', JSON.stringify(errorDebug, null, 2))
      } catch { /* ignore */ }
      const msg = err?.message ?? String(err)
      if (msg.includes('EADDRINUSE') || msg.includes('already in use')) {
        dialog.showErrorBox(
          'Port Conflict',
          `MCP server could not start: Port ${port} is already in use.\n\nIs another cipher-mux instance running?\n\nThe app will continue without MCP server.`,
        )
      }
    })
  }

  /**
   * Auto-start default sessions when no sessions were recovered.
   *
   * Without default workspace → start only Companion.
   * With default workspace → workspace loading is handled by the renderer
   * (the active workspace ID is persisted in config and loaded on mount).
   *
   * Workshop does NOT auto-start — it must be in a workspace or
   * started manually via the StatusBar button.
   */
  private autoStartDefault(): void {
    const activeWsId = configStore.get('activeWorkspaceId')

    if (activeWsId) {
      // Active workspace configured — renderer will load it via handleRecoveryDone.
      // Don't auto-start Companion here; the workspace apply flow handles session creation.
      console.log(`[IpcHub] Active workspace "${activeWsId}" set — renderer will apply it after recovery`)
      return
    }

    // No workspace → start Companion only
    console.log('[IpcHub] No default workspace — auto-starting Companion')
    this.sessionManager.startEntity('companion').then((session) => {
      console.log(`[IpcHub] Companion auto-started: ${session.id}`)
      // Note: ENTITY_STARTED is already sent by setupEventForwarding when
      // startEntity emits 'entity-started'. No manual send here (RT-X2 double-event fix).
      try {
        this.sessionManager.queueEntityClaude('companion', session.id)
        this.sessionManager.scheduleStartupGreeting('companion')
      } catch (err) {
        console.error('[IpcHub] Failed to queue companion claude:', err)
      }
    }).catch((err) => {
      console.error('[IpcHub] Companion auto-start failed:', err)
    })
  }

  getTmuxManager(): TmuxManager {
    return this.tmux
  }

  getSessionManager(): SessionManager {
    return this.sessionManager
  }

  getMcpServer(): McpServerManager {
    return this.mcpServer
  }

  // ─── Event Forwarding to Renderer ──────────────────────
  private setupEventForwarding(): void {
    this.sessionManager.on('session-changed', (session) => {
      this.windowManager.sendToAllWindows(IPC.SESSION_CHANGED, session)
    })

    this.sessionManager.on('session-closing', (session) => {
      this.windowManager.sendToMainWindow(IPC.SESSION_CLOSING, session)
    })

    this.sessionManager.on('session-stopped', (session) => {
      this.windowManager.sendToMainWindow(IPC.SESSION_STOPPED, session)
      // Clean up context-usage cache so bar resets to 0% on new session
      this.statusLineMonitor?.remove(session.id)
      // T-VP.3: auto-unpin voice if the stopped session was pinned
      this.voiceManager?.getInputRouter()?.unpinIfSession(session.id)
    })

    this.sessionManager.on('cyber-factory-started', (session) => {
      this.windowManager.sendToMainWindow(IPC.CYBER_FACTORY_STARTED, session)
    })

    this.sessionManager.on('entity-started', (data: { entityId: string; session: unknown }) => {
      this.windowManager.sendToMainWindow(IPC.ENTITY_STARTED, data)
      // Voice-relay uses mux_tts_speak for TTS (like all other sessions).
      // VoiceOutputRouter (terminal-polling) is disabled — it caused duplicate
      // readback of everything visible in the relay pane.

    })

    this.sessionManager.on('entity-stopped', (_data: { entityId: string }) => {
      // (VoiceOutputRouter disabled — voice-relay uses mux_tts_speak directly)
    })

    this.tmux.on('output', (paneId: string, data: string) => {
      // Route terminal data to detached window if session is detached, else mainWindow
      if (this.windowManager.isDetached?.(paneId)) {
        const detachedWin = this.windowManager.getDetachedWindow?.(paneId)
        if (detachedWin && !detachedWin.isDestroyed()) {
          detachedWin.webContents.send(IPC.TERMINAL_DATA, { paneId, data })
        }
      } else {
        this.windowManager.sendToMainWindow(IPC.TERMINAL_DATA, { paneId, data })
      }
    })

    if (this.messageBus) {
      this.messageBus.on('message', (msg) => {
        this.windowManager.sendToMainWindow(IPC.MESSAGE_RECEIVED, msg)
      })
    }

    this.statusLineMonitor.on('usage-updated', (sessionId: string, usage: ContextUsage) => {
      this.windowManager.sendToMainWindow(IPC.CONTEXT_UPDATED, { sessionId, usage })
    })

    this.statusLineMonitor.on('usage-warning', (sessionId: string, usage: ContextUsage) => {
      this.windowManager.sendToMainWindow(IPC.CONTEXT_WARNING, { sessionId, usage })
    })

    this.statusLineMonitor.on('claude-session-id', (sessionId: string, claudeSessionId: string) => {
      this.sessionManager.updateClaudeSessionId(sessionId, claudeSessionId)
    })

    this.kickoffWorkshop.on('kickoff-complete', (event) => {
      this.windowManager.sendToMainWindow(
        IPC.PROJECT_KICKOFF_COMPLETED,
        { status: 'complete', event },
      )
    })

    this.kickoffWorkshop.on('kickoff-timeout', (data) => {
      this.windowManager.sendToMainWindow(
        IPC.PROJECT_KICKOFF_COMPLETED,
        { status: 'timeout', ...data },
      )
    })

    this.kickoffWorkshop.on('kickoff-error', (data) => {
      this.windowManager.sendToMainWindow(
        IPC.PROJECT_KICKOFF_COMPLETED,
        {
          status: 'error',
          handle: data.handle,
          error: data.error instanceof Error ? data.error.message : String(data.error),
        },
      )
    })

    // Task events → renderer
    if (this.taskManager) {
      this.taskManager.on('task:created', (task) => {
        this.windowManager.sendToMainWindow(IPC.TASK_CREATED, task)
      })
      this.taskManager.on('task:state-changed', (task, previousState) => {
        this.windowManager.sendToMainWindow(IPC.TASK_STATE_CHANGED, { task, previousState })
      })
    }

    // Completion verification hooks
    if (this.taskManager && this.taskHooks) {
      const tm = this.taskManager
      const hooks = this.taskHooks
      tm.on('task:state-changed', async (task) => {
        if (task.state === 'validating') {
          const session = task.sessionId ? this.sessionManager.get(task.sessionId) : null
          const projectPath = session?.projectPath ?? '/tmp'
          const result = await hooks.runAfterRun(task, projectPath)
          if (result.success) {
            tm.markCompleted(task.id, {
              summary: result.stdout.slice(0, 500), exitCode: result.exitCode,
            })
          } else {
            tm.markFailed(task.id, {
              error: result.timedOut ? 'hook timed out' : `hook failed: ${result.stderr.slice(0, 500)}`,
            })
          }
        }
      })
    }
  }

  // ─── Sessions ──────────────────────────────────────────
  private registerSessionChannels(): void {
    ipcMain.handle(IPC.SESSIONS_LIST, async () => {
      return this.sessionManager.list()
    })

    ipcMain.handle(IPC.SESSIONS_START, async (_e, opts: StartSessionOpts) => {
      return this.sessionManager.start(opts)
    })

    ipcMain.handle(IPC.SESSIONS_STOP, async (_e, { sessionId }: { sessionId: string }) => {
      await this.sessionManager.gracefulStop(sessionId)
      return { ok: true }
    })

    ipcMain.handle(IPC.SESSIONS_RECOVER, async () => {
      // Return cached recovery result (from startup) instead of re-running
      // recover(), which would double-register sessions.
      return this.cachedRecoveryResult
    })

    ipcMain.handle(IPC.SESSIONS_RECOVERY_ACTION, async (_e, { action, tmuxSession, displayName }: {
      action: 'adopt' | 'kill'
      tmuxSession: string
      displayName?: string
    }) => {
      if (action === 'adopt') {
        return this.sessionManager.adoptOrphan(tmuxSession, displayName)
      } else {
        await this.sessionManager.killOrphan(tmuxSession)
        return { ok: true }
      }
    })

    ipcMain.handle(IPC.SESSIONS_RECOVERY_DECLINE, async () => {
      // User declined session restore — kill all recovered sessions and auto-start defaults
      if (this.cachedRecoveryResult) {
        for (const session of this.cachedRecoveryResult.recovered) {
          try {
            await this.sessionManager.stop(session.id)
          } catch {
            // Session may already be gone
          }
        }
        this.cachedRecoveryResult = null
      }
      this.autoStartDefault()
      return { ok: true }
    })

    ipcMain.handle('cipher-mux:sessions:capture', async (_e: unknown, sessionId: string) => {
      try {
        const content = await this.sessionManager.capture(sessionId)
        if (!content) return null
        const lines = content.split('\n').filter((l: string) => l.trim())
        return lines.slice(-5).join('\n')
      } catch {
        return null
      }
    })

    ipcMain.handle(IPC.SESSION_FORK, async (_e, { sessionId }: { sessionId: string }) => {
      return this.sessionManager.forkSession(sessionId)
    })

    ipcMain.handle(IPC.SESSION_ORPHANS, async () => {
      return this.sessionManager.detectOrphans()
    })
  }

  // ─── Session Screenshot ──────────────────────────────────

  private registerScreenshotChannel(): void {
    ipcMain.handle(IPC.SESSION_SCREENSHOT, async (_e, { sessionId }: { sessionId: string }) => {
      const { execFileSync } = await import('child_process')
      const fsNode = await import('fs')
      const pathNode = await import('path')

      // Save to workspace project dir > session projectPath > ~/Pictures fallback
      const session = this.sessionManager.list().find((s: SessionInfo) => s.id === sessionId)
      const activeWs = getActiveWorkspace()
      const wsProjectDir = activeWs?.contextPaths?.[0] ?? null
      const baseDir = wsProjectDir ?? session?.projectPath ?? pathNode.join(os.homedir(), 'Pictures', 'cipher-mux')
      const screenshotDir = pathNode.join(baseDir, 'screenshots')
      fsNode.mkdirSync(screenshotDir, { recursive: true })

      const timestamp = Date.now()
      const safeName = (session?.name || 'session').replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 80)
      const filePath = pathNode.join(screenshotDir, `${safeName}-${timestamp}.png`)
      try {
        execFileSync('screencapture', ['-i', filePath], { timeout: 30000 })
        if (!fsNode.existsSync(filePath)) return null

        // Send filename to the session via tmux (full path is in clipboard)
        if (session?.tmuxSession) {
          const fileName = pathNode.basename(filePath)
          await this.sessionManager.sendKeys(sessionId, `# Screenshot: ${fileName} (Pfad im Clipboard)`)
        }
        return { path: filePath }
      } catch {
        return null
      }
    })
  }

  // ─── Terminal ──────────────────────────────────────────
  private registerTerminalChannels(): void {
    ipcMain.on(IPC.TERMINAL_WRITE, (_e, { paneId, data }: { paneId: string; data: string }) => {
      this.sessionManager.sendKeys(paneId, data).catch((err) => {
        console.error('terminal write error:', err)
      })
    })

    // `handle`, nicht `on`: der Renderer muss den Resize abwarten koennen, bevor er
    // den Pane erfasst — Begruendung an `resize` im Preload. Ein Fehler wird hier
    // geloggt und **nicht** weitergeworfen, damit ein gescheiterter Resize im
    // Renderer keine unbehandelte Ablehnung wird; der Aufrufer bekommt wie vorher
    // nur die Zusage, dass der Versuch durch ist.
    ipcMain.handle(IPC.TERMINAL_RESIZE, async (_e, { paneId, cols, rows }: { paneId: string; cols: number; rows: number }) => {
      try {
        await this.sessionManager.resize(paneId, cols, rows)
      } catch (err) {
        console.error('terminal resize error:', err)
      }
    })

    ipcMain.handle(IPC.TERMINAL_SPLIT, async (_e, { paneId, direction }: { paneId: string; direction: string }) => {
      const session = this.sessionManager.get(paneId)
      if (!session) return { error: 'Session not found' }
      const target = session.tmuxPane ?? session.tmuxSession
      const newPaneId = await this.tmux.splitPane(target, direction as 'horizontal' | 'vertical')
      return { paneId: newPaneId }
    })

    ipcMain.handle(IPC.TERMINAL_CAPTURE, async (_e, { paneId, lines }: { paneId: string; lines?: number }) => {
      return this.sessionManager.capture(paneId, lines)
    })

    ipcMain.handle(IPC.TERMINAL_SNAPSHOT, async (_e, { paneId, lines }: { paneId: string; lines?: number }) => {
      return this.sessionManager.snapshot(paneId, lines)
    })

    ipcMain.on(IPC.TERMINAL_READY, (_e, { paneId, cols, rows }: { paneId: string; cols: number; rows: number }) => {
      this.sessionManager.markReady(paneId, cols, rows).catch((err) => {
        console.error('terminal ready error:', err)
      })
    })
  }

  // ─── Detachable Windows ────────────────────────────────
  private registerDetachChannels(): void {
    ipcMain.handle(IPC.DETACH_SESSION, async (_e, { sessionId }: { sessionId: string }) => {
      await this.windowManager.openDetachedWindow('session', sessionId)
      this.windowManager.sendToMainWindow(IPC.DETACH_STATE_CHANGED, {
        entries: this.windowManager.getDetachedEntries()
      })
      return { ok: true }
    })

    ipcMain.handle(IPC.DETACH_NOTE, async (_e, { noteId }: { noteId: string }) => {
      await this.windowManager.openDetachedWindow('note', noteId)
      this.windowManager.sendToMainWindow(IPC.DETACH_STATE_CHANGED, {
        entries: this.windowManager.getDetachedEntries()
      })
      return { ok: true }
    })

    ipcMain.handle(IPC.DOCK_REQUEST, async (_e, { entityId }: { entityId: string }) => {
      // Mark as dock-initiated so the 'closed' event sends docked entityId
      this.windowManager.markDockInitiated(entityId)
      this.windowManager.closeDetachedWindow(entityId)
      return { ok: true }
    })

    ipcMain.handle(IPC.DETACH_LIST, async () => {
      return this.windowManager.getDetachedEntries()
    })

    ipcMain.handle(IPC.DETACH_HAS_DETACHED, async () => {
      return this.windowManager.getDetachedEntries().length > 0
    })
  }

  // ─── Messages ──────────────────────────────────────────
  private registerMessageChannels(): void {
    ipcMain.handle(IPC.MESSAGES_SEND, async (_e, msg: SendMessage) => {
      if (!this.messageBus) return { error: 'MessageBus not available' }
      return this.messageBus.send(msg)
    })

    ipcMain.handle(IPC.MESSAGES_LIST, async (_e, opts?: { topic?: Topic; limit?: number; before?: number }) => {
      if (!this.messageBus) return []
      if (opts?.topic) {
        return this.messageBus.getByTopic(opts.topic, opts.limit, opts.before)
      }
      return this.messageBus.getAll(opts?.limit, opts?.before)
    })

    ipcMain.handle(IPC.MESSAGES_UNREAD, async () => {
      if (!this.messageBus) return 0
      return this.messageBus.unreadCount('renderer')
    })

    ipcMain.handle(IPC.MESSAGES_MARK_READ, async (_e, { messageIds }: { messageIds: string[] }) => {
      if (!this.messageBus) return { ok: false }
      this.messageBus.markRead(messageIds, 'renderer')
      return { ok: true }
    })
  }

  // ─── Kickoff ──────────────────────────────────────────
  private registerKickoffChannel(): void {
    ipcMain.handle(IPC.PROJECTS_KICKOFF, async (_e, req: KickoffRequest) => {
      const handle = await this.kickoffWorkshop.start(req)
      return handle
    })
  }

  // ─── Context ───────────────────────────────────────────
  private registerContextChannels(): void {
    ipcMain.handle(IPC.CONTEXT_GET, async (_e, { sessionId }: { sessionId: string }) => {
      return this.statusLineMonitor.get(sessionId) ?? null
    })

    ipcMain.handle(IPC.CONTEXT_ALL, async () => {
      const map = this.statusLineMonitor.getAll()
      const result: Record<string, ContextUsage> = {}
      for (const [key, value] of map) {
        result[key] = value
      }
      return result
    })
  }

  // ─── BT Remote ──────────────────────────────────────────
  private registerBtRemoteChannels(): void {
    ipcMain.handle(IPC.BT_REMOTE_MAPPING_GET, async () => {
      if (!this.btRemoteManager) return { profiles: [], devices: [] }
      return {
        profiles: this.btRemoteManager.getProfiles(),
        devices: this.btRemoteManager.getConnectedDevices(),
      }
    })

    ipcMain.handle(IPC.BT_REMOTE_MAPPING_SET, async (_e, {
      vid, pid, buttonId, action,
    }: { vid: string; pid: string; buttonId: string; action: string }) => {
      if (!this.btRemoteManager) return { ok: false }
      // Validate action: must be 'passthrough', 'disabled', or a valid shortcut combo
      if (action !== 'passthrough' && action !== 'disabled') {
        // Shortcut combo: only allow Modifier+Key patterns (e.g. "Cmd+Shift+W", "Ctrl+U", "Escape")
        if (!/^([A-Za-z]+\+)*[A-Za-z0-9]+$/.test(action)) {
          return { ok: false, error: 'Invalid action format' }
        }
      }
      const ok = this.btRemoteManager.updateMapping(vid, pid, buttonId, action)
      return { ok }
    })
  }

  // ─── Config ────────────────────────────────────────────
  private registerConfigChannels(): void {
    ipcMain.handle(IPC.CONFIG_GET, async (_e, { key }: { key: string }) => {
      return configStore.get(key as any)
    })

    ipcMain.handle(IPC.CONFIG_SET, async (_e, { key, value }: { key: string; value: unknown }) => {
      configStore.set(key as any, value as any)
      // Broadcast theme changes to all windows (sidebar, workspaces)
      if (key === 'ui' && value && typeof value === 'object') {
        const ui = value as Record<string, unknown>
        if (ui.theme !== undefined) {
          this.windowManager.sendToAllWindows(IPC.THEME_CHANGED, {
            theme: ui.theme,
            activeCustomThemeId: ui.activeCustomThemeId ?? null,
            customThemeTokens: ui.customThemeTokens ?? null,
          })
        }
      }
      return { ok: true }
    })

    ipcMain.handle(IPC.CONFIG_SAVE_GRID, (_event, grid) => {
      const ui = configStore.get('ui')
      configStore.set('ui', { ...ui, grid })
      // Also persist grid state + slot assignments to SessionStore for recovery
      if (grid?.config && grid?.slots) {
        this.sessionManager.persistGridState({
          config: grid.config,
          slots: grid.slots,
        })
      }
      // Keep Working: live-update snapshot on every grid change
      if (configStore.get('keepWorking') && grid?.config && grid?.slots) {
        this.updateKeepWorkingSnapshot(grid)
      }
      // T-VP.3: auto-unpin voice if pinned session no longer in grid
      this.voiceManager?.getInputRouter()?.autoUnpinIfBackground()
    })

    ipcMain.handle('cipher-mux:config:get-skip-permissions', () => {
      const agent = configStore.get('agent')
      return agent?.skipPermissions ?? false
    })

    ipcMain.handle('cipher-mux:config:set-skip-permissions', (_e: unknown, value: boolean) => {
      const agent = configStore.get('agent') ?? {}
      configStore.set('agent', { ...agent, skipPermissions: value })
      return { ok: true }
    })
  }

  // ─── Window ─────────────────────────────────────────────
  private registerWindowChannels(): void {
    ipcMain.handle(IPC.WINDOW_FIT_GRID, (_e, { cols, rows, panelWidth: extraPanels }: { cols: number; rows: number; panelWidth?: number }) => {
      const win = this.windowManager.getMainWindow()
      if (!win) return
      const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize
      const targetCellWidth = 664
      const panels = extraPanels ?? 280 // default: chatroom only
      const padding = 20
      const idealWidth = cols * targetCellWidth + panels + padding
      // Height: fixed cell height × rows + chrome
      const cellHeight = 380 // SESSION_CELL_HEIGHT
      const chromeHeight = 38 + 28 // drag region + status bar
      const gridPadding = 12 // 6px padding top+bottom on .session-grid-area
      const gridGaps = (rows - 1) * 4 // 4px gap between rows
      const idealHeight = rows * cellHeight + chromeHeight + gridPadding + gridGaps
      // Cap to screen dimensions — grid scrolls when content exceeds window
      const newWidth = Math.min(idealWidth, screenW)
      const newHeight = Math.min(idealHeight, screenH)
      // Set minSize first — otherwise shrinking is blocked by old minimum
      win.setMinimumSize(Math.min(newWidth, screenW), Math.min(newHeight, screenH))
      win.setSize(newWidth, newHeight)
    })

    ipcMain.handle(IPC.WINDOW_OPEN_WORKSPACES, (_e, initialTab?: string) => {
      // Map legacy 'personas' tab to 'companion'
      const tab = initialTab === 'personas' ? 'companion' : initialTab
      this.windowManager.openWorkspacesWindow(tab as 'workspaces' | 'companion' | 'tags' | undefined)
    })

    ipcMain.handle(IPC.SIDEBAR_DETACH, () => {
      this.windowManager.openSidebarWindow()
      configStore.set('sidebarDetached', true)
      return { ok: true }
    })

    ipcMain.handle(IPC.SIDEBAR_REATTACH, () => {
      this.windowManager.closeSidebarWindow()
      configStore.set('sidebarDetached', false)
      return { ok: true }
    })

    ipcMain.handle(IPC.SIDEBAR_DOCK, () => {
      this.windowManager.dockSidebarWindow()
      return { ok: true }
    })

    ipcMain.handle('cipher-mux:sidebar:is-detached', () => {
      return configStore.get('sidebarDetached') ?? false
    })

    ipcMain.handle(IPC.SIDEBAR_TOGGLE_WINDOW, () => {
      const visible = this.windowManager.toggleSidebarWindow()
      return { visible }
    })
  }

  // ─── Dialogs ────────────────────────────────────────────
  private registerDialogChannels(): void {
    ipcMain.handle(IPC.DIALOG_OPEN_FILE, async (e, opts?: { title?: string; filters?: Electron.FileFilter[] }) => {
      const win = BrowserWindow.fromWebContents(e.sender) ?? this.windowManager.getMainWindow()
      if (!win) return null
      const result = await dialog.showOpenDialog(win, {
        title: opts?.title ?? 'Select File',
        properties: ['openFile'],
        filters: opts?.filters,
      })
      win.focus()
      return result.canceled ? null : result.filePaths[0] ?? null
    })

    ipcMain.handle(IPC.DIALOG_OPEN_DIR, async (e, opts?: { title?: string; defaultPath?: string }) => {
      const win = BrowserWindow.fromWebContents(e.sender) ?? this.windowManager.getMainWindow()
      if (!win) return null
      const result = await dialog.showOpenDialog(win, {
        title: opts?.title ?? 'Select Directory',
        defaultPath: opts?.defaultPath ?? projectsDir(),
        properties: ['openDirectory', 'createDirectory'],
      })
      win.focus()
      return result.canceled ? null : result.filePaths[0] ?? null
    })
  }

  // ─── Workshop ────────────────────────────────────────
  private registerWorkshopChannels(): void {
    ipcMain.handle(IPC.WORKSHOP_START, async () => {
      const session = await this.sessionManager.startEntity('workshop')
      // Queue Claude launch — fires when renderer reports real terminal size
      try {
        this.sessionManager.queueEntityClaude('workshop', session.id)
      } catch (err) {
        console.error('[IpcHub] Failed to queue workshop claude:', err)
      }
      return session
    })

    ipcMain.handle(IPC.WORKSHOP_STOP, async () => {
      await this.sessionManager.stopEntity('workshop')
      return { ok: true }
    })

    ipcMain.handle(IPC.WORKSHOP_STATUS, async () => {
      return {
        running: this.sessionManager.isEntityRunning('workshop'),
        sessionId: this.sessionManager.getEntitySessionId('workshop'),
      }
    })
  }

  // ─── Cyber Factory ──────────────────────────────────────
  private registerCyberFactoryChannels(): void {
    ipcMain.handle(IPC.CYBER_FACTORY_START, async () => {
      const session = await this.sessionManager.startEntity('cyber-factory')
      try {
        this.sessionManager.queueEntityClaude('cyber-factory', session.id)
      } catch (err) {
        console.error('[IpcHub] Failed to queue Cyber Factory claude:', err)
      }
      return session
    })

    ipcMain.handle(IPC.CYBER_FACTORY_STOP, async () => {
      await this.sessionManager.stopEntity('cyber-factory')
      return { ok: true }
    })

    ipcMain.handle(IPC.CYBER_FACTORY_STATUS, async () => {
      return {
        running: this.sessionManager.isEntityRunning('cyber-factory'),
        sessionId: this.sessionManager.getEntitySessionId('cyber-factory'),
      }
    })

    ipcMain.handle(IPC.CYBER_FACTORY_RUN_STATUS, async (_e, runId: string) => {
      return this.cyberFactoryManager?.getRun(runId) ?? null
    })

    ipcMain.handle(IPC.CYBER_FACTORY_WELLE_LIST, async (_e, runId: string) => {
      return this.cyberFactoryManager?.listWellen(runId) ?? []
    })

    ipcMain.handle(IPC.CYBER_FACTORY_WORKER_STATUS, async (_e, welleId: string) => {
      return this.cyberFactoryManager?.listSubProjekte(welleId) ?? []
    })
  }

  // ─── Bugreport ─────────────────────────────────────────
  private registerBugreportChannels(): void {
    ipcMain.handle(IPC.BUGREPORT_COLLECT, async () => {
      return this.bugreportManager.collectDiagnostics(this.sessionManager.list())
    })

    ipcMain.handle(IPC.BUGREPORT_SUBMIT, async (_e, { description, project, screenshots, reportType }: {
      description: string
      project?: string
      screenshots?: string[]
      reportType?: string
    }) => {
      return this.bugreportManager.submit(description, this.sessionManager.list(), project, undefined, screenshots, reportType)
    })

    ipcMain.handle(IPC.BUGREPORT_PICK_SCREENSHOT, async () => {
      const { dialog } = await import('electron')
      const result = await dialog.showOpenDialog({
        title: 'Screenshots anhängen',
        filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
        properties: ['openFile', 'multiSelections'],
      })
      return result.canceled ? [] : result.filePaths
    })

    // ── Bugreport Dialog STT Routing ──

    ipcMain.handle(IPC.BUGREPORT_DIALOG_OPEN, () => {
      const inputRouter = this.voiceManager?.getInputRouter()
      if (inputRouter) {
        inputRouter.setDialogTarget('bugreport')
      }
      return { ok: true }
    })

    ipcMain.handle(IPC.BUGREPORT_DIALOG_CLOSE, () => {
      const inputRouter = this.voiceManager?.getInputRouter()
      if (inputRouter) {
        inputRouter.clearDialogTarget()
      }
      return { ok: true }
    })
  }


  // ─── Voice ──────────────────────────────────────────────
  private registerVoiceChannels(): void {
    ipcMain.handle(IPC.VOICE_AVAILABLE, () => {
      console.log('[Voice] VOICE_AVAILABLE check starting...')
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- synchroner Kontext
      const fs = require('fs')

      // ── Step 1: Check whisper.node native module ──
      // require.resolve only checks file resolution, NOT ABI compatibility.
      // We try a full require() to catch ABI mismatch errors (e.g. module
      // compiled for Node.js but loaded in Electron, or vice versa).
      // Fix: npm run rebuild:voice  (rebuilds native modules for Electron ABI)
      try {
        require.resolve('@fugood/whisper.node')
        console.log('[Voice] whisper.node: resolved')
      } catch {
        console.log('[Voice] whisper.node: NOT installed')
        return {
          available: false,
          reason: 'whisper.node nicht installiert — npm install @fugood/whisper.node && npm run rebuild:voice',
        }
      }

      // Try actual native load to detect ABI mismatch
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- synchrones Lazy-Load, CommonJS-Ziel
        require('@fugood/whisper.node')
        console.log('[Voice] whisper.node: loaded OK')
      } catch (err) {
        const msg = (err as Error).message || String(err)
        const isAbiMismatch = msg.includes('was compiled against') || msg.includes('NODE_MODULE_VERSION') || msg.includes('ABI')
        if (isAbiMismatch) {
          console.log('[Voice] whisper.node: ABI mismatch —', msg)
          return {
            available: false,
            reason: 'whisper.node ABI-Mismatch — npm run rebuild:voice',
          }
        }
        console.log('[Voice] whisper.node: load failed —', msg)
        return {
          available: false,
          reason: `whisper.node Ladefehler — npm run rebuild:voice (${msg.slice(0, 80)})`,
        }
      }

      // ── Step 2: sherpa-onnx-node (optional — only for main-process VAD) ──
      try {
        require.resolve('sherpa-onnx-node')
        console.log('[Voice] sherpa-onnx-node: found')
      } catch {
        console.log('[Voice] sherpa-onnx-node: NOT found — skipping (optional for session mode)')
        // sherpa-onnx-node is only needed for VAD in main process (bugreport mode).
        // Session mode uses renderer-side VAD (Silero ONNX via vad-loader.ts).
        // Don't block voice availability for missing sherpa-onnx-node.
      }

      // ── Step 3: Check whisper model file ──
      // Use ~/.config/cipher-mux/ so path is stable regardless of dev vs packaged
      // mode (app.getPath('userData') varies between environments).
      const configBase = path.join(os.homedir(), '.config', 'cipher-mux')
      const modelPath = path.join(configBase, 'models', 'whisper', 'ggml-small.bin')
      if (!fs.existsSync(modelPath)) {
        console.log('[Voice] Whisper model NOT found at:', modelPath)
        return {
          available: false,
          reason: `Whisper-Model fehlt — scripts/download-models.sh ausfuehren`,
        }
      }
      console.log('[Voice] Whisper model found at:', modelPath)
      console.log('[Voice] VOICE_AVAILABLE => true')
      return { available: true }
    })

    ipcMain.handle(IPC.VOICE_START, async () => {
      try {
        this.voiceManager?.getConversation()?.handleToggle()
        return { ok: true }
      } catch (err) {
        const msg = (err as Error).message
        this.windowManager.sendToAllWindows(IPC.VOICE_ERROR, msg)
        return { ok: false, error: msg }
      }
    })

    ipcMain.handle(IPC.VOICE_STOP, () => {
      this.voiceManager?.getConversation()?.handleToggle()
      return { ok: true }
    })

    ipcMain.on(IPC.VOICE_AUDIO_CHUNK, (_event, chunk: ArrayBuffer) => {
      this.voiceManager?.getConversation()?.receiveAudioChunk(chunk)
    })

    ipcMain.on(IPC.VOICE_PLAYBACK_DONE, () => {
      this.voiceManager?.getConversation()?.onPlaybackComplete()
    })

    ipcMain.on(IPC.VOICE_VAD_SPEECH_START, () => {
      console.log('[Voice] IPC: VAD_SPEECH_START received, voiceManager:', !!this.voiceManager)
      this.voiceManager?.onVADSpeechStart()
    })

    ipcMain.on(IPC.VOICE_VAD_SPEECH_END, (_event, audioData: number[]) => {
      console.log('[Voice] IPC: VAD_SPEECH_END received, samples:', audioData?.length)
      this.voiceManager?.onVADSpeechEnd(audioData)
    })

    ipcMain.on(IPC.VOICE_VAD_MISFIRE, () => {
      console.log('[Voice] IPC: VAD_MISFIRE received')
      this.voiceManager?.onVADMisfire()
    })

    ipcMain.on(IPC.VOICE_BARGE_IN, () => {
      console.log('[Voice] IPC: BARGE_IN received from amplitude monitor')
      this.voiceManager?.getConversation()?.triggerAmplitudeBargeIn()
    })

    // ── Session Voice Mode ──

    ipcMain.handle(IPC.VOICE_START_SESSION, async () => {
      console.log('[Voice] VOICE_START_SESSION handler invoked')
      try {
        // Session mode needs skipTTS — if a bugreport VoiceManager (with TTS)
        // is running, shut it down and create a fresh one without TTS.
        if (this.voiceManager) {
          console.log('[Voice] Shutting down existing VoiceManager for session mode')
          this.voiceManager.shutdown()
          this.voiceManager = null as any
        }

        console.log('[Voice] Creating new VoiceManager (skipTTS: true)')
        this.voiceManager = new VoiceManager({ skipTTS: true })
        const transport: ConversationTransport = {
          sendStartCapture: () => this.windowManager.sendToAllWindows(IPC.VOICE_STATE, 'recording'),
          sendStopCapture: () => this.windowManager.sendToAllWindows(IPC.VOICE_STATE, 'processing'),
          sendTranscription: (text) => this.windowManager.sendToAllWindows(IPC.VOICE_TRANSCRIPTION, text),
          sendAudioPlayback: (b64) => this.windowManager.sendToAllWindows(IPC.VOICE_AGENT_AUDIO, b64),
          sendStateChange: (state) => this.windowManager.sendToAllWindows(IPC.VOICE_STATE, state),
          sendStopPlayback: () => this.windowManager.sendToAllWindows(IPC.VOICE_STOP_PLAYBACK, null),
          sendGenerationDone: () => this.windowManager.sendToAllWindows(IPC.VOICE_GENERATION_DONE, null),
          dispatchStatus: (text: string, level: string) => console.log(`[Voice:${level}] ${text}`),
          cancelStream: () => {},
        }
        this.voiceManager.setTransport(transport)
        await this.voiceManager.init()

        console.log('[Voice] Starting session mode...')
        const inputRouter = this.voiceManager.startSessionMode(this.sessionManager)
        inputRouter.setSubmitMode(configStore.get('voiceSubmitMode') ?? 'auto')
        inputRouter.on('dispatched', (data: { sessionId: string; sessionName: string; text: string }) => {
          console.log('[Voice] Dispatched to session:', data.sessionName, 'text:', data.text.slice(0, 80))
          this.windowManager.sendToAllWindows(IPC.VOICE_DISPATCHED, data)
        })
        inputRouter.on('error', (data: { code: string; message: string }) => {
          console.log('[Voice] InputRouter error:', data.code, data.message)
          this.windowManager.sendToAllWindows(IPC.VOICE_ERROR, data.message)
        })
        inputRouter.on('activeSessionChanged', (sessionId: string | null) => {
          this.windowManager.sendToAllWindows(IPC.VOICE_ACTIVE_SESSION, { sessionId })
        })
        inputRouter.on('notesInsert', (text: string) => {
          this.windowManager.sendToAllWindows(IPC.VOICE_NOTES_INSERT, { text: text.trimEnd() + ' ' })
        })
        inputRouter.on('dialogInsert', (data: { target: string; text: string }) => {
          this.windowManager.sendToAllWindows(IPC.VOICE_DIALOG_INSERT, data)
        })
        inputRouter.on('pinChanged', (data: { pinned: boolean; sessionId: string | null }) => {
          this.windowManager.sendToAllWindows(IPC.VOICE_PIN_STATUS, data)
        })
        inputRouter.on('scroll', (data: { sessionId: string; action: string }) => {
          console.log('[Voice] Scroll command:', data.action, 'session:', data.sessionId)
          this.windowManager.sendToAllWindows(IPC.CELL_SCROLL, {
            sessionId: data.sessionId,
            action: data.action,
          })
        })
        inputRouter.on('gridNav', (data: { direction: string }) => {
          console.log('[Voice] Grid nav:', data.direction)
          this.windowManager.sendToAllWindows(IPC.GRID_NAV, data)
        })
        inputRouter.on('clipboard', (data: { action: string }) => {
          console.log('[Voice] Clipboard command:', data.action)
          this.windowManager.sendToAllWindows(IPC.VOICE_CLIPBOARD, data)
        })
        inputRouter.on('speechInterrupt', () => {
          console.log('[Voice] Speech interrupt — stopping TTS')
          this.voiceManager?.stopSpeech()
        })
        console.log('[Voice] VOICE_START_SESSION => ok')
        this.startBtRemote()
        return { ok: true }
      } catch (err) {
        const msg = (err as Error).message
        if (this.voiceManager && !this.voiceManager.isInitialized()) {
          this.voiceManager.shutdown()
          this.voiceManager = null
        }
        this.windowManager.sendToAllWindows(IPC.VOICE_ERROR, msg)
        return { ok: false, error: msg }
      }
    })

    // ── COM Mode (Voice Companion) ──

    ipcMain.handle(IPC.VOICE_START_COM, async () => {
      console.log('[Voice] VOICE_START_COM handler invoked')
      try {
        // Shut down any existing voice manager
        if (this.voiceManager) {
          this.voiceManager.shutdown()
          this.voiceManager = null as any
        }

        // Create VoiceManager WITH TTS for COM mode
        console.log('[Voice] Creating VoiceManager for COM mode (with TTS)')
        this.voiceManager = new VoiceManager({ skipTTS: false })
        const transport: ConversationTransport = {
          sendStartCapture: () => this.windowManager.sendToAllWindows(IPC.VOICE_STATE, 'recording'),
          sendStopCapture: () => this.windowManager.sendToAllWindows(IPC.VOICE_STATE, 'processing'),
          sendTranscription: (text) => this.windowManager.sendToAllWindows(IPC.VOICE_TRANSCRIPTION, text),
          sendAudioPlayback: (b64) => {
            this.windowManager.sendToAllWindows(IPC.VOICE_AGENT_AUDIO, b64)
            this.windowManager.sendToAllWindows(IPC.VOICE_COM_STATE, 'speaking')
          },
          sendStateChange: (state) => {
            this.windowManager.sendToAllWindows(IPC.VOICE_STATE, state)
            this.windowManager.sendToAllWindows(IPC.VOICE_COM_STATE, state)
          },
          sendStopPlayback: () => this.windowManager.sendToAllWindows(IPC.VOICE_COM_STATE, 'idle'),
          sendGenerationDone: () => this.windowManager.sendToAllWindows(IPC.VOICE_COM_STATE, 'idle'),
          dispatchStatus: (text: string, level: string) => console.log(`[Voice:${level}] ${text}`),
          cancelStream: () => {},
        }
        this.voiceManager.setTransport(transport)
        await this.voiceManager.init()

        // Start session mode (which wires input/output routers)
        console.log('[Voice] Starting session mode for COM...')
        const inputRouter = this.voiceManager.startSessionMode(this.sessionManager)
        inputRouter.on('dispatched', (data: { sessionId: string; sessionName: string; text: string }) => {
          console.log('[Voice] COM dispatched to:', data.sessionName, 'text:', data.text.slice(0, 80))
          this.windowManager.sendToAllWindows(IPC.VOICE_DISPATCHED, data)
        })
        inputRouter.on('error', (data: { code: string; message: string }) => {
          this.windowManager.sendToAllWindows(IPC.VOICE_ERROR, data.message)
        })
        inputRouter.on('scroll', (data: { sessionId: string; action: string }) => {
          this.windowManager.sendToAllWindows(IPC.CELL_SCROLL, {
            sessionId: data.sessionId,
            action: data.action,
          })
        })
        inputRouter.on('gridNav', (data: { direction: string }) => {
          this.windowManager.sendToAllWindows(IPC.GRID_NAV, data)
        })
        inputRouter.on('clipboard', (data: { action: string }) => {
          this.windowManager.sendToAllWindows(IPC.VOICE_CLIPBOARD, data)
        })
        inputRouter.on('dialogInsert', (data: { target: string; text: string }) => {
          this.windowManager.sendToAllWindows(IPC.VOICE_DIALOG_INSERT, data)
        })
        inputRouter.on('speechInterrupt', () => {
          console.log('[Voice] COM speech interrupt — stopping TTS')
          this.voiceManager?.stopSpeech()
        })

        // Start voice-relay entity as background session (no grid placement)
        if (!this.sessionManager.isEntityRunning('voice-relay')) {
          console.log('[Voice] Starting voice-relay entity...')
          const vrSession = await this.sessionManager.startEntity('voice-relay')
          // Queue Claude launch + startup greeting for background entity
          try {
            this.sessionManager.queueEntityClaude('voice-relay', vrSession.id)
            this.sessionManager.scheduleStartupGreeting('voice-relay')
          } catch (err) {
            console.error('[Voice] Failed to queue voice-relay claude:', err)
          }
          // Voice-relay uses mux_tts_speak — no VoiceOutputRouter polling needed
        } else {
          // Already running — no additional setup needed
        }

        this.windowManager.sendToAllWindows(IPC.VOICE_COM_STATE, 'idle')
        console.log('[Voice] VOICE_START_COM => ok')
        this.startBtRemote()
        return { ok: true }
      } catch (err) {
        const msg = (err as Error).message
        console.error('[Voice] VOICE_START_COM error:', msg)
        if (this.voiceManager && !this.voiceManager.isInitialized()) {
          this.voiceManager.shutdown()
          this.voiceManager = null
        }
        this.windowManager.sendToAllWindows(IPC.VOICE_ERROR, msg)
        return { ok: false, error: msg }
      }
    })

    ipcMain.handle(IPC.VOICE_STOP_COM, async () => {
      console.log('[Voice] VOICE_STOP_COM handler invoked')
      this.stopBtRemote()
      try {
        // Stop output routing
        if (this.voiceManager) {
          this.voiceManager.stopOutputRouting()
          this.voiceManager.shutdown()
          this.voiceManager = null
        }
        // Graceful shutdown: send farewell to voice-relay before killing
        if (this.sessionManager.isEntityRunning('voice-relay')) {
          const relaySessionId = this.sessionManager.getEntitySessionId('voice-relay')
          if (relaySessionId) {
            try {
              console.log('[Voice] Sending graceful shutdown to voice-relay...')
              await this.sessionManager.sendKeys(relaySessionId, 'Session wird beendet. Sichere offene Notizen und beende dich.')
              await this.sessionManager.sendKeys(relaySessionId, '\r')
              // Give voice-relay time to process the farewell (max 8s)
              await new Promise(r => setTimeout(r, 8_000))
            } catch (err) {
              console.warn('[Voice] Graceful shutdown message failed:', err)
            }
          }
          await this.sessionManager.stopEntity('voice-relay')
        }
        this.windowManager.sendToAllWindows(IPC.VOICE_COM_STATE, 'idle')
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    })

    ipcMain.on(IPC.VOICE_SET_ROUTING_MODE, (_event, { mode }: { mode: 'session' | 'off' }) => {
      this.voiceManager?.getInputRouter()?.setMode(mode)
      if (mode === 'off') {
        this.stopBtRemote()
      }
    })

    ipcMain.on(IPC.VOICE_SESSION_TARGET, (_event, { sessionId }: { sessionId: string | null }) => {
      this.focusedSessionId = sessionId
      // Only update voice router if focus is on the grid — detached windows
      // set their own focus via onDetachedFocus, and we must not override it
      // with the stale grid-focused session from the renderer.
      const router = this.voiceManager?.getInputRouter()
      if (router && router.getFocusSource() !== 'detached') {
        router.setFocusedSession(sessionId, 'grid')
      }
    })

    // Route STT focus when a detached window gains OS focus
    this.windowManager.onDetachedFocus((type, entityId) => {
      if (type === 'session') {
        this.focusedSessionId = entityId
        this.voiceManager?.getInputRouter()?.setFocusedSession(entityId, 'detached')
      } else if (type === 'note') {
        this.voiceManager?.getInputRouter()?.setNotesEditorFocused(true)
      }
    })

    // Reset STT focus to grid-focused session when main window regains OS focus
    this.windowManager.onMainWindowFocus(() => {
      const router = this.voiceManager?.getInputRouter()
      if (router && router.getFocusSource() === 'detached') {
        router.setFocusedSession(this.focusedSessionId, 'grid')
      }
    })

    ipcMain.on(IPC.VOICE_PIN, (_event, { sessionId }: { sessionId: string | null }) => {
      const router = this.voiceManager?.getInputRouter()
      if (!router) return
      if (sessionId) {
        router.togglePin(sessionId)
      } else {
        router.unpinSession()
      }
      this.windowManager.sendToAllWindows(IPC.VOICE_PIN_STATUS, {
        pinned: router.isPinned(),
        sessionId: router.getPinnedSessionId(),
      })
      this.windowManager.sendToAllWindows(IPC.VOICE_ACTIVE_SESSION, {
        sessionId: router.getActiveSessionId(),
      })
    })

    ipcMain.on(IPC.VOICE_NOTES_FOCUS, (_event, { focused }: { focused: boolean }) => {
      this.voiceManager?.getInputRouter()?.setNotesEditorFocused(focused)
    })

    ipcMain.handle('cipher-mux:tts:stop', () => {
      this.voiceManager?.stopSpeech()
      return { ok: true }
    })

    ipcMain.handle('cipher-mux:tts:speak', async (_e, { text }: { text: string }) => {
      if (!this.voiceManager?.isInitialized()) {
        return { ok: false, error: 'Voice not active' }
      }
      try {
        await this.voiceManager.speakText(text)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    })

    // Voice Catalog
    ipcMain.handle(IPC.VOICE_LIST_INSTALLED, () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- synchroner Kontext
      const { listInstalled } = require('./voice/voice-catalog')
      const piperDir = path.join(os.homedir(), '.config', 'cipher-mux', 'models', 'piper')
      return listInstalled(piperDir)
    })

    ipcMain.handle(IPC.VOICE_CATALOG_SEARCH, async (_e, query?: string) => {
      const { fetchCatalog } = await import('./voice/voice-catalog')
      return fetchCatalog(query)
    })

    ipcMain.handle(IPC.VOICE_DOWNLOAD, async (_e, { name }: { name: string }) => {
      const { downloadVoice } = await import('./voice/voice-downloader')
      const piperDir = path.join(os.homedir(), '.config', 'cipher-mux', 'models', 'piper')
      const { emitter, promise } = downloadVoice(name, piperDir)
      const mainWin = this.windowManager.getMainWindow()
      emitter.on('progress', (progress: any) => {
        mainWin?.webContents.send(IPC.VOICE_DOWNLOAD_PROGRESS, progress)
      })
      try {
        await promise
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    })

    ipcMain.handle(IPC.VOICE_DELETE, (_e, { name }: { name: string }) => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- synchroner Kontext
      const { deleteVoice } = require('./voice/voice-downloader')
      const piperDir = path.join(os.homedir(), '.config', 'cipher-mux', 'models', 'piper')
      try {
        deleteVoice(name, piperDir)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    })

    ipcMain.handle(IPC.VOICE_SET_ACTIVE, async (_e, { name }: { name: string }) => {
      // Hot-swap if VoiceManager is initialized, otherwise just persist
      if (this.voiceManager && (this.voiceManager.isInitialized() || this.voiceManager.isPiperReady())) {
        try {
          await this.voiceManager.swapVoice(name)
          return { ok: true }
        } catch (err) {
          return { ok: false, error: (err as Error).message }
        }
      }
      configStore.set('piperVoice', name)
      return { ok: true }
    })

    ipcMain.handle(IPC.VOICE_PREVIEW, async (_e, { name }: { name: string }) => {
      try {
        const { PiperTTS } = await import('./voice/tts-piper')
        const piperDir = path.join(os.homedir(), '.config', 'cipher-mux', 'models', 'piper')
        const tts = new PiperTTS({ voice: name, modelsDir: piperDir })
        await tts.init()
        const text = 'Dies ist eine Vorschau der Stimme.'
        for await (const chunk of tts.speak(text)) {
          this.windowManager.sendToAllWindows(IPC.VOICE_AGENT_AUDIO, chunk.toString('base64'))
        }
        tts.shutdown()
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    })

    ipcMain.handle(IPC.VOICE_RECOMMEND_DOWNLOADS, () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- synchroner Kontext
      const { getRecommendedDownloads } = require('./setup/voice-bundle')
      return getRecommendedDownloads()
    })
  }

  // ─── Tasks ────────────────────────────────────────────
  private registerTaskChannels(): void {
    if (!this.taskManager) return

    ipcMain.handle(IPC.TASKS_LIST, async (_e, filter?: any) => {
      return this.taskManager!.list(filter)
    })

    ipcMain.handle(IPC.TASKS_GET, async (_e, { id }: { id: string }) => {
      const task = this.taskManager!.get(id)
      if (!task) return { task: null, children: [] }
      const children = this.taskManager!.children(id)
      return { task, children }
    })

    ipcMain.handle(IPC.TASKS_RETRY, async (_e, { id }: { id: string }) => {
      return this.taskManager!.retry(id)
    })

    ipcMain.handle(IPC.TASKS_CANCEL, async (_e, { id }: { id: string }) => {
      return this.taskManager!.markFailed(id, { error: 'cancelled by user' })
    })
  }


  // ─── Personas ─────────────────────────────────────────
  private registerPersonaChannels(): void {
    ipcMain.handle(IPC.PERSONAS_LIST, () => {
      return configStore.get('personas')
    })

    ipcMain.handle(IPC.PERSONAS_SAVE, (_e, persona: Persona) => {
      const personas = [...configStore.get('personas')]
      const idx = personas.findIndex(p => p.id === persona.id)
      if (idx >= 0) {
        // Preserve builtin flag — users can't promote/demote
        personas[idx] = { ...persona, builtin: personas[idx].builtin }
      } else {
        personas.push({ ...persona, builtin: false })
      }
      configStore.set('personas', personas)
      return { ok: true }
    })

    ipcMain.handle(IPC.PERSONAS_DELETE, (_e, personaId: string) => {
      const personas = configStore.get('personas')
      const target = personas.find(p => p.id === personaId)
      if (target?.builtin) return { ok: false, error: 'Cannot delete built-in persona' }
      configStore.set('personas', personas.filter(p => p.id !== personaId))
      return { ok: true }
    })
  }

  // ─── Characters (Companion Persona) ──────────────────
  private registerCharacterChannels(): void {
    ipcMain.handle(IPC.CHARACTERS_LIST, () => {
      return configStore.get('characters')
    })

    ipcMain.handle(IPC.CHARACTERS_ACTIVE, () => {
      const activeId = configStore.get('activeCharacterId')
      const characters = configStore.get('characters')
      return characters.find(c => c.id === activeId) ?? characters[0] ?? null
    })

    ipcMain.handle(IPC.CHARACTERS_SAVE, (_e, character: Character) => {
      const characters = [...configStore.get('characters')]
      const idx = characters.findIndex(c => c.id === character.id)
      const now = new Date().toISOString()
      if (idx >= 0) {
        characters[idx] = { ...character, updatedAt: now }
      } else {
        characters.push({ ...character, isDefault: false, createdAt: now, updatedAt: now })
      }
      configStore.set('characters', characters)
      // Re-sync skill for active character
      const activeId = configStore.get('activeCharacterId')
      if (character.id === activeId) {
        this.syncActiveCharacterSkill()
      }
      return { ok: true }
    })

    ipcMain.handle(IPC.CHARACTERS_DELETE, (_e, characterId: string) => {
      const characters = configStore.get('characters')
      const target = characters.find(c => c.id === characterId)
      if (!target) return { ok: false, error: 'Character not found' }
      if (target.isDefault) return { ok: false, error: 'Cannot delete default character' }
      configStore.set('characters', characters.filter(c => c.id !== characterId))
      // If deleted character was active, switch to default
      if (configStore.get('activeCharacterId') === characterId) {
        const defaultChar = configStore.get('characters').find(c => c.isDefault)
        if (defaultChar) {
          configStore.set('activeCharacterId', defaultChar.id)
          this.syncActiveCharacterSkill()
        }
      }
      return { ok: true }
    })

    ipcMain.handle(IPC.CHARACTERS_SWITCH, (_e, characterId: string) => {
      const characters = configStore.get('characters')
      const target = characters.find(c => c.id === characterId)
      if (!target) return { ok: false, error: 'Character not found' }
      configStore.set('activeCharacterId', characterId)
      this.syncActiveCharacterSkill()
      return { ok: true }
    })

    ipcMain.handle(IPC.CHARACTERS_GLOBAL_PERSONA_GET, () => {
      return configStore.get('globalActivePersonaId')
    })

    ipcMain.handle(IPC.CHARACTERS_GLOBAL_PERSONA_SET, (_e, personaId: string | null) => {
      configStore.set('globalActivePersonaId', personaId)
      return { ok: true }
    })

    ipcMain.handle(IPC.ENTITY_PERSONA_OVERRIDE_GET, (_e, entityId: string) => {
      const overrides = configStore.get('entityPersonaOverrides') ?? {}
      return overrides[entityId] ?? null
    })

    ipcMain.handle(IPC.ENTITY_PERSONA_OVERRIDE_SET, (_e, entityId: string, characterId: string | null) => {
      const overrides = { ...(configStore.get('entityPersonaOverrides') ?? {}) }
      if (characterId) {
        overrides[entityId] = characterId
      } else {
        delete overrides[entityId]
      }
      configStore.set('entityPersonaOverrides', overrides)
      return { ok: true }
    })

    // ─── Welche CLI startet was ──────────────────────────────
    //
    // Die Auflösung ist alt, der Weg sie zu setzen ist neu. Reihenfolge wie beim
    // Modell: `app.entityAdapters` pro Rolle > Rollen-Default > `agent.defaultAdapter`.

    ipcMain.handle(IPC.AGENT_ADAPTERS_LIST, () => {
      return this.adapterRegistry.listIds().map(id => {
        const a = this.adapterRegistry.get(id)
        return {
          id,
          displayName: a?.displayName ?? id,
          tier: a?.tier ?? 'tier-2',
          // Die UI zeigt damit, was eine Rolle unter dieser CLI *nicht* kann,
          // statt es den Nutzer beim Start herausfinden zu lassen.
          capabilities: a?.getCapabilities() ?? null,
        }
      })
    })

    ipcMain.handle(IPC.AGENT_DEFAULT_ADAPTER_GET, () => {
      return configStore.get('agent').defaultAdapter ?? 'claude-code'
    })

    ipcMain.handle(IPC.AGENT_DEFAULT_ADAPTER_SET, (_e, adapterId: string) => {
      if (!this.adapterRegistry.get(adapterId)) {
        return { ok: false, error: `Unbekannter Adapter: ${adapterId}` }
      }
      configStore.set('agent', { ...configStore.get('agent'), defaultAdapter: adapterId })
      // Sofort wirksam, nicht erst beim naechsten App-Start: der Registry-Default
      // wird hier mitgesetzt. Ohne das waere der Schalter ein Versprechen auf
      // spaeter, und der Nutzer sieht nicht, dass seine Auswahl noch nicht gilt.
      this.adapterRegistry.setDefault(adapterId)
      return { ok: true }
    })

    ipcMain.handle(IPC.ENTITY_ADAPTER_GET, (_e, entityId: string) => {
      return readEntityOverride(configStore.get('app').entityAdapters, entityId)
    })

    // Modellliste pro Adapter. Zwischengespeichert fuer die Laufzeit der App:
    // `codex debug models` und `opencode models` starten je einen Unterprozess,
    // und ein Dropdown, das beim Aufklappen eine Sekunde haengt, benutzt niemand.
    // Die Liste kann sich aendern (opencode zeigt nur angemeldete Anbieter) —
    // ein Neustart holt sie neu, und das ist die ehrlichere Grenze als ein
    // Zwischenspeicher, der raet, wann er veraltet ist.
    const modelCache = new Map<string, Array<{ id: string; label: string; contextWindow?: number; description?: string }>>()
    ipcMain.handle(IPC.AGENT_MODELS_LIST, async (_e, adapterId: string) => {
      const cached = modelCache.get(adapterId)
      if (cached) return cached
      const adapter = this.adapterRegistry.get(adapterId)
      if (!adapter?.listModels) return []
      try {
        const models = await adapter.listModels()
        modelCache.set(adapterId, models)
        return models
      } catch (err) {
        // Eine fehlende Liste ist kein Fehlerfall fuer den Nutzer: er tippt
        // den Modellnamen eben selbst. Ein Wurf hier waere ein roter Dialog
        // fuer etwas, das die Arbeit nicht aufhaelt.
        console.warn(`[IpcHub] Modellliste fuer '${adapterId}' nicht abrufbar:`, err)
        return []
      }
    })

    ipcMain.handle(IPC.PRESET_TEMPLATE_STATUS, (_e, entityId: string) => {
      // Nur erkennen, nicht reparieren. Automatisch zu ueberschreiben waere
      // genau das, was write-once verhindern soll; ein Dialog beim Sessionstart
      // waere wieder etwas, das eine unbeaufsichtigte Session aufhaelt.
      const template = presetTemplateFor(entityId)
      if (template === null) return null
      try {
        const file = path.join(os.homedir(), '.config', BRAND.appName, 'entities', entityId, 'preset.md')
        return comparePresetVersion(fs.readFileSync(file, 'utf-8'), template)
      } catch {
        // Keine Datei heisst: die Rolle lief noch nie. Dann gibt es auch keinen
        // Rueckstand -- sie bekommt beim ersten Start die aktuelle Vorlage.
        return null
      }
    })

    ipcMain.handle(IPC.PRESET_TEMPLATE_APPLY, (_e, entityId: string) => {
      // Der Gegenpart zu PRESET_TEMPLATE_STATUS: dort wird der Rueckstand
      // gemeldet, hier wird er auf Knopfdruck aufgeloest. Nie von selbst --
      // write-once schuetzt Handarbeit, und diese Funktion hebt den Schutz
      // bewusst auf. Deshalb zuerst die Sicherung, dann der Schreibvorgang:
      // was nicht gesichert ist, ist nach dem Schreiben nicht mehr zu holen.
      const template = presetTemplateFor(entityId)
      if (template === null) return { ok: false, error: 'Diese Rolle hat keine Code-Vorlage.' }
      const file = path.join(os.homedir(), '.config', BRAND.appName, 'entities', entityId, 'preset.md')
      try {
        const current = fs.readFileSync(file, 'utf-8')
        if (current === template) return { ok: true, backupPath: null, unchanged: true }
        const backupPath = presetBackupPath(file, new Date())
        fs.writeFileSync(backupPath, current, 'utf-8')
        fs.writeFileSync(file, template, 'utf-8')
        console.log(`[IpcHub] preset.md fuer '${entityId}' aus der Vorlage ersetzt, Sicherung: ${backupPath}`)
        return { ok: true, backupPath }
      } catch (err) {
        // Keine Datei heisst: die Rolle lief noch nie. Dann ist nichts zu
        // reparieren, und sie bekommt beim ersten Start die aktuelle Vorlage.
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`[IpcHub] preset.md fuer '${entityId}' nicht ersetzbar:`, msg)
        return { ok: false, error: msg }
      }
    })

    ipcMain.handle(IPC.ENTITY_MODEL_GET, (_e, entityId: string) => {
      return readEntityOverride(configStore.get('app').entityModels, entityId)
    })

    ipcMain.handle(IPC.ENTITY_MODEL_SET, (_e, entityId: string, model: string | null) => {
      // Kein Abgleich gegen die Liste: alle drei CLIs nehmen auch einen vollen
      // Modellnamen, der nicht darin steht. Eine Pruefung hier wuerde genau die
      // Faelle abweisen, fuer die das Freitextfeld da ist.
      const app = { ...configStore.get('app') }
      app.entityModels = withEntityOverride(app.entityModels, entityId, model)
      configStore.set('app', app)
      return { ok: true }
    })

    ipcMain.handle(IPC.ENTITY_ADAPTER_SET, (_e, entityId: string, adapterId: string | null) => {
      if (adapterId && !this.adapterRegistry.get(adapterId)) {
        return { ok: false, error: `Unbekannter Adapter: ${adapterId}` }
      }
      const app = { ...configStore.get('app') }
      // Die Drei-Zustands-Disziplin steckt in `withEntityAdapter` — dort ist sie
      // pruefbar, statt hier als Handler-Rumpf nur beim Hinsehen in der App.
      app.entityAdapters = withEntityOverride(app.entityAdapters, entityId, adapterId)
      configStore.set('app', app)
      return { ok: true }
    })
  }

  /** Sync the active character's prompt as a SKILL.md to all project skills directories. */
  private syncActiveCharacterSkill(): void {
    const activeId = configStore.get('activeCharacterId')
    const characters = configStore.get('characters')
    const active = characters.find(c => c.id === activeId)
    if (!active) return

    // eslint-disable-next-line @typescript-eslint/no-require-imports -- synchrones Lazy-Load, CommonJS-Ziel
    const { syncCharacterSkill } = require('./workspace/persona-skill-sync')
    // Sync to the app-level skills dir
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- synchrones Lazy-Load, CommonJS-Ziel
    const os = require('os')
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- synchrones Lazy-Load, CommonJS-Ziel
    const path = require('path')
    const skillsDir = path.join(os.homedir(), '.claude', 'skills', 'personas')
    syncCharacterSkill(active, skillsDir)
  }

  // ─── Workspaces ───────────────────────────────────────
  private registerWorkspaceChannels(): void {
    // Migration: defaultWorkspaceId → activeWorkspaceId (one-time)
    const defaultWsId = configStore.get('defaultWorkspaceId')
    if (defaultWsId && !configStore.get('activeWorkspaceId')) {
      console.log(`[IpcHub] Migrating defaultWorkspaceId → activeWorkspaceId: "${defaultWsId}"`)
      configStore.set('activeWorkspaceId', defaultWsId)
    }

    ipcMain.handle(IPC.WORKSPACES_LIST, () => {
      const workspaces = configStore.get('workspaces') ?? []
      const activeId = configStore.get('activeWorkspaceId')
      // Sort: active workspace first, then by sortOrder (lower first), then by name
      return [...workspaces].sort((a: Workspace, b: Workspace) => {
        if (a.id === activeId && b.id !== activeId) return -1
        if (b.id === activeId && a.id !== activeId) return 1
        const aSort = a.sortOrder ?? 100
        const bSort = b.sortOrder ?? 100
        if (aSort !== bSort) return aSort - bSort
        return (a.name ?? '').localeCompare(b.name ?? '')
      })
    })

    ipcMain.handle(IPC.WORKSPACES_SAVE, (_e, workspace: Workspace) => {
      const workspaces = [...configStore.get('workspaces')]
      const idx = workspaces.findIndex(w => w.id === workspace.id)
      if (idx >= 0) workspaces[idx] = workspace
      else workspaces.push(workspace)
      configStore.set('workspaces', workspaces)
      this.windowManager.sendToAllWindows(IPC.WORKSPACES_CHANGED, { reason: 'save', id: workspace.id })
      return { ok: true }
    })

    ipcMain.handle(IPC.WORKSPACES_DELETE, (_e, workspaceId: string) => {
      const workspaces = configStore.get('workspaces')
      configStore.set('workspaces', workspaces.filter(w => w.id !== workspaceId))
      this.windowManager.sendToAllWindows(IPC.WORKSPACES_CHANGED, { reason: 'delete', id: workspaceId })
      return { ok: true }
    })

    ipcMain.handle(IPC.WORKSPACES_APPLY, async (_e, workspaceId: string) => {
      const workspaces = configStore.get('workspaces')
      const ws = workspaces.find(w => w.id === workspaceId)
      if (!ws) return { applied: false, sessionsStarted: 0, warnings: ['Workspace not found'] }

      // Teardown: gracefully stop all existing sessions before applying
      const existing = this.sessionManager.list()
      if (existing.length > 0) {
        console.log(`[IpcHub] WORKSPACES_APPLY: tearing down ${existing.length} existing session(s)`)
        await Promise.allSettled(
          existing.map(s => this.sessionManager.gracefulStop(s.id, 30_000))
        )
      }

      const personas = configStore.get('personas')
      const result = await applyWorkspace(ws, personas, this.sessionManager, (cols, rows) => {
        this.windowManager.sendToMainWindow(IPC.SESSION_CHANGED, { gridResize: { cols, rows } })
      })

      // Entity-launch: queue Claude + startup greeting for entity sessions
      for (const s of result.sessions) {
        if (s.entityId) {
          try {
            this.sessionManager.queueEntityClaude(s.entityId as EntityId, s.sessionId)
            this.sessionManager.scheduleStartupGreeting(s.entityId as EntityId)
          } catch (err) {
            console.error(`[IpcHub] Failed to queue entity "${s.entityId}" claude:`, err)
          }
        }
      }

      configStore.set('activeWorkspaceId', workspaceId)
      return result
    })

    ipcMain.handle(IPC.WORKSPACES_ACTIVE, (_e, id?: string) => {
      if (id !== undefined) {
        configStore.set('activeWorkspaceId', id)
      }
      return configStore.get('activeWorkspaceId')
    })
  }

  // ─── Notes ─────────────────────────────────────────────
  private registerNoteChannels(): void {
    ipcMain.handle(IPC.NOTES_LIST, async () => {
      try {
        return await this.noteManager.list()
      } catch (err) {
        console.error('[IpcHub] NOTES_LIST failed:', err)
        return []
      }
    })

    ipcMain.handle(IPC.NOTES_READ, async (_e, { id }: { id: string }) => {
      return this.noteManager.read(id)
    })

    ipcMain.handle(IPC.NOTES_SAVE, async (_e, { id, body, tags, skipTagging }: {
      id: string; body: string; tags?: string[]; skipTagging?: boolean
    }) => {
      // REQ-NOTES-008: re-merge workspace scope tag + defaultTags so auto-tagging doesn't drop them
      let effectiveTags = tags
      if (effectiveTags) {
        const ws = getActiveWorkspace()
        if (ws) {
          // notesGlobal: skip workspace scope tag so note stays visible in all workspaces
          if (!ws.notesGlobal) {
            effectiveTags = [...effectiveTags, `workspace:${ws.name ?? ws.id}`]
          }
          if (ws.defaultTags?.length) {
            const tagSet = new Set([...effectiveTags, ...ws.defaultTags])
            effectiveTags = [...tagSet]
          }
        }
      }
      // Resolve synonyms before saving
      if (effectiveTags) {
        effectiveTags = this.tagClassRepo.resolveSynonyms(effectiveTags)
      }
      this.noteWatcher.suppressNext(id)
      const note = await this.noteManager.save(id, body, effectiveTags)
      // Update search index + tag index
      this.noteSearchIndex.addOrUpdate({ info: note, body })
      this.tagIndex.updateNote(note.id, note.tags)
      this.tagClassRepo.ensureTags(note.tags)
      this.windowManager.sendToAllWindows(IPC.NOTES_CHANGED, { action: 'updated', note })
      // Async auto-tagging (fire-and-forget, only on manual Cmd+S save)
      if (!tags && !skipTagging) {
        this.noteTagging.autoTag(body).then(async (autoTags) => {
          if (autoTags && autoTags.length > 0) {
            // Keep what carries meaning. The list used to name exactly one
            // type, kind:testcase, which was right while that was the only
            // typed note — and wrong the moment a second existed. See
            // note-type-tags.ts.
            const merged = preserveTypeTags(note.tags ?? [], autoTags)
            await this.noteTagging.updateRepository(autoTags)
            const updated = await this.noteManager.save(id, body, merged)
            this.noteSearchIndex.addOrUpdate({ info: updated, body })
            this.tagIndex.updateNote(updated.id, updated.tags)
            this.tagClassRepo.ensureTags(updated.tags)
            this.windowManager.sendToAllWindows(IPC.NOTES_CHANGED, { action: 'tagged', note: updated })
          }
        }).catch(() => { /* Ollama not available — ignore */ })
      }
      return note
    })

    ipcMain.handle(IPC.NOTES_CREATE, async (_e, { title, body, tags }: {
      title: string; body: string; tags?: string[]
    }) => {
      // REQ-NOTES-007: Tag limit — max 5 manual tags (workspace defaults don't count)
      const manualTags = tags ?? []
      const tagLimitExceeded = manualTags.length > MAX_MANUAL_TAGS
      if (tagLimitExceeded) {
        console.warn(`[IpcHub] NOTES_CREATE: ${manualTags.length} manual tags exceed limit of ${MAX_MANUAL_TAGS}`)
      }

      // P.2: auto-apply workspace scope tag + defaultTags when workspace is active
      let mergedTags = manualTags
      const ws = getActiveWorkspace()
      if (ws) {
        // notesGlobal: skip workspace scope tag so note is visible in all workspaces
        if (!ws.notesGlobal) {
          mergedTags = [...mergedTags, `workspace:${ws.name ?? ws.id}`]
        }
        if (ws.defaultTags?.length) {
          const tagSet = new Set([...mergedTags, ...ws.defaultTags])
          mergedTags = [...tagSet]
        }
      }
      // Resolve synonyms before creating
      mergedTags = this.tagClassRepo.resolveSynonyms(mergedTags)
      const note = await this.noteManager.create(title, body, mergedTags.length > 0 ? mergedTags : undefined)
      // Update search index + tag index
      const fullBody = body.startsWith('# ') ? body : `# ${title}\n\n${body}`
      this.noteSearchIndex.addOrUpdate({ info: note, body: fullBody })
      this.tagIndex.addNote(note.id, note.tags)
      this.tagClassRepo.ensureTags(note.tags)
      this.windowManager.sendToAllWindows(IPC.NOTES_CHANGED, { action: 'created', note })
      return note
    })

    ipcMain.handle(IPC.NOTES_DELETE, async (_e, { id }: { id: string }) => {
      this.noteWatcher.suppressNext(id)
      const ok = await this.noteManager.delete(id)
      if (ok) {
        this.noteSearchIndex.remove(id)
        this.tagIndex.removeNote(id)
        this.windowManager.sendToAllWindows(IPC.NOTES_CHANGED, { action: 'deleted', id })
      }
      return { ok }
    })

    // REQ-NOTES-006: Trash (soft delete with undo)
    ipcMain.handle(IPC.NOTES_TRASH, async (_e, { id }: { id: string }) => {
      this.noteWatcher.suppressNext(id)
      const ok = await this.noteManager.trash(id)
      if (ok) {
        this.noteSearchIndex.remove(id)
        this.tagIndex.removeNote(id)
        this.windowManager.sendToAllWindows(IPC.NOTES_CHANGED, { action: 'deleted', id })
      }
      return { ok }
    })

    ipcMain.handle(IPC.NOTES_TRASH_MANY, async (_e, { ids }: { ids: string[] }) => {
      const trashed = await this.noteManager.trashMany(ids)
      for (const id of trashed) {
        this.noteSearchIndex.remove(id)
        this.tagIndex.removeNote(id)
      }
      if (trashed.length > 0) {
        this.windowManager.sendToAllWindows(IPC.NOTES_CHANGED, { action: 'deleted', ids: trashed })
      }
      return { trashed }
    })

    ipcMain.handle(IPC.NOTES_RESTORE, async (_e, { id }: { id: string }) => {
      const ok = await this.noteManager.restore(id)
      if (ok) {
        this.windowManager.sendToAllWindows(IPC.NOTES_CHANGED, { action: 'restored', id })
      }
      return { ok }
    })

    ipcMain.handle(IPC.NOTES_RESTORE_MANY, async (_e, { ids }: { ids: string[] }) => {
      const restored = await this.noteManager.restoreMany(ids)
      if (restored.length > 0) {
        this.windowManager.sendToAllWindows(IPC.NOTES_CHANGED, { action: 'restored', ids: restored })
      }
      return { restored }
    })

    // REQ-NOTES-005: Bulk tagging
    ipcMain.handle(IPC.NOTES_BULK_TAG_ADD, async (_e, { ids, tag }: { ids: string[]; tag: string }) => {
      const resolvedTag = this.tagClassRepo.resolveSynonym(tag)
      const updated = await this.noteManager.bulkAddTag(ids, resolvedTag, MAX_MANUAL_TAGS)
      if (updated.length > 0) {
        this.tagClassRepo.ensureTag(resolvedTag)
        this.windowManager.sendToAllWindows(IPC.NOTES_CHANGED, { action: 'updated', ids: updated })
      }
      return { updated }
    })

    ipcMain.handle(IPC.NOTES_BULK_TAG_REMOVE, async (_e, { ids, tag }: { ids: string[]; tag: string }) => {
      // REQ-NOTES-008: protect workspace scope tag + default tags from removal
      const ws = getActiveWorkspace()
      if (ws && tag === `workspace:${ws.name ?? ws.id}`) {
        return { updated: [], blocked: true }
      }
      if (ws?.defaultTags?.includes(tag)) {
        return { updated: [], blocked: true }
      }
      const updated = await this.noteManager.bulkRemoveTag(ids, tag)
      if (updated.length > 0) {
        this.windowManager.sendToAllWindows(IPC.NOTES_CHANGED, { action: 'updated', ids: updated })
      }
      return { updated }
    })

    ipcMain.handle(IPC.NOTES_SEARCH, async (_e, { query, tags }: { query: string; tags?: string[] }) => {
      let results = this.noteSearchIndex.search(query)
      // Apply tag filter if provided
      if (tags && tags.length > 0) {
        const tagSet = new Set(tags.map(t => t.toLowerCase()))
        results = results.filter(r => r.info.tags.some(t => tagSet.has(t.toLowerCase())))
      }
      return results
    })

    // Screenshot capture for testcase items (macOS screencapture -i)
    ipcMain.handle(IPC.NOTES_SCREENSHOT, async (_e, { noteId, itemId }: { noteId: string; itemId: string }) => {
      const { execFileSync } = await import('child_process')
      const fsNode = await import('fs')
      const pathNode = await import('path')
      const screenshotDir = pathNode.join(this.noteManager['notesDir'], 'screenshots', noteId)
      fsNode.mkdirSync(screenshotDir, { recursive: true })
      const timestamp = Date.now()
      const filePath = pathNode.join(screenshotDir, `${itemId}-${timestamp}.png`)
      try {
        // Interactive region selection → file (no clipboard permission needed)
        execFileSync('screencapture', ['-i', filePath], { timeout: 30000 })
        if (fsNode.existsSync(filePath)) {
          return { path: filePath }
        }
        return null
      } catch {
        return null
      }
    })

    // Parse a testcase note in main process (where gray-matter is available)
    ipcMain.handle(IPC.NOTES_PARSE_TESTCASE, async (_e, { id }: { id: string }) => {
      try {
        const result = await this.noteManager.read(id)
        if (!result || !result.info.tags?.includes('kind:testcase')) return null
        const { parseTestcase } = await import('./notes/testcase-parser')
        // Read raw file to get frontmatter intact for parser
        const fsNode = await import('fs')
        const pathNode = await import('path')
        const rawPath = pathNode.join(this.noteManager['notesDir'], `${id}.md`)
        const raw = fsNode.readFileSync(rawPath, 'utf-8')
        return parseTestcase(raw) ?? null
      } catch (err) {
        console.error('[IpcHub] NOTES_PARSE_TESTCASE failed:', err)
        return null
      }
    })

    // Mirror status: drift plus history for a note that mirrors a file.
    // Computed here, never stored — a stored answer goes stale the moment it
    // is written, which is the whole reason the mirror carries a commit.
    ipcMain.handle(IPC.NOTES_MIRROR_STATUS, async (_e, { id }: { id: string }) => {
      try {
        const note = await this.noteManager.read(id)
        if (!note?.info.mirrorsFile || !note.info.anchorRepo) return null
        const { computeMirrorDrift, formatMirrorDrift, mirrorHistory } = await import('./notes/mirror-drift')
        const [drift, history] = await Promise.all([
          computeMirrorDrift({
            repoPath: note.info.anchorRepo,
            filePath: note.info.mirrorsFile,
            mirrorCommit: note.info.mirrorCommit ?? null,
          }),
          mirrorHistory({ repoPath: note.info.anchorRepo, filePath: note.info.mirrorsFile }),
        ])
        return { drift, summary: formatMirrorDrift(drift).split('\n')[0], history }
      } catch (err) {
        console.error('[IpcHub] NOTES_MIRROR_STATUS failed:', err)
        return null
      }
    })

    // Pull the mirror back from git. Deliberately an explicit action: the note
    // is a work surface, and an unincorporated correction would be overwritten.
    ipcMain.handle(IPC.NOTES_MIRROR_REFRESH, async (_e, { id }: { id: string }) => {
      try {
        const result = await this.noteManager.refreshMirror(id)
        if (result.ok && result.note) {
          this.windowManager.sendToAllWindows(IPC.NOTES_CHANGED, { action: 'updated', note: result.note })
        }
        return result
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, problems: [message] }
      }
    })

    // Outline of a spec note: its headings, derived not maintained.
    ipcMain.handle(IPC.NOTES_SPEC_OUTLINE, async (_e, { id }: { id: string }) => {
      try {
        const note = await this.noteManager.read(id)
        if (!note) return []
        const { buildSpecOutline } = await import('./notes/spec-outline')
        return buildSpecOutline(note.body)
      } catch (err) {
        console.error('[IpcHub] NOTES_SPEC_OUTLINE failed:', err)
        return []
      }
    })

    // Anforderungen lesen und zurueckschreiben — gleiche Form wie Befunde
    ipcMain.handle(IPC.NOTES_PARSE_REQUIREMENTS, async (_e, { id }: { id: string }) => {
      try {
        const result = await this.noteManager.read(id)
        if (!result || !result.info.tags?.includes('kind:requirements')) return null
        const { parseRequirements } = await import('./notes/requirements-parser')
        const fsNode = await import('fs')
        const pathNode = await import('path')
        const raw = fsNode.readFileSync(
          pathNode.join(this.noteManager.getNotesDir(), `${id}.md`), 'utf-8',
        )
        return parseRequirements(raw) ?? null
      } catch (err) {
        console.error('[IpcHub] NOTES_PARSE_REQUIREMENTS failed:', err)
        return null
      }
    })

    ipcMain.handle(IPC.NOTES_SERIALIZE_REQUIREMENTS, async (_e, { sections }: { sections: Array<{ title: string; items: unknown[] }> }) => {
      try {
        const { serializeRequirementItem } = await import('./notes/requirements-parser')
        const lines: string[] = []
        for (const section of sections) {
          if (section.title && section.title !== 'Allgemein') lines.push(`## ${section.title}`, '')
          for (const item of section.items) lines.push(serializeRequirementItem(item as never))
          lines.push('')
        }
        return lines.join('\n').trimEnd() + '\n'
      } catch (err) {
        console.error('[IpcHub] NOTES_SERIALIZE_REQUIREMENTS failed:', err)
        return null
      }
    })

    // Parse a finding note in main process — same shape as the testcase path
    ipcMain.handle(IPC.NOTES_PARSE_FINDING, async (_e, { id }: { id: string }) => {
      try {
        const result = await this.noteManager.read(id)
        if (!result || !result.info.tags?.includes('kind:finding')) return null
        const { parseFinding } = await import('./notes/finding-parser')
        const fsNode = await import('fs')
        const pathNode = await import('path')
        const rawPath = pathNode.join(this.noteManager.getNotesDir(), `${id}.md`)
        const raw = fsNode.readFileSync(rawPath, 'utf-8')
        return parseFinding(raw) ?? null
      } catch (err) {
        console.error('[IpcHub] NOTES_PARSE_FINDING failed:', err)
        return null
      }
    })

    // Serialize finding sections back to a markdown body
    ipcMain.handle(IPC.NOTES_SERIALIZE_FINDING, async (_e, { sections }: { sections: Array<{ title: string; items: unknown[] }> }) => {
      try {
        const { serializeFindingItem } = await import('./notes/finding-parser')
        const lines: string[] = []
        for (const section of sections) {
          if (section.title && section.title !== 'Allgemein') {
            lines.push(`## ${section.title}`, '')
          }
          for (const item of section.items) {
            lines.push(serializeFindingItem(item as never))
          }
          lines.push('')
        }
        return lines.join('\n').trimEnd() + '\n'
      } catch (err) {
        console.error('[IpcHub] NOTES_SERIALIZE_FINDING failed:', err)
        return null
      }
    })

    // Serialize testcase sections back to markdown body (main process)
    ipcMain.handle(IPC.NOTES_SERIALIZE_TESTCASE, async (_e, { sections }: { sections: TestcaseSection[] }) => {
      try {
        const { serializeTestcaseBody } = await import('./notes/testcase-parser')
        return serializeTestcaseBody(sections)
      } catch (err) {
        console.error('[IpcHub] NOTES_SERIALIZE_TESTCASE failed:', err)
        return null
      }
    })

    ipcMain.handle(IPC.NOTES_TAGS, async () => {
      return this.noteTagging.getTagRepository()
    })

    ipcMain.handle(IPC.NOTES_TAG_LIST, async () => {
      this.noteTagging.recountTags()
      const repo = this.noteTagging.getTagRepository()
      const tags = Object.entries(repo.tags).map(([name, entry]) => ({
        name,
        count: entry.count,
        description: entry.description,
        isSeed: this.noteTagging.isSeedTag(name),
      }))
      return tags
    })

    ipcMain.handle(IPC.NOTES_TAG_CREATE, async (_e, { name, description }: { name: string; description: string }) => {
      const ok = this.noteTagging.createTag(name, description)
      return { ok }
    })

    ipcMain.handle(IPC.NOTES_TAG_RENAME, async (_e, { oldName, newName }: { oldName: string; newName: string }) => {
      const affected = this.noteTagging.renameTag(oldName, newName)
      if (affected.length > 0) {
        this.windowManager.sendToAllWindows(IPC.NOTES_CHANGED, { action: 'tags-updated' })
      }
      return { ok: affected.length >= 0, affected: affected.length }
    })

    ipcMain.handle(IPC.NOTES_TAG_UPDATE, async (_e, { name, description }: { name: string; description: string }) => {
      const ok = this.noteTagging.updateTagDescription(name, description)
      return { ok }
    })

    ipcMain.handle(IPC.NOTES_TAG_DELETE, async (_e, { name }: { name: string }) => {
      const affected = this.noteTagging.deleteTag(name)
      // Also remove value from class repo so it doesn't reappear in UI
      const parsed = TagClassRepo.parseTag(name)
      if (parsed.tagClass) {
        this.tagClassRepo.removeValue(parsed.tagClass, parsed.value)
      }
      if (affected.length > 0 || parsed.tagClass) {
        this.tagIndex.rebuild()
        this.windowManager.sendToAllWindows(IPC.NOTES_CHANGED, { action: 'tags-updated' })
      }
      return { ok: true, affected: affected.length }
    })

    ipcMain.handle(IPC.NOTES_TAG_MERGE, async (_e, { sources, target }: { sources: string[]; target: string }) => {
      const result = this.noteTagging.mergeTags(sources, target)
      if (result.affected > 0) {
        this.tagIndex.rebuild()
        this.windowManager.sendToAllWindows(IPC.NOTES_CHANGED, { action: 'tags-updated' })
      }
      return result
    })

    // Tag Class Repository (REQ-NOTES-010)
    ipcMain.handle(IPC.NOTES_TAG_CLASS_REPO, async () => {
      return this.tagClassRepo.getRepository()
    })

    // Tag Class CRUD
    ipcMain.handle(IPC.NOTES_TAG_CLASS_CREATE, async (_e, { name, color }: { name: string; color: string }) => {
      const ok = this.tagClassRepo.createClass(name, color)
      if (ok) {
        this.windowManager.sendToAllWindows(IPC.NOTES_CHANGED, { action: 'tags-updated' })
      }
      return { ok }
    })

    ipcMain.handle(IPC.NOTES_TAG_CLASS_RENAME, async (_e, { oldName, newName }: { oldName: string; newName: string }) => {
      const ok = this.tagClassRepo.renameClass(oldName, newName)
      if (ok) {
        this.tagIndex.rebuild()
        this.windowManager.sendToAllWindows(IPC.NOTES_CHANGED, { action: 'tags-updated' })
      }
      return { ok }
    })

    ipcMain.handle(IPC.NOTES_TAG_CLASS_DELETE, async (_e, { name }: { name: string }) => {
      const ok = this.tagClassRepo.deleteClass(name)
      if (ok) {
        this.windowManager.sendToAllWindows(IPC.NOTES_CHANGED, { action: 'tags-updated' })
      }
      return { ok }
    })

    ipcMain.handle(IPC.NOTES_TAG_CLASS_SET_COLOR, async (_e, { name, color }: { name: string; color: string }) => {
      this.tagClassRepo.setClassColor(name, color)
      this.windowManager.sendToAllWindows(IPC.NOTES_CHANGED, { action: 'tags-updated' })
      return { ok: true }
    })

    ipcMain.handle(IPC.NOTES_TAG_CLASS_ADD_VALUE, async (_e, { className, value }: { className: string; value: string }) => {
      const ok = this.tagClassRepo.addValue(className, value)
      if (ok) {
        this.windowManager.sendToAllWindows(IPC.NOTES_CHANGED, { action: 'tags-updated' })
      }
      return { ok }
    })

    // Werte muessen sich auch entfernen lassen. Hinzufuegen gab es, Entfernen
    // nicht -- eine Werteliste, aus der nichts herausgeht, waechst nur.
    ipcMain.handle(IPC.NOTES_TAG_CLASS_REMOVE_VALUE, async (_e, { className, value }: { className: string; value: string }) => {
      const ok = this.tagClassRepo.removeValue(className, value)
      if (ok) {
        this.windowManager.sendToAllWindows(IPC.NOTES_CHANGED, { action: 'tags-updated' })
      }
      return { ok }
    })

    ipcMain.handle(IPC.NOTES_TAG_SYNONYMS_LIST, async () => {
      return this.tagClassRepo.getSynonyms()
    })

    // Tag Index (REQ-NOTES-012)
    ipcMain.handle(IPC.NOTES_TAG_INDEX, async () => {
      return this.tagIndex.getIndex()
    })

    ipcMain.handle(IPC.NOTES_TAG_INDEX_REFRESH, async () => {
      return this.tagIndex.rebuild()
    })
  }

  // ─── Grid Control (MCP App-Control) ─────────────────────
  private registerGridControlChannels(): void {
    // Pull-based Keep Working restore — renderer polls this until it gets data or times out.
    // Don't null the cache on read — the renderer may poll multiple times if the init chain
    // hasn't completed yet. The cache is cleared when keepWorkingSnapshot is consumed (line ~275).
    ipcMain.handle(IPC.KEEP_WORKING_PULL, () => {
      return this.cachedKeepWorkingRestore // null if no restore pending (yet)
    })

    ipcMain.handle(IPC.GRID_RESIZE, (_e, { cols, rows }: { cols: number; rows: number }) => {
      this.windowManager.sendToMainWindow(IPC.GRID_RESIZE, { cols, rows })
      return { ok: true }
    })

    ipcMain.handle(IPC.GRID_PLACE, (_e, { sessionId, col, row }: { sessionId: string; col: number; row: number }) => {
      this.windowManager.sendToMainWindow(IPC.GRID_PLACE, { sessionId, col, row })
      return { ok: true }
    })

    ipcMain.handle(IPC.SESSION_FOCUS, (_e, { sessionId }: { sessionId: string }) => {
      this.windowManager.sendToMainWindow(IPC.SESSION_FOCUS, { sessionId })
      return { ok: true }
    })

    ipcMain.handle(IPC.SESSION_EJECT, (_e, { sessionId }: { sessionId: string }) => {
      this.windowManager.sendToMainWindow(IPC.SESSION_EJECT, { sessionId })
      return { ok: true }
    })

    ipcMain.handle(IPC.SIDEBAR_TOGGLE, (_e, { visible }: { visible?: boolean }) => {
      this.windowManager.sendToMainWindow(IPC.SIDEBAR_TOGGLE, { visible })
      return { ok: true }
    })
  }

  // ─── Entity Framework ──────────────────────────────────
  private registerEntityChannels(): void {
    ipcMain.handle(IPC.ENTITY_START, async (_e, { entityId, workspaceId }: {
      entityId: EntityId
      workspaceId?: string | null
    }) => {
      // Feature flag gate: debugger is opt-in (defaults to disabled)
      if (entityId === 'debugger') {
        const debuggerConfig = configStore.get('debugger')
        if (!debuggerConfig?.enabled) {
          throw new Error('Debugger is disabled. Enable it in Settings → Debugger.')
        }
      }

      // Explicit choice wins; otherwise the globally active workspace.
      // undefined means "caller did not choose" — null means "explicitly unbound".
      const effectiveWorkspaceId = workspaceId === undefined
        ? (configStore.get('activeWorkspaceId') ?? null)
        : workspaceId

      const mcpConfig = configStore.get('mcp')
      // Ensure MCP config is set on session manager
      this.sessionManager.setMcpConfig({
        mcpHost: mcpConfig?.host ?? MCP_DEFAULT_HOST,
        mcpPort: mcpConfig?.port ?? MCP_DEFAULT_PORT,
        mcpApiKey: mcpConfig?.apiKey ?? '',
      })
      const session = await this.sessionManager.startEntity(entityId, {
        workspaceId: effectiveWorkspaceId,
      })
      // Queue Claude launch for entity — pass session.id for multi-instance support
      try {
        this.sessionManager.queueEntityClaude(entityId, session.id)
        this.sessionManager.scheduleStartupGreeting(entityId)
      } catch (err) {
        console.error(`[IpcHub] Failed to queue ${entityId} claude:`, err)
      }
      return session
    })

    ipcMain.handle(IPC.ENTITY_RESUME, async (_e, { entityId, sessionId, workspaceId }: {
      entityId: EntityId
      sessionId?: string
      workspaceId?: string | null
    }) => {
      const mcpConfig = configStore.get('mcp')
      this.sessionManager.setMcpConfig({
        mcpHost: mcpConfig?.host ?? MCP_DEFAULT_HOST,
        mcpPort: mcpConfig?.port ?? MCP_DEFAULT_PORT,
        mcpApiKey: mcpConfig?.apiKey ?? '',
      })
      // Same three-state resolution as ENTITY_START: only `undefined` means
      // "caller had no preference" — an explicit null must stay unbound, so
      // `??` would be wrong here.
      const effectiveWorkspaceId = workspaceId === undefined
        ? (configStore.get('activeWorkspaceId') ?? null)
        : workspaceId
      const session = await this.sessionManager.resumeEntity(entityId, sessionId, effectiveWorkspaceId)
      return session
    })

    ipcMain.handle(IPC.ENTITY_STOP, async (_e, { entityId, sessionId }: { entityId: EntityId; sessionId?: string }) => {
      await this.sessionManager.stopEntity(entityId, sessionId)
      return { ok: true }
    })

    ipcMain.handle(IPC.ENTITY_STATUS, async (_e, { entityId }: { entityId: EntityId }) => {
      return {
        running: this.sessionManager.isEntityRunning(entityId),
        sessionId: this.sessionManager.getEntitySessionId(entityId),
        sessionIds: this.sessionManager.getEntitySessionIds(entityId),
      }
    })

    ipcMain.handle(IPC.ENTITY_LIST, async () => {
      const configs = this.sessionManager.getEntityRegistry().list()
      const overrides = configStore.get('entitySortOrders') ?? {}
      const hidden = configStore.get('entityHidden') ?? {}
      return configs.map(c => ({
        ...c,
        sortOrder: overrides[c.id] ?? c.sortOrder ?? 100,
        launcherHidden: hidden[c.id] ?? false,
      }))
    })
  }

  // ─── Presets (Entity CLAUDE.md Editor) ──────────────────
  private registerPresetChannels(): void {
    const entitiesDir = path.join(os.homedir(), '.config/cipher-mux/entities')

    // Entities whose preset.md is code-generated and refreshed at session start.
    // These are read-only in the PresetEditor ("Copy as Custom" to override).
    const ENTITIES_WITH_TEMPLATE = new Set([
      'audit', 'voice-relay', 'testing-assistant',
      'debugger', 'cyber-factory', 'workshop', 'companion',
      'refinement', 'ideation-partner', 'local-worker',
    ])

    ipcMain.handle(IPC.PRESETS_LIST, async () => {
      // Return entities that have a projectPath inside ~/.config/cipher-mux/entities
      const registry = this.sessionManager.getEntityRegistry()
      const all = registry.list()
      const overrides = configStore.get('entitySortOrders') ?? {}
      const hidden = configStore.get('entityHidden') ?? {}
      return all
        .filter(e => e.projectPath.startsWith(entitiesDir))
        .map(e => ({
          id: e.id,
          displayName: e.displayName,
          color: e.color,
          icon: e.icon,
          projectPath: e.projectPath,
          sortOrder: overrides[e.id] ?? e.sortOrder ?? 100,
          launcherHidden: hidden[e.id] ?? false,
          hasTemplate: ENTITIES_WITH_TEMPLATE.has(e.id),
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder)
    })

    ipcMain.handle(IPC.PRESETS_READ, async (_e, { entityId }: { entityId: string }) => {
      const presetMdPath = path.join(entitiesDir, entityId, 'preset.md')
      const claudeMdPath = path.join(entitiesDir, entityId, 'CLAUDE.md')
      const registry = this.sessionManager.getEntityRegistry()
      const entity = registry.list().find(e => e.id === entityId)
      const displayName = entity?.displayName ?? entityId

      // Primary: preset.md
      if (fs.existsSync(presetMdPath)) {
        try {
          const content = fs.readFileSync(presetMdPath, 'utf-8')
          return { ok: true, content, displayName }
        } catch {
          return { ok: false, content: '', error: 'Failed to read preset.md' }
        }
      }

      // Fallback: CLAUDE.md with injected sections stripped
      if (fs.existsSync(claudeMdPath)) {
        try {
          let content = fs.readFileSync(claudeMdPath, 'utf-8')
          const stripSections = ['Global Rules', 'Persona', 'Workspace Prompt', 'Context Directories']
          for (const section of stripSections) {
            const regex = new RegExp(`\\n## ${section}\\n[\\s\\S]*?(?=\\n## |$)`, 'g')
            content = content.replace(regex, '')
          }
          return { ok: true, content: content.trim(), displayName }
        } catch {
          return { ok: false, content: '', error: 'Failed to read CLAUDE.md' }
        }
      }

      // Last resort: generate template content on-the-fly for known entities
      const templateGenerators: Record<string, () => string> = {
        'voice-relay': generateVoiceRelayClaudeMd,
        audit: generateAuditClaudeMd,
        debugger: generateDebuggerClaudeMd,
        companion: generateCompanionClaudeMd,
        'testing-assistant': generateTestingAssistantClaudeMd,
      }
      const gen = templateGenerators[entityId]
      if (gen) {
        const content = gen()
        return { ok: true, content, displayName }
      }

      return { ok: true, content: '', displayName }
    })

    ipcMain.handle(IPC.PRESETS_SAVE, async (_e, { entityId, content }: { entityId: string; content: string }) => {
      const presetMdPath = path.join(entitiesDir, entityId, 'preset.md')
      try {
        // Empty content = delete preset.md so template fallback kicks in
        if (!content.trim()) {
          if (fs.existsSync(presetMdPath)) fs.unlinkSync(presetMdPath)
        } else {
          fs.writeFileSync(presetMdPath, content, 'utf-8')
        }
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err instanceof Error ? err.message : String(err)) }
      }
    })

    ipcMain.handle(IPC.PRESETS_CREATE, async (_e, { entityId, displayName }: { entityId: string; displayName: string }) => {
      const dir = path.join(entitiesDir, entityId)
      const presetMdPath = path.join(dir, 'preset.md')
      try {
        if (fs.existsSync(dir)) {
          return { ok: false, error: 'Preset directory already exists' }
        }
        fs.mkdirSync(dir, { recursive: true })
        const template = `# ${displayName}

## Rolle

Beschreibe hier die Rolle und Persoenlichkeit des Entity.
Wer ist es, wie spricht es, was ist sein Auftrag?

## Faehigkeiten

Welche MCP-Tools nutzt dieses Entity?
Welche besonderen Workflows beherrscht es?

## Arbeitsregeln

Verhaltensregeln, Grenzen, Off-Limits.
Was darf das Entity, was nicht?

## Scope

Auf welche Projekte, Verzeichnisse oder Themen
ist dieses Entity fokussiert?

---

> Tipp: Schreib erst selbst einen Entwurf — das schaerft dein eigenes Verstaendnis.
> Dann starte eine Session mit dem Coding Companion und bitte ihn,
> daraus einen guten Prompt zu machen.
`
        fs.writeFileSync(presetMdPath, template, 'utf-8')
        // Entity scanner requires CLAUDE.md to register the entity
        const claudeMdPath = path.join(dir, 'CLAUDE.md')
        fs.writeFileSync(claudeMdPath, template, 'utf-8')
        // Re-scan to register the new entity
        const registry = this.sessionManager.getEntityRegistry()
        scanAndRegisterEntities(registry)
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err instanceof Error ? err.message : String(err)) }
      }
    })

    ipcMain.handle(IPC.PRESETS_DELETE, async (_e, { entityId }: { entityId: string }) => {
      const dir = path.join(entitiesDir, entityId)
      try {
        if (!fs.existsSync(dir)) {
          return { ok: false, error: 'Preset directory not found' }
        }
        fs.rmSync(dir, { recursive: true, force: true })
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err instanceof Error ? err.message : String(err)) }
      }
    })

    ipcMain.handle(IPC.PRESETS_READ_INJECTED, async (_e, { entityId }: { entityId: string }) => {
      const sections: Array<{ name: string; source: string }> = []

      // Global Rules — always injected from global-rules.md
      const globalRulesPath = path.join(os.homedir(), '.config/cipher-mux/global-rules.md')
      if (fs.existsSync(globalRulesPath)) {
        sections.push({ name: 'Global Rules', source: 'global-rules.md' })
      }

      // Persona — resolved via persona-resolver
      const overrides = configStore.get('entityPersonaOverrides') ?? {}
      const resolved = resolvePersonaForPreset(entityId, {
        getCharacters: () => configStore.get('characters') ?? [],
        getActiveCharacterId: () => configStore.get('activeCharacterId') ?? 'relay',
        getGlobalActivePersonaId: () => configStore.get('globalActivePersonaId') ?? null,
      }, overrides[entityId] ?? null)
      sections.push({ name: 'Persona', source: `character: ${resolved.name}` })

      // Workspace Prompt + Context Directories — from active workspace if it has them
      const ws = getActiveWorkspace()
      if (ws) {
        if (ws.workspacePrompt?.trim()) {
          sections.push({ name: 'Workspace Prompt', source: `workspace: ${ws.name ?? ws.id}` })
        }
        if (ws.contextPaths?.length) {
          sections.push({ name: 'Context Directories', source: `workspace: ${ws.name ?? ws.id}` })
        }
      }

      return { sections }
    })
  }

  // ─── Global Rules (global-rules.md Editor) ─────────────
  private registerGlobalRulesChannels(): void {
    ensureGlobalRulesFile()

    ipcMain.handle(IPC.GLOBAL_RULES_READ, async () => {
      try {
        const content = getGlobalRules()
        return { ok: true, content }
      } catch (err) {
        return { ok: false, content: '', error: (err instanceof Error ? err.message : String(err)) }
      }
    })

    ipcMain.handle(IPC.GLOBAL_RULES_SAVE, async (_e, { content }: { content: string }) => {
      try {
        setGlobalRules(content)
        invalidateGlobalRulesCache()
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err instanceof Error ? err.message : String(err)) }
      }
    })
  }

  // ─── Companion Memory ──────────────────────────────────
  private registerCompanionChannels(): void {
    // Helper: workspace-aware recall (user + active workspace, excludes other workspaces)
    const wsAwareRecall = (opts?: { limit?: number; kindFilter?: import('../shared/types').MemoryKind; since?: number }) => {
      const limit = opts?.limit ?? 20
      const activeWsId = configStore.get('activeWorkspaceId') ?? null
      if (activeWsId) {
        const userMems = this.memoryStore!.recall({ ...opts, limit, scopeKind: 'user' })
        const wsMems = this.memoryStore!.recall({ ...opts, limit, scopeKind: 'workspace', scopeId: activeWsId })
        const merged = [...userMems, ...wsMems].sort((a, b) => b.ts - a.ts)
        return merged.slice(0, limit)
      }
      return this.memoryStore!.recall({ ...opts, limit })
    }

    ipcMain.handle(IPC.COMPANION_RECALL, async (_e, { limit }: { limit?: number }) => {
      if (!this.memoryStore) return []
      return wsAwareRecall({ limit })
    })

    ipcMain.handle(IPC.COMPANION_LIST_MEMORIES, async (_e, opts?: { limit?: number; kind?: string; since?: number }) => {
      if (!this.memoryStore) return []
      return wsAwareRecall({
        limit: opts?.limit,
        kindFilter: opts?.kind as import('../shared/types').MemoryKind | undefined,
        since: opts?.since,
      })
    })

    ipcMain.handle(IPC.COMPANION_SEARCH, async (_e, { query, limit }: { query: string; limit?: number }) => {
      if (!this.memoryStore) return []
      const searchLimit = limit ?? 20
      const activeWsId = configStore.get('activeWorkspaceId') ?? null
      const raw = this.memoryStore.search(query, { limit: activeWsId ? searchLimit * 3 : searchLimit })
      if (activeWsId) {
        return raw.filter(m =>
          m.scopeKind === 'user' ||
          (m.scopeKind === 'workspace' && m.scopeId === activeWsId)
        ).slice(0, searchLimit)
      }
      return raw
    })

    ipcMain.handle(IPC.COMPANION_DELETE_MEMORY, async (_e, { id }: { id: string }) => {
      if (!this.memoryStore) return { ok: false }
      const deleted = this.memoryStore.forget(id)
      return { ok: deleted }
    })
  }

  private onSetupComplete(): void {
    if (this.setupCompleteResolve) {
      this.setupCompleteResolve()
      this.setupCompleteResolve = null
    }
  }

  // ─── Hub ───────────────────────────────────────────────────
  private registerHubChannels(): void {
    ipcMain.handle(IPC.HUB_SETUP, async (_e, hubPath: string) => {
      fs.mkdirSync(path.join(hubPath, 'projects'), { recursive: true })
      const claudeMdPath = path.join(hubPath, 'CLAUDE.md')
      if (!fs.existsSync(claudeMdPath)) {
        fs.writeFileSync(claudeMdPath, '# cipher-mux Hub\n')
      }
      configStore.set('hubPath', hubPath)
      return true
    })

    ipcMain.handle(IPC.HUB_GET_PATH, () => {
      return configStore.get('hubPath') ?? ''
    })

    ipcMain.handle(IPC.HUB_PROJECTS_DIR, () => projectsDir())

    ipcMain.handle(IPC.HUB_DEFAULT_PATH, () => path.join(os.homedir(), 'cipher-mux'))
  }

  // ─── Setup Wizard ─────────────────────────────────────────
  private registerSetupChannels(): void {
    ipcMain.handle(IPC.SETUP_CHECK, async () => {
      return { dependencies: await setupCheckAll() }
    })

    ipcMain.handle(IPC.SETUP_INSTALL_ALL, async (event, opts?: { selectedIds?: string[] }) => {
      const deps = await setupCheckAll()
      const selectedIds = opts?.selectedIds
      const missing = deps.filter(d => !d.installed && (!selectedIds || d.required || selectedIds.includes(d.id)))

      for (const dep of missing) {
        event.sender.send(IPC.SETUP_PROGRESS, {
          stepId: dep.id,
          message: `Installing ${dep.name}...`,
          done: false,
        })

        const success = await installDependency(dep.id, (msg) => {
          event.sender.send(IPC.SETUP_PROGRESS, {
            stepId: dep.id,
            message: msg,
            done: false,
          })
        })

        if (!success) {
          const updated = await setupCheckAll()
          event.sender.send(IPC.SETUP_PROGRESS, {
            stepId: dep.id,
            message: `Installation of ${dep.name} failed`,
            done: false,
            error: true,
            dependencies: updated,
          })
          return { ok: false, failedId: dep.id }
        }

        const updated = await setupCheckAll()
        event.sender.send(IPC.SETUP_PROGRESS, {
          stepId: dep.id,
          message: `${dep.name} done`,
          done: false,
          dependencies: updated,
        })
      }

      const final = await setupCheckAll()
      event.sender.send(IPC.SETUP_PROGRESS, {
        stepId: null,
        message: 'done',
        done: true,
        dependencies: final,
      })

      // Signal setup complete for tmux gating
      this.setupCompleted = true
      this.onSetupComplete()

      return { ok: true }
    })

    ipcMain.handle(IPC.SETUP_SKIP, () => {
      // User skipped setup — unblock tmux connect
      if (!this.setupCompleted) {
        this.setupCompleted = true
        this.onSetupComplete()
      }
      return { ok: true }
    })
  }

  // ─── Update Checker ──────────────────────────────────────

  private registerUpdateChannels(): void {
    ipcMain.handle(IPC.UPDATE_CHECK, async () => {
      try {
        const updateInfo = await checkForUpdate()
        if (updateInfo) {
          const dismissed = configStore.get('update')?.dismissedVersion
          if (dismissed === updateInfo.version) return null
          this.windowManager.sendToMainWindow(IPC.UPDATE_AVAILABLE, updateInfo)
        }
        configStore.set('update', {
          ...configStore.get('update'),
          lastCheck: new Date().toISOString(),
        })
        return updateInfo
      } catch (err) {
        console.warn('[update] Check failed:', (err as Error).message)
        return null
      }
    })

    ipcMain.on(IPC.UPDATE_DISMISS, (_e, version: string) => {
      configStore.set('update', {
        ...configStore.get('update'),
        dismissedVersion: version,
      })
    })
  }

  // ─── BT Remote ─────────────────────────────────────────

  /** Timestamp of last BT Remote button event — used to suppress
   *  duplicate HID keystrokes that arrive via macOS after the bridge handles them. */
  private btRemoteLastEventTs = 0
  private btRemoteInputGuard: ((e: Electron.Event, input: Electron.Input) => void) | null = null
  private focusedSessionId: string | null = null

  private startBtRemote(): void {
    const btConfig = configStore.get('btRemotes') ?? configStore.get('btShutter') ?? {}
    if (this.btRemoteManager?.isRunning()) return

    const profileDir = (btConfig as any).profileDir
      ?? path.join(os.homedir(), '.config', 'cipher-mux', 'bt-remotes')

    this.btRemoteManager = new BtRemoteManager({
      binaryPath: (btConfig as any).binaryPath,
      profileDir,
    })

    this.btRemoteManager.on('action', (action: ResolvedAction) => {
      // Only mark timestamp for non-passthrough actions — passthrough events
      // must reach the terminal as native keystrokes, so we must not suppress them.
      if (action.type !== 'passthrough') {
        this.btRemoteLastEventTs = Date.now()
      }

      if (action.type === 'shortcut' && action.combo) {
        const mainWin = this.windowManager.getMainWindow()
        if (mainWin && !mainWin.isDestroyed()) {
          // Native clipboard ops must go through webContents API, not synthetic events
          const comboLower = action.combo.toLowerCase().replace(/\s/g, '')
          if (comboLower === 'cmd+c' || comboLower === 'meta+c') {
            mainWin.webContents.copy()
          } else if (comboLower === 'cmd+v' || comboLower === 'meta+v') {
            mainWin.webContents.paste()
          } else if (comboLower === 'cmd+x' || comboLower === 'meta+x') {
            mainWin.webContents.cut()
          } else if (comboLower === 'cmd+a' || comboLower === 'meta+a') {
            mainWin.webContents.selectAll()
          } else {
            // All other shortcuts: synthetic keyboard event → ShortcutRegistry
            const { keyCode, modifiers } = parseComboForElectron(action.combo)
            mainWin.webContents.sendInputEvent({
              type: 'keyDown',
              keyCode,
              modifiers: modifiers as any[],
            })
            mainWin.webContents.sendInputEvent({
              type: 'keyUp',
              keyCode,
              modifiers: modifiers as any[],
            })
          }
        }
      } else if (action.type === 'passthrough') {
        // Let the original HID event pass through — bridge already suppressed it,
        // so we don't need to do anything (the event was consumed at bridge level).
        // For buttons like Enter or mouse clicks, the user expects native behavior.
      }
      // disabled and unmapped: no action

      // Notify renderer for UI feedback
      this.windowManager.sendToMainWindow(IPC.BT_REMOTE_EVENT, action)
      // Legacy compat
      this.windowManager.sendToMainWindow(IPC.BT_SHUTTER_EVENT, action)
    })

    this.btRemoteManager.on('device', (_status: DeviceStatus) => {
      this.windowManager.sendToMainWindow(IPC.BT_REMOTE_DEVICES, this.btRemoteManager!.getConnectedDevices())
    })

    this.btRemoteManager.on('status', (status: { status: string; error?: string }) => {
      this.windowManager.sendToMainWindow(IPC.BT_REMOTE_STATUS, status)
      // Legacy compat
      this.windowManager.sendToMainWindow(IPC.BT_SHUTTER_STATUS, status)
    })

    // Suppress duplicate HID keystrokes arriving via macOS within 200ms of bridge event
    const mainWin = this.windowManager.getMainWindow()
    if (mainWin) {
      this.btRemoteInputGuard = (_e: Electron.Event, input: Electron.Input) => {
        const elapsed = Date.now() - this.btRemoteLastEventTs
        if (elapsed < 200 && input.type === 'keyDown') {
          // Suppress arrow keys and Enter that BT remotes inject as native HID
          const suppressKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter']
          if (suppressKeys.includes(input.key)) {
            _e.preventDefault()
            console.log(`[BtRemote] Suppressed duplicate HID ${input.key} keystroke`)
          }
        }
      }
      mainWin.webContents.on('before-input-event', this.btRemoteInputGuard)
    }

    this.btRemoteManager.start()
  }

  private stopBtRemote(): void {
    if (this.btRemoteManager) {
      this.btRemoteManager.shutdown()
      this.btRemoteManager = null
    }

    if (this.btRemoteInputGuard) {
      const mainWin = this.windowManager.getMainWindow()
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.off('before-input-event', this.btRemoteInputGuard)
      }
      this.btRemoteInputGuard = null
    }
  }

  /**
   * Restore Keep Working state by reusing recovered tmux sessions where possible.
   * Only creates new sessions (with --resume) for snapshot entries that have no
   * matching recovered session. This avoids killing live Claude sessions and
   * eliminates the race condition where new session IDs wouldn't match the
   * persisted ui.grid config.
   */
  private async restoreKeepWorkingFromRecovery(
    snapshot: Array<{ name: string; projectPath: string; gridSlot: number; entityId?: string; topic?: string; workspaceId?: string | null; adapterId?: string | null }>,
    gridConfig: { cols: number; rows: number } | undefined,
    recovered: Array<{ id: string; name: string; projectPath: string | null; entityId?: string; workspaceId?: string | null }>,
    notesSlots?: Array<{ slotIndex: number; notesId?: string; openNoteIds?: string[] }>,
  ): Promise<void> {
    const effectiveGrid = gridConfig ?? { cols: 1, rows: 1 }

    // Build lookup of recovered sessions by name (primary) and projectPath (fallback)
    const recoveredByName = new Map<string, typeof recovered[0]>()
    const recoveredByPath = new Map<string, typeof recovered[0]>()
    for (const r of recovered) {
      if (r.name) recoveredByName.set(r.name, r)
      if (r.projectPath) recoveredByPath.set(r.projectPath, r)
    }
    const claimed = new Set<string>() // recovered session IDs already matched

    const slotMap: Array<{ sessionId: string | null; slotIndex: number; topic?: string }> = []

    for (const entry of snapshot) {
      // Try to find a matching recovered session
      let match = recoveredByName.get(entry.name)
      if (match && claimed.has(match.id)) match = undefined
      if (!match) {
        match = recoveredByPath.get(entry.projectPath)
        if (match && claimed.has(match.id)) match = undefined
      }

      if (match) {
        // Reuse recovered session — it's still alive in tmux with Claude running
        claimed.add(match.id)
        slotMap.push({ sessionId: match.id, slotIndex: entry.gridSlot, topic: entry.topic })

        // Restore entity link from snapshot if missing
        if (entry.entityId && !match.entityId) {
          this.sessionManager.linkEntity(match.id, entry.entityId)
        }
        // Re-bind workspace: the recovered session's own binding (restored
        // by recover() straight from sessions.json — the continuously
        // maintained record) takes precedence over the snapshot entry — a
        // coarser, once-at-quit record matched back to sessions heuristically
        // by name/projectPath. The snapshot entry is only a fallback for a
        // recovered session with no binding of its own (e.g. a pre-upgrade
        // sessions.json). This also means a projectPath-fallback mismatch
        // (entry actually belongs to a different session) can't stamp the
        // wrong workspace onto `match` as long as `match` already has one.
        this.sessionManager.bindWorkspace(match.id, resolveRestoredWorkspaceId(match.workspaceId, entry.workspaceId))
        console.log(`[IpcHub] keepWorking: reusing recovered "${match.name}" (${match.id}) → slot ${entry.gridSlot}`)
      } else {
        // No matching recovered session — start new with --resume
        try {
          const escaped = entry.projectPath.replace(/'/g, "'\\''")
          // Pro Eintrag aufloesen, nicht einmal fuer den ganzen Restore: jede
          // wiederhergestellte Session traegt ihre eigene Rolle, und die Rolle
          // entscheidet ueber die CLI. Ein Default fuer alle wuerde eine
          // Codex-Rolle als `claude --resume` zurueckbringen — die Session kaeme
          // hoch, nur mit der falschen CLI, und das sieht nach Erfolg aus.
          //
          // Eine Ordner-Session hat keine Rolle — fuer sie zaehlt die CLI, mit
          // der sie lief (`restoreAdapterId`).
          const savedAdapterId = restoreAdapterId(entry, (aid) => !!this.adapterRegistry.get(aid))
          const adapter = (savedAdapterId ? this.adapterRegistry.get(savedAdapterId) : undefined)
            ?? this.sessionManager.adapterForEntity(entry.entityId ?? null)
          const launchCmd = adapter.buildLaunchCommand({
            projectPath: entry.projectPath,
            sessionName: entry.name,
            resume: true,
          })
          const cmdStr = [launchCmd.cmd, ...launchCmd.args].join(' ')
          const autoLaunch = `cd '${escaped}' && clear; ${cmdStr}\n`

          // `entityId` muss mit: `start()` loest daran den Adapter fuer
          // MCP-Injektion und Status-Hook auf. Fehlt es, baut das Startkommando
          // oben die richtige CLI, waehrend die Injektion die Dateien der
          // falschen schreibt — die Session kommt hoch, nur ohne ihre Werkzeuge.
          const session = await this.sessionManager.start({
            name: entry.name,
            projectPath: entry.projectPath,
            autoLaunch,
            workspaceId: entry.workspaceId ?? null,
            entityId: entry.entityId ?? null,
            adapterId: adapter.id,
          })
          // Restore entity link for newly created sessions too
          if (entry.entityId) {
            this.sessionManager.linkEntity(session.id, entry.entityId)
          }
          slotMap.push({ sessionId: session.id, slotIndex: entry.gridSlot, topic: entry.topic })
          console.log(`[IpcHub] keepWorking: started new "${entry.name}" (--resume) → slot ${entry.gridSlot}`)
        } catch (err) {
          console.error(`[IpcHub] keepWorking: failed to start "${entry.name}":`, (err as Error).message)
        }
      }
    }

    // Persist grid state to ui.grid in configStore so that useGrid's mount load
    // gets the correct session IDs — eliminates the race condition entirely.
    const total = effectiveGrid.cols * effectiveGrid.rows
    const newSlots: Array<{ sessionId: string | null; rowSpan: number; type: 'session' | 'notes'; notesId?: string; openNoteIds?: string[] }> =
      Array.from({ length: total }, () => ({
        sessionId: null as string | null,
        rowSpan: 1,
        type: 'session' as const,
      }))
    for (const { sessionId, slotIndex } of slotMap) {
      if (slotIndex >= 0 && slotIndex < total) {
        newSlots[slotIndex] = { sessionId, rowSpan: 1, type: 'session' }
      }
    }
    // Restore notes slots
    if (notesSlots) {
      for (const ns of notesSlots) {
        if (ns.slotIndex >= 0 && ns.slotIndex < total && !newSlots[ns.slotIndex].sessionId) {
          newSlots[ns.slotIndex] = {
            sessionId: null,
            rowSpan: 1,
            type: 'notes',
            notesId: ns.notesId || `notes-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            openNoteIds: ns.openNoteIds,
          }
        }
      }
    }
    const gridState = { config: effectiveGrid, slots: newSlots }
    const ui = configStore.get('ui')
    configStore.set('ui', { ...ui, grid: gridState })

    // Also update SessionStore grid state for consistency
    this.sessionManager.persistGridState(gridState)

    // Cache + push for renderer (belt-and-suspenders with config persistence above)
    const payload = { gridConfig: effectiveGrid, slots: slotMap, notesSlots: notesSlots ?? undefined }
    this.cachedKeepWorkingRestore = payload
    this.windowManager.sendToMainWindow(IPC.KEEP_WORKING_RESTORE, payload)
    console.log(`[IpcHub] keepWorking: restore complete — ${slotMap.length} sessions (${claimed.size} reused, ${slotMap.length - claimed.size} new), grid ${effectiveGrid.cols}x${effectiveGrid.rows}`)
    // Debug: append restore result to file
    try {
      const restoreDebug = { ts: new Date().toISOString(), slotMap, gridConfig: effectiveGrid, claimed: claimed.size }
      fs.appendFileSync('/tmp/kw-debug.json', '\n--- RESTORE ---\n' + JSON.stringify(restoreDebug, null, 2))
    } catch { /* ignore */ }
  }

  /** Live-update Keep Working snapshot when grid changes (called on every CONFIG_SAVE_GRID). */
  private async updateKeepWorkingSnapshot(grid: { config: { cols: number; rows: number }; slots: Array<{ sessionId: string | null; type?: string; notesId?: string; openNoteIds?: string[] }> }): Promise<void> {
    const sessions = this.sessionManager.list().filter(s => s.status === 'active')
    if (sessions.length === 0) return
    const allTasks = this.taskManager ? this.taskManager.list() : []
    const snapshot: Array<{ name: string; projectPath: string; gridSlot: number; entityId?: string; topic?: string; workspaceId?: string | null; adapterId?: string | null }> = []
    for (const s of sessions) {
      const slotIdx = grid.slots.findIndex(slot => slot.sessionId === s.id)
      if (!s.projectPath || slotIdx < 0) continue
      let capture: string | undefined
      try {
        if (s.tmuxPane) capture = await this.tmux.capturePane(s.tmuxPane, 10)
      } catch { /* ignore */ }
      snapshot.push({
        name: s.name ?? 'session',
        projectPath: s.projectPath ?? '',
        gridSlot: slotIdx,
        entityId: s.entityId,
        topic: resolveSessionTopic(s, allTasks, capture),
        workspaceId: s.workspaceId ?? null,
        adapterId: s.adapterId ?? null,
      })
    }
    // Collect notes slots for restoration
    const notesSlots: Array<{ slotIndex: number; notesId?: string; openNoteIds?: string[] }> = []
    for (let i = 0; i < grid.slots.length; i++) {
      const slot = grid.slots[i] as any
      if (slot.type === 'notes') {
        notesSlots.push({ slotIndex: i, notesId: slot.notesId, openNoteIds: slot.openNoteIds })
      }
    }
    configStore.set('keepWorkingSnapshot', {
      sessions: snapshot,
      gridConfig: grid.config,
      notesSlots: notesSlots.length > 0 ? notesSlots : undefined,
    })
  }

  /** Restore detached windows saved from previous session. Stale entries are skipped. */
  private restoreDetachedWindows(): void {
    const saved = configStore.get('detachedWindows') as Array<{ type: 'session' | 'note'; entityId: string; bounds: { x: number; y: number; width: number; height: number } }> | undefined
    if (!saved || saved.length === 0) return

    const activeSessions = this.sessionManager.list().filter(s => s.status === 'active')
    const sessionIds = new Set(activeSessions.map(s => s.id))

    this.windowManager.restoreDetachedWindows(saved, (entry) => {
      if (entry.type === 'session') {
        return sessionIds.has(entry.entityId)
      }
      // For notes: check if note file still exists
      try {
        const note = this.noteManager.read(entry.entityId)
        return !!note
      } catch {
        return false
      }
    })

    // Clear consumed snapshot
    configStore.clear('detachedWindows')
    console.log(`[IpcHub] restored detached windows from snapshot`)

    // Notify main window of detach state
    this.windowManager.sendToMainWindow(IPC.DETACH_STATE_CHANGED, {
      entries: this.windowManager.getDetachedEntries()
    })
  }

  async destroy(): Promise<void> {
    // Keep Working: save snapshot of current sessions before shutdown
    if (configStore.get('keepWorking')) {
      const sessions = this.sessionManager.list().filter(s => s.status === 'active')
      const gridState = this.sessionManager.getSessionStore().getGridState()
      if (sessions.length > 0 && gridState) {
        const allTasks = this.taskManager ? this.taskManager.list() : []
        const snapshot: Array<{ name: string; projectPath: string; gridSlot: number; entityId?: string; topic?: string; workspaceId?: string | null; adapterId?: string | null }> = []
        for (const s of sessions) {
          const slotIdx = gridState.slots.findIndex(slot => slot.sessionId === s.id)
          if (!s.projectPath || slotIdx < 0) continue
          let capture: string | undefined
          try {
            if (s.tmuxPane) capture = await this.tmux.capturePane(s.tmuxPane, 10)
          } catch { /* ignore — session may already be gone */ }
          snapshot.push({
            name: s.name ?? 'session',
            projectPath: s.projectPath ?? '',
            gridSlot: slotIdx,
            entityId: s.entityId,
            topic: resolveSessionTopic(s, allTasks, capture),
            workspaceId: s.workspaceId ?? null,
            adapterId: s.adapterId ?? null,
          })
        }
        // Collect notes slots for restoration
        const notesSlots: Array<{ slotIndex: number; notesId?: string; openNoteIds?: string[] }> = []
        for (let i = 0; i < gridState.slots.length; i++) {
          const slot = gridState.slots[i] as any
          if (slot.type === 'notes') {
            notesSlots.push({ slotIndex: i, notesId: slot.notesId, openNoteIds: slot.openNoteIds })
          }
        }
        configStore.set('keepWorkingSnapshot', {
          sessions: snapshot,
          gridConfig: gridState.config,
          notesSlots: notesSlots.length > 0 ? notesSlots : undefined,
        })
        console.log(`[IpcHub] keepWorking: saved snapshot of ${snapshot.length} sessions, ${notesSlots.length} notes slots (grid: ${gridState.config.cols}x${gridState.config.rows})`)
      }
    }

    // Save detached windows snapshot for restart restoration
    const detachedEntries = this.windowManager.getDetachedEntries()
    if (detachedEntries.length > 0) {
      configStore.set('detachedWindows', detachedEntries)
      console.log(`[IpcHub] saved ${detachedEntries.length} detached window(s) for restart`)
    } else {
      configStore.clear('detachedWindows')
    }

    this.stopBtRemote()
    this.noteManager.destroy()
    this.memoryStore?.close()
    this.bugreportSource?.stop()
    this.taskWatcher?.stop()
    this.voiceManager?.shutdown()
    await this.mcpServer.stop().catch(() => {})
    this.statusLineMonitor.stop()
    this.kickoffWorkshop.destroy()
    if (this.messageBus) this.messageBus.destroy()
    await this.sessionManager.destroy()
  }
}
