// src/renderer/components/SessionCell.tsx
import { useTranslation } from 'react-i18next'
import { useCallback } from 'preact/hooks'
import { useTerminal } from '../hooks/useTerminal'
import type { SessionInfo, ContextUsage, EntityId } from '../../shared/types'
import type { ThemeName } from '../../shared/grid-types'
import {
  X, ArrowLeftRight, GitBranch, ChevronDown, ChevronUp,
  Terminal, Camera, Scan, ArrowUpFromLine, ExternalLink, Check, XCircle, Pause, Loader,
} from 'lucide-preact'

const ICON_SIZE = 14

/** Status icon next to session status dot (REQ-A11Y-002) */
function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'active': return <span class="status-icon" aria-hidden="true" title="Aktiv"><Check size={10} /></span>
    case 'closing': return <span class="status-icon" aria-hidden="true" title="Wird beendet"><Loader size={10} class="status-icon--spin" /></span>
    case 'error': return <span class="status-icon" aria-hidden="true" title="Fehler"><XCircle size={10} /></span>
    case 'paused': return <span class="status-icon" aria-hidden="true" title="Pausiert"><Pause size={10} /></span>
    default: return null
  }
}

/** Voice status text label (REQ-A11Y-002) */
function VoiceStatusLabel({ voiceState, isSpeaking }: { voiceState: string; isSpeaking: boolean }) {
  if (isSpeaking) return <span class="voice-status-label">Spricht...</span>
  switch (voiceState) {
    case 'user_speaking':
    case 'recording': return <span class="voice-status-label">Hoert zu...</span>
    case 'processing': return <span class="voice-status-label">Verarbeitet...</span>
    default: return null
  }
}

interface SessionCellProps {
  session: SessionInfo
  contextUsage?: ContextUsage
  focused: boolean
  isWorkshop: boolean
  isVoiceTarget: boolean
  isVoicePinned: boolean
  voiceState: string
  isSpeaking: boolean
  onToggleVoicePin: (sessionId: string) => void
  theme: ThemeName
  rowSpan: number
  maxRows: number
  slotCol?: number
  slotRow?: number
  focusModeStyle?: Record<string, string>
  /**
   * Nicht sichtbar, aber am Leben.
   *
   * Focus Mode und der Zellen-Merge verdecken Slots. Bis zum 2026-10-01 gab
   * `SessionGrid` fuer so einen Slot `null` zurueck — die Zelle unmountete, und
   * mit ihr starb das Terminal der verdeckten Session: beim Zurueckkommen ein
   * `capture-pane`-Rekonstrukt ohne Scrollback. Die Session selbst lief
   * weiter, tmux haelt sie; verloren ging nur ihre Darstellung.
   *
   * `display: none` nimmt die Zelle aus dem Grid-Fluss, ohne sie abzureissen.
   * Der Min-Size-Guard in `useTerminal` (50 px) laesst ein `fit()` auf einem
   * Container ohne Flaeche gar nicht erst laufen, und der ResizeObserver meldet
   * sich beim Wiederauftauchen von selbst.
   */
  hidden?: boolean
  onFocus: (sessionId: string) => void
  onClose: (sessionId: string) => void
  onSwitchProject: (sessionId: string) => void
  onToggleExpand: (sessionId: string) => void
  onShell: (sessionId: string, projectPath: string | null) => void
  onFork: (sessionId: string) => void
  onSendToBackground: (sessionId: string) => void
  onDetach?: (sessionId: string) => void
  onFocusMode?: (sessionId: string) => void
  onDragStart: (sessionId: string) => void
  onDragOver: (e: DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: DragEvent) => void
  dragOver?: boolean
  topic?: string
  /** Precomputed, already-localized workspace badge text; null/undefined hides it. */
  workspaceBadge?: string | null
  /** Tooltip for the badge — the global case needs a different sentence than a workspace name. */
  workspaceBadgeTitle?: string
}

export function SessionCell({
  session, contextUsage, focused, isWorkshop, isVoiceTarget, isVoicePinned, voiceState, isSpeaking, onToggleVoicePin, theme,
  rowSpan, maxRows, slotCol, slotRow, focusModeStyle, hidden,
  onFocus, onClose, onSwitchProject, onToggleExpand, onShell, onFork, onSendToBackground, onDetach, onFocusMode, onDragStart, onDragOver, onDragLeave, onDrop, dragOver,
  topic, workspaceBadge, workspaceBadgeTitle,
}: SessionCellProps) {
  const { t } = useTranslation()
  const { terminalRef } = useTerminal(session.id, theme, session.createdAt)
  const pct = contextUsage?.usedPercentage ?? 0

  const handleClick = useCallback(() => onFocus(session.id), [session.id, onFocus])
  const handleClose = useCallback((e: Event) => {
    e.stopPropagation()
    onClose(session.id)
  }, [session.id, onClose])
  const handleSwitch = useCallback((e: Event) => {
    e.stopPropagation()
    onSwitchProject(session.id)
  }, [session.id, onSwitchProject])
  const handleExpand = useCallback((e: Event) => {
    e.stopPropagation()
    onToggleExpand(session.id)
  }, [session.id, onToggleExpand])
  const handleShell = useCallback((e: Event) => {
    e.stopPropagation()
    onShell(session.id, session.projectPath)
  }, [session.id, session.projectPath, onShell])
  const handleFork = useCallback((e: Event) => {
    e.stopPropagation()
    onFork(session.id)
  }, [session.id, onFork])
  const handleSendToBackground = useCallback((e: Event) => {
    e.stopPropagation()
    onSendToBackground(session.id)
  }, [session.id, onSendToBackground])
  const handleDetach = useCallback((e: Event) => {
    e.stopPropagation()
    onDetach?.(session.id)
  }, [session.id, onDetach])
  const handleVoicePin = useCallback((e: Event) => {
    e.stopPropagation()
    onToggleVoicePin(session.id)
  }, [session.id, onToggleVoicePin])
  const handleFocusMode = useCallback((e: Event) => {
    e.stopPropagation()
    onFocusMode?.(session.id)
  }, [session.id, onFocusMode])
  const handleScreenshot = useCallback(async (e: Event) => {
    e.stopPropagation()
    const api = window.cipherMux
    const result = await api?.sessions?.screenshot?.(session.id)
    if (result?.path) {
      await navigator.clipboard.writeText(result.path).catch(() => {})
    }
  }, [session.id])

  // Fork haengt daran, dass die Session-ID der CLI bekannt ist — und die
  // liefert der Statusline-Pfad. Deshalb `status-line` als Bedingung, nicht als
  // Stellvertreter fuer „ist Claude Code": seit v0.10.0 melden Codex und
  // opencode dieselbe Faehigkeit, und beide koennen forken (`codex fork`,
  // `opencode --fork`). Der alte Name behauptete eine CLI, gemeint war die
  // Voraussetzung.
  const canFork = session.capabilities?.['status-line'] === true

  const dotClass = pct >= 85 ? 'neon-dot--error' : pct >= 60 ? 'neon-dot--warn' : 'neon-dot--ok'

  // Context bar: color based on breakpoints, width scaled so 65% displayed = full bar
  const barWidth = Math.min((pct / 65) * 100, 100)
  const barColor = pct >= 56 ? '#e53935' : pct >= 41 ? '#fb8c00' : pct >= 26 ? '#fdd835' : '#43a047'

  // Entity color mapping — references CSS custom properties from themes.json
  const ENTITY_COLORS: Record<EntityId, string> = {
    workshop: 'var(--entity-color-1, #4fc3f7)',
    'cyber-factory': 'var(--entity-color-2, #ab47bc)',
    companion: 'var(--entity-color-3, #ffb74d)',
    refinement: 'var(--entity-color-4, #ef5350)',
    launcher: 'var(--entity-color-5, #66bb6a)',
    'voice-relay': 'var(--entity-color-6, #9b59b6)',
    audit: 'var(--entity-color-7, #c0392b)',
    'ideation-partner': 'var(--entity-color-8, #26a69a)',
    debugger: 'var(--entity-color-9, #ff7043)',
    'testing-assistant': 'var(--entity-color-10, #2ecc71)',
    bugreport: 'var(--entity-color-11, #78909c)',
    'local-factory': '#8e24aa',
    'local-worker': '#6d4c41',
    'local-workshop': '#00897b',
  }
  const entityColor = session.entityId ? ENTITY_COLORS[session.entityId] : undefined
  const isEntity = !!session.entityId

  // Voice status indicator — only shown when this session is the voice target
  const voiceActive = isVoiceTarget && voiceState !== 'idle'
  const voiceDotClass = isSpeaking
    ? 'voice-dot voice-dot--speaking'
    : voiceState === 'user_speaking' || voiceState === 'recording'
      ? 'voice-dot voice-dot--listening'
      : voiceState === 'processing'
        ? 'voice-dot voice-dot--processing'
        : voiceState === 'ready'
          ? 'voice-dot voice-dot--idle'
          : ''
  const voiceDotTitle = isSpeaking
    ? 'Voice: Speaking'
    : voiceState === 'user_speaking' || voiceState === 'recording'
      ? 'Voice: Listening'
      : voiceState === 'processing'
        ? 'Voice: Processing'
        : voiceState === 'ready'
          ? 'Voice: Idle'
          : ''

  const isFocusMode = !!focusModeStyle
  const cellClass = [
    'session-cell',
    focused && 'session-cell--focused',
    (isWorkshop || isEntity) && 'session-cell--workshop',
    dragOver && 'session-cell--drag-over',
    isFocusMode && 'session-cell--focus-mode',
  ].filter(Boolean).join(' ')

  const isAtMax = rowSpan >= maxRows
  const cellStyle: Record<string, string | number> = {}
  if (isFocusMode && focusModeStyle) {
    Object.assign(cellStyle, focusModeStyle)
  } else if (rowSpan > 1) {
    cellStyle.gridRow = `span ${rowSpan}`
  }
  // Zuletzt und ohne Ausnahme: eine verdeckte Zelle darf keinen Platz im Grid
  // belegen, auch nicht den, den ihr rowSpan oder Focus Mode zuweisen wuerde.
  if (hidden) cellStyle.display = 'none'

  // ARIA label for the grid cell (REQ-A11Y-007)
  const ariaLabel = `Session: ${session.name}, Status: ${session.status}, Context: ${pct}%`

  return (
    <div
      class={cellClass}
      style={cellStyle}
      onClick={handleClick}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      data-highlight={slotCol != null && slotRow != null ? `cell-${slotCol}-${slotRow}` : undefined}
      role="region"
      aria-label={ariaLabel}
      // `display: none` nimmt den Knoten schon aus dem Accessibility-Tree; das
      // hier ist die ausdrueckliche Aussage dazu, damit niemand es fuer ein
      // Versehen haelt.
      aria-hidden={hidden ? 'true' : undefined}
    >
      <div
        class="cell-header"
        draggable
        onDragStart={() => onDragStart(session.id)}
        style={entityColor ? { borderLeft: `3px solid ${entityColor}` } : undefined}
        data-highlight={slotCol != null && slotRow != null ? `cell-head-${slotCol}-${slotRow}` : undefined}
      >
        {pct > 0 && (
          <div
            class="cell-header__ctx-bar"
            style={{ width: `${barWidth}%`, backgroundColor: barColor }}
            role="meter"
            aria-label={`Context-Nutzung: ${pct}%`}
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        )}
        <div class="cell-header__left">
          {entityColor
            ? <span class="neon-dot" style={{ background: entityColor, boxShadow: `0 0 4px ${entityColor}` }} aria-hidden="true" />
            : <span class={`neon-dot ${dotClass}`} aria-hidden="true" />}
          <StatusIcon status={session.status} />
          <span class="cell-name" title={topic || undefined}>{session.name}</span>
          {workspaceBadge && (
            <span
              class="cell-header__ws-badge"
              title={workspaceBadgeTitle ?? t('unified.workspaceBadgeTitle', { name: workspaceBadge })}
            >
              {workspaceBadge}
            </span>
          )}
          {voiceActive && <span class={voiceDotClass} title={voiceDotTitle} aria-hidden="true" />}
          {isVoiceTarget && voiceActive && (
            <VoiceStatusLabel voiceState={voiceState} isSpeaking={isSpeaking} />
          )}
          {isVoiceTarget && (
            <button
              class={`cell-btn voice-target-btn${isVoicePinned ? ' voice-target-btn--pinned' : ''}`}
              onClick={handleVoicePin}
              title={isVoicePinned ? t('sessionCell.unpinVoice') : t('sessionCell.pinVoice')}
              aria-label={isVoicePinned ? t('sessionCell.unpinVoice') : t('sessionCell.pinVoice')}
            >
              &#x25C9;
            </button>
          )}
        </div>
        <div class="cell-header__right">
          {onFocusMode && (
            <button
              class="cell-btn"
              onClick={handleFocusMode}
              title="Focus Mode (Cmd+Shift+F)"
              aria-label="Focus Mode aktivieren"
            ><Scan size={ICON_SIZE} /></button>
          )}
          {maxRows > 1 && (
            <button
              class={`cell-btn ${isAtMax ? 'cell-btn--active' : ''}`}
              onClick={handleExpand}
              title={isAtMax ? t('sessionCell.collapseHeight') : t('sessionCell.expandHeight')}
              aria-label={isAtMax ? t('sessionCell.collapseHeight') : t('sessionCell.expandHeight')}
            >{isAtMax ? <ChevronUp size={ICON_SIZE} /> : <ChevronDown size={ICON_SIZE} />}</button>
          )}
          {canFork && (
            <button class="cell-btn" onClick={handleFork} title={t('sessionCell.forkSession')} aria-label={t('sessionCell.forkSession')}><GitBranch size={ICON_SIZE} /></button>
          )}
          <button class="cell-btn" onClick={handleScreenshot} title={t('sessionCell.screenshot', 'Screenshot')} aria-label="Screenshot"><Camera size={ICON_SIZE} /></button>
          <button class="cell-btn" onClick={handleSwitch} title={t('sessionCell.switchProject')} aria-label={t('sessionCell.switchProject')}><ArrowLeftRight size={ICON_SIZE} /></button>
          <button class="cell-btn" onClick={handleSendToBackground} title={t('sessionCell.sendToBackground')} aria-label={t('sessionCell.sendToBackground')}><ArrowUpFromLine size={ICON_SIZE} /></button>
          <button class="cell-btn" onClick={handleShell} title={t('sessionCell.openShell')} aria-label={t('sessionCell.openShell')}><Terminal size={ICON_SIZE} /></button>
          {onDetach && (
            <button class="cell-btn" onClick={handleDetach} title={t('sessionCell.detach', 'Pop Out')} aria-label={t('sessionCell.detach', 'Pop Out')}><ExternalLink size={ICON_SIZE} /></button>
          )}
          <button class="cell-btn" onClick={handleClose} title={t('sessionCell.closeSession')} aria-label={t('sessionCell.closeSession')} disabled={session.status === 'closing'}><X size={ICON_SIZE} /></button>
        </div>
      </div>
      <div class="cell-terminal" ref={terminalRef} role="application" aria-label={`Terminal: ${session.name}`} />
      {session.status === 'closing' && (
        <div class="cell-closing-overlay" role="status" aria-live="polite">
          <span class="workspace-loading-spinner" />
          <span>{t('sessionCell.closing', 'Session wird beendet...')}</span>
        </div>
      )}
    </div>
  )
}
