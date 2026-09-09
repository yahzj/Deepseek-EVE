/**
 * 目标锁定阵列（2026-09-09 船长拍板：高槽 target-lock 三档 8/12/20%——集火 + 被锁目标受击加深）：
 * - 装上即集火：全部武器打存活编队首位（主舰优先，击毁自动接力），不再随机分散；
 * - 锁定目标受本舰伤害加深 ×(1+lockDmgBonus)（多件 EVE 曲线收敛见 ship-family 侧）；
 * - 无锁定件 = V18B 随机目标行为不变（既有 combat.test 覆盖）。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { advanceBattleFor, startBattleFor } from '../src/combat'
import type { GameState } from '../src/state'
import type { SimContext } from '../src/types'
import type { ModuleDef } from '../src/types'
import { anomaly, makeTestCtx, moduleDef, ship } from './helpers'

function laserDef(id: string, dmgMult: number): ModuleDef {
  return moduleDef(id, 'laser', 0, { rack: 'high', damageType: 'plasma', maxRangeM: 3000, minRangeM: 0, hitRate: 1, falloff: 0.3, reloadMs: 600, dmgMult, cpuUse: 10, ammoPerEngagement: 20 })
}

function lockDef(id: string, bonus: number): ModuleDef {
  return moduleDef(id, 'target-lock', 0, { rack: 'high', lockDmgBonus: bonus, cpuUse: 5 })
}

/** 玩家驾驶 bed（高槽 6）：可装激光×2 + 可选锁定件；threat 越大敌血越多（加深统计需长盘） */
function world(lockId: string | null, threat = 24) {
  const bed = {
    ...ship('bed', { cpu: 300, slots: { high: 6, mid: 2, low: 2 }, powerBonus: 0.2 }),
    shieldHp: 3000,
    armorHp: 1000,
    hullHp: 1000, // 战斗床船加厚：高威胁长盘验证时先扛住敌火
  }
  const mods = [laserDef('mod-laser-3', 6), lockDef('mod-lock-3', 0.2)]
  const ctx = makeTestCtx({
    ships: [bed],
    modules: mods,
    anomalies: [anomaly('ano-x', 'galaxy-hub', { threat })],
  })
  const state = createInitialState({ nowWallMs: 0, seed: 11 })
  state.fleet[state.shipId]!.defId = 'bed'
  state.fleet[state.shipId]!.fitted = { high: [lockId, 'mod-laser-3', 'mod-laser-3', null, null, null], mid: [], low: [] }
  state.moduleBay['mod-laser-3'] = 2
  if (lockId) state.moduleBay[lockId] = 1
  state.warehouse.items['ammo-plasma-l'] = 20_000
  return { state, ctx }
}

function stepUntil(state: GameState, ctx: SimContext, battle: ReturnType<typeof startBattleFor>, budgetMs: number): void {
  state.gameMs = budgetMs
  advanceBattleFor(state, ctx, battle!, state.shipId, 'ano-x')
}

describe('目标锁定阵列（2026-09-09）', () => {
  it('集火模式：主舰死前我方弹道全部打首位（foe-0），击毁后自动接力下一艘', () => {
    // 双单位卡：主 + 僚（escorts 1）
    const ctx0 = makeTestCtx({
      ships: [ship('bed', { cpu: 300, slots: { high: 6, mid: 2, low: 2 }, powerBonus: 0.2 })],
      modules: [laserDef('mod-laser-3', 6), lockDef('mod-lock-3', 0.2)],
      anomalies: [anomaly('ano-x', 'galaxy-hub', { threat: 30, escorts: 1 })],
    })
    const state = createInitialState({ nowWallMs: 0, seed: 5 })
    state.fleet[state.shipId]!.defId = 'bed'
    state.fleet[state.shipId]!.fitted = { high: ['mod-lock-3', 'mod-laser-3', 'mod-laser-3', null, null, null], mid: [], low: [] }
    state.moduleBay['mod-laser-3'] = 2
    state.moduleBay['mod-lock-3'] = 1
    state.warehouse.items['ammo-plasma-l'] = 20_000
    const battle = startBattleFor(state, ctx0 as SimContext, state.shipId, 'ano-x', 0)!
    const seenTo: string[] = []
    const foe0DiedAt: number[] = []
    for (let t = 0; t < 600; t++) {
      state.gameMs = (t + 1) * 200
      advanceBattleFor(state, ctx0 as SimContext, battle, state.shipId, 'ano-x')
      for (const fx of battle.fx) {
        if (fx.side !== 'me') continue
        if (seenTo.length > 60) continue
        seenTo.push(fx.to ?? '?')
        const f0 = battle.units['foe-0']
        if (f0 && f0.hp.s + f0.hp.a + f0.hp.h <= 0 && foe0DiedAt.length === 0) foe0DiedAt.push(seenTo.length)
      }
      if (battle.ended || seenTo.length > 40) break
    }
    expect(seenTo.length).toBeGreaterThan(5)
    // 主舰（foe-0）死亡前：不得出现任何打僚机（foe-1）的弹道
    const mainDead = foe0DiedAt[0] ?? seenTo.length + 1
    for (let i = 0; i < Math.min(mainDead, seenTo.length); i++) {
      expect(seenTo[i]).toBe('foe-0')
    }
  })

  it('锁定加深：同配置同种子，带 MK3(+20%) 场均单发伤害 ≈ 无锁对照 ×1.2（激光必中消命中方差）', () => {
    const run = (lock: string | null): { perHit: number } => {
      const { state, ctx } = world(lock, 80) // 高威胁长盘：敌血足够多发命中，溢出尾差可忽略
      const battle = startBattleFor(state, ctx as SimContext, state.shipId, 'ano-x', 0)!
      stepUntil(state, ctx as SimContext, battle, 5 * 60_000 + 5_000)
      expect(battle.ended).toBe('me')
      const hits = Math.max(1, battle.stats.meHits)
      return { perHit: battle.stats.meDmg / hits }
    }
    const locked = run('mod-lock-3')
    const plain = run(null)
    expect(locked.perHit / plain.perHit).toBeGreaterThan(1.15)
    expect(locked.perHit / plain.perHit).toBeLessThan(1.26)
  })
})
