/**
 * 专业模式 · 星舰战术交易终端主视图（ProExchange）。
 *
 * 核心升级（2026-11-03 船长令）：
 * - 聚焦核心玩法：重点强化「挂单与杠杆」及「自动量化交易」；
 * - 剔除枯燥繁琐的五档深度数字与逐笔流水，升级为直观醒目的「多空博弈张力槽」；
 * - 移除常驻底部的内滚流水窗，改为中栏二级 Tab 按需展开，K 线图开阔舒展并支持滚轮缩放；
 * - 中栏下半部承载「多空持仓作战席」与「历史流水」双 Tab 切换；
 * - 右侧拓宽为双核战术交易舱：大 Tab 一键切换【挂单&杠杆】与【智能量化策略】，满幅展开。
 */
import { useState } from 'react'
import { Bot, ChartCandlestick, Receipt, Target as Crosshair } from '@carbon/icons-react'
import type { ExchangeClient, ExchangeSnapshot } from '../client'
import type { ToastFn } from '../../../pages/common'
import { StockList } from './StockList'
import { MarketOverview } from './MarketOverview'
import { Chart } from './Chart'
import { TradePanel } from './TradePanel'
import { Positions } from './Positions'
import { AutoTrade } from './AutoTrade'
import { Records } from './Records'
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
  // 中栏下方标签页：当前多空持仓 vs 成交历史流水
  const [midTab, setMidTab] = useState<'positions' | 'records'>('positions')
  // 右栏战术交易舱标签页：限价/杠杆挂单 vs 自动量化交易
  const [rightTab, setRightTab] = useState<'trade' | 'auto'>('trade')

  const posCount = snap.account.positions.length + snap.account.holdings.length

  return (
    <div className="ex-grid ex-pro-grid">
      {/* 左栏：标的列表与市场战况仪表 */}
      <aside className="ex-col ex-col-left">
        <StockList client={client} snap={snap} selected={code} onSelect={onSelectCode} />
        <MarketOverview snap={snap} />
      </aside>

      {/* 中栏：全屏 K 线 + 多空张力能量槽 + 持仓/流水作战席 */}
      <section className="ex-col ex-col-mid ex-pro-col-mid">
        <div className="ex-pro-chart-wrap">
          <Chart client={client} code={code} quote={snap.quote} tick={snap.tick} />
        </div>

        {/* 多空博弈张力能量条 */}
        <MarketSentimentBar book={snap.book} />

        {/* 中栏下半部：持仓与委托作战席 / 成交明细二级切换 */}
        <div className="ex-pro-mid-bottom">
          <div className="ex-pro-mid-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={midTab === 'positions'}
              className={`ex-pro-mid-tab${midTab === 'positions' ? ' is-active' : ''}`}
              onClick={() => setMidTab('positions')}
            >
              <ChartCandlestick size={16} />
              <span>当前多空持仓与委托{posCount > 0 ? ` (${posCount})` : ''}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={midTab === 'records'}
              className={`ex-pro-mid-tab${midTab === 'records' ? ' is-active' : ''}`}
              onClick={() => setMidTab('records')}
            >
              <Receipt size={16} />
              <span>成交历史与流水</span>
            </button>
          </div>

          <div className="ex-pro-mid-panel">
            {midTab === 'positions' ? (
              <Positions client={client} snap={snap} code={code} onSelect={onSelectCode} onToast={onToast} />
            ) : (
              <Records client={client} snap={snap} onToast={onToast} />
            )}
          </div>
        </div>
      </section>

      {/* 右栏：双核战术交易舱（挂单杠杆 / 自动量化策略） */}
      <aside className="ex-col ex-col-right ex-pro-col-right">
        <div className="ex-pro-right-tabs" role="tablist" aria-label="战术交易舱">
          <button
            type="button"
            role="tab"
            aria-selected={rightTab === 'trade'}
            className={`ex-pro-right-tab${rightTab === 'trade' ? ' is-active' : ''}`}
            onClick={() => setRightTab('trade')}
          >
            <Crosshair size={16} />
            <span className="ex-pro-right-tab-title">挂单与杠杆</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={rightTab === 'auto'}
            className={`ex-pro-right-tab${rightTab === 'auto' ? ' is-active' : ''}`}
            onClick={() => setRightTab('auto')}
          >
            <Bot size={16} />
            <span className="ex-pro-right-tab-title">自动量化交易</span>
            {snap.strategies.length > 0 ? (
              <span className="ex-pro-right-tab-badge">{snap.strategies.length}</span>
            ) : null}
          </button>
        </div>

        <div className="ex-pro-right-body">
          {rightTab === 'trade' ? (
            <TradePanel client={client} snap={snap} code={code} pickedPrice={pickedPrice} onToast={onToast} />
          ) : (
            <AutoTrade client={client} snap={snap} code={code} onToast={onToast} alwaysOpen={true} />
          )}
        </div>
      </aside>
    </div>
  )
}
