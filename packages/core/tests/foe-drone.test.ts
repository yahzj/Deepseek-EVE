/**
 * **敌方机群（舰载无人机）**用例（2026-09-11 机制批 S2 · 船长十四条裁定 · 设计稿
 * `docs/design/foe-drone-system-20260911.md`）。
 *
 * 用**合成舰级 + 真机型表**驱动（正式样本卡在 S3 落），钉住四件事：
 * 1. **建档**：`FoeShipDef.drones` 展开成**每架一条** `src:'drone'` 武器条目（与我方同构）；
 * 2. **A5 火力守恒**：机群吃**同一条 `dmgMul`**、**不吃多舰补偿** `2N/(N+1)`（船长裁定「不吃」）；
 * 3. **生存池**：按**敌单位 tag** 建池、与机群条目同序、三层血取**机型表绝对值**（不吃玩家技能）；
 * 4. **会开火**：机群按机型 `reloadMs`/射程/命中独立开火 ⇒ 战斗 fx 里出现 `src:'drone'` 事件；
 *    **负向对照**（同卡不写 `drones`）⇒ 无池、无 drone 事件（既有战斗零行为变化）。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext, FOE_DRONE_E_ALERT } from '@whale/data'
import { addShipToFleet, createInitialState } from '../src/index'
import { advanceBattleFor, createFoeSpecs, pickFoeDroneTarget, startBattleFor } from '../src/combat'
import type { BattleState, GameState } from '../src/state'
import type { AnomalyDef, FoeShipDef, FoeDroneSlot, SimContext } from '../src/types'

const base = buildSimContext()
const bal = base.balance.battle

/** 试验舰级：母舰**射程 1~10 m**（够不着，用来把"机群的火力"从"母舰的火力"里分出来）。
 *  `shotDmg` 单独给参数：打"开火"用例时压到 1（保证玩家活得够久、机群打得出来），
 *  A5 守恒用例用 100（便于对倍率取整）。 */
function testShip(drones?: readonly FoeDroneSlot[], shotDmg = 100): FoeShipDef {
  return {
    id: 'foe-test-drone',
    name: '试验巨构',
    family: 'E',
    hullClassTier: 4,
    speedRatio: 0.8,
    hp: 1600,
    split: { s: 0.2, a: 0.55, h: 0.25 },
    shotDmg,
    hitRate: 0.65,
    reloadMs: 4000,
    rangeMinM: 1,
    rangeMaxM: 10,
    falloff: 0.5,
    dmgMix: { kinetic: 8, explosive: 2 },
    tactic: 'orbit',
    ...(drones ? { drones } : {}),
  }
}

/** 合成卡：以**已迁入舰级路径的真卡**为基底（保证 `waves`/星系等字段齐备），只覆写编成 */
function testCard(ship: FoeShipDef, dmgMul = 1): AnomalyDef {
  const src = base.anomalies.get('ano-gravekeeper')! // D 族：单波、舰级路径、无旧路径残留字段
  return {
    ...src,
    id: 'ano-test-foe-drone',
    name: '机群试验卡',
    galaxyId: 'galaxy-abyss',
    threat: 60,
    tactic: 'orbit',
    ships: [{ ship, count: 2, dmgMul }],
  }
}

function ctxWith(card: AnomalyDef): SimContext {
  return { ...base, anomalies: new Map([...base.anomalies, [card.id, card]]) }
}

function makeState(seed = 5): GameState {
  const state = createInitialState({ nowWallMs: 0, seed })
  const uid = addShipToFleet(state, 'sh-sentinel') // 王鲭：厚甲多槽，够活到机群开火
  state.shipId = uid
  state.fleet[uid]!.fitted = {
    high: ['mod-turret-kin-2'],
    mid: ['mod-shield-kin-2', 'mod-track-2'],
    low: ['mod-stab-kin-2'],
  }
  return state
}

/** 打到 `advMs` 就停。60 秒 = 接近期（开局距离→机群射程 3km，约 10~25 秒）+ 机群数个装填周期；
 *  fx 环缓冲 48 条按"丢最旧"裁剪，机群是**全程持续**开火 ⇒ 最近的事件必在环里。 */
function runBattle(card: AnomalyDef, advMs = 60_000): BattleState {
  const c = ctxWith(card)
  const state = makeState()
  const battle = startBattleFor(state, c, state.shipId, card.id, 0)!
  state.expedition.active = true
  state.expedition.phase = 'battle'
  state.expedition.anomalyId = card.id
  state.expedition.battle = battle
  state.gameMs = advMs
  advanceBattleFor(state, c, battle, state.shipId, card.id)
  return battle
}

describe('敌方机群：建档与 A5 火力守恒', () => {
  it('展开成每架一条 src=drone 条目；机群吃 dmgMul、不吃多舰补偿', () => {
    const card = testCard(testShip([{ drone: FOE_DRONE_E_ALERT, count: 3 }]), 2)
    const units = createFoeSpecs(card, bal)
    expect(units).toHaveLength(2) // 两艘母舰

    for (const u of units) {
      const drones = u.weapons.filter((w) => w.src === 'drone')
      expect(drones).toHaveLength(3) // 每架一条
      expect(drones.every((w) => w.artId === FOE_DRONE_E_ALERT.id)).toBe(true)
      expect(drones.every((w) => w.kind === 'fixed')).toBe(true)
      expect(drones.every((w) => w.maxRangeM === FOE_DRONE_E_ALERT.maxRangeM)).toBe(true)
      expect(drones.every((w) => w.reloadMs === FOE_DRONE_E_ALERT.reloadMs)).toBe(true)
      // A5①：机群吃**同一条 dmgMul**（母舰单发因此相对让位）——8 × 2 = 16
      expect(drones.every((w) => w.shotDmg === Math.round(FOE_DRONE_E_ALERT.dmg * 2))).toBe(true)
      // A5②：**不吃多舰补偿**——母舰 = round(100 × 2 × 2N/(N+1)=4/3) = 267；机群若也吃补偿会是 21
      expect(u.weapons[0]!.shotDmg).toBe(Math.round(100 * 2 * (4 / 3)))
      // 舰级把机群登记原样带到单位上（建池要用）
      expect(u.foeDrones).toHaveLength(1)
      expect(u.foeDrones![0]!.count).toBe(3)
    }
  })

  it('不写 drones 的舰级：单位上无机群、武器只有母舰一条（零行为变化）', () => {
    const units = createFoeSpecs(testCard(testShip()), bal)
    for (const u of units) {
      expect(u.weapons).toHaveLength(1)
      expect(u.weapons[0]!.src).toBeUndefined()
      expect(u.foeDrones).toBeUndefined()
    }
  })
})

describe('敌方机群：生存池与开火', () => {
  it('按敌单位 tag 建池，三层血/回避/机型 id 取机型表绝对值', () => {
    const card = testCard(testShip([{ drone: FOE_DRONE_E_ALERT, count: 3 }], 1))
    const battle = runBattle(card)
    const pools = battle.foeDronePools!
    expect(pools).toBeTruthy()
    const tags = Object.keys(pools)
    expect(tags).toHaveLength(2) // 两艘母舰各一池
    for (const tag of tags) {
      const list = pools[tag]!
      expect(list).toHaveLength(3) // 与机群武器条目同序、同数
      expect(list.every((p) => p.alive)).toBe(true)
      expect(list.every((p) => p.artId === FOE_DRONE_E_ALERT.id)).toBe(true)
      expect(list[0]).toMatchObject({
        s: FOE_DRONE_E_ALERT.defense.shieldHp,
        a: FOE_DRONE_E_ALERT.defense.armorHp,
        h: FOE_DRONE_E_ALERT.defense.hullHp,
        evasion: FOE_DRONE_E_ALERT.defense.evasion,
      })
      expect(list[0]!.resists?.armor).toEqual(FOE_DRONE_E_ALERT.defense.armorResist)
    }
  })

  it('机群会开火：战斗 fx 出现 src=drone 事件（母舰射程 10m ⇒ 那些事件只可能来自机群）', () => {
    const card = testCard(testShip([{ drone: FOE_DRONE_E_ALERT, count: 3 }], 1))
    const battle = runBattle(card)
    const droneFx = battle.fx.filter((e) => e.src === 'drone')
    expect(droneFx.length).toBeGreaterThan(0)
    expect(droneFx.every((e) => e.artId === FOE_DRONE_E_ALERT.id)).toBe(true)
    expect(droneFx.every((e) => e.side === 'foe' && e.to === 'player')).toBe(true)
    expect(droneFx.every((e) => e.type === FOE_DRONE_E_ALERT.damageType)).toBe(true)
  })

  it('负向对照：同卡不写 drones ⇒ 不建池、无 drone 事件', () => {
    const battle = runBattle(testCard(testShip(undefined, 1)))
    expect(battle.foeDronePools).toBeUndefined()
    expect(battle.fx.some((e) => e.src === 'drone')).toBe(false)
  })
})

describe('防空选靶（船长 A1：只有带防空属性的武器能打敌机）', () => {
  const RANGED = { minRangeM: 1, maxRangeM: 9000 }

  it('本场无机群 ⇒ null，且**不消费 rng**（既有武器一次掷骰都不会多花）', () => {
    const battle = runBattle(testCard(testShip(undefined, 1)))
    expect(battle.foeDronePools).toBeUndefined()
    const state = makeState()
    const before = structuredClone(state.rng)
    expect(pickFoeDroneTarget(state, battle, [{ tag: 'foe-0' } as never], 3000, RANGED)).toBeNull()
    expect(state.rng).toEqual(before)
  })

  it('武器射程之外 ⇒ null（炮台射程 ≠ 机群射程），且同样不消费 rng', () => {
    const card = testCard(testShip([{ drone: FOE_DRONE_E_ALERT, count: 3 }], 1))
    const battle = runBattle(card)
    const foes = createFoeSpecs(card, bal)
    const state = makeState()
    const before = structuredClone(state.rng)
    expect(pickFoeDroneTarget(state, battle, foes, 50, { minRangeM: 1, maxRangeM: 10 })).toBeNull()
    expect(state.rng).toEqual(before)
  })

  it('射程之内 ⇒ 抽到存活敌机；击落（alive=false）后不再被选中', () => {
    const card = testCard(testShip([{ drone: FOE_DRONE_E_ALERT, count: 3 }], 1))
    const battle = runBattle(card)
    const foes = createFoeSpecs(card, bal)
    const state = makeState()

    const first = pickFoeDroneTarget(state, battle, foes, 3000, RANGED)
    expect(first).toBeTruthy()
    expect(first!.pool.alive).toBe(true)
    expect(first!.pool.artId).toBe(FOE_DRONE_E_ALERT.id)

    // 把抽到的那架击落 ⇒ 池里存活数 −1，且它不会再成为目标
    const pools = battle.foeDronePools![first!.foeTag]!
    expect(pools).toContain(first!.pool)
    first!.pool.alive = false
    const aliveAfter = pools.filter((p) => p.alive).length
    expect(aliveAfter).toBe(2)
    for (let i = 0; i < 20; i++) {
      const again = pickFoeDroneTarget(state, battle, foes, 3000, RANGED)
      if (again) expect(again.pool.alive).toBe(true)
    }
  })

  it('母舰阵亡 ⇒ 其机群不再参战（「机群是舰的一部分」）', () => {
    const card = testCard(testShip([{ drone: FOE_DRONE_E_ALERT, count: 3 }], 1))
    const battle = runBattle(card)
    const foes = createFoeSpecs(card, bal)
    const state = makeState()
    // 把两艘母舰都判为阵亡（血量清零）
    for (const f of foes) {
      battle.units[f.tag]!.hp = { s: 0, a: 0, h: 0 }
    }
    expect(pickFoeDroneTarget(state, battle, foes, 3000, RANGED)).toBeNull()
  })
})
