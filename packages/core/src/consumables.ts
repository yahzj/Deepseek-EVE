import type { GameState } from './state'
import type { CommandResult } from './engine'
import type { SimContext } from './types'
import { countItem, countWare, removeItem, removeWare } from './inventory'
import { HOME_GALAXY_ID, addLog } from './state'
import { SYNAPTIC_ACCELERANT_MS, normalizeTrainingProgress, trainingLevelProgress } from './training'
import { securityZoneOf } from './securityZone'
import { DSI_FACTION_ID, spendableStandingOf, standingOf } from './standing'
import {
  WEEKEND_FINISHED_FAMILIES,
  WEEKEND_MIN_STANDING,
  weekendInvasionAllowedFor,
  weekendFamilyNameId,
  weekendHasBuiltStation,
  weekendPeripheryOf,
  weekendRandomFamilyOf,
  weekendRollOccupation,
} from './weekendEvent'
import { gateMainActivity } from './activityGate'
import { weekendSettleAndGrant } from './weekendBattle'
import { weekendFlagshipBattleActive } from './weekendLaunch'

export const HIGH_SEC_PENALTY = 10

export function beaconLaunchHighSecOf(ctx: SimContext, targetGalaxyId?: string): boolean {
  return targetGalaxyId !== undefined && securityZoneOf(ctx, targetGalaxyId) === '高安'
}

export function beaconTargetBlocked(state: GameState, ctx: SimContext, galaxyId: string): boolean {
  return galaxyId === HOME_GALAXY_ID || weekendHasBuiltStation(state, ctx, galaxyId)
}

export const SYNAPTIC_ACCELERANT_ITEM_ID = 'synaptic-accelerant'

export function consumableStockOf(state: GameState, itemId: string): number {
  return countItem(state, itemId) + countWare(state, itemId)
}

function takeOne(state: GameState, itemId: string): void {
  if (countItem(state, itemId) > 0) {
    removeItem(state, itemId, 1)
    return
  }
  removeWare(state, itemId, 1)
}

export function useSynapticAccelerant(state: GameState): CommandResult {
  if (consumableStockOf(state, SYNAPTIC_ACCELERANT_ITEM_ID) <= 0) {
    return { ok: false, error: '仓库里没有突触加速剂 MK1。', errorId: 'core.consumable.001' }
  }
  normalizeTrainingProgress(state)
  takeOne(state, SYNAPTIC_ACCELERANT_ITEM_ID)
  state.skillBoostUntilMs = Math.max(state.gameMs, state.skillBoostUntilMs ?? 0) + SYNAPTIC_ACCELERANT_MS
  addLog(
    state,
    'industry',
    `✦ 突触加速剂 MK1已使用：技能加速有效时间增加${Math.round(SYNAPTIC_ACCELERANT_MS / 3_600_000)}小时。`,
    'core.consumable.017',
    { p1: Math.round(SYNAPTIC_ACCELERANT_MS / 3_600_000) },
  )
  return { ok: true }
}

export function synapticAccelerantRemainMs(state: GameState): number {
  return Math.max(0, (state.skillBoostUntilMs ?? 0) - state.gameMs)
}


export const SYNAPTIC_ACCELERANT_RENEW_TAIL_MS = 60_000

export function syncBoostRenew(state: GameState, ctx: SimContext): void {
  if (state.boostAutoRenew !== true) return
  normalizeTrainingProgress(state)
  for (;;) {
    if (consumableStockOf(state, SYNAPTIC_ACCELERANT_ITEM_ID) <= 0) {
      state.boostAutoRenew = false
      addLog(state, 'warn', '⚠ 技能加速自动续用已关闭：突触加速剂 MK1用光了。', 'core.consumable.015')
      return
    }
    const head = state.skills.queue[0]
    let needMs = SYNAPTIC_ACCELERANT_RENEW_TAIL_MS
    if (head !== undefined) {
      const def = ctx.skills.get(head.skillId)
      if (def !== undefined) {
        needMs = Math.max(SYNAPTIC_ACCELERANT_RENEW_TAIL_MS,
          trainingLevelProgress(state, def, (state.skills.trained[head.skillId] ?? 0) + 1, head.progressMs).remainingMs)
      }
    }
    if (synapticAccelerantRemainMs(state) > needMs) return
    takeOne(state, SYNAPTIC_ACCELERANT_ITEM_ID)
    state.skillBoostUntilMs = Math.max(state.gameMs, state.skillBoostUntilMs ?? 0) + SYNAPTIC_ACCELERANT_MS
    if (offlineRenewTally !== null) {
      offlineRenewTally += 1
      continue
    }
    addLog(
      state,
      'industry',
      `✦ 突触加速剂 MK1自动续用：接下来 ${Math.round(SYNAPTIC_ACCELERANT_MS / 3_600_000)} 小时训练时长继续减半。`,
      'core.consumable.013',
      { p1: Math.round(SYNAPTIC_ACCELERANT_MS / 3_600_000) },
    )
  }
}

let offlineRenewTally: number | null = null

export function setOfflineBoostTally(on: boolean): void {
  offlineRenewTally = on ? 0 : null
}

export function offlineBoostRenewCount(): number {
  return offlineRenewTally ?? 0
}

export function boostAutoRenewOn(state: GameState): boolean {
  return state.boostAutoRenew === true
}

export function setBoostAutoRenew(state: GameState, on: boolean): CommandResult {
  if (!on) {
    state.boostAutoRenew = false
    return { ok: true }
  }
  if (consumableStockOf(state, SYNAPTIC_ACCELERANT_ITEM_ID) <= 0) {
    return { ok: false, error: '仓库里没有突触加速剂 MK1：自动续用无从补起。', errorId: 'core.consumable.016' }
  }
  state.boostAutoRenew = true
  return { ok: true }
}


export const INVASION_BEACON_ITEM_ID = 'invasion-beacon'

export const INVASION_BEACON_TYPES: readonly { itemId: string; familyId?: string }[] = [
  { itemId: INVASION_BEACON_ITEM_ID },
  { itemId: 'invasion-beacon-r', familyId: 'R' },
  { itemId: 'invasion-beacon-c', familyId: 'C' },
  { itemId: 'invasion-beacon-h', familyId: 'H' },
  { itemId: 'invasion-beacon-d', familyId: 'D' },
]

export function invasionBeaconTypeOf(itemId: string) {
  return INVASION_BEACON_TYPES.find(row => row.itemId === itemId)
}

export function availableInvasionBeacons(state: GameState) {
  return INVASION_BEACON_TYPES.flatMap(row => {
    const units = consumableStockOf(state, row.itemId)
    return units > 0 ? [{ ...row, units }] : []
  })
}

export const INVASION_BEACON_FAMILIES: readonly { readonly id: string; readonly nameId: string }[] =
  WEEKEND_FINISHED_FAMILIES.map((id) => ({ id, nameId: weekendFamilyNameId(id) ?? 'core.weekend.025' }))

export function useInvasionBeacon(
  state: GameState,
  ctx: SimContext,
  opts: { familyId?: string; galaxyId?: string; itemId?: string } = {},
): CommandResult {
  const { galaxyId } = opts
  const itemId = opts.itemId ?? INVASION_BEACON_ITEM_ID
  const type = invasionBeaconTypeOf(itemId)
  if (!type || type.familyId !== undefined && opts.familyId !== undefined && opts.familyId !== type.familyId) {
    return { ok: false, error: '发射器类型或指定势力不匹配。', errorId: 'core.factionBeacon.001' }
  }
  const familyId = type.familyId ?? opts.familyId
  if (consumableStockOf(state, itemId) <= 0) {
    return { ok: false, error: '仓库里没有信号发射器。', errorId: 'core.consumable.004' }
  }
  const ev = state.weekendEvent
  if (ev !== undefined && ev.endedAtWallMs === undefined) {
    return { ok: false, error: '已经有一场入侵在进行中：等它结束再用信号发射器。', errorId: 'core.consumable.005' }
  }
  if (galaxyId !== undefined && !ctx.galaxies.has(galaxyId)) {
    return { ok: false, error: '当前没有可入侵的目标星系。', errorId: 'core.consumable.007' }
  }
  if (weekendFlagshipBattleActive(state)) {
    return { ok: false, error: '战斗中：这一场打完才能切换主控活动。', errorId: 'core.activityGate.004' }
  }
  const gate = gateMainActivity(state, 'standby')
  if (gate.action === 'reject') {
    return { ok: false, error: gate.message, errorId: gate.messageId, errorParams: gate.messageParams }
  }
  if (galaxyId !== undefined && beaconTargetBlocked(state, ctx, galaxyId)) {
    return { ok: false, error: '该星系信号被压制，无法使用信号发射器。', errorId: 'core.consumable.010' }
  }
  const family = familyId !== undefined ? INVASION_BEACON_FAMILIES.find((f) => f.id === familyId) : undefined
  if (familyId !== undefined && !family) {
    return {
      ok: false,
      error: `未知的入侵势力：${familyId === '' ? '(空)' : familyId}。`,
      errorId: 'core.consumable.006',
      errorParams: { p1: familyId === '' ? '(空)' : familyId },
    }
  }
  const highSec = beaconLaunchHighSecOf(ctx, galaxyId)
  if (highSec && spendableStandingOf(state, DSI_FACTION_ID) < HIGH_SEC_PENALTY) {
    return {
      ok: false,
      error: `在高安启动信号发射器要付 ${HIGH_SEC_PENALTY} 点声望：当前可支配声望不够。`,
      errorId: 'core.consumable.011',
      errorParams: { p1: HIGH_SEC_PENALTY },
    }
  }
  if (!weekendInvasionAllowedFor(state)) {
    return {
      ok: false,
      error: `需「深空工业协会」声望 ${WEEKEND_MIN_STANDING}（累计 ${standingOf(state, DSI_FACTION_ID)}）`,
      errorId: 'core.market.039',
      errorParams: { p1: WEEKEND_MIN_STANDING, p2: standingOf(state, DSI_FACTION_ID) },
    }
  }
  const seq = (ev?.seq ?? 0) + 1
  const familyIdOfEvent = family?.id ?? weekendRandomFamilyOf(state, seq)
  let rolled: { coreId: string; peripheryIds: string[]; family: string } | null = null
  if (galaxyId !== undefined) {
    rolled = { coreId: galaxyId, peripheryIds: weekendPeripheryOf(ctx, galaxyId), family: familyIdOfEvent }
  } else {
    rolled = weekendRollOccupation(state, ctx, seq, familyIdOfEvent)
    if (!rolled) {
      return { ok: false, error: '当前没有可入侵的目标星系。', errorId: 'core.consumable.007' }
    }
  }
  weekendSettleAndGrant(state, ctx, state.wallMs ?? Date.now())
  takeOne(state, itemId)
  if (highSec) {
    const penalized = galaxyId ?? rolled.coreId
    state.standings[DSI_FACTION_ID] = Math.max(0, spendableStandingOf(state, DSI_FACTION_ID) - HIGH_SEC_PENALTY)
    addLog(
      state,
      'fleet',
      `⚠ 在「${ctx.galaxies.get(penalized)?.name ?? penalized}」启动信号发射器：协会扣了 ${HIGH_SEC_PENALTY} 点声望。`,
      'core.consumable.012',
      { p1: ctx.galaxies.get(penalized)?.name ?? penalized, p2: HIGH_SEC_PENALTY },
    )
  }
  state.weekendEvent = {
    seq,
    startedAtWallMs: state.wallMs ?? Date.now(),
    ...rolled,
    family: familyIdOfEvent,
    contributed: {},
    ...(highSec ? { beaconHighSec: true } : {}),
    beaconLit: true,
  }
  const galaxyName = ctx.galaxies.get(rolled.coreId)?.name ?? rolled.coreId
  addLog(
    state,
    'fleet',
    `✦ 信号发射器已启动：入侵舰队正在逼近「${galaxyName}」（第 ${seq} 场）。`,
    'core.consumable.008',
    { p1: galaxyName, p2: seq },
  )
  return { ok: true }
}
