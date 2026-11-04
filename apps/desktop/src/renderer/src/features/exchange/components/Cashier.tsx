/**
 * 入金 / 出金弹窗 —— 游戏钱包与券商账户之间的资金闸门。
 *
 * 为什么单独一个组件：两种模式只差标题、快捷金额与提示文案，弹层结构与请求链路完全相同；
 * 复用 `ex-modal*` / `ex-field` / `ex-quick-row` / `ex-mini-btn` / `ex-primary`，
 * 不另造一套视觉体系（「全部」按当前快照的交易所现金取值）。
 */
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { ExchangeClient } from '../client'
import { ExchangeError } from '../errors'
import type { ToastFn } from '../../../pages/common'
import { amount, money } from '../format'
import { T, TF } from '../texts'

export type CashierMode = 'deposit' | 'withdraw'

/** 结果未知（服务器可能已生效）的错误码：超时/网络/5xx/响应解析失败。 */
const AMBIGUOUS_ERROR_CODES = new Set(['timeout', 'network_error', 'internal_error', 'malformed_response', 'server_error'])

/** 业务明确拒绝才算「确定未生效」；其余一律按结果未知处理，避免钱两边都消失或双花。 */
function isAmbiguousFailure(err: unknown): boolean {
  return !(err instanceof ExchangeError) || AMBIGUOUS_ERROR_CODES.has(err.code)
}

/** 入金快捷档：整数信用点（上限定多少由服务器日配额决定，这里只给常用档） */
const DEPOSIT_PRESETS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1_000_000, label: T.cashierPreset1m },
  { value: 5_000_000, label: T.cashierPreset5m },
  { value: 10_000_000, label: T.cashierPreset10m },
]

export function Cashier({
  mode,
  cash,
  client,
  localIsk,
  onLocalDelta,
  onToast,
  onClose,
  onRefresh,
}: {
  mode: CashierMode
  /** 当前交易所现金（出金「全部」用） */
  cash: number
  client: ExchangeClient
  /** 本地存档钱包 ISK（入金扣款来源，显示在弹窗内） */
  localIsk: number
  /** 本地存档资金增减：入金传负、出金/退款传正；返回 false = 余额不足或非法 */
  onLocalDelta: (delta: number) => boolean
  onToast: ToastFn
  onClose: () => void
  /** 让页面重渲染一次（资金动作后刷新顶栏现金） */
  onRefresh: () => void
}) {
  const [amountText, setAmountText] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  /** 请求回来时组件可能已关闭：卸载后不再 setState（toast 仍要弹） */
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  // Esc 关闭：挂在 window 上，焦点在哪都生效
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 打开即把焦点放到金额输入
  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [])

  const value = Number(amountText)
  const valid = Number.isSafeInteger(value) && value > 0
  const allCash = Math.floor(cash)
  /** 结果未知的流水记住 nonce：重试复用同一笔，服务端幂等不会重复入账/出金。 */
  const pendingDeposit = useRef<{ nonce: string; amount: number } | null>(null)
  const pendingWithdraw = useRef<{ nonce: string; amount: number } | null>(null)

  const submit = (): void => {
    if (busy) return
    if (!valid) {
      onToast(T.cashierInvalidAmount, true)
      return
    }
    const pendingRef = mode === 'deposit' ? pendingDeposit : pendingWithdraw
    if (pendingRef.current !== null && pendingRef.current.amount !== value) {
      // 上一笔结果未知时保持金额不变重试（同 nonce 幂等）；换金额会另开流水导致对不上账。
      onToast(T.cashierPendingMismatch, true)
      return
    }
    setBusy(true)
    // 资金动作后补拉账户再刷新：联机客户端的现金缓存只在回合末推送，
    // 不补拉会让「入金成功但顶栏现金没变」看起来像没到账。
    const refresh = async (): Promise<void> => {
      await client.getAccount().catch(() => undefined)
      onRefresh()
    }
    void (async () => {
      try {
        if (mode === 'deposit') {
          // 船长定案：存档币以本地为准——先从本地存档扣 ISK，服务器只记交易所账。
          const replay = pendingDeposit.current !== null
          if (!replay && !onLocalDelta(-value)) {
            onToast(T.cashierLocalInsufficient, true)
            return
          }
          const nonce = pendingDeposit.current?.nonce ?? crypto.randomUUID()
          if (!replay) pendingDeposit.current = { nonce, amount: value }
          try {
            const result = await client.deposit(value, nonce)
            pendingDeposit.current = null
            onToast(TF.cashierDepositDone(amount(result.applied)))
          } catch (err) {
            if (isAmbiguousFailure(err)) {
              // 结果未知：保留本地扣款与同一 nonce，提示原样重试（服务端按 nonce 幂等）。
              onToast(T.cashierDepositPending, true)
              return
            }
            // 服务器明确拒绝：退回本地扣款，避免钱两边都消失。
            if (pendingDeposit.current !== null) onLocalDelta(pendingDeposit.current.amount)
            pendingDeposit.current = null
            throw err
          }
        } else {
          const replay = pendingWithdraw.current !== null
          const nonce = pendingWithdraw.current?.nonce ?? crypto.randomUUID()
          if (!replay) pendingWithdraw.current = { nonce, amount: value }
          try {
            const result = await client.withdraw(value, nonce)
            pendingWithdraw.current = null
            const credited =
              Number.isFinite(result.amount) && result.amount > 0 ? onLocalDelta(result.amount) : false
            if (!credited) {
              // 服务器已出金但本地加不回来：明确告警，不能让玩家以为钱没丢而重复出金。
              onToast(T.cashierWithdrawLocalFail, true)
              return
            }
            onToast(TF.cashierWithdrawDone(amount(result.amount)))
          } catch (err) {
            if (isAmbiguousFailure(err)) {
              onToast(T.cashierWithdrawPending, true)
              return
            }
            pendingWithdraw.current = null
            throw err
          }
        }
        await refresh()
        closeRef.current()
      } catch (err) {
        onToast(err instanceof Error ? err.message : String(err), true)
      } finally {
        if (aliveRef.current) setBusy(false)
      }
    })()
  }

  // 焦点在按钮上时 Enter 交给按钮自己（避免一次 Enter 触发两次）
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Enter') return
    if (event.target instanceof HTMLButtonElement) return
    event.preventDefault()
    submit()
  }

  const title = mode === 'deposit' ? T.cashierDepositTitle : T.cashierWithdrawTitle
  const hint = mode === 'deposit' ? T.cashierDepositHint : T.cashierWithdrawHint
  const confirmLabel = mode === 'deposit' ? T.cashierConfirmDeposit : T.cashierConfirmWithdraw

  return (
    <div
      className="ex-modal-mask"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div className="ex-modal" onClick={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <h4 className="ex-modal-title">{title}</h4>
        <p className="ex-modal-text">{hint}</p>

        <div className="ex-field">
          <label className="ex-label" htmlFor="ex-cashier-amount">
            {T.cashierAmount}
          </label>
          <input
            id="ex-cashier-amount"
            ref={inputRef}
            className="ex-input ex-num"
            inputMode="numeric"
            maxLength={15}
            placeholder="0"
            value={amountText}
            disabled={busy}
            onChange={(e) => setAmountText(e.target.value.replace(/\D/g, ''))}
          />
          <div className="ex-quick-row">
            {mode === 'deposit' ? (
              DEPOSIT_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  className="ex-mini-btn"
                  disabled={busy}
                  onClick={() => setAmountText(String(preset.value))}
                >
                  {preset.label}
                </button>
              ))
            ) : (
              <button
                type="button"
                className="ex-mini-btn is-accent"
                disabled={busy || allCash < 1}
                onClick={() => setAmountText(allCash > 0 ? String(allCash) : '')}
              >
                {T.cashierAll}
              </button>
            )}
            {mode === 'withdraw' ? (
              <span className="ex-dim">
                {T.cashierExchangeCash}：{money(cash)}
              </span>
            ) : (
              <span className="ex-dim">
                {T.cashierLocalWallet}：{money(localIsk)}
              </span>
            )}
          </div>
        </div>

        <div className="ex-modal-actions">
          <button type="button" className="ex-mini-btn" onClick={onClose}>
            {T.cashierCancel}
          </button>
          <button
            type="button"
            className="ex-primary ex-primary-small"
            disabled={busy}
            onClick={submit}
          >
            {busy ? T.cashierSubmitting : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
