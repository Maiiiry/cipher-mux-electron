<p align="center">
  <img src="assets/banner.svg" alt="cipher-mux — Coding Cockpit for agent CLIs" width="100%">
</p>

<h3 align="center">Agentic Engineering for Makers.<br><sub>And everyone else.</sub></h3>

<p align="center">
  Orchestrates <b>three agent CLIs</b> into a real development process — with roles, memory, and voice.<br>
  <sub>Claude Code is the default. Codex CLI and opencode run alongside it.</sub>
</p>

<p align="center">
  <a href="https://cipher-mux.dev"><b>cipher-mux.dev</b></a> ·
  <a href="https://cipher-mux.dev/en/features">Features</a> ·
  <a href="https://cipher-mux.dev/en/docs">Docs</a> ·
  <a href="https://cipher-mux.dev/en/start">Download</a>
</p>

<p align="center">
  <a href="https://github.com/cmarkus42-rgb/cipher-mux-electron/actions"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/cmarkus42-rgb/cipher-mux-electron/ci.yml?branch=main&label=CI&style=flat-square&labelColor=000000&color=F5F5EC"></a>
  <a href="https://github.com/cmarkus42-rgb/cipher-mux-electron/releases"><img alt="Version" src="https://img.shields.io/badge/version-0.12.6-0088A0?style=flat-square&labelColor=000000"></a>
  <a href="#built-with-itself"><img alt="Tests" src="https://img.shields.io/badge/tests-2532%20green-00FF88?style=flat-square&labelColor=000000"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-F5F5EC?style=flat-square&labelColor=000000"></a>
  <a href="#install"><img alt="Platform" src="https://img.shields.io/badge/platform-macOS%2012%2B-F5F5EC?style=flat-square&labelColor=000000"></a>
  <a href="CONTRIBUTING.md#maintenance-status"><img alt="Maintenance" src="https://img.shields.io/badge/maintenance-active-00FF88?style=flat-square&labelColor=000000"></a>
  <a href="#install"><img alt="Open Beta" src="https://img.shields.io/badge/status-open%20beta-0088A0?style=flat-square&labelColor=000000"></a>
</p>

<p align="center"><sub><b>v0.12.6</b> · open beta · feedback via <a href="https://github.com/cmarkus42-rgb/cipher-mux-electron/issues">Issues</a></sub></p>

---

<p align="center">
  <img src="assets/screenshots/main.png" alt="cipher-mux — 2x2 grid with companion, cyber-factory, debugger, and refinement sessions" width="100%">
</p>

<p align="center"><sub><i>2×2 grid — four entity sessions in parallel, sidebar with background sessions and context usage.</i></sub></p>

---

## What it is

An Electron window with a grid of up to **21 cells** (7×3). Each cell is its own agent-CLI
process — Claude Code, Codex CLI or opencode, picked per role — or a Markdown editor. Behind
them, tmux keeps every session alive: through a crash, through a restart, through you closing
the app on purpose.

Got an idea? Build it. cipher-mux structures the path from idea to code, with specialized roles
that build in the quality and security a single chat session cannot hold.

<br>

<div align="center"><sub><b>FOUR PILLARS · ONE MANIFEST</b></sub></div>

<table>
<tr>
<td width="50%" valign="top">

**`// pillar 01`**

#### Coding with AI, done right

A single session that plans, codes and tests at once loses focus. Context fills, early
instructions get compressed, quality drops.

cipher-mux separates the phases into dedicated sessions — Ideation, Refinement, Cyber Factory,
Testing, Debugger, Audit — each with its own context. Clean handoffs instead of context
pollution.

</td>
<td width="50%" valign="top">

**`// pillar 02`**

#### Built for everyone

No CS degree required. The Companion shows you everything — by chat, by voice, or by
highlighting the UI element it is talking about.

It remembers your skill level and adapts its explanations. It knows every chapter of the
documentation and answers faster than you can scroll.

</td>
</tr>
<tr>
<td width="50%" valign="top">

**`// pillar 03`**

#### Transparent, not magic

You see what the agents do. Every session runs visibly in a grid cell, and you can intervene in
any of them.

The instruction layers — Global Rules → Role → Character → Workspace → Cell — are plain text
files on disk. If you want to know why a session answered the way it did, read its instructions.

</td>
<td width="50%" valign="top">

**`// pillar 04`**

#### Designed for access

13 themes, three for colour vision deficiencies, plus a WCAG AAA high-contrast theme and an
editor for every colour token.

Speech recognition runs fully local through Whisper — no network, no cloud. Bluetooth remote for
hands-free operation.

</td>
</tr>
</table>

---

## What's in the window

| | |
|---|---|
| **Three agent CLIs** | Claude Code (Tier 1), Codex CLI (Tier 2), opencode (Tier 2). One per role, or a global default → [Agent CLIs](#agent-clis) |
| **Grid** | Up to 21 cells, drag & drop, vertical merges, Focus Mode |
| **8 roles** | Companion, Ideation, Refinement, Cyber Factory, Testing, Debugger, Workshop, Audit — each with its own directory, instructions and recovery |
| **6 characters** | How the model talks to you: from bone-dry (Cipher) to socratic (Theaitetos) to chaos (Der Glitch) |
| **Workspaces** | One project, one workspace: folders, grid layout, roles, prompts. Switch in one click; roles run in several workspaces at once |
| **Role boundaries** | A role that coordinates cannot write code — enforced by a hook, not by a polite sentence |
| **Voice I/O** | Local Whisper STT, Silero VAD, Piper or macOS TTS, Bluetooth remote. **Commands are German** |
| **MCP server** | 67 tools in 12 categories, Streamable HTTP, bound per connection to workspace and role |
| **Notes** | Markdown editor (CodeMirror 6), auto-tagging via local Ollama, handoff notes with a live world-state delta, file mirroring with visible drift |
| **Tags** | Five axes plus two editable classes, exclusive groups, hierarchical tree with tri-state filtering |
| **Companion memory** | SQLite FTS5, workspace-scoped, available to the Companion |
| **Session recovery** | Close the app, reopen, resume — tmux kept everything |
| **Accessibility** | 13 themes incl. WCAG AAA and three CVD profiles, configurable fonts, reduced motion, 66 ARIA annotations |

---

## What cipher-mux is not

- **Not a commercial product.** An open-source project born out of personal necessity.
- **Not a replacement for the agent CLIs** — a graphical orchestration layer on top of them.
- **Not a magic wand for vague ideas.** The ability to formulate a precise specification remains
  essential.
- **Not cross-platform.** macOS only, because the architecture sits on tmux.
- **Not usable without a CLI.** At least one supported agent CLI is required. Claude Code is the
  default and needs an Anthropic account; which subscription includes it may change — current
  info at anthropic.com. Codex CLI and opencode work too, at Tier 2.

---

## Table of Contents

- [Install](#install)
- [Usage](#usage)
- [Agent CLIs](#agent-clis)
- [Built with Itself](#built-with-itself)
- [How It Compares](#how-it-compares)
- [FAQ](#faq)
- [Architecture](#architecture)
- [Accessibility](#accessibility)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

---

## Install

**Requirements:** macOS 12+ (Apple Silicon or Intel) · at least one supported agent CLI · ~1 GB
free space

### macOS (DMG)

1. Download the latest `.dmg` from [Releases](https://github.com/cmarkus42-rgb/cipher-mux-electron/releases)
2. Open it, drag `cipher-mux.app` to Applications
3. Remove the quarantine flag, once: `xattr -cr /Applications/cipher-mux.app`
4. Launch — the **Setup Wizard** takes it from there

The DMG is **unsigned**, deliberately: notarisation costs an Apple developer account, and this
project does not have one. Step 3 is what that costs you.

The wizard detects what is missing and installs it:

| Component | Status | Size |
|-----------|--------|------|
| **Homebrew** | required | ~200 MB |
| **tmux** | required | ~2 MB |
| **Node.js** | recommended | ~30 MB |
| **Claude Code CLI** | recommended | ~50 MB |
| **Whisper model** (local STT) | optional | ~500 MB |
| **Piper TTS** (local speech) | optional | ~30 MB |

Then log in to Claude Code, once:

```bash
claude login
```

> **Codex CLI and opencode are deliberately absent from that table.** The wizard neither
> installs nor checks them — `src/main/setup/` and `src/main/util/dependency-check.ts` know only
> the Claude Code CLI. If you point a role at Codex or opencode, install and authenticate that
> CLI yourself.

### Linux & Windows

Not yet. Linux is planned. Windows is on the roadmap without a date.

### Manual install

```bash
# required
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install tmux

# recommended
brew install node
npm install -g @anthropic-ai/claude-code
claude login

# optional: voice models
curl -L -o ~/.cache/cipher-mux/ggml-base.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
curl -L -o ~/.cache/cipher-mux/de_thorsten-medium.onnx \
  https://huggingface.co/rhasspy/piper-voices/resolve/main/de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx
```

### From source

```bash
git clone https://github.com/cmarkus42-rgb/cipher-mux-electron.git
cd cipher-mux-electron
npm install
npm run dev          # tsc --watch + Vite, hot reload in the renderer
```

```bash
npm run test         # the suite — needs Node 22, see CONTRIBUTING.md
npm run lint         # ESLint
npm run dist         # unsigned DMG into out/
```

> **Node 22 is not a suggestion.** Under a newer Node, `better-sqlite3` fails to compile, the
> rebuild step aborts, and the `&&` chain in `npm run test` runs **zero** tests — which looks
> exactly like a clean run. No test output means the PATH was wrong.

---

## Usage

> **Walkthrough:** [docs/HOWTO.md](docs/HOWTO.md) is the narrative version — install, first
> project, orchestrator, first delegation, voice bug report. What follows is the map.

### The grid

Each cell is an agent-CLI session inside tmux. Click to focus. The activity rail on the left
shows status, unread messages and context usage at a glance. Focus Mode fills the grid with one
cell and dims the rest.

### Roles

Eight roles structure the process. Each gets its own directory, its own `CLAUDE.md` (or
`AGENTS.md`, depending on the CLI), and can be recovered after a restart.

| Role | What it is for |
|------|----------------|
| **Coding Companion** | Your constant guide. Knows your profile, answers questions about the system, gets you started. |
| **Ideation Partner** | Research and synthesis. Turns brainstorming into a tangible concept. |
| **Refinement** | Requirements analysis. Turns a vague idea into a precise specification. |
| **Cyber Factory** | Decomposition into subsystems, coordinates several workers in parallel. |
| **Testing Assistant** | Judges generated code critically. Writes tests and runs them. |
| **Debugger** | Systematic root-cause search instead of trial and error. |
| **Workshop** | Oversees the whole process. Distributes tasks, watches context, rotates workers. |
| **Audit** | Final review for quality, security and consistency. |

Two more exist that you do not start by hand: **Voice-Relay** and **Launcher**.

### Characters

A character controls *how* the model talks to you — six of them, from bone-dry (**Cipher**)
through socratic (**Theaitetos**) to deliberately disruptive (**Der Glitch**). Write your own in
the Companion tab.

Not to be confused with **personas**: those are the grid roles a workspace arranges (Requirements
Engineer, System Engineer, Developer, Architect, Auditor).

### Prompt architecture

A session's instructions are assembled, not configured: role (function) × character (tone) ×
workspace (project context). Resolution has three levels — cell prompt > workspace override >
default.

Workspace prompt and context directories are injected as sections **into the project
instruction file**, not passed as a CLI argument. That is what makes them survive a `/clear`.

### Voice

Local Whisper STT with Silero VAD for voice activity detection, no cloud. Push-to-talk by
default, pin mode for hands-free dictation. Grid navigation and scrolling by voice. Bluetooth
remote (BT Shutter) supported.

**The command vocabulary is German** — `grid hoch`, `zelle rechts`, `ganz runter`,
`zum marker` — and transcription defaults to German. Dictation itself follows whatever Whisper
hears; the fixed commands do not.

### Notes and memory

Markdown editor with auto-tagging through a local Ollama (`gemma4:26b`). A **handoff note**
carries an anchor commit, and the world state — branch, commits, diff since the anchor — is
computed when it is dispatched, not when it was written. A note can mirror a file in git and
shows drift instead of claiming authority. Companion memory is SQLite FTS5, scoped per
workspace.

---

## Agent CLIs

A role is not tied to one CLI. Three adapters ship in the registry
(`src/main/agent/registry.ts`):

| CLI | Adapter id | Tier | Project instructions | Measured against | Unmeasured |
|-----|-----------|------|---------------------|------------------|------------|
| **Claude Code** | `claude-code` | Tier 1 | `CLAUDE.md`, `.claude` | v2.1.284 | — |
| **Codex CLI** | `codex` | Tier 2 | `AGENTS.md`, `.codex` | codex-cli 0.155.1 | sub-agents |
| **opencode** | `opencode` | Tier 2 | `AGENTS.md`, `opencode.json`, `.opencode` | opencode 1.18.34 | sub-agents |

**Tier 2 means: not every capability has been measured there.** The last column is not a guess —
it is the set of `false` entries in the adapter's own `getCapabilities()`. A `false` says
*unproven*, not *impossible*: both Tier-2 CLIs do have sub-agents; what is unproven is whether
the Mux sees them. Grid, roles, characters, workspaces, notes, voice, the MCP server and context
display work under all three.

Two differences are worth naming outright.

**Role boundaries use a different mechanism per CLI.** Claude Code and Codex enforce them
through a `PreToolUse` hook, opencode through a plugin on `tool.execute.before`. All three were
proven to deny *selectively* against the live CLI, with the reason arriving at the model
verbatim. The mechanism differs; the guarantee does not.

> **The shell gap is shared.** `Bash` carries a command, not a path — a file can still be
> changed through the shell. Closing that would mean parsing shell syntax, and a half-hearted
> parser is another boundary that only looks like one. The boundary is a guardrail against
> mistakes, not a sandbox.

**opencode needs an authenticated provider.** Without one it starts, reaches its prompt, and
then does nothing on any input. No flag removes this — it is a precondition, not a dialog.

### Choosing a CLI and a model

- **Per role:** fields **CLI** and **Modell** in the preset editor. `Default` follows the global
  setting. Takes effect at that role's next session start — a running session does not switch.
  Under the field, the editor names what is unmeasured under the CLI you picked.
- **Globally:** **Default CLI** in Settings → General. Takes effect immediately, for sessions
  started afterwards.

The model field is free text **with** suggestions, not a dropdown — none of the three lists is
complete, and all three CLIs accept a full model name that is not in them. Claude Code offers no
command to list models at all; `--help` names `opus`, `sonnet` and `fable` as *examples*.

Resolution order, in `src/main/session/entity-runtime.ts`:

```
app.entityAdapters[<role>]      your per-role choice
  > role default                EntityConfig.adapterId, if the role carries one
  > agent.defaultAdapter        the global setting; ships as 'claude-code'
```

### Where the config lives

```
~/Library/Application Support/cipher-mux-electron/cipher-mux-config.json
```

That is `app.getPath('userData')`.

> **There is also `~/.config/cipher-mux/config.json`, and cipher-mux does not read it.** Editing
> that file changes nothing and costs an evening. `~/.config/cipher-mux/` holds *content* — role
> directories (`entities/`), run directories (`runs/<workspaceId>/<entityId>/`), voice models —
> but no app settings. You should not need to touch either file: everything above is settable in
> the UI.

### Local Cyber Factory: Claude slices, a local model codes

Since 0.12.0. Two roles and a runner. The architect (`local-factory`, Claude Code) cuts work into
small slices and writes an acceptance test for each; a role boundary keeps it out of production
code. The worker (`local-worker`, opencode) writes the code against any OpenAI-compatible
endpoint set under `agent.localWorker`, gets a fresh session per attempt, and may not touch the
acceptance tests. Between them, a runner with no model checks that the test is red and the tree
clean, then gates the result on the test command, a checksum and a git diff of the protected
tests. Green is committed; red is saved as a patch and reset. Two attempts per slice, then it
escalates to you.

First real run: `qwen3.8-27b` on a DGX Spark, four slices, all green on the first attempt,
100–180 s each.

Limits: needs `agent.skipPermissions`, or opencode hangs in its permission prompt (the Mux refuses
to start and says so). A local model that hits its output limit stops silently; the runner counts
that as a failed attempt. Only tests the architect lists are protected. The worker does not write
its own unit tests yet. Slices run one at a time. Design and measurements:
`docs/superpowers/specs/2026-10-09-local-cyber-factory-design.md`.

---

## Built with Itself

cipher-mux was built with cipher-mux. **Not a single test was written by hand** — every one was
produced by an agent session. From Wave 5 the Testing role was wired into the process: it writes
tests, hands findings to the Debugger, and the cycle runs without a manual trigger.

| Wave | Tests | Milestone |
|------|------:|-----------|
| 0 | 400 | Baseline |
| 1–2 | 520 | Hub, MCP, Grid |
| 3–4 | 700 | Debugger, Factory |
| 5 | 841 | Entity pipeline active |
| 6 | 1,050 | Handoff, Voice |
| 7 | 1,207 | Audit, Pre-Release |
| 8 | 1,509 | Detach, Tags, test cleanup |
| **now** | **2,249** | three CLIs · 467 suites · ~91 s · 0 fail |

668 of the first 1,509 tests came out of waves 6 through 8 — produced by the process itself.
**0 high-severity findings** in the final audit.

> The developer's job was to design the process, and then stay out of its way.

---

## How It Compares

| Tool | Focus | The difference |
|------|-------|----------------|
| **Claude Squad / CCManager** | terminal-native session multiplexing | Minimalist, no GUI. If you want terminal-only and no overhead, those are the better choice. cipher-mux adds an MCP server, voice, task outbox and structured orchestration. |
| **Conductor / Nimbalyst** | polished Mac apps | Commercial, no tmux dependency. If you want Mac-native polish without tmux, look there. |
| **agtx** | OSS orchestrator with Kanban | Closest in the OSS space — orchestrator agent and task board. cipher-mux adds the Electron UI, voice and the MCP server; agtx goes further on agent delegation. |

All of these are valid choices. Pick what fits your workflow.

---

## FAQ

### How many MCP tools are there?

**67**, in twelve categories: Session Management, Messaging, Task Management, Notes, Companion
Memory, Grid & UI Control, Demo & Presentation, Voice/TTS, Entity Pipeline (Runs and Handoffs),
Hub Migration, and Other. Full reference: [docs/mcp-tools.md](docs/mcp-tools.md).

Counting them from the source undercounts: a grep for `registerMuxTool(` finds 57, because the
ten entity handoff tools are generated from a single definition.

### Which agent CLIs are supported?

Three: Claude Code (Tier 1, the default), Codex CLI (Tier 2), opencode (Tier 2). See
[Agent CLIs](#agent-clis).

### Can I speak English to it?

Dictation, yes — Whisper transcribes what it hears. The fixed **commands** are German only
(`grid hoch`, `zelle links`, `ganz runter`), and transcription defaults to German. An English
command vocabulary does not exist yet.

### I edited `~/.config/cipher-mux/config.json` and nothing changed

That is not the file cipher-mux reads. See
[Where the config lives](#where-the-config-lives).

### What are entities?

Entities are the roles: a session type with pre-configured instructions, character, tool access
and its own directory. Ten exist; eight you start yourself. Each gets its own project
instruction file, and the Companion has memory across sessions.

### Does it work on Linux?

Not yet. Planned.

### Can I write my own adapter?

Yes — three exist, and the third was built against the same contract as the first. See
[CONTRIBUTING.md](CONTRIBUTING.md#writing-an-adapter), the reference stub at
`src/main/agent/adapters/_reference-stub.ts`, and the
[adapter test protocol](docs/contributing/adapter-test-protocol.md).

Read the headers of `adapters/codex.ts` and `adapters/opencode.ts` before you start. They list
what was measured about each CLI and what was not — including four silent failure modes that
produce a session which comes up, looks healthy, and has no tools.

---

## Architecture

Full overview, module map and contributor entry points:
[ARCHITECTURE.md](ARCHITECTURE.md).

**Stack:** Electron 34 · Preact · Vite · TypeScript (strict) · xterm.js (WebGL with Canvas
fallback) · better-sqlite3 (WAL) · MCP SDK · tmux control mode.

```
src/main/              Electron main process
  agent/               AgentAdapter contract, registry, three adapters
  tmux/                TmuxManager, control-mode parser, output batcher
  mcp/                 Streamable HTTP MCP server, 67 tools, auth, per-connection binding
  session/             SessionManager, recovery, entity registry, role boundaries
  workspace/           Workspaces, prompt resolution, skill sync
  notes/               NoteManager, tagging, handoff delta, mirror drift
  companion/           MemoryStore (SQLite FTS5)
  voice/               Whisper STT, Piper TTS, Silero VAD, conversation engine
  task/                Task state machine, watcher, hooks
  monitoring/          Context usage, one writer per CLI
  bluetooth/           BT Shutter / HID remote
src/renderer/          Preact UI — Grid, ActivityRail, Cockpit, Notes, Settings
src/shared/            Typed IPC channels, domain types, tag axes, themes
test/main/             ~110 test files
docs/                  9 ADRs, specs, plans, acceptance protocols
```

---

## Accessibility

- **13 themes**, three for colour vision deficiencies: Deuteranopia/Protanopia (Okabe-Ito
  palette), Tritanopia, Achromatopsia (full greyscale).
- **High contrast** — a WCAG AAA black/white/yellow theme for low vision.
- **Theme editor** — every colour token is editable; custom themes sit beside the built-in ones.
- **Focus Mode** — dims every cell but the focused one.
- **Fonts** — family, three independent sizes (10–32 px, 8–28 px, 10–32 px), line height
  (1.0–3.0) and letter spacing (0–5 px).
- **Reduced motion** — respects `prefers-reduced-motion`, overridable in A11y settings.
- **ARIA** — 66 annotations across the renderer for screen readers.

---

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) has the development setup, how to run the suite, commit
conventions and the PR checklist.

**Maintenance status: active.** Maintained by a single developer as an open-source side project.

## Security

Found a vulnerability? Please do not open a public issue. [SECURITY.md](SECURITY.md) has the
private channel and the expected timelines.

## License

[MIT](LICENSE) · Copyright (c) 2026 Christian Markus and cipher-mux contributors.

Third-party licenses in [NOTICE](NOTICE). Bundled fonts (Rajdhani, Fira Code) under the SIL Open
Font License 1.1.
