import assert from 'node:assert/strict'
import { addShipToFleet, createInitialState } from '@whale/core'
import type { SimContext } from '@whale/core'
import { cpuBudgetOf, fittedCpuUsed, droneCpuUsed, droneBayTotalM3 } from '../packages/core/src/equipment'
import { moduleAllowedOnShip } from '../packages/core/src/shipFitting'

export const ALIEN_TEST_PROFILES = [
  { id: 'A0', ship: 'sh-mako', high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'], mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2'], low: ['mod-stab-kin-2', 'mod-armor-kin-2'], desire: 3220 },
  { id: 'A1', ship: 'sh-mako', high: ['mod-turret-kin-1', 'mod-turret-kin-1', 'mod-turret-kin-1', 'mod-turret-kin-1'], mid: ['mod-shield-kin-2', 'mod-track-2'], low: ['mod-stab-kin-2', 'mod-armor-kin-2'], desire: 1735 },
  { id: 'A2', ship: 'sh-mako', high: ['mod-missile-2', 'mod-missile-2', 'mod-missile-2', 'mod-missile-2'], mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2'], low: ['mod-stab-kin-2', 'mod-armor-kin-2'], desire: 6330 },
  { id: 'A3', ship: 'sh-mako', high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'], mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2'], low: ['mod-stab-kin-2', 'mod-armor-kin-2'], desire: 3220 },
  { id: 'ranged', ship: 'sh-hammerhead', high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3'], mid: ['mod-shield-kin-2', 'mod-shield-pla-2', 'mod-gyro-2'], low: ['mod-armor-plate-2', 'mod-armor-kin-2'], desire: 5000 },
  { id: 'close', ship: 'sh-hammerhead', high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3'], mid: ['mod-shield-kin-2', 'mod-shield-pla-2', 'mod-prop-2'], low: ['mod-armor-plate-2', 'mod-armor-kin-2'], desire: 900 },
  { id: 'laser', ship: 'sh-hammerhead', high: ['mod-laser-3', 'mod-laser-3', 'mod-laser-3', 'mod-laser-3'], mid: ['mod-shield-kin-2', 'mod-shield-pla-2', 'mod-gyro-2'], low: ['mod-armor-plate-2', 'mod-armor-kin-2'], desire: 4000 },
  { id: 'aa', ship: 'sh-hammerhead', high: ['mod-pd-e-3', 'mod-pd-e-3', 'mod-laser-3', 'mod-laser-3'], mid: ['mod-shield-kin-2', 'mod-shield-pla-2', 'mod-gyro-2'], low: ['mod-armor-plate-2', 'mod-armor-kin-2'], desire: 3000 },
  { id: 'drones', ship: 'sh-sentinel', high: ['mod-drone-tac-3', 'mod-drone-tac-3', 'mod-pd-e-3'], mid: ['mod-shield-kin-2', 'mod-shield-pla-2'], low: ['mod-armor-plate-2'], drones: { 'drone-heavy': 8 }, desire: 3000 },
  { id: 'small', ship: 'sh-wh-c-frigate', high: ['mod-laser-2', 'mod-laser-2'], mid: ['mod-prop-2', 'mod-gyro-2'], low: ['mod-armor-plate-2', 'mod-armor-kin-2'], plugs: ['plug-armor-plate', 'plug-hull-plate', 'plug-thruster'], desire: 1000 },
  { id: 'heavy', ship: 'sh-megalodon', high: ['mod-missile-3', 'mod-missile-3', 'mod-missile-3', 'mod-missile-3', 'mod-pd-e-3'], mid: ['mod-shield-kin-2', 'mod-shield-pla-2', 'mod-gyro-2'], low: ['mod-armor-plate-2', 'mod-armor-kin-2'], desire: 6000 },
] as const

export function alienFixture(ctx: SimContext, profileId = 'heavy', seed = 611, squadSize = 1) {
  const profile = ALIEN_TEST_PROFILES.find(row => row.id === profileId)
  assert(profile, `未知测试配装：${profileId}`)
  const state = createInitialState({ nowWallMs: new Date(2026, 9, 9, 20).getTime(), seed })
  state.wallet.isk = 1_000_000_000
  state.standings.dsi = 100
  state.standingsEarned = { dsi: 100 }
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  if (profileId === 'A3') for (const id of ['gunnery', 'kinetic-gunnery', 'reload-drills', 'fire-control', 'targeting-integration', 'shield-operation']) state.skills.trained[id] = 3
  else for (const id of ctx.skills.keys()) state.skills.trained[id] = profileId.startsWith('A') ? 3 : 5
  const ships: string[] = []
  for (let i = 0; i < squadSize; i++) {
    const id = addShipToFleet(state, profile.ship)
    const ship = state.fleet[id]!
    ship.fitted = { high: [...profile.high], mid: [...profile.mid], low: [...profile.low] }
    if ('plugs' in profile) ship.plugs = [...profile.plugs]
    if ('drones' in profile) ship.droneLoad = { ...profile.drones }
    const def = ctx.ships.get(profile.ship)!
    for (const rack of ['high', 'mid', 'low'] as const) {
      assert(ship.fitted[rack].length <= (def.slots?.[rack] ?? 0), `槽位超限：${profileId}/${rack}`)
      for (const mid of ship.fitted[rack]) {
        const mod = ctx.modules.get(mid!)
        assert(mod && mod.rack === rack && moduleAllowedOnShip(def, mod), `非法模块：${profileId}/${mid}`)
      }
    }
    assert(fittedCpuUsed(ship.fitted, ctx, def) + droneCpuUsed(ship.droneLoad, ctx) <= cpuBudgetOf(state, ctx, id), `算力超载：${profileId}`)
    const droneVolume = Object.entries(ship.droneLoad ?? {}).reduce((n, [kind, count]) => n + (ctx.items.get(kind)?.unitM3 ?? 0) * count, 0)
    assert(droneVolume <= droneBayTotalM3(def, ship.fitted, ctx), `机舱超载：${profileId}`)
    ships.push(id)
  }
  state.shipId = ships[0]!
  state.weekendPrepSquad = ships
  for (const item of ['ammo-kinetic-l', 'ammo-plasma-l', 'ammo-explosive-l']) state.warehouse.items[item] = 100_000
  state.warehouse.items['repairkit-mil'] = 1000
  return { state, ships, desire: profile.desire }
}
