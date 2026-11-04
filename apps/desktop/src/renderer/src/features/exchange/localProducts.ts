/**
 * 极简模式的「保底产品」本地实现（船长 2026-11-04 定案）：
 * - 债券：固定收益，按分钟本地计息，不上服务器；本金来自本地存档 ISK（入金前从存档扣）。
 * - 基金：不在本文件——基金是放置型持仓（按真实分钟结算），走 `client.getFundPosition()/openFund()/redeemFund()`。
 *
 * 存档币本地为准，作弊不设防；本地产品只影响本地存档，不碰服务器交易所现金。
 */
import type { BondHolding } from './client'
import type { GameEngine } from '../../game/engine'

/** 债券分钟利率（0.0003 = 每 60 秒 0.03%，与 Mock 的「游戏内 60 秒 = 1 日」口径一致） */
export const LOCAL_BOND_MINUTE_RATE = 0.0003
export const LOCAL_BOND_RATE_BP = 3
const BOND_STORAGE_KEY = 'whale-idle:exch-bond-local:v1'
const MINUTE_MS = 60_000

interface LocalBondState {
  principal: number
  startedAt: number
}

function readState(): LocalBondState | null {
  try {
    const raw = localStorage.getItem(BOND_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<LocalBondState>
    const principal = Number(parsed.principal)
    const startedAt = Number(parsed.startedAt)
    if (!Number.isFinite(principal) || principal <= 0) return null
    if (!Number.isFinite(startedAt) || startedAt <= 0) return null
    return { principal, startedAt }
  } catch {
    return null
  }
}

function writeState(state: LocalBondState | null): boolean {
  try {
    if (state === null) localStorage.removeItem(BOND_STORAGE_KEY)
    else localStorage.setItem(BOND_STORAGE_KEY, JSON.stringify(state))
    return true
  } catch {
    // 返回失败而不是静默吞掉：调用方必须回滚资金，否则会丢本金/重复赎回。
    return false
  }
}

/** 当前本地债券持仓视图（利息按分钟连续计算，不滚入本金）。 */
export function localBondHolding(now: number = Date.now()): BondHolding {
  const state = readState()
  if (state === null) {
    return { principal: 0, accrued: 0, purchasedAt: null, rateDaily: LOCAL_BOND_MINUTE_RATE }
  }
  const minutes = Math.max(0, (now - state.startedAt) / MINUTE_MS)
  const accrued = state.principal * LOCAL_BOND_MINUTE_RATE * minutes
  return {
    principal: state.principal,
    accrued,
    purchasedAt: state.startedAt,
    rateDaily: LOCAL_BOND_MINUTE_RATE,
  }
}

/** 买入本地债券：先从本地存档扣 ISK（引擎负责持久化与通知），再登记本金。 */
export function buyLocalBond(engine: GameEngine, amount: number): BondHolding {
  const value = Math.floor(amount)
  if (!(value > 0) || !Number.isSafeInteger(value)) throw new Error('请输入正整数金额')
  if (!engine.exchangeWalletDelta(-value)) throw new Error('本地存档信用点不足')
  const prev = readState()
  const startedAt = prev?.startedAt ?? Date.now()
  const principal = (prev?.principal ?? 0) + value
  if (!writeState({ principal, startedAt })) {
    // 写盘失败：退回刚扣的 ISK，避免「钱扣了、持仓没登记」。
    engine.exchangeWalletDelta(value)
    throw new Error('本地存储不可用，债券购买未完成')
  }
  return localBondHolding()
}

/** 赎回本地债券：本息一次性加回本地存档 ISK，清空持仓。返回实际赎回总额。 */
export function redeemLocalBond(engine: GameEngine, now: number = Date.now()): number {
  const view = localBondHolding(now)
  const total = Math.floor(view.principal + view.accrued)
  if (total <= 0) return 0
  // 先入账成功再清持仓；任何一步失败都回滚，避免丢本金或重复赎回。
  if (!engine.exchangeWalletDelta(total)) throw new Error('本地存档入账失败，请稍后重试')
  if (!writeState(null)) {
    engine.exchangeWalletDelta(-total)
    throw new Error('本地存储不可用，赎回未完成')
  }
  return total
}
