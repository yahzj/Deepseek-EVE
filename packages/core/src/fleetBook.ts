/**
 * **舰队实例账本**（**2026-10-02 破环搬家**：这四件原住 `shipyard.ts`）。
 *
 * 为什么拆出来：`salvaging.ts`（捞回自己船的残骸）要调 `restoreShipFromWreck`，而 `shipyard.ts`
 * 又要调 `salvaging` 的 `retireSalvageShip` ⇒ `salvaging ↔ shipyard` 互相依赖。这四件是**纯舰队
 * 账本操作**（分配 uid / 空船态 / 入队 / 按残骸快照复原），只依赖 `labels` 的 `emptyFitted` 与
 * `shipWrecks` 的两个回收比例常量 ⇒ 拆到本件后，salvaging / shipyard / market / firstRewards /
 * winEstimate 都从这里读，环断（行为逐字不变）。`shipyard.ts` 原样再导出，既有引用不动。
 */
import type { FittedModules, FleetShipState, GameState } from './state'
import { emptyFitted } from './labels'
import { RECOVERED_HULL_ARMOR_PCT, RECOVERED_HULL_DURABILITY_PCT, RECOVERED_SHIP_CONDITION } from './shipWrecks'
import { cleanShipDamage, type ShipDamageKind } from './shipDamage'

/** v17：加入一艘"全新"的同型副船（分配新实例 uid 并落账），返回实例 uid */
export function addShipToFleet(state: GameState, defId: string): string {
  const uid = allocateShipUid(state, defId)
  state.fleet[uid] = emptyShipState(defId)
  return uid
}

/**
 * 给一个船型分配新实例的 uid——同型无船时 = 船型 id（不带号）；
 * 已有（含挂卖、正常星系残骸及其记录）取最大#N+1，避免新舰覆盖尚未回收的同型旧残骸。
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
  for (const wreck of Object.values(state.shipWrecks ?? {})) consider(wreck.shipId)
  for (const entry of state.wreckLog ?? []) if (entry.wreckGalaxyId) consider(entry.shipId)
  return max === 0 ? defId : `${defId}#${max + 1}`
}

function emptyShipState(defId: string): FleetShipState {
  const fitted: FittedModules = emptyFitted()
  return { defId, customName: null, durability: 1, armorPct: 1, cargo: {}, fitted }
}

/**
 * **整船回收**（**2026-09-26 船长令**：「**留一个接口，给之后舰船插件的。之后会添加一个加固结构的
 * 舰船插件，有加固结构的插件，玩家有概率能够回收该舰船。**」）——把残骸里捞回的船拖回母港入队。
 *
 * 回母港舰队、不切主控、货舱物资不恢复。新规则状态用RECOVERED_SHIP_CONDITION，
 * 保存已有正常插件与战损；保全装备的预算校验由打捞消费方处理。旧规则保留残余比例算法。
 *
 * 实例 uid 走 `allocateShipUid`（**新分配、不复用原 uid**）：原 uid 在残骸账里还占着键（同一时刻
 * 可能有多具残骸），复用会串账。
 */
export function restoreShipFromWreck(
  state: GameState,
  args: {
    defId: string
    customName?: string | null
    recoveryRules?: 2
    damagePlugs?: readonly ShipDamageKind[]
    durability?: number
    armorPct?: number
    fitted?: FittedModules
    droneLoad?: Record<string, number>
    /**
     * **残骸里那批插件**（**2026-09-26 船长令**）——整船捞回来时**跟着船回去**：
     * 插件不可拆、也不可能"留在地上"，船回来了插件就在船上（只有没捞回整船时才换黑匣）。
     */
    plugs?: readonly string[]
  },
): string {
  const uid = addShipToFleet(state, args.defId)
  const ship = state.fleet[uid]
  if (!ship) return uid
  const baseDur = Number.isFinite(args.durability) ? Math.max(0, args.durability as number) : 1
  const baseArmor = Number.isFinite(args.armorPct) ? Math.max(0, args.armorPct as number) : 1
  ship.durability = args.recoveryRules === 2 ? RECOVERED_SHIP_CONDITION : Math.max(0, Math.min(1, baseDur * RECOVERED_HULL_DURABILITY_PCT))
  ship.armorPct = args.recoveryRules === 2 ? RECOVERED_SHIP_CONDITION : Math.max(0, Math.min(1, baseArmor * RECOVERED_HULL_ARMOR_PCT))
  if (args.customName !== undefined) ship.customName = args.customName
  if (args.fitted !== undefined) ship.fitted = structuredClone(args.fitted)
  if (args.droneLoad !== undefined && Object.keys(args.droneLoad).length > 0) ship.droneLoad = { ...args.droneLoad }
  const damagePlugs = cleanShipDamage(args.damagePlugs)
  if (damagePlugs) ship.damagePlugs = damagePlugs
  const plugs = (args.plugs ?? []).filter((id) => typeof id === 'string' && id.length > 0)
  if (plugs.length > 0) ship.plugs = [...plugs]
  return uid
}

/** 该船是否已锁定（锁定后不可出售，其它操作不受影响）（2026-10-02 从 shipyard.ts 原样搬来，破 market→shipyard 环） */
export function isShipLocked(state: GameState, shipId: string): boolean {
  return state.shipLocks[shipId] === true
}

/** 仓库里该船型的艘数（读口径单点；负数/非法值一律当 0）（2026-10-02 从 shipyard.ts 原样搬来，破 market→shipyard 环） */
export function shipStoredCount(state: GameState, defId: string): number {
  const n = state.shipStore?.[defId] ?? 0
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}
