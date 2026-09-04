/**
 * 远征（M3 + V12 两阶段 + T8 停留语义）：派舰船去远方星系的异常点，
 * 流程 = 去程(out) → 实时交火(battle) →（胜利 = 结算并停留该星系 / 失利 = 自动返航 back）。
 * 交火由 V12 战斗引擎（combat.ts）确定性推进；离线大步长与在线小步同引擎。到点语义：
 * - out：finishAtGameMs = 到港时刻（去程结束即开战）；出发地 = 当前位置（野外/空间站，T8）
 * - battle：无固定结束时刻；结束由战斗引擎判定（battle.ended），结算后：
 *   胜 → 远征结束 + 船停留目标星系（awayGalaxy）+ 悬赏冷却计时开始；
 *   负 → 转 back 自动返航（维修/弃船按既有惩罚在结算时发生）
 * - back：finishAtGameMs = 到家时刻，到点 active=false
 */
import { addLog, HOME_GALAXY_ID } from './state'
import type { CommandResult } from './engine'
import type { GameState } from './state'
import type { AnomalyDef, SimContext, TravelEventDef } from './types'
import { nextRandom } from './rng'
import { addItem, freeCargoM3 } from './inventory'
import { loseShip, repairWithKits } from './shipyard'
import { fleetDefOf, shipDisplayName } from './instances'
import { formatDurationMs } from './time'
import { originGalaxyOf } from './location'
import { onArriveAtGalaxy } from './station'
import { shortestTravelMinutes, travelLegMs, travelMinutesEff } from './travel'
import {
  advanceBattleFor,
  battleOpenM,
  battleWinPreview,
  createFoeSpecs,
  createPlayerSpec,
  desiredRangeFor,
  refundAmmo,
  startBattleFor,
} from './combat'
import { actionBlockReason, markExplored } from './explore'
import { familyModules } from './equipment'

/** 母港星系 id（内容层约定；与 state.HOME_GALAXY_ID 同值，经此转发保持既有 import 面不变） */
export { HOME_GALAXY_ID }
/** 主要势力 id（声望绑定方） */
export const DSI_FACTION_ID = 'dsi'

/** 星系间最短航程（分钟）——定义在 travel.ts（V12.1），此处转发保持既有调用面 */
export { shortestTravelMinutes }

/** 查询某势力声望（默认 0） */
export function standingOf(state: GameState, factionId: string): number {
  return state.standings[factionId] ?? 0
}

/**
 * 火力指数（V17 口径：基础 + 炮术学 + 船型加成；仅展示/弃船率叙事用）。
 * 装备不再乘入——炮台等装备的真实表现由 battleWinPreview（期望推演，含武器参数）评估，
 * 指数只反映"技能 + 船体"的骨架战力，避免旧口径把模块百分比冒充实时强度。
 */
export function calcPower(state: GameState, ctx: SimContext, shipId: string = state.shipId): number {
  const bal = ctx.balance.combat
  const gunnery = state.skills.trained[bal.gunnerySkillId] ?? 0
  const base = bal.basePower + bal.powerPerLevel * gunnery
  const shipDef = fleetDefOf(state, ctx, shipId)
  return Math.round(base * (1 + (shipDef?.powerBonus ?? 0)))
}

/**
 * 胜率（旧口径保留：仅展示兼容；预估请用 battleWinPreview）。
 * 新口径下 AI 门槛与远征面板一律使用 battleWinPreview。
 */
export function winChance(power: number, threat: number, ctx: SimContext): number {
  const bal = ctx.balance.combat
  if (threat <= 0) return bal.maxWinChance
  const raw = power / (power + threat)
  return Math.min(bal.maxWinChance, Math.max(bal.minWinChance, raw))
}

/** 远征去程耗时估算（展示用；T8：按当前位置出发的单程 + 参考交火时长；完成后停留，返航另计） */
export function calcExpeditionDurationMs(state: GameState, ctx: SimContext, anomaly: AnomalyDef): number {
  const outMinutes = shortestTravelMinutes(ctx, originGalaxyOf(state, ctx), anomaly.galaxyId)
  if (!Number.isFinite(outMinutes)) return 0
  return travelLegMs(state, ctx, outMinutes) + anomaly.combatSeconds * 1000
}

/** 玩家战术选择 */
export type BattleTacticChoice = 'assault' | 'mid' | 'kite'

/** 按战术算期望距离（出发前/战斗中改战术均用；目标未指明时用当前远征目标） */
export function battleTacticDesire(
  state: GameState,
  ctx: SimContext,
  tactic: BattleTacticChoice,
  anomalyId: string | null = state.expedition.anomalyId,
): number {
  const anomaly = anomalyId ? ctx.anomalies.get(anomalyId) : undefined
  const me = createPlayerSpec(state, ctx, state.shipId)
  if (!anomaly || !me) return 0
  return desiredRangeFor(me, tactic, ctx.balance.battle)
}

/** 玩家指令：战斗中调整期望距离（手动拖距离条/战术切换共用）；同时记忆偏好供下次出发沿用 */
export function setBattleDesire(state: GameState, desireM: number, ctx: SimContext): CommandResult {
  const battle = state.expedition.battle
  if (!battle) return { ok: false, error: '当前不在交火中。' }
  const me = createPlayerSpec(state, ctx, state.shipId)
  const anomaly = state.expedition.anomalyId ? ctx.anomalies.get(state.expedition.anomalyId) : undefined
  if (!me || !anomaly) return { ok: false, error: '战斗数据缺失。' }
  const foes = createFoeSpecs(anomaly, ctx.balance.battle)
  const maxD = battleOpenM(me, foes, ctx.balance.battle)
  const minD = ctx.balance.battle.minDistanceM
  const clamped = Math.round(Math.min(maxD, Math.max(minD, desireM)))
  battle.myDesireM = clamped
  state.expedition.desirePrefM = clamped // 记忆偏好（跨会话/下次出发沿用）
  return { ok: true }
}

/** 出发抽"途中事件"（沿用 M5；去程过半触发） */
function rollTravelEvent(state: GameState, ctx: SimContext): string | null {
  if (ctx.travelEvents.length === 0) return null
  if (nextRandom(state.rng) >= ctx.balance.travelEventChance) return null
  const total = ctx.travelEvents.reduce((sum, e) => sum + e.weight, 0)
  if (total <= 0) return ctx.travelEvents[0]!.id
  let roll = nextRandom(state.rng) * total
  for (const event of ctx.travelEvents) {
    roll -= event.weight
    if (roll < 0) return event.id
  }
  return ctx.travelEvents[0]!.id
}

function maybeFireTravelEvent(state: GameState, ctx: SimContext): void {
  const exp = state.expedition
  if (!exp.active || !exp.eventId || exp.eventFired) return
  // 去程中点 = 到港时刻 - 单程时长/2
  if (state.gameMs < exp.finishAtGameMs - Math.floor(exp.outMs / 2)) return
  const eventDef = ctx.travelEvents.find((e) => e.id === exp.eventId)
  exp.eventFired = true
  if (!eventDef) return
  applyTravelEvent(state, ctx, eventDef)
}

function applyTravelEvent(state: GameState, ctx: SimContext, eventDef: TravelEventDef): void {
  const effect = eventDef.effect
  if (effect.kind === 'none') {
    addLog(state, 'info', eventDef.text)
    return
  }
  if (effect.kind === 'isk') {
    const span = Math.max(0, effect.max - effect.min)
    const amount = effect.min + Math.floor(nextRandom(state.rng) * (span + 1))
    state.wallet.isk += amount
    addLog(state, 'trade', `${eventDef.text}（+${amount.toLocaleString('zh-CN')} ISK）`)
    return
  }
  if (effect.kind === 'mineral') {
    const def = ctx.items.get(effect.itemId)
    if (!def) {
      addLog(state, 'warn', '途中事件的数据缺失（物品不存在），本次事件落空。')
      return
    }
    addItem(state, effect.itemId, effect.units)
    addLog(state, 'info', `${eventDef.text}（获得 ${def.name}×${effect.units}）`)
  }
}

/**
 * 出征通用前置检查（startExpedition 与"采矿转战"入口共用）：
 * 目标数据 / 舰队 / 声望 / 星系探索 / 重复冷却 / 扫描 / 返港行程。
 * 不含"采矿/远征进行中"互斥（由各入口自己裁决）与起点可达性（由各入口按自身起点检查）。
 */
function expeditionPreflight(state: GameState, ctx: SimContext, anomalyId: string): CommandResult {
  const anomaly = ctx.anomalies.get(anomalyId)
  if (!anomaly) return { ok: false, error: `未知目标：${anomalyId}。` }
  if (!state.fleet[state.shipId]) return { ok: false, error: '当前舰船数据缺失，无法出航。' }
  const standing = standingOf(state, DSI_FACTION_ID)
  if (standing < anomaly.standingReq) {
    return { ok: false, error: `需要「深空工业协会」声望 ${anomaly.standingReq}（当前 ${standing}），多完成低级目标攒声望。` }
  }
  // V13 探索封锁：目标星系未点亮（且非母港）→ 拒绝出发
  const block = actionBlockReason(state, anomaly.galaxyId)
  if (block) return { ok: false, error: block }
  // T8 重复冷却：同悬赏连续完成需要间隔（受该船扫描属性影响）
  const cd = bountyCooldownRemainingMs(state, anomalyId)
  if (cd > 0) {
    return { ok: false, error: `「${anomaly.name}」冷却中：重复出击需等待约 ${Math.max(1, Math.round(cd / 1000))} 秒。` }
  }
  if (state.scanning.active) return { ok: false, error: '扫描探索进行中：请先终止扫描。' }
  if (state.transit.active) return { ok: false, error: '返航空间站途中：到站后再安排远征。' }
  if (state.refineRun.active && state.refineRun.worker === 'pilot') {
    return { ok: false, error: '精炼炉正由你亲自运转：先停炉才能出发远征（想自动精炼可改用 AI 核心驱动）。' }
  }
  return { ok: true }
}

/** 玩家指令：出发远征（V12：out → battle → back；opts.desireM = 期望距离偏好） */
export function startExpedition(
  state: GameState,
  anomalyId: string,
  ctx: SimContext,
  opts?: { desireM?: number },
): CommandResult {
  const pre = expeditionPreflight(state, ctx, anomalyId)
  if (!pre.ok) return pre
  const anomaly = ctx.anomalies.get(anomalyId)!
  if (state.mining.active) return { ok: false, error: '采矿作业进行中：请先停止开采，舰船才能出航。' }
  if (state.expedition.active) return { ok: false, error: '远征进行中，等战报回来再说吧。' }
  if (state.standby.active) return { ok: false, error: '舰船正在前往待命星系途中——请先取消（顶部活动栏）。' }
  // T8：出发地 = 当前位置（野外停留点或空间站）；作业开始即清野外标记（位置交给作业自身表达）
  const from = originGalaxyOf(state, ctx)
  const fromName = ctx.galaxies.get(from)?.name ?? from
  state.awayGalaxy = null
  const outMinutes = shortestTravelMinutes(ctx, from, anomaly.galaxyId)
  if (!Number.isFinite(outMinutes)) return { ok: false, error: '目标星系不在已知航路内。' }
  // V12.1：按出发时的船跃迁与航行技能锁定单程耗时（途中升级不影响本次）
  const outMs = travelLegMs(state, ctx, outMinutes)
  const now = state.gameMs
  const exp = state.expedition
  exp.active = true
  exp.anomalyId = anomalyId
  exp.phase = 'out'
  exp.battle = null
  exp.finishAtGameMs = now + outMs
  exp.outMs = outMs
  exp.combatMs = anomaly.combatSeconds * 1000
  exp.durationMs = outMs + exp.combatMs
  exp.power = calcPower(state, ctx)
  exp.eventId = rollTravelEvent(state, ctx)
  exp.eventFired = false
  // 期望距离偏好：本次显式传入优先；否则沿用上次记忆（默认在开战时取有效射程中点）
  if (opts?.desireM !== undefined) {
    exp.desirePrefM = Math.max(ctx.balance.battle.minDistanceM, Math.round(opts.desireM))
  }
  const shipName = shipDisplayName(state, ctx, state.shipId)
  addLog(
    state,
    'info',
    `⚔ 远征出发（${anomaly.name}）：${shipName} 从「${fromName}」启程，预计 ${travelMinutesEff(state, ctx, outMinutes)} 分钟抵达；胜后停留该星系（可连续出击或返航），失利自动返航。`,
  )
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
  opts?: { desireM?: number },
): CommandResult {
  const pre = expeditionPreflight(state, ctx, anomalyId)
  if (!pre.ok) return pre
  if (state.expedition.active) return { ok: false, error: '远征进行中，等战报回来再说吧。' }
  if (state.standby.active) return { ok: false, error: '舰船正在前往待命星系途中——请先取消（顶部活动栏）。' }
  const m = state.mining
  if (!m.active) return startExpedition(state, anomalyId, ctx, opts) // 无采矿作业 → 普通出发
  const anomaly = ctx.anomalies.get(anomalyId)!
  const belt = m.beltId ? ctx.belts.get(m.beltId) : undefined
  // 从矿带所在星系出发（本地矿带 = 母港停靠出发）
  const from = belt?.galaxyId ?? null
  if (from !== null) {
    const reach = shortestTravelMinutes(ctx, from, anomaly.galaxyId)
    if (!Number.isFinite(reach)) return { ok: false, error: '目标星系不在矿带所在星系的已知航路内。' }
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
  // 矿带在异星系：以"野外停泊"表达起点（startExpedition 会读取并清空）
  if (from !== null) state.awayGalaxy = from
  const shipName = shipDisplayName(state, ctx, state.shipId)
  addLog(
    state,
    'warn',
    `采矿已结束（${shipName} 转战悬赏「${anomaly.name}」）：离开「${beltName}」${trip > 0 ? `——本趟采得的 ${trip} 单位${ore?.name ?? ''}仍在船上` : '（本趟尚无收获）'}，记得回港卸货。`,
  )
  return startExpedition(state, anomalyId, ctx, opts)
}

/** 到港开战（主控）：开战时刻 = 到港时刻；期望距离取已记忆偏好（无则有效射程中点） */
export function beginBattleAt(state: GameState, ctx: SimContext, anomalyId: string, shipId: string, arrivalGameMs: number): boolean {
  const battle = startBattleFor(state, ctx, shipId, anomalyId, arrivalGameMs, state.expedition.desirePrefM)
  if (!battle) return false
  const exp = state.expedition
  exp.phase = 'battle'
  exp.battle = battle
  const anomaly = ctx.anomalies.get(anomalyId)
  // V13 探索：实际到港 → 点亮该星系（去程结束进入交火 = 已抵达）
  if (anomaly?.galaxyId) markExplored(state, anomaly.galaxyId)
  const loaded = battle.ammo.kin + battle.ammo.exp + battle.ammo.pla
  const hasTurret = familyModules(state, ctx, shipId, 'turret').length > 0
  addLog(
    state,
    'info',
    `⚔ 抵达目标（${anomaly?.name ?? ''}）：进入交火。${hasTurret ? (loaded > 0 ? `预载弹药 ${loaded} 发。` : '警告：未携带弹药，炮台无法开火（基础舰炮可还击）。') : '未装配炮台：仅基础舰炮还击。'}`,
  )
  return true
}

/** 交火结束结算（主控）：奖励/惩罚 → 转返航 */
export function resolveBattleOutcome(state: GameState, ctx: SimContext): void {
  const exp = state.expedition
  const battle = exp.battle
  const anomaly = exp.anomalyId ? ctx.anomalies.get(exp.anomalyId) : undefined
  if (!battle || !anomaly) {
    exp.active = false
    exp.battle = null
    return
  }
  const won = battle.ended === 'me'
  const galaxy = ctx.galaxies.get(anomaly.galaxyId)
  refundAmmo(state, battle.ammo)
  const durTxt = formatDurationMs(battle.lastTickGameMs - battle.startedAtGameMs)

  if (won) {
    // ── 胜利：奖金 ±浮动 + 情报彩蛋 + 战利品 + 声望 ──
    const jitter = ctx.balance.rewardJitter
    const roll = 1 - jitter + 2 * jitter * nextRandom(state.rng)
    let reward = Math.max(0, Math.round(anomaly.rewardIsk * roll))
    if (nextRandom(state.rng) < 0.15) {
      const texts = [
        '舰队返航时打捞到一枚漂流信标，协会收购了上面的航路情报',
        '编队顺手清理了一块导航浮标，空间站维修部发来感谢金',
        '舰载传感器捕获一段加密信号，协会情报处兑换了报酬',
      ] as const
      const text = texts[Math.floor(nextRandom(state.rng) * texts.length)]!
      const bonus = Math.round(reward * 0.1)
      reward += bonus
      addLog(state, 'trade', `🎁 ${text}（+${bonus.toLocaleString('zh-CN')} ISK）`)
    }
    const lootText: string[] = []
    for (const row of anomaly.loot) {
      addItem(state, row.itemId, row.units)
      lootText.push(`${ctx.items.get(row.itemId)?.name ?? row.itemId}×${row.units}`)
    }
    state.wallet.isk += reward
    // 声望仅首胜发放（防低威胁目标被无限重复白刷声望；重复完成只拿 ISK/战利品）
    const firstBlood = !state.completedBounties.includes(anomaly.id)
    if (firstBlood) {
      state.standings[DSI_FACTION_ID] = standingOf(state, DSI_FACTION_ID) + anomaly.standingGain
      state.completedBounties.push(anomaly.id)
    }
    const stats = `交火 ${durTxt}（开火 ${battle.stats.meShots} 命中 ${battle.stats.meHits}，我方护盾余 ${Math.round(battle.units['player']?.hp.s ?? 0)}/甲 ${Math.round(battle.units['player']?.hp.a ?? 0)}/结构 ${Math.round(battle.units['player']?.hp.h ?? 0)}）`
    const lootPart = lootText.length > 0 ? `，缴获 ${lootText.join('、')}` : ''
    const standPart = firstBlood ? `协会声望 +${anomaly.standingGain}` : '该悬赏已首胜过：本次无额外声望'
    addLog(
      state,
      'trade',
      `⚔ 战报（${galaxy?.name ?? ''}·${anomaly.name}）：大捷！${stats}，奖金 ${reward.toLocaleString('zh-CN')} ISK${lootPart}，${standPart}。`,
    )
    // T8 胜利 = 结算并停留该星系：远征结束、船停在目标（母港星系=已回港）、悬赏冷却计时开始
    setBountyCooldown(state, ctx, anomaly.id)
    exp.active = false
    exp.anomalyId = null
    exp.phase = 'out'
    exp.battle = null
    exp.eventId = null
    exp.eventFired = false
    if (anomaly.galaxyId !== HOME_GALAXY_ID) {
      // T8/T9：胜利停留——若是建站点星系则视档位停靠工地/副站，并可能挂起介绍通讯
      onArriveAtGalaxy(state, ctx, anomaly.galaxyId)
      addLog(
        state,
        'info',
        `舰队停留「${galaxy?.name ?? anomaly.galaxyId}」——可连续出击同一目标（冷却 10 秒起）或「返航空间站」。`,
      )
    }
    return
  } else {
    // 失利：扣耐久 + 弃船骰 + 维修费（沿用旧机制）；若正处于连续出击环 → 停环
    if (state.autoLoopAnomalyId !== null && state.autoLoopAnomalyId === exp.anomalyId) {
      stopAutoLoopReason(state, '本次出击失利，舰队自动返航（可修整后再开）。')
    }
    const bal = ctx.balance.combat
    const loss = bal.durabilityLossMin + (bal.durabilityLossMax - bal.durabilityLossMin) * nextRandom(state.rng)
    const fleetShip = state.fleet[state.shipId]
    const durabilityAfter = fleetShip ? fleetShip.durability - loss : 1
    let abandoned = false
    if (durabilityAfter <= 0) {
      abandoned = true
    } else if (nextRandom(state.rng) < abandonChance(state, anomaly.threat, ctx)) {
      abandoned = true
    }
    if (abandoned) {
      // 弃船：无维修费，船+货仓+装备全损
      addLog(state, 'warn', `⚔ 战报（${galaxy?.name ?? ''}·${anomaly.name}）：遭重创（交火 ${durTxt}）……`)
      loseShip(state, state.shipId, ctx, `远征失利（${galaxy?.name ?? ''}·${anomaly.name}）后遭追击`)
      exp.active = false
      exp.battle = null
      exp.anomalyId = null
      return
    }
    if (fleetShip && loss > 0) {
      fleetShip.durability = Math.max(0, Math.round((fleetShip.durability - loss) * 1000) / 1000)
    }
    const repair = Math.min(state.wallet.isk, Math.floor(anomaly.rewardIsk * bal.defeatCostRatio))
    state.wallet.isk -= repair
    const shipName = shipDisplayName(state, ctx, state.shipId)
    addLog(
      state,
      'warn',
      `⚔ 战报（${galaxy?.name ?? ''}·${anomaly.name}）：失利（交火 ${durTxt}，开火 ${battle.stats.meShots} 命中 ${battle.stats.meHits}）……${shipName} 耐久 -${Math.round(loss * 100)}%，维修花去 ${repair.toLocaleString('zh-CN')} ISK。练练炮术学，记得给船做保养。`,
    )
  }
  // 转返航
  exp.battle = null
  exp.phase = 'back'
  exp.finishAtGameMs = state.gameMs + exp.outMs
  addLog(state, 'info', '舰队开始返航。')
}

/**
 * 玩家指令：战斗中主动撤退（Q1乙 轻损：只损失少量舰船耐久、无弃船骰、按比例维修费；
 * 耐久结算带下限保护——不足 0 时压到 5% 并显著告警，绝不因撤退直接弃船）。
 * 实现口径：扣损 = 战败扣损骰 ×0.5（约 8%~15%，最低 1%）——数值小，玩家侧只描述"少量损失"。
 * 仅"正在交火且未分胜负"时可撤；撤退即手动收手 → 同时停止连续出击（Q3甲）。
 */
export function retreatBattle(state: GameState, ctx: SimContext): CommandResult {
  const exp = state.expedition
  if (!exp.active || exp.phase !== 'battle' || !exp.battle) {
    return { ok: false, error: '当前不在交火中，无法撤退。' }
  }
  if (exp.battle.ended !== null) {
    return { ok: false, error: '战斗已分出胜负，正在结算——无法撤退。' }
  }
  const anomaly = exp.anomalyId ? ctx.anomalies.get(exp.anomalyId) : undefined
  const battle = exp.battle
  refundAmmo(state, battle.ammo)
  const durTxt = formatDurationMs(battle.lastTickGameMs - battle.startedAtGameMs)

  // 轻损：正常战败扣损骰 ×0.5；不做弃船骰
  const bal = ctx.balance.combat
  const baseLoss = bal.durabilityLossMin + (bal.durabilityLossMax - bal.durabilityLossMin) * nextRandom(state.rng)
  const loss = Math.max(0.01, Math.round(baseLoss * 500) / 1000) // 半损，最低 1%
  const fleetShip = state.fleet[state.shipId]
  let durabilityAfter = fleetShip ? Math.round((fleetShip.durability - loss) * 1000) / 1000 : 1
  if (durabilityAfter <= 0) {
    // 下限保护：绝不因撤退弃船，压到 5% 并显著告警
    durabilityAfter = 0.05
    addLog(
      state,
      'warn',
      '⚠ 撤退时船体结构濒临崩溃（耐久仅剩 5%）——请返港后立即全面维修。',
    )
  }
  if (fleetShip) {
    fleetShip.durability = Math.min(1, durabilityAfter)
  }
  // 维修费（战败口径 ×0.5，按钱包余量）
  const repair = Math.min(state.wallet.isk, Math.floor((anomaly?.rewardIsk ?? 0) * bal.defeatCostRatio * 0.5))
  state.wallet.isk -= repair
  const shipName = shipDisplayName(state, ctx, state.shipId)
  const targetName = anomaly?.name ?? exp.anomalyId ?? '目标'
  addLog(
    state,
    'warn',
    `⚔ 撤退（${targetName}）：${shipName} 主动脱离交火（交火 ${durTxt}）——耐久 -${Math.round(loss * 100)}%，维修花去 ${repair.toLocaleString('zh-CN')} ISK，正在返航。`,
  )
  // 手动收手 → 停连击（若有）
  if (state.autoLoopAnomalyId !== null && state.autoLoopAnomalyId === exp.anomalyId) {
    state.autoLoopAnomalyId = null
    addLog(state, 'info', '连续出击已停止（手动撤退）。')
  }
  // 转返航（沿用失利返回流程）
  exp.battle = null
  exp.phase = 'back'
  exp.finishAtGameMs = state.gameMs + exp.outMs
  addLog(state, 'info', '舰队脱离战场，自动返航。')
  return { ok: true }
}

/** 弃船概率（沿用旧公式；power 用火力指数） */export function abandonChance(
  state: GameState,
  threat: number,
  ctx: SimContext,
  shipId: string = state.shipId,
): number {
  const bal = ctx.balance.combat
  const exp = state.expedition
  const power = exp.power || calcPower(state, ctx, shipId)
  const base = threat > 0 ? threat / (threat + 2 * power) : 0
  const clamped = Math.min(bal.maxAbandonChance, Math.max(bal.minAbandonChance, base))
  const fleetShip = state.fleet[shipId]
  const durability = fleetShip?.durability ?? 1
  const shipDef = fleetDefOf(state, ctx, shipId)
  const agility = shipDef?.agility ?? 0.4
  const durabilityPenalty = bal.durabilityFactor + (1 - bal.durabilityFactor) * durability
  const agilityEscape = 1 - bal.agilityEscapeFactor * agility
  return clamped * durabilityPenalty * agilityEscape
}

/** 引擎内部：按阶段推进远征（时间已由 gameMs 表达；同帧内阶段可连续跨越，离线大推进亦然） */
export function advanceExpedition(state: GameState, ctx: SimContext): void {
  const exp = state.expedition
  for (let guard = 0; guard < 6; guard++) {
    if (!exp.active) return
    if (exp.phase === 'out') {
      maybeFireTravelEvent(state, ctx)
      if (state.gameMs < exp.finishAtGameMs) return
      const ok = beginBattleAt(state, ctx, exp.anomalyId ?? '', state.shipId, exp.finishAtGameMs)
      if (!ok) {
        exp.active = false
        exp.anomalyId = null
        exp.battle = null
        addLog(state, 'warn', '远征目标数据缺失，舰队无功而返（数据异常）。')
        return
      }
      continue // 同一帧继续处理交火（离线大推进直接打到结束）
    }
    if (exp.phase === 'battle') {
      if (!exp.battle) {
        // 防御：存档里 battle 丢失 → 用当前时刻开战
        const ok = beginBattleAt(state, ctx, exp.anomalyId ?? '', state.shipId, state.gameMs)
        if (!ok) {
          exp.active = false
          exp.anomalyId = null
          addLog(state, 'warn', '远征目标数据缺失，舰队无功而返（数据异常）。')
          return
        }
        continue
      }
      advanceBattleFor(state, ctx, exp.battle, state.shipId, exp.anomalyId)
      if (exp.battle.ended) {
        // V12.3 击杀慢镜：分出胜负后延迟 killcamMs 再结算，让最后一击动画与爆炸演出播完；
        // 计时基准 = 战斗停表时刻（lastTickGameMs 冻结于击杀拍）。离线/大步长推进下差值立即达标，行为与旧版一致。
        const bal = ctx.balance.battle
        if (state.gameMs - exp.battle.lastTickGameMs < bal.killcamMs) return
        resolveBattleOutcome(state, ctx)
        continue // resolve 后转 back；若返航也已到点则同帧回家
      }
      return
    }
    // back：到港结束
    if (state.gameMs < exp.finishAtGameMs) return
    exp.active = false
    exp.anomalyId = null
    exp.battle = null
    exp.phase = 'out'
    addLog(state, 'info', '远征结束，舰队已停靠母港。')
    return
  }
}

/** 玩家指令：召回远征（T1 活动窗口统一停止）。仅去程/返航可召回——召回即直接回港、无战果；交火中禁止（避免绕过战斗结算）。 */
export function recallExpedition(state: GameState, ctx: SimContext): CommandResult {
  const exp = state.expedition
  if (!exp.active) return { ok: false, error: '当前没有进行中的远征。' }
  if (exp.phase === 'battle') {
    return { ok: false, error: '交火中无法撤离——请先让战斗分出胜负。' }
  }
  const anomaly = exp.anomalyId ? ctx.anomalies.get(exp.anomalyId) : undefined
  const name = anomaly?.name ?? exp.anomalyId ?? '目标'
  exp.active = false
  exp.anomalyId = null
  exp.battle = null
  exp.phase = 'out'
  exp.finishAtGameMs = 0
  exp.eventId = null
  exp.eventFired = false
  state.awayGalaxy = null
  addLog(state, 'warn', `远征已召回：舰队中止前往「${name}」并返回母港（无战果）。`)
  return { ok: true }
}

/* ───────── T8 悬赏重复冷却与连续出击 ───────── */

/** 冷却基础 10 秒（船长定稿：较原方案大幅缩减）；分辨率越高冷却越短 */
export const BOUNTY_COOLDOWN_BASE_MS = 10_000
export const BOUNTY_COOLDOWN_REF_RES = 500

/** 按当前驾驶船扫描属性计算一次冷却时长 */
export function bountyCooldownMsFor(state: GameState, ctx: SimContext): number {
  const res = fleetDefOf(state, ctx, state.shipId)?.scanResMm ?? BOUNTY_COOLDOWN_REF_RES
  const factor = Math.pow(BOUNTY_COOLDOWN_REF_RES / Math.max(1, res), 0.5)
  return Math.max(1000, Math.round(BOUNTY_COOLDOWN_BASE_MS * factor))
}

/** 悬赏完成结算时调用：以当时出击船属性锁定冷却结束时刻 */
export function setBountyCooldown(state: GameState, ctx: SimContext, anomalyId: string): void {
  state.bountyCooldowns[anomalyId] = state.gameMs + bountyCooldownMsFor(state, ctx)
}

/** 剩余冷却毫秒（≤0 = 已冷却，顺带清理过期条目） */
export function bountyCooldownRemainingMs(state: GameState, anomalyId: string): number {
  const until = state.bountyCooldowns[anomalyId]
  if (typeof until !== 'number' || !Number.isFinite(until)) return 0
  const remain = until - state.gameMs
  if (remain <= 0) {
    delete state.bountyCooldowns[anomalyId]
    return 0
  }
  return remain
}

/** 连续出击开关（落档：重启后自动恢复）；null = 关闭 */
export function setAutoLoopBounty(state: GameState, ctx: SimContext, anomalyId: string | null): CommandResult {
  state.autoLoopAnomalyId = anomalyId
  if (anomalyId === null) {
    addLog(state, 'info', '连续出击已停止。')
  } else {
    const def = ctx.anomalies.get(anomalyId)
    const name = def?.name ?? anomalyId
    addLog(state, 'info', `连续出击已开启：「${name}」完成后冷却结束会自动再次出发（货仓/耐久不满足时自动暂停）。`)
  }
  return { ok: true }
}

/** 停环并记录原因（日志+清开关） */
function stopAutoLoopReason(state: GameState, reason: string): void {
  state.autoLoopAnomalyId = null
  addLog(state, 'warn', `连续出击已暂停：${reason}`)
}

/**
 * 连续出击推进（在线心跳调用；落档开关在重开档后从可出发条件自动恢复）：
 * 忙（远征/采矿/扫描/返航行程）或冷却中 → 等待；条件不满足 → 停环并记原因。
 * 返回 null = 继续等待/已再出发；否则 = 停止原因。
 */
export function advanceAutoLoopBounty(state: GameState, ctx: SimContext): string | null {
  const id = state.autoLoopAnomalyId
  if (id === null) return null
  if (state.expedition.active || state.mining.active || state.scanning.active || state.transit.active) {
    return null // 作业中/返航中：等
  }
  const anomaly = ctx.anomalies.get(id)
  if (!anomaly) {
    stopAutoLoopReason(state, '目标数据缺失。')
    return '目标数据缺失'
  }
  const block = actionBlockReason(state, anomaly.galaxyId)
  if (block) {
    stopAutoLoopReason(state, block)
    return block
  }
  if (bountyCooldownRemainingMs(state, id) > 0) return null // 冷却中：等
  const fleetShip = state.fleet[state.shipId]
  if (!fleetShip) {
    stopAutoLoopReason(state, '当前舰船数据缺失。')
    return '当前舰船数据缺失'
  }
  // 耐久：先自动消耗货仓修理组件（可能连续使用多件），仍 < 0.5 才停
  if (fleetShip.durability < 0.5) {
    repairWithKits(state, ctx, 0.5)
    if ((state.fleet[state.shipId]?.durability ?? 0) < 0.5) {
      stopAutoLoopReason(state, '耐久低于 50% 且货仓修理组件不足——请返航空间站维修。')
      return '耐久不足且修理组件耗尽'
    }
  }
  // 货仓：放不下本单预期缴获 → 停（B 甲：无远程入库，回港卸货是玩家的决定）
  const lootM3 = anomaly.loot.reduce((sum, row) => {
    const def = ctx.items.get(row.itemId)
    return sum + row.units * (def?.unitM3 ?? 0)
  }, 0)
  if (freeCargoM3(state, ctx) < lootM3) {
    stopAutoLoopReason(state, `货仓剩余空间不足以装载「${anomaly.name}」的缴获——请返航空间站卸货。`)
    return '货仓空间不足'
  }
  // 出发（内部含声望/冷却/探索/位置全部校验）
  const r = startExpedition(state, id, ctx)
  if (!r.ok) {
    stopAutoLoopReason(state, r.error ?? '无法再出发。')
    return r.error ?? '无法再出发'
  }
  return null
}

/** 远征状态快照（界面用；battle 阶段显示交火信息） */
export interface ExpeditionView {
  active: boolean
  anomalyId: string | null
  anomalyName: string
  galaxyName: string
  remainingMs: number
  totalMs: number
  percent: number
  /** 阶段：out 航行 / combat 交火 / back 返航 */
  phase: 'out' | 'combat' | 'back' | null
  phaseLabel: string
  threat: number
  power: number
  /** 预估胜率（百分比，battleWinPreview；0 = 无法评估） */
  winPercent: number
  /** 交火信息（phase=combat 时） */
  combat: {
    distanceM: number
    myDesireM: number
    meHp: { s: number; a: number; h: number }
    foeHp: Record<string, { s: number; a: number; h: number; name: string }>
    shots: number
    hits: number
  } | null
}

export function expeditionStatus(state: GameState, ctx: SimContext): ExpeditionView {
  const exp = state.expedition
  const anomaly = exp.anomalyId ? ctx.anomalies.get(exp.anomalyId) : undefined
  const galaxy = anomaly ? ctx.galaxies.get(anomaly.galaxyId) : undefined
  const base = {
    active: false,
    anomalyId: null as string | null,
    anomalyName: '',
    galaxyName: '',
    remainingMs: 0,
    totalMs: 0,
    percent: 0,
    phase: null as 'out' | 'combat' | 'back' | null,
    phaseLabel: '',
    threat: 0,
    power: 0,
    winPercent: 0,
    combat: null,
  }
  if (!exp.active || exp.anomalyId === null) return base

  const threat = anomaly?.threat ?? 0
  const power = exp.power
  const phase: 'out' | 'combat' | 'back' = exp.phase === 'battle' ? 'combat' : exp.phase
  const phaseLabel =
    phase === 'out' ? '航行中（去程）' : phase === 'combat' ? '交火中' : '返航中'
  // 进度：out/back 按单程；combat 按已交战时间/最大上限
  let percent = 0
  let remainingMs = 0
  let totalMs = 1
  if (exp.phase === 'out' || exp.phase === 'back') {
    const elapsed = Math.max(0, exp.outMs - Math.max(0, exp.finishAtGameMs - state.gameMs))
    remainingMs = Math.max(0, exp.finishAtGameMs - state.gameMs)
    totalMs = exp.outMs
    percent = Math.min(100, (elapsed / Math.max(1, totalMs)) * 100)
  } else if (exp.battle) {
    const b = exp.battle
    const elapsed = Math.max(0, state.gameMs - b.startedAtGameMs)
    totalMs = ctx.balance.battle.maxBattleMs
    remainingMs = Math.max(0, totalMs - elapsed)
    percent = Math.min(100, (elapsed / totalMs) * 100)
  }
  let winPercent = 0
  if (anomaly && exp.phase !== 'battle') {
    winPercent = Math.round(battleWinPreview(state, ctx, anomaly, state.shipId) * 100)
  }
  const combat =
    exp.phase === 'battle' && exp.battle
      ? {
          distanceM: Math.round(exp.battle.distanceM),
          myDesireM: Math.round(exp.battle.myDesireM),
          meHp: { ...(exp.battle.units['player']?.hp ?? { s: 0, a: 0, h: 0 }) },
          foeHp: Object.fromEntries(
            Object.entries(exp.battle.units)
              .filter(([, u]) => u.side === 'foe')
              .map(([tag, u]) => [tag, { s: Math.round(u.hp.s), a: Math.round(u.hp.a), h: Math.round(u.hp.h), name: u.name }]),
          ),
          shots: exp.battle.stats.meShots,
          hits: exp.battle.stats.meHits,
        }
      : null

  return {
    active: true,
    anomalyId: exp.anomalyId,
    anomalyName: anomaly?.name ?? exp.anomalyId,
    galaxyName: galaxy?.name ?? '',
    remainingMs,
    totalMs,
    percent,
    phase,
    phaseLabel,
    threat,
    power,
    winPercent,
    combat,
  }
}

/** 目标可否出发的说明（界面禁用提示用；V13 含探索封锁） */
export function expeditionFeasibility(state: GameState, anomaly: AnomalyDef, ctx: SimContext): { ok: boolean; reason: string } {
  if (state.mining.active) return { ok: false, reason: '采矿中' }
  if (state.expedition.active) return { ok: false, reason: '远征中' }
  if (state.scanning.active) return { ok: false, reason: '扫描探索中' }
  const standing = standingOf(state, DSI_FACTION_ID)
  if (standing < anomaly.standingReq) return { ok: false, reason: `需声望 ${anomaly.standingReq}` }
  const block = actionBlockReason(state, anomaly.galaxyId)
  if (block) return { ok: false, reason: '星系未探索' }
  const minutes = shortestTravelMinutes(ctx, HOME_GALAXY_ID, anomaly.galaxyId)
  if (!Number.isFinite(minutes)) return { ok: false, reason: '无航路' }
  return { ok: true, reason: `航程 ${minutes} 分钟单程` }
}
