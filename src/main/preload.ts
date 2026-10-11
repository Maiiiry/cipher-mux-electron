import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type { Persona, Character, Workspace } from '../shared/types'
import type { PaneSnapshot } from '../shared/terminal-resync'

/**
 * Preload script — exposes window.cipherMux API via contextBridge.
 * All renderer access to the main process goes through this API.
 */
const api = {
  // ─── Sessions ──────────────────────────────────────────
  sessions: {
    list: () => ipcRenderer.invoke(IPC.SESSIONS_LIST),
    start: (opts: unknown) => ipcRenderer.invoke(IPC.SESSIONS_START, opts),
    stop: (sessionId: string) => ipcRenderer.invoke(IPC.SESSIONS_STOP, { sessionId }),
    recover: () => ipcRenderer.invoke(IPC.SESSIONS_RECOVER),
    onChanged: <T = unknown>(cb: (data: T) => void) => {
      const handler = (_e: unknown, data: unknown) => cb(data as T)
      ipcRenderer.on(IPC.SESSION_CHANGED, handler)
      return () => ipcRenderer.removeListener(IPC.SESSION_CHANGED, handler)
    },
    onClosing: <T = unknown>(cb: (data: T) => void) => {
      const handler = (_e: unknown, data: unknown) => cb(data as T)
      ipcRenderer.on(IPC.SESSION_CLOSING, handler)
      return () => ipcRenderer.removeListener(IPC.SESSION_CLOSING, handler)
    },
    onStopped: <T = unknown>(cb: (data: T) => void) => {
      const handler = (_e: unknown, data: unknown) => cb(data as T)
      ipcRenderer.on(IPC.SESSION_STOPPED, handler)
      return () => ipcRenderer.removeListener(IPC.SESSION_STOPPED, handler)
    },
    onRecoveryResult: <T = unknown>(cb: (data: T) => void) => {
      const handler = (_e: unknown, data: unknown) => cb(data as T)
      ipcRenderer.on(IPC.SESSIONS_RECOVERY_RESULT, handler)
      return () => ipcRenderer.removeListener(IPC.SESSIONS_RECOVERY_RESULT, handler)
    },
    recoveryAction: (action: string, tmuxSession: string, displayName?: string) =>
      ipcRenderer.invoke(IPC.SESSIONS_RECOVERY_ACTION, { action, tmuxSession, displayName }),
    recoveryDecline: () => ipcRenderer.invoke(IPC.SESSIONS_RECOVERY_DECLINE),
    onVisibleAdd: (cb: (data: { sessionId: string }) => void) => {
      const handler = (_e: unknown, data: { sessionId: string }) => cb(data)
      ipcRenderer.on(IPC.SESSION_VISIBLE_ADD, handler)
      return () => ipcRenderer.removeListener(IPC.SESSION_VISIBLE_ADD, handler)
    },
    capture: (sessionId: string): Promise<string | null> => ipcRenderer.invoke('cipher-mux:sessions:capture', sessionId),
    fork: (sessionId: string) => ipcRenderer.invoke(IPC.SESSION_FORK, { sessionId }),
    screenshot: (sessionId: string) => ipcRenderer.invoke(IPC.SESSION_SCREENSHOT, { sessionId }),
    detectOrphans: () => ipcRenderer.invoke(IPC.SESSION_ORPHANS),
    onOrphansDetected: (cb: (data: unknown[]) => void) => {
      const handler = (_e: unknown, data: unknown[]) => cb(data)
      ipcRenderer.on(IPC.SESSION_ORPHANS_DETECTED, handler)
      return () => ipcRenderer.removeListener(IPC.SESSION_ORPHANS_DETECTED, handler)
    },
  },

  // ─── Terminal ──────────────────────────────────────────
  terminal: {
    write: (paneId: string, data: string) =>
      ipcRenderer.send(IPC.TERMINAL_WRITE, { paneId, data }),
    /**
     * **`invoke`, nicht `send`** — der Aufrufer muss warten koennen.
     *
     * Der Resync nach einem Resize erfasst den Pane mit `capture-pane`, und das
     * darf erst passieren, wenn tmux die neue Breite hat. Mit `send` gab es dafuer
     * keine Rueckgabe und der Renderer wartete stattdessen 200 ms blind; kam die
     * IPC nicht durch, erfasste er Inhalt in der **alten** Breite und schrieb ihn
     * in ein Terminal der neuen -- der falsche Umbruch blieb dann bis zum naechsten
     * Resize stehen, weil `lastSizeRef` schon aktualisiert war.
     *
     * Gemessen am 2026-10-02: nach Rueckkehr des tmux-Kommandos ist `capture-pane`
     * **sofort** richtig (geprueft bei 0, 50, 200, 500 ms und 2 s, alle identisch).
     * Es gibt also keine Einschwingzeit abzuwarten, nur eine Reihenfolge
     * einzuhalten.
     */
    resize: (paneId: string, cols: number, rows: number): Promise<void> =>
      ipcRenderer.invoke(IPC.TERMINAL_RESIZE, { paneId, cols, rows }),
    split: (paneId: string, direction: string) =>
      ipcRenderer.invoke(IPC.TERMINAL_SPLIT, { paneId, direction }),
    capture: (paneId: string, lines?: number) =>
      ipcRenderer.invoke(IPC.TERMINAL_CAPTURE, { paneId, lines }),
    /** Inhalt samt Cursor — fuer den Neuaufbau mit `buildRestoreSequence`. */
    snapshot: (paneId: string, lines?: number): Promise<PaneSnapshot> =>
      ipcRenderer.invoke(IPC.TERMINAL_SNAPSHOT, { paneId, lines }),
    ready: (paneId: string, cols: number, rows: number) =>
      ipcRenderer.send(IPC.TERMINAL_READY, { paneId, cols, rows }),
    onData: (cb: (data: { paneId: string; data: string }) => void) => {
      const handler = (_e: unknown, data: { paneId: string; data: string }) => cb(data)
      ipcRenderer.on(IPC.TERMINAL_DATA, handler)
      return () => ipcRenderer.removeListener(IPC.TERMINAL_DATA, handler)
    },
    onCellScroll: <T = { sessionId?: string; cell?: string; action: string; lines?: number }>(cb: (data: T) => void) => {
      const handler = (_e: unknown, data: unknown) => cb(data as T)
      ipcRenderer.on(IPC.CELL_SCROLL, handler)
      return () => ipcRenderer.removeListener(IPC.CELL_SCROLL, handler)
    },
    onGridNav: (cb: (data: { direction: string }) => void) => {
      const handler = (_e: unknown, data: { direction: string }) => cb(data)
      ipcRenderer.on(IPC.GRID_NAV, handler)
      return () => ipcRenderer.removeListener(IPC.GRID_NAV, handler)
    },
    onVoiceClipboard: (cb: (data: { action: 'copy' | 'paste' }) => void) => {
      const handler = (_e: unknown, data: { action: 'copy' | 'paste' }) => cb(data)
      ipcRenderer.on(IPC.VOICE_CLIPBOARD, handler)
      return () => ipcRenderer.removeListener(IPC.VOICE_CLIPBOARD, handler)
    },
  },

  // ─── Messages ──────────────────────────────────────────
  messages: {
    send: (msg: unknown) => ipcRenderer.invoke(IPC.MESSAGES_SEND, msg),
    list: (opts?: unknown) => ipcRenderer.invoke(IPC.MESSAGES_LIST, opts),
    unread: () => ipcRenderer.invoke(IPC.MESSAGES_UNREAD),
    markRead: (messageIds: string[]) =>
      ipcRenderer.invoke(IPC.MESSAGES_MARK_READ, { messageIds }),
    onReceived: <T = unknown>(cb: (msg: T) => void) => {
      const handler = (_e: unknown, msg: unknown) => cb(msg as T)
      ipcRenderer.on(IPC.MESSAGE_RECEIVED, handler)
      return () => ipcRenderer.removeListener(IPC.MESSAGE_RECEIVED, handler)
    },
  },

  // ─── Projects ──────────────────────────────────────────
  projects: {
    kickoff: (opts: unknown) => ipcRenderer.invoke(IPC.PROJECTS_KICKOFF, opts),
    onCompleted: <T = unknown>(cb: (data: T) => void) => {
      const handler = (_e: unknown, data: unknown) => cb(data as T)
      ipcRenderer.on(IPC.PROJECT_KICKOFF_COMPLETED, handler)
      return () => ipcRenderer.removeListener(IPC.PROJECT_KICKOFF_COMPLETED, handler)
    },
  },

  // ─── Context Usage ─────────────────────────────────────
  context: {
    get: (sessionId: string) => ipcRenderer.invoke(IPC.CONTEXT_GET, { sessionId }),
    all: () => ipcRenderer.invoke(IPC.CONTEXT_ALL),
    onUpdated: <T = unknown>(cb: (data: T) => void) => {
      const handler = (_e: unknown, data: unknown) => cb(data as T)
      ipcRenderer.on(IPC.CONTEXT_UPDATED, handler)
      return () => ipcRenderer.removeListener(IPC.CONTEXT_UPDATED, handler)
    },
    onWarning: <T = unknown>(cb: (data: T) => void) => {
      const handler = (_e: unknown, data: unknown) => cb(data as T)
      ipcRenderer.on(IPC.CONTEXT_WARNING, handler)
      return () => ipcRenderer.removeListener(IPC.CONTEXT_WARNING, handler)
    },
  },

  // ─── Config ────────────────────────────────────────────
  config: {
    get: (key: string) => ipcRenderer.invoke(IPC.CONFIG_GET, { key }),
    set: (key: string, value: unknown) => ipcRenderer.invoke(IPC.CONFIG_SET, { key, value }),
    saveGrid: (grid: unknown) => ipcRenderer.invoke(IPC.CONFIG_SAVE_GRID, grid),
    getSkipPermissions: (): Promise<boolean> => ipcRenderer.invoke('cipher-mux:config:get-skip-permissions'),
    setSkipPermissions: (v: boolean): Promise<{ ok: boolean }> => ipcRenderer.invoke('cipher-mux:config:set-skip-permissions', v),
    onThemeChanged: <T = unknown>(cb: (data: T) => void) => {
      const handler = (_e: unknown, data: unknown) => cb(data as T)
      ipcRenderer.on(IPC.THEME_CHANGED, handler)
      return () => ipcRenderer.removeListener(IPC.THEME_CHANGED, handler)
    },
  },

  // ─── Hub ──────────────────────────────────────────────
  hub: {
    projectsDir: (): Promise<string> => ipcRenderer.invoke(IPC.HUB_PROJECTS_DIR),
    setup: (hubPath: string) => ipcRenderer.invoke(IPC.HUB_SETUP, hubPath),
    getPath: () => ipcRenderer.invoke(IPC.HUB_GET_PATH),
    defaultPath: (): Promise<string> => ipcRenderer.invoke(IPC.HUB_DEFAULT_PATH),
  },

  // ─── Dialogs ──────────────────────────────────────────────
  dialog: {
    openFile: (opts?: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }) =>
      ipcRenderer.invoke(IPC.DIALOG_OPEN_FILE, opts),
    openDir: (opts?: { title?: string; defaultPath?: string }) =>
      ipcRenderer.invoke(IPC.DIALOG_OPEN_DIR, opts),
  },

  // ─── Workshop ────────────────────────────────────────
  workshop: {
    start: () => ipcRenderer.invoke(IPC.WORKSHOP_START),
    stop: () => ipcRenderer.invoke(IPC.WORKSHOP_STOP),
    status: () => ipcRenderer.invoke(IPC.WORKSHOP_STATUS),
    onStarted: <T = unknown>(cb: (data: T) => void) => {
      const handler = (_e: unknown, data: unknown) => cb(data as T)
      ipcRenderer.on(IPC.WORKSHOP_STARTED, handler)
      return () => ipcRenderer.removeListener(IPC.WORKSHOP_STARTED, handler)
    },
  },

  // ─── Cyber Factory ─────────────────────────────────────────
  cyberFactory: {
    start: () => ipcRenderer.invoke(IPC.CYBER_FACTORY_START),
    stop: () => ipcRenderer.invoke(IPC.CYBER_FACTORY_STOP),
    status: () => ipcRenderer.invoke(IPC.CYBER_FACTORY_STATUS),
    onStarted: <T = unknown>(cb: (data: T) => void) => {
      const handler = (_e: unknown, data: unknown) => cb(data as T)
      ipcRenderer.on(IPC.CYBER_FACTORY_STARTED, handler)
      return () => ipcRenderer.removeListener(IPC.CYBER_FACTORY_STARTED, handler)
    },
  },

  // ─── Window ──────────────────────────────────────────────
  window: {
    fitGrid: (cols: number, rows: number, panelWidth?: number) => ipcRenderer.invoke(IPC.WINDOW_FIT_GRID, { cols, rows, panelWidth }),
    openWorkspaces: (initialTab?: string) => ipcRenderer.invoke('cipher-mux:window:open-workspaces', initialTab),
  },

  // ─── Sidebar ──────────────────────────────────────────────
  sidebar: {
    detach: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.SIDEBAR_DETACH),
    reattach: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.SIDEBAR_REATTACH),
    dock: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.SIDEBAR_DOCK),
    isDetached: (): Promise<boolean> => ipcRenderer.invoke('cipher-mux:sidebar:is-detached'),
    toggleWindow: (): Promise<{ visible: boolean }> => ipcRenderer.invoke(IPC.SIDEBAR_TOGGLE_WINDOW),
    onReattached: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on(IPC.SIDEBAR_REATTACHED, handler)
      return () => ipcRenderer.removeListener(IPC.SIDEBAR_REATTACHED, handler)
    },
    onClosed: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on(IPC.SIDEBAR_CLOSED, handler)
      return () => ipcRenderer.removeListener(IPC.SIDEBAR_CLOSED, handler)
    },
  },

  // ─── Bugreport ─────────────────────────────────────────
  bugreport: {
    collect: () => ipcRenderer.invoke(IPC.BUGREPORT_COLLECT),
    submit: (description: string, project?: string, screenshots?: string[], reportType?: string) =>
      ipcRenderer.invoke(IPC.BUGREPORT_SUBMIT, { description, project, screenshots, reportType }),
    pickScreenshot: (): Promise<string[]> =>
      ipcRenderer.invoke(IPC.BUGREPORT_PICK_SCREENSHOT),
    dialogOpen: (): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.BUGREPORT_DIALOG_OPEN),
    dialogClose: (): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.BUGREPORT_DIALOG_CLOSE),
    onDialogInsert: (cb: (data: { target: string; text: string }) => void) => {
      const handler = (_e: unknown, data: { target: string; text: string }) => cb(data)
      ipcRenderer.on(IPC.VOICE_DIALOG_INSERT, handler)
      return () => ipcRenderer.removeListener(IPC.VOICE_DIALOG_INSERT, handler)
    },
  },

  // ─── Tasks ──────────────────────────────────────────────
  tasks: {
    list: (filter?: unknown) => ipcRenderer.invoke(IPC.TASKS_LIST, filter),
    get: (id: string) => ipcRenderer.invoke(IPC.TASKS_GET, { id }),
    retry: (id: string) => ipcRenderer.invoke(IPC.TASKS_RETRY, { id }),
    cancel: (id: string) => ipcRenderer.invoke(IPC.TASKS_CANCEL, { id }),
    onCreated: <T = unknown>(cb: (data: T) => void) => {
      const handler = (_e: unknown, data: unknown) => cb(data as T)
      ipcRenderer.on(IPC.TASK_CREATED, handler)
      return () => ipcRenderer.removeListener(IPC.TASK_CREATED, handler)
    },
    onStateChanged: <T = unknown>(cb: (data: T) => void) => {
      const handler = (_e: unknown, data: unknown) => cb(data as T)
      ipcRenderer.on(IPC.TASK_STATE_CHANGED, handler)
      return () => ipcRenderer.removeListener(IPC.TASK_STATE_CHANGED, handler)
    },
  },

  // ─── Notes ──────────────────────────────────────────────
  notes: {
    list: () => ipcRenderer.invoke(IPC.NOTES_LIST),
    search: (query: string, tags?: string[]) => ipcRenderer.invoke(IPC.NOTES_SEARCH, { query, tags }),
    read: (id: string) => ipcRenderer.invoke(IPC.NOTES_READ, { id }),
    save: (id: string, body: string, tags?: string[], skipTagging?: boolean) =>
      ipcRenderer.invoke(IPC.NOTES_SAVE, { id, body, tags, skipTagging }),
    create: (title: string, body: string, tags?: string[]) =>
      ipcRenderer.invoke(IPC.NOTES_CREATE, { title, body, tags }),
    delete: (id: string) =>
      ipcRenderer.invoke(IPC.NOTES_DELETE, { id }),
    trash: (id: string) =>
      ipcRenderer.invoke(IPC.NOTES_TRASH, { id }),
    trashMany: (ids: string[]): Promise<{ trashed: string[] }> =>
      ipcRenderer.invoke(IPC.NOTES_TRASH_MANY, { ids }),
    restore: (id: string) =>
      ipcRenderer.invoke(IPC.NOTES_RESTORE, { id }),
    restoreMany: (ids: string[]): Promise<{ restored: string[] }> =>
      ipcRenderer.invoke(IPC.NOTES_RESTORE_MANY, { ids }),
    bulkTagAdd: (ids: string[], tag: string): Promise<{ updated: string[] }> =>
      ipcRenderer.invoke(IPC.NOTES_BULK_TAG_ADD, { ids, tag }),
    bulkTagRemove: (ids: string[], tag: string): Promise<{ updated: string[] }> =>
      ipcRenderer.invoke(IPC.NOTES_BULK_TAG_REMOVE, { ids, tag }),
    screenshot: (noteId: string, itemId: string): Promise<{ path: string } | null> =>
      ipcRenderer.invoke(IPC.NOTES_SCREENSHOT, { noteId, itemId }),
    parseTestcase: (id: string) =>
      ipcRenderer.invoke(IPC.NOTES_PARSE_TESTCASE, { id }),
    serializeTestcaseBody: (sections: any[]) =>
      ipcRenderer.invoke(IPC.NOTES_SERIALIZE_TESTCASE, { sections }),
    mirrorStatus: (id: string) =>
      ipcRenderer.invoke(IPC.NOTES_MIRROR_STATUS, { id }),
    mirrorRefresh: (id: string) =>
      ipcRenderer.invoke(IPC.NOTES_MIRROR_REFRESH, { id }),
    specOutline: (id: string) =>
      ipcRenderer.invoke(IPC.NOTES_SPEC_OUTLINE, { id }),
    parseRequirements: (id: string) =>
      ipcRenderer.invoke(IPC.NOTES_PARSE_REQUIREMENTS, { id }),
    serializeRequirementsBody: (sections: any[]) =>
      ipcRenderer.invoke(IPC.NOTES_SERIALIZE_REQUIREMENTS, { sections }),
    parseFinding: (id: string) =>
      ipcRenderer.invoke(IPC.NOTES_PARSE_FINDING, { id }),
    serializeFindingBody: (sections: any[]) =>
      ipcRenderer.invoke(IPC.NOTES_SERIALIZE_FINDING, { sections }),
    tags: () => ipcRenderer.invoke(IPC.NOTES_TAGS),
    tagList: (): Promise<Array<{ name: string; count: number; description: string; isSeed: boolean }>> =>
      ipcRenderer.invoke(IPC.NOTES_TAG_LIST),
    tagCreate: (name: string, description: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.NOTES_TAG_CREATE, { name, description }),
    tagRename: (oldName: string, newName: string): Promise<{ ok: boolean; affected: number }> =>
      ipcRenderer.invoke(IPC.NOTES_TAG_RENAME, { oldName, newName }),
    tagUpdate: (name: string, description: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.NOTES_TAG_UPDATE, { name, description }),
    tagDelete: (name: string): Promise<{ ok: boolean; affected: number }> =>
      ipcRenderer.invoke(IPC.NOTES_TAG_DELETE, { name }),
    tagMerge: (sources: string[], target: string): Promise<{ affected: number; error?: string }> =>
      ipcRenderer.invoke(IPC.NOTES_TAG_MERGE, { sources, target }),
    tagClassRepo: () => ipcRenderer.invoke(IPC.NOTES_TAG_CLASS_REPO),
    tagClassCreate: (name: string, color: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.NOTES_TAG_CLASS_CREATE, { name, color }),
    tagClassRename: (oldName: string, newName: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.NOTES_TAG_CLASS_RENAME, { oldName, newName }),
    tagClassDelete: (name: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.NOTES_TAG_CLASS_DELETE, { name }),
    tagClassSetColor: (name: string, color: string): Promise<void> =>
      ipcRenderer.invoke(IPC.NOTES_TAG_CLASS_SET_COLOR, { name, color }),
    tagClassAddValue: (className: string, value: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.NOTES_TAG_CLASS_ADD_VALUE, { className, value }),
    tagClassRemoveValue: (className: string, value: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.NOTES_TAG_CLASS_REMOVE_VALUE, { className, value }),
    tagSynonymsList: (): Promise<Record<string, string>> =>
      ipcRenderer.invoke(IPC.NOTES_TAG_SYNONYMS_LIST),
    tagIndex: () => ipcRenderer.invoke(IPC.NOTES_TAG_INDEX),
    tagIndexRefresh: () => ipcRenderer.invoke(IPC.NOTES_TAG_INDEX_REFRESH),
    onChanged: <T = unknown>(cb: (data: T) => void) => {
      const handler = (_e: unknown, data: unknown) => cb(data as T)
      ipcRenderer.on(IPC.NOTES_CHANGED, handler)
      return () => ipcRenderer.removeListener(IPC.NOTES_CHANGED, handler)
    },
  },

  // ─── Grid Control ───────────────────────────────────────
  gridControl: {
    pullKeepWorkingRestore: (): Promise<{
      gridConfig: { cols: number; rows: number }
      slots: Array<{ sessionId: string | null; slotIndex: number; topic?: string }>
    } | null> => ipcRenderer.invoke(IPC.KEEP_WORKING_PULL),
    resize: (cols: number, rows: number): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.GRID_RESIZE, { cols, rows }),
    place: (sessionId: string, col: number, row: number): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.GRID_PLACE, { sessionId, col, row }),
    focus: (sessionId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.SESSION_FOCUS, { sessionId }),
    eject: (sessionId: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.SESSION_EJECT, { sessionId }),
    sidebarToggle: (visible?: boolean): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.SIDEBAR_TOGGLE, { visible }),
    onGridResize: (cb: (data: { cols: number; rows: number }) => void) => {
      const handler = (_e: unknown, data: { cols: number; rows: number }) => cb(data)
      ipcRenderer.on(IPC.GRID_RESIZE, handler)
      return () => ipcRenderer.removeListener(IPC.GRID_RESIZE, handler)
    },
    onGridPlace: (cb: (data: { sessionId: string; col: number; row: number }) => void) => {
      const handler = (_e: unknown, data: { sessionId: string; col: number; row: number }) => cb(data)
      ipcRenderer.on(IPC.GRID_PLACE, handler)
      return () => ipcRenderer.removeListener(IPC.GRID_PLACE, handler)
    },
    onSessionFocus: (cb: (data: { sessionId: string }) => void) => {
      const handler = (_e: unknown, data: { sessionId: string }) => cb(data)
      ipcRenderer.on(IPC.SESSION_FOCUS, handler)
      return () => ipcRenderer.removeListener(IPC.SESSION_FOCUS, handler)
    },
    onSessionEject: (cb: (data: { sessionId: string }) => void) => {
      const handler = (_e: unknown, data: { sessionId: string }) => cb(data)
      ipcRenderer.on(IPC.SESSION_EJECT, handler)
      return () => ipcRenderer.removeListener(IPC.SESSION_EJECT, handler)
    },
    onSidebarToggle: (cb: (data: { visible?: boolean }) => void) => {
      const handler = (_e: unknown, data: { visible?: boolean }) => cb(data)
      ipcRenderer.on(IPC.SIDEBAR_TOGGLE, handler)
      return () => ipcRenderer.removeListener(IPC.SIDEBAR_TOGGLE, handler)
    },
    onKeepWorkingRestore: (cb: (data: {
      gridConfig: { cols: number; rows: number }
      slots: Array<{ sessionId: string | null; slotIndex: number; topic?: string }>
    }) => void) => {
      const handler = (_e: unknown, data: any) => cb(data)
      ipcRenderer.on(IPC.KEEP_WORKING_RESTORE, handler)
      return () => ipcRenderer.removeListener(IPC.KEEP_WORKING_RESTORE, handler)
    },
    onNotesOpen: (cb: (data: { note: any }) => void) => {
      const handler = (_e: unknown, data: { note: any }) => cb(data)
      ipcRenderer.on(IPC.NOTES_OPEN, handler)
      return () => ipcRenderer.removeListener(IPC.NOTES_OPEN, handler)
    },
  },


  // ─── Personas (legacy) ──────────────────────────────────
  personas: {
    list: (): Promise<Persona[]> => ipcRenderer.invoke('cipher-mux:personas:list'),
    save: (p: unknown): Promise<{ ok: boolean }> => ipcRenderer.invoke('cipher-mux:personas:save', p),
    delete: (id: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('cipher-mux:personas:delete', id),
  },

  // ─── Characters (Companion Persona) ─────────────────────
  characters: {
    list: (): Promise<Character[]> => ipcRenderer.invoke(IPC.CHARACTERS_LIST),
    active: (): Promise<Character> => ipcRenderer.invoke(IPC.CHARACTERS_ACTIVE),
    save: (c: unknown): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.CHARACTERS_SAVE, c),
    delete: (id: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke(IPC.CHARACTERS_DELETE, id),
    switch: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.CHARACTERS_SWITCH, id),
    getGlobalPersona: (): Promise<string | null> => ipcRenderer.invoke(IPC.CHARACTERS_GLOBAL_PERSONA_GET),
    setGlobalPersona: (id: string | null): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.CHARACTERS_GLOBAL_PERSONA_SET, id),
    getEntityPersonaOverride: (entityId: string): Promise<string | null> => ipcRenderer.invoke(IPC.ENTITY_PERSONA_OVERRIDE_GET, entityId),
    setEntityPersonaOverride: (entityId: string, characterId: string | null): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.ENTITY_PERSONA_OVERRIDE_SET, entityId, characterId),
  },

  // ─── Welche CLI startet was ──────────────────────────────
  agent: {
    /** Alle registrierten Adapter samt Capabilities — die UI zeigt damit, was fehlt. */
    listAdapters: (): Promise<Array<{
      id: string
      displayName: string
      tier: 'tier-1' | 'tier-2'
      capabilities: Record<string, boolean> | null
    }>> => ipcRenderer.invoke(IPC.AGENT_ADAPTERS_LIST),
    getDefaultAdapter: (): Promise<string> => ipcRenderer.invoke(IPC.AGENT_DEFAULT_ADAPTER_GET),
    setDefaultAdapter: (adapterId: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.AGENT_DEFAULT_ADAPTER_SET, adapterId),
    /** `null` = keine Praeferenz fuer diese Rolle, nicht „Adapter mit leerem Namen". */
    getEntityAdapter: (entityId: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.ENTITY_ADAPTER_GET, entityId),
    setEntityAdapter: (entityId: string, adapterId: string | null): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.ENTITY_ADAPTER_SET, entityId, adapterId),
    /**
     * Was die CLI an Modellen anbietet. Leere Liste heisst: nicht auflistbar
     * oder Aufruf gescheitert — dann bleibt das Freitextfeld.
     */
    /**
     * Ob die ausgelieferte preset.md dieser Rolle hinter ihrer Code-Vorlage
     * liegt. `null` heisst: keine Vorlage, also nichts zu vergleichen.
     */
    presetTemplateStatus: (entityId: string): Promise<{
      status: string
      fileVersion: number | null
      templateVersion: number | null
      stale: boolean
    } | null> => ipcRenderer.invoke(IPC.PRESET_TEMPLATE_STATUS, entityId),
    /**
     * Die Code-Vorlage uebernehmen. Schreibt vorher eine Sicherung daneben und
     * gibt deren Pfad zurueck — `unchanged`, wenn die Datei schon gleich war.
     */
    presetTemplateApply: (entityId: string): Promise<{
      ok: boolean
      backupPath?: string | null
      unchanged?: boolean
      error?: string
    }> => ipcRenderer.invoke(IPC.PRESET_TEMPLATE_APPLY, entityId),
    listModels: (adapterId: string): Promise<Array<{
      id: string
      label: string
      contextWindow?: number
      description?: string
    }>> => ipcRenderer.invoke(IPC.AGENT_MODELS_LIST, adapterId),
    /** `null` = keine Praeferenz, die CLI entscheidet selbst. */
    getEntityModel: (entityId: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.ENTITY_MODEL_GET, entityId),
    setEntityModel: (entityId: string, model: string | null): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.ENTITY_MODEL_SET, entityId, model),
  },

  // ─── Workspaces ──────────────────────────────────────────
  workspaces: {
    list: (): Promise<Workspace[]> => ipcRenderer.invoke('cipher-mux:workspaces:list'),
    save: (ws: unknown): Promise<{ ok: boolean }> => ipcRenderer.invoke('cipher-mux:workspaces:save', ws),
    delete: (id: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('cipher-mux:workspaces:delete', id),
    apply: (id: string): Promise<{ applied: boolean; sessionsStarted?: number; warnings?: string[]; sessions?: Array<{ cellIndex: number; sessionId: string }> }> => ipcRenderer.invoke('cipher-mux:workspaces:apply', id),
    active: (id?: string): Promise<string | null> => ipcRenderer.invoke('cipher-mux:workspaces:active', id),
    onChanged: <T = unknown>(cb: (data: T) => void) => {
      const handler = (_e: unknown, data: unknown) => cb(data as T)
      ipcRenderer.on(IPC.WORKSPACES_CHANGED, handler)
      return () => { ipcRenderer.removeListener(IPC.WORKSPACES_CHANGED, handler) }
    },
  },

  // ─── Entities ──────────────────────────────────────────
  entity: {
    start: (entityId: string, workspaceId?: string | null) =>
      // Do not coalesce: undefined ("no preference") and null ("explicitly
      // unbound") must both survive the IPC boundary distinctly. Structured
      // clone preserves `undefined` as a property value, so a straight
      // pass-through keeps all three states (undefined / null / string).
      ipcRenderer.invoke(IPC.ENTITY_START, { entityId, workspaceId }),
    // Same no-coalescing rule as start(): undefined / null / string are three
    // distinct answers and all three must reach main unchanged.
    resume: (entityId: string, sessionId?: string, workspaceId?: string | null) =>
      ipcRenderer.invoke(IPC.ENTITY_RESUME, { entityId, sessionId, workspaceId }),
    stop: (entityId: string) => ipcRenderer.invoke(IPC.ENTITY_STOP, { entityId }),
    status: (entityId: string) => ipcRenderer.invoke(IPC.ENTITY_STATUS, { entityId }),
    list: () => ipcRenderer.invoke(IPC.ENTITY_LIST),
    onStarted: (cb: (data: { entityId: string; session: unknown }) => void) => {
      const handler = (_e: unknown, data: { entityId: string; session: unknown }) => cb(data)
      ipcRenderer.on(IPC.ENTITY_STARTED, handler)
      return () => ipcRenderer.removeListener(IPC.ENTITY_STARTED, handler)
    },
  },

  // ─── Presets ──────────────────────────────────────────────
  presets: {
    list: () => ipcRenderer.invoke(IPC.PRESETS_LIST),
    read: (entityId: string) => ipcRenderer.invoke(IPC.PRESETS_READ, { entityId }),
    save: (entityId: string, content: string) => ipcRenderer.invoke(IPC.PRESETS_SAVE, { entityId, content }),
    create: (entityId: string, displayName: string) => ipcRenderer.invoke(IPC.PRESETS_CREATE, { entityId, displayName }),
    delete: (entityId: string) => ipcRenderer.invoke(IPC.PRESETS_DELETE, { entityId }),
    readInjected: (entityId: string) => ipcRenderer.invoke(IPC.PRESETS_READ_INJECTED, { entityId }),
  },

  // ─── Global Rules ──────────────────────────────────────
  globalRules: {
    read: () => ipcRenderer.invoke(IPC.GLOBAL_RULES_READ),
    save: (content: string) => ipcRenderer.invoke(IPC.GLOBAL_RULES_SAVE, { content }),
  },

  // ─── Voice ──────────────────────────────────────────────
  voice: {
    available: () => ipcRenderer.invoke(IPC.VOICE_AVAILABLE),
    start: () => ipcRenderer.invoke(IPC.VOICE_START),
    stop: () => ipcRenderer.invoke(IPC.VOICE_STOP),
    sendAudioChunk: (chunk: ArrayBuffer) =>
      ipcRenderer.send(IPC.VOICE_AUDIO_CHUNK, chunk),
    playbackDone: () => ipcRenderer.send(IPC.VOICE_PLAYBACK_DONE),
    onState: (cb: (state: string) => void) => {
      const handler = (_e: unknown, state: string) => cb(state)
      ipcRenderer.on(IPC.VOICE_STATE, handler)
      return () => ipcRenderer.removeListener(IPC.VOICE_STATE, handler)
    },
    onTranscription: (cb: (text: string) => void) => {
      const handler = (_e: unknown, text: string) => cb(text)
      ipcRenderer.on(IPC.VOICE_TRANSCRIPTION, handler)
      return () => ipcRenderer.removeListener(IPC.VOICE_TRANSCRIPTION, handler)
    },
    onAgentText: (cb: (text: string) => void) => {
      const handler = (_e: unknown, text: string) => cb(text)
      ipcRenderer.on(IPC.VOICE_AGENT_TEXT, handler)
      return () => ipcRenderer.removeListener(IPC.VOICE_AGENT_TEXT, handler)
    },
    onAgentAudio: (cb: (base64Wav: string) => void) => {
      const handler = (_e: unknown, b64: string) => cb(b64)
      ipcRenderer.on(IPC.VOICE_AGENT_AUDIO, handler)
      return () => ipcRenderer.removeListener(IPC.VOICE_AGENT_AUDIO, handler)
    },
    onInterviewDone: (cb: (report: string) => void) => {
      const handler = (_e: unknown, report: string) => cb(report)
      ipcRenderer.on(IPC.VOICE_INTERVIEW_DONE, handler)
      return () => ipcRenderer.removeListener(IPC.VOICE_INTERVIEW_DONE, handler)
    },
    onError: (cb: (msg: string) => void) => {
      const handler = (_e: unknown, msg: string) => cb(msg)
      ipcRenderer.on(IPC.VOICE_ERROR, handler)
      return () => ipcRenderer.removeListener(IPC.VOICE_ERROR, handler)
    },
    vadSpeechStart: () => ipcRenderer.send(IPC.VOICE_VAD_SPEECH_START),
    vadSpeechEnd: (audioData: number[]) => ipcRenderer.send(IPC.VOICE_VAD_SPEECH_END, audioData),
    vadMisfire: () => ipcRenderer.send(IPC.VOICE_VAD_MISFIRE),
    bargeIn: () => ipcRenderer.send(IPC.VOICE_BARGE_IN),
    onGenerationDone: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on(IPC.VOICE_GENERATION_DONE, handler)
      return () => ipcRenderer.removeListener(IPC.VOICE_GENERATION_DONE, handler)
    },
    onStopPlayback: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on(IPC.VOICE_STOP_PLAYBACK, handler)
      return () => ipcRenderer.removeListener(IPC.VOICE_STOP_PLAYBACK, handler)
    },
    // Session voice input
    startSession: () => ipcRenderer.invoke(IPC.VOICE_START_SESSION),
    startCom: () => ipcRenderer.invoke(IPC.VOICE_START_COM),
    stopCom: () => ipcRenderer.invoke(IPC.VOICE_STOP_COM),
    setRoutingMode: (mode: 'session' | 'off') =>
      ipcRenderer.send(IPC.VOICE_SET_ROUTING_MODE, { mode }),
    setSessionTarget: (sessionId: string | null) =>
      ipcRenderer.send(IPC.VOICE_SESSION_TARGET, { sessionId }),
    onDispatched: (cb: (data: { sessionId: string; sessionName: string; text: string }) => void) => {
      const handler = (_e: unknown, data: { sessionId: string; sessionName: string; text: string }) => cb(data)
      ipcRenderer.on(IPC.VOICE_DISPATCHED, handler)
      return () => ipcRenderer.removeListener(IPC.VOICE_DISPATCHED, handler)
    },
    onComState: (cb: (state: string) => void) => {
      const handler = (_e: unknown, state: string) => cb(state)
      ipcRenderer.on(IPC.VOICE_COM_STATE, handler)
      return () => ipcRenderer.removeListener(IPC.VOICE_COM_STATE, handler)
    },
    pinSession: (sessionId: string | null) =>
      ipcRenderer.send(IPC.VOICE_PIN, { sessionId }),
    onPinStatus: (cb: (data: { pinned: boolean; sessionId: string | null }) => void) => {
      const handler = (_e: unknown, data: { pinned: boolean; sessionId: string | null }) => cb(data)
      ipcRenderer.on(IPC.VOICE_PIN_STATUS, handler)
      return () => ipcRenderer.removeListener(IPC.VOICE_PIN_STATUS, handler)
    },
    onActiveSession: (cb: (data: { sessionId: string | null }) => void) => {
      const handler = (_e: unknown, data: { sessionId: string | null }) => cb(data)
      ipcRenderer.on(IPC.VOICE_ACTIVE_SESSION, handler)
      return () => ipcRenderer.removeListener(IPC.VOICE_ACTIVE_SESSION, handler)
    },
    setNotesFocus: (focused: boolean) =>
      ipcRenderer.send(IPC.VOICE_NOTES_FOCUS, { focused }),
    onNotesInsert: (cb: (data: { text: string }) => void) => {
      const handler = (_e: unknown, data: { text: string }) => cb(data)
      ipcRenderer.on(IPC.VOICE_NOTES_INSERT, handler)
      return () => ipcRenderer.removeListener(IPC.VOICE_NOTES_INSERT, handler)
    },
    speak: (text: string) => ipcRenderer.invoke('cipher-mux:tts:speak', { text }),
    stopSpeech: () => ipcRenderer.invoke('cipher-mux:tts:stop'),
    // Voice catalog management
    listInstalled: () => ipcRenderer.invoke(IPC.VOICE_LIST_INSTALLED),
    catalogSearch: (query?: string) => ipcRenderer.invoke(IPC.VOICE_CATALOG_SEARCH, query),
    download: (name: string) => ipcRenderer.invoke(IPC.VOICE_DOWNLOAD, { name }),
    onDownloadProgress: (cb: (data: { voice: string; file: string; percent: number; bytesDownloaded: number; bytesTotal: number }) => void) => {
      const handler = (_e: unknown, data: { voice: string; file: string; percent: number; bytesDownloaded: number; bytesTotal: number }) => cb(data)
      ipcRenderer.on(IPC.VOICE_DOWNLOAD_PROGRESS, handler)
      return () => ipcRenderer.removeListener(IPC.VOICE_DOWNLOAD_PROGRESS, handler)
    },
    deleteVoice: (name: string) => ipcRenderer.invoke(IPC.VOICE_DELETE, { name }),
    setActive: (name: string) => ipcRenderer.invoke(IPC.VOICE_SET_ACTIVE, { name }),
    preview: (name: string) => ipcRenderer.invoke(IPC.VOICE_PREVIEW, { name }),
    recommendDownloads: () => ipcRenderer.invoke(IPC.VOICE_RECOMMEND_DOWNLOADS),
  },

  // ─── BT Remote ────────────────────────────────────────
  btRemote: {
    onEvent: (cb: (data: any) => void) => {
      const handler = (_e: unknown, data: any) => cb(data)
      ipcRenderer.on(IPC.BT_REMOTE_EVENT, handler)
      return () => ipcRenderer.removeListener(IPC.BT_REMOTE_EVENT, handler)
    },
    onStatus: (cb: (data: { status: string; error?: string }) => void) => {
      const handler = (_e: unknown, data: { status: string; error?: string }) => cb(data)
      ipcRenderer.on(IPC.BT_REMOTE_STATUS, handler)
      return () => ipcRenderer.removeListener(IPC.BT_REMOTE_STATUS, handler)
    },
    onDevices: (cb: (devices: any[]) => void) => {
      const handler = (_e: unknown, devices: any[]) => cb(devices)
      ipcRenderer.on(IPC.BT_REMOTE_DEVICES, handler)
      return () => ipcRenderer.removeListener(IPC.BT_REMOTE_DEVICES, handler)
    },
    getMapping: () => ipcRenderer.invoke(IPC.BT_REMOTE_MAPPING_GET),
    setMapping: (vid: string, pid: string, buttonId: string, action: string) =>
      ipcRenderer.invoke(IPC.BT_REMOTE_MAPPING_SET, { vid, pid, buttonId, action }),
  },
  // Legacy alias
  btShutter: {
    onEvent: (cb: (data: any) => void) => {
      const handler = (_e: unknown, data: any) => cb(data)
      ipcRenderer.on(IPC.BT_SHUTTER_EVENT, handler)
      return () => ipcRenderer.removeListener(IPC.BT_SHUTTER_EVENT, handler)
    },
    onStatus: (cb: (data: { status: string; error?: string }) => void) => {
      const handler = (_e: unknown, data: { status: string; error?: string }) => cb(data)
      ipcRenderer.on(IPC.BT_SHUTTER_STATUS, handler)
      return () => ipcRenderer.removeListener(IPC.BT_SHUTTER_STATUS, handler)
    },
  },

  // ─── UI Control (Companion Demo Mode) ────────────────────
  ui: {
    onHighlight: (cb: (data: { target?: string; duration?: number; style?: string; clear?: boolean }) => void) => {
      const handler = (_e: unknown, data: { target?: string; duration?: number; style?: string; clear?: boolean }) => cb(data)
      ipcRenderer.on(IPC.UI_HIGHLIGHT, handler)
      return () => ipcRenderer.removeListener(IPC.UI_HIGHLIGHT, handler)
    },
    onOpen: (cb: (data: { target: string; context?: Record<string, unknown> }) => void) => {
      const handler = (_e: unknown, data: { target: string; context?: Record<string, unknown> }) => cb(data)
      ipcRenderer.on(IPC.UI_OPEN, handler)
      return () => ipcRenderer.removeListener(IPC.UI_OPEN, handler)
    },
    onThemeSet: (cb: (data: { theme: string }) => void) => {
      const handler = (_e: unknown, data: { theme: string }) => cb(data)
      ipcRenderer.on(IPC.THEME_SET, handler)
      return () => ipcRenderer.removeListener(IPC.THEME_SET, handler)
    },
  },

  // ─── Setup Wizard ──────────────────────────────────────────
  setup: {
    check: () => ipcRenderer.invoke(IPC.SETUP_CHECK),
    installAll: (opts?: { selectedIds?: string[] }) => ipcRenderer.invoke(IPC.SETUP_INSTALL_ALL, opts),
    skip: () => ipcRenderer.invoke(IPC.SETUP_SKIP),
    onProgress: <T = unknown>(cb: (data: T) => void) => {
      const handler = (_e: unknown, data: unknown) => cb(data as T)
      ipcRenderer.on(IPC.SETUP_PROGRESS, handler)
      return () => ipcRenderer.removeListener(IPC.SETUP_PROGRESS, handler)
    },
  },

  // ─── Companion Memory ────────────────────────────────────
  companion: {
    recall: (limit?: number) => ipcRenderer.invoke(IPC.COMPANION_RECALL, { limit }),
    listMemories: (opts?: { limit?: number; kind?: string; since?: number }) =>
      ipcRenderer.invoke(IPC.COMPANION_LIST_MEMORIES, opts),
    search: (query: string, limit?: number) =>
      ipcRenderer.invoke(IPC.COMPANION_SEARCH, { query, limit }),
    deleteMemory: (id: string) =>
      ipcRenderer.invoke(IPC.COMPANION_DELETE_MEMORY, { id }),
  },
  // ─── Updates ──────────────────────────────────────────────
  update: {
    check: () => ipcRenderer.invoke(IPC.UPDATE_CHECK),
    dismiss: (version: string) => ipcRenderer.send(IPC.UPDATE_DISMISS, version),
    onAvailable: (cb: (info: unknown) => void) => {
      const handler = (_e: unknown, info: unknown) => cb(info)
      ipcRenderer.on(IPC.UPDATE_AVAILABLE, handler)
      return () => ipcRenderer.removeListener(IPC.UPDATE_AVAILABLE, handler)
    },
  },

  // ─── Detachable Windows ────────────────────────────────
  detach: {
    session: (sessionId: string): Promise<void> =>
      ipcRenderer.invoke(IPC.DETACH_SESSION, { sessionId }).then(() => undefined),
    note: (noteId: string): Promise<void> =>
      ipcRenderer.invoke(IPC.DETACH_NOTE, { noteId }).then(() => undefined),
    dock: (entityId: string): Promise<void> =>
      ipcRenderer.invoke(IPC.DOCK_REQUEST, { entityId }).then(() => undefined),
    list: (): Promise<Array<{ type: string; entityId: string }>> =>
      ipcRenderer.invoke(IPC.DETACH_LIST),
    hasDetached: (): Promise<boolean> =>
      ipcRenderer.invoke(IPC.DETACH_HAS_DETACHED),
    onStateChanged: (cb: (data: { entries: Array<{ type: string; entityId: string }> }) => void) => {
      const handler = (_e: unknown, data: { entries: Array<{ type: string; entityId: string }> }) => cb(data)
      ipcRenderer.on(IPC.DETACH_STATE_CHANGED, handler)
      return () => ipcRenderer.removeListener(IPC.DETACH_STATE_CHANGED, handler)
    },
  },

  /** Get native file path from a dropped File object (works with contextIsolation). */
  getFilePath: (file: File) => webUtils.getPathForFile(file),

  /** Open URL in system browser. */
  openExternal: (url: string) => ipcRenderer.invoke(IPC.OPEN_EXTERNAL, url),

  /** Runtime version info for the About page. */
  versions: {
    electron: process.versions.electron ?? '—',
    node: process.versions.node ?? '—',
    chrome: process.versions.chrome ?? '—',
  },
}

contextBridge.exposeInMainWorld('cipherMux', api)

// Type declaration for renderer
export type CipherMuxApi = typeof api
