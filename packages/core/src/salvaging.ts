/**
 * 打捞作业（B3，2026-09-05 船长定稿：采矿式作业；docs/design/b3-salvage.md）。
 *
 * 模型：
 * - 单趟作业：下达即视为已抵达目标星系，立即自动持续打捞（去程已取消）
 *   （船内每台打捞器按各自周期结算，每轮按 salvageRoundPull 的"体积当量系数"
 *   捞取该星系敌群型号池随机一只残骸入货仓）→ **满仓自动返航** → 到港整仓卸入
 *   物品仓库 → 作业结束（不自动续，手动再派）；去程时间并入返航腿（总行程时间不变）；
 * - 满仓判定 = 货仓放不下下一轮捞取量时转返航（残骸 = 重货）；
 * - 打捞期间该星系密度漂移**双向挂起**（engine 每拍把正在打捞的星系传给
 *   advanceWreckDrift）；低安星系打捞全程暴露（encounters.collectExposures）；
 * - 工作位守卫：与采矿/远征/扫描/待命/返航/主控精炼互斥（入口拒绝）；
 * - 出发要求：船上装有 ≥1 台打捞器（slot='salvager'）。
 */
import { addLog } from './state'
import type { CommandResult } from './engine'
import type { GameState } from './state'
import type { SimContext } from './types'
import { addItem, freeCargoM3, unloadCargoToWarehouse } from './inventory'
import { HOME_GALAXY_ID, shortestTravelMinutes } from './expedition'
import { travelLegMs } from './travel'
import { actionBlockReason, markExplored } from './explore'
import { fleetDefOf, shipDisplayName } from './instances'
import { allFittedModules } from './equipment'
import { nextRandom } from './rng'
import { salvageRoundPull, WRECK_VOLUME_PER_THREAT, wreckDensityOf, wreckItemIdOf } from './salvage'
import { scaledReturnMs } from './trips'

/** 出航/返航共用腿（星系航程）：进出港基准（同采矿 localLegMs）+ 星系间航程（按船速换算） */
export function legMsFor(state: GameState, ctx: SimContext, galaxyId: string, shipId?: string): number {
  if (state.debugQuick) return 1000
  const mins = shortestTravelMinutes(ctx, HOME_GALAXY_ID, galaxyId)
  const travel = Number.isFinite(mins) ? mins : 0
  return Math.max(1, ctx.balance.mining.localLegMs + travelLegMs(state, ctx, travel, shipId))
}

/** 出航腿（空船出门跃迁×2 → 约返航一半；调试模式固定 1 秒） */
export function outboundLegMsFor(state: GameState, ctx: SimContext, galaxyId: string, shipId?: string): number {
  if (state.debugQuick) return 1000
  return Math.max(1, Math.round(legMsFor(state, ctx, galaxyId, shipId) / 2))
}

/** 该船装配的打捞器周期表（每台周期毫秒；无打捞器 = 空表）。
 * 打捞装置整备学（salvage-rigging）：单轮周期每级 −3%（最多 −40%；主控与 AI 同源——
 * 主控作业与 AI 任务都经本函数取周期）。 */
export function salvagerCyclesOf(state: GameState, ctx: SimContext, shipId: string): number[] {
  const fleetShip = state.fleet[shipId]
  if (!fleetShip) return []
  const rigLv = Math.min(5, state.skills.trained['salvage-rigging'] ?? 0)
  const rigFactor = rigLv > 0 ? Math.max(0.6, 1 - 0.03 * rigLv) : 1
  const cycles: number[] = []
  for (const def of allFittedModules(fleetShip.fitted, ctx)) {
    if (def.slot === 'salvager') cycles.push(Math.max(100, Math.round((def.salvageCycleMs ?? 10_000) * rigFactor)))
  }
  return cycles
}

/** 目标星系可打捞的敌群型号池（该星系悬赏/遭遇群；按威胁加权抽型号） */
function wreckPoolOf(ctx: SimContext, galaxyId: string): Array<{ anomalyId: string; threat: number }> {
  const pool: Array<{ anomalyId: string; threat: number }> = []
  for (const a of ctx.anomalies.values()) {
    if (a.galaxyId === galaxyId) pool.push({ anomalyId: a.id, threat: Math.max(1, a.threat) })
  }
  return pool
}

/** 玩家指令：开始打捞作业（目标星系需可达、已探索、有敌群型号池；船需装打捞器） */
export function startSalvageOp(state: GameState, galaxyId: string, ctx: SimContext): CommandResult {
  const galaxy = ctx.galaxies.get(galaxyId)
  if (!galaxy) return { ok: false, error: `未知星系：${galaxyId}。` }
  if (state.salvaging.active) return { ok: false, error: '打捞作业进行中：请先停止当前打捞。' }
  if (!state.fleet[state.shipId]) return { ok: false, error: '当前舰船数据缺失，无法出发打捞。' }
  if (salvagerCyclesOf(state, ctx, state.shipId).length === 0) {
    return { ok: false, error: '打捞需要打捞器：请先在舰船高槽装上打捞器（MK1/2/3）再出发。' }
  }
  if (state.mining.active) return { ok: false, error: '采矿作业进行中：请先停止开采。' }
  if (state.expedition.active) return { ok: false, error: '远征进行中：舰船不在空间站，无法出发打捞。' }
  if (state.scanning.active) return { ok: false, error: '扫描探索中：先终止扫描。' }
  if (state.standby.active) return { ok: false, error: '舰船正前往掩护巡逻星系途中——请先取消。' }
  if (state.transit.active) return { ok: false, error: '返航行程中：先等抵达。' }
  if (state.sideTasks.deliver !== null) return { ok: false, error: '快递投送途中：暂不能出发打捞——到站自动结算后再安排。' }
  if (state.refineRuns.some((r) => r.active && r.worker === 'pilot')) {
    return { ok: false, error: '精炼炉正由你亲自运转：先停炉才能出海（可改用 AI 核心驱动）。' }
  }
  if (galaxyId !== HOME_GALAXY_ID) {
    const travel = shortestTravelMinutes(ctx, HOME_GALAXY_ID, galaxyId)
    if (!Number.isFinite(travel)) {
      return { ok: false, error: `「${galaxy.name}」没有从母港可达的航线，无法前往打捞。` }
    }
    const block = actionBlockReason(state, galaxyId)
    if (block) return { ok: false, error: block }
  }
  if (wreckPoolOf(ctx, galaxyId).length === 0) {
    return { ok: false, error: `「${galaxy.name}」没有可打捞的敌群残骸（该星系无悬赏目标）。` }
  }
  const s = state.salvaging
  s.active = true
  s.galaxyId = galaxyId
  s.phase = 'salvaging' // 去程取消：指令即视为已抵达，立即开始打捞
  s.phaseAccMs = 0
  s.cycleAccMs = 0
  s.tripM3 = 0
  s.deviceAccMs = {}
  // 船即时到目标星系：点亮探索（与采矿同口径；目标本就要求已探索，此处兜底）
  markExplored(state, galaxyId)
  const shipName = shipDisplayName(state, ctx, state.shipId)
  const density = wreckDensityOf(state, galaxyId, ctx)
  const salvagers = salvagerCyclesOf(state, ctx, state.shipId).length
  const outSec = Math.max(1, Math.round(outboundLegMsFor(state, ctx, galaxyId) / 1000))
  const retSec = Math.max(1, Math.round(legMsFor(state, ctx, galaxyId) / 1000))
  addLog(
    state,
    'info',
    `开始打捞：${galaxy.name}（残骸密度 ${density.toFixed(1)}）。${shipName} 已抵达目标空域，立即开始持续打捞` +
      `（${salvagers} 台打捞器；满载返航约 ${retSec + outSec} 秒，去程时间已并入返航）卸入仓库后结束（不自动续）。`,
  )
  return { ok: true }
}

/** 手动停止（任何阶段；未返航的货物留在船上） */
export function stopSalvageOp(state: GameState, ctx: SimContext): boolean {
  const s = state.salvaging
  if (!s.active) return false
  const galaxy = s.galaxyId ? ctx.galaxies.get(s.galaxyId) : undefined
  const phaseNote =
    s.phase === 'returning' ? '（返航途中，货物留在船上）' : s.phase === 'outbound' ? '（出航途中）' : ''
  const tripM3 = s.tripM3
  s.active = false
  s.galaxyId = null
  s.phase = 'salvaging'
  s.phaseAccMs = 0
  s.cycleAccMs = 0
  s.tripM3 = 0
  s.deviceAccMs = {}
  addLog(state, 'info', `已停止打捞（${galaxy?.name ?? ''}）。本趟共捞约 ${Math.round(tripM3 * 100) / 100} m³ 当量${phaseNote}。`)
  return true
}

/** 完好舰体（当轮捞取 ×2）概率：基础 1%，每级 ×1.2（残骸富集识别学，2026-09-05） */
export function assayChanceOf(state: GameState): number {
  const lv = Math.min(5, state.skills.trained['wreck-assaying'] ?? 0)
  return 0.01 * Math.pow(1.2, lv)
}

/** 一轮打捞的通用结算（主控作业与 AI 任务共用）：
 * 抽该星系敌群型号池一只（威胁加权）→ 体积当量系数（含放干扣减）→ 返回 { itemId, volumeM3 }；
 * 星系无型号池返回 null。放货入舱由调用方按剩余舱容裁决（放不下 = 满仓返航）。 */
export function pullOneWreck(
  state: GameState,
  ctx: SimContext,
  galaxyId: string,
): { itemId: string; mul: number; volumeM3: number } | null {
  const pool: Array<{ anomalyId: string; threat: number }> = []
  for (const a of ctx.anomalies.values()) {
    if (a.galaxyId === galaxyId) pool.push({ anomalyId: a.id, threat: Math.max(1, a.threat) })
  }
  if (pool.length === 0) return null
  let acc = 0
  const total = pool.reduce((n, p) => n + p.threat, 0)
  const roll = nextRandom(state.rng) * total
  let chosen = pool[0]!
  for (const p of pool) {
    acc += p.threat
    if (roll <= acc) {
      chosen = p
      break
    }
  }
  const mul = salvageRoundPull(state, ctx, galaxyId)
  const wreckId = wreckItemIdOf(chosen.anomalyId)
  // 乙案（2026-09-05）：残骸计数 = 体积（m³）——型号威胁决定单份体积量级（威胁×0.06），
  // 本轮入舱 m³ = 单份 × 密度系数；item unitM3 = 1，数量即体积。
  const baseM3 = Math.max(0.1, Math.round(Math.max(1, chosen.threat) * WRECK_VOLUME_PER_THREAT * 100) / 100)
  // 残骸富集识别学（wreck-assaying，2026-09-05）：完好舰体（当轮 ×2）概率 1% ×1.2/级
  const bigFind = nextRandom(state.rng) < assayChanceOf(state)
  // 漂流物打捞学（salvage-diving，2026-09-05）：残骸打捞量每级 +12%（主控与 AI 同享）
  const diveLv = Math.min(5, state.skills.trained['salvage-diving'] ?? 0)
  const volumeM3 = baseM3 * mul * (bigFind ? 2 : 1) * (1 + 0.12 * diveLv)
  return { itemId: wreckId, mul, volumeM3 }
}

/**
 * 引擎内部：按流逝时间推进打捞状态机（即时打捞 → 满仓返航（去程并入）→ 到港卸货结束）。
 * 剩余时间管理器与采矿同构：时间按阶段逐段消费，一次大推进可完整穿越全程。
 */
export function advanceSalvageOp(state: GameState, deltaMs: number, ctx: SimContext): void {
  const s = state.salvaging
  if (!s.active || deltaMs <= 0) return
  if (!state.fleet[state.shipId]) {
    resetOp(state)
    addLog(state, 'warn', '当前舰船数据缺失，打捞作业已停止。')
    return
  }
  let remaining = deltaMs
  let guard = 0
  while (s.active && remaining > 0) {
    if (++guard > 100_000) break // 防失控（离线大步长多循环）
    const galaxyId = s.galaxyId
    if (!galaxyId) {
      resetOp(state)
      addLog(state, 'warn', '打捞目标星系数据缺失，作业已停止。')
      return
    }
    // ── 返航阶段（去程并入返航；返航腿按货仓占比缩放——空仓快、满仓=原时长，船长 2026-09-05）──
    if (s.phase === 'outbound' || s.phase === 'returning') {
      const outFull = outboundLegMsFor(state, ctx, galaxyId)
      const leg =
        s.phase === 'outbound'
          ? outFull
          : scaledReturnMs(legMsFor(state, ctx, galaxyId) + outFull, state, ctx, state.shipId)
      const need = leg - s.phaseAccMs
      if (remaining < need) {
        s.phaseAccMs += remaining
        remaining = 0
        break
      }
      remaining -= need
      s.phaseAccMs = 0
      if (s.phase === 'returning') {
        const moved = unloadCargoToWarehouse(state)
        const galaxyName = ctx.galaxies.get(galaxyId)?.name ?? galaxyId
        addLog(
          state,
          'info',
          `打捞自动返港：${galaxyName} 残骸已卸入物品仓库（共 ${moved.toLocaleString('zh-CN')} m³ 当量）。本次打捞结束——可再派（不自动续）。`,
        )
        resetOp(state)
        break
      }
      // 旧档遗留的出航相位到点：抵达目标星系（点亮探索）后直接打捞
      markExplored(state, galaxyId)
      s.phase = 'salvaging'
      s.cycleAccMs = 0
      continue
    }

    // ── 打捞阶段：逐台打捞器按各自周期结算 ──
    if (wreckPoolOf(ctx, galaxyId).length === 0) {
      resetOp(state)
      addLog(state, 'warn', '该星系敌群数据缺失，打捞作业已停止。')
      return
    }
    const cycles = salvagerCyclesOf(state, ctx, state.shipId)
    if (cycles.length === 0) {
      resetOp(state)
      addLog(state, 'warn', '打捞器数据缺失，打捞作业已停止。')
      return
    }
    // 最短周期为统一推进步（多台各自维护相位）
    const stepMs = Math.min(...cycles)
    if (s.cycleAccMs < stepMs) {
      const need = stepMs - s.cycleAccMs
      const take = Math.min(remaining, need)
      s.cycleAccMs += take
      remaining -= take
      if (s.cycleAccMs < stepMs) break
    }
    s.cycleAccMs = 0
    for (const cycleMs of cycles) {
      const key = String(cycleMs)
      s.deviceAccMs[key] = (s.deviceAccMs[key] ?? 0) + stepMs
      while ((s.deviceAccMs[key] ?? 0) >= cycleMs) {
        s.deviceAccMs[key] = (s.deviceAccMs[key] ?? 0) - cycleMs
        const pulled = pullOneWreck(state, ctx, galaxyId)
        if (!pulled) {
          resetOp(state)
          addLog(state, 'warn', '该星系敌群数据缺失，打捞作业已停止。')
          return
        }
        if (pulled.volumeM3 > freeCargoM3(state, ctx)) {
          // 满仓（下一轮放不下）：自动返航（去程并入返航，总行程时间不变）
          s.phase = 'returning'
          s.phaseAccMs = 0
          const mergedSec = Math.round((legMsFor(state, ctx, galaxyId) + outboundLegMsFor(state, ctx, galaxyId)) / 1000)
          addLog(
            state,
            'info',
            `货仓已满（本趟约 ${Math.round(s.tripM3 * 100) / 100} m³）：自动返航卸货（约 ${mergedSec} 秒，去程已并入返航）。`,
          )
          break
        }
        addItem(state, pulled.itemId, pulled.volumeM3) // 计数 = 体积（m³）
        s.tripM3 += pulled.volumeM3
      }
      if (s.phase === 'returning') break
    }
  }
}

function resetOp(state: GameState): void {
  const s = state.salvaging
  s.active = false
  s.galaxyId = null
  s.phase = 'salvaging'
  s.phaseAccMs = 0
  s.cycleAccMs = 0
  s.tripM3 = 0
  s.deviceAccMs = {}
}
