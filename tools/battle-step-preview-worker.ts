/** 隔离worker，必须由battle-step-preview.ts打包；不独立改变正式战斗规则。 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { buildSimContext } from '@whale/data'
import * as combat from '../packages/core/src/combat'
import type { UnitSpec } from '../packages/core/src/combat'
import { createInitialState, type GameState, type BattleState } from '../packages/core/src/state'
import { makeExpeditionFixture } from './wormhole-expedition-fixture'
import { weekendStartFlagshipBattle } from '../packages/core/src/weekendLaunch'
import type { BattleBalance, FoeShipDef } from '../packages/core/src/types'

declare const __STEP_PREVIEW_MS__: number
declare const __STEP_PREVIEW_MAX__: number
const STEP = __STEP_PREVIEW_MS__, MAX = __STEP_PREVIEW_MAX__
const ctx = buildSimContext(), NOW = new Date(2026, 9, 9, 20).getTime()
const stepBattle = (combat as unknown as { stepBattle: (
  s: GameState, b: BattleState, my: readonly UnitSpec[], foes: UnitSpec[], desire: number, cap: number, bal: BattleBalance, dt: number,
) => void }).stepBattle
const me: UnitSpec = { tag: 'player', name: '步长夹具', side: 'me', hp: { s: 1000, a: 1000, h: 1000 }, resists: {},
  weapons: [], agility: 0, evasion: 0, hitBonus: 0, signatureM: 100, scanResMm: 100, speedMps: 0, foeTactic: null }
const foe: UnitSpec = { ...me, tag: 'foe-0', side: 'foe' }

function cycles(reloadMs: number, burst = false) {
  const w = { label: '步长测试炮', kind: 'fixed' as const, src: 'turret' as const, artId: 'fixture-gun', fixedType: 'kinetic' as const,
    shotDmg: 1, minRangeM: 0, maxRangeM: 10_000, hitRate: 1, falloff: 1, reloadMs,
    ...(burst ? { burst: { shots: 3, gapMs: 100 } } : {}) }
  const m = { ...me, weapons: [w] }, f = { ...foe, weapons: [w] }
  const state = createInitialState({ nowWallMs: 0, seed: 19 })
  const b = combat.createBattleState(m, [f], 0, 1000)
  b.distanceM = 1000
  const times = { me: [] as number[], foe: [] as number[] }
  let seq = -1
  for (let at = 0; at < 20_000; at += STEP) {
    b.lastTickGameMs = at
    stepBattle(state, b, [m], [f], 1000, 10_000, { ...ctx.balance.battle, shieldRegenPerSec: 0 }, STEP)
    for (const fx of b.fx) if (fx.seq > seq) {
      seq = fx.seq
      times[fx.side].push(fx.atMs)
    }
  }
  return { reloadMs, burst, times, gapsMe: times.me.slice(1).map((t, i) => t - times.me[i]!),
    gapsFoe: times.foe.slice(1).map((t, i) => t - times.foe[i]!) }
}

function guardGroups() {
  const shot = (tag: string) => ({ ...foe, tag, weapons: [{ label: '齐射归组测试炮', kind: 'beam' as const, src: 'laser' as const,
    fixedType: 'plasma' as const, shotDmg: 180, minRangeM: 0, maxRangeM: 10_000, hitRate: 1, falloff: 1, reloadMs: 10_000 }] })
  const m = { ...me, hp: { s: 0, a: 0, h: 100 } }, foes = [shot('foe-0'), shot('foe-1')]
  const s = createInitialState({ nowWallMs: 0, seed: 19 })
  const b = combat.createBattleState(m, foes, 0, 1000)
  b.distanceM = 1000
  b.units['foe-1']!.weapons = [50]
  for (let at = 0; at < 100 && !b.ended; at += STEP) {
    b.lastTickGameMs = at
    stepBattle(s, b, [m], foes, 1000, 10_000, { ...ctx.balance.battle, shieldRegenPerSec: 0 }, STEP)
  }
  return { hullLeft: b.units.player!.hp.h, ended: b.ended }
}

function regen() {
  const s = createInitialState({ nowWallMs: 0, seed: 19 })
  const idleFoe = { ...foe, weapons: [{ label: '空载测试炮', kind: 'fixed' as const, shotDmg: 0, fixedType: 'kinetic' as const,
    minRangeM: 0, maxRangeM: 10_000, hitRate: 0, falloff: 1, reloadMs: 1e9 }] }
  const b = combat.createBattleState(me, [idleFoe], 0, 8000)
  b.distanceM = 8000
  b.units.player!.hp.s = 700
  for (let at = 0; at < 10_000; at += STEP) {
    b.lastTickGameMs = at
    stepBattle(s, b, [me], [idleFoe], 8000, 10_000, ctx.balance.battle, STEP)
  }
  return { shieldAfter10s: b.units.player!.hp.s, continuousReference: 700 * Math.exp(.02 * 10) }
}

function longGuard() {
  const fixture = makeExpeditionFixture('A', 19, 'drones')
  const s = fixture.before
  const uid = fixture.fleet[0]!
  s.fleet[uid]!.fitted = { high: [], mid: [], low: [] }
  s.fleet[uid]!.droneLoad = undefined
  const source = ctx.anomalies.get('ano-training')!
  const inert: FoeShipDef = { id: 'step-guard', name: '补算预算夹具', family: 'A', hullClassTier: 5,
    hp: 1e9, split: { s: .3, a: .4, h: .3 }, speedRatio: 0, tactic: 'orbit',
    shotDmg: .001, rangeMinM: 0, rangeMaxM: 100_000, reloadMs: 1e9, hitRate: 0, falloff: 1, dmgMix: { kinetic: 1 } }
  const card = { ...source, threat: 20, threatJudged: 20, ships: [{ ship: inert, count: 1 }], waves: undefined }
  const c = { ...ctx, anomalies: new Map([...ctx.anomalies, [card.id, card]]) }
  const b = combat.startBattleFor(s, c, uid, card.id, 0)!
  assert(b)
  s.fleet[uid]!.fitted = { high: [], mid: [], low: [] }
  // 两侧无有效火力：单调用推进应到时限，测补算预算而非挑战敌卡平衡。
  const silent = { ...c, balance: { ...c.balance, battle: { ...c.balance.battle,
    cannotEngageMs: 1e9, maxBattleMs: 600_000 } } }
  b.myDesireM = 50_000
  b.distanceM = 50_000
  s.gameMs = 605_000
  const t0 = performance.now()
  combat.advanceBattleFor(s, silent, b, uid, card.id)
  return { advancedMs: b.lastTickGameMs, ended: b.ended, elapsedMs: performance.now() - t0,
    capMs: STEP * MAX, timeoutMs: silent.balance.battle.maxBattleMs }
}

const baseFixtures = {
  drones: makeExpeditionFixture('A', 19, 'drones'), guns: makeExpeditionFixture('A', 19, 'guns'),
}
const cases = [
  { id: 'C旗舰-赤鸢64', family: 'C' as const, cardId: 'alien-broodmother', kind: 'drones' as const, flagship: true },
  { id: 'R旗舰-赤鸢64', family: 'R' as const, cardId: 'corona-nexus', kind: 'drones' as const, flagship: true },
  { id: 'H旗舰-赤鸢64', family: 'H' as const, cardId: 'ink-flagship', kind: 'drones' as const, flagship: true },
  { id: 'C旗舰-炮击4舰', family: 'C' as const, cardId: 'alien-broodmother', kind: 'guns' as const, flagship: true },
  { id: '穹顶守卫-赤鸢64', family: 'C' as const, cardId: 'ano-vault-sentinel', kind: 'drones' as const, flagship: false },
]

function run(c: typeof cases[number], seed: number, collectTiming: boolean) {
  const fixture = baseFixtures[c.kind]
  const state = structuredClone(fixture.before)
  state.rng = { seed, count: 0 }
  state.weekendEvent = { seq: 901, family: c.family, startedAtWallMs: NOW, coreId: 'galaxy-kor', peripheryIds: [],
    contributed: { 'galaxy-kor': 1 }, flagshipAtWallMs: NOW, flagshipHpMax: 150_000, flagshipHpDone: 0 }
  const b = c.flagship ? weekendStartFlagshipBattle(state, ctx, NOW, fixture.fleet)! : combat.startFleetBattleFor(state, ctx, fixture.fleet, c.cardId, 0)!
  assert(b)
  const calls: number[] = [], start = performance.now()
  let missingFx = 0, peakProducedFx = 0, shotGapMaxMs = 0, previousShotAt = 0
  for (let at = 100; at <= 300_000 && !b.ended; at += 100) {
    state.gameMs = at
    const t0 = collectTiming ? performance.now() : 0
    const firstSeq = b.fxSeq
    combat.advanceBattleFor(state, ctx, b, state.shipId, c.cardId)
    if (collectTiming) calls.push(performance.now() - t0)
    const produced = b.fxSeq - firstSeq
    const available = b.fx.filter(f => f.seq >= firstSeq)
    missingFx += produced - available.length
    peakProducedFx = Math.max(peakProducedFx, produced)
    for (const fx of available) if (!fx.blink && !fx.web && !fx.droneDown && !fx.acidBurst) {
      shotGapMaxMs = Math.max(shotGapMaxMs, fx.atMs - previousShotAt)
      previousShotAt = fx.atMs
    }
  }
  const elapsed = performance.now() - start
  calls.sort((a, b) => a - b)
  const hp = Object.values(b.units).filter(u => u.side === 'me').reduce((n, u) => n + u.hp.s + u.hp.a + u.hp.h, 0)
  const pools = Object.values(b.dronePools ?? {})
  return { seed, seconds: b.lastTickGameMs / 1000, ended: b.ended, wave: (b.waveIdx ?? 0) + 1,
    playerShots: b.stats.meShots, playerDamage: b.stats.meDmg, foeShots: b.stats.foeShots,
    lost: Object.values(b.droneLost ?? {}).reduce((n, x) => n + x, 0), hp,
    droneHp: pools.reduce((n, p) => n + p.s + p.a + p.h, 0), rngCount: state.rng.count,
    missingFx, peakProducedFx, shotGapMaxMs, elapsedMs: elapsed, msPerGameSecond: elapsed / Math.max(.1, b.lastTickGameMs / 1000),
    p95CallMs: calls[Math.floor(calls.length * .95)] ?? 0, maxCallMs: calls.at(-1) ?? 0 }
}

const scenarios = []
for (const c of cases) {
  run(c, 19, false) // 每类先热身，计时不包含训练、研究、装配或建档。
  const rows = [19, 105, 178, 251, 324].map(seed => run(c, seed, true))
  const avg = (key: keyof typeof rows[number]) => rows.reduce((n, r) => n + Number(r[key]), 0) / rows.length
  scenarios.push({ id: c.id, rows, summary: { seconds: avg('seconds'), lost: avg('lost'), playerShots: avg('playerShots'),
    playerDamage: avg('playerDamage'), foeShots: avg('foeShots'), hp: avg('hp'),
    missingFx: avg('missingFx'), peakProducedFx: avg('peakProducedFx'), shotGapMaxMs: avg('shotGapMaxMs'),
    msPerGameSecond: avg('msPerGameSecond'), p95CallMs: avg('p95CallMs'), maxCallMs: avg('maxCallMs') } })
  console.log(`${STEP}ms/${MAX} ${c.id} 完成5种子`)
}
const timing = [cycles(500), cycles(1755), cycles(4400), cycles(3000, true)]
const result = { stepMs: STEP, maxSteps: MAX, externalPumpMs: 100, queueEnabled: true,
  timing, guardGroups: guardGroups(), regen: regen(), longGuard: longGuard(),
  movementFloor: { speedMps: 0, metersPerStep: combat.steerStep(1000, 2000, 0, STEP / 1000),
    metersPerSecond: combat.steerStep(1000, 2000, 0, STEP / 1000) * 1000 / STEP }, scenarios }
const out = resolve('tools/_ui-artifacts/battle-step-preview-20261008-implementation')
mkdirSync(out, { recursive: true })
writeFileSync(resolve(out, `report-${STEP}-${MAX}.json`), JSON.stringify(result, null, 2), 'utf8')
console.table(scenarios.map(s => ({ step: STEP, id: s.id, ...s.summary })))
console.log(JSON.stringify({ timing: timing.map(t => ({ reload: t.reloadMs, burst: t.burst, meFirst: t.times.me[0],
  meGaps: t.gapsMe.slice(0, 7), foeFirst: t.times.foe[0], foeGaps: t.gapsFoe.slice(0, 7) })),
  guardGroups: result.guardGroups, regen: result.regen, longGuard: result.longGuard }))
