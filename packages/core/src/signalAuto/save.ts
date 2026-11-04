import type { SignalAutoEstimate } from './types'

const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
const finite = (value: unknown, min = 0, max = 1e12): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
const integer = (value: unknown, min = 0, max = 1e12): value is number => finite(value, min, max) && Number.isSafeInteger(value)

/** 快照整体有效才保留；损坏结果不能被清洗成另一份可领取的奖励。 */
export function cleanSignalAutoEstimate(value: unknown): SignalAutoEstimate | undefined {
  const row = record(value), tech = record(row?.tech), cap = record(row?.capability)
  if (row?.version !== 1 || !tech || !cap) return undefined
  const techKeys = ['total', 'wreck', 'ore', 'damage', 'turnMul', 'holdMul', 'salvageEff', 'collectEff', 'battleProgress', 'baseTurns', 'baseHold'] as const
  if (techKeys.some(key => !finite(tech[key])) || !finite(tech.damage, .5, 1) || !finite(tech.battleProgress, 0, 1)) return undefined
  const capKeys = ['turns', 'scanRadius', 'miners', 'salvagers', 'holdM3'] as const
  if (capKeys.some(key => !integer(cap[key])) || !finite(cap.scanRadius, 1) || !finite(cap.holdM3, 1)) return undefined
  if (!Array.isArray(row.layers) || row.layers.length < 1 || row.layers.length > 9) return undefined
  const layers: SignalAutoEstimate['layers'] = []
  for (const value of row.layers) {
    const layer = record(value), previous = layers.at(-1)
    if (!layer || !integer(layer.depth, 1, 9) || !finite(layer.completion, 0, 1) || !finite(layer.combatRatio)
      || typeof layer.guardPassed !== 'boolean' || layer.guardPassed && layer.completion !== 1
      || previous && (!previous.guardPassed || layer.depth !== previous.depth + 1)) return undefined
    layers.push({ depth: layer.depth, completion: layer.completion, combatRatio: layer.combatRatio, guardPassed: layer.guardPassed })
  }
  if (row.depthReached !== layers.at(-1)!.depth || !finite(row.ordinaryUsedM3, 0, cap.holdM3 as number)) return undefined
  if (!Array.isArray(row.gains) || row.gains.length > 128 || !Array.isArray(row.cores) || row.cores.length > 1) return undefined
  const gains: SignalAutoEstimate['gains'] = [], ids = new Set<string>()
  for (const value of row.gains) {
    const gain = record(value)
    if (!gain || typeof gain.itemId !== 'string' || gain.itemId.length < 1 || gain.itemId.length > 128 || ids.has(gain.itemId) || !integer(gain.units, 1)) return undefined
    ids.add(gain.itemId); gains.push({ itemId: gain.itemId, units: gain.units })
  }
  const cores: SignalAutoEstimate['cores'] = []
  for (const value of row.cores) {
    const core = record(value)
    if (!core || !['gamma', 'beta', 'alpha'].includes(String(core.type)) || core.n !== 1) return undefined
    cores.push({ type: core.type as 'gamma' | 'beta' | 'alpha', n: 1 })
  }
  return { version: 1, tech: Object.fromEntries(techKeys.map(key => [key, tech[key]])) as unknown as SignalAutoEstimate['tech'],
    capability: Object.fromEntries(capKeys.map(key => [key, cap[key]])) as unknown as SignalAutoEstimate['capability'],
    layers, depthReached: layers.at(-1)!.depth, ordinaryUsedM3: row.ordinaryUsedM3, gains, cores }
}
