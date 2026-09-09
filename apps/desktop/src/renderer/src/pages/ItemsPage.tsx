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
import { ItemHover, InfoTable, itemInfoLines, moduleInfoLines } from '../ui/shipInfo'
import { Glyph, toneOf } from '../ui/Glyphs'
import { ItemActionModal } from '../ui/ItemActionModal'
import { ItemGlyphGrid, ItemViewBar, kindExtraNote, useItemView, type ItemGridCell } from '../ui/itemView'
import { SellQtyModal } from '../ui/SellQtyModal'
import type { PageProps } from './common'
import { isk, itemBuyQuote, m3 } from './common'
import { CargoPage } from './CargoPage'

type ItemsTab = 'warehouse' | 'cargo'

/** 物品页附加导航：跳市场页并聚焦某商品订单（船长 2026-09-05：市价卖出旁加"查看市场"） */
export interface ItemNavProps {
  onGotoMarket: (goodKey: string) => void
}

/** 仓库主视图（含装备库分组） */
function WarehouseView({ engine, onToast, onGotoMarket }: PageProps & ItemNavProps) {
  const state = engine.state
  // 仓库搜索（2026-09-09 船长：标题内搜索栏，按名称/分类/说明过滤仓库物品与装备库）
  const [wareQuery, setWareQuery] = useState('')
  const wq = wareQuery.trim().toLowerCase()
  const rows = Object.entries(state.warehouse.items).filter(([, n]) => n > 0)
  const modRows = Object.entries(state.moduleBay).filter(([, n]) => n > 0)
  const hitItem = (id: string): boolean => {
    if (wq.length === 0) return true
    const def = engine.ctx.items.get(id)
    if (!def) return false
    return (
      def.name.toLowerCase().includes(wq) ||
      (ITEM_KIND_LABELS[def.kind] ?? '').toLowerCase().includes(wq) ||
      (def.description ?? '').toLowerCase().includes(wq)
    )
  }
  const hitMod = (id: string): boolean => {
    if (wq.length === 0) return true
    const def = engine.ctx.modules.get(id)
    if (!def) return false
    return (
      def.name.toLowerCase().includes(wq) ||
      (SLOT_LABELS[def.slot] ?? '').toLowerCase().includes(wq) ||
      (def.description ?? '').toLowerCase().includes(wq)
    )
  }
  const itemHits = wq.length > 0 ? rows.filter(([id]) => hitItem(id)) : rows
  const modHits = wq.length > 0 ? modRows.filter(([id]) => hitMod(id)) : modRows
  const hitTotal = itemHits.length + modHits.length

  // 2026-09-09（船长口径 A）：任何仓库物品都可装船携带（引擎按各自体积装；矿物/弹药/无人机亦同）；
  // 装备（模块）装船见 handleLoadMod（占位 1 m³/件）

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

  /** 快速查看市场订单（参照舰船市场入口：跳市场页并聚焦该商品；船长 2026-09-05） */
  function goMarket(kind: 'item' | 'module', id: string): void {
    const good = marketGoodOf(engine.ctx, kind, id)
    if (good) onGotoMarket(good.key)
  }

  /** 2026-09-09（船长口径 A）：装备装船 = 携带（占位 1 m³/件，从装备库扣）；装配台取料仍只认装备库 */
  function handleLoadMod(id: string): void {
    const def = engine.ctx.modules.get(id)
    const loaded = engine.loadWareToCargoFit(id)
    if (loaded === 0) onToast('船上没有足够空间（模块装船占位 1 m³/件）。', true)
    else onToast(`已装船 ${def?.name ?? id}×${loaded.toLocaleString('zh-CN')}（占位 1 m³/件；装配请先卸回装备库）。`)
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
  const modCells: ItemGridCell[] = []
  for (const [id, units] of modHits) {
    const def = engine.ctx.modules.get(id)
    if (!def) continue
    modCells.push({ key: id, glyph: def.slot, name: def.name, sub: `×${units.toLocaleString('zh-CN')}`, title: def.description })
  }

  return (
    <>
      {/* 仓库抬头：图标/列表切换 + 搜索栏同排于标题行，两种视图都显示（2026-09-09 船长）；
          样式与技能目录标题栏一致——机制细节见手册玩法速览（装卸/精炼/制造条目），此处不再铺说明段 */}
      <Panel
        title="仓库"
        right={
          <span className="app-head-search-wrap">
            <ItemViewBar mode={mode} onChange={setMode} />
            <input
              className="app-head-search"
              type="text"
              placeholder="搜索仓库…"
              value={wareQuery}
              onChange={(e) => setWareQuery(e.target.value)}
              spellCheck={false}
            />
            <span className="app-dim">
              {wq.length > 0 ? `匹配 ${hitTotal} 种` : `${hitTotal} 种 · 无限容量 · 不随船`}
            </span>
          </span>
        }
      >
        {null}
      </Panel>
      {wq.length > 0 && hitTotal === 0 ? (
        <div className="app-dim app-note">
          没有匹配「{wareQuery.trim()}」的仓库物品或装备——换个关键词试试（支持名称/分类/说明）。
        </div>
      ) : null}
      {mode === 'list' ? (
        <>
      {ITEM_KIND_ORDER.map((kind) => {
        const kindRows = rows.filter(([id]) => engine.ctx.items.get(id)?.kind === kind && hitItem(id))
        // 矿石/矿物面板常驻（引导文案有教学作用），其余分类空时不显示；搜索时任一空类都隐藏
        if (kindRows.length === 0 && (kind !== 'ore' && kind !== 'mineral' || wq.length > 0)) return null
        return (
          <Panel
            key={kind}
            title={`${itemKindLabel(kind)}`}
            right={<span className="app-dim">{kindRows.length} 种</span>}
          >
            {kindExtraNote(kind) ? (
              <div className="app-dim app-note">{kindExtraNote(kind)}</div>
            ) : null}
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
                        <button className="app-btn is-small" onClick={() => handleLoad(id)} title="装到当前驾驶船的货仓（按单位体积占舱；停靠空间站时装卸）">
                          装到船上
                        </button>
                        {buy !== undefined ? (
                          <button className="app-btn is-small is-primary" onClick={() => setSellItem(id)}>
                            市价卖出
                          </button>
                        ) : (
                          <button className="app-btn is-small" disabled>
                            不在市场目录
                          </button>
                        )}
                        {marketGoodOf(engine.ctx, 'item', id) ? (
                          <button
                            className="app-btn is-small"
                            title="前往市场查看该物品的订单（价格/挂单/买入）"
                            onClick={() => goMarket('item', id)}
                          >
                            ↖ 查看市场
                          </button>
                        ) : null}
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
        {modHits.length === 0 ? (
          <div className="app-dim app-inv-empty">
            {wq.length > 0
              ? `没有匹配「${wareQuery.trim()}」的装备。`
              : '装备库还是空的——在「市场」页购买或在「工业」页制造装备后，装备会先存放于此，再到「装配」页安装上船。'}
          </div>
        ) : (
          <ul className="app-inv-list">
            {modHits.map(([id, units]) => {
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
                    <button
                      className="app-btn is-small"
                      onClick={() => handleLoadMod(id)}
                      title="装入船货仓携带（占位 1 m³/件）；安装到槽位请到「装配」页——装配台取料自装备库，船上装备需先卸回"
                    >
                      装到船上
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
                    {modGood ? (
                      <button
                        className="app-btn is-small"
                        title="前往市场查看该装备的订单（价格/挂单/买入）"
                        onClick={() => goMarket('module', id)}
                      >
                        ↖ 查看市场
                      </button>
                    ) : null}
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
          <div className="app-dim app-note">图标视图：按类型分组，点击任意卡片即可执行装卸、卖出等操作。</div>
          {ITEM_KIND_ORDER.map((kind) => {
            const kindRows2 = rows.filter(([id]) => engine.ctx.items.get(id)?.kind === kind && hitItem(id))
            if (kindRows2.length === 0 && (kind !== 'ore' && kind !== 'mineral' || wq.length > 0)) return null
            const cells: ItemGridCell[] = kindRows2.map(([id, units]) => {
              const def = engine.ctx.items.get(id)
              return {
                key: id,
                glyph: def?.kind ?? kind,
                name: def?.name ?? id,
                sub: `×${units.toLocaleString('zh-CN')} · ${m3(units * (def?.unitM3 ?? 1))}`,
                title: def?.description,
              }
            })
            return (
              <Panel
                key={kind}
                title={`${itemKindLabel(kind)}`}
                right={<span className="app-dim">{kindRows2.length} 种</span>}
              >
                {kindExtraNote(kind) ? (
                  <div className="app-dim app-note">{kindExtraNote(kind)}</div>
                ) : null}
                {kindRows2.length === 0 ? (
                  <div className="app-dim app-inv-empty">{KIND_EMPTY[kind] ?? '仓库里没有该分类物品。'}</div>
                ) : (
                  <ItemGlyphGrid cells={cells} onPick={(key) => setPickItem(key)} />
                )}
              </Panel>
            )
          })}
          <Panel title="装备（装备库）" right={<span className="app-dim">{modCells.length} 种 · 空间站库存</span>}>
            {modCells.length > 0 ? (
              <ItemGlyphGrid cells={modCells} onPick={(key) => setPickMod(key)} />
            ) : (
              <div className="app-dim app-inv-empty">
                {wq.length > 0
                  ? `没有匹配「${wareQuery.trim()}」的装备。`
                  : '装备库是空的——购买 / 制造后先存放于此，再到「装配」页安装。'}
              </div>
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
              {/* 2026-09-08 船长反馈：图标模式信息太少——与列表模式悬浮窗同源信息表（种类/体积/收价/精炼配方/弹药无人机战斗行/修理件） */}
              <InfoTable lines={itemInfoLines(pickItemDef, (id) => engine.ctx.items.get(id)?.name)} />
              <div className="app-dim app-itempick-note">{pickItemDef.description}</div>
              <div className="app-itempick-actions">
                <button className="app-btn is-small" onClick={() => handleLoad(pickItem)} title="装到当前驾驶船的货仓（按单位体积占舱）">
                  装到船上
                </button>
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
                {marketGoodOf(engine.ctx, 'item', pickItem) ? (
                  <button
                    className="app-btn is-small"
                    title="前往市场查看该物品的订单（价格/挂单/买入）"
                    onClick={() => {
                      setPickItem(null)
                      goMarket('item', pickItem)
                    }}
                  >
                    ↖ 查看市场订单
                  </button>
                ) : null}
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
              {/* 2026-09-08：装备弹层补与悬浮同源信息表（槽位/类型/CPU/效果参数） */}
              <InfoTable lines={moduleInfoLines(pickModDef)} />
              <div className="app-dim app-itempick-note">{pickModDef.description}</div>
              <div className="app-itempick-actions">
                <button
                  className="app-btn is-small"
                  onClick={() => handleLoadMod(pickMod)}
                  title="装入船货仓携带（占位 1 m³/件）；安装到槽位请到「装配」页（装配台取料自装备库，船上装备需先卸回）"
                >
                  装到船上
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
                {marketGoodOf(engine.ctx, 'module', pickMod) ? (
                  <button
                    className="app-btn is-small"
                    title="前往市场查看该装备的订单（价格/挂单/买入）"
                    onClick={() => {
                      setPickMod(null)
                      goMarket('module', pickMod)
                    }}
                  >
                    ↖ 查看市场订单
                  </button>
                ) : null}
              </div>
            </ItemActionModal>
          ) : null}

          {/* 出售数量弹层已提升到列表/图标两模式共用的外层（见组件 return 尾部） */}
        </>
      )}

      {/* 出售数量选择（部分出售；船长 2026-09-05）——列表/图标两模式共用（2026-09-08 修复：
         原误置于图标模式分支内，列表模式点「市价卖出」设了状态却无弹层渲染 = 点击无反应） */}
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
  )
}

export function ItemsPage(props: PageProps & Partial<ItemNavProps>) {
  const [tab, setTab] = useState<ItemsTab>('warehouse')
  return (
    <div className="page-stack page-fill">
      {/* 功能标签页（与星图页同款 app-subtabs 规范）；标签行固定 */}
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
      {/* 船长拍板：物品页整标签一窗滚——活跃标签内容包进二级滚动窗（CargoPage 内层不再产生双滚动） */}
      <div className="app-win-body">
        {tab === 'cargo' ? (
          <CargoPage {...props} onGotoMarket={props.onGotoMarket ?? (() => undefined)} />
        ) : (
          <WarehouseView {...props} onGotoMarket={props.onGotoMarket ?? (() => undefined)} />
        )}
      </div>
    </div>
  )
}
