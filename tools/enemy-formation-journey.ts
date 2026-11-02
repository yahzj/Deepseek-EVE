/** 单舰20声望路线及真实远征循环；独立合成，不读取个人存档。
 * node --import tsx tools/enemy-formation-journey.ts [--save]
 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildSimContext } from '@whale/data'
import { createInitialState, addLog } from '../packages/core/src/state'
import { addShipToFleet } from '../packages/core/src/fleetBook'
import { fitModule } from '../packages/core/src/equipment'
import { goodLockedReason, marketGoodOf } from '../packages/core/src/market/access'
import { startExpedition } from '../packages/core/src/expedition/launch'
import { advanceExpedition } from '../packages/core/src/expedition/advance'
import { advanceBattleFor } from '../packages/core/src/combat/advance'
import { waveGapTotalMs } from '../packages/core/src/combat/combatMath'
import { repairCostIsk, repairShip } from '../packages/core/src/shipyard'
import { bountyCooldownRemainingMs } from '../packages/core/src/expedition/cooldown'
import { enqueueSkill, advanceSkillQueue, prereqNeedLevel } from '../packages/core/src/skills/queue'
import { buySkillLicense, skillLicenseMissing } from '../packages/core/src/skills/license'
import { trainingLevelProgress } from '../packages/core/src/skills/training'
import { standingOf, DSI_FACTION_ID } from '../packages/core/src/standing'
import { loadSaveFile, serializeSaveFile } from '../packages/core/src/save'
import type { GameState, SimContext } from '../packages/core/src/index'

const ctx = buildSimContext()
const beforeCtx: SimContext = { ...ctx, anomalies: new Map([...ctx.anomalies].map(([id, card]) => [id, card.foeFormation?.baseline ?? card])) }
const output = resolve('tools/_ui-artifacts/enemy-formation-20261031')
mkdirSync(output, { recursive: true })
const state = createInitialState({ nowWallMs: 0, seed: 3110 })
state.modeChosen = true
state.onboarding.step = 99
state.wallet.isk = 20_000_000
state.exploredGalaxies = [...ctx.galaxies.keys()]
state.importantTasks['first-bounty'] = { done: true }
state.resupplyFromWarehouse = true
state.skills.trained = {}
state.skills.queue = []
state.skills.progressVersion = 1
const training: Array<{ id: string; level: number; elapsedMs: number }> = []
function train(id: string, level: number): void {
  const def = ctx.skills.get(id)!
  assert(def, id)
  for (const parent of def.prereq ?? []) train(parent, prereqNeedLevel(def, parent))
  if (skillLicenseMissing(state, def)) assert(buySkillLicense(state, ctx.skills, id).ok, id)
  while ((state.skills.trained[id] ?? 0) < level) {
    const target = (state.skills.trained[id] ?? 0) + 1
    const result = enqueueSkill(state, id, target, ctx.skills)
    assert(result.ok, `${id}:${result.error}`)
    const elapsedMs = Math.ceil(trainingLevelProgress(state, def, target, 0).remainingMs)
    state.gameMs += elapsedMs
    advanceSkillQueue(state, elapsedMs, ctx)
    assert.equal(state.skills.trained[id], target)
    training.push({ id, level: target, elapsedMs })
  }
}
for (const def of ctx.skills.values()) if (def.rank <= 3 && ['战斗', '工程', '防御', '舰船'].includes(def.group) && !def.id.startsWith('fleet-command-')) train(def.id, 3)
train('reload-drills', 2)

// 只合成可购买的货源，按目录价格扣款；不模拟供应簿等待或资金获取。
function acquire(local: SimContext, kind: 'ship' | 'module' | 'item', id: string, count: number): void {
  const good = marketGoodOf(local, kind, id)!
  assert(good && good.playerBuyable !== false, `not-buyable:${id}`)
  assert.equal(goodLockedReason(state, good), null, id)
  assert(!good.bmStanding || standingOf(state, DSI_FACTION_ID) >= good.bmStanding, id)
  state.wallet.isk -= Math.ceil(good.basePrice * 1.06 * count)
  assert(state.wallet.isk >= 0, id)
  if (kind === 'ship') state.shipId = addShipToFleet(state, id)
  else if (kind === 'module') state.moduleBay[id] = (state.moduleBay[id] ?? 0) + count
  else state.warehouse.items[id] = (state.warehouse.items[id] ?? 0) + count
}
function equip(ship: string): void {
  acquire(ctx, 'ship', ship, 1)
  const modules = [...Array(ctx.ships.get(ship)!.slots!.high).fill('mod-missile-2'), 'mod-prop-2', 'mod-shield-ext-2', 'mod-armor-plate-2']
  for (const id of modules) {
    acquire(ctx, 'module', id, 1)
    const result = fitModule(state, id, ctx)
    assert(result.ok, `${id}:${result.error}`)
  }
}
acquire(ctx, 'item', 'ammo-explosive-l', 20_000)
equip('sh-mako')

function cycle(source: GameState, local: SimContext, id: string, version: 0 | 1) {
  const started = source.gameMs, wallet = source.wallet.isk
  const ammoBefore = source.warehouse.items['ammo-explosive-l'] ?? 0
  const launched = startExpedition(source, id, local)
  assert(launched.ok, `${id}:${launched.error}`)
  const battle = source.expedition.battle!
  // 旧上下文已用原卡建首波，随后保留旧版本；正式结算和返航仍走远征链。
  if (version === 0) delete battle.enemyFormationVersion
  source.gameMs += local.balance.battle.maxBattleMs + 30_000 + waveGapTotalMs(local.anomalies.get(id), local.balance.battle)
  advanceBattleFor(source, local, battle, source.shipId, id)
  assert(battle.ended, id)
  const seconds = (battle.lastTickGameMs - battle.startedAtGameMs) / 1000
  // 结算按真实结束时点，避免将上面的最大模拟预算算作航行收益周期。
  source.gameMs = battle.lastTickGameMs + local.balance.battle.killcamMs + 1
  advanceExpedition(source, local)
  const returnAt = source.expedition.finishAtGameMs
  source.gameMs = Math.max(source.gameMs, returnAt)
  advanceExpedition(source, local)
  assert(!source.expedition.active && !source.expedition.sortie, id)
  const cooldownMs = bountyCooldownRemainingMs(source, id)
  source.gameMs += cooldownMs
  const repair = repairCostIsk(source, source.shipId, local)
  if (repair > 0) assert(repairShip(source, source.shipId, local).ok)
  const ammoUsed = ammoBefore - (source.warehouse.items['ammo-explosive-l'] ?? 0)
  const ammoPrice = marketGoodOf(local, 'item', 'ammo-explosive-l')!.basePrice
  const net = source.wallet.isk - wallet - ammoUsed * ammoPrice
  return { id, version, won: battle.ended === 'me', seconds, cycleSeconds: (source.gameMs - started) / 1000,
    standing: standingOf(source, DSI_FACTION_ID), repair, ammoUsed, net,
    netPerHour: net * 3_600_000 / Math.max(1, source.gameMs - started) }
}

const route = [], rejected = []
for (const card of [...ctx.anomalies.values()].filter(card => !card.hidden).sort((a, b) => a.standingReq - b.standingReq || a.threat - b.threat)) {
  if (standingOf(state, DSI_FACTION_ID) >= 20) break
  if (card.standingReq > standingOf(state, DSI_FACTION_ID)) continue
  if (standingOf(state, DSI_FACTION_ID) >= 8 && state.shipId === 'sh-mako') equip('sh-thresher')
  const candidate = structuredClone(state)
  const result = cycle(candidate, ctx, card.id, 1)
  if (result.won) { route.push(result); Object.assign(state, candidate) }
  else rejected.push({ id: result.id, seconds: result.seconds, note: '独立候选试打失败，不计入推荐路线或收益；正式路线跳过该目标。' })
}
const report = { conditions: { initialFunding: 20_000_000, fundingAndSupplySynthesized: true, exploredMap: true,
  firstBountyTutorialCompleted: true, droneLoad: 0, training, skills: state.skills.trained,
  limits: '合法技能前置、训练许可和购买门槛；资金与探索预置，不代表新号零资金养成。推荐路线由独立候选试打筛选，仅连续执行成功目标；没有验证失败后的资金和船损恢复。循环含正式奖励、返航、冷却、港口维修及实际弹药目录估值；不含出售战利品、残骸回收和供应等待。' }, route, rejected, standing: standingOf(state, DSI_FACTION_ID), loops: [] as (ReturnType<typeof cycle> & { seed: number })[] }
assert(report.standing >= 20, `single-ship-route-stalled:${report.standing}`)
for (const id of ['ano-redring-raiders', 'ano-echo-haunt', 'ano-auro-raiders']) for (const seed of [1, 7, 13, 29, 51, 71, 91, 101, 131, 151, 181, 211]) for (const version of [0, 1] as const) {
  const source = structuredClone(state)
  source.rng = { seed, count: 0 }
  report.loops.push({ ...cycle(source, version === 0 ? beforeCtx : ctx, id, version), seed })
}
if (process.argv.includes('--save')) {
  addLog(state, 'system', '敌卡扩编验收：独立合成单舰路线已达20声望，技能与舰体保持测试时规格。')
  const text = serializeSaveFile(state, Date.now())
  const back = loadSaveFile(text).state
  assert(standingOf(back, DSI_FACTION_ID) >= 20)
  writeFileSync(resolve(output, 'test-save-enemy-formation-standing20.json'), text, 'utf8')
}
writeFileSync(resolve(output, 'journey.json'), JSON.stringify(report, null, 2), 'utf8')
console.log(JSON.stringify({ standing: report.standing, attempts: route.length, route, loops: report.loops, output }))
