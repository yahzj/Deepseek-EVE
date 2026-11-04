/** 功能域职责拆分，保持原计算与顺序。 */
import type { SimContext, FittedModules } from '../../types'
import { allFittedIds } from '../../labels'
import { plugEffectPartsOf } from '../../plugEffects'
import { type GameState, addLog } from '../../state'
import { fleetDefOf } from '../../instances'
import { addWare, countWare, removeWare } from '../../inventory'
import type { CommandResult } from '../../engine'
import { shipOperationBlockReason } from '../../shipActionPolicy'
import { cpuBudgetOf, fittedCpuUsed, droneCpuUsed } from './cpu'

/** 2026-09-08：装载清单占用的机舱体积（m³ = Σ 架数×unitM3；装配页容量条用） */
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

/**
 * **无人机舱总容量** = 船体 `droneBayM3` ＋ 已装甲板扩展（`droneBayBonusM3`）之和。
 *
 * 2026-09-26 从两处私有实现（本文件的 `droneBayCapOf` 与装配页的内联求和）合并为**唯一单点**——
 * 舰船悬停卡（舰队页「当前属性」）与装配页主表都用它，避免两处口径漂移。
 */
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

/** 某船无人机舱总容量（船体 droneBayM3 + 已装甲板扩展 bonus） */
export function droneBayCapOf(state: GameState, ctx: SimContext, shipId: string): number {
  return droneBayTotalM3(fleetDefOf(state, ctx, shipId), state.fleet[shipId]?.fitted, ctx, state.fleet[shipId]?.plugs)
}

/**
 * 机舱超容整理（2026-09-10 船长：卸下「无人机甲板扩展」后，超出机舱的无人机也要卸下）：
 * 机舱容量变小（卸甲板扩展 / 旧档槽位裁短）导致清单装不下时，**按清单逆序逐架卸下并退回仓库**
 * （与 createPlayerSpec 的"超量逆序剔除"同口径），并写事件日志 + 一次性提示（渲染层弹 toast）。
 * 返回被卸下的摘要（文案；无超容 = null）。
 */
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
      addWare(state, id, 1) // 退回物品仓库（可从仓库重新装入）
      took = true
      break
    }
    if (!took) break // 防御：清单已空仍超容（内容异常）→ 停手
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
  // 一次性提示（渲染层读到即清并弹 toast；与机群战损共用同一通道）
  state.droneLossNotice = `机舱容量不足：已自动卸下 ${text} 并退回仓库。`
  return text
}

/**
 * 无人机舱清单调整（2026-09-08 无人机舱大改）：delta > 0 = 从仓库装入（舱容 + CPU 预占校验）；
 * delta < 0 = 卸下并退回仓库。shipId 缺省 = 当前驾驶船（装配页支持非驾驶目标，同 fitModule）。
 */
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
    // 预算 = 船体 CPU + 已装协处理器加成（2026-09-11 起：装配与放飞共用同一份扩容预算）
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

/** `refillDroneLoadTo` 的明细（日志/测试用） */
export type DroneRefillResult = {
  /** 表 → 本次真正补进清单的架数（按型） */
  added: Record<string, number>
  /** 其中来自**本船货仓**的架数 */
  fromHold: Record<string, number>
  /** 其中来自**物品仓库**的架数 */
  fromWare: Record<string, number>
  /** 货源不足没补上的架数（按型；空 = 已补满） */
  short: Record<string, number>
}

/**
 * **取 1 架无人机**（**唯一入口**）—— 货源顺序 = **本舰货舱 → 物品仓库**（**不自动购买**）。
 * 返回值 = 货从哪来；两处都没有 ⇒ `null`（调用方据此判"没货"）。
 *
 * ⚠ **这是一条货源纪律，不是一个便利函数**：船长 2026-09-20「**战斗结束立刻自动补充，优先货仓，
 * 其次是仓库**」——战后自动补货（`refillDroneLoadTo`）与**战中复位**（`core/droneRevive.ts`
 * 的无人机储备甲板）都走本函数 ⇒ 以后要改顺序**只改这一处**。
 */
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

/**
 * **战后立刻补足机群**（船长 2026-09-20：「**战斗结束立刻自动补充，优先货仓，其次是仓库**」＋
 * 「**按本场出发快照补**」）。
 *
 * 背景：2026-09-08 无人机舱大改 §二.5 把「回港自动补充」定为"结构预留、本轮不激活"（当时还没开
 * 无人机被击毁）；2026-09-10 开了击毁（永久损失/耗材流）却没把它一起激活 ⇒ 玩家打完一架要手动一架架点 +。
 * 本函数把那一半补上：**只补回"本场出发时的清单"**（快照由 `battle.droneLoadAtStart` 提供），
 * 不是"配置目标"落档字段（船长选定，避免新增存档字段；副作用是货源不足时目标会随之下移）。
 *
 * 三条硬口径：
 * ① **货仓优先、仓库其次**（都是"你自己的货"，不自动购买）；
 * ② 受**舱容 + CPU 预算**双重校验 —— 与 `adjustDroneLoad` 同一把尺（复用 `droneBayCapOf` /
 *    `cpuBudgetOf` / `fittedCpuUsed` / `droneCpuUsed`），绝不会补到超载；
 * ③ 补货**只增不减**：目标里没有的型、清单里多出来的型一律不动（那是玩家自己装的）。
 *
 * 补录顺序 = 目标机型按**基准价降序**（与"优先回收高价值"同一口径：货源不足时先补贵的那些）。
 */
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
      if (usedM3 + m3 > cap + 1e-6) break // 舱容
      if (cpuTotal > 0 && cpuFitted + usedCpu + cpu > cpuTotal) break // CPU 预算
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
    // 舱容/CPU 先耗尽 ⇒ 余下的也算"没补上"（玩家看得见缺多少）
    const got = out.added[id] ?? 0
    if (got < want && out.short[id] === undefined) out.short[id] = want - got
  }
  if (Object.keys(out.added).length > 0) fleet.droneLoad = load
  return out
}
