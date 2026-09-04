/**
 * 采矿作业（M1 基础 + v7 自动循环状态机 + T4 显式行程/换驾驶善后）。
 *
 * 模型（中文说明）：
 * - 采矿是自动循环：前往矿带(出航) → 采掘(挖到货舱满) → 返航 → 卸货入物品仓库 → 出航 → 采掘…；
 *   卸载由"物品仓库"承接（货仓清空），所以可以无限循环（仓库无限容量）；
 * - autoCycle（默认开）：满舱自动周转；玩家可勾选 stopAfterTrip「本次返航后停止」；
 * - T4 显式行程：点开采先进入"前往矿带"（出航）阶段，到带才开始采掘；
 *   往返不对称（船长定稿）：满载/返航单程 = 进出港基准 120 秒（balance.mining.localLegMs）
 *   + 远处航程（按船跃迁/航行技能）；出航是空船出门 → 跃迁速度×2 → 出航单程减半
 *   （oneOutboundLegMs：本地出航 60 秒；远带出航 ≈ (航程+基准)/2）；
 * - 换驾驶善后（船长定稿 2026-09-04）：采矿作业中直接在舰船页切换驾驶——换船成功，
 *   旧船按当前阶段转入 shipReturns 自动返航（倒计时，到港自动卸货入仓库），采矿作业随之结束；
 *   取消原"换船重采"按钮与自动续采语义；
 * - 循环时长/产量受采矿技能与采集器装备加成；每循环按种子随机抽"富矿脉"；
 * - 日志克制：只在 开始/停止/满舱转返航/卸货完成/富矿脉/换驾驶善后 时写。
 */
import { addLog } from './state'
import type { CommandResult } from './engine'
import type { GameState, MiningState } from './state'
import type { BeltDef, ItemDef, ShipDef, SimContext } from './types'
import { nextRandom } from './rng'
import { isMineableItem } from './labels'
import { addItem, freeCargoM3, unloadCargoOfShipToWarehouse, unloadCargoToWarehouse } from './inventory'
import { DSI_FACTION_ID, HOME_GALAXY_ID, recallExpedition, shortestTravelMinutes, standingOf } from './expedition'
import { travelLegMs, travelMinutesEff } from './travel'
import { actionBlockReason, markExplored } from './explore'
import { nearestStationGalaxyId } from './location'
import { fleetDefOf, shipDisplayName } from './instances'
import { familyModules } from './equipment'

/** 一次循环的实际参数（技能+装备加成后的最终值） */
export interface MiningParams {
  ship: ShipDef
  belt: BeltDef
  ore: ItemDef
  /** 实际循环时长（毫秒） */
  cycleMs: number
  /** 实际每循环产量（单位） */
  unitsPerCycle: number
}

/** 富矿勘探学（rich-vein-prospecting，P1）：富矿脉概率系数（每级 ×1.2，基础 1%） */
export function richVeinFactor(state: GameState): number {
  const lv = Math.min(5, state.skills.trained['rich-vein-prospecting'] ?? 0)
  return 1 + 0.2 * lv
}

/** 指定船在指定矿带的循环参数（缺省：当前驾驶船 + 当前采矿作业矿带） */
export function getMiningParams(
  state: GameState,
  ctx: SimContext,
  opts?: { shipId?: string; beltId?: string },
): MiningParams | null {
  const shipId = opts?.shipId ?? state.shipId
  const ship = fleetDefOf(state, ctx, shipId)
  if (!ship) return null
  const beltId = opts?.beltId ?? state.mining.beltId
  if (!beltId) return null
  const belt = ctx.belts.get(beltId)
  if (!belt) return null
  const ore = ctx.items.get(belt.oreId)
  if (!ore) return null

  const bal = ctx.balance.mining
  const timeLevel = state.skills.trained[bal.timeSkillId] ?? 0
  const yieldLevel = state.skills.trained[bal.yieldSkillId] ?? 0
  const timeRatio = Math.max(bal.minTimeRatio, 1 - bal.timePerLevel * timeLevel)
  // 调试模式 debugQuick：循环固定 1 秒
  const cycleMs = state.debugQuick ? 1000 : Math.max(1, Math.round(ship.cycleSeconds * 1000 * timeRatio))
  // V18 复数矿枪：高槽全部采集器件加成求和（线性叠加）
  const minerDefs = familyModules(state, ctx, shipId, 'miner')
  let minerBonus = 0
  for (const def of minerDefs) minerBonus += def.bonus ?? 0
  // 产量乘链（全乘算；EVE 同源多技能先例）：采矿技术 + 星质地质学(全矿) + 深井爆破学(低品级矿)
  // + 深空采集学(气/冰) → 最后 × 矿枪(复数 Σ)
  let prodMult = 1 + bal.yieldPerLevel * yieldLevel
  const astroLv = Math.min(5, state.skills.trained['astro-geology'] ?? 0)
  if (astroLv > 0) prodMult *= 1 + 0.04 * astroLv
  if ((ore.baseSellPriceIsk ?? 0) <= 55) {
    // 低品级矿：富凡 12 / 灼烧 18 / 希莫非特 55
    const blastLv = Math.min(5, state.skills.trained['deep-hole-blasting'] ?? 0)
    if (blastLv > 0) prodMult *= 1 + 0.06 * blastLv
  }
  if (ore.kind === 'gas' || ore.kind === 'ice') {
    const deepLv = Math.min(5, state.skills.trained['deep-space-harvesting'] ?? 0)
    if (deepLv > 0) prodMult *= 1 + 0.05 * deepLv
  }
  const unitsPerCycle = Math.max(1, Math.floor(ship.oreUnitsPerCycle * prodMult * (1 + minerBonus)))
  return { ship, belt, ore, cycleMs, unitsPerCycle }
}

/**
 * V16 复合矿带：按权重池掷出本循环产物（每循环一掷；单产物带不掷，保持既有 rng 序列）。
 * 主控与 AI 共用（随机源同一）。权重非法/抽空时回落到主产物 belt.oreId。
 */
export function rollBeltOutput(state: GameState, ctx: SimContext, belt: BeltDef | undefined): ItemDef | null {
  const fallback = belt ? ctx.items.get(belt.oreId) ?? null : null
  if (!belt || !belt.outputs || belt.outputs.length < 2) return fallback
  let total = 0
  for (const o of belt.outputs) total += Math.max(0, o.weight)
  if (total <= 0) return fallback
  let r = nextRandom(state.rng) * total
  for (const o of belt.outputs) {
    r -= Math.max(0, o.weight)
    if (r < 0) return ctx.items.get(o.itemId) ?? fallback
  }
  return fallback
}

/** 采集点到空间站/出发点的单程额外航行分钟（无星系归属/母港星系 = 0；T8：起点可传当前位置） */
export function beltTravelMinutes(ctx: SimContext, belt: BeltDef | undefined, from?: string | null): number {
  if (!belt?.galaxyId) return 0
  const mins = shortestTravelMinutes(ctx, from && from !== HOME_GALAXY_ID ? from : HOME_GALAXY_ID, belt.galaxyId)
  if (!Number.isFinite(mins)) return 0
  return Math.max(0, mins)
}

/**
 * 显式行程"满载/返航"单程时长（毫秒，T4 船长定稿）：
 * = 进出港基准 120 秒（balance.mining.localLegMs，母港本地/无星系归属带同为该值）
 *   + 矿带所在星系距"出发点"的实际航程（V12.1：按船的跃迁速度与航行技能换算，见 travel.ts；
 *   shipId 缺省 = 当前驾驶船；T8 origin 缺省 = 空间站/母港）。
 * 该值用于：返航（满仓回城，以空间站为基准）、满舱周转的返航段、换船善后账本。
 */
export function oneLegMs(
  state: GameState,
  ctx: SimContext,
  beltId?: string | null,
  shipId?: string,
  origin?: string | null,
): number {
  if (state.debugQuick) return 1000 // 调试模式：行程腿固定 1 秒
  const belt = beltId ? ctx.belts.get(beltId) : undefined
  const mins = beltTravelMinutes(ctx, belt, origin)
  return Math.max(1, ctx.balance.mining.localLegMs + travelLegMs(state, ctx, mins, shipId))
}

/**
 * 显式行程"出航/前往矿带"单程时长（毫秒，T4）：空船出门，跃迁速度×2 →
 * 出航单程 = 满载单程的一半（调试模式仍固定 1 秒）。
 */
export function oneOutboundLegMs(
  state: GameState,
  ctx: SimContext,
  beltId?: string | null,
  shipId?: string,
  origin?: string | null,
): number {
  if (state.debugQuick) return 1000
  return Math.max(1, Math.round(oneLegMs(state, ctx, beltId, shipId, origin) / 2))
}

/**
 * 采矿通用前置检查（startMining 与"远征转开采"入口共用）：
 * 采集点数据 / 矿石 / 声望 / 舰队 / 星系可达与探索封锁。
 * 不含"采矿/远征进行中"互斥（由各入口自己裁决）。
 */
function miningPreflight(state: GameState, beltId: string, ctx: SimContext): CommandResult {
  const belt = ctx.belts.get(beltId)
  if (!belt) return { ok: false, error: `未知采集点：${beltId}。` }
  const ore = ctx.items.get(belt.oreId)
  if (!isMineableItem(ore)) return { ok: false, error: `采集点「${belt.name}」没有对应的可采集资源数据。` }
  const needStanding = belt.standingReq ?? 0
  if (needStanding > 0) {
    const have = standingOf(state, DSI_FACTION_ID)
    if (have < needStanding) {
      return { ok: false, error: `采集点「${belt.name}」需要「深空工业协会」声望 ${needStanding}（当前 ${have}）——多完成悬赏任务攒声望。` }
    }
  }
  if (!state.fleet[state.shipId]) return { ok: false, error: '当前舰船数据缺失，无法开采。' }
  // 挂星系的采集点必须能从母港到达（无航路 → 拒绝）
  if (belt.galaxyId && belt.galaxyId !== HOME_GALAXY_ID) {
    const travel = shortestTravelMinutes(ctx, HOME_GALAXY_ID, belt.galaxyId)
    if (!Number.isFinite(travel)) {
      return { ok: false, error: `「${belt.name}」所在星系没有从母港可达的航线，无法前往开采。` }
    }
    // V13 探索封锁：所在星系未点亮（且非母港）→ 拒绝开工
    const block = actionBlockReason(state, belt.galaxyId)
    if (block) return { ok: false, error: block }
  }
  return { ok: true }
}

/** 玩家指令：开始在指定采集点开采（矿石/气体/冰矿；高价值采集点有协会声望门槛） */
export function startMining(state: GameState, beltId: string, ctx: SimContext): CommandResult {
  const pre = miningPreflight(state, beltId, ctx)
  if (!pre.ok) return pre
  const belt = ctx.belts.get(beltId)!
  if (state.mining.active) return { ok: false, error: '采矿作业进行中：请先停止当前开采。' }
  if (state.expedition.active) return { ok: false, error: '远征进行中：舰船不在空间站，无法采矿。' }
  if (state.standby.active) return { ok: false, error: '舰船正在前往待命星系途中——请先取消（顶部活动栏）。' }
  if (state.refineRun.active && state.refineRun.worker === 'pilot') {
    return { ok: false, error: '精炼炉正由你亲自运转：先停炉才能出海（想自动精炼可改用 AI 核心驱动）。' }
  }

  // T8：从野外停留点出发 → 记录起点（首次到带后清空；自动循环以空间站为基准）；野外标记交作业表达
  const fromField = state.awayGalaxy !== null ? state.awayGalaxy : null
  state.awayGalaxy = null

  const m = state.mining
  m.active = true
  m.beltId = beltId
  m.phase = 'outbound' // T4 显式行程：先前往矿带，到带后才开始采掘
  m.cycleAccMs = 0
  m.phaseAccMs = 0
  m.tripUnits = 0
  m.autoCycle = m.autoCycle !== false // 默认开，除非玩家关过
  m.stopAfterTrip = m.stopAfterTrip === true
  m.originGalaxy = fromField

  const params = getMiningParams(state, ctx)
  const shipName = shipDisplayName(state, ctx, state.shipId)
  const cycleNote = params ? `（约 ${Math.round(params.cycleMs / 100) / 10} 秒/循环，每循环 ${params.unitsPerCycle} 单位）` : ''
  const outSec = Math.max(1, Math.round(oneOutboundLegMs(state, ctx, beltId, undefined, fromField) / 1000))
  const retSec = Math.max(1, Math.round(oneLegMs(state, ctx, beltId) / 1000))
  const travelStatic = beltTravelMinutes(ctx, belt, fromField)
  const travelMin = travelStatic > 0 ? travelMinutesEff(state, ctx, travelStatic) : 0
  const fromNote = fromField ? `从「${ctx.galaxies.get(fromField)?.name ?? fromField}」出发，` : ''
  const travelNote = travelMin > 0 ? `，其中航程约 ${travelMin} 分钟` : ''
  addLog(
    state,
    'info',
    `开始开采：${belt.name}。${shipName} ${fromNote}空船出航前往矿带${cycleNote}（前往约 ${outSec} 秒——空船跃迁×2；满载返航约 ${retSec} 秒${travelNote}）。` +
      (m.autoCycle
        ? ' 已启用自动循环：满舱自动返航空间站卸货，卸完自动再出航。'
        : ' 自动循环已关闭：货舱满后将停在矿带。'),
  )
  return { ok: true }
}

/**
 * T4 延后项（船长 2026-09-04 定稿）：远征中直接转开采。
 * 前置校验全部通过后：取消当前远征（交火中除外——须先打完或撤退），
 * 若该远征由「连续出击」自动发起则连击同步停止；随后按普通采矿从母港/空间站出发。
 * 直接调用 startMining 在远征中仍会被拒绝——本入口是确认后的唯一转场路径。
 */
export function startMiningFromExpedition(state: GameState, beltId: string, ctx: SimContext): CommandResult {
  const pre = miningPreflight(state, beltId, ctx)
  if (!pre.ok) return pre
  const exp = state.expedition
  if (!exp.active) return startMining(state, beltId, ctx) // 无远征 → 普通开采
  if (exp.phase === 'battle') {
    return { ok: false, error: '交火中无法抽身采矿——请先让战斗分出胜负，或撤退脱离。' }
  }
  // 转场即手动收手：由连击发起的本次远征同步停止连击（同撤退口径）
  if (state.autoLoopAnomalyId !== null && state.autoLoopAnomalyId === exp.anomalyId) {
    state.autoLoopAnomalyId = null
    addLog(state, 'info', '连续出击已停止（转开采）。')
  }
  // 召回式取消远征（无战果；battle 已排除）→ 船回到母港/空间站，随后照常开矿
  const recalled = recallExpedition(state, ctx)
  if (!recalled.ok) return recalled
  return startMining(state, beltId, ctx)
}

/** 停止开采（手动）：任何阶段都会停（若在返航/出航中，货物留在船上） */
export function stopMining(state: GameState, ctx: SimContext): boolean {
  if (!state.mining.active) return false
  const m = state.mining
  const belt = m.beltId ? ctx.belts.get(m.beltId) : undefined
  const ore = belt ? ctx.items.get(belt.oreId) : undefined
  const oreName = ore ? ore.name : ''
  const trip = m.tripUnits
  const phaseNote = m.phase === 'returning' ? '（返航途中，货物留在船上）' : m.phase === 'outbound' ? '（出航途中）' : ''
  const beltName = belt ? belt.name : '矿带'
  m.active = false
  m.beltId = null
  m.phase = 'mining'
  m.cycleAccMs = 0
  m.phaseAccMs = 0
  m.tripUnits = 0
  m.originGalaxy = null
  addLog(state, 'info', `已停止开采（${beltName}）。本趟共采得 ${trip} 单位${oreName}${phaseNote}。`)
  return true
}

/**
 * 引擎内部调用：按流逝时间推进采矿状态机（采掘循环 / 返航 / 出航）。
 * 剩余时间管理器：时间按"阶段所需"逐段消费，一次大推进可完整穿越
 * 采掘→返航→卸货→出航→采掘 多个阶段，富余时间永不丢失。
 */
export function advanceMining(state: GameState, deltaMs: number, ctx: SimContext): void {
  const m = state.mining
  if (!m.active || deltaMs <= 0) return
  if (!state.fleet[state.shipId]) {
    m.active = false
    m.beltId = null
    m.phase = 'mining'
    addLog(state, 'warn', '当前舰船数据缺失，采矿作业已停止。')
    return
  }

  let remaining = deltaMs
  while (m.active && remaining > 0) {
    // ── 返航 / 出航阶段（T4 往返不对称：出航空船跃迁×2 → 腿减半；T8：初始出航按出发地计程；
    //    T9：自动循环往返目标 = 离矿带最近的空间站） ──
    if (m.phase === 'returning' || m.phase === 'outbound') {
      const beltDef = m.beltId ? ctx.belts.get(m.beltId) : undefined
      const stGal = beltDef?.galaxyId ? nearestStationGalaxyId(state, ctx, beltDef.galaxyId) : HOME_GALAXY_ID
      const leg =
        m.phase === 'outbound'
          ? oneOutboundLegMs(state, ctx, m.beltId, undefined, m.originGalaxy ?? stGal)
          : oneLegMs(state, ctx, m.beltId, undefined, stGal)
      const need = leg - m.phaseAccMs
      if (remaining < need) {
        m.phaseAccMs += remaining
        remaining = 0
        break
      }
      remaining -= need
      m.phaseAccMs = 0
      if (m.phase === 'returning') {
        // 到港：整仓卸入物品仓库
        const belt = m.beltId ? ctx.belts.get(m.beltId) : undefined
        const ore = belt ? ctx.items.get(belt.oreId) : undefined
        const oreName = ore ? ore.name : '货物'
        const trip = m.tripUnits
        const moved = unloadCargoToWarehouse(state)
        addLog(
          state,
          'info',
          `自动返港：已把货仓全部卸入物品仓库（共 ${moved.toLocaleString('zh-CN')} 单位，本趟采得 ${oreName}×${trip}）。`,
        )
        if (m.stopAfterTrip || !m.autoCycle) {
          // 按设定结束循环
          m.active = false
          m.beltId = null
          m.phase = 'mining'
          m.cycleAccMs = 0
          m.tripUnits = 0
          addLog(state, 'info', '自动循环已结束（按设定返港后停止）。')
          break
        }
        m.phase = 'outbound'
        m.tripUnits = 0
      } else {
        // 到达矿带：恢复采掘（V13：实际抵达该星系 → 点亮探索）；起点使命完成，自动循环改以空间站为基准
        const belt = m.beltId ? ctx.belts.get(m.beltId) : undefined
        if (belt?.galaxyId) markExplored(state, belt.galaxyId)
        m.phase = 'mining'
        m.cycleAccMs = 0
        m.originGalaxy = null
      }
      continue
    }

    // ── 采掘阶段：逐循环精确消费 ──
    const params = getMiningParams(state, ctx)
    if (!params) {
      m.active = false
      m.beltId = null
      m.phase = 'mining'
      m.cycleAccMs = 0
      addLog(state, 'warn', '矿带/矿石数据缺失，采矿作业已停止。')
      return
    }
    const cycleMs = params.cycleMs
    if (m.cycleAccMs < cycleMs) {
      const need = cycleMs - m.cycleAccMs
      const take = Math.min(remaining, need)
      m.cycleAccMs += take
      remaining -= take
      if (m.cycleAccMs < cycleMs) break // 时间不足完成一个循环
    }
    m.cycleAccMs = 0 // 一个循环完成

    // V16 复合带：本循环先掷产物（决定单位体积与入舱品种）
    const beltDef = m.beltId ? ctx.belts.get(m.beltId) : undefined
    const oreNow = rollBeltOutput(state, ctx, beltDef)
    if (!oreNow) {
      m.active = false
      m.beltId = null
      m.phase = 'mining'
      m.cycleAccMs = 0
      addLog(state, 'warn', '矿带产物数据缺失，采矿作业已停止。')
      return
    }

    // 满舱检查：放不下整个循环 → 自动返航或停采
    const oreM3PerCycle = params.unitsPerCycle * oreNow.unitM3
    if (oreM3PerCycle > freeCargoM3(state, ctx)) {
      if (m.autoCycle) {
        m.phase = 'returning'
        m.phaseAccMs = 0
        addLog(
          state,
          'info',
          `货舱已满（本趟 ${m.tripUnits} 单位${oreNow.name}）：自动返航空间站卸货（返航单程约 ${Math.round(oneLegMs(state, ctx, m.beltId, undefined, beltDef?.galaxyId ? nearestStationGalaxyId(state, ctx, beltDef.galaxyId) : HOME_GALAXY_ID) / 1000)} 秒；空船出航更快）。`,
        )
        continue // 剩余时间转入返航阶段
      }
      m.active = false
      m.beltId = null
      m.phase = 'mining'
      m.cycleAccMs = 0
      addLog(
        state,
        'warn',
        `货舱已满（本趟 ${m.tripUnits} 单位${oreNow.name}），开采自动停止（未开启自动循环）。`,
      )
      return
    }

    // 结算一个循环（先抽富矿脉，再入舱）
    let units = params.unitsPerCycle
    if (nextRandom(state.rng) < ctx.balance.richVeinChance * richVeinFactor(state)) {
      units *= 2
      addLog(state, 'info', `富矿脉！本循环产量翻倍，获得 ${units} 单位${oreNow.name}。`)
    }
    addItem(state, oreNow.id, units)
    m.tripUnits += units
  }
}

/** 给界面的一次性状态快照 */
export interface MiningView {
  active: boolean
  beltId: string | null
  beltName: string
  oreName: string
  shipName: string
  /** 阶段：采掘/返航/出航 */
  phase: 'mining' | 'returning' | 'outbound'
  phaseLabel: string
  cycleMs: number
  cycleAccMs: number
  unitsPerCycle: number
  /** 阶段进度 0~100 */
  percent: number
  /** 当前阶段剩余毫秒（采掘阶段 = 本循环剩余；null = 无法给出） */
  remainingMs: number | null
  tripUnits: number
  autoCycle: boolean
  stopAfterTrip: boolean
  richVeinChance: number
  /** 满载/返航单程毫秒（T4：出航空船更快，见 outboundLegMs） */
  legMs: number
  /** 出航（空船）单程毫秒（T4：跃迁×2 → 约 legMs 一半） */
  outboundLegMs: number
}

export function miningStatus(state: GameState, ctx: SimContext): MiningView {
  const m = state.mining
  const params = getMiningParams(state, ctx)
  const belt = m.beltId ? ctx.belts.get(m.beltId) : undefined
  const ore = belt ? ctx.items.get(belt.oreId) : undefined
  const shipName = shipDisplayName(state, ctx, state.shipId)
  const stGal = belt?.galaxyId ? nearestStationGalaxyId(state, ctx, belt.galaxyId) : HOME_GALAXY_ID
  const leg = oneLegMs(state, ctx, m.beltId, undefined, stGal)
  const outLeg = oneOutboundLegMs(state, ctx, m.beltId, undefined, m.originGalaxy ?? stGal)
  // 阶段按方向用各自的腿（百分比/剩余都以"当前阶段实际腿长"为准）
  const phaseLeg = m.phase === 'outbound' ? outLeg : leg

  const phaseLabel =
    m.phase === 'returning' ? '返航卸货中' : m.phase === 'outbound' ? '出航中' : '采掘中'

  if (!m.active) {
    return {
      active: false,
      beltId: m.beltId,
      beltName: belt?.name ?? '',
      oreName: ore?.name ?? '',
      shipName: shipName,
      phase: 'mining',
      phaseLabel: '',
      cycleMs: params?.cycleMs ?? 1,
      cycleAccMs: m.cycleAccMs,
      unitsPerCycle: params?.unitsPerCycle ?? 0,
      percent: 0,
      remainingMs: null,
      tripUnits: m.tripUnits,
      autoCycle: m.autoCycle,
      stopAfterTrip: m.stopAfterTrip,
      richVeinChance: ctx.balance.richVeinChance * richVeinFactor(state),
      legMs: leg,
      outboundLegMs: outLeg,
    }
  }

  let percent = 0
  let remainingMs: number | null = null
  if (m.phase === 'mining' && params) {
    percent = Math.min(100, (m.cycleAccMs / params.cycleMs) * 100)
    remainingMs = Math.max(0, params.cycleMs - m.cycleAccMs)
  } else if (m.phase !== 'mining') {
    percent = Math.min(100, (m.phaseAccMs / phaseLeg) * 100)
    remainingMs = Math.max(0, phaseLeg - m.phaseAccMs)
  }
  return {
    active: true,
    beltId: m.beltId,
    beltName: belt?.name ?? '',
    oreName: ore?.name ?? '',
    shipName: shipName,
    phase: m.phase,
    phaseLabel,
    cycleMs: params?.cycleMs ?? 1,
    cycleAccMs: m.cycleAccMs,
    unitsPerCycle: params?.unitsPerCycle ?? 0,
    percent,
    remainingMs,
    tripUnits: m.tripUnits,
    autoCycle: m.autoCycle,
    stopAfterTrip: m.stopAfterTrip,
    richVeinChance: ctx.balance.richVeinChance * richVeinFactor(state),
    legMs: leg,
    outboundLegMs: outLeg,
  }
}

/** 切换自动循环 / 本次返航后停止 的设置（UI 复选框用） */
export function setMiningAutoCycle(state: GameState, autoCycle: boolean): void {
  state.mining.autoCycle = autoCycle
  if (!autoCycle) state.mining.stopAfterTrip = false
}

export function setMiningStopAfterTrip(state: GameState, stopAfterTrip: boolean): void {
  state.mining.stopAfterTrip = stopAfterTrip
  if (stopAfterTrip) state.mining.autoCycle = true
}

/* ───────── T4 换驾驶善后：采矿自动返航账本 ───────── */

/** 该船是否在"换驾驶善后返航"中（返回途中，未到港不可再指派/卖出/驾驶） */
export function shipInReturn(state: GameState, shipId: string): boolean {
  return shipId in state.shipReturns
}

/** 引擎内部：推进"善后返航"账本；到港即整仓卸入物品仓库并清账（离线大步长同样一次覆盖） */
export function advanceShipReturns(state: GameState, deltaMs: number, ctx: SimContext): void {
  if (deltaMs <= 0) return
  for (const shipId of Object.keys(state.shipReturns)) {
    const r = state.shipReturns[shipId]
    if (!r) continue
    r.phaseAccMs = Math.min(r.legMs, r.phaseAccMs + deltaMs)
    if (r.phaseAccMs >= r.legMs) {
      delete state.shipReturns[shipId]
      const moved = unloadCargoOfShipToWarehouse(state, shipId)
      const name = shipDisplayName(state, ctx, shipId)
      addLog(
        state,
        'info',
        moved > 0
          ? `${name} 已返港并卸货（换船善后）：${moved.toLocaleString('zh-CN')} 单位已入物品仓库。`
          : `${name} 已随换船善后返港（货仓为空）。`,
      )
    }
  }
}
