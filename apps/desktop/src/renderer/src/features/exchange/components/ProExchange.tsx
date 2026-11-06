/**
 * 专业模式 · 星舰战术交易终端主视图（ProExchange）。
 *
 * 核心升级（2026-11-03 船长令）：
 * - 聚焦核心玩法：重点强化「挂单与杠杆」及「自动量化交易」；
 * - 剔除枯燥繁琐的五档深度数字与逐笔流水，升级为直观醒目的「多空博弈张力槽」；
 * - 移除常驻底部的内滚流水窗，改为中栏二级 Tab 按需展开，K 线图开阔舒展并支持滚轮缩放；
 * - 2026-11-06 船长令重排：K 线图独占中栏上方，下单与自动量化横排在图下，
 *   持仓/委托/流水移到右栏，图面只留悬浮读数。
 */
import { useEffect, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Bot, ChartCandlestick, Receipt } from '@carbon/icons-react'
import type { ExchangeClient, ExchangeSnapshot } from '../client'
import type { ToastFn } from '../../../pages/common'
import { StockList } from './StockList'
import { MarketOverview } from './MarketOverview'
import { Chart } from './Chart'
import { TradePanel } from './TradePanel'
import { Positions } from './Positions'
import { AutoTrade } from './AutoTrade'
import { T } from '../texts'
import { money, pctAbs } from '../format'
import { EXCH_PREF, readExchangeChoice, writeExchangePref } from '../viewPrefs'
import { Records } from './Records'
import { OrderCtaSlotContext } from '../orderCta'
import { tr } from '../../../i18n/locale'

interface ProExchangeProps {
  client: ExchangeClient
  snap: ExchangeSnapshot
  code: string
  pickedPrice: { value: number; seq: number } | null
  onSelectCode: (code: string) => void
  onPickPrice: (price: number) => void
  onToast: ToastFn
}

/** 多空博弈张力条：直观展示买卖多空压力差，取代枯燥的五档数字 */
function MarketSentimentBar({ book }: { book: ExchangeSnapshot['book'] }) {
  const sumAsks = book.asks.reduce((s, l) => s + l.qty, 0)
  const sumBids = book.bids.reduce((s, l) => s + l.qty, 0)
  const total = sumAsks + sumBids
  const bidRatio = total > 0 ? (sumBids / total) * 100 : 50
  const askRatio = 100 - bidRatio

  return (
    <div className="ex-pro-sentiment" title={`买方挂单 ${sumBids} 股 / 卖方挂单 ${sumAsks} 股`}>
      <div className="ex-pro-sentiment-info">
        <span className="ex-pro-sentiment-tag is-bid">
          {tr('ui.exchange.004')} {total > 0 ? `${bidRatio.toFixed(1)}%` : '—'}
        </span>
        <span className="ex-pro-sentiment-status ex-dim">
            {tr('ui.exchange.006')}
        </span>
        <span className="ex-pro-sentiment-tag is-ask">
          {tr('ui.exchange.005')} {total > 0 ? `${askRatio.toFixed(1)}%` : '—'}
        </span>
      </div>
      <div className="ex-pro-sentiment-track">
        <div className="ex-pro-sentiment-fill is-bid" style={{ width: `${bidRatio}%` }} />
        <div className="ex-pro-sentiment-fill is-ask" style={{ width: `${askRatio}%` }} />
      </div>
    </div>
  )
}
export function ProExchange({
  client,
  snap,
  code,
  pickedPrice,
  onSelectCode,
  onPickPrice,
  onToast,
}: ProExchangeProps) {
  // 右栏标签页：当前多空持仓与委托 vs 成交历史流水
  const [ctaSlot, setCtaSlot] = useState<HTMLDivElement | null>(null)
  const [sideTab, setSideTab] = useState<'positions' | 'records'>(() =>
    readExchangeChoice(EXCH_PREF.proSide, ['positions', 'records'] as const, 'positions'),
  )
  // 中栏下单区：杠杆多 / 杠杆空 / 自动量化折成 Tab（2026-11-06 船长令：现货并入 1x）
  const [orderTab, setOrderTab] = useState<'long' | 'short' | 'auto'>(() =>
    readExchangeChoice(EXCH_PREF.proOrder, ['long', 'short', 'auto'] as const, 'long'),
  )

  useEffect(() => {
    writeExchangePref(EXCH_PREF.proSide, sideTab)
  }, [sideTab])

  useEffect(() => {
    writeExchangePref(EXCH_PREF.proOrder, orderTab)
  }, [orderTab])

  const posCount = snap.account.positions.length + snap.account.holdings.length
  // 保证金占用 = 已用保证金 / 权益（marginRatio 是权益/保证金）
  const usedRatio = snap.account.marginRatio > 0 ? 100 / snap.account.marginRatio : 0

  return (
    <div className="ex-grid ex-pro-grid">
      {/* 左栏：标的列表与市场战况仪表 */}
      <aside className="ex-col ex-col-left">
        <StockList client={client} snap={snap} selected={code} onSelect={onSelectCode} />
        <MarketOverview snap={snap} />
      </aside>

      {/* 中栏：K 线图（加高）→ 多空张力槽 → 下单与自动量化横排 */}
      <section className="ex-col ex-col-mid ex-pro-col-mid">
        <div className="ex-pro-chart-wrap">
          <Chart client={client} code={code} quote={snap.quote} tick={snap.tick} />
        </div>

        <MarketSentimentBar book={snap.book} />

        <div className="ex-pro-dock">
          <div className="ex-pro-dock-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={orderTab === 'long'}
              className={`ex-pro-dock-tab${orderTab === 'long' ? ' is-active' : ''}`}
              onClick={() => setOrderTab('long')}
            >
              <ArrowUpRight size={16} />
              <span>{T.modeLong}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={orderTab === 'short'}
              className={`ex-pro-dock-tab${orderTab === 'short' ? ' is-active' : ''}`}
              onClick={() => setOrderTab('short')}
            >
              <ArrowDownRight size={16} />
              <span>{T.modeShort}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={orderTab === 'auto'}
              className={`ex-pro-dock-tab${orderTab === 'auto' ? ' is-active' : ''}`}
              onClick={() => setOrderTab('auto')}
            >
              <Bot size={16} />
              <span>自动量化交易</span>
              {snap.strategies.length > 0 ? (
                <span className="ex-pro-dock-badge">{snap.strategies.length}</span>
              ) : null}
            </button>
          </div>
          <div className="ex-pro-dock-body">
            <OrderCtaSlotContext.Provider value={ctaSlot}>
              {orderTab !== 'auto' ? (
                <TradePanel client={client} snap={snap} code={code} pickedPrice={pickedPrice} onToast={onToast} fixedMode={orderTab} />
              ) : (
                <AutoTrade client={client} snap={snap} code={code} onToast={onToast} alwaysOpen={true} />
              )}
            </OrderCtaSlotContext.Provider>
          </div>
        </div>
      </section>

      {/* 右栏：持仓、委托与流水 */}
      <aside className="ex-col ex-col-right ex-pro-col-right">
        <div className="ex-pro-side-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={sideTab === 'positions'}
            className={`ex-pro-side-tab${sideTab === 'positions' ? ' is-active' : ''}`}
            onClick={() => setSideTab('positions')}
          >
            <ChartCandlestick size={16} />
            <span>持仓与委托{posCount > 0 ? ` (${posCount})` : ''}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sideTab === 'records'}
            className={`ex-pro-side-tab${sideTab === 'records' ? ' is-active' : ''}`}
            onClick={() => setSideTab('records')}
          >
            <Receipt size={16} />
            <span>成交历史与流水</span>
          </button>
        </div>

        <div className="ex-pro-side-panel">
          {sideTab === 'positions' ? (
            <Positions client={client} snap={snap} code={code} onSelect={onSelectCode} onToast={onToast} />
          ) : (
            <Records client={client} snap={snap} onToast={onToast} />
          )}
        </div>

        {/* 底部账户概览：把右栏余下的空间用起来（2026-11-06 船长反馈） */}
        <div className="ex-pro-side-foot">
          <div className="ex-pro-side-stat">
            <span>可用现金</span>
            <b className="ex-num">{money(snap.account.cash)}</b>
          </div>
          <div className="ex-pro-side-stat">
            <span>账户权益</span>
            <b className="ex-num">{money(snap.account.equity)}</b>
          </div>
          <div className="ex-pro-side-stat">
            <span>保证金率</span>
            <b className={`ex-num${snap.account.marginRatio < 120 ? ' is-danger' : ''}`}>
              {pctAbs(snap.account.marginRatio)}
            </b>
          </div>
          <div className="ex-pro-side-stat">
            <span>持仓 / 委托</span>
            <b className="ex-num">
              {snap.account.positions.length + snap.account.holdings.length} / {snap.orders.length}
            </b>
          </div>
          <div className="ex-pro-side-usage">
            <div className="ex-pro-side-usage-head">
              <span>保证金占用</span>
              <b className="ex-num">{pctAbs(usedRatio)}</b>
            </div>
            <div className="ex-pro-side-usage-track">
              <div
                className={`ex-pro-side-usage-fill${usedRatio > 60 ? ' is-danger' : ''}`}
                style={{ width: `${Math.max(0, Math.min(100, usedRatio))}%` }}
              />
            </div>
          </div>
        </div>
        {/* 下单主按钮的挂载点：放在账户概览下方（2026-11-06 船长令） */}
        <div className="ex-pro-side-cta" ref={setCtaSlot} />
      </aside>
    </div>
  )
}
