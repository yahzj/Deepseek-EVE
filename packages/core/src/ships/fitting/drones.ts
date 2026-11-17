import type { SimContext, FittedModules } from '../../types'
import { allFittedIds } from '../../labels'
import { plugEffectPartsOf } from '../../plugEffects'
import { type GameState, addLog } from '../../state'
import { fleetDefOf } from '../../instances'
import { addWare, countWare, removeWare } from '../../inventory'
import type { CommandResult } from '../../engine'
import { shipOperationBlockReason } from '../../shipActionPolicy'
import { cpuBudgetOf, fittedCpuUsed, droneCpuUsed } from './cpu'

export function droneLoadM3(droneLoad: Record<string, number> | undefined, ctx: SimContext): number {
  if (!droneLoad) return 0
  let m3 = 0
  for (const [id, n] of Object.entries(droneLoad)) {
    if (n <= 0) continue
    const d = ctx.items.get(id)
    if (d?.kind === 'drone') m3 += (d.unitM3 ?? 0) * n
  }
  return m3
}

export function droneBayTotalM3(ship: { droneBayM3?: number; civilianFittingOnly?: boolean } | undefined, fitted: FittedModules | undefined, ctx: SimContext, plugs: readonly string[] = []): number {
  if (ship?.civilianFittingOnly === true) return 0
  let cap = ship?.droneBayM3 ?? 0
  if (fitted) {
    for (const id of allFittedIds(fitted)) {
      const m = ctx.modules.get(id)
      cap += m?.droneBayBonusM3 ?? 0
    }
  }
  for (const { effective: p } of plugEffectPartsOf(plugs, ctx)) {
    cap += p.droneBayBonusM3 ?? 0
  }
  return cap
}

export function droneBayCapOf(state: GameState, ctx: SimContext, shipId: string): number {
  return droneBayTotalM3(fleetDefOf(state, ctx, shipId), state.fleet[shipId]?.fitted, ctx, state.fleet[shipId]?.plugs)
}

export function trimDroneLoadToBay(
  state: GameState,
  ctx: SimContext,
  shipId: string = state.shipId,
): string | null {
  const fleet = state.fleet[shipId]
  const current = fleet?.droneLoad
  if (!fleet || !current) return null
  const cap = droneBayCapOf(state, ctx, shipId)
  let used = droneLoadM3(current, ctx)
  if (used <= cap + 1e-6) return null
  const load: Record<string, number> = { ...current }
  const keys = Object.keys(load)
  const removed: Record<string, number> = {}
  while (used > cap + 1e-6) {
    let took = false
    for (let i = keys.length - 1; i >= 0; i--) {
      const id = keys[i]!
      const n = load[id] ?? 0
      if (n <= 0) continue
      const left = n - 1
      if (left > 0) load[id] = left
      else delete load[id]
      used -= ctx.items.get(id)?.unitM3 ?? 0
      removed[id] = (removed[id] ?? 0) + 1
      addWare(state, id, 1)
      took = true
      break
    }
    if (!took) break
  }
  fleet.droneLoad = Object.keys(load).length > 0 ? load : undefined
  const text = Object.entries(removed)
    .map(([id, n]) => `${ctx.items.get(id)?.name ?? id}×${n}`)
    .join('、')
  addLog(
    state,
    'warn',
    `⚠ 无人机舱容量缩小（现 ${Math.round(used * 10) / 10}/${cap} m³）：已自动卸下超出的 ${text} 并退回仓库。`,
  )
  state.droneLossNotice = `机舱容量不足：已自动卸下 ${text} 并退回仓库。`
  return text
}

export function adjustDroneLoad(
  state: GameState,
  ctx: SimContext,
  droneId: string,
  delta: number,
  shipId: string = state.shipId,
): CommandResult {
  const blocked = shipOperationBlockReason(state, ctx, shipId, 'configure')
  if (blocked) return { ok: false, ...blocked }
  const def = ctx.items.get(droneId)
  if (!def || def.kind !== 'drone') return { ok: false, error: '只能装载无人机物品。', errorId: 'core.equipment.011' }
  const fleet = state.fleet[shipId]
  if (!fleet) return { ok: false, error: '舰队里找不到该舰船，无法装载无人机。', errorId: 'core.equipment.005' }
  if (!Number.isInteger(delta) || delta === 0) return { ok: false, error: '数量必须是整数且不能为 0。', errorId: 'core.equipment.012' }
  if (delta > 0 && fleetDefOf(state, ctx, shipId)?.civilianFittingOnly === true) {
    return { ok: false, errorId: 'core.equipment.034', error: '该货舰不能部署战斗无人机，备用无人机可作为货物携带。' }
  }
  const load: Record<string, number> = { ...(fleet.droneLoad ?? {}) }
  const cur = load[droneId] ?? 0
  const next = cur + delta
  if (next < 0) {
    return {
      ok: false,
      error: `卸下数量超过已装载（当前 ×${cur}）。`,
      errorId: 'core.equipment.013',
      errorParams: { p1: cur },
    }
  }
  if (delta > 0) {
    const have = countWare(state, droneId)
    if (have < delta) {
      return {
        ok: false,
        error: `仓库里没有足够的 ${def.name}（差 ${delta - have} 架）。`,
        errorId: 'core.equipment.014',
        errorParams: { p1: def.name, p2: delta - have },
      }
    }
    const cap = droneBayCapOf(state, ctx, shipId)
    const cpuTotal = cpuBudgetOf(state, ctx, shipId)
    const usedCpu =
      fittedCpuUsed(fleet.fitted, ctx, fleetDefOf(state, ctx, shipId)) +
      droneCpuUsed(load, ctx) +
      (def.cpuUse ?? 0) * delta
    const usedM3 = droneLoadM3(load, ctx) + (def.unitM3 ?? 0) * delta
    if (usedM3 > cap) {
      return {
        ok: false,
        error: `机舱容量不足：${Math.round(usedM3 * 10) / 10}/${cap} m³（先卸下一些，或装「甲板扩展」扩容）。`,
        errorId: 'core.equipment.015',
        errorParams: { p1: Math.round(usedM3 * 10) / 10, p2: cap },
      }
    }
    if (cpuTotal > 0 && usedCpu > cpuTotal) {
      return {
        ok: false,
        error: `CPU 预算不足：合计需 ${usedCpu}/${cpuTotal}（无人机占用计入预算）。`,
        errorId: 'core.equipment.016',
        errorParams: { p1: usedCpu, p2: cpuTotal },
      }
    }
    removeWare(state, droneId, delta)
  } else {
    addWare(state, droneId, -delta)
  }
  if (next <= 0) delete load[droneId]
  else load[droneId] = next
  fleet.droneLoad = Object.keys(load).length > 0 ? load : undefined
  addLog(
    state,
    'fleet',
    `${delta > 0 ? '装入' : '卸下'} ${def.name} ×${Math.abs(delta)}（舱内 ×${next > 0 ? next : 0}）。`,
    'core.equipment.024',
    {
      p1: delta > 0 ? '装入' : '卸下',
      ...(delta > 0 ? {} : { p1Id: 'core.equipment.027' }),
      p2: def.name,
      p3: Math.abs(delta),
      p4: next > 0 ? next : 0,
    },
  )
  return { ok: true }
}

export type DroneRefillResult = {
  added: Record<string, number>
  fromHold: Record<string, number>
  fromWare: Record<string, number>
  short: Record<string, number>
}

export function takeDroneUnit(state: GameState, shipId: string, droneId: string): 'hold' | 'ware' | null {
  const fleet = state.fleet[shipId]
  if (!fleet) return null
  if ((fleet.cargo[droneId] ?? 0) > 0) {
    fleet.cargo[droneId] = (fleet.cargo[droneId] ?? 0) - 1
    if (fleet.cargo[droneId]! <= 0) delete fleet.cargo[droneId]
    return 'hold'
  }
  if (countWare(state, droneId) > 0) {
    removeWare(state, droneId, 1)
    return 'ware'
  }
  return null
}

export function refillDroneLoadTo(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  target: Readonly<Record<string, number>>,
  take?: (id: string) => 'hold' | 'ware' | null,
): DroneRefillResult {
  const out: DroneRefillResult = { added: {}, fromHold: {}, fromWare: {}, short: {} }
  const fleet = state.fleet[shipId]
  if (!fleet) return out
  const load: Record<string, number> = { ...(fleet.droneLoad ?? {}) }
  const cap = droneBayCapOf(state, ctx, shipId)
  const cpuTotal = cpuBudgetOf(state, ctx, shipId)
  const cpuFitted = fittedCpuUsed(fleet.fitted, ctx, fleetDefOf(state, ctx, shipId))
  let usedM3 = droneLoadM3(load, ctx)
  let usedCpu = droneCpuUsed(load, ctx)
  const ids = Object.keys(target)
    .filter((id) => (target[id] ?? 0) > 0 && ctx.items.get(id)?.kind === 'drone')
    .sort(
      (a, b) =>
        (ctx.items.get(b)?.baseSellPriceIsk ?? 0) - (ctx.items.get(a)?.baseSellPriceIsk ?? 0) ||
        a.localeCompare(b),
    )
  for (const id of ids) {
    const def = ctx.items.get(id)!
    const want = Math.max(0, Math.floor((target[id] ?? 0) - (load[id] ?? 0)))
    if (want <= 0) continue
    const m3 = def.unitM3 ?? 0
    const cpu = def.cpuUse ?? 0
    for (let i = 0; i < want; i++) {
      if (usedM3 + m3 > cap + 1e-6) break
      if (cpuTotal > 0 && cpuFitted + usedCpu + cpu > cpuTotal) break
      const src = take ? take(id) : takeDroneUnit(state, shipId, id)
      if (src === null) {
        out.short[id] = want - i
        break
      }
      if (src === 'hold') out.fromHold[id] = (out.fromHold[id] ?? 0) + 1
      else out.fromWare[id] = (out.fromWare[id] ?? 0) + 1
      load[id] = (load[id] ?? 0) + 1
      out.added[id] = (out.added[id] ?? 0) + 1
      usedM3 += m3
      usedCpu += cpu
    }
    const got = out.added[id] ?? 0
    if (got < want && out.short[id] === undefined) out.short[id] = want - got
  }
  if (Object.keys(out.added).length > 0) fleet.droneLoad = load
  return out
}
