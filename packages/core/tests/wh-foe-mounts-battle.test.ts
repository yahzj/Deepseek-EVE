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
import { addShipToFleet, createInitialState, wormholeEnter, wormholeStartBattle, advanceWormhole, wormholeFamilyOfSeed } from '../src/index'
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
    expect(battle.foeMounts).toEqual(['劫掠冲锋推进器'])
  })

  it('规格层：A 族海盗 ×1.6 / 冷却 30 秒（挂载件解析到单位）', () => {
    const base = ctx.anomalies.get('wh-pirate-scout')!
    const derived = wormholeDerivedAnomaly(ctx, base, { depth: 1, kind: 'node', waves: 1 })
    for (const f of createFoeSpecs(derived, bal)) {
      expect(f.foeCanCharge).toBe(true)
      expect(f.foeChargeMul).toBe(1.6)
      expect(f.foeChargeCooldownMs).toBe(30_000)
      expect(f.foeMountNames).toEqual(['劫掠冲锋推进器'])
    }
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

describe('双方战斗机动速度（距离条两端显示的数据源）', () => {
  it('逐拍落盘：首拍前缺省；落盘值与规格层同源（未冲锋 = 原始战斗机动速度）', () => {
    const { battle, tick } = wormholeNode(['mod-turret-kin-2'], ['mod-prop-2'])
    expect(battle.meSpeedMps, '首拍之前缺省').toBeUndefined()
    tick(1_000)
    expect(battle.meSpeedMps!).toBeGreaterThan(0)
    expect(battle.foeSpeedMps!).toBeGreaterThan(0)
    const base = ctx.anomalies.get('wh-pirate-scout')!
    const derived = wormholeDerivedAnomaly(ctx, base, { depth: 1, kind: 'node', waves: 1 })
    const foe0 = createFoeSpecs(derived, bal)[0]!
    const raw = Math.max(20, foe0.speedMps * bal.speedFactor * (1 + (foe0.agility - 0.5) * 2 * bal.agilitySpeedBonus))
    expect(Math.abs(battle.foeSpeedMps! - raw)).toBeLessThanOrEqual(1)
  })
})