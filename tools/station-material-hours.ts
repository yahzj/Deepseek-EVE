/**
 * 第二阶段建材工时复核：从本批设计稿读取待审料单，与旧副站材料同场比较。
 * 用法：npx tsx tools/station-material-hours.ts；--supply-only 复用收入读数，只复核备料与采购。
 * --three-stations-proposal：读取同稿第十七节三站提案，复用同基线收入，另存提案结果。
 * 输出：tools/_ui-artifacts/station-material-hours-20261018.json（可重建，不入库）。
 * 合成三档配置，各8小时×3种子，真实采矿/市场成交；无燃料，不调用新系统、不读写真档。
 * 自采采用“剩余需求件数最大优先”的可行策略，真单点参数、串行矿船/手动炉/组装机，非最优解。
 * 游戏v0.1.0；最后核对2026-10-18；基线和详细假设随输出记录。
 */
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { buildSimContext, BLUEPRINTS } from '@whale/data'
import {
  addShipToFleet, advanceMining, advanceMarket, advanceAi, assignAiMining,
  askLineOf, buyAtMarket, billNeedOf,
  cargoCapacityM3Of, createInitialState, effectiveCpu, ensureMarket,
  fittedCpuUsed, getMiningParams, matNeedCount, nearestStationGalaxyId,
  oneLegMs, oneOutboundLegMs, refineBatchOutputOf, sellWareItem,
  setMiningAutoCycle, startMining, startRefineRun, startManufacturing,
} from '@whale/core'
import type { GameState } from '@whale/core'

const ctx = buildSimContext()
const H = 3_600_000
const proposalMode = process.argv.includes('--three-stations-proposal')
const designPath = 'docs/design/human-revival-station-research-20261018.md'
const design = readFileSync(designPath, 'utf8')
const section = design.slice(design.indexOf(proposalMode ? '## 十七、' : '## 十五、'))
const materialTable = section.slice(section.indexOf('| 材料 |')).split(/\r?\n\r?\n/)[0]!
const billNames = proposalMode ? ['redring-proposal', 'cinder-proposal', 'player-base-proposal'] : ['power', 'life', 'expansion']
const bills: Record<string, Record<string, number>> = Object.fromEntries(billNames.map(name => [name, {}]))
for (const row of materialTable.split(/\r?\n/).slice(2)) {
  if (!row.startsWith('|')) continue
  const columns = row.split('|').slice(1, -1).map(c => c.trim())
  assert.equal(columns.length, 5)
  const id = columns[1]!.replaceAll('`', '')
  assert(ctx.items.has(id))
  for (const [index, name] of billNames.entries()) {
    const count = Number(columns[index + 2]!.replaceAll(',', ''))
    assert(Number.isSafeInteger(count) && count >= 0)
    if (count > 0) bills[name]![id] = count
  }
}
assert(billNames.every(name => Object.keys(bills[name]!).length > 0), '设计料单未解析，停止')
for (const site of ctx.stations.values()) {
  const probe = createInitialState({ nowWallMs: 0, seed: 1 })
  for (const level of [0, 5]) {
    probe.skills.trained['station-engineering'] = level
    const bill: Record<string, number> = {}
    site.tiers.forEach((tier, index) => tier.bill.forEach(row => {
      bill[row.itemId] = (bill[row.itemId] ?? 0) + billNeedOf(probe, site, index, row.itemId)
    }))
    bills[`${site.id}-engineering-${level}`] = bill
  }
}
const profiles = [
  { id: 'whale-lv3-mk2', ship: 'whale', level: 3, miners: 2, tier: 2, cargos: 2 },
  { id: 'king-lv5-mk3', ship: 'whale-king', level: 5, miners: 4, tier: 3, cargos: 3 },
  { id: 'humpback-lv5-mk3', ship: 'sh-humpback', level: 5, miners: 3, tier: 3, cargos: 4 },
]
function fresh(profile: typeof profiles[number], seed = 17): GameState {
  const state = createInitialState({ nowWallMs: 0, seed })
  state.onboarding.step = 99
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  for (const skill of ctx.skills.values()) state.skills.trained[skill.id] = profile.level
  for (const site of ctx.stations.values()) state.stationSites[site.id] = { stage: site.tiers.length, delivered: {} }
  state.standings.dsi = 100
  state.standingsEarned = { ...state.standingsEarned, dsi: 100 }
  state.shipId = addShipToFleet(state, profile.ship)
  const fit = {
    high: Array(profile.miners).fill(`mod-miner-${profile.tier}`), mid: [],
    low: [...Array(profile.cargos - 1).fill(`mod-cargo-${profile.tier}`), 'mod-cargo-2'],
  }
  state.fleet[state.shipId]!.fitted = fit
  const def = ctx.ships.get(profile.ship)!
  assert(fittedCpuUsed(fit, ctx, def) <= effectiveCpu(state, ctx, def))
  return state
}
function materialValue(bill: Record<string, number>) {
  return Object.entries(bill).reduce((s, [id, count]) => s + count * ctx.items.get(id)!.baseSellPriceIsk!, 0)
}
const incomeSource = 'tools/_ui-artifacts/station-material-hours-20261018.json'
const out = proposalMode ? 'tools/_ui-artifacts/station-material-proposal-20261018.json' : incomeSource
const fleetOnly = process.argv.includes('--fleet-only')
const supplyOnly = proposalMode || process.argv.includes('--supply-only')
assert(!(fleetOnly && supplyOnly), '模式不可叠加')
const result: any = fleetOnly || supplyOnly ? JSON.parse(readFileSync(incomeSource, 'utf8')) : {
  method: 'synthetic profiles; all skills at profile level; DSI standing 100; no fuel; both old stations built; all galaxies explored; no new human income; no personal saves; real mining and market advance only; self supply excludes rich veins and parallel production',
  gitHead: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(),
  designPath, bills: {}, profiles: [],
}
if (fleetOnly || supplyOnly) {
  assert.equal(result.gitHead, execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(), '基线已变，须完整重跑')
  for (const [name, bill] of Object.entries(bills)) {
    if (proposalMode && billNames.includes(name)) continue
    assert.deepEqual(result.bills[name]?.bill, bill, '料单已变，须完整重跑')
  }
}
if (proposalMode) result.bills = {}
for (const [name, bill] of Object.entries(bills)) result.bills[name] = { bill, baseValue: materialValue(bill) }
const supplyBills = proposalMode ? bills : { ...bills,
  'power-x10-sensitivity': Object.fromEntries(Object.entries(bills.power!).map(([id, n]) => [id, n * 10])),
  'life-x10-sensitivity': Object.fromEntries(Object.entries(bills.life!).map(([id, n]) => [id, n * 10])),
  'expansion-x20-sensitivity': Object.fromEntries(Object.entries(bills.expansion!).map(([id, n]) => [id, n * 20])),
}

if (!fleetOnly) for (const profile of profiles) {
  const state = fresh(profile)
  ensureMarket(state, ctx)
  const targetBills = Object.fromEntries(Object.entries(supplyBills).map(([name, bill]) => {
    const buyer = fresh(profile)
    buyer.wallet.isk = 1_000_000_000
    ensureMarket(buyer, ctx)
    let purchaseIsk = 0
    let remainingUnits = 0
    for (const [id, count] of Object.entries(bill)) {
      const order = buyAtMarket(buyer, ctx, id, count)
      purchaseIsk += order.total
      remainingUnits += order.remaining
    }
    const oneShotRemaining = remainingUnits
    let elapsedMs = 0
    while (remainingUnits > 0 && elapsedMs < 24 * H) {
      elapsedMs += 60_000
      buyer.gameMs = elapsedMs
      advanceMarket(buyer, 60_000, ctx)
      remainingUnits = 0
      for (const [id, count] of Object.entries(bill)) {
        const need = count - (buyer.warehouse.items[id] ?? 0)
        if (need <= 0) continue
        const order = buyAtMarket(buyer, ctx, id, need)
        purchaseIsk += order.total
        remainingUnits += order.remaining
      }
    }
    const equilibriumAskValue = Object.entries(bill).reduce((sum, [id, n]) => sum + n * askLineOf(state, ctx, id), 0)
    return [name, { purchaseIsk, remainingUnits, oneShotRemaining, stockedPurchaseMinutes: remainingUnits === 0 ? elapsedMs / 60_000 : null, equilibriumAskValue }]
  }))
  const choices = [...ctx.belts.values()].filter(b => !b.outputs?.length).map(b => {
    const params = getMiningParams(state, ctx, { shipId: state.shipId, beltId: b.id })!
    const hold = cargoCapacityM3Of(state, ctx, state.shipId)
    const units = hold / params.ore.unitM3
    assert(b.galaxyId)
    const origin = nearestStationGalaxyId(state, ctx, b.galaxyId)
    const tripMs = units / params.unitsPerCycle * params.cycleMs
      + oneOutboundLegMs(state, ctx, b.id, state.shipId, origin)
      + oneLegMs(state, ctx, b.id, state.shipId, origin)
    return { belt: b.id, ore: b.oreId, nominalValueH: units * params.ore.baseSellPriceIsk! * H / tripMs }
  }).sort((a, b) => b.nominalValueH - a.nominalValueH)
  const incomeRows: any[] = supplyOnly ? result.profiles.find((p: any) => p.profile.id === profile.id).incomeRows : []
  if (!supplyOnly) for (const choice of [choices[0]!, choices.find(x => x.belt === 'belt-fortune')!]) {
    const samples = []
    for (const seed of [17, 29, 51]) {
      const s = fresh(profile, seed)
      setMiningAutoCycle(s, true)
      const started = startMining(s, choice.belt, ctx)
      assert(started.ok, started.error)
      ensureMarket(s, ctx)
      for (let ms = 0; ms < 8 * H; ms += 1000) {
        s.gameMs += 1000
        advanceMining(s, 1000, ctx)
        advanceMarket(s, 1000, ctx)
        if (s.gameMs % 60_000 === 0 && (s.warehouse.items[choice.ore] ?? 0) > 0) sellWareItem(s, choice.ore, ctx)
      }
      const cash = s.firstStats?.marketIncome ?? 0
      samples.push({ seed, cashH: cash / 8, unsoldWarehouse: s.warehouse.items[choice.ore] ?? 0, escrow: s.escrowItems[choice.ore] ?? 0 })
    }
    incomeRows.push({ ...choice, samples, meanCashH: samples.reduce((s, r) => s + r.cashH, 0) / samples.length })
  }

  const selfSupply = []
  for (const [name, bill] of Object.entries(supplyBills)) {
    const minerals: Record<string, number> = {}
    let assemblyMs = 0
    for (const [id, count] of Object.entries(bill)) {
      const bp = BLUEPRINTS.find(b => b.itemId === id)
      if (ctx.items.get(id)!.kind === 'part') {
        assert(bp?.learnless)
        const batches = Math.ceil(count / (bp.outputUnits ?? 1))
        const assemblyState = fresh(profile)
        for (const material of bp.materials) assemblyState.warehouse.items[material.itemId] = 1_000_000_000
        const started = startManufacturing(assemblyState, bp.id, 'pilot', ctx)
        assert(started.ok, started.error)
        const run = assemblyState.manufacturingRuns.find(r => r.active && r.blueprintId === bp.id)!
        assemblyMs += batches * run.durationMs
        bp.materials.forEach(m => { minerals[m.itemId] = (minerals[m.itemId] ?? 0) + batches * matNeedCount(state, m.count, bp.id) })
      } else minerals[id] = (minerals[id] ?? 0) + count
    }
    const remaining = { ...minerals }
    const legs = []
    let totalMiningMs = 0
    let totalRefineMs = 0
    // 明确的可执行供料策略：每次优先满足当前剩余件数最多的矿物，保留同批副产物。
    for (let step = 0; step < 12; step++) {
      const need = Object.entries(remaining).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])[0]
      if (!need) break
      const candidates = []
      for (const belt of ctx.belts.values()) {
        if (belt.outputs?.length) continue
        const ore = ctx.items.get(belt.oreId)!
        if (!ore.refine?.some(r => r.mineralId === need[0])) continue
        const refineState = fresh(profile)
        refineState.warehouse.items[ore.id] = 1_000_000_000
        const started = startRefineRun(refineState, ore.id, 'pilot', ctx)
        assert(started.ok, started.error)
        const run = refineState.refineRuns.find(r => r.active)!
        const outputs = refineBatchOutputOf(refineState, ctx, ore, run.batchUnits)
        const output = outputs.find(r => r.mineralId === need[0])?.units ?? 0
        if (output <= 0) continue
        const batches = Math.ceil(need[1] / output)
        const oreUnits = batches * run.batchUnits
        const params = getMiningParams(state, ctx, { shipId: state.shipId, beltId: belt.id })!
        const hold = cargoCapacityM3Of(state, ctx, state.shipId)
        const cyclesPerHold = Math.floor(hold / (params.unitsPerCycle * ore.unitM3))
        assert(cyclesPerHold > 0)
        const cycles = Math.ceil(oreUnits / params.unitsPerCycle)
        const fullTrips = Math.floor((cycles - 1) / cyclesPerHold)
        const lastCycles = cycles - fullTrips * cyclesPerHold
        assert(belt.galaxyId)
        const origin = nearestStationGalaxyId(state, ctx, belt.galaxyId)
        const leg = oneLegMs(state, ctx, belt.id, state.shipId, origin) + oneOutboundLegMs(state, ctx, belt.id, state.shipId, origin)
        const baseHold = ctx.ships.get(profile.ship)!.cargoM3
        // 满舱发现放不下下一循环时该循环仍耗时；最后一趟按目标满足后手动返航估算。
        const returnRatio = (count: number) => Math.min(1, count * params.unitsPerCycle * ore.unitM3 / baseHold)
        const miningMs = (cycles + fullTrips) * params.cycleMs
          + fullTrips * Math.max(1, Math.round(leg * returnRatio(cyclesPerHold)))
          + Math.max(1, Math.round(leg * returnRatio(lastCycles)))
        const refineMs = batches * run.cycleMs
        candidates.push({ belt: belt.id, ore: ore.id, oreUnits, miningMs, refineMs, outputs, batches })
      }
      candidates.sort((a, b) => a.miningMs + a.refineMs - b.miningMs - b.refineMs)
      const chosen = candidates[0]!
      assert(chosen, `no source for ${need[0]}`)
      totalMiningMs += chosen.miningMs
      totalRefineMs += chosen.refineMs
      chosen.outputs.forEach(o => { remaining[o.mineralId] = Math.max(0, (remaining[o.mineralId] ?? 0) - chosen.batches * o.units) })
      legs.push(chosen)
    }
    assert(Object.values(remaining).every(n => n <= 0), `${name} incomplete`)
    selfSupply.push({ name, minerals, miningMinutes: totalMiningMs / 60_000, refiningMinutes: totalRefineMs / 60_000, assemblyMinutes: assemblyMs / 60_000, sequentialMinutes: (totalMiningMs + totalRefineMs + assemblyMs) / 60_000, legs })
  }
  const bestCashH = Math.max(...incomeRows.map(r => r.meanCashH))
  const profileResult = { profile, fit: state.fleet[state.shipId]!.fitted, hold: cargoCapacityM3Of(state, ctx, state.shipId), incomeRows, purchaseHours: Object.fromEntries(Object.entries(targetBills).map(([name, row]) => [name, { ...row, hours: row.remainingUnits === 0 ? row.purchaseIsk / bestCashH : null, equilibriumIncomeMinutes: row.equilibriumAskValue / bestCashH * 60 }])), selfSupply }
  if (supplyOnly) result.profiles[result.profiles.findIndex((p: any) => p.profile.id === profile.id)] = profileResult
  else result.profiles.push(profileResult)
  console.log(JSON.stringify({ profile: profile.id, incomeRows, purchaseHours: profileResult.purchaseHours, selfSupply: selfSupply.map(({ legs, ...r }) => r) }))
}
// 成熟多船敏感性：主控鲸王＋4艘同装鲸王，由贝塔核心各自驱动；合计5条矿线。
const fleetIncome = []
if (!supplyOnly) for (const seed of [17, 29, 51]) {
  const profile = profiles[1]!
  const s = fresh(profile, seed)
  const beltId = 'belt-ice-frost'
  const oreId = ctx.belts.get(beltId)!.oreId
  s.aiCores.beta = 4
  for (let n = 0; n < 4; n++) {
    const id = addShipToFleet(s, profile.ship)
    s.fleet[id]!.fitted = structuredClone(s.fleet[s.shipId]!.fitted)
    const assigned = assignAiMining(s, id, 'beta', beltId, ctx)
    assert(assigned.ok, assigned.error)
  }
  setMiningAutoCycle(s, true)
  assert(startMining(s, beltId, ctx).ok)
  ensureMarket(s, ctx)
  for (let ms = 0; ms < 8 * H; ms += 1000) {
    s.gameMs += 1000
    advanceMining(s, 1000, ctx)
    advanceAi(s, 1000, ctx)
    advanceMarket(s, 1000, ctx)
    if (s.gameMs % 60_000 === 0 && (s.warehouse.items[oreId] ?? 0) > 0) sellWareItem(s, oreId, ctx)
  }
  fleetIncome.push({ seed, cashH: (s.firstStats?.marketIncome ?? 0) / 8, escrow: s.escrowItems[oreId] ?? 0, unsold: s.warehouse.items[oreId] ?? 0 })
}
if (!supplyOnly) result.fleetSensitivity = { description: 'king-lv5-mk3 pilot + 4 beta mining ships; same belt; no fuel; only actual market income counted', samples: fleetIncome, meanCashH: fleetIncome.reduce((sum, r) => sum + r.cashH, 0) / fleetIncome.length }
console.log(JSON.stringify(result.fleetSensitivity))
mkdirSync('tools/_ui-artifacts', { recursive: true })
writeFileSync(out, JSON.stringify(result, null, 2) + '\n', 'utf8')
console.log(`只读经济复核结果：${out}`)
