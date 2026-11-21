import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { ExchangeClient } from '../client'
import { ExchangeError } from '../errors'
import type { ToastFn } from '../../../pages/common'
import { amount, money } from '../format'
import { T, TF } from '../texts'

export type CashierMode = 'deposit' | 'withdraw'

const AMBIGUOUS_ERROR_CODES = new Set(['timeout', 'network_error', 'internal_error', 'malformed_response', 'server_error'])

function isAmbiguousFailure(err: unknown): boolean {
  return !(err instanceof ExchangeError) || AMBIGUOUS_ERROR_CODES.has(err.code)
}

const DEPOSIT_PRESETS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 1_000_000, label: T.cashierPreset1m },
  { value: 5_000_000, label: T.cashierPreset5m },
  { value: 10_000_000, label: T.cashierPreset10m },
  { value: 100_000_000, label: T.cashierPreset100m },
  { value: 1_000_000_000, label: T.cashierPreset1b },
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
  cash: number
  client: ExchangeClient
  localIsk: number
  onLocalDelta: (delta: number) => boolean
  onToast: ToastFn
  onClose: () => void
  onRefresh: () => void
}) {
  const [amountText, setAmountText] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const aliveRef = useRef(true)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [])

  const value = Number(amountText)
  const valid = Number.isSafeInteger(value) && value > 0
  const allCash = Math.floor(cash)
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
      onToast(T.cashierPendingMismatch, true)
      return
    }
    setBusy(true)
    const refresh = async (): Promise<void> => {
      await client.getAccount().catch(() => undefined)
      onRefresh()
    }
    void (async () => {
      try {
        if (mode === 'deposit') {
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
              onToast(T.cashierDepositPending, true)
              return
            }
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
              <>
                {DEPOSIT_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    className="ex-mini-btn"
                    disabled={busy}
                    onClick={() => setAmountText(String(preset.value))}
                  >
                    {preset.label}
                  </button>
                ))}
                {/* 「全部」：把本地钱包 ISK 全数入金（2026-11-16 船长令）；超过服务端单笔/日配额时由服务端拒绝并提示 */}
                <button
                  type="button"
                  className="ex-mini-btn is-accent"
                  disabled={busy || localIsk < 1}
                  onClick={() => setAmountText(localIsk > 0 ? String(Math.floor(localIsk)) : '')}
                >
                  {T.cashierAll}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="ex-mini-btn"
                  disabled={busy || allCash < 2}
                  onClick={() => setAmountText(allCash > 1 ? String(Math.floor(allCash * 0.5)) : '')}
                >
                  50%
                </button>
                <button
                  type="button"
                  className="ex-mini-btn is-accent"
                  disabled={busy || allCash < 1}
                  onClick={() => setAmountText(allCash > 0 ? String(allCash) : '')}
                >
                  {T.cashierAll}
                </button>
              </>
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
          {mode === 'withdraw' && value > cash ? (
            <div className="ex-cashier-warn is-warn">{TF.cashierExceedExchangeCash(money(cash))}</div>
          ) : mode === 'deposit' && value > localIsk ? (
            <div className="ex-cashier-warn is-warn">{TF.cashierExceedLocalWallet(money(localIsk))}</div>
          ) : null}
        </div>

        <div className="ex-modal-actions">
          <button type="button" className="ex-mini-btn" onClick={onClose}>
            {T.cashierCancel}
          </button>
          <button
            type="button"
            className="ex-primary ex-primary-small"
            data-sfx={mode === 'deposit' ? 'exchange-withdraw-confirm' : 'exchange-deposit-confirm'}
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
