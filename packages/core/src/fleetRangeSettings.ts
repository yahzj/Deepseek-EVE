export interface FleetRangePreference { desireM?: number; maxRangeM?: number }
export interface FleetRangeSettings extends FleetRangePreference { shipIds: string[]; presetId?: string }

export function sameFleetRangeRoster(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, i) => id === right[i])
}
export function cleanFleetRangePreference(raw: unknown): FleetRangePreference | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const row = raw as FleetRangePreference
  const desireM = typeof row.desireM === 'number' && Number.isSafeInteger(row.desireM) && row.desireM > 0 ? row.desireM : undefined
  const maxRangeM = typeof row.maxRangeM === 'number' && Number.isSafeInteger(row.maxRangeM) && row.maxRangeM >= 0 ? row.maxRangeM : undefined
  return desireM !== undefined || maxRangeM !== undefined ? { ...(desireM !== undefined ? { desireM } : {}), ...(maxRangeM !== undefined ? { maxRangeM } : {}) } : undefined
}
export function cleanFleetRangeSettings(raw: unknown): FleetRangeSettings | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const row = raw as FleetRangeSettings
  if (!Array.isArray(row.shipIds) || !row.shipIds.length || row.shipIds.length > 12
    || row.shipIds.some(id => typeof id !== 'string' || !id || id.length > 128) || new Set(row.shipIds).size !== row.shipIds.length) return undefined
  return { ...cleanFleetRangePreference(row), shipIds: [...row.shipIds],
    ...(typeof row.presetId === 'string' && row.presetId.length > 0 && row.presetId.length <= 64 ? { presetId: row.presetId } : {}) }
}
