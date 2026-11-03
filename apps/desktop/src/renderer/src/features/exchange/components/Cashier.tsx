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
import type { ToastFn } from '../../../pages/common'
import { amount, money } from '../format'
import { T, TF } from '../texts'

export type CashierMode = 'deposit' | 'withdraw'

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
  onToast,
  onClose,
  onRefresh,
}: {
  mode: CashierMode
  /** 当前交易所现金（出金「全部」用） */
  cash: number
  client: ExchangeClient
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

  const submit = (): void => {
    if (busy) return
    if (!valid) {
      onToast(T.cashierInvalidAmount, true)
      return
    }
    setBusy(true)
    const nonce = crypto.randomUUID()
    // 资金动作后补拉账户再刷新：联机客户端的现金缓存只在回合末推送，
    // 不补拉会让「入金成功但顶栏现金没变」看起来像没到账。
    const refresh = (): void => {
      void client
        .getAccount()
        .catch(() => undefined)
        .then(() => onRefresh())
    }
    const request =
      mode === 'deposit'
        ? client.deposit(value, nonce).then((result) => {
            onToast(TF.cashierDepositDone(amount(result.applied)))
            refresh()
          })
        : client.withdraw(value, nonce).then((result) => {
            onToast(TF.cashierWithdrawDone(amount(result.amount)))
            refresh()
          })
    void request
      .then(() => closeRef.current())
      .catch((err: unknown) => onToast(err instanceof Error ? err.message : String(err), true))
      .finally(() => {
        if (aliveRef.current) setBusy(false)
      })
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
            ) : null}
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
