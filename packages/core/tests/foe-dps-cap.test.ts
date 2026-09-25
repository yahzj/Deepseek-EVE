/**
 * **敌血量钳制解除 ＋ 敌舰体火力「越线折扣」**（前者出自 2026-09-12 船长裁定；
 * 后者 2026-09-12 立项「按照 DPS 上限 150 算」，**2026-09-15 船长改判为折扣制**）。
 *
 * 起因（完整证据链）：
 * 1. `foeHpOfThreat` 的 `t = min(1, …)` 把**敌血钳在威胁 96**（威胁 100/150/300 血量一律 1152）；
 * 2. 而**敌火力 `威胁 × foeDpsPerThreat` 线性不封顶** ⇒ 抬威胁只会得到"更脆更毒"的敌人；
 * 3. 船长两条裁定：**解除血量钳制**（血量随威胁继续增长）＋ **给敌舰体火力设 150 的阈值**。
 *
 * 本文件锁住七件事：
 * ① **曲线逐点锁定**：威胁 6/20/45/66/88/96 的曲线取值不变（2026-09-25 重定标只改**卡面威胁**、
 *    **不动曲线**；洞外 23 张常驻悬赏按「单舰 ×3」定价式重定标 ⇒ 最大威胁由 96 抬到 **115**）；
 * ② **解除钳制生效**：威胁 > 96 时血量继续增长（不再冻结在 1152）；
 * ③ **越线折扣（机制）**：`D > 阈值` 时目标 `D′ = 阈值 + (D − 阈值) × (1 − 折扣率)`，
 *    全卡舰体单发**等比例**缩放 ⇒ **不封顶**（`D → ∞` 时 `D′ ≈ 0.85 D`，斜率由 1 降为 0.85）；
 * ④ **机群不吃折扣**（机群另有受击增程 / 备用机库 / A5 守恒，且船长已裁定不吃多舰补偿）；
 * ⑤ **双旋钮开关**：`foeDpsCap` 或 `foeDpsOverCapDiscount` **任一未写 / 0 ⇒ 完全不缩放**
 *    （⚠ 折扣率 0 **不会**退回 2026-09-12 的旧硬钳制语义）；
 * ⑥ **速度与射程成长的钳制保留**（避免敌人"又快又远又硬"）；
 * ⑦ **现行配置 = 开**（150 / 0.15，**洞外与虫洞一律生效**——船长 2026-09-15「是，都生效」）。
 *
 * ⚠ **口径沿革（旧断言作废登记）**：2026-09-12 首落为**硬钳制**（越线一律压到 150：穹顶派生
 * 1/2/3 档 164.9 / 203.1 / 253.2、虚海 1/2 档 170.0 / 210.3 ⇒ 全压到 150，−9%~−41%），
 * 同日按船长「回退到赏金维持现有配置…并且火力钳制也暂时关闭」置 0；**2026-09-15 船长两条指示**
 * （「超过150的火力，按比例衰减」→「**不是钳制到150，而是超过150的部分进行一个约15%的折扣**」
 * ＋「**是，都生效**」）⇒ 改为折扣制并写回 150。旧"越线 = 压到上限"的断言已全部改写为折扣式。
 *
 * 现行读数（实测 · 探针 `tools/_dps-cap-audit.ts`）：**洞外 27 张基础卡全部未越线**
 * （最高 = 虚海守望者 131.3）⇒ 零变化；越线的是**窝点派生档**（穹顶 164.8/203.1/253.2 ·
 * 虚海 170.3/210.0 · 噬口 172.3/215.5 ⇒ 折扣后 ≈162.7/195.2/237.8 · 167.3/201.0 · 169.3/205.5）
 * **与虫洞派生**（层 1 起陆续越线；深层 node 最高 1,234.5 → 1,071.8、boss 1,665.8 → 1,438.5）。
 */
import { describe, expect, it } from 'vitest'
import { ANOMALIES } from '@whale/data'
import { createFoeSpecs, foeHpOfThreat } from '../src/combat'
import { LAIR_THREAT_MUL, lairAnomalyOf, lairLevelOf } from '../src/lairs'
import type { AnomalyDef, FoeShipDef } from '../src/types'
import { anomaly, makeTestCtx } from './helpers'

const ctx = makeTestCtx()
const bal = ctx.balance.battle
/** 现行配置（2026-09-15 起 = 150 阈值 ＋ 0.15 折扣率 = 开启） */
const CAP = bal.foeDpsCap
const DISC = bal.foeDpsOverCapDiscount
/** 关闭态（零行为变化）：阈值 0 / 折扣率 0 / 两者都不写，读数应完全一致 */
const OFF_CAP = { ...bal, foeDpsCap: 0 }
const OFF_DISC = { ...bal, foeDpsOverCapDiscount: 0 }
const OFF_BOTH = { ...bal, foeDpsCap: undefined, foeDpsOverCapDiscount: undefined }

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

/** 折扣后的解析目标总 DPS（取整前的理想值）：`阈值 + (D − 阈值) × (1 − 折扣率)` */
function overCapTarget(d: number, cap = 150, disc = 0.15): number {
  return d <= cap ? d : cap + (d - cap) * (1 - disc)
}

/**
 * **单波**舰体总 DPS（`tagPrefix` 选波）——引擎的判线口径是**逐波独立建档**
 * （`foeDpsCapScaleOf` 每次 `createFoeSpecsFromShips` 只看得到**本波**单位），
 * 故多波卡（如噬口猎杀令：头目在第 3 波）必须按波分别算，不能用波 0 代表全卡。
 */
function waveDps(a: AnomalyDef, balance = bal, wave = 0): number {
  const specs = createFoeSpecs(a, balance, { tagPrefix: wave === 0 ? '' : `w${wave}-` }) as unknown as Array<{ weapons?: ReadonlyArray<{ shotDmg?: number; reloadMs?: number; src?: string }> }>
  let d = 0
  for (const sp of specs) for (const w of sp.weapons ?? []) {
    if (w.src === 'drone' || !w.shotDmg) continue
    d += (w.shotDmg * 1000) / Math.max(1, w.reloadMs ?? 4000)
  }
  return d
}

/** 逐波建档的**最大单波**舰体总 DPS（判线读数；单波卡 == `hullDps()`） */
function maxWaveDps(a: AnomalyDef, balance = bal): number {
  let m = 0
  for (let i = 0; i < Math.max(1, a.waves?.length ?? 1); i++) m = Math.max(m, waveDps(a, balance, i))
  return m
}

describe('敌血量钳制解除（船长 2026-09-12「解除血量钳制，改为火力限制」）', () => {
  it('曲线逐点锁定（威胁 6 / 20 / 45 / 66 / 88 / 96 的取值不变）', () => {
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

  it('受益面 = 威胁 > 96 的卡（重定标后首张 = 巨构核心勘探令 115），不是窝点派生档', () => {
    // ⚠ 口径澄清（实测）：**窝点派生卡不走这条曲线**——它们用"基础卡血量 × 派生比例"
    //   （`lairs.ts` 的 hpMul/dmgMul 同乘 scale），所以派生档的血量来自**基础卡**的曲线值。
    //   本裁定的实际受益面 = 写 threat > 96 的卡：它们不再被冻结在 1152。
    //   （旧路径 `createFoeSpecs` 也会受益，但现表卡已全部迁入舰级路径。）
    // ⚠ 2026-09-25：洞外常驻悬赏按「单舰 ×3」定价式重定标威胁（属性零改动）⇒
    //   **巨构核心勘探令（84 → 115）成为首张越过 96 的现表卡**（有意，非误写）；
    //   同日 H 族三张入侵卡按船长给定的 90 / 108 / 129 重定价 ⇒ 全表上界抬到 **129**（主力舰队）。
    const cards = ANOMALIES.filter((a) => typeof a.threat === 'number')
    expect(Math.max(...cards.map((a) => a.threat))).toBe(129)
    expect(ANOMALIES.find((a) => a.threat === 129)!.id).toBe('ink-main')
    // 派生档仍以基础卡的曲线值为基准 ⇒ 基础卡曲线值零变化就保证了派生档零变化
    expect(foeHpOfThreat(96, bal)).toBe(1152)
  })

  it('速度与射程成长的钳制保留（只有血量去钳）', () => {
    // 速度的 `min(1, …)` 仍在 `foeRefSpeedMps` 里 ⇒ 威胁 200 与 96 的参考速度相同
    // 2026-09-13 虫洞 F 批：+5 张洞内敌卡（wh-*，hidden；威胁锚点 45；含 E 族巨构残响），不抬高本表上限 96）
    // 2026-09-15 洞内敌卡扩充批 1：+2 张（A 族中/深；威胁锚点同为 45）⇒ 表长 32 → 34
    // 2026-09-15 批 2：再 +2 张（C 族中/深）⇒ 表长 36
    // 2026-09-15 批 3：再 +2 张（D 族中/深）⇒ 表长 38
    // 2026-09-15 批 4：再 +2 张（E 族中/深）⇒ 表长 40
    // 2026-09-15 批 5：再 +2 张（G 族中/深）⇒ 表长 42（= 15 张洞内敌卡齐备）
    const cards = ANOMALIES.filter((a) => typeof a.threat === 'number')
    expect(cards.length).toBe(46) // ⚠ 2026-09-24：42 → 44（H 族墨潮帮两张入侵卡）
    // ⚠ 2026-09-25：全表上界 = 129（H 族「墨潮帮主力舰队」，船长给定威胁）；速度/射程曲线本身未被本次改动触碰
    expect(Math.max(...cards.map((a) => a.threat))).toBe(129)
  })
})

describe('敌舰体火力越线折扣（2026-09-12「DPS 上限 150」→ 2026-09-15 船长改判为「超出部分约 15% 折扣」）', () => {
  it('夹具口径：hullDps()（`units = waves[0].units` 建档）== 逐波独立建档的第 0 波实收（不折扣）', () => {
    // ⚠ 这条守卫是为"口径别再造谣"设的：`hullDps()` 遍历全部单位、逐条求和 ⇒ 与真实建造**逐字相同**；
    //   若哪天有人改成"只取第一条"、或引擎的建档口径变了，本用例会立刻红。
    const cards = ANOMALIES.filter((a) => typeof a.threat === 'number')
    expect(cards.length).toBe(46) // ⚠ 2026-09-24：42 → 44（H 族墨潮帮两张入侵卡）
    for (const a of cards) {
      const viaFixture = hullDps(a, OFF_BOTH)
      const specs = createFoeSpecs(a, OFF_BOTH, { tagPrefix: '' }) as unknown as Array<{
        weapons?: ReadonlyArray<{ shotDmg?: number; reloadMs?: number; src?: string }>
      }>
      let viaReal = 0
      for (const sp of specs) for (const w of sp.weapons ?? []) {
        if (w.src === 'drone' || !w.shotDmg) continue
        viaReal += (w.shotDmg * 1000) / Math.max(1, w.reloadMs ?? 4000)
      }
      expect(viaFixture, `${a.name}（${a.id}）夹具与真实建档不一致`).toBeCloseTo(viaReal, 9)
    }
  })

  it('阈值以下零变化：未越线的卡逐字不动（66.5 DPS 不受影响）', () => {
    const base = shipCard('ano-overcap-base', [{ ship: GUNSHIP, count: 2 }])
    expect(hullDps(base, bal)).toBeCloseTo(66.5, 6)
    expect(hullDps(base, bal)).toBeCloseTo(hullDps(base, OFF_BOTH), 9)
  })

  it('越线只对**超出部分**打 85 折（不封顶）：533.5 → 476.0', () => {
    // 2 艘 × 单发 100 / 装填 4s，补偿 4/3 ⇒ round(133.33) = 133；`dmgMul` 8 ⇒
    // 单发 round(100×8×4/3) = 1067 ⇒ 266.75 DPS/艘 ⇒ 合计 **533.5**（未折扣）
    const boosted = shipCard('ano-overcap-boosted', [{ ship: GUNSHIP, count: 2, dmgMul: 8 }])
    const uncapped = hullDps(boosted, OFF_BOTH)
    expect(uncapped).toBeCloseTo(533.5, 6)
    // 解析目标 = 150 + (533.5 − 150) × 0.85 = 475.975；缩放作用在整数单发上 ⇒
    //   round(1067 × 475.975/533.5) = round(952.0) = 952 ⇒ 238 DPS/艘 ⇒ **476.0**
    const d = hullDps(boosted, bal)
    expect(d).toBeCloseTo(476, 6)
    expect(d).toBeCloseTo(overCapTarget(uncapped), 0)
    // **不是封顶**：结果仍高于阈值，且随原值继续增长
    expect(d).toBeGreaterThan(150)
    expect(d).toBeLessThan(uncapped)
    const bigger = shipCard('ano-overcap-boosted2', [{ ship: GUNSHIP, count: 2, dmgMul: 16 }])
    expect(hullDps(bigger, bal)).toBeGreaterThan(d)
  })

  it('等比例缩放：同一条目的多个单位单发相同（相对权重不变）', () => {
    const boosted = shipCard('ano-overcap-ratio', [{ ship: GUNSHIP, count: 2, dmgMul: 8 }])
    const shots = hullShots(boosted, bal)
    expect(shots).toHaveLength(2)
    expect(shots[0]).toBe(shots[1])
    const uncapped = hullDps(boosted, OFF_BOTH)
    const scale = overCapTarget(uncapped) / uncapped
    expect(shots[0]).toBe(Math.max(1, Math.round(100 * 8 * (4 / 3) * scale)))
  })

  it('双旋钮开关：阈值或折扣率任一未写 / 0 ⇒ 完全不缩放（且不退回硬钳制）', () => {
    const boosted = shipCard('ano-overcap-off', [{ ship: GUNSHIP, count: 2, dmgMul: 8 }])
    expect(hullDps(boosted, OFF_BOTH)).toBeCloseTo(533.5, 6)
    expect(hullDps(boosted, OFF_CAP)).toBeCloseTo(533.5, 6)
    expect(hullDps(boosted, OFF_DISC)).toBeCloseTo(533.5, 6)
    // 边界：折扣率 1 = 旧硬钳制语义（压到阈值）；本用例只钉住"它仍在，但已不是现行口径"
    expect(hullDps(boosted, { ...bal, foeDpsOverCapDiscount: 1 })).toBeCloseTo(150, 6)
  })

  it('机群不吃折扣：只折扣舰体，机群单发逐字不变', () => {
    const withDrones: FoeShipDef = {
      ...GUNSHIP,
      id: 't-cap-dronecarrier',
      shotDmg: 200,
      drones: [{ drone: { id: 't-cap-drone', name: '测试机', damageType: 'kinetic', dmg: 50, hitRate: 0.65, falloff: 1, maxRangeM: 5000, reloadMs: 4400, unitM3: 5, hp: { s: 10, a: 10, h: 10 } }, count: 4 }],
    } as unknown as FoeShipDef
    const card = shipCard('ano-overcap-drone', [{ ship: withDrones, count: 4, dmgMul: 6 }])
    const specs = createFoeSpecs(card, bal, { units: 1, hpShare: 1 }) as unknown as Array<{ weapons?: ReadonlyArray<{ shotDmg?: number; reloadMs?: number; src?: string }> }>
    let hull = 0
    let drone = 0
    for (const sp of specs) for (const w of sp.weapons ?? []) {
      const d = ((w.shotDmg ?? 0) * 1000) / Math.max(1, w.reloadMs ?? 4000)
      if (w.src === 'drone') drone += d
      else hull += d
    }
    // 舰体：4 艘 × 补偿 1.6 ⇒ 单发 round(200×6×1.6) = 1920 ⇒ 480 DPS/艘 ⇒ 合计 1920（越线）
    //   ⇒ 目标 = 150 + (1920 − 150) × 0.85 = 1654.5；单发 round(1920 × 1654.5/1920) = 1655
    //   ⇒ 413.75 DPS/艘 ⇒ **1655.0**（仍远高于阈值 ⇒ 确实"不封顶"）
    // 机群：`count: 4` 展开成 **4 个运载单位 × 每单位 4 架 = 16 架** ⇒
    //   单发 50 × `dmgMul` 6 = 300，16 架 ÷ 4.4s = **1090.91 DPS**（不吃折扣）
    expect(hull).toBeCloseTo(1655, 6)
    expect(hull).toBeGreaterThan(150)
    expect(drone).toBeCloseTo((50 * 6 * 16 * 1000) / 4400, 6)
  })

  it('多舰补偿参与判线：N 越大越早越线（4 艘 160 → 159.0）', () => {
    // 4 艘 × 补偿 1.6 ⇒ 单发 round(100×1.6) = 160 ⇒ 40 DPS/艘 ⇒ 合计 160 > 150 ⇒ 打折
    const four = shipCard('ano-overcap-four', [{ ship: GUNSHIP, count: 4 }])
    expect(hullDps(four, OFF_BOTH)).toBeCloseTo(160, 6)
    // 目标 = 150 + 10 × 0.85 = 158.5；单发 round(160 × 158.5/160) = round(158.5) = 159 ⇒ 4 × 39.75 = 159.0
    expect(hullDps(four, bal)).toBeCloseTo(159, 6)
    // 1 艘（补偿 1）⇒ 25 DPS，远未触线
    const one = shipCard('ano-overcap-one', [{ ship: GUNSHIP, count: 1 }])
    expect(hullDps(one, bal)).toBeCloseTo(25, 6)
  })

  it('现行配置 = 开（150 / 0.15）· 洞外派生档按折扣实收、未越线档逐字不动', () => {
    expect(CAP).toBe(150)
    expect(DISC).toBeCloseTo(0.15, 9)
    const vault = ANOMALIES.find((a) => a.id === 'ano-vault-sentinel')!
    const voidedge = ANOMALIES.find((a) => a.id === 'ano-voidedge-warden')!
    const grave = ANOMALIES.find((a) => a.id === 'ano-gravekeeper')!
    const maw = ANOMALIES.find((a) => a.id === 'ano-maw-hunt')!
    // 越线：派生档实测（2026-09-15 探针）穹顶 L1 ≈ 164.8 ⇒ 折扣后 > 150 且 < 原值
    // ⚠ 判线用 `maxWaveDps`（逐波建档口径）：穹顶/虚海是单波卡（与 hullDps 同值），
    //   噬口是 3 波卡且**头目在第 3 波**——只看波 0（4 只小虫 ≈ 20 DPS）会得出"未越线"的错结论。
    const vaultUncapped = maxWaveDps(lairAnomalyOf(vault, 1), OFF_BOTH)
    expect(vaultUncapped).toBeGreaterThan(150)
    const vaultLive = maxWaveDps(lairAnomalyOf(vault, 1), bal)
    expect(vaultLive).toBeGreaterThan(150) // 不封顶
    expect(vaultLive).toBeLessThan(vaultUncapped)
    expect(Math.abs(vaultLive - overCapTarget(vaultUncapped))).toBeLessThan(1)
    // 虚海 lairLevel = 2 ⇒ 只有 1~2 档；2 档派生 ≈ 210 同样越线
    expect(lairLevelOf(voidedge)).toBe(2)
    const voidUncapped2 = maxWaveDps(lairAnomalyOf(voidedge, 2), OFF_BOTH)
    expect(voidUncapped2).toBeGreaterThan(150)
    expect(maxWaveDps(lairAnomalyOf(voidedge, 2), bal)).toBeLessThan(voidUncapped2)
    expect(maxWaveDps(lairAnomalyOf(voidedge, 2), bal)).toBeGreaterThan(150)
    // 噬口 L3（2026-09-11 虫群编成改造后新越线，旧注释未登记）：末波（头目 401 单发）≈ 215.5 ⇒ 只打 85 折
    const mawL3 = lairAnomalyOf(maw, 3)
    const mawUncapped = maxWaveDps(mawL3, OFF_BOTH)
    expect(mawUncapped).toBeGreaterThan(150)
    expect(maxWaveDps(mawL3, bal)).toBeLessThan(mawUncapped)
    expect(maxWaveDps(mawL3, bal)).toBeGreaterThan(150)
    // 未越线的档不受影响：坟场守墓者 1 档 ≈ 113.5（逐字相同）
    const grave1 = maxWaveDps(lairAnomalyOf(grave, 1), OFF_BOTH)
    expect(grave1).toBeLessThan(150)
    expect(maxWaveDps(lairAnomalyOf(grave, 1), bal)).toBeCloseTo(grave1, 9)
    void LAIR_THREAT_MUL // 派生比例由 lairAnomalyOf 内部按表取，这里只需保证表被引用到
  })
})
