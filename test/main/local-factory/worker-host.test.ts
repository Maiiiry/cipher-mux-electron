import { describe, it } from 'node:test'
import * as assert from 'node:assert/strict'
import {
  endpointProbeUrl, readUsageFile, probeEndpoint, checkWorkerReady, submitLine, type ProbeResult,
} from '../../../src/main/local-factory/worker-host-util'
import { resolveLocalWorkerProfile } from '../../../src/main/local-factory/local-provider'
import * as http from 'node:http'
import type { AddressInfo } from 'node:net'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

describe('worker-host Hilfen', () => {
  it('Probe-URL hängt /models an, ohne doppelten Slash', () => {
    assert.equal(endpointProbeUrl('http://h:8000/v1'), 'http://h:8000/v1/models')
    assert.equal(endpointProbeUrl('http://h:8000/v1/'), 'http://h:8000/v1/models')
  })
  it('readUsageFile: mtime und Tokens, fehlende Datei → null', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-'))
    assert.equal(readUsageFile(dir, 's'), null)
    fs.writeFileSync(path.join(dir, 's.json'), JSON.stringify({
      context_window: { total_input_tokens: 7, total_output_tokens: 3 },
    }))
    const u = readUsageFile(dir, 's')!
    assert.deepEqual(u.tokens, { input: 7, output: 3 })
    assert.ok(u.mtime > 0)
  })
})

const okCfg = { baseUrl: 'http://h:8000/v1', model: 'qwen', contextWindow: 1000, maxOutputTokens: 100 }
const probeOk = async (): Promise<ProbeResult> => ({ ok: true })

describe('checkWorkerReady (R15)', () => {
  it('bereit → null', async () => {
    assert.equal(await checkWorkerReady({ localWorker: okCfg, skipPermissions: true, probe: probeOk }), null)
  })
  it('nicht konfiguriert ≠ Endpunkt weg', async () => {
    let probed = false
    const r = await checkWorkerReady({
      localWorker: null, skipPermissions: true, probe: async () => { probed = true; return { ok: true } },
    })
    assert.match(r!, /nicht konfiguriert/)
    assert.equal(probed, false)
  })
  it('skipPermissions aus → Grund nennt die Einstellung', async () => {
    const r = await checkWorkerReady({ localWorker: okCfg, skipPermissions: false, probe: probeOk })
    assert.equal(r, 'Worker braucht agent.skipPermissions — sonst hängt opencode im Rückfrage-Dialog')
  })
  it('Endpunkt antwortet nicht mit 2xx → Grund mit URL und Detail', async () => {
    const r = await checkWorkerReady({
      localWorker: okCfg, skipPermissions: true, probe: async () => ({ ok: false, detail: 'HTTP 404' }),
    })
    assert.match(r!, /nicht erreichbar: http:\/\/h:8000\/v1\/models \(HTTP 404\)/)
  })
})

describe('probeEndpoint zählt nur 2xx', () => {
  async function serve(status: number): Promise<{ url: string; close: () => void }> {
    const srv = http.createServer((_q, res) => { res.statusCode = status; res.end('{}') })
    await new Promise<void>(r => srv.listen(0, '127.0.0.1', r))
    const { port } = srv.address() as AddressInfo
    return { url: `http://127.0.0.1:${port}/v1/models`, close: () => srv.close() }
  }
  it('200 → ok', async () => {
    const s = await serve(200)
    try { assert.deepEqual(await probeEndpoint(s.url), { ok: true }) } finally { s.close() }
  })
  it('404 → nicht ok (baseUrl ohne /v1 verbraucht keinen Versuch)', async () => {
    const s = await serve(404)
    try { assert.deepEqual(await probeEndpoint(s.url), { ok: false, detail: 'HTTP 404' }) } finally { s.close() }
  })
  it('geschlossener Port → nicht ok', async () => {
    const s = await serve(200); s.close()
    await new Promise(r => setTimeout(r, 50))
    const r = await probeEndpoint(s.url, 1000)
    assert.equal(r.ok, false)
  })
})

describe('submitLine', () => {
  // Gemessen 2026-10-09 im echten Lauf: Text + '\r' in einem send-keys kommt
  // bei Claude Code als eingefügter Block an; das '\r' wird ein Zeilenumbruch
  // im Eingabefeld, die Weckzeile bleibt dort stehen und wird nie abgeschickt.
  it('schickt den Text ohne Zeilenende und danach Enter als eigene Taste', async () => {
    const calls: string[] = []
    await submitLine(
      async keys => { calls.push(`text:${keys}`) },
      async name => { calls.push(`key:${name}`) },
      'Zeile',
      async () => { calls.push('pause') },
    )
    assert.deepEqual(calls, ['text:Zeile', 'pause', 'key:Enter'])
  })
  it('entfernt Zeilenenden aus dem Text', async () => {
    const texts: string[] = []
    await submitLine(async k => { texts.push(k) }, async () => {}, 'a\r\nb\n', async () => {})
    assert.deepEqual(texts, ['a b'])
  })
})

describe('checkWorkerReady mit Profil', () => {
  it('prüft den Endpunkt des gewählten Profils', async () => {
    const seen: string[] = []
    const agent = { localWorkerProfiles: { a: okCfg, b: { ...okCfg, baseUrl: 'http://mac:11433/v1' } }, localWorkerDefaultProfile: 'a' }
    await checkWorkerReady({
      resolved: resolveLocalWorkerProfile(agent, 'b'), skipPermissions: true,
      probe: async (u) => { seen.push(u); return { ok: true } as ProbeResult },
    })
    assert.deepEqual(seen, ['http://mac:11433/v1/models'])
  })
  it('unbekanntes Profil: Grund kommt durch, keine Probe', async () => {
    let probed = false
    const r = await checkWorkerReady({
      resolved: resolveLocalWorkerProfile({ localWorker: okCfg }, 'mac'), skipPermissions: true,
      probe: async () => { probed = true; return { ok: true } as ProbeResult },
    })
    assert.match(r!, /Profil „mac" unbekannt/)
    assert.equal(probed, false)
  })
})
