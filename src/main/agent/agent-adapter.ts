/**
 * AgentAdapter — abstraction over Coding-Agent CLIs.
 *
 * Every agent is represented by an adapter that knows:
 *   - how to spawn a session in a tmux pane
 *   - whether and how it supports MCP configuration injection
 *   - whether and how it reports context/token usage
 *   - which project-marker file it recognizes
 *
 * Adapters declare their capabilities via `supports(...)`. The UI and
 * orchestration layers MUST check capabilities before using optional
 * features; see the capability matrix in ARCHITECTURE.md §"Adapter Contract".
 *
 * Design references:
 *   - VS Code Extension Host: capability-gated feature surface
 *   - Warp shell abstraction: structured command output, no raw strings
 */

import type { AdapterFeature, AdapterCapabilities, ContextUsage } from '../../shared/types'

export type { AdapterFeature, AdapterCapabilities }

/** Where the Mux writes project instructions for a CLI. */
export interface InstructionsTarget {
  file: 'CLAUDE.md' | 'AGENTS.md'
  /**
   * Only when the Mux creates the file: it points to this one instead of
   * hiding it. A new AGENTS.md would otherwise make opencode stop reading the
   * project's CLAUDE.md.
   */
  pointerTo?: 'CLAUDE.md'
}

export interface LaunchCommand {
  /** Executable name, e.g. 'claude' */
  cmd: string
  /** Arguments array — NOT a shell string. Prevents shell injection. */
  args: string[]
  /** Extra env vars to set for this session */
  envOverrides?: Record<string, string>
}

export interface LaunchOpts {
  /** Absolute path to the project directory */
  projectPath: string
  /** Session display name */
  sessionName: string
  /** Whether this is a workshop session */
  isWorkshop?: boolean
  /** Whether this is a Cyber Factory session */
  isCyberFactory?: boolean
  /** Fork from an existing Claude session (--fork-session <id>) */
  forkFromClaudeSessionId?: string
  /**
   * Resume this directory's conversation. Maps to `--continue`, not to a bare
   * `--resume`: the latter opens an interactive picker, and entity sessions
   * run unattended with nobody to pick.
   */
  resume?: boolean
  /**
   * Resume one specific conversation by id (`--resume <id>`). Skips the picker
   * outright. Takes precedence over `resume` when known.
   */
  resumeClaudeSessionId?: string
  /**
   * Fork the most recent conversation of this directory, without knowing its id.
   * The launcher's "Abzweigen". `forkFromClaudeSessionId` takes precedence; this
   * takes precedence over `resume` — whoever forks does not want to continue.
   */
  forkLatest?: boolean
  /**
   * Per-launch choice from the launcher. Undefined = the global
   * `agent.skipPermissions`, which is all entity sessions ever use.
   */
  skipPermissions?: boolean
  /** Model override (e.g. 'haiku', 'sonnet', 'opus') — passed as --model <id> */
  model?: string
  /** Rolle der Session. Ein Adapter braucht sie, wenn sein Startkommando rollenabhängig ist (opencode: local-worker). */
  entityId?: string | null
  /** Tatsächliches Arbeitsverzeichnis (Run-Verzeichnis); `projectPath` ist bei Rollen das authored-Verzeichnis. */
  workDir?: string
}

export interface AdapterContext {
  /** Absolute path to the project directory */
  projectPath: string
  /** MCP server URL (full, including /mcp path) */
  mcpUrl: string
  /** MCP auth key */
  mcpApiKey: string
  /** Session ULID */
  sessionId: string
  /** Workspace this session is bound to. null = unbound. */
  workspaceId: string | null
  /**
   * Role this session is bound to. null = no role, which is the app itself.
   *
   * An adapter needs this when its CLI cannot send custom headers and the
   * binding has to ride in the bearer token instead — see `mcp/bound-token.ts`.
   * Optional so existing adapters stay source-compatible.
   */
  entityId?: string | null
}

export interface ProjectInstructions {
  /** Raw content of the project instructions file */
  content: string
  /** Absolute path to the file */
  filePath: string
}

export interface SendOpts {
  /** Whether to append a newline */
  newline?: boolean
}

/**
 * Ein Modell, das eine CLI anbietet.
 *
 * `id` ist, was als `--model` durchgereicht wird. `label` ist, was der Mensch
 * liest — bei Codex der `display_name`, sonst dieselbe Zeichenkette.
 */
export interface AdapterModel {
  id: string
  label: string
  /** Kontextfenster in Tokens, wenn die CLI es nennt. */
  contextWindow?: number
  /** Kurzbeschreibung, wenn die CLI eine liefert. */
  description?: string
}

export interface AgentAdapter {
  readonly id: string
  readonly displayName: string
  readonly tier: 'tier-1' | 'tier-2'

  // --- lifecycle ---
  /** Build a structured launch command. Never returns a raw shell string. */
  buildLaunchCommand(opts: LaunchOpts): LaunchCommand
  /** Optional post-launch setup (e.g. MCP server registration). */
  postLaunchInjection?(ctx: AdapterContext): Promise<void>

  // --- project awareness ---
  /** Filenames/dirs this agent recognizes as project markers. */
  getProjectMarkers(): string[]
  /** Read the agent's project instructions file (e.g. CLAUDE.md). */
  readProjectInstructions(projectPath: string): Promise<ProjectInstructions | null>
  /**
   * The file this CLI actually reads as project instructions — where the Mux
   * writes Global Rules and the workspace sections of a folder session.
   * Absent = CLAUDE.md. Decided from which files exist, because that is what
   * the CLI decides it from: opencode reads CLAUDE.md only when no AGENTS.md
   * lies next to it (measured 2026-10-09).
   */
  instructionsTarget?(present: { agentsMd: boolean; claudeMd: boolean }): InstructionsTarget

  // --- runtime signals (capability-gated) ---
  /** Check if the adapter supports a specific feature. */
  supports(feature: AdapterFeature): boolean
  /** Get all capabilities as a record. */
  getCapabilities(): AdapterCapabilities
  /** Read context usage for a session. Only call if supports('status-line'). */
  getContextUsage?(sessionId: string): Promise<ContextUsage | null>
  /** Inject status reporting hook into project. Only call if supports('status-line'). */
  attachStatusHook?(projectPath: string): Promise<void>

  // --- prompt delivery ---
  /** Send a prompt into the agent's tmux pane. */
  sendPrompt(tmuxTarget: string, prompt: string, opts?: SendOpts): Promise<void>

  // --- prompt fragments for workshop and launcher (antifragility) ---
  /** Agent-specific instructions injected into the workshop template. */
  buildWorkshopPromptFragment(lang: 'de' | 'en'): string
  /** Agent-specific launcher suffix (e.g. '/launch' for Claude Code). */
  buildLauncherPromptFragment(lang: 'de' | 'en'): string
  /** Agent-specific instructions injected into the Cyber Factory template. */
  buildCyberFactoryPromptFragment(lang: 'de' | 'en'): string

  // --- models ---
  /**
   * Welche Modelle diese CLI anbietet.
   *
   * Optional, weil die drei es verschieden koennen (gemessen am 2026-10-01):
   * Codex und opencode zaehlen auf Zuruf auf, Claude Code hat kein Kommando
   * dafuer und kennt nur dokumentierte Aliase. Ein Adapter, der es nicht weiss,
   * laesst die Methode weg — die UI bietet dann nur Freitext an, und das ist
   * ehrlicher als eine erfundene Liste.
   *
   * **Die Liste ist nie vollstaendig.** Alle drei CLIs nehmen auch einen vollen
   * Modellnamen entgegen, der nicht darin steht. Wer sie anzeigt, muss Freitext
   * danebenstellen.
   */
  listModels?(): Promise<AdapterModel[]>
}
