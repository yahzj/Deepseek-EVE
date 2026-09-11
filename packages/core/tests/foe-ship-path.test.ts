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
 *    旧威胁推导路径**不启用**（N=1 天然为 1）；单发 = `round(舰级单发 × dmgMul × 补偿)`；
 * ⑧ **血型随卡走**（2026-09-11 船长裁决①）：有效 split = 条目 `split` 覆写 ?? 舰级 split；
 * ⑨ **头目射程多重方案**（同日裁决③）：打不到的头目按「同卡同带」写射程覆写，让 60% 火力真落地。
 */
import { describe, expect, it } from 'vitest'
import { ANOMALIES, FOE_SHIPS } from '@whale/data'
import { createFoeSpecs, FOE_ELITE_WORD, FOE_LIGHT_WORD, foeDesiredRange, foeLayerSplit, foeUnitNameOf } from '../src/combat'
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
describe('舰种档与速度倍率（A 族提速 / B 族偏慢）', () => {
  it('实速 = 舰种基准 × 倍率：A 族 391/374/325/374、B 族 306/271', () => {
    const shell = anomaly('ano-t-hull-speed', 'galaxy-hub', { threat: 20 })
    const got = FOE_SHIPS.map((ship) => ({
      id: ship.id,
      tier: ship.hullClassTier,
      speed: createFoeSpecs({ ...shell, ships: [{ ship }] }, bal)[0]!.speedMps,
    }))
    expect(got).toEqual([
      { id: 'foe-pirate-skiff', tier: 1, speed: 391 },
      { id: 'foe-pirate-corvette', tier: 1, speed: 374 },
      { id: 'foe-pirate-sniper', tier: 2, speed: 325 },
      { id: 'foe-pirate-warlord', tier: 3, speed: 374 },
      // B 族（武装拾荒者）：船长 2026-09-11「**速度偏慢**」⇒ `speedRatio = 0.90 / 0.92`
      // （⚠ 追加的「**按 0.8 走**」口径按上级裁示**未执行**，最终值由三号定）
      { id: 'foe-scav-skiff', tier: 1, speed: 306 },
      { id: 'foe-scav-armed', tier: 2, speed: 271 },
    ])
  })

  it('A 族每档实速都**高于本档舰种基准**（护卫 340 / 驱逐 295 / 巡洋 258）——船长「速度都快」', () => {
    const shell = anomaly('ano-t-hull-overshoot', 'galaxy-hub', { threat: 20 })
    const pirates = FOE_SHIPS.filter((s) => s.family === 'A')
    expect(pirates).toHaveLength(4)
    for (const ship of pirates) {
      expect(ship.speedRatio).toBeGreaterThan(1) // 倍率 > 1 ⇔ 快于本档基准
      const spd = createFoeSpecs({ ...shell, ships: [{ ship }] }, bal)[0]!.speedMps
      expect(spd).toBeGreaterThan(bal.hullClassBaseSpeedMps[ship.hullClassTier])
    }
  })

  it('B 族（武装拾荒者）每档实速都**低于**本档舰种基准——船长「速度偏慢」＋新手过渡族', () => {
    const shell = anomaly('ano-t-hull-undershoot', 'galaxy-hub', { threat: 20 })
    const scavs = FOE_SHIPS.filter((s) => s.family === 'B')
    expect(scavs).toHaveLength(2) // 拾荒武装艇 T1 / 拾荒火力舰 T2
    for (const ship of scavs) {
      expect(ship.speedRatio).toBeLessThan(1) // 倍率 < 1 ⇔ 慢于本档基准
      expect(ship.hullClassTier).toBeLessThan(3) // 新手过渡族不配 T3 及以上
      const spd = createFoeSpecs({ ...shell, ships: [{ ship }] }, bal)[0]!.speedMps
      expect(spd).toBeLessThan(bal.hullClassBaseSpeedMps[ship.hullClassTier])
      expect(spd).toBeGreaterThan(0)
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
 * 裁决修法 = **锚回「改造前的实际火力」，改用卡上 `dmgMul` 重锚**（**禁止恢复 `foeDmgMul`**）；
 * 纸面锚点经二次裁决**由 ×1.6 下调为 ×1.2**（**难度守恒按「实收」判定**：4 单位 ⇒ 实收 ≈ 纸面 ×0.625，
 * 而这两张卡改动前只有 2 单位（衰减 ×0.75）⇒ 要"实收 ≈ 改动前"须纸面 ×`0.75/0.625` = ×1.2）：
 * - 赤潮：目标 7.25 × 1.2 = **8.70** → 重锚单发 头目 **21** / 每杂鱼 **5**（Σ 36 → 纸面 **9.00**，取整 +3.4%）
 * - 蜃影：目标 11.50 × 1.2 = **13.80** → 重锚单发 头目 **33** / 每杂鱼 **7**（Σ 54 → 纸面 **13.50**，取整 −2.2%）
 *
 * 本守卫锁死"重锚后的卡上设计单发 + 纸面火力 ≈ 旧实伤 ×1.2"（±5%，含整数取整）。
 * ⚠ 已知偏差（**待船长裁决，不在本批解决**）：kite 卡的头目射程带是近战档（≤2.21 km），
 * 而已按船长裁决③给四张卡写了"同卡同带"覆写（见下个 describe）。
 */
describe('赤潮 / 蜃影 火力重锚（船长 2026-09-11 裁决：按实际算 + 纸面锚 ×1.2）', () => {
  /** 真卡建档（用与生产同源的 DEFAULT_BALANCE，非测试假平衡） */
  const realCard = (id: string): AnomalyDef => ANOMALIES.find((a) => a.id === id)!
  /** 纸面期望火力 = Σ单位「单发 × 有效命中 ÷ 装填秒」（光束 hitRate = 1，与引擎建档同源） */
  const paperDps = (id: string): number =>
    createFoeSpecs(realCard(id), bal).reduce((n, u) => {
      const w = u.weapons[0]!
      return n + ((w.shotDmg ?? 0) * w.hitRate) / (w.reloadMs / 1000)
    }, 0)
  const shots = (id: string): number[] => createFoeSpecs(realCard(id), bal).map((u) => u.weapons[0]!.shotDmg ?? 0)

  it('赤潮劫掠舰队（T34）：重锚单发 头目 21 / 杂鱼 5，纸面火力 ≈ 旧实伤 7.25 × 1.2', () => {
    expect(shots('ano-redring-raiders')).toEqual([21, 5, 5, 5])
    const dps = paperDps('ano-redring-raiders')
    expect(dps).toBeCloseTo(9, 6) // Σ36 ÷ 4s
    expect(dps / 7.25).toBeGreaterThan(1.1) // ≈ ×1.24（目标 ×1.2，取整 +3.4%）
    expect(dps / 7.25).toBeLessThan(1.3)
    expect(realCard('ano-redring-raiders').threat).toBe(34)
  })

  it('蜃影导航劫持令（T48）：重锚单发 头目 33 / 杂鱼 7，纸面火力 ≈ 旧实伤 11.50 × 1.2', () => {
    expect(shots('ano-mirage-hijackers')).toEqual([33, 7, 7, 7])
    const dps = paperDps('ano-mirage-hijackers')
    expect(dps).toBeCloseTo(13.5, 6) // Σ54 ÷ 4s
    expect(dps / 11.5).toBeGreaterThan(1.1) // ≈ ×1.17（目标 ×1.2，取整 −2.2%）
    expect(dps / 11.5).toBeLessThan(1.3)
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
      // `foeDmgMul` 字段不存在（类型上已删除）——这里锁"卡上没有任何逐卡伤害倍率口"
      expect(Object.keys(card)).not.toContain('foeDmgMul')
      expect(Object.keys(card.ships![0]!)).not.toContain('foeDmgMul')
    }
  })
})

/**
 * **血型随卡走 + 头目射程多重方案**（船长 2026-09-11 裁决①③）。
 *
 * ① 「**头目血型随卡片走**」：条目 `split` 覆写生效（有效 split = 覆写 ?? 舰级）——
 *   头目舰本体是装甲型，故**卡面非装甲的四张**（信标 均衡 / 灰霾·赤潮·蜃影 护盾）在头目条目上覆写，
 *   使**每一条主体的有效血型都等于卡面 `defProfile`**。**A 族不做族级血型约束**（鱼龙混杂 ⇒ 什么血型都有）。
 * ③ 「头目可以多种战术选择，因此**射程方案也是多重**」：探针实测六张卡的**头目原先一次都不开火**
 *   （射程带 1~2210m vs 实战交战距离 3.2~3.8km）⇒ **打不到的头目按「同卡同带」写射程覆写**
 *   （= 本卡杂鱼条目的有效射程带），让那 60% 的火力真正落地。
 */
describe('血型随卡走 + 头目射程多重方案（船长 2026-09-11 裁决①③）', () => {
  const CARD_IDS = [
    'ano-pirate-post',
    'ano-shard-bandits',
    'ano-lantern-saboteurs',
    'ano-haze-ambush',
    'ano-redring-raiders',
    'ano-mirage-hijackers',
  ] as const
  const realCard = (id: string): AnomalyDef => ANOMALIES.find((a) => a.id === id)!

  it('条目 `split` 覆写生效；缺省仍走舰级 split', () => {
    const def: AnomalyDef = {
      ...anomaly('ano-t-split', 'galaxy-hub', { threat: 20 }),
      ships: [{ ship: SKIFF, split: { s: 0.5, a: 0.25, h: 0.25 } }, { ship: SKIFF }],
    }
    const specs = createFoeSpecs(def, bal)
    const frac = (u: (typeof specs)[number]) => {
      const t = u.hp.s + u.hp.a + u.hp.h
      return { s: u.hp.s / t, a: u.hp.a / t, h: u.hp.h / t }
    }
    expect(frac(specs[0]!).s).toBeCloseTo(0.5, 9) // 条目覆写
    expect(frac(specs[1]!).s).toBeCloseTo(SKIFF.split.s, 9) // 缺省 = 舰级
  })

  it('六张真卡：**每一条**主体的有效血型都等于卡面 `defProfile`（头目也随卡走）', () => {
    let checked = 0
    for (const id of CARD_IDS) {
      const card = realCard(id)
      const want = foeLayerSplit(card.defProfile!)
      for (const [i, u] of createFoeSpecs(card, bal).entries()) {
        const t = u.hp.s + u.hp.a + u.hp.h
        expect({ tag: u.tag, s: Number((u.hp.s / t).toFixed(9)) }).toEqual({
          tag: u.tag,
          s: Number(want.s.toFixed(9)),
        })
        expect(t).toBeGreaterThan(0)
        i // 逐单位
        checked++
      }
    }
    expect(checked).toBe(24) // 六张卡 × 4 单位
  })

  it('头目血型确实被覆写：卡面非装甲的四张写了 `split`，装甲两张沿用舰级', () => {
    const armorFace = ['ano-pirate-post', 'ano-shard-bandits']
    for (const id of CARD_IDS) {
      const boss = realCard(id).ships![0]!
      if (armorFace.includes(id)) expect(boss.split).toBeUndefined() // 头目舰本体就是装甲型 → 无需覆写
      else expect(boss.split).toEqual(foeLayerSplit(realCard(id).defProfile!))
    }
  })

  it('打不到的头目：四张（信标/灰霾/赤潮/蜃影）射程覆写 = 本卡杂鱼的有效射程带', () => {
    // 逐卡核对：覆写的两端必须与该卡**杂鱼条目建出的射程带**逐字相同（同卡同带）
    for (const id of ['ano-lantern-saboteurs', 'ano-haze-ambush', 'ano-redring-raiders', 'ano-mirage-hijackers']) {
      const card = realCard(id)
      const specs = createFoeSpecs(card, bal)
      const bossW = specs[0]!.weapons[0]!
      const minionW = specs[1]!.weapons[0]!
      expect({ min: bossW.minRangeM, max: bossW.maxRangeM }).toEqual({ min: minionW.minRangeM, max: minionW.maxRangeM })
      expect(bossW.maxRangeM).toBeGreaterThan(2210) // 已离开头目舰本体的近战带（1~2210m）
    }
    // 近战两张（边境/碎晶）：不写覆写（写了只会**缩小**头目射程，而它们打不到的原因是整个编队没进入接触窗口）
    for (const id of ['ano-pirate-post', 'ano-shard-bandits']) {
      const boss = realCard(id).ships![0]!
      expect(boss.rangeMinM).toBeUndefined()
      expect(boss.rangeMaxM).toBeUndefined()
      expect(createFoeSpecs(realCard(id), bal)[0]!.weapons[0]!.maxRangeM).toBe(FOE_SHIPS[3]!.rangeMaxM) // 仍走舰级
    }
  })
})

/**
 * 期望交距口径（**2026-09-11 船长裁决②**：「舰级路径的期望交距改取该单位自己的射程带，
 * 战术只决定带内的偏好位置」）。
 *
 * 三条守卫：
 * ① **旧路径一字不动**——无 `ships` 的卡仍用全局战术表（brawl 440 / orbit 2688 / kite 8000）；
 * ② **舰级路径用自己的带**——同一条舰级换个射程覆写，期望交距随之改变（覆写=纠偏旋钮）；
 * ③ **期望交距必落在自身射程带内**——全 9 张舰级路径卡逐卡实算（含 4 张 kite 卡的"同卡同带"覆写）。
 */
describe('期望交距（舰级路径取自身射程带 · 2026-09-11 船长裁决②）', () => {
  const bandOf = (u: { weapons: { minRangeM: number; maxRangeM: number }[] }): { min: number; max: number } => ({
    min: u.weapons[0]!.minRangeM,
    max: u.weapons[0]!.maxRangeM,
  })

  it('旧路径一字不动：brawl 440m / orbit 2688m / kite 8000m（全局战术表口径）', () => {
    const want: Array<[string, number]> = [
      ['brawl', 440],
      ['orbit', 2688],
      ['kite', 8000],
    ]
    for (const [tactic, desire] of want) {
      const shell = anomaly(`ano-t-desire-${tactic}`, 'galaxy-hub', { threat: 20 })
      const specs = createFoeSpecs({ ...shell, tactic: tactic as 'brawl' | 'orbit' | 'kite' }, bal)
      expect(specs[0]!.foeRangeBand, '旧路径不得携带 foeRangeBand').toBeUndefined()
      expect(foeDesiredRange(specs[0]!, specs, bal)).toBe(desire)
    }
  })

  it('舰级路径：期望交距 = 自身射程带的带内偏好位置（不再取全局表）', () => {
    // SKIFF = 1~2200m、战术 brawl（factor 0.20）⇒ 1 + 0.20×(2200−1) = 441
    const shell = anomaly('ano-t-desire-ship', 'galaxy-hub', { threat: 20, tactic: 'brawl' })
    const specs = createFoeSpecs({ ...shell, ships: [{ ship: SKIFF }] }, bal)
    expect(specs[0]!.foeRangeBand).toEqual({ min: 1, max: 2200 })
    expect(foeDesiredRange(specs[0]!, specs, bal)).toBe(441)
    // 同一条舰级换 orbit 覆写（factor 0.55）⇒ 仍按**自己的带** = 1 + 0.55×2199 = 1210（旧口径会算 2688）
    const orb = createFoeSpecs({ ...shell, tactic: 'orbit', ships: [{ ship: SKIFF, tactic: 'orbit' }] }, bal)
    expect(foeDesiredRange(orb[0]!, orb, bal)).toBe(1210)
    expect(foeDesiredRange(orb[0]!, orb, bal)).not.toBe(2688)
  })

  it('射程覆写 = 纠偏旋钮：条目 rangeMinM/rangeMaxM 改写带 ⇒ 期望交距随之（"同卡同带"）', () => {
    const shell = anomaly('ano-t-desire-ovr', 'galaxy-hub', { threat: 20, tactic: 'kite' })
    const specs = createFoeSpecs(
      // 条目同时覆写**射程带**与**战术**（舰级路径的战术取自"条目 ?? 舰级"，不是卡面）
      { ...shell, ships: [{ ship: SKIFF, tactic: 'kite', rangeMinM: 1000, rangeMaxM: 4000 }] },
      bal,
    )
    // 1000 + 0.85×(4000−1000) = 3550（旧口径 = 全局 kite 表 8000；且注意"带"来自覆写而非舰级 1~2200）
    expect(foeDesiredRange(specs[0]!, specs, bal)).toBe(3550)
    expect(foeDesiredRange(specs[0]!, specs, bal)).not.toBe(8000)
  })

  it('全 9 张舰级路径卡：期望交距必须落在**自身射程带内**（否则敌人站在自己打不到的位置）', () => {
    let checked = 0
    for (const def of ANOMALIES) {
      if (!def.ships || def.ships.length === 0) continue
      checked++
      const specs = createFoeSpecs(def, bal)
      const band = bandOf(specs[0]!)
      const desire = foeDesiredRange(specs[0]!, specs, bal)
      expect(desire, `${def.id} 的期望交距 ${desire}m 落在自身射程带 ${band.min}~${band.max}m 之外`).toBeGreaterThanOrEqual(band.min)
      expect(desire, `${def.id} 的期望交距 ${desire}m 落在自身射程带 ${band.min}~${band.max}m 之外`).toBeLessThanOrEqual(band.max)
    }
    expect(checked).toBe(9) // A 族 6 + B 族 3
  })
})
