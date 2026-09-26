/**
 * **虫洞扫描（发现线）**（船长 2026-09-14 定案）：
 * 「新增主控活动：'扫描虫洞'。玩家需要在扫描虫洞界面内开始。在扫描的过程中，玩家遭遇随机事件的期望和星图中的
 * 扫描一致。并且会上涨一个进度条，进度条满后。玩家就可以发现一个虫洞。玩家最多可以囤积5个未开始探索的虫洞。」
 *
 * 口径（design §三 / §五，全部船长确认）：
 * - **扫描窗口 = 12 小时 × 三技能乘算 × 星际奇遇学**（信号分析学 −8%/级 · 星图测绘学 −6%/级 · 信号过滤学 −6%/级，
 *   直接复用 `explore.scanSkillFactor` —— 与星图扫描**同一把尺**；**再乘一项虫洞专属的星际奇遇学**
 *   **每级 −4%、满级恰 −20%**，见 `happeningsScanFactor`）；**不吃舰船属性**（船长：「无关」）。
 *   ⚠ 基准沿革：2026-09-14 首定 **220 分钟** ⇒ 同日改判「**虫洞扫描时长提高到12小时**」⇒ **现值 12 小时**。
 * - **随机事件期望与星图扫描同源**：暴露口径交给 `encounters`（本活动在暴露清单里与 `state.scanning` 并列）。
 * - **遇袭不中断**：被打不影响进度（进度按游戏时刻推进，不在遇袭时清零）。
 * - 进度满 ⇒ **发现 1 个虫洞**（随机种子 + **起始层恒 1** + 原型/敌族按种子定）进库存，随后**自动续扫**。
 * - **库存上限 5**；满则**扫描停机**并提示（船长：「扫描停机并提示」）。
 * - **解锁当次送一格**（船长 2026-09-14 四步闸门裁定「甲」）：「**当玩家解锁虫洞时，让虫洞的进度条初始为
 *   100%（也就是玩家点击扫描时立刻获得一个虫洞）**」⇒ 首次达标（协会声望 ≥ 40）把进度条置成满一个窗口
 *   （`reconcileWormholeScanWelcome`，逐 tick 幂等、老档补发、**只送一次**，且**不提示"已预置"**）。
 * - 施工期铁律：本模块不产生玩家可见文案里的"虫洞"以外新术语；入口只在调试模式下出现。
 */
import { activePromoGifts, promoScanMul, tuningMul } from './tuning'
import type { GameState, WormholeArchetype, WormholeFamily, WormholeScanState, WormholeStockItem } from './state'
import { matterTechScanCut } from './matterTech'
import { addLog, wormholeScanHalt } from './state'
import { applyActivityGate } from './activityGate'
import type { SimContext } from './types'
import type { CommandResult } from './engine'
import { scanSkillFactor } from './explore'
import { WORMHOLE_MAX_SHIPS } from './wormhole'
import { DSI_FACTION_ID, standingOf } from './expedition'
import { WORMHOLE_ARCHETYPE_LABELS, wormholeArchetypeOf } from './wormholeGrid'
import { wormholeFamilyOfSeed } from './wormholeFoes'

/**
 * **扫描一个虫洞的基准时长**。
 *
 * 沿革：船长 2026-09-14 首定「**扫描基准设定为220分钟**」⇒ 同日改判「**虫洞扫描时长提高到12小时。**」
 * ⇒ **现值 = 12 小时**（旧值 220 分钟作废；技能乘算口径不变，只换基准）。
 */
export const WORMHOLE_SCAN_BASE_MS = 12 * 60 * 60_000

/**
 * **未探索虫洞的库存上限（基础值）**（船长 2026-09-14：「玩家最多可以囤积5个未开始探索的虫洞」）。
 * ⚠ 自 2026-09-14 起上限**不是常数**：技能「星图记录学」满级会再加 `WORMHOLE_STOCK_BONUS` 格 ⇒
 * 读"当前上限"一律走 **`wormholeStockMaxOf(state)`**（`WORMHOLE_STOCK_MAX` 只当基础值与文案锚）。
 */
export const WORMHOLE_STOCK_MAX = 5

/**
 * **星图记录学（`chart-archive`）扩展虫洞保存上限**。
 *
 * **2026-09-16 船长改判**：「**星图记录学，效果错误，应该为每级+2，满级+10。**」
 * ⇒ 由**阶跃**（只有满级一次性 +10）改为**每级线性 +2**：Lv1 +2 / Lv2 +4 / Lv3 +6 / Lv4 +8 / **Lv5 +10**
 * ⇒ 基础 5 处 ⇒ 上限 **7 / 9 / 11 / 13 / 15**（满级仍是 15，与旧口径的**满级总量一致**，只是中段开始有用）。
 *
 * 调参入口就在下面两行（体检「技能说明契约」按本文件的现场值复核技能说明里的 ⟦2⟧ 与 ⟦10⟧）。
 */
export const WORMHOLE_STOCK_BONUS_PER_LEVEL = 2

/** **满级总量 10**（= 每级 2 × 5 级）：只作**上限锚**与文案锚，逻辑一律走 `wormholeStockMaxOf`；
 *  与 `WORMHOLE_STOCK_BONUS_PER_LEVEL` 的关系由用例守卫（`WORMHOLE_STOCK_BONUS === PER_LEVEL × 5`）。 */
export const WORMHOLE_STOCK_BONUS = 10

/** 上限的**理论最大值**（基础 ＋ 满级加成）：读档清洗拿它当钳制上限 ⇒ 满级玩家的 15 格不会因为
 *  读档时"技能看起来还没到"被截掉；`save.ts` 是本文件之外唯一的用法。 */
export const WORMHOLE_STOCK_MAX_HARD = WORMHOLE_STOCK_MAX + WORMHOLE_STOCK_BONUS

/** **玩家当前的虫洞保存上限** = 基础 5 ＋ 星图记录学**每级 +2**（满级 15）——引擎与界面读这一个函数 */
export function wormholeStockMaxOf(state: GameState): number {
  const lv = Math.min(5, state.skills.trained['chart-archive'] ?? 0)
  return WORMHOLE_STOCK_MAX + WORMHOLE_STOCK_BONUS_PER_LEVEL * lv
}

/**
 * 起始层档位（**发现时一律从第 1 层起**）。
 *
 * ⚠ **2026-09-14 船长改判**：「**所有虫洞都是从1层开始探索。**」⇒ 旧口径「起始层 1/2/3 等概率」
 * **作废**（当时是想让深区更快到手；改判后一律从浅层进，深区靠玩家自己往下走）。
 * 数组与抽取调用一律保留（只留 `1`）——`rollStockItem` 里那次 `rng()` 照抽，
 * **随机序列不挪位**（否则同种子的既有盘面/掉落会全变）。
 */
export const WORMHOLE_STOCK_DEPTHS: readonly number[] = [1]

/**
 * **扫描虫洞的解锁门槛**。
 *
 * 沿革：船长 2026-09-14 首定「**扫码虫洞需要玩家35声望才会解锁。解锁时发送通讯给玩家
 * （同时也要直接弹窗）**」⇒ 同日后一条裁定「**将开始虫洞的声望门槛提高到40**」
 * ⇒ **现值 = 40**（旧值 35 作废）。
 *
 * 声望口径 = **协会（深空工业协会，`DSI_FACTION_ID` = `'dsi'`）声望 ≥ 40** —— 与其它"协会声望门槛"
 * （矿带 `standingReq`、奇货件、暗市闸、商品购买）**同一本账**：**累计获得**那一本
 * （走唯一入口 `expedition.standingOf`）。
 * ⚠ **2026-09-26 船长令**：「**修改原先的所有声望门槛，改为根据玩家的累计声望**」⇒ 本闸由原先直读
 * `state.standings`（可支配）改为读累计 —— 否则换过插件图纸的玩家会把虫洞扫描锁回去。
 * ⚠ 解锁通讯 `msg-wormhole-unlock` 的触发器门槛必须与本常量**同值**（`content:check` 盯着），
 * 且那条通讯的 `standing` 触发器同样读累计（`comms.ts` 同一口径）。
 */
export const WORMHOLE_SCAN_UNLOCK_STANDING = 40

/** 协会声望（界面读数与解锁判定共用；**累计获得**那本） */
export function wormholeScanStanding(state: GameState): number {
  return standingOf(state, DSI_FACTION_ID)
}

/** 扫描虫洞是否已解锁（声望 ≥ 门槛） */
export function wormholeScanUnlocked(state: GameState): boolean {
  return wormholeScanStanding(state) >= WORMHOLE_SCAN_UNLOCK_STANDING
}

/**
 * **星际奇遇学（`galactic-happenings`）缩短虫洞扫描周期**（船长 2026-09-14 追加裁定：
 * 「**星际奇遇学，对缩减虫洞的时间也有效。**」「**星际奇遇学，满级后缩减虫洞扫描周期20%**」
 * 「**并移动到探索内**」「**rank提升到5**」）。
 *
 * 口径 = **线性每级 −4%**（`1 − 0.04 × 等级`）⇒ **满级恰 −20%**（×0.8）；**虫洞专属的第四项**，
 * 与三技能乘算叠加（`scanSkillFactor` 只管那三项，星图扫描**不吃**这一项，船长只点了虫洞）。
 *
 * ⚠ **2026-09-17 船长改判（本条旧口径作废）**：「**将一些只有满级后才有效果的技能，拆分成每个等级效果
 * （比如满级获得20%，那么就每个等级拆分成4%）**」⇒ 本函数由**满级阶跃**（`lv >= 5 ? 1 - 0.2 : 1`，
 * 2026-09-14 按船长「星际奇遇学一起改」落的）改为**每级线性**；**满级总量保持 −20% 不变**
 * （⇒ 满级读数逐字不变：三技能全满 + 本技能满级仍 ≈169.3 分钟/个；新增中期收益 Lv1 ×0.96 / Lv4 ×0.84）。
 * 旧裁定与其登记取舍「阶跃 ⇒ Lv1~4 练奇遇学对虫洞毫无收益」一并作废（出处 `archive/roadmap-2026-09-14.md`）。
 *
 * 调参入口就在这一行（`content:check` 的「技能说明契约」按本文件的现场值 0.04 复核技能说明里的 ⟦4%⟧）。
 */
export function happeningsScanFactor(state: GameState): number {
  const lv = Math.min(5, state.skills.trained['galactic-happenings'] ?? 0)
  return Math.max(0, 1 - 0.04 * lv)
}

/**
 * **本趟扫描窗口**（毫秒）= 基准 12 小时 × 三技能乘算 × **星际奇遇学**。
 * ⚠ 与星图扫描的区别有三：①基准值不同（12 小时 vs 10 分钟）②**没有低安惩罚**
 * （扫描虫洞不吃目标星系安全等级 —— 它扫的是深空；船长只要求"遇袭期望一致"，没要求时长也吃低安系数）
 * ③**多一项 `happeningsScanFactor`**（星际奇遇学，虫洞专属）。
 */
export function wormholeScanWindowMs(
  state: GameState,
  /** **谜质科技**「谐振信号滤波阵列」的间隔削减（matterTechScanCut(state, ctx)；缺省 0 = 零变化） */
  techCut = 0,
): number {
  /**
   * **调试 1 秒化**（船长 2026-09-14：「**希望调试模式也能增加虫洞扫码的速度**」）：
   * 与 `explore.ts` 的星图扫描、`training` 的技能训练、AI 副船任务、本地航行段**同一把开关**
   * （`state.debugQuick`，调试面板「⇄ 调试 · 1秒化」勾选）⇒ 一个窗口 1 秒，连点即可攒满库存。
   */
  if (state.debugQuick) return 1000
  // 限时倍率（2026-09-15）：`wormholeScanMs` 乘在周期上（×0.5 = 快一倍）
  // 限时促销（2026-09-16）：`PROMOS[].scanMul` 同点相乘（「虫洞大量生成」= ×0.25 ⇒ 快四倍）
  return Math.max(
    1000,
    Math.round(
      WORMHOLE_SCAN_BASE_MS *
        scanSkillFactor(state) *
        happeningsScanFactor(state) *
        tuningMul(state, 'wormholeScanMs') *
        promoScanMul(state) *
        (1 - Math.min(0.9, Math.max(0, techCut))),
    ),
  )
}

/** 当前库存（发现即入列；上限走 `wormholeStockMaxOf(state)`：基础 5 ＋ 星图记录学满级 10） */
export function wormholeStockOf(state: GameState): WormholeStockItem[] {
  return state.wormholeStock ?? []
}

/** 库存是否已满（满 ⇒ 扫描停机） */
export function wormholeStockFull(state: GameState): boolean {
  return wormholeStockOf(state).length >= wormholeStockMaxOf(state)
}

/**
 * 能不能开扫（**只看本入口自己的前置**：解锁门槛 / 洞里 / 遭遇战未决 / 库存满）。
 *
 * ⚠ **2026-09-21 统一批**：原先这里还硬拒"主控正在采矿/打捞/远征/航行/待命/长途运输/快递/亲自开炉/
 * 亲自开线"九条——现已**整段撤掉**，改由 `activityGate` 那条统一判据接管（能直接切就自动停掉当前活动、
 * 只有长途运输先警告、远征/快递/战斗中/洞里/返航途中才拒）。理由（船长令）：「统一为能够直接切换
 * （自动取消当前活动）」——两个方向必须成对，反方向由同一把尺兜住。
 */
export function wormholeScanBlockReason(state: GameState): string | null {
  // 解锁门槛（船长 2026-09-14）：协会声望 ≥ 40 才开放扫描虫洞 —— 放在最前面，理由最有用
  if (!wormholeScanUnlocked(state)) {
    return `扫描虫洞尚未解锁：需要「深空工业协会」声望 ${WORMHOLE_SCAN_UNLOCK_STANDING}（当前 ${wormholeScanStanding(state)}）——先去做协会的委托攒声望。`
  }
  if (state.wormhole.run) return '已经在虫洞里了：先完成或撤离这一趟。'
  if (state.encounter.active) return '遭遇战未决：先处理完当前遭遇。'
  if (wormholeStockFull(state)) {
    return `已囤积 ${wormholeStockMaxOf(state)} 处未探索的虫洞：先去探索掉一处再扫。`
  }
  return null
}

/** 开始扫描（**只能在扫描界面里点**；船长：「玩家需要在扫描虫洞界面内开始」） */
export function wormholeScanStart(state: GameState, _ctx: SimContext): CommandResult {
  const blocked = wormholeScanBlockReason(state)
  if (blocked) return { ok: false, error: blocked }
  if ((state.wormholeScan ?? { active: false, progressMs: 0 }).active) {
    return { ok: false, error: '扫描已经在跑。', errorId: 'core.wormholeScan.001' }
  }
  /** 其余主控活动 ⇒ 统一判据（2026-09-21 船长令；见 `wormholeScanBlockReason` 的说明） */
  const gateSkip = applyActivityGate(state, 'wormholeScan')
  if (gateSkip) return gateSkip
  /**
   * ⚠ **续扫不清零**（船长：「停扫保留进度」）：只置回 active，`progressMs` 原样接着累计。
   */
  const scan = (state.wormholeScan = state.wormholeScan ?? { active: false, progressMs: 0 })
  scan.active = true
  /**
   * 甲案：续扫与否是**两条完整句**（不是拼接）⇒ 各给一个 id（`.002` 首扫 / `.003` 续扫），
   * 不做"把括号段当参数"——那样英文括注位置会错、占位符契约也不好守。
   */
  const resumed = scan.progressMs > 0
  const scanMin = Math.floor(scan.progressMs / 60_000)
  addLog(
    state,
    'fleet',
    `🛰 开始扫描虫洞：主控就地展开扫描阵列${resumed ? `（续扫：已扫 ${scanMin} 分钟）` : ''}。`,
    resumed ? 'core.wormholeScan.003' : 'core.wormholeScan.002',
    resumed ? { p1: scanMin } : undefined,
  )
  return { ok: true }
}

/** 手动停扫（进度保留：下次接着扫） */
export function wormholeScanStop(state: GameState): CommandResult {
  /** 状态改动走 `state.ts` 的单点 `wormholeScanHalt`（**进洞前自动停扫**也用它）⇒ 两条路径不会各写一份 */
  const mins = wormholeScanHalt(state)
  if (mins === null) return { ok: false, error: '扫描没在跑。', errorId: 'core.wormholeScan.004' }
  addLog(state, 'fleet', `🛰 停止扫描虫洞（进度保留：已扫 ${mins} 分钟）。`, 'core.wormholeScan.005', { p1: mins })
  return { ok: true }
}

/**
 * **解锁当次：把扫描进度预置成"满一个窗口"**（船长 2026-09-14 四步闸门裁定「甲」）：
 * 船长原话「**当玩家解锁虫洞时，让虫洞的进度条初始为100%（也就是玩家点击扫描时立刻获得一个虫洞）**」。
 *
 * 口径：
 * - **只送一次**（`scan.welcomed` 标记；可选存档字段 ⇒ 零迁移）；
 * - 达标那一刻把 `progressMs` 置成 `wormholeScanWindowMs(state, matterTechScanCut(state, ctx))` ⇒ 玩家点「开始扫描」后**第一拍**
 *   即产出一处虫洞（**仍要玩家自己点**，不替他开扫）；
 * - **不提示进度预置**（船长 2026-09-14：「不提示」）：日志不写"已预置 100%"这类字样；
 *   **2026-09-14 追加**：日志要提醒**进洞前带采集器与打捞器**（船长：「**解锁虫洞的提示和通讯内，
 *   提醒玩家要带采集器和打捞器**」）——洞里的矿脉靠采集器采、遗迹与残骸靠打捞器捞，空手进去收获会少一大截。
 *
 * ⚠ **逐 tick 调用**（`advanceGame`，与 `reconcileDockSanity` 同款）：解锁是"声望 ≥ 40"这个
 * **连续状态**、不是一次性事件 ⇒ 靠标记保证幂等；老档若已达标，下一次 tick 自动补上。
 */
export function reconcileWormholeScanWelcome(state: GameState): boolean {
  const scan = (state.wormholeScan = state.wormholeScan ?? { active: false, progressMs: 0 })
  if (scan.welcomed === true) return false
  if (!wormholeScanUnlocked(state)) return false
  scan.welcomed = true
  scan.progressMs = wormholeScanWindowMs(state) // 本函数拿不到 ctx ⇒ 不带科技削减（解锁礼只给"一整个窗口"的进度）
  addLog(state, 'fleet', '🛰 虫洞扫描阵列已就绪：主控可就地展开扫描（进洞前记得带采集器与打捞器）。', 'core.wormholeScan.006')
  return true
}

let stockSeq = 0
/** 造一处"已发现"的虫洞（种子 + 起始层恒 1；界面按种子显示、进洞时用它建副本） */
function rollStockItem(state: GameState, ctx: SimContext): WormholeStockItem {
  const rng = (): number => {
    // 用引擎的随机流（同档可复现；不额外引入随机源）
    state.rng.count += 1
    let x = (state.rng.seed + state.rng.count * 2654435761) >>> 0
    x ^= x << 13
    x >>>= 0
    x ^= x >> 17
    x ^= x << 5
    x >>>= 0
    return x / 4294967296
  }
  void ctx
  stockSeq += 1
  // 起始层恒 1（船长 2026-09-14）；**这次 rng() 照抽**——只改档位表、不挪随机序列
  const depth = WORMHOLE_STOCK_DEPTHS[Math.min(WORMHOLE_STOCK_DEPTHS.length - 1, Math.floor(rng() * WORMHOLE_STOCK_DEPTHS.length))]!
  const seed = Math.floor(rng() * 2_000_000_000) + 1
  return {
    id: `wh-${Date.now().toString(36)}-${stockSeq.toString(36)}`,
    seed,
    depth,
    /**
     * **内容原型与敌族由种子决定**（丙/丁 · 船长 2026-09-14）：掷出种子那一刻就定了，
     * 列表里直接给玩家看（"挑洞"就靠它）。老档缺这两个字段时按同一种子现算 ⇒ 结果一致、零迁移。
     */
    archetype: wormholeArchetypeOf(seed),
    family: wormholeFamilyOfSeed(seed),
    foundAtGameMs: state.gameMs,
  }
}

/**
 * **放弃一处已发现的虫洞**（船长 2026-09-14：「玩家要能够放弃已经探索出的虫洞」）。
 *
 * 口径：**无代价、不退还**（那处就此消失），放弃后**腾出库存格**（可以继续扫新的）；
 * **不影响扫描进度**（进度是另一本账）；**正在自动探索的那一处不能放弃**（先召回）。
 */
export function wormholeStockDiscard(state: GameState, id: string): CommandResult {
  const list = wormholeStockOf(state)
  const hit = list.find((x) => x.id === id)
  if (!hit) return { ok: false, error: '这处虫洞不在了（可能已经探索过）。', errorId: 'core.wormholeScan.007' }
  const running = (state.wormholeAuto ?? []).find((r) => r.stockId === id)
  if (running) {
    return { ok: false, error: '这一处正在自动探索中：先召回那一趟，再放弃。', errorId: 'core.wormholeScan.008' }
  }
  state.wormholeStock = list.filter((x) => x.id !== id)
  const meta = wormholeStockMeta(hit)
  addLog(
    state,
    'fleet',
    `🛰 已放弃一处虫洞：${WORMHOLE_ARCHETYPE_LABELS[meta.archetype]}（那处通道就此关闭）。`,
    'core.wormholeScan.009',
    { p1: WORMHOLE_ARCHETYPE_LABELS[meta.archetype] },
  )
  return { ok: true }
}

/**
 * **库存项的"完整口径"**（丙/丁 的两个字段对老档是现算的）：读的地方都走它，
 * 免得"有的地方有原型、有的地方没有"。
 */
export function wormholeStockMeta(item: WormholeStockItem): {
  archetype: WormholeArchetype
  family: WormholeFamily
} {
  return {
    archetype: item.archetype ?? wormholeArchetypeOf(item.seed),
    family: item.family ?? wormholeFamilyOfSeed(item.seed),
  }
}

/**
 * **造一处并入列——不看上限**（上限判定在调用方）：
 * - 扫描产出走 `wormholeStockPush`（满 ⇒ 不发 + 不写日志）；
 * - 限时促销赠送走 `reconcileWormholePromoGift`（**允许暂时超上限**，见那里的注释）。
 */
function stockPushUncapped(state: GameState, ctx: SimContext): WormholeStockItem {
  const item = rollStockItem(state, ctx)
  state.wormholeStock = [...wormholeStockOf(state), item]
  return item
}

/** 把一处新发现的虫洞放进库存（满了 ⇒ 不放进，返回 null） */
export function wormholeStockPush(state: GameState, ctx: SimContext): WormholeStockItem | null {
  if (wormholeStockFull(state)) return null
  const item = stockPushUncapped(state, ctx)
  addLog(
    state,
    'fleet',
    `🛰 发现一处虫洞：${WORMHOLE_ARCHETYPE_LABELS[item.archetype ?? wormholeArchetypeOf(item.seed)]}（已囤积 ${wormholeStockOf(state).length}/${wormholeStockMaxOf(state)} 处）——到「扫描虫洞」页决定何时探索。`,
  )
  return item
}

/**
 * **任务奖励：标记 N 处未探索虫洞进库存**（2026-09-18 船长：「第一次虫洞给予玩家两次虫洞探索」）。
 *
 * 口径与限时促销赠送**逐条一致**（见 `reconcileWormholePromoGift` 的注释）：一次性奖励不该被库存上限吃掉
 * ⇒ 走 `stockPushUncapped`（**允许暂时超上限**）；超上限期间扫描照旧停机，玩家用掉降到上限以下即恢复。
 * 返回实际发放处数。
 */
export function grantWormholeStock(state: GameState, ctx: SimContext, count: number): number {
  const n = Math.max(0, Math.floor(count))
  if (n <= 0) return 0
  for (let i = 0; i < n; i++) stockPushUncapped(state, ctx)
  addLog(
    state,
    'fleet',
    `🛰 已标记 ${n} 处虫洞坐标（未探索）——到「扫描虫洞」页决定何时探索。`,
    'core.wormholeScan.010',
    { p1: n },
  )
  return n
}

/**
 * **限时促销的一次性赠送**（2026-09-16 船长四条口径：「**每人只发一次 5 个**」「**只给已解锁者**」
 * 「到期**只停止赠送**（不回收）」＋ 展示与扫描加速合并）。
 *
 * 口径：
 * - **逐 tick 幂等**（照 `reconcileWormholeScanWelcome` 范式）：靠 `state.promoClaimed[promoId]` 记一次
 *   ⇒ **每人每促销只发一次**；老档缺席该字段 = 未领取 ⇒ 下一次心跳自动补发；促销表删行后该记录留着无害；
 * - **只给已解锁者**（协会声望 ≥ `WORMHOLE_SCAN_UNLOCK_STANDING`）：未解锁不发、也不写记录
 *   ⇒ 他在活动期内达标后，下一次心跳自然能领到（**活动到期后不再发**）；
 * - **允许暂时超过库存上限**（船长确认）：若玩家手里已有 3 处，送 5 处应得 8 处——不这么做，
 *   赠送会被上限"吃掉"2 处。⚠ 放宽**只作用于这条赠送路径**：扫描产出与"满则停机"仍严守上限；
 *   超上限期间扫描照旧停机，玩家用掉降到上限以下即恢复；
 * - **到期只停止赠送**：已发出的虫洞**不回收**（不改任何已存状态 ⇒ 零迁移、零回收代码）。
 */
export function reconcileWormholePromoGift(state: GameState, ctx: SimContext): boolean {
  const gifts = activePromoGifts(state.wallMs)
  if (gifts.length === 0) return false
  // 只给已解锁者（协会声望 ≥ 40）；未达标 ⇒ 这次不发、也不记领取（达标后仍可领到）
  if (!wormholeScanUnlocked(state)) return false
  const claimed = state.promoClaimed ?? {}
  let changed = false
  for (const g of gifts) {
    if (claimed[g.id] === true) continue
    for (let i = 0; i < g.count; i++) stockPushUncapped(state, ctx)
    state.promoClaimed = { ...claimed, [g.id]: true }
    claimed[g.id] = true
    changed = true
    addLog(
      state,
      'fleet',
      `🛰 测绘处传来一批坐标：协会为你标记了 ${g.count} 处虫洞（共囤积 ${wormholeStockOf(state).length} 处，到「扫描虫洞」页查看）——进洞前记得带采集器与打捞器。`,
    )
  }
  return changed
}

/** 取走一处（进洞时消耗） */
export function wormholeStockTake(state: GameState, id: string): WormholeStockItem | undefined {
  const list = wormholeStockOf(state)
  const hit = list.find((x) => x.id === id)
  if (!hit) return undefined
  state.wormholeStock = list.filter((x) => x.id !== id)
  return hit
}

/**
 * **扫描推进**（`advanceGame` 每拍调用；进度按毫秒累计，满一个产出一个）。
 * - 遇袭**不清零**（船长：「遇袭不中断扫描」）——本函数不看战斗、不看遭遇；
 * - 库存满 ⇒ **停机并提示**（船长：「扫描停机并提示」）：活动停、进度停在满值，日志说清去哪处理。
 * - 离线大步长会一次跨过多个窗口 ⇒ **循环产出**（每满一个产一个，直到库存满或进度用尽）。
 */
export function advanceWormholeScan(state: GameState, ctx: SimContext, deltaMs: number): void {
  const scan = state.wormholeScan
  if (!scan?.active || deltaMs <= 0) return
  const windowMs = wormholeScanWindowMs(state, matterTechScanCut(state, ctx))
  scan.progressMs += deltaMs
  while (scan.progressMs >= windowMs) {
    if (wormholeStockFull(state)) {
      scan.active = false
      scan.progressMs = windowMs
      addLog(
        state,
        'warn',
        `🛰 扫描停机：已囤积 ${wormholeStockMaxOf(state)} 处未探索的虫洞（上限）——先去探索掉一处，再回来开扫。`,
      )
      return
    }
    scan.progressMs -= windowMs
    wormholeStockPush(state, ctx)
  }
}
