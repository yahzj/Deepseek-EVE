import { type GameState, addLog } from '../../state'
import type { SimContext } from '../../types'
import { type WormholeActivateEffect, wormholePendingBattleReason, wormholeGridActivate, wormholeGridTravel } from '../../wormhole'
import type { WormholeFoeKind } from '../../wormholeFoes'
import { withBattleRangeCheck } from '../../battleRangeMemory'
import { wormholeActionBlockReason, wormholeSalvageAt, wormholeCollectOreAt, wormholeStowOrTemp, wormholeEnsureArrivalPiles } from '../../wormholeSalvage'
import { gridCellAt, hasLiveFoe, isExitCell } from '../../wormholeGrid'
import { wormholeStartBattle } from './start'
import { wormholeMatterDeviceAt } from '../../wormholeMatter'

export function wormholeActivateAt(
  state: GameState,
  ctx: SimContext,
  atGameMs?: number,
  opts?: { deferRuinsBattle?: boolean },
): {
  ok: boolean
  error?: string
  errorId?: string
  errorParams?: Readonly<Record<string, string | number>>
  spent?: number
  effect?: WormholeActivateEffect
  started?: WormholeFoeKind
  pendingBattle?: 'ruins'
  taken?: number
  code?: 'unsupported-rules'
} {
  return withBattleRangeCheck(state, { kind: 'wormhole-activate', atGameMs, options: opts }, staged => wormholeActivateAtMutable(staged, ctx, atGameMs, opts))
}

export function wormholeActivateAtMutable(state: GameState, ctx: SimContext, atGameMs?: number, opts?: { deferRuinsBattle?: boolean }): ReturnType<typeof wormholeActivateAt> {
  const run = state.wormhole.run
  if (run?.expeditionRules !== undefined && run.expeditionRules !== 2) return { ok: false, code: 'unsupported-rules' }
  const turnsBefore = run?.turnsLeft ?? 0
  const pendingBattle = wormholePendingBattleReason(state)
  if (pendingBattle) {
    return { ok: false, error: pendingBattle.error, errorId: pendingBattle.errorId, errorParams: pendingBattle.errorParams }
  }
  const overloaded = wormholeActionBlockReason(state, ctx)
  const battleCell = run?.grid ? gridCellAt(run.grid, run.grid.pos) : undefined
  const mustBattle = run?.supplyVersion === 1 && battleCell && (battleCell.place === 'ship' || hasLiveFoe(battleCell) || isExitCell(run.grid!, run.grid!.pos))
  if (overloaded && !mustBattle) return { ok: false, error: overloaded }

  const hereCell = run?.grid ? gridCellAt(run.grid, run.grid.pos) : undefined
  if (hereCell && (hereCell.place === 'graveyard' || hereCell.place === 'ruins' || hereCell.place === 'research')) {
    const s = wormholeSalvageAt(state, ctx)
    if (!s.ok) return { ok: false, error: s.error, errorId: s.errorId, errorParams: s.errorParams }
    const effect = s.effect
    if (!effect || effect.kind !== 'ruinsBattle') return { ok: true, spent: s.spent, taken: s.taken?.length ?? 0 }
    if (opts?.deferRuinsBattle === true) {
      return { ok: true, spent: s.spent, taken: s.taken?.length ?? 0, effect, pendingBattle: 'ruins' }
    }
    const b = wormholeStartBattle(state, ctx, 'ruins', atGameMs)
    if (!b.ok) {
      return {
        ok: false,
        error: `无法开战：${b.error ?? ''}`,
        errorId: 'core.wormholeBattle.013',
        errorParams: { p1: b.error ?? '' },
      }
    }
    return { ok: true, spent: s.spent, taken: s.taken?.length ?? 0, effect, started: 'ruins' }
  }
  if (hereCell?.place === 'vein') {
    const c = wormholeCollectOreAt(state, ctx)
    if (!c.ok) return { ok: false, error: c.error }
    return { ok: true, spent: c.spent, taken: c.taken?.length ?? 0 }
  }
  const r = wormholeGridActivate(state)
  if (!r.ok) return { ok: false, error: r.error }
  const effect = r.effect
  if (!effect) return { ok: true, spent: r.spent }
  const kind: WormholeFoeKind | null = effect.kind === 'exit' ? 'boss' : effect.kind === 'battle' ? 'node' : null
  if (!kind) {
    if (effect.kind === 'matter' && run) {
      const device = wormholeMatterDeviceAt(run.seed ?? 0, run.depth, effect.key)
      const landed = wormholeStowOrTemp(state, ctx, device.id, 1)
      if (!landed.ok) {
        run.turnsLeft = turnsBefore
        if (run.grid) run.grid.activated = run.grid.activated.filter((k) => k !== effect.key)
        return {
          ok: false,
          error: `取不回「${device.name}」：${landed.error ?? '货仓放不下'}（它占 2×2 = 4 格，先腾地方或抛货）`,
          errorId: 'core.wormholeBattle.014',
          errorParams: {
            p1: device.name,
            p2: landed.error ?? '货仓放不下',
            ...(landed.error === undefined ? { p2Id: 'core.wormholeBattle.015' } : {}),
          },
        }
      }
      addLog(
        state,
        'combat',
        `🕳 取回谜质：${device.name}（${device.text}）——` +
          `${landed.where === 'temp' ? '货仓腾不出 2×2，已先进临时空间' : '占货仓 2×2 格'}，离开虫洞即失效。`,
      )
      return { ok: true, spent: r.spent, effect, taken: 1 }
    }
    return { ok: true, spent: r.spent, effect }
  }
  const s = wormholeStartBattle(state, ctx, kind, atGameMs)
  if (!s.ok) {
    if (run) {
      run.turnsLeft = turnsBefore
      if (run.grid) run.grid.activated = run.grid.activated.filter((k) => k !== effect.key)
    }
    return {
      ok: false,
      error: `无法开战：${s.error ?? ''}`,
      errorId: 'core.wormholeBattle.013',
      errorParams: { p1: s.error ?? '' },
    }
  }
  return { ok: true, spent: r.spent, effect, started: kind }
}

export function wormholeTravelTo(
  state: GameState,
  ctx: SimContext,
  target: { q: number; r: number },
  opts?: { confirmUnknown?: boolean; confirmIntercept?: boolean; deferAmbush?: boolean; confirmLeaveCargo?: boolean },
  atGameMs?: number,
): ReturnType<typeof wormholeTravelToMutable> {
  return withBattleRangeCheck(state, { kind: 'wormhole-travel', target, options: opts, atGameMs }, original => {
    if (original.wormhole.run?.expeditionRules !== 2) return wormholeTravelToMutable(original, ctx, target, opts, atGameMs)
    const staged = structuredClone(original)
    const result = wormholeTravelToMutable(staged, ctx, target, opts, atGameMs)
    if (result.ok) Object.assign(original, staged)
    return result
  })
}

export function wormholeTravelToMutable(
  state: GameState,
  ctx: SimContext,
  target: { q: number; r: number },
  opts?: { confirmUnknown?: boolean; confirmIntercept?: boolean; deferAmbush?: boolean; confirmLeaveCargo?: boolean },
  atGameMs?: number,
): {
  ok: boolean
  error?: string
  errorId?: string
  errorParams?: Readonly<Record<string, string | number>>
  code?: 'unknown-target' | 'path-blocked' | 'cargo-pending' | 'unsupported-rules'
  spent?: number
  autoBattle?: boolean
  beacon?: boolean
  intercepted?: { target: string; known: boolean }
  ambush?: boolean
  pendingBattle?: 'node' | 'ruins'
} {
  const run = state.wormhole.run
  const overloaded = wormholeActionBlockReason(state, ctx)
  if (overloaded && run?.supplyVersion !== 1) return { ok: false, error: overloaded }
  const g = run?.grid
  const snap =
    run && g
      ? {
          turnsLeft: run.turnsLeft,
          pos: { ...g.pos },
          visited: [...g.visited],
          scanned: [...g.scanned],
          activated: [...g.activated],
          exitKnown: g.exitKnown === true,
        }
      : null
  const r = wormholeGridTravel(state, target, opts)
  if (!r.ok) return { ok: false, error: r.error, ...(r.code ? { code: r.code } : {}) }
  wormholeEnsureArrivalPiles(state, ctx)
  const arrived = r.arrived
  const intercepted = arrived?.intercepted
  if (!arrived?.autoBattle) {
    return {
      ok: true,
      spent: r.spent,
      ...(arrived?.beacon ? { beacon: true } : {}),
      ...(intercepted ? { intercepted } : {}),
    }
  }
  if (arrived.ambush === true && opts?.deferAmbush === true) {
    if (run) run.pendingNodeBattle = true
    return { ok: true, spent: r.spent, autoBattle: true, ambush: true, pendingBattle: 'node' }
  }
  const s = wormholeStartBattle(state, ctx, 'node', atGameMs)
  if (!s.ok) {
    if (run && g && snap) {
      run.turnsLeft = snap.turnsLeft
      g.pos = snap.pos
      g.visited = snap.visited
      g.scanned = snap.scanned
      g.activated = snap.activated
      g.exitKnown = snap.exitKnown
    }
    return {
      ok: false,
      error: `无法开战：${s.error ?? ''}`,
      errorId: 'core.wormholeBattle.013',
      errorParams: { p1: s.error ?? '' },
    }
  }
  return {
    ok: true,
    spent: r.spent,
    autoBattle: true,
    ...(arrived.ambush === true ? { ambush: true } : {}),
    ...(intercepted ? { intercepted } : {}),
  }
}
