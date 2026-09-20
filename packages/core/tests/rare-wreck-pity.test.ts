/**
 * 稀有残骸**保底**（2026-09-11 船长：「有玩家反馈，刷了一天没有看到稀有残骸掉落……加一个每 20 次
 * 必定掉的保底」→ 口径裁决「甲：只保底派系活跃那条掷骰链」；**2026-09-20 船长把出率提到 30%、
 * 保底收紧为「每 10 次必出一个」**）。
 *
 * 口径：掷骰只发生在**派系活跃目标**（当日选中星系的悬赏）胜利时；**连续 N−1 次未出 → 第 N 次必掉**
 * （N = `FACTION_RARE_DROP_PITY_ROLLS`，2026-09-20 起 = 10）；任何稀有残骸入库（窝点必掉 / 掷中 / 保底）
 * 都清零空手计数；计数器随档保留（可选字段、零迁移）。
 */
import { describe, expect, it } from 'vitest'
import type { GameState, SimContext } from '../src/index'
import {
  FACTION_RARE_DROP_PITY_ROLLS,
  advanceGame,
  createInitialState,
  loadSaveFile,
  serializeSaveFile,
  startExpedition,
} from '../src/index'
import { anomaly, galaxy, makeTestCtx } from './helpers'

/** 世界：一张低安常驻悬赏（派系活跃目标）+ 一张另一星系的普通悬赏 + 一张可作窝点的卡 */
function world(seed = 4242): { state: GameState; ctx: SimContext } {
  const ctx = makeTestCtx({
    quietEvents: true,
    galaxies: [galaxy('g-low', '低安带', { security: -0.4 }), galaxy('g-plain', '普通星系')],
    // 新星系必须挂上航路，否则 `startExpedition` 会以"不在已知航路内"拒绝
    edges: [
      { from: 'galaxy-hub', to: 'g-low', travelMinutes: 2 },
      { from: 'galaxy-hub', to: 'g-plain', travelMinutes: 2 },
    ],
    anomalies: [
      anomaly('ano-pity', 'g-low', { threat: 4, reward: 10_000 }),
      anomaly('ano-plain', 'g-plain', { threat: 4, reward: 10_000 }),
      anomaly('ano-lair', 'g-low', { threat: 4, reward: 10_000, lairCore: '藏货据点' }),
    ],
  })
  const state = createInitialState({ nowWallMs: 0, seed })
  state.wallet.isk = 10_000_000
  state.exploredGalaxies.push('g-low', 'g-plain')
  // 手动把当日派系活跃钉在 g-low（等价于日板抽签结果；`isFactionBounty` 只读这个口）
  state.sideTasks.faction = {
    id: 1,
    kind: 'faction',
    goodKey: '',
    refId: '',
    need: 0,
    rewardIsk: 11_000,
    anomalyId: 'ano-pity',
    galaxyId: 'g-low',
    factionAnomalyName: '裂谷畸变体猎杀令',
  }
  return { state, ctx }
}

/** 打一趟并强制取胜；返回本趟稀有残骸入库件数 */
function sortie(state: GameState, ctx: SimContext, anomalyId: string, lairTier?: 1 | 2 | 3): number {
  const gid = ctx.anomalies.get(anomalyId)!.galaxyId
  const before = state.galaxyWrecks[gid]?.rare ?? 0
  // 模拟"回港整备"：清货仓、清冷却、修满——否则连刷第 N 趟会因货仓/冷却发不出去
  const ship = state.fleet[state.shipId]!
  ship.cargo = {}
  ship.durability = 1
  ship.armorPct = 1
  state.bountyCooldowns = {}
  const r = lairTier ? startExpedition(state, anomalyId, ctx, { lairTier }) : startExpedition(state, anomalyId, ctx)
  if (!r.ok) throw new Error(`出发失败：${r.error}`)
  const battle = state.expedition.battle!
  for (const u of Object.values(battle.units)) if (u.side === 'foe') u.hp = { s: 0, a: 0, h: 0 }
  for (let i = 0; i < 40 && state.expedition.active; i++) advanceGame(state, 60_000, ctx)
  return (state.galaxyWrecks[gid]?.rare ?? 0) - before
}

describe('稀有残骸保底（派系活跃掷骰链 · 船长 2026-09-11 机制 / 2026-09-20 收紧为每 10 次）', () => {
  it(`连刷 ${FACTION_RARE_DROP_PITY_ROLLS - 1} 次未出 ⇒ 第 ${FACTION_RARE_DROP_PITY_ROLLS} 次必掉（并写明保底）`, () => {
    const { state, ctx } = world()
    state.rareWreckDryStreak = FACTION_RARE_DROP_PITY_ROLLS - 1 // 已空手 N−1 次
    expect(sortie(state, ctx, 'ano-pity')).toBe(1) // 必掉（与 rng 无关）
    expect(state.rareWreckDryStreak).toBe(0) // 出货清零
    /**
     * 「本次保底」这行字只在**自然骰没中**时出现（自然命中就不写保底——那本来就会掉）。
     * 2026-09-20 出率 5% → 30% 之后，固定种子的那一趟很可能自然命中（本用例原先就是被这点绊住的），
     * 故这里**扫几个种子**把"自然没中、由保底补上"的那一次撞出来：既核文案，也顺带核两条路径都成立。
     */
    let pityLine: string | null = null
    for (let seed = 1; seed <= 40 && pityLine === null; seed++) {
      const w = world(seed)
      w.state.rareWreckDryStreak = FACTION_RARE_DROP_PITY_ROLLS - 1
      expect(sortie(w.state, w.ctx, 'ano-pity')).toBe(1) // 两条路径都必须掉
      expect(w.state.rareWreckDryStreak).toBe(0)
      pityLine = w.state.logs.find((l) => l.text.includes('本次保底'))?.text ?? null
    }
    expect(pityLine, `40 个种子里应能撞到一次"自然骰没中、由保底补上"`).not.toBeNull()
    expect(pityLine ?? '').toContain(`连刷 ${FACTION_RARE_DROP_PITY_ROLLS} 次未出`)
  })

  it(`连刷 40 趟：最长连续空手 ≤ ${FACTION_RARE_DROP_PITY_ROLLS - 1}（保底封住尾巴），且至少 4 件`, () => {
    const { state, ctx } = world()
    let drops = 0
    let dry = 0
    let maxDry = 0
    for (let i = 0; i < 40; i++) {
      const n = sortie(state, ctx, 'ano-pity')
      drops += n
      if (n > 0) {
        maxDry = Math.max(maxDry, dry)
        dry = 0
      } else dry += 1
    }
    maxDry = Math.max(maxDry, dry)
    expect(maxDry).toBeLessThanOrEqual(FACTION_RARE_DROP_PITY_ROLLS - 1)
    expect(drops).toBeGreaterThanOrEqual(4) // 保底每 10 趟一件 ⇒ 40 趟至少 4 件（本链只有它注入稀有残骸）
    expect(state.rareWreckDryStreak).toBeLessThan(FACTION_RARE_DROP_PITY_ROLLS)
  })

  it('非派系活跃星系：不掷骰、不计数（设计如此——保底只保那条链）', () => {
    const { state, ctx } = world()
    state.rareWreckDryStreak = 7
    for (let i = 0; i < 5; i++) expect(sortie(state, ctx, 'ano-plain')).toBe(0)
    expect(state.rareWreckDryStreak).toBe(7) // 别的星系既不掉也不攒
  })

  it('窝点必掉（1~3 件）同时清零空手计数', () => {
    const { state, ctx } = world()
    state.rareWreckDryStreak = 7
    expect(sortie(state, ctx, 'ano-lair', 1)).toBe(1) // 档位 1 = 1 件
    expect(state.rareWreckDryStreak).toBe(0)
  })

  it('存档往返：空手计数随档保留（老档缺字段 = 0）', () => {
    const { state, ctx } = world()
    state.rareWreckDryStreak = 13
    const loaded = loadSaveFile(serializeSaveFile(state, state.savedAtWallMs)).state
    expect(loaded.rareWreckDryStreak).toBe(13)
    const old = JSON.parse(serializeSaveFile(state, state.savedAtWallMs)) as { state: Record<string, unknown> }
    delete old.state.rareWreckDryStreak // 模拟老档：字段整体不存在
    expect(loadSaveFile(JSON.stringify(old)).state.rareWreckDryStreak).toBe(0)
    // 顺手核一句：世界仍可用（读档后还能再打一趟）
    expect(sortie(loaded, ctx, 'ano-pity')).toBeLessThanOrEqual(1)
  })
})
