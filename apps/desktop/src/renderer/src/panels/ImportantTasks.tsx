import { TASK_FIND_HUMANS } from '@whale/core'
import type { GameEngine } from '../game/engine'
import { tr } from '../i18n/locale'
import { pt } from '../ui/planetText'

export function ImportantTasks({ engine }: { engine: GameEngine }) {
  const state = engine.state
  const findTask = state.importantTasks[TASK_FIND_HUMANS]
  const findHumanOn = findTask !== undefined && findTask.done !== true
  const galaxyTotal = engine.ctx.galaxies.size
  const exploredN = [...engine.ctx.galaxies.keys()].filter((g) => state.exploredGalaxies.includes(g)).length
  const allExplored = findTask?.allExplored === true || (galaxyTotal > 0 && exploredN >= galaxyTotal)

  return (
    <div className="app-imp-quests">
      {state.planetary?.runtimeVersion === 1 && state.planetary.humans ? <div className="app-imp-card is-perm">
        <div className="app-imp-card-title">{tr('core.planet.003')}</div>
        <div className="app-imp-card-body">{tr('core.planet.002')}</div>
        <div className="app-imp-card-state">{pt(state.importantTasks['human-home']?.done ? 'completed' : 'stage.settlement')}</div>
      </div> : null}
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
              {tr("ui.ImportantTasks.005")} {exploredN}/{galaxyTotal} {tr("ui.FirstTasks.004")}{allExplored ? tr('ui.ImportantTasks.008') : ''}）
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
