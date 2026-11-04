/** 功能级6/24小时试跑，不调参数，不把少量种子结果作为平衡结论。 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { industrialTransportFixture } from './make-industrial-transport-save'
import { startHauling } from '../packages/core/src/hauling'
import { advanceGame } from '../packages/core/src/engine'
import { loadSaveFile, serializeSaveFile } from '../packages/core/src/save'
import { haulFleetPathOf } from '../packages/core/src/hauling/fleet'
import { haulRiskPreviewOf } from '../packages/core/src/hauling/preview'
import { spawnIndustrialEncounter } from '../packages/core/src/encounters/industrial'
import { collectExposures } from '../packages/core/src/encounters/presence'

const results: unknown[] = []
for (const hours of [6, 24]) for (const fraction of [0.25, 1]) {
  const { state, ctx, roster, cap } = industrialTransportFixture()
  const destination = [...ctx.stations.values()].find(site => haulFleetPathOf(state, ctx, roster, 'galaxy-hub', site.galaxyId).some(row => (ctx.galaxies.get(row.galaxyId)?.security ?? 1) <= 0))!
  assert(destination)
  const amount = Math.floor(cap * fraction)
  const start = state.wallet.isk
  const started = startHauling(state, null, destination.id, ctx, amount)
  assert(started.ok, started.errorId)
  state.logCap = 100_000
  state.rng = { seed: 7, count: 0 }
  const now = performance.now()
  const dangerous = state.hauling.fleetLeg!.path.find(row => (ctx.galaxies.get(row.galaxyId)?.security ?? 1) <= 0)!
  const probe = structuredClone(state)
  const directSpawn = spawnIndustrialEncounter(probe, ctx, { galaxyId: dangerous.galaxyId, shipId: state.shipId, kind: '停留' })
  assert(directSpawn, '合法运输队伍必须能创建统一海盗战斗')
  for (let hour = 0; hour < hours; hour++) advanceGame(state, 3_600_000, ctx, { offline: true, nowWallMs: state.savedAtWallMs + (hour + 1) * 3_600_000 })
  const loaded = loadSaveFile(serializeSaveFile(state)).state
  assert.deepEqual(loaded.hauling, state.hauling)
  assert.deepEqual(loaded.encounter.pirate, state.encounter.pirate)
  assert.deepEqual(loaded.industrialProtection, state.industrialProtection)
  const deliveries = state.logs.filter(row => row.textId === 'core.industrial.004')
  const report = { hours, cargoFraction: fraction, selectedM3: amount, station: destination.id,
    deliveredM3: deliveries.reduce((sum, row) => sum + Number(row.textParams?.p2 ?? 0), 0),
    transportRevenue: deliveries.reduce((sum, row) => sum + Number(row.textParams?.p3 ?? 0), 0),
    attacks: state.logs.filter(row => row.textId === 'core.industrial.007').length,
    walletChangeIncludingOtherSystems: state.wallet.isk - start,
    fleetLost: roster.filter(id => !state.fleet[id]).length,
    transportActive: state.hauling.active, encounterActive: state.encounter.active,
    preview: haulRiskPreviewOf(state, ctx, roster.filter(id => !!state.fleet[id]), amount, 'galaxy-hub', destination.galaxyId),
    protection: state.industrialProtection, nextEvent: state.events.nextAtGameMs, rngCount: state.rng.count,
    exposuresAtEnd: collectExposures(state, ctx), directSpawn,
    runtimeMs: Math.round(performance.now() - now) }
  results.push(report)
  console.log(JSON.stringify(report))
}
const directory = resolve('tools/_ui-artifacts/industrial-transport-20261101')
mkdirSync(directory, { recursive: true })
writeFileSync(resolve(directory, 'simulation.json'), JSON.stringify({ ok: true, results, limitation: '单种子合法合成队伍，仅检查功能及账目；参数未调，结果不是平衡结论。' }, null, 2), 'utf8')
