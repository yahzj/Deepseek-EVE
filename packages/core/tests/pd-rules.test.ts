/**
 * 敌方近防炮**规则契约**（2026-09-12 船长八条裁决）：
 * 「敌人防空火力受舰船级别影响。越大的舰船防空火力越强。改为集火制度。
 *   优先攻击哨戒和攻坚无人机，给攻坚无人机添加 25% 全抗性。侦查和普通战机相同权重抽取。
 *   允许命中下限 10%。基础命中率提高到 70%」
 *
 * 本文件钉住**可确定断言**的部分（数值与数据不变量）；集火 / 优先级 / 档系数的**行为读数**
 * 由 `tools/pd-tune.ts` 与 `tools/battle-calibrate.ts --std` 的标定轮回答（P-41）。
 */
import { describe, expect, it } from 'vitest'
import { ANOMALIES_FLAVORED, buildSimContext } from '@whale/data'
import { DEFAULT_BALANCE } from '@whale/core'
import { createFoeSpecs, pdPriorityOf, pdShotOf } from '../src/combat'

const bal = DEFAULT_BALANCE.battle
/** ⚠ 用 `buildSimContext()`（物品表含无人机）——`makeTestCtx()` 的 items 只有装备模块 */
const ctx = buildSimContext()
/** 我方无人机机型 id（四型 + G 族专属「鱿蜂无人机」） */
const DRONE_IDS = ['drone-scout', 'drone-assault', 'drone-heavy', 'drone-sentry', 'drone-exile-bee']

describe('敌方近防炮 · 2026-09-12 船长八条裁决', () => {
  it('基础命中率 70% + 命中下限 10% + 判定周期 500ms（频率 = 还手速率上限）+ 门槛 60', () => {
    expect(bal.pdAcc).toBe(0.7)
    expect(bal.pdHitFloor).toBe(0.1)
    expect(bal.pdJudgementMs).toBe(500)
    expect(bal.pdThreatFloor).toBe(60)
  })

  it('舰种档系数：越大的船防空越强（T1 = 1.0 且严格递增）', () => {
    const muls = bal.pdTierMul
    expect(muls.length).toBeGreaterThanOrEqual(5)
    expect(muls[0]).toBe(1)
    for (let i = 1; i < muls.length; i += 1) expect(muls[i]!).toBeGreaterThan(muls[i - 1]!)
  })

  it('命中下限保证**每一种机型都可被近防炮打中**（修掉"闪避 ≥ pdAcc ⇒ 永久免疫"）', () => {
    for (const id of DRONE_IDS) {
      const d = ctx.items.get(id)
      expect(d, `缺机型 ${id}`).toBeTruthy()
      const ev = d!.defense?.evasion ?? 0
      const pHit = Math.max(bal.pdHitFloor, bal.pdAcc - ev)
      expect(pHit, `${d!.name}（闪避 ${ev}）的命中率`).toBeGreaterThanOrEqual(bal.pdHitFloor)
    }
  })

  it('攻坚无人机 = **25% 全抗性**（三层 × 三系）', () => {
    const heavy = ctx.items.get('drone-heavy')
    expect(heavy).toBeTruthy()
    const def = heavy!.defense as unknown as Record<string, Record<string, number> | undefined>
    for (const layer of ['shieldResist', 'armorResist', 'hullResist']) {
      for (const t of ['kinetic', 'explosive', 'plasma']) {
        expect(def[layer]?.[t], `攻坚机 ${layer}.${t}`).toBe(0.25)
      }
    }
  })

  it('舰级路径的单位带**舰种档**（近防炮档系数据此取值）', () => {
    const a = ANOMALIES_FLAVORED.find((x) => x.id === 'ano-nadir-static')!
    const specs = createFoeSpecs(a, ctx.balance.battle)
    // 天底静区封锁 = 1 巡洋舰（T3）+ 2 驱逐舰（T2）
    expect(specs.map((s) => s.hullClassTier)).toEqual([3, 2, 2])
  })

  /**
   * **船长 2026-09-25 令**：「**我希望增强H族敌人的近防炮强度。其近防炮伤害增加50%，命中提高5%**」
   * ⇒ `balance.pdFamilyOverride.H = { dmgMul: 1.5, accAdd: 0.05 }`，取数收口在 `combat.pdShotOf`。
   * 本用例钉两张表 + 一条"只动 H"：别的族/无族一律逐字走全局值。
   */
  it('H 族近防炮覆写：伤害 ×1.5 · 命中 +0.05（百分点）· 别的族不动', () => {
    /** 基础值：命中 0.7 · 单发 5（T1 档系数 1.0 ⇒ 5） */
    expect(pdShotOf(bal, undefined, 1), '旧路径/合成 spec ⇒ 全局值').toEqual({ acc: 0.7, dmg: 5 })
    expect(pdShotOf(bal, 'A', 1), 'A 族 ⇒ 全局值（只特化 H）').toEqual({ acc: 0.7, dmg: 5 })
    expect(pdShotOf(bal, 'H', 1), 'H 族 T1 ⇒ 命中 0.75 · 伤害 7.5').toEqual({ acc: 0.75, dmg: 7.5 })
    /** 档系数照旧连乘（T5 旗舰 ×4）：H 族 = 5 × 4 × 1.5 = 30；命中那一项与档无关 */
    expect(pdShotOf(bal, 'H', 5)).toEqual({ acc: 0.75, dmg: 30 })
    expect(pdShotOf(bal, 'A', 5)).toEqual({ acc: 0.7, dmg: 20 })
    /** 与"命中下限"的关系：H 的加成是**加在 pdAcc 上**，仍要 clamp 到 [下限, 1] */
    const evasion = 0.12
    expect(Math.max(bal.pdHitFloor, pdShotOf(bal, 'H', 1).acc - evasion), 'H 打普通机型的命中').toBeCloseTo(0.63, 6)
    /** 单位带族：舰级路径的 H 单位必须带 `family: 'H'`（否则覆写取不到） */
    const ink = ANOMALIES_FLAVORED.find((x) => x.id === 'ink-harass')!
    expect(createFoeSpecs(ink, bal).every((s) => s.family === 'H'), 'H 卡的单位带族 H').toBe(true)
    const a = ANOMALIES_FLAVORED.find((x) => x.id === 'ano-nadir-static')!
    expect(createFoeSpecs(a, bal).every((s) => s.family !== 'H'), '别的卡不带 H').toBe(true)
  })

  /**
   * **族专属无人机也要吃"优先打哨戒与攻坚"的档位**（2026-09-26 加）。
   *
   * 由来：`PD_PRIORITY_BY_ART` 原先只登记制式两型，而 `pdPriorityOf` 的 `role` 兜底**只认敌方机型**
   * （我方打的是敌机、按敌机 id 查不到才回落 role）⇒ 玩家的**专属**哨戒/攻坚机落进"其余等权"，
   * 与船长 2026-09-12 的口径（「优先攻击哨戒和攻坚无人机」）不符。
   * 同批还有一条更硬的漏洞：这三型在**战斗演出表**里从未登记 ⇒ 弹道与击落演出直接跳过
   * （船长报障「玩家的构件哨戒无人机不会出现在战斗场景中」；那道闸门在 `npm run art:ships:check`）。
   */
  it('专属无人机同档位优先：构件哨戒 = 0 · 巢卫攻坚 = 1 · 墨潮重袭 = 1 · 鱿蜂（侦察档）= 2', () => {
    expect(pdPriorityOf('drone-wh-e-sentry'), 'E 构件哨戒').toBe(0)
    expect(pdPriorityOf('drone-wh-c-heavy'), 'C 巢卫攻坚').toBe(1)
    expect(pdPriorityOf('drone-ink-heavy'), 'H 墨潮重袭（攻坚档）').toBe(1)
    expect(pdPriorityOf('drone-exile-bee'), 'G 鱿蜂（侦察档，与其他侦察机等权）').toBe(2)
    // 制式两型不受影响；未知 id 仍走 role 兜底（敌机路径靠它）
    expect(pdPriorityOf('drone-sentry')).toBe(0)
    expect(pdPriorityOf('drone-heavy')).toBe(1)
    expect(pdPriorityOf('foe-drone-e-alert')).toBe(2)
    expect(pdPriorityOf('unknown-drone', 'sentry')).toBe(0)
  })
})
