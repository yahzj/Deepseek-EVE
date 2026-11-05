/**
 * **UI 反馈音**（2026-11-02 追加批；2026-11-05 扩展）——
 * 全局按钮点击 → `ui-click`；界面错误提示（命令被拒 / 保存失败等 toast）→ `ui-error`。
 *
 * 边界：
 * - 点击音只认 `button` / `[role="button"]`（不铺 hover/普通文字点击，太吵）；
 * - **音效台内部不响**（避免「试听/导入」自身叠点击音）；
 * - 绝不抛错、不影响点击行为（捕获阶段旁听）。
 * - **`ui-error`（2026-11-05 船长要求扩大覆盖）**：不再只靠 `LOG_CUE_RULES` 的 6 条日志白名单，
 *   而是由 `App.showToast(text, warn=true)` 统一调用 `notifyUiError()`——所有命令被拒 / 错误提示都会响；
 *   日志白名单保留（读档等场景没有 toast 时仍能补一声），节流由播放层 `minGapMs` 兜住。
 */
import { playCue } from './player'

let installed = false

/** 界面错误提示音（操作被拒/保存失败等 toast 统一入口；节流与音量在播放层处理） */
export function notifyUiError(): void {
  try {
    playCue('ui-error')
  } catch {
    /* 忽略 */
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
