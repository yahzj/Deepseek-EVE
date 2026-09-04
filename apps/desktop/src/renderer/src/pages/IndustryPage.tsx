/**
 * 工业页：精炼台（矿石 → 矿物）+ 蓝图书架 + 蓝图制造台（装备 / 舰船）。
 */
import { oreAvailable, refineRate } from '@whale/core'
import { Panel } from '@whale/ui'
import { BlueprintShelfPanel, ManufacturingPanel } from '../panels/Industry'
import type { PageProps } from './common'
import { m3 } from './common'

export function IndustryPage({ engine, onToast }: PageProps) {
  const state = engine.state
  const rate = refineRate(state, engine.ctx)

  /** 货仓+仓库里有货且带精炼配方的可精炼资源（矿石/气体/冰矿） */
  const oreDefs = engine.items.filter(
    (def) =>
      (def.refine !== undefined && def.refine.length > 0) && oreAvailable(state, def.id) > 0,
  )

  function handleRefine(id: string): void {
    const r = engine.refineOre(id)
    if (!r.ok) onToast(r.error ?? '精炼失败', true)
    else onToast(`精炼完成：${Object.entries(r.produced).map(([mid, n]) => `${engine.ctx.items.get(mid)?.name ?? mid}×${n}`).join('、')} 已入仓库。`)
  }

  return (
    <div className="page-stack">
      <Panel
        title="精炼台"
        right={<span className="app-dim">收率 {Math.round(rate * 100)}%（精炼学 +8%/级 · 高级回收 +4%/级，上限 95%）</span>}
      >
        <div className="app-dim app-note">
          原料自动从「当前船货仓 + 物品仓库」取用；产物矿物直接进物品仓库（不占货仓）。
        </div>
        {oreDefs.length === 0 ? (
          <div className="app-dim app-inv-empty">
            没有可精炼的资源——先到「星图」页采集矿石/气体/冰矿（在船上或仓库里都行）。
          </div>
        ) : (
          <ul className="app-inv-list">
            {oreDefs.map((def) => {
              const total = oreAvailable(state, def.id)
              const preview = (def.refine ?? [])
                .map((row) => {
                  const mineral = engine.ctx.items.get(row.mineralId)
                  const units = Math.floor(total * row.perOre * rate)
                  return units > 0 ? `${mineral?.name ?? row.mineralId}×${units}` : ''
                })
                .filter(Boolean)
                .join('、')
              return (
                <li key={def.id} className="app-inv-row">
                  <div className="app-inv-main">
                    <span className="app-inv-name">{def.name}</span>
                    <span className="app-inv-count">
                      可用 ×{total.toLocaleString('zh-CN')}（约 {m3(total * def.unitM3)}）→ 预计 {preview || '（收率过低无产出）'}
                    </span>
                  </div>
                  <div className="app-inv-btns">
                    <button className="app-btn is-small is-primary" onClick={() => handleRefine(def.id)}>
                      全部精炼
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>

      <BlueprintShelfPanel engine={engine} onToast={onToast} />
      <ManufacturingPanel engine={engine} onToast={onToast} />
    </div>
  )
}
