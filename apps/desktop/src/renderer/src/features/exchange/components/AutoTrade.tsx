/**
 * 自动交易折叠区（定投 / 网格 / 移动止盈）。
 *
 * 为什么要和手动面板同栏：设计稿要求「量化不是独立页面，而是同一右栏的折叠区」，
 * 策略单与手动单同一条下单链路，委托列表里只用一个小角标区分来源。
 */
import { useState } from 'react'
import type { ExchangeClient, ExchangeSnapshot, StrategySpec } from '../client'
import type { ToastFn } from '../../../pages/common'
import { amount } from '../format'
import { T } from '../texts'

type Template = 'dca' | 'grid' | 'trailing_tp'

const TEMPLATES: Array<{ key: Template; label: string }> = [
  { key: 'dca', label: T.strategyDca },
  { key: 'grid', label: T.strategyGrid },
  { key: 'trailing_tp', label: T.strategyTrailingTp },
]

function templateLabel(template: StrategySpec['template']): string {
  if (template === 'dca') return T.strategyDca
  if (template === 'grid') return T.strategyGrid
  if (template === 'trailing_tp') return T.strategyTrailingTp
  return template
}

function paramsSummary(spec: StrategySpec): string {
  const p = spec.params
  if (spec.template === 'dca') {
    return `${amount(Number(p.amount ?? 0))} cr / ${Math.round(Number(p.intervalSec ?? 0))} 秒`
  }
  if (spec.template === 'grid') {
    return `${Number(p.lowerPct ?? 0)}% ~ ${Number(p.upperPct ?? 0)}% · ${Math.round(Number(p.grids ?? 0))} 格 × ${amount(Number(p.qty ?? 0))} 股`
  }
  return `+${Number(p.activatePct ?? 0)}% 激活 / 回撤 ${Number(p.trailPct ?? 0)}%`
}

export function AutoTrade({
  client,
  snap,
  code,
  onToast,
}: {
  client: ExchangeClient
  snap: ExchangeSnapshot
  code: string
  onToast: ToastFn
}) {
  const [open, setOpen] = useState(false)
  const [template, setTemplate] = useState<Template>('dca')
  const [amountText, setAmountText] = useState('50000')
  const [intervalText, setIntervalText] = useState('20')
  const [lowerText, setLowerText] = useState('-6')
  const [upperText, setUpperText] = useState('6')
  const [gridsText, setGridsText] = useState('4')
  const [qtyText, setQtyText] = useState('100')
  const [activateText, setActivateText] = useState('3')
  const [trailText, setTrailText] = useState('1.5')
  const [busy, setBusy] = useState(false)

  const strategies = snap.strategies.filter((s) => s.code === code)

  const buildSpec = (): StrategySpec => {
    const params: Record<string, number> = {}
    if (template === 'dca') {
      params.amount = Number(amountText)
      params.intervalSec = Number(intervalText)
    } else if (template === 'grid') {
      params.lowerPct = Number(lowerText)
      params.upperPct = Number(upperText)
      params.grids = Number(gridsText)
      params.qty = Number(qtyText)
    } else {
      params.activatePct = Number(activateText)
      params.trailPct = Number(trailText)
      params.qty = Number(qtyText)
    }
    return { template, code, params, enabled: true }
  }

  const save = (): void => {
    setBusy(true)
    void client
      .saveStrategy(buildSpec())
      .then(() => onToast(T.toastStrategySaved))
      .catch((err: unknown) => onToast(err instanceof Error ? err.message : String(err), true))
      .finally(() => setBusy(false))
  }

  const toggle = (spec: StrategySpec): void => {
    if (!spec.id) return
    void client
      .saveStrategy({ ...spec, enabled: !spec.enabled })
      .catch((err: unknown) => onToast(err instanceof Error ? err.message : String(err), true))
  }

  const remove = (spec: StrategySpec): void => {
    if (!spec.id) return
    void client
      .deleteStrategy(spec.id)
      .then(() => onToast(T.toastStrategyDeleted))
      .catch((err: unknown) => onToast(err instanceof Error ? err.message : String(err), true))
  }

  return (
    <section className={`ex-panel ex-auto${open ? ' is-open' : ''}`} aria-label={T.autoTradeTitle}>
      <button type="button" className="ex-auto-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="ex-auto-caret">{open ? '▾' : '▸'}</span>
        <span className="ex-panel-title">{T.autoTradeTitle}</span>
        <span className="ex-dim">{T.autoTradeHint}</span>
      </button>
      {open ? (
        <div className="ex-auto-body">
          {strategies.length === 0 ? <div className="ex-empty">{T.autoTradeEmpty}</div> : null}
          {strategies.map((s) => (
            <div className="ex-strategy" key={s.id}>
              <div className="ex-strategy-main">
                <span className={`ex-badge${s.enabled ? ' is-on' : ''}`}>{s.enabled ? T.strategyEnabled : T.strategyDisabled}</span>
                <b>{templateLabel(s.template)}</b>
                <span className="ex-dim">{paramsSummary(s)}</span>
              </div>
              <div className="ex-strategy-actions">
                <button type="button" className="ex-mini-btn" onClick={() => toggle(s)}>
                  {s.enabled ? T.strategyDisabled : T.strategyEnabled}
                </button>
                <button type="button" className="ex-mini-btn" onClick={() => remove(s)}>
                  {T.strategyDelete}
                </button>
              </div>
            </div>
          ))}

          <div className="ex-strategy-form">
            <h4 className="ex-subtitle">{T.strategyCreateTitle}</h4>
            <div className="ex-seg ex-seg-wide" role="tablist" aria-label={T.strategyCreateTitle}>
              {TEMPLATES.map((t) => (
                <button
                  type="button"
                  key={t.key}
                  role="tab"
                  aria-selected={template === t.key}
                  className={`ex-seg-btn${template === t.key ? ' is-on' : ''}`}
                  onClick={() => setTemplate(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="ex-form-grid">
              {template === 'dca' ? (
                <>
                  <label className="ex-field">
                    <span className="ex-label">{T.strategyAmount}</span>
                    <input className="ex-input ex-num" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
                  </label>
                  <label className="ex-field">
                    <span className="ex-label">{T.strategyInterval}</span>
                    <input className="ex-input ex-num" inputMode="numeric" value={intervalText} onChange={(e) => setIntervalText(e.target.value)} />
                  </label>
                </>
              ) : null}
              {template === 'grid' ? (
                <>
                  <label className="ex-field">
                    <span className="ex-label">{T.strategyLower}</span>
                    <input className="ex-input ex-num" inputMode="decimal" value={lowerText} onChange={(e) => setLowerText(e.target.value)} />
                  </label>
                  <label className="ex-field">
                    <span className="ex-label">{T.strategyUpper}</span>
                    <input className="ex-input ex-num" inputMode="decimal" value={upperText} onChange={(e) => setUpperText(e.target.value)} />
                  </label>
                  <label className="ex-field">
                    <span className="ex-label">{T.strategyGrids}</span>
                    <input className="ex-input ex-num" inputMode="numeric" value={gridsText} onChange={(e) => setGridsText(e.target.value)} />
                  </label>
                  <label className="ex-field">
                    <span className="ex-label">{T.strategyQty}</span>
                    <input className="ex-input ex-num" inputMode="numeric" value={qtyText} onChange={(e) => setQtyText(e.target.value)} />
                  </label>
                </>
              ) : null}
              {template === 'trailing_tp' ? (
                <>
                  <label className="ex-field">
                    <span className="ex-label">{T.strategyActivate}</span>
                    <input className="ex-input ex-num" inputMode="decimal" value={activateText} onChange={(e) => setActivateText(e.target.value)} />
                  </label>
                  <label className="ex-field">
                    <span className="ex-label">{T.strategyTrail}</span>
                    <input className="ex-input ex-num" inputMode="decimal" value={trailText} onChange={(e) => setTrailText(e.target.value)} />
                  </label>
                  <label className="ex-field">
                    <span className="ex-label">{T.strategyQty}</span>
                    <input className="ex-input ex-num" inputMode="numeric" value={qtyText} onChange={(e) => setQtyText(e.target.value)} />
                  </label>
                </>
              ) : null}
            </div>
            <button type="button" className="ex-primary ex-primary-small" onClick={save} disabled={busy}>
              {T.strategySave}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
