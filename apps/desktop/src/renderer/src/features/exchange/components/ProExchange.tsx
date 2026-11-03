/**
 * 专业模式 · 全功能终端主视图（ProExchange）。
 *
 * 布局：
 * - 左栏：标的列表（StockList，全高舒展排列）；
 * - 中栏：专业多周期蜡烛图（Chart）+ 五档深度盘口（OrderBook，含买卖量不平衡条）+ 逐笔成交（TradeTape）；
 * - 右栏：2~50x 逐仓杠杆与限价下单面板（TradePanel）+ 持仓/委托（Positions）+ 量化网格/定投策略（AutoTrade）；
 * - 底部：成交历史与分红流水二级窗口（Records）。
 */
import type { ExchangeClient, ExchangeSnapshot } from '../client'
import type { ToastFn } from '../../../pages/common'
import { StockList } from './StockList'
import { Chart } from './Chart'
import { OrderBook, TradeTape } from './OrderBook'
import { TradePanel } from './TradePanel'
import { Positions } from './Positions'
import { AutoTrade } from './AutoTrade'
import { Records } from './Records'

interface ProExchangeProps {
  client: ExchangeClient
  snap: ExchangeSnapshot
  code: string
  pickedPrice: { value: number; seq: number } | null
  onSelectCode: (code: string) => void
  onPickPrice: (price: number) => void
  onToast: ToastFn
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
  return (
    <>
      <div className="ex-grid">
        <aside className="ex-col ex-col-left">
          <StockList snap={snap} selected={code} onSelect={onSelectCode} />
        </aside>

        <section className="ex-col ex-col-mid">
          <Chart client={client} code={code} quote={snap.quote} tick={snap.tick} />
          <div className="ex-mid-bottom">
            <OrderBook book={snap.book} onPickPrice={onPickPrice} />
            <TradeTape trades={snap.trades} />
          </div>
        </section>

        <aside className="ex-col ex-col-right">
          <TradePanel client={client} snap={snap} code={code} pickedPrice={pickedPrice} onToast={onToast} />
          <Positions client={client} snap={snap} code={code} onSelect={onSelectCode} onToast={onToast} />
          <AutoTrade client={client} snap={snap} code={code} onToast={onToast} />
        </aside>
      </div>

      <Records snap={snap} />
    </>
  )
}

