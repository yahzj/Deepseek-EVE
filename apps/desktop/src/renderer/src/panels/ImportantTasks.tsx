/**
 * 重要任务 · 序章/贯穿（2026-09-05 船长拍板规则更新；2026-09-10 船长补定）：
 * - **已完成的重要任务一律隐藏**：教程任务卡（补给协议/试炼）只在“进行中”展示；
 * - 教程完成(含跳过)后发布贯穿任务「寻找人类」：正常发布、不告诉做法；
 * - 「寻找人类」阶段目标（2026-09-10 船长定）：**探索全部星系、寻找人类踪迹**——带进度显示，
 *   全部探索完毕后标为"阶段目标已完成"（任务本身仍进行中，完成方法未知）。
 */
import {
  ONB_DELIVER,
  ONB_DIVIDE,
  ONB_TRIAL,
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
  const findTask = state.importantTasks[TASK_FIND_HUMANS]
  const findHumanOn = findTask !== undefined && findTask.done !== true
  const oreName = engine.ctx.items.get(TUTORIAL_DELIVER_ITEM)?.name ?? TUTORIAL_DELIVER_ITEM
  const have = state.warehouse.items[TUTORIAL_DELIVER_ITEM] ?? 0
  const step = state.onboarding.step
  // 已完成的任务隐藏（船长 2026-09-05）；教程卡仅在对应步骤窗口且未完成时出现
  const showOre = !oreDone && step >= ONB_DELIVER && step <= ONB_DIVIDE
  const showTrial = !trialDone && step >= ONB_TRIAL && step <= ONB_DIVIDE
  // 「寻找人类」阶段目标进度：已探索星系 / 全图星系
  const galaxyTotal = engine.ctx.galaxies.size
  const exploredN = [...engine.ctx.galaxies.keys()].filter((g) => state.exploredGalaxies.includes(g)).length
  const allExplored = findTask?.allExplored === true || (galaxyTotal > 0 && exploredN >= galaxyTotal)

  const deliver = (): void => {
    const r = engine.deliverTutorialOreAt()
    if (r.ok) {
      onToast('交付完成：+4,000 信用点、基础 AI 核心 ×1。')
    } else {
      onToast(r.error ?? '交付失败', true)
    }
  }

  return (
    <div className="app-imp-quests">
      {showOre ? (
        <div className="app-imp-card">
          <div className="app-imp-card-title">◆ 补给协议·首批原矿</div>
          <div className="app-imp-card-body">
            向任务中心交付 {oreName} ×{TUTORIAL_DELIVER_N}（仓库现有 {have}）——维持隐秘泊位的临时修复储备。
          </div>
          <button
            className="app-btn is-small is-primary"
            disabled={have < TUTORIAL_DELIVER_N}
            onClick={deliver}
            title={have < TUTORIAL_DELIVER_N ? '仓库原矿不足——先回港把采集的原矿卸入仓库' : undefined}
          >
            交付原矿（{Math.min(have, TUTORIAL_DELIVER_N)}/{TUTORIAL_DELIVER_N}）
          </button>
        </div>
      ) : null}
      {showTrial ? (
        <div className="app-imp-card">
          <div className="app-imp-card-title">◆ 试炼·演习场驱逐令</div>
          <div className="app-imp-card-body">
            星图 →「常驻悬赏」，接取母港的演习场驱逐令并取胜（这场是照会战，本舰的命中与回避按规程上调）。完成后发放：轻型炮台 MK1 ×1、动能弹 ×120。
          </div>
        </div>
      ) : null}
      {findHumanOn ? (
        <div className="app-imp-card is-perm">
          <div className="app-imp-card-title">◆ 寻找人类</div>
          <div className="app-imp-card-body">
            人类已全体失踪——你是一艘前人类时代的舰船 AI。目前没有任何可执行线索，完成方法未知；以这座章鱼宇宙人统治的母港为起点，往未知的前方继续航行，壮大自身规模，应对各种危险，或许终会有所发现。
          </div>
          {/**
           * **方向性建议（不是"任务目标"）**——2026-09-13 船长裁定「甲」。
           *
           * 由来：本条描述写「**目前没有任何可执行线索**」，而这里原先挂着一条带进度的「任务目标」，
           * 两套口径对不上（一边说没线索、一边给出可执行目标）。
           * 船长 2026-09-10 那条裁定（「给这条贯穿任务加上可追踪目标——探索全部星系、寻找人类踪迹」）
           * **保留**，只把它的**读法**从"任务目标"改成"当下能做的事"⇒ 与描述里那句首尾相接。
           */}
          <div className="app-imp-card-goal">
            <span className="app-imp-goal-key">可做的事</span> 继续探索全部星系，寻找人类踪迹
            <span className="app-dim">
              （已探索 {exploredN}/{galaxyTotal} 星系{allExplored ? ' · 已完成' : ''}）
            </span>
          </div>
          <div className="app-imp-card-state">
            {allExplored ? '状态：进行中 · 阶段目标已完成——全图无人类踪迹，线索仍未知' : '状态：进行中 · 完成方法未知'}
          </div>
        </div>
      ) : null}
    </div>
  )
}
