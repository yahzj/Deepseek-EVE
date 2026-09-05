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
import type { BattleFx, BattleState, GameState, GameStateV18, LogEntry, LogKind } from './state'
import type { FittedModules, ModuleSlot, RackSlot } from './types'
import { emptyFitted, uidDefId } from './labels'
import { SCAN_WINDOW_MS } from './explore'

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
const LOG_KINDS: ReadonlySet<string> = new Set(['system', 'info', 'queue', 'levelup', 'warn', 'trade'])

/** 迁移脚本的输入/输出：只保证"是个对象"，具体字段由每个迁移自己处理 */
type RawState = Record<string, unknown>

/**
 * 版本迁移表：key = 旧版本号，value = 把该版本变成下一版本的函数。
 * 读取时从档里的版本一路迁移到 CURRENT_STATE_VERSION，每级迁移只负责自己该转的部分，
 * 缺的字段由后面的 normalizeState 兜底补默认值。
 */
const MIGRATIONS: Record<number, (raw: RawState) => RawState> = {
  /**
   * v0 → v1（开发早期草图）：
   * v0: { trained, queue: [{skill, level}] } → v1 的 skills 结构。
   */
  0: (raw) => {
    const trainedRaw = raw.trained
    const queueRaw = raw.queue
    const queue = Array.isArray(queueRaw)
      ? queueRaw
          .filter((q): q is Record<string, unknown> => typeof q === 'object' && q !== null)
          .map((q) => ({
            skillId: typeof q.skill === 'string' ? q.skill : String(q.skill ?? ''),
            targetLevel: typeof q.level === 'number' ? Math.floor(q.level) : 1,
            progressMs: 0,
          }))
      : []
    return {
      skills: {
        trained: typeof trainedRaw === 'object' && trainedRaw !== null ? trainedRaw : {},
        queue,
      },
    }
  },
  /**
   * v1 → v2（M1 采矿版本）：
   * v1 没有经济系统，迁移后自动获得初始资金与初始矿船、空货舱、停止状态。
   */
  1: (raw) => ({
    ...raw,
    wallet: { isk: DEFAULT_START_ISK },
    shipId: DEFAULT_START_SHIP_ID,
    inventory: { items: {} },
    mining: { active: false, beltId: null, cycleAccMs: 0, tripUnits: 0 },
  }),
  /**
   * v2 → v3（M2 制造版本）：
   * v2 没有制造系统，迁移后获得空装备库、空槽位、未购蓝图、无制造作业。
   */
  2: (raw) => ({
    ...raw,
    moduleBay: {},
    fitted: { miner: null, cargo: null },
    blueprints: [],
    manufacturing: { active: false, blueprintId: null, finishAtGameMs: 0, durationMs: 0 },
  }),
  /**
   * v3 → v4（M3 远征版本）：
   * v3 没有远征系统，迁移后获得空声望与停靠状态。
   */
  3: (raw) => ({
    ...raw,
    standings: {},
    expedition: { active: false, anomalyId: null, finishAtGameMs: 0, durationMs: 0, outMs: 0, combatMs: 0, power: 0 },
  }),
  /**
   * v4 → v5（M4 炮台版本）：
   * v4 的装配槽只有采集器/货舱，迁移后补一个空炮台槽。
   */
  4: (raw) => {
    const fittedRaw = asRaw(raw.fitted)
    return {
      ...raw,
      fitted: { miner: asNullableString(fittedRaw.miner), cargo: asNullableString(fittedRaw.cargo), turret: null },
    }
  },
  /**
   * v5 → v6（M5 船坞版本）：
   * v5 只有"当前船"概念，迁移后船坞 = [当前船]；远征状态补事件字段。
   */
  5: (raw) => {
    const shipId = typeof raw.shipId === 'string' && raw.shipId.length > 0 ? raw.shipId : DEFAULT_START_SHIP_ID
    const expRaw = asRaw(raw.expedition)
    return {
      ...raw,
      shipBay: [shipId],
      expedition: {
        active: expRaw.active === true,
        anomalyId: asNullableString(expRaw.anomalyId),
        finishAtGameMs: typeof expRaw.finishAtGameMs === 'number' && Number.isFinite(expRaw.finishAtGameMs) ? expRaw.finishAtGameMs : 0,
        durationMs: typeof expRaw.durationMs === 'number' && Number.isFinite(expRaw.durationMs) ? expRaw.durationMs : 0,
        outMs: typeof expRaw.outMs === 'number' && Number.isFinite(expRaw.outMs) ? expRaw.outMs : 0,
        combatMs: typeof expRaw.combatMs === 'number' && Number.isFinite(expRaw.combatMs) ? expRaw.combatMs : 0,
        power: typeof expRaw.power === 'number' && Number.isFinite(expRaw.power) ? expRaw.power : 0,
        eventId: null,
        eventFired: false,
      },
    }
  },
  /**
   * v6 → v7（舰队重构版）：
   * v6 的 inventory(货仓)/fitted(装备) 都属于"当前驾驶的船"，把它们迁移进该船的
   * fleet 条目（耐久 1、货仓原样、装备原样）；船坞里其余船各自获得空货仓与新船；
   * 物品仓库初始为空（v6 无仓库概念）；AI 核心 0 级。
   */
  6: (raw) => {
    const n = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
    const shipId = typeof raw.shipId === 'string' && raw.shipId.length > 0 ? raw.shipId : DEFAULT_START_SHIP_ID
    const bayRaw = raw.shipBay
    const bay: string[] = Array.isArray(bayRaw)
      ? bayRaw.filter((s): s is string => typeof s === 'string' && s.length > 0)
      : []
    if (!bay.includes(shipId)) bay.push(shipId)
    if (!bay.includes(DEFAULT_START_SHIP_ID)) bay.unshift(DEFAULT_START_SHIP_ID)

    // v6 货仓内容（旧 inventory）属于当前驾驶船
    const invRaw = asRaw(asRaw(raw.inventory).items)
    const inv: Record<string, number> = {}
    for (const [k, v] of Object.entries(invRaw)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) inv[k] = Math.floor(v)
    }
    // v6 装备装在当前驾驶船上
    const fittedRaw = asRaw(raw.fitted)
    const emptyFitted = { miner: null as string | null, cargo: null as string | null, turret: null as string | null }
    const fleet: Record<string, unknown> = {}
    for (const id of bay) {
      const isCurrent = id === shipId
      fleet[id] = {
        durability: 1,
        cargo: isCurrent ? { ...inv } : {},
        fitted: isCurrent
          ? { miner: asNullableString(fittedRaw.miner), cargo: asNullableString(fittedRaw.cargo), turret: asNullableString(fittedRaw.turret) }
          : { ...emptyFitted },
      }
    }

    const mRaw = asRaw(raw.mining)
    const expRaw = asRaw(raw.expedition)
    return {
      ...raw,
      fleet,
      warehouse: { items: {} },
      aiCoreLevel: 0,
      mining: {
        active: mRaw.active === true,
        beltId: asNullableString(mRaw.beltId),
        phase: 'mining',
        cycleAccMs: Math.max(0, Math.floor(n(mRaw.cycleAccMs))),
        phaseAccMs: 0,
        tripUnits: Math.max(0, Math.floor(n(mRaw.tripUnits))),
        autoCycle: true,
        stopAfterTrip: false,
      },
      expedition: {
        active: expRaw.active === true,
        anomalyId: asNullableString(expRaw.anomalyId),
        finishAtGameMs: Math.max(0, Math.floor(n(expRaw.finishAtGameMs))),
        durationMs: Math.max(0, Math.floor(n(expRaw.durationMs))),
        outMs: Math.max(0, Math.floor(n(expRaw.outMs))),
        combatMs: Math.max(0, Math.floor(n(expRaw.combatMs))),
        power: Math.max(0, Math.floor(n(expRaw.power))),
        eventId: asNullableString(expRaw.eventId),
        eventFired: expRaw.eventFired === true,
      },
    }
  },
  /**
   * v7 → v8（AI 核心版本）：
   * 废除 v7 的 aiCoreLevel（ISK 升级机制被"技能定数量 + 核心类型定效率"取代）；
   * 新增空的核心库与空副船任务表。
   */
  7: (raw) => {
    const core = { aiCores: { basic: 0, gamma: 0, beta: 0, alpha: 0 }, aiAssignments: {} }
    const { aiCoreLevel: _removed, ...rest } = raw
    return { ...rest, ...core }
  },
  /**
   * v8 → v9（市场版本）：
   * 已购蓝图（blueprints，一次购买永久可造）全部转为"已学会配方"（learnedRecipes，无损失）；
   * 蓝图书架初始为空；新增市场状态（空，首次推进时引擎按目录惰性铺开）；
   * 挂单/escrow 空；把旧的 blueprints 字段移除。
   */
  8: (raw) => {
    const bps: string[] = []
    if (Array.isArray(raw.blueprints)) {
      for (const bp of raw.blueprints) {
        if (typeof bp === 'string' && bp.length > 0 && !bps.includes(bp)) bps.push(bp)
      }
    }
    const { blueprints: _removed, ...rest } = raw
    return {
      ...rest,
      learnedRecipes: bps,
      blueprintStock: {},
      market: { pools: {}, npcBuy: {}, npcSell: {}, digest: {}, lastTickGameMs: 0, orderSeq: 0, priceHistory: {} },
      orders: [],
      escrowItems: {},
      escrowShips: {},
    }
  },
  /**
   * v9 → v10（槽位模型扩展版）：
   * v9 的每艘船 fitted 只有 采集器/货舱/炮台 三槽；v10 起六槽定死——
   * 为每艘船的 fitted 补 shield/armor/propulsion 三个空槽（占位家族，等战斗系统）。
   * （历史先例：v4→v5 为 fitted 补炮台槽。）
   */
  9: (raw) => {
    const fleetRaw = asRaw(raw.fleet)
    const fleet: Record<string, unknown> = {}
    for (const [id, shipRawValue] of Object.entries(fleetRaw)) {
      const ship = asRaw(shipRawValue)
      const f = asRaw(ship.fitted)
      fleet[id] = {
        ...ship,
        fitted: {
          miner: asNullableString(f.miner),
          cargo: asNullableString(f.cargo),
          turret: asNullableString(f.turret),
          shield: null,
          armor: null,
          propulsion: null,
        },
      }
    }
    return { ...raw, fleet }
  },
  /**
   * v10 → v11（随机事件系统）：
   * v10 无事件系统 → 补 events 默认（首次推进时引擎播种首个触发时刻）。
   */
  10: (raw) => {
    return { ...raw, events: { nextAtGameMs: 0 } }
  },
  /**
   * v11 → v12（实时战斗引擎）：
   * 远征语义升级为两阶段（out→battle→back）。旧式在途主控远征与 AI 远征无法平滑转换
   * （旧 finishAt 是"整体结束时刻"，无法还原到达时刻）——统一召回：任务取消、
   * AI 核心归还，日志说明；其余字段补默认（phase='out'、battle=null）。
   */
  11: (raw) => {
    const gameMs = typeof raw.gameMs === 'number' && Number.isFinite(raw.gameMs) ? Math.floor(raw.gameMs) : 0
    const logsRaw = raw.logs
    const logs: Array<Record<string, unknown>> = Array.isArray(logsRaw)
      ? logsRaw.filter((l): l is Record<string, unknown> => typeof l === 'object' && l !== null)
      : []
    let lastId = 0
    for (const l of logs) {
      const id = l.id
      if (typeof id === 'number' && Number.isFinite(id) && id > lastId) lastId = Math.floor(id)
    }
    const pushLog = (kind: string, text: string): void => {
      lastId += 1
      logs.push({ id: lastId, atGameMs: gameMs, kind, text })
    }

    // 主控远征召回
    const exp = asRaw(raw.expedition)
    const expRecalled = exp.active === true
    const nextExp = {
      ...exp,
      active: false,
      anomalyId: null,
      phase: 'out',
      battle: null,
      finishAtGameMs: 0,
      eventId: null,
      eventFired: false,
    }

    // AI 远征召回（核心归还）；采矿任务形状不变原样保留
    const cores = asRaw(raw.aiCores)
    const aiRaw = asRaw(raw.aiAssignments)
    const nextAi: Record<string, unknown> = {}
    let aiRecalled = 0
    for (const [shipKey, assignRaw] of Object.entries(aiRaw)) {
      const a = asRaw(assignRaw)
      const task = asRaw(a.task)
      if (task.kind === 'expedition') {
        aiRecalled += 1
        const type = a.coreType
        if (typeof type === 'string' && type.length > 0 && typeof cores[type] === 'number') {
          cores[type] = (cores[type] as number) + 1
        }
      } else {
        nextAi[shipKey] = a
      }
    }

    if (expRecalled) pushLog('info', '远征系统升级（V12 实时战斗引擎）：出发中的远征已自动召回，可重新出发。')
    if (aiRecalled > 0) pushLog('info', `远征系统升级（V12）：AI 远征任务已自动召回，${aiRecalled} 枚 AI 核心已归还核心库。`)
    if (logs.length > 300) logs.splice(0, logs.length - 300)
    return { ...raw, expedition: nextExp, aiAssignments: nextAi, aiCores: cores, logs }
  },
  /**
   * v12 → v13（星图探索系统）：
   * 补 exploredGalaxies（初始只亮母港）与 scanning 作业默认值（inactive）。
   * 在途作业（进行中的远征/采矿）不召回——引擎推进时会按"船已在途"自动点亮目标星系（运行时兜底）。
   */
  12: (raw) => {
    return {
      ...raw,
      exploredGalaxies: [HOME_GALAXY_ID],
      scanning: { active: false, galaxyId: null, finishAtGameMs: 0, startedAtGameMs: 0 },
    }
  },
  /**
   * v13 → v14（扫描续扫）：
   * 补 scanProgress（星系 → 已完成的就地扫描窗口毫秒；终止探索后保存，下次补扫剩余窗口）。
   */
  13: (raw) => {
    return { ...raw, scanProgress: {} }
  },
  /**
   * v14 → v15（调试模式）：
   * 补 debugQuick（开发工具开关；正常玩家恒 false）。
   */
  14: (raw) => {
    return { ...raw, debugQuick: false }
  },
  /**
   * v15 → v16（矿带空间分层 + 复合产出池）：
   * 三种矿石被删除（克洛基石/熔辉石/赤曜石）——所有持有（物品仓库/舰船货仓/挂卖锁仓）
   * 按各自精炼配方折算成对应矿物入仓（余数丢弃），相关挂单撤销；NPC 市场簿清理孤儿键。
   * 系数与 items.ts 精炼表同源（内容层约定，改表须同步这里）。
   */
  15: (raw) => {
    type OreRow = Array<[string, number]>
    const REMOVED_ORES: Record<string, { label: string; rows: OreRow }> = {
      'ore-kernite': {
        label: '克洛基石',
        rows: [
          ['min-mexallon', 1.2],
          ['min-nocxium', 0.15],
        ],
      },
      'ore-fluxite': {
        label: '熔辉石',
        rows: [
          ['min-isotope', 1.5],
          ['min-starcore', 0.5],
          ['min-mexallon', 1.1],
        ],
      },
      'ore-crimsonite': {
        label: '赤曜石',
        rows: [
          ['min-starcore', 1.0],
          ['min-mexallon', 1.8],
          ['min-isotope', 0.5],
        ],
      },
    }
    const gameMs = typeof raw.gameMs === 'number' && Number.isFinite(raw.gameMs) ? Math.floor(raw.gameMs) : 0
    const logsRaw = raw.logs
    const logs: Array<Record<string, unknown>> = Array.isArray(logsRaw)
      ? logsRaw.filter((l): l is Record<string, unknown> => typeof l === 'object' && l !== null)
      : []
    let lastId = 0
    for (const l of logs) {
      const id = l.id
      if (typeof id === 'number' && Number.isFinite(id) && id > lastId) lastId = Math.floor(id)
    }
    const pushLog = (kind: string, text: string): void => {
      lastId += 1
      logs.push({ id: lastId, atGameMs: gameMs, kind, text })
    }

    // ① 先统计全部持有（仓库 + 每船货仓 + 挂卖锁仓），从原始数据读
    const warehouse = asRaw(raw.warehouse)
    const wareItems = asRaw(warehouse.items)
    const fleetRaw = asRaw(raw.fleet)
    const escrowRaw = asRaw(raw.escrowItems)
    const holdQty: Record<string, number> = {}
    const collect = (m: unknown): void => {
      const src = asRaw(m)
      for (const [id, q] of Object.entries(src)) {
        if (REMOVED_ORES[id] && typeof q === 'number' && q > 0) {
          holdQty[id] = (holdQty[id] ?? 0) + q
        }
      }
    }
    collect(wareItems)
    for (const shipRaw of Object.values(fleetRaw)) collect(asRaw(shipRaw).cargo)
    collect(escrowRaw)

    // ② 折算入仓 + 剔键
    let converted = 0
    for (const [oreId, meta] of Object.entries(REMOVED_ORES)) {
      const qty = holdQty[oreId] ?? 0
      if (qty <= 0) continue
      converted += 1
      const parts: string[] = []
      for (const [minId, perOre] of meta.rows) {
        const n = Math.floor(qty * perOre)
        if (n > 0) {
          wareItems[minId] = (typeof wareItems[minId] === 'number' ? (wareItems[minId] as number) : 0) + n
          parts.push(`${minId}×${n}`)
        }
      }
      pushLog('info', `内容整合（V16 矿带分层）：${meta.label}×${qty} 按精炼等值折算为${parts.join('、')}入仓。`)
      delete wareItems[oreId]
    }

    // ③ 重建 fleet / escrow（剔被删矿石键），撤销相关玩家挂单
    const fleet: Record<string, unknown> = {}
    for (const [shipId, shipRaw] of Object.entries(fleetRaw)) {
      const s = asRaw(shipRaw)
      const cargoNext: Record<string, unknown> = {}
      for (const [id, q] of Object.entries(asRaw(s.cargo))) {
        if (REMOVED_ORES[id]) continue
        cargoNext[id] = q
      }
      fleet[shipId] = { ...s, cargo: cargoNext }
    }
    const escrowNext: Record<string, unknown> = {}
    for (const [id, q] of Object.entries(escrowRaw)) {
      if (REMOVED_ORES[id]) continue
      escrowNext[id] = q
    }
    const ordersRaw = raw.orders
    const keptOrders = Array.isArray(ordersRaw)
      ? ordersRaw.filter(
          (o): o is Record<string, unknown> =>
            typeof o === 'object' && o !== null && !(typeof o.good === 'string' && REMOVED_ORES[o.good]),
        )
      : []
    if (converted > 0) pushLog('info', '相关挂单已撤销、锁仓一并折算；NPC 市场簿已清理退役商品。')

    const mk = asRaw(raw.market)
    const cleanBooks = (b: unknown): Record<string, unknown> => {
      const src = asRaw(b)
      const out: Record<string, unknown> = {}
      for (const [key, v] of Object.entries(src)) {
        if (!REMOVED_ORES[key]) out[key] = v
      }
      return out
    }
    return {
      ...raw,
      warehouse: { ...warehouse, items: wareItems },
      fleet,
      escrowItems: escrowNext,
      orders: keptOrders,
      market: { ...mk, npcBuy: cleanBooks(mk.npcBuy), npcSell: cleanBooks(mk.npcSell), digest: cleanBooks(mk.digest) },
      logs,
    }
  },
  /**
   * v16 → v17（T5-B 舰船实例化）：
   * 旧档每型只有一艘：fleet 键（= 船型 id）原样保留作实例 uid，仅给每艘补
   * defId/customName（第 1 艘实例 uid 恒等于 defId）；escrow 挂卖中的舰船快照同步补字段。
   */
  16: (raw) => {
    const fleetRaw = asRaw(raw.fleet)
    const fleet: Record<string, unknown> = {}
    for (const [id, shipRaw] of Object.entries(fleetRaw)) {
      const s = asRaw(shipRaw)
      const defId = typeof s.defId === 'string' && s.defId.length > 0 ? s.defId : id
      fleet[id] = {
        ...s,
        defId,
        customName: typeof s.customName === 'string' && s.customName.length > 0 ? s.customName : null,
      }
    }
    const escrowRaw = asRaw(raw.escrowShips)
    const escrowShips: Record<string, unknown> = {}
    for (const [key, holdRaw] of Object.entries(escrowRaw)) {
      const e = asRaw(holdRaw)
      const shipId = typeof e.shipId === 'string' && e.shipId.length > 0 ? e.shipId : ''
      if (!shipId) continue
      escrowShips[key] = {
        ...e,
        shipId,
        defId: typeof e.defId === 'string' && e.defId.length > 0 ? e.defId : shipId,
        customName: typeof e.customName === 'string' && e.customName.length > 0 ? e.customName : null,
      }
    }
    return { ...raw, fleet, escrowShips }
  },
  /**
   * v17 → v18（V18 槽位制）：每船 fitted 由六槽 Record 转为三类位数组（复数安装）。
   * 原位映射：high = [turret, miner]、mid = [shield, propulsion]、low = [armor, cargo]
   * （每类 2 位的过渡形状——与实际船槽布局的数量对齐由 repair 链完成，超位件退回装备库）。
   */
  17: (raw) => {
    const fleetRaw = asRaw(raw.fleet)
    const fleet: Record<string, unknown> = {}
    for (const [id, shipRaw] of Object.entries(fleetRaw)) {
      const s = asRaw(shipRaw)
      const f = asRaw(s.fitted)
      const pick = (fam: string): string | null => (typeof f[fam] === 'string' ? (f[fam] as string) : null)
      fleet[id] = {
        ...s,
        fitted: {
          high: [pick('turret'), pick('miner')],
          mid: [pick('shield'), pick('propulsion')],
          low: [pick('armor'), pick('cargo')],
        },
      }
    }
    return { ...raw, fleet }
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
      units[tag] = {
        tag,
        side,
        name: typeof u.name === 'string' && u.name.length > 0 ? u.name : tag,
        hp: {
          s: Math.max(0, numf(hpRaw.s, 0)),
          a: Math.max(0, numf(hpRaw.a, 0)),
          h: Math.max(0, numf(hpRaw.h, 0)),
        },
        weapons,
      }
    }
  }
  if (Object.keys(units).length === 0) return null
  const ammoRaw = asRaw(b.ammo)
  const statsRaw = asRaw(b.stats)
  const endedRaw = b.ended
  const fx = cleanFx(b.fx, numf)
  return {
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
  }
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
  ): { defId: string; customName: string | null; durability: number; cargo: Record<string, number>; fitted: FittedModules } => ({
    defId,
    customName: null,
    durability: 1,
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
    fleet[id] = {
      defId,
      customName: cleanCustomName(shipRaw.customName),
      durability,
      cargo: cargoMap,
      fitted,
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
    }
  }

  // --- T4 换船善后返航（v16.1 兼容字段）：字段非法则整条丢弃；已走时间封顶单程 ---
  const shipReturns: Record<string, { beltId: string | null; legMs: number; phaseAccMs: number }> = {}
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
    shipReturns[shipKey] = { beltId, legMs, phaseAccMs }
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
      })
    }
  }

  // --- escrow（v9） ---
  const escrowItems: Record<string, number> = {}
  for (const [key, value] of Object.entries(asRaw(src.escrowItems))) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) escrowItems[key] = Math.floor(value)
  }
  const escrowShips: Record<number, { shipId: string; defId: string; durability: number; customName: string | null }> = {}
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
    }
  }

  // --- 制造作业（v3） ---
  const mfRaw = asRaw(src.manufacturing)
  const mfBlueprintId =
    typeof mfRaw.blueprintId === 'string' && mfRaw.blueprintId.length > 0 ? mfRaw.blueprintId : null
  const manufacturing = {
    active: mfRaw.active === true && mfBlueprintId !== null,
    blueprintId: mfBlueprintId,
    finishAtGameMs:
      typeof mfRaw.finishAtGameMs === 'number' && Number.isFinite(mfRaw.finishAtGameMs)
        ? Math.max(0, Math.floor(mfRaw.finishAtGameMs))
        : 0,
    durationMs:
      typeof mfRaw.durationMs === 'number' && Number.isFinite(mfRaw.durationMs)
        ? Math.max(0, Math.floor(mfRaw.durationMs))
        : 0,
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
    desirePrefM:
      typeof expRaw.desirePrefM === 'number' && Number.isFinite(expRaw.desirePrefM) && expRaw.desirePrefM > 0
        ? Math.round(expRaw.desirePrefM)
        : undefined,
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

  // --- 扫描探索作业（v13；T8：加出发星系 originGalaxy） ---
  const scanRaw = asRaw(src.scanning)
  const scanGalaxyId = typeof scanRaw.galaxyId === 'string' && scanRaw.galaxyId.length > 0 ? scanRaw.galaxyId : null
  const scanning = {
    active: scanRaw.active === true && scanGalaxyId !== null,
    galaxyId: scanGalaxyId,
    finishAtGameMs:
      typeof scanRaw.finishAtGameMs === 'number' && Number.isFinite(scanRaw.finishAtGameMs)
        ? Math.max(0, Math.floor(scanRaw.finishAtGameMs))
        : 0,
    startedAtGameMs:
      typeof scanRaw.startedAtGameMs === 'number' && Number.isFinite(scanRaw.startedAtGameMs)
        ? Math.max(0, Math.floor(scanRaw.startedAtGameMs))
        : 0,
    originGalaxy:
      typeof scanRaw.originGalaxy === 'string' && scanRaw.originGalaxy.length > 0 ? scanRaw.originGalaxy : null,
  }

  // --- T8 野外停留 / 返航行程 / 悬赏冷却 / 连续出击（v16.1 兼容字段） ---
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
  // --- 精炼炉运转（2026-09-04 工业细化兼容字段）：active 且资源合法才启用，否则空态 ---
  const rfrRaw = asRaw(src.refineRun)
  const rfrItem =
    typeof rfrRaw.itemId === 'string' && rfrRaw.itemId.length > 0 ? rfrRaw.itemId : null
  const refineWorker: GameState['refineRun']['worker'] =
    rfrRaw.worker === 'basic' || rfrRaw.worker === 'gamma' || rfrRaw.worker === 'beta' || rfrRaw.worker === 'alpha'
      ? rfrRaw.worker
      : 'pilot'
  const refineRun: GameState['refineRun'] =
    rfrRaw.active === true && rfrItem !== null && num(rfrRaw.lockedQty) > 0
      ? {
          active: true,
          worker: refineWorker,
          recipe: rfrRaw.recipe === 'recycle' ? 'recycle' : 'refine',
          itemId: rfrItem,
          batchUnits: Math.max(1, Math.floor(num(rfrRaw.batchUnits, 10))),
          cycleMs: Math.max(1, Math.floor(num(rfrRaw.cycleMs, 6_000))),
          finishAtGameMs: Math.max(0, Math.floor(num(rfrRaw.finishAtGameMs))),
          lockedQty: Math.max(1, Math.floor(num(rfrRaw.lockedQty))),
          batchesDone: Math.max(0, Math.floor(num(rfrRaw.batchesDone))),
        }
      : { active: false, worker: 'pilot', recipe: 'refine', itemId: null, batchUnits: 0, cycleMs: 0, finishAtGameMs: 0, lockedQty: 0, batchesDone: 0 }
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

  // --- B3 星系残骸密度（2026-09-05 兼容字段无版本号）：合法记录保留（密度 ≥0、稀有计数取整）；
  // 非法/缺省 = 无记录（运行时按基础密度推导，不入档） ---
  const galaxyWrecks: Record<string, { density: number; rare: number }> = {}
  const gwRaw = asRaw(src.galaxyWrecks)
  for (const [galaxyId, gw] of Object.entries(gwRaw)) {
    if (galaxyId.length === 0 || typeof gw !== 'object' || gw === null) continue
    const g = asRaw(gw)
    const density = g.density
    const rare = g.rare
    if (typeof density !== 'number' || !Number.isFinite(density) || density < 0) continue
    galaxyWrecks[galaxyId] = {
      density,
      rare: typeof rare === 'number' && Number.isFinite(rare) ? Math.max(0, Math.floor(rare)) : 0,
    }
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

  // --- 扫描续扫进度（v14）：星系 → 已完成的就地扫描窗口毫秒（上限 SCAN_WINDOW_MS） ---
  const scanProgressRaw = asRaw(src.scanProgress)
  const scanProgress: Record<string, number> = {}
  for (const [key, value] of Object.entries(scanProgressRaw)) {
    if (key.length === 0) continue
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      scanProgress[key] = Math.min(SCAN_WINDOW_MS, Math.floor(value))
    }
  }

  // --- 调试模式（v15）：布尔化（非法值一律 false） ---
  const debugQuick = src.debugQuick === true

  // --- 首胜声望清单（v15.1 兼容字段）：只收字符串 id、去重保序 ---
  const completedBounties: string[] = []
  const cbRaw = src.completedBounties
  if (Array.isArray(cbRaw)) {
    for (const id of cbRaw) {
      if (typeof id === 'string' && id.length > 0 && !completedBounties.includes(id)) completedBounties.push(id)
    }
  }

  const normalized: GameStateV18 = {
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
    mining,
    moduleBay,
    learnedRecipes,
    blueprintStock,
    market,
    orders,
    escrowItems,
    escrowShips,
    manufacturing,
    standings,
    expedition,
    events,
    exploredGalaxies,
    scanning,
    scanProgress,
    debugQuick,
    completedBounties,
    awayGalaxy,
    transit,
    standby,
    refineRun,
    bountyCooldowns,
    autoLoopAnomalyId,
    encounter,
    lowSecNotified,
    encounterZoneCooldown,
    lowSecPresence,
    stationSites,
    dockedSite,
    dialogueSeen,
    pendingDialogue,
    galaxyWrecks: galaxyWrecks as GameState['galaxyWrecks'],
    logs,
  }
  return normalized
}

/** 保存：把状态序列化成 JSON 字符串（现在时间由调用方传入，测试可固定） */
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
  while (v < CURRENT_STATE_VERSION) {
    const migrate = MIGRATIONS[v]
    if (!migrate) {
      throw new SaveError('VERSION', `存档版本 v${v} 太旧，没有对应的迁移脚本，无法读取。`)
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
