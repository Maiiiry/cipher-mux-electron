import type { ToolContext } from '../mcp/mcp-tools'
import type { WorkerHost } from './runner'
import { startEntitySession } from '../mcp/handoff-kernel'
import { findEntitySessions } from '../session/entity-session-lookup'
import { endpointProbeUrl, readUsageFile, checkWorkerReady, probeEndpoint, submitLine } from './worker-host-util'
import { resolveLocalWorkerProfile, writeLocalProfileFile } from './local-provider'
import { resolveRunDir } from '../session/entity-run-dir'
import { BRAND } from '../../shared/brand'

export { endpointProbeUrl, readUsageFile }

/**
 * Der echte Host: SessionManager, tmux, Usage-Dateien. Die Bereitschaftsprobe
 * steht in worker-host-util.ts (node:http, nur 2xx).
 */

export function createWorkerHost(ctx: ToolContext): WorkerHost {
  const sm = ctx.sessionManager
  const ws = ctx.workspaceId ?? null
  return {
    async workerReady(profil) {
      const { configStore } = await import('../config/config-store')
      const agent = configStore.get('agent')
      return checkWorkerReady({
        resolved: resolveLocalWorkerProfile(agent ?? {}, profil),
        skipPermissions: agent?.skipPermissions === true,
        probe: url => probeEndpoint(url),
      })
    },
    async startFreshWorker(projekt, profil) {
      const { configStore } = await import('../config/config-store')
      const r = resolveLocalWorkerProfile(configStore.get('agent') ?? {}, profil)
      if (!r.ok) throw new Error(r.error)
      for (const s of findEntitySessions(sm.list(), 'local-worker', ws)) {
        await sm.stopEntity('local-worker', s.id)
      }
      // Vor dem Start: postLaunchInjection liest die Datei beim Schreiben der opencode.json.
      const erwartet = resolveRunDir(ws, 'local-worker')
      writeLocalProfileFile(erwartet, { profil: r.profil, cfg: r.cfg })
      const session = await startEntitySession(ctx, 'local-worker', { projectPath: projekt })
      // Das Run-Verzeichnis ist das cwd der Session (startEntity → start({ projectPath: runDir })).
      // Nicht neu berechnen: startEntity löst den Workspace selbst auf (gelöschter
      // Workspace → ungebunden), eine eigene Rechnung zeigte dann ins falsche Verzeichnis.
      if (!session.projectPath) {
        // Wurf im Läufer (nicht in der Session-Init): räumt auf und weckt mit „Läuferfehler“.
        await sm.stopEntity('local-worker', session.id).catch(() => {})
        throw new Error('Worker-Session ohne Arbeitsverzeichnis gestartet')
      }
      // Befund: postLaunchInjection läuft awaited innerhalb von SessionManager.start(),
      // das startEntity() aufruft -- also VOR der Rückkehr von startEntitySession.
      // Löst startEntity einen gelöschten Workspace zu „ungebunden" auf, hat der Adapter
      // die Datei im falschen Verzeichnis gesucht und still auf das Standardprofil
      // zurückgegriffen. Nachträgliches Schreiben käme zu spät; ein stiller Default
      // würde in der Bilanz das falsche Modell zählen. Also abbrechen.
      if (session.projectPath !== erwartet) {
        await sm.stopEntity('local-worker', session.id).catch(() => {})
        throw new Error('Workspace nicht mehr vorhanden')
      }
      return { runDir: session.projectPath, sessionId: session.id, profil: r.profil, modell: r.cfg.model }
    },
    async sendToWorker(sessionId, line) {
      await submitLine(k => sm.sendKeys(sessionId, k), n => sm.sendKey(sessionId, n), line)
    },
    async stopWorker(sessionId) {
      try { await sm.stopEntity('local-worker', sessionId) } catch { /* schon weg */ }
    },
    lastActivityAt(sessionId) {
      return readUsageFile(BRAND.statusLineDir, sessionId)?.mtime ?? 0
    },
    tokensAt(sessionId) {
      return readUsageFile(BRAND.statusLineDir, sessionId)?.tokens ?? null
    },
    async wakeArchitect(line) {
      const target = findEntitySessions(sm.list(), 'local-factory', ws)[0]
      if (!target) {
        console.warn('[local-factory] Architekt nicht gefunden, Weckzeile verloren:', line)
        return
      }
      await submitLine(k => sm.sendKeys(target.id, k), n => sm.sendKey(target.id, n), line)
    },
  }
}
