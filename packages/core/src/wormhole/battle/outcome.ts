import { type GameState, addLog, type DroneLossReport } from '../../state'
import type { SimContext } from '../../types'
import { plugsToBlackBoxesOf } from '../../plugs'
import { uidDefId } from '../../labels'
import { PLUG_BLACKBOX_ITEM_ID } from '../../blackbox'
import { addWare } from '../../inventory'
import { type WormholeRunState, wormholeAdvanceNode } from '../../wormhole'
import { sunkShipIdsOfBattle, persistFleetHullDamage, refundBattleAmmo, refundRepairKitsAll, settleDroneLosses, captureBattleReport } from '../../combat'
import { wormholeSupplyForBattle, settleWormholeDroneRevives } from '../../wormholeSupplies'
import { wormholeMatterBuffs } from '../../wormholeMatter'
import { matterTechWhBuffs } from '../../matterTech'
import { settleWormholeBattleAmmo } from '../../combatAmmo'
import { loseShip } from '../../shipyard'
import { wormholeHoldUsage, wormholeGrantShipSpoils } from '../../wormholeSalvage'
import { wormholeBattleReport } from './report'
import { bagValueIsk, deliverExtraction } from './extraction'
import { repairCivilianFittings } from '../../equipment'
import { bumpFirst } from '../../firstTasks'
import { gridCellAt, triggerBeaconEffect } from '../../wormholeGrid'
import { wormholeRaiseAlert, wormholeCancelPatrol, wormholePatrolDefeated } from '../../wormholePatrol'


export function salvagePlugsOnSink(state: GameState, ctx: SimContext, uid: string): void {
  const plugs = state.fleet[uid]?.plugs ?? []
  const n = plugsToBlackBoxesOf(plugs)
  if (n <= 0) return
  const name = ctx.ships.get(uidDefId(uid))?.name ?? uid
  const boxName = ctx.items.get(PLUG_BLACKBOX_ITEM_ID)?.name ?? PLUG_BLACKBOX_ITEM_ID
  addWare(state, PLUG_BLACKBOX_ITEM_ID, n)
  addLog(
    state,
    'fleet',
    `${name}沉没：舰船插件折成${n}个${boxName}入库，空间内沉船不留残骸。`,
    'core.explorationStatus.007',
    { p1: name, p2: n, p3: boxName },
  )
}

export function settleWormholeBattle(state: GameState, ctx: SimContext, run: WormholeRunState): void {
  const battle = run.battle
  if (!battle) return
  const kind = battle.wormhole?.kind ?? 'node'
  const droneOwner = run.fleet[0]
  const sunk = sunkShipIdsOfBattle(battle)
  const supply = wormholeSupplyForBattle(state, battle)
  if (supply) settleWormholeDroneRevives(state, battle)
  const matterBuffs = wormholeMatterBuffs(run.hold, matterTechWhBuffs(state, ctx))
  if (supply && battle.ended === 'me') settleWormholeBattleAmmo(state, battle, matterBuffs.ammoRefundPct)
  for (const uid of sunk) {
    const name = ctx.ships.get(uidDefId(uid))?.name ?? uid
    salvagePlugsOnSink(state, ctx, uid)
    loseShip(state, uid, ctx, `${run.expeditionRules === 2 ? '虫洞' : '信号空间'}内被击沉（${name}）`, undefined, {
      cause: 'wormhole-sunk',
      wormholeDepth: run.depth,
      reasonId: 'ui.WreckLog.018',
    })
  }
  if (sunk.length > 0) {
    run.fleet = run.fleet.filter((uid) => !sunk.includes(uid))
    state.wormhole.lastFleetLost += sunk.length
    const usage = wormholeHoldUsage(state, ctx)
    if (usage.overload) {
      addLog(
        state,
        'warn',
        `🕳 沉船拖走了货舱：货仓缩到 ${usage.capacity} 格，当前装了 ${usage.used} 格（超载）——` +
          `请到货仓页手动抛弃货物；超载期间不能再拾取/打捞，撤离与深入也要先抛到容量内。`,
      )
    }
  }
  for (const uid of run.fleet) persistFleetHullDamage(state, ctx, uid, battle)
  if (!supply) {
    const n = refundBattleAmmo(state, battle, matterBuffs.ammoRefundPct)
    if (n > 0) addLog(state, 'combat', '', 'core.wormholeBattle.016', { p1: n, p2: Math.round(matterBuffs.ammoRefundPct * 100) })
    refundRepairKitsAll(state, battle)
  }
  const fleetForDrones = battle.myFleet
  const droneReports: DroneLossReport[] = []
  const collectDroneReport = (report: DroneLossReport): void => { droneReports.push(report) }
  state.droneLossReport = null
  if ((!supply || battle.ended === 'me') && fleetForDrones && fleetForDrones.length > 0) {
    for (const e of fleetForDrones) {
      settleDroneLosses(state, ctx, e.shipId, battle, matterBuffs.droneRecoveryPct, e.tag, collectDroneReport)
    }
  } else if ((!supply || battle.ended === 'me') && droneOwner) {
    settleDroneLosses(state, ctx, droneOwner, battle, matterBuffs.droneRecoveryPct, 'player', collectDroneReport)
  }
  if (droneReports.length > 0) {
    const summary: DroneLossReport = {
      battleStartedAtGameMs: battle.startedAtGameMs,
      rate: droneReports[0]!.rate,
      total: 0, recovered: 0, gone: 0, survivors: 0, revived: 0, returnedToSupply: {}, rows: [],
    }
    const rowsById = new Map<string, DroneLossReport['rows'][number]>()
    for (const report of droneReports) {
      summary.total += report.total
      summary.recovered += report.recovered
      summary.gone += report.gone
      summary.survivors! += report.survivors ?? 0
      summary.revived! += report.revived ?? 0
      for (const [id, n] of Object.entries(report.returnedToSupply ?? {})) {
        summary.returnedToSupply![id] = (summary.returnedToSupply![id] ?? 0) + n
      }
      for (const row of report.rows) {
        const existing = rowsById.get(row.id)
        if (existing) {
          existing.lost += row.lost
          existing.back += row.back
          existing.gone += row.gone
        } else rowsById.set(row.id, { ...row })
      }
    }
    summary.rows = [...rowsById.values()].sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
    state.droneLossReport = summary
  }
  if (matterBuffs.fieldRepairPct > 0) {
    const pct = matterBuffs.fieldRepairPct
    let touched = 0
    for (const uid of run.fleet) {
      const ship = state.fleet[uid]
      if (!ship) continue
      const before = (ship.armorPct ?? 1) + (ship.durability ?? 1)
      ship.armorPct = Math.min(1, (ship.armorPct ?? 1) + pct)
      ship.durability = Math.min(1, (ship.durability ?? 1) + pct)
      if ((ship.armorPct ?? 1) + (ship.durability ?? 1) > before) touched += 1
    }
    if (touched > 0) {
      addLog(
        state,
        'combat',
        `🕳 战地维修单元：编队装甲与结构各回复 ${Math.round(pct * 100)}%（不耗货仓组件）。`,
        'core.wormholeBattle.017',
        { p1: Math.round(pct * 100) },
      )
    }
  }
  const won = battle.ended === 'me'
  const report = won ? wormholeBattleReport(run, battle, kind, ctx) : null
  run.battle = null
  if (!won || run.fleet.length === 0) {
    const lost = [...sunk, ...run.fleet]
    const lostNames: string[] = []
    for (const uid of lost) {
      const name = ctx.ships.get(uidDefId(uid))?.name ?? uid
      lostNames.push(name)
      if (!sunk.includes(uid)) {
        salvagePlugsOnSink(state, ctx, uid)
        loseShip(state, uid, ctx, `${run.expeditionRules === 2 ? '虫洞' : '信号空间'}内失联（${name}）`, undefined, { reasonId: 'ui.WreckLog.019' })
      }
    }
    state.wormhole.lastFleetLost += run.fleet.length
    const lostText = `🕳 ${run.expeditionRules === 2 ? '虫洞探险' : '信号空间探索'}失败：编队失联、货仓内容全部丢失（损失 ${lost.length} 艘）。`
    const lostTextId = run.expeditionRules === 2 ? 'core.explorationStatus.009' : 'core.explorationStatus.008'
    const lostParams = { p1: lost.length }
    addLog(state, 'combat', lostText, lostTextId, lostParams)
    captureBattleReport(state, battle, { source: 'wormhole', outcome: 'lose', summary: lostText, summaryId: lostTextId, summaryParams: lostParams, shipsLost: lostNames })
    state.wormhole.lastSettle = {
      kind: 'lost',
      ...(run.expeditionRules === 2 ? { expeditionGoal: run.expeditionGoal, expeditionProgress: run.expeditionProgress } : {}),
      depth: run.depth,
      oreUnits: 0,
      oreIsk: 0,
      wreckIsk: 0,
      boxes: [],
      relics: [],
      shipsLost: lostNames,
      lostIsk: bagValueIsk(ctx, run),
    }
    state.wormhole.run = null
    repairCivilianFittings(state, ctx)
    return
  }
  if (report) {
    addLog(state, 'combat', report.text, report.textId, report.textParams)
    captureBattleReport(state, battle, {
      source: 'wormhole',
      outcome: 'win',
      summary: report.text,
      summaryId: report.textId,
      summaryParams: report.textParams,
      shipsLost: sunk.map((uid) => ctx.ships.get(uidDefId(uid))?.name ?? uid),
    })
  }
  if (kind === 'extract') {
    deliverExtraction(state, ctx, run)
    state.wormhole.run = null
    repairCivilianFittings(state, ctx)
    return
  }
  if (kind === 'boss') {
    run.bossCleared = run.depth
    if (run.expeditionProgress) run.expeditionProgress.guards += 1
    bumpFirst(state, 'whBossClears')
    addLog(
      state,
      'combat',
      `🕳 第 ${run.depth} 层守卫已清：可以「继续深入」或「撤离」。`,
      'core.wormholeBattle.018',
      { p1: run.depth },
    )
    if (run.grid) wormholeGrantShipSpoils(state, ctx, 'boss')
    return
  }
  if (run.grid) {
    const here = gridCellAt(run.grid, run.grid.pos)
    if (battle.wormhole?.expeditionRole === 'event' && here?.event?.battle === 'pending') {
      here.event.battle = 'won'
      here.eventResolved = true
      if (run.expeditionProgress) run.expeditionProgress.events += 1
      if (here.eventKey === 'relay') {
        const cancelled = run.patrols?.filter(p => p.status === 'cancelled').length ?? 0
        wormholeRaiseAlert(state, -2)
        if ((run.patrols?.filter(p => p.status === 'cancelled').length ?? 0) === cancelled) wormholeCancelPatrol(run)
        run.guardSupportDisabled = true
      } else if (here.eventKey === 'controller') {
        const ruins = run.grid.cells.find(c => c.key === here.event?.ruinsKey && c.place === 'ruins')
        if (ruins) ruins.alarmDisabled = true
        run.guardSupportDisabled = true
      }
      return
    }
    if (kind === 'node') {
      if (run.expeditionRules === 2 && here) {
        here.combatCleared = true
        if (!run.grid.activated.includes(here.key)) run.grid.activated.push(here.key)
      }
      if (battle.wormhole?.expeditionRole === 'elite') {
        if (run.expeditionProgress) run.expeditionProgress.elites += 1
        wormholeGrantShipSpoils(state, ctx, 'elite')
      } else wormholeGrantShipSpoils(state, ctx, 'node')
    }
    else if (kind === 'ruins') wormholeGrantShipSpoils(state, ctx, 'ruins')
    else if (kind === 'spawn') {
      const cell = gridCellAt(run.grid, run.grid.pos)
      if (cell?.foe) cell.foe = { ...cell.foe, cleared: true }
      if (cell?.foe?.patrolId !== undefined) wormholePatrolDefeated(run, cell.foe.patrolId)
      if (cell?.place === 'beacon') triggerBeaconEffect(run.grid, cell)
      wormholeGrantShipSpoils(state, ctx, 'spawn')
    }
    if (run.turnsLeft <= 0) addLog(state, 'combat', `🕳 回合已耗尽：只能撤离。`, 'core.wormholeBattle.019')
    return
  }
  const r = wormholeAdvanceNode(ctx, run, state.rng.seed)
  if (!r.ok) {
    run.phase = 'extracting'
    addLog(
      state,
      'combat',
      `🕳 回合不足以继续推进：只能撤离（${r.error ?? ''}）。`,
      'core.wormholeBattle.020',
      { p1: r.error ?? '' },
    )
    return
  }
  if (r.mustExtract) {
    addLog(state, 'combat', `🕳 回合已耗尽：只能撤离。`, 'core.wormholeBattle.019')
  }
}
