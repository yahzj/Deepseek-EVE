/** 功能域职责拆分，保持原计算与顺序。 */
import { ceilFinalQuantity } from '../../quantity'
import { RARE_WRECK_VOLUME_M3, rareWreckItemIdOfCard } from '../../salvage'
import { type WeekendEventState, weekendOccupiedIds, weekendPlayerContribution, weekendProgressAt } from '../../weekendEvent'
import { type GameState, addLog } from '../../state'
import type { SimContext } from '../../types'
import { blackBoxItemIdForFamily } from '../../blackbox'
import { addWare } from '../../inventory'

/** 夺回奖励（每处）与全清追加（数值表） */
export const WEEKEND_RECLAIM_WRECK = 8

export const WEEKEND_RECLAIM_ISK = 2_000_000

export const WEEKEND_ALL_CLEAR_ISK = 5_000_000

/** 旗舰奖励：必掉黑匣 ×1 ＋ 稀有残骸 ×3 · 赏金 ×3 */
export const WEEKEND_FLAGSHIP_WRECK = 3

/**
 * **稀有残骸的「件 → 单位(m³)」换算**（**船长 2026-09-25 令**：周末奖励按**件**补足）。
 *
 * 全仓口径 = **1 件 = `RARE_WRECK_VOLUME_M3`(30) 单位 = 30 m³**（打捞侧同口径：捞到 1 件入库 30 单位，
 * 回收炉稀有批也是 30 m³/批 ⇒ **一炉一件**）。
 *
 * ⚠ 病根（2026-09-25 船长问「H 族残骸现在有精炼炉回收吗」时查出来的）：本文件那几张表
 * （旗舰掉落 ×3 · 夺回 ×8 · 贡献四档 ×12/×8/×4/×1）按**件**写（设计稿原文「×8 **件**」），
 * 但落到入库口（`addItem`/`addWare`）时直接发了 **n 个单位 = n m³** ⇒ **少了 30 倍**，
 * 玩家拿着「稀有残骸 ×8」连 30 m³ 的起炉线都够不到（拆不了）。
 * ⇒ 现在在**换算点**一次换算成单位；台账 / 结算面板 / 通讯 / 日志**一律按 m³ 读数**
 * （与仓库计数、回收炉批数同一个数）。
 */
export function weekendRareWreckUnits(pieces: number): number {
  return Math.max(0, ceilFinalQuantity(pieces)) * RARE_WRECK_VOLUME_M3
}

/**
 * **夺回奖按"玩家在该处的投入比例"缩水**（**2026-09-29 船长令 · 乙案**）。
 *
 * 病根（船长报障原话：「**玩家在入侵中完全0贡献，但是却有每个星系240残骸+200万**」）：
 * 夺回奖原先**只看"进度 ≥ 1"**，而进度 = `NPC 铺底(时间函数) ＋ 玩家投入` —— 外围 T0+48h、
 * 核心 T0+72h 之后**时间自己就把条推满** ⇒ 一次都不打的玩家照样每处拿 240 m³ ＋ 200 万
 * （同一批的贡献四档奖与进度收入本来就有 0 贡献保护，只有这条漏了）。实测：4 处占领区、
 * 一次不打 ⇒ 1,300 万 ＋ 960 m³。
 *
 * 新口径（船长三答）：**每处 = 全额 × 玩家在该处的投入比例**（比例 = `contributed[星系]`，
 * 0~1，NPC 铺底那一份不算）；**全清追加 = 全额 × 平均参与度**（见 `weekendAllClearAwardOf`）。
 * - **残骸按"件"四舍五入**（1 件 = 30 m³ ⇒ 记的永远是 30 的整数倍，不会往仓库塞 2 m³ 碎渣）；
 * - **ISK 四舍五入到 1 元**；
 * - 0 贡献 ⇒ **两笔都记 0**（挂机不再产生任何收入）。
 *
 * ⚠ **算的是"最终"投入比例**：调用点只有一个 —— 结算那一拍（`weekendSettleAndGrant` 的幂等早退
 * **之前**，传的是 `ev.endedAtWallMs`）。**不许**改回"夺回那一刻按当时比例记"：那样同一处
 * "先被 NPC 铺满、玩家事后才去清缴"会被记成 0，且结果取决于他当时恰好在别处打过没打过一场
 * （同一行为算出不同奖励）；挂到结算拍后与 `contributed` 台账（随档）同源、与出手顺序无关、
 * 与进度收入（同样在结算拍按台账算）同一把尺。
 */
export function weekendReclaimAwardOf(ev: WeekendEventState, galaxyId: string): { wreck: number; isk: number } {
  const put = ev.contributed[galaxyId] ?? 0
  const ratio = Number.isFinite(put) ? Math.min(1, Math.max(0, put)) : 0
  return {
    wreck: weekendRareWreckUnits(WEEKEND_RECLAIM_WRECK * ratio),
    isk: ceilFinalQuantity(WEEKEND_RECLAIM_ISK * ratio),
  }
}

/**
 * **全清追加（5,000,000 ISK）按"平均参与度"缩水**（**2026-09-29 船长令 · 甲案**）：
 * `全额 × (玩家总投入 ÷ 占领区数)`，封顶 1 ⇒ 处处打满 = 全额，一处没碰过就摊薄，完全挂机 = 0。
 * 与 `weekendReclaimAwardOf` 同拍、同一把尺（都读 `contributed` 台账）。
 */
export function weekendAllClearAwardOf(ev: WeekendEventState): number {
  const ids = weekendOccupiedIds(ev)
  if (ids.length === 0) return 0
  const total = weekendPlayerContribution(ev)
  if (!Number.isFinite(total) || total <= 0) return 0
  return ceilFinalQuantity(WEEKEND_ALL_CLEAR_ISK * Math.min(1, total / ids.length))
}

/**
 * **记一笔到手台账**（2026-09-25 加）：三处入账（夺回 / 贡献奖 / 旗舰掉落）各调一次，全是**累加**。
 * 用途 = 结算面板与结算通讯里的奖励清单**不再另算一遍**（说的与发的逐值一致）。
 * `galaxyId` 给了才记逐星系那一栏（旗舰掉落与贡献奖是全局的）。
 *
 * 游戏内奖励入账统一走本文件内的调用点，别在外面新开入口。
 */
export function noteReward(
  ev: WeekendEventState,
  galaxyId: string | undefined,
  add: { isk?: number; wreck?: number; blackBox?: number },
): void {
  const led = (ev.rewardLedger ??= { isk: 0, wreck: 0, blackBox: 0, byGalaxy: {} })
  const isk = Math.max(0, ceilFinalQuantity(add.isk ?? 0))
  const wreck = Math.max(0, ceilFinalQuantity(add.wreck ?? 0))
  const blackBox = Math.max(0, ceilFinalQuantity(add.blackBox ?? 0))
  led.isk += isk
  led.wreck += wreck
  led.blackBox += blackBox
  if (galaxyId !== undefined && (isk > 0 || wreck > 0)) {
    const g = (led.byGalaxy[galaxyId] ??= { isk: 0, wreck: 0 })
    g.isk += isk
    g.wreck += wreck
  }
}

/**
 * **记一笔"待到账的夺回奖励"**（2026-09-25 船长令：夺回奖励不即时发、改在活动结束结算时发）。
 * 每夺回一处调一次（含全清追加那 5M），结束时由 `weekendSettleAndGrant` 一次发清。
 */
export function noteReclaimPending(ev: WeekendEventState, add: { isk?: number; wreck?: number }): void {
  const cur = (ev.reclaimPending ??= { isk: 0, wreck: 0 })
  cur.isk += Math.max(0, ceilFinalQuantity(add.isk ?? 0))
  cur.wreck += Math.max(0, ceilFinalQuantity(add.wreck ?? 0))
}

/** 结算时按最终投入比例同步本场已夺回奖励，只在首次结算前调用。 */
export function weekendSyncReclaimRewards(
  state: GameState,
  ev: WeekendEventState,
  nowWallMs: number,
): { galaxies: string[]; allClear: boolean } {
  const paid = (ev.reclaimPaid ??= [])
  const all = weekendOccupiedIds(ev)
  const reclaimed = all.filter((id) => weekendProgressAt(state, ev, id, nowWallMs) >= 1)
  const fresh = reclaimed.filter((id) => !paid.includes(id))
  if (fresh.length === 0) return { galaxies: [], allClear: false }
  for (const id of fresh) {
    const award = weekendReclaimAwardOf(ev, id)
    noteReward(ev, id, award)
    noteReclaimPending(ev, award)
    paid.push(id)
  }
  /** 全清追加（**记进全局**，不带星系 ⇒ 面板逐星系那一列不会被它撑歪）：首达"全处夺回"时记一次 */
  const allClear = paid.length >= all.length && all.length > 0
  if (allClear) {
    const bonus = weekendAllClearAwardOf(ev)
    noteReward(ev, undefined, { isk: bonus })
    noteReclaimPending(ev, { isk: bonus })
  }
  return { galaxies: fresh, allClear }
}

/**
 * **入侵旗舰黑匣的落款物品 id**（船长 2026-09-25：「**黑匣先做壳**」）——
 * 先做成一件**真实物品**（可存、可回收、可售予回收商），**用途留待"改装/特殊装备"那批**。
 * 定义在 `data/items.ts` 的 `WEEKEND_TROPHIES`（与残骸同一条注册链路）。
 *
 * ⚠ **2026-10-02 起这是"落款/兜底"，不是唯一发的那一件**：黑匣**按族各一件**
 * （H 墨潮 `blackbox-h` · R 光环 `blackbox-r`），取数走 `blackBoxItemIdForFamily(族)`
 * —— 起因 = 玩家报障「**光环入侵结束给的黑匣还是墨潮的**」（船长令「甲」）。
 * 本常量仍是：① 老快照/老配方没写族时的取数口；② 某族匣缺失时的回落（见 `blackbox.ts`）。
 */
export const WEEKEND_BLACKBOX_ITEM_ID = 'blackbox-h'

/**
 * **本场入侵该发哪一件黑匣**（族 → `blackbox-<族小写>`；**2026-10-02 船长令「甲」**）。
 *
 * 击沉发奖与结算快照都从这里取，不各自写死 id。
 * `ev` 缺省（没有入侵事件）⇒ 落款黑匣 —— 这条路的调用方本来就只在入侵里发匣。
 */
export function weekendBlackBoxItemIdOf(ev: WeekendEventState | undefined, ctx: SimContext): string {
  const family = ev?.family
  if (family === undefined || family.length === 0) return WEEKEND_BLACKBOX_ITEM_ID
  return blackBoxItemIdForFamily(family, (id) => ctx.items.has(id))
}

/**
 * **这一场该发的稀有残骸物品 id**（2026-09-25 修）：按**"打的那张卡"所属残骸组**取
 * （H 族独立卡 ⇒ `wreck-rare-h-hi`；A/C/G 占位卡 ⇒ 它们那张虫洞卡所属组）。
 *
 * ⚠ 原实现写死 `WEEKEND_RARE_WRECK_ID = 'wreck-rare'` —— 那个 id **在物品目录里不存在**
 * （真实形态是 `wreck-rare-<组key>`），实测 `ctx.items.has('wreck-rare') === false`，
 * 发出去就是一件「未知物品」（回收画像 null ⇒ 不能回收、不能卖）。现已删除该常量。
 * 契约保证"每张敌卡都登记进某一残骸组" ⇒ 正常路径必有值；解析不到就不发（不造假物品）。
 */
export function weekendRareWreckIdFor(cardId: string, ctx: SimContext): string | undefined {
  return rareWreckItemIdOfCard(cardId, ctx) ?? undefined
}

/**
 * **把结算结果真正发下去**（引擎在拿到 `weekendResolveBattle` / `weekendSettlePlanOf` 的结果后调用）：
 * - ISK 直接进钱包；
 * - **稀有残骸与旗舰黑匣一律进「物品仓库」**（`addWare`）——**物品 id 由调用方按卡解析**
 *   （`weekendRareWreckIdFor`；缺省 = 不发，绝不发不存在的 id）；
 * - 返回值 = **实际入账的数量**（不是"想发的数量"）。
 *
 * ⚠ **2026-09-26 修（船长报障「报告显示拿到黑匣、玩家手里却没有」· 船长批「甲」）**：
 * 原先这两件走 `addItem` ⇒ 落进**当时驾驶的那条船的货舱**，而「物品」页只列仓库
 * （`ItemsPage` 只读 `state.warehouse.items`）⇒ 玩家在物品页**永远看不到**；货舱又只在"远征返航进港"
 * 那一刻才自动卸货（`unloadCargoOfShipToWarehouse`）⇒ 返航途中换船/损船就再也回不来。同 id 的黑匣
 * 从打捞回收那条路（`salvaging.ts` 的 `addWare`）本来就在仓库里 ⇒ 同一件东西两个落点，纯属实现走偏
 * （设计稿 Q4 的口径一直是「**黑匣入库**」）。现在统一入库，且**按真实结果记账**。
 *
 * ⚠ 幂等由调用方保证（`weekendResolveBattle` 的"夺回只发一次"已在那一层判过）。
 */
export function weekendGrantRewards(
  state: GameState,
  reward: { isk?: number; wreck?: number; blackBox?: boolean; wreckItemId?: string; blackBoxItemId?: string },
): { isk: number; wreck: number; blackBox: number } {
  const isk = Math.max(0, ceilFinalQuantity(reward.isk ?? 0))
  const wreckWant = Math.max(0, ceilFinalQuantity(reward.wreck ?? 0))
  if (isk > 0) state.wallet.isk += isk
  /** 稀有残骸：解析不到物品 id（契约破损）⇒ **不发也不记账**，并留一条 warn（原先静默吞掉） */
  let wreck = 0
  if (wreckWant > 0) {
    if (reward.wreckItemId !== undefined) {
      if (addWare(state, reward.wreckItemId, wreckWant)) wreck = wreckWant
    } else {
      addLog(state, 'warn', '⚠ 入侵战利品未能入库：本场奖励未发放。', 'core.weekend.038')
    }
  }
  /**
   * **黑匣**（2026-09-25「先做壳」）：真物品入库（船长 2026-09-24 口径 = 击毁旗舰必掉 ×1）。
   * ⚠ **哪一件由调用方按族给**（`blackBoxItemId`；缺省 = 落款墨潮匣，见 `weekendBlackBoxItemIdOf`）——
   * 2026-10-02 前这里写死 `blackbox-h` ⇒ R 族（光环）玩家打完自家旗舰拿到的是墨潮匣（玩家报障）。
   */
  let blackBox = 0
  if (reward.blackBox && addWare(state, reward.blackBoxItemId ?? WEEKEND_BLACKBOX_ITEM_ID, 1)) blackBox = 1
  return { isk, wreck, blackBox }
}
