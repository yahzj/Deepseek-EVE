import { LabRecipeFilters, type LabFilter } from '../../ui/LabRecipeFilters'
import { Panel } from '@whale/ui'
import { useState, type ReactNode } from 'react'
import type { GameEngine } from '../../game/engine'
import '../../styles-unbox-ledger.css'
import { AiSlotText } from '../../ui/aiSlots'
import { HintIcon } from '../../ui/Hint'
import type { PageProps } from '../../pages/common'
import { tr } from '../../i18n/locale'
import { LabCard } from './LabCard'

/**
 * **实验室面板**（**2026-09-29 船长令**：「为工业新增子页面：'实验室'。玩家可以在实验室生产燃料。
 * 实验室的生产卡片和其他工业卡片类似」）。
 *
 * ⚠ **观感纪律（§6：先复刻同级相似项，不自造新样式）**：本页**逐件复刻精炼炉那一套**——
 * `Panel`（标题 ＋ 圆形感叹号规格句 ＋ 右侧读数）→ `.app-win-body` → `.app-belt-grid` →
 * 每配方一张 `.app-belt-card`（`app-belt-head` / `-name` / `-head-right` / `-desc` / `-ore` /
 * `-econ` / `-actions` / `-workers` / `-ai`），**一个自造类名都没有**。
 * 解锁门槛 = 已建成空间站 ≥ 1 座（`engine.labUnlocked()`）；未解锁时本子页不渲染。
 */
export function LabPanel({
  engine,
  onToast,
  onGotoMarket,
  onNeedMaterial,
  onGotoPlugExchange,
}: {
  engine: GameEngine
  onToast: PageProps['onToast']
  onGotoMarket?: (goodKey: string) => void
  /**
   * **材料行尾的「去哪弄」跳转**（**2026-10-01 船长令**：实验室卡的材料行要与组装机卡逐字同款）——
   * 与组装机卡**同一个处理器**（页内 `handleNeedMineral`）：有精炼源 ⇒ 切精炼炉并高亮那张矿石卡 ·
   * 造得出 ⇒ 切组装机 · 都不行 ⇒ 跳市场行情 · 再不行 ⇒ toast 说明。
   * ⚠ 原先那颗**卡头「去弄料」按钮**已删（它只会挑"第一味缺料"，指路不如逐行准；见 `LabCard` 头注）。
   */
  onNeedMaterial?: (itemId: string) => void
  /** 材料行尾第①支（声望商店：通用黑匣那条来路）的落点——与组装机卡同一支判定 */
  onGotoPlugExchange?: () => void
}): ReactNode {
  const state = engine.state
  const [filter, setFilter] = useState<LabFilter>('all')
  const recipes = [...engine.ctx.labRecipes.values()].filter(r => filter === 'all' || r.category === filter)
  const runs = engine.labRunViews()
  return (
    <Panel
      className="is-fill"
      title={tr('ui.lab.001')}
      hint={<HintIcon tip={tr('ui.lab.024')} />}
      right={
        <>
          <span className="app-dim">{tr('ui.lab.024')}</span>
          <AiSlotText state={state} ctx={engine.ctx} />
        </>
      }
    >
      <div className="app-win-body">
        <LabRecipeFilters value={filter} onPick={setFilter} />
        {recipes.length === 0 ? <div className="app-dim app-inv-empty">{tr('ui.lab.018')}</div> : null}
        <div className="app-belt-grid">
          {recipes.map((r) => (
            <LabCard
              key={r.id}
              recipe={r}
              engine={engine}
              onToast={onToast}
              onGotoMarket={onGotoMarket}
              onNeedMaterial={onNeedMaterial}
              onGotoPlugExchange={onGotoPlugExchange}
              runs={runs.filter((v) => v.recipeId === r.id)}
            />
          ))}
        </div>
      </div>
    </Panel>
  )
}
