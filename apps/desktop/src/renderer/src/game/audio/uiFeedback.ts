/**
 * **UI 反馈音**（2026-11-02 追加批）——全局按钮点击 → `ui-click`（节流/音量在播放层清单里）。
 *
 * 边界：
 * - 只认 `button` / `[role="button"]`（不铺 hover/普通文字点击，太吵）；
 * - **音效台内部不响**（避免「试听/导入」自身叠点击音）；
 * - 绝不抛错、不影响点击行为（捕获阶段旁听）。
 * 「操作被拒」的 `ui-error` 不在这里挂：走日志桥白名单（见 `rules.ts` 的 `LOG_CUE_RULES`）。
 */
import { playCue } from './player'

let installed = false

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
          playCue('ui-click')
        } catch {
          /* 忽略 */
        }
      },
      true,
    )
  } catch {
    /* 非浏览器环境忽略 */
  }
}
