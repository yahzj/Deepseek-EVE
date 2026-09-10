/**
 * G 族「烬火流亡」专属装备（2026-09-10 船长：第一件由机库模块「流亡蜂群巢」改为**专属无人机物品**
 * 「流亡蜂无人机」）——设计稿见 `docs/design/g-exile-bee-drone-20260910.md`（状态：已确认）。
 *
 * 三件：①**流亡蜂无人机**（物品 · 侦察机 · exclusive）②流亡蜂群导控（模块 +45% / CPU 32）
 * ③流亡中继桅（模块 +65% / CPU 34）。
 * 裁决：①补给 = 一次掉 **×10 架**、仍不可造（打光后再刷可补）；②数值 = 闪避 0.55 / 血 15 /
 * 单发 **6** / 射程 2500 / 命中 0.75 / 体积 5 m³；③单发 6 越出四型区间（侦察机上限 1.4×锚点），
 * 由船长裁决**豁免区间校验**（CPU 提到 5），契约仍守硬边界与锚点阶梯。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext, DRONE_ROLE_ANCHORS, droneRoleIssues, droneRoleLadderIssues } from '@whale/data'
import {
  addShipToFleet,
  addWare,
  countWare,
  createInitialState,
  ownedItemCount,
  rareWreckItemIdOf,
  RARE_WRECK_VOLUME_M3,
  startRecycleRun,
} from '../src/index'
import { createPlayerSpec } from '../src/combat'
import { addModule } from '../src/equipment'
import { advanceRefining } from '../src/industry'
import { FOE_LAIR_GEAR } from '../src/lairs'
import { RARE_BOX_DRONE_UNITS, RARE_BOX_GEAR_CHANCE, rollRareBoxExtra, type RecycleProfile } from '../src/salvage'
import type { GameState } from '../src/state'

const ctx = buildSimContext()
const BEE = 'drone-exile-bee'
const CARRIER = 'sh-swarm' // 梭鱼级：高 4 槽 / 机巢 160 m³ / CPU 320 / 无人机专属加成 +8%
const LAIR_CARD = 'ano-cinder-siege' // G 族窝点候选（烬火围攻战）

function makeState(seed = 31): GameState {
  return createInitialState({ nowWallMs: 0, seed })
}

function profile(pool: readonly string[] = FOE_LAIR_GEAR.G): RecycleProfile {
  return {
    anomalyId: 'ano-cinder-siege',
    galaxyId: 'galaxy-cinder',
    threat: 66,
    baseDensity: 100,
    tier: 'dire', // 专属命中率 0.55，样本足够快
    lowSec: false,
    lairGear: [...pool],
  }
}

/** 反复开箱直到抽中一件专属（返回该次结果；超过 max 次返回 null） */
function drawGear(state: GameState, pool?: readonly string[], max = 400) {
  for (let i = 0; i < max; i += 1) {
    const extra = rollRareBoxExtra(state, ctx, profile(pool))
    if (extra && (extra.modules.length > 0 || extra.drones.length > 0)) return extra
  }
  return null
}

describe('G 族专属装备：流亡蜂无人机 + 蜂群导控 + 中继桅（2026-09-10 船长）', () => {
  it('G 族池 = 1 专属物品 + 2 模块；旧「流亡蜂群巢」已撤下', () => {
    expect(FOE_LAIR_GEAR.G).toEqual([BEE, 'mod-lair-drone-tac-g', 'mod-lair-drone-relay-g'])
    expect(ctx.items.get(BEE)).toBeTruthy()
    expect(ctx.modules.get('mod-lair-drone-tac-g')).toBeTruthy()
    expect(ctx.modules.get('mod-lair-drone-relay-g')).toBeTruthy()
    expect(ctx.modules.has('mod-lair-drone-rack-g')).toBe(false) // 已撤下
  })

  it('流亡蜂无人机数值：侦察机档 + 单发 6 / 闪避 0.55 / 血 15 / CPU 5 / 体积 5', () => {
    const d = ctx.items.get(BEE)!
    expect(d.kind).toBe('drone')
    expect(d.droneClass).toBe('scout')
    expect(d.exclusive).toBe(true)
    expect(d.dmg).toBe(6)
    expect(d.cpuUse).toBe(5)
    expect(d.unitM3).toBe(5)
    expect(d.maxRangeM).toBe(2500)
    expect(d.hitRate).toBe(0.75)
    expect(d.falloff).toBe(1)
    expect(d.defense).toEqual({ shieldHp: 6, armorHp: 3, hullHp: 6, evasion: 0.55 })
    // 与制式锚点对比：火力 = 战斗机档（赤鸢 6），闪避更高、CPU 更省、血更薄
    const scout = ctx.items.get(DRONE_ROLE_ANCHORS.scout)!
    const combat = ctx.items.get(DRONE_ROLE_ANCHORS.combat)!
    expect(d.dmg!).toBe(combat.dmg!)
    expect(d.defense!.evasion!).toBeGreaterThan(scout.defense!.evasion!)
    expect(d.cpuUse!).toBeLessThan(combat.cpuUse!)
  })

  it('契约：专属强化型豁免四型区间（单发 6 越出侦察机档），但仍守硬边界与锚点阶梯', () => {
    const d = ctx.items.get(BEE)!
    const scoutDmg = ctx.items.get(DRONE_ROLE_ANCHORS.scout)!.dmg!
    // 单发 6 = 锚点侦察机 3 的 2.0×，越出侦察机档 1~1.4× —— 豁免后无违规
    expect(d.dmg! / scoutDmg).toBeCloseTo(2, 6)
    expect(droneRoleIssues(d, scoutDmg)).toEqual([])
    // 硬边界仍生效：把单发改成荒谬值即报错
    expect(droneRoleIssues({ ...d, dmg: 0 }, scoutDmg).length).toBeGreaterThan(0)
    expect(droneRoleIssues({ ...d, defense: { ...d.defense!, evasion: 1.5 } }, scoutDmg).length).toBeGreaterThan(0)
    // 阶梯只比锚点：把专属机混进列表也不影响四型阶梯
    const all = [...ctx.items.values()].filter((i) => i.kind === 'drone')
    expect(all.map((i) => i.id)).toContain(BEE)
    expect(droneRoleLadderIssues(all)).toEqual([])
  })

  it('掉落：命中专属即给 10 架进物品仓库，开箱文案写明「×10 架」', () => {
    const state = makeState(7)
    // 池里只留无人机 → 命中专属必给无人机（命中率改 5/8/10% 后，"反复开箱到出专属"的取样
    // 会先抽中同池的两个模块，故这里显式收窄池子，只验"命中之后给什么"）
    const extra = drawGear(state, [BEE])!
    expect(extra.drones).toEqual([{ id: BEE, count: RARE_BOX_DRONE_UNITS }])
    expect(RARE_BOX_DRONE_UNITS).toBe(10)
    expect(extra.note).toContain('流亡蜂无人机')
    expect(extra.note).toContain('×10 架')
  })

  it('持有判定：手上还有就不重复掉（优先给别的件）；打光之后重新进池', () => {
    const state = makeState(11)
    // 视为玩家已持有 10 架（在机舱里）→ 抽 60 次不得再出无人机
    const ship = state.fleet[state.shipId]!
    ship.droneLoad = { [BEE]: 10 }
    expect(ownedItemCount(state, BEE)).toBe(10)
    const pool = [BEE] // 池里只留无人机：未持有优先级会退化为全池（允许重复）
    expect(drawGear(state, pool, 60)).toBeTruthy()
    // 打光后（机舱清零、仓库清零）→ 重新成为"未持有"，池里只剩它时照常出
    ship.droneLoad = {}
    expect(ownedItemCount(state, BEE)).toBe(0)
    const again = drawGear(state, pool)!
    expect(again.drones[0]!.id).toBe(BEE)
  })

  it('未持有的模块优先于已持有的无人机：三件池里先补齐模块', () => {
    const state = makeState(13)
    state.fleet[state.shipId]!.droneLoad = { [BEE]: 10 } // 无人机已持有
    const got = new Set<string>()
    for (let i = 0; i < 600 && got.size < 2; i += 1) {
      const extra = rollRareBoxExtra(state, ctx, profile())
      if (!extra) continue
      for (const m of extra.modules) {
        got.add(m)
        addModule(state, m, 1) // 视为已获得
      }
      // 未持有件补齐前，不应再抽到已持有的无人机
      expect(extra.drones).toHaveLength(0)
    }
    expect(got).toEqual(new Set(['mod-lair-drone-tac-g', 'mod-lair-drone-relay-g']))
  })

  it('进战斗：整队 10 架放飞，单发 = 6×2×导控×船体，射程吃中继', () => {
    const state = makeState(17)
    const uid = addShipToFleet(state, CARRIER)
    state.shipId = uid
    state.fleet[uid]!.fitted = {
      high: ['mod-lair-drone-tac-g', 'mod-lair-drone-relay-g', null, null],
      mid: [null, null, null],
      low: [null, null],
    }
    state.fleet[uid]!.droneLoad = { [BEE]: 10 }
    state.warehouse.items[BEE] = 0
    const spec = createPlayerSpec(state, ctx, uid)!
    const bees = spec.weapons.filter((w) => w.src === 'drone' && w.artId === BEE)
    expect(bees).toHaveLength(10) // 10 架全数放飞（CPU 5×10 = 50 ≤ 320）
    // 单发 = 6 × 2（引擎单发×2）× (1+0.45 导控) × (1+0.08 梭鱼船体加成)
    expect(bees[0]!.shotDmg).toBe(Math.round(6 * 2 * 1.45 * 1.08))
    expect(bees[0]!.maxRangeM).toBe(Math.round(2500 * 1.65)) // 中继桅 +65%
    expect(bees[0]!.hitRate).toBeCloseTo(0.75, 6)
    expect(bees[0]!.falloff).toBeCloseTo(1, 6)
  })

  it('消耗品口径：机舱容量不足时照常裁到装得下（与制式机型同规）', () => {
    const state = makeState(19)
    const uid = addShipToFleet(state, 'sh-mako') // 灰鲭鲨：机巢 30 m³（只装得下 6 架 5 m³ 机型）
    state.shipId = uid
    state.fleet[uid]!.fitted = { high: [null, null, null, null], mid: [null, null, null], low: [null, null] }
    state.fleet[uid]!.droneLoad = { [BEE]: 10 }
    expect(countWare(state, BEE)).toBe(0)
    const spec = createPlayerSpec(state, ctx, uid)!
    expect(spec.weapons.filter((w) => w.artId === BEE)).toHaveLength(6) // 30 m³ / 5 m³
  })

  it('高级箱链路（2026-09-10 解禁）：开箱真把 10 架发进物品仓库、并计入回收明细「无人机 N 架」', () => {
    // 专属命中率当日被压到 5/8/10%（一号定稿）→ 本用例把命中率**临时拉满**，
    // 只验"命中之后的入仓链路"（物品仓库 + 回收明细台账 + 事件日志），不依赖取样运气
    const saved = { ...RARE_BOX_GEAR_CHANCE }
    try {
      for (const k of Object.keys(RARE_BOX_GEAR_CHANCE)) RARE_BOX_GEAR_CHANCE[k as keyof typeof RARE_BOX_GEAR_CHANCE] = 1
      const state = createInitialState({ nowWallMs: 0, seed: 41 })
      const rareId = rareWreckItemIdOf(LAIR_CARD)!
      addWare(state, rareId, RARE_WRECK_VOLUME_M3 * 2)
      addModule(state, 'mod-lair-drone-tac-g', 1) // 另外两件视为已持有 → 池里只留无人机
      addModule(state, 'mod-lair-drone-relay-g', 1)
      const started = startRecycleRun(state, rareId, 'pilot', ctx)
      expect(started.ok).toBe(true)
      state.gameMs += 60_000
      advanceRefining(state, ctx)
      expect(countWare(state, BEE)).toBe(RARE_BOX_DRONE_UNITS) // 一次 10 架进物品仓库
      const run = state.refineRuns[0]!
      expect(run.recAcc?.drone?.[BEE]).toBe(RARE_BOX_DRONE_UNITS) // 回收明细按架数计
      expect(state.logs.some((l) => l.text.includes('高级箱') && l.text.includes('流亡蜂无人机'))).toBe(true)
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        RARE_BOX_GEAR_CHANCE[k as keyof typeof RARE_BOX_GEAR_CHANCE] = v
      }
    }
  })
})
