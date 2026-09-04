/**
 * AI 核心系统（v8）：AI 核心 = 玩家的分身。
 *
 * 规则（中文说明，设计文档已确认）：
 * - 「人工智能专家」技能等级 = 可同时指挥的副船数量（LvN = N 艘）；
 * - 核心四档效率：基础 40% / 伽马 50% / 贝塔 60% / 阿尔法 75%；
 *   效率只影响副船工作速度（作业时长按 ÷效率拉长），不影响任何奖励（全额）；
 * - 基础核心空间站直购；伽马/贝塔/阿尔法由远征胜利按威胁概率掉落；
 * - 采矿任务：无风险，满舱自动返航→卸货入物品仓库→再出航（无限循环，直到取消）；
 * - 远征任务：只接预估胜率 ≥80% 的悬赏、且船耐久 ≥50%；胜利奖励/战利品/声望全额；
 *   失利扣耐久并按弃船骰判定（规则与主控一致）；耐久 ≤30% 自动维修（钱包付费）；
 * - 核心是空间站资产：任务结束/取消/弃船中断时自动归还核心库。
 */
import { addLog } from './state'
import type { AiAssignment, GameState } from './state'
import type { AiCoreType, SimContext } from './types'
import type { CommandResult } from './engine'
import { nextRandom } from './rng'
import { addWare } from './inventory'
import { isMineableItem } from './labels'
import { getMiningParams, oneLegMs, oneOutboundLegMs, rollBeltOutput, shipInReturn } from './mining'
import { DSI_FACTION_ID, HOME_GALAXY_ID, calcPower, shortestTravelMinutes, standingOf } from './expedition'
import { travelLegMs } from './travel'
import { actionBlockReason, markExplored } from './explore'
import { nearestStationGalaxyId } from './location'
import {
  advanceBattleFor,
  aiFavorAdv,
  aiWinPreview,
  playerAmmoSize,
  refundAmmo,
  startBattleFor,
} from './combat'
import { durabilityOf, loseShip, repairShip } from './shipyard'
import { fleetDefOf, shipDisplayName } from './instances'
import { buyAtMarket, levelOf, marketGoodOf, marketQuote, placeBuyOrder } from './market'

/** 核心类型展示顺序 */
export const AI_CORE_ORDER: readonly AiCoreType[] = ['basic', 'gamma', 'beta', 'alpha']

/** 核心中文名 */
export function aiCoreName(type: AiCoreType): string {
  return type === 'basic' ? '基础 AI 核心' : type === 'gamma' ? '伽马 AI 核心' : type === 'beta' ? '贝塔 AI 核心' : '阿尔法 AI 核心'
}

/** 效率（速度系数：1 = 玩家手操速度；只影响速度不影响奖励） */
export function aiEfficiency(state: GameState, ctx: SimContext, type: AiCoreType): number {
  return ctx.balance.aiCore.efficiency[type] ?? 1
}

/** 核心库数量 */
export function countAiCore(state: GameState, type: AiCoreType): number {
  return state.aiCores[type] ?? 0
}

/** 入库 */
export function gainAiCore(state: GameState, type: AiCoreType, count = 1): void {
  state.aiCores[type] = (state.aiCores[type] ?? 0) + count
}

/** 出库 */
function spendAiCore(state: GameState, type: AiCoreType): boolean {
  const current = state.aiCores[type] ?? 0
  if (current <= 0) return false
  state.aiCores[type] = current - 1
  return true
}

/** 可同时指挥的副船数 = 技能等级 */
export function maxAiSlots(state: GameState, ctx: SimContext): number {
  return state.skills.trained[ctx.balance.aiCore.skillId] ?? 0
}

/** 已占用的名额数 */
export function aiSlotsUsed(state: GameState): number {
  return Object.keys(state.aiAssignments).length
}

/** 可指派的空闲船（舰队里非主控、无任务、不在换船善后返航中的船） */
export function idleAiShipIds(state: GameState): string[] {
  return Object.keys(state.fleet).filter(
    (id) => id !== state.shipId && !(id in state.aiAssignments) && !shipInReturn(state, id),
  )
}

/** 玩家指令：购买基础 AI 核心（V9：市场供应簿按市价买入；无现货自动挂收购单） */
export function buyBasicAiCore(state: GameState, ctx: SimContext): CommandResult {
  const good = marketGoodOf(ctx, 'aicore', 'basic')
  if (!good) return { ok: false, error: '基础 AI 核心未在市场流通（数据缺失）。' }
  const quote = marketQuote(state, ctx, good.key)
  const ask = quote.sell ?? Math.round(levelOf(state, ctx, good.key) * 1.06)
  if (state.wallet.isk < ask) {
    return { ok: false, error: `ISK 不足：基础 AI 核心约 ${ask.toLocaleString('zh-CN')} ISK（现有 ${state.wallet.isk.toLocaleString('zh-CN')}）。` }
  }
  if (quote.sell !== undefined) {
    const res = buyAtMarket(state, ctx, good.key, 1)
    if (res.bought > 0) {
      addLog(state, 'trade', `已购入 基础 AI 核心（市场价 ${res.total.toLocaleString('zh-CN')} ISK）。AI 核心 = 你的分身，可指派给闲置舰船。`)
      return { ok: true }
    }
  }
  // 供应簿瞬时吃穿：挂收购单（到货自动入核心库）
  const order = placeBuyOrder(state, ctx, good.key, ask, 1)
  if (!order) return { ok: false, error: '挂收购单失败（钱包或参数异常）。' }
  addLog(state, 'trade', `基础 AI 核心供应簿暂时被买空——已自动挂收购单 @ ${order.price.toLocaleString('zh-CN')} ISK，到货自动入核心库（可随时撤销）。`)
  return { ok: true }
}

/* ───────── 任务指派 ───────── */

/** 共同校验：船、名额、核心、空闲 */
function checkAssignable(state: GameState, shipId: string, coreType: AiCoreType, ctx: SimContext): CommandResult {
  if (shipId === state.shipId) return { ok: false, error: '主控船由你亲自驾驶，不能指派 AI。' }
  if (!state.fleet[shipId]) return { ok: false, error: '舰队里没有这艘船。' }
  if (shipId in state.aiAssignments) return { ok: false, error: '这艘船已有 AI 任务。' }
  const slots = maxAiSlots(state, ctx)
  if (slots <= 0) return { ok: false, error: `「人工智能专家」Lv0：先训练该技能才能指挥 AI 副船。` }
  if (aiSlotsUsed(state) >= slots) {
    return { ok: false, error: `AI 名额已满（${slots}/${slots}）——升级「人工智能专家」可指挥更多副船。` }
  }
  if (countAiCore(state, coreType) <= 0) {
    return { ok: false, error: `${aiCoreName(coreType)} 库存不足（效率 ${Math.round(aiEfficiency(state, ctx, coreType) * 100)}%）。` }
  }
  if (state.mining.active || state.expedition.active) {
    // 主控作业不影响 AI 副船；无冲突，不拦截
  }
  return { ok: true }
}

/** 玩家指令：指派 AI 采矿任务（自动循环，产出卸入物品仓库） */
export function assignAiMining(
  state: GameState,
  shipId: string,
  coreType: AiCoreType,
  beltId: string,
  ctx: SimContext,
): CommandResult {
  const pre = checkAssignable(state, shipId, coreType, ctx)
  if (!pre.ok) return pre
  const belt = ctx.belts.get(beltId)
  if (!belt) return { ok: false, error: `未知采集点：${beltId}。` }
  const ore = ctx.items.get(belt.oreId)
  if (!isMineableItem(ore)) return { ok: false, error: `采集点「${belt.name}」没有对应的可采集资源数据。` }
  const needStanding = belt.standingReq ?? 0
  if (needStanding > 0) {
    const have = standingOf(state, DSI_FACTION_ID)
    if (have < needStanding) {
      return { ok: false, error: `采集点「${belt.name}」需要「深空工业协会」声望 ${needStanding}（当前 ${have}）。` }
    }
  }
  // V13 探索封锁：所在星系未点亮 → 拒绝派发（母港与已点亮星系不受限）
  const block = actionBlockReason(state, belt.galaxyId)
  if (block) return { ok: false, error: block }
  if (!getMiningParams(state, ctx, { shipId, beltId })) {
    return { ok: false, error: '该舰船数据缺失，无法执行采矿任务。' }
  }

  spendAiCore(state, coreType)
  state.aiAssignments[shipId] = {
    coreType,
    startedAtGameMs: state.gameMs,
    task: { kind: 'mining', beltId, phase: 'mining', cycleAccMs: 0, phaseAccMs: 0, tripUnits: 0 },
  }
  const shipName = shipDisplayName(state, ctx, shipId)
  const eff = aiEfficiency(state, ctx, coreType)
  addLog(
    state,
    'info',
    `[AI] ${shipName} 开始自动采集 ${belt.name}（${aiCoreName(coreType)}，效率 ${Math.round(eff * 100)}%，满舱自动回港卸货）。`,
  )
  return { ok: true }
}

/** 玩家指令：指派 AI 远征任务（只接预估胜率 ≥80% 且耐久 ≥50% 的目标；奖励全额） */
export function assignAiExpedition(
  state: GameState,
  shipId: string,
  coreType: AiCoreType,
  anomalyId: string,
  ctx: SimContext,
): CommandResult {
  const pre = checkAssignable(state, shipId, coreType, ctx)
  if (!pre.ok) return pre
  const anomaly = ctx.anomalies.get(anomalyId)
  if (!anomaly) return { ok: false, error: `未知目标：${anomalyId}。` }
  // 手动首胜解锁：AI 只代劳玩家亲手清剿过的悬赏（completedBounties = 主控首胜记录）
  if (!state.completedBounties.includes(anomalyId)) {
    return { ok: false, error: `AI 暂不能接单：「${anomaly.name}」需要你先亲手完成一次（首胜后解锁自动远征）。` }
  }
  // AI 门槛 = "最终成功率"口径（favor 修正 + logit 扩散，与 AI 指挥中心展示/结算 favor 同源）：
  // 已过门槛的目标在 favor 下接近必胜（简单局必成，杜绝"必胜还翻车"）
  const chance = aiWinPreview(state, ctx, anomaly, shipId)
  if (chance < 0.8) {
    return { ok: false, error: `AI 只接高胜率任务：该目标最终成功率 ${Math.round(chance * 100)}%（需 ≥80%）。` }
  }
  if (durabilityOf(state, shipId) < 0.5) {
    return { ok: false, error: '该船耐久低于 50%，先维修再出任务。' }
  }
  // V13 探索封锁：目标星系未点亮 → 拒绝派发
  const block = actionBlockReason(state, anomaly.galaxyId)
  if (block) return { ok: false, error: block }
  const power = calcPower(state, ctx, shipId)
  const eff = aiEfficiency(state, ctx, coreType)
  // 两阶段：去程（finishAt = 到达时刻），交火由战斗引擎实时推进（同样按效率拉长）
  const outMinutes = shortestTravelMinutes(ctx, HOME_GALAXY_ID, anomaly.galaxyId)
  if (!Number.isFinite(outMinutes)) return { ok: false, error: '目标星系不在已知航路内。' }
  // V12.1：单程按副船自身跃迁/航行技能换算（出发锁定），再按 AI 效率拉长
  const rawOutMs = travelLegMs(state, ctx, outMinutes, shipId)
  const outMs = Math.max(1, Math.round(rawOutMs / eff))

  spendAiCore(state, coreType)
  const assignment: AiAssignment = {
    coreType,
    startedAtGameMs: state.gameMs,
    task: {
      kind: 'expedition',
      anomalyId,
      finishAtGameMs: state.gameMs + outMs,
      outMs,
      power,
      phase: 'out',
      battle: null,
    },
  }
  state.aiAssignments[shipId] = assignment
  const shipName = shipDisplayName(state, ctx, shipId)
  addLog(
    state,
    'info',
    `[AI] ${shipName} 出发远征 ${anomaly.name}（${aiCoreName(coreType)} 效率 ${Math.round(eff * 100)}%，胜率 ${Math.round(chance * 100)}%）。`,
  )
  return { ok: true }
}

/** 引擎内部：推进所有 AI 副船任务 */
export function cancelAiTask(state: GameState, shipId: string, ctx: SimContext): boolean {
  const assignment = state.aiAssignments[shipId]
  if (!assignment) return false
  delete state.aiAssignments[shipId]
  gainAiCore(state, assignment.coreType)
  const shipName = shipDisplayName(state, ctx, shipId)
  addLog(state, 'info', `[AI] 已召回 ${shipName}（${aiCoreName(assignment.coreType)} 归还核心库）。`)
  return true
}

/* ───────── 引擎推进 ───────── */

/** 引擎内部：推进所有 AI 副船任务 */
export function advanceAi(state: GameState, deltaMs: number, ctx: SimContext): void {
  if (deltaMs <= 0) return
  for (const shipId of Object.keys(state.aiAssignments)) {
    const assignment = state.aiAssignments[shipId]
    if (!assignment) continue
    // 船没了（弃船等）→ 清理任务并归还核心
    if (!state.fleet[shipId]) {
      delete state.aiAssignments[shipId]
      gainAiCore(state, assignment.coreType)
      addLog(state, 'warn', `[AI] ${shipId} 已不在舰队中，任务中断（${aiCoreName(assignment.coreType)} 已归还）。`)
      continue
    }
    if (assignment.task.kind === 'mining') {
      advanceAiMining(state, shipId, assignment, deltaMs, ctx)
    } else {
      advanceAiExpedition(state, shipId, assignment, ctx)
    }
  }
}

/** AI 采矿任务推进（真实毫秒口径；循环/周转周期按效率拉长） */
function advanceAiMining(
  state: GameState,
  shipId: string,
  assignment: AiAssignment,
  deltaMs: number,
  ctx: SimContext,
): void {
  const task = assignment.task as AiMiningTaskState
  const eff = aiEfficiency(state, ctx, assignment.coreType)
  const realCycleDiv = eff // 玩家周期 cycleMs ÷ eff = 副船真实周期
  const shipName = shipDisplayName(state, ctx, shipId)

  let remaining = deltaMs
  while (remaining > 0) {
    // 返航 / 出航（T4：腿分方向——出航空船腿减半（跃迁×2），返航满载用正常腿；再按效率拉长）
    if (task.phase === 'returning' || task.phase === 'outbound') {
      // T9：AI 采矿往返以"离矿带最近空间站"为基准（未建副站时 = 母港）
      const beltDef = ctx.belts.get(task.beltId)
      const stGal = beltDef?.galaxyId ? nearestStationGalaxyId(state, ctx, beltDef.galaxyId) : HOME_GALAXY_ID
      const legBase =
        task.phase === 'outbound'
          ? oneOutboundLegMs(state, ctx, task.beltId, shipId, stGal)
          : oneLegMs(state, ctx, task.beltId, shipId, stGal)
      const legMsReal = Math.max(1, Math.round(legBase / eff))
      const need = legMsReal - task.phaseAccMs
      if (remaining < need) {
        task.phaseAccMs += remaining
        remaining = 0
        break
      }
      remaining -= need
      task.phaseAccMs = 0
      if (task.phase === 'returning') {
        // 到港：把船上货仓全部卸入物品仓库
        const cargo = state.fleet[shipId]?.cargo
        let moved = 0
        if (cargo) {
          for (const [itemId, units] of Object.entries(cargo)) {
            if (units > 0) {
              state.warehouse.items[itemId] = (state.warehouse.items[itemId] ?? 0) + units
              moved += units
            }
          }
          for (const itemId of Object.keys(cargo)) delete cargo[itemId]
        }
        const belt = ctx.belts.get(task.beltId)
        const oreName = belt ? ctx.items.get(belt.oreId)?.name ?? '' : ''
        addLog(
          state,
          'trade',
          `[AI·${shipName}] 自动返港：把 ${moved.toLocaleString('zh-CN')} 单位${oreName}卸入物品仓库（本趟采得 ${task.tripUnits} 单位）。`,
        )
        task.phase = 'outbound'
        task.tripUnits = 0
      } else {
        // 到达矿带：恢复采掘（V13：AI 船实际抵达 → 点亮该星系）
        const belt = ctx.belts.get(task.beltId)
        if (belt?.galaxyId) markExplored(state, belt.galaxyId)
        task.phase = 'mining'
        task.cycleAccMs = 0
      }
      continue
    }

    // 采掘：逐循环结算（周期 = 玩家 cycleMs ÷ eff）
    const params = getMiningParams(state, ctx, { shipId, beltId: task.beltId })
    if (!params) {
      delete state.aiAssignments[shipId]
      gainAiCore(state, assignment.coreType)
      addLog(state, 'warn', `[AI·${shipName}] 矿带数据缺失，任务终止（${aiCoreName(assignment.coreType)} 已归还）。`)
      return
    }
    const cycleReal = Math.max(1, Math.ceil(params.cycleMs / realCycleDiv))
    if (task.cycleAccMs < cycleReal) {
      const need = cycleReal - task.cycleAccMs
      const take = Math.min(remaining, need)
      task.cycleAccMs += take
      remaining -= take
      if (task.cycleAccMs < cycleReal) break
    }
    task.cycleAccMs = 0

    // V16 复合带：本循环先掷产物（决定单位体积与入舱品种；与主控同一随机源）
    const beltDef = ctx.belts.get(task.beltId)
    const oreNow = rollBeltOutput(state, ctx, beltDef)

    // 满舱检查（货仓放不下整个循环 → 自动返航）
    const oreM3PerCycle = params.unitsPerCycle * (oreNow?.unitM3 ?? params.ore.unitM3)
    if (oreM3PerCycle > freeCargoFor(state, shipId, ctx)) {
      task.phase = 'returning'
      task.phaseAccMs = 0
      addLog(
        state,
        'info',
        `[AI·${shipName}] 货仓已满（本趟 ${task.tripUnits} 单位${oreNow?.name ?? params.ore.name}）：自动返航卸货。`,
      )
      continue
    }
    // 富矿脉判定与主控一致（随机源共享）
    let units = params.unitsPerCycle
    if (nextRandom(state.rng) < ctx.balance.richVeinChance) {
      units *= 2
      addLog(state, 'info', `[AI·${shipName}] 富矿脉！本循环产量翻倍。`)
    }
    if (!oreNow) {
      // 数据缺失：按主产物入舱兜底（正常情况下 roll 不会返回 null）
      const cargoFallback = state.fleet[shipId]!.cargo
      cargoFallback[params.ore.id] = (cargoFallback[params.ore.id] ?? 0) + units
      task.tripUnits += units
      continue
    }
    const cargo = state.fleet[shipId]!.cargo
    cargo[oreNow.id] = (cargo[oreNow.id] ?? 0) + units
    task.tripUnits += units
  }
}

type AiMiningTaskState = Extract<GameState['aiAssignments'][string]['task'], { kind: 'mining' }>

/** 副船货仓剩余空间 */
function freeCargoFor(state: GameState, shipId: string, ctx: SimContext): number {
  const ship = fleetDefOf(state, ctx, shipId)
  if (!ship) return 0
  const fitted = state.fleet[shipId]?.fitted
  const cargoModuleId = fitted?.cargo ?? null
  const cargoDef = cargoModuleId ? ctx.modules.get(cargoModuleId) : undefined
  const bonus = cargoDef && cargoDef.slot === 'cargo' ? cargoDef.bonus : 0
  const cap = Math.round(ship.cargoM3 * (1 + bonus))
  let used = 0
  const cargo = state.fleet[shipId]?.cargo ?? {}
  for (const [itemId, units] of Object.entries(cargo)) {
    used += units * (ctx.items.get(itemId)?.unitM3 ?? 0)
  }
  return Math.max(0, cap - used)
}

/** AI 远征推进（V12 两阶段：out → battle；战斗由实时引擎推进，结束即结算归还核心） */
export function advanceAiExpedition(
  state: GameState,
  shipId: string,
  assignment: AiAssignment,
  ctx: SimContext,
): void {
  const shipName = shipDisplayName(state, ctx, shipId)
  for (let guard = 0; guard < 5; guard++) {
    const current = state.aiAssignments[shipId]
    if (!current) return
    const task = current.task as AiExpeditionTaskState
    if (task.phase === 'out') {
      if (state.gameMs < task.finishAtGameMs) return
      // 到港开战（开战时刻 = 到达时刻，离线大推进同帧打完）
      const battle = startBattleFor(state, ctx, shipId, task.anomalyId, task.finishAtGameMs)
      if (!battle) {
        delete state.aiAssignments[shipId]
        gainAiCore(state, current.coreType)
        addLog(state, 'warn', `[AI·${shipName}] 远征目标数据缺失，任务取消（${aiCoreName(current.coreType)} 已归还）。`)
        return
      }
      task.battle = battle
      task.phase = 'battle'
      // V13 探索：AI 船实际到港开战 → 点亮目标星系
      const anomalyDef = ctx.anomalies.get(task.anomalyId)
      if (anomalyDef?.galaxyId) markExplored(state, anomalyDef.galaxyId)
      addLog(state, 'info', `[AI·${shipName}] 抵达目标，进入交火。`)
      continue
    }
    if (task.phase === 'battle') {
      if (!task.battle) {
        delete state.aiAssignments[shipId]
        gainAiCore(state, current.coreType)
        addLog(state, 'warn', `[AI·${shipName}] 战斗数据缺失，任务取消（${aiCoreName(current.coreType)} 已归还）。`)
        return
      }
      const anom = ctx.anomalies.get(task.anomalyId)
      advanceBattleFor(state, ctx, task.battle, shipId, task.anomalyId, anom ? aiFavorAdv(state, ctx, anom, shipId) : null)
      if (task.battle.ended) {
        resolveAiBattleOutcome(state, shipId, current, ctx)
      }
      return
    }
    return
  }
}

/** AI 交火结算：奖励全额 / 失利惩罚（与旧版语义一致，胜负来自实时战斗） */
function resolveAiBattleOutcome(state: GameState, shipId: string, assignment: AiAssignment, ctx: SimContext): void {
  const task = assignment.task as AiExpeditionTaskState
  const battle = task.battle!
  const shipName = shipDisplayName(state, ctx, shipId)
  // 弹药剩余退回物品仓库
  refundAmmo(state, playerAmmoSize(state, ctx, shipId), battle.ammo)
  const anomaly = ctx.anomalies.get(task.anomalyId)
  if (!anomaly) {
    delete state.aiAssignments[shipId]
    gainAiCore(state, assignment.coreType)
    addLog(state, 'warn', `[AI·${shipName}] 远征目标数据缺失，任务取消。`)
    return
  }
  const galaxy = ctx.galaxies.get(anomaly.galaxyId)
  const won = battle.ended === 'me'
  const durTxt = formatBattleDur(battle.lastTickGameMs - battle.startedAtGameMs)

  if (won) {
    // ── 胜利：奖励全额，战利品直接入物品仓库 ──
    const jitter = ctx.balance.rewardJitter
    const reward = Math.max(0, Math.round(anomaly.rewardIsk * (1 - jitter + 2 * jitter * nextRandom(state.rng))))
    state.wallet.isk += reward
    // AI 结算不发放声望、不写入首胜清单：协会声望只属于"亲手完成"（悬赏卡与指派解锁均以主控首胜为准）
    const lootText: string[] = []
    for (const row of anomaly.loot) {
      addWare(state, row.itemId, row.units)
      lootText.push(`${ctx.items.get(row.itemId)?.name ?? row.itemId}×${row.units}`)
    }
    const dropText = rollAiCoreDrop(state, anomaly.threat, ctx)
    addLog(
      state,
      'trade',
      `[AI·${shipName}] ⚔ 战报：${galaxy?.name ?? ''}·${anomaly.name} 大捷（交火 ${durTxt}，开火 ${battle.stats.meShots} 命中 ${battle.stats.meHits}）！` +
        `奖金 ${reward.toLocaleString('zh-CN')} ISK${lootText.length > 0 ? `，战利品 ${lootText.join('、')}` : ''}已入仓库` +
        `${dropText ? `，${dropText}` : ''}。`,
    )
  } else {
    // ── 失利：扣耐久 → 弃船骰 → 维修费（公式与主控一致，火力按本船指数） ──
    const bal = ctx.balance.combat
    const loss = bal.durabilityLossMin + (bal.durabilityLossMax - bal.durabilityLossMin) * nextRandom(state.rng)
    const fleetShip = state.fleet[shipId]
    const durabilityAfter = fleetShip ? fleetShip.durability - loss : 0
    if (fleetShip) fleetShip.durability = Math.max(0, durabilityAfter)

    if (!fleetShip || durabilityAfter <= 0 || nextRandom(state.rng) < aiAbandonChance(state, ctx, shipId, anomaly.threat, Math.max(0, durabilityAfter))) {
      delete state.aiAssignments[shipId]
      gainAiCore(state, assignment.coreType)
      loseShip(state, shipId, ctx, `[AI·${shipName}] 远征失利（${galaxy?.name ?? ''}·${anomaly.name}）后遭追击`)
      addLog(state, 'warn', `[AI·${shipName}] 舰船损毁，AI 任务结束（${aiCoreName(assignment.coreType)} 已归还）。`)
      return
    }
    const repair = Math.min(state.wallet.isk, Math.floor(anomaly.rewardIsk * bal.defeatCostRatio))
    state.wallet.isk -= repair
    const dur = Math.round((state.fleet[shipId]?.durability ?? 0) * 100)
    addLog(
      state,
      'warn',
      `[AI·${shipName}] ⚔ 战报：${galaxy?.name ?? ''}·${anomaly.name} 失利（交火 ${durTxt}），维修花去 ${repair.toLocaleString('zh-CN')} ISK（耐久 ${dur}%）。`,
    )
  }
  // 任务结束：核心归还核心库
  delete state.aiAssignments[shipId]
  gainAiCore(state, assignment.coreType)
  if ((state.fleet[shipId]?.durability ?? 1) <= 0.3 && won === false) {
    const r = repairShip(state, shipId, ctx)
    if (r.ok) {
      addLog(state, 'trade', `[AI·${shipName}] 耐久过低，已自动回港维修至 100%。`)
    } else {
      addLog(state, 'warn', `[AI·${shipName}] 耐久过低但维修费不足，请尽快手动维修。`)
    }
  }
}

function formatBattleDur(ms: number): string {
  const sec = Math.max(1, Math.round(ms / 1000))
  return sec >= 60 ? `${Math.floor(sec / 60)}分${sec % 60}秒` : `${sec}秒`
}

/** AI 船弃船率（与主控公式一致；火力按本船火力指数，避免引用主控远征状态） */
function aiAbandonChance(state: GameState, ctx: SimContext, shipId: string, threat: number, durability: number): number {
  const bal = ctx.balance.combat
  const power = calcPower(state, ctx, shipId)
  const base = threat > 0 ? threat / (threat + 2 * power) : 0
  const clamped = Math.min(bal.maxAbandonChance, Math.max(bal.minAbandonChance, base))
  const shipDef = fleetDefOf(state, ctx, shipId)
  const agility = shipDef?.agility ?? 0.4
  const durabilityPenalty = bal.durabilityFactor + (1 - bal.durabilityFactor) * Math.max(0, Math.min(1, durability))
  const agilityEscape = 1 - bal.agilityEscapeFactor * agility
  return clamped * durabilityPenalty * agilityEscape
}

type AiExpeditionTaskState = Extract<GameState['aiAssignments'][string]['task'], { kind: 'expedition' }>

/** 远征胜利后的 AI 核心掉落（按威胁取最高档，逐条掷骰），返回掉落文本（可为空串） */
function rollAiCoreDrop(state: GameState, threat: number, ctx: SimContext): string {
  const drops = ctx.balance.aiCore.drops
  let matched: (typeof drops)[number] | null = null
  for (const entry of drops) {
    if (threat >= entry.minThreat) matched = entry
  }
  if (!matched) return ''
  const gained: AiCoreType[] = []
  for (const reward of matched.rewards) {
    if (nextRandom(state.rng) < reward.chance) {
      gainAiCore(state, reward.type)
      gained.push(reward.type)
    }
  }
  if (gained.length === 0) return ''
  return `缴获 ${gained.map((t) => `${aiCoreName(t)}×1`).join('、')}`
}
