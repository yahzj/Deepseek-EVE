/** 悬赏胜率预估：自动档按主武器远/近/中三点采样；编队设有默认距离时只采该距离。
 * 距离均交实战建档入口夹紧，旧敌卡与胜利记录不参与选距。
 * 种子由敌卡、装配、技能、距离点和局号稳定派生，补给充足但弹药档位与玩家一致。 */
import type { FittedModules, GameState } from '../state'
import { createInitialState } from '../state'
import type { AnomalyDef, SimContext } from '../types'
import { addShipToFleet } from '../shipyard'
import type { UnitSpec } from './model'
import { advanceBattleFor } from './advance'
import { createPlayerSpec } from './player/create'
import { desiredRangeFor, mainWeaponOf } from './foes/tactics'
import { startBattleFor } from './startSingle'
import { waveGapTotalMs } from './combatMath'
import { combatRosterOf } from './command/roster'
import { startFleetBattleFor } from './startFleet'
import { fleetRangeOf } from '../fleetRange'

/** **每个距离点的局数**（2026-09-24 船长：「三点各 10 局就够了」） */
export const BOUNTY_MC_RUNS = 10

const AMMO_ITEM_IDS = ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l'] as const

export interface BountyWinMC {
  /** 胜率 0~1（各点合并后的实测平均，无偏） */
  winRate: number
  /** 最差距离点胜率；固定编队距离时等于winRate。 */
  worstWinRate: number
  /** 平均装甲损耗 0~1（相对本场开局残余；1 = 打空） */
  armorLoss: number
  /** 平均结构损耗 0~1（相对本场开局残余） */
  hullLoss: number
  /** 实际局数 */
  runs: number
  /** 逐距离点读数（界面悬停/读数用） */
  points: readonly { desireM: number; winRate: number; runs: number }[]
  /** 兼容字段：是否使用固定编队距离而非三点采样。 */
  recorded: boolean
}

/**
 * **稳定散列**（去种子化用）：把"敌卡 + 装配/技能指纹 + 距离点 + 局号"揉成一个 32 位种子。
 * 为什么不用 `Math.random`：预估必须**同输入可复现**（预热缓存稳定、用例可断言），
 * 但**不同输入必须互不相关**——散列两者兼得。
 */
function seedOf(parts: readonly (string | number)[]): number {
  let h = 2166136261
  for (const p of parts) {
    const s = String(p)
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    h ^= 0x9e3779b9
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * 克隆"战力评估快照"：新档 + 驾驶船（同装配/无人机清单/耐久/**弹药档位**）+ 技能 + 教程进度。
 * 弹药与修理组件给足（评估不计补给耗尽）；其余（仓库/市场/任务/声望）不影响战力，不复制。
 * 返回 null = 该船不存在。uid = 快照中驾驶船键（addShipToFleet 分配，第 1 艘 = 船型 id）。
 */
export function buildEvalState(state: GameState, shipId: string): { ev: GameState; uid: string } | null {
  const real = state.fleet[shipId]
  const defId = real?.defId
  if (!real || !defId) return null
  const ev = createInitialState({ nowWallMs: 0, seed: 1 })
  ev.fleet = {}
  ev.resupplyFromWarehouse = state.resupplyFromWarehouse !== false
  const uid = addShipToFleet(ev, defId)
  const f = ev.fleet[uid]!
  f.fitted = JSON.parse(JSON.stringify(real.fitted ?? {})) as FittedModules
  if (real.droneLoad !== undefined) f.droneLoad = { ...real.droneLoad }
  f.armorPct = real.armorPct ?? 1
  f.durability = real.durability ?? 1
  f.customName = real.customName
  if (real.plugs) f.plugs = [...real.plugs]
  if (real.damagePlugs) f.damagePlugs = [...real.damagePlugs]
  const squad = [uid]
  for (const id of combatRosterOf(state, shipId).filter(id => id !== shipId)) {
    const member = state.fleet[id]
    if (!member?.defId) continue
    const copyId = addShipToFleet(ev, member.defId)
    ev.fleet[copyId] = structuredClone(member)
    squad.push(copyId)
    provisionEvalSupplies(ev, ev.fleet[copyId])
  }
  if (squad.length > 1) ev.preparationSquads = { combat: squad }
  /**
   * **弹药档位**（**2026-09-24 船长**：「弹药采用玩家当前选择弹药」）：旧版不复制 `ammoPref`
   * ⇒ 评估固定吃脚本塞的基础弹，与实战（MK2/MK3）不是同一场仗。
   */
  if (real.ammoPref !== undefined) f.ammoPref = { ...real.ammoPref }
  f.cargo = {}
  /**
   * **补给补足跟着开关走**（2026-09-23 船长令：弹药与修理组件"从仓库取用 / 从货仓取用"二选一）：
   * 评估把料放进**开关真正会读的那个池**（船长 2026-09-24：「补给按照完全充足给」）。
   */
  ev.resupplyFromWarehouse = state.resupplyFromWarehouse !== false
  provisionEvalSupplies(ev, f)
  ev.skills.trained = { ...state.skills.trained }
  ev.skills.queue = []
  const range = fleetRangeOf(state, combatRosterOf(state, shipId))
  if (range) ev.fleetRange = { ...range, shipIds: [...squad] }
  // 照会战加成判定（演习场 + 主控 + 「第一次完成悬赏」未完成）——复制任务状态使评估与实战一致
  const fb = state.importantTasks['first-bounty']
  if (fb !== undefined) ev.importantTasks['first-bounty'] = { ...fb }
  // 敌卡的窝点/派系档位（`startBattleFor` 会按它派生强化卡 ⇒ 评估与实战同一张卡）
  ev.expedition.lairTier = state.expedition.lairTier
  ev.expedition.factionActive = state.expedition.factionActive
  ev.shipId = uid
  return { ev, uid }
}

/**
 * **评估用补给补足**（2026-09-23 开关配套）：把"弹药 + 修理组件足量"放进**开关真正会读的那个池**——
 * 开（缺省）= 母港仓库；关 = 该舰货仓。评估本身是"不计补给耗尽"的口径（船长 2026-09-24 确认）。
 */
function provisionEvalSupplies(ev: GameState, f: { cargo?: Record<string, number>; ammoPref?: Partial<Record<string, string>> } | undefined): void {
  const ids = [...AMMO_ITEM_IDS, ...Object.values(f?.ammoPref ?? {}).filter((id): id is string => typeof id === 'string'), 'repairkit-civ', 'repairkit-mil']
  if (ev.resupplyFromWarehouse !== false) {
    for (const id of ids) ev.warehouse.items[id] = 1_000_000
    return
  }
  if (!f) return
  f.cargo = f.cargo ?? {}
  for (const id of ids) f.cargo[id] = 1_000_000
}

/**
 * **装配/技能指纹**（去种子化的一项输入）：只取"会改变战斗结果"的那些（舰型 / 装配 / 无人机 / 技能 /
 * 耐久 / 弹药档）。同装配同技能 ⇒ 同种子序列（可复现）；换装配 ⇒ 全新序列（互不相关）。
 */
function shipFingerprintOf(ev: GameState, uid: string): string {
  const f = ev.fleet[uid]
  const tr = ev.skills.trained
  const sk = Object.keys(tr)
    .sort()
    .map((k) => `${k}:${tr[k]}`)
    .join(',')
  return `${f?.defId ?? ''}|${JSON.stringify(combatRosterOf(ev).map(id => ev.fleet[id]))}|${sk}`
}

/**
 * **三个距离采样点**（船长 2026-09-24：「按照武器最大射程，最小射程，中距离各跑数次。不加入新参数」）。
 * 三处都复用引擎口径：`mainWeaponOf`（主武器 = 射程最远那门）与 `desiredRangeFor`（中距档位）。
 * 夹紧交给 `startBattleFor` 内部那一道（`clamp(minDistanceM, min(openM, raw))`），本函数不重复夹。
 */
export function evalDistancePoints(me: UnitSpec, ctx: SimContext): { max: number; min: number; mid: number } {
  const bal = ctx.balance.battle
  const main = mainWeaponOf(me)
  return {
    max: Math.max(bal.minDistanceM, Math.round(main?.maxRangeM ?? 0)),
    min: Math.max(bal.minDistanceM, Math.round(main?.minRangeM ?? 0)),
    mid: desiredRangeFor(me, 'mid', bal),
  }
}

/**
 * 在评估快照上跑 N 局（自动档三点距离各10局；编队默认距离共30局）。
 * `ev` 只应来自 `buildEvalState`。同输入同种子完全可复现。
 */
export function estimateBountyWinOn(
  ev: GameState,
  ctx: SimContext,
  anomaly: AnomalyDef,
  uid: string,
  runs: number = BOUNTY_MC_RUNS,
  /** 兼容参数（旧调用方传的种子基）——**去种子化后不再使用**，保留只为签名兼容 */
  seedBase = 0,
): BountyWinMC {
  void seedBase
  const bal = ctx.balance.battle
  const anomalyId = anomaly.id
  // 拿"我方规格"以解析武器射程带：走引擎自己的建档入口（与实战同源）
  const specProbe = createPlayerSpec(ev, ctx, uid)
  const pts = specProbe ? evalDistancePoints(specProbe, ctx) : null
  const fleetDesire = fleetRangeOf(ev)?.desireM
  // 默认米数只由实战入口按本场边界夹紧，不按主武器射程另行改写。
  const plan: { desireM: number; runs: number; tag: string }[] = fleetDesire !== undefined
    ? [{ desireM: fleetDesire, runs: runs * 3, tag: 'fleet' }]
    : pts
      ? [
          { desireM: pts.max, runs, tag: 'max' },
          { desireM: pts.min, runs, tag: 'min' },
          { desireM: pts.mid, runs, tag: 'mid' },
        ]
      : [{ desireM: 0, runs: runs * 3, tag: 'default' }] // 兜底：解析不出武器 ⇒ 走引擎缺省档

  let wins = 0
  let total = 0
  let armorLeftSum = 0
  let hullLeftSum = 0
  const points: { desireM: number; winRate: number; runs: number }[] = []
  const fingerprint = shipFingerprintOf(ev, uid)
  for (const p of plan) {
    let pWins = 0
    for (let i = 0; i < p.runs; i += 1) {
      // **去种子化**：按"卡 + 船的装配/技能指纹 + 距离点 + 局号"散列派生 ⇒ 不同卡/不同点互不相关
      ev.rng = { seed: seedOf([anomalyId, fingerprint, p.tag, p.desireM, i]), count: 0 }
      const f = ev.fleet[uid]
      if (f) {
        const ap = f.armorPct ?? 1
        f.armorPct = Math.min(1, Math.max(0, ap))
        provisionEvalSupplies(ev, f) // 每局补足（评估不计补给耗尽）
      }
      ev.gameMs = 0
      // **与实战同一入口**（`expedition` 的悬赏战即 `startBattleFor`）；`desireM` 走第 6 参
      for (const id of combatRosterOf(ev)) provisionEvalSupplies(ev, ev.fleet[id])
      const roster = combatRosterOf(ev)
      const battle = roster.length > 1 ? startFleetBattleFor(ev, ctx, roster, anomalyId, 0, p.desireM > 0 ? p.desireM : undefined)
        : startBattleFor(ev, ctx, uid, anomalyId, 0, p.desireM > 0 ? p.desireM : undefined)
      if (!battle) continue
      const pl0 = battle.units['player']
      if (!pl0) continue
      const a0 = pl0.hp.a
      const h0 = pl0.hp.h
      ev.gameMs = bal.maxBattleMs + 5_000 + waveGapTotalMs(anomaly, bal) // 预算外预留波次演出窗口
      advanceBattleFor(ev, ctx, battle, uid, anomalyId)
      const pl = battle.units['player']
      if (!pl) continue
      total += 1
      if (battle.ended === 'me') {
        wins += 1
        pWins += 1
      }
      // 损耗钳制 [0,1]：维修装置可把装甲/结构修回超过开局残余 ⇒ 损耗比不得为负
      armorLeftSum += a0 > 0 ? Math.min(1, Math.max(0, pl.hp.a / a0)) : 0
      hullLeftSum += h0 > 0 ? Math.min(1, Math.max(0, pl.hp.h / h0)) : 0
    }
    points.push({ desireM: p.desireM, winRate: p.runs > 0 ? pWins / p.runs : 0, runs: p.runs })
  }
  const done = Math.max(1, total)
  const winRate = wins / done
  const worstWinRate = points.length > 0 ? Math.min(...points.map((x) => x.winRate)) : winRate
  return {
    winRate,
    worstWinRate,
    armorLoss: 1 - armorLeftSum / done,
    hullLoss: 1 - hullLeftSum / done,
    runs: done,
    points,
    recorded: fleetDesire !== undefined,
  }
}

/** 便捷入口：对当前档直接评估（内部自建快照，不污染存档）。null = 驾驶船记录缺失。 */
export function estimateBountyWinMC(
  state: GameState,
  ctx: SimContext,
  anomaly: AnomalyDef,
  shipId: string = state.shipId,
  runs: number = BOUNTY_MC_RUNS,
): BountyWinMC | null {
  const snap = buildEvalState(state, shipId)
  if (!snap) return null
  return estimateBountyWinOn(snap.ev, ctx, anomaly, snap.uid, runs)
}
