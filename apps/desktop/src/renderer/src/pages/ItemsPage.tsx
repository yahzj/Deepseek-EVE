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
import { ItemHover, InfoTable, itemHoverContent, itemInfoLines, moduleHoverContent, ModuleHover, moduleInfoLines } from '../ui/shipInfo'
import { Glyph, inventoryItemTone, toneOf } from '../ui/Glyphs'
import { HintIcon } from '../ui/Hint'
import { ItemActionModal } from '../ui/ItemActionModal'
import { ItemGlyphGrid, ItemViewBar, RowGlyph, kindExtraNote, useItemView, type ItemGridCell } from '../ui/itemView'
import { SellQtyModal } from '../ui/SellQtyModal'
import { RedeemFragmentButton } from '../ui/fragmentRedeem'
import {
  CONTAINER_SUBS,
  CORE_SUBS,
  MODULE_SUBS,
  presentSubs,
  RACK_SUBS,
  SUB_ALL,
  WRECK_SUBS,
  itemBucketPasses,
  itemSubPasses,
  rackPasses,
} from '../ui/itemSubs'
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
  /* 仓库筛选（2026-09-13 船长：「物品界面的仓库也添加筛选」；2026-09-19 甲组补丁按船长
     「涉及到特定分类的父分类时，将其子分类也放入」补齐）：
     一级 = 各大类 + 「装备」；二级 = 该一级的天然子维度（装备→槽类 · 货柜/残骸/AI 核心→档位 ·
     碎片→功能分组）；三级 = 仅「装备」有（槽类 → 功能分组）。表与判定**全部走 `ui/itemSubs.ts` 单点**。
     与搜索取「与」；**不落盘**，切页/重开即重置（与市场、手册同一哲学）。 */
  const [wareKind, setWareKind] = useState<string>('all') // 一级「分类」：'all' = 全部（2026-09-19 基线②：一级选择器用 'all'，下级维度才用 SUB_ALL）
  const [wareSub, setWareSub] = useState<string>(SUB_ALL)
  const [wareFunc, setWareFunc] = useState<string>(SUB_ALL)
  /**
   * 一级筛选中（分类 / 装备）。
   * ⚠ 键口径（2026-09-19 基线②）：**一级选择器的"全部" = `'all'`**，`SUB_ALL` 只留给下级维度。
   */
  const kindPicked = wareKind !== 'all'
  /** 装备是否在展示范围内（「全部」与「装备」都在范围内；选了某个物品大类时装备库整块不显示） */
  const showMods = wareKind === 'all' || wareKind === 'module'
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
  /**
   * **一级 → 二级维度**（只有"有天然子维度"的一级才有；表与标题前缀都取单点表）。
   * AI 核心：仓库里只有物品形态的 gamma/beta/alpha（`basic` 只有市场商品）⇒ 按目录存在性列档。
   */
  const subDim: { options: typeof RACK_SUBS; label: string } | null = (() => {
    // 2026-09-20 筛选清理（船长「明显不存在的子类筛选隐藏」）：各档**只列仓库里真有内容的档**
    //（`rows` = 仓库物品条目 · `modRows` = 装备库条目；判定仍走单点 `rackPasses` / `itemSubPasses`）。
    if (wareKind === 'module') {
      return { options: presentSubs(RACK_SUBS, (key) => modRows.some(([id]) => rackPasses(engine.ctx, id, key))), label: '槽类' }
    }
    if (wareKind === 'container') {
      return { options: presentSubs(CONTAINER_SUBS, (key) => rows.some(([id]) => itemSubPasses(engine.ctx, id, 'container', key))), label: '档位' }
    }
    if (wareKind === 'wreck') {
      return { options: presentSubs(WRECK_SUBS, (key) => rows.some(([id]) => itemSubPasses(engine.ctx, id, 'wreck', key))), label: '档位' }
    }
    if (wareKind === 'aicore') {
      return { options: CORE_SUBS.filter((s) => engine.ctx.items.has(`ai-core-${s.key}`)), label: '档位' }
    }
    if (wareKind === 'fragment') {
      return { options: presentSubs(MODULE_SUBS, (key) => rows.some(([id]) => itemSubPasses(engine.ctx, id, 'fragment', key))), label: '功能' }
    }
    return null
  })()
  /** **三级维度**：只有「装备」有（槽类 → 功能分组），且**选了槽位才出**（基线③级联）；同样只列真有内容的档 */
  const funcDim =
    wareKind === 'module' && wareSub !== SUB_ALL
      ? presentSubs(MODULE_SUBS, (key) => modRows.some(([id]) => itemSubPasses(engine.ctx, id, 'module', key)))
      : null
  /**
   * 三个维度的判定一律走**唯一入口**（甲组·判定单点）：
   * 一级 `itemBucketPasses` · 二级 `rackPasses`（装备槽类）/ `itemSubPasses`（其余）· 三级 `itemSubPasses`；
   * 页面**不自写任何判定**。
   *
   * ⚠ **2026-09-19 报障修**（船长「仓库内，部分筛选标签无效（比如装备-高槽装备）」）：
   * 二级维度有两套**不同的键空间**——「装备」档的二级是**槽类**（`RACK_SUBS`：high/mid/low ⇒ 判据 `rackPasses`），
   * 其余各档的二级是 `itemSubPasses` 的子键（货柜四档 / 残骸两档 / 核心档位 / 碎片功能分组）。
   * 原先这里**一律**调 `itemSubPasses(ctx, id, 'module', wareSub)`，而那个入口对 `module` 桶认的是
   * **功能分组键**（`moduleSubKeyOf`：prod/weapon/…）⇒ 拿槽类键 `high` 去比**永远为假**：
   * 高/中/低三档一个都筛不出来（三级「功能」也跟着不可用，因为二级已经把一切筛空了）。
   */
  const subHit = (id: string): boolean => {
    if (!subDim || wareSub === SUB_ALL) return true
    return wareKind === 'module'
      ? rackPasses(engine.ctx, id, wareSub)
      : itemSubPasses(engine.ctx, id, wareKind, wareSub)
  }
  const dimHit = (id: string): boolean => {
    if (!itemBucketPasses(engine.ctx, id, wareKind)) return false
    if (!subHit(id)) return false
    if (funcDim && wareFunc !== SUB_ALL && !itemSubPasses(engine.ctx, id, 'module', wareFunc)) return false
    return true
  }
  const itemHits = rows.filter(([id]) => hitItem(id) && dimHit(id))
  const modHits = showMods ? modRows.filter(([id]) => hitMod(id) && dimHit(id)) : []
  const hitTotal = itemHits.length + modHits.length
  /** 搜索或筛选任一生效（标题计数与空态文案据此换措辞） */
  const wareNarrowed = wq.length > 0 || kindPicked || wareSub !== SUB_ALL || wareFunc !== SUB_ALL

  // 2026-09-09（船长口径 A）：任何仓库物品都可装船携带（引擎按各自体积装；矿物/弹药/无人机亦同）；
  // 装备（模块）装船见 handleLoadMod（按 1 m³/件 计入货舱）

  const KIND_EMPTY: Record<string, string> = {
    ore: '仓库里没有原矿（自动卸货的矿会先到这里）。',
    mineral: '还没有原材料——去「工业」页精炼资源。',
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

  /** 2026-09-09（船长口径 A）：装备装船 = 携带（按 1 m³/件 计入货舱，从装备库扣）；装配台取料仍只认装备库 */
  function handleLoadMod(id: string): void {
    const def = engine.ctx.modules.get(id)
    const loaded = engine.loadWareToCargoFit(id)
    if (loaded === 0) onToast('船上没有足够空间（模块按 1 m³/件 计入货舱）。', true)
    else onToast(`已装船 ${def?.name ?? id}×${loaded.toLocaleString('zh-CN')}（按 1 m³/件 计入货舱；装配请先卸回装备库）。`)
  }

  // 出售数量选择（船长 2026-09-05：支持只卖一部分）
  const [sellItem, setSellItem] = useState<string | null>(null)
  const [sellMod, setSellMod] = useState<string | null>(null)
  /** 丢弃数量选择（船长 2026-09-15：「仓库添加丢弃按钮，允许玩家丢弃任意数量已有物品」） */
  const [discardItem, setDiscardItem] = useState<string | null>(null)
  function handleSellQtyItem(id: string, qty: number): void {
    const r = engine.sellWare(id, qty)
    if (!r.ok) onToast(r.error ?? '出售失败', true)
    else onToast(`已按市价售出 ${r.soldUnits.toLocaleString('zh-CN')} 单位，入账 ${r.gainedIsk.toLocaleString('zh-CN')} 信用点。`)
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

  /**
   * **逆向解锁**（2026-09-19 玩家报障「回收残骸集齐了 25 个蓝图碎片，但是找不到在哪换成蓝图」）：
   * 蓝图碎片（`frag-<装备 id>`）在仓库里那一行直接兑换——读数与兑命令都收在
   * `ui/fragmentRedeem.tsx` 的 `RedeemFragmentButton`（core 单点 `fragmentRedeemRowsOf` +
   * `redeemFragments`；货仓页同一个组件），这里只留"哪些行是碎片"的判据。
   */
  const fragRows = new Set(engine.fragmentRedeemRows().map((r) => r.fragmentItemId))

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
  /**
   * 装备卡片（图标模式）——`hover` 挂**富卡**（`moduleHoverContent`：名称 + 参数表 + 描述），
   * 与列表模式的 `ModuleHover` 同一内容（船长 2026-09-19 报障：图标模式原先是纯文本简介）。
   */
  const modCells: ItemGridCell[] = []
  for (const [id, units] of modHits) {
    const def = engine.ctx.modules.get(id)
    if (!def) continue
    modCells.push({
      key: id,
      glyph: def.slot,
      name: def.name,
      sub: `×${units.toLocaleString('zh-CN')}`,
      title: def.description,
      hover: moduleHoverContent(def),
    })
  }

  return (
    <Panel
      className="is-fill app-fleet-panel"
      title="仓库"
      hint={
        // 图标视图的用法说明只在图标视图挂出来（2026-09-13 船长：常驻说明收进标题后的圆形感叹号）
        mode === 'grid' ? <HintIcon tip="图标视图：按类型分组，点击任意卡片即可执行装卸、卖出等操作。" /> : undefined
      }
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
            {wareNarrowed ? `匹配 ${hitTotal} 种` : `${hitTotal} 种 · 无限容量 · 不随船`}
          </span>
        </span>
      }
    >
      {/* 仓库筛选（2026-09-13 船长：「物品界面的仓库也添加筛选」；2026-09-19 甲组补丁补齐子维度）
          —— 工具条固定在列表上方不随滚动（复刻「我的舰队」那套：app-fleet-toolbar + app-fleet-row）；
          一级＝各大类 + 「装备」；二级/三级**按一级现算**（基线③级联：上级没选就不占位）；
          胶囊行文案一律「全部」+ 同行灰字前缀（基线①） */}
      <div className="app-fleet-toolbar">
        <div className="app-fleet-row">
          <span className="app-dim">分类：</span>
          <div className="app-task-tabs app-fleet-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={wareKind === 'all'}
              className={`app-tasktab${wareKind === 'all' ? ' is-active' : ''}`}
              onClick={() => {
                setWareKind('all')
                setWareSub(SUB_ALL)
                setWareFunc(SUB_ALL)
              }}
            >
              全部
            </button>
            {ITEM_KIND_ORDER.map((kind) => (
              <button
                key={kind}
                role="tab"
                aria-selected={wareKind === kind}
                className={`app-tasktab${wareKind === kind ? ' is-active' : ''}`}
                onClick={() => {
                  setWareKind(kind)
                  setWareSub(SUB_ALL)
                  setWareFunc(SUB_ALL)
                }}
              >
                {itemKindLabel(kind)}
              </button>
            ))}
            <button
              role="tab"
              aria-selected={wareKind === 'module'}
              className={`app-tasktab${wareKind === 'module' ? ' is-active' : ''}`}
              onClick={() => {
                setWareKind('module')
                setWareSub(SUB_ALL)
                setWareFunc(SUB_ALL)
              }}
            >
              装备
            </button>
          </div>
        </div>
        {subDim ? (
          <div className="app-fleet-row">
            <span className="app-dim">{subDim.label}：</span>
            <div className="app-task-tabs app-fleet-tabs" role="tablist">
              <button
                role="tab"
                aria-selected={wareSub === SUB_ALL}
                className={`app-tasktab${wareSub === SUB_ALL ? ' is-active' : ''}`}
                onClick={() => {
                  setWareSub(SUB_ALL)
                  setWareFunc(SUB_ALL)
                }}
              >
                全部
              </button>
              {subDim.options.map((s) => (
                <button
                  key={s.key}
                  role="tab"
                  aria-selected={wareSub === s.key}
                  className={`app-tasktab${wareSub === s.key ? ' is-active' : ''}`}
                  onClick={() => {
                    setWareSub(s.key)
                    setWareFunc(SUB_ALL)
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {funcDim ? (
          <div className="app-fleet-row">
            <span className="app-dim">功能：</span>
            <div className="app-task-tabs app-fleet-tabs" role="tablist">
              <button
                role="tab"
                aria-selected={wareFunc === SUB_ALL}
                className={`app-tasktab${wareFunc === SUB_ALL ? ' is-active' : ''}`}
                onClick={() => setWareFunc(SUB_ALL)}
              >
                全部
              </button>
              {funcDim.map((s) => (
                <button
                  key={s.key}
                  role="tab"
                  aria-selected={wareFunc === s.key}
                  className={`app-tasktab${wareFunc === s.key ? ' is-active' : ''}`}
                  onClick={() => setWareFunc(s.key)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      {/* 仓库内容在自滚容器里滚：标题行（搜索/切换）与筛选行固定不随内容滚走
          （2026-09-10 船长：同技能目录标题栏；2026-09-13 加入筛选行后改用舰队那套「工具条 + 自滚区」） */}
      <div className="app-fleet-scroll">
      {wareNarrowed && hitTotal === 0 ? (
        <div className="app-dim app-note">
          {wq.length > 0
            ? `没有匹配「${wareQuery.trim()}」的仓库物品或装备——换个关键词试试（支持名称/分类/说明）。`
            : '当前筛选下仓库里没有东西——换个分类，或点「全部」看全表。'}
        </div>
      ) : null}
      {mode === 'list' ? (
        <>
      {ITEM_KIND_ORDER.map((kind) => {
        // 一级筛选：选了某一类就只渲染那一类（2026-09-13 仓库筛选）
        if (kindPicked && wareKind !== kind) return null
        const kindRows = rows.filter(([id]) => engine.ctx.items.get(id)?.kind === kind && hitItem(id))
        // 矿石/矿物面板常驻（引导文案有教学作用），其余分类空时不显示；搜索/筛选时任一空类都隐藏
        if (kindRows.length === 0 && (kind !== 'ore' && kind !== 'mineral' || wareNarrowed)) return null
        const extra = kindExtraNote(kind)
        return (
          <Panel
            key={kind}
            title={`${itemKindLabel(kind)}`}
            hint={extra ? <HintIcon tip={extra} /> : undefined}
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
                          <RowGlyph glyph={def.kind} tone={inventoryItemTone(id, def.kind)} /> {def.name}
                          {def.kind !== 'ore' && def.kind !== 'mineral' ? (
                            <span className="app-dim">（{ITEM_KIND_LABELS[def.kind]}）</span>
                          ) : null}
                        </span>
                        <span className="app-inv-count">
                          ×{units.toLocaleString('zh-CN')}（{m3(units * def.unitM3)}）· 市场收价 {buy !== undefined ? `${isk(buy)} 信用点` : '—'}
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
                        ) : /* 2026-09-19 玩家报障修：蓝图碎片不在市场流通目录，但**必须给一条兑现路**
                              （碎片 → 永久蓝图）——把原来的纯禁用按钮换成「逆向解锁」（组件与货仓页共用）。 */
                        fragRows.has(id) ? (
                          <RedeemFragmentButton engine={engine} itemId={id} onToast={onToast} />
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
                        {/* 丢弃（船长 2026-09-15：「仓库添加丢弃按钮，允许玩家丢弃任意数量已有物品」）
                            —— 与「市价卖出」同一套数量弹层（复用 SellQtyModal），但不给钱、纯销毁；
                            按钮用 is-danger 与"卖出/装船"区分开（破坏性操作）。 */}
                        <button
                          className="app-btn is-small is-danger"
                          title="丢弃这件物品（可指定任意数量；丢弃后无法找回，也不会得到任何信用点）"
                          onClick={() => setDiscardItem(id)}
                        >
                          丢弃
                        </button>
                      </div>
                    </ItemHover>
                  )
                })}
              </ul>
            )}
          </Panel>
        )
      })}

      {/* 装备库（2026-09-13 筛选：选了某个物品大类时整块不显示；计数随槽类二级筛选收窄） */}
      {showMods ? (
      <Panel
        title="装备（装备库）"
        right={<span className="app-dim">{modHits.length} 种 · 空间站库存</span>}
      >
        {modHits.length === 0 ? (
          <div className="app-dim app-inv-empty">
            {wareNarrowed
              ? '当前筛选下没有装备——换个分类或槽类试试。'
              : '装备库还是空的——在「市场」页购买或在「工业」页制造装备后，装备会先存放于此，再到「装配」页安装上船。'}
          </div>
        ) : (
          <ul className="app-inv-list">
            {modHits.map(([id, units]) => {
              const def = engine.ctx.modules.get(id)
              if (!def) return null
              const modGood = marketGoodOf(engine.ctx, 'module', id)
              return (
                /* 富卡悬停：与市场行 / 装配台装备库行 / 手册列表同一张卡（`ModuleHover` = 名称 + 参数表 + 描述）。
                   ⚠ 2026-09-19 船长报障「悬停不是显示富文本详细，又改回简易介绍了」——原先这里只挂
                   `title={def.description}`（简易介绍），同一页的物品行却是富卡 ⇒ 装备行改挂富卡。 */
                <ModuleHover key={id} as="li" mod={def} className="app-inv-row">
                  <div className="app-inv-main">
                    <span className="app-inv-name">
                      <RowGlyph glyph={def.slot} /> {def.name}
                    </span>
                    <span className="app-inv-count">
                      ×{units.toLocaleString('zh-CN')} · {SLOT_LABELS[def.slot] ?? def.slot} · CPU {def.cpuUse}
                      {def.dmgMult !== undefined ? ` · 火力 ×${def.dmgMult}` : ''}
                    </span>
                  </div>
                  <div className="app-inv-btns">
                    <button
                      className="app-btn is-small"
                      onClick={() => handleLoadMod(id)}
                      title="装入船货仓携带（按 1 m³/件 计入货舱）；安装到槽位请到「装配」页——装配台取料自装备库，船上装备需先卸回"
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
                </ModuleHover>
              )
            })}
          </ul>
        )}
      </Panel>
      ) : null}
        </>
      ) : (
        <>
          {ITEM_KIND_ORDER.map((kind) => {
            // 一级筛选：选了某一类就只渲染那一类（2026-09-13 仓库筛选，与列表视图同一套判据）
            if (kindPicked && wareKind !== kind) return null
            const kindRows2 = rows.filter(([id]) => engine.ctx.items.get(id)?.kind === kind && hitItem(id))
            if (kindRows2.length === 0 && (kind !== 'ore' && kind !== 'mineral' || wareNarrowed)) return null
            const cells: ItemGridCell[] = kindRows2.map(([id, units]) => {
              const def = engine.ctx.items.get(id)
              return {
                key: id,
                glyph: def?.kind ?? kind,
                name: def?.name ?? id,
                sub: `×${units.toLocaleString('zh-CN')} · ${m3(units * (def?.unitM3 ?? 1))}`,
                title: def?.description,
                // 富卡悬停（与列表模式的 ItemHover 同一内容；船长 2026-09-19 报障：图标模式原先是纯文本简介）
                hover: def ? itemHoverContent(def, (pid) => engine.ctx.items.get(pid)?.name) : undefined,
                // 稀有残骸上稀有金（船长 2026-09-19）；其余物品照旧按大类取色
                tone: inventoryItemTone(id, def?.kind ?? kind),
              }
            })
            const extra2 = kindExtraNote(kind)
            return (
              <Panel
                key={kind}
                title={`${itemKindLabel(kind)}`}
                hint={extra2 ? <HintIcon tip={extra2} /> : undefined}
                right={<span className="app-dim">{kindRows2.length} 种</span>}
              >
                {kindRows2.length === 0 ? (
                  <div className="app-dim app-inv-empty">{KIND_EMPTY[kind] ?? '仓库里没有该分类物品。'}</div>
                ) : (
                  <ItemGlyphGrid cells={cells} onPick={(key) => setPickItem(key)} />
                )}
              </Panel>
            )
          })}
          {showMods ? (
          <Panel
            title="装备（装备库）"
            right={<span className="app-dim">{modHits.length} 种 · 空间站库存</span>}
          >
            {modHits.length > 0 ? (
              <ItemGlyphGrid cells={modCells} onPick={(key) => setPickMod(key)} />
            ) : (
              <div className="app-dim app-inv-empty">
                {wareNarrowed
                  ? '当前筛选下没有装备——换个分类或槽类试试。'
                  : '装备库是空的——购买 / 制造后先存放于此，再到「装配」页安装。'}
              </div>
            )}
          </Panel>
          ) : null}

          {pickItemDef && pickItem ? (
            <ItemActionModal onClose={() => setPickItem(null)}>
              <div className="app-itempick-head">
                <span className="app-itempick-icon">
                  <Glyph name={pickItemDef.kind} size={40} color={inventoryItemTone(pickItem, pickItemDef.kind)} />
                </span>
                <div className="app-itempick-info">
                  <div className="app-itempick-name">{pickItemDef.name}</div>
                  <div className="app-dim">
                    ×{pickItemUnits.toLocaleString('zh-CN')}（{m3(pickItemUnits * pickItemDef.unitM3)}）· 市场收价{' '}
                    {pickItemBuy !== undefined ? `${isk(pickItemBuy)} 信用点` : '—'}
                  </div>
                </div>
              </div>
              {/* 2026-09-08 船长反馈：图标模式信息太少——与列表模式悬浮窗同源信息表（种类/体积/收价/精炼配方/弹药无人机战斗行/修理件） */}
              <InfoTable lines={itemInfoLines(pickItemDef, (id) => engine.ctx.items.get(id)?.name)} />
              <div className="app-dim app-itempick-note">{pickItemDef.description}</div>
              <div className="app-itempick-actions">
                {/* **碎片详情的「逆向解锁」**（2026-09-19 船长：「建议在物品的蓝图碎片详细页内，
                    也添加一个合并碎片的按钮」）——不是碎片 ⇒ 本组件返回 null，其余物品照旧 */}
                <RedeemFragmentButton engine={engine} itemId={pickItem} onToast={onToast} />
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
                  title="装入船货仓携带（按 1 m³/件 计入货舱）；安装到槽位请到「装配」页（装配台取料自装备库，船上装备需先卸回）"
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
      </div>

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
            priceText={buy !== undefined ? `收价 ${isk(buy)} 信用点/单位` : undefined}
            note={def.description}
            onClose={() => setSellItem(null)}
            onConfirm={(qty) => handleSellQtyItem(sellItem, qty)}
          />
        )
      })() : null}
      {discardItem ? (() => {
        const def = engine.ctx.items.get(discardItem)
        if (!def) return null
        const units = state.warehouse.items[discardItem] ?? 0
        return (
          <SellQtyModal
            name={def.name}
            glyph={def.kind}
            max={units}
            unit="单位"
            priceText="丢弃没有任何收益（要变现请用「市价卖出」或精炼炉）"
            confirmLabel="丢弃"
            note="丢弃后无法找回。"
            onClose={() => setDiscardItem(null)}
            onConfirm={(qty) => {
              const r = engine.discardWare(discardItem, qty)
              if (!r.ok) onToast(r.error ?? '丢弃失败', true)
              else onToast(`已丢弃 ${def.name}×${r.dropped.toLocaleString('zh-CN')}。`)
              setDiscardItem(null)
            }}
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
    </Panel>
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
      {/* 船长拍板：物品页整标签一窗滚——活跃标签内容包进二级滚动窗（CargoPage 内层不再产生双滚动）；
          仓库 tab = 固定标题行的自滚面板（同技能目录，抬头不随内容滚走，2026-09-10 船长） */}
      {tab === 'cargo' ? (
        <div className="app-win-body">
          <CargoPage {...props} onGotoMarket={props.onGotoMarket ?? (() => undefined)} />
        </div>
      ) : (
        <div className="app-win-fill">
          <WarehouseView {...props} onGotoMarket={props.onGotoMarket ?? (() => undefined)} />
        </div>
      )}
    </div>
  )
}
