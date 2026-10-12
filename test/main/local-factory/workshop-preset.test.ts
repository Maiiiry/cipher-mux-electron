import { describe, it } from 'node:test'
import * as assert from 'node:assert/strict'
import { generateLocalWorkshopPreset } from '../../../src/main/local-factory/workshop-preset'
import { LOCAL_WORKER_DISPATCH_TOOL } from '../../../src/main/local-factory/presets'
import { ERGEBNISSE, KATEGORIEN } from '../../../src/main/local-factory/bilanz'
import { BILANZ_NOTE_TITLE } from '../../../src/main/local-factory/bilanz-sink'
import { PRESET_TEMPLATES } from '../../../src/main/entity-content/preset-templates'

const p = generateLocalWorkshopPreset()

describe('Local-Workshop-Rollentext', () => {
  it('trägt den Versionsmarker und steht in PRESET_TEMPLATES', () => {
    assert.match(p, /^<!-- local-workshop-v1 -->/)
    assert.equal(PRESET_TEMPLATES['local-workshop'](), p)
  })
  it('nennt das Werkzeug, die Etiketten lokal/selbst und die Bilanz-Note', () => {
    assert.match(p, new RegExp(LOCAL_WORKER_DISPATCH_TOOL))
    assert.match(p, /\*\*lokal\*\*/); assert.match(p, /\*\*selbst\*\*/)
    assert.ok(p.includes(BILANZ_NOTE_TITLE))
  })
  it('nennt jedes Ergebnis und jede Kategorie genau so, wie das Werkzeug sie annimmt', () => {
    for (const e of ERGEBNISSE) assert.ok(p.includes(`\`${e}\``), e)
    for (const k of KATEGORIEN) assert.ok(p.includes(`\`${k}\``), k)
  })
  it('kein Polling, Spec spiegeln, Plan als Note, Profil nur auf Ansage', () => {
    assert.match(p, /kein Polling/i)
    assert.match(p, /mux_mirror_sync/)
    assert.match(p, /kind:plan/)
    assert.match(p, /nur, wenn der User/i)
  })
  it('nach zwei Anläufen selbst übernehmen, nicht eskalieren', () => {
    assert.match(p, /selbst übernehmen/)
    assert.doesNotMatch(p, /ESKALIERT/)
  })
})
