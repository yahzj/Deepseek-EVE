/**
 * B1 低安遭遇 / 伏击（v17.1 兼容字段，船长 2026-09-04 定稿）：
 * - 暴露面：主控（低安矿带采矿 / 低安星系胜利停留 / 低安悬赏远征途中）与 AI 副船
 *   （低安矿带采矿 / 低安远征途中），按暴露窗口掷骰；高安（sec ≥ 0.5）不掷；
 * - 承担规则：同星系内我方在场船中"停留船"优先承担（区域一次；事件后该星系 5 分钟冷却）；
 * - 形态：离线（含大步离线结算）直接文字三档结算；在线命中产生"伏击待决"邀约，
 *   玩家可「迎战」（进入 V12 实时战斗，自动打完）或「快速脱离」；60 秒（游戏时间）未响应
 *   自动按文字结算——超时判定用 gameMs，离线大步长天然瞬间超时，无需在线标志；
 * - 文字三档（Q2 甲）：击退（缴获 ISK）/ 受损（耐久 −5%~15%，底 clamp 5% 绝不弃船）/
 *   被抢（至多 30% 船上货，无货抢至多 5% 钱包）；
 * - 首次进入低安弹提示并写日志（lowSecNotified 一次性标记），规则入手册「航行须知」。
 */
import { addLog } from './state'
import type { GameState } from './state'
import type { CommandResult } from './engine'
import type { SimContext } from './types'
import { nextRandom } from './rng'
import { advanceBattleFor, refundAmmo, startBattleFor } from './combat'
import { calcPower } from './expedition'
import { shipDisplayName } from './instances'

/** B1 遭遇战敌方模板档位（data ANOMALIES hidden 条目；threat 为档位标尺） */
const ENC_TIERS: ReadonlyArray<{ id: string; threat: number }> = [
  { id: 'enc-pirate-1', threat: 10 },
  { id: 'enc-pirate-2', threat: 22 },
  { id: 'enc-pirate-3', threat: 40 },
  { id: 'enc-pirate-4', threat: 70 },
]

/** 就近匹配遭遇强度 → 战斗模板 id（threat 存档位与档位贴齐，保证存档后仍稳定匹配） */
function tierIdOf(threat: number): string {
  let best = ENC_TIERS[0]!
  for (const t of ENC_TIERS) {
    if (Math.abs(t.threat - threat) < Math.abs(best.threat - threat)) best = t
  }
  return best.id
}

/** 星系安全等级（数据缺失按高安 +1 处理，不惹麻烦） */
function secOf(ctx: SimContext, galaxyId: string | null): number {
  if (galaxyId === null) return 1
  return ctx.galaxies.get(galaxyId)?.security ?? 1
}

/** 一次"暴露"：某艘我方舰船正活动在某个低安星系（或远征途中以目标星系计风险） */
interface Exposure {
  galaxyId: string
  shipId: string
  kind: '采矿' | '停留' | '远征途中'
  /** 描述（日志用）：承担船名 + 来源 */
}

/** 收集当前全部低安暴露（去重：同星系只留最高优先承担者；停留 > 作业，主控作业 > 副船） */
function collectExposures(state: GameState, ctx: SimContext): Exposure[] {
  const bal = ctx.balance.encounter
  const out = new Map<string, Exposure>()
  const push = (e: Exposure): void => {
    if (secOf(ctx, e.galaxyId) >= bal.highSecSafe) return // 高安不掷
    const prev = out.get(e.galaxyId)
    const rank = (x: Exposure): number => (x.kind === '停留' ? 3 : x.shipId === state.shipId ? 2 : 1)
    if (!prev || rank(e) > rank(prev)) out.set(e.galaxyId, e)
  }
  const m = state.mining
  const e = state.expedition
  // 主控：采矿在带（含往返阶段都在矿带星系附近活动）
  if (m.active && m.beltId) {
    const g = ctx.belts.get(m.beltId)?.galaxyId
    if (g) push({ galaxyId: g, shipId: state.shipId, kind: '采矿' })
  } else if (e.active && e.phase !== 'battle' && e.anomalyId) {
    const g = ctx.anomalies.get(e.anomalyId)?.galaxyId
    if (g) push({ galaxyId: g, shipId: state.shipId, kind: '远征途中' })
  } else if (state.awayGalaxy !== null) {
    push({ galaxyId: state.awayGalaxy, shipId: state.shipId, kind: '停留' })
  }
  // 副船（采矿 / 远征途中 / 驻留待命；交火中不算暴露；待命去程未抵达不算）
  for (const [sid, a] of Object.entries(state.aiAssignments)) {
    const t = a.task
    if (t.kind === 'mining') {
      const g = ctx.belts.get(t.beltId)?.galaxyId
      if (g) push({ galaxyId: g, shipId: sid, kind: '采矿' })
    } else if (t.kind === 'expedition') {
      if (t.phase !== 'battle') {
        const g = ctx.anomalies.get(t.anomalyId)?.galaxyId
        if (g) push({ galaxyId: g, shipId: sid, kind: '远征途中' })
      }
    } else if (t.kind === 'standby' && t.phase === 'stand') {
      push({ galaxyId: t.galaxyId, shipId: sid, kind: '停留' }) // 已驻留的副船 = 区域停留船
    }
  }
  return [...out.values()]
}

function clearEncounter(state: GameState): void {
  state.encounter = {
    active: false,
    shipId: null,
    galaxyId: null,
    name: '',
    threat: 0,
    origin: '',
    invitedAtGameMs: 0,
    deadlineGameMs: 0,
    battle: null,
  }
}

/** 首次涉足低安：一次性提示 + 日志（规则全文在手册「航行须知」） */
function noteLowSec(state: GameState, ctx: SimContext, galaxyId: string): void {
  if (state.lowSecNotified) return
  state.lowSecNotified = true
  const name = ctx.galaxies.get(galaxyId)?.name ?? galaxyId
  addLog(
    state,
    'warn',
    `⚠ 首次进入低安星系（${name}，安全 ${secOf(ctx, galaxyId).toFixed(1)}）：低安活动可能遭遇巡逻拦截或海盗伏击（采矿/停留/远征途中均可能）；可「迎战」或快速脱离，详见手册「航行须知」。`,
  )
}

/**
 * 文字三档结算（Q2 甲）：击退（缴获 ISK）/ 受损（耐久 −5%~15%，clamp 5%）/ 被抢（至多 30% 货）。
 * ratio = 我方火力 / (我方火力 + 遭遇强度)；mode 仅影响日志措辞。
 */
function resolveTextual(state: GameState, ctx: SimContext, viaFlee: boolean): void {
  const enc = state.encounter
  const bal = ctx.balance.encounter
  const shipId = enc.shipId ?? state.shipId
  const shipName = shipDisplayName(state, ctx, shipId)
  const galaxyName = ctx.galaxies.get(enc.galaxyId ?? '')?.name ?? ''
  const power = Math.max(1, calcPower(state, ctx, shipId))
  const threat = Math.max(1, enc.threat)
  const ratio = power / (power + threat)
  // 三档权重随战力比：击退 20%~80%、受损 45%~15%、被抢 35%~5%
  const wWin = 0.2 + 0.6 * ratio
  const wLose = 0.45 - 0.3 * ratio
  const r = nextRandom(state.rng)
  const suffix = viaFlee ? '（快速脱离）' : '（无人应答，自动处置）'
  const fleetShip = state.fleet[shipId]
  if (r < wWin) {
    const loot = Math.max(1, Math.round(threat * (bal.lootIskMin + nextRandom(state.rng) * (bal.lootIskMax - bal.lootIskMin))))
    state.wallet.isk += loot
    addLog(state, 'info', `⚔ 遭遇（${galaxyName}·${enc.name}）：${shipName} 成功击退来敌${suffix}——缴获 ${loot.toLocaleString('zh-CN')} ISK，全身而退。`)
  } else if (r < wWin + wLose) {
    const loss = Math.round((bal.duraLossMin + nextRandom(state.rng) * (bal.duraLossMax - bal.duraLossMin)) * 1000) / 1000
    if (fleetShip) {
      const after = Math.round((fleetShip.durability - loss) * 1000) / 1000
      fleetShip.durability = after <= 0 ? 0.05 : Math.min(1, after)
      if (after <= 0) {
        addLog(state, 'warn', '⚠ 遭遇战后船体结构濒临崩溃（耐久仅剩 5%）——请尽快返港维修。')
      }
    }
    addLog(
      state,
      'warn',
      `⚔ 遭遇（${galaxyName}·${enc.name}）：${shipName} 寡不敌众被咬下一块装甲${suffix}——耐久 -${Math.round(loss * 100)}%（现 ${Math.round((fleetShip?.durability ?? 1) * 100)}%）。`,
    )
  } else {
    // 被抢：至多 30% 船上货；无货则抢至多 5% 钱包
    let takenUnits = 0
    if (fleetShip) {
      const total = Object.values(fleetShip.cargo).reduce((a, b) => a + b, 0)
      const take = Math.floor(total * bal.lootTakenMaxPct * nextRandom(state.rng))
      let rest = take
      for (const key of Object.keys(fleetShip.cargo)) {
        if (rest <= 0) break
        const unit = fleetShip.cargo[key]!
        const grab = Math.min(unit, rest)
        fleetShip.cargo[key] = unit - grab
        rest -= grab
        if (fleetShip.cargo[key] <= 0) delete fleetShip.cargo[key]
      }
      takenUnits = take - rest
    }
    const takenIsk = takenUnits <= 0 ? Math.floor(state.wallet.isk * bal.iskTakenMaxPct * nextRandom(state.rng)) : 0
    state.wallet.isk = Math.max(0, state.wallet.isk - takenIsk)
    addLog(
      state,
      'warn',
      takenUnits > 0
        ? `⚔ 遭遇（${galaxyName}·${enc.name}）：${shipName} 被劫${suffix}——货仓损失 ${takenUnits.toLocaleString('zh-CN')} 单位货物，破财消灾。`
        : `⚔ 遭遇（${galaxyName}·${enc.name}）：${shipName} 被洗劫${suffix}——${takenIsk > 0 ? `抢走 ${takenIsk.toLocaleString('zh-CN')} ISK` : '一无所获的劫匪悻悻离去'}。`,
    )
  }
  clearEncounter(state)
}

/** 遭遇战（玩家应战后）推进与结算：胜 → 缴获；败 → 受损 + 大概率被抢 */
function settleFight(state: GameState, ctx: SimContext): void {
  const enc = state.encounter
  const shipId = enc.shipId ?? state.shipId
  const shipName = shipDisplayName(state, ctx, shipId)
  const galaxyName = ctx.galaxies.get(enc.galaxyId ?? '')?.name ?? ''
  const battle = enc.battle
  const bal = ctx.balance.encounter
  const fleetShip = state.fleet[shipId]
  if (battle) {
    // 退还剩余弹药（与远征/撤退同一口径）
    refundAmmo(state, battle.ammo)
  }
  if (battle && battle.ended === 'me') {
    const loot = Math.max(
      1,
      Math.round(enc.threat * (bal.lootIskMin + nextRandom(state.rng) * (bal.lootIskMax - bal.lootIskMin)) * 1.6),
    )
    state.wallet.isk += loot
    addLog(state, 'info', `🏆 遭遇战大捷（${galaxyName}·${enc.name}）：${shipName} 全歼来敌——缴获 ${loot.toLocaleString('zh-CN')} ISK。`)
  } else {
    const loss = Math.round((bal.duraLossMin + nextRandom(state.rng) * (bal.duraLossMax - bal.duraLossMin)) * 1000) / 1000
    if (fleetShip) {
      const after = Math.round((fleetShip.durability - loss) * 1000) / 1000
      fleetShip.durability = after <= 0 ? 0.05 : Math.min(1, after)
      if (after <= 0) addLog(state, 'warn', '⚠ 遭遇战后船体结构濒临崩溃（耐久仅剩 5%）——请尽快返港维修。')
    }
    let takenUnits = 0
    if (fleetShip && nextRandom(state.rng) < 0.5) {
      const total = Object.values(fleetShip.cargo).reduce((a, b) => a + b, 0)
      const take = Math.floor(total * bal.lootTakenMaxPct * (0.5 + nextRandom(state.rng) * 0.5))
      let rest = take
      for (const key of Object.keys(fleetShip.cargo)) {
        if (rest <= 0) break
        const unit = fleetShip.cargo[key]!
        const grab = Math.min(unit, rest)
        fleetShip.cargo[key] = unit - grab
        rest -= grab
        if (fleetShip.cargo[key] <= 0) delete fleetShip.cargo[key]
      }
      takenUnits = take - rest
    }
    addLog(
      state,
      'warn',
      `⚔ 遭遇战失利（${galaxyName}·${enc.name}）：${shipName} 不敌来敌——耐久 -${Math.round(loss * 100)}%${
        takenUnits > 0 ? `，货仓被劫走 ${takenUnits.toLocaleString('zh-CN')} 单位` : ''
      }，狼狈脱离。`,
    )
  }
  clearEncounter(state)
}

/**
 * 引擎内部：每推进后调用——推进进行中的遭遇（待决超时 / 战斗），空闲时按暴露窗口掷骰。
 */
/**
 * 引擎内部（每推进后调用）：
 * ① 维护"低安在场记录"（galaxyId → 连续在场起始时刻，用于 5 分钟入场缓冲与首提提示）；
 * ② 推进进行中的遭遇（待决超时自动文字结算 / 应战战斗推演）。
 * 触发判定不在此处——由随机事件线到点时调用 rollLowSecAmbush（遭遇占用事件机会，船长 2026-09-04 定）。
 */
export function advanceEncounterWatch(state: GameState, ctx: SimContext, _deltaMs: number): void {
  maintainPresence(state, ctx)
  const enc = state.encounter
  if (enc.active) {
    if (enc.battle) {
      if (!enc.battle.ended) {
        advanceBattleFor(state, ctx, enc.battle, enc.shipId ?? state.shipId, tierIdOf(enc.threat), null)
      }
      if (enc.battle.ended) settleFight(state, ctx)
      return
    }
    // 待决邀约：超时自动按文字结算（离线大步长会立刻超时 → 与"离线只文字"一致）
    if (state.gameMs >= enc.deadlineGameMs) {
      resolveTextual(state, ctx, false)
    }
    return
  }
}

/** 引擎内部：刷新低安在场记录（本轮在场星系补起始时刻；离开的删除）；首次涉足低安给一次性提示 */
export function maintainPresence(state: GameState, ctx: SimContext): void {
  const now = state.gameMs
  const seen = new Set<string>()
  for (const exp of collectExposures(state, ctx)) {
    seen.add(exp.galaxyId)
    if (state.lowSecPresence[exp.galaxyId] === undefined) {
      state.lowSecPresence[exp.galaxyId] = now
      noteLowSec(state, ctx, exp.galaxyId) // 新入场（且全局限首提）提示
    }
  }
  for (const g of Object.keys(state.lowSecPresence)) {
    if (!seen.has(g)) delete state.lowSecPresence[g]
  }
}

/**
 * 低安遭遇判定（船长 2026-09-04 定稿：**占用随机事件触发机会**）：
 * 由随机事件系统在每次事件到点时调用——若我方有船在低安星系且已过 5 分钟入场缓冲
 * （及区域冷却），按星系安全度概率遇袭；命中即产生遭遇并返回 true（本次事件时机被占用，
 * 本段不再出随机事件）；未中返回 false（随机事件照常）。
 */
export function rollLowSecAmbush(state: GameState, ctx: SimContext): boolean {
  if (state.encounter.active) return false // 已有未了结遭遇：不叠
  const bal = ctx.balance.encounter
  for (const exp of collectExposures(state, ctx)) {
    const since = state.lowSecPresence[exp.galaxyId]
    if (since === undefined || state.gameMs - since < bal.entryBufferMs) continue // 5 分钟缓冲
    const cd = state.encounterZoneCooldown[exp.galaxyId] ?? 0
    if (state.gameMs < cd) continue
    const sec = secOf(ctx, exp.galaxyId)
    const p = Math.min(0.9, bal.ambushChanceAtZero + bal.ambushChancePerSec * Math.min(1.5, Math.max(0, bal.highSecSafe - sec)))
    if (nextRandom(state.rng) >= p) continue
    spawnEncounter(state, ctx, exp)
    return true // 一次到点至多一次遭遇（占用本段事件时机）
  }
  return false
}

/** 命中 → 产生一次遭遇（区域事件：同星系冷却；承担者 = 该星系最高优先在场船） */
function spawnEncounter(state: GameState, ctx: SimContext, exp: Exposure): void {
  const bal = ctx.balance.encounter
  state.encounterZoneCooldown[exp.galaxyId] = state.gameMs + bal.zoneCooldownMs
  const power = Math.max(1, calcPower(state, ctx, exp.shipId))
  const factor = bal.foePowerMin + nextRandom(state.rng) * (bal.foePowerMax - bal.foePowerMin)
  const threat = Math.max(4, Math.round(power * factor))
  const template = ctx.anomalies.get(tierIdOf(threat))
  const shipName = shipDisplayName(state, ctx, exp.shipId)
  state.encounter = {
    active: true,
    shipId: exp.shipId,
    galaxyId: exp.galaxyId,
    name: template?.name ?? '巡逻队',
    threat,
    origin: `${shipName} · ${exp.kind}`,
    invitedAtGameMs: state.gameMs,
    deadlineGameMs: state.gameMs + bal.inviteWaitMs,
    battle: null,
  }
  addLog(
    state,
    'warn',
    `⚠ 低安遭遇（${ctx.galaxies.get(exp.galaxyId)?.name ?? exp.galaxyId}·${template?.name ?? '不明编队'}）：${shipName}（${exp.kind}中）被盯上了——可「迎战」或「快速脱离」；60 秒未处置将自动脱离。`,
  )
}

/** 玩家指令：迎战（进入 V12 实时战斗，自动打完出战报） */
export function fightEncounter(state: GameState, ctx: SimContext): CommandResult {
  const enc = state.encounter
  if (!enc.active || enc.battle) return { ok: false, error: '当前没有可应战的遭遇。' }
  const battle = startBattleFor(state, ctx, enc.shipId ?? state.shipId, tierIdOf(enc.threat), state.gameMs)
  if (!battle) return { ok: false, error: '遭遇数据异常，无法开战。' }
  enc.battle = battle
  addLog(state, 'info', '已应战：遭遇战打响（引擎自动推演，战报稍后）。')
  return { ok: true }
}

/** 玩家指令：快速脱离（立即按文字三档结算） */
export function fleeEncounter(state: GameState, ctx: SimContext): CommandResult {
  const enc = state.encounter
  if (!enc.active || enc.battle) return { ok: false, error: '当前没有可脱离的遭遇。' }
  resolveTextual(state, ctx, true)
  return { ok: true }
}
