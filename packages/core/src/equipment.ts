/**
 * 装备：入库/出库/装配/加成（V18 槽位制）。
 *
 * 规则（中文说明，v7 + V10 + V17 + V18）：
 * - 装配位置在"当前驾驶的船"上（fleet[shipId].fitted），换船看到的是那艘船的装备；
 * - 装备库（moduleBay）是空间站库存：制造完成先入库，装配时取出；
 * - 弃船会连 fitted 一起遗失（moduleBay 不丢）；
 * - V18 槽位制：fitted = 三类位数组 {high/mid/low: (id|null)[]}，长度 = 船对应槽类
 *   数量（ShipDef.slots，复数安装）。模块归槽 = ModuleDef.rack（rackOf 单点推导）；
 * - 装配 = 装入该类第一空位（可指定位）；卸下 = 按 槽类+位序；
 *   V18A：抗/容系与推进器"同类唯一"；**V18.1（船长 2026-09-04）：取消同类唯一——
 *   全部可复数安装**，防超模靠两类收敛（stackingOf/curveMult/gapCombine）：
 *   缺口复合组（抗性/闪避）、EVE 曲线组（命中/速度）；加算组（伤害/射速/容量/导控）
 *   线性叠加不额外收敛——唯一硬约束 = CPU 全位合计（与无人机放飞共用）；
 * - V17 CPU 装配校验沿用：全部位合计 cpuUse ≤ 船体 cpu（与无人机放飞共用）；
 *   口径已随 V18 取消：任意船可装任意炮；
 * - 载入修复链（repairDeprecatedModules）：下架型号迁移/退回 + V18 槽位数与船布局
 *   对齐（超长尾件退库、短位补空）+ 旧 -h 弹药并入（migrateDeprecatedAmmo）；
 * - 加成查询 = 按家族求和（复数矿枪/货舱扩展线性叠加；AI/采矿/货舱同源单点）。
 */
import { addLog } from './state'
import type { CommandResult } from './engine'
import type { GameState } from './state'
import type { FittedModules, ModuleDef, ModuleSlot, RackSlot, SimContext, DamageResists } from './types'
import { allFittedIds, MODULE_SLOTS, rackBays, rackLabel, rackOf, shipSlotsOf, SLOT_LABELS, slotLabel as labelOf } from './labels'
import { currentShipState } from './inventory'
import { fleetDefOf } from './instances'

/** 槽位顺序（界面展示用；V18 保留家族序供清单/徽标） */
export { MODULE_SLOTS } from './labels'

/** 槽位中文名（家族徽标/日志） */
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

/* ═══════════ V18 fitted 位数组语义（多件查询/唯一键/占用） ═══════════ */

/** 全位已装模块定义（顺序 = 高→中→低 位序；跳过空位） */
export function allFittedModules(fitted: FittedModules, ctx: SimContext): ModuleDef[] {
  const out: ModuleDef[] = []
  for (const id of allFittedIds(fitted)) {
    const def = ctx.modules.get(id)
    if (def) out.push(def)
  }
  return out
}

/** 某家族（slot 六值）的全部已装件定义（按位序）——复数语义消费者用 */
export function familyModules(state: GameState, ctx: SimContext, shipId: string, family: ModuleSlot): ModuleDef[] {
  const fitted = state.fleet[shipId]?.fitted
  if (!fitted) return []
  return allFittedModules(fitted, ctx).filter((d) => d.slot === family)
}

/* ═══════════ V18.1 多件收敛（取消同类唯一后的防超模机制） ═══════════ */

/** 收敛分组：gap = 缺口复合（抗性/闪避）、curve = EVE 曲线（命中/速度）、flat = 加算线性 */
export type StackGroup = 'gap' | 'curve' | 'flat'

/**
 * 一件装备的收敛分组与收敛键（同键 = 同一收敛池，按单件效果从强到弱参与合成）。
 * - 抗性（盾/甲各系）与闪避 → gap（缺口复合 1−Π(1−x)，天然收敛）；
 * - 命中/速度 → curve（EVE 曲线 Π(1+pᵢ·wᵢ)）；
 * - 伤害%/射速/容量%/矿枪/货舱/导控/炮台实体 → flat（加算线性，不额外收敛）。
 * UI 用 group 出"多装递减 / 可多装·全额叠加"标签；装配数件数用 kind 提示第 N 件。
 */
export function stackingOf(def: ModuleDef): { group: StackGroup; kind: string } {
  const resistKey = (add: DamageResists | undefined): string | null => {
    for (const [t, v] of Object.entries(add ?? {})) if ((v ?? 0) > 0) return t
    return null
  }
  if (def.evasionGapPct !== undefined) return { group: 'gap', kind: 'evasion' }
  if (def.hitBonusPct !== undefined) return { group: 'curve', kind: 'hit' }
  if (def.speedBonusPct !== undefined) return { group: 'curve', kind: 'speed' }
  const sk = resistKey(def.shieldResistAdd)
  if (sk) return { group: 'gap', kind: `shield-${sk}` }
  const ak = resistKey(def.armorResistAdd)
  if (ak) return { group: 'gap', kind: `armor-${ak}` }
  return { group: 'flat', kind: def.slot }
}

/** EVE 叠加曲线第 n 件权重（n 从 1 起）：e^−((n−1)/2.67)² ≈ 100% / 87% / 57% / 28% / 11%… */
export function stackWeight(n: number): number {
  const k = Math.max(0, n - 1) / 2.67
  return Math.exp(-(k * k))
}

/**
 * EVE 曲线多件合成系数：单件加成按"从强到弱"排位后
 * 总系数 = Π(1 + pᵢ × wᵢ)（EVE stacking penalty 标准形）。
 */
export function curveMult(bonuses: number[]): number {
  const sorted = [...bonuses].filter((p) => p > 0).sort((a, b) => b - a)
  let mult = 1
  for (let i = 0; i < sorted.length; i++) mult *= 1 + sorted[i]! * stackWeight(i + 1)
  return mult
}

/**
 * 缺口复合：1 − (1−base) × Π(1−xᵢ)。
 * base = 既有缺口值（如船体基础回避 0.13 / 船体基础抗 0.5），x = 各件缺口削减。
 * 两件 20% 闪避件且无基础 → 1−0.8² = 0.36（船长示例）。
 */
export function gapCombine(gaps: number[], base = 0): number {
  const cut = (x: number): number => Math.min(0.9, Math.max(0, x))
  let remain = 1 - cut(base)
  for (const x of gaps) remain *= 1 - cut(x)
  return 1 - remain
}

/** 已装模块中与目标件同收敛键（kind）的件数（含目标件本身则 +1 由调用方处理） */
export function sameKindCount(fitted: FittedModules, ctx: SimContext, def: ModuleDef): number {
  const kind = stackingOf(def).kind
  let n = 0
  for (const id of allFittedIds(fitted)) {
    const d = ctx.modules.get(id)
    if (d && d.id !== def.id && stackingOf(d).kind === kind) n++
  }
  return n
}

/** 全位 CPU 占用合计（与无人机放飞共用池；装配校验/战斗余量同源） */
export function fittedCpuUsed(fitted: FittedModules, ctx: SimContext): number {
  let used = 0
  for (const def of allFittedModules(fitted, ctx)) used += def.cpuUse ?? 0
  return used
}

/** 当前驾驶船的 fitted（空船时返回 null） */
function fittedOf(state: GameState): GameState['fleet'][string]['fitted'] | null {
  return currentShipState(state)?.fitted ?? null
}

/* ═══════════ 装配 / 卸下（V18 位数组） ═══════════ */

/** 找某槽类第一个空位（无空位返回 -1） */
export function firstFreeBay(fitted: FittedModules, rack: RackSlot): number {
  return rackBays(fitted, rack).findIndex((id) => id === null)
}

/**
 * 玩家指令：把装备库里的装备装到当前船对应槽类（rack）的某空位。
 * index 缺省 = 第一个空位；该槽类无空位/CPU 超限 → 拒绝并提示。
 * V18.1：无同类唯一约束——任何件可复数安装，防超模靠收敛机制（stackingOf）与 CPU。
 */
export function fitModule(
  state: GameState,
  moduleId: string,
  ctx: SimContext,
  opts?: { rack?: RackSlot; index?: number },
): CommandResult {
  const def = ctx.modules.get(moduleId)
  if (!def) return { ok: false, error: `未知装备：${moduleId}。` }
  if (countModule(state, moduleId) < 1) {
    return { ok: false, error: `装备库里没有 ${def.name}，先去制造台造一件。` }
  }
  const fitted = fittedOf(state)
  if (!fitted) return { ok: false, error: '当前舰船数据缺失，无法装配。' }
  const rack = opts?.rack ?? rackOf(def)
  const bays = rackBays(fitted, rack)
  // V18 韧性：位数组长度按船布局期望补齐（repair 链负责持久对齐；此处兜底运行态）
  const shipDef = fleetDefOf(state, ctx, state.shipId)
  if (shipDef) {
    const want = shipSlotsOf(shipDef)[rack]
    while (bays.length < want) bays.push(null)
  }
  // 目标位
  let index = -1
  if (opts?.index !== undefined) {
    if (opts.index < 0 || opts.index >= bays.length || bays[opts.index] !== null) {
      return { ok: false, error: `该${rackLabel(rack)}位不可用（第 ${opts.index + 1} 位）。` }
    }
    index = opts.index
  } else {
    index = firstFreeBay(fitted, rack)
    if (index < 0) {
      return { ok: false, error: `${rackLabel(rack)}已满（${bays.length}/${bays.length}）：先卸下再装。` }
    }
  }
  // CPU 装配校验：全位合计（含新件）≤ 船体 cpu
  const cpuTotal = shipDef?.cpu
  if (cpuTotal !== undefined && cpuTotal > 0) {
    const used = fittedCpuUsed(fitted, ctx) + (def.cpuUse ?? 0)
    if (used > cpuTotal) {
      return { ok: false, error: `装配超载：合计需 CPU ${used}，船体上限 ${cpuTotal}（卸下其它装备或换低耗型号）。` }
    }
  }
  removeModule(state, moduleId)
  bays[index] = moduleId
  addLog(state, 'info', `已装配 ${def.name}（${rackLabel(rack)}第 ${index + 1} 位）。`)
  return { ok: true }
}

/** 玩家指令：按 槽类+位序 卸下当前船某位的装备（放回装备库） */
export function unfitAt(state: GameState, rack: RackSlot, index: number): boolean {
  const fitted = fittedOf(state)
  if (!fitted) return false
  const bays = rackBays(fitted, rack)
  if (index < 0 || index >= bays.length) return false
  const moduleId = bays[index]
  if (moduleId === null) return false
  bays[index] = null
  addModule(state, moduleId)
  addLog(state, 'info', `已卸下并放回装备库（${rackLabel(rack)}第 ${index + 1} 位）。`)
  return true
}

/** 玩家指令：卸下当前船"某家族的第一件"（旧六槽语义的兼容入口；UI 位操作请用 unfitAt）。
 * 家族 → 固定兼容位（V17_FAMILY_BAYS：turret→high0 / miner→high1 / shield→mid0 /
 * propulsion→mid1 / armor→low0 / cargo→low1）。 */
export function unfitSlot(state: GameState, family: ModuleSlot): boolean {
  const fitted = fittedOf(state)
  if (!fitted) return false
  const legacy = V17_FAMILY_BAYS[family]
  if (!legacy) return false // 无人机装置等新家族无 v17 兼容位：请用 unfitAt
  const bays = rackBays(fitted, legacy.rack)
  if (legacy.index >= bays.length || bays[legacy.index] === null) return false
  const moduleId = bays[legacy.index]!
  bays[legacy.index] = null
  addModule(state, moduleId)
  addLog(state, 'info', `已卸下并放回装备库（${slotLabel(family)}）。`)
  return true
}

/** v17 六槽 → v18 位映射（迁移与旧语义共用；新家族无映射位） */
export const V17_FAMILY_BAYS: Partial<Record<ModuleSlot, { rack: RackSlot; index: number }>> = {
  turret: { rack: 'high', index: 0 },
  miner: { rack: 'high', index: 1 },
  shield: { rack: 'mid', index: 0 },
  propulsion: { rack: 'mid', index: 1 },
  armor: { rack: 'low', index: 0 },
  cargo: { rack: 'low', index: 1 },
}

/** 指定船（缺省当前驾驶船）的家族加成：按家族求和（复数矿枪/货舱扩展线性叠加；
 * 战斗槽加成由各自字段直接进 combat.createPlayerSpec——本表对它们恒为 0） */
export function fittedBonuses(
  state: GameState,
  ctx: SimContext,
  shipId: string = state.shipId,
): Record<ModuleSlot, number> {
  const result = {} as Record<ModuleSlot, number>
  for (const slot of MODULE_SLOTS) result[slot] = 0
  const fitted = state.fleet[shipId]?.fitted
  if (!fitted) return result
  for (const def of allFittedModules(fitted, ctx)) {
    if (def.bonus !== undefined && def.slot !== 'turret') result[def.slot] += def.bonus ?? 0
  }
  return result
}

/**
 * V17 装备改版迁移表：旧"通用全系"战斗装备 id → 新分系专精款（动能款归位）。
 * 本表供 repairDeprecatedModules 使用。
 */
export const V17_MODULE_MIGRATIONS: Readonly<Record<string, string>> = {
  'mod-shield-1': 'mod-shield-kin-1',
  'mod-shield-2': 'mod-shield-kin-2',
  'mod-shield-3': 'mod-shield-kin-3',
  'mod-armor-1': 'mod-armor-kin-1',
  'mod-armor-2': 'mod-armor-kin-2',
  'mod-armor-3': 'mod-armor-kin-3',
  'mod-turret-1': 'mod-turret-kin-1',
  'mod-turret-2': 'mod-turret-kin-2',
  'mod-turret-3': 'mod-turret-kin-3',
}

/**
 * 载入存档后的装备修复（V17/V18；幂等）：把装配中/装备库里的已下架型号替换为迁移款、
 * 悬空件退回；并把每船位数组长度与船槽布局对齐（超长尾件退库、短位补空——含 v17 档
 * 六槽→18 位数组迁移后的 2/2/2 过渡形状）。应在 ctx 就绪后、离线结算前调用。
 */
export function repairDeprecatedModules(state: GameState, ctx: SimContext): void {
  let fittedMoved = 0
  let slotEmptied = 0
  let bayMoved = 0
  let aligned = 0
  for (const ship of Object.values(state.fleet)) {
    const fitted = ship?.fitted
    if (!fitted) continue
    const shipDef = ship?.defId ? ctx.ships.get(ship.defId) : undefined
    // 1) 逐位：目录外 id → 迁移替换，否则卸下退回
    for (const rack of ['high', 'mid', 'low'] as const) {
      const bays = rackBays(fitted, rack)
      for (let i = 0; i < bays.length; i++) {
        const id = bays[i]
        if (!id) continue
        if (!ctx.modules.get(id)) {
          const next = V17_MODULE_MIGRATIONS[id]
          if (next && ctx.modules.get(next)) {
            bays[i] = next
            fittedMoved += 1
          } else {
            bays[i] = null
            state.moduleBay[id] = countModule(state, id) + 1
            slotEmptied += 1
          }
        }
      }
    }
    // 2) V18 槽位数对齐：长度 = 船布局（目标短 → 尾件退库；目标长 → 补空）
    if (shipDef) {
      const target = {
        high: shipDef.slots?.high ?? 1,
        mid: shipDef.slots?.mid ?? 1,
        low: shipDef.slots?.low ?? 1,
      } as Record<RackSlot, number>
      for (const rack of ['high', 'mid', 'low'] as const) {
        const bays = rackBays(fitted, rack)
        const want = target[rack]
        if (bays.length > want) {
          for (let i = want; i < bays.length; i++) {
            const id = bays[i]
            if (id) {
              state.moduleBay[id] = countModule(state, id) + 1
              aligned += 1
            }
          }
          bays.length = want
        } else if (bays.length < want) {
          while (bays.length < want) bays.push(null)
        }
      }
    }
  }
  // 3) 装备库：有迁移的已下架型号 → 计数并入迁移款后删除旧键（无迁移的保留不丢资产）
  for (const [id, n] of Object.entries(state.moduleBay)) {
    const next = V17_MODULE_MIGRATIONS[id]
    if (!next || !ctx.modules.get(next)) continue
    state.moduleBay[next] = (state.moduleBay[next] ?? 0) + n
    delete state.moduleBay[id]
    bayMoved += n
  }
  const total = fittedMoved + slotEmptied + bayMoved + aligned
  if (total > 0) {
    addLog(
      state,
      'info',
      `装备修复：旧件按动能款迁移 ${fittedMoved + bayMoved} 件；悬空退回 ${slotEmptied} 件；` +
        (aligned > 0 ? `槽位数与船布局对齐，溢出件退回装备库 ${aligned} 件。` : ''),
    )
  }
}

export { SLOT_LABELS }

/**
 * V18 口径取消（船长 2026-09-04）：弹药每型只留单档（-l），把 -h 重弹按 1:1 并入对应
 * 通用弹（货仓/仓库/escrow）；挂着 -h 的玩家卖单撤销。幂等：跑过即无 -h 键。
 */
const HEAVY_TO_LIGHT: Record<string, string> = {
  'ammo-kinetic-h': 'ammo-kinetic-l',
  'ammo-explosive-h': 'ammo-explosive-l',
  'ammo-plasma-h': 'ammo-plasma-l',
}

export function migrateDeprecatedAmmo(state: GameState): number {
  let converted = 0
  for (const [id, n] of Object.entries(state.warehouse.items)) {
    const next = HEAVY_TO_LIGHT[id]
    if (!next) continue
    state.warehouse.items[next] = (state.warehouse.items[next] ?? 0) + n
    delete state.warehouse.items[id]
    converted += n
  }
  for (const ship of Object.values(state.fleet)) {
    const cargo = ship?.cargo
    if (!cargo) continue
    for (const id of Object.keys(cargo)) {
      const next = HEAVY_TO_LIGHT[id]
      if (!next) continue
      const n = cargo[id]!
      cargo[next] = (cargo[next] ?? 0) + n
      delete cargo[id]
      converted += n
    }
  }
  state.orders = state.orders.filter((o) => {
    if (o.side === 'sell' && o.good && HEAVY_TO_LIGHT[o.good]) {
      const locked = state.escrowItems[o.good] ?? 0
      const take = Math.min(locked, o.qty)
      if (take > 0) {
        state.escrowItems[o.good] = locked - take
        if (state.escrowItems[o.good] === 0) delete state.escrowItems[o.good]
        const next = HEAVY_TO_LIGHT[o.good]!
        state.warehouse.items[next] = (state.warehouse.items[next] ?? 0) + take
        converted += take
      }
      return false
    }
    return true
  })
  for (const id of Object.keys(state.escrowItems)) {
    const next = HEAVY_TO_LIGHT[id]
    if (!next) continue
    const n = state.escrowItems[id]!
    state.warehouse.items[next] = (state.warehouse.items[next] ?? 0) + n
    delete state.escrowItems[id]
    converted += n
  }
  if (converted > 0) {
    addLog(state, 'info', `V18 弹药改版：旧重型弹已按 1:1 并入通用弹（共 ${converted} 发），相关挂单已撤销。`)
  }
  return converted
}
