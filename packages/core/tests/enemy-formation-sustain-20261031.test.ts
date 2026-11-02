import { describe, expect, it } from 'vitest'
import { buildSimContext } from '@whale/data'
import { createPlayerSpec } from '../src/combat/player/create'
import { commandBudgetOf } from '../src/combat/command/rules'
import { DEFENSIVE_MIX_PROFILE, oldFormationContext, runSustainCampaign, SUSTAIN_PROFILES, supplyCount, supplyPrice,
  sustainFixture, withoutSupportTraits } from '../../../tools/enemy-formation-sustain'

const ctx = buildSimContext()
const mixed = SUSTAIN_PROFILES.find(profile => profile.id === 'mixed')!

describe('敌卡持续作战校准账本', () => {
  it('五套合成舰队装配合法且预算不超125，初始化不夹带首胜收益', () => {
    for (const profile of SUSTAIN_PROFILES) {
      const { state, roster, budget } = sustainFixture(ctx, profile, 1)
      expect(budget.ok, profile.id).toBe(true)
      expect(budget.cost).toBeLessThanOrEqual(125)
      expect(commandBudgetOf(state, ctx, roster).capacity).toBe(125)
      expect(state.preparationSquads?.combat).toEqual(roster)
      expect(state.completedBounties).toContain('ano-training')
      expect(state.expedition.active).toBe(false)
    }
  })

  it('隔离关闭辅助特性时船体装配、库存与指挥成本不变', () => {
    const off = withoutSupportTraits(ctx)
    const before = sustainFixture(ctx, mixed, 1), after = sustainFixture(off, mixed, 1)
    expect(after.state.fleet).toEqual(before.state.fleet)
    expect(after.state.warehouse).toEqual(before.state.warehouse)
    expect(after.budget).toEqual(before.budget)
    expect(createPlayerSpec(before.state, ctx, 'sh-wh-g-destroyer')!.repairOutputBonusPct).toBe(.5)
    expect(createPlayerSpec(after.state, off, 'sh-wh-g-destroyer')!.repairOutputBonusPct).toBe(0)
    expect(ctx.ships.get('sh-wh-d-frigate')!.foeRangeDebuffPct).toBe(.15)
    expect(off.ships.get('sh-wh-d-frigate')!.foeRangeDebuffPct).toBe(0)
    expect(ctx.ships.get('sh-wh-d-frigate')!.rangeEwBonus).toBe(40)
    expect(off.ships.get('sh-wh-d-frigate')!.rangeEwBonus).toBe(0)
    expect(off.ships.get('sh-wh-d-frigate')!.rangeEwEquipmentBonusPct).toBe(0)
    expect(ctx.ships.get('sh-wh-g-destroyer')!.repairPulseTargetsFleet).toBeUndefined()
  })

  it('机群装载只是转移库存，不能把装载当成消耗', () => {
    const { state } = sustainFixture(ctx, mixed, 1)
    const uid = state.shipId
    const before = supplyCount(state, 'drone-scout')
    state.warehouse.items['drone-scout']! -= 3
    state.fleet[uid]!.cargo['drone-scout'] = 1
    state.fleet[uid]!.droneLoad!['drone-scout']! += 2
    expect(supplyCount(state, 'drone-scout')).toBe(before)
  })

  it('辅助加防护使用原空槽且不改变船体、人数与90点指挥成本', () => {
    const before = sustainFixture(ctx, mixed, 1), after = sustainFixture(ctx, DEFENSIVE_MIX_PROFILE, 1)
    expect(after.roster).toEqual(before.roster)
    expect(after.budget.cost).toBe(90)
    for (const uid of ['sh-wh-g-destroyer', 'sh-wh-d-frigate']) {
      const low = createPlayerSpec(before.state, ctx, uid)!, high = createPlayerSpec(after.state, ctx, uid)!
      expect(high.hp.s).toBeGreaterThan(low.hp.s)
      expect(high.hp.a).toBeGreaterThan(low.hp.a)
      expect(after.assetValues[uid]).toBeGreaterThan(before.assetValues[uid]!)
    }
  })

  it('同种子同配装的完整连续路线可复现，结算补给和末尾维修负债均入净额', () => {
    const first = runSustainCampaign(ctx, mixed, 'ano-voidedge-warden', 7, 1, 'continuous', 3)
    const second = runSustainCampaign(ctx, mixed, 'ano-voidedge-warden', 7, 1, 'continuous', 3)
    expect(second).toEqual(first)
    expect(first.rounds).toBeGreaterThan(0)
    const cost = Object.entries(first.consumed).reduce((sum, [id, n]) => sum + n * supplyPrice(ctx, id), 0)
    expect(first.supplyCost).toBe(cost)
    expect(first.net).toBe(first.walletDelta - cost - first.replacement - first.repairDebt)
    expect(first.netPerHour).toBeCloseTo(first.net * 3600 / first.seconds, 6)
    expect(first.seconds).toBeCloseTo(first.records.reduce((sum, row) => sum + row.cycleSeconds, 0), 6)
    expect(first.records.every(row => row.cycleSeconds > row.seconds)).toBe(true)
    expect(first.records[0]!.before.every(row => row.armor === 1 && row.hull === 1)).toBe(true)
    for (let i = 1; i < first.records.length; i++) {
      expect(first.records[i]!.before).toEqual(first.records[i - 1]!.after)
    }
  })

  it('港内全修后再次开战为满甲满结构，旧编成上下文保持原基线', () => {
    const legacy = oldFormationContext(ctx)
    const result = runSustainCampaign(legacy, mixed, 'ano-voidedge-warden', 13, 0, 'port', 2)
    expect(result.rounds).toBe(2)
    expect(result.repairDebt).toBe(0)
    expect(result.records.every(row => row.after.every(ship => ship.armor === 1 && ship.hull === 1))).toBe(true)
    expect(result.portRepair).toBe(result.records.reduce((sum, row) => sum + row.portRepair, 0))
    expect(legacy.anomalies.get('ano-voidedge-warden')).toBe(ctx.anomalies.get('ano-voidedge-warden')!.foeFormation!.baseline)
  })

  it('连续路线遇到僚舰损伤门禁会停下，不把首场胜利当成可连续五场', () => {
    const result = runSustainCampaign(ctx, mixed, 'ano-vault-sentinel', 13, 1, 'continuous', 5)
    expect(result.rounds).toBe(1)
    expect(result.wins).toBe(1)
    expect(result.stopped).toBe('编队舰船耐久不足')
    expect(result.repairDebt).toBeGreaterThan(0)
    expect(result.sunk).toEqual([])
    expect(result.records[0]!.after.find(ship => ship.uid === 'sh-wh-g-destroyer')!.armor).toBeLessThan(.5)
  })

  it('港内全修也不补回实战沉船，船体与装配单独计损且停止路线', () => {
    const weak = { id: 'loss-check', name: '沉船计损', fleet: ['sh-wh-g-destroyer'] }
    const result = runSustainCampaign(ctx, weak, 'ano-vault-sentinel', 13, 1, 'port', 3)
    expect(result.rounds).toBe(1)
    expect(result.wins).toBe(0)
    expect(result.sunk).toEqual(['sh-wh-g-destroyer'])
    expect(result.stopped).toBe('实际沉船或弃船，停止并计入船体与装配损失')
    expect(result.replacement).toBeGreaterThan(0)
    expect(result.records.at(-1)!.missing).toEqual(result.sunk)
    expect(result.net).toBe(result.walletDelta - result.supplyCost - result.replacement - result.repairDebt)
  })
})
