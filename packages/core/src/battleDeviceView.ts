import type { UnitSpec } from './combat'
import type { BattleState, GameState } from './state'
import type { SimContext } from './types'
import { isAlive } from './combatMath'
import {
  repairKitAvailableOf, repairLedgersOf, repairStatsFor, shieldChargeLedgersOf,
  shieldChargeStreamsOf, shieldFieldStreamsOf, REPAIR_PULSE_MS, SHIELD_FIELD_COST_PCT,
} from './combatRepair'
import { droneReviveCyclesOf, droneReviveStockSnapshotOf } from './droneRevive'
import { equipmentCycleMsOf } from './equipment'
import { allFittedModules } from './fitted'
import { fleetDefOf } from './instances'
import { cargoOfShip, countWare } from './inventory'
import { moduleAllowedOnShip } from './shipFitting'

export interface BattleDeviceCycleView {
  id: string
  ownerTag: string
  shipId: string
  ownerName: string
  label: string
  kind: 'thruster' | 'repair' | 'shield-charge' | 'shield-field' | 'web' | 'drone-deck' | 'blink' | 'stealth' | 'damage-control'
  count: number
  cycleMs: number
  remainingMs: number
  percent: number
  state: 'ready' | 'active' | 'cooldown' | 'waiting' | 'no-stock' | 'stopped' | 'down' | 'used'
  targetTag?: string
  targetName?: string
  effectPct?: number
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function positive(value: unknown): number {
  return finite(value) ? Math.max(0, value) : 0
}

function percent(value: number): number {
  return Math.max(0, Math.min(100, value))
}

/** 窗口和周期的到点时刻只读账本；缺失时不排首跳，也不补迁移字段。 */
export function battleDeviceCyclesOf(
  state: GameState,
  ctx: SimContext,
  battle: BattleState,
  units: ReadonlyArray<{ spec: UnitSpec; shipId: string; name: string }>,
  phaseOf: (spec: UnitSpec) => { boosting: boolean; remainMs: number; cycleMs: number; posMs: number },
): BattleDeviceCycleView[] {
  const out: BattleDeviceCycleView[] = []
  const now = finite(battle.lastTickGameMs) ? battle.lastTickGameMs : 0
  const repairs = new Map(repairLedgersOf(battle).map(({ tag, ledger }) => [tag, ledger]))
  const charges = new Map(shieldChargeLedgersOf(battle).map(({ tag, ledger }) => [tag, ledger]))
  const stock = droneReviveStockSnapshotOf(battle)

  for (const { spec, shipId, name } of units) {
    const fitted = state.fleet[shipId]?.fitted
    const validFitted = fitted && Array.isArray(fitted.high) && Array.isArray(fitted.mid) && Array.isArray(fitted.low)
    const hull = fleetDefOf(state, ctx, shipId)
    // 坏旧档的缺槽按空槽读取，不往原装配上填数组。
    const defs = fitted ? allFittedModules({
      high: Array.isArray(fitted.high) ? fitted.high : [],
      mid: Array.isArray(fitted.mid) ? fitted.mid : [],
      low: Array.isArray(fitted.low) ? fitted.low : [],
    }, ctx).filter(d => moduleAllowedOnShip(hull, d)) : []
    const rt = battle.units[spec.tag]
    const down = !rt?.hp || !isAlive(battle, spec.tag)
    const ended = battle.ended != null

    function add(
      kind: BattleDeviceCycleView['kind'], key: string, modelId: string | undefined, count: number,
      cycle: number, at: number | undefined, status: BattleDeviceCycleView['state'],
      extra: Partial<Pick<BattleDeviceCycleView, 'targetTag' | 'targetName' | 'effectPct' | 'percent'>> = {},
    ): void {
      const cycleMs = positive(cycle)
      const remainingMs = finite(at) ? Math.max(0, at - now) : 0
      const viewState = down ? 'down' : ended ? 'stopped' : status
      const progress = viewState === 'ready' ? 100
        : (viewState === 'active' || viewState === 'cooldown') && cycleMs > 0
          ? percent((1 - remainingMs / cycleMs) * 100) : 0
      out.push({
        id: `${spec.tag}:${kind}:${key}`, ownerTag: spec.tag, shipId, ownerName: name,
        label: (modelId ? ctx.modules.get(modelId)?.name ?? modelId : undefined) ?? kind,
        kind, count: Math.max(1, Math.floor(positive(count))), cycleMs, remainingMs,
        ...extra, percent: down || ended ? 0 : extra.percent ?? progress, state: viewState,
      })
    }

    function pulseState(at: number | undefined, cycle: number): BattleDeviceCycleView['state'] {
      return !finite(at) || positive(cycle) === 0 ? 'stopped' : at > now ? 'cooldown' : 'ready'
    }

    function kitAvailable(id: string, damageControl = false): number {
      const run = state.wormhole?.run
      // 不能调用会给缺物资账旧档补字段的 wormholeSupplyForBattle。
      if (battle.wormhole && run && (run.supplyVersion === 1 || run.expeditionRules !== undefined)) {
        return positive(run.supplies?.items?.[id])
      }
      return positive(damageControl
        ? state.resupplyFromWarehouse !== false ? countWare(state, id) : cargoOfShip(state, shipId)[id]
        : repairKitAvailableOf(state, shipId, id))
    }

    const propulsion = defs.filter(d => d.slot === 'propulsion')
    if (propulsion.length > 0) {
      const phase = phaseOf(spec)
      const cycle = positive(phase.cycleMs)
      const picked = [...propulsion].sort((a, b) =>
        (a.thrusterBoostMs ?? ctx.balance.battle.thrusterBoostMs) - (b.thrusterBoostMs ?? ctx.balance.battle.thrusterBoostMs)
        || (a.thrusterCooldownMs ?? ctx.balance.battle.thrusterCooldownMs) - (b.thrusterCooldownMs ?? ctx.balance.battle.thrusterCooldownMs),
      )[0]
      const stopped = cycle === 0 || !finite(phase.remainMs) || !finite(phase.posMs)
        || positive(spec.thrusterBoost) === 0 || battle.meWebDebuffs?.[spec.tag]?.noThruster === true
      add('thruster', '0', picked?.id, propulsion.length, cycle, now + positive(phase.remainMs),
        stopped ? 'stopped' : phase.boosting ? 'active' : 'cooldown',
        { percent: stopped ? 0 : percent(positive(phase.posMs) / cycle * 100) })
    }

    const repair = repairs.get(spec.tag)
    const stats = validFitted ? repairStatsFor(state, ctx, shipId) : null
    const repairUnits = Array.isArray(repair?.units) ? repair.units : []
    const repairCycle = positive(stats?.intervalMs)
    const hasPerUnit = repairUnits.some(u => u && u.nextPulseAtMs !== undefined)
    const legacyKits = repair?.kits && Object.keys(repair.kits).length > 0
    repairUnits.forEach((unit, index) => {
      if (!unit) return
      const at = unit.nextPulseAtMs ?? (!hasPerUnit ? repair?.nextPulseAtMs : undefined)
      const available = unit.free ? 1 : legacyKits ? positive(repair?.kits?.[unit.kitId]) : kitAvailable(unit.kitId)
      const cycle = repairCycle || (validFitted ? equipmentCycleMsOf(state, ctx, shipId, REPAIR_PULSE_MS) : 0)
      add('repair', String(index), unit.moduleId, 1, cycle, at,
        unit.stopped ? 'stopped' : available < 1 ? 'no-stock' : pulseState(at, cycle))
    })
    if (repairUnits.length === 0) {
      stats?.units.forEach((unit, index) => add('repair', String(index), unit.moduleId, 1, repairCycle, undefined, 'stopped'))
    }

    for (const kind of ['shield-charge', 'shield-field'] as const) {
      const current = validFitted ? (kind === 'shield-charge' ? shieldChargeStreamsOf : shieldFieldStreamsOf)(state, ctx, shipId) : []
      const ledger = kind === 'shield-charge' ? charges.get(spec.tag) : battle.shieldFieldBy?.[spec.tag]
      const streams = Array.isArray(ledger?.streams) ? ledger.streams : []
      const models = defs.filter(d => positive(kind === 'shield-charge' ? d.shieldPulsePct : d.shieldFieldPct) > 0)
      const rows = streams.length > 0 ? streams : current
      rows.forEach((stream, index) => {
        if (!stream) return
        const modelId = stream.modelId || models[0]?.id
        const count = stream.modelId ? models.filter(d => d.id === stream.modelId).length : models.length
        const live = current.find(s => s.modelId === stream.modelId)
        // 旧档合并流的空型号与引擎同口径：用现行最短间隔，但不拆它的单路计时。
        const cycle = positive(live?.ms ?? (stream.modelId === '' && current.length > 0
          ? Math.min(...current.map(s => s.ms)) : stream.ms))
        const at = 'nextPulseAtMs' in stream && finite(stream.nextPulseAtMs) ? stream.nextPulseAtMs : undefined
        let status = pulseState(at, cycle)
        if (kind === 'shield-field' && status === 'ready') {
          const cap = positive(rt?.hpMax?.s ?? spec.hp.s)
          const target = units.some(u => u.spec.tag !== spec.tag && battle.units[u.spec.tag]?.hp
            && isAlive(battle, u.spec.tag)
            && battle.units[u.spec.tag]!.hp.s < positive(battle.units[u.spec.tag]!.hpMax?.s ?? u.spec.hp.s))
          if (cap === 0 || !target || positive(rt?.hp.s) < cap * SHIELD_FIELD_COST_PCT) status = 'waiting'
        }
        add(kind, `${stream.modelId || 'legacy'}:${index}`, modelId, count, cycle, at, status,
          { effectPct: positive(stream.pct) * 100 })
      })
    }

    const webs = defs.filter(d => d.captureWebCycleMs !== undefined)
    if (webs.length > 0 || spec.myCaptureWeb) {
      const picked = [...webs].sort((a, b) => positive(a.captureWebCycleMs) - positive(b.captureWebCycleMs))[0]
      const web = spec.myCaptureWeb
      const book = battle.myWebs?.[spec.tag]
      const targetTag = book?.targetTag
      const active = !!web && !!targetTag && !!battle.units[targetTag]?.hp && isAlive(battle, targetTag)
        && battle.distanceM <= web.breakM
      const debuff = targetTag ? battle.foeWebDebuffs?.[targetTag] : undefined
      const slow = debuff?.byTag === spec.tag ? debuff.slowMul : web?.slowMul
      const cooldown = finite(book?.cooldownUntilMs) && book.cooldownUntilMs > now
      add('web', '0', picked?.id, webs.length, positive(web?.cycleMs), active ? undefined : book?.cooldownUntilMs,
        !web || positive(web.cycleMs) === 0 ? 'stopped' : active ? 'active' : cooldown ? 'cooldown' : 'waiting', {
          ...(active ? { targetTag, targetName: battle.units[targetTag!]!.name ?? targetTag } : {}),
          ...(finite(slow) ? { effectPct: (1 - slow) * 100 } : {}),
          // 捕获期间没有到期时刻，不把它绘成循环装填。
          ...(active ? { percent: 0 } : {}),
        })
    }

    const decks = (Array.isArray(fitted?.high) ? fitted.high : []).flatMap(id => {
      const def = id ? ctx.modules.get(id) : undefined
      return def && moduleAllowedOnShip(hull, def) && positive(def.droneReviveCycleMs) > 0 ? [def] : []
    })
      .sort((a, b) => positive(a.droneReviveCycleMs) - positive(b.droneReviveCycleMs))
    const revive = battle.droneRevive?.[spec.tag]
    if (decks.length > 0 || revive) {
      const cycles = validFitted ? droneReviveCyclesOf(state, ctx, shipId) : []
      const queue = Array.isArray(revive?.q) ? revive.q : []
      const times = Array.isArray(revive?.t) ? revive.t : []
      const bookCycles = Array.isArray(revive?.c) ? revive.c : []
      const ownPools = Object.entries(battle.dronePools ?? {}).filter(([key]) => key.startsWith(`${spec.tag}:`))
      const candidates = queue.length > 0 ? queue.map(key => battle.dronePools?.[key]) : ownPools.map(([, pool]) => pool)
      const hasStock = candidates.some(pool => pool?.artId && positive(stock[pool.artId]) >= 1)
      const queuedStock = queue.some(key => {
        const pool = battle.dronePools?.[key]
        return pool?.artId && positive(stock[pool.artId]) >= 1
      })
      for (let index = 0; index < Math.max(decks.length, times.length, bookCycles.length); index++) {
        const cycle = positive(bookCycles[index] ?? cycles[index])
        const at = times[index]
        const status = !revive || cycle === 0 ? 'stopped' : !hasStock ? 'no-stock'
          : finite(at) && queuedStock ? (at > now ? 'active' : 'ready') : 'waiting'
        add('drone-deck', String(index), decks[index]?.id, 1, cycle, at, status)
      }
    }

    const blinks = defs.filter(d => d.blink !== undefined)
    if (blinks.length > 0 || spec.meBlink) {
      const picked = [...blinks].sort((a, b) => positive(b.blink?.distanceM) - positive(a.blink?.distanceM)
        || positive(a.blink?.cooldownMs) - positive(b.blink?.cooldownMs))[0]
      const cycle = positive(spec.meBlink?.cooldownMs)
      const at = battle.meBlinks?.[spec.tag]
      add('blink', '0', picked?.id, blinks.length, cycle, at,
        cycle === 0 || at !== undefined && !finite(at) ? 'stopped' : finite(at) && at > now ? 'cooldown' : 'ready')
    }

    const stealth = defs.filter(d => positive(d.stealthMs) > 0)
    if (stealth.length > 0 || positive(spec.stealthMs) > 0) {
      const picked = [...stealth].sort((a, b) => positive(b.stealthMs) - positive(a.stealthMs))[0]
      const at = rt?.stealthUntilMs
      add('stealth', '0', picked?.id, stealth.length, 0, at,
        finite(at) && at > now ? 'active' : positive(spec.stealthMs) > 0 ? 'used' : 'stopped')
    }

    const damageControl = defs.filter(d => d.hullSaveKit !== undefined)
    if (damageControl.length > 0 || spec.hullSaveKit !== undefined) {
      const picked = damageControl.find(d => d.hullSaveKit === spec.hullSaveKit) ?? damageControl[0]
      const dc = battle.dc?.[spec.tag]
      const at = dc?.lockUntilMs
      add('damage-control', '0', picked?.id, damageControl.length, 0, at,
        finite(at) && at > now ? 'active' : dc?.used ? 'used'
          : spec.hullSaveKit === undefined ? 'stopped' : kitAvailable(spec.hullSaveKit, true) >= 1 ? 'ready' : 'no-stock')
    }
  }
  return out
}
