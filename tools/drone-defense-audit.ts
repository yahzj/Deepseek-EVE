/** 无人机受击与敌方点防排查；npx tsx tools/drone-defense-audit.ts [--before <旧报告JSON>]。
 * 只用隔离合成档和真实旗舰/悬赏/虫洞入口，原版敌卡不改；保持种子、配装、时长可比。
 * 以池字段的只读观测计伤害/击落、令牌消费及冷却错位；旗舰对照不注入许可或修改结果。
 * 边界夹具单独给定距离/令牌/冷却；只证明现行链路，不作为旗舰平衡读数。
 * 输出tools/_ui-artifacts/drone-defense-audit-20261008，不读取个人档或改正式数据。
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildSimContext } from '@whale/data'
import { makeExpeditionFixture } from './wormhole-expedition-fixture'
import { weekendStartFlagshipBattle } from '../packages/core/src/weekendLaunch'
import { advanceBattleFor, settleDroneLosses, createBattleState, startBattleFor, startFleetBattleFor, createFoeSpecs } from '../packages/core/src/combat'
import { resolvePointDefense } from '../packages/core/src/combatDrones'
import { foesWithSupport, seedUnit } from '../packages/core/src/foeSpecs'
import { adjustDroneLoad } from '../packages/core/src/equipment'
import { wormholeStartBattle, battleFoeAnomaly } from '../packages/core/src/wormholeBattle'
import { loadSaveFile, serializeSaveFile } from '../packages/core/src/save'
import type { BattleState } from '../packages/core/src/state'
import type { UnitSpec } from '../packages/core/src/combat'

const ctx = buildSimContext(), NOW = new Date(2026, 9, 9, 20).getTime()
const STEP = 100, LIMIT = 300_000
const cards = { C: 'alien-broodmother', R: 'corona-nexus', H: 'ink-flagship' }

function observe(battle: BattleState) {
  let active = false
  let previousAttempts = 0
  const result = { attempts: 0, hitEvents: 0, damage: 0, kills: 0, revivals: 0, attackBursts: 0, consumed: 0, emptyConsumes: 0, targets: new Set<string>() }
  const pending: Array<{ attempts: number }> = []
  const flush = () => {
    for (const row of pending) if (result.attempts === row.attempts) result.emptyConsumes++
    pending.length = 0
    previousAttempts = result.attempts
  }
  for (const [key, pool] of Object.entries(battle.dronePools ?? {})) {
    const evasion = pool.evasion
    Object.defineProperty(pool, 'evasion', { enumerable: true, configurable: true, get: () => {
      if (active) result.attempts++
      return evasion
    } })
    for (const field of ['s', 'a', 'h'] as const) {
      let value = pool[field]
      Object.defineProperty(pool, field, { enumerable: true, configurable: true, get: () => value, set: (next: number) => {
        if (active && field === 's' && next <= value && pool.alive) { result.hitEvents++; result.targets.add(key) }
        if (active && next < value) result.damage += value - next
        value = next
      } })
    }
    let alive = pool.alive
    Object.defineProperty(pool, 'alive', { enumerable: true, configurable: true, get: () => alive, set: (next: boolean) => {
      if (active && alive && !next) result.kills++
      if (active && !alive && next) result.revivals++
      alive = next
    } })
  }
  let token = battle.droneHitAt
  Object.defineProperty(battle, 'droneHitAt', { enumerable: true, configurable: true, get: () => token, set: (next: BattleState['droneHitAt']) => {
    if (active && next?.foe !== undefined && next.foe !== token?.foe) result.attackBursts++
    if (active && token?.foe !== undefined && next?.foe === undefined) {
      result.consumed++
      pending.push({ attempts: previousAttempts })
    }
    token = next
  } })
  // 每次近防结算的末尾写回集火表，按此边界分开同一补帧调用中的多次反击。
  let focus = battle.pdFocus
  Object.defineProperty(battle, 'pdFocus', { enumerable: true, configurable: true, get: () => focus, set: (next: BattleState['pdFocus']) => {
    if (active) flush()
    focus = next
  } })
  return { result, begin: () => { active = true }, end: () => {
    active = false
    flush()
  } }
}

function run(family: keyof typeof cards, reloadAt: number | null, kind = 'drone-assault', count = 16, instrument = true) {
  const fixture = makeExpeditionFixture('A', 19, 'drones')
  let state = fixture.before
  for (const id of fixture.fleet) {
    if (kind === 'drone-assault' && count === 16) continue
    assert(adjustDroneLoad(state, ctx, 'drone-assault', -16, id).ok)
    state.warehouse.items[kind] = (state.warehouse.items[kind] ?? 0) + count
    const loaded = adjustDroneLoad(state, ctx, kind, count, id)
    assert(loaded.ok, `${kind}:${count}:${loaded.error}`)
  }
  state.weekendEvent = { seq: 901, family, startedAtWallMs: NOW, coreId: 'galaxy-kor', peripheryIds: [],
    contributed: { 'galaxy-kor': 1 }, flagshipAtWallMs: NOW, flagshipHpMax: 150_000, flagshipHpDone: 0 }
  let battle = weekendStartFlagshipBattle(state, ctx, NOW, fixture.fleet)!
  assert(battle)
  state.encounter = { ...state.encounter, active: true, shipId: state.shipId, galaxyId: 'galaxy-kor', anomalyId: cards[family], battle }
  const countPools = Object.keys(battle.dronePools ?? {}).length
  const startHp = Object.values(battle.dronePools ?? {}).reduce((sum, pool) => sum + pool.s + pool.a + pool.h, 0)
  const initialPd = battle.pdCd?.length ?? 0
  let watcher = instrument ? observe(battle) : undefined, reloaded = false
  const stats = () => watcher?.result
  const phases: object[] = [], chunks: object[] = []
  let previousWave = -1
  for (let at = STEP; at <= LIMIT && battle.ended === null; at += STEP) {
    if (!reloaded && reloadAt !== null && at > reloadAt) {
      const old = { attempts: stats()?.attempts, hitEvents: stats()?.hitEvents, damage: stats()?.damage, kills: stats()?.kills }
      state = loadSaveFile(serializeSaveFile(state, NOW + at)).state
      battle = state.encounter.battle!
      watcher = instrument ? observe(battle) : undefined
      reloaded = true
      phases.push({ reloadedAt: at, pdPresent: battle.pdCd !== undefined, before: old })
    }
    state.gameMs = at
    watcher?.begin()
    advanceBattleFor(state, ctx, battle, state.shipId, cards[family])
    watcher?.end()
    if ((battle.waveIdx ?? 0) !== previousWave) {
      previousWave = battle.waveIdx ?? 0
      phases.push({ at: battle.lastTickGameMs, wave: previousWave + 1, pdPresent: battle.pdCd !== undefined,
        pdCount: battle.pdCd?.length ?? 0, droneHp: Object.values(battle.dronePools ?? {}).reduce((sum, pool) => sum + pool.s + pool.a + pool.h, 0) })
    }
    if (at % 60_000 === 0) chunks.push({ sec: at / 1000, attempts: stats()?.attempts, hitEvents: stats()?.hitEvents,
      damage: stats()?.damage, kills: stats()?.kills, consumed: stats()?.consumed, emptyConsumes: stats()?.emptyConsumes,
      pd: battle.pdCd?.slice(), distanceM: battle.distanceM, playerShots: battle.stats.meShots })
  }
  const engineSnapshot = JSON.parse(JSON.stringify({ battle, rng: state.rng }))
  const pools = Object.entries(battle.dronePools ?? {})
  const lossLedger = structuredClone(battle.droneLost ?? {})
  const inventoryBefore = Object.fromEntries(fixture.fleet.map(id => [id, { ...state.fleet[id]!.droneLoad }]))
  // 截止五分钟仍在打的场次只在隔离副本预演结算，不宣称游戏已自动收尾。
  const summaries = battle.myFleet?.map(entry => settleDroneLosses(state, ctx, entry.shipId, battle, 0, entry.tag))
  return { family, kind, countPerShip: count, reloadAt, initialPd, drones: countPools, durationSec: battle.lastTickGameMs / 1000,
    ended: battle.ended, wave: (battle.waveIdx ?? 0) + 1, finalPdPresent: battle.pdCd !== undefined,
    afterReload: reloaded, attempts: stats()?.attempts, hitEvents: stats()?.hitEvents, damage: stats()?.damage, kills: stats()?.kills,
    revivals: stats()?.revivals, attackBursts: stats()?.attackBursts, consumed: stats()?.consumed, emptyConsumes: stats()?.emptyConsumes,
    damagedSlots: stats()?.targets.size, startHp, hpLost: startHp - pools.reduce((sum, [, pool]) => sum + pool.s + pool.a + pool.h, 0),
    maxDamageToOne: Math.max(0, ...pools.map(([, p]) => (p.maxS ?? p.s) + (p.maxA ?? p.a) + (p.maxH ?? p.h) - p.s - p.a - p.h)),
    samplePool: pools[0]?.[1], lossLedger, inventoryBefore,
    inventoryAfter: Object.fromEntries(fixture.fleet.map(id => [id, state.fleet[id]?.droneLoad])), summaries, phases, chunks, engineSnapshot }
}

function tokenMismatch() {
  const state = makeExpeditionFixture('A', 19, 'drones').before
  const me: UnitSpec = { tag: 'player', name: 'fixture', side: 'me', hp: { s: 100, a: 100, h: 100 }, resists: {},
    weapons: [], agility: 0, hitMul: 1, evasion: 0, hitBonus: 0, signatureM: 100, scanResMm: 100, speedMps: 100, foeTactic: null }
  const foe: UnitSpec = { ...me, tag: 'foe-0', side: 'foe', family: 'R', hullClassTier: 5 }
  const battle = createBattleState(me, [foe], 0, 8000)
  battle.distanceM = 8000
  battle.dronePools = { 'player:0': { s: 100, a: 100, h: 100, maxS: 100, maxA: 100, maxH: 100, alive: true, artId: 'drone-assault', evasion: 0 } }
  battle.pdCd = [400]
  battle.droneHitAt = { foe: 0 }
  const rows = []
  for (let at = 0; at < 600; at += STEP) {
    battle.lastTickGameMs = at
    resolvePointDefense(state, battle, [foe], ctx.balance.battle, STEP)
    rows.push({ at, cooldown: battle.pdCd[0], token: battle.droneHitAt?.foe ?? null, hp: battle.dronePools['player:0']!.s })
  }
  assert.equal(battle.dronePools['player:0']!.s, 75, '未就绪时应保留许可，转好后只还手一次')
  battle.pdCd = [STEP]
  battle.droneHitAt = { foe: battle.lastTickGameMs }
  resolvePointDefense(state, battle, [foe], ctx.balance.battle, STEP)
  assert.equal(battle.dronePools['player:0']!.s, 50, '新许可仍可让已就绪近防炮正常还手')
  return { rows, readyControlShield: battle.dronePools['player:0']!.s }
}

function ordinary(cardId: string, fleet: boolean, reload: boolean) {
  const fixture = makeExpeditionFixture('A', 19, 'drones')
  let state = fixture.before
  let battle = fleet ? startFleetBattleFor(state, ctx, fixture.fleet, cardId, 0)! : startBattleFor(state, ctx, state.shipId, cardId, 0)!
  assert(battle, `常驻悬赏无法建档:${cardId}`)
  const initialPd = battle.pdCd?.length ?? 0
  state.expedition = { ...state.expedition, active: true, phase: 'battle', anomalyId: cardId, battle }
  if (reload) {
    state = loadSaveFile(serializeSaveFile(state, NOW)).state
    battle = state.expedition.battle!
  }
  const watcher = observe(battle)
  for (let at = STEP; at <= LIMIT && battle.ended === null; at += STEP) {
    state.gameMs = at
    watcher.begin()
    advanceBattleFor(state, ctx, battle, state.shipId, cardId)
    watcher.end()
  }
  assert.equal(battle.pdCd !== undefined, initialPd > 0)
  if (initialPd === 0) assert.equal(watcher.result.damage, 0)
  assert.equal(watcher.result.emptyConsumes, 0, '不得空消费反击许可')
  return { cardId, fleet, reload, initialPd, finalPdPresent: battle.pdCd !== undefined,
    durationSec: battle.lastTickGameMs / 1000, attempts: watcher.result.attempts, hits: watcher.result.hitEvents,
    damage: watcher.result.damage, kills: watcher.result.kills, ended: battle.ended }
}

function wormhole(reload: boolean) {
  let state = makeExpeditionFixture('C', 19, 'drones').state
  let run = state.wormhole.run!
  run.depth = 7
  const cell = run.grid!.cells.find(c => c.place === 'ship') ?? run.grid!.cells[0]!
  cell.place = 'ship'
  cell.elite = true
  delete cell.nebula
  run.grid!.pos = cell
  const started = wormholeStartBattle(state, ctx, 'node')
  assert(started.ok, `虫洞精英战应能走真实开战入口:${started.error ?? started.errorId ?? started.code}`)
  let battle = run.battle!
  const initialPd = battle.pdCd?.length ?? 0
  assert(initialPd > 0)
  const card = battleFoeAnomaly(state, ctx)!
  const foes = createFoeSpecs(card, ctx.balance.battle)
  const cardId = battle.wormhole!.cardId!
  if (reload) {
    state = loadSaveFile(serializeSaveFile(state, NOW)).state
    run = state.wormhole.run!
    battle = run.battle!
  }
  const watcher = observe(battle)
  for (let at = STEP; at <= LIMIT && battle.ended === null; at += STEP) {
    state.gameMs = at
    watcher.begin()
    advanceBattleFor(state, ctx, battle, run.fleet[0]!, cardId)
    watcher.end()
  }
  assert.equal(battle.pdCd !== undefined, true)
  assert.equal(watcher.result.emptyConsumes, 0, '洞内不得空消费反击许可')
  return { depth: run.depth, role: battle.wormhole!.expeditionRole, reload, initialPd,
    enabled: foes.filter(f => f.foePointDefenseEnabled === true).map(f => f.tag),
    disabled: foes.filter(f => f.foePointDefenseEnabled === false).map(f => f.tag),
    finalPdPresent: battle.pdCd !== undefined, durationSec: battle.lastTickGameMs / 1000,
    attempts: watcher.result.attempts, hits: watcher.result.hitEvents, damage: watcher.result.damage, kills: watcher.result.kills, ended: battle.ended }
}

function boundaryChecks() {
  const state = makeExpeditionFixture('A', 19, 'drones').before
  const me: UnitSpec = { tag: 'player', name: '边界夹具', side: 'me', hp: { s: 100, a: 100, h: 100 }, resists: {},
    weapons: [], agility: 0, evasion: 0, hitBonus: 0, signatureM: 100, scanResMm: 100, speedMps: 100, foeTactic: null }
  const foe: UnitSpec = { ...me, tag: 'foe-0', side: 'foe', family: 'R', hullClassTier: 5 }
  const make = (artId = 'drone-assault') => {
    const b = createBattleState(me, [foe], 0, 8000)
    b.distanceM = 8000
    b.dronePools = { 'player:0': { s: 100, a: 100, h: 100, alive: true, artId, evasion: 0 } }
    b.pdCd = [STEP]
    return b
  }
  const cases = [
    { id: '出击型远距反击', art: 'drone-assault', distance: 8000, token: true, enabled: true, hit: true },
    { id: '哨戒远距保护', art: 'drone-sentry', distance: 8000, token: true, enabled: true, hit: false },
    { id: '哨戒近距常驻暴露', art: 'drone-sentry', distance: 2500, token: false, enabled: true, hit: true },
    { id: '显式禁用点防', art: 'drone-assault', distance: 8000, token: true, enabled: false, hit: false },
  ]
  const checks = cases.map(c => {
    const b = make(c.art)
    b.distanceM = c.distance
    if (c.token) b.droneHitAt = { foe: 0 }
    resolvePointDefense(state, b, [{ ...foe, foePointDefenseEnabled: c.enabled }], ctx.balance.battle, STEP)
    const hp = b.dronePools!['player:0']!.s
    assert.equal(hp < 100, c.hit, c.id)
    return { id: c.id, shield: hp }
  })
  const supportBattle = make()
  supportBattle.foeReviveCount = 1
  seedUnit(supportBattle, { ...foe, tag: 'sup1-foe-0' })
  supportBattle.droneHitAt = { foe: 0 }
  const supported = foesWithSupport(supportBattle, [foe])
  assert.equal(supported.length, 2)
  resolvePointDefense(state, supportBattle, supported, ctx.balance.battle, 500)
  assert.equal(supportBattle.pdCd!.length, 2, '支援舰应缺省补出自己的冷却槽')
  assert.equal(supportBattle.dronePools!['player:0']!.s, 50, '本舰与支援舰各还手一次')
  const death = make()
  death.dronePools!['player:0'] = { s: 0, a: 0, h: 1, alive: true, artId: 'drone-assault', owner: 'player', evasion: 0 }
  death.droneHitAt = { foe: 0 }
  resolvePointDefense(state, death, [foe], ctx.balance.battle, STEP)
  assert.equal(death.dronePools!['player:0']!.alive, false)
  assert.deepEqual(death.droneLostBy, { player: { 'drone-assault': 1 } })
  assert(death.fx.some(fx => fx.droneDown === true && fx.side === 'me'))
  return { checks, support: { foes: supported.map(f => f.tag), shield: supportBattle.dronePools!['player:0']!.s },
    killed: { lossLedger: death.droneLost, lossBy: death.droneLostBy, downFx: true } }
}

const rows = (['C', 'R', 'H'] as const).flatMap(family => [null, 0, 20_000].map(at => run(family, at)))
rows.push(run('C', null, 'drone-scout', 16), run('C', null, 'drone-heavy', 8), run('C', null, 'drone-sentry', 4))
for (const row of rows) {
  assert(row.finalPdPresent, '旗舰续战应保留/恢复防空调度')
  assert.equal(row.emptyConsumes, 0, '旗舰不得空消费反击许可')
}
for (const family of ['C', 'R', 'H'] as const) {
  const observed = rows.find(row => row.family === family && row.reloadAt === null)!
  assert.deepEqual(observed.engineSnapshot, run(family, null, 'drone-assault', 16, false).engineSnapshot,
    `${family}族只读观测不得改变战斗结果或随机数`)
}
const mismatch = tokenMismatch()
const ordinaryRows = ['ano-pirate-post', 'ano-vault-sentinel'].flatMap(cardId => [false, true].flatMap(fleet => [false, true].map(reload => ordinary(cardId, fleet, reload))))
const wormholeRows = [wormhole(false), wormhole(true)]
const boundaries = boundaryChecks()
const out = resolve('tools/_ui-artifacts/drone-defense-audit-20261008')
mkdirSync(out, { recursive: true })
const baseline = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const changed = execFileSync('git', ['diff', '--name-only', 'HEAD'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean)
writeFileSync(resolve(out, 'report.json'), JSON.stringify({ baseline, changed, limitMs: LIMIT, observerControls: 'C/R/H战斗及随机数全等',
  rows: rows.map(({ engineSnapshot: _, ...row }) => row), mismatch, ordinaryRows, wormholeRows, boundaries }, null, 2), 'utf8')
const beforeArg = process.argv.indexOf('--before')
if (beforeArg >= 0) {
  assert(process.argv[beforeArg + 1], '--before需要旧报告JSON路径')
  const before = JSON.parse(readFileSync(resolve(process.argv[beforeArg + 1]!), 'utf8')) as {
    baseline: string; limitMs: number; rows: Array<{ family: string; kind: string; reloadAt: number | null;
      durationSec: number; attempts: number; damage: number; kills: number; finalPdPresent: boolean }>
  }
  assert.equal(before.limitMs, LIMIT, '新旧读数必须使用相同截止时长')
  const comparison = rows.map(row => {
    const old = before.rows.find(b => b.family === row.family && b.kind === row.kind && b.reloadAt === row.reloadAt)
    assert(old, '旧报告缺少对应场景')
    return { family: row.family, drone: row.kind, reloadAt: row.reloadAt,
      beforeSec: old.durationSec, afterSec: row.durationSec, beforeAttempts: old.attempts, afterAttempts: row.attempts,
      beforeDamage: old.damage, afterDamage: row.damage, beforeKills: old.kills, afterKills: row.kills,
      beforePd: old.finalPdPresent, afterPd: row.finalPdPresent }
  })
  writeFileSync(resolve(out, 'comparison.json'), JSON.stringify({ before: before.baseline, after: baseline, changed, comparison }, null, 2), 'utf8')
  console.table(comparison)
}
console.table(rows.map(row => ({ family: row.family, drone: row.kind, reloadAt: row.reloadAt, durationSec: row.durationSec,
  pd: row.finalPdPresent, attempts: row.attempts, hits: row.hitEvents, damage: Number(row.damage?.toFixed(2)), killed: row.kills,
  tokens: row.consumed, empty: row.emptyConsumes, damagedSlots: row.damagedSlots })))
console.log('确定性令牌错位：', JSON.stringify(mismatch))
console.table(ordinaryRows)
console.table(wormholeRows)
console.log('边界与支援舰：', JSON.stringify(boundaries))
console.log('诊断报告：', resolve(out, 'report.json'))
