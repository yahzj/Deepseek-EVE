/**
 * **无人机储备甲板 · 战中复位**（**2026-09-27 船长令**）。
 *
 * 船长原话（照抄）：「添加无人机高槽装备，无人机储备甲板，效果是有无人机被摧毁时开始运转周期，
 * 满了之后立刻补充（复活）被摧毁一架无人机（从仓库补充）。复活的无人机可以重新加入战斗。」
 *
 * 船长对同批七问的裁决（落法逐条对应）：
 * ① 槽位 = **高槽族 `drone-deck`**（新开一族，与 `drone-tac` / `drone-relay` 同槽竞争）；
 * ② 三档、周期 **14 / 12 / 9 秒**（数值在数据侧 `droneReviveCycleMs`）；
 * ③ **单件内串行**：同一天被打掉多架时，一件一格一格补，不并行；
 * ④ 货源 = **本舰货舱 → 物品仓库**，且**同型才补**；
 * ⑤ **不改战损账**：`droneLost` 照记不回冲（战后回收率要用它）——
 *    战后净损失算式减掉**本模块记的已复活架数** `v`；
 * ⑥ 生效范围 = 所有战斗（在线逐拍与离线大步长都走同一处 `resolveDroneRevive`：
 *    到点判定读的是战斗时钟，离线一次跨多秒也照样把该补的架数补齐）；
 * ⑦ **多件按需启动**：同时在跑的周期数 = `min(装了几件, 待补架数)`，优先用**周期最短**的那件。
 *
 * ⚠ **2026-09-27 船长追加令**（本文件的核心设计）：
 * > 「战斗中损失的无人机是在战斗结束后一次性扣除吧？那么**复活无人机数量的上限在战斗开始时
 * > 设置一个库存的快照**可以吗」
 *
 * ⇒ 落地为**复活预算快照** `b`：
 * - **开战那一刻**按"该舰机群里真有的机型"各拍一份 `本舰货舱 ＋ 物品仓库` 的备用机数当预算；
 * - **战中只扣预算，绝不写玩家库存**（战斗保持纯模拟 ⇒ 存档面干净、重载不会串账）；
 * - **真正扣货在战后结算处一次性做**，顺序 = 先扣复活的 `v` 架 → 再扣净损失 → 最后按出发快照补货。
 *
 * 一句话：**上限在开战定死，扣货在战后一次做完** —— 战斗内不再出现玩家库存的写操作。
 *
 * ⚠ 与敌方"备用机库补位"（`combat.resolveFoeRevive`）**同一套池字段**：`alive` / `inHangar` /
 * `readyAtMs` / `maxS·maxA·maxH`。差别只在触发与货源：敌方由支援舰"召唤"，我方由**机组被击落**触发、
 * 货源是**玩家的备用库存快照**。
 */
import type { BattleState, GameState } from './state'
import type { SimContext } from './types'
import { fleetDefOf } from './instances'
import { moduleAllowedOnShip } from './shipFitting'

/** 该舰装了几件储备甲板、各件周期毫秒（**升序** ⇒ 下标 0 = 最快的那件） */
export function droneReviveCyclesOf(state: GameState, ctx: SimContext, shipId: string): number[] {
  const high = state.fleet[shipId]?.fitted?.high ?? []
  const out: number[] = []
  for (const modId of high) {
    if (!modId) continue
    const mod = ctx.modules.get(modId)
    if (!mod || !moduleAllowedOnShip(fleetDefOf(state, ctx, shipId), mod)) continue
    const ms = mod.droneReviveCycleMs
    if (typeof ms === 'number' && ms > 0) out.push(ms)
  }
  return out.sort((a, b) => a - b)
}

/**
 * **开战快照 ＝ 复活预算（全队共享一本）**：装了储备甲板的各舰的**本舰货舱 ＋ 全队物品仓库**，
 * 按"该舰机群里真有的机型"统计备用机数。
 *
 * ⚠ **不含**机舱清单 `droneLoad` 里已在编制的那几架 —— 那些正在打，不是"补充货源"。
 * ⚠ **全队一本**（不按舰各拍一份）：否则 4 条船各拍同一只仓库 ⇒ 能从 20 架备用里补出 80 架。
 * **没装这件装备 ⇒ 一个字段都不写**（零行为变化）。
 */
export function initDroneReviveStock(
  state: GameState,
  ctx: SimContext,
  battle: BattleState,
  shipIds: readonly string[],
): void {
  const withDeck = shipIds.filter((id) => droneReviveCyclesOf(state, ctx, id).length > 0)
  if (withDeck.length === 0) return
  const kinds = new Set<string>()
  for (const p of Object.values(battle.dronePools ?? {})) {
    if (p.artId) kinds.add(p.artId)
  }
  const stock: Record<string, number> = {}
  for (const id of kinds) {
    let n = state.warehouse.items[id] ?? 0
    for (const shipId of withDeck) n += state.fleet[shipId]?.cargo[id] ?? 0
    if (n > 0) stock[id] = n
  }
  battle.droneReviveStock = stock
}

/**
 * **建档**：给这一舰开一本复位账（**没装这件装备 ⇒ 一个字段都不写**）。
 * 在战斗建档处逐舰调用（单舰路径与多舰路径各一处）；
 * ⚠ 预算快照走 `initDroneReviveStock`（全队一本），本函数只建"队列 / 周期 / 计数"。
 */
export function initDroneRevive(
  state: GameState,
  ctx: SimContext,
  battle: BattleState,
  shipId: string,
  tag: string,
): void {
  const c = droneReviveCyclesOf(state, ctx, shipId)
  if (c.length === 0) return
  const book = { ...(battle.droneRevive ?? {}) }
  book[tag] = { q: [], t: c.map(() => undefined), c, v: {}, shipId }
  battle.droneRevive = book
}

/** 该型**还剩几架预算**（只读；战中唯一的"有没有货"判据） */
function budgetOf(battle: BattleState, artId: string | undefined): number {
  if (artId === undefined || artId === '') return 0
  return battle.droneReviveStock?.[artId] ?? 0
}

/**
 * 从队头取一架**还有预算的**补回来（满血归队）。返回是否真补到了。
 * - 队头那型没预算 ⇒ **跳过它、取下一个有预算的型别**（船长口径）；
 * - 整个队列都没预算 ⇒ 返回 false（调用方据此把该件的周期停掉，**不空转**）。
 *
 * ⚠ **只扣预算、不碰库存**（船长 2026-09-27 令）：真正的扣货在战后结算处一次性做。
 */
function reviveOne(state: GameState, battle: BattleState, e: NonNullable<BattleState['droneRevive']>[string]): boolean {
  void state
  const pools = battle.dronePools
  if (!pools) return false
  let pick = -1
  for (let i = 0; i < e.q.length; i++) {
    const p = pools[e.q[i]!]
    // 池条目不见了（异常/老档）⇒ 这条直接作废，不必再等
    if (!p) {
      e.q.splice(i, 1)
      i -= 1
      continue
    }
    if (budgetOf(battle, p.artId) > 0) {
      pick = i
      break
    }
  }
  if (pick < 0) return false
  const key = e.q[pick]!
  const pool = pools[key]
  e.q.splice(pick, 1)
  if (!pool || pool.artId === undefined) return false
  // 扣预算（唯一消耗点；扣不到 ⇒ 这一架不补）——**不碰玩家库存**
  const stock = { ...(battle.droneReviveStock ?? {}) }
  const left = budgetOf(battle, pool.artId) - 1
  if (left > 0) stock[pool.artId] = left
  else delete stock[pool.artId]
  battle.droneReviveStock = stock
  /**
   * **满血归队**（船长口径）：三层血按建池时记的满值重置，并清掉待命标记 ⇒
   * 本拍就重新进开火循环/选靶池（与敌方备用机库补位同一套写法）。
   */
  pool.alive = true
  pool.inHangar = false
  pool.readyAtMs = undefined
  pool.s = pool.maxS ?? pool.s
  pool.a = pool.maxA ?? pool.a
  pool.h = pool.maxH ?? pool.h
  e.v[pool.artId] = (e.v[pool.artId] ?? 0) + 1
  return true
}

/** 队列里**还有预算可补**的架数（"按需启动"的启动上限就是它） */
function revivableCount(battle: BattleState, e: NonNullable<BattleState['droneRevive']>[string]): number {
  const pools = battle.dronePools
  if (!pools) return 0
  let n = 0
  for (const key of e.q) {
    const p = pools[key]
    if (p && budgetOf(battle, p.artId) > 0) n += 1
  }
  return n
}

/**
 * **按需启动**（船长第 7 条）：只要"还有预算可补的架数 > 正在跑的周期数"，
 * 就从空闲的件里取**周期最短**的那件起一条（`c` 已升序、`t` 与它同序 ⇒ 取最小空闲下标）。
 */
function startCycles(battle: BattleState, e: NonNullable<BattleState['droneRevive']>[string], nowMs: number): void {
  let running = e.t.filter((x) => x !== undefined).length
  let need = revivableCount(battle, e)
  for (let k = 0; k < e.t.length && running < need; k++) {
    if (e.t[k] !== undefined) continue
    e.t[k] = nowMs + e.c[k]!
    running += 1
    need = revivableCount(battle, e) // 补一架的预算口径会变（同型可能被扣光）⇒ 每起一条重算
  }
}

/**
 * **某架无人机被击落** ⇒ 入队（并按需起周期）。
 * 调用点 = `combat` 记 `droneLost` 那一处（与战损账**同一个事件点**）。
 */
export function droneReviveNoteLoss(state: GameState, battle: BattleState, poolKey: string, nowMs: number): void {
  void state
  const book = battle.droneRevive
  if (!book) return
  const tag = poolKey.slice(0, poolKey.indexOf(':'))
  const e = book[tag]
  if (!e) return
  e.q.push(poolKey)
  startCycles(battle, e, nowMs)
}

/**
 * **每拍推进**：到点的周期补一架，然后按需起下一条。
 *
 * ⚠ **一个周期只补一架**（单件内串行）；同一件若因离线大步长一次跨过好几个周期，
 * 这里按 `at + 周期` 逐格推进 ⇒ "离线折算"不必另写一条公式。
 * ⚠ **本舰被击毁 / 战斗结束 ⇒ 调用方停调本函数**（周期就此停住，**不做半格折算**）。
 */
export function resolveDroneRevive(state: GameState, ctx: SimContext, battle: BattleState, nowMs: number): void {
  void ctx
  const book = battle.droneRevive
  if (!book) return
  for (const e of Object.values(book)) {
    for (let k = 0; k < e.t.length; k++) {
      let at = e.t[k]
      if (at === undefined) continue
      let guard = 0
      while (nowMs >= at && guard < 512) {
        guard += 1
        if (!reviveOne(state, battle, e)) break
        at = at + e.c[k]!
      }
      /**
       * ⚠ **队列空 / 没预算 ⇒ 停机**（不空转）：否则这件会带着一个"下一次到点"继续挂着，
       * 到点再发现无事可做。之后再有无人机被击落 ⇒ `droneReviveNoteLoss` 会重新起周期。
       */
      e.t[k] = revivableCount(battle, e) > 0 ? at : undefined
    }
    startCycles(battle, e, nowMs)
  }
}

/** 本场**开局**拍下的库存快照（复活总预算；全队共享一本） */
export function droneReviveStockSnapshotOf(battle: BattleState | null | undefined): Record<string, number> {
  return battle?.droneReviveStock ?? {}
}

/** 该舰**本场已复活的架数**（机型 id → 架数；战后结算要按它一次性扣库存） */
export function droneRevivedOf(battle: BattleState | null | undefined, tag: string): Record<string, number> {
  return battle?.droneRevive?.[tag]?.v ?? {}
}

/** 本场已复活的总架数（战报文案用） */
export function droneRevivedCount(battle: BattleState | null | undefined, tag: string): number {
  return Object.values(droneRevivedOf(battle, tag)).reduce((s, n) => s + n, 0)
}
