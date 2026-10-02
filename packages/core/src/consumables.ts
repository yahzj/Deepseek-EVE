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
import { SYNAPTIC_ACCELERANT_MS, synapticAccelerantActive, skillLevelTimeMs, trainingTimeFactor } from './training'
import { tuningMul } from './tuning'
import { securityZoneOf } from './securityZone'
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

/* ═══════════════════════ 技能加速「自动续用」（2026-10-01 船长令） ═══════════════════════ */

/**
 * **队列空着时的兜底判据**（毫秒）：没有正在练的技能时，"剩余 ≤ 这个数"才算到期。
 * 取 60 秒 = 一拍的量级（在线心跳 1 秒、离线分片 30 秒都远小于它）⇒ 既不会空转烧料，
 * 又能在玩家真去练技能那一拍立刻接上。
 */
export const SYNAPTIC_ACCELERANT_RENEW_TAIL_MS = 60_000

/**
 * **自动续用**（**2026-10-01 船长令**：「给技能加速页面添加一个循环使用的开关。当当前加速效果过时时，
 * 自动使用相同效果的技能加速消耗品，离线期间也一样」）。
 *
 * 五条裁定（船长同日全取推荐案）：
 * ① **默认关**（开关随档保存 · 老档缺字段按关读 ⇒ 零迁移）；
 * ② **没料 ⇒ 自动关掉开关** ＋ 一条提示；
 * ③ **无缝续用**：不是"过期后再补"，而是"剩余不足以练完当前这一级时补" ⇒ 玩家看不到掉速空窗；
 * ④ 日志：**在线逐枚写**，离线**只在"离线结算完成"汇总里写一句**；
 * ⑤ **离线期间同样生效**（本函数挂在引擎每拍上，离线大推进与离线分片走同一条路径）。
 *
 * 单点归属：本函数是"自动补用"的**唯一实现**（界面开关只改 `state.boostAutoRenew`，不自己扣料）。
 */
export function syncBoostRenew(state: GameState, ctx: SimContext): void {
  if (state.boostAutoRenew !== true) return
  /**
   * ② **没料 ⇒ 自动关掉开关**（船长选案）。
   *
   * ⚠ 这一判据排在"是否还在生效"**之前**：走到这里＝开关开着，此时**没有库存**就注定补不出下一枚
   * ——当场关掉并提示最直白（排在后面的话，最后一剂快用完时开关还会亮很久，玩家以为循环还在跑）。
   * 因为开关已被置回 false，本分支天然只写一次提示（不需要额外的去重字段）。
   */
  if (consumableStockOf(state, SYNAPTIC_ACCELERANT_ITEM_ID) <= 0) {
    state.boostAutoRenew = false
    addLog(state, 'warn', '⚠ 技能加速自动续用已关闭：突触加速剂用光了。', 'core.consumable.015')
    return
  }
  /**
   * ③ **无缝续用**：判据 = "剩下的生效时间 **不足以练完当前这一级**" 才补 —— **不是**"有没有在生效"
   * 那个二元判断（⚠ 2026-10-01 实现时在这里踩过一次：写成 `synapticAccelerantActive` 早退，
   * 于是"快到期但还在生效"时永远不补，无缝语义直接失效，被本批用例当场逮住）。
   */
  const head = state.skills.queue[0]
  let needMs = SYNAPTIC_ACCELERANT_RENEW_TAIL_MS
  if (head !== undefined) {
    const def = ctx.skills.get(head.skillId)
    if (def !== undefined) {
      const levelMs = Math.max(
        1,
        Math.round(skillLevelTimeMs(def, (state.skills.trained[head.skillId] ?? 0) + 1) * trainingTimeFactor(state) * tuningMul(state, 'skillTrainMs')),
      )
      needMs = Math.max(SYNAPTIC_ACCELERANT_RENEW_TAIL_MS, levelMs - Math.max(0, head.progressMs))
    }
  }
  if (synapticAccelerantRemainMs(state) > needMs) return
  /* 扣料并落效果：与手动「使用」**同一笔语义**（货仓优先）。
     ⚠ "不可叠用"仍成立：走到这里时剩余时间**已经不足以练完当前这一级**，补的这一枚是**接续**，
     不是叠加（还剩很久时上面那行就早退了）。 */
  takeOne(state, SYNAPTIC_ACCELERANT_ITEM_ID)
  state.skillBoostUntilMs = state.gameMs + SYNAPTIC_ACCELERANT_MS
  if (offlineRenewTally !== null) {
    /* ④ 离线期间**逐枚不写日志**（船长选案）：只记账，上线时由"离线结算完成"那一句汇总交代 */
    offlineRenewTally += 1
    return
  }
  addLog(
    state,
    'industry',
    `✦ 突触加速剂自动续用：接下来 ${Math.round(SYNAPTIC_ACCELERANT_MS / 3_600_000)} 小时训练时长继续减半。`,
    'core.consumable.013',
    { p1: Math.round(SYNAPTIC_ACCELERANT_MS / 3_600_000) },
  )
}

/**
 * **离线期间的自动补用记账**（进程级、`null` = 不在离线结算中）：离线时段逐枚不写日志，
 * 只在这里累计，由 `simulation.ts` 的离线汇总那一句取用。**不透传、不落盘**。
 */
let offlineRenewTally: number | null = null

/** 进入 / 离开离线结算：`on = true` 开始记账，`false` 收口（收口后读数仍可取，直到下一次开始） */
export function setOfflineBoostTally(on: boolean): void {
  offlineRenewTally = on ? 0 : null
}

/** 本次离线期间自动补用的枚数（没在记账 ⇒ 0） */
export function offlineBoostRenewCount(): number {
  return offlineRenewTally ?? 0
}

/** 自动续用开关（读；缺省 = 关）——界面与引擎共用这一把尺 */
export function boostAutoRenewOn(state: GameState): boolean {
  return state.boostAutoRenew === true
}

/**
 * 自动续用开关（写）。
 * ⚠ **只在有库存时允许打开**：没料还打开的话，下一拍就会被 `syncBoostRenew` 立刻自动关掉并写一条警告
 * —— 那对玩家是"开了又自己关"的怪手感，不如在这一刻就当场拒绝并说清原因。
 */
export function setBoostAutoRenew(state: GameState, on: boolean): CommandResult {
  if (!on) {
    state.boostAutoRenew = false
    return { ok: true }
  }
  if (consumableStockOf(state, SYNAPTIC_ACCELERANT_ITEM_ID) <= 0) {
    return { ok: false, error: '仓库里没有突触加速剂：自动续用无从补起。', errorId: 'core.consumable.016' }
  }
  state.boostAutoRenew = true
  return { ok: true }
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
    /* 点火来源留痕（2026-10-01 船长令）：① 高安那场预警信要怀疑玩家并说清扣了声望
       ② 玩家自己点起来的入侵，结算协会声望固定 5 点（不再按贡献 0~15） */
    ...(highSec ? { beaconHighSec: true } : {}),
    beaconLit: true,
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
