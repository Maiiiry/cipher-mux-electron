import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  applyRespellings,
  loadRespellings,
  invalidateRespellings,
  normalizeForPiper,
  loadNormalizeFlag,
  type RespellingMap,
} from '../../src/main/voice/respellings'
import { PiperTTS } from '../../src/main/voice/tts-piper'

describe('applyRespellings', () => {
  const map: RespellingMap = {
    SAP: 'Es-A-Peh',
    Grow: 'Groh',
    'CI/CD': 'Zeh-I Zeh-Deh',
    Cache: 'Käsch',
  }

  it('applies substitutions to matching whole words', () => {
    const input = 'Der SAP-Job, ein Grow und CI/CD, der Cache.'
    const expected = 'Der Es-A-Peh-Job, ein Groh und Zeh-I Zeh-Deh, der Käsch.'
    assert.equal(applyRespellings(input, map), expected)
  })

  it('is a no-op when the map is null (non-domain voices unaffected)', () => {
    const input = 'Der SAP-Job, ein Grow und CI/CD, der Cache.'
    assert.equal(applyRespellings(input, null), input)
  })

  it('respects whole-word boundaries — "Grower" stays "Grower"', () => {
    assert.equal(applyRespellings('Ein Grower im Grow.', map), 'Ein Grower im Groh.')
  })

  it('treats "/" as part of a token so CI/CD matches as a unit', () => {
    // A bare "CI" should not be rewritten, and "CD/CI" should not partial-match.
    assert.equal(applyRespellings('CI und CD getrennt.', map), 'CI und CD getrennt.')
    assert.equal(applyRespellings('CI/CD-Pipeline', map), 'Zeh-I Zeh-Deh-Pipeline')
  })

  it('applies longest match first', () => {
    const overlap: RespellingMap = { AB: 'x', ABC: 'y' }
    assert.equal(applyRespellings('ABC', overlap), 'y')
  })
})

describe('loadRespellings', () => {
  let dir: string
  const voiceId = 'de_DE-test-medium'

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'respell-'))
    invalidateRespellings(voiceId)
  })

  afterEach(() => {
    invalidateRespellings(voiceId)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('returns null when no respellings.json is present', () => {
    assert.equal(loadRespellings(dir, voiceId), null)
  })

  it('loads and returns the map when the file is present', () => {
    fs.writeFileSync(path.join(dir, 'respellings.json'), JSON.stringify({ SAP: 'Es-A-Peh' }))
    const map = loadRespellings(dir, voiceId)
    assert.deepEqual(map, { SAP: 'Es-A-Peh' })
  })

  it('caches by voice id (second call does not re-read a deleted file)', () => {
    fs.writeFileSync(path.join(dir, 'respellings.json'), JSON.stringify({ SAP: 'Es-A-Peh' }))
    loadRespellings(dir, voiceId)
    fs.rmSync(path.join(dir, 'respellings.json'))
    // Still cached from the first load.
    assert.deepEqual(loadRespellings(dir, voiceId), { SAP: 'Es-A-Peh' })
    // After invalidation, re-reads from disk (now absent → null).
    invalidateRespellings(voiceId)
    assert.equal(loadRespellings(dir, voiceId), null)
  })

  it('treats a malformed file as absent (no-op)', () => {
    fs.writeFileSync(path.join(dir, 'respellings.json'), '{ not valid json')
    assert.equal(loadRespellings(dir, voiceId), null)
  })
})

describe('normalizeForPiper', () => {
  it('ellipse mitten im Satz wird zu Semikolon', () => {
    assert.equal(normalizeForPiper('Moment … ich rechne.'), 'Moment; ich rechne.')
  })
  it('ellipse ohne Leerzeichen wird zu Semikolon', () => {
    assert.equal(normalizeForPiper('Moment… ich rechne.'), 'Moment; ich rechne.')
  })
  it('ellipse am Satzende wird zum Punkt', () => {
    assert.equal(normalizeForPiper('Na ja, vielleicht …'), 'Na ja, vielleicht.')
  })
  it('drei Punkte gelten wie die Ellipse', () => {
    assert.equal(normalizeForPiper('Moment... ich rechne.'), 'Moment; ich rechne.')
  })
  it('typografische Anfuehrungszeichen fallen weg', () => {
    assert.equal(normalizeForPiper('Er sagte „Hallo“ und «bye».'), 'Er sagte Hallo und bye.')
  })
  it('gedankenstrich bleibt unveraendert', () => {
    assert.equal(
      normalizeForPiper('Das war — wie immer — knapp.'),
      'Das war — wie immer — knapp.',
    )
  })
  it('normaler Text bleibt unberuehrt', () => {
    const t = 'Warum ist der Himmel blau, wenn die Sonne gelb ist?'
    assert.equal(normalizeForPiper(t), t)
  })
})

describe('loadNormalizeFlag', () => {
  let dir: string
  const voiceId = 'de_DE-flagtest-medium'

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'normflag-'))
    invalidateRespellings(voiceId)
  })
  afterEach(() => {
    invalidateRespellings(voiceId)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('ist false ohne Marker-Datei (Stimme bleibt bit-genau unveraendert)', () => {
    assert.equal(loadNormalizeFlag(dir, voiceId), false)
  })

  it('ist true mit leerer Marker-Datei', () => {
    fs.writeFileSync(path.join(dir, 'normalize-punct.flag'), '')
    assert.equal(loadNormalizeFlag(dir, voiceId), true)
  })

  it('wirft nie: fehlendes Verzeichnis liefert false', () => {
    assert.equal(loadNormalizeFlag(path.join(dir, 'gibt-es-nicht'), voiceId), false)
  })

  it('cached pro Stimme und wird von invalidateRespellings invalidiert', () => {
    fs.writeFileSync(path.join(dir, 'normalize-punct.flag'), '')
    assert.equal(loadNormalizeFlag(dir, voiceId), true)
    fs.rmSync(path.join(dir, 'normalize-punct.flag'))
    assert.equal(loadNormalizeFlag(dir, voiceId), true)
    invalidateRespellings(voiceId)
    assert.equal(loadNormalizeFlag(dir, voiceId), false)
  })

  it('Marker beeinflusst loadRespellings nicht (Respellings bleiben ladbar)', () => {
    fs.writeFileSync(path.join(dir, 'normalize-punct.flag'), 'egal')
    fs.writeFileSync(path.join(dir, 'respellings.json'), '{ kaputt')
    assert.equal(loadNormalizeFlag(dir, voiceId), true)
    assert.equal(loadRespellings(dir, voiceId), null)
  })

  it('Reihenfolge: erst normalisieren, dann respellen', () => {
    const map: RespellingMap = { Moment: 'Mo-ment' }
    const out = applyRespellings(normalizeForPiper('Moment… ich rechne.'), map)
    assert.equal(out, 'Mo-ment; ich rechne.')
  })
})

describe('PiperTTS.prepareText', () => {
  const make = (normalizePunct: boolean, respellings: RespellingMap | null) => {
    const tts = new PiperTTS({ voice: 'de_DE-prep-medium', modelsDir: '/nonexistent' })
    Object.assign(tts as unknown as Record<string, unknown>, { normalizePunct, respellings })
    return tts
  }

  it('Stimme mit Marker: Ellipse wird vor den Respellings normalisiert', () => {
    assert.equal(make(true, null).prepareText('Moment… ich rechne.'), 'Moment; ich rechne.')
  })

  it('Stimme ohne Marker: Text bleibt bit-genau unveraendert', () => {
    const t = 'Moment… „ich“ rechne ...  '
    assert.equal(make(false, null).prepareText(t), t)
  })

  it('Reihenfolge: normalisieren, dann respellen', () => {
    const out = make(true, { Moment: 'Mo-ment' }).prepareText('„Moment“… ich rechne.')
    assert.equal(out, 'Mo-ment; ich rechne.')
  })

  it('ohne Marker greifen Respellings weiterhin allein', () => {
    assert.equal(make(false, { Moment: 'Mo-ment' }).prepareText('Moment…'), 'Mo-ment…')
  })
})
