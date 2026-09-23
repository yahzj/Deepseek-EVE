/**
 * 市场页（V9）：NPC 挂单簿市场 —— 三个标签：常驻供应 / 稀有订单 / 限定奇货（2026-09-14 船长：奇货独立成页）。
 *
 * 玩法规则（中文说明，设计 V4/V5 已确认）：
 * - 收购价 = NPC 收玩家的价；供应价 = NPC 卖玩家的价（两者有价差，防倒卖）；
 * - 池商品（矿石/矿物）：站内库存池（常驻显示），池淤积→收购压价（倾销会砸价），
 *   池枯竭→供应断货涨价；价格还受隐藏的"冲击动量"影响（集中买卖会推/砸价，随时间恢复）；
 * - 单件商品（装备/蓝图/船/核心）：常驻平价随刷随买；稀有订单低频、限定奇货偶发高价（两者各自一个标签）；
 * - 市价买入吃穿簿后剩单会自动转成限价挂单；挂单随时可撤销（货退回原库存）。
 *
 * 展示规则（玩家 2026-09 修正要求）：
 * - "有货"的商品行冒泡上浮（有供应现货的排在前，无货沉底，稳定排序）；
 * - 稀有订单 / 限定奇货行标注现存供应单的剩余寿命（最早到期的那笔，mm:ss）；
 * - 常驻供应标题后显示"下次补给"倒计时（= 距下一市场窗口的剩余时间）；
 * - 两栏标题下方各带一个搜索栏：可按名称/商品键检索 + 按类型（物品/装备/舰船/蓝图/核心）过滤；
 * - 每行提供手动挂单（挂单买/挂单卖，数量+价格可改，卖单从自然库存锁定）。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { askLineOf, buyLineOf, goodLockedReason, goodName, itemKindText, marketHistory, marketQuote, marketTrend, naturalHoldings, PRICE_SAMPLE_MS, rackOf, salesTaxRate, formatDurationMs, bmGateReason, shipStoredCount } from '@whale/core'
import type { BlueprintDef, GameState, MarketGoodDef, MarketRarity, ShipBlueprintDef } from '@whale/core'
import { Panel } from '@whale/ui'
import { HoverTip } from '../ui/Tooltip'
import { InfoHover, ItemHover, itemInfoLines, ModuleHover, moduleInfoLines, ShipHover, shipInfoLines } from '../ui/shipInfo'
import type { InfoLine } from '../ui/shipInfo'
import type { PageProps } from './common'
import { isk } from './common'
import { fmtInt } from '../i18n/fmt'
import { Glyph, ICO_TONES } from '../ui/Glyphs'
import { HintIcon } from '../ui/Hint'
import { MarkStar, pinMarked } from '../ui/marks'
import { SUB_ALL, subPasses, SUBS_OF_KIND, RACK_KIND_KEYS, RACK_LABELS, itemBucketPasses, presentSubs, subText } from '../ui/itemSubs'
import type { SubOption } from '../ui/itemSubs'
import { tr, cmdText } from '../i18n/locale'
import { kindTextOfItem } from '../ui/labelsText'

const KIND_TEXT: Record<string, string> = {
  /**
   * **2026-09-16 船长**：「给市场的添加奢侈品分类，放入物品下，**物品改名叫货物**」——
   * 一级类型中文名由「物品」改为「**货物**」（子分类补「奢侈品」，见 `ui/itemSubs.ts` 的 `ITEM_SUBS`）。
   * ⚠ 这**只是市场类型下拉的显示名**：导航页「物品」与手册「物品图鉴」走各自的单点，未随本改（等船长点名）。
   */
  item: tr("ui.MarketPage.005"),
  /**
   * **2026-09-16 船长**：「**将货柜添加到市场的分类里，和货物同级**」——货柜（`container`：五族遗迹安全货柜 ·
   * 三档图纸货柜 · 贵重品货柜 · 军用备货柜）从「货物」里**剔出、独立成一级类型**，与「残骸」（2026-09-08）、
   * 「消耗品」（2026-09-11）两次同类拆分同一套口径（键集合单点 = `ui/itemSubs.ts` 的 `CONTAINER_KIND_KEYS`）。
   * ⚠ 无二级子分类（照「残骸」先例；要分"安全/图纸/贵重品/军用"再说一声）。
   */
  container: tr("ui.MarketPage.006"),
  // 2026-09-11 船长：「应该将消耗品独立出来」——消耗品（弹药/修理组件/无人机）独立成一级类型，
  // 并从「物品」里剔除（与当年「残骸」独立成类的口径一致；子分类见 ui/itemSubs.ts CONSUME_SUBS）
  consume: tr("ui.MarketPage.007"),
  // 2026-09-10 船长：类型筛选移除「装备」，改为高 / 中 / 低槽三个类型（子分类仍是装备的功能分组）
  // ⚠ 中文名走 `ui/itemSubs.ts` 的 `RACK_LABELS` 单点（手册图鉴筛选与仓库筛选读同一份，2026-09-13）
  'module-high': RACK_LABELS.high,
  'module-mid': RACK_LABELS.mid,
  'module-low': RACK_LABELS.low,
  ship: tr("ui.App.002"),
  blueprint: tr("ui.MarketPage.004"),
  aicore: tr("ui.MarketPage.008"),
  wreck: tr("ui.MarketPage.009"),
}
const KIND_OPTIONS = ['all', 'item', 'container', 'consume', 'wreck', 'module-high', 'module-mid', 'module-low', 'ship', 'blueprint', 'aicore'] as const
type KindFilter = (typeof KIND_OPTIONS)[number]
const RARITY_TEXT: Record<MarketRarity, string> = { common: tr("ui.MarketPage.010"), rare: tr("ui.IndustryPage.035"), exotic: tr("ui.MarketPage.011") }

/* 类型子分类表已抽到 ui/itemSubs.ts（市场页与手册图鉴共用同一套口径） */
/** 目录条目对应的物品定义（item 类才查物品表） */
function itemDefOf(ctx: PageProps['engine']['ctx'], good: MarketGoodDef) {
  return good.kind === 'item' ? ctx.items.get(good.refId) : undefined
}

/** 行/悬停的分类文案：残骸类物品单独显示「残骸」（2026-09-08 船长定），
 * 装备按**槽类**显示（高槽装备 / 中槽装备 / 低槽装备；2026-09-10 船长：类型按槽类拆分后行内同步），
 * 其余物品走 itemKindText 单点（2026-09-10：无人机 → 无人机 · 侦察机，子属性并入种类） */
function kindTextOf(ctx: PageProps['engine']['ctx'], good: MarketGoodDef): string {
  const it = itemDefOf(ctx, good)
  if (it) return it.kind === 'wreck' ? tr("ui.MarketPage.009") : kindTextOfItem(it)
  if (good.kind === 'module') {
    const mod = ctx.modules.get(good.refId)
    const rack = mod ? rackOf(mod) : undefined
    return rack !== undefined ? (KIND_TEXT[`module-${rack}`] ?? tr('ui.MarketPage.178')) : tr("ui.MarketPage.003")
  }
  return KIND_TEXT[good.kind] ?? good.kind
}

/**
 * 类型过滤判定（**甲组·判定单点**，船长 2026-09-19「六条基线」之⑥）：物品 / 装备两域一律走
 * `ui/itemSubs.ts` 的**唯一入口** `itemBucketPasses`——原先本函数自己写了一整套
 * （残骸 / 槽类 / 消耗品 / 货柜 / 货物的剔除规则），与物品页仓库、手册图鉴各写一份 ⇒ 已收敛。
 * 本函数现在只保留**市场特有**的部分：舰船 / 蓝图 / AI 核心三种商品按自身 `kind` 同字面判定。
 *
 * ⚠ `kind === 'module'` 已不在类型下拉里，但仍保留判定（`subPasses` 与旧调用方兼容）。
 */
function kindPasses(ctx: PageProps['engine']['ctx'], good: MarketGoodDef, kind: KindFilter | 'module'): boolean {
  if (kind === 'all') return true
  if (good.kind === 'item' || good.kind === 'module') return itemBucketPasses(ctx, good.refId, kind)
  // 舰船 / 蓝图 / AI 核心：类型键与商品自身 kind 同字面
  if (kind === 'module' || RACK_KIND_KEYS.includes(kind as (typeof RACK_KIND_KEYS)[number])) return false
  return good.kind === kind
}

/** mm:ss（向上取整到秒） */
function fmtClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** 距离下一个市场窗口（订单补给/刷新）还剩多少毫秒 */
function nextSupplyIn(engine: PageProps['engine']): number {
  const bal = engine.ctx.balance.market
  const since = engine.state.gameMs - engine.state.market.lastTickGameMs
  const rem = bal.tickMs - (since % bal.tickMs)
  return rem >= 0 ? rem : bal.tickMs
}

/** 某商品现存供应单中最早到期的那笔剩余毫秒；无供应单返回 undefined */
function earliestSellRemaining(engine: PageProps['engine'], goodKey: string): number | undefined {
  const orders = engine.state.market.npcSell[goodKey]
  if (!orders || orders.length === 0) return undefined
  let earliest: number | undefined
  for (const o of orders) {
    if (earliest === undefined || o.expiresAtGameMs < earliest) earliest = o.expiresAtGameMs
  }
  if (earliest === undefined) return undefined
  return Math.max(0, earliest - engine.state.gameMs)
}

/* ═══════════════ 单个商品行（行情 + 买卖 + 手动挂单） ═══════════════ */

/** 商品悬停说明（名称/类型/稀有度 + 数据表描述；AI 核心按效率动态描述）
 *  2026-09-10 船长：不再写「常驻」（普通商品的常驻标记对玩家没有信息量），只标稀有/限定 */
function goodTipText(engine: PageProps['engine'], good: MarketGoodDef): string {
  const rarity = good.rarity !== 'common' ? ` · ${RARITY_TEXT[good.rarity] ?? ''}` : ''
  const head = `${goodName(engine.ctx, good.key)}（${kindTextOf(engine.ctx, good)}${rarity}）`
  let desc = ''
  if (good.kind === 'item') desc = engine.ctx.items.get(good.refId)?.description ?? ''
  else if (good.kind === 'module') desc = engine.ctx.modules.get(good.refId)?.description ?? ''
  else if (good.kind === 'ship') desc = engine.ctx.ships.get(good.refId)?.description ?? ''
  else if (good.kind === 'blueprint')
    desc = engine.ctx.blueprints.get(good.refId)?.description ?? engine.ctx.shipBlueprints.get(good.refId)?.description ?? ''
  else if (good.kind === 'aicore') {
    const eff = Math.round((engine.ctx.balance.aiCore.efficiency[good.refId as never] ?? 1) * 100)
    const tier =
      good.refId === 'basic' ? tr("ui.MarketPage.012") : good.refId === 'gamma' ? tr("ui.MarketPage.013") : good.refId === 'beta' ? tr("ui.MarketPage.014") : tr("ui.MarketPage.015")
    desc = tr("ui.MarketPage.136", { tier: tier, eff: eff })
  }
  return `${head}\n${desc || tr('ui.MarketPage.171')}`
}

/** 蓝图悬浮参数行（产物/产物属性/材料/制造）；装备/弹药/舰船蓝图共用同一形状。
 * 2026-09-08 船长定（玩家反馈）：悬浮须同显产物的属性与介绍——查蓝图 = 看造出来的是什么；
 * 产物属性行/介绍与市场商品行悬浮、手册图鉴同一数据源。蓝图自身文案移入参数行「蓝图说明」。 */
function blueprintHoverLines(
  ctx: PageProps['engine']['ctx'],
  bp: BlueprintDef | ShipBlueprintDef,
): { title: string; lines: InfoLine[]; note: string } {
  const isModuleBp = 'moduleId' in bp
  const isItemBp = 'itemId' in bp // 2026-09-05 弹药蓝图
  const def = bp as BlueprintDef
  const productName = isItemBp
    ? ctx.items.get(def.itemId!)?.name ?? def.itemId!
    : isModuleBp
      ? ctx.modules.get(def.moduleId!)?.name ?? def.moduleId!
      : ctx.ships.get((bp as ShipBlueprintDef).shipId)?.name ?? (bp as ShipBlueprintDef).shipId
  const materials = bp.materials.map((m) => `${ctx.items.get(m.itemId)?.name ?? m.itemId} ×${m.count}`).join('　')
  // 产物属性行（产物是什么：槽位/效果/伤害/抗性/货舱…全站同源行）与产物介绍（note 槽）
  const prodLines: InfoLine[] = []
  let prodDesc = ''
  if (isItemBp) {
    const item = ctx.items.get(def.itemId!)
    if (item) {
      for (const l of itemInfoLines(item, (id) => ctx.items.get(id)?.name)) prodLines.push(l)
      prodDesc = item.description
    }
  } else if (isModuleBp) {
    const mod = ctx.modules.get(def.moduleId!)
    if (mod) {
      for (const l of moduleInfoLines(mod)) prodLines.push(l)
      prodDesc = mod.description
    }
  } else {
    const ship = ctx.ships.get((bp as ShipBlueprintDef).shipId)
    if (ship) {
      for (const l of shipInfoLines(ship)) prodLines.push(l)
      prodDesc = ship.description
    }
  }
  return {
    title: bp.name,
    lines: [
      { k: tr("ui.MarketPage.016"), v: productName },
      ...prodLines,
      ...(bp.description ? [{ k: tr("ui.MarketPage.017"), v: bp.description }] : []),
      { k: tr("ui.MarketPage.018"), v: materials },
      { k: tr("ui.MarketPage.019"), v: tr("ui.MarketPage.137", { p1: formatDurationMs(bp.buildSeconds * 1000) }) },
    ],
    note: prodDesc || bp.description,
  }
}

/**
 * 商品行悬停（全站统一富卡皮肤）：装备/物品/舰船/蓝图/AI 核心各自组装
 * 标题 + 参数表 + 描述——与仓库/货仓/手册列表同一悬浮视觉。
 */
function GoodHover({
  engine,
  good,
  children,
}: {
  engine: PageProps['engine']
  good: MarketGoodDef
  children: ReactNode
}) {
  const ctx = engine.ctx
  const rowCls = 'app-inv-row app-mkt-row'
  if (good.kind === 'module') {
    const mod = ctx.modules.get(good.refId)
    if (mod) {
      return (
        <ModuleHover as="li" mod={mod} className={rowCls}>
          {children}
        </ModuleHover>
      )
    }
  } else if (good.kind === 'item') {
    const item = ctx.items.get(good.refId)
    if (item) {
      return (
        <ItemHover as="li" item={item} className={rowCls} nameOf={(id) => ctx.items.get(id)?.name}>
          {children}
        </ItemHover>
      )
    }
  } else if (good.kind === 'ship') {
    const ship = ctx.ships.get(good.refId)
    if (ship) {
      return (
        <ShipHover as="li" ship={ship} className={rowCls} note={ship.description}>
          {children}
        </ShipHover>
      )
    }
  } else if (good.kind === 'blueprint') {
    const bp = ctx.blueprints.get(good.refId) ?? ctx.shipBlueprints.get(good.refId)
    if (bp) {
      const info = blueprintHoverLines(ctx, bp)
      return (
        <InfoHover as="li" title={info.title} lines={info.lines} note={info.note} className={rowCls}>
          {children}
        </InfoHover>
      )
    }
  } else if (good.kind === 'aicore') {
    const eff = Math.round((engine.ctx.balance.aiCore.efficiency[good.refId as never] ?? 1) * 100)
    const tier =
      good.refId === 'basic' ? tr("ui.MarketPage.020") : good.refId === 'gamma' ? tr("ui.MarketPage.013") : good.refId === 'beta' ? tr("ui.MarketPage.014") : tr("ui.MarketPage.015")
    return (
      <InfoHover
        as="li"
        title={goodName(ctx, good.key)}
        lines={[
          { k: tr("ui.MarketPage.002"), v: tier },
          { k: tr("ui.MarketPage.021"), v: tr("ui.MarketPage.138", { eff: eff }) },
        ]}
        note={tr("ui.MarketPage.022")}
        className={rowCls}
      >
        {children}
      </InfoHover>
    )
  }
  return (
    <HoverTip as="li" tip={goodTipText(engine, good)} className={rowCls}>
      {children}
    </HoverTip>
  )
}

/** 「自己的库存」口径说明（悬停用）：与"能卖出的量"同源；已挂单托管的量不计在内
 *  ⚠ 2026-09-14 船长：舰船拆成「舰船仓库 ＋ 在役舰队」两处（仓库是出售入口）⇒ 舰船那一档改成两者相加 */
const MY_STOCK_TIP =
  tr("ui.MarketPage.023")

/** 玩家自己这件东西的库存（舰船 = 舰船仓库 ＋ 在役舰队；其余走 core「自然库存」单点） */
function myStockOf(state: GameState, good: MarketGoodDef): number {
  if (good.kind === 'ship') {
    let n = shipStoredCount(state, good.refId)
    for (const [uid, e] of Object.entries(state.fleet)) {
      if ((e.defId ?? uid) === good.refId) n += 1
    }
    return n
  }
  return naturalHoldings(state, good)
}

/** 舰队（机库）里同型艘数——舰船可卖量的提示用（可卖只看舰船仓库） */
function fleetCountOf(state: GameState, defId: string): number {
  return Object.entries(state.fleet).filter(([uid, e]) => (e.defId ?? uid) === defId).length
}

function GoodRow({
  engine,
  good,
  onSelect,
  selected,
}: {
  engine: PageProps['engine']
  good: MarketGoodDef
  onSelect?: (key: string) => void
  selected?: boolean
}) {
  const state = engine.state
  const quote = marketQuote(state, engine.ctx, good.key)
  const trend = marketTrend(state, good.key)
  // 2026-09-10 船长：行内不再显示「站内库存」（空间站库存池，玩家看的是自己的货）——
  // 改显示**玩家自己**这件东西的库存（舰船按机库同型艘数；其余走 core「自然库存」单点）
  const holdings = myStockOf(state, good)
  const lock = goodLockedReason(state, good)
  const bm = bmGateReason(state, good)
  const lockShow = lock ?? bm // 玩家侧统一观感：暗市对玩家隐身，仅显示声望锁指引（与顶船同款）
  const life = good.rarity !== 'common' ? earliestSellRemaining(engine, good.key) : undefined
  const name = goodName(engine.ctx, good.key)
  const clickable = onSelect !== undefined

  return (
    <GoodHover engine={engine} good={good}>
      <div
        className={`app-inv-main app-mkt-row-click${selected ? ' is-sel' : ''}`}
        role={clickable ? 'button' : undefined}
        tabIndex={clickable ? 0 : undefined}
        onClick={clickable ? () => onSelect!(good.key) : undefined}
        onKeyDown={
          clickable
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect!(good.key)
                }
              }
            : undefined
        }
      >
        <div className="app-mkt-name-line">
          <MarkStar engine={engine} kind="goods" id={good.key} />
          <span className="app-inv-name">{name}</span>
          <span className="app-chip is-dim">{kindTextOf(engine.ctx, good)}</span>
          {good.kind === 'blueprint' ? (
            <>
              {state.learnedRecipes.includes(good.refId) ? (
                <span className="app-chip is-learned" title={tr("ui.MarketPage.024")}>
                  {tr("ui.MarketPage.025")}
                </span>
              ) : null}
              {(state.blueprintStock[good.refId] ?? 0) > 0 ? (
                <span className="app-chip is-stock" title={tr("ui.MarketPage.026")}>
                  {tr("ui.MarketPage.027")}{(state.blueprintStock[good.refId] ?? 0).toLocaleString('zh-CN')}
                </span>
              ) : null}
            </>
          ) : null}
          {good.rarity === 'rare' ? <span className="app-chip is-rare">{tr("ui.IndustryPage.035")}</span> : null}
          {good.rarity === 'exotic' ? <span className="app-chip is-exotic">{tr("ui.MarketPage.028")}</span> : null}
          {lockShow ? (
            <span className="app-chip is-exotic" title={lockShow}>
              <span className="app-ico">
                <Glyph name="ico-lock" size={11} color={ICO_TONES['ico-lock']} />
              </span>
              {lockShow}
            </span>
          ) : null}
        </div>
        <div className="app-inv-count">
          <span className="app-mkt-quote">
            {tr("ui.MarketPage.029")} <b className="app-gold">{quote.buy !== undefined ? isk(quote.buy) : '—'}</b>
            <span className={trend > 0 ? 'app-trend-up' : trend < 0 ? 'app-trend-down' : 'app-trend-flat'}>
              {trend > 0 ? ' ▲' : trend < 0 ? ' ▼' : ' ·'}
            </span>
          </span>
          <span className="app-mkt-quote">
            {tr("ui.MarketPage.030")} <b className={quote.sell !== undefined ? 'app-price-sell' : ''}>{quote.sell !== undefined ? isk(quote.sell) : good.playerBuyable === false ? tr("ui.MarketPage.031") : tr("ui.MarketPage.032")}</b>
            {quote.sellQty > 1 ? ` ×${quote.sellQty.toLocaleString('zh-CN')}` : ''}
          </span>
          {life !== undefined ? (
            <span className="app-chip app-life-chip">
              <span className="app-ico">
                <Glyph name="ico-clock" size={11} color={ICO_TONES['ico-clock']} />
              </span>
              {fmtClock(life)}
            </span>
          ) : null}
          <span className="app-dim" title={MY_STOCK_TIP}>
            {' '}
            {tr('ui.MarketPage.126', { n: fmtInt(holdings) })}
          </span>
          {quote.sell === undefined && good.rarity !== 'common' ? (
            <span className="app-dim">{tr('ui.MarketPage.127')}</span>
          ) : null}
        </div>
      </div>
    </GoodHover>
  )
}

/* ═══════════════ 市场栏（标题 + 有货冒泡列表；搜索/类型过滤已提升到页面级跨栏） ═══════════════ */

/** 挂单回执文案（2026-09-10 船长定：挂单瞬间先与现有簿面对冲 → 回执写明即时成交部分）
 *  `unit`：量词（舰船「艘」/ 其余「件」；2026-09-14 舰船挂卖单放行后加） */
function placeOrderToast(
  side: '买' | '卖', // l10n-keep：side 是字面量联合 key（显示时按 id 取译名）
  name: string,
  want: number,
  price: number,
  filled: number,
  resting: number,
  unit = '件',
): string {
  const n = (v: number): string => v.toLocaleString('zh-CN')
  // side 是字面量联合 key（不是文案）⇒ 显示时才按 id 取译名（l10n-keep 的同款口径）
  const sideText = side === '买' ? tr('ui.MarketPage.159') : tr('ui.MarketPage.160')
  if (filled <= 0) return tr("ui.MarketPage.139", { side: sideText, name: name, p3: n(want), p4: isk(price) })
  if (resting <= 0) return tr("ui.MarketPage.140", { side: sideText, name: name, p3: n(filled), p4: isk(price) })
  return tr("ui.MarketPage.141", { side: sideText, p2: n(filled), unit: unit, p4: n(resting), unit2: unit, p6: isk(price) })
}

/**
 * 贸易税说明（2026-09-13 船长：各页常驻说明统一收进标题后的圆形感叹号）。
 * 税率随「会计学 / 贸易谈判学」等级变化 ⇒ 每次渲染现算；市场详情与未选中时的占位面板共用这一份文案。
 */
function taxTipText(state: GameState, ctx: PageProps['engine']['ctx']): string {
  const rate = salesTaxRate(state, ctx)
  const lvA = state.skills.trained[ctx.balance.market.taxSkillAId] ?? 0
  const lvB = state.skills.trained[ctx.balance.market.taxSkillBId] ?? 0
  const skillNote =
    lvA + lvB > 0
      ? tr("ui.MarketPage.142", { lvA: lvA, p2: lvA * 8, lvB: lvB, p4: lvB * 8 })
      : tr("ui.MarketPage.033")
  return tr("ui.MarketPage.143", { p1: Math.round(rate * 1000) / 10, skillNote: skillNote })
}

/** 协会市场的撮合与星标说明（挂单簿语义、冲击动量、行首星标；2026-09-13 收进列表标题后的圆形感叹号） */
const MKT_MECH_TIP =
  tr("ui.MarketPage.034")

/** 有货冒泡上浮（供应簿有现货的排前面）；其余保持目录稳定顺序。
 *  2026-09-10 船长定：默认排序下已标记（收藏）的商品置顶——两栏与搜索结果都是这一套默认口径。 */
function stockedFirst(engine: PageProps['engine'], goods: MarketGoodDef[]): MarketGoodDef[] {
  const hasStock = new Map(goods.map((g) => [g.key, marketQuote(engine.state, engine.ctx, g.key).sell !== undefined]))
  const rows = [...goods].sort((a, b) => Number(hasStock.get(b.key)) - Number(hasStock.get(a.key)))
  return pinMarked(engine.state, 'goods', rows, (g) => g.key)
}

/** 稀有档列排序（稀有订单与限定奇货两个标签共用；2026-09-08 船长定：优先置顶"有货的限定奇货"）：
 * ① 有货奇货 → ② 其余有货 → ③ 无货奇货 → ④ 其余无货；组内保持目录稳定顺序；
 * 2026-09-10 起：已标记商品再置顶一层（本列无用户可选排序，仍属默认口径） */
function rareOrderRows(engine: PageProps['engine'], goods: MarketGoodDef[]): MarketGoodDef[] {
  const hasStock = new Map(goods.map((g) => [g.key, marketQuote(engine.state, engine.ctx, g.key).sell !== undefined]))
  const tier = (g: MarketGoodDef): number => {
    const stocked = hasStock.get(g.key) === true
    if (stocked && g.rarity === 'exotic') return 0
    if (stocked) return 1
    return g.rarity === 'exotic' ? 2 : 3
  }
  const rows = [...goods].sort((a, b) => tier(a) - tier(b))
  return pinMarked(engine.state, 'goods', rows, (g) => g.key)
}

function MarketColumn({
  engine,
  title,
  hint,
  right,
  rows,
  empty,
  selKey,
  onSelect,
}: {
  engine: PageProps['engine']
  title: string
  /** 标题文字后的提示标记（撮合与星标说明；2026-09-13 船长口径） */
  hint?: ReactNode
  right: ReactNode
  rows: MarketGoodDef[]
  /** 空态文案（缺省＝"没有匹配的订单"那句；「限定奇货」这类会周期性缺货的档要写自己的话，见调用处） */
  empty?: string
  selKey?: string | null
  onSelect?: (key: string) => void
}) {
  return (
    // is-fill + 去掉列表自身 max-height 帽：列表交给 Panel body 二级内滚（一级页不滚）
    <Panel className="is-fill" title={title} hint={hint} right={right}>
      {rows.length === 0 ? (
        <div className="app-dim app-inv-empty">{empty ?? tr("ui.MarketPage.035")}</div>
      ) : (
        <ul className="app-inv-list">
          {rows.map((good) => (
            <GoodRow key={good.key} engine={engine} good={good} selected={good.key === selKey} onSelect={onSelect} />
          ))}
        </ul>
      )}
    </Panel>
  )
}

/* ═══════════════ 市场详情卡（船长 2026-09-05：参考盘口风格——价格曲线/买卖盘/持有量/交易面板） ═══════════════ */

/** 价格折线（SVG）。
 * 2026-09-08 船长：保留点 24 → 48；显示宽度自适应——容器够宽时整条 48 点直显；
 * 宽度不足（采样点过密）时自动只显示「最新 24 点」（= 最近 12 小时；不做更早段查看入口，船长后定不实现）；
 * 悬停任意采样点可查看该点数值与相对时间。
 * ⚠ **采样节奏 = 30 分钟/点**（船长 2026-09-16「按照原来的30分钟来」）⇒ 48 点 = **24 小时**；
 * 换算时间的分钟数走 core 单点 `PRICE_SAMPLE_MS`，界面不再自己写死一个 30。 */
/** 采样点最小可视间距（px）：低于该密度判定"宽度不足"，回退显示最新 24 点 */
const MIN_POINT_SPACING_PX = 12

/** 采样点「约 N 分钟前」标注（样本间隔 = `PRICE_SAMPLE_MS`（30 分钟）；最新样本 = 现在） */
function sampleAgoLabel(fullLen: number, absIdx: number): string {
  const mins = ((fullLen - 1 - absIdx) * PRICE_SAMPLE_MS) / 60_000
  if (mins <= 0) return tr("ui.MarketPage.036")
  if (mins < 60) return tr("ui.MarketPage.144", { mins: mins })
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? tr("ui.MarketPage.145", { h: h }) : tr("ui.MarketPage.146", { h: h, m: m })
}

function PriceChart({ hist }: { hist: readonly number[] }) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [wrapW, setWrapW] = useState<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const fullLen = hist.length
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setWrapW(el.clientWidth)
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])
  if (fullLen < 2) {
    return (
      <div className="app-mkt-chart-empty">
        <span className="app-dim">{tr("ui.MarketPage.037")}</span>
      </div>
    )
  }
  // 宽度自适应（2026-09-08 船长）：够宽 → 整条保留窗直显；宽度不足 → 自动只显示最新 24 窗
  const tooNarrow = wrapW !== null && wrapW < fullLen * MIN_POINT_SPACING_PX
  const slice = tooNarrow ? hist.slice(-24) : hist
  const offset = tooNarrow ? fullLen - 24 : 0
  const w = 560
  const h = 120
  const pad = 6
  // y 轴范围：在可见段最高/最低基础上外扩约 15% 并向上/下取整（船长 2026-09-05：不让折线顶死上下边框）
  const dataMn = Math.min(...slice)
  const dataMx = Math.max(...slice)
  const dataRange = Math.max(1, dataMx - dataMn)
  const margin = dataRange * 0.15
  const axisMin = Math.floor(dataMn - margin)
  const axisMax = Math.ceil(dataMx + margin)
  const axisSpan = Math.max(1, axisMax - axisMin)
  const mapY = (v: number) => h - pad - ((v - axisMin) / axisSpan) * (h - pad * 2)
  const xAt = (i: number) => (i / (slice.length - 1)) * (w - pad * 2) + pad
  const pts = slice.map((v, i) => `${xAt(i).toFixed(1)},${mapY(v).toFixed(1)}`).join(' ')
  return (
    <div className="app-mkt-chart-wrap" ref={wrapRef}>
        <svg
          className="app-mkt-chart"
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={tr('ui.MarketPage.172')}
          onMouseLeave={() => setHover(null)}
        >
          <polyline points={pts} fill="none" stroke="rgb(var(--wui-gold))" strokeWidth="2" opacity="0.9" />
          {slice.map((v, i) => {
            const x = xAt(i)
            const y = mapY(v)
            const isLast = offset + i === fullLen - 1
            const isHover = hover === i
            return (
              <g key={offset + i}>
                {!isLast && !isHover ? <circle cx={x} cy={y} r={1.6} fill="rgba(255,224,138,0.55)" /> : null}
                {isLast ? <circle cx={x} cy={y} r={3.5} style={{ fill: 'rgb(var(--wui-flag))' }} /> : null}
                {isHover ? <circle cx={x} cy={y} r={4.5} fill="none" style={{ stroke: 'rgb(var(--wui-flag))' }} strokeWidth={1.2} /> : null}
                <circle cx={x} cy={y} r={7} fill="transparent" style={{ cursor: 'crosshair' }} onMouseEnter={() => setHover(i)} />
              </g>
            )
          })}
          <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
        </svg>
        {/* 高低价标注用 HTML 覆盖层（非 SVG 文本），避免 preserveAspectRatio=none 拉伸字形 */}
        <span className="app-mkt-chart-hi">{tr("ui.MarketPage.038")} {isk(dataMx)}</span>
        <span className="app-mkt-chart-lo">{tr("ui.MarketPage.039")} {isk(dataMn)}</span>
        {hover !== null && hover < slice.length ? (
          <div
            className={`app-mkt-chart-tip${mapY(slice[hover]!) < 40 ? ' is-below' : ''}`}
            style={{
              left: `${(xAt(hover) / w) * 100}%`,
              // 浮标挂在 .app-mkt-chart-wrap 上 ⇒ 百分比要按 **viewBox 高度**折算（图会被 CSS 拉伸到 wrap 的实测高度，
              // 折线图高度现在跟面板走、wrap 不再是固定 130px；此前写死的 /130 也一直让浮标偏高约 8%）
              top: `${(mapY(slice[hover]!) / h) * 100}%`,
            }}
          >
            ≈{isk(slice[hover]!)} {tr("ui.MarketPage.040")} {sampleAgoLabel(fullLen, offset + hover)}
          </div>
        ) : null}
    </div>
  )
}

/**
 * 买卖盘显示档数：**上限 12**、下限 5。
 *
 * - **下限 5**（船长 2026-09-14：「窗口高度不足时可以隐藏部分订单，最少显示 5 个」）——不变。
 * - **上限 2026-09-22 由 8 放宽到 12**（船长：「既然我的订单已经移走了，那么关于买卖订单的最大显示数量
 *   是不是可以放宽？在保证不会过多的情况下？」）。依据是当天实测（`docs/design/market-book-rows-20260922.md`）：
 *   ① 「我的挂单」搬走后右栏只剩详情卡 ⇒ 买卖盘可用高度大增：按本组件自己那套公式现算，
 *      窗口高 800/900/1080/1440 分别**放得下 16/22/33/55 档** ⇒ 原来的 8 档上限成了唯一瓶颈；
 *   ② 全部真实档位**最深 11 档**（两份后期档：买侧最大 11、卖侧最大 10，**没有任何商品超过 12 档**；
 *      466 个有簿面的商品里 230 个超过 8 档）⇒ **12 就是"全覆盖且不过多"的那个数**，
 *      再往上加也不会多显示一行（数据里没有那么多档）。
 * - 自适应机制（下面 `useLayoutEffect` 量可用高度反推行数）**一字未改**：窗口矮时照旧只渲染放得下的
 *   **整行**、绝不裁半行；档数超过上限时按价差取前 N 档。
 */
const BOOK_ROWS_MAX = 12
const BOOK_ROWS_MIN = 5

/** 市场详情卡：价格曲线 + 买卖盘深度 + 持有量 + 交易面板（买/卖 tab：市价或挂单） */
function MarketDetail({ engine, onToast, good }: { engine: PageProps['engine']; onToast: PageProps['onToast']; good: MarketGoodDef }) {
  const state = engine.state
  const quote = marketQuote(state, engine.ctx, good.key)
  const hist = marketHistory(state, good.key)
  const trend = marketTrend(state, good.key)
  const holdings = good.kind === 'ship' ? shipStoredCount(state, good.refId) : naturalHoldings(state, good)
  /** 舰船的量词是「艘」（其余商品是「件」）；舰队同型艘数用于"可卖量从哪来"的提示 */
  const unit = good.kind === 'ship' ? tr("ui.MarketPage.116") : tr("ui.MarketPage.117")
  const shipInFleet = good.kind === 'ship' ? fleetCountOf(state, good.refId) : 0
  const lock = goodLockedReason(state, good)
  /**
   * 买卖盘显示几档：**随这块自己的实测高度自适应**（船长 2026-09-14：「当窗口高度不足时，可以隐藏部分订单
   * （最少显示5个订单）」）。做法 = 让买卖盘那块可被压缩（`styles.css` 的 flex/ min-height 105px = 5 档下限），
   * 量它的实测高度反推行数 ⇒ **只渲染放得下的整行**（绝不裁半行）；紧到 5 档都放不下时由面板体出内滚。
   * 行高/标题高从 DOM 实测（拿不到就退回样式表里的标称值），避免两处硬编码漂移。
   */
  const [bookRows, setBookRows] = useState(BOOK_ROWS_MAX)
  const booksRef = useRef<HTMLDivElement | null>(null)
  // 按价格档聚合成交量（2026-09-05 船长：同价订单不应拆成多行——盘口按档合并），再取前 N 档（N 见 bookRows）
  const agg = (orders: Array<{ price: number; qty: number }>, desc: boolean): Array<{ price: number; qty: number }> => {
    const m = new Map<number, number>()
    for (const o of orders) m.set(o.price, (m.get(o.price) ?? 0) + o.qty)
    return [...m.entries()]
      .map(([price, qty]) => ({ price, qty }))
      .sort((a, b) => (desc ? b.price - a.price : a.price - b.price))
      .slice(0, bookRows)
  }
  const buyOrders = agg(state.market.npcBuy[good.key] ?? [], true)
  const sellOrders = agg(state.market.npcSell[good.key] ?? [], false)
  const maxOrderQty = Math.max(1, ...buyOrders.map((o) => o.qty), ...sellOrders.map((o) => o.qty))
  const sortedHist = hist.length ? [...hist].sort((a, b) => a - b) : []
  const median = sortedHist.length ? sortedHist[Math.floor(sortedHist.length / 2)]! : undefined
  const name = goodName(engine.ctx, good.key)
  const buyable = good.playerBuyable !== false // 只收不卖商品（残骸等）：不可买入
  const [tab, setTab] = useState<'buy' | 'sell'>(buyable ? 'buy' : 'sell')
  const [qty, setQty] = useState(1)
  const [price, setPrice] = useState(1)
  const [confirmSell, setConfirmSell] = useState<{
    avail: number
    want: number
    fillable: number
    orders: number
    gross: number
    tax: number
    net: number
    leftover: number
  } | null>(null)

  // 打开详情时按初始页签预填一次默认价/数量（此后切换页签保留手填值，2026-09-08 船长定）
  const initRef = useRef<'buy' | 'sell'>(buyable ? 'buy' : 'sell')
  useEffect(() => {
    initRef.current = buyable ? 'buy' : 'sell'
    const side = initRef.current
    setPrice(Math.max(1, side === 'buy' ? quote.sell ?? askLineOf(state, engine.ctx, good.key) : buyLineOf(state, engine.ctx, good.key)))
    setQty(side === 'sell' ? Math.max(1, holdings) : 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [good.key])
  /**
   * 买卖盘显示几档：**随面板可用高度自适应**（船长 2026-09-14：「当窗口高度不足时，可以隐藏部分订单
   * （最少显示5个订单）」）。做法 = 让买卖盘那块可被压缩（`styles.css`：flex + min-height 105px = 5 档下限），
   * 这里量「面板体还能给它多少」反推行数 ⇒ **只渲染放得下的整行**（绝不裁半行）；紧到 5 档都放不下时
   * 由面板体出内滚。可用高度 = 面板体内高 − 上下内边距 − 除买卖盘外各块 − 块间距，其中折线图**按它的
   * 下限（min-height 64px）计入**，差额补给买卖盘。
   * ⚠ 不能量买卖盘自己的高度反推（第一版正是如此）：它被压到 5 档后尺寸不再变化 ⇒ ResizeObserver
   * 不再触发 ⇒ 卡死在 5 档。改看**面板体**（尺寸由窗口/布局决定，是稳定触发源）。
   * ⚠ **2026-09-15 起**右栏分配改判（详情按内容高封顶、富余归「我的挂单」，见 `styles.css` 的
   * `market right column stretch` 段）：窗口够高时详情面板不再被拉长 ⇒ 面板体高度由内容决定，
   * 本函数量出来的档数会**逐步升到上限 8**（`fit(rows) ≥ rows+1` ⇒ 不会反向层层下探），
   * 窗口矮时详情被压、面板体高度由 flex 决定 ⇒ 与改判前一样稳定。
   */
  useLayoutEffect(() => {
    const el = booksRef.current
    if (!el) return
    const body = el.closest('.wui-panel-body') as HTMLElement | null
    const detail = el.parentElement as HTMLElement | null
    if (!body || !detail) return
    const measure = (): void => {
      const titleEl = el.querySelector('.app-mkt-book-title')
      const rowEl = el.querySelector('.app-mkt-depth')
      // ⚠ 实测值必须**夹到合理区间**：手机旋转模式（`is-mobile-rot`）下首次测量可能落在布局未定型的瞬间
      // ——实测到过「一行 166px」，写进 `min-height` 后把卡片顶出 ~780px 空白，且此后尺寸不再变、
      // ResizeObserver 也不再触发 ⇒ 永久卡死。行高/标题高的正常区间是 10~40px，越界就用标称值。
      const clampPx = (v: number, fallback: number): number => (v >= 10 && v <= 40 ? v : fallback)
      const titleH = clampPx(titleEl ? titleEl.getBoundingClientRect().height : 16.5, 16.5) + 3 // 标题行高 + 下边距 3px
      const rowH = clampPx(rowEl ? rowEl.getBoundingClientRect().height : 16.5, 16.5)
      // 5 档下限：**只在数据确实有 ≥5 档时**才把这块撑到 5 档高（数据本来不足 5 档就按内容高 ——
      // 否则白占近 20px，紧窗口里正好把面板顶出一条内滚，实测 15/123 就是这么来的）
      const levels = (rows: Array<{ price: number }>): number => new Set(rows.map((o) => o.price)).size
      const maxLevels = Math.max(
        levels(state.market.npcBuy[good.key] ?? []),
        levels(state.market.npcSell[good.key] ?? []),
      )
      const floorRows = Math.max(1, Math.min(BOOK_ROWS_MIN, maxLevels))
      el.style.minHeight = `${Math.round(titleH + floorRows * rowH)}px`
      const charts = detail.querySelector('.app-mkt-chart-wrap, .app-mkt-chart-empty') as HTMLElement | null
      const chartFloor = charts ? parseFloat(getComputedStyle(charts).minHeight) || 64 : 64
      const chartNow = charts ? charts.getBoundingClientRect().height : 0
      const gap = parseFloat(getComputedStyle(detail).rowGap) || 12
      const csBody = getComputedStyle(body)
      const padY = (parseFloat(csBody.paddingTop) || 0) + (parseFloat(csBody.paddingBottom) || 0)
      let others = 0
      let count = 0
      for (const child of Array.from(detail.children)) {
        count++
        if (child === el) continue
        const h = child.getBoundingClientRect().height
        others += charts && child.contains(charts) ? h - chartNow + chartFloor : h
      }
      const avail = body.clientHeight - padY - others - gap * Math.max(0, count - 1) - 16 // 16px 余量：各块高度取整/小数累计的零头（余量给小了，残差会顶出一条 1~3px 的内滚）
      const fit = Math.floor((avail - titleH) / rowH)
      const next = Math.max(BOOK_ROWS_MIN, Math.min(BOOK_ROWS_MAX, fit))
      setBookRows((prev) => (prev === next ? prev : next)) // 值守卫：不触发多余重渲染
    }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(body)
    // 各兄弟块也看一眼：交易面板/提示行会随换页签、预填价、文案折行改高（只观察不改高度的话，
    // 行数会停在按旧高度算的值上，紧窗口里就可能多出一行的内滚）
    for (const child of Array.from(detail.children)) ro?.observe(child)
    window.addEventListener('resize', measure)
    // 兄弟块的最终高度可能在这一帧之后才定（例如下方「我的挂单」被对齐到整行后会改本面板的高度）
    // ⇒ 下一帧再量一次，避免按旧高度算出行数、把买卖盘裁掉半行
    const raf = requestAnimationFrame(measure)
    return () => {
      cancelAnimationFrame(raf)
      ro?.disconnect()
      window.removeEventListener('resize', measure)
    }
    // 换商品 / 切买·卖页签都会改交易面板与提示行的高度 ⇒ 各重算一次
  }, [good.key, tab])
  function doBuy(): void {
    if (lock) {
      onToast(tr("ui.MarketPage.147", { lock: lock }), true)
      return
    }
    const n = Math.max(1, Math.floor(qty || 1))
    const r = engine.buyGoodAt(good.key, n)
    if (!r.ok) onToast(cmdText(r) || tr('ui.MarketPage.173'), true)
    else onToast(tr("ui.MarketPage.148", { name: name, p2: n.toLocaleString('zh-CN') }))
  }
  function doSell(q?: number): void {
    const n = Math.max(1, Math.min(holdings, Math.floor(q ?? (qty || 1))))
    if (n <= 0 || holdings <= 0) {
      onToast(good.kind === 'ship' ? tr("ui.MarketPage.041") : tr("ui.MarketPage.042"), true)
      return
    }
    const r = engine.sellHoldingAt(good.key, n)
    if (!r.ok) onToast(cmdText(r) || tr('ui.MarketPage.174'), true)
    else if (good.kind === 'ship') {
      // 舰船：即时成交的部分吃收购簿，其余**留簿挂着**（可撤销退回舰船仓库）——回执把两段都说清
      const filled = r.sold ?? 0
      const rest = r.remaining ?? 0
      onToast(
        rest > 0
          ? `已提交出售 ${name}×${n} 艘：即时成交 ${filled} 艘${filled > 0 ? tr("ui.MarketPage.149", { p1: isk(r.total ?? 0) }) : ''}，余 ${rest} 艘已留簿挂单（可随时撤销退回舰船仓库）。`
          : tr("ui.MarketPage.150", { name: name, filled: filled, p3: isk(r.total ?? 0) }),
      )
    } else onToast(tr("ui.MarketPage.151", { name: name, p2: n.toLocaleString('zh-CN') }))
  }
  /** 全部卖出：先预览（可成交件数/毛额/税/净到账）再弹确认——不直接执行（船长 2026-09-05） */
  function askSellAll(): void {
    if (holdings <= 0) {
      onToast(good.kind === 'ship' ? tr("ui.MarketPage.041") : tr("ui.MarketPage.042"), true)
      return
    }
    const pv = engine.sellPreviewAt(good.key, holdings)
    if (!pv.ok) {
      onToast(pv.error ?? tr('ui.MarketPage.175'), true)
      return
    }
    setConfirmSell(pv)
  }
  function doSellAll(): void {
    setConfirmSell(null)
    const r = engine.sellHoldingAt(good.key, holdings)
    if (!r.ok) onToast(cmdText(r) || tr('ui.MarketPage.174'), true)
    else if (good.kind === 'ship') {
      const filled = r.sold ?? 0
      const rest = r.remaining ?? 0
      onToast(
        rest > 0
          ? `已提交出售 ${name}×${holdings} 艘：即时成交 ${filled} 艘${filled > 0 ? tr("ui.MarketPage.149", { p1: isk(r.total ?? 0) }) : ''}，余 ${rest} 艘已留簿挂单（可撤销退回舰船仓库）。`
          : tr("ui.MarketPage.152", { name: name, filled: filled, p3: isk(r.total ?? 0) }),
      )
    } else onToast(tr("ui.MarketPage.153", { name: name, p2: holdings.toLocaleString('zh-CN') }))
  }
  function doPlace(): void {
    const n = Math.max(1, Math.floor(qty || 1))
    const p = Math.max(1, Math.floor(price || 1))
    if (tab === 'buy') {
      // 2026-09-08（船长反馈）：声望不足等门槛原因要明示，不再笼统报"价格或数量无效"。
      // 2026-09-11（预扣冻结）：余额不足同样明示（core 单点口径：挂 1 件需预扣多少、钱包多少）
      const gate = engine.buyOrderBlocked(good.key, p, n)
      if (gate) {
        onToast(tr("ui.MarketPage.154", { gate: gate }), true)
        return
      }
      const res = engine.placeBuyOrderAt(good.key, p, n)
      if (res === null) onToast(tr("ui.MarketPage.155"), true)
      else {
        // 2026-09-10：挂单瞬间会先与现有卖单簿面对冲成交 → 回执写明即时成交部分
        const exoNote =
          good.rarity === 'exotic' && p < askLineOf(state, engine.ctx, good.key)
            ? tr("ui.MarketPage.156", { p1: isk(askLineOf(state, engine.ctx, good.key)) })
            : ''
        // 2026-09-11：预扣口径写进回执（实际挂量可能因余额缩量；预扣撤单即退回）
        const shrinkNote = res.placed < n ? tr("ui.MarketPage.157", { p1: n.toLocaleString('zh-CN'), p2: res.placed.toLocaleString('zh-CN') }) : ''
        const escrowNote = res.escrow > 0 ? tr("ui.MarketPage.158", { p1: isk(res.escrow) }) : ''
        onToast(`${placeOrderToast('买' /* l10n-keep：side 是字面量联合 key */, name, res.placed, p, res.filled, res.resting)}${shrinkNote}${escrowNote}${exoNote}。`)
      }
    } else {
      const r = engine.placeSellOrderAt(good.key, p, n)
      if (!r.ok) onToast(cmdText(r) || tr('ui.MarketPage.176'), true)
      else onToast(`${placeOrderToast('卖' /* l10n-keep：同上 */, name, n, p, r.filled ?? 0, r.resting ?? n, unit)}。`)
    }
  }
  /**
   * 点盘口行快速就位（2026-09-08 船长）：买盘（收你的货）行 → 切「卖出」并预填该档价格/数量，
   * 卖盘（卖给你的货）行 → 切「买入」并预填该档价格/数量——填好后可直接微调挂单或走市价按钮。
   */
  function fillFromBook(side: 'buy' | 'sell', rowPrice: number, rowQty: number): void {
    setTab(side)
    setPrice(rowPrice)
    setQty(Math.max(1, rowQty))
  }

  return (
    <>
    <Panel
      title={tr("ui.MarketPage.161", { name: name })}
      hint={<HintIcon tip={taxTipText(state, engine.ctx)} />}
      right={
        <span className="app-dim">
          {/* 2026-09-14：舰船的可卖量 = **舰船仓库**艘数（机库里的船不能直接卖）⇒ 舰船把两处读数分开写 */}
          {good.kind === 'ship'
            ? tr('ui.MarketPage.123', { a: fmtInt(holdings), b: fmtInt(shipInFleet) })
            : tr('ui.MarketPage.124', { n: fmtInt(holdings) })}{' '}
          {tr('ui.MarketPage.125', { v: median !== undefined ? isk(median) : '—' })}
          <span className={trend > 0 ? 'app-trend-up' : trend < 0 ? 'app-trend-down' : 'app-trend-flat'}>
            {trend > 0 ? ' ▲' : trend < 0 ? ' ▼' : tr("ui.MarketPage.118")}
          </span>
        </span>
      }
    >
      <div className="app-mkt-detail">
        <div className="app-mkt-detail-left">
          <PriceChart hist={hist} />
          <div className="app-mkt-detail-quotes">
            <div className="app-mkt-quote">
              {tr("ui.MarketPage.029")} <b className="app-gold">{quote.buy !== undefined ? isk(quote.buy) : '—'}</b>
            </div>
            <div className="app-mkt-quote">
              {tr("ui.MarketPage.030")} <b className={quote.sell !== undefined ? 'app-price-sell' : ''}>{quote.sell !== undefined ? isk(quote.sell) : buyable ? tr("ui.MarketPage.032") : tr("ui.MarketPage.031")}</b>
            </div>
            <div className="app-mkt-quote">
              {tr("ui.MarketPage.043")} {good.poolTarget && good.poolTarget > 0 ? Math.floor(state.market.pools[good.key]?.q ?? 0).toLocaleString('zh-CN') : '—'}
            </div>
          </div>
        </div>
        <div className="app-mkt-detail-books" ref={booksRef}>
          <div className="app-mkt-book">
            <div className="app-mkt-book-title">{tr("ui.MarketPage.044")}</div>
            {buyOrders.map((o, i) => (
              <div
                key={`b${i}`}
                className="app-mkt-depth is-click"
                title={tr("ui.MarketPage.045")}
                onClick={() => fillFromBook('sell', o.price, o.qty)}
              >
                <span className="app-mkt-depth-price">{isk(o.price)}</span>
                <span className="app-mkt-depth-bar app-mkt-depth-buy">
                  <i style={{ width: `${Math.round((o.qty / maxOrderQty) * 100)}%` }} />
                </span>
                <span className="app-mkt-depth-qty">{o.qty.toLocaleString('zh-CN')}</span>
              </div>
            ))}
            {buyOrders.length === 0 ? <div className="app-dim app-sr-eta">{tr("ui.MarketPage.046")}</div> : null}
          </div>
          <div className="app-mkt-book">
            <div className="app-mkt-book-title">{tr("ui.MarketPage.047")}</div>
            {sellOrders.map((o, i) => (
              <div
                key={`s${i}`}
                className="app-mkt-depth is-click"
                title={tr("ui.MarketPage.048")}
                onClick={() => fillFromBook('buy', o.price, o.qty)}
              >
                <span className="app-mkt-depth-price">{isk(o.price)}</span>
                <span className="app-mkt-depth-bar app-mkt-depth-sell">
                  <i style={{ width: `${Math.round((o.qty / maxOrderQty) * 100)}%` }} />
                </span>
                <span className="app-mkt-depth-qty">{o.qty.toLocaleString('zh-CN')}</span>
              </div>
            ))}
            {sellOrders.length === 0 ? (
              <div className="app-dim app-sr-eta">{buyable ? tr("ui.MarketPage.049") : tr("ui.MarketPage.050")}</div>
            ) : null}
          </div>
        </div>
        <div className="app-mkt-trade">
          {/* 交易面板（2026-09-09 船长布局：左列 = 买/卖切换 + 数量/单价输入；右侧按钮容器 =
              挂单/市价/(卖出侧)全部卖出 纵向整体，按钮等宽撑近容器宽） */}
          <div className="app-mkt-trade-body">
            <div className="app-mkt-trade-fields">
              <div className="app-mkt-trade-row">
                <div className="app-mkt-sides" role="tablist">
                  <button
                    role="tab"
                    aria-selected={tab === 'buy'}
                    disabled={!buyable}
                    className={`app-mkt-side is-buy${tab === 'buy' ? ' is-active' : ''}${buyable ? '' : ' is-disabled'}`}
                    onClick={() => setTab('buy')}
                    title={buyable ? undefined : tr("ui.MarketPage.051")}
                  >
                    {tr("ui.MarketPage.052")}
                  </button>
                  <button
                    role="tab"
                    aria-selected={tab === 'sell'}
                    className={`app-mkt-side is-sell${tab === 'sell' ? ' is-active' : ''}`}
                    onClick={() => setTab('sell')}
                  >
                    {tr("ui.MarketPage.053")}
                  </button>
                </div>
              </div>
              <div className="app-mkt-trade-row">
                <span className="app-dim">{tr("ui.Expedition.003")}</span>
                <input className="app-input" type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
                {tab === 'sell' ? (
                  <button className="app-btn is-small" disabled={holdings <= 0} onClick={() => setQty(Math.max(1, holdings))} title={tr("ui.MarketPage.162", { holdings: holdings, unit: unit })}>
                    {tr("ui.IndustryPage.001")}
                  </button>
                ) : null}
              </div>
              <div className="app-mkt-trade-row">
                <span className="app-dim">{tr("ui.MarketPage.054")}</span>
                <input className="app-input" type="number" min={1} value={price} onChange={(e) => setPrice(Number(e.target.value))} />
                <span className="app-dim">{tr("ui.FirstTasks.003")}</span>
              </div>
            </div>
            <div className="app-mkt-actions">
              <button className="app-btn is-small" onClick={doPlace}>
                {tab === 'buy' ? tr("ui.MarketPage.055") : tr("ui.MarketPage.056")}
              </button>
              {/* 市价买入（2026-09-11 船长实测反馈修复）：**没有可吃单 / 钱包连最低一张都不够时按钮禁用**，
                  并把原因写在 title 里——此前按钮一直可点，点下去只会报一句"供应簿只剩 0 件"（原因其实是钱不够/声望闸/无货） */}
              <button
                className="app-btn is-primary is-small"
                disabled={tab === 'buy' && (quote.sell === undefined || state.wallet.isk < quote.sell)}
                title={
                  tab !== 'buy'
                    ? undefined
                    : quote.sell === undefined
                      ? tr("ui.MarketPage.057")
                      : state.wallet.isk < quote.sell
                        ? tr("ui.MarketPage.163", { p1: isk(quote.sell), p2: isk(Math.floor(state.wallet.isk)) })
                        : undefined
                }
                onClick={tab === 'buy' ? doBuy : () => doSell()}
              >
                {tab === 'buy' ? tr("ui.MarketPage.058") : tr("ui.CargoPage.038")}
              </button>
              {tab === 'sell' ? (
                <button className="app-btn is-small is-sellall" disabled={holdings <= 0} onClick={askSellAll} title={tr("ui.MarketPage.059")}>
                  {tr("ui.MarketPage.060")}{holdings} {unit}）
                </button>
              ) : null}
            </div>
          </div>
          {/* 舰船专卖提示（2026-09-14 船长报障「市场依旧无法挂单或者直接出售舰船」）：
              可卖只有**舰船仓库**这一处来源，机库里的船要先入库——仓库空而机库有货时把这一步说明白 */}
          {good.kind === 'ship' ? (
            <div className={`app-dim app-sr-eta${holdings <= 0 && shipInFleet > 0 ? ' is-warn' : ''}`}>
              {holdings > 0
                ? tr("ui.MarketPage.164", { holdings: holdings })
                : shipInFleet > 0
                  ? tr("ui.MarketPage.165", { shipInFleet: shipInFleet })
                  : tr("ui.MarketPage.061")}
            </div>
          ) : null}
          {/* 价格指引（2026-09-08 船长定：不向玩家披露站内吸收/巡游通道——只保留普通撮合语义的指导文案） */}
          <div className="app-dim app-sr-eta">
            {(() => {
              const p = Math.max(1, Math.floor(price || 1))
              if (tab === 'sell') {
                const bid = buyLineOf(state, engine.ctx, good.key)
                if (p > bid) {
                  return (
                    <>
                      {tr("ui.MarketPage.062")} {isk(bid)}{tr('ui.MarketPage.128')}
                    </>
                  )
                }
                if (p < bid) {
                  return (
                    <>
                      {tr("ui.MarketPage.063")} {isk(bid)}{tr('ui.MarketPage.129')}
                    </>
                  )
                }
                return <>{tr("ui.MarketPage.064")} {isk(bid)}{tr('ui.MarketPage.130')}</>
              }
              // 奇货专项提示（2026-09-08 船长定）：挂单价低于奇货参考价时提醒并给出合适价位
              //（口径保密：不披露 20L/巡游机制，只讲"稀见到货 + 参考价"）
              if (good.rarity === 'exotic') {
                const exoLine = askLineOf(state, engine.ctx, good.key)
                if (p >= exoLine) {
                  return (
                    <>
                      {tr("ui.MarketPage.065")} {isk(exoLine)} {tr("ui.MarketPage.066")}
                    </>
                  )
                }
                return (
                  <>
                    {tr("ui.MarketPage.067")} {isk(p)} {tr("ui.MarketPage.068")} {isk(exoLine)} {tr("ui.MarketPage.069")}{isk(exoLine)} {tr("ui.MarketPage.119")}
                  </>
                )
              }
              const ask = quote.sell ?? askLineOf(state, engine.ctx, good.key)
              if (p >= ask) return <>{tr("ui.MarketPage.070")} {isk(ask)}{tr('ui.MarketPage.131')}</>
              return (
                <>
                  {tr("ui.MarketPage.071")} {isk(ask)}{tr('ui.MarketPage.132')}
                </>
              )
            })()}
          </div>
        </div>
      </div>
    </Panel>
      {confirmSell ? (
        <div className="app-mkt-confirm-mask" onClick={() => setConfirmSell(null)}>
          <div className="app-mkt-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="app-mkt-confirm-title">{tr("ui.MarketPage.072")} {name}</div>
            <div className="app-mkt-confirm-row">
              <span>{tr("ui.MarketPage.073")}</span>
              <b>{confirmSell.want.toLocaleString('zh-CN')} {unit}{tr("ui.MarketPage.120")} {confirmSell.avail.toLocaleString('zh-CN')}）</b>
            </div>
            <div className="app-mkt-confirm-row">
              <span>{tr("ui.MarketPage.074")}</span>
              <b className={confirmSell.fillable > 0 ? 'app-trend-up' : ''}>
                {confirmSell.fillable.toLocaleString('zh-CN')} {unit} · {confirmSell.orders} {tr("ui.MarketPage.121")}
              </b>
            </div>
            {confirmSell.fillable > 0 ? (
              <>
                <div className="app-mkt-confirm-row">
                  <span>{tr("ui.MarketPage.075")}</span>
                  <b className="app-gold">{isk(confirmSell.gross)} {tr("ui.FirstTasks.003")}</b>
                </div>
                <div className="app-mkt-confirm-row">
                  <span>{tr("ui.MarketPage.076")}</span>
                  <b>−{isk(confirmSell.tax)} {tr("ui.FirstTasks.003")}</b>
                </div>
                <div className="app-mkt-confirm-row is-net">
                  <span>{tr("ui.MarketPage.077")}</span>
                  <b className="app-gold">{isk(confirmSell.net)} {tr("ui.FirstTasks.003")}</b>
                </div>
              </>
            ) : null}
            {confirmSell.leftover > 0 ? (
              <div className="app-mkt-confirm-note">
                {tr("ui.MarketPage.078")} {fmtInt(confirmSell.fillable)} {unit}{tr('ui.MarketPage.133', { n: `${fmtInt(confirmSell.leftover)} ${unit}` })}{tr("ui.MarketPage.079")}
                {good.kind === 'ship' ? tr("ui.MarketPage.080") : tr("ui.MarketPage.081")}
              </div>
            ) : null}
            {confirmSell.fillable <= 0 ? (
              <div className="app-mkt-confirm-note">
                {tr("ui.MarketPage.082")}
                {good.kind === 'ship' ? tr("ui.MarketPage.083") : tr("ui.MarketPage.084")}
              </div>
            ) : null}
            <div className="app-mkt-confirm-btns">
              <button className="app-btn is-small" onClick={() => setConfirmSell(null)}>
                {tr("ui.ActivityBar.004")}
              </button>
              <button className="app-btn is-small is-sellall" onClick={doSellAll}>
                {tr("ui.MarketPage.085")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

/* ═══════════════ 我的挂单列表 ═══════════════ */

function MyOrders({ engine, onToast, onJump }: PageProps & { onJump: (goodKey: string) => void }) {
  const state = engine.state
  const wrapRef = useRef<HTMLDivElement | null>(null)
  /**
   * 「我的挂单」的可见高度**对齐到整行**（船长 2026-09-14：「当我全屏时，订单的第七条会被遮住一半」）。
   * 面板高度来自 CSS（所在栏的 `flex: 1 1 auto` 吃满剩余高度），超出的挂单在面板体内滚动 ——
   * 但容器底边原先落在行的中间，于是最下面那行永远只露一半。这里量出"再放一行就超出"的位置，
   * 把面板体收到**整行**高度：底部不再出现半行（要更多就滚动，滚动条照旧）。
   * 滚动条在滚动途中经过的行仍可能是半行，那是滚动本身的常态。
   * 逐行累加（不假定每行等高 —— 商品名/说明折行会让某行更高）。
   *
   * ⚠ **2026-09-22**：这一页从右栏搬进了左栏标签页（船长令），故订阅的容器跟着从 `.app-mkt-right`
   * 改成 `.app-mkt-left` —— 不改的话栏宽/栏高变化时量不出来（两边尺寸本来就不一样）。
   */
  useLayoutEffect(() => {
    const wrap = wrapRef.current
    const body = wrap?.closest('.wui-panel-body') as HTMLElement | null
    if (!wrap || !body) return
    const measure = (): void => {
      const ul = wrap.querySelector('.app-inv-list')
      const rows = ul ? Array.from(ul.querySelectorAll('.app-inv-row')) : []
      body.style.maxHeight = '' // 先断开上一轮的上限，否则越量越小
      body.style.paddingBottom = ''
      const cs = getComputedStyle(body)
      const padT = parseFloat(cs.paddingTop) || 0
      const padB = parseFloat(cs.paddingBottom) || 0
      if (rows.length === 0) return
      const avail = body.clientHeight - padT - padB
      let acc = 0
      let total = 0
      for (const r of rows) {
        const h = r.getBoundingClientRect().height
        total += h
        if (acc + h <= avail) acc += h
      }
      // 全部放得下 ⇒ 不封顶、也不动下内边距（窄窗整页滚动那档就是这种：面板回到内容高度）
      if (total <= avail + 0.5) return
      if (acc <= 0) acc = rows[0]!.getBoundingClientRect().height // 一行都放不下时至少留一行
      // ⚠ `.wui-panel-body` 是 **content-box** ⇒ `max-height` 只限内容，内边距另算；
      // 且**下内边距必须归零** —— 否则下一行会从这 8px 里露出一条边（也算"半行"，实测踩过）
      body.style.paddingBottom = '0px'
      body.style.maxHeight = `${Math.round(acc)}px`
    }
    measure()
    const column = wrap.closest('.app-mkt-left')
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    if (column) ro?.observe(column)
    window.addEventListener('resize', measure)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [state.orders.length])
  if (state.orders.length === 0) {
    return (
      <div className="app-dim app-inv-empty" ref={wrapRef}>
        {tr("ui.MarketPage.086")}
      </div>
    )
  }
  return (
    <div ref={wrapRef}>
      <ul className="app-inv-list">
        {state.orders.map((order) => (
          <li key={order.id} className="app-inv-row">
            <div className="app-inv-main">
              <span className="app-inv-name">
                {order.side === 'sell' ? tr("ui.MarketPage.087") : tr("ui.MarketPage.088")}：{goodName(engine.ctx, order.good)}
              </span>
              <span className="app-inv-count">
                {order.side === 'sell' ? tr("ui.MarketPage.089") : tr("ui.MarketPage.090")} {order.price.toLocaleString('zh-CN')} {tr("ui.MarketPage.091")} {order.qty.toLocaleString('zh-CN')}
                {order.filled > 0 ? tr("ui.MarketPage.166", { p1: order.filled.toLocaleString('zh-CN') }) : ''}
                {/* 2026-09-11（船长裁决「甲」预扣冻结）：买单显示"已预扣多少"，让玩家看得见这笔钱在哪 */}
                {order.side === 'buy' && (order.escrowIsk ?? 0) > 0
                  ? tr("ui.MarketPage.167", { p1: (order.escrowIsk ?? 0).toLocaleString('zh-CN') })
                  : ''}
              </span>
            </div>
            <div className="app-inv-btns">
              <button
                className="app-btn is-small"
                onClick={() => onJump(order.good)}
                title={tr("ui.MarketPage.092")}
              >
                {tr("ui.MarketPage.093")}
              </button>
              <button
                className="app-btn is-small is-warn"
                onClick={() => {
                  // 先取预扣额（撤单会把订单上的 escrowIsk 清零）
                  const back = order.side === 'buy' ? (order.escrowIsk ?? 0) : 0
                  engine.cancelOrderAt(order.id)
                  onToast(
                    order.side === 'sell'
                      ? engine.ctx.marketGoods.get(order.good)?.kind === 'ship'
                        ? tr("ui.MarketPage.094")
                        : tr("ui.MarketPage.095")
                      : back > 0
                        ? tr("ui.MarketPage.168", { p1: isk(back) })
                        : tr("ui.MarketPage.096"),
                  )
                }}
              >
                {tr("ui.MarketPage.097")}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function MarketPage({
  engine,
  onToast,
  focusKey,
  focusSeq,
  onFocusUsed,
}: PageProps & { focusKey?: string | null; focusSeq?: number; onFocusUsed?: () => void }) {
  const state = engine.state
  const goods = useMemo(() => [...engine.ctx.marketGoods.values()], [engine])
  const common = goods.filter((g) => g.rarity === 'common')
  // 2026-09-14 船长：奇货从稀有订单里独立成第三个标签（「限定奇货」· 图标 ◈ · 常态显示）
  const rareCol = goods.filter((g) => g.rarity === 'rare')
  const exoticCol = goods.filter((g) => g.rarity === 'exotic')
  /**
   * **子标签**（船长 2026-09-22：「**市场内，将我的挂单放入和常驻订单同级的子页面内，位置排在第一位，
   * 但是玩家进入市场时，默认还是打开常驻订单。**」）：
   * ⇒ 「我的挂单」成了同级子页面、排第一位；**初值仍是 `'common'`**（位置变了、默认没变）。
   * 它原先挂在右栏详情卡下方（2026-09-08 那次改判），本轮搬进左栏标签页（挂单列表因此独占一页）。
   */
  const [mktTab, setMktTab] = useState<'mine' | 'common' | 'rare' | 'exotic'>('common')
  // 外部聚焦（如舰船页"去市场"）：focusSeq 递增时把搜索词设为指定商品 key（像玩家自己搜的一样）
  const [kw, setKw] = useState('')
  // 行情详情选中商品（船长 2026-09-05：行内「 详情」/外部聚焦展开）
  const [selKey, setSelKey] = useState<string | null>(null)
  /**
   * **窄屏（视口 ≤1180px）＝ 单栏**：此时"市场详情"改**悬浮窗**（船长 2026-09-21）——
   * 原话：「**在手机或者窄屏的情况下，很难翻到市场详细，建议，当出现将市场详细压缩到订单列表下方时，
   * 隐藏市场详细。玩家点击某个订单时，以悬浮窗的形式弹出。（仅限手机或者窄屏）**」
   *
   * ⚠ **断点必须与 CSS 同源**：单栏由 `styles.css` 的 `@media (max-width: 1180px) { .app-mkt-split
   * { grid-template-columns: 1fr } }` 决定 ⇒ 这里用**同一个 1180**（改一处必改另一处，`ui:rot-check`
   * 的窄窗白名单与这条断点同尺）。用 `max-width` 而非测量容器：CSS 用的是视口查询，量容器会在
   * "窗口恰好 1180"这类边界上与 CSS 判得不一样。
   */
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 1180px)').matches,
  )
  /** 窄屏下的详情浮窗（只有点了订单才开；宽屏恒为 false、整条路径不参与） */
  const [detailOpen, setDetailOpen] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1180px)')
    const sync = (): void => setNarrow(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  /**
   * 窄屏 ⇒ **不默认选中**（否则"隐藏了详情却还高亮第一行"看着莫名其妙）；
   * `focusSeq`（外部聚焦，如舰船页「去市场」）仍会把 `selKey` 写上 ⇒ 窄屏那条路径直接开浮窗。
   */
  const defaultSelKey = narrow ? null : stockedFirst(engine, common)[0]?.key ?? null
  const activeSelKey = selKey ?? defaultSelKey
  /**
   * **列表高亮用的选中键**：窄屏恒为 `null`（详情在浮窗里，列表上再留一行高亮反而误导——船长 2026-09-21 口径），
   * 而浮窗仍读 `activeGood`（由 `selKey` 推出）⇒ 两者共用同一个 `selKey`，只在**传给列表**这一路掐掉。
   */
  const listSelKey = narrow ? null : activeSelKey
  const activeGood = activeSelKey ? goods.find((g) => g.key === activeSelKey) ?? null : null
  useEffect(() => {
    if (narrow && selKey !== null) setDetailOpen(true)
  }, [narrow, selKey])
  /** 详情浮窗的开关（关闭 = 连选中一起清掉，行高亮不留在屏幕上） */
  const closeDetail = (): void => {
    setDetailOpen(false)
    setSelKey(null)
  }
  const lastFocusSeq = useRef(0)
  useEffect(() => {
    if (focusKey && focusSeq !== undefined && focusSeq !== lastFocusSeq.current) {
      lastFocusSeq.current = focusSeq
      setKw(focusKey)
      setSelKey(focusKey)
      // 一次性聚焦（2026-09-08 修复）：应用后通知 App 清空，避免每次进市场都默认带出上次查看的物品
      onFocusUsed?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSeq])

  // 页面级全局搜索（船长 2026-09-05）：搜索栏从各栏内取出；输入/类型过滤时同时检索常驻 / 稀有 / 限定奇货
  // （三档商品集互不重叠——rarity 单值归属，跨档合并不会重复条目）。
  const [kind, setKind] = useState<KindFilter>('all')
  const [sub, setSub] = useState<string>(SUB_ALL)
  const query = kw.trim().toLowerCase()
  const filterActive = query.length > 0 || kind !== 'all'
  /**
   * **二级子分类：只列该类型下真有商品的档**（2026-09-20 船长「明显不存在的子类筛选隐藏」）——
   * 船长点名的例子：「市场-高槽装备-护盾」（护盾是中槽件，高槽下恒空）⇒ 该档不再出现；
   * 判据复用市场自己的两把尺（kindPasses + subPasses），「全部」档常显（基线②）。
   */
  const kindSubs: SubOption[] | undefined =
    kind !== 'all'
      ? presentSubs(SUBS_OF_KIND[kind] ?? [], (key) =>
          goods.some((g) => kindPasses(engine.ctx, g, kind) && subPasses(engine.ctx, g, kind, key)),
        )
      : undefined
  /** 切换主类型时子分类回到"全部子类" */
  const changeKind = (v: KindFilter): void => {
    setKind(v)
    setSub(SUB_ALL)
  }
  /** 「我的挂单」行内跳转：按该商品搜索（跨栏合并显示）并打开行情详情（2026-09-08 船长定） */
  const jumpToOrder = (goodKey: string): void => {
    setKw(goodKey)
    changeKind('all')
    setSelKey(goodKey)
    if (narrow) setDetailOpen(true)
  }
  /**
   * **点一行订单**（船长 2026-09-21）：宽屏 = 照旧把它送进右栏常驻详情；**窄屏 = 弹详情浮窗**。
   *
   * ⚠ **2026-09-21 修复（船长报障「手机模式下，市场页面，点击订单不会弹出订单详细」）**：
   * 初版窄屏这条路**只开窗、不写 `selKey`**，而浮窗的渲染条件是 `narrow && detailOpen && activeGood`，
   * 其中 `activeGood` 由 `selKey ?? defaultSelKey` 推出——**窄屏的 `defaultSelKey` 恒为 null**
   * （窄屏不默认选中）⇒ `activeGood` 永远是 null ⇒ **浮窗一个都不渲染**（点了没反应）。
   * 现在两条路都写 `selKey`（浮窗靠它取商品）；「窄屏列表不留行高亮」那一半改由
   * `listSelKey`（窄屏恒 null）在**传参**那侧掐掉，语义各归各位。
   */
  const onPickGood = (goodKey: string): void => {
    setSelKey(goodKey)
    if (narrow) setDetailOpen(true)
  }
  const filteredAll = useMemo(    () =>
      stockedFirst(
        engine,
        goods.filter((good) => {
          if (kind !== 'all' && !kindPasses(engine.ctx, good, kind)) return false
          if (sub !== SUB_ALL && !subPasses(engine.ctx, good, kind, sub)) return false
          if (query.length > 0) {
            const name = goodName(engine.ctx, good.key).toLowerCase()
            if (!name.includes(query) && !good.key.toLowerCase().includes(query)) return false
          }
          return true
        }),
      ),
    [goods, engine, kind, sub, query, engine.state.gameMs],
  )

  return (
    // `app-mkt-page`：窄窗（≤1180px，单栏）时本页**放开「一级页不滚」**——船长 2026-09-14：
    // 「放宽闸门，允许市场页面在这种情况下出现滚动条。让所有子窗口完整显示」（见 styles.css 同名断点块）
    <div className="page-stack page-fill app-mkt-page">
      {/* 常驻双栏：左 = 搜索 + 标签 + 商品列表；右 = 市场详情大盘（常驻，无选中时显示引导） */}
      <div className="app-mkt-split">
        <div className="app-mkt-left">
          {/* 页面级全局搜索栏：同时检索常驻 + 稀有 + 限定奇货（三档商品不重叠） */}
          <div className="app-mkt-search">
            <input
              className="app-mkt-search-input"
              type="search"
              placeholder={tr("ui.MarketPage.098")}
              value={kw}
              onChange={(e) => setKw(e.target.value)}
            />
            <select className="app-mkt-kind" value={kind} onChange={(e) => changeKind(e.target.value as KindFilter)}>
              <option value="all">{tr("ui.MarketPage.099")}</option>
              {KIND_OPTIONS.filter((k) => k !== 'all').map((k) => (
                <option key={k} value={k}>
                  {KIND_TEXT[k]}
                </option>
              ))}
            </select>
            {kindSubs ? (
              <select
                className="app-mkt-kind"
                value={sub}
                onChange={(e) => setSub(e.target.value)}
                title={tr("ui.MarketPage.169", { p1: KIND_TEXT[kind] })}
              >
                <option value={SUB_ALL}>{tr("ui.IndustryPage.001")}{KIND_TEXT[kind]}</option>
                {kindSubs.map((s) => (
                  <option key={s.key} value={s.key}>
                    {subText(s)}
                  </option>
                ))}
              </select>
            ) : null}
          </div>

          {filterActive ? (
            /* ── 搜索/过滤激活：跨档合并结果（常驻 + 稀有 + 限定奇货一次搜全；GoodRow 自带稀有度徽标区分） ── */
            <MarketColumn
              engine={engine}
              title={
                query.length > 0
                  ? tr("ui.MarketPage.170", { p1: kw.trim() })
                  : `全部 ${KIND_TEXT[kind] ?? kind}${
                      sub !== SUB_ALL && kindSubs ? ` · ${kindSubs.find((s) => s.key === sub)?.label ?? ''}` : ''
                    }`
              }
              hint={<HintIcon tip={MKT_MECH_TIP} />}
              right={<span className="app-dim">{tr("ui.MarketPage.100")}</span>}
              rows={filteredAll}
              selKey={listSelKey}
              onSelect={onPickGood}
            />
          ) : (
            <>
              {/* 我的挂单 / 常驻订单 / 稀有订单 / 限定奇货（与星图页同款 app-subtabs 标签规范；后两者时效短，
                  切回本页记得看一眼）—— 2026-09-14 船长：「将市场页面的奇货从稀有订单里独立出现…
                  可以新增一个标签页切换」＋三答：标签名取「限定奇货」· 图标取 `◈` · **常态显示**；
                  「我的挂单」为 2026-09-22 船长令新增，**排第一位**（进页面默认仍是常驻订单） */}
              <div className="app-subtabs" role="tablist">
                <button
                  role="tab"
                  aria-selected={mktTab === 'mine'}
                  className={`app-subtab${mktTab === 'mine' ? ' is-active' : ''}`}
                  onClick={() => setMktTab('mine')}
                >
                  <span>▤</span>
                  <span>{tr("ui.MarketPage.113")}</span>
                </button>
                <button
                  role="tab"
                  aria-selected={mktTab === 'common'}
                  className={`app-subtab${mktTab === 'common' ? ' is-active' : ''}`}
                  onClick={() => setMktTab('common')}
                >
                  <span>≡</span>
                  <span>{tr("ui.MarketPage.101")}</span>
                </button>
                <button
                  role="tab"
                  aria-selected={mktTab === 'rare'}
                  className={`app-subtab${mktTab === 'rare' ? ' is-active' : ''}`}
                  onClick={() => setMktTab('rare')}
                  title={tr("ui.MarketPage.102")}
                >
                  <span>✦</span>
                  <span>{tr("ui.MarketPage.103")}</span>
                </button>
                <button
                  role="tab"
                  aria-selected={mktTab === 'exotic'}
                  className={`app-subtab${mktTab === 'exotic' ? ' is-active' : ''}`}
                  onClick={() => setMktTab('exotic')}
                  title={tr("ui.MarketPage.104")}
                >
                  <span>◈</span>
                  <span>{tr("ui.MarketPage.028")}</span>
                </button>
              </div>

              {mktTab === 'mine' ? (
                /**
                 * **「我的挂单」子页面**（船长 2026-09-22：与常驻订单同级、排第一位）。
                 * 面板头右侧放**托管**读数——船长同日原话：「**钱包删除，托管挪到子标签页内的标题里**」
                 * （钱包额顶栏本来就常显，页内不再重复一份；托管数原先只在右栏那行里，宽窄屏都看不见了
                 * ⇒ 现在跟着这一页走）。
                 * ⚠ 面板体高度由 CSS 的 `flex: 1 1 auto` 吃满左栏，超出部分在面板体内滚动；
                 * 可见行数由 `MyOrders` 量成「整行」（船长 2026-09-14 报障「第七条被遮住一半」）。
                 */
                <Panel
                  className="is-fill"
                  title={tr("ui.MarketPage.113")}
                  right={
                    <span className="app-dim">
                      {tr("ui.MarketPage.179")} {isk(Object.values(state.escrowItems).reduce((a, b) => a + b, 0))}
                      {tr('ui.MarketPage.135')}
                    </span>
                  }
                >
                  <MyOrders engine={engine} onToast={onToast} onJump={jumpToOrder} />
                </Panel>
              ) : mktTab === 'common' ? (
                <MarketColumn
                  engine={engine}
                  title={tr("ui.MarketPage.105")}
                  hint={<HintIcon tip={MKT_MECH_TIP} />}
                  right={
                    <span className="app-dim" title={tr("ui.MarketPage.106")}>
                      {tr("ui.MarketPage.107")} {fmtClock(nextSupplyIn(engine))}{tr('ui.MarketPage.134')}
                    </span>
                  }
                  rows={stockedFirst(engine, common)}
                  selKey={listSelKey}
                  onSelect={onPickGood}
                />
              ) : mktTab === 'rare' ? (
                <MarketColumn
                  engine={engine}
                  title={tr("ui.MarketPage.103")}
                  hint={<HintIcon tip={MKT_MECH_TIP} />}
                  right={<span className="app-dim">{tr("ui.MarketPage.108")}</span>}
                  rows={rareOrderRows(engine, rareCol)}
                  selKey={listSelKey}
                  onSelect={onPickGood}
                />
              ) : (
                <MarketColumn
                  engine={engine}
                  title={tr("ui.MarketPage.028")}
                  hint={<HintIcon tip={MKT_MECH_TIP} />}
                  right={<span className="app-dim">{tr("ui.MarketPage.109")}</span>}
                  rows={rareOrderRows(engine, exoticCol)}
                  empty={tr('ui.MarketPage.177')}
                  selKey={listSelKey}
                  onSelect={onPickGood}
                />
              )}
            </>
          )}
        </div>

        <div className="app-mkt-right">
          {/**
           * **窄屏（单栏）⇒ 不渲染"市场详情"**（船长 2026-09-21）：单栏时它会被压到订单列表**下方**，
           * 玩家要翻很久才够得着 ⇒ 改为点订单**弹浮窗**（见本文件末尾那一段）。
           * ⚠ **2026-09-22 起右栏只有这一块**：船长令「我的挂单」搬进左栏子标签页 ⇒ 详情卡**吃满右栏**
           * （CSS `.app-mkt-right > .wui-panel:only-child`）；原先"详情卡 + 我的挂单"的纵向堆叠不复存在。
           * 09-21 那条「我的挂单留在栏内、宽窄都要一眼看到钱包与托管额」的做法被同日的新令取代
           * （钱包不再在页内重复、托管跟着「我的挂单」页走）。
           */}
          {!narrow ? (
            activeGood ? (
              <MarketDetail engine={engine} onToast={onToast} good={activeGood} />
            ) : (
              <Panel
                title={tr("ui.MarketPage.110")}
                hint={<HintIcon tip={taxTipText(state, engine.ctx)} />}
                right={<span className="app-dim">{tr("ui.MarketPage.111")}</span>}
              >
                <div className="app-dim app-inv-empty">
                  {tr("ui.MarketPage.112")}
                </div>
              </Panel>
            )
          ) : null}
        </div>
      </div>
      {/**
       * **窄屏的「市场详情」浮窗**（船长 2026-09-21：手机/窄屏下点订单 ⇒ 悬浮窗弹出）。
       *
       * 复刻全仓既有的弹层结构（`.app-modal-mask` / `.app-modal` / `.app-modal-head` / `.app-modal-body`，
       * 与「存档管理」「放弃虫洞」同一套）：点遮罩或「✕ 关闭」都只关窗、**不动任何账**
       * （关窗顺带清掉选中 ⇒ 列表上不留一行莫名其妙的高亮）。
       * 内容与宽屏右栏**逐字同源**（同一个 `<MarketDetail>` 组件）——不另做一套窄屏版，
       * 免得"两个地方各改一半"（挂单/买入按钮的可用态都在那个组件里）。
       * 只在 `narrow && detailOpen && activeGood` 时渲染 ⇒ 宽屏整条路径不存在。
       */}
      {narrow && detailOpen && activeGood ? (
        <div className="app-modal-mask" onClick={closeDetail}>
          <div className="app-modal app-modal-wide app-mkt-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="app-modal-head">
              <span className="app-report-title">{goodName(engine.ctx, activeGood.key)}</span>
              <button className="app-btn is-small" onClick={closeDetail}>
                {tr('ui.App.086')}
              </button>
            </div>
            <div className="app-modal-body">
              <MarketDetail engine={engine} onToast={onToast} good={activeGood} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
