/** 新算法解析校准：分类计量，不用总物品单位冒充经济收益。 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { SIGNAL_AUTO_PROFILES, signalAutoFixture } from './signal-auto-estimate-fixture'
import { signalAutoEstimateOf, SIGNAL_AUTO_ESTIMATE_CONFIG } from '../packages/core/src/signalAuto/estimate'
import { SIGNAL_AUTO_COMBAT } from '../packages/core/src/signalAuto/combat'
import { wormholeAutoTechFactors, wormholeAutoHoldM3Of, wormholeAutoStart, advanceWormholeAuto } from '../packages/core/src/wormholeAuto'
import { cleanSignalAutoEstimate } from '../packages/core/src/signalAuto/save'
import { loadSaveFile, serializeSaveFile } from '../packages/core/src/save'

const directory = resolve(`tools/_ui-artifacts/signal-auto-estimate-${Date.now()}`)
mkdirSync(directory, { recursive: false })
const rows = [], samples = process.argv.includes('--smoke') ? 5 : 100
for (const profile of SIGNAL_AUTO_PROFILES) for (const fullTech of [false, true]) {
  const { state, ctx, roster, budget, admission } = signalAutoFixture(profile, fullTech)
  const tech = wormholeAutoTechFactors(state, ctx, roster), hold = wormholeAutoHoldM3Of(tech)
  const start = performance.now()
  for (const family of ['A', 'C', 'D', 'E', 'G'] as const) {
    const results = Array.from({ length: samples }, (_, i) => signalAutoEstimateOf(state, ctx, roster,
      { seed: i + 1, depth: 1, family, archetype: 'balanced' }, .8, tech, hold))
    for (const result of results) {
      assert.deepEqual(result.layers, results[0]!.layers)
      assert(result.ordinaryUsedM3 <= hold)
      assert.deepEqual(cleanSignalAutoEstimate(result), result)
      for (const gain of result.gains) assert(ctx.items.has(gain.itemId), gain.itemId)
    }
    const units = (prefix: string) => results.map(row => row.gains.filter(gain => gain.itemId.startsWith(prefix)).reduce((n, gain) => n + gain.units, 0))
    const stat = (values: number[]) => ({ min: Math.min(...values), max: Math.max(...values), mean: values.reduce((a, b) => a + b, 0) / values.length })
    rows.push({ profile, fullTech, family, samples, budget, mass: admission.totalMass, capability: results[0]!.capability,
      layers: results[0]!.layers, depth: results[0]!.depthReached, ordinaryM3: stat(results.map(row => row.ordinaryUsedM3)),
      oreUnits: stat(units('ore-voidmother')), commonM3: stat(units('wreck-').map((n, i) => n - units('wreck-rare-')[i]!)),
      rareM3: stat(units('wreck-rare-')), boxes: stat(units('box-')), essence: stat(units('mat-wh-essence')),
      cores: results.reduce((n, row) => n + row.cores.reduce((sum, core) => sum + core.n, 0), 0) })
  }
  // 正式派队/读档/到点结算验证一次，收益不能提前入账。
  const before = structuredClone(state.warehouse)
  assert(wormholeAutoStart(state, ctx, state.wormholeStock![0]!.id, roster).ok)
  assert.deepEqual(state.warehouse, before)
  const snapshot = state.wormholeAuto![0]!.estimate!
  const read = loadSaveFile(serializeSaveFile(state)).state
  assert.deepEqual(read.wormholeAuto![0]!.estimate, snapshot)
  read.gameMs = read.wormholeAuto![0]!.finishAtGameMs
  advanceWormholeAuto(read, ctx)
  assert.deepEqual(read.wormholeAutoReports![0]!.gains, snapshot.gains)
  assert.equal(read.wormholeAuto!.length, 0)
  console.log(JSON.stringify({ profile, fullTech, samples: samples * 5, runtimeMs: Math.round(performance.now() - start) }))
}
writeFileSync(resolve(directory, 'readings.json'), JSON.stringify({ samples, config: SIGNAL_AUTO_ESTIMATE_CONFIG, combat: SIGNAL_AUTO_COMBAT, rows,
  limitation: '独立合成合法固定配装，非等成本、非最优配置；只有同族同原型跨种子推进稳定，分类收益不等于货币价值；损伤仍用原规则。' }, null, 2), { encoding: 'utf8', flag: 'wx' })
console.log(JSON.stringify({ output: directory, cases: rows.length, estimates: rows.length * samples }))
