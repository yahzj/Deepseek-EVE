/**
 * 任务中心·时效任务（资源 / 快递）——2026-09-05 船长拍板（v24），2026-09-06 修订节奏与候选池，
 * 2026-09-06 增量修订：奖励改"税前锚定" + 快递真实航行投送（主控"去程取消"的快递专项例外）。
 *
 * 规则（中文说明）：
 * - 刷新节奏 = 市场「补给刷新」周期 ctx.balance.market.orderLifeMs.common（20 分钟，
 *   与常驻订单寿命一致）：任务整板每 20 分钟换一轮——每个 20 分钟整点旧任务全部过期清空、
 *   重刷 2 条资源任务（快递在已建成副站后同刷 2 条）；每条任务只存活一轮
 *   （window → window + 20 分钟），到下一个 20 分钟整点整板替换；
 * - 任务池 = 市场常驻（common）且 poolTarget>0 的 item 商品 ∩ 玩家当前星图进度可获取的货
 *   （见 sideTaskCandidateGoods：矿石/气体/冰需其产出矿带所在星系已探索；矿物需任一产出它的
 *   矿石/气体/冰（均有精炼配方）的矿带星系已探索；弹药/修理组件/无人机等 NPC 直供无矿带依赖
 *   恒可刷；物品仓库已有该货恒放行）；每次用 rng 抽 2 个不重复商品，需要量
 *   need = round(poolTarget × (0.01 + rng×0.02)) 取整到 10、至少 10；
 * - 刷出时的市场影响（防"买来秒交"）：对含某物品 X 的任务，从 npcSell 簿合计削减 SPAWN_SUPPLY_CUT(0.45)
 *   在售量（2026-09-09 随收益上调 30%→45%）
 *   （逐单从尾扣减至 0 移除），并把 pool.q 扣掉同等数量（模拟 NPC 买走一部分），同时
 *   pool.shock += 0.05（上限 0.4）——使随后补单/报价变贵；
 * - 奖励（税前锚定，2026-09-06 船长拍板）：基准单价 = 刷出瞬间该商品收购价
 *   （marketQuote().buy，池商品收购价 = 均衡价 levelOf；簿面无收购单时回落 levelOf），
 *   再按任务族乘系数并向下取整到整百（至少 100）——
 *   资源任务 rewardIsk = need × 收购价 × RESOURCE_TASK_MARGIN(1.15，2026-09-09 上调)，附加守卫：刷出时有
 *   供应价 sell 时强制 reward < need×sell（边沿溢出则钳到 floor((need×sell−1)/100)×100），
 *   保证"市价买入即交"必亏；快递任务 rewardIsk = need × 收购价 × COURIER_TASK_MARGIN(1.50，2026-09-09 上调)
 *   （运费补偿型利润：快递含真实航行耗时，不设买货守卫）；不给声望；
 * - 快递（2026-09-06 真实航行投送）：刷出时把目标绑定到一座已建成副站（stationId/galaxyId）；
 *   玩家两步操作——"出发投送"（仓库需足量）把 need 从物品仓库锁定扣出并转入
 *   state.sideTasks.deliver 在途挂账，到站时刻 = 出发时刻 + travelLegMs(shortestTravelMinutes(
 *   当前位置→目标副站星系))；同一时刻只允许一笔投送，投送在途期间禁止并发开矿/远征/扫描/打捞/
 *   掩护巡逻/换港返航（各 start* 守卫以 courierDelivering 判定，措辞"快递投送途中"）；
 *   引擎推进到 gameMs ≥ arriveAtGameMs 自动到站：停靠目标副站、按原任务 id 结算（奖励入账、
 *   任务下板、挂账清空）——整板刷新不清除在途投送（完成仍按刷出时锁定酬金结算）；
 * - 完成条件（资源）：仅当物品仓库（state.warehouse.items）中该 refId ≥ need 时完成（不接受
 *   货仓/不提前接单）；完成即从仓库扣 need、现金入账、该条移出当前轮板，同轮其余任务不受影响；
 * - 离线大步长（一次跨 N 个 20 分钟周期）：按船长拍板"仅末窗执行刷新与市场影响"——中间周期只
 *   推进 window 号、不重复扣量/抬价（防 8 小时 24 轮冲击把市场打穿）；投送在途跨大步长按真实
 *   时间推进，越过 arriveAtGameMs 即到站结算。见 advanceSideTasks 注释。
 */
import { rewardMulOf } from './tuning'
import { addLog, HOME_GALAXY_ID } from './state'
import { applyActivityGate } from './activityGate'
import type { CourierDeliveryState, GameState, SideTask, SideTasksState } from './state'
import type { CommandResult } from './engine'
import type { BeltDef, MarketGoodDef, SimContext, StationSiteDef } from './types'
import { nextInt, nextRandom } from './rng'
import { marketQuote, levelOf } from './market'
import { isGalaxyStationBuilt, isSiteBuilt } from './station'
import { isExplored } from './explore'
import { countWare, removeWare, cargoCapacityM3Of, unloadCargoOfShipToWarehouse } from './inventory'
import { shortestTravelMinutes, travelLegMs, travelMinutesEff, warpSpeedAus } from './travel'
import { isAtHome, originGalaxyOf } from './location'
import { DSI_FACTION_ID, standingOf as factionStandingOf } from './expedition'
import { factionBaseRewardIsk, hasLairCore, isLairCandidate, lairLevelOf, lairNameOf, lairTaskRewardIsk } from './lairs'
import type { LairTier } from './lairs'
import type { AnomalyDef } from './types'

/**
 * **任务级别 1~5**（船长 2026-09-18：「任务将划分级别，级别越高的任务收购的数量/所需的货仓容量越多。
 * 同样奖励也越高」；「L1~L4 任务至少要各出现」⇒ 生成时先保底铺 L1~L4，多余席位才掷更高级）。
 */
export type SideTaskLevel = 1 | 2 | 3 | 4 | 5
export const SIDE_TASK_LEVELS: readonly SideTaskLevel[] = [1, 2, 3, 4, 5]

/** 各级"量"倍率（资源需量 / 快递货舱体积）——L1 为基准量，越高越大 */
export const SIDE_TASK_LEVEL_SCALE: Record<SideTaskLevel, number> = { 1: 1, 2: 1.7, 3: 3, 4: 5, 5: 8 }

/**
 * **资源任务各级奖励系数**（船长 2026-09-18：「资源任务的奖励系数下调，
 * L1~L5 分别为 1.1/1.15/1.2/1.25/1.3」；旧的单值 ×1.15 作废）。
 * ⚠ 仍保留"**必须低于刷出时供应价**"的防套利红线（船长 2026-09-18 选"取消修改"）：
 * 薄价差的常驻品（如钛钢合金 8/9）会把 L2~L5 钳到 ≈1.12×，级别差异只在**价差宽**的商品上完整体现。
 */
export const RESOURCE_TASK_LEVEL_MARGIN: Record<SideTaskLevel, number> = { 1: 1.1, 2: 1.15, 3: 1.2, 4: 1.25, 5: 1.3 }

/**
 * **快递各级运费基准（ISK，航程系数 = 1.0 时）**（船长 2026-09-18：「在维持运费的前提下，提高占用的体积数」）。
 *
 * 推导：沿用旧的"体积 × 单价"定价（旧体积 300/510/900/1,500/2,400 m³ × 单价 600/900/1,300/1,900/2,700）
 * ⇒ 基准 = 180,000 / 459,000 / 1,170,000 / 2,850,000 / 6,480,000。
 * **运费与体积解耦**：体积涨了（见 `COURIER_TASK_LEVEL_VOLUME`），这五个基准一分不动。
 */
export const COURIER_TASK_LEVEL_FREIGHT_ISK: Record<SideTaskLevel, number> = {
  1: 180_000,
  2: 459_000,
  3: 1_170_000,
  4: 2_850_000,
  5: 6_480_000,
}

/**
 * **快递各级"非限时"占用体积（m³）**（船长 2026-09-18：「L5非限时的快递体积提高到2万立方，L1提高到1000，
 * 其他等比上调，限时快递体积为非限时的一半」）——L1 1,000 ⇒ L5 20,000 等比（每级 ≈×2.11）。
 *
 * ⚠ 可达性：20,000 m³ 需**蝠鲼级重载货舰 26,000**（有蓝图）或**皇带鱼级旗舰货舰 108,000**；
 * 剑鱼级 14,000 装不下非限时 L5，但装得下限时 L5（10,000）。
 */
export const COURIER_TASK_LEVEL_VOLUME: Record<SideTaskLevel, number> = {
  1: 1_000,
  2: 2_100,
  3: 4_500,
  4: 9_500,
  5: 20_000,
}

/** **限时快递体积 = 同级别非限时的一半**（船长 2026-09-18） */
export const COURIER_TIMED_VOLUME_RATIO = 0.5

/**
 * **限时快递的跃迁速度门槛（AU/s）—— 4 档**（船长 2026-09-18 选丙案：「按照剑鱼的标准」：
 * 剑鱼级大型货舰 6.20 / 剑鱼+跃迁计算机 MK2 7.44 / +MK3 8.37 / +MK3×2 10.92；多件按 EVE 曲线合成）。
 * 级别对应：**L2→6.20 · L3→7.44 · L4→8.37 · L5→10.91**；L1 若掷成限时取最低档 6.20。
 * ⚠ 最高档（10.91）**已实测可达**（剑鱼低槽 3、CPU 175；MK3 低槽件 CPU 40 ⇒ 两件占 2 槽 80 CPU）。
 *
 * 🔴 **2026-09-26 船长裁决（乙案）：最高档 10.92 → 10.91**。起因 = 玩家报障「要求 ≥10.92 的限时快递
 * 显示 10.92 却接不了」。**实测（真引擎、逐配置打表）**：
 * ```
 * 剑鱼 无计算机 6.2         · 显示 6.20
 * 剑鱼 MK2×1   7.4399999999999995 · 显示 7.44
 * 剑鱼 MK3×1   8.370000000000001  · 显示 8.37
 * 剑鱼 MK3×2   10.916086983754765 · 显示 10.92  ← 差 0.0039，被拒
 * ```
 * 根因 = **两件 MK3 走 EVE 曲线（多件递减）后的倍率是 1.760659，不是原注释里那个 1.76**
 * ⇒ 真实值只有 10.9161；界面按 2 位小数显示成 10.92，判定却拿原始值比 10.92（容差 `1e-9` 接不住）。
 * ⇒ 门槛表这一档落到 **10.91**（仍高于"剑鱼＋MK3×1"的 8.37，不改变配装要求，只把边界让给显示精度）。
 * ⚠ 为什么不是"按显示精度比"：船长选乙——**只动这一个数**，判定与容差一字不动。
 * ⚠ 另外两档（7.44 / 8.37）同属"剑鱼＋件"的显示值，但真实值分别差 −1.6e-15 与 +1e-15 ⇒
 * 本来就在容差内，无需动（别顺手改）。
 */
export const COURIER_TIMED_WARP_REQ: readonly number[] = [6.2, 7.44, 8.37, 10.91]

/** 快递任务掷成**限时快递**的概率（每单独立掷；其余为普通快递） */
export const COURIER_TIMED_CHANCE = 0.5

/**
 * **限时快递的加急系数**（船长 2026-09-18 选乙案：**+50%**）——限时的体积只有普通的一半（单位体积运费
 * 已翻倍），但仍按级别基准加价五成，抵掉跃迁门槛（L5 要剑鱼＋双 MK3）与"超时无报酬"的风险。
 */
export const COURIER_TIMED_PREMIUM = 1.5

/** 每板**基础**条数（船长 2026-09-18：「初始每个任务数量提高到4」）——资源/快递各 4 条 */
export const SIDE_TASK_BASE_COUNT = 4

/**
 * **资源需量的产能倍率**（船长 2026-09-18：「移除 0.25 倍率，改为 1 倍」）：
 * 基准需量 = 玩家 1 小时可获得该货的量 × 本值（1 = 整一小时产量），再乘级别倍率。
 */
export const RESOURCE_NEED_HOUR_FRACTION = 1

/** **每建成一座副空间站**，资源/快递各 +2 条（船长 2026-09-18：「每个建成的空间站让任务数量+2」） */
export const SIDE_TASK_COUNT_PER_STATION = 2

/** 快递"接单"上限（船长：「接取的快递任务不会被刷掉」——接了进 `sideTasks.accepted`，跨整板刷新保留） */
export const COURIER_ACCEPT_MAX = 4

/** 虚拟货物运费：航程系数基准 = **10 分钟航程算 1.0**（船长 2026-09-18：「并不失衡啊，
 *  你要考虑玩家成本问题和任务周期」⇒ 按"标称航程分钟 ÷ 10"折算，**下限 0.5**、无上限） */
const COURIER_TRIP_MINUTES_REF = 10
/** 航程系数下限（短程也不低于此；远站按航程线性加价，无上限） */
const COURIER_TRIP_FACTOR_MIN = 0.5

/** 限时快递时限宽限（基准配置到达时长 × 1.05：同配置无技能时刚好压线，留 5% 缓冲） */
const TIMED_COURIER_GRACE = 1.05

/** 刷出时对池商品抬价步长（`pool.shock += 本值`）；**资源任务完成后按本值回退涨价部分** */
export const SPAWN_SHOCK_STEP = 0.05

/**
 * 任务刷出时对商品在售常驻供应的削减比例（2026-09-09 船长定 0.30 → 0.45；
 * **2026-09-18 随条数翻倍下调到 0.25**——每板条数由 2 增到 4＋每站 +2，
 * 若不降比例，一轮就有 8＋ 种商品被抽走近半挂单）。同一商品每轮**只被抽一次**（见 refreshBoard）。
 */
export const SPAWN_SUPPLY_CUT = 0.25

/** 每日赏金席位总数（2026-09-10 船长定：中安 2 + 低安 3 = 5 个地点/天，档位铺成外围 1·核心 2·深层 2）
 *  ——实际张数受各区候选限制（抽不满就少发），故界面显示以当日实际板为准。 */
export const BOUNTY_TASKS_PER_ROUND = 5

/** 本板刷新周期毫秒 = 市场「补给刷新」节奏（与常驻订单寿命一致，默认 20 分钟） */
function boardPeriodMs(ctx: SimContext): number {
  return ctx.balance.market.orderLifeMs.common
}

/**
 * **快递任务板周期毫秒**（**2026-09-24 船长令**：「**快递任务的周期和持续时间都为 120 分钟，资源任务不变**」
 * ＋「每批条数不动」）。
 *
 * 口径：**资源任务**继续跟市场「补给刷新」节奏（`boardPeriodMs`，20 分钟、按市场整点对齐）；
 * **快递任务**每 **120 分钟**重掷一批、且**存活恰好 120 分钟**（到点即换下一批 ⇒ 整齐一批）。
 * 因为 120 = 20 × 6 ⇒ "要不要在这一窗重掷快递"只需看**窗界是不是 120 分钟的整数倍**（`courierDueAtWindow`）。
 */
export const COURIER_BOARD_PERIOD_MS = 120 * 60_000

/**
 * 这一窗要不要**重掷快递任务**（纯函数：既给 `refreshBoard` 调用，也让单测直接把口径钉住）。
 *
 * 判据：窗界 `windowMs`（= 上一个市场整点）是 `COURIER_BOARD_PERIOD_MS` 的整数倍 ⇒ 到点。
 * ⚠ 窗界 0（未开盘）不算到点 —— 首个快递批次由"开盘后的第一个 120 分钟整点"给出
 * （开盘那一次是全板新建，快递自然一起生成）。
 */
export function courierDueAtWindow(windowMs: number): boolean {
  if (!Number.isFinite(windowMs) || windowMs <= 0) return false
  return windowMs % COURIER_BOARD_PERIOD_MS === 0
}

/**
 * **本批快递的到期时刻**（**2026-09-24 船长报障**「快递任务现在是 2 小时刷新周期，但是卡片上和快递任务页面
 * 写的还是 20 分钟」的**根因那一半**）：下一个 120 分钟整点。
 *
 * 与重掷判据同源（`courierDueAtWindow`）：窗界本身就是 120 分钟整点 ⇒ 到期 = 窗界 + 120 分钟；
 * 非整点窗（**首个批次**：建成副站后随下一个 20 分钟窗补种）⇒ 到期 = 其后第一个 120 分钟整点。
 * 未开盘（窗界 ≤ 0）⇒ 返回一个完整周期（此时板上没有快递，这个值只作展示兜底）。
 */
export function courierDeadlineMs(windowMs: number): number {
  const P = COURIER_BOARD_PERIOD_MS
  if (!Number.isFinite(windowMs) || windowMs <= 0) return P
  return courierDueAtWindow(windowMs) ? windowMs + P : Math.ceil(windowMs / P) * P
}

/** 任务商品基池：市场常驻（common）且带 poolTarget>0 的 item 类商品（未做星图门槛过滤） */
function taskGoodBasePool(ctx: SimContext): MarketGoodDef[] {
  const out: MarketGoodDef[] = []
  for (const def of ctx.marketGoods.values()) {
    if (def.rarity === 'common' && def.kind === 'item' && (def.poolTarget ?? 0) > 0) out.push(def)
  }
  return out
}

/** 某矿带是否产出该资源（主产物 oreId 或复合产出池 outputs 命中） */
function beltProduces(belt: BeltDef, itemId: string): boolean {
  if (belt.oreId === itemId) return true
  const outputs = belt.outputs
  if (outputs) {
    for (const o of outputs) if (o.itemId === itemId) return true
  }
  return false
}

/** 是否已有任一产出 itemId 的矿带、且其所在星系已探索（无 galaxyId = 母港，恒已探索） */
function anyProducingBeltExplored(state: GameState, ctx: SimContext, itemId: string): boolean {
  for (const belt of ctx.belts.values()) {
    if (!beltProduces(belt, itemId)) continue
    if (isExplored(state, belt.galaxyId ?? HOME_GALAXY_ID)) return true
  }
  return false
}

/**
 * 玩家在当前星图进度下是否"已可获取"该货（纯函数；任务候选门槛）：
 * - 物品仓库已有该货（玩家已接触）→ 恒放行；
 * - 矿石/气体/冰（矿带直采）：要求至少一个产出它的矿带所在星系已探索；
 * - 矿物（精炼产物，如 min-*）：凡某矿石/气体/冰的精炼配方产出它（item.refine 指向），
 *   则任一产出源的矿带星系已探索即可放行（能采到源头即可炼出）；无精炼来源的矿物
 *   无矿带依赖，按 NPC 直供恒放行；
 * - 弹药/修理组件/无人机等 NPC 常驻直供商品（无矿带依赖）：恒可刷；
 * - 不在物品数据目录里的未知商品不设门槛（保留候选，防内容缺失时任务板空转）。
 */
export function sideTaskCandidateGoods(state: GameState, ctx: SimContext): MarketGoodDef[] {
  const out: MarketGoodDef[] = []
  for (const def of ctx.marketGoods.values()) {
    if (def.rarity !== 'common' || def.kind !== 'item' || (def.poolTarget ?? 0) <= 0) continue
    const itemId = def.refId
    /**
     * **残骸一律不进资源 / 快递任务**（船长 2026-09-18：「**在资源和快递任务中，将所有残骸排除。**」）。
     *
     * 判据走数据（`ItemDef.kind === 'wreck'`）——普通残骸与稀有残骸同属这一类，不看 id 前缀；
     * ⚠ 位置必须放在"仓库已有即放行"**之前**：否则玩家仓库里躺着残骸时又会被放回候选池。
     * 残骸的市场行（`WRECK_BUY_GOODS`）与回收链路不受影响：照旧可在市场卖给协会回收站、可入炉拆解。
     */
    if (ctx.items.get(itemId)?.kind === 'wreck') continue
    if ((state.warehouse.items[itemId] ?? 0) > 0) {
      out.push(def) // 仓库已有 → 玩家已接触，恒放行
      continue
    }
    const item = ctx.items.get(itemId)
    if (!item) {
      out.push(def) // 未知商品：不设门槛
      continue
    }
    if (item.kind === 'ore' || item.kind === 'gas' || item.kind === 'ice') {
      // 矿带直采资源：需任一产出矿带所在星系已探索（无任何矿带产出 = 星图上采不到，不放行）
      if (anyProducingBeltExplored(state, ctx, itemId)) out.push(def)
      continue
    }
    if (item.kind === 'mineral') {
      // 精炼产物：任一产出源（矿石/气体/冰均有精炼配方）的矿带星系已探索即可炼出
      let sourceFound = false
      for (const src of ctx.items.values()) {
        if (src.kind !== 'ore' && src.kind !== 'gas' && src.kind !== 'ice') continue
        const refine = src.refine
        if (!refine) continue
        let produces = false
        for (const row of refine) {
          if (row.mineralId === itemId) {
            produces = true
            break
          }
        }
        if (produces) {
          sourceFound = true
          if (anyProducingBeltExplored(state, ctx, src.id)) {
            out.push(def)
            break
          }
        }
      }
      if (!sourceFound) out.push(def) // 无精炼来源（如远征稀有掉落物）：无矿带依赖，恒放行
      continue
    }
    // 弹药/修理组件/无人机等 NPC 常驻直供（无矿带依赖）：恒可刷
    // （**残骸不在其中**：船长 2026-09-18 定「资源与快递任务排除所有残骸」，见本函数开头的判据）
    out.push(def)
  }
  return out
}

/** 快递任务是否解锁：存在任一"已建成"副空间站（stage ≥ tiers.length；复用 station.isSiteBuilt 判定） */
export function courierTaskUnlocked(state: GameState, ctx: SimContext): boolean {
  for (const site of ctx.stations.values()) {
    if (isSiteBuilt(state, site)) return true
  }
  return false
}

/** 已建成且星系合法的副站（快递目标候选；站点所在星系必须存在于星图目录） */
function builtStationTargets(state: GameState, ctx: SimContext): Array<{ site: StationSiteDef }> {
  const out: Array<{ site: StationSiteDef }> = []
  for (const site of ctx.stations.values()) {
    if (!isSiteBuilt(state, site)) continue
    if (!ctx.galaxies.has(site.galaxyId)) continue
    out.push({ site })
  }
  return out
}

/** 解析某快递任务的目标副站：任务自带绑定（刷出时锁定）→ 校验仍建成合法；否则（老档无绑定）
 *  兜底 = 距**母港**最近的已建成副站（2026-09-20 船长「起点都从母港触发」后与出发地同源） */
function resolveCourierTarget(state: GameState, ctx: SimContext, task: SideTask): StationSiteDef | null {
  if (task.stationId) {
    const site = ctx.stations.get(task.stationId)
    if (site && isSiteBuilt(state, site) && ctx.galaxies.has(site.galaxyId)) return site
  }
  let best: StationSiteDef | null = null
  let bestMin = Number.POSITIVE_INFINITY
  const from = HOME_GALAXY_ID
  for (const { site } of builtStationTargets(state, ctx)) {
    const m = shortestTravelMinutes(ctx, from, site.galaxyId)
    if (Number.isFinite(m) && m < bestMin) {
      bestMin = m
      best = site
    }
  }
  return best
}

/** 从候选池抽 count 个互不重复的商品（**2026-09-18 扩到任意条数**：Fisher–Yates 洗牌取前 n 个；
 *  同一商品每轮只出现一次 ⇒ 市场联动"同一商品每轮只被抽一次"天然成立） */
function drawDistinctGoods(state: GameState, pool: MarketGoodDef[], count: number): MarketGoodDef[] {
  const n = Math.min(count, pool.length)
  const idx = pool.map((_, i) => i)
  for (let i = idx.length - 1; i > 0; i--) {
    const j = nextInt(state.rng, i + 1)
    const tmp = idx[i]!
    idx[i] = idx[j]!
    idx[j] = tmp
  }
  return idx.slice(0, n).map((i) => pool[i]!)
}

/**
 * **玩家 1 小时可获得该货的量**（资源任务需量的锚，船长 2026-09-18 批的默认口径：
 * 「需量上限改为玩家 1 小时产能，避免出现'20 分钟内要 7 万单位'」）：
 * - 矿石/气体/冰：6 条采矿线满产 = **18,000 单位/小时**（沙猫 50 单位/分 × 6：驾驶 1 ＋ AI 核心 5）；
 * - 矿物（精炼产物）：18,000 × **无门槛矿带的最优精炼产率**（有门槛的矿带不算，避免超出进度）；
 * - 其他（弹药/修理组件/无人机等 NPC 直供品）：按市场池量换算（池量 × 1%/小时）。
 */
export function hourlySupplyOf(state: GameState, ctx: SimContext, itemId: string): number {
  const ORE_PER_HOUR = 18_000
  const item = ctx.items.get(itemId)
  if (!item) return 1_000
  if (item.kind === 'ore' || item.kind === 'gas' || item.kind === 'ice') return ORE_PER_HOUR
  if (item.kind === 'mineral') {
    let best = 0
    for (const belt of ctx.belts.values()) {
      if ((belt.standingReq ?? 0) > 0) continue // 只算无门槛矿带（进度无关的保底产能）
      const def = ctx.items.get(belt.oreId)
      for (const row of def?.refine ?? []) {
        if (row.mineralId === itemId && row.perOre > best) best = row.perOre
      }
    }
    return best > 0 ? ORE_PER_HOUR * best : 1_000
  }
  // NPC 直供品：池量 × 1%（与原"池量 1~3%"同量级的下沿，作为 1 小时可获得的等价量）
  for (const g of ctx.marketGoods.values()) {
    if (g.refId === itemId && (g.poolTarget ?? 0) > 0) return (g.poolTarget ?? 0) * 0.01
  }
  return 1_000
}

/**
 * **资源任务需要量**（2026-09-18 新口径，两轮改定）：
 * **基准 = 玩家 1 小时可获得该货的量 × 1**（船长：「移除 0.25 倍率，改为 1 倍」⇒ L1 = 1 小时产量，
 * L5 = 8 小时产量），取整到 10、至少 10。
 */
function rollResourceNeed(state: GameState, ctx: SimContext, def: MarketGoodDef, level: SideTaskLevel): number {
  const hourly = hourlySupplyOf(state, ctx, def.refId)
  const raw = hourly * RESOURCE_NEED_HOUR_FRACTION * SIDE_TASK_LEVEL_SCALE[level]
  return Math.max(10, Math.round(raw / 10) * 10)
}

/** 快递所需货舱体积（m³）：非限时 = 级别表值；**限时 = 表值 × 0.5**（船长 2026-09-18） */
export function courierVolumeFor(level: SideTaskLevel, timed = false): number {
  const base = COURIER_TASK_LEVEL_VOLUME[level]
  return Math.round(timed ? base * COURIER_TIMED_VOLUME_RATIO : base)
}

/** 限时快递的跃迁门槛（按级别取 4 档；L1 掷成限时时取最低档 6.20） */
export function courierWarpReqOf(level: SideTaskLevel): number {
  const idx = Math.max(0, Math.min(COURIER_TIMED_WARP_REQ.length - 1, level - 2))
  return COURIER_TIMED_WARP_REQ[idx]!
}

/**
 * **资源任务奖励**（税前锚定，2026-09-06 船长拍板；2026-09-18 船长改分级系数 1.1~1.3）：
 * reward = need × 刷出瞬间收购价 × `RESOURCE_TASK_LEVEL_MARGIN[level]`，向下取整到整百、至少 100；
 * **附加守卫（未改）**：刷出时有供应价时强制 reward < need×sell（市价买入交付必亏）。
 */
function resourceRewardIskFor(
  state: GameState,
  ctx: SimContext,
  goodKey: string,
  need: number,
  level: SideTaskLevel,
): number {
  const quote = marketQuote(state, ctx, goodKey)
  const base = quote.buy !== undefined && quote.buy > 0 ? quote.buy : Math.max(1, levelOf(state, ctx, goodKey))
  let reward = Math.max(100, Math.floor((need * base * RESOURCE_TASK_LEVEL_MARGIN[level]) / 100) * 100)
  if (quote.sell !== undefined && reward >= need * quote.sell) {
    reward = Math.min(reward, Math.floor((need * quote.sell - 1) / 100) * 100)
  }
  return Math.max(0, Math.round(reward * rewardMulOf(state)))
}

/**
 * **快递奖励（虚拟货物 ⇒ 纯运费，2026-09-18 船长三轮定）**：
 * reward = `COURIER_TASK_LEVEL_FREIGHT_ISK[level]` × 航程系数 ×（限时 ? `COURIER_TIMED_PREMIUM` : 1），
 * 向下取整到整百、至少 100。
 * **运费与体积解耦**（船长：「在维持运费的前提下，提高占用的体积数」）⇒ 体积涨了、普通运费一分不动；
 * **限时加急 +50%**（船长选乙案：限时体积减半却要跃迁门槛与时限、超时无报酬）。
 * 航程系数 = 标称航程分钟 ÷ **10**（10 分钟航程 = 1.0），**下限 0.5、无上限** ⇒ 远站线性加价。
 * 快递不再绑商品 ⇒ 不吃市场报价、也不触发市场联动。
 */
function courierRewardIskFor(
  state: GameState,
  level: SideTaskLevel,
  nominalMinutes: number,
  timed: boolean,
): number {
  const trip = Math.max(
    COURIER_TRIP_FACTOR_MIN,
    (Number.isFinite(nominalMinutes) ? nominalMinutes : 10) / COURIER_TRIP_MINUTES_REF,
  )
  const premium = timed ? COURIER_TIMED_PREMIUM : 1
  const raw = COURIER_TASK_LEVEL_FREIGHT_ISK[level] * trip * premium
  return Math.max(0, Math.round(Math.max(100, Math.floor(raw / 100) * 100) * rewardMulOf(state)))
}

/** 刷出市场影响（对单个商品一次）：npcSell 合计削减 SPAWN_SUPPLY_CUT 在售量（逐单从尾扣减至 0 移除），
 *  pool.q 扣掉同等数量，pool.shock += SPAWN_SHOCK_STEP（上限 0.4）；
 *  **2026-09-18**：比例 0.45 → 0.25（条数翻倍）；同一商品每轮只被抽一次（`drawDistinctGoods`）；
 *  **资源任务完成时按 SPAWN_SHOCK_STEP 回退涨价部分**（见 `refundSpawnShock`）。 */
function applySpawnMarketImpact(state: GameState, def: MarketGoodDef): void {
  const pool = state.market.pools[def.key]
  if (!pool) return
  const sellList = state.market.npcSell[def.key]
  if (sellList) {
    let total = 0
    for (const o of sellList) total += o.qty
    if (total > 0) {
      const removeQty = Math.round(total * SPAWN_SUPPLY_CUT)
      let rem = removeQty
      for (let i = sellList.length - 1; i >= 0 && rem > 0; i--) {
        const o = sellList[i]!
        const take = Math.min(o.qty, rem)
        o.qty -= take
        rem -= take
        if (o.qty <= 0) sellList.splice(i, 1)
      }
      pool.q = Math.max(0, pool.q - removeQty)
    }
  }
  pool.shock = Math.min(0.4, (pool.shock ?? 0) + SPAWN_SHOCK_STEP)
}

/**
 * **回退"涨价部分"**（船长 2026-09-18：「资源任务的市场联动涨价（只有涨价部分）会在任务完成后移除」）：
 * 资源任务完成时把刷出时加的那一步 shock 撤掉（钳 ≥0）；**供应削减与池量扣减不回退**——
 * 那是"防买来秒交"的实质（协会包收的货不会因为交完就退回市场）。
 */
export function refundSpawnShock(state: GameState, goodKey: string): void {
  const pool = state.market.pools[goodKey]
  if (!pool) return
  pool.shock = Math.max(0, (pool.shock ?? 0) - SPAWN_SHOCK_STEP)
}

/**
 * **整板刷新**（2026-09-18 船长改版）：
 * ① 清空资源/快递两族（**已接单 `accepted` 不清**——船长：「接取的快递任务不会被刷掉」）；
 * ② 条数 = `SIDE_TASK_BASE_COUNT`（4）＋ **每建成一座副站 +2**（`builtStationCount`），资源与快递各算；
 * ③ 级别：**先保底铺 L1~L4 各一条**（船长：「L1~L4 任务至少要各出现」），剩余席位按"越高越可能"的
 *    权重掷（L1 10 / L2 15 / L3 20 / L4 25 / L5 30）；
 * ④ 资源任务：抽（与条数等量的）不重复商品，需量 = 玩家 1 小时产能 × 0.25 × 级别倍率，奖励按级别系数；
 * ⑤ 快递任务：虚拟货物 —— 不再绑商品，按级别给体积与运费；L2~L5 为**限时快递**（跃迁门槛 4 档），
 *    L1 为普通快递；
 * ⑥ 市场影响：只对资源任务生效（同商品每轮一次）。
 * boundaryMs = 本次刷出的 20 分钟整点（= 该轮任务起点；下一 20 分钟整点 boundaryMs + 周期
 * 到点时整板替换）。在途投送（deliver）与已接单（accepted）都不被整板清掉。
 */
function refreshBoard(state: GameState, ctx: SimContext, boundaryMs: number): void {
  const board = state.sideTasks
  board.window = boundaryMs
  /**
   * **快递任务：只有到 120 分钟的整点窗才重掷**（**2026-09-24 船长令**：「快递任务的周期和持续时间都为
   * 120 分钟，资源任务不变」）。于是：资源族每 20 分钟整板换；快递族**原样保留**到下一个 120 分钟整点
   * （= 存活恰好 120 分钟，到点与下一批同时换 ⇒ 整齐一批）。
   * ⚠ 板子还没开过（快递族为空）时即使未到点也要生成，否则玩家开局要等满两小时才见到第一张快递。
   */
  const courierDue = courierDueAtWindow(boundaryMs) || (board.courier ?? []).length === 0
  board.resource = []
  if (courierDue) board.courier = []
  const pool = sideTaskCandidateGoods(state, ctx)
  if (pool.length <= 0) return

  const counts = taskCountsFor(state, ctx)
  const levels = rollLevels(state, Math.max(counts.resource, counts.courier))
  const affected = new Set<string>()

  // ── 资源任务：真实货物（保持原语义），需量/奖励按级别 ──
  const resGoods = drawDistinctGoods(state, pool, Math.min(counts.resource, pool.length))
  for (let i = 0; i < resGoods.length; i += 1) {
    const def = resGoods[i]!
    const level = levels[i % levels.length]!
    const need = rollResourceNeed(state, ctx, def, level)
    const rewardIsk = resourceRewardIskFor(state, ctx, def.key, need, level)
    board.seq += 1
    affected.add(def.key)
    board.resource.push({ id: board.seq, kind: 'resource', goodKey: def.key, refId: def.refId, need, rewardIsk, level })
  }

  // ── 快递任务：虚拟货物（只有体积），每单独立掷「普通 / 限时」──
  // ⚠ 只在**到 120 分钟整点**（或板子还没开过）时重掷：其余窗保留上一批（存活 120 分钟）
  const courierTargets = courierDue ? builtStationTargets(state, ctx) : []
  if (courierTargets.length > 0) {
    for (let i = 0; i < counts.courier; i += 1) {
      const level = levels[i % levels.length]!
      const picked = courierTargets[nextInt(state.rng, courierTargets.length)]!
      const timed = nextRandom(state.rng) < COURIER_TIMED_CHANCE
      const volumeM3 = courierVolumeFor(level, timed)
      const warpReqAus = timed ? courierWarpReqOf(level) : null
      // 报酬按"母港 → 目标站"的标称航程算（与玩家实际用哪条船无关 ⇒ 不好被换船薅）
      const nominal = shortestTravelMinutes(ctx, HOME_GALAXY_ID, picked.site.galaxyId)
      const rewardIsk = courierRewardIskFor(state, level, nominal, timed)
      const timeLimitMs =
        warpReqAus === null
          ? undefined
          : Math.round(
              Math.max(1, nominal) * (ctx.balance.travel.warpRefAus / warpReqAus) * 60_000 * TIMED_COURIER_GRACE,
            )
      board.seq += 1
      board.courier.push({
        id: board.seq,
        kind: 'courier',
        goodKey: '',
        refId: '',
        need: 0,
        rewardIsk,
        level,
        volumeM3,
        stationId: picked.site.id,
        galaxyId: picked.site.galaxyId,
        ...(warpReqAus === null ? {} : { timed: true, warpReqAus, timeLimitMs }),
      })
    }
  }

  for (const key of affected) {
    const def = ctx.marketGoods.get(key)
    if (def) applySpawnMarketImpact(state, def)
  }
}

/** 已建成副空间站数量（快递解锁与"每站 +2 条"共用；= `isSiteBuilt` 的站点数） */
export function builtStationCount(state: GameState, ctx: SimContext): number {
  let n = 0
  for (const site of ctx.stations.values()) if (isSiteBuilt(state, site)) n += 1
  return n
}

/** 本板条数：基础 4 ＋ 每建成一座副站 +2（资源/快递各算一遍；快递仍需至少一座站才刷） */
export function taskCountsFor(state: GameState, ctx: SimContext): { resource: number; courier: number } {
  const n = SIDE_TASK_BASE_COUNT + SIDE_TASK_COUNT_PER_STATION * builtStationCount(state, ctx)
  return { resource: n, courier: n }
}

/**
 * **级别掷骰**（船长 2026-09-18：「L1~L4 任务至少要各出现」）：先保底铺 L1~L4，剩余席位按
 * "级别越高越可能"的权重掷（L1 10 / L2 15 / L3 20 / L4 25 / L5 30）⇒ 副站越多，高级任务越多。
 */
function rollLevels(state: GameState, count: number): SideTaskLevel[] {
  const out: SideTaskLevel[] = []
  for (const lv of SIDE_TASK_LEVELS) {
    if (out.length >= count) break
    if (lv <= 4) out.push(lv)
  }
  const weights: Array<[SideTaskLevel, number]> = [
    [1, 10],
    [2, 15],
    [3, 20],
    [4, 25],
    [5, 30],
  ]
  const total = weights.reduce((a, [, w]) => a + w, 0)
  while (out.length < count) {
    let r = nextRandom(state.rng) * total
    let picked: SideTaskLevel = 5
    for (const [lv, w] of weights) {
      r -= w
      if (r < 0) {
        picked = lv
        break
      }
    }
    out.push(picked)
  }
  return out
}

/* ═══════════ 赏金日板席位（2026-09-10 船长定：按安全等级抽地点、三档必现） ═══════════ */

/** 安全等级分区（沿用全仓口径：sec ≥ 0.5 高安 / 0 < sec < 0.5 中安 / **sec ≤ 0 低安（含 0）**）。
 *  ⚠ 2026-09-12 船长裁定「**0也算低安**」⇒ 边界由 `sec < 0` 移到 `sec ≤ 0`，与伏击掷骰同源
 *  （`balance.encounter.lowSecMax`）。烬火星区与回音荒区（均为 0.0）因此由中安池进低安池。 */
export type SecurityZone = '高安' | '中安' | '低安'

/** 该星系的安全分区（security 缺省按 0.5 视作高安，与残骸基础密度兜底同口径） */
export function securityZoneOf(ctx: SimContext, galaxyId: string): SecurityZone {
  const sec = ctx.galaxies.get(galaxyId)?.security
  const v = typeof sec === 'number' && Number.isFinite(sec) ? sec : 0.5
  if (v >= 0.5) return '高安'
  // 2026-09-12 船长「0也算低安」：中安是**开区间** (0, 0.5)，安全等级 0 归低安
  if (v > 0) return '中安'
  return '低安'
}

/**
 * 每日席位表（船长 2026-09-10 定）：
 * - **高安不派发**（排除后按候选数比例分：中安 2 席、低安 3 席，共 5 个地点）；
 * - 各区**独立抽**（抽不满就少发，不跨区补位）；同一天不重复星系。
 * 档位不再由声望封顶（旧规则已退役）：接取门槛只看卡自身的声望要求。
 */
export const BOUNTY_ZONE_PLAN: ReadonlyArray<{ zone: SecurityZone; count: number }> = [
  { zone: '中安', count: 2 },
  { zone: '低安', count: 3 },
]

/**
 * 当日档位分配（船长 2026-09-10 定：**由该地点地图级别封顶，逐卡独立掷，取消三档保底**）：
 * - 档位 = 在该卡 `[1..lairLevelOf(卡)]` 内均匀随机（硬封顶）：1 级图只出外围、2 级图到核心、3 级图全档；
 * - **不再保证"每天三档各至少一张"**（旧 rollLairTiers 的三档保底与洗牌随本改动退役）：
 *   当天候选全是低级图时，就可能一天都没有深层席——这是船长明确选择的取舍；
 * - 旧实现还要"再洗一次牌让档位与地点解耦"，本改动正是要建立"地点级别 → 档位上限"的关联，故一并去掉。
 */
function rollLairTierFor(state: GameState, anomaly: AnomalyDef): LairTier {
  const max = lairLevelOf(anomaly)
  return (1 + nextInt(state.rng, max)) as LairTier
}

/**
 * 赏金任务刷出（2026-09-10 船长定；当日修订②③④，同日晚些按船长新口径再改档位规则）：
 * 候选 = 已探索星系里「主题悬赏可作窝点（有核心词、非隐藏、奖金 > 0、**非 B 族**）」的卡
 * ——**声望不是刷出条件**，门槛只作**接取条件**（不够也能看见，出发被拒，见 expedition 前置检查）。
 * ① 按 `BOUNTY_ZONE_PLAN` 逐区抽地点（各区独立、抽不满少发）；同星系只留一张代表卡，
 *    **代表卡取该星系级别最高的一张**（并列取奖金最高）——否则"同星系两张卡谁进池"会由数据顺序决定，
 *    档位上限跟着随机漂移；
 * ② 档位 = 该地点**地图级别封顶**后逐卡独立掷（`rollLairTierFor`），**不再有三档保底**；
 * ③ 酬金与显示名随档位一并锁定（酬金 = 窝点奖金 × 档位比例）。
 * 与资源/快递不同：赏金任务不触碰市场（不产生刷单影响）。
 */
function spawnBountyTasks(state: GameState, ctx: SimContext): void {
  const board = state.sideTasks
  // 每区候选：可作窝点 + 星系已探索 + 同区不重复星系（每个星系留级别最高的那张代表卡）
  const poolByZone = new Map<SecurityZone, AnomalyDef[]>()
  /** 同星系**已见过的卡数**（蓄水池抽样的分母；2026-09-12 代表位改随机后需要） */
  const repSeen = new Map<string, number>()
  for (const a of ctx.anomalies.values()) {
    if (!isLairCandidate(a)) continue
    if (!state.exploredGalaxies.includes(a.galaxyId)) continue
    const zone = securityZoneOf(ctx, a.galaxyId)
    const list = poolByZone.get(zone) ?? []
    const idx = list.findIndex((x) => x.galaxyId === a.galaxyId)
    if (idx < 0) {
      list.push(a)
      repSeen.set(a.galaxyId, 1)
    } else {
      // **代表位 = 随机抽取**（船长 2026-09-12：「**派发代表位改为随机抽取**」）——
      // 旧口径 = 级别最高、并列取奖金最高（⇒ 同星系低级别卡**永不入板**、由数据顺序外的规则定死）。
      // 现口径 = 同星系每张卡**等概率**上位：标准**蓄水池抽样**（第 n 张以 1/n 概率替换当前代表）。
      const n = (repSeen.get(a.galaxyId) ?? 1) + 1
      repSeen.set(a.galaxyId, n)
      if (nextInt(state.rng, n) === 0) list[idx] = a
    }
    poolByZone.set(zone, list)
  }
  // ① 抽地点（逐区、各区独立抽）；派系活跃星系的席位已让给派系那条 → 从池里剔除
  const factionGid = factionGalaxyId(state)
  const picks: AnomalyDef[] = []
  for (const plan of BOUNTY_ZONE_PLAN) {
    const candidates = [...(poolByZone.get(plan.zone) ?? [])].filter((a) => a.galaxyId !== factionGid)
    const slots = Math.min(plan.count, candidates.length)
    for (let i = 0; i < slots; i += 1) {
      picks.push(candidates.splice(nextInt(state.rng, candidates.length), 1)[0]!)
    }
  }
  if (picks.length === 0) return
  // ② 档位 = 该地点地图级别封顶（逐卡独立掷，无三档保底）
  // ③ 落板
  for (const pick of picks) {
    const tier = rollLairTierFor(state, pick)
    board.seq += 1
    board.bounty.push({
      id: board.seq,
      kind: 'bounty',
      goodKey: '',
      refId: '',
      need: 0,
      // 限时倍率（2026-09-15）：`rewardIsk` 乘在任务奖励生成上
      rewardIsk: Math.max(0, Math.round(lairTaskRewardIsk(pick, tier) * rewardMulOf(state))),
      anomalyId: pick.id,
      galaxyId: pick.galaxyId,
      lairTier: tier,
      lairName: lairNameOf(pick, tier),
    })
  }
}

/** 引擎推进：快递投送到站结算——gameMs ≥ arriveAtGameMs 即到站：停靠目标副站（dockedSite =
 *  目标站 id、awayGalaxy = null）、完成原任务（仍在板上则下板；酬金按刷出时锁定值结算）、
 *  清空在途挂账。整板刷新不清除在途投送：完成始终按原任务 id/锁定酬金结算。 */
function advanceCourierDeliveries(state: GameState, ctx: SimContext): void {
  const d = state.sideTasks.deliver
  if (!d) return
  if (state.gameMs < d.arriveAtGameMs) return
  settleCourierDelivery(state, ctx, d)
}

/**
 * 任务板推进（引擎在 gameMs 前移、市场窗口已推进后调用）：
 * 1) 先结算已到站的快递投送（跨过整板刷新边界的投送先结算，原任务仍在板则顺带下板）；
 * 2) 本板周期 = orderLifeMs.common（20 分钟）。仅当市场已越过下一个 20 分钟整点
 *    （state.market.lastTickGameMs ≥ board.window + 周期）才执行一次刷新。
 * 离线大步长只结算一次：跨过 N 个周期时 window 一次性推进到"最后一个已越过的整点"、
 * 只在那一点刷一次（中间周期只推进窗口号、不重复扣量/抬价；船长 2026-09-05 拍板取
 * "仅末窗执行"，防 8 小时 24 轮冲击/扣量过度影响市场）。在途投送按真实时间推进照常结算。
 */
/**
 * 引擎推进：时效任务板。
 * - 资源/快递：市场「补给刷新」20 分钟一轮（`orderLifeMs.common`，按 gameMs 对齐）；
 * - 赏金：**独立日板**（2026-09-10 船长定）——24 小时一轮、**每天本地 0 点整板替换**，
 *   按**现实墙钟**对齐（`nowWallMs`），与 20 分钟板互不影响。
 */
export function advanceSideTasks(state: GameState, ctx: SimContext, nowWallMs?: number): void {
  advanceCourierDeliveries(state, ctx)
  advanceBountyBoard(state, ctx, nowWallMs)
  const board = state.sideTasks
  const period = boardPeriodMs(ctx)
  const nowBoundary = state.market.lastTickGameMs
  if (nowBoundary < board.window + period) return
  // 末个已越过的 20 分钟整点（board.window 为 0 = 未开盘，首个整点 = 开盘后第一个 20 分钟点）
  const targetBoundary = board.window + Math.floor((nowBoundary - board.window) / period) * period
  refreshBoard(state, ctx, targetBoundary)
}

/* ═══════════ 赏金日板（2026-09-10 船长定：24 小时一轮、每天本地 0 点整板替换） ═══════════ */

/** 赏金板周期 = 24 小时（一轮内有效；到下一个本地 0 点整板替换） */
export const BOUNTY_BOARD_PERIOD_MS = 24 * 3_600_000

/** 本地 0 点（该墙钟时刻所在自然日的起点；用本地时区，与玩家作息对齐） */
export function bountyDayStartWallMs(nowWallMs: number): number {
  const d = new Date(nowWallMs)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 距下一个本地 0 点的剩余毫秒（墙钟；0 = 无法判定（无有效墙钟）时按 0 处理） */
export function bountyBoardRemainingMs(nowWallMs: number): number {
  if (!Number.isFinite(nowWallMs) || nowWallMs <= 0) return 0
  const next = bountyDayStartWallMs(nowWallMs) + BOUNTY_BOARD_PERIOD_MS
  return Math.max(0, next - nowWallMs)
}

/**
 * 赏金板按日界刷新：`bountyWindow` = 上一次刷出的日界（本地 0 点墙钟毫秒）。
 * - 未跨日 → 原样保留（**声望/档位/酬金都在刷出时锁定，轮内不变**）；
 * - 跨日（含离线一夜/多日）→ 整板清空重刷，日界推进到"当前所在自然日的 0 点"
 *   （跨多日只补最后一道界：中间那些天的板早已作废）；
 * - 无有效墙钟（旧档 savedAtWallMs = 0）→ 不开日板（首次拿到真实墙钟时再开）。
 */
function advanceBountyBoard(state: GameState, ctx: SimContext, nowWallMs?: number): void {
  const board = state.sideTasks
  const now = nowWallMs ?? state.savedAtWallMs
  if (!Number.isFinite(now) || now <= 0) return
  const dayStart = bountyDayStartWallMs(now)
  const last = board.bountyWindow ?? 0
  if (dayStart <= last) return
  board.bounty = []
  board.bountyWindow = dayStart
  // 派系活跃先选（它选的星系从常规席位抽签池里剔除），再抽 5 席
  spawnFactionActivity(state, ctx)
  spawnBountyTasks(state, ctx)
}

/* ── 敌对派系活跃（2026-09-10 船长定：每天一个中安/低安星系，只作用于该星系的常驻悬赏） ── */

/**
 * **入侵进行中 ⇒ 敌对派系活跃整体停摆**（**船长 2026-09-25 令：「建议当出现入侵时，关闭敌方势力活跃。」**）。
 *
 * 判据 = `state.weekendEvent` 存在且**尚未落定结束时刻**（`endedAtWallMs === undefined`）——
 * 与"占领区还算不算被占"同一把尺（`weekendOccupiedLiveAt` 用的也是这一条）；活动结束（结算那一刻起）
 * **自动恢复**：当天那条派系活跃照旧在板（板上条目一直在滚，只是这期间不生效）。
 *
 * 停摆面（`factionGalaxyId` / 任务中心视图两处收口 ⇒ 全部下游一起静默）：
 * 星图 ✦ 标记与方框、任务中心置顶那条派系活跃卡、悬赏卡的 ×1.1 奖金/威胁、稀有残骸掷骰与保底计数。
 *
 * ⚠ 为什么读 `state.weekendEvent` 而不 import `weekendEvent`：那个模块 import 本模块的
 * `securityZoneOf`（依赖方向既定）⇒ 反向 import 会成环；这里只读状态字段，零依赖。
 */
export function factionSuppressedByInvasion(state: GameState): boolean {
  const ev = state.weekendEvent
  return ev !== undefined && ev.endedAtWallMs === undefined
}

/** 该星系是不是**活的占领区**（入侵活动进行中且该星系在占领名单里）——派系活跃候选要给它让位 */
function occupiedByInvasion(state: GameState, galaxyId: string): boolean {
  const ev = state.weekendEvent
  if (ev === undefined || ev.endedAtWallMs !== undefined) return false
  return galaxyId === ev.coreId || ev.peripheryIds.includes(galaxyId)
}

/**
 * 派系活跃候选池（每星系一席 = 代表卡）：
 * - 条件 = **窝点候选**（`isLairCandidate`：有核心词 + 非隐藏 + 奖金 > 0 + **非 B 族**）+ **已探索** + **非高安**；
 * - **2026-09-11 船长追加裁决「B 族（武装拾荒者）没有窝点，排除出赏金范围」** ⇒ 本池由 `hasLairCore`
 *   改判 `isLairCandidate`：**B 族不再参与派系活跃抽卡**（此前 B 卡带 `lairCore`，只因所在星系都是高安
 *   才没被抽中——属"侥幸不中"，现在改成**规则上不参与**）。
 * - **2026-09-10 船长定：已建成副站的星系排除出抽取范围**（玩家的家不再被派系活跃锁定）。
 *   口径 = **已建成**（`isGalaxyStationBuilt`）才排除，在建/未开工的工地仍可当选；
 *   抽取只在日板刷新时发生 ⇒ **次日起生效**（当日已抽中的不动）；
 *   候选为空（例如候选星系全已建站）= 当日不发派系活跃（`spawnFactionActivity` 里 return）。
 * - **2026-09-25 加：被入侵的星系让位**（设计稿 `weekend-invasion.md` 既有条目「被占星系从当日派系活跃
 *   候选里让位（避免"既被入侵又是活跃星系"两套叠加）」）⇒ 入侵进行中，占领名单里的星系不进池。
 */
export function factionPoolOf(state: GameState, ctx: SimContext): AnomalyDef[] {
  const byGalaxy = new Map<string, AnomalyDef[]>()
  for (const a of ctx.anomalies.values()) {
    if (!isLairCandidate(a)) continue
    if (!(a.rewardIsk > 0)) continue
    if (!state.exploredGalaxies.includes(a.galaxyId)) continue
    if (securityZoneOf(ctx, a.galaxyId) === '高安') continue
    if (isGalaxyStationBuilt(state, ctx, a.galaxyId)) continue
    if (occupiedByInvasion(state, a.galaxyId)) continue
    const arr = byGalaxy.get(a.galaxyId) ?? []
    arr.push(a)
    byGalaxy.set(a.galaxyId, arr)
  }
  // **每星系一席 = 代表卡**，且**代表位改随机抽取**（船长 2026-09-12「派发代表位改为随机抽取」）——
  // 旧口径 = 该星系**第一张**（数据顺序，等于由 anomalies.ts 的书写顺序决定）；现 = 同星系**等概率**抽一张。
  const pool: AnomalyDef[] = []
  for (const arr of byGalaxy.values()) {
    pool.push(arr.length === 1 ? arr[0]! : arr[nextInt(state.rng, arr.length)]!)
  }
  return pool
}

/**
 * 选当天的派系活跃星系（每天一条、置顶显示）：
 * - 候选 = `factionPoolOf`（已探索的**中安/低安**星系里"有正经悬赏卡（非隐藏、有核心词、奖金 > 0）"的，
 *   且**排除已建成副站的星系**——2026-09-10 船长定）；
 * - 该星系的**全部可见悬赏**当天吃 +10% 奖金 / +10% 威胁；胜利后按概率掉稀有残骸；
 * - **不因打赢而下板**：当天可反复刷（掉落概率与保底口径见 `FACTION_RARE_DROP_CHANCE` /
 *   `FACTION_RARE_DROP_PITY_ROLLS`——2026-09-20 船长把出率与保底一并提高，派系活跃已成为稀有残骸的主力供给之一）。
 */
function spawnFactionActivity(state: GameState, ctx: SimContext): void {
  const board = state.sideTasks
  const pool = factionPoolOf(state, ctx)
  board.faction = null
  if (pool.length === 0) return
  const pick = pool[nextInt(state.rng, pool.length)]!
  board.seq += 1
  board.faction = {
    id: board.seq,
    kind: 'faction',
    goodKey: '',
    refId: '',
    need: 0,
    // 展示口径 = 加成后的悬赏奖金（实付在战斗结算里按卡 ×1.1 现算）
    rewardIsk: Math.max(0, Math.round(factionBaseRewardIsk(pick) * rewardMulOf(state))),
    anomalyId: pick.id,
    galaxyId: pick.galaxyId,
    factionAnomalyName: pick.name,
  }
}

/**
 * 当日派系活跃目标星系（null = 今日无/未开板）——战斗与界面共用同一个判定口。
 * **2026-09-25**：入侵进行中恒返回 `null`（见 `factionSuppressedByInvasion`）⇒ 星图标记、行动窗行、
 * 悬赏加成、稀有残骸掷骰一起停摆；活动结束自动恢复（板上那条一直在滚，不需重抽）。
 */
export function factionGalaxyId(state: GameState): string | null {
  if (factionSuppressedByInvasion(state)) return null
  const f = state.sideTasks.faction
  return f && f.galaxyId ? f.galaxyId : null
}

/** 某张悬赏卡当天是否吃派系活跃加成（该星系当日全部可见悬赏都吃） */
export function isFactionBounty(state: GameState, anomaly: AnomalyDef): boolean {
  const gid = factionGalaxyId(state)
  return gid !== null && anomaly.galaxyId === gid && anomaly.hidden !== true
}

/** 快递在途投送只读视图（UI 渲染用；remainingMs 随 gameMs 自然缩短） */
export interface SideTaskDeliveryView {
  /** 原任务稳定 id（整板刷新后任务不在板仍按它结算） */
  taskId: number
  /** 老档真实货物时非空；**虚拟货物时代为空串** */
  refId: string
  /** 老档真实货物单位数；**虚拟货物时代为 0** */
  need: number
  /** **虚拟货物占用体积（m³）**（2026-09-18 起） */
  volumeM3: number
  /** 任务级别（1~5） */
  level: 1 | 2 | 3 | 4 | 5
  /** 是否限时快递（到站超时 ⇒ 无报酬） */
  timed: boolean
  stationId: string
  galaxyId: string
  stationName: string
  galaxyName: string
  /** 距到站剩余毫秒（0 = 已到站待引擎结算瞬间） */
  remainingMs: number
  /** 限时快递：距截止剩余毫秒（负数 = 已超时，到站不发酬金；非限时 = null） */
  deadlineRemainingMs: number | null
}

/** 任务板只读视图（UI 直接渲染用；倒计时随 gameMs 自然缩短，每秒刷新） */
export interface SideTaskBoardView {
  /** 资源任务（当前轮；未到首个 20 分钟整点 = 空） */
  resource: readonly SideTask[]
  /** 快递任务（当前轮；副站建成解锁后才有） */
  courier: readonly SideTask[]
  /** **已接单的快递**（跨整板刷新保留；出发/放弃才离场） */
  accepted: readonly SideTask[]
  /** 赏金任务（当日板；已探索星系里的高难窝点，每天 5 席） */
  bounty: readonly SideTask[]
  /** 敌对派系活跃（当日一条、界面置顶；目标 = 该星系**常驻悬赏**，+10% 奖金/+10% 威胁、胜利概率掉稀有残骸） */
  faction: SideTask | null
  /** 快递任务当前是否解锁（已建成任一副空间站） */
  courierUnlocked: boolean
  /** 快递投送在途挂账视图（一次一笔；null = 无） */
  deliver: SideTaskDeliveryView | null
  /** 本板已开盘（首个 20 分钟整点已刷出过任务）；false = 等首个整点 */
  opened: boolean
  /** 距下一个 20 分钟整点（**资源**本轮到点整板替换）的剩余毫秒；未开盘 = 距首个整点 */
  remainingMs: number
  /**
   * 距下一个 **120 分钟**整点（**快递**本批到点整板替换）的剩余毫秒——与 `remainingMs` 分族各报
   * （2026-09-24 船长令：快递周期与存活都是 120 分钟，资源仍 20 分钟）。
   */
  courierRemainingMs: number
  /** 赏金日板已开板（至少刷出过一次）；false = 还没拿到有效墙钟（旧档首帧） */
  bountyOpened: boolean
  /** 距下一个本地 0 点（赏金整板替换）的剩余毫秒（墙钟；未开板 = 0） */
  bountyRemainingMs: number
  /**
   * **这一板赏金任务玩家还没看过**（2026-09-14 船长：换板未看 = 提示）——导航「任务中心」徽标读它。
   * 进「任务中心」页会记账（`sideTasksMarkBountySeen`）⇒ 立刻变 false。
   */
  bountyFresh: boolean
  /** 未看过这一板时的条数（= 该板赏金任务数；看过 / 未开板 = 0）——徽标数字 */
  bountyNewCount: number
}

/** 只读查询：任务板 + 到期倒计时 + 快递在途投送（UI 展示资源/快递时效任务区用）。
 *  倒计时三套：`remainingMs` = **资源**的 20 分钟整点 · `courierRemainingMs` = **快递**的下一个 120 分钟
 *  整点（2026-09-24 船长令：快递周期/存活都是 120 分钟）· `bountyRemainingMs` = 赏金每日 0 点。
 *  nowWallMs = 当前墙钟（UI 心跳传入；缺省退 `state.savedAtWallMs`）。 */
export function sideTaskBoard(state: GameState, ctx: SimContext, nowWallMs?: number): SideTaskBoardView {
  const board = state.sideTasks
  const period = boardPeriodMs(ctx)
  const opened = board.window > 0
  let remainingMs: number
  if (opened) {
    // 已开盘：距"本轮到点（下一 20 分钟整点）"的剩余
    remainingMs = Math.max(0, board.window + period - state.gameMs)
  } else {
    // 未开盘：距首个 20 分钟整点的剩余（口径 = 距下一 20 分钟点）
    const nextPoint = (Math.floor(state.gameMs / period) + 1) * period
    remainingMs = Math.max(0, nextPoint - state.gameMs)
  }
  const bountyWindow = board.bountyWindow ?? 0
  const now = nowWallMs ?? state.savedAtWallMs
  const bountyOpened = bountyWindow > 0
  /**
   * **换板未看**（船长 2026-09-14 定的判定基准）：当前日界 > 玩家看过的日界 ⇒ 有新板没看过。
   * 老档没有 `bountySeenWindow`（= 0）而日界 > 0 ⇒ **首帧为 true**（船长：「**老档默认亮起提示**」）。
   */
  const bountyFresh = bountyOpened && bountyWindow > (board.bountySeenWindow ?? 0)
  const d = board.deliver
  return {
    resource: board.resource,
    courier: board.courier,
    accepted: board.accepted ?? [],
    bounty: board.bounty,
    // **入侵期间不显示**（船长 2026-09-25；判据与 `factionGalaxyId` 同源）——板上条目照旧在滚，只是不上屏
    faction: factionSuppressedByInvasion(state) ? null : (board.faction ?? null),
    courierUnlocked: courierTaskUnlocked(state, ctx),
    deliver: d
      ? {
          taskId: d.taskId,
          refId: d.refId,
          need: d.need,
          volumeM3: d.volumeM3 ?? 0,
          level: d.level ?? 1,
          timed: d.timed === true,
          stationId: d.stationId,
          galaxyId: d.galaxyId,
          stationName: ctx.stations.get(d.stationId)?.name ?? d.stationId,
          galaxyName: ctx.galaxies.get(d.galaxyId)?.name ?? d.galaxyId,
          remainingMs: Math.max(0, d.arriveAtGameMs - state.gameMs),
          deadlineRemainingMs:
            d.deadlineAtGameMs === undefined ? null : d.deadlineAtGameMs - state.gameMs,
        }
      : null,
    opened,
    remainingMs,
    /**
     * **快递本批的剩余**（到下一个 120 分钟整点）——与 `remainingMs`（资源 20 分钟）**分开报**：
     * 两族节奏不同（2026-09-24 船长令），界面各按各的倒计时显示，别再拿 20 分钟的数字套在快递头上。
     */
    courierRemainingMs: Math.max(0, courierDeadlineMs(board.window) - state.gameMs),
    bountyOpened,
    bountyRemainingMs: bountyOpened ? bountyBoardRemainingMs(now) : 0,
    bountyFresh,
    bountyNewCount: bountyFresh ? board.bounty.length : 0,
  }
}

/**
 * **记账：玩家看过这一天的赏金板了**（船长 2026-09-14：「当任务中心有新的赏金任务时，提示玩家，
 * **玩家进入后消除提示**」）——界面在**进入「任务中心」页**时调用（点导航、通讯「前往」、教程跳转
 * 三条入口都会走到那一步）；**幂等**：同一天重复调用不写第二次。
 *
 * @returns 是否真的记了一笔（未开板 / 已经记过 ⇒ false；给用例与调试读数用）
 */
export function sideTasksMarkBountySeen(state: GameState): boolean {
  const board = state.sideTasks
  const day = board.bountyWindow ?? 0
  if (day <= 0) return false // 还没开板（旧档首帧、无有效墙钟）：无从记账
  if ((board.bountySeenWindow ?? 0) >= day) return false // 这一板已经看过
  board.bountySeenWindow = day
  return true
}

/**
 * 赏金任务完成（2026-09-10 船长定）：由战斗**胜利结算**调用（失败/撤退不会走到这里）。
 * 命中本板赏金任务（按目标悬赏 id）→ ①追加酬金入账 ②该条下板 ③写日志（含"可前往打捞"引导）。
 * 未命中 = 无事发生（普通常驻悬赏/别的目标）。
 *
 * 稀有残骸的**投放**不在这里：由出击侧（expedition）按本场实际档位统一投放——这样即使任务
 * 已过期下板，玩家照样打完窝点、照样能捞到稀有残骸；本函数只负责酬金与文案。
 */
export function settleBountyTaskVictory(
  state: GameState,
  ctx: SimContext,
  anomalyId: string,
  rareGain: number,
): void {
  const board = state.sideTasks
  const idx = (board.bounty ?? []).findIndex((t) => t.anomalyId === anomalyId)
  if (idx < 0) return
  const task = board.bounty[idx]!
  board.bounty.splice(idx, 1)
  state.wallet.isk += task.rewardIsk
  const galaxyId = task.galaxyId ?? ctx.anomalies.get(anomalyId)?.galaxyId ?? ''
  const galaxyName = ctx.galaxies.get(galaxyId)?.name ?? galaxyId
  addLog(
    state,
    'trade',
    `赏金任务完成：${task.lairName ?? anomalyId} 已肃清（${galaxyName}），酬金 ${task.rewardIsk.toLocaleString('zh-CN')} 信用点已入账；` +
      `战场留下稀有残骸 ×${rareGain}——可前往该星系打捞（回站用回收炉解体可得额外战利品）。`,
  )
}

/** 是否正在快递投送（在途；一次一笔）。其余出航作业的 start* 守卫据此拒绝并发 */
export function courierDelivering(state: GameState): boolean {
  return state.sideTasks.deliver !== null
}

/**
 * 玩家指令：完成一条资源时效任务（仓库足量扣货交付 → 现金入账 → 该条移出本轮板）。
 * 快递任务不在此完成：需先「出发投送」（真实航程到站后引擎自动结算）。
 * - 条件：该条仍在当前轮板（未过期/未到 20 分钟整点被替换）；物品仓库持有 ≥ need；
 * - 动作：仓库扣除 need → 现金入账 rewardIsk → 该条移出本轮板（同轮其余任务不受影响）；
 * - 不给声望。
 */
export function completeSideTask(
  state: GameState,
  ctx: SimContext,
  kind: SideTask['kind'],
  id: number,
): CommandResult {
  if (kind === 'courier') {
    return {
      ok: false,
      error: '快递任务需先「出发投送」——货物由出发时从仓库锁定扣出，按真实航程到站后自动结算。',
      errorId: 'core.sideTasks.001',
    }
  }
  const board = state.sideTasks
  const list = board.resource
  const idx = list.findIndex((t) => t.id === id)
  if (idx < 0) {
    return { ok: false, error: '该任务已不存在——可能已完成，或已随整板刷新被替换。', errorId: 'core.sideTasks.002' }
  }
  const task = list[idx]!
  // 到期护栏：游戏时间已越过本轮到点（下一 20 分钟整点，引擎尚未推进刷新）时拒绝，防"卡点结算过期任务"
  if (state.gameMs >= board.window + boardPeriodMs(ctx)) {
    return { ok: false, error: '该任务已到期——新一批任务即将刷新。', errorId: 'core.sideTasks.003' }
  }
  const name = ctx.items.get(task.refId)?.name ?? task.refId
  const have = countWare(state, task.refId)
  if (have < task.need) {
    return {
      ok: false,
      error: `物品仓库中的 ${name} 不足：还差 ${(task.need - have).toLocaleString('zh-CN')} 单位（任务需 ${task.need.toLocaleString('zh-CN')}，现有 ${have.toLocaleString('zh-CN')}）。`,
      errorId: 'core.sideTasks.005',
      errorParams: {
        p1: name,
        p2: (task.need - have).toLocaleString('zh-CN'),
        p3: task.need.toLocaleString('zh-CN'),
        p4: have.toLocaleString('zh-CN'),
      },
    }
  }
  if (!removeWare(state, task.refId, task.need)) {
    return { ok: false, error: `${name} 出库失败（库存不足）。`, errorId: 'core.sideTasks.006', errorParams: { p1: name } }
  }
  list.splice(idx, 1)
  state.wallet.isk += task.rewardIsk
  // 船长 2026-09-18：「资源任务的市场联动涨价（只有涨价部分）会在任务完成后移除」
  refundSpawnShock(state, task.goodKey)
  addLog(
    state,
    'trade',
    `资源任务完成（L${task.level ?? 1}）：协会收购 ${name}×${task.need.toLocaleString('zh-CN')}（自仓库交付），` +
      `奖励 ${task.rewardIsk.toLocaleString('zh-CN')} 信用点已入账。`,
  )
  return { ok: true }
}

/**
 * 快递到站结算（引擎到点调用 / 零航程出发即时调用共用）：
 * 置停靠目标副站（dockedSite = 目标站 id、awayGalaxy = null）→ 原任务仍在板/已接单则按 taskId 离场
 * → **限时快递超时判甲案**（船长 2026-09-18：**无报酬**、任务作废）→ 否则奖励入账 → 清空在途挂账 → 日志。
 * 虚拟货物：到站即释放体积（不在货仓里，无实物可卸）。
 */
function settleCourierDelivery(state: GameState, ctx: SimContext, d: CourierDeliveryState): void {
  const board = state.sideTasks
  // 到站：停靠目标副站（该站若已不再是建成站点/星系未知——异常兜底回母港）
  state.awayGalaxy = null
  const site = ctx.stations.get(d.stationId)
  if (site && isSiteBuilt(state, site) && ctx.galaxies.has(d.galaxyId)) {
    state.dockedSite = site.id
  } else {
    state.dockedSite = null
  }
  const idx = board.courier.findIndex((t) => t.id === d.taskId)
  if (idx >= 0) board.courier.splice(idx, 1)
  const aIdx = (board.accepted ?? []).findIndex((t) => t.id === d.taskId)
  if (aIdx >= 0) board.accepted!.splice(aIdx, 1)
  const siteName = ctx.stations.get(d.stationId)?.name ?? d.stationId
  const galaxyName = ctx.galaxies.get(d.galaxyId)?.name ?? d.galaxyId
  const vol = d.volumeM3 ?? 0
  const timedOut = d.timed === true && d.deadlineAtGameMs !== undefined && state.gameMs > d.deadlineAtGameMs
  if (timedOut) {
    // 甲案：限时快递超时 ⇒ 无报酬、任务作废（货已送达，但协会不付运费）
    board.deliver = null
    addLog(
      state,
      'warn',
      `限时快递超时：${vol.toLocaleString('zh-CN')} m³ 已送达「${siteName}」（${galaxyName}），` +
        `但未在时限内抵达——本单无报酬（L${d.level ?? 1} 限时快递作废）。`,
    )
    return
  }
  state.wallet.isk += d.rewardIsk
  board.deliver = null
  addLog(
    state,
    'trade',
    `快递投送完成（L${d.level ?? 1}${d.timed === true ? ' · 限时' : ''}）：${vol.toLocaleString('zh-CN')} m³ 已送达` +
      `「${siteName}」（${galaxyName}），运费 ${d.rewardIsk.toLocaleString('zh-CN')} 信用点已入账。`,
  )
}

/** 在途快递占用的货舱体积（m³；虚拟货物——只有体积属性，CargoPage 与容量判定读它） */
export function courierOccupiedM3(state: GameState): number {
  return state.sideTasks.deliver?.volumeM3 ?? 0
}

/**
 * 玩家指令：**接单**（船长 2026-09-18：「接取的快递任务不会被刷掉」）。
 * 把一条快递从"本板"移进 `sideTasks.accepted`（上限 `COURIER_ACCEPT_MAX`）——此后**整板刷新不动它**，
 * 玩家可以慢慢换船/等货仓腾空再出发。**接单不校验舰船**（限时快递的跃迁门槛在**出发**时才校验）。
 */
export function acceptCourierTask(state: GameState, id: number): CommandResult {
  const board = state.sideTasks
  const idx = board.courier.findIndex((t) => t.id === id)
  if (idx < 0) {
    return { ok: false, error: '该任务已不存在——可能已完成，或已随整板刷新被替换。', errorId: 'core.sideTasks.002' }
  }
  const accepted = (board.accepted ??= [])
  if (accepted.length >= COURIER_ACCEPT_MAX) {
    return {
      ok: false,
      error: `已接单 ${COURIER_ACCEPT_MAX} 单（上限）：先出发完成一单，或放弃一单再来接。`,
      errorId: 'core.sideTasks.007',
      errorParams: { p1: COURIER_ACCEPT_MAX },
    }
  }
  const task = board.courier[idx]!
  board.courier.splice(idx, 1)
  accepted.push(task)
  addLog(
    state,
    'info',
    `已接单（L${task.level ?? 1} 快递 · ${(task.volumeM3 ?? 0).toLocaleString('zh-CN')} m³）：` +
      `此单不再随任务板刷新消失，随时可出发投送。`,
  )
  return { ok: true }
}

/** 玩家指令：**放弃已接单**的快递（腾出接单名额；该单作废，不再回板上） */
export function abandonAcceptedCourierTask(state: GameState, id: number): CommandResult {
  const accepted = state.sideTasks.accepted ?? []
  const idx = accepted.findIndex((t) => t.id === id)
  if (idx < 0) return { ok: false, error: '该单不在"已接单"列表里。', errorId: 'core.sideTasks.008' }
  accepted.splice(idx, 1)
  return { ok: true }
}

/** 找一条快递任务（板上 ∪ 已接单） */
function findCourierTask(state: GameState, id: number): { task: SideTask; accepted: boolean } | null {
  const board = state.sideTasks
  const onBoard = board.courier.find((t) => t.id === id)
  if (onBoard) return { task: onBoard, accepted: false }
  const acc = (board.accepted ?? []).find((t) => t.id === id)
  return acc ? { task: acc, accepted: true } : null
}

/**
 * 玩家指令：快递「出发投送」（虚拟货物 · 2026-09-18 船长改版）。
 * - 条件：该条在**板上**（未过期）或**已接单**（不过期）；同一时刻只允许一笔投送；舰船空闲；
 *   **货舱容量 ≥ 任务体积**（体积不够的方案直接拒）；**限时快递**还要求当前舰船跃迁速度 ≥ 门槛；
 * - 动作：把**真实货物卸进仓库**（虚拟货物占仓语义）→ 按"当前位置 → 目标站星系"真实航程锁定
 *   arriveAtGameMs；限时快递同时锁 deadlineAtGameMs（甲案：超时无报酬）；
 *   同星系零航程时立即到站结算。
 */
export function startCourierDelivery(state: GameState, ctx: SimContext, id: number): CommandResult {
  const board = state.sideTasks
  if (board.deliver !== null) {
    return {
      ok: false,
      error: '快递投送途中：同一时间只能投送一笔——请先等当前投送到站结算，再出发下一单。',
      errorId: 'core.sideTasks.009',
    }
  }
  const found = findCourierTask(state, id)
  if (!found) {
    return { ok: false, error: '该任务已不存在——可能已完成，或已随整板刷新被替换。', errorId: 'core.sideTasks.002' }
  }
  const task = found.task
  /**
   * 到期护栏：板上任务在**本批快递到点**（下一个 120 分钟整点）后作废；**已接单的不受此限**。
   *
   * ⚠ **2026-09-24 修（船长报障「卡片上和快递任务页面写的还是 20 分钟」的根因那一半）**：这里原先与资源
   * 任务共用 `boardPeriodMs`（20 分钟）——快递批次实际存活 120 分钟，于是**抽到手超过 20 分钟的单子
   * 会被判"已到期"拒发**（板上明明还挂着）。现按快递自己的到期时刻 `courierDeadlineMs` 判。
   */
  if (!found.accepted && state.gameMs >= courierDeadlineMs(board.window)) {
    return {
      ok: false,
      error: '该任务已到期——新一批任务即将刷新（可先「接单」保住它）。',
      errorId: 'core.sideTasks.004',
    }
  }
  /**
   * **出发地 = 母港：不在母港就"自动返航"过去**（**2026-09-20 船长**：「**出发不用加守卫，
   * 点击出发后自动返回母港**」）。
   *
   * 为什么要从母港：投送的**报酬与限时**本来就按「**母港 → 目标副站**」的标称航程标定
   * （见刷出处的 `shortestTravelMinutes(ctx, HOME_GALAXY_ID, …)`），而**真实航程**此前按
   * "玩家当前所在星系"算 ⇒ 到站结算会把人留在目标副站（`settleCourierDelivery`），
   * 下一单航程可能短到 0（`arriveAt <= departAt` 那条"立即结算"分支）⇒ **白拿母港级运费**。
   *
   * 现口径：**照旧允许在任意位置点出发**，但点下去先把舰船送回母港（与 `location.startTransitHome`
   * 定稿的"**换港返航即时到站、去程取消**"同一口径 ⇒ 返航段不耗时间），随后按"母港 → 目标"投送
   * ⇒ **报酬、限时、真实航程三者同源**，且不额外惩罚玩家一段返航时间。
   * ⚠ 位置复位放在**全部前置校验之后**（货舱/跃迁门槛/目标可用/航路可达都过了才动人），
   * 免得"先把人送回母港、再告诉他这单发不了"。
   */
  const targetSite = resolveCourierTarget(state, ctx, task)
  if (!targetSite) {
    return {
      ok: false,
      error: '目标副站不可用（未建成或星系未知）——暂时无法投送该单。',
      errorId: 'core.sideTasks.015',
    }
  }
  const vol = task.volumeM3 ?? 0
  const cap = cargoCapacityM3Of(state, ctx, state.shipId)
  if (vol > cap) {
    return {
      ok: false,
      error: `当前舰船货舱不足：本单需 ${vol.toLocaleString('zh-CN')} m³，本舰货舱 ${cap.toLocaleString('zh-CN')} m³——换一艘更大的船再来。`,
      errorId: 'core.sideTasks.016',
      errorParams: { p1: vol.toLocaleString('zh-CN'), p2: cap.toLocaleString('zh-CN') },
    }
  }
  // 限时快递：跃迁速度门槛（船长 2026-09-18「限时快递对玩家舰船的跃迁速度有要求」）
  if (task.timed === true && task.warpReqAus !== undefined) {
    const warp = warpSpeedAus(state, ctx, state.shipId)
    if (warp + 1e-9 < task.warpReqAus) {
      return {
        ok: false,
        error: `限时快递要求跃迁速度 ≥ ${task.warpReqAus} AU/s（当前舰船 ${warp.toFixed(2)} AU/s）——换船或装跃迁计算机。`,
        errorId: 'core.sideTasks.017',
        errorParams: { p1: task.warpReqAus, p2: warp.toFixed(2) },
      }
    }
  }
  /**
   * 真实航程：**母港 → 目标副站所在星系**（出发时锁定）。
   * ⚠ **2026-09-20 船长**：「所有快递任务，起点都是从母港触发」——原来这里用的是
   * `originGalaxyOf(state, ctx)`（玩家当前星系），与报酬/时限的"母港标称航程"不同源，
   * 停靠副站后能短程甚至零程结算；现与刷出处同一把尺（见上面的"自动返航母港"口径）。
   */
  const from = HOME_GALAXY_ID
  const travelMin = shortestTravelMinutes(ctx, from, targetSite.galaxyId)
  if (!Number.isFinite(travelMin)) {
    const targetName = ctx.galaxies.get(targetSite.galaxyId)?.name ?? targetSite.galaxyId
    return {
      ok: false,
      error: `「${targetName}」不在当前可达航路内，无法出发投送。`,
      errorId: 'core.sideTasks.018',
      errorParams: { p1: targetName },
    }
  }
  /**
   * **其余主控活动 ⇒ 走统一判据**（**2026-09-21 船长令**：能直接切就自动取消当前活动，只有长途运输
   * 那一档先警告；远征/快递/战斗中/洞里/返航途中一律拒）——原先这里散着 5 条硬拒，现已收进
   * `activityGate.applyActivityGate`。⚠ 放在**本入口自己的前置校验之后**（任务存在/到期/目标站/货舱/
   * 跃迁门槛/航路），免得"先停了玩家的活、再说这单发不了"。
   */
  const gateSkip = applyActivityGate(state, 'deliver')
  if (gateSkip) return gateSkip
  // 虚拟货物：真实货物卸进仓库（不消耗任何物品；货舱被虚拟货物按体积占用）
  const unloaded = unloadCargoOfShipToWarehouse(state, ctx, state.shipId)
  /**
   * **不在母港 ⇒ 先把舰船送回母港**（见上面的口径注）：与 `location.startTransitHome` 的
   * 「换港返航即时到站」同一把尺（不耗时间），只复位位置与残留行程字段。
   * ⚠ 放在所有前置校验之后（这一行之前已经有：忙碌互斥 / 目标可用 / 货舱 / 跃迁门槛 / 航路可达）。
   */
  const returnedHome = !isAtHome(state)
  if (returnedHome) {
    const fromName = ctx.galaxies.get(originGalaxyOf(state, ctx))?.name ?? '外边'
    state.awayGalaxy = null
    state.dockedSite = null
    state.transit.active = false
    state.transit.fromGalaxy = null
    state.transit.toGalaxy = null
    state.transit.finishAtGameMs = 0
    state.transit.legMs = 0
    state.transit.delivery = null
    addLog(
      state,
      'info',
      `快递出发：舰船先自动返航母港（自「${fromName}」），再按母港航线投送。`,
      'core.sideTasks.020',
      { p1: fromName },
    )
  }
  const departAt = state.gameMs
  const arriveAt = departAt + travelLegMs(state, ctx, travelMin)
  const deadlineAt = task.timed === true && task.timeLimitMs !== undefined ? departAt + task.timeLimitMs : undefined
  const d: CourierDeliveryState = {
    taskId: task.id,
    goodKey: '',
    refId: '',
    need: 0,
    stationId: targetSite.id,
    galaxyId: targetSite.galaxyId,
    departAtGameMs: departAt,
    arriveAtGameMs: arriveAt,
    rewardIsk: task.rewardIsk,
    volumeM3: vol,
    level: task.level ?? 1,
    ...(deadlineAt === undefined ? {} : { timed: true, deadlineAtGameMs: deadlineAt }),
  }
  const siteName = ctx.stations.get(targetSite.id)?.name ?? targetSite.id
  const galaxyName = ctx.galaxies.get(targetSite.galaxyId)?.name ?? targetSite.galaxyId
  if (arriveAt <= departAt) {
    // 零航程（已停靠目标副站所在星系）：立即到站结算
    board.deliver = d
    settleCourierDelivery(state, ctx, d)
    return { ok: true }
  }
  board.deliver = d
  const limitNote =
    deadlineAt === undefined
      ? ''
      : `（限时快递：需在 ${Math.max(1, Math.round((deadlineAt - departAt) / 60_000))} 分钟内抵达，超时无报酬）`
  addLog(
    state,
    'info',
    `快递出发（L${d.level ?? 1}）：虚拟货物 ${vol.toLocaleString('zh-CN')} m³ 已装舱` +
      `${unloaded > 0 ? `（原有货物 ${unloaded} 单位已卸入仓库）` : ''}，驶往「${siteName}」（${galaxyName}），` +
      `预计航行约 ${Math.max(1, travelMinutesEff(state, ctx, travelMin))} 分钟${limitNote}。`,
  )
  return { ok: true }
}

/** 供测试/存档往返核对用：读取任务板原始状态（不重新计算任何东西） */
export function sideTasksStateOf(state: GameState): SideTasksState {
  return state.sideTasks
}
