/** 守墓三件装备独立合成门槛，v0.1.0/档v31，2026-10-16；不读取个人档。 */
import { buildSimContext } from '@whale/data'
import { addShipToFleet, createInitialState, fitModule, fittedCpuUsed, cpuBudgetOf, fleetDefOf } from '@whale/core'
import type { GameState } from '@whale/core'
import { advanceBattleFor } from '../packages/core/src/combat'
import { weekendStartFlagshipBattle } from '../packages/core/src/weekendLaunch'
import { noteRailAttack, syncPlayerCrisis } from '../packages/core/src/gravekeeperGear'
import { createPlayerSpec } from '../packages/core/src/playerSpec'
import { serializeSaveFile } from '../packages/core/src/save'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const GRAVEKEEPER_GEAR_IDS = ['mod-gravekeeper-rebirth', 'mod-gravekeeper-crisis', 'mod-gravekeeper-rail'] as const

export function injectGravekeeperGearFixture(state: GameState): string[] {
  const ctx = buildSimContext()
  Object.assign(state, createInitialState({ nowWallMs: Date.now(), seed: 16102026 }))
  state.wallet.isk = 1e9
  state.standings.dsi = 100
  state.standingsEarned = { dsi: 100 }
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  for (const skill of ctx.skills.keys()) state.skills.trained[skill] = 3
  for (const item of ctx.items.values()) if (item.kind === 'ammo' || item.kind === 'drone') state.warehouse.items[item.id] = 10000
  state.warehouse.items['repairkit-dc'] = 100
  state.warehouse.items['repairkit-mil'] = 100
  state.warehouse.items['wreck-rare-d-inv'] = 300
  for (const module of ctx.modules.keys()) state.moduleBay[module] = 10
  const rail = addShipToFleet(state, 'sh-megalodon')
  const drone = addShipToFleet(state, 'sh-wh-e-carrier')
  state.shipId = rail
  for (const [sid, racks] of [
    [rail, { high: Array(4).fill(GRAVEKEEPER_GEAR_IDS[2]), mid: [GRAVEKEEPER_GEAR_IDS[1], 'mod-shield-pla-2'], low: [GRAVEKEEPER_GEAR_IDS[0], 'mod-armor-plate-2'] }],
    [drone, { high: [], mid: [GRAVEKEEPER_GEAR_IDS[1], GRAVEKEEPER_GEAR_IDS[1]], low: [GRAVEKEEPER_GEAR_IDS[0]] }],
  ] as const) {
    for (const rack of ['high', 'mid', 'low'] as const) for (const id of racks[rack]) {
      const result = fitModule(state, id, ctx, { shipId: sid, rack })
      if (!result.ok) throw new Error(`测试档配装拒绝:${id}:${result.error}`)
    }
    const hull = fleetDefOf(state, ctx, sid)!
    if (fittedCpuUsed(state.fleet[sid]!.fitted, ctx, hull) > cpuBudgetOf(state, ctx, sid)) throw new Error('测试档CPU超载')
  }
  state.fleet[drone]!.droneLoad = { 'drone-assault': 8 }
  state.weekendPrepSquad = [rail, drone]
  state.weekendEvent = { seq: 916, family: 'D', coreId: 'galaxy-maw', peripheryIds: ['galaxy-cinder'],
    startedAtWallMs: Date.now(), contributed: { 'galaxy-maw': 1, 'galaxy-cinder': 1 } }
  return ['独立合成装备验收档，巨齿鲨挂4门磁轨炮、危机协议与苏生；巨构机库船挂双危机与苏生。',
    '备三件新装备、组件、弹药、无人机及守墓稀有残骸；核心已收复，未代开战。先备份现有档，再导入测试档。']
}

if (process.argv.includes('--smoke-save') && /gravekeeper-gear-fixture\.(ts|js)$/.test(process.argv[1] ?? '')) {
  const state = createInitialState({ nowWallMs: Date.now() })
  injectGravekeeperGearFixture(state)
  const ctx = buildSimContext()
  state.weekendEvent!.flagshipHpMax = 300000
  const b = weekendStartFlagshipBattle(state, ctx, Date.now(), [state.shipId])!
  b.waveIdx = 3
  state.gameMs = 10
  advanceBattleFor(state, ctx, b, state.shipId, 'gravekeeper-flagship')
  b.units.player!.hp.s = 0
  const spec = createPlayerSpec(state, ctx, state.shipId)!
  syncPlayerCrisis(b, [spec])
  for (let i = 0; i < 3; i++) noteRailAttack(b, spec, 0, spec.weapons[0]!.reloadMs)
  state.encounter = { ...state.encounter, active: true, shipId: state.shipId, galaxyId: 'galaxy-maw',
    name: ctx.anomalies.get('gravekeeper-flagship')!.name, threat: 196, anomalyId: 'gravekeeper-flagship',
    origin: '入侵', invitedAtGameMs: 0, deadlineGameMs: 999999, battle: b }
  const output = resolve('tools/_ui-artifacts/gravekeeper-invasion')
  mkdirSync(output, { recursive: true })
  writeFileSync(resolve(output, 'gear-smoke-save.json'), serializeSaveFile(state), 'utf8')
}
