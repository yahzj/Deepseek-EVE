import { claimableFirstTasks, firstTaskBoard, firstTaskProgress, firstTaskText } from '@whale/core'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'
import { tr, useL10n } from '../i18n/locale'

interface TaskJump {
  page: string
  mapTab?: string
  shipTab?: string
  industrySec?: 'refine' | 'shelf' | 'craft' | 'shipyard'
  skillId?: string
  labelId: string
}
const FIRST_JUMPS: Record<string, readonly TaskJump[]> = {
  'first-scan': [{ page: 'map', mapTab: 'star', labelId: 'ui.ActivityBar.006' }],
  'first-mine': [
    { page: 'ship', shipTab: 'fleet', labelId: 'ui.FirstTasks.011' },
    { page: 'fit', labelId: 'ui.App.003' },
    { page: 'map', mapTab: 'mine', labelId: 'ui.MapPage.003' },
  ],
  'first-salvage': [
    { page: 'fit', labelId: 'ui.App.003' },
    { page: 'map', mapTab: 'salvage', labelId: 'ui.MapPage.005' },
  ],
  'first-repair': [{ page: 'ship', shipTab: 'fleet', labelId: 'ui.FirstTasks.011' }],
  'first-bounty': [
    { page: 'fit', labelId: 'ui.App.003' },
    { page: 'map', mapTab: 'bounty', labelId: 'ui.MapPage.004' },
  ],
  'first-refine': [{ page: 'industry', industrySec: 'refine', labelId: 'ui.ShipPage.097' }],
  'first-produce': [
    { page: 'industry', industrySec: 'shelf', labelId: 'ui.IndustryPage.060' },
    { page: 'industry', industrySec: 'craft', labelId: 'ui.IndustryPage.059' },
  ],
  'first-order': [{ page: 'market', labelId: 'ui.App.005' }],
  'first-ship': [
    { page: 'industry', industrySec: 'shelf', labelId: 'ui.IndustryPage.060' },
    { page: 'industry', industrySec: 'shipyard', labelId: 'ui.FirstTasks.012' },
  ],
  'first-skill': [{ page: 'skills', skillId: 'ai-expert', labelId: 'ui.App.007' }],
  'first-ai': [{ page: 'ship', shipTab: 'ai', labelId: 'ui.ShipPage.057' }],
  'first-haul': [
    { page: 'map', mapTab: 'star', labelId: 'ui.ActivityBar.006' },
    { page: 'map', mapTab: 'haul', labelId: 'ui.MapPage.006' },
  ],
  'first-wormhole': [
    { page: 'map', mapTab: 'bounty', labelId: 'ui.MapPage.004' },
    { page: 'map', mapTab: 'whscan', labelId: 'ui.MapPage.007' },
  ],
}
const FIRST_GOAL_IDS: Record<string, string> = {
  'first-scan': 'ui.firstTasks.014',
  'first-mine': 'ui.firstTasks.002',
  'first-refine': 'ui.firstTasks.003',
  'first-bounty': 'ui.firstTasks.004',
  'first-repair': 'ui.firstTasks.005',
  'first-salvage': 'ui.firstTasks.006',
  'first-skill': 'ui.firstTasks.007',
  'first-ai': 'ui.firstTasks.008',
  'first-produce': 'ui.firstTasks.009',
  'first-order': 'ui.firstTasks.010',
  'first-ship': 'ui.firstTasks.011',
  'first-haul': 'ui.firstTasks.012',
  'first-wormhole': 'ui.firstTasks.013',
}

export function FirstTasks({
  engine,
  onToast,
  onJump,
}: {
  engine: GameEngine
  onToast: ToastFn
  onOpenComms?: (messageId: string) => void
  onJump?: (t: {
    page: string
    mapTab?: string
    shipTab?: string
    industrySec?: 'refine' | 'shelf' | 'craft' | 'shipyard'
    skillGroup?: string
  }) => void
}) {
  const state = engine.state
  const { locale } = useL10n()
  const loc: 'zh' | 'en' = locale === 'en' ? 'en' : 'zh'
  const ordered = firstTaskBoard(state)
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
        const jumps = FIRST_JUMPS[def.id] ?? []
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
                {'◆'} {firstTaskText(def, loc, 'title')}
              </span>
              <span className="app-station-actions">
                {/* 右上角：跳转按钮（船长 2026-09-18：「所有'第一次'任务都加一个跳转界面的按钮」）
                    ＋「完成」按钮（2026-09-21 船长令）：判据已达成才可点，否则置灰并给一句说明 */}
                {onJump ? jumps.map((jump) => (
                  <button
                    key={jump.labelId}
                    className="app-btn is-small"
                    title={tr("ui.FirstTasks.029", { p1: tr(jump.labelId) })}
                    onClick={() =>
                      onJump({
                        page: jump.page,
                        mapTab: jump.mapTab,
                        shipTab: jump.shipTab,
                        industrySec: jump.industrySec,
                        // 技能页：大类由数据现查（查不到就不带 ⇒ 只切页，不切分类）
                        skillGroup: jump.skillId ? engine.ctx.skills.get(jump.skillId)?.group : undefined,
                      })
                    }
                  >
                    {tr("ui.CommsReader.004")}{tr(jump.labelId)} ›
                  </button>
                )) : null}
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
            <div className="app-station-mats">{firstTaskText(def, loc, 'detail')}</div>
            <div className="app-station-deliver">
              <span className="app-dim">{tr('ui.firstTasks.001')} </span>
              {tr(FIRST_GOAL_IDS[def.id]!)}
            </div>
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
