/**
 * **「第一次」任务系列面板**（船长 2026-09-17 教程重做批 · 阶段③；2026-09-18 按船长两轮实机反馈改版）。
 *
 * 口径（船长）：
 * - **顺序解锁**（**2026-09-20 船长转玩家反馈**：「新手引导的重要任务一次性太多了，建议按顺序排列解锁」
 *   ⇒ 三选**丙案：只显示当前这一条**）——`visibleFirstTasks` 只给"第一条还没完成的"；已完成的**不再占位**，
 *   进度看页头 N/13（`firstTaskProgress`）。文档/注释里旧的「13 条自由选择完成」已作废。
 * - **里程碑（次数）链搬去「里程碑任务」页**（同一条反馈；领奖按钮只在那儿）——**本页不显示里程碑内容**
 *   （**2026-09-20 船长第二道令**：「**第一次任务内，不要显示里程碑相关内容。建议隐藏**」⇒ 原先那行只读、
 *   「可领奖」小标、链条奖金行一并撤掉；卡片只讲这件活本身：怎么做 ＋ 它自己那份一次性奖励）。
 * - 每条完成后由**通讯**送达情报（信件在 `data/src/firstTaskMessages.ts`）＋ 部分条目有实物奖励；
 * - **2026-09-18 第一轮**：卡片改用资源任务那张卡（`app-station-card`）· 每条都有跳转按钮；
 * - **2026-09-18 第二轮**：正文改用任务的 `detail`（一段话讲清怎么做/做成什么样/奖励）；
 * - **2026-09-18 第三轮**：链条目奖金行改写**"完成本级能拿多少"的具体数额**（`nextRewardIsk`）——
 *   该行**自 2026-09-20 起只画在「里程碑任务」页**（见 `MilestoneTasks.tsx`）。
 */
import { claimableFirstTasks, firstTaskBoard, firstTaskProgress } from '@whale/core'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'
import { tr } from '../i18n/locale'

/** 一条任务的跳转落点（**按"这件活在哪干"定**，与情报信的"前往"分属两处：信是完成后的回看指引） */
interface TaskJump {
  page: string
  mapTab?: string
  shipTab?: string
  /** 工业页内层段（`refine` 精炼炉 / `craft` 组装机 / `shipyard` 造船厂） */
  industrySec?: 'refine' | 'shelf' | 'craft' | 'shipyard'
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
  onJump?: (t: { page: string; mapTab?: string; shipTab?: string; industrySec?: 'refine' | 'shelf' | 'craft' | 'shipyard' }) => void
}) {
  const state = engine.state
  /** 卡片序列（顺序解锁下**恒为当前这一条**；判定都在 core 的 `firstTaskBoard`，面板只渲染） */
  const ordered = firstTaskBoard(state)
  /** 页头进度：**已完成 / 总数**（顺序解锁后"当前第几条"= done + 1，见 core `firstTaskProgress`） */
  const { done: doneN, total: taskTotal } = firstTaskProgress(state)

  return (
    <div className="app-station-list">
      <div className="app-task-family">
        {tr("ui.FirstTasks.026")} {doneN}/{taskTotal} {tr("ui.FirstTasks.013")}
        {/**
         * 页头副标题随"显示几条"切换（**2026-09-20 船长第三道令**：完成第 11 条后
         * 「第一次长途运输」「第一次虫洞」＋「寻找人类」一起显示）：
         * 顺序段仍是"一次只出一条"，末段并列批换成"这几条按任意顺序做"。
         */}
        <span className="app-dim">{ordered.length > 1 ? tr('ui.FirstTasks.036') : tr('ui.FirstTasks.035')}</span>
      </div>
      {ordered.map(({ def }) => {
        const jump = FIRST_JUMPS[def.id]
        /**
         * **完成推进**（**2026-09-21 船长令**：「第一次任务不要自动完成。要让玩家回到任务中心点击完成
         * 才开始下一步，这样给予任务开始前道具的时间点就很明确」）：
         * 可点判据 = core 的 `claimableFirstTasks`（**正轮到 ＋ 判据已满足**，与引擎同一把尺）；
         * 末段并列批时那一批各自判断、都能点。
         */
        const claimable = claimableFirstTasks(state, engine.ctx).some((d) => d.id === def.id)
        /** 奖励口袋 → 一行文案（完成奖励与起手道具共用这段拼法） */
        const pocketText = (r: typeof def.reward): string => {
          const parts: string[] = []
          for (const m of r?.modules ?? []) parts.push(`${engine.ctx.modules.get(m.moduleId)?.name ?? m.moduleId} ×${m.units}`)
          for (const w of r?.ware ?? []) parts.push(`${engine.ctx.items.get(w.itemId)?.name ?? w.itemId} ×${w.units}`)
          for (const b of r?.blueprints ?? []) {
            const nm = engine.ctx.blueprints.get(b.blueprintId)?.name ?? engine.ctx.shipBlueprints.get(b.blueprintId)?.name
            parts.push(`${nm ?? b.blueprintId} ×${b.units}`)
          }
          for (const s of r?.ships ?? []) parts.push(`${engine.ctx.ships.get(s.defId)?.name ?? s.defId} ×${s.units}`)
          for (const c of r?.aiCores ?? []) parts.push(tr("ui.FirstTasks.027", { p1: c.units }))
          if (r?.wormholeStock) parts.push(tr("ui.FirstTasks.028", { p1: r.wormholeStock }))
          if (r?.isk) parts.push(tr("ui.ItemsPage.039", { p1: r.isk.toLocaleString('zh-CN') }))
          return parts.join(tr("ui.MatterTechTab.017"))
        }
        const rewardTxt = pocketText(def.reward) || tr("ui.FirstTasks.014")
        const startTxt = pocketText(def.startReward)
        return (
          <div key={def.id} className="app-station-card">
            <div className="app-station-head">
              <span className="app-station-name">
                {'◆'} {def.title}
              </span>
              <span className="app-station-actions">
                {/* 右上角：跳转按钮（船长 2026-09-18：「所有'第一次'任务都加一个跳转界面的按钮」）
                    ＋「完成」按钮（2026-09-21 船长令）：判据已达成才可点，否则置灰并给一句说明 */}
                {jump && onJump ? (
                  <button
                    className="app-btn is-small"
                    title={tr("ui.FirstTasks.029", { p1: jump.label })}
                    onClick={() => onJump({ page: jump.page, mapTab: jump.mapTab, shipTab: jump.shipTab, industrySec: jump.industrySec })}
                  >
                    {tr("ui.CommsReader.004")}{jump.label} ›
                  </button>
                ) : null}
                <button
                  className="app-btn is-primary is-small"
                  title={claimable ? tr('ui.FirstTasks.037') : tr('ui.FirstTasks.038')}
                  disabled={!claimable}
                  onClick={() => {
                    const r = engine.claimFirstTaskAt(def.id)
                    if (!r.ok && r.error) onToast(r.error, true)
                  }}
                >
                  {tr('ui.FirstTasks.037')}
                </button>
              </span>
            </div>
            {/* 正文：一段话讲清怎么做 / 做成什么样 / 有什么奖励 */}
            <div className="app-station-mats">{def.detail}</div>
            {/**
             * **奖励两段**（船长 2026-09-21：起手道具与完成奖励分开写；沿用 2026-09-18「独立成行 + 金色」口径）：
             * 「开始即给」只在有 `startReward` 时出现；里程碑链的奖金行仍只在「里程碑任务」页。
             */}
            {startTxt ? (
              <div className="app-task-reward">
                <span className="app-dim">{tr('ui.FirstTasks.039')} </span>
                {startTxt}
              </div>
            ) : null}
            <div className="app-task-reward">
              <span className="app-dim">{tr('ui.FirstTasks.040')} </span>
              {rewardTxt}
            </div>
            <div className="app-station-deliver">
              <span className="app-dim">{tr("ui.FirstTasks.021")}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
