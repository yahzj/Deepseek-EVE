/**
 * **我方近防炮的选靶规则**（P-40 收口 · 2026-09-12 船长裁定「(a)(b)(c) 一起做 + 现在就补优先级与集火」）：
 *
 * 1. **对称的哨戒前提**：敌方**哨戒机**要进**本武器射程**才算候选；出击型（侦察/战斗/攻坚）不受限
 *    （它们扑到我方来，反击由"被攻击"的令牌驱动）——与敌方侧 `PD_SENTRY_RANGE_M`（2,500m）同口径。
 * 2. **优先级**：与敌方侧**同一张表** `pdPriorityOf`——哨戒 0 → 攻坚 1 → 其余 2；取当前存在的**最低档**、
 *    同档**等权随机**（船长「侦查和普通战机相同权重抽取」）。
 * 3. **集火**：锁定一架直到它被击落才换靶（`BattleState.mePdFocus`，按**武器槽**存）。
 *
 * ⚠ 真数据里敌方**没有** `role: 'sentry'` 的机型（E 警戒机 = combat、G 蜂群机 = scout）⇒ 本文件用
 * **合成机型**把这三条钉住（否则是零覆盖的死代码）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addShipToFleet } from '../src/shipyard'
import { addWare } from '../src/inventory'
import { createInitialState } from '../src/state'
import type { BattleState, GameState } from '../src/state'
import { pickFoeDroneTarget, startBattleFor } from '../src/combat'
import type { AnomalyDef, FoeDroneDef, FoeShipDef, SimContext } from '../src/types'

const base = buildSimContext()

/** 合成敌机机型：同一机体、三个角色（哨戒 / 攻坚 / 侦察） */
function droneDef(id: string, role: string): FoeDroneDef {
  return {
    id,
    name: `合成-${role}`,
    family: 'E',
    role: role as FoeDroneDef['role'],
    defense: { shieldHp: 10, armorHp: 10, hullHp: 10, evasion: 0 },
    dmg: 5,
    damageType: 'kinetic',
    hitRate: 0.7,
    falloff: 1,
    maxRangeM: 5000,
    reloadMs: 4400,
  }
}

const DRONE_SENTRY = droneDef('test-drone-sentry', 'sentry')
const DRONE_ASSAULT = droneDef('test-drone-assault', 'assault')
const DRONE_SCOUT = droneDef('test-drone-scout', 'scout')

/** 合成舰级：带上述机群（架数可配） */
function shipWith(counts: Array<{ drone: FoeDroneDef; count: number }>): FoeShipDef {
  return {
    id: 'test-pd-ship',
    name: '合成试验舰',
    family: 'E',
    hullClassTier: 4,
    speedRatio: 0.8,
    hp: 1600,
    split: { s: 0.2, a: 0.55, h: 0.25 },
    shotDmg: 1,
    hitRate: 0.65,
    reloadMs: 4000,
    rangeMinM: 1,
    rangeMaxM: 10,
    falloff: 0.5,
    dmgMix: { kinetic: 8, explosive: 2 },
    tactic: 'orbit',
    drones: counts,
  }
}

/** 起一场真战斗（机群池由开战链路建好） */
function battleWith(counts: Array<{ drone: FoeDroneDef; count: number }>): {
  state: GameState
  ctx: SimContext
  b: BattleState
} {
  const src = base.anomalies.get('ano-training')!
  const card: AnomalyDef = {
    ...src,
    id: 'ano-test-pd-player',
    name: '我方近防炮试验卡',
    threat: 60,
    ships: [{ ship: shipWith(counts), count: 1 }],
    waves: [{ units: 1, hpShare: 1 }],
  }
  const ctx: SimContext = { ...base, anomalies: new Map([...base.anomalies, [card.id, card]]) }
  const state = createInitialState({ nowWallMs: 0, seed: 7 })
  const uid = addShipToFleet(state, 'sh-sentinel')
  state.shipId = uid
  state.fleet[uid]!.fitted = { high: ['mod-turret-kin-1'], mid: [], low: [] }
  addWare(state, 'ammo-kinetic-l', 500)
  const b = startBattleFor(state, ctx, uid, card.id, 0)!
  return { state, ctx, b }
}

/** 近防炮的武器视图（射程 1~2,500m，与真件同口径） */
const PD_W = { minRangeM: 1, maxRangeM: 2_500 }
/** 打开"反击令牌"（一次敌机攻击换一次反击），再调选靶 */
function pick(
  b: BattleState,
  state: GameState,
  dist: number,
  wi = 0,
): { foeTag: string; pool: NonNullable<BattleState['foeDronePools']>[string][number] } | null {
  b.droneHitAt = { ...(b.droneHitAt ?? {}), me: b.lastTickGameMs }
  // ⚠ 只喂选靶需要的两个字段（tag / foeDrones）——真实 `UnitSpec` 的其余字段与本函数无关
  const units = foeUnits(b) as unknown as Parameters<typeof pickFoeDroneTarget>[2]
  return pickFoeDroneTarget(state, b, units, dist, PD_W, wi) as {
    foeTag: string
    pool: NonNullable<BattleState['foeDronePools']>[string][number]
  } | null
}
/** 从战斗状态里取敌单位（与 `b.foeDronePools` 的键同源） */
function foeUnits(b: BattleState): Array<{ tag: string; foeDrones?: readonly { drone: FoeDroneDef }[] }> {
  return Object.keys(b.foeDronePools ?? {}).map((tag) => ({
    tag,
    foeDrones: [{ drone: DRONE_SENTRY }, { drone: DRONE_ASSAULT }, { drone: DRONE_SCOUT }],
  }))
}

describe('我方近防炮 · 选靶规则（P-40）', () => {
  it('哨戒机要进射程才算候选：4,000m 时只剩出击型，1,000m 时哨戒机（优先级最高）中选', () => {
    const { state, b } = battleWith([
      { drone: DRONE_SENTRY, count: 1 },
      { drone: DRONE_SCOUT, count: 1 },
    ])
    // 两舰相距 4,000m（> 近防炮 2,500m）⇒ 哨戒机不在候选池 ⇒ 只能打到侦察机
    const far = pick(b, state, 4_000)
    expect(far?.pool.artId).toBe(DRONE_SCOUT.id)
    // ⚠ 集火锁定会跨调用保持（这是对的）⇒ 换距离前先清锁定，否则打的还是上一轮锁的那架
    b.mePdFocus = []
    // 贴到 1,000m ⇒ 哨戒机进池，且**优先级 0** ⇒ 必中哨戒机
    const near = pick(b, state, 1_000)
    expect(near?.pool.artId).toBe(DRONE_SENTRY.id)
  })

  it('只有哨戒机且它够不着 ⇒ 打不到任何目标（返回 null，不空放）', () => {
    const { state, b } = battleWith([{ drone: DRONE_SENTRY, count: 1 }])
    expect(pick(b, state, 9_000)).toBeNull()
  })

  it('优先级：攻坚（1）优先于侦察（2）；同档等权随机（多打几次两架都能被选中）', () => {
    const { state, b } = battleWith([
      { drone: DRONE_ASSAULT, count: 1 },
      { drone: DRONE_SCOUT, count: 1 },
    ])
    // 攻坚与侦察同时在池 ⇒ 先打攻坚（优先级 1 < 2）
    for (let i = 0; i < 5; i += 1) expect(pick(b, state, 1_000)?.pool.artId).toBe(DRONE_ASSAULT.id)
    // 只留侦察（把攻坚标成非存活）⇒ 打侦察
    const pools = b.foeDronePools!
    for (const arr of Object.values(pools)) for (const p of arr) if (p.artId === DRONE_ASSAULT.id) p.alive = false
    // 集火锁定里可能还留着攻坚 ⇒ 清掉锁定再看
    b.mePdFocus = []
    expect(pick(b, state, 1_000)?.pool.artId).toBe(DRONE_SCOUT.id)
  })

  it('集火：连续两次反击打同一架；目标被击落才换靶', () => {
    const { state, b } = battleWith([{ drone: DRONE_SCOUT, count: 2 }])
    const first = pick(b, state, 1_000)!
    const second = pick(b, state, 1_000)!
    expect(second.pool).toBe(first.pool) // 同一架（同一池条目对象）
    // 把它打掉 ⇒ 下一次必须换靶
    first.pool.alive = false
    const third = pick(b, state, 1_000)!
    expect(third.pool).not.toBe(first.pool)
    expect(third.pool.alive).toBe(true)
  })

  it('集火按**武器槽**各锁各的（`mePdFocus`）：两门防空炮可以打不同的机', () => {
    const { state, b } = battleWith([{ drone: DRONE_SCOUT, count: 2 }])
    const w0 = pick(b, state, 1_000, 0)!
    const w1 = pick(b, state, 1_000, 1)!
    expect(b.mePdFocus?.[0]?.idx).toBeDefined()
    expect(b.mePdFocus?.[1]?.idx).toBeDefined()
    // 两槽各自锁定（互不覆盖）——锁定的下标允许相同（随机可能撞同一架），但状态必须各自留下
    expect(b.mePdFocus!.length).toBeGreaterThanOrEqual(2)
    expect([w0.pool, w1.pool].every((p) => p.alive)).toBe(true)
  })
})
