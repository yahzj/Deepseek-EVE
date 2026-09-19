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
 * - **2026-09-18 第三轮**（船长：L10 逐条重标定）：市场链条目从"挂单张数"改**交易收入（税后信用点）**；
 *   链条目奖金行改写**"完成本级能拿多少"的具体数额**（`nextRewardIsk`，公式不再上卡）。
 */
import { firstTaskBoard, visibleFirstTasks } from '@whale/core'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'
import { tr } from '../i18n/locale'

/** 链进度的计数单位（**纯显示用**，与 core 的阈值表同源；`tierKey` 缺项 ⇒ 不写单位） */
const CHAIN_UNITS: Record<string, string> = {
  scan: tr("ui.FirstTasks.004"),
  mineUnits: tr("ui.FirstTasks.005"),
  salvageRuns: tr("ui.FirstTasks.006"),
  bountyWins: tr("ui.FirstTasks.007"),
  repairs: tr("ui.FirstTasks.006"),
  refineBatches: tr("ui.FirstTasks.008"),
  produceUnits: tr("ui.MarketPage.117"),
  // 2026-09-18 船长换口径：市场链不再数"挂单张数"，改数**交易收入（税后信用点）**
  marketIncome: tr("ui.FirstTasks.003"),
  ships: tr("ui.MarketPage.116"),
  aiAssigns: tr("ui.FirstTasks.006"),
  haulTrips: tr("ui.FirstTasks.009"),
  wormholeRuns: tr("ui.FirstTasks.009"),
  skills: tr("ui.FirstTasks.010"),
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
  'first-scan': { page: 'map', mapTab: 'star', label: tr("ui.ActivityBar.006") },
  'first-mine': { page: 'map', mapTab: 'mine', label: tr("ui.MapPage.003") },
  'first-salvage': { page: 'map', mapTab: 'salvage', label: tr("ui.MapPage.005") },
  'first-repair': { page: 'ship', shipTab: 'fleet', label: tr("ui.FirstTasks.011") },
  'first-bounty': { page: 'map', mapTab: 'bounty', label: tr("ui.MapPage.004") },
  'first-refine': { page: 'industry', industrySec: 'refine', label: tr("ui.ShipPage.097") },
  'first-produce': { page: 'industry', industrySec: 'craft', label: tr("ui.IndustryPage.059") },
  'first-order': { page: 'market', label: tr("ui.App.005") },
  'first-ship': { page: 'industry', industrySec: 'craft', label: tr("ui.FirstTasks.012") },
  'first-skill': { page: 'skills', label: tr("ui.App.007") },
  'first-ai': { page: 'ship', shipTab: 'ai', label: tr("ui.ShipPage.057") },
  'first-haul': { page: 'map', mapTab: 'haul', label: tr("ui.MapPage.006") },
  'first-wormhole': { page: 'map', mapTab: 'whscan', label: tr("ui.MapPage.007") },
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
        ◆ 第一次 · {doneN}/{tasks.length} {tr("ui.FirstTasks.013")}
        <span className="app-dim"> · 完成一条收一封情报，其后开出长期次数目标；可领奖的排在最前</span>
      </div>
      {ordered.map(({ def, done, pendingIsk: pending, level, total, count, next, nextRewardIsk }) => {
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
        if (r?.isk) parts.push(tr("ui.ItemsPage.039", { p1: r.isk.toLocaleString('zh-CN') }))
        const rewardTxt = parts.length > 0 ? parts.join(tr("ui.MatterTechTab.017")) : tr("ui.FirstTasks.014")
        return (
          <div key={def.id} className="app-station-card">
            <div className="app-station-head">
              <span className="app-station-name">
                {done ? '✓' : '◆'} {done && def.chain ? `${def.chain.name}${levelInName}` : def.title}
                {claimable ? <em className="app-chip">{tr("ui.FirstTasks.015")}</em> : null}
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
                {tr("ui.FirstTasks.016")} {count.toLocaleString('zh-CN')}/{goal.toLocaleString('zh-CN')} {unit}
                {next === null ? tr("ui.FirstTasks.017") : ''}
              </div>
            ) : null}
            {/* 正文：一段话讲清怎么做 / 做成什么样 / 有什么奖励 */}
            <div className="app-station-mats">{def.detail}</div>
            {/**
             * **奖励独立成行 + 金色**（船长 2026-09-18：「奖励不明显，建议将奖励单独起一行，
             * 并采用金色字体（奖励 ◆这几个字可以不用金色）」）；**链条目写"完成本级能拿多少"的具体数额**
             * （船长 2026-09-18 第二轮：「任务奖金要写清楚当前这级的具体数额，不能让玩家自己算」）
             * ⇒ 直接印第 `level+1` 级的奖金数字，公式不再上卡。
             */}
            {done && def.chain ? (
              <div className="app-task-reward">
                <span className="app-dim">{tr("ui.FirstTasks.018")} </span>
                {nextRewardIsk > 0 ? `第 ${level + 1} 级 ${nextRewardIsk.toLocaleString('zh-CN')} 信用点` : tr("ui.FirstTasks.019")}
              </div>
            ) : (
              <div className="app-task-reward">
                <span className="app-dim">{tr("ui.Expedition.004")} </span>
                {rewardTxt}
              </div>
            )}
            <div className="app-station-deliver">
              <span className="app-dim">
                {claimable ? `可领奖金 ${pending.toLocaleString('zh-CN')} 信用点` : done ? tr("ui.FirstTasks.020") : tr("ui.FirstTasks.021")}
              </span>
              {/* 「看情报」：那封信在该条完成时送达（`firstTask` 触发器）⇒ 只在已完成时出现 */}
              {done && onOpenComms ? (
                <button className="app-btn is-small" title={tr("ui.FirstTasks.022")} onClick={() => onOpenComms(def.commsId)}>
                  {tr("ui.FirstTasks.023")}
                </button>
              ) : null}
              {claimable ? (
                <button
                  className="app-btn is-small is-primary"
                  title={`领取已达级别的链奖金（共 ${pending.toLocaleString('zh-CN')} 信用点）`}
                  onClick={() => {
                    const isk = engine.claimChainRewardAt(def.chain!.id)
                    onToast(isk > 0 ? `奖金已到账：${isk.toLocaleString('zh-CN')} 信用点。` : tr("ui.FirstTasks.024"), isk <= 0)
                  }}
                >
                  {tr("ui.FirstTasks.025")}{pending.toLocaleString('zh-CN')} 信用点）
                </button>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
