# Local Workshop — der Claude-Alltag, Routine lokal ausgelagert

**Stand:** 2026-10-12 · Design abgestimmt im Gespräch (drei Abschnitte, jeweils bestätigt), noch nicht gebaut
**Baut auf:** `2026-10-09-local-cyber-factory-design.md` — derselbe Läufer, eine zweite Rolle davor.

## 1. Ziel

Eine Rolle für die tägliche Arbeit: Ideen aufnehmen, klären, planen, umsetzen — der normale
Claude-Code-Prozess (Brainstorming → Spec → Plan → Umsetzung). Der einzige Unterschied ist der
**Zuschnitt des Plans**: Routine-Tasks gehen an ein lokales Modell, Heikles macht Claude selbst.

Zwei Ziele, gleich gewichtet:

1. **Auslagern, was lokal gut läuft** — Kapazität für Routine nutzen, Claude-Kontingent sparen.
2. **Lernen, wie gut das lokale Modell ist** — mit einer ehrlichen Bilanz pro Auftrag.

Erfolgskriterium: Nach einigen Wochen Alltag zeigt die Bilanz pro Modell und Kategorie, was
lokal ohne Nachbesserung übernommen wurde — und der Zuschnitt der Rolle folgt dieser Zahl.

## 2. Abgrenzung zur Local Cyber Factory

| | Local Cyber Factory | Local Workshop |
|---|---|---|
| Wer codet | nur der Worker; Architekt gesperrt für `/src/`, `/lib/` | Worker für Routine, Claude für Heikles |
| Abnahmetest | Pflicht, vorher rot | wo er hingehört; sonst Testbefehl |
| Nach 2 roten Anläufen | eskaliert an den User | Claude übernimmt selbst |
| Zweck | Fließband, Autonomie | Alltag, Lernen |

Die Factory behält alles, was sie heute garantiert. Jede Erweiterung des Läufers ist so gebaut,
dass ihr Verhalten unverändert bleibt; ihre bestehenden Tests bleiben unangetastet grün.

Verworfen: **die Factory per Modus-Schalter lockern** (sie verlöre die Garantie, dass der
Architekt keinen Produktionscode schreibt) und **ohne Läufer** (Claude startet opencode direkt —
ohne Gate und ohne Messung, das Lernziel fiele weg).

## 3. Die Rolle

- **ID** `local-workshop`, Anzeigename **Local Workshop**, Claude Code, `singleInstance` pro
  Workspace, Start aus dem Launcher wie jede Rolle.
- **Keine Schreibgrenze** — kein Eintrag in `entity-boundaries.ts`. Das Heikle macht sie selbst.
- Vorlage in Code (`generateLocalWorkshopPreset`), Versionsmarker `<!-- local-workshop-v1 -->`,
  aufgenommen in `PRESET_TEMPLATES`, damit ein Rückstand der write-once-`preset.md` sichtbar wird.

### Ablauf (steht so im Rollentext)

1. **Verstehen** — Brainstorming, Fragen klären. Kleines bleibt im Chat, Größeres bekommt eine
   Spec unter `docs/superpowers/specs/`.
2. **Plan mit Zuschnitt** — jeder Task trägt ein Etikett:
   - **lokal**: Routine. Klares Ziel, wenige Dateien, keine Designentscheidung. Typisch: Tests
     nach Vorlage, Boilerplate, Umbenennung, Doku, kleine UI-Anpassung, Datenabbildung, ein Feld
     mehr.
   - **selbst**: Urteil gefragt. Architektur, Sicherheit, Datenmigration, knifflige Fehlersuche,
     alles in den fragilen Zonen des Projekts.
   Der User sieht den Plan mit Etiketten, bevor es losgeht, und kann Tasks umhängen.
3. **Spiegeln** — Spec und Plan werden als Notes gespiegelt (`mux_mirror_sync`), damit der User
   sie in den Notes liest; Drift zwischen Datei und Note wird angezeigt.
4. **Abarbeiten** — selbst-Tasks direkt. Vor jedem Dispatch ist der eigene Stand committet (der
   Läufer verlangt einen sauberen Baum). lokal-Tasks per Dispatch, dann warten ohne Polling, bis
   die Weckzeile kommt.
5. **Durchsicht** — bei Grün den Commit lesen und entscheiden: **übernommen**, **nachgebessert**
   (Claude korrigiert selbst), **neu geschnitten** (kleiner, präziser, neuer Anlauf). Nach zwei
   roten Anläufen: **selbst übernommen**.
6. **Urteil eintragen** — bei der Abnahme Ergebnis, Kategorie und eine Zeile Notiz (siehe §5).

### Lernkreis

Beim Start liest die Rolle die Note **„Local Workshop: Bilanz“** (§5) und schneidet danach zu:
Was ein Modell in einer Kategorie verlässlich schafft, wird lokal; woran es wiederholt scheitert,
wird selbst. Dieselbe Note sieht der User — eine Quelle für beide.

### Modellwahl

Standard ist das Default-Profil (§4.4). Ein anderes Profil nur, wenn der User es sagt („heute
vergleichen wir mit gemma") — sonst wird die Bilanz ein Durcheinander.

## 4. Was der Läufer dazulernt

### 4.1 Freigabe

`mayUseLocalWorkerDispatch` erlaubt `local-factory` **und** `local-workshop`, keine andere Rolle,
keine Verbindung ohne Rolle (unverändert). Ein Läufer pro **Workspace × Rolle**; das
Laufverzeichnis liegt unter `runs/<ws>/<rolle>/laeufe/`. Die Läufe der Rollen vermischen sich nicht.

### 4.2 Weckzeile an den Auftraggeber

Heute sucht `wakeArchitect` fest nach `local-factory`. Künftig kennt der Läufer seine Rolle und
weckt deren Session. Fehlt sie, bleibt es beim Log-Eintrag wie heute — das Ergebnis steht
vollständig in `lauf.json` und in der Bilanz. Der Präfix der Weckzeile ist der Rollenname
(`[local-workshop] …`), damit eine Zeile nie für die falsche Rolle gelesen wird.

### 4.3 Abnahmetest optional

- **Mit Test** (`geschuetzteTests` nicht leer): wie heute — vorher rot, geschützt, nachher grün.
- **Ohne Test** (`geschuetzteTests` leer): keine Rot-Prüfung vorab. **`testBefehl` bleibt
  Pflicht** (mindestens Typecheck oder Suite) — ein Grün ohne Prüfung wäre keine Aussage.
  Gilt nur für `local-workshop`; die Factory lehnt einen leeren `geschuetzteTests` weiter ab.

### 4.4 Modellprofile

Neues Config-Feld `agent.localWorkerProfiles: Record<string, LocalWorkerConfig>` plus
`agent.localWorkerDefaultProfile: string`. Das bestehende `agent.localWorker` bleibt gültig und
gilt als Profil `default`, solange keine Profile eingetragen sind — bestehende Configs laufen
unverändert. Ein Dispatch nennt optional `profil`; ein unbekannter Name wird abgelehnt (kein
Versuch gezählt), freie Modellnamen gibt es nicht. Das Profil reist mit dem Sessionstart des
Workers in den opencode-Adapter, der daraus `provider` und `model` baut (heute aus
`agent.localWorker`). Die Bereitschaftsprobe prüft den Endpunkt **des gewählten Profils**.

### 4.5 Ein Worker zur Zeit

`local-worker` ist `singleInstance`, und `startFreshWorker` beendet jeden laufenden Worker im
Workspace. Laufen Factory und Workshop im selben Workspace, würden sie sich gegenseitig den Worker
abschießen. Deshalb: ein Dispatch, während ein Worker der anderen Rolle läuft, antwortet mit
**„nicht bereit: Worker belegt durch <rolle>"**, kein Versuch gezählt. Das passt auch zur
Hardware — ein lokales Modell, eine Aufgabe.

### 4.6 Nach zwei roten Anläufen

Die Grenze bleibt. Die Weckzeile endet beim Workshop auf **„— ausgeschöpft, selbst übernehmen"**
statt „ESKALIERT, an den User melden".

### 4.7 Modell nicht erreichbar

Wie heute „nicht bereit", kein Versuch gezählt. Die Rolle sagt es dem User einmal und macht
selbst weiter oder nimmt ein anderes Profil, wenn der User das so vorgegeben hat. Fall aus der
Praxis: der DGX trainiert Stimmen.

## 5. Die Bilanz

**Ort:** `~/.config/cipher-mux/entities/local-workshop/bilanz.jsonl`, eine Zeile pro
abgeschlossenem Auftrag, **workspace-übergreifend** — wie gut ein Modell Routine schafft, hängt
nicht am Workspace.

**Felder — gemessen vom Läufer:** `ts`, `projekt`, `workspaceId`, `profil`, `modell`,
`mitTest`, `anlaeufe`, `dauerSek`, `dateien` (Anzahl), `diffZeilen`, `workerTokens` (wenn opencode
sie gemeldet hat, sonst `null`), `laufId`, `haeppchen`.

**Felder — Urteil von Claude bei der Abnahme:** `ergebnis` ∈ {`uebernommen`, `nachgebessert`,
`neu-geschnitten`, `selbst-uebernommen`}, `kategorie` ∈ {`test`, `boilerplate`, `refactor`,
`doku`, `ui`, `config`, `logik`}, `notiz` (eine Zeile, Pflicht bei `nachgebessert`).

Die Abnahme (`accept`) nimmt dafür bei `local-workshop` die drei Urteilsfelder an; ohne sie wird
sie abgelehnt. `neu-geschnitten` und `selbst-uebernommen` gelten auch für rote oder ausgeschöpfte
Häppchen — `accept` heißt hier „Urteil abgeben", nicht nur „grün abnehmen". Die Factory bleibt
beim heutigen `accept`. „Nicht bereit" erzeugt **keinen** Eintrag: dort hat kein Modell gearbeitet.

**Note „Local Workshop: Bilanz"** (`kind:reference`, `entity:local-workshop`), bei jedem
Eintrag neu geschrieben, aus der jsonl abgeleitet:

- Tabelle **Modell × Kategorie**: Aufträge, davon ohne Nachbesserung übernommen, Anläufe im Schnitt.
- Die letzten zehn Notizen zu Nachbesserungen — daraus lernt man am meisten.

Bewusst nicht in v1: eine eigene Ansicht mit Diagrammen. Erst wenn klar ist, welche Fragen an die
Daten wirklich gestellt werden.

## 6. Das Mac-Profil

Der Mac Mini (64 GB) betreibt Ollama auf `127.0.0.1:11433`. Die DGX-Gewichte (FP8, NVFP4) sind
NVIDIA-Formate und auf dem Mac nicht nutzbar; das Mac-Profil braucht eine eigene Fassung.
**Welche, entscheidet der User** — auf dem Mac läuft nach seiner Erfahrung eine andere Variante
besser als die des DGX.

Falle, die beim Einrichten zu prüfen ist: Ollama gibt über die OpenAI-Schnittstelle nur ein
kleines Kontextfenster, opencode braucht allein ~15 k Tokens Grundlast. Die Mac-Fassung bekommt
deshalb eine eigene Modelldatei mit großem `num_ctx` (neben den bestehenden, keine wird
geändert). Nachweis: ein Auftrag mit > 20 k Tokens Kontext läuft durch, statt still zu enden.

## 7. Tests und Abnahme

1. **Unit-Tests** für jede Läufer-Erweiterung: Weckzeile an die richtige Rolle und mit deren
   Präfix; Auftrag ohne Test geht durch, ohne Testbefehl nicht, bei der Factory nie; unbekanntes
   Profil abgelehnt, ohne Versuch; Worker belegt → nicht bereit, ohne Versuch; Abnahme ohne
   Urteil abgelehnt; Bilanz-Zeile vollständig; Note-Tabelle richtig gezählt; Config ohne Profile
   verhält sich wie heute. Die bestehenden Local-Factory-Tests bleiben unverändert grün.
2. **Rollentext:** in `role-templates-render-clean` und `role-templates-name-real-tools`
   aufgenommen (keine maskierten Backticks, nur echte Werkzeuge, kein Companion-Memory).
3. **Echte Abnahme am Mac-Profil**, nicht gegen eine Attrappe: Rolle aus dem Launcher starten,
   einen kleinen Plan zuschneiden, einen lokal-Task dispatchen, geweckt werden, Urteil abgeben;
   der Eintrag steht in `bilanz.jsonl` und in der Note. Bei der Factory haben genau solche Läufe
   die stillen Fehler gefunden.
4. **Ein offener Testcase** für den User in der Testcase-Note: im Alltag benutzen, abhaken. Wird
   nicht vom Bauenden abgehakt.

## 8. Nicht in v1

- Parallele Worker (ein lokales Modell, eine Aufgabe).
- Automatischer Modellvergleich (derselbe Task an zwei Profile).
- Eigene Bilanz-Ansicht in der App.
- Zuschnitt automatisch aus der Bilanz ableiten — die Rolle liest sie, entscheidet aber selbst.
