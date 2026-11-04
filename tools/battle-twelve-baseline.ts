/** 12对12实施前基线：独立合成状态、正式装配/战斗推进与现行布局，不读取个人档。
 * npx tsx tools/battle-twelve-baseline.ts
 * 输出tools/_ui-artifacts/battle-twelve-20261030/before.json；不是原生窗口帧率结论。
 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../packages/core/src/state'
import { addShipToFleet } from '../packages/core/src/fleetBook'
import { adjustDroneLoad, fitModule } from '../packages/core/src/equipment'
import { advanceBattleFor, createPlayerSpec, startFleetBattleFor } from '../packages/core/src/combat'
import { layout, sizeOfUnit } from '../apps/desktop/src/renderer/src/features/combat/battleViewCore'
import type { AnomalyDef } from '../packages/core/src/types'

const ctx = buildSimContext()
const out = resolve('tools/_ui-artifacts/battle-twelve-20261030')
function quantile(samples: number[], fraction: number): number {
  const values = [...samples].sort((a, b) => a - b)
  return values[Math.min(values.length - 1, Math.floor(values.length * fraction))]!
}

function trial(count: number, drones: boolean, seed: number) {
  const state = createInitialState({ nowWallMs: 0, seed })
  state.fleet = {}
  state.skills.trained = Object.fromEntries([...ctx.skills.keys()].map(id => [id, 3]))
  state.resupplyFromWarehouse = true
  state.warehouse.items['ammo-kinetic-l'] = 1_000_000
  state.warehouse.items['drone-scout'] = 10_000
  const ids = Array.from({ length: count }, () => addShipToFleet(state, 'sh-hammerhead'))
  state.shipId = ids[0]!
  for (const uid of ids) {
    for (const moduleId of ['mod-prop-2', 'mod-shield-kin-2', 'mod-armor-plate-2', ...Array(5).fill('mod-turret-kin-2')]) {
      state.moduleBay[moduleId] = (state.moduleBay[moduleId] ?? 0) + 1
      assert(fitModule(state, moduleId, ctx, { shipId: uid }).ok, `非法配装:${uid}/${moduleId}`)
    }
    if (drones) for (let i = 0; i < 10; i++) if (!adjustDroneLoad(state, ctx, 'drone-scout', 1, uid).ok) break
  }
  // 仅增加合成夹具容量以维持30秒压力；不改任何正式敌卡、舰船或预算。
  const hull = ctx.ships.get('sh-hammerhead')!
  const enemy = ctx.foeShips!.get('foe-alien-hiveback')!
  const card: AnomalyDef = { ...ctx.anomalies.get('ano-training')!, id: 'twelve-baseline',
    waves: undefined, foeTargeting: 'random', ships: [{ count,
      ship: { ...enemy, hp: 1e9, shotDmg: 1, gunCount: 4, reloadMs: 1000,
        mounts: [], drones: drones ? enemy.drones : undefined, droneFireShare: undefined,
        rangeMinM: 1, rangeMaxM: 10000, speedRatio: 0, tactic: 'orbit' } }] }
  const local = { ...ctx, ships: new Map(ctx.ships).set(hull.id, { ...hull, shieldHp: 1e8, armorHp: 1e8, hullHp: 1e8 }),
    anomalies: new Map(ctx.anomalies).set(card.id, card) }
  const battle = startFleetBattleFor(state, local, ids, card.id, 0, 1000)!
  assert(battle)
  battle.distanceM = 1000
  const samples: number[] = []
  const started = performance.now()
  for (let tick = 1; tick <= 300; tick++) {
    state.gameMs = tick * 100
    const before = performance.now()
    advanceBattleFor(state, local, battle, ids[0]!, card.id)
    samples.push(performance.now() - before)
    assert.equal(battle.ended, null)
  }
  assert.equal(battle.myFleet!.length, count)
  assert.equal(Object.values(battle.units).filter(unit => unit.side === 'foe').length, count)
  return { count, drones, seed, simulatedSeconds: 30, ticks: samples.length,
    advanceTotalMs: performance.now() - started, tickMedianMs: quantile(samples, 0.5),
    tickP95Ms: quantile(samples, 0.95), tickMaxMs: Math.max(...samples),
    shots: { player: battle.stats.meShots, foe: battle.stats.foeShots },
    loadedPlayerDrones: ids.reduce((sum, id) => sum + Object.values(state.fleet[id]!.droneLoad ?? {}).reduce((a, b) => a + b, 0), 0),
    weaponGroups: createPlayerSpec(state, local, ids[0]!)!.weapons.length }
}

// 预热不计入性能报告；实测报告保留每个确定种子，不能拿一轮最大值代表稳定上界。
trial(1, false, 1)
const timings = []
for (const count of [1, 4, 12]) for (const drones of [false, true]) for (const seed of [11, 29, 47]) {
  const reading = trial(count, drones, seed)
  timings.push(reading)
  console.log(JSON.stringify(reading))
}
const geometry = []
const sizes = Array.from({ length: 12 }, () => sizeOfUnit(3, false))
for (const [W, H] of [[1600, 900], [1280, 720], [390, 844]]) {
  const scene = layout({ W: W!, H: H!, meW: sizes[0]!, foeW: sizes[0]! }, sizes, 5000, 10000, 200, sizes[0]!, sizes)
  const playerBounds = scene.my.map((point, index) => ({ left: point.x - sizes[index]! / 2, right: point.x + sizes[index]! / 2, top: point.y - sizes[index]! * 0.23 }))
  const foeBounds = scene.foe.map((point, index) => ({ left: point.x - scene.sizes[index]! / 2, right: point.x + scene.sizes[index]! / 2, top: point.y - scene.sizes[index]! * 0.23 }))
  geometry.push({ W, H, playerOutOfBounds: playerBounds.filter(rect => rect.left < 0 || rect.right > W! || rect.top < 0).length,
    foeOutOfBounds: foeBounds.filter(rect => rect.left < 0 || rect.right > W! || rect.top < 0).length,
    minPlayerX: Math.min(...playerBounds.map(rect => rect.left)), maxFoeX: Math.max(...foeBounds.map(rect => rect.right)),
    playerCount: scene.my.length, foeCount: scene.foe.length })
}
mkdirSync(out, { recursive: true })
writeFileSync(resolve(out, 'before.json'), JSON.stringify({ syntheticOnly: true, productionChanged: false,
  scope: 'Node引擎逐拍耗时与纯布局几何；未验证原生FPS、交互、12舰门槛或结算闭环', timings, geometry }, null, 2), 'utf8')
console.log(JSON.stringify({ ok: true, timingCases: timings.length, geometry, out }))
