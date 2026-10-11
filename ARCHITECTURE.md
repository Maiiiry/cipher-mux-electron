# Architecture (v0.12.7)

This document describes the high-level architecture of cipher-mux. It is intended for contributors who want to understand the codebase before making changes.

If you want to build a new adapter, see [CONTRIBUTING.md](CONTRIBUTING.md#writing-an-adapter) and the [adapter test protocol](docs/contributing/adapter-test-protocol.md).

## Overview

cipher-mux is an Electron application with a classic two-process architecture: a **main process** (Node.js) that manages tmux sessions, a SQLite database, an MCP server, and all system integrations; and a **renderer process** (Preact) that displays the terminal grid, chatroom, and cockpit UI.

As of v0.12.7 the system supports **12 roles** (Workshop, Cyber Factory, Local Cyber Factory, Local Worker, Launcher, Companion, Refinement, Ideation Partner, Voice Relay, Audit, Debugger, Testing Assistant) that replace the old persona-based session model. The MCP server registers **68 tools** in twelve categories, covering session management, message bus, tasks, notes, companion memory, voice, grid navigation, UI choreography, handoffs, and more. Key subsystems added since v0.9.6 include:

- **Companion memory store** — per-entity SQLite FTS5 memory with recall/search/forget via MCP.
- **Notes system** — full CRUD + search + Ollama auto-tagging, exposed as MCP tools (`mux_notes_*`).
- **Voice scroll + grid navigation** — BT shutter remote triggers scroll and grid-cell focus commands.
- **UI choreography system** — programmatic highlight overlays, sidebar toggles, and TTS narration for demos and onboarding.
- **WindowManager detach-lifecycle** — BrowserWindow registry for pop-out/dock-in of sessions and notes with bounds persistence and focus-driven voice routing.
- **TTS focus gate** — `mux_tts_speak` gates playback on the caller's sessionId matching the focused cell; focus source tracking distinguishes grid vs detached windows.
- **Voice hotSwap / initPiperOnly** — runtime voice switching via queued swap (waits for active speak chain) and lazy TTS-only initialization for entities that need TTS without full voice pipeline.
- **Testing-collaboration IPC** — dialog-target mode in VoiceInputRouter bypasses voice commands and routes raw STT text to the bugreport dialog's description field via `VOICE_DIALOG_INSERT`.

Communication between main and renderer flows through typed IPC channels defined in `src/shared/ipc-channels.ts`. The renderer never accesses Node.js APIs directly - everything goes through the `contextBridge` preload API (`window.cipherMux`).

```
+---------------------------------------------------------------------+
|                       Electron App (v0.12.7)                          |
|                                                                      |
|  +---------------------------------------------------------------+  |
|  |                    Main Process                                |  |
|  |                                                                |  |
|  |  +-------------+  +--------------+  +----------------+        |  |
|  |  | TmuxManager  |  | MessageBus   |  |  MCP Server    |       |  |
|  |  | (Control -C) |  | (SQLite/WAL) |  | (Streamable    |       |  |
|  |  |              |  |              |  |  HTTP + Auth)  |       |  |
|  |  +------+-------+  +------+-------+  +-------+--------+      |  |
|  |         |                 |                   |                |  |
|  |  +------+-----------------+-------------------+------------+  |  |
|  |  |                    IPC Hub                              |  |  |
|  |  +------+-----------------------------------------+-------+  |  |
|  |         |                                         |           |  |
|  |  +------+-------+  +----------+  +---------------+--------+  |  |
|  |  | SessionMgr   |  |ConfigStore|  | ProjectScanner        |  |  |
|  |  | + Adapters    |  | (JSON)    |  | (fs + git CLI)        |  |  |
|  |  +--------------+  +----------+  +------------------------+  |  |
|  |                                                                |  |
|  |  +--------------+  +--------------+  +----------------+       |  |
|  |  | StatusLine   |  | KickoffMgr   |  | TaskManager    |      |  |
|  |  | Monitor      |  |              |  | (Outbox)       |      |  |
|  |  +--------------+  +--------------+  +----------------+       |  |
|  |                                                                |  |
|  |  +--------------+  +--------------+  +----------------+       |  |
|  |  | VoiceManager |  | BugreportMgr |  | NoteManager    |      |  |
|  |  | (STT/TTS/VAD)|  |              |  | (CRUD+Search)  |      |  |
|  |  +--------------+  +--------------+  +----------------+       |  |
|  |                                                                |  |
|  |  +--------------+  +--------------+  +----------------+       |  |
|  |  | EntityReg-   |  | MemoryStore  |  | BtShutter-     |      |  |
|  |  | istry        |  | (companion)  |  | Manager        |      |  |
|  |  +--------------+  +--------------+  +----------------+       |  |
|  +---------------------------------------------------------------+  |
|                              |                                       |
|                     contextBridge (preload.ts)                       |
|                     window.cipherMux API                             |
|                              |                                       |
|  +---------------------------------------------------------------+  |
|  |                  Renderer Process (Preact)                     |  |
|  |                                                                |  |
|  +----------+ +--------------+ +-----------------------+          |  |
|  | Activity  | |  Terminal    | |   Chatroom Panel      |         |  |
|  | Rail      | |  Panes      | |   (Message Bus Feed)  |         |  |
|  +----------+ +--------------+ +-----------------------+          |  |
|                                                                   |  |
|  +------------------+  +--------------+  +------------+           |  |
|  |  Cockpit View    |  |  Kickoff     |  |  Info/Help |           |  |
|  |  (Project Cards) |  |  Dialog      |  |  Settings  |           |  |
|  +------------------+  +--------------+  +------------+           |  |
|                                                                   |  |
|  +------------------+  +--------------+  +------------------+     |  |
|  |  CompanionTab    |  | EntityPicker |  | HighlightOverlay |    |  |
|  |  + MemoryView    |  | Popup        |  | (Choreography)   |    |  |
|  +------------------+  +--------------+  +------------------+     |  |
|  +---------------------------------------------------------------+  |
+---------------------------------------------------------------------+
         |                              |
         | tmux Control Mode            | Streamable HTTP
         | (stdin/stdout)               | (JSON-RPC 2.0)
         v                              v
+-----------------+          +--------------------+
|  tmux Server    |          |  External Clients   |
|  (Sessions)     |          |  (Claude Code,      |
|                 |          |   Codex, opencode)  |
+-----------------+          +--------------------+
```

## Module Map

### Main Process (`src/main/`)

| Module | Directory | Responsibility |
|--------|-----------|---------------|
| **TmuxManager** | `tmux/` | tmux Control Mode client. Spawns sessions, streams output, handles pane lifecycle. Uses a 16ms output batcher to throttle high-frequency terminal data. See [ADR-001](docs/decisions/ADR-001-tmux-streaming.md). |
| **MessageBus** | `message-bus/` | SQLite-backed inter-session communication. Topics, messages, unread tracking. Single-writer from main process (WAL mode). 7-day retention ([ADR-007](docs/decisions/ADR-007-message-retention.md)). |
| **MCP Server** | `mcp/` | Streamable HTTP endpoint on `127.0.0.1:3100`. Bearer token auth. Exposes 40+ tools (`mux_send`, `mux_read`, `mux_create_session`, `mux_status`, `mux_context_usage`, `mux_task_*`, `mux_notes_*`, `companion_memory_*`, `mux_ui_*`, `mux_tts_speak`, `mux_grid_*`, `mux_cell_scroll`, `mux_cyber_factory_*`, `mux_debugger_*`, `mux_testing_*`, handoff tools, etc.). See [ADR-002](docs/decisions/ADR-002-mcp-transport.md). |
| **WindowManager** | `window-manager.ts` | BrowserWindow registry for detached sessions/notes. Pop-out, dock-in, bounds persistence, focus callbacks for voice routing. |
| **IPC Hub** | `ipc-hub.ts` | Central router for all renderer-main IPC. Registers handlers for ~97 typed channels. |
| **AgentAdapters** | `agent/` | The `AgentAdapter` contract plus three implementations (`adapters/claude-code.ts`, `adapters/codex.ts`, `adapters/opencode.ts`), the registry, and the per-role CLI mapping (`entity-adapter-map.ts`). See [Adapter Contract](#adapter-contract). |
| **SessionManager** | `session/` | Session registry, status tracking, crash recovery. Manages the lifecycle of tmux-backed agent sessions. Resolves the adapter **per role** at launch, fork and restore. |
| **EntityRegistry** | `session/entity-registry.ts` | Entity registration and lifecycle. Registers 7 built-in entities at startup and manages their configs. |
| **EntityScanner** | `session/entity-scanner.ts` | Dynamic entity discovery from `~/.config/cipher-mux/entities/`. Scans for directories containing `CLAUDE.md`. |
| **EntityAssets** | `session/entity-assets.ts` | Entity asset management (icons, colors, feature flags). |
| **ConfigStore** | `config/` | App settings persistence via JSON (electron-store pattern). Grid layout, theme, scan paths. |
| **ProjectScanner** | `project/` | Discovers projects by scanning configured directories for marker files (`CLAUDE.md`, `AGENTS.md`). Powers the cockpit project card grid. |
| **KickoffManager** | `project/` | Project scaffolding and session spawn. Handles the "launch a new project" flow with optional requirements interview. |
| **StatusLineMonitor** | `monitoring/` | Reads real-time context/token usage via the statusLine hook. Claude Code writes that JSON itself; for Codex, `monitoring/codex-usage-hook.ts` derives the same shape from the `token_usage_record` entries in the rollout JSONL — a second writer, not a second reader. opencode derives the same shape from a plugin `event` hook, which sees token counts per assistant message. See [ADR-003](docs/decisions/ADR-003-statusline-integration.md). |
| **TaskManager** | `task/` | SQLite-backed task outbox. State machine (inbox -> in-progress -> done/parked/dropped). Watcher, hooks, MCP tool integration. |
| **NoteManager** | `notes/note-manager.ts` | Note CRUD + full-text search. SQLite-backed. Powers `mux_notes_*` MCP tools. |
| **NoteTagging** | `notes/note-tagging.ts` | Ollama-powered auto-tagging for notes. |
| **TestcaseParser** | `notes/testcase-parser.ts` | Parses structured testcases from note content. |
| **BugreportManager** | `bugreport/` | Session diagnostics collection, structured bug report creation, resolution workflow. |
| **VoiceManager** | `voice/` | Local voice pipeline: Whisper STT, Piper TTS, Silero VAD. Powers voice bug reports and voice-to-session prompt input via VoiceInputRouter. |
| **MemoryStore** | `companion/memory-store.ts` | SQLite FTS5 companion memory store. Per-entity persistent memory with salience scoring and TTL. |
| **MemoryRetriever** | `companion/retriever.ts` | Memory retrieval logic — recall, search, and forget operations exposed via MCP. |
| **BtShutterManager** | `bluetooth/bt-shutter-manager.ts` | Bluetooth remote integration. Maps BT shutter button presses to scroll, grid navigation, and custom actions. |
| **WorkspaceManager** | `workspace/` | Personas (named roles with colors/prompts), workspaces (grid layouts with project assignments), 3-level prompt resolution, persona skill sync. |
| **Utilities** | `util/` | `exec-util.ts` (safe child_process wrapper with PATH patching), `dependency-check.ts` (tmux/claude availability). |

### Renderer Process (`src/renderer/`)

| Module | Directory | Responsibility |
|--------|-----------|---------------|
| **App** | `app.tsx` | Root component, view routing (grid / cockpit / chatroom / info) |
| **ActivityRail** | `components/` | Left sidebar with session icons, status dots, unread badges, view switcher |
| **TerminalPane** | `components/` | xterm.js terminal instance, fit addon, WebGL/Canvas renderer ([ADR-005](docs/decisions/ADR-005-xterm-renderer.md)) |
| **SessionGrid** | `components/` | Dynamic grid layout for terminal panes. Configurable columns/rows. |
| **Chatroom** | `components/` | Message bus feed, send messages between sessions, background session cards |
| **Cockpit** | `components/` | Project card grid, context usage overview, session management |
| **CompanionTab** | `components/` | Companion entity view — chat-like interaction surface for the companion session |
| **CompanionMemoryView** | `components/` | Memory browser for companion memory entries (recall, search, inspect) |
| **EntityPickerPopup** | `components/` | Entity selection popup for launching sessions by entity type |
| **HighlightOverlay** | `components/` | Programmatic highlight overlay for UI choreography and onboarding demos |
| **NotesTreeView** | `components/` | Tree-structured note browser with tag filtering and search |
| **TestcaseView** | `components/` | Structured testcase display parsed from notes |
| **UnifiedSessionDialog** | `components/` | Unified dialog for session creation, replacing older scattered launch flows |
| **WorkspacesWindow** | `components/` | Standalone editor window for personas and workspaces (960x720, separate BrowserWindow) |
| **WorkspacePopup** | `components/` | Quick-access popup above statusbar for loading workspaces |
| **Hooks** | `hooks/` | `useTerminal`, `useSessions`, `useMessages`, `useGrid`, `useContextUsage`, `useTheme`, `useShortcuts`, `useProjects`, `useVoiceSession`, `useEntityPresets`, `useScrollHandler`, `useGlobalTtsPlayback` - all wrap IPC calls |

### Shared (`src/shared/`)

| File | Purpose |
|------|---------|
| `ipc-channels.ts` | ~97 typed IPC channel constants. Single source of truth for all main-renderer communication. |
| `types.ts` | Domain interfaces: `SessionInfo`, `Message`, `ProjectInfo`, `ContextUsage`, `Task`, `BugreportData`, `EntityConfig`, `NoteData`, `MemoryEntry`, etc. |
| `grid-types.ts` | Grid state management utilities: `createEmptyGrid`, `assignSessionToGrid`, `computeGridStyle` |
| `constants.ts` | App configuration: MCP port, context warning threshold, retention days, grid limits |
| `terminal-theme.ts` | xterm.js color theme shared between main and renderer |

## Entity Framework

cipher-mux uses an entity-based session model that replaced the earlier persona system.

### EntityRegistry

**10** built-in entities are registered at startup. The list is `ENTITIES` in
`src/main/session/entity-registry.ts`; anything else named here would be a second place to get
wrong — this table had **11** rows until 2026-10-01, with an `Orchestrator` that was renamed to
Workshop and a `Bugreport` that is a dialog and not an entity.

| Entity | Role |
|--------|------|
| **Workshop** | Coordination for everyday work: task distribution, context watch, worker rotation |
| **Cyber Factory** | Build orchestrator for large work. Decomposes specs into waves, spawns parallel workers |
| **Launcher** | Project scaffolding and kick-off |
| **Companion** | User-facing advisor with persistent memory; the only role holding the `companion_memory_*` tools |
| **Refinement** | Requirements analysis, purpose check, REQ-ID tracking, handoff to Cyber Factory |
| **Ideation Partner** | Brainstorming, skill registry, Anforderungspaket generation |
| **Voice Relay** | Background role that polls tmux output and routes stable responses to TTS |
| **Audit** | Code review, security audit, ADR consistency, release recommendation |
| **Debugger** | Post-build diagnostics: findings intake, clarification, fix planning, verification |
| **Testing Assistant** | Test execution, quality audit, adversarial probing, findings reporting |

Eight of them you start yourself; **Launcher** and **Voice Relay** run on their own.

### EntityScanner

At startup `EntityScanner` scans `~/.config/cipher-mux/entities/` for subdirectories containing a `CLAUDE.md` file. Each discovered directory becomes a registered entity. This allows user-defined entities alongside the built-in set.

### EntityConfig

Each entity is described by an `EntityConfig` object:

| Field | Purpose |
|-------|---------|
| `id` | Unique identifier (e.g. `companion`, `builder`) |
| `displayName` | Human-readable label shown in UI |
| `icon` | Icon identifier for the activity rail and entity picker |
| `color` | Accent color for session borders, badges, and theming |
| `projectPath` | Default working directory for sessions of this entity |
| `features` | Feature flags (e.g. memory, notes, tts) that enable/disable subsystems |
| `singleInstance` | When `true`, only one session of this entity may exist at a time |

### Migration from Personas

Entities replace the old persona-based session launch. Where personas were display-only labels with color and prompt, entities are full lifecycle objects with feature flags, filesystem-backed definitions, and MCP-aware capabilities. Existing workspace configurations referencing personas continue to work via a compatibility layer.

## Adapter Contract

The AgentAdapter interface (`src/main/agent/agent-adapter.ts`) abstracts over coding agent CLIs. It carries **three production implementations** as of 2026-10-01 — `claude-code` (Tier 1), `codex` (Tier 2), `opencode` (Tier 2) — plus an annotated template, `_reference-stub.ts`. SessionManager is decoupled from Claude Code specifics; the contract was first exercised by a second implementation rather than assumed to work.

```typescript
interface AgentAdapter {
  readonly id: string                  // 'claude-code' | 'codex' | 'opencode'
  readonly displayName: string
  readonly tier: 'tier-1' | 'tier-2'

  // lifecycle
  buildLaunchCommand(opts: LaunchOpts): LaunchCommand        // { cmd, args[], envOverrides? }
  postLaunchInjection?(ctx: AdapterContext): Promise<void>    // optional: MCP registration

  // project awareness
  getProjectMarkers(): string[]                              // e.g. ['CLAUDE.md', '.claude']
  readProjectInstructions(projectPath: string): Promise<ProjectInstructions | null>

  // runtime signals (capability-gated)
  supports(feature: AdapterFeature): boolean
  getCapabilities(): AdapterCapabilities                     // Record<AdapterFeature, boolean>
  getContextUsage?(sessionId: string): Promise<ContextUsage | null>  // only if supports('status-line')
  attachStatusHook?(projectPath: string): Promise<void>              // only if supports('status-line')

  // prompt delivery
  sendPrompt(tmuxTarget: string, prompt: string, opts?: SendOpts): Promise<void>

  // prompt fragments
  buildWorkshopPromptFragment(lang: 'de' | 'en'): string
  buildLauncherPromptFragment(lang: 'de' | 'en'): string
  buildCyberFactoryPromptFragment(lang: 'de' | 'en'): string
}
```

`buildLaunchCommand` returns a structured `{ cmd, args[] }` and never a shell string — that is what keeps tmux `send-keys` free of injection.

`AdapterContext` carries `projectPath`, `mcpUrl`, `mcpApiKey`, `sessionId`, `workspaceId` and — since the Codex adapter — an optional `entityId`. The last one exists because a CLI that cannot send custom headers needs the role binding to travel somewhere else; see "MCP binding" below.

### Adapter Capabilities (AdapterFeature)

**Seven** features gate optional behaviour (`src/shared/types.ts`). The UI degrades gracefully when a feature is unsupported:

| Feature | When unsupported |
|---------|-----------------|
| `mcp-injection` | Badge "MCP not active" on pane header; session excluded from MCP tool delegation |
| `status-line` | Context % shows `---` instead of percentage; context warnings skip this session. `getContextUsage` and `attachStatusHook` are then absent entirely rather than returning empty values |
| `skip-permissions` | User must manually confirm prompts in the terminal |
| `sub-agents` | Multi-agent orchestration unavailable for this session |
| `project-instructions` | Project instruction display skipped in cockpit card |
| `message-bus-participant` | Badge "Read-only Bus"; no send capability in chatroom for this session |
| `companion-mcp` | The `companion_memory_*` tools do not reach this session (the server binds the role per connection and registers them only for Companion) |

**A `false` in an adapter means "not measured", not "impossible."** That distinction is written into the adapter source and it matters for contributors: the honest value for an unverified feature is `false`, because a gate that says `true` on a hunch makes the Mux call a tool that grabs at nothing. For the user the two readings collapse into one — the capability is unavailable — which is why the UI names it the same way either way.

### Implemented Adapters

| Adapter | id | Tier | Capabilities `false` | Measured against | Location |
|---------|----|------|---------------------|------------------|----------|
| `ClaudeCodeAdapter` | `claude-code` | Tier-1 | none (all 7 `true`) | Claude Code v2.1.284 | `src/main/agent/adapters/claude-code.ts` |
| `CodexAdapter` | `codex` | Tier-2 | `sub-agents` | codex-cli 0.155.1 | `src/main/agent/adapters/codex.ts` |
| `OpenCodeAdapter` | `opencode` | Tier-2 | `status-line`, `sub-agents` | opencode 1.18.34 | `src/main/agent/adapters/opencode.ts` |
| `ReferenceStubAdapter` | `reference-stub` | Tier-2 | all 7 (template) | — | `src/main/agent/adapters/_reference-stub.ts` |

The reference stub is not registered; it is the file you copy.

**Beyond the capability flags, all three were run against their live CLI, and all three enforce role boundaries.** This is stated here rather than encoded as a capability because `AdapterFeature` has no flag for "was actually run" — and that distinction earned its place: the Codex boundary was configured, tested, and documented while never being passed in. It was found by auditing opencode, not by auditing Codex.

### Where the three CLIs diverge structurally

Two places in the contract are not differences of degree but of mechanism. Everything else — launch flags, resume semantics, which file carries the project instructions — is a parameter.

**1. MCP binding.** The Mux has to tell the MCP server which workspace and which role a connection belongs to.

- *Claude Code and opencode* send connection headers: `X-Mux-Workspace` and `X-Mux-Entity`, bound once at `initialize`. Both adapters build their server entry through `buildMcpServerConfig` in `src/main/mcp/workspace-header.ts`, so the header names live in one place. opencode's config shell differs (`type: "remote"` plus an explicit `enabled`, written into `opencode.json`) — the shell is reshaped, the headers are not.
- *Codex cannot send custom headers.* Measured against a listening post: the connection arrives, the `X-Mux-*` headers do not, and a `headers` key in the TOML is silently discarded — its server config knows `url` and `bearer_token_env_var`. The binding therefore travels inside the bearer token: `<apiKey>.<base64url(JSON)>`, implemented in `src/main/mcp/bound-token.ts`. A token **without** a dot is the bare key and means *unbound*, which is exactly what every pre-existing client sends, so the scheme is backward-compatible and stateless. `stripBindingFromAuthHeader` runs **before** `validateBearer`; without that step every Codex connection would be a 401 — and only at use time, not when the config is written. At `initialize` the header wins and the token fills in per field. The suffix is deliberately **unsigned**: whoever holds the key can call every tool anyway, so the suffix grants no rights, it only names the caller. Were the key ever to carry a finer permission structure, a signature would become mandatory. The reasoning sits in the file header so it is not re-weighed from scratch next time.

**2. Role boundaries.** A role's limits are enforced, not merely prompted (see `src/main/session/entity-boundaries.ts`).

- *Claude Code and Codex* both take a dependency-free Node script in the run directory wired as a **`PreToolUse` hook**. Codex carries the Claude Code hook protocol verbatim — `hookSpecificOutput.permissionDecision`, `permissionDecisionReason`, exit 2 plus stderr — and a `deny` takes effect even under `--dangerously-bypass-approvals-and-sandbox`. Two Codex specifics are measured and silent when missed: without `--dangerously-bypass-hook-trust` a freshly written hook does not fire at all, and the hook input reports `tool_name: "Bash"` even though the output shows `exec`, so a `matcher = "shell"` matches nothing. The adapter therefore sets both flags together and writes **no** matcher, filtering inside the hook script instead.
- *opencode has no hook files.* It exposes plugin events, and **`tool.execute.before` is the only one that can stop a call** — a throw there prevents execution, proven in `opencode run` and in the TUI. The documented `permission.ask` **never fires**: the binary triggers every other hook name but not that one. A boundary built on it would have been written and dead.

A third Codex-only obstacle sits outside the contract and is worth knowing before debugging a hung session: Codex loads project-local config, hooks and exec policies **only from a trusted directory** and otherwise blocks on a dialog, and a belated "Yes" does not load them after the fact. Of the workarounds, only an entry in the global `~/.codex/config.toml` works — `src/main/agent/adapters/codex-trust.ts` writes it, and only for paths under `~/.config/cipher-mux/runs/`, checked on the resolved path. The justification is in that file's header: the dialog protects against foreign content, and a run directory has none — everything under it was generated by the Mux. Switchable off via `agent.codexTrustRunDirs`.

### AdapterRegistry

`src/main/agent/registry.ts` pre-registers all three adapters and holds `claude-code` as the default. Additional adapters register via `registry.register(adapter)`; `setDefault(id)` throws for an unregistered id.

The default stays `claude-code` for a stated reason, not out of habit: it is the only Tier-1 adapter, and the only one for which every capability has been measured.

### Choosing an adapter per role

`resolveEntityRuntime` (`src/main/session/entity-runtime.ts`) resolves model and adapter per role:

```
app.entityAdapters[<entityId>]   — user override, set in the preset editor ("CLI" field)
  > EntityConfig.adapterId       — role default, if the role carries one
  > agent.defaultAdapter         — global setting ("Default CLI"), ships as 'claude-code'
```

The mapping itself lives as pure functions in `src/main/agent/entity-adapter-map.ts` rather than in the IPC handler, because a mapping whose failure mode is "the role silently starts the wrong CLI" has to be testable. The same three-state discipline as for workspaces applies: **a missing key is not an empty one.** A missing key means "no preference" and lets `agent.defaultAdapter` take over; an empty string would resolve to an adapter named `""`, which is in no registry — so `readEntityAdapter` treats blank as absent and `withEntityAdapter(…, null)` deletes the key instead of blanking it.

Resolution must happen at *every* consumer, not once. The Codex acceptance pass found this the hard way: the launch command resolved per role while `start()`, the fork path and the Keep-Working restore each used `getDefault()`, so a role on Codex under a global default of `claude-code` launched `codex` and then received a `.claude/settings.local.json`. With one adapter that was latent; with three it is a bug. `start()` now resolves via `adapterForEntity(opts.entityId)`, the fork reuses the source session's `sessionAdapters`, and the restore resolves **per entry**.

**Config location.** All of the above is persisted in `app.getPath('userData')`:

```
~/Library/Application Support/cipher-mux-electron/cipher-mux-config.json
```

There is a second, identically named file at `~/.config/cipher-mux/config.json`. **The Mux does not read it.** Editing it changes nothing. `~/.config/cipher-mux/` holds content — `entities/<id>/` (authored assets), `runs/<workspaceId>/<entityId>/` (generated artefacts), voice models — but no app settings.

See `src/main/agent/adapters/_reference-stub.ts` for a fully annotated skeleton, and CONTRIBUTING.md §"Writing an Adapter" for the measurement discipline that the two Tier-2 adapters were built under.

## Data Flow

### Terminal Output

```
tmux server
  -> TmuxManager (Control Mode stdout)
  -> OutputBatcher (16ms throttle)
  -> IPC Hub (cipher-mux:terminal:data)
  -> preload bridge
  -> useTerminal hook
  -> xterm.js write()
```

### Message Bus

```
Claude Code session (MCP client)
  -> HTTP POST to MCP Server
  -> mux_send tool handler
  -> MessageBus.send() (SQLite INSERT)
  -> IPC Hub emits cipher-mux:message:received
  -> Chatroom component updates
```

### Context Usage

```
Claude Code CLI                    Codex CLI
  -> writes JSON                     -> PreToolUse hook reads transcript_path
     to statusLine hook path         -> codex-usage-hook writes the same JSON shape
                     \              /
                      StatusLineMonitor (fs.watch)
                      -> IPC Hub emits cipher-mux:context:updated
                      -> ActivityRail + PaneHeader update
```

opencode writes the same JSON from a plugin `event` hook on `message.updated`, which carries `sessionID`, `modelID` and `tokens`. Its context-window size stays an estimate and says so — `/api/model` returns an empty list without an authenticated provider.

### Companion Memory

```
Entity session (MCP client)
  -> companion_memory_write / recall / search / forget
  -> MCP Server tool handler
  -> MemoryStore (SQLite FTS5 INSERT/SELECT)
  -> IPC Hub emits update (if subscribed)
  -> CompanionMemoryView updates
```

## Subsystem Deep-Dives (v0.9.10+)

### WindowManager Detach-Lifecycle

`WindowManager` (`src/main/window-manager.ts`) maintains a registry of detached `BrowserWindow` instances (`Map<entityId, { window, entry }>`). Sessions and notes can be popped out into their own OS window and docked back.

**Lifecycle:**

```
Pop-out:  openDetachedWindow(type, entityId, bounds?)
            → new BrowserWindow with ?view=session|note&id=<entityId>
            → save bounds to ConfigStore (detachedWindowBounds)
            → register onDetachedFocus callback for voice routing

Dock-in:  markDockInitiated(entityId) → close window (no state-change event)
            → DETACH_STATE_CHANGED IPC → renderer re-docks cell

Startup:  restoreDetachedWindows(entries, isValid)
            → validator skips stale sessions/notes
            → restore saved bounds per entityId
```

**Key functions:** `openDetachedWindow()`, `closeDetachedWindow()`, `markDockInitiated()`, `getDetachedEntries()`, `restoreDetachedWindows()`, `onDetachedFocus(cb)`, `onMainWindowFocus(cb)`.

**IPC channels:** `DETACH_REQUEST`, `DOCK_REQUEST`, `DETACH_STATE_CHANGED`.

### TTS Focus Gate

The `mux_tts_speak` MCP tool (`src/main/mcp/mcp-tools.ts`) implements focus-gating: if a `sessionId` parameter is passed, TTS only plays when that session is in the focused cell. This prevents background sessions from speaking over the user's active work.

Focus source is tracked as `'grid' | 'detached'` by `VoiceInputRouter` (`src/main/voice/voice-input-router.ts`). When a detached window gains OS focus, `WindowManager.onDetachedFocus()` fires a callback that switches the TTS/STT target. When the main grid window regains focus, `onMainWindowFocus()` reverts routing.

For entity sessions with voice-relay enabled, `VoiceOutputRouter` (`src/main/voice/voice-output-router.ts`) polls tmux output every 500ms, detects stable agent responses, and routes them to `ConversationEngine.speakResponse()`.

### Voice hotSwap / initPiperOnly

`VoiceManager` (`src/main/voice/voice-manager.ts`) supports two initialization paths:

1. **`init()`** — full pipeline: STT (Whisper) + TTS (Piper) + ConversationEngine.
2. **`initPiperOnly()`** — lazy TTS-only mode for entities that need `mux_tts_speak` but not voice input.

**Runtime voice switching** via `swapVoice(newVoiceName)`:
- Uses a `_swapQueue` (Promise chain) to serialize concurrent swap requests.
- Waits for the active speak chain to finish.
- Disposes old PiperTTS instance, creates new one with the target voice model.
- Updates ConversationEngine's TTS reference after swap.
- `isSwapping` getter exposes swap-in-progress state.

### Testing-Collaboration IPC (Simplified Bugreport Dialog)

When the bugreport dialog opens, `VoiceInputRouter.setDialogTarget('bugreport')` switches to dialog-target mode. In this mode, STT transcriptions bypass voice command matching (scroll, grid-nav, submit) and flow directly to the renderer via `VOICE_DIALOG_INSERT` IPC. The renderer inserts the text into the dialog's description field, enabling hands-free dictation.

**IPC channels:** `BUGREPORT_DIALOG_OPEN` (triggers `setDialogTarget`), `BUGREPORT_DIALOG_CLOSE` (triggers `clearDialogTarget`), `VOICE_DIALOG_INSERT` (raw STT text → renderer input field).

**Key functions:** `VoiceInputRouter.setDialogTarget(target)`, `clearDialogTarget()`, `routeTranscription(text)` (checks dialogTarget as priority 1).

## Key Design Decisions

All architectural decisions are recorded as ADRs in `docs/decisions/`:

| ADR | Decision |
|-----|----------|
| [001](docs/decisions/ADR-001-tmux-streaming.md) | tmux Control Mode for session streaming |
| [002](docs/decisions/ADR-002-mcp-transport.md) | Streamable HTTP for MCP transport |
| [003](docs/decisions/ADR-003-statusline-integration.md) | statusLine hook for real-time context usage |
| [004](docs/decisions/ADR-004-renderer-bundler.md) | Vite as renderer bundler |
| [005](docs/decisions/ADR-005-xterm-renderer.md) | WebGL + Canvas fallback for xterm.js |
| [006](docs/decisions/ADR-006-ulid-library.md) | ulidx for ULID generation |
| [007](docs/decisions/ADR-007-message-retention.md) | 7-day time-based message retention |
| [008](docs/decisions/ADR-008-orchestrator-template.md) | Structured orchestrator CLAUDE.md template |

## Where to Start Reading

If you are new to the codebase, read in this order:

1. **`src/shared/types.ts`** — All domain types. This tells you what the system talks about.
2. **`src/shared/ipc-channels.ts`** — All IPC channels. This tells you how main and renderer communicate.
3. **`src/main/main.ts`** — Application entry point. See how modules are wired together.
4. **`src/main/ipc-hub.ts`** — The central IPC router. Follow a channel from registration to handler.
5. **`src/main/tmux/tmux-manager.ts`** — The session backend. Understand how tmux Control Mode works.
6. **`src/main/mcp/mcp-server.ts`** — The MCP server. See which tools are exposed and how.
7. **`src/main/session/entity-registry.ts`** — The entity framework. See how entities are defined and registered.
8. **`src/renderer/app.tsx`** — Renderer entry point. See the view structure.
9. **`src/renderer/hooks/useTerminal.ts`** — How terminal data flows from IPC to xterm.js.

For adapter development specifically:
1. **`src/main/agent/agent-adapter.ts`** — The adapter interface
2. **`src/main/agent/adapters/_reference-stub.ts`** — Documented skeleton
3. **`src/main/agent/adapters/codex.ts`** — A worked Tier-2 example. Its file header lists the four measurements that determined the design, three of which fail silently if guessed
4. **`src/main/agent/adapters/opencode.ts`** — A second Tier-2 example, and the one that shows what an unmeasured capability looks like when documented honestly
5. **`src/main/agent/registry.ts`** and **`entity-adapter-map.ts`** — Registration and the per-role CLI mapping
6. **`src/main/session/session-manager.ts`** — Where adapters are consumed (note: resolved per role, at launch, fork **and** restore)
