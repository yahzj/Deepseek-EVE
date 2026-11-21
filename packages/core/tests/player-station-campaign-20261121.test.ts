import { describe, expect, it } from 'vitest'
import { STATION_STAGE_GOALS, cleanStationCampaign, createStationCampaign, declareStationIndependence, reconcileStationCampaign, stationCampaignView } from '../src/playerStation/campaign'

describe('第二阶段成果与独立确认', () => {
  it('无条件时不能跳过经营、团队与安全目标', () => {
    const state = createStationCampaign(), host = { fulfilled: () => false }
    expect(declareStationIndependence(state, host)).toEqual({ ok: false, reason: 'requirements' })
    expect(state.independent).toBe(false)
    expect(state.achieved).toEqual([])
  })
  it('目标只登记一次，已完成经历保留但不会自动宣布独立', () => {
    const state = createStationCampaign(), achieved = new Set<string>(['settlement', 'research'])
    const host = { fulfilled: (goal: string) => achieved.has(goal) }
    reconcileStationCampaign(state, host); reconcileStationCampaign(state, host)
    expect(state.achieved).toEqual(['settlement', 'research'])
    achieved.clear(); reconcileStationCampaign(state, host)
    expect(state.achieved).toEqual(['settlement', 'research']); expect(state.independent).toBe(false)
  })
  it('全部经历齐备后需显式确认，无材料/资产/外交接口或奖励重复入口', () => {
    const state = createStationCampaign(), host = { fulfilled: () => true }
    expect(stationCampaignView(state, host).canDeclare).toBe(true)
    expect(state.achieved).toEqual([])
    expect(declareStationIndependence(state, host)).toEqual({ ok: true })
    const snapshot = structuredClone(state)
    expect(declareStationIndependence(state, host)).toEqual({ ok: false, reason: 'completed' })
    expect(state).toEqual(snapshot)
    expect(cleanStationCampaign(JSON.parse(JSON.stringify(state)))).toEqual(state)
  })
  it('视图不泄露引用，读档拒绝未知/重复目标和未达成独立态', () => {
    const state = createStationCampaign(), host = { fulfilled: () => false }
    stationCampaignView(state, host).goals[0].achieved = true
    expect(state.achieved).toEqual([])
    for (const raw of [{ ...state, achieved: ['unknown'] }, { ...state, achieved: [STATION_STAGE_GOALS[0], STATION_STAGE_GOALS[0]] },
      { ...state, independent: true }, { ...state, independent: 'true' }]) expect(() => cleanStationCampaign(raw)).toThrow()
  })
})
