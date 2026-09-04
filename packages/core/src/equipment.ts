/**
 * 装备：入库/出库/装配/加成。
 *
 * 规则（中文说明，v7 + V10 + V17）：
 * - 装配位置在"当前驾驶的船"上（fleet[shipId].fitted），换船看到的是那艘船的装备；
 * - 装备库（moduleBay）是空间站库存：制造完成先入库，装配时取出；
 * - 弃船会连 fitted 一起遗失（moduleBay 不丢）；
 * - 槽位（v10 起六槽定死）：miner/cargo 工业槽即时生效（产量/容量）；
 *   turret/shield/armor/propulsion 战斗槽由战斗引擎消费各自参数（V17 起全部真生效，
 *   见 combat.createPlayerSpec——不再是占位家族）；
 * - V17 CPU 装配校验：fitModule 合计六槽 cpuUse ≤ 船体 cpu（与无人机放飞共用）；
 * - V17.2 炮口径适配：炮台 weaponSize ≤ 船适配口径才可装配（shipMaxWeaponSize：
 *   显式 maxWeaponSize 优先，缺省 armed/armored = heavy、其余 light）；存档修复顺带
 *   把旧档超口径炮台卸下退回（不丢资产）；
 * - V17 存档修复：repairDeprecatedModules 在载入后把已下架型号按迁移表原位替换
 *   （V17_MODULE_MIGRATIONS），悬空件退回装备库不丢资产；
 * - 加成查询统一返回按槽 Record：调用方只取自己关心的槽位（工业加成语义保留）。
 */
import { addLog } from './state'
import type { CommandResult } from './engine'
import type { GameState } from './state'
import type { ModuleDef, ModuleSlot, ShipDef, SimContext, WeaponSize } from './types'
import { MODULE_SLOTS, SLOT_LABELS, slotLabel as labelOf } from './labels'
import { currentShipState } from './inventory'
import { fleetDefOf } from './instances'

/** 槽位顺序（界面展示用） */
export { MODULE_SLOTS } from './labels'

const WEAPON_RANK: Record<WeaponSize, number> = { light: 0, heavy: 1 }
const SIZE_CN: Record<WeaponSize, string> = { light: '轻型', heavy: '重型' }

/**
 * V17.2 船体炮口径适配：显式 maxWeaponSize 优先；缺省按 role——
 * armed（武装舰）/ armored（装甲舰）= heavy，industrial / hauler = light。
 * 装配校验（fitModule）与装配台"适配口径"显示同源。
 */
export function shipMaxWeaponSize(ship: Pick<ShipDef, 'role' | 'maxWeaponSize'>): WeaponSize {
  if (ship.maxWeaponSize !== undefined) return ship.maxWeaponSize
  return ship.role === 'armed' || ship.role === 'armored' ? 'heavy' : 'light'
}

/** 槽位中文名（界面与日志共用） */
export function slotLabel(slot: ModuleSlot): string {
  return labelOf(slot)
}

/** 装备库数量查询 */
export function countModule(state: GameState, moduleId: string): number {
  return state.moduleBay[moduleId] ?? 0
}

/** 装备入库（制造完成/卸下） */
export function addModule(state: GameState, moduleId: string, count = 1): void {
  if (count <= 0) return
  state.moduleBay[moduleId] = countModule(state, moduleId) + count
}

/** 装备出库（装配/取出），数量不足返回 false */
export function removeModule(state: GameState, moduleId: string, count = 1): boolean {
  const current = countModule(state, moduleId)
  if (count <= 0 || current < count) return false
  const rest = current - count
  if (rest === 0) delete state.moduleBay[moduleId]
  else state.moduleBay[moduleId] = rest
  return true
}

/** 玩家指令：把装备库里的装备装到当前船的对应槽位（同槽旧件自动退回装备库） */
export function fitModule(state: GameState, moduleId: string, ctx: SimContext): CommandResult {
  const def = ctx.modules.get(moduleId)
  if (!def) return { ok: false, error: `未知装备：${moduleId}。` }
  if (countModule(state, moduleId) < 1) {
    return { ok: false, error: `装备库里没有 ${def.name}，先去制造台造一件。` }
  }
  const fitted = fittedOf(state)
  if (!fitted) return { ok: false, error: '当前舰船数据缺失，无法装配。' }
  const slot = def.slot
  if (fitted[slot] === moduleId) {
    return { ok: false, error: `${def.name} 已经装在该槽位上了。` }
  }
  // V17.2 炮口径适配校验：炮台口径不得超过船体适配口径
  // V17 CPU 装配校验：六件合计（目标槽按新件计）不得超过船体 cpu；超出拒绝装配
  // （与无人机放飞共用：装配占满后战斗将无余量放无人机——见 combat.createPlayerSpec）
  const shipDef = fleetDefOf(state, ctx, state.shipId)
  if (slot === 'turret' && def.weaponSize !== undefined && shipDef) {
    const maxSize = shipMaxWeaponSize(shipDef)
    if (WEAPON_RANK[def.weaponSize]! > WEAPON_RANK[maxSize]!) {
      return {
        ok: false,
        error: `口径不符：${def.name}（${SIZE_CN[def.weaponSize]}炮）装不上 ${shipDef.name}——它只适配${SIZE_CN[maxSize]}炮。`,
      }
    }
  }
  const cpuTotal = shipDef?.cpu
  if (cpuTotal !== undefined && cpuTotal > 0) {
    let used = 0
    for (const s of MODULE_SLOTS) {
      const id = s === slot ? moduleId : fitted[s]
      if (id) used += ctx.modules.get(id)?.cpuUse ?? 0
    }
    if (used > cpuTotal) {
      return { ok: false, error: `装配超载：合计需 CPU ${used}，船体上限 ${cpuTotal}（卸下其它装备或换低耗型号）。` }
    }
  }
  const prevId = fitted[slot]
  if (prevId !== null) {
    // 旧件退回装备库，再装新的
    fitted[slot] = null
    addModule(state, prevId)
  }
  removeModule(state, moduleId)
  fitted[slot] = moduleId
  addLog(state, 'info', `已装配 ${def.name}（${slotLabel(slot)}）。`)
  return { ok: true }
}

/** 玩家指令：卸下当前船某槽位的装备（放回装备库） */
export function unfitSlot(state: GameState, slot: ModuleSlot): boolean {
  const fitted = fittedOf(state)
  if (!fitted) return false
  const moduleId = fitted[slot]
  if (moduleId === null) return false
  fitted[slot] = null
  addModule(state, moduleId)
  addLog(state, 'info', `已卸下并放回装备库（${slotLabel(slot)}）。`)
  return true
}

/** 指定船（缺省当前驾驶船）的装备加成：按槽返回（V17：仅工业槽 bonus 有消费者；
 * 战斗槽加成由各自字段直接进 combat.createPlayerSpec——本表对它们恒为 0） */
export function fittedBonuses(
  state: GameState,
  ctx: SimContext,
  shipId: string = state.shipId,
): Record<ModuleSlot, number> {
  const result = {} as Record<ModuleSlot, number>
  for (const slot of MODULE_SLOTS) result[slot] = 0
  const fitted = state.fleet[shipId]?.fitted ?? null
  if (!fitted) return result
  for (const slot of MODULE_SLOTS) {
    const moduleId = fitted[slot]
    if (moduleId === null) continue
    const def = ctx.modules.get(moduleId)
    if (!def || def.slot !== slot) continue
    result[slot] = def.bonus ?? 0
  }
  return result
}

/** 当前驾驶船的 fitted（空船时返回 null） */
function fittedOf(state: GameState): GameState['fleet'][string]['fitted'] | null {
  return currentShipState(state)?.fitted ?? null
}

/**
 * V17 装备改版迁移表：旧"通用全系"战斗装备 id → 新分系专精款。
 * 归位原则 = 旧件普遍用于应对默认动能伤害 → 动能款（同类同代次）；护盾增强器旧 id
 * 顺延为动能型，装甲增厚板旧 id 亦为动能型。本表供 repairDeprecatedModules 使用。
 */
export const V17_MODULE_MIGRATIONS: Readonly<Record<string, string>> = {
  'mod-shield-1': 'mod-shield-kin-1',
  'mod-shield-2': 'mod-shield-kin-2',
  'mod-shield-3': 'mod-shield-kin-3',
  'mod-armor-1': 'mod-armor-kin-1',
  'mod-armor-2': 'mod-armor-kin-2',
  'mod-armor-3': 'mod-armor-kin-3',
  // V17.2 炮族制：旧"混型"炮台下架 → 动能款（协会制式）；异星原型（能量）与民用舰炮保留
  'mod-turret-1': 'mod-turret-kin-1',
  'mod-turret-2': 'mod-turret-kin-2',
  'mod-turret-3': 'mod-turret-kin-3',
}

/**
 * 载入存档后的装备改版修复（V17/V17.2；幂等）：把装配中/装备库里的已下架型号替换为
 * 迁移款（见 V17_MODULE_MIGRATIONS）；找不到迁移的悬空装配件退回装备库（不丢资产）；
 * 顺带清退超口径的历史炮台装配（迁移前无口径限制，旧档可能把重型炮装在小船上）。
 * 应在 ctx 就绪后、离线结算前调用一次（桌面 GameEngine.start 已接入）。
 */
export function repairDeprecatedModules(state: GameState, ctx: SimContext): void {
  let fittedMoved = 0
  let slotEmptied = 0
  let bayMoved = 0
  let caliberEmptied = 0
  // 1) 各船 fitted：目录外 id → 迁移替换，否则卸下退回；目录内炮台超口径 → 卸下退回
  for (const ship of Object.values(state.fleet)) {
    const fitted = ship?.fitted
    if (!fitted) continue
    const shipDef = ship?.defId ? ctx.ships.get(ship.defId) : undefined
    const maxSize = shipDef ? shipMaxWeaponSize(shipDef) : 'light'
    for (const slot of MODULE_SLOTS) {
      const id = fitted[slot]
      if (!id) continue
      if (!ctx.modules.get(id)) {
        const next = V17_MODULE_MIGRATIONS[id]
        if (next && ctx.modules.get(next)) {
          fitted[slot] = next
          fittedMoved += 1
        } else {
          fitted[slot] = null
          state.moduleBay[id] = countModule(state, id) + 1
          slotEmptied += 1
        }
        continue
      }
      // V17.2 口径清退：旧档超口径历史装配 → 卸下退回装备库
      if (slot === 'turret' && shipDef) {
        const def = ctx.modules.get(id)!
        if (def.weaponSize !== undefined && WEAPON_RANK[def.weaponSize]! > WEAPON_RANK[maxSize]!) {
          fitted[slot] = null
          state.moduleBay[id] = countModule(state, id) + 1
          caliberEmptied += 1
        }
      }
    }
  }
  // 2) 装备库：有迁移的已下架型号 → 计数并入迁移款后删除旧键（无迁移的保留不丢资产）
  for (const [id, n] of Object.entries(state.moduleBay)) {
    const next = V17_MODULE_MIGRATIONS[id]
    if (!next || !ctx.modules.get(next)) continue
    state.moduleBay[next] = (state.moduleBay[next] ?? 0) + n
    delete state.moduleBay[id]
    bayMoved += n
  }
  const total = fittedMoved + slotEmptied + bayMoved + caliberEmptied
  if (total > 0) {
    addLog(
      state,
      'info',
      `V17 装备改版：护盾/装甲增强器改为分系缺口抗性、炮台改为分系炮族（口径制）。` +
        `旧件按动能款迁移 ${fittedMoved + bayMoved} 件；无对应款退回 ${slotEmptied} 件；` +
        (caliberEmptied > 0 ? `超口径炮台退回 ${caliberEmptied} 件（小型船装不下重型炮）。` : ''),
    )
  }
}

export { SLOT_LABELS }
