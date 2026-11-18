import { useEffect, useState } from 'react'
import { ITEM_KIND_LABELS, ITEM_KIND_ORDER, marketGoodOf, SYNAPTIC_ACCELERANT_ITEM_ID, invasionBeaconTypeOf, shipOperationBlockReason, freeCargoM3, cargoUnitM3, MODULE_CARGO_UNIT_M3 } from '@whale/core'
import { itemRarityTierOf } from '@whale/data'
import { Panel } from '@whale/ui'
import { ItemHover, InfoTable, itemHoverContent, itemInfoLines, moduleHoverContent, ModuleHover, moduleInfoLines } from '../ui/shipInfo'
import { Glyph, inventoryItemTone, toneOf, itemGlyphName } from '../ui/Glyphs'
import { HintIcon } from '../ui/Hint'
import { ItemActionModal } from '../ui/ItemActionModal'
import { ItemGlyphGrid, ItemViewBar, RowGlyph, kindExtraNote, useItemView, type ItemGridCell } from '../ui/itemView'
import { SellQtyModal } from '../ui/SellQtyModal'
import { RedeemFragmentButton } from '../ui/fragmentRedeem'
import {
  ITEM_DOMAIN_SUBS,
  MODULE_SUBS,
  RACK_SUBS,
  rackPasses,
  itemCategoryOf,
  SUBS_OF_KIND,
  SUB_ALL,
  itemBucketPasses,
  itemSubPasses,
  presentSubs,
  subText,
  type SubOption } from '../ui/itemSubs'
import { useL10n, cmdText } from '../i18n/locale'
import { crestFamOf, kindText, slotText } from '../ui/labelsText'
import { sortModEntries } from '../ui/modOrder'
import type { PageProps } from './common'
import { isk, itemBuyQuote, m3 } from './common'
import { CargoPage } from './CargoPage'
import { tr } from '../i18n/locale'

type ItemsTab = 'warehouse' | 'cargo'

export interface ItemNavProps {
  onGotoMarket: (goodKey: string) => void
}

function WarehouseView({ engine, onToast, onGotoMarket }: PageProps & ItemNavProps) {
  const state = engine.state
  const cargoBlock = shipOperationBlockReason(state, engine.ctx, state.shipId, 'cargo')
  const { t } = useL10n()
  const [wareQuery, setWareQuery] = useState('')
  const [wareKind, setWareKind] = useState<string>('all')
  const [wareSub, setWareSub] = useState<string>(SUB_ALL)
  const [wareRack, setWareRack] = useState(SUB_ALL)
  const kindPicked = wareKind !== 'all'
  const showMods = wareKind === 'all' || wareKind === 'module'
  const wq = wareQuery.trim().toLowerCase()
  const rows = Object.entries(state.warehouse.items).filter(([, n]) => n > 0)
  const modRows = sortModEntries(
    Object.entries(state.moduleBay).filter(([, n]) => n > 0),
    engine.ctx,
  )
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
      slotText(def.slot).toLowerCase().includes(wq) ||
      (def.description ?? '').toLowerCase().includes(wq)
    )
  }
  const wareKindTabs = presentSubs(ITEM_DOMAIN_SUBS, (key) =>
    key === 'module'
      ? modRows.length > 0
      : rows.some(([id]) => itemCategoryOf(engine.ctx.items.get(id)) === key),
  )
  const itemNameOf = (id: string): string | undefined => engine.ctx.items.get(id)?.name
  const subDim: { options: SubOption[]; label: string } | null = (() => {
    const options = wareKind === 'module' ? MODULE_SUBS : SUBS_OF_KIND[wareKind]
    if (options === undefined) return null
    const pool = wareKind === 'module' ? modRows : rows
    return {
      options: presentSubs(options, (key) => pool.some(([id]) => itemBucketPasses(engine.ctx, id, wareKind) &&
        (wareKind !== 'module' || rackPasses(engine.ctx, id, wareRack)) && itemSubPasses(engine.ctx, id, wareKind, key))),
      label: wareKind === 'module' ? tr('ui.ItemsPage.048') : wareKind === 'item' ? tr('ui.ItemsPage.059') :
        wareKind === 'container' || wareKind === 'consume' ? tr('ui.hintAudit.003') : tr('ui.ItemsPage.023'),
    }
  })()
  const subMissing = subDim !== null && wareSub !== SUB_ALL && !subDim.options.some((s) => s.key === wareSub)
  const kindMissing = kindPicked && !wareKindTabs.some((s) => s.key === wareKind)
  useEffect(() => {
    if (kindMissing) { setWareKind('all'); setWareSub(SUB_ALL); setWareRack(SUB_ALL) }
    if (subMissing) setWareSub(SUB_ALL)
  }, [kindMissing, subMissing])
  const rackOptions = wareKind === 'module' ? presentSubs(RACK_SUBS, (key) => modRows.some(([id]) => rackPasses(engine.ctx, id, key))) : []
  const rackMissing = wareRack !== SUB_ALL && !rackOptions.some((s) => s.key === wareRack)
  useEffect(() => { if (rackMissing) { setWareRack(SUB_ALL); setWareSub(SUB_ALL) } }, [rackMissing])
  const subHit = (id: string): boolean => {
    if (!subDim || wareSub === SUB_ALL) return true
    return itemSubPasses(engine.ctx, id, wareKind, wareSub)
  }
  const dimHit = (id: string): boolean => {
    if (!itemBucketPasses(engine.ctx, id, wareKind)) return false
    if (wareKind === 'module' && !rackPasses(engine.ctx, id, wareRack)) return false
    if (!subHit(id)) return false
    return true
  }
  const itemHits = rows.filter(([id]) => hitItem(id) && dimHit(id))
  const modHits = showMods ? modRows.filter(([id]) => hitMod(id) && dimHit(id)) : []
  const itemKinds = [...ITEM_KIND_ORDER, 'other']
  const hitTotal = itemHits.length + modHits.length
  const wareNarrowed = wq.length > 0 || kindPicked || wareSub !== SUB_ALL


  const KIND_EMPTY: Record<string, string> = {
    ore: t('ui.ItemsPage.005'),
    mineral: t('ui.ItemsPage.006'),
    gas: t('ui.ItemsPage.007'),
    ice: t('ui.ItemsPage.008'),
    ammo: t('ui.ItemsPage.009'),
    drone: t('ui.ItemsPage.010'),
  }

  function handleLoad(id: string): void {
    const def = engine.ctx.items.get(id)
    if (!def) return
    if (def.holdForbidden === true) {
      onToast(t('ui.ItemsPage.052', { p1: def.name }), true)
      return
    }
    const lock = shipOperationBlockReason(state, engine.ctx, state.shipId, 'cargo')
    if (lock) { onToast(cmdText(lock), true); return }
    const loaded = engine.loadWareToCargoFit(id)
    if (loaded === 0) onToast(t((state.warehouse.items[id] ?? 0) > 0 && freeCargoM3(state, engine.ctx) < cargoUnitM3(state, def)
      ? 'ui.hintAudit.010' : 'ui.ItemsPage.012'), true)
    else {
      onToast(t('ui.ItemsPage.013', { name: def.name, n: loaded.toLocaleString('zh-CN') }))
      setPickItem(null)
    }
  }

  function goMarket(kind: 'item' | 'module', id: string): void {
    const good = marketGoodOf(engine.ctx, kind, id)
    if (good) onGotoMarket(good.key)
  }

  function handleLoadMod(id: string): void {
    const def = engine.ctx.modules.get(id)
    const lock = shipOperationBlockReason(state, engine.ctx, state.shipId, 'cargo')
    if (lock) { onToast(cmdText(lock), true); return }
    const loaded = engine.loadWareToCargoFit(id)
    if (loaded === 0) onToast(tr((state.moduleBay[id] ?? 0) > 0 && freeCargoM3(state, engine.ctx) < MODULE_CARGO_UNIT_M3
      ? 'ui.hintAudit.011' : 'ui.ItemsPage.040'), true)
    else onToast(tr("ui.ItemsPage.041", { p1: def?.name ?? id, p2: loaded.toLocaleString('zh-CN') }))
  }

  const [sellItem, setSellItem] = useState<string | null>(null)
  const [sellMod, setSellMod] = useState<string | null>(null)
  const [discardItem, setDiscardItem] = useState<string | null>(null)
  function handleSellQtyItem(id: string, qty: number): void {
    const r = engine.sellWare(id, qty)
    if (!r.ok) onToast(cmdText(r) || tr('ui.CargoPage.019'), true)
    else onToast(tr("ui.ItemsPage.042", { p1: r.soldUnits.toLocaleString('zh-CN'), p2: r.gainedIsk.toLocaleString('zh-CN') }))
    setSellItem(null)
    setPickItem(null)
  }
  function handleSellQtyMod(id: string, qty: number): void {
    const good = marketGoodOf(engine.ctx, 'module', id)
    if (!good) {
      onToast(tr("ui.ItemsPage.043"), true)
      setSellMod(null)
      setPickMod(null)
      return
    }
    const r = engine.sellHoldingAt(good.key, qty)
    if (!r.ok) onToast(cmdText(r) || tr('ui.CargoPage.019'), true)
    else onToast(tr("ui.ItemsPage.044"))
    setSellMod(null)
    setPickMod(null)
  }

  const fragRows = new Set(engine.fragmentRedeemRows().map((r) => r.fragmentItemId))

  const [pickItem, setPickItem] = useState<string | null>(null)
  const fireBeacon = (itemId: string): void => {
    const r = engine.useInvasionBeaconNow({ itemId })
    if (!r.ok) onToast(cmdText(r) || tr('ui.ItemsPage.057'), true)
    else onToast(tr('ui.ItemsPage.058'))
  }
  const [pickMod, setPickMod] = useState<string | null>(null)
  const pickItemDef = pickItem ? engine.ctx.items.get(pickItem) : undefined
  const pickItemUnits = pickItem ? (state.warehouse.items[pickItem] ?? 0) : 0
  const pickItemBuy = pickItem ? itemBuyQuote(engine, pickItem) : undefined
  const pickItemSellable = pickItem ? marketGoodOf(engine.ctx, 'item', pickItem) !== undefined : false
  const pickModDef = pickMod ? engine.ctx.modules.get(pickMod) : undefined
  const pickModUnits = pickMod ? (state.moduleBay[pickMod] ?? 0) : 0

  const [mode, setMode] = useItemView('items')
  const modCells: ItemGridCell[] = []
  for (const [id, units] of modHits) {
    const def = engine.ctx.modules.get(id)
    if (!def) continue
    const crest = crestFamOf(id)
    modCells.push({
      key: id,
      glyph: def.slot,
      name: def.name,
      sub: `×${units.toLocaleString('zh-CN')}`,
      title: def.description,
      hover: moduleHoverContent(def),
      rarity: itemRarityTierOf(id),
      ...(crest !== undefined ? { crest } : {}),
    })
  }

  return (
    <Panel
      className="is-fill app-fleet-panel"
      title={t('ui.ItemsPage.001')}
      hint={
        // 图标视图的用法说明只在图标视图挂出来（2026-09-13 船长：常驻说明收进标题后的圆形感叹号）
        mode === 'grid' ? <HintIcon tip={t('ui.ItemsPage.014')} /> : undefined
      }
      right={
        <span className="app-head-search-wrap">
          <ItemViewBar mode={mode} onChange={setMode} />
          <input
            className="app-head-search"
            type="text"
            placeholder={t('ui.ItemsPage.015')}
            value={wareQuery}
            onChange={(e) => setWareQuery(e.target.value)}
            spellCheck={false}
          />
          <span className="app-dim">
            {wareNarrowed
              ? t('ui.ItemsPage.016', { n: hitTotal })
              : t('ui.ItemsPage.017', { n: hitTotal })}
          </span>
        </span>
      }
    >
      {/* 仓库筛选（2026-09-13 船长：「物品界面的仓库也添加筛选」；2026-09-19 甲组补丁补齐子维度）
          —— 工具条固定在列表上方不随滚动（复刻「我的舰队」那套：app-fleet-toolbar + app-fleet-row）；
          一级＝各大类 + 「装备」；二级/三级**按一级现算**（基线③级联：上级没选就不占位）；
          细分默认项按当前维度命名，不暗示一次清除全部条件。 */}
      <div className="app-fleet-toolbar">
        <div className="app-fleet-row">
          <span className="app-dim">{tr("ui.ItemsPage.021")}</span>
          <div className="app-task-tabs app-fleet-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={wareKind === 'all'}
              className={`app-tasktab${wareKind === 'all' ? ' is-active' : ''}`}
              onClick={() => {
                setWareKind('all')
                setWareSub(SUB_ALL)
                setWareRack(SUB_ALL)
              }}
            >
              {tr("ui.IndustryPage.001")}
            </button>
            {wareKindTabs.map((tab) => (
              <button
                key={tab.key}
                role="tab"
                aria-selected={wareKind === tab.key}
                className={`app-tasktab${wareKind === tab.key ? ' is-active' : ''}`}
                onClick={() => {
                  setWareKind(tab.key)
                  setWareSub(SUB_ALL)
                  setWareRack(SUB_ALL)
                }}
              >
                {subText(tab)}
              </button>
            ))}
          </div>
        </div>
        {rackOptions.length > 0 ? <div className="app-fleet-row">
          <span className="app-dim">{tr('ui.ItemsPage.022')}{tr('ui.ItemsPage.046')}</span>
          <select className="app-mkt-kind" value={wareRack} title={tr('ui.hintAudit.004')} onChange={(e) => { setWareRack(e.target.value); setWareSub(SUB_ALL) }}>
            <option value={SUB_ALL}>{tr('ui.hintAudit.006')}</option>
            {rackOptions.map((s) => <option key={s.key} value={s.key}>{subText(s)}</option>)}
          </select>
        </div> : null}
        {subDim ? (
          <div className="app-fleet-row">
            <span className="app-dim">{subDim.label}{tr('ui.ItemsPage.046')}</span>
            <div className="app-task-tabs app-fleet-tabs" role="tablist">
              <button
                role="tab"
                aria-selected={wareSub === SUB_ALL}
                className={`app-tasktab${wareSub === SUB_ALL ? ' is-active' : ''}`}
                onClick={() => {
                  setWareSub(SUB_ALL)
                }}
              >
                {tr(wareKind === 'module' ? 'ui.hintAudit.007' : wareKind === 'wreck' || wareKind === 'aicore' ? 'ui.hintAudit.008' : 'ui.hintAudit.009')}
              </button>
              {subDim.options.map((s) => (
                <button
                  key={s.key}
                  role="tab"
                  aria-selected={wareSub === s.key}
                  className={`app-tasktab${wareSub === s.key ? ' is-active' : ''}`}
                  onClick={() => {
                    setWareSub(s.key)
                  }}
                >
                  {subText(s, itemNameOf)}
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
            ? t('ui.ItemsPage.018', { kw: wareQuery.trim() })
            : t('ui.ItemsPage.019')}
        </div>
      ) : null}
      {mode === 'list' ? (
        <>
      {itemKinds.map((kind) => {
        // 一级筛选：选了某一档就只渲染属于该物品领域分类的大类；装备库单独渲染。
        const kindRows = itemHits.filter(([id]) => kind === 'other' ? itemCategoryOf(engine.ctx.items.get(id)) === 'other' : engine.ctx.items.get(id)?.kind === kind)
        // 矿石/矿物面板常驻（引导文案有教学作用），其余分类空时不显示；搜索/筛选时任一空类都隐藏
        if (kindRows.length === 0 && (kind !== 'ore' && kind !== 'mineral' || wareNarrowed)) return null
        const extra = kindExtraNote(kind)
        return (
          <Panel
            key={kind}
            title={kind === 'other' ? tr('ui.hud.137') : kindText(kind as Parameters<typeof kindText>[0])}
            hint={extra ? <HintIcon tip={extra} /> : undefined}
            right={<span className="app-dim">{tr('ui.CargoPage.009', { n: kindRows.length })}</span>}
          >
            {kindRows.length === 0 ? (
              <div className="app-dim app-inv-empty">{KIND_EMPTY[kind] ?? t('ui.ItemsPage.011')}</div>
            ) : (
              <ul className="app-inv-list">
                {kindRows.map(([id, units]) => {
                  const def = engine.ctx.items.get(id)
                  if (!def) return null
                  const buy = itemBuyQuote(engine, id)
                  /** ⚠ **2026-09-25 修**（船长报障「部分奢侈品…显示的是不在市场目录导致无法出售」）：
                   *  判"能不能卖"看**在不在市场目录**，**不能**拿 `buy !== undefined` ——
                   *  `itemBuyQuote` 对「**收购簿为空**」也返回 undefined ⇒ 会把"暂无人收购"误报成
                   *  「不在市场目录」，挡掉"挂限价卖单等收购单浮现"那条路（与货仓页同一处口径）。 */
                  const sellable = marketGoodOf(engine.ctx, 'item', id) !== undefined
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
                          {/* 图标走**物品 id 单点映射**（三件道具各有专属线稿；其余回落大类键） */}
                          <RowGlyph glyph={itemGlyphName(id, def.kind)} tone={inventoryItemTone(id, def.kind)} /> {def.name}
                          {def.kind !== 'ore' && def.kind !== 'mineral' ? (
                            <span className="app-dim">（{ITEM_KIND_LABELS[def.kind]}）</span>
                          ) : null}
                        </span>
                        <span className="app-inv-count">
                          ×{units.toLocaleString('zh-CN')}（{m3(units * def.unitM3)}{tr('ui.CargoPage.054')} {buy !== undefined ? tr("ui.ItemsPage.039", { p1: isk(buy) }) : '—'}
                        </span>
                      </div>
                      <div className="app-inv-btns">
                        {/* **2026-09-30 船长令**（实验室后续内容）：**能"用"的道具**给一颗「使用」按钮
                            —— 目前只有突触加速剂（判据 = core 的 id 常量单点，不在页面里写死字面量）；
                            每次使用消耗一枚并累加有效时间，不叠加速度倍率。 */}
                        {id === SYNAPTIC_ACCELERANT_ITEM_ID ? (
                          <button
                            className="app-btn is-small is-warn"
                            title={tr('ui.boost.012')}
                            onClick={() => {
                              const r = engine.useSynapticAccelerantNow()
                              if (!r.ok) onToast(cmdText(r) || tr('ui.boost.012'), true)
                              else onToast(tr('ui.boost.013'))
                            }}
                          >
                            {tr('ui.ItemsPage.056')}
                          </button>
                        ) : null}
                        {/* 根据本行物品类型使用；专属发射器固定势力，旧发射器继续随机。 */}
                        {invasionBeaconTypeOf(id) ? (
                          <button
                            className="app-btn is-small is-warn"
                            title={tr('ui.ItemsPage.057')}
                            onClick={() => fireBeacon(id)}
                          >
                            {tr('ui.ItemsPage.056')}
                          </button>
                        ) : null}
                        {/* **2026-09-30 船长令**：「置灰，点击后弹出提示无法装入舰船货仓」——
                            装不进货仓的东西（`ItemDef.holdForbidden`，如超空间折跃燃料）按钮**置灰但可点**：
                            点下去照旧走 `handleLoad` 弹提示（原生 `disabled` 点不动，故用 `aria-disabled`）。 */}
                        {(() => {
                          const blocked = def.holdForbidden === true
                          return (
                            <button
                              className="app-btn is-small"
                              disabled={cargoBlock !== null}
                              aria-disabled={blocked ? 'true' : undefined}
                              onClick={() => handleLoad(id)}
                              title={cargoBlock ? cmdText(cargoBlock) : blocked ? tr('ui.ItemsPage.053', { p1: def.name }) : tr('ui.ItemsPage.024')}
                            >
                              {tr('ui.ItemsPage.025')}
                            </button>
                          )
                        })()}
                        {sellable ? (
                          <button className="app-btn is-small is-primary" onClick={() => setSellItem(id)}>
                            {tr("ui.CargoPage.038")}
                          </button>
                        ) : /* 2026-09-19 玩家报障修：蓝图碎片不在市场流通目录，但**必须给一条兑现路**
                              （碎片 → 永久蓝图）——把原来的纯禁用按钮换成「逆向解锁」（组件与货仓页共用）。 */
                        fragRows.has(id) ? (
                          <RedeemFragmentButton engine={engine} itemId={id} onToast={onToast} />
                        ) : (
                          <button className="app-btn is-small" disabled>
                            {tr("ui.CargoPage.039")}
                          </button>
                        )}
                        {marketGoodOf(engine.ctx, 'item', id) ? (
                          <button
                            className="app-btn is-small"
                            title={t('ui.CargoPage.003')}
                            onClick={() => goMarket('item', id)}
                          >
                            {t('ui.CargoPage.001')}
                          </button>
                        ) : null}
                        {/* 丢弃（船长 2026-09-15：「仓库添加丢弃按钮，允许玩家丢弃任意数量已有物品」）
                            —— 与「市价卖出」同一套数量弹层（复用 SellQtyModal），但不给钱、纯销毁；
                            按钮用 is-danger 与"卖出/装船"区分开（破坏性操作）。 */}
                        <button
                          className="app-btn is-small is-danger"
                          title={tr("ui.ItemsPage.026")}
                          onClick={() => setDiscardItem(id)}
                        >
                          {tr("ui.ItemsPage.027")}
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
        title={tr("ui.ItemsPage.028")}
        right={<span className="app-dim">{modHits.length} {tr("ui.ItemsPage.029")}</span>}
      >
        {modHits.length === 0 ? (
          <div className="app-dim app-inv-empty">
            {wareNarrowed
              ? tr("ui.ItemsPage.030")
              : tr("ui.ItemsPage.031")}
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
                      ×{units.toLocaleString('zh-CN')} · {slotText(def.slot)} · CPU {def.cpuUse}
                      {def.dmgMult !== undefined ? ` · 火力 ×${def.dmgMult}${(def.shots ?? 1) > 1 ? `×${def.shots}` : ''}` : ''}
                    </span>
                  </div>
                  <div className="app-inv-btns">
                    <button
                      className="app-btn is-small"
                      disabled={cargoBlock !== null}
                      onClick={() => handleLoadMod(id)}
                      title={cargoBlock ? cmdText(cargoBlock) : tr("ui.ItemsPage.036")}
                    >
                      {tr("ui.ItemsPage.025")}
                    </button>
                    {modGood && modGood.playerSellable !== false ? (
                      <button className="app-btn is-small is-primary" onClick={() => setSellMod(id)}>
                        {tr("ui.CargoPage.038")}
                      </button>
                    ) : (
                      <button className="app-btn is-small" disabled title={tr("ui.ItemsPage.033")}>
                        {tr("ui.CargoPage.039")}
                      </button>
                    )}
                    {modGood ? (
                      <button
                        className="app-btn is-small"
                        title={t("ui.ItemsPage.020")}
                        onClick={() => goMarket('module', id)}
                      >
                        {t('ui.CargoPage.001')}
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
          {itemKinds.map((kind) => {
            // 一级筛选：选了某一档就只渲染属于该物品领域分类的大类；装备库单独渲染。
            const kindRows2 = itemHits.filter(([id]) => kind === 'other' ? itemCategoryOf(engine.ctx.items.get(id)) === 'other' : engine.ctx.items.get(id)?.kind === kind)
            if (kindRows2.length === 0 && (kind !== 'ore' && kind !== 'mineral' || wareNarrowed)) return null
            const cells: ItemGridCell[] = kindRows2.map(([id, units]) => {
              const def = engine.ctx.items.get(id)
              return {
                key: id,
                /* ⚠ **2026-09-30 船长报障「我在仓库看到的道具依旧没有图标」**：这一条是**图标模式**的
                   格子取图口，原先按大类键 ⇒ 三件道具在图鉴式网格里还是通用「消耗品」图标。
                   与列表模式同一处判定：走 `itemGlyphName` 单点。 */
                glyph: itemGlyphName(def?.id ?? id, def?.kind ?? kind),
                name: def?.name ?? id,
                sub: `×${units.toLocaleString('zh-CN')} · ${m3(units * (def?.unitM3 ?? 1))}`,
                title: def?.description,
                // 富卡悬停（与列表模式的 ItemHover 同一内容；船长 2026-09-19 报障：图标模式原先是纯文本简介）
                hover: def ? itemHoverContent(def, (pid) => engine.ctx.items.get(pid)?.name) : undefined,
                // 稀有残骸上稀有金（船长 2026-09-19）；其余物品照旧按大类取色
                tone: inventoryItemTone(id, def?.kind ?? kind),
                // 稀有度小标签（2026-09-20 船长）：物品按 id 查档（含市场外档表与 AI 核心的映射）
                rarity: itemRarityTierOf(id),
              }
            })
            const extra2 = kindExtraNote(kind)
            return (
              <Panel
                key={kind}
                title={kind === 'other' ? tr('ui.hud.137') : kindText(kind as Parameters<typeof kindText>[0])}
                hint={extra2 ? <HintIcon tip={extra2} /> : undefined}
                right={<span className="app-dim">{tr('ui.CargoPage.009', { n: kindRows2.length })}</span>}
              >
                {kindRows2.length === 0 ? (
                  <div className="app-dim app-inv-empty">{KIND_EMPTY[kind] ?? t('ui.ItemsPage.011')}</div>
                ) : (
                  <ItemGlyphGrid cells={cells} onPick={(key) => setPickItem(key)} />
                )}
              </Panel>
            )
          })}
          {showMods ? (
          <Panel
            title={tr("ui.ItemsPage.028")}
            right={<span className="app-dim">{modHits.length} {tr("ui.ItemsPage.029")}</span>}
          >
            {modHits.length > 0 ? (
              <ItemGlyphGrid cells={modCells} onPick={(key) => setPickMod(key)} />
            ) : (
              <div className="app-dim app-inv-empty">
                {wareNarrowed
                  ? tr("ui.ItemsPage.030")
                  : tr("ui.ItemsPage.034")}
              </div>
            )}
          </Panel>
          ) : null}

          {pickItemDef && pickItem ? (
            <ItemActionModal onClose={() => setPickItem(null)}>
              <div className="app-itempick-head">
                <span className="app-itempick-icon">
                  {/* 图标走**物品 id 单点映射**（2026-09-30 船长报障：图标模式里点开详情卡的大图标还是通用图标） */}
                  <Glyph
                    name={itemGlyphName(pickItemDef.id, pickItemDef.kind)}
                    size={40}
                    color={inventoryItemTone(pickItem, pickItemDef.kind)}
                  />
                </span>
                <div className="app-itempick-info">
                  <div className="app-itempick-name">{pickItemDef.name}</div>
                  <div className="app-dim">
                    ×{pickItemUnits.toLocaleString('zh-CN')}（{m3(pickItemUnits * pickItemDef.unitM3)}{tr('ui.CargoPage.054')}{' '}
                    {pickItemBuy !== undefined ? tr("ui.ItemsPage.039", { p1: isk(pickItemBuy) }) : '—'}
                  </div>
                </div>
              </div>
              {/* 2026-09-08 船长反馈：图标模式信息太少——与列表模式悬浮窗同源信息表（种类/体积/收价/精炼配方/弹药无人机战斗行/修理件） */}
              <InfoTable lines={itemInfoLines(pickItemDef, (id) => engine.ctx.items.get(id)?.name)} />
              <div className="app-dim app-itempick-note">{pickItemDef.description}</div>
              <div className="app-itempick-actions">
                {/* **2026-09-30 船长报障**：「**图标模式无法使用道具（没有按钮）**」——
                    图标模式点格子开的就是这张卡，但卡上原先只有「装到船上 / 卖出 / 去市场」⇒ 那两件
                    道具在图标模式下没有使用入口。这里与列表行**同一套 id 常量判据**补上「使用」。 */}
                {pickItem === SYNAPTIC_ACCELERANT_ITEM_ID ? (
                  <button
                    className="app-btn is-small is-warn"
                    title={tr('ui.boost.012')}
                    onClick={() => {
                      const r = engine.useSynapticAccelerantNow()
                      if (!r.ok) onToast(cmdText(r) || tr('ui.boost.012'), true)
                      else {
                        setPickItem(null)
                        onToast(tr('ui.boost.013'))
                      }
                    }}
                  >
                    {tr('ui.ItemsPage.056')}
                  </button>
                ) : null}
                {invasionBeaconTypeOf(pickItem) ? (
                  <button
                    className="app-btn is-small is-warn"
                    title={tr('ui.ItemsPage.057')}
                    onClick={() => {
                      setPickItem(null)
                      fireBeacon(pickItem)
                    }}
                  >
                    {tr('ui.ItemsPage.056')}
                  </button>
                ) : null}
                {/* **碎片详情的「逆向解锁」**（2026-09-19 船长：「建议在物品的蓝图碎片详细页内，
                    也添加一个合并碎片的按钮」）——不是碎片 ⇒ 本组件返回 null，其余物品照旧 */}
                <RedeemFragmentButton engine={engine} itemId={pickItem} onToast={onToast} />
                {/* 同列表行：装不进货仓的东西**置灰但可点**（点了弹提示，见上） */}
                {(() => {
                  const blocked = pickItemDef.holdForbidden === true
                  return (
                    <button
                      className="app-btn is-small"
                      disabled={cargoBlock !== null}
                      aria-disabled={blocked ? 'true' : undefined}
                      onClick={() => handleLoad(pickItem)}
                      title={cargoBlock ? cmdText(cargoBlock) : blocked ? tr('ui.ItemsPage.053', { p1: pickItemDef.name }) : tr('ui.ItemsPage.035')}
                    >
                      {tr('ui.ItemsPage.025')}
                    </button>
                  )
                })()}
                {pickItemSellable ? (
                  <button
                    className="app-btn is-primary is-small"
                    onClick={() => {
                      setPickItem(null)
                      setSellItem(pickItem)
                    }}
                  >
                    {tr("ui.CargoPage.038")}
                  </button>
                ) : (
                  <button className="app-btn is-small" disabled>
                    {tr("ui.CargoPage.040")}
                  </button>
                )}
                {marketGoodOf(engine.ctx, 'item', pickItem) ? (
                  <button
                    className="app-btn is-small"
                    title={tr("ui.CargoPage.003")}
                    onClick={() => {
                      setPickItem(null)
                      goMarket('item', pickItem)
                    }}
                  >
                    {t('ui.CargoPage.002')}
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
                    ×{pickModUnits.toLocaleString('zh-CN')} · {slotText(pickModDef.slot)} · CPU{' '}
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
                  disabled={cargoBlock !== null}
                  onClick={() => handleLoadMod(pickMod)}
                  title={cargoBlock ? cmdText(cargoBlock) : tr("ui.ItemsPage.036")}
                >
                  {tr("ui.ItemsPage.025")}
                </button>
                {marketGoodOf(engine.ctx, 'module', pickMod) ? (
                  <button
                    className="app-btn is-primary is-small"
                    onClick={() => {
                      setPickMod(null)
                      setSellMod(pickMod)
                    }}
                  >
                    {tr("ui.ItemsPage.037")}{pickModUnits.toLocaleString('zh-CN')}）
                  </button>
                ) : (
                  <button className="app-btn is-small" disabled>
                    {tr("ui.CargoPage.040")}
                  </button>
                )}
                {marketGoodOf(engine.ctx, 'module', pickMod) ? (
                  <button
                    className="app-btn is-small"
                    title={tr("ui.ItemsPage.020")}
                    onClick={() => {
                      setPickMod(null)
                      goMarket('module', pickMod)
                    }}
                  >
                    {t('ui.CargoPage.002')}
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
            glyph={itemGlyphName(def.id, def.kind)}
            max={units}
            unit={tr('ui.Expedition.102')}
            priceText={buy !== undefined ? tr("ui.CargoPage.055", { p1: isk(buy) }) : undefined}
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
            glyph={itemGlyphName(def.id, def.kind)}
            max={units}
            unit={tr('ui.Expedition.102')}
            priceText={tr('ui.ItemsPage.050')}
            confirmLabel={tr('ui.ItemsPage.027')}
            note={tr("ui.ItemsPage.038")}
            onClose={() => setDiscardItem(null)}
            onConfirm={(qty) => {
              const r = engine.discardWare(discardItem, qty)
              if (!r.ok) onToast(cmdText(r) || tr('ui.ItemsPage.051'), true)
              else onToast(tr("ui.ItemsPage.045", { p1: def.name, p2: r.dropped.toLocaleString('zh-CN') }))
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
            unit={tr('ui.MarketPage.117')}
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
          <span>{tr("ui.ItemsPage.001")}</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === 'cargo'}
          className={`app-subtab${tab === 'cargo' ? ' is-active' : ''}`}
          onClick={() => setTab('cargo')}
        >
          <span>▣</span>
          <span>{tr("ui.CargoPage.004")}</span>
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
