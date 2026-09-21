/**
 * **新档流程跑通**（2026-09-17 教程重做批 · 阶段④入库）——`npm run flow:newgame`。
 *
 * 干什么：用**真实数据 + 真实引擎**从"零资金、母港未知"的新档一路走：
 * 序章演出结束 → 扫描母港 → 采矿 → 精炼 → 打捞 → 打一场悬赏（挣钱）→ 港内维修 →
 * 生产 → 市场挂单 → 造出第一条船 → 学技能 → 指派 AI 副船；
 * 沿途核对「第一次」任务判定与奖励、页面/页签解锁表（`FIRST_UNLOCKS`）、次数链记账与领奖（幂等）。
 *
 * ⚠ **2026-09-20 改口径（船长报障「未显示的第一次任务可以提前完成」）**：队列现在是
 * **显示与判定同一把尺**——`advanceFirstTasks` 每拍**只判"当前那一条"**（`FIRST_TASKS` 里第一条还没完成的）。
 * 于是：
 * ① 本脚本的动作顺序**必须与队列顺序一致**，否则后面的条目拿不到判定与奖励（这正是它要守的门）；
 * ② 实测里"先把活干了、任务等轮到再补判"仍然成立（判据读 `state` 现状 ⇒ 自愈、进度不丢）——
 *    ⑦⑧ 两步专门钉这条：先打赢悬赏（`bountyWins` 已 1），此时队列还在「第一次维修舰船」，
 *    「第一次完成悬赏」**不许**提前判过；修完船轮到它，下一拍自动补齐并发奖励。
 * ③ 队列第 12/13 条「第一次长途运输」「第一次虫洞」本流程不走，收尾读数会点名（并核"已完成 = 队列前 11 条"）。
 *
 * 为什么留成正式工具：教程重做把"线性七步"换成了"任务中心自由选择"，**新玩家的开局路径不再由脚本保证**——
 * 这条流程就是它的守门人（动过采集/精炼/打捞/维修/悬赏/生产/市场/造船/技能/AI 任一处，跑一遍即可）。
 * 退出码：0 = 全通；1 = 有未通过项（日志逐条 ❌ 点名）。
 *
 * ⚠ 这是**读数型**验证（跑状态与数值，不替代船长观感审查）。
 *
 * **版本自检**：游戏版本 v0.1.0 · 存档结构 **v30** · 最后核对 2026-09-20 · 最后跑过 2026-09-20
 */
import { buildSimContext } from '@whale/data'
import { commsPopupQueue } from '../packages/core/src/comms'
import { createInitialState, HOME_GALAXY_ID } from '../packages/core/src/state'
import type { GameState } from '../packages/core/src/state'
import type { SimContext } from '../packages/core/src/types'
import { advanceGame } from '../packages/core/src/engine'
import { beginAfterAwaken } from '../packages/core/src/onboarding'
import { startScan, isExplored } from '../packages/core/src/explore'
import { startMining, stopMining } from '../packages/core/src/mining'
import { changeShip, repairCostIsk, repairShip } from '../packages/core/src/shipyard'
import { unloadCargoToWarehouse } from '../packages/core/src/inventory'
import { sellWareItemQty, startRefineRun } from '../packages/core/src/industry'
import { startSalvageOp, stopSalvageOp } from '../packages/core/src/salvaging'
import { wreckDensityOf } from '../packages/core/src/salvage'
import { fitModule } from '../packages/core/src/equipment'
import { startManufacturing } from '../packages/core/src/manufacturing'
import { learnBlueprint, placeSellOrder } from '../packages/core/src/market'
import { startExpedition } from '../packages/core/src/expedition'
import { enqueueSkill } from '../packages/core/src/engine'
import { assignAiMining, buyBasicAiCore } from '../packages/core/src/ai'
import {
  FIRST_TASKS,
  advanceFirstChains,
  chainProgressOf,
  claimChainReward,
  firstStatOf,
  firstTaskProgress,
  unlocked,
  visibleFirstTasks,
} from '../packages/core/src/firstTasks'

const ctx: SimContext = buildSimContext()
const HOME = HOME_GALAXY_ID
const BELT = 'belt-fortune'
const ORE = 'ore-veldspar'

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

/**
 * **队列当前那条**（`FIRST_TASKS` 里第一条还没完成的）——顺序解锁下"轮到谁"的唯一读法，
 * 与 core 的 `advanceFirstTasks` 同一口径（就是它内部那个 `current`）。
 */
function currentTaskId(state: GameState): string | null {
  return FIRST_TASKS.find((d) => state.importantTasks[d.id]?.done !== true)?.id ?? null
}

/** 断言"队列已轮到这一条"（动作顺序 = 队列顺序，本脚本的每一步都该先过这道） */
function okAtQueue(state: GameState, taskId: string, when: string): void {
  const cur = currentTaskId(state)
  const title = FIRST_TASKS.find((d) => d.id === taskId)?.title ?? taskId
  ok(`${when}：队列轮到「${title}」`, cur === taskId, cur === null ? '13 条已全完成' : `当前 = ${cur}`)
}

/**
 * **分段时间线读数**（游戏内时间）——船长审开局节奏时看的就是它
 * （例：「精炼每批 100 单位、采矿艇一趟约 70 ⇒ 开炉必跑两趟」到底占多久）。
 * 每段 = 距上一个 mark 的**游戏内**分钟数（含等待采矿/返航/训练的时间）。
 */
let lastMarkMs = 0
function mark(label: string, nowMs: number): void {
  const seg = (nowMs - lastMarkMs) / 60_000
  lastMarkMs = nowMs
  console.log(`   ⏱ ${label}：本段 ${seg.toFixed(1)} 分钟 · 累计 ${(nowMs / 60_000).toFixed(1)} 分钟`)
}

const step = (n: string): void => console.log(`\n──── ${n} ────`)

/** 驾驶船货仓里的原矿量（采矿在途时读数用） */
function holdOre(state: GameState): number {
  for (const k of Object.keys(state.fleet)) {
    const c = state.fleet[k]!.cargo[ORE] ?? 0
    if (c > 0) return c
  }
  return 0
}

/** 仓库里的原材料读数串（三钛/类晶体胶矿…） */
function matsLine(state: GameState): string {
  const mats = Object.keys(state.warehouse.items)
    .filter((id) => id.startsWith('min-'))
    .map((id) => `${id}×${state.warehouse.items[id]}`)
  return mats.join(' ') || '（无）'
}

/** 出一趟矿：派出采矿 → 等货仓攒到 60 → 收工 → 卸货；返回本趟卸入量 */
function mineTrip(state: GameState, tripNo: number): number {
  if (!state.mining.active) ok(`第 ${tripNo} 趟出航`, startMining(state, BELT, ctx).ok)
  until(state, () => holdOre(state) >= 60, 40 * 60_000)
  if (state.mining.active) stopMining(state, ctx)
  const moved = unloadCargoToWarehouse(state)
  console.log(`   第 ${tripNo} 趟：卸入 ${moved} 单位（仓库累计 ${state.warehouse.items[ORE] ?? 0}）`)
  return moved
}

/** 起炉炼到没料为止（精炼炉按批 100 运转，料尽自动停炉） */
function refineAll(state: GameState, budgetMs = 60 * 60_000): void {
  if ((state.warehouse.items[ORE] ?? 0) < 100) return
  const r = startRefineRun(state, ORE, 'pilot', ctx)
  if (!r.ok) console.log(`   起炉未接受：${r.error}`)
  until(state, () => (state.warehouse.items[ORE] ?? 0) < 100, budgetMs, '续炼')
}

/** 卖仓库里多余的原矿换现金（预留 keep 单位给后面的精炼批次）；返回到手信用点 */
function sellSpareOre(state: GameState, keep: number): number {
  const spare = Math.max(0, (state.warehouse.items[ORE] ?? 0) - keep)
  if (spare <= 0) return 0
  const res = sellWareItemQty(state, ORE, spare, ctx)
  return res.ok ? res.gainedIsk : 0
}

/** 接一场演习场驱逐令并打完（悬赏有冷却：等冷却走完再试，最多等 10 分钟游戏时间）；返回是否取胜 */
function runBounty(state: GameState): boolean {
  const winsBefore = firstStatOf(state, 'bountyWins')
  let e = startExpedition(state, 'ano-training', ctx)
  let waitMs = 0
  while (!e.ok && waitMs < 10 * 60_000) {
    advanceGame(state, 30_000, ctx)
    waitMs += 30_000
    e = startExpedition(state, 'ano-training', ctx)
  }
  if (!e.ok) {
    console.log(`   接单失败：${e.error}`)
    return false
  }
  until(state, () => firstStatOf(state, 'bountyWins') > winsBefore || !state.expedition.active, 20 * 60_000, '战斗')
  return firstStatOf(state, 'bountyWins') > winsBefore
}

step('① 新档（序章）：母港未知、页面按表锁定')
const s = createInitialState({ nowWallMs: 0, seed: 20260917, prologue: true })
ok('开局一处理都没点亮', s.exploredGalaxies.length === 0, `explored=${JSON.stringify(s.exploredGalaxies)}`)
ok('工业页锁着（← 与「第一次操作精炼炉」一起开，2026-09-20 船长令）', !unlocked(s, 'industry'))
ok('市场页锁着（← 第一次生产）', !unlocked(s, 'market'))
ok('星图·矿带锁着（← 第一次扫描）', !unlocked(s, 'mapMine'))
ok('舰船/技能/任务中心/通讯不设前置', unlocked(s, 'ship') && unlocked(s, 'skills') && unlocked(s, 'task') && unlocked(s, 'comms'))
const vis0 = visibleFirstTasks(s).map((d) => d.title)
// 2026-09-20 顺序解锁（船长转玩家反馈「一次性太多了」）：任务中心**一次只出一条** ⇒ 新档只有「第一次扫描」
ok('任务中心只显示当前那一条（顺序解锁）', vis0.length === 1 && vis0[0] === '第一次扫描', vis0.join(' / '))
ok('开局零资金', s.wallet.isk === 0, `isk=${s.wallet.isk}`)
ok('驾驶 = 鲣鱼（无矿枪、无炮台）', s.shipId === 'sh-falconet')
// 鲣鱼开局带 80% 装甲/结构损伤（教学闭环：第一笔奖金 → 港内维修）；沙猫在机库待命
ok(
  '鲣鱼开局带伤（维修教学的标的）',
  s.fleet['sh-falconet']!.durability === 0.8 && s.fleet['sh-falconet']!.armorPct === 0.8,
  `结构 ${s.fleet['sh-falconet']!.durability * 100}% · 装甲 ${(s.fleet['sh-falconet']!.armorPct ?? 1) * 100}%`,
)

step('② 序章演出结束 → 开场信（贯穿任务「寻找人类」此时**还不发布**）')
ok('演出结束调用成功', beginAfterAwaken(s).ok)
for (let i = 0; i < 3; i++) advanceGame(s, 1000, ctx)
ok('序章 = 已完成', s.onboarding.step === 99)
ok('开场信送达', s.commsDelivered?.['msg-briefing'] !== undefined)
// 开局那一拍同时满足"开场信 + msg-welcome"两条 start 触发 ⇒ 按"同一拍只弹第一封"的口径，
// 弹出来的必须是开场信（先看清单、再读欢迎辞），另一封留在收件箱里。
ok(
  '开局第一封弹窗 = 开场信',
  commsPopupQueue(s)[0] === 'msg-briefing',
  `实际 ${commsPopupQueue(s).slice(0, 3).join(' / ') || '（无）'}`,
)
// **2026-09-20 船长令**：「寻找人类的任务只在完成所有第一次任务后才出现」——序章结束不再是发布时机。
const fp0 = firstTaskProgress(s)
ok(
  '「寻找人类」此时还没发布（13 条「第一次」一条都还没做完）',
  s.importantTasks['find-humans'] === undefined,
  `已完成 ${fp0.done}/${fp0.total} 条`,
)

step('③ 第一次扫描（星图）')
ok('扫描母港被接受', startScan(s, HOME, ctx).ok)
ok('扫描完成、母港点亮', until(s, () => isExplored(s, HOME), 10 * 60_000, '扫描'), '')
ok('「第一次扫描」判定完成', s.importantTasks['first-scan']?.done === true)
advanceGame(s, 1000, ctx)
ok('情报信「档案补全 · 星图扫描」送达', s.commsDelivered?.['first-scan'] !== undefined)
// **2026-09-20 船长令**：采集器 MK1 从「第一次采集原矿」前移到本条（扫描星系就给）
ok('奖励：采集器 MK1 进装备库（前移到本条）', (s.moduleBay['mod-miner-1'] ?? 0) === 1)
ok('星图四项一起解锁', unlocked(s, 'mapMine') && unlocked(s, 'mapBounty') && unlocked(s, 'mapSalvage') && unlocked(s, 'mapHaul'))
ok('工业页仍锁（它跟「第一次操作精炼炉」一起开）', !unlocked(s, 'industry'))
mark('① → ③ 演出结束 + 扫描母港', s.gameMs)

step('④ 第一次采集原矿（矿带）')
// 照玩家路径：先把驾驶换成采矿艇沙猫（鲣鱼是护卫舰、货舱也不对口），并把③的采集器装上
const swap = changeShip(s, 'sandcat', ctx)
ok('切换驾驶为沙猫级采矿艇', swap.ok, swap.ok ? '' : swap.error)
const fitMiner = fitModule(s, 'mod-miner-1', ctx)
ok('装上采集器 MK1（③ 的奖励：拿到就用）', fitMiner.ok, fitMiner.ok ? '' : fitMiner.error)
ok('派出采矿被接受', startMining(s, BELT, ctx).ok)
ok('采到原矿', until(s, () => firstStatOf(s, 'mineUnits') > 0, 20 * 60_000, '采矿'), `mineUnits=${firstStatOf(s, 'mineUnits')}`)
ok('「第一次采集原矿」判定完成', s.importantTasks['first-mine']?.done === true)
// **2026-09-20 船长令**：打捞器 MK1 从「第一次打捞残骸」前移到本条（挖矿任务就给）⇒ 走到打捞时已在手上
ok('奖励：打捞器 MK1 进装备库（前移到本条）', (s.moduleBay['mod-salvager-1'] ?? 0) === 1)
// 同日第二条令：任务完成后额外给 100 橄榄岩（正好凑够第一炉 100 单位）
ok('奖励：橄榄岩 ×100 进了仓库', (s.warehouse.items[ORE] ?? 0) >= 100, `${ORE} ×${s.warehouse.items[ORE] ?? 0}`)
// 工业页跟「第一次操作精炼炉」一起开（2026-09-20 船长令 ＋ 三选②：精炼前移到采矿之后 = 第 3 条）
ok('工业页解锁（与「第一次操作精炼炉」一起开）', unlocked(s, 'industry'))
/**
 * 多采几趟：后面要炼 **3 批**（第 3 条自己 1 批 ＋ 造船料 2 批：200 三钛 / 50 类晶体胶矿），
 * 采一批（精炼每批 100 单位、沙猫一趟约 70）⇒ 目标仓库 ≥ 320。这就是真实的新手节奏。
 */
const ORE_TARGET = 320
for (let tripNo = 1; tripNo <= 6 && (s.warehouse.items[ORE] ?? 0) < ORE_TARGET; tripNo++) {
  mineTrip(s, tripNo)
}
ok('收工返港', !s.mining.active)
okAtQueue(s, 'first-refine', '采矿做完')
mark('④ 采矿数趟 + 卸货（"每批 100、一趟约 70"的实际耗时）', s.gameMs)

step('⑤ 第一次操作精炼炉（工业）')
const oreHave = s.warehouse.items[ORE] ?? 0
ok('仓库有原矿可炼（≥ 一批 100）', oreHave >= 100, `${ORE} ×${oreHave}`)
const refine = startRefineRun(s, ORE, 'pilot', ctx)
ok('起炉被接受', refine.ok, refine.ok ? '' : refine.error)
ok('精炼出料', until(s, () => firstStatOf(s, 'refineBatches') > 0, 30 * 60_000, '精炼'), `batches=${firstStatOf(s, 'refineBatches')}`)
ok('「第一次操作精炼炉」判定完成', s.importantTasks['first-refine']?.done === true)
ok('奖励：动能弹药生产线蓝图 ×1（按船长 2026-09-18 从②移到本条）', (s.blueprintStock['bp-ammo-kinetic'] ?? 0) === 1)
// 让炉子把剩下的矿也炼完（造船要用原材料；料尽自动停炉）
refineAll(s)
ok('精炼炉料尽自动停炉', !s.refineRuns.some((r) => r.active), `原矿余 ${s.warehouse.items[ORE] ?? 0}`)
console.log(`   原材料：${matsLine(s)}`)
okAtQueue(s, 'first-salvage', '精炼收工')
mark('⑤ 精炼（本流程炼到料尽）', s.gameMs)

step('⑥ 第一次打捞残骸（星图 · 母港残骸点）')
const fitSalv = fitModule(s, 'mod-salvager-1', ctx)
ok('装上打捞器 MK1（④ 的奖励）', fitSalv.ok, fitSalv.ok ? '' : fitSalv.error)
const density = wreckDensityOf(s, HOME, ctx)
ok('母港有残骸可捞（基础密度 > 0）', density > 0, `密度 ${density}`)
const salv = startSalvageOp(s, HOME, ctx)
ok('开始打捞被接受', salv.ok, salv.ok ? '' : salv.error)
ok(
  '捞上残骸（打捞次数 ≥ 1）',
  until(s, () => firstStatOf(s, 'salvageRuns') > 0, 30 * 60_000, '打捞'),
  `salvageRuns=${firstStatOf(s, 'salvageRuns')}`,
)
ok('「第一次打捞残骸」判定完成', s.importantTasks['first-salvage']?.done === true)
// 本条自 2026-09-20 起**没有实物奖励**（打捞器已前移到④）——只有情报信
ok('本条无实物奖励（打捞器已前移到④，这里只发情报信）', FIRST_TASKS.find((d) => d.id === 'first-salvage')?.reward === undefined)
ok('收工回港', stopSalvageOp(s, ctx) && !s.salvaging.active)
mark('⑥ 打捞一批', s.gameMs)

step('⑦ 打一场悬赏挣钱（顺序解锁：这一拍「第一次完成悬赏」**还不该**判过）')
okAtQueue(s, 'first-repair', '打捞收工')
const exp = runBounty(s)
ok('战斗结束并取胜', exp, `悬赏胜场=${firstStatOf(s, 'bountyWins')}`)
/**
 * **船长 2026-09-20 报障的那条**：此刻队列还在「第一次维修舰船」，而悬赏的判据（胜场 ≥1）已经满足 ⇒
 * 旧实现会当场把「第一次完成悬赏」判过（发船、发信、进成就），顺序解锁只剩"显示"这一半。
 * 新口径下**只判当前那一条**，它必须还没被碰过。
 */
ok(
  '未轮到的「第一次完成悬赏」没有被提前判过（船长报障的那条）',
  s.importantTasks['first-bounty']?.done !== true,
  `当前队列 = ${currentTaskId(s)}`,
)
ok(
  '也没发奖励（机库没有凭空多出鲣鱼）',
  Object.values(s.fleet).filter((v) => v.defId === 'sh-falconet').length === 1,
  `机库 ${Object.keys(s.fleet).length} 艘`,
)
console.log(`   钱包：${s.wallet.isk.toLocaleString('zh-CN')} 信用点（含悬赏报酬）`)

step('⑧ 第一次维修舰船（港内付费维修；修完轮到悬赏，下一拍补齐）')
const dock = changeShip(s, 'sh-falconet', ctx)
ok('换回鲣鱼驾驶（维修对象是它：开局带 80% 损伤）', dock.ok, dock.ok ? '' : dock.error)
const fal = s.fleet['sh-falconet']!
const cost = repairCostIsk(s, 'sh-falconet', ctx)
console.log(`   维修费 ${cost.toLocaleString('zh-CN')} 信用点 · 钱包 ${s.wallet.isk.toLocaleString('zh-CN')} 信用点`)
const repair = repairShip(s, 'sh-falconet', ctx)
ok('港内维修鲣鱼', repair.ok, repair.ok ? '' : repair.error)
advanceGame(s, 1000, ctx) // 判定在引擎每拍（advanceFirstTasks）
ok('「第一次维修舰船」判定完成', s.importantTasks['first-repair']?.done === true, `repairs=${firstStatOf(s, 'repairs')}`)
ok('奖励：民用修理组件 ×20（船长 2026-09-18）', (s.warehouse.items['repairkit-civ'] ?? 0) >= 20, `现有 ${s.warehouse.items['repairkit-civ'] ?? 0}`)
ok(
  '鲣鱼已修满',
  fal.durability >= 1 && (fal.armorPct ?? 1) >= 1,
  `结构 ${fal.durability * 100}% · 装甲 ${(fal.armorPct ?? 1) * 100}%`,
)
// 队列接着走：⑦ 那一场的胜场早已满足「第一次完成悬赏」⇒ 轮到它的这一拍补判（进度不丢）
advanceGame(s, 1000, ctx)
ok('「第一次完成悬赏」轮到即补判（⑦ 打赢的账没白记）', s.importantTasks['first-bounty']?.done === true, `wins=${firstStatOf(s, 'bountyWins')}`)
ok(
  '奖励：一艘鲣鱼级进机库（船长 2026-09-18）',
  Object.values(s.fleet).filter((v) => v.defId === 'sh-falconet').length === 2,
  `机库 ${Object.keys(s.fleet).length} 艘`,
)
mark('⑦⑧ 悬赏一场 + 港内维修', s.gameMs)

step('⑨ 第一次生产（组装机）')
okAtQueue(s, 'first-produce', '维修与悬赏都判过')
const bpLearn = learnBlueprint(s, ctx, 'bp-ammo-kinetic')
ok('学会蓝图（库存那张）', bpLearn.ok, bpLearn.ok ? '' : bpLearn.error)
console.log(`   材料：${matsLine(s)}`)
const prod = startManufacturing(s, 'bp-ammo-kinetic', 'pilot', ctx)
ok('起制造线被接受', prod.ok, prod.ok ? '' : prod.error)
ok('产出成品', until(s, () => firstStatOf(s, 'produceUnits') > 0, 30 * 60_000, '生产'), `units=${firstStatOf(s, 'produceUnits')}`)
ok('「第一次生产」判定完成', s.importantTasks['first-produce']?.done === true)
ok('奖励：沙猫级舰船蓝图 ×1（2026-09-18 新建，不进市场）', (s.blueprintStock['sbp-sandcat'] ?? 0) === 1)
ok('市场页解锁', unlocked(s, 'market'))
// 等这条线跑完：造船要用同一台组装机
ok(
  '生产线跑完（造船工位空出来）',
  until(s, () => !s.manufacturingRuns.some((r) => r.active), 30 * 60_000, '生产线'),
)
mark('⑨ 生产一批', s.gameMs)

step('⑩ 第一次挂单销售（市场）')
// 找一条"我手上有的、可上市"的商品行（市场行 key = goodKey）
const good = [...ctx.marketGoods.values()].find(
  (g) => g.playerSellable !== false && (s.warehouse.items[g.refId] ?? 0) > 0,
)
if (good) {
  const qty = Math.min(1, s.warehouse.items[good.refId] ?? 0)
  /**
   * ⚠ **挂单用的是 `good.key`，不是 `good.id`**（`MarketGoodDef` 只有 `key`/`refId`，没有 `id`）——
   * 2026-09-20 外部审计报告点出这里写成 `good.id` ⇒ 传进去的是 `undefined`，
   * 于是挂出一张 goodKey = `"undefined"` 的幽灵单、`escrowItems["undefined"]` 被加 1（读数全是假的）。
   * 之所以没被 typecheck 拦住：**tools/ 不在 `npm run typecheck` 覆盖面内**（见工作文档 §根因）。
   */
  const order = placeSellOrder(s, ctx, good.key, Math.max(1, Math.round(good.basePrice ?? 1)), qty)
  ok('挂出卖单', order !== null, order ? `${good.key} ×${qty}` : '（挂单被拒）')
  advanceGame(s, 1000, ctx)
  ok('「第一次挂单销售」判定完成', s.importantTasks['first-order']?.done === true)
} else {
  ok('找到可上市的物品', false, '仓库里没有可上市的物品')
}
// 卖一批多余原矿换现金（物品页「市价卖出」路径）——造船/后面买核心都要钱（预留 100 单位给补料那批）
const spareOre = Math.max(0, (s.warehouse.items[ORE] ?? 0) - 100)
const gained = sellSpareOre(s, 100)
console.log(
  `   市价卖出多余原矿 ${spareOre} 单位：+${gained.toLocaleString('zh-CN')} 信用点 → 钱包 ${s.wallet.isk.toLocaleString('zh-CN')}`,
)

step('⑪ 第一条船（造船：舰船蓝图 ＋ 材料 ＋ 机库工位）')
okAtQueue(s, 'first-ship', '挂单判过')
const sbpLearn = learnBlueprint(s, ctx, 'sbp-sandcat')
ok('学会沙猫级舰船蓝图（⑨ 的奖励）', sbpLearn.ok, sbpLearn.ok ? '' : sbpLearn.error)
// 备料（200 三钛 / 50 类晶体胶矿）：不够就"再跑矿 → 再炼"，最多补 3 轮
const needMats = (): boolean => (s.warehouse.items['min-tritanium'] ?? 0) >= 200 && (s.warehouse.items['min-pyerite'] ?? 0) >= 50
for (let extra = 1; extra <= 4 && !needMats(); extra++) {
  console.log(`   备料不足（${matsLine(s)}）⇒ 补第 ${extra} 轮矿料`)
  ok('换回沙猫驾驶去补矿', changeShip(s, 'sandcat', ctx).ok)
  mineTrip(s, extra)
  refineAll(s)
  ok('补料后换回鲣鱼', changeShip(s, 'sh-falconet', ctx).ok)
}
ok('材料备齐（200 三钛 / 50 类晶体胶矿）', needMats(), matsLine(s))
const build = startManufacturing(s, 'sbp-sandcat', 'pilot', ctx)
ok('起造船线被接受', build.ok, build.ok ? '' : build.error)
ok('造出第一条船（交付）', until(s, () => firstStatOf(s, 'ships') > 0, 40 * 60_000, '造船'), `ships=${firstStatOf(s, 'ships')}`)
ok('「第一条船」判定完成', s.importantTasks['first-ship']?.done === true)
ok('奖励：民用船体维修装置 ×1（船长 2026-09-18）', (s.moduleBay['mod-hullrep-civ'] ?? 0) === 1)
mark('⑪ 造船（含补料）', s.gameMs)

step('⑫ 第一次学习技能（领基础 AI 核心）')
okAtQueue(s, 'first-skill', '造船判过')
// 先把已达成档位的链奖金领掉（市场/维修/后面买核心都要钱）
advanceFirstChains(s)
let claimed = 0
for (const def of FIRST_TASKS) {
  if (!def.chain) continue
  claimed += claimChainReward(s, def.chain.id)
}
console.log(`   先把已达成档位的奖金领掉：+${claimed.toLocaleString('zh-CN')} 信用点 → 钱包 ${s.wallet.isk.toLocaleString('zh-CN')}`)
// 核心不再靠攒钱买：船长 2026-09-17「AI 核心放在'第一次技能'里给」——练成 AI 核心操作学 Lv1 即领一枚
const train = enqueueSkill(s, 'ai-expert', 1, ctx.skills)
ok('开始训练 AI 核心操作学', train.ok, train.ok ? '' : train.error)
ok('练到 Lv1', until(s, () => (s.skills.trained['ai-expert'] ?? 0) >= 1, 60 * 60_000, '训练'))
advanceGame(s, 1000, ctx) // 奖励在引擎每拍（advanceFirstTasks → grantFirstReward）
ok('「第一次学习技能」判定完成', s.importantTasks['first-skill']?.done === true)
ok('奖励：基础 AI 核心 ×1（免去市场价 ~25k）', (s.aiCores.basic ?? 0) === 1, `aiCores.basic=${s.aiCores.basic ?? 0}`)
mark('⑫ 领奖 + 学技能', s.gameMs)

step('⑬ 第一次指派 AI 副船')
const visNow = visibleFirstTasks(s).map((d) => d.id)
ok('队列已推进到「第一次指派 AI 副船」（前 11 条都判过了）', visNow[0] === 'first-ai', visNow.join(' / '))
// 副船 = 闲置的沙猫（此刻驾驶的是鲣鱼）＋ ⑫ 领到的基础 AI 核心
const assign = assignAiMining(s, 'sandcat', 'basic', BELT, ctx)
ok('指派沙猫去采矿', assign.ok, assign.ok ? '' : assign.error)
advanceGame(s, 1000, ctx) // 判定在引擎每拍（advanceFirstTasks）
ok('「第一次指派 AI 副船」判定完成', s.importantTasks['first-ai']?.done === true, `aiAssigns=${firstStatOf(s, 'aiAssigns')}`)
mark('⑬ 指派副船', s.gameMs)
// 买一枚是**可选**的（第二艘副船才需要）：只核一下价格读数，不作断言
const coreBuy = buyBasicAiCore(s, ctx)
console.log(`   市场上再买一枚基础 AI 核心：${coreBuy.ok ? '成功' : `未买（${coreBuy.error}）`}`)

step('⑭ 次数链：记账与领奖')
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

step('⑮ 收尾读数')
console.log(`   已完成「第一次」：${FIRST_TASKS.filter((d) => s.importantTasks[d.id]?.done === true).map((d) => d.title).join('、')}`)
console.log(`   未完成：${FIRST_TASKS.filter((d) => s.importantTasks[d.id]?.done !== true).map((d) => d.title).join('、') || '（无）'}`)
const fpEnd = firstTaskProgress(s)
ok('本流程走完队列前 11 条（长途运输与虫洞另算）', fpEnd.done === 11, `${fpEnd.done}/${fpEnd.total} 条`)
// **顺序解锁的收尾断言**：已完成集合必须**正好**是队列前 11 条——多一条就说明"跳级完成"又回来了
const doneIds = FIRST_TASKS.filter((d) => s.importantTasks[d.id]?.done === true).map((d) => d.id)
const wantIds = FIRST_TASKS.slice(0, 11).map((d) => d.id)
ok('已完成的正好是队列前 11 条（没有跳级完成的条目）', doneIds.join() === wantIds.join(), doneIds.join('、'))
ok(
  '「寻找人类」仍未发布（本流程还差 2 条「第一次」）',
  s.importantTasks['find-humans'] === undefined,
  `已完成 ${fpEnd.done}/${fpEnd.total} 条`,
)
ok('当前队列 = 「第一次长途运输」', currentTaskId(s) === 'first-haul', `实际 ${currentTaskId(s)}`)
// 工业页/市场页解锁的快照（第 3 条与第 7 条早做完了；这里只作收尾读数，防中途被锁回去）
ok('工业页与市场页均为解锁态', unlocked(s, 'industry') && unlocked(s, 'market'))
console.log(`   钱包 ${s.wallet.isk.toLocaleString('zh-CN')} · 游戏内时间 ${(s.gameMs / 3_600_000).toFixed(1)} 小时 · 日志 ${s.logs.length} 条`)
console.log(`\n${failures === 0 ? '✅ 流程全部通过' : `❌ 有 ${failures} 项未通过`}`)
process.exit(failures === 0 ? 0 : 1)
