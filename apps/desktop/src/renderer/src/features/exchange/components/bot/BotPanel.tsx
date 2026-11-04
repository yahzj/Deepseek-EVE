import { isEn } from '../../../../i18n/locale'
/**
 * 自动量化交易机器人面板（网格 / 定投 / 移动止盈）。
 *
 * 包含：
 * 1. 网格区间与市价位置可视化（下限、市价游标、上限、套利密度刻度线）；
 * 2. 策略表单前置拦截（价格逻辑、格数 2~50、资金充足性、失焦即时红框提示）；
 * 3. 启停按钮语义与科技紫微光动效，终止并撤单二次确认机制；
 * 4. 运行中策略状态卡片（呼吸灯、套利次数、已实现利润、年化收益率与等宽数字）。
 */
import { useEffect, useId, useMemo, useState } from 'react'
import {
  Add,
  ChevronDown,
  ChevronRight,
  Information,
  Pause,
  Play,
  TrashCan,
  WarningAlt,
} from '@carbon/icons-react'
import type { ExchangeClient, ExchangeSnapshot, StrategySpec } from '../../client'
import type { ToastFn } from '../../../../pages/common'
import { amount } from '../../format'
import { T } from '../../texts'

export type BotTemplate = 'dca' | 'grid' | 'trailing_tp'

export interface BotPanelProps {
  client: ExchangeClient
  snap: ExchangeSnapshot
  code: string
  onToast: ToastFn
  alwaysOpen?: boolean
}

const TEMPLATES: Array<{ key: BotTemplate; label: string }> = [
  { key: 'grid', label: T.strategyGrid },
  { key: 'dca', label: T.strategyDca },
  { key: 'trailing_tp', label: T.strategyTrailingTp },
]

function templateLabel(template: StrategySpec['template']): string {
  if (template === 'dca') return T.strategyDca
  if (template === 'grid') return T.strategyGrid
  if (template === 'trailing_tp') return T.strategyTrailingTp
  return template
}

/** 格式化货币或价格 */
function formatNum(val: number, decimals = 2): string {
  if (!Number.isFinite(val)) return '0.00'
  return val.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/** 网格区间与市价位置可视化组件 */
function GridVisualizer({
  lowerPrice,
  upperPrice,
  currentPrice,
  grids,
}: {
  lowerPrice: number
  upperPrice: number
  currentPrice: number
  grids: number
}) {
  const isValidRange = Number.isFinite(lowerPrice) && Number.isFinite(upperPrice) && upperPrice > lowerPrice && lowerPrice > 0
  const cur = currentPrice > 0 ? currentPrice : lowerPrice

  // 计算市价在网格区间的百分比位置
  const span = isValidRange ? upperPrice - lowerPrice : 1
  const rawPos = isValidRange ? ((cur - lowerPrice) / span) * 100 : 50
  const clampedPos = Math.max(0, Math.min(100, rawPos))
  const isBelow = cur < lowerPrice
  const isAbove = cur > upperPrice

  // 与现价的偏离百分比
  const lowerDiffPct = cur > 0 ? ((lowerPrice - cur) / cur) * 100 : 0
  const upperDiffPct = cur > 0 ? ((upperPrice - cur) / cur) * 100 : 0

  // 单格间距与单格理论利润
  const validGrids = Math.max(2, Math.min(50, Math.round(grids) || 4))
  const stepPrice = span / validGrids
  const stepPct = lowerPrice > 0 ? (stepPrice / lowerPrice) * 100 : 0
  const estProfitPerGrid = Math.max(0, stepPct * 0.98) // 扣除预估交易摩擦

  // 生成网格线分布 (显示密度感，最多渲染 30 根以防视觉过密)
  const lineCount = Math.min(validGrids, 30)
  const gridLines = useMemo(() => {
    const lines: number[] = []
    for (let i = 1; i < lineCount; i++) {
      lines.push((i / lineCount) * 100)
    }
    return lines
  }, [lineCount])

  return (
    <div className="ex-bot-viz" aria-label="网格区间与市价相对位置">
      <div className="ex-bot-viz-head">
        <div className="ex-bot-viz-bound is-lower">
          <span className="ex-bot-viz-lbl">{T.strategyLower}</span>
          <span className="ex-bot-viz-val font-mono">{formatNum(lowerPrice)}</span>
          <span className="ex-bot-viz-pct font-mono">
            {lowerDiffPct >= 0 ? `+${lowerDiffPct.toFixed(1)}%` : `${lowerDiffPct.toFixed(1)}%`}
          </span>
        </div>

        <div className="ex-bot-viz-cur-block">
          <span className="ex-bot-viz-lbl">{T.colPrice}</span>
          <span className="ex-bot-viz-cur font-mono">{formatNum(cur)}</span>
          <span
            className={`ex-bot-viz-badge ${
              isBelow ? 'is-warn' : isAbove ? 'is-danger' : 'is-normal'
            }`}
          >
            {isBelow ? T.botStatusWaiting : isAbove ? T.botStatusOut : T.botStatusRunning}
          </span>
        </div>

        <div className="ex-bot-viz-bound is-upper">
          <span className="ex-bot-viz-lbl">{T.strategyUpper}</span>
          <span className="ex-bot-viz-val font-mono">{formatNum(upperPrice)}</span>
          <span className="ex-bot-viz-pct font-mono">
            {upperDiffPct >= 0 ? `+${upperDiffPct.toFixed(1)}%` : `${upperDiffPct.toFixed(1)}%`}
          </span>
        </div>
      </div>

      {/* 视觉刻度轨 */}
      <div className="ex-bot-track-container">
        <div className="ex-bot-track">
          {/* 网格刻度线体现套利密度 */}
          {gridLines.map((pct, idx) => (
            <div key={idx} className="ex-bot-grid-tick" style={{ left: `${pct}%` }} />
          ))}

          {/* 当前市价位置游标 */}
          <div
            className={`ex-bot-pin ${isBelow ? 'is-left' : isAbove ? 'is-right' : 'is-mid'}`}
            style={{ left: `${clampedPos}%` }}
            title={`${T.colPrice}: ${formatNum(cur)} ${T.creditUnit} (${clampedPos.toFixed(1)}%)`}
          >
            <div className="ex-bot-pin-line" />
            <div className="ex-bot-pin-head" />
          </div>
        </div>
      </div>

      {/* 底部指标概览 */}
      <div className="ex-bot-viz-foot">
        <span className="ex-bot-stat-pill">
          {T.botDensity}: <b className="font-mono">{validGrids} {isEn() ? 'grids' : '格'}</b>
        </span>
        <span className="ex-bot-stat-pill">
          {T.botStepDiff}: <b className="font-mono">{formatNum(stepPrice)} {T.creditUnit}</b>
        </span>
        <span className="ex-bot-stat-pill">
          {T.botEstNetProfit}: <b className="font-mono">{estProfitPerGrid.toFixed(2)}%</b>
        </span>
      </div>
    </div>
  )
}

/** 运行中策略状态卡片组件 */
function StrategyCardItem({
  spec,
  currentPrice,
  onToggle,
  onDelete,
}: {
  spec: StrategySpec
  currentPrice: number
  onToggle: (spec: StrategySpec) => void
  onDelete: (spec: StrategySpec) => void
}) {
  const [confirmStop, setConfirmStop] = useState(false)
  const p = spec.params

  // 3.5秒自动解除二次确认警示状态
  useEffect(() => {
    if (!confirmStop) return
    const timer = setTimeout(() => setConfirmStop(false), 3500)
    return () => clearTimeout(timer)
  }, [confirmStop])

  // 提取网格参数与估算指标
  const isGrid = spec.template === 'grid'
  const isDca = spec.template === 'dca'
  const isTp = spec.template === 'trailing_tp'

  const grids = Math.round(Number(p.grids ?? 4))
  const qty = Number(p.qty ?? 100)
  const basePrice = Number(p.basePrice ?? currentPrice)
  const lowerPct = Number(p.lowerPct ?? -6)
  const upperPct = Number(p.upperPct ?? 6)
  const lowerPrice = Number(p.lowerPrice ?? (basePrice * (1 + lowerPct / 100)))
  const upperPrice = Number(p.upperPrice ?? (basePrice * (1 + upperPct / 100)))

  // 预估年化收益率与套利参数（等宽字体展示）
  const stepPct = grids > 0 ? (upperPct - lowerPct) / grids : 3
  const estApr = Math.max(0, stepPct * 52 * 0.85).toFixed(1)
  const tradeMatches = Number(p.matchedCount ?? 0)
  const realizedProfit = Number(p.realizedProfit ?? 0)

  return (
    <div className={`ex-bot-card${spec.enabled ? ' is-active' : ' is-idle'}`}>
      <div className="ex-bot-card-top">
        <div className="ex-bot-status-group">
          <span className={`ex-bot-pulse-dot ${spec.enabled ? 'is-running' : 'is-paused'}`} />
          <span className="ex-bot-status-text">
            {spec.enabled ? T.strategyEnabled : T.strategyDisabled}
          </span>
          <span className="ex-bot-badge-tag">{templateLabel(spec.template)}</span>
        </div>

        <div className="ex-bot-card-actions">
          <button
            type="button"
            className={`ex-bot-action-btn ${spec.enabled ? 'is-pause' : 'is-resume'}`}
            onClick={() => onToggle(spec)}
            title={spec.enabled ? T.strategyPauseAction : T.strategyResumeAction}
          >
            {spec.enabled ? (
              <>
                <Pause size={12} /> {T.strategyPauseAction}
              </>
            ) : (
              <>
                <Play size={12} /> {T.strategyResumeAction}
              </>
            )}
          </button>

          <button
            type="button"
            className={`ex-bot-action-btn is-stop${confirmStop ? ' is-confirming' : ''}`}
            onClick={() => {
              if (confirmStop) {
                onDelete(spec)
                setConfirmStop(false)
              } else {
                setConfirmStop(true)
              }
            }}
            title={confirmStop ? T.strategyStopConfirm : T.strategyStopAction}
          >
            {confirmStop ? (
              <>
                <WarningAlt size={12} /> {T.strategyStopConfirm}
              </>
            ) : (
              <>
                <TrashCan size={12} /> {T.strategyStopAction}
              </>
            )}
          </button>
        </div>
      </div>

      {/* 核心指标展示（全量等宽字体） */}
      <div className="ex-bot-card-metrics">
        {isGrid ? (
          <>
            <div className="ex-bot-metric-col">
              <span className="ex-bot-metric-lbl">{T.botPriceRange}</span>
              <span className="ex-bot-metric-val font-mono">
                {formatNum(lowerPrice)} ~ {formatNum(upperPrice)}
              </span>
            </div>
            <div className="ex-bot-metric-col">
              <span className="ex-bot-metric-lbl">{T.botTradeMatches}</span>
              <span className="ex-bot-metric-val font-mono">{tradeMatches} {isEn() ? 'trades' : '笔'}</span>
            </div>
            <div className="ex-bot-metric-col">
              <span className="ex-bot-metric-lbl">{T.botRealizedProfit}</span>
              <span className="ex-bot-metric-val font-mono is-profit">
                +{formatNum(realizedProfit)} {T.creditUnit}
              </span>
            </div>
            <div className="ex-bot-metric-col">
              <span className="ex-bot-metric-lbl">{T.botEstApy}</span>
              <span className="ex-bot-metric-val font-mono is-apr">{estApr}%</span>
            </div>
          </>
        ) : null}

        {isDca ? (
          <>
            <div className="ex-bot-metric-col">
              <span className="ex-bot-metric-lbl">{T.strategyAmount}</span>
              <span className="ex-bot-metric-val font-mono">{amount(Number(p.amount ?? 0))} {T.creditUnit}</span>
            </div>
            <div className="ex-bot-metric-col">
              <span className="ex-bot-metric-lbl">{T.strategyInterval}</span>
              <span className="ex-bot-metric-val font-mono">{Math.round(Number(p.intervalSec ?? 0))} {isEn() ? 's' : '秒'}</span>
            </div>
            <div className="ex-bot-metric-col">
              <span className="ex-bot-metric-lbl">{T.botStatus}</span>
              <span className="ex-bot-metric-val font-mono">{T.botDcaRunning}</span>
            </div>
          </>
        ) : null}

        {isTp ? (
          <>
            <div className="ex-bot-metric-col">
              <span className="ex-bot-metric-lbl">{T.strategyActivate}</span>
              <span className="ex-bot-metric-val font-mono">+{Number(p.activatePct ?? 0)}%</span>
            </div>
            <div className="ex-bot-metric-col">
              <span className="ex-bot-metric-lbl">{T.strategyTrail}</span>
              <span className="ex-bot-metric-val font-mono">{Number(p.trailPct ?? 0)}%</span>
            </div>
            <div className="ex-bot-metric-col">
              <span className="ex-bot-metric-lbl">{T.strategyQty}</span>
              <span className="ex-bot-metric-val font-mono">{amount(qty)} {T.sharesSuffix}</span>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}

/** 核心自动量化交易机器人主面板 */
export function BotPanel({
  client,
  snap,
  code,
  onToast,
  alwaysOpen = false,
}: BotPanelProps) {
  const uniquePrefix = useId()
  const [open, setOpen] = useState(alwaysOpen)
  const [template, setTemplate] = useState<BotTemplate>('grid')
  const [busy, setBusy] = useState(false)

  // 标的信息与当前市价
  const stock = snap.stocks.find((s) => s.code === code)
  const currentPrice = stock?.price ?? 100
  const availableCash = snap.account?.cash ?? 0

  // 网格输入字段状态
  const [lowerPriceText, setLowerPriceText] = useState(() => (currentPrice * 0.94).toFixed(2))
  const [upperPriceText, setUpperPriceText] = useState(() => (currentPrice * 1.06).toFixed(2))
  const [gridsText, setGridsText] = useState('6')
  const [qtyText, setQtyText] = useState('100')

  // 定投输入字段状态
  const [dcaAmountText, setDcaAmountText] = useState('50000')
  const [dcaIntervalText, setDcaIntervalText] = useState('20')

  // 移动止盈输入字段状态
  const [tpActivateText, setTpActivateText] = useState('5')
  const [tpTrailText, setTpTrailText] = useState('2')
  const [tpQtyText, setTpQtyText] = useState('100')

  // 用户失焦标记字典 (touched)
  const [touched, setTouched] = useState<Record<string, boolean>>({})

  // 当标的切换时，如果下限/上限尚未被人工修改，自动平滑调整为当前标的的默认参考区间
  useEffect(() => {
    if (!touched.lowerPrice && !touched.upperPrice && currentPrice > 0) {
      setLowerPriceText((currentPrice * 0.94).toFixed(2))
      setUpperPriceText((currentPrice * 1.06).toFixed(2))
    }
  }, [code, currentPrice, touched.lowerPrice, touched.upperPrice])

  const markTouched = (field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }))
  }

  // 校验解析计算
  const numLower = Number(lowerPriceText)
  const numUpper = Number(upperPriceText)
  const numGrids = Math.round(Number(gridsText))
  const numQty = Math.round(Number(qtyText))

  // 网格单格金额与预估总投入资金
  const singleGridAmount = (currentPrice > 0 ? currentPrice : numLower) * numQty
  const estTotalGridInvestment = numGrids * singleGridAmount

  // 前置拦截校验字典
  const errors = useMemo(() => {
    const errs: Record<string, string> = {}
    if (template === 'grid') {
      if (!Number.isFinite(numLower) || numLower <= 0) {
        errs.lowerPrice = T.botGridErrLower
      }
      if (!Number.isFinite(numUpper) || numUpper <= 0) {
        errs.upperPrice = T.botGridErrUpper
      } else if (Number.isFinite(numLower) && numUpper <= numLower) {
        errs.upperPrice = T.botGridErrUpperGtLower
      }
      if (!Number.isFinite(numGrids) || numGrids < 2 || numGrids > 50) {
        errs.grids = T.botGridErrGrids
      }
      if (!Number.isFinite(numQty) || numQty < 1) {
        errs.qty = T.botGridErrQty
      }
      if (estTotalGridInvestment > availableCash) {
        errs.cash = isEn() ? `Est. total investment (${formatNum(estTotalGridInvestment)} Credits) exceeds available cash (${formatNum(availableCash)} Credits)` : `预估总投入 (${formatNum(estTotalGridInvestment)} {T.creditUnit}) 超出可用资金 (${formatNum(availableCash)} 信用点)`
      }
    } else if (template === 'dca') {
      const amt = Number(dcaAmountText)
      const intv = Number(dcaIntervalText)
      if (!Number.isFinite(amt) || amt <= 0) {
        errs.dcaAmount = T.botDcaErrAmount
      } else if (amt > availableCash) {
        errs.dcaAmount = isEn() ? `DCA amount exceeds available cash (${formatNum(availableCash)} Credits)` : `定投金额超出当前可用资金 (${formatNum(availableCash)} 信用点)`
      }
      if (!Number.isFinite(intv) || intv < 3) {
        errs.dcaInterval = T.botDcaErrInterval
      }
    } else {
      const act = Number(tpActivateText)
      const tr = Number(tpTrailText)
      const q = Math.round(Number(tpQtyText))
      if (!Number.isFinite(act) || act <= 0) {
        errs.tpActivate = T.botTpErrActivate
      }
      if (!Number.isFinite(tr) || tr <= 0) {
        errs.tpTrail = T.botTpErrTrail
      } else if (Number.isFinite(act) && tr >= act) {
        errs.tpTrail = T.botTpErrTrailLt
      }
      if (!Number.isFinite(q) || q < 1) {
        errs.tpQty = T.botTpErrQty
      }
    }
    return errs
  }, [
    template,
    numLower,
    numUpper,
    numGrids,
    numQty,
    estTotalGridInvestment,
    availableCash,
    dcaAmountText,
    dcaIntervalText,
    tpActivateText,
    tpTrailText,
    tpQtyText,
  ])

  // 构建向后兼容的后端策略参数
  const buildSpec = (): StrategySpec => {
    const params: Record<string, number> = {}
    if (template === 'grid') {
      const base = currentPrice > 0 ? currentPrice : (numLower + numUpper) / 2
      const lowerPct = ((numLower - base) / base) * 100
      const upperPct = ((numUpper - base) / base) * 100

      params.basePrice = Number(base.toFixed(2))
      params.lowerPct = Number(lowerPct.toFixed(2))
      params.upperPct = Number(upperPct.toFixed(2))
      params.lowerPrice = numLower
      params.upperPrice = numUpper
      params.grids = numGrids
      params.qty = numQty
    } else if (template === 'dca') {
      params.amount = Number(dcaAmountText)
      params.intervalSec = Number(dcaIntervalText)
    } else {
      params.activatePct = Number(tpActivateText)
      params.trailPct = Number(tpTrailText)
      params.qty = Number(tpQtyText)
    }
    return { template, code, params, enabled: true }
  }

  // 部署策略
  const handleDeploy = (): void => {
    // 标记全部字段为 touched 以便即时展示红框与错误
    setTouched({
      lowerPrice: true,
      upperPrice: true,
      grids: true,
      qty: true,
      dcaAmount: true,
      dcaInterval: true,
      tpActivate: true,
      tpTrail: true,
      tpQty: true,
    })

    const errorKeys = Object.keys(errors)
    if (errorKeys.length > 0) {
      onToast(errors[errorKeys[0]], true)
      return
    }

    setBusy(true)
    void client
      .saveStrategy(buildSpec())
      .then(() => onToast(T.toastStrategySaved))
      .catch((err: unknown) => onToast(err instanceof Error ? err.message : String(err), true))
      .finally(() => setBusy(false))
  }

  const handleToggle = (spec: StrategySpec): void => {
    if (!spec.id) return
    void client
      .saveStrategy({ ...spec, enabled: !spec.enabled })
      .catch((err: unknown) => onToast(err instanceof Error ? err.message : String(err), true))
  }

  const handleDelete = (spec: StrategySpec): void => {
    if (!spec.id) return
    void client
      .deleteStrategy(spec.id)
      .then(() => onToast(T.toastStrategyDeleted))
      .catch((err: unknown) => onToast(err instanceof Error ? err.message : String(err), true))
  }

  const strategies = snap.strategies.filter((s) => s.code === code)

  const deployButtonLabel =
    template === 'grid'
      ? T.strategyDeployGrid
      : template === 'dca'
      ? T.strategyDeployDca
      : T.strategyDeployTrailingTp

  return (
    <section className={`ex-panel ex-auto ex-bot-panel${open ? ' is-open' : ''}`} aria-label={T.autoTradeTitle}>
      <button
        type="button"
        className="ex-auto-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="ex-auto-caret">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span className="ex-panel-title">{T.autoTradeTitle}</span>
        <span className="ex-dim">{T.autoTradeHint}</span>
      </button>

      {open ? (
        <div className="ex-auto-body ex-bot-body">
          {/* 已运行的策略列表卡片 */}
          <div className="ex-bot-list">
            {strategies.length === 0 ? (
              <div className="ex-empty">{T.autoTradeEmpty}</div>
            ) : (
              strategies.map((s) => (
                <StrategyCardItem
                  key={s.id}
                  spec={s}
                  currentPrice={currentPrice}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                />
              ))
            )}
          </div>

          {/* 新建策略表单 */}
          <div className="ex-bot-form-container">
            <div className="ex-bot-form-title-row">
              <h4 className="ex-subtitle">{T.strategyCreateTitle}</h4>
              <span className="ex-bot-cash-hint">
                {T.strategyAvailCash}: <b className="font-mono">{formatNum(availableCash)} {T.creditUnit}</b>
              </span>
            </div>

            {/* 模板切换 Tab */}
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

            {/* 网格策略表单与可视化 */}
            {template === 'grid' ? (
              <div className="ex-bot-grid-form">
                <div className="ex-form-grid">
                  <label className="ex-field" htmlFor={`${uniquePrefix}-lower`}>
                    <span className="ex-label">{T.strategyLower} ({T.creditUnit})</span>
                    <input
                      id={`${uniquePrefix}-lower`}
                      className={`ex-input ex-num${touched.lowerPrice && errors.lowerPrice ? ' has-error' : ''}`}
                      inputMode="decimal"
                      value={lowerPriceText}
                      onChange={(e) => setLowerPriceText(e.target.value)}
                      onBlur={() => markTouched('lowerPrice')}
                    />
                    {touched.lowerPrice && errors.lowerPrice ? (
                      <span className="ex-field-error">{errors.lowerPrice}</span>
                    ) : null}
                  </label>

                  <label className="ex-field" htmlFor={`${uniquePrefix}-upper`}>
                    <span className="ex-label">{T.strategyUpper} ({T.creditUnit})</span>
                    <input
                      id={`${uniquePrefix}-upper`}
                      className={`ex-input ex-num${touched.upperPrice && errors.upperPrice ? ' has-error' : ''}`}
                      inputMode="decimal"
                      value={upperPriceText}
                      onChange={(e) => setUpperPriceText(e.target.value)}
                      onBlur={() => markTouched('upperPrice')}
                    />
                    {touched.upperPrice && errors.upperPrice ? (
                      <span className="ex-field-error">{errors.upperPrice}</span>
                    ) : null}
                  </label>

                  <label className="ex-field" htmlFor={`${uniquePrefix}-grids`}>
                    <span className="ex-label">{T.strategyGrids} {isEn() ? '(2~50)' : '(2~50格)'}</span>
                    <input
                      id={`${uniquePrefix}-grids`}
                      className={`ex-input ex-num${touched.grids && errors.grids ? ' has-error' : ''}`}
                      inputMode="numeric"
                      value={gridsText}
                      onChange={(e) => setGridsText(e.target.value)}
                      onBlur={() => markTouched('grids')}
                    />
                    {touched.grids && errors.grids ? (
                      <span className="ex-field-error">{errors.grids}</span>
                    ) : null}
                  </label>

                  <label className="ex-field" htmlFor={`${uniquePrefix}-qty`}>
                    <span className="ex-label">{T.strategyQty} {isEn() ? '(shs/grid)' : '(股/格)'}</span>
                    <input
                      id={`${uniquePrefix}-qty`}
                      className={`ex-input ex-num${touched.qty && errors.qty ? ' has-error' : ''}`}
                      inputMode="numeric"
                      value={qtyText}
                      onChange={(e) => setQtyText(e.target.value)}
                      onBlur={() => markTouched('qty')}
                    />
                    {touched.qty && errors.qty ? (
                      <span className="ex-field-error">{errors.qty}</span>
                    ) : null}
                  </label>
                </div>

                {/* 网格资金与投资预估前置提示 */}
                <div className={`ex-bot-fund-info${errors.cash ? ' is-error' : ''}`}>
                  <div className="ex-bot-fund-row">
                    <span className="ex-dim">
                      <Information size={12} /> {T.strategySingleGrid}:
                    </span>
                    <span className="font-mono">{formatNum(singleGridAmount)} {T.creditUnit}</span>
                  </div>
                  <div className="ex-bot-fund-row">
                    <span className="ex-dim">{T.strategyEstTotal}:</span>
                    <span className={`font-mono${errors.cash ? ' is-cash-overflow' : ''}`}>
                      {formatNum(estTotalGridInvestment)} {T.creditUnit}
                    </span>
                  </div>
                  {errors.cash ? <div className="ex-field-error">{errors.cash}</div> : null}
                </div>

                {/* 网格区间与市价位置可视化微型进度条 */}
                <GridVisualizer
                  lowerPrice={numLower}
                  upperPrice={numUpper}
                  currentPrice={currentPrice}
                  grids={numGrids}
                />
              </div>
            ) : null}

            {/* 定投策略表单 */}
            {template === 'dca' ? (
              <div className="ex-form-grid">
                <label className="ex-field" htmlFor={`${uniquePrefix}-dca-amt`}>
                  <span className="ex-label">{T.strategyAmount} ({T.creditUnit})</span>
                  <input
                    id={`${uniquePrefix}-dca-amt`}
                    className={`ex-input ex-num${touched.dcaAmount && errors.dcaAmount ? ' has-error' : ''}`}
                    inputMode="decimal"
                    value={dcaAmountText}
                    onChange={(e) => setDcaAmountText(e.target.value)}
                    onBlur={() => markTouched('dcaAmount')}
                  />
                  {touched.dcaAmount && errors.dcaAmount ? (
                    <span className="ex-field-error">{errors.dcaAmount}</span>
                  ) : null}
                </label>

                <label className="ex-field" htmlFor={`${uniquePrefix}-dca-int`}>
                  <span className="ex-label">{T.strategyInterval} {isEn() ? '(≥3s)' : '(≥3秒)'}</span>
                  <input
                    id={`${uniquePrefix}-dca-int`}
                    className={`ex-input ex-num${touched.dcaInterval && errors.dcaInterval ? ' has-error' : ''}`}
                    inputMode="numeric"
                    value={dcaIntervalText}
                    onChange={(e) => setDcaIntervalText(e.target.value)}
                    onBlur={() => markTouched('dcaInterval')}
                  />
                  {touched.dcaInterval && errors.dcaInterval ? (
                    <span className="ex-field-error">{errors.dcaInterval}</span>
                  ) : null}
                </label>
              </div>
            ) : null}

            {/* 移动止盈策略表单 */}
            {template === 'trailing_tp' ? (
              <div className="ex-form-grid">
                <label className="ex-field" htmlFor={`${uniquePrefix}-tp-act`}>
                  <span className="ex-label">{T.strategyActivate} (%)</span>
                  <input
                    id={`${uniquePrefix}-tp-act`}
                    className={`ex-input ex-num${touched.tpActivate && errors.tpActivate ? ' has-error' : ''}`}
                    inputMode="decimal"
                    value={tpActivateText}
                    onChange={(e) => setTpActivateText(e.target.value)}
                    onBlur={() => markTouched('tpActivate')}
                  />
                  {touched.tpActivate && errors.tpActivate ? (
                    <span className="ex-field-error">{errors.tpActivate}</span>
                  ) : null}
                </label>

                <label className="ex-field" htmlFor={`${uniquePrefix}-tp-tr`}>
                  <span className="ex-label">{T.strategyTrail} (%)</span>
                  <input
                    id={`${uniquePrefix}-tp-tr`}
                    className={`ex-input ex-num${touched.tpTrail && errors.tpTrail ? ' has-error' : ''}`}
                    inputMode="decimal"
                    value={tpTrailText}
                    onChange={(e) => setTpTrailText(e.target.value)}
                    onBlur={() => markTouched('tpTrail')}
                  />
                  {touched.tpTrail && errors.tpTrail ? (
                    <span className="ex-field-error">{errors.tpTrail}</span>
                  ) : null}
                </label>

                <label className="ex-field" htmlFor={`${uniquePrefix}-tp-qty`}>
                  <span className="ex-label">{T.strategyQty} ({T.sharesSuffix})</span>
                  <input
                    id={`${uniquePrefix}-tp-qty`}
                    className={`ex-input ex-num${touched.tpQty && errors.tpQty ? ' has-error' : ''}`}
                    inputMode="numeric"
                    value={tpQtyText}
                    onChange={(e) => setTpQtyText(e.target.value)}
                    onBlur={() => markTouched('tpQty')}
                  />
                  {touched.tpQty && errors.tpQty ? (
                    <span className="ex-field-error">{errors.tpQty}</span>
                  ) : null}
                </label>
              </div>
            ) : null}

            {/* 科技紫高光微光部署按钮 */}
            <button
              type="button"
              className="ex-primary ex-primary-small is-algo ex-bot-deploy-btn"
              onClick={handleDeploy}
              disabled={busy}
            >
              <Add size={14} /> {deployButtonLabel}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
