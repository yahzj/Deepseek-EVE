/**
 * V12 战斗引擎单元测试：命中/伤害公式、弹药、距离与战术、敌方换算、战斗步进与结束判定。
 * 用 helpers 造的确定性世界（沙猫默认战斗数值见 helpers.ship）。
 */
import { describe, expect, it } from 'vitest'
import type { GameState } from '../src/state'
import { createInitialState } from '../src/state'
import { advanceGame } from '../src/engine'
import {
  applyDamage,
  distFactor,
  hitChance,
  inRange,
  nextAmmoType,
  typeLayerMult,
  createBattleState,
  createFoeSpecs,
  createPlayerSpec,
  desiredRangeFor,
  foeDesiredRange,
  battleOpenM,
  loadAmmo,
  startBattleFor,
  advanceBattleFor,
  battleWinPreview,
  refundAmmo,
  pushBattleFx,
  steerStep,
  spreadWinChance,
} from '../src/combat'
import { anomaly, makeTestCtx, moduleDef, ship } from './helpers'
import { addModule, fitModule } from '../src/equipment'

const BAL = () => makeTestCtx().balance.battle

describe('命中与伤害公式', () => {
  it('克制系数：动能 盾×1.5/甲×0.5；高爆反之；能量盾×0.75', () => {
    expect(typeLayerMult('kinetic', 'shield')).toBe(1.5)
    expect(typeLayerMult('kinetic', 'armor')).toBe(0.5)
    expect(typeLayerMult('kinetic', 'hull')).toBe(1)
    expect(typeLayerMult('explosive', 'armor')).toBe(1.5)
    expect(typeLayerMult('explosive', 'shield')).toBe(0.5)
    expect(typeLayerMult('plasma', 'shield')).toBe(0.75)
    expect(typeLayerMult('plasma', 'armor')).toBe(1)
  })

  it('距离衰减：minRange 端 1.0，线性降至 maxRange 端 falloff', () => {
    const w = { minRangeM: 0, maxRangeM: 1000, falloff: 0.3 }
    expect(distFactor(0, w)).toBe(1)
    expect(distFactor(1000, w)).toBeCloseTo(0.3, 10)
    expect(distFactor(500, w)).toBeCloseTo(0.65, 5)
  })

  it('命中公式：命中率随距离衰减而升（近高远低）；回避减算、命中加成加算', () => {
    const gun = { hitRate: 0.8, minRangeM: 0, maxRangeM: 4000, falloff: 0.3 }
    const attacker = { hitBonus: 0.1, scanResMm: 600 }
    const defender = { evasion: 0.1, signatureM: 60 }
    const bal = BAL()
    const near = hitChance(gun, attacker, defender, 500, bal)
    const far = hitChance(gun, attacker, defender, 4000, bal)
    expect(near).toBeGreaterThan(far)
    expect(near).toBeLessThanOrEqual(bal.hitMax)
    expect(far).toBeGreaterThanOrEqual(bal.hitMin)
    // 无回避的目标更高命中
    const easy = hitChance(gun, attacker, { evasion: 0, signatureM: 60 }, 500, bal)
    expect(easy).toBeGreaterThan(near)
    // 命中边界已开放：极高优势 → 100% 必中；极端劣势 → 0% 完全脱靶
    const sure = hitChance({ hitRate: 3, minRangeM: 0, maxRangeM: 4000, falloff: 0.3 }, attacker, defender, 500, bal)
    expect(sure).toBe(1)
    const hopeless = hitChance({ hitRate: 0, minRangeM: 0, maxRangeM: 4000, falloff: 0.3 }, attacker, { evasion: 0.9, signatureM: 200 }, 500, bal)
    expect(hopeless).toBe(0)
  })

  it('applyDamage：逐层消费（盾→甲→结构），破层溢出；未破层不外溢', () => {
    const hp = { s: 10, a: 10, h: 10 }
    // 未破盾：全部被盾吸收
    const r1 = applyDamage(hp, {}, 5, 'kinetic') // 盾 ×1.5 → 7.5 伤害吸收 7.5（<10）
    expect(r1.hp.s).toBeCloseTo(2.5, 5)
    expect(r1.hp.a).toBe(10)
    expect(r1.dealt).toBeCloseTo(7.5, 5)
    // 击穿盾 → 溢出甲（动能对甲 ×0.5：溢出 5 ×0.5 = 2.5 扣在甲上）
    const r2 = applyDamage({ s: 10, a: 10, h: 10 }, {}, 10, 'kinetic')
    expect(r2.hp.s).toBe(0)
    expect(r2.hp.a).toBeCloseTo(7.5, 5)
    expect(r2.hp.h).toBe(10)
    // 抗性：盾动能抗 0.5 → 伤害减半
    const r3 = applyDamage({ s: 10, a: 10, h: 10 }, { shield: { kinetic: 0.5 } }, 10, 'kinetic')
    expect(r3.hp.s).toBeCloseTo(2.5, 5) // 10×1.5×0.5 = 7.5
  })
})

describe('敌方换算与距离战术', () => {
  it('威胁卡面 = 编队总战力：主体份额与僚机换算正确', () => {
    const bal = BAL()
    const a = anomaly('ano-multi', 'galaxy-hub', { threat: 90 })
    // 覆盖：带 2 僚机的装甲血型
    const withEscorts: Parameters<typeof createFoeSpecs>[0] = {
      id: 'ano-multi',
      name: '巢穴',
      galaxyId: 'galaxy-hub',
      threat: 90,
      standingReq: 0,
      standingGain: 1,
      rewardIsk: 1000,
      loot: [],
      combatSeconds: 60,
      tactic: 'brawl',
      defProfile: 'armor',
      escorts: 2,
      description: '测试',
    }
    const foes = createFoeSpecs(withEscorts, bal)
    expect(foes).toHaveLength(3)
    const totalHp = foes.reduce((s, f) => s + f.hp.s + f.hp.a + f.hp.h, 0)
    expect(totalHp).toBeCloseTo(90 * bal.foeHpPerThreat, 4)
  })

  it('开战距离在最远射程之外；中距/风筝/贴脸期望单调', () => {
    const ctx = makeTestCtx()
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    const me = createPlayerSpec(state, ctx, 'sandcat')!
    const a = ctx.anomalies.get('ano-a')!
    const foes = createFoeSpecs(a, BAL())
    const open = battleOpenM(me, foes, BAL())
    const maxRange = Math.max(...me.weapons.map((w) => w.maxRangeM), ...foes.map((f) => f.weapons[0]!.maxRangeM))
    expect(open).toBeGreaterThan(maxRange)
    const assault = desiredRangeFor(me, 'assault', BAL())
    const mid = desiredRangeFor(me, 'mid', BAL())
    const kite = desiredRangeFor(me, 'kite', BAL())
    expect(assault).toBeLessThan(mid)
    expect(mid).toBeLessThan(kite)
    expect(foeDesiredRange(me, foes, BAL())).toBeGreaterThan(0)
  })

  it('胜率扩散 spreadWinChance：0.5 不动点，高端加成、低端惩罚、单调', () => {
    expect(spreadWinChance(0.5, 1.6)).toBeCloseTo(0.5, 6)
    // 高端加成：0.8 → ~0.90；越高加成越大（0.95 理论 ~0.99，被 0.98 封顶）
    const h = spreadWinChance(0.8, 1.6)
    expect(h).toBeGreaterThan(0.88)
    expect(h).toBeLessThan(0.92)
    expect(spreadWinChance(0.95, 1.6)).toBeGreaterThanOrEqual(0.98)
    // 低端惩罚：0.2 → ~0.10；越低惩罚越重
    const l = spreadWinChance(0.2, 1.6)
    expect(l).toBeGreaterThan(0.08)
    expect(l).toBeLessThan(0.12)
    expect(spreadWinChance(0.05, 1.6)).toBeLessThan(0.03)
    // 单调且落在合法区间；k<=1 退化为恒等（仅钳制）
    let prev = -1
    for (let i = 0; i <= 20; i++) {
      const p = i / 20
      const s = spreadWinChance(p, 1.6)
      expect(s).toBeGreaterThanOrEqual(prev)
      prev = s
      expect(s).toBeGreaterThan(0.01)
      expect(s).toBeLessThan(0.99)
    }
    expect(spreadWinChance(0.4, 1)).toBeCloseTo(0.4, 6)
    expect(spreadWinChance(-1, 1.6)).toBeGreaterThanOrEqual(0.02)
  })

  it('距离机动 steerStep：到位即停、绝不越过目标；双方角力收敛无来回抖动', () => {
    // 已到位：不动
    expect(steerStep(5000, 5000, 150, 0.1)).toBe(0)
    // 剩余不足一步航程（15m/步）：只走剩余，不过冲
    expect(steerStep(4990, 5000, 150, 0.1)).toBeCloseTo(10, 6)
    expect(steerStep(5005, 5000, 150, 0.1)).toBeCloseTo(-5, 6)
    // 全速推进 = 一步航程上限
    expect(steerStep(4500, 5000, 150, 0.1)).toBeCloseTo(15, 6)
    expect(steerStep(5500, 5000, 150, 0.1)).toBeCloseTo(-15, 6)
    // 拔河：我方想 8000（130m/s）、敌方想 3000（100m/s），从 5500 起步跑 120s：
    // 净漂移 ~30m/s 推约 2500m 后在我方期望附近达成角力平衡，
    // 位移方向单调收敛、不允许来回翻转（旧 bang-bang 模型的抖动即符号反复翻转）
    let d = 5500
    let prevStep = 0
    let flips = 0
    for (let i = 0; i < 1200; i++) {
      const step = steerStep(d, 8000, 130, 0.1) + steerStep(d, 3000, 100, 0.1)
      d += step
      if (i > 5 && step * prevStep < 0 && Math.abs(step) > 0.01) flips += 1
      prevStep = step
    }
    expect(flips).toBe(0)
    // 平衡点 = 8000 − 敌方一步航程(10m) ≈ 7990：距离落在强方期望附近，且静止无拉扯
    expect(d).toBeGreaterThan(7985)
    let residue = Infinity
    for (let i = 0; i < 100; i++) {
      const s = steerStep(d, 8000, 130, 0.1) + steerStep(d, 3000, 100, 0.1)
      d += s
      residue = Math.abs(s)
    }
    expect(residue).toBeLessThan(0.001)
  })
})

describe('弹药', () => {
  it('V17.2 单型装载：只装炮台固定弹种（货仓优先、仓库兜底）；退回仓库', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 1 })
    // 基线：60 仓动能 / 40 货仓高爆 / 100 仓等离子
    delete state.warehouse.items['ammo-kinetic-l']
    delete state.warehouse.items['ammo-explosive-l']
    delete state.warehouse.items['ammo-plasma-l']
    state.warehouse.items['ammo-kinetic-l'] = 60
    state.fleet[state.shipId].cargo['ammo-explosive-l'] = 40
    state.warehouse.items['ammo-plasma-l'] = 100
    const ctx = makeTestCtx()
    // 高爆炮 → 只装高爆：需求 100、库存 40 → 40（货仓 40 全扣，仓/货归零，不碰其它型）
    const loadedExp = loadAmmo(state, ctx, 'explosive', 100)
    expect(loadedExp.exp).toBe(40)
    expect(loadedExp.kin).toBe(0)
    expect(loadedExp.pla).toBe(0)
    expect(state.fleet[state.shipId].cargo['ammo-explosive-l'] ?? 0).toBe(0)
    expect(state.warehouse.items['ammo-kinetic-l']).toBe(60)
    // 动能炮 → 需求 40：仓库扣 40（货仓无动能）
    const loadedKin = loadAmmo(state, ctx, 'kinetic', 40)
    expect(loadedKin.kin).toBe(40)
    expect(state.warehouse.items['ammo-kinetic-l']).toBe(20)
    // 全量退回 → 各自回到原处（退的是"装载时实扣"的计数：动能回仓 40、高爆回仓 40）
    refundAmmo(state, loadedExp)
    refundAmmo(state, loadedKin)
    expect(state.warehouse.items['ammo-kinetic-l']).toBe(60)
    expect(state.warehouse.items['ammo-explosive-l']).toBe(40)
    expect(state.warehouse.items['ammo-plasma-l']).toBe(100)
  })

  it('开火弹型 = 剩余最多，平局按 kin→exp→pla', () => {
    expect(nextAmmoType({ kin: 0, exp: 0, pla: 0 })).toBeNull()
    expect(nextAmmoType({ kin: 5, exp: 5, pla: 5 })).toBe('kinetic')
    expect(nextAmmoType({ kin: 1, exp: 3, pla: 2 })).toBe('explosive')
  })
})

describe('完整战斗流程', () => {
  it('1v1：到港开战（startBattleFor）→ 推进 → 结束并结算弹药/判定', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 7 })
    state.wallet.isk = 100_000
    const ctx = makeTestCtx({
      anomalies: [anomaly('ano-weak', 'galaxy-hub', { threat: 1, reward: 5_000 })],
    })
    const battle = startBattleFor(state, ctx, 'sandcat', 'ano-weak', 0)!
    expect(battle).not.toBeNull()
    expect(battle.distanceM).toBeGreaterThan(0)
    // 把时间推到位并打完（战斗上限 10 分钟内必然出结果）
    state.gameMs = 9 * 60_000 + 1000
    advanceBattleFor(state, ctx, battle, 'sandcat', 'ano-weak')
    expect(battle.ended).not.toBeNull()
    expect(state.logs.length).toBeGreaterThan(0)
  })

  it('玩家炮台+弹药参战：预载弹药被消耗（或至少装载成功）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 3 })
    state.wallet.isk = 100_000
    const tur = moduleDef('tur-a', 'turret', 0.5, { maxRangeM: 4000, minRangeM: 0, hitRate: 0.8, falloff: 0.3, reloadMs: 2000, dmgMult: 1.5 })
    const ctx = makeTestCtx({ modules: [tur], anomalies: [anomaly('ano-weak2', 'galaxy-hub', { threat: 2, reward: 5_000 })] })
    state.warehouse.items['ammo-kinetic-l'] = 200
    addModule(state, 'tur-a', 1)
    expect(fitModule(state, 'tur-a', ctx).ok).toBe(true)
    const battle = startBattleFor(state, ctx, 'sandcat', 'ano-weak2', 0)!
    expect(battle.ammo.kin).toBeGreaterThan(0)
    state.gameMs = 6 * 60_000
    advanceBattleFor(state, ctx, battle, 'sandcat', 'ano-weak2')
    expect(battle.ended).not.toBeNull()
    expect(battle.stats.meShots).toBeGreaterThanOrEqual(battle.stats.meHits)
  })

  it('battleWinPreview：不消耗随机序列、值域合法', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 11 })
    const ctx = makeTestCtx()
    const before = state.rng.count
    const p = battleWinPreview(state, ctx, ctx.anomalies.get('ano-a')!, 'sandcat')
    expect(state.rng.count).toBe(before)
    expect(p).toBeGreaterThanOrEqual(0)
    expect(p).toBeLessThanOrEqual(1)
  })
})

describe('战斗 fx 事件环（回归：超 48 条头部裁剪后仍按序号续播——长战斗攻击动画停播 bug）', () => {
  it('环满裁剪：长度恒 ≤48、seq 单调连续、消费端按 seq>last 仍能拿到新事件', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 21 })
    const ctx = makeTestCtx({ anomalies: [anomaly('ano-fx', 'galaxy-hub', { threat: 2, reward: 1_000 })] })
    const me = createPlayerSpec(state, ctx, 'sandcat')!
    const anomalyDef = ctx.anomalies.get('ano-fx')!
    const foes = createFoeSpecs(anomalyDef, BAL())
    const openM = battleOpenM(me, foes, BAL())
    const battle = createBattleState(me, foes, 0, openM)
    battle.distanceM = openM
    // 塞满 60 条开火（超过 48 条环上限）
    for (let i = 0; i < 60; i++) {
      pushBattleFx(battle, {
        atMs: i * 1000,
        side: i % 2 === 0 ? 'me' : 'foe',
        tag: i % 2 === 0 ? 'player' : 'foe-0',
        type: 'kinetic',
        hit: i % 3 === 0,
      })
    }
    expect(battle.fx.length).toBe(48) // 环上限：最旧 12 条已被裁剪
    const seqs = battle.fx.map((f) => f.seq)
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]!).toBe(seqs[i - 1]! + 1) // 单调连续
    expect(seqs[0]).toBe(12)
    expect(battle.fxSeq).toBe(60)
    // UI 消费语义（BattleScreen 同款）：记 lastSeq 后继续出新事件 → filter 可拿到，不被裁剪吞掉
    const lastSeen = battle.fx[battle.fx.length - 1]!.seq // = 59
    pushBattleFx(battle, { atMs: 60_000, side: 'me', tag: 'player', type: 'explosive', hit: true })
    expect(battle.fx.length).toBe(48)
    const fresh = battle.fx.filter((f) => f.seq > lastSeen)
    expect(fresh.map((f) => f.seq)).toEqual([60])
    expect(fresh[0]!.atMs).toBe(60_000)
  })
})
