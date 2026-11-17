import type { SfxCueId } from './cues'
import { playCue } from './player'
import { clickCueFor, shouldPlayClickCue } from './rules'

let installed = false
let lastErrorAtMs: number | undefined
let lastActionAtMs: number | undefined

function nowMs(): number {
  try {
    return performance.now()
  } catch {
    return Date.now()
  }
}

export function notifyUiError(): void {
  try {
    lastErrorAtMs = nowMs()
    playCue('ui-error')
  } catch {
  }
}

export function notifyUiAction(cue: SfxCueId): void {
  try {
    lastActionAtMs = nowMs()
    playCue(cue)
  } catch {
  }
}

export function installUiSfx(): void {
  try {
    if (installed || typeof document === 'undefined') return
    installed = true
    document.addEventListener(
      'click',
      (event) => {
        try {
          const target = event.target
          if (!(target instanceof Element)) return
          const button = target.closest('button, [role="button"]')
          if (button === null) return
          if (button.closest('.app-sfx-modal') !== null) return
          const cue = clickCueFor(button.getAttribute('data-sfx'), button.getAttribute('data-sfx-on') === 'success')
          if (cue === null) return
          const clickAtMs = nowMs()
          setTimeout(() => {
            try {
              if (!shouldPlayClickCue(clickAtMs, lastErrorAtMs, lastActionAtMs)) return
              playCue(cue)
            } catch {
            }
          }, 0)
        } catch {
        }
      },
      true,
    )
  } catch {
  }
}
