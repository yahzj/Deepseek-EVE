/**
 * 虫洞第一批隔离测试档：仅从初始状态生成，不读取个人档。
 * 用法：npm run save:whexpedition；输出准备/地点留货/超载三档并校验双轮往返。
 * 游戏版本v0.1.0 · 存档结构v31 · 最后核对2026-10-04 · 最后跑过2026-10-04。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSimContext } from '@whale/data'
import {
  addShipToFleet, createInitialState, loadSaveFile, serializeSaveFile, FIRST_TASKS,
  wormholePreparationPlan, wormholeEnterPrepared, wormholeLeaveSupply,
  wormholeHoldStow, wormholeGroundBoard, wormholeExtractionPlan,
  wormholeConfirmExtraction, wormholeLeave, wormholeResume,
} from '@whale/core'
import { wormholeStowOrTemp } from '../packages/core/src/wormholeSalvage'

const ctx = buildSimContext()
const OUT = join(process.cwd(), 'docs', 'test-saves')
const BASE = 'ammo-kinetic-l'
const ready = createInitialState({ nowWallMs: 1_791_065_600_000, seed: 7, name: '虫洞整备验收' })
ready.wallet.isk = 100_000_000
ready.onboarding.step = -1
ready.modeChosen = true
ready.standingsEarned = { dsi: 60 }
ready.standings = { dsi: 60 }
ready.standingClawbackDone = true
for (const task of FIRST_TASKS) ready.importantTasks[task.id] = { done: true }
ready.commsDelivered ??= {}
ready.commsRead ??= {}
for (const [id] of ctx.commsMessages) {
  ready.commsDelivered[id] = 1
  ready.commsRead[id] = true
}
ready.commsPopups = []
const a = addShipToFleet(ready, 'sh-thresher')
const b = addShipToFleet(ready, 'sh-thresher')
ready.shipId = a
for (const uid of [a, b]) ready.fleet[uid]!.fitted = { high: ['mod-turret-kin-1', 'mod-salvager-1', 'mod-miner-1'], mid: [], low: [] }
ready.fleet[b]!.ammoPref = { kinetic: 'ammo-kinetic-2' }
ready.warehouse.items = { [BASE]: 4000, 'ammo-kinetic-2': 4000, 'repairkit-mil': 4000, 'repairkit-dc': 10, 'drone-scout': 20 }
ready.wormholeStock = [{ id: 'wh-expedition-test', seed: 7, depth: 1, family: 'A', archetype: 'balanced', foundAtGameMs: 0, expeditionRules: 2 }]

const targets = { [BASE]: 500, 'ammo-kinetic-2': 500, 'repairkit-mil': 1000 }
const plan = wormholePreparationPlan(ready, ctx, [a, b], { targets, unload: [] })
if (!plan.ok) throw new Error(`准备夹具非法：${JSON.stringify(plan)}`)
const underway = structuredClone(ready)
if (!wormholeEnterPrepared(underway, ctx, [a, b], 7, plan, 'wh-expedition-test').ok) throw new Error('准备夹具无法入场')
const run = underway.wormhole.run!
for (const cell of run.grid!.cells) { cell.place = 'empty'; delete cell.foe }
run.grid!.scanned = run.grid!.cells.map((cell) => cell.key)
run.grid!.visited = [ `${run.grid!.pos.q},${run.grid!.pos.r}` ]
if (!wormholeHoldStow(underway, ctx, 'box-bp-shallow').ok) throw new Error('无法设置随行货柜')
if (!wormholeLeaveSupply(underway, ctx, BASE, 100).ok) throw new Error('无法设置留地补给')
if (!wormholeStowOrTemp(underway, ctx, 'ore-voidmother', 200).ok) throw new Error('无法设置随行矿物')
wormholeLeave(underway)

const overload = structuredClone(ready)
const overloadPlan = wormholePreparationPlan(overload, ctx, [a, b], { targets: { 'repairkit-mil': 3000 }, unload: [] })
if (!wormholeEnterPrepared(overload, ctx, [a, b], 7, overloadPlan, 'wh-expedition-test').ok) throw new Error('无法设置超载夹具')
const overloadRun = overload.wormhole.run!
for (const cell of overloadRun.grid!.cells) { cell.place = 'empty'; delete cell.foe }
// 明确设置容量缩小后的局面，不把它伪称为真实战斗胜率或沉船测试。
overloadRun.fleet = [a]
wormholeLeave(overload)

mkdirSync(OUT, { recursive: true })
for (const [name, state] of [['ready', ready], ['ground', underway], ['overload', overload]] as const) {
  const text = serializeSaveFile(state, ready.savedAtWallMs)
  const first = loadSaveFile(text).state
  const second = loadSaveFile(serializeSaveFile(first, ready.savedAtWallMs)).state
  if (JSON.stringify(first.wormhole) !== JSON.stringify(second.wormhole)) throw new Error(`${name}虫洞字段往返不一致`)
  if (name === 'ground' && !wormholeGroundBoard(second.wormhole.run!)?.placements.some((p) => p.supply && p.itemId === BASE)) throw new Error('地点补给来源标记丢失')
  if (name === 'overload') {
    wormholeResume(second, ctx)
    const blocked = wormholeExtractionPlan(second, ctx, { leavePieces: [], leaveSupplies: {}, takeGround: [] })
    if (blocked.code !== 'capacity') throw new Error('超载夹具未正确拒绝')
    const fit = wormholeExtractionPlan(second, ctx, { leavePieces: [], leaveSupplies: { 'repairkit-mil': 500 }, takeGround: [] })
    if (!wormholeConfirmExtraction(second, ctx, fit).ok) throw new Error('超载明确取舍不能撤离')
  }
  const target = join(OUT, `test-save-whexpedition-${name}-20261004.json`)
  writeFileSync(target, text, 'utf8')
  console.log(`已生成${name}合成档：${target}`)
}
console.log('双轮往返及超载退出核对通过；未读取或覆写个人档。测试档已具备界面门槛，新趟仍仅在本机调试中开放。')
