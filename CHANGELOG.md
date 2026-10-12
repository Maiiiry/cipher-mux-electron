# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.12.9] — 2026-10-12

### Fixed
- **Die Bilanz-Note des Local Workshops war für die Suche unsichtbar.** Die Rolle liest ihre Bilanz
  beim Start über `mux_notes_search`, die Senke schrieb aber am Suchindex vorbei — gefunden in der
  ersten echten Abnahme (Mac, `qwen38-27b-mlx-64k`, zwei Aufträge, beide übernommen). Der Lernkreis
  hatte damit keine Quelle.

## [0.12.8] — 2026-10-12

### Added
- **Rolle Local Workshop** — der Claude-Alltag, Routine geht an den lokalen Worker. Anders als die
  Factory: kein Pflicht-Abnahmetest (`geschuetzteTests` darf leer sein), mehrere Modellprofile
  (`agent.localWorkerProfiles`, `agent.localWorkerDefaultProfile`, pro Dispatch über `profil`;
  `agent.localWorker` gilt weiter als Profil `default`; `modelOptions` gehen unverändert an
  opencode) und ein Urteil pro Häppchen (`accept` mit `ergebnis`, `kategorie`, `notiz`; Status
  `beurteilt`). Die Bilanz steht in `entities/local-workshop/bilanz.jsonl` und als Note „Local
  Workshop: Bilanz". Ein Worker pro Workspace, geteilt mit der Factory.

## [0.12.7] — 2026-10-11

### Fixed
- **Reste alter Texte im Terminal, unten an der Statusleiste** — nach dem App-Start oder einem
  Breitenwechsel blieben Fragmente alter Dialoge und eine doppelte Statuszeile stehen, und der
  Bereich baute sich nicht mehr sauber neu auf. tmux hatte die ganze Zeit den richtigen
  Bildschirm. Der Neuaufbau aus dem tmux-Schnappschuss ließ den Cursor am Textende stehen statt
  dort, wo tmux ihn hat, und verlor die leeren Zeilen am Bildschirmende (`trim()`). Claude Code
  malt relativ zum Cursor und landete deshalb zu tief. Jetzt kommen Inhalt und Cursor in einem
  tmux-Aufruf (`terminal.snapshot`), und `buildRestoreSequence` setzt den Cursor zurück.

## [0.12.6] — 2026-10-11

### Fixed
- **Voice-Relay sollte beim Start `companion_memory_recall` rufen** — ein Werkzeug, das der Server
  ihm seit der Begrenzung auf den Companion nicht gibt. Die Anweisung kam aus dem gemeinsamen
  Baustein `companionMemoryBlock`. Voice-Relay nutzt jetzt `user-profile.json` und Notes.
- Der Test „Companion-Memory nur für den Companion“ prüft jetzt die **gerenderten** Anweisungen
  jeder Rolle statt des Quelltexts — er hatte Dateien mit „companion“ im Namen ausgenommen und
  den gemeinsamen Baustein deshalb nicht gesehen.

## [0.12.5] — 2026-10-11

### Fixed
- **Die Audit-Rolle kannte ihre eigenen Werkzeuge nicht.** Es gab zwei Vorlagen: die gepflegte
  (`audit/`, deutsch — `mux_audit_run_start`/`_complete`, Rückgabe an die Cyber Factory,
  Urteilsregeln, Tag-Achsen) schrieb nur `entities/audit/CLAUDE.md`, die niemand liest; die
  ausgelieferte (`session/`, englisch) schrieb bei jedem Start die `preset.md` und hatte nichts
  davon. Zusammengelegt in `audit/audit-template.ts` auf der englischen Fassung.
- **Refinement und Ideation Partner hatten je zwei Vorlagen**, eine deutsche in `entity-content/`
  (schrieb die `preset.md` beim ersten Start, steckte hinter „Vorlage übernehmen“) und eine
  englische neben dem Sync-Code (ausgeliefert seit der EN-Vereinheitlichung im Mai). Korrekturen
  landeten mal in der einen, mal in der anderen. Jetzt gibt es nur die englische; beide
  Einstiegspunkte zeigen auf sie. Marker `v3`.
- **Maskierte Backticks in drei ausgelieferten Vorlagen** (Refinement, Ideation Partner, Debugger,
  zusammen 88 Stellen im Quelltext): `\`` statt `` ` `` — Codeblöcke, die keine waren. Am 2026-10-01 nur in der
  deutschen Fassung behoben. Ein Test rendert jetzt alle Rollen-Vorlagen und prüft das.
- **Acht Rollen-Vorlagen schickten zu `companion_memory_*`**, das der Server nur dem Companion
  anbietet — meist im Lessons-Learned-Baum, Cyber Factory und Workshop in der Werkzeugliste.
  Jetzt: Notes. Ein Test lässt den Namen nur noch in Companion-Inhalten zu.
- **Companion- und Debugger-Vorlage tragen jetzt den Marker `v3`.** Die Korrekturen aus 0.12.4
  änderten den Inhalt, nicht die Nummer — der Preset-Editor meldete eine alte `preset.md` deshalb
  als „aktuell“.

## [0.12.4] — 2026-10-10

### Fixed
- **Das Wissen des Companion war auf dem Stand von Mai bis Anfang Oktober.** Ein Abgleich gegen den
  Code fand 15 Gruppen falscher Aussagen und 33 fehlende von 68 MCP-Werkzeugen. Korrigiert:
  12 Rollen statt 10 (Local Cyber Factory, Local Worker), Debugger und Workshop schreiben keinen
  Code, Rollengrenzen, opencode ist abgenommen (Grenze und Context-Anzeige über Plugins),
  Anweisungsdatei pro CLI, Ordner-Start mit Workspace/CLI/Fork, was eine Session über ihren
  Workspace erfährt, Tag-Achsen, Handoff mit Anker, Testcase vs. Finding, Bugreport über das
  Gateway, Message Bus veraltet, sechs falsche Parameternamen.
- **Die Werkzeug-Referenz des Companion ist jetzt `docs/mcp-tools.md`**, generiert statt
  abgeschrieben (`npm run gen:companion-ref`). Ein Test hält beide gleich, ein zweiter prüft, dass
  jedes registrierte Werkzeug darin steht.
- **Neun Rollen-Vorlagen nannten Werkzeuge, die es nicht gibt** — vor allem
  `mux_input_request_create` für Rückfragen an den Menschen, also genau in der Eskalationsstufe.
  Ersetzt durch „direkt in der Session fragen“; ein Test lässt nur registrierte Namen zu.
- Gestrichene Companion-Guides (01–03 vom Mai) werden beim Ausrollen entfernt.
- `mux_create_session` startet fest Claude Code und richtet MCP jetzt auch dafür ein.

## [0.12.3] — 2026-10-10

### Changed
- **Sessions im Workspace kennen seine Projekte.** Die Sektion `## Workspace Prompt` nennt den
  Workspace beim Namen, listet die Projekte aus seinen Zellen (Rollenverzeichnisse ausgenommen) und
  verweist auf die Kontextordner — für Ordner-Sessions, Workspace-Zellen **und Rollen**. Rollen
  bekamen bisher nur Prompt und Kontextordner, nicht einmal den Namen.

## [0.12.2] — 2026-10-09

### Fixed
- **Codex- und opencode-Ordner-Sessions bekamen Workspace und Global Rules nicht zu sehen.** Der
  Mux schrieb fest in `CLAUDE.md`. Codex liest nur `AGENTS.md`; opencode liest die `CLAUDE.md` nur,
  wenn keine `AGENTS.md` daneben liegt (gemessen — nicht „zusätzlich“, wie der Adapter behauptete).
  Jeder Adapter nennt jetzt seine Datei (`instructionsTarget`). Für Codex legt der Mux eine
  fehlende `AGENTS.md` an, mit Verweis auf die `CLAUDE.md`, damit opencode sie danach nicht verliert.
- **Eine Ordner-Session wusste nicht, in welchem Workspace sie ist**, solange der Workspace keinen
  Prompt hatte. Die Sektion nennt ihn jetzt beim Namen.
- **Workspace-Zellen richteten MCP für die Standard-CLI ein**, starteten aber fest Claude Code.

## [0.12.1] — 2026-10-09

### Added
- **Ordner-Sessions bekommen ein Feld „Workspace“ und ein Feld „CLI“** im Launcher. Workspace
  steht auf „ohne“, solange man nichts wählt; CLI auf der Standard-CLI. Die Startzeile baut jetzt
  der Main-Prozess über den Adapter — derselbe, der MCP einrichtet. Die CLI einer Ordner-Session
  überlebt einen Neustart (`sessions.json` und Keep-Working-Snapshot tragen `adapterId`).

### Fixed
- **Eine Session ohne Workspace las einen fremden Workspace-Prompt.** Die Sektionen
  `## Workspace Prompt` und `## Context Directories` wurden nur geschrieben, wenn ein Prompt
  mitkam; ohne blieb stehen, was der letzte Workspace-Start hinterlassen hatte. Eine Ordner-Session
  gleicht sie jetzt an ihren Workspace an und entfernt sie ohne. Die Shell aus dem Zellenkopf lässt
  die Datei weiter unangetastet.
- **„Abzweigen“ im Ordner-Start startete keine Session.** Der Renderer hängte `--fork` an, und
  Claude Code bricht mit `unknown option '--fork'` ab. Jetzt `--continue --fork-session`, bei
  Codex `fork --last`, bei opencode `--continue --fork`.
- **Start und MCP-Einrichtung liefen unter zwei CLIs**, wenn die Standard-CLI nicht Claude Code
  war: der Ordner-Start tippte fest `claude`, eingerichtet wurde für die Standard-CLI. Dasselbe beim
  Fork einer Session, deren CLI von der Standard-CLI abwich.

### Security
- **Abhängigkeiten: keine kritische Lücke mehr, das Audit-Gate ist echt.** `npm audit fix` ohne
  `--force` (MCP-SDK 1.29 → 1.32.1, dazu proxy-addr, fast-uri, hono, ip-address und weitere
  transitiv) und electron-builder 25 → 26.15.3 (tar, node-gyp 9 → 12). Produktion 12 → 4 Meldungen,
  alle moderate; gesamt 46 → 14, keine critical. Der CI-Job „Security Audit“ lief bisher mit
  `continue-on-error` und war nur scheinbar grün — jetzt ist er ein Gate. Offen: Electron 34 → 44,
  daran hängen die zwei verbleibenden high.

## [0.12.0] — 2026-10-09

### Added
- **Local Cyber Factory: Claude schneidet zu und prüft, ein lokales Modell codet.** Zwei neue
  Rollen. `local-factory` (Claude Code) zerlegt Arbeit in Häppchen, schreibt pro Häppchen einen
  Abnahmetest und ruft `mux_local_worker_dispatch`. Ein Läufer im Mux — ohne Modell — prüft den
  Auftrag, verlangt einen roten Abnahmetest, committet ihn als Basis, startet eine frische
  `local-worker`-Session (opencode gegen einen OpenAI-kompatiblen lokalen Endpunkt aus
  `agent.localWorker`), wartet auf `REPORT.md` und das Idle-Signal, führt ein Gate aus
  (Testbefehl, Prüfsumme und git-Diff der geschützten Tests) und weckt den Architekten mit einer
  Zeile. Grün wird committet, rot als Patch gesichert und zurückgesetzt. Höchstens zwei Versuche
  pro Häppchen, gezählt in `lauf.json`, danach Eskalation an den Menschen. Der Architekt darf
  keinen Produktionscode schreiben, der Worker keine Abnahmetests — beides als Rollengrenze.
  Echter Lauf gegen `qwen3.8-27b` auf dem DGX Spark: vier Häppchen, alle im ersten Versuch grün.
  Spec: `docs/superpowers/specs/2026-10-09-local-cyber-factory-design.md`.

### Fixed
- **Claude-Code-Rollen wiesen sich beim MCP-Server nie als Rolle aus.** Der Adapter registriert
  `cipher-mux` lokal (`settings.local.json`, `claude mcp add-json -s local`) — ohne
  `X-Mux-Entity`. Der lokale Scope schlägt die `.mcp.json` des Run-Verzeichnisses, die den Kopf
  trägt. Damit war auch „Companion Memory nur für Companion“ für alle Claude-Code-Rollen
  wirkungslos: der Server sah jede von ihnen als „ohne Rolle“.
- **Zeilen per `send-keys` an Claude Code werden jetzt getrennt getippt und abgeschickt.** Text
  plus `\r` in einem Aufruf kommt als eingefügter Block an; das `\r` wird ein Zeilenumbruch im
  Eingabefeld, und die Zeile wird nie abgeschickt.

## [0.11.7] — 2026-10-05

### Fixed
- **Zerfallene Zeichen in allen anderen Terminals, sobald eines neu aufgebaut wurde.** Der
  Atlas-Fix aus 0.11.5 hat das selbst ausgelöst. xterm teilt den Glyphen-Atlas zwischen allen
  Terminals gleicher Schrift, Größe, Theme und DPR. `clearTextureAtlas()` an einem Terminal
  leert diesen gemeinsamen Atlas, setzt aber nur das eigene Render-Modell zurück. Jedes andere
  sichtbare Pane behielt seine Texturkoordinaten und zeigte an ihnen fremde Glyphen, in
  plausiblen Farben und an der richtigen Stelle. Zeilen, die danach neu gezeichnet wurden, waren
  wieder lesbar, älterer Text war Salat. Verworfen wird jetzt nur noch für alle Terminals
  zusammen (`clearAllTextureAtlases` in `terminal-registry.ts`).
- **Die Testsuite konnte die laufenden Mux-Sessions beenden.** `tmux-manager-watch.test.ts`
  isolierte seinen tmux-Server über `TMUX_TMPDIR` und rief am Ende `kill-server` auf. Innerhalb
  eines tmux-Panes ist aber `TMUX` gesetzt, und dann ignoriert tmux `TMUX_TMPDIR`. Lief die Suite
  aus einem Mux-Pane, traf sie den echten Server: Alle Sessions waren weg, und im Mux ließ sich
  nichts mehr eintippen. Der Test entfernt jetzt `TMUX`, prüft vor dem Start den Socket-Pfad und
  beendet nur einen Server, dessen Isolation er nachgewiesen hat.

## [0.11.6] — 2026-10-02

### Added
- **Diktierte Bugreports werden beim Absenden aufgeräumt.** Hineinsprechen, abschicken, fertig —
  ein Modell macht aus dem Diktat Titel, Severity, Tags, Reproduktionsschritte und
  Erwartet/Tatsächlich. **Das Diktat bleibt wörtlich im Report**, unter `## Original`: ein Modell,
  das eine Beobachtung glättet oder eine Vermutung als Tatsache formuliert, darf nicht die
  einzige Quelle sein. Scheitert die Aufbereitung, geht der Report **trotzdem** raus, roh und mit
  sichtbarem Vermerk — ein Bugreport, der an seiner Veredelung scheitert, wäre der schlechteste
  Fall.
- **Jeder Report trägt den Panezustand im Moment der Meldung** — `capture-pane` der aktiven
  Sessions, Pane-Maße, `alternate_on`, `history_size` — und den **Anker-Commit**. Ohne diese
  Gleichzeitigkeit lässt sich „falsch gezeichnet" nicht von „falscher Inhalt" trennen; genau
  daran hing am 2026-10-02 die Diagnose der zerfallenden Zeilen, und dafür musste ein Skript von
  Hand im richtigen Moment gestartet werden. Das nimmt der Report jetzt selbst mit.
- **Der Report landet zusätzlich als Notiz im Mux** (`kind:bugreport`, `status:open`,
  `severity:…`), die die Datei in der outbox **spiegelt** — `mirrors_file` plus `mirror_commit`,
  womit das Notes-System spätere Drift sichtbar macht statt sie zu verschweigen.

### Changed
- **LLM-Aufrufe gehen an das litellm-Tier-Gateway statt an einen eigenen Modellzoo.** Der Mux
  hatte angefangen, Host, Port und Modellnamen selbst zu verwalten; jede Anwendung im Haus, die
  das tut, pflegt dieselbe Tabelle noch einmal und lässt sie einzeln altern. Das Gateway hat sie
  genau einmal und benennt Modelle als **Tiers** — der Mux wählt eine Preis- und
  Qualitätsklasse (`t3`), kein Modell, und ein Modellwechsel am Gateway erreicht ihn ohne
  Codeänderung. Der Schlüssel steht in `~/.cipher-litellm.env`, **nicht** in der Config: eine
  Config wandert in Backups und Logs.

## [0.11.5] — 2026-10-02

One fix, and it corrects the direction this bug had been chased in since April.

### Fixed
- **"The lines fall apart" was the glyph atlas, not the content.** On a cell's first use, the
  Claude Code logo and the 82-character separator lines came out as rows of diamonds. What was
  *right* about that picture is the key: the colours. Pink for the logo, grey for the lines —
  colour comes from the cell attribute, the glyph from the renderer's texture atlas. Only the
  glyph was wrong. `scripts/zerfall-beweis.sh` captured both sides at the same moment, and tmux
  held exactly the right codepoints (`U+2588`, `U+259B`, `U+2590`, `U+259D` for the logo, 82×
  `U+2500` per line). What proves it is the repair: nudging the font size one step **fixes it
  instantly**. Setting `term.options.fontSize` makes xterm re-measure, discard the atlas and
  re-rasterise — without touching the buffer. A corrupt buffer could not be repaired by
  re-rasterising. The fix does that one part directly: `clearTextureAtlas()` once per terminal,
  after `document.fonts.ready` and one frame later.

  **Stated plainly: the cause of the bad atlas was not found.** Seven reproductions failed to
  trigger it — cold font start with a deliberately delayed woff2, an atlas filled with 1400
  glyphs, theme and font-size changes on a live terminal, construction inside a 40×30 container,
  WebGL/Canvas/DOM, Electron 34 as well as Chrome, DPR 1. This addresses the measured symptom,
  not a proven cause. If the garbling returns, the atlas goes stale *later*, and the question is
  then which event does that. There is deliberately **no test reproducing the garbling** — it
  would be invented. The four guards hold the wiring instead, each seen red against its own
  reverted defect.

### Added
- **`scripts/zerfall-beweis.sh`** — captures, in one moment, what tmux holds and what is on
  screen. Without that simultaneity "drawn wrong" cannot be told apart from "wrong content in the
  buffer", and that was exactly the open question.

## [0.11.4] — 2026-10-02

Two terminal fixes plus the documentation and CI work from the night before. The fixes are
renderer and main code, which is why they got their own number: otherwise a build with different
code would sit next to an installed one carrying the same version. The Companion's reference
files are the exception the other way round — `deployCompanionRef` rewrites them at every session
start, so those corrections reached an installed copy without a build.

### Fixed
- **Resizing a cell no longer costs the scrollback.** After pulling a cell to double height and
  back, scrolling up was impossible — the resync wiped the buffer. Three links, each measured:
  a resize changed `rows` and triggered the resync; `capture-pane` without `-S` returns **only
  the visible area** (80×15 pane with 488 lines of history → 15 lines back, starting at "487";
  with `-S -2000` → 503); and `term.reset()` *replaces* the scrollback rather than clearing it
  (`BufferSet.reset()` allocates `new Buffer(...)`, xterm 5.5.0). The `lines` parameter existed
  along the entire path — tmux manager, IPC handler, preload — and the renderer never passed it.
  Now: no resync at all when only the height changed (a rows-only change re-wraps nothing —
  measured at 15 → 30 → 15 columns constant: tmux moves lines between history and the visible
  area and line "472" stays line "472"), and when it does run it carries 1000 lines of history,
  matching xterm's `scrollback` default. Same for the mount restore, which until now put a
  recovered session on screen with no history at all.
- **The resync waits for the resize instead of guessing 200 ms.** `terminal.resize` was an
  `ipcRenderer.send` with no return value, so the renderer could not wait; it slept 200 ms and
  captured. If the IPC had not landed by then, `capture-pane` returned the **old** width,
  written into a terminal at the new one — and no second resync followed, because `lastSizeRef`
  was already updated, so the wrong wrapping stayed until the next resize. Measured: after the
  tmux command returns, `capture-pane` is correct **immediately** (0, 50, 200, 500 ms and 2 s —
  all five identical), so there was no settling time to wait for, only an order to keep. The
  channel is now `invoke`/`handle` and the resync hangs off the promise. The 200 ms remain, with
  a different job: coalescing rapid resizes.
- **The Companion taught two keys that do not exist.** `Cmd+1–5` for grid navigation (the real
  ones are `Cmd+Shift+W/A/S/D`, and they were missing entirely), and `Ctrl+Shift+Space` as a
  voice toggle — it is push-to-talk and returns immediately when voice is off
  (`if (!active) return`). Also `Cmd+Enter` for "input requests", a feature that no longer
  exists, and a settings tab list of six without **Remote**.
- **`docs/HOWTO.md` rewritten against the code.** The README links it as *the* first-run guide,
  and its central chapter was "Start the orchestrator" — a role renamed to Workshop months ago,
  whose leftover directory `ipc-hub.ts` deletes on startup. Also in there: an AppImage for
  Linux (there is none), Aider as an adapter (there is none), three links to a GitHub org that
  does not exist, Node ≥ 18 where the project needs 22, the config in a directory that is not
  read, Ollama on the wrong port, the message bus as the way to talk to a session, an invented
  task state machine, and a four-row shortcut table of which two rows were wrong.
- **`ARCHITECTURE.md` contradicted itself** — ten roles at the top, a table of eleven 150 lines
  later, containing an `Orchestrator` and a `Bugreport` that is a dialog.
- **`docs/linux-notes.md` opened with "cipher-mux runs on Linux as an AppImage."** It does not;
  `electron-builder.yml` has no Linux target. The file is useful as groundwork for a port and
  misleading as an install guide — it now says which it is. `CONTRIBUTING.md` promised the same
  AppImage.
- **`SECURITY.md` listed `0.9.x` as the supported version** and, with the bug-report template,
  pointed reporters at `cipher-mux --version`. There is no such flag; it is a GUI application.
- **Four links to a GitHub org that does not exist** (`cmarkus42` instead of `cmarkus42-rgb`).
- **ADR-008** describes the Orchestrator template. An ADR is a record, so the text stays — but
  it now carries an addendum mapping then to now, including that "template updates require an
  app update" is sharper than it reads: `preset.md` is write-once.
- **cipher-mux.dev:** three more shortcut claims corrected — `Cmd+→/←` for the grid size (no
  such handler), `Ctrl+Shift+Space` as a voice toggle, `Cmd+Enter` for input requests.

### Changed
- **The CI runs on Node 22**, matching `engines.node`, and has a `typecheck` job. The lint job
  checks **the changed files** from the diff instead of running the projectwide `npm run lint`,
  which is red by nature. See the 0.11.3 entry for why that mattered.

## [0.11.3] — 2026-10-01

### Fixed
- **The CI has been red since May, and the badge in the README said so.** Three separate causes, and the first one made the other two invisible. **(1)** The `lint` job ran `npm run lint`, which is projectwide red — 830 problems, 478 errors, and it was that before. A job that cannot go green keeps the badge red for every commit, so no real regression stands out. The documented gate of this project is *no new problems in the changed files*; that is now what the job does, computed from the diff against the previous commit or the PR base. **(2)** The CI ran on **Node 20**, while `engines.node` says `>=22 <23` and `.nvmrc` says 22 — npm evaluates neither. `rebuild:node` failed on the macOS runner at every run. **(3)** The step called `npm run rebuild:node`, whose script appends `2>/dev/null`; the failure was a bare exit 1 without a reason for months. The CI now calls `node-gyp` directly so the log says what happened. A `typecheck` job was added — both configs are green and nobody was watching.
- **A test of mine asserted more than tmux promises.** `capture-pane -J` appends trailing spaces, and the test demanded the never-wrapped line come back character for character identical. True under tmux 3.7c (macOS, Homebrew), false under 3.2a (ubuntu-22.04), where it gets two spaces as well. Found by the Linux runner, not by me. What is actually guaranteed — and all that matters, because a trailing space paints nothing in a terminal — is that the visible content is unchanged and that only spaces are appended. That is what the test checks now. The 0.11.2 entry below carried the overreaching claim and has been corrected.
- **A hidden terminal was a dead terminal.** Focus Mode and the cell merge cover grid slots, and a covered slot returned `null` — the cell unmounted, `useTerminal` disposed, and on the way back there was a `capture-pane` reconstruction without scrollback. The session itself never stopped; tmux held it. Only what the human had seen was gone. A covered **session** cell now renders with `display: none` (`hiddenSlotDisposition` in `shared/grid-types.ts`), which takes it out of the grid flow without tearing it down. Three things were checked rather than assumed: a `fit()` on a zero-size container does not run (the 50 px guard in `useTerminal` sits in front of it), the stable `slot.sessionId` key plus the slot-clearing in `handlePlacementSelect` / `handleDropSession` rule out a duplicate entry when the session is pulled back from the sidebar, and only session cells are kept — a launcher is rebuilt as it was and a notes cell writes to a file.
- **A stale `preset.md` was detected and not repairable.** `preset.md` is written once so hand edits survive, which means a corrected template in the code never reaches an existing file. Two of the four write-once roles were behind — and in opposite directions. The Companion file still routed to `guides/01-first-steps.md` and explained Orchestrator and MPO, while `grid.md`, `entities.md`, `clis.md` and five more sat next to it on disk, written and never linked: the Companion had a guide about the three CLIs and could not find it. The Debugger file was **ahead** of its template, because the morning's tag fix reached the file and not the code — a fresh Debugger would have got the old text back. Template updated, marker bumped, and the preset editor now carries a **Vorlage übernehmen** button: a confirmation, a timestamped backup next to the file, then the write. No automation — write-once stays, the button lifts it visibly and reversibly.
- **Two tag examples the Mux rejects**, in the Companion preset — `**tags:** ["bugreport", "open"]` in the bug and feature format blocks. They sit outside the `## Notes-Tagging` section that the morning's sweep covered. `bugreport` is neither a flat marker nor a class name, so `isKnownTag` says false and `mux_notes_create` aborts: the Companion would have followed its own instructions and received an error. All 16 preset files are now provably free of rejectable tag literals, and a fourth check in `code-writes-axis-tags.test.ts` holds it — the three existing ones look for `class:value` and are blind to a tag without a class.

### Documentation
- **README rewritten in the website's voice** — four pillars with kickers, "What cipher-mux is not" as its own block, the technical part kept because it is the reason anyone opens the file. Four claims in it were wrong: **67** MCP tools instead of 37 or 57, **13** themes instead of 10, opencode missing only `sub-agents` (context display and role boundaries have been built and measured since 0.11.0), and 2,239 tests instead of 2,235. Two things it kept quiet are now stated: the fixed voice commands are **German**, and *persona* and *character* are not the same thing — the count of six belongs to the characters, and "Socratic Tutor" does not exist (Theaitetos does).
- **`docs/mcp-tools.md` completed.** 31 tools were missing entirely (the Hub chain, the ten entity handoffs, testing and audit runs, `mux_entity_start`, `mux_notes_open`, `mux_notes_handoff_dispatch`, `mux_mirror_sync`, `mux_readiness_stats`, `mux_testcase_update`, `mux_ideation_skill_run`, `mux_cyber_factory_diagnose`, `mux_debugger_findings_intake`), and `mux_input_request_create` was documented but no longer exists. The tag documentation said "max 5, lowercase" with an example the Mux rejects today; tags are an axis model, and five is a recommendation, not a limit. Counting from the source undercounts by exactly ten, because the handoffs are generated from one definition — that is now written down where the 57 came from.
- **Six numbers on cipher-mux.dev** corrected against the code: tool count, CVD theme count (the text said four and named three), the settings tabs (six → seven, the Remote tab was missing although it has been permanently visible since v0.9.104, now with its own section in both languages), the test count in two places, the version in thirteen, and a sentence in the English voice docs explaining that the commands are German — they were already listed in German, without explanation, which read like typos.

## [0.11.2] — 2026-10-01

### Fixed
- **`capture-pane` split long lines permanently.** The call ran without `-J`, so a logical line wider than the pane came back as several physical lines; the caller turned those into `\r\n` and the xterm buffer kept them as separate lines, which no later reflow rejoins. Measured in a 40-column pane: 95 characters return as 40 + 40 + 15 without `-J`, as one line of 95 with it. The known side effect is harmless: `-J` appends trailing spaces, and a trailing space paints nothing in a terminal. `test/main/capture-pane-join.test.ts` holds that against real tmux rather than a mock, because the claim is one about tmux. (This entry first claimed that a line which was never wrapped comes back unchanged — true under tmux 3.7c, false under 3.2a. Corrected in 0.11.3.)
- **Eight seconds in which you could not scroll up.** After every mount an interval pulled the viewport to the bottom every 200 ms. Scrolling up was undone within 200 ms. The forced scrolling now **ends** as soon as you scroll up — not pauses: a skipped tick would have caught you again on the next one. Its purpose survives as long as nobody intervenes.
- **The window was allowed to be wider than the screen.** `minWidth` carried the uncapped `gridWidth` and beat the constructor width in Electron, which made the `Math.min` above it pointless — 2956 px at four columns, regardless of the display. Together with `will-resize` → `preventDefault` it could not be corrected by hand either. The grid now scrolls horizontally when it no longer fits; a window that neither fits nor can be touched is worse than a scrollbar.

### Still open, documented
- The other two thirds of the resync finding (a full-screen snapshot written against a cursor-relative live stream, and the unguarded ordering against tmux) need the distinction "TUI in the alternate screen vs. ordinary shell", and that needs a measurement against the running program.
- Focus Mode and cell merge drop hidden slots with `return null`, which kills the terminals of the covered sessions. Changing that to "hidden, not removed" is a UI behaviour change that wants to be seen running first.

## [0.11.1] — 2026-10-01

### Fixed
- **A theme change tore down every terminal and built a new one.** `theme` sat in the dependency array of the effect in `useTerminal.ts`. This did not only hit a manual switch: `useTheme` starts at `DEFAULT_THEME` and applies the stored theme once the config has loaded — so on **every start** the value changes once, and every terminal was rebuilt. Scrollback was lost, the content reconstructed from `capture-pane`, and the guard against overwriting a starting TUI turned against itself. The theme is now held in a ref; the MutationObserver in the same effect already updates a running terminal.
- **The `dimensions` error on startup is an access after dispose**, on the one unguarded getter in xterm 5.5.0 (`RenderService.dimensions`). It is thrown at a terminal that is already dead and cannot draw anything — the mis-drawing happens at its successor, caused by the rebuild above. Error and glitches share the trigger chain, not the effect.
- **Renderer errors now carry file and line.** `window-manager.ts` discarded the `line` and `sourceId` that Electron passes along, which made every `console-message` unattributable.

### Known, documented, not changed
- `docs/superpowers/specs/2026-10-01-terminal-darstellung.md` carries seven findings and five named gaps. Two are worth knowing: the resync after a resize writes a `capture-pane` snapshot against the live stream, and it runs **without `-J`** — an over-long line comes back as two physical lines and stays split. And Focus Mode and cell merge drop hidden slots with `return null`, which kills the terminals of the covered sessions rather than moving them to the background.

## [0.11.0] — 2026-10-01

### Added
- **Model selection per role.** Field **Modell** below **CLI** in the preset editor. `app.entityModels` and its resolution to `--model <id>` already existed — what was missing was a way to set it. The adapter contract gained an optional `listModels()`, because the three CLIs differ: Claude Code has no command for it and knows only the three aliases its `--help` names *as examples*; Codex returns nine models via `codex debug models`; opencode returns whatever its **authenticated** providers offer (eight without a login).
- It is a free-text field **with** suggestions, not a dropdown: none of the lists is complete, and all three CLIs accept a full model name that is not in them. `ENTITY_MODEL_SET` deliberately does not validate against the list.

### Fixed
- **The capability hint promised consequences that do not occur.** Of the seven `AdapterCapabilities` flags, only `status-line` (5 readers) and `mcp-injection` (1) are read anywhere in the code. The other five — `skip-permissions`, `project-instructions`, `message-bus-participant`, `companion-mcp`, `sub-agents` — have **zero** readers; they are statements about the CLI, not switches. The preset editor now names only the two that act.
- `sub-agents: false` means *unmeasured*, not *absent*. Both Tier-2 CLIs have sub-agents — Codex has `SubagentStart`/`SubagentStop` hook events and `codex agents`, opencode has `--agent <name>` and `opencode agent`. What is unmeasured is whether the Mux sees them.
- `isClaudeSession` in `SessionCell` was `status-line === true`. The name claimed a CLI; the condition meant the prerequisite for forking. All three adapters now report that capability and all three can fork. Renamed to `canFork`.

## [0.10.0] — 2026-10-01

### Added
- **Three agent CLIs instead of one.** The `AgentAdapter` contract now carries three production implementations: `claude-code` (Tier 1, still the default), `codex` (Tier 2, measured against codex-cli 0.155.1), `opencode` (Tier 2, measured against opencode 1.18.34). Tier 2 means not every Mux capability has been measured there — the gaps are the `false` entries in each adapter's `getCapabilities()`.
- **CLI selection in the UI.** Field **CLI** per role in the preset editor, **Default CLI** in Settings → General. Both name what is missing under the CLI you pick, before the session starts. Resolution: `app.entityAdapters` > role default > `agent.defaultAdapter`. The per-role choice applies at that role's next session start; the global switch takes effect immediately.
- **MCP binding in the bearer token** (`mcp/bound-token.ts`), format `<apiKey>.<base64url(JSON)>`. Needed because Codex sends no custom HTTP headers — measured. A token without a dot is the bare key and means unbound, so existing clients are unaffected. The suffix is deliberately unsigned; the reasoning is in the file header.
- **Codex directory trust** (`agent/adapters/codex-trust.ts`). Codex loads project-local config, hooks and exec policies only from a trusted directory and otherwise blocks on a dialog. Only an entry in the global `~/.codex/config.toml` helps, and the adapter writes it exclusively for paths under `~/.config/cipher-mux/runs/`. Switchable off via `agent.codexTrustRunDirs`.
- **Context usage for Codex sessions** via `monitoring/codex-usage-hook.ts` — derives the JSON the existing `StatusLineMonitor` already reads from the rollout JSONL, rather than adding a second reader.

### Changed
- **The adapter is now resolved per role everywhere** — at launch, at fork, and per entry during the Keep-Working restore. It previously diverged across three call sites, so a role on Codex under a global default of `claude-code` launched `codex` and was then handed Claude Code's config files. Latent with one adapter, a bug with three.
- **Role boundaries** run through `PreToolUse` hooks for Claude Code and Codex, and through a plugin on `tool.execute.before` for opencode. All three were proven to deny selectively against the live CLI. Two findings came out of it: opencode's documented `permission.ask` hook **never fires** — a boundary built on it would have been written and dead — and Codex carries no `file_path` in its tool input, so its boundary parses the `apply_patch` envelope instead (`adapters/codex-boundary.ts`).

### Documentation
- README, ARCHITECTURE and CONTRIBUTING rewritten for three adapters: capability matrix per adapter, the two structural divergences (MCP binding, role boundaries), the per-role CLI selection, and the measurement discipline for new adapters.
- **Config location documented, with the trap named:** settings live in `~/Library/Application Support/cipher-mux-electron/cipher-mux-config.json`. The identically named `~/.config/cipher-mux/config.json` exists and is **not** read — editing it changes nothing.
- `docs/website-update-2026-10-01.md` — proposed text for the eleven places on cipher-mux.dev that the three adapters made wrong or incomplete. A proposal, not a deployment.

### Known gaps
- **The shell gap is open in all three.** `Bash` carries no path, so a file can still be changed through the shell. Closing it would mean parsing shell syntax, and a half-hearted parser is another boundary that only looks like one. The boundary is a guardrail against mistakes, not a sandbox.
- `sub-agents` is `false` for both Tier-2 adapters. That means *unmeasured*, not *impossible*.
- **opencode needs an authenticated provider.** Without one it reaches its prompt and then does nothing on any input. No flag removes this — it is a precondition, not a dialog.
- The **CLI** field in the preset editor is built, typechecked and unit-tested, but has not been visually accepted.

## [0.9.104] — 2026-05-17

### Fixed
- **BT Remote Tab:** Always visible in Settings — removed stale config gate that kept the tab hidden
- **BT Remote Clipboard:** Cmd+C/V/X/A routed through native webContents API instead of synthetic keyboard events (fixes clipboard in terminal)
- **BT Remote Passthrough:** Devices without profiles now pass keystrokes through natively instead of suppressing them as "unmapped"

## [0.9.103] — 2026-05-15

### Added
- **Hub-First Setup:** New users are prompted to choose a Hub directory on first launch — the organizational home for all cipher-mux projects. Folder picker defaults to `hubPath/projects/`.
- **Model Routing Pipeline:** `mux_create_session` accepts `model` parameter (haiku/sonnet/opus). SubProjekt.model is read at session spawn and passed as `--model` CLI flag to Claude Code.

### Removed
- **ProjectScanner:** The legacy project scanning system (`scanPaths`, `scanDepth`, `defaultProjectDir`, `ProjectCard`, `useProjects` hook) has been completely removed. Projects are now selected via folder picker, not automatic directory scanning.

### Fixed
- **HubSetupDialog default path:** Dialog pre-fills with resolved home path (`~/cipher-mux/`) instead of showing it only as placeholder.
- **README broken link:** `ref/mcp-tools.md` → `docs/mcp-tools.md`.
- **Security:** `.mcp.json` and `*-mcp-connection.md` added to `.gitignore` to prevent token leaks.

## [0.9.102] — 2026-05-13

### Changed
- Development cruft removed from repository

## [0.9.101] — 2026-05-12

### Added
- **Detachable Windows:** Pop-out sessions and notes as standalone desktop windows
- **Focus Mode 2x2:** Focused cell fills grid, Notes Focus, WASD navigation skips notes
- **Voice Relay Architecture:** Hot-swap voices without restart, sentence pipelining with pause injection, amplitude-based barge-in detector
- **Voice Catalog:** Multi-voice support with catalog browser and download UI
- **Bugreport Triage Mode:** Entity-routing for Workshop with Debugger/Ideation/CF dispatch
- **Tag Management v2:** Class-grouped UI, merge flow, synonym system, class CRUD
- **Theme Editor Expansion:** Session token group (--session-bg, --session-text, --session-border, --session-font-size), terminal colors
- **TTS Verbosity:** Two-level system with focus gate and speech interrupt
- **Global Notes:** Cross-workspace visibility option
- **Testcase Collaboration:** Resolution status for failed testcases, testing-assistant preset rules
- **Enhanced Preset Display:** Preset info rendered in workspace editor grid cells
- **Workspace Editor Icons:** Lucide icons replace unicode in session headers
- **i18n Foundation:** i18next + react-i18next with EN/DE locales, language switcher in Settings
- **Notes MCP Full CRUD:** `mux_notes_read`, `mux_notes_update`, `mux_notes_search`, `mux_notes_delete`, `mux_notes_handoff_create`, `mux_notes_handoff_search`
- **Session Resume:** `--resume` flag support for entity sessions, manual sessions get checkbox
- **Session Fork:** Fork button in SessionCell for Claude Code sessions
- **Orphan Detection:** Periodic scan for orphaned tmux sessions with Adopt/Terminate UI
- **Workspace-Scoped Notes:** Notes auto-tagged with `workspace:<name>`, sidebar filter toggle (show all / workspace only)
- **Workspace-Scoped Memory:** `companion_memory_write` auto-scopes to workspace, recall/search merge user + active workspace memories
- **Workspace Context Injection:** Workspace prompt + context directories injected into all entity sessions
- **Persona Resolver:** Per-preset persona dropdown with resolution hierarchy (global active > preset override > matrix default > fallback)

### Changed
- Persona section text generalized (removed hardcoded Mimir references)
- Companion preset is persona-neutral (Relay/Mimir identity references removed)
- Workspace tags use human-readable workspace name instead of internal ID
- Orchestrator entity renamed to Workshop
- Architecture docs updated to v0.9.995
- Entity dispatch conditionals replaced with map pattern in app.tsx
- `getActiveWorkspace` extracted as helper

### Fixed
- **Security:** Timing attack fix in auth path, path traversal protection, body size limits enforced
- **Audit v0.9.996:** 3 HIGH + 2 MEDIUM findings resolved
- Grid overflow, screenshot clipboard, workspace labels, STT filter
- Notes editor state loss on move, keep-working restore
- Companion info popup synced with current feature state
- Terminal CSS vars read from body (not documentElement)
- Strict tag validation in `mux_notes_create`
- Entity session tracking for orphan detection (`autoLaunchedSessions`)
- Stale orchestrator preset remnant removed from preset list
- `mux_create_session` auto-launches Claude CLI, `mux_send` splits paste+Enter
- Sidebar dock-button, theme-name nav, focus-mode font, OS shortcuts
- GitHub delivery opens browser after gh CLI
- STT restore after bugreport voice, STT detach routing
- Voice preview audio format, clipboard paste/copy
- Gapless TTS, symlinks, STT hallucination filter
- Tag-delete handler rebuild, per-class tag creation
- Detach-restore consistency, STT in detached windows
- i18n: translate hardcoded English strings in Workspace Editor to German
- Scanlines removed from cipher-ivory theme
- Save error-handling in DetachedNoteView + mcp-auth unit tests
- `cachedRecoveryResult` moved out of keepWorking path, delay to prevent race

### Removed
- InputRequest system removed (replaced by entity-native flows)
- Models tab removed from Settings
- Legacy Sokrates character replaced with Theaitetos

## [0.9.100] — 2026-05-08

### Bugfix Welle 1 (16 Bugs)
- **Preset Editor Source Split:** CLAUDE.md editor split into structured 4-tab view with live preview
- **Sidebar Notes double-click:** Opens note in grid cell instead of toggling sidebar
- **Grid drag ghost image:** Eliminated stale drag preview on fast moves
- **Workspace apply race:** Grid resize completes before session spawning begins
- **Entity stop cleanup:** Session removal from grid slots on entity stop
- **Preset dropdown z-index:** Renders above grid cells in workspace editor
- **Notes frontmatter merge:** Custom fields preserved on save (regression from RT-1)
- **Theme editor save-as:** Clone flow copies all tokens correctly
- **Voice command fuzzy match:** Reduced false positives for grid-nav commands
- **TTS queue priority:** Interrupt priority correctly preempts queued speech
- **Context bar color thresholds:** Yellow at 60%, red at 80% (was 50/70)
- **Sidebar activity LED:** Blinks on new messages, solid when panel open
- **Workspace prompt injection:** Handles missing projectPath gracefully
- **Cell inspector preset sync:** Dropdown reflects current cell assignment after apply
- **MCP session GC timing:** Inactivity timer resets on tool calls (not just HTTP)
- **StatusLine parser edge case:** Handles missing `context_window` field without crash

### Bugfix Welle 2 — Pre-existing Test Fixes
- Fixed 12 test regressions from Cyber Factory Wave 5 feature-flag cutover
- Stabilized flaky timing-dependent tests (voice pipeline, session recovery)
- Test count: 858 (0 failures)

### Bugfix Welle 3 — Preset-Lektorat
- **EN Homogenization:** All 8 preset CLAUDE.md templates rewritten in consistent English
- Removed mixed DE/EN fragments from entity templates
- Unified terminology across presets (e.g. "findings" not "Befunde", "handoff" not "Uebergabe")

### Feature Welle F1
- **Cipher Adult Voice Bundle:** New TTS voice profile with lower pitch and natural pacing
- **Update Checker:** Automatic check for new releases on startup (configurable, opt-out in Settings)

### Feature Welle F2
- **Tag Management:** Merge tags, exclusive tag groups, tag cycle (rotate through group)
- **Notes File Watching:** External file changes detected and reloaded in editor

### Feature Welle F3
- **Focus Mode Full-Screen:** Focused cell expands to fill entire grid, dimming others
- **Note Editor Font Size:** Configurable font size for CodeMirror editor (10-32px)
- **Preset Sort:** Presets sortable by name, category, or usage frequency in picker

### Feature Welle F4
- **Workspace Notes Cells:** Notes can be assigned to workspace grid cells (alongside sessions and presets)
- **Sorting:** Configurable sort order for sessions, notes, and presets in sidebar
- **Onboarding:** First-launch onboarding flow with interactive setup wizard walkthrough

### Feature Welle F5
- **Session Screenshots:** Capture terminal screenshots (PNG) via Cmd+Shift+S or MCP tool
- **Persona Avatars:** Custom avatar images for personas, displayed in session headers and sidebar
- **Legacy Archive:** Automated archival of sessions older than configurable threshold (default 30 days)

## [0.9.10] — 2026-05-02

### Fixed
- **Keep Working Restore: 3-Layer Bug (critical).** Grid showed correct dimensions after restart but empty cells. Three independent bug layers masking each other:
  - **Layer 1 (v0.9.9):** Race condition `useGrid` mount vs. `applyKeepWorkingRestore` — `restoreCalledRef` guard
  - **Layer 2:** Stale session IDs in `ui.grid` config + one-time pull got `null` because init chain wasn't ready — synchronous startup clear + poll with retry (500ms/10s)
  - **Layer 3 (Root Crash):** `tmux list-panes -a` occasionally returned malformed lines — `tmuxSession.name` was `undefined` — `TypeError` in `recover()` silently crashed the entire init chain. Only error diagnostics in `.catch()` made the crash visible.
  - Defensive fixes: malformed-line filter in `listSessions()`, undefined guard in `recover()`, error logging to `/tmp/kw-debug.json`

## [0.9.9] — 2026-05-02 (Open Beta)

### Highlights
v0.9.9 is the "more-is-more" milestone — the last iteration before the Cyber Factory pipeline. cipher-mux is now a fully functional multi-session cockpit for Claude Code with voice control, entity presets, workspace management, and multi-instance support.

### Added
- **Multi-Instance Presets:** Entity presets can now run multiple simultaneous sessions. Companion, Refinement, Voice, Audit, and custom presets are multi-instance by default. Orchestrator, MPO, and Launcher remain singletons (`singleInstance: true`). Each new instance gets a unique tmux session name and numbered display name (e.g. "Coding Companion #2").
- **Universal Persona Injection (E.1):** Active companion persona injected into ALL entity CLAUDE.md at session start.
- **Dynamic Entity Scanner (E.3):** Scans `~/.config/cipher-mux/entities/` for CLAUDE.md dirs, registers them as launchable presets. Replaces hardcoded `ENTITY_PRESETS`.
- **New Entities: Watchdog + Project Launcher:** Watchdog (adversarial testing) and Project Launcher (autonomous sub-project worker).
- **`mux_tts_speak` MCP Tool (F.2):** Entity-driven TTS — any entity session can speak text aloud via MCP.
- **STT Pin-to-Session (F.3):** Pin voice dictation to a specific session via StatusBar toggle.
- **Context Usage Color Bar (G.4):** Color-coded progress bar in session header (green/yellow/red).
- **Settings Tabs (G.1):** Info/Settings restructured into 5 tabs: General, Appearance, Shortcuts, Voice, About.
- **Tag-based Notes Scoping (P.1):** Flat storage with tag-based categorization replacing scope directories.
- **Notes Migration (P.3):** Automatic migration from scope-directory layout to flat storage.
- **Workspace Default Tags (P.2, P.5):** `defaultTags` in workspace config, auto-applied to new notes.
- **Hierarchical Tag Tree (C.1):** Sidebar Notes shows collapsible tag tree with tri-state filter.
- **Testcase Parser + View (D.1):** Markdown checkbox testcases with `noteType: 'testcase'`. TestcaseView UI with screenshot integration.
- **STT Dictation in Notes Editor (C.4):** Voice dictation directly into CodeMirror Notes Editor.
- **Theme Editor Preview (G.8):** Preview/revert button for theme changes.
- **Shortcuts Listing (G.3):** Complete keyboard shortcuts listing with i18n.
- **Sidebar Window Close/Dock (G.5):** X closes, dock button reintegrates.
- **Human-readable tmux session names:** `cmux-orchestrator-a1b2` instead of `cmux-q3r8x7m1`.
- **Voice & TTS:** Global TTS playback, conversation engine voice commands, BT Shutter integration.
- **Drag-and-Drop Sidebar-to-Grid:** Sessions + notes draggable from sidebar to grid cells.
- **Background Session Cards:** Rich cards with session name, project path, context/token bar, last 3 lines of output.

### Changed
- **EntityConfig `singleInstance` flag:** New optional boolean. When `true`, only one session per entity allowed.
- **Entity CLAUDE.md Template Rewrite (E.4):** All templates follow unified format: Role, Persona, Memory, Capabilities, Working Rules, Scope, TTS instruction.
- **Border-Glow Highlight Redesign (B.7):** `mux_ui_highlight` uses border-glow (box-shadow) instead of outline.
- **`mux_ui_open` Toggle/Close (B.8):** Supports `action: 'open'|'close'|'toggle'` and `tab` context parameter.
- **Settings renamed from Info (G.2):** "Info" -> "Settings" throughout UI.
- **`mux_send` plaintext delivery (H.5, H.6):** Push delivery sends plaintext instead of base64.

### Fixed
- **MCP HTTP Timeout (A.4):** Disabled server timeouts preventing MCP connection drops.
- **Drag-and-Drop Race (A.1):** Eliminated stale-closure race in SessionGrid.
- **Stale Grid Slots (A.2):** Reactive cleanup when sessions die.
- **Orphaned Entity Session IDs (A.3):** Clear mappings when sessions terminate.
- **Grid Placement Duplicate (A.5):** Remove from old slot before placing.
- **TestcaseView Rendering (D.1):** Parser moved to main process via IPC.
- **Ghost Session Recovery:** Sessions removed from sessions.json on stop. Grid slots scrubbed.
- **Notes Frontmatter Merge (RT-1):** save() preserves custom frontmatter fields.
- **Grid-Place Double Display (RT-10):** removeSession() called before setSessionAtSlot().
- **Theme-Editor Built-in Immutable (RT-W2):** Built-in themes are read-only.
- Various voice, sidebar, workspace, preset editor, and grid fixes.

## [0.9.5-beta] — 2026-04-24

### Added
- **Unified Sidebar Panel:** replaces Chatroom + Input Requests with a single auto-visible panel
- **SIDEBAR button with activity LED** in StatusBar
- **Background Session Cards:** rich cards with context/token bar — click to place in grid
- **Grid Placement Popup:** visual grid popup to pick which slot to replace when grid is full
- **Detachable Sidebar:** sidebar can be detached as standalone resizable window
- **Cell split (unmerge) handle:** orange handle on fully-merged cells
- **Skip-permissions toggle:** `--dangerously-skip-permissions` toggle in Settings with warning

### Changed
- Sidebar is purely passive (no chat input field)
- Worker built-in persona removed

### Fixed
- `mux_send` push delivery, `mux_create_session` visible placement
- Terminal width with sidebar, detach persistence, workspace apply end-to-end

## [0.8.9-beta] — 2026-04-24

### Added
- **Workspaces & Personas system:** grid-based workspace editor with cell inspector, 3-level prompt resolution
- **Separate Workspaces/Personas window:** dedicated 960x720 editor window
- **Workspace apply:** resize grid, apply merges, spawn sessions for assigned projects
- **Persona skill sync:** auto-generates `.claude/skills/personas/` skills from persona prompts
- **Shell session button:** `$` button spawns plain zsh shell in same project directory
- **Visible sessions (MCP):** `mux_create_session` with `visible: true`
- **Message push delivery:** `mux_send` with `sessionName` injects directly into target tmux pane
- README, CONTRIBUTING, ARCHITECTURE, CHANGELOG documentation
- GitHub issue/PR templates, GitHub Actions CI, Linux AppImage build support

### Changed
- Grid dimension limits enforced: max 7 columns x 3 rows
- Merge handles always visible (25% opacity) and clickable

### Fixed
- Theme button opens correct settings tab
- Input fields in workspace editor no longer overflow
- Tab bar padded for macOS window controls

## [0.8.8-beta] — 2026-04-23

### Added
- Theme system: 10 themes with CSS custom properties and ANSI terminal colors
- Theme picker with live preview swatches
- MCP session GC (30min inactivity)
- StatusLine 2.x parser for Claude Code context_window format
- Terminal resize debounce (150ms) with min-size guard

### Fixed
- Session recovery reliability
- skip-permissions config via ConfigStore
- Context usage display for Claude Code 2.x format

## [0.8.3-beta] — 2026-04-22

### Fixed
- Grid: fixed 380px cell height with programmatic window resize
- StatusLine: migrate hooks.StatusLine to top-level setting
- Grid: resize BrowserWindow height when rows change

## [0.8.2-beta] — 2026-04-20

### Added
- Input Requests sidebar panel with file watcher and IPC bridge
- StatusLine hook injection for per-session context usage monitoring
- Keyboard shortcuts wiring and UTF-8 chunk boundary handling

### Fixed
- Window not showing and terminal width issues
- Voice echo cancellation with dual-phase guard and barge-in suppression
- Test determinism for statusline-monitor

### Changed
- Extract terminal theme to shared module with contrast improvements

## [0.8.1-beta] — 2026-04-19

### Added
- VAD-based voice pipeline: always-listen conversation mode with Silero VAD, Whisper STT, Piper TTS
- Project launcher integration into project popup dialog
- Task infrastructure: SQLite state machine, TaskWatcher, TaskHooks, BugreportTaskSource
- 4 MCP tools for task management
- Orchestrator template with task management instructions

### Fixed
- WCAG AA contrast for Ivory theme and terminal ANSI colors
- Keep tmux sessions alive on app quit
- Voice: piper model path, asar-unpack for DMG builds
- Terminal: decode multi-byte UTF-8 from tmux octal escapes

### Security
- Voice module: security and code quality audit

## [0.8.0-beta] — 2026-04-17

### Added
- Bugreport system with Ollama enrichment and preview flow
- Git-based version generation at build time
- Session grid layout with configurable columns/rows
- Ivory (light) and dark theme with CSS custom properties
- ProjectPopup modal, redesigned StatusBar

### Fixed
- Deep merge saved config with defaults to prevent data loss
- Strip Electron zoom accelerators so Cmd shortcuts reach renderer

## [0.7.0-beta] — 2026-04-16

### Added
- Shortcut registry (Cmd+0, Cmd+K, Cmd+N)
- Split-view terminal system with keyboard shortcuts
- Type-aware session recovery with orphan dialog
- InfoSettingsView (shortcuts, features, settings tabs)
- Outbox-based bugreport system with diagnostics collection

### Fixed
- Terminal session switching and orphan cleanup

## [0.6.0-beta] — 2026-04-14

### Added
- Orchestrator autostart and session UX
- Kickoff dialog with SDD skills integration
- KickoffOrchestrator with MCP and marker-file completion
- StatusLineMonitor for context usage tracking
- MCP Server with Streamable HTTP transport and bearer auth
- Chatroom panel with unread badges

## [0.5.0-beta] — 2026-04-13

### Added
- Initial project scaffold
- Core modules: TmuxManager, MessageBus, SessionManager, ProjectScanner
- UI components: Cockpit, Terminal Panes, Activity Rail
- IPC Hub with typed channels
- ConfigStore with JSON persistence
