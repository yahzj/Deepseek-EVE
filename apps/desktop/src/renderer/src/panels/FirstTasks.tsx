/**
 * **「第一次」任务系列面板**（船长 2026-09-17 教程重做批 · 阶段③；2026-09-18 按船长两轮实机反馈改版）。
 *
 * 口径（船长）：
 * - 13 条「第一次」**自由选择完成**，按前置过滤：**未解锁的不显示**（`visibleFirstTasks`）；
 * - 每条完成后由**通讯**送达情报（信件在 `data/src/firstTaskMessages.ts`）＋ 部分条目有实物奖励；
 * - 一张卡随进度改名：未完成 ⇒「第一次··」，已完成 ⇒ 该链的名字**带当前级别**
 *   （船长 2026-09-18：「重要任务进行到哪一个级别要直接在任务名称内告诉玩家」⇒「宇宙探索家3」）；
 * - **2026-09-18 第一轮**：完成置顶（可领奖 → 已完成 → 未完成）· 卡片改用资源任务那张卡（`app-station-card`）·
 *   每条都有跳转按钮 · 已全部完成（链满档且没得领）的卡隐藏；
 * - **2026-09-18 第二轮**（船长实机反馈）：① 名字带级别；② **删掉右上角那行"已达成 L/T 档 · 当前 N"**（与正文重复）
 *   ⇒ 那个位置改放**跳转按钮**（显眼）；③ 正文改用任务的 `detail`（一段话讲清怎么做/做成什么样/奖励），
 *   不再只显示一句话；④ 进度改成 **`已累计 X/Y 单位`**（Y = 下一档阈值）；⑤ **不再挂"已完成"小片**
 *   （船长：「因为可以继续完成，所以名字边上的已经完成的标签显得很不合适」）。
 */
import { CHAIN_REWARD_ISK_BASE, firstTaskBoard, visibleFirstTasks } from '@whale/core'
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
        // 名字里的级别 = **正在做的那一级**（完成「第一次」后从 1 起；满档时停在总档数）
        const levelInName = def.chain && total > 0 ? Math.min(level + 1, total) : 0
        // 进度读数：`已累计 当前/下一档`（下一档为空 ⇒ 已达最高档）
        const goal = next ?? count
        // **奖励一行**（船长 2026-09-18：奖励单独起一行、金色）——名字从内容表查
        const r = def.reward
        const parts: string[] = []
        for (const m of r?.modules ?? []) parts.push(`${engine.ctx.modules.get(m.moduleId)?.name ?? m.moduleId} ×${m.units}`)
        for (const w of r?.ware ?? []) parts.push(`${engine.ctx.items.get(w.itemId)?.name ?? w.itemId} ×${w.units}`)
        for (const b of r?.blueprints ?? []) {
          const nm = engine.ctx.blueprints.get(b.blueprintId)?.name ?? engine.ctx.shipBlueprints.get(b.blueprintId)?.name
          parts.push(`${nm ?? b.blueprintId} ×${b.units}`)
        }
        for (const s of r?.ships ?? []) parts.push(`${engine.ctx.ships.get(s.defId)?.name ?? s.defId} ×${s.units}`)
        for (const c of r?.aiCores ?? []) parts.push(`基础 AI 核心 ×${c.units}`)
        if (r?.wormholeStock) parts.push(`未探索虫洞 ×${r.wormholeStock}`)
        if (r?.isk) parts.push(`${r.isk.toLocaleString('zh-CN')} 信用点`)
        const rewardTxt = parts.length > 0 ? parts.join('、') : '情报信一封'
        return (
          <div key={def.id} className="app-station-card">
            <div className="app-station-head">
              <span className="app-station-name">
                {done ? '✓' : '◆'} {done && def.chain ? `${def.chain.name}${levelInName}` : def.title}
                {claimable ? <em className="app-chip">可领奖</em> : null}
              </span>
              {/* 右上角：跳转按钮（船长 2026-09-18：「所有'第一次'任务都加一个跳转界面的按钮」） */}
              {jump && onJump ? (
                <button
                  className="app-btn is-small"
                  title={`前往「${jump.label}」`}
                  onClick={() => onJump({ page: jump.page, mapTab: jump.mapTab, shipTab: jump.shipTab, industrySec: jump.industrySec })}
                >
                  前往{jump.label} ›
                </button>
              ) : null}
            </div>
            {/* 进度：已完成 ⇒ 走次数链，读数用「已累计 当前/下一档」 */}
            {done && def.chain && total > 0 ? (
              <div className="app-station-mats">
                已累计 {count}/{goal}
                {unit}
                {next === null ? '（已到最高档）' : ''}
              </div>
            ) : null}
            {/* 正文：一段话讲清怎么做 / 做成什么样 / 有什么奖励 */}
            <div className="app-station-mats">{def.detail}</div>
            {/**
             * **奖励独立成行 + 金色**（船长 2026-09-18：「奖励不明显，建议将奖励单独起一行，
             * 并采用金色字体（奖励 ◆这几个字可以不用金色）」）：前缀「奖励 ◆」走 `.app-dim` 保持暗色，
             * 奖励内容走 `.app-task-reward` 金色。
             * - 还没做的条目 ⇒ 写这条任务送什么（没有实物就如实写"情报信一封"）；
             * - 已完成的条目 ⇒ 那条「第一次」的奖励早已发过，这里改写**次数奖金**（每档 2,500 × 级别⁵）。
             */}
            {done && def.chain ? (
              <div className="app-task-reward">
                <span className="app-dim">奖金 ◆ </span>
                每档 {CHAIN_REWARD_ISK_BASE.toLocaleString('zh-CN')} × 级别⁵
                {claimable ? ` · 现可领 ${pending.toLocaleString('zh-CN')} 信用点` : ''}
              </div>
            ) : (
              <div className="app-task-reward">
                <span className="app-dim">奖励 ◆ </span>
                {rewardTxt}
              </div>
            )}
            <div className="app-station-deliver">
              <span className="app-dim">
                {claimable ? `可领奖金 ${pending.toLocaleString('zh-CN')} 信用点` : done ? '次数目标进行中' : '完成即发情报'}
              </span>
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
