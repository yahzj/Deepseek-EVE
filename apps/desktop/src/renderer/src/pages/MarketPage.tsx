/**
 * 市场页（V9）：NPC 挂单簿市场，两栏展示 —— 常驻供应 / 稀有订单（含限定奇货）。
 *
 * 玩法规则（中文说明，设计 V4/V5 已确认）：
 * - 收购价 = NPC 收玩家的价；供应价 = NPC 卖玩家的价（两者有价差，防倒卖）；
 * - 池商品（矿石/矿物）：站内库存池（常驻显示），池淤积→收购压价（倾销会砸价），
 *   池枯竭→供应断货涨价；价格还受隐藏的"冲击动量"影响（集中买卖会推/砸价，随时间恢复）；
 * - 单件商品（装备/蓝图/船/核心）：常驻平价随刷随买；稀有订单低频、限定奇货一闪而过；
 * - 市价买入吃穿簿后剩单会自动转成限价挂单；挂单随时可撤销（货退回原库存）。
 *
 * 展示规则（玩家 2026-09 修正要求）：
 * - "有货"的商品行冒泡上浮（有供应现货的排在前，无货沉底，稳定排序）；
 * - 稀有订单行标注现存供应单的剩余寿命（最早到期的那笔，mm:ss）；
 * - 常驻供应标题后显示"下次补给"倒计时（= 距下一市场窗口的剩余时间）；
 * - 两栏标题下方各带一个搜索栏：可按名称/商品键检索 + 按类型（物品/装备/舰船/蓝图/核心）过滤；
 * - 每行提供手动挂单（挂单买/挂单卖，数量+价格可改，卖单从自然库存锁定）。
 */
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { goodLockedReason, goodName, levelOf, marketQuote, marketTrend, naturalHoldings, salesTaxRate } from '@whale/core'
import type { MarketGoodDef, MarketRarity } from '@whale/core'
import { Panel } from '@whale/ui'
import { HoverTip } from '../ui/Tooltip'
import type { PageProps } from './common'
import { isk } from './common'

const KIND_TEXT: Record<string, string> = {
  item: '物品',
  module: '装备',
  ship: '舰船',
  blueprint: '蓝图',
  aicore: '核心',
}
const KIND_OPTIONS = ['all', 'item', 'module', 'ship', 'blueprint', 'aicore'] as const
type KindFilter = (typeof KIND_OPTIONS)[number]
const RARITY_TEXT: Record<MarketRarity, string> = { common: '常驻', rare: '稀有', exotic: '限定' }

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
  const head = `${goodName(engine.ctx, good.key)}（${KIND_TEXT[good.kind] ?? good.kind} · ${RARITY_TEXT[good.rarity] ?? ''}）`
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

function GoodRow({
  engine,
  onToast,
  good,
  buyQty,
  onQty,
}: {
  engine: PageProps['engine']
  onToast: PageProps['onToast']
  good: MarketGoodDef
  buyQty: number
  onQty: (n: number) => void
}) {
  const state = engine.state
  const quote = marketQuote(state, engine.ctx, good.key)
  const trend = marketTrend(state, good.key)
  const poolQ = good.poolTarget && good.poolTarget > 0 ? (state.market.pools[good.key]?.q ?? 0) : undefined
  const holdings = naturalHoldings(state, good)
  const isPool = good.kind === 'item' && good.poolTarget !== undefined
  const canSell = good.playerSellable !== false && holdings > 0
  const lock = goodLockedReason(state, good)
  const life = good.rarity !== 'common' ? earliestSellRemaining(engine, good.key) : undefined
  const name = goodName(engine.ctx, good.key)

  // ── 手动挂单表单（本地展开态） ──
  const [form, setForm] = useState<'buy' | 'sell' | null>(null)
  const [fQty, setFQty] = useState(1)
  const [fPrice, setFPrice] = useState(1)

  function openForm(side: 'buy' | 'sell'): void {
    if (side === 'buy' && lock) {
      onToast(`暂不能挂买单：${lock}。`, true)
      return
    }
    const level = levelOf(state, engine.ctx, good.key)
    let price: number
    let qty: number
    if (side === 'buy') {
      price =
        quote.sell !== undefined
          ? quote.sell
          : isPool
            ? Math.max(Math.round(level * 1.06), level + 1)
            : Math.max(1, Math.round(level * 1.02))
      qty = isPool ? 100 : 1
    } else {
      price = quote.buy !== undefined ? quote.buy : isPool ? level : Math.max(1, Math.round(level * (good.demandMultiplier ?? 0.5)))
      qty = Math.max(1, holdings)
    }
    setFPrice(Math.max(1, price))
    setFQty(Math.max(1, qty))
    setForm(side)
  }

  function submitForm(): void {
    const qty = Math.max(1, Math.floor(fQty || 1))
    const price = Math.max(1, Math.floor(fPrice || 1))
    if (form === 'buy') {
      const id = engine.placeBuyOrderAt(good.key, price, qty)
      if (id === null) onToast('挂买单失败：价格或数量无效。', true)
      else {
        onToast(`已挂买单：${name}×${qty.toLocaleString('zh-CN')} @ ${isk(price)} ISK（成交才扣款）。`)
        setForm(null)
      }
    } else {
      const r = engine.placeSellOrderAt(good.key, price, qty)
      if (!r.ok) onToast(r.error ?? '挂卖单失败。', true)
      else {
        onToast(`已挂卖单：${name}×${qty.toLocaleString('zh-CN')} @ ${isk(price)} ISK（可撤单退回库存）。`)
        setForm(null)
      }
    }
  }

  function handleBuy(): void {
    const qty = isPool ? Math.max(1, buyQty || 1) : 1
    const r = engine.buyGoodAt(good.key, qty)
    if (!r.ok) onToast(r.error ?? '买入失败', true)
    else onToast(`已买入 ${name}${qty > 1 ? `×${qty.toLocaleString('zh-CN')}` : ''}（详见日志）。`)
  }

  function handleSell(): void {
    const r = engine.sellHoldingAt(good.key)
    if (!r.ok) onToast(r.error ?? '出售失败', true)
    else onToast(`已受理市价卖出 ${name}（详见日志；吃穿簿的剩余自动挂单）。`)
  }

  return (
    <HoverTip as="li" tip={goodTipText(engine, good)} className="app-inv-row app-mkt-row">
      <div className="app-inv-main">
        <div className="app-mkt-name-line">
          <span className="app-inv-name">{name}</span>
          <span className="app-chip is-dim">{KIND_TEXT[good.kind] ?? good.kind}</span>
          {good.rarity === 'rare' ? <span className="app-chip is-rare">稀有</span> : null}
          {good.rarity === 'exotic' ? <span className="app-chip is-exotic">限定奇货</span> : null}
          {lock ? <span className="app-chip is-exotic" title={lock}>🔒 {lock}</span> : null}
        </div>
        <div className="app-inv-count">
          <span className="app-mkt-quote">
            收购 <b className="app-gold">{quote.buy !== undefined ? isk(quote.buy) : '—'}</b>
            <span className={trend > 0 ? 'app-trend-up' : trend < 0 ? 'app-trend-down' : 'app-trend-flat'}>
              {trend > 0 ? ' ▲' : trend < 0 ? ' ▼' : ' ·'}
            </span>
          </span>
          <span className="app-mkt-quote">
            供应 <b className={quote.sell !== undefined ? 'app-price-sell' : ''}>{quote.sell !== undefined ? isk(quote.sell) : '暂无现货'}</b>
            {quote.sellQty > 1 ? ` ×${quote.sellQty.toLocaleString('zh-CN')}` : ''}
          </span>
          {life !== undefined ? <span className="app-chip app-life-chip">⏳ {fmtClock(life)}</span> : null}
          {poolQ !== undefined ? <span className="app-dim"> · 站内库存 {Math.floor(poolQ).toLocaleString('zh-CN')}</span> : null}
          {good.rarity === 'common' ? <span className="app-dim"> · {RARITY_TEXT[good.rarity]}</span> : null}
          {quote.sell === undefined && good.rarity !== 'common' ? (
            <span className="app-dim"> · 常来看看（{good.rarity === 'rare' ? '稀有' : '限定'}订单寿命极短）</span>
          ) : null}
        </div>
      </div>
      <div className="app-inv-btns">
        {lock ? (
          <button className="app-btn is-small" disabled title={lock}>
            声望未达标
          </button>
        ) : isPool ? (
          <>
            <input
              className="app-mkt-qty"
              type="number"
              min={1}
              step={1}
              value={buyQty}
              onChange={(e) => onQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
              title="市价买入数量"
            />
            <button className="app-btn is-small is-primary" onClick={handleBuy} disabled={state.wallet.isk <= 0}>
              市价买入
            </button>
          </>
        ) : (
          <button
            className="app-btn is-small is-primary"
            onClick={handleBuy}
            disabled={state.wallet.isk <= 0 || quote.sell === undefined}
            title={quote.sell === undefined ? '当前供应簿无货：可挂单买入等 NPC 补给后自动成交' : ''}
          >
            {quote.sell !== undefined ? '买入' : '无货'}
          </button>
        )}
        <button className="app-btn is-small" onClick={() => openForm('buy')} disabled={lock !== null}>
          挂单买
        </button>
        {canSell ? (
          <>
            <button className="app-btn is-small" onClick={() => openForm('sell')} title={`可卖库存 ×${holdings.toLocaleString('zh-CN')}`}>
              挂单卖
            </button>
            <button className="app-btn is-small" onClick={handleSell} title={`可卖库存 ×${holdings.toLocaleString('zh-CN')}`}>
              市价卖{isPool ? ` ×${holdings.toLocaleString('zh-CN')}` : ''}
            </button>
          </>
        ) : null}
      </div>
      {form !== null ? (
        <div className="app-mkt-form">
          <span className="app-dim">{form === 'buy' ? '挂买单（成交才扣款）：' : '挂卖单（锁库存，可撤）：'}</span>
          <input
            className="app-mkt-qty"
            type="number"
            min={1}
            step={1}
            value={fQty}
            onChange={(e) => setFQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            title="数量"
          />
          <span className="app-dim">×</span>
          <input
            className="app-mkt-price"
            type="number"
            min={1}
            step={1}
            value={fPrice}
            onChange={(e) => setFPrice(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            title="单价（ISK）"
          />
          <span className="app-dim">ISK</span>
          <button className="app-btn is-small is-primary" onClick={submitForm}>
            确认挂单
          </button>
          <button className="app-btn is-small" onClick={() => setForm(null)}>
            取消
          </button>
          <span className="app-dim app-mkt-hint">
            {form === 'buy' ? '报价 ≥ 供应价才有机会成交' : '报价 ≤ 收购价才有机会成交'}
          </span>
        </div>
      ) : null}
    </HoverTip>
  )
}

/* ═══════════════ 市场栏（标题 + 搜索/过滤 + 有货冒泡排序） ═══════════════ */

function MarketColumn({
  engine,
  onToast,
  title,
  right,
  goods,
  qtyOf,
  onQty,
}: {
  engine: PageProps['engine']
  onToast: PageProps['onToast']
  title: string
  right: ReactNode
  goods: MarketGoodDef[]
  qtyOf: (key: string) => number
  onQty: (key: string, n: number) => void
}) {
  const [kw, setKw] = useState('')
  const [kind, setKind] = useState<KindFilter>('all')
  const query = kw.trim().toLowerCase()

  const rows = useMemo(() => {
    const filtered = goods.filter((good) => {
      if (kind !== 'all' && good.kind !== kind) return false
      if (query.length > 0) {
        const name = goodName(engine.ctx, good.key).toLowerCase()
        if (!name.includes(query) && !good.key.toLowerCase().includes(query)) return false
      }
      return true
    })
    // "有货"冒泡上浮（供应簿有现货的排前面）；其余保持目录稳定顺序
    const hasStock = new Map(filtered.map((g) => [g.key, marketQuote(engine.state, engine.ctx, g.key).sell !== undefined]))
    return [...filtered].sort((a, b) => Number(hasStock.get(b.key)) - Number(hasStock.get(a.key)))
  }, [goods, engine, kind, query, engine.state.gameMs])

  return (
    <Panel title={title} right={right}>
      <div className="app-mkt-search">
        <input
          className="app-mkt-search-input"
          type="search"
          placeholder={`搜索 ${title} 商品：名称 / 商品键`}
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
      {rows.length === 0 ? (
        <div className="app-dim app-inv-empty">没有匹配的订单（试试清空搜索或切换类型）。</div>
      ) : (
        <ul className="app-inv-list app-mkt-list">
          {rows.map((good) => (
            <GoodRow key={good.key} engine={engine} onToast={onToast} good={good} buyQty={qtyOf(good.key)} onQty={(n) => onQty(good.key, n)} />
          ))}
        </ul>
      )}
    </Panel>
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
              {order.side === 'sell' ? '⬇ 卖单' : '⬆ 买单'}：{goodName(engine.ctx, order.good)}
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

export function MarketPage({ engine, onToast }: PageProps) {
  const state = engine.state
  const goods = useMemo(() => [...engine.ctx.marketGoods.values()], [engine])
  const common = goods.filter((g) => g.rarity === 'common')
  const rareCol = goods.filter((g) => g.rarity !== 'common')
  const [qtyByKey, setQtyByKey] = useState<Record<string, number>>({})
  const taxRate = salesTaxRate(state, engine.ctx)
  const lvA = state.skills.trained[engine.ctx.balance.market.taxSkillAId] ?? 0
  const lvB = state.skills.trained[engine.ctx.balance.market.taxSkillBId] ?? 0

  function qtyOf(key: string): number {
    return qtyByKey[key] ?? 100
  }

  return (
    <div className="page-stack">
      <div className="app-dim app-note">
        空间站商店已并入市场：所有买卖都走 NPC 挂单簿撮合。收购价 &lt; 供应价有差价；
        集中买卖会触发"冲击动量"（价格短时偏离，随后缓慢恢复）；矿石/矿物还受站内库存池调节。
        每行可「挂单买/挂单卖」自定价等待成交。
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

      <div className="app-market-cols">
        <MarketColumn
          engine={engine}
          onToast={onToast}
          title="常驻供应"
          right={
            <span className="app-dim" title="NPC 每 60 秒按窗口补给/刷新订单（含离线期间）">
              下次补给 {fmtClock(nextSupplyIn(engine))} · 订单 20 分钟有效
            </span>
          }
          goods={common}
          qtyOf={qtyOf}
          onQty={(key, n) => setQtyByKey((p) => ({ ...p, [key]: n }))}
        />

        <MarketColumn
          engine={engine}
          onToast={onToast}
          title="稀有订单"
          right={<span className="app-dim">稀有 9 分钟寿命 · 限定奇货 4 分钟闪现 · ⏳=现存单到期</span>}
          goods={rareCol}
          qtyOf={qtyOf}
          onQty={(key, n) => setQtyByKey((p) => ({ ...p, [key]: n }))}
        />
      </div>

      <Panel
        title="我的挂单"
        right={
          <span className="app-dim">
            余额 {isk(state.wallet.isk)} ISK · escrow 在售/在途 {isk(Object.values(state.escrowItems).reduce((a, b) => a + b, 0))} 件
          </span>
        }
      >
        <MyOrders engine={engine} onToast={onToast} />
      </Panel>
    </div>
  )
}
