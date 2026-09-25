/**
 * **数值标定工具：任务/次数链/市场收入/技能训练 的耗时读数**（2026-09-18 船长：「临时探针合并为工具」）。
 *
 * 这段工具回答的是"**这些目标做完要多久**"——船长审数值时的唯一读数来源：
 * ① `tasks` 13 条「第一次」任务各自耗时（能跑引擎的就实跑：采矿/精炼/生产/训练/悬赏）；
 * ② `chain` 13 条次数链的**顶档**与**逐级累计**耗时（阈值表读 `CHAIN_TIERS`，改表后重跑即得新读数）；
 * ③ `market` 「交易收入」链标定（各矿种满产卖出的 ISK/小时 ＋ 市场吸纳上限对照）；
 * ④ `skills` 技能训练时长（"最便宜优先"凑到 N 级要多久；满级总级数看这里）。
 *
 * **口径**：新档（无技能；6 条线 = 驾驶 1 ＋ AI 核心上限 5；采矿 50 单位/分·船）、
 * 游戏内时间与真实时间 1:1；每段自己 `buildSimContext()` ＋ 新档，互不干扰。
 * 跑引擎的段会真的推进游戏状态（只在内存里），**不写任何存档**。
 *
 * 用法：`npm run chain:balance`（四段全跑）· `npm run chain:balance -- chain`（只跑某段：
 * tasks / chain / market / skills）。
 *
 * **版本自检**：游戏版本 v0.1.0 · 存档结构 **v27** · 最后核对 2026-09-18 · 最后跑过 2026-09-18
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSimContext } from '@whale/data'
import { createInitialState, HOME_GALAXY_ID } from '../packages/core/src/state'
import type { GameState } from '../packages/core/src/state'
import { loadSaveFile } from '../packages/core/src/save'
import { advanceGame } from '../packages/core/src/engine'
import { startScan, scanWindowMsFor } from '../packages/core/src/explore'
import { startMining, getMiningParams, oneLegMs } from '../packages/core/src/mining'
import { startRefineRun } from '../packages/core/src/industry'
import { startManufacturing } from '../packages/core/src/manufacturing'
import { learnBlueprint } from '../packages/core/src/market'
import { startExpedition } from '../packages/core/src/expedition'
import { skillLevelTimeMs } from '../packages/core/src/training'
import { shortestTravelMinutes, travelMinutesEff } from '../packages/core/src/travel'
import { beginAfterAwaken } from '../packages/core/src/onboarding'
import { cargoCapacityM3Of } from '../packages/core/src/inventory'
import type { SimContext } from '../packages/core/src/types'
import { CHAIN_TIERS, FIRST_TASKS } from '../packages/core/src/firstTasks'
import { wormholeNodesPerLayer } from '../packages/core/src/wormholeFoes'
import { wreckDensityOf } from '../packages/core/src/salvage'
import { wormholeScanWindowMs } from '../packages/core/src/wormholeScan'
import {
  COURIER_TASK_LEVEL_FREIGHT_ISK,
  COURIER_TIMED_PREMIUM,
  COURIER_TIMED_VOLUME_RATIO,
  RESOURCE_TASK_LEVEL_MARGIN,
  SIDE_TASK_LEVEL_SCALE,
  courierVolumeFor,
  courierWarpReqOf,
  hourlySupplyOf,
} from '../packages/core/src/sideTasks'

const SECTIONS: Record<string, () => void> = {
  tasks: sectionTaskTimes,
  chain: sectionChainTimes,
  market: sectionMarketIncome,
  skills: sectionSkillsTime,
  sidetasks: sectionSideTasks,
}

const arg = (process.argv[2] ?? 'all').trim()
if (arg !== 'all' && !SECTIONS[arg]) {
  console.log(`未知段「${arg}」——可选：all / ${Object.keys(SECTIONS).join(' / ')}`)
  process.exit(1)
}
for (const [name, fn] of Object.entries(SECTIONS)) {
  if (arg !== 'all' && arg !== name) continue
  console.log(`\n════════ ${name} ════════`)
  fn()
}

/**
 * ── 时效任务板：各级资源的需量/奖励 ＋ 各级快递的体积/运费/门槛/时限（真实数据标定读数）──
 * 口径 = 玩家 1 小时产能锚（`hourlySupplyOf`）× 0.25 × 级别倍率；快递运费 = 体积 × 级别单价 × 航程系数。
 */
function sectionSideTasks(): void {
  const ctx: SimContext = buildSimContext()
  const state = createInitialState()
  // 造一座已建成副站 ⇒ 快递解锁（母港 → 红环航道 7 分钟标称）
  const site = [...ctx.stations.values()].find((s) => s.galaxyId === 'galaxy-redring') ?? [...ctx.stations.values()][0]!
  state.stationSites[site.id] = { stage: site.tiers.length, delivered: {} }
  const nominal = shortestTravelMinutes(ctx, HOME_GALAXY_ID, site.galaxyId)
  console.log(`副站「${site.name}」（${ctx.galaxies.get(site.galaxyId)?.name ?? site.galaxyId}）· 母港标称航程 ${nominal} 分钟`)

  console.log('\n【资源任务】各级需量与奖励（取两件代表货：钛钢合金 / 动能弹药 L）')
  for (const key of ['min-tritanium', 'ammo-kinetic-l']) {
    const def = ctx.marketGoods.get(key)!
    const perHour = hourlySupplyOf(state, ctx, def.refId)
    const rows: string[] = []
    for (const lv of [1, 2, 3, 4, 5] as const) {
      const need = Math.max(10, Math.round((perHour * 1 * SIDE_TASK_LEVEL_SCALE[lv]) / 10) * 10)
      const reward = Math.round((need * (def.basePrice ?? 0) * RESOURCE_TASK_LEVEL_MARGIN[lv]) / 100) * 100
      rows.push(`L${lv} ${need.toLocaleString('zh-CN')} ⇒ ${reward.toLocaleString('zh-CN')}`)
    }
    console.log(`  ${def.refId}（1 小时产能 ${Math.round(perHour).toLocaleString('zh-CN')}）: ${rows.join(' · ')}`)
  }

  console.log('\n【快递】各级体积（非限时 / 限时减半）/ 运费（与体积解耦）/ 限时门槛与时限')
  const trip = Math.max(0.5, nominal / 10)
  for (const lv of [1, 2, 3, 4, 5] as const) {
    const volNt = courierVolumeFor(lv, false)
    const volT = courierVolumeFor(lv, true)
    const req = courierWarpReqOf(lv)
    const reward = Math.max(100, Math.floor((COURIER_TASK_LEVEL_FREIGHT_ISK[lv] * trip) / 100) * 100)
    const rewardT = Math.max(100, Math.floor((COURIER_TASK_LEVEL_FREIGHT_ISK[lv] * trip * COURIER_TIMED_PREMIUM) / 100) * 100)
    const limitMin = nominal * (ctx.balance.travel.warpRefAus / req) * 1.05
    console.log(
      `  L${lv}：体积 普通 ${volNt.toLocaleString('zh-CN')} m³ / 限时 ${volT.toLocaleString('zh-CN')} m³（×${COURIER_TIMED_VOLUME_RATIO}）` +
        ` ⇒ 运费 普通 ${reward.toLocaleString('zh-CN')} / 限时 ${rewardT.toLocaleString('zh-CN')} ISK（加急 ×${COURIER_TIMED_PREMIUM}）` +
        ` · 限时门槛 跃迁 ≥${req} AU/s · 时限 ≈${limitMin.toFixed(1)} 分钟`,
    )
  }
  console.log('\n（航程系数 = 标称分钟 ÷ 10，下限 0.5、无上限 ⇒ 远站线性加价；此处按上面那条航程的系数算）')
}

/** ── 13 条「第一次」任务各自耗时（引擎实跑） ── */
function sectionTaskTimes(): void {
const ctx: SimContext = buildSimContext()
const HOME = HOME_GALAXY_ID
const min = (ms: number): string => `${(ms / 60_000).toFixed(1)} 分钟`
const rows: Array<[string, string, string]> = []
const say = (task: string, time: string, how: string): void => {
  rows.push([task, time, how])
}

/** 推进直到条件成立，返回用的毫秒（超预算 ⇒ 返回预算并标注） */
function runUntil(s: GameState, cond: () => boolean, budgetMs: number, stepMs = 5_000): { ms: number; ok: boolean } {
  let spent = 0
  while (!cond() && spent < budgetMs) {
    advanceGame(s, stepMs, ctx)
    spent += stepMs
  }
  return { ms: spent, ok: cond() }
}

// ── ① 扫描母港：10 秒窗口（explore.ts 的 HOME_SCAN_WINDOW_MS）──
{
  const s = createInitialState({ nowWallMs: 0, seed: 1, prologue: true })
  s.onboarding.step = 99
  startScan(s, HOME, ctx)
  const r = runUntil(s, () => s.exploredGalaxies.includes(HOME), 60_000, 1_000)
  say('① 第一次扫描（母港）', min(r.ms), '母港窗口 10 秒（其余星系 10 分钟基准 × 技能 × 低安）')
}

// ── ② 采集原矿：从派船到第一单位入货仓 ──
{
  const s = createInitialState({ nowWallMs: 0, seed: 1, prologue: true })
  s.onboarding.step = 99
  s.shipId = 'sandcat'
  // ⚠ ② 的前置是 ①：新档必须先扫母港才点得亮矿带（本探针照真实顺序走一遍）
  startScan(s, HOME, ctx)
  runUntil(s, () => s.exploredGalaxies.includes(HOME), 60_000, 1_000)
  const started = startMining(s, 'belt-fortune', ctx)
  if (!started.ok) say('② 派船失败', started.error ?? '', '')
  const r = runUntil(s, () => (s.firstStats?.mineUnits ?? 0) > 0, 30 * 60_000)
  const p = getMiningParams(s, ctx, { shipId: 'sandcat', beltId: 'belt-fortune' })
  say('② 第一次采集原矿（采到 ≥1 单位）', min(r.ms), `沙猫级 ${p?.cycleMs ? p.cycleMs / 1000 : '?'} 秒/循环产 ${p?.unitsPerCycle ?? '?'} 单位（含出航）`)
}

// ── ③ 打捞残骸：需先在邻星系找到残骸点（扫描 10 分钟 + 航程 + 一个打捞循环）──
{
  const { state: s } = loadSaveFile(readFileSync(join(process.cwd(), 'docs', 'test-saves', 'test-save-lairgear-20260912-174550.json'), 'utf8'))
  /**
   * ⚠ **2026-09-20 修**：这里原先写 `ctx.wrecks?.has?.(g)` —— `SimContext` **没有 `wrecks` 这个字段**
   * （残骸组现在是 `ctx.wreckGroups`，密度走 `wreckDensityOf`）⇒ 那句 `?.` 永远短路成 false、
   * `wreckGal` 恒为 undefined ⇒ 读数里那句"（该档无已知残骸星系…）"永远挂着。改成按密度判。
   */
  const wreckGal = [...ctx.galaxies.keys()].find((g) => g !== HOME && wreckDensityOf(s, g, ctx) > 0)
  const legMs = oneLegMs(s, ctx, undefined, undefined)
  say('③ 第一次打捞残骸', `≈ ${min(10 * 60_000 + legMs)} 起`, `邻星系扫描 10 分钟 ＋ 往返航程（母港单程 ${min(legMs)}）＋ 一个打捞循环；${wreckGal ? '' : '（该档无已知残骸星系，按"先扫到有残骸的星系"估）'}`)
}

// ── ④ 维修：一次点击（港内付费维修，费用按伤情）──
say('④ 第一次维修舰船', '≈ 0（一次点击）', '港内付费维修即时完成；新档鲣鱼 80% 伤，费用约 1.6k 信用点')

// ── ⑤ 悬赏首胜：演习场驱逐令（母港本地）──
{
  const s = createInitialState({ nowWallMs: 0, seed: 1, prologue: true })
  s.onboarding.step = 99
  s.exploredGalaxies = [HOME]
  s.wallet.isk = 50_000
  startExpedition(s, 'ano-training', ctx)
  const r = runUntil(s, () => (s.firstStats?.bountyWins ?? 0) > 0, 20 * 60_000)
  say('⑤ 第一次完成悬赏', min(r.ms), '演习场驱逐令：交火 20 秒 ＋ 胜利后固定返港 2 分钟（本地悬赏）')
}

// ── ⑥ 精炼一批（100 单位）──
{
  const s = createInitialState({ nowWallMs: 0, seed: 1, prologue: true })
  s.onboarding.step = 99
  s.warehouse.items['ore-veldspar'] = 200
  startRefineRun(s, 'ore-veldspar', 'pilot', ctx)
  const r = runUntil(s, () => (s.firstStats?.refineBatches ?? 0) > 0, 30 * 60_000)
  say('⑥ 第一次操作精炼炉（一批 100 单位）', min(r.ms), '起炉即按批烧，料尽自停')
}

// ── ⑦ 生产一件（动能弹药生产线：120 发）──
{
  const s = createInitialState({ nowWallMs: 0, seed: 1, prologue: true })
  s.onboarding.step = 99
  s.blueprintStock['bp-ammo-kinetic'] = 1
  s.warehouse.items['min-tritanium'] = 500
  learnBlueprint(s, ctx, 'bp-ammo-kinetic')
  const bp = ctx.blueprints.get('bp-ammo-kinetic')
  const ok = startManufacturing(s, 'bp-ammo-kinetic', 'pilot', ctx)
  const r = runUntil(s, () => (s.firstStats?.produceUnits ?? 0) > 0, 60 * 60_000)
  say('⑦ 第一次生产', min(r.ms), `${bp?.name ?? '动能弹药生产线'}：一批 ${bp?.outputUnits ?? '?'} 件${ok.ok ? '' : `（起线失败：${ok.error}）`}`)
}

// ── ⑧ 挂单：一次点击 ──
say('⑧ 第一次挂单销售', '≈ 0（一次点击）', '市场挂一张卖单即成')

// ── ⑨ 第一条船：用 ⑦ 送的沙猫蓝图造沙猫（材料 200 钛钢 + 50 银纹 + 工期 15 分钟）──
{
  const s = createInitialState({ nowWallMs: 0, seed: 1, prologue: true })
  s.onboarding.step = 99
  s.blueprintStock['sbp-sandcat'] = 1
  s.warehouse.items['min-tritanium'] = 5_000
  s.warehouse.items['min-pyerite'] = 5_000
  const learned = learnBlueprint(s, ctx, 'sbp-sandcat')
  const started = startManufacturing(s, 'sbp-sandcat', 'pilot', ctx)
  const r = runUntil(s, () => (s.firstStats?.ships ?? 0) > 0, 90 * 60_000)
  say(
    '⑨ 第一条船（沙猫级）',
    r.ok ? min(r.ms) : `≥ ${min(r.ms)}（未完成）`,
    `学会蓝图 ${learned.ok ? 'OK' : learned.error} · 起线 ${started.ok ? 'OK' : started.error} · 工期 15 分钟；材料 200 钛钢合金 ＋ 50 银纹超金属（约两批精炼）`,
  )
}

// ── ⑩ 学技能：AI 核心操作学 Lv1 ──
{
  const def = ctx.skills.get('ai-expert')
  const t = def ? skillLevelTimeMs(def, 1) : 0
  say('⑩ 第一次学习技能（AI 核心操作学 Lv1）', min(t), `训练时长按技能表（rank ${def?.rank ?? '?'}）；免训练费、离线也走`)
}

// ── ⑪ 指派 AI 副船：核心由 ⑩ 送、船由 ⑤ 送 ⇒ 一次点击 ──
say('⑪ 第一次指派 AI 副船', '≈ 0（一次点击）', '前置已由 ⑩ 送核心、⑤ 送一艘鲣鱼级满足')

// ── ⑫ 长途运输：先建成一座副站 ＋ 一趟往返 ──
{
  const sites = [...ctx.stations.values()]
  const tierRows: string[] = []
  let totalUnits = 0
  for (const site of sites.slice(0, 2)) {
    for (const t of site.tiers) {
      totalUnits += t.bill.reduce((a, b) => a + b.count, 0)
    }
    tierRows.push(`${site.name}（${site.tiers.length} 档）`)
  }
  say('⑫ 第一次长途运输', '数小时级（见备注）', `需先建成一座副站：${tierRows.join(' / ')}，各档合计需交付约 ${totalUnits.toLocaleString('zh-CN')} 单位物资（材料靠采矿＋精炼，按沙猫一趟 70 单位算 ≈ ${Math.ceil(totalUnits / 70)} 趟）；建成后一趟往返按真实航程结算`)
}

// ── ⑬ 虫洞：协会声望 40 ──
{
  let firstWinSum = 0
  let n = 0
  const gains: number[] = []
  for (const a of ctx.anomalies.values()) {
    if (a.hidden === true) continue
    const g = a.standingGain ?? 0
    if (g <= 0) continue
    gains.push(g)
    n += 1
  }
  gains.sort((a, b) => b - a)
  let acc = 0
  let need = 0
  for (const g of gains) {
    if (acc >= 40) break
    acc += g
    need += 1
  }
  firstWinSum = acc
  const perRunMin = 2.3 // 本地悬赏：交火 20 秒 + 返港 2 分钟；异星系还要加往返航程
  say('⑬ 第一次虫洞（协会声望 40）', `≈ ${(need * perRunMin).toFixed(0)} 分钟起（仅本地悬赏）`, `声望**仅首胜授予** ⇒ 至少要打赢 ${need} 张不同的敌军卡（可获首胜声望的卡共 ${n} 张，合计 ${firstWinSum} 点）；每场本地约 ${perRunMin} 分钟，异星系还要加往返航程`)
}

console.log('「第一次」各条耗时读数（游戏内时间，与真实时间 1:1）\n')
for (const [task, time, how] of rows) {
  console.log(`· ${task} ⇒ ${time}\n    ${how}`)
}
// ── 补：③⑫⑬ 细化（口径 = 新档；⑫ 要先建成一座副站才会解锁长途运输）──
{
  const s = createInitialState()
  beginAfterAwaken(s)
  const effMin = (gid: string): number => travelMinutesEff(s, ctx, shortestTravelMinutes(ctx, HOME, gid), s.shipId)
  const nameOf = (id: string): string => ctx.items.get(id)?.name ?? id
  console.log('\n── 细化读数（新档口径）──')

  // 舰队与货舱
  const fleetRows: string[] = []
  for (const uid of Object.keys(s.fleet)) {
    const def = ctx.ships.get(s.fleet[uid]?.defId ?? '')
    if (!def) continue
    const cap = cargoCapacityM3Of(s, ctx, uid)
    fleetRows.push(`${def.name}（货舱 ${cap} m³ · 跃迁 ${def.warpSpeedAus ?? '?'} AU/s）`)
  }
  console.log(`舰队：${fleetRows.join(' · ') || '（空）'} · 当前船 = ${s.shipId}`)

  // ③ 打捞：最近的邻星系（母港无残骸 ⇒ 先扫一处再往返）
  const neighbour = ctx.galaxyEdges
    .filter((e) => e.from === HOME || e.to === HOME)
    .map((e) => ({ gid: e.from === HOME ? e.to : e.from, m: e.travelMinutes }))
    .sort((a, b) => a.m - b.m)[0]
  if (neighbour) {
    const leg = effMin(neighbour.gid)
    console.log(`③ 细化：最近邻星系 ${ctx.galaxies.get(neighbour.gid)?.name ?? neighbour.gid} 实际单程 ${leg} 分` +
      ` ⇒ 一趟打捞 ≈ ${(10 + leg * 2 + 0.2).toFixed(0)} 分钟（扫描 10 分 ＋ 往返 ${leg * 2} 分 ＋ 一个打捞循环）`)
  }

  // ⑫ 副站：逐站列出材料单、总单位、总体积、交付趟数
  for (const site of ctx.stations.values()) {
    const oneWay = (() => { try { return effMin(site.galaxyId) } catch { return NaN } })()
    let units = 0
    let m3 = 0
    const oreNeed: Record<string, number> = {}
    const parts: string[] = []
    for (const tier of site.tiers) {
      let tierUnits = 0
      const items: string[] = []
      for (const b of tier.bill) {
        tierUnits += b.count
        units += b.count
        const unitM3 = ctx.items.get(b.itemId)?.unitM3 ?? 1
        m3 += b.count * unitM3
        let best = Infinity
        for (const def of ctx.items.values()) {
          for (const row of def.refine ?? []) {
            if (row.mineralId !== b.itemId || !(row.perOre > 0)) continue
            best = Math.min(best, 1 / row.perOre)
          }
        }
        oreNeed[b.itemId] = (oreNeed[b.itemId] ?? 0) + b.count * (Number.isFinite(best) ? best : 1)
        items.push(`${nameOf(b.itemId)} ${b.count.toLocaleString('zh-CN')}`)
      }
      parts.push(`${tier.name}（${items.join('＋')}）`)
    }
    const oreTotal = Object.values(oreNeed).reduce((a, b) => a + b, 0)
    const batches = Math.ceil(units / 100)
    const caps = Object.keys(s.fleet).map((uid) => ({ uid, cap: cargoCapacityM3Of(s, ctx, uid) }))
    caps.sort((a, b) => b.cap - a.cap)
    const best = caps[0]
    const trips = best ? Math.ceil(m3 / Math.max(1, best.cap)) : Infinity
    const roundTrip = Number.isFinite(oneWay) ? oneWay * 2 : NaN
    console.log(`\n⑫ 细化：${site.name}（${ctx.galaxies.get(site.galaxyId)?.name ?? site.galaxyId}）`)
    console.log(`   ${parts.join(' · ')}`)
    console.log(`   合计 ${units.toLocaleString('zh-CN')} 单位 · ${m3.toLocaleString('zh-CN')} m³` +
      ` ⇒ 需原矿约 ${Math.round(oreTotal).toLocaleString('zh-CN')} 单位 · 精炼 ${batches} 批` +
      (Number.isFinite(oneWay) ? ` · 母港实际单程 ${oneWay} 分（往返 ${roundTrip} 分）` : ''))
    if (best) console.log(`   交付趟数：按最大货舱 ${best.cap} m³ ⇒ ${trips} 趟 ≈ ${(trips * roundTrip / 60).toFixed(1)} 小时航程`)
  }

  // ⑬ 声望：可见的给声望卡全表（按最省时间排序）
  const cards: Array<{ id: string; gain: number; galaxy: string; min: number }> = []
  let hiddenWithGain = 0
  for (const a of ctx.anomalies.values()) {
    const gain = a.standingGain ?? 0
    if (gain <= 0) continue
    if (a.hidden === true) {
      hiddenWithGain += 1
      continue
    }
    const explored = s.exploredGalaxies.includes(a.galaxyId)
    const oneWay = a.galaxyId === HOME ? 1 : (() => { try { return effMin(a.galaxyId) } catch { return NaN } })()
    const cost = (explored ? 0 : 10) + oneWay * 2 + (a.galaxyId === HOME ? 2 : (a.combatSeconds ?? 20) / 60)
    cards.push({ id: a.id, gain, galaxy: ctx.galaxies.get(a.galaxyId)?.name ?? a.galaxyId, min: cost })
  }
  cards.sort((a, b) => a.min - b.min)
  let acc = 0
  let totalMin = 0
  let picked = 0
  const detail: string[] = []
  for (const c of cards) {
    if (acc >= 40) break
    acc += c.gain
    totalMin += c.min
    picked += 1
    if (picked <= 4) detail.push(`${c.id}(＋${c.gain} · ${c.galaxy} · 约 ${c.min.toFixed(0)} 分)`)
  }
  const sumGain = cards.reduce((a, b) => a + b.gain, 0)
  console.log(`\n⑬ 细化：可见的给声望卡 ${cards.length} 张、合计 ${sumGain} 点（另有隐藏卡 ${hiddenWithGain} 张也带声望）`)
  console.log(`   按"最省时间"顺序取 ${picked} 张可达 40 点 ⇒ 合计约 ${(totalMin / 60).toFixed(1)} 小时`)
  console.log(`   最省的四张：${detail.join(' · ')}`)
  console.log(`   口径：未探明星系先算 10 分钟扫描；本地悬赏按固定返港 2 分钟，异星系按实际往返航程＋交火时长`)
}
// ── 补二：⑫ 的采矿/精炼耗时、⑬ 的"最少场次"路线 ──
{
  const s = createInitialState()
  beginAfterAwaken(s)
  const effMin = (gid: string): number => travelMinutesEff(s, ctx, shortestTravelMinutes(ctx, HOME, gid), s.shipId)
  const p = getMiningParams(s, ctx, { shipId: s.shipId, beltId: 'belt-fortune' })
  const perCycle = p?.unitsPerCycle ?? 10
  const cycleMin = (p?.cycleMs ?? 12_000) / 60_000
  const legMin = oneLegMs(s, ctx, undefined, undefined) / 60_000
  const hold = cargoCapacityM3Of(s, ctx, s.shipId)
  console.log(`\n⑫ 采矿口径：${s.shipId} 每循环 ${perCycle} 单位 / ${(cycleMin * 60).toFixed(0)} 秒 · 货舱 ${hold} m³`)
  const siteOres: Array<[string, number]> = [['红环前哨站', 7_550], ['烬火前哨站', 19_668]]
  for (const pair of siteOres) {
    const siteName = pair[0]
    const ore = pair[1]
    const trips = Math.ceil(ore / hold)
    const mineMin = (ore / perCycle) * cycleMin + trips * 2 * legMin
    const batchesPerMineral: number[] = []
    const site = [...ctx.stations.values()].find((x) => x.name === siteName)
    if (site) {
      for (const tier of site.tiers) {
        for (const b of tier.bill) {
          let cycle = 20_000
          for (const def of ctx.items.values()) {
            if (!(def.refine ?? []).some((r) => r.mineralId === b.itemId)) continue
            cycle = Math.min(cycle, def.refineCycleMs ?? 20_000)
          }
          batchesPerMineral.push(Math.ceil(b.count / 100) * cycle)
        }
      }
    }
    const refineMin = Math.max(...batchesPerMineral, 0) / 60_000
    const roundTrip = 2 * effMin(site?.galaxyId ?? HOME)
    console.log(`   ${siteName}：原矿 ${ore.toLocaleString('zh-CN')} ⇒ 采矿约 ${(mineMin / 60).toFixed(1)} 小时` +
      `（含 ${trips} 趟返港卸货）＋ 精炼并行约 ${refineMin.toFixed(0)} 分钟 ＋ 交付往返 ${roundTrip.toFixed(0)} 分钟` +
      ` ⇒ **合计约 ${((mineMin + refineMin + roundTrip) / 60).toFixed(1)} 小时**`)
  }

  const rows: Array<{ id: string; gain: number; min: number; gal: string }> = []
  for (const a of ctx.anomalies.values()) {
    const gain = a.standingGain ?? 0
    if (gain <= 0 || a.hidden === true) continue
    const explored = s.exploredGalaxies.includes(a.galaxyId)
    const oneWay = a.galaxyId === HOME ? 1 : (() => { try { return effMin(a.galaxyId) } catch { return NaN } })()
    rows.push({
      id: a.id,
      gain,
      gal: ctx.galaxies.get(a.galaxyId)?.name ?? a.galaxyId,
      min: (explored ? 0 : 10) + oneWay * 2 + (a.galaxyId === HOME ? 2 : (a.combatSeconds ?? 20) / 60),
    })
  }
  rows.sort((a, b) => b.gain - a.gain || a.min - b.min)
  let acc = 0
  let minutes = 0
  let count = 0
  for (const r of rows) {
    if (acc >= 40) break
    acc += r.gain
    minutes += r.min
    count += 1
  }
  console.log(`\n⑬ 另一条路线（最少场次）：打声望最高的 ${count} 张可达 ${acc} 点 ⇒ 合计约 ${(minutes / 60).toFixed(1)} 小时` +
    `（这些卡多在远星系，单场航程更贵）`)
}
}

/** ── 13 条次数链逐级/顶档耗时 ── */
function sectionChainTimes(): void {
const ctx = buildSimContext()
const HOME = HOME_GALAXY_ID
const s = createInitialState()
const h = (min: number): string => `${(min / 60).toFixed(1)} 小时`
const d = (min: number): string => `${(min / 60 / 24).toFixed(1)} 天`
const travel = (gid: string): number => travelMinutesEff(s, ctx, shortestTravelMinutes(ctx, HOME, gid), s.shipId)

const chainOf = (stat: string): { name: string; tiers: readonly number[] } | null => {
  for (const def of FIRST_TASKS) {
    if (def.chain && (def.chain.stat === stat || def.chain.tierKey === stat)) {
      return { name: `${def.chain.name}（${def.title}）`, tiers: CHAIN_TIERS[def.chain.tierKey] ?? [] }
    }
  }
  return null
}

const rows: Array<{ chain: string; top: string; time: string; how: string }> = []
const push = (stat: string, top: string, min: number, how: string): void => {
  const c = chainOf(stat)
  rows.push({ chain: c?.name ?? stat, top, time: `${h(min)}（${d(min)}）`, how })
}

// ① 宇宙探索家（扫描 → 全图 20 星系）
{
  const gids = [...ctx.galaxies.keys()]
  let min = 0
  let scan = 0
  for (const gid of gids) {
    if (gid === HOME) continue
    scan += scanWindowMsFor(s, ctx, gid) / 60_000
    min += travel(gid) * 2
  }
  min += scan
  push('scan', `点亮全部 ${gids.length} 个星系`, min,
    `逐星往返航程合计 ${h(min - scan)} ＋ 扫描窗口合计 ${h(scan)}` +
      `（母港 10 秒；其余 = 10 分钟基准 × **危险度曲线**（2026-09-25 船长令：高安恒 10 分、最深 12 时））`)
}

// ② 打捞（3,000 循环）
{
  const top = CHAIN_TIERS.salvageRuns!.at(-1)!
  const cycleMin = 10 / 60 // salvageCycleMs 缺省 10 秒（打捞器 1 台）
  push('salvageRuns', `${top} 次打捞循环`, top * cycleMin,
    `${top} × 10 秒净循环；另加"去残骸星系的航程 × 趟数"（货舱 800 m³ 装满才返航）`)
}

// ③ 悬赏（3,000 胜）
{
  const top = CHAIN_TIERS.bountyWins!.at(-1)!
  const perWin = 20 / 60 + 2 // 交火 20 秒 + 胜利固定返港 2 分钟（本地悬赏）
  push('bountyWins', `${top} 场胜`, top * perWin, `${top} × ${perWin.toFixed(1)} 分钟（本地悬赏：交火 20 秒＋返港 2 分钟）`)
}

// ④ 维修（3,000 次）+ ⑤ 市场·交易收入（1,000 亿 ISK）+ ⑥ AI 指派（3,000 次）——动作本身即时，卡在"事件源/物资"
{
  const top = CHAIN_TIERS.repairs!.at(-1)!
  push('repairs', `${top} 次维修`, top * (20 / 60 + 2),
    `维修本身即时（港内付费/修理组件），但每次都要有损伤可修 ⇒ 事件源＝战斗，按每场战斗修一次估 ≈ 与悬赏链同价`)
  /**
   * 市场链自 2026-09-18 起改数**交易收入（税后信用点）**（船长：「挂单按照市场交易收入计数」）——
   * 耗时 = 顶档 ISK ÷ 满产卖出速率；速率与矿种明细由本工具 **market 段**实算（此处取同一口径的读数）。
   */
  const mTop = CHAIN_TIERS.marketIncome!.at(-1)!
  const iskPerHour = 7_020_000 // 6 条线满产卖冥铁合金（market 段实算：7,020,000 ISK/小时）
  push('marketIncome', `${mTop.toLocaleString('zh-CN')} ISK（税后）`, (mTop / iskPerHour) * 60,
    `按 6 条线满产卖最赚矿物（${(iskPerHour / 10_000).toLocaleString('zh-CN')} 万 ISK/小时）⇒ ${h(mTop / iskPerHour)}；` +
    `换成便宜的银纹超金属则 ${Math.round(mTop / 212_760 / 24 / 365)} 年；后期产能 ×10（单船 500 单位/分）⇒ ${h(mTop / iskPerHour / 10)}（明细见 market 段）`)
  const aTop = CHAIN_TIERS.aiAssigns!.at(-1)!
  push('aiAssigns', `${aTop} 次指派`, 0,
    `指派本身是点击（每次需一枚空闲核心＋一艘船）；同一次指派不重复计数，照实打＝${aTop} 次副船任务派发`)
}

// ⑦ 长途运输（3,000 趟）
{
  const top = CHAIN_TIERS.haulTrips!.at(-1)!
  const site = [...ctx.stations.values()].sort((a, b) => travel(a.galaxyId) - travel(b.galaxyId))[0]!
  const round = travel(site.galaxyId) * 2
  push('haulTrips', `${top} 趟`, top * round,
    `前提＝建成一座副站（见 ⑫）；最近站 ${site.name} 往返 ${round} 分 ⇒ ${top} × ${round} 分`)
}

// ⑧ 虫洞（3,000 趟）
{
  const top = CHAIN_TIERS.wormholeRuns!.at(-1)!
  let perRun = 0
  const parts: string[] = []
  for (let depth = 1; depth <= 3; depth += 1) {
    const nodes = wormholeNodesPerLayer(depth)
    const waves = Math.min(3, 1 + Math.floor((depth - 1) / 2) + 1)
    const min = nodes * (waves * 50) / 60 // 每波约 50 秒（虫洞敌军卡 40~60 秒）
    parts.push(`第 ${depth} 层 ${nodes} 节点 ≈ ${min.toFixed(0)} 分`)
    perRun += min
  }
  // 真正的硬顶：**每趟要消耗一处坐标**，坐标由"扫描虫洞"产（窗口 12 小时 × 三技能乘算）
  const scanBase = wormholeScanWindowMs(s) / 60_000
  const skillMax = 0.92 ** 5 * 0.94 ** 5 * 0.94 ** 5 // 信号分析/过滤/测绘 三技能满级
  const scanBest = scanBase * skillMax
  const runMin = top * perRun
  const gateMin = top * scanBest
  push('wormholeRuns', `${top} 趟`, Math.max(runMin, gateMin),
    `前提＝协会声望 40（8~9 小时）；单趟下潜 3 层 ≈ ${perRun.toFixed(0)} 分（${parts.join(' · ')}）⇒ 跑完 ${top} 趟 ${h(runMin)}；` +
    `**但每趟要消耗一处坐标** ⇒ 扫描 ${scanBase.toFixed(0)} 分钟/处＝12 小时（三技能满级 ${scanBest.toFixed(1)} 分钟/处）⇒ ${top} 处 ≈ ${h(gateMin)}（这是真瓶颈；扫描期间主控被占）`,
  )
}

// ⑨ 舰船（130 艘）
{
  const top = CHAIN_TIERS.ships!.at(-1)!
  const bp = ctx.shipBlueprints.get('sbp-sandcat')
  const build = (bp?.buildSeconds ?? 900) / 60
  const mats = bp?.materials ?? []
  // 无门槛矿带的最优产率（母港/柯尔边境这类 standingReq=0 的）
  const ungated = new Set<string>()
  for (const b of ctx.belts.values()) if (!b.standingReq) ungated.add(b.oreId)
  let orePerShip = 0
  for (const m of mats) {
    let best = 1
    for (const def of ctx.items.values()) {
      if (!ungated.has(def.id)) continue
      for (const row of def.refine ?? []) {
        if (row.mineralId === m.itemId && row.perOre > 0) best = Math.max(best, row.perOre)
      }
    }
    orePerShip += m.count / best
  }
  const lines = 6 // 驾驶 1 ＋ AI 核心上限 5（AI 核心操作学满级）
  push('ships', `${top} 艘`, (top * build) / lines,
    `沙猫级工期 ${build} 分/艘 · ${lines} 条线并行（驾驶＋5 枚核心）⇒ ${top} 艘；` +
    `材料另需无门槛矿带原矿约 ${Math.round(orePerShip * top).toLocaleString('zh-CN')} 单位（≈ ${h(orePerShip * top / 50)} 单船采矿）`)
}

// ⑩ 采矿（4,000,000 单位）
{
  const top = CHAIN_TIERS.mineUnits!.at(-1)!
  const p = getMiningParams(s, ctx, { shipId: s.shipId, beltId: 'belt-fortune' })
  const perMin = (p?.unitsPerCycle ?? 10) / ((p?.cycleMs ?? 12_000) / 60_000)
  push('mineUnits', `${top.toLocaleString('zh-CN')} 单位`, top / perMin,
    `当前船（${s.shipId}）${perMin.toFixed(0)} 单位/分 ⇒ 单船；6 条线（驾驶 1＋5 核心）≈ ${h(top / perMin / 6)}`)
}

// ⑪ 生产（40,000 单位）
{
  const top = CHAIN_TIERS.produceUnits!.at(-1)!
  const bp = ctx.blueprints.get('bp-ammo-kinetic')
  const perBatch = bp?.outputUnits ?? 120
  const sec = bp?.buildSeconds ?? 10
  const batches = Math.ceil(top / perBatch)
  const matPerBatch = (bp?.materials ?? []).reduce((a, m) => a + m.count, 0)
  push('produceUnits', `${top.toLocaleString('zh-CN')} 件`, (batches * sec) / 60,
    `动能弹药 ${perBatch} 件/${sec} 秒 ⇒ ${batches} 批（单线）；材料 ${matPerBatch} 钛钢合金/批 ⇒ 合计 ${(batches * matPerBatch).toLocaleString('zh-CN')} 精炼矿物`)
}

// ⑫ 精炼（40,000 批）
{
  const top = CHAIN_TIERS.refineBatches!.at(-1)!
  const cycles: number[] = []
  for (const def of ctx.items.values()) {
    if (!def.refine?.length) continue
    cycles.push(def.refineCycleMs ?? 20_000)
  }
  cycles.sort((a, b) => a - b)
  const avg = cycles.reduce((a, b) => a + b, 0) / Math.max(1, cycles.length)
  const unitsPerBatch = 100
  push('refineBatches', `${top.toLocaleString('zh-CN')} 批`, (top * avg) / 60_000,
    `每批 ${unitsPerBatch} 单位 ⇒ 需原矿 ${(top * unitsPerBatch).toLocaleString('zh-CN')} 单位（＝采矿链顶档 400 万）；单线按平均 ${(avg / 1000).toFixed(0)} 秒/批，6 条线 ≈ ${h((top * avg) / 60_000 / 6)}`)
}

// ⑬ 技能（累计 320 级）
{
  const top = CHAIN_TIERS.skills!.at(-1)!
  const all: number[] = []
  let totalLevels = 0
  for (const def of ctx.skills.values()) {
    for (let lv = 1; lv <= 5; lv += 1) {
      all.push(skillLevelTimeMs(def, lv))
      totalLevels += 1
    }
  }
  all.sort((a, b) => a - b)
  const cheapest = all.slice(0, top).reduce((a, b) => a + b, 0)
  const everything = all.reduce((a, b) => a + b, 0)
  push('skills', `累计 ${top} 级`, cheapest / 60_000,
    `技能表共 ${ctx.skills.size} 个技能 ⇒ 上限 ${totalLevels} 级；按"最便宜优先"凑 ${top} 级需训练 ${h(cheapest / 60_000)}（全表练满 = ${h(everything / 60_000)}，单线排队、离线照走）`)
}

console.log('13 条次数链：顶档（全部级别）耗时读数（游戏内时间，1:1）\n')
for (const r of rows) {
  console.log(`· ${r.chain}`)
  console.log(`   顶档 ${r.top} ⇒ **${r.time}**`)
  console.log(`   ${r.how}`)
}
// ── 附：逐级累计读数（同一套单次成本，用来看"第几级开始变成天级"）──
{
  const p = getMiningParams(s, ctx, { shipId: s.shipId, beltId: 'belt-fortune' })
  const perMin = (p?.unitsPerCycle ?? 10) / ((p?.cycleMs ?? 12_000) / 60_000)
  const perEvent: Record<string, number> = {
    scan: NaN, // 单独算
    salvageRuns: 10 / 60,
    bountyWins: 20 / 60 + 2,
    repairs: 20 / 60 + 2,
    // 市场链：每 1 ISK 收入 ≈ 1/(7,020,000 ISK/小时) 小时（满产卖最赚矿物；market 段实算同源）
    marketIncome: 60 / 7_020_000,
    aiAssigns: 0,
    haulTrips: travel([...ctx.stations.values()].sort((a, b) => travel(a.galaxyId) - travel(b.galaxyId))[0]!.galaxyId) * 2,
    wormholeRuns: wormholeScanWindowMs(s) * 0.357 / 60_000, // 坐标扫描（三技能满级）——真瓶颈
    ships: 900 / 60 / 6,
    mineUnits: 1 / perMin,
    produceUnits: 10 / 60 / 120,
    refineBatches: 32 / 60,
    skills: 267.2 * 60 / 320, // 最便宜优先 ≈ 267.2 小时 / 320 级（≈50.1 分钟/级）
  }
  console.log('\n逐级累计（同一单次成本；L1/L3/L5/L7/L10）\n')
  for (const def of FIRST_TASKS) {
    if (!def.chain) continue
    const tiers = CHAIN_TIERS[def.chain.tierKey] ?? []
    const stat = def.chain.stat
    const cells = [0, 2, 4, 6, 9].map((i) => {
      const need = tiers[i]
      if (need === undefined) return `L${i + 1} —`
      let min = need * (perEvent[stat] ?? 0)
      if (stat === 'scan') {
        const gids = [...ctx.galaxies.keys()]
        min = 0
        for (const gid of gids.slice(0, need)) min += (gid === HOME ? 0 : travel(gid) * 2 + scanWindowMsFor(s, ctx, gid) / 60_000)
      }
      const label = min >= 1440 ? `${(min / 1440).toFixed(1)} 天` : `${(min / 60).toFixed(1)} 时`
      return `L${i + 1}=${need.toLocaleString('zh-CN')} → ${label}`
    })
    console.log(`· ${def.chain.name}：${cells.join(' · ')}`)
  }
}
}

/** ── 市场「交易收入」链标定（含吸纳上限对照） ── */
function sectionMarketIncome(): void {
const ctx = buildSimContext()
const s = createInitialState()
const p = getMiningParams(s, ctx, { shipId: s.shipId, beltId: 'belt-fortune' })
const orePerHour = ((p?.unitsPerCycle ?? 10) / ((p?.cycleMs ?? 12_000) / 60_000)) * 60 * 6

const priceOf = (key: string): number => {
  const def = ctx.marketGoods.get(key)
  if (!def) return 0
  const tier = def.poolTarget && def.poolTarget > 0 ? (def.demandMultiplier ?? 1) : (def.demandMultiplier ?? 0.6)
  return def.basePrice * tier
}
const rates: Array<{ mineral: string; isk: number }> = []
for (const mineralId of ['min-tritanium', 'min-pyerite', 'min-mexallon', 'min-nocxium', 'min-isotope', 'min-starcore', 'min-darkiron']) {
  let best = 0
  for (const belt of ctx.belts.values()) {
    const def = ctx.items.get(belt.oreId)
    for (const row of def?.refine ?? []) if (row.mineralId === mineralId && row.perOre > best) best = row.perOre
  }
  rates.push({ mineral: mineralId, isk: orePerHour * best * priceOf(mineralId) })
}
rates.sort((a, b) => b.isk - a.isk)
const best = rates[0]!
const worst = rates.at(-1)!
/** 小时 → 可读时长 */
const h = (hr: number): string => (hr >= 24 ? `${(hr / 24).toFixed(1)} 天` : `${hr.toFixed(1)} 小时`)

const target = 1000 * 100_000_000 // 1000 亿 = 1e11
console.log(`6 条采矿线 = ${Math.round(orePerHour).toLocaleString('zh-CN')} 原矿/小时`)
console.log(`最赚：${best.mineral} ⇒ ${Math.round(best.isk).toLocaleString('zh-CN')} ISK/小时 · 最不赚：${worst.mineral} ⇒ ${Math.round(worst.isk).toLocaleString('zh-CN')} ISK/小时`)
console.log('\n「交易收入」链逐级耗时（税后累计信用点）')
for (let i = 0; i < CHAIN_TIERS.marketIncome!.length; i += 1) {
  const need = CHAIN_TIERS.marketIncome![i]!
  console.log(`  L${i + 1} ${need.toLocaleString('zh-CN')} ISK ⇒ 最赚 ${h(need / best.isk)} · 最不赚 ${h(need / worst.isk)}`)
}
console.log(`\n顶档 1,000 亿：按最赚 ${h(target / best.isk)}（${(target / best.isk / 24 / 365).toFixed(1)} 年）· 按最不赚 ${h(target / worst.isk)}（${(target / worst.isk / 24 / 365).toFixed(1)} 年）`)
console.log(`若后期产能 ×10（单船 500 单位/分）：按最赚 ${h(target / (best.isk * 10))}（${(target / (best.isk * 10) / 24 / 365).toFixed(2)} 年）`)
console.log('对照：市场池商品吸纳上限 ≈ 928,762,173 ISK/小时（要把所有商品都供上才够，实际做不到）')
}

/** ── 技能链训练时长读数 ── */
function sectionSkillsTime(): void {
const ctx = buildSimContext()
const s = createInitialState()
const all: number[] = []
for (const def of ctx.skills.values()) {
  for (let lv = 1; lv <= 5; lv += 1) all.push(skillLevelTimeMs(def, lv))
}
all.sort((a, b) => a - b)
const sum = (n: number): number => all.slice(0, n).reduce((a, b) => a + b, 0)
const hh = (ms: number): string => `${(ms / 3_600_000).toFixed(1)} 小时（${(ms / 3_600_000 / 24).toFixed(1)} 天）`
console.log(`技能表：${ctx.skills.size} 个技能 × 5 级 = 上限 ${all.length} 级`)
for (const n of [70, 104, 154, 228, 320, 338, 395]) {
  console.log(`  凑 ${n} 级 ⇒ 训练 ${hh(sum(n))}`)
}
console.log(`  （等级中位单级时长 ${(all[Math.floor(all.length / 2)]! / 60_000).toFixed(1)} 分钟；最贵单级 ${(all.at(-1)! / 3_600_000).toFixed(1)} 小时）`)
}
