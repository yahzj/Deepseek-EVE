import type { GameState } from '../../state'
import type { SimContext } from '../../types'
import { type WormholeFoeKind, wormholeCardIdForRun } from '../../wormholeFoes'
import type { CommandResult } from '../../engine'
import { withBattleRangeCheck } from '../../battleRangeMemory'
import { gridCellAt, hasLiveFoe, isExitCell, gridContentIndex } from '../../wormholeGrid'
import { startFleetBattleFor, stampFoeArrivalFx } from '../../combat'

export function wormholeStartBattle(
  state: GameState,
  ctx: SimContext,
  kind: Exclude<WormholeFoeKind, 'extract'>,
  atGameMs: number = state.gameMs,
  opts?: { strengthMul?: number },
): CommandResult {
  return withBattleRangeCheck(state, { kind: 'wormhole-fight', battleKind: kind, atGameMs, strengthMul: opts?.strengthMul }, staged => wormholeStartBattleMutable(staged, ctx, kind, atGameMs, opts))
}

export function wormholeStartBattleMutable(state: GameState, ctx: SimContext, kind: Exclude<WormholeFoeKind, 'extract'>,
  atGameMs: number, opts?: { strengthMul?: number }): CommandResult {
  if (state.departure?.kind === 'wormhole') return { ok: false, errorId: 'core.departure.001' }
  const run = state.wormhole.run
  if (!run) return { ok: false, error: '不在虫洞内。', errorId: 'core.wormholeBattle.001' }
  if (run.expeditionRules !== undefined && run.expeditionRules !== 2) return { ok: false, code: 'unsupported-rules' }
  if (run.expeditionRules === 2 && run.supplyVersion !== 1) return { ok: false, code: 'unsupported-rules' }
  if (run.battle) return { ok: false, error: '战斗还没结束。', errorId: 'core.wormholeBattle.002' }
  const grid = run.grid
  const here = grid ? gridCellAt(grid, grid.pos) : undefined
  const spawnHere = grid !== undefined && here !== undefined && hasLiveFoe(here)
  const eventHere = run.expeditionRules === 2 && here?.event?.battle === 'pending'
  if (run.expeditionRules === 2 && kind === 'node' && !spawnHere && !eventHere && here?.combatCleared) return { ok: false, errorId: 'core.wormholeBattle.008' }
  if (kind === 'node') {
    if (grid) {
      if (here?.place !== 'ship' && !spawnHere && !eventHere) {
        return { ok: false, error: '这里没有可交火的信号。', errorId: 'core.wormholeBattle.003' }
      }
    } else {
      if (!run.pendingNode) {
        return { ok: false, error: '本层已清空：该打层末守卫了。', errorId: 'core.wormholeBattle.004' }
      }
      if (run.pendingNode.kind !== 'combat') {
        return { ok: false, error: '这个节点不是战斗节点。', errorId: 'core.wormholeBattle.005' }
      }
    }
  } else if (kind === 'boss') {
    if (grid) {
      if (!here || !isExitCell(grid, grid.pos)) {
        return {
          ok: false,
          error: '层末守卫守在下一层入口：先找到并抵达入口。',
          errorId: 'core.wormholeBattle.006',
        }
      }
    } else if (run.pendingNode) {
      return { ok: false, error: '本层还没走完：先处理完层内节点。', errorId: 'core.wormholeBattle.007' }
    }
    if ((run.bossCleared ?? 0) >= run.depth) {
      return { ok: false, error: '本层守卫已经清掉了。', errorId: 'core.wormholeBattle.008' }
    }
  } else if (kind === 'ruins') {
    if (!grid) return { ok: false, error: '遗迹收尾战只在网格层成立。', errorId: 'core.wormholeBattle.009' }
    if (here?.place !== 'ruins') return { ok: false, error: '这里不是遗迹。', errorId: 'core.wormholeBattle.010' }
    if (run.pendingRuinsBattle !== true) {
      return { ok: false, error: '遗迹深处的守备还没被惊动：先在遗迹格上打捞一次。', errorId: 'core.wormholeBattle.011' }
    }
  } else if (kind === 'spawn') {
    if (!grid) return { ok: false, error: '围剿战只在网格层成立。', errorId: 'core.wormholeBattle.032' }
    if (!spawnHere) return { ok: false, error: '这里没有围剿者。', errorId: 'core.wormholeBattle.033' }
  }
  const waves = kind === 'node' && !grid ? Math.max(1, run.pendingNode?.waves ?? 1) : 1
  const battleKind: WormholeFoeKind = spawnHere ? 'spawn' : kind
  const cardId =
    battleKind === 'spawn' && here?.foe
      ? here.foe.card
      : wormholeCardIdForRun({
          family: run.family,
          seed: run.seed,
          depth: run.expeditionRules === 2 ? 1 : run.depth,
          kind: battleKind,
          nodeIndex: grid ? gridContentIndex(grid, grid.pos) : run.nodeIndex,
        })
  const battle = startFleetBattleFor(state, ctx, run.fleet, cardId, atGameMs, run.automaticBattleRanges ? null : undefined, {
    depth: run.depth,
    kind: battleKind,
    waves,
    ...(run.expeditionRules === 2 ? {
      expeditionRules: 2,
      expeditionRole: battleKind === 'spawn' ? 'patrol' as const : eventHere ? 'event' as const : battleKind === 'boss' ? 'guard' as const : here?.elite ? 'elite' as const : 'ordinary' as const,
      ...(battleKind === 'boss' && run.guardSupportDisabled ? { guardSupportDisabled: true } : {}),
      ...(run.nextBattleRangeMul ? { desireRangeMul: run.nextBattleRangeMul } : {}),
    } : {}),
    ...(opts?.strengthMul !== undefined ? { strengthMul: opts.strengthMul } : {}),
  })
  if (!battle) return { ok: false, error: '无法开战（编队或敌卡缺失）。', errorId: 'core.wormholeBattle.012' }
  stampFoeArrivalFx(battle)
  run.battle = battle
  if (run.expeditionRules === 2) delete run.nextBattleRangeMul
  if (run.pendingRuinsBattle === true) run.pendingRuinsBattle = false
  if (run.pendingNodeBattle === true) run.pendingNodeBattle = false
  return { ok: true }
}
