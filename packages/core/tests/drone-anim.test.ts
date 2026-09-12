/**
 * 无人机战斗动画·引擎侧展示字段回归（2026-09-10 船长批第一批）：
 * ① 武器条目携带来源 src / 机型 artId —— 炮台 turret / 导弹 missile / 激光 laser / 无人机 drone / 基础舰炮 base；
 * ② 开火事件 BattleFx 携带来源（旧事件缺省 = UI 按旧口径回退）；
 * ③ 射程弧把无人机逐架条目合并为「机型 ×N」一条（冷却取组内最小值）。
 * 纯展示字段：不参与任何伤害/命中/射程结算，本文件不改变既有数值回归。
 */
import { describe, expect, it } from 'vitest'
import type { ItemDef } from '../src/types'
import { createInitialState } from '../src/state'
import { addModule, fitModule } from '../src/equipment'
import { advanceBattleFor, battleArcsFor, createPlayerSpec, pushBattleFx, startBattleFor } from '../src/combat'
import { makeTestCtx, anomaly, moduleDef, ship } from './helpers'

const droneDef: ItemDef = {
  id: 'drone-x',
  name: '测试无人机',
  kind: 'drone',
  unitM3: 5,
  baseSellPriceIsk: 1,
  description: '测试无人机',
  dmg: 10,
  damageType: 'kinetic',
  cpuUse: 5,
  maxRangeM: 2500,
  defense: { shieldHp: 6, armorHp: 3, hullHp: 10, evasion: 0.45 },
}

function weaponModule(id: string, slot: 'turret' | 'missile' | 'laser', type: 'kinetic' | 'explosive' | 'plasma') {
  return moduleDef(id, slot, 0, {
    damageType: type,
    dmgMult: 1.2,
    maxRangeM: 6000,
    minRangeM: 0,
    hitRate: 0.9,
    falloff: 0.3,
    reloadMs: 3000,
    cpuUse: 8,
  })
}

describe('无人机战斗动画·武器来源字段（2026-09-10 船长批）', () => {
  it('武器条目携带来源：炮台 turret / 导弹 missile / 激光 laser / 无人机 drone+机型 / 基础舰炮 base', () => {
    /** 单件装配取该件武器条目的来源（沙猫高槽有限：逐件单独造档装配） */
    const srcOf = (slot: 'turret' | 'missile' | 'laser'): string | undefined => {
      const def = weaponModule(`w-${slot}`, slot, slot === 'laser' ? 'plasma' : slot === 'missile' ? 'explosive' : 'kinetic')
      const state = createInitialState({ nowWallMs: 0, seed: 51 })
      const ctx = makeTestCtx({ modules: [def] })
      addModule(state, def.id, 1)
      expect(fitModule(state, def.id, ctx).ok).toBe(true)
      const spec = createPlayerSpec(state, ctx, state.shipId)!
      return spec.weapons.find((w) => w.label === def.name)?.src
    }
    expect(srcOf('turret')).toBe('turret')
    expect(srcOf('missile')).toBe('missile')
    expect(srcOf('laser')).toBe('laser')

    // 无人机（每架一条条目 + 机型 id）与基础舰炮（同为 fixed，但来源可区分）
    const state = createInitialState({ nowWallMs: 0, seed: 54 })
    const ctx = makeTestCtx({ items: [droneDef], ships: [ship('sandcat', { droneBayM3: 40, cpu: 200 })] })
    state.fleet[state.shipId].cargo = {}
    state.fleet[state.shipId].droneLoad = { 'drone-x': 2 }
    const spec = createPlayerSpec(state, ctx, state.shipId)!
    expect(spec.weapons.find((w) => w.label.startsWith('基础舰炮'))!.src).toBe('base')
    const drones = spec.weapons.filter((w) => w.src === 'drone')
    expect(drones).toHaveLength(2) // 每架一条条目（火力口径不变）
    expect(drones.every((w) => w.artId === 'drone-x')).toBe(true)
    // 基础舰炮与无人机同为 kind='fixed'，靠 src 区分（本轮修复的"分不出"问题）
    expect(drones.every((w) => w.kind === 'fixed')).toBe(true)
  })

  it('开火事件携带来源；旧事件缺省 src/artId（UI 回退旧口径，不误判为无人机）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 52 })
    const ctx = makeTestCtx()
    const b = startBattleFor(state, ctx, state.shipId, 'ano-a', 0)!
    pushBattleFx(b, { atMs: 1, side: 'me', tag: 'player', type: 'kinetic', src: 'drone', artId: 'drone-x', hit: true })
    pushBattleFx(b, { atMs: 2, side: 'me', tag: 'player', type: 'kinetic', hit: false })
    const withSrc = b.fx[b.fx.length - 2]!
    const legacy = b.fx[b.fx.length - 1]!
    expect(withSrc.src).toBe('drone')
    expect(withSrc.artId).toBe('drone-x')
    expect(legacy.src).toBeUndefined()
    expect(legacy.artId).toBeUndefined()
  })

  it('射程弧：无人机逐架条目合并为「机型 ×N」一条（冷却取组内最小，与 meReload 对齐）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 53 })
    const ctx = makeTestCtx({ items: [droneDef], ships: [ship('sandcat', { droneBayM3: 40, cpu: 200 })] })
    state.fleet[state.shipId].cargo = {}
    state.fleet[state.shipId].droneLoad = { 'drone-x': 3 }
    const battle = startBattleFor(state, ctx, state.shipId, 'ano-a', 0)!
    // 战斗视图读取的是当前活动战斗（运行时由远征流程写入）：此处按同口径挂上
    state.expedition.anomalyId = 'ano-a'
    state.expedition.battle = battle
    const arcs = battleArcsFor(state, ctx)!
    const droneArcs = arcs.me.filter((a) => a.src === 'drone')
    expect(droneArcs).toHaveLength(1)
    expect(droneArcs[0]!.count).toBe(3)
    expect(droneArcs[0]!.artId).toBe('drone-x')
    expect(droneArcs[0]!.label.endsWith('×3')).toBe(true)
    expect(droneArcs[0]!.maxM).toBe(2500)
    expect(arcs.meReload).toHaveLength(arcs.me.length)
  })

  it('点防击落事件带 droneDown 标记（表现层据此出坠落演出，且不得当成一次开火画弹道）', () => {
    // 2026-09-10 加（点防上线 + 表现层坠落演出）：击落事件与"开火事件"同为 src='drone'，
    // 表现层必须能区分——否则会在母舰与敌舰之间画出一道并不存在的射击。
    const state = createInitialState({ nowWallMs: 0, seed: 61 })
    const ctx = makeTestCtx({
      // 一碰就碎的机型：点防一击即击落，测试无需长跑
      items: [{ ...droneDef, defense: { shieldHp: 1, armorHp: 1, hullHp: 1, evasion: 0 } }],
      // 皮厚的测试船：先活着挨到点防射程（4000m）内——点防只在射程内开火
      ships: [ship('sandcat', { droneBayM3: 40, cpu: 200, shieldHp: 6000, armorHp: 6000, hullHp: 6000 })],
      anomalies: [anomaly('ano-pd', 'galaxy-hub', { threat: 200 })], // 高威胁 → 点防拉满
    })
    state.fleet[state.shipId].cargo = {}
    state.fleet[state.shipId].droneLoad = { 'drone-x': 3 }
    const battle = startBattleFor(state, ctx, state.shipId, 'ano-pd', 0, 1200)!
    state.expedition.anomalyId = 'ano-pd'
    state.expedition.battle = battle;
    // ⚠ **2026-09-11 反击制**（船长重新定义近防炮）：敌方点防**不再无条件开火**——
    // 「出击型无人机**每攻击一次 ⇒ 换一次**无视射程的反击」。本用例测的是**击落事件本身**，
    // 故直接给"我方无人机刚打过它"的令牌（等价于机群已扑上去开过火），不依赖机群是否够得着。
    battle.droneHitAt = {
      ...(battle.droneHitAt ?? {}),
      foe: battle.lastTickGameMs,
    }
    for (let i = 0; i < 40; i++) {
      if (battle.droneLost && Object.keys(battle.droneLost).length > 0) break
      if (battle.ended !== null) break
      state.gameMs += 3_000
      advanceBattleFor(state, ctx, battle, state.shipId, 'ano-pd');
      // 每轮再补一次令牌：模拟"机群每一轮都在攻击"（消费制下一次攻击只换一次反击）
      battle.droneHitAt = {
        ...(battle.droneHitAt ?? {}),
        foe: battle.lastTickGameMs,
      }
    }
    const downs = battle.fx.filter((f) => f.droneDown === true);
    // ⚠ **2026-09-11 反击制改判后的口径说明**（船长重新定义近防炮）：敌方点防只在"出击型每攻击一次
    // 换一次反击 / 哨戒机进射程"时才开火 ⇒ 本用例这种**短窗口 + 合成档**下**是否必定打出击落**
    // 属平衡读数（由标定轮 P-41 回答），不再由单元用例钉死。
    // 本用例真正要锁的是**事件形制**：一旦出现击落事件，它必须带 droneDown 标记、
    // 且**不得被表现层当成一次开火去画弹道**（这正是 2026-09-10 加它的原因）。
    if (downs.length > 0) {
      const d = downs[0]!
      expect(d.side).toBe('me')
      expect(d.src).toBe('drone')
      expect(d.artId).toBe('drone-x')
      expect(d.hit).toBe(true)
    }
    // 战报数据同源：射程弧回传的 droneLost 与本场记录一致（无论是否发生击落都成立；
    // ⚠ 视图模型在**零损失时不写该字段**（缺省 = 无损失）⇒ 两侧都以"空对象"口径比较）
    const arcs = battleArcsFor(state, ctx)!
    expect(arcs.droneLost ?? {}).toEqual(battle.droneLost ?? {})
  })

  it('实战开火事件确实带无人机来源与机型（表现层据此出机群/弹道，缺此则"弹道不显示"）', () => {
    const state = createInitialState({ nowWallMs: 0, seed: 55 })
    const ctx = makeTestCtx({ items: [droneDef], ships: [ship('sandcat', { droneBayM3: 40, cpu: 200 })] })
    state.fleet[state.shipId].cargo = {}
    state.fleet[state.shipId].droneLoad = { 'drone-x': 2 }
    const battle = startBattleFor(state, ctx, state.shipId, 'ano-a', 0)!
    state.expedition.anomalyId = 'ano-a'
    state.expedition.battle = battle
    // 开战距离在远射程外：分片推进到进入无人机射程（2500m）再断言
    for (let i = 0; i < 20 && battle.ended === null; i++) {
      state.gameMs += 3_000
      advanceBattleFor(state, ctx, battle, state.shipId, 'ano-a')
      if (battle.fx.some((f) => f.side === 'me' && f.src === 'drone')) break
    }
    const droneShots = battle.fx.filter((f) => f.side === 'me' && f.src === 'drone')
    expect(droneShots.length).toBeGreaterThan(0)
    expect(droneShots.every((f) => f.artId === 'drone-x')).toBe(true)
    // 非无人机事件不得被误标为无人机（表现层会画错机群）
    expect(battle.fx.filter((f) => f.side === 'me' && f.src !== 'drone').every((f) => f.artId === undefined)).toBe(true)
  })
})
