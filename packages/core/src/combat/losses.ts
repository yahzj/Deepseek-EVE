import { type GameState, addLog } from '../state'
import type { SimContext } from '../types'
import { createPlayerSpec } from './player/create'
import { DRONE_SKILL, droneSkillLv } from './player/factors'
import { plugModulesOf } from '../plugs'
import { wormholeSupplyForBattle, settleWormholeDroneRevives, returnWormholeDroneSupply, deployWormholeSupply } from '../wormholeSupplies'
import { droneRevivedOf, droneRevivedCount } from '../droneRevive'
import { ceilFinalQuantity } from '../quantity'
import { refillDroneLoadTo, takeDroneUnit } from '../equipment'
import { shipDisplayName } from '../instances'

export function persistFleetHullDamage(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  battle: import('../state').BattleState | null,
): void {
  const fleetShip = state.fleet[shipId]
  if (!fleetShip) return
  const tag = battle?.myFleet?.find((e) => e.shipId === shipId)?.tag ?? 'player'
  const unit = battle?.units[tag]
  if (!unit) return
  const cap = createPlayerSpec(state, ctx, shipId)
  if (!cap) return
  const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
  const armorMax = unit.hp.coating?.maxArmor ?? (cap.shieldArmorHp !== undefined ? unit.hpMax?.a ?? cap.hp.a : cap.hp.a)
  const remainingArmor = unit.hp.coating?.armor ?? unit.hp.a
  fleetShip.armorPct = armorMax > 0 ? clamp01(remainingArmor / armorMax) : 1
  fleetShip.durability = cap.hp.h > 0 ? clamp01(unit.hp.h / cap.hp.h) : 0
}

export function settleDroneLosses(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  battle: import('../state').BattleState | null,
  recoveryBonus = 0,
  ownerTag = 'player',
  onReport?: (report: import('../state').DroneLossReport) => void,
  reviveDebitDone = false,
): string | null {
  const byOwner = battle?.droneLostBy
  const lost = byOwner ? byOwner[ownerTag] : ownerTag === 'player' ? battle?.droneLost : undefined
  if (!lost) return null
  const fleetShip = state.fleet[shipId]
  if (!fleetShip) return null
  const printing = plugModulesOf(state, ctx, shipId).some(p => p.dronePrinting)
  const unit = battle?.units?.[ownerTag]
  if (printing && unit && unit.hp.h > 0) {
    const start = battle?.droneLoadAtStartBy?.[ownerTag] ?? (ownerTag === 'player' ? battle?.droneLoadAtStart : undefined)
    if (start) fleetShip.droneLoad = { ...start }
    if (battle!.droneLostBy) delete battle!.droneLostBy[ownerTag]
    battle!.droneLost = battle!.droneLostBy
      ? Object.values(battle!.droneLostBy).reduce<Record<string, number>>((all, rows) => {
          for (const [id, n] of Object.entries(rows)) all[id] = (all[id] ?? 0) + n
          return all
        }, {}) : undefined
    const total = Object.values(fleetShip.droneLoad ?? {}).reduce((n, v) => n + v, 0)
    const report = { battleStartedAtGameMs: battle!.startedAtGameMs, rate: 1, total: 0, recovered: 0, gone: 0, survivors: total, rows: [] }
    if (ownerTag === 'player') state.droneLossReport = report
    onReport?.(report)
    return null
  }
  const rate = droneRecoveryRateWithBonus(state, recoveryBonus)
  const load: Record<string, number> = { ...(fleetShip.droneLoad ?? {}) }
  const supply = wormholeSupplyForBattle(state, battle)
  const startLoad = battle?.droneLoadAtStartBy?.[ownerTag] ??
    (ownerTag === 'player' ? battle?.droneLoadAtStart : undefined) ?? load
  const revivedMap = droneRevivedOf(battle, ownerTag)
  const revivedTotal = droneRevivedCount(battle, ownerTag)

  type Row = { id: string; name: string; value: number; lost: number; back: number }
  const rows: Row[] = []
  let total = 0
  for (const [id, n] of Object.entries(lost)) {
    if (!n || n <= 0) continue
    const def = ctx.items.get(id)
    const cut = supply
      ? Math.min((startLoad[id] ?? 0) + (revivedMap[id] ?? 0), Math.max(0, Math.floor(n)))
      : Math.min(load[id] ?? 0, n)
    if (cut <= 0) continue
    rows.push({
      id,
      name: def?.name ?? id,
      value: def?.baseSellPriceIsk ?? 0,
      lost: cut,
      back: Math.floor(cut * rate),
    })
    total += cut
  }
  if (total <= 0) return null

  let rest = Math.max(0, ceilFinalQuantity(total * rate) - rows.reduce((s, r) => s + r.back, 0))
  const byValue = [...rows].sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
  for (const r of byValue) {
    if (rest <= 0) break
    const room = r.lost - r.back
    if (room <= 0) continue
    const add = Math.min(room, rest)
    r.back += add
    rest -= add
  }

  if (supply) {
    settleWormholeDroneRevives(state, battle!)
    const alive: Record<string, number> = {}
    const recovered: Record<string, number> = {}
    for (const [id, n] of Object.entries(startLoad)) {
      const row = rows.find((r) => r.id === id)
      const left = Math.max(0, n + (revivedMap[id] ?? 0) - (row?.lost ?? 0))
      if (left > 0) alive[id] = left
      if ((row?.back ?? 0) > 0) recovered[id] = row!.back
    }
    const takeFrom = (stock: Record<string, number>) => (id: string): 'hold' | null => {
      if ((stock[id] ?? 0) <= 0) return null
      stock[id] = stock[id]! - 1
      return 'hold'
    }
    fleetShip.droneLoad = undefined
    refillDroneLoadTo(state, ctx, shipId, { ...alive }, takeFrom(alive))
    refillDroneLoadTo(state, ctx, shipId, startLoad, takeFrom(recovered))
    const settledLoad: Record<string, number> = { ...(state.fleet[shipId]?.droneLoad ?? {}) }
    const survivors = Object.values(settledLoad).reduce((n, v) => n + v, 0)
    const returnedToSupply: Record<string, number> = {}
    for (const id of new Set([...Object.keys(alive), ...Object.keys(recovered)])) {
      const n = (alive[id] ?? 0) + (recovered[id] ?? 0)
      if (n <= 0) continue
      returnWormholeDroneSupply(supply, id, n)
      returnedToSupply[id] = n
    }
    const refill = refillDroneLoadTo(state, ctx, shipId, startLoad, (id) => deployWormholeSupply(supply, id, 1) === 1 ? 'hold' : null)
    battle!.droneLost = undefined
    if (battle!.droneLostBy) delete battle!.droneLostBy[ownerTag]
    if (ownerTag === 'player' || onReport) {
      const back = rows.reduce((n, r) => n + r.back, 0)
      const report: import('../state').DroneLossReport = {
        battleStartedAtGameMs: battle!.startedAtGameMs,
        rate, total, recovered: back, gone: total - back, survivors, revived: revivedTotal, returnedToSupply,
        rows: byValue.map((r) => ({ id: r.id, name: r.name, value: r.value, lost: r.lost, back: r.back, gone: r.lost - r.back })),
      }
      if (ownerTag === 'player') state.droneLossReport = report
      onReport?.(report)
    }
    const back = rows.reduce((n, r) => n + r.back, 0)
    addLog(state, 'warn', '', 'core.whExpedition.001', { p1: total, p2: back, p3: total - back })
    if (revivedTotal > 0) addLog(state, 'combat', '', 'core.whExpedition.002', { p1: revivedTotal })
    const returned = Object.values(returnedToSupply).reduce((n, v) => n + v, 0)
    if (returned > 0) addLog(state, 'combat', '', 'core.whExpedition.003', { p1: returned })
    if (Object.keys(refill.short).length > 0) addLog(state, 'warn', '', 'core.whExpedition.004')
    return byValue.map((r) => `${r.name}×${r.lost}`).join('、')
  }

  const revivedShort: string[] = []
  for (const [id, n] of Object.entries(revivedMap)) {
    if (reviveDebitDone) continue
    if (battle?.droneRevive?.[ownerTag]?.printing) continue
    for (let i = 0; i < n; i++) {
      if (takeDroneUnit(state, shipId, id) === null) {
        revivedShort.push(`${ctx.items.get(id)?.name ?? id} 缺 ${n - i} 架`)
        break
      }
    }
  }
  let recovered = 0
  for (const r of rows) {
    const goneInBattle = Math.max(0, (revivedMap[r.id] ?? 0))
    const gone = Math.max(0, r.lost - r.back - goneInBattle)
    recovered += r.back
    if (gone > 0) {
      const left = (load[r.id] ?? 0) - gone
      if (left > 0) load[r.id] = left
      else delete load[r.id]
    }
  }
  fleetShip.droneLoad = Object.keys(load).length > 0 ? load : undefined
  const survivors = Object.values(load).reduce((s, n) => s + n, 0)
  battle!.droneLost = undefined
  if (battle!.droneLostBy) {
    const rest = { ...battle!.droneLostBy }
    delete rest[ownerTag]
    battle!.droneLostBy = rest
  }
  const legacyStartLoad = battle?.droneLoadAtStartBy?.[ownerTag] ??
    (ownerTag === 'player' ? battle?.droneLoadAtStart : undefined) ?? {}
  const refill = refillDroneLoadTo(state, ctx, shipId, legacyStartLoad,
    unit && unit.hp.s + unit.hp.a + unit.hp.h <= 0 ? () => null : undefined)
  const refillRows = Object.entries(refill.added)
  const refillTxt = refillRows
    .map(([id, n]) => {
      const nm = ctx.items.get(id)?.name ?? id
      const h = refill.fromHold[id] ?? 0
      const w = refill.fromWare[id] ?? 0
      const src = h > 0 && w > 0 ? `货仓 ${h} · 仓库 ${w}` : h > 0 ? `货仓 ${h}` : `仓库 ${w}`
      return `${nm}×${n}（${src}）`
    })
    .join('、')
  const shortTxt = Object.entries(refill.short)
    .map(([id, n]) => `${ctx.items.get(id)?.name ?? id} 缺 ${n} 架`)
    .join('、')

  const lostParts = byValue.map((r) => `${r.name}×${r.lost}`)
  const backParts = byValue.filter((r) => r.back > 0).map((r) => `${r.name}×${r.back}`)
  const ratePct = Math.round(rate * 100)
  const text = lostParts.join('、')
  const backTxt =
    backParts.length > 0 ? `，其中 ${backParts.join("、")} 已回收修复归队` : ''
  const who =
    ownerTag === 'player' ? '' : `${state.fleet[shipId] ? shipDisplayName(state, ctx, shipId) : ownerTag}：`
  const revivedTxt = revivedTotal > 0 ? `，战中复活 ${revivedTotal} 架（由无人机储备甲板补回）` : ''
  addLog(
    state,
    'warn',
    `⚠ 机群战损${who ? `（${who.replace(/：$/, '')}）` : ''}：损坏 ${text}（合计 ${total} 架）${backTxt}（回收率 ${ratePct}%，优先回收高价值，净损失 ${Math.max(0, total - recovered - revivedTotal)} 架${revivedTxt}）——净损失已从无人机舱清单扣除。`,
  )
  if (refillRows.length > 0) {
    addLog(state, 'combat', `机群补充${who ? `（${who.replace(/：$/, '')}）` : ''}：${refillTxt}——本场出发时的编制已复位。`)
  }
  if (shortTxt.length > 0) {
    addLog(
      state,
      'warn',
      `⚠ 机群未能补满${who ? `（${who.replace(/：$/, '')}）` : ''}：${shortTxt}——货仓与物品仓库都没有存货了，购买或制造后再到装配页装入。`,
    )
  }
  if (revivedShort.length > 0) {
    addLog(
      state,
      'warn',
      `⚠ 无人机储备甲板的补货未能扣满${who ? `（${who.replace(/：$/, '')}）` : ''}：${revivedShort.join('、')}——` +
        `开战时的备用库存已被同队其它舰的先期结算用掉，超出的那几架按白补处理。`,
    )
  }
  state.droneLossNotice =
    recovered > 0
      ? `机群战损：损坏 ${total} 架，回收 ${recovered} 架归队（回收率 ${ratePct}%，优先回收高价值），净损失 ${Math.max(0, total - recovered - revivedTotal)} 架${revivedTxt}。${refillRows.length > 0 ? `已自动补充 ${refillTxt}。` : ''}${shortTxt.length > 0 ? `仍有 ${shortTxt}。` : ''}`
      : `机群战损：${text} 被近防炮击落、共 ${total} 架（回收率 ${ratePct}%，优先回收高价值）${revivedTotal > 0 ? `，战中复活 ${revivedTotal} 架` : ''}——已从无人机舱清单扣除。${refillRows.length > 0 ? `已自动补充 ${refillTxt}。` : ''}${shortTxt.length > 0 ? `仍有 ${shortTxt}。` : ''}`
  if (state.shipId === shipId || onReport) {
    const report: import('../state').DroneLossReport = {
      battleStartedAtGameMs: battle?.startedAtGameMs ?? 0,
      rate,
      total,
      recovered,
      gone: Math.max(0, total - recovered - revivedTotal),
      survivors,
      rows: byValue.map((r) => ({
        id: r.id,
        name: r.name,
        value: r.value,
        lost: r.lost,
        back: r.back,
        gone: Math.max(0, r.lost - r.back - (revivedMap[r.id] ?? 0)),
      })),
    }
    if (state.shipId === shipId) state.droneLossReport = report
    onReport?.({ ...report, revived: revivedTotal })
  }
  return text
}

export function droneRecoveryRateWithBonus(state: GameState, bonus = 0): number {
  return Math.min(1, droneRecoveryRate(state) + Math.max(0, bonus))
}

export function droneRecoveryRate(state: GameState): number {
  const rate = DRONE_SKILL.recoveryBase + DRONE_SKILL.recoveryPerLevel * droneSkillLv(state, 'drone-recovery')
  return Math.min(DRONE_SKILL.recoveryMax, rate)
}
