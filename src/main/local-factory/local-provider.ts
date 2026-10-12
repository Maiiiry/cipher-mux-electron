/**
 * Der lokale Anbieter für die Rolle `local-worker` (Spec §6, Entscheidung E4).
 *
 * opencode spricht den Endpunkt direkt an, kein Gateway dazwischen. Die
 * Kontextgröße steht in der Config, weil opencode sie für einen selbst
 * eingetragenen Anbieter nicht kennt — mit ihr ist die Prozentanzeige eine
 * Rechnung gegen eine bekannte Zahl statt gegen OPENCODE_FALLBACK_CONTEXT_WINDOW.
 */

import * as fs from 'fs'
import * as path from 'path'
import type { LocalWorkerConfig } from '../../shared/types'

export { LocalWorkerConfig } from '../../shared/types'

export const LOCAL_PROVIDER_ID = 'cipher-local'

function positive(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

/** Defensiv: eine halbe Config ist keine — dann gibt es keinen lokalen Worker. */
export function readLocalWorkerConfig(raw: unknown): LocalWorkerConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (typeof r.baseUrl !== 'string' || r.baseUrl.trim() === '') return null
  if (typeof r.model !== 'string' || r.model.trim() === '') return null
  if (!positive(r.contextWindow) || !positive(r.maxOutputTokens)) return null
  return {
    baseUrl: r.baseUrl.trim(),
    model: r.model.trim(),
    contextWindow: r.contextWindow,
    maxOutputTokens: r.maxOutputTokens,
    ...(positive(r.timeoutMinutes) ? { timeoutMinutes: r.timeoutMinutes } : {}),
    // Ein Nicht-Objekt fällt weg, statt das ganze Profil zu verwerfen.
    ...(r.modelOptions && typeof r.modelOptions === 'object' && !Array.isArray(r.modelOptions)
      ? { modelOptions: r.modelOptions as Record<string, unknown> }
      : {}),
  }
}

export function buildLocalProviderBlock(cfg: LocalWorkerConfig): Record<string, unknown> {
  return {
    npm: '@ai-sdk/openai-compatible',
    name: LOCAL_PROVIDER_ID,
    options: { baseURL: cfg.baseUrl },
    models: {
      [cfg.model]: {
        name: cfg.model,
        limit: { context: cfg.contextWindow, output: cfg.maxOutputTokens },
        // Unverändert durchgereicht (z. B. Denkmodus aus) — der Code rät keine Schlüssel.
        ...(cfg.modelOptions ? { options: cfg.modelOptions } : {}),
      },
    },
  }
}

export function localModelSpec(cfg: LocalWorkerConfig): string {
  return `${LOCAL_PROVIDER_ID}/${cfg.model}`
}

/** Name des Profils, das ein einzelnes `agent.localWorker` darstellt. */
export const DEFAULT_PROFILE = 'default'

export type AgentProfileSource = {
  localWorker?: unknown
  localWorkerProfiles?: unknown
  localWorkerDefaultProfile?: unknown
}

export type ProfileResult =
  | { ok: true; profil: string; cfg: LocalWorkerConfig }
  | { ok: false; error: string }

/**
 * Welches lokale Modell ein Auftrag bekommt (Spec 2026-10-12 §4.4).
 *
 * Ohne `localWorkerProfiles` ist `agent.localWorker` das einzige Profil und
 * heißt `default` — bestehende Configs laufen unverändert. Freie Modellnamen
 * gibt es nicht: ein Tippfehler würde in der Bilanz als eigenes Modell zählen.
 */
export function resolveLocalWorkerProfile(agent: AgentProfileSource, name?: string): ProfileResult {
  const raw = agent.localWorkerProfiles
  const profiles = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : null
  if (!profiles || Object.keys(profiles).length === 0) {
    const wanted = name ?? DEFAULT_PROFILE
    if (wanted !== DEFAULT_PROFILE) {
      return { ok: false, error: `Profil „${wanted}" unbekannt — eingerichtet ist nur „${DEFAULT_PROFILE}" (agent.localWorker).` }
    }
    const cfg = readLocalWorkerConfig(agent.localWorker)
    return cfg
      ? { ok: true, profil: DEFAULT_PROFILE, cfg }
      : { ok: false, error: 'Local Worker nicht konfiguriert (agent.localWorker fehlt oder ist unvollständig)' }
  }
  const names = Object.keys(profiles).sort()
  const def = typeof agent.localWorkerDefaultProfile === 'string' ? agent.localWorkerDefaultProfile : undefined
  const wanted = name ?? def
  if (!wanted || !(wanted in profiles)) {
    const was = wanted ? `Profil „${wanted}" unbekannt` : 'Kein Standardprofil (agent.localWorkerDefaultProfile)'
    return { ok: false, error: `${was} — vorhanden: ${names.join(', ')}.` }
  }
  const cfg = readLocalWorkerConfig(profiles[wanted])
  return cfg
    ? { ok: true, profil: wanted, cfg }
    : { ok: false, error: `Profil „${wanted}" ist unvollständig (baseUrl, model, contextWindow, maxOutputTokens).` }
}

/**
 * Das Profil eines Worker-Starts, im Run-Verzeichnis des Workers. Eine Datei
 * statt eines Startparameters, weil Adapter und Bilanz dieselbe Quelle lesen
 * müssen: was der Worker bekam, ist, was gezählt wird.
 */
export const LOCAL_PROFILE_FILENAME = 'local-profile.json'

export function writeLocalProfileFile(runDir: string, p: { profil: string; cfg: LocalWorkerConfig }): void {
  fs.mkdirSync(runDir, { recursive: true })
  fs.writeFileSync(path.join(runDir, LOCAL_PROFILE_FILENAME), JSON.stringify(p, null, 2) + '\n', 'utf-8')
}

export function readLocalProfileFile(runDir: string): { profil: string; cfg: LocalWorkerConfig } | null {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(runDir, LOCAL_PROFILE_FILENAME), 'utf-8')) as Record<string, unknown>
    const cfg = readLocalWorkerConfig(raw.cfg)
    return cfg && typeof raw.profil === 'string' ? { profil: raw.profil, cfg } : null
  } catch {
    return null
  }
}
