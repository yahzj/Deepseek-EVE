/**
 * 舰级路径（**敌舰配置表 · A 族试点**，2026-09-11 船长定案）
 *
 * 船长原话：「给敌人单独一套**敌舰的配置表**，敌舰属性按照配置表再根据实际悬赏等进行修正，
 * 这样**不会出现动一艘船，其他跟着动**」；同日裁决「**舰级给绝对值**」「卡上用修正」
 * 「**允许混编**」「先试点」「④按四级」「⑤（精锐词缀）可以」。
 *
 * ⚠ 覆盖说明：结构试点期 6 张 A 族卡**刻意保持原值**（船长 ⑥「先不改数值」），因此它们
 * **没有用到「混编」与「头目档」**——这两项能力由本文件**直接构造舰级**覆盖，
 * 不靠"将来某张卡会用到"来兜底。
 * ⚠ **2026-09-11 数值落地批**（船长确认「先按照你的提议实现」）起，6 张卡真正用上混编与头目档
 *（头目 ×1 + 杂鱼 ×3），并同时落地：**多舰船补偿 `2N/(N+1)`**、A 族**全族提速**、**射程 −15%**。
 * 故本文件里"实速逐字等于 351/291/201/377"的零变化守卫已按新口径改写。
 *
 * 本文件验证：
 * ① **绝对值口径**：单位属性 = 舰级值 × 本条倍率，**不吃威胁份额均分、不吃 hpShare**
 *    （改威胁强度不影响同一编成的建档值）；
 * ② **允许混编**：一张卡引用多个舰级，各自按自己的舰级建档（头目厚且疼、杂鱼薄且轻）；
 * ③ **词缀**：`elite` 舰级 → 「精锐」前缀；僚机 → 「轻装」前缀；
 * ④ **tag 口径**：与旧路径同规则（首队 `foe-0` / 僚机 `foe-1`；同波后续小队 `w0-foe-{k}`）；
 * ⑤ **旧路径不受影响**：无 `ships` 的卡行为逐字不变（仍按威胁推导 + 战术×血型命名）；
 * ⑥ **舰种档 + 速度倍率**：实速 = `舰种基准 × speedRatio`，A 族提速后 = 391 / 374 / 325 / 374
 *    （每档都高于本档舰种基准 340/295/258）；
 * ⑦ **多舰船补偿**（2026-09-11 船长确认）：舰级路径按本卡编成单位数 N 施加 `2N/(N+1)`，
 *    旧威胁推导路径**不启用**（N=1 天然为 1）；单发 = `round(舰级单发 × dmgMul × 补偿)`。
 */
import { describe, expect, it } from 'vitest'
import { ANOMALIES, FOE_SHIPS } from '@whale/data'
import { createFoeSpecs, FOE_ELITE_WORD, FOE_LIGHT_WORD, foeDesiredRange, foeUnitNameOf } from '../src/combat'
import { FOE_LAIR_GEAR, isLairCandidate } from '../src/lairs'
import type { AnomalyDef, FoeShipDef } from '../src/types'
import { anomaly, makeTestCtx } from './helpers'

const bal = makeTestCtx().balance.battle

/** 测试用舰级：头目档（精锐、厚且疼）——舰种档 3 巡洋舰，速度 380 = 258 × `380/258` */
const BOSS: FoeShipDef = {
  id: 't-foe-boss',
  name: '测试头目舰',
  family: 'A',
  hullClassTier: 3,
  speedRatio: 380 / 258,
  hp: 400,
  split: { s: 0.2, a: 0.55, h: 0.25 },
  shotDmg: 60,
  hitRate: 0.9,
  reloadMs: 4000,
  rangeMinM: 1,
  rangeMaxM: 2600,
  falloff: 0.3,
  dmgMix: { kinetic: 8, explosive: 2 },
  tactic: 'brawl',
  elite: true,
}

/** 测试用舰级：杂鱼（薄、轻、快）——舰种档 1 护卫舰，速度 350 = 340 × `350/340` */
const SKIFF: FoeShipDef = {
  id: 't-foe-skiff',
  name: '测试快艇',
  family: 'A',
  hullClassTier: 1,
  speedRatio: 350 / 340,
  hp: 100,
  split: { s: 0.2, a: 0.55, h: 0.25 },
  shotDmg: 10,
  hitRate: 0.85,
  reloadMs: 4000,
  rangeMinM: 1,
  rangeMaxM: 2200,
  falloff: 0.3,
  dmgMix: { kinetic: 8, explosive: 2 },
  tactic: 'brawl',
}

/** 一张"头目 ×1 + 快艇 ×3 + 快艇僚机 ×1"的**混编**卡 */
function mixedCard(threat: number): AnomalyDef {
  return {
    ...anomaly('ano-t-mixed', 'galaxy-hub', { threat, tactic: 'brawl' }),
    ships: [
      { ship: BOSS },
      { ship: SKIFF, count: 3 },
      { ship: SKIFF, escort: true, hpMul: 0.6, dmgMul: 0.6 },
    ],
  }
}

const hpOf = (u: { hp: { s: number; a: number; h: number } }): number => u.hp.s + u.hp.a + u.hp.h

describe('舰级路径：绝对值口径', () => {
  it('单位属性 = 舰级值 × 倍率；改威胁不影响同一编成的建档值（绝对值，不吃威胁份额）', () => {
    const low = createFoeSpecs(mixedCard(10), bal)
    const high = createFoeSpecs(mixedCard(999), bal)
    expect(low.map(hpOf)).toEqual(high.map(hpOf))
    expect(low[0]!.weapons[0]!.shotDmg).toBe(high[0]!.weapons[0]!.shotDmg)
    expect(low[0]!.speedMps).toBe(high[0]!.speedMps)
  })

  it('血量/单发/速度/射程一律按"舰级 × 本条倍率"，僚机再 ×0.6；单发再吃多舰船补偿', () => {
    const specs = createFoeSpecs(mixedCard(40), bal)
    const boss = specs[0]!
    const skiff = specs[1]!
    const escort = specs[4]!
    expect(hpOf(boss)).toBeCloseTo(400, 6)
    expect(hpOf(skiff)).toBeCloseTo(100, 6)
    expect(hpOf(escort)).toBeCloseTo(60, 6) // 100 × 0.6
    // 单发：本卡编成 5 单位 → 多舰补偿 2×5/6 = 5/3（2026-09-11 船长确认）
    // 头目 round(60 × 5/3) = 100；杂鱼 round(10 × 5/3) = 17；僚机 round(10 × 0.6 × 5/3) = 10
    expect(boss.weapons[0]!.shotDmg).toBe(100)
    expect(skiff.weapons[0]!.shotDmg).toBe(17)
    expect(escort.weapons[0]!.shotDmg).toBe(10)
    expect(boss.speedMps).toBe(380)
    expect(skiff.speedMps).toBe(350)
    expect(boss.weapons[0]!.maxRangeM).toBe(2600)
    expect(skiff.weapons[0]!.maxRangeM).toBe(2200)
  })
})

describe('舰级路径：允许混编', () => {
  it('一张卡引用多个舰级，各自建档（头目厚且疼、杂鱼薄且轻）', () => {
    const specs = createFoeSpecs(mixedCard(40), bal)
    expect(specs).toHaveLength(5) // 头目 ×1 + 快艇 ×3 + 僚机 ×1
    const boss = specs.find((s) => s.tag === 'foe-0')!
    const minion = specs.find((s) => s.tag === 'w0-foe-1')!
    const bossShot: number = boss.weapons[0]!.shotDmg!
    const minionShot: number = minion.weapons[0]!.shotDmg!
    expect(hpOf(boss)).toBeGreaterThan(hpOf(minion) * 3)
    expect(bossShot).toBeGreaterThan(minionShot * 3)
  })

  it('tag 口径与旧路径同规则：首队 foe-0、同波后续小队 w0-foe-{k}、僚机跟最近主体', () => {
    const specs = createFoeSpecs(mixedCard(40), bal)
    expect(specs.map((s) => s.tag)).toEqual(['foe-0', 'w0-foe-1', 'w0-foe-2', 'w0-foe-3', 'w0-foe-3-e1'])
  })

  it('分波：slot.wave 指定第几波，前缀 w{n}- 与旧多波口径一致', () => {
    const w1 = createFoeSpecs({ ...mixedCard(40), ships: [{ ship: BOSS, wave: 1 }] }, bal, { tagPrefix: 'w1-' })
    expect(w1.map((s) => s.tag)).toEqual(['w1-foe-0'])
    // 第 1 波只建该波条目（第 0 波的条目不会重复出现）
    expect(createFoeSpecs({ ...mixedCard(40), ships: [{ ship: BOSS, wave: 1 }] }, bal, { tagPrefix: 'w1-' })).toHaveLength(1)
  })
})

describe('舰级路径：词缀与显示名', () => {
  it('头目档挂「精锐」、僚机挂「轻装」（2026-09-11 船长裁决实装精锐档）', () => {
    const specs = createFoeSpecs(mixedCard(40), bal)
    expect(specs[0]!.name).toBe(`${FOE_ELITE_WORD}测试头目舰`)
    expect(specs[1]!.name).toBe('测试快艇')
    expect(specs[4]!.name).toBe(`${FOE_LIGHT_WORD}测试快艇`)
  })

  it('界面同源：foeUnitNameOf(卡, tag) 能按 tag 反查回同一舰级名（读档实时推导不迁移）', () => {
    const def = mixedCard(40)
    expect(foeUnitNameOf(def, 'foe-0')).toBe(`${FOE_ELITE_WORD}测试头目舰`)
    expect(foeUnitNameOf(def, 'w0-foe-2')).toBe('测试快艇')
    expect(foeUnitNameOf(def, 'w0-foe-3-e1')).toBe(`${FOE_LIGHT_WORD}测试快艇`)
  })

  it('主系覆写生效：编成条目写 dmgMix 时按覆写建档（能量 → 光束必中）', () => {
    const def: AnomalyDef = {
      ...anomaly('ano-t-plasma', 'galaxy-hub', { threat: 30 }),
      ships: [{ ship: SKIFF, dmgMix: { plasma: 8, kinetic: 2 } }],
    }
    const w = createFoeSpecs(def, bal)[0]!.weapons[0]!
    expect(w.kind).toBe('beam')
    expect(w.fixedType).toBe('plasma')
    expect(w.hitRate).toBe(1) // 光束必中
    expect(w.shotsByType).toEqual({ plasma: 8, kinetic: 2 })
  })
})

describe('舰级路径：头目可配多战术（2026-09-11 船长「头目建议允许多个战术」）', () => {
  it('同一条头目舰换战术：`tactic` 覆写生效，射程带走**绝对覆写**（否则会出现"想打远战却只有 2.6 km"）', () => {
    const def: AnomalyDef = {
      ...anomaly('ano-t-boss-kite', 'galaxy-hub', { threat: 60 }),
      ships: [{ ship: BOSS, tactic: 'kite', rangeMinM: 1500, rangeMaxM: 12000 }],
    }
    const spec = createFoeSpecs(def, bal)[0]!
    expect(spec.foeTactic).toBe('kite')
    expect(spec.weapons[0]!.minRangeM).toBe(1500)
    expect(spec.weapons[0]!.maxRangeM).toBe(12000)
    // 舰级自身仍是 brawl：头目"强"来自**档位**，"怎么打"由**卡上**定（舰级默认战术不被改动）
    expect(BOSS.tactic).toBe('brawl')
    expect(spec.name).toBe(`${FOE_ELITE_WORD}测试头目舰`)
  })

  it('未覆写时仍走舰级默认战术与舰级射程', () => {
    const def: AnomalyDef = {
      ...anomaly('ano-t-boss-def', 'galaxy-hub', { threat: 60 }),
      ships: [{ ship: BOSS }],
    }
    const spec = createFoeSpecs(def, bal)[0]!
    expect(spec.foeTactic).toBe('brawl')
    expect(spec.weapons[0]!.minRangeM).toBe(1)
    expect(spec.weapons[0]!.maxRangeM).toBe(2600)
  })

  it('混编可各用各的战术（狙击头目 + 贴脸杂鱼同场）', () => {
    const def: AnomalyDef = {
      ...anomaly('ano-t-mixed-tactic', 'galaxy-hub', { threat: 50 }),
      ships: [
        { ship: BOSS, tactic: 'kite', rangeMinM: 1500, rangeMaxM: 12000 },
        { ship: SKIFF, count: 2 },
      ],
    }
    expect(createFoeSpecs(def, bal).map((s) => s.foeTactic)).toEqual(['kite', 'brawl', 'brawl'])
  })
})

describe('旧路径不受影响（未写 ships 的卡）', () => {
  it('仍按威胁推导建档，命名仍走"战术 × 血型"舰种名', () => {
    const def = anomaly('ano-t-legacy', 'galaxy-hub', { threat: 20, tactic: 'brawl' })
    const specs = createFoeSpecs({ ...def, defProfile: 'armor', foeHpOverride: 300 }, bal)
    expect(specs).toHaveLength(1)
    expect(specs[0]!.tag).toBe('foe-0')
    expect(specs[0]!.name).toBe('攻坚重甲舰')
    expect(hpOf(specs[0]!)).toBeCloseTo(300, 6)
  })
})

/**
 * 舰种档 + 速度倍率（**2026-09-11 追加裁决**：船长「劫掠护卫舰和劫掠狙击舰下落一档，
 * 只有头目是巡洋舰」；**2026-09-11 数值落地批**按 A 族设定「速度都快（方便突袭）」提速）。
 *
 * 口径守卫：**实速 = round(舰种基准 × speedRatio × 条目 speedMul)**，且 **A 族每档都高于本档舰种基准**。
 * ⚠ 结构试点期的"实速逐字等于 351 / 291 / 201 / 377"零变化守卫**已随本批故意改写**为提速读数
 * 391 / 374 / 325 / 374（这是船长确认的**真难度改动**，不是漂移）。
 * 与 `content:check`「敌速口径契约」互为独立写法（引擎实算 vs 内容表校验）。
 */
describe('舰种档与速度倍率（A 族提速口径）', () => {
  it('实速 = 舰种基准 × 倍率：A 族提速后 = 391 / 374 / 325 / 374', () => {
    const shell = anomaly('ano-t-hull-speed', 'galaxy-hub', { threat: 20 })
    const got = FOE_SHIPS.filter((s) => s.family === 'A').map((ship) => ({
      id: ship.id,
      tier: ship.hullClassTier,
      speed: createFoeSpecs({ ...shell, ships: [{ ship }] }, bal)[0]!.speedMps,
    }))
    expect(got).toEqual([
      { id: 'foe-pirate-skiff', tier: 1, speed: 391 },
      { id: 'foe-pirate-corvette', tier: 1, speed: 374 },
      { id: 'foe-pirate-sniper', tier: 2, speed: 325 },
      { id: 'foe-pirate-warlord', tier: 3, speed: 374 },
    ])
  })

  it('A 族每档实速都**高于本档舰种基准**（护卫 340 / 驱逐 295 / 巡洋 258）——船长「速度都快」', () => {
    const shell = anomaly('ano-t-hull-overshoot', 'galaxy-hub', { threat: 20 })
    for (const ship of FOE_SHIPS.filter((s) => s.family === 'A')) {
      expect(ship.family).toBe('A')
      expect(ship.speedRatio).toBeGreaterThan(1) // 倍率 > 1 ⇔ 快于本档基准
      const spd = createFoeSpecs({ ...shell, ships: [{ ship }] }, bal)[0]!.speedMps
      expect(spd).toBeGreaterThan(bal.hullClassBaseSpeedMps[ship.hullClassTier])
    }
  })

  /**
   * **B 族（武装拾荒者）偏慢口径**（2026-09-11 船长裁决：「**B 族速度按 0.8 走**」+「新手过渡族」）——
   * 与 A 族**方向相反**：每档实速都**低于**本档舰种基准。两条守卫互为镜像，防日后有人把两族口径写混
   * （本仓已真实发生过"两个敌速口径混用无人察觉"）。
   */
  it('B 族每档实速都**低于本档舰种基准**：拾荒武装艇 272（= 340×0.80）/ 拾荒火力舰 236（= 295×0.80）', () => {
    const shell = anomaly('ano-t-hull-slow', 'galaxy-hub', { threat: 20 })
    const got = FOE_SHIPS.filter((s) => s.family === 'B').map((ship) => ({
      id: ship.id,
      tier: ship.hullClassTier,
      speed: createFoeSpecs({ ...shell, ships: [{ ship }] }, bal)[0]!.speedMps,
    }))
    expect(got).toEqual([
      { id: 'foe-scav-skiff', tier: 1, speed: 272 },
      { id: 'foe-scav-armed', tier: 2, speed: 236 },
    ])
    for (const ship of FOE_SHIPS.filter((s) => s.family === 'B')) {
      expect(ship.speedRatio).toBeLessThan(1) // 倍率 < 1 ⇔ 慢于本档基准
      const spd = createFoeSpecs({ ...shell, ships: [{ ship }] }, bal)[0]!.speedMps
      expect(spd).toBeLessThan(bal.hullClassBaseSpeedMps[ship.hullClassTier])
    }
  })

  it('B 族舰种档只登记 1 护卫舰 / 2 驱逐舰（新手过渡族，不得 ≥ T3）', () => {
    for (const ship of FOE_SHIPS.filter((s) => s.family === 'B')) {
      expect(ship.hullClassTier).toBeLessThanOrEqual(2)
    }
  })

  it('舰种档与倍率口径：实速 = round(基准 × 倍率 × 条目 speedMul)（倍率按精确分数登记）', () => {
    for (const ship of FOE_SHIPS) {
      const base = bal.hullClassBaseSpeedMps[ship.hullClassTier]
      expect(createFoeSpecs({ ...anomaly('ano-t-hull-mul', 'galaxy-hub', { threat: 20 }), ships: [{ ship }] }, bal)[0]!.speedMps).toBe(
        Math.round(base * ship.speedRatio),
      )
      // 条目 speedMul：与原绝对值口径同规则（乘后取整）
      const withMul = createFoeSpecs(
        { ...anomaly('ano-t-hull-mul2', 'galaxy-hub', { threat: 20 }), ships: [{ ship, speedMul: 1.25 }] },
        bal,
      )[0]!.speedMps
      expect(withMul).toBe(Math.round(base * ship.speedRatio * 1.25))
    }
  })

  it('舰种档必须落在 1~5；海盗族（A）不得登记 4 战列舰 / 5 旗舰档（海盗不配战列级）', () => {
    for (const ship of FOE_SHIPS) {
      expect(Number.isInteger(ship.hullClassTier)).toBe(true)
      expect(ship.hullClassTier).toBeGreaterThanOrEqual(1)
      expect(ship.hullClassTier).toBeLessThanOrEqual(5)
      if (ship.family === 'A') {
        // 船长 2026-09-11：「海盗应该是护卫驱逐巡洋构成，战列级强力+维护成本大，不适合海盗的背景设定」
        expect(ship.hullClassTier).toBeLessThan(4)
      }
    }
  })
})

/**
 * **多舰船补偿系数**（2026-09-11 船长确认「先按照你的提议实现」）：
 * `2N/(N+1)`（N = 本卡编成单位总数）——N 个单位逐个被击毁时敌人累计输出只有单舰基准的
 * `(N+1)/(2N)`（N=4 → 62.5%），本系数正好抵消这层阶梯衰减。
 * 适用范围：**只在舰级路径**；旧威胁推导路径**不启用**（N=1 天然为 1）。
 */
describe('多舰船补偿：舰级路径按 N 缩放单发，旧路径不动', () => {
  const shell = anomaly('ano-t-comp', 'galaxy-hub', { threat: 20 })

  it('N=1 不生效；N=4 → ×1.6；N=5 → ×5/3（单发 = round(舰级单发 × dmgMul × 补偿)）', () => {
    const one = createFoeSpecs({ ...shell, ships: [{ ship: SKIFF }] }, bal)
    expect(one.map((u) => u.weapons[0]!.shotDmg)).toEqual([10]) // 10 × 1 = 10

    const four = createFoeSpecs({ ...shell, ships: [{ ship: SKIFF, count: 4 }] }, bal)
    expect(four.map((u) => u.tag)).toEqual(['foe-0', 'w0-foe-1', 'w0-foe-2', 'w0-foe-3'])
    expect(four.map((u) => u.weapons[0]!.shotDmg)).toEqual([16, 16, 16, 16]) // round(10 × 1.6)

    // 头目 ×1 + 快艇 ×3 + 僚机 ×1 = 5 单位 → 2×5/6 = 5/3
    const five = createFoeSpecs(mixedCard(40), bal)
    expect(five.map((u) => u.weapons[0]!.shotDmg)).toEqual([100, 17, 17, 17, 10])
  })

  it('混编卡：头目与杂鱼同吃补偿；多舰补偿不改变血量/速度/射程口径', () => {
    const specs = createFoeSpecs(mixedCard(40), bal)
    expect(specs.map(hpOf)).toEqual([400, 100, 100, 100, 60])
    expect(specs.map((u) => u.speedMps)).toEqual([380, 350, 350, 350, 350])
    expect(specs.map((u) => u.weapons[0]!.maxRangeM)).toEqual([2600, 2200, 2200, 2200, 2200])
  })

  it('旧威胁推导路径**不启用**补偿：单发逐字等于旧推导链（威胁 40 → 93）', () => {
    const def = anomaly('ano-t-legacy-comp', 'galaxy-hub', { threat: 40, tactic: 'brawl' })
    const spec = createFoeSpecs({ ...def, foeHpOverride: 300, defProfile: 'armor' }, bal)[0]!
    // 旧链：dps = 40 × 0.8 = 32 → 32 × 4s × 0.62 ÷ 0.85 = 93.36 → 93（无任何多舰补偿）
    expect(spec.weapons[0]!.shotDmg).toBe(93)
  })
})

/**
 * **赤潮 / 蜃影 火力重锚**（船长 2026-09-11 裁决 = 方案 B：「**按照实际算**」）。
 *
 * 这两张卡旧带**逐卡伤害压制倍率**（旧 `foeDmgMul` 0.27 / 0.30，字段已按船长同日裁决整体退休），
 * 试点期把压制折进了舰级绝对单发（29 / 29）；A 族数值批按「威胁 × 0.8 × 1.6」重锚时
 * **无声取消了压制** ⇒ 实际火力 7.25 → 43.25（×5.97）、11.50 → 61.50（×5.35），难度失控
 * （蜃影实测从 100%/49s/残血 50% 变成 20%/35s/残血 1%）。
 *
 * 裁决修法 = **锚回「改造前的实际火力 × 1.6」，改用卡上 `dmgMul` 重锚**（**禁止恢复 `foeDmgMul`**）：
 * - 赤潮：目标 7.25 × 1.6 = **11.60** → 重锚单发 头目 **28** / 每杂鱼 **6**（Σ 46 → 纸面 11.50，−0.86%）
 * - 蜃影：目标 11.50 × 1.6 = **18.40** → 重锚单发 头目 **44** / 每杂鱼 **10**（Σ 74 → 纸面 18.50，+0.54%）
 *
 * 本守卫锁死"重锚后的卡上设计单发 + 纸面期望火力 ≈ 旧实伤 ×1.6"（±2%）。
 * ⚠ 已知偏差（**待船长裁决，不在本批解决**）：三张 kite 卡的**头目射程带是近战档（≤2.21 km）**，
 * 而实战交战距离 3.2~3.8 km ⇒ 头目**一次都不开火**（探针实测 foe-0 = 0 发），
 * 故"纸面的 60% 火力"并未落地、这两张卡实战比锚点更松（残血 100% / 89%）——
 * 与「kite 卡头目射程覆写」同一条待裁口径（见设计稿 §六 第 3/5 条）。
 */
describe('赤潮 / 蜃影 火力重锚（船长 2026-09-11 裁决：按实际算，不恢复 foeDmgMul）', () => {
  /** 真卡建档（用与生产同源的 DEFAULT_BALANCE，非测试假平衡） */
  const realCard = (id: string): AnomalyDef => ANOMALIES.find((a) => a.id === id)!
  /** 纸面期望火力 = Σ单位「单发 × 有效命中 ÷ 装填秒」（光束 hitRate = 1，与引擎建档同源） */
  const paperDps = (id: string): number =>
    createFoeSpecs(realCard(id), bal).reduce((n, u) => {
      const w = u.weapons[0]!
      return n + ((w.shotDmg ?? 0) * w.hitRate) / (w.reloadMs / 1000)
    }, 0)
  const shots = (id: string): number[] => createFoeSpecs(realCard(id), bal).map((u) => u.weapons[0]!.shotDmg ?? 0)

  it('赤潮劫掠舰队（T34）：重锚单发 头目 28 / 杂鱼 6，纸面火力 ≈ 旧实伤 7.25 × 1.6', () => {
    expect(shots('ano-redring-raiders')).toEqual([28, 6, 6, 6])
    const dps = paperDps('ano-redring-raiders')
    expect(dps).toBeCloseTo(11.5, 6) // Σ46 ÷ 4s
    expect(dps / 7.25).toBeGreaterThan(1.5) // ≈ ×1.586（目标 ×1.6，取整后 ±1%）
    expect(dps / 7.25).toBeLessThan(1.7)
    expect(realCard('ano-redring-raiders').threat).toBe(34)
  })

  it('蜃影导航劫持令（T48）：重锚单发 头目 44 / 杂鱼 10，纸面火力 ≈ 旧实伤 11.50 × 1.6', () => {
    expect(shots('ano-mirage-hijackers')).toEqual([44, 10, 10, 10])
    const dps = paperDps('ano-mirage-hijackers')
    expect(dps).toBeCloseTo(18.5, 6) // Σ74 ÷ 4s
    expect(dps / 11.5).toBeGreaterThan(1.5) // ≈ ×1.609
    expect(dps / 11.5).toBeLessThan(1.7)
  })

  it('重锚只动 dmgMul：血/编成/头目占比不受影响（`foeDmgMul` 字段保持退休）', () => {
    for (const id of ['ano-redring-raiders', 'ano-mirage-hijackers']) {
      const card = realCard(id)
      expect(card.ships).toHaveLength(2) // 头目 ×1 + 杂鱼 ×3（两条编成）
      expect(card.ships!.reduce((n, s) => n + Math.max(1, Math.floor(s.count ?? 1)), 0)).toBe(4)
      const specs = createFoeSpecs(card, bal)
      const hp = specs.map((u) => u.hp.s + u.hp.a + u.hp.h)
      const bossShare = hp[0]! / hp.reduce((a, b) => a + b, 0)
      expect(bossShare).toBeCloseTo(0.6, 6) // 头目 60% 血不变
      // `foeDmgMul` 字段不存在（类型上已删除）——这里锁"卡上没有任何逐卡伤害倍率入口"
      expect(Object.keys(card)).not.toContain('foeDmgMul')
      expect(Object.keys(card.ships![0]!)).not.toContain('foeDmgMul')
    }
  })
})

/**
 * **B 族（武装拾荒者）落码批**（2026-09-11 船长九条裁决 + 四条补充裁决）。
 *
 * 本批口径 = **零变化基线**：除「舰级名 / 速度（0.80）/ 战术（orbit）/ 教学卡名」四项**有意改动**外，
 * 三张卡的逐单位建档值必须与改造前**逐字一致**——故这里把基线读数**写死成断言**
 * （血三层 / 单发 / 逐系单发 / 命中 / 装填 / 射程带 / 远端衰减 / 近盲），
 * 谁动了一格都会在这里和 `content:check` 两处一起报出来。
 *
 * 基线来源：改造前对三张卡跑 `createFoeSpecs` 导出的逐单位建档值（一次性探针，已删）。
 */
describe('B 族（武装拾荒者）落码批', () => {
  const balB = makeTestCtx().balance.battle
  const card = (id: string): AnomalyDef => ANOMALIES.find((a) => a.id === id)!

  it('三张卡零变化基线：血/单发/逐系/命中/装填/射程/衰减/近盲 逐字一致', () => {
    type Row = {
      id: string
      hp: [number, number, number]
      shot: number
      byType?: Partial<Record<string, number>>
      hit: number
      ranges: [number, number]
    }
    const rows: Row[] = ['ano-training', 'ano-harbor-escort', 'ano-abandoned-platform'].map((id) => {
      const u = createFoeSpecs(card(id), balB)[0]!
      const w = u.weapons[0]!
      return {
        id,
        hp: [u.hp.s, u.hp.a, u.hp.h],
        shot: w.shotDmg!,
        ...(w.shotsByType ? { byType: w.shotsByType as Partial<Record<string, number>> } : {}),
        hit: w.hitRate!,
        ranges: [w.minRangeM!, w.maxRangeM!],
      }
    })
    // 血量三层按「和 + 逐层」比对（浮点尾差不可避免：7.260000000000001 之类）
    const wantHp: Record<string, [number, number, number]> = {
      'ano-training': [7.48, 7.26, 7.26],
      'ano-harbor-escort': [15, 41.25, 18.75],
      'ano-abandoned-platform': [99.28, 96.36, 96.36],
    }
    for (const r of rows) {
      const want = wantHp[r.id]!
      for (let i = 0; i < 3; i++) expect(r.hp[i]!).toBeCloseTo(want[i]!, 6)
      expect(r.hp[0]! + r.hp[1]! + r.hp[2]!).toBeCloseTo(want[0]! + want[1]! + want[2]!, 6)
    }
    // 单发 / 逐系 / 命中 / 射程：整数与有限小数，逐字比对
    expect(rows.map((r) => ({ id: r.id, shot: r.shot, byType: r.byType, hit: r.hit, ranges: r.ranges }))).toEqual([
      { id: 'ano-training', shot: 14, byType: undefined, hit: 0.85, ranges: [1, 2200] },
      { id: 'ano-harbor-escort', shot: 23, byType: { kinetic: 18, explosive: 5 }, hit: 0.85, ranges: [1, 2200] },
      { id: 'ano-abandoned-platform', shot: 58, byType: { kinetic: 46, explosive: 12 }, hit: 0.55, ranges: [366, 4815] },
    ])
    // 衰减/近盲/装填：三张一致（舰级基准口径）
    for (const id of ['ano-training', 'ano-harbor-escort', 'ano-abandoned-platform']) {
      const w = createFoeSpecs(card(id), balB)[0]!.weapons[0]!
      expect(w.falloff).toBe(0.5)
      expect(w.blindDmgMul).toBe(0.3)
      expect(w.reloadMs).toBe(4000)
    }
  })

  it('体力三档（速度/战术/卡名）是有意改动：272 / 272 / 236 且全部 orbit', () => {
    expect(createFoeSpecs(card('ano-training'), balB)[0]!.speedMps).toBe(272)
    expect(createFoeSpecs(card('ano-harbor-escort'), balB)[0]!.speedMps).toBe(272)
    expect(createFoeSpecs(card('ano-abandoned-platform'), balB)[0]!.speedMps).toBe(236)
    for (const id of ['ano-training', 'ano-harbor-escort', 'ano-abandoned-platform']) {
      expect(createFoeSpecs(card(id), balB)[0]!.foeTactic).toBe('orbit')
    }
    expect(card('ano-training').name).toBe('演习场驱逐令')
  })

  it('期望射程修正（船长「单独给 B 族添加期望射程修正」）：三卡各自声明，`foeDesiredRange` 采纳覆写', () => {
    const want: Record<string, number> = { 'ano-training': 1300, 'ano-harbor-escort': 1300, 'ano-abandoned-platform': 1800 }
    const me = createFoeSpecs(card('ano-training'), balB)[0]! // 占位玩家单位（本函数不读 me）
    for (const [id, expectM] of Object.entries(want)) {
      const foes = createFoeSpecs(card(id), balB)
      expect(foes[0]!.foeDesireRangeM).toBe(expectM)
      expect(foeDesiredRange(me, foes, balB)).toBe(expectM)
      // 取值必须落在自己的射程带内（"想站在自己打不到的地方"= 双方 0 开火的成因）
      const w = foes[0]!.weapons[0]!
      expect(expectM).toBeGreaterThanOrEqual(w.minRangeM)
      expect(expectM).toBeLessThanOrEqual(w.maxRangeM)
    }
    // 未写该字段的卡（A 族）保持旧全局表口径 —— 这里用 A 族一张卡做反向断言：
    // brawl 旧表 = min 0 + 0.2×(2200−0) = **440 m**（本批对它零影响）
    const pirate = ANOMALIES.find((a) => a.id === 'ano-pirate-post')!
    const pFoes = createFoeSpecs(pirate, balB)
    expect(pFoes[0]!.foeDesireRangeM).toBeUndefined()
    expect(foeDesiredRange(me, pFoes, balB)).toBe(440)
  })

  it('窝点退出（裁决 8）：B 族两卡不再是窝点候选，专属件池保持空表', () => {
    const a1 = card('ano-abandoned-platform')
    const a2 = card('ano-harbor-escort')
    expect(a1.lairCore).toBeUndefined()
    expect(a2.lairCore).toBeUndefined()
    expect(isLairCandidate(a1)).toBe(false)
    expect(isLairCandidate(a2)).toBe(false)
    expect(FOE_LAIR_GEAR.B).toEqual([])
  })
})
