/** 无人机首次出击错峰隔离预演worker，不独立代表正式平衡。 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { addShipToFleet, createInitialState, repairDeprecatedModules } from '@whale/core'
import type { GameState } from '@whale/core'
import { buildSimContext } from '@whale/data'
import { advanceBattleFor, startBattleFor } from '../packages/core/src/combat'
import type { DroneLaunchPreviewMode } from './drone-launch-preview-curves'
import { previewDroneLaunchGate, previewDroneLaunchObserve } from './drone-launch-preview-curves'

declare const __DRONE_LAUNCH_MODE__: DroneLaunchPreviewMode
const mode = __DRONE_LAUNCH_MODE__
const ctx = buildSimContext()
const seedCount = process.argv.includes('--seeds') ? Number(process.argv[process.argv.indexOf('--seeds') + 1]) : 20
assert(Number.isInteger(seedCount) && seedCount > 0 && seedCount <= 20)
const seeds = Array.from({ length: seedCount }, (_, i) => 105 + i * 73)
const targets = ['ano-maw-hunt', 'ano-gravekeeper', 'ano-vault-sentinel']
const fullSkills = [
  'gunnery', 'kinetic-gunnery', 'missile-launching', 'laser-cannon', 'fire-control', 'reload-drills',
  'drone-warfare', 'drone-servicing', 'drone-strike', 'drone-durability', 'drone-reinforce', 'drone-evasion',
  'ammunition-condensing', 'shield-operation', 'energy-management', 'hull-upgrades', 'shield-tuning', 'armor-tuning',
  'armed-ops', 'armored-ops', 'vector-maneuvering', 'evasion-maneuvering', 'targeting-integration', 'ship-systems-engineering',
]
const configs = [
  {
    id: 'd3', name: '王鲭标准D3', drones: { 'drone-heavy': 4, 'drone-sentry': 6 },
    high: ['mod-drone-rack-3', 'mod-drone-rack-3', 'mod-drone-tac-3', 'mod-drone-tac-3'],
  },
  {
    id: 'heavy16', name: '王鲭满舱16猎鹰', drones: { 'drone-heavy': 16 },
    high: ['mod-drone-rack-3', 'mod-drone-rack-3', 'mod-drone-tac-3', 'mod-drone-tac-3'],
  },
] as const

function makeState(config: (typeof configs)[number], seed: number): GameState {
  const state = createInitialState({ nowWallMs: 1791180000000, seed })
  state.wallet.isk = 1e12
  const uid = addShipToFleet(state, 'sh-sentinel')
  state.shipId = uid
  for (const skill of fullSkills) state.skills.trained[skill] = 5
  state.fleet[uid]!.fitted = {
    high: [...config.high],
    mid: ['mod-shield-kin-2', 'mod-gyro-2'],
    low: ['mod-armor-kin-2', 'mod-armor-plate-2'],
  }
  state.fleet[uid]!.droneLoad = { ...config.drones }
  repairDeprecatedModules(state, ctx)
  for (const id of ['ammo-kinetic-l', 'ammo-plasma-l', 'ammo-explosive-l']) state.warehouse.items[id] = 1000000
  return state
}

type BattleReading = {
  win: boolean
  seconds: number
  hpFraction: number
  droneDamage5: number
  droneDamage10: number
  droneDamage20: number
  droneDamageTotal: number
  droneShots5: number
  droneShots10: number
  droneShots20: number
  droneShotsTotal: number
  droneLost: number
  enemyDroneDownEvents: number
}
type NumericReading = Exclude<keyof BattleReading, 'win'>

function run(config: (typeof configs)[number], target: string, seed: number): BattleReading {
  const state = makeState(config, seed)
  const battle = startBattleFor(state, ctx, state.shipId, target, 0, 1000)
  assert(battle)
  const unit = battle.units.player!
  const maxHp = unit.hp.s + unit.hp.a + unit.hp.h
  let lastSeq = -1
  let damage5 = 0, damage10 = 0, damage20 = 0, damageTotal = 0
  let shots5 = 0, shots10 = 0, shots20 = 0, shotsTotal = 0
  let enemyDroneDownEvents = 0
  const maxMs = ctx.balance.battle.maxBattleMs + 5_000
  for (let elapsed = 100; elapsed <= maxMs; elapsed += 100) {
    state.gameMs = battle.startedAtGameMs + elapsed
    advanceBattleFor(state, ctx, battle, state.shipId, target)
    for (const event of battle.fx) {
      if (event.seq <= lastSeq) continue
      lastSeq = event.seq
      const at = event.atMs - battle.startedAtGameMs
      if (event.droneDown === true && event.side === 'me') enemyDroneDownEvents += 1
      if (event.side !== 'me' || event.src !== 'drone') continue
      const dmg = event.dmg ?? 0
      shotsTotal += 1
      damageTotal += dmg
      if (at <= 5_000) { shots5 += 1; damage5 += dmg }
      if (at <= 10_000) { shots10 += 1; damage10 += dmg }
      if (at <= 20_000) { shots20 += 1; damage20 += dmg }
    }
    if (battle.ended) break
  }
  assert(battle.ended)
  const hp = battle.units.player!.hp
  const lost = Object.values(battle.droneLost ?? {}).reduce((sum, n) => sum + n, 0)
  return {
    win: battle.ended === 'me', seconds: (battle.lastTickGameMs - battle.startedAtGameMs) / 1000,
    hpFraction: (hp.s + hp.a + hp.h) / Math.max(1, maxHp),
    droneDamage5: damage5, droneDamage10: damage10, droneDamage20: damage20, droneDamageTotal: damageTotal,
    droneShots5: shots5, droneShots10: shots10, droneShots20: shots20, droneShotsTotal: shotsTotal,
    droneLost: lost, enemyDroneDownEvents,
  }
}

const cells: any[] = []
for (const config of configs) for (const target of targets) {
  const readings = seeds.map((seed) => run(config, target, seed))
  const average = (field: NumericReading): number => readings.reduce((sum, row) => sum + Number(row[field]), 0) / readings.length
  cells.push({ mode, config: config.id, name: config.name, target, seeds, summary: {
    winRate: average('win'), seconds: average('seconds'), hpFraction: average('hpFraction'), droneLost: average('droneLost'),
    droneDamage5: average('droneDamage5'), droneDamage10: average('droneDamage10'), droneDamage20: average('droneDamage20'), droneDamageTotal: average('droneDamageTotal'),
    droneShots5: average('droneShots5'), droneShots10: average('droneShots10'), droneShots20: average('droneShots20'), droneShotsTotal: average('droneShotsTotal'),
    enemyDroneDownEvents: average('enemyDroneDownEvents'),
  }, readings })
  console.log(`${mode} ${config.id} ${target} 完成${seedCount}种子`)
}

const out = resolve('tools/_ui-artifacts/drone-launch-preview')
mkdirSync(out, { recursive: true })
writeFileSync(resolve(out, `report-${mode}.json`), JSON.stringify({ mode, seeds, cells, note: '仅隔离首次出击错峰，哨戒机与无人机攻击间隔保持原规则。' }, null, 2), 'utf8')
console.log(JSON.stringify({ ok: true, mode, cells: cells.length, battles: cells.length * seedCount }))
