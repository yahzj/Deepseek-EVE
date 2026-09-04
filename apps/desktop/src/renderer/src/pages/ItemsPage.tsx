/**
 * 物品页：物品仓库（飞行员资产：无限容量、永不遗失）。
 * 精炼产物与制造材料都在这里；矿石/气体/冰矿卸货后也先到仓库（V10 起按物品大类分组展示）。
 */
import { ITEM_KIND_LABELS, ITEM_KIND_ORDER, itemKindLabel } from '@whale/core'
import { Panel } from '@whale/ui'
import { ItemHover } from '../ui/shipInfo'
import type { PageProps } from './common'
import { isk, itemBuyQuote, m3 } from './common'

/** 可装回船上搬运的分类（资源类；矿物留在仓库当制造料，弹药/无人机等占位货只卖不搬） */
const LOADABLE_KINDS = new Set(['ore', 'gas', 'ice'])

const KIND_EMPTY: Record<string, string> = {
  ore: '仓库里没有矿石（自动卸货的矿会先到这里）。',
  mineral: '还没有矿物——去「工业」页精炼资源。',
  gas: '仓库里没有气体。',
  ice: '仓库里没有冰矿。',
  ammo: '仓库里没有弹药。',
  drone: '仓库里没有无人机。',
}

export function ItemsPage({ engine, onToast }: PageProps) {
  const state = engine.state
  const rows = Object.entries(state.warehouse.items).filter(([, n]) => n > 0)

  function handleSell(id: string): void {
    const r = engine.sellWare(id)
    if (!r.ok) onToast(r.error ?? '出售失败', true)
    else onToast(`入账 ${r.gainedIsk.toLocaleString('zh-CN')} ISK（按市场收购价；吃穿簿的剩余自动挂卖单）。`)
  }

  function handleLoad(id: string): void {
    const def = engine.ctx.items.get(id)
    if (!def) return
    const loaded = engine.loadWareToCargoFit(id)
    if (loaded === 0) onToast('船上没有足够空间。', true)
    else onToast(`已装船 ${def.name}×${loaded.toLocaleString('zh-CN')}。`)
  }

  return (
    <div className="page-stack">
      <Panel
        title="物品仓库"
        right={<span className="app-dim">无限容量 · 不随船 · 永不遗失</span>}
      >
        <div className="app-dim app-note">
          精炼产物自动入仓，制造材料从仓库扣除。资源（矿石/气体/冰矿）可卖出，也可装到当前驾驶的船上（受货仓空间限制）。
        </div>
      </Panel>

      {ITEM_KIND_ORDER.map((kind) => {
        const kindRows = rows.filter(([id]) => engine.ctx.items.get(id)?.kind === kind)
        // 矿石/矿物面板常驻（引导文案有教学作用），其余分类空时不显示
        if (kindRows.length === 0 && kind !== 'ore' && kind !== 'mineral') return null
        return (
          <Panel
            key={kind}
            title={`${itemKindLabel(kind)}（仓库）`}
            right={<span className="app-dim">{kindRows.length} 种</span>}
          >
            {kindRows.length === 0 ? (
              <div className="app-dim app-inv-empty">{KIND_EMPTY[kind] ?? '仓库里没有该分类物品。'}</div>
            ) : (
              <ul className="app-inv-list">
                {kindRows.map(([id, units]) => {
                  const def = engine.ctx.items.get(id)
                  if (!def) return null
                  const buy = itemBuyQuote(engine, id)
                  return (
                    <ItemHover
                      key={id}
                      as="li"
                      item={def}
                      nameOf={(pid) => engine.ctx.items.get(pid)?.name}
                      className="app-inv-row"
                    >
                      <div className="app-inv-main">
                        <span className="app-inv-name">
                          {def.name}
                          {def.kind !== 'ore' && def.kind !== 'mineral' ? (
                            <span className="app-dim">（{ITEM_KIND_LABELS[def.kind]}）</span>
                          ) : null}
                        </span>
                        <span className="app-inv-count">
                          ×{units.toLocaleString('zh-CN')}（{m3(units * def.unitM3)}）· 市场收价 {buy !== undefined ? `${isk(buy)} ISK` : '—'}
                        </span>
                      </div>
                      <div className="app-inv-btns">
                        {LOADABLE_KINDS.has(def.kind) ? (
                          <button className="app-btn is-small" onClick={() => handleLoad(id)}>
                            装到船上
                          </button>
                        ) : null}
                        {buy !== undefined ? (
                          <button className="app-btn is-small is-primary" onClick={() => handleSell(id)}>
                            市价卖出全部
                          </button>
                        ) : (
                          <button className="app-btn is-small" disabled>
                            不在市场目录
                          </button>
                        )}
                      </div>
                    </ItemHover>
                  )
                })}
              </ul>
            )}
          </Panel>
        )
      })}
    </div>
  )
}
