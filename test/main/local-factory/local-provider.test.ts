import { describe, it } from 'node:test'
import * as assert from 'node:assert/strict'
import {
  readLocalWorkerConfig,
  buildLocalProviderBlock,
  localModelSpec,
  LOCAL_PROVIDER_ID,
  resolveLocalWorkerProfile,
} from '../../../src/main/local-factory/local-provider'

const ok = { baseUrl: 'http://h:8000/v1', model: 'qwen', contextWindow: 131072, maxOutputTokens: 16384 }

describe('readLocalWorkerConfig', () => {
  it('liest eine vollständige Config', () => {
    assert.deepEqual(readLocalWorkerConfig(ok), ok)
  })
  it('null, undefined, Nicht-Objekt → null', () => {
    assert.equal(readLocalWorkerConfig(null), null)
    assert.equal(readLocalWorkerConfig(undefined), null)
    assert.equal(readLocalWorkerConfig('x'), null)
  })
  it('fehlendes Pflichtfeld → null statt halber Config', () => {
    assert.equal(readLocalWorkerConfig({ ...ok, model: '' }), null)
    assert.equal(readLocalWorkerConfig({ ...ok, contextWindow: 0 }), null)
    assert.equal(readLocalWorkerConfig({ baseUrl: ok.baseUrl }), null)
  })
  it('übernimmt timeoutMinutes nur als positive Zahl', () => {
    assert.equal(readLocalWorkerConfig({ ...ok, timeoutMinutes: 30 })?.timeoutMinutes, 30)
    assert.equal(readLocalWorkerConfig({ ...ok, timeoutMinutes: -1 })?.timeoutMinutes, undefined)
  })
})

describe('buildLocalProviderBlock', () => {
  it('OpenAI-kompatibler Anbieter mit Grenzen aus der Config', () => {
    const block = buildLocalProviderBlock(ok)
    assert.equal(block.npm, '@ai-sdk/openai-compatible')
    assert.equal((block.options as Record<string, unknown>).baseURL, 'http://h:8000/v1')
    assert.deepEqual((block.models as Record<string, Record<string, unknown>>).qwen.limit, { context: 131072, output: 16384 })
  })
  it('localModelSpec ist anbieter/modell', () => {
    assert.equal(localModelSpec(ok), `${LOCAL_PROVIDER_ID}/qwen`)
  })
})

describe('resolveLocalWorkerProfile — Prototyp-Namen (Final-Fix 8)', () => {
  it('Profilname „toString“ ist unbekannt', () => {
    const r = resolveLocalWorkerProfile({ localWorkerProfiles: { mac: ok } }, 'toString')
    assert.equal(r.ok, false)
    assert.match((r as { error: string }).error, /unbekannt/)
  })
})
