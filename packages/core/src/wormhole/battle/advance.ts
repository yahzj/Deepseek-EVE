import { type GameState, addLog } from '../../state'
import type { SimContext } from '../../types'
import { gridCellAt, hasLiveFoe } from '../../wormholeGrid'
import { wormholeStartBattle } from './start'
import { advanceBattleFor, battleShowWindowMs, battleClockNowMs } from '../../combat'
import { settleWormholeBattle } from './outcome'
import { wormholeHoldUsage } from '../../wormholeSalvage'
import { bagValueIsk, deliverExtraction } from './extraction'
import { repairCivilianFittings } from '../../equipment'
import type { WormholeRunState } from '../../wormhole'
import { uidDefId } from '../../labels'

export function advanceWormhole(
  state: GameState,
  ctx: SimContext,
  freezeBattle = false,
  battleSpeedX = 1,
): void {
  if (state.departure?.kind === 'wormhole') return
  const run = state.wormhole.run
  if (run?.expeditionRules !== undefined && run.expeditionRules !== 2) return
  if (!run) return
  reconcileWormholeFleet(state, ctx, run)
  if (run.attending !== true) return
  if (!run.battle && run.grid && run.pendingRuinsBattle !== true && !(run.supplyVersion === 1 && run.phase === 'extracting')) {
    const hereSpawn = gridCellAt(run.grid, run.grid.pos)
    if (hereSpawn !== undefined && hasLiveFoe(hereSpawn)) wormholeStartBattle(state, ctx, 'spawn')
  }
  if (run.battle) {
    if (freezeBattle) {
      const owed = Math.max(0, state.gameMs - run.battle.lastTickGameMs)
      if (owed > 0) {
        run.battle.lastTickGameMs = state.gameMs
        run.battle.startedAtGameMs += owed
      }
      return
    }
    advanceBattleFor(state, ctx, run.battle, run.fleet[0] ?? state.shipId, run.battle.wormhole?.cardId ?? null, null, undefined, undefined, { battleSpeedX })
    if (run.battle.ended) {
      const waitMs = battleShowWindowMs(run.battle, ctx.balance.battle.killcamMs)
      if (battleClockNowMs(state, run.battle) - run.battle.lastTickGameMs < waitMs) return
      settleWormholeBattle(state, ctx, run)
    }
    return
  }
  if (run.phase === 'extracting' && !freezeBattle) {
    if (run.supplyVersion === 1 && wormholeHoldUsage(state, ctx).overload) {
      run.phase = 'inside'
      return
    }
    if (run.fleet.length === 0) {
      addLog(
        state,
        'combat',
        `🕳 撤离失败：编队已经没了（全灭或档案异常）——本趟按全损处理。`,
        'core.wormholeBattle.023',
      )
      state.wormhole.lastSettle = {
        kind: 'lost',
        depth: run.depth,
        oreUnits: 0,
        oreIsk: 0,
        wreckIsk: 0,
        boxes: [],
        relics: [],
        shipsLost: [],
        lostIsk: bagValueIsk(ctx, run),
      }
      state.wormhole.run = null
      repairCivilianFittings(state, ctx)
      return
    }
    deliverExtraction(state, ctx, run)
    state.wormhole.run = null
    repairCivilianFittings(state, ctx)
    return
  }
}

export function reconcileWormholeFleet(state: GameState, ctx: SimContext, run: WormholeRunState): void {
  if (run.fleet.every((uid) => state.fleet[uid] !== undefined)) return
  const ghosts = run.fleet.filter((uid) => state.fleet[uid] === undefined)
  run.fleet = run.fleet.filter((uid) => state.fleet[uid] !== undefined)
  const names = ghosts.map((uid) => ctx.ships.get(uidDefId(uid))?.name ?? uid)
  addLog(
    state,
    'warn',
    `🕳 编队核对：${names.join('、')} 已不在舰队（${ghosts.length} 艘）——已从本趟编队里摘掉，剩余 ${run.fleet.length} 艘。`,
  )
}
