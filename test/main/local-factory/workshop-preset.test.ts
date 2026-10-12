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

describe('Local-Workshop-Rollentext — Final-Fix', () => {
  it('Spec spiegeln, Plan als Note mit kind:plan (Widerspruch zu Schritt 3 weg)', () => {
    assert.ok(p.includes('Die Spec spiegelt `mux_mirror_sync` (Typ `spec`); den Plan legst du als Note mit `kind:plan` an.'))
    assert.doesNotMatch(p, /Spec und Plan spiegelt/)
  })
  it('„Nicht bereit“ kommt auch als Werkzeugantwort, nicht nur als Weckzeile', () => {
    assert.match(p, /als Antwort auf den Dispatch oder als Weckzeile/)
  })
  it('abgebrochene Häppchen bekommen kein Urteil', () => {
    assert.match(p, /durch einen Neustart abgebrochen[^.]*kein Urteil; dispatche es neu/)
  })
  it('„An den User melden“ des Werkzeugs gilt für den Workshop als selbst übernehmen', () => {
    assert.match(p, /„An den User melden“ ab, gilt für dich: selbst übernehmen\s+und `selbst-uebernommen` urteilen/)
  })
})

describe('Werkzeugbeschreibung je Rolle (Final-Fix 6)', () => {
  it('Workshop: eigenes Präfix und selbst übernehmen; Factory: wie bisher', async () => {
    const { buildDispatchDescription } = await import('../../../src/main/mcp/local-factory-tool')
    const w = buildDispatchDescription('local-workshop')
    assert.ok(w.includes('"[local-workshop] #N ..."'))
    assert.ok(w.includes('take the item over yourself and judge it selbst-uebernommen'))
    assert.ok(!w.includes('escalate to the user'))
    const f = buildDispatchDescription('local-factory')
    assert.ok(f.includes('"[local-factory] #N ..."'))
    assert.ok(f.includes('Max 2 attempts, then escalate to the user. accept=true'))
  })
})
