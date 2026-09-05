/**
 * 重要任务 · 序章/贯穿（2026-09-05 船长拍板规则更新）：
 * - 教程任务卡（补给协议/试炼）只在“进行中”展示——**已完成即隐藏**；
 * - 教程完成(含跳过)后发布贯穿任务「寻找人类」：正常发布、不告诉做法、确实无法完成；
 * - 显示范围：教程相关卡在步骤 2..6 且未完成时出现；「寻找人类」教程结束后常驻。
 */
import {
  TASK_FIND_HUMANS,
  TASK_ORE_DELIVER,
  TASK_TRIAL_WIN,
  TUTORIAL_DELIVER_ITEM,
  TUTORIAL_DELIVER_N,
} from '@whale/core'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'

export function ImportantTasks({ engine, onToast }: { engine: GameEngine; onToast: ToastFn }) {
  const state = engine.state
  const oreDone = state.importantTasks[TASK_ORE_DELIVER]?.done === true
  const trialDone = state.importantTasks[TASK_TRIAL_WIN]?.done === true
  const findHumanOn = state.importantTasks[TASK_FIND_HUMANS] !== undefined && state.importantTasks[TASK_FIND_HUMANS]!.done !== true
  const oreName = engine.ctx.items.get(TUTORIAL_DELIVER_ITEM)?.name ?? TUTORIAL_DELIVER_ITEM
  const have = state.warehouse.items[TUTORIAL_DELIVER_ITEM] ?? 0
  const step = state.onboarding.step
  // 已完成的任务隐藏（船长 2026-09-05）；教程卡仅在对应步骤窗口且未完成时出现
  const showOre = !oreDone && step >= 2 && step <= 6
  const showTrial = !trialDone && step >= 4 && step <= 6

  const deliver = (): void => {
    const r = engine.deliverTutorialOreAt()
    if (r.ok) {
      onToast('交付完成：+4,000 ISK、基础 AI 核心 ×1。')
    } else {
      onToast(r.error ?? '交付失败', true)
    }
  }

  return (
    <div className="app-imp-quests">
      {showOre ? (
        <div className="app-imp-card">
          <div className="app-imp-card-title">◆ 补给协议·首批矿物</div>
          <div className="app-imp-card-body">
            向任务中心交付 {oreName} ×{TUTORIAL_DELIVER_N}（仓库现有 {have}）——维持隐秘泊位的临时修复储备。
          </div>
          <button
            className="app-btn is-small is-primary"
            disabled={have < TUTORIAL_DELIVER_N}
            onClick={deliver}
            title={have < TUTORIAL_DELIVER_N ? '仓库矿石不足——先回港把采集的矿石卸入仓库' : undefined}
          >
            交付矿石（{Math.min(have, TUTORIAL_DELIVER_N)}/{TUTORIAL_DELIVER_N}）
          </button>
        </div>
      ) : null}
      {showTrial ? (
        <div className="app-imp-card">
          <div className="app-imp-card-title">◆ 试炼·演习场讨伐令</div>
          <div className="app-imp-card-body">
            前往「战斗悬赏」接取母港的演习场讨伐令并取胜（教学战内你的命中/回避有加成）。完成后发放：轻型炮台 MK1 ×1、动能弹 ×120。
          </div>
        </div>
      ) : null}
      {findHumanOn ? (
        <div className="app-imp-card is-perm">
          <div className="app-imp-card-title">◆ 寻找人类</div>
          <div className="app-imp-card-body">
            人类已全体失踪——你是一艘前人类时代的舰船 AI。目前没有任何可执行线索，完成方法未知；在这座章鱼宇宙人统治的母港继续航行，或许终会有所发现。
          </div>
          <div className="app-imp-card-state">状态：进行中 · 完成方法未知</div>
        </div>
      ) : null}
    </div>
  )
}
