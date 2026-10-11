import { spawn, ChildProcess } from 'child_process'
import { StringDecoder } from 'string_decoder'
import { EventEmitter } from 'events'
import { TmuxParser, TmuxEvent } from './tmux-parser'
import { OutputBatcher } from './output-batcher'
import { runCommand } from '../util/exec-util'
import { parsePaneSnapshot, type PaneSnapshot } from '../../shared/terminal-resync'

export interface TmuxSessionInfo {
  id: string
  name: string
  width: number
  height: number
  created: number
  /** Working directory of the first pane (best-effort, empty string if unavailable) */
  paneCwd: string
}

export interface TmuxManagerEvents {
  output: (paneId: string, data: string) => void
  'sessions-changed': () => void
  'session-changed': (sessionId: string, name: string) => void
  exit: (reason: string) => void
  error: (err: Error) => void
}

/**
 * TmuxManager — Manages a tmux Control Mode connection.
 *
 * Uses `tmux -C` to get structured events from tmux, and sends
 * commands back through stdin. All terminal output is batched
 * at 16ms intervals before being emitted.
 */
/**
 * Bytes per piece when feeding text to a pty, and the pause between pieces.
 *
 * A TUI reading a pty in raw mode cannot drain a large burst fast enough — it
 * keeps whatever is still buffered at the end and silently drops the rest.
 * Measured against a live Claude CLI: of 5714 characters sent in one call,
 * 604 arrived, beginning lost. The identical payload reached a canonical-mode
 * reader intact over the same tmux path, so the loss is the consumer, not the
 * transport. Split into 400-byte pieces 40ms apart, all 5696 characters of the
 * same text arrived.
 */
export const PTY_CHUNK_BYTES = 400
export const PTY_CHUNK_PAUSE_MS = 40

/**
 * Split text into pieces of at most `maxBytes`, never cutting a character.
 *
 * Slicing the string by index would break surrogate pairs; slicing the buffer
 * by byte would break UTF-8 continuation bytes. Both corrupt the payload
 * instead of merely delaying it, so the boundary is walked back to a
 * character edge. A single character larger than the budget is emitted whole
 * rather than mangled.
 */
export function chunkForPty(text: string, maxBytes: number = PTY_CHUNK_BYTES): string[] {
  if (!text) return []
  if (Buffer.byteLength(text, 'utf-8') <= maxBytes) return [text]

  const chunks: string[] = []
  let current = ''
  let currentBytes = 0

  // Iterating the string yields whole code points, so surrogate pairs stay together.
  for (const char of text) {
    const charBytes = Buffer.byteLength(char, 'utf-8')
    if (currentBytes > 0 && currentBytes + charBytes > maxBytes) {
      chunks.push(current)
      current = ''
      currentBytes = 0
    }
    current += char
    currentBytes += charBytes
  }
  if (current) chunks.push(current)
  return chunks
}

export class TmuxManager extends EventEmitter {
  private controlProcess: ChildProcess | null = null
  private parser: TmuxParser
  private batcher: OutputBatcher
  private connected = false
  private pendingCommands: Map<number, {
    resolve: (result: string) => void
    reject: (err: Error) => void
    buffer: string[]
  }> = new Map()
  private outputWatchers: Map<string, { process: ChildProcess; parser: TmuxParser }> = new Map()

  constructor() {
    super()
    this.parser = new TmuxParser()
    this.batcher = new OutputBatcher((paneId, data) => {
      this.emit('output', paneId, data)
    })

    this.parser.onEvent((event: TmuxEvent) => {
      this.handleEvent(event)
    })
  }

  /**
   * Connect to tmux in Control Mode.
   * If socketPath is provided, connects to an existing server.
   */
  async connect(socketPath?: string): Promise<void> {
    if (this.connected) return

    const args = ['-C']
    if (socketPath) {
      args.unshift('-L', socketPath)
    }
    args.push('new-session', '-d', '-s', 'cipher-mux-control', '-x', '200', '-y', '50')

    // Try to attach first, fall back to new session
    try {
      await this.startControlMode(['-C', ...(socketPath ? ['-L', socketPath] : []), 'attach-session', '-t', 'cipher-mux-control'])
    } catch {
      await this.startControlMode(args)
    }
  }

  private startControlMode(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      this.controlProcess = spawn('tmux', args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, TERM: 'xterm-256color' },
      })

      let startupResolved = false
      const decoder = new StringDecoder('utf-8')

      this.controlProcess.stdout?.on('data', (chunk: Buffer) => {
        this.parser.feed(decoder.write(chunk))
        if (!startupResolved) {
          startupResolved = true
          this.connected = true
          resolve()
        }
      })

      this.controlProcess.stderr?.on('data', (chunk: Buffer) => {
        const msg = chunk.toString('utf-8').trim()
        if (!startupResolved) {
          startupResolved = true
          reject(new Error(`tmux control mode failed: ${msg}`))
        } else {
          this.emit('error', new Error(`tmux stderr: ${msg}`))
        }
      })

      this.controlProcess.on('exit', (code) => {
        this.connected = false
        this.controlProcess = null
        if (!startupResolved) {
          startupResolved = true
          reject(new Error(`tmux exited with code ${code}`))
        }
      })

      this.controlProcess.on('error', (err) => {
        this.connected = false
        if (!startupResolved) {
          startupResolved = true
          reject(err)
        } else {
          this.emit('error', err)
        }
      })
    })
  }

  /**
   * Watch a tmux session's output by attaching a read-only control mode client.
   * Output events are emitted with `emitId` (the session ULID) as paneId,
   * so the renderer can match them to the correct terminal.
   */
  watchSession(sessionName: string, emitId: string): void {
    if (this.outputWatchers.has(sessionName)) return

    // NOT `-r` (read-only): verified on tmux 3.7c, a command issued from outside
    // tmux resolves its target client to the best attached one — if that is read-only,
    // tmux rejects the command with "client is read-only". A single read-only
    // watcher therefore breaks `send-keys` for ALL sessions (no Claude launch,
    // no keyboard input). `-f ignore-size` keeps the watcher from dictating the
    // session dimensions, which is the only thing `-r` gave us here.
    const proc = spawn('tmux', ['-C', 'attach-session', '-t', sessionName, '-f', 'ignore-size'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TERM: 'xterm-256color' },
    })

    const sessionParser = new TmuxParser()
    const sessionDecoder = new StringDecoder('utf-8')
    sessionParser.onEvent((event: TmuxEvent) => {
      if (event.type === 'output') {
        // Remap tmux pane ID → session ULID for renderer matching
        this.batcher.push(emitId, event.data)
      }
    })

    proc.stdout?.on('data', (chunk: Buffer) => {
      sessionParser.feed(sessionDecoder.write(chunk))
    })

    proc.stderr?.on('data', (chunk: Buffer) => {
      console.error(`[TmuxManager] watcher stderr (${sessionName}):`, chunk.toString('utf-8').trim())
    })

    proc.on('exit', () => {
      this.outputWatchers.delete(sessionName)
    })

    this.outputWatchers.set(sessionName, { process: proc, parser: sessionParser })
  }

  /**
   * Stop watching a session's output.
   */
  unwatchSession(sessionName: string): void {
    const watcher = this.outputWatchers.get(sessionName)
    if (watcher) {
      watcher.process.kill()
      this.outputWatchers.delete(sessionName)
    }
  }

  disconnect(): void {
    // Kill all output watchers
    for (const [, watcher] of this.outputWatchers) {
      watcher.process.kill()
    }
    this.outputWatchers.clear()

    this.batcher.destroy()
    if (this.controlProcess) {
      this.controlProcess.kill()
      this.controlProcess = null
    }
    this.connected = false
  }

  isConnected(): boolean {
    return this.connected
  }

  /**
   * Send a raw tmux command via control mode stdin.
   */
  private sendRaw(command: string): void {
    if (!this.controlProcess?.stdin?.writable) {
      throw new Error('tmux control mode not connected')
    }
    this.controlProcess.stdin.write(command + '\n')
  }

  /**
   * Execute a tmux command and wait for the response.
   * Returns the command output as a string.
   */
  async command(cmd: string): Promise<string> {
    // For now, simple fire-and-forget commands
    this.sendRaw(cmd)
    // TODO: implement proper begin/end response matching
    return ''
  }

  /**
   * Create a new tmux session (or window in the control session).
   */
  async createSession(name: string, opts?: {
    cwd?: string
    command?: string
    env?: Record<string, string>
    width?: number
    height?: number
  }): Promise<string> {
    const width = opts?.width ?? 80
    const height = opts?.height ?? 24
    const args = ['new-session', '-d', '-s', name, '-x', String(width), '-y', String(height), '-P', '-F', '#{session_id}']
    if (opts?.cwd) {
      args.push('-c', opts.cwd)
    }

    // Ensure 256-color support inside the session
    args.push('-e', 'TERM=xterm-256color')

    // Set env vars via -e flags (tmux 3.2+)
    if (opts?.env) {
      for (const [key, val] of Object.entries(opts.env)) {
        args.push('-e', `${key}=${val}`)
      }
    }

    const result = await runCommand('tmux', args)
    const sessionId = result.trim()

    // Send command via send-keys so the shell stays alive after command exits
    // Wait for shell to be ready before sending
    if (opts?.command) {
      await new Promise((r) => setTimeout(r, 500))
      await runCommand('tmux', ['send-keys', '-t', name, opts.command, 'Enter'])
    }

    return sessionId
  }

  /**
   * Kill a tmux session by name.
   */
  async killSession(name: string): Promise<void> {
    await runCommand('tmux', ['kill-session', '-t', name])
  }

  /**
   * List all tmux sessions.
   */
  async listSessions(): Promise<TmuxSessionInfo[]> {
    try {
      // Use tab separator instead of colon — session names can contain colons.
      // list-panes -a gives us per-pane data including pane_current_path,
      // but we only need one row per session so we deduplicate below.
      const sep = '\t'
      const output = await runCommand('tmux', [
        'list-panes',
        '-a',
        '-F',
        `#{session_id}${sep}#{session_name}${sep}#{session_width}${sep}#{session_height}${sep}#{session_created}${sep}#{pane_current_path}${sep}#{pane_index}`,
      ])
      const seen = new Set<string>()
      const sessions: TmuxSessionInfo[] = []
      for (const line of output.split('\n')) {
        if (!line.trim()) continue
        const parts = line.split(sep)
        if (parts.length < 6) continue // skip malformed lines
        const [id, name, width, height, created, paneCwd] = parts
        if (!name) continue // skip entries with missing session name
        // Take first pane (index 0) per session for dedup
        if (seen.has(name)) continue
        seen.add(name)
        sessions.push({
          id,
          name,
          width: parseInt(width, 10),
          height: parseInt(height, 10),
          created: parseInt(created, 10),
          paneCwd: paneCwd || '',
        })
      }
      console.log(`[TmuxManager] listSessions found ${sessions.length} tmux sessions:`, sessions.map(s => s.name).join(', '))
      return sessions
    } catch (err) {
      console.warn('[TmuxManager] listSessions failed (no tmux server?):', err)
      return []
    }
  }

  /**
   * Send keystrokes to a tmux pane.
   *
   * Uses the existing Control Mode stdin when connected (no fork/exec per
   * keystroke, keeps escape sequences like arrow keys intact as a single
   * atomic write). Encodes bytes as hex for `send-keys -H` so there is no
   * shell quoting and no ambiguity with special characters.
   */
  async sendKeys(target: string, keys: string): Promise<void> {
    if (!keys) return
    // Paced delivery: a TUI on the other end drops a burst it cannot drain.
    // See PTY_CHUNK_BYTES for the measurement this is based on.
    const chunks = chunkForPty(keys)
    for (let i = 0; i < chunks.length; i++) {
      await this.sendLiteral(target, chunks[i])
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, PTY_CHUNK_PAUSE_MS))
      }
    }
  }

  /** Send one piece of literal text, control mode if available. */
  private async sendLiteral(target: string, keys: string): Promise<void> {
    if (this.connected && this.controlProcess?.stdin?.writable) {
      const bytes = Buffer.from(keys, 'utf-8')
      if (bytes.length === 0) return
      const hex = bytes.toString('hex').match(/.{2}/g)!.join(' ')
      // target name is our own ULID-derived `cmux-xxxxxxxx`, safe to inline
      this.sendRaw(`send-keys -H -t ${target} ${hex}`)
      return
    }
    // Fallback when control mode isn't available.
    // '--' ends option parsing: a chunk boundary can leave a piece starting
    // with '-' ("cipher-mux" split after "cipher" yields "-mux"), and tmux
    // would read that as a flag and reject the whole send.
    await runCommand('tmux', ['send-keys', '-l', '-t', target, '--', keys])
  }

  /**
   * Send a named key (Escape, Enter, C-c ...) rather than literal text.
   *
   * sendKeys only ever sends literal bytes, so passing it 'Escape' types the
   * six letters E-s-c-a-p-e into whatever is listening. This is the path for
   * actual keys.
   */
  async sendKey(target: string, keyName: string): Promise<void> {
    if (!keyName) return
    if (this.connected && this.controlProcess?.stdin?.writable) {
      this.sendRaw(`send-keys -t ${target} ${keyName}`)
      return
    }
    await runCommand('tmux', ['send-keys', '-t', target, keyName])
  }

  /**
   * Split a pane in a tmux session.
   */
  async splitPane(target: string, direction: 'horizontal' | 'vertical'): Promise<string> {
    const flag = direction === 'horizontal' ? '-h' : '-v'
    const result = await runCommand('tmux', ['split-window', flag, '-t', target, '-P', '-F', '#{pane_id}'])
    return result.trim()
  }

  /**
   * Resize a tmux pane.
   * Must resize the window first — panes cannot exceed their window dimensions.
   * Without this, detached sessions (no non-ignore-size client) stay at 80x24.
   */
  async resizePane(target: string, cols: number, rows: number): Promise<void> {
    await runCommand('tmux', ['resize-window', '-t', target, '-x', String(cols), '-y', String(rows)])
    await runCommand('tmux', ['resize-pane', '-t', target, '-x', String(cols), '-y', String(rows)])
  }

  /**
   * Capture pane content.
   *
   * **`-J` ist nicht optional.** Ohne das Flag gibt tmux eine umgebrochene Zeile
   * als mehrere physische Zeilen zurueck, mit `\n` dazwischen. Der Aufrufer macht
   * daraus `\r\n`, und im xterm-Puffer stehen dann eigenstaendige Zeilen, die
   * kein spaeterer Reflow wieder zusammenfuegt — der Zerfall ist **dauerhaft**.
   *
   * Gemessen am 2026-10-01 in einem 40 Spalten breiten Pane: eine Zeile mit 95
   * Zeichen kommt ohne `-J` als 40 + 40 + 15 zurueck, mit `-J` als eine mit 95.
   *
   * Die Nebenwirkung ist bekannt und harmlos: `-J` behaelt Leerzeichen am Ende
   * einer zuvor umgebrochenen Zeile, die waechst also um ein bis zwei Zeichen.
   * Im Terminal ist das unsichtbar.
   */
  async capturePane(target: string, lines?: number): Promise<string> {
    const args = ['capture-pane', '-t', target, '-p', '-e', '-J']
    if (lines) {
      args.push('-S', String(-lines))
    }
    return runCommand('tmux', args)
  }

  /**
   * Schnappschuss fuer den Neuaufbau im Renderer: Inhalt **ungekuerzt** plus
   * Cursorposition, in **einem** tmux-Aufruf — dazwischen kann also keine
   * Ausgabe den Cursor verschieben. Flags wie `capturePane` (`-J` siehe dort).
   * Warum Cursor und leere Zeilen zaehlen: `shared/terminal-resync.ts`.
   */
  async snapshotPane(target: string, lines?: number): Promise<PaneSnapshot> {
    const capture = ['capture-pane', '-t', target, '-p', '-e', '-J']
    if (lines) capture.push('-S', String(-lines))
    const raw = await runCommand(
      'tmux',
      ['display-message', '-t', target, '-p', '#{cursor_x} #{cursor_y}', ';', ...capture],
      { trim: false },
    )
    return parsePaneSnapshot(raw)
  }

  /**
   * Get the current command running in a tmux pane.
   * Returns the pane's current command (e.g. 'claude', 'zsh').
   * Returns empty string if the pane/session doesn't exist.
   */
  async getPaneCommand(target: string): Promise<string> {
    try {
      const result = await runCommand('tmux', [
        'display-message', '-t', target, '-p', '#{pane_current_command}',
      ])
      return result.trim()
    } catch {
      return ''
    }
  }

  private handleEvent(event: TmuxEvent): void {
    switch (event.type) {
      case 'output':
        this.batcher.push(event.paneId, event.data)
        break
      case 'begin':
        this.pendingCommands.set(event.number, {
          resolve: () => {},
          reject: () => {},
          buffer: [],
        })
        break
      case 'end': {
        const pending = this.pendingCommands.get(event.number)
        if (pending) {
          pending.resolve(pending.buffer.join('\n'))
          this.pendingCommands.delete(event.number)
        }
        break
      }
      case 'error': {
        const pendingErr = this.pendingCommands.get(event.number)
        if (pendingErr) {
          pendingErr.reject(new Error('tmux command error'))
          this.pendingCommands.delete(event.number)
        }
        break
      }
      case 'sessions-changed':
        this.emit('sessions-changed')
        break
      case 'session-changed':
        this.emit('session-changed', event.sessionId, event.name)
        break
      case 'exit':
        this.connected = false
        this.emit('exit', event.reason)
        break
    }
  }
}
