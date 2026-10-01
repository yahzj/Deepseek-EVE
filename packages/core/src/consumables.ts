/**
 * **实验室道具的"使用"动作**（**2026-09-30 船长令**「你先继续制作后续实验室内容」＋「信号发射器和技能加速剂」）。
 *
 * 为什么单开一个模块：这两件的**产物**在实验室（`lab.ts` + `labRecipes.ts`），但**用法**与产线无关
 * ——它们是"从仓库里点一下就用掉"的道具，与精炼/生产链解耦 ⇒ 复用既有 `useOneRepairKit` 的成法：
 * 校验 → 扣 1 枚（货仓优先、再扣物品仓库）→ 落效果 → 返回 `CommandResult`（界面只弹提示）。
 *
 * 本文件目前只有**突触加速剂**（第 3 批）；**信号发射器**（第 2 批）等入侵侧的"主动起事件"入口接好后再补进来，
 * 在那之前它的物品/市场/配方三处都带 `unreleased` ⇒ 玩家看不到也拿不到。
 */
import type { GameState } from './state'
import type { CommandResult } from './engine'
import type { SimContext } from './types'
import { countItem, countWare, removeItem, removeWare } from './inventory'
import { HOME_GALAXY_ID, addLog } from './state'
import { isAtHomeLike } from './location'
import { SYNAPTIC_ACCELERANT_MS, synapticAccelerantActive } from './training'
import { securityZoneOf } from './sideTasks'
import { DSI_FACTION_ID, spendableStandingOf } from './expedition'
import { weekendHasBuiltStation, weekendPeripheryOf, weekendRollOccupation } from './weekendEvent'

/**
 * **高安启动的声望代价**（**2026-09-30 船长令**：「且当玩家在高安使用时候，弹出二次警告，警告玩家
 * 这么做会被扣声望」→ 船长「按你推荐来」= 扣**可支配声望 10 点**、**不足则拒绝**）。
 * ⚠ 扣的是 `state.standings`（可支配那本，与章鱼人兑换同账），**不动累计** ⇒ 已达成的门槛不受影响。
 * 界面按同一个常量渲染警告文案（`ui.beacon.006`）。
 */
export const HIGH_SEC_PENALTY = 10

/** 玩家**此刻所在星系**（不在基地时 = `awayGalaxy`；在母港 = 母港）——「在高安点火要付声望」那条用 */
export function playerGalaxyIdOf(state: GameState): string {
  return state.awayGalaxy ?? HOME_GALAXY_ID
}

/**
 * **指定星系那条路的唯一禁令**（**2026-09-30 船长令**：「**主动对某个星系使用，只有"不能对有空间站的
 * 星系使用"这一条禁令**」）：目标星系**有空间站**（母港所在星系 或 任何**已建成**副站）⇒ 不能点火
 * （提示语由船长逐字给定：「该星系信号被压制，无法使用信号发射器。」）。
 * ⚠ **不再**要求"已探索 / 非高安 / 无副站"那一套（那是**随机那条路**的候选集口径）；
 * ⚠ **不判玩家在哪**；默认那条路（不传 `galaxyId`）连这条也不判。
 */
export function beaconTargetBlocked(state: GameState, ctx: SimContext, galaxyId: string): boolean {
  return galaxyId === HOME_GALAXY_ID || weekendHasBuiltStation(state, ctx, galaxyId)
}

/** 此刻是否"在高安点火"（＝要弹二次警告 + 扣声望的那种场合）——**单点**，界面与 core 共用
 *
 *  ⚠ **2026-09-30 船长令**：「在指定星系使用信号发射器时，**允许在高安使用**，但是**不允许在空间站使用**」
 *  ⇒ 本判据**只管安等**（与是否在空间站无关，两条规则互不短路）；
 *  `targetGalaxyId` 缺省（默认那条路）⇒ 一律 false：不警告、不扣声望。 */
export function beaconLaunchHighSecOf(state: GameState, ctx: SimContext, targetGalaxyId?: string): boolean {
  if (targetGalaxyId === undefined) return false
  return securityZoneOf(ctx, playerGalaxyIdOf(state)) === '高安'
}

/** 突触加速剂物品 id（与 `data/items.ts` 的 `CONSUMABLES` 同源） */
export const SYNAPTIC_ACCELERANT_ITEM_ID = 'synaptic-accelerant'

/** 库存里有多少枚（货仓 ＋ 物品仓库；与 `labMaterialAvailable` 同一把尺） */
export function consumableStockOf(state: GameState, itemId: string): number {
  return countItem(state, itemId) + countWare(state, itemId)
}

/** 扣 1 枚（**货仓优先**，与精炼炉/实验室取料口径一致） */
function takeOne(state: GameState, itemId: string): void {
  if (countItem(state, itemId) > 0) {
    removeItem(state, itemId, 1)
    return
  }
  removeWare(state, itemId, 1)
}

/**
 * **使用一枚突触加速剂**：24 小时内训练时长 ×0.5。
 *
 * 校验顺序（与 `useOneRepairKit` 同款：先判"用了有没有意义"，再扣东西）：
 * ① 库存里有 ≥1 枚；② **当前没有生效中的加速剂**（**不可叠用** —— 船长口径「同一时间内只能生效一剂」；
 * 生效期内再点直接拒绝、**不消耗**，避免白扔 2,000 虚空晶）。
 */
export function useSynapticAccelerant(state: GameState): CommandResult {
  if (consumableStockOf(state, SYNAPTIC_ACCELERANT_ITEM_ID) <= 0) {
    return { ok: false, error: '仓库里没有突触加速剂。', errorId: 'core.consumable.001' }
  }
  if (synapticAccelerantActive(state)) {
    return {
      ok: false,
      error: '突触加速剂正在生效中：同一时间内只能生效一剂。',
      errorId: 'core.consumable.002',
      errorParams: { p1: Math.max(0, Math.round(((state.skillBoostUntilMs ?? 0) - state.gameMs) / 60_000)) },
    }
  }
  takeOne(state, SYNAPTIC_ACCELERANT_ITEM_ID)
  state.skillBoostUntilMs = state.gameMs + SYNAPTIC_ACCELERANT_MS
  addLog(
    state,
    'industry',
    `✦ 突触加速剂生效：未来 24 小时内技能训练时长减半（至 ${Math.round(SYNAPTIC_ACCELERANT_MS / 3_600_000)} 小时后失效）。`,
    'core.consumable.003',
    { p1: Math.round(SYNAPTIC_ACCELERANT_MS / 3_600_000) },
  )
  return { ok: true }
}

/** 生效剩余毫秒（界面读数用；0 = 未生效） */
export function synapticAccelerantRemainMs(state: GameState): number {
  return Math.max(0, (state.skillBoostUntilMs ?? 0) - state.gameMs)
}

/* ═══════════════════════ 信号发射器（第 2 批） ═══════════════════════ */

/** 信号发射器物品 id */
export const INVASION_BEACON_ITEM_ID = 'invasion-beacon'

/**
 * **可选入侵势力清单**（**船长 2026-09-29 Q2**：「**做个列表之类的，之后有新增入侵就添加选项**」）。
 *
 * ⚠ **这里是唯一登记处**：将来做了第二个入侵族（如 A/C/G），**在表里加一行**，界面与校验自动跟上
 * （界面按这张表渲染列表；`useInvasionBeacon` 用它校验 id）。今天只有 **H 族（墨潮帮）**
 * —— 入侵卡表 `WEEKEND_FOE_CARD_IDS` 目前也只登记了 H 族。
 */
export const INVASION_BEACON_FAMILIES: readonly { readonly id: string; readonly nameId: string }[] = [
  { id: 'H', nameId: 'ui.consumable.002' },
]

/**
 * **使用一枚信号发射器**：主动诱发一次入侵。
 *
 * **落点两条路**（**2026-09-30 船长裁定**：「**直接使用是随机星系（这个要提醒玩家）。选择了星系后是固定。**」）：
 * - **不传 `galaxyId`**（物品页 / 货仓页那颗「使用」）⇒ **随机星系**：复用现有那一抽
 *   `weekendRollOccupation(state, ctx, seq)`（随机核心星系 ＋ 外围 ＋ 势力）；
 * - **传 `galaxyId`**（星图 · 星系详细里那颗「启动信号发射器」）⇒ **就用玩家选的那个星系**：
 *   资格判据**与随机那条路同一套** `weekendCoreCandidates`（已探索 · 非高安 · 无已建副站），
 *   不合格当场拒（界面按同一条判据预先置灰 ＋ 就地说明原因），外围走 `weekendPeripheryOf`。
 *
 * 其余口径照 2026-09-29 六答：`startedAtWallMs` 设为**现在**（这一场按既有规则活满 96 小时窗口）·
 * **不判声望、不判窗口、不判周排期**；只在**已有一场未结束的入侵**时拒绝。
 * ⚠ **抽不到 / 选不到目标星系时都不扣料**（避免白扔 10,000 虚空晶）。
 */
export function useInvasionBeacon(
  state: GameState,
  ctx: SimContext,
  opts: { familyId?: string; galaxyId?: string } = {},
): CommandResult {
  const { familyId, galaxyId } = opts
  if (consumableStockOf(state, INVASION_BEACON_ITEM_ID) <= 0) {
    return { ok: false, error: '仓库里没有信号发射器。', errorId: 'core.consumable.004' }
  }
  const ev = state.weekendEvent
  if (ev !== undefined && ev.endedAtWallMs === undefined) {
    return { ok: false, error: '已经有一场入侵在进行中：等它结束再用信号发射器。', errorId: 'core.consumable.005' }
  }
  /**
   * **新的限制**（**2026-09-30 船长令**：「**新的限制，信号发射器不可以在有空间站的地方使用。**」）：
   * 判据 = `location.isAtHomeLike`（母港 或 **已建成**副站；在建工地不算）⇒ 那时**拒绝启动**。
   * ⚠ 排在"已有入侵"之后：两者同时成立时，"等这场打完"是更贴切的那句。
   */
  /* 指定星系那条路：**唯一禁令 = 目标星系不能有空间站**（船长 2026-09-30 令） */
  if (galaxyId !== undefined && beaconTargetBlocked(state, ctx, galaxyId)) {
    return { ok: false, error: '该星系信号被压制，无法使用信号发射器。', errorId: 'core.consumable.010' }
  }
  const family = INVASION_BEACON_FAMILIES.find((f) => f.id === (familyId ?? INVASION_BEACON_FAMILIES[0]!.id))
  if (!family) {
    return {
      ok: false,
      error: `未知的入侵势力：${familyId ?? '(空)'}。`,
      errorId: 'core.consumable.006',
      errorParams: { p1: familyId ?? '(空)' },
    }
  }
  /**
   * **高安启动的声望代价**（**2026-09-30 船长令**：「**且当玩家在高安使用时候，弹出二次警告，警告玩家
   * 这么做会被扣声望。**」→ 船长「按你推荐来」= 扣**可支配声望 10 点**、**不足则拒绝**）。
   * ⚠ 扣的是 `state.standings`（可支配那本，与章鱼人兑换同账），**不动累计** ⇒ 已达成的门槛不受影响。
   */
  const here = playerGalaxyIdOf(state)
  const highSec = beaconLaunchHighSecOf(state, ctx, galaxyId)
  if (highSec && spendableStandingOf(state, DSI_FACTION_ID) < HIGH_SEC_PENALTY) {
    return {
      ok: false,
      error: `在高安启动信号发射器要付 ${HIGH_SEC_PENALTY} 点声望：当前可支配声望不够。`,
      errorId: 'core.consumable.011',
      errorParams: { p1: HIGH_SEC_PENALTY },
    }
  }
  const seq = (ev?.seq ?? 0) + 1
  /* 两条路各走各的：
     · **指定星系** ⇒ 上面那道"目标不能有空间站"的禁令已经判过，这里**直接按玩家所选落点**
       （**2026-09-30 船长令**：「主动对某个星系使用，**只有不能对有空间站的星系使用这一条禁令**」
       ⇒ 已探索 / 非高安 / 无副站那一套**不再**适用于这条路）；
     · **默认** ⇒ 与每周默认入侵同一套：`weekendRollOccupation`（候选集 = 已探索·非高安·无已建副站）。 */
  let rolled: { coreId: string; peripheryIds: string[]; family: string } | null = null
  if (galaxyId !== undefined) {
    rolled = { coreId: galaxyId, peripheryIds: weekendPeripheryOf(ctx, galaxyId), family: family.id }
  } else {
    rolled = weekendRollOccupation(state, ctx, seq)
    if (!rolled) {
      return { ok: false, error: '当前没有可入侵的目标星系。', errorId: 'core.consumable.007' }
    }
  }
  takeOne(state, INVASION_BEACON_ITEM_ID)
  /* 高安启动：扣可支配声望（**在扣料之后**，与"发射器确实用掉了"同一笔成交；不足时上面已拒） */
  if (highSec) {
    state.standings[DSI_FACTION_ID] = Math.max(0, spendableStandingOf(state, DSI_FACTION_ID) - HIGH_SEC_PENALTY)
    addLog(
      state,
      'fleet',
      `⚠ 在「${ctx.galaxies.get(here)?.name ?? here}」启动信号发射器：协会扣了 ${HIGH_SEC_PENALTY} 点声望。`,
      'core.consumable.012',
      { p1: ctx.galaxies.get(here)?.name ?? here, p2: HIGH_SEC_PENALTY },
    )
  }
  state.weekendEvent = {
    seq,
    startedAtWallMs: state.wallMs ?? Date.now(),
    ...rolled,
    family: family.id,
    contributed: {},
    /* 高安点火留痕（2026-10-01 船长令）：这一场的预警信要在开头怀疑玩家并说清扣了声望 */
    ...(highSec ? { beaconHighSec: true } : {}),
  }
  const galaxyName = ctx.galaxies.get(rolled.coreId)?.name ?? rolled.coreId
  addLog(
    state,
    'fleet',
    `✦ 信号发射器已启动：入侵舰队正在逼近「${galaxyName}」（第 ${seq} 场）。`,
    'core.consumable.008',
    { p1: galaxyName, p2: seq },
  )
  return { ok: true }
}
