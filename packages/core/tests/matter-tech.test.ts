/**
 * **谜质科技树**用例（船长 2026-09-19：「消耗谜质升级的研究科技树」批）。
 *
 * 覆盖：① 节点表与货币常量的一致性 · ② 研究判据（谜质/信用点/前置/满级）与扣款 ·
 * ③ 按 `effect` 关键字聚合 · ④ 四条机制读数（最大回合数 · 洞内倍速 · 扫描间隔 · 效率加成 · 工业三件）·
 * ⑤ 存档迁移 v28 → v29 与读档往返。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addWare, createInitialState, researchMatterTech, matterTechCanResearch } from '../src/index'
import {
  MATTER_TECH_ESSENCE_ITEM_ID,
  matterTechBattleSpeed,
  matterTechLevel,
  matterTechNodes,
  matterTechScanCut,
  matterTechUnboxCut,
  matterTechVoidYield,
  matterTechWhBuffs,
  matterTechWorkEffBonus,
  matterTechWreckYield,
} from '../src/matterTech'
import { WORMHOLE_ESSENCE_ITEM_ID, wormholeSyncMatterTurns } from '../src/wormholeSalvage'
import { applyMatterPlayerBuffs, wormholeMatterBattleModsOf } from '../src/combat'
import { WORMHOLE_MATTER_BUFFS_NONE } from '../src/wormholeMatter'
import { addShipToFleet } from '../src/shipyard'
import { wormholeAdmission, wormholeEnter, wormholeTurnBudget } from '../src/wormhole'
import { wormholeMatterBuffs } from '../src/wormholeMatter'
import { CURRENT_STATE_VERSION } from '../src/state'
import { loadSaveFile, serializeSaveFile } from '../src/save'

const ctx = buildSimContext()

/** 世界 = 真数据 + 一堆谜质与信用点（研究判据之外的因素全部备足） */
function world(): ReturnType<typeof createInitialState> {
  const state = createInitialState({ nowWallMs: 0, seed: 11 })
  addWare(state, MATTER_TECH_ESSENCE_ITEM_ID, 5_000)
  state.wallet.isk = 5_000_000_000
  return state
}

describe('谜质科技树 · 节点表与货币', () => {
  it('23 个节点、id 唯一、效果关键字非空；研究货币 = 虫洞谜质', () => {
    const nodes = matterTechNodes(ctx)
    expect(nodes.length).toBe(23)
    expect(new Set(nodes.map((n) => n.id)).size).toBe(23)
    expect(nodes.every((n) => n.effect.length > 0 && n.maxLevel >= 1)).toBe(true)
    // 三条线的节点数：探索 6 / 战斗 14 / 工业 3
    const byBranch = (b: string): number => nodes.filter((n) => n.branch === b).length
    expect([byBranch('explore'), byBranch('battle'), byBranch('industry')]).toEqual([6, 14, 3])
    // 货币常量与产出侧同源（本模块写的是字面量，防漂）
    expect(MATTER_TECH_ESSENCE_ITEM_ID).toBe(WORMHOLE_ESSENCE_ITEM_ID)
  })
})

describe('谜质科技树 · 研究判据与扣款', () => {
  it('谜质不足 ⇒ 拒绝；备足 ⇒ 扣谜质与信用点、等级 +1', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 12 })
    expect(matterTechCanResearch(state, ctx, 'mt-explore-turn').ok).toBe(false)
    addWare(state, MATTER_TECH_ESSENCE_ITEM_ID, 2)
    state.wallet.isk = 3_000_000
    const r = researchMatterTech(state, ctx, 'mt-explore-turn')
    expect(r.ok, r.error ?? '').toBe(true)
    expect(matterTechLevel(state, 'mt-explore-turn')).toBe(1)
    expect(state.wallet.isk).toBe(0) // 1 级费用 = 3M
    expect(matterTechCanResearch(state, ctx, 'mt-explore-turn').ok).toBe(false) // 谜质已花光
  })

  it('前置未满 ⇒ 拒绝；补上两件前置后放行（骨架强化）', () => {
    const state = world()
    expect(matterTechCanResearch(state, ctx, 'mt-battle-hull').error ?? '').toContain('前置未满')
    expect(researchMatterTech(state, ctx, 'mt-battle-hull').ok).toBe(false)
    expect(researchMatterTech(state, ctx, 'mt-battle-shield').ok).toBe(true)
    expect(researchMatterTech(state, ctx, 'mt-battle-armor').ok).toBe(true)
    expect(researchMatterTech(state, ctx, 'mt-battle-hull').ok).toBe(true)
  })

  it('满级 ⇒ 拒绝（时序锚定器 10 级、时间压缩矩阵 2 级）', () => {
    const state = world()
    for (let i = 0; i < 10; i++) expect(researchMatterTech(state, ctx, 'mt-explore-turn').ok).toBe(true)
    expect(matterTechLevel(state, 'mt-explore-turn')).toBe(10)
    expect(matterTechCanResearch(state, ctx, 'mt-explore-turn').error ?? '').toContain('满级')
    expect(researchMatterTech(state, ctx, 'mt-explore-scan').ok).toBe(true) // 前置:谐振信号滤波阵列 ≥1
    expect(researchMatterTech(state, ctx, 'mt-explore-speed').ok).toBe(true)
    expect(researchMatterTech(state, ctx, 'mt-explore-speed').ok).toBe(true)
    expect(researchMatterTech(state, ctx, 'mt-explore-speed').ok).toBe(false)
  })
})

describe('谜质科技树 · 效果聚合与四条机制读数', () => {
  it('按 effect 聚合；增益进的是**装置同一只袋**（同封顶）', () => {
    const state = world()
    expect(researchMatterTech(state, ctx, 'mt-battle-hit').ok).toBe(true) // 前置:追踪校准 ≥1
    expect(researchMatterTech(state, ctx, 'mt-battle-evasion').ok).toBe(true)
    expect(researchMatterTech(state, ctx, 'mt-battle-evasion').ok).toBe(true)
    expect(researchMatterTech(state, ctx, 'mt-explore-turn').ok).toBe(true) // 前置:锚定器 ≥1
    expect(researchMatterTech(state, ctx, 'mt-explore-hold').ok).toBe(true)
    const tech = matterTechWhBuffs(state, ctx)
    expect(tech.evasion).toBeCloseTo(0.02, 6) // 1%/级 × 2
    expect(tech.holdCells).toBe(4)
    const bag = wormholeMatterBuffs(null, tech)
    expect(bag.evasion).toBeCloseTo(0.02, 6)
    expect(bag.holdCells).toBe(4)
    expect(bag.devices).toBe(0) // 装置一台没带：袋子只装了科技那部分
  })

  it('最大回合数：基础 80 · 锚定器 +10/级（永久，直接相加）', () => {
    const state = world()
    expect(wormholeTurnBudget(0)).toBe(80)
    for (let i = 0; i < 3; i++) {
      const r = researchMatterTech(state, ctx, 'mt-explore-turn')
      expect(r.ok, r.error ?? '').toBe(true)
    }
    const bonus = matterTechWhBuffs(state, ctx).turnBonus
    expect(bonus).toBe(30)
    expect(wormholeTurnBudget(0, bonus)).toBe(110)
    // 入场裁定把它算进去（4×T1 = 2,000 质量 ⇒ 74 + 30）
    // 4× 长尾鲨(T3 · 3,500 质量) = 14,000 ⇒ 基础 42 + 科技 30
    expect(wormholeAdmission(ctx, ['sh-thresher', 'sh-thresher', 'sh-thresher', 'sh-thresher'], bonus).turnBudget).toBe(72)
  })

  it('入洞后再点「时序锚定器」⇒ 本趟上限立刻 +10/级（永久加成，与装置同一套夹紧、幂等）', () => {
    const state = world()
    const a = addShipToFleet(state, 'sh-thresher')
    state.shipId = a
    expect(wormholeEnter(state, ctx, [a], 4242).ok).toBe(true)
    const run = state.wormhole.run!
    const base = run.turnsTotal
    expect(run.turnsTechBonus).toBe(0) // 入场时一级没点
    // 洞内现点 2 级锚定器 ⇒ 同步后本趟上限 +20（剩余的也一起多给）
    expect(researchMatterTech(state, ctx, 'mt-explore-turn').ok).toBe(true)
    expect(researchMatterTech(state, ctx, 'mt-explore-turn').ok).toBe(true)
    wormholeSyncMatterTurns(state, ctx)
    expect(run.turnsTotal).toBe(base + 20)
    expect(run.turnsLeft).toBe(base + 20)
    // 幂等：再同步一次不变（不会重复加）
    wormholeSyncMatterTurns(state, ctx)
    expect(run.turnsTotal).toBe(base + 20)
  })

  it('洞内倍速：未点 = 1×（未解锁）；1 级 = 2×、2 级 = 4×（乘法口径，不是 Σ）', () => {
    const state = world()
    expect(matterTechBattleSpeed(state, ctx)).toBe(1)
    expect(researchMatterTech(state, ctx, 'mt-explore-turn').ok).toBe(true) // 前置链:锚定器 ≥2
    expect(researchMatterTech(state, ctx, 'mt-explore-turn').ok).toBe(true)
    expect(researchMatterTech(state, ctx, 'mt-explore-scan').ok).toBe(true)
    expect(researchMatterTech(state, ctx, 'mt-explore-speed').ok).toBe(true)
    expect(matterTechBattleSpeed(state, ctx)).toBe(2)
    expect(researchMatterTech(state, ctx, 'mt-explore-speed').ok).toBe(true)
    expect(matterTechBattleSpeed(state, ctx)).toBe(4)
  })

  it('科技单独生效：一台谜质装置都不带，开战快照照样吃科技的战斗节点（回归死线）', () => {
    const state = world()
    // 前置链：追踪校准 ≥1 ⇒ 信号噪化 ≥1 ⇒ 压制力场增幅 ≥1
    expect(researchMatterTech(state, ctx, 'mt-battle-hit').ok).toBe(true)
    expect(researchMatterTech(state, ctx, 'mt-battle-noise').ok).toBe(true)
    expect(researchMatterTech(state, ctx, 'mt-battle-threat-node').ok).toBe(true)
    expect(state.wormhole.run?.hold).toBeUndefined() // 本趟货仓里一件装置都没有
    const card = [...ctx.anomalies.values()][0]!
    const mods = wormholeMatterBattleModsOf(state, ctx, card, 'node')
    expect(mods, '只点科技、不带装置时快照为 null ⇒ 战斗四节点全是死线').not.toBeNull()
    expect(mods!.threatMul).toBeLessThan(1) // 压制力场增幅：节点威胁 −3%/级
    expect(mods!.foeHitDown).toBeGreaterThan(0) // 信号噪化：敌命中 −1%/级
  })

  it('科技单独生效（我方静态增益同一条死线）：0 台装置时射程/命中/单发也要算进去', () => {
    /**
     * 2026-09-19 修的第二条同类死线：`applyMatterPlayerBuffs` 原先开头 `if (b.devices === 0) return`，
     * 而 `devices` **只数装置台数** ⇒ 只点科技时我方射程/命中/回避/抗性/装填/单发**全部不生效**。
     * 实测（船长问射程时发现）：3 级测距延展在 0 台装置下最长射程一动不动（7,350m），带 1 台才 8,232m。
     */
    const state = world()
    expect(researchMatterTech(state, ctx, 'mt-battle-hit').ok).toBe(true) // 追踪校准：命中 +1%/级
    expect(researchMatterTech(state, ctx, 'mt-battle-range').ok).toBe(true) // 测距延展（前置：追踪校准 ≥1）
    expect(researchMatterTech(state, ctx, 'mt-battle-range').ok).toBe(true) // 2 级 ⇒ +8%
    expect(state.wormhole.run?.hold).toBeUndefined()
    const spec = {
      weapons: [{ maxRangeM: 3000, minRangeM: 500, reloadMs: 2400, name: 'w' }],
      hitBonus: 0,
      evasion: 0,
      resists: {},
    } as unknown as Parameters<typeof applyMatterPlayerBuffs>[0]
    applyMatterPlayerBuffs(spec, wormholeMatterBuffs(null, matterTechWhBuffs(state, ctx)), 'kinetic')
    expect(spec.weapons[0]!.maxRangeM, '测距延展 2 级 ⇒ 3000 × 1.08').toBe(3240)
    expect(spec.weapons[0]!.minRangeM, '近盲带不跟着放大（放大反而吃亏）').toBe(500)
    expect(spec.hitBonus, '追踪校准 1 级 ⇒ +1%').toBeCloseTo(0.01, 6)
    // 空袋子（装置与科技都没有）仍是**零改动**：逐字等价于不调用
    const plain = {
      weapons: [{ maxRangeM: 3000, minRangeM: 500, reloadMs: 2400, name: 'w' }],
      hitBonus: 0,
      evasion: 0,
      resists: {},
    } as unknown as Parameters<typeof applyMatterPlayerBuffs>[0]
    applyMatterPlayerBuffs(plain, WORMHOLE_MATTER_BUFFS_NONE, 'kinetic')
    expect(plain.weapons[0]!.maxRangeM).toBe(3000)
    expect(plain.hitBonus).toBe(0)
  })

  it('扫描间隔 / 工业三件 / 效率加成：满级读数逐项对上', () => {
    const state = world()
    expect(researchMatterTech(state, ctx, 'mt-explore-turn').ok).toBe(true) // 前置链:锚定器 ≥2
    expect(researchMatterTech(state, ctx, 'mt-explore-turn').ok).toBe(true)
    expect(researchMatterTech(state, ctx, 'mt-explore-scan').ok).toBe(true)
    for (let i = 1; i < 5; i++) expect(researchMatterTech(state, ctx, 'mt-explore-scan').ok).toBe(true)
    expect(matterTechScanCut(state, ctx)).toBeCloseTo(0.25, 6)
    for (let i = 0; i < 3; i++) researchMatterTech(state, ctx, 'mt-industry-unbox')
    expect(matterTechUnboxCut(state, ctx)).toBeCloseTo(0.75, 6)
    for (let i = 0; i < 3; i++) researchMatterTech(state, ctx, 'mt-industry-void')
    expect(matterTechVoidYield(state, ctx)).toBeCloseTo(0.3, 6)
    for (let i = 0; i < 3; i++) researchMatterTech(state, ctx, 'mt-industry-wreck')
    expect(matterTechWreckYield(state, ctx)).toBeCloseTo(0.15, 6)
    for (let i = 0; i < 3; i++) researchMatterTech(state, ctx, 'mt-explore-salvage')
    expect(matterTechWorkEffBonus(state, ctx, 'salvage')).toBeCloseTo(0.6, 6)
  })
})

describe('谜质科技树 · 存档（v28 → v29）', () => {
  it('老档补空树（零行为变化）；新档往返不丢等级', () => {
    const state = world()
    researchMatterTech(state, ctx, 'mt-battle-hit')
    const text = serializeSaveFile(state)
    // 造一份"v28 老档"：删掉 research、版本降回 28
    const raw = JSON.parse(text) as { version: number; state: Record<string, unknown> }
    raw.version = 28
    raw.state.version = 28
    delete raw.state.research
    const { state: loaded } = loadSaveFile(JSON.stringify(raw))
    expect(loaded.version).toBe(CURRENT_STATE_VERSION)
    expect(loaded.research?.levels).toEqual({}) // 空树
    // 正常往返：等级还在（改造后的档再存一次也一样）
    const back = loadSaveFile(serializeSaveFile(state)).state
    expect(matterTechLevel(back, 'mt-battle-hit')).toBe(1)
  })
})
