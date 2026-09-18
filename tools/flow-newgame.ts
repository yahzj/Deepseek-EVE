/**
 * **新档流程跑通**（2026-09-17 教程重做批 · 阶段④入库）——`npm run flow:newgame`。
 *
 * 干什么：用**真实数据 + 真实引擎**从"零资金、母港未知"的新档一路走：
 * 序章演出结束 → 扫描母港 → 采矿 → 精炼 → 生产 → 市场挂单 → 悬赏取胜 → 港内维修 → 学技能 → 指派 AI 副船；
 * 沿途核对「第一次」任务判定、页面/页签解锁表（`FIRST_UNLOCKS`）、次数链记账与领奖（幂等）。
 *
 * 为什么留成正式工具：教程重做把"线性七步"换成了"任务中心自由选择"，**新玩家的开局路径不再由脚本保证**——
 * 这条流程就是它的守门人（动过采集/精炼/生产/市场/悬赏/维修/技能/AI 任一处，跑一遍即可）。
 * 退出码：0 = 全通；1 = 有未通过项（日志逐条 ❌ 点名）。
 *
 * ⚠ 这是**读数型**验证（跑状态与数值，不替代船长观感审查）。
 *
 * **版本自检**：游戏版本 v0.1.0 · 存档结构 **v26** · 最后核对 2026-09-17 · 最后跑过 2026-09-17
 */
import { buildSimContext } from '@whale/data'
import { createInitialState, HOME_GALAXY_ID } from '../packages/core/src/state'
import type { GameState } from '../packages/core/src/state'
import type { SimContext } from '../packages/core/src/types'
import { advanceGame } from '../packages/core/src/engine'
import { beginAfterAwaken } from '../packages/core/src/onboarding'
import { startScan, isExplored } from '../packages/core/src/explore'
import { startMining, stopMining } from '../packages/core/src/mining'
import { changeShip, repairShip } from '../packages/core/src/shipyard'
import { unloadCargoToWarehouse } from '../packages/core/src/inventory'
import { sellWareItem, startRefineRun } from '../packages/core/src/industry'
import { startManufacturing } from '../packages/core/src/manufacturing'
import { learnBlueprint, placeSellOrder } from '../packages/core/src/market'
import { startExpedition } from '../packages/core/src/expedition'
import { enqueueSkill } from '../packages/core/src/engine'
import { buyBasicAiCore, assignAiMining } from '../packages/core/src/ai'
import {
  FIRST_TASKS,
  advanceFirstChains,
  chainProgressOf,
  claimChainReward,
  firstStatOf,
  unlocked,
  visibleFirstTasks,
} from '../packages/core/src/firstTasks'

const ctx: SimContext = buildSimContext()
const HOME = HOME_GALAXY_ID
const BELT = 'belt-fortune'

let failures = 0
function ok(label: string, cond: boolean, extra = ''): void {
  if (!cond) failures += 1
  console.log(`${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`)
}

/** 推进游戏时间直到条件成立（或超预算）；步长 30 秒 */
function until(state: GameState, cond: () => boolean, budgetMs = 30 * 60_000, label = ''): boolean {
  let spent = 0
  while (!cond() && spent < budgetMs) {
    advanceGame(state, 30_000, ctx)
    spent += 30_000
  }
  if (!cond() && label) console.log(`   ⏱ ${label}：预算 ${Math.round(budgetMs / 1000)}s 用尽仍未达成`)
  return cond()
}

const step = (n: string): void => console.log(`\n──── ${n} ────`)

step('① 新档（序章）：母港未知、页面按表锁定')
const s = createInitialState({ nowWallMs: 0, seed: 20260917, prologue: true })
ok('开局一处理都没点亮', s.exploredGalaxies.length === 0, `explored=${JSON.stringify(s.exploredGalaxies)}`)
ok('工业页锁着（← 第一次采集原矿）', !unlocked(s, 'industry'))
ok('市场页锁着（← 第一次生产）', !unlocked(s, 'market'))
ok('星图·矿带锁着（← 第一次扫描）', !unlocked(s, 'mapMine'))
ok('舰船/技能/任务中心/通讯不设前置', unlocked(s, 'ship') && unlocked(s, 'skills') && unlocked(s, 'task') && unlocked(s, 'comms'))
const vis0 = visibleFirstTasks(s).map((d) => d.title)
ok('任务中心只显示无前置的那几条', vis0.includes('第一次扫描') && !vis0.includes('第一次采集原矿'), vis0.join(' / '))
ok('开局零资金', s.wallet.isk === 0, `isk=${s.wallet.isk}`)
ok('驾驶 = 鲣鱼（无矿枪、无炮台）', s.shipId === 'sh-falconet')

step('② 序章演出结束 → 开场信 + 贯穿任务')
ok('演出结束调用成功', beginAfterAwaken(s).ok)
for (let i = 0; i < 3; i++) advanceGame(s, 1000, ctx)
ok('序章 = 已完成', s.onboarding.step === 99)
ok('开场信送达', s.commsDelivered?.['msg-briefing'] !== undefined)
ok('「寻找人类」已发布', s.importantTasks['find-humans'] !== undefined)

step('③ 第一次扫描（星图）')
ok('扫描母港被接受', startScan(s, HOME, ctx).ok)
ok('扫描完成、母港点亮', until(s, () => isExplored(s, HOME), 10 * 60_000, '扫描'), '')
ok('「第一次扫描」判定完成', s.importantTasks['first-scan']?.done === true)
advanceGame(s, 1000, ctx)
ok('情报信「档案补全 · 星图扫描」送达', s.commsDelivered?.['first-scan'] !== undefined)
ok('星图四项一起解锁', unlocked(s, 'mapMine') && unlocked(s, 'mapBounty') && unlocked(s, 'mapSalvage') && unlocked(s, 'mapHaul'))
ok('工业页仍锁（前置是采集原矿）', !unlocked(s, 'industry'))

step('④ 第一次采集原矿（矿带）')
// 照玩家路径：先把驾驶换成采矿艇沙猫（鲣鱼是护卫舰，货舱小、矿枪不对口）
const swap = changeShip(s, 'sandcat', ctx)
ok('切换驾驶为沙猫级采矿艇', swap.ok, swap.ok ? '' : swap.error)
ok('派出采矿被接受', startMining(s, BELT, ctx).ok)
ok('采到原矿', until(s, () => firstStatOf(s, 'mineUnits') > 0, 20 * 60_000, '采矿'), `mineUnits=${firstStatOf(s, 'mineUnits')}`)
ok('「第一次采集原矿」判定完成', s.importantTasks['first-mine']?.done === true)
ok('奖励：动能弹药生产线蓝图 ×1', (s.blueprintStock['bp-ammo-kinetic'] ?? 0) === 1)
ok('工业页解锁', unlocked(s, 'industry'))
// 采一批（精炼按批起炉：**每批 100 单位**，沙猫一趟约 70 ⇒ 新玩家要跑两趟；这就是真实节奏）
const holdOf = (): number => {
  for (const k of Object.keys(s.fleet)) {
    const c = s.fleet[k]!.cargo['ore-veldspar'] ?? 0
    if (c > 0) return c
  }
  return 0
}
for (let tripNo = 1; tripNo <= 3 && (s.warehouse.items['ore-veldspar'] ?? 0) < 120; tripNo++) {
  if (!s.mining.active) ok(`第 ${tripNo} 趟出航`, startMining(s, BELT, ctx).ok)
  until(s, () => holdOf() >= 60, 40 * 60_000)
  if (s.mining.active) stopMining(s, ctx)
  const moved = unloadCargoToWarehouse(s)
  console.log(`   第 ${tripNo} 趟：卸入 ${moved} 单位（仓库累计 ${s.warehouse.items['ore-veldspar'] ?? 0}）`)
}
ok('收工返港', !s.mining.active)
const oreId = 'ore-veldspar'
const oreHave = s.warehouse.items[oreId] ?? 0
ok('仓库有原矿可炼（≥ 一批 100）', oreHave >= 100, `${oreId} ×${oreHave}`)

step('⑤ 第一次操作精炼炉（工业）')
const refine = startRefineRun(s, oreId, 'pilot', ctx)
ok('起炉被接受', refine.ok, refine.ok ? '' : refine.error)
ok('精炼出料', until(s, () => firstStatOf(s, 'refineBatches') > 0, 30 * 60_000, '精炼'), `batches=${firstStatOf(s, 'refineBatches')}`)
ok('「第一次操作精炼炉」判定完成', s.importantTasks['first-refine']?.done === true)

step('⑥ 第一次生产（组装机）')
const bpLearn = learnBlueprint(s, ctx, 'bp-ammo-kinetic')
ok('学会蓝图（库存那张）', bpLearn.ok, bpLearn.ok ? '' : bpLearn.error)
const mats = Object.keys(s.warehouse.items).filter((id) => id.startsWith('min-'))
console.log(`   材料：${mats.map((m) => `${m}×${s.warehouse.items[m]}`).join(' ') || '（无）'}`)
const prod = startManufacturing(s, 'bp-ammo-kinetic', 'pilot', ctx)
ok('起制造线被接受', prod.ok, prod.ok ? '' : prod.error)
ok('产出成品', until(s, () => firstStatOf(s, 'produceUnits') > 0, 30 * 60_000, '生产'), `units=${firstStatOf(s, 'produceUnits')}`)
ok('「第一次生产」判定完成', s.importantTasks['first-produce']?.done === true)
ok('市场页解锁', unlocked(s, 'market'))

step('⑦ 第一次挂单销售（市场）')
// 找一条"我手上有的、可上市"的商品行（市场行 key = goodKey）
const good = [...ctx.marketGoods.values()].find(
  (g) => g.playerSellable !== false && (s.warehouse.items[g.refId] ?? 0) > 0,
)
if (good) {
  const qty = Math.min(1, s.warehouse.items[good.refId] ?? 0)
  const order = placeSellOrder(s, ctx, good.id, Math.max(1, Math.round(good.basePrice ?? 1)), qty)
  ok('挂出卖单', order !== null, order ? `${good.id} ×${qty}` : '（挂单被拒）')
  advanceGame(s, 1000, ctx)
  ok('「第一次挂单销售」判定完成', s.importantTasks['first-order']?.done === true)
} else {
  ok('找到可上市的物品', false, '仓库里没有可上市的物品')
}
// 卖一批原矿换现金（物品页「市价卖出」路径）——后面买核心、训练都要钱
const sellRes = sellWareItem(s, oreId, ctx)
ok('市价卖出原矿换现金', sellRes.ok, sellRes.ok ? `+${sellRes.gainedIsk.toLocaleString('zh-CN')} 信用点` : sellRes.error)
console.log(`   钱包：${s.wallet.isk.toLocaleString('zh-CN')} 信用点`)

step('⑧ 第一次完成悬赏（演习场驱逐令 · 含照会战加成）')
const exp = startExpedition(s, 'ano-training', ctx)
ok('接取演习场驱逐令', exp.ok, exp.ok ? '' : exp.error)
ok('战斗结束并取胜', until(s, () => firstStatOf(s, 'bountyWins') > 0 || !s.expedition.active, 20 * 60_000, '战斗'))
ok('「第一次完成悬赏」判定完成', s.importantTasks['first-bounty']?.done === true, `wins=${firstStatOf(s, 'bountyWins')}`)
console.log(`   钱包：${s.wallet.isk.toLocaleString('zh-CN')} 信用点（含悬赏报酬）`)

step('⑨ 港内维修（第一次维修舰船）')
const dock = changeShip(s, 'sh-falconet', ctx)
ok('换回鲣鱼驾驶（维修对象是它）', dock.ok, dock.ok ? '' : dock.error)
const repair = repairShip(s, 'sh-falconet', ctx)
ok('港内维修鲣鱼', repair.ok, repair.ok ? '' : repair.error)
advanceGame(s, 1000, ctx) // 判定在引擎每拍（advanceFirstTasks）
ok('「第一次维修舰船」判定完成', s.importantTasks['first-repair']?.done === true, `repairs=${firstStatOf(s, 'repairs')}`)

step('⑩ 领链奖金 + 打两场悬赏攒点现金（训练与维修要花钱）')
advanceFirstChains(s)
let claimed = 0
for (const def of FIRST_TASKS) {
  if (!def.chain) continue
  claimed += claimChainReward(s, def.chain.id)
}
console.log(`   先把已达成档位的奖金领掉：+${claimed.toLocaleString('zh-CN')} 信用点 → 钱包 ${s.wallet.isk.toLocaleString('zh-CN')}`)
let runs = 1 // ⑧ 已打过一场
while (runs < 3) {
  let e = startExpedition(s, 'ano-training', ctx)
  // 悬赏有冷却（返航段 + 冷却）：等冷却走完再接下一条，最多等 10 分钟游戏时间
  let waitMs = 0
  while (!e.ok && waitMs < 10 * 60_000) {
    advanceGame(s, 30_000, ctx)
    waitMs += 30_000
    e = startExpedition(s, 'ano-training', ctx)
  }
  if (!e.ok) {
    console.log(`   第 ${runs + 1} 场接单失败：${e.error}`)
    break
  }
  until(s, () => !s.expedition.active, 20 * 60_000, '战斗')
  runs += 1
}
console.log(`   共 ${runs} 场演习场驱逐令 · 钱包 ${s.wallet.isk.toLocaleString('zh-CN')} 信用点 · 悬赏计数 ${firstStatOf(s, 'bountyWins')}`)

step('⑪ 第一次学习技能（领基础 AI 核心）＋ 第一次指派 AI 副船')
// 核心不再靠攒钱买：船长 2026-09-17「AI 核心放在'第一次技能'里给」——练成 AI 核心操作学 Lv1 即领一枚
const train = enqueueSkill(s, 'ai-expert', 1, ctx.skills)
ok('开始训练 AI 核心操作学', train.ok, train.ok ? '' : train.error)
ok('练到 Lv1', until(s, () => (s.skills.trained['ai-expert'] ?? 0) >= 1, 60 * 60_000, '训练'))
advanceGame(s, 1000, ctx) // 奖励在引擎每拍（advanceFirstTasks → grantFirstReward）
ok('「第一次学习技能」判定完成', s.importantTasks['first-skill']?.done === true)
ok('奖励：基础 AI 核心 ×1（免去市场价 ~25k）', (s.aiCores.basic ?? 0) === 1, `aiCores.basic=${s.aiCores.basic ?? 0}`)
ok('「第一次指派 AI 副船」此时才出现（前置已满）', visibleFirstTasks(s).some((d) => d.id === 'first-ai'))
const assign = assignAiMining(s, 'sandcat', 'basic', BELT, ctx)
ok('指派沙猫去采矿', assign.ok, assign.ok ? '' : assign.error)
advanceGame(s, 1000, ctx) // 判定在引擎每拍（advanceFirstTasks）
ok('「第一次指派 AI 副船」判定完成', s.importantTasks['first-ai']?.done === true, `aiAssigns=${firstStatOf(s, 'aiAssigns')}`)
// 买一枚是**可选**的（第二艘副船才需要）：只核一下价格读数，不作断言
const coreBuy = buyBasicAiCore(s, ctx)
console.log(`   市场上再买一枚基础 AI 核心：${coreBuy.ok ? '成功' : `未买（${coreBuy.error}）`}`)

step('⑫ 次数链：记账与领奖')
advanceFirstChains(s)
for (const def of FIRST_TASKS) {
  if (!def.chain) continue
  const prog = chainProgressOf(s, def.chain)
  const done = s.importantTasks[def.id]?.done === true
  const paid = s.firstStats?.[`paid-${def.chain.id}`] ?? 0
  const claimable = prog.level > paid
  if (!done && !claimable) continue
  const isk = claimable ? claimChainReward(s, def.chain.id) : 0
  console.log(
    `   · ${def.chain.name}：${prog.level}/${prog.total} 档（当前 ${prog.count}）${claimable ? ` → 领奖 +${isk.toLocaleString('zh-CN')}` : ''}`,
  )
}
ok('领奖后不再重复发（幂等）', claimChainReward(s, 'explorer') === 0 && claimChainReward(s, 'digger') === 0)

step('⑪ 收尾读数')
console.log(`   已完成「第一次」：${FIRST_TASKS.filter((d) => s.importantTasks[d.id]?.done === true).map((d) => d.title).join('、')}`)
console.log(`   未完成：${FIRST_TASKS.filter((d) => s.importantTasks[d.id]?.done !== true).map((d) => d.title).join('、') || '（无）'}`)
console.log(`   钱包 ${s.wallet.isk.toLocaleString('zh-CN')} · 游戏内时间 ${(s.gameMs / 3_600_000).toFixed(1)} 小时 · 日志 ${s.logs.length} 条`)
console.log(`\n${failures === 0 ? '✅ 流程全部通过' : `❌ 有 ${failures} 项未通过`}`)
process.exit(failures === 0 ? 0 : 1)
