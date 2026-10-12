// src/main/session/entity-run-dir.ts — Run directories per (workspace, entity)
//
// The entity directory (~/.config/cipher-mux/entities/<id>) holds *authored*
// artefacts: preset.md, skills, guides. It is write-once and survives manual
// edits. The run directory holds *generated* artefacts — CLAUDE.md, .mcp.json,
// .claude/settings.local.json — and is the session's cwd.
//
// Splitting per workspace is what keeps two instances of the same preset in
// different workspaces from overwriting each other's CLAUDE.md.

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { GLOBAL_WORKSPACE_KEY, workspaceKey } from '../../shared/workspace-key'

/** Default base for all run directories. */
export const RUNS_BASE = path.join(os.homedir(), '.config', 'cipher-mux', 'runs')

/** Basis der authored-Entity-Verzeichnisse (dieselbe Wurzel wie `entitiesBase` in entity-registry.ts). */
export const ENTITIES_BASE = path.join(os.homedir(), '.config', 'cipher-mux', 'entities')

/** Absolute run directory for an (workspace, entity) pair. No disk access. */
export function resolveRunDir(
  workspaceId: string | null | undefined,
  entityId: string,
  baseDir: string = RUNS_BASE,
): string {
  return path.join(baseDir, workspaceKey(workspaceId), entityId)
}

/**
 * Create the run directory and (re-)link authored assets from the entity dir.
 *
 * Each link name resolves relative to BOTH directories the same way —
 * `path.join(entityDir, name)` as the target, `path.join(runDir, name)` as
 * the link — so a name can be a top-level entry (`skills`, `guides`) or a
 * nested path (`.claude/commands`) without special-casing. The link's parent
 * directory is created first, so nested names work.
 *
 * `<runDir>/.claude` itself is always created (even with no matching link
 * name) because the generated `settings.local.json` needs it to exist.
 *
 * Idempotent: re-links dangling symlinks, leaves healthy ones alone, and skips
 * names the entity dir does not provide.
 */
export function ensureRunDir(
  workspaceId: string | null | undefined,
  entityId: string,
  entityDir: string,
  linkNames: string[],
  baseDir: string = RUNS_BASE,
): string {
  const runDir = resolveRunDir(workspaceId, entityId, baseDir)
  fs.mkdirSync(path.join(runDir, '.claude'), { recursive: true })

  for (const name of linkNames) {
    const target = path.join(entityDir, name)
    if (!fs.existsSync(target)) continue

    const link = path.join(runDir, name)
    fs.mkdirSync(path.dirname(link), { recursive: true })
    let needsLink = true
    try {
      const stat = fs.lstatSync(link)
      if (stat.isSymbolicLink()) {
        // Healthy link pointing at the right target → leave alone.
        needsLink = !fs.existsSync(link) || fs.readlinkSync(link) !== target
      } else {
        // A real file or dir sits where the link belongs — don't touch it.
        needsLink = false
      }
    } catch {
      // lstat threw → nothing there yet.
      needsLink = true
    }

    if (!needsLink) continue
    try { fs.unlinkSync(link) } catch { /* nothing to remove */ }
    try {
      fs.symlinkSync(target, link, 'dir')
    } catch (err) {
      console.warn(`[entity-run-dir] symlink ${link} -> ${target} failed:`, err)
    }
  }

  return runDir
}

/**
 * Union of configured workspace ids and the workspaceId of every currently
 * listed session. Feed this (not the configured list alone) to
 * `pruneRunDirs` on startup: a session's run dir must not be pulled out from
 * under it just because its workspace was deleted while the session keeps
 * running in tmux.
 */
export function liveWorkspaceIds(
  configuredIds: Iterable<string>,
  sessionWorkspaceIds: Iterable<string | null | undefined>,
): string[] {
  const ids = new Set<string>(configuredIds)
  for (const id of sessionWorkspaceIds) {
    if (id) ids.add(id)
  }
  return [...ids]
}

/**
 * Remove run directories belonging to workspaces that no longer exist.
 * The _global directory is never pruned. Returns the removed paths.
 *
 * Callers must only pass workspace IDs they know to be current, and must not
 * call this while sessions of those workspaces are still running.
 */
export function pruneRunDirs(
  knownWorkspaceIds: string[],
  baseDir: string = RUNS_BASE,
): string[] {
  if (!fs.existsSync(baseDir)) return []

  const keep = new Set([...knownWorkspaceIds, GLOBAL_WORKSPACE_KEY])
  const removed: string[] = []

  for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (keep.has(entry.name)) continue
    const full = path.join(baseDir, entry.name)
    try {
      fs.rmSync(full, { recursive: true, force: true })
      removed.push(full)
    } catch (err) {
      console.warn(`[entity-run-dir] prune ${full} failed:`, err)
    }
  }

  return removed
}
