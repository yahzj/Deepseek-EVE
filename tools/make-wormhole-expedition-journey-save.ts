/** 新虫洞十层整备合成档：从合法配置的before生成，不读取个人档。
 * 用法：npx tsx tools/make-wormhole-expedition-journey-save.ts；游戏v0.1.0/档v31，2026-10-06。
 * 输出一份未入场档；技能/科技与初始库存是公开挑战配置，不声称普通玩家水平。
 */
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { makeExpeditionFixture, expeditionContext as ctx } from './wormhole-expedition-fixture'
import { serializeSaveFile, loadSaveFile } from '../packages/core/src/save'
import { noteStandingEarned, DSI_FACTION_ID } from '../packages/core/src/standing'
import { repairStandingFromBountyProgress } from '../packages/core/src/expedition'
import { wormholeScanUnlocked } from '../packages/core/src/wormholeScan'
import { FIRST_TASKS } from '../packages/core/src/firstTasks'
import { wormholeSavePreparationTemplate } from '../packages/core/src/wormholePreparationTemplates'

const fixture = makeExpeditionFixture('A', 19, 'drones')
const state = fixture.before
state.onboarding.step = -1
state.modeChosen = true
state.character.name = '虫洞十层验收'
for (const card of ctx.anomalies.values()) if (!card.hidden && card.standingGain > 0 && !state.completedBounties.includes(card.id)) {
  state.completedBounties.push(card.id)
  noteStandingEarned(state, DSI_FACTION_ID, card.standingGain)
}
repairStandingFromBountyProgress(state, ctx)
if (!wormholeScanUnlocked(state)) throw new Error('合成声望前提不成立')
for (const task of FIRST_TASKS) state.importantTasks[task.id] = { done: true }
state.commsRead = Object.fromEntries([...ctx.commsMessages.keys()].map(id => [id, true]))
state.commsDelivered = Object.fromEntries([...ctx.commsMessages.keys()].map(id => [id, 1]))
state.commsPopups = []
for (const [name, targets] of [
  ['完整补给', fixture.manifest],
  ['不带备用机', { ...fixture.manifest, 'drone-assault': 0 }],
] as const) {
  if (!wormholeSavePreparationTemplate(state, name, targets).ok) throw new Error('合成多模板保存失败')
}
const text = serializeSaveFile(state, Date.now())
const once = loadSaveFile(text).state
const twice = loadSaveFile(serializeSaveFile(once, Date.now())).state
if (JSON.stringify(once.fleet) !== JSON.stringify(twice.fleet)) throw new Error('合成配置往返变化')
if (JSON.stringify(twice.wormholePreparationTemplates) !== JSON.stringify(state.wormholePreparationTemplates)) throw new Error('合成模板往返变化')
writeFileSync(resolve('docs/test-saves/test-save-whexpedition-journey-20261006.json'), text, 'utf8')
console.log(JSON.stringify({ beforeEntry: state.wormhole.run === null, fleet: fixture.fleet, manifest: fixture.manifest, realFittingValidated: true, roundtrip: true }))
