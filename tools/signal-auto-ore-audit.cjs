/** 自动探索母矿回归取证：node tools/signal-auto-ore-audit.cjs。
 * 使用合成状态、正式装配/派队/结算及确定性新旧模拟器对照；不读个人档，不改生产数据。
 * 依赖本地Git历史51092180及父提交、tsx/typescript；v0.1.0 / 档v31 / 2026-10-21。
 * 输出tools/_ui-artifacts/signal-auto-ore-audit-20261021；合成比例不代表全体玩家概率。
 */
const fs = require('node:fs')
const assert = require('node:assert/strict')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const Module = require('node:module')
require('tsx/cjs')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const core = require('../packages/core/src/index.ts')
const auto = require('../packages/core/src/wormholeAuto.ts')
const grids = require('../packages/core/src/wormholeGrid.ts')
const data = require('../packages/data/src/index.ts')
const current = require('../packages/core/src/wormholeAutoSim.ts')
const ctx = data.buildSimContext()
const repairBaseline = '5685ed39'
const gitSource = file => execFileSync('git', ['show', `${repairBaseline}:${file}`], { cwd: root, encoding: 'utf8', windowsHide: true })
const source = execFileSync('git', ['show', '51092180^:packages/core/src/wormholeAutoSim.ts'], { cwd: root, encoding: 'utf8', windowsHide: true })
function compile(source, name, overrides = {}) {
  const filename = path.join(root, 'packages/core/src', name + '.cjs')
  const loaded = new Module(filename, module)
  loaded.filename = filename
  loaded.paths = Module._nodeModulePaths(path.dirname(filename))
  const nativeRequire = loaded.require.bind(loaded)
  loaded.require = id => Object.hasOwn(overrides, id) ? overrides[id] : nativeRequire(id)
  loaded._compile(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename)
  return loaded.exports
}
const old = compile(source, '_historical-auto-sim')
const oldFoes = compile(execFileSync('git', ['show', '51092180^:packages/core/src/wormholeFoes.ts'], { cwd: root, encoding: 'utf8', windowsHide: true }), '_historical-foes')
const oldAll = compile(source, '_historical-auto-all', { './wormholeFoes': oldFoes })
const beforeSimSource = gitSource('packages/core/src/wormholeAutoSim.ts')
const beforeSim = compile(beforeSimSource, '_before-ore-fix-sim')
const currentSource = fs.readFileSync(path.join(root, 'packages/core/src/wormholeAutoSim.ts'), 'utf8')
const mixedGrid = { ...grids, wormholeMakeGrid(...args) {
  const grid = grids.wormholeMakeGrid(...args)
  for (const cell of grid.cells) cell.place = 'empty'
  const candidates = grid.cells.filter(cell => !grids.isExitCell(grid, cell) && grids.hexDistance(grid.start, cell) > 0)
    .sort((a, b) => grids.hexDistance(grid.start, a) - grids.hexDistance(grid.start, b))
  candidates[0].place = 'graveyard'
  candidates.find(cell => grids.hexDistance(grid.start, cell) >= 2).place = 'vein'
  return grid
} }
const mixed = []
for (const [key, impl] of [['current', compile(currentSource, '_mixed-new', { './wormholeGrid': mixedGrid })],
  ['beforeFix', compile(beforeSimSource, '_mixed-before-fix', { './wormholeGrid': mixedGrid })],
  ['oldBatch', compile(source, '_mixed-old', { './wormholeGrid': mixedGrid })]]) {
  const result = impl.wormholeAutoDescend({ seed: 71, startDepth: 1, totalMass: 0, holdM3: 3000, oreUnitM3: ctx.items.get('ore-voidmother').unitM3,
    miners: 4, salvagers: 4, scanRadius: 100, power: { dps: 1, ehp: 1 }, guardPowerOf: () => ({ dps: 1e12, ehp: 1e12 }), tech: { wreck: 1, ore: 1 } })
  mixed.push({ key, holdM3: 3000, historicalOrdinaryQuota: 750, ...result })
}
console.log('受控混合地点：', JSON.stringify(mixed))
const rows = []
for (const shipDef of ['sh-thresher', 'sh-nautilus']) for (const rigs of [1, 4]) for (const depth of [1, 5, 9]) for (const holdScale of [1, 3]) {
  const state = core.createInitialState({ nowWallMs: 0, seed: 21 })
  state.skills.trained['ai-expert'] = 6
  const fleet = Array.from({ length: 4 }, () => core.addShipToFleet(state, shipDef))
  const tf = auto.wormholeAutoTechFactors(state, ctx, fleet)
  const admission = core.wormholeAdmission(ctx, fleet)
  const hold = auto.wormholeAutoHoldM3Of(tf) * holdScale
  const statistics = { current: { zero: 0, ore: 0, wreck: 0, depth: 0 }, beforeFix: { zero: 0, ore: 0, wreck: 0, depth: 0 }, oldBatch: { zero: 0, ore: 0, wreck: 0, depth: 0 }, oldAll: { zero: 0, ore: 0, wreck: 0, depth: 0 } }
  for (let seed = 1; seed <= 200; seed++) {
    const options = { seed, startDepth: depth, totalMass: admission.totalMass, holdM3: hold, oreUnitM3: ctx.items.get('ore-voidmother').unitM3, miners: rigs, salvagers: rigs,
      scanRadius: 1 + core.wormholeScanBonusOf(ctx, fleet), power: { dps: 1e9, ehp: 1e9 }, guardPowerOf: () => ({ dps: 1, ehp: 1 }),
      techTurnBonus: Math.max(0, Math.round(tf.baseTurns * tf.turnMul) - tf.baseTurns), tech: { wreck: tf.wreck, ore: tf.ore } }
    for (const [key, impl] of [['current', current], ['beforeFix', beforeSim], ['oldBatch', old], ['oldAll', oldAll]]) {
      const result = impl.wormholeAutoDescend(options)
      const stat = statistics[key]
      stat.zero += result.oreUnits === 0 ? 1 : 0
      stat.ore += result.oreUnits
      stat.wreck += result.wreckM3
      stat.depth += result.depthReached
    }
  }
  rows.push({ shipDef, rigs, startDepth: depth, hold, samples: 200, newZero: statistics.current.zero, oldBatchZero: statistics.oldBatch.zero, oldAllZero: statistics.oldAll.zero,
    beforeFixZero: statistics.beforeFix.zero, beforeFixOre: statistics.beforeFix.ore / 200, newDepth: statistics.current.depth / 200, beforeFixDepth: statistics.beforeFix.depth / 200,
    newOre: statistics.current.ore / 200, oldBatchOre: statistics.oldBatch.ore / 200,
    oldAllOre: statistics.oldAll.ore / 200, newWreck: statistics.current.wreck / 200, oldAllWreck: statistics.oldAll.wreck / 200 })
}
if (process.argv.includes('--matrix')) console.table(rows)
const realRows = []
for (const level of ['plain', 'full']) {
  for (let seed = 1; seed <= 200; seed++) {
    const state = core.createInitialState({ nowWallMs: 0, seed: 21 })
    const fleet = Array.from({ length: 4 }, () => core.addShipToFleet(state, 'sh-nautilus'))
    state.skills.trained['ai-expert'] = 6
    for (const uid of fleet) state.fleet[uid].fitted = { high: ['mod-laser-3', 'mod-miner-3', 'mod-salvager-3'], mid: [], low: ['mod-cargo-3', 'mod-cargo-3', 'mod-cargo-3', 'mod-cargo-3'] }
    if (level === 'full') {
      for (const skill of ctx.skills.values()) state.skills.trained[skill.id] = 5
      state.research.levels = Object.fromEntries(core.matterTechNodes(ctx).map(node => [node.id, node.maxLevel]))
    }
    const tf = auto.wormholeAutoTechFactors(state, ctx, fleet)
    const options = { seed, startDepth: 1, totalMass: core.wormholeAdmission(ctx, fleet).totalMass, holdM3: auto.wormholeAutoHoldM3Of(tf), oreUnitM3: ctx.items.get('ore-voidmother').unitM3,
      miners: 4, salvagers: 4, scanRadius: 1 + core.wormholeScanBonusOf(ctx, fleet), power: { dps: 1e9, ehp: 1e9 }, guardPowerOf: () => ({ dps: 1, ehp: 1 }),
      techTurnBonus: Math.max(0, Math.round(tf.baseTurns * tf.turnMul) - tf.baseTurns), tech: { wreck: tf.wreck, ore: tf.ore } }
    const now = current.wormholeAutoDescend(options), before = oldAll.wormholeAutoDescend(options), unfixed = beforeSim.wormholeAutoDescend(options)
    realRows.push({ level, seed, hold: options.holdM3, currentOre: now.oreUnits, oldOre: before.oreUnits, beforeFixOre: unfixed.oreUnits,
      currentWreck: now.wreckM3, beforeFixWreck: unfixed.wreckM3, currentDepth: now.depthReached, beforeFixDepth: unfixed.depthReached })
  }
}
const beforeAutoSource = gitSource('packages/core/src/wormholeAuto.ts')
const oldSettlement = compile(beforeAutoSource, '_old-auto-settlement', { './wormholeAutoSim': oldAll })
const beforeSettlement = compile(beforeAutoSource, '_before-fix-settlement', { './wormholeAutoSim': beforeSim })
const realEntry = []
for (let seed = 1; seed <= 100; seed++) {
  const state = core.createInitialState({ nowWallMs: 0, seed: 21 })
  state.skills.trained['ai-expert'] = 6
  for (const skill of ctx.skills.values()) state.skills.trained[skill.id] = 5
  state.research.levels = Object.fromEntries(core.matterTechNodes(ctx).map(node => [node.id, node.maxLevel]))
  const fleet = Array.from({ length: 4 }, () => core.addShipToFleet(state, 'sh-nautilus'))
  for (const uid of fleet) {
    for (const id of ['mod-laser-3', 'mod-miner-3', 'mod-salvager-3', 'mod-cargo-3', 'mod-cargo-3', 'mod-cargo-3', 'mod-cargo-3']) {
      state.moduleBay[id] = (state.moduleBay[id] ?? 0) + 1
      const fitted = core.fitModule(state, id, ctx, { shipId: uid })
      if (!fitted.ok) throw new Error('非法测试配置:' + id + ':' + JSON.stringify(fitted))
    }
  }
  state.wormholeStock = []
  const stock = core.wormholeStockPush(state, ctx)
  stock.seed = seed
  stock.depth = 1
  stock.family = 'A'
  delete stock.expeditionRules
  const historical = structuredClone(state)
  const unfixed = structuredClone(state)
  const first = auto.wormholeAutoStart(state, ctx, stock.id, fleet)
  const second = oldSettlement.wormholeAutoStart(historical, ctx, stock.id, fleet)
  const third = beforeSettlement.wormholeAutoStart(unfixed, ctx, stock.id, fleet)
  if (!first.ok || !second.ok || !third.ok) throw new Error('无法真实派队:' + JSON.stringify([first, second, third]))
  state.gameMs = historical.gameMs = auto.WORMHOLE_AUTO_DURATION_MS + 1
  unfixed.gameMs = state.gameMs
  auto.advanceWormholeAuto(state, ctx)
  oldSettlement.advanceWormholeAuto(historical, ctx)
  beforeSettlement.advanceWormholeAuto(unfixed, ctx)
  const now = auto.wormholeAutoReportsOf(state)[0], old = auto.wormholeAutoReportsOf(historical)[0]
  const before = auto.wormholeAutoReportsOf(unfixed)[0]
  const normalWreck = report => report.gains.filter(g => g.itemId.startsWith('wreck-') && !g.itemId.startsWith('wreck-rare-')).reduce((n, g) => n + g.units, 0)
  const prefixUnits = (report, prefix) => report.gains.filter(g => g.itemId.startsWith(prefix)).reduce((n, g) => n + g.units, 0)
  const ore = now.gains.find(g => g.itemId === 'ore-voidmother')?.units ?? 0
  assert.equal(state.warehouse.items['ore-voidmother'] ?? 0, ore, `种子${seed}仓库与报告不一致`)
  realEntry.push({ seed, currentOre: now.gains.find(g => g.itemId === 'ore-voidmother')?.units ?? 0,
    beforeFixOre: before.gains.find(g => g.itemId === 'ore-voidmother')?.units ?? 0,
    currentWreck: normalWreck(now), beforeFixWreck: normalWreck(before),
    currentRare: prefixUnits(now, 'wreck-rare-'), beforeFixRare: prefixUnits(before, 'wreck-rare-'),
    currentBoxes: prefixUnits(now, 'box-'), beforeFixBoxes: prefixUnits(before, 'box-'),
    currentEssence: prefixUnits(now, 'mat-wh-essence'), beforeFixEssence: prefixUnits(before, 'mat-wh-essence'),
    oldOre: old.gains.find(g => g.itemId === 'ore-voidmother')?.units ?? 0,
    currentWarehouse: state.warehouse.items['ore-voidmother'] ?? 0,
    oldWarehouse: historical.warehouse.items['ore-voidmother'] ?? 0,
    currentGains: now.gains })
}
const averages = Object.fromEntries(['currentOre', 'beforeFixOre', 'currentWreck', 'beforeFixWreck', 'currentRare', 'beforeFixRare',
  'currentBoxes', 'beforeFixBoxes', 'currentEssence', 'beforeFixEssence'].map(key => [key, realEntry.reduce((n, row) => n + row[key], 0) / realEntry.length]))
console.log('真实入口与结算:', JSON.stringify({ samples: realEntry.length, currentZero: realEntry.filter(row => !row.currentOre).length,
  beforeFixZero: realEntry.filter(row => !row.beforeFixOre).length, oldZero: realEntry.filter(row => !row.oldOre).length,
  averages,
  seed10: realEntry.find(row => row.seed === 10), firstRegression: realEntry.find(row => !row.currentOre && row.oldOre > 0) }))
for (const level of ['plain', 'full']) {
  const sample = realRows.filter(row => row.level === level)
  console.log('真实货舱参数：', JSON.stringify({ level, hold: sample[0].hold, samples: sample.length,
    currentZero: sample.filter(row => !row.currentOre).length, oldZero: sample.filter(row => !row.oldOre).length,
    beforeFixZero: sample.filter(row => !row.beforeFixOre).length, currentDepth: sample.reduce((n, row) => n + row.currentDepth, 0) / sample.length,
    beforeFixDepth: sample.reduce((n, row) => n + row.beforeFixDepth, 0) / sample.length,
    firstNewZero: sample.find(row => !row.currentOre && row.oldOre > 0) }))
}
const devices = { minerSlot: ctx.modules.get('mod-miner-3').slot, salvagerSlot: ctx.modules.get('mod-salvager-3').slot,
  legacyFilterMatches: ['mod-miner-3', 'mod-salvager-3'].filter(id => ctx.modules.get(id).slot === 'turret').length }
console.log('设备分类核查:', JSON.stringify(devices))
// oldBatch只切换批量模块；oldAll还切换层收益函数。其他数据、正式结算代码均用当前版本。
const out = path.join(root, 'tools/_ui-artifacts/signal-auto-ore-audit-20261021')
fs.mkdirSync(out, { recursive: true })
const baseline = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim()
fs.writeFileSync(path.join(out, 'batch-comparison.json'), JSON.stringify({ baseline, historicalModule: '51092180^',
  repairBaseline, currentDefinitionsBothSides: true, beforeSettlement: repairBaseline, mixed, rows, realRows, realEntry, devices }, null, 2), 'utf8')
