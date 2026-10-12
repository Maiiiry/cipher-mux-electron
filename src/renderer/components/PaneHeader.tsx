import { useTranslation } from 'react-i18next'
import type { AdapterCapabilities, EntityId } from '../../shared/types'

interface PaneHeaderProps {
  sessionName: string
  contextUsage?: number // 0–100 percentage
  capabilities?: AdapterCapabilities
  entityId?: EntityId
  voiceState?: string   // idle | ready | user_speaking | recording | processing | agent_speaking
  isSpeaking?: boolean  // true when TTS audio is playing in renderer
  /**
   * Workspace name to show as a badge. The badge is a deviation signal, not
   * decoration — pass null/undefined to hide it. Callers compute this with
   * `computeWorkspaceBadge` (src/shared/workspace-badge.ts): null when the
   * session sits in the active workspace, or is unbound with no workspace
   * active; otherwise the resolved workspace name (or a "(deleted)" label).
   */
  workspaceBadge?: string | null
}

/** Entity color mapping — references CSS custom properties from themes.json. */
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

function contextColorClass(pct: number): string {
  if (pct > 80) return 'text-ctx-error'
  if (pct >= 60) return 'text-ctx-warn'
  return 'text-accent'
}

/** Voice status dot class based on voice state. Returns empty string if not active. */
function voiceDotClass(voiceState: string | undefined, isSpeaking: boolean | undefined): string {
  if (isSpeaking) return 'voice-dot voice-dot--speaking'
  if (voiceState === 'user_speaking' || voiceState === 'recording') return 'voice-dot voice-dot--listening'
  if (voiceState === 'processing') return 'voice-dot voice-dot--processing'
  if (voiceState === 'ready') return 'voice-dot voice-dot--idle'
  return ''
}

/** Tooltip text for voice status dot. */
function voiceTooltip(voiceState: string | undefined, isSpeaking: boolean | undefined): string {
  if (isSpeaking) return 'Voice: Speaking'
  if (voiceState === 'user_speaking' || voiceState === 'recording') return 'Voice: Listening'
  if (voiceState === 'processing') return 'Voice: Processing'
  if (voiceState === 'ready') return 'Voice: Idle'
  return ''
}

export function PaneHeader({ sessionName, contextUsage, capabilities, entityId, voiceState, isSpeaking, workspaceBadge }: PaneHeaderProps) {
  const { t } = useTranslation()
  const showContextUsage = capabilities?.['status-line'] !== false
  const entityColor = entityId ? ENTITY_COLORS[entityId] : undefined
  const dotClass = voiceDotClass(voiceState, isSpeaking)
  const voiceActive = voiceState != null && voiceState !== 'idle' && voiceState !== 'error'
  return (
    <div class="tab-bar" style={entityColor ? { borderLeft: `3px solid ${entityColor}` } : undefined}>
      <div class="tab-bar__tab tab-bar__tab--active">
        {entityColor
          ? <span class="neon-dot" style={{ background: entityColor, boxShadow: `0 0 4px ${entityColor}` }} />
          : <span class="neon-dot neon-dot--ok" />}
        <span>{sessionName}</span>
        {voiceActive && dotClass && (
          <span class={dotClass} title={voiceTooltip(voiceState, isSpeaking)} aria-hidden="true" />
        )}
        {workspaceBadge && (
          <span class="pane-header__ws-badge" title={t('unified.workspaceBadgeTitle', { name: workspaceBadge })}>
            {workspaceBadge}
          </span>
        )}
      </div>
      <div style={{ flex: 1 }} />
      {showContextUsage && contextUsage != null && (
        <div
          class="tab-bar__tab"
          style={{ cursor: 'default', borderRight: 'none' }}
        >
          <span class={`text-xs ${contextColorClass(contextUsage)}`}>
            CTX {contextUsage}%
          </span>
        </div>
      )}
      {!showContextUsage && (
        <div
          class="tab-bar__tab"
          style={{ cursor: 'default', borderRight: 'none' }}
        >
          <span class="text-xs text-muted">CTX —</span>
        </div>
      )}
    </div>
  )
}
