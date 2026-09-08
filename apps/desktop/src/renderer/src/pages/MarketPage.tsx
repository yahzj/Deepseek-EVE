/**
 * 市场页（V9）：NPC 挂单簿市场，两栏展示 —— 常驻供应 / 稀有订单（含限定奇货）。
 *
 * 玩法规则（中文说明，设计 V4/V5 已确认）：
 * - 收购价 = NPC 收玩家的价；供应价 = NPC 卖玩家的价（两者有价差，防倒卖）；
 * - 池商品（矿石/矿物）：站内库存池（常驻显示），池淤积→收购压价（倾销会砸价），
 *   池枯竭→供应断货涨价；价格还受隐藏的"冲击动量"影响（集中买卖会推/砸价，随时间恢复）；
 * - 单件商品（装备/蓝图/船/核心）：常驻平价随刷随买；稀有订单低频、限定奇货偶发高价；
 * - 市价买入吃穿簿后剩单会自动转成限价挂单；挂单随时可撤销（货退回原库存）。
 *
 * 展示规则（玩家 2026-09 修正要求）：
 * - "有货"的商品行冒泡上浮（有供应现货的排在前，无货沉底，稳定排序）；
 * - 稀有订单行标注现存供应单的剩余寿命（最早到期的那笔，mm:ss）；
 * - 常驻供应标题后显示"下次补给"倒计时（= 距下一市场窗口的剩余时间）；
 * - 两栏标题下方各带一个搜索栏：可按名称/商品键检索 + 按类型（物品/装备/舰船/蓝图/核心）过滤；
 * - 每行提供手动挂单（挂单买/挂单卖，数量+价格可改，卖单从自然库存锁定）。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { askLineOf, buyLineOf, goodLockedReason, goodName, marketHistory, marketQuote, marketTrend, naturalHoldings, salesTaxRate, formatDurationMs, bmGateReason } from '@whale/core'
import type { BlueprintDef, MarketGoodDef, MarketRarity, ShipBlueprintDef } from '@whale/core'
import { Panel } from '@whale/ui'
import { HoverTip } from '../ui/Tooltip'
import { InfoHover, ItemHover, itemInfoLines, ModuleHover, moduleInfoLines, ShipHover, shipInfoLines } from '../ui/shipInfo'
import type { InfoLine } from '../ui/shipInfo'
import type { PageProps } from './common'
import { isk } from './common'
import { Glyph, ICO_TONES } from '../ui/Glyphs'

const KIND_TEXT: Record<string, string> = {
  item: '物品',
  module: '装备',
  ship: '舰船',
  blueprint: '蓝图',
  aicore: '核心',
  wreck: '残骸',
}
const KIND_OPTIONS = ['all', 'item', 'wreck', 'module', 'ship', 'blueprint', 'aicore'] as const
type KindFilter = (typeof KIND_OPTIONS)[number]
const RARITY_TEXT: Record<MarketRarity, string> = { common: '常驻', rare: '稀有', exotic: '限定' }

/** 目录条目对应的物品定义（item 类才查物品表） */
function itemDefOf(ctx: PageProps['engine']['ctx'], good: MarketGoodDef) {
  return good.kind === 'item' ? ctx.items.get(good.refId) : undefined
}

/** 行/悬停的分类文案：残骸类物品单独显示「残骸」（2026-09-08 船长定），其余按商品大类 */
function kindTextOf(ctx: PageProps['engine']['ctx'], good: MarketGoodDef): string {
  const it = itemDefOf(ctx, good)
  return it?.kind === 'wreck' ? '残骸' : (KIND_TEXT[good.kind] ?? good.kind)
}

/** 类型过滤判定：「残骸」= item 类里物品大类为残骸者；「物品」不再包含残骸（单独成类） */
function kindPasses(ctx: PageProps['engine']['ctx'], good: MarketGoodDef, kind: KindFilter): boolean {
  if (kind === 'all') return true
  if (kind === 'wreck') return itemDefOf(ctx, good)?.kind === 'wreck'
  if (good.kind !== kind) return false
  return !(kind === 'item' && itemDefOf(ctx, good)?.kind === 'wreck')
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

/** 商品悬停说明（名称/类型/稀有度 + 数据表描述；AI 核心按效率动态描述） */
function goodTipText(engine: PageProps['engine'], good: MarketGoodDef): string {
  const head = `${goodName(engine.ctx, good.key)}（${kindTextOf(engine.ctx, good)} · ${RARITY_TEXT[good.rarity] ?? ''}）`
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
  const poolQ = good.poolTarget && good.poolTarget > 0 ? (state.market.pools[good.key]?.q ?? 0) : undefined
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
          <span className="app-inv-name">{name}</span>
          <span className="app-chip is-dim">{kindTextOf(engine.ctx, good)}</span>
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
          {poolQ !== undefined ? <span className="app-dim"> · 站内库存 {Math.floor(poolQ).toLocaleString('zh-CN')}</span> : null}
          {good.rarity === 'common' ? <span className="app-dim"> · {RARITY_TEXT[good.rarity]}</span> : null}
          {quote.sell === undefined && good.rarity !== 'common' ? (
            <span className="app-dim"> · 常来看看（每 10 分钟刷新一轮到货）</span>
          ) : null}
        </div>
      </div>
    </GoodHover>
  )
}

/* ═══════════════ 市场栏（标题 + 有货冒泡列表；搜索/类型过滤已提升到页面级跨栏） ═══════════════ */

/** 有货冒泡上浮（供应簿有现货的排前面）；其余保持目录稳定顺序 */
function stockedFirst(engine: PageProps['engine'], goods: MarketGoodDef[]): MarketGoodDef[] {
  const hasStock = new Map(goods.map((g) => [g.key, marketQuote(engine.state, engine.ctx, g.key).sell !== undefined]))
  return [...goods].sort((a, b) => Number(hasStock.get(b.key)) - Number(hasStock.get(a.key)))
}

function MarketColumn({
  engine,
  title,
  right,
  rows,
  selKey,
  onSelect,
}: {
  engine: PageProps['engine']
  title: string
  right: ReactNode
  rows: MarketGoodDef[]
  selKey?: string | null
  onSelect?: (key: string) => void
}) {
  return (
    // is-fill + 去掉列表自身 max-height 帽：列表交给 Panel body 二级内滚（一级页不滚）
    <Panel className="is-fill" title={title} right={right}>
      {rows.length === 0 ? (
        <div className="app-dim app-inv-empty">没有匹配的订单（试试清空搜索或切换类型）。</div>
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
 * 2026-09-08 船长：保留窗 24 → 48；显示宽度自适应——容器够宽时整条 48 窗直显；
 * 宽度不足（采样点过密）时自动只显示「最新 24 窗」（不做更早段查看入口，船长后定不实现）；
 * 悬停任意采样点可查看该点数值与相对时间 */
/** 采样点最小可视间距（px）：低于该密度判定"宽度不足"，回退显示最新 24 窗 */
const MIN_POINT_SPACING_PX = 12

/** 采样点「约 N 分钟前」标注（样本间隔 30 分钟；最新样本 = 现在） */
function sampleAgoLabel(fullLen: number, absIdx: number): string {
  const mins = (fullLen - 1 - absIdx) * 30
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
              top: `${(mapY(slice[hover]!) / 130) * 100}%`,
            }}
          >
            ≈{isk(slice[hover]!)} ISK · {sampleAgoLabel(fullLen, offset + hover)}
          </div>
        ) : null}
    </div>
  )
}

/** 市场详情卡：价格曲线 + 买卖盘深度 + 持有量 + 交易面板（买/卖 tab：市价或挂单） */
function MarketDetail({ engine, onToast, good }: { engine: PageProps['engine']; onToast: PageProps['onToast']; good: MarketGoodDef }) {
  const state = engine.state
  const quote = marketQuote(state, engine.ctx, good.key)
  const hist = marketHistory(state, good.key)
  const trend = marketTrend(state, good.key)
  const holdings = naturalHoldings(state, good)
  const lock = goodLockedReason(state, good)
  // 按价格档聚合成交量（2026-09-05 船长：同价订单不应拆成多行——盘口按档合并），再取前 8 档
  const agg = (orders: Array<{ price: number; qty: number }>, desc: boolean): Array<{ price: number; qty: number }> => {
    const m = new Map<number, number>()
    for (const o of orders) m.set(o.price, (m.get(o.price) ?? 0) + o.qty)
    return [...m.entries()]
      .map(([price, qty]) => ({ price, qty }))
      .sort((a, b) => (desc ? b.price - a.price : a.price - b.price))
      .slice(0, 8)
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

  function setDefaults(side: 'buy' | 'sell'): void {
    setTab(side)
    // 默认价 = 与引擎通道同源的价线（收购价线/供应价线）；簿价含 jitter 不作通道基准
    setPrice(Math.max(1, side === 'buy' ? quote.sell ?? askLineOf(state, engine.ctx, good.key) : buyLineOf(state, engine.ctx, good.key)))
    setQty(side === 'sell' ? Math.max(1, holdings) : 1)
  }
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
      onToast('没有可卖的库存。', true)
      return
    }
    const r = engine.sellHoldingAt(good.key, n)
    if (!r.ok) onToast(r.error ?? '出售失败', true)
    else onToast(`已按市价卖出 ${name}×${n.toLocaleString('zh-CN')}（吃穿簿余量自动挂单）。`)
  }
  /** 全部卖出：先预览（可成交件数/毛额/税/净到账）再弹确认——不直接执行（船长 2026-09-05） */
  function askSellAll(): void {
    if (holdings <= 0) {
      onToast('没有可卖的库存。', true)
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
    else onToast(`已全部卖出 ${name}×${holdings.toLocaleString('zh-CN')}（吃穿簿余量自动挂单）。`)
  }
  function doPlace(): void {
    const n = Math.max(1, Math.floor(qty || 1))
    const p = Math.max(1, Math.floor(price || 1))
    if (tab === 'buy') {
      const id = engine.placeBuyOrderAt(good.key, p, n)
      if (id === null) onToast('挂买单失败：价格或数量无效。', true)
      else onToast(`已挂买单：${name}×${n.toLocaleString('zh-CN')} @ ${isk(p)} ISK。`)
    } else {
      const r = engine.placeSellOrderAt(good.key, p, n)
      if (!r.ok) onToast(r.error ?? '挂卖单失败。', true)
      else onToast(`已挂卖单：${name}×${n.toLocaleString('zh-CN')} @ ${isk(p)} ISK。`)
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
      right={
        <span className="app-dim">
          持有 {holdings.toLocaleString('zh-CN')} 件 · 中位价 {median !== undefined ? isk(median) : '—'} ISK
          <span className={trend > 0 ? 'app-trend-up' : trend < 0 ? 'app-trend-down' : 'app-trend-flat'}>
            {trend > 0 ? ' ▲' : trend < 0 ? ' ▼' : ' · 平'}
          </span>
        </span>
      }
    >
      <div className="app-mkt-detail">
        <div className="app-mkt-detail-left">
          <PriceChart hist={hist} />
          {hist.length >= 2 ? (
            <div className="app-mkt-chart-hint">行市参考价走势：每 30 分钟采样一次（含库存压力与冲击），保留 48 窗约 24 小时，非逐笔成交价</div>
          ) : null}
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
        <div className="app-mkt-detail-books">
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
          {/* 买/卖方向切换：独立分段开关样式，与下方交易按钮明确区分（船长 2026-09-05） */}
          <div className="app-mkt-sides" role="tablist">
            <button
              role="tab"
              aria-selected={tab === 'buy'}
              disabled={!buyable}
              className={`app-mkt-side is-buy${tab === 'buy' ? ' is-active' : ''}${buyable ? '' : ' is-disabled'}`}
              onClick={() => {
                if (buyable) setDefaults('buy')
              }}
              title={buyable ? undefined : '该商品空间站只收购，不对外出售'}
            >
              买入
            </button>
            <button
              role="tab"
              aria-selected={tab === 'sell'}
              className={`app-mkt-side is-sell${tab === 'sell' ? ' is-active' : ''}`}
              onClick={() => setDefaults('sell')}
            >
              卖出
            </button>
          </div>
          <div className="app-mkt-trade-row">
            <span className="app-dim">数量</span>
            <input className="app-input" type="number" min={1} value={qty} onChange={(e) => setQty(Number(e.target.value))} />
            {tab === 'sell' ? (
              <button className="app-btn is-small" disabled={holdings <= 0} onClick={() => setQty(Math.max(1, holdings))} title={`把数量填为全部持有（${holdings}）`}>
                全部
              </button>
            ) : null}
          </div>
          <div className="app-mkt-trade-row">
            <span className="app-dim">单价</span>
            <input className="app-input" type="number" min={1} value={price} onChange={(e) => setPrice(Number(e.target.value))} />
            <span className="app-dim">ISK</span>
          </div>
          {/* 价格指引（2026-09-08 船长：吸收量随价格挂钩 + 两侧巡游抢单——让利清仓快、高挂/低挂赌巡游） */}
          <div className="app-dim app-sr-eta">
            {(() => {
              const p = Math.max(1, Math.floor(price || 1))
              const bal = engine.ctx.balance.market
              if (tab === 'sell') {
                const bid = buyLineOf(state, engine.ctx, good.key)
                if (p > bid) {
                  const pct = ((p - bid) / bid) * 100
                  const pRoll = (bal.snatchSellChance * Math.exp((-bal.snatchSellDecay * pct) / 100)) * 100
                  return (
                    <>
                      高于收购价 {isk(bid)} 约 {pct.toFixed(pct >= 10 ? 0 : 1)}%：站内不收，等巡游采购约{' '}
                      <b>{pRoll < 10 ? pRoll.toFixed(1) : pRoll.toFixed(0)}%/分</b> 概率——想快就降价让利
                    </>
                  )
                }
                if (p < bid) {
                  const pct = ((bid - p) / bid) * 100
                  const E = Math.min(bal.absorbMaxMul, 1 + bal.absorbPerPoint * pct)
                  const capped = E >= bal.absorbMaxMul - 1e-9
                  return (
                    <>
                      已让利 {pct < 100 ? pct.toFixed(pct >= 10 ? 0 : 1) : '>100'}%（收购价 {isk(bid)}）：
                      站内吸收 <b>×{E.toFixed(1)}</b>，清仓更快
                      {capped ? '（已达上限）' : `（折 10% 封顶 ×${bal.absorbMaxMul}）`}
                    </>
                  )
                }
                return (
                  <>
                    平价挂卖（= 收购价 {isk(bid)}）：站内每 60 秒保底吸收；让利 1% 提速 40%、折 10% 封顶 ×
                    {bal.absorbMaxMul}
                  </>
                )
              }
              const ask = quote.sell ?? askLineOf(state, engine.ctx, good.key)
              if (p >= ask) return <>平价买入（= 供应价 {isk(ask)}）：现买现得</>
              const pct = ((ask - p) / ask) * 100
              const pRoll = (bal.snatchBuyChance * Math.exp((-bal.snatchBuyDecay * pct) / 100)) * 100
              return (
                <>
                  低于供应价 {isk(ask)} 约 {pct.toFixed(pct >= 10 ? 0 : 1)}%：等巡游供货约{' '}
                  <b>{pRoll < 10 ? pRoll.toFixed(1) : pRoll.toFixed(0)}%/分</b> 概率——想立刻拿到就提价到供应价
                </>
              )
            })()}
          </div>
          <div className="app-mkt-trade-btns">
            {/* 2026-09-08 船长：挂单按钮前置到市价买卖之前（挂单/市价/（卖出侧）全部卖出） */}
            <button className="app-btn is-small" onClick={doPlace}>
              {tab === 'buy' ? '挂买单' : '挂卖单'}
            </button>
            <button className="app-btn is-primary is-small" onClick={tab === 'buy' ? doBuy : () => doSell()}>
              {tab === 'buy' ? '市价买入' : '市价卖出'}
            </button>
            {tab === 'sell' ? (
              <button className="app-btn is-small is-sellall" disabled={holdings <= 0} onClick={askSellAll} title="先预览实际成交与到账，确认后再卖出全部持有">
                全部卖出（{holdings}）
              </button>
            ) : null}
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
              <b>{confirmSell.want.toLocaleString('zh-CN')} 件（持有 {confirmSell.avail.toLocaleString('zh-CN')}）</b>
            </div>
            <div className="app-mkt-confirm-row">
              <span>收购簿可立即成交</span>
              <b className={confirmSell.fillable > 0 ? 'app-trend-up' : ''}>
                {confirmSell.fillable.toLocaleString('zh-CN')} 件 · {confirmSell.orders} 笔单
              </b>
            </div>
            {confirmSell.fillable > 0 ? (
              <>
                <div className="app-mkt-confirm-row">
                  <span>预计成交额（毛额）</span>
                  <b className="app-gold">{isk(confirmSell.gross)} ISK</b>
                </div>
                <div className="app-mkt-confirm-row">
                  <span>贸易税</span>
                  <b>−{isk(confirmSell.tax)} ISK</b>
                </div>
                <div className="app-mkt-confirm-row is-net">
                  <span>预计实际到账（税后）</span>
                  <b className="app-gold">{isk(confirmSell.net)} ISK</b>
                </div>
              </>
            ) : null}
            {confirmSell.leftover > 0 ? (
              <div className="app-mkt-confirm-note">
                ⚠ 收购簿只能吃下 {confirmSell.fillable.toLocaleString('zh-CN')} 件，其余{' '}
                {confirmSell.leftover.toLocaleString('zh-CN')} 件将自动按边际价挂限价卖单——挂单成交前不计入本次到账（挂单免费，可随时撤销）。
              </div>
            ) : null}
            {confirmSell.fillable <= 0 ? (
              <div className="app-mkt-confirm-note">⚠ 当前收购簿为空：本次不会立即成交，全部数量将提示改为挂限价卖单。</div>
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

function MyOrders({ engine, onToast }: PageProps) {
  const state = engine.state
  if (state.orders.length === 0) {
    return (
      <div className="app-dim app-inv-empty">
        没有挂单。市价单吃穿簿后的剩余会自动挂单（可在此撤销，货退回库存）。
      </div>
    )
  }
  return (
    <ul className="app-inv-list">
      {state.orders.map((order) => (
        <li key={order.id} className="app-inv-row">
          <div className="app-inv-main">
            <span className="app-inv-name">
              {order.side === 'sell' ? '▼ 卖单' : '▲ 买单'}：{goodName(engine.ctx, order.good)}
            </span>
            <span className="app-inv-count">
              {order.side === 'sell' ? '挂卖' : '挂买'} {order.price.toLocaleString('zh-CN')} ISK · 剩余 {order.qty.toLocaleString('zh-CN')}
              {order.filled > 0 ? `（已成交 ${order.filled.toLocaleString('zh-CN')}）` : ''}
            </span>
          </div>
          <div className="app-inv-btns">
            <button
              className="app-btn is-small is-warn"
              onClick={() => {
                engine.cancelOrderAt(order.id)
                onToast(order.side === 'sell' ? '卖单已撤销：货物退回库存。' : '买单已撤销。')
              }}
            >
              撤单
            </button>
          </div>
        </li>
      ))}
    </ul>
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
  const rareCol = goods.filter((g) => g.rarity !== 'common')
  const [mktTab, setMktTab] = useState<'common' | 'rare'>('common')
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
  const taxRate = salesTaxRate(state, engine.ctx)
  const lvA = state.skills.trained[engine.ctx.balance.market.taxSkillAId] ?? 0
  const lvB = state.skills.trained[engine.ctx.balance.market.taxSkillBId] ?? 0

  // 页面级全局搜索（船长 2026-09-05）：搜索栏从两栏内取出；输入/类型过滤时同时检索常驻与稀有订单
  // （常驻与稀有的商品集不重叠——rarity 单值归属，跨栏合并不会重复条目）。
  const [kind, setKind] = useState<KindFilter>('all')
  const query = kw.trim().toLowerCase()
  const filterActive = query.length > 0 || kind !== 'all'
  const filteredAll = useMemo(
    () =>
      stockedFirst(
        engine,
        goods.filter((good) => {
          if (kind !== 'all' && !kindPasses(engine.ctx, good, kind)) return false
          if (query.length > 0) {
            const name = goodName(engine.ctx, good.key).toLowerCase()
            if (!name.includes(query) && !good.key.toLowerCase().includes(query)) return false
          }
          return true
        }),
      ),
    [goods, engine, kind, query, engine.state.gameMs],
  )

  return (
    <div className="page-stack page-fill">
      <div className="app-dim app-note">
        协会市场全程走挂单簿撮合：收购价低于供应价；集中买卖会带来价格短时偏离（冲击动量），矿石/矿物另受库存池调节。
        每行可「挂单买 / 挂单卖」自定价等待成交。
      </div>
      <div className="app-dim app-note">
        贸易税：卖出成交按成交额收税——当前税率{' '}
        <b className="app-gold">{Math.round(taxRate * 1000) / 10}%</b>
        {lvA + lvB > 0 ? (
          <span>（会计学 Lv{lvA} −{lvA * 8}% · 贸易谈判学 Lv{lvB} −{lvB * 8}%）</span>
        ) : (
          <span>（基础 5%；练「会计学 / 贸易谈判学」各 −8%/级，双满仅剩 1%）</span>
        )}
        。挂单、自动转挂单与买入一律免费。
      </div>

      {/* 常驻双栏：左 = 搜索 + 标签 + 商品列表；右 = 市场详情大盘（常驻，无选中时显示引导） */}
      <div className="app-mkt-split">
        <div className="app-mkt-left">
          {/* 页面级全局搜索栏：同时检索常驻 + 稀有订单（常驻与稀有商品不重叠） */}
          <div className="app-mkt-search">
            <input
              className="app-mkt-search-input"
              type="search"
              placeholder="搜索市场（同时检索常驻与稀有订单）：名称 / 商品键"
              value={kw}
              onChange={(e) => setKw(e.target.value)}
            />
            <select className="app-mkt-kind" value={kind} onChange={(e) => setKind(e.target.value as KindFilter)}>
              <option value="all">全部类型</option>
              {KIND_OPTIONS.filter((k) => k !== 'all').map((k) => (
                <option key={k} value={k}>
                  {KIND_TEXT[k]}
                </option>
              ))}
            </select>
          </div>

          {filterActive ? (
            /* ── 搜索/过滤激活：跨栏合并结果（常驻 + 稀有一次搜全；GoodRow 自带稀有度徽标区分） ── */
            <MarketColumn
              engine={engine}
              title={query.length > 0 ? `搜索结果：${kw.trim()}` : `全部 ${KIND_TEXT[kind] ?? kind}`}
              right={<span className="app-dim">常驻与稀有订单一次搜全（商品按稀有度徽标区分）</span>}
              rows={filteredAll}
              selKey={activeSelKey}
              onSelect={setSelKey}
            />
          ) : (
            <>
              {/* 常驻订单 / 稀有订单（与星图页同款 app-subtabs 标签规范；稀有单时效短，切回本页记得看一眼） */}
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
                  title="稀有订单寿命 36 分钟、限定奇货 6 小时有效——每 10 分钟一轮到货，切回本标签才能看到现存单"
                >
                  <span>✦</span>
                  <span>稀有订单</span>
                </button>
              </div>

              {mktTab === 'common' ? (
                <MarketColumn
                  engine={engine}
                  title="常驻供应"
                  right={
                    <span className="app-dim" title="NPC 每 60 秒按窗口补给/刷新订单（含离线期间）">
                      下次补给 {fmtClock(nextSupplyIn(engine))} · 订单 20 分钟有效
                    </span>
                  }
                  rows={stockedFirst(engine, common)}
                  selKey={activeSelKey}
                  onSelect={setSelKey}
                />
              ) : (
                <MarketColumn
                  engine={engine}
                  title="稀有订单"
                  right={<span className="app-dim">每 10 分钟一轮到货 · 稀有 36 分钟寿命 · 限定奇货 6 小时有效 · 时钟=现存单到期</span>}
                  rows={stockedFirst(engine, rareCol)}
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
                余额 {isk(state.wallet.isk)} ISK · 托管在售/在途 {isk(Object.values(state.escrowItems).reduce((a, b) => a + b, 0))} 件
              </span>
            }
          >
            <MyOrders engine={engine} onToast={onToast} />
          </Panel>
        </div>
      </div>
    </div>
  )
}
