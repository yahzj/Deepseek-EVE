/**
 * **H 族「墨潮帮」逐条细化批**（船长 2026-09-24 晚 · 五档壳体 ＋ 四张入侵卡）——本文件钉四件事：
 *
 * 1. **干扰舰的射程压制**（船长三例定死口径，见下面 `describe` 的照抄）：
 *    ① 敌方 1 干扰 ＋ 我方 1 电子 ⇒ 我方射程 **−0.35** · 敌方**不变**
 *    ② 敌方 1 干扰 ＋ 我方 2 电子 ⇒ 我方射程 **−0.2**（乘法合成 0.2775 ⇒ 净 0.2225）· 敌方不变
 *    ③ 敌方 1 干扰 ＋ 我方 1 电子 ＋ 我方射程 **+60%** ⇒ **−0.35+0.6 = +0.25** · 敌方不变
 * 2. **突击舰带 A 族电子舰同款"网子 + 冲锋"**（船长：「添加A族洞内电子舰同款网子和冲锋」）。
 * 3. **四张入侵卡的波表**（船长逐条给定编成）＋ **旗舰卡自带波表不被覆写**（`FoeOverride.keepCardWaves`）。
 * 4. **战巡 1 架 / 母舰 2 架高属性重袭机**（船长：「拥有1架攻坚无人机…属性极高」/「拥有2架…」）。
 */
import { describe, expect, it } from 'vitest'
import { FOE_DRONES, FOE_SHIPS, INK_SPEED_EXEMPT_SHIP_IDS, buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import { addShipToFleet } from '../src/shipyard'
import { resolveFoeMounts } from '../src/index'
import type { AnomalyDef, WeaponSpec } from '../src/index'
import {
  activeFoeSpecsOf,
  advanceBattleFor,
  applyFoeOverride,
  applyMeJammerDebuff,
  battleAnomalyOf,
  battleArcsFor,
  createBattleState,
  createFoeSpecs,
  createPlayerSpec,
  foeJammerCountOf,
  foeRangeDebuffOf,
  foeDroneRangeOf,
  foeGunMaxRangeOf,
  meJammerNetOf,
  meRangeMulOf,
  startBattleFor,
} from '../src/combat'

const ctx = buildSimContext()
/** 一条真船（含装配）——"裸武器落点"用例用它，保证 `createPlayerSpec` 拿得到武器 */
const state0 = createInitialState({ nowWallMs: 0, seed: 24 })
state0.shipId = addShipToFleet(state0, 'sh-whiteshark')
/** 敌舰目录（FOE_SHIPS 在 data 包导出，不是 ctx 的字段） */
const shipOf = (id: string) => FOE_SHIPS.find((s) => s.id === id)!
const droneOf = (id: string) => FOE_DRONES.find((d) => d.id === id)!
const bal = ctx.balance.battle

/** 一张入侵卡（它们在 `ANOMALIES` 目录里、`hidden: true`） */
const card = (id: string): AnomalyDef => ctx.anomalies.get(id)!

/** **敌方某件武器的实战最远射程**（与引擎/视图同源的那两个公开算式：机群走 `foeDroneRangeOf`） */
const foeMaxOf = (
  b: Parameters<typeof foeGunMaxRangeOf>[0],
  unit: Parameters<typeof foeGunMaxRangeOf>[1] & { foeRangeDebuffPct?: number },
  w: WeaponSpec,
): number => (w.src === 'drone' ? foeDroneRangeOf(b, w) : foeGunMaxRangeOf(b, unit, w))

/** 用一张空壳卡包住给定舰级，拿它的单位规格（`foeRangeDebuffPct` 等运行时字段都在这份上） */
function specsOf(shipId: string) {
  const ship = shipOf(shipId)!
  const shell: AnomalyDef = {
    ...card('ink-harass'),
    id: 'probe-shell',
    ships: [{ ship, count: 1 }],
    waves: undefined,
  }
  return createFoeSpecs(shell, bal)
}

describe('H 族 · 墨潮干扰舰（射程压制 · 船长三例定死口径）', () => {
  it('舰级字段：`foeRangeDebuffPct = 0.5`，并原样带进单位规格', () => {
    expect(shipOf('foe-h-ink-jammer')!.foeRangeDebuffPct).toBe(0.5)
    expect(specsOf('foe-h-ink-jammer')[0]!.foeRangeDebuffPct).toBe(0.5)
    // 对照：没有该字段的舰级写不出这个运行时值（零行为变化口径）
    expect(specsOf('foe-h-ink-corvette')[0]!.foeRangeDebuffPct).toBeUndefined()
  })

  it('合成削减率：1 艘 = 0.50 · **2 艘 = 0.75（乘法合成）** · 无干扰舰 = 0', () => {
    const one = specsOf('foe-h-ink-jammer')
    const two = [...one, ...one.map((s) => ({ ...s, tag: `${s.tag}-b` }))]
    expect(foeJammerCountOf(one)).toBe(1)
    expect(foeRangeDebuffOf(one)).toBeCloseTo(0.5, 10)
    expect(foeJammerCountOf(two)).toBe(2)
    expect(foeRangeDebuffOf(two)).toBeCloseTo(0.75, 10) // 1 − 0.5²
    expect(foeRangeDebuffOf(specsOf('foe-h-ink-corvette'))).toBe(0)
  })

  /**
   * **船长三例（照抄，口径就按这三条钉死）**：
   * - ①「敌方1艘干扰，我方1艘电子，最终结果是我方射程 **-0.35**，**敌方不变**」
   * - ②「敌方1艘干扰，我方2艘电子，最终结果是我方射程 **-0.2**，敌方不变」
   * - ③「敌方1艘干扰，我方1艘电子，我方有射程增加60%效果，最终结果是我方射程 **-0.35+0.6=+0.25**，敌方不变」
   *
   * 引擎口径 = **先各自乘法合成、再相减取净**：`净 = 1−Π(1−vᵢ)（敌） − 1−Π(1−vᵢ)（我）`，
   * 我方射程倍率 = `1 + 我方射程加成 − 净`；**敌方射程一点不动**。
   */
  it('例①：敌方 1 干扰（50%）＋ 我方 1 电子（15%）⇒ **我方射程 −0.35**（倍率 ×0.65）', () => {
    const foes = specsOf('foe-h-ink-jammer')
    const battle = createBattleState(specsOf('foe-h-ink-corvette')[0]!, foes, 0, 5_000)
    battle.meFoeRangeDebuff = 0.15 // 我方 1 艘电子舰（`meFoeRangeDebuffOf` 的合成本值）
    expect(meJammerNetOf(battle, foes)).toBeCloseTo(0.35, 10)
    expect(meRangeMulOf(battle, foes)).toBeCloseTo(0.65, 10)
  })

  it('例②：敌方 1 干扰 ＋ 我方 2 电子（0.2775）⇒ 净 **0.2225**（船长原句的 "−0.2" 已当场更正为举例错误）', () => {
    /**
     * ⚠ 船长 2026-09-24 当场更正：「**例②是我举例错误**」⇒ 引擎按**乘法合成**算：
     * 电子舰每艘 15% ⇒ 2 艘 = 27.75%（不是 30%），净 = 0.50 − 0.2775 = **0.2225**（倍率 ×0.7775）。
     * 这处差值是"例②本身不成立"，不是引擎偏差（例①③逐字命中）。
     */
    const foes = specsOf('foe-h-ink-jammer')
    const battle = createBattleState(specsOf('foe-h-ink-corvette')[0]!, foes, 0, 5_000)
    battle.meFoeRangeDebuff = 1 - 0.85 * 0.85 // 我方 2 艘电子舰
    expect(battle.meFoeRangeDebuff).toBeCloseTo(0.2775, 10)
    expect(meJammerNetOf(battle, foes)).toBeCloseTo(0.2225, 10)
    expect(meRangeMulOf(battle, foes)).toBeCloseTo(0.7775, 10)
  })

  it('例③：上面①②任一情形 ＋ 我方射程 +60% ⇒ **−0.35+0.6 = +0.25**（倍率 ×1.25）', () => {
    const foes = specsOf('foe-h-ink-jammer')
    const battle = createBattleState(specsOf('foe-h-ink-corvette')[0]!, foes, 0, 5_000)
    battle.meFoeRangeDebuff = 0.15
    /**
     * 引擎侧落点：武器上的 `maxRangeM` **已经乘过** `(1+0.6)`（谜质/模块那条加法链），
     * 所以这里要的是"把它还原成加法"的系数 `(1+0.6−0.35)/(1+0.6) = 0.78125` ⇒ 终值 ×1.6×0.78125 = **×1.25**。
     */
    const mul = meRangeMulOf(battle, foes, 0.6)
    expect(mul).toBeCloseTo(0.78125, 10)
    expect(1.6 * mul).toBeCloseTo(1.25, 10) // = 1 + 0.6 − 0.35 ✓
  })

  it('**敌方射程完全不变**（三例都写"敌方不变"）⇒ 干扰只压我方，`foeGunMaxRangeOf` 那条链一个字节不动', () => {
    const foes = specsOf('foe-h-ink-jammer')
    const before = foes.map((f) => f.weapons.map((w) => w.maxRangeM))
    const battle = createBattleState(specsOf('foe-h-ink-corvette')[0]!, foes, 0, 5_000)
    battle.meFoeRangeDebuff = 0.15
    // 干扰压制**不改任何敌方武器的射程字段**（我方电子舰那条老机制另算：它读 `meFoeRangeDebuff`）
    expect(foes.map((f) => f.weapons.map((w) => w.maxRangeM))).toEqual(before)
    // 且压制只由"敌方干扰舰数 > 我方电子舰数"这一件事决定：我方的电子舰多于干扰舰 ⇒ 不再加射程（夹 0）
    battle.meFoeRangeDebuff = 0.6
    expect(meJammerNetOf(battle, foes)).toBe(0)
    expect(meRangeMulOf(battle, foes)).toBe(1)
    // 没有干扰舰的敌阵 ⇒ 我方射程 ×1（哪怕我方带电子舰）
    expect(meRangeMulOf(battle, specsOf('foe-h-ink-corvette'))).toBe(1)
  })

  it('**裸武器（无射程加成）**：`applyMeJammerDebuff` 的系数就是 `1 − 净`（例①②的落点）', () => {
    const me = createPlayerSpec(state0, ctx, state0.shipId)!
    expect(me.weapons.length).toBeGreaterThan(0)
    const foes = specsOf('foe-h-ink-jammer')
    const battle = createBattleState(me, foes, 0, 5_000)
    battle.meFoeRangeDebuff = 0.15
    const before = me.weapons.map((w) => w.maxRangeM)
    applyMeJammerDebuff(me, meJammerNetOf(battle, foes)) // 第二参 = **净削减**（0.35）
    me.weapons.forEach((w, i) => {
      expect(w.maxRangeM).toBe(Math.max(2, Math.round(before[i]! * 0.65)))
    })
  })

  /**
   * **逐件加法口径**（**2026-09-26 修**：船长例③原先没真落地）。
   *
   * 病根两条，本组用例各钉一条：
   * - ① `applyMeJammerDebuff` 收的是"按 bonus = 0 算出的系数"，再按每件加成反解 —— 那个反解是**恒等变换**
   *   ⇒ 每件武器都被当成**无加成**压（带加成的武器被多压）；
   * - ② 基准账只给炮台/激光/导弹入账（**基础舰炮与无人机不入账**）⇒ 账与武器条目**下标整体错位**。
   *
   * 口径 = 船长例③：`终值 = 基准射程 × (1 + 该件加成 − 净)`。
   */
  it('逐件加法①：带 **+22% 动能射程**（幽灵弹道校正器）的炮台 ⇒ 净 0.35 下按 `1+0.22−0.35` 压，不是整份相乘', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 77 })
    const sid = addShipToFleet(s, 'sh-shrike')
    s.shipId = sid
    // 攻坚炮台 MK3（基准 7,350 m）＋ 幽灵弹道校正器（动能武器射程 +22%）
    s.fleet[sid]!.fitted = { high: ['mod-turret-kin-3'], mid: [], low: ['mod-wh-g-ballistic'] } as never
    const refs: { weaponRanges?: Array<{ baseM: number; bonusMul: number }> } = { weaponRanges: [] }
    const me = createPlayerSpec(s, ctx, sid, undefined, refs)!
    /** 基准账与武器条目**逐条对齐**（②的护栏）：条数相等、且基础舰炮那条 base 就是它自己的 2,500 */
    expect(refs.weaponRanges!.length).toBe(me.weapons.length)
    expect(refs.weaponRanges![0]).toEqual({ baseM: 2500, bonusMul: 1 }) // 第 0 条 = 基础舰炮（无加成）
    const turretAt = me.weapons.findIndex((w) => w.src === 'turret')!
    const before = me.weapons[turretAt]!.maxRangeM
    expect(before).toBe(8967) // 7,350 × 1.22（基准 × (1+加成)）

    const foes = specsOf('foe-h-ink-jammer')
    const battle = createBattleState(me, foes, 0, 5_000)
    battle.meFoeRangeDebuff = 0.15 // 我方 1 艘电子舰 ⇒ 净 = 0.35
    const net = meJammerNetOf(battle, foes)
    expect(net).toBeCloseTo(0.35, 10)
    applyMeJammerDebuff(me, net, refs.weaponRanges)
    /** 加法口径：`基准 × (1 + 0.22 − 0.35) = 7,350 × 0.87 =` **6,395**（整份相乘的老口径会给 5,829） */
    const additive = Math.round(7350 * (1 + 0.22 - 0.35))
    expect(Math.abs(me.weapons[turretAt]!.maxRangeM - additive)).toBeLessThanOrEqual(1)
    expect(me.weapons[turretAt]!.maxRangeM).not.toBe(Math.round(before * (1 - 0.35))) // 不是整份相乘
  })

  it('逐件加法②：**无人机**同样逐架按自己的中继加成算（带中继天线 +20% ⇒ `1+0.2−0.50`）', () => {
    const s = createInitialState({ nowWallMs: 0, seed: 78 })
    const sid = addShipToFleet(s, 'sh-shrike') // 无人机舱 10 m³
    s.shipId = sid
    s.fleet[sid]!.fitted = { high: ['mod-drone-relay-1'], mid: [], low: [] } as never
    s.fleet[sid]!.droneLoad = { 'drone-scout': 2 } as never
    const refs: { weaponRanges?: Array<{ baseM: number; bonusMul: number }> } = { weaponRanges: [] }
    const me = createPlayerSpec(s, ctx, sid, undefined, refs)!
    const droneAt = me.weapons.findIndex((w) => w.src === 'drone')!
    expect(droneAt).toBeGreaterThanOrEqual(0)
    expect(me.weapons[droneAt]!.maxRangeM).toBe(4800) // 蜂鸟 4,000 × 1.2
    /** 基准账里无人机那条 = 机型射程 ＋ 中继倍率（②的护栏） */
    expect(refs.weaponRanges![droneAt]).toEqual({ baseM: 4000, bonusMul: 1.2 })

    const foes = specsOf('foe-h-ink-jammer') // 我方不带电子舰 ⇒ 净 = 0.50
    const battle = createBattleState(me, foes, 0, 5_000)
    const net = meJammerNetOf(battle, foes)
    expect(net).toBeCloseTo(0.5, 10)
    applyMeJammerDebuff(me, net, refs.weaponRanges)
    /** **无人机吃压制**（它就是我方武器条目之一）＋ 加法口径：`4,000 × (1 + 0.2 − 0.5) =` **2,800** */
    expect(me.weapons[droneAt]!.maxRangeM).toBe(2800)
    expect(me.weapons[droneAt]!.maxRangeM).not.toBe(Math.round(4800 * 0.5)) // 老口径 = 2,400（多压 400 m）
  })

  /**
   * **端到端**（引擎真实路径，不走纯函数）：拿主力舰队卡真打，逐拍看规格。
   * - 第 0 波（突击舰 ×3，无干扰舰）⇒ **我方武器射程一点不变**（净 0 ⇒ ×1）；
   * - 推进到第 1 波（**干扰舰入场**）⇒ 我方武器射程 = `基础 × 0.65`（例①口径，我方 1 艘电子舰）；
   * - 同时**敌方武器射程逐字不变**（"敌方不变"）；换班时必须换了（否则这条用例白测）。
   */
  it('端到端：视图射程弧可读（干扰舰入场前 = 基础、入场后 ×0.65、敌方一直不变）', () => {
    const ws = createInitialState({ nowWallMs: 0, seed: 31 })
    /** 电子舰（`sh-wh-a-frigate` 带 `foeRangeDebuffPct 0.15`：主控是它 ⇒ 编队里 1 艘电子舰） */
    const ew = addShipToFleet(ws, 'sh-wh-a-frigate')
    ws.shipId = ew
    ws.fleet[ew]!.fitted = { high: ['mod-turret-kin-2', 'mod-turret-kin-2'], mid: [], low: [] }
    /**
     * ⚠ 本用例要看的是**射程**、不是输赢：2026-09-25 主力舰队卡按新定价式重标（威胁 129 · 血 7,168 ·
     * 峰值 173 DPS）后，薄皮电子舰在**第 0 波**就被打死（战斗判负 ⇒ 干扰舰那一波永远进不了场）。
     * 这里用**真·强度倍率**（`FoeOverride.strengthMul`，同日新增）把这一场缩到 0.2 倍 ⇒ 打得完第 0 波、
     * 看得到干扰舰入场。**射程与倍率无关**（倍率只缩 `hpMul`/`dmgMul`）⇒ 本用例的射程断言逐字有效。
     */
    const b = startBattleFor(ws, ctx, ew, 'ink-main', 0, undefined, { strengthMul: 0.2 })!
    /**
     * 视图入参 = **引擎用的同一份敌卡**（真实界面也这么传：见 `BattleScreen` 的 `whView.anomaly`）
     * ⚠ 不能直接塞 `card('ink-main')` 那张原卡——引擎逐拍走的是 `battleAnomalyOf(...)`（窝点/派系派生后的卡）。
     */
    const engineCard = battleAnomalyOf(ctx, 'ink-main', ws.expedition.lairTier, ws.expedition.factionActive)!
    const arcsNow = () => battleArcsFor(ws, ctx, { battle: b, anomaly: engineCard, leaderShipId: ew })!
    const base = arcsNow().me.map((m) => m.maxM)
    expect(base.length).toBeGreaterThanOrEqual(2)
    expect(b.meFoeRangeDebuff).toBeCloseTo(0.15, 10) // 主控就是电子舰
    /** **干扰舰那一波**的敌阵规格（与引擎同源：同一张卡的同一波、同一 `hpShare`） */
    const wave1 = activeFoeSpecsOf(engineCard, bal, 1)
    expect(foeJammerCountOf(wave1)).toBe(1)
    expect(meJammerNetOf(b, wave1)).toBeCloseTo(0.35, 10) // 例①：0.50 − 0.15
    expect(foeJammerCountOf(activeFoeSpecsOf(engineCard, bal, 0))).toBe(0) // 第 0 波没有干扰舰

    let sawJammer = false
    for (let i = 0; i < 2000; i++) {
      ws.gameMs += 100
      advanceBattleFor(ws, ctx, b, ew, 'ink-main')
      if ((b.waveIdx ?? 0) >= 1) {
        sawJammer = true
        /** 净 = 0.50 − 0.15 = **0.35**（船长例①）⇒ 每件武器 = 基础 × 0.65（逐件同序） */
        const v = arcsNow()
        expect(v.me.map((m) => m.maxM).length).toBe(base.length)
        v.me.forEach((m, i) => expect(m.maxM).toBe(Math.max(2, Math.round(base[i]! * 0.65))))
        /**
         * **敌方射程一成不变**（三例都写「敌方不变」）——两条分开钉：
         * ① **干扰舰自己没有动敌方的射程**：把战斗态里"我方电子舰那条削减"清掉（`meFoeRangeDebuff = 0`）
         *    ⇒ 干扰舰那门炮的有效射程 = **原值一点没减**；
         * ② 留着电子舰的状态下，视图那条聚合带上界 = 本波敌阵按引擎同一算式算出的最大值
         *    （本场敌方射程缩短**只**来自我方 15% 那条老机制，干扰舰不在其中）。
         */
        const noEw = { ...b, meFoeRangeDebuff: 0 } as typeof b
        const jammer = wave1.find((f) => (f.foeRangeDebuffPct ?? 0) > 0)!
        for (const w of jammer.weapons) expect(foeGunMaxRangeOf(noEw, jammer, w)).toBe(w.maxRangeM)
        expect(v.foe.maxM).toBe(Math.max(...wave1.flatMap((f) => f.weapons.map((w) => foeMaxOf(b, f, w)))))
        break
      }
      if (b.ended) break
    }
    expect(sawJammer, `干扰舰那一波没进到 ⇒ 这条用例白测（ended=${b.ended} waveIdx=${b.waveIdx}）`).toBe(true)
  })
  it('H 族 · 导弹线的**近盲带口径**：三条船体（鱼雷舰 / 战巡 / 母舰）都是 ×0.3（船长 2026-09-24 选「与 E 族口径统一」）', () => {
    /**
     * 背景：H 族初版沿用 E 族 **2026-09-15** 那套「导弹 = `blindDmgMul: 1`（贴进近界也打满）」，
     * 而 E 族在 **2026-09-19** 已被船长改成「四条统一近盲 **0.3**」（`foe-missile-hulk` 头注有记录）。
     * 船长 2026-09-24 追问出处后选**与 E 族统一** ⇒ 三条船体从 1 改 0.3。
     * ⚠ **机群（墨潮重袭机）不在本条内**：敌方机群武器由引擎统一建为 `minRangeM: 1` 且**不写**
     * `blindDmgMul` ⇒ 一律走引擎缺省 **0.3**，与 E/G/C 三族机群同口径 ⇒ 机群侧零改动。
     */
    for (const id of ['foe-h-ink-torpedo', 'foe-h-ink-battlecruiser', 'foe-h-ink-flagship']) {
      expect(shipOf(id)!.blindDmgMul, id).toBe(0.3)
      expect(specsOf(id)[0]!.weapons[0]!.blindDmgMul, id).toBe(0.3)
    }
    // 对照：H 族**炮台线**两条本来就是 0.3（族内口径一致）
    for (const id of ['foe-h-ink-jammer', 'foe-h-ink-corvette']) expect(shipOf(id)!.blindDmgMul, id).toBe(0.3)
    // 机群侧：武器条目的近界 = 1（机群无"打不了"的近盲）+ 未写 blindDmgMul ⇒ 引擎缺省 0.3
    const drone = specsOf('foe-h-ink-battlecruiser')[0]!.weapons.find((w) => w.src === 'drone')!
    expect(drone.minRangeM).toBe(1)
    expect(drone.blindDmgMul).toBeUndefined()
  })
})

describe('H 族 · 第二轮数值令（船长 2026-09-24 晚）', () => {
  it('**速度**：突击舰 ×1.6 = 544 · 其余三条 ×1.3（干扰 335 / 鱼雷 384 / 战巡 267）· 母舰不动 310', () => {
    expect(shipOf('foe-h-ink-corvette')!.speedRatio).toBe(1.6)
    expect(shipOf('foe-h-ink-jammer')!.speedRatio).toBe(1.3)
    expect(shipOf('foe-h-ink-torpedo')!.speedRatio).toBe(1.3)
    expect(shipOf('foe-h-ink-battlecruiser')!.speedRatio).toBe(1.3)
    expect(shipOf('foe-h-ink-flagship')!.speedRatio).toBe(2.0)
    // 建档后的实速（舰种基准 × 倍率）——炮台与导弹的突击舰 544 / 干扰舰 335 / 鱼雷舰 384 / 战巡 267
    const spd = (id: string) => specsOf(id)[0]!.speedMps
    expect([spd('foe-h-ink-corvette'), spd('foe-h-ink-jammer'), spd('foe-h-ink-torpedo'), spd('foe-h-ink-battlecruiser'), spd('foe-h-ink-flagship')]).toEqual([544, 335, 384, 267, 310])
  })

  it('**鱼雷舰 = 高攻低血**：血 360（T2 基线 ×0.75）· 单发 90（×1.32）', () => {
    const s = shipOf('foe-h-ink-torpedo')!
    expect(s.hullClassTier).toBe(2)
    expect(s.hp).toBe(360)
    expect(s.shotDmg).toBe(90)
    // 与同族 T1 突击舰（364 / 51）比：更脆一点点、单发高 76%
    expect(s.hp).toBeLessThan(shipOf('foe-h-ink-corvette')!.hp)
    expect(s.shotDmg).toBeGreaterThan(shipOf('foe-h-ink-corvette')!.shotDmg * 1.7)
  })

  it('**伤害构成**：突击舰与干扰舰 = 6 动能 : 4 爆炸（其余三条不动，仍是爆炸 8 : 动能 2）', () => {
    expect(shipOf('foe-h-ink-corvette')!.dmgMix).toEqual({ kinetic: 6, explosive: 4 })
    expect(shipOf('foe-h-ink-jammer')!.dmgMix).toEqual({ kinetic: 6, explosive: 4 })
    expect(shipOf('foe-h-ink-torpedo')!.dmgMix).toEqual({ explosive: 8, kinetic: 2 })
    expect(shipOf('foe-h-ink-battlecruiser')!.dmgMix).toEqual({ explosive: 8, kinetic: 2 })
    expect(shipOf('foe-h-ink-flagship')!.dmgMix).toEqual({ explosive: 8, kinetic: 2 })
    // 建档后混伤拆到逐系单发上（主力系带大头）
    const jam = specsOf('foe-h-ink-jammer')[0]!.weapons[0]!
    const kin = jam.shotsByType?.kinetic ?? 0
    const exp = jam.shotsByType?.explosive ?? 0
    expect(kin).toBeGreaterThan(exp)
  })

  it('**血型**：除旗舰外全族护盾占比 0.5（旗舰仍 0.2/0.55/0.25）', () => {
    for (const id of ['foe-h-ink-corvette', 'foe-h-ink-jammer', 'foe-h-ink-torpedo', 'foe-h-ink-battlecruiser']) {
      expect(shipOf(id)!.split, id).toEqual({ s: 0.5, a: 0.25, h: 0.25 })
      expect(specsOf(id)[0]!.hp.s, id).toBeGreaterThan(specsOf(id)[0]!.hp.a)
    }
    expect(shipOf('foe-h-ink-flagship')!.split).toEqual({ s: 0.2, a: 0.55, h: 0.25 })
  })

  it('**速带破例白名单**：突击舰与战巡登记在册（1.86× 越上限 / 0.91× 低于下限），另三条不豁免', () => {
    // 白名单是"防杂鱼照抄破例"的收口 ⇒ 逐条钉住成员
    expect([...INK_SPEED_EXEMPT_SHIP_IDS].sort()).toEqual(['foe-h-ink-battlecruiser', 'foe-h-ink-corvette'])
  })
})

describe('H 族 · 墨潮突击舰（挂 A 族洞内电子舰同款两件）', () => {
  it('舰级挂载 = 劫掠冲锋推进器（×1.6 / 30 秒）＋ 劫掠捕获网', () => {
    const r = resolveFoeMounts(shipOf('foe-h-ink-corvette')!.mounts)
    expect(r.foeCanCharge).toBe(true)
    expect(r.foeChargeMul).toBe(1.6)
    expect(r.foeChargeCooldownMs).toBe(30_000)
    expect(r.foeCaptureWeb).toEqual({ slowMul: 0.1, noThruster: true, noEvasion: true, rangeDownM: 500 })
    // 战斗单位上也带着（四张入侵卡都会吃到）
    const u = specsOf('foe-h-ink-corvette')[0]!
    expect(u.foeCanCharge).toBe(true)
    expect(u.foeCaptureWeb).toBeDefined()
  })
})

/**
 * **墨潮干扰舰也带网**（**船长 2026-09-25 令**：「**给墨潮干扰舰添加一个网子**」）——
 * 与突击舰同款那件（只带网、不带冲锋：它靠 50% 射程压制做事）；写在**舰级**上 ⇒ 引用它的
 * 主力卡（第 2 波 ×1）与旗舰卡（第 2/3/4 波各 ×1）全都会带。
 */
describe('H 族 · 墨潮干扰舰（射程压制 50% ＋ 劫掠捕获网）', () => {
  it('舰级挂载 = 劫掠捕获网（无冲锋）；建档单位上带着，且压制字段不受影响', () => {
    const r = resolveFoeMounts(shipOf('foe-h-ink-jammer')!.mounts)
    expect(r.foeCaptureWeb).toEqual({ slowMul: 0.1, noThruster: true, noEvasion: true, rangeDownM: 500 })
    expect(r.foeCanCharge, '干扰舰不冲锋（船长只让加网）').toBeUndefined()
    const u = specsOf('foe-h-ink-jammer')[0]!
    expect(u.foeCaptureWeb).toBeDefined()
    expect(u.foeRangeDebuffPct, '50% 射程压制照旧').toBe(0.5)
  })
})

describe('H 族 · 四张入侵卡（船长逐条给定编成）', () => {
  it('1 骚扰舰队：突击舰 ×4（单波）', () => {
    const c = card('ink-harass')
    expect(c.name).toBe('墨潮帮骚扰舰队')
    expect(c.ships!.map((s) => [s.ship.name, s.count])).toEqual([['墨潮突击舰', 4]])
    expect(c.waves).toBeUndefined()
  })

  it('2 袭击舰队：2 波 —— 突击舰 ×2；鱼雷舰 ×3', () => {
    const c = card('ink-raid')
    expect(c.name).toBe('墨潮帮袭击舰队')
    expect(c.waves!.map((w) => w.units)).toEqual([2, 3])
    expect(c.ships!.filter((s) => s.wave === 0).map((s) => [s.ship.name, s.count])).toEqual([['墨潮突击舰', 2]])
    expect(c.ships!.filter((s) => s.wave === 1).map((s) => [s.ship.name, s.count])).toEqual([['墨潮鱼雷舰', 3]])
  })

  it('3 主力舰队：2 波 —— 突击舰 ×3；**战列巡洋舰 ＋ 鱼雷舰 ×2 ＋ 干扰舰**（主体在前见下注）', () => {
    const c = card('ink-main')
    expect(c.name).toBe('墨潮帮主力舰队')
    expect(c.waves!.map((w) => w.units)).toEqual([3, 4])
    expect(c.ships!.filter((s) => s.wave === 0).map((s) => [s.ship.name, s.count])).toEqual([['墨潮突击舰', 3]])
    /**
     * ⚠ **2026-09-25 船长令「甲：改卡面条目顺序」**：`foeDesiredRange` 取**本波卡面顺序第 1 条**
     * 当"敌方期望距离"⇒ 本波主体（11 km 战巡 ＋ 12 km 鱼雷舰）必须排在**干扰舰之前**；
     * 否则整波被拖到干扰舰的近战带 2,352 m（战巡/鱼雷舰的近盲带 ×0.3 正在那里）。
     * 编成**数量一个没变**，只换了顺序。
     */
    expect(c.ships!.filter((s) => s.wave === 1).map((s) => [s.ship.name, s.count])).toEqual([
      ['墨潮战列巡洋舰', 1],
      ['墨潮鱼雷舰', 2],
      ['墨潮干扰舰', 1],
    ])
  })

  it('4 旗舰部队：4 波（4 / 4 / 3 / **4**）· 每波声明数 = 该波 `ships` 条目实际艘数 · 最后一波含入侵母舰', () => {
    const c = card('ink-flagship')
    expect(c.name).toBe('墨潮旗舰部队')
    expect(c.waves!.map((w) => w.units)).toEqual([4, 4, 3, 4])
    /**
     * **波声明数必须与 `ships` 实际编成一致**（船长 2026-09-24 追问「5艘船哪来的？」时抓到 `waves[3].units`
     * 写着 3、而该波实际 4 条条目 ⇒ 已改齐）。`waves[].units` 对"写了 `ships` 的卡"是**惰性**的
     * （出场与波血全走 `ships`），但它是**预估胜率的"峰值波小队数"**来源 ⇒ 对不上会高估/低估胜率。
     */
    c.waves!.forEach((w, i) => {
      const roster = (c.ships ?? []).filter((s) => (s.wave ?? 0) === i).reduce((n, s) => n + (s.count ?? 1), 0)
      expect(w.units, `第 ${i + 1} 波声明 ${w.units} vs 实际编成 ${roster}`).toBe(roster)
    })
    const w3 = c.ships!.filter((s) => s.wave === 3).map((s) => [s.ship.name, s.count])
    expect(w3).toContainEqual(['墨潮入侵母舰', 1])
    expect(w3).toContainEqual(['墨潮干扰舰', 1])
    expect(w3).toContainEqual(['墨潮战列巡洋舰', 1])
    expect(w3).toContainEqual(['墨潮鱼雷舰', 1])
  })

  it('**旗舰卡自带波表不被覆写**：`keepCardWaves` 真 ⇒ 用卡自己的 4 波；缺省 ⇒ 老行为（覆写）', () => {
    const c = card('ink-flagship')
    const kept = applyFoeOverride(c, { threat: 120, keepCardWaves: true, waves: [{ units: 4, hpShare: 0.25 }] })
    expect(kept.threat).toBe(120)
    expect(kept.waves!.map((w) => w.units)).toEqual([4, 4, 3, 4]) // 卡自己的
    const overwritten = applyFoeOverride(c, { threat: 120, waves: [{ units: 4, hpShare: 0.25 }] })
    expect(overwritten.waves!.map((w) => w.units)).toEqual([4]) // 老行为：被覆写
  })

  it('四张卡都 `hidden` ＋ `region: hi`（不进悬赏目录；地区按**洞外高安**口径计 —— 2026-09-25 船长令「修，②」随残骸组改）', () => {
    for (const id of ['ink-harass', 'ink-raid', 'ink-main', 'ink-flagship']) {
      expect(card(id).hidden, id).toBe(true)
      expect(card(id).region, id).toBe('hi')
      expect(card(id).foeFamily, id).toBe('H')
    }
  })
})

describe('H 族 · 高属性重袭机（战巡 1 架 / 母舰 2 架）', () => {
  it('机型：三层血 **600** · 单发 **120** · 射程 **12,000** · 命中 **1.3**（不随距离衰减）', () => {
    const d = droneOf('foe-drone-h-heavy')!
    expect(d.family).toBe('H')
    // 2026-09-25 船长 Excel 微调批：单发 60 → 120、三层血 180 → 600、命中 0.85 → 1.3
    expect(d.dmg).toBe(120)
    /**
     * ⚠ **射程 7,000 → 12,000**（**船长 2026-09-25 令「机群交战距离是12000」**）：
     * 7,000 落在搭载舰的期望交距之内（战巡 9,500 / 母舰 10,350）⇒ 机群**永不发火**，
     * 而界面只在"出海那一轮"画机体 ⇒ 船长报障「旗舰战里看不到敌人的无人机」。
     * 本用例把新射程钉住：**射程必须 ≥ 搭载舰的期望交距**，否则又回到"看不见"。
     */
    expect(d.maxRangeM, '机群交战距离 = 12,000（船长令）').toBe(12_000)
    expect(d.maxRangeM, '必须够得着两艘搭载舰的期望交距').toBeGreaterThanOrEqual(10_350)
    expect(d.hitRate).toBe(1.3)
    expect(d.falloff).toBe(1)
    expect(d.defense.shieldHp + d.defense.armorHp + d.defense.hullHp).toBe(600)
  })

  it('舰级登记：战列巡洋舰 ×1 · 入侵母舰 ×2，且建档后机群条目数对得上', () => {
    expect(shipOf('foe-h-ink-battlecruiser')!.drones!.map((s) => s.count)).toEqual([1])
    expect(shipOf('foe-h-ink-flagship')!.drones!.map((s) => s.count)).toEqual([2])
    const bc = specsOf('foe-h-ink-battlecruiser')[0]!
    const fl = specsOf('foe-h-ink-flagship')[0]!
    expect(bc.weapons.filter((w) => w.src === 'drone')).toHaveLength(1)
    expect(fl.weapons.filter((w) => w.src === 'drone')).toHaveLength(2)
    // 机群单发 = 机型单发 × 舰级 dmgMul（战巡这条没写 dmgMul ⇒ 逐字等于机型值）
    // 2026-09-25 船长 Excel 微调：机型单发 60 → **120**
    expect(bc.weapons.filter((w) => w.src === 'drone')[0]!.shotDmg).toBe(120)
  })
})
