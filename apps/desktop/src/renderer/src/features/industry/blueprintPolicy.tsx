import { manualSlotOf, stationActivityStartBlockReason } from '@whale/core'
import type { GameState, SimContext } from '@whale/core'
import type { GameEngine } from '../../game/engine'
import { cmdText } from '../../i18n/locale'
import { tr } from '../../i18n/locale'



export function isWormholeBlueprint(bpId: string): boolean {
  return /^(bp|sbp)-wh-/.test(bpId)
}

export function factionPlugBlueprintKind(ctx: SimContext, bpId: string): 'single' | 'unavailable' | null {
  const bp = ctx.blueprints.get(bpId)
  const mod = bp?.moduleId ? ctx.modules.get(bp.moduleId) : undefined
  if (mod?.slot !== 'plug' || mod.blueprintExchangeDisabled !== true) return null
  return bp?.singleUse === true ? 'single' : 'unavailable'
}

export function manufacturingBlueprintVisible(state: GameState, ctx: SimContext, bpId: string): boolean {
  return factionPlugBlueprintKind(ctx, bpId) !== 'unavailable'
    || state.learnedRecipes.includes(bpId) || (state.blueprintStock[bpId] ?? 0) > 0
    || state.manufacturingRuns.some(run => run.active && run.blueprintId === bpId)
}

export function manualBuildNote(state: GameState, engine: GameEngine): string | null {
  const slot = manualSlotOf(state)
  if (slot === 'manufacturing') return tr("ui.Industry.025")
  if (slot === 'refine') return tr("ui.Industry.026")
  if (slot === 'lab') return tr('ui.hud.212')
  const blocked = stationActivityStartBlockReason(state, engine.ctx, 'manufacturing')
  if (blocked) return cmdText(blocked)
  return null
}
