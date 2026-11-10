import type { SignalAutoEstimate, SignalAutoGuardBattle, SignalAutoLayerProgress, SignalAutoLayerReport, SignalAutoReportDetails } from './types'
import { SIGNAL_AUTO_COMBAT } from './combat'

const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const finite = (value: unknown, min = 0, max = 1e12): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
const integer = (value: unknown, min = 0, max = 1e12): value is number => finite(value, min, max) && Number.isSafeInteger(value)
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-8

function cleanGains(value: unknown): SignalAutoEstimate['gains'] | undefined {
  if (!Array.isArray(value) || value.length > 128) return undefined
  const gains: SignalAutoEstimate['gains'] = [], ids = new Set<string>()
  for (const value0 of value) {
    const gain = record(value0)
    if (!gain || typeof gain.itemId !== 'string' || gain.itemId.length < 1 || gain.itemId.length > 128
      || ids.has(gain.itemId) || !integer(gain.units, 1)) return undefined
    ids.add(gain.itemId)
    gains.push({ itemId: gain.itemId, units: gain.units })
  }
  return gains
}

function cleanLayer(value: unknown, version: 1 | 2): SignalAutoLayerProgress | undefined {
  const layer = record(value)
  if (!layer || !integer(layer.depth, 1, 9) || !finite(layer.completion, 0, 1)
    || typeof layer.guardPassed !== 'boolean' || layer.guardPassed && layer.completion !== 1) return undefined
  const base = { depth: layer.depth, completion: layer.completion, guardPassed: layer.guardPassed }
  if (version === 1) {
    if (!finite(layer.combatRatio)) return undefined
    return { ...base, combatRatio: layer.combatRatio }
  }
  const battle = record(layer.guardBattle)
  if (!battle || typeof battle.cardId !== 'string' || battle.cardId.length < 1 || battle.cardId.length > 128
    || !['victory', 'defeat', 'timeout', 'unavailable'].includes(String(battle.outcome))
    || !integer(battle.durationMs) || layer.guardPassed !== (layer.completion === 1 && battle.outcome === 'victory')) return undefined
  return { ...base, guardBattle: { cardId: battle.cardId,
    outcome: battle.outcome as SignalAutoGuardBattle['outcome'], durationMs: battle.durationMs } }
}

function returnReasonMatches(report: SignalAutoReportDetails): boolean {
  const last = report.layers.at(-1)!
  const won = report.guardRules === 2 ? last.guardBattle?.outcome === 'victory'
    : (last.combatRatio ?? 0) >= SIGNAL_AUTO_COMBAT.guardRatio
  if (report.returnReason === 'max-depth') return last.depth === 9 && last.completion === 1
  if (report.returnReason === 'guard') return last.depth < 9 && last.completion === 1 && !won
  return last.completion < 1 || last.depth < 9 && won && close(report.spentTurns, report.availableTurns)
}

/** 快照整体有效才保留；损坏结果不能被清洗成另一份可领取的奖励。 */
export function cleanSignalAutoEstimate(value: unknown): SignalAutoEstimate | undefined {
  const row = record(value), tech = record(row?.tech), cap = record(row?.capability)
  if ((row?.version !== 1 && row?.version !== 2) || !tech || !cap) return undefined
  const version = row.version
  const techKeys = ['total', 'wreck', 'ore', 'damage', 'turnMul', 'holdMul', 'salvageEff', 'collectEff', 'battleProgress', 'baseTurns', 'baseHold'] as const
  if (techKeys.some(key => !finite(tech[key])) || !finite(tech.damage, .5, 1) || !finite(tech.battleProgress, 0, 1)) return undefined
  const capKeys = ['turns', 'scanRadius', 'miners', 'salvagers', 'holdM3'] as const
  if (capKeys.some(key => !integer(cap[key])) || !finite(cap.scanRadius, 1) || !finite(cap.holdM3, 1)) return undefined
  if (!Array.isArray(row.layers) || row.layers.length < 1 || row.layers.length > 9) return undefined
  const layers: SignalAutoEstimate['layers'] = []
  for (const value of row.layers) {
    const layer = cleanLayer(value, version), previous = layers.at(-1)
    if (!layer || previous && (!previous.guardPassed || layer.depth !== previous.depth + 1)) return undefined
    layers.push(layer)
  }
  if (row.depthReached !== layers.at(-1)!.depth || !finite(row.ordinaryUsedM3, 0, cap.holdM3 as number)) return undefined
  const gains = cleanGains(row.gains)
  if (!gains || !Array.isArray(row.cores) || row.cores.length > 1) return undefined
  const cores: SignalAutoEstimate['cores'] = []
  for (const value of row.cores) {
    const core = record(value)
    if (!core || !['gamma', 'beta', 'alpha'].includes(String(core.type)) || core.n !== 1) return undefined
    cores.push({ type: core.type as 'gamma' | 'beta' | 'alpha', n: 1 })
  }
  let report: SignalAutoReportDetails | undefined
  if (row.report !== undefined) {
    report = cleanSignalAutoReportDetails(row.report)
    if (!report || (report.guardRules === 2) !== (version === 2) || report.layers.length !== layers.length
      || report.availableTurns > (cap.turns as number)) return undefined
    const totals = new Map<string, number>()
    for (const [index, detail] of report.layers.entries()) {
      const estimateLayer = layers[index]!
      if (detail.depth !== estimateLayer.depth || detail.completion !== estimateLayer.completion
        || detail.combatRatio !== estimateLayer.combatRatio || detail.guardPassed !== estimateLayer.guardPassed
        || JSON.stringify(detail.guardBattle) !== JSON.stringify(estimateLayer.guardBattle)) return undefined
      for (const gain of detail.gains) {
        totals.set(gain.itemId, (totals.get(gain.itemId) ?? 0) + gain.units)
      }
    }
    if (totals.size !== gains.length || gains.some(gain => totals.get(gain.itemId) !== gain.units)) return undefined
  }
  return { version, tech: Object.fromEntries(techKeys.map(key => [key, tech[key]])) as unknown as SignalAutoEstimate['tech'],
    capability: Object.fromEntries(capKeys.map(key => [key, cap[key]])) as unknown as SignalAutoEstimate['capability'],
    layers, depthReached: layers.at(-1)!.depth, ordinaryUsedM3: row.ordinaryUsedM3, gains, cores,
    ...(report ? { report } : {}) }
}

/** 旧报告不含逐层数据；新字段出现时整体验证，避免显示残缺的伪明细。 */
export function cleanSignalAutoReportDetails(value: unknown): SignalAutoReportDetails | undefined {
  const row = record(value)
  if (!row || !integer(row.availableTurns) || !finite(row.spentTurns) || row.spentTurns > row.availableTurns + 1e-8
    || row.guardRules !== undefined && row.guardRules !== 2
    || !['guard', 'budget', 'max-depth'].includes(String(row.returnReason))
    || !Array.isArray(row.layers) || row.layers.length < 1 || row.layers.length > 9) return undefined
  const layers: SignalAutoLayerReport[] = []
  for (const value of row.layers) {
    const raw = record(value), layer = cleanLayer(value, row.guardRules === 2 ? 2 : 1), previous = layers.at(-1)
    const gains = cleanGains(raw?.gains)
    if (!raw || !layer || !finite(raw.turns) || !gains
      || previous && (!previous.guardPassed || layer.depth !== previous.depth + 1)) return undefined
    layers.push({ ...layer, turns: raw.turns, gains })
  }
  const report: SignalAutoReportDetails = { availableTurns: row.availableTurns, spentTurns: row.spentTurns,
    returnReason: row.returnReason as SignalAutoReportDetails['returnReason'], layers,
    ...(row.guardRules === 2 ? { guardRules: 2 } : {}) }
  if (!close(layers.reduce((sum, layer) => sum + layer.turns, 0), report.spentTurns) || !returnReasonMatches(report)) return undefined
  return report
}
