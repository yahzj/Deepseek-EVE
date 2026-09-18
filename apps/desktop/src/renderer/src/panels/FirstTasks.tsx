/**
 * **「第一次」任务系列面板**（船长 2026-09-17 教程重做批 · 阶段③）。
 *
 * 位置 = 任务中心的「重要任务」标签（**取代**旧教程步骤卡；两张教程卡随旧步骤机一起退役）。
 * 口径（船长）：
 * - 13 条「第一次」**自由选择完成**，按前置过滤：**未解锁的不显示**（`visibleFirstTasks`）；
 * - 每条完成后由**通讯**送达相关情报（信件内容在 `data/src/firstTaskMessages.ts`，不在这里）；
 * - 完成「第一次扫描」后**出现后续任务「宇宙探索家1」**——所以本面板的做法是
 *   **一张卡随进度改名**：未完成 ⇒ 显示「第一次··」，已完成 ⇒ 显示该链的名字与档位进度；
 *   越过新档位时卡片上出现**领奖**（ISK 由 core 的 `claimChainReward` 记账发放）。
 * - 样式**照旧面板 `ImportantTasks` 复刻**（`app-imp-*` 家族），不新增 CSS。
 */
import {
  CHAIN_REWARD_ISK_BASE,
  chainPendingRewardIsk,
  chainProgressOf,
  visibleFirstTasks,
} from '@whale/core'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'

/** 链进度的计数单位（**纯显示用**，与 core 的阈值表同源；`tierKey` 缺项 ⇒ 不写单位） */
const CHAIN_UNITS: Record<string, string> = {
  scan: '星系',
  mineUnits: '单位原矿',
  salvageRuns: '次',
  bountyWins: '场',
  repairs: '次',
  refineBatches: '批',
  produceUnits: '件',
  orders: '单',
  ships: '艘',
  aiAssigns: '次',
  haulTrips: '趟',
  wormholeRuns: '趟',
  skills: '级',
}

export function FirstTasks({
  engine,
  onToast,
  onOpenComms,
}: {
  engine: GameEngine
  onToast: ToastFn
  /** 「看情报」：跳到通讯页并选中这条任务的那封情报信（船长：「完成…后就会有一则通讯告诉玩家情报」） */
  onOpenComms?: (messageId: string) => void
}) {
  const state = engine.state
  const tasks = visibleFirstTasks(state)
  const doneN = tasks.filter((d) => state.importantTasks[d.id]?.done === true).length

  return (
    <div className="app-imp-quests">
      <div className="app-imp-card">
        <div className="app-imp-card-title">◆ 第一次 · {doneN}/{tasks.length} 已完成</div>
        <div className="app-imp-card-body">
          想做哪一件都行；完成一条会收到一封通讯，并开出长期次数目标。
        </div>
      </div>
      {tasks.map((def) => {
        const done = state.importantTasks[def.id]?.done === true
        const chain = def.chain
        const prog = chain ? chainProgressOf(state, chain) : null
        const paid = chain ? (state.firstStats?.[`paid-${chain.id}`] ?? 0) : 0
        const claimable = prog !== null && prog.level > paid
        const unit = chain ? (CHAIN_UNITS[chain.tierKey] ?? '') : ''
        return (
          <div className="app-imp-card" key={def.id}>
            {/* 未完成 ⇒ 「第一次··」；已完成 ⇒ 后续次数任务（船长：完成后出现「宇宙探索家1」） */}
            {done && chain && prog ? (
              <>
                <div className="app-imp-card-title">◆ {chain.name}</div>
                <div className="app-imp-card-body">
                  {prog.next !== null
                    ? `下一档：累计 ${prog.next}${unit}（当前 ${prog.count}${unit}）`
                    : `已到最高档：累计 ${prog.count}${unit}`}
                  {` · 已达成 ${prog.level}/${prog.total} 档`}
                </div>
              </>
            ) : (
              <>
                <div className="app-imp-card-title">{done ? '✓' : '◆'} {def.title}</div>
                <div className="app-imp-card-body">{def.brief}</div>
              </>
            )}
            {/**
             * 「看情报」：那封信在该条完成时送达（`firstTask` 触发器）——老档的一次性判定也会把信补上，
             * 所以这里只在"已完成"时出现（未完成时收了也读不懂）。
             */}
            {done && onOpenComms ? (
              <button className="app-btn is-small" title="打开通讯页，读这一条相关的情报" onClick={() => onOpenComms(def.commsId)}>
                看情报
              </button>
            ) : null}
            {claimable ? (
              <button
                className="app-btn is-small is-primary"
                onClick={() => {
                  const isk = engine.claimChainRewardAt(chain!.id)
                  onToast(
                    isk > 0
                      ? `奖金已到账：${isk.toLocaleString('zh-CN')} 信用点。`
                      : '暂无可领奖金。',
                    isk <= 0,
                  )
                }}
                title={`第 N 级奖金 = ${CHAIN_REWARD_ISK_BASE.toLocaleString('zh-CN')} × N 的五次方`}
              >
                领奖（{chainPendingRewardIsk(state, chain!.id).toLocaleString('zh-CN')} 信用点）
              </button>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
