// src/main/mcp/entity-header.ts — Role identity on the MCP connection.
//
// Sibling of workspace-header.ts, for the same reason: the MCP server cannot
// tell its callers apart, because everyone shares one URL and one bearer
// token. The workspace already rides on the connection; the role did not, so
// the server had no way to answer "which entity is asking".
//
// Two things need that answer and neither is reachable otherwise:
//
//  - Companion memory belongs to the Companion role. Dropping the tool from
//    an entity's permission list does NOT withhold it — a missing permission
//    only produces an approval prompt. Tools have to not be registered for
//    that connection at all.
//  - Role boundaries as a constraint: what a role may touch has to be decided
//    where the role is known.
//
// As with the workspace, the identity is bound once at initialize rather than
// passed as a tool parameter the model can forget or get wrong.

/** Header name as Node normalises incoming headers: lowercase. */
export const ENTITY_HEADER = 'x-mux-entity'

/** Header name as written into .mcp.json / settings.local.json. */
export const ENTITY_HEADER_CANONICAL = 'X-Mux-Entity'

/**
 * Read the entity binding off an incoming request's headers.
 * Returns null for absent, empty or whitespace-only values.
 */
export function parseEntityHeader(
  headers: Record<string, string | string[] | undefined>,
): string | null {
  const raw = headers[ENTITY_HEADER]
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Validate a raw header value against the entities that currently exist.
 *
 * An unknown id becomes null rather than an error — a client whose entity was
 * renamed or removed mid-session must keep working, same rule as for a deleted
 * workspace.
 */
export function resolveEntityId(
  raw: string | null,
  knownEntityIds: readonly string[],
): string | null {
  if (raw === null) return null
  if (knownEntityIds.includes(raw)) return raw
  console.warn(`[mcp] unknown entity id in ${ENTITY_HEADER_CANONICAL}: "${raw}" — treating as unbound`)
  return null
}

/** The role that owns companion memory. */
export const COMPANION_ENTITY_ID = 'companion'

/**
 * Whether a connection may use `companion_memory_*`.
 *
 * Strategy paper 2.5 limits companion memory to the Companion role: that is
 * where role-bound personal memory belongs, and every other role writing into
 * the same store is what turned recall into a barrel rather than an index.
 *
 * A connection carrying no role is the app's own tooling or a plain session,
 * not an entity. Withholding there would take the tools from the user instead
 * of from a role, so an absent identity is allowed.
 */
export function mayUseCompanionMemory(entityId: string | null | undefined): boolean {
  if (entityId === null || entityId === undefined) return true
  return entityId === COMPANION_ENTITY_ID
}

/** Rollen, die lokale Worker beauftragen dürfen (Spec 2026-10-12 §4.1). */
const LOCAL_DISPATCH_ROLES = new Set(['local-factory', 'local-workshop'])

/**
 * Whether a connection may dispatch local workers (Local Cyber Factory).
 *
 * Unlike companion memory, an absent role is NOT allowed: the tool starts
 * sessions, commits into the target repo and resets it on failure. That is a
 * role's job, not something any plain connection should be able to trigger.
 */
export function mayUseLocalWorkerDispatch(entityId: string | null | undefined): boolean {
  return !!entityId && LOCAL_DISPATCH_ROLES.has(entityId)
}
