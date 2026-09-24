/**
 * **洞内挂载件 + 双方战斗速度**（船长 2026-09-16 两问）：
 * ①「检查洞内的A族挂载件是否生效」；②「在上方的距离条两端的上方分别显示敌我的战斗速度」。
 *
 * 本文件钉三件事：
 * 1. **开战首波也要登记敌方挂载件**（`battle.foeMounts`）：开战建档是内联播种（不走 `seedUnit`），
 *    首版只在 `seedUnit` 里累积 ⇒ 单波战斗的战报/悬停看不到挂载件（已修，此处钉住）。
 * 2. **A 族海盗挂载件的触发条件**：×1.6 / 30 秒只是"资格与参数"，真正开冲还要满足引擎两条触发之一
 *    （**够不着** 或 **距离 > 期望交距 + 1,000m**）⇒ 用真虫洞战斗端到端实测：距离被压住时不冲、能拉开时才冲。
 * 3. **双方战斗机动速度落盘**（`battle.meSpeedMps` / `foeSpeedMps`）：与距离拔河同一把尺（含我方推进器
 *    爆发、敌方冲锋倍率）⇒ 界面距离条两端直接读它。
 */
import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { addShipToFleet, createInitialState, createPlayerSpec, wormholeEnter, wormholeStartBattle, advanceWormhole, wormholeFamilyOfSeed } from '../src/index'
import { createFoeSpecs, wormholeDerivedAnomaly } from '../src/combat'

const ctx = buildSimContext()
const bal = ctx.balance.battle

/** A 族（海盗）种子的取法：`wormholeFamilyOfSeed` 修掉「恒 A」之后按种子现算 ⇒ 这里扫一个出来 */
const A_SEED = ((): number => {
  for (let s = 1; s <= 200; s++) if (wormholeFamilyOfSeed(s) === 'A') return s
  throw new Error('找不到 A 族种子')
})()

/** 起一趟真实虫洞（A 族海盗洞）并开一场节点战 */
function wormholeNode(fit: string[], thrusters: string[] = []) {
  const state = createInitialState({ nowWallMs: 0, seed: A_SEED })
  const ids = [addShipToFleet(state, 'sh-thresher'), addShipToFleet(state, 'sh-thresher')]
  state.shipId = ids[0]!
  for (const id of ids) state.fleet[id]!.fitted = { high: [...fit], mid: [...thrusters], low: [] }
  for (const a of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) state.warehouse.items[a] = 9_000
  expect(wormholeFamilyOfSeed(A_SEED), '本用例要求 A 族洞').toBe('A')
  expect(wormholeEnter(state, ctx, ids, A_SEED).ok).toBe(true)
  const run = state.wormhole.run!
  const g = run.grid!
  const cell = g.cells.find((c) => c.key === `${g.pos.q},${g.pos.r}`)!
  cell.place = 'ship'
  const r = wormholeStartBattle(state, ctx, 'node', 0)
  expect(r.ok, r.error ?? '').toBe(true)
  return {
    state,
    battle: run.battle!,
    tick: (toMs: number) => {
      state.gameMs = toMs
      advanceWormhole(state, ctx)
    },
  }
}

describe('洞内 A 族挂载件（端到端）', () => {
  it('开战首波即登记敌方挂载件（战报/悬停同源）', () => {
    const { battle } = wormholeNode(['mod-turret-kin-2'])
    expect(battle.wormhole?.cardId).toBe('wh-pirate-scout')
    // 2026-09-24 船长：「在虫洞内，A族添加一个挂载件：姿态陀螺仪：增加10%闪避」⇒ 首波名下多一件
    expect(battle.foeMounts).toEqual(['劫掠冲锋推进器', '姿态陀螺仪'])
  })

  it('规格层：A 族海盗 ×1.6 / 冷却 30 秒（挂载件解析到单位）＋ 姿态陀螺仪 +10pp 闪避', () => {
    const base = ctx.anomalies.get('wh-pirate-scout')!
    const derived = wormholeDerivedAnomaly(ctx, base, { depth: 1, kind: 'node', waves: 1 })
    for (const f of createFoeSpecs(derived, bal)) {
      expect(f.foeCanCharge).toBe(true)
      expect(f.foeChargeMul).toBe(1.6)
      expect(f.foeChargeCooldownMs).toBe(30_000)
      expect(f.foeMountNames).toEqual(['劫掠冲锋推进器', '姿态陀螺仪'])
      // 船级缺省 0.12 → 2026-09-24 提档 0.22 → 陀螺仪加算 +0.10 = 0.32
      expect(f.foeEvasionBonusAdd).toBe(0.1)
      expect(f.evasion).toBeCloseTo(0.32, 10)
    }
  })

  /**
   * **海盗速度不得低于本档舰种基准**（船长 2026-09-16「海盗的平均速度好像有些太慢」⇒ 甲案）。
   *
   * 旧值：两张洞内卡的护卫舰写了条目 `speedMul: 0.9` ⇒ 实速 `340 × 1.10 × 0.9 = 337 < 340`，
   * 违反船长 2026-09-11「A 族速度都快…每档都必须高于基准」；它当年逃过体检是因为那条契约把
   * **hidden 卡整类豁免**，而洞内三张卡恰好都标了 hidden（2026-09-16 已收窄成只豁免 `enc-*`）。
   */
  it('洞内 A 族海盗：每条编目实速都高于本档舰种基准（护卫 340 / 驱逐 295 / 巡洋 258）', () => {
    for (const id of ['wh-pirate-scout', 'wh-pirate-hunt', 'wh-pirate-warband']) {
      const card = ctx.anomalies.get(id)!
      for (const slot of card.ships ?? []) {
        const baseSpd = bal.hullClassBaseSpeedMps[slot.ship.hullClassTier]
        const spd = Math.round(baseSpd * slot.ship.speedRatio * (slot.speedMul ?? 1))
        expect(spd, `${id}/${slot.ship.name} 实速 ${spd} 应高于本档基准 ${baseSpd}`).toBeGreaterThan(baseSpd)
      }
    }
    // 逐条点名（修后实测：劫掠护卫舰 374 / 海盗快艇 391 / 精锐海盗头目舰 374）
    const corvette = ctx.anomalies.get('wh-pirate-scout')!.ships![0]!
    const spd = Math.round(bal.hullClassBaseSpeedMps[corvette.ship.hullClassTier] * corvette.ship.speedRatio * (corvette.speedMul ?? 1))
    expect(spd).toBe(374)
  })

  it('触发条件：距离被压住时不冲；能拉开（装推进器）才冲（×1.6 生效）', () => {
    const pinned = wormholeNode(['mod-turret-kin-2'])
    let pinnedCharged = false
    for (let t = 1_000; t <= 60_000; t += 1_000) {
      pinned.tick(t)
      if (Object.values(pinned.battle.foeCharges ?? {}).some((x) => x.on === true)) pinnedCharged = true
      if (pinned.battle.ended) break
    }
    expect(pinnedCharged, '距离压在期望交距附近 ⇒ 不该冲锋（触发条件不成立）').toBe(false)

    const opened = wormholeNode(['mod-turret-kin-2'], ['mod-prop-2', 'mod-prop-2'])
    let maxDist = 0
    let charged = 0
    for (let t = 1_000; t <= 60_000; t += 1_000) {
      opened.tick(t)
      maxDist = Math.max(maxDist, opened.battle.distanceM)
      charged = Math.max(charged, Object.values(opened.battle.foeCharges ?? {}).filter((x) => x.on === true).length)
      if (opened.battle.ended) break
    }
    expect(maxDist, `应把距离拉到触发线（3,498m）之外（实测最大 ${Math.round(maxDist)}m）`).toBeGreaterThan(3_498)
    expect(charged, '拉开距离后应真的冲锋').toBeGreaterThan(0)
  })
})

/**
 * **双方速度（距离条两端显示的数据源）**——船长 2026-09-16：
 * 「在上方的距离条两端的上方分别显示敌我的战斗速度」＋「**战斗中实际速度和面板显示的机动速度不一致**」
 * ⇒ 裁决「**只修改战斗显示数值，实际数值不变动**」。
 *
 * 于是两套口径并存：
 * - **引擎推进 / 距离拔河** = `combatSpeed(...)`（含全局 `speedFactor 0.6` 与敏捷修正）——**一字不动**；
 * - **界面显示**（`battle.meSpeedMps / foeSpeedMps`）= 单位 `speedMps` × 机动倍率、逐单位平均
 *   ⇒ **与装配页「机动速度 / 加力推进点火期」、敌卡「实速」同一把尺**。
 */
describe('双方速度落盘（面板同源口径）', () => {
  it('首拍前缺省；落盘值 = 单位自身速度（不含 ×0.6 折算），与面板同一把尺', () => {
    const { state, battle, tick } = wormholeNode(['mod-turret-kin-2'], ['mod-prop-2'])
    expect(battle.meSpeedMps, '首拍之前缺省').toBeUndefined()
    tick(1_000)
    expect(battle.meSpeedMps!).toBeGreaterThan(0)
    expect(battle.foeSpeedMps!).toBeGreaterThan(0)
    // 敌方：该卡单位自身的 speedMps（未冲锋 ⇒ 倍率 1），**不再乘 speedFactor/敏捷**
    const base = ctx.anomalies.get('wh-pirate-scout')!
    const derived = wormholeDerivedAnomaly(ctx, base, { depth: 1, kind: 'node', waves: 1 })
    const foe0 = createFoeSpecs(derived, bal)[0]!
    expect(Math.abs(battle.foeSpeedMps! - foe0.speedMps)).toBeLessThanOrEqual(1)
    // 我方：本船 spec.speedMps ×（点火期含推进器倍率）⇒ 必落在 [基础值, 点火期值] 区间内
    const mine = createPlayerSpec(state, ctx, state.shipId)!
    const boost = 1 + (mine.thrusterBoost ?? 0)
    expect(battle.meSpeedMps!).toBeGreaterThanOrEqual(Math.round(mine.speedMps) - 1)
    expect(battle.meSpeedMps!).toBeLessThanOrEqual(Math.round(mine.speedMps * boost) + 1)
  })

  it('冲锋期：敌方显示值 = 实速 × 冲锋倍率（与敌卡「实速」同尺）', () => {
    // 拉开距离逼它冲锋（与上一条同款配装）
    const { battle, tick } = wormholeNode(['mod-turret-kin-2'], ['mod-prop-2', 'mod-prop-2'])
    const base = ctx.anomalies.get('wh-pirate-scout')!
    const derived = wormholeDerivedAnomaly(ctx, base, { depth: 1, kind: 'node', waves: 1 })
    const rawSpeed = createFoeSpecs(derived, bal)[0]!.speedMps
    let sawCharge = false
    for (let t = 1_000; t <= 60_000; t += 1_000) {
      tick(t)
      if (Object.values(battle.foeCharges ?? {}).some((x) => x.on === true)) {
        sawCharge = true
        // 显示值应抬到 实速 × 1.6（允许取整 ±2）
        expect(Math.abs(battle.foeSpeedMps! - rawSpeed * 1.6)).toBeLessThanOrEqual(2)
        break
      }
      if (battle.ended) break
    }
    expect(sawCharge, '本用例需要它真的冲起来').toBe(true)
  })
})