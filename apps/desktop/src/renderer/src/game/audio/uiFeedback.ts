/**
 * **UI 反馈音**（2026-11-02 追加批；2026-11-05 扩展 + 互斥）——
 * 全局按钮点击 → `ui-click`；界面错误提示（命令被拒 / 保存失败等 toast）→ `ui-error`。
 *
 * 边界：
 * - 点击音只认 `button` / `[role="button"]`（不铺 hover/普通文字点击，太吵）；
 * - **音效台内部不响**（避免「试听/导入」自身叠点击音）；
 * - 绝不抛错、不影响点击行为（捕获阶段旁听）。
 * - **`ui-error`（2026-11-05 船长要求扩大覆盖）**：不再只靠 `LOG_CUE_RULES` 的 6 条日志白名单，
 *   而是由 `App.showToast(text, warn=true)` 统一调用 `notifyUiError()`——所有命令被拒 / 错误提示都会响；
 *   日志白名单保留（读档等场景没有 toast 时仍能补一声），节流由播放层 `minGapMs` 兜住。
 * - **两音互斥（2026-11-05 船长反馈）**：点击按钮被拒时，`ui-click` 与 `ui-error` 几乎同时响会糊成一声。
 *   点击音改为**延后一拍**排入队列：等本次点击的 onClick（含它同步/微任务里弹的 toast）跑完，
 *   若这期间触发过错误提示，就只留错误音、不再补点击音。
 * - **按钮自带音效（2026-11-05 船长素材批）**：按钮写 `data-sfx="<语义 id>"`，点它时用该音效**替代**
 *   `ui-click`（同样的延后一拍 + 错误互斥：被拒时只留 `ui-error`）。用于交易所入金/出金/下注/买入/卖出。
 */
import { SFX_CUES, type SfxCueId } from './cues'
import { playCue } from './player'
import { shouldPlayClickCue } from './rules'

let installed = false
/** 最近一次错误提示音的触发时刻（`performance.now` 口径；`undefined` = 本次会话还没响过） */
let lastErrorAtMs: number | undefined

function nowMs(): number {
  try {
    return performance.now()
  } catch {
    return Date.now()
  }
}

/** 界面错误提示音（操作被拒/保存失败等 toast 统一入口；节流与音量在播放层处理） */
export function notifyUiError(): void {
  try {
    lastErrorAtMs = nowMs()
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
          // 按钮自带动作音（交易所下单/入金等）：替代点击音，仍走同一拍延后与错误互斥。
          const declared = button.getAttribute('data-sfx')
          const actionCue =
            declared !== null && Object.prototype.hasOwnProperty.call(SFX_CUES, declared) ? (declared as SfxCueId) : null
          const clickAtMs = nowMs()
          // 延后一拍再判断：本次点击若被拒并弹出错误提示，就只留 ui-error（见文件头「两音互斥」）
          setTimeout(() => {
            try {
              if (!shouldPlayClickCue(clickAtMs, lastErrorAtMs)) return
              playCue(actionCue ?? 'ui-click')
            } catch {
              /* 忽略 */
            }
          }, 0)
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
