/**
 * **声望账本**（**2026-10-02 破环搬家**：原住 `expedition.ts`）。
 *
 * 为什么拆：`weekendBattle` 要读 `DSI_FACTION_ID` / `noteStandingEarned`，而 `expedition` 又要 import
 * `weekendBattle` 的结算函数 ⇒ `expedition ↔ weekendBattle` 互相依赖。这五件是**纯声望账本操作**
 * （只读 state 的 `standings` / `standingsEarned` 两本账）⇒ 拆到本件后，weekendBattle / weekendEvent 等
 * 都从这里读，环断（行为逐字不变）。`expedition.ts` 原样再导出，其余 40 余处门槛的既有引用零改动。
 */
import type { GameState } from './state'

/** 主要势力 id（声望绑定方） */
export const DSI_FACTION_ID = 'dsi'

/**
 * **查询某势力的声望**（**2026-09-26 起 = 累计获得**）。
 *
 * 船长令：「**其他所有的声望门槛都改为看获得了多少声望总数**」⇒ 本函数（全仓 40 余处门槛的唯一入口）
 * 改读**累计获得**那一本账；**可支配**那一本另走 {@link spendableStandingOf}（只有兑换扣它）。
 *
 * ⚠ **兼容**：老档 / 合成状态没有 `standingsEarned` 时**回退读旧值** ⇒ 判定口径与改动前逐字一致
 * （读档路径由 `save.normalizeState` 回填，见那里的说明）。
 */
export function standingOf(state: GameState, factionId: string): number {
  return state.standingsEarned?.[factionId] ?? state.standings[factionId] ?? 0
}

/** **可支配声望**（只有「章鱼人兑换」扣它；**不能**拿它当门槛读——门槛一律走 `standingOf`） */
export function spendableStandingOf(state: GameState, factionId: string): number {
  return state.standings[factionId] ?? 0
}

/**
 * **记一笔声望获得**（唯一入口）：**两条账同时加**。
 *
 * - 可支配那本 +v（日后能被兑换扣掉）；
 * - 累计那本 +v（**只增不减**，所有门槛读它）。
 *
 * 调用点两处：完成远征/悬赏卡（`anomaly.standingGain`）与**入侵结束按贡献占比**
 * （`weekendBattle.weekendSettleAndGrant`）。v ≤ 0 时只保证累计那本不回退（幂等补账用）。
 */
export function noteStandingEarned(state: GameState, factionId: string, v: number): void {
  const add = Math.max(0, Math.round(v))
  state.standings[factionId] = Math.max(0, (state.standings[factionId] ?? 0) + add)
  state.standingsEarned = state.standingsEarned ?? {}
  state.standingsEarned[factionId] = Math.max(0, (state.standingsEarned[factionId] ?? 0) + add)
}

/**
 * **花掉声望**（唯一入口；目前只有「章鱼人兑换」调它）：只扣**可支配**那本，**累计那本一分不动**
 * ⇒ 兑换不会把已经解锁的门槛重新锁上（正是船长"门槛改看累计"要的效果）。
 * 不够扣 ⇒ 返回 false、两本账都不动。
 */
export function spendStanding(state: GameState, factionId: string, v: number): boolean {
  const need = Math.max(0, Math.round(v))
  const have = state.standings[factionId] ?? 0
  if (have < need) return false
  state.standings[factionId] = have - need
  return true
}
