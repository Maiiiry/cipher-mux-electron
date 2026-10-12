import type { RunnerRolle } from './runner'

/**
 * Ein lokaler Worker pro Workspace, gleich welche Rolle beauftragt (Spec
 * 2026-10-12 §4.5). `local-worker` ist singleInstance, und `startFreshWorker`
 * beendet jeden laufenden Worker — ohne diese Sperre schössen Factory und
 * Workshop sich gegenseitig den Worker ab. Es ist auch die Hardware: ein
 * lokales Modell, eine Aufgabe.
 */
export interface WorkerLock {
  /** null = geholt; sonst die Rolle, die ihn hält. */
  claim(ws: string, rolle: RunnerRolle): RunnerRolle | null
  release(ws: string, rolle: RunnerRolle): void
}

export function createWorkerLock(): WorkerLock {
  const held = new Map<string, RunnerRolle>()
  return {
    claim(ws, rolle) {
      const h = held.get(ws)
      if (h && h !== rolle) return h
      held.set(ws, rolle)
      return null
    },
    release(ws, rolle) {
      if (held.get(ws) === rolle) held.delete(ws)
    },
  }
}

/** Die eine Sperre des Prozesses. */
export const workerLock: WorkerLock = createWorkerLock()
