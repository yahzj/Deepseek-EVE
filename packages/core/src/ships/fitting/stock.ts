/** 功能域职责拆分，保持原计算与顺序。 */
import type { ModuleSlot, SimContext, FittedModules, RackSlot, ModuleDef } from '../../types'
import { slotLabel as labelOf, allFittedIds, rackBays } from '../../labels'
import type { GameState } from '../../state'
import { ceilFinalQuantity } from '../../quantity'
import { countWare, currentShipState } from '../../inventory'
import { allFittedModules } from '../../fitted'
import { fleetDefOf } from '../../instances'
import { shipSlotsWithPlugsOf } from '../../plugs'

/** 槽位中文名（家族徽标/日志） */
export function slotLabel(slot: ModuleSlot): string {
  return labelOf(slot)
}

/** 装备库数量查询 */
export function countModule(state: GameState, moduleId: string): number {
  return state.moduleBay[moduleId] ?? 0
}

/**
 * 该装备的**当前持有总数**（装备库 + 所有舰船已装配位；2026-09-10 船长：
 * 敌族专属装备"集齐前不重复掉落"的判定口径 = 当前持有，不引入永久收集记录）。
 */
export function ownedModuleCount(state: GameState, moduleId: string): number {
  let n = countModule(state, moduleId)
  for (const ship of Object.values(state.fleet)) {
    if (!ship?.fitted) continue
    for (const id of allFittedIds(ship.fitted)) if (id === moduleId) n += 1
  }
  return n
}

/** 装备入库（制造完成/卸下） */
export function addModule(state: GameState, moduleId: string, count = 1): void {
  if (!Number.isFinite(count) || count <= 0) return
  state.moduleBay[moduleId] = countModule(state, moduleId) + ceilFinalQuantity(count)
}

/**
 * 该**物品**（无人机等消耗品）的当前持有总数 = 物品仓库 + 所有舰船机舱清单里的架数。
 * 2026-09-10 船长（G 族专属无人机引出）：「集齐前不重复掉落」对无人机按此口径判定——
 * 手上还有就不重复掉（该族池优先给别的件）；**打光之后重新进池**，等于"再刷一次就能补回来"。
 */
export function ownedItemCount(state: GameState, itemId: string): number {
  let n = countWare(state, itemId)
  for (const ship of Object.values(state.fleet)) {
    n += ship?.droneLoad?.[itemId] ?? 0
  }
  return n
}

/** 装备出库（装配/取出），数量不足返回 false */
export function removeModule(state: GameState, moduleId: string, count = 1): boolean {
  count = ceilFinalQuantity(count)
  const current = countModule(state, moduleId)
  if (!Number.isFinite(count) || count <= 0 || current < count) return false
  const rest = current - count
  if (rest === 0) delete state.moduleBay[moduleId]
  else state.moduleBay[moduleId] = rest
  return true
}

/**
 * **算作"武器"的槽位家族**（炮台 / 导弹架 / 激光炮 / 无人机舱 / 战术导控）——**全仓唯一一份**。
 *
 * ⚠ 为什么抽出来（**2026-09-27 玩家报障修复**）：此前"这艘船装了武器吗"**两处各写一份**判据 ——
 * `weekendLaunch.weekendPrepIssuesOf`（旗舰战准备页的「未装武器」警告条）列了这 5 个槽，
 * 而 `expedition` 的「抵达目标」日志只列了 `turret` / `missile`（注释自陈"V18B-1"）——
 * **V18B-2 把能量系归位成 `laser` 之后没同步** ⇒ 装**激光炮**或**无人机**的船打悬赏时，
 * 被那条日志判成「未装配武器：仅基础舰炮还击。」（与装配页所见相反）。⇒ 两处都改用本单点。
 */
export const WEAPON_SLOTS: ReadonlySet<ModuleSlot> = new Set([
  'turret',
  'missile',
  'laser',
  'drone-rack',
  'drone-tac',
])

/** **这艘船装了武器吗**（判据 = 高/中/低任一槽位上是武器类模块）——全仓唯一一份，见 `WEAPON_SLOTS` */
export function shipHasWeapon(state: GameState, ctx: SimContext, shipId: string): boolean {
  const fitted = state.fleet[shipId]?.fitted
  if (!fitted) return false
  return allFittedModules(fitted, ctx).some((d) => WEAPON_SLOTS.has(d.slot))
}

/** 当前驾驶船的 fitted（空船时返回 null） */
export function fittedOf(state: GameState): GameState['fleet'][string]['fitted'] | null {
  return currentShipState(state)?.fitted ?? null
}

/** 找某槽类第一个空位（无空位返回 -1） */
export function firstFreeBay(fitted: FittedModules, rack: RackSlot): number {
  return rackBays(fitted, rack).findIndex((id) => id === null)
}

/**
 * V18 韧性：把某槽类位数组补齐到**船型布局**期望长度（`want`；不足补空位、超长不动——
 * 超长由载入修复链 `repairDeprecatedModules` 裁）。返回的数组 = `fitted[rack]` 引用本身。
 *
 * 为什么每个"按位号"的命令都要先补齐（2026-09-12 玩家实测「该低槽位不可用（第 2 位）」）：
 * 新造/新买的船走 `emptyShipState → emptyFitted()` = **1/1/1**，而修复链只在**读到存档**时跑；
 * 装配页却按**船型布局**渲染槽位格（`Math.max(布局, 数组长度)`）⇒ 界面画出第 2/3/4 格、
 * 引擎按数组长度判成越界。补齐与 `repairDeprecatedModules` 的"位对齐"同口径，幂等。
 */
export function ensureRackBays(fitted: FittedModules, rack: RackSlot, want: number): Array<string | null> {
  const bays = rackBays(fitted, rack)
  while (bays.length < want) bays.push(null)
  return bays
}

/**
 * 某船某槽类的**期望位数**（船型缺失 = 0，不做补齐）。
 * ⚠ **2026-09-27 起含插件扩槽**（中层舱段 +1 中槽 / 下层舱段 +1 低槽）——改用槽位单点
 * `plugs.shipSlotsWithPlugsOf`，否则装了扩槽插件也补不出新格子（同一批报障）。
 */
export function wantedBaysOf(state: GameState, ctx: SimContext, shipId: string, rack: RackSlot): number {
  if (!fleetDefOf(state, ctx, shipId)) return 0
  return shipSlotsWithPlugsOf(state, ctx, shipId)[rack]
}

/**
 * 玩家指令：把装备库里的装备装到某船对应槽类（rack）的某空位。
 * shipId 缺省 = 当前驾驶船（2026-09-05 船长：装配页支持直接装配非驾驶中的舰船）。
 * index 缺省 = 第一个空位；该槽类无空位/CPU 超限 → 拒绝并提示。
 * V18.1：无同类唯一约束——任何件可复数安装，防超模靠收敛机制（stackingOf）与 CPU。
 */
/**
 * **同舰唯一的冲突检测（单点）**——**2026-09-25 船长令**「损管只能装备一件」的判据：
 * 同舰**至多一件**带 `unique` 标记的件（本线 = 损伤管制装置 MK1~MK3 互斥；判据按标记、不看型号）。
 *
 * ⚠ **2026-09-26 玩家报障「可以装多个损管」⇒ 抽成单点**：此前只有 `fitModule`（装配页「装上」）
 * 查这一条，而**换装路径 `swapModuleAt`（装配页「换装」/ 顶替同槽）直接写 `bays[index]`**，
 * 绕过了检查 ⇒ 玩家能把第二件损管塞进另一个低槽。现在两条写路径**共用本函数**，
 * 装配方案套用（`applyFitPreset` 逐件走 `fitModule`）本来就在链上。
 *
 * @param ignore 正在被替换掉的那一位（同槽换装：把损管换成另一款损管是合法的，不该被判冲突）
 */
export function uniqueConflictOf(
  fitted: FittedModules,
  ctx: SimContext,
  moduleId: string,
  ignore?: { rack: RackSlot; index: number },
): ModuleDef | undefined {
  if (ctx.modules.get(moduleId)?.unique !== true) return undefined
  for (const rack of ['high', 'mid', 'low'] as const) {
    const bays = rackBays(fitted, rack)
    for (let i = 0; i < bays.length; i += 1) {
      if (ignore && ignore.rack === rack && ignore.index === i) continue
      const id = bays[i]
      if (!id) continue
      const def = ctx.modules.get(id)
      if (def?.unique === true) return def
    }
  }
  return undefined
}
