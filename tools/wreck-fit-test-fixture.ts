/** 新档门槛：真实丢船记录、参考方案与重复插件；不读个人档。 */
import { addShipToFleet, loadSaveFile, loseShip, type GameState } from '@whale/core'
import { buildSimContext } from '@whale/data'
import { blackMarketTestSave } from './black-market-test-fixture'

export function injectWreckFitTestState(state: GameState): string[] {
  const now = state.savedAtWallMs, ctx = buildSimContext()
  const fresh = loadSaveFile(blackMarketTestSave(now)).state
  fresh.character.name = '沉船装配验收'
  fresh.shipId = addShipToFleet(fresh, 'sh-hammerhead')
  fresh.fleet[fresh.shipId]!.plugs = ['plug-cpu-core']
  const lost = addShipToFleet(fresh, 'sh-hammerhead')
  fresh.fleet[lost]!.fitted = { high: ['mod-turret-kin-1', null, 'mod-turret-kin-1'], mid: ['mod-shield-kin-1'], low: [] }
  fresh.fleet[lost]!.plugs = ['plug-cpu-core', 'plug-cpu-core']
  fresh.fleet[lost]!.droneLoad = { 'drone-scout': 2 }
  loseShip(fresh, lost, ctx, '验收用沉船', undefined, { cause: 'wormhole-sunk', wormholeDepth: 3 })
  fresh.moduleBay['plug-cpu-core'] = 3
  fresh.fitPresets = { 'sh-hammerhead': [{ name: 'Repeat', fitted: { high: ['mod-turret-kin-2'], mid: [], low: [] } }] }
  Object.assign(state, fresh)
  return ['通讯→沉船记录：逐槽装备、重复插件、无人机；悬停/点击详情，保存为装配方案。',
    '用名称Repeat保存需先确认覆盖，取消不改变旧方案；主控锤头鲨有一件协处理插件和三件备用，可验证重复安装。',
    '全新合成档，原沉船已由真实丢船入口删除；不读取个人进度。']
}
