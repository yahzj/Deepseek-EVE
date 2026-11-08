import type { GameState, WormholeArchetype, WormholeFamily } from '../state'
import type { SimContext } from '../types'
import type { SignalAutoEstimate } from './types'
import { signalAutoCombatRatio, SIGNAL_AUTO_COMBAT } from './combat'
import type { WormholeAutoTechFactors } from '../wormholeAuto'
import { blankShareFactorOf, wormholeAdmission, wormholeScanBonusOf, wormholeStepCost, WORMHOLE_PILE_UNITS_BASE, WORMHOLE_ORE_ITEM_ID } from '../wormhole'
import { matterTechWhBuffs } from '../matterTech'
import { hexDiskCount, wormholeEmptyShareFor, wormholeGridRadiusFor, wormholeNebulaShareFor,
  wormholeSignalWeightsFor, wormholeRuinsShareFor, wormholeRuinsFloorFor, wormholeRuinsFloorBonusFor, WORMHOLE_MATTER_FLOOR } from '../wormholeGrid'
import { wormholeMinersInFleet, wormholeSalvagersInFleet, wormholeWorkEfficiencyOfFleet,
  WORMHOLE_WRECK_PILE_M3_BASE, WORMHOLE_GRAVEYARD_COMMONS_MIN, WORMHOLE_GRAVEYARD_COMMONS_MAX,
  WORMHOLE_VEIN_PILES_MIN, WORMHOLE_VEIN_PILES_MAX, WORMHOLE_SHIP_SPOIL_COMMONS,
  wormholeRelicChanceOf, wormholeRollRelicBoxKind, WORMHOLE_ESSENCE_ITEM_ID, WORMHOLE_CORE_SHARE, WORMHOLE_CORE_WEIGHTS } from '../wormholeSalvage'
import { signalSpaceResourcePileBonus, wormholeLayerRewardMul, wormholeCardIdOfFamily } from '../wormholeFoes'
import { RARE_WRECK_VOLUME_M3, wreckGroupOfCard, wreckItemIdOf, rareWreckItemIdOf } from '../salvage'
import { nextRandom, hashSeed, pickWeighted } from '../rng'
import { tuningMul } from '../tuning'

/** 仅新版本使用；过程没有随机项，旋钮不影响旧任务。 */
export const SIGNAL_AUTO_ESTIMATE_CONFIG = { reserveTurns: 2, movePerPlace: 1.25, workPerPlace: 1,
  exitRadiusCost: 1.5, ordinaryJitter: .1, relicChecks: 2, maxDepth: 9,
  ordinaryHoldShareMin: .25 } as const

/**
 * 下潜途中普通作业的累计目标，按层深与已用回合放宽；只用于分配作业回合。
 * 终层仍可使用完整货舱，特殊奖励从不占用普通资源容量。
 */
export function signalAutoOrdinaryHoldShareOf(depth: number, remaining: number, budget: number): number {
  const progress = Math.max(0, Math.min(1, Math.max(
    (depth - 1) / (SIGNAL_AUTO_ESTIMATE_CONFIG.maxDepth - 1),
    1 - remaining / Math.max(1, budget))))
  return SIGNAL_AUTO_ESTIMATE_CONFIG.ordinaryHoldShareMin
    + (1 - SIGNAL_AUTO_ESTIMATE_CONFIG.ordinaryHoldShareMin) * progress
}

export function signalAutoEstimateOf(state: GameState, ctx: SimContext, ids: readonly string[],
  signal: { seed: number; depth: number; family: WormholeFamily; archetype: WormholeArchetype },
  yieldMul: number, tech: WormholeAutoTechFactors, holdM3: number): SignalAutoEstimate {
  const buffs = matterTechWhBuffs(state, ctx)
  const admission = wormholeAdmission(ctx, ids, buffs.turnBonus)
  const miners = wormholeMinersInFleet(state, ctx, ids), salvagers = wormholeSalvagersInFleet(state, ctx, ids)
  const scanRadius = Math.max(1, 1 + wormholeScanBonusOf(ctx, ids) + buffs.scanRadius)
  // 档位与科技只在作业效率中计一次，台数为每动作的基础堆数。
  const mining = miners > 0 ? miners + wormholeWorkEfficiencyOfFleet(state, ctx, ids, 'miner') : 0
  const salvage = salvagers > 0 ? salvagers + wormholeWorkEfficiencyOfFleet(state, ctx, ids, 'salvager') : 0
  const recover = (throughput: number) => throughput / (1 + throughput)
  const out: SignalAutoEstimate = { version: 1, tech, capability: { turns: admission.turnBudget, scanRadius, miners, salvagers, holdM3 },
    layers: [], depthReached: Math.max(1, Math.min(9, signal.depth)), ordinaryUsedM3: 0, gains: [], cores: [] }
  const expected = { wreck: 0, ore: 0, essence: 0 }
  const opportunities: Array<{ depth: number; checks: number }> = []
  const budget = Math.max(0, admission.turnBudget - SIGNAL_AUTO_ESTIMATE_CONFIG.reserveTurns)
  let remaining = budget, ordinaryPlannedM3 = 0
  const oreId = WORMHOLE_ORE_ITEM_ID, oreM3 = ctx.items.get(oreId)?.unitM3 ?? 1
  const weights = wormholeSignalWeightsFor(signal.archetype)
  const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0)
  for (let depth = out.depthReached; depth <= SIGNAL_AUTO_ESTIMATE_CONFIG.maxDepth && remaining > 0; depth++) {
    const radius = wormholeGridRadiusFor(depth), cells = hexDiskCount(radius)
    const baseSites = (cells - 1) * (1 - wormholeEmptyShareFor(depth))
    const sites = (cells - 1) * (1 - wormholeEmptyShareFor(depth, blankShareFactorOf(state)))
    const wreckSites = sites * weights.wreck / totalWeight
    const ruins = depth === 1 ? 0 : Math.max(wreckSites * wormholeRuinsShareFor(signal.archetype),
      wormholeRuinsFloorFor(depth) + (depth >= 3 ? wormholeRuinsFloorBonusFor(signal.archetype) : 0))
    const graves = Math.max(0, wreckSites - ruins)
    const veins = sites * weights.resource / totalWeight, ships = sites * weights.ship / totalWeight
    const matter = Math.max(WORMHOLE_MATTER_FLOOR, sites * weights.radar / totalWeight)
    const scanCost = cells / hexDiskCount(scanRadius) * (1 + wormholeNebulaShareFor(depth))
    const workCost = SIGNAL_AUTO_ESTIMATE_CONFIG.movePerPlace + SIGNAL_AUTO_ESTIMATE_CONFIG.workPerPlace
    const fullCost = scanCost + baseSites * workCost
      + radius * SIGNAL_AUTO_ESTIMATE_CONFIG.exitRadiusCost + wormholeStepCost(1, 0)
    const rewardMul = wormholeLayerRewardMul(depth), extra = signalSpaceResourcePileBonus(depth)
    const common = salvagers > 0 ? rewardMul * WORMHOLE_WRECK_PILE_M3_BASE * graves
      * ((WORMHOLE_GRAVEYARD_COMMONS_MIN + WORMHOLE_GRAVEYARD_COMMONS_MAX) / 2 + extra) : 0
    const ore = miners > 0 ? rewardMul * WORMHOLE_PILE_UNITS_BASE * veins
      * ((WORMHOLE_VEIN_PILES_MIN + WORMHOLE_VEIN_PILES_MAX) / 2 + extra) : 0
    const ordinaryVolume = common + ore * oreM3
    const share = signalAutoOrdinaryHoldShareOf(depth, remaining, budget)
    // 用未乘设备回收效率的潜在体积排程，升级设备不会反过来增加浅层作业回合。
    const plannedWork = Math.min(1, Math.max(0, holdM3 * share - ordinaryPlannedM3) / Math.max(1, ordinaryVolume))
    const ordinarySites = (salvagers > 0 ? graves : 0) + (miners > 0 ? veins : 0)
    const savedCost = baseSites * Math.min(1, ordinarySites / Math.max(1, sites)) * workCost * (1 - plannedWork)
    const plannedCost = fullCost - savedCost
    const combatRatio = signalAutoCombatRatio(state, ctx, ids, signal.family, depth)
    const descend = depth < SIGNAL_AUTO_ESTIMATE_CONFIG.maxDepth
      && combatRatio >= SIGNAL_AUTO_COMBAT.guardRatio && remaining >= plannedCost
    // 不能继续下潜时恢复本层普通作业，不因预留目标而空舱撤离。
    const ordinaryWork = descend ? plannedWork : 1
    const layerCost = descend ? plannedCost : fullCost
    const completion = Math.min(1, remaining / layerCost)
    const guardPassed = completion === 1 && combatRatio >= SIGNAL_AUTO_COMBAT.guardRatio
    out.layers.push({ depth, completion, combatRatio, guardPassed })
    out.depthReached = depth
    const combatWreck = guardPassed ? rewardMul * WORMHOLE_WRECK_PILE_M3_BASE * ships * WORMHOLE_SHIP_SPOIL_COMMONS : 0
    expected.wreck += completion * (common * recover(salvage) * ordinaryWork + combatWreck)
    expected.ore += completion * ore * recover(mining) * ordinaryWork
    ordinaryPlannedM3 += completion * (ordinaryVolume * ordinaryWork + combatWreck)
    expected.essence += completion * matter
    if (salvagers > 0) opportunities.push({ depth, checks: completion * ruins * SIGNAL_AUTO_ESTIMATE_CONFIG.relicChecks * recover(salvage) })
    remaining = Math.max(0, remaining - layerCost)
    if (!guardPassed) break
  }
  const stream = (line: string) => {
    const rng = { seed: hashSeed(`signal-auto-estimate-1/${signal.seed}/${signal.depth}/${line}`), count: 0 }
    return () => nextRandom(rng)
  }
  const round = (value: number, random: () => number) => Math.floor(value) + (random() < value % 1 ? 1 : 0)
  const gains = new Map<string, number>()
  const add = (id: string, n: number) => { if (n > 0) gains.set(id, (gains.get(id) ?? 0) + n) }
  const cardId = wormholeCardIdOfFamily(signal.family, signal.seed), key = wreckGroupOfCard(cardId, ctx)?.key ?? cardId
  const jitter = 1 + (stream('ordinary')() * 2 - 1) * SIGNAL_AUTO_ESTIMATE_CONFIG.ordinaryJitter
  const common = expected.wreck * jitter, ore = expected.ore * jitter
  const volume = common + ore * oreM3, scale = Math.min(1, holdM3 / Math.max(1, volume))
  // 收成系数在实际可装数量之后应用，否则满仓会抹平科技等级差异。
  const wreckN = Math.floor(common * scale * yieldMul), oreN = Math.floor(ore * scale * yieldMul)
  out.ordinaryUsedM3 = wreckN + oreN * oreM3
  add(wreckItemIdOf(key), wreckN); add(oreId, oreN)
  // 各奖励线独立取整：固定整数机会，只为小数部分多掷一次。
  for (const row of opportunities) {
    add(rareWreckItemIdOf(key), round(row.checks * wormholeRelicChanceOf(row.depth) * yieldMul, stream(`rare/${row.depth}`)) * RARE_WRECK_VOLUME_M3 * tuningMul(state, 'rareWreckVolume'))
    const boxRandom = stream(`boxes/${row.depth}`)
    const boxes = round(row.checks * (1 - wormholeRelicChanceOf(row.depth)) * yieldMul, stream(`box-count/${row.depth}`))
    for (let i = 0; i < boxes; i++) {
      const box = wormholeRollRelicBoxKind(boxRandom, ctx, row.depth, signal.family)
      if (box) add(box, 1)
    }
  }
  add(WORMHOLE_ESSENCE_ITEM_ID, round(expected.essence * yieldMul, stream('essence')))
  // 核心保持独立每趟一次规则；按已完成层加权，不以触达最深层放大全趟。
  const completed = out.layers.reduce((n, layer) => n + layer.completion, 0)
  const weightedDepth = out.layers.reduce((n, layer) => n + layer.depth * layer.completion, 0) / Math.max(1, completed)
  const coreRng = { seed: hashSeed(`signal-auto-core-1/${signal.seed}/${signal.depth}`), count: 0 }
  if (nextRandom(coreRng) < Math.min(.95, WORMHOLE_CORE_SHARE * (1 + .15 * Math.max(0, weightedDepth - 1)) * tech.wreck * Math.min(1, completed))) {
    const type = pickWeighted(coreRng, ['gamma', 'beta', 'alpha'] as const, type => WORMHOLE_CORE_WEIGHTS[type])!
    out.cores.push({ type, n: 1 })
  }
  out.gains = [...gains].map(([itemId, units]) => ({ itemId, units: Math.floor(units) }))
  return out
}
