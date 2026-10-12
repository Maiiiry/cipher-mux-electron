# MCP Tools Reference

cipher-mux defines **68 MCP tools** for its Streamable HTTP server, in twelve categories. No
single connection is offered all 68. Most are available to any session with MCP access
(entities with `features: ['mcp']`); two are role-bound:

- the four `companion_memory_*` tools are registered **only** for the Companion and for
  connections without a role — that is the app itself;
- `mux_local_worker_dispatch` is registered **only** for the roles `local-factory` and `local-workshop`.

So the app connection and the Companion are offered **67** (everything but the dispatch tool),
`local-factory` and `local-workshop` are offered **64** each (the dispatch tool, but not the four Companion tools), and any
other role **63**.

**Server:** `http://localhost:{port}/mcp` (port auto-assigned, see `.mcp-connection.md`)
**Auth:** Bearer token (auto-injected into `.mcp.json` per entity). Codex sends no custom
headers, so its workspace and role travel inside the token — `src/main/mcp/bound-token.ts`.

> **Counting them from the code undercounts.** A grep for `registerMuxTool(` finds 57, because
> the ten entity handoff tools are generated inside `registerAllHandoffTools`
> (`src/main/mcp/handoff-kernel.ts`) rather than written out one by one. The authority is what
> a connected client is offered — 67 for the app connection, see above.

---

## Session Management

### `mux_sessions`
List all cipher-mux sessions.

**Parameters:** none

**Returns:** Array of `SessionInfo` objects (id, name, projectPath, status, entityId, etc.)

### `mux_create_session`
Create a new cipher-mux session (tmux session). Launches **Claude Code** — always, whatever the
default CLI is. For Codex or opencode start a role (`mux_entity_start`) or use the launcher's
folder start, which has a CLI field.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | yes | Session display name |
| `projectPath` | string | yes | Working directory |
| `command` | string | no | Initial command to run in the session (replaces the Claude Code launch) |
| `visible` | boolean | no | If true, place session in the grid with focus |
| `shellOnly` | boolean | no | Plain shell, no CLI |
| `resume` | boolean | no | Launch with `--resume` |
| `model` | enum | no | `haiku`, `sonnet` or `opus` (`--model`) |
| `subProjektId` | string | no | Cyber Factory SubProjekt — resolves the model from it if none is given |

**Example:**
```json
{ "name": "fix-auth", "projectPath": "/path/to/project", "visible": true }
```

### `mux_kill_session`
Kill a session by ID.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | string | yes | Session ID (ULID) |
| `graceful` | boolean | no | Default true: send a cleanup prompt to Claude sessions before the kill |

### `mux_status`
Get cipher-mux system status (session count, service availability).

**Parameters:** none

### `mux_context_usage`
Get context window usage for sessions (from StatusLine monitor).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | string | no | Session ID. Omit to get all sessions. |

**Returns:** `{ usedPercentage, remainingPercentage, totalInputTokens, modelId, ... }`

All three adapters report usage in this shape. Claude Code writes it from a statusline hook,
Codex from the rollout JSONL, opencode from a plugin on the event bus — three writers, one
reader.

### `mux_entity_start`
Start an entity session — the same code path as the preset button in the UI. Use this for
Workshop, Cyber Factory, Refinement, Ideation Partner, Testing Assistant, Debugger, Audit.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | yes | Entity identifier, e.g. `"cyber-factory"`, `"refinement"`, `"debugger"` |
| `projectPath` | string | no | Project directory handed to the entity **as context** — not its working directory. That is always its run directory. Appears under Context Directories in its CLAUDE.md. |
| `name` | string | no | Override the display name |

The entity's CLI, model and role boundary are resolved at this point, per role. A role already
running under `singleInstance` is returned rather than started twice — and `singleInstance`
counts **per workspace**.

### `mux_readiness_stats`
Which signal reported sessions as ready? The readiness check has two: the session's own report
through its statusline hook, and the visible prompt as a fallback. The fallback stays until the
self-report is proven to carry — these statistics are the evidence.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | number | no | How many of the most recent entries to list in addition (default 0) |

---

## Messaging

> **The message bus is deprecated.** `mux_send` / `mux_read` still work and still write to
> SQLite, but they are not the way to say something to a session — that is `tmux send-keys`.
> What the module still carries is the database behind the TaskManager.

### `mux_send`
Send a message to the message bus. Optionally push-deliver to a target session via tmux send-keys.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `topic` | string | yes | `status`, `bug`, `review`, `chat`, or `system` |
| `sender` | string | yes | Sender identifier (e.g. "Workshop") |
| `text` | string | yes | Message text |
| `sessionId` | string | no | Target session ID for push delivery |
| `sessionName` | string | no | Target session name for push delivery |
| `noEnter` | boolean | no | If true, don't send Enter after push-delivered text |

**Example:**
```json
{ "topic": "chat", "sender": "workshop", "text": "Worker 1 ist fertig." }
```

### `mux_read`
Read messages from the message bus.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `topic` | string | no | Filter by topic |
| `limit` | number | no | Max messages (default 20) |

---

## Task Management

### `mux_task_create`
Create a task in the persistent task queue.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `title` | string | yes | Task title |
| `description` | string | no | Task description |
| `source` | string | no | Task source (default: "workshop") |
| `parent_id` | string | no | Parent task ID for subtasks |
| `policy` | object | no | Execution policy (see below) |

**Policy object:**
```json
{
  "stall_timeout": 60000,
  "max_retries": 2,
  "hooks": {
    "before_run": "echo start",
    "after_run": "echo done",
    "timeout": 5000
  }
}
```

### `mux_task_update`
Update task state or progress.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task_id` | string | yes | Task ID |
| `state` | string | no | `dispatched`, `running`, `done`, or `failed` |
| `session_id` | string | no | Session ID (required for dispatched -> running) |
| `result` | object | no | Result object: `{ summary?: string, data?: any }` |

### `mux_task_list`
List tasks with optional filters.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `state` | string | no | Filter by state |
| `source` | string | no | Filter by source |
| `parent_id` | string | no | Filter by parent task |
| `session_id` | string | no | Filter by assigned session |

### `mux_task_get`
Get a task by ID, including its children.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `task_id` | string | yes | Task ID |

---

## Notes

### `mux_notes_create`
Create a new note. The title is prepended as a `# heading` to the body automatically.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `title` | string | yes | Note title |
| `body` | string | yes | Markdown body (without the title heading) |
| `tags` | string[] | no | Tags, lowercase, as `class:value`. **Only registered values are accepted — an unknown tag fails the call.** |

**Tags are an axis model, not free text.** Seven classes: five axes defined in code
(`src/shared/tag-axes.ts`), two whose values are editable in the Tag Manager. You choose from
five of them; two are set by the Mux from the connection.

| Axis | Values | Who sets it |
|------|--------|-------------|
| `kind` | testcase, finding, spec, requirements, research, bugreport, handoff, journal, reference, todo, idea, plan, report, guide | you, exclusive |
| `phase` | research, architecture, coding, testing, debugging, automation, monitoring | you |
| `status` | open, in-progress, blocked, verify, done, superseded | you, exclusive |
| `severity` | low, mid, hi, now (editable in the Tag Manager) | you, exclusive |
| `component` | project-specific, editable in the Tag Manager | you |
| `workspace` | the active workspace **ID** | the Mux, from the connection |
| `entity` | the calling role | the Mux, from the connection |

Do **not** pass `workspace:` or `entity:` — the Mux sets those. Five tags is a recommendation,
not a limit: above it the call returns a warning and keeps every tag. It used to truncate
silently at five, which cost a handoff note its origin.

**Example:**
```json
{ "title": "BUG: Grid flicker on resize", "body": "## Steps\n1. Resize grid...", "tags": ["kind:bugreport", "status:open", "severity:mid"] }
```

### `mux_notes_list`
List all notes with optional tag filter.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tags` | string[] | no | Filter by tags -- only notes with at least one matching tag |

### `mux_notes_read`
Read a note by ID.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | yes | Note ID (ULID) |

### `mux_notes_update`
Partial update of a note (title, body, tags, handoff_status).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | yes | Note ID (ULID) |
| `title` | string | no | New title (updates the `# heading` in body) |
| `body` | string | no | New body (replaces entire body) |
| `tags` | string[] | no | New tags — **replaces** all existing ones, so pass what you want to keep, including `workspace:` and `entity:` |
| `handoff_status` | enum | no | `"pending"` or `"consumed"` (for handoff notes) |

Read the note first if you only mean to add one tag. The body of a **testcase** note cannot be
replaced here — use `mux_testcase_update`.

### `mux_notes_search`
Full-text search over notes. Max 50 results, title matches ranked first.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Search query (case-insensitive against title and body) |
| `tags` | string[] | no | Filter by tags -- only notes with at least one matching tag |

### `mux_notes_delete`
Delete a note by ID.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | yes | Note ID (ULID) |

### `mux_notes_handoff_create`
Create a handoff note for inter-session communication. Always tagged `"handoff"` with global scope.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `title` | string | yes | Handoff title, e.g. "Handoff: Auth refactor context" |
| `body` | string | yes | Markdown body with context, findings, next steps |
| `from_session` | string | yes | Name of the session creating this handoff |
| `to_entity` | string | no | Target entity ID or `"any"` (default) |

### `mux_notes_handoff_search`
Search for handoff notes. Returns newest first.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `to_entity` | string | no | Filter by target entity |
| `status` | enum | no | `"pending"` or `"consumed"` (default: `"pending"`) |

### `mux_notes_handoff_dispatch`
Deliver a handoff note into a target session, with the **current** world state computed and
prepended. Finds or starts the target session, sends the state block plus the note body, and
marks the note consumed.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `note_id` | string | yes | ID of the handoff note to deliver |
| `to_entity` | string | no | Target entity — overrides the note's own (required if that is `"any"`) |
| `project_path` | string | no | Repository the delta is computed against — overrides the note's `anchor_repo` |
| `force` | boolean | no | Deliver again even if already consumed (default false) |

**Why the state is computed and not stored:** a handoff note carries an anchor commit. Branch,
commits and diff since that anchor are derived at dispatch time, so a note that sat for three
days describes the repository as it is now, not as it was when written.

### `mux_notes_open`
Open a note in the grid as a NotesCell. If it is already open, focuses that cell.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | yes | Note ID (ULID) |
| `highlight` | boolean | no | Also highlight the note in the sidebar (default false) |

### `mux_testcase_update`
Structured update for testcase notes. Use this instead of `mux_notes_update` — the parser needs
the exact `- [ ] **T-ID** description` format, and a body replacement would break it.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `noteId` | string | yes | Note ID (ULID) of the testcase note |
| `operations` | array | yes | Operations applied in order (see below) |

| `op` | Fields | Effect |
|------|--------|--------|
| `set_status` | `itemId`, `status`: open \| pass \| fail | Set the checkbox state |
| `set_comment` | `itemId`, `comment` | Replace the item's comment |
| `add_item` | `section`, `id`, `description` | Append an item to a section |
| `add_section` | `title` | Append a new `## Section` |
| `set_resolution` | `itemId`, `resolution`: unresolved \| in_review \| addressed \| fixed \| wont_fix | Only valid on failed items |

### `mux_mirror_sync`
Mirror markdown files from a repository as typed notes. Repeatable — already mirrored files are
updated, not duplicated.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `repo_path` | string | yes | Absolute path of the repository |
| `directories` | string[] | yes | Directories relative to the repo, e.g. `["docs/superpowers/specs"]` |
| `note_type` | enum | no | `spec`, `requirements` or `research` (default: `spec`) |
| `workspace_id` | string | no | Workspace the notes inherit — otherwise this connection's binding |

**The Mux mirrors, not the role.** A role can forget, and then visibility depends on whether
somebody remembered. Drift between note and file is shown rather than claimed away
(`src/main/notes/mirror-drift.ts`).

---

## Companion Memory

Registered **only** for the Companion and for connections without a role. Removing a permission
would not have been enough: a permission produces a prompt, it does not withhold a tool.

### `companion_memory_write`
Write a memory to the companion memory store. When a workspace is active and no explicit scope is provided, memories are automatically scoped to the workspace (`scope_kind=workspace`).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `text` | string | yes | Memory content |
| `kind` | enum | yes | `fact`, `preference`, `interaction`, or `event` |
| `session_id` | string | no | Session that created this memory |
| `context_tags` | string[] | no | Context tags |
| `salience` | number | no | Importance 0..1 (default 0.5) |
| `scope_kind` | enum | no | `user` (global), `workspace`, or `session`. Auto-detected when workspace active. |
| `scope_id` | string | no | Workspace ID or session ID. Auto-filled from active workspace. |
| `note_id` | string | no | Note this memory points at. When the content belongs in a note, store a short line plus `note_id`, not the note text. |

### `companion_memory_recall`
Recall memories, ordered by **relevance** (salience, then recency) — not by recency alone, which
buried important old entries as the store filled up. When a workspace is active, returns both
global (user-scope) and workspace-scoped memories, excluding other workspaces. Entries with a
`note_id` are pointers: read the note.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `limit` | number | no | Max results (default 20) |
| `rank` | enum | no | `relevance` (default) or `recent` for strict newest-first |
| `entity_filter` | string | no | Filter by memory kind |
| `since_hours` | number | no | Only memories from the last N hours |
| `scope_kind` | enum | no | Explicit scope filter (overrides auto-detection) |
| `scope_id` | string | no | Explicit scope ID |

### `companion_memory_search`
Full-text search over memories (FTS5 syntax supported). When a workspace is active, results are post-filtered to include only global and active workspace memories.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Search query |
| `limit` | number | no | Max results (default 20) |

### `companion_memory_forget`
Delete a memory by ID.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | yes | Memory ID (ULID) |

---

## Grid & UI Control

### `mux_grid_resize`
Resize the session grid layout.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `cols` | number | yes | Number of columns (1-7) |
| `rows` | number | yes | Number of rows (1-3) |

### `mux_grid_place`
Place a session in a specific grid cell.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | string | yes | Session ID |
| `col` | number | yes | Column index (0-based) |
| `row` | number | yes | Row index (0-based) |

### `mux_session_focus`
Focus a session in the grid (scroll to it, highlight). Background sessions are brought into the grid first.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | string | yes | Session ID |

### `mux_session_eject`
Eject a session from the grid to background. The session continues running but is no longer visible.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | string | yes | Session ID |

### `mux_sidebar_toggle`
Toggle sidebar visibility.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `visible` | boolean | no | Explicit state. Omit to toggle. |

### `mux_cell_scroll`
Scroll a terminal cell in the grid.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sessionId` | string | no | Target session ID. If omitted, uses the calling session. |
| `cell` | string | no | Target cell by grid position (e.g. `"cell-0-0"`). Alternative to sessionId. |
| `action` | enum | yes | `"up"`, `"down"`, `"top"`, `"bottom"`, or `"to-marker"` |
| `lines` | number | no | Lines to scroll (only for up/down). Default: ~1 page. |

**Actions:**
- `up` / `down` -- scroll by ~1 page (or `lines` if specified)
- `top` / `bottom` -- jump to extremes
- `to-marker` -- jump to the start of the last response (marker set automatically on each user submission)

---

## Demo & Presentation

### `mux_ui_highlight`
Highlight a UI element with a visual effect.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `target` | string | yes | Value of `data-highlight` attribute |
| `duration` | number | no | Milliseconds (default 3000, `0` = permanent) |
| `style` | enum | no | `"glow"` (default, border box-shadow) or `"outline"` |
| `clear` | boolean | no | `true` = remove all highlights |

**Known targets:** `sb-voice`, `sb-grid`, `sb-workspaces`, `sb-sidebar`, `sb-theme`, `sb-info`, `cell-{col}-{row}`, `cell-head-{col}-{row}`, `side-messages`, `side-background`, `side-notes`, `side-requests`, `side-memory`, `side-note-{id}`, `side-session-{id}`, `side-message-{id}`, `popup-workspace`, `popup-launcher`, `popup-info`

### `mux_ui_open`
Open, close, or toggle a popup/dialog.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `target` | string | yes | Dialog name (alias `"settings"` resolves to `"info-dialog"`) |
| `action` | enum | no | `"open"`, `"close"`, or `"toggle"` (default: `"toggle"`) |
| `context` | object | no | Additional context (e.g. `{ "cell": "1-0", "tab": "themes" }`) |

**Known targets:** `workspace-popup`, `info-dialog` (alias: `settings`), `launcher-popup`

### `mux_theme_set`
Set the active UI theme.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `theme` | string | yes | Theme ID |

**Valid IDs** (13, the list in `src/shared/grid-types.ts`): `cipher-ivory` (default),
`cipher-dark`, `blueprint`, `warm-paper`, `gruvbox-dark`, `nord`, `synthwave`, `matrix`,
`brutalist`, `high-contrast`, `cvd-deuteranopia`, `cvd-tritanopia`, `cvd-achromatopsia`.
Custom themes made in the theme editor are addressed by their own ID.

### `mux_ui_choreography`
Play a timeline of UI actions client-side with precise timing. One call replaces many sequential `mux_theme_set` / `mux_ui_highlight` calls. Actions execute in the renderer with no network roundtrip between steps. Max 100 steps, max 30s total duration.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `timeline` | array | yes | Array of timed UI actions (see below) |

**Timeline step object:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `at` | number | yes | Milliseconds from timeline start |
| `action` | enum | yes | `"theme"`, `"highlight"`, `"highlight_clear"`, `"open"`, `"close"`, `"grid_resize"`, or `"sidebar"` |
| `value` | string | no | Theme ID (for `action=theme`) |
| `target` | string | no | Element target (highlight: `data-highlight` attr; open/close: popup ID) |
| `duration` | number | no | Highlight duration in ms (default 3000) |
| `style` | enum | no | `"glow"` or `"outline"` (default: `"glow"`) |
| `cols` | number | no | Grid columns 1-7 (for `action=grid_resize`) |
| `rows` | number | no | Grid rows 1-3 (for `action=grid_resize`) |
| `visible` | boolean | no | Sidebar visibility (for `action=sidebar`; omit to toggle) |

**Example:**
```json
{
  "timeline": [
    { "at": 0, "action": "theme", "value": "synthwave" },
    { "at": 500, "action": "highlight", "target": "sb-theme", "duration": 2000 },
    { "at": 3000, "action": "theme", "value": "cipher-dark" },
    { "at": 3500, "action": "highlight_clear" }
  ]
}
```

---

## Voice / TTS

### `mux_tts_speak`
Speak text aloud via TTS. Use this to read responses to the user. Only speak key messages -- skip code, tool output, and debug info.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `text` | string | yes | Text to speak aloud |
| `priority` | enum | no | `"normal"` (queue after current) or `"interrupt"` (stop current, play immediately) |

**Requires:** Voice mode must be active (user enables via StatusBar), or falls back to macOS `say`.

**Example:**
```json
{ "text": "Drei Sessions laufen. Alles im gruenen Bereich.", "priority": "normal" }
```

---

## Entity Pipeline — Runs

A run is the state a role keeps across its own session: what it is working on, what it found,
and what it may hand on. The handoff tools in the next section read it.

### `mux_testing_run_start`
Start a Testing Assistant run against a project.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectPath` | string | yes | Absolute path to the project |
| `testCommand` | string | no | Override the test command (default: from CLAUDE.md) |
| `cyberFactoryRunId` | string | no | Associated Cyber Factory run |
| `welleId` | string | no | Associated wave |
| `workspaceId` | string | no | Workspace scope |

### `mux_testing_run_complete`
Mark a testing run complete and get the handoff recommendation.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `runId` | string | yes | Testing run ID |

### `mux_audit_run_start`
Start an audit run.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectPath` | string | yes | Project to audit |
| `scope` | enum | no | `welle`, `komplett` or `modul` (default: `welle`) |
| `scopeDetail` | string | no | Detail for the scope — a git range for `welle`, a directory for `modul` |
| `workspaceId` | string | no | Workspace scope |

### `mux_audit_run_complete`
Complete an audit run and generate the release recommendation.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `runId` | string | yes | Audit run ID |

### `mux_debugger_findings_intake`
Submit structured findings to the Debugger. Creates a run and names the clarification gaps.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `symptom` | string | yes | What is happening |
| `reproduction` | string | yes | Steps to reproduce |
| `severity` | enum | yes | `high`, `medium` or `low` |
| `projectPath` | string | yes | Project path for the run |
| `suspectedCause` | string | no | Hypothesis about the root cause |
| `affectedAreas` | string[] | no | File paths likely involved |
| `source` | enum | no | `testing-assistant`, `bugreport` or `manual` (default: `manual`) |
| `bugReportId` | string | no | Link to an existing bugreport |

### `mux_cyber_factory_diagnose`
Health report for a Cyber Factory run: run status, waves, workers, escalation backlog.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `run_id` | string | yes | Cyber Factory run ID |

### `mux_local_worker_dispatch`
Local Cyber Factory: starts a fresh local worker (opencode + local model) on one work item
and returns at once; the architect is woken with one `[local-factory] #N …` line when the
gate has run. With `accept: true` plus `laufId` and `haeppchen` it marks a green item as
accepted instead. **Nur für die Rollen `local-factory` und `local-workshop` registriert** — keine andere Rolle
und keine rollenlose Verbindung bekommt es. Für `local-workshop` ist `geschuetzteTests` leer
erlaubt (Routine ohne eigenen Test; `testBefehl` bleibt Pflicht), und `accept` trägt das Urteil.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
The dispatch fields are optional in the schema, because `accept` does not need them; on a
dispatch they are required and enforced by the runner (`validateAuftrag`). `accept: true`
without both `laufId` and `haeppchen` is an error, not a dispatch, and returns `ok: false`
with a reason when nothing was accepted (unknown run, item not green-waiting).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projekt` | string | dispatch | Absolute path of the target git repo |
| `ziel` | string | dispatch | Goal of the work item |
| `dateien` | string[] | dispatch | Files to work on |
| `akzeptanzkriterium` | string | dispatch | Acceptance criterion |
| `geschuetzteTests` | string[] | dispatch | Acceptance tests plus every file the test command depends on (repo-relative or absolute) |
| `testBefehl` | string | dispatch | Shell command; exit 0 = green |
| `nichtZiele` | string[] | dispatch | What stays untouched (may be empty) |
| `laufId` | string | retry, accept | Returned by the first dispatch; pass it on every later item and retry |
| `haeppchen` | number | retry, accept | Work item number |
| `profil` | string | no | Dispatch: model profile from `agent.localWorkerProfiles`; omitted = `agent.localWorkerDefaultProfile` (or `agent.localWorker` as profile `default`) |
| `accept` | boolean | no | Mark the item as accepted |
| `ergebnis` | enum | local-workshop, with `accept` | `uebernommen`, `nachgebessert`, `neu-geschnitten`, `selbst-uebernommen` |
| `kategorie` | enum | local-workshop, with `accept` | `test`, `boilerplate`, `refactor`, `doku`, `ui`, `config`, `logik` |
| `notiz` | string | `ergebnis=nachgebessert` | What had to be fixed; feeds the Bilanz note. Optional otherwise |

For `local-workshop`, `accept` records the verdict (status `beurteilt`) and appends one line to the
Bilanz; it also works for an exhausted item. A `beurteilt` item cannot be dispatched again.

### `mux_ideation_skill_run`
Run an ideation skill with the current brain as context. Returns the skill markdown for
execution.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `skillId` | string | yes | e.g. `"pre-mortem"`, `"persona-roundtable"`, `"oss-telescope"` |
| `skillsDir` | string | no | Skills directory (default `~/.config/cipher-mux/skills/ideation/`) |

---

## Entity Pipeline — Handoffs

Ten tools, generated from one definition in `src/main/mcp/handoff-kernel.ts`. Each starts or
finds the target session, delivers a structured payload, and names the sender. This is why a
grep for `registerMuxTool(` undercounts the total by exactly ten.

| Tool | From → to | Required fields |
|------|-----------|-----------------|
| `mux_ideation_handoff_refinement` | Ideation → Refinement | `anforderungspaketPath`; `projectPath` optional |
| `mux_refinement_handoff_cyber_factory` | Refinement → Cyber Factory | `detailSpecPath`, `projectPath`; `lifecyclePhase` optional (default `architect`) |
| `mux_refinement_handoff_ideation` | Refinement → Ideation | `reason`, `gaps[]`; `projectPath` optional — the way back when the requirements have systematic gaps |
| `mux_cyber_factory_handoff_testing` | Cyber Factory → Testing | `run_id`, `welle_id`, `summary` |
| `mux_cyber_factory_handoff_debugger` | Cyber Factory → Debugger | `run_id`, `findings_report`, `severity_summary` |
| `mux_cyber_factory_handoff_audit` | Cyber Factory → Audit | `run_id`, `projectPath`, `scope` |
| `mux_testing_handoff_cyber_factory` | Testing → Cyber Factory | `runId`, `results`, `passRate` (0–100) |
| `mux_testing_findings_handoff_debugger` | Testing → Debugger | `runId` — the findings come from the run, not from the call |
| `mux_debugger_handoff_cyber_factory` | Debugger → Cyber Factory | `findings`, `recommendations[]` |
| `mux_debugger_handoff_testing` | Debugger → Testing | `fixSummary`, `affectedFiles[]` |
| `mux_audit_handoff_cyber_factory` | Audit → Cyber Factory | `run_id`, `verdict`, `findings_summary`, `high_count`, `medium_count` |

`projectPath` is always the directory handed to the target **as context** — never its working
directory. An entity session always works in its own run directory under
`~/.config/cipher-mux/runs/<workspaceId>/<entityId>/`.

---

## Hub Migration

Seven tools for moving an existing project into the CIPHER-MUX Hub. The order is the safety
property: inventory → plan → apply → verify → release, with rollback available until release.

### `mux_hub_integrate`
Copy an existing project into the Hub. Excludes build artifacts. **The original stays
untouched** — that is the fallback guarantee.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sourcePath` | string | yes | Absolute path to the source project |
| `projectName` | string | no | Name in the Hub (default: directory name) |
| `excludeBuildArtifacts` | boolean | no | Exclude `node_modules`, `dist`, `.cache` … (default true) |

### `mux_hub_inventory`
Read-only brownfield inventory: stack, structure, specs, tests.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectName` | string | yes | Project name in the Hub |

### `mux_hub_migration_plan`
Generate a three-section plan from the inventory: unchanged, extended, new.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectName` | string | yes | Project name in the Hub |
| `mode` | enum | no | `voll` or `pack-light` (default: `voll`) |
| `components` | string[] | no | Components, for `pack-light` |

### `mux_hub_apply`
Execute the plan's steps. Idempotent — already applied steps are skipped.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectName` | string | yes | Project name in the Hub |
| `planPath` | string | no | Path to the plan file (default: latest) |
| `dryRun` | boolean | no | Preview only (default false) |

### `mux_hub_verify`
Run build and test suite in the Hub copy. **The gate before release: no green verify, no
release.**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectName` | string | yes | Project name in the Hub |
| `installDeps` | boolean | no | Install dependencies (default true) |
| `runBuild` | boolean | no | Run the build (default true) |
| `runTests` | boolean | no | Run the tests (default true) |

### `mux_hub_release`
Mark the project released: push-lock on the original, write `MIGRATED.md`, update
`ARCHIV-VERWEIS.md`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectName` | string | yes | Project name in the Hub |

### `mux_hub_rollback`
Point the workspace back at the original path, remove the push-lock, delete `MIGRATED.md`.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectName` | string | yes | Project name in the Hub |
| `removeHubCopy` | boolean | no | Delete the Hub copy — destructive, needs confirmation |

---

## Other

### `kickoff_complete`
Signal that a project launcher has completed scaffolding. cipher-mux reacts by opening a new Claude session in the project directory.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectPath` | string | yes | Absolute path to the project directory |
| `projectName` | string | yes | Project name (kebab-case, from directory name) |
| `detectedStack` | string | no | Detected tech stack (e.g. "kotlin-android", "electron-ts", "python") |

### `mux_bugreport_resolve`
Resolve a bugreport (move from outbox to inbox).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `bugId` | string | yes | Bug ID (e.g. BUG-2026-04-19-abc123) |
| `status` | enum | yes | `"fixed"` or `"failed"` |
| `summary` | string | yes | What was done |
| `branchName` | string | no | Git branch with the fix |
| `filesChanged` | string[] | no | List of changed files |
