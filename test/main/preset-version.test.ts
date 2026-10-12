import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parsePresetVersion, comparePresetVersion, presetBackupPath } from '../../src/main/entity-content/preset-version'
import { PRESET_TEMPLATES, presetTemplateFor } from '../../src/main/entity-content/preset-templates'

describe('parsePresetVersion', () => {
  it('liest Rolle und Nummer aus dem Marker', () => {
    assert.deepEqual(parsePresetVersion('<!-- companion-v2 -->\n# Titel'), { entityId: 'companion', version: 2 })
  })

  it('kennt Rollennamen mit Bindestrich', () => {
    assert.deepEqual(parsePresetVersion('<!-- ideation-partner-v2 -->'), { entityId: 'ideation-partner', version: 2 })
  })

  it('vertraegt Leerzeichen im Kommentar', () => {
    assert.deepEqual(parsePresetVersion('<!--   debugger-v11   -->'), { entityId: 'debugger', version: 11 })
  })

  it('nimmt den ERSTEN Marker im Text', () => {
    // Ein Preset darf in seinem Rumpf ueber Marker schreiben, ohne dass daraus
    // eine Versionsangabe wird.
    const text = '<!-- companion-v2 -->\n\nBeispiel: `<!-- companion-v9 -->`\n'
    assert.equal(parsePresetVersion(text)?.version, 2)
  })

  it('gibt null, wenn keiner da ist', () => {
    assert.equal(parsePresetVersion('# Nur eine Ueberschrift'), null)
    assert.equal(parsePresetVersion(''), null)
    assert.equal(parsePresetVersion('<!-- kein-marker -->'), null)
    assert.equal(parsePresetVersion('<!-- companion-vX -->'), null)
  })
})

describe('comparePresetVersion', () => {
  const tpl = (v: number) => `<!-- companion-v${v} -->\n# Inhalt`

  it('gleiche Nummer heisst aktuell', () => {
    const c = comparePresetVersion(tpl(2), tpl(2))
    assert.equal(c.status, 'aktuell')
    assert.equal(c.stale, false)
  })

  it('aeltere Datei heisst veraltet', () => {
    const c = comparePresetVersion(tpl(1), tpl(3))
    assert.equal(c.status, 'veraltet')
    assert.equal(c.stale, true)
    assert.deepEqual([c.fileVersion, c.templateVersion], [1, 3])
  })

  it('Datei ohne Marker gilt als veraltet', () => {
    // Die Marker wurden eingefuehrt, *weil* sich etwas geaendert hat. Eine Datei
    // ohne Marker hat diese Aenderung per Definition nicht gesehen.
    const c = comparePresetVersion('# Alt, ohne Marker', tpl(2))
    assert.equal(c.status, 'ohne-datei-marker')
    assert.equal(c.stale, true)
    assert.equal(c.fileVersion, null)
  })

  it('Vorlage ohne Marker warnt NICHT', () => {
    // Ueber eine Rolle ohne Vorlagenmarker laesst sich nichts sagen, und eine
    // Warnung ohne Aussage ist Laerm.
    const c = comparePresetVersion(tpl(2), '# Vorlage ohne Marker')
    assert.equal(c.status, 'ohne-vorlage-marker')
    assert.equal(c.stale, false)
  })

  it('neuere Datei warnt nicht, bleibt aber sichtbar', () => {
    const c = comparePresetVersion(tpl(5), tpl(2))
    assert.equal(c.status, 'voraus')
    assert.equal(c.stale, false)
  })

  it('beide ohne Marker: keine Aussage, keine Warnung', () => {
    assert.equal(comparePresetVersion('a', 'b').stale, false)
  })
})

describe('presetBackupPath', () => {
  const at = new Date('2026-10-01T22:40:05.123Z')

  it('haengt einen Zeitstempel an, der ein Dateiname sein darf', () => {
    const p = presetBackupPath('/x/entities/companion/preset.md', at)
    assert.equal(p, '/x/entities/companion/preset.md.bak-2026-10-01T22-40-05Z')
    assert.ok(!p.slice(1).includes(':'), 'Doppelpunkte sind im Finder Pfadtrenner')
  })

  it('zwei Reparaturen ueberschreiben sich nicht', () => {
    // Ohne Zeitstempel waere die erste Sicherung beim zweiten Mal weg -- und
    // genau dann ist die Reparatur das irreversible Ding, das sie nicht sein soll.
    const a = presetBackupPath('/x/preset.md', new Date('2026-10-01T22:40:05Z'))
    const b = presetBackupPath('/x/preset.md', new Date('2026-10-01T22:41:05Z'))
    assert.notEqual(a, b)
  })

  it('laesst den Originalpfad vollstaendig stehen', () => {
    // Die Sicherung liegt neben der Datei, nicht irgendwo -- wer sie sucht,
    // findet sie im selben Verzeichnis.
    const p = presetBackupPath('/x/entities/debugger/preset.md', at)
    assert.ok(p.startsWith('/x/entities/debugger/preset.md.'))
  })
})

describe('PRESET_TEMPLATES', () => {
  it('nennt nur Rollen, deren preset.md write-once ist', () => {
    // audit und voice-relay werden bei jedem Start neu geschrieben und koennen
    // nicht zurueckfallen. Sie hier zu fuehren hiesse, nach etwas zu suchen,
    // das es nicht geben kann.
    const ids = Object.keys(PRESET_TEMPLATES).sort()
    assert.deepEqual(ids, ['companion', 'debugger', 'ideation-partner', 'local-workshop', 'refinement'])
    assert.ok(!ids.includes('audit'))
    assert.ok(!ids.includes('voice-relay'))
  })

  it('jede Vorlage traegt einen Marker mit ihrer eigenen Rollen-ID', () => {
    // Ohne das vergleicht man die Rolle gegen die Version einer anderen.
    for (const id of Object.keys(PRESET_TEMPLATES)) {
      const text = presetTemplateFor(id)
      assert.ok(text, `${id}: keine Vorlage`)
      const v = parsePresetVersion(text)
      assert.ok(v, `${id}: Vorlage ohne Versionsmarker`)
      assert.equal(v.entityId, id, `${id}: Marker nennt eine andere Rolle (${v.entityId})`)
    }
  })

  it('eine Rolle ohne Vorlage liefert null statt zu werfen', () => {
    assert.equal(presetTemplateFor('workshop'), null)
    assert.equal(presetTemplateFor('gibtsnicht'), null)
  })

  it('jede Vorlage gilt als aktuell gegen sich selbst', () => {
    for (const id of Object.keys(PRESET_TEMPLATES)) {
      const text = presetTemplateFor(id) as string
      assert.equal(comparePresetVersion(text, text).status, 'aktuell', id)
    }
  })
})
