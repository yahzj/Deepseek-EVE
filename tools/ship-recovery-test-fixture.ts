import { addShipToFleet, createInitialState, loadSaveFile, loseShip, serializeSaveFile, type GameState } from '@whale/core'
import { blackMarketTestSave } from './black-market-test-fixture'
import { buildSimContext } from '@whale/data'

/** 合成门槛：真实损毁的一具残骸、同舰型战损演示与已训练工程技能，不读取个人档。 */
export function injectShipRecoveryTestState(state: GameState): string[] {
  const now = state.savedAtWallMs, ctx = buildSimContext()
  const fresh = loadSaveFile(blackMarketTestSave(now)).state
  fresh.character.name = '舰船回收验收'
  fresh.shipId = addShipToFleet(fresh, 'sh-hammerhead')
  fresh.fleet[fresh.shipId]!.customName = '打捞演示舰'
  fresh.fleet[fresh.shipId]!.fitted = { high: ['mod-salvager-3'], mid: [], low: [] }
  const demo = addShipToFleet(fresh, 'sh-hammerhead')
  fresh.fleet[demo]!.customName = '战损演示舰'
  fresh.fleet[demo]!.durability = 0.2
  fresh.fleet[demo]!.armorPct = 0.2
  fresh.fleet[demo]!.damagePlugs = ['shield', 'cargo', 'range']
  fresh.fleet[demo]!.plugs = ['plug-cpu-core', 'plug-cpu-core']
  const lost = addShipToFleet(fresh, 'sh-hammerhead')
  fresh.fleet[lost]!.customName = '回收目标'
  fresh.fleet[lost]!.fitted = { high: ['mod-turret-kin-1', null, 'mod-turret-kin-1'], mid: ['mod-shield-kin-1'], low: [] }
  fresh.fleet[lost]!.damagePlugs = ['speed']
  fresh.fleet[lost]!.plugs = ['plug-cpu-core', 'plug-cpu-core']
  fresh.fleet[lost]!.droneLoad = { 'drone-scout': 2 }
  for (const id of ['hull-salvage-engineering', 'advanced-hull-salvage-engineering', 'wreck-equipment-preservation']) fresh.skills.trained[id] = 5
  fresh.rng = createInitialState({ nowWallMs: now, seed: 13 }).rng
  loseShip(fresh, lost, ctx, '验收用损毁', 'galaxy-hub')
  Object.assign(state, loadSaveFile(serializeSaveFile(fresh, now)).state)
  return ['星图→残骸打捞→母港：回收目标残骸，当前整船回收率70%、装备保全率100%，第一次打捞按真实固定种子回收。',
    '舰船→战损演示舰、装配与通讯沉船记录：点击战损插件读取完整效果；普通维修不清除，普通插件槽不受影响。',
    '工程→舰船回收：三个技能均满级；可在合成档中重新调整等级验证概率。全新合成档，不读取个人进度。']
}
