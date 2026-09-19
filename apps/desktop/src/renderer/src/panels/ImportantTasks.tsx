/**
 * 重要任务 · 贯穿（2026-09-05 船长拍板；2026-09-10 补定；**2026-09-17 教程重做后只剩「寻找人类」**）。
 *
 * - 序章结束时发布「寻找人类」：正常发布、不告诉做法（船长 2026-09-05）。
 * - 「寻找人类」阶段目标（2026-09-10 船长定）：**探索全部星系、寻找人类踪迹**——带进度显示，
 *   全部探索完毕后标为"阶段目标已完成"（任务本身仍进行中，完成方法未知）。
 *
 * ⚠ 2026-09-17 教程重做：原先这里还有两张教程任务卡（补给协议·首批原矿、试炼·演习场驱逐令）——
 * 线性七步教程退场后它们一并撤掉，教程内容改由任务中心的 13 条「第一次」承载（见 `FirstTasks.tsx`）。
 */
import { TASK_FIND_HUMANS } from '@whale/core'
import type { GameEngine } from '../game/engine'
import { tr } from '../i18n/locale'

/** 只剩「寻找人类」这一条贯穿任务（教程卡随线性教程退场）⇒ 不再需要 onToast（没有可点的动作） */
export function ImportantTasks({ engine }: { engine: GameEngine }) {
  const state = engine.state
  const findTask = state.importantTasks[TASK_FIND_HUMANS]
  const findHumanOn = findTask !== undefined && findTask.done !== true
  // 「寻找人类」阶段目标进度：已探索星系 / 全图星系
  const galaxyTotal = engine.ctx.galaxies.size
  const exploredN = [...engine.ctx.galaxies.keys()].filter((g) => state.exploredGalaxies.includes(g)).length
  const allExplored = findTask?.allExplored === true || (galaxyTotal > 0 && exploredN >= galaxyTotal)

  return (
    <div className="app-imp-quests">
      {findHumanOn ? (
        <div className="app-imp-card is-perm">
          <div className="app-imp-card-title">{tr("ui.ImportantTasks.001")}</div>
          <div className="app-imp-card-body">
            {tr("ui.ImportantTasks.002")}
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
            <span className="app-imp-goal-key">{tr("ui.ImportantTasks.003")}</span> {tr("ui.ImportantTasks.004")}
            <span className="app-dim">
              {tr("ui.ImportantTasks.005")} {exploredN}/{galaxyTotal} {tr("ui.FirstTasks.004")}{allExplored ? ' · 已完成' : ''}）
            </span>
          </div>
          <div className="app-imp-card-state">
            {allExplored ? tr("ui.ImportantTasks.006") : tr("ui.ImportantTasks.007")}
          </div>
        </div>
      ) : null}
    </div>
  )
}
