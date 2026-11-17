import { countWare, manufacturingLoopOf, matNeedCount, ownsBlueprint, isMarked, recipeCapability, materialGroupIdsOf } from '@whale/core'
import type { MaterialNeed } from '@whale/core'
import type { GameEngine } from '../../game/engine'

export function cardLiveKeyOf(
  engine: GameEngine,
  blueprintId: string,
  materials: readonly MaterialNeed[],
  runSig: string,
  ownedCount: number,
): string {
  const state = engine.state
  const mats = materials
    .map((m) => materialGroupIdsOf(m.itemId).reduce((sum, id) => sum + countWare(state, id), 0))
    .join(',')
  const needs = materials.map((m) => matNeedCount(state, m.count, blueprintId)).join(',')
  const loop = manufacturingLoopOf(state, blueprintId)
  const singleUse =
    engine.ctx.blueprints.get(blueprintId)?.singleUse === true || engine.ctx.shipBlueprints.get(blueprintId)?.singleUse === true
  const bp = `${ownsBlueprint(state, blueprintId) ? 1 : 0}.${state.blueprintStock[blueprintId] ?? 0}.${recipeCapability(state, blueprintId, singleUse).kind}`
  const mark = isMarked(state, 'blueprints', blueprintId) ? 1 : 0
  return `${mats}#${needs}#${runSig}#${loop.on ? 1 : 0}.${loop.produced}.${loop.stopWhy}#${bp}#${mark}#${ownedCount}`
}
