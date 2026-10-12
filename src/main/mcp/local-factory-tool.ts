import * as path from 'path'
import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolContext } from './mcp-tools'
import { registerMuxTool } from './register-tool'
import { LocalFactoryRunner, type RunnerRolle } from '../local-factory/runner'
import { workerLock } from '../local-factory/worker-lock'
import { handleLocalFactoryCall, type ToolArgs } from '../local-factory/tool-call'
import { createWorkerHost } from '../local-factory/worker-host'
import { resolveRunDir, ENTITIES_BASE } from '../session/entity-run-dir'
import { createBilanzSink } from '../local-factory/bilanz-sink'
import { ERGEBNISSE, KATEGORIEN } from '../local-factory/bilanz'
import { LOCAL_WORKER_DISPATCH_TOOL } from '../local-factory/presets'

/** Ein Läufer pro Workspace und Rolle; er überlebt die MCP-Verbindung, nicht den App-Neustart. */
const runners = new Map<string, LocalFactoryRunner>()

export function getRunner(ctx: ToolContext): LocalFactoryRunner {
  const ws = ctx.workspaceId ?? '__unbound__'
  const rolle: RunnerRolle = ctx.entityId === 'local-workshop' ? 'local-workshop' : 'local-factory'
  const key = `${ws}::${rolle}`
  let r = runners.get(key)
  if (!r) {
    r = new LocalFactoryRunner({
      host: createWorkerHost(ctx),
      laufDir: path.join(resolveRunDir(ctx.workspaceId ?? null, rolle), 'laeufe'),
      rolle, workerLock, workspaceKey: ws,
      bilanz: rolle === 'local-workshop' && ctx.noteManager
        ? createBilanzSink({ dir: path.join(ENTITIES_BASE, 'local-workshop'), notes: ctx.noteManager })
        : undefined,
      workspaceId: ctx.workspaceId ?? null,
    })
    runners.set(key, r)
  }
  return r
}

const text = (v: unknown) => [{ type: 'text' as const, text: JSON.stringify(v) }]

export function registerLocalFactoryTool(server: McpServer, ctx: ToolContext): void {
  registerMuxTool(server, LOCAL_WORKER_DISPATCH_TOOL, {
    description:
      'Local Cyber Factory: start a fresh local worker (opencode + local model) on ONE work item. '
      + 'Write the acceptance test first (must be red); do not commit it. Returns immediately; '
      + 'you are woken with one line "[local-factory] #N ..." when the gate has run. Do not poll. '
      + 'Retry: same laufId + haeppchen. Max 2 attempts, then escalate to the user. '
      + 'accept=true with laufId and haeppchen (and nothing else required) marks a green item as accepted '
      + 'after you reviewed the commit. All other fields are required for a dispatch. '
      + 'local-workshop: accept=true carries the verdict (ergebnis, kategorie, notiz — notiz required for nachgebessert) and also works for an exhausted item. '
      + 'For local-workshop: geschuetzteTests may be empty (routine without its own test); testBefehl is still required.',
    inputSchema: {
      // Optional im Schema, Pflicht beim Dispatch (validateAuftrag) — ein accept braucht sie nicht.
      projekt: z.string().optional().describe('Dispatch: absolute path of the target git repo'),
      ziel: z.string().optional().describe('Dispatch: required'),
      dateien: z.array(z.string()).optional().describe('Dispatch: required'),
      akzeptanzkriterium: z.string().optional().describe('Dispatch: required'),
      geschuetzteTests: z.array(z.string()).optional()
        .describe('Dispatch: acceptance tests plus every file the test command depends on, repo-relative or absolute'),
      testBefehl: z.string().optional().describe('Dispatch: shell command run in the repo; exit 0 = green'),
      nichtZiele: z.array(z.string()).optional().describe('Dispatch: required (may be empty)'),
      laufId: z.string().optional().describe('Returned by the first dispatch; pass it on every later item and retry'),
      haeppchen: z.number().int().positive().optional().describe('Item number; pass it for a retry and for accept'),
      profil: z.string().optional().describe('Dispatch: model profile name from the settings; omit for the default'),
      accept: z.boolean().optional(),
      ergebnis: z.enum(ERGEBNISSE).optional().describe('local-workshop verdict with accept=true'),
      kategorie: z.enum(KATEGORIEN).optional().describe('local-workshop verdict with accept=true'),
      notiz: z.string().optional().describe('local-workshop verdict; required for ergebnis=nachgebessert'),
    },
  }, async (args: ToolArgs) => {
    try {
      const { result, isError } = await handleLocalFactoryCall(getRunner(ctx), args, ctx.entityId === 'local-workshop' ? 'local-workshop' : 'local-factory')
      return { content: text(result), ...(isError ? { isError: true } : {}) }
    } catch (err) {
      return { content: text({ ok: false, error: String(err) }), isError: true }
    }
  })
}
