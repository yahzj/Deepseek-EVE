/**
 * **虫洞 · 自动探索**（船长 2026-09-14 逐条定案 · 确认稿 §六 · 批次 3）。
 *
 * 船长原话（照抄）：
 * 「并且'扫描虫洞'界面内允许玩家自动配置舰队探索虫洞（占据4个副船AI）。自动探索需要较长时间，
 *  且收益不确定，并且也会承受严重损失，但是不会丢船。」→「自动探索时间缩短至5分钟。其他没问题了。」
 * 追加四答（2026-09-14 晚）：「收益进仓库」·「按'手动一趟的期望 × 40%'」·「损伤口径两项都报」·
 * 「结算通讯消息的载体采用日志+需要确认的报告（显示在扫描虫洞页面里）。允许出现虫洞字样。」
 *
 * 口径：
 * - **每处虫洞一个「自动探索」**：界面**自动配置**参与舰（最多 4 条非主控船，可手动改）；不满 4 条也能跑。
 * - **每条参与舰各占 1 枚 AI 核心**（与副船 AI 任务**同一本账**，见 `ai.ts` 的 `aiCoreShipUsed`）。
 * - **时长 = 5 分钟**；按 `state.gameMs` 推进 ⇒ **离线照算**（与 AI 副船任务同口径）。
 * - **完成后停止**（不自动接下一个）：参与舰与 AI 名额届时释放，**该处虫洞被消耗**。
 * - **产出 = 手动一趟的期望 × 40%**（不保底），**直入站内仓库**（不占货舱、不会"装不下"）。
 * - **损伤**：每舰**结构 / 装甲各掷一次 −40%~−80%**，结构保底 `WORMHOLE_AUTO_HULL_FLOOR` ⇒ **绝不丢船**。
 * - **参与舰任务期间锁定**（驾驶/出击/别的 AI 任务全拒），返航解锁。
 * - **结算**：一条**日志** ＋ 一份**需要确认的报告**（显示在「扫描虫洞」页；船长：允许出现虫洞字样）。
 *
 * ⚠ 本模块**不碰** `wormholeEnter` 的副本状态机：自动探索是"抽象的一趟"（不建网格、不打战斗），
 * 产出按手动期望折算 —— 这是船长对"收益不确定 + 绝不丢船"的取舍，实现上必须与真副本解耦。
 */
import type { GameState, WormholeArchetype, WormholeAutoReport, WormholeAutoRun, WormholeFamily, WormholeStockItem } from './state'
import { addLog, shipLockedInWormhole } from './state'
import type { SimContext } from './types'
import type { CommandResult } from './engine'
import { WORMHOLE_ORE_ITEM_ID } from './wormhole'
import { RARE_WRECK_VOLUME_M3, rareWreckItemIdOf, wreckItemIdOf } from './salvage'
import { WORMHOLE_WRECK_PILE_M3_BASE, wormholeRelicBoxIdOf, WORMHOLE_CORE_WEIGHTS } from './wormholeSalvage'
import { wormholeCardIdOfFamily, wormholeFamilyOfSeed, wormholeLayerRewardMul } from './wormholeFoes'
import { WORMHOLE_ARCHETYPE_LABELS, wormholeArchetypeOf } from './wormholeGrid'
import { wormholeStockOf, wormholeStockTake } from './wormholeScan'
import { aiCoreCap, aiCoreIndustryUsed, aiCoreName, aiCoreShipUsed, gainAiCore, industryAiBonus } from './ai'

/** **一趟自动探索的时长**（船长：「自动探索时间缩短至5分钟」） */
export const WORMHOLE_AUTO_DURATION_MS = 5 * 60_000

/** **参与舰上限**（船长：「占据4个副船AI」⇒ 最多 4 条；不满也能跑）。
 * ⚠ 写成字面量而**不**在模块初始化时读 `WORMHOLE_MAX_SHIPS`：本模块与 `wormhole.ts` 之间存在
 * `activity → wormholeAuto → wormhole` 的模块环，初始化期读对方的常量会踩 TDZ（本仓有过先例）。 */
export const WORMHOLE_AUTO_MAX_SHIPS = 4

/**
 * **产出系数 = 手动一趟的期望 × 40%**（船长 2026-09-14：「按"手动一趟的期望 × 40%"」）。
 * 手动期望的来源（都在代码里，可复核）：
 * - **普通残骸堆**：墓场 `WORMHOLE_GRAVEYARD_COMMONS_MIN~MAX`(3~10，均值 6.5) ＋ 舰船信号 `WORMHOLE_SHIP_SPOIL_COMMONS`(2) ≈ **8.5 堆/趟**；
 * - **稀有残骸**：`tools/wormhole-econ.ts --runs=40` 实测 **≈1.25 件/趟**（专属装备的唯一来源）；
 * - **虚空母矿**：矿脉每格铺 1~3 堆（均值 **2 堆**）× `WORMHOLE_PILE_UNITS_BASE`(200) 单位；
 * - **遗迹安全货柜**：同一次实测 **≈0.23 件/趟**（层 2 起才出）。
 * 每堆的体积/数量仍走既有层收益曲线 `wormholeLayerRewardMul(depth)`，再乘 0.8~1.2 的确定性抖动。
 */
export const WORMHOLE_AUTO_YIELD_MUL = 0.4

/** 手动一趟的期望（= 上面注释里的四个数；改口径只改这里） */
export const WORMHOLE_AUTO_MANUAL = {
  /** 普通残骸堆数/趟 */
  commons: 8.5,
  /** 稀有残骸件数/趟（econ 实测） */
  rares: 1.25,
  /** 虚空母矿堆数/趟（矿脉 1~3 堆，均值 2） */
  orePiles: 2,
  /** 遗迹安全货柜件数/趟（econ 实测；层 2 起） */
  /** 遗迹安全货柜**命中率**（econ 实测；层 2 起。⚠ 2026-09-14 一号改名：原 `boxes` ⇒ `boxChance`） */
  boxChance: 0.23,
  /**
   * **AI 核心枚数/趟**（2026-09-14 船长新增遗迹掉落；同日第四答「自动探索也吃，按同口径折算
   * **4%/趟**」）。取 **0.10** = 「每趟 1 次遗迹打捞 × `WORMHOLE_CORE_SHARE`(10%)」——
   * 与船长批准的那条口径逐字对应；**层 1 起就出**（与货柜那条层 2 起不同）。
   *
   * ⚠ **实测复核（2026-09-14 晚 · `npm run wormhole:econ -- --runs=100`）：0.090 枚/趟**
   * （100 趟共 9 枚 —— 层 1 三趟、层 2 六趟）⇒ 与本处取值的 0.10 在抽样噪声内一致
   * （泊松 λ=0.1 时 100 趟的 σ≈0.03）⇒ **取值不动**。
   * 早前那版注释写"取不到样本"，是因为当时政策 20 趟里 0 次遗迹打捞（一号的「内容原型」批次
   * 落进 main 之后盘面遗迹格才稳定够用）——那条注记已作废。
   */
  cores: 0.1,
} as const

/** **结构保底**（绝不丢船：结构低于它就不再扣） */
export const WORMHOLE_AUTO_HULL_FLOOR = 0.1

/* ═══════════ 内容原型 → 自动探索的产出口味（丙 · 船长 2026-09-14：原型也影响自动探索） ═══════════ */

/**
 * 原型抽取权重（**与 `wormholeGrid.WORMHOLE_ARCHETYPE_WEIGHTS` 同值** —— `content:check` 有契约盯同值）。
 * ⚠ 这里写字面量而不是读那个常量：本模块与 `wormholeGrid` 之间存在模块环，初始化期读对方常量会踩 TDZ。
 */
export const WORMHOLE_AUTO_ARCHETYPE_WEIGHTS: Readonly<Record<WormholeArchetype, number>> = {
  balanced: 40,
  wreck: 20,
  ruins: 15,
  vein: 15,
  combat: 10,
}

/** 各原型的**原始口味倍数**（在四条产出线上重新分配；下面按抽取权重归一化回 ≈1 ⇒ 总期望不变） */
const ARCHETYPE_RAW: Readonly<Record<WormholeArchetype, { commons: number; rares: number; ore: number; box: number }>> = {
  balanced: { commons: 1, rares: 1, ore: 1, box: 1 },
  wreck: { commons: 1.6, rares: 1.1, ore: 0.8, box: 1 },
  ruins: { commons: 0.9, rares: 1.6, ore: 0.8, box: 2 },
  vein: { commons: 0.7, rares: 0.9, ore: 2.2, box: 0.8 },
  combat: { commons: 1.5, rares: 1.3, ore: 0.7, box: 0.9 },
}

/**
 * **归一化后的口味倍数**：按抽取权重求加权平均，再逐线除掉它 ⇒
 * 「同一条 40% 的期望线」不变，只是**在原型之间重新分配**（某原型多出的，别的原型少回去）。
 */
const ARCHETYPE_MUL: Readonly<Record<WormholeArchetype, { commons: number; rares: number; ore: number; box: number }>> = (() => {
  const keys: WormholeArchetype[] = ['balanced', 'wreck', 'ruins', 'vein', 'combat']
  const totalP = keys.reduce((s, k) => s + WORMHOLE_AUTO_ARCHETYPE_WEIGHTS[k], 0)
  const mean = { commons: 0, rares: 0, ore: 0, box: 0 }
  for (const k of keys) {
    const p = WORMHOLE_AUTO_ARCHETYPE_WEIGHTS[k] / totalP
    const m = ARCHETYPE_RAW[k]
    mean.commons += p * m.commons
    mean.rares += p * m.rares
    mean.ore += p * m.ore
    mean.box += p * m.box
  }
  const out = {} as Record<WormholeArchetype, { commons: number; rares: number; ore: number; box: number }>
  for (const k of keys) {
    const m = ARCHETYPE_RAW[k]
    out[k] = {
      commons: m.commons / mean.commons,
      rares: m.rares / mean.rares,
      ore: m.ore / mean.ore,
      box: m.box / mean.box,
    }
  }
  return out
})()

/** 某原型的产出口味倍数（界面/报告读数用） */
export function wormholeAutoArchetypeMul(archetype: WormholeArchetype): {
  commons: number
  rares: number
  ore: number
  box: number
} {
  return ARCHETYPE_MUL[archetype]
}

/** 损伤区间（船长：「结构/装甲大幅受损（−40%~−80% 随机）」） */
export const WORMHOLE_AUTO_DAMAGE_MIN = 0.4
export const WORMHOLE_AUTO_DAMAGE_MAX = 0.8

/** 报告保留条数（超出的丢最旧；避免随档无限增长） */
export const WORMHOLE_AUTO_REPORT_MAX = 20

/** 在跑的自动探索（老档没有 ⇒ 空数组） */
export function wormholeAutoRunsOf(state: GameState): WormholeAutoRun[] {
  return state.wormholeAuto ?? []
}

/** 报告队列（新的在前） */
export function wormholeAutoReportsOf(state: GameState): WormholeAutoReport[] {
  return state.wormholeAutoReports ?? []
}

/** **待确认的报告条数**（界面角标用） */
export function wormholeAutoUnconfirmedCount(state: GameState): number {
  return wormholeAutoReportsOf(state).filter((r) => !r.confirmed).length
}

/** 某舰是否正在自动探索（任务期间锁定） */
export function shipInWormholeAuto(state: GameState, shipId: string): boolean {
  return wormholeAutoRunsOf(state).some((r) => r.shipIds.includes(shipId))
}

/** 该处虫洞是否已在自动探索中 */
export function wormholeAutoRunOfStock(state: GameState, stockId: string): WormholeAutoRun | undefined {
  return wormholeAutoRunsOf(state).find((r) => r.stockId === stockId)
}

/* ═══════════ 一、参与舰的自动配置 ═══════════ */

/**
 * **能不能派这艘船**（自动配置与手动改选共用同一把尺）：null = 可以，否则给拒因。
 * 排除：主控船 · 在虫洞里的船 · 已在别的 AI 副船任务里 · 已在别的自动探索里 · 不在舰队里。
 */
export function wormholeAutoShipBlockReason(state: GameState, shipId: string): string | null {
  const ship = state.fleet[shipId]
  if (!ship) return '舰队里没有这艘船。'
  if (shipId === state.shipId) return '主控船不参与自动探索（主控要留在站内）。'
  if (shipLockedInWormhole(state, shipId)) return '该舰在虫洞里：等它出洞再派。'
  if (state.aiAssignments[shipId]) return '该舰已在别的 AI 副船任务里：先撤回它。'
  if (shipInWormholeAuto(state, shipId)) return '该舰已在另一处虫洞的自动探索里。'
  return null
}

/** 一条候选（界面用）：船 id + 显示名 + 是否默认选中 + 不可选时的原因 */
export interface WormholeAutoCandidate {
  shipId: string
  /** 显示名（玩家起的名 > 船型名 > id） */
  name: string
  /** 自动配置是否默认选它 */
  picked: boolean
  /** 不可派的原因（null = 可派） */
  blocked: string | null
}

/**
 * **自动配置参与舰**（船长：「界面自动配置参与舰（按船型/装配挑最多 4 条非主控船，可手动改）」）。
 *
 * 排序口径（同分再按 id 稳定排序 ⇒ 同档可复现）：
 * ① **能打**：高槽里带武器的件数（炮台/导弹架/激光炮/无人机装置）多者优先；
 * ② **耐打**：`durability` 高者优先（刚修好的船先上）；
 * ③ **船型档位**（`tier`）高者优先。
 * 不可派的船**照旧列出**（界面置灰 + 显示原因）——玩家能看到"为什么它不能去"。
 */
export function wormholeAutoCandidates(state: GameState, ctx: SimContext, exclude?: readonly string[]): WormholeAutoCandidate[] {
  const skip = new Set(exclude ?? [])
  const rows: Array<{ shipId: string; name: string; score: number; blocked: string | null }> = []
  for (const shipId of Object.keys(state.fleet)) {
    if (skip.has(shipId)) continue
    const blocked = wormholeAutoShipBlockReason(state, shipId)
    const ship = state.fleet[shipId]!
    const def = ctx.ships.get(ship.defId ?? shipId)
    let guns = 0
    for (const id of ship.fitted?.high ?? []) {
      if (!id) continue
      const slot = ctx.modules.get(id)?.slot
      if (slot === 'turret' || slot === 'missile' || slot === 'laser' || slot === 'drone-rack' || slot === 'drone-tac') guns += 1
    }
    const score = guns * 100 + Math.round((ship.durability ?? 1) * 10) * 5 + (def?.tier ?? 1) * 3
    rows.push({ shipId, name: shipNameOf(state, ctx, shipId), score, blocked })
  }
  rows.sort((a, b) => b.score - a.score || a.shipId.localeCompare(b.shipId))
  let picked = 0
  /** 自动配置还要收口在"当前可派的核心数"上：不会配出一队根本派不出去的名单 */
  const budget = Math.min(WORMHOLE_AUTO_MAX_SHIPS, wormholeAutoFreeCores(state, ctx))
  return rows.map((r) => {
    const ok = r.blocked === null && picked < budget
    if (ok) picked += 1
    return { shipId: r.shipId, name: r.name, picked: ok, blocked: r.blocked }
  })
}

/**
 * **当前可派的核心数** = 共用上限 − 副船/自动探索已占 −（站内工业超出「工业自动化」扩容的部分）。
 * 自动配置按它收口（不会配出一队"根本派不出去"的名单）；命令层再各自校验一次。
 */
export function wormholeAutoFreeCores(state: GameState, ctx: SimContext): number {
  const cap = aiCoreCap(state, ctx)
  const indOnShared = Math.max(0, aiCoreIndustryUsed(state) - industryAiBonus(state, ctx))
  return Math.max(0, cap - aiCoreShipUsed(state) - indOnShared)
}

/** 自动配置的默认参与舰（最多 4 条，且不超过当前可派的核心数） */
export function wormholeAutoDefaultShips(state: GameState, ctx: SimContext): string[] {
  return wormholeAutoCandidates(state, ctx)
    .filter((c) => c.picked)
    .map((c) => c.shipId)
}

/** 名称（日志/报告用；没起名就用船型名，再取不到就用 id） */
export function shipNameOf(state: GameState, ctx: SimContext, shipId: string): string {
  const ship = state.fleet[shipId]
  if (!ship) return shipId
  return ship.customName ?? ctx.ships.get(ship.defId ?? shipId)?.name ?? shipId
}

/* ═══════════ 二、AI 核心账（与副船任务共用） ═══════════ */

/**
 * **AI 核心够不够**（自动探索要占 `need` 枚）：null = 够，否则给拒因。
 * 口径与 `ai.ts` 的 `aiCoreCapBlock(state, ctx, 'ship')` 同源（站内工业先抵「工业自动化」扩容，
 * 超出的部分才挤共同名额）；这里多算一步"要几枚"，因为一趟可能同时派 2~4 条船。
 */
export function wormholeAutoCoreBlock(state: GameState, ctx: SimContext, need: number): string | null {
  const cap = aiCoreCap(state, ctx)
  if (cap <= 0) {
    return 'AI 核心上限为 0：先训练提升 AI 核心上限的技能（如「AI 核心操作学」）——自动探索每条参与舰各占 1 枚核心。'
  }
  const indOnShared = Math.max(0, aiCoreIndustryUsed(state) - industryAiBonus(state, ctx))
  const shipUsed = aiCoreShipUsed(state)
  const free = cap - shipUsed - indOnShared
  if (free < need) {
    return `AI 核心不够：这一趟要派 ${need} 条舰（各占 1 枚），当前只剩 ${Math.max(0, free)} 枚可派（上限 ${cap}：副船与自动探索 ${shipUsed} 枚 + 站内工业超出扩容 ${indOnShared} 枚）。先撤回一些副船任务、自动探索或站内炉线。`
  }
  return null
}

/* ═══════════ 三、开始 / 中止 ═══════════ */

/**
 * **能不能开自动探索**（界面按钮的置灰理由；也是命令层的守卫）：null = 可以。
 * 船长口径里**没有**"主控必须空闲"的限制 —— 自动探索吃的是**副船 + AI 名额**，
 * 主控在扫描/远征期间照旧可以派队。
 */
export function wormholeAutoBlockReason(state: GameState, ctx: SimContext, stockId: string, shipIds?: readonly string[]): string | null {
  // 先看"是不是已经派出去了"：开始时库存项即被消耗 ⇒ 先查在跑的趟，理由才说得清
  if (wormholeAutoRunOfStock(state, stockId)) return '这一处已经在自动探索中。'
  const item = wormholeStockOf(state).find((x) => x.id === stockId)
  if (!item) return '这处虫洞不在了（可能已经探索过）。'
  const pool = shipIds ?? wormholeAutoDefaultShips(state, ctx)
  if (pool.length === 0) return '没有可派出的副船：自动探索不派主控船，先备至少 1 条空闲副船。'
  if (pool.length > WORMHOLE_AUTO_MAX_SHIPS) return `参与舰最多 ${WORMHOLE_AUTO_MAX_SHIPS} 条。`
  for (const shipId of pool) {
    const blocked = wormholeAutoShipBlockReason(state, shipId)
    if (blocked) return `${shipNameOf(state, ctx, shipId)}：${blocked}`
  }
  return wormholeAutoCoreBlock(state, ctx, pool.length)
}

/**
 * **开始自动探索**（一处虫洞一趟；不满 4 条也能跑）。
 * 成功 ⇒ **消耗该处库存**、按参与舰数占 AI 名额、参与舰锁定到返航。
 */
export function wormholeAutoStart(state: GameState, ctx: SimContext, stockId: string, shipIds?: readonly string[]): CommandResult {
  const blocked = wormholeAutoBlockReason(state, ctx, stockId, shipIds)
  if (blocked) return { ok: false, error: blocked }
  const item = wormholeStockOf(state).find((x) => x.id === stockId)!
  const picked = [...(shipIds ?? wormholeAutoDefaultShips(state, ctx))]
  wormholeStockTake(state, stockId)
  const run: WormholeAutoRun = {
    id: `wha-${state.gameMs.toString(36)}-${wormholeAutoRunsOf(state).length.toString(36)}`,
    stockId,
    seed: item.seed,
    depth: Math.max(1, Math.min(9, item.depth)),
    /**
     * 丙/丁（2026-09-14）：把该处的**内容原型 + 敌族**带进这趟自动探索 ——
     * 产出池与"它真进去打"时同族，口味按原型重新分配（总期望仍是那条 40% 线）。
     */
    archetype: item.archetype ?? wormholeArchetypeOf(item.seed),
    family: item.family ?? wormholeFamilyOfSeed(item.seed),
    shipIds: picked,
    startedAtGameMs: state.gameMs,
    finishAtGameMs: state.gameMs + WORMHOLE_AUTO_DURATION_MS,
  }
  state.wormholeAuto = [...wormholeAutoRunsOf(state), run]
  addLog(
    state,
    'info',
    `🛰 自动探索队出发：${WORMHOLE_ARCHETYPE_LABELS[wormholeRunMeta(run).archetype]} · ${picked.length} 条舰（${picked.map((id) => shipNameOf(state, ctx, id)).join('、')}）` +
      `——约 ${Math.round(WORMHOLE_AUTO_DURATION_MS / 60_000)} 分钟后返航（每舰占 1 枚 AI 核心）。`,
  )
  return { ok: true }
}

/** 一趟（或一处）的原型与族：字段缺省一律按 `seed` 现算 ⇒ 老档与新建同口径 */
export function wormholeRunMeta(run: { seed: number; archetype?: WormholeArchetype; family?: import('./state').WormholeFamily }): {
  archetype: WormholeArchetype
  family: WormholeFamily
} {
  return {
    archetype: run.archetype ?? wormholeArchetypeOf(run.seed),
    family: run.family ?? wormholeFamilyOfSeed(run.seed),
  }
}

/**
 * **中止**一趟自动探索（无收益、无损伤；参与舰与 AI 名额当场释放）。
 * ⚠ **该处虫洞不退还**（队伍已经进去了）——界面在按钮旁写明这条。
 */
export function wormholeAutoStop(state: GameState, runId: string): CommandResult {
  const runs = wormholeAutoRunsOf(state)
  const run = runs.find((r) => r.id === runId)
  if (!run) return { ok: false, error: '这一趟自动探索已经结束了。' }
  state.wormholeAuto = runs.filter((r) => r.id !== runId)
  addLog(state, 'info', '🛰 自动探索队已召回：没有收益、也没有损伤；那条通道就此关闭。')
  return { ok: true }
}

/** 按参与舰 id 中止（活动栏那一行用） */
export function wormholeAutoStopByShip(state: GameState, shipId: string): CommandResult {
  const run = wormholeAutoRunsOf(state).find((r) => r.shipIds.includes(shipId))
  if (!run) return { ok: false, error: '这一趟自动探索已经结束了。' }
  return wormholeAutoStop(state, run.id)
}

/* ═══════════ 四、推进与结算 ═══════════ */

/** 确定性随机流（同 `(seed, salt)` 必得同结果；与 `wormholeScan` 同一套写法） */
function autoRng(seed: number, salt: number): () => number {
  let count = 0
  return () => {
    count += 1
    let x = (seed + (salt + count) * 2654435761) >>> 0
    x ^= x << 13
    x >>>= 0
    x ^= x >> 17
    x ^= x << 5
    x >>>= 0
    return x / 4294967296
  }
}

/** 报告 id 序号（同一毫秒内多趟也只增不减） */
let reportSeq = 0

/**
 * **推进自动探索**（`advanceGame` 每拍调）：到点即结算。
 * 离线大步长同样适用（`state.gameMs` 一次跨过 finishAt ⇒ 当拍结算，收益与在线一致）。
 */
export function advanceWormholeAuto(state: GameState, ctx: SimContext): void {
  const runs = wormholeAutoRunsOf(state)
  if (runs.length === 0) return
  const due = runs.filter((r) => state.gameMs >= r.finishAtGameMs)
  if (due.length === 0) return
  const dueIds = new Set(due.map((r) => r.id))
  // 先出队（AI 名额当场释放），再结算
  state.wormholeAuto = runs.filter((r) => !dueIds.has(r.id))
  for (const run of due) settleRun(state, ctx, run)
}

/** 结算一趟：算收益（手动期望 × 40%）、掷损伤、入仓库、出报告 + 日志 */
function settleRun(state: GameState, ctx: SimContext, run: WormholeAutoRun): void {
  const rng = autoRng(run.seed, run.depth * 977)
  const mul = wormholeLayerRewardMul(run.depth)
  /**
   * 丙/丁（2026-09-14）：敌卡 = **本处锁定的族**（整趟同族）；产出口味按**内容原型**在四条线上重分配
   * （`ARCHETYPE_MUL` 已归一化 ⇒ 总期望仍是那条 40% 线）。
   */
  const meta = wormholeRunMeta(run)
  const taste = ARCHETYPE_MUL[meta.archetype]
  const cardId = wormholeCardIdOfFamily(meta.family, run.seed)
  const family = String(ctx.anomalies.get(cardId)?.foeFamily ?? meta.family)
  const gains: Array<{ itemId: string; units: number }> = []
  /** 本趟自动探索捞到的 AI 核心（**不入仓库** ⇒ 不能进 `gains`；报告里单列一行） */
  let coresGained: { type: 'gamma' | 'beta' | 'alpha'; n: number } | null = null

  // ① 普通残骸：堆数 = 手动 8.5 × 40% ≈ 3~4 堆，每堆 `WORMHOLE_WRECK_PILE_M3_BASE`(200) m³ × 层收益 × 抖动
  const commons = Math.max(1, Math.round(WORMHOLE_AUTO_MANUAL.commons * WORMHOLE_AUTO_YIELD_MUL * taste.commons * (0.8 + rng() * 0.4)))
  const wreckUnits = Math.max(1, Math.round(commons * WORMHOLE_WRECK_PILE_M3_BASE * mul * (0.8 + rng() * 0.4)))
  gains.push({ itemId: wreckItemIdOf(cardId), units: wreckUnits })

  // ② 稀有残骸：期望 = 手动 1.25 × 40% = 0.5 件/趟（基准）⇒ 原型口味再乘一档
  if (rng() < Math.min(0.95, WORMHOLE_AUTO_MANUAL.rares * WORMHOLE_AUTO_YIELD_MUL * taste.rares)) {
    gains.push({ itemId: rareWreckItemIdOf(cardId), units: RARE_WRECK_VOLUME_M3 })
  }

  // ③ 虚空母矿：0.8 堆 × 200 单位 × 层收益 × 抖动
  const oreUnits = Math.round(WORMHOLE_AUTO_MANUAL.orePiles * WORMHOLE_AUTO_YIELD_MUL * taste.ore * 200 * mul * (0.8 + rng() * 0.4))
  if (oreUnits > 0) gains.push({ itemId: WORMHOLE_ORE_ITEM_ID, units: oreUnits })

  // ④ 遗迹安全货柜：期望 ≈0.09 件/趟（手动 0.23 × 40%），层 2 起
  if (run.depth >= 2 && rng() < Math.min(0.95, WORMHOLE_AUTO_MANUAL.boxChance * WORMHOLE_AUTO_YIELD_MUL * taste.box)) {
    gains.push({ itemId: wormholeRelicBoxIdOf(family), units: 1 })
  }

  /**
   * ⑤ **AI 核心**（2026-09-14 船长第四答「自动探索也吃，按同口径折算 4%/趟」）：
   * 命中率 = 手动 0.10 枚/趟 × 40% = **4%/趟**；命中后按**与手动同一条权重**（60/30/10）抽一种。
   * ⚠ 两条与货柜不同：**层 1 也给**（手动那边没有层门槛）；**不入仓库** ⇒ 不能塞进 `gains`
   * （那条循环是 `state.warehouse.items` 累加）⇒ 直接 `gainAiCore`，报告里单列一行。
   */
  if (rng() < WORMHOLE_AUTO_MANUAL.cores * WORMHOLE_AUTO_YIELD_MUL) {
    const total = WORMHOLE_CORE_WEIGHTS.gamma + WORMHOLE_CORE_WEIGHTS.beta + WORMHOLE_CORE_WEIGHTS.alpha
    let pick = rng() * total
    let got: 'gamma' | 'beta' | 'alpha' = 'gamma'
    for (const t of ['gamma', 'beta', 'alpha'] as const) {
      pick -= WORMHOLE_CORE_WEIGHTS[t]
      if (pick < 0) {
        got = t
        break
      }
    }
    gainAiCore(state, got)
    coresGained = { type: got, n: 1 }
  }

  // 入仓库（船长：「收益进仓库」）
  for (const g of gains) {
    state.warehouse.items[g.itemId] = (state.warehouse.items[g.itemId] ?? 0) + g.units
  }

  // 损伤：结构 / 装甲各掷一次（−40%~−80%）；结构保底 ⇒ 绝不丢船
  const damage = run.shipIds.map((shipId) => {
    const ship = state.fleet[shipId]
    const dura = ship?.durability ?? 1
    const armor = ship?.armorPct ?? 1
    const dLoss = WORMHOLE_AUTO_DAMAGE_MIN + rng() * (WORMHOLE_AUTO_DAMAGE_MAX - WORMHOLE_AUTO_DAMAGE_MIN)
    const aLoss = WORMHOLE_AUTO_DAMAGE_MIN + rng() * (WORMHOLE_AUTO_DAMAGE_MAX - WORMHOLE_AUTO_DAMAGE_MIN)
    const nextDura = Math.max(WORMHOLE_AUTO_HULL_FLOOR, dura * (1 - dLoss))
    const nextArmor = Math.max(0, armor * (1 - aLoss))
    if (ship) {
      ship.durability = nextDura
      ship.armorPct = nextArmor
    }
    return {
      shipId,
      name: shipNameOf(state, ctx, shipId),
      durabilityLossPct: Math.round((1 - nextDura / (dura || 1)) * 100),
      armorLossPct: Math.round((1 - nextArmor / (armor || 1)) * 100),
      durabilityPct: Math.round(nextDura * 100),
      armorPct: Math.round(nextArmor * 100),
    }
  })

  reportSeq += 1
  const report: WormholeAutoReport = {
    id: `whar-${state.gameMs.toString(36)}-${reportSeq.toString(36)}`,
    stockId: run.stockId,
    depth: run.depth,
    finishedAtGameMs: state.gameMs,
    shipIds: [...run.shipIds],
    coresReleased: run.shipIds.length,
    gains,
    ...(coresGained !== null ? { cores: [coresGained] } : {}),
    damage,
    confirmed: false,
  }
  state.wormholeAutoReports = [report, ...wormholeAutoReportsOf(state)].slice(0, WORMHOLE_AUTO_REPORT_MAX)

  const gainText = gains.length > 0 ? gains.map((g) => `${itemNameOf(ctx, g.itemId)} ×${g.units}`).join('、') : '空手而归'
  /** AI 核心单列（不入仓库，故不在 `gains` 里） */
  const coreText = coresGained ? `，并带回 ${aiCoreName(coresGained.type)} ×${coresGained.n}（已直接接入核心库）` : ''
  const dmgText = damage.map((d) => `${d.name}（结构 −${d.durabilityLossPct}% / 装甲 −${d.armorLossPct}%）`).join('、')
  addLog(
    state,
    'info',
    `🛰 自动探索队返航：带回 ${gainText}（已入仓库）${coreText}；损伤：${dmgText}。` +
      `${run.shipIds.length} 条舰全部安全返航，${run.shipIds.length} 枚 AI 核心已释放——报告在「扫描虫洞」页等你确认。`,
  )
}

/** 报告确认（界面「确认」按钮；确认后不再计入待确认数） */
export function wormholeAutoConfirmReport(state: GameState, reportId: string): CommandResult {
  const list = wormholeAutoReportsOf(state)
  const report = list.find((r) => r.id === reportId)
  if (!report) return { ok: false, error: '这份报告不在了。' }
  if (report.confirmed) return { ok: true }
  report.confirmed = true
  state.wormholeAutoReports = [...list]
  return { ok: true }
}

/** 全部确认（界面「全部标为已读」）；返回本次确认了几条 */
export function wormholeAutoConfirmAll(state: GameState): number {
  const list = wormholeAutoReportsOf(state)
  let n = 0
  for (const r of list) {
    if (!r.confirmed) {
      r.confirmed = true
      n += 1
    }
  }
  if (n > 0) state.wormholeAutoReports = [...list]
  return n
}

/** 物品中文名（报告/日志用；查不到就用 id） */
export function itemNameOf(ctx: SimContext, itemId: string): string {
  return ctx.items.get(itemId)?.name ?? itemId
}

/** 库存项（界面用；避免界面重复 import 扫描模块） */
export function wormholeAutoStockOf(state: GameState): WormholeStockItem[] {
  return wormholeStockOf(state)
}
