import { describe, it } from 'node:test'
import * as assert from 'node:assert/strict'
import { createWorkerLock } from '../../../src/main/local-factory/worker-lock'

describe('Ein Worker zur Zeit pro Workspace', () => {
  it('die zweite Rolle bekommt den Namen der ersten', () => {
    const l = createWorkerLock()
    assert.equal(l.claim('ws1', 'local-factory'), null)
    assert.equal(l.claim('ws1', 'local-workshop'), 'local-factory')
  })
  it('andere Workspaces sind unabhängig', () => {
    const l = createWorkerLock()
    l.claim('ws1', 'local-factory')
    assert.equal(l.claim('ws2', 'local-workshop'), null)
  })
  it('nach release frei; release einer fremden Rolle gibt nichts frei', () => {
    const l = createWorkerLock()
    l.claim('ws1', 'local-factory')
    l.release('ws1', 'local-workshop')
    assert.equal(l.claim('ws1', 'local-workshop'), 'local-factory')
    l.release('ws1', 'local-factory')
    assert.equal(l.claim('ws1', 'local-workshop'), null)
  })
})
