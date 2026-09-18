/**
 * 目标锁定阵列（2026-09-09 船长拍板：高槽 target-lock 三档 8/12/20%——集火 + 被锁目标受击加深）：
 * - 装上即集火：全部武器打存活编队首位（主舰优先，击毁自动接力），不再随机分散；
 * - 锁定目标受本舰伤害加深 ×(1+lockDmgBonus)（多件 EVE 曲线收敛见 ship-family 侧）；
 * - 无锁定件 = V18B 随机目标行为不变（既有 combat.test 覆盖）。
 */
import { describe, expect, it } from 'vitest'
import { createInitialState } from '../src/state'
import { advanceBattleFor, startBattleFor, startFleetBattleFor } from '../src/combat'
import { addShipToFleet } from '../src/shipyard'
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
      // ⚠ 2026-09-13 层位克制改判（动能对甲 / 爆炸对盾 0.5 → 0.75）后，本夹具原来的"每层 30 血"
      // 会被敌舰**一炮一层**打穿（实测：我方 0 次开火即被打到 0/0/0）⇒ 夹具船抬到每层 90 血。
      // **只动夹具、不动内容数值**：本用例被测的行为是"集火弹道"，与血量无关（船长 2026-09-13 裁定「①」）。
      ships: [ship('bed', { cpu: 300, slots: { high: 6, mid: 2, low: 2 }, powerBonus: 0.2, shieldHp: 90, armorHp: 90, hullHp: 90 })],
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

/**
 * **增伤与集火改为「全队生效」**（船长 2026-09-17：「**增伤改为全队生效。**」＋「**集火也是全队生效**」）。
 *
 * 口径（三问三答全取甲）：**编队取最高一份、不叠加**（与指挥舰「全队单发 +15% 取最高」同口径）·
 * 范围含窝点专属「守墓者丧钟」· 落点 = `combat.applyFleetLockAura`（**每拍重建规格处**施加，
 * 否则下一拍就被 `createPlayerSpec` 的新规格冲掉——本项目已踩过一次同类坑）。
 */
describe('目标锁定阵列 · 全队生效（2026-09-17 船长）', () => {
  /**
   * 编队夹具：主控 = 装阵列的船（不带武器，只剩恒在的基础舰炮）；僚舰 = 炮舰（2×必中激光）。
   *
   * ⚠ **读数口径**（实测踩过两次）：`stats.meDmg` 统计的是"**实际扣掉的血**"⇒ 一旦敌舰被打死，
   * 两跑的合计值会**双双收敛到敌舰总血**（实测 1652 = 敌舰满血，带不带光环逐字相同）——
   * 拿合计值比"增伤是否生效"会得出**假阴性**。故本组一律：**敌我血量都抬高、只跑 15 秒**
   * （双方都活着的窗口，threat 1200 ⇒ 敌舰 ≈1.6 万血），并且只比 **每发均值 meDmg ÷ meHits**。
   */
  const BIG_HP = 200_000
  function fleet(lockOnLeader: string | null, lockOnWing: string | null, escorts = 0) {
    const deck = (id: string) =>
      ship(id, { cpu: 300, slots: { high: 4, mid: 0, low: 0 }, shieldHp: BIG_HP, armorHp: BIG_HP, hullHp: BIG_HP })
    const ctx: SimContext = makeTestCtx({
      ships: [deck('lead'), deck('wing')],
      modules: [laserDef('mod-laser-3', 6), lockDef('mod-lock-3', 0.2), lockDef('mod-lock-1', 0.08)],
      anomalies: [anomaly('ano-x', 'galaxy-hub', { threat: 1200, escorts })],
    })
    const state = createInitialState({ nowWallMs: 0, seed: 11 })
    const lead = addShipToFleet(state, 'lead')
    const wing = addShipToFleet(state, 'wing')
    state.shipId = lead
    state.fleet[lead]!.fitted = { high: [lockOnLeader, null, null, null], mid: [], low: [] }
    state.fleet[wing]!.fitted = { high: [lockOnWing, 'mod-laser-3', 'mod-laser-3', null], mid: [], low: [] }
    if (lockOnLeader) state.moduleBay[lockOnLeader] = 1
    if (lockOnWing) state.moduleBay[lockOnWing] = 1
    state.moduleBay['mod-laser-3'] = 2
    state.warehouse.items['ammo-plasma-l'] = 50_000
    return { state, ctx, lead, wing }
  }

  /** 真编队战（主控 + 僚舰，走 `startFleetBattleFor` 多舰路径）：只跑 15 秒，敌舰不会死 */
  function runFleet(lockOnLeader: string | null, lockOnWing: string | null, escorts = 0) {
    const { state, ctx, lead, wing } = fleet(lockOnLeader, lockOnWing, escorts)
    const battle = startFleetBattleFor(state, ctx, [lead, wing], 'ano-x', 0)!
    const wingTargets: string[] = []
    for (let i = 0; i < 150; i++) {
      // **把距离按进射程**（1,000 m）：高血量夹具下双方都慢，15 秒内靠拔河走不进射程 ⇒ 一炮不发
      // （实测 meHits = 0、每发均值 NaN）。本组测的是"加成有没有给到全队"，距离钉住不影响判据。
      battle.distanceM = 1_000
      state.gameMs += 100
      advanceBattleFor(state, ctx, battle, lead, 'ano-x')
      for (const fx of battle.fx) {
        if (fx.side === 'me' && fx.tag === 'ally-1' && fx.to) wingTargets.push(fx.to)
      }
      if (battle.ended) break
    }
    const perHit = battle.stats.meDmg / Math.max(1, battle.stats.meHits)
    return { battle, wingTargets, perHit }
  }

  it('**僚舰共享增伤**：阵列装在主控 ⇒ 没装阵列的僚舰打出的伤害也吃那 20%', () => {
    const withLock = runFleet('mod-lock-3', null)
    const plain = runFleet(null, null)
    const ratio = withLock.perHit / plain.perHit
    expect(withLock.battle.ended, '敌舰没活满 15 秒 ⇒ 本用例读数口径失效').toBeFalsy()
    expect(ratio, `每发均值比 ${ratio.toFixed(3)}`).toBeGreaterThan(1.15)
    expect(ratio, `每发均值比 ${ratio.toFixed(3)}`).toBeLessThan(1.25)
  })

  it('**集火也全队生效**：阵列装在主控 ⇒ 没装阵列的僚舰也只打存活编队首位（不再随机分散）', () => {
    const { wingTargets } = runFleet('mod-lock-3', null, 1)
    expect(wingTargets.length).toBeGreaterThan(3)
    const mainDead = wingTargets.indexOf('foe-1') // 首位（foe-0）死前不该出现打僚机的弹道
    const upto = mainDead < 0 ? wingTargets.length : mainDead
    for (let i = 0; i < upto; i++) expect(wingTargets[i]).toBe('foe-0')
  })

  it('**取最高一份、不叠加**：主控 MK1(8%) + 僚舰 MK3(20%) ⇒ 全队都是 20%（不是 28%）', () => {
    const both = runFleet('mod-lock-1', 'mod-lock-3')
    const only3 = runFleet(null, 'mod-lock-3')
    expect(both.perHit, `两跑每发均值 ${both.perHit.toFixed(2)} / ${only3.perHit.toFixed(2)}`).toBe(only3.perHit)
  })

  it('**僚舰自己装也照旧**：阵列只在僚舰上 ⇒ 全队（含主控）都吃（同一条链）', () => {
    const wingOnly = runFleet(null, 'mod-lock-3')
    const plain = runFleet(null, null)
    const ratio = wingOnly.perHit / plain.perHit
    expect(ratio, `每发均值比 ${ratio.toFixed(3)}`).toBeGreaterThan(1.15)
    expect(ratio, `每发均值比 ${ratio.toFixed(3)}`).toBeLessThan(1.25)
  })

  it('**没有阵列 = 逐字不变**：两跑都不装 ⇒ 每发均值与命中数完全一致（零变化守卫）', () => {
    const a = runFleet(null, null)
    const b = runFleet(null, null)
    expect(a.perHit).toBe(b.perHit)
    expect(a.battle.stats.meHits).toBe(b.battle.stats.meHits)
  })
})
