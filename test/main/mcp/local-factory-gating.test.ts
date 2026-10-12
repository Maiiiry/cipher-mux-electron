import { describe, it } from 'node:test'
import * as assert from 'node:assert/strict'
import { mayUseLocalWorkerDispatch } from '../../../src/main/mcp/entity-header'

describe('mayUseLocalWorkerDispatch', () => {
  it('nur die beiden lokalen Rollen', () => {
    assert.equal(mayUseLocalWorkerDispatch('local-factory'), true)
    assert.equal(mayUseLocalWorkerDispatch('local-worker'), false)
    assert.equal(mayUseLocalWorkerDispatch('cyber-factory'), false)
  })
  it('ohne Rolle nicht — das Werkzeug startet Worker und committet in fremde Repos', () => {
    assert.equal(mayUseLocalWorkerDispatch(null), false)
    assert.equal(mayUseLocalWorkerDispatch(undefined), false)
  })
  it('local-workshop darf dispatchen, andere Rollen und rollenlose Verbindungen nicht', () => {
    assert.equal(mayUseLocalWorkerDispatch('local-workshop'), true)
    assert.equal(mayUseLocalWorkerDispatch('local-factory'), true)
    assert.equal(mayUseLocalWorkerDispatch('workshop'), false)
    assert.equal(mayUseLocalWorkerDispatch(null), false)
  })
})
