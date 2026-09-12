/**
 * 长途运输（2026-09-09 船长定稿：docs/design/announcement-draft-20260909 之外的新玩法）：
 * 玩家驾驶船在两座「已建成」站点（母港 ⇄ 副站 / 副站 ⇄ 副站）之间做真实航程的往返运输，
 * 循环自动续跑（与悬赏「重复清剿」同款体验），可随时"到站即停"。
 *
 * - 航行 = 真实航程：每段都按 travelLegMs 实际飞行（吃航行技能；调试模式 1 秒/段），
 *   不做"去程并入返程"式折算（船长定）。
 * - 货物为**虚拟满载**：开始任务时把驾驶船货仓自动卸空入仓库，任务期间货仓容量被"运输货物"
 *   全部占用（不产生任何真实物品，杜绝货物入库类 bug）；到站结算报酬后自动续下一段。
 * - 报酬（**2026-09-12 船长定：安全档收益率 + 距离指数**，取代"与航线长短无关"旧口径）：
 *   单段报酬 = 货仓容量 × `HAUL_RATE_PER_M3_MIN`（0.6）× 锚定航线标称分钟 × (**有效距离** ÷ 锚定有效距离)^**1.5**
 *   × 每趟行情倍率 r ∈ [5,10]（`HAUL_TRIP_MUL_MIN/MAX`，一趟往返掷一次、**两段同价**）。
 *   **有效距离** = 沿最短路**逐跳**累加「该跳分钟 × 该跳收益率系数」，每跳系数 = 该跳两端里**安全等级较低
 *   （更危险）**那一端的系数，星系系数 = 高安 **0.5** / 中安 **0.75** / 低安 **1**（`balance.haul`；
 *   档位走 `securityZoneOf` 单点）。
 *   ⇒ ① **单段总报酬只取决有效距离**（航程时间不进报酬）；② 距离指数 1.5 > 1 ⇒ **"1+1<2"**：
 *   跑完整一段长途比拆成两段跑更赚（拆开只值整段的 68%）；③ 安全走廊被折算得更短 ⇒ 高安线时薪更低。
 *   面板只显示**区间**（不预告本趟掷出的实际值），到站结算时才入账并写日志。
 * - 标定（船长 2026-09-12）：**锚定航线 = 母港 ⇄ 烬火前哨站**（标称 10 分钟、有效距离 7.75）
 *   ⇒ 该线时薪 **648,000 ISK/h 逐字不变**，其余航线按比例削弱（母港⇄红环 7′ → 409,000/h ≈ −37%）。
 *   两条锚定常数在 `balance.haul`，由 `content:check`「长途运输锚定契约」守住不漂。
 * - **2026-09-11 船长改口径沿革**：① 先定「时间 ×15、收益 ×10」（固定倍率）；② 随后「价格回调，
 *   重新定位 5~10 倍的价格波动，并要求在长途运输任务内显示」⇒ 撤销固定 ×10，改为**每趟掷 5~10 倍**。
 *   航行技能照旧缩短实际时长（`travelMinutesEff`）。⚠ **2026-09-12 船长「删除下限」**：原 `minFactor 0.35`
 *   的下限已移除（旧口径下 105 分钟的实际下限约 37 分钟，且**只卡快船** ⇒ 航行族 3 级起飞鱼级与剑鱼级
 *   单程时间完全相同）；现**船速差与技能收益都按比例完整体现**，见 `travel.ts`.
 * - 互斥：任务中驾驶船忙碌（等同远征），各出港/站内手动作业入口拒绝；换驾驶 = 立即终止
 *   （虚拟货无残留、无惩罚）；AI 副船本版不支持。
 */
import { addLog, HOME_GALAXY_ID } from './state'
import type { CommandResult } from './engine'
import type { GameState, HaulingState } from './state'
import type { SimContext } from './types'
import { shortestTravelPath, shortestTravelMinutes, travelLegMs, travelMinutesEff } from './travel'
import { securityZoneOf } from './sideTasks'
import { cargoCapacityM3Of, unloadCargoOfShipToWarehouse } from './inventory'
import { siteProgress } from './station'
import { shipDisplayName } from './instances'
import { nextRandom } from './rng'

/**
 * 运输基准费率：ISK / (m³ × **锚定航线标称分钟**)。= 改口径前的原值 0.6（2026-09-11 二次定案）。
 * ⚠ 2026-09-12 起它不再直接乘"本段标称分钟"——见 `haulBaseReward`（安全档 + 距离指数 1.5）。
 */
export const HAUL_RATE_PER_M3_MIN = 0.6

/** 航段时间倍率（2026-09-11 船长：「所需时间提高」）——标称航程分钟 ×本值 = 实际航段分钟；**保留不变** */
export const HAUL_LEG_TIME_MUL = 15

/** 每趟行情倍率区间（2026-09-11 船长：「重新定位 5~10 倍的价格波动」）——一趟往返掷一次，两段同价 */
export const HAUL_TRIP_MUL_MIN = 5
export const HAUL_TRIP_MUL_MAX = 10

/** 标称航程分钟 → 运输航段分钟（×`HAUL_LEG_TIME_MUL`，至少 1 分钟；面板/引擎同用这一处口径） */
export function haulLegMinutesOf(nominalMinutes: number): number {
  return Math.max(1, Math.round(nominalMinutes * HAUL_LEG_TIME_MUL))
}

/* ═══════════ 2026-09-12 船长定：安全档收益率 + 距离指数（取代"与航线长短无关"旧口径） ═══════════ */

/** 某星系的运输收益率系数（高安 0.5 / 中安 0.75 / 低安 1；档位判定走 `securityZoneOf` 单点） */
export function haulSecurityMulOf(ctx: SimContext, galaxyId: string): number {
  return ctx.balance.haul.securityMul[securityZoneOf(ctx, galaxyId)]
}

/**
 * 单段**有效距离**（分钟）：沿引擎选定的最短路**逐跳**累加「该跳分钟 × 该跳收益率系数」，
 * **每跳系数 = 该跳两端里「安全等级较低（更危险）」那一端的系数**（＝系数较大者；船长 2026-09-12 选定 C 案）。
 * 与"标称分钟"的差 = 档位稀释：高安/中安密集的走廊会被折算得更短（母港⇄红环 7 → 4.5）。
 */
export function haulEffectiveMinutes(ctx: SimContext, fromGalaxyId: string, toGalaxyId: string): number {
  const path = shortestTravelPath(ctx, fromGalaxyId, toGalaxyId)
  if (path.galaxies.length < 2) return 0
  let sum = 0
  for (let i = 0; i + 1 < path.galaxies.length; i++) {
    const a = path.galaxies[i]!
    const b = path.galaxies[i + 1]!
    sum += path.hopMinutes[i]! * Math.max(haulSecurityMulOf(ctx, a), haulSecurityMulOf(ctx, b))
  }
  return sum
}

/** 两站之间的有效距离（端点站点 → 所在星系；null = 母港） */
function effectiveMinutesBetween(ctx: SimContext, aId: string | null, bId: string | null): number {
  return haulEffectiveMinutes(ctx, endpointGalaxy(ctx, aId), endpointGalaxy(ctx, bId))
}

/**
 * 单段**基准**报酬 = 货仓 × `HAUL_RATE_PER_M3_MIN` × 锚定航线标称分钟 × (有效距离 ÷ 锚定有效距离)^距离指数
 * （不含行情倍率；floor 取整）。
 *
 * 等价于旧式「货仓 × 0.6 × 本段标称分钟 × 形状因子 G」（G = (D/D锚)^p × (标称锚/标称)）——
 * **标称分钟被锚定常数吸收** ⇒ **单段总报酬只取决有效距离**（时间不进报酬）。这正是"1+1<2"的来源：
 * 拆两段跑时「两段有效距离的 p 次幂之和」< 「整段有效距离的 p 次幂」。
 * 标定：锚定航线（母港 ⇄ 烬火前哨站，D = 7.75）时薪 **648,000 ISK/h 逐字不变**，其余航线按比例削弱。
 */
export function haulBaseReward(ctx: SimContext, capacityM3: number, effectiveMinutes: number): number {
  const bal = ctx.balance.haul
  if (!(effectiveMinutes > 0) || !(bal.anchorEffectiveMinutes > 0)) return 0
  const shape = Math.pow(effectiveMinutes / bal.anchorEffectiveMinutes, bal.distExp)
  return Math.floor(capacityM3 * HAUL_RATE_PER_M3_MIN * bal.anchorNominalMinutes * shape)
}

/** 单段实付报酬 = 基准 × 本趟行情倍率（每趟一个倍率、两段同价；floor 取整） */
export function haulLegReward(ctx: SimContext, capacityM3: number, effectiveMinutes: number, tripMul: number): number {
  return Math.floor(haulBaseReward(ctx, capacityM3, effectiveMinutes) * tripMul)
}

/** 单段报酬**区间**（面板只显示这个，不预告本趟实际掷值——船长 2026-09-11：「只显示区间」） */
export function haulRewardRange(ctx: SimContext, capacityM3: number, effectiveMinutes: number): { min: number; max: number } {
  const base = haulBaseReward(ctx, capacityM3, effectiveMinutes)
  return { min: Math.floor(base * HAUL_TRIP_MUL_MIN), max: Math.floor(base * HAUL_TRIP_MUL_MAX) }
}

/** 掷一次行情倍率（均匀 [5,10]，保留 1 位小数便于日志阅读）；消耗一次 rng（存档可复现） */
function rollTripMul(state: GameState): number {
  const span = HAUL_TRIP_MUL_MAX - HAUL_TRIP_MUL_MIN
  return Math.round((HAUL_TRIP_MUL_MIN + nextRandom(state.rng) * span) * 10) / 10
}

/** 开新一趟：掷行情倍率 + 记「本趟还剩几段」（一趟往返 = 2 段；就位段自成 1 段） */
function beginTrip(state: GameState, legs: number): void {
  state.hauling.tripMul = rollTripMul(state)
  state.hauling.tripLegsLeft = Math.max(1, legs)
}

/** 站点端点（id = null 表示母港） */
export interface HaulEndpoint {
  siteId: string | null
  name: string
  galaxyId: string
}

/** 母港端点 */
const HOME_ENDPOINT: HaulEndpoint = { siteId: null, name: '母港', galaxyId: HOME_GALAXY_ID }

/** 全部"已建成"站点端点（母港 + 已建成副站；未建成不参与，沿用收口口径） */
export function haulEndpoints(state: GameState, ctx: SimContext): HaulEndpoint[] {
  const out: HaulEndpoint[] = [HOME_ENDPOINT]
  for (const site of ctx.stations.values()) {
    const prog = siteProgress(state, site.id)
    if (!prog || prog.stage < site.tiers.length) continue
    out.push({ siteId: site.id, name: site.name, galaxyId: site.galaxyId })
  }
  return out
}

/** 端点显示名（null = 母港） */
export function haulEndpointName(ctx: SimContext, siteId: string | null): string {
  if (siteId === null) return '母港'
  return ctx.stations.get(siteId)?.name ?? '空间站'
}

/** 端点所在星系 */
function endpointGalaxy(ctx: SimContext, siteId: string | null): string {
  if (siteId === null) return HOME_GALAXY_ID
  return ctx.stations.get(siteId)?.galaxyId ?? HOME_GALAXY_ID
}

/** 当前停靠的端点（未停靠任何空间站 = null） */
export function dockedHaulEndpoint(state: GameState): string | null {
  if (state.awayGalaxy !== null) return null // 野外
  return state.dockedSite // null = 母港；否则副站 id
}

/** 展示/日志用的实际航程分钟（吃航行技能与调试快进；四舍五入 ≥1） */
function effMinutesOf(state: GameState, ctx: SimContext, nominalMinutes: number): number {
  return Math.max(1, Math.round(travelMinutesEff(state, ctx, nominalMinutes)))
}

/** 空态 */
function emptyHauling(): HaulingState {
  return {
    active: false,
    routeA: null,
    routeB: null,
    fromSiteId: null,
    toSiteId: null,
    legMinutes: 0,
    legMs: 0,
    phaseAccMs: 0,
    tripMul: 0,
    tripLegsLeft: 0,
  }
}

/** 端点所在星系（null = 母港） */


/** 两站间标称航程分钟（不可达/同点 = 0） */
function minutesBetween(ctx: SimContext, aId: string | null, bId: string | null): number {
  const m = shortestTravelMinutes(ctx, endpointGalaxy(ctx, aId), endpointGalaxy(ctx, bId))
  return Number.isFinite(m) ? m : 0
}

/** 设定当前航段（from → to）：锁分钟与真实毫秒 */
function setLeg(state: GameState, ctx: SimContext, fromId: string | null, toId: string | null): boolean {
  const minutes = minutesBetween(ctx, fromId, toId)
  if (!(minutes > 0)) return false
  const h = state.hauling
  h.fromSiteId = fromId
  h.toSiteId = toId
  h.legMinutes = haulLegMinutesOf(minutes)
  h.legMs = Math.max(1, travelLegMs(state, ctx, h.legMinutes))
  h.phaseAccMs = 0
  state.dockedSite = null
  state.awayGalaxy = endpointGalaxy(ctx, fromId)
  return true
}

/**
 * 玩家指令：开始长途运输（在所选航线的两个端点间往返循环）。
 * 2026-09-09 改（船长定）：**不要求停靠在航线端点**——停靠在任意协会站点即可接单；
 * 若当前停靠不在端点，先飞一段"就位航段"到较近端点（真实航程、按段计酬），随后按
 * A⇄B 循环。须停靠空间站（母港或已建成副站；野外不能接）。
 */
export function startHauling(state: GameState, aSiteId: string | null, bSiteId: string | null, ctx: SimContext): CommandResult {
  if (state.hauling.active) return { ok: false, error: '长途运输进行中：先停止（顶部活动栏）再换线。' }
  // 前置：停靠在空间站（母港或已建成副站）
  if (state.awayGalaxy !== null) return { ok: false, error: '舰船在野外：先返航到空间站再安排长途运输。' }
  const endpoints = haulEndpoints(state, ctx)
  const a = endpoints.find((e) => e.siteId === aSiteId)
  const b = endpoints.find((e) => e.siteId === bSiteId)
  if (!a || !b) return { ok: false, error: '航线端点缺失或尚未建成——请选择两座已建成站点之间的航线。' }
  if (a.siteId === b.siteId) return { ok: false, error: '航线两端相同——请选两座不同的站点。' }
  if (minutesBetween(ctx, a.siteId, b.siteId) <= 0) {
    return { ok: false, error: '这两座站点之间没有可用航路（或同处一星系），无法运输。' }
  }
  // 忙碌互斥（与远征同级）
  if (state.mining.active) return { ok: false, error: '采矿作业进行中：先停止开采。' }
  if (state.salvaging.active) return { ok: false, error: '打捞作业进行中：先停止打捞。' }
  if (state.expedition.active) return { ok: false, error: '远征进行中：先召回或等待结束。' }
  if (state.scanning.active) return { ok: false, error: '扫描探索中：先终止扫描。' }
  if (state.standby.active) return { ok: false, error: '掩护巡逻进行中：先取消。' }
  if (state.transit.active) return { ok: false, error: '返航行程中：到站后再安排。' }
  if (state.sideTasks.deliver !== null) return { ok: false, error: '快递投送途中：到站结算后再安排。' }
  if (state.refineRuns.some((r) => r.active && r.worker === 'pilot')) {
    return { ok: false, error: '精炼炉正由你亲自运转：先停炉才能出航。' }
  }
  if (state.manufacturingRuns.some((r) => r.active && r.worker === 'pilot')) {
    return { ok: false, error: '制造作业正由你亲自开线：先取消它才能出航。' }
  }
  const cap = cargoCapacityM3Of(state, ctx, state.shipId)
  if (cap <= 0) return { ok: false, error: '当前舰船没有可用货仓，无法承运。' }
  // 自动清仓：真实货物卸入仓库（虚拟货物占满货仓，语义干净）
  const unloaded = unloadCargoOfShipToWarehouse(state, state.shipId)
  const dockHere = dockedHaulEndpoint(state) // 接单时的停靠端点（可能是航线端点，也可能不是）
  // 第一段目标：停靠即端点 → 直接对开；否则飞往较近的端点（就位段）
  let firstTo: string | null
  if (dockHere === a.siteId || dockHere === b.siteId) {
    firstTo = dockHere === a.siteId ? b.siteId : a.siteId
  } else {
    const toA = minutesBetween(ctx, dockHere, a.siteId)
    const toB = minutesBetween(ctx, dockHere, b.siteId)
    if (!(toA > 0) && !(toB > 0)) return { ok: false, error: '当前停靠点不在协会航线网内，无法接单。' }
    firstTo = toB > 0 && (toA <= 0 || toB < toA) ? b.siteId : a.siteId
  }
  const shipName = shipDisplayName(state, ctx, state.shipId)
  const h = state.hauling
  h.active = true
  h.routeA = a.siteId
  h.routeB = b.siteId
  if (!setLeg(state, ctx, dockHere, firstTo)) {
    h.active = false
    return { ok: false, error: '无法从当前位置就位到该航线——航路不可达。' }
  }
  // 本趟行情倍率（船长 2026-09-11：每趟掷一次、两段同价；就位段自成一趟，只跑 1 段）
  const isPos = dockHere !== a.siteId && dockHere !== b.siteId
  beginTrip(state, isPos ? 1 : 2)
  const { min, max } = haulRewardRange(ctx, cap, effectiveMinutesBetween(ctx, a.siteId, b.siteId))
  addLog(
    state,
    'info',
    `长途运输开始：${shipName} 承运「${a.name} ⇄ ${b.name}」（货仓 ${cap.toLocaleString('zh-CN')} m³ 满载虚拟货物）` +
      (isPos ? `——先就位驶往「${haulEndpointName(ctx, firstTo)}」` : `——单段航程约 ${effMinutesOf(state, ctx, h.legMinutes)} 分钟`) +
      `，单段报酬随行情浮动在 ${min.toLocaleString('zh-CN')} ~ ${max.toLocaleString('zh-CN')} ISK（每趟一价，到站结算）${unloaded > 0 ? `；船上原有货物已卸入仓库（${unloaded} 单位）` : ''}。`,
  )
  return { ok: true }
}

/** 玩家指令：停止长途运输（立即响应：中止当前航段并**即时返港停靠出发站**，无需返程时间；无惩罚） */
export function stopHauling(state: GameState, ctx: SimContext): CommandResult {
  const h = state.hauling
  if (!h.active) return { ok: false, error: '没有进行中的长途运输。' }
  const originId = h.fromSiteId // 本段出发站（null = 母港）
  const originName = haulEndpointName(ctx, originId)
  h.active = false
  h.routeA = null
  h.routeB = null
  h.fromSiteId = null
  h.toSiteId = null
  h.legMinutes = 0
  h.legMs = 0
  h.phaseAccMs = 0
  // 2026-09-09（船长定）：终止即瞬时返港——不再安排真实折返航程，船直接停靠回出发站
  state.awayGalaxy = null
  state.dockedSite = originId === null ? null : originId
  addLog(state, 'info', `长途运输已停止：舰船已即时返港停靠「${originName}」（无惩罚）。`)
  return { ok: true }
}

/** 引擎内部：推进长途运输（真实航程腿逐段飞行 → 到站结算 → 按所选航线自动续段） */
export function advanceHauling(state: GameState, deltaMs: number, ctx: SimContext): void {
  const h = state.hauling
  if (!h.active || deltaMs <= 0) return
  let remaining = deltaMs
  while (h.active && remaining > 0) {
    const need = Math.max(1, h.legMs - h.phaseAccMs)
    const step = Math.min(remaining, need)
    h.phaseAccMs += step
    remaining -= step
    if (h.phaseAccMs >= h.legMs) {
      const arrived = haulEndpointName(ctx, h.toSiteId)
      const cap = cargoCapacityM3Of(state, ctx, state.shipId)
      // 本段报酬 = 基准（按**有效距离**：逐跳安全档加权 + 距离指数 1.5）× 本趟行情倍率（一趟两段同价）
      const effMinutes = effectiveMinutesBetween(ctx, h.fromSiteId, h.toSiteId)
      const mul = h.tripMul > 0 ? h.tripMul : HAUL_TRIP_MUL_MIN
      const reward = haulLegReward(ctx, cap, effMinutes, mul)
      state.wallet.isk += reward
      addLog(
        state,
        'trade',
        `长途运输 · 已运抵「${arrived}」：报酬 ${reward.toLocaleString('zh-CN')} ISK 已入账（本趟行情 ×${mul.toFixed(1)}；货仓 ${cap.toLocaleString('zh-CN')} m³ · 实际航程约 ${effMinutesOf(state, ctx, h.legMinutes)} 分钟）。`,
      )
      // 到站（母港 = dockedSite null；随后立即续下一段）
      state.awayGalaxy = null
      state.dockedSite = h.toSiteId === null ? null : h.toSiteId
      const at = h.toSiteId
      const nextTo = at === h.routeA ? h.routeB : h.routeA
      // 本趟段数记账：跑完本趟（一趟往返 2 段）→ 下一段起换新行情
      h.tripLegsLeft -= 1
      if (!setLeg(state, ctx, at, nextTo)) {
        // 航线异常（端点不可达等防御）：就地结束并提示
        h.active = false
        addLog(state, 'warn', `长途运输异常终止：舰船停靠在「${arrived}」（航线端点不可达）。`)
        break
      }
      if (h.tripLegsLeft <= 0) beginTrip(state, 2)
      const departTo = haulEndpointName(ctx, h.toSiteId)
      addLog(state, 'info', `长途运输继续：已装载前往「${departTo}」（虚拟货物，货仓占满）。`)
    }
  }
}

/** 引擎内部：换驾驶时终止长途运输（虚拟货无残留、无惩罚；不额外安排返航——旧船停靠位置即结束） */
export function cancelHaulingOnSwitch(state: GameState, ctx: SimContext): void {
  if (!state.hauling.active) return
  const wasTo = haulEndpointName(ctx, state.hauling.toSiteId)
  state.hauling = emptyHauling()
  state.dockedSite = null
  state.awayGalaxy = null
  addLog(state, 'info', `长途运输已随切换驾驶终止（原航线「… → ${wasTo}」；虚拟货物无残留、无惩罚）。`)
}

/** 引擎内部：长途运输期间驾驶船被虚拟货物占用的货仓容积（其余时刻 0；UI 展示"已用/剩余"用） */
export function haulingOccupiedM3(state: GameState, ctx: SimContext): number {
  if (!state.hauling.active) return 0
  return cargoCapacityM3Of(state, ctx, state.shipId)
}
