import type { PlanetBuildingDef, PlanetGridCell } from '@whale/core'

export const PLANET_BUILDING_GLYPHS: Readonly<Record<string, string>> = {
  base: 'planet-base', cryo: 'planet-cryo', power: 'planet-power', water: 'planet-water',
  nutrition: 'planet-nutrition', housing: 'planet-housing', farm: 'planet-farm', mine: 'planet-mine',
  'rare-extractor': 'planet-rare', industry: 'planet-industry', research: 'planet-research',
  maintenance: 'planet-maintenance', logistics: 'planet-logistics',
}
export const PLANET_RESOURCE_GLYPHS: Readonly<Record<string, string>> = {
  metal: 'mineral', water: 'ice', food: 'planet-food', medicine: 'kit', parts: 'part',
  research: 'nav-skills', rare: 'matter', energy: 'cpu',
}
const obstacles: Readonly<Record<string, string>> = {
  rough: 'planet-rough', ice: 'planet-ice', corrosion: 'planet-corrosion', rubble: 'planet-rubble',
}
const buildingTones: Readonly<Record<string, string>> = {
  base: 'rgb(var(--wui-gold))', cryo: 'rgb(var(--wui-blue-soft))', power: 'rgb(var(--wui-amber-3))',
  water: 'rgb(var(--wui-cyan))', nutrition: 'color-mix(in srgb, rgb(var(--wui-green)) 60%, rgb(var(--wui-gold)))',
  housing: 'rgb(var(--wui-text-2))', farm: 'rgb(var(--wui-green))', mine: 'rgb(var(--wui-amber))',
  'rare-extractor': 'rgb(var(--wui-purple))', industry: 'color-mix(in srgb, rgb(var(--wui-danger)) 65%, rgb(var(--wui-amber)))',
  research: 'color-mix(in srgb, rgb(var(--wui-purple)) 60%, rgb(var(--wui-blue-soft)))', maintenance: 'rgb(var(--wui-accent))',
  logistics: 'rgb(var(--wui-cyan-bright))',
}
export function planetBuildingTone(id: string | undefined): string {
  return id ? buildingTones[id] ?? 'rgb(var(--wui-text))' : 'currentColor'
}

export type PlanetSurfaceStatus = 'unknown' | 'obstacle' | 'empty' | 'construction' | 'stopped' | 'unpowered' | 'unstaffed' | 'ready'
export function planetSurfaceCellView(cell: PlanetGridCell | undefined, definition?: Pick<PlanetBuildingDef, 'worker'>) {
  const building = cell?.building
  const status: PlanetSurfaceStatus = !cell ? 'unknown' : cell.obstacle ? 'obstacle' : !building ? 'empty'
    : building.status === 'construction' ? 'construction' : building.status === 'stopped' || building.enabled === false ? 'stopped'
    : !building.powered ? 'unpowered' : definition?.worker === 'human' && !building.staffed ? 'unstaffed' : 'ready'
  const textKey = status === 'obstacle' ? 'obstacle.' + cell!.obstacle
    : status === 'unknown' || status === 'empty' ? status : 'status.' + status
  return {
    status, textKey,
    glyph: !cell ? 'ico-scan' : cell.obstacle ? obstacles[cell.obstacle]! : building
      ? PLANET_BUILDING_GLYPHS[building.id] ?? 'planet-base' : cell.deposit ? PLANET_RESOURCE_GLYPHS[cell.deposit.resource]! : 'planet-empty',
    resourceGlyph: cell?.deposit ? PLANET_RESOURCE_GLYPHS[cell.deposit.resource] : undefined,
    nameKey: !cell ? 'unknown' : cell.obstacle ? 'obstacle.' + cell.obstacle : building ? 'building.' + building.id : cell.deposit ? 'resource.' + cell.deposit.resource : 'empty',
  }
}
