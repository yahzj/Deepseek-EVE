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
import { RECOVERED_HULL_ARMOR_PCT, RECOVERED_HULL_DURABILITY_PCT } from './shipWrecks'

/** v17：加入一艘"全新"的同型副船（分配新实例 uid 并落账），返回实例 uid */
export function addShipToFleet(state: GameState, defId: string): string {
  const uid = allocateShipUid(state, defId)
  state.fleet[uid] = emptyShipState(defId)
  return uid
}

/**
 * 给一个船型分配新实例的 uid——同型无船时 = 船型 id（不带号）；
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
 * 三条口径（船长 2026-09-26 同日裁定）：
 * - **回母港舰队**、**不自动成为驾驶船**（玩家自己去舰船页切）；
 * - **按残骸时刻的值打折**：结构（耐久）×`RECOVERED_HULL_DURABILITY_PCT`（0.3）、
 *   装甲 ×`RECOVERED_HULL_ARMOR_PCT`（0.5）；两个比例都以"损毁那一刻的残余"为基数
 *   （残骸快照存的正是那一刻的值），缺省按满值起算；
 * - **同一艘船**：装配与无人机舱随快照回队；**货舱货物不回**（「除此以外没有其他资源」）。
 *
 * 实例 uid 走 `allocateShipUid`（**新分配、不复用原 uid**）：原 uid 在残骸账里还占着键（同一时刻
 * 可能有多具残骸），复用会串账。
 */
export function restoreShipFromWreck(
  state: GameState,
  args: {
    defId: string
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
  ship.durability = Math.max(0, Math.min(1, baseDur * RECOVERED_HULL_DURABILITY_PCT))
  ship.armorPct = Math.max(0, Math.min(1, baseArmor * RECOVERED_HULL_ARMOR_PCT))
  if (args.fitted !== undefined) ship.fitted = args.fitted
  if (args.droneLoad !== undefined && Object.keys(args.droneLoad).length > 0) ship.droneLoad = args.droneLoad
  const plugs = (args.plugs ?? []).filter((id) => typeof id === 'string' && id.length > 0)
  if (plugs.length > 0) ship.plugs = [...plugs]
  return uid
}
