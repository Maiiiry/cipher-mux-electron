/**
 * PiperTTS — Piper text-to-speech via sherpa-onnx-node child process.
 *
 * The actual inference runs in piper-worker.js, forked under a system Node.js
 * binary (not Electron's embedded Node) because sherpa-onnx-node requires
 * a real Node.js runtime with native addon support.
 */

import path from 'node:path'
import fs from 'node:fs'
import { fork, type ChildProcess, execFileSync } from 'node:child_process'
import { TTSEngine } from './tts-engine'
import { pcmToWav } from './audio-utils'
import { configStore } from '../config/config-store'
import {
  loadRespellings, applyRespellings, invalidateRespellings, loadNormalizeFlag, normalizeForPiper,
  type RespellingMap,
} from './respellings'

const DEFAULT_VOICE = 'de_DE-cipher_reachy3-medium'

function getConfiguredVoice(): string {
  try {
    return configStore.get('piperVoice') ?? DEFAULT_VOICE
  } catch {
    return DEFAULT_VOICE
  }
}

/** Well-known locations for system Node.js on macOS */
const NODE_SEARCH_PATHS = [
  '/opt/homebrew/bin/node',
  '/usr/local/bin/node',
  '/usr/bin/node',
]

/**
 * Find a system Node.js binary (not Electron's).
 * Searches common paths, NVM, Volta, then falls back to `which node`.
 */
export function findSystemNode(): string | null {
  // Check well-known paths
  for (const p of NODE_SEARCH_PATHS) {
    if (fs.existsSync(p)) return p
  }

  // Check NVM
  const nvmDir = process.env.NVM_DIR ?? path.join(process.env.HOME ?? '', '.nvm')
  if (fs.existsSync(nvmDir)) {
    const defaultAlias = path.join(nvmDir, 'alias', 'default')
    if (fs.existsSync(defaultAlias)) {
      try {
        const version = fs.readFileSync(defaultAlias, 'utf-8').trim()
        // Version could be alias like 'lts/*' or exact like 'v20.11.0'
        // Try exact version first
        const nvmNode = path.join(nvmDir, 'versions', 'node', version, 'bin', 'node')
        if (fs.existsSync(nvmNode)) return nvmNode
      } catch {
        // ignore
      }
    }
    // Try current NVM_BIN
    const nvmBin = process.env.NVM_BIN
    if (nvmBin) {
      const nvmNode = path.join(nvmBin, 'node')
      if (fs.existsSync(nvmNode)) return nvmNode
    }
  }

  // Check Volta
  const voltaHome = process.env.VOLTA_HOME ?? path.join(process.env.HOME ?? '', '.volta')
  const voltaNode = path.join(voltaHome, 'bin', 'node')
  if (fs.existsSync(voltaNode)) return voltaNode

  // Fallback: which node
  try {
    const result = execFileSync('which', ['node'], {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim()
    if (result && fs.existsSync(result)) return result
  } catch {
    // not found
  }

  return null
}

export interface PiperTTSConfig {
  voice?: string
  modelsDir?: string
  numThreads?: number
  nodeModulesPath?: string
}

interface WorkerMessage {
  type: 'ready' | 'audio' | 'error' | 'log'
  id?: string
  sampleRate?: number
  samples?: string // base64 Float32LE
  message?: string
  level?: string
}

export class PiperTTS extends TTSEngine {
  private readonly voice: string
  private readonly modelsDir: string
  private readonly numThreads: number
  private readonly nodeModulesPath?: string
  private worker: ChildProcess | null = null
  private ready = false
  private _interrupted = false
  private respellings: RespellingMap | null = null
  private normalizePunct = false
  private pendingMessages = new Map<string, {
    resolve: (msg: WorkerMessage) => void
    reject: (err: Error) => void
  }>()

  constructor(config?: PiperTTSConfig) {
    super(config as Record<string, unknown>)
    this.voice = config?.voice ?? getConfiguredVoice()
    this.modelsDir = config?.modelsDir ?? path.join(
      process.env.HOME ?? '',
      'Library', 'Application Support', 'cipher-mux-electron', 'models', 'piper'
    )
    this.numThreads = config?.numThreads ?? 2
    this.nodeModulesPath = config?.nodeModulesPath
  }

  async init(): Promise<void> {
    if (this.ready) return

    // 1. Find system Node.js
    const nodePath = findSystemNode()
    if (!nodePath) {
      throw new Error(
        'System Node.js not found. Install Node.js via Homebrew, NVM, or Volta.'
      )
    }

    // 2. Check model directory
    const modelDir = path.join(this.modelsDir, `vits-piper-${this.voice}`)
    if (!fs.existsSync(modelDir)) {
      throw new Error(
        `Piper model directory not found: ${modelDir}\n` +
        `Download the model and place it in ${this.modelsDir}/`
      )
    }

    // Load per-voice pronunciation respellings (optional; absent → no-op).
    this.respellings = loadRespellings(modelDir, this.voice)
    // Voices trained on normalized punctuation opt in via normalize-punct.flag.
    this.normalizePunct = loadNormalizeFlag(modelDir, this.voice)

    // 3. Fork the worker under system Node.js
    let workerPath = path.join(__dirname, 'piper-worker.js')
    let nodeModulesPath = this.nodeModulesPath
      ?? path.join(__dirname, '..', '..', '..', '..', 'node_modules')

    // In packaged Electron apps, files are inside app.asar — system Node.js can't read them.
    // electron-builder asarUnpack puts them in app.asar.unpacked instead.
    if (workerPath.includes('app.asar')) {
      workerPath = workerPath.replace('app.asar', 'app.asar.unpacked')
      nodeModulesPath = nodeModulesPath.replace('app.asar', 'app.asar.unpacked')
    }

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
    }

    // Set DYLD_LIBRARY_PATH so sherpa-onnx native libs can be found
    const sherpaLibDir = path.join(nodeModulesPath,
      `sherpa-onnx-${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`)
    env.DYLD_LIBRARY_PATH = [sherpaLibDir, env.DYLD_LIBRARY_PATH].filter(Boolean).join(':')
    env.NODE_PATH = [nodeModulesPath, env.NODE_PATH].filter(Boolean).join(':')

    this.worker = fork(workerPath, [], {
      execPath: nodePath,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      env,
      silent: true,
    })

    // Pipe worker stdout/stderr to console for debugging
    this.worker.stdout?.on('data', (data: Buffer) => {
      console.log(`[piper-worker stdout] ${data.toString().trim()}`)
    })
    this.worker.stderr?.on('data', (data: Buffer) => {
      console.error(`[piper-worker stderr] ${data.toString().trim()}`)
    })

    this.worker.on('error', (err) => {
      console.error('[PiperTTS] Worker error:', err.message)
      this.ready = false
    })

    this.worker.on('exit', (code) => {
      console.log(`[PiperTTS] Worker exited with code ${code}`)
      this.ready = false
      // Reject any pending promises
      for (const [, pending] of this.pendingMessages) {
        pending.reject(new Error(`Worker exited with code ${code}`))
      }
      this.pendingMessages.clear()
    })

    // Set up message handler
    this.worker.on('message', (msg: WorkerMessage) => {
      if (msg.type === 'log') {
        const level = msg.level ?? 'info'
        const logFn = level === 'error' ? console.error : console.log
        logFn(`[piper-worker] ${msg.message}`)
        return
      }

      if (msg.type === 'error') {
        const pending = msg.id ? this.pendingMessages.get(msg.id) : undefined
        if (pending) {
          this.pendingMessages.delete(msg.id!)
          pending.reject(new Error(msg.message ?? 'Unknown worker error'))
        } else {
          console.error(`[PiperTTS] Worker error: ${msg.message}`)
        }
        return
      }

      if (msg.id) {
        const pending = this.pendingMessages.get(msg.id)
        if (pending) {
          this.pendingMessages.delete(msg.id)
          pending.resolve(msg)
        }
      }
    })

    // 4. Send init command
    this.worker.send({ cmd: 'init', modelDir, numThreads: this.numThreads })

    // 5. Wait for ready (10s timeout)
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Piper worker init timed out after 30s'))
      }, 30_000)

      const onMessage = (msg: WorkerMessage) => {
        if (msg.type === 'ready') {
          clearTimeout(timeout)
          this.worker?.removeListener('message', onMessage)
          resolve()
        } else if (msg.type === 'error') {
          clearTimeout(timeout)
          this.worker?.removeListener('message', onMessage)
          reject(new Error(msg.message ?? 'Piper worker init failed'))
        }
      }
      this.worker!.on('message', onMessage)
    })

    this.ready = true
  }

  /**
   * Text prep before phonemization: punctuation normalization (only for voices
   * with normalize-punct.flag), then per-voice respellings. Order matters.
   */
  prepareText(text: string): string {
    if (this.normalizePunct) text = normalizeForPiper(text)
    return applyRespellings(text, this.respellings)
  }

  async *speak(text: string): AsyncGenerator<Buffer> {
    if (!this.ready || !this.worker) {
      throw new Error('PiperTTS not initialized — call init() first')
    }

    this._interrupted = false

    // Apply per-voice pronunciation respellings before phonemization (no-op if none).
    text = this.prepareText(text)

    // Split text into sentences
    const sentences = text.match(/[^.!?]+[.!?]*\s*/g)
    if (!sentences || sentences.length === 0) {
      return
    }

    const trimmed = sentences.map(s => s.trim()).filter(s => s.length > 0)
    if (trimmed.length === 0) return

    // Fire ALL synthesis requests to the worker immediately.
    // The worker processes them sequentially, but we eliminate any
    // inter-sentence overhead by having the next request already queued.
    const promises: Promise<WorkerMessage>[] = trimmed.map(sentence => {
      const id = `tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      this.worker!.send({ cmd: 'generate', text: sentence, sid: 0, speed: 1.0, id })
      return new Promise<WorkerMessage>((resolve, reject) => {
        this.pendingMessages.set(id, { resolve, reject })
      })
    })

    // Yield results in order as they resolve
    for (const promise of promises) {
      if (this._interrupted) break

      const msg = await promise
      if (this._interrupted) break

      if (msg.type === 'audio' && msg.samples && msg.sampleRate) {
        const samplesBuf = Buffer.from(msg.samples, 'base64')
        const float32 = new Float32Array(
          samplesBuf.buffer,
          samplesBuf.byteOffset,
          samplesBuf.byteLength / 4
        )
        const wav = pcmToWav(float32, msg.sampleRate)
        yield wav
      }
    }
  }

  /**
   * Generate a WAV buffer for a single text segment.
   * Returns null if interrupted or no audio produced.
   */
  async generateWav(text: string): Promise<{ wav: Buffer; sampleRate: number } | null> {
    if (!this.ready || !this.worker) return null
    if (this._interrupted) return null

    // Apply per-voice pronunciation respellings before phonemization (no-op if none).
    const trimmed = this.prepareText(text.trim())
    if (!trimmed) return null

    const id = `tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    this.worker.send({ cmd: 'generate', text: trimmed, sid: 0, speed: 1.0, id })

    const msg = await new Promise<WorkerMessage>((resolve, reject) => {
      this.pendingMessages.set(id, { resolve, reject })
    })

    if (this._interrupted) return null
    if (msg.type !== 'audio' || !msg.samples || !msg.sampleRate) return null

    const samplesBuf = Buffer.from(msg.samples, 'base64')
    const float32 = new Float32Array(
      samplesBuf.buffer,
      samplesBuf.byteOffset,
      samplesBuf.byteLength / 4
    )
    return { wav: pcmToWav(float32, msg.sampleRate), sampleRate: msg.sampleRate }
  }

  stop(): void {
    this._interrupted = true
  }

  isReady(): boolean {
    return this.ready
  }

  /**
   * Dispose the worker cleanly — ready=false, worker killed.
   * Unlike shutdown(), does not reject pending messages (they naturally resolve
   * via worker exit). Allows creating a new PiperTTS instance afterward.
   */
  dispose(): void {
    this.ready = false
    this._interrupted = true
    // Invalidate cached respellings so a re-init re-reads from disk.
    invalidateRespellings(this.voice)
    this.respellings = null
    this.normalizePunct = false

    if (!this.worker) return

    const w = this.worker
    this.worker = null

    try {
      w.send({ cmd: 'shutdown' })
    } catch {
      // Worker may already be dead
    }

    const termTimer = setTimeout(() => {
      try { w.kill('SIGTERM') } catch { /* ignore */ }
    }, 1000)

    const killTimer = setTimeout(() => {
      try { w.kill('SIGKILL') } catch { /* ignore */ }
    }, 3000)

    w.once('exit', () => {
      clearTimeout(termTimer)
      clearTimeout(killTimer)
    })

    this.pendingMessages.clear()
  }

  shutdown(): void {
    this.ready = false
    this._interrupted = true

    if (!this.worker) return

    const w = this.worker
    this.worker = null

    // Try graceful shutdown
    try {
      w.send({ cmd: 'shutdown' })
    } catch {
      // Worker may already be dead
    }

    // SIGTERM after 1s
    const termTimer = setTimeout(() => {
      try { w.kill('SIGTERM') } catch { /* ignore */ }
    }, 1000)

    // SIGKILL after 3s
    const killTimer = setTimeout(() => {
      try { w.kill('SIGKILL') } catch { /* ignore */ }
    }, 3000)

    w.once('exit', () => {
      clearTimeout(termTimer)
      clearTimeout(killTimer)
    })

    // Reject pending
    for (const [, pending] of this.pendingMessages) {
      pending.reject(new Error('TTS engine shutting down'))
    }
    this.pendingMessages.clear()
  }
}
