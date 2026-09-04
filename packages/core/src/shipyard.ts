/**
 * 舰队（v7 船坞）：拥有/丢失舰船、切换驾驶、耐久与维修。
 * 每艘船的 货仓/装备/耐久 都存在 fleet[uid] 里，随船生死。
 * v17（T5-B）：fleet 键 = 实例 uid——同型可多艘（第 1 艘 = 船型 id，
 * 第 2 艘起 = `船型id#N`，固定不回收）；条目带 defId/customName。
 */
import { addLog, DEFAULT_START_SHIP_ID } from './state'
import type { CommandResult } from './engine'
import type { FittedModules, FleetShipState, GameState } from './state'
import type { SimContext } from './types'
import { emptyFitted, uidDefId } from './labels'
import { fleetDefOf, shipDisplayName } from './instances'
import { miningReturnLegMs } from './location'

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
  return { defId, customName: null, durability: 1, cargo: {}, fitted }
}

/** 该实例的船型数据（uid → fleet 条目 → def；fleet 外/数据缺失返回 undefined） */
export { fleetDefOf } from './instances'

/** 一艘舰船的显示名（全链统一入口，见 instances.ts） */
export { shipDisplayName } from './instances'

/**
 * v17：自由改名（Q4 甲扩展，船长定稿：免费、上限 10 字、允许重名）。
 * name = null → 恢复默认名（船型名，同型多艘自动带号）。
 */
export function renameShip(state: GameState, uid: string, name: string | null): CommandResult {
  const entry = state.fleet[uid]
  if (!entry) return { ok: false, error: '船坞里没有这艘船。' }
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

/** 玩家指令：切换到拥有的另一艘船驾驶（采矿作业中可直接切换——旧船自动返航卸货善后，采矿随之结束） */
export function changeShip(state: GameState, shipId: string, ctx: SimContext): CommandResult {
  if (shipId === state.shipId) {
    return { ok: false, error: `正在驾驶的就是 ${shipDisplayName(state, ctx, shipId)}。` }
  }
  if (!ownsShip(state, shipId)) {
    const defName = ctx.ships.get(uidDefId(shipId))?.name ?? shipId
    return { ok: false, error: `船坞里没有 ${defName}——先到商店购买，或用舰船蓝图制造一艘。` }
  }
  const def = fleetDefOf(state, ctx, shipId)
  if (!def) return { ok: false, error: `未知舰船：${shipId}。` }
  // T8：驾驶船不在站内（野外停留/返航途中）时不可切换
  if (state.awayGalaxy !== null) {
    const where = state.transit.active
      ? '正在返航空间站途中'
      : `停留在「${ctx.galaxies.get(state.awayGalaxy)?.name ?? state.awayGalaxy}」星系（野外）`
    return { ok: false, error: `驾驶船${where}——请先「返航空间站」再换船。` }
  }
  if (state.expedition.active) {
    return {
      ok: false,
      error:
        '远征在途/返航中：切换驾驶会中断本次远征（无战果）。请先在顶部活动栏「召回远征」（交火中无法召回），或等战报返回后再换船。',
    }
  }
  if (state.scanning.active) {
    return {
      ok: false,
      error: '扫描探索往返途中：切换驾驶将中断本次扫描（已扫窗口进度保留）。请先在顶部活动栏「终止扫描」，或确认终止后由界面替你处理。',
    }
  }
  if (state.standby.active) return { ok: false, error: '舰船正在前往待命星系途中——到港后再换船。' }
  // 采矿作业中：直接切换成功——旧船按其当前阶段自动返航（到港自动卸货入仓库），采矿作业随之结束
  if (state.mining.active) {
    retireMiningShip(state, ctx)
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
  const legMs = miningReturnLegMs(state, ctx, beltId)
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

  // 当前驾驶船被弃 → 自动切到另一艘
  if (wasCurrent) {
    const other = Object.keys(state.fleet)[0]
    if (other) {
      state.shipId = other
      addLog(state, 'info', `已自动切换到 ${shipDisplayName(state, ctx, other)}。`)
    } else {
      // 一艘不剩：协会免费补发初始沙猫（保底）
      state.shipId = addShipToFleet(state, DEFAULT_START_SHIP_ID)
      addLog(state, 'info', '协会补助：一艘全新的沙猫级采矿艇已停靠机库（保底舰船）。')
    }
  }

  // 数据异常守卫：作业引用的船已经没了就强制停下
  if (state.mining.active && !state.fleet[state.shipId]) {
    state.mining.active = false
    state.mining.phase = 'mining'
    state.mining.phaseAccMs = 0
    state.mining.cycleAccMs = 0
  }
}

/** 当前船耐久 0~1 */
export function durabilityOf(state: GameState, shipId: string): number {
  return state.fleet[shipId]?.durability ?? 0
}

/** 维修某艘拥有船的费用（ISK） */
export function repairCostIsk(state: GameState, shipId: string, ctx: SimContext): number {
  const fleetShip = state.fleet[shipId]
  const def = fleetDefOf(state, ctx, shipId)
  if (!fleetShip || !def) return 0
  const missing = Math.max(0, 1 - fleetShip.durability)
  return Math.ceil(missing * def.cargoM3 * ctx.balance.repair.perM3Cost)
}

/** 玩家指令：维修某艘拥有船（回满耐久），钱不够时按比例修复可用部分 */
export function repairShip(state: GameState, shipId: string, ctx: SimContext): CommandResult {
  const fleetShip = state.fleet[shipId]
  const def = fleetDefOf(state, ctx, shipId)
  const name = shipDisplayName(state, ctx, shipId)
  if (!fleetShip || !def) return { ok: false, error: `船坞里没有 ${name}。` }
  // T8：驾驶船在野外/返航途中时不能维修（维修服务在空间站）
  if (shipId === state.shipId && (state.awayGalaxy !== null || state.standby.active)) {
    return { ok: false, error: `${name} 不在空间站（野外/待命途中）——返航后才能维修。` }
  }
  if (fleetShip.durability >= 1) return { ok: false, error: `${name} 状态完好，无需维修。` }
  const cost = repairCostIsk(state, shipId, ctx)
  if (state.wallet.isk < cost) {
    return { ok: false, error: `维修费不足：需要 ${cost.toLocaleString('zh-CN')} ISK。` }
  }
  state.wallet.isk -= cost
  fleetShip.durability = 1
  addLog(state, 'trade', `已完成 ${name} 的全面维修（${cost.toLocaleString('zh-CN')} ISK），耐久恢复至 100%。`)
  return { ok: true }
}

/* ───────── T5 船只锁定（防误售，跨会话持久） ───────── */
/** 该船是否已锁定（锁定后不可出售，其它操作不受影响） */
export function isShipLocked(state: GameState, shipId: string): boolean {
  return state.shipLocks[shipId] === true
}

/**
 * T8 修理组件（船长定稿 seam）：优先用货仓中的修理组件（itemDef.repairRestore > 0）
 * 修复驾驶船耐久，直到 ≥ target（连续出击阈值默认 0.5）或组件耗尽；返回消耗件数。
 * 内容数据后续补充修理组件条目后自动生效。
 */
export function repairWithKits(state: GameState, ctx: SimContext, target = 0.5): number {
  const fleetShip = state.fleet[state.shipId]
  if (!fleetShip) return 0
  let used = 0
  let guard = 0
  while (fleetShip.durability < target && guard < 500) {
    guard += 1
    const cargo = fleetShip.cargo
    let kitId: string | null = null
    for (const [itemId, units] of Object.entries(cargo)) {
      if (units <= 0) continue
      const def = ctx.items.get(itemId)
      if (def && typeof def.repairRestore === 'number' && def.repairRestore > 0) {
        kitId = itemId
        break
      }
    }
    if (kitId === null) break
    const def = ctx.items.get(kitId)!
    const restore = def.repairRestore!
    const units = cargo[kitId]!
    if (units <= 1) delete cargo[kitId]
    else cargo[kitId] = units - 1
    fleetShip.durability = Math.min(1, Math.round((fleetShip.durability + restore) * 1000) / 1000)
    used += 1
  }
  if (used > 0) {
    addLog(
      state,
      'info',
      `自动使用修理组件 ×${used}：${shipDisplayName(state, ctx, state.shipId)} 耐久恢复至 ${Math.round(fleetShip.durability * 100)}%。`,
    )
  }
  return used
}

/** 玩家指令：锁定 / 解锁一艘拥有的船（防误售） */
export function lockShip(state: GameState, shipId: string, locked: boolean, ctx: SimContext): CommandResult {
  if (!ownsShip(state, shipId)) return { ok: false, error: `船坞里没有这艘船。` }
  const name = shipDisplayName(state, ctx, shipId)
  if (locked) {
    if (isShipLocked(state, shipId)) return { ok: false, error: `${name} 已处于锁定状态。` }
    state.shipLocks[shipId] = true
    addLog(state, 'info', `已锁定 ${name}：此船不可出售（可随时在舰船页解锁）。`)
  } else {
    if (!isShipLocked(state, shipId)) return { ok: false, error: `${name} 当前未锁定。` }
    delete state.shipLocks[shipId]
    addLog(state, 'info', `已解锁 ${name}：恢复可出售。`)
  }
  return { ok: true }
}

