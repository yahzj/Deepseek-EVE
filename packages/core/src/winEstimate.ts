/**
 * **悬赏胜率预估（蒙特卡洛 · 三点距离采样）** —— 2026-09-24 船长令重做。
 *
 * 船长原话（设计裁定，逐条落地）：
 * - 「**武器的射程 → 期望距离，那就按照武器最大射程，最小射程，中距离各跑数次。不加入新参数。偏移也取消了。**」
 * - 「**去种子化**」·「**有胜利记录时取代**（三点采样）」·「**三点各 10 局就够了**」·
 *   「**『残血』口径按照剩余比例**」·「**③按敌卡。记录残血最多的一次，如果都是满血则不覆盖。夹回当前射程内。**」·
 *   「**如果是编队战斗则按编队算**（本模块只服务星图悬赏卡，实战宿主见 `expedition` 的单舰入口）·
 *   **弹药采用玩家当前选择弹药** · **补给按照完全充足给** · **享受全部战斗加成**」。
 * - 触发时机**不动**（引擎侧仍是"战力指纹 + 预热队列滚动"，见 `game/engine.ts`）。
 *
 * 与旧版的三处实质差别：
 * 1. **去种子化**：旧版是固定种子表（`20260909 + i×常量`）⇒ 所有卡、所有玩家跑的是**同一批时间线**，
 *    等于"同一条路线跑 N 遍"，不是抽样（这正是船长 2026-09-24 报障「100% 胜率却失败」的头号嫌疑）。
 *    现按 `hash(敌卡 id + 装配/技能指纹 + 距离点序号 + 局号)` 派生 ⇒ **同输入可复现**，且**不同卡/不同点
 *    拿到互不相关的序列**。
 * 2. **三点距离**：按该船**主武器的最大射程 / 最小射程 / 中距离**各跑 `BOUNTY_MC_RUNS` 局
 *    （复用引擎自己的 `mainWeaponOf` + `desiredRangeFor`，**不新增参数**）；每局把该点当"期望距离"传进
 *    `startBattleFor` 的第 6 参（与实战同一入口、同一夹紧）。
 * 3. **胜利记录取代采样**：若该敌卡已有实战胜利记录（`state.winRecord[cardId]`），则**只用记录距离**
 *    跑满 `BOUNTY_MC_RUNS × 3` 局（夹回当前射程内）——"打过的卡按打过的距离算"。
 *
 * 输出除胜率外还给 **`worstWinRate`（三点里最低的那个）**：它回答"运气最差的距离上也赢得下来吗"，
 * 比平均值更能防"看着必胜却翻车"。
 */
import type { FittedModules, GameState } from './state'
import { createInitialState } from './state'
import type { AnomalyDef, SimContext } from './types'
import { addShipToFleet } from './shipyard'
import type { UnitSpec } from './combat'
import { advanceBattleFor, createPlayerSpec, desiredRangeFor, mainWeaponOf, startBattleFor, waveGapTotalMs } from './combat'

/** **每个距离点的局数**（2026-09-24 船长：「三点各 10 局就够了」） */
export const BOUNTY_MC_RUNS = 10

const AMMO_ITEM_IDS = ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l'] as const

export interface BountyWinMC {
  /** 胜率 0~1（各点合并后的实测平均，无偏） */
  winRate: number
  /** **最差距离点**的胜率（三点里最低者；走记录距离时 = `winRate`）——"运气最差也赢得下来吗" */
  worstWinRate: number
  /** 平均装甲损耗 0~1（相对本场开局残余；1 = 打空） */
  armorLoss: number
  /** 平均结构损耗 0~1（相对本场开局残余） */
  hullLoss: number
  /** 实际局数 */
  runs: number
  /** 逐距离点读数（界面悬停/读数用） */
  points: readonly { desireM: number; winRate: number; runs: number }[]
  /** 本卡是否走"已证胜利距离"（有记录 ⇒ 不采样） */
  recorded: boolean
}

/**
 * **稳定散列**（去种子化用）：把"敌卡 + 装配/技能指纹 + 距离点 + 局号"揉成一个 32 位种子。
 * 为什么不用 `Math.random`：预估必须**同输入可复现**（预热缓存稳定、用例可断言），
 * 但**不同输入必须互不相关**——散列两者兼得。
 */
function seedOf(parts: readonly (string | number)[]): number {
  let h = 2166136261
  for (const p of parts) {
    const s = String(p)
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    h ^= 0x9e3779b9
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * 克隆"战力评估快照"：新档 + 驾驶船（同装配/无人机清单/耐久/**弹药档位**）+ 技能 + 教程进度。
 * 弹药与修理组件给足（评估不计补给耗尽）；其余（仓库/市场/任务/声望）不影响战力，不复制。
 * 返回 null = 该船不存在。uid = 快照中驾驶船键（addShipToFleet 分配，第 1 艘 = 船型 id）。
 */
export function buildEvalState(state: GameState, shipId: string): { ev: GameState; uid: string } | null {
  const real = state.fleet[shipId]
  const defId = real?.defId
  if (!real || !defId) return null
  const ev = createInitialState({ nowWallMs: 0, seed: 1 })
  const uid = addShipToFleet(ev, defId)
  const f = ev.fleet[uid]!
  f.fitted = JSON.parse(JSON.stringify(real.fitted ?? {})) as FittedModules
  if (real.droneLoad !== undefined) f.droneLoad = { ...real.droneLoad }
  f.armorPct = real.armorPct ?? 1
  f.durability = real.durability ?? 1
  f.customName = real.customName
  /**
   * **弹药档位**（**2026-09-24 船长**：「弹药采用玩家当前选择弹药」）：旧版不复制 `ammoPref`
   * ⇒ 评估固定吃脚本塞的基础弹，与实战（MK2/MK3）不是同一场仗。
   */
  if (real.ammoPref !== undefined) f.ammoPref = { ...real.ammoPref }
  f.cargo = {}
  /**
   * **补给补足跟着开关走**（2026-09-23 船长令：弹药与修理组件"从仓库取用 / 从货仓取用"二选一）：
   * 评估把料放进**开关真正会读的那个池**（船长 2026-09-24：「补给按照完全充足给」）。
   */
  ev.resupplyFromWarehouse = state.resupplyFromWarehouse !== false
  provisionEvalSupplies(ev, f)
  ev.skills.trained = { ...state.skills.trained }
  ev.skills.queue = []
  // 每星系目标距离（2026-09-11 船长）：预估的每局战斗必须按**该星系**的设定打，故原样带进快照
  if (state.expedition.desirePrefByGalaxy !== undefined) {
    ev.expedition.desirePrefByGalaxy = { ...state.expedition.desirePrefByGalaxy }
  }
  // 照会战加成判定（演习场 + 主控 + 「第一次完成悬赏」未完成）——复制任务状态使评估与实战一致
  const fb = state.importantTasks['first-bounty']
  if (fb !== undefined) ev.importantTasks['first-bounty'] = { ...fb }
  // 敌卡的窝点/派系档位（`startBattleFor` 会按它派生强化卡 ⇒ 评估与实战同一张卡）
  ev.expedition.lairTier = state.expedition.lairTier
  ev.expedition.factionActive = state.expedition.factionActive
  ev.shipId = uid
  return { ev, uid }
}

/**
 * **评估用补给补足**（2026-09-23 开关配套）：把"弹药 + 修理组件足量"放进**开关真正会读的那个池**——
 * 开（缺省）= 母港仓库；关 = 该舰货仓。评估本身是"不计补给耗尽"的口径（船长 2026-09-24 确认）。
 */
function provisionEvalSupplies(ev: GameState, f: { cargo?: Record<string, number> } | undefined): void {
  const ids = [...AMMO_ITEM_IDS, 'repairkit-civ', 'repairkit-mil']
  if (ev.resupplyFromWarehouse !== false) {
    for (const id of ids) ev.warehouse.items[id] = 1_000_000
    return
  }
  if (!f) return
  f.cargo = f.cargo ?? {}
  for (const id of ids) f.cargo[id] = 1_000_000
}

/**
 * **装配/技能指纹**（去种子化的一项输入）：只取"会改变战斗结果"的那些（舰型 / 装配 / 无人机 / 技能 /
 * 耐久 / 弹药档）。同装配同技能 ⇒ 同种子序列（可复现）；换装配 ⇒ 全新序列（互不相关）。
 */
function shipFingerprintOf(ev: GameState, uid: string): string {
  const f = ev.fleet[uid]
  const tr = ev.skills.trained
  const sk = Object.keys(tr)
    .sort()
    .map((k) => `${k}:${tr[k]}`)
    .join(',')
  return `${f?.defId ?? ''}|${JSON.stringify(f?.fitted ?? {})}|${JSON.stringify(f?.droneLoad ?? null)}|${f?.armorPct ?? 1}|${f?.durability ?? 1}|${JSON.stringify(f?.ammoPref ?? null)}|${sk}`
}

/**
 * **三个距离采样点**（船长 2026-09-24：「按照武器最大射程，最小射程，中距离各跑数次。不加入新参数」）。
 * 三处都复用引擎口径：`mainWeaponOf`（主武器 = 射程最远那门）与 `desiredRangeFor`（中距档位）。
 * 夹紧交给 `startBattleFor` 内部那一道（`clamp(minDistanceM, min(openM, raw))`），本函数不重复夹。
 */
export function evalDistancePoints(me: UnitSpec, ctx: SimContext): { max: number; min: number; mid: number } {
  const bal = ctx.balance.battle
  const main = mainWeaponOf(me)
  return {
    max: Math.max(bal.minDistanceM, Math.round(main?.maxRangeM ?? 0)),
    min: Math.max(bal.minDistanceM, Math.round(main?.minRangeM ?? 0)),
    mid: desiredRangeFor(me, 'mid', bal),
  }
}

/**
 * 在评估快照上跑 N 局（**三点距离各 10 局**；有胜利记录则只看记录距离）。
 * `ev` 只应来自 `buildEvalState`。同输入同种子完全可复现。
 */
export function estimateBountyWinOn(
  ev: GameState,
  ctx: SimContext,
  anomaly: AnomalyDef,
  uid: string,
  runs: number = BOUNTY_MC_RUNS,
  /** 兼容参数（旧调用方传的种子基）——**去种子化后不再使用**，保留只为签名兼容 */
  seedBase = 0,
): BountyWinMC {
  void seedBase
  const bal = ctx.balance.battle
  const anomalyId = anomaly.id
  // 拿"我方规格"以解析武器射程带：走引擎自己的建档入口（与实战同源）
  const specProbe = createPlayerSpec(ev, ctx, uid)
  const pts = specProbe ? evalDistancePoints(specProbe, ctx) : null
  const record = ev.winRecord?.[anomalyId]
  const recorded = record !== undefined && record.desireM > 0
  /**
   * **夹回当前射程内**（船长 2026-09-24：「夹回当前射程内」）：记录是**当时那条装配**打出来的距离，
   * 换过武器后可能落在现射程带之外 ⇒ 用**现主武器的 [最小, 最大] 射程带**夹一道再采样
   * （换过武器的场次仍能吃到记录，只是按现射程的边界打；解析不出武器时原样使用）。
   */
  const recD = ((): number => {
    if (!record) return 0
    if (!pts) return record.desireM
    return Math.min(pts.max, Math.max(pts.min, record.desireM))
  })()

  /** 本卡这一次要跑的"距离点表"：有记录 ⇒ 只跑记录距离（局数 ×3，精度不降）；否则三点各 runs 局 */
  const plan: { desireM: number; runs: number; tag: string }[] = recorded
    ? [{ desireM: recD, runs: runs * 3, tag: 'record' }]
    : pts
      ? [
          { desireM: pts.max, runs, tag: 'max' },
          { desireM: pts.min, runs, tag: 'min' },
          { desireM: pts.mid, runs, tag: 'mid' },
        ]
      : [{ desireM: 0, runs: runs * 3, tag: 'default' }] // 兜底：解析不出武器 ⇒ 走引擎缺省档

  let wins = 0
  let total = 0
  let armorLeftSum = 0
  let hullLeftSum = 0
  const points: { desireM: number; winRate: number; runs: number }[] = []
  for (const p of plan) {
    let pWins = 0
    for (let i = 0; i < p.runs; i += 1) {
      // **去种子化**：按"卡 + 船的装配/技能指纹 + 距离点 + 局号"散列派生 ⇒ 不同卡/不同点互不相关
      ev.rng = { seed: seedOf([anomalyId, shipFingerprintOf(ev, uid), p.tag, p.desireM, i]), count: 0 }
      const f = ev.fleet[uid]
      if (f) {
        const ap = f.armorPct ?? 1
        f.armorPct = Math.min(1, Math.max(0, ap))
        provisionEvalSupplies(ev, f) // 每局补足（评估不计补给耗尽）
      }
      ev.gameMs = 0
      // **与实战同一入口**（`expedition` 的悬赏战即 `startBattleFor`）；`desireM` 走第 6 参
      const battle = startBattleFor(ev, ctx, uid, anomalyId, 0, p.desireM > 0 ? p.desireM : undefined)
      if (!battle) continue
      const pl0 = battle.units['player']
      if (!pl0) continue
      const a0 = pl0.hp.a
      const h0 = pl0.hp.h
      ev.gameMs = bal.maxBattleMs + 5_000 + waveGapTotalMs(anomaly, bal) // 预算外预留波次演出窗口
      advanceBattleFor(ev, ctx, battle, uid, anomalyId)
      const pl = battle.units['player']
      if (!pl) continue
      total += 1
      if (battle.ended === 'me') {
        wins += 1
        pWins += 1
      }
      // 损耗钳制 [0,1]：维修装置可把装甲/结构修回超过开局残余 ⇒ 损耗比不得为负
      armorLeftSum += a0 > 0 ? Math.min(1, Math.max(0, pl.hp.a / a0)) : 0
      hullLeftSum += h0 > 0 ? Math.min(1, Math.max(0, pl.hp.h / h0)) : 0
    }
    points.push({ desireM: p.desireM, winRate: p.runs > 0 ? pWins / p.runs : 0, runs: p.runs })
  }
  const done = Math.max(1, total)
  const winRate = wins / done
  const worstWinRate = points.length > 0 ? Math.min(...points.map((x) => x.winRate)) : winRate
  return {
    winRate,
    worstWinRate,
    armorLoss: 1 - armorLeftSum / done,
    hullLoss: 1 - hullLeftSum / done,
    runs: done,
    points,
    recorded,
  }
}

/** 便捷入口：对当前档直接评估（内部自建快照，不污染存档）。null = 驾驶船记录缺失。 */
export function estimateBountyWinMC(
  state: GameState,
  ctx: SimContext,
  anomaly: AnomalyDef,
  shipId: string = state.shipId,
  runs: number = BOUNTY_MC_RUNS,
): BountyWinMC | null {
  const snap = buildEvalState(state, shipId)
  if (!snap) return null
  return estimateBountyWinOn(snap.ev, ctx, anomaly, snap.uid, runs)
}
