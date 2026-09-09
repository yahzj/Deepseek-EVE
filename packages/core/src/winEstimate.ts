/**
 * 悬赏胜率蒙特卡洛预估（2026-09-09 船长确认：N=21，内部吸收旧"带伤扣分"）。
 *
 * 为什么换成蒙特卡洛：旧玩家可见预估 = 稳态解析（固定中点距离 + 无护盾回充 + 敌方火力
 * 不随减员下降 + 无视接近期）+ "带伤扣分"外挂——探针实测（5 装配 × 7 档悬赏 × 9 种子）
 * 双向大偏差，多处显示 2% 却实际全胜。本模块与实战**完全同构**：每局 = startBattleFor +
 * advanceBattleFor（独立种子掷骰；残余甲/壳开局；同距离机动/近盲/护盾回充/减员/超时血比），
 * N 局平均 = 展示胜率与平均损耗。带伤影响天然进入每局结果（开局缩血），无需再外挂扣分。
 *
 * 口径与边界：
 * - 只服务**玩家可见**预估（悬赏卡/远征视图）；battleWinPreview（稳态）保留给 AI 门槛与
 *   离线模拟工具——非玩家可见，两套口径在注释中互指（避免误用）；
 * - 评估在"克隆战力快照"上进行：不消耗真实存档 rng / 弹药 / 状态；教学战加成按当前
 *   教程进度（onboarding.step）复制，与实战一致；
 * - 弹药按足量给（与旧稳态口径一致——展示的是"火力胜率"，不计弹尽）；
 * - 同输入同种子完全可复现（预热缓存稳定不跳变）。
 */
import type { FittedModules, GameState } from './state'
import { createInitialState } from './state'
import type { AnomalyDef, SimContext } from './types'
import { addShipToFleet } from './shipyard'
import { advanceBattleFor, startBattleFor, waveGapTotalMs } from './combat'

/** 蒙特卡洛局数（2026-09-09 船长确认 N=21：临界 ±11pp、预热 ~0.5s 分帧完成） */
export const BOUNTY_MC_RUNS = 21

const AMMO_ITEM_IDS = ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l'] as const

export interface BountyWinMC {
  /** 胜率 0~1（N 局实测平均，无偏） */
  winRate: number
  /** 平均装甲损耗 0~1（相对本场开局残余；1 = 打空） */
  armorLoss: number
  /** 平均结构损耗 0~1（相对本场开局残余） */
  hullLoss: number
  /** 实际局数（防御性跳过可能小于请求值） */
  runs: number
}

/**
 * 克隆"战力评估快照"：新档 + 驾驶船（同装配/无人机清单/耐久）+ 技能 + 教程进度。
 * 弹药给足（评估不计弹尽）；其余（仓库/市场/任务/声望）不影响战力，不复制。
 * 返回 null = 该船不存在。uid = 快照中驾驶船键（addShipToFleet 分配，第 1 艘 = 船型 id）。
 */
export function buildEvalState(state: GameState, shipId: string): { ev: GameState; uid: string } | null {
  const real = state.fleet[shipId]
  const defId = real?.defId
  if (!real || !defId) return null
  const ev = createInitialState({ nowWallMs: 0, seed: 1 })
  const uid = addShipToFleet(ev, defId)
  const f = ev.fleet[uid]!
  f.fitted = JSON.parse(JSON.stringify(real.fitted ?? {})) as FittedModules
  if (real.droneLoad !== undefined) f.droneLoad = { ...real.droneLoad }
  f.armorPct = real.armorPct ?? 1
  f.durability = real.durability ?? 1
  f.customName = real.customName
  f.cargo = {}
  for (const id of AMMO_ITEM_IDS) f.cargo[id] = 1_000_000
  // 船体维修装置（2026-09-09）：评估按"组件充足"计（同弹药哲学——评估不计补给耗尽，
  // 只算火力/承伤/修复的边际战力；真实战斗组件耗尽会停机，见 combat.preloadRepairFor）
  for (const id of ['repairkit-civ', 'repairkit-mil']) f.cargo[id] = 1_000_000
  ev.skills.trained = { ...state.skills.trained }
  ev.skills.queue = []
  // 教学战加成判定（onboarding.step === ONB_TRIAL && ano-training && 任务未领）——复制进度使评估与实战一致
  ev.onboarding.step = state.onboarding.step
  ev.shipId = uid
  return { ev, uid }
}

/** 在评估快照上跑 N 局（独立种子；同输入可复现）。ev 只应来自 buildEvalState。 */
export function estimateBountyWinOn(
  ev: GameState,
  ctx: SimContext,
  anomaly: AnomalyDef,
  uid: string,
  runs: number = BOUNTY_MC_RUNS,
  seedBase: number = 20260909,
): BountyWinMC {
  const bal = ctx.balance.battle
  const anomalyId = anomaly.id
  let wins = 0
  let armorLeftSum = 0
  let hullLeftSum = 0
  for (let i = 0; i < runs; i++) {
    // 每局独立种子（局号 × 大质数 + 基），复用同一快照对象：rng 重建 + 弹药补足
    ev.rng = { seed: (seedBase + i * 1013904223) >>> 0, count: 0 }
    const f = ev.fleet[uid]
    if (f) {
      const ap = f.armorPct ?? 1 // 战斗不改耐久（防御钳制无副作用）
      f.armorPct = Math.min(1, Math.max(0, ap))
      for (const id of AMMO_ITEM_IDS) f.cargo[id] = 1_000_000
      // 每局补足修理组件（维修装置评估不计组件耗尽）
      for (const id of ['repairkit-civ', 'repairkit-mil']) f.cargo[id] = 1_000_000
    }
    ev.gameMs = 0
    const battle = startBattleFor(ev, ctx, uid, anomalyId, 0)
    if (!battle) continue
    const pl0 = battle.units['player']
    if (!pl0) continue
    const a0 = pl0.hp.a
    const h0 = pl0.hp.h
    ev.gameMs = bal.maxBattleMs + 5_000 + waveGapTotalMs(anomaly, bal) // 预算外预留波次演出窗口（2026-09-09）
    advanceBattleFor(ev, ctx, battle, uid, anomalyId)
    const pl = battle.units['player']
    if (!pl) continue
    if (battle.ended === 'me') wins += 1
    // 损耗钳制 [0,1]：维修装置可把装甲/结构修回超过开局残余（上限 = 满值口径），
    // 相对"开局残余"的损耗比不得为负——修复再强也只展示"无损耗"（2026-09-09）
    armorLeftSum += a0 > 0 ? Math.min(1, Math.max(0, pl.hp.a / a0)) : 0
    hullLeftSum += h0 > 0 ? Math.min(1, Math.max(0, pl.hp.h / h0)) : 0
  }
  const done = Math.max(1, runs)
  return {
    winRate: wins / done,
    armorLoss: 1 - armorLeftSum / done,
    hullLoss: 1 - hullLeftSum / done,
    runs: done,
  }
}

/** 便捷入口：对当前档直接评估（内部自建快照，不污染存档）。null = 驾驶船数据缺失。 */
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
