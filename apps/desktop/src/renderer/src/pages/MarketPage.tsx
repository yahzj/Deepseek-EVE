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
import { Glyph, ICO_TONES } from '../ui/Glyphs'
import { HintIcon } from '../ui/Hint'
import { MarkStar, pinMarked } from '../ui/marks'
import { SUB_ALL, subPasses, SUBS_OF_KIND, CONSUME_KIND_KEYS, RACK_LABELS } from '../ui/itemSubs'
import type { SubOption } from '../ui/itemSubs'

const KIND_TEXT: Record<string, string> = {
  /**
   * **2026-09-16 船长**：「给市场的添加奢侈品分类，放入物品下，**物品改名叫货物**」——
   * 一级类型中文名由「物品」改为「**货物**」（子分类补「奢侈品」，见 `ui/itemSubs.ts` 的 `ITEM_SUBS`）。
   * ⚠ 这**只是市场类型下拉的显示名**：导航页「物品」与手册「物品图鉴」走各自的单点，未随本改（等船长点名）。
   */
  item: '货物',
  // 2026-09-11 船长：「应该将消耗品独立出来」——消耗品（弹药/修理组件/无人机）独立成一级类型，
  // 并从「物品」里剔除（与当年「残骸」独立成类的口径一致；子分类见 ui/itemSubs.ts CONSUME_SUBS）
  consume: '消耗品',
  // 2026-09-10 船长：类型筛选移除「装备」，改为高 / 中 / 低槽三个类型（子分类仍是装备的功能分组）
  // ⚠ 中文名走 `ui/itemSubs.ts` 的 `RACK_LABELS` 单点（手册图鉴筛选与仓库筛选读同一份，2026-09-13）
  'module-high': RACK_LABELS.high,
  'module-mid': RACK_LABELS.mid,
  'module-low': RACK_LABELS.low,
  ship: '舰船',
  blueprint: '蓝图',
  aicore: '核心',
  wreck: '残骸',
}
const KIND_OPTIONS = ['all', 'item', 'consume', 'wreck', 'module-high', 'module-mid', 'module-low', 'ship', 'blueprint', 'aicore'] as const
type KindFilter = (typeof KIND_OPTIONS)[number]
const RARITY_TEXT: Record<MarketRarity, string> = { common: '常驻', rare: '稀有', exotic: '限定' }

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
  if (it) return it.kind === 'wreck' ? '残骸' : itemKindText(it)
  if (good.kind === 'module') {
    const mod = ctx.modules.get(good.refId)
    const rack = mod ? rackOf(mod) : undefined
    return rack !== undefined ? (KIND_TEXT[`module-${rack}`] ?? '装备') : '装备'
  }
  return KIND_TEXT[good.kind] ?? good.kind
}

/** 类型过滤判定：「残骸」= item 类里物品大类为残骸者；「物品」不再包含残骸（单独成类）；
 *  装备按槽类三分（高槽/中槽/低槽装备，2026-09-10 船长：移除「装备」类型）——归槽走 core 单点 rackOf。
 *  注意：`kind === 'module'` 已不在类型下拉里，但仍保留判定（子分类判定 `subPasses` 与旧调用方兼容）。 */
function kindPasses(ctx: PageProps['engine']['ctx'], good: MarketGoodDef, kind: KindFilter | 'module'): boolean {
  if (kind === 'all') return true
  if (kind === 'wreck') return itemDefOf(ctx, good)?.kind === 'wreck'
  if (kind === 'module' || kind === 'module-high' || kind === 'module-mid' || kind === 'module-low') {
    if (good.kind !== 'module') return false
    if (kind === 'module') return true
    const mod = ctx.modules.get(good.refId)
    return mod !== undefined && rackOf(mod) === kind.slice('module-'.length)
  }
  if (kind === 'consume') {
    // 消耗品 = 弹药 / 修理组件 / 无人机（2026-09-11 船长：独立成类，且从「物品」剔除）
    const it = itemDefOf(ctx, good)
    return it !== undefined && CONSUME_KIND_KEYS.includes(it.kind)
  }
  if (good.kind !== kind) return false
  const it = itemDefOf(ctx, good)
  if (kind === 'item') {
    // 「物品」= 除残骸与消耗品以外的物品（残骸 2026-09-08 独立、消耗品 2026-09-11 独立）
    if (it?.kind === 'wreck') return false
    if (it !== undefined && CONSUME_KIND_KEYS.includes(it.kind)) return false
  }
  return true
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
      good.refId === 'basic' ? 'AI 副船的标准核心' : good.refId === 'gamma' ? '伽马级核心' : good.refId === 'beta' ? '贝塔级核心' : '阿尔法级核心'
    desc = `${tier}（效率 ${eff}%）：指派 AI 副船任务时使用，任务结束自动归还核心库；更高阶核心通常由高威胁远征缴获或奇货市场流出。`
  }
  return `${head}\n${desc || '（暂无说明）'}`
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
      { k: '产物', v: productName },
      ...prodLines,
      ...(bp.description ? [{ k: '蓝图说明', v: bp.description }] : []),
      { k: '材料需求', v: materials },
      { k: '制造', v: `${formatDurationMs(bp.buildSeconds * 1000)} · 免费` },
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
      good.refId === 'basic' ? '基础核心' : good.refId === 'gamma' ? '伽马级核心' : good.refId === 'beta' ? '贝塔级核心' : '阿尔法级核心'
    return (
      <InfoHover
        as="li"
        title={goodName(ctx, good.key)}
        lines={[
          { k: '等级', v: tier },
          { k: '效率', v: `${eff}%（AI 副船工作速度；不影响奖励）` },
        ]}
        note="指派 AI 副船任务时使用，任务结束自动归还核心库；更高阶核心通常由高威胁远征缴获或奇货市场流出。"
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
  '自己的库存：物品 → 物品仓库、装备 → 装备库、蓝图 → 图书存量、AI 核心 → 核心库、舰船 → 舰船仓库 ＋ 在役舰队同型艘数（挂单托管中的不计）；舰船出售在舰船页「舰船仓库」操作'

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
                <span className="app-chip is-learned" title="已掌握该蓝图：可在工业页无限自制">
                  已学习
                </span>
              ) : null}
              {(state.blueprintStock[good.refId] ?? 0) > 0 ? (
                <span className="app-chip is-stock" title="蓝图书已在物品仓库中（本行用于图纸交易，图书按张使用）">
                  已获得 ×{(state.blueprintStock[good.refId] ?? 0).toLocaleString('zh-CN')}
                </span>
              ) : null}
            </>
          ) : null}
          {good.rarity === 'rare' ? <span className="app-chip is-rare">稀有</span> : null}
          {good.rarity === 'exotic' ? <span className="app-chip is-exotic">限定奇货</span> : null}
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
            收购 <b className="app-gold">{quote.buy !== undefined ? isk(quote.buy) : '—'}</b>
            <span className={trend > 0 ? 'app-trend-up' : trend < 0 ? 'app-trend-down' : 'app-trend-flat'}>
              {trend > 0 ? ' ▲' : trend < 0 ? ' ▼' : ' ·'}
            </span>
          </span>
          <span className="app-mkt-quote">
            供应 <b className={quote.sell !== undefined ? 'app-price-sell' : ''}>{quote.sell !== undefined ? isk(quote.sell) : good.playerBuyable === false ? '只收不卖' : '暂无现货'}</b>
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
            · 持有 {holdings.toLocaleString('zh-CN')}
          </span>
          {quote.sell === undefined && good.rarity !== 'common' ? (
            <span className="app-dim"> · 常来看看（每 10 分钟刷新一轮到货）</span>
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
  side: '买' | '卖',
  name: string,
  want: number,
  price: number,
  filled: number,
  resting: number,
  unit = '件',
): string {
  const n = (v: number): string => v.toLocaleString('zh-CN')
  if (filled <= 0) return `已挂${side}单：${name}×${n(want)} @ ${isk(price)} 信用点（挂在簿上，等对手单成交）`
  if (resting <= 0) return `${side}单已即时成交：${name}×${n(filled)} @ ${isk(price)} 信用点`
  return `${side}单已即时成交 ${n(filled)} ${unit}，余 ${n(resting)} ${unit}挂单 @ ${isk(price)} 信用点`
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
      ? `（会计学 Lv${lvA} −${lvA * 8}% · 贸易谈判学 Lv${lvB} −${lvB * 8}%）`
      : '（基础 5%；练「会计学 / 贸易谈判学」各 −8%/级，双满仅剩 1%）'
  return `贸易税：卖出成交按成交额收税——当前税率 ${Math.round(rate * 1000) / 10}%${skillNote}。挂单、自动转挂单与买入一律免费。`
}

/** 协会市场的撮合与星标说明（挂单簿语义、冲击动量、行首星标；2026-09-13 收进列表标题后的圆形感叹号） */
const MKT_MECH_TIP =
  '协会市场全程走挂单簿撮合：收购价低于供应价；集中买卖会带来价格短时偏离（冲击动量），原矿/原材料另受库存池调节。每行可「挂单买 / 挂单卖」自定价等待成交。行首星标＝标记收藏（被标记的商品在默认排序下置顶，随时再点一下取消）。'

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
        <div className="app-dim app-inv-empty">{empty ?? '没有匹配的订单（试试清空搜索、切换类型或子分类）。'}</div>
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
  if (mins <= 0) return '现在'
  if (mins < 60) return `约 ${mins} 分钟前`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `约 ${h} 小时前` : `约 ${h} 小时 ${m} 分前`
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
        <span className="app-dim">暂无历史样本——市场运行一段时间后自动采样（每 30 分钟一次，保留 48 窗 / 约 24 小时）</span>
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
          aria-label="价格趋势"
          onMouseLeave={() => setHover(null)}
        >
          <polyline points={pts} fill="none" stroke="var(--wui-gold)" strokeWidth="2" opacity="0.9" />
          {slice.map((v, i) => {
            const x = xAt(i)
            const y = mapY(v)
            const isLast = offset + i === fullLen - 1
            const isHover = hover === i
            return (
              <g key={offset + i}>
                {!isLast && !isHover ? <circle cx={x} cy={y} r={1.6} fill="rgba(255,224,138,0.55)" /> : null}
                {isLast ? <circle cx={x} cy={y} r={3.5} fill="#ffe08a" /> : null}
                {isHover ? <circle cx={x} cy={y} r={4.5} fill="none" stroke="#ffe08a" strokeWidth={1.2} /> : null}
                <circle cx={x} cy={y} r={7} fill="transparent" style={{ cursor: 'crosshair' }} onMouseEnter={() => setHover(i)} />
              </g>
            )
          })}
          <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="rgba(255,255,255,0.18)" strokeWidth="1" />
        </svg>
        {/* 高低价标注用 HTML 覆盖层（非 SVG 文本），避免 preserveAspectRatio=none 拉伸字形 */}
        <span className="app-mkt-chart-hi">高价 {isk(dataMx)}</span>
        <span className="app-mkt-chart-lo">低价 {isk(dataMn)}</span>
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
            ≈{isk(slice[hover]!)} 信用点 · {sampleAgoLabel(fullLen, offset + hover)}
          </div>
        ) : null}
    </div>
  )
}

/** 买卖盘显示档数：上限 8（原口径）、下限 5（船长 2026-09-14：「窗口高度不足时可以隐藏部分订单，最少显示 5 个」） */
const BOOK_ROWS_MAX = 8
const BOOK_ROWS_MIN = 5

/** 市场详情卡：价格曲线 + 买卖盘深度 + 持有量 + 交易面板（买/卖 tab：市价或挂单） */
function MarketDetail({ engine, onToast, good }: { engine: PageProps['engine']; onToast: PageProps['onToast']; good: MarketGoodDef }) {
  const state = engine.state
  const quote = marketQuote(state, engine.ctx, good.key)
  const hist = marketHistory(state, good.key)
  const trend = marketTrend(state, good.key)
  const holdings = good.kind === 'ship' ? shipStoredCount(state, good.refId) : naturalHoldings(state, good)
  /** 舰船的量词是「艘」（其余商品是「件」）；舰队同型艘数用于"可卖量从哪来"的提示 */
  const unit = good.kind === 'ship' ? '艘' : '件'
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
      onToast(`暂不能买入：${lock}。`, true)
      return
    }
    const n = Math.max(1, Math.floor(qty || 1))
    const r = engine.buyGoodAt(good.key, n)
    if (!r.ok) onToast(r.error ?? '买入失败', true)
    else onToast(`已买入 ${name}×${n.toLocaleString('zh-CN')}（详见日志）。`)
  }
  function doSell(q?: number): void {
    const n = Math.max(1, Math.min(holdings, Math.floor(q ?? (qty || 1))))
    if (n <= 0 || holdings <= 0) {
      onToast(good.kind === 'ship' ? '舰船仓库里没有可卖的舰船：先在舰船页把船移入舰船仓库。' : '没有可卖的库存。', true)
      return
    }
    const r = engine.sellHoldingAt(good.key, n)
    if (!r.ok) onToast(r.error ?? '出售失败', true)
    else if (good.kind === 'ship') {
      // 舰船：即时成交的部分吃收购簿，其余**留簿挂着**（可撤销退回舰船仓库）——回执把两段都说清
      const filled = r.sold ?? 0
      const rest = r.remaining ?? 0
      onToast(
        rest > 0
          ? `已提交出售 ${name}×${n} 艘：即时成交 ${filled} 艘${filled > 0 ? `（税后 ${isk(r.total ?? 0)} 信用点）` : ''}，余 ${rest} 艘已留簿挂单（可随时撤销退回舰船仓库）。`
          : `已按市价卖出 ${name}×${filled} 艘（税后入账 ${isk(r.total ?? 0)} 信用点）。`,
      )
    } else onToast(`已按市价卖出 ${name}×${n.toLocaleString('zh-CN')}（吃穿簿余量自动挂单）。`)
  }
  /** 全部卖出：先预览（可成交件数/毛额/税/净到账）再弹确认——不直接执行（船长 2026-09-05） */
  function askSellAll(): void {
    if (holdings <= 0) {
      onToast(good.kind === 'ship' ? '舰船仓库里没有可卖的舰船：先在舰船页把船移入舰船仓库。' : '没有可卖的库存。', true)
      return
    }
    const pv = engine.sellPreviewAt(good.key, holdings)
    if (!pv.ok) {
      onToast(pv.error ?? '无法卖出', true)
      return
    }
    setConfirmSell(pv)
  }
  function doSellAll(): void {
    setConfirmSell(null)
    const r = engine.sellHoldingAt(good.key, holdings)
    if (!r.ok) onToast(r.error ?? '出售失败', true)
    else if (good.kind === 'ship') {
      const filled = r.sold ?? 0
      const rest = r.remaining ?? 0
      onToast(
        rest > 0
          ? `已提交出售 ${name}×${holdings} 艘：即时成交 ${filled} 艘${filled > 0 ? `（税后 ${isk(r.total ?? 0)} 信用点）` : ''}，余 ${rest} 艘已留簿挂单（可撤销退回舰船仓库）。`
          : `已全部卖出 ${name}×${filled} 艘（税后入账 ${isk(r.total ?? 0)} 信用点）。`,
      )
    } else onToast(`已全部卖出 ${name}×${holdings.toLocaleString('zh-CN')}（吃穿簿余量自动挂单）。`)
  }
  function doPlace(): void {
    const n = Math.max(1, Math.floor(qty || 1))
    const p = Math.max(1, Math.floor(price || 1))
    if (tab === 'buy') {
      // 2026-09-08（船长反馈）：声望不足等门槛原因要明示，不再笼统报"价格或数量无效"。
      // 2026-09-11（预扣冻结）：余额不足同样明示（core 单点口径：挂 1 件需预扣多少、钱包多少）
      const gate = engine.buyOrderBlocked(good.key, p, n)
      if (gate) {
        onToast(`挂买单失败：${gate}`, true)
        return
      }
      const res = engine.placeBuyOrderAt(good.key, p, n)
      if (res === null) onToast('挂买单失败：该商品当前不接受这个价格的挂单（可先试市价买入）。', true)
      else {
        // 2026-09-10：挂单瞬间会先与现有卖单簿面对冲成交 → 回执写明即时成交部分
        const exoNote =
          good.rarity === 'exotic' && p < askLineOf(state, engine.ctx, good.key)
            ? `。注意：挂价低于奇货参考价（约 ${isk(askLineOf(state, engine.ctx, good.key))} 信用点），可能长期无法成交——建议挂到参考价附近`
            : ''
        // 2026-09-11：预扣口径写进回执（实际挂量可能因余额缩量；预扣撤单即退回）
        const shrinkNote = res.placed < n ? `（余额只够 ${n.toLocaleString('zh-CN')} 件中的 ${res.placed.toLocaleString('zh-CN')} 件，已按余额缩量）` : ''
        const escrowNote = res.escrow > 0 ? `（已预扣 ${isk(res.escrow)} 信用点，撤单退回）` : ''
        onToast(`${placeOrderToast('买', name, res.placed, p, res.filled, res.resting)}${shrinkNote}${escrowNote}${exoNote}。`)
      }
    } else {
      const r = engine.placeSellOrderAt(good.key, p, n)
      if (!r.ok) onToast(r.error ?? '挂卖单失败。', true)
      else onToast(`${placeOrderToast('卖', name, n, p, r.filled ?? 0, r.resting ?? n, unit)}。`)
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
      title={`市场详情 · ${name}`}
      hint={<HintIcon tip={taxTipText(state, engine.ctx)} />}
      right={
        <span className="app-dim">
          {/* 2026-09-14：舰船的可卖量 = **舰船仓库**艘数（机库里的船不能直接卖）⇒ 舰船把两处读数分开写 */}
          {good.kind === 'ship'
            ? `可卖 ${holdings.toLocaleString('zh-CN')} 艘（舰船仓库） · 机库 ${shipInFleet.toLocaleString('zh-CN')} 艘`
            : `持有 ${holdings.toLocaleString('zh-CN')} 件`}{' '}
          · 中位价 {median !== undefined ? isk(median) : '—'} 信用点
          <span className={trend > 0 ? 'app-trend-up' : trend < 0 ? 'app-trend-down' : 'app-trend-flat'}>
            {trend > 0 ? ' ▲' : trend < 0 ? ' ▼' : ' · 平'}
          </span>
        </span>
      }
    >
      <div className="app-mkt-detail">
        <div className="app-mkt-detail-left">
          <PriceChart hist={hist} />
          <div className="app-mkt-detail-quotes">
            <div className="app-mkt-quote">
              收购 <b className="app-gold">{quote.buy !== undefined ? isk(quote.buy) : '—'}</b>
            </div>
            <div className="app-mkt-quote">
              供应 <b className={quote.sell !== undefined ? 'app-price-sell' : ''}>{quote.sell !== undefined ? isk(quote.sell) : buyable ? '暂无现货' : '只收不卖'}</b>
            </div>
            <div className="app-mkt-quote">
              库存池 {good.poolTarget && good.poolTarget > 0 ? Math.floor(state.market.pools[good.key]?.q ?? 0).toLocaleString('zh-CN') : '—'}
            </div>
          </div>
        </div>
        <div className="app-mkt-detail-books" ref={booksRef}>
          <div className="app-mkt-book">
            <div className="app-mkt-book-title">买盘（收你的货）</div>
            {buyOrders.map((o, i) => (
              <div
                key={`b${i}`}
                className="app-mkt-depth is-click"
                title="点击 = 切到「卖出」并预填该收购价与数量——可直接挂卖单（或改价/改量）"
                onClick={() => fillFromBook('sell', o.price, o.qty)}
              >
                <span className="app-mkt-depth-price">{isk(o.price)}</span>
                <span className="app-mkt-depth-bar app-mkt-depth-buy">
                  <i style={{ width: `${Math.round((o.qty / maxOrderQty) * 100)}%` }} />
                </span>
                <span className="app-mkt-depth-qty">{o.qty.toLocaleString('zh-CN')}</span>
              </div>
            ))}
            {buyOrders.length === 0 ? <div className="app-dim app-sr-eta">暂无收购单</div> : null}
          </div>
          <div className="app-mkt-book">
            <div className="app-mkt-book-title">卖盘（卖给你的货）</div>
            {sellOrders.map((o, i) => (
              <div
                key={`s${i}`}
                className="app-mkt-depth is-click"
                title="点击 = 切到「买入」并预填该供应价与数量——可直接挂买单（或改价/改量）"
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
              <div className="app-dim app-sr-eta">{buyable ? '暂无供应单' : '空间站回收点：只收购，不出售'}</div>
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
                    title={buyable ? undefined : '该商品空间站只收购，不对外出售'}
                  >
                    买入
                  </button>
                  <button
                    role="tab"
                    aria-selected={tab === 'sell'}
                    className={`app-mkt-side is-sell${tab === 'sell' ? ' is-active' : ''}`}
                    onClick={() => setTab('sell')}
                  >
                    卖出
                  </button>
                </div>
              </div>
              <div className="app-mkt-trade-row">
                <span className="app-dim">数量</span>
                <input className="app-input" type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
                {tab === 'sell' ? (
                  <button className="app-btn is-small" disabled={holdings <= 0} onClick={() => setQty(Math.max(1, holdings))} title={`把数量填为全部可卖（${holdings} ${unit}）`}>
                    全部
                  </button>
                ) : null}
              </div>
              <div className="app-mkt-trade-row">
                <span className="app-dim">单价</span>
                <input className="app-input" type="number" min={1} value={price} onChange={(e) => setPrice(Number(e.target.value))} />
                <span className="app-dim">信用点</span>
              </div>
            </div>
            <div className="app-mkt-actions">
              <button className="app-btn is-small" onClick={doPlace}>
                {tab === 'buy' ? '挂买单' : '挂卖单'}
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
                      ? '供应簿暂无现货：改用「挂买单」等市场补给后自动成交'
                      : state.wallet.isk < quote.sell
                        ? `信用点不足：最低一张 ${isk(quote.sell)} 信用点，钱包 ${isk(Math.floor(state.wallet.isk))} 信用点`
                        : undefined
                }
                onClick={tab === 'buy' ? doBuy : () => doSell()}
              >
                {tab === 'buy' ? '市价买入' : '市价卖出'}
              </button>
              {tab === 'sell' ? (
                <button className="app-btn is-small is-sellall" disabled={holdings <= 0} onClick={askSellAll} title="先预览实际成交与到账，确认后再卖出全部可卖">
                  全部卖出（{holdings} {unit}）
                </button>
              ) : null}
            </div>
          </div>
          {/* 舰船专卖提示（2026-09-14 船长报障「市场依旧无法挂单或者直接出售舰船」）：
              可卖只有**舰船仓库**这一处来源，机库里的船要先入库——仓库空而机库有货时把这一步说明白 */}
          {good.kind === 'ship' ? (
            <div className={`app-dim app-sr-eta${holdings <= 0 && shipInFleet > 0 ? ' is-warn' : ''}`}>
              {holdings > 0
                ? `可卖 ${holdings} 艘来自舰船仓库（仓里的船都是全新船）：挂卖单按你填的单价排队，市价卖出则先吃收购簿、余量自动留簿挂单。`
                : shipInFleet > 0
                  ? `舰船仓库里没有可卖的船——机库还有 ${shipInFleet} 艘：先到舰船页把船「移入舰船仓库」（需满耐久、无装配、未锁定），再回这里出售。`
                  : '还没有舰船可卖：到舰船页「舰船仓库」看看（组装机造好的船会先入仓库）。'}
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
                      挂价高于当前收购价 {isk(bid)}：先按挂单价排队，等待买家出价回补后成交——想更快出手，把挂价降到不高于收购价即可优先成交
                    </>
                  )
                }
                if (p < bid) {
                  return (
                    <>
                      挂价低于收购价 {isk(bid)}：当前挂价有优势，会优先撮合成交，清仓更快
                    </>
                  )
                }
                return <>平价挂卖（= 收购价 {isk(bid)}）：按当前收购通道优先撮合成交</>
              }
              // 奇货专项提示（2026-09-08 船长定）：挂单价低于奇货参考价时提醒并给出合适价位
              //（口径保密：不披露 20L/巡游机制，只讲"稀见到货 + 参考价"）
              if (good.rarity === 'exotic') {
                const exoLine = askLineOf(state, engine.ctx, good.key)
                if (p >= exoLine) {
                  return (
                    <>
                      挂价已达奇货参考价（约 {isk(exoLine)} 信用点）：协会奇货到货（行情价上下浮动）时会直接按单成交
                    </>
                  )
                }
                return (
                  <>
                    挂价 {isk(p)} 信用点 低于奇货参考价（约 {isk(exoLine)} 信用点）：奇货只按稀见到货，挂太低很可能长期无人接单——建议把挂价提到参考价附近（{isk(exoLine)} 信用点 上下），到货即按单成交
                  </>
                )
              }
              const ask = quote.sell ?? askLineOf(state, engine.ctx, good.key)
              if (p >= ask) return <>平价买入（= 供应价 {isk(ask)}）：现买现得</>
              return (
                <>
                  挂价低于供应价 {isk(ask)}：先按挂单价排队，等待卖单回补后成交——想立刻拿到，把挂价提到不低于供应价即可即时买入
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
            <div className="app-mkt-confirm-title">确认全部卖出 · {name}</div>
            <div className="app-mkt-confirm-row">
              <span>卖出数量</span>
              <b>{confirmSell.want.toLocaleString('zh-CN')} {unit}（可卖 {confirmSell.avail.toLocaleString('zh-CN')}）</b>
            </div>
            <div className="app-mkt-confirm-row">
              <span>收购簿可立即成交</span>
              <b className={confirmSell.fillable > 0 ? 'app-trend-up' : ''}>
                {confirmSell.fillable.toLocaleString('zh-CN')} {unit} · {confirmSell.orders} 笔单
              </b>
            </div>
            {confirmSell.fillable > 0 ? (
              <>
                <div className="app-mkt-confirm-row">
                  <span>预计成交额（毛额）</span>
                  <b className="app-gold">{isk(confirmSell.gross)} 信用点</b>
                </div>
                <div className="app-mkt-confirm-row">
                  <span>贸易税</span>
                  <b>−{isk(confirmSell.tax)} 信用点</b>
                </div>
                <div className="app-mkt-confirm-row is-net">
                  <span>预计实际到账（税后）</span>
                  <b className="app-gold">{isk(confirmSell.net)} 信用点</b>
                </div>
              </>
            ) : null}
            {confirmSell.leftover > 0 ? (
              <div className="app-mkt-confirm-note">
                ⚠ 收购簿只能吃下 {confirmSell.fillable.toLocaleString('zh-CN')} {unit}，其余{' '}
                {confirmSell.leftover.toLocaleString('zh-CN')} {unit}将自动按边际价挂限价卖单——
                {good.kind === 'ship' ? '可随时撤销，船退回舰船仓库。' : '挂单成交前不计入本次到账（挂单免费，可随时撤销）。'}
              </div>
            ) : null}
            {confirmSell.fillable <= 0 ? (
              <div className="app-mkt-confirm-note">
                ⚠ 当前收购簿为空：本次不会立即成交，
                {good.kind === 'ship' ? '全部数量将转为限价卖单挂着（撤销即退回舰船仓库）。' : '全部数量将提示改为挂限价卖单。'}
              </div>
            ) : null}
            <div className="app-mkt-confirm-btns">
              <button className="app-btn is-small" onClick={() => setConfirmSell(null)}>
                取消
              </button>
              <button className="app-btn is-small is-sellall" onClick={doSellAll}>
                确认全部卖出
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
   * 面板高度上限来自 CSS（右栏 40%），超出的挂单在面板体内滚动 —— 但容器底边原先落在行的中间，
   * 于是最下面那行永远只露一半。这里量出"再放一行就超出"的位置，把面板体收到**整行**高度：
   * 底部不再出现半行（要更多就滚动，滚动条照旧）。滚动条在滚动途中经过的行仍可能是半行，那是滚动本身的常态。
   * 逐行累加（不假定每行等高 —— 商品名/说明折行会让某行更高）。
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
    const column = wrap.closest('.app-mkt-right')
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
        没有挂单。市价单吃穿簿后的剩余会自动挂单（可在此撤销，货退回库存）。
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
                {order.side === 'sell' ? '▼ 卖单' : '▲ 买单'}：{goodName(engine.ctx, order.good)}
              </span>
              <span className="app-inv-count">
                {order.side === 'sell' ? '挂卖' : '挂买'} {order.price.toLocaleString('zh-CN')} 信用点 · 剩余 {order.qty.toLocaleString('zh-CN')}
                {order.filled > 0 ? `（已成交 ${order.filled.toLocaleString('zh-CN')}）` : ''}
                {/* 2026-09-11（船长裁决「甲」预扣冻结）：买单显示"已预扣多少"，让玩家看得见这笔钱在哪 */}
                {order.side === 'buy' && (order.escrowIsk ?? 0) > 0
                  ? ` · 已预扣 ${(order.escrowIsk ?? 0).toLocaleString('zh-CN')} 信用点`
                  : ''}
              </span>
            </div>
            <div className="app-inv-btns">
              <button
                className="app-btn is-small"
                onClick={() => onJump(order.good)}
                title="跳到市场列表：按该商品搜索并打开行情详情"
              >
                查看行情
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
                        ? '卖单已撤销：舰船已退回舰船仓库。'
                        : '卖单已撤销：货物退回库存。'
                      : back > 0
                        ? `买单已撤销：预扣 ${isk(back)} 信用点 已退回钱包。`
                        : '买单已撤销。',
                  )
                }}
              >
                撤单
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
  const [mktTab, setMktTab] = useState<'common' | 'rare' | 'exotic'>('common')
  // 外部聚焦（如舰船页"去市场"）：focusSeq 递增时把搜索词设为指定商品 key（像玩家自己搜的一样）
  const [kw, setKw] = useState('')
  // 行情详情选中商品（船长 2026-09-05：行内「 详情」/外部聚焦展开）
  const [selKey, setSelKey] = useState<string | null>(null)
  // 右栏大盘默认选中第一个常驻商品；点击其它行或外部聚焦后以 selKey 为准
  const defaultSelKey = stockedFirst(engine, common)[0]?.key ?? null
  const activeSelKey = selKey ?? defaultSelKey
  const activeGood = activeSelKey ? goods.find((g) => g.key === activeSelKey) ?? null : null
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
  const kindSubs: SubOption[] | undefined = kind !== 'all' ? SUBS_OF_KIND[kind] : undefined
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
              placeholder="搜索市场（同时检索常驻 / 稀有 / 限定奇货）：名称 / 商品键"
              value={kw}
              onChange={(e) => setKw(e.target.value)}
            />
            <select className="app-mkt-kind" value={kind} onChange={(e) => changeKind(e.target.value as KindFilter)}>
              <option value="all">全部类型</option>
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
                title={`${KIND_TEXT[kind]}下的子分类`}
              >
                <option value={SUB_ALL}>全部{KIND_TEXT[kind]}</option>
                {kindSubs.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
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
                  ? `搜索结果：${kw.trim()}`
                  : `全部 ${KIND_TEXT[kind] ?? kind}${
                      sub !== SUB_ALL && kindSubs ? ` · ${kindSubs.find((s) => s.key === sub)?.label ?? ''}` : ''
                    }`
              }
              hint={<HintIcon tip={MKT_MECH_TIP} />}
              right={<span className="app-dim">常驻 / 稀有 / 限定奇货一次搜全（商品按稀有度徽标区分）</span>}
              rows={filteredAll}
              selKey={activeSelKey}
              onSelect={setSelKey}
            />
          ) : (
            <>
              {/* 常驻订单 / 稀有订单 / 限定奇货（与星图页同款 app-subtabs 标签规范；后两者时效短，
                  切回本页记得看一眼）—— 2026-09-14 船长：「将市场页面的奇货从稀有订单里独立出现…
                  可以新增一个标签页切换」＋三答：标签名取「限定奇货」· 图标取 `◈` · **常态显示** */}
              <div className="app-subtabs" role="tablist">
                <button
                  role="tab"
                  aria-selected={mktTab === 'common'}
                  className={`app-subtab${mktTab === 'common' ? ' is-active' : ''}`}
                  onClick={() => setMktTab('common')}
                >
                  <span>≡</span>
                  <span>常驻订单</span>
                </button>
                <button
                  role="tab"
                  aria-selected={mktTab === 'rare'}
                  className={`app-subtab${mktTab === 'rare' ? ' is-active' : ''}`}
                  onClick={() => setMktTab('rare')}
                  title="稀有订单寿命 36 分钟、蓝图书 6 小时——每 10 分钟一轮到货，切回本标签才能看到现存单"
                >
                  <span>✦</span>
                  <span>稀有订单</span>
                </button>
                <button
                  role="tab"
                  aria-selected={mktTab === 'exotic'}
                  className={`app-subtab${mktTab === 'exotic' ? ' is-active' : ''}`}
                  onClick={() => setMktTab('exotic')}
                  title="限定奇货 6 小时有效——每 10 分钟一轮到货，切回本标签才能看到现存单"
                >
                  <span>◈</span>
                  <span>限定奇货</span>
                </button>
              </div>

              {mktTab === 'common' ? (
                <MarketColumn
                  engine={engine}
                  title="常驻供应"
                  hint={<HintIcon tip={MKT_MECH_TIP} />}
                  right={
                    <span className="app-dim" title="市场每 60 秒按窗口补给/刷新订单（含离线期间）">
                      下次补给 {fmtClock(nextSupplyIn(engine))} · 订单 20 分钟有效
                    </span>
                  }
                  rows={stockedFirst(engine, common)}
                  selKey={activeSelKey}
                  onSelect={setSelKey}
                />
              ) : mktTab === 'rare' ? (
                <MarketColumn
                  engine={engine}
                  title="稀有订单"
                  hint={<HintIcon tip={MKT_MECH_TIP} />}
                  right={<span className="app-dim">每 10 分钟一轮到货 · 稀有 36 分钟寿命（蓝图书 6 小时）· 时钟=现存单到期</span>}
                  rows={rareOrderRows(engine, rareCol)}
                  selKey={activeSelKey}
                  onSelect={setSelKey}
                />
              ) : (
                <MarketColumn
                  engine={engine}
                  title="限定奇货"
                  hint={<HintIcon tip={MKT_MECH_TIP} />}
                  right={<span className="app-dim">每 10 分钟一轮到货 · 限定奇货 6 小时有效 · 时钟=现存单到期</span>}
                  rows={rareOrderRows(engine, exoticCol)}
                  empty="当前没有限定奇货到货——每 10 分钟一轮，稍后再看。"
                  selKey={activeSelKey}
                  onSelect={setSelKey}
                />
              )}
            </>
          )}
        </div>

        <div className="app-mkt-right">
          {activeGood ? (
            <MarketDetail engine={engine} onToast={onToast} good={activeGood} />
          ) : (
            <Panel
              title="市场详情"
              hint={<HintIcon tip={taxTipText(state, engine.ctx)} />}
              right={<span className="app-dim">点击左侧商品的「 详情」查看行情</span>}
            >
              <div className="app-dim app-inv-empty">
                从左侧列表选择一件商品，即可查看价格曲线、买卖盘深度与交易面板。
              </div>
            </Panel>
          )}
          {/* 2026-09-08 船长：我的挂单并入右栏详情页下方（右栏弹性补齐到与左侧同高） */}
          <Panel
            title="我的挂单"
            right={
              <span className="app-dim">
                余额 {isk(state.wallet.isk)} 信用点 · 托管在售/在途 {isk(Object.values(state.escrowItems).reduce((a, b) => a + b, 0))} 件
              </span>
            }
          >
            <MyOrders engine={engine} onToast={onToast} onJump={jumpToOrder} />
          </Panel>
        </div>
      </div>
    </div>
  )
}
