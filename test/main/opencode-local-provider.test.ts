import { describe, it } from 'node:test'
import * as assert from 'node:assert/strict'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  mergeOpenCodeConfig, buildOpenCodeMcpEntry, OpenCodeAdapter, OPENCODE_CONFIG_FILENAME, OPENCODE_PLUGIN_SUBDIR,
} from '../../src/main/agent/adapters/opencode'
import { OPENCODE_BOUNDARY_PLUGIN_FILENAME, PROTECTED_PATHS_FILENAME } from '../../src/main/session/entity-boundaries'
import { IDLE_PLUGIN_FILENAME } from '../../src/main/local-factory/worker-done'
import { buildLocalProviderBlock, localModelSpec, writeLocalProfileFile, readLocalProfileFile } from '../../src/main/local-factory/local-provider'

const entry = buildOpenCodeMcpEntry('http://127.0.0.1:3100/mcp', 'k', null, 'local-worker')
const cfg = { baseUrl: 'http://h/v1', model: 'qwen', contextWindow: 1000, maxOutputTokens: 100 }
const local = { provider: buildLocalProviderBlock(cfg), model: localModelSpec(cfg) }

type Merged = { provider?: Record<string, { options?: { baseURL?: string } }>; model?: string }

describe('mergeOpenCodeConfig mit lokalem Anbieter', () => {
  it('schreibt provider.cipher-local und model', () => {
    const m = mergeOpenCodeConfig({}, entry, [], local) as Merged
    assert.equal(m.provider?.['cipher-local']?.options?.baseURL, 'http://h/v1')
    assert.equal(m.model, 'cipher-local/qwen')
  })
  it('fremde Anbieter bleiben stehen', () => {
    const m = mergeOpenCodeConfig({ provider: { other: { x: 1 } } }, entry, [], local) as Merged
    assert.deepEqual(m.provider.other, { x: 1 })
  })
  it('ohne local: ein früher geschriebener eigener Anbieter verschwindet, fremdes model bleibt', () => {
    const before = mergeOpenCodeConfig({}, entry, [], local)
    const m = mergeOpenCodeConfig({ ...before, model: 'anthropic/x' }, entry, [], null) as Merged
    assert.equal(m.provider?.['cipher-local'], undefined)
    assert.equal(m.model, 'anthropic/x')
  })
  it('ohne local: das eigene model wird entfernt', () => {
    const before = mergeOpenCodeConfig({}, entry, [], local)
    const m = mergeOpenCodeConfig(before, entry, [], null) as Merged
    assert.equal(m.model, undefined)
  })
})

describe('OpenCodeAdapter.postLaunchInjection — Verdrahtung des lokalen Workers', () => {
  const ctx = (projectPath: string, entityId: string) => ({
    projectPath, entityId, mcpUrl: 'http://127.0.0.1:3100/mcp', mcpApiKey: 'k', sessionId: 's', workspaceId: 'ws',
  })
  const adapter = new OpenCodeAdapter({ getSkipPermissions: () => true, getLocalWorker: () => cfg })
  type Cfg = { provider?: Record<string, unknown>; model?: string; plugin?: string[] }
  const readCfg = (d: string): Cfg => JSON.parse(fs.readFileSync(path.join(d, OPENCODE_CONFIG_FILENAME), 'utf-8'))

  it('local-worker: Anbieter + Modell, Idle-Plugin, Grenze mit absolutem Sperrlisten-Pfad; andere Rolle räumt ab', async () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-lw-'))
    try {
      await adapter.postLaunchInjection(ctx(runDir, 'local-worker'))
      const c = readCfg(runDir)
      assert.ok(c.provider?.['cipher-local'])
      assert.equal(c.model, 'cipher-local/qwen')

      const pluginDir = path.join(runDir, OPENCODE_PLUGIN_SUBDIR)
      const idle = path.join(pluginDir, IDLE_PLUGIN_FILENAME)
      const boundary = path.join(pluginDir, OPENCODE_BOUNDARY_PLUGIN_FILENAME)
      assert.ok(fs.existsSync(idle), 'Idle-Plugin fehlt')
      assert.ok(fs.readFileSync(boundary, 'utf-8').includes(JSON.stringify(path.join(runDir, PROTECTED_PATHS_FILENAME))))
      assert.ok(c.plugin?.some(p => p.endsWith(IDLE_PLUGIN_FILENAME)))

      await adapter.postLaunchInjection(ctx(runDir, 'companion'))
      const c2 = readCfg(runDir)
      assert.equal(c2.provider?.['cipher-local'], undefined)
      assert.equal(c2.model, undefined)
      assert.equal(fs.existsSync(idle), false)
      assert.ok(!c2.plugin?.some(p => p.endsWith(IDLE_PLUGIN_FILENAME)))
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true })
    }
  })
})

describe('OpenCodeAdapter — Profil-Datei des Run-Verzeichnisses', () => {
  it('nimmt Provider und Modell aus der Profil-Datei', async () => {
    const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-prof-'))
    try {
      writeLocalProfileFile(runDir, { profil: 'mac', cfg: { baseUrl: 'http://127.0.0.1:11433/v1', model: 'm-mac', contextWindow: 65536, maxOutputTokens: 16384 } })
      const a = new OpenCodeAdapter({
        getSkipPermissions: () => true,
        getLocalWorker: (dir: string) => readLocalProfileFile(dir)?.cfg ?? null,
      })
      await a.postLaunchInjection({ projectPath: runDir, entityId: 'local-worker', mcpUrl: 'http://127.0.0.1:3100/mcp', mcpApiKey: 'k', sessionId: 's', workspaceId: 'ws' })
      const written = JSON.parse(fs.readFileSync(path.join(runDir, OPENCODE_CONFIG_FILENAME), 'utf-8'))
      assert.equal(written.model, 'cipher-local/m-mac')
      assert.equal(written.provider['cipher-local'].options.baseURL, 'http://127.0.0.1:11433/v1')
    } finally {
      fs.rmSync(runDir, { recursive: true, force: true })
    }
  })
})

describe('OpenCodeAdapter.buildLaunchCommand — Modell-Override und Profil (Final-Fix 5)', () => {
  const adapter = new OpenCodeAdapter({ getSkipPermissions: () => true })
  const opts = (dir: string, entityId: string) => ({ projectPath: dir, workDir: dir, sessionName: 's', entityId, model: 'anthropic/x' })
  it('local-worker mit Profil-Datei: kein --model, das Profil bestimmt das Modell', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-lp-'))
    writeLocalProfileFile(d, { profil: 'default', cfg })
    assert.ok(!adapter.buildLaunchCommand(opts(d, 'local-worker')).args.includes('--model'))
  })
  it('local-worker ohne Profil-Datei, und andere Rollen mit: --model bleibt', () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-lp-'))
    assert.ok(adapter.buildLaunchCommand(opts(d, 'local-worker')).args.includes('--model'))
    writeLocalProfileFile(d, { profil: 'default', cfg })
    assert.ok(adapter.buildLaunchCommand(opts(d, 'workshop')).args.includes('--model'))
  })
})
