/**
 * **H 族重定价批（船长 2026-09-25 逐条裁定）** —— 本文件钉五件事：
 *
 * 1. **三张非旗舰卡的威胁 = 90 / 108 / 132**（骚扰 / 袭击 / 主力），且**卡面威胁 = 属性实测价**
 *    （`X = √(全波总血 × 峰值波火力DPS)` 反解 · 系数 = 单舰 ×3）——这是"威胁 = 战力标尺"规则的守卫。
 *    ⚠ 主力卡 **129 → 132**（**2026-09-25 无人机微调批**：主力卡第 2 波那架「墨潮重袭机」单发 60 → 120、
 *    三层血 180 → 600、命中 0.85 → 1.3 ⇒ 实测价 +3；骚扰/袭击两张没有机群 ⇒ 逐字不动）。
 *    残骸侧按船长「冻结残骸经济」钉住 `wreckThreat: 129` ⇒ H 组代表威胁仍是 **124**（不跟着漂）。
 * 2. **属性落法 = 每艘船的血与单发同乘一个 K**（船长令「**按照敌舰设定的属性比例重定**」）
 *    ⇒ 逐舰 `血 ÷ DPS` 必须等于**该舰级的自然比**（突击 28.55 / 鱼雷 22.40 / 干扰 34.29 / 战巡 42.11）。
 * 3. **入侵敌卡随机抽取**：池 = 外围 {骚扰, 袭击} · 核心 {袭击, 主力}；同输入同结果（不消费主随机序列）、
 *    跨星系会抽到不同编成、被占星系的"驻留"一支在一场入侵内稳定。
 * 4. **遇袭强度 ×0.75 是真倍率**（`FoeOverride.strengthMul`：血与火力同缩），标签按**缩放后实测价**反解
 *    = 骚扰 **76** · 袭击 **91** · 主力 **111**（不是"威胁数字 ×0.75"）。
 * 5. **旗舰部队卡本轮一字未动**（威胁 170 · 总血 94,439 · 峰值波 405.2 DPS——机群调强后 DPS 上浮，
 *    母舰血量与卡面编成未动），留待船长单独的"旗舰轮"。
 *
 * 另附残骸侧：船长令「**这边的残骸就不冻结了**」⇒ `h-wh` 组代表威胁随成员走（45 → 93），
 * 但**行为零变化**（四张卡都 `hidden`；组威胁只作"≥17 / ≥41"两道闸门）。
 */
import { describe, expect, it } from 'vitest'
import { FOE_SHIPS, buildSimContext } from '@whale/data'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import type { AnomalyDef, FoeShipDef } from '../src/types'
import {
  applyFoeOverride,
  createFoeSpecs,
  foeHpOfThreat,
  foeStrengthOf,
  foeThreatOfAnomaly,
  foeThreatRatingOf,
} from '../src/combat'
import { FOE_DESIGN_STRENGTH_MUL } from '../src/wormholeFoes'
import {
  WEEKEND_AMBUSH_STRENGTH_MUL,
  weekendAmbushPickOf,
  weekendDrawFoeCardId,
  weekendFoePoolOf,
  weekendGarrisonFoeCardId,
} from '../src/weekendEvent'
import type { WeekendEventState } from '../src/weekendEvent'
import { weekendBattleInvolvedOf, weekendRareWreckIdFor } from '../src/weekendBattle'
// 残骸侧口径：组代表威胁跟的是 `wreckThreat ?? threat`（与 content-check 的残骸组契约同一处）
import { wreckInjectThreatOf } from '../src/salvage'
import { WRECK_GROUP_BY_KEY } from '../src/wreckGroups'
import { recycleProfileOf } from '../src/salvage'
import { pullOneWreck } from '../src/salvaging'

const ctx = buildSimContext()
const bal = ctx.balance.battle
const SOLO = FOE_DESIGN_STRENGTH_MUL.solo
const card = (id: string): AnomalyDef => ctx.anomalies.get(id)!
const shipOf = (id: string): FoeShipDef => FOE_SHIPS.find((s) => s.id === id)!
/** 逐波建档的全部单位（第 i 波前缀 `w${i}-`，与引擎同源） */
const unitsOf = (a: AnomalyDef): ReturnType<typeof createFoeSpecs> => {
  const idxs = new Set<number>()
  for (const s of a.ships ?? []) idxs.add(Math.max(0, Math.floor(s.wave ?? 0)))
  if (idxs.size === 0) idxs.add(0)
  return [...idxs].flatMap((i) => createFoeSpecs(a, bal, { tagPrefix: i === 0 ? '' : `w${i}-` }))
}
const hpOf = (u: ReturnType<typeof createFoeSpecs>[number]): number => u.hp.s + u.hp.a + u.hp.h
const gunShotOf = (u: ReturnType<typeof createFoeSpecs>[number]): number =>
  u.weapons.filter((w) => w.src !== 'drone').reduce((n, w) => n + (w.shotDmg ?? 0) * (w.count ?? 1), 0)
const gunDpsOf = (u: ReturnType<typeof createFoeSpecs>[number]): number =>
  u.weapons.filter((w) => w.src !== 'drone').reduce((n, w) => n + ((w.shotDmg ?? 0) * (w.count ?? 1) * 1000) / Math.max(1, w.reloadMs), 0)

/** 一张被占星系的入侵事件（纯数据；不跑 tick） */
function occupied(seed: number, family = 'H'): { s: GameState; ev: WeekendEventState } {
  const s = createInitialState({ nowWallMs: 0, seed })
  const ev: WeekendEventState = {
    seq: 3,
    startedAtWallMs: 0,
    coreId: 'galaxy-kor',
    peripheryIds: ['galaxy-home', 'galaxy-lantern'],
    family,
    contributed: {},
  }
  s.weekendEvent = ev
  return { s, ev }
}

describe('H 族重定价 · 威胁与属性（船长 2026-09-25：90 / 108 / **132**）', () => {
  it('三张非旗舰卡的威胁 = 90 / 108 / 132；旗舰卡仍是锚点 170', () => {
    expect(card('ink-harass').threat).toBe(90)
    expect(card('ink-raid').threat).toBe(108)
    // 129 → 132：无人机微调批（主力卡带机群 ⇒ 实测价 +3；残骸侧用 wreckThreat 钉住 129）
    expect(card('ink-main').threat).toBe(132)
    expect(card('ink-flagship').threat).toBe(170)
  })

  it('**卡面威胁 = 属性实测价**（定价式自检：反解必须还原卡面威胁，且达成预算不超 F(威胁)）', () => {
    for (const id of ['ink-harass', 'ink-raid', 'ink-main']) {
      const a = card(id)
      const m = foeStrengthOf(a, bal)
      expect(foeThreatRatingOf(m.x, SOLO, bal), `${id} 的实测价 ≠ 卡面威胁`).toBe(a.threat)
      expect((5 * m.x) / SOLO, `${id} 的达成预算超了`).toBeLessThanOrEqual(foeHpOfThreat(a.threat, bal))
    }
    // 三个具体读数（与探针一致，防止"改注释不改数"）
    expect(foeStrengthOf(card('ink-harass'), bal).x).toBeCloseTo(621.12, 1)
    expect(foeStrengthOf(card('ink-raid'), bal).x).toBeCloseTo(835.76, 1)
    // 1114.14 → 1152.79：无人机微调批（主力卡带一架重袭机）
    expect(foeStrengthOf(card('ink-main'), bal).x).toBeCloseTo(1152.79, 1)
  })

  it('**逐舰血÷DPS = 舰级自然比**（船长令「按照敌舰设定的属性比例重定」）· 每艘的绝对值也对得上', () => {
    /** 舰级自然比 = `hp ÷ (单发×1000÷装填)` */
    const natural = (id: string): number => {
      const s = shipOf(id)
      return s.hp / ((s.shotDmg * 1000) / s.reloadMs)
    }
    for (const cardId of ['ink-harass', 'ink-raid', 'ink-main']) {
      const a = card(cardId)
      for (const u of unitsOf(a)) {
        const s = shipOf(u.foeShipId!)
        /**
         * ⚠ 两处**已知且已报备**的零头，合起来 ≤1.5%：
         * ① 单发是**整数**（引擎逐条取整）⇒ ≤0.5%；
         * ② **主力第 2 波越 150 线**：引擎按既有规则对超出部分打 15% 折扣（该波整体 ×0.9885）
         *    ⇒ 比值上浮约 1.2%（名义 162.5 DPS → 实收 160.7）。
         */
        expect(gunDpsOf(u), `${cardId}·${s.name} 没有火力`).toBeGreaterThan(0)
        const ratio = hpOf(u) / gunDpsOf(u) / natural(s.id)
        expect(
          Math.abs(ratio - 1),
          `${cardId}·${s.name} 的 血÷DPS 偏离舰级比（实测 ${(hpOf(u) / gunDpsOf(u)).toFixed(2)} vs ${natural(s.id).toFixed(2)}）`,
        ).toBeLessThan(0.015)
      }
    }
    // 抽查三条绝对值（骚扰 831.4/116 · 袭击鱼雷舰 1018.1/255 · 主力战巡 3641.1/519 + 机群让位）
    const harass = unitsOf(card('ink-harass'))
    expect(hpOf(harass[0]!)).toBeCloseTo(831.4, 1)
    expect(gunShotOf(harass[0]!)).toBe(116)
    const raid = unitsOf(card('ink-raid'))
    const torp = raid.find((u) => u.foeShipId === 'foe-h-ink-torpedo')!
    expect(hpOf(torp)).toBeCloseTo(1018.1, 1)
    expect(gunShotOf(torp)).toBe(255)
    const main = unitsOf(card('ink-main'))
    const bc = main.find((u) => u.foeShipId === 'foe-h-ink-battlecruiser')!
    expect(hpOf(bc)).toBeCloseTo(3641.1, 1)
    // ⚠ 战巡在**第 2 波**（越 150 线）⇒ 实收单发 = 名义 519 × 折扣 0.9885 ≈ **513**（见下面那条越线用例）
    expect(gunShotOf(bc)).toBe(513)
  })

  it('旗舰部队卡编成与母舰血未动（威胁 170 · 全波总血 94,439 · 峰值波 **405.2 DPS**）', () => {
    const a = card('ink-flagship')
    const m = foeStrengthOf(a, bal)
    expect(a.threat).toBe(170)
    expect(m.hp).toBeCloseTo(94439, 0)
    // 357.7 → 405.2：无人机微调批（母舰 2 架 ＋ 战巡 1 架重袭机：单发 60 → 120 ⇒ 末波机群 DPS +50）
    expect(m.dps).toBeCloseTo(405.2, 1)
  })

  it('主力第 2 波越 150 线：按既有「超出部分 15% 折扣」落地（名义 162.5 → 实收 160.7 · 逐条取整 137/519/117 → 135/513/116）', () => {
    const main = unitsOf(card('ink-main'))
    const shot = (id: string): number => gunShotOf(main.find((u) => u.foeShipId === id)!)
    expect(shot('foe-h-ink-jammer')).toBe(135) // 名义 round(105 × 0.7431 × 1.75) = 137
    expect(shot('foe-h-ink-battlecruiser')).toBe(513) // 名义 round(399 × 0.7431 × 1.75) = 519
    expect(shot('foe-h-ink-torpedo')).toBe(116) // 名义 round(90 × 0.7431 × 1.75) = 117
    // 名义波 DPS（不含折扣）确实越线 ⇒ 折扣是"被触发的"，不是凭空写的数字
    const nominal = (137 * 1000) / 4000 + (519 * 1000) / 6000 + (2 * 117 * 1000) / 5600
    expect(nominal).toBeGreaterThan(150)
  })
})

describe('H 族遇袭 · 真强度 ×0.75（标签按缩放后实测价反解）', () => {
  it('缩放确实作用在属性上（血与火力同缩 ⇒ X ×0.75），且**不是**把威胁数字乘 0.75', () => {
    const cases: ReadonlyArray<readonly [string, number]> = [
      ['ink-harass', 76],
      ['ink-raid', 91],
      ['ink-main', 111], // 109 → 111（无人机微调批：主力卡实测价 +3 ⇒ 缩放标签同升）
    ]
    for (const [id, label] of cases) {
      const a = card(id)
      const before = foeStrengthOf(a, bal)
      const scaled = applyFoeOverride(a, { strengthMul: WEEKEND_AMBUSH_STRENGTH_MUL })
      const after = foeStrengthOf(scaled, bal)
      expect(after.hp, `${id} 血没缩`).toBeLessThan(before.hp)
      expect(after.dps, `${id} 火力没缩`).toBeLessThan(before.dps)
      expect(after.x / before.x, `${id} 的 X 缩放比`).toBeCloseTo(0.75, 2) // 单发取整 ⇒ 容差
      expect(foeThreatOfAnomaly(scaled, SOLO, bal), `${id} 的遇袭标签`).toBe(label)
      // 反面：若按"威胁数字 ×0.75"写标签，就会得到 round(威胁×0.75) —— 那是假的
      expect(Math.round(a.threat * 0.75)).not.toBe(label)
    }
  })

  it('射程 / 命中 / 编成不受缩放影响（只动 hpMul/dmgMul）', () => {
    const a = card('ink-main')
    const scaled = applyFoeOverride(a, { strengthMul: 0.75 })
    const before = unitsOf(a)
    const after = unitsOf(scaled)
    expect(after.length).toBe(before.length)
    after.forEach((u, i) => {
      const b = before[i]!
      expect(u.foeShipId).toBe(b.foeShipId)
      u.weapons.forEach((w, j) => {
        expect(w.reloadMs).toBe(b.weapons[j]!.reloadMs)
        expect(w.maxRangeM).toBe(b.weapons[j]!.maxRangeM)
        expect(w.hitRate).toBe(b.weapons[j]!.hitRate)
      })
    })
  })
})

describe('入侵敌卡随机抽取（船长 2026-09-25：外围 {骚扰, 袭击} · 核心 {袭击, 主力}）', () => {
  it('池成员：H 族两张 · A/C/G 三族仍取虫洞池（池长 1 ⇒ 抽签退化为取那一张）', () => {
    expect(weekendFoePoolOf('H', false)).toEqual(['ink-harass', 'ink-raid'])
    expect(weekendFoePoolOf('H', true)).toEqual(['ink-raid', 'ink-main'])
    for (const fam of ['A', 'C', 'G']) {
      expect(weekendFoePoolOf(fam, false)).toHaveLength(1)
      expect(weekendFoePoolOf(fam, true)).toHaveLength(1)
    }
  })

  it('纯函数：同输入同结果；**跨星系会抽到不同编成**（两种都出得来）', () => {
    expect(weekendDrawFoeCardId('H', false, 7, 3, 0)).toBe(weekendDrawFoeCardId('H', false, 7, 3, 0))
    const per = new Set(Array.from({ length: 24 }, (_, i) => weekendDrawFoeCardId('H', false, 7, i, 0)))
    expect(per).toEqual(new Set(['ink-harass', 'ink-raid']))
    const core = new Set(Array.from({ length: 24 }, (_, i) => weekendDrawFoeCardId('H', true, 7, i, 0)))
    expect(core).toEqual(new Set(['ink-raid', 'ink-main']))
    // 换一场入侵（seq 变）⇒ 同一星系可以换成另一支（不必一定变，但"同一场稳定"必须成立）
    const s = occupied(7)
    const a1 = weekendGarrisonFoeCardId(s.s, s.ev, 'galaxy-home')
    expect(weekendGarrisonFoeCardId(s.s, s.ev, 'galaxy-home')).toBe(a1)
  })

  it('"驻留"舰队：外围只出骚扰/袭击 · 核心只出袭击/主力（板面 = 主动 = 同一支）', () => {
    const { s, ev } = occupied(5)
    expect(['ink-harass', 'ink-raid']).toContain(weekendGarrisonFoeCardId(s, ev, 'galaxy-home'))
    expect(['ink-harass', 'ink-raid']).toContain(weekendGarrisonFoeCardId(s, ev, 'galaxy-lantern'))
    expect(['ink-raid', 'ink-main']).toContain(weekendGarrisonFoeCardId(s, ev, 'galaxy-kor'))
  })

  it('遇袭取卡：H 族标签 = 缩放后实测价 ＋ 真倍率 0.75；非占领区 ⇒ null', () => {
    const { s } = occupied(11)
    const pick = weekendAmbushPickOf(s, ctx, 'galaxy-home', 0)!
    expect(['ink-harass', 'ink-raid']).toContain(pick.cardId)
    expect(pick.strengthMul).toBe(0.75)
    expect([76, 91]).toContain(pick.threat)
    const corePick = weekendAmbushPickOf(s, ctx, 'galaxy-kor', 0)!
    expect(['ink-raid', 'ink-main']).toContain(corePick.cardId)
    expect([91, 111]).toContain(corePick.threat) // 主力卡 109 → 111（无人机微调批）
    expect(weekendAmbushPickOf(s, ctx, 'galaxy-redring', 0), '非占领区').toBeNull()
  })

  it('A/C/G 三族仍是占位口径：标签 = 主动威胁 × 0.75（与它们的主动标签同一把尺）', () => {
    const { s } = occupied(11, 'C')
    const per = weekendAmbushPickOf(s, ctx, 'galaxy-home', 0)!
    expect(per.threat).toBe(Math.round(78 * 0.75))
    expect(per.strengthMul).toBe(0.75)
    expect(weekendAmbushPickOf(s, ctx, 'galaxy-kor', 0)!.threat).toBe(Math.round(120 * 0.75))
  })
})

describe('残骸侧：**冻结残骸经济**（船长令）＋ 组改洞外高安（「修，②」）', () => {
  it('`h-hi` 组代表威胁 = 成员**回收口径**（`wreckThreat ?? threat`）的平均 = 124（战力标签涨了它也不动）', () => {
    const g = WRECK_GROUP_BY_KEY.get('h-hi')!
    /** 战力标签（对外读数）：主力卡已随无人机微调涨到 132 */
    const threats = g.members.map((id) => card(id).threat)
    expect(threats).toEqual([90, 108, 132, 170])
    /**
     * ⚠ **组代表威胁跟的是回收口径**（`wreckThreat ?? threat`，见 `wreckGroups.ts` 头注）：
     * 船长 2026-09-25「**冻结残骸经济**」⇒ 主力卡钉了 `wreckThreat: 129`，于是
     * 哪怕战力标签 129 → 132，本组的代表威胁**仍是 124**（不牵动回收画像与碎片门槛）。
     */
    const wreckValues = g.members.map((id) => wreckInjectThreatOf(card(id)))
    expect(wreckValues).toEqual([90, 108, 129, 170])
    expect(g.threat).toBe(Math.round(wreckValues.reduce((a, b) => a + b, 0) / wreckValues.length))
    expect(g.threat).toBe(124)
    expect(card('ink-main').wreckThreat, '主力卡的冻结值').toBe(129)
    expect(g.name).toBe('墨潮帮残骸（入侵）') // ⚠ 2026-09-26：'（高安）' → '（入侵）'（船长令「统一为入侵残骸（新增一个类别）」）
    expect(g.region).toBe('inv')
    expect(g.tier).toBe('dire') // 2026-09-26 提价令：常档 → 危档（卡级 `wreckTier: 'dire'` 覆写）
    expect(recycleProfileOf(ctx, 'wreck-h-hi')!.threat, '回收画像读的就是组代表威胁').toBe(124)
    // 旧洞内组退役：**已无 h-wh 组**（它此前没有任何产出路径 ⇒ 无存档可持有其物品）
    expect(WRECK_GROUP_BY_KEY.get('h-wh')).toBeUndefined()
    expect(ctx.items.has('wreck-h-wh')).toBe(false)
  })

  it('碎片门槛只认两道闸（≥17 出 T2 / ≥41 出 T3）：45 与 93 都在闸上 ⇒ 判定不变', () => {
    const g = WRECK_GROUP_BY_KEY.get('h-hi')!
    expect(g.threat >= 17).toBe(true)
    expect(g.threat >= 41).toBe(true)
    // 档位 / 池 不看组威胁；低安判定看**组地区**（2026-09-26 起 H 组自成一类「入侵」⇒ lowSec 仍为 false，
    // 与洞内组同为 false ⇒ 回收行为一致：低安门槛的 MK2 主题支不掷）
    const p = recycleProfileOf(ctx, 'wreck-h-hi')!
    expect(p.tier).toBe('dire') // 2026-09-26 提价令：常档 → 危档（组池均价 9.80 → 109.90）
    expect(p.lowSec).toBe(false)
    expect(p.region).toBe('inv')
  })

  it('**奖励残骸是真实物品**：夺回/旗舰发的稀有残骸 id 必须能在目录里解析（原 `wreck-rare` 不存在）', () => {
    for (const id of ['ink-harass', 'ink-raid', 'ink-main', 'ink-flagship']) {
      const itemId = weekendRareWreckIdFor(id, ctx)
      expect(itemId, `${id} 解析不到稀有残骸物品 id`).toBe('wreck-rare-h-hi')
      expect(ctx.items.has(itemId!), `${itemId} 不在物品目录里`).toBe(true)
    }
    expect(ctx.items.has('wreck-rare'), '旧写死的假 id 不该存在').toBe(false)
  })

  it('**被占星系的打捞池并入驻留的那支入侵舰队** ⇒ 那里能打捞出「墨潮帮残骸（入侵）」', () => {
    /** 挑一个"本来就有可见悬赏"的星系当被占星系（池底 = 它的原卡） */
    const home = [...ctx.anomalies.values()].find((a) => !a.hidden && a.galaxyId !== 'galaxy-hub')!.galaxyId
    /**
     * ⚠ 事件必须**以"此刻"为起点**：`pullOneWreck` 内部按**墙钟**（`Date.now()`）判占领——
     * 与入侵线同口径（事件时间轴本来就是墙钟）。若沿用夹具的 `startedAtWallMs: 0`，
     * NPC 铺底早就把进度推到 1（= 已夺回）⇒ 池子不会并入入侵舰队（第一次写这条用例就踩到了）。
     */
    const s = createInitialState({ nowWallMs: 0, seed: 9 })
    s.weekendEvent = {
      seq: 3,
      startedAtWallMs: Date.now(),
      coreId: 'galaxy-kor',
      peripheryIds: [home],
      family: 'H',
      contributed: {},
    }
    const underInvasion = new Set<string>()
    for (let i = 0; i < 40; i++) {
      const got = pullOneWreck(s, ctx, home, 60_000)
      if (got) underInvasion.add(got.itemId)
    }
    expect(underInvasion.has('wreck-h-hi'), `40 次打捞没出 H 族残骸（出的是 ${[...underInvasion].join(' / ')}）`).toBe(true)
    // **反证**：同一星系不处于占领区时抽不到它（池底只有原卡 ⇒ 老口径逐字不变）
    const s2 = createInitialState({ nowWallMs: 0, seed: 9 })
    const normal = new Set<string>()
    for (let i = 0; i < 40; i++) {
      const got = pullOneWreck(s2, ctx, home, 60_000)
      if (got) normal.add(got.itemId)
    }
    expect(normal.has('wreck-h-hi'), `未占领时不该出 H 族残骸（出的是 ${[...normal].join(' / ')}）`).toBe(false)
    expect(normal.size, '未占领时仍应有原卡残骸可捞').toBeGreaterThan(0)
  })
})

describe('引擎接线：H 独立卡当悬赏时的星系归属（2026-09-25）', () => {
  it('`expedition.foeGalaxyId` 决定"这一场在哪个星系" ⇒ 认得出是入侵战斗、注入目标不再落母港', () => {
    const home = [...ctx.anomalies.values()].find((a) => !a.hidden && a.galaxyId !== 'galaxy-hub')!.galaxyId
    const s = createInitialState({ nowWallMs: 0, seed: 13 })
    s.weekendEvent = {
      seq: 4,
      startedAtWallMs: Date.now(), // 墙钟起点 = 此刻（占领判定按墙钟）
      coreId: 'galaxy-kor',
      peripheryIds: [home],
      family: 'H',
      contributed: {},
    }
    // ① 不写 foeGalaxyId ⇒ H 卡自带母港（galaxy-hub 未被占）⇒ **认不出**（这就是接线前的老口径）
    expect(weekendBattleInvolvedOf(s, ctx, 'ink-harass', Date.now()), '接线前：认不出').toBeUndefined()
    // ② 写进"这一场打的星系" ⇒ 认得出；且**归属 = 被占星系**（不是卡的母港）
    s.expedition.foeGalaxyId = home
    const involved = weekendBattleInvolvedOf(s, ctx, 'ink-harass', Date.now())
    expect(involved).toEqual({ galaxyId: home, kind: 'assault' })
    expect(involved!.galaxyId, '注入/归属目标是被占星系').not.toBe(card('ink-harass').galaxyId)
    // ③ 非占领区 ⇒ 回落老口径（不认）
    s.expedition.foeGalaxyId = 'galaxy-redring'
    expect(weekendBattleInvolvedOf(s, ctx, 'ink-harass', Date.now())).toBeUndefined()
  })
})
