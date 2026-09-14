/**
 * **虫洞扫描（发现线）**（船长 2026-09-14 定案）：
 * 「新增主控活动：'扫描虫洞'。玩家需要在扫描虫洞界面内开始。在扫描的过程中，玩家遭遇随机事件的期望和星图中的
 * 扫描一致。并且会上涨一个进度条，进度条满后。玩家就可以发现一个虫洞。玩家最多可以囤积5个未开始探索的虫洞。」
 *
 * 口径（design §三 / §五，全部船长确认）：
 * - **扫描窗口 = 12 小时 × 三技能乘算 × 星际奇遇学**（信号分析学 −8%/级 · 星图测绘学 −6%/级 · 信号过滤学 −6%/级，
 *   直接复用 `explore.scanSkillFactor` —— 与星图扫描**同一把尺**；**再乘一项虫洞专属的星际奇遇学**
 *   −4%/级、满级 −20%，见 `happeningsScanFactor`）；**不吃舰船属性**（船长：「无关」）。
 *   ⚠ 基准沿革：2026-09-14 首定 **220 分钟** ⇒ 同日改判「**虫洞扫描时长提高到12小时**」⇒ **现值 12 小时**。
 * - **随机事件期望与星图扫描同源**：暴露口径交给 `encounters`（本活动在暴露清单里与 `state.scanning` 并列）。
 * - **遇袭不中断**：被打不影响进度（进度按游戏时刻推进，不在遇袭时清零）。
 * - 进度满 ⇒ **发现 1 个虫洞**（随机种子 + **起始层恒 1** + 原型/敌族按种子定）进库存，随后**自动续扫**。
 * - **库存上限 5**；满则**扫描停机**并提示（船长：「扫描停机并提示」）。
 * - 施工期铁律：本模块不产生玩家可见文案里的"虫洞"以外新术语；入口只在调试模式下出现。
 */
import type { GameState, WormholeArchetype, WormholeFamily, WormholeScanState, WormholeStockItem } from './state'
import { addLog, wormholeScanHalt } from './state'
import type { SimContext } from './types'
import type { CommandResult } from './engine'
import { scanSkillFactor } from './explore'
import { WORMHOLE_MAX_SHIPS } from './wormhole'
import { DSI_FACTION_ID } from './expedition'
import { WORMHOLE_ARCHETYPE_LABELS, wormholeArchetypeOf } from './wormholeGrid'
import { wormholeFamilyOfSeed } from './wormholeFoes'

/**
 * **扫描一个虫洞的基准时长**。
 *
 * 沿革：船长 2026-09-14 首定「**扫描基准设定为220分钟**」⇒ 同日改判「**虫洞扫描时长提高到12小时。**」
 * ⇒ **现值 = 12 小时**（旧值 220 分钟作废；技能乘算口径不变，只换基准）。
 */
export const WORMHOLE_SCAN_BASE_MS = 12 * 60 * 60_000

/** **未探索虫洞的库存上限**（船长：「玩家最多可以囤积5个未开始探索的虫洞」） */
export const WORMHOLE_STOCK_MAX = 5

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
 * （矿带 `standingReq`、奇货件）**同一本账**（`state.standings.dsi`，界面「声望」列就是它）。
 * ⚠ 解锁通讯 `msg-wormhole-unlock` 的触发器门槛必须与本常量**同值**（`content:check` 盯着）。
 */
export const WORMHOLE_SCAN_UNLOCK_STANDING = 40

/** 协会声望（界面读数与解锁判定共用） */
export function wormholeScanStanding(state: GameState): number {
  return state.standings[DSI_FACTION_ID] ?? 0
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
 * 口径 = **每级 −4%**（满级 Lv5 ⇒ ×0.8 = **−20%**）—— **虫洞专属的第四项**：
 * 与三技能乘算叠加（`scanSkillFactor` 只管那三项，星图扫描**不吃**这一项，船长只点了虫洞）。
 * 调参入口就在这一行（`content:check` 的「技能说明契约」按本文件的现场值复核技能说明里的 ⟦4%⟧/⟦20%⟧）。
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
export function wormholeScanWindowMs(state: GameState): number {
  /**
   * **调试 1 秒化**（船长 2026-09-14：「**希望调试模式也能增加虫洞扫码的速度**」）：
   * 与 `explore.ts` 的星图扫描、`training` 的技能训练、AI 副船任务、本地航行段**同一把开关**
   * （`state.debugQuick`，调试面板「⇄ 调试 · 1秒化」勾选）⇒ 一个窗口 1 秒，连点即可攒满库存。
   */
  if (state.debugQuick) return 1000
  return Math.max(1000, Math.round(WORMHOLE_SCAN_BASE_MS * scanSkillFactor(state) * happeningsScanFactor(state)))
}

/** 当前库存（发现即入列；上限 `WORMHOLE_STOCK_MAX`） */
export function wormholeStockOf(state: GameState): WormholeStockItem[] {
  return state.wormholeStock ?? []
}

/** 库存是否已满（满 ⇒ 扫描停机） */
export function wormholeStockFull(state: GameState): boolean {
  return wormholeStockOf(state).length >= WORMHOLE_STOCK_MAX
}

/** 能不能开扫（主控活动互斥：与采矿/打捞/扫描/远征/待命/过境/虫洞探索同一把尺） */
export function wormholeScanBlockReason(state: GameState): string | null {
  // 解锁门槛（船长 2026-09-14）：协会声望 ≥ 40 才开放扫描虫洞 —— 放在最前面，理由最有用
  if (!wormholeScanUnlocked(state)) {
    return `扫描虫洞尚未解锁：需要「深空工业协会」声望 ${WORMHOLE_SCAN_UNLOCK_STANDING}（当前 ${wormholeScanStanding(state)}）——先去做协会的委托攒声望。`
  }
  if (state.wormhole.run) return '已经在虫洞里了：先完成或撤离这一趟。'
  if (state.encounter.active) return '遭遇战未决：先处理完当前遭遇。'
  if (state.mining.active) return '主控正在采矿：一台主控同时只能干一件事。'
  if (state.salvaging.active) return '主控正在打捞：一台主控同时只能干一件事。'
  if (state.scanning.active) return '主控正在扫描星系：一台主控同时只能干一件事。'
  if (state.expedition.active) return '主控正在远征：一台主控同时只能干一件事。'
  if (state.transit.active) return '主控正在航行：到港后再开始扫描。'
  if (state.standby.active) return '主控正在待命：先取消待命。'
  /**
   * **补齐剩下四项主控活动**（船长 2026-09-14 玩家反馈「虫洞扫描不占用主控活动」的同一批）：
   * 修前这里只列到"待命"，于是**长途运输 / 快递在途 / 亲自开炉 / 亲自开线**期间还能开扫——
   * 反方向（扫描时不让你开这些）由 `wormholePilotHoldReason` 兜住，两个方向必须成对。
   * 判据与通知一律与 `mining.ts` / `industry.ts` / `manufacturing.ts` 的既有措辞对齐
   * （"想自动××可改用 AI 核心驱动"）。
   */
  if (state.hauling.active) return '主控正在长途运输：先停止运输（活动栏「停止运输」，到站即止）再开始扫描。'
  if (state.sideTasks.deliver !== null) return '快递投送在途：到站自动结算后再开始扫描。'
  if (state.refineRuns.some((r) => r.active && r.worker === 'pilot')) {
    return '精炼炉正由你亲自运转：先停炉才能展开扫描阵列（想自动精炼可改用 AI 核心驱动）。'
  }
  if (state.manufacturingRuns.some((r) => r.active && r.worker === 'pilot')) {
    return '制造作业正由你亲自开线：先取消它才能展开扫描阵列（想自动制造可改用 AI 核心驱动）。'
  }
  if (wormholeStockFull(state)) {
    return `已囤积 ${WORMHOLE_STOCK_MAX} 处未探索的虫洞：先去探索掉一处再扫。`
  }
  return null
}

/** 开始扫描（**只能在扫描界面里点**；船长：「玩家需要在扫描虫洞界面内开始」） */
export function wormholeScanStart(state: GameState, _ctx: SimContext): CommandResult {
  const blocked = wormholeScanBlockReason(state)
  if (blocked) return { ok: false, error: blocked }
  if ((state.wormholeScan ?? { active: false, progressMs: 0 }).active) return { ok: false, error: '扫描已经在跑。' }
  /**
   * ⚠ **续扫不清零**（船长：「停扫保留进度」）：只置回 active，`progressMs` 原样接着累计。
   */
  const scan = (state.wormholeScan = state.wormholeScan ?? { active: false, progressMs: 0 })
  scan.active = true
  addLog(state, 'info', `🛰 开始扫描虫洞：主控就地展开扫描阵列${scan.progressMs > 0 ? `（续扫：已扫 ${Math.floor(scan.progressMs / 60_000)} 分钟）` : ''}。`)
  return { ok: true }
}

/** 手动停扫（进度保留：下次接着扫） */
export function wormholeScanStop(state: GameState): CommandResult {
  /** 状态改动走 `state.ts` 的单点 `wormholeScanHalt`（**进洞前自动停扫**也用它）⇒ 两条路径不会各写一份 */
  const mins = wormholeScanHalt(state)
  if (mins === null) return { ok: false, error: '扫描没在跑。' }
  addLog(state, 'info', `🛰 停止扫描虫洞（进度保留：已扫 ${mins} 分钟）。`)
  return { ok: true }
}

/**
 * **解锁当次：把扫描进度预置成"满一个窗口"**（船长 2026-09-14 四步闸门裁定「甲」）：
 * 船长原话「**当玩家解锁虫洞时，让虫洞的进度条初始为100%（也就是玩家点击扫描时立刻获得一个虫洞）**」。
 *
 * 口径：
 * - **只送一次**（`scan.welcomed` 标记；可选存档字段 ⇒ 零迁移）；
 * - 达标那一刻把 `progressMs` 置成 `wormholeScanWindowMs(state)` ⇒ 玩家点「开始扫描」后**第一拍**
 *   即产出一处虫洞（**仍要玩家自己点**，不替他开扫）；
 * - **不额外提示**（船长 2026-09-14：「不提示」）——只留一条中性日志，解锁信文案一字不动。
 *
 * ⚠ **逐 tick 调用**（`advanceGame`，与 `reconcileDockSanity` 同款）：解锁是"声望 ≥ 40"这个
 * **连续状态**、不是一次性事件 ⇒ 靠标记保证幂等；老档若已达标，下一次 tick 自动补上。
 */
export function reconcileWormholeScanWelcome(state: GameState): boolean {
  const scan = (state.wormholeScan = state.wormholeScan ?? { active: false, progressMs: 0 })
  if (scan.welcomed === true) return false
  if (!wormholeScanUnlocked(state)) return false
  scan.welcomed = true
  scan.progressMs = wormholeScanWindowMs(state)
  addLog(state, 'info', '🛰 虫洞扫描阵列已就绪：主控可就地展开扫描。')
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
  if (!hit) return { ok: false, error: '这处虫洞不在了（可能已经探索过）。' }
  const running = (state.wormholeAuto ?? []).find((r) => r.stockId === id)
  if (running) return { ok: false, error: '这一处正在自动探索中：先召回那一趟，再放弃。' }
  state.wormholeStock = list.filter((x) => x.id !== id)
  const meta = wormholeStockMeta(hit)
  addLog(state, 'info', `🛰 已放弃一处虫洞：${WORMHOLE_ARCHETYPE_LABELS[meta.archetype]}（那处通道就此关闭）。`)
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

/** 把一处新发现的虫洞放进库存（满了 ⇒ 不放进，返回 null） */
export function wormholeStockPush(state: GameState, ctx: SimContext): WormholeStockItem | null {
  if (wormholeStockFull(state)) return null
  const item = rollStockItem(state, ctx)
  state.wormholeStock = [...wormholeStockOf(state), item]
  addLog(
    state,
    'info',
    `🛰 发现一处虫洞：${WORMHOLE_ARCHETYPE_LABELS[item.archetype ?? wormholeArchetypeOf(item.seed)]}（已囤积 ${state.wormholeStock.length}/${WORMHOLE_STOCK_MAX} 处）——到「扫描虫洞」页决定何时探索。`,
  )
  return item
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
  const windowMs = wormholeScanWindowMs(state)
  scan.progressMs += deltaMs
  while (scan.progressMs >= windowMs) {
    if (wormholeStockFull(state)) {
      scan.active = false
      scan.progressMs = windowMs
      addLog(
        state,
        'warn',
        `🛰 扫描停机：已囤积 ${WORMHOLE_STOCK_MAX} 处未探索的虫洞（上限）——先去探索掉一处，再回来开扫。`,
      )
      return
    }
    scan.progressMs -= windowMs
    wormholeStockPush(state, ctx)
  }
}
