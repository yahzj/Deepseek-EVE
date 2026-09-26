/**
 * **虫洞 · 自动探索**（船长 2026-09-14 逐条定案 · 确认稿 §六 · 批次 3）。
 *
 * 船长原话（照抄）：
 * 「并且'扫描虫洞'界面内允许玩家自动配置舰队探索虫洞（占据4个副船AI）。自动探索需要较长时间，
 *  且收益不确定，并且也会承受严重损失，但是不会丢船。」→「自动探索时间缩短至5分钟。其他没问题了。」
 * 追加四答（2026-09-14 晚）：「收益进仓库」·「按'手动一趟的期望 × 40%'」·「损伤口径两项都报」·
 * 「结算通讯消息的载体采用日志+需要确认的报告（显示在扫描虫洞页面里）。允许出现虫洞字样。」
 *
 * 口径：
 * - **每处虫洞一个「自动探索」**：界面**自动配置**参与舰（最多 4 条非主控船，可手动改）；不满 4 条也能跑。
 * - **每条参与舰各占 1 枚 AI 核心**（与副船 AI 任务**同一本账**，见 `ai.ts` 的 `aiCoreShipUsed`）。
 * - **时长 = 5 分钟**；按 `state.gameMs` 推进 ⇒ **离线照算**（与 AI 副船任务同口径）。
 * - **完成后停止**（不自动接下一个）：参与舰与 AI 名额届时释放，**该处虫洞被消耗**。
 * - **产出 = 手动一趟的期望 × 40%**（不保底），**直入站内仓库**（不占货舱、不会"装不下"）。
 * - **损伤**：每舰**结构 / 装甲各掷一次 −40%~−80%**，结构保底 `WORMHOLE_AUTO_HULL_FLOOR` ⇒ **绝不丢船**。
 * - **参与舰任务期间锁定**（驾驶/出击/别的 AI 任务全拒），返航解锁。
 * - **结算**：一条**日志** ＋ 一份**需要确认的报告**（显示在「扫描虫洞」页；船长：允许出现虫洞字样）。
 *
 * ⚠ 本模块**不碰** `wormholeEnter` 的副本状态机：自动探索是"抽象的一趟"（不建网格、不打战斗），
 * 产出按手动期望折算 —— 这是船长对"收益不确定 + 绝不丢船"的取舍，实现上必须与真副本解耦。
 */
import { tuningMul } from './tuning'
import type { GameState, WormholeArchetype, WormholeAutoReport, WormholeAutoRun, WormholeFamily, WormholeStockItem } from './state'
import { addLog, shipLockedInWormhole } from './state'
import type { SimContext } from './types'
import type { CommandResult } from './engine'
import { WORMHOLE_ORE_ITEM_ID, wormholeAdmission, wormholeBagSlotsOfFleet, wormholeScanBonusOf } from './wormhole'
import { matterTechLevel, matterTechNodes, matterTechWhBuffs, matterTechWorkEffBonus } from './matterTech'
import { RARE_WRECK_VOLUME_M3, rareWreckItemIdOf, wreckGroupOfCard, wreckItemIdOf } from './salvage'
import { WORMHOLE_WRECK_PILE_M3_BASE, wormholeRelicBoxIdOf, WORMHOLE_CORE_WEIGHTS } from './wormholeSalvage'
import { wormholeCardIdOfFamily, wormholeFamilyOfSeed, wormholeLayerRewardMul, wormholeLayerThreat } from './wormholeFoes'
import { WORMHOLE_ARCHETYPE_LABELS, wormholeArchetypeOf } from './wormholeGrid'
import { wormholeStockOf, wormholeStockTake } from './wormholeScan'
import { aiCoreCap, aiCoreIndustryUsed, aiCoreName, aiCoreShipUsed, gainAiCore, industryAiBonus } from './ai'
import { changeShip } from './shipyard'
import { shipBusyLabel } from './activity'
import { wormholeAutoDescend, type WormholeAutoPower } from './wormholeAutoSim'

/** 货舱**每格**折合多少 m³（自动探索的"装得下多少"用；量级与货舱页的格位口径一致） */
export const WORMHOLE_AUTO_HOLD_M3_PER_CELL = 50

/** 编队里装了几台某类作业件（高槽：采集器 / 打捞器）—— 决定"每动作回收几堆" */
function countFittedBySlot(state: GameState, ctx: SimContext, shipIds: readonly string[], kind: 'miner' | 'salvager'): number {
  let n = 0
  for (const id of shipIds) {
    const ship = state.fleet[id]
    for (const modId of ship?.fitted?.high ?? []) {
      if (!modId) continue
      const def = ctx.modules.get(modId)
      if (def?.slot !== 'turret') continue
      const marker = `${def.id} ${def.name ?? ''}`
      if (kind === 'miner' ? /miner|mine|采集/.test(marker) : /salvag|打捞/.test(marker)) n += 1
    }
  }
  return n
}

/**
 * 编队战力（**快速对判**用：只比"DPS × 有效血量"的期望，不逐帧跑战斗、不掷单发）。
 *
 * ⚠ **量纲必须与对手同尺**：对手用游戏真值 `wormholeLayerThreat(depth)`（层 1 = 45，每层 ×1.10）。
 * 本函数第一版写成 `20 + 14×层`（层 8 = 132，比真值 96 高一大截）⇒ 4×T1 的自动探索
 * **连层 2 的守卫都过不去**，卡在层 2 一辈子（读数：层深恒 2.0、一次"回合尽"都没有）。
 * 现在按"武装数 × 一个护卫档的威胁量级"给玩家侧读数，两边才算可比。
 */
function fleetPowerOf(state: GameState, ctx: SimContext, shipIds: readonly string[]): WormholeAutoPower {
  let guns = 0
  let ehp = 0
  for (const id of shipIds) {
    const ship = state.fleet[id]
    if (!ship) continue
    const def = ctx.ships.get(ship.defId ?? id)
    const tier = def?.tier ?? 1
    let own = 0
    for (const modId of ship.fitted?.high ?? []) {
      if (!modId) continue
      const slot = ctx.modules.get(modId)?.slot
      if (slot === 'turret' || slot === 'missile' || slot === 'laser' || slot === 'drone-rack' || slot === 'drone-tac') own += 1
    }
    guns += own
    ehp += tier * 10 * Math.max(0.1, ship.durability ?? 1)
  }
  // 一把武装 ≈ 8 点威胁量级（与 `wormholeLayerThreat` 的层 1 = 45 同一把尺：4×3 门 ≈ 96）
  return { dps: Math.max(1, guns * 8), ehp: Math.max(1, ehp) }
}

/**
 * 某层守卫的战力（快速对判的对手）：**直接用游戏真值** `wormholeLayerThreat(depth)`
 * （层 1 = 45，每层 ×1.10 ⇒ 层 9 ≈ 96）。
 */
function guardPowerOf(ctx: SimContext, family: WormholeFamily, depth: number): WormholeAutoPower {
  void ctx
  void family
  const threat = wormholeLayerThreat(depth)
  return { dps: threat, ehp: threat * 6 }
}

/** **一趟自动探索的时长**（船长：「自动探索时间缩短至5分钟」） */
export const WORMHOLE_AUTO_DURATION_MS = 5 * 60_000

/** **参与舰上限**（船长：「占据4个副船AI」⇒ 最多 4 条；不满也能跑）。
 * ⚠ 写成字面量而**不**在模块初始化时读 `WORMHOLE_MAX_SHIPS`：本模块与 `wormhole.ts` 之间存在
 * `activity → wormholeAuto → wormhole` 的模块环，初始化期读对方的常量会踩 TDZ（本仓有过先例）。 */
export const WORMHOLE_AUTO_MAX_SHIPS = 4

/**
 * **产出系数 = 手动一趟的期望 × 40%**（船长 2026-09-14：「按"手动一趟的期望 × 40%"」）。
 * 手动期望的来源（都在代码里，可复核）：
 * - **普通残骸堆**：墓场 `WORMHOLE_GRAVEYARD_COMMONS_MIN~MAX`(3~10，均值 6.5) ＋ 舰船信号 `WORMHOLE_SHIP_SPOIL_COMMONS`(2) ≈ **8.5 堆/趟**；
 * - **稀有残骸**：`tools/wormhole-econ.ts --runs=40` 实测 **≈1.25 件/趟**（专属装备的唯一来源）；
 * - **虚空母矿**：矿脉每格铺 1~3 堆（均值 **2 堆**）× `WORMHOLE_PILE_UNITS_BASE`(200) 单位；
 * - **遗迹安全货柜**：同一次实测 **≈0.23 件/趟**（层 2 起才出）。
 * 每堆的体积/数量仍走既有层收益曲线 `wormholeLayerRewardMul(depth)`，再乘 0.8~1.2 的确定性抖动。
 */
export const WORMHOLE_AUTO_YIELD_MUL = 0.4

/** 手动一趟的期望（= 上面注释里的四个数；改口径只改这里） */
export const WORMHOLE_AUTO_MANUAL = {
  /** 普通残骸堆数/趟 */
  commons: 8.5,
  /** 稀有残骸件数/趟（econ 实测） */
  rares: 1.25,
  /** 虚空母矿堆数/趟（矿脉 1~3 堆，均值 2） */
  orePiles: 2,
  /** 遗迹安全货柜件数/趟（econ 实测；层 2 起） */
  /** 遗迹安全货柜**命中率**（econ 实测；层 2 起。⚠ 2026-09-14 一号改名：原 `boxes` ⇒ `boxChance`） */
  boxChance: 0.23,
  /**
   * **AI 核心枚数/趟**（2026-09-14 船长新增遗迹掉落；同日第四答「自动探索也吃，按同口径折算
   * **4%/趟**」）。取 **0.10** = 「每趟 1 次遗迹打捞 × `WORMHOLE_CORE_SHARE`(10%)」——
   * 与船长批准的那条口径逐字对应；**层 1 起就出**（与货柜那条层 2 起不同）。
   *
   * ⚠ **实测复核（2026-09-14 晚 · `npm run wormhole:econ -- --runs=100`）：0.090 枚/趟**
   * （100 趟共 9 枚 —— 层 1 三趟、层 2 六趟）⇒ 与本处取值的 0.10 在抽样噪声内一致
   * （泊松 λ=0.1 时 100 趟的 σ≈0.03）⇒ **取值不动**。
   * 早前那版注释写"取不到样本"，是因为当时政策 20 趟里 0 次遗迹打捞（一号的「内容原型」批次
   * 落进 main 之后盘面遗迹格才稳定够用）——那条注记已作废。
   */
  cores: 0.1,
} as const

/** **结构保底**（绝不丢船：结构低于它就不再扣） */
export const WORMHOLE_AUTO_HULL_FLOOR = 0.1

/* ═══════════ 内容原型 → 自动探索的产出口味（丙 · 船长 2026-09-14：原型也影响自动探索） ═══════════ */

/**
 * 原型抽取权重（**与 `wormholeGrid.WORMHOLE_ARCHETYPE_WEIGHTS` 同值** —— `content:check` 有契约盯同值）。
 * ⚠ 这里写字面量而不是读那个常量：本模块与 `wormholeGrid` 之间存在模块环，初始化期读对方常量会踩 TDZ。
 */
export const WORMHOLE_AUTO_ARCHETYPE_WEIGHTS: Readonly<Record<WormholeArchetype, number>> = {
  balanced: 40,
  wreck: 20,
  ruins: 15,
  vein: 15,
  combat: 10,
}

/** 各原型的**原始口味倍数**（在四条产出线上重新分配；下面按抽取权重归一化回 ≈1 ⇒ 总期望不变） */
const ARCHETYPE_RAW: Readonly<Record<WormholeArchetype, { commons: number; rares: number; ore: number; box: number }>> = {
  balanced: { commons: 1, rares: 1, ore: 1, box: 1 },
  wreck: { commons: 1.6, rares: 1.1, ore: 0.8, box: 1 },
  ruins: { commons: 0.9, rares: 1.6, ore: 0.8, box: 2 },
  vein: { commons: 0.7, rares: 0.9, ore: 2.2, box: 0.8 },
  combat: { commons: 1.5, rares: 1.3, ore: 0.7, box: 0.9 },
}

/**
 * **归一化后的口味倍数**：按抽取权重求加权平均，再逐线除掉它 ⇒
 * 「同一条 40% 的期望线」不变，只是**在原型之间重新分配**（某原型多出的，别的原型少回去）。
 */
const ARCHETYPE_MUL: Readonly<Record<WormholeArchetype, { commons: number; rares: number; ore: number; box: number }>> = (() => {
  const keys: WormholeArchetype[] = ['balanced', 'wreck', 'ruins', 'vein', 'combat']
  const totalP = keys.reduce((s, k) => s + WORMHOLE_AUTO_ARCHETYPE_WEIGHTS[k], 0)
  const mean = { commons: 0, rares: 0, ore: 0, box: 0 }
  for (const k of keys) {
    const p = WORMHOLE_AUTO_ARCHETYPE_WEIGHTS[k] / totalP
    const m = ARCHETYPE_RAW[k]
    mean.commons += p * m.commons
    mean.rares += p * m.rares
    mean.ore += p * m.ore
    mean.box += p * m.box
  }
  const out = {} as Record<WormholeArchetype, { commons: number; rares: number; ore: number; box: number }>
  for (const k of keys) {
    const m = ARCHETYPE_RAW[k]
    out[k] = {
      commons: m.commons / mean.commons,
      rares: m.rares / mean.rares,
      ore: m.ore / mean.ore,
      box: m.box / mean.box,
    }
  }
  return out
})()

/** 某原型的产出口味倍数（界面/报告读数用） */
export function wormholeAutoArchetypeMul(archetype: WormholeArchetype): {
  commons: number
  rares: number
  ore: number
  box: number
} {
  return ARCHETYPE_MUL[archetype]
}

/** 损伤区间（船长：「结构/装甲大幅受损（−40%~−80% 随机）」） */
export const WORMHOLE_AUTO_DAMAGE_MIN = 0.4
export const WORMHOLE_AUTO_DAMAGE_MAX = 0.8

/** 报告保留条数（超出的丢最旧；避免随档无限增长） */
export const WORMHOLE_AUTO_REPORT_MAX = 20

/* ═══════════ 谜质科技 → 自动探索（船长 2026-09-19 四条裁定） ═══════════
 *
 * 船长原话（照抄）：「**自动探索不折扣，因为自动探索本身已经是产出\*0.4的情况了，那么过程就不应该折扣**」
 * ＋逐条：「**1，用实际回合。2，按「完成度 ⇒ 损伤最多减半」。3货仓接。AI核心吃。**」
 *
 * 每条科技都接到它在**手动**里的对应物上、**面值生效不再打折**：
 * - **时序锚定器**（最大回合 +10/级）⇒ 总量 ×`1 + 加成 ÷ 该队实际基础回合`
 *   （基础回合 = `wormholeAdmission(ctx, shipIds).turnBudget`，即**不含科技**的那一份——船长选"实际回合"）；
 * - **折叠货舱**（+4 格/级）⇒ 总量 ×`1 + 加成 ÷ 该队基础货仓格`（船长裁「货仓接」）；
 * - **引力吊臂 / 富集钻头**（各 +20%/级）⇒ 残骸线（普通残骸 / 稀有残骸 / 遗迹货柜 / AI 核心）×`1 + 打捞加成`、
 *   虚空母矿线 ×`1 + 采集加成`（船长裁「AI核心吃」⇒ 核心跟残骸线同系数）；
 * - **战斗线 14 节点** ⇒ 损伤 ×`1 − 50% × 战斗线完成度`（船长裁「按完成度 ⇒ 损伤最多减半」）；
 * - **不接**：谐振信号滤波阵列（管「扫描虫洞」的**间隔**——那是发现虫洞的活动，不是探索本身）、
 *   时间压缩矩阵（管洞内战斗的**播放**速度；也不动船长定的 5 分钟）、洞外工业三件（洞外生效）。
 *
 * ⚠ **只算科技那一份**：舰上打捞器/采集器的档位效率**不进**自动探索
 * （`matterTechWorkEffBonus` 而不是 `wormholeWorkEfficiencyOfFleet`）——自动探索的产出基准
 * `WORMHOLE_AUTO_MANUAL` 本来就不看编队装配，接档位效率等于顺手改了一条船长没裁的口径（已知边界，见工作文档）。
 *
 * ⚠ **一级未点 ⇒ 每个系数恒 1** ⇒ 未点科技的玩家读数与报告**一字不变**（用例钉住）。
 */
export interface WormholeAutoTechFactors {
  /** **总量系数**（回合 × 货仓；未点科技 = 1）——四条产出线一起乘 */
  total: number
  /** **残骸线系数**（总量 × 打捞效率加成；含普通残骸 / 稀有残骸 / 遗迹货柜 / AI 核心） */
  wreck: number
  /** **虚空母矿线系数**（总量 × 采集效率加成） */
  ore: number
  /** **损伤系数**（1 = 原区间；战斗线点满 = 0.5 ⇒ 损伤减半） */
  damage: number
  /** 细账（读数悬停与结算日志用）：回合系数 / 货仓系数 / 打捞加成 / 采集加成 / 战斗线完成度 */
  turnMul: number
  holdMul: number
  salvageEff: number
  collectEff: number
  battleProgress: number
  /** 本队**不含科技**的基础回合与基础货仓格（界面要写清"除以多少"） */
  baseTurns: number
  baseHold: number
}

/**
 * **算一趟自动探索吃到的科技系数**（纯函数；界面读数与结算**共用同一个函数** ⇒ 读数即实战）。
 * `shipIds` = 参与舰的**舰队实例 uid**（与 `wormholeAdmission` / `wormholeBagSlotsOfFleet` 同口径）。
 */
export function wormholeAutoTechFactors(
  state: GameState,
  ctx: SimContext,
  shipIds: readonly string[],
): WormholeAutoTechFactors {
  const tech = matterTechWhBuffs(state, ctx)
  /**
   * ⚠ **编队不成立（没选船 / 超重 / 含无法识别的船型 / 超艘数）⇒ 一律返回中性系数**：
   * 基础回合与基础货仓格都要拿编队去算，编队不成立时它们会退化成 0/1，
   * 于是"除以 1"会把系数放大成几十倍，读数就成了胡说（派队本来也会被 `wormholeAutoBlockReason` 拦下）。
   */
  const adm = wormholeAdmission(ctx, shipIds)
  const baseHold0 = adm.ok ? wormholeBagSlotsOfFleet(state, ctx, shipIds) : 0
  const neutral: WormholeAutoTechFactors = {
    total: 1,
    wreck: 1,
    ore: 1,
    damage: 1,
    turnMul: 1,
    holdMul: 1,
    salvageEff: 0,
    collectEff: 0,
    battleProgress: 0,
    baseTurns: Math.max(1, adm.turnBudget),
    baseHold: Math.max(1, baseHold0),
  }
  if (!adm.ok) return neutral
  /** 该队**不含科技**的基础回合（`wormholeAdmission` 缺省 `techTurnBonus = 0` ⇒ 拿到的就是基础那一份） */
  const baseTurns = Math.max(1, adm.turnBudget)
  /** 该队**不含科技**的基础货仓格（`wormholeBagSlotsOfFleet` 只算货仓 ⇒ 科技那 4 格/级不在内） */
  const baseHold = Math.max(1, baseHold0)
  const turnMul = 1 + tech.turnBonus / baseTurns
  const holdMul = 1 + tech.holdCells / baseHold
  const total = turnMul * holdMul
  const salvageEff = matterTechWorkEffBonus(state, ctx, 'salvage')
  const collectEff = matterTechWorkEffBonus(state, ctx, 'collect')
  /** 战斗线完成度 = 已点级数 ÷ 该线总级数（0~1；线内没有节点 ⇒ 0） */
  let got = 0
  let max = 0
  for (const node of matterTechNodes(ctx)) {
    if (node.branch !== 'battle') continue
    max += node.maxLevel
    got += Math.min(node.maxLevel, matterTechLevel(state, node.id))
  }
  const battleProgress = max > 0 ? got / max : 0
  return {
    total,
    wreck: total * (1 + salvageEff),
    ore: total * (1 + collectEff),
    damage: 1 - 0.5 * battleProgress,
    turnMul,
    holdMul,
    salvageEff,
    collectEff,
    battleProgress,
    baseTurns,
    baseHold,
  }
}

/** 这组系数是否"什么都没吃"（未点科技 ⇒ 界面不出现科技读数、日志不加那段） */
export function wormholeAutoTechIsNeutral(f: WormholeAutoTechFactors): boolean {
  return f.wreck === 1 && f.ore === 1 && f.damage === 1
}

/** 在跑的自动探索（老档没有 ⇒ 空数组） */
export function wormholeAutoRunsOf(state: GameState): WormholeAutoRun[] {
  return state.wormholeAuto ?? []
}

/** 报告队列（新的在前） */
export function wormholeAutoReportsOf(state: GameState): WormholeAutoReport[] {
  return state.wormholeAutoReports ?? []
}

/** **待确认的报告条数**（界面角标用） */
export function wormholeAutoUnconfirmedCount(state: GameState): number {
  return wormholeAutoReportsOf(state).filter((r) => !r.confirmed).length
}

/** 某舰是否正在自动探索（任务期间锁定） */
export function shipInWormholeAuto(state: GameState, shipId: string): boolean {
  return wormholeAutoRunsOf(state).some((r) => r.shipIds.includes(shipId))
}

/** 该处虫洞是否已在自动探索中 */
export function wormholeAutoRunOfStock(state: GameState, stockId: string): WormholeAutoRun | undefined {
  return wormholeAutoRunsOf(state).find((r) => r.stockId === stockId)
}

/* ═══════════ 一、参与舰的自动配置 ═══════════ */

/**
 * **能不能派这艘船**（自动配置与手动改选共用同一把尺）：null = 可以，否则给拒因。
 * 排除：主控船 · 在虫洞里的船 · 已在别的 AI 副船任务里 · 已在别的自动探索里 · 不在舰队里。
 *
 * `opts.mainMayJoin`（2026-09-14 船长裁定「**如果选择了主控船，就将主控换到其他船上**」）：
 * 为真 ⇒ **放行主控船**（调用方已先确认"能交接"：主控空闲且存在接任的新主控，
 * 见 `wormholeAutoMainHandover`）。
 */
export function wormholeAutoShipBlockReason(
  state: GameState,
  shipId: string,
  opts?: { mainMayJoin?: boolean },
): string | null {
  const ship = state.fleet[shipId]
  if (!ship) return '舰队里没有这艘船。'
  if (shipId === state.shipId && !opts?.mainMayJoin) return '主控船不参与自动探索（主控要留在站内）。'
  if (shipLockedInWormhole(state, shipId)) return '该舰在虫洞里：等它出洞再派。'
  if (state.aiAssignments[shipId]) return '该舰已在别的 AI 副船任务里：先撤回它。'
  if (shipInWormholeAuto(state, shipId)) return '该舰已在另一处虫洞的自动探索里。'
  return null
}

/** 一条候选（界面用）：船 id + 显示名 + 是否默认选中 + 不可选时的原因 */
export interface WormholeAutoCandidate {
  shipId: string
  /** 显示名（玩家起的名 > 船型名 > id） */
  name: string
  /** 自动配置是否默认选它 */
  picked: boolean
  /** 不可派的原因（null = 可派） */
  blocked: string | null
}

/**
 * **自动配置参与舰**（船长：「界面自动配置参与舰（按船型/装配挑最多 4 条非主控船，可手动改）」）。
 *
 * 排序口径（同分再按 id 稳定排序 ⇒ 同档可复现）：
 * ① **能打**：高槽里带武器的件数（炮台/导弹架/激光炮/无人机装置）多者优先；
 * ② **耐打**：`durability` 高者优先（刚修好的船先上）；
 * ③ **船型档位**（`tier`）高者优先。
 * 不可派的船**照旧列出**（界面置灰 + 显示原因）——玩家能看到"为什么它不能去"。
 */
/**
 * **自动配置的评分**（能打 → 耐打 → 船型档位；同分再按 id 稳定排序 ⇒ 同档可复现）。
 * 抽成单点：`wormholeAutoCandidates`（挑参与舰）与 `wormholeAutoMainHandover`（挑接任主控）共用同一把尺。
 */
function wormholeAutoScore(state: GameState, ctx: SimContext, shipId: string): number {
  const ship = state.fleet[shipId]!
  const def = ctx.ships.get(ship.defId ?? shipId)
  let guns = 0
  for (const id of ship.fitted?.high ?? []) {
    if (!id) continue
    const slot = ctx.modules.get(id)?.slot
    if (slot === 'turret' || slot === 'missile' || slot === 'laser' || slot === 'drone-rack' || slot === 'drone-tac') guns += 1
  }
  return guns * 100 + Math.round((ship.durability ?? 1) * 10) * 5 + (def?.tier ?? 1) * 3
}

export function wormholeAutoCandidates(state: GameState, ctx: SimContext, exclude?: readonly string[]): WormholeAutoCandidate[] {
  const skip = new Set(exclude ?? [])
  const rows: Array<{ shipId: string; name: string; score: number; blocked: string | null }> = []
  for (const shipId of Object.keys(state.fleet)) {
    if (skip.has(shipId)) continue
    const blocked = wormholeAutoShipBlockReason(state, shipId)
    rows.push({ shipId, name: shipNameOf(state, ctx, shipId), score: wormholeAutoScore(state, ctx, shipId), blocked })
  }
  rows.sort((a, b) => b.score - a.score || a.shipId.localeCompare(b.shipId))
  let picked = 0
  /**
   * 编队规模**不再受核心数限制**（2026-09-26 船长令「整队一趟只占 1 枚」）：
   * 占用是"每趟 1 枚"，与派几条船无关 ⇒ 这里只收口在参与舰上限上。
   * 改前是 `min(4, 当前可派核心数)` ⇒ **只有 1 枚核心时只能派 1 条**（明明允许 4 条），
   * 一趟收益跟着掉到 1/4 ——"核心少"被错误地转嫁成了"队伍小"。
   */
  const budget = WORMHOLE_AUTO_MAX_SHIPS
  return rows.map((r) => {
    const ok = r.blocked === null && picked < budget
    if (ok) picked += 1
    return { shipId: r.shipId, name: r.name, picked: ok, blocked: r.blocked }
  })
}

/**
 * **当前可派的核心数** = 共用上限 − 副船/自动探索已占 −（站内工业超出「工业自动化」扩容的部分）。
 * ⚠ 自动探索那部分按 **每趟 1 枚** 计（见 `ai.ts` 的 `aiCoreShipUsed`）。
 * **编队规模不再按它收口**（2026-09-26 船长令：整队一趟只占 1 枚）——本函数现在只用于
 * "还能不能再开一趟"的读数与守卫。
 */
export function wormholeAutoFreeCores(state: GameState, ctx: SimContext): number {
  const cap = aiCoreCap(state, ctx)
  const indOnShared = Math.max(0, aiCoreIndustryUsed(state) - industryAiBonus(state, ctx))
  return Math.max(0, cap - aiCoreShipUsed(state) - indOnShared)
}

/** 自动配置的默认参与舰（最多 4 条，且不超过当前可派的核心数） */
export function wormholeAutoDefaultShips(state: GameState, ctx: SimContext): string[] {
  return wormholeAutoCandidates(state, ctx)
    .filter((c) => c.picked)
    .map((c) => c.shipId)
}

/** 名称（日志/报告用；没起名就用船型名，再取不到就用 id） */
export function shipNameOf(state: GameState, ctx: SimContext, shipId: string): string {
  const ship = state.fleet[shipId]
  if (!ship) return shipId
  return ship.customName ?? ctx.ships.get(ship.defId ?? shipId)?.name ?? shipId
}

/* ═══════════ 二、AI 核心账（与副船任务共用） ═══════════ */

/**
 * **AI 核心够不够**（自动探索要占 `need` 枚）：null = 够，否则给拒因。
 *
 * ⚠ **口径 2026-09-26 改**（船长令「整队一趟只占 1 枚」）：`need` 现在恒为 **1**（一趟一枚），
 * 与派几条船无关。改前 `need = 队伍条数`，于是"核心剩 2 枚"会拒绝 4 条编队。
 * 站内工业先抵「工业自动化」扩容、超出的部分才挤共同名额 —— 这一段与 `ai.ts` 同源，未变。
 */
export function wormholeAutoCoreBlock(state: GameState, ctx: SimContext, need: number): string | null {
  const cap = aiCoreCap(state, ctx)
  if (cap <= 0) {
    return 'AI 核心上限为 0：先训练提升 AI 核心上限的技能（如「AI 核心操作学」）——自动探索每次占用 1 枚核心。'
  }
  const indOnShared = Math.max(0, aiCoreIndustryUsed(state) - industryAiBonus(state, ctx))
  const shipUsed = aiCoreShipUsed(state)
  const free = cap - shipUsed - indOnShared
  if (free < need) {
    return `AI 核心不够：自动探索每次占用 ${need} 枚，当前只剩 ${Math.max(0, free)} 枚可派（上限 ${cap}：副船与自动探索 ${shipUsed} 枚 + 站内工业超出扩容 ${indOnShared} 枚）。先撤回一些副船任务、自动探索或站内炉线。`
  }
  return null
}

/* ═══════════ 三、开始 / 中止 ═══════════ */

/**
 * **能不能开自动探索**（界面按钮的置灰理由；也是命令层的守卫）：null = 可以。
 * 船长口径里**没有**"主控必须空闲"的限制 —— 自动探索吃的是**副船 + AI 名额**，
 * 主控在扫描/远征期间照旧可以派队。
 */
export function wormholeAutoBlockReason(
  state: GameState,
  ctx: SimContext,
  stockId: string,
  shipIds?: readonly string[],
  opts?: { mainMayJoin?: boolean },
): string | null {
  // 先看"是不是已经派出去了"：开始时库存项即被消耗 ⇒ 先查在跑的趟，理由才说得清
  if (wormholeAutoRunOfStock(state, stockId)) return '这一处已经在自动探索中。'
  const item = wormholeStockOf(state).find((x) => x.id === stockId)
  if (!item) return '这处虫洞不在了（可能已经探索过）。'
  const pool = shipIds ?? wormholeAutoDefaultShips(state, ctx)
  if (pool.length === 0) return '没有可派出的副船：自动探索不派主控船，先备至少 1 条空闲副船。'
  if (pool.length > WORMHOLE_AUTO_MAX_SHIPS) return `参与舰最多 ${WORMHOLE_AUTO_MAX_SHIPS} 条。`
  for (const shipId of pool) {
    const blocked = wormholeAutoShipBlockReason(state, shipId, opts)
    if (blocked) return `${shipNameOf(state, ctx, shipId)}：${blocked}`
  }
  return wormholeAutoCoreBlock(state, ctx, 1)
}

/**
 * **主控交接**（船长 2026-09-14：「**如果选择了主控船，就将主控换到其他船上。**」）。
 *
 * 口径：
 * - 队里**没有**主控 ⇒ `needed: false`（什么也不做）；
 * - 队里有主控 ⇒ **先看主控忙不忙**：船长裁定「**忙时直接不允许**」（不走"采矿中换驾驶 = 旧船返航"
 *   那条善后链）⇒ 主控手上有活/在洞里一律给 `reason`；
 * - 接任的新主控 = **不在本队、不在别的 AI 任务/虫洞里、空闲**的船里，按自动配置同一套评分
 *   （能打 → 耐打 → 船型档位）挑最好的一条；一条都没有 ⇒ 给 `reason`。
 *
 * 界面据此写确认弹窗（「主控将由 X 换到 Y」）并把卡片置灰；命令层照它落（真正换船走 `changeShip`）。
 */
export interface WormholeAutoHandover {
  /** 队里有没有主控（有 ⇒ 需要交接） */
  needed: boolean
  /** 接任的新主控（`needed` 且没有 `reason` 时才有值） */
  toId?: string
  toName?: string
  /** 不能交接的原因（`needed` 时才有值） */
  reason?: string
}

export function wormholeAutoMainHandover(
  state: GameState,
  ctx: SimContext,
  teamShipIds: readonly string[],
): WormholeAutoHandover {
  const team = new Set(teamShipIds)
  if (!team.has(state.shipId)) return { needed: false }
  const busy = shipBusyLabel(state, ctx, state.shipId)
  if (busy) return { needed: true, reason: `主控正在${busy}：先把手上的活收工，才能把它编进自动探索队。` }
  if (shipLockedInWormhole(state, state.shipId)) return { needed: true, reason: '主控正在虫洞里：先出洞。' }
  const pool = Object.keys(state.fleet)
    .filter((id) => id !== state.shipId && !team.has(id))
    .filter((id) => shipBusyLabel(state, ctx, id) === null)
    .filter((id) => wormholeAutoShipBlockReason(state, id) === null)
    .sort((a, b) => wormholeAutoScore(state, ctx, b) - wormholeAutoScore(state, ctx, a) || a.localeCompare(b))
  const toId = pool[0]
  if (!toId) return { needed: true, reason: '舰队里没有别的空闲船可以接任主控：先收工或添一条船，再把它编进来。' }
  return { needed: true, toId, toName: shipNameOf(state, ctx, toId) }
}

/**
 * **开始自动探索**（一处虫洞一趟；不满 4 条也能跑）。
 * 成功 ⇒ **消耗该处库存**、按参与舰数占 AI 名额、参与舰锁定到返航。
 *
 * ⚠ **主控在队里**（船长 2026-09-14：「如果选择了主控船，就将主控换到其他船上」）：先按
 * `wormholeAutoMainHandover` 读一次口径（主控忙/在洞里/没有接任船 ⇒ 直接拒绝），
 * 校验放行主控（`mainMayJoin`）通过后**真正换船走 `changeShip`**（守卫/日志/善后单一出处），
 * 再照常派队 —— 于是主控船以"普通副船"的身份随队出发。
 */
export function wormholeAutoStart(state: GameState, ctx: SimContext, stockId: string, shipIds?: readonly string[]): CommandResult {
  const pool = shipIds ?? wormholeAutoDefaultShips(state, ctx)
  const handover = wormholeAutoMainHandover(state, ctx, pool)
  if (handover.needed && handover.reason) return { ok: false, error: handover.reason }
  const blocked = wormholeAutoBlockReason(state, ctx, stockId, shipIds, { mainMayJoin: handover.needed })
  if (blocked) return { ok: false, error: blocked }
  /** 交接：换船在**校验之后**才落（校验不过就一行状态都不动） */
  if (handover.needed && handover.toId) {
    const sw = changeShip(state, handover.toId, ctx)
    if (!sw.ok) return sw
  }
  const item = wormholeStockOf(state).find((x) => x.id === stockId)!
  const picked = [...(shipIds ?? wormholeAutoDefaultShips(state, ctx))]
  wormholeStockTake(state, stockId)
  const run: WormholeAutoRun = {
    id: `wha-${state.gameMs.toString(36)}-${wormholeAutoRunsOf(state).length.toString(36)}`,
    stockId,
    seed: item.seed,
    depth: Math.max(1, Math.min(9, item.depth)),
    /**
     * 丙/丁（2026-09-14）：把该处的**内容原型 + 敌族**带进这趟自动探索 ——
     * 产出池与"它真进去打"时同族，口味按原型重新分配（总期望仍是那条 40% 线）。
     */
    archetype: item.archetype ?? wormholeArchetypeOf(item.seed),
    family: item.family ?? wormholeFamilyOfSeed(item.seed),
    shipIds: picked,
    startedAtGameMs: state.gameMs,
    finishAtGameMs: state.gameMs + WORMHOLE_AUTO_DURATION_MS,
  }
  state.wormholeAuto = [...wormholeAutoRunsOf(state), run]
  addLog(
    state,
    'fleet',
    `🛰 自动探索队出发：${WORMHOLE_ARCHETYPE_LABELS[wormholeRunMeta(run).archetype]} · ${picked.length} 条舰（${picked.map((id) => shipNameOf(state, ctx, id)).join('、')}）` +
      `——约 ${Math.round(WORMHOLE_AUTO_DURATION_MS / 60_000)} 分钟后返航（每次自动探索占 1 枚 AI 核心）。`,
  )
  return { ok: true }
}

/** 一趟（或一处）的原型与族：字段缺省一律按 `seed` 现算 ⇒ 老档与新建同口径 */
export function wormholeRunMeta(run: { seed: number; archetype?: WormholeArchetype; family?: import('./state').WormholeFamily }): {
  archetype: WormholeArchetype
  family: WormholeFamily
} {
  return {
    archetype: run.archetype ?? wormholeArchetypeOf(run.seed),
    family: run.family ?? wormholeFamilyOfSeed(run.seed),
  }
}

/**
 * **中止**一趟自动探索（无收益、无损伤；参与舰与 AI 名额当场释放）。
 * ⚠ **该处虫洞不退还**（队伍已经进去了）——界面在按钮旁写明这条。
 */
export function wormholeAutoStop(state: GameState, runId: string): CommandResult {
  const runs = wormholeAutoRunsOf(state)
  const run = runs.find((r) => r.id === runId)
  if (!run) return { ok: false, error: '这一趟自动探索已经结束了。', errorId: 'core.wormholeAuto.001' }
  state.wormholeAuto = runs.filter((r) => r.id !== runId)
  addLog(state, 'fleet', '🛰 自动探索队已召回：没有收益、也没有损伤；那条通道就此关闭。')
  return { ok: true }
}

/** 按参与舰 id 中止（活动栏那一行用） */
export function wormholeAutoStopByShip(state: GameState, shipId: string): CommandResult {
  const run = wormholeAutoRunsOf(state).find((r) => r.shipIds.includes(shipId))
  if (!run) return { ok: false, error: '这一趟自动探索已经结束了。', errorId: 'core.wormholeAuto.001' }
  return wormholeAutoStop(state, run.id)
}

/* ═══════════ 四、推进与结算 ═══════════ */

/** 确定性随机流（同 `(seed, salt)` 必得同结果；与 `wormholeScan` 同一套写法） */
function autoRng(seed: number, salt: number): () => number {
  let count = 0
  return () => {
    count += 1
    let x = (seed + (salt + count) * 2654435761) >>> 0
    x ^= x << 13
    x >>>= 0
    x ^= x >> 17
    x ^= x << 5
    x >>>= 0
    return x / 4294967296
  }
}

/** 报告 id 序号（同一毫秒内多趟也只增不减） */
let reportSeq = 0

/**
 * **推进自动探索**（`advanceGame` 每拍调）：到点即结算。
 * 离线大步长同样适用（`state.gameMs` 一次跨过 finishAt ⇒ 当拍结算，收益与在线一致）。
 */
export function advanceWormholeAuto(state: GameState, ctx: SimContext): void {
  const runs = wormholeAutoRunsOf(state)
  if (runs.length === 0) return
  const due = runs.filter((r) => state.gameMs >= r.finishAtGameMs)
  if (due.length === 0) return
  const dueIds = new Set(due.map((r) => r.id))
  // 先出队（AI 名额当场释放），再结算
  state.wormholeAuto = runs.filter((r) => !dueIds.has(r.id))
  for (const run of due) settleRun(state, ctx, run)
}

/** 结算一趟：算收益（手动期望 × 40%）、掷损伤、入仓库、出报告 + 日志 */
function settleRun(state: GameState, ctx: SimContext, run: WormholeAutoRun): void {
  const rng = autoRng(run.seed, run.depth * 977)
  /** 损伤专用的独立流（同 seed 同序列；与走法消耗无关，见下面 `damage` 处的说明） */
  const damageRng = autoRng(run.seed, run.depth * 31 + 7)
  const mul = wormholeLayerRewardMul(run.depth)
  /**
   * 丙/丁（2026-09-14）：敌卡 = **本处锁定的族**（整趟同族）；产出口味按**内容原型**在四条线上重分配
   * （`ARCHETYPE_MUL` 已归一化 ⇒ 总期望仍是那条 40% 线）。
   */
  const meta = wormholeRunMeta(run)
  const taste = ARCHETYPE_MUL[meta.archetype]
  const cardId = wormholeCardIdOfFamily(meta.family, run.seed)
  const family = String(ctx.anomalies.get(cardId)?.foeFamily ?? meta.family)
  /**
   * **谜质科技**（2026-09-19 船长甲案）：`total` 进四条产出线、`wreck`/`ore` 各再管一条线、`damage` 管损伤。
   * 未点科技 ⇒ 全 1（逐字零变化）。
   */
  const tf = wormholeAutoTechFactors(state, ctx, run.shipIds)
  const gains: Array<{ itemId: string; units: number }> = []
  /** 本趟自动探索捞到的 AI 核心（**不入仓库** ⇒ 不能进 `gains`；报告里单列一行） */
  let coresGained: { type: 'gamma' | 'beta' | 'alpha'; n: number } | null = null

  /**
   * **真跑一趟**（2026-09-26 船长令「优化自动探索舰船进入洞后获得的收益逻辑」）。
   *
   * 改前：收益 = `手动期望 × 40%` 一笔算出（不进网格、不耗回合、不看货舱）——那正是"收益太低"的根子。
   * 现在：按手动进洞的规则**走一遍**（网格 / 回合 / 层 / 层末守卫 / 货舱），捡到什么算什么。
   * 策略与口径全在 `wormholeAutoSim.ts` 的模块头注里；本处只负责"把编队与科技的读数喂进去"。
   */
  const adm = wormholeAdmission(ctx, run.shipIds)
  const descend = wormholeAutoDescend({
    seed: run.seed,
    startDepth: Math.max(1, Math.min(9, run.depth)),
    totalMass: adm.totalMass,
    holdM3: Math.max(1, Math.round(tf.baseHold * tf.holdMul)) * WORMHOLE_AUTO_HOLD_M3_PER_CELL * tf.total,
    miners: countFittedBySlot(state, ctx, run.shipIds, 'miner'),
    salvagers: countFittedBySlot(state, ctx, run.shipIds, 'salvager'),
    power: fleetPowerOf(state, ctx, run.shipIds),
    /**
     * **扫描半径 = 基础 1 + Σ 编队各船的 `wormholeScanRadiusBonus`**
     * （鹦鹉螺 `sh-nautilus` / 鲸盟护卫 `sh-wh-{a,d,g}-frigate`，每条 +1 且**可叠加** ——
     * 船长 2026-09-13「编入队伍就有效、且可以叠加」）。与手动进洞同一个求和口径
     * （`wormholeScanBonusOf`）：一次扫描揭开的格数按半径**平方**放大 ⇒ 4×鹦鹉螺 半径 5、一次 91 格。
     */
    scanRadius: 1 + wormholeScanBonusOf(ctx, run.shipIds),
    guardPowerOf: (d) => guardPowerOf(ctx, meta.family, d),
    // 谜质科技：回合加成由 `tf` 反推（`baseTurns × turnMul − baseTurns`）
    techTurnBonus: Math.max(0, Math.round(tf.baseTurns * tf.turnMul) - tf.baseTurns),
    tech: { wreck: tf.wreck, ore: tf.ore },
  })

  // ① 普通残骸：模拟器真捡到的 m³（`wormholeAutoSim` 按层收益 × 抖动 × 残骸线科技逐堆算出）
  const group = wreckGroupOfCard(cardId, ctx)
  // `wormholeCardIdOfFamily` 只给真卡 ⇒ 组必然查得到；兜底回落旧 id 只为合成夹具不炸（生产不可达）
  const wreckKey = group?.key ?? cardId
  if (descend.wreckM3 > 0) gains.push({ itemId: wreckItemIdOf(wreckKey), units: descend.wreckM3 })

  // ② 稀有残骸：模拟器在遗迹格命中几件就给几件（**8 折后是小数 ⇒ 小数部分掷一次取整**，可复现）
  const rareBase = Math.floor(descend.rareItems)
  const rareN = rareBase + (rng() < descend.rareItems - rareBase ? 1 : 0)
  if (rareN > 0) {
    gains.push({ itemId: rareWreckItemIdOf(wreckKey), units: rareN * RARE_WRECK_VOLUME_M3 * tuningMul(state, 'rareWreckVolume') })
  }

  // ③ 虚空母矿：模拟器在矿脉格真采到的单位数
  if (descend.oreUnits > 0) gains.push({ itemId: WORMHOLE_ORE_ITEM_ID, units: descend.oreUnits })

  // ④ 遗迹安全货柜：模拟器在遗迹格命中几次就给几件（同样按小数部分掷一次取整）
  const boxBase = Math.floor(descend.relicBoxes)
  const boxN = boxBase + (rng() < descend.relicBoxes - boxBase ? 1 : 0)
  for (let i = 0; i < boxN; i++) gains.push({ itemId: wormholeRelicBoxIdOf(family), units: 1 })

  /**
   * ⑤ **AI 核心**：命中率随**真正下到的层**抬升（层 1 起，与手动"层 1 也给"一致）。
   * 命中后按**与手动同一条权重**（60/30/10）抽一种；**不入仓库** ⇒ 直接 `gainAiCore`，报告里单列一行。
   */
  const coreChance = Math.min(0.95, WORMHOLE_AUTO_MANUAL.cores * (1 + 0.15 * Math.max(0, descend.depthReached - 1)) * tf.wreck)
  if (rng() < coreChance) {
    const total = WORMHOLE_CORE_WEIGHTS.gamma + WORMHOLE_CORE_WEIGHTS.beta + WORMHOLE_CORE_WEIGHTS.alpha
    let pick = rng() * total
    let got: 'gamma' | 'beta' | 'alpha' = 'gamma'
    for (const t of ['gamma', 'beta', 'alpha'] as const) {
      pick -= WORMHOLE_CORE_WEIGHTS[t]
      if (pick < 0) {
        got = t
        break
      }
    }
    gainAiCore(state, got)
    coresGained = { type: got, n: 1 }
  }

  // 入仓库（船长：「收益进仓库」）
  for (const g of gains) {
    state.warehouse.items[g.itemId] = (state.warehouse.items[g.itemId] ?? 0) + g.units
  }

  /**
   * 损伤：结构 / 装甲各掷一次（−40%~−80%）；结构保底 ⇒ 绝不丢船。
   * ⚠ 2026-09-19：**战斗线**按完成度把两次损耗乘 `tf.damage`（点满 ⇒ 减半：−40%~−80% 变 −20%~−40%）——
   * 乘在"掷出的损耗"上、**在保底之前** ⇒ `WORMHOLE_AUTO_HULL_FLOOR` 与"绝不丢船"一字不动。
   */
  const damage = run.shipIds.map((shipId) => {
    const ship = state.fleet[shipId]
    const dura = ship?.durability ?? 1
    const armor = ship?.armorPct ?? 1
    /**
     * ⚠ **损伤用独立随机流**（2026-09-26）：主 `rng` 现在会被"真跑一趟"按**走法**消耗不定次数，
     * 于是同一颗种子在两套科技档下会拿到不同的损伤序列（用例里表现为"科技档损伤反而更大"）。
     * 损伤与走法无关 ⇒ 单独一条流（同 seed 同序列），"科技减伤"这条口径才可复现。
     */
    const dLoss = (WORMHOLE_AUTO_DAMAGE_MIN + damageRng() * (WORMHOLE_AUTO_DAMAGE_MAX - WORMHOLE_AUTO_DAMAGE_MIN)) * tf.damage
    const aLoss = (WORMHOLE_AUTO_DAMAGE_MIN + damageRng() * (WORMHOLE_AUTO_DAMAGE_MAX - WORMHOLE_AUTO_DAMAGE_MIN)) * tf.damage
    const nextDura = Math.max(WORMHOLE_AUTO_HULL_FLOOR, dura * (1 - dLoss))
    const nextArmor = Math.max(0, armor * (1 - aLoss))
    if (ship) {
      ship.durability = nextDura
      ship.armorPct = nextArmor
    }
    return {
      shipId,
      name: shipNameOf(state, ctx, shipId),
      durabilityLossPct: Math.round((1 - nextDura / (dura || 1)) * 100),
      armorLossPct: Math.round((1 - nextArmor / (armor || 1)) * 100),
      durabilityPct: Math.round(nextDura * 100),
      armorPct: Math.round(nextArmor * 100),
    }
  })

  reportSeq += 1
  const report: WormholeAutoReport = {
    id: `whar-${state.gameMs.toString(36)}-${reportSeq.toString(36)}`,
    stockId: run.stockId,
    depth: run.depth,
    finishedAtGameMs: state.gameMs,
    shipIds: [...run.shipIds],
    /** 返航释放的核心数 = **1**（2026-09-26 船长令：整队一趟占 1 枚，与派几条船无关） */
    coresReleased: 1,
    gains,
    ...(coresGained !== null ? { cores: [coresGained] } : {}),
    damage,
    confirmed: false,
  }
  state.wormholeAutoReports = [report, ...wormholeAutoReportsOf(state)].slice(0, WORMHOLE_AUTO_REPORT_MAX)

  const gainText = gains.length > 0 ? gains.map((g) => `${itemNameOf(ctx, g.itemId)} ×${g.units}`).join('、') : '空手而归'
  /** AI 核心单列（不入仓库，故不在 `gains` 里） */
  const coreText = coresGained ? `，并带回 ${aiCoreName(coresGained.type)} ×${coresGained.n}（已直接接入核心库）` : ''
  const dmgText = damage.map((d) => `${d.name}（结构 −${d.durabilityLossPct}% / 装甲 −${d.armorLossPct}%）`).join('、')
  /**
   * **谜质科技那一段**（船长 2026-09-19「过程不折扣」）：只在真吃到科技（`tf` 非中性）时写进日志，
   * 未点科技的玩家日志**一字不变**。系数与结算同一个来源（`wormholeAutoTechFactors`）⇒ 报出来的就是实际生效的。
   */
  const techText = wormholeAutoTechIsNeutral(tf)
    ? ''
    : `谜质科技：残骸线 ×${tf.wreck.toFixed(2)} · 母矿线 ×${tf.ore.toFixed(2)} · 损伤 ×${tf.damage.toFixed(2)}。`
  addLog(
    state,
    'fleet',
    `🛰 自动探索队返航：带回 ${gainText}（已入仓库）${coreText}；损伤：${dmgText}。${techText}` +
      `${run.shipIds.length} 条舰全部安全返航，1 枚 AI 核心已释放（每次自动探索占 1 枚）——报告在「扫描虫洞」页等你确认。`,
  )
}

/** 报告确认（界面「确认」按钮；确认后不再计入待确认数） */
export function wormholeAutoConfirmReport(state: GameState, reportId: string): CommandResult {
  const list = wormholeAutoReportsOf(state)
  const report = list.find((r) => r.id === reportId)
  if (!report) return { ok: false, error: '这份报告不在了。', errorId: 'core.wormholeAuto.003' }
  if (report.confirmed) return { ok: true }
  report.confirmed = true
  state.wormholeAutoReports = [...list]
  return { ok: true }
}

/** 全部确认（界面「全部标为已读」）；返回本次确认了几条 */
export function wormholeAutoConfirmAll(state: GameState): number {
  const list = wormholeAutoReportsOf(state)
  let n = 0
  for (const r of list) {
    if (!r.confirmed) {
      r.confirmed = true
      n += 1
    }
  }
  if (n > 0) state.wormholeAutoReports = [...list]
  return n
}

/** 物品中文名（报告/日志用；查不到就用 id） */
export function itemNameOf(ctx: SimContext, itemId: string): string {
  return ctx.items.get(itemId)?.name ?? itemId
}

/** 库存项（界面用；避免界面重复 import 扫描模块） */
export function wormholeAutoStockOf(state: GameState): WormholeStockItem[] {
  return wormholeStockOf(state)
}
