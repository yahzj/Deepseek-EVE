/** 功能域职责拆分，保持原计算与顺序。 */
import type { SimContext, AnomalyDef } from '../types'
import { type GameState, addLog } from '../state'
import { weekendBountyCardsOf, weekendEncounterAllowedIn, WEEKEND_CARD_PREFIX } from '../weekendBounty'
import { weekendFlagshipEncounterOf, weekendBattleInvolvedOf } from '../weekendBattle'
import { weekendEncounterChanceAt, weekendAmbushPickOf } from '../weekendEvent'
import { nextRandom, pickOne } from '../rng'
import { shipDisplayName } from '../instances'

/** 旧档遗留兜底档位（data ANOMALIES hidden 条目）：仅无 anomalyId 的旧遭遇应战/命名用；
 * 新伏击一律抽当地可见悬赏敌群，不再走此表。
 * **族口径（2026-09-11）**：四张模板已显式登记 `foeFamily: 'A'`（原"未录族 → 兜底 F 形"作废，
 * F 族废弃、字母位空置）——故旧档遭遇战的造型/签名/窝点词表一律走 A 族口径。 */
export const ENC_TIERS: ReadonlyArray<{ id: string; threat: number }> = [
  { id: 'enc-pirate-1', threat: 10 },
  { id: 'enc-pirate-2', threat: 22 },
  { id: 'enc-pirate-3', threat: 40 },
  { id: 'enc-pirate-4', threat: 70 },
]

/** 就近匹配遭遇强度 → 战斗模板 id（threat 存档位与档位贴齐，保证存档后仍稳定匹配；旧档兜底用） */
export function tierIdOf(threat: number): string {
  let best = ENC_TIERS[0]!
  for (const t of ENC_TIERS) {
    if (Math.abs(t.threat - threat) < Math.abs(best.threat - threat)) best = t
  }
  return best.id
}

/**
 * 事发星系可见悬赏敌群池（hidden 遭遇模板不算——2026-09-09 与打捞抽池/悬赏目录同口径）。
 *
 * **2026-09-23 周末入侵**：被占星系**整池换成入侵舰队派生卡**（`weekendBountyCardsOf`：只覆盖
 * id / 名字 / 威胁 / 奖励）⇒ **悬赏目录与遇袭同时看到入侵舰队**，无需第二处改动。
 * ⚠ 未传 `state`/`nowWallMs` ⇒ 老口径（原卡池），旧调用方与既有用例行为一字不变。
 */
export function localBountyPoolOf(ctx: SimContext, galaxyId: string, state?: GameState, nowWallMs?: number): AnomalyDef[] {
  const out: AnomalyDef[] = []
  for (const a of ctx.anomalies.values()) {
    if (a.hidden) continue
    if (a.galaxyId === galaxyId) out.push(a)
  }
  if (!state || nowWallMs === undefined) return out
  return [...weekendBountyCardsOf(state, ctx, out, galaxyId, nowWallMs)]
}

/** 伏击敌群解析：优先 encounter.anomalyId；旧档遗留按事发星系可见敌群就近威胁兜底（仍无 → null） */
export function foeOf(state: GameState, ctx: SimContext): AnomalyDef | null {
  const enc = state.encounter
  if (enc.anomalyId) {
    const direct = ctx.anomalies.get(enc.anomalyId)
    if (direct && !direct.hidden) return direct
  }
  if (!enc.galaxyId) return null
  let best: AnomalyDef | null = null
  let bestDist = Number.POSITIVE_INFINITY
  for (const a of localBountyPoolOf(ctx, enc.galaxyId)) {
    const dist = Math.abs(a.threat - enc.threat)
    if (dist < bestDist) {
      bestDist = dist
      best = a
    }
  }
  return best
}

/** 这一场遭遇是不是"入侵相关"（占领区的伏击或旗舰挑战）——赏金与残骸归属的分流判据 */
export function weekendInvolvedAt(state: GameState, ctx: SimContext): boolean {
  const enc = state.encounter
  if (weekendFlagshipEncounterOf(state, enc)) return true
  return weekendBattleInvolvedOf(state, ctx, enc.anomalyId ?? null, Date.now()) !== undefined
}

/** 星系安全等级（记录缺失按高安 +1 处理，不惹麻烦） */
export function secOf(ctx: SimContext, galaxyId: string | null): number {
  if (galaxyId === null) return 1
  return ctx.galaxies.get(galaxyId)?.security ?? 1
}

/** 一次"暴露"：某艘我方舰船正"就地活动/驻留"在某个低安星系
 * （2026-09-06：移动/返航/转场途中不暴露） */
export interface Exposure {
  galaxyId: string
  shipId: string
  kind: '采矿' | '停留' | '打捞' | '扫描'
  /** 描述（日志用）：承担船名 + 来源 */
}

/**
 * 收集当前全部暴露（去重：同星系只留最高优先承担者；停留 > 作业，主控作业 > 副船）。
 *
 * `includeOccupiedAt` = **周末入侵的"占领区破例"**（设计稿口径定稿 #4「被占星系一律高频遇袭：
 * 中安、高安都破例」，船长 2026-09-23 裁定 Q1「连带高安也破例，但是入侵核心星系只会出现在非高安地区」）：
 * 传墙钟时刻 ⇒ **活的占领区不看安全等级**也算一次暴露，高安/中安占领区里作业与驻留同样会遇袭；
 * 不传 = 老口径逐字不变。
 * ⚠ `maintainPresence` 恒不传——中安/高安占领区**不进** `lowSecPresence`，也不会弹"首次进入低安星系"
 * 那条提示（那条文案讲的是低安，与占领区无关）。
 */
export function collectExposures(state: GameState, ctx: SimContext, includeOccupiedAt?: number): Exposure[] {
  const bal = ctx.balance.encounter
  const out = new Map<string, Exposure>()
  const push = (e: Exposure): void => {
    // 中安/高安不掷（低安 = sec ≤ 0，含 0）；**占领区破例**见上面的 `includeOccupiedAt`
    if (secOf(ctx, e.galaxyId) > bal.lowSecMax) {
      if (includeOccupiedAt === undefined) return
      if (!weekendEncounterAllowedIn(state, e.galaxyId, includeOccupiedAt)) return
    }
    const prev = out.get(e.galaxyId)
    const rank = (x: Exposure): number => (x.kind === '停留' ? 3 : x.shipId === state.shipId ? 2 : 1)
    if (!prev || rank(e) > rank(prev)) out.set(e.galaxyId, e)
  }
  const m = state.mining
  // 主控：采矿只算"采掘相位"（返航/去程是移动 → 不暴露）
  if (m.active && m.phase === 'mining' && m.beltId) {
    const g = ctx.belts.get(m.beltId)?.galaxyId
    if (g) push({ galaxyId: g, shipId: state.shipId, kind: '采矿' })
  }
  // 主控打捞：只算"打捞作业相位"（出航/返航移动不暴露）
  if (state.salvaging.active && state.salvaging.phase === 'salvaging' && state.salvaging.galaxyId) {
    push({ galaxyId: state.salvaging.galaxyId, shipId: state.shipId, kind: '打捞' })
  }
  /**
   * ⚠ **2026-09-15 起"主控扫描星系"不再暴露**（船长：扫描 = 派出一艘无人深空扫描艇 ⇒ 不在场、
   * 没得打）：原先那条 `kind: '扫描'` 暴露（含低安 ×1.5 埋伏系数）连同"遇袭自动停扫"一起删除。
   * 扫描期间"更热闹"的那一半（事件倒计时加速 + 「探索发现」池）照旧保留，见 `events.ts`。
   */
  /**
   * **主控扫描虫洞**（2026-09-14 船长：「在扫描的过程中，玩家遭遇随机事件的期望和星图中的扫描一致」）：
   * 与上面"扫描星系"那条**同一档暴露** —— 都是"就地作业、扫描即暴露、无入场缓冲"，
   * 判定与概率全走同一套 `kind: '扫描'` 口径（含低安 ×1.5 的扫描埋伏系数），故期望一致。
   * ⚠ 与星系扫描的区别只有"扫什么"：虫洞扫描**没有目标星系**，暴露地点取**当前野外所在星系**
   * （`awayGalaxy`；在站内 / 母港为 null ⇒ 不暴露，与"野外驻留"那条同口径）。
   * ⚠ 另：本文件的"自动停手"清单（遇袭收口）**有意不含虫洞扫描** —— 船长：「遇袭不中断扫描」（进度不丢）。
   */
  if (state.wormholeScan?.active === true && state.awayGalaxy !== null) {
    push({ galaxyId: state.awayGalaxy, shipId: state.shipId, kind: '扫描' })
  }
  // 主控野外驻留（掩护巡逻/旧档停留遗留）= 区域停留船；无作业进行时才成立
  // ⚠ 2026-09-15 起"扫描星系"不再算作业（无人扫描艇不牵动舰船）⇒ 它不再压掉这条驻留判定
  if (
    state.awayGalaxy !== null &&
    !m.active &&
    !state.expedition.active &&
    !state.salvaging.active &&
    state.wormholeScan?.active !== true
  ) {
    push({ galaxyId: state.awayGalaxy, shipId: state.shipId, kind: '停留' })
  }
  // 副船（采矿采掘中 / 打捞作业中 / 掩护巡逻驻留；移动段与交火不暴露）
  for (const [sid, a] of Object.entries(state.aiAssignments)) {
    const t = a.task
    if (t.kind === 'mining' && t.phase === 'mining') {
      const g = ctx.belts.get(t.beltId)?.galaxyId
      if (g) push({ galaxyId: g, shipId: sid, kind: '采矿' })
    } else if (t.kind === 'salvage' && t.phase === 'salvaging') {
      push({ galaxyId: t.galaxyId, shipId: sid, kind: '打捞' })
    } else if (t.kind === 'standby' && t.phase === 'stand') {
      push({ galaxyId: t.galaxyId, shipId: sid, kind: '停留' }) // 已驻留的副船 = 区域停留船
    }
  }
  return [...out.values()]
}

/** 首次涉足低安：一次性提示 + 日志（规则全文在手册「航行须知」） */
export function noteLowSec(state: GameState, ctx: SimContext, galaxyId: string): void {
  if (state.lowSecNotified) return
  state.lowSecNotified = true
  const name = ctx.galaxies.get(galaxyId)?.name ?? galaxyId
  addLog(
    state,
    'warn',
    `⚠ 首次进入低安星系（${name}，安全 ${secOf(ctx, galaxyId).toFixed(1)}）：低安活动可能遭遇巡逻拦截或海盗伏击——采掘/打捞/扫描作业与驻留时可能，长途运输途中同样会；遇袭后舰船会自己用修理组件补装甲与结构，补不动或结构过低才收手返港；可「迎战」或快速脱离，详见手册「航行须知」。`,
  )
}

/** 引擎内部：刷新低安在场记录（本轮在场星系补起始时刻；离开的删除）；首次涉足低安给一次性提示 */
export function maintainPresence(state: GameState, ctx: SimContext): void {
  const now = state.gameMs
  const seen = new Set<string>()
  for (const exp of collectExposures(state, ctx)) {
    seen.add(exp.galaxyId)
    if (state.lowSecPresence[exp.galaxyId] === undefined) {
      state.lowSecPresence[exp.galaxyId] = now
      noteLowSec(state, ctx, exp.galaxyId) // 新入场（且全局限首提）提示
    }
  }
  for (const g of Object.keys(state.lowSecPresence)) {
    if (!seen.has(g)) delete state.lowSecPresence[g]
  }
}

/**
 * 低安遭遇判定（船长 2026-09-04 定稿：**占用随机事件触发机会**）：
 * 由随机事件系统在每次事件到点时调用——若我方有船在低安星系且已过 5 分钟入场缓冲
 * （及区域冷却），按星系安全度概率遇袭；命中即产生遭遇并返回 true（本次事件时机被占用，
 * 本段不再出随机事件）；未中返回 false（随机事件照常）。
 */
export function rollLowSecAmbush(state: GameState, ctx: SimContext, cadenceScale = 1, nowWallMs = Date.now()): boolean {
  if (state.encounter.active) return false // 已有未了结遭遇：不叠
  const bal = ctx.balance.encounter
  /** **周末入侵**：被占星系（活的占领区）**破例**——不看安全等级、不受入场缓冲限制。
   *  ⚠ 破例是**两半**：暴露收集侧要把占领区收进来（`collectExposures` 的 `includeOccupiedAt`，
   *  否则中安/高安占领区连一次暴露都没有），概率侧再按入侵口径掷（本函数下面的 `invaded` 分支）。 */
  const invadedOf = (galaxyId: string): boolean => weekendEncounterAllowedIn(state, galaxyId, nowWallMs)
  for (const exp of collectExposures(state, ctx, nowWallMs)) {
    const invaded = invadedOf(exp.galaxyId)
    const since = state.lowSecPresence[exp.galaxyId]
    // 扫描即暴露：不受入场缓冲限制（含无在场记录的情形；船长 2026-09-05 定）
    const isScan = exp.kind === '扫描'
    if (!isScan && !invaded && (since === undefined || state.gameMs - since < bal.entryBufferMs)) continue
    const cd = state.encounterZoneCooldown[exp.galaxyId] ?? 0
    if (state.gameMs < cd) continue
    const sec = secOf(ctx, exp.galaxyId)
    // 概率曲线零点 = **低安上限**（`lowSecMax`，2026-09-12 船长定值 0）：
    // sec=0 → 5%（基线）、sec=−1 → 20%（0.05 + 0.15×1），与 balance 段注释的定义一致。
    let p: number
    if (invaded) {
      // **周末入侵**：占领区一律高频遇袭（中安/高安破例）；`p = 60%×(1−进度)`（口径定稿 #4）
      p = weekendEncounterChanceAt(state, state.weekendEvent!, exp.galaxyId, nowWallMs)
    } else {
      // 概率曲线零点 = **低安上限**（`lowSecMax`，2026-09-12 船长定值 0）：
      // sec=0 → 5%（基线）、sec=−1 → 20%（0.05 + 0.15×1），与 balance 段注释的定义一致。
      p = Math.min(0.9, bal.ambushChanceAtZero + bal.ambushChancePerSec * Math.min(1.5, Math.max(0, bal.lowSecMax - sec)))
      if (isScan) p = Math.min(0.9, p * (bal.scanAmbushMul ?? 1)) // 扫描低安：遇袭概率 ×scanAmbushMul
    }
    // 2026-09-08（星际奇遇学缩短事件间隔）：事件到点更密 → 单次遇袭率 ×cadenceScale，
    // 使"每小时遇袭期望"保持与无技能基线一致（船长定：按期望值不变进行修改）
    if (cadenceScale < 1) p = Math.min(0.9, p * Math.max(0, cadenceScale))
    if (nextRandom(state.rng) >= p) continue
    if (spawnEncounter(state, ctx, exp)) return true // 一次到点至多一次遭遇（占用本段事件时机）
    // 该星系无可见悬赏敌群 = 无海盗活动 → 不伏击，继续看其它暴露（不占用事件时机）
  }
  return false
}

/** 命中 → 产生一次遭遇（2026-09-09：伏击敌群 = 事发星系可见悬赏敌群随机抽一个；无池 = 不伏击）。
 * 返回是否真正产生（占用区域冷却与事件时机）。 */
export function spawnEncounter(state: GameState, ctx: SimContext, exp: Exposure, nowWallMs = Date.now()): boolean {
  const bal = ctx.balance.encounter
  const pool = localBountyPoolOf(ctx, exp.galaxyId, state, nowWallMs)
  if (pool.length === 0) return false
  const ev = state.weekendEvent
  const invaded = weekendEncounterAllowedIn(state, exp.galaxyId, nowWallMs)
  /**
   * 被占星系：**敌卡 = 每场从该区域池里重抽的那支入侵舰队**，强度 ×0.75（船长 2026-09-25：
   * 「外围玩家主动出击和被动遇袭都是从骚扰和袭击舰队中抽取。核心区，则是抽取袭击和主力舰队。」
   * ＋「遇袭的时候遭遇的敌人按强度\*0.75算」）——威胁标签由 `weekendAmbushPickOf` 按**缩放后实测价**给出。
   * 非占领区：照旧"当地可见悬赏池里随机抽一个"（主随机序列消费量也不变）。
   */
  const ambushPick = invaded && ev ? weekendAmbushPickOf(state, ctx, exp.galaxyId, nowWallMs) : null
  const weekendFoe = ambushPick ? ctx.anomalies.get(ambushPick.cardId) : undefined
  const foe = weekendFoe ?? pickOne(state.rng, pool)!
  /** 遭遇里存**原卡 id**（去掉入侵派生前缀；H 独立卡本就无前缀、id 可直接解析） */
  const foeId = foe.id.startsWith(WEEKEND_CARD_PREFIX) ? foe.id.slice(WEEKEND_CARD_PREFIX.length) : foe.id
  const foeName = foe.name
  state.encounterZoneCooldown[exp.galaxyId] = state.gameMs + bal.zoneCooldownMs
  const shipName = shipDisplayName(state, ctx, exp.shipId)
  state.encounter = {
    active: true,
    shipId: exp.shipId,
    galaxyId: exp.galaxyId,
    name: foeName,
    threat: Math.max(1, ambushPick?.threat ?? foe.threat),
    anomalyId: foeId,
    origin: `${shipName} · ${exp.kind}`,
    invitedAtGameMs: state.gameMs,
    deadlineGameMs: state.gameMs + bal.inviteWaitMs,
    battle: null,
    ...(ambushPick ? { foeStrengthMul: ambushPick.strengthMul } : {}),
  }
  const galaxyName = ctx.galaxies.get(exp.galaxyId)?.name ?? exp.galaxyId
  /**
   * 文案两支：**占领区**（`ambushPick` 非空 = 活的占领区）说「入侵遭遇」——被占星系可能是中安/高安，
   * 说"低安"就是错的（这情形由"占领区破例"引入）；其余照旧老文案一字不动。新支走 id 制。
   */
  if (ambushPick) {
    addLog(
      state,
      'warn',
      `⚠ 入侵遭遇（${galaxyName}·「${foe.name}」）：${shipName} 遭该编队伏击——可「迎战」或「快速脱离」；60 秒未处置将自动脱离。`,
      'core.encounters.008',
      { p1: galaxyName, p2: foe.name, p3: shipName },
    )
  } else {
    addLog(
      state,
      'warn',
      `⚠ 低安遭遇（${galaxyName}·「${foe.name}」）：${shipName}（${exp.kind}中）遭该编队伏击——可「迎战」或「快速脱离」；60 秒未处置将自动脱离。`,
    )
  }
  return true
}

/** 战斗用敌群键：新遭遇 = 伏击敌群 anomalyId；旧档遗留（无 anomalyId）= 威胁就近兜底档 */
export function foeKeyOf(enc: GameState['encounter']): string {
  return enc.anomalyId ?? tierIdOf(Math.max(1, enc.threat))
}
