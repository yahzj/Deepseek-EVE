/**
 * 星图探索（V13，设计已确认；2026-09-15 船长定案「扫描星系不占主控」）：
 *
 * 规则（中文说明）：
 * - 迷雾 = 只显示"已探索"星系（exploredGalaxies，初始只有母港）+ 其一跳邻居（frontier 剪影）；
 *   再往后的星系完全不渲染；frontier 连向更远处的通道只画半段虚化（UI 层处理）。
 * - 点亮途径一：**到达点亮**——任何船实际抵达目标星系（远征到港开战 / 矿船到远处矿带开工）；
 *   在途作业（读档恢复等）由 ensureTransitExplored 运行时兜底自动点亮。
 * - 点亮途径二：**扫描探索**（startScan）——**派出一艘无人深空扫描艇**对剪影星系就地深空扫描
 *   （去程已取消，无航行等待）：窗口走完即点亮并**当场收尾**（2026-09-15 起没有返航段）。
 * - **扫描不占主控、也不牵动舰船**（船长 2026-09-15：「玩家扫描星系将不再占用玩家的主控活动
 *   （也不显示在主控活动里，而是在 AI 活动的图标右侧显示一个进度条…）」）：扫描期间玩家照常
 *   采矿 / 打捞 / 远征 / 长途运输 / 快递投送 / 掩护巡逻 / 亲自开炉·开线 / 进虫洞，反过来这些
 *   在跑时也能派扫描艇（**双向放行**）；扫描艇是无人艇 ⇒ 不出发、不返航、不停靠、不卸货，
 *   玩家舰船与其所在位置（`awayGalaxy` / `dockedSite`）全程不动。
 * - **扫描不再让玩家暴露**（无人艇不在场 ⇒ 不会因扫描挨打）；但扫描期间随机事件倒计时**照旧**按
 *   `balance.events.exploreBoost` 加速、事件**照旧**从"探索发现"池抽取（见 events.ts EXPLORE_EVENTS）
 *   —— 口径 = 扫描艇把前方的信号传了回来。
 * - **完成待查看**：窗口完成时置 `scanning.awaitingView`，顶部活动栏的扫描条留格高亮，
 *   直到玩家进「星图」看过（`acknowledgeScanView` 收条）。
 * - 行动封锁：目标星系未点亮（且非母港）时，远征出发 / 该星系矿带开采 / AI 派发均拒绝。
 */
import { addLog, HOME_GALAXY_ID } from './state'
import type { GameState } from './state'
import type { SimContext } from './types'
import type { CommandResult } from './engine'

/** 扫描探索的就地扫描窗口（毫秒；时间类参数若需调参可挪入 balance） */
export const SCAN_WINDOW_MS = 10 * 60_000
/**
 * **母港的扫描窗口 = 10 秒**（2026-09-18 船长：「**扫描母港的时间缩短至10秒**」）。
 *
 * 由来：新档第一步就是扫母港（母港开局与其他星系一样未知），而那一步是**唯一的起步前置**——
 * 10 分钟的窗口意味着开局先干等十分钟。故母港固定 10 秒，**不吃技能系数、不吃低安惩罚**
 * （它是一次性的"起步门"，不是可反复优化的作业）。其余星系照旧走 10 分钟基准 × 技能 × 低安。
 */
export const HOME_SCAN_WINDOW_MS = 10_000
/** 低安扫描时长惩罚系数（船长 2026-09-05 定：目标星系 sec < 0.5 时，窗口 ×[1 + 0.8×(0.5−sec)]；
 *  sec=0 时 ×1.4，线性；高安(≥0.5)不延长） */
/**
 * **低安扫描惩罚系数**（`lowPen = 1 + 本值 × (0.5 − 安全)`，安全 < 0.5 起生效）。
 *
 * ⚠ **2026-09-23 船长令**：「**将各星系（排除大鲸鱼Ⅳ）扫描需要时间提高到 10 分钟 ~ 24 小时**」
 * ⇒ 选**甲（线性，沿用现形状只放大系数）**：取 `143 / 1.5 = 95.333…` ⇒ 最深星系（安全 −1.0）
 * `lowPen = 1 + 95.333 × 1.5 = 144` ⇒ **10 分钟 × 144 = 24 小时**（上一版系数 0.8 ⇒ 最长 22 分钟）。
 * 母港（大鲸鱼Ⅳ）仍**固定 10 秒**、不吃本系数（船长同日排除）。
 * 技能照旧乘算（信号分析学／信号过滤学／星图测绘学，各封顶 5 级，满级 ×0.294）⇒
 * 满技能下最深星系约 **7 时 03 分**；本区间说的是**无技能基准**。
 */
export const SCAN_LOWSEC_PENALTY = 143 / 1.5
/** 全游戏安全等级下限（`data/universe.ts` 最危险的星系 = −1.0）——用于算扫描窗口的**合法上限** */
export const SEC_FLOOR = -1

/**
 * 扫描窗口的**合法上限**（毫秒；无技能 + 最危险星系）＝ `SCAN_WINDOW_MS` ×(1 + 95.333×(0.5−(−1))) = **×144 = 24 小时**。
 * 用途：**读档兜底**——`save.normalizeState` 没有 ctx、拿不到目标星系的安全等级，只能按"全游戏可能出现的
 * 最大有效窗口"钳制；**不能**拿基准 `SCAN_WINDOW_MS` 去钳，否则低安星系（窗口最长 24 小时）的续扫进度
 * 会在读档时被截断（2026-09-11 修复）。技能只缩短窗口，故上限与技能无关。
 */
export function maxScanWindowMs(): number {
  return Math.round(SCAN_WINDOW_MS * (1 + SCAN_LOWSEC_PENALTY * (0.5 - SEC_FLOOR)))
}

/** 信号分析学（−8%/级）× 信号过滤学（−6%/级）× 星图测绘学（−6%/级）乘算：扫描窗口技能系数
 * （2026-09-08 船长定：移除「总下限 40%」护栏；三技能封顶 5 级乘积 0.294，乘算本身有界）
 * 2026-09-11 船长裁决：星图测绘学原本承诺「前往扫描点的航行耗时 −6%/级」，但扫描任务的**去程早已取消**
 * （就地展开、总时长 = 就地扫描窗口），该技能自那以后全仓无引用 = 练了没用；现按「乙」接活到**就地扫描窗口**，
 * 与信号分析学/信号过滤学同处乘算叠加（三技能满级：10 分钟窗口 → 约 2.9 分钟）。 */
export function scanSkillFactor(state: GameState): number {
  const aLv = Math.min(5, state.skills.trained['signal-analysis'] ?? 0)
  const bLv = Math.min(5, state.skills.trained['signal-filtering'] ?? 0)
  const cLv = Math.min(5, state.skills.trained['cartography'] ?? 0)
  return Math.max(0, (1 - 0.08 * aLv) * (1 - 0.06 * bLv) * (1 - 0.06 * cLv))
}

/** 扫描窗口（毫秒；不含低安惩罚；旧签名保留给不关心目标星系的调用） */
export function scanWindowMsOf(state: GameState): number {
  return Math.round(SCAN_WINDOW_MS * scanSkillFactor(state))
}

/** 目标星系的实际扫描窗口（毫秒）：技能缩短 × 低安安全度惩罚（船长 2026-09-05；**深度 2026-09-23 船长令上调到 10 分钟~24 小时**）；
 *  **母港例外 = 固定 10 秒**（船长 2026-09-18：「扫描母港的时间缩短至10秒」） */
export function scanWindowMsFor(state: GameState, ctx: SimContext, galaxyId: string): number {
  if (galaxyId === HOME_GALAXY_ID) return HOME_SCAN_WINDOW_MS
  const galaxy = ctx.galaxies.get(galaxyId)
  const sec = galaxy?.security ?? 1
  const lowPen = sec < 0.5 ? 1 + SCAN_LOWSEC_PENALTY * (0.5 - sec) : 1
  return Math.round(SCAN_WINDOW_MS * scanSkillFactor(state) * lowPen)
}

/** 某星系是否已探索（⚠ **2026-09-17 起母港不再恒为真**：新档连母港都是未知的，见 `createInitialState`） */
export function isExplored(state: GameState, galaxyId: string): boolean {
  return state.exploredGalaxies.includes(galaxyId)
}

/** 把星系标记为已探索；返回是否新点亮（去重） */
export function markExplored(state: GameState, galaxyId: string): boolean {
  if (isExplored(state, galaxyId)) return false
  state.exploredGalaxies.push(galaxyId)
  return true
}

/**
 * 未探索但"可扫描"的星系 id 列表（星图剪影 = 可扫描对象）。
 *
 * ⚠ **2026-09-17 船长改口径**：「初始将母港星系设置为和其他星系一样的未知状态，需要扫描才有悬赏和挖矿」
 * ⇒ 新档 `exploredGalaxies` 为空、连母港都没点亮，而"邻接已探索"这条规则在**零探索时会返回空**
 * （没有任何已探索的邻接点）⇒ 会出现"无处可扫"的死锁。故这里补一条种子：
 * **未探索的母港本身永远是候选**（它就是新玩家的第一个扫描目标）。母港一旦点亮，本行自然失效。
 */
export function frontierGalaxyIds(state: GameState, ctx: SimContext): string[] {
  const seen = new Set<string>(state.exploredGalaxies)
  const out: string[] = []
  if (!seen.has(HOME_GALAXY_ID) && ctx.galaxies.has(HOME_GALAXY_ID)) out.push(HOME_GALAXY_ID)
  for (const edge of ctx.galaxyEdges) {
    const aIn = seen.has(edge.from)
    const bIn = seen.has(edge.to)
    if (aIn !== bIn) {
      const id = aIn ? edge.to : edge.from
      if (!seen.has(id) && !out.includes(id)) out.push(id)
    }
  }
  return out
}

/** 行动封锁检查：返回不可行动原因；null = 可行动（已探索星系不受限）
 *  ⚠ **2026-09-17 起母港也要探索**：原先这里对母港直接放行，与"母港未知"的新口径冲突（同日删除）。 */
export function actionBlockReason(state: GameState, galaxyId: string | null | undefined): string | null {
  if (!galaxyId) return null
  if (isExplored(state, galaxyId)) return null
  return '该星系尚未探索——先对星图上的「未知信号」执行扫描探索。'
}

/** 引擎内部：在途作业兜底点亮（读档恢复/老档迁移后，船已经在路上的星系视为已探明航路） */
export function ensureTransitExplored(state: GameState, ctx: SimContext): void {
  if (state.mining.active) {
    const belt = state.mining.beltId ? ctx.belts.get(state.mining.beltId) : undefined
    if (belt?.galaxyId) markExplored(state, belt.galaxyId)
  }
  if (state.salvaging.active && state.salvaging.galaxyId) {
    markExplored(state, state.salvaging.galaxyId)
  }
  if (state.expedition.active && state.expedition.anomalyId) {
    const anomaly = ctx.anomalies.get(state.expedition.anomalyId)
    if (anomaly?.galaxyId) markExplored(state, anomaly.galaxyId)
  }
  for (const assignment of Object.values(state.aiAssignments)) {
    const task = assignment.task
    if (task.kind === 'mining') {
      const belt = ctx.belts.get(task.beltId)
      if (belt?.galaxyId) markExplored(state, belt.galaxyId)
    } else if (task.kind === 'expedition') {
      const anomaly = ctx.anomalies.get(task.anomalyId)
      if (anomaly?.galaxyId) markExplored(state, anomaly.galaxyId)
    } else if (task.kind === 'standby') {
      markExplored(state, task.galaxyId)
    }
  }
}

/**
 * 玩家指令：对剪影星系**派出一艘无人深空扫描艇**。
 *
 * 校验（2026-09-15 起只剩三条）：
 * ① 目标存在且未点亮；② 目标在已知航线边缘（frontier，信息可达）；③ **空闲扫描艇只有一艘**
 * —— 同一时刻只能扫一处（进 `state.scanning` 单槽）。
 *
 * ⚠ **有意不再检查主控活动**（船长 2026-09-15 定案「1A 双向放行」）：采矿 / 打捞 / 远征 /
 * 长途运输 / 快递 / 掩护巡逻 / 亲自开炉·开线 / 进洞**在跑时也能派扫描艇**，扫描期间也能开它们
 * —— 扫描艇是无人艇，与主控手上那件事互不相干（反向的十几处"扫描探索中：先终止扫描"已一并删除）。
 * 舰船位置同样不参与：本指令**不碰** `awayGalaxy` / `dockedSite`，也不要求主控空闲。
 *
 * 去程早已取消（定稿）：下达即就地展开深空扫描（finishAt = gameMs + 剩余扫描窗口）。
 */
export function startScan(state: GameState, galaxyId: string, ctx: SimContext): CommandResult {
  const galaxy = ctx.galaxies.get(galaxyId)
  if (!galaxy) {
    return { ok: false, error: `未知星系：${galaxyId}。`, errorId: 'core.state.024', errorParams: { p1: galaxyId } }
  }
  if (isExplored(state, galaxyId)) {
    return {
      ok: false,
      error: `「${galaxy.name}」已在星图中点亮，无需扫描。`,
      errorId: 'core.explore.001',
      errorParams: { p1: galaxy.name },
    }
  }
  if (!frontierGalaxyIds(state, ctx).includes(galaxyId)) {
    return {
      ok: false,
      error: '该星系不在已知航线边缘，无法直接扫描——先探索它相邻的星系。',
      errorId: 'core.explore.002',
    }
  }
  if (state.scanning.active) {
    return {
      ok: false,
      error: '扫描艇正在执行另一处扫描：等它扫完，或先在星图页「终止扫描」（已扫部分会保留）。',
      errorId: 'core.explore.003',
    }
  }

  // 调试模式 debugQuick：扫描固定 1 秒完成
  if (state.debugQuick) {
    const sq = state.scanning
    sq.active = true
    sq.galaxyId = galaxyId
    sq.startedAtGameMs = state.gameMs
    sq.finishAtGameMs = state.gameMs + 1000
    sq.originGalaxy = null
    sq.returning = false
    addLog(state, 'info', '已派出深空扫描艇：1 秒后录入情报。', 'core.explore.004')
    return { ok: true }
  }
  // v14 续扫：终止过的星系只补扫剩余窗口（已完成部分保存在 state.scanProgress；窗口按信号分析学折算）
  const effWin = scanWindowMsFor(state, ctx, galaxyId)
  const doneMs = Math.min(effWin - 1, Math.max(0, Math.floor(state.scanProgress[galaxyId] ?? 0)))
  const remainWindowMs = effWin - doneMs
  const totalMs = remainWindowMs // 去程取消：总时长 = 就地扫描窗口（无航行段）
  const s = state.scanning
  s.active = true
  s.galaxyId = galaxyId
  s.startedAtGameMs = state.gameMs
  s.finishAtGameMs = state.gameMs + totalMs
  s.originGalaxy = null // T8 兼容字段：无人扫描艇不涉及出发地 ⇒ 恒 null
  s.returning = false
  // 2026-09-12 船长裁定（「0 也算低安」）：低安 / 中安只影响**扫描快慢**；2026-09-15 起扫描不再暴露
  // ⇒ 旧文案里"更容易被巡逻盯上"一句删除（无人艇不在场，没得打），遇袭只发生在玩家自己所在的作业里。
  const secOfTarget = galaxy?.security ?? 1
  const riskNote =
    secOfTarget < 0.5 ? '该星系信号嘈杂、扫描偏慢。' : '扫描期间更容易碰到有趣的东西。'
  addLog(
    state,
    'info',
    doneMs > 0
      ? `已派扫描艇续扫「${galaxy.name}」（就地扫描已完成 ${Math.round((doneMs / effWin) * 100)}%）：本次只需补扫剩余 ${Math.round(remainWindowMs / 60_000)} 分钟窗口。${riskNote}扫描不占主控——期间照常安排别的活动。`
      : `已派出深空扫描艇扫描「${galaxy.name}」：预计 ${Math.round(totalMs / 60_000)} 分钟后录入情报并点亮星图。${riskNote}扫描不占主控——期间照常安排别的活动。`,
  )
  return { ok: true }
}

/** 引擎内部：扫描窗口完成——点亮星系、清续扫进度、置"待查看"高亮位；**当场收尾**（无人扫描艇没有返航段）。
 *  advance 与"终止时窗口恰好完成"共用。 */
function finishScan(state: GameState, ctx: SimContext): void {
  const s = state.scanning
  const galaxy = s.galaxyId !== null ? ctx.galaxies.get(s.galaxyId) : undefined
  if (s.galaxyId !== null) delete state.scanProgress[s.galaxyId]
  const targetId = s.galaxyId
  const newly = galaxy ? markExplored(state, galaxy.id) : false
  const name = galaxy?.name ?? '未知星系'
  s.active = false
  s.galaxyId = null
  s.returning = false
  s.finishAtGameMs = 0
  s.startedAtGameMs = 0
  s.originGalaxy = null
  // 待查看：顶部扫描条留格高亮，等玩家进「星图」看过才收起（acknowledgeScanView）
  s.awaitingView = true
  s.lastGalaxyId = targetId
  addLog(
    state,
    'info',
    newly
      ? `✦ 扫描完成：「${name}」的情报已录入星图——航线、矿带与悬赏信息全部解锁（扫描艇已收回）。`
      : `✦ 扫描完成：「${name}」的补扫完成，没有发现新的信息（扫描艇已收回）。`,
    newly ? 'core.explore.008' : 'core.explore.009',
    { p1: name },
  )
}

/**
 * 玩家指令：**召回扫描艇**（终止本次扫描）。
 * 已扫部分按生效窗口比例存进 `state.scanProgress` ⇒ 下次对该星系只补扫剩余窗口。
 * 2026-09-15 起：不牵动舰船（不返航、不停靠），也没有"已完成正在返航不可终止"那一档
 * —— 那时扫描早已收尾（`finishScan`）。
 */
export function stopScan(state: GameState, ctx: SimContext): CommandResult {
  const s = state.scanning
  if (!s.active) return { ok: false, error: '当前没有进行中的扫描。', errorId: 'core.explore.005' }
  const gid = s.galaxyId
  if (gid === null) {
    s.active = false
    return { ok: false, error: '扫描状态异常，已自动清理。', errorId: 'core.explore.006' }
  }
  const galaxy = ctx.galaxies.get(gid)
  const galaxyName = galaxy?.name ?? gid
  const totalMs = Math.max(1, s.finishAtGameMs - s.startedAtGameMs)
  const elapsed = Math.max(0, state.gameMs - s.startedAtGameMs)
  // 窗口已完整走完（同帧推进边界）：直接结算点亮并收尾
  if (elapsed >= totalMs) {
    finishScan(state, ctx)
    return { ok: true }
  }
  const effWin = scanWindowMsFor(state, ctx, gid)
  const doneMs = Math.min(effWin - 1, Math.max(0, Math.floor(state.scanProgress[gid] ?? 0)))
  const keep = Math.min(effWin - 1, doneMs + elapsed)
  s.active = false
  s.galaxyId = null
  s.finishAtGameMs = 0
  s.startedAtGameMs = 0
  s.originGalaxy = null
  s.returning = false
  if (keep > 0) {
    state.scanProgress[gid] = keep
    addLog(
      state,
      'info',
      `已召回扫描艇：对「${galaxyName}」的就地扫描完成 ${Math.round((keep / effWin) * 100)}%，进度已保存——下次对该星系扫描只需补扫剩余窗口。`,
    )
  } else {
    addLog(
      state,
      'info',
      `已召回扫描艇：对「${galaxyName}」的扫描尚未产生进度，随时可以重发。`,
      'core.explore.007',
      { p1: galaxyName },
    )
  }
  return { ok: true }
}

/** 扫描进度查询（UI：百分比与剩余毫秒） */
export function scanStatus(state: GameState): {
  active: boolean
  galaxyId: string | null
  totalMs: number
  remainingMs: number
  percent: number
} {
  const s = state.scanning
  if (!s.active || s.galaxyId === null) {
    return { active: false, galaxyId: null, totalMs: 0, remainingMs: 0, percent: 0 }
  }
  const totalMs = Math.max(1, s.finishAtGameMs - s.startedAtGameMs)
  const remainingMs = Math.max(0, s.finishAtGameMs - state.gameMs)
  return {
    active: true,
    galaxyId: s.galaxyId,
    totalMs,
    remainingMs,
    percent: Math.min(100, Math.max(0, ((totalMs - remainingMs) / totalMs) * 100)),
  }
}

/**
 * **"扫描已完成、待查看"态**（船长 2026-09-15：完成后进度条依旧存在并高亮，直到玩家进星图查看）。
 * `null` = 没有待查看的（没扫完 / 已经看过了）。UI（顶部扫描条）据此把格子点亮。
 */
export function scanAwaitingView(state: GameState): { galaxyId: string | null } | null {
  return state.scanning.awaitingView === true ? { galaxyId: state.scanning.lastGalaxyId ?? null } : null
}

/** 玩家进「星图」看过 ⇒ 收掉高亮；返回是否真的收掉了（本来就没亮 ⇒ false，不写日志、不落档） */
export function acknowledgeScanView(state: GameState): boolean {
  if (state.scanning.awaitingView !== true) return false
  state.scanning.awaitingView = false
  return true
}

/** 引擎内部：扫描作业推进（窗口到点 → 点亮 + 收尾；2026-09-15 起无返航段） */
export function advanceScanning(state: GameState, ctx: SimContext): void {
  const s = state.scanning
  if (!s.active || s.galaxyId === null) return
  if (state.gameMs < s.finishAtGameMs) return
  finishScan(state, ctx)
}
