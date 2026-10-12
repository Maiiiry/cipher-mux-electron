// test/main/local-factory/local-profiles.test.ts
import { describe, it } from 'node:test'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as assert from 'node:assert/strict'
import { resolveLocalWorkerProfile, DEFAULT_PROFILE, readLocalWorkerConfig, buildLocalProviderBlock, writeLocalProfileFile, readLocalProfileFile, LOCAL_PROFILE_FILENAME } from '../../../src/main/local-factory/local-provider'

const dgx = { baseUrl: 'http://h:8000/v1', model: 'qwen3.8-27b', contextWindow: 131072, maxOutputTokens: 16384 }
const mac = { baseUrl: 'http://127.0.0.1:11433/v1', model: 'qwen38-27b-64k', contextWindow: 65536, maxOutputTokens: 16384 }

describe('resolveLocalWorkerProfile', () => {
  it('ohne Profile: localWorker gilt als Profil default — bestehende Configs laufen wie heute', () => {
    const r = resolveLocalWorkerProfile({ localWorker: dgx })
    assert.deepEqual(r, { ok: true, profil: DEFAULT_PROFILE, cfg: dgx })
  })
  it('ohne Profile und ohne Namen, aber mit Namen default: dasselbe', () => {
    assert.equal((resolveLocalWorkerProfile({ localWorker: dgx }, 'default') as any).profil, 'default')
  })
  it('ohne Profile: ein anderer Name ist unbekannt', () => {
    const r = resolveLocalWorkerProfile({ localWorker: dgx }, 'mac')
    assert.equal(r.ok, false)
    assert.match((r as any).error, /Profil „mac" unbekannt/)
  })
  it('mit Profilen: Name wählt, ohne Namen gilt localWorkerDefaultProfile', () => {
    const agent = { localWorker: null, localWorkerProfiles: { dgx, mac }, localWorkerDefaultProfile: 'mac' }
    assert.deepEqual(resolveLocalWorkerProfile(agent), { ok: true, profil: 'mac', cfg: mac })
    assert.deepEqual(resolveLocalWorkerProfile(agent, 'dgx'), { ok: true, profil: 'dgx', cfg: dgx })
  })
  it('mit Profilen ohne gültigen Default: der Fehler nennt die vorhandenen', () => {
    const r = resolveLocalWorkerProfile({ localWorkerProfiles: { dgx, mac } })
    assert.equal(r.ok, false)
    assert.match((r as any).error, /dgx, mac/)
  })
  it('ein halbes Profil gilt als keins', () => {
    const r = resolveLocalWorkerProfile({ localWorkerProfiles: { kaputt: { baseUrl: 'x' } }, localWorkerDefaultProfile: 'kaputt' })
    assert.equal(r.ok, false)
    assert.match((r as any).error, /unvollständig/)
  })
  it('gar nichts konfiguriert: derselbe Grund wie bisher', () => {
    const r = resolveLocalWorkerProfile({ localWorker: null })
    assert.match((r as any).error, /Local Worker nicht konfiguriert/)
  })
  it('modelOptions reisen bis in den Provider-Block, ein Nicht-Objekt fällt weg', () => {
    const cfg = readLocalWorkerConfig({ ...mac, modelOptions: { reasoning_effort: 'none' } })!
    assert.deepEqual((buildLocalProviderBlock(cfg) as any).models[mac.model].options, { reasoning_effort: 'none' })
    assert.equal(readLocalWorkerConfig({ ...mac, modelOptions: 'x' })!.modelOptions, undefined)
  })
})

describe('Profil-Datei im Run-Verzeichnis', () => {
  it('rund: geschrieben = gelesen', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-'))
    writeLocalProfileFile(dir, { profil: 'mac', cfg: mac })
    assert.deepEqual(readLocalProfileFile(dir), { profil: 'mac', cfg: mac })
  })
  it('fehlt oder kaputt → null, nicht werfen', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lp-'))
    assert.equal(readLocalProfileFile(dir), null)
    fs.writeFileSync(path.join(dir, LOCAL_PROFILE_FILENAME), '{kaputt')
    assert.equal(readLocalProfileFile(dir), null)
  })
})
