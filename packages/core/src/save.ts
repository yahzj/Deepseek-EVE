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
import type { BattleFx, BattleState, GameState, GameStateV21, GameStateV22, GameStateV23, GameStateV24, LogEntry, LogKind, MarksState, SideTask, WormholeArchetype, WormholeFamily } from './state'
import { CHAIN_TIERS, CHAIN_TIERS_LEGACY_ORDERS, FIRST_TASKS } from './firstTasks'
import type { FittedModules, ModuleSlot, RackSlot } from './types'
import type { ShipFitPreset } from './state'
import type { WormholeGridState } from './wormholeGrid'
import { WORMHOLE_HOLD_COLS, cleanHoldPlacement } from './wormholeHold'
import { WORMHOLE_SCAN_BASE_MS, WORMHOLE_STOCK_MAX_HARD } from './wormholeScan'
import { WORMHOLE_AUTO_MAX_SHIPS, WORMHOLE_AUTO_REPORT_MAX } from './wormholeAuto'
import { WORMHOLE_ARCHETYPES, wormholeArchetypeOf } from './wormholeGrid'
import { WORMHOLE_FAMILY_ORDER, wormholeFamilyOfSeed } from './wormholeFoes'
import type { WormholeHoldState } from './wormholeHold'
import { emptyFitted, uidDefId } from './labels'
import { maxScanWindowMs } from './explore'
import { pruneMarks } from './marks'
import { FIT_PRESET_MAX, FIT_PRESET_NAME_MAX } from './fitPresets'
// v27→v28 残骸合并（2026-09-19）：旧"每卡一种"残骸 id → 新「族 × 地区」组 id
import { migratedWreckItemId } from './wreckGroups'

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

/** 合法的日志类型白名单 */
const LOG_KINDS: ReadonlySet<string> = new Set(['system', 'info', 'queue', 'levelup', 'warn', 'trade', 'event']) // ⚠ 新增日志类型**必须**同步这份白名单，否则读档会把该类型的行降级成 info

/** 迁移脚本的输入/输出：只保证"是个对象"，具体字段由每个迁移自己处理 */
type RawState = Record<string, unknown>

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
}
/** 字符串或 null 归一（迁移辅助） */
function asNullableString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/** 把未知值安全转成普通对象（非对象一律当空对象） */
function asRaw(value: unknown): RawState {
  return typeof value === 'object' && value !== null ? (value as RawState) : {}
}

/** V12：清洗战斗状态（只存动态量；字段损坏即整体弃置返回 null，引擎会在交火阶段重建） */
/**
 * **战斗字段持久化分类表**（2026-09-12 审计 A3）——`BattleState` 的**每一个字段**都必须在这里登记
 * 自己是"随档持久化"还是"运行态（有意不入档）"，**漏登记编译期就报错**（`satisfies` 要求键集
 * 与 `keyof BattleState` 完全一致）——代替此前那种"手抄一份白名单、加了字段忘了收录"的漂移方式
 * （2026-09-11 就漏过 `hullEscapeFrac`：保险字段没随档保留 ⇒ 战中重载凭空失效）。
 *
 * ⚠ **分类的判据**：**战中重载后引擎还要不要拿它续算**。要 ⇒ `persist`（清洗后原样带回）；
 * 只是表现层/短窗缓存、或本来就"重载即重置"的循环 ⇒ `runtime`，但**必须写明理由**。
 * ⚠ 载入侧只认登记表（`BATTLE_PERSIST_KEYS`）⇒ 新增字段若忘记分类，**typecheck 直接失败**。
 */
type BattleFieldSpec = { kind: 'persist' } | { kind: 'runtime'; why: string }

const BATTLE_FIELDS = {
  /* ── 随档持久化：战中重载必须原样续算 ── */
  startedAtGameMs: { kind: 'persist' },
  lastTickGameMs: { kind: 'persist' },
  distanceM: { kind: 'persist' },
  myDesireM: { kind: 'persist' },
  units: { kind: 'persist' },
  ammo: { kind: 'persist' },
  // F3c B2：开战预载量（谜质「弹药回收装置」战后按「预载 − 余额」算已耗）——随档，免得中途读档后加成失效
  ammoLoaded: { kind: 'persist' },
  ammoIds: { kind: 'persist' },
  stats: { kind: 'persist' },
  fx: { kind: 'persist' },
  // ⚠ **派生字段**：载入侧不读存档里的旧值，而是按清洗后的 fx 环尾部重算（`尾序号 + 1`），
  // 这样旧档（无 seq）也能续播；故"往返相等"对它不适用，用例单独断言派生式。
  fxSeq: { kind: 'persist' },
  ended: { kind: 'persist' },
  hullEscapeFrac: { kind: 'persist' },
  waveIdx: { kind: 'persist' },
  waveClearAt: { kind: 'persist' },
  autoEscaped: { kind: 'persist' },
  escapeReason: { kind: 'persist' },
  // **我方编队**（虫洞 D 批 · 2026-09-13）：**必须随档** —— 丢了会让战中重载的多舰战斗
  // 退化成单船（僚舰凭空消失、结算按 1 艘算），与 `hullEscapeFrac` 当年漏登记同类后果。
  myFleet: { kind: 'persist' },
  // **虫洞战斗标记**（虫洞 F 批 · 2026-09-13）：**必须随档** —— 逐拍按它重建派生敌卡；
  // 丢了会让战中重载的洞内战斗**退回原卡强度**（层数缩放消失，越深越弱的怪事）。
  wormhole: { kind: 'persist' },
  /* ── 2026-09-12 船长裁定（A3 盘点后「六项全修」）：以下七项由 runtime **改为随档** ──
   * 判据仍是"战中重载后引擎要不要续算"，只是这些原来漏了，而漏掉的后果是真缺陷： */
  repair: { kind: 'persist' }, // 维修装置快照 + **预载组件账本**（丢了 ⇒ 组件凭空消失、战后无从退回）
  shieldCharge: { kind: 'persist' }, // 护盾充能装置快照 + 30 秒脉冲计时（丢了 ⇒ 重载后计时重置 = 白赚一跳）
  // 2026-09-16 船长裁定「甲：逐舰维修」：逐舰账本（键 = 舰 tag）——同 `repair`/`shieldCharge` 的理由，
  // 且**必须随档**：漏了会让僚舰的预载组件与计时在战中重载后凭空消失（与 `myFleet` 漏登记的后果同类）。
  repairBy: { kind: 'persist' },
  shieldChargeBy: { kind: 'persist' },
  // 2026-09-16 船长：敌方后勤账本（每 5 秒一跳的计时 + 累计修复量）——**必须随档**：
  // 漏了会让战中重载后敌方修理计时重置（= 白赚一跳），与 `repair`/`shieldCharge` 同理。
  foeRepair: { kind: 'persist' },
  dronePools: { kind: 'persist' }, // 我方机群生存池（丢了 ⇒ 重载后无人机不再会被击落）
  foeDronePools: { kind: 'persist' }, // 敌机生存池（丢了 ⇒ 重载后敌方机群整支消失）
  droneLost: { kind: 'persist' }, // 本场已击落架数（丢了 ⇒ 可反复重载规避机群战损）
  droneLoadAtStart: { kind: 'persist' }, // 开战机群快照（丢了 ⇒ 战后"战损过半"判定失效）
  // 2026-09-14 船长「逐舰机群」：逐舰战损账本 + 逐舰开战快照（`舰tag → 机型 → 架数`）
  droneLostBy: { kind: 'persist' },
  droneLoadAtStartBy: { kind: 'persist' },
  foeDroneRangeBuff: { kind: 'persist' }, // E 族受击增程：一次触发、本场永久（丢了 ⇒ 机制静默重置）
  foeGunRangeBuff: { kind: 'persist' }, // D 族炮台受击增程：同上
  /* ── 运行态（有意不入档，逐条写明理由） ── */
  foeCharges: {
    kind: 'runtime',
    why: '敌冲锋循环（2026-09-14 起逐单位：在冲 / 冷却到某时刻）：落在"重载即重置循环"口径内（2026-09-10 起即如此，登记备查）',
  },
  foeChargeEnteredAtMs: { kind: 'runtime', why: '2026-09-11 已停用字段，只为不改存档形状而保留声明' },
  meSpeedMps: {
    kind: 'runtime',
    why: '双方战斗机动速度（2026-09-16 加）：逐拍重算，只给距离条两端显示 ⇒ 不入档',
  },
  foeSpeedMps: {
    kind: 'runtime',
    why: '同上（敌方那份）',
  },
  meWebDebuffs: {
    kind: 'runtime',
    why: '劫掠捕获网：我方被钉住的状态（2026-09-16 加）——运行期、随战斗结束即消，不入档',
  },
  foeWebFired: {
    kind: 'runtime',
    why: '劫掠捕获网：同一艘电子舰整场只发一次的账本（2026-09-16 加）——运行期',
  },
  meFoeRangeDebuff: {
    kind: 'runtime',
    why: '电子舰压制敌舰射程的削减率（2026-09-18 加）——由编队现算、建档与每拍各重算一次，不入档（读档后自动重建）',
  },
  foeMounts: {
    kind: 'runtime',
    why: '敌方挂载件名清单（2026-09-16 加）：只给战报/悬停渲染；战中重载即由 seedUnit 重建 ⇒ 不入档',
  },
  meVolleyDmg: {
    kind: 'runtime',
    why: '我方"不被一击带走"保险的逐拍承伤账本（船长 2026-09-16）：跨拍即重置，重载即清空 ⇒ 不入档',
  },
  droneHitAt: { kind: 'runtime', why: '反应式防空的最近受击时刻：短窗缓存，超窗即脱锁' },
  // 2026-09-16 近防炮逐舰（船长「将缺少的一并实现」）：令牌与集火锁都按 `舰tag` 分账，
  // 与上面两条同款 —— 短窗运行态，重载即重置（设计即零迁移）。
  droneHitAtMeBy: { kind: 'runtime', why: '反应式防空令牌（我方逐舰）：短窗缓存，超窗即脱锁' },
  notices: { kind: 'runtime', why: '战斗画面提示条：纯表现层，限时自动消失、不留档' },
  pdCd: { kind: 'runtime', why: '近防炮调度冷却（当前波）：重载即重置为可开火' },
  pdFocus: { kind: 'runtime', why: '近防炮集火锁定：缺省 = 下一拍按优先级重选（2026-09-12 设计即零迁移）' },
  mePdFocus: { kind: 'runtime', why: '我方近防炮集火锁定（P-40）：同上，缺省 = 每拍按优先级重选（零迁移）' },
  mePdFocusBy: { kind: 'runtime', why: '我方近防炮集火锁定（2026-09-16 逐舰版，键 = 舰tag:武器下标）：同上' },
  mePdAnsweredBy: {
    kind: 'runtime',
    why: '近防炮逐门"这次挨打已还过手"记账（2026-09-17 修复：多门近防炮只有一门开火）：跨拍缓存，超窗即失效',
  },
  // 洞内战斗倍速（2026-09-19 谜质科技「时间压缩矩阵」）：两者都是**每拍现算**的展示/口径字段，
  // 落档反而会"把离线前的倍速带到读档后" ⇒ 一律 runtime；老档缺省 = 1× / 老口径（零迁移）。
  speedX: { kind: 'runtime', why: '本场生效倍速：由前台心跳每拍传入并夹紧，不落档（离线结算恒 1×）' },
  speedAxis: { kind: 'runtime', why: '倍速时间轴锚点（全局时钟 ↔ 战斗时钟配对）：每拍收尾刷新，落档无意义' },
} satisfies Record<keyof BattleState, BattleFieldSpec>

/** **必须随档持久化**的战斗字段键（用例据此逐字段守"重载不丢"；顺序 = 登记表顺序） */
export const BATTLE_PERSIST_KEYS: ReadonlyArray<keyof BattleState> = Object.entries(BATTLE_FIELDS)
  .filter(([, spec]) => spec.kind === 'persist')
  .map(([key]) => key as keyof BattleState)

function cleanBattle(raw: unknown): BattleState | null {
  const b = asRaw(raw)
  const numf = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback
  const numi = (v: unknown, fallback: number): number => Math.max(0, Math.floor(numf(v, fallback)))
  const distance = numf(b.distanceM, NaN)
  if (!Number.isFinite(distance) || distance <= 0) return null
  const unitsRaw = b.units
  const units: Record<string, BattleState['units'][string]> = {}
  if (unitsRaw !== null && typeof unitsRaw === 'object') {
    for (const [tag, uRaw] of Object.entries(unitsRaw as RawState)) {
      if (!tag) continue
      const u = asRaw(uRaw)
      const side = u.side === 'me' || u.side === 'foe' ? u.side : null
      if (!side) continue
      const hpRaw = asRaw(u.hp)
      const weaponsRaw = u.weapons
      const weapons: number[] = []
      if (Array.isArray(weaponsRaw)) {
        for (const cd of weaponsRaw) {
          if (typeof cd === 'number' && Number.isFinite(cd)) weapons.push(Math.max(0, cd))
        }
      }
      if (weapons.length === 0) weapons.push(0)
      const hpMaxRaw = asRaw(u.hpMax)
      const hpMaxOk =
        hpMaxRaw !== null &&
        typeof hpMaxRaw === 'object' &&
        typeof (hpMaxRaw as RawState).s === 'number' &&
        Number.isFinite((hpMaxRaw as RawState).s) &&
        typeof (hpMaxRaw as RawState).a === 'number' &&
        Number.isFinite((hpMaxRaw as RawState).a) &&
        typeof (hpMaxRaw as RawState).h === 'number' &&
        Number.isFinite((hpMaxRaw as RawState).h)
      units[tag] = {
        tag,
        side,
        name: typeof u.name === 'string' && u.name.length > 0 ? u.name : tag,
        hp: {
          s: Math.max(0, numf(hpRaw.s, 0)),
          a: Math.max(0, numf(hpRaw.a, 0)),
          h: Math.max(0, numf(hpRaw.h, 0)),
        },
        ...(hpMaxOk
          ? {
              hpMax: {
                s: Math.max(0, (hpMaxRaw as RawState).s as number),
                a: Math.max(0, (hpMaxRaw as RawState).a as number),
                h: Math.max(0, (hpMaxRaw as RawState).h as number),
              },
            }
          : {}),
        weapons,
        // **入场时刻**（船长 2026-09-14「动画没结束不开火」）：**随档**——战斗时钟 `lastTickGameMs`
        // 也随档 ⇒ 在读入后 `lastTickGameMs − enteredAtMs` 依旧正确（窗口不会因重载而重启或消失）。
        // 老档/无入场动画的单位本字段缺失 ⇒ 视为"窗口已过"（恒可交战，零迁移）。
        ...(typeof u.enteredAtMs === 'number' && Number.isFinite(u.enteredAtMs)
          ? { enteredAtMs: numf(u.enteredAtMs, 0) }
          : {}),
        // **隐秘行动装置的隐身窗口**（2026-09-15 船长）：同样**随档**——窗口是战斗时钟上的一个
        // 截止时刻，而 `lastTickGameMs` 也随档 ⇒ 读档后窗口不会重启、也不会凭空消失。
        // 老档/未装装置的单位缺本字段 ⇒ 恒可被选中（零迁移）。
        ...(typeof u.stealthUntilMs === 'number' && Number.isFinite(u.stealthUntilMs)
          ? { stealthUntilMs: numf(u.stealthUntilMs, 0) }
          : {}),
      }
    }
  }
  if (Object.keys(units).length === 0) return null
  const ammoRaw = asRaw(b.ammo)
  const statsRaw = asRaw(b.stats)
  const endedRaw = b.ended
  const fx = cleanFx(b.fx, numf)
  // 清洗后的候选值——**只有登记为 `persist` 的字段会被带出**（见 `BATTLE_FIELDS`）
  // 2026-09-12 船长裁定「六项全修」：下面七项**改为随档**，故先清洗成候选值
  const repair = cleanRepair(b.repair)
  const shieldCharge = cleanShieldCharge(b.shieldCharge)
  /** 逐舰账本（2026-09-16 逐舰维修）：键 = 舰 tag；坏项丢键、整表空 ⇒ undefined（零迁移） */
  const repairBy = cleanLedgerMap(b.repairBy, cleanRepair)
  /**
   * **敌方后勤账本**（2026-09-16 船长）：`{ nextPulseAtMs, pulses, healed }`——整块缺/坏 ⇒ undefined
   * （零迁移：老档在途战斗本来就没有敌方后勤舰）。`pulses`/`healed` 取有限非负整数，`nextPulseAtMs` 可缺省。
   */
  const foeRepair = (() => {
    const r = asRaw(b.foeRepair)
    if (Object.keys(r).length === 0) return undefined
    const next = numf(r.nextPulseAtMs, 0)
    const out: NonNullable<import('./state').BattleState['foeRepair']> = {
      pulses: Math.max(0, Math.floor(numf(r.pulses, 0))),
      healed: Math.max(0, numf(r.healed, 0)),
    }
    if (next > 0) out.nextPulseAtMs = Math.floor(next)
    return out
  })()
  const shieldChargeBy = cleanLedgerMap(b.shieldChargeBy, cleanShieldCharge)
  const dronePools = cleanDronePools(b.dronePools)
  const foeDronePools = cleanFoeDronePools(b.foeDronePools)
  const droneLost = cleanCountMap(b.droneLost)
  const droneLoadAtStart = cleanCountMap(b.droneLoadAtStart)
  /** 逐舰账本（键 = 舰 tag；值是 `机型 → 架数`）：2026-09-14「逐舰机群」新增，老档没有 ⇒ undefined */
  const droneLostBy = cleanCountMapBy(b.droneLostBy)
  const droneLoadAtStartBy = cleanCountMapBy(b.droneLoadAtStartBy)
  const foeDroneRangeBuff = cleanPosNum(b.foeDroneRangeBuff)
  const foeGunRangeBuff = cleanPosNum(b.foeGunRangeBuff)
  const cleaned: Partial<Record<keyof BattleState, unknown>> = {
    startedAtGameMs: Math.max(0, Math.floor(numf(b.startedAtGameMs, 0))),
    lastTickGameMs: Math.max(0, Math.floor(numf(b.lastTickGameMs, 0))),
    distanceM: Math.max(0, distance),
    myDesireM: Math.max(0, numf(b.myDesireM, distance)),
    units,
    ammo: {
      kin: numi(ammoRaw.kin, 0),
      exp: numi(ammoRaw.exp, 0),
      pla: numi(ammoRaw.pla, 0),
    },
    /**
     * **开战预载量**（F3c B2 · 谜质「弹药回收装置」）：只认"三个都是有限非负数"，
     * 缺字段 / 坏值 ⇒ **不写**（读取端在没有它时自动跳过这一项加成，不会把负数退成刷弹）。
     */
    ...(() => {
      const raw = asRaw(b.ammoLoaded)
      const ok =
        typeof raw.kin === 'number' &&
        Number.isFinite(raw.kin) &&
        typeof raw.exp === 'number' &&
        Number.isFinite(raw.exp) &&
        typeof raw.pla === 'number' &&
        Number.isFinite(raw.pla)
      return ok
        ? { ammoLoaded: { kin: Math.max(0, Math.floor(raw.kin as number)), exp: Math.max(0, Math.floor(raw.exp as number)), pla: Math.max(0, Math.floor(raw.pla as number)) } }
        : {}
    })(),
    stats: {
      meShots: numi(statsRaw.meShots, 0),
      meHits: numi(statsRaw.meHits, 0),
      meDmg: Math.max(0, numf(statsRaw.meDmg, 0)),
      foeShots: numi(statsRaw.foeShots, 0),
      foeHits: numi(statsRaw.foeHits, 0),
    },
    fx,
    // 序号续发：以清洗后尾部序号 +1 为基准（旧档无 seq 字段时按序重排，见 cleanFx）
    fxSeq: fx.length > 0 ? fx[fx.length - 1]!.seq + 1 : 0,
    ended: endedRaw === 'me' || endedRaw === 'foe' ? endedRaw : null,
    // 连续作战保险（2026-09-11：由"白名单未收录"改为**随档保留**）——悬赏巡回场次与低安遭遇战都挂它，
    // 战中重载若丢掉这三项，保险会凭空失效（该撤退的场次会继续打到弃船），与"承伤持久化"同一口径。
    ...(typeof b.hullEscapeFrac === 'number' && Number.isFinite(b.hullEscapeFrac)
      ? { hullEscapeFrac: b.hullEscapeFrac }
      : {}),
    ...(b.autoEscaped === true ? { autoEscaped: true } : {}),
    // 2026-09-12：`'cannot-engage'` 也随档（原先只认 'hull' | 'timeout' ⇒ 无法交战脱战的场次重载后
    // 会退化成"结构撤退"口径，战报与结算措辞都不对）
    ...(b.escapeReason === 'hull' || b.escapeReason === 'timeout' || b.escapeReason === 'cannot-engage'
      ? { escapeReason: b.escapeReason }
      : {}),
    waveIdx:
      typeof b.waveIdx === 'number' && Number.isFinite(b.waveIdx) && b.waveIdx > 0
        ? Math.floor(b.waveIdx)
        : undefined,
    waveClearAt:
      typeof b.waveClearAt === 'number' && Number.isFinite(b.waveClearAt) && b.waveClearAt > 0
        ? b.waveClearAt
        : undefined,
    // 弹药 MK2（2026-09-09）：本场实装弹 id（键 = 伤害类型；坏值丢键，零迁移）
    ammoIds: cleanAmmoIdMap(b.ammoIds),
    // 我方编队（虫洞 D 批）：坏项丢弃、空表 = 不写（= 单船路径，零迁移）
    myFleet: cleanMyFleet(b.myFleet),
    // 虫洞战斗标记（虫洞 F 批）：坏值丢弃（= 退回原卡强度），零迁移
    wormhole: cleanBattleWormhole(b.wormhole),
    // ── 2026-09-12 船长裁定七项（随档）──
    ...(repair !== undefined ? { repair } : {}),
  ...(shieldCharge !== undefined ? { shieldCharge } : {}),
    // ── 2026-09-16 逐舰维修（船长裁定「甲」）：逐舰账本同样**必须随档**（丢了 ⇒ 僚舰的组件凭空消失）──
    ...(repairBy !== undefined ? { repairBy } : {}),
    ...(shieldChargeBy !== undefined ? { shieldChargeBy } : {}),
    // 2026-09-16 敌方后勤账本（丢了 ⇒ 战中重载后敌方修理计时重置）
    ...(foeRepair !== undefined ? { foeRepair } : {}),
    ...(dronePools !== undefined ? { dronePools } : {}),
    ...(foeDronePools !== undefined ? { foeDronePools } : {}),
    ...(droneLost !== undefined ? { droneLost } : {}),
    ...(droneLoadAtStart !== undefined ? { droneLoadAtStart } : {}),
    ...(droneLostBy !== undefined ? { droneLostBy } : {}),
    ...(droneLoadAtStartBy !== undefined ? { droneLoadAtStartBy } : {}),
    ...(foeDroneRangeBuff !== undefined ? { foeDroneRangeBuff } : {}),
    ...(foeGunRangeBuff !== undefined ? { foeGunRangeBuff } : {}),
  }
  // 组装：**只带走登记为 persist 的字段**（漏登记的字段在 typecheck 就会被拦下，见 BATTLE_FIELDS）
  const out: Partial<BattleState> = {}
  for (const key of BATTLE_PERSIST_KEYS) {
    const v = cleaned[key]
    if (v !== undefined) (out as Record<string, unknown>)[key as string] = v
  }
  return out as BattleState
}

/* ── 战斗字段清洗小工具（2026-09-12 船长裁定七项改随档时补；均为"坏值丢弃、不崩、零迁移"口径）── */

/** 非负有限数（坏值 = undefined，调用方决定丢弃或兜底） */
function cleanPosNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined
}

/** 「字符串 → 架数/枚数」计数表（键非空、值为 ≥0 整数；坏项丢键；空表 = undefined） */
function cleanCountMap(raw: unknown): Record<string, number> | undefined {
  const r = asRaw(raw)
  let out: Record<string, number> | undefined
  for (const [k, v] of Object.entries(r)) {
    if (!k) continue
    const n = cleanPosNum(v)
    if (n === undefined) continue
    if (!out) out = {}
    out[k] = Math.floor(n)
  }
  return out
}

/**
 * 我方编队（虫洞 D 批）：`Array<{ tag, shipId }>`——坏项丢弃、同 tag 去重、空表 = undefined
 * （= 不写字段 = 单船路径，旧档零迁移）。首条恒为主控（`tag = 'player'`），但**不强制**：
 * 引擎按 tag 认单位，写死了反而会在数据坏掉时整场弃置（宁可少带一艘僚舰也别丢掉整场战斗）。
 */
function cleanMyFleet(raw: unknown): BattleState['myFleet'] | undefined {
  if (!Array.isArray(raw)) return undefined
  const seen = new Set<string>()
  const out: NonNullable<BattleState['myFleet']> = []
  for (const item of raw) {
    const e = asRaw(item)
    const tag = typeof e.tag === 'string' && e.tag.length > 0 ? e.tag : null
    const shipId = typeof e.shipId === 'string' && e.shipId.length > 0 ? e.shipId : null
    if (!tag || !shipId || seen.has(tag)) continue
    seen.add(tag)
    out.push({ tag, shipId })
  }
  return out.length > 0 ? out : undefined
}

/**
 * **虫洞战斗标记**（F 批）：`{ cardId, depth, kind, waves }` —— 坏值一律丢弃
 * （丢了只会退回"原卡强度"，不会崩；`kind` 白名单外 / `cardId` 空 ⇒ 丢弃）。
 */
function cleanBattleWormhole(raw: unknown): BattleState['wormhole'] | undefined {
  const w = asRaw(raw)
  const cardId = typeof w.cardId === 'string' && w.cardId.length > 0 ? w.cardId : null
  const kind =
    w.kind === 'node' || w.kind === 'boss' || w.kind === 'extract' || w.kind === 'ruins' ? w.kind : null
  const depth = cleanPosNum(w.depth)
  const waves = cleanPosNum(w.waves)
  if (!cardId || !kind || depth === undefined || waves === undefined) return undefined
  return {
    cardId,
    kind,
    depth: Math.max(1, Math.floor(depth)),
    waves: Math.max(1, Math.floor(waves)),
  }
}

/** **两层计数表**（`舰tag → (机型 id → 架数)`；2026-09-14「逐舰机群」）：
 *  逐层清洗，空的一律省掉（读不到该字段的老档 = undefined ⇒ 调用方按"只有主控那一份"回落）。 */
function cleanCountMapBy(raw: unknown): Record<string, Record<string, number>> | undefined {
  const r = asRaw(raw)
  let out: Record<string, Record<string, number>> | undefined
  for (const [k, v] of Object.entries(r)) {
    if (!k) continue
    const inner = cleanCountMap(v)
    if (!inner) continue
    if (!out) out = {}
    out[k] = inner
  }
  return out
}

/** 单架机群生存池条目（三层血齐备才收；机型/闪避/抗性/备用机字段按形状带过） */
function cleanDronePoolEntry(raw: unknown): NonNullable<BattleState['dronePools']>[number] | undefined {
  const e = asRaw(raw)
  const s = cleanPosNum(e.s)
  const a = cleanPosNum(e.a)
  const h = cleanPosNum(e.h)
  if (s === undefined || a === undefined || h === undefined) return undefined
  const artId = typeof e.artId === 'string' && e.artId.length > 0 ? e.artId : undefined
  /** 所属舰 tag（2026-09-14「逐舰机群」）：老档没有 ⇒ 由 `cleanDronePools` 按键回填 */
  const owner = typeof e.owner === 'string' && e.owner.length > 0 ? e.owner : undefined
  const readyAtMs = cleanPosNum(e.readyAtMs)
  const maxS = cleanPosNum(e.maxS)
  const maxA = cleanPosNum(e.maxA)
  const maxH = cleanPosNum(e.maxH)
  return {
    s,
    a,
    h,
    alive: e.alive === true,
    ...(artId !== undefined ? { artId } : {}),
    ...(owner !== undefined ? { owner } : {}),
    evasion: cleanPosNum(e.evasion) ?? 0,
    // 抗性表按形状带过（本工程自己的数据；形状坏了就丢弃 ⇒ 退化为"无抗性"，不会崩）
    ...(e.resists !== null && typeof e.resists === 'object'
      ? { resists: e.resists as NonNullable<BattleState['dronePools']>[number]['resists'] }
      : {}),
    ...(e.inHangar === true ? { inHangar: true } : {}),
    ...(readyAtMs !== undefined ? { readyAtMs } : {}),
    ...(maxS !== undefined ? { maxS } : {}),
    ...(maxA !== undefined ? { maxA } : {}),
    ...(maxH !== undefined ? { maxH } : {}),
  }
}

/** 我方机群生存池（键 = **`舰tag:武器下标`**；2026-09-14「逐舰机群」起逐舰。
 *  ⚠ **老档的键是纯数字**（下标，只有主控）⇒ 归一成 `player:<下标>`（零迁移、语义不变）；
 *  键形不认识的一律丢弃（脏档不能让它崩）。`owner` 一律以**键**为准回填。 */
function cleanDronePools(raw: unknown): BattleState['dronePools'] | undefined {
  const r = asRaw(raw)
  let out: NonNullable<BattleState['dronePools']> | undefined
  for (const [k, v] of Object.entries(r)) {
    const entry = cleanDronePoolEntry(v)
    if (!entry) continue
    let key: string
    if (/^\d+$/.test(k)) key = `${entry.owner && entry.owner !== 'player' ? entry.owner : 'player'}:${k}`
    else if (/^[A-Za-z][\w-]*:\d+$/.test(k)) key = k
    else continue
    const sep = key.indexOf(':')
    const wi = Number.parseInt(key.slice(sep + 1), 10)
    if (!Number.isFinite(wi) || wi < 0) continue
    if (!out) out = {}
    out[key] = { ...entry, owner: key.slice(0, sep) }
  }
  return out
}

/** 敌机机群生存池（键 = 敌单位 tag；值为"与该单位 drone 条目同序"的逐架池） */
function cleanFoeDronePools(raw: unknown): BattleState['foeDronePools'] | undefined {
  const r = asRaw(raw)
  let out: NonNullable<BattleState['foeDronePools']> | undefined
  for (const [tag, arrRaw] of Object.entries(r)) {
    if (!tag || !Array.isArray(arrRaw)) continue
    const arr: NonNullable<BattleState['foeDronePools']>[string] = []
    for (const one of arrRaw) {
      const entry = cleanDronePoolEntry(one)
      if (entry) arr.push(entry)
    }
    if (arr.length === 0) continue
    if (!out) out = {}
    out[tag] = arr
  }
  return out
}

/** 维修装置运行态（开战写入；**含预载组件账本**——丢了组件会凭空消失、战后无从退回） */
function cleanRepair(raw: unknown): BattleState['repair'] | undefined {
  const r = asRaw(raw)
  if (Object.keys(r).length === 0) return undefined
  const units: NonNullable<BattleState['repair']>['units'] = []
  if (Array.isArray(r.units)) {
    for (const u of r.units) {
      const it = asRaw(u)
      const moduleId = typeof it.moduleId === 'string' ? it.moduleId : ''
      const kitId = typeof it.kitId === 'string' ? it.kitId : ''
      if (!moduleId || !kitId) continue
      units.push({
        moduleId,
        kitId,
        ...(it.free === true ? { free: true } : {}),
        armorPerPulse: cleanPosNum(it.armorPerPulse) ?? 0,
        hullPerPulse: cleanPosNum(it.hullPerPulse) ?? 0,
        stopped: it.stopped === true,
      })
    }
  }
  const nextPulseAtMs = cleanPosNum(r.nextPulseAtMs)
  const kitsUsedByType = cleanCountMap(r.kitsUsedByType)
  return {
    units,
    kits: cleanCountMap(r.kits) ?? {},
    pulses: Math.floor(cleanPosNum(r.pulses) ?? 0),
    kitsUsed: Math.floor(cleanPosNum(r.kitsUsed) ?? 0),
    ...(nextPulseAtMs !== undefined ? { nextPulseAtMs } : {}),
    ...(kitsUsedByType !== undefined ? { kitsUsedByType } : {}),
  }
}

/**
 * 护盾充能装置运行态（开战写入；2026-09-14 船长新增件）。
 * 清洗口径与 `cleanRepair` 同款：坏值丢键、不崩、零迁移；**比例必须为正**否则视为无装置。
 */
function cleanShieldCharge(raw: unknown): BattleState['shieldCharge'] | undefined {
  const r = asRaw(raw)
  if (Object.keys(r).length === 0) return undefined
  const pctPerPulse = cleanPosNum(r.pctPerPulse)
  if (pctPerPulse === undefined || pctPerPulse <= 0) return undefined
  const nextPulseAtMs = cleanPosNum(r.nextPulseAtMs)
  return {
    pctPerPulse,
    pulses: Math.floor(cleanPosNum(r.pulses) ?? 0),
    ...(nextPulseAtMs !== undefined ? { nextPulseAtMs } : {}),
  }
}

/**
 * **逐舰账本清洗**（2026-09-16 逐舰维修）：键 = 战斗 tag（`player` / `ally-1`…），值走各自的单份清洗器。
 * 坏键/清洗失败的项**丢键**；整表为空 ⇒ `undefined`（不写字段 ⇒ 老读法退化成"只有主控那一份"）。
 */
function cleanLedgerMap<T>(
  raw: unknown,
  cleanOne: (v: unknown) => T | undefined,
): Record<string, T> | undefined {
  const r = asRaw(raw)
  let out: Record<string, T> | undefined
  for (const [tag, v] of Object.entries(r)) {
    if (tag.length === 0) continue
    const one = cleanOne(v)
    if (one === undefined) continue
    if (!out) out = {}
    out[tag] = one
  }
  return out
}

/** 弹药 id 映射清洗（弹药 MK2：kinetic/explosive/plasma 键下的非空字符串 id；坏值丢键） */
function cleanAmmoIdMap(raw: unknown): Partial<Record<'kinetic' | 'explosive' | 'plasma', string>> | undefined {
  const r = asRaw(raw)
  let out: Partial<Record<'kinetic' | 'explosive' | 'plasma', string>> | undefined
  for (const t of ['kinetic', 'explosive', 'plasma'] as const) {
    const v = r[t]
    if (typeof v === 'string' && v.length > 0) {
      if (!out) out = {}
      out[t] = v
    }
  }
  return out
}

/** 清洗战斗可视化事件环（白名单字段；坏事件丢弃，缺失给空）。seq 按环内顺序重排（旧档无 seq 也能续播） */
function cleanFx(raw: unknown, numf: (v: unknown, fallback: number) => number): BattleFx[] {
  const out: BattleFx[] = []
  if (!Array.isArray(raw)) return out
  for (const e of raw) {
    if (typeof e !== 'object' || e === null) continue
    const ev = e as RawState
    const side = ev.side === 'me' || ev.side === 'foe' ? ev.side : null
    const type =
      ev.type === 'kinetic' || ev.type === 'explosive' || ev.type === 'plasma' ? ev.type : null
    if (!side || !type) continue
    out.push({
      seq: out.length, // 按清洗后顺序重排（保序：环内 atMs 递增）
      atMs: Math.max(0, Math.floor(numf(ev.atMs, 0))),
      side,
      tag: typeof ev.tag === 'string' && ev.tag.length > 0 ? ev.tag : side === 'me' ? 'player' : 'foe-0',
      type,
      hit: ev.hit === true,
    })
  }
  if (out.length > 48) out.splice(0, out.length - 48)
  return out
}

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

  // --- 2026-09-10 玩家标记（收藏；v24 兼容字段，无版本号变化）：四类清单白名单重建 ---
  // 逐类只收非空字符串；去重与"舰船必须在舰队里"的剪枝由末尾 pruneMarks(normalized) 统一做
  // （那里 fleet 已建好）。老档缺 marks = 四类全空。
  const marks: MarksState = { goods: [], recipes: [], blueprints: [], ships: [] }
  const marksRaw = asRaw(src.marks)
  for (const kind of ['goods', 'recipes', 'blueprints', 'ships'] as const) {
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
        },
      }
    }
  }

  // --- T4 换船善后返航（v16.1 兼容字段）：字段非法则整条丢弃；已走时间封顶单程 ---
  const shipReturns: Record<string, { beltId: string | null; legMs: number; phaseAccMs: number; reason?: 'mining' | 'expedition' }> = {}
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
    const reason = r.reason === 'expedition' ? ('expedition' as const) : r.reason === 'mining' ? ('mining' as const) : undefined
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
   * 裁掉尾部空位、长度 ≤7（槽位上限）· 无人机只收正整数 · **全空方案丢弃**。
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
        for (const x of v.slice(0, 7)) out.push(typeof x === 'string' && x.length > 0 ? x : null)
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
  const orderList = (rawList: unknown): Array<{ price: number; qty: number; expiresAtGameMs: number }> => {
    const out: Array<{ price: number; qty: number; expiresAtGameMs: number }> = []
    if (!Array.isArray(rawList)) return out
    for (const item of rawList) {
      const o = asRaw(item)
      const qty = Math.floor(num(o.qty))
      const price = Math.floor(num(o.price))
      if (qty <= 0 || price <= 0) continue
      out.push({ price, qty, expiresAtGameMs: Math.max(0, Math.floor(num(o.expiresAtGameMs))) })
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
      logs.push({
        id: typeof e.id === 'number' && Number.isFinite(e.id) ? Math.floor(e.id) : ++fallbackId,
        atGameMs:
          typeof e.atGameMs === 'number' && Number.isFinite(e.atGameMs) ? Math.floor(e.atGameMs) : 0,
        kind,
        text: typeof e.text === 'string' ? e.text : '',
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
  const galaxyWrecks: Record<string, { density: number; rare: number; rareBy?: Record<string, number> }> = {}
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
    galaxyWrecks[galaxyId] = {
      density,
      rare: typeof rare === 'number' && Number.isFinite(rare) ? Math.max(0, Math.floor(rare)) : 0,
      ...(Object.keys(rareBy).length > 0 ? { rareBy } : {}),
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

  // --- 扫描续扫进度（v14）：星系 → 已完成的就地扫描窗口毫秒 ---
  // 上限 = **扫描窗口的合法上限**（`maxScanWindowMs()` = 基准窗口 × 低安最深惩罚 ×2.2 = 22 分钟）——
  // 2026-09-11 修复：原按基准 `SCAN_WINDOW_MS`（10 分钟）钳，而低安星系的有效窗口最长 22 分钟，
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
    const cores = Math.floor(num(o.coresReleased))
    wormholeAutoReports.push({
      id,
      stockId: typeof o.stockId === 'string' ? o.stockId : '',
      depth: Number.isFinite(depth) ? Math.min(9, Math.max(1, depth)) : 1,
      finishedAtGameMs: Number.isFinite(num(o.finishedAtGameMs)) ? Math.max(0, Math.floor(num(o.finishedAtGameMs))) : 0,
      shipIds,
      coresReleased: Number.isFinite(cores) && cores > 0 ? Math.min(WORMHOLE_AUTO_MAX_SHIPS, cores) : shipIds.length,
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
  /** 网格探索状态（F3a）：**老档没有 ⇒ 不写**（零迁移）；坏结构整块丢弃（该层退回旧口径） */
  const cleanWormholeGrid = (raw: unknown): WormholeGridState | undefined => {
    const g = asRaw(raw)
    const radius = Math.floor(num(g.radius))
    if (!(radius >= 1 && radius <= 8)) return undefined
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
      cells,
    }
  }
  const cleanWormhole = (): GameState['wormhole'] => {
    const wRaw = asRaw(src.wormhole)
    const rRaw = asRaw(wRaw.run)
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
            // **人在洞里**（2026-09-13 · 议案 A）：活动位开关。旧档/坏值 ⇒ false（安全侧：不占主控）
            attending: rRaw.attending === true,
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
            ...(cleanBattle(rRaw.battle) ? { battle: cleanBattle(rRaw.battle) } : {}),
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
   * 逐项清洗：键必须是字符串、值取**非负整数**（时刻）；**不查表** ⇒ 数据侧改/删徽章表
   * 也不会让老档的账本被改写（界面按表展示，账本里多余的键自然不显示）。
   */
  const achRaw = asRaw(src.achievements)
  const achEarnedRaw = asRaw(achRaw.earned)
  const achEarned: Record<string, number> = {}
  for (const [key, value] of Object.entries(achEarnedRaw)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue
    achEarned[key] = Math.floor(value)
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
    skills: { trained, queue, savedProgress },
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
    standings,
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
    // 2026-09-11 稀有残骸保底计数（船长「每 20 次必定掉」）：非负整数，缺省 0（老档从零攒）
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
    // 因低安袭击自动撤离（true/false 都落键；缺失保持缺失 = 老档，交给触发器按痕迹判定）
    ...(ambushRetreatSeen !== undefined ? { ambushRetreatSeen } : {}),
    // 造出第一艘自造船（true/false 都落键；缺失保持缺失 = 老档，交给触发器按船长裁决「丙」补发）
    ...(firstShipBuilt !== undefined ? { firstShipBuilt } : {}),
    // 见过的敌方舰级（2026-09-16）：空表也落键，与 `commsDelivered` 同口径
    foeShipSeen,
    galaxyWrecks: galaxyWrecks as GameState['galaxyWrecks'],
    rareOpenedUnits,
    rareBoxesOpened,
    rareBurnUnits,
    onboarding,
    importantTasks,
    // 「第一次」任务终身计数：**空表不写键**（老档与新档快照逐字一致 = 真零迁移）
    ...(Object.keys(firstStats).length > 0 ? { firstStats } : {}),
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
 * 2026-09-08 船长定：事件日志不落盘——桌面引擎调用前已剥离 state.logs（logs 仅作本局内存滚动），
 * 旧档中的 logs 由引擎载入后清空；本函数保持通用（测试/工具可直接序列化完整状态） */
export function serializeSaveFile(state: GameState, nowWallMs: number = Date.now()): string {
  return JSON.stringify({
    format: SAVE_FORMAT,
    version: state.version,
    savedAtWallMs: nowWallMs,
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
