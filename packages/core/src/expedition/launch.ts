/** 战斗域职责拆分，保持原计算与顺序。 */
import { type GameState, shipLockedInWormhole, addLog } from '../state'
import type { SimContext } from '../types'
import type { CommandResult } from '../engine'
import { pilotUnavailableReason, haltCurrentActivity, applyActivityGate } from '../activityGate'
import { standingOf, DSI_FACTION_ID } from '../standing'
import { actionBlockReason, markExplored } from '../explore'
import { bountyCooldownRemainingMs } from './cooldown'
import { type LairTier, isLairCandidate, lairNameOf } from '../lairs'
import { weekendZoneLiveAt } from '../weekendBounty'
import { weekendClockOf, weekendFoeCardsSelfPriced, weekendAssaultThreatOf } from '../weekendEvent'
import { withBattleRangeCheck } from '../battleRangeMemory'
import { isFactionBounty } from '../sideTasks'
import { originGalaxyOf } from '../location'
import { shortestTravelMinutes, travelLegMs } from '../travel'
import { ceilFinalQuantity } from '../quantity'
import { calcPower } from './tactics'
import { rollTravelEvent, maybeFireTravelEvent } from './travel'
import { shipDisplayName } from '../instances'
import { weekendBattleInvolvedOf } from '../weekendBattle'
import { startBattleFor, createPlayerSpec } from '../combat'
import { autoLoopInvasionGalaxy } from './loopState'

/**
 * 出征通用前置检查（startExpedition 与"采矿转战"入口共用）：
 * 目标数据 / 舰队 / 声望 / 星系探索 / 重复冷却 / 扫描 / 返港行程。
 * 不含"采矿/远征进行中"互斥（由各入口自己裁决）与起点可达性（由各入口按自身起点检查）。
 */
export function expeditionPreflight(state: GameState, ctx: SimContext, anomalyId: string, galaxyId?: string): CommandResult {
  const anomaly = ctx.anomalies.get(anomalyId)
  if (!anomaly) return { ok: false, error: `未知目标：${anomalyId}。`, errorId: 'core.expedition.003', errorParams: { p1: anomalyId } }
  /** ⚠ `wormholePilotHoldReason` 已撤（2026-09-21 统一批）：扫描虫洞 = 可自动停、人在洞里 = 拒，都归 `activityGate` */
  const pilotBlock = pilotUnavailableReason(state)
  if (pilotBlock) return { ok: false, error: pilotBlock }
  const standing = standingOf(state, DSI_FACTION_ID)
  if (standing < anomaly.standingReq) {
    return {
      ok: false,
      error: `需要「深空工业协会」声望 ${anomaly.standingReq}（累计 ${standing}），多完成低级目标攒声望。`,
      errorId: 'core.expedition.036',
      errorParams: { p1: anomaly.standingReq, p2: standing },
    }
  }
  // V13 探索封锁：目标星系未点亮（且非母港）→ 拒绝出发
  const block = actionBlockReason(state, galaxyId ?? anomaly.galaxyId)
  if (block) return { ok: false, error: block, ...(galaxyId !== undefined ? { errorId: 'core.invasionLoop.008' } : {}) }
  // T8 重复冷却：同悬赏连续完成需要间隔（受该船扫描属性影响）
  const cd = bountyCooldownRemainingMs(state, anomalyId)
  if (cd > 0) {
    return {
      ok: false,
      error: `「${anomaly.name}」冷却中：重复出击需等待约 ${Math.max(1, Math.round(cd / 1000))} 秒。`,
      errorId: 'core.expedition.037',
      errorParams: { p1: anomaly.name, p2: Math.max(1, Math.round(cd / 1000)) },
    }
  }
  return { ok: true }
}

/** 玩家指令：出发远征（V12：out → battle → back；opts.desireM = 期望距离偏好；
 *  opts.lairTier = 赏金任务·窝点档位（非空 = 本次打的是派生窝点，威胁/波次/僚机按档位强化、
 *  奖金与稀有残骸按窝点口径结算，见 lairs.ts）。 */
export function startExpedition(
  state: GameState,
  anomalyId: string,
  ctx: SimContext,
  opts?: { desireM?: number; lairTier?: LairTier; foeGalaxyId?: string; rewardIskOverride?: number; confirmActivitySwitch?: boolean },
): CommandResult {
  const invasionSeq = opts?.foeGalaxyId && weekendZoneLiveAt(state, opts.foeGalaxyId, weekendClockOf(state)) ? state.weekendEvent?.seq : undefined
  return withBattleRangeCheck(state, { kind: 'expedition', cardId: anomalyId, options: opts, invasionSeq }, staged => startExpeditionMutable(staged, anomalyId, ctx, opts))
}

export function startExpeditionMutable(state: GameState, anomalyId: string, ctx: SimContext,
  opts?: { desireM?: number; lairTier?: LairTier; foeGalaxyId?: string; rewardIskOverride?: number; confirmActivitySwitch?: boolean }): CommandResult {
  const pre = expeditionPreflight(state, ctx, anomalyId, opts?.foeGalaxyId)
  if (!pre.ok) return pre
  const anomaly = ctx.anomalies.get(anomalyId)!
  // 窝点校验：目标必须可作窝点（有核心词、非隐藏、非 B 族）。
  // 2026-09-10 船长定：档位不再由声望封顶（改由日板席位决定），接取门槛只看卡自身声望要求
  // ——后者已在 expeditionPreflight 里把关。
  if (opts?.lairTier !== undefined && !isLairCandidate(anomaly)) {
    return { ok: false, error: '该目标不是敌人窝点，无法作为赏金任务目标。', errorId: 'core.expedition.010' }
  }
  // 敌对派系活跃（2026-09-10 船长定）：目标正是当日选中星系的**常驻悬赏** → 本场吃 +10% 奖金/+10% 威胁
  // （与窝点互斥：派系只针对普通悬赏，带着档位出击窝点时不叠加）
  const factionHit = opts?.lairTier === undefined && isFactionBounty(state, anomaly)
  if (state.expedition.active) return { ok: false, error: '远征进行中，等战报回来再说吧。', errorId: 'core.expedition.011' }
  // 虫洞锁定（船长 2026-09-13：「已经进洞的船将被锁定」＋「洞内战斗时，洞外可以开新战斗」）：
  // 洞外这场战斗的锚点只能是**洞外的船**——主控若在洞里，先暂停并召回整队再出击。
  if (shipLockedInWormhole(state, state.shipId)) {
    return { ok: false, error: '主控在虫洞里（已锁定）：先暂停并召回整队，才能出击。', errorId: 'core.expedition.013' }
  }
  /**
   * **其余主控活动 ⇒ 走统一判据**（**2026-09-21 船长令**：能直接切就自动取消当前活动，只有长途运输
   * 那一档先警告；远征/快递/战斗中/洞里/返航途中一律拒）——原先这里散着 6 条硬拒，现已收进
   * `activityGate.applyActivityGate`。⚠ 放在**本入口自己的前置校验之后**（目标/声望/探索/冷却）。
   */
  if (opts?.confirmActivitySwitch) haltCurrentActivity(state, ctx)
  const gateSkip = applyActivityGate(state, 'expedition', ctx)
  if (gateSkip) return gateSkip
  /**
   * T8：出发地 = 当前位置（野外停留点或空间站）——⚠ **算在判据之后**：掩护巡逻那类可自动停的活动
   * 停下时舰船已即时归位（`awayGalaxy` 归零）⇒ 出发地要按"停机之后"的位置算，免得出现
   * "按巡逻星系的航路校验、却从母港出发"的错位。`awayGalaxy` 复位同样放在**全部校验之后**
   * （2026-09-21 统一批顺手修正：原先它在航路校验之前清标记，校验失败也照清）。
   */
  const from = originGalaxyOf(state, ctx)
  const targetGalaxy = opts?.foeGalaxyId ?? anomaly.galaxyId
  const outMinutes = shortestTravelMinutes(ctx, from, targetGalaxy)
  if (!Number.isFinite(outMinutes)) return { ok: false, error: '目标星系不在已知航路内。', errorId: 'core.expedition.024' }
  const fromName = ctx.galaxies.get(from)?.name ?? from
  state.awayGalaxy = null
  // V12.1：按出发时的船跃迁与航行技能锁定单程耗时（途中升级不影响本次）；用于失利返航腿并入
  const outMs = travelLegMs(state, ctx, outMinutes)
  const now = state.gameMs
  const exp = state.expedition
  exp.active = true
  exp.anomalyId = anomalyId
  /**
   * **本场远征实际打的是哪个星系**（2026-09-25：周末入侵接线）——只在调用方显式给出时写，
   * 其余情形**清掉**（防上一场的残留把归属算错）。`weekendBattleInvolvedOf` 优先读它。
   */
  if (opts?.foeGalaxyId !== undefined && opts.foeGalaxyId.length > 0) exp.foeGalaxyId = opts.foeGalaxyId
  else delete exp.foeGalaxyId
  /**
   * **奖励基底覆写**（2026-09-25 船长令「主动出击也要每场重抽」配套）：周末入侵的**敌舰每场重抽**，
   * 但**价钱不变**——奖励恒 = 该星系原卡 ×1.4（由 `weekendBounty.weekendAssaultDrawOf` 算好传进来）。
   * 缺省清掉（老路径逐字不变）。
   */
  if (opts?.rewardIskOverride !== undefined && Number.isFinite(opts.rewardIskOverride)) {
    exp.rewardIskOverride = Math.max(0, ceilFinalQuantity(opts.rewardIskOverride))
  } else delete exp.rewardIskOverride
  exp.phase = 'out' // 占位：本函数内随即转入 battle（去程取消：开战时刻 = 现在）
  exp.battle = null
  exp.finishAtGameMs = now // 开战时刻 = 下达时刻（不再有去程等待）
  exp.outMs = outMs
  exp.combatMs = anomaly.combatSeconds * 1000
  exp.durationMs = outMs + exp.combatMs
  exp.power = calcPower(state, ctx)
  exp.eventId = rollTravelEvent(state, ctx)
  exp.eventFired = false
  exp.returnReason = undefined
  exp.lairTier = opts?.lairTier // 赏金任务·窝点档位（普通悬赏 = undefined）
  exp.factionActive = factionHit // 派系活跃目标（当日选中星系的常驻悬赏 = true）
  // 显式距离仅随本次开战记录到实际卡ID，不再改写星系偏好。
  const shipName = shipDisplayName(state, ctx, state.shipId)
  const outName = opts?.lairTier ? lairNameOf(anomaly, opts.lairTier) : anomaly.name
  addLog(
    state,
    'combat',
    `⚔ 远征开始（${outName}）：${shipName} 自「${fromName}」起航，立即抵达目标空域进入交火。胜利后自动返航最近空间站（母港或已建成副站，含去返全程，不可召回）；失利/撤退同样自动返航。`,
    'core.expedition.040',
    { p1: outName, p2: shipName, p3: fromName },
  )
  // 途中事件（若有）在出发瞬间触发一次（不再有去程中段等待）
  if (exp.eventId) maybeFireTravelEvent(state, ctx)
  // 去程取消：立即开战（beginBattleAt 会点亮目标星系并写"进入交火"日志）
  const opened = beginBattleAt(state, ctx, anomalyId, state.shipId, now, opts?.desireM)
  if (!opened) {
    exp.active = false
    exp.anomalyId = null
    exp.battle = null
    exp.phase = 'out'
    exp.finishAtGameMs = 0
    return { ok: false, error: '目标已不存在，无法开战。', errorId: 'core.expedition.014' }
  }
  return { ok: true }
}

/**
 * T4 延后项（船长 2026-09-04 定稿）：采矿中直接转战悬赏。
 * 前置校验全部通过后：采矿作业终止（同手动停止——停哪算哪、已采的货随船带走），
 * 远征从「当前矿带所在星系」出发（矿带无星系 = 本地，从母港出发）。
 * 直接调用 startExpedition 在采矿中仍会被拒绝——本入口是确认后的唯一转场路径。
 */
export function startExpeditionFromMining(
  state: GameState,
  anomalyId: string,
  ctx: SimContext,
  opts?: { desireM?: number; lairTier?: LairTier; foeGalaxyId?: string; rewardIskOverride?: number },
): CommandResult {
  const invasionSeq = opts?.foeGalaxyId && weekendZoneLiveAt(state, opts.foeGalaxyId, weekendClockOf(state)) ? state.weekendEvent?.seq : undefined
  return withBattleRangeCheck(state, { kind: 'expedition', cardId: anomalyId, fromMining: true, options: opts, invasionSeq }, staged => startExpeditionFromMiningMutable(staged, anomalyId, ctx, opts))
}

export function startExpeditionFromMiningMutable(state: GameState, anomalyId: string, ctx: SimContext,
  opts?: { desireM?: number; lairTier?: LairTier; foeGalaxyId?: string; rewardIskOverride?: number }): CommandResult {
  const pre = expeditionPreflight(state, ctx, anomalyId)
  if (!pre.ok) return pre
  if (state.expedition.active) return { ok: false, error: '远征进行中，等战报回来再说吧。', errorId: 'core.expedition.011' }
  /** ⚠ 掩护巡逻那条硬拒已撤（2026-09-21 统一批）：它是**可自动停**那一档，由内层 `startExpedition` 的 gate 停掉 */
  const m = state.mining
  if (!m.active) return startExpedition(state, anomalyId, ctx, opts) // 无采矿作业 → 普通出发
  const anomaly = ctx.anomalies.get(anomalyId)!
  const belt = m.beltId ? ctx.belts.get(m.beltId) : undefined
  // 从矿带所在星系出发（本地矿带 = 母港停靠出发）
  const from = belt?.galaxyId ?? null
  if (from !== null) {
    const reach = shortestTravelMinutes(ctx, from, anomaly.galaxyId)
    if (!Number.isFinite(reach)) return { ok: false, error: '目标星系不在矿带所在星系的已知航路内。', errorId: 'core.expedition.015' }
  }
  const ore = belt ? ctx.items.get(belt.oreId) : undefined
  const trip = m.tripUnits
  const beltName = belt ? belt.name : '矿带'
  // 终止采矿（同手动停止语义：进度清零、货随船）
  m.active = false
  m.beltId = null
  m.phase = 'mining'
  m.cycleAccMs = 0
  m.phaseAccMs = 0
  m.tripUnits = 0
  m.originGalaxy = null
  m.rvLeft = 0 // 转战悬赏即离开矿带作业：红利窗口清零
  // 矿带在异星系：以"野外停泊"表达起点（startExpedition 会读取并清空）
  if (from !== null) state.awayGalaxy = from
  const shipName = shipDisplayName(state, ctx, state.shipId)
  /** 转战目标名（日志模板与参数同源，避免两处各算一次） */
  const bountyTargetName = opts?.lairTier ? lairNameOf(anomaly, opts.lairTier) : anomaly.name
  addLog(
    state,
    'industry',
    `采矿已结束（${shipName} 转战悬赏「${bountyTargetName}」）：离开「${beltName}」${trip > 0 ? `——本趟采得的 ${trip} 单位${ore?.name ?? ''}仍在船上` : '（本趟尚无收获）'}，记得回港卸货。`,
    trip > 0 ? 'core.expedition.041' : 'core.expedition.042',
    trip > 0
      ? { p1: shipName, p2: bountyTargetName, p3: beltName, p4: trip, p5: ore?.name ?? '' }
      : { p1: shipName, p2: bountyTargetName, p3: beltName },
  )
  return startExpedition(state, anomalyId, ctx, opts)
}

/** 到港开战：距离由实际敌卡记忆决定；旧在途开战同样经过射程变化门禁。 */
export function beginBattleAt(state: GameState, ctx: SimContext, anomalyId: string, shipId: string, arrivalGameMs: number, desireM?: number): boolean {
  return withBattleRangeCheck(state, { kind: 'expedition-arrival', cardId: anomalyId, shipId }, staged => ({
    ok: beginBattleAtMutable(staged, ctx, anomalyId, shipId, arrivalGameMs, desireM),
  })).ok
}

export function beginBattleAtMutable(state: GameState, ctx: SimContext, anomalyId: string, shipId: string, arrivalGameMs: number, desireM?: number): boolean {
  /**
   * **周末入侵**：被占星系的悬赏战要打**入侵强度** ⇒ 用覆写口传进去。
   * ⚠ H 族（独立卡）**不传**：它的卡面威胁就是实测价（90 / 108 / 129），覆写 78/120 只会把标签写假
   * （船长 2026-09-25「按照新规对 H 族调整」）；A/C/G 三族仍走 78 / 120 的占位口径。
   */
  const weekendAssault = weekendBattleInvolvedOf(state, ctx, anomalyId, state.wallMs ?? Date.now())
  const weekendEv = state.weekendEvent
  const weekendThreat =
    weekendAssault && weekendEv && !weekendFoeCardsSelfPriced(weekendEv.family)
      ? weekendAssaultThreatOf(weekendEv, weekendAssault.galaxyId)
      : undefined
  // 实际anomalyId已由出发时抽卡锁定，不再以卡自带母港或作战星系取距离。
  const battle = startBattleFor(
    state,
    ctx,
    shipId,
    anomalyId,
    arrivalGameMs,
    desireM,
    weekendThreat !== undefined ? { threat: weekendThreat } : undefined,
    weekendAssault !== undefined,
  )
  if (!battle) return false
  const exp = state.expedition
  exp.phase = 'battle'
  exp.battle = battle
  // 连续作战保险（2026-09-08 船长定）：巡回场次挂撤退阈值——本场结构剩余 <50%（损失过半）
  // 时战斗步进自动中止（advanceBattleFor 置 autoEscaped），随后走轻损撤退结算，绝不拖到弃船
  /**
   * ⚠ **2026-09-25 扩到"入侵重复出击"**（船长批：「**入侵「重复出击」也挂 0.5 撤退保险**」）：
   * 原来只有"常驻悬赏那条循环 ＋ 本场打的就是那张卡"才挂，而入侵循环**两头都不成立**
   * （开循环时会把 `autoLoopAnomalyId` 清空；入侵每场打的是**抽出来的卡**，id ≠ 循环目标）
   * ⇒ 入侵循环的场次会一路打到结构归零 → 判负 → 掷弃船骰（3%~50%）⇒ **可能丢船**。
   * 现按同口径补上：**循环开着 ＋ 本场打的是被占星系**（`foeGalaxyId` = 出征时落的那个）即挂。
   */
  const loopOnThisCard = state.autoLoopAnomalyId !== null && state.autoLoopAnomalyId === anomalyId
  const invasionLoopOn = autoLoopInvasionGalaxy(state) !== null && exp.foeGalaxyId !== undefined
  if (loopOnThisCard || invasionLoopOn) {
    exp.battle.hullEscapeFrac = 0.5
  }
  const anomaly = ctx.anomalies.get(anomalyId)
  // V13 探索：实际到港 → 点亮该星系（去程结束进入交火 = 已抵达）
  const actualGalaxy = exp.foeGalaxyId ?? anomaly?.galaxyId
  if (actualGalaxy) markExplored(state, actualGalaxy)
  const loaded = battle.ammo.kin + battle.ammo.exp + battle.ammo.pla
  // ⟪文案调整 2026-10-13⟫ 与实际建档同源；没有攻击武器不单独触发基础炮禁用。
  const spec = createPlayerSpec(state, ctx, shipId, battle.ammoIds)
  const armed = spec?.weapons.some(w => w.src !== 'base' && !w.disabled) === true
  const baseEnabled = spec?.weapons.some(w => w.src === 'base' && !w.disabled) === true
  const targetName = anomaly ? (exp.lairTier ? lairNameOf(anomaly, exp.lairTier) : anomaly.name) : ''
  /** 窝点尾注（可选槽；有则挂 `p3Id` 走槽译文） */
  const lairTail = exp.lairTier ? '（赏金任务目标：窝点守备强于常驻悬赏，注意弹药与修理件。）' : ''
  addLog(
    state,
    'combat',
    `⚔ 抵达目标（${targetName}）：进入交火。${armed ? (loaded > 0 ? `预载弹药 ${loaded} 发。` : '警告：未携带弹药，武器无法开火（基础舰炮可还击）。') : baseEnabled ? '未装配武器：仅基础舰炮还击。' : '高槽已装配装备，基础舰炮已禁用；未装配攻击武器。'}` +
      (exp.lairTier ? '（赏金任务目标：窝点守备强于常驻悬赏，注意弹药与修理件。）' : ''),
    !armed ? baseEnabled ? 'core.expedition.045' : 'core.expedition.062' : loaded > 0 ? 'core.expedition.043' : 'core.expedition.044',
    {
      p1: targetName,
      ...(armed && loaded > 0 ? { p2: loaded } : {}),
      p3: lairTail,
      ...(lairTail !== '' ? { p3Id: 'core.expedition.046' } : {}),
    },
  )
  return true
}
