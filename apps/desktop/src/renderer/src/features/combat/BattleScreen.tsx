import { buildDroneDrive } from './buildDroneDrive'
import { resolveBattleHost } from './resolveBattleHost'
import { renderBattleReport } from './renderBattleReport'
import { renderBattleScene } from './renderBattleScene'
import { useVisualState } from './useVisualState'
import { useBattleLifecycle } from './useBattleLifecycle'
import { consumeBattleEvents } from './consumeBattleEvents'
import { buildProjectileLayers } from './buildProjectileLayers'
import { buildEnemyLayers } from './buildEnemyLayers'
import { useRef } from 'react'
import type { CSSProperties } from 'react'
import { BATTLE_ARRIVAL_FLY_MS, BATTLE_ARRIVAL_STAGGER_MS, battleFoeAnomaly, battleShowWindowMs, battleTacticDesire, fleetDefOf, foeChargeCount, foeMainTagOf, foeShipTierOf, foeUnitNameOf, repairKitAvailableOf, repairLedgersOf } from '@whale/core'
import type { ShipRole } from '@whale/core'

import type { GameEngine } from '../../game/engine'
import type { ToastFn } from '../../pages/common'

import { ammoKey } from './battleBlink'

import { foeFamilyOf } from '../../ui/shipArt'



import { BOLT_LOOK, DMG_COLOR, DMG_ORDER, LAY, sizeOfUnit, noseOf, foeBarGeom, FLY_MS, BOLT_LIFE, FLASH_LIFE, BOOM_LIFE, DRONE_DOWN_LIFE, POPUP_LIFE, approachOf, layout, fanPath, ringPath } from './battleViewCore'
import { visibleEnemyTags } from './battleVisibleFleet'

import { ACID_FX_LIFE_MS } from './battleAcidFx'

import { tr as normalTr, futureTr, cmdText, logText } from '../../i18n/locale'

import { DRONE_DOWN_FREEZE_MS } from './battleDrones'

import { battleFxArrivals } from './battleFxCursor'
import { useBattleSfx } from './battleSfx'

export function BattleScreen({
  engine,
  onToast,
  onClose,
  visible = true,
  onReport,
  onDone,
  rangeMode = false,
  simulationPaused = false,
}: {
  engine: Pick<GameEngine, 'state' | 'ctx' | 'wormholeSpeedActive' | 'wormholeSpeedOptions' | 'setWormholeSpeed' | 'battleSetDesireAt' | 'battleFleetRangeSave' | 'retreatNow'>
  onToast: ToastFn
  onClose: () => void
  visible?: boolean
  onReport?: () => boolean
  onDone?: () => void
  rangeMode?: boolean
  simulationPaused?: boolean
}) {
  const pausedRef = useRef(simulationPaused)
  pausedRef.current = simulationPaused || !visible
  const state = engine.state
  const tr = state.wormhole.run?.expeditionRules === 2 ? futureTr : normalTr
  const { combatView, inWormhole, arcs, battle, sceneName, speedOptions, speedActive } = resolveBattleHost({ state, engine, tr })
  const droneCountOf = new Map<string, number>()
  for (const u of arcs?.myUnits ?? [])
    for (const d of u.drones ?? []) droneCountOf.set(`${u.tag}:${d.artId}`, d.deployed ?? d.count);
  const foeDroneAliveOf = (tag: string, artId: string): number =>
    arcs?.foeDrones?.find((d) => d.tag === tag && d.artId === artId)?.alive ??
    1
  const foeDroneBuffedOf = (tag: string): boolean =>
    arcs?.foeDrones?.some((d) => d.tag === tag && d.rangeBuff === true) === true

  const {
    stage, setStage, retreatAsk, setRetreatAsk, dragV, setDragV,
    dims, setDims, smoothM, setSmoothM, moveSnapRef, dimsRef,
    thrusterBoostRef, thrusterCycleRef, measureRef, widthCheckRef, starLayerRefs, starOffRef,
    starStateRef, meSpeedRef, starField, laneRef, screenRef, stageRef,
    fitRef, meColRef, foeColRef, meFxRootRef, facingRef, fxCursorRef,
    keyRef, boltsRef, flashRef, acidFxRef, acidDeathsRef, acidFxWakeAtRef,
    refreshAcidFx, popupsRef, popupAccRef, muzzleCountRef, droneSortieRef, foeSortieRef,
    droneSlotRef, droneBoxRef, droneElsRef, droneWritesRef, droneDownRef, blinkRef,
    blinkFxRef, blinkSeenRef, dronePrevShowRef, visDistRef, droneDriveRef, deadRef,
    corpseAtRef, prevHpRef, hpInitRef, lastHitTypeRef, outroRef, reportTextRef,
    droneReportRef, battleReportRef, flushTimerRef, dragValRef, dragRafRef, dragPendingRef,
    battleRef, battleStartRef, prevBattleIdRef, mapRef,
  } = useVisualState({ arcs })

  const { finish } = useBattleLifecycle({
    onDone, onClose, battle, stage, outroRef, setStage,
    combatView, state, droneReportRef, battleReportRef, reportTextRef, tr,
    onReport, prevBattleIdRef, deadRef, corpseAtRef, acidFxRef, acidDeathsRef,
    acidFxWakeAtRef, prevHpRef, hpInitRef, engine, meSpeedRef, battleRef,
    pausedRef, battleStartRef, moveSnapRef, visDistRef, blinkSeenRef, blinkFxRef,
    widthCheckRef, foeColRef, meColRef, dimsRef, measureRef, setSmoothM,
    refreshAcidFx, stageRef, meFxRootRef, starStateRef, thrusterCycleRef, thrusterBoostRef,
    starOffRef, starLayerRefs, droneDriveRef, droneBoxRef, droneWritesRef, droneElsRef,
    laneRef, setDims, flushTimerRef, dragValRef, mapRef,
  })
  useBattleSfx({ battle, visible, enabled: !rangeMode })

  if (visible === false) return null

  if (stage === 'report') return renderBattleReport({ stage, outroRef, droneReportRef, battleReportRef, tr, reportTextRef, finish })

  if (!combatView || !battle || !arcs) return null
  const fxRead = battleFxArrivals(fxCursorRef.current, battle)
  if (fxRead.reset) {
    boltsRef.current = []
    flashRef.current = []
    popupsRef.current = []
    popupAccRef.current.clear()
    acidFxRef.current = []
    acidDeathsRef.current.clear()
    acidFxWakeAtRef.current = Number.POSITIVE_INFINITY
    droneSortieRef.current.clear()
    foeSortieRef.current.clear()
    droneSlotRef.current.clear()
    dronePrevShowRef.current.clear()
    droneWritesRef.current.clear()
    droneDownRef.current = []
    muzzleCountRef.current.clear()
    blinkRef.current.clear()
    blinkSeenRef.current.clear()
    for (const pillar of blinkFxRef.current) pillar.el?.remove()
    blinkFxRef.current = []
    deadRef.current = new Set(Object.values(battle.units)
      .filter(unit => unit.side === 'foe' && unit.hp.s + unit.hp.a + unit.hp.h <= 0).map(unit => unit.tag))
    corpseAtRef.current.clear()
    prevHpRef.current.clear()
    lastHitTypeRef.current.clear()
    hpInitRef.current = false
    moveSnapRef.current = { prev: null, cur: null }
    visDistRef.current = battle.distanceM
  }
  battleRef.current = battle
  const combat = combatView
  const farM = arcs.maxM
  const nearM = arcs.nearM

  const meShip = fleetDefOf(state, engine.ctx, battle.myFleet?.[0]?.shipId ?? state.shipId)
  const meRole: ShipRole = meShip?.role ?? 'industrial'
  const foeTags = Object.keys(combat.foeHp)
  const foeAliveTags = foeTags.filter((t) => !deadRef.current.has(t))
  const isFoeMainTag = foeMainTagOf
  const foeAnomaly = battleFoeAnomaly(state, engine.ctx)
  const meSize = sizeOfUnit(meShip?.tier, false)
  const foeSizeOf = (tag: string): number =>
    sizeOfUnit(foeAnomaly ? foeShipTierOf(foeAnomaly, tag) : null, !isFoeMainTag(tag))
  const foeSizesFor = (tags: readonly string[]): number[] =>
    tags.length ? tags.map(foeSizeOf) : [LAY.MAIN]
  const foeKey = foeFamilyOf(foeAnomaly)
  const foeNameOf = (tag: string): string =>
    foeAnomaly ? foeUnitNameOf(foeAnomaly, tag) : (combat.foeHp[tag]?.name ?? tag)
  const ended = battle.ended !== null
  const defeat = battle.ended === 'foe'

  const realDist = battle.distanceM
  const visM = !fxRead.reset && smoothM !== null ? smoothM : realDist
  const now = performance.now()
  const popupClock = battle.lastTickGameMs
  const pct = (m: number): number => approachOf(m, farM, nearM) * 100

  const WRECK_FADE_MS = 520
  const scanDroppable = (): Set<string> => {
    const drop = new Set<string>()
    let laterVisible = false
    for (let i = foeTags.length - 1; i >= 0; i--) {
      const tag = foeTags[i]!
      if (!deadRef.current.has(tag)) continue
      const ba = corpseAtRef.current.get(tag)
      if (ba === undefined) {
        drop.add(tag)
        continue
      }
      const deathLife = acidDeathsRef.current.has(tag) ? ACID_FX_LIFE_MS : BOOM_LIFE + WRECK_FADE_MS
      if (now < ba + deathLife) laterVisible = true
      else if (!laterVisible) drop.add(tag)
    }
    return drop
  }
  const dropNow = scanDroppable()
  const rowFxTags = visibleEnemyTags(battle, foeTags, deadRef.current, dropNow)
  const multiMe = arcs.myUnits.length > 1
  const mySizes = multiMe
    ? arcs.myUnits.map((u) => sizeOfUnit(fleetDefOf(state, engine.ctx, u.shipId)?.tier, false))
    : [meSize]
  const layFx = layout(dims, foeSizesFor(rowFxTags), visM, farM, nearM, meSize, multiMe ? mySizes : undefined)
  const meAnchorByTag = new Map<string, typeof layFx.me>()
  const meSizeByTag = new Map<string, number>()
  if (multiMe) {
    arcs.myUnits.forEach((u, slot) => {
      const a = layFx.my[slot]
      if (a) meAnchorByTag.set(u.tag, a)
      const sz = layFx.mySizes?.[slot] ?? mySizes[slot]
      if (sz !== undefined) meSizeByTag.set(u.tag, sz)
    })
  }
  const droneOutward = Math.max(0, Math.round(((layFx.sizes[0] ?? LAY.MAIN) - LAY.MAIN) / 2))

  const myGap = combat.myDesireM - realDist
  const foeGap = arcs.foeDesireM - realDist
  if (myGap > 2) facingRef.current.meFlip = true
  else if (myGap < -2) facingRef.current.meFlip = false
  if (foeGap > 2) facingRef.current.foeFlip = false
  else if (foeGap < -2) facingRef.current.foeFlip = true
  const { meFlip, foeFlip } = facingRef.current

  const arrivals = fxRead.events
  consumeBattleEvents({
    arrivals, meAnchorByTag, layFx, battle, lastHitTypeRef, acidDeathsRef,
    deadRef, corpseAtRef, now, acidFxRef, keyRef, foeSizeOf,
    meSizeByTag, meSize, popupAccRef, arcs, blinkRef, dims,
    foeSizesFor, rowFxTags, visDistRef, farM, nearM, foeSortieRef,
    droneDownRef, dronePrevShowRef, droneSortieRef, foeAliveTags, droneSlotRef, foeDroneAliveOf,
    droneCountOf, droneOutward, foeDroneBuffedOf, meShip, foeKey, muzzleCountRef,
    boltsRef, flashRef,
  })
  boltsRef.current = boltsRef.current.filter((b) => now - b.born < BOLT_LIFE + (b.delay ?? 0))
  flashRef.current = flashRef.current.filter((f) => now - f.at < FLASH_LIFE + (f.delay ?? 0))
  acidFxRef.current = acidFxRef.current.filter(effect => now - effect.born < ACID_FX_LIFE_MS + effect.delay).slice(-48)
  acidFxWakeAtRef.current = Math.min(...acidFxRef.current.map(effect => {
    const start = effect.born + effect.delay
    return now < start ? start : start + ACID_FX_LIFE_MS
  }))
  popupsRef.current = popupsRef.current.filter((p) => popupClock - p.born < POPUP_LIFE)
  if (popupAccRef.current.size > 0) {
    for (const [target, acc] of popupAccRef.current) {
      if (acc.amount <= 0 && !acc.miss) continue
      const occupied = new Set(popupsRef.current.filter(p => p.target === target).map(p => p.slot))
      const slot = Array.from({ length: 9 }, (_, i) => i).find(i => !occupied.has(i)) ?? 0
      popupsRef.current = popupsRef.current.filter(p => p.target !== target || p.slot !== slot)
      popupsRef.current.push({
        key: keyRef.current++,
        target,
        slot,
        x: acc.x,
        y: acc.y,
        born: popupClock,
        amount: Math.round(acc.amount),
        type: acc.type,
        miss: acc.amount <= 0,
      })
    }
    popupAccRef.current.clear()
  }
  popupsRef.current = popupsRef.current.filter((p) => popupClock - p.born < POPUP_LIFE).slice(-160)
  if (droneDownRef.current.length > 0) {
    droneDownRef.current = droneDownRef.current.filter(
      (d) => now - d.born < DRONE_DOWN_FREEZE_MS + DRONE_DOWN_LIFE,
    )
  }
  if (blinkRef.current.size > 0) {
    for (const [tag, b] of blinkRef.current) {
      if (now - b.appear >= b.segMs / 3) blinkRef.current.delete(tag)
    }
  }
  const blinkSegOfSide = (
    side: 'foe' | 'me',
  ): { vanish: number; move: number; appear: number; segMs: number } | undefined => {
    for (const s of blinkRef.current.values()) {
      if (s.side !== side) continue
      if (now >= s.vanish && now < s.appear) return s
    }
    return undefined
  }
  const meBlinkFx = (): { cls: string; style: CSSProperties } => {
    const seg = blinkSegOfSide('me')
    if (seg === undefined) return { cls: '', style: {} }
    if (now >= seg.vanish && now < seg.move) {
      return { cls: ' is-blink-out', style: { '--blink-ms': `${seg.segMs / 3}ms` } as CSSProperties }
    }
    if (now >= seg.move && now < seg.appear) return { cls: ' is-blink-hidden', style: {} }
    return { cls: '', style: {} }
  }
  const meFx = meBlinkFx()

  if (!hpInitRef.current) {
    for (const tag of foeTags) {
      const hp = combat.foeHp[tag]
      const sum = hp ? hp.s + hp.a + hp.h : 0
      prevHpRef.current.set(tag, sum)
      if (sum === 0) deadRef.current.add(tag)
    }
    hpInitRef.current = true
  } else {
    for (const tag of foeTags) {
      const hp = combat.foeHp[tag]
      const sum = hp ? hp.s + hp.a + hp.h : 0
      const known = prevHpRef.current.has(tag)
      const prev = prevHpRef.current.get(tag) ?? 0
      prevHpRef.current.set(tag, sum)
      if (sum === 0 && !deadRef.current.has(tag)) {
        deadRef.current.add(tag)
        if (known && prev > 0) {
          const killerType = lastHitTypeRef.current.get(tag)
          const killerFly = (killerType ? BOLT_LOOK[killerType]?.fly : undefined) ?? FLY_MS
          corpseAtRef.current.set(tag, now + killerFly)
        }
      }
    }
  }
  const dropFinal = scanDroppable()
  for (const tag of dropFinal) corpseAtRef.current.delete(tag)
  const foeRowTags = visibleEnemyTags(battle, foeTags, deadRef.current, dropFinal)
  const foeSizes = foeSizesFor(foeRowTags)
  const mySlots = multiMe ? arcs.myUnits.map((u, slot) => ({ u, slot })) : []
  const myDrawOrder = multiMe ? [...mySlots].sort((a, b) => Number(a.u.leader) - Number(b.u.leader)) : []
  const lay = layout(dims, foeSizes, visM, farM, nearM, meSize, mySizes)
  const ARRIVAL_FX_MS = 1300
  const ARRIVAL_FLY_MS = BATTLE_ARRIVAL_FLY_MS
  const ARRIVAL_STAGGER_MS = BATTLE_ARRIVAL_STAGGER_MS
  const ARRIVAL_EDGE_MARGIN = 40
  const arrivalSide: 'me' | 'foe' | null =
    battle.lastTickGameMs - battle.startedAtGameMs <= battleShowWindowMs(battle, ARRIVAL_FX_MS) ? (inWormhole ? 'foe' : 'me') : null
  const arrivingTagOf = (tag: string): boolean => {
    const at = battle.units[tag]?.enteredAtMs
    if (at === undefined) return false
    const since = battle.lastTickGameMs - at
    return since >= 0 && since < battleShowWindowMs(battle, ARRIVAL_FLY_MS)
  }
  const foeArriving = (tag: string): boolean => arrivingTagOf(tag) || arrivalSide === 'foe'
  const arriveDxMe = Math.round(-(lay.me.x + meSize / 2 + ARRIVAL_EDGE_MARGIN))
  const arriveDxFoe = (i: number): number => {
    const w = lay.sizes[i] ?? LAY.MAIN
    const x = lay.foe[i]?.x ?? dims.W
    return Math.round(dims.W - x + w / 2 + ARRIVAL_EDGE_MARGIN)
  }
  const foeFormation = lay.formation
  const foeBarGeoms = foeBarGeom(
    lay.foe.map((a) => a.x),
    lay.foe.map((a, i) => a.y + ((lay.sizes[i] ?? LAY.MAIN) * 0.46) / 2),
    lay.foeBottom,
  )
  const wavePending = battle.waveClearAt !== undefined && !ended
  const waveNext = wavePending && foeAnomaly?.waves && foeAnomaly.waves.length > 1 ? (battle.waveIdx ?? 0) + 2 : 0
  const NOTICE_LIFE_MS = 12_000
  const noticeItems: Array<{ key: string; text: string }> = []
  if (battle.alienCorrosion) noticeItems.push({ key: 'corrosion', text: tr('ui.alienArmor.002', { p1: Math.round(battle.alienCorrosion * 100) }) })
  if (wavePending)
    noticeItems.push({
      key: 'wave',
      text: waveNext > 0 ? tr("ui.BattleScreen.082", { waveNext: waveNext, p2: foeAnomaly?.waves?.length ?? 0 }) : tr("ui.BattleScreen.030"),
    })
  for (const [i, n] of (battle.notices ?? []).entries()) {
    if (battle.lastTickGameMs - n.atMs > battleShowWindowMs(battle, NOTICE_LIFE_MS)) continue
    noticeItems.push({ key: `notice-${i}-${n.atMs}`, text: logText(n) })
  }

  const meGunX = lay.me.x + noseOf(lay.mySizes?.[0] ?? meSize)
  const foeGunX = (lay.foe[0]?.x ?? lay.me.x) - noseOf(lay.sizes[0] ?? LAY.MAIN)
  const sPxPerM = lay.usable / Math.max(1, farM - nearM)
  const gunBasePx = Math.max(40, foeGunX - meGunX - (visM - nearM) * sPxPerM)
  const arcCap = lay.usable + gunBasePx + 80
  const arcR = (rangeM: number, minPx: number): number =>
    Math.max(minPx, Math.min(arcCap, gunBasePx + Math.max(0, rangeM - nearM) * sPxPerM))
  const mainMeArc = arcs.me.find((w) => w.isMain) ?? arcs.me[0]
  const meArcEls = arcs.me.map((w, wi) => {
    const color = w.type ? DMG_COLOR[w.type] : 'rgb(var(--wui-dim))'
    const hollow = w.kind === 'gun' && !w.type
    const inBand = realDist >= w.minM && realDist <= w.maxM
    const dim = inBand ? 0.25 : 1
    const r1 = arcR(w.maxM, 26)
    const r0 = w.minM >= nearM ? Math.min(arcR(w.minM, 12), r1 - 4) : Math.min(12, r1 - 4)
    return (
      <g key={`me${wi}`} opacity={(hollow ? 0.55 : 1) * dim}>
        {/* ⚠ fill/stroke 走 style：色值是 `var(--wui-tone-*)`，SVG 呈现属性不认 var() */}
        <path d={fanPath(r0, r1)} style={{ fill: color }} fillOpacity={hollow ? 0 : 0.12} />
        <path d={ringPath(r1)} fill="none" style={{ stroke: color }} strokeWidth={hollow ? 1.2 : 2} strokeDasharray={hollow ? '4 4' : undefined} strokeOpacity={0.85} />
        {w.minM > 0 ? <path d={ringPath(r0)} fill="none" style={{ stroke: color }} strokeWidth={1} strokeDasharray="3 5" strokeOpacity={0.5} /> : null}
      </g>
    )
  })
  const foeColor = DMG_COLOR[arcs.foe.type]
  const foeR1 = arcR(arcs.foe.maxM, 26)
  const foeR0 = arcs.foe.minM >= nearM ? Math.min(arcR(arcs.foe.minM, 12), foeR1 - 4) : Math.min(12, foeR1 - 4)
  const foeInBand = realDist >= arcs.foe.minM && realDist <= arcs.foe.maxM
  const meMainR1 = mainMeArc ? arcR(mainMeArc.maxM, 26) : 0

  const ammoChips = DMG_ORDER.filter((t) => arcs.ammo[ammoKey(t)] > 0)

  const foeCharging = battle ? foeChargeCount(battle) : 0

  const repairLedgers = repairLedgersOf(battle).map(row => ({ ...row, ledger: { ...row.ledger, units: [...row.ledger.units] } }))
  for (const unit of arcs.myUnits) {
    const drones = Object.entries(engine.state.fleet[unit.shipId]?.droneLoad ?? {}).flatMap(([id, count]) => {
      const def = engine.ctx.items.get(id)
      if (!count || !def?.repairDrone) return []
      const alive = unit.alive && Object.values(battle.dronePools ?? {}).some(pool => pool.owner === unit.tag && pool.artId === id && pool.alive)
      return [{ moduleId: id, kitId: def.repairKit ?? 'repairkit-mil', armorPerPulse: 0, hullPerPulse: 0, stopped: !alive }]
    })
    if (!drones.length) continue
    const existing = repairLedgers.find(row => row.tag === unit.tag)
    if (existing) existing.ledger.units.push(...drones)
    else repairLedgers.push({ tag: unit.tag, ledger: { units: drones, kits: {}, pulses: 0, kitsUsed: 0 } })
  }
  type KitLedger = { units: { kitId: string; free?: boolean }[] }
  const kitIdsOf = (ledger: KitLedger): string[] => [
    ...new Set(ledger.units.filter((u) => u.free !== true).map((u) => u.kitId)),
  ]
  const kitsLeftOf = (tag: string, ledger: KitLedger): number => {
    const shipId = battle.myFleet?.find((m) => m.tag === tag)?.shipId ?? engine.state.shipId
    return kitIdsOf(ledger).reduce((n, kitId) => n + repairKitAvailableOf(engine.state, shipId, kitId), 0)
  }
  const repairTotal =
    engine.state.resupplyFromWarehouse !== false
      ?
        [...new Set(repairLedgers.flatMap((e) => kitIdsOf(e.ledger)))].reduce(
          (n, kitId) => n + repairKitAvailableOf(engine.state, engine.state.shipId, kitId),
          0,
        )
      :
        repairLedgers.reduce((n, e) => n + kitsLeftOf(e.tag, e.ledger), 0)
  const repairRunning = repairLedgers.some((e) => e.ledger.units.some((u) => !u.stopped))
  const repairDetail = repairLedgers
    .map((e) => {
      const kits = kitsLeftOf(e.tag, e.ledger)
      const running = e.ledger.units.some((u) => !u.stopped)
      const who = e.tag === 'player' ? tr("ui.BattleScreen.031") : tr("ui.BattleScreen.083", { p1: e.tag.replace('ally-', '') })
      return tr("ui.BattleScreen.084", { who: who, p2: running ? tr("ui.BattleScreen.032") : tr("ui.BattleScreen.033"), p3: kits.toLocaleString('zh-CN') })
    })
    .join('\n')

  const desireM = Math.min(farM, Math.max(nearM, combat.myDesireM))
  const sliderV = dragV ?? approachOf(desireM, farM, nearM) * 1000
  const sliderToDesire = (v: number): number => Math.round(farM - (v / 1000) * (farM - nearM))
  const commitDesire = (v: number, persist = false): void => {
    const r = engine.battleSetDesireAt(Math.min(sliderToDesire(v), arcs.desireMaxM), persist)
    if (!r.ok) onToast(cmdText(r) || tr('ui.FitPage.172'), true)
  }
  const pushDragV = (v: number): void => {
    dragPendingRef.current = v
    if (dragRafRef.current !== null) return
    dragRafRef.current = window.requestAnimationFrame(() => {
      dragRafRef.current = null
      const pending = dragPendingRef.current
      if (pending !== null) setDragV(pending)
    })
  }
  const scheduleCommit = (v: number): void => {
    dragValRef.current = v
    if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current)
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null
      commitDesire(v)
    }, 160)
  }
  const flushDrag = (): void => {
    const v = dragValRef.current
    dragValRef.current = null
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
    if (v !== null) commitDesire(v, true)
    setDragV(null)
  }
  const applyTactic = (t: 'assault' | 'mid' | 'kite'): void => {
    const m = battleTacticDesire(state, engine.ctx, t)
    commitDesire(approachOf(m, farM, nearM) * 1000, true)
  }

  const meStats = battle.stats
  const secs = Math.max(1, Math.round((state.gameMs - battle.startedAtGameMs) / 1000))

  const { webEls, popupEls, boltEls, muzzleEls } = buildProjectileLayers({ rowFxTags, layFx, multiMe, meAnchorByTag, arcs, tr, popupsRef, dims, popupClock, boltsRef, flashRef })

  const { droneWings, foeWings } = buildDroneDrive({ arcs, droneSortieRef, now, dronePrevShowRef, visDistRef, visM, droneDriveRef, meAnchorByTag, foeSortieRef, foeSizes, foeTags: foeRowTags, meSize, mySizes, farM, nearM })

  const { foeRowBoxes } = buildEnemyLayers({
    arcs, foeRowTags, isFoeMainTag, battle, tr, lay,
    foeFormation, foeBarGeoms, foeAnomaly, corpseAtRef, now, acidDeathsRef,
    combat, blinkSegOfSide, WRECK_FADE_MS, foeArriving, arriveDxFoe, ARRIVAL_FLY_MS,
    arrivalSide, ARRIVAL_STAGGER_MS, foeKey, foeFlip, foeNameOf,
  })

  return renderBattleScene({
    battle, simulationPaused,
    rangeMode, screenRef, stage, onClose, tr, inWormhole,
    retreatAsk, setRetreatAsk, onToast, engine, ended, defeat,
    sceneName, secs, meStats, speedOptions, speedActive, arcs,
    foeCharging, ammoChips, repairLedgers, repairRunning, repairDetail, repairTotal,
    stageRef, fitRef, laneRef, starField, starLayerRefs, dims,
    meGunX, lay, meArcEls, foeGunX, foeInBand, foeR0,
    foeR1, foeColor, mainMeArc, meMainR1, multiMe, myDrawOrder,
    state, meFx, arrivalSide, arriveDxMe, ARRIVAL_FLY_MS, ARRIVAL_STAGGER_MS,
    meFlip, meColRef, meShip, meRole, meSize, combat,
    droneWings, foeWings, droneDownRef, droneBoxRef, droneElsRef, foeSortieRef,
    now, meFxRootRef, foeColRef, foeAnomaly, foeFormation, foeRowBoxes,
    noticeItems, webEls, muzzleEls, boltEls, acidFxRef, meAnchorByTag,
    layFx, popupEls, farM, nearM, visM, pct,
    sliderV, pushDragV, scheduleCommit, flushDrag, dragV, sliderToDesire,
    applyTactic,
  })
}
