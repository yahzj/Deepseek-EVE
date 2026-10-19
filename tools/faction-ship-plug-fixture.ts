/** 五件势力船插合成验收档；make-test-save.ts faction-ship-plugs与原生检查共用，不读取个人档。 */
import assert from 'node:assert/strict'
import { buildSimContext } from '@whale/data'
import { createInitialState, addShipToFleet, FIRST_TASKS, fitModule, installPlug, adjustDroneLoad } from '@whale/core'
import type { GameState } from '@whale/core'

export const FACTION_PLUG_IDS = ['plug-pirate-raider', 'plug-alien-shield-coating', 'plug-gravekeeper-capacitor', 'plug-titan-compression', 'plug-deadarmy-printing'] as const

export function injectFactionShipPlugFixture(state: GameState): string[] {
  const ctx = buildSimContext()
  Object.assign(state, createInitialState({ nowWallMs: Date.now(), seed: 20261019 }))
  state.modeChosen = true
  state.character.name = '势力船插验收'
  state.wallet.isk = 1e9
  state.standings.dsi = 300
  state.standingsEarned = { dsi: 0 }
  state.standingClawbackDone = true
  state.blackboxSeen = true
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  for (const task of FIRST_TASKS) state.importantTasks[task.id] = { done: true }
  for (const id of ctx.commsMessages.keys()) { state.commsDelivered![id] = 0; state.commsRead![id] = true }
  state.commsPopups = []
  state.warehouse.items['drone-scout'] = 100
  state.warehouse.items['ammo-kinetic-l'] = 10000
  state.warehouse.items['repairkit-mil'] = 100
  for (const id of FACTION_PLUG_IDS) {
    state.moduleBay[id] = 10
    for (const mat of ctx.blueprints.get(`bp-${id}`)!.materials) state.warehouse.items[mat.itemId] = mat.count * 10
  }
  for (const selection of [...FACTION_PLUG_IDS.map(id => [id]), [...FACTION_PLUG_IDS]]) {
    const uid = addShipToFleet(state, 'sh-wh-e-frigate')
    const ship = state.fleet[uid]!
    ship.customName = selection.length === 5 ? '五件组合验收舰' : `${ctx.modules.get(selection[0]!)!.name}验收舰`
    if (selection.length === 5) state.shipId = uid
    ship.fitted = { high: [], mid: [], low: [] }
    for (const id of ['mod-stealth-3', 'mod-drone-deck-1', 'mod-turret-kin-1', 'mod-prop-1']) {
      state.moduleBay[id] = (state.moduleBay[id] ?? 0) + 1
      assert(fitModule(state, id, ctx, { shipId: uid }).ok, `测试装配被拒：${id}`)
    }
    for (const id of selection) assert(installPlug(state, ctx, id, uid).ok, `测试船插被拒：${id}`)
    assert(adjustDroneLoad(state, ctx, 'drone-scout', 2, uid).ok, '测试机群装载被拒')
  }
  return ['全新合成档：五艘单件对照舰和一艘五件组合舰，均走正式装配入口；材料、声望与备件齐备。',
    '装配页核对插件富卡与预算；章鱼人兑换图纸后可在组装机制造。所有战斗测试仅使用本档，个人档先通过游戏内备份。']
}
