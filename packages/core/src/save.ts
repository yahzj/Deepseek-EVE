/**
 * 存档：序列化、读取、版本迁移、容错修复。
 *
 * 设计说明（中文）：
 * - 存档文件 = JSON，格式 { format, version, savedAtWallMs, state }；
 * - version 是"结构版本号"。结构一改版本 +1，并补迁移函数，老档先迁移再补默认值；
 * - v1 → v2 迁移：M1 新增钱包/舰船/物品栏/采矿，老档自动获得初始资金与初始矿船；
 * - 读取三层防线：JSON 解析失败 / 格式与版本不对 / 个别字段异常逐项容错。
 */

import {
  CURRENT_STATE_VERSION,
  DEFAULT_LOG_CAP,
  DEFAULT_PILOT_NAME,
  DEFAULT_START_ISK,
  DEFAULT_START_SHIP_ID,
  HOME_GALAXY_ID,
  MAX_SKILL_LEVEL,
} from './state'
import type { BattleState, GameState,     LogEntry, LogKind, MarksState, SideTask, WormholeArchetype, WormholeFamily } from './state'
import type { AchievementEarned } from './state'
import { CHAIN_TIERS, CHAIN_TIERS_LEGACY_ORDERS, FIRST_TASKS } from './firstTasks'
import type { CommsInstanceEntry, CommsJumpPage, CommsKind, CommsRewardLine, FittedModules, RackSlot } from './types'
import type { ShipFitPreset } from './state'
import type { WormholeGridState } from './wormholeGrid'
import { WORMHOLE_HOLD_COLS, cleanHoldPlacement } from './wormholeHold'
import { WORMHOLE_SCAN_BASE_MS, WORMHOLE_STOCK_MAX_HARD } from './wormholeScan'
// 沉船记录上限（2026-09-27 船长令）：读档截断与写入共用同一常量
import { WRECK_LOG_MAX } from './shipWrecks'
import { WORMHOLE_AUTO_MAX_SHIPS, WORMHOLE_AUTO_REPORT_MAX } from './wormholeAuto'
import { WORMHOLE_ARCHETYPES, WORMHOLE_GRID_SAVE_MAX_R, wormholeArchetypeOf } from './wormholeGrid'
import { WORMHOLE_FAMILY_ORDER, wormholeFamilyOfSeed } from './wormholeFoes'
import type { WormholeHoldState } from './wormholeHold'
import { emptyFitted, uidDefId } from './labels'
import { maxScanWindowMs } from './explore'
import { pruneMarks } from './marks'
import { FIT_PRESET_MAX, FIT_PRESET_NAME_MAX } from './fitPresets'
// v27→v28 残骸合并（2026-09-19）：旧"每卡一种"残骸 id → 新「族 × 地区」组 id
import { migratedWreckItemId } from './wreckGroups'
/** 实验室产线的劳动者类型（洗完的 `worker` 字段用） */
import type { AiCoreType } from './types'
// 章鱼人削血的**旧字段迁移**（2026-09-25：`octopusDrainedMs` 时长 → `octopusHpDone` 血量）
// ⚠ 窗口必须走**同一个单源** `weekendFlagshipWindowMs`（正常 **24h**（2026-09-26 船长令起）/ 调试 10min），
//   不许在存档层再写一遍开关
import { weekendFlagshipWindowMs } from './weekendEvent'
/** 2026-10-02（每族一件黑匣批）：结算快照的 `blackBoxItemId` 白名单判据（core 单点，按 id 前缀） */
import { isBlackboxItem } from './blackbox'

/** 存档文件格式标识（防止拿别的游戏的 JSON 硬读） */
export const SAVE_FORMAT = 'whale-idle-save'
/** 兜底随机种子（老档缺 rng 字段时用） */
const FALLBACK_RNG_SEED = 0x5eed

/** 读档失败时抛出的错误，code 让界面能区分情况给玩家不同提示 */
export class SaveError extends Error {
  readonly code: 'PARSE' | 'FORMAT' | 'VERSION'
  constructor(code: 'PARSE' | 'FORMAT' | 'VERSION', message: string) {
    super(message)
    this.name = 'SaveError'
    this.code = code
  }
}

/** 合法的日志类型白名单（**2026-09-26 新分类**：+combat/industry/fleet/salvage；`queue` 留作老档兼容） */
const LOG_KINDS: ReadonlySet<string> = new Set(['system', 'info', 'queue', 'levelup', 'warn', 'trade', 'event', 'combat', 'industry', 'fleet', 'salvage']) // ⚠ 新增日志类型**必须**同步这份白名单，否则读档会把该类型的行降级成 info

/** 迁移脚本的输入/输出：只保证"是个对象"，具体字段由每个迁移自己处理 */
export type RawState = Record<string, unknown>

/**
 * **可迁移下限**（船长 2026-09-19：「**删除过旧的版本迁移，仅保留虫洞之后的**。假如之后玩家的存档版本
 * 过旧，则提示玩家新开一个存档。」）：**低于本版本的档不再迁移**，读档时抛 `SaveError('VERSION')`
 * ⇒ `engine.start()` 开新档并写一条日志（旧档文件原样留在盘上、不覆盖）。
 *
 * 为什么定在 24：v24→v25 正是"加虫洞状态"那一跳（虫洞 = v25），保它下来，v24 档仍能升上来；
 * v0~v23 那 24 级老迁移（开发早期的采矿/制造/远征/舰队重构/市场/槽位/舰船实例化…）已整段删除，
 * 细节以 git 历史兜底。
 */
export const MIN_MIGRATABLE_VERSION = 24

/**
 * 版本迁移表：key = 旧版本号，value = 把该版本变成下一版本的函数。
 * 读取时从档里的版本一路迁移到 CURRENT_STATE_VERSION，每级迁移只负责自己该转的部分，
 * 缺的字段由后面的 normalizeState 兜底补默认值。
 *
 * ⚠ **本表只覆盖 `MIN_MIGRATABLE_VERSION`（v24）起的版本**——更早的档没有脚本可走，按拒载入处理。
 */
const MIGRATIONS: Record<number, (raw: RawState) => RawState> = {
  24: (raw) => {
    // v24 -> v25（2026-09-13 虫洞副本开工）：补 `wormhole` 空状态（run: null）——
    // **字段纯新增、零行为变化**；老档不在洞里，故无需迁移进行中的副本。
    // ✅ 2026-09-14 船长解除不可见（虫洞已上线）：入口常驻、数据全部上线；玩家侧门槛 = 协会声望 ≥ 40。
    const next: RawState = { ...raw }
    const wh = asRaw(next.wormhole)
    if (wh === null || typeof wh !== 'object') next.wormhole = { run: null, lastFleetLost: 0 }
    return next
  },
  25: (raw) => {
    /**
     * v25 -> v26（2026-09-17 教程重做）：「第一次」任务系列的**一次性老档判定**。
     *
     * 口径（船长）：「**老档一次性判定与补发通讯**」⇒
     * - 老档（v25 及更早）**一律把 13 条「第一次」判为已完成**——「第一次」是新玩家的引导清单，
     *   老档早已越过这一步；判定后任务中心直接显示后续次数任务（能推导的计数按真值算：
     *   扫描 = 已点亮星系、技能 = Σ 等级；其余终身计数老档没有 ⇒ 链从 0 起）；
     * - **不发奖励**（奖励只发给真正"第一次"完成的当下）；
     * - **补发通讯**不需要本迁移动手：`{ kind: 'firstTask' }` 触发器在下一拍看到 done 即送达（按 id 幂等），
     *   13 封情报信会陆续进收件箱，老档也能回看；
     * - **不倒退**：页面/页签前置（工业/市场/星图四项）因此**只对新档生效**，老档的入口照旧开着。
     *
     * ⚠ 结构没变（`firstStats` 仍是可选字段），升版只为让这段判定**只跑一次**。
     */
    const next: RawState = { ...raw }
    const its = asRaw(next.importantTasks)
    const merged: RawState = its === null ? {} : { ...its }
    for (const def of FIRST_TASKS) {
      const prev = asRaw(merged[def.id])
      // 保留既有的 delivered/allExplored 等附带字段，只把 done 置真
      merged[def.id] = { ...(prev ?? {}), done: true }
    }
    next.importantTasks = merged
    return next
  },
  26: (raw) => {
    /**
     * v26 -> v27（2026-09-18 船长）：**市场链换口径的一次性老档折算**。
     *
     * 口径（船长）：「挂单按照市场交易收入计数，最高档按 1000 亿算」＋「老档已有的'挂单张数'给一次性折算」。
     * 本条按**级别对齐**折算（不是拍一个"每张多少 ISK"的汇率）：
     * ① 用**旧表** `CHAIN_TIERS_LEGACY_ORDERS` 由 `firstStats.orders`（挂单张数）算出老档已达级数 N；
     * ② 把 `firstStats.marketIncome` 写成**新表 `CHAIN_TIERS.marketIncome` 第 N 级**的门槛值
     *    ⇒ 折算后已达级数 **= N，一点不倒退**（旧 L10=3,000 张 ⇒ 新表第 10 级 1,000 亿）。
     * ③ 挂单 0 张的老档**不写**该键（保持"可选字段、零迁移"）；已有 `marketIncome` 的档不覆盖（幂等）。
     */
    const next: RawState = { ...raw }
    const fs = asRaw(next.firstStats)
    const stats: RawState = fs === null ? {} : { ...fs }
    const orders = typeof stats.orders === 'number' && Number.isFinite(stats.orders) ? Math.max(0, Math.floor(stats.orders)) : 0
    const legacy = CHAIN_TIERS_LEGACY_ORDERS
    const tiers = CHAIN_TIERS.marketIncome ?? []
    if (orders > 0 && typeof stats.marketIncome !== 'number') {
      let level = 0
      for (const t of legacy) if (orders >= t) level += 1
      // 级别对齐：老档的第 N 级 ⇒ 直接给新表第 N 级的门槛值（N=0 写 0 之外什么都不写）
      const aligned = level > 0 ? (tiers[level - 1] ?? 0) : 0
      if (aligned > 0) {
        stats.marketIncome = aligned
        next.firstStats = stats
      }
    }
    return next
  },
  27: (raw) => {
    /**
     * v27 -> v28（2026-09-19 船长定）：「**残骸按来源种族 × 来源地区合并**」的一次性老档折算。
     *
     * 口径（船长六答：合并粒度 = 族×地区 · 保值合并 · 组内主流档 · 稀有一起合并 · **写存档迁移** ·
     * 族称取完整名）：旧档里"每卡一种"的残骸（普通 42 + 稀有 37 = 79 种）全部折进**所属组**的残骸，
     * 数量**同组累加**——玩家一件不丢，只是同族同地区的箱子并成一件（映射表 = `WRECK_GROUP_OF_MEMBER`，
     * 与运行时新产出同一张索引，见 `core/wreckGroups.ts`）。
     *
     * 折算范围（键 = 残骸物品 id）：
     * ① 持有：`warehouse.items` · 各舰 `cargo` · 挂卖锁仓 `escrowItems`（**同组累加**）；
     * ② 稀有残骸三本账：`rareBurnUnits` / `rareBoxesOpened` / `rareOpenedUnits`（同组累加）；
     * ③ 炉子：`refineRuns[].itemId`（只换 id，**多炉不合并**——两台烧同一种料是合法状态）；
     * ④ 我的挂单：`orders[].good`（只换 key，**不同价的挂单各自保留**）；
     * ⑤ 洞内趟内：`run.bag` / `run.grid.cells[].piles` / `run.hold.placements[].itemId`
     *    与自动探索报告 `gains[].itemId`（只换 id，堆不合并）；
     * ⑥ 市场派生量（`pools` / `npcBuy` / `npcSell` / `digest` / `priceHistory` 里的**旧残骸键**）**直接删**：
     *    NPC 簿与池由 `ensureMarket` 按目录惰性重建（合并后的 8 行开盘即有），旧键留着只是垃圾；
     * ⑦ **不动**：`galaxyWrecks[].rareBy`（按卡记账 ⇒ 星图「稀有残骸 ×N（来源窝点名）」照旧）与 `rare` 计数。
     *
     * 幂等：新 id（`wreck-a-hi`）不是 `WRECK_GROUP_OF_MEMBER` 的键 ⇒ 再跑一遍是空操作
     * （合成卡的旧 id 也查不到 ⇒ 原样保留，只影响测试夹具）。
     */
    const next: RawState = { ...raw }

    /** 数量表折算：残骸键同组累加，非残骸键原样保留 */
    const remapCounts = (src: unknown): { out: Record<string, unknown>; changed: boolean } => {
      const table = asRaw(src)
      const out: Record<string, unknown> = {}
      let changed = false
      for (const [key, value] of Object.entries(table)) {
        const mapped = migratedWreckItemId(key)
        if (mapped === null) {
          out[key] = value
          continue
        }
        changed = true
        const add = typeof value === 'number' && Number.isFinite(value) ? value : 0
        const prev = typeof out[mapped] === 'number' ? (out[mapped] as number) : 0
        out[mapped] = prev + add
      }
      return { out, changed }
    }
    /** 单键折算（对象/记录里的 id 字段） */
    const remapId = (v: unknown): string | null => {
      if (typeof v !== 'string' || v.length === 0) return null
      return migratedWreckItemId(v)
    }
    /** 堆数组折算（`{itemId, units}` 列表；只换 id，不合并堆） */
    const remapPiles = (src: unknown): { out: unknown[]; changed: boolean } => {
      if (!Array.isArray(src)) return { out: [], changed: false }
      let changed = false
      const out = src.map((row) => {
        const o = asRaw(row)
        const mapped = remapId(o.itemId)
        if (mapped === null) return row
        changed = true
        return { ...o, itemId: mapped }
      })
      return { out, changed }
    }

    // ① 持有（仓库 / 货舱 / 挂卖锁仓）
    const warehouse = asRaw(next.warehouse)
    const ware = remapCounts(warehouse.items)
    if (ware.changed) next.warehouse = { ...warehouse, items: ware.out }
    const escrow = remapCounts(next.escrowItems)
    if (escrow.changed) next.escrowItems = escrow.out
    const fleet = asRaw(next.fleet)
    const fleetOut: Record<string, unknown> = {}
    let fleetChanged = false
    for (const [shipId, shipRaw] of Object.entries(fleet)) {
      const ship = asRaw(shipRaw)
      const cargo = remapCounts(ship.cargo)
      if (cargo.changed) {
        fleetOut[shipId] = { ...ship, cargo: cargo.out }
        fleetChanged = true
      } else {
        fleetOut[shipId] = shipRaw
      }
    }
    if (fleetChanged) next.fleet = fleetOut

    // ② 稀有残骸三本账
    for (const field of ['rareBurnUnits', 'rareBoxesOpened', 'rareOpenedUnits'] as const) {
      const r = remapCounts(next[field])
      if (r.changed) next[field] = r.out
    }

    // ③ 炉子（只换 id：`claimedUnits` 等炉内料账随行）
    if (Array.isArray(next.refineRuns)) {
      next.refineRuns = (next.refineRuns as unknown[]).map((row) => {
        const o = asRaw(row)
        const mapped = remapId(o.itemId)
        return mapped === null ? row : { ...o, itemId: mapped }
      })
    }

    // ④ 我的挂单
    if (Array.isArray(next.orders)) {
      next.orders = (next.orders as unknown[]).map((row) => {
        const o = asRaw(row)
        const mapped = remapId(o.good)
        return mapped === null ? row : { ...o, good: mapped }
      })
    }

    // ⑤ 洞内趟内（背包 / 格内堆 / 货仓格排布）
    const wh = asRaw(next.wormhole)
    const run = asRaw(wh.run)
    if (Object.keys(run).length > 0) {
      let runChanged = false
      const bag = remapPiles(run.bag)
      if (bag.changed) {
        run.bag = bag.out
        runChanged = true
      }
      const grid = asRaw(run.grid)
      if (Array.isArray(grid.cells)) {
        let cellsChanged = false
        const cells = (grid.cells as unknown[]).map((cellRaw) => {
          const cell = asRaw(cellRaw)
          const piles = remapPiles(cell.piles)
          if (!piles.changed) return cellRaw
          cellsChanged = true
          return { ...cell, piles: piles.out }
        })
        if (cellsChanged) {
          run.grid = { ...grid, cells }
          runChanged = true
        }
      }
      const hold = asRaw(run.hold)
      if (Array.isArray(hold.placements)) {
        let holdChanged = false
        const placements = (hold.placements as unknown[]).map((row) => {
          const o = asRaw(row)
          const mapped = remapId(o.itemId)
          if (mapped === null) return row
          holdChanged = true
          return { ...o, itemId: mapped }
        })
        if (holdChanged) {
          run.hold = { ...hold, placements }
          runChanged = true
        }
      }
      if (runChanged) next.wormhole = { ...wh, run }
    }
    // 自动探索报告（历史读数：不折算会在报告里显示成裸 id）
    if (Array.isArray(next.wormholeAutoReports)) {
      let reportsChanged = false
      const reports = (next.wormholeAutoReports as unknown[]).map((row) => {
        const o = asRaw(row)
        const gains = remapPiles(o.gains)
        if (!gains.changed) return row
        reportsChanged = true
        return { ...o, gains: gains.out }
      })
      if (reportsChanged) next.wormholeAutoReports = reports
    }

    // ⑥ 市场派生量：删掉旧残骸键（池/簿/消化队列/价格小史），新键由 ensureMarket 惰性重建
    const market = asRaw(next.market)
    if (Object.keys(market).length > 0) {
      let marketChanged = false
      for (const field of ['pools', 'npcBuy', 'npcSell', 'digest', 'priceHistory'] as const) {
        const table = asRaw(market[field])
        const keys = Object.keys(table).filter((k) => migratedWreckItemId(k) !== null)
        if (keys.length === 0) continue
        const out: Record<string, unknown> = { ...table }
        for (const k of keys) delete out[k]
        market[field] = out
        marketChanged = true
      }
      if (marketChanged) next.market = market
    }

    return next
  },
  /**
   * v28 -> v29（2026-09-19 船长：「消耗谜质升级的研究科技树」）：**纯新增字段** ——
   * 补 `research.levels = {}`（一级未点）⇒ 老档读进来就是"科技树全空"，
   * 所有科技效果项为 0 ⇒ **零行为变化**（唯一例外 = 本批同时改的基础回合 100 → 80，那是难度改动、
   * 与迁移无关）。幂等：已有 `research` 的档原样保留。
   */
  28: (raw) => {
    if (raw.research !== undefined) return raw
    return { ...raw, research: { levels: {} } }
  },
  /**
   * v29 -> v30（2026-09-20 船长：「继续之前的成就系统」）：**纯新增字段** —— 补 `achievements.earned = {}`。
   *
   * ⚠ **补发不在这里做，也不需要在这里做**：本层拿不到内容表（`MIGRATIONS` 只吃 raw state，无 ctx），
   * 而"老档已达成者补发"由 `core/achievements.ts` 的 `advanceAchievements` **在载入后的第一拍现算补上**
   * （判据是 `state` 现状、幂等 ⇒ 老档一进游戏，够格的徽章就自动到手）。
   * 好处：① core 不必反向依赖数据层 ② 补发逻辑只有**一份**（不在迁移里再抄一遍判定）
   * ③ 以后新增判定支线时，老档照样自愈。
   *
   * 代价（已接受）：补发时刻记的是"载入后第一拍的 `gameMs`"，不是当年真实达成时间——
   * 老档无从知道真实时刻，且徽章**纯展示、不影响任何行为**（船长 2026-09-20 裁定）⇒ 无影响。
   *
   * 幂等：已有 `achievements` 的档原样保留（不覆盖玩家已到手的徽章）。
   */
  29: (raw) => {
    if (raw.achievements !== undefined) return raw
    return { ...raw, achievements: { earned: {} } }
  },
  /**
   * v30 -> v31（**2026-09-21 船长令**：**「第一次」任务不再自动完成，玩家回任务中心点「完成」才推进**
   * ＋「老档直接完成」）：**纯新增字段** —— 给**老档**打一个一次性收口标记 `firstTaskAutoClaim = true`。
   *
   * 为什么标记而不是在这里直接改 `importantTasks`：本层拿不到内容表（`MIGRATIONS` 只吃 raw state、无 ctx），
   * 而"这条判据满没满"要跑 `judge(state, ctx)` ⇒ 与 v29→v30 的成就补发同款做法：
   * **迁移只打标记，真正的收口在载入后第一拍由 `engine` 现算完成**（按点击同款发奖发信、进下一条，
   * 跑完即删键）。这样 ① core 不反向依赖数据层 ② 收口逻辑只有一份（不在迁移里再抄一遍判定）
   * ③ 新档不带这个键 ⇒ 一律走手动流程。
   */
  30: (raw) => ({ ...raw, firstTaskAutoClaim: true }),
}

/** 战斗档清洗整簇（2026-10-02 批次 4m 迁到 saveBattleClean.ts；本文件借回 + 再导出） */
import { asRaw, cleanAmmoIdMap, cleanBattle, cleanPlugIds, RACK_MAX } from './saveBattleClean'
export { BATTLE_PERSIST_KEYS } from './saveBattleClean'

/**
 * 把一份任意来源的原始存档数据"整容"成合法、完整的当前版本状态。
 * 原则：能修则修（类型不对丢弃、范围越界截断、缺字段补默认值），尽量不丢档。
 */
function normalizeState(raw: unknown): GameState {
  const src = asRaw(raw)

  // --- 日志上限 ---
  const logCap =
    typeof src.logCap === 'number' && Number.isFinite(src.logCap) && src.logCap > 0
      ? Math.floor(src.logCap)
      : DEFAULT_LOG_CAP

  // --- 角色 ---
  const charRaw = asRaw(src.character)
  const character = {
    name: typeof charRaw.name === 'string' && charRaw.name.length > 0 ? charRaw.name : DEFAULT_PILOT_NAME,
    startedAtWallMs:
      typeof charRaw.startedAtWallMs === 'number' && Number.isFinite(charRaw.startedAtWallMs)
        ? charRaw.startedAtWallMs
        : 0,
  }

  // --- 技能 ---
  const skillsRaw = asRaw(src.skills)
  const trained: Record<string, number> = {}
  const trainedRaw = asRaw(skillsRaw.trained)
  for (const [key, value] of Object.entries(trainedRaw)) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      trained[key] = Math.min(MAX_SKILL_LEVEL, Math.floor(value))
    }
  }
  const queue: Array<{ skillId: string; targetLevel: number; progressMs: number }> = []
  const queueRaw = skillsRaw.queue
  if (Array.isArray(queueRaw)) {
    for (const q of queueRaw) {
      if (typeof q !== 'object' || q === null) continue
      const item = q as RawState
      const skillId = typeof item.skillId === 'string' ? item.skillId : ''
      if (skillId.length === 0) continue
      const targetLevel =
        typeof item.targetLevel === 'number' && Number.isFinite(item.targetLevel)
          ? Math.min(MAX_SKILL_LEVEL, Math.max(1, Math.floor(item.targetLevel)))
          : 1
      const progressMs =
        typeof item.progressMs === 'number' && Number.isFinite(item.progressMs)
          ? Math.max(0, Math.floor(item.progressMs))
          : 0
      queue.push({ skillId, targetLevel, progressMs })
    }
  }
  // T2 兼容字段（v16.1）：技能暂存进度——只收正数毫秒、非负整数、上限一天（正常单级最长约 1 小时，留足余量）
  const savedProgress: Record<string, number> = {}
  const savedProgressRaw = asRaw(skillsRaw.savedProgress)
  for (const [key, value] of Object.entries(savedProgressRaw)) {
    if (key.length === 0) continue
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      savedProgress[key] = Math.min(24 * 60 * 60 * 1000, Math.floor(value))
    }
  }

  /**
 * **技能训练许可**（2026-09-27 船长令「我想让学习技能有成本」）——
 * 只收「值恒 `true`」的键（严格比较：写坏了的值一律丢弃 ⇒ 不会凭空给出一本许可）。
 * ⚠ **老档零迁移**：改动前的档没有这个键 ⇒ 清洗出空表即可；"已经练到 Lv≥1 视同已购"
 * 那条豁免走判据（`hasSkillLicense`），**不落任何迁移键**。
 */
const licenses: Record<string, true> = {}
const licensesRaw = asRaw(skillsRaw.licenses)
for (const [key, value] of Object.entries(licensesRaw)) {
  if (key.length === 0) continue
  if (value === true) licenses[key] = true
}

// --- 钱包（v2） ---
  const walletRaw = asRaw(src.wallet)
  const wallet = {
    isk:
      typeof walletRaw.isk === 'number' && Number.isFinite(walletRaw.isk)
        ? Math.max(0, Math.floor(walletRaw.isk))
        : DEFAULT_START_ISK,
  }

  // --- 当前舰船（v2） ---
  const shipId = typeof src.shipId === 'string' && src.shipId.length > 0 ? src.shipId : DEFAULT_START_SHIP_ID

  // --- 舰队（v7 起 耐久/货仓/装备；v17 实例化：条目含 defId + customName） ---
  const slotId = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)
  // 自定义名归一：去首尾空白、按字（码点）限 10、空则回落 null
  const cleanCustomName = (v: unknown): string | null => {
    if (typeof v !== 'string') return null
    const t = v.trim()
    const chars = [...t]
    if (chars.length === 0) return null
    return chars.slice(0, 10).join('')
  }
  const freshShip = (
    defId: string,
  ): {
    defId: string
    customName: string | null
    durability: number
    armorPct?: number
    cargo: Record<string, number>
    fitted: FittedModules
    droneLoad?: Record<string, number>
    /** 舰船插件（2026-09-26）：新船**没有**插件 ⇒ 不下发该键（与 `droneLoad` 同款） */
    plugs?: string[]
    ammoPref?: Partial<Record<'kinetic' | 'explosive' | 'plasma', string>>
  } => ({
    defId,
    customName: null,
    durability: 1,
    armorPct: 1,
    cargo: {},
    fitted: emptyFitted(),
  })
  const fleet: Record<string, ReturnType<typeof freshShip>> = {}
  const fleetRaw = asRaw(src.fleet)
  const hasFleet = typeof src.fleet === 'object' && src.fleet !== null
  for (const [id, shipRawValue] of Object.entries(fleetRaw)) {
    if (id.length === 0) continue
    const shipRaw = asRaw(shipRawValue)
    const cargoMap: Record<string, number> = {}
    const cargoRaw = asRaw(shipRaw.cargo)
    for (const [key, value] of Object.entries(cargoRaw)) {
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        cargoMap[key] = Math.floor(value)
      }
    }
    const fRaw = asRaw(shipRaw.fitted)
    const durabilityRaw = shipRaw.durability
    const durability =
      typeof durabilityRaw === 'number' && Number.isFinite(durabilityRaw)
        ? Math.min(1, Math.max(0, Math.round(durabilityRaw * 1000) / 1000))
        : 1
    // P0 承伤持久化：装甲残余（0~1）。仅当原档带数值才写回（迁移层负责给旧档补 1；
    // 创建层一律显式带 1）——避免给无字段的新建条目强插默认值破坏往返一致性
    const armorRaw = shipRaw.armorPct
    const armorPct =
      typeof armorRaw === 'number' && Number.isFinite(armorRaw)
        ? Math.min(1, Math.max(0, Math.round(armorRaw * 1000) / 1000))
        : undefined
    // v17：defId 缺省按实例 uid 回填（第 1 艘 uid = 船型 id）
    const defId = typeof shipRaw.defId === 'string' && shipRaw.defId.length > 0 ? shipRaw.defId : uidDefId(id)
    // V18 fitted 容错：三类位数组（逐位净化）；v17 六槽 Record → 原位映射为 2/2/2 过渡形状
    const fitted: FittedModules = emptyFitted()
    if (Array.isArray(fRaw.high) || Array.isArray(fRaw.mid) || Array.isArray(fRaw.low)) {
      const rackOfRaw = (rack: RackSlot): Array<string | null> =>
        Array.isArray(fRaw[rack]) ? (fRaw[rack] as unknown[]).map((v) => slotId(v)) : []
      fitted.high = rackOfRaw('high')
      fitted.mid = rackOfRaw('mid')
      fitted.low = rackOfRaw('low')
    } else {
      const pick = (fam: string): string | null => (typeof fRaw[fam] === 'string' ? slotId(fRaw[fam]) : null)
      fitted.high = [pick('turret'), pick('miner')]
      fitted.mid = [pick('shield'), pick('propulsion')]
      fitted.low = [pick('armor'), pick('cargo')]
    }
    // 2026-09-08 无人机舱大改：droneLoad 清洗（正整数、删 0/非法值；旧档缺省 = 空 = 无无人机）
    const dlRaw = asRaw(shipRaw.droneLoad)
    let droneLoad: Record<string, number> | undefined
    for (const [k, v] of Object.entries(dlRaw)) {
      if (k.length === 0) continue
      const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 0
      if (n > 0) {
        if (!droneLoad) droneLoad = {}
        droneLoad[k] = n
      }
    }
    fleet[id] = {
      defId,
      customName: cleanCustomName(shipRaw.customName),
      durability,
      armorPct,
      cargo: cargoMap,
      fitted,
      droneLoad,
      // 舰船插件（2026-09-26，兼容字段无版本号）：非空字符串、去重、上限 = 槽位上限 8；
      // ⚠ 漏了这里 ⇒ 读档/刷新即丢插件（`salvagerGift` 同款静默缺口），设计稿 §五 已点名。
      plugs: cleanPlugIds(shipRaw.plugs),
      // 弹药 MK2（2026-09-09）：档位偏好透传（键 = 伤害类型；坏值丢键，引擎侧再防御未知 id）
      ammoPref: cleanAmmoIdMap(shipRaw.ammoPref),
    }
  }
  if (Object.keys(fleet).length === 0) {
    // 坏档保底：至少一艘初始船（旧档 inventory 内容若存在则并入它的货仓）
    const ship = freshShip(DEFAULT_START_SHIP_ID)
    if (!hasFleet) {
      const legacyInv = asRaw(asRaw(src.inventory).items)
      for (const [key, value] of Object.entries(legacyInv)) {
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) ship.cargo[key] = Math.floor(value)
      }
    }
    fleet[DEFAULT_START_SHIP_ID] = ship
  }
  if (!(shipId in fleet)) {
    // 当前船不在舰队（坏档）：补一个完好条目
    fleet[shipId] = freshShip(uidDefId(shipId))
  }

  // --- T5 船只锁定（v16.1 兼容字段）：只收 true、剪掉不在舰队里的船 ---
  const shipLocks: Record<string, boolean> = {}
  const shipLocksRaw = asRaw(src.shipLocks)
  for (const [shipKey, value] of Object.entries(shipLocksRaw)) {
    if (value === true && shipKey in fleet) shipLocks[shipKey] = true
  }

  // --- 2026-09-10 玩家标记（收藏；v24 兼容字段，无版本号变化）：五类清单白名单重建 ---
  // 逐类只收非空字符串；去重与"舰船必须在舰队里"的剪枝由末尾 pruneMarks(normalized) 统一做
  // （那里 fleet 已建好）。老档缺 marks = 五类全空。
  // ⚠ **2026-09-30 加 `labRecipes`**（实验室配方，船长令：实验室卡补 ⭐，与精炼炉卡同款）——
  //   这一族与 `recipes` 不是一个 id 空间（那边是物品 id、这边是配方 id）⇒ 必须单开一类，
  //   否则两处 key 混进同一张表。漏登记本行的症状 = 打过的星标每次读档就没了。
  const marks: MarksState = { goods: [], recipes: [], blueprints: [], ships: [], labRecipes: [] }
  const marksRaw = asRaw(src.marks)
  for (const kind of ['goods', 'recipes', 'blueprints', 'ships', 'labRecipes'] as const) {
    for (const id of Object.values(asRaw(marksRaw[kind]))) {
      if (typeof id === 'string' && id.length > 0) marks[kind].push(id)
    }
  }

  // --- 物品仓库（v7） ---
  const warehouseItems: Record<string, number> = {}
  const wareRaw = asRaw(asRaw(src.warehouse).items)
  for (const [key, value] of Object.entries(wareRaw)) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      warehouseItems[key] = Math.floor(value)
    }
  }

  // --- AI 核心库（v8） ---
  const aiCores: Record<string, number> = { basic: 0, gamma: 0, beta: 0, alpha: 0 }
  const aiCoresRaw = asRaw(src.aiCores)
  for (const [key, value] of Object.entries(aiCoresRaw)) {
    if (key in aiCores && typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      aiCores[key] = Math.floor(value)
    }
  }

  // --- AI 副船任务（v8）：条目或字段非法则丢弃（核心归还由引擎推进时保证一致性） ---
  const aiAssignmentsRaw = asRaw(src.aiAssignments)
  const aiAssignments: Record<string, unknown> = {}
  /**
   * **跃迁燃料倍率**（**2026-09-29 跃迁燃料批**）：存的是"本趟返航吃了燃料"这一事实（值 = 10）。
   * 缺省/≤1/坏值 ⇒ 不写键（老档零迁移）。⚠ **必须随档**：若读一次档就丢，玩家已经被扣过料的那一趟
   * 会变回原速飞完（扣了料却没加速，属"吃料"级事故）。
   */
  const fuelMulOf = (v: unknown): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) && v > 1 ? Math.floor(v) : undefined
  const validCoreType = (v: unknown): v is string =>
    typeof v === 'string' && (v === 'basic' || v === 'gamma' || v === 'beta' || v === 'alpha')
  for (const [shipKey, assignRaw] of Object.entries(aiAssignmentsRaw)) {
    const a = asRaw(assignRaw)
    if (!validCoreType(a.coreType)) continue
    const startedAt =
      typeof a.startedAtGameMs === 'number' && Number.isFinite(a.startedAtGameMs)
        ? Math.max(0, Math.floor(a.startedAtGameMs))
        : 0
    const taskRaw = asRaw(a.task)
    if (taskRaw.kind === 'mining') {
      const beltId = typeof taskRaw.beltId === 'string' ? taskRaw.beltId : ''
      const phaseRaw = taskRaw.phase
      if (!beltId) continue
      aiAssignments[shipKey] = {
        coreType: a.coreType,
        startedAtGameMs: startedAt,
        task: {
          kind: 'mining',
          beltId,
          phase: phaseRaw === 'returning' || phaseRaw === 'outbound' ? phaseRaw : 'mining',
          cycleAccMs:
            typeof taskRaw.cycleAccMs === 'number' && Number.isFinite(taskRaw.cycleAccMs)
              ? Math.max(0, Math.floor(taskRaw.cycleAccMs))
              : 0,
          phaseAccMs:
            typeof taskRaw.phaseAccMs === 'number' && Number.isFinite(taskRaw.phaseAccMs)
              ? Math.max(0, Math.floor(taskRaw.phaseAccMs))
              : 0,
          tripUnits:
            typeof taskRaw.tripUnits === 'number' && Number.isFinite(taskRaw.tripUnits)
              ? Math.max(0, Math.floor(taskRaw.tripUnits))
              : 0,
          // 卷B2⑥ 零迁移：富矿红利窗口剩余循环数（缺失按 0；不升存档版本号）
          rvLeft: taskRaw.rvLeft === 1 ? 1 : 0,
          ...(fuelMulOf(taskRaw.fuelMul) !== undefined ? { fuelMul: fuelMulOf(taskRaw.fuelMul)! } : {}),
        },
      }
    } else if (taskRaw.kind === 'standby') {
      const galaxyId = typeof taskRaw.galaxyId === 'string' ? taskRaw.galaxyId : ''
      if (!galaxyId) continue
      const phaseRaw = taskRaw.phase
      const phase: 'out' | 'stand' = phaseRaw === 'stand' ? 'stand' : 'out'
      aiAssignments[shipKey] = {
        coreType: a.coreType,
        startedAtGameMs: startedAt,
        task: {
          kind: 'standby',
          galaxyId,
          finishAtGameMs:
            typeof taskRaw.finishAtGameMs === 'number' && Number.isFinite(taskRaw.finishAtGameMs)
              ? Math.max(0, Math.floor(taskRaw.finishAtGameMs))
              : 0,
          outMs:
            typeof taskRaw.outMs === 'number' && Number.isFinite(taskRaw.outMs)
              ? Math.max(0, Math.floor(taskRaw.outMs))
              : 0,
          phase,
        },
      }
    } else if (taskRaw.kind === 'expedition') {
      const anomalyId = typeof taskRaw.anomalyId === 'string' ? taskRaw.anomalyId : ''
      if (!anomalyId) continue
      // V12：远征任务两阶段（out/battle/back）+ battle 状态（battle 失效则回落到 out）
      const phaseRaw = taskRaw.phase
      const phase: 'out' | 'battle' | 'back' =
        phaseRaw === 'battle' || phaseRaw === 'back' ? phaseRaw : 'out'
      let battle: BattleState | null = null
      if (phase === 'battle') {
        battle = cleanBattle(taskRaw.battle)
      }
      aiAssignments[shipKey] = {
        coreType: a.coreType,
        startedAtGameMs: startedAt,
        task: {
          kind: 'expedition',
          anomalyId,
          finishAtGameMs:
            typeof taskRaw.finishAtGameMs === 'number' && Number.isFinite(taskRaw.finishAtGameMs)
              ? Math.max(0, Math.floor(taskRaw.finishAtGameMs))
              : 0,
          outMs:
            typeof taskRaw.outMs === 'number' && Number.isFinite(taskRaw.outMs)
              ? Math.max(0, Math.floor(taskRaw.outMs))
              : 0,
          power:
            typeof taskRaw.power === 'number' && Number.isFinite(taskRaw.power)
              ? Math.max(0, Math.floor(taskRaw.power))
              : 0,
          phase: phase === 'battle' && battle === null ? 'out' : phase,
          battle,
          ...(fuelMulOf(taskRaw.fuelMul) !== undefined ? { fuelMul: fuelMulOf(taskRaw.fuelMul)! } : {}),
        },
      }
    } else if (taskRaw.kind === 'salvage') {
      // B3 AI 打捞任务（兼容字段）：星系合法才保留；相位/相位账重建
      const galaxyId = typeof taskRaw.galaxyId === 'string' ? taskRaw.galaxyId : ''
      if (!galaxyId) continue
      const phaseRaw = taskRaw.phase
      const phase: 'outbound' | 'salvaging' | 'returning' =
        phaseRaw === 'outbound' || phaseRaw === 'returning' ? phaseRaw : 'salvaging'
      aiAssignments[shipKey] = {
        coreType: a.coreType,
        startedAtGameMs: startedAt,
        task: {
          kind: 'salvage',
          galaxyId,
          phase,
          phaseAccMs:
            typeof taskRaw.phaseAccMs === 'number' && Number.isFinite(taskRaw.phaseAccMs)
              ? Math.max(0, Math.floor(taskRaw.phaseAccMs))
              : 0,
          cycleAccMs:
            typeof taskRaw.cycleAccMs === 'number' && Number.isFinite(taskRaw.cycleAccMs)
              ? Math.max(0, Math.floor(taskRaw.cycleAccMs))
              : 0,
          deviceAccMs: {},
          tripM3:
            typeof taskRaw.tripM3 === 'number' && Number.isFinite(taskRaw.tripM3) ? Math.max(0, taskRaw.tripM3) : 0,
          ...(fuelMulOf(taskRaw.fuelMul) !== undefined ? { fuelMul: fuelMulOf(taskRaw.fuelMul)! } : {}),
        },
      }
    }
  }

  // --- T4 换船善后返航（v16.1 兼容字段）：字段非法则整条丢弃；已走时间封顶单程 ---
  const shipReturns: Record<string, { beltId: string | null; legMs: number; phaseAccMs: number; reason?: 'mining' | 'expedition' | 'salvage' | 'salvageStop' | 'miningStop' }> = {}
  const shipReturnsRaw = asRaw(src.shipReturns)
  for (const [shipKey, retRaw] of Object.entries(shipReturnsRaw)) {
    if (shipKey.length === 0) continue
    if (typeof retRaw !== 'object' || retRaw === null) continue
    const r = asRaw(retRaw)
    const beltId = typeof r.beltId === 'string' && r.beltId.length > 0 ? r.beltId : null
    const legMs =
      typeof r.legMs === 'number' && Number.isFinite(r.legMs) ? Math.max(1, Math.floor(r.legMs)) : 1
    const phaseAccMs =
      typeof r.phaseAccMs === 'number' && Number.isFinite(r.phaseAccMs)
        ? Math.min(legMs, Math.max(0, Math.floor(r.phaseAccMs)))
        : 0
    /**
     * ⚠ **五个 reason 一个都不能漏**（**2026-10-02 补** `salvage`/`salvageStop`/`miningStop`）：
     * 旧名单只认 `expedition`/`mining` ⇒ 另外三种在往返时**丢掉 reason 字段**
     * （被 save 的"引擎写过的键一个不少"护栏抓到：`shipReturns.<船>.reason`）。
     * 丢掉它不影响游戏（只关系到港日志措辞），但**往返形状必须一致**。
     */
    const reason =
      r.reason === 'expedition'
        ? ('expedition' as const)
        : r.reason === 'mining'
          ? ('mining' as const)
          : r.reason === 'salvage'
            ? ('salvage' as const)
            : r.reason === 'salvageStop'
              ? ('salvageStop' as const)
              : r.reason === 'miningStop'
                ? ('miningStop' as const)
                : undefined
    shipReturns[shipKey] = reason ? { beltId, legMs, phaseAccMs, reason } : { beltId, legMs, phaseAccMs }
  }

  // --- 采矿作业（v2 起；v7 起为自动循环状态机） ---
  const miningRaw = asRaw(src.mining)
  const phase: 'mining' | 'returning' | 'outbound' =
    miningRaw.phase === 'returning' || miningRaw.phase === 'outbound' ? miningRaw.phase : 'mining'
  const mining = {
    active: miningRaw.active === true,
    beltId: typeof miningRaw.beltId === 'string' && miningRaw.beltId.length > 0 ? miningRaw.beltId : null,
    phase,
    cycleAccMs:
      typeof miningRaw.cycleAccMs === 'number' && Number.isFinite(miningRaw.cycleAccMs)
        ? Math.max(0, Math.floor(miningRaw.cycleAccMs))
        : 0,
    phaseAccMs:
      typeof miningRaw.phaseAccMs === 'number' && Number.isFinite(miningRaw.phaseAccMs)
        ? Math.max(0, Math.floor(miningRaw.phaseAccMs))
        : 0,
    tripUnits:
      typeof miningRaw.tripUnits === 'number' && Number.isFinite(miningRaw.tripUnits)
        ? Math.max(0, Math.floor(miningRaw.tripUnits))
        : 0,
    autoCycle: miningRaw.autoCycle !== false,
    stopAfterTrip: miningRaw.stopAfterTrip === true,
    originGalaxy:
      typeof miningRaw.originGalaxy === 'string' && miningRaw.originGalaxy.length > 0
        ? miningRaw.originGalaxy
        : null,
    // 卷B2⑥ 零迁移：富矿红利窗口剩余循环数（缺失按 0；不升存档版本号）
    rvLeft: miningRaw.rvLeft === 1 ? 1 : 0,
    ...(fuelMulOf(miningRaw.fuelMul) !== undefined ? { fuelMul: fuelMulOf(miningRaw.fuelMul)! } : {}),
  }

  // --- 装备库（v3） ---
  const moduleBay: Record<string, number> = {}
  const moduleBayRaw = asRaw(src.moduleBay)
  for (const [key, value] of Object.entries(moduleBayRaw)) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      moduleBay[key] = Math.floor(value)
    }
  }

  // --- 已学会配方与蓝图书架（v9；v3-v8 的 blueprints 字段在迁移 8 已转成 learnedRecipes） ---
  const learnedRecipes: string[] = []
  const learnedRaw = src.learnedRecipes
  if (Array.isArray(learnedRaw)) {
    for (const bp of learnedRaw) {
      if (typeof bp === 'string' && bp.length > 0 && !learnedRecipes.includes(bp)) learnedRecipes.push(bp)
    }
  }
  const blueprintStock: Record<string, number> = {}
  const bpStockRaw = asRaw(src.blueprintStock)
  for (const [key, value] of Object.entries(bpStockRaw)) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      blueprintStock[key] = Math.floor(value)
    }
  }
  // 兼容兜底：若读了旧结构（blueprints 字段仍在，如直写 v9 的测试档），并入已学会配方
  if (Array.isArray(src.blueprints)) {
    for (const bp of src.blueprints) {
      if (typeof bp === 'string' && bp.length > 0 && !learnedRecipes.includes(bp)) learnedRecipes.push(bp)
    }
  }
  /**
   * --- 舰船仓库（2026-09-14 船长，**兼容字段：老档缺省 = 空，零迁移**）---
   * 只收**正整数**艘数（负数/小数/非数值一律丢弃；0 与空键不落档，与 blueprintStock 同款写法）。
   */
  const shipStore: Record<string, number> = {}
  for (const [key, value] of Object.entries(asRaw(src.shipStore))) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      shipStore[key] = Math.floor(value)
    }
  }
  /**
   * --- 装配方案（2026-09-14 船长，**兼容字段：老档缺省 = 空，零迁移**）---
   * **只做结构清洗**：本层拿不到内容表（`normalizeState(raw)` 无 ctx）⇒ **不校验 id 是否存在**；
   * 下架/未知件在**套用时**逐条报进"未装"清单（见 `fitPresets.applyFitPreset`）。
   * 清洗规则：每型 ≤ `FIT_PRESET_MAX` 条 · 名称去空白并限长（空名丢弃）· 位数组只留非空字符串、
   * 裁掉尾部空位、长度 ≤ `RACK_MAX`（槽位上限；插件上线后由 7 抬到 8）· 无人机只收正整数 · **全空方案丢弃**。
   */
  const fitPresets: Record<string, ShipFitPreset[]> = {}
  for (const [defId, listRaw] of Object.entries(asRaw(src.fitPresets))) {
    if (defId.length === 0 || !Array.isArray(listRaw)) continue
    const list: ShipFitPreset[] = []
    for (const itemRaw of listRaw) {
      const item = asRaw(itemRaw)
      const name = typeof item.name === 'string' ? item.name.trim().slice(0, FIT_PRESET_NAME_MAX) : ''
      if (name.length === 0) continue
      const fitRaw = asRaw(item.fitted)
      const cleanRack = (v: unknown): Array<string | null> => {
        if (!Array.isArray(v)) return []
        const out: Array<string | null> = []
        for (const x of v.slice(0, RACK_MAX)) out.push(typeof x === 'string' && x.length > 0 ? x : null)
        while (out.length > 0 && out[out.length - 1] === null) out.pop()
        return out
      }
      const fitted = { high: cleanRack(fitRaw.high), mid: cleanRack(fitRaw.mid), low: cleanRack(fitRaw.low) }
      const droneLoad: Record<string, number> = {}
      for (const [id, n] of Object.entries(asRaw(item.droneLoad))) {
        if (typeof n === 'number' && Number.isFinite(n) && n > 0) droneLoad[id] = Math.floor(n)
      }
      const empty =
        fitted.high.length + fitted.mid.length + fitted.low.length === 0 && Object.keys(droneLoad).length === 0
      if (empty) continue
      list.push({ name, fitted, ...(Object.keys(droneLoad).length > 0 ? { droneLoad } : {}) })
      if (list.length >= FIT_PRESET_MAX) break
    }
    if (list.length > 0) fitPresets[defId] = list
  }
  // --- 一次性图纸"名额已用尽"（2026-09-12 兼容字段；老档缺省 = 空，零迁移） ---
  const spentOneTimeRecipes: string[] = []
  if (Array.isArray(src.spentOneTimeRecipes)) {
    for (const bp of src.spentOneTimeRecipes) {
      if (typeof bp === 'string' && bp.length > 0 && !spentOneTimeRecipes.includes(bp)) spentOneTimeRecipes.push(bp)
    }
  }
  // --- 回收"不足 1 单位"余额（2026-09-14 兼容字段；老档缺省 = 空，零迁移）---
  // 只收 [0,1) 的有限数：越界/非数/负数一律丢掉——它只是"余数"，重算一次即可，不会亏玩家
  const recycleCarry: Record<string, number> = {}
  for (const [id, v] of Object.entries(asRaw(src.recycleCarry))) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue
    recycleCarry[id] = v % 1
  }

  // --- 市场（v9）：整表容错；缺失/损坏的簿与池留空，首次推进由引擎按目录补齐 ---
  const marketRaw = asRaw(src.market)
  const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
  /**
   * 簿面订单清洗。⚠ **必须保住 `bm`**（BM 声望门槛单 · 2026-09-25 修）：`marketCatalog` 给 MK3 专属/图纸行
   * 挂了 `bmStanding` ⇒ 引擎会把 `bm` 写进收购单，而原先这里只留 price/qty/expiresAtGameMs ⇒ **往返丢键**
   * （`save.test.ts` 的「引擎跑过的档不许丢键」护栏抓到 `market.npcBuy.<键>[].bm`）。缺省/非正 ⇒ 不写（老档零迁移）。
   */
  const orderList = (rawList: unknown): Array<{ price: number; qty: number; expiresAtGameMs: number; bm?: number | boolean | null }> => {
    const out: Array<{ price: number; qty: number; expiresAtGameMs: number; bm?: number | boolean | null }> = []
    if (!Array.isArray(rawList)) return out
    for (const item of rawList) {
      const o = asRaw(item)
      const qty = Math.floor(num(o.qty))
      const price = Math.floor(num(o.price))
      if (qty <= 0 || price <= 0) continue
      /**
       * ⚠ **按"字段存在"保留，而不是"是数字才保留"**（2026-09-25 实测踩到）：引擎给非 BM 货写的是
       * `bm: null`（`undefined` 会被 JSON 丢掉、`null` 不会）⇒ 只认数字会把 `null` 滤掉，
       * 于是"引擎写过 `bm`、读回来没了"。**存在即原样保留**（数字取整；其余落 `null`）⇒ 往返逐字一致。
       */
      const hasBm = Object.prototype.hasOwnProperty.call(o, 'bm')
      // 引擎写的是 m: true（BM 声望门槛标记 · 布尔）⇒ 必须原样保留（见上方注释：按数字处理会连丢两次）
      const bmRaw = o.bm
      const bmVal = typeof bmRaw === 'boolean' ? bmRaw : typeof bmRaw === 'number' && Number.isFinite(bmRaw) ? Math.max(0, Math.floor(bmRaw)) : null
      out.push({
        price,
        qty,
        expiresAtGameMs: Math.max(0, Math.floor(num(o.expiresAtGameMs))),
        ...(hasBm ? { bm: bmVal } : {}),
      })
    }
    return out
  }
  const pools: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(asRaw(marketRaw.pools))) {
    const p = asRaw(value)
    pools[key] = {
      q: Math.max(0, Math.floor(num(p.q))),
      shock: num(p.shock, 0),
      netVol: num(p.netVol, 0),
      lastHistoryGameMs: Math.max(0, Math.floor(num(p.lastHistoryGameMs))),
      noise: num(p.noise, 0),
    }
  }
  const buyBooks: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(asRaw(marketRaw.npcBuy))) buyBooks[key] = orderList(value)
  const sellBooks: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(asRaw(marketRaw.npcSell))) sellBooks[key] = orderList(value)
  const digests: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(asRaw(marketRaw.digest))) {
    const d = asRaw(value)
    const qty = Math.max(0, Math.floor(num(d.qty)))
    if (qty > 0) {
      digests[key] = {
        qty,
        price: Math.max(0, Math.floor(num(d.price))),
        perWindow: Math.max(0, Math.floor(num(d.perWindow))),
      }
    }
  }
  // 零值消化条目补全：与池同键集，避免读档后窗口推进遇缺键（引擎也有兜底，这里保持档面整洁）
  for (const key of Object.keys(pools)) {
    if (!(key in digests)) digests[key] = { qty: 0, price: 0, perWindow: 0 }
  }
  const histories: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(asRaw(marketRaw.priceHistory))) {
    if (!Array.isArray(value)) continue
    const cleaned: number[] = []
    for (const v of value) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) cleaned.push(Math.round(v))
    }
    if (cleaned.length > 0) histories[key] = cleaned.slice(-24)
  }
  // --- 我的挂单自增号不能低于现有订单 id（防未来挂单撞号） ---
  let maxOrderId = 0
  if (Array.isArray(src.orders)) {
    for (const entry of src.orders) {
      if (typeof entry !== 'object' || entry === null) continue
      const o = entry as RawState
      const id = Math.floor(num(o.id))
      if (Number.isFinite(id) && id > maxOrderId) maxOrderId = id
    }
  }
  const market = {
    pools: pools as GameState['market']['pools'],
    npcBuy: buyBooks as GameState['market']['npcBuy'],
    npcSell: sellBooks as GameState['market']['npcSell'],
    digest: digests as GameState['market']['digest'],
    lastTickGameMs: Math.max(0, Math.floor(num(marketRaw.lastTickGameMs))),
    orderSeq: Math.max(Math.max(0, Math.floor(num(marketRaw.orderSeq))), maxOrderId),
    priceHistory: histories as GameState['market']['priceHistory'],
    // P2 稀有/奇货抽取节拍基准（2026-09-09 修复：必须随档透传——此前白名单漏掉本键，
    // 每次读档（启动/恢复存档）都被 ensureMarket 重置回"开市前 10 分钟"→ 恢复后首窗重复
    // 抽取一次、抽取相位随每次读档漂移，多次倒档重放会叠加出异常供给单；旧档无键 = undefined，
    // 由 ensureMarket 按旧逻辑补基准，零迁移）
    slowDrawLastGameMs:
      typeof marketRaw.slowDrawLastGameMs === 'number' && Number.isFinite(marketRaw.slowDrawLastGameMs)
        ? Math.max(0, Math.floor(marketRaw.slowDrawLastGameMs))
        : undefined,
  }

  // --- 我的挂单（v9）：非法字段丢弃 ---
  const orders: GameState['orders'] = []
  if (Array.isArray(src.orders)) {
    let fallbackId = 0
    for (const entry of src.orders) {
      if (typeof entry !== 'object' || entry === null) continue
      const o = entry as RawState
      const side = o.side
      if (side !== 'sell' && side !== 'buy') continue
      const qty = Math.floor(num(o.qty))
      if (qty <= 0) continue
      const id = Math.floor(num(o.id, fallbackId))
      fallbackId = Math.max(fallbackId, id)
      orders.push({
        id,
        side,
        good: typeof o.good === 'string' && o.good.length > 0 ? o.good : '',
        price: Math.max(1, Math.floor(num(o.price))),
        qty,
        filled: Math.max(0, Math.floor(num(o.filled))),
        placedAtGameMs: Math.max(0, Math.floor(num(o.placedAtGameMs))),
        // 站内让利吸收结余（2026-09-08 起可选字段；旧档缺省 0 = 重新累计）
        absorbCredit: Math.max(0, num(o.absorbCredit)),
        // 买单预扣（2026-09-11 起可选字段；缺省 0 = 改动前挂的遗留单，按"成交时扣钱"旧口径）
        escrowIsk: Math.max(0, Math.floor(num(o.escrowIsk))),
      })
    }
  }

  // --- escrow（v9） ---
  const escrowItems: Record<string, number> = {}
  for (const [key, value] of Object.entries(asRaw(src.escrowItems))) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) escrowItems[key] = Math.floor(value)
  }
  const escrowShips: Record<
    number,
    { shipId: string; defId: string; durability: number; customName: string | null; from?: 'fleet' | 'store' }
  > = {}
  for (const [key, value] of Object.entries(asRaw(src.escrowShips))) {
    const id = Number(key)
    const s = asRaw(value)
    const shipId = typeof s.shipId === 'string' && s.shipId.length > 0 ? s.shipId : ''
    if (!Number.isInteger(id) || id <= 0 || !shipId) continue
    escrowShips[id] = {
      shipId,
      defId: typeof s.defId === 'string' && s.defId.length > 0 ? s.defId : uidDefId(shipId),
      durability: Math.min(1, Math.max(0, num(s.durability, 1))),
      customName: cleanCustomName(s.customName),
      // 2026-09-14：只认显式的 'store'；老档缺省/非法值 = 舰队实例（撤单退回机库）
      ...(s.from === 'store' ? { from: 'store' as const } : {}),
    }
  }

    // --- 制造作业线表（v21 多工位；兼容 v20 及更早单例 manufacturing 兜底） ---
  const manufacturingRuns: GameState['manufacturingRuns'] = []
  let manufacturingSeq = 1
  /**
   * 老档「逐线连续生产」归并暂存（2026-09-10 船长定：开关/目标件数上移到卡片级）。
   * 归并口径（船长逐条确认）：on = 任一条线为真；produced = 各线之和；
   * goal = 各线目标之和，但**只要有任一条线是「无目标」→ 卡片也无目标**（跑到材料不足）。
   */
  const legacyLoops: Record<string, { produced: number; goalSum: number; openEnded: boolean }> = {}
  const sanitizeMfRun = (rawRun: unknown): GameState['manufacturingRuns'][number] | null => {
    const r = asRaw(rawRun)
    const bp = typeof r.blueprintId === 'string' && r.blueprintId.length > 0 ? r.blueprintId : null
    if (r.active !== true || bp === null) return null
    // 劳动者（卷B3 修复 2026-09-08：worker 必须随档保留——缺省会丢 AI 核心占用与劳动者语义）
    const worker =
      r.worker === 'pilot' || r.worker === 'basic' || r.worker === 'gamma' || r.worker === 'beta' || r.worker === 'alpha'
        ? r.worker
        : undefined // 缺省 = 劳动者制前的旧作业豁免（不占核心/名额，跑到自然完成）
    return {
      active: true,
      id: -1,
      blueprintId: bp,
      worker,
      finishAtGameMs: Math.max(0, Math.floor(num(r.finishAtGameMs))),
      durationMs: Math.max(0, Math.floor(num(r.durationMs))),
      /**
       * ⚠ **"这一线扣过一本一次性书"必须随档**（**2026-09-24 玩家报障**修复）：
       * 取消/停机时的退书判据就是它（见 `manufacturing.cancelManufacturing`），丢掉 ⇒ 存档往返之后
       * **取消静默不退书**（玩家眼里就是"图纸白没了"）。老档缺这个字段 ⇒ 不写（与改动前一致）。
       */
      ...(r.bookSpent === true ? { bookSpent: true } : {}),
      /**
       * ⚠ **这一线实际扣掉的材料也要随档**（**2026-09-24 船长令**：自动停机材料一起退）：
       * 停机那条路没有 ctx，退料只能靠这本账；丢掉它 ⇒ 存档往返后**停机退不了料**
       * （与 `bookSpent` 同一类坑，同一批修）。老档缺 ⇒ 不写（与改动前一致，取消时按蓝图现算兜底）。
       */
      ...(Array.isArray(r.spentMaterials)
        ? {
            spentMaterials: (r.spentMaterials as unknown[])
              .map((x) => ({ itemId: String(asRaw(x).itemId ?? ''), count: Math.max(0, Math.floor(num(asRaw(x).count))) }))
              .filter((x) => x.itemId.length > 0 && x.count > 0),
          }
        : {}),
      // 逐线连续生产字段（autoRepeat/repeatGoal/produced）**不再写入**：2026-09-10 船长定，
      // 循环制造上移到卡片级；老档里这三位在下面统一归并进 manufacturingLoops（见 legacyLoops）
    }
  }
  let pilotSeen = false // 主控亲自制造全局限 1 条（引擎保证；防御读档里出现重复）
  const pushMf = (rawRun: unknown): void => {
    const raw = asRaw(rawRun)
    const run = sanitizeMfRun(rawRun)
    if (!run) {
      // 结构性坏条丢弃 → 归还其已出库的 AI 核心（防"消失的 AI 依旧占用"）
      const w = raw.worker
      if (w === 'basic' || w === 'gamma' || w === 'beta' || w === 'alpha') aiCores[w] = (aiCores[w] ?? 0) + 1
      return
    }
    if (run.worker === 'pilot') {
      if (pilotSeen) return
      pilotSeen = true
    }
    // 卷B3 修复（2026-09-08 玩家反馈）：同一蓝图可开多条线 → 禁止按 blueprintId 去重
    run.id = manufacturingSeq
    manufacturingSeq += 1
    manufacturingRuns.push(run)
    // 老档逐线循环字段 → 暂存待归并（只认 autoRepeat=true 的线；新档不会有这些字段）
    if (raw.autoRepeat === true && run.blueprintId) {
      const cur = (legacyLoops[run.blueprintId] ??= { produced: 0, goalSum: 0, openEnded: false })
      cur.produced += Math.max(0, Math.floor(num(raw.produced)))
      const g = Math.floor(num(raw.repeatGoal))
      if (g > 0) cur.goalSum += g
      else cur.openEnded = true
    }
  }
  if (Array.isArray(src.manufacturingRuns)) { for (const rawRun of src.manufacturingRuns) pushMf(rawRun) }
  if (manufacturingRuns.length === 0 && src.manufacturing !== undefined) { pushMf(src.manufacturing) }
  if (typeof src.manufacturingSeq === 'number' && Number.isFinite(src.manufacturingSeq)) { manufacturingSeq = Math.max(manufacturingSeq, Math.floor(src.manufacturingSeq)) }
  // --- 组装机循环制造（卡片级；2026-09-10 船长定：开关/目标件数从逐线移到整卡）---
  // ① 新档字段直接读（存在时优先，避免与老档逐线字段重复计数）；② 老档逐线字段按上面的口径归并
  const manufacturingLoops: GameState['manufacturingLoops'] = {}
  for (const [bp, rawLoop] of Object.entries(asRaw(src.manufacturingLoops))) {
    if (typeof bp !== 'string' || bp.length === 0) continue
    const l = asRaw(rawLoop)
    const on = l.on === true
    const goal = Math.floor(num(l.goal))
    const produced = Math.max(0, Math.floor(num(l.produced)))
    const stopWhy = typeof l.stopWhy === 'string' && l.stopWhy.length > 0 ? l.stopWhy : ''
    if (!on && goal <= 0 && produced <= 0 && stopWhy.length === 0) continue // 空记录不留档
    manufacturingLoops[bp] = {
      on,
      ...(goal > 0 ? { goal } : {}),
      ...(produced > 0 ? { produced } : {}),
      ...(stopWhy.length > 0 ? { stopWhy } : {}),
    }
  }
  for (const [bp, leg] of Object.entries(legacyLoops)) {
    if (manufacturingLoops[bp] !== undefined) continue // 新字段优先（同档不会两者并存）
    const goal = leg.openEnded ? 0 : leg.goalSum
    manufacturingLoops[bp] = {
      on: true,
      ...(goal > 0 ? { goal } : {}),
      ...(leg.produced > 0 ? { produced: leg.produced } : {}),
    }
  }
// --- 势力声望（v4） ---
  const standings: Record<string, number> = {}
  const standingsRaw = asRaw(src.standings)
  for (const [key, value] of Object.entries(standingsRaw)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      standings[key] = Math.round(value)
    }
  }
  /**
   * --- **累计获得声望**（2026-09-26 船长令，兼容字段无版本号）---
   *
   * 两条账：`standings` = **可支配**（只有「章鱼人兑换」扣它）· `standingsEarned` = **累计获得**
   * （**全仓所有门槛读它**，只增不减）。
   *
   * 老档没有累计那一本 ⇒ **原样搬可支配那本（不补任何下界）**：今天之前没有消费点 ⇒
   * 老档的"可支配"就是它的"累计获得"，搬过来就是真值，玩家看到的数不会因为更新而变。
   *
   * ⚠ **2026-09-26 船长裁定（本条改过一次，别再改回去）**：本处原先写的是
   * `max(INITIAL_STANDING = 40, 旧声望)`，理由是"别让老玩家比新玩家少一档门槛"——船长否掉了：
   * 「**1算（初始 40 也算额外声望）…所以要清理，并且还要削减累计声望**」。
   * 那条下界正是玩家报障「更新后他原本 6 声望突然变成 41 声望」的根因（40 下界 ＋ 入侵贡献 1）。
   * 存量档里已经被抬起来的那部分，由 `expedition.repairStandingFromBountyProgress` 在读档后削减。
   *
   * ⚠ **不从日志回填**：`logs` 会被 `logCap` 裁剪、且读档不保证带（`serializeSaveFile` 的剥离注释），
   * 拿它当账本只会得到"有时多、有时少"的假数。只在 `src.standingsEarned` **缺失**时回填（幂等）。
   */
  const standingsEarned: Record<string, number> = {}
  const earnedRaw = asRaw(src.standingsEarned)
  for (const [key, value] of Object.entries(earnedRaw)) {
    if (typeof value === 'number' && Number.isFinite(value)) standingsEarned[key] = Math.round(value)
  }
  if (Object.keys(earnedRaw).length === 0) {
    // 逐势力原样搬一份（**不写死 `'dsi'`、也不补任何下界**）：老档此前没有消费点 ⇒ 两条账同值。
    // ⚠ 逐势力搬（而不是硬编码 dsi）还有一个作用：**空表进出对称** —— 新档 `standings = {}` 时
    //    回填结果也是 `{}`，存档往返用例（`save.test.ts` 的 `toEqual`）才不会被凭空多出的键打红。
    for (const [factionId, value] of Object.entries(standings)) standingsEarned[factionId] = value
  }
  /**
   * --- **见过黑匣没有**（2026-09-26 船长令，兼容字段无版本号）---
   *
   * 三态原样透传：`true` / `false` 照抄；**缺省（老档）不写键** ⇒ 由 `blackbox.blackboxSeenOf`
   * 在首次读取时按"仓库/任一舰队船的货仓里到底有没有黑匣"回填（那一处是唯一判据点）。
   */
  const blackboxSeen = src.blackboxSeen === true ? true : src.blackboxSeen === false ? false : undefined
  /**
   * --- **"按悬赏进度回正累计声望"走过没有**（2026-09-26 船长令，兼容字段无版本号）---
   *
   * 只认 `true`（**单程标记**）：走过一趟就带上它 ⇒ `expedition.repairStandingFromBountyProgress`
   * 此后直接返回、**永不再削**（船长：「**只生效一次，已经削过的玩家不再削**」）。
   * 缺省 / 非 `true` ⇒ 不落键（老档与"还没走过"等价）。
   */
  const standingClawbackDone = src.standingClawbackDone === true ? true : undefined
  /**
   * --- **入侵补偿批标记**（**船长 2026-10-02 令**，兼容字段无版本号）---
   *
   * 三格 = 判定结论（`track`）＋ 判定时刻 ＋ 两条路各自的落地时刻（幂等钥匙）。
   * 判据与落地见 `weekendCompensation.ts`（唯一判定与落地处）。
   *
   * ⚠ **两个"落地时刻"缺键必须是 `undefined`，绝不能读成 0**（同 `prizePaidAtWallMs` 那次的教训）：
   * 0 会被当成"已经发过/已经开过"⇒ 判成 `beacon` 的档永远不再发、判成 `makeup` 的档永远不开补场。
   * `track` 非法（缺键 / 不是这两个值）⇒ **整块不落键**（老档零迁移）。
   */
  const weekendCompensation = ((): GameState['weekendCompensation'] => {
    const raw = asRaw(src.weekendCompensation)
    const track = raw.track === 'makeup' ? 'makeup' : raw.track === 'beacon' ? 'beacon' : undefined
    if (track === undefined) return undefined
    const at = (v: unknown): number | undefined =>
      typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined
    const decidedAtWallMs = at(raw.decidedAtWallMs)
    if (decidedAtWallMs === undefined) return undefined
    const beaconGrantedAtWallMs = at(raw.beaconGrantedAtWallMs)
    const makeupServedAtWallMs = at(raw.makeupServedAtWallMs)
    const makeupSkippedAtWallMs = at(raw.makeupSkippedAtWallMs)
    return {
      track,
      decidedAtWallMs,
      ...(beaconGrantedAtWallMs !== undefined ? { beaconGrantedAtWallMs } : {}),
      ...(makeupServedAtWallMs !== undefined ? { makeupServedAtWallMs } : {}),
      ...(makeupSkippedAtWallMs !== undefined ? { makeupSkippedAtWallMs } : {}),
    }
  })()

  // --- 远征作业（V12 两阶段：out → battle → back；battle 状态只存动态量） ---
  const expRaw = asRaw(src.expedition)
  const expAnomalyId = typeof expRaw.anomalyId === 'string' && expRaw.anomalyId.length > 0 ? expRaw.anomalyId : null
  const expPhaseRaw = expRaw.phase
  const expPhase: 'out' | 'battle' | 'back' =
    expPhaseRaw === 'battle' || expPhaseRaw === 'back' ? expPhaseRaw : 'out'
  const expBattle: BattleState | null = expPhase === 'battle' ? cleanBattle(expRaw.battle) : null
  const expReturnReason: GameState['expedition']['returnReason'] =
    expPhase === 'back' &&
    (expRaw.returnReason === 'victory' || expRaw.returnReason === 'defeat' || expRaw.returnReason === 'retreat')
      ? expRaw.returnReason
      : undefined
  const expedition = {
    active: expRaw.active === true && expAnomalyId !== null,
    anomalyId: expAnomalyId,
    finishAtGameMs:
      typeof expRaw.finishAtGameMs === 'number' && Number.isFinite(expRaw.finishAtGameMs)
        ? Math.max(0, Math.floor(expRaw.finishAtGameMs))
        : 0,
    durationMs:
      typeof expRaw.durationMs === 'number' && Number.isFinite(expRaw.durationMs)
        ? Math.max(0, Math.floor(expRaw.durationMs))
        : 0,
    outMs:
      typeof expRaw.outMs === 'number' && Number.isFinite(expRaw.outMs)
        ? Math.max(0, Math.floor(expRaw.outMs))
        : 0,
    combatMs:
      typeof expRaw.combatMs === 'number' && Number.isFinite(expRaw.combatMs)
        ? Math.max(0, Math.floor(expRaw.combatMs))
        : 0,
    power:
      typeof expRaw.power === 'number' && Number.isFinite(expRaw.power) ? Math.max(0, Math.floor(expRaw.power)) : 0,
    eventId: typeof expRaw.eventId === 'string' && expRaw.eventId.length > 0 ? expRaw.eventId : null,
    eventFired: expRaw.eventFired === true,
    phase: expPhase === 'battle' && expBattle === null ? 'out' : expPhase,
    battle: expBattle,
    // 2026-09-11 船长：目标距离**按星系独立保存**（老档的全局 desirePrefM 不再沿用，一律回落射程中段）。
    // 容错：键非空字符串、值为正有限数才收；全空则整字段省略（零迁移）。
    ...(() => {
      const raw = asRaw(expRaw.desirePrefByGalaxy)
      const byGalaxy: Record<string, number> = {}
      for (const [gid, v] of Object.entries(raw)) {
        if (typeof gid !== 'string' || gid.length === 0) continue
        if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue
        byGalaxy[gid] = Math.round(v)
      }
      return Object.keys(byGalaxy).length > 0 ? { desirePrefByGalaxy: byGalaxy } : {}
    })(),
    // 2026-09-06 兼容字段：胜利自动返航（不可召回）/失利/撤退；仅 back 相位有效，其余清空
    returnReason: expReturnReason,
    /**
     * **本场远征打的是哪个星系**（2026-09-25 周末入侵接线）：
     * ⚠ 这一行原先**漏了**（只写了 `state.ts` 的类型与写入点）⇒ **读档即丢**，"战后归属/残骸注入不再落母港"
     * 只在同一次会话里成立、一读档就退回老口径（本轮补上；同批还补了 `rewardIskOverride`）。
     * 按约定 §二：随档字段必须**两处落笔**（写入点 ＋ 清洗器）。
     */
    ...(typeof expRaw.foeGalaxyId === 'string' && expRaw.foeGalaxyId.length > 0
      ? { foeGalaxyId: expRaw.foeGalaxyId }
      : {}),
    /** **奖励基底覆写**（2026-09-25 · 主动出击每场重抽的价钱口径）：非负有限数才收，其余省略 */
    ...(typeof expRaw.rewardIskOverride === 'number' &&
    Number.isFinite(expRaw.rewardIskOverride) &&
    expRaw.rewardIskOverride >= 0
      ? { rewardIskOverride: Math.round(expRaw.rewardIskOverride) }
      : {}),
    /** **本趟返航的跃迁燃料倍率**（2026-09-29 跃迁燃料批）：>1 才收 —— 丢了它，已扣料的那一趟会变回原速 */
    ...(fuelMulOf(expRaw.fuelMul) !== undefined ? { fuelMul: fuelMulOf(expRaw.fuelMul)! } : {}),
  }

  // --- 日志（逐条容错，超上限截掉最旧的） ---
  const logs: LogEntry[] = []
  const logsRaw = src.logs
  if (Array.isArray(logsRaw)) {
    let fallbackId = 0
    for (const entry of logsRaw) {
      if (typeof entry !== 'object' || entry === null) continue
      const e = entry as RawState
      const kind = typeof e.kind === 'string' && LOG_KINDS.has(e.kind) ? (e.kind as LogKind) : 'info'
      /**
       * 甲案（2026-09-20）：`textId` / `textParams` **逐条容错读入**——坏值一律当"没有"，
       * 界面于是回退显示 `text`（老档与本轮之前写下的日志都是这条路）。
       */
      const textId = typeof e.textId === 'string' && e.textId !== '' ? e.textId : undefined
      const paramsRaw = asRaw(e.textParams)
      const textParams: Record<string, string | number> = {}
      for (const [k, v] of Object.entries(paramsRaw)) {
        if (typeof v === 'string' || typeof v === 'number') textParams[k] = v
      }
      logs.push({
        id: typeof e.id === 'number' && Number.isFinite(e.id) ? Math.floor(e.id) : ++fallbackId,
        atGameMs:
          typeof e.atGameMs === 'number' && Number.isFinite(e.atGameMs) ? Math.floor(e.atGameMs) : 0,
        kind,
        text: typeof e.text === 'string' ? e.text : '',
        ...(textId !== undefined ? { textId } : {}),
        ...(textId !== undefined && Object.keys(textParams).length > 0 ? { textParams } : {}),
      })
    }
  }
  if (logs.length > logCap) logs.splice(0, logs.length - logCap)

  // --- 随机数 ---
  const rngRaw = asRaw(src.rng)
  const rng = {
    seed:
      typeof rngRaw.seed === 'number' && Number.isFinite(rngRaw.seed) ? Math.floor(rngRaw.seed) : FALLBACK_RNG_SEED,
    count:
      typeof rngRaw.count === 'number' && Number.isFinite(rngRaw.count)
        ? Math.max(0, Math.floor(rngRaw.count))
        : 0,
    /**
     * 货柜拆解计数（2026-09-22 船长令，见 `RngState.box`）：**可选字段 ⇒ 老档不带它就不写回**
     * （保持"存档往返逐字节一致"这条老契约；消费侧一律 `?? 0`）。
     */
    ...(typeof rngRaw.box === 'number' && Number.isFinite(rngRaw.box)
      ? { box: Math.max(0, Math.floor(rngRaw.box)) }
      : {}),
  }

  // --- 随机事件（v11）：nextAt = 0 表示未播种（首次推进时引擎初始化） ---
  const eventsRaw = asRaw(src.events)
  const events = {
    nextAtGameMs:
      typeof eventsRaw.nextAtGameMs === 'number' && Number.isFinite(eventsRaw.nextAtGameMs)
        ? Math.max(0, Math.floor(eventsRaw.nextAtGameMs))
        : 0,
  }

  // --- 星图探索（v13）：已探索星系集（母港永远在内，去重保序） ---
  const exploredSet = new Set<string>([HOME_GALAXY_ID])
  const exploredRaw = src.exploredGalaxies
  if (Array.isArray(exploredRaw)) {
    for (const id of exploredRaw) {
      if (typeof id === 'string' && id.length > 0) exploredSet.add(id)
    }
  }
  const exploredGalaxies = [...exploredSet]

  // --- 星系扫描作业（v13；T8：加出发星系 originGalaxy；2026-09-15：无人化 ⇒ 无返航段 + 两个"待查看"字段） ---
  const scanRaw = asRaw(src.scanning)
  const scanGalaxyId = typeof scanRaw.galaxyId === 'string' && scanRaw.galaxyId.length > 0 ? scanRaw.galaxyId : null
  /**
   * **老档一次性收口"自动返航段"**（船长 2026-09-15：星系扫描改成派无人扫描艇 ⇒ 不再有返航段）。
   * 老档若正处在返航段（`returning === true`），其窗口完成时**星系早已点亮**（`finishScan` 先落地、
   * 再去返航）⇒ 直接按"已收尾"读入：情报不丢、舰船位置不动（收口前那套"到港停靠 + 自动卸货"作废）。
   * 收口时补一个"待查看"高亮位，让玩家进星图看一眼——否则这次扫描完成得无声无息。
   */
  const legacyScanReturning = scanRaw.returning === true
  const scanActive = scanRaw.active === true && scanGalaxyId !== null && !legacyScanReturning
  const lastGalaxyId =
    typeof scanRaw.lastGalaxyId === 'string' && scanRaw.lastGalaxyId.length > 0 ? scanRaw.lastGalaxyId : null
  const scanning = {
    active: scanActive,
    galaxyId: scanActive ? scanGalaxyId : null,
    finishAtGameMs: scanActive
      ? typeof scanRaw.finishAtGameMs === 'number' && Number.isFinite(scanRaw.finishAtGameMs)
        ? Math.max(0, Math.floor(scanRaw.finishAtGameMs))
        : 0
      : 0,
    startedAtGameMs: scanActive
      ? typeof scanRaw.startedAtGameMs === 'number' && Number.isFinite(scanRaw.startedAtGameMs)
        ? Math.max(0, Math.floor(scanRaw.startedAtGameMs))
        : 0
      : 0,
    originGalaxy:
      typeof scanRaw.originGalaxy === 'string' && scanRaw.originGalaxy.length > 0 ? scanRaw.originGalaxy : null,
    // 2026-09-06 兼容字段：**2026-09-15 起返航段取消** ⇒ 读档一律归 false（老档返航段见上：一次性收口）
    returning: false,
    // 待查看高亮位（老档返航段收口时补亮）
    awaitingView: scanRaw.awaitingView === true || legacyScanReturning,
    lastGalaxyId: lastGalaxyId ?? (legacyScanReturning ? scanGalaxyId : null),
  }

  // --- T8 野外停留 / 返航行程 / 悬赏冷却 / 重复清剿（v16.1 兼容字段） ---
  const awayGalaxy =
    typeof src.awayGalaxy === 'string' && src.awayGalaxy.length > 0 ? src.awayGalaxy : null
  const transitRaw = asRaw(src.transit)
  const transitFrom =
    typeof transitRaw.fromGalaxy === 'string' && transitRaw.fromGalaxy.length > 0 ? transitRaw.fromGalaxy : null
  const transitTo =
    typeof transitRaw.toGalaxy === 'string' && transitRaw.toGalaxy.length > 0 ? transitRaw.toGalaxy : null
  const transit = {
    active: transitRaw.active === true && transitTo !== null,
    fromGalaxy: transitFrom,
    toGalaxy: transitTo,
    finishAtGameMs:
      typeof transitRaw.finishAtGameMs === 'number' && Number.isFinite(transitRaw.finishAtGameMs)
        ? Math.max(0, Math.floor(transitRaw.finishAtGameMs))
        : 0,
    legMs:
      typeof transitRaw.legMs === 'number' && Number.isFinite(transitRaw.legMs)
        ? Math.max(0, Math.floor(transitRaw.legMs))
        : 0,
    // 2026-09-08 建站交付航线（可选字段：siteId 合法且 phase 合规才启用，旧档回退 null；
    // v2 起 to-site 腿携带本趟装载明细 loaded，供到点"只清货仓"交付）
    delivery: (() => {
      const deliveryRaw = asRaw(transitRaw.active === true ? transitRaw.delivery : undefined)
      if (
        !(
          transitRaw.active === true &&
          typeof deliveryRaw.siteId === 'string' &&
          deliveryRaw.siteId.length > 0 &&
          (deliveryRaw.phase === 'to-site' || deliveryRaw.phase === 'to-station')
        )
      ) {
        return null
      }
      let loaded: Record<string, number> | undefined
      const loadedRaw = asRaw(deliveryRaw.loaded)
      const loadedEntries = Object.entries(loadedRaw)
      if (loadedEntries.length > 0) {
        const out: Record<string, number> = {}
        for (const [k, v] of loadedEntries) {
          if (k.length === 0) continue
          const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 0
          if (n > 0) out[k] = n
        }
        if (Object.keys(out).length > 0) loaded = out
      }
      return {
        siteId: deliveryRaw.siteId,
        phase: deliveryRaw.phase as 'to-site' | 'to-station',
        ...(loaded !== undefined ? { loaded } : {}),
      }
    })(),
  }
  // --- B1.5 主控待命行程（v17.1 兼容字段）：active 且目标合法才启用 ---
  const stbRaw = asRaw(src.standby)
  const stbGalaxy = typeof stbRaw.galaxyId === 'string' && stbRaw.galaxyId.length > 0 ? stbRaw.galaxyId : null
  const standby = {
    active: stbRaw.active === true && stbGalaxy !== null,
    galaxyId: stbGalaxy,
    finishAtGameMs: Math.max(0, Math.floor(num(stbRaw.finishAtGameMs))),
    legMs: Math.max(0, Math.floor(num(stbRaw.legMs))),
  }
  // --- 长途运输（2026-09-09 两站运输：可选字段、旧档零迁移；active 需目标端点字段可读） ---
  const haulRaw = asRaw(src.hauling)
  const haulTo = typeof haulRaw.toSiteId === 'string' || haulRaw.toSiteId === null ? haulRaw.toSiteId : null
  const haulFrom = typeof haulRaw.fromSiteId === 'string' || haulRaw.fromSiteId === null ? haulRaw.fromSiteId : null
  const haulA = typeof haulRaw.routeA === 'string' || haulRaw.routeA === null ? haulRaw.routeA : null
  const haulB = typeof haulRaw.routeB === 'string' || haulRaw.routeB === null ? haulRaw.routeB : null
  const hauling = {
    active: haulRaw.active === true && haulTo !== undefined,
    routeA: haulA ?? null,
    routeB: haulB ?? null,
    fromSiteId: haulFrom ?? null,
    toSiteId: haulTo ?? null,
    legMinutes: Math.max(0, Math.floor(num(haulRaw.legMinutes))),
    legMs: Math.max(0, Math.floor(num(haulRaw.legMs))),
    phaseAccMs: Math.max(0, Math.floor(num(haulRaw.phaseAccMs))),
    // 本趟行情倍率（2026-09-11：每趟掷一次 5~10 倍、两段同价）——必须随档保留，
    // 否则重载会丢本趟价（旧档缺字段 → 0 / 0，结算按区间下限兜底、下一段起重新掷）
    tripMul: Math.max(0, num(haulRaw.tripMul)),
    tripLegsLeft: Math.max(0, Math.floor(num(haulRaw.tripLegsLeft))),
  }
  // --- 精炼炉运转工位表（v20 多工位并行、原料不锁定；兼容 v19 起 refineRuns 与更早 refineRun 兜底） ---
  const sanitizeRefineRun = (rawRun: unknown): GameState['refineRuns'][number] | null => {
    const r = asRaw(rawRun)
    const item = typeof r.itemId === 'string' && r.itemId.length > 0 ? r.itemId : null
    if (r.active !== true || item === null) return null
    const worker: GameState['refineRuns'][number]['worker'] =
      r.worker === 'basic' || r.worker === 'gamma' || r.worker === 'beta' || r.worker === 'alpha'
        ? r.worker
        : 'pilot'
    // 回收所得累计（可选兼容字段：只保留正数，非 recycle 丢弃）
    const recRaw = asRaw(r.recAcc)
    const numMap = (m: unknown): Record<string, number> => {
      const out: Record<string, number> = {}
      for (const [k, v] of Object.entries(asRaw(m))) {
        if (k.length === 0) continue
        const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 0
        if (n > 0) out[k] = n
      }
      return out
    }
    const recAcc =
      r.recipe === 'recycle' &&
      (Object.keys(recRaw).length > 0 ||
        Object.keys(numMap(recRaw.min)).length > 0 ||
        Object.keys(numMap(recRaw.mod)).length > 0 ||
        Object.keys(numMap(recRaw.frag)).length > 0 ||
        Object.keys(numMap(recRaw.drone)).length > 0 ||
        Object.keys(numMap(recRaw.blueprint)).length > 0)
        ? {
            min: numMap(recRaw.min),
            mod: numMap(recRaw.mod),
            frag: numMap(recRaw.frag),
            drone: numMap(recRaw.drone), // 专属无人机架数（2026-09-10 增；老档缺省空表）
            blueprint: numMap(recRaw.blueprint), // 专属无人机一次性图纸张数（2026-09-14 增；老档缺省空表）
          }
        : undefined
    const runOut: GameState['refineRuns'][number] = {
      active: true,
      id: -1, // 占位：由调用方按 refineSeq 统一分配
      worker,
      // F4d：拆解安全货柜（'unbox'）与精炼/回收同一条产线机器，白名单一并收录
    recipe: r.recipe === 'recycle' ? 'recycle' : r.recipe === 'unbox' ? 'unbox' : 'refine',
      itemId: item,
      batchUnits: Math.max(1, Math.floor(num(r.batchUnits, 10))),
      cycleMs: Math.max(1, Math.floor(num(r.cycleMs, 6_000))),
      finishAtGameMs: Math.max(0, Math.floor(num(r.finishAtGameMs))),
      batchesDone: Math.max(0, Math.floor(num(r.batchesDone))),
    }
    if (recAcc) runOut.recAcc = recAcc
    // 本轮锁量（2026-09-10 增：稀有残骸每炉锁死 1 件）：**0 也要保留**（见下方私有料账条）；
    // 老档/普通炉缺省 = 不限制（天然如此）
    const lockRaw = num(r.lockUnits, NaN)
    if (Number.isFinite(lockRaw) && lockRaw >= 0) runOut.lockUnits = Math.floor(lockRaw)
    // 私有料账（2026-09-11 增：稀有残骸"起炉即预占"，停炉退还未用完部分）——**必须保留**，
    // 否则读档后这批预占的残骸既不在公共库存、也不在料账里 = 凭空消失。
    // 2026-09-11 修（玩家反馈「稀有残骸空了精炼炉还在运转」）：**归零的料账同样要保留**——
    // 「字段在不在」本身就是语义：有字段 = 这台炉吃自己的私有料账，字段缺失 = 老档/普通料吃公共库存。
    // 原先只收正数 ⇒ 料账恰好归零的那一刻存档（最后一批刚结算完、炉子尚未收工），读档后字段被丢掉，
    // 这台炉会转而去吃**货仓/仓库里的同类残骸**（若玩家刚打捞回新的一件，就被这台旧炉默默烧掉）。
    const claimRaw = num(r.claimedUnits, NaN)
    if (Number.isFinite(claimRaw) && claimRaw >= 0) runOut.claimedUnits = Math.floor(claimRaw)
    // 开箱资格（2026-09-11 增：起炉时"未开箱存量 ≥ 一件"的判定结果）——**同样必须保留**：
    // 缺字段 = "老档/未判定"（按可开箱处理），而 `false` 是**明确的结论**（这批料已经开过箱、不再产箱）。
    // 原先根本没落盘 ⇒ 用"已开箱的余料"起炉的炉子，只要在第一批到点前存档重开，"不许开箱"这个结论就丢了，
    // 第一批照旧开箱（"一件 = 一箱"被存档往返绕开）。
    if (r.rareBoxEligible === true || r.rareBoxEligible === false) runOut.rareBoxEligible = r.rareBoxEligible
    return runOut
  }
  const refineRuns: GameState['refineRuns'] = []
  let refineSeq = 1
  const pushSanitized = (rawRun: unknown): void => {
    const run = sanitizeRefineRun(rawRun)
    if (!run) return
    // v20 守护：pilot 至多一台（同资源多台为合法状态，不再过滤重复 itemId）
    if (run.worker === 'pilot' && refineRuns.some((x) => x.worker === 'pilot')) return
    run.id = refineSeq
    refineSeq += 1
    refineRuns.push(run)
  }
  if (Array.isArray(src.refineRuns)) {
    for (const rawRun of src.refineRuns) pushSanitized(rawRun)
  }
  if (refineRuns.length === 0 && src.refineRun !== undefined) {
    // v18 及更早老档兜底（正常路径已由迁移链转换，此处双保险）
    pushSanitized(src.refineRun)
  }
  if (typeof src.refineSeq === 'number' && Number.isFinite(src.refineSeq)) {
    refineSeq = Math.max(refineSeq, Math.floor(src.refineSeq))
  }
  const bountyCooldowns: Record<string, number> = {}
  const bcRaw = asRaw(src.bountyCooldowns)
  for (const [key, value] of Object.entries(bcRaw)) {
    if (key.length === 0) continue
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      bountyCooldowns[key] = Math.floor(value)
    }
  }
  const autoLoopAnomalyId =
    typeof src.autoLoopAnomalyId === 'string' && src.autoLoopAnomalyId.length > 0
      ? src.autoLoopAnomalyId
      : null
  /**
   * **切活动停机标记**（**2026-10-02 加**，见 `GameState.haltedBySwitch` 头注）——
   * 它是一条**瞬态信号**（`haltActivityForSwitch` 抛给"紧接着那次开工"看的，活不过同一拍）
   * ⇒ **有意不入档**，读档一律清空（老档缺省也走这条）。字段可选、值恒为 `null` ⇒ 往返一致。
   */
  const pendingActivityReturn: { kind: 'mining' | 'salvaging'; id: string } | null =
    (asRaw(src.pendingActivityReturn).kind === 'mining' || asRaw(src.pendingActivityReturn).kind === 'salvaging') &&
    typeof asRaw(src.pendingActivityReturn).id === 'string' &&
    (asRaw(src.pendingActivityReturn).id as string).length > 0
      ? {
          kind: asRaw(src.pendingActivityReturn).kind as 'mining' | 'salvaging',
          id: asRaw(src.pendingActivityReturn).id as string,
        }
      : null
  const haltedBySwitch: { kind: 'mining' | 'salvaging' } | null =
    asRaw(src.haltedBySwitch).kind === 'mining'
      ? { kind: 'mining' }
      : asRaw(src.haltedBySwitch).kind === 'salvaging'
        ? { kind: 'salvaging' }
        : null
  /** 再开机群前置（2026-09-18）：非负整数才算；缺省/坏值 ⇒ null（= 不套这条判定） */
  const autoLoopDroneFloor =
    typeof src.autoLoopDroneFloor === 'number' &&
    Number.isFinite(src.autoLoopDroneFloor) &&
    src.autoLoopDroneFloor >= 0
      ? Math.floor(src.autoLoopDroneFloor)
      : null

  // --- B3 打捞作业（2026-09-05 兼容字段 + 2026-09-09 自动循环偏好零迁移）：active + 合法星系才启用，否则空态；
  // autoCycle 缺省按开（!= false），stopAfterTrip 缺省关——与采矿读档口径一致 ---
  const slvRaw = asRaw(src.salvaging)
  const slvGalaxy = typeof slvRaw.galaxyId === 'string' && slvRaw.galaxyId.length > 0 ? slvRaw.galaxyId : null
  const salvaging: GameState['salvaging'] =
    slvRaw.active === true && slvGalaxy !== null
      ? {
          active: true,
          galaxyId: slvGalaxy,
          phase: slvRaw.phase === 'outbound' || slvRaw.phase === 'returning' ? slvRaw.phase : 'salvaging',
          phaseAccMs: Math.max(0, Math.floor(num(slvRaw.phaseAccMs))),
          cycleAccMs: Math.max(0, Math.floor(num(slvRaw.cycleAccMs))),
          tripM3: Math.max(0, num(slvRaw.tripM3) || 0),
          deviceAccMs: {}, // 相位账读档重建（以最短周期为步的推进自然重建）
          autoCycle: slvRaw.autoCycle !== false,
          stopAfterTrip: slvRaw.stopAfterTrip === true,
          // **打捞对象**（2026-09-26 船长令）：非空串才收（合法性由开工/换对象那一层把关）
          ...(typeof slvRaw.targetGroup === 'string' && slvRaw.targetGroup.length > 0
            ? { targetGroup: slvRaw.targetGroup }
            : {}),
          ...(fuelMulOf(slvRaw.fuelMul) !== undefined ? { fuelMul: fuelMulOf(slvRaw.fuelMul)! } : {}),
        }
      : {
          active: false,
          galaxyId: null,
          phase: 'salvaging',
          phaseAccMs: 0,
          cycleAccMs: 0,
          tripM3: 0,
          deviceAccMs: {},
          autoCycle: true,
          stopAfterTrip: false,
        }

  // --- B3 星系残骸密度（2026-09-05 兼容字段无版本号）：合法记录保留（密度 ≥0、稀有计数取整）；
  // 非法/缺省 = 无记录（运行时按基础密度推导，不入档） ---
  const galaxyWrecks: NonNullable<GameState['galaxyWrecks']> = {}
  const gwRaw = asRaw(src.galaxyWrecks)
  for (const [galaxyId, gw] of Object.entries(gwRaw)) {
    if (galaxyId.length === 0 || typeof gw !== 'object' || gw === null) continue
    const g = asRaw(gw)
    const density = g.density
    const rare = g.rare
    if (typeof density !== 'number' || !Number.isFinite(density) || density < 0) continue
    // 稀有残骸按敌群记账（2026-09-10 兼容字段）：只收正整数的敌群计数（白名单重建，防字段被丢）
    const rareByRaw = asRaw(g.rareBy)
    const rareBy: Record<string, number> = {}
    for (const [anomalyId, n] of Object.entries(rareByRaw)) {
      if (anomalyId.length === 0) continue
      if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) continue
      rareBy[anomalyId] = Math.floor(n)
    }
    /**
     * **分组份额账**（2026-09-26 船长令「残骸也要分开算」）——只收"非空串键 ＋ 正有限数"：
     * 脏值整条丢（与 `rareBy` 同款口径）；缺字段 = 老档 ⇒ 首次读到时按常驻悬赏卡均分惰性补齐。
     */
    const byGroupRaw = asRaw(g.byGroup)
    const byGroup: Record<string, number> = {}
    for (const [groupKey, v] of Object.entries(byGroupRaw)) {
      if (groupKey.length === 0) continue
      if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue
      byGroup[groupKey] = v
    }
    galaxyWrecks[galaxyId] = {
      density,
      rare: typeof rare === 'number' && Number.isFinite(rare) ? Math.max(0, Math.floor(rare)) : 0,
      ...(Object.keys(rareBy).length > 0 ? { rareBy } : {}),
      ...(Object.keys(byGroup).length > 0 ? { byGroup } : {}),
    }
  }

  /**
   * --- **入侵残骸（独立池）**（2026-09-25 兼容字段无版本号；船长「入侵残骸不算当地星系密度，
   *     因为是独立的。48 小时线性衰减」）：星系 id → `{ density, decayAccMs }`
   *     （锚点值 > 0、已漂移时长 ≥ 0 的有限数才收；两个字段缺一不可 ⇒ 脏档整条丢）。
   *     与 `galaxyWrecks` 各自独立、互不影响；缺字段 = 空表（老档天然如此）。 ---
   */
  const weekendWrecks: NonNullable<GameState['weekendWrecks']> = {}
  for (const [galaxyId, w] of Object.entries(asRaw(src.weekendWrecks))) {
    if (galaxyId.length === 0) continue
    const r = asRaw(w)
    const density = num(r.density)
    const accRaw = r.decayAccMs
    /**
     * ⚠ **2026-09-27 放宽**（船长令「主力舰队添加一个稀有残骸掉落」＋「进残骸场」）：
     * 原先要求 `density > 0`（两个字段缺一不可）⇒ 但**场里可能只剩箱子**（矿物被捞干、稀有还在）
     * ⇒ 那种记录必须留得住。现口径 = **密度 > 0 或 稀有 > 0** 之一成立即收（两者皆无才整条丢）。
     */
    const rare = Math.max(0, Math.floor(num(r.rare)))
    const rareBy = ((): Record<string, number> | undefined => {
      const out: Record<string, number> = {}
      for (const [cardId, v] of Object.entries(asRaw(r.rareBy))) {
        const n = Math.floor(num(v))
        if (cardId.length > 0 && Number.isFinite(n) && n > 0) out[cardId] = n
      }
      return Object.keys(out).length > 0 ? out : undefined
    })()
    const hasRare = rare > 0 || rareBy !== undefined
    if (typeof accRaw !== 'number' || !Number.isFinite(accRaw) || accRaw < 0) continue
    if ((!Number.isFinite(density) || density <= 0) && !hasRare) continue
    /** 来源族（2026-09-26 加 · 兼容字段）：只认单字母族码 A~H，其余不写 */
    const fam =
      typeof r.family === 'string' && /^[A-H]$/.test(r.family)
        ? (r.family as NonNullable<GameState['weekendWrecks']>[string]['family'])
        : undefined
    weekendWrecks[galaxyId] = {
      density: Number.isFinite(density) && density > 0 ? density : 0,
      decayAccMs: accRaw,
      ...(fam !== undefined ? { family: fam } : {}),
      ...(rare > 0 ? { rare } : {}),
      ...(rareBy !== undefined ? { rareBy } : {}),
    }
  }

  /**
   * --- **玩家舰船残骸**（2026-09-26 兼容字段无版本号，设计稿 `docs/design/ship-wreck-20260926.md`）：
   *     键 = 原舰船 id → 一具残骸（`name` / 装配与无人机快照 / 48h 衰减两栏）。
   *     **⭐ 漏登记就是"读档即丢"**（本文件头注那条老坑：每加一个随档字段得在两处都写）——
   *     残骸丢了不会报错，只在"刷新/重进"时表现为"我的残骸不见了"。
   *     只收形态合法的条目：名称与两栏衰减数缺一不可、装配快照逐位净化、无人机只收正整数。 ---
   */
  const shipWrecks: NonNullable<GameState['shipWrecks']> = {}
  for (const [shipId, wRaw] of Object.entries(asRaw(src.shipWrecks))) {
    if (shipId.length === 0) continue
    const r = asRaw(wRaw)
    const galaxyId = typeof r.galaxyId === 'string' ? r.galaxyId : ''
    const name = typeof r.name === 'string' ? r.name.trim().slice(0, 120) : ''
    const density = num(r.density)
    const accRaw = r.decayAccMs
    if (galaxyId.length === 0 || name.length === 0) continue
    if (typeof accRaw !== 'number' || !Number.isFinite(accRaw) || accRaw < 0) continue
    if (!Number.isFinite(density) || density <= 0) continue
    /** 装配快照：逐位净化（非空字符串留下、空位记 null、裁掉尾部空位；与 `fitPresets` 同一手法） */
    const wreckRack = (v: unknown): Array<string | null> => {
      if (!Array.isArray(v)) return []
      const out: Array<string | null> = []
      for (const x of v.slice(0, RACK_MAX)) out.push(typeof x === 'string' && x.length > 0 ? x : null)
      while (out.length > 0 && out[out.length - 1] === null) out.pop()
      return out
    }
    const fitRaw = asRaw(r.fitted)
    const fitted: FittedModules = {
      high: wreckRack(fitRaw.high),
      mid: wreckRack(fitRaw.mid),
      low: wreckRack(fitRaw.low),
    }
    const droneLoad: Record<string, number> = {}
    for (const [droneId, n] of Object.entries(asRaw(r.droneLoad))) {
      if (droneId.length === 0) continue
      if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) continue
      droneLoad[droneId] = Math.floor(n)
    }
    const defId = typeof r.defId === 'string' && r.defId.length > 0 ? r.defId : undefined
    const durability = typeof r.durability === 'number' && Number.isFinite(r.durability) ? r.durability : undefined
    const armorPct = typeof r.armorPct === 'number' && Number.isFinite(r.armorPct) ? r.armorPct : undefined
    const reinforceChance =
      typeof r.reinforceChance === 'number' && Number.isFinite(r.reinforceChance) && r.reinforceChance > 0
        ? r.reinforceChance
        : undefined
    // 插件（2026-09-26）：清完**空表不写键** ⇒ 老残骸往返后形状逐字一致（与 `plugs` 舰队侧同款）
    const wreckPlugs = cleanPlugIds(r.plugs)
    shipWrecks[shipId] = {
      seq: num(r.seq),
      galaxyId,
      shipId,
      name,
      ...(defId !== undefined ? { defId } : {}),
      fitted,
      ...(Object.keys(droneLoad).length > 0 ? { droneLoad } : {}),
      ...(wreckPlugs !== undefined ? { plugs: wreckPlugs } : {}),
      ...(durability !== undefined ? { durability } : {}),
      ...(armorPct !== undefined ? { armorPct } : {}),
      ...(reinforceChance !== undefined ? { reinforceChance } : {}),
      ...(r.hullRolled === true ? { hullRolled: true } : {}),
      ...(r.pityUsed === true ? { pityUsed: true } : {}),
      density,
      decayAccMs: accRaw,
      createdAtWallMs: num(r.createdAtWallMs),
    }
  }

  // --- 已开箱稀有残骸存量（2026-09-11 兼容字段无版本号）：键 = 残骸物品 id，值 = m³（只收正数） ---
  const rareOpenedUnits: Record<string, number> = {}
  for (const [itemId, n] of Object.entries(asRaw(src.rareOpenedUnits))) {
    if (itemId.length === 0) continue
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) continue
    rareOpenedUnits[itemId] = Math.floor(n)
  }
  // --- 稀有残骸的全局开箱账本（2026-09-11 船长定「每次少 30 立方，自动烧」；兼容字段无版本号）：
  //     允许箱数 = ⌊累计已烧体积 ÷ 30⌋ —— 两个账本都要落盘，否则读档会重置累计、
  //     让"停炉→存档→重开"绕过"一个回收单元 = 一箱"。只收正数，缺字段 = 空账（老档天然如此）。 ---
  const rareBoxesOpened: Record<string, number> = {}
  for (const [itemId, n] of Object.entries(asRaw(src.rareBoxesOpened))) {
    if (itemId.length === 0) continue
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) continue
    rareBoxesOpened[itemId] = Math.floor(n)
  }
  const rareBurnUnits: Record<string, number> = {}
  for (const [itemId, n] of Object.entries(asRaw(src.rareBurnUnits))) {
    if (itemId.length === 0) continue
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) continue
    rareBurnUnits[itemId] = Math.floor(n)
  }

  // --- B1 低安遭遇（v17.1 兼容字段）：未激活 = 标准空态（往返幂等）；激活才逐字段容错 ---
  const encRaw = asRaw(src.encounter)
  const encShipId = typeof encRaw.shipId === 'string' && encRaw.shipId.length > 0 ? encRaw.shipId : null
  const encGalaxy = typeof encRaw.galaxyId === 'string' && encRaw.galaxyId.length > 0 ? encRaw.galaxyId : null
  const encounter: GameState['encounter'] =
    encRaw.active === true && encShipId !== null && encGalaxy !== null
      ? {
          active: true,
          shipId: encShipId,
          galaxyId: encGalaxy,
          name: typeof encRaw.name === 'string' && encRaw.name.length > 0 ? encRaw.name : '巡逻队',
          threat: Math.max(1, Math.floor(num(encRaw.threat, 10))),
          anomalyId: typeof encRaw.anomalyId === 'string' && encRaw.anomalyId.length > 0 ? encRaw.anomalyId : null,
          origin: typeof encRaw.origin === 'string' ? encRaw.origin : '',
          invitedAtGameMs: Math.max(0, Math.floor(num(encRaw.invitedAtGameMs))),
          deadlineGameMs: Math.max(0, Math.floor(num(encRaw.deadlineGameMs))),
          battle: cleanBattle(encRaw.battle),
        }
      : {
          active: false,
          shipId: null,
          galaxyId: null,
          name: '',
          threat: 0,
          anomalyId: null,
          origin: '',
          invitedAtGameMs: 0,
          deadlineGameMs: 0,
          battle: null,
        }
  const lowSecNotified = src.lowSecNotified === true
  const lowSecPresence: Record<string, number> = {} // 运行时在场计时：读档后由 advanceEncounterWatch 重建
  const encounterZoneCooldown: Record<string, number> = {}
  for (const [key, value] of Object.entries(asRaw(src.encounterZoneCooldown))) {
    if (key.length === 0) continue
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      encounterZoneCooldown[key] = Math.floor(value)
    }
  }

  // --- T9 建站进度（v16.1）：stage 0..3，delivered 只收正数 ---
  const stationSites: Record<string, { stage: number; delivered: Record<string, number> }> = {}
  const sitesRaw = asRaw(src.stationSites)
  for (const [siteId, siteRaw] of Object.entries(sitesRaw)) {
    if (siteId.length === 0 || typeof siteRaw !== 'object' || siteRaw === null) continue
    const s = asRaw(siteRaw)
    const stageRaw = s.stage
    const stage = typeof stageRaw === 'number' && Number.isFinite(stageRaw) ? Math.min(3, Math.max(0, Math.floor(stageRaw))) : 0
    const delivered: Record<string, number> = {}
    const delRaw = asRaw(s.delivered)
    for (const [itemId, value] of Object.entries(delRaw)) {
      if (itemId.length === 0) continue
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) delivered[itemId] = Math.floor(value)
    }
    stationSites[siteId] = { stage, delivered }
  }
  const dockedSite =
    typeof src.dockedSite === 'string' && src.dockedSite.length > 0 ? src.dockedSite : null
  const dialogueSeen: Record<string, boolean> = {}
  const seenRaw = asRaw(src.dialogueSeen)
  for (const [key, value] of Object.entries(seenRaw)) {
    if (value === true) dialogueSeen[key] = true
  }
  const pendingDialogue =
    typeof src.pendingDialogue === 'string' && src.pendingDialogue.length > 0 ? src.pendingDialogue : null
  // --- 通讯收件箱（2026-09-11）：送达记账 + 已读（两字段都可选；老档读入 = 空收件箱，零迁移） ---
  // 送达时间钳到 ≥0 的整数（负数/非数值一律丢弃 ⇒ 视作"未送达"，下次推进按触发条件补送）。
  const commsDelivered: Record<string, number> = {}
  for (const [key, value] of Object.entries(asRaw(src.commsDelivered))) {
    if (key.length === 0) continue
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue
    commsDelivered[key] = Math.floor(value)
  }
  const commsRead: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(asRaw(src.commsRead))) {
    if (key.length === 0) continue
    if (value === true) commsRead[key] = true
  }
  /**
   * **实例通讯**（2026-09-25 · 周末入侵两封）：条目本身就是"要显示的东西"，故按"结构对得上就原样留"清洗——
   * 缺 id / 缺主题或正文 / 段落不是字符串数组一律丢（宁可这封信没有，也不给界面喂半条）。
   * 参数与奖励清单只做浅层校验（值必须是 string|number），坏项丢掉不影响其余。
   */
  /**
   * **沉船记录**（2026-09-27 船长令）：最多 `WRECK_LOG_MAX` 条、新的在前。
   * 只收形态合法的条目：船 id 与船名非空、原因枚举合法、时间有限；装配/插件/无人机逐位净化
   * （与 `shipWrecks` 同手法）。
   * ⚠ **漏登记就是"读档即丢"**（本文件头注那条老坑）⇒ 收发两处都要写。
   */
  const wreckLogCleanRack = (v: unknown): Array<string | null> => {
    if (!Array.isArray(v)) return []
    const out: Array<string | null> = []
    for (const x of v.slice(0, RACK_MAX)) out.push(typeof x === 'string' && x.length > 0 ? x : null)
    while (out.length > 0 && out[out.length - 1] === null) out.pop()
    return out
  }
  const wreckLog: NonNullable<GameState['wreckLog']> = []
  for (const raw of Array.isArray(src.wreckLog) ? src.wreckLog : []) {
    if (wreckLog.length >= WRECK_LOG_MAX) break
    const r = asRaw(raw)
    const shipId = typeof r.shipId === 'string' ? r.shipId : ''
    const shipName = typeof r.shipName === 'string' ? r.shipName.trim().slice(0, 120) : ''
    const cause = r.cause
    if (shipId.length === 0 || shipName.length === 0) continue
    if (
      cause !== 'expedition-lost' &&
      cause !== 'ai-lost' &&
      cause !== 'wormhole-sunk' &&
      cause !== 'wormhole-lost' &&
      // 2026-09-28 加：遭遇战（含旗舰战）里被击沉 —— 不认它 ⇒ 读档即丢那几条沉船记录
      cause !== 'encounter-lost'
    ) {
      continue
    }
    const atGameMs = num(r.atGameMs)
    if (!Number.isFinite(atGameMs) || atGameMs < 0) continue
    const fitRaw = asRaw(r.fitted)
    const fitted: FittedModules = {
      high: wreckLogCleanRack(fitRaw.high),
      mid: wreckLogCleanRack(fitRaw.mid),
      low: wreckLogCleanRack(fitRaw.low),
    }
    const droneLoad: Record<string, number> = {}
    for (const [droneId, n] of Object.entries(asRaw(r.droneLoad))) {
      if (droneId.length === 0) continue
      if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) continue
      droneLoad[droneId] = Math.floor(n)
    }
    const defId = typeof r.defId === 'string' && r.defId.length > 0 ? r.defId : undefined
    const galaxyId = typeof r.galaxyId === 'string' && r.galaxyId.length > 0 ? r.galaxyId : undefined
    const depthRaw = r.wormholeDepth
    const wormholeDepth =
      typeof depthRaw === 'number' && Number.isFinite(depthRaw) && depthRaw >= 1 ? Math.floor(depthRaw) : undefined
    const wreckGalaxyId = typeof r.wreckGalaxyId === 'string' && r.wreckGalaxyId.length > 0 ? r.wreckGalaxyId : undefined
    const logPlugs = cleanPlugIds(r.plugs)
    wreckLog.push({
      seq: num(r.seq),
      shipId,
      shipName,
      ...(defId !== undefined ? { defId } : {}),
      cause,
      ...(galaxyId !== undefined ? { galaxyId } : {}),
      ...(wormholeDepth !== undefined ? { wormholeDepth } : {}),
      atGameMs,
      fitted,
      ...(logPlugs !== undefined ? { plugs: logPlugs } : {}),
      ...(Object.keys(droneLoad).length > 0 ? { droneLoad } : {}),
      ...(wreckGalaxyId !== undefined ? { wreckGalaxyId } : {}),
      ...(r.recovered === true ? { recovered: true } : {}),
    })
  }
  const commsInstance: Record<string, CommsInstanceEntry> = {}
  for (const [key, value] of Object.entries(asRaw(src.commsInstance))) {
    if (key.length === 0) continue
    const e = asRaw(value)
    const subjectId = typeof e.subjectId === 'string' ? e.subjectId : ''
    const bodyIds = (Array.isArray(e.bodyIds) ? e.bodyIds : []).filter((x): x is string => typeof x === 'string' && x.length > 0)
    const paragraphs = (Array.isArray(e.paragraphs) ? e.paragraphs : []).filter(
      (x): x is string => typeof x === 'string',
    )
    if (subjectId.length === 0 || bodyIds.length === 0 || paragraphs.length === 0) continue
    const paramsRaw = asRaw(e.params)
    const params: Record<string, string | number> = {}
    for (const [pk, pv] of Object.entries(paramsRaw)) {
      if (typeof pv === 'string' || (typeof pv === 'number' && Number.isFinite(pv))) params[pk] = pv
    }
    const rewards: CommsRewardLine[] = []
    for (const item of Array.isArray(e.rewards) ? e.rewards : []) {
      const r = asRaw(item)
      if (typeof r.isk === 'number' && Number.isFinite(r.isk) && r.isk >= 0) {
        rewards.push({ isk: Math.floor(r.isk) })
        continue
      }
      if (typeof r.itemId !== 'string' || r.itemId.length === 0) continue
      const qty = typeof r.qty === 'number' && Number.isFinite(r.qty) ? Math.max(1, Math.floor(r.qty)) : 1
      rewards.push({ itemId: r.itemId, qty })
    }
    const hintRaw = asRaw(e.hint)
    const hintText = typeof hintRaw.text === 'string' && hintRaw.text.length > 0 ? hintRaw.text : ''
    const hintAction = typeof hintRaw.action === 'string' && hintRaw.action.length > 0 ? hintRaw.action : undefined
    const hintPage = typeof hintRaw.page === 'string' && hintRaw.page.length > 0 ? (hintRaw.page as CommsJumpPage) : undefined
    commsInstance[key] = {
      id: key,
      factionId: typeof e.factionId === 'string' ? e.factionId : '',
      ...(typeof e.deptId === 'string' && e.deptId.length > 0 ? { deptId: e.deptId } : {}),
      ...(typeof e.kind === 'string' && e.kind.length > 0 ? { kind: e.kind as CommsKind } : {}),
      atGameMs: typeof e.atGameMs === 'number' && Number.isFinite(e.atGameMs) ? Math.max(0, Math.floor(e.atGameMs)) : 0,
      subject: typeof e.subject === 'string' ? e.subject : '',
      subjectId,
      paragraphs,
      bodyIds,
      ...(Object.keys(params).length > 0 ? { params } : {}),
      ...(hintText.length > 0
        ? { hint: { text: hintText, ...(hintAction !== undefined ? { action: hintAction } : {}), ...(hintPage !== undefined ? { page: hintPage } : {}) } }
        : {}),
      ...(rewards.length > 0 ? { rewards } : {}),
    }
  }

  // --- 扫描续扫进度（v14）：星系 → 已完成的就地扫描窗口毫秒 ---
  // 上限 = **扫描窗口的合法上限**（`maxScanWindowMs()` = 基准窗口 × 最深危险度曲线 = **12 小时**，
  // 2026-09-25 船长令；旧口径「线性 ×144 = 24 小时」（2026-09-23）已作废）——
  // 2026-09-11 修复：原按基准 `SCAN_WINDOW_MS`（10 分钟）钳，而低安星系的有效窗口最长 12 小时，
  // 于是"在低安扫了 10 分钟以上 → 终止 → 重开存档"会把进度截回 10 分钟（白扫一段）。
  // 本函数没有 ctx（拿不到目标星系安全等级），故只能按全游戏最大可能窗口兜底；
  // 消费侧（`scanWindowMsFor` 起步/续扫）仍按**该星系实际窗口**再钳一次。
  const scanLimit = maxScanWindowMs()
  const scanProgressRaw = asRaw(src.scanProgress)
  const scanProgress: Record<string, number> = {}
  for (const [key, value] of Object.entries(scanProgressRaw)) {
    if (key.length === 0) continue
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      scanProgress[key] = Math.min(scanLimit, Math.floor(value))
    }
  }

  // --- 调试模式（v15）：布尔化（非法值一律 false） ---
  const debugQuick = src.debugQuick === true

  // --- 虫洞扫描与库存（2026-09-14 · 可选字段 ⇒ 零迁移）---
  // 扫描：active 布尔化、进度钳制在 [0, 窗口上限]（窗口上限 = 基准 12 小时 ×1，技能只会缩短窗口 ⇒
  // 按基准兜底，消费侧 `wormholeScanWindowMs` 再按实际技能窗口钳一次）
  const whScanRaw = asRaw(src.wormholeScan)
  const whScanProgressRaw = num(whScanRaw.progressMs)
  const wormholeScan = {
    active: whScanRaw.active === true,
    progressMs:
      Number.isFinite(whScanProgressRaw) && whScanProgressRaw > 0
        ? Math.min(WORMHOLE_SCAN_BASE_MS, Math.floor(whScanProgressRaw))
        : 0,
    /** **解锁当次的满窗口是否已发放**（可选字段：只在真时写 ⇒ 老档缺省 = 未发放，达标后下一 tick 自动补） */
    ...(whScanRaw.welcomed === true ? { welcomed: true } : {}),
  }
  // 库存：只收"结构完整"的条目（id 非空 / 种子为正整数），上限 = `WORMHOLE_STOCK_MAX_HARD`（基础 5 ＋ 星图记录学满级 10 ⇒ 读档不会截掉满级玩家的 15 格）
  const wormholeStock: Array<{
    id: string
    seed: number
    depth: number
    archetype: WormholeArchetype
    family: WormholeFamily
    foundAtGameMs: number
  }> = []
  const whStockRaw = Array.isArray(src.wormholeStock) ? src.wormholeStock : []
  for (const item of whStockRaw) {
    if (wormholeStock.length >= WORMHOLE_STOCK_MAX_HARD) break
    const o = asRaw(item)
    const id = typeof o.id === 'string' ? o.id : ''
    const seed = Math.floor(num(o.seed))
    if (id.length === 0 || !Number.isFinite(seed) || seed <= 0) continue
    wormholeStock.push({
      id,
      seed,
      /** 起始层：**恒 1**（船长 2026-09-14「所有虫洞都是从1层开始探索」）⇒ 旧档里的 2/3 一并归 1 */
      depth: 1,
      /**
       * 内容原型与敌族（丙/丁 · 2026-09-14）：**老档没有 ⇒ 按种子现算**（零迁移，且与发现时一致）；
       * 坏值（非法字符串）同样退回现算，不把脏值带进运行态。
       */
      archetype: WORMHOLE_ARCHETYPES.includes(o.archetype as WormholeArchetype)
        ? (o.archetype as WormholeArchetype)
        : wormholeArchetypeOf(seed),
      family: WORMHOLE_FAMILY_ORDER.includes(o.family as WormholeFamily)
        ? (o.family as WormholeFamily)
        : wormholeFamilyOfSeed(seed),
      foundAtGameMs: Number.isFinite(num(o.foundAtGameMs)) ? Math.max(0, Math.floor(num(o.foundAtGameMs))) : 0,
    })
  }

  // --- 自动探索（2026-09-14 批次 3 · 可选字段 ⇒ 零迁移）---
  // 在跑的趟：id/stockId 非空、种子与层为正整数、参与舰是舰队里的船（不在舰队 ⇒ 丢弃该条目，
  // 免得锁定一艘已经不存在的船）；到点未结算的照旧保留（下一拍 `advanceWormholeAuto` 会结算）。
  const wormholeAuto: Array<{
    id: string
    stockId: string
    seed: number
    depth: number
    shipIds: string[]
    startedAtGameMs: number
    finishAtGameMs: number
  }> = []
  for (const item of Array.isArray(src.wormholeAuto) ? src.wormholeAuto : []) {
    const o = asRaw(item)
    const id = typeof o.id === 'string' ? o.id : ''
    const stockId = typeof o.stockId === 'string' ? o.stockId : ''
    if (id.length === 0 || stockId.length === 0) continue
    const seed = Math.floor(num(o.seed))
    const depth = Math.floor(num(o.depth))
    const pool: string[] = []
    for (const sid of Array.isArray(o.shipIds) ? o.shipIds : []) {
      if (typeof sid === 'string' && sid.length > 0 && !pool.includes(sid)) pool.push(sid)
    }
    const live = pool.filter((sid) => fleet[sid] !== undefined)
    if (live.length === 0) continue
    const started = Math.floor(num(o.startedAtGameMs))
    const finish = Math.floor(num(o.finishAtGameMs))
    wormholeAuto.push({
      id,
      stockId,
      seed: Number.isFinite(seed) && seed > 0 ? seed : 1,
      depth: Number.isFinite(depth) ? Math.min(9, Math.max(1, depth)) : 1,
      shipIds: live.slice(0, WORMHOLE_AUTO_MAX_SHIPS),
      startedAtGameMs: Number.isFinite(started) ? Math.max(0, started) : 0,
      finishAtGameMs: Number.isFinite(finish) ? Math.max(0, finish) : 0,
    })
  }
  // 报告队列：结构完整的才收；`gains`/`damage` 逐项净化；上限 = `WORMHOLE_AUTO_REPORT_MAX`（新的在前）
  const wormholeAutoReports: Array<{
    id: string
    stockId: string
    depth: number
    finishedAtGameMs: number
    shipIds: string[]
    coresReleased: number
    gains: Array<{ itemId: string; units: number }>
    damage: Array<{
      shipId: string
      name: string
      durabilityLossPct: number
      armorLossPct: number
      durabilityPct: number
      armorPct: number
    }>
    confirmed: boolean
  }> = []
  for (const item of Array.isArray(src.wormholeAutoReports) ? src.wormholeAutoReports : []) {
    if (wormholeAutoReports.length >= WORMHOLE_AUTO_REPORT_MAX) break
    const o = asRaw(item)
    const id = typeof o.id === 'string' ? o.id : ''
    if (id.length === 0) continue
    const gains: Array<{ itemId: string; units: number }> = []
    for (const g of Array.isArray(o.gains) ? o.gains : []) {
      const go = asRaw(g)
      const itemId = typeof go.itemId === 'string' ? go.itemId : ''
      const units = Math.floor(num(go.units))
      if (itemId.length === 0 || !Number.isFinite(units) || units <= 0) continue
      gains.push({ itemId, units })
    }
    const damage: typeof wormholeAutoReports[number]['damage'] = []
    for (const d of Array.isArray(o.damage) ? o.damage : []) {
      const dobj = asRaw(d)
      const shipId = typeof dobj.shipId === 'string' ? dobj.shipId : ''
      if (shipId.length === 0) continue
      const clampPct = (v: unknown): number => {
        const n = Math.floor(num(v))
        return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0
      }
      damage.push({
        shipId,
        name: typeof dobj.name === 'string' && dobj.name.length > 0 ? dobj.name : shipId,
        durabilityLossPct: clampPct(dobj.durabilityLossPct),
        armorLossPct: clampPct(dobj.armorLossPct),
        durabilityPct: clampPct(dobj.durabilityPct),
        armorPct: clampPct(dobj.armorPct),
      })
    }
    const shipIds: string[] = []
    for (const sid of Array.isArray(o.shipIds) ? o.shipIds : []) {
      if (typeof sid === 'string' && sid.length > 0 && !shipIds.includes(sid)) shipIds.push(sid)
    }
    const depth = Math.floor(num(o.depth))
    wormholeAutoReports.push({
      id,
      stockId: typeof o.stockId === 'string' ? o.stockId : '',
      depth: Number.isFinite(depth) ? Math.min(9, Math.max(1, depth)) : 1,
      finishedAtGameMs: Number.isFinite(num(o.finishedAtGameMs)) ? Math.max(0, Math.floor(num(o.finishedAtGameMs))) : 0,
      shipIds,
      /**
       * 返航释放的核心数：**恒为 1**（2026-09-26 船长令「整队一趟只占 1 枚」）。
       * 旧档该字段存的是"参与舰数"（旧口径每舰 1 枚）——读档**按新口径重算**，不做数值迁移
       * （它只是报告里的一行读数，不参与占用计算；占用直接数在跑的趟数）。
       */
      coresReleased: 1,
      gains,
      damage,
      confirmed: o.confirmed === true,
    })
  }

  // --- 限时促销的一次性领取记录（2026-09-16 · 可选字段 ⇒ 零迁移）：只收"键非空 + 值恒 true"的项 ---
  const promoClaimed: Record<string, true> = {}
  for (const [key, val] of Object.entries(asRaw(src.promoClaimed))) {
    if (key.length > 0 && val === true) promoClaimed[key] = true
  }

  // --- 需弹窗的通讯队列（2026-09-14 · 可选字段 ⇒ 零迁移）：只收非空字符串、去重保序 ---
  const commsPopups: string[] = []
  for (const id of Array.isArray(src.commsPopups) ? src.commsPopups : []) {
    if (typeof id === 'string' && id.length > 0 && !commsPopups.includes(id)) commsPopups.push(id)
  }

  /**
   * **因低安袭击自动撤离**（2026-09-14 · 三态随档，见 `state.ts` 字段注释）：
   * `true` = 真发生过；`false` = 新档（必须落键，否则读回来会被当成老档）；**缺失 = 老档**（保持缺失，
   * 由触发器用 `encounterZoneCooldown` 那点痕迹判"到底触发过没有"）。
   */
  const ambushRetreatSeen =
    src.ambushRetreatSeen === true ? true : src.ambushRetreatSeen === false ? false : undefined

  /**
   * **造出第一艘自造船**（2026-09-15 · 三态随档，见 `state.ts` 字段注释）：
   * `true` = 造过；`false` = 新档（必须落键，否则读回来会被当成老档）；**缺失 = 老档**（保持缺失，
   * 由触发器按船长裁决「丙」补发）。
   */
  const firstShipBuilt =
    src.firstShipBuilt === true ? true : src.firstShipBuilt === false ? false : undefined
  /**
   * **第一次进实验室页面**（2026-09-30 船长令：首访发一封黑市通讯）——三态读法，同 `firstShipBuilt`：
   * `true` = 进过；`false` = 新档（必须落键）；**缺失 = 老档**（保持缺失）。
   * ⚠ 本清洗器逐字段重建 ⇒ 漏登记 = 每读一次档标记就被抹掉（那封信会在每次读档后重发一次）。
   */
  const labOpened = src.labOpened === true ? true : src.labOpened === false ? false : undefined
  /**
   * **弹药 / 修理组件取用来源开关**（2026-09-23 船长令）：三态读法（缺省 = 未设过 = 走默认"只仓库"）。
   * ⚠ 本清洗器逐字段重建 ⇒ 漏登记 = 每读一次档开关就被重置（与 `foe`/`turnsSpent` 同一类事故）。
   */
  const resupplyFromWarehouse =
    src.resupplyFromWarehouse === true ? true : src.resupplyFromWarehouse === false ? false : undefined
  /**
   * **模式选择已完成**（2026-09-24 船长令）：只在 `true` 时落键（缺省 = 没选过 ⇒ 零迁移）。
   * ⚠ 本清洗器逐字段重建 ⇒ 漏登记 = 每读一次档模式选择框就又弹一次（与 `salvagerGift` 那次同一类事故）。
   */
  const modeChosen = src.modeChosen === true ? true : undefined
  /**
   * **跃迁燃料的活动开关**（**2026-09-29 船长令 · 跃迁燃料批**）：只收 `true` 的键（缺省 = 关
   * ⇒ 老档零迁移、往返逐字一致）。活动白名单与 `core/jumpFuel.ts` 的 `JumpFuelActivity` 同源。
   * ⚠ 同款的坑：漏登记 = 每读一次档开关全被重置（玩家会以为"我明明开着"）。
   */
  const jumpFuel: NonNullable<GameState['jumpFuel']> = {}
  for (const key of ['mine', 'salvage', 'expedition', 'ai'] as const) {
    if (asRaw(src.jumpFuel)[key] === true) jumpFuel[key] = true
  }
  /**
   * **实验室产线**（**2026-09-29 船长令**）：逐字段重建（台号/配方/劳动者/单批单位/周期/到点时刻/批数）。
   * 配方号必须真实存在于 `ctx.labRecipes` 才收（坏行整条丢 —— 与精炼炉 `refineRuns` 同款口径）。
   * 空表 ⇒ 不写键（老档零迁移）。
   */
  const labRuns: NonNullable<GameState['labRuns']> = []
  for (const raw of Array.isArray(src.labRuns) ? src.labRuns : []) {
    const r = asRaw(raw)
    const recipeId = typeof r.recipeId === 'string' ? r.recipeId : ''
    const worker = validCoreType(r.worker) || r.worker === 'pilot' ? (r.worker as 'pilot' | AiCoreType) : null
    if (recipeId.length === 0 || worker === null) continue
    labRuns.push({
      active: r.active !== false,
      id: Math.max(0, Math.floor(num(r.id) || 0)),
      worker,
      recipeId,
      batchUnits: Math.max(1, Math.floor(num(r.batchUnits) || 0)),
      cycleMs: Math.max(1, Math.floor(num(r.cycleMs) || 0)),
      finishAtGameMs: Math.max(0, Math.floor(num(r.finishAtGameMs) || 0)),
      /**
       * **退料账**（**2026-10-01**：实验室改成"开工整批扣料"后必须有这本账，停机靠它退料）。
       * 老档没有这笔（旧语义 = 每批到点才扣、退无可退）⇒ 缺省空账；`batchesDone` 旧字段**不再收**
       * （一线一批后不存在"线内批数"，批数改由 `state.labLoops[recipeId].produced` 承担）。
       */
      ...(Array.isArray(r.spentMaterials)
        ? {
            spentMaterials: (r.spentMaterials as unknown[])
              .map((x) => {
                const o = asRaw(x)
                const itemId = typeof o.itemId === 'string' ? o.itemId : ''
                return { itemId, count: Math.max(0, Math.floor(num(o.count) || 0)) }
              })
              .filter((x) => x.itemId.length > 0 && x.count > 0),
          }
        : {}),
    })
  }
  const labSeq = Math.max(1, Math.floor(num(src.labSeq) || 1))
  /**
   * **实验室「循环实验」卡片级配置**（**2026-10-01 船长令**：实验室按组装机那套 ⇒ 一线一批 ＋ 循环开关）。
   * 与 `manufacturingLoops` 同款：兼容字段、无版本号变化、**空表不写键**（老档零迁移）。
   * ⚠ 漏登记的后果与 `boostAutoRenew` 同款：每读一次档循环开关就被清掉（玩家会发现"开了又自己关"）。
   */
  const labLoops: NonNullable<GameState['labLoops']> = {}
  for (const [rc, rawLoop] of Object.entries(asRaw(src.labLoops))) {
    const o = asRaw(rawLoop)
    const goal = Math.max(0, Math.floor(num(o.goal) || 0))
    labLoops[rc] = {
      on: o.on === true,
      ...(goal > 0 ? { goal } : {}),
      produced: Math.max(0, Math.floor(num(o.produced) || 0)),
      ...(typeof o.stopWhy === 'string' && o.stopWhy.length > 0 ? { stopWhy: o.stopWhy } : {}),
    }
  }
  /**
   * **突触加速剂生效截止**（**2026-09-30 船长令**）：可选键 —— 0 / 非有限 / 已过期一律按"无加成"读，
   * **空值不写键** ⇒ 老档零迁移、往返逐字一致（与 `jumpFuel` / `labRuns` 同款）。
   */
  const skillBoostUntilMs = Math.max(0, Math.floor(num(src.skillBoostUntilMs) || 0))
  /**
   * **技能加速「自动续用」开关**（**2026-10-01 船长令** · 兼容字段无版本号）：**只在 true 时写键**
   * ⇒ 缺键/false 一律按"关"读，老档零迁移、往返逐字一致（与 `skillBoostUntilMs` 同款）。
   * ⚠ 漏登记的后果与 `resupplyFromWarehouse` 同款：每读一次档开关就被清掉（玩家会发现"开了又自己关"）。
   */
  const boostAutoRenew = src.boostAutoRenew === true
  /**
   * **实战胜利记录**（2026-09-24 船长令 · 兼容字段无版本号）：键 = 敌卡 id，值 = 那一次的距离与剩余比例。
   * 只收合法行（`desireM` 为正有限数 · `remainPct` 落在 0~1）；**空表不写键** ⇒ 老档零迁移、往返逐字一致。
   * ⚠ 与 `resupplyFromWarehouse` 同款：漏登记 = 每读一次档记录就被清空，胜率预估退回三点采样。
   */
  const winRecord: Record<string, { desireM: number; remainPct: number }> = {}
  for (const [anomalyId, rec] of Object.entries(asRaw(src.winRecord))) {
    if (anomalyId.length === 0 || typeof rec !== 'object' || rec === null) continue
    const r = asRaw(rec)
    const desireM = r.desireM
    const remainPct = r.remainPct
    if (typeof desireM !== 'number' || !Number.isFinite(desireM) || desireM <= 0) continue
    if (typeof remainPct !== 'number' || !Number.isFinite(remainPct)) continue
    winRecord[anomalyId] = { desireM, remainPct: Math.min(1, Math.max(0, remainPct)) }
  }
  /**
   * 见过的敌方舰级（2026-09-16）：只收 `true` 的键（值域 = `FoeShipDef.id` 字符串）。
   * **空表也落键**（与 `commsDelivered` 同口径）：新档出生即带 `{}`，若这里把空表折成"缺失"，
   * 存档往返会少一个键 ⇒ `save.test.ts` 的"内容完全一致"用例失败。
   */
  const foeShipSeen: Record<string, true> = {}
  for (const [k, v] of Object.entries(asRaw(src.foeShipSeen))) if (v === true) foeShipSeen[k] = true

  // --- 首胜声望清单（v15.1 兼容字段）：只收字符串 id、去重保序 ---
  const completedBounties: string[] = []
  const cbRaw = src.completedBounties
  if (Array.isArray(cbRaw)) {
    for (const id of cbRaw) {
      if (typeof id === 'string' && id.length > 0 && !completedBounties.includes(id)) completedBounties.push(id)
    }
  }

  // --- 序章·苏醒（v23 兼容字段）：只剩"演出中(0) / 完成(99)"两态（2026-09-17 教程重做） ---
  const onboardingRaw = asRaw(src.onboarding)
  const stepRaw = onboardingRaw.step
  // 2026-09-17 迁移：旧档的 -1（未开始）／0.5（简报）／1..8（七步教程中）一律读成 99 ——
  // 线性教程已退场（内容改由任务中心 13 条「第一次」承载），旧的"进行中"状态没有任何后续步骤可推进；
  // **只有正处在序章演出里（step 0）的档保留 0**，让他们照常看完开场演出。
  const onboardingStep = stepRaw === 0 ? 0 : 99
  const onboarding = { step: onboardingStep }
  const importantTasks: GameState['importantTasks'] = {}
  const itRaw = asRaw(src.importantTasks)
  for (const [key, value] of Object.entries(itRaw)) {
    if (key.length === 0) continue
    const r = asRaw(value)
    importantTasks[key] = {
      done: r.done === true,
      delivered: typeof r.delivered === 'number' && Number.isFinite(r.delivered) ? Math.max(0, Math.floor(r.delivered)) : undefined,
      // 阶段目标里程碑（键存在才写；否则保持缺省，避免给所有任务塞字段）
      ...(r.allExplored === true ? { allExplored: true } : {}),
      // 起手道具已发放（2026-09-21：任务开始时给道具的去重键；只在 true 时写，零迁移）
      ...(r.started === true ? { started: true } : {}),
    }
  }

  /**
   * 「第一次」任务系列的终身计数（2026-09-17 教程重做批 · 阶段②；**可选、零迁移**）：
   * 只收"有限正数"，键非空即留；老档没有这个字段 ⇒ 不写（读作 0，链任务从 0 起）。
   */
  const firstStats: NonNullable<GameState['firstStats']> = {}
  const fsRaw = asRaw(src.firstStats)
  for (const [key, value] of Object.entries(fsRaw)) {
    if (key.length === 0) continue
    const n = num(value)
    if (!Number.isFinite(n) || n <= 0) continue
    firstStats[key] = Math.floor(n)
  }

  /**
   * **导航「任务中心」推进提醒的记账**（**2026-09-20 船长令**：「每推进一阶段第一次任务时，
   * 在导航栏的任务中心选项处进行提醒」）——玩家"看过的当前那一条"的任务 id。
   *
   * 兼容字段、**零迁移**：老档缺省 ⇒ 首帧徽标亮一次（与 `bountySeenWindow` 同款处置）；
   * ⚠ **没记过账就不写这个键**（空串/非字符串一律丢弃）——与 `sideTasks.bountySeenWindow` 同款口径：
   * 老档与新档的快照往返因此逐字一致。
   */
  const firstTaskSeenIdRaw = src.firstTaskSeenId
  const firstTaskSeenId = typeof firstTaskSeenIdRaw === 'string' && firstTaskSeenIdRaw.length > 0 ? firstTaskSeenIdRaw : undefined
  /**
   * **「已达成」播报记账 ＋ 老档一次性收口标记**（2026-09-21 船长令：任务改为**玩家点「完成」**才推进）。
   * 两个都按"缺省不写键"处理 ⇒ 新档快照不含它们（与上面的 `firstTaskSeenId` 同款口径、零迁移）。
   */
  const firstTaskReadyIdRaw = src.firstTaskReadyId
  const firstTaskReadyId = typeof firstTaskReadyIdRaw === 'string' && firstTaskReadyIdRaw.length > 0 ? firstTaskReadyIdRaw : undefined
  const firstTaskAutoClaim = src.firstTaskAutoClaim === true ? true : undefined
  /**
   * **铁人模式**（**2026-09-23 船长令**：「**和玩家讨论了下，发现好像搞一个铁人模式更受欢迎**」）。
   *
   * 白名单重建（**新加随档字段必须在这里落一笔**——漏了就是"刷新即丢"那一类缺陷，见本文件
   * `importantTasks` 那次（2026-09-22 打捞器补发去重键，该临时补丁已于 2026-09-24 拆除）
   * 与 `wormhole.run.turnsBase` 两次前车之鉴）：
   * - `on`：只认 `true`（缺省/其它值 ⇒ false = 普通档）；
   * - `seq`：**存档代次**（非负有限整数；缺省 ⇒ 0）——**必须随档**，它是"铁人档装载闸门"的一半
   *   （另一半是存档之外的账本，主进程读写）；
   * - `sinceWallMs` / `closedWallMs`：只在有值时写（徽章判据与界面展示用）。
   * ⚠ **老档没有这个键** ⇒ 一律读作"普通档、代次 0"（零迁移；闸门只对铁人档生效 ⇒ 老档行为不变）。
   */
  const ironmanRaw = asRaw(src.ironman)
  const ironmanSeqRaw = num(ironmanRaw.seq)
  const ironman: GameState['ironman'] = {
    on: ironmanRaw.on === true,
    seq: Number.isFinite(ironmanSeqRaw) && ironmanSeqRaw > 0 ? Math.floor(ironmanSeqRaw) : 0,
    ...(Number.isFinite(num(ironmanRaw.sinceWallMs)) && num(ironmanRaw.sinceWallMs) > 0
      ? { sinceWallMs: Math.floor(num(ironmanRaw.sinceWallMs)) }
      : {}),
    ...(Number.isFinite(num(ironmanRaw.closedWallMs)) && num(ironmanRaw.closedWallMs) > 0
      ? { closedWallMs: Math.floor(num(ironmanRaw.closedWallMs)) }
      : {}),
  }

  // --- 周末入侵活动（老档/异常缺省 = 没有入侵；见 weekendEvent.ts 的零迁移口径） ---
  const weekendRaw = asRaw(src.weekendEvent)
  const weekendStr = (v: unknown): string => (typeof v === 'string' && v.length > 0 ? v : '')
  const weekendNum = (v: unknown): number => (Number.isFinite(num(v)) && num(v) > 0 ? Math.floor(num(v)) : 0)
  /**
   * **可选数值字段的"原样保留"口径**（2026-09-25 补）：有限且 **≥ 0** ⇒ floor，缺省/坏值 ⇒ 不写键。
   * 与 `weekendNum` 的区别在 **0 是合法值**——下面这些字段是**状态读数 / 幂等标记**，不是"计数"：
   * 母舰已伤 0、章鱼削血 0、削血心跳 0（墙钟起点）、结束标记 0、**贡献奖已发 0**、
   * 同一场的身份 `flagshipRunId` 0（`battle.startedAtGameMs` 早期就是 0 一带）。
   * ⚠ 起因（实测）：这些键原先**根本没过清洗器** ⇒ 读档后**旗舰血条回满、章鱼削血清零、
   * 同场幂等键丢失（同一场可能被重复记账）** —— 见 `weekend-event.test.ts` 的"随档往返"用例。
   */
  const weekendKeep = (v: unknown): number | undefined => {
    const n = num(v)
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined
  }
  /**
   * **夺回奖的两本随档账**（**2026-09-27 修漏**）—— 原先**两个都没进这里**：
   * - `reclaimPaid`（已发过奖的星系，同日新加的防重复标记）：不随档 ⇒ **读一次档标记就丢** ⇒
   *   `weekendSyncReclaimRewards` 会重新把"已夺回"的处全当成漏记 ⇒ **再发一遍全部夺回奖**
   *   （刷档即可无限刷）；⚠ 这是同日那次修复自己埋的雷，本行补上。
   * - `reclaimPending`（待到账的夺回奖，2026-09-25 那批就有）：不随档 ⇒ 夺回之后**读一次档那笔就丢**，
   *   活动结束结算时少发（"收复了却没给钱"的另一半根因）。
   */
  const reclaimPaid: string[] = []
  if (Array.isArray(weekendRaw.reclaimPaid)) {
    for (const x of weekendRaw.reclaimPaid) {
      if (typeof x === 'string' && x.length > 0 && !reclaimPaid.includes(x)) reclaimPaid.push(x)
    }
  }
  const reclaimPendingRaw = asRaw(weekendRaw.reclaimPending)
  const reclaimPending = {
    isk: Math.max(0, Math.floor(num(reclaimPendingRaw.isk) || 0)),
    wreck: Math.max(0, Math.floor(num(reclaimPendingRaw.wreck) || 0)),
  }
  /**
   * **到手台账**（**2026-09-28 船长令「按你推荐来」⇒ 甲案：落盘**）—— 与上面那两本账**同一类漏**：
   * 它原先**根本没进这个清洗器**（本文件 0 引用）⇒ 读一次档这本账就归零。两处实际后果：
   * - `weekendSettleAndGrant` 的"迟到补发"（`boxAtSettle` ＝ 台账里没有黑匣 ∧ 掷骰掷中了）**只靠它幂等**
   *   ⇒「击沉 → 发匣（台账记 1）→ 关游戏 → 读档（台账归 0、`flagshipBlackBox` 仍是 `true`）→ 结算」
   *   这条路会**再发一枚黑匣**（实测口径见工作文档 `docs/design/weekend-blackbox-payout-20260928.md`）；
   * - 结算面板与结算通讯的奖励清单读它（"说的与发的逐值一致"）⇒ 读档后清单整片归零。
   * 口径：三格走 `weekendKeep`（**0 是合法值** = 一项都没发），`byGalaxy` 逐项清洗（星系 id 非空、两格 ≥ 0）；
   * **缺键 ⇒ 不写键**（老档零迁移，读侧照旧 `??=` 兜底）。
   */
  const rewardLedger = ((): NonNullable<GameState['weekendEvent']>['rewardLedger'] => {
    const raw = asRaw(weekendRaw.rewardLedger)
    if (Object.keys(raw).length === 0) return undefined
    const byGalaxy: Record<string, { isk: number; wreck: number }> = {}
    for (const [gid, v] of Object.entries(asRaw(raw.byGalaxy))) {
      if (gid.length === 0) continue
      const g = asRaw(v)
      byGalaxy[gid] = {
        isk: Math.max(0, Math.floor(num(g.isk) || 0)),
        wreck: Math.max(0, Math.floor(num(g.wreck) || 0)),
      }
    }
    return {
      isk: weekendKeep(raw.isk) ?? 0,
      wreck: weekendKeep(raw.wreck) ?? 0,
      blackBox: weekendKeep(raw.blackBox) ?? 0,
      byGalaxy,
    }
  })()
  const weekendCoreId = weekendStr(weekendRaw.coreId)
  const weekendStartedAt = weekendNum(weekendRaw.startedAtWallMs)
  const contributedRaw = asRaw(weekendRaw.contributed)
  const contributed: Record<string, number> = {}
  for (const [k, v] of Object.entries(contributedRaw)) {
    const n = num(v)
    if (k.length > 0 && Number.isFinite(n) && n > 0) contributed[k] = Math.min(1, n)
  }
  const weekendEvent: GameState['weekendEvent'] =
    weekendCoreId && weekendStartedAt > 0
      ? (() => {
          /**
           * 旗舰 BOSS 与结束结算的随档字段（**逐个 `weekendKeep`**，缺省不写键 ⇒ 老档零迁移）。
           * `flagshipHpMax` 走 `> 0`：0 会读成"1 点血条"（`weekendFlagshipHpRemaining` 有下限 1），
           * 而它的唯一合法值就是池子常量 ⇒ 0/坏值一律当"还没锁池"。
           */
          const hpMax = weekendNum(weekendRaw.flagshipHpMax)
          const hpDone = weekendKeep(weekendRaw.flagshipHpDone)
          /**
           * ⚠ **幂等标记 / 身份键 / 心跳基准：缺键必须是 `undefined`，绝不能读成 0**
           * （**2026-09-25 船长报障**：「**摧毁入侵母舰后，没有结算通讯发来**」——根因就在这一行）。
           *
           * 上面那个 `weekendKeep` 建在 `num(v, 0)` 上（"0 是合法值"的那批读数用它，例如已伤 0、
           * 削血 0）：**键不存在时它会返回 0**，而 0 又是"合法的有限数"⇒ 读档后
           * `prizePaidAtWallMs = 0` 被当成"这一场已经结过账" ⇒ `weekendSettleAndGrant` **永久早退**：
           * 贡献奖不发 · 战果快照不写 · 结算通讯不发（实测：击沉母舰后日志只有"旗舰击沉"，其余什么都没有）。
           * ⇒ 这三个字段改走"缺键 ⇒ undefined"的严格口径（**有键且 ≥0 仍然逐字保留**，含合法的 0）。
           */
          const strictKeep = (v: unknown): number | undefined =>
            typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : undefined
          /**
           * **章鱼人那一份：旧字段就地迁移**（2026-09-25 改口径 ⇒ 共享血条）。
           *
           * 旧档存的是**时长** `octopusDrainedMs`（"在线且非战斗"累计毫秒），新档存的是**血量**
           * `octopusHpDone`（速率 = `池子总量 ÷ 窗口`）。不迁移的后果（实测船长在玩的那份档）：
           * 已削掉的 24% 会**凭空回血**——玩家会看到母舰血条跳回去。
           * ⇒ 换算 `血量 = 池子总量 × 时长 ÷ 窗口`，窗口走**同一个单源** `weekendFlagshipWindowMs`
           * （正常 2h / 调试 10min），与推进/读数/收口四处同一把尺。
           * ⚠ 两个键都走 `strictKeep`（缺键 ⇒ undefined）——`weekendKeep` 会把缺键读成 0，
           * 迁移分支就再也进不去了（同一个坑，见上）。
           */
          const drainedLegacy = strictKeep(weekendRaw.octopusDrainedMs)
          const octopusHp =
            strictKeep(weekendRaw.octopusHpDone) ??
            (drainedLegacy !== undefined && drainedLegacy > 0 && hpMax > 0
              ? Math.floor((hpMax * drainedLegacy) / weekendFlagshipWindowMs({ debugQuick }))
              : undefined)
          const runId = strictKeep(weekendRaw.flagshipRunId)
          const bossTick = strictKeep(weekendRaw.bossTickWallMs)
          /**
           * **章鱼人停工终点**（**2026-09-26 船长令**：旗舰战结束后 60 秒才恢复削血/判定）——
           * 不认它 ⇒ 读档即丢 ⇒ **冷却被读档绕过**（同类旧账：`bossHpLayers` 那三格当初没过清洗器）。
           */
          const octopusHold = strictKeep(weekendRaw.octopusHoldUntilWallMs)
          /**
           * **窗口结束的顺延终点**（**2026-09-27 船长令**：「到点的延期到玩家打完1分钟后」）——
           * 与 `octopusHoldUntilWallMs` 同款：不认它 ⇒ 读档即丢 ⇒ **顺延被读档绕过**
           * （窗口一到点、读一次档就把玩家正在打的那一场作废了）。
           */
          const windowEndHold = strictKeep(weekendRaw.windowEndHoldUntilWallMs)
          const prizePaid = strictKeep(weekendRaw.prizePaidAtWallMs)
          const assaultDraws = weekendKeep(weekendRaw.assaultDraws)
          /** 入侵「重复出击」的循环目标（**可选字段**：缺键 = 没开；本批新增，不动结构版本） */
          const autoLoopGalaxyId = weekendStr(weekendRaw.autoLoopGalaxyId)
          /**
           * **玩家亲手击沉的留档**（**2026-09-27 船长令**：「留档玩家的旗舰战记录，直到下一次入侵开始时
           * 覆盖清空」）——四格逐字段认：墙钟/战斗身份/战斗时钟都要有限正数，`waveIdx` 可缺省。
           * 缺任一必需格 ⇒ **整块丢**（不留半份）。不认它 ⇒ 读档即丢 ⇒ 结算报告又回落到池子算术反推。
           */
          const playerKill = ((): NonNullable<GameState['weekendEvent']>['flagshipPlayerKill'] => {
            const raw = asRaw(weekendRaw.flagshipPlayerKill)
            if (raw === null || typeof raw !== 'object') return undefined
            const at = strictKeep(raw.atWallMs)
            const rid = strictKeep(raw.runId)
            const down = strictKeep(raw.downAtGameMs)
            if (at === undefined || at <= 0 || rid === undefined || down === undefined || down <= 0) return undefined
            const wi = strictKeep(raw.waveIdx)
            return { atWallMs: at, runId: rid, ...(wi !== undefined && wi >= 0 ? { waveIdx: wi } : {}), downAtGameMs: down }
          })()
          return {
            seq: Math.max(1, weekendNum(weekendRaw.seq) || 1),
            startedAtWallMs: weekendStartedAt,
            coreId: weekendCoreId,
            peripheryIds: (Array.isArray(weekendRaw.peripheryIds) ? weekendRaw.peripheryIds : [])
              .map((x) => weekendStr(x))
              .filter((x) => x.length > 0),
            family: weekendStr(weekendRaw.family) || 'A',
            contributed,
            /* 点火来源留痕（2026-10-01）：只认真布尔，缺键 = 老档 / 每周默认场 ⇒ 不写键（零迁移） */
            ...(weekendRaw.beaconHighSec === true ? { beaconHighSec: true } : {}),
            ...(weekendRaw.beaconLit === true ? { beaconLit: true } : {}),
            ...(weekendNum(weekendRaw.endedAtWallMs) > 0 ? { endedAtWallMs: weekendNum(weekendRaw.endedAtWallMs) } : {}),
            ...(weekendNum(weekendRaw.flagshipAtWallMs) > 0 ? { flagshipAtWallMs: weekendNum(weekendRaw.flagshipAtWallMs) } : {}),
            ...(weekendRaw.flagshipDown === 'player' || weekendRaw.flagshipDown === 'octopus'
              ? { flagshipDown: weekendRaw.flagshipDown as 'player' | 'octopus' }
              : {}),
            /**
             * **黑匣结清标记**（`flagshipBlackBox`；**2026-09-28 船长令改口径**后它的含义从
             * "掷骰结果"变成"这一枚结清了没有"，判据见 `weekendEvent.weekendBlackBoxSettledOf`）。
             * 只认真布尔（缺键 = 还没结清 ⇒ 该发的时候自然会发）。
             * ⚠ 同日的 `flagshipBlackBoxByPlayer`（旧"掷骰情境"）**已随爆率表一起删除**，
             * 这里不再读写它：老档里那个键读档时直接丢掉。
             */
            ...(typeof weekendRaw.flagshipBlackBox === 'boolean'
              ? { flagshipBlackBox: weekendRaw.flagshipBlackBox }
              : {}),
            ...(hpMax > 0 ? { flagshipHpMax: hpMax } : {}),
            ...(hpDone !== undefined ? { flagshipHpDone: hpDone } : {}),
            ...(octopusHp !== undefined ? { octopusHpDone: octopusHp } : {}),
            ...(runId !== undefined ? { flagshipRunId: runId } : {}),
            ...(bossTick !== undefined ? { bossTickWallMs: bossTick } : {}),
            ...(octopusHold !== undefined ? { octopusHoldUntilWallMs: octopusHold } : {}),
            ...(windowEndHold !== undefined ? { windowEndHoldUntilWallMs: windowEndHold } : {}),
            ...(prizePaid !== undefined ? { prizePaidAtWallMs: prizePaid } : {}),
            ...(assaultDraws !== undefined ? { assaultDraws } : {}),
            ...(autoLoopGalaxyId.length > 0 ? { autoLoopGalaxyId } : {}),
            // 2026-09-27 玩家亲手击沉的留档（换场即随事件对象消失 ⇒ 无需另写清空逻辑）
            ...(playerKill !== undefined ? { flagshipPlayerKill: playerKill } : {}),
            /** 夺回奖的两本账（2026-09-27 修漏）：空 ⇒ 不写键（老档零迁移），读侧有 `??=` 兜底 */
            ...(reclaimPaid.length > 0 ? { reclaimPaid } : {}),
            ...(reclaimPending.isk > 0 || reclaimPending.wreck > 0 ? { reclaimPending } : {}),
            /** 到手台账（**2026-09-28 甲案：随档**）—— 结算的"迟到补发"靠它幂等、面板与通讯的清单读它 */
            ...(rewardLedger !== undefined ? { rewardLedger } : {}),
          }
        })()
      : undefined

  /** **旗舰战参战编队**（2026-09-25 · 战前准备界面）：只留字符串、去重、截 4 艘；空 = 不写键 */
  const weekendPrepSquad: string[] = []
  for (const id of Array.isArray(src.weekendPrepSquad) ? src.weekendPrepSquad : []) {
    if (typeof id !== 'string' || id.length === 0 || weekendPrepSquad.includes(id)) continue
    weekendPrepSquad.push(id)
    if (weekendPrepSquad.length >= 4) break
  }

  /**
   * **上一场入侵的战果快照**（2026-09-25 · 结算面板读它）：**结构对不上就整条丢**——
   * 宁可"没有面板可看"，也不给界面喂半条（缺 seq/族/核心/结束时刻即判无效）。
   * 逐项数值一律钳到合法区间（占比 0~1、数量 ≥0）。
   */
  const weekendLastResult: GameState['weekendLastResult'] = (() => {
    const w = asRaw(src.weekendLastResult)
    const seq = weekendKeep(w.seq)
    const family = typeof w.family === 'string' && w.family.length > 0 ? w.family : ''
    const coreId = typeof w.coreId === 'string' && w.coreId.length > 0 ? w.coreId : ''
    const endedAt = weekendKeep(w.endedAtWallMs)
    if (seq === undefined || family === '' || coreId === '' || endedAt === undefined) return undefined
    const clamp01 = (v: unknown): number => {
      const n = num(v)
      return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0
    }
    const count = (v: unknown): number => {
      const n = num(v)
      return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
    }
    const galaxies = (Array.isArray(w.galaxies) ? w.galaxies : []).flatMap((g0) => {
      const g = asRaw(g0)
      const galaxyId = typeof g.galaxyId === 'string' && g.galaxyId.length > 0 ? g.galaxyId : ''
      if (galaxyId === '') return []
      return [
        {
          galaxyId,
          put: clamp01(g.put),
          progress: clamp01(g.progress),
          reclaimed: g.reclaimed === true,
          isk: count(g.isk),
          wreck: count(g.wreck),
        },
      ]
    })
    const fRaw = asRaw(w.flagship)
    const hpMax = weekendKeep(fRaw.hpMax)
    /**
     * **两份占比（玩家优先口径）**（**2026-09-27 船长令**：「优先计算玩家的，玩家允许挤掉章鱼人的输出」）：
     * 可缺省（老快照）⇒ 界面按缺省不显示；值只收 0~1 的有限数。
     */
    const fracOf = (v: unknown): number | undefined => {
      const n = num(v)
      return Number.isFinite(n) ? clamp01(n) : undefined
    }
    const playerFrac = fracOf(fRaw.playerFrac)
    const octopusFrac = fracOf(fRaw.octopusFrac)
    const flagship =
      hpMax !== undefined && hpMax > 0
        ? {
            hpMax,
            hpDone: count(fRaw.hpDone),
            defeated: fRaw.defeated === true,
            ...(playerFrac !== undefined ? { playerFrac } : {}),
            ...(octopusFrac !== undefined ? { octopusFrac } : {}),
          }
        : undefined
    /**
     * **玩家亲手击沉的留档**（**2026-09-27 船长令**：「和入侵结束的报告一样，留档玩家的旗舰战记录」）：
     * `atWallMs` 必须是有限正数，`waveIdx` 可缺省；缺/坏 ⇒ 整块丢（不留半份）。
     */
    const killRaw = asRaw(w.flagshipPlayerKill)
    const killAt = weekendKeep(killRaw.atWallMs)
    const killWave = weekendKeep(killRaw.waveIdx)
    const flagshipPlayerKill =
      killAt !== undefined && killAt > 0
        ? { atWallMs: killAt, ...(killWave !== undefined && killWave >= 0 ? { waveIdx: killWave } : {}) }
        : undefined
    const outcome =
      w.flagshipOutcome === 'player' || w.flagshipOutcome === 'octopus' ? w.flagshipOutcome : 'window'
    const tierRaw = w.tier
    const tier: 'A' | 'B' | 'C' | 'D' | 'none' =
      tierRaw === 'A' || tierRaw === 'B' || tierRaw === 'C' || tierRaw === 'D' ? tierRaw : 'none'
    const wreckItemId = typeof w.wreckItemId === 'string' && w.wreckItemId.length > 0 ? w.wreckItemId : undefined
    /**
     * **本场那一枚黑匣是哪一件**（**2026-10-02 船长令「甲」**，按族：`blackbox-h` / `blackbox-r`）——
     * 结算面板与结算信读它点物品名。判据 = core 单点 `isBlackboxItem`（**按 id 前缀**）：
     * 只收登记在册的黑匣 id，手改档塞进来的字符串一律丢弃（否则面板会把原文当物品名印出来）；
     * 缺省（老快照 / 判据不过）= 本批之前的场次 ⇒ 界面按落款墨潮匣显示，与玩家当时到手的一致。
     */
    const blackBoxItemId =
      typeof w.blackBoxItemId === 'string' && isBlackboxItem(w.blackBoxItemId) ? w.blackBoxItemId : undefined
    /**
     * **进度收入那一栏**（2026-09-25 船长令「按进度获取收入」）：
     * `progressPct` = 玩家投入进度合计（可 >1，多星系求和 ⇒ 不 clamp01）；
     * `progressIsk` = 该笔收入（≥0 的有限数）。两个都缺 = 老快照（本批之前结束的活动）⇒ 界面不显示该行。
     */
    const progressPct = num(w.progressPct)
    const progressIsk = count(w.progressIsk)
    /**
     * **本期入侵获得的协会声望**（**2026-09-26 船长令**：结算界面与结束通讯都要写明）。
     * 取 ≥0 的有限整数；缺省（老快照）= 不写该字段 ⇒ 界面与通讯按"没有这一栏"处理。
     */
    const standingGain = count(w.standing)
    return {
      seq,
      family,
      coreId,
      endedAtWallMs: endedAt,
      flagshipOutcome: outcome,
      share: clamp01(w.share),
      tier,
      galaxies,
      ...(flagship !== undefined ? { flagship } : {}),
      ...(flagshipPlayerKill !== undefined ? { flagshipPlayerKill } : {}),
      ...(Number.isFinite(progressPct) ? { progressPct: Math.max(0, progressPct) } : {}),
      ...(progressIsk > 0 ? { progressIsk } : {}),
      ...(standingGain > 0 ? { standing: standingGain } : {}),
      isk: count(w.isk),
      wreck: count(w.wreck),
      blackBox: count(w.blackBox),
      ...(wreckItemId !== undefined ? { wreckItemId } : {}),
      ...(blackBoxItemId !== undefined ? { blackBoxItemId } : {}),
    }
  })()
  // --- 任务中心·时效任务板（v24 字段；老档/异常缺省 = 空板，首个市场窗口边界后引擎开刷） ---
  const cleanSideTaskList = (
    rawList: unknown,
    listKind: 'resource' | 'courier' | 'bounty' | 'faction',
  ): GameState['sideTasks']['resource'] => {
    const out: GameState['sideTasks']['resource'] = []
    if (!Array.isArray(rawList)) return out
    for (const item of rawList) {
      if (typeof item !== 'object' || item === null) continue
      const r = asRaw(item)
      const kind: SideTask['kind'] =
        r.kind === 'courier'
          ? 'courier'
          : r.kind === 'bounty'
            ? 'bounty'
            : r.kind === 'faction'
              ? 'faction'
              : 'resource'
      if (kind !== listKind) continue
      const id = Math.floor(num(r.id))
      const need = Math.floor(num(r.need))
      const rewardIsk = Math.floor(num(r.rewardIsk))
      const goodKey = typeof r.goodKey === 'string' ? r.goodKey : ''
      const refId = typeof r.refId === 'string' ? r.refId : ''
      if (!Number.isFinite(id) || id <= 0) continue
      // 资源/快递必须有物品与数量；赏金任务按目标悬赏+档位校验；派系活跃按目标星系校验（2026-09-10）
      if (kind === 'bounty') {
        const anomalyId = typeof r.anomalyId === 'string' ? r.anomalyId : ''
        const tier = Math.floor(num(r.lairTier))
        if (anomalyId.length === 0 || tier < 1 || tier > 3) continue
      } else if (kind === 'faction') {
        const anomalyId = typeof r.anomalyId === 'string' ? r.anomalyId : ''
        const galaxyId = typeof r.galaxyId === 'string' ? r.galaxyId : ''
        if (anomalyId.length === 0 || galaxyId.length === 0) continue
      } else {
        // 资源任务：必须有物品与数量。
        // **快递任务（2026-09-18 起虚拟货物）**：不绑商品 ⇒ 改判"所需货舱体积 > 0"；
        // 老档（真实货物时代的快递）仍按物品 + 数量接受（读档后照旧可出发）。
        const volume = Math.floor(num(r.volumeM3))
        const virtualCourier = kind === 'courier' && Number.isFinite(volume) && volume > 0
        if (virtualCourier) {
          // 虚拟货物快递：商品字段允许为空
        } else {
          if (goodKey.length === 0 || refId.length === 0) continue
          if (!Number.isFinite(need) || need <= 0) continue
        }
      }
      const task: GameState['sideTasks']['resource'][number] = {
        id,
        kind,
        goodKey,
        refId,
        need,
        rewardIsk: Number.isFinite(rewardIsk) ? Math.max(0, rewardIsk) : 0,
      }
      // 任务级别（2026-09-18：1~5；老档缺省按 1 读——不写键即 1）
      const lvRaw = Math.floor(num(r.level))
      if (Number.isFinite(lvRaw) && lvRaw >= 1 && lvRaw <= 5) task.level = lvRaw as 1 | 2 | 3 | 4 | 5
      // 快递·虚拟货物字段（体积 / 限时 / 跃迁门槛 / 时限）
      const volumeM3 = Math.floor(num(r.volumeM3))
      if (Number.isFinite(volumeM3) && volumeM3 > 0) task.volumeM3 = volumeM3
      if (r.timed === true) {
        task.timed = true
        const req = num(r.warpReqAus)
        if (Number.isFinite(req) && req > 0) task.warpReqAus = req
        const limit = Math.floor(num(r.timeLimitMs))
        if (Number.isFinite(limit) && limit > 0) task.timeLimitMs = limit
      }
      // 快递目标绑定（v24 兼容字段；缺省时出发按"最近已建成副站"兜底解析）
      const stationId = typeof r.stationId === 'string' && r.stationId.length > 0 ? r.stationId : ''
      const galaxyId = typeof r.galaxyId === 'string' && r.galaxyId.length > 0 ? r.galaxyId : ''
      if (stationId.length > 0) task.stationId = stationId
      if (galaxyId.length > 0) task.galaxyId = galaxyId
      if (kind === 'bounty') {
        task.anomalyId = typeof r.anomalyId === 'string' ? r.anomalyId : ''
        task.lairTier = Math.floor(num(r.lairTier)) as 1 | 2 | 3
        if (typeof r.lairName === 'string' && r.lairName.length > 0) task.lairName = r.lairName
      }
      if (kind === 'faction') {
        task.anomalyId = typeof r.anomalyId === 'string' ? r.anomalyId : ''
        if (typeof r.factionAnomalyName === 'string' && r.factionAnomalyName.length > 0) {
          task.factionAnomalyName = r.factionAnomalyName
        }
      }
      out.push(task)
    }
    return out
  }
  /**
   * 快递投送在途挂账（v24 兼容字段，无版本号变化；老档缺省 = null）。
   * **2026-09-18 起快递是虚拟货物**：`goodKey`/`refId` 可为空、`need` 可为 0，但必须有 `volumeM3 > 0`；
   * 老档的真实货物投送（goodKey + refId + need > 0）照旧接受。
   */
  const cleanCourierDeliver = (rawDeliver: unknown): GameState['sideTasks']['deliver'] => {
    if (rawDeliver === null || typeof rawDeliver !== 'object') return null
    const d = asRaw(rawDeliver)
    const taskId = Math.floor(num(d.taskId))
    const need = Math.floor(num(d.need))
    const arriveAt = Math.floor(num(d.arriveAtGameMs))
    const departAt = Math.floor(num(d.departAtGameMs))
    const rewardIsk = Math.floor(num(d.rewardIsk))
    const goodKey = typeof d.goodKey === 'string' ? d.goodKey : ''
    const refId = typeof d.refId === 'string' ? d.refId : ''
    const stationId = typeof d.stationId === 'string' ? d.stationId : ''
    const galaxyId = typeof d.galaxyId === 'string' ? d.galaxyId : ''
    const volumeM3 = Math.floor(num(d.volumeM3))
    const virtual = Number.isFinite(volumeM3) && volumeM3 > 0
    if (
      !Number.isFinite(taskId) || taskId <= 0 ||
      !Number.isFinite(arriveAt) || arriveAt < 0 ||
      stationId.length === 0 || galaxyId.length === 0 ||
      (virtual ? false : !(Number.isFinite(need) && need > 0 && goodKey.length > 0 && refId.length > 0))
    ) return null
    const out: NonNullable<GameState['sideTasks']['deliver']> = {
      taskId,
      goodKey,
      refId,
      need: Number.isFinite(need) && need > 0 ? need : 0,
      stationId,
      galaxyId,
      departAtGameMs: Number.isFinite(departAt) && departAt >= 0 ? departAt : 0,
      arriveAtGameMs: arriveAt,
      rewardIsk: Number.isFinite(rewardIsk) ? Math.max(0, rewardIsk) : 0,
    }
    if (virtual) out.volumeM3 = volumeM3
    const lvRaw = Math.floor(num(d.level))
    if (Number.isFinite(lvRaw) && lvRaw >= 1 && lvRaw <= 5) out.level = lvRaw as 1 | 2 | 3 | 4 | 5
    if (d.timed === true) {
      out.timed = true
      const dl = Math.floor(num(d.deadlineAtGameMs))
      if (Number.isFinite(dl) && dl >= 0) out.deadlineAtGameMs = dl
    }
    return out
  }
  const stRaw = asRaw(src.sideTasks)
  const sideTaskResource = cleanSideTaskList(stRaw.resource, 'resource')
  const sideTaskCourier = cleanSideTaskList(stRaw.courier, 'courier')
  const sideTaskBounty = cleanSideTaskList(stRaw.bounty, 'bounty') // 赏金任务（v24 兼容字段：老档缺省 = 空）
  // 派系活跃（v24 兼容字段：老档缺省 = null；单条，取列表解析的第一条）
  const sideTaskFaction = cleanSideTaskList(stRaw.faction === null || stRaw.faction === undefined ? [] : [stRaw.faction], 'faction')[0] ?? null
  /**
   * **已接单的快递**（2026-09-18 船长：「接取的快递任务不会被刷掉」）——整板刷新不清；
   * ⚠ **空表不写这个键**（老档与新档快照逐字一致，零迁移）。
   */
  const sideTaskAccepted = cleanSideTaskList(stRaw.accepted, 'courier')
  const stSeqRaw = Math.floor(num(stRaw.seq))
  let sideTaskSeq = Number.isFinite(stSeqRaw) ? Math.max(1, stSeqRaw) : 1
  // 分配器兜底：不能低于现存任务最大 id（防未来刷新撞号；正常档 seq ≥ 现存最大 id，天然不动）
  for (const t of [...sideTaskResource, ...sideTaskCourier, ...sideTaskBounty]) sideTaskSeq = Math.max(sideTaskSeq, t.id)
  const sideTaskWindow = Math.max(0, Math.floor(num(stRaw.window)))
  // 赏金日界（本地 0 点墙钟毫秒；v24 兼容字段：老档缺省 0 = 未开板，首次拿到有效墙钟即开板）
  const bountyWindowRaw = Math.floor(num(stRaw.bountyWindow))
  const sideTaskBountyWindow = Number.isFinite(bountyWindowRaw) && bountyWindowRaw > 0 ? bountyWindowRaw : 0
  /**
   * **派系活跃的换新界碑**（本地 12:00 墙钟毫秒；**2026-09-29 船长令**：活跃切换时间 24 时 → 12 时）。
   * 兼容字段（无版本号变化）：老档缺省 0 = 从未换过 ⇒ 首次拿到有效墙钟即按新口径补一次；
   * **0 时不写这个键**（老档与新档快照逐字一致，与下面的 `bountySeenWindow` 同款口径）。
   */
  const factionWindowRaw = Math.floor(num(stRaw.factionWindow))
  const sideTaskFactionWindow = Number.isFinite(factionWindowRaw) && factionWindowRaw > 0 ? factionWindowRaw : 0
  /**
   * 赏金**新板提示**的记账（2026-09-14 船长：「玩家进入后消除提示」）——玩家看过的日界墙钟毫秒。
   * 兼容字段：老档缺省 0 ⇒ 首帧徽标亮（船长同日定「老档默认亮起提示」）。
   */
  const bountySeenRaw = Math.floor(num(stRaw.bountySeenWindow))
  const sideTaskBountySeen = Number.isFinite(bountySeenRaw) && bountySeenRaw > 0 ? bountySeenRaw : 0
  const sideTasks = {
    seq: sideTaskSeq,
    window: sideTaskWindow,
    resource: sideTaskResource,
    courier: sideTaskCourier,
    bounty: sideTaskBounty,
    faction: sideTaskFaction,
    bountyWindow: sideTaskBountyWindow,
    /** 派系活跃的 12:00 界碑（2026-09-29）；⚠ 0 时不写（老档快照逐字一致，零迁移） */
    ...(sideTaskFactionWindow > 0 ? { factionWindow: sideTaskFactionWindow } : {}),
    /**
     * ⚠ **缺省（0 = 从没看过）不写这个键** —— 老档与新档的 `sideTasks` 快照因此**逐字一致**
     * （`t5b` / `save` 的 `toEqual` 钉着这一点，与 `escrowShips[].from` 同款口径）；
     * 玩家进过一次任务中心（记账写入真实日界）后才会出现这个键。
     */
    ...(sideTaskBountySeen > 0 ? { bountySeenWindow: sideTaskBountySeen } : {}),
    ...(sideTaskAccepted.length > 0 ? { accepted: sideTaskAccepted } : {}),
    deliver: cleanCourierDeliver(stRaw.deliver),
  }

  /**
   * 拾取堆（E 批）：每项 = `{ itemId, units }`；**坏项丢弃、空表 = `{}`（不写该字段）**。
   * 旧档 / 非拾取节点没有这个字段 ⇒ 归一化后依然没有 ⇒ 界面按"没有可捡的"渲染（零迁移）。
   */
  const cleanWormholePiles = (raw: unknown): { piles?: Array<{ itemId: string; units: number }> } => {
    if (!Array.isArray(raw)) return {}
    const out: Array<{ itemId: string; units: number }> = []
    for (const it of raw) {
      const row = asRaw(it)
      const itemId = typeof row.itemId === 'string' ? row.itemId : ''
      const units = Math.floor(num(row.units))
      if (itemId.length > 0 && units > 0) out.push({ itemId, units })
    }
    return out.length > 0 ? { piles: out } : {}
  }

  /**
   * **围剿者清洗**（2026-09-23 新机制）：`{ card: string; seq: number; cleared?: true }`。
   * 坏值（缺 card / card 为空 / seq 不是有限数）⇒ 整条丢弃；`cleared` 只在为真时写。
   */
  const cleanWormholeFoe = (raw: unknown): { card: string; seq: number; cleared?: true } | undefined => {
    const row = asRaw(raw)
    const card = typeof row.card === 'string' ? row.card : ''
    const seq = Math.floor(num(row.seq))
    if (card.length === 0 || !Number.isFinite(seq) || seq < 0) return undefined
    return { card, seq, ...(row.cleared === true ? { cleared: true as const } : {}) }
  }

  /**
   * **货仓格清洗**（F4 · 船长 2026-09-13：类似背包英雄的格管理）。
   * - 形状件逐个走 `cleanHoldPlacement`（坐标/尺寸越界或坏值 ⇒ 丢这一件）；
   * - **重叠的件丢弃**（后到的让位）——重叠是坏档，留着会让放置逻辑错乱；
   * - **越界（超出当前可用格）保留**：那正是"超载"态（沉船后格数变小），玩家要手动抛货；
   * - 老档没有 hold / 洗完为空 ⇒ 返回 undefined（= 不写字段，零迁移）。
   */
  const cleanWormholeHold = (raw: unknown): WormholeHoldState | undefined => {
    const h = asRaw(raw)
    if (raw === undefined || raw === null) return undefined
    const cols = Math.floor(num(h.cols))
    const list = Array.isArray(h.placements) ? h.placements : []
    const out: WormholeHoldState['placements'] = []
    const taken = new Set<string>()
    for (const it of list) {
      const p = cleanHoldPlacement(it)
      if (!p) continue
      // 横向越界（`x + w > cols`）在这两块板上都没有意义（货仓宽度固定、临时空间固定 4 列）⇒ 丢弃
      if (p.x + p.w > (cols >= 1 && cols <= 32 ? cols : WORMHOLE_HOLD_COLS)) continue
      const cells: string[] = []
      let clash = false
      for (let dy = 0; dy < p.h && !clash; dy++) {
        for (let dx = 0; dx < p.w; dx++) {
          const key = `${p.x + dx},${p.y + dy}`
          if (taken.has(key)) {
            clash = true
            break
          }
          cells.push(key)
        }
      }
      if (clash) continue
      for (const c of cells) taken.add(c)
      out.push(p)
    }
    return {
      cols: cols >= 1 && cols <= 32 ? cols : WORMHOLE_HOLD_COLS,
      placements: out,
    }
  }
  // --- 虫洞副本（v25 新字段）：整表容错 —— 结构不认识就当作"不在洞里"（不静默留半截状态）
  /**
   * 网格探索状态（F3a）：**老档没有 ⇒ 不写**（零迁移）；坏结构整块丢弃（该层退回旧口径）。
   *
   * ⚠ **半径上限与阶梯解耦**（2026-09-20 修 · 玩家报障「深入下一层后，显示本层没有网格」）：
   * 原写死 `radius <= 8`，那是"每 2 层 +1、封顶 R=4"时代的余量；阶梯改成"每层 +1 环、不封顶"
   * 之后 **层 8 起（R=9+）的盘被整块丢掉**（该层退回旧式线性地图）。现取 `WORMHOLE_GRID_SAVE_MAX_R`
   * （只防坏档，不参与玩法，改阶梯不必动它）。
   */
  const cleanWormholeGrid = (raw: unknown): WormholeGridState | undefined => {
    const g = asRaw(raw)
    const radius = Math.floor(num(g.radius))
    if (!(radius >= 1 && radius <= WORMHOLE_GRID_SAVE_MAX_R)) return undefined
    const cellsRaw = Array.isArray(g.cells) ? g.cells : []
    const cells: WormholeGridState['cells'] = []
    for (const it of cellsRaw) {
      const row = asRaw(it)
      const key = typeof row.key === 'string' ? row.key : ''
      const place = typeof row.place === 'string' ? row.place : ''
      if (key.length === 0 || place.length === 0) continue
      const placeOk =
        place === 'empty' || place === 'graveyard' || place === 'ruins' || place === 'ship' || place === 'vein' || place === 'matter' || place === 'beacon'
        ? (place as WormholeGridState['cells'][number]['place'])
        : undefined
      if (!placeOk) continue
      // 格上的战利品堆（F3b 打捞/挖矿往里放；形状与 `cleanPiles` 同一口径）
      const cellPiles = ((): { itemId: string; units: number }[] | undefined => {
        const pileRaw = Array.isArray(row.piles) ? row.piles : []
        const out: { itemId: string; units: number }[] = []
        for (const p of pileRaw) {
          const o = asRaw(p)
          const itemId = typeof o.itemId === 'string' ? o.itemId : ''
          const units = Math.floor(num(o.units))
          if (itemId.length > 0 && units > 0) out.push({ itemId, units })
        }
        return out.length > 0 ? out : undefined
      })()
      cells.push({
        key,
        q: Math.floor(num(row.q)),
        r: Math.floor(num(row.r)),
        place: placeOk,
        ...(cellPiles ? { piles: cellPiles } : {}),
        // 星云标记（船长 2026-09-13 星云机制）：只在为真时写（老档/非星云格 ⇒ 不写 = 零迁移）
        ...(row.nebula === true ? { nebula: true } : {}),
        /**
         * **围剿者**（2026-09-23 新机制 · 玩家报障级教训同款：本清洗器逐字段重建，漏登记 = 每读一次档丢一次）：
         * 坏值整条丢弃（宁可少一个围剿者，也不要读出半个坏对象）；`cleared` 只在为真时写。
         */
        ...(cleanWormholeFoe(row.foe) !== undefined ? { foe: cleanWormholeFoe(row.foe)! } : {}),
      })
    }
    if (cells.length === 0) return undefined
    const cell = (v: unknown): { q: number; r: number } | undefined => {
      const o = asRaw(v)
      return typeof o.q === 'number' || typeof o.r === 'number' ? { q: Math.floor(num(o.q)), r: Math.floor(num(o.r)) } : undefined
    }
    const start = cell(g.start)
    const exit = cell(g.exit)
    const pos = cell(g.pos)
    if (!start || !exit || !pos) return undefined
    const keys = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : []
    return {
      radius,
      start,
      exit,
      pos,
      scanRadius: Math.max(0, Math.floor(num(g.scanRadius)) || 1),
      scanned: keys(g.scanned),
      visited: keys(g.visited),
      activated: keys(g.activated),
      // 已结算「首捞掉落」的遗迹格（船长 2026-09-16「时间点改为遗迹第一次打捞」）：
      // 空数组不写（老档/没首捞过 ⇒ 零迁移）
      ...(keys(g.ruinsRolled).length > 0 ? { ruinsRolled: keys(g.ruinsRolled) } : {}),
      // 已驱散的星云格（船长 2026-09-13）：空数组不写（老档/没驱散过 ⇒ 零迁移）
      ...(keys(g.dispersed).length > 0 ? { dispersed: keys(g.dispersed) } : {}),
      // 「下一层入口已被漂浮信标标出」（F3a-3）：只在为真时写（老档/未标出 ⇒ 不写 = 零迁移）
      ...(g.exitKnown === true ? { exitKnown: true } : {}),
      /**
       * **本层已刷出的围剿者个数**（2026-09-23 新机制）：坏值/缺省 ⇒ 不写（老档 = 从第一个开始刷）。
       * ⚠ 与格上的 `foe` 是一对：漏登记任何一个，读档后不是"围剿者消失"就是"序号归零 ⇒ 随机流重来"。
       */
      ...(Math.floor(num(g.spawnSeq)) > 0 ? { spawnSeq: Math.floor(num(g.spawnSeq)) } : {}),
      cells,
    }
  }
  const cleanWormhole = (): GameState['wormhole'] => {
    const wRaw = asRaw(src.wormhole)
    const rRaw = asRaw(wRaw.run)
    /**
     * 本趟**有没有在途战斗**（清洗一次、下面两处共用：`attending` 的缺省判据 + `run.battle` 落档）。
     * 坏值 ⇒ `undefined` ⇒ 视为没有（与"战斗字段坏值 = 不在战斗中"同一口径）。
     */
    const battleInFlight = cleanBattle(rRaw.battle)
    const hasBattleInFlight = battleInFlight !== null
    const phaseRaw = rRaw.phase
    const phase: 'inside' | 'extracting' | null =
      phaseRaw === 'inside' || phaseRaw === 'extracting' ? phaseRaw : null
    const depth = Math.floor(num(rRaw.depth))
    const turnsLeft = Math.floor(num(rRaw.turnsLeft))
    const turnsTotal = Math.floor(num(rRaw.turnsTotal))
    const fleet = Array.isArray(rRaw.fleet) ? rRaw.fleet.filter((x): x is string => typeof x === 'string' && x.length > 0) : []
    const bagRaw = Array.isArray(rRaw.bag) ? rRaw.bag : []
    const bag: Array<{ itemId: string; units: number }> = []
    for (const it of bagRaw) {
      const row = asRaw(it)
      const itemId = typeof row.itemId === 'string' ? row.itemId : ''
      const units = Math.floor(num(row.units))
      if (itemId.length > 0 && units > 0) bag.push({ itemId, units })
    }
    const pn = asRaw(rRaw.pendingNode)
    const kindRaw = pn.kind
    const nodeKind: 'combat' | 'pickup' | 'event' | null =
      kindRaw === 'combat' || kindRaw === 'pickup' || kindRaw === 'event' ? kindRaw : null
    const run =
      phase !== null
        ? {
            phase,
            depth: depth > 0 ? depth : 1,
            nodeIndex: Math.max(0, Math.floor(num(rRaw.nodeIndex))),
            turnsLeft: Math.max(0, turnsLeft),
            turnsTotal: Math.max(0, turnsTotal),
            fleet,
            totalMass: Math.max(0, num(rRaw.totalMass)),
            bag,
            pendingNode:
              nodeKind === null
                ? null
                : {
                    kind: nodeKind,
                    waves: Math.max(0, Math.floor(num(pn.waves))),
                    pickups: Math.max(0, Math.floor(num(pn.pickups))),
                    ...(typeof pn.eventKey === 'string' && pn.eventKey.length > 0 ? { eventKey: pn.eventKey } : {}),
                    cost: Math.max(1, Math.floor(num(pn.cost))),
                    // 拾取堆（E 批）：坏项丢弃、空表不写（旧档/非拾取节点缺省 = 没有可捡的）
                    ...cleanWormholePiles(pn.piles),
                  },
            nodesPerLayer: Math.max(1, Math.floor(num(rRaw.nodesPerLayer)) || 2),
            /**
             * **人在洞里**（2026-09-13 · 议案 A）：活动位开关。
             *
             * 默认值分两种（**2026-09-21 修船长报障「进入虫洞战斗后双方不开火、也不移动改变距离」**）：
             * - **有在途战斗 ⇒ 缺省 `true`**：`battle` 非空就是"人在洞里"的证据，**不存在"战斗中且人已离开"
             *   的合理状态**（离开通道 `wormholeLeave` 只在面板「✕ 关闭」上，那条入口战斗中一律被拦）。
             * - 其余（没在途战斗）⇒ 旧档/坏值一律 `false`（安全侧：不占主控），**与改前逐字一致**。
             *
             * ⚠ **为什么必须补这一条**：本字段是 2026-09-13（提交 `d2d6f0cf`）才进存档格式的，
             * **迁移表 v24~v29 没有任何一级补过它** ⇒ 字段诞生前写下、且当时正在打洞内战斗的档，
             * 读进来 `attending` 变 `false`（`undefined === true`）。而 `advanceWormhole` 的第一道门就是
             * `if (run.attending !== true) return`（`wormhole.ts`），它又是**唯一**能推进 `run.battle` 的地方
             * ⇒ 战斗永久冻结：战斗时钟停在 0、双方一炮不发、距离一动不动，**且没有超时兜底、没有日志**。
             * 更糟的是 UI 侧同时被锁死：战斗在途 ⇒ 虫洞面板 `return null`（`Wormhole.tsx`）⇒
             * 「返回虫洞」的恢复入口根本不渲染 ⇒ 玩家点不回来。真档实测：读档后跑 10 秒，
             * `tick=0 / game=10000`、射击 `0/0`。
             *
             * 修法取"**缺省按有在途战斗判**"而不是写死 `true`：显式 `false`（玩家真离开过）照旧尊重，
             * 那一路由 `leftAtGameMs` + 返回时的战斗时钟前移负责，一行不动。
             */
            attending: rRaw.attending === true || hasBattleInFlight,
            // 网格探索（F3a）：老档/坏值 ⇒ 不写（该层走旧口径，零迁移）
            ...(cleanWormholeGrid(rRaw.grid) !== undefined ? { grid: cleanWormholeGrid(rRaw.grid) } : {}),
            // 临时离开时刻（回来时按它前移战斗时钟）：坏值/缺省 = 不写（= 没离开过）
            ...(Math.floor(num(rRaw.leftAtGameMs)) > 0 ? { leftAtGameMs: Math.floor(num(rRaw.leftAtGameMs)) } : {}),
            // 本趟期望交距偏好（洞内拖距离条选的；0/坏值不写）
            ...(num(rRaw.desireM) > 0 ? { desireM: Math.round(num(rRaw.desireM)) } : {}),
            // 本趟确定性种子（F3b：层内产出的生成按它散列；坏值/缺省 ⇒ 不写，退回全局种子）
            ...(Math.floor(num(rRaw.seed)) !== 0 ? { seed: Math.floor(num(rRaw.seed)) } : {}),
            /**
             * 本趟锁定的敌族 + 内容原型（丙/丁 · 2026-09-14）：坏值/缺省 ⇒ **不写**，
             * 消费侧按 `run.seed` 现算（`wormholeCardIdOfFamily` / 界面读数），零迁移。
             */
            ...(WORMHOLE_FAMILY_ORDER.includes(rRaw.family as WormholeFamily)
              ? { family: rRaw.family as WormholeFamily }
              : {}),
            ...(WORMHOLE_ARCHETYPES.includes(rRaw.archetype as WormholeArchetype)
              ? { archetype: rRaw.archetype as WormholeArchetype }
              : {}),
            // 随行战利品（遗迹专属掉落：图纸/装备；撤离成功才入库）：只留非空字符串
            ...(Array.isArray(rRaw.relics)
              ? (() => {
                  const list = rRaw.relics.filter((x): x is string => typeof x === 'string' && x.length > 0)
                  return list.length > 0 ? { relics: list } : {}
                })()
              : {}),
            // 进行中的洞内战斗（F 批）：整场按 `cleanBattle` 清洗（坏值 = 视为不在战斗中）
            ...(battleInFlight !== null ? { battle: battleInFlight } : {}),
            // 货仓格（F4）：形状件逐个清洗；坏件丢弃、**重叠的丢弃**（越界保留 ⇒ 那是"超载"态）
            ...(cleanWormholeHold(rRaw.hold) !== undefined ? { hold: cleanWormholeHold(rRaw.hold) } : {}),
            /**
             * **临时空间**（2026-09-13 船长：大件货先进临时空间让玩家协调）：
             * 一种物品一条，只留"id 非空 + 单位数为正"的条目；坏值丢条、空数组不写（零迁移）。
             * ⚠ **2026-09-14 起这是老档只读字段**（新的格子账本是 `tempGrid`）：读档后由
             * `wormholeNormalizeLegacyTemp` 一次性换算，换算完就清掉 ⇒ 新档里不会再出现。
             */
            ...(Array.isArray(rRaw.temp)
              ? (() => {
                  const list = rRaw.temp
                    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
                    .map((x) => ({ itemId: typeof x.itemId === 'string' ? x.itemId : '', units: Math.floor(num(x.units)) }))
                    .filter((x) => x.itemId.length > 0 && x.units > 0)
                  return list.length > 0 ? { temp: list } : {}
                })()
              : {}),
            /**
             * **临时空间的格子账本**（2026-09-14：4 列 × 8 行 = 32 格）：与 `hold` 同一套清洗
             * （坏件丢弃、重叠丢弃、越界保留）。**可选字段 ⇒ 零迁移**（老档没有 = 临时空间是空的）。
             */
            ...(cleanWormholeHold(rRaw.tempGrid) !== undefined ? { tempGrid: cleanWormholeHold(rRaw.tempGrid) } : {}),
            ...(Math.floor(num(rRaw.bossCleared)) > 0
              ? { bossCleared: Math.floor(num(rRaw.bossCleared)) }
              : {}),
            /**
             * **回合账本的两个锚**（2026-09-22 · 玩家报障「虫洞内玩家将谜质时序来回拖动会重复加回合」）。
             *
             * ⚠ 本清洗器是**逐字段重建**的，没登记在这里的字段**每读一次档就被丢一次**——
             * 与下面 `attending` 那条同一类事故（那个害得洞内战斗永久冻结）。
             * `turnsBase`（09-13 进格式）与 `turnsTechBonus`（09-19 进格式）都漏登记过：
             * 丢掉 `turnsBase` 之后，`wormholeSyncMatterTurns` 只能在**第一次同步的那一刻**现推基础预算，
             * 而那一刻玩家可能正好把「时序核心」拖到了临时空间（不在货仓）⇒ 推出来的基础预算凭空多 10 回合、
             * 且此后再拖回来又按"上限变大"再给一次 ⇒ **来回拖 = 白刷回合**。
             * 两个字段都按"是不是有限数"判（**0 也合法**：0 回合的趟存在），不用"大于 0"判。
             */
            ...(typeof rRaw.turnsBase === 'number' && Number.isFinite(rRaw.turnsBase)
              ? { turnsBase: Math.max(0, Math.round(rRaw.turnsBase)) }
              : {}),
            ...(typeof rRaw.turnsTechBonus === 'number' && Number.isFinite(rRaw.turnsTechBonus)
              ? { turnsTechBonus: Math.max(0, Math.round(rRaw.turnsTechBonus)) }
              : {}),
            /**
             * **已花掉的回合账本**（2026-09-23 进格式 · 玩家报障「0 回合拖动谜质时序还是能够刷回合数」）：
             * 漏登记 = 每读一次档就把"超支"信息丢一次 ⇒ 读档后再拖一次装置又能白刷回合
             * （与上面 `turnsBase/turnsTechBonus` 同一类事故，故按同一口径登记；0 也合法）。
             */
            ...(typeof rRaw.turnsSpent === 'number' && Number.isFinite(rRaw.turnsSpent)
              ? { turnsSpent: Math.max(0, Math.round(rRaw.turnsSpent)) }
              : {}),
          }
        : null
    /**
     * **最近一趟的结算单**（2026-09-13：撤离后弹结算界面用）：形状严格清洗，
     * 坏值整条丢弃（宁可少弹一次结算层，也不要读出半个坏对象）。**可选字段 ⇒ 零迁移**。
     */
    const settleRaw = asRaw(wRaw.lastSettle)
    const strList = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : []
    const lastSettle =
      settleRaw !== null &&
      typeof settleRaw === 'object' &&
      (settleRaw.kind === 'extract' || settleRaw.kind === 'lost')
        ? {
            kind: settleRaw.kind as 'extract' | 'lost',
            depth: Math.max(1, Math.floor(num(settleRaw.depth))),
            oreUnits: Math.max(0, Math.floor(num(settleRaw.oreUnits))),
            oreIsk: Math.max(0, num(settleRaw.oreIsk)),
            wreckIsk: Math.max(0, num(settleRaw.wreckIsk)),
            boxes: strList(settleRaw.boxes),
            relics: strList(settleRaw.relics),
            shipsLost: strList(settleRaw.shipsLost),
            lostIsk: Math.max(0, num(settleRaw.lostIsk)),
            ...(settleRaw.skippedExtractBattle === true ? { skippedExtractBattle: true } : {}),
          }
        : undefined
    return {
      run,
      lastFleetLost: Math.max(0, Math.floor(num(wRaw.lastFleetLost))),
      ...(lastSettle !== undefined ? { lastSettle } : {}),
      // 星云提示只提示一次（船长 2026-09-13）：只在为真时写（老档 ⇒ 不写 = 零迁移）
      ...(wRaw.nebulaHintShown === true ? { nebulaHintShown: true } : {}),
      // 围剿机制的一次性标记（2026-09-23 船长令：首次下到第 7 层发一封通讯）——漏登记 = 每读档补送一次
      ...(wRaw.siegeHintShown === true ? { siegeHintShown: true } : {}),
      /**
       * **洞内「禁止打捞普通残骸」开关**（**2026-10-02 船长令**；UI 落点 = 货仓页）。
       * 与上面两条同形：**只在为真时写** ⇒ 老档不写该字段 = 关（保持既有行为）⇒ **老档零迁移**。
       * ⚠ 漏登记 = 每次读档把玩家的开关**静默重置**（写盘侧是整份 `state` 序列化，不登记就丢）。
       */
      ...(wRaw.noCommonWreckSalvage === true ? { noCommonWreckSalvage: true } : {}),
    }
  }
  const wormhole = cleanWormhole()

  /**
   * **谜质科技树等级**（v29 · 2026-09-19 船长批）：只存"哪一项研究到了几级"。
   * 逐项清洗：键必须是字符串、值取**非负整数**（等级上限由节点表 `maxLevel` 在**研究时**把关；
   * 这里不查表 ⇒ 数据侧改 `maxLevel` 也不会让老档的等级被截断，读数只会按新上限显示）。
   */
  const researchRaw = asRaw(src.research)
  const techLevelsRaw = asRaw(researchRaw.levels)
  const techLevels: Record<string, number> = {}
  for (const [key, value] of Object.entries(techLevelsRaw)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue
    techLevels[key] = Math.floor(value)
  }
  const research: GameState['research'] = { levels: techLevels }

  /**
   * **成就徽章账本**（v30 · 2026-09-20 船长批）：只存"哪几枚到手了 ＋ 到手时刻"。
   * 逐项清洗（**不查表** ⇒ 数据侧改/删徽章表也不会让老档的账本被改写）：
   * - 新格式 `{ atGameMs, atWallMs }`：两个时刻各取**非负整数**，坏值归 0；
   * - ⚠ **兼容首版落盘的裸数字**（v30 首版 `earned[id] = gameMs` 是个 number）：
   *   当时没记墙钟 ⇒ `atWallMs` 补 0（界面按"未记录"处理，不写假时间）。
   */
  const achRaw = asRaw(src.achievements)
  const achEarnedRaw = asRaw(achRaw.earned)
  const achEarned: Record<string, AchievementEarned> = {}
  const atOf = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0
  for (const [key, value] of Object.entries(achEarnedRaw)) {
    if (typeof value === 'number') {
      achEarned[key] = { atGameMs: atOf(value), atWallMs: 0 }
      continue
    }
    if (typeof value !== 'object' || value === null) continue
    const rec = value as Record<string, unknown>
    achEarned[key] = { atGameMs: atOf(rec.atGameMs), atWallMs: atOf(rec.atWallMs) }
  }
  const achievements: GameState['achievements'] = { earned: achEarned }

  const normalized: GameState = {
    version: CURRENT_STATE_VERSION,
    gameMs:
      typeof src.gameMs === 'number' && Number.isFinite(src.gameMs) ? Math.max(0, Math.floor(src.gameMs)) : 0,
    savedAtWallMs:
      typeof src.savedAtWallMs === 'number' && Number.isFinite(src.savedAtWallMs) ? src.savedAtWallMs : 0,
    logCap,
    character,
    rng,
    skills: { trained, queue, savedProgress, licenses },
    wallet,
    shipId,
    fleet,
    warehouse: { items: warehouseItems },
    aiCores,
    aiAssignments: aiAssignments as GameState['aiAssignments'],
    shipReturns: shipReturns as GameState['shipReturns'],
    shipLocks: shipLocks as GameState['shipLocks'],
    marks,
    mining,
    moduleBay,
    learnedRecipes,
    spentOneTimeRecipes,
    recycleCarry,
    shipStore,
    // 装配方案（2026-09-14 · 兼容字段 ⇒ 老档没有就是「没有方案」）。
    // ⚠ **缺省不写键**（与 `sideTasks.bountySeenWindow` 同款口径）：无条件写空表会让老档往返
    //   多出一个键 ⇒ `toEqual` 快照用例红（踩过）；因此只在真有方案时才落这个字段。
    ...(Object.keys(fitPresets).length > 0 ? { fitPresets } : {}),
    blueprintStock,
    market,
    orders,
    escrowItems,
    escrowShips,
    manufacturingRuns,
    manufacturingSeq,
    manufacturingLoops,
    /** 实验室「循环实验」（2026-10-01）：读档**恒给出这张表**（空表也给出）⇒ 与 `createInitialState` 同形；
     *  写档那边空表不落键（老档不新增键）。 */
    labLoops,
    standings,
    // 累计获得声望（2026-09-26 船长令：门槛读它、兑换只扣可支配那本）——回填后恒非空 ⇒ 恒落键
    standingsEarned,
    // 见过黑匣没有（三态；缺省 = 老档 ⇒ 不落键，由 `blackbox.blackboxSeenOf` 回填）
    ...(blackboxSeen !== undefined ? { blackboxSeen } : {}),
    // 声望回正走过没有（单程标记；缺省不落键 ⇒ 与"还没走过"等价）
    ...(standingClawbackDone !== undefined ? { standingClawbackDone } : {}),
    // 入侵补偿批标记（2026-10-02 船长令；缺省不落键 ⇒ 老档形状不变）
    ...(weekendCompensation !== undefined ? { weekendCompensation } : {}),
    expedition,
    events,
    exploredGalaxies,
    scanning,
    scanProgress,
    // 虫洞扫描与库存（2026-09-14 · 可选字段 ⇒ 老档没有就是「没在扫、库存空」）
    wormholeScan,
    wormholeStock,
    wormholeAuto,
    wormholeAutoReports,
    // 限时促销领取记录（2026-09-16 · 可选字段 ⇒ 老档没有就是"还没领过"；空表不落键，保持老档形状）
    ...(Object.keys(promoClaimed).length > 0 ? { promoClaimed } : {}),
    debugQuick,
    completedBounties,
    awayGalaxy,
    transit,
    standby,
    hauling,
    refineRuns,
    refineSeq,
    salvaging,
    bountyCooldowns,
    autoLoopAnomalyId,
    autoLoopDroneFloor,
    /** 切活动停机标记：恒 `null`（有意不入档，见上面的归一说明）——写出来只为让"引擎写过的键"往返一致 */
    /** 切活动停机标记：**有意不入档**（瞬态信号）——但键**恒写出**（内容恒 null）⇒ 往返形状一致 */
    haltedBySwitch,
    pendingActivityReturn,
    // 2026-09-11 稀有残骸保底计数（船长定的机制；2026-09-20 起阈值 = 每 10 次必掉）：
    // 非负整数，缺省 0（老档从零攒）
    rareWreckDryStreak: Math.max(0, Math.floor(num(src.rareWreckDryStreak))),
    encounter,
    lowSecNotified,
    encounterZoneCooldown,
    lowSecPresence,
    stationSites,
    dockedSite,
    dialogueSeen,
    pendingDialogue,
    commsDelivered,
    commsPopups,
    commsRead,
    // 实例通讯（2026-09-25）：空表不写键（老档/新档快照逐字一致）
    ...(Object.keys(commsInstance).length > 0 ? { commsInstance } : {}),
    // 旗舰战参战编队（2026-09-25）：空数组不写键
    ...(weekendPrepSquad.length > 0 ? { weekendPrepSquad } : {}),
    // 上一场入侵的战果快照（2026-09-25）：没有就不写键（老档零迁移）
    ...(weekendLastResult !== undefined ? { weekendLastResult } : {}),
    // 因低安袭击自动撤离（true/false 都落键；缺失保持缺失 = 老档，交给触发器按痕迹判定）
    ...(ambushRetreatSeen !== undefined ? { ambushRetreatSeen } : {}),
    // 造出第一艘自造船（true/false 都落键；缺失保持缺失 = 老档，交给触发器按船长裁决「丙」补发）
    ...(firstShipBuilt !== undefined ? { firstShipBuilt } : {}),
    // 第一次进实验室（2026-09-30：true/false 都落键；缺失保持缺失 = 老档，按船长裁定「甲」也补发）
    ...(labOpened !== undefined ? { labOpened } : {}),
    ...(resupplyFromWarehouse !== undefined ? { resupplyFromWarehouse } : {}),
    /** 跃迁燃料开关 ＋ 实验室产线（2026-09-29 跃迁燃料批；空 ⇒ 不写键，老档零迁移） */
    ...(Object.keys(jumpFuel).length > 0 ? { jumpFuel } : {}),
    ...(labRuns.length > 0 ? { labRuns, labSeq } : {}),
    // 实验室「循环实验」卡片级配置（2026-10-01）：**空表不写键**（老档零迁移、往返逐字一致）
    ...(Object.keys(labLoops).length > 0 ? { labLoops } : {}),
    ...(skillBoostUntilMs > 0 ? { skillBoostUntilMs } : {}),
    ...(boostAutoRenew ? { boostAutoRenew: true } : {}),
    // 模式选择已完成（2026-09-24 船长令）：只在 true 时落键；漏了这行 ⇒ 每次读档都重弹模式选择框
    ...(modeChosen !== undefined ? { modeChosen } : {}),
    // 实战胜利记录（2026-09-24 船长令）：**空表不写键**（老档/新档快照逐字一致 = 真零迁移）
    ...(Object.keys(winRecord).length > 0 ? { winRecord } : {}),
    // 见过的敌方舰级（2026-09-16）：空表也落键，与 `commsDelivered` 同口径
    foeShipSeen,
    galaxyWrecks: galaxyWrecks as GameState['galaxyWrecks'],
    // 入侵残骸独立池（2026-09-25 兼容字段）：空表不落字段（老档与新档形态一致）
    ...(Object.keys(weekendWrecks).length > 0 ? { weekendWrecks } : {}),
    // 玩家舰船残骸（2026-09-26 兼容字段）：空表不落字段；有残骸时连游标一起落（"最新那具优先"靠它）
    ...(Object.keys(shipWrecks).length > 0 ? { shipWrecks, shipWreckSeq: num(src.shipWreckSeq) } : {}),
    ...(wreckLog.length > 0 ? { wreckLog, wreckLogSeq: num(src.wreckLogSeq) } : {}),
    rareOpenedUnits,
    rareBoxesOpened,
    rareBurnUnits,
    onboarding,
    importantTasks,
    // 「第一次」任务终身计数：**空表不写键**（老档与新档快照逐字一致 = 真零迁移）
    ...(Object.keys(firstStats).length > 0 ? { firstStats } : {}),
    // 导航「任务中心」推进提醒的记账：**没记过账就不写键**（同款零迁移口径）
    ...(firstTaskSeenId !== undefined ? { firstTaskSeenId } : {}),
    // 「已达成」播报记账 ＋ 老档一次性收口标记：同样只在有值时写键
    ...(firstTaskReadyId !== undefined ? { firstTaskReadyId } : {}),
    ...(firstTaskAutoClaim !== undefined ? { firstTaskAutoClaim } : {}),
    ironman,
    // 周末入侵活动：**只在"有入侵"时写键**（老档 / 无入侵 ⇒ 键不出现，读回 undefined）
    ...(weekendEvent !== undefined ? { weekendEvent } : {}),
    sideTasks,
    wormhole,
    research,
    achievements,
    logs,
  }
  // 玩家标记收尾：去重 + 剪掉已不在舰队的船（fleet 此时已建好）
  pruneMarks(normalized)
  return normalized
}

/** 保存：把状态序列化成 JSON 字符串（现在时间由调用方传入，测试可固定）。
 * 2026-09-08 船长定：**事件日志不落盘**——桌面引擎在 `persist()` / `currentSaveText()` 里
 * **先剥离 `state.logs`**（`apps/desktop/src/renderer/src/game/engine.ts`），故真实档里 `logs` 恒为空数组。
 *
 * ⚠ 本函数**保持通用**（测试/工具可序列化完整状态）——`tools/make-test-save.ts` 与
 * `tools/make-autoperf-save.ts` 直接用它，所以 `docs/test-saves/` 里的档**带日志**（实测有 1~300 条）。
 *
 * ⚠ **2026-09-20 三号更正**：此处原写「旧档中的 logs 由引擎载入后清空」，**与代码不符**——
 * 引擎的载入路径（启动 / 恢复备份 / 导入）都只做"不强制清空"，没有任何一处清空；读取端
 * `normalizeState` 也照旧解析 `logs`。实情：**载入后照原样带进内存并接续显示**，
 * 直到被 `persist()` 剥离（即"显示到本局结束"）。2026-09-08 之前的真实档确实带 logs
 * （实测 `docs/test-saves/user-backup-20260907-234825.json` 300 条）。
 * 单独修"导入外部档"那条：导入 = 换了一份档，已改为**不透传**旧日志（见引擎 `importSaveFromFile`）。 */
export function serializeSaveFile(state: GameState, nowWallMs: number = Date.now()): string {
  /**
   * **墙钟账只许前进、不许回退**（2026-09-25 修 · 与"调试快进"配套）：
   * `debugFastForward` 会把 `state.savedAtWallMs` 推到**未来**（它消费的正是那段未来时间），
   * 而写盘时若一律盖成 `Date.now()`，下次读档就把账**拽回现在** ⇒ ① 快进刚推进的入侵时间线又得重来一遍；
   * ② 再快进一次会把同一段未来时间**算两遍**（这一场瞬间被 NPC 铺底吞掉 ⇒ 板面恢复正常悬赏、遇袭不再触发）。
   * 取两者的较大者：正常在线恒等于 `nowWallMs`（行为逐字不变）；快进后保留未来值，离线结算见到负间隔即不动
   * （那段时间已经在快进里花掉了）。
   */
  const ledger = Number.isFinite(state.savedAtWallMs) ? state.savedAtWallMs : 0
  const stamp = Math.max(nowWallMs, ledger > 0 ? ledger : 0)
  return JSON.stringify({
    format: SAVE_FORMAT,
    version: state.version,
    savedAtWallMs: stamp,
    state,
  })
}

/** 读取：解析 + 校验 + 迁移 + 容错，返回可用的状态与"上次保存的墙钟时间" */
export function loadSaveFile(text: string): { state: GameState; savedAtWallMs: number } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (e) {
    throw new SaveError('PARSE', `存档文件不是合法 JSON：${(e as Error).message}`)
  }
  const file = asRaw(parsed)
  if (file.format !== SAVE_FORMAT) {
    throw new SaveError('FORMAT', `不是本游戏的存档（格式标识不符：${String(file.format)}）。`)
  }
  const fileVersion =
    typeof file.version === 'number' && Number.isFinite(file.version) ? Math.floor(file.version) : 0
  const savedAtWallMs =
    typeof file.savedAtWallMs === 'number' && Number.isFinite(file.savedAtWallMs) ? file.savedAtWallMs : 0

  // 版本迁移链：v 逐级升到当前版本
  let current = asRaw(file.state)
  let v = fileVersion
  // 过旧档：直接拒（不再尝试逐级迁移）——玩家侧由 engine 开新档并写日志，本错误串只进控制台
  if (v < MIN_MIGRATABLE_VERSION) {
    throw new SaveError('VERSION', `存档版本 v${v} 早于可迁移下限 v${MIN_MIGRATABLE_VERSION}：不再提供迁移脚本，请新开存档。`)
  }
  while (v < CURRENT_STATE_VERSION) {
    const migrate = MIGRATIONS[v]
    if (!migrate) {
      // 兜底：下限之内出现断代（正常不该发生）——与"过旧"同一码，便于工具/用例统一识别
      throw new SaveError('VERSION', `存档版本 v${v} 在可迁移区间内缺少迁移脚本（v${MIN_MIGRATABLE_VERSION}~v${CURRENT_STATE_VERSION}）。`)
    }
    current = asRaw(migrate(current))
    v += 1
  }
  if (v > CURRENT_STATE_VERSION) {
    throw new SaveError('VERSION', `存档版本 v${v} 高于当前支持的 v${CURRENT_STATE_VERSION}，请升级游戏。`)
  }

  const state = normalizeState(current)
  // 离线结算以文件头的保存时间为准（而不是状态内部字段，双保险）
  state.savedAtWallMs = savedAtWallMs
  return { state, savedAtWallMs }
}