/**
 * **终局玩法「虫洞」· 层内地点的产出与打捞**（F3b · 2026-09-13 船长裁定）。
 *
 * 口径（船长原话与落档见 `docs/design/wormhole-extraction-endgame-20260912.md` §11.5/§11.6）：
 * - **打捞要打捞器**：「打捞需要玩家舰船至少有一个打捞器，每个打捞器每次能回收 1 堆残骸」
 *   ⇒ 一次打捞动作（1 回合）回收 = **编队打捞器台数** 的堆，总回合 = **⌈堆数 ÷ 台数⌉**；
 * - **优先稀有残骸**：堆按"稀有在前"生成，回收从头拿 ⇒ 回合不够时留下的是普通残骸；
 * - **墓场**：普通残骸 **3~10 堆** + 「**每 3 堆普通，进行一次稀有残骸出现判断**」（单次 35%）
 *   ⇒ 稀有堆数 ≤ ⌊普通堆数 ÷ 3⌋；
 * - **遗迹**：**稀有残骸 2~3 堆**（船长：「新规则只针对墓场。遗迹不影响。」）+ 小概率专属掉落
 *   + **打捞结束大概率触发一场恶战**（70% / 本层威胁 ×1.3）；
 * - **舰船信号**：打赢固定给残骸 2 堆 + 稀有残骸 1 堆；**矿脉**：虚空母矿 1~3 堆。
 *
 * **按族**（船长：「虫洞专属掉落按种族库走，蓝图也是按种族库」）：残骸物品与专属掉落都跟着
 * **本格的敌卡族**走（`wormholeCardIdFor(depth, 格序号)`；五族 A/C/D/E/G 各有一张洞内卡）。
 *
 * ⚠ **依赖方向**：`wormholeBattle → wormholeSalvage → { wormhole, wormholeGrid, wormholeFoes,
 * salvaging, equipment }`；**`wormhole.ts` 不许 import 本文件**（它被 `state.ts` 顶层引用，
 * 而本文件经 `salvaging` 回头吃 `state` ⇒ 会成环，与 D/F 批两次踩过的坑同款）。
 */
import type { GameState } from './state'
import { addLog } from './state'
import type { AnomalyDef, SimContext } from './types'
import { salvagerCyclesOf } from './salvaging'
import { addModule } from './equipment'
import { RARE_WRECK_VOLUME_M3, rareWreckItemIdOf, wreckItemIdOf } from './salvage'
import {
  WORMHOLE_TURN_PER_ACTIVATE,
  WORMHOLE_TURN_PER_PICK,
  gridCellAt,
  gridContentIndex,
  wormholeRng,
} from './wormholeGrid'
import type { WormholeCellPile, WormholeGridCell } from './wormholeGrid'
import {
  wormholeBagSlotsOfFleet,
  wormholeBagUsage,
  wormholeCardIdFor,
  wormholeLayerRewardMul,
  wormholeNodePiles,
} from './wormhole'
import type { WormholeActivateEffect, WormholeRunState } from './wormhole'

/* ═══════════ 一、口径常量（F3c 配平的旋钮都在这里） ═══════════ */

/** 普通残骸**每堆基准体积**（m³；数量即 m³、背包每格 500 ⇒ 与虚空母矿堆同一把尺） */
export const WORMHOLE_WRECK_PILE_M3_BASE = 200
/** 墓场：普通残骸堆数范围（船长 2026-09-13：「墓场给的堆数随机范围上调 3~10」） */
export const WORMHOLE_GRAVEYARD_COMMONS_MIN = 3
export const WORMHOLE_GRAVEYARD_COMMONS_MAX = 10
/** 稀有残骸判断：**每几堆普通判一次** + 单次概率（船长：「每 3 堆普通，进行一次稀有残骸出现判断」） */
export const WORMHOLE_RARE_JUDGE_PER_COMMONS = 3
export const WORMHOLE_RARE_JUDGE_CHANCE = 0.35
/** 遗迹：稀有残骸堆数范围（**不受墓场那条新规则影响** —— 船长 2026-09-13 明示） */
export const WORMHOLE_RUINS_RARES_MIN = 2
export const WORMHOLE_RUINS_RARES_MAX = 3
/** 遗迹专属掉落：单次概率 + 起效层（专属稿 §6.2：层 1~2 不出专属） */
export const WORMHOLE_RELIC_CHANCE = 0.25
export const WORMHOLE_RELIC_MIN_DEPTH = 3
/** 遗迹收尾战：概率 + 威胁系数（船长 2026-09-13 确认「除了 5 其他没问题」） */
export const WORMHOLE_RUINS_BATTLE_CHANCE = 0.7
/** 舰船信号战果（打赢固定给） */
export const WORMHOLE_SHIP_SPOIL_COMMONS = 2
export const WORMHOLE_SHIP_SPOIL_RARES = 1
/** 矿脉堆数范围 */
export const WORMHOLE_VEIN_PILES_MIN = 1
export const WORMHOLE_VEIN_PILES_MAX = 3

/** 遗迹专属掉落的**按深度权重**（专属稿 §6.2；同一层里三类的相对权重） */
export function wormholeRelicWeightsOf(depth: number): { modules: number; moduleBlueprints: number; shipBlueprints: number } {
  const d = Math.max(1, Math.floor(depth))
  if (d <= 2) return { modules: 0, moduleBlueprints: 0, shipBlueprints: 0 }
  if (d <= 4) return { modules: 60, moduleBlueprints: 25, shipBlueprints: 15 }
  if (d <= 6) return { modules: 45, moduleBlueprints: 30, shipBlueprints: 25 }
  return { modules: 30, moduleBlueprints: 35, shipBlueprints: 35 }
}

/* ═══════════ 二、按族池（从 ctx 目录按 id 前缀派生，不手抄清单） ═══════════ */

/** 洞内五族（与 `packages/data/src/wormholeFoes.ts` 的卡一一对应；E 族卡 2026-09-13 补） */
export const WORMHOLE_FAMILIES = ['A', 'C', 'D', 'E', 'G'] as const

export interface WormholeFamilyPool {
  /** 装备本体（`mod-wh-<族>-`） */
  modules: string[]
  /** 装备图纸（`bp-wh-<族>-`） */
  moduleBlueprints: string[]
  /** 舰船图纸（`sbp-wh-<族>-`） */
  shipBlueprints: string[]
}

/**
 * **某族的专属池**（装备本体 / 装备图纸 / 舰船图纸）。
 *
 * 为什么从 `ctx` 目录**按 id 前缀派生**而不是在数据层手抄清单：抄一份就会漂——
 * 内容加一件、改一次族，清单不会自己跟上；而 id 前缀（`-wh-<族>-`）是内容侧的既有约定，
 * 派生出来的池永远与目录一致。`content:check` 另有契约钉住"五族池非空、无孤儿内容"。
 */
export function wormholeFamilyPoolOf(ctx: SimContext, family: string): WormholeFamilyPool {
  const tag = `-wh-${family.toLowerCase()}-`
  const pick = (ids: Iterable<string>, head: string): string[] =>
    [...ids].filter((id) => id.startsWith(head) && id.includes(tag)).sort()
  return {
    modules: pick(ctx.modules.keys(), 'mod'),
    moduleBlueprints: pick(ctx.blueprints.keys(), 'bp'),
    shipBlueprints: pick(ctx.shipBlueprints.keys(), 'sbp'),
  }
}

/** 五族池齐不齐（`content:check` 与用例共用；缺哪族就说哪族） */
export function wormholeFamilyPoolGaps(ctx: SimContext): string[] {
  const gaps: string[] = []
  for (const f of WORMHOLE_FAMILIES) {
    const p = wormholeFamilyPoolOf(ctx, f)
    if (p.modules.length === 0) gaps.push(`${f} 族没有专属装备`)
    if (p.moduleBlueprints.length === 0) gaps.push(`${f} 族没有专属装备图纸`)
    if (p.shipBlueprints.length === 0) gaps.push(`${f} 族没有专属舰船图纸`)
  }
  return gaps
}

/* ═══════════ 三、打捞器与堆的生成 ═══════════ */

/** **编队打捞器总台数**（各船 `salvagerCyclesOf` 的长度之和；0 = 干不了打捞） */
export function wormholeSalvagersOf(state: GameState, ctx: SimContext): number {
  const run = state.wormhole.run
  if (!run) return 0
  let n = 0
  for (const uid of run.fleet) n += salvagerCyclesOf(state, ctx, uid).length
  return n
}

/** 本趟的确定性种子（`run.seed`；老档没有就退到全局 rng 种子） */
function runSeedOf(state: GameState): number {
  return state.wormhole.run?.seed ?? state.rng.seed
}

/** 本格的产出跟着**哪张敌卡**走（残骸物品与专属池都按它取族） */
export function wormholeCellCardIdOf(run: WormholeRunState, cell: WormholeGridCell): string {
  const grid = run.grid!
  return wormholeCardIdFor(run.depth, gridContentIndex(grid, { q: cell.q, r: cell.r }))
}

/** 某格的产出族（从敌卡 id 反查：`wh-*` 卡都带 `foeFamily`，取不到就当 A 族兜底） */
function familyOfCard(ctx: SimContext, cardId: string): string {
  const card: AnomalyDef | undefined = ctx.anomalies.get(cardId)
  const f = String(card?.foeFamily ?? 'A')
  return (WORMHOLE_FAMILIES as readonly string[]).includes(f) ? f : 'A'
}

/**
 * **生成某格的打捞堆**（**只生成一次**：已有 `piles` 就原样返回）。
 * 确定性 = `(本趟种子, 层, 格坐标, 地点类型)` ⇒ 同一趟里反复进出该格结果不变；
 * 与存档一致（堆随档保存，捡走即从数组里删）。
 */
export function wormholeEnsureSalvagePiles(state: GameState, cell: WormholeGridCell): void {
  const run = state.wormhole.run
  const grid = run?.grid
  if (!run || !grid) return
  if ((cell.piles ?? []).length > 0) return
  if (cell.place !== 'graveyard' && cell.place !== 'ruins') return
  const cardId = wormholeCellCardIdOf(run, cell)
  const common = wreckItemIdOf(cardId)
  const rare = rareWreckItemIdOf(cardId)
  const mul = wormholeLayerRewardMul(run.depth)
  const rng = wormholeRng(runSeedOf(state) * 31 + run.depth * 7919 + (cell.q * 131 + cell.r * 17) * 7)
  const piles: WormholeCellPile[] = []
  if (cell.place === 'graveyard') {
    const span = WORMHOLE_GRAVEYARD_COMMONS_MAX - WORMHOLE_GRAVEYARD_COMMONS_MIN + 1
    const commons = WORMHOLE_GRAVEYARD_COMMONS_MIN + Math.floor(rng() * span)
    // **每 3 堆普通判一次稀有**（船长口径）⇒ 上限 = ⌊普通 ÷ 3⌋
    const rolls = Math.floor(commons / WORMHOLE_RARE_JUDGE_PER_COMMONS)
    for (let i = 0; i < rolls; i++) {
      if (rng() < WORMHOLE_RARE_JUDGE_CHANCE) piles.push({ itemId: rare, units: RARE_WRECK_VOLUME_M3 })
    }
    for (let i = 0; i < commons; i++) {
      piles.push({ itemId: common, units: Math.max(1, Math.round(WORMHOLE_WRECK_PILE_M3_BASE * mul * (0.8 + rng() * 0.4))) })
    }
  } else {
    const span = WORMHOLE_RUINS_RARES_MAX - WORMHOLE_RUINS_RARES_MIN + 1
    const rares = WORMHOLE_RUINS_RARES_MIN + Math.floor(rng() * span)
    for (let i = 0; i < rares; i++) piles.push({ itemId: rare, units: RARE_WRECK_VOLUME_M3 })
  }
  // **稀有在前**：回收按数组顺序取 ⇒ "优先打捞稀有残骸"天然成立
  cell.piles = piles
}

/* ═══════════ 四、打捞动作（1 回合 = 回收台数 的堆） ═══════════ */

export interface WormholeSalvageResult {
  ok: boolean
  error?: string
  /** 本回合花掉几回合（恒 1） */
  spent?: number
  /** 本回合回收的堆 */
  taken?: WormholeCellPile[]
  /** 堆没捞完（背包放不下 / 回合不够）时留下几堆 */
  left?: number
  /** 本格打捞是否已完成（堆空了） */
  finished?: boolean
  /** 打捞结束时的专属掉落（撤离成功后入库；见 `run.relics`） */
  relics?: string[]
  /** 需要接着开战（遗迹收尾战） */
  effect?: WormholeActivateEffect
  mustExtract?: boolean
}

/** 把一堆并进背包（**放不下就原样不动**——不静默丢，交给界面提示） */
function tryMergeIntoBag(state: GameState, ctx: SimContext, run: WormholeRunState, pile: WormholeCellPile): boolean {
  const cap = wormholeBagSlotsOfFleet(state, ctx, run.fleet)
  const next = run.bag.map((s) => ({ ...s }))
  const hit = next.find((s) => s.itemId === pile.itemId)
  if (hit) hit.units += pile.units
  else next.push({ itemId: pile.itemId, units: pile.units })
  if (wormholeBagUsage(ctx, next, cap).overflow) return false
  run.bag = next
  return true
}

/**
 * **打捞一批**（网格层的"打捞"入口；界面点「打捞/继续打捞」都走它）。
 *
 * 一次动作 = 1 回合，回收 = `min(台数, 剩余堆数)` 堆（**优先稀有**：堆数组稀有在前）。
 * 背包放不下 ⇒ 当场停下，剩下的留在格上（本回合照扣——打捞器已经开工了）。
 * 堆捞空 ⇒ 记 `activated`（该格完成）；**遗迹**另掷专属掉落与收尾战。
 */
export function wormholeSalvageAt(state: GameState, ctx: SimContext): WormholeSalvageResult {
  const run = state.wormhole.run
  const grid = run?.grid
  if (!run || !grid) return { ok: false, error: '本层没有网格：无法打捞。' }
  if (run.battle) return { ok: false, error: '战斗中：先打完这一场。' }
  const cell = gridCellAt(grid, grid.pos)
  if (!cell) return { ok: false, error: '当前位置不在网格里。' }
  if (cell.place !== 'graveyard' && cell.place !== 'ruins') return { ok: false, error: '这个地点没有可打捞的残骸。' }
  const rigs = wormholeSalvagersOf(state, ctx)
  if (rigs <= 0) {
    return { ok: false, error: '编队里没有打捞器：打捞作业干不了（至少装 1 台）。' }
  }
  wormholeEnsureSalvagePiles(state, cell)
  const piles = cell.piles ?? []
  if (piles.length === 0) {
    if (!grid.activated.includes(cell.key)) grid.activated.push(cell.key)
    return { ok: false, error: '这个地点已经捞空了。' }
  }
  if (run.turnsLeft < WORMHOLE_TURN_PER_ACTIVATE) {
    return { ok: false, error: '回合不足：只能撤离。', mustExtract: true }
  }
  run.turnsLeft -= WORMHOLE_TURN_PER_ACTIVATE
  const taken: WormholeCellPile[] = []
  let full = false
  for (let i = 0; i < rigs && piles.length > 0; i++) {
    const pile = piles[0]!
    if (!tryMergeIntoBag(state, ctx, run, pile)) {
      full = true
      break
    }
    piles.shift()
    taken.push(pile)
  }
  const names = taken
    .map((p) => `${ctx.items.get(p.itemId)?.name ?? p.itemId}×${Math.floor(p.units).toLocaleString('zh-CN')}`)
    .join('、')
  addLog(
    state,
    'info',
    `🕳 打捞（${rigs} 台打捞器）：回收 ${taken.length} 堆${names.length > 0 ? `——${names}` : ''}` +
      ` · 剩 ${piles.length} 堆 · 剩 ${run.turnsLeft} 回合。`,
  )
  if (full) addLog(state, 'warn', `🕳 背包放不下：这一批只回收了 ${taken.length} 堆，剩下的仍留在原处。`)
  const finished = piles.length === 0
  if (!finished) {
    return { ok: true, spent: WORMHOLE_TURN_PER_ACTIVATE, taken, left: piles.length, finished: false, mustExtract: run.turnsLeft <= 0 }
  }
  // ── 打捞结束：记完成；遗迹另掷专属掉落与收尾战 ──
  if (!grid.activated.includes(cell.key)) grid.activated.push(cell.key)
  const result: WormholeSalvageResult = {
    ok: true,
    spent: WORMHOLE_TURN_PER_ACTIVATE,
    taken,
    left: 0,
    finished: true,
    mustExtract: run.turnsLeft <= 0,
  }
  if (cell.place === 'ruins') {
    const relics = wormholeRollRelic(state, ctx, cell)
    if (relics.length > 0) result.relics = relics
    const rng = wormholeRng(runSeedOf(state) * 17 + run.depth * 613 + (cell.q * 41 + cell.r * 53) * 11 + 5)
    if (rng() < WORMHOLE_RUINS_BATTLE_CHANCE) {
      result.effect = { kind: 'ruinsBattle', key: cell.key }
      addLog(state, 'warn', '🕳 遗迹深处的守备被惊动了：交火在即——这一场必须打完。')
    }
  }
  return result
}

/**
 * **遗迹专属掉落**（船长：「遗迹…有小概率获得一次性图纸和虫洞专属装备」）。
 * 按族池抽（装备本体 / 装备图纸 / 舰船图纸），权重按深度分档（专属稿 §6.2；层 1~2 不出）。
 * 抽中的东西记进 `run.relics`——**撤离成功才入库**（半路全损就一起丢，与背包同一条风险线）。
 */
export function wormholeRollRelic(state: GameState, ctx: SimContext, cell: WormholeGridCell): string[] {
  const run = state.wormhole.run
  const grid = run?.grid
  if (!run || !grid) return []
  if (run.depth < WORMHOLE_RELIC_MIN_DEPTH) return []
  const rng = wormholeRng(runSeedOf(state) * 53 + run.depth * 911 + (cell.q * 23 + cell.r * 29) * 13 + 7)
  if (rng() >= WORMHOLE_RELIC_CHANCE) return []
  const family = familyOfCard(ctx, wormholeCellCardIdOf(run, cell))
  const pool = wormholeFamilyPoolOf(ctx, family)
  const w = wormholeRelicWeightsOf(run.depth)
  const total = w.modules + w.moduleBlueprints + w.shipBlueprints
  if (total <= 0) return []
  let acc = rng() * total
  const buckets: Array<[keyof WormholeFamilyPool, number]> = [
    ['modules', w.modules],
    ['moduleBlueprints', w.moduleBlueprints],
    ['shipBlueprints', w.shipBlueprints],
  ]
  let picked: string | undefined
  for (const [key, weight] of buckets) {
    acc -= weight
    if (acc < 0) {
      const list = pool[key]
      if (list.length > 0) picked = list[Math.min(list.length - 1, Math.floor(rng() * list.length))]
      break
    }
  }
  if (!picked) return []
  const name =
    ctx.modules.get(picked)?.name ?? ctx.blueprints.get(picked)?.name ?? ctx.shipBlueprints.get(picked)?.name ?? picked
  run.relics = [...(run.relics ?? []), picked]
  addLog(state, 'info', `🕳 遗迹里的密封舱：${name}（${family} 族专属，带回港才能入库）。`)
  return [picked]
}

/**
 * **撤离成功后把随行战利品入库**（图纸/装备这类不进背包格子的东西）：
 * 一次性图纸进蓝图书架（组装机用掉）、装备本体进装备库。
 * 由 `settleWormholeBattle` 在撤离战胜利那一支调用。
 */
export function wormholeDeliverRelics(state: GameState, ctx: SimContext, relics: readonly string[]): string[] {
  const done: string[] = []
  for (const id of relics) {
    if (ctx.modules.has(id)) {
      addModule(state, id)
      done.push(ctx.modules.get(id)?.name ?? id)
    } else if (ctx.blueprints.has(id) || ctx.shipBlueprints.has(id)) {
      state.blueprintStock[id] = (state.blueprintStock[id] ?? 0) + 1
      done.push(ctx.blueprints.get(id)?.name ?? ctx.shipBlueprints.get(id)?.name ?? id)
    }
  }
  if (done.length > 0) addLog(state, 'info', `🕳 随行战利品入库：${done.join('、')}。`)
  return done
}

/* ═══════════ 五、舰船信号战果（打赢固定给） ═══════════ */

/**
 * **舰船信号地点的战果**（船长：「战斗结束后固定获得一定量残骸和稀有残骸」）：
 * 残骸 2 堆 + 稀有残骸 1 堆，**直接进包**（这是打出来的，不是打捞作业，不需要打捞器）；
 * 背包放不下的部分**留在该格成堆**（不静默丢，之后可以照打捞规则回收）。
 */
export function wormholeGrantShipSpoils(state: GameState, ctx: SimContext): { bagged: number; leftOnCell: number } {
  const run = state.wormhole.run
  const grid = run?.grid
  if (!run || !grid) return { bagged: 0, leftOnCell: 0 }
  const cell = gridCellAt(grid, grid.pos)
  if (!cell) return { bagged: 0, leftOnCell: 0 }
  const cardId = wormholeCellCardIdOf(run, cell)
  const mul = wormholeLayerRewardMul(run.depth)
  const rng = wormholeRng(runSeedOf(state) * 7 + run.depth * 331 + (cell.q * 61 + cell.r * 67) * 3 + 11)
  const spoils: WormholeCellPile[] = []
  for (let i = 0; i < WORMHOLE_SHIP_SPOIL_COMMONS; i++) {
    spoils.push({ itemId: wreckItemIdOf(cardId), units: Math.max(1, Math.round(WORMHOLE_WRECK_PILE_M3_BASE * mul * (0.8 + rng() * 0.4))) })
  }
  for (let i = 0; i < WORMHOLE_SHIP_SPOIL_RARES; i++) spoils.push({ itemId: rareWreckItemIdOf(cardId), units: RARE_WRECK_VOLUME_M3 })
  let bagged = 0
  const leftovers: WormholeCellPile[] = []
  for (const s of spoils) {
    if (bagged < spoils.length && tryMergeIntoBag(state, ctx, run, s)) bagged += 1
    else leftovers.push(s)
  }
  if (leftovers.length > 0) {
    cell.piles = [...(cell.piles ?? []), ...leftovers]
    addLog(state, 'warn', `🕳 战果里有 ${leftovers.length} 堆装不下：先散落在该地点，可以照打捞规则回收。`)
  }
  if (bagged > 0) addLog(state, 'info', `🕳 战果入库：${bagged} 堆残骸（含稀有）。`)
  return { bagged, leftOnCell: leftovers.length }
}

/* ═══════════ 六、矿脉（虚空母矿 1~3 堆；拾取每堆 1 回合） ═══════════ */

/**
 * **给矿脉格铺原矿堆**（只铺一次）。堆的生成器沿用 `wormholeNodePiles`（虚空母矿、确定性、
 * 数量随层收益系数）；拾取走既有的 `wormholeTakePile`（网格层每拾一堆扣 1 回合）。
 */
export function wormholeEnsureVeinPiles(state: GameState, cell: WormholeGridCell): void {
  const run = state.wormhole.run
  const grid = run?.grid
  if (!run || !grid) return
  if ((cell.piles ?? []).length > 0) return
  if (cell.place !== 'vein') return
  const rng = wormholeRng(runSeedOf(state) * 97 + run.depth * 577 + (cell.q * 89 + cell.r * 71) * 19)
  const span = WORMHOLE_VEIN_PILES_MAX - WORMHOLE_VEIN_PILES_MIN + 1
  const count = WORMHOLE_VEIN_PILES_MIN + Math.floor(rng() * span)
  cell.piles = wormholeNodePilesFor(state, cell, count)
}

/** 矿脉堆的具体生成（`wormholeNodePiles` 的薄包装：序号按格坐标散列，保证同格同结果） */
function wormholeNodePilesFor(state: GameState, cell: WormholeGridCell, count: number): WormholeCellPile[] {
  const run = state.wormhole.run!
  const index = Math.abs(cell.q * 13 + cell.r * 29) % 97
  return wormholeNodePiles(runSeedOf(state), run.depth, index, count)
}

