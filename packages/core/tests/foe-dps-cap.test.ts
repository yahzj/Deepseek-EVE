/**
 * **敌血量钳制解除 + 敌舰体火力上限**（均出自 2026-09-12 船长裁定）。
 *
 * 起因（完整证据链）：讨论「威胁」与「赏金」时发现——
 * 1. `foeHpOfThreat` 的 `t = min(1, …)` 把**敌血钳在威胁 96**（威胁 100/150/300 血量一律 1152）；
 * 2. 而**敌火力 `威胁 × foeDpsPerThreat` 线性不封顶** ⇒ 抬威胁只会得到"更脆更毒"的敌人；
 * 3. 船长两条裁定：**解除血量钳制**（改为血量随威胁继续增长）＋**火力改为 DPS 上限**（先定 **150**）。
 *
 * 本文件锁住六件事：
 * ① **零行为变化**：现 27 张卡威胁 ≤ 96 ⇒ 血量与建档**逐字不变**，且无一越火力上限；
 * ② **解除钳制生效**：威胁 > 96 时血量继续增长（不再冻结在 1152）；
 * ③ **整卡火力封顶**：越线时全卡**舰体总 DPS** 钳到上限，且各条目**等比例**缩放；
 * ④ **机群不吃火力钳制**（机群另有受击增程 / 备用机库 / A5 守恒，且船长已裁定不吃多舰补偿）；
 * ⑤ **`foeDpsCap` 缺省/0 ⇒ 完全不钳制**（零行为变化开关）；
 * ⑥ **速度与射程成长的钳制保留**（避免敌人"又快又远又硬"）。
 */
import { describe, expect, it } from 'vitest'
import { ANOMALIES } from '@whale/data'
import { createFoeSpecs, foeHpOfThreat } from '../src/combat'
import type { AnomalyDef, FoeShipDef } from '../src/types'
import { anomaly, makeTestCtx } from './helpers'

const ctx = makeTestCtx()
const bal = ctx.balance.battle
const CAP = bal.foeDpsCap

/** 测试舰级：单发 100 / 装填 4000ms ⇒ 单艘 25 DPS（`as unknown as` 是因为测试夹具只填本用例关心的字段） */
const GUNSHIP = {
  id: 't-cap-gunship',
  name: '测试炮舰',
  hullClassTier: 2,
  hp: 1000,
  split: { s: 0.3, a: 0.3, h: 0.4 },
  resists: {},
  shotDmg: 100,
  reloadMs: 4000,
  hitRate: 0.85,
  falloff: 0.5,
  rangeMinM: 1000,
  rangeMaxM: 6000,
  dmgMix: { kinetic: 8, explosive: 2 },
  tactic: 'orbit',
  speedRatio: 1,
} as unknown as FoeShipDef

/** 只取**舰体**武器（排除机群条目）的单发列表 */
function hullShots(a: AnomalyDef, balance = bal): number[] {
  const specs = createFoeSpecs(a, balance, { units: a.waves?.[0]?.units ?? 1, hpShare: a.waves?.[0]?.hpShare ?? 1 }) as unknown as Array<{ weapons?: ReadonlyArray<{ shotDmg?: number; reloadMs?: number; src?: string }> }>
  const out: number[] = []
  for (const sp of specs) for (const w of sp.weapons ?? []) if (w.src !== 'drone' && w.shotDmg) out.push(w.shotDmg)
  return out
}

/**
 * 造一张**舰级路径**测试卡。
 * ⚠ 测试 helper `anomaly()` **不接受 `ships`**（它只覆盖 threat/waves/escorts 等）——
 * 直接用 `{ ...anomaly(...), ships }` 会把 `ships` 丢掉、静默走回旧威胁推导路径
 * （本文件第一版就是这么错的：三张卡全建档成"环绕护航舰 23.25 DPS"）。故这里显式断言。
 */
function shipCard(
  id: string,
  ships: NonNullable<AnomalyDef['ships']>,
  opts?: { threat?: number },
): AnomalyDef {
  const card: AnomalyDef = {
    ...anomaly(id, 'gal-cap', { threat: opts?.threat ?? 40 }),
    ships,
  }
  if (!card.ships || card.ships.length !== ships.length) {
    throw new Error(`测试夹具失效：${id} 的 ships 没挂上（会静默走旧路径）`)
  }
  return card
}

/** 舰体总 DPS（含多舰补偿，逐条取整后求和） */
function hullDps(a: AnomalyDef, balance = bal): number {
  const specs = createFoeSpecs(a, balance, { units: a.waves?.[0]?.units ?? 1, hpShare: a.waves?.[0]?.hpShare ?? 1 }) as unknown as Array<{ weapons?: ReadonlyArray<{ shotDmg?: number; reloadMs?: number; src?: string }> }>
  let d = 0
  for (const sp of specs) for (const w of sp.weapons ?? []) {
    if (w.src === 'drone' || !w.shotDmg) continue
    d += (w.shotDmg * 1000) / Math.max(1, w.reloadMs ?? 4000)
  }
  return d
}

describe('敌血量钳制解除（船长 2026-09-12「解除血量钳制，改为火力限制」）', () => {
  it('威胁 ≤ 96 逐字不变（现 27 张卡零行为变化）', () => {
    // t ≤ 1 时 min(1,…) 本就不生效 ⇒ 去钳制前后同值。
    // ⚠ 口径：`foeHpOfThreat = 参考火力 f(威胁) × D(T)`，其中 **f 随威胁分段**
    //   （`foeRefFire`：≤16 → 2.1 · ≤40 → 9.7 · 其余 → 12.8），D(T) = 5 + 85×t^1.6。
    //   故威胁 6 = 2.1×5 = 10.5 → **11**（与校准矩阵"6:11"一致）；威胁 96 = 12.8×90 = 1152。
    expect(foeHpOfThreat(6, bal)).toBe(11)
    expect(foeHpOfThreat(20, bal)).toBe(90)
    expect(foeHpOfThreat(45, bal)).toBe(349)
    expect(foeHpOfThreat(66, bal)).toBe(633)
    expect(foeHpOfThreat(88, bal)).toBe(1001)
    expect(foeHpOfThreat(96, bal)).toBe(1152)
  })

  it('威胁 > 96 血量继续增长（旧口径一律冻结在 1152）', () => {
    const at96 = foeHpOfThreat(96, bal)
    const at120 = foeHpOfThreat(120, bal)
    const at192 = foeHpOfThreat(192, bal)
    expect(at96).toBe(1152)
    expect(at120).toBeGreaterThan(at96)
    expect(at192).toBeGreaterThan(at120)
    // 真值（威胁 > 40 ⇒ f = 12.8；t = (T−6)/90；D = 5 + 85×t^1.6；敌血 = round(f×D)）：
    //   T=120 → t=1.2667 → D=129.07 → **1652**（旧口径冻结在 1152）
    //   T=192 → t=2.0667 → D=276.55 → **3540**
    expect(at120).toBe(1652)
    expect(at192).toBe(3540)
  })

  it('受益面 = 威胁 > 96 的卡（将来的战列舰/旗舰级），不是窝点派生档', () => {
    // ⚠ 口径澄清（实测）：**窝点派生卡不走这条曲线**——它们用"基础卡血量 × 派生比例"
    //   （`lairs.ts` 的 hpMul/dmgMul 同乘 scale），所以派生档的血量来自**基础卡**的曲线值。
    //   本裁定的实际受益面 = 今后写 threat > 96 的**新卡**：它们不再被冻结在 1152。
    //   （旧路径 `createFoeSpecs` 也会受益，但现表 27 张卡已全部迁入舰级路径。）
    const cards = ANOMALIES.filter((a) => typeof a.threat === 'number')
    expect(Math.max(...cards.map((a) => a.threat))).toBe(96)
    // 派生档仍以基础卡（≤96）的曲线值为基准 ⇒ 基础卡零变化就保证了派生档零变化
    expect(foeHpOfThreat(96, bal)).toBe(1152)
  })

  it('速度与射程成长的钳制保留（只有血量去钳）', () => {
    // 速度的 `min(1, …)` 仍在 `foeRefSpeedMps` 里 ⇒ 威胁 200 与 96 的参考速度相同
    const cards = ANOMALIES.filter((a) => typeof a.threat === 'number')
    expect(cards.length).toBe(27)
    // 现表无卡 > 96 ⇒ 速度口径不受本次改动影响（守卫：全表威胁上界）
    expect(Math.max(...cards.map((a) => a.threat))).toBe(96)
  })
})

describe('敌舰体火力上限（船长 2026-09-12「按照 DPS 上限 150 算」）', () => {
  it('现值为 150，且现有全表卡无一越线（零行为变化）', () => {
    expect(CAP).toBe(150)
    const cards = ANOMALIES.filter((a) => typeof a.threat === 'number')
    expect(cards.length).toBe(27)
    const over = cards.filter((a) => hullDps(a) > CAP!)
    expect(over.map((a) => `${a.name}=${hullDps(a).toFixed(2)}`)).toEqual([])
    // 实测最高 = 虚海守望者 131.25（留出余量的同时，将来多单位高威胁卡会先撞上限）
    const max = Math.max(...cards.map((a) => hullDps(a)))
    expect(max).toBeGreaterThan(130)
    expect(max).toBeLessThan(CAP!)
  })

  it('越线时整卡钳到上限，且各条目等比例缩放', () => {
    // 2 艘 × 单发 100 / 装填 4s，补偿 4/3 ⇒ round(133.33)=133 ⇒ 33.25 DPS/艘 ⇒ 合计 66.5（未越线）
    const base = shipCard('ano-cap-base', [{ ship: GUNSHIP, count: 2 }])
    expect(hullDps(base)).toBeCloseTo(66.5, 6)
    // 放大 8 倍单发 ⇒ 不钳制应 = 2 × round(100×8×4/3) / 4 = 2 × 1067 / 4 = 533.5 DPS
    const boosted = shipCard('ano-cap-boosted', [{ ship: GUNSHIP, count: 2, dmgMul: 8 }])
    const uncapped = hullDps(boosted, { ...bal, foeDpsCap: undefined })
    expect(uncapped).toBeGreaterThan(CAP! * 3)
    // 钳制后 = 150，且两艘同值（等比例）
    expect(hullDps(boosted)).toBeCloseTo(CAP!, 6)
    const shots = hullShots(boosted)
    expect(shots).toHaveLength(2)
    expect(shots[0]).toBe(shots[1])
    // 补偿 2N/(N+1) = 4/3 ⇒ 单发 = round(100×8×(4/3)×scale)，scale = 150/uncapped
    const comp = 4 / 3
    expect(shots[0]).toBe(Math.max(1, Math.round(100 * 8 * comp * (CAP! / uncapped))))
  })

  it('foeDpsCap 缺省或 0 ⇒ 完全不钳制（零行为变化开关）', () => {
    const boosted = shipCard('ano-cap-off', [{ ship: GUNSHIP, count: 2, dmgMul: 8 }])
    expect(hullDps(boosted, { ...bal, foeDpsCap: undefined })).toBeCloseTo(533.5, 6)
    expect(hullDps(boosted, { ...bal, foeDpsCap: 0 })).toBeCloseTo(533.5, 6)
  })

  it('机群不吃钳制：挂了机群的卡只钳舰体，机群单发逐字不变', () => {
    const withDrones: FoeShipDef = {
      ...GUNSHIP,
      id: 't-cap-dronecarrier',
      shotDmg: 200,
      drones: [{ drone: { id: 't-cap-drone', name: '测试机', damageType: 'kinetic', dmg: 50, hitRate: 0.65, falloff: 1, maxRangeM: 5000, reloadMs: 4400, unitM3: 5, hp: { s: 10, a: 10, h: 10 } }, count: 4 }],
    } as unknown as FoeShipDef
    const card = shipCard('ano-cap-drone', [{ ship: withDrones, count: 4, dmgMul: 6 }])
    const specs = createFoeSpecs(card, bal, { units: 1, hpShare: 1 }) as unknown as Array<{ weapons?: ReadonlyArray<{ shotDmg?: number; reloadMs?: number; src?: string }> }>
    let hull = 0
    let drone = 0
    for (const sp of specs) for (const w of sp.weapons ?? []) {
      const d = ((w.shotDmg ?? 0) * 1000) / Math.max(1, w.reloadMs ?? 4000)
      if (w.src === 'drone') drone += d
      else hull += d
    }
    // 舰体被钳到上限；机群按原式逐字不变、不受钳制影响。
    // ⚠ 架数口径：`count: 4` 的条目会展开成 **4 个运载单位 × 每单位 4 架 = 16 架**
    //   ⇒ 机群单发 50 × `dmgMul` 6 = 300，16 架 ÷ 4.4s = 1090.91 DPS（不受 150 上限约束）
    expect(hull).toBeCloseTo(CAP!, 6)
    expect(drone).toBeGreaterThan(CAP!)
    expect(drone).toBeCloseTo((50 * 6 * 16 * 1000) / 4400, 6)
  })

  it('多舰补偿参与上限计算：N 越大，同一单发越早触顶', () => {
    // 4 艘 × 补偿 1.6 ⇒ 单发 round(100×1.6)=160 ⇒ 40 DPS/艘 ⇒ 合计 160 > 150 ⇒ 被钳到 150
    const four = shipCard('ano-cap-four', [{ ship: GUNSHIP, count: 4 }])
    expect(hullDps(four, { ...bal, foeDpsCap: undefined })).toBeCloseTo(160, 6)
    expect(hullDps(four)).toBeCloseTo(CAP!, 6)
    // 1 艘（补偿 1）⇒ 25 DPS，远未触顶
    const one = shipCard('ano-cap-one', [{ ship: GUNSHIP, count: 1 }])
    expect(hullDps(one)).toBeCloseTo(25, 6)
  })
})
