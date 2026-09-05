/**
 * 重要任务 · 序章（2026-09-05 船长拍板）——任务中心「重要任务」分类内的教程任务卡：
 * ① 补给协议·首批矿物（可交付：仓库富凡晶石 ≥20 后点交付 → 4,000 ISK + 基础 AI 核心）；
 * ② 试炼·演习场讨伐令（追踪卡：教学战取胜后自动完成并发放炮台+动能弹 120）。
 * 「寻找人类」不建卡：目标档案写入手册·航行须知。
 */
import {
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
  const oreName = engine.ctx.items.get(TUTORIAL_DELIVER_ITEM)?.name ?? TUTORIAL_DELIVER_ITEM
  const have = state.warehouse.items[TUTORIAL_DELIVER_ITEM] ?? 0
  const step = state.onboarding.step
  // 教程相关任务只在“序章·苏醒”语境出现：步骤 ≥2 展示交付卡；≥4 展示试炼卡；完成后保留“已完成”展示（步骤 ≤6 或刚完成）
  const showOre = oreDone || (step >= 2 && step <= 6)
  const showTrial = trialDone || (step >= 4 && step <= 6)

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
        <div className={`app-imp-card${oreDone ? ' is-done' : ''}`}>
          <div className="app-imp-card-title">◆ 补给协议·首批矿物</div>
          {oreDone ? (
            <div className="app-imp-card-body is-done-txt">已完成：协会已入账 4,000 ISK 与基础 AI 核心 ×1。</div>
          ) : (
            <>
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
            </>
          )}
        </div>
      ) : null}
      {showTrial ? (
        <div className={`app-imp-card${trialDone ? ' is-done' : ''}`}>
          <div className="app-imp-card-title">◆ 试炼·演习场讨伐令</div>
          {trialDone ? (
            <div className="app-imp-card-body is-done-txt">
              已完成：协会发放 轻型炮台 MK1 ×1、动能弹 ×120（已入库，可在装配页给武装艇装炮）。
            </div>
          ) : (
            <div className="app-imp-card-body">
              前往「战斗悬赏」接取母港的演习场讨伐令并取胜（教学战内你的命中/回避有加成）。完成后发放：轻型炮台 MK1 ×1、动能弹 ×120。
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}
