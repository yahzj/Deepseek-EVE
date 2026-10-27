/** 多件惩罚验收夹具：独立合成状态与正式装配入口，不读取个人档。 */
import assert from 'node:assert/strict'
import { buildSimContext } from '@whale/data'
import { addShipToFleet, createInitialState, FIRST_TASKS, fitModule, installPlug } from '@whale/core'
import type { GameState } from '@whale/core'

export function injectSupportPlugStackingFixture(state: GameState): string[] {
  Object.assign(state, createInitialState({ nowWallMs: Date.now(), seed: 20261023 }))
  const ctx = buildSimContext()
  state.modeChosen = true
  state.character.name = '多件惩罚验收'
  state.wallet.isk = 1e9
  state.standings.dsi = 60
  state.standingsEarned = { dsi: 0 }
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  for (const task of FIRST_TASKS) state.importantTasks[task.id] = { done: true }
  for (const id of ctx.commsMessages.keys()) { state.commsDelivered![id] = 0; state.commsRead![id] = true }
  state.commsPopups = []
  for (const type of ['kinetic', 'explosive', 'plasma']) state.warehouse.items[`ammo-${type}-l`] = 100000
  for (const mod of ctx.modules.values()) state.moduleBay[mod.id] = 10
  const uid = addShipToFleet(state, 'sh-xuanwu')
  const support = state.fleet[uid]!
  support.customName = '支援件混装验收'
  support.fitted = { high: [], mid: [], low: [] }
  for (const id of ['mod-turret-kin-3', 'mod-wh-g-ballistic', 'mod-wh-g-ballistic', 'mod-wh-d-steady', 'mod-stab-kin-3', 'mod-wh-d-loader', 'mod-rof-3']) {
    assert(fitModule(state, id, ctx, { shipId: uid }).ok, `验收装备装配失败：${id}`)
  }
  const plugins = ['plug-shield-plate', 'plug-armor-plate', 'plug-hull-plate', 'plug-firepower', 'plug-sight',
    'plug-rangefinder', 'plug-thruster', 'plug-titan-compression', 'plug-cpu-core', 'plug-target-beacon', 'plug-concealment']
  for (const id of plugins) {
    const shipId = addShipToFleet(state, 'sh-wh-e-frigate')
    const ship = state.fleet[shipId]!
    ship.customName = `${ctx.modules.get(id)!.name}双件验收`
    ship.fitted = { high: [], mid: [], low: [] }
    for (let i = 0; i < 2; i++) assert(installPlug(state, ctx, id, shipId).ok, `验收插件装配失败：${id}`)
  }
  state.shipId = uid
  return ['独立合成档：玄武级混装支援件及十一艘双插件对照舰，备件齐备。',
    '装配页对比第二件有效值；协处理、靶标、隐匿保持全额；空间压缩正负效果同权。']
}
