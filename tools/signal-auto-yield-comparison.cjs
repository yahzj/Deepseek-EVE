/** 新旧正式结算的配对收益对照；内存语法树插桩，不改生产文件或读取个人档。 */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const vm = require('node:vm')
const { createRequire } = require('node:module')
require('tsx/cjs')
const ts = require('typescript')
const ROOT = path.resolve(__dirname, '..')
const { SIGNAL_AUTO_PROFILES, signalAutoFixture } = require('./signal-auto-estimate-fixture.ts')
const auto = require('../packages/core/src/wormholeAuto.ts')
const sim = require('../packages/core/src/wormholeAutoSim.ts')
const { signalAutoEstimateOf } = require('../packages/core/src/signalAuto/estimate.ts')
const grids = require('../packages/core/src/wormholeGrid.ts')
const { hashSeed } = require('../packages/core/src/rng.ts')
const FILES = ['packages/core/src/wormholeAuto.ts', 'packages/core/src/wormholeAutoSim.ts',
  'packages/core/src/signalAuto/estimate.ts', 'packages/core/src/signalAuto/combat.ts', 'tools/signal-auto-estimate-fixture.ts']
const texts = Object.fromEntries(FILES.map(file => [file, fs.readFileSync(path.join(ROOT, file), 'utf8')]))
const fingerprint = () => Object.fromEntries(FILES.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex')]))
const beforeHash = fingerprint()
const canonical = value => JSON.parse(JSON.stringify(value))
const families = ['A', 'C', 'D', 'E', 'G']
const archetypes = ['balanced', 'wreck', 'ruins', 'vein', 'combat']
const samples = process.argv.includes('--smoke') ? 3 : 256
let activeTrace = null

function transpileModule(file, transformer, imports) {
  const result = ts.transpileModule(texts[file], { fileName: file,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    transformers: transformer ? { before: [transformer] } : undefined })
  const native = createRequire(path.join(ROOT, file))
  const exports = {}
  vm.runInNewContext(result.outputText, { exports, require: id => imports(id, native),
    __layerStart: (depth, out, turns) => activeTrace.layers.push({ depth, before: canonical(out), turns }),
    __layerEnd: (out, turns) => { activeTrace.final = canonical(out); activeTrace.turnsLeft = turns },
    __guardFailed: depth => activeTrace.guardFailures.push(depth), console }, { filename: path.join(ROOT, file) })
  return exports
}

function instrumentedSimulator(stopAtGuard) {
  let loops = 0, guards = 0, returns = 0
  const transformer = context => {
    const f = context.factory
    const call = (name, args) => f.createExpressionStatement(f.createCallExpression(f.createIdentifier(name), undefined, args.map(arg => f.createIdentifier(arg))))
    const transformFunction = node => {
      if (!ts.isFunctionDeclaration(node) || node.name?.text !== 'wormholeAutoDescend') return ts.visitEachChild(node, transformFunction, context)
      const visit = child => {
        if (ts.isForStatement(child) && child.initializer && ts.isVariableDeclarationList(child.initializer)
          && child.initializer.declarations.some(decl => ts.isIdentifier(decl.name) && decl.name.text === 'depth')) {
          loops++
          const body = ts.visitEachChild(child.statement, visit, context)
          assert(ts.isBlock(body))
          return f.updateForStatement(child, child.initializer, child.condition, child.incrementor,
            f.updateBlock(body, [call('__layerStart', ['depth', 'out', 'turns']), ...body.statements]))
        }
        if (ts.isIfStatement(child) && ts.isPrefixUnaryExpression(child.expression) && child.expression.operator === ts.SyntaxKind.ExclamationToken) {
          const expression = child.expression.operand
          if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === 'canWin'
            && expression.arguments.length === 2 && ts.isIdentifier(expression.arguments[1]) && expression.arguments[1].text === 'guard') {
            guards++
            assert(ts.isBlock(child.thenStatement))
            let continues = 0
            const statements = child.thenStatement.statements.map(statement => {
              if (!ts.isContinueStatement(statement)) return statement
              continues++
              return stopAtGuard ? f.createBreakStatement() : statement
            })
            assert.equal(continues, 1)
            return f.updateIfStatement(child, child.expression,
              f.updateBlock(child.thenStatement, [call('__guardFailed', ['depth']), ...statements]), child.elseStatement)
          }
        }
        if (ts.isReturnStatement(child)) {
          returns++
          return f.createBlock([call('__layerEnd', ['out', 'turns']), child], true)
        }
        return ts.visitEachChild(child, visit, context)
      }
      return ts.visitEachChild(node, visit, context)
    }
    return source => ts.visitNode(source, transformFunction)
  }
  const module = transpileModule('packages/core/src/wormholeAutoSim.ts', transformer, (id, native) => {
    if (id !== './wormholeGrid') return native(id)
    return { ...grids, wormholeMakeGrid: (...args) => {
      const grid = grids.wormholeMakeGrid(...args)
      activeTrace.grids.push({ depth: args[1], mapSeed: args[0], archetype: grids.wormholeArchetypeOf(args[0]) })
      return grid
    } }
  })
  assert.deepEqual([loops, guards, returns], [1, 1, 1], '旧模拟结构变化，停止插桩而非猜测')
  return { ...sim, wormholeAutoDescend: module.wormholeAutoDescend }
}

function oldRunner(stopAtGuard) {
  const instrumented = instrumentedSimulator(stopAtGuard)
  return transpileModule('packages/core/src/wormholeAuto.ts', null,
    (id, native) => id === './wormholeAutoSim' ? instrumented : native(id)).advanceWormholeAuto
}
const runOld = oldRunner(false), runGuardStop = oldRunner(true)

function stats(values) {
  assert(values.length > 0 && values.every(Number.isFinite))
  const sorted = [...values].sort((a, b) => a - b)
  // 线性插值分位数，所有新旧样本使用同一统计口径。
  const q = p => { const i = (sorted.length - 1) * p, lo = Math.floor(i); return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (i - lo) }
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const sd = Math.sqrt(values.reduce((n, value) => n + (value - mean) ** 2, 0) / values.length)
  return { samples: values.length, min: sorted[0], p05: q(.05), p50: q(.5), p95: q(.95), max: sorted.at(-1), mean,
    sd, cv: mean > 0 ? sd / mean : null, zeroShare: values.filter(value => value === 0).length / values.length }
}
assert.equal(stats([0, 1, 2, 3, 4]).p50, 2)
assert.equal(stats([0, 0]).cv, null)

function settle(template, ctx, run, runner) {
  const state = structuredClone(template)
  state.wormholeAuto = [structuredClone(run)]
  state.wormholeAutoReports = []
  state.gameMs = run.finishAtGameMs
  const warehouse = { ...state.warehouse.items }, cores = { ...state.aiCores }
  activeTrace = { layers: [], guardFailures: [], grids: [] }
  runner(state, ctx)
  const trace = activeTrace
  activeTrace = null
  assert.equal(state.wormholeAuto.length, 0)
  assert.equal(state.wormholeAutoReports.length, 1)
  const report = state.wormholeAutoReports[0]
  const gains = {}
  for (const gain of report.gains) gains[gain.itemId] = (gains[gain.itemId] ?? 0) + gain.units
  for (const [id, n] of Object.entries(gains)) assert.equal(state.warehouse.items[id], (warehouse[id] ?? 0) + n)
  for (const type of ['gamma', 'beta', 'alpha']) assert.equal(state.aiCores[type] - cores[type], (report.cores ?? []).filter(core => core.type === type).reduce((n, core) => n + core.n, 0))
  const metrics = { commonM3: 0, oreUnits: 0, rareM3: 0, boxes: 0, essence: 0, cores: 0, gamma: 0, beta: 0, alpha: 0, ordinaryM3: 0 }
  const boxesById = {}
  for (const [id, n] of Object.entries(gains)) {
    if (id.startsWith('wreck-rare-')) metrics.rareM3 += n
    else if (id.startsWith('wreck-')) metrics.commonM3 += n
    else if (id === 'ore-voidmother') metrics.oreUnits += n
    else if (id.startsWith('box-')) { metrics.boxes += n; boxesById[id] = n }
    else if (id === 'mat-wh-essence') metrics.essence += n
    else assert.fail(`未分类收益:${id}`)
  }
  for (const core of report.cores ?? []) { metrics.cores += core.n; metrics[core.type] += core.n }
  metrics.ordinaryM3 = metrics.commonM3 + metrics.oreUnits * ctx.items.get('ore-voidmother').unitM3
  const diagnostic = run.estimate ? {
    depth: run.estimate.depthReached, completedLayers: run.estimate.layers.reduce((n, layer) => n + layer.completion, 0),
    guardsPassed: run.estimate.layers.filter(layer => layer.guardPassed).length, lastCompletion: run.estimate.layers.at(-1).completion,
  } : !trace.final ? { traced: false } : {
    depth: trace.layers.at(-1).depth, simulationReportedDepth: trace.final.depthReached,
    guardsPassed: trace.final.depthReached - run.depth, guardFailures: trace.guardFailures, grids: trace.grids,
    generatedPastFailedGuard: trace.guardFailures.some(failed => trace.layers.some(layer => layer.depth > failed)),
    collectedPastFailedGuard: trace.guardFailures.some(failed => trace.layers.some((layer, i) => {
      if (layer.depth <= failed) return false
      const end = trace.layers[i + 1]?.before ?? trace.final
      return ['wreckM3', 'oreUnits', 'rareItems', 'relicBoxes', 'matterDevices'].some(key => end[key] > layer.before[key])
    })),
    holdFull: trace.final.holdFull, outOfTurns: trace.final.outOfTurns,
    layers: trace.layers.map((layer, i) => {
      const end = trace.layers[i + 1]?.before ?? trace.final
      return { depth: layer.depth, turnsStarted: layer.turns,
        gains: Object.fromEntries(['wreckM3', 'oreUnits', 'rareItems', 'relicBoxes', 'matterDevices'].map(key => [key, end[key] - layer.before[key]])) }
    }),
  }
  return { metrics, boxesById, gains, damage: canonical(report.damage), diagnostic, reportProjection: canonical({ gains: report.gains, cores: report.cores ?? [], damage: report.damage }) }
}

const out = path.join(ROOT, 'tools/_ui-artifacts', `signal-auto-yield-comparison-${Date.now()}`)
fs.mkdirSync(out)
const rawFile = path.join(out, 'paired-samples.jsonl')
const fd = fs.openSync(rawFile, 'wx')
const cells = [], profileInputs = []
const versions = ['old', 'guardStop', 'new']
const allMetrics = [], modes = ['old', 'guardStop', 'new']
const started = performance.now()
try {
  for (const profile of SIGNAL_AUTO_PROFILES) for (const fullTech of [false, true]) {
    const { state, ctx, roster, budget, admission } = signalAutoFixture(profile, fullTech)
    const tech = auto.wormholeAutoTechFactors(state, ctx, roster), hold = auto.wormholeAutoHoldM3Of(tech)
    assert(auto.wormholeAutoStart(state, ctx, state.wormholeStock[0].id, roster).ok)
    const initialRun = state.wormholeAuto[0]
    state.wormholeAuto = []
    profileInputs.push({ profile, fullTech, budget, admission, tech, hold,
      ships: roster.map(id => ({ id, ...canonical(state.fleet[id]) })), skills: state.skills.trained, research: state.research.levels })
    let checks = 0
    for (const family of families) for (const archetype of archetypes) {
      const results = []
      for (let index = 1; index <= samples; index++) {
        // 实际信号种子是散布整数，不用连续1～100放大旧随机流的相关性。
        const seed = hashSeed(`signal-auto-paired-20261102/${index}`)
        const signal = { seed, depth: 1, family, archetype }
        const oldRun = { ...initialRun, ...signal }
        delete oldRun.estimateRules; delete oldRun.estimate
        const estimate = signalAutoEstimateOf(state, ctx, roster, signal, .8, tech, hold)
        const newRun = { ...oldRun, estimateRules: 1, estimate }
        const old = settle(state, ctx, oldRun, runOld)
        if (index === 1) {
          const official = settle(state, ctx, oldRun, auto.advanceWormholeAuto)
          assert.deepEqual(old.reportProjection, official.reportProjection, '插桩不得改变旧结算')
          checks++
        }
        const guardStop = settle(state, ctx, oldRun, runGuardStop)
        const current = settle(state, ctx, newRun, auto.advanceWormholeAuto)
        assert.deepEqual(current.damage, old.damage, '同初始舰况与科技的损伤必须一致')
        assert.deepEqual(guardStop.damage, old.damage)
        if (!old.diagnostic.guardFailures.length) assert.deepEqual(old.reportProjection, guardStop.reportProjection, '没遇到失败守卫，单分支诊断应与原样完全一致')
        const paired = { profile, fullTech, family, archetype, seed,
          old: { metrics: old.metrics, boxesById: old.boxesById, diagnostic: old.diagnostic },
          guardStop: { metrics: guardStop.metrics, boxesById: guardStop.boxesById, diagnostic: guardStop.diagnostic },
          new: { metrics: current.metrics, boxesById: current.boxesById, diagnostic: current.diagnostic } }
        fs.writeSync(fd, `${JSON.stringify(paired)}\n`)
        results.push(paired)
        allMetrics.push(paired)
      }
      const metricKeys = Object.keys(results[0].old.metrics)
      const summary = Object.fromEntries(versions.map(version => [version, {
        metrics: Object.fromEntries(metricKeys.map(key => [key, stats(results.map(row => row[version].metrics[key]))])),
        depth: stats(results.map(row => row[version].diagnostic.depth)),
        bypassGenerated: version === 'new' ? 0 : results.filter(row => row[version].diagnostic.generatedPastFailedGuard).length,
        bypassCollected: version === 'new' ? 0 : results.filter(row => row[version].diagnostic.collectedPastFailedGuard).length,
      }]))
      const boxIds = [...new Set(results.flatMap(row => modes.flatMap(mode => Object.keys(row[mode].boxesById))))].sort()
      const boxes = Object.fromEntries(boxIds.map(id => [id, Object.fromEntries(modes.map(mode => [mode, stats(results.map(row => row[mode].boxesById[id] ?? 0))]))]))
      cells.push({ profile, fullTech, family, archetype, samples, summary, boxes })
    }
    console.log(JSON.stringify({ profile, fullTech, pairs: samples * families.length * archetypes.length, uninstrumentedChecks: checks,
      elapsedSeconds: Math.round((performance.now() - started) / 1000) }))
  }
} finally { fs.closeSync(fd) }
assert.deepEqual(fingerprint(), beforeHash, '对照不得修改生产源码或夹具')
const aggregates = []
for (const profile of SIGNAL_AUTO_PROFILES) for (const fullTech of [false, true]) {
  const paired = allMetrics.filter(row => row.profile === profile && row.fullTech === fullTech)
  const metricKeys = Object.keys(paired[0].old.metrics)
  aggregates.push({ profile, fullTech, samples: paired.length, versions: Object.fromEntries(versions.map(version => [version, {
    metrics: Object.fromEntries(metricKeys.map(key => [key, stats(paired.map(row => row[version].metrics[key]))])),
    depth: stats(paired.map(row => row[version].diagnostic.depth)),
    bypassCollected: version === 'new' ? 0 : paired.filter(row => row[version].diagnostic.collectedPastFailedGuard).length,
  }])), newMinusOld: Object.fromEntries(metricKeys.map(key => [key, stats(paired.map(row => row.new.metrics[key] - row.old.metrics[key]))])) })
}
const report = { ok: true, samplesPerCell: samples, seedScheme: 'hashSeed(signal-auto-paired-20261102/<1..N>)',
  pairedCount: allMetrics.length, settlementCount: allMetrics.length * 3,
  uninstrumentedChecks: cells.length, sourceHash: beforeHash, profileInputs, cells, aggregates,
  limitations: ['仅独立合成固定配装，非等成本或最优配置；科技比例固定80%。', '旧地图实际原型由种子和层决定，未直接响应保存原型；原样保留并追踪。',
    '守卫诊断仅内存修改continue为break，其他旧规则不变，不是完整修正或平衡后的基准。', '旧报告层、旧模拟报告层和实际访问层分开；新末层可能只部分完成。',
    '分位数按每格/聚合有限样本线性插值；物品未开箱、不按标价折现，不含采购时间或资本成本。'] }
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2), { encoding: 'utf8', flag: 'wx' })
console.log(JSON.stringify({ output: out, pairs: allMetrics.length, elapsedSeconds: Math.round((performance.now() - started) / 1000) }))
