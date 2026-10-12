import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

// Import entity-registry directly — no Electron dependencies
const { EntityRegistry, registerBuiltinEntities } = require('../../src/main/session/entity-registry')

describe('EntityRegistry', () => {
  let registry: InstanceType<typeof EntityRegistry>

  beforeEach(() => {
    registry = new EntityRegistry()
  })

  it('register() + get() stores and retrieves config', () => {
    const config = {
      id: 'companion',
      displayName: 'Coding Companion',
      color: '#ffb74d',
      projectPath: '/tmp/companion',
      features: ['mcp', 'resume'],
    }
    registry.register(config)
    const result = registry.get('companion')
    assert.deepStrictEqual(result, config)
  })

  it('get() returns undefined for unknown entity', () => {
    assert.strictEqual(registry.get('companion'), undefined)
  })

  it('list() returns all registered entities', () => {
    registry.register({
      id: 'orchestrator',
      displayName: 'Orchestrator',
      color: '#4fc3f7',
      projectPath: '/tmp/orch',
      features: ['mcp'],
    })
    registry.register({
      id: 'companion',
      displayName: 'Coding Companion',
      color: '#ffb74d',
      projectPath: '/tmp/comp',
      features: ['mcp'],
    })
    assert.strictEqual(registry.list().length, 2)
  })

  it('linkSession() + getBySessionId() maps session to entity', () => {
    registry.register({
      id: 'companion',
      displayName: 'Coding Companion',
      color: '#ffb74d',
      projectPath: '/tmp/comp',
      features: ['mcp'],
    })
    registry.linkSession('sess-1', 'companion')
    const config = registry.getBySessionId('sess-1')
    assert.strictEqual(config?.id, 'companion')
  })

  it('unlinkSession() removes the mapping', () => {
    registry.register({
      id: 'companion',
      displayName: 'Coding Companion',
      color: '#ffb74d',
      projectPath: '/tmp/comp',
      features: ['mcp'],
    })
    registry.linkSession('sess-1', 'companion')
    registry.unlinkSession('sess-1')
    assert.strictEqual(registry.getBySessionId('sess-1'), undefined)
  })

  it('getEntityIdForSession() returns entity ID', () => {
    registry.register({
      id: 'refinement',
      displayName: 'Refinement',
      color: '#ef5350',
      projectPath: '/tmp/ref',
      features: ['mcp'],
    })
    registry.linkSession('sess-2', 'refinement')
    assert.strictEqual(registry.getEntityIdForSession('sess-2'), 'refinement')
  })

  it('getEntityIdForSession() returns undefined for unknown session', () => {
    assert.strictEqual(registry.getEntityIdForSession('unknown'), undefined)
  })
})

describe('registerBuiltinEntities()', () => {
  it('registers all 12 builtin entities', () => {
    const registry = new EntityRegistry()
    registerBuiltinEntities(registry)
    const entities = registry.list()
    assert.strictEqual(entities.length, 13)
    const ids = entities.map((e: any) => e.id).sort()
    assert.deepStrictEqual(ids, [
      'audit', 'companion', 'cyber-factory', 'debugger',
      'ideation-partner', 'launcher', 'local-factory', 'local-worker', 'local-workshop', 'refinement',
      'testing-assistant', 'voice-relay', 'workshop',
    ])
  })

  it('companion has correct display name and color', () => {
    const registry = new EntityRegistry()
    registerBuiltinEntities(registry)
    const companion = registry.get('companion')
    assert.strictEqual(companion?.displayName, 'Coding Companion')
    assert.strictEqual(companion?.color, '#ffb74d')
    assert.ok(companion?.features.includes('mcp'))
    assert.ok(companion?.features.includes('memory'))
    assert.ok(!('autoResume' in (companion ?? {})), 'autoResume should not exist')
  })

  it('refinement has correct display name and color', () => {
    const registry = new EntityRegistry()
    registerBuiltinEntities(registry)
    const refinement = registry.get('refinement')
    assert.strictEqual(refinement?.displayName, 'Refinement')
    assert.strictEqual(refinement?.color, '#ef5350')
  })

  it('workshop gets correct projectPath from entitiesBase', () => {
    const registry = new EntityRegistry()
    registerBuiltinEntities(registry)
    const workshop = registry.get('workshop')
    assert.ok(workshop?.projectPath.endsWith('/entities/workshop'))
    const cf = registry.get('cyber-factory')
    assert.ok(cf?.projectPath.endsWith('/entities/cyber-factory'))
  })
})

describe('Local Cyber Factory im Registry', () => {
  it('registriert local-factory (claude) und local-worker (opencode, singleInstance)', () => {
    const r = new EntityRegistry()
    registerBuiltinEntities(r)
    const f = r.get('local-factory')!
    const w = r.get('local-worker')!
    assert.ok(f.features.includes('mcp'))
    assert.equal(f.singleInstance, true)
    assert.equal(w.adapterId, 'opencode')
    assert.equal(w.singleInstance, true)
  })

  it('registriert local-workshop (claude, mcp, singleInstance)', () => {
    const r = new EntityRegistry()
    registerBuiltinEntities(r)
    const k = r.get('local-workshop')!
    assert.ok(k.features.includes('mcp'))
    assert.equal(k.singleInstance, true)
    assert.ok(!k.adapterId)
    assert.ok(k.projectPath.endsWith('/entities/local-workshop'))
  })
})
