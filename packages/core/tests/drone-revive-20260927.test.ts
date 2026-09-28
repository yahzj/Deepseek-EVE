/**
 * **无人机储备甲板 · 战中复位**（**2026-09-27 船长令**）。
 *
 * 船长原话（照抄）：「添加无人机高槽装备，无人机储备甲板，效果是有无人机被摧毁时开始运转周期，
 * 满了之后立刻补充（复活）被摧毁一架无人机（从仓库补充）。复活的无人机可以重新加入战斗。」
 *
 * 同批七答：① 高槽新族 `drone-deck`；② 三档（周期见下）；③ 单件内**串行**；④ 货源 = **本舰货舱 →
 * 物品仓库**、同型才补；⑤ `droneLost` **照记不回冲**、净损失减掉已复活数；⑥ 所有战斗（含离线）；
 * ⑦ 多件**按需启动**（周期数 = min(件数, 待补架数)，优先最快的那件）。
 * 后续改判（同日）：CPU → **35/45/55**、周期 → **14/12/9 秒**；真路径用**最强防空编队** `ink-flagship`。
 *
 * ⚠ **再加一条船长令（本文件第 ⑩ 条钉的就是它）**：
 * > 「战斗中损失的无人机是在战斗结束后一次性扣除吧？那么**复活无人机数量的上限在战斗开始时
 * > 设置一个库存的快照**可以吗」
 * ⇒ 落地 = **开战拍一份"备用库存"快照当复活总预算（全队一本）**；战中**只扣预算、绝不写玩家库存**；
 * 扣货全部收在**战后结算**一处（顺序：先扣复活的架数 → 再扣净损失 → 最后按出发快照补货）。
 *
 * ⚠ **周期数值只在本文件第 ① 条里钉字面值**；其余各条一律从数据现算（`cycleOf`）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addShipToFleet, addWare, advanceGame, createInitialState } from '../src/index'
import { dronePoolKey, droneRecoveryRate, settleDroneLosses, startBattleFor } from '../src/combat'
import {
  droneReviveCyclesOf,
  droneReviveNoteLoss,
  droneRevivedCount,
  resolveDroneRevive,
} from '../src/droneRevive'
import { rackOf } from '../src/labels'
import type { BattleState, GameState } from '../src/state'
import type { SimContext } from '../src/types'

const ctx = buildSimContext()
/** 王鲭级无人机母舰：4 高槽 / 机巢 320 m³（与 `drone-loss.test.ts` 同款） */
const SHIP = 'sh-sentinel'
/** 低威胁无点防地点：本文件里"被击落"由我们用 `killOne` 手工制造，不受点防干扰 */
const ANO = 'ano-pirate-post'
/**
 * **全表防空最强的地点**（2026-09-27 船长令「测试找个高防空伤害的编队测试」）：
 * `ink-flagship`（墨潮旗舰部队 · H 族 · threat 170）——近防炮 **30 伤害/发 × 9 艘 = 合计 150**，
 * 是原用地点 `ano-vault-sentinel`（10/发 × 2 艘 = 20）的 **7.5 倍**。
 */
const ANO_PD = 'ink-flagship'
const DRONE = 'drone-heavy'

/** **该档的复位周期**（从数据现算；字面值只在第 ① 条钉住） */
function cycleOf(id: string): number {
  const ms = ctx.modules.get(id)?.droneReviveCycleMs
  if (typeof ms !== 'number' || ms <= 0) throw new Error(`${id} 没有 droneReviveCycleMs`)
  return ms
}
const MK1 = 'mod-drone-deck-1'
const MK3 = 'mod-drone-deck-3'
const C1 = cycleOf(MK1)
const C3 = cycleOf(MK3)

/**
 * 满战斗技能（与 `drone-loss.test.ts` / `tools/drone-vs-gun.ts` 同口径）。
 * ⚠ **真路径必须点它**：无技能档 CPU 预算不够、机舱清单会被**裁剪** ⇒ 实测第一版 0 架放飞、0 架被击落。
 */
const FULL_SKILLS = Object.fromEntries(
  [
    'gunnery', 'kinetic-gunnery', 'missile-launching', 'laser-cannon', 'fire-control', 'reload-drills',
    'drone-warfare', 'drone-servicing', 'ammunition-condensing', 'shield-operation', 'energy-management',
    'hull-upgrades', 'shield-tuning', 'armor-tuning', 'armed-ops', 'armored-ops', 'vector-maneuvering',
    'evasion-maneuvering', 'targeting-integration', 'ship-systems-engineering',
  ].map((k) => [k, 5]),
)

function makeState(opts: { high: string[]; load?: Record<string, number>; ware?: Record<string, number> }): GameState {
  const state = createInitialState({ nowWallMs: 0, seed: 1 })
  const uid = addShipToFleet(state, SHIP)
  state.shipId = uid
  const entry = state.fleet[uid]!
  entry.fitted = { high: opts.high, mid: [], low: [] }
  entry.droneLoad = { ...(opts.load ?? { [DRONE]: 4 }) }
  for (const [id, n] of Object.entries(opts.ware ?? {})) addWare(state, id, n)
  return state
}

function startBattle(state: GameState, c: SimContext = ctx, ano: string = ANO): BattleState {
  const b = startBattleFor(state, c, state.shipId, ano, 0)
  if (!b) throw new Error('开战失败')
  return b
}

function poolKeys(b: BattleState): string[] {
  return Object.keys(b.dronePools ?? {})
}

function bookOf(b: BattleState): NonNullable<BattleState['droneRevive']>[string] {
  const book = b.droneRevive ?? {}
  const keys = Object.keys(book)
  if (keys.length === 0) throw new Error('没有复位账')
  return book[keys[0]!]!
}

function tagOf(b: BattleState): string {
  return Object.keys(b.droneRevive ?? {})[0]!
}

/** 该型**剩余复活预算**（开战快照扣下来的那本；战中唯一的"有没有货"判据） */
function budgetOf(b: BattleState, id: string): number {
  return b.droneReviveStock?.[id] ?? 0
}

/**
 * **制造一架被击落**：按生产同一条事件点走（打光三层血 ⇒ `alive=false` ⇒ 记**全队**`droneLost`
 * ＋**逐舰**`droneLostBy` ⇒ 入队）。
 * ⚠ **两份账都要记**：建档时 `droneLostBy` 已被初始化成 `{}`（"老档回落全队合计"那条分支**不会**
 * 触发）⇒ 只记 `droneLost` 会让战后结算**什么也不做**（本用例第一版就踩了这个坑）。
 */
function killOne(state: GameState, b: BattleState, key: string, nowMs: number): void {
  const p = b.dronePools![key]!
  p.s = 0
  p.a = 0
  p.h = 0
  p.alive = false
  const artId = p.artId ?? DRONE
  const ownerTag = p.owner ?? key.slice(0, key.indexOf(':'))
  b.droneLost = { ...(b.droneLost ?? {}) }
  b.droneLost[artId] = (b.droneLost[artId] ?? 0) + 1
  const byOwner = { ...(b.droneLostBy ?? {}) }
  byOwner[ownerTag] = { ...(byOwner[ownerTag] ?? {}) }
  byOwner[ownerTag]![artId] = (byOwner[ownerTag]![artId] ?? 0) + 1
  b.droneLostBy = byOwner
  droneReviveNoteLoss(state, b, key, nowMs)
}

/** 库存总量（本舰货舱 ＋ 物品仓库 ＋ 机舱清单）——"总消耗"靠它算 */
function stockTotal(state: GameState, id: string): number {
  const fleet = state.fleet[state.shipId]!
  return (fleet.cargo[id] ?? 0) + (state.warehouse.items[id] ?? 0) + (fleet.droneLoad?.[id] ?? 0)
}

describe('无人机储备甲板 · 战中复位（2026-09-27 船长令）', () => {
  it('① 数据锚：三档周期 **14/12/9 秒**、CPU **35/45/55**、且都归**高槽**族 drone-deck', () => {
    const want: Array<[string, number, number]> = [
      [MK1, 14_000, 35],
      ['mod-drone-deck-2', 12_000, 45],
      [MK3, 9_000, 55],
    ]
    for (const [id, ms, cpu] of want) {
      const def = ctx.modules.get(id)
      expect(def, id).toBeDefined()
      expect(def!.droneReviveCycleMs, `${id} 复位周期`).toBe(ms)
      expect(def!.cpuUse, `${id} CPU`).toBe(cpu)
      expect(def!.slot, id).toBe('drone-deck')
      expect(rackOf({ slot: 'drone-deck' }), id).toBe('high')
    }
  })

  it('② 开战拍快照；到点**满血归队**并扣**预算**（库存这时一点没动）', () => {
    const state = makeState({ high: [MK3], ware: { [DRONE]: 4 } })
    const b = startBattle(state)
    const key = poolKeys(b)[0]!
    const e = bookOf(b)
    expect(droneReviveCyclesOf(state, ctx, state.shipId)).toEqual([C3])
    expect(budgetOf(b, DRONE), '开战快照 = 仓库 4 架（清单里的 4 架不算备用）').toBe(4)

    killOne(state, b, key, 0)
    expect(e.q.length, '入队').toBe(1)
    expect(e.t[0], `周期已起（${C3 / 1000} 秒后到点）`).toBe(C3)

    resolveDroneRevive(state, ctx, b, C3 - 1)
    expect(b.dronePools![key]!.alive, '未到点不补').toBe(false)

    resolveDroneRevive(state, ctx, b, C3)
    const p = b.dronePools![key]!
    expect(p.alive, '到点归队').toBe(true)
    expect([p.s, p.a, p.h], '满血（三层各按建池满值）').toEqual([p.maxS, p.maxA, p.maxH])
    expect([p.s, p.a, p.h].every((x) => (x ?? 0) > 0), '不是 0 血复活').toBe(true)
    expect(e.q.length, '出队').toBe(0)
    expect(e.v[DRONE], '已复活计数').toBe(1)
    expect(budgetOf(b, DRONE), '扣的是**预算**（4 → 3）').toBe(3)
    expect(state.warehouse.items[DRONE], '⚠ **战中不写库存**：仓库仍是 4').toBe(4)
    expect(droneRevivedCount(b, tagOf(b)), '本场复活总数').toBe(1)
  })

  it('③ **按需启动**：装两件、只损失 1 架 ⇒ 只跑一条周期（另一件不空转），且用最快的那件', () => {
    const state = makeState({ high: [MK1, MK3], ware: { [DRONE]: 4 } })
    const b = startBattle(state)
    const e = bookOf(b)
    expect(e.c).toEqual([C3, C1])

    killOne(state, b, poolKeys(b)[0]!, 0)
    expect(e.t.filter((x) => x !== undefined).length, '只跑一条周期（按需启动）').toBe(1)
    expect(e.t[0], '跑的是最快的那件').toBe(C3)
    expect(e.t[1], '慢的那件不空跑').toBeUndefined()

    resolveDroneRevive(state, ctx, b, C3)
    expect(e.q.length).toBe(0)
    expect(e.t.filter((x) => x !== undefined).length, '补完即停').toBe(0)
    expect(budgetOf(b, DRONE), '只扣 1 架预算').toBe(3)
  })

  it('④ 单件**串行**：两架被毁 ⇒ 一格补一架、第二格才补第二架（不是同时补）', () => {
    const state = makeState({ high: [MK3], ware: { [DRONE]: 4 } })
    const b = startBattle(state)
    const e = bookOf(b)
    const keys = poolKeys(b)
    killOne(state, b, keys[0]!, 0)
    killOne(state, b, keys[1]!, 0)
    expect(e.q.length).toBe(2)

    resolveDroneRevive(state, ctx, b, C3)
    expect(e.q.length, '第一格').toBe(1)
    expect(e.t[0], '第二格已续上').toBe(C3 * 2)

    resolveDroneRevive(state, ctx, b, C3 * 2 - 1)
    expect(e.q.length).toBe(1)
    resolveDroneRevive(state, ctx, b, C3 * 2)
    expect(e.q.length, '第二格补完').toBe(0)
    expect(budgetOf(b, DRONE)).toBe(2)
  })

  it('⑤ **无货不启动**：开战快照为空 ⇒ 周期一条都不跑（不空转）', () => {
    const state = makeState({ high: [MK3] }) // 不给库存 ⇒ 快照为空
    const b = startBattle(state)
    const e = bookOf(b)
    expect(b.droneReviveStock, '没备用 ⇒ 快照是空的').toEqual({})
    killOne(state, b, poolKeys(b)[0]!, 0)
    expect(e.q.length, '仍然入队（战损照记）').toBe(1)
    expect(e.t.filter((x) => x !== undefined).length, '没预算 ⇒ 不启动').toBe(0)

    resolveDroneRevive(state, ctx, b, C3 * 10)
    expect(e.q.length, '一直没预算 ⇒ 队列留着').toBe(1)
    expect(b.dronePools![poolKeys(b)[0]!]!.alive, '没补回来').toBe(false)
  })

  it('⑥ 快照口径 = **本舰货舱 ＋ 全队物品仓库**（不含机舱清单）', () => {
    const state = makeState({ high: [MK3], ware: { [DRONE]: 2 } })
    state.fleet[state.shipId]!.cargo = { [DRONE]: 3 } // 货舱 3 + 仓库 2 + 清单 4
    const b = startBattle(state)
    expect(budgetOf(b, DRONE), '快照 = 货舱 3 + 仓库 2（清单那 4 架不算）').toBe(5)
    // 战中补两架：只扣预算
    const e = bookOf(b)
    const keys = poolKeys(b)
    killOne(state, b, keys[0]!, 0)
    killOne(state, b, keys[1]!, 0)
    resolveDroneRevive(state, ctx, b, C3)
    resolveDroneRevive(state, ctx, b, C3 * 2)
    expect(e.v[DRONE]).toBe(2)
    expect(budgetOf(b, DRONE)).toBe(3)
    expect(state.fleet[state.shipId]!.cargo[DRONE], '战中货舱不动').toBe(3)
    expect(state.warehouse.items[DRONE], '战中仓库不动').toBe(2)
  })

  it('⑦ **离线大步长折算**：一次跨过 3 个周期 ⇒ 该补的 3 架一次补齐', () => {
    const state = makeState({ high: [MK3], ware: { [DRONE]: 4 } })
    const b = startBattle(state)
    const e = bookOf(b)
    for (const k of poolKeys(b)) killOne(state, b, k, 0)
    expect(e.q.length).toBe(4)

    resolveDroneRevive(state, ctx, b, C3 * 3)
    expect(e.v[DRONE], '按周期折算补回 3 架').toBe(3)
    expect(e.q.length).toBe(1)
    expect(budgetOf(b, DRONE), '预算同样按补回架数扣').toBe(1)
  })

  it('⑧ **战后结算一次扣货**：总消耗 = 损坏 − 回收（复活不额外多扣一次货）', () => {
    const state = makeState({ high: [MK3], ware: { [DRONE]: 4 } })
    const b = startBattle(state)
    const tag = tagOf(b)
    const keys = poolKeys(b)
    const before = stockTotal(state, DRONE)

    killOne(state, b, keys[0]!, 0)
    killOne(state, b, keys[1]!, 0)
    killOne(state, b, keys[2]!, 0)
    resolveDroneRevive(state, ctx, b, C3)
    const revived = droneRevivedCount(b, tag)
    expect(revived, '本场确实复活过 1 架').toBe(1)
    expect(stockTotal(state, DRONE), '⚠ 战损+复活全过程**库存一分未动**').toBe(before)

    const lost = Object.values(b.droneLost ?? {}).reduce((s, n) => s + n, 0)
    const expectRecovered = Math.round(lost * droneRecoveryRate(state))
    settleDroneLosses(state, ctx, state.shipId, b)

    const after = stockTotal(state, DRONE)
    /**
     * 不变量：**总消耗 = 损坏 − 回收**（扣货全在结算这一处）。
     * **已验牙齿**：撤掉净损失算式里的 `− 复活数` 即判红（同一架会扣两次货）。
     */
    expect(lost, '本场损坏 3 架').toBe(3)
    expect(after - before, '总消耗').toBe(-(lost - expectRecovered))
    expect(b.droneLost, '结算后战损账按既有口径清空（幂等）').toBeUndefined()
  })

  /**
   * ⑨ **真路径端到端**（船长追问「本地实测跑过了吗」后补；
   * 同日船长令「测试找个**高防空伤害**的编队测试」⇒ 用全表最强的 `ink-flagship`）。
   */
  it('⑨ 真路径：最强防空编队真打、储备甲板真补（不手工干预）', () => {
    /** ⚠ 压的是该编队的**主炮**伤害（0.2），**高射伤害一点没动**；威胁值与点防门槛也没动。 */
    const hi = ctx.anomalies.get(ANO_PD)!
    const calmCard: typeof hi = {
      ...hi,
      ships: hi.ships?.map((s) => ({ ...s, ship: { ...s.ship, shotDmg: 0.2 } })),
    }
    const calmCtx: SimContext = { ...ctx, anomalies: new Map([...ctx.anomalies, [ANO_PD, calmCard]]) }

    const state = makeState({
      high: [MK3],
      load: { 'drone-heavy': 4, 'drone-sentry': 6 },
      ware: { 'drone-heavy': 40, 'drone-sentry': 40 },
    })
    for (const [k, v] of Object.entries(FULL_SKILLS)) state.skills.trained[k] = v
    const before = stockTotal(state, 'drone-sentry') + stockTotal(state, 'drone-heavy')
    const b = startBattle(state, calmCtx, ANO_PD)
    expect(b.droneRevive, '装了储备甲板 ⇒ 开战即建档').toBeDefined()
    /** 开战那一刻的总预算（船长令的"上限"就是它）——战中会被扣，所以要**先存一份** */
    const snapTotal = Object.values(b.droneReviveStock ?? {}).reduce((s, n) => s + n, 0)
    expect(snapTotal, '开战快照 = 备用库存合计').toBeGreaterThan(0)
    state.expedition.active = true
    state.expedition.phase = 'battle'
    state.expedition.anomalyId = ANO_PD
    state.expedition.battle = b
    /** **用真实游戏节拍推进**：`advanceGame` 自己走波次、走战斗、走结算。 */
    for (let i = 0; i < 800; i++) advanceGame(state, 5_000, calmCtx)

    /** ⚠ 不能读 `b.droneLost`（结算按既有幂等口径清空了）⇒ 从战损报告读。 */
    const rep = state.droneLossReport
    const killed = rep?.total ?? 0
    const recovered = rep?.recovered ?? 0
    const revived = droneRevivedCount(b, tagOf(b))
    const pdShots = b.pdCd?.length ?? 0
    console.log(
      `[读数] 真路径（真实游戏节拍 · ${ANO_PD}＝H 族 30/发 × ${pdShots} 艘 · 压主炮伤害 0.2）：` +
        `战斗跑到 ${b.lastTickGameMs} ms、远征 phase=${state.expedition.phase}；` +
        `损坏 ${killed} 架 · 回收 ${recovered} 架 · **战中复活 ${revived} 架** · 净损失 ${rep?.gone ?? '-'} 架`,
    )
    expect(rep, '整场结束后应当有战损报告').toBeDefined()
    expect(killed, `最强防空编队（${ANO_PD}）应当真的击落机架`).toBeGreaterThan(0)
    expect(revived, '储备甲板应当真的补回来（不是白板）').toBeGreaterThan(0)
    /**
     * ⚠ **不许拿 `revived` 与 `killed` 比大小**：报告的 `total` **按清单实有数封顶**，
     * 而复活计的是**事件数**（一架可以"被打掉 → 补回 → 再打掉 → 再补回"）⇒ 实测 13 > 10。
     * **真正该钉的上限 = 船长令那份开战快照**：复活次数永远不可能超过它。
     */
    expect(revived, '复活次数 ≤ 开战快照（预算不许凭空超发）').toBeLessThanOrEqual(snapTotal)
    expect(rep!.gone, '报告净损失 = max(0, 损坏 − 回收 − 复活)').toBe(Math.max(0, killed - recovered - revived))
    expect(stockTotal(state, 'drone-sentry') + stockTotal(state, 'drone-heavy'), '结算后库存被扣').toBeLessThan(before)
  })

  it('⑩ **船长令：战中只扣预算、库存一分不动；扣货全在战后结算**', () => {
    const state = makeState({ high: [MK3], load: { [DRONE]: 4 }, ware: { [DRONE]: 6 } })
    const b = startBattle(state)
    const e = bookOf(b)
    const keys = poolKeys(b)
    const ware0 = state.warehouse.items[DRONE] ?? 0
    const load0 = state.fleet[state.shipId]!.droneLoad![DRONE] ?? 0
    expect(ware0).toBe(6)

    // 反复打掉同一架并让它被补回来（长交火下最典型的形态）
    for (let i = 0; i < 3; i++) {
      killOne(state, b, keys[0]!, C3 * i)
      resolveDroneRevive(state, ctx, b, C3 * i + C3)
      expect(state.warehouse.items[DRONE] ?? 0, `第 ${i + 1} 轮：战中仓库不动`).toBe(ware0)
      expect(state.fleet[state.shipId]!.droneLoad![DRONE] ?? 0, `第 ${i + 1} 轮：战中清单不动`).toBe(load0)
    }
    expect(e.v[DRONE], '复活了 3 次').toBe(3)
    expect(budgetOf(b, DRONE), '预算 6 → 3').toBe(3)

    // 战后结算：一次性扣货 —— **先扣复活的 3 架、再扣净损失**（这里净损失被夹到 0）
    settleDroneLosses(state, ctx, state.shipId, b)
    const after = stockTotal(state, DRONE)
    const lost = 3
    const recovered = Math.round(lost * droneRecoveryRate(state))
    const revived = 3
    const netLoss = Math.max(0, lost - recovered - revived)
    /**
     * ⚠ **每一次复活都从库存拿走一架新机**（同一个机位死 3 次、补 3 次 ⇒ 消耗 3 架备用），
     * 所以总消耗 = `复活架数 ＋ 净损失`，而不是"损坏 − 回收"。
     * 两者只有在 `复活 ≤ 损坏 − 回收` 时才恰好相等（第 ⑧ 条就是那种情形）。
     */
    expect(after, '结算后的总存量 = 原存量 − (复活 ＋ 净损失)').toBe(load0 + ware0 - (revived + netLoss))
  })
})
