/**
 * 平衡体检：三种新手策略各自动挂机 24 小时，输出收入与里程碑对比。
 *
 * 运行：npm run balance
 *
 * 说明：这是给开发者的数值体检工具（不是游戏功能）——每次改完数值跑一遍，
 * 看"新手 24 小时能走多远"是否符合预期。模拟为 30 秒步长推进，忽略离线与远征。
 *
 * 三种策略（控制变量：都先练采矿技术 5 级）：
 *   A 原矿流：挖富凡晶石直接卖原矿，攒钱买掘洞级 → 鲸吞级
 *   B 精炼流：多练精炼学 + 高级回收，满舱后精炼成矿物再卖
 *   C 装备流：在 B 基础上再练采矿护卫舰，并制造装配 采集器MK1 → 货舱MK1 → 采集器MK2
 */
import {
  acquisitionFactorOf,
  advanceGame,
  buyAtMarket,
  buyShip,
  countItem,
  createInitialState,
  enqueueSkill,
  fitModule,
  isAtHome,
  learnBlueprint,
  loadSaveFile,
  marketGoodOf,
  refineRunActive,
  sellAll,
  sellWareItem,
  serializeSaveFile,
  setMiningAutoCycle,
  startManufacturing,
  startMining,
  startRefineRun,
  startTransitHome,
} from '@whale/core'
import type { GameState, SimContext } from '@whale/core'
import { buildSimContext } from '@whale/data'

/* ───────── 常量与公共状态 ───────── */

const SIM_HOURS = 24
const STEP_MS = 30_000 // 30 秒一步
const BELT = 'belt-fortune' // 富凡晶石矿带
const ORE_ID = 'ore-veldspar'
const HOUR_MS = 60 * 60 * 1000 // 1 小时的毫秒
const TOTAL_MS = SIM_HOURS * HOUR_MS

/** 记录一次快照 */
interface Snapshot {
  hour: number
  isk: number
  ship: string
}

/** 策略运行结果 */
interface StrategyResult {
  name: string
  desc: string
  finalIsk: number
  finalAssets: number
  finalShip: string
  milestones: string[]
  snapshots: Snapshot[]
  /** 时间分解（30s 步按主控作业状态归类；训练与采矿并行不单列；2026-09-08 二号 C 流分项） */
  time: { mining: number; travel: number; refine: number; build: number; other: number }
  /** 自造装备结存（排除开局自带件）：期末装备库件数 / 全船已装配件数；现货与收购变现口径价值 */
  gearBayN: number
  gearFitN: number
  gearSpot: number
  gearAcq: number
}

/** 通用策略控制器：继承方实现"货舱满了怎么办" */
interface Strategy {
  name: string
  desc: string
  /** 该策略是否依赖母港精炼炉（精炼流：满舱回港 → 开炉运转 → 再出航） */
  refineAtHome: boolean
  /** 开跑前排队要练的技能（训练与采矿并行） */
  planSkills(state: GameState, ctx: SimContext): void
  /** 每次采矿停止（含满舱）后回调：处理库存、买蓝图、制造、买船 */
  onMiningStopped(state: GameState, ctx: SimContext, result: StrategyResult): void
}

/* ───────── 模拟驱动器 ───────── */

/** 贸易双修变体：在策略技能队列尾部追加 会计学 + 贸易谈判学（各练到 5） */
function withTradeMaxed(strategy: Strategy): Strategy {
  return {
    ...strategy,
    name: `${strategy.name}（双修贸易）`,
    desc: `${strategy.desc}；额外把 会计学+贸易谈判学 练满（税 5%→1%）`,
    planSkills(state, ctx) {
      strategy.planSkills(state, ctx)
      queueToMax(state, ctx, 'accounting')
      queueToMax(state, ctx, 'trade-negotiation')
    },
    onMiningStopped(state, ctx, result) {
      strategy.onMiningStopped(state, ctx, result)
    },
  }
}

function runStrategy(strategy: Strategy): StrategyResult {
  const state = createInitialState({ seed: 2025 })
  const ctx = buildSimContext()
  const result: StrategyResult = {
    name: strategy.name,
    desc: strategy.desc,
    finalIsk: 0,
    finalAssets: 0,
    finalShip: '',
    milestones: [],
    snapshots: [],
    time: { mining: 0, travel: 0, refine: 0, build: 0, other: 0 },
    gearBayN: 0,
    gearFitN: 0,
    gearSpot: 0,
    gearAcq: 0,
  }

  // 开局自带装配/装备库件（教学件等）——装备结存统计时排除，只计"自造"件
  const initFitted = new Set<string>()
  for (const f of Object.values(state.fleet)) {
    if (!f) continue
    for (const rack of Object.values(f.fitted)) {
      const list = Array.isArray(rack) ? rack : rack ? [rack] : []
      for (const id of list) {
        if (typeof id === 'string' && id.length > 0) initFitted.add(id)
      }
    }
  }
  for (const id of Object.keys(state.moduleBay ?? {})) {
    if ((state.moduleBay[id] ?? 0) > 0) initFitted.add(id)
  }

  strategy.planSkills(state, ctx)
  // 模拟沿用"满舱即停，人工处理"的节奏（v7 的自动循环会把矿直接卸进仓库，两种模式都成立）
  setMiningAutoCycle(state, false)
  startMining(state, BELT, ctx)

  let simMs = 0
  let lastHourLog = 0
  while (simMs < TOTAL_MS) {
    advanceGame(state, STEP_MS, ctx)
    simMs += STEP_MS

    // 采矿停了（满舱自动停/异常）→ 处理库存；精炼流需先回港开炉运转，炼完再出航
    if (!state.mining.active) {
      strategy.onMiningStopped(state, ctx, result)
      if (strategy.refineAtHome) {
        if (!isAtHome(state) && !state.transit.active && !state.standby.active) {
          startTransitHome(state, ctx) // 满舱回母港
        } else if (isAtHome(state) && !state.transit.active && !refineRunActive(state)) {
          startMining(state, BELT, ctx) // 精炼炉已停/无料 → 再次出航
        }
      } else {
        startMining(state, BELT, ctx)
      }
    }

    // 时间分解（主控单作业互斥 → 单分类；AI 作业不属三种新手策略；分类按本步末状态近似）
    if (state.manufacturingRuns.some((r) => r.active)) result.time.build += STEP_MS
    else if (state.refineRuns.some((r) => r.active && r.worker === 'pilot')) result.time.refine += STEP_MS
    else if (state.mining.active) result.time.mining += STEP_MS
    else if (state.transit.active || state.awayGalaxy !== null) result.time.travel += STEP_MS
    else result.time.other += STEP_MS

    // 每小时快照
    if (simMs - lastHourLog >= HOUR_MS) {
      lastHourLog = simMs
      result.snapshots.push({
        hour: Math.round(simMs / HOUR_MS),
        isk: Math.floor(state.wallet.isk),
        ship: shipName(state, ctx),
      })
    }
  }

  // 收尾统计
  result.finalIsk = Math.floor(state.wallet.isk)
  result.finalAssets = Math.floor(wealthOf(state, ctx)) // 总资产口径：钱包 + 舰队/已装模块 + 仓库/书架折算
  result.finalShip = shipName(state, ctx)
  // 自造装备结存（2026-09-08 二号·C 流分项）：装备库 + 全船已装配，排除开局自带件；
  // 价值双口径 = 现货（自用/wealthOf 同源）与按收购档变现（acquisitionFactorOf）
  const modVal = (id: string): { base: number; acq: number } => {
    const g = marketGoodOf(ctx, 'module', id)
    const base = g?.basePrice ?? 0
    return { base, acq: g ? Math.round(base * acquisitionFactorOf(g)) : 0 }
  }
  for (const [id, u] of Object.entries(state.moduleBay ?? {})) {
    if (u <= 0 || initFitted.has(id)) continue
    const v = modVal(id)
    result.gearBayN += u
    result.gearSpot += v.base * u
    result.gearAcq += v.acq * u
  }
  for (const f of Object.values(state.fleet)) {
    if (!f) continue
    for (const rack of Object.values(f.fitted)) {
      const list = Array.isArray(rack) ? rack : rack ? [rack] : []
      for (const id of list) {
        if (typeof id !== 'string' || id.length === 0 || initFitted.has(id)) continue
        const v = modVal(id)
        result.gearFitN += 1
        result.gearSpot += v.base
        result.gearAcq += v.acq
      }
    }
  }
  return result
}

/**
 * 总资产估算（甲案·2026-09-05）：把"非现金产出"折回市场常驻 base 价，避免只比钱包——
 * 精炼/装备流的矿物、自造件、书架书都是资产。口径 = 现值（可再卖）而非成本，三策略同源可比。
 */
function wealthOf(state: GameState, ctx: SimContext): number {
  let v = state.wallet.isk
  const valItem = (id: string, u: number): number => {
    const g = marketGoodOf(ctx, 'item', id)
    const b = g?.basePrice ?? ctx.items.get(id)?.baseSellPriceIsk ?? 0
    return b * u
  }
  // 仓库物品（原矿/矿物/弹药等）
  for (const [id, u] of Object.entries(state.warehouse.items ?? {})) v += valItem(id, u)
  // 装备库（自造未装/备用件）
  for (const [id, u] of Object.entries(state.moduleBay ?? {})) v += (marketGoodOf(ctx, 'module', id)?.basePrice ?? 0) * u
  // 蓝图书架（重复/未学书仍可卖）
  for (const [id, n] of Object.entries(state.blueprintStock ?? {})) {
    if (n > 0) v += (marketGoodOf(ctx, 'blueprint', id)?.basePrice ?? 0) * n
  }
  // 全舰队：船（按市场常驻 base/priceIsk）+ 货仓 + 已装模块
  for (const f of Object.values(state.fleet)) {
    if (!f) continue
    if (f.defId) {
      const bp = marketGoodOf(ctx, 'ship', f.defId)?.basePrice ?? ctx.ships.get(f.defId)?.priceIsk ?? 0
      v += bp
    }
    for (const [id, u] of Object.entries(f.cargo ?? {})) v += valItem(id, u)
    for (const rack of Object.values(f.fitted)) {
      const list = Array.isArray(rack) ? rack : rack ? [rack] : []
      for (const id of list) {
        if (typeof id === 'string' && id.length > 0) v += marketGoodOf(ctx, 'module', id)?.basePrice ?? 0
      }
    }
  }
  return v
}

function shipName(state: GameState, ctx: SimContext): string {
  const def = ctx.ships.get(state.shipId)
  return def ? def.name : state.shipId
}

/** 卖空某种物品（返回入账） */
function sellAllOf(state: GameState, ctx: SimContext, itemId: string): number {
  const r = sellAll(state, itemId, ctx)
  return r.ok ? r.gainedIsk : 0
}

/** 卖空仓库里的物品 */
function sellWareOf(state: GameState, ctx: SimContext, itemId: string): number {
  const r = sellWareItem(state, itemId, ctx)
  return r.ok ? r.gainedIsk : 0
}

/** 训练某技能到 5 级（排进队列，不会打断已排训练） */
function queueToMax(state: GameState, ctx: SimContext, skillId: string): void {
  const trained = state.skills.trained[skillId] ?? 0
  if (trained < 5) enqueueSkill(state, skillId, 5, ctx.skills)
}

/** V9 获取蓝图：市场现货买入蓝图书并学习（市场目录里蓝图 key == 蓝图 id） */
function acquireBlueprint(state: GameState, ctx: SimContext, blueprintId: string): boolean {
  if (state.learnedRecipes.includes(blueprintId)) return true
  const res = buyAtMarket(state, ctx, blueprintId, 1)
  if (res.bought > 0) {
    const learn = learnBlueprint(state, ctx, blueprintId)
    return learn.ok
  }
  return false // 市场簿上暂时没书，下个周期再来
}

/* ───────── 策略 A：原矿流 ───────── */

const strategyA: Strategy = {
  name: 'A · 原矿流（卖原矿攒船）',
  desc: '只练采矿技术；满舱直接把富凡晶石卖给空间站',
  refineAtHome: false,
  planSkills(state, ctx) {
    queueToMax(state, ctx, 'mining')
  },
  onMiningStopped(state, ctx, result) {
    sellAllOf(state, ctx, ORE_ID)
    maybeBuyNextShip(state, ctx, result)
  },
}

/* ───────── 策略 B：精炼流 ───────── */

const strategyB: Strategy = {
  name: 'B · 精炼流（炼矿再卖）',
  desc: '练采矿技术 + 精炼学5 + 高级回收5；满舱回港运转精炼炉（自动续批至料尽）再卖矿物',
  refineAtHome: true,
  planSkills(state, ctx) {
    queueToMax(state, ctx, 'mining')
    queueToMax(state, ctx, 'refining')
    queueToMax(state, ctx, 'reprocessing')
  },
  onMiningStopped(state, ctx, result) {
    // 回港后启动精炼炉（锁定全库存循环运转；引擎每步自动推进到料尽），矿物卖掉
    if (isAtHome(state) && countItem(state, ORE_ID) > 0 && !refineRunActive(state)) {
      startRefineRun(state, ORE_ID, 'pilot', ctx)
    }
    for (const id of ['min-tritanium', 'min-pyerite']) {
      sellWareOf(state, ctx, id)
    }
    maybeBuyNextShip(state, ctx, result)
  },
}

/* ───────── 策略 C：装备流 ───────── */

/** 装备路线（2026-09-08 二号修正：富凡带精炼只产 三钛/类银，含超噬的装备需换矿带——
 * 单带策略只走富凡可实现子集，其余留待多矿带扩展）；成品自装（矿枪提速 = 长期回报） */
const GEAR_PLAN: Array<{ bp: string; module: string; label: string }> = [
  { bp: 'bp-miner-1', module: 'mod-miner-1', label: '强化采集器 MK1' },
]

const strategyC: Strategy = {
  name: 'C · 装备流（精炼 + 自造装备）',
  desc: '练满采矿三技能 + 精炼双技能；满舱回港运转精炼炉；囤料自造强化采集器 MK1 并装配，再造掘洞级',
  refineAtHome: true,
  planSkills(state, ctx) {
    queueToMax(state, ctx, 'mining')
    queueToMax(state, ctx, 'refining')
    queueToMax(state, ctx, 'reprocessing')
    queueToMax(state, ctx, 'mining-frigate')
  },
  onMiningStopped(state, ctx, result) {
    // 先尝试装配已入库的自造件
    for (const step of GEAR_PLAN) {
      const bay = state.moduleBay[step.module] ?? 0
      if (bay > 0) {
        const r = fitModule(state, step.module, ctx)
        if (r.ok) result.milestones.push(`装配：${step.label}`)
      }
    }
    const fittedNow = (m: string): boolean => {
      const f = state.fleet[state.shipId]?.fitted ?? {}
      return Object.values(f).some((rack) => (Array.isArray(rack) ? rack : rack ? [rack] : []).includes(m))
    }
    const gearDone = GEAR_PLAN.every((step) => fittedNow(step.module))

    if (!gearDone) {
      // 回港窗口（2026-09-08 二号修正：劳动者制下炉连轴转会挤掉制造窗口、矿物"炼出即卖"会让
      // 材料永远凑不齐——真实玩家先囤料、在炉停的窗口开造，故：可造 → 造；不可造 → 继续炼不卖）
      for (const step of GEAR_PLAN) {
        if (fittedNow(step.module)) continue
        if (!state.learnedRecipes.includes(step.bp)) {
          if (!acquireBlueprint(state, ctx, step.bp)) break // 市场没书/钱不够，下个周期再试
          result.milestones.push(`市场购书并学会：${step.label}`)
        }
        const start = startManufacturing(state, step.bp, 'pilot', ctx)
        if (start.ok) {
          result.milestones.push(`开始制造：${step.label}`)
          return // 制造占回港窗口：完成前不炼不卖（制造结束自动恢复出航）
        }
        break // 材料不足：本次回港窗口不制造
      }
      // 囤料：把矿石炼成矿物但**不卖**（三钛/类银攒给矿枪）
      if (isAtHome(state) && countItem(state, ORE_ID) > 0 && !refineRunActive(state)) {
        startRefineRun(state, ORE_ID, 'pilot', ctx)
      }
      return
    }

    // 装备路线完成 → 恢复精炼卖矿模式（与 B 同）
    if (isAtHome(state) && countItem(state, ORE_ID) > 0 && !refineRunActive(state)) {
      startRefineRun(state, ORE_ID, 'pilot', ctx)
    }
    sellWareOf(state, ctx, 'min-tritanium')
    sellWareOf(state, ctx, 'min-pyerite')
    sellWareOf(state, ctx, 'min-mexallon')
    maybeBuyNextShip(state, ctx, result)
  },
}

/* ───────── 买船辅助 ───────── */

function maybeBuyNextShip(state: GameState, ctx: SimContext, result: StrategyResult): void {
  // 只允许沿升级梯子向前买（防止买完鲸吞又买回掘洞）。
  // 2026-09-09 修正：舰船尺寸分级后沙猫/掘洞同为 T1，原"目标 tier > 当前 tier"门槛
  // 会永久卡死 12 万换掘洞的必经升级（A 流 24h 钱包卡在 89 万 < 鲸吞 90 万 → 伪影性崩盘），
  // 改为按梯子内位置比较（梯子外的当前船视作位置 -1；等价于"当前价位 < 目标价位"，
  // 同 tier 高价位船可正常购买）。
  const order = ['burrower', 'whale']
  const currentIdx = order.indexOf(state.shipId) // 不在梯子内 = -1
  for (let i = 0; i < order.length; i++) {
    if (i <= currentIdx) continue
    const ship = ctx.ships.get(order[i])
    if (!ship) continue
    if (state.wallet.isk >= ship.priceIsk) {
      const r = buyShip(state, order[i], ctx)
      if (r.ok) {
        result.milestones.push(`买船：${ship.name}（${ship.priceIsk.toLocaleString('zh-CN')} ISK）`)
        return // 一次只买一艘
      }
    }
  }
}

/* ───────── 主流程 ───────── */

function fmtIsk(n: number): string {
  return n.toLocaleString('zh-CN')
}

function report(results: StrategyResult[]): void {
  console.log('')
  console.log('═'.repeat(64))
  console.log('  平衡体检：新手策略 × 24 小时挂机对比（模拟步长 30 秒，无离线/远征）')
  console.log('═'.repeat(64))
  for (const r of results) {
    console.log('')
    console.log(`■ ${r.name} —— ${r.desc}`)
    console.log(`  24 小时后：${fmtIsk(r.finalIsk)} ISK（钱包） · 总资产 ${fmtIsk(r.finalAssets)} ISK · 舰船：${r.finalShip}`)
    const t = r.time
    const totalT = Math.max(1, t.mining + t.travel + t.refine + t.build + t.other)
    const pct = (n: number): string => `${Math.round((n / totalT) * 100)}%`
    const hms = (n: number): string => `${Math.round(n / 3_600_000)}h`
    console.log(
      `  时间分解：采矿 ${hms(t.mining)}(${pct(t.mining)}) · 回航/机动 ${hms(t.travel)}(${pct(t.travel)}) · 精炼炉 ${hms(t.refine)}(${pct(t.refine)}) · 制造 ${hms(t.build)}(${pct(t.build)}) · 空闲 ${hms(t.other)}(${pct(t.other)})`,
    )
    if (r.gearSpot > 0) {
      console.log(
        `  自造装备结存：装备库 ${r.gearBayN} 件 + 已装配 ${r.gearFitN} 件 = 现货 ${fmtIsk(r.gearSpot)} ISK；按空间站收购档变现 ≈${fmtIsk(r.gearAcq)} ISK（折价 ${fmtIsk(r.gearSpot - r.gearAcq)}——装备自用/装配则无此折价损失）`,
      )
    }
    if (r.milestones.length > 0) {
      console.log('  里程碑：' + r.milestones.join(' → '))
    }
  }
  // 每小时 ISK 曲线（对齐表）
  console.log('')
  console.log('每小时末的 ISK（单位：千）')
  const pad = (s: string, w: number): string => s.padStart(w)
  const headers = ['小时', ...results.map((r) => r.name.split('（')[0]!.split(' · ')[0]!)]
  console.log('  ' + headers.map((h, i) => pad(h, i === 0 ? 6 : 22)).join(''))
  for (let h = 1; h <= SIM_HOURS; h++) {
    const row = [String(h)]
    for (const r of results) {
      const snap = r.snapshots.find((s) => s.hour === h)
      row.push(`${Math.floor((snap?.isk ?? 0) / 1000)}k`)
    }
    console.log('  ' + row.map((c, i) => pad(c, i === 0 ? 6 : 22)).join(''))
  }
  console.log('')
  console.log('注：数字用于数值体检，不代表真实玩家水平（真实游戏含远征/离线/手动决策）。')
}

function main(): void {
  // 预热：确认真实内容数据可加载（加载即报错可被发现）
  const ctx = buildSimContext()
  console.log(`内容体检：技能 ${ctx.skills.size} · 星系 ${ctx.galaxies.size} · 悬赏 ${ctx.anomalies.size} · 装备 ${ctx.modules.size} · 蓝图 ${ctx.blueprints.size}`)
  // 存档兼容快速自检
  const st = createInitialState({ seed: 1 })
  const text = serializeSaveFile(st)
  const back = loadSaveFile(text)
  if (back.state.version !== st.version) throw new Error('存档往返自检失败')

  const results = [
    runStrategy(strategyA),
    runStrategy(strategyB),
    runStrategy(strategyC),
    runStrategy(withTradeMaxed(strategyA)),
    runStrategy(withTradeMaxed(strategyB)),
    runStrategy(withTradeMaxed(strategyC)),
  ]
  report(results)
}

main()
