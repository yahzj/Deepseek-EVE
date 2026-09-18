/**
 * 舰队（v7 船坞）：拥有/丢失舰船、切换驾驶、耐久与维修。
 * 每艘船的 货仓/装备/耐久 都存在 fleet[uid] 里，随船生死。
 * v17（T5-B）：fleet 键 = 实例 uid——同型可多艘（第 1 艘 = 船型 id，
 * 第 2 艘起 = `船型id#N`，固定不回收）；条目带 defId/customName。
 */
import { bumpFirst } from './firstTasks'
import { addLog, DEFAULT_START_SHIP_ID, shipLockedReason } from './state'
import type { CommandResult } from './engine'
import type { FittedModules, FleetShipState, GameState } from './state'
import type { SimContext } from './types'
import { allFittedIds, emptyFitted, uidDefId } from './labels'
import { allFittedModules } from './equipment'
import { fleetDefOf, shipDisplayName } from './instances'
import { createPlayerSpec } from './combat'
import { miningReturnLegMs } from './location'
import { retireSalvageShip } from './salvaging'
import { cancelHaulingOnSwitch } from './hauling'
import { cancelAiTask } from './ai'
import { scaledReturnMs } from './trips'
import { countWare, removeWare } from './inventory'
import { quickRepairFactor } from './repair'

/** v17：加入一艘"全新"的同型舰船（分配新实例 uid 并落库），返回实例 uid */
export function addShipToFleet(state: GameState, defId: string): string {
  const uid = allocateShipUid(state, defId)
  state.fleet[uid] = emptyShipState(defId)
  return uid
}

/**
 * v17：为一个船型分配新实例的 uid——同型无船时 = 船型 id（不带号）；
 * 已有（含市场挂卖 escrow 中的同型）则取「现存最大 #N + 1」，空号不复用（号 = 船的身份，稳定不重排）。
 */
export function allocateShipUid(state: GameState, defId: string): string {
  let max = 0
  const taken = new Set<string>(Object.keys(state.fleet))
  const consider = (uid: string): void => {
    taken.add(uid)
    if (uid === defId) max = Math.max(max, 1)
    else if (uid.startsWith(`${defId}#`)) {
      const n = Number(uid.slice(defId.length + 1))
      if (Number.isInteger(n) && n > 1) max = Math.max(max, n)
    }
  }
  for (const uid of Object.keys(state.fleet)) consider(uid)
  for (const hold of Object.values(state.escrowShips)) consider(hold.shipId)
  if (max === 0) return defId
  return `${defId}#${max + 1}`
}

function emptyShipState(defId: string): FleetShipState {
  const fitted: FittedModules = emptyFitted()
  return { defId, customName: null, durability: 1, armorPct: 1, cargo: {}, fitted }
}

/** 该实例的船型数据（uid → fleet 条目 → def；fleet 外/记录缺失返回 undefined） */
export { fleetDefOf } from './instances'

/** 一艘舰船的显示名（全链统一入口，见 instances.ts） */
export { shipDisplayName } from './instances'

/**
 * v17：自由改名（Q4 甲扩展，船长定稿：免费、上限 10 字、允许重名）。
 * name = null → 恢复默认名（船型名，同型多艘自动带号）。
 */
export function renameShip(state: GameState, uid: string, name: string | null): CommandResult {
  const entry = state.fleet[uid]
  if (!entry) return { ok: false, error: '机库里没有这艘船。' }
  if (name === null) {
    if (entry.customName === null) return { ok: false, error: '该船用的就是默认名。' }
    entry.customName = null
    addLog(state, 'info', '已恢复默认船名。')
    return { ok: true }
  }
  const trimmed = name.trim()
  if (trimmed.length === 0) return { ok: false, error: '船名不能为空。' }
  if ([...trimmed].length > 10) return { ok: false, error: '船名最多 10 个字。' }
  entry.customName = trimmed
  addLog(state, 'info', `该船已命名为「${trimmed}」。`)
  return { ok: true }
}

/** 是否拥有该舰船 */
export function ownsShip(state: GameState, shipId: string): boolean {
  return shipId in state.fleet
}

/** 玩家指令：切换到拥有的另一艘船驾驶（采矿/打捞作业中可直接切换——旧船自动返航卸货善后，作业随之结束） */
export function changeShip(state: GameState, shipId: string, ctx: SimContext): CommandResult {
  // **进洞船只所有行为锁定**（船长 2026-09-13：锁，进洞船只所有行为都锁定。包括维修。）
  const lock = shipLockedReason(state, shipId, '换驾驶到它')
  if (lock) return { ok: false, error: lock }
  if (shipId === state.shipId) {
    return { ok: false, error: `正在驾驶的就是 ${shipDisplayName(state, ctx, shipId)}。` }
  }
  if (!ownsShip(state, shipId)) {
    const defName = ctx.ships.get(uidDefId(shipId))?.name ?? shipId
    return { ok: false, error: `机库里没有 ${defName}——先到商店购买，或用舰船蓝图制造一艘。` }
  }
  const def = fleetDefOf(state, ctx, shipId)
  if (!def) return { ok: false, error: `未知舰船：${shipId}。` }
  // 2026-09-09 长途运输：换驾驶 = 立即终止（虚拟货无残留、无惩罚）
  if (state.hauling.active) cancelHaulingOnSwitch(state, ctx)
  // T8：驾驶船不在站内（野外停留/返航途中）时不可切换
  if (state.awayGalaxy !== null) {
    const where = state.transit.active
      ? state.transit.delivery
        ? '正在交付航线途中'
        : '正在返航空间站途中'
      : `停留在「${ctx.galaxies.get(state.awayGalaxy)?.name ?? state.awayGalaxy}」星系（野外）`
    return { ok: false, error: `驾驶船${where}——请先「返航空间站」再换船。` }
  }
  // 2026-09-08（船长定）：未建成建站点不视为站点——建成（并入基地网络）后才开放换驾驶
  if (state.dockedSite !== null) {
    const dockSite = ctx.stations.get(state.dockedSite)
    const prog = dockSite ? state.stationSites[dockSite.id] : null
    if (dockSite && (!prog || prog.stage < dockSite.tiers.length)) {
      return { ok: false, error: `「${dockSite.name}」尚未建成：工地不提供停靠与服务，换驾驶需在母港或已建成的副站进行。` }
    }
  }
  if (state.expedition.active && state.expedition.phase === 'back') {
    // 2026-09-08（船长定）：返航中允许换船——本次返航转为旧船"远征善后"账本（剩余航程照走、
    // 到港自动卸货入仓库），并立即停止重复清剿
    const exp = state.expedition
    const oldShip = state.shipId
    const oldName = shipDisplayName(state, ctx, oldShip)
    const remainMs = Math.max(1, exp.finishAtGameMs - state.gameMs)
    state.shipReturns[oldShip] = { beltId: null, legMs: remainMs, phaseAccMs: 0, reason: 'expedition' }
    if (state.autoLoopAnomalyId !== null) {
      state.autoLoopAnomalyId = null
      addLog(state, 'info', '重复清剿已停止（返航中切换驾驶）。')
    }
    exp.active = false
    exp.anomalyId = null
    exp.battle = null
    exp.phase = 'out'
    exp.finishAtGameMs = 0
    exp.returnReason = undefined
    addLog(
      state,
      'info',
      `远征返航转旧船善后：${oldName} 约 ${Math.max(1, Math.round(remainMs / 1000))} 秒后到港并自动卸货入仓库（战果已在交火结算时入账）。`,
    )
  } else if (state.expedition.active) {
    return {
      ok: false,
      error:
        '远征出击/交火中：切换驾驶会中断本次远征（无战果）。请先在顶部活动栏召回远征（交火中可撤退），或等战报返回后再换船。',
    }
  }
  if (state.standby.active) return { ok: false, error: '舰船正前往掩护巡逻星系途中——到港后再换船。' }
  // 采矿作业中：直接切换成功——旧船按其当前阶段自动返航（到港自动卸货入仓库），采矿作业随之结束
  if (state.mining.active) {
    retireMiningShip(state, ctx)
  }
  // 打捞作业中：直接切换成功——旧船按其打捞阶段自动返航到港卸货，作业结束（2026-09-09 与采矿同构）
  if (state.salvaging.active) {
    retireSalvageShip(state, ctx)
  }
  // 2026-09-09（修复：切驾驶到 AI 执勤中的副船后核心卡死）：目标船若有 AI 任务，先召回并归还核心——
  // 否则任务仍挂在该船名下继续占用核心，而船已变驾驶船（AI 面板只列副船），该任务既不可见也无法取消，
  // 核心随之「消失」（玩家场景：伽玛核心挖矿船被切去跑运输后，伽玛核心不见了）。
  if (shipId in state.aiAssignments) {
    cancelAiTask(state, shipId, ctx)
  }
  state.shipId = shipId
  addLog(state, 'info', `已切换到驾驶 ${shipDisplayName(state, ctx, shipId)}。`)
  return { ok: true }
}

/**
 * 采矿善后（换驾驶时引擎内部调用）：把当前驾驶船正在进行的采矿转成"自动返航账本"
 * （shipReturns：采掘中走全程、返航中继续剩余、出航中按空船速度折算折返；到港自动整仓卸货），
 * 并结束采矿作业。旧船返航由引擎 advanceShipReturns 独立推进。
 */
export function retireMiningShip(state: GameState, ctx: SimContext): boolean {
  const m = state.mining
  if (!m.active || !m.beltId) return false
  const beltId = m.beltId
  const belt = ctx.belts.get(beltId)
  const beltName = belt?.name ?? '矿带'
  // 善后返航腿按旧船货仓占比缩放（空仓快、满仓原时长，船长 2026-09-05）
  const legFull = miningReturnLegMs(state, ctx, beltId)
  const legMs = scaledReturnMs(legFull, state, ctx, state.shipId)
  const phaseAccMs =
    m.phase === 'outbound'
      ? Math.min(legMs, m.phaseAccMs * 2) // 空船出航腿为正常一半：折返按 2×折算已走
      : m.phase === 'returning'
        ? m.phaseAccMs
        : 0
  const oldShip = state.fleet[state.shipId]
  const haveCargo = oldShip ? Object.keys(oldShip.cargo).some((k) => (oldShip.cargo[k] ?? 0) > 0) : false
  state.shipReturns[state.shipId] = {
    beltId,
    legMs: Math.max(1, legMs),
    phaseAccMs: Math.min(legMs, Math.max(0, phaseAccMs)),
  }
  const shipName = shipDisplayName(state, ctx, state.shipId)
  const remainSec = Math.max(0, Math.round((legMs - phaseAccMs) / 1000))
  // 结束作业
  m.active = false
  m.beltId = null
  m.phase = 'mining'
  m.cycleAccMs = 0
  m.phaseAccMs = 0
  m.tripUnits = 0
  m.originGalaxy = null
  m.rvLeft = 0 // 换船即离开矿带作业：红利窗口清零
  addLog(
    state,
    'info',
    `采矿已随换船结束：${shipName} 从「${beltName}」自动返航空间站${haveCargo ? '（到港整仓卸货）' : ''}——约 ${remainSec} 秒后到港。`,
  )
  return true
}

/** 弃船（损失舰船：连同货仓与装备）。自动补驾驶船：优先另一艘，否则补发初始沙猫 */
export function loseShip(state: GameState, shipId: string, ctx: SimContext, reason: string): void {
  const display = shipDisplayName(state, ctx, shipId)
  const wasCurrent = state.shipId === shipId
  delete state.fleet[shipId]
  addLog(state, 'warn', `${reason}：${display} 已损毁，船上的货仓与装备一并遗失。`)

  // 当前驾驶船被弃 → 自动补驾驶（2026-09-09 船长定：只选空闲船；全被 AI 占用或一艘不剩 → 保底沙猫，绝不占用 AI 执勤中的船）
  if (wasCurrent) reconcilePilotShip(state, ctx)

  // 异常守卫：作业引用的船已经没了就强制停下
  if (state.mining.active && !state.fleet[state.shipId]) {
    state.mining.active = false
    state.mining.phase = 'mining'
    state.mining.phaseAccMs = 0
    state.mining.cycleAccMs = 0
    state.mining.rvLeft = 0
  }
  if (state.salvaging.active && !state.fleet[state.shipId]) {
    state.salvaging.active = false
    state.salvaging.galaxyId = null
    state.salvaging.phase = 'salvaging'
    state.salvaging.phaseAccMs = 0
    state.salvaging.cycleAccMs = 0
    state.salvaging.tripM3 = 0
    state.salvaging.deviceAccMs = {}
  }
}

/** 2026-09-09（船长定）：驾驶船不可用原因——记录缺失 或 正被 AI 执勤占用（弃船补驾驶曾误选 AI 船，造成"驾驶船 = AI 执勤船"双驾驶重叠） */
export function pilotUnavailableReason(state: GameState): string | null {
  if (!state.fleet[state.shipId]) return '舰队里找不到当前驾驶的舰船——请到舰船页检查舰队。'
  if (state.aiAssignments[state.shipId] !== undefined) {
    return '当前驾驶的舰船正被 AI 执勤占用（采矿/打捞/掩护巡逻）——请先取消该船 AI 任务，或切换其它舰船。'
  }
  return null
}

/**
 * 2026-09-09（船长定）：保证存在可驾驶船（幂等自愈，弃船补驾驶与引擎逐 tick 共用）——
 * 驾驶船缺失或被 AI 执勤占用时：优先改派"空闲"（未 AI 占用）舰船；无空闲（全被 AI 占用
 * 或一艘不剩）→ 协会补发保底沙猫，绝不让 AI 执勤中的船兼任驾驶船。修正发生时记一条日志。
 *
 * ⚠ **2026-09-15 船长追加「优先把主控交给洞内船」**：被弃的这艘若是**虫洞那趟的编队成员**
 * （= 它是在洞里战沉的），**先把主控交给同一趟里还活着的编队船**；没有才落回上面的既有口径。
 * 详见函数内注释。
 */
export function reconcilePilotShip(state: GameState, ctx: SimContext): void {
  const reason = pilotUnavailableReason(state)
  if (reason === null) return
  const wasBusy = state.fleet[state.shipId] !== undefined
  /**
   * **洞内优先（船长 2026-09-15：「3 优先把主控交给洞内船」）**：原来一律"站内第一艘空闲船"，
   * 实测结果是**把主控交给开局那艘沙猫**——而洞里那趟还在继续、活动位也还占着（"人在洞里"），
   * 于是出现"主控在洞外、却在跑虫洞"的别扭状态。交给洞内幸存船之后语义自洽（它本来就被洞内锁定）。
   *
   * 判据 = `run.fleet.includes(state.shipId)`：`loseShip` 里**先 delete 再调本函数**，而 `run.fleet`
   * 要到收口时才摘沉船 ⇒ 此刻仍认得出"这艘是洞内编队的"。mate 只挑**还在舰队里且未被 AI 占用**的。
   */
  const run = state.wormhole.run
  if (run && run.fleet.includes(state.shipId)) {
    const mate = run.fleet.find((id) => state.fleet[id] !== undefined && state.aiAssignments[id] === undefined)
    if (mate !== undefined) {
      state.shipId = mate
      addLog(
        state,
        'info',
        '主控在虫洞里战沉——已由同队的 ' + shipDisplayName(state, ctx, mate) + ' 在洞内接任主控。',
      )
      return
    }
  }
  const idle = Object.keys(state.fleet).find((id) => state.aiAssignments[id] === undefined)
  if (idle !== undefined) {
    state.shipId = idle
    addLog(
      state,
      'info',
      wasBusy
        ? '驾驶中的舰船正被 AI 执勤占用——已自动改派驾驶 ' + shipDisplayName(state, ctx, idle) + '。'
        : '舰队里找不到正在驾驶的舰船——已自动改派驾驶 ' + shipDisplayName(state, ctx, idle) + '。',
    )
    return
  }
  state.shipId = addShipToFleet(state, DEFAULT_START_SHIP_ID)
  addLog(
    state,
    'info',
    '协会补助：一艘全新的沙猫级采矿艇已停靠机库（保底舰船；其余舰船正被 AI 执勤占用或已全损）。',
  )
}

/** 当前船耐久 0~1 */
export function durabilityOf(state: GameState, shipId: string): number {
  return state.fleet[shipId]?.durability ?? 0
}

/* ───────── P2 修理数值（2026-09-05 定稿）：组件=固定 HP×容量增幅；港内=按缺失 HP×费率×科技档 ───────── */

/** 舰船科技档权重（低档便宜、高档贵；赠舰按 甲+结构 总量归档）：
 * L1 <200k / 池<200 → ×0.4；L2 <800k / 池<400 → ×0.7；L3 <1.5M / 池<700 → ×1.0；其余（旗舰级）→ ×1.4 */
function repairTierWeight(def: { priceIsk: number; armorHp?: number; hullHp?: number }): number {
  const price = def.priceIsk ?? 0
  const poolKey = (def.armorHp ?? 0) + (def.hullHp ?? 0)
  const key = price > 0 ? price : poolKey
  if (price > 0 ? key < 200_000 : key < 200) return 0.4
  if (price > 0 ? key < 800_000 : key < 400) return 0.7
  if (price > 0 ? key < 1_500_000 : key < 700) return 1.0
  return 1.4
}

/** 该船装甲/结构层的“满值（含模块与技能放大）”与“出厂基础”——组件固定回复按 层满值/基础 = 容量增幅 */
function layerCaps(
  state: GameState,
  ctx: SimContext,
  shipId: string,
): { capA: number; capH: number; baseA: number; baseH: number } | null {
  const spec = createPlayerSpec(state, ctx, shipId)
  const def = fleetDefOf(state, ctx, shipId)
  if (!spec || !def) return null
  return { capA: spec.hp.a, capH: spec.hp.h, baseA: def.armorHp ?? 0, baseH: def.hullHp ?? 0 }
}

/** 装甲/结构层的满值（含模块与技能放大）——对外只读口。
 *  与维修、修理组件同一把尺（`layerCaps`）；低安遇袭「先扣装甲再进结构」按它换算 HP
 *  （2026-09-11 船长定：伤害改为按敌人火力折算，见 `encounters.ts`）。 */
export function hullLayerCaps(
  state: GameState,
  ctx: SimContext,
  shipId: string,
): { capA: number; capH: number; baseA: number; baseH: number } | null {
  return layerCaps(state, ctx, shipId)
}

/** 一枚组件对 甲/结构 各自的实际回复 HP = 基础值 × 层容量增幅 × 舰体快修学（+10%/级）
 *  （技能系数走 `repair.quickRepairFactor`——与船体维修装置每跳共用同一处，见该模块头注释） */
function kitHealFor(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  baseHp: number,
  caps: { capA: number; capH: number; baseA: number; baseH: number } | null,
): { a: number; h: number } {
  const skill = quickRepairFactor(state, ctx)
  const aMult = caps && caps.baseA > 0 ? caps.capA / caps.baseA : 1
  const hMult = caps && caps.baseH > 0 ? caps.capH / caps.baseH : 1
  return { a: Math.max(1, Math.round(baseHp * aMult * skill)), h: Math.max(1, Math.round(baseHp * hMult * skill)) }
}

/** 维修某艘拥有船的费用（ISK；维修工程学 −10%/级 × 空间站协议学 −5%/级乘算；
 * 2026-09-08 船长定：移除「合计下限 40%」护栏，双满级实付 37.5%）。
 * P2 定稿：费用 =（结构缺失 HP + 装甲缺失 HP）× 每 HP 费率 × 科技档权重——与装甲/结构池同尺，
 * 低档船便宜、旗舰级贵（旧“按货舱计费”已废弃：货舰修不起且与池脱钩）。 */
export function repairCostIsk(state: GameState, shipId: string, ctx: SimContext): number {
  const fleetShip = state.fleet[shipId]
  const def = fleetDefOf(state, ctx, shipId)
  if (!fleetShip || !def) return 0
  const caps = layerCaps(state, ctx, shipId)
  if (!caps) return 0
  const missingHp =
    Math.max(0, 1 - fleetShip.durability) * caps.capH + Math.max(0, 1 - (fleetShip.armorPct ?? 1)) * caps.capA
  const engLv = Math.min(5, state.skills.trained['repair-engineering'] ?? 0)
  const protoLv = Math.min(5, state.skills.trained['station-protocol'] ?? 0)
  const disc = Math.max(0, (1 - 0.1 * engLv) * (1 - 0.05 * protoLv))
  return Math.ceil(missingHp * ctx.balance.repair.perHpCost * repairTierWeight(def) * disc)
}

/** 玩家指令：维修某艘拥有船（回满耐久与装甲；钱不够时按比例修复可用部分） */
export function repairShip(state: GameState, shipId: string, ctx: SimContext): CommandResult {
  // **进洞船只所有行为锁定**（船长 2026-09-13：锁，进洞船只所有行为都锁定。包括维修。）
  const lock = shipLockedReason(state, shipId, '在站里修它')
  if (lock) return { ok: false, error: lock }
  const fleetShip = state.fleet[shipId]
  const def = fleetDefOf(state, ctx, shipId)
  const name = shipDisplayName(state, ctx, shipId)
  if (!fleetShip || !def) return { ok: false, error: `机库里没有 ${name}。` }
  // T8：驾驶船在野外/返航途中时不能维修（维修服务在空间站）
  if (shipId === state.shipId && (state.awayGalaxy !== null || state.standby.active)) {
    return { ok: false, error: `${name} 不在空间站（野外/掩护巡逻途中）——返航后才能维修。` }
  }
  // 2026-09-08（船长定）：未建成建站点不视为站点——维修服务在副站建成（并入基地网络）后开放
  if (state.dockedSite !== null) {
    const dockSite = ctx.stations.get(state.dockedSite)
    const prog = dockSite ? state.stationSites[dockSite.id] : null
    if (dockSite && (!prog || prog.stage < dockSite.tiers.length)) {
      return { ok: false, error: `「${dockSite.name}」尚未建成：工地不提供停靠与服务，维修需在母港或已建成的副站进行。` }
    }
  }
  if (fleetShip.durability >= 1 && (fleetShip.armorPct ?? 1) >= 1) {
    return { ok: false, error: `${name} 状态完好，无需维修。` }
  }
  const cost = repairCostIsk(state, shipId, ctx)
  if (state.wallet.isk < cost) {
    return { ok: false, error: `维修费不足：需要 ${cost.toLocaleString('zh-CN')} 信用点。` }
  }
  state.wallet.isk -= cost
  fleetShip.durability = 1
  fleetShip.armorPct = 1
  // 「第一次维修舰船」与「维修技师」链：**港内付费维修**记一次（2026-09-17 教程重做批）
  bumpFirst(state, 'repairs')
  addLog(state, 'trade', `已完成 ${name} 的全面维修（${cost.toLocaleString('zh-CN')} 信用点），结构/装甲恢复至 100%。`)
  return { ok: true }
}

/* ───────── T5 船只锁定（防误售，跨会话持久） ───────── */
/** 该船是否已锁定（锁定后不可出售，其它操作不受影响） */
export function isShipLocked(state: GameState, shipId: string): boolean {
  return state.shipLocks[shipId] === true
}

/** 一次自动修理的结果（供"组件是否够"的判定用） */
export interface RepairWithKitsResult {
  /** 消耗的组件枚数 */
  used: number
  /** 是否修到目标（装甲与结构**都** ≥ target） */
  reachedTarget: boolean
  /** 是否因**组件耗尽**而中断（未达标且已无件可用）——低安遇袭「断料即返港」判据 */
  outOfKits: boolean
  /**
   * **本船是否装着"能吃组件的"船体维修装置**（2026-09-16 船长改判新增）。
   * `false` ⇒ 自动修补**根本不会发生**（既不消耗组件、也不写日志）——
   * 调用方据此把"没带装置"与"带了装置但组件耗尽"分开说话（两者的玩家下一步动作不同）。
   */
  hasDevice: boolean
  /** 本次**允许消耗**的组件 id（跟着装置走：装配顺序、去重；无装置 = 空表） */
  kitIds: string[]
}

/**
 * **自动修补可用的修理组件 = 跟着装置走**（2026-09-16 船长原话：
 * 「洞外，原本的损伤严重自动消耗维修组件功能，需要修改。**改成需要玩家携带对应的船体维修装置。
 * 消耗的维修组件类型也跟着装置走**」）。
 *
 * 口径：本船**装配中**的维修装置各自的 `repairKit`（装配顺序、去重）——
 * 民用装置 ⇒ 民用修理组件；MK1/MK2 ⇒ 军用修理组件；两者都装 ⇒ 两种都能吃。
 * ⚠ **无装配装置**（或只有"无组件自愈件"`repairFree`、生体件没有 `repairKit`）⇒ **空表 = 不做自动修补**
 * （旧口径"不看装置、民用优先"**作废**）。
 */
export function repairKitIdsOf(state: GameState, ctx: SimContext, shipId: string): string[] {
  const ship = state.fleet[shipId]
  if (!ship) return []
  const out: string[] = []
  for (const d of allFittedModules(ship.fitted, ctx)) {
    const kit = d.repairKit
    if (typeof kit === 'string' && kit.length > 0 && !out.includes(kit)) out.push(kit)
  }
  return out
}

/**
 * 自动用修理组件的**唯一单点**（T8 P2 定稿；2026-09-12 扩口为逐船 + 可选仓库来源）。
 * - **修哪艘**：`shipId`（2026-09-12 前只修驾驶船；现主控与 AI 副船共用）。
 * - **来源**：`'cargo'`（默认）只读货舱 = **重复清剿的既有口径，行为不变**；
 *   `'cargo+warehouse'` 货舱优先、仓库兜底 = **低安遇袭自动修理**（船长 2026-09-12「用组件，包括仓库组件」，
 *   与战斗预载 `preloadRepairFor` 同序）。
 * - **前置（2026-09-16 船长改判）**：必须**装着船体维修装置**；**取件只认装置指定的那一种组件**
 *   （民用装置吃民用、MK1/MK2 吃军用——旧口径"民用优先"作废）。
 * - 每次回复 = 基础 HP × 层容量增幅 × 舰体快修学（与手动同口径，组件本体数值不变）。
 */
export function repairWithKitsFor(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  target = 0.5,
  source: 'cargo' | 'cargo+warehouse' = 'cargo',
): RepairWithKitsResult {
  // **进洞船只所有行为锁定**（船长 2026-09-13：锁，进洞船只所有行为都锁定。包括维修。）
  const lock = shipLockedReason(state, shipId, '用维修装置修它')
  if (lock) return { used: 0, reachedTarget: true, outOfKits: false, hasDevice: false, kitIds: [] }
  const fleetShip = state.fleet[shipId]
  if (!fleetShip) return { used: 0, reachedTarget: true, outOfKits: false, hasDevice: false, kitIds: [] }
  const caps = layerCaps(state, ctx, shipId)
  const damaged = (): boolean => fleetShip.durability < target || (fleetShip.armorPct ?? 1) < target
  const kitIds = repairKitIdsOf(state, ctx, shipId)
  /** 没带"能吃组件的维修装置" ⇒ 自动修补不启动（也不改任何状态） */
  if (kitIds.length === 0) {
    return { used: 0, reachedTarget: !damaged(), outOfKits: false, hasDevice: false, kitIds: [] }
  }
  let used = 0
  const usedByType: Record<string, number> = {}
  let guard = 0
  while (damaged() && guard < 1000) {
    guard += 1
    const kitId = takeRepairKit(state, ctx, shipId, source, kitIds)
    if (kitId === null) break
    const def = ctx.items.get(kitId)!
    const heal = kitHealFor(state, ctx, shipId, def.repairRestore!, caps)
    // 「第一次维修舰船」与「维修技师」链：自动修理**每消耗一枚组件记一次**（与手动用组件同口径）
    bumpFirst(state, 'repairs')
    if (caps) {
      fleetShip.durability = Math.min(1, Math.round((fleetShip.durability + heal.h / caps.capH) * 1000) / 1000)
      fleetShip.armorPct = Math.min(1, Math.round(((fleetShip.armorPct ?? 1) + heal.a / caps.capA) * 1000) / 1000)
    }
    used += 1
    usedByType[kitId] = (usedByType[kitId] ?? 0) + 1
  }
  if (used > 0) {
    // 组件类型跟着装置走 ⇒ 日志里点名用的是哪一种（玩家据此判断该补哪种组件）
    const kinds = Object.entries(usedByType)
      .map(([id, n]) => `${ctx.items.get(id)?.name ?? id} ×${n}`)
      .join('、')
    addLog(
      state,
      'info',
      `自动使用修理组件 ×${used}（${kinds}）：${shipDisplayName(state, ctx, shipId)} 结构恢复至 ${Math.round(fleetShip.durability * 100)}%、装甲 ${Math.round((fleetShip.armorPct ?? 1) * 100)}%。`,
    )
  }
  const reached = !damaged()
  return { used, reachedTarget: reached, outOfKits: !reached, hasDevice: true, kitIds }
}

/**
 * 取一枚修理组件并扣账（**只认 `allowed` 里的 id**；`cargo+warehouse` 时货舱优先、仓库兜底）；
 * 无件返回 null。⚠ 2026-09-16 起不再"民用优先/兜底其它组件"——可用种类由**装置**决定。
 */
function takeRepairKit(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  source: 'cargo' | 'cargo+warehouse',
  allowed: readonly string[],
): string | null {
  const fleetShip = state.fleet[shipId]
  if (!fleetShip) return null
  void ctx
  for (const id of allowed) {
    const inCargo = fleetShip.cargo[id] ?? 0
    if (inCargo > 0) {
      if (inCargo <= 1) delete fleetShip.cargo[id]
      else fleetShip.cargo[id] = inCargo - 1
      return id
    }
    if (source === 'cargo+warehouse' && countWare(state, id) > 0) {
      removeWare(state, id, 1)
      return id
    }
  }
  return null
}

/**
 * 自动用修理组件修**驾驶船**至 target（重复清剿阈值默认 0.5），或组件耗尽。
 * ⚠ 口径固定为**只读货舱**（2026-09-12 前的唯一口径，重复清剿仍走它，行为一字不变）；
 * ⚠ **2026-09-16 起需要该船装着船体维修装置**（见 `repairWithKitsFor`），返回值带 `hasDevice`
 * 供调用方把"没带装置"与"组件耗尽"分开说话。
 */
export function repairWithKits(state: GameState, ctx: SimContext, target = 0.5): RepairWithKitsResult {
  return repairWithKitsFor(state, ctx, state.shipId, target, 'cargo')
}

/**
 * 手动使用一枚修理组件（驾驶船货仓，民用优先；2026-09-05 修理系统，P2 定稿）：
 * 对「结构」与「装甲」各恢复“基础 HP × 层容量增幅 ×（1+10%/级 抢修工程学）”；无组件/未受损返回原因。
 */
export function useOneRepairKit(state: GameState, ctx: SimContext): CommandResult {
  const fleetShip = state.fleet[state.shipId]
  if (!fleetShip) return { ok: false, error: '舰队里找不到当前舰船。' }
  if (fleetShip.durability >= 1 && (fleetShip.armorPct ?? 1) >= 1) {
    return { ok: false, error: '结构/装甲状态完好，无需修理组件。' }
  }
  const order = ['repairkit-civ', 'repairkit-mil'] as const
  let kitId: string | null = null
  for (const id of order) {
    if ((fleetShip.cargo[id] ?? 0) > 0) {
      kitId = id
      break
    }
  }
  if (kitId === null) return { ok: false, error: '货仓里没有修理组件——市场购入或蓝图自制后装入货仓。' }
  const def = ctx.items.get(kitId)
  if (!def || typeof def.repairRestore !== 'number') return { ok: false, error: '修理组件异常。' }
  const caps = layerCaps(state, ctx, state.shipId)
  const heal = kitHealFor(state, ctx, state.shipId, def.repairRestore, caps)
  const left = fleetShip.cargo[kitId]!
  if (left <= 1) delete fleetShip.cargo[kitId]
  else fleetShip.cargo[kitId] = left - 1
  if (caps) {
    fleetShip.durability = Math.min(1, Math.round((fleetShip.durability + heal.h / caps.capH) * 1000) / 1000)
    fleetShip.armorPct = Math.min(1, Math.round(((fleetShip.armorPct ?? 1) + heal.a / caps.capA) * 1000) / 1000)
  }
  const shipName = shipDisplayName(state, ctx, state.shipId)
  // 「第一次维修舰船」与「维修技师」链：手动用掉一枚修理组件记一次（与港内付费维修同口径）
  bumpFirst(state, 'repairs')
  addLog(
    state,
    'info',
    `✚ 使用 ${def.name} ×1：${shipName} 结构恢复至 ${Math.round(fleetShip.durability * 100)}%、装甲 ${Math.round((fleetShip.armorPct ?? 1) * 100)}%。`,
  )
  return { ok: true }
}

/** 玩家指令：锁定 / 解锁一艘拥有的船（防误售） */
export function lockShip(state: GameState, shipId: string, locked: boolean, ctx: SimContext): CommandResult {
  if (!ownsShip(state, shipId)) return { ok: false, error: `机库里没有这艘船。` }
  const name = shipDisplayName(state, ctx, shipId)
  if (locked) {
    if (isShipLocked(state, shipId)) return { ok: false, error: `${name} 已处于锁定状态。` }
    state.shipLocks[shipId] = true
    addLog(state, 'info', `已锁定 ${name}：此船不可移入舰船仓库（可随时在舰船页解锁）。`)
  } else {
    if (!isShipLocked(state, shipId)) return { ok: false, error: `${name} 当前未锁定。` }
    delete state.shipLocks[shipId]
    addLog(state, 'info', `已解锁 ${name}：恢复可移入舰船仓库。`)
  }
  return { ok: true }
}

/* ═══════════════ 舰船仓库（2026-09-14 船长裁定 · 本会话新批） ═══════════════
 * 船长原话（照抄）：「接下来实现舰船出售，建议先将舰队页面中的舰船市场换成舰船仓库，所有组装机生产的
 * 舰船都放进舰船仓库内，并允许堆叠数量。舰船仓库内添加筛选：全部/已拥有/未拥有。以及和我的舰队页面
 * 相同的类别，级别筛选。玩家可以从舰船仓库中将船转移到我的舰队内。而我的舰队内的无装配满耐久的舰船
 * 也可以转移到舰船仓库。之后移除我的舰队内舰船的出售按钮。」＋「舰船仓库是用于方便市场出售舰船的」。
 *
 * 口径（与本仓 design 稿 `docs/design/ship-warehouse-20260914.md` 同源）：
 * ① 仓库 = **纯计数**（`state.shipStore`：船型 id → 艘数）；仓里的船一律"全新"——
 *    满耐久（结构＋装甲都是 100%）· 无装配 · 货仓空 · 无自定义名；
 * ② 舰队 → 仓库（`storeShip`）：还要**非驾驶中 · 无 AI 任务 · 非返航善后中 · 未锁定 · 不受进洞/自动探索锁**；
 *    有自定义名 ⇒ 报 `named`，由界面弹确认、确认后带 `clearName` 再来（**不静默丢名字**）；
 * ③ 仓库 → 舰队（`unstoreShip`）：即时、免费，`addShipToFleet` 生成全新实例；**舰队不设上限**；
 * ④ 出售走市场挂单（`market.sellStoredShipAtMarket`）：先吃收购簿即时成交，未成交留在簿上，
 *    **撤单退回舰船仓库**（escrow 记 `from: 'store'`）；
 * ⑤ 老档缺省空 ⇒ **零迁移**（`save.ts` 只收正整数）。 */

/** 仓库里该船型的艘数（读口径单点；负数/非法值一律当 0） */
export function shipStoredCount(state: GameState, defId: string): number {
  const n = state.shipStore?.[defId] ?? 0
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

/** 该船型的**总持有** = 仓库 ＋ 在役舰队（问"我有没有这型船"一律走这里；筛选口径另见设计稿） */
export function shipOwnedCount(state: GameState, defId: string): number {
  let n = shipStoredCount(state, defId)
  for (const [uid, s] of Object.entries(state.fleet)) {
    if ((s.defId ?? uidDefId(uid)) === defId) n += 1
  }
  return n
}

/**
 * 入仓校验（界面按钮的置灰/拒因与引擎同源）：不满足 ⇒ `{ ok: false, reason }`。
 * `named: true` 是**唯一可以确认放行**的一档（有自定义名）：界面弹「入仓将清除自定义名」，
 * 玩家确认后带 `{ clearName: true }` 再调 `storeShip`。
 */
export function shipStorable(state: GameState, uid: string): { ok: boolean; reason?: string; named?: boolean } {
  const ship = state.fleet[uid]
  if (!ship) return { ok: false, reason: '机库里没有这艘船。' }
  if (state.shipId === uid) return { ok: false, reason: '正在驾驶的船不能入仓：先换到别的船上。' }
  if (state.aiAssignments[uid]) return { ok: false, reason: 'AI 任务执行中的船不能入仓，先取消指派。' }
  if (isShipLocked(state, uid)) return { ok: false, reason: '该船已锁定（防误操作）：先到舰船页解锁。' }
  // ⚠ 判据与 `mining.shipInReturn` 同义；**这里直接读 state**（不 import mining：mining → shipyard 已有依赖边，
  // 反向 import 会成环——与 `state.shipLockedReason` 直读 `state.wormholeAuto` 同款处置）
  if (uid in state.shipReturns) return { ok: false, reason: '该船正在返航卸货（换船善后），到港后才能入仓。' }
  const cargoUnits = Object.values(ship.cargo).reduce((a, b) => a + b, 0)
  if (cargoUnits > 0) return { ok: false, reason: '货仓里有物品，请先清空。' }
  if (allFittedIds(ship.fitted).length > 0) return { ok: false, reason: '还装着模块，请先卸下。' }
  if ((ship.durability ?? 1) < 1 || (ship.armorPct ?? 1) < 1) {
    return { ok: false, reason: '只有满耐久（结构与装甲都完好）的船才能入仓：先维修。' }
  }
  if (ship.customName) return { ok: false, reason: '该船有自定义名——入仓会清掉它。', named: true }
  return { ok: true }
}

/** 玩家指令：把机库里的一艘船移入舰船仓库（同型 +1 艘）。`clearName` = 已在确认弹层同意清掉自定义名 */
export function storeShip(
  state: GameState,
  uid: string,
  ctx: SimContext,
  opts?: { clearName?: boolean },
): CommandResult {
  const lock = shipLockedReason(state, uid, '移入舰船仓库')
  if (lock) return { ok: false, error: lock }
  const check = shipStorable(state, uid)
  if (!check.ok && !(check.named === true && opts?.clearName === true)) {
    return { ok: false, error: check.reason ?? '这艘船不能入仓。' }
  }
  const ship = state.fleet[uid]!
  const defId = ship.defId ?? uidDefId(uid)
  const name = shipDisplayName(state, ctx, uid)
  delete state.fleet[uid]
  // 释放这艘船的杂项账本（锁定标记随实例走，船没了就不该留着）
  delete state.shipLocks[uid]
  state.shipStore = state.shipStore ?? {}
  state.shipStore[defId] = shipStoredCount(state, defId) + 1
  addLog(
    state,
    'info',
    check.named === true
      ? `${name} 已移入舰船仓库（自定义名随之清除）：仓库现有 ${state.shipStore[defId]} 艘。`
      : `${name} 已移入舰船仓库：仓库现有 ${state.shipStore[defId]} 艘。`,
  )
  return { ok: true }
}

/** 玩家指令：把舰船仓库里的一艘转入舰队（生成全新实例：满耐久/无装配/无名） */
export function unstoreShip(state: GameState, defId: string, ctx: SimContext): CommandResult {
  const n = shipStoredCount(state, defId)
  if (n <= 0) return { ok: false, error: '舰船仓库里没有这一型。' }
  const def = ctx.ships.get(defId)
  if (!def) return { ok: false, error: `未知舰船：${defId}。` }
  state.shipStore![defId] = n - 1
  if (state.shipStore![defId] <= 0) delete state.shipStore![defId]
  const uid = addShipToFleet(state, defId)
  // ⚠ 2026-09-18 修：这一行原先误放在"从舰船仓库转入舰队"这条路径上——**这不是"造出"**，
  //   「第一次造船」的计数改落在 `manufacturing.ts` 的造船交付处（与 `firstShipBuilt` 同一处）。
  addLog(state, 'info', `${shipDisplayName(state, ctx, uid)} 已从舰船仓库转入舰队（机库）。`)
  return { ok: true }
}

