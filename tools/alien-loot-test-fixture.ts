/** 异形掉落验收合成档：真实装备、稳定靶舰、专属回收池，不读取个人档。
 * 用法：make-alien-loot-save和alien-loot-desktop-smoke复用。
 * 版本自检：游戏v0.1.0 / 存档v31；2026-10-09核对与运行。
 */
import assert from 'node:assert/strict'
import { addShipToFleet, createInitialState, FIRST_TASKS, fitModule, serializeSaveFile, startFleetBattleFor } from '@whale/core'
import { advanceBattleFor } from '../packages/core/src/combat'
import { buildSimContext } from '@whale/data'

export function alienLootTestSave(now = Date.now()): string {
  const ctx = buildSimContext(), state = createInitialState({ nowWallMs: now, seed: 20261009 })
  state.modeChosen = true
  state.character.name = '异形装备验收'
  state.standingClawbackDone = true
  state.standings.dsi = 100
  state.standingsEarned = { dsi: 100 }
  state.wallet.isk = 1e9
  state.exploredGalaxies = [...ctx.galaxies.keys()]
  for (const task of FIRST_TASKS) state.importantTasks[task.id] = { done: true }
  const uid = addShipToFleet(state, 'sh-wh-e-carrier')
  state.shipId = uid
  state.fleet[uid]!.fitted = { high: [], mid: [], low: [] }
  for (const id of ['mod-alien-acid-launcher', 'mod-alien-acid-launcher', 'mod-prop-1', 'mod-alien-pressure-chamber', 'mod-alien-pressure-chamber']) {
    state.moduleBay[id] = (state.moduleBay[id] ?? 0) + 1
    const result = fitModule(state, id, ctx)
    assert(result.ok, result.error)
  }
  state.warehouse.items['drone-jawclaw'] = 100
  state.warehouse.items['wreck-rare-c-inv'] = 600
  state.blueprintStock['bp-faction-drone-jawclaw'] = 1
  for (const id of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) state.warehouse.items[id] = 100000
  const card = 'ano-training'
  const battle = startFleetBattleFor(state, ctx, [uid], card, 0, 2200)
  assert(battle)
  for (const unit of Object.values(battle.units)) {
    unit.hp = { s: 1e7, a: 1e7, h: 1e7 }
    unit.hpMax = { ...unit.hp }
    delete unit.enteredAtMs
  }
  state.expedition = { ...state.expedition, active: true, phase: 'battle', anomalyId: card, battle, finishAtGameMs: 1e9 }
  for (let i = 0; i < 60 && !Object.values(battle.foeAcidLayers ?? {}).some(rows => rows.length); i++) {
    state.gameMs += 1000
    advanceBattleFor(state, ctx, battle, uid, card)
  }
  assert(Object.values(battle.foeAcidLayers ?? {}).some(rows => rows.length), `合成档未命中酸蚀：${JSON.stringify({ stats: battle.stats, ammo: battle.ammo, ended: battle.ended, distance: battle.distanceM, clock: battle.lastTickGameMs })}`)
  for (const id of ctx.commsMessages.keys()) { state.commsDelivered![id] = 0; state.commsRead![id] = true }
  state.commsPopups = []
  return serializeSaveFile(state, now)
}
