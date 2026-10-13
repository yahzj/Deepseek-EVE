/** 全舰血量与近盲开火验收门槛，复用靶场合成档，不读取个人档。
 * 通过make-test-save.ts ship-hp-blind生成；v0.1.0/存档v31，2026-10-13。
 */
import { addShipToFleet, loadSaveFile, FIRST_TASKS, repairDeprecatedModules } from '@whale/core'
import { buildSimContext } from '@whale/data'
import type { GameState } from '@whale/core'
import { fittingRangeFixture } from './fitting-range-fixture'

export function injectShipHpBlindFixture(state: GameState): string[] {
  const ctx = buildSimContext()
  Object.assign(state, loadSaveFile(fittingRangeFixture()).state)
  state.wallet.isk = 1e9
  const fleet = [
    ['sh-megalodon', ['mod-turret-kin-3', 'mod-turret-kin-3']],
    ['sh-megalodon', ['mod-laser-3', 'mod-laser-3']],
    ['sh-megalodon', ['mod-missile-3', 'mod-missile-3']],
    ['sh-megalodon', ['mod-shieldfield-2']],
    ['sh-megalodon', []],
  ] as const
  for (const [index, [defId, high]] of fleet.entries()) {
    const uid = addShipToFleet(state, defId)
    state.fleet[uid]!.fitted = { high: [...high], mid: ['mod-hullrep-2'], low: [] }
    if (index === 0) {
      state.shipId = uid
      state.fleet[uid]!.plugs = ['plug-shield-plate', 'plug-armor-plate']
    }
  }
  for (const id of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l', 'repairkit-civ', 'repairkit-mil']) state.warehouse.items[id] = 50000
  for (const id of ['mod-shieldfield-2', 'mod-turret-kin-3', 'mod-missile-3', 'mod-laser-3',
    ...[...ctx.modules.values()].filter(mod => mod.shieldPulsePct !== undefined).map(mod => mod.id)]) {
    if (ctx.modules.has(id)) state.moduleBay[id] = 10
  }
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  for (const task of FIRST_TASKS) state.importantTasks[task.id] = { done: true }
  state.standings['dsi'] = 100
  state.standingsEarned = { ...state.standingsEarned, dsi: 100 }
  state.debugQuick = false
  repairDeprecatedModules(state, ctx)
  for (const ship of Object.values(state.fleet)) {
    for (const id of ship.fitted.high) if (id && !ctx.modules.has(id)) throw new Error(`验收装备不存在：${id}`)
  }
  return ['五艘同型船分别用于炮台/激光/导弹/纯力场/空高槽对照，装配页可进入靶场。', '已有原靶场机库船用于无人机和酸液投射器对照；恢复与共享池由专项和真实开战验证。']
}
