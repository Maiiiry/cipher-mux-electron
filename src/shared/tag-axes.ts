/**
 * Vier Achsen, nicht vierzehn.
 *
 * Festgelegt am 2026-09-30: wichtig sind **Workspace, Phase, Status und Typ**.
 *
 * Der Ist-Zustand war ein anderer, gemessen am selben Tag: 958 Notes,
 * 14 Klassen, 269 Tags ganz ohne Klasse. `kind` allein trug 29 Werte,
 * `workspace` dreizehn — darunter „Cipher Grow KIT" und „cipher grow kit"
 * nebeneinander —, und unter `phase` standen Wellennummern.
 *
 * Der Grund liegt im Verfahren: Das Auto-Tagging fragt ein lokales Modell und
 * übernimmt, was zurückkommt. Ein Modell, das Klassen erfinden darf, erfindet
 * welche — und jede erfundene Klasse ist eine Filterebene, die es nur einmal
 * gibt. Die Achsen sind die Antwort darauf, und zwar als Filter auf dem
 * Ergebnis statt als Bitte im Prompt: eine Bitte kann ein Modell überhören.
 *
 * **Gefiltert wird nur, was das Tagging vorschlägt.** Bestehende Tags an Notes
 * bleiben unangetastet — was jemand selbst vergeben hat, nimmt ihm hier
 * niemand weg.
 */

/**
 * Die Achsen, auf die sich das Tagging beschränkt.
 *
 * `entity` kam am 2026-09-30 dazu, auf den Einwand hin, dass Phase und Status
 * ebenfalls den Prozess widerspiegeln — „ideation refinement audit und testing
 * tragen es ja quasi im namen". Das stimmt, und es macht `entity` zur
 * **Tatsache**: welche Rolle eine Note erzeugt hat, weiß der Mux aus der
 * Verbindung (X-Mux-Entity), er muss es nicht schätzen.
 *
 * Phase und Entity korrelieren stark, sind aber nicht dasselbe — ein Debugger
 * schreibt auch Specs. Deshalb leitet ENTITY_PHASE_DEFAULT die Phase aus der
 * Entity nur **ab**, als Vorschlag, den ein Mensch überschreibt.
 */
export const TAG_AXES = ['workspace', 'entity', 'kind', 'phase', 'status'] as const
export type TagAxis = (typeof TAG_AXES)[number]

/**
 * Typ einer Note.
 *
 * Die ersten fünf tragen eine eigene Ansicht (siehe note-type-tags.ts); die
 * übrigen beschreiben einen Zweck, für den es keine gibt, aber einen echten
 * Gegenstand — ein Bugreport ist eine Sache, die der Mux kennt.
 */
export const KIND_VALUES: readonly string[] = [
  'testcase', 'finding', 'spec', 'requirements', 'research',
  'bugreport', 'handoff', 'journal', 'reference', 'todo', 'idea',
  // Aus der Messung des Bestands am 2026-09-30 nachgetragen. Diese drei Typen
  // waren da, bevor es die Achse gab, und zwar in Mengen, die sich nicht in
  // einen benachbarten Wert pressen lassen: 63 Wellenplaene und 36 Fix-Plaene
  // sind Plaene, 59 Abschlussberichte sind Berichte, 24 Walkthroughs und 7
  // Guides sind Anleitungen. Eine geschlossene Liste soll knapp sein, nicht
  // unvollständig.
  'plan', 'report', 'guide',
]

/** Phase des Arbeitsablaufs. Mehrere sind erlaubt — eine Note darf zwei berühren. */
export const PHASE_VALUES: readonly string[] = [
  'research', 'architecture', 'coding', 'testing', 'debugging', 'automation', 'monitoring',
]

/** Zustand. Ausschließend: zwei Zustände gleichzeitig sind keine Aussage. */
export const STATUS_VALUES: readonly string[] = [
  'open', 'in-progress', 'blocked', 'verify', 'done', 'superseded',
]

/**
 * Schwere eines Befunds — vier Stufen, aufsteigend.
 *
 * Festgelegt am 2026-09-30: „zum start sollte gerade severity auf 4 (low mid hi
 * now) begrenzt werden ... now als höchste stufe". Der Bestand trug
 * high/medium/low/critical; der Umzug bildet das ab.
 *
 * Die Werte stehen hier als **Startbelegung**, nicht als Gesetz: `severity` ist
 * eine Registry-Klasse und im TagManager editierbar. Der Code schreibt vor, was
 * beim ersten Start da ist, nicht was auf Dauer gilt.
 */
export const SEVERITY_VALUES: readonly string[] = ['low', 'mid', 'hi', 'now']

/**
 * Die Rollen, die Notes erzeugen. Deckungsgleich mit der Entity-Registry —
 * ein Test hält das fest, damit eine neue Rolle nicht stillschweigend
 * aus der Achse fällt.
 */
export const ENTITY_VALUES: readonly string[] = [
  'workshop', 'cyber-factory', 'launcher', 'companion', 'refinement',
  'ideation-partner', 'voice-relay', 'audit', 'debugger', 'testing-assistant',
  'local-factory', 'local-worker', 'local-workshop',
]

/**
 * Welche Phase eine Rolle normalerweise bearbeitet.
 *
 * Ein **Vorschlag**, keine Gleichsetzung: ein Debugger schreibt auch Specs,
 * und eine Cyber Factory testet ihren eigenen Code. Wer hier einen Eintrag
 * nicht findet, bekommt keine Phase vorgeschlagen — das ist besser als eine
 * falsche.
 */
export const ENTITY_PHASE_DEFAULT: Readonly<Record<string, string>> = {
  'ideation-partner': 'research',
  refinement: 'architecture',
  'cyber-factory': 'coding',
  'testing-assistant': 'testing',
  debugger: 'debugging',
  audit: 'monitoring',
  workshop: 'automation',
}

/**
 * Tags ohne Klasse, die der Mux programmatisch liest.
 *
 * `handoff` wird von `NoteManager.createHandoff` auf jede Übergabe-Note
 * geschrieben, und `mux_notes_handoff_search` filtert genau darauf. Er muss
 * flach bleiben: ein `kind:handoff` daneben wäre der Typ, dieser hier ist der
 * Marker „hier wartet eine Übergabe".
 *
 * Er steht hier, weil zwei Pfade sich sonst widersprechen — `createHandoff`
 * umgeht die Tag-Prüfung und schrieb ihn, während `isKnownTag` ihn abwies.
 * Dieselbe Note über `mux_notes_create` wäre an der Prüfung gescheitert.
 */
export const FLAT_MARKERS: readonly string[] = ['handoff']

export const AXIS_VALUES: Partial<Record<TagAxis, readonly string[]>> = {
  kind: KIND_VALUES,
  entity: ENTITY_VALUES,
  phase: PHASE_VALUES,
  status: STATUS_VALUES,
}

/**
 * Achsen, von denen eine Note nur einen Wert tragen darf.
 *
 * Zwei Typen machen den Typ mehrdeutig, zwei Zustände heben einander auf.
 * Phase ist bewusst nicht dabei: eine Spec kann Architektur und Testen
 * zugleich betreffen.
 */
export const EXCLUSIVE_AXES: readonly TagAxis[] = ['kind', 'status', 'entity']

/**
 * Achsen, die der Prozess setzt und niemand schätzt.
 *
 * Beide sind Tatsachen über die Herkunft einer Note, keine Einschätzungen ihres
 * Inhalts: der Workspace kommt aus der Verbindung, die Entity aus dem Kopf
 * X-Mux-Entity. Ein Modell, das den Workspace errät, hängt eine Note in ein
 * fremdes Projekt; eine Rolle, die eine andere Rolle einträgt, verfälscht die
 * Herkunft.
 *
 * In der Oberfläche heißt das: **anzeigen, nicht zur Auswahl stellen.**
 */
export const PROCESS_SET_AXES: readonly TagAxis[] = ['workspace', 'entity']

function splitTag(tag: string): { axis: string; value: string } | null {
  const i = tag.indexOf(':')
  if (i <= 0 || i === tag.length - 1) return null
  return { axis: tag.slice(0, i).toLowerCase(), value: tag.slice(i + 1).toLowerCase() }
}

/** Ob ein Tag auf eine der vier Achsen passt — bei geschlossenen auch dem Wert nach. */
export function isAxisTag(tag: string): boolean {
  const parts = splitTag(tag)
  if (!parts) return false
  if (!(TAG_AXES as readonly string[]).includes(parts.axis)) return false

  const allowed = AXIS_VALUES[parts.axis as TagAxis]
  // Offene Achse (workspace): jeder Wert ist möglich, die IDs sind nicht
  // aufzählbar.
  return allowed ? allowed.includes(parts.value) : true
}

/**
 * Vorschläge des Auto-Taggings auf die Achsen zurechtstutzen.
 *
 * Reihenfolge bleibt erhalten, damit bei einer ausschließenden Achse der
 * zuerst genannte Wert gewinnt — das ist der, den das Modell für den
 * wahrscheinlichsten hielt.
 */
export function filterToAxes(tags: readonly string[]): string[] {
  const seen = new Set<string>()
  const usedExclusive = new Set<string>()
  const result: string[] = []

  for (const raw of tags) {
    const parts = splitTag(raw)
    if (!parts) continue
    if ((PROCESS_SET_AXES as readonly string[]).includes(parts.axis)) continue

    const normalized = `${parts.axis}:${parts.value}`
    if (!isAxisTag(normalized) || seen.has(normalized)) continue

    if ((EXCLUSIVE_AXES as readonly string[]).includes(parts.axis)) {
      if (usedExclusive.has(parts.axis)) continue
      usedExclusive.add(parts.axis)
    }

    seen.add(normalized)
    result.push(normalized)
  }

  return result
}

/**
 * Tags, die der Prozess beim Anlegen einer Note setzt.
 *
 * Alles hier ist bekannt, nichts geschätzt: der Workspace aus der Verbindung,
 * die Entity aus ihrem Kopf, der Typ aus dem Aufruf. Die Phase wird aus der
 * Entity abgeleitet und ist das einzige Stück Vermutung — korrigierbar.
 */
export function processTagsFor(opts: {
  workspaceId?: string | null
  entityId?: string | null
  noteType?: string | null
}): string[] {
  const tags: string[] = []
  if (opts.workspaceId) tags.push(`workspace:${opts.workspaceId.toLowerCase()}`)
  if (opts.entityId && ENTITY_VALUES.includes(opts.entityId)) {
    tags.push(`entity:${opts.entityId}`)
    const phase = ENTITY_PHASE_DEFAULT[opts.entityId]
    if (phase) tags.push(`phase:${phase}`)
  }
  if (opts.noteType && KIND_VALUES.includes(opts.noteType)) tags.push(`kind:${opts.noteType}`)
  return tags
}


// ─── Das Auswahlfeld: zwei Quellen, eine Bedienung ──────────
//
// Anforderung vom 2026-09-30: „severity und component finde ich legitim - aber
// die werte müssen editierbar sein - gerade component ist dabei ja schon
// projektspezifisch", und dann: „halt über das editieren auch fest als auswahl
// vorgeben - ich denke das fehlt".
//
// Der Unterschied zwischen den Zeilen ist die HERKUNFT der Werte, nicht ihre
// Verbindlichkeit. Angeboten werden beide gleich: als Knopf. Ein editierbarer
// Wert, der nirgends zur Auswahl steht, ist eine Einstellung ohne Wirkung.

export interface PickRow {
  /** Die Tag-Klasse. */
  klass: string
  /** Beschriftung im Auswahlfeld. */
  label: string
  /**
   * Woher die Werte kommen.
   *
   * `axis` — aus dem Code. Der Mux kennt sie, Ansichten hängen daran
   * (TestcaseView, FindingView), sie sind nicht verhandelbar.
   *
   * `registry` — aus `.tags.json`, im TagManager editierbar. Welche Bauteile
   * ein Projekt hat, weiß der Code nicht und soll es nicht wissen.
   */
  source: 'axis' | 'registry'
  /** Ob die Note nur einen Wert dieser Klasse tragen darf. */
  exclusive: boolean
}

/**
 * Die Zeilen des Auswahlfelds, in der Reihenfolge des Arbeitsablaufs.
 *
 * `workspace` und `entity` fehlen: das sind Tatsachen aus dem Prozess. Ein
 * Auswahlknopf dafür wäre eine Einladung, eine Note unter eine fremde Herkunft
 * zu hängen. Sie erscheinen als Chip, nicht als Knopf (PROCESS_SET_AXES).
 */
export const PICK_ROWS: readonly PickRow[] = [
  { klass: 'kind', label: 'Typ', source: 'axis', exclusive: true },
  { klass: 'phase', label: 'Phase', source: 'axis', exclusive: false },
  { klass: 'status', label: 'Zustand', source: 'axis', exclusive: true },
  // Zwei Schweregrade gleichzeitig sind keine Aussage, sondern deren Abwesenheit.
  { klass: 'severity', label: 'Schwere', source: 'registry', exclusive: true },
  // Eine Note darf zwei Bauteile berühren; das ist eher die Regel.
  { klass: 'component', label: 'Bauteil', source: 'registry', exclusive: false },
]

/** Die Zeile einer Klasse, oder undefined wenn sie nicht zur Auswahl steht. */
export function rowFor(klass: string): PickRow | undefined {
  return PICK_ROWS.find(r => r.klass === klass.toLowerCase())
}

/**
 * Ob eine Klasse nur einen Wert pro Note zulässt.
 *
 * Fasst die Achsen und die Auswahlzeilen zusammen, damit die Tatsache einmal
 * steht: `EXCLUSIVE_AXES` kennt `entity`, das nie zur Auswahl steht, und
 * PICK_ROWS kennt `severity`, das keine Achse ist.
 */
export function isExclusiveClass(klass: string): boolean {
  const lower = klass.toLowerCase()
  if ((EXCLUSIVE_AXES as readonly string[]).includes(lower)) return true
  return rowFor(lower)?.exclusive ?? false
}

/**
 * Einen Tag an- oder abwählen — die Bewegung hinter einem Klick.
 *
 * Bei einer ausschließenden Klasse **wechselt** die Auswahl, sie sammelt nicht.
 *
 * Geprüft wird nur, was der Code kennt: bei einer geschlossenen Achse muss der
 * Wert in ihrer Liste stehen. Bei einer Registry-Klasse bürgt der Aufrufer —
 * die Oberfläche bietet nur an, was in `.tags.json` steht, und eine zweite
 * Liste im Code wäre genau die Doppelung, die irgendwann auseinanderläuft.
 *
 * Tags anderer Klassen bleiben unangetastet.
 */
export function toggleTag(tags: readonly string[], tag: string): string[] {
  const parts = splitTag(tag)
  if (!parts) return [...tags]

  const closed = AXIS_VALUES[parts.axis as TagAxis]
  if (closed && !closed.includes(parts.value)) return [...tags]

  const normalized = `${parts.axis}:${parts.value}`
  if (tags.some(t => t.toLowerCase() === normalized)) {
    return tags.filter(t => t.toLowerCase() !== normalized)
  }

  const kept = isExclusiveClass(parts.axis)
    ? tags.filter(t => !t.toLowerCase().startsWith(`${parts.axis}:`))
    : [...tags]
  return [...kept, normalized]
}

/**
 * Kanonische Reihenfolge für Registry-Klassen, soweit es eine gibt.
 *
 * Nur `severity` hat eine: eine Skala, bei der die Reihenfolge eine Aussage ist.
 * Nach dem Umzug stand in `.tags.json` `low hi now mid` — das war die
 * Entstehungsgeschichte der Datei, und „now als höchste Stufe" war im
 * Auswahlfeld nicht zu sehen.
 *
 * `component` fehlt absichtlich: welche Bauteile zuerst kommen, entscheidet das
 * Projekt und nicht der Code.
 */
const CANONICAL_ORDER: Readonly<Record<string, readonly string[]>> = {
  severity: SEVERITY_VALUES,
}

/**
 * Die Werte einer Auswahlzeile in der Reihenfolge, in der sie stehen sollen.
 *
 * Werte, die der Code kennt, kommen in seiner Reihenfolge; alles darüber hinaus
 * hängt hinten an — sortiert, damit die Reihenfolge nicht von der Datei abhängt.
 * Editierbar heißt, dass ein eigener Wert nicht verschwindet, nur weil der Code
 * ihn nicht kennt.
 */
export function orderedValuesForRow(klass: string, values: readonly string[]): string[] {
  const canonical = CANONICAL_ORDER[klass.toLowerCase()]
  if (!canonical) return [...values]

  const present = new Set(values.map(v => v.toLowerCase()))
  const known = canonical.filter(v => present.has(v))
  const extra = values.filter(v => !canonical.includes(v.toLowerCase())).sort()
  return [...known, ...extra]
}
