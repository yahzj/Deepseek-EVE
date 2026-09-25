/**
 * 多波次战斗（2026-09-09，docs/design/wave-battles-20260909.md）：
 * AnomalyDef.waves 分批续刷（同场清空 → 下一波；无喘息）；零迁移（无 waves = 单波现行为）。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import type { GameState } from '../src/state'
import type { AnomalyDef, FoeShipDef, SimContext } from '../src/types'
import { startBattleFor, advanceBattleFor, createFoeSpecs } from '../src/combat'
import { DEFAULT_BALANCE } from '../src/balance'
import { anomaly, makeTestCtx, ship } from './helpers'

function world(waves: { units: number; hpShare: number }[] | undefined) {
  // 2026-09-11 敌方远端衰减 0.3 → 0.5（敌人远距离更准）后，裸初始船（沙猫，无武器）扛不住威胁 10 的
  // brawl 卡；本文件测的是**波次机制**不是平衡，故把该卡**单发直写为 1**
  //（`foeShotDmg`；旧的 `foeDmgMul` 已按船长裁决整体退休、字段已删——血 / 波表 / 战术全部照旧）。
  const ctx: SimContext = makeTestCtx({
    anomalies: [
      {
        ...anomaly('ano-wave', 'galaxy-hub', { threat: 10, tactic: 'brawl' }),
        // 2026-09-11（自 main 同步远端衰减 0.3 → 0.5 后）：敌人远距离更准，裸初始船扛不住威胁 10 的
        // brawl 卡；本文件测的是**波次机制**不是平衡 ⇒ 把该卡伤害压到 0.2（血/波表/战术全部照旧）。
        // ⚠ d2 已退休 `foeDmgMul`（行为恒等）⇒ 此处用**基础单发直写** `foeShotDmg` 表达同一意图。
        foeShotDmg: 0.2,
        ...(waves ? { waves } : {}),
      },
    ],
  })
  const state = createInitialState({ nowWallMs: 0, seed: 3 })
  return { state, ctx }
}

describe('多波次战斗（2026-09-09）', () => {
  it('两波：首波清空后续刷第二波（无喘息）→ 末波清空判胜；日志提示波次', () => {
    const { state, ctx } = world([
      { units: 1, hpShare: 0.5 },
      { units: 1, hpShare: 0.5 },
    ])
    const battle = startBattleFor(state, ctx, state.shipId, 'ano-wave', 0)!
    expect(battle).not.toBeNull()
    expect(battle.waveIdx ?? 0).toBe(0)
    expect(battle.units['foe-0']).toBeDefined() // 首波沿用旧命名
    expect(battle.units['w1-foe-0']).toBeUndefined() // 第二波尚未生成
    // 大步推进：时间给足 → 波 1 清空 → 切波（battle.waveIdx=1、补刷 w1-*）→ 末波清空判胜
    state.gameMs = ctx.balance.battle.maxBattleMs + 5_000
    advanceBattleFor(state, ctx, battle, state.shipId, 'ano-wave')
    expect(battle.ended).toBe('me')
    expect(battle.waveIdx).toBe(1)
    expect(battle.units['w1-foe-0']).toBeDefined()
    expect(battle.units['w1-foe-0']!.hpMax).toBeDefined() // 血条分母随单位写入
    expect(state.logs.some((l) => l.text.includes('第 2/2 波来袭'))).toBe(true)
  })

  it('零迁移：无 waves 的悬赏维持单波（不切波、无波次日志、tag 不变）', () => {
    const { state, ctx } = world(undefined)
    const battle = startBattleFor(state, ctx, state.shipId, 'ano-wave', 0)!
    state.gameMs = ctx.balance.battle.maxBattleMs + 5_000
    advanceBattleFor(state, ctx, battle, state.shipId, 'ano-wave')
    expect(battle.ended).toBe('me')
    expect(battle.waveIdx).toBeUndefined()
    expect(battle.units['w1-foe-0']).toBeUndefined()
    expect(state.logs.some((l) => l.text.includes('波来袭'))).toBe(false)
  })

  it('波表分血：首波单位血 ≈ 单波全量 × hpShare（总预算不变）', () => {
    // 单波对照：threat 10 无覆写 → foeHpOfThreat 全量
    const one = world(undefined)
    const b1 = startBattleFor(one.state, one.ctx, one.state.shipId, 'ano-wave', 0)!
    const fullHp = b1.units['foe-0']!.hp.s + b1.units['foe-0']!.hp.a + b1.units['foe-0']!.hp.h
    // 两波 × 0.5：首波主舰 = 全量 × 0.5（威胁份额不变）
    const two = world([
      { units: 1, hpShare: 0.5 },
      { units: 1, hpShare: 0.5 },
    ])
    const b2 = startBattleFor(two.state, two.ctx, two.state.shipId, 'ano-wave', 0)!
    const firstHp = b2.units['foe-0']!.hp.s + b2.units['foe-0']!.hp.a + b2.units['foe-0']!.hp.h
    expect(firstHp).toBeCloseTo(fullHp * 0.5, 6)
    // hpMax = 初始满血（UI 血条分母；此前缺失致波次单位血条为空）
    expect(b1.units['foe-0']!.hpMax).toEqual(b1.units['foe-0']!.hp)
    expect(b2.units['foe-0']!.hpMax).toEqual(b2.units['foe-0']!.hp)
  })

  it('多小队 tag 唯一（2026-09-09 修复）：首波 units=2 生成 foe-0 + w0-foe-1（不与 legacy 僚机撞名）', () => {
    const { ctx } = world(undefined)
    const bal = ctx.balance.battle
    const specs = createFoeSpecs(
      { ...anomaly('ano-wave', 'galaxy-hub', { threat: 10 }), waves: [{ units: 2, hpShare: 1 }] },
      bal,
      { units: 2 },
    )
    const tags = specs.map((s) => s.tag)
    expect(tags).toContain('foe-0')
    expect(tags).toContain('w0-foe-1')
    expect(new Set(tags).size).toBe(tags.length) // 无重复 tag
  })

  it('演出窗口（2026-09-09 船长反馈二轮）：波全灭后战斗时钟冻结等 waveEnterGapMs，窗口结束才刷下一波', () => {
    const { state, ctx } = world([
      { units: 1, hpShare: 0.5 },
      { units: 1, hpShare: 0.5 },
    ])
    const battle = startBattleFor(state, ctx, state.shipId, 'ano-wave', 0)!
    const gap = Math.max(0, ctx.balance.battle.waveEnterGapMs ?? 0)
    expect(gap).toBeGreaterThan(0)
    // 白盒：把首波单位打成尸体 → 下一拍推进即应开窗口（战斗时钟冻结于 0，未步进过）
    battle.units['foe-0']!.hp = { s: 0, a: 0, h: 0 }
    state.gameMs = 100
    advanceBattleFor(state, ctx, battle, state.shipId, 'ano-wave')
    expect(battle.waveClearAt).toBe(battle.lastTickGameMs + gap)
    expect(battle.units['w1-foe-0']).toBeUndefined() // 窗口未走完：不刷下一波
    expect(state.logs.some((l) => l.text.includes('第 1/2 波已全灭'))).toBe(true)
    expect(state.logs.some((l) => l.text.includes('第 2/2 波来袭'))).toBe(false)
    // 窗口内继续推进：仍不刷、战斗时钟不推进（演出时间不计 maxBattleMs 超时）
    state.gameMs = battle.waveClearAt! - 1
    advanceBattleFor(state, ctx, battle, state.shipId, 'ano-wave')
    expect(battle.units['w1-foe-0']).toBeUndefined()
    expect(battle.ended).toBeNull()
    expect(battle.lastTickGameMs).toBe(0)
    // 越过窗口：立即补刷并清标记
    state.gameMs = battle.waveClearAt! + 100
    advanceBattleFor(state, ctx, battle, state.shipId, 'ano-wave')
    expect(battle.waveIdx).toBe(1)
    expect(battle.waveClearAt).toBeUndefined()
    expect(battle.units['w1-foe-0']).toBeDefined()
    expect(state.logs.some((l) => l.text.includes('第 2/2 波来袭'))).toBe(true)
  })
})

/* ══════════════════════════════════════════════════════════════════════════
 * **换波刷新敌方期望距离**（船长 2026-09-25 报障：「敌人切换波次后，敌人的期望距离不会刷新」）
 *
 * 病根：`advanceBattleFor` 原先在进循环**之前**按首波算一次 `foeDesiredRange` / `battleOpenM` 就定死，
 * 换波只换了 `curFoes`（编队），期望距离没跟着换 ⇒ 第 2 波起敌人仍按**上一波**的期望距离机动
 * （该压近的不压、该拉开的不拉），与界面 `battleView` 的逐波读数也不一致。
 *
 * 用例构造（两波编成截然相反，方向靠"距离往哪边走"直接读出来）：
 * - 我方：**几乎不动**（速度 1 m/s）＋ 厚血 ⇒ 距离变化只由敌舰驱动（排除双方拔河的噪声）；
 * - 第 1 波 = 近战舰（钉死期望 1,500m）；第 2 波 = 远程舰（钉死期望 11,000m）；
 * - 白盒把第 1 波打成尸体 → 下一拍转场（`waveEnterGapMs = 0` 跳过演出窗口）→ 再推 60 秒。
 *
 * 断言：转场后距离**朝第 2 波自己的期望距离（11,000）走**（大涨）；若沿用旧值（1,500）则只会继续贴近。
 * ══════════════════════════════════════════════════════════════════════════ */
describe('换波刷新敌方期望距离（2026-09-25 船长报障）', () => {
  const CARD = 'ano-wave-desire'

  /** 近战舰：钉死 1,500m（第 1 波） */
  const CLOSE_FOE: FoeShipDef = {
    id: 't-wave-close',
    name: '测试近战舰',
    family: 'A',
    hullClassTier: 2,
    speedRatio: 1,
    hp: 200,
    split: { s: 0.2, a: 0.55, h: 0.25 },
    shotDmg: 5,
    hitRate: 0.9,
    reloadMs: 4000,
    rangeMinM: 1,
    rangeMaxM: 2600,
    falloff: 0.3,
    dmgMix: { kinetic: 8, explosive: 2 },
    tactic: 'brawl',
    desireRangeM: 1500,
  }

  /** 远程舰：钉死 11,000m（第 2 波）——与第 1 波**方向相反**，沿用旧值就会一眼看出来 */
  const FAR_FOE: FoeShipDef = {
    ...CLOSE_FOE,
    id: 't-wave-far',
    name: '测试远程舰',
    hullClassTier: 2,
    speedRatio: 1.4,
    tactic: 'kite',
    rangeMinM: 1000,
    rangeMaxM: 12_000,
    desireRangeM: 11_000,
  }

  function world(): { state: GameState; ctx: SimContext; battle: NonNullable<ReturnType<typeof startBattleFor>> } {
    const ctx: SimContext = makeTestCtx({
      quietEvents: true,
      // 我方：几乎不动（1 m/s）＋ 厚血 ⇒ 距离只由敌舰意图驱动
      ships: [ship('wave-bed', { maxSpeedMps: 1, shieldHp: 60_000, armorHp: 60_000, hullHp: 60_000 })],
      balance: {
        ...DEFAULT_BALANCE,
        battle: { ...DEFAULT_BALANCE.battle, waveEnterGapMs: 0 },
      },
      anomalies: [
        {
          ...anomaly(CARD, 'galaxy-hub', { threat: 20, tactic: 'brawl' }),
          ships: [
            { ship: CLOSE_FOE, wave: 0, count: 1 },
            { ship: FAR_FOE, wave: 1, count: 1 },
          ],
          waves: [
            { units: 1, hpShare: 1 },
            { units: 1, hpShare: 1 },
          ],
        },
      ],
    })
    const state = createInitialState({ nowWallMs: 0, seed: 3 })
    // 我方期望 8,000m（速度 1 m/s ⇒ 基本不挪窝，只为把"我方意图"固定成常量）
    const battle = startBattleFor(state, ctx, state.shipId, CARD, 0, 8000)!
    battle.distanceM = 6000 // 白盒：起点摆在两波期望之间
    return { state, ctx, battle }
  }

  it('第 2 波（远程 11 km）接战后期望距离换成它自己的：距离被拉开，而不是继续贴近', () => {
    const { state, ctx, battle } = world()
    battle.units['foe-0']!.hp = { s: 0, a: 0, h: 0 } // 第 1 波清空 → 下一拍转场
    state.gameMs = 60_000
    advanceBattleFor(state, ctx, battle, state.shipId, CARD)
    expect(battle.waveIdx).toBe(1)
    expect(battle.units['w1-foe-0']).toBeDefined()
    // 第 2 波期望 11,000m ⇒ 60 秒足够走到位；沿用旧值（1,500）则只会掉到 6,000 以下
    expect(battle.distanceM).toBeGreaterThan(9_000)
  })

  it('单波场次零变化：无 waves 的卡仍是"开战算一次"（距离朝该卡期望走）', () => {
    const { state, ctx } = world()
    const solo: AnomalyDef = { ...ctx.anomalies.get(CARD)!, id: 'ano-wave-desire-solo', waves: undefined }
    const ctx2: SimContext = { ...ctx, anomalies: new Map([...ctx.anomalies, [solo.id, solo]]) }
    const battle = startBattleFor(state, ctx2, state.shipId, solo.id, 0, 8000)!
    battle.distanceM = 6000
    state.gameMs = 60_000
    advanceBattleFor(state, ctx2, battle, state.shipId, solo.id)
    // 单波卡 = 只有第 1 波（近战期望 1,500m）⇒ 距离被压近
    expect(battle.waveIdx ?? 0).toBe(0)
    expect(battle.distanceM).toBeLessThan(4_000)
  })
})

/* ══════════════════════════════════════════════════════════════════════════
 * 波次转场距离回拉 · **总开关**（2026-09-11 船长：「将敌人增援波次距离会后退的惩罚**暂时关闭**」）
 *
 * `BattleBalance.waveReopenEnabled`：
 *   - `false`（**现值**）= **关闭**：下一波在**当前交战距离原地入场**，不再"从远处入场、重新接近"
 *     （玩家不再因波次转场被拉回远距离、重演接近期）；玩家可见日志同步改中性表述；
 *   - `true` = 开启：按 `waveReopenFrac` 向开战距离回拉（2026-09-09 的原始口径，比例 0.5 保留未动）。
 *
 * 测试口径：白盒把首波打成尸体 + 把 `waveEnterGapMs` 设 0（跳过演出窗口）+ 只推 1 拍
 * ⇒ 转场瞬间的距离可直接断言（后续步进对距离的漂移 ≤ 1 拍）。
 * ══════════════════════════════════════════════════════════════════════════ */
describe('波次转场距离回拉 · 总开关（2026-09-11 船长：暂时关闭）', () => {
  const CARD = 'ano-wave-reopen'

  function reopenWorld(enabled: boolean, frac = 0.5): { state: GameState; ctx: SimContext; battle: NonNullable<ReturnType<typeof startBattleFor>> } {
    const ctx: SimContext = makeTestCtx({
      quietEvents: true,
      balance: {
        ...DEFAULT_BALANCE,
        battle: { ...DEFAULT_BALANCE.battle, waveReopenEnabled: enabled, waveReopenFrac: frac, waveEnterGapMs: 0 },
      },
      anomalies: [
        {
          ...anomaly(CARD, 'galaxy-hub', { threat: 10, tactic: 'brawl' }),
          foeShotDmg: 1,
          waves: [
            { units: 1, hpShare: 0.5 },
            { units: 1, hpShare: 0.5 },
          ],
        },
      ],
    })
    const state = createInitialState({ nowWallMs: 0, seed: 3 })
    const battle = startBattleFor(state, ctx, state.shipId, CARD, 0)!
    battle.distanceM = 800 // 白盒：先"贴着打"（玩家已把距离压到近处）
    battle.units['foe-0']!.hp = { s: 0, a: 0, h: 0 } // 首波清空 → 下一拍即转场
    return { state, ctx, battle }
  }

  /** 推 1 拍：转场在同一拍内发生；返回转场后的距离与日志全文 */
  function stepOnce(enabled: boolean): { dist: number; texts: string; waveIdx: number } {
    const { state, ctx, battle } = reopenWorld(enabled)
    state.gameMs = 100
    advanceBattleFor(state, ctx, battle, state.shipId, CARD)
    return { dist: battle.distanceM, texts: state.logs.map((l) => l.text).join('\n'), waveIdx: battle.waveIdx ?? 0 }
  }

  it('默认口径锁定：`waveReopenEnabled = false`（惩罚关闭）、`waveReopenFrac = 0.5`（比例保留，开关一开即恢复）', () => {
    expect(DEFAULT_BALANCE.battle.waveReopenEnabled).toBe(false)
    expect(DEFAULT_BALANCE.battle.waveReopenFrac).toBe(0.5)
  })

  it('开关关闭：转场**距离原地不动**（不再后退），日志为中性表述', () => {
    const r = stepOnce(false)
    expect(r.waveIdx).toBe(1)
    expect(Math.abs(r.dist - 800)).toBeLessThanOrEqual(120) // 原地续战（只受 1 拍步进漂移影响）
    expect(r.texts).toContain('第 2/2 波来袭')
    expect(r.texts).toContain('敌方增援入场。')
    expect(r.texts).not.toContain('重新接近中') // 关闭时不再宣称"重新接近"
  })

  it('开关打开 + `waveReopenFrac 0.5`：距离向开战距离**回拉 50%**（旧口径可一键恢复）', () => {
    const off = stepOnce(false)
    const on = stepOnce(true)
    expect(on.waveIdx).toBe(1)
    expect(on.dist).toBeGreaterThan(off.dist + 500) // 明显被拉回远距离
    expect(on.texts).toContain('敌方增援自远处入场，重新接近中。')
  })
})
