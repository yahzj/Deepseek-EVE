/**
 * **「第一次」任务系列面板**（船长 2026-09-17 教程重做批 · 阶段③；2026-09-18 按船长四条改版）。
 *
 * 口径（船长）：
 * - 13 条「第一次」**自由选择完成**，按前置过滤：**未解锁的不显示**（`visibleFirstTasks`）；
 * - 每条完成后由**通讯**送达情报（信件在 `data/src/firstTaskMessages.ts`）＋ 部分条目有实物奖励；
 * - 完成「第一次扫描」后**出现后续任务「宇宙探索家1」**——所以一张卡随进度改名：
 *   未完成 ⇒ 显示「第一次··」，已完成 ⇒ 显示该链的名字与档位进度；越过新档位时出现**领奖**；
 * - **2026-09-18 四条改版**：① **完成的置顶**（可领奖 → 已完成 → 未完成，组内保持原序）；
 *   ② 卡片样式**改用资源任务那张卡**（`app-station-card` 家族）；③ **每条都有跳转按钮**（去这件活所在的页面）；
 *   ④ **已全部完成（链也满档）的卡隐藏**（船长：「已经全部完成的重要任务隐藏」）。
 */
import {
  CHAIN_REWARD_ISK_BASE,
  firstTaskBoard,
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

/** 一条任务的跳转落点（**按"这件活在哪干"定**，与情报信的"前往"分属两处：信是完成后的回看指引） */
interface TaskJump {
  page: string
  mapTab?: string
  shipTab?: string
  /** 工业页内层段（`refine` 精炼炉 / `craft` 组装机） */
  industrySec?: 'refine' | 'shelf' | 'craft'
  /** 按钮上写的去处（「前往××」） */
  label: string
}
const FIRST_JUMPS: Record<string, TaskJump> = {
  'first-scan': { page: 'map', mapTab: 'star', label: '星图' },
  'first-mine': { page: 'map', mapTab: 'mine', label: '矿带开采' },
  'first-salvage': { page: 'map', mapTab: 'salvage', label: '残骸打捞' },
  'first-repair': { page: 'ship', shipTab: 'fleet', label: '舰队' },
  'first-bounty': { page: 'map', mapTab: 'bounty', label: '常驻悬赏' },
  'first-refine': { page: 'industry', industrySec: 'refine', label: '精炼炉' },
  'first-produce': { page: 'industry', industrySec: 'craft', label: '组装机' },
  'first-order': { page: 'market', label: '市场' },
  'first-ship': { page: 'industry', industrySec: 'craft', label: '组装机·造船' },
  'first-skill': { page: 'skills', label: '技能' },
  'first-ai': { page: 'ship', shipTab: 'ai', label: 'AI 指挥中心' },
  'first-haul': { page: 'map', mapTab: 'haul', label: '长途运输' },
  'first-wormhole': { page: 'map', mapTab: 'whscan', label: '扫描虫洞' },
}

export function FirstTasks({
  engine,
  onToast,
  onOpenComms,
  onJump,
}: {
  engine: GameEngine
  onToast: ToastFn
  /** 「看情报」：跳到通讯页并选中这条任务的那封情报信 */
  onOpenComms?: (messageId: string) => void
  /** 跳转按钮：去这件活所在的页面（App 层切换页面/页签，并自带解锁闸门的提示） */
  onJump?: (t: { page: string; mapTab?: string; shipTab?: string; industrySec?: 'refine' | 'shelf' | 'craft' }) => void
}) {
  const state = engine.state
  const tasks = visibleFirstTasks(state)
  /** 卡片序列（过滤/隐藏/置顶的判定都在 core 的 `firstTaskBoard`，面板只渲染） */
  const ordered = firstTaskBoard(state)
  const doneN = tasks.filter((d) => state.importantTasks[d.id]?.done === true).length

  return (
    <div className="app-station-list">
      <div className="app-task-family">
        ◆ 第一次 · {doneN}/{tasks.length} 已完成
        <span className="app-dim"> · 完成一条收一封情报，其后开出长期次数目标；可领奖的排在最前</span>
      </div>
      {ordered.map(({ def, done, pendingIsk: pending, level, total, count, next }) => {
        const jump = FIRST_JUMPS[def.id]
        const claimable = pending > 0
        const unit = def.chain ? (CHAIN_UNITS[def.chain.tierKey] ?? '') : ''
        return (
          <div key={def.id} className="app-station-card">
            <div className="app-station-head">
              <span className="app-station-name">
                {done ? '✓' : '◆'} {done && def.chain ? def.chain.name : def.title}
                {claimable ? <em className="app-chip">可领奖</em> : done ? <em className="app-chip">已完成</em> : null}
              </span>
              {def.chain && total > 0 ? (
                <span className="app-dim">
                  已达成 {level}/{total} 档 · 当前 {count}
                  {unit}
                </span>
              ) : null}
            </div>
            <div className="app-station-mats">
              {done && def.chain && total > 0
                ? next !== null
                  ? `下一档：累计 ${next}${unit}（当前 ${count}${unit}）`
                  : `已到最高档：累计 ${count}${unit}`
                : def.brief}
            </div>
            <div className="app-station-deliver">
              <span className="app-dim">
                {claimable ? `可领奖金 ${pending.toLocaleString('zh-CN')} 信用点` : done ? '奖励已结清' : '完成即发情报'}
              </span>
              {/**
               * 跳转按钮（船长 2026-09-18：「所有的'第一次'任务，添加一个跳转界面的按钮」）——
               * 未完成时是"去干活"，完成后仍留着（回看/继续那条链的活）。
               * 按钮直接排在 `.app-station-deliver` 这一行里（该行本就是 flex + 自动换行，不另造样式）。
               */}
              {jump && onJump ? (
                <button
                  className="app-btn is-small"
                  title={`前往「${jump.label}」`}
                  onClick={() => onJump({ page: jump.page, mapTab: jump.mapTab, shipTab: jump.shipTab, industrySec: jump.industrySec })}
                >
                  前往{jump.label} ›
                </button>
              ) : null}
              {/* 「看情报」：那封信在该条完成时送达（`firstTask` 触发器）⇒ 只在已完成时出现 */}
              {done && onOpenComms ? (
                <button className="app-btn is-small" title="打开通讯页，读这一条相关的情报" onClick={() => onOpenComms(def.commsId)}>
                  看情报
                </button>
              ) : null}
              {claimable ? (
                <button
                  className="app-btn is-small is-primary"
                  title={`第 N 级奖金 = ${CHAIN_REWARD_ISK_BASE.toLocaleString('zh-CN')} × N 的五次方`}
                  onClick={() => {
                    const isk = engine.claimChainRewardAt(def.chain!.id)
                    onToast(isk > 0 ? `奖金已到账：${isk.toLocaleString('zh-CN')} 信用点。` : '暂无可领奖金。', isk <= 0)
                  }}
                >
                  领奖（{pending.toLocaleString('zh-CN')} 信用点）
                </button>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
