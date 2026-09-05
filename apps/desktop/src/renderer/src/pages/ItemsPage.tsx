/**
 * 物品页（货仓并入物品界面，2026-09-04 船长定）：选项页划分「仓库 / 货仓」。
 * - 仓库 tab：物品仓库（无限容量、不随船、永不遗失）——按大类分组展示矿石/矿物/
 *   气体/冰矿/弹药/无人机，并新增「装备」分组（装备库 moduleBay：制造/购入的装备），
 *   矿石/气体/冰矿可装船或卖出，矿物是制造料；
 * - 货仓 tab：原货仓页（T3 船选择条 / 驾驶船可装卸出售，副船只读）整体并入。
 */
import { useState } from 'react'
import { ITEM_KIND_LABELS, ITEM_KIND_ORDER, itemKindLabel, marketGoodOf, SLOT_LABELS } from '@whale/core'
import { Panel } from '@whale/ui'
import { ItemHover } from '../ui/shipInfo'
import { Glyph, toneOf } from '../ui/Glyphs'
import { ItemActionModal } from '../ui/ItemActionModal'
import { ItemGlyphGrid, ItemViewBar, useItemView, type ItemGridCell } from '../ui/itemView'
import { SellQtyModal } from '../ui/SellQtyModal'
import type { PageProps } from './common'
import { isk, itemBuyQuote, m3 } from './common'
import { CargoPage } from './CargoPage'

type ItemsTab = 'warehouse' | 'cargo'

/** 仓库主视图（含装备库分组） */
function WarehouseView({ engine, onToast }: PageProps) {
  const state = engine.state
  const rows = Object.entries(state.warehouse.items).filter(([, n]) => n > 0)
  const modRows = Object.entries(state.moduleBay).filter(([, n]) => n > 0)

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

  function handleLoad(id: string): void {
    const def = engine.ctx.items.get(id)
    if (!def) return
    const loaded = engine.loadWareToCargoFit(id)
    if (loaded === 0) onToast('船上没有足够空间。', true)
    else {
      onToast(`已装船 ${def.name}×${loaded.toLocaleString('zh-CN')}。`)
      setPickItem(null)
    }
  }

  // 出售数量选择（船长 2026-09-05：支持只卖一部分）
  const [sellItem, setSellItem] = useState<string | null>(null)
  const [sellMod, setSellMod] = useState<string | null>(null)
  function handleSellQtyItem(id: string, qty: number): void {
    const r = engine.sellWare(id, qty)
    if (!r.ok) onToast(r.error ?? '出售失败', true)
    else onToast(`已按市价售出 ${r.soldUnits.toLocaleString('zh-CN')} 单位，入账 ${r.gainedIsk.toLocaleString('zh-CN')} ISK。`)
    setSellItem(null)
    setPickItem(null)
  }
  function handleSellQtyMod(id: string, qty: number): void {
    const good = marketGoodOf(engine.ctx, 'module', id)
    if (!good) {
      onToast('该装备不在市场流通目录（无法出售）。', true)
      setSellMod(null)
      setPickMod(null)
      return
    }
    const r = engine.sellHoldingAt(good.key, qty)
    if (!r.ok) onToast(r.error ?? '出售失败', true)
    else onToast(`已按市价售出装备（簿吃穿余量自动挂卖单）。`)
    setSellMod(null)
    setPickMod(null)
  }

  // 图标模式点选操作（船长 2026-09-05：网格也要能操作）
  const [pickItem, setPickItem] = useState<string | null>(null)
  const [pickMod, setPickMod] = useState<string | null>(null)
  const pickItemDef = pickItem ? engine.ctx.items.get(pickItem) : undefined
  const pickItemUnits = pickItem ? (state.warehouse.items[pickItem] ?? 0) : 0
  const pickItemBuy = pickItem ? itemBuyQuote(engine, pickItem) : undefined
  const pickModDef = pickMod ? engine.ctx.modules.get(pickMod) : undefined
  const pickModUnits = pickMod ? (state.moduleBay[pickMod] ?? 0) : 0

  // 图标/列表切换（手册同款；网格为浏览视图）
  const [mode, setMode] = useItemView()
  const kindCells: ItemGridCell[] = []
  const modCells: ItemGridCell[] = []
  for (const [id, units] of rows) {
    const def = engine.ctx.items.get(id)
    if (!def) continue
    kindCells.push({
      key: id,
      glyph: def.kind,
      name: def.name,
      sub: `×${units.toLocaleString('zh-CN')} · ${m3(units * def.unitM3)}`,
      title: def.description,
    })
  }
  for (const [id, units] of modRows) {
    const def = engine.ctx.modules.get(id)
    if (!def) continue
    modCells.push({ key: id, glyph: def.slot, name: def.name, sub: `×${units.toLocaleString('zh-CN')}`, title: def.description })
  }

  return (
    <>
      <ItemViewBar mode={mode} onChange={setMode} />
      {mode === 'list' ? (
        <>
      <Panel title="仓库" right={<span className="app-dim">无限容量 · 不随船 · 永不遗失</span>}>
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
            title={`${itemKindLabel(kind)}`}
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
                          <button className="app-btn is-small is-primary" onClick={() => setSellItem(id)}>
                            市价卖出
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

      <Panel
        title="装备（装备库）"
        right={<span className="app-dim">{modRows.length} 种 · 空间站库存</span>}
      >
        {modRows.length === 0 ? (
          <div className="app-dim app-inv-empty">
            装备库还是空的——在「市场」页购买或在「工业」页制造装备后，装备会先存放于此，再到「装配」页安装上船。
          </div>
        ) : (
          <ul className="app-inv-list">
            {modRows.map(([id, units]) => {
              const def = engine.ctx.modules.get(id)
              if (!def) return null
              const modGood = marketGoodOf(engine.ctx, 'module', id)
              return (
                <li key={id} className="app-inv-row" title={def.description}>
                  <div className="app-inv-main">
                    <span className="app-inv-name">{def.name}</span>
                    <span className="app-inv-count">
                      ×{units.toLocaleString('zh-CN')} · {SLOT_LABELS[def.slot] ?? def.slot} · CPU {def.cpuUse}
                      {def.dmgMult !== undefined ? ` · 火力 ×${def.dmgMult}` : ''}
                    </span>
                  </div>
                  <div className="app-inv-btns">
                    <button className="app-btn is-small" disabled title="安装与卸下请到「装配」页">
                      装配页使用
                    </button>
                    {modGood && modGood.playerSellable !== false ? (
                      <button className="app-btn is-small is-primary" onClick={() => setSellMod(id)}>
                        市价卖出
                      </button>
                    ) : (
                      <button className="app-btn is-small" disabled title="不在市场流通目录或不可售">
                        不在市场目录
                      </button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>
        </>
      ) : (
        <>
          <div className="app-dim app-note">图标视图：点击任意物品/装备卡片即可执行装卸、卖出等操作。</div>
          <Panel title="仓库资源" right={<span className="app-dim">{kindCells.length} 种</span>}>
            {kindCells.length > 0 ? (
              <ItemGlyphGrid cells={kindCells} onPick={(key) => setPickItem(key)} />
            ) : (
              <div className="app-dim app-inv-empty">仓库里没有资源（自动卸货的矿会先到这里）。</div>
            )}
          </Panel>
          <Panel title="装备（装备库）" right={<span className="app-dim">{modCells.length} 种 · 空间站库存</span>}>
            {modCells.length > 0 ? (
              <ItemGlyphGrid cells={modCells} onPick={(key) => setPickMod(key)} />
            ) : (
              <div className="app-dim app-inv-empty">装备库是空的——购买 / 制造后先存放于此，再到「装配」页安装。</div>
            )}
          </Panel>

          {pickItemDef && pickItem ? (
            <ItemActionModal onClose={() => setPickItem(null)}>
              <div className="app-itempick-head">
                <span className="app-itempick-icon">
                  <Glyph name={pickItemDef.kind} size={40} color={toneOf(pickItemDef.kind)} />
                </span>
                <div className="app-itempick-info">
                  <div className="app-itempick-name">{pickItemDef.name}</div>
                  <div className="app-dim">
                    ×{pickItemUnits.toLocaleString('zh-CN')}（{m3(pickItemUnits * pickItemDef.unitM3)}）· 市场收价{' '}
                    {pickItemBuy !== undefined ? `${isk(pickItemBuy)} ISK` : '—'}
                  </div>
                </div>
              </div>
              <div className="app-dim app-itempick-note">{pickItemDef.description}</div>
              <div className="app-itempick-actions">
                {LOADABLE_KINDS.has(pickItemDef.kind) ? (
                  <button className="app-btn is-small" onClick={() => handleLoad(pickItem)}>
                    装到船上
                  </button>
                ) : null}
                {pickItemBuy !== undefined ? (
                  <button
                    className="app-btn is-primary is-small"
                    onClick={() => {
                      setPickItem(null)
                      setSellItem(pickItem)
                    }}
                  >
                    市价卖出
                  </button>
                ) : (
                  <button className="app-btn is-small" disabled>
                    不在市场目录（无法出售）
                  </button>
                )}
              </div>
            </ItemActionModal>
          ) : null}

          {pickModDef && pickMod ? (
            <ItemActionModal onClose={() => setPickMod(null)}>
              <div className="app-itempick-head">
                <span className="app-itempick-icon">
                  <Glyph name={pickModDef.slot} size={40} color={toneOf(pickModDef.slot)} />
                </span>
                <div className="app-itempick-info">
                  <div className="app-itempick-name">{pickModDef.name}</div>
                  <div className="app-dim">
                    ×{pickModUnits.toLocaleString('zh-CN')} · {SLOT_LABELS[pickModDef.slot] ?? pickModDef.slot} · CPU{' '}
                    {pickModDef.cpuUse}
                  </div>
                </div>
              </div>
              <div className="app-dim app-itempick-note">{pickModDef.description}</div>
              <div className="app-itempick-actions">
                <button className="app-btn is-small" title="安装与卸下请到「装配」页">
                  装配页使用
                </button>
                {marketGoodOf(engine.ctx, 'module', pickMod) ? (
                  <button
                    className="app-btn is-primary is-small"
                    onClick={() => {
                      setPickMod(null)
                      setSellMod(pickMod)
                    }}
                  >
                    市价卖出（×{pickModUnits.toLocaleString('zh-CN')}）
                  </button>
                ) : (
                  <button className="app-btn is-small" disabled>
                    不在市场目录（无法出售）
                  </button>
                )}
              </div>
            </ItemActionModal>
          ) : null}

          {/* 出售数量选择（部分出售；船长 2026-09-05） */}
          {sellItem ? (() => {
            const def = engine.ctx.items.get(sellItem)
            if (!def) return null
            const units = state.warehouse.items[sellItem] ?? 0
            const buy = itemBuyQuote(engine, sellItem)
            return (
              <SellQtyModal
                name={def.name}
                glyph={def.kind}
                max={units}
                unit="单位"
                priceText={buy !== undefined ? `收价 ${isk(buy)} ISK/单位` : undefined}
                note={def.description}
                onClose={() => setSellItem(null)}
                onConfirm={(qty) => handleSellQtyItem(sellItem, qty)}
              />
            )
          })() : null}
          {sellMod ? (() => {
            const def = engine.ctx.modules.get(sellMod)
            if (!def) return null
            const units = state.moduleBay[sellMod] ?? 0
            return (
              <SellQtyModal
                name={def.name}
                glyph={def.slot}
                max={units}
                unit="件"
                note={def.description}
                onClose={() => setSellMod(null)}
                onConfirm={(qty) => handleSellQtyMod(sellMod, qty)}
              />
            )
          })() : null}
        </>
      )}
    </>
  )
}

export function ItemsPage(props: PageProps) {
  const [tab, setTab] = useState<ItemsTab>('warehouse')
  return (
    <div className="page-stack">
      {/* 功能标签页（与星图页同款 app-subtabs 规范） */}
      <div className="app-subtabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'warehouse'}
          className={`app-subtab${tab === 'warehouse' ? ' is-active' : ''}`}
          onClick={() => setTab('warehouse')}
        >
          <span>▤</span>
          <span>仓库</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === 'cargo'}
          className={`app-subtab${tab === 'cargo' ? ' is-active' : ''}`}
          onClick={() => setTab('cargo')}
        >
          <span>▣</span>
          <span>货仓</span>
        </button>
      </div>
      {tab === 'cargo' ? <CargoPage {...props} /> : <WarehouseView {...props} />}
    </div>
  )
}
