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
  advanceGame,
  buyAtMarket,
  buyShip,
  countItem,
  createInitialState,
  enqueueSkill,
  fitModule,
  learnBlueprint,
  loadSaveFile,
  refineAllOre,
  sellAll,
  sellWareItem,
  serializeSaveFile,
  setMiningAutoCycle,
  startManufacturing,
  startMining,
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
  finalShip: string
  milestones: string[]
  snapshots: Snapshot[]
}

/** 通用策略控制器：继承方实现"货舱满了怎么办" */
interface Strategy {
  name: string
  desc: string
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
    finalShip: '',
    milestones: [],
    snapshots: [],
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

    // 采矿停了（满舱自动停/异常）→ 处理货舱并重启
    if (!state.mining.active) {
      strategy.onMiningStopped(state, ctx, result)
      startMining(state, BELT, ctx)
    }

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
  result.finalShip = shipName(state, ctx)
  return result
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
  desc: '练采矿技术 + 精炼学5 + 高级回收5；满舱精炼成矿物出售',
  planSkills(state, ctx) {
    queueToMax(state, ctx, 'mining')
    queueToMax(state, ctx, 'refining')
    queueToMax(state, ctx, 'reprocessing')
  },
  onMiningStopped(state, ctx, result) {
    // 精炼所有矿石再卖矿物（精炼学 5 级收率 90%）：矿物在物品仓库，用仓库卖出
    if (countItem(state, ORE_ID) > 0) refineAllOre(state, ORE_ID, ctx)
    for (const id of ['min-tritanium', 'min-pyerite']) {
      sellWareOf(state, ctx, id)
    }
    maybeBuyNextShip(state, ctx, result)
  },
}

/* ───────── 策略 C：装备流 ───────── */

/** 装备路线：MK1 采集器 → MK1 货舱 → 掘洞级 → MK1 炮台 → MK2 采集器 */
const GEAR_PLAN: Array<{ bp: string; module: string; label: string }> = [
  { bp: 'bp-miner-1', module: 'mod-miner-1', label: '强化采集器 MK1' },
  { bp: 'bp-cargo-1', module: 'mod-cargo-1', label: '货舱扩展 MK1' },
  { bp: 'bp-turret-1', module: 'mod-turret-1', label: '舰载轻型炮台 MK1' },
  { bp: 'bp-miner-2', module: 'mod-miner-2', label: '强化采集器 MK2' },
]

const strategyC: Strategy = {
  name: 'C · 装备流（精炼 + 自造装备）',
  desc: '练满采矿三技能 + 精炼双技能；按路线造并装配装备，再造掘洞级',
  planSkills(state, ctx) {
    queueToMax(state, ctx, 'mining')
    queueToMax(state, ctx, 'refining')
    queueToMax(state, ctx, 'reprocessing')
    queueToMax(state, ctx, 'mining-frigate')
  },
  onMiningStopped(state, ctx, result) {
    // 精炼并卖掉矿物
    if (countItem(state, ORE_ID) > 0) refineAllOre(state, ORE_ID, ctx)
    sellWareOf(state, ctx, 'min-tritanium')
    sellWareOf(state, ctx, 'min-pyerite')
    sellWareOf(state, ctx, 'min-mexallon')

    // 装备路线：市场购书学习 → 制造 → 装配
    for (const step of GEAR_PLAN) {
      if ((state.fleet[state.shipId]?.fitted.miner ?? null) === step.module || (state.fleet[state.shipId]?.fitted.cargo ?? null) === step.module || (state.fleet[state.shipId]?.fitted.turret ?? null) === step.module) {
        continue // 已装配
      }
      if (!state.learnedRecipes.includes(step.bp)) {
        if (!acquireBlueprint(state, ctx, step.bp)) continue // 市场没书/钱不够，下个周期再试
        result.milestones.push(`市场购书并学会：${step.label}`)
      }
      // 材料凑齐就开工制造（制造中的周期自然等待）
      const start = startManufacturing(state, step.bp, ctx)
      if (start.ok) {
        result.milestones.push(`开始制造：${step.label}`)
        return // 制造期间继续挖矿，装配等制造完成后在后续周期处理
      }
    }
    // 制造完成后装配；注意制造完成需要 advance 触发，在下一轮采矿停止点装配可能更晚——这里直接尝试装配
    for (const step of GEAR_PLAN) {
      const bay = state.moduleBay[step.module] ?? 0
      if (bay > 0) {
        const r = fitModule(state, step.module, ctx)
        if (r.ok) result.milestones.push(`装配：${step.label}`)
      }
    }
    maybeBuyNextShip(state, ctx, result)
  },
}

/* ───────── 买船辅助 ───────── */

function maybeBuyNextShip(state: GameState, ctx: SimContext, result: StrategyResult): void {
  // 只允许向更高档买：当前船 tier < 目标船 tier 才考虑（防止买完鲸吞又买回掘洞）
  const current = ctx.ships.get(state.shipId)
  const order = ['burrower', 'whale']
  for (const shipId of order) {
    const ship = ctx.ships.get(shipId)
    if (!ship) continue
    if (current && current.tier >= ship.tier) continue
    if (state.wallet.isk >= ship.priceIsk) {
      const r = buyShip(state, shipId, ctx)
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
    console.log(`  24 小时后：${fmtIsk(r.finalIsk)} ISK · 舰船：${r.finalShip}`)
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
