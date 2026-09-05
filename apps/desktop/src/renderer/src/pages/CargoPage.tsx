/**
 * 货仓页（T3）：顶部"查看船"选择条可切换查看舰队任一艘船的货仓。
 * - 每艘船一枚 chip：船名 + （驾驶中）标记 + 出勤徽标（shipBusyLabel）；
 * - 默认查看驾驶船；驾驶船变更后自动跟随；选中船不存在（卖/弃船）自动回驾驶船；
 * - 动作隔离（已确认口径 1甲/2甲/3甲）：装卸与出售只对"当前驾驶船"开放，
 *   副船/作业中的船一律只读查看。
 * - V10：按物品大类分组展示（矿石/矿物/气体/冰矿/弹药/无人机）。
 */
import { useEffect, useState } from 'react'
import {
  ITEM_KIND_ORDER,
  cargoCapacityM3Of,
  cargoOfShip,
  cargoUsedM3Of,
  fleetDefOf,
  itemKindLabel,
  marketGoodOf,
  shipBusyLabel,
  shipDisplayName,
} from '@whale/core'
import { Panel, ProgressBar } from '@whale/ui'
import { ItemHover } from '../ui/shipInfo'
import { Glyph, toneOf } from '../ui/Glyphs'
import { ItemActionModal } from '../ui/ItemActionModal'
import { SellQtyModal } from '../ui/SellQtyModal'
import type { ItemNavProps } from './ItemsPage'
import type { PageProps } from './common'
import { isk, itemBuyQuote, m3 } from './common'
import { ItemGlyphGrid, ItemViewBar, useItemView, type ItemGridCell } from '../ui/itemView'

const KIND_EMPTY: Record<string, string> = {
  ore: '船上没有矿石——到「出港」页开采。',
  mineral: '船上没有矿物（精炼产物直接入仓库）。',
  gas: '船上没有气体。',
  ice: '船上没有冰矿。',
  ammo: '船上没有弹药。',
  drone: '船上没有无人机。',
}

export function CargoPage({ engine, onToast, onGotoMarket }: PageProps & ItemNavProps) {
  const state = engine.state
  const piloted = state.shipId
  const [selId, setSelId] = useState<string>(piloted)
  // 驾驶船变更 → 查看跟随驾驶船（本页历史职责是"驾驶船货仓"，选副船只是临时查看）
  useEffect(() => {
    setSelId(piloted)
  }, [piloted])
  const fleetIds = Object.keys(state.fleet)
  const targetId = fleetIds.includes(selId) ? selId : piloted
  const isPiloted = targetId === piloted
  const targetName = shipDisplayName(state, engine.ctx, targetId)
  const busy = shipBusyLabel(state, engine.ctx, targetId)

  const cargo = cargoOfShip(state, targetId)
  const used = cargoUsedM3Of(state, engine.ctx, targetId)
  const cap = cargoCapacityM3Of(state, engine.ctx, targetId)
  const rows = Object.entries(cargo).filter(([, n]) => n > 0)

  // 图标/列表切换（手册同款；网格为浏览视图）
  const [view, setView] = useItemView()
  const cargoCells: ItemGridCell[] = rows
    .map(([id, units]) => {
      const def = engine.ctx.items.get(id)
      if (!def) return null
      return {
        key: id,
        glyph: def.kind,
        name: def.name,
        sub: `×${units.toLocaleString('zh-CN')} · ${m3(units * def.unitM3)}`,
        title: def.description,
      }
    })
    .filter(Boolean) as ItemGridCell[]

  function handleSell(id: string, qty: number): void {
    // T9：出售/市场只在母港（副站不设市场）
    if (state.awayGalaxy !== null || state.dockedSite !== null) {
      onToast('出售需回到母港市场（当前在野外或副空间站）。', true)
      return
    }
    const r = engine.sellCargo(id, qty)
    if (!r.ok) onToast(r.error ?? '出售失败', true)
    else onToast(`已售出 ${r.soldUnits.toLocaleString('zh-CN')} 单位，入账 ${r.gainedIsk.toLocaleString('zh-CN')} ISK。`)
    setSellId(null)
    setPickId(null)
  }

  // 图标模式点选操作（船长 2026-09-05：网格也要能操作）
  const [pickId, setPickId] = useState<string | null>(null)
  const pickDef = pickId ? engine.ctx.items.get(pickId) : undefined
  const pickUnits = pickId ? (cargo[pickId] ?? 0) : 0
  const pickBuy = pickId ? itemBuyQuote(engine, pickId) : undefined
  // 出售数量选择（船长 2026-09-05：支持只卖一部分）
  const [sellId, setSellId] = useState<string | null>(null)
  const sellDef = sellId ? engine.ctx.items.get(sellId) : undefined
  const sellUnits = sellId ? (cargo[sellId] ?? 0) : 0
  const sellBuy = sellId ? itemBuyQuote(engine, sellId) : undefined

  /** 快速查看市场订单（参照舰船市场入口：跳市场页并聚焦该商品；船长 2026-09-05） */
  function goMarket(id: string): void {
    const good = marketGoodOf(engine.ctx, 'item', id)
    if (good) onGotoMarket(good.key)
  }

  function handleUnloadAll(): void {
    // T9：卸货入仓库在任何空间站可用（母港与副站）
    if (state.awayGalaxy !== null) {
      onToast('舰船在野外：卸货需停靠空间站（母港或副站，可先「返航空间站」）。', true)
      return
    }
    const moved = engine.unloadAllToWarehouse()
    if (moved === 0) onToast('货仓是空的。', true)
    else onToast(`已把 ${moved.toLocaleString('zh-CN')} 单位货物卸入物品仓库。`)
  }

  return (
    <div className="page-stack">
      <Panel
        title="货仓"
        right={
          isPiloted ? <span className="app-dim">当前驾驶船</span> : <span className="app-dim">查看中 · 只读</span>
        }
      >
        <div className="app-cargo-ships">
          {fleetIds.map((id) => {
            const d = fleetDefOf(state, engine.ctx, id)
            const b = shipBusyLabel(state, engine.ctx, id)
            const isP = id === piloted
            const isSel = id === targetId
            return (
              <button
                key={id}
                className={`app-shipchip${isSel ? ' is-active' : ''}${isP ? ' is-piloted' : ''}`}
                onClick={() => setSelId(id)}
                title={isP ? '当前驾驶船' : b ?? '该船闲置中'}
              >
                <span className="app-shipchip-name">
                  {d ? <span className={`app-role-dot is-${d.role}`} /> : null}
                  {shipDisplayName(state, engine.ctx, id)}
                </span>
                {isP ? <span className="app-shipchip-tag">驾驶中</span> : null}
                {b ? <span className="app-shipchip-busy">·{b}</span> : null}
              </button>
            )
          })}
        </div>
        <div className="app-cargo-head">
          <ProgressBar
            value={cap > 0 ? (used / cap) * 100 : 0}
            tone={cap > 0 && used / cap > 0.85 ? 'danger' : cap > 0 && used / cap > 0.6 ? 'warn' : 'normal'}
            label={`${targetName} · 已占用 ${m3(used)} / ${cap > 0 ? cap.toLocaleString('zh-CN') : '—'} m³`}
          />
          {isPiloted ? (
            <button className="app-btn is-primary is-small" onClick={handleUnloadAll} disabled={rows.length === 0}>
              全部卸入仓库
            </button>
          ) : null}
        </div>
        {isPiloted ? (
          <div className="app-dim app-note">
            货仓随船：采集与远征战利品都先落在这里；弃船会连同本页内容一起遗失。
            资源可以在此直接卖出，或卸入仓库后再处理。
            {busy ? ` 当前：${busy}。` : ''}
          </div>
        ) : (
          <div className="app-dim app-note">
            正在查看「{targetName}」的货仓——只读查看：装卸与出售仅对当前驾驶船「
            {shipDisplayName(state, engine.ctx, piloted)}」可用。
            {busy ? ` 该船当前：${busy}。` : ' 该船闲置中。'}
          </div>
        )}
      </Panel>

      <ItemViewBar mode={view} onChange={setView} />
      {view === 'list' ? (
        <>
      {ITEM_KIND_ORDER.map((kind) => {
        const kindRows = rows.filter(([id]) => engine.ctx.items.get(id)?.kind === kind)
        // 矿石面板常驻（引导开采），其余分类空时不显示
        if (kindRows.length === 0 && kind !== 'ore') return null
        const emptyText =
          kind === 'ore' && !isPiloted
            ? `「${targetName}」的货仓里没有矿石。`
            : KIND_EMPTY[kind] ?? '货仓里没有该分类的货物。'
        return (
          <Panel
            key={kind}
            title={`${itemKindLabel(kind)}（${isPiloted ? '驾驶船' : '查看中'}）`}
            right={<span className="app-dim">{kindRows.length} 种</span>}
          >
            {kindRows.length === 0 ? (
              <div className="app-dim app-inv-empty">{emptyText}</div>
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
                        <span className="app-inv-name">{def.name}</span>
                        <span className="app-inv-count">
                          ×{units.toLocaleString('zh-CN')}（{m3(units * def.unitM3)}）· 市场收价{' '}
                          {buy !== undefined ? `${isk(buy)} ISK` : '—'}
                        </span>
                      </div>
                      <div className="app-inv-btns">
                        {isPiloted && buy !== undefined ? (
                          <>
                            <button className="app-btn is-small is-primary" onClick={() => setSellId(id)}>
                              市价卖出
                            </button>
                            <button
                              className="app-btn is-small"
                              title="前往市场查看该物品的订单（价格/挂单/买入）"
                              onClick={() => goMarket(id)}
                            >
                              ↖ 查看市场
                            </button>
                          </>
                        ) : isPiloted ? (
                          <button className="app-btn is-small" disabled>
                            不在市场目录
                          </button>
                        ) : (
                          <span className="app-dim app-sr-eta">只读查看</span>
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
        </>
      ) : (
        <>
          <Panel title="货仓资源" right={<span className="app-dim">{cargoCells.length} 种 · 图标视图（点卡片操作）</span>}>
            {cargoCells.length > 0 ? (
              <ItemGlyphGrid cells={cargoCells} onPick={(key) => setPickId(key)} />
            ) : (
              <div className="app-dim app-inv-empty">货仓是空的——采集与战利品会先落到这里。</div>
            )}
          </Panel>

          {pickDef && pickId ? (
            <ItemActionModal onClose={() => setPickId(null)}>
              <div className="app-itempick-head">
                <span className="app-itempick-icon">
                  <Glyph name={pickDef.kind} size={40} color={toneOf(pickDef.kind)} />
                </span>
                <div className="app-itempick-info">
                  <div className="app-itempick-name">{pickDef.name}</div>
                  <div className="app-dim">
                    ×{pickUnits.toLocaleString('zh-CN')}（{m3(pickUnits * pickDef.unitM3)}）· 市场收价{' '}
                    {pickBuy !== undefined ? `${isk(pickBuy)} ISK` : '—'}
                  </div>
                </div>
              </div>
              <div className="app-dim app-itempick-note">{pickDef.description}</div>
              <div className="app-itempick-actions">
                {!isPiloted ? (
                  <div className="app-dim">正在查看「{targetName}」——只读：装卸与出售仅对当前驾驶船可用。</div>
                ) : pickBuy !== undefined ? (
                  <button
                    className="app-btn is-primary is-small"
                    onClick={() => {
                      setPickId(null)
                      setSellId(pickId)
                    }}
                  >
                    市价卖出
                  </button>
                ) : (
                  <button className="app-btn is-small" disabled>
                    不在市场目录（无法出售）
                  </button>
                )}
                {pickId && marketGoodOf(engine.ctx, 'item', pickId) ? (
                  <button
                    className="app-btn is-small"
                    title="前往市场查看该物品的订单（价格/挂单/买入）"
                    onClick={() => {
                      setPickId(null)
                      goMarket(pickId)
                    }}
                  >
                    ↖ 查看市场订单
                  </button>
                ) : null}
              </div>
            </ItemActionModal>
          ) : null}

          {/* 出售数量选择（部分出售；船长 2026-09-05） */}
          {sellDef && sellId ? (
            <SellQtyModal
              name={sellDef.name}
              glyph={sellDef.kind}
              max={sellUnits}
              unit="单位"
              priceText={sellBuy !== undefined ? `收价 ${isk(sellBuy)} ISK/单位` : undefined}
              note={sellDef.description}
              onClose={() => setSellId(null)}
              onConfirm={(qty) => handleSell(sellId, qty)}
            />
          ) : null}
        </>
      )}
    </div>
  )
}
