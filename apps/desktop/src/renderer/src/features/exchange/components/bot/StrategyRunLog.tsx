import type { StrategySpec } from '../../client'
import { tr } from '../../../../i18n/locale'
import { amount } from '../../format'
import { T } from '../../texts'

function eventText(status: string, reason: string): string {
  if (status === 'filled') return tr('ui.exchange.011')
  if (status === 'cancelled' || status === 'expired') return tr('ui.exchange.012')
  if (status === 'queued' || status === 'triggered') return tr('ui.exchange.013')
  if (reason === 'order_quota_exceeded') return tr('ui.exchange.014')
  if (reason === 'insufficient_cash' || reason === 'insufficient_margin') return tr('ui.exchange.015')
  if (reason === 'insufficient_position' || reason === 'no_holding') return tr('ui.exchange.016')
  if (reason === 'tracking_high') return tr('ui.exchange.017')
  if (reason === 'completed') return tr('ui.exchange.018')
  if (reason === 'out_of_range') return tr('ui.exchange.019')
  if (reason === 'invalid_params' || reason === 'amount_too_small') return tr('ui.exchange.020')
  if (status === 'skipped') return tr('ui.exchange.021')
  return tr('ui.exchange.009')
}

export function StrategyRunLog({ spec }: { spec: StrategySpec }) {
  const events = spec.runtime?.events ?? []
  return <div className="ex-strategy-events" aria-label={tr('ui.exchange.008')}>
    <b>{tr('ui.exchange.008')}</b>
    {events.length === 0 ? <p className="ex-dim">{tr('ui.exchange.009')}</p> : events.map((event, index) => (
      <div className="ex-strategy-event" key={event.ts + ':' + index}>
        <span className="ex-num">{new Date(event.ts).toLocaleTimeString()}</span>
        <span>{eventText(event.status, event.reason)}</span>
        <span className="ex-num">{event.qty ? (event.side === 'sell' ? T.sell : T.buy) + ' ' + amount(event.filledQty ?? 0) + '/' + amount(event.qty) : '—'}</span>
      </div>
    ))}
  </div>
}
