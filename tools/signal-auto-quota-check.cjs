/** node tools/signal-auto-quota-check.cjs [--smoke]
 * 对照修前c48bdb0c8估算器与普通作业额度修复，使用相同当前内容、合法合成舰队和散布种子。
 * 只在内存编译固定提交源码；不恢复文件、不读取个人档、不比较整版客户端经济。
 * 输出tools/_ui-artifacts/signal-auto-quota-<时间戳>/report.json；分类数量不折现货柜。
 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const vm = require('node:vm')
const { execFileSync } = require('node:child_process')
const { createRequire } = require('node:module')
require('tsx/cjs')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const file = 'packages/core/src/signalAuto/estimate.ts'
const baseline = 'c48bdb0c8bd0472a7967e9855845d2177808d9d2'
const source = execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root, encoding: 'utf8', windowsHide: true })
const compiled = ts.transpileModule(source, { fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } })
const oldExports = {}
vm.runInNewContext(compiled.outputText, { exports: oldExports, require: createRequire(path.join(root, file)), console }, { filename: file })
const { signalAutoEstimateOf } = require('../packages/core/src/signalAuto/estimate.ts')
const { SIGNAL_AUTO_PROFILES, signalAutoFixture } = require('./signal-auto-estimate-fixture.ts')
const auto = require('../packages/core/src/wormholeAuto.ts')
const { cleanSignalAutoEstimate } = require('../packages/core/src/signalAuto/save.ts')
const { serializeSaveFile, loadSaveFile } = require('../packages/core/src/save.ts')
const { hashSeed } = require('../packages/core/src/rng.ts')
const families = ['A', 'C', 'D', 'E', 'G'], archetypes = ['balanced', 'wreck', 'ruins', 'vein', 'combat']
const samples = process.argv.includes('--smoke') ? 3 : 32
const fingerprint = () => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')
const before = fingerprint()
const canonical = value => JSON.parse(JSON.stringify(value))
function metrics(result) {
  const values = { ordinaryM3: result.ordinaryUsedM3, commonM3: 0, oreUnits: 0, rareM3: 0, boxes: 0, essence: 0,
    cores: result.cores.reduce((sum, row) => sum + row.n, 0), completedLayers: result.layers.reduce((sum, row) => sum + row.completion, 0) }
  for (const row of result.gains) {
    if (row.itemId.startsWith('wreck-rare-')) values.rareM3 += row.units
    else if (row.itemId.startsWith('wreck-')) values.commonM3 += row.units
    else if (row.itemId === 'ore-voidmother') values.oreUnits += row.units
    else if (row.itemId.startsWith('box-')) values.boxes += row.units
    else if (row.itemId === 'mat-wh-essence') values.essence += row.units
    else assert.fail(`未分类奖励:${row.itemId}`)
  }
  return values
}
const rows = []
let frozenChecks = 0
for (const profile of SIGNAL_AUTO_PROFILES) for (const fullTech of [false, true]) {
  const { state, ctx, roster } = signalAutoFixture(profile, fullTech)
  const initialState = canonical(state)
  const tech = auto.wormholeAutoTechFactors(state, ctx, roster), hold = auto.wormholeAutoHoldM3Of(tech)
  const sums = { before: {}, after: {} }
  let improved = 0, ordinaryLower = 0
  for (const family of families) for (const archetype of archetypes) {
    let firstLayers
    for (let index = 1; index <= samples; index++) {
      const signal = { seed: hashSeed(`signal-auto-quota-20261109/${index}`), depth: 1, family, archetype }
      const previous = canonical(oldExports.signalAutoEstimateOf(state, ctx, roster, signal, .8, tech, hold))
      const next = signalAutoEstimateOf(state, ctx, roster, signal, .8, tech, hold)
      assert.deepEqual(cleanSignalAutoEstimate(next), next)
      assert(next.ordinaryUsedM3 <= hold * .8)
      for (const row of next.gains) assert(ctx.items.has(row.itemId))
      for (let i = 1; i < next.layers.length; i++) assert(next.layers[i - 1].guardPassed, '不得跨过失败守卫')
      if (firstLayers) assert.deepEqual(next.layers, firstLayers, '推进不能随种子变化')
      firstLayers = next.layers
      const a = metrics(previous), b = metrics(next)
      assert(b.completedLayers >= a.completedLayers - 1e-9, '下潜预算不能倒退')
      improved += b.completedLayers > a.completedLayers + 1e-9 ? 1 : 0
      ordinaryLower += b.ordinaryM3 + 2 < a.ordinaryM3 ? 1 : 0
      for (const [version, data] of [['before', a], ['after', b]]) for (const [key, n] of Object.entries(data)) sums[version][key] = (sums[version][key] ?? 0) + n
      if (index === 1) {
        const finish = estimate => {
          const local = structuredClone(state)
          assert(auto.wormholeAutoStart(local, ctx, local.wormholeStock[0].id, roster).ok)
          // 模拟更新前已出发的快照；结算必须尊重这份奖励，不改算新结果。
          local.wormholeAuto[0].estimate = estimate
          const loaded = loadSaveFile(serializeSaveFile(local, 0)).state
          assert.deepEqual(loaded.wormholeAuto[0].estimate, estimate)
          loaded.gameMs = loaded.wormholeAuto[0].finishAtGameMs
          auto.advanceWormholeAuto(loaded, ctx)
          assert.equal(loaded.wormholeAuto.length, 0)
          const report = loaded.wormholeAutoReports[0]
          assert.deepEqual(report.gains, estimate.gains)
          assert.deepEqual(report.cores ?? [], estimate.cores)
          const settled = canonical(loaded)
          auto.advanceWormholeAuto(loaded, ctx)
          assert.deepEqual(canonical(loaded), settled)
          return report
        }
        const oldReport = finish(previous), newReport = finish(next)
        assert.deepEqual(newReport.damage, oldReport.damage, '损伤规则不得改变')
        frozenChecks++
      }
    }
  }
  assert.deepEqual(canonical(state), initialState, '估算不得修改来源状态')
  const count = families.length * archetypes.length * samples
  for (const version of Object.values(sums)) for (const key of Object.keys(version)) version[key] /= count
  const row = { profile, fullTech, samples: count, hold, improved, ordinaryLower, ...sums }
  rows.push(row)
  console.log(JSON.stringify(row))
}
assert.equal(fingerprint(), before)
const output = path.join(root, `tools/_ui-artifacts/signal-auto-quota-${Date.now()}`)
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ ok: true, baseline, sourceSha256: before, samplesPerCell: samples,
  pairs: rows.reduce((sum, row) => sum + row.samples, 0), frozenChecks, rows,
  limitation: '仅替换估算器，其他依赖用当前版本；非完整历史客户端对照。固定舰队和等权信号并非玩家分布，分类数量不等于信用点净收益。' }, null, 2), { encoding: 'utf8', flag: 'wx' })
console.log(JSON.stringify({ output, frozenChecks }))
