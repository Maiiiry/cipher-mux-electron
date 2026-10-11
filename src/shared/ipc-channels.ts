/** Typed IPC channel constants — all prefixed with cipher-mux: */

export const IPC = {
  // Sessions
  SESSIONS_LIST: 'cipher-mux:sessions:list',
  SESSIONS_START: 'cipher-mux:sessions:start',
  SESSIONS_STOP: 'cipher-mux:sessions:stop',
  SESSIONS_RECOVER: 'cipher-mux:sessions:recover',
  SESSIONS_RECOVERY_RESULT: 'cipher-mux:sessions:recovery-result',
  SESSIONS_RECOVERY_ACTION: 'cipher-mux:sessions:recovery-action',
  SESSIONS_RECOVERY_DECLINE: 'cipher-mux:sessions:recovery-decline',
  SESSION_CHANGED: 'cipher-mux:session-changed',
  SESSION_CLOSING: 'cipher-mux:session-closing',
  SESSION_STOPPED: 'cipher-mux:session-stopped',
  SESSION_VISIBLE_ADD: 'cipher-mux:session:visible-add',
  SESSION_FORK: 'cipher-mux:session:fork',
  SESSION_ORPHANS: 'cipher-mux:session:orphans',
  SESSION_ORPHANS_DETECTED: 'cipher-mux:session:orphans-detected',

  // Terminals
  TERMINAL_DATA: 'cipher-mux:terminal:data',
  TERMINAL_WRITE: 'cipher-mux:terminal:write',
  TERMINAL_RESIZE: 'cipher-mux:terminal:resize',
  TERMINAL_SPLIT: 'cipher-mux:terminal:split',
  TERMINAL_CAPTURE: 'cipher-mux:terminal:capture',
  TERMINAL_SNAPSHOT: 'cipher-mux:terminal:snapshot',
  TERMINAL_READY: 'cipher-mux:terminal:ready',

  // Message Bus
  MESSAGES_SEND: 'cipher-mux:messages:send',
  MESSAGES_LIST: 'cipher-mux:messages:list',
  MESSAGES_UNREAD: 'cipher-mux:messages:unread',
  MESSAGES_MARK_READ: 'cipher-mux:messages:mark-read',
  MESSAGE_RECEIVED: 'cipher-mux:message-received',

  // Projects
  PROJECTS_KICKOFF: 'cipher-mux:projects:kickoff',
  PROJECT_KICKOFF_COMPLETED: 'cipher-mux:projects:kickoff-completed',

  // Context Usage
  CONTEXT_GET: 'cipher-mux:context:get',
  CONTEXT_ALL: 'cipher-mux:context:all',
  CONTEXT_UPDATED: 'cipher-mux:context:updated',
  CONTEXT_WARNING: 'cipher-mux:context:warning',

  // Config
  CONFIG_GET: 'cipher-mux:config:get',
  CONFIG_SET: 'cipher-mux:config:set',
  CONFIG_SAVE_GRID: 'cipher-mux:config:save-grid',

  // Dialogs
  DIALOG_OPEN_FILE: 'cipher-mux:dialog:open-file',
  DIALOG_OPEN_DIR: 'cipher-mux:dialog:open-dir',

  // Workshop
  WORKSHOP_START: 'cipher-mux:workshop:start',
  WORKSHOP_STOP: 'cipher-mux:workshop:stop',
  WORKSHOP_STATUS: 'cipher-mux:workshop:status',
  WORKSHOP_STARTED: 'cipher-mux:workshop:started',

  // Cyber Factory
  CYBER_FACTORY_START: 'cipher-mux:cyber-factory:start',
  CYBER_FACTORY_STOP: 'cipher-mux:cyber-factory:stop',
  CYBER_FACTORY_STATUS: 'cipher-mux:cyber-factory:status',
  CYBER_FACTORY_STARTED: 'cipher-mux:cyber-factory:started',
  CYBER_FACTORY_RUN_STATUS: 'cipher-mux:cyber-factory:run-status',
  CYBER_FACTORY_WELLE_LIST: 'cipher-mux:cyber-factory:welle-list',
  CYBER_FACTORY_WORKER_STATUS: 'cipher-mux:cyber-factory:worker-status',

  // Debugger
  DEBUGGER_RUN_START: 'cipher-mux:debugger:run-start',
  DEBUGGER_RUN_STATUS: 'cipher-mux:debugger:run-status',
  DEBUGGER_RUN_CANCEL: 'cipher-mux:debugger:run-cancel',
  DEBUGGER_CLARIFICATION_NEW: 'cipher-mux:debugger:clarification-new',
  DEBUGGER_CLARIFICATION_RESOLVE: 'cipher-mux:debugger:clarification-resolve',
  DEBUGGER_FIX_PLAN_CONFIRM: 'cipher-mux:debugger:fix-plan-confirm',
  DEBUGGER_WALKTHROUGH_REQUEST: 'cipher-mux:debugger:walkthrough-request',

  // Testing Assistant
  TESTING_RUN_START: 'cipher-mux:testing:run-start',
  TESTING_RUN_STATUS: 'cipher-mux:testing:run-status',
  TESTING_RUN_COMPLETE: 'cipher-mux:testing:run-complete',
  TESTING_FINDINGS_LIST: 'cipher-mux:testing:findings-list',

  // Audit
  AUDIT_RUN_START: 'cipher-mux:audit:run-start',
  AUDIT_RUN_STATUS: 'cipher-mux:audit:run-status',
  AUDIT_RUN_COMPLETE: 'cipher-mux:audit:run-complete',

  // Window
  WINDOW_FIT_GRID: 'cipher-mux:window:fit-grid',
  WINDOW_OPEN_WORKSPACES: 'cipher-mux:window:open-workspaces',

  // Bugreport
  BUGREPORT_COLLECT: 'cipher-mux:bugreport:collect',
  BUGREPORT_SUBMIT: 'cipher-mux:bugreport:submit',
  BUGREPORT_PROCESS: 'cipher-mux:bugreport:process',
  BUGREPORT_PICK_SCREENSHOT: 'cipher-mux:bugreport:pick-screenshot',
  BUGREPORT_DIALOG_OPEN: 'cipher-mux:bugreport:dialog-open',
  BUGREPORT_DIALOG_CLOSE: 'cipher-mux:bugreport:dialog-close',
  VOICE_DIALOG_INSERT: 'cipher-mux:voice:dialog-insert',

  // Voice
  VOICE_AVAILABLE: 'cipher-mux:voice:available',
  VOICE_START: 'cipher-mux:voice:start',
  VOICE_STOP: 'cipher-mux:voice:stop',
  VOICE_AUDIO_CHUNK: 'cipher-mux:voice:audio-chunk',
  VOICE_STATE: 'cipher-mux:voice:state',
  VOICE_TRANSCRIPTION: 'cipher-mux:voice:transcription',
  VOICE_AGENT_TEXT: 'cipher-mux:voice:agent-text',
  VOICE_AGENT_AUDIO: 'cipher-mux:voice:agent-audio',
  VOICE_INTERVIEW_DONE: 'cipher-mux:voice:interview-done',
  VOICE_PLAYBACK_DONE: 'cipher-mux:voice:playback-done',
  VOICE_ERROR: 'cipher-mux:voice:error',
  VOICE_VAD_SPEECH_START: 'cipher-mux:voice:vad-speech-start',
  VOICE_VAD_SPEECH_END: 'cipher-mux:voice:vad-speech-end',
  VOICE_VAD_MISFIRE: 'cipher-mux:voice:vad-misfire',
  VOICE_BARGE_IN: 'cipher-mux:voice:barge-in',
  VOICE_GENERATION_DONE: 'cipher-mux:voice:generation-done',
  VOICE_STOP_PLAYBACK: 'cipher-mux:voice:stop-playback',

  // Voice Catalog
  VOICE_LIST_INSTALLED: 'cipher-mux:voice:list-installed',
  VOICE_CATALOG_SEARCH: 'cipher-mux:voice:catalog-search',
  VOICE_DOWNLOAD: 'cipher-mux:voice:download',
  VOICE_DOWNLOAD_PROGRESS: 'cipher-mux:voice:download-progress',
  VOICE_DELETE: 'cipher-mux:voice:delete',
  VOICE_SET_ACTIVE: 'cipher-mux:voice:set-active',
  VOICE_PREVIEW: 'cipher-mux:voice:preview',
  VOICE_RECOMMEND_DOWNLOADS: 'cipher-mux:voice:recommend-downloads',

  // Voice Session Input
  VOICE_START_SESSION: 'cipher-mux:voice:start-session',
  VOICE_START_COM: 'cipher-mux:voice:start-com',
  VOICE_STOP_COM: 'cipher-mux:voice:stop-com',
  VOICE_SET_ROUTING_MODE: 'cipher-mux:voice:set-routing-mode',
  VOICE_SESSION_TARGET: 'cipher-mux:voice:session-target',
  VOICE_DISPATCHED: 'cipher-mux:voice:dispatched',
  VOICE_COM_STATE: 'cipher-mux:voice:com-state',
  VOICE_PIN: 'cipher-mux:voice:pin',
  VOICE_PIN_STATUS: 'cipher-mux:voice:pin-status',
  VOICE_ACTIVE_SESSION: 'cipher-mux:voice:active-session',
  VOICE_NOTES_FOCUS: 'cipher-mux:voice:notes-focus',
  VOICE_NOTES_INSERT: 'cipher-mux:voice:notes-insert',

  // Personas
  PERSONAS_LIST: 'cipher-mux:personas:list',
  PERSONAS_SAVE: 'cipher-mux:personas:save',
  PERSONAS_DELETE: 'cipher-mux:personas:delete',

  // Workspaces
  WORKSPACES_LIST: 'cipher-mux:workspaces:list',
  WORKSPACES_SAVE: 'cipher-mux:workspaces:save',
  WORKSPACES_DELETE: 'cipher-mux:workspaces:delete',
  WORKSPACES_APPLY: 'cipher-mux:workspaces:apply',
  WORKSPACES_ACTIVE: 'cipher-mux:workspaces:active',
  WORKSPACES_CHANGED: 'cipher-mux:workspaces:changed',

  // Theme
  THEME_CHANGED: 'cipher-mux:theme:changed',

  // Sidebar
  SIDEBAR_DETACH: 'cipher-mux:sidebar:detach',
  SIDEBAR_REATTACH: 'cipher-mux:sidebar:reattach',
  SIDEBAR_REATTACHED: 'cipher-mux:sidebar:reattached',
  SIDEBAR_CLOSED: 'cipher-mux:sidebar:closed',
  SIDEBAR_DOCK: 'cipher-mux:sidebar:dock',
  SIDEBAR_TOGGLE_WINDOW: 'cipher-mux:sidebar:toggle-window',

  // Tasks
  TASKS_LIST: 'cipher-mux:tasks:list',
  TASKS_GET: 'cipher-mux:tasks:get',
  TASKS_RETRY: 'cipher-mux:tasks:retry',
  TASKS_CANCEL: 'cipher-mux:tasks:cancel',
  TASK_CREATED: 'cipher-mux:task:created',
  TASK_STATE_CHANGED: 'cipher-mux:task:state-changed',

  // Notes
  NOTES_LIST: 'cipher-mux:notes:list',
  NOTES_READ: 'cipher-mux:notes:read',
  NOTES_SAVE: 'cipher-mux:notes:save',
  NOTES_CREATE: 'cipher-mux:notes:create',
  NOTES_DELETE: 'cipher-mux:notes:delete',
  NOTES_TRASH: 'cipher-mux:notes:trash',
  NOTES_TRASH_MANY: 'cipher-mux:notes:trash-many',
  NOTES_RESTORE: 'cipher-mux:notes:restore',
  NOTES_RESTORE_MANY: 'cipher-mux:notes:restore-many',
  NOTES_BULK_TAG_ADD: 'cipher-mux:notes:bulk-tag-add',
  NOTES_BULK_TAG_REMOVE: 'cipher-mux:notes:bulk-tag-remove',
  NOTES_TAGS: 'cipher-mux:notes:tags',
  NOTES_TAG_LIST: 'cipher-mux:notes:tag-list',
  NOTES_TAG_CREATE: 'cipher-mux:notes:tag-create',
  NOTES_TAG_RENAME: 'cipher-mux:notes:tag-rename',
  NOTES_TAG_UPDATE: 'cipher-mux:notes:tag-update',
  NOTES_TAG_DELETE: 'cipher-mux:notes:tag-delete',
  NOTES_TAG_MERGE: 'cipher-mux:notes:tag-merge',
  NOTES_SCREENSHOT: 'cipher-mux:notes:screenshot',
  NOTES_PARSE_TESTCASE: 'cipher-mux:notes:parse-testcase',
  NOTES_SERIALIZE_TESTCASE: 'cipher-mux:notes:serialize-testcase',
  NOTES_PARSE_FINDING: 'cipher-mux:notes:parse-finding',
  NOTES_SERIALIZE_FINDING: 'cipher-mux:notes:serialize-finding',
  NOTES_MIRROR_STATUS: 'cipher-mux:notes:mirror-status',
  NOTES_MIRROR_REFRESH: 'cipher-mux:notes:mirror-refresh',
  NOTES_SPEC_OUTLINE: 'cipher-mux:notes:spec-outline',
  NOTES_PARSE_REQUIREMENTS: 'cipher-mux:notes:parse-requirements',
  NOTES_SERIALIZE_REQUIREMENTS: 'cipher-mux:notes:serialize-requirements',
  NOTES_SEARCH: 'cipher-mux:notes:search',
  NOTES_TAG_CLASS_REPO: 'cipher-mux:notes:tag-class-repo',
  NOTES_TAG_CLASS_CREATE: 'cipher-mux:notes:tag-class-create',
  NOTES_TAG_CLASS_RENAME: 'cipher-mux:notes:tag-class-rename',
  NOTES_TAG_CLASS_DELETE: 'cipher-mux:notes:tag-class-delete',
  NOTES_TAG_CLASS_SET_COLOR: 'cipher-mux:notes:tag-class-set-color',
  NOTES_TAG_CLASS_ADD_VALUE: 'cipher-mux:notes:tag-class-add-value',
  NOTES_TAG_CLASS_REMOVE_VALUE: 'cipher-mux:notes:tag-class-remove-value',
  NOTES_TAG_SYNONYMS_LIST: 'cipher-mux:notes:tag-synonyms-list',
  NOTES_TAG_INDEX: 'cipher-mux:notes:tag-index',
  NOTES_TAG_INDEX_REFRESH: 'cipher-mux:notes:tag-index-refresh',
  NOTES_CHANGED: 'cipher-mux:notes:changed',
  NOTES_OPEN: 'cipher-mux:notes:open',

  // Grid Control (MCP App-Control)
  GRID_RESIZE: 'cipher-mux:grid:resize',
  GRID_PLACE: 'cipher-mux:grid:place',
  SESSION_FOCUS: 'cipher-mux:session:focus',
  SESSION_EJECT: 'cipher-mux:session:eject',
  SIDEBAR_TOGGLE: 'cipher-mux:sidebar:toggle',
  CELL_SCROLL: 'cipher-mux:cell:scroll',
  GRID_NAV: 'cipher-mux:grid:nav',
  VOICE_CLIPBOARD: 'cipher-mux:voice:clipboard',
  KEEP_WORKING_RESTORE: 'cipher-mux:keep-working:restore',
  KEEP_WORKING_PULL: 'cipher-mux:keep-working:pull',

  // Companion Memory
  COMPANION_RECALL: 'cipher-mux:companion:recall',
  COMPANION_LIST_MEMORIES: 'cipher-mux:companion:list-memories',
  COMPANION_DELETE_MEMORY: 'cipher-mux:companion:delete-memory',
  COMPANION_SEARCH: 'cipher-mux:companion:search',

  // Characters (Companion Persona)
  CHARACTERS_LIST: 'cipher-mux:characters:list',
  CHARACTERS_SAVE: 'cipher-mux:characters:save',
  CHARACTERS_DELETE: 'cipher-mux:characters:delete',
  CHARACTERS_SWITCH: 'cipher-mux:characters:switch',
  CHARACTERS_ACTIVE: 'cipher-mux:characters:active',
  CHARACTERS_GLOBAL_PERSONA_GET: 'cipher-mux:characters:global-persona:get',
  CHARACTERS_GLOBAL_PERSONA_SET: 'cipher-mux:characters:global-persona:set',
  ENTITY_PERSONA_OVERRIDE_GET: 'cipher-mux:entity:persona-override:get',
  ENTITY_PERSONA_OVERRIDE_SET: 'cipher-mux:entity:persona-override:set',

  // Welche CLI eine Rolle startet. Die Auflösung gab es schon lange
  // (`entity-runtime.ts`: entityAdapters > Rollen-Default > global); was fehlte,
  // war ein Weg, sie zu setzen, der nicht „Config-Datei von Hand editieren" heisst.
  AGENT_ADAPTERS_LIST: 'cipher-mux:agent:adapters:list',
  AGENT_DEFAULT_ADAPTER_GET: 'cipher-mux:agent:default-adapter:get',
  AGENT_DEFAULT_ADAPTER_SET: 'cipher-mux:agent:default-adapter:set',
  ENTITY_ADAPTER_GET: 'cipher-mux:entity:adapter:get',
  ENTITY_ADAPTER_SET: 'cipher-mux:entity:adapter:set',

  // Welches Modell eine Rolle fährt. Dieselbe Auflösungskette wie die CLI —
  // `app.entityModels` > Rollen-Default > was die CLI selbst entscheidet.
  AGENT_MODELS_LIST: 'cipher-mux:agent:models:list',

  // Ob eine ausgelieferte preset.md hinter ihrer Code-Vorlage zurückliegt.
  // write-once heißt: ein Vorlagen-Fix erreicht sie nie von selbst.
  PRESET_TEMPLATE_STATUS: 'cipher-mux:preset:template-status',
  // Die Vorlage uebernehmen — nach einer Sicherung, auf Knopfdruck, nie von selbst.
  PRESET_TEMPLATE_APPLY: 'cipher-mux:preset:template-apply',
  ENTITY_MODEL_GET: 'cipher-mux:entity:model:get',
  ENTITY_MODEL_SET: 'cipher-mux:entity:model:set',

  // UI Control (Companion Demo Mode)
  UI_HIGHLIGHT: 'cipher-mux:ui:highlight',
  UI_OPEN: 'cipher-mux:ui:open',
  THEME_SET: 'cipher-mux:theme:set',

  // A11y
  A11Y_TERMINAL_FONT_SIZE: 'cipher-mux:a11y:terminal-font-size',

  // BT Remote
  BT_REMOTE_EVENT: 'cipher-mux:bt-remote:event',
  BT_REMOTE_STATUS: 'cipher-mux:bt-remote:status',
  BT_REMOTE_DEVICES: 'cipher-mux:bt-remote:devices',
  BT_REMOTE_MAPPING_GET: 'cipher-mux:bt-remote:mapping:get',
  BT_REMOTE_MAPPING_SET: 'cipher-mux:bt-remote:mapping:set',
  // Legacy aliases (backwards compat)
  BT_SHUTTER_EVENT: 'cipher-mux:bt-shutter:event',
  BT_SHUTTER_STATUS: 'cipher-mux:bt-shutter:status',

  // Entity Framework
  ENTITY_START: 'cipher-mux:entity:start',
  ENTITY_RESUME: 'cipher-mux:entity:resume',
  ENTITY_STOP: 'cipher-mux:entity:stop',
  ENTITY_STATUS: 'cipher-mux:entity:status',
  ENTITY_LIST: 'cipher-mux:entity:list',
  ENTITY_STARTED: 'cipher-mux:entity:started',

  // Presets (Entity CLAUDE.md Editor)
  PRESETS_LIST: 'cipher-mux:presets:list',
  PRESETS_READ: 'cipher-mux:presets:read',
  PRESETS_SAVE: 'cipher-mux:presets:save',
  PRESETS_CREATE: 'cipher-mux:presets:create',
  PRESETS_DELETE: 'cipher-mux:presets:delete',
  PRESETS_READ_INJECTED: 'cipher-mux:presets:read-injected',

  // Global Rules (global-rules.md Editor)
  GLOBAL_RULES_READ: 'cipher-mux:global-rules:read',
  GLOBAL_RULES_SAVE: 'cipher-mux:global-rules:save',

  // Session Screenshot
  SESSION_SCREENSHOT: 'cipher-mux:session:screenshot',

  // Updates
  UPDATE_CHECK: 'cipher-mux:update:check',
  UPDATE_AVAILABLE: 'cipher-mux:update:available',
  UPDATE_DISMISS: 'cipher-mux:update:dismiss',

  // Setup Wizard
  SETUP_CHECK: 'cipher-mux:setup:check',
  SETUP_INSTALL_ALL: 'cipher-mux:setup:install-all',
  SETUP_PROGRESS: 'cipher-mux:setup:progress',
  SETUP_SKIP: 'cipher-mux:setup:skip',

  // Hub
  HUB_PROJECTS_DIR: 'cipher-mux:hub:projects-dir',
  HUB_SETUP: 'cipher-mux:hub:setup',
  HUB_GET_PATH: 'cipher-mux:hub:get-path',
  HUB_DEFAULT_PATH: 'cipher-mux:hub:default-path',

  // Shell
  OPEN_EXTERNAL: 'cipher-mux:shell:open-external',

  // Detachable Windows
  DETACH_SESSION: 'cipher-mux:detach:session',
  DETACH_NOTE: 'cipher-mux:detach:note',
  DOCK_REQUEST: 'cipher-mux:dock:request',
  DETACH_STATE_CHANGED: 'cipher-mux:detach:state-changed',
  DETACH_LIST: 'cipher-mux:detach:list',
  DETACH_HAS_DETACHED: 'cipher-mux:detach:has-detached',
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
