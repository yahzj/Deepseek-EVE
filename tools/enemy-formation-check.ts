/** 敌卡扩编校准：独立合成档，旧/新同配装同种子；不读个人档。
 * npx tsx tools/enemy-formation-check.ts [--seeds=3] [--static]
 * 输出 tools/_ui-artifacts/enemy-formation-20261031/report.json。
 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../packages/core/src/state'
import { addShipToFleet } from '../packages/core/src/fleetBook'
import { adjustDroneLoad, fitModule } from '../packages/core/src/equipment'
import { commandBudgetOf } from '../packages/core/src/combat/command/rules'
import { startFleetBattleFor } from '../packages/core/src/combat/startFleet'
import { advanceBattleFor } from '../packages/core/src/combat/advance'
import { waveGapTotalMs } from '../packages/core/src/combat/combatMath'
import { foeStrengthOf } from '../packages/core/src/combat/foes/catalog'
import { wormholeDerivedAnomaly } from '../packages/core/src/combat/cards'
import { lairAnomalyOf } from '../packages/core/src/lairs'
import type { SimContext } from '../packages/core/src/types'
import { wormholeTierOfCard } from '../packages/core/src/wormholeFoes'

const ctx = buildSimContext()
const legacy: SimContext = { ...ctx, anomalies: new Map([...ctx.anomalies].map(([id, card]) => [id, card.foeFormation?.baseline ?? card])) }
const seeds = Number(process.argv.find(arg => arg.startsWith('--seeds='))?.slice(8) ?? 3)
assert(Number.isInteger(seeds) && seeds > 0 && seeds <= 30)
const staticRows = []
for (const card of ctx.anomalies.values()) {
  if (card.foeFormation) {
    const before = foeStrengthOf(card.foeFormation.baseline, ctx.balance.battle)
    const after = foeStrengthOf(card, ctx.balance.battle)
    assert(after.hp >= before.hp && after.dps >= before.dps, card.id)
    staticRows.push({ id: card.id, name: card.name, before, after, waves: card.waves?.map(w => w.units) })
  }
  if (card.lairCore) for (const tier of [1, 2, 3] as const) {
    const before = foeStrengthOf(lairAnomalyOf(card.foeFormation?.baseline ?? card, tier, ctx.balance.battle, 0), ctx.balance.battle)
    const next = lairAnomalyOf(card, tier, ctx.balance.battle, 1, ctx.foeShips)
    const after = foeStrengthOf(next, ctx.balance.battle)
    assert(after.hp >= before.hp && after.dps >= before.dps, `${card.id}/${tier}`)
    staticRows.push({ id: card.id, tier, before, after, waves: next.waves?.map(w => w.units) })
  }
  if (card.id.startsWith('wh-')) for (const depth of [1, 2, 4, 7, 10]) for (const kind of ['node', 'boss', 'ruins'] as const) {
    const spec = { depth, kind, waves: 1 }
    const before = foeStrengthOf(wormholeDerivedAnomaly(ctx, card, spec, 0), ctx.balance.battle)
    const after = foeStrengthOf(wormholeDerivedAnomaly(ctx, card, spec, 1), ctx.balance.battle)
    assert(after.hp >= before.hp && after.dps >= before.dps, `${card.id}/${depth}/${kind}`)
    staticRows.push({ id: card.id, depth, kind, before, after })
  }
}
console.log(JSON.stringify({ phase: '逐卡静态对照', rows: staticRows.length, decreased: 0 }))

const stages = [
  { id: 'solo-before20', standing: 19, level: 2, command: [0, 0, 0], fleet: ['sh-hammerhead'] },
  { id: 'basic20', standing: 20, level: 2, command: [5, 0, 0], fleet: ['sh-hammerhead', 'sh-hammerhead'] },
  { id: 'coordination40', standing: 40, level: 3, command: [5, 3, 0], fleet: ['sh-hammerhead', 'sh-hammerhead', 'sh-hammerhead'] },
  { id: 'invasion60', standing: 60, level: 3, command: [5, 5, 1], fleet: ['sh-hammerhead', 'sh-hammerhead', 'sh-hammerhead', 'sh-hammerhead'] },
  { id: 'mature125', standing: 100, level: 5, command: [5, 5, 5], fleet: ['sh-hammerhead', 'sh-hammerhead', 'sh-hammerhead', 'sh-hammerhead', 'sh-hammerhead'] },
]
const targets = [...ctx.anomalies.values()].filter(card => !card.hidden).map(card => card.id)
const invasions = [...ctx.anomalies.values()].filter(card => card.region === 'inv').map(card => card.id)
const battles = []
if (!process.argv.includes('--static')) for (const stage of stages) for (const weapon of ['mod-turret-kin-2', 'mod-laser-2', 'mod-missile-2']) {
  const base = createInitialState({ nowWallMs: 0, seed: 1 })
  base.fleet = {}
  base.skills.trained = Object.fromEntries([...ctx.skills.keys()].map(id => [id, stage.level]))
  for (const [i, id] of ['fleet-command-basic', 'fleet-command-coordination', 'fleet-command-integration'].entries()) base.skills.trained[id] = stage.command[i]!
  base.standingsEarned = { dsi: stage.standing }
  base.standings.dsi = stage.standing
  base.wallet.isk = 1_000_000_000
  base.resupplyFromWarehouse = true
  base.importantTasks['first-bounty'] = { done: true, delivered: 0 }
  base.completedBounties = targets
  for (const id of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l', 'drone-scout', 'repairkit-mil']) base.warehouse.items[id] = 100_000
  const ids = stage.fleet.map(defId => {
    const uid = addShipToFleet(base, defId)
    const ship = ctx.ships.get(defId)!
    for (const module of ['mod-prop-2', 'mod-shield-ext-2', 'mod-armor-plate-2', ...Array(ship.slots?.high ?? 1).fill(weapon)]) {
      base.moduleBay[module] = (base.moduleBay[module] ?? 0) + 1
      const fit = fitModule(base, module, ctx, { shipId: uid })
      assert(fit.ok, `${stage.id}/${module}:${fit.error}`)
    }
    adjustDroneLoad(base, ctx, 'drone-scout', 2, uid)
    return uid
  })
  base.shipId = ids[0]!
  assert(commandBudgetOf(base, ctx, ids).ok, stage.id)
  const cases = targets.map(id => ({ id, signal: undefined as { depth: number; kind: 'node'; waves: number } | undefined }))
  if (stage.standing >= 60) cases.push(...invasions.map(id => ({ id, signal: undefined })))
  if (stage.standing >= 40) for (const depth of [1, 2, 4, 7, 10]) for (const card of ctx.anomalies.values()) {
    const tier = wormholeTierOfCard(card.id)
    if (tier && depth >= (tier === 'deep' ? 4 : tier === 'mid' ? 2 : 1)) cases.push({ id: card.id, signal: { depth, kind: 'node', waves: 1 } })
  }
  for (const test of cases) for (const version of [0, 1] as const) {
    const local = version === 1 ? ctx : legacy
    const results = []
    for (let seed = 1; seed <= seeds; seed++) {
      const state = structuredClone(base)
      state.rng = { seed, count: 0 }
      const battle = startFleetBattleFor(state, local, ids, test.id, 0, null, test.signal, undefined, false, version)!
      assert(battle)
      state.gameMs = local.balance.battle.maxBattleMs + 30_000 + waveGapTotalMs(local.anomalies.get(test.id), local.balance.battle)
      advanceBattleFor(state, local, battle, ids[0]!, test.id)
      assert(battle.ended, `${stage.id}/${test.id}`)
      const alive = (battle.myFleet ?? []).filter(unit => {
        const hp = battle.units[unit.tag]!.hp
        return hp.s + hp.a + hp.h > 0
      }).length
      results.push({ seed, won: battle.ended === 'me', seconds: (battle.lastTickGameMs - battle.startedAtGameMs) / 1000, alive,
        ammo: Object.entries(battle.ammoLoaded ?? {}).reduce((sum, [key, loaded]) => sum + loaded - battle.ammo[key as keyof typeof battle.ammo], 0),
        droneLost: Object.values(battle.droneLost ?? {}).reduce((sum, n) => sum + n, 0) })
    }
    battles.push({ stage: stage.id, weapon, ...test, version, results })
  }
  console.log(JSON.stringify({ phase: '真实战斗对照', stage: stage.id, weapon, cases: cases.length * 2 * seeds }))
}
const output = resolve('tools/_ui-artifacts/enemy-formation-20261031')
mkdirSync(output, { recursive: true })
writeFileSync(resolve(output, 'report.json'), JSON.stringify({ assumptions: {
  syntheticOnly: true, stages, seeds, fitting: '合法固定MK2模板；非最优配装，无插件或谜质，满状态起战',
  limits: '阶段是合法容量与给定技能的截面，未计算训练/采购耗时；战斗结果不含旅行、冷却及完整经济循环；信号15卡按1/2/4层准入全覆盖。旗舰此矩阵测卡面而非共享血池，血池由专项覆盖。',
}, staticRows, battles }, null, 2), 'utf8')
console.log(JSON.stringify({ output, battles: battles.length }))
