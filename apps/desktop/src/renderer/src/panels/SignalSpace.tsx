import { PreparationFleetCards } from '../features/combat/PreparationFleetCards'
import { RangeEwFleet, SignalRangeEwPreview } from '../features/combat/RangeEwPanel'
import { commandBudgetOf } from '@whale/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { holdTone, hexRingOf, explorationNumber as n, useCountUp, grabOffsetOf, WhGlyph, WhNebulaGlyph } from './explorationShared'
import { currentSpaceBg, spaceBgUrlAt } from '../ui/spaceBg'
import { HintIcon } from '../ui/Hint'
import { pinMarked } from '../ui/marks'
import { wormholeIntelLine, wormholeIntelTip } from '../ui/wormholeIntel'
import { Glyph, itemIconOf } from '../ui/Glyphs'
import { FOE_ACCENT } from '../ui/tones'
import { placeText } from '../ui/labelsText'
import { FOE_FAMILY_LABEL } from '../ui/shipArt'
import { WORMHOLE_FAMILY_CARDS } from '@whale/core'
import {
  WORMHOLE_ADMISSION_TEXT,
  WORMHOLE_MAX_SHIPS,
  WORMHOLE_AUTO_MAX_SHIPS,
  WORMHOLE_AUTO_DURATION_MS,
  WORMHOLE_AUTO_DAMAGE_MIN,
  WORMHOLE_AUTO_DAMAGE_MAX,
  wormholeIsShapedItem,
  WORMHOLE_SLOT_M3,
  WORMHOLE_TOTAL_MASS_CAP,
  WORMHOLE_ORE_ITEM_ID,
  isExitCell,
  shipDisplayName,
  wormholeAdmission,
  findFreeSpot,
  wormholeBagSlots,
  wormholeBagUsage,
  wormholeFleetCargoM3,
  wormholeHoldCapacityOf,
  wormholeLayerThreat,
  wormholeDisplayThreat,
  WORMHOLE_HOLD_COLS,
  WORMHOLE_TEMP_CELLS,
  WORMHOLE_TEMP_COLS,
  WORMHOLE_TEMP_ROWS,
  makeHoldState,
  durabilityOf,
  holdRows,
  placementCells,
  wormholeMatterBuffs,
  wormholeMatterDeviceAt,
  wormholeMatterDeviceOf,
  wormholeMatterDiscardHint,
  wormholeMatterThreatMul,
  revealOf,
  hexLine,
  wormholePathInterceptAt,
  wormholeOutOfTurns,
  wormholeShipAllowed,
  wormholeSalvagersOf,
  wormholeMinersOf,
  wormholeSalvagersInFleet,
  wormholeMinersInFleet,
  wormholeScanBonusOf,
  WORMHOLE_SCAN_RADIUS_BASE,
  wormholeWorkEfficiencyOfFleet,
  wormholeWorkEfficiencyOf,
  matterTechWhBuffs,
  matterTechNodes,
  matterTechLevel,
  matterTechSignalAutoYield,
  wormholeAutoTechFactors,
  wormholeAutoTechIsNeutral,
  wormholeUnitsPerSlot,
} from '@whale/core'
import type { WormholeGridState, WormholeHoldPlacement, WormholeHoldState, WormholePlace, WormholeSettleRecord, WormholeSignal } from '@whale/core'
import type { GameEngine } from '../game/engine'
import { ShipSpriteShape } from '../ui/ShipSprite'
import { usePreparationSquad } from '../ui/usePreparationSquad'
import type { ToastFn } from '../pages/common'
import { SHIP_DOMAIN_SUBS, SHIP_TIER_SUBS, SUB_ALL, shipRolePasses, shipTierPasses, subText } from '../ui/itemSubs'
import { tr, cmdText } from '../i18n/locale'

import {
  WORMHOLE_MAP_CELL_PX,
  WORMHOLE_MAP_DRAG_THRESHOLD_PX,
  WORMHOLE_MAP_ZOOM_FIT,
  WORMHOLE_MAP_ZOOM_MAX,
  WORMHOLE_MAP_ZOOM_STEP,
  WORMHOLE_MAP_ZOOM_WHEEL_STEP,
  wormholeMapAnchorOf,
  wormholeMapAutoZoom,
  wormholeMapBoxOf,
  wormholeMapPanClamp,
} from './wormholeMapGeom'

type WhTab = 'prep' | 'map' | 'bag'


type BoardKind = 'hold' | 'temp'

const TAB_LABEL: Record<WhTab, string> = { get prep() { return tr("ui.Wormhole.063") }, get map() { return tr("ui.Wormhole.123") }, get bag() { return tr("ui.CargoPage.004") } }

const WORMHOLE_FX_IN_MS = 1000
const WORMHOLE_FX_OUT_MS = 600
const WORMHOLE_FX_SCAN_MS = 900
const WORMHOLE_FX_NEBULA_MS = 700
const WORMHOLE_PILE_OUT_MS = 300
const WORMHOLE_FX_JOB_MS = 380
const WORMHOLE_FOE_MARK_PX = 12
const WORMHOLE_FOE_MARK_AT = 0.44
let scanFxSeqCounter = 0
function scanFxSeq(): number {
  scanFxSeqCounter += 1
  return scanFxSeqCounter
}





export function SignalSpacePanel({
  engine,
  onToast,
  onClose,
  stockId = null,
  autoStockId = null,
}: {
  engine: GameEngine
  onToast: ToastFn
  onClose: () => void
  stockId?: string | null
  autoStockId?: string | null
}) {
  const state = engine.state
  const ctx = engine.ctx
  const auto = autoStockId !== null
  const run = auto ? undefined : state.wormhole.run
  const closingRef = useRef(false)
  const pinnedSpaceBg = useMemo(() => {
    const seed = run?.seed ?? null
    if (seed === null) return null
    const info = currentSpaceBg()
    return info ? spaceBgUrlAt(info.index) : null
  }, [run?.seed])
  const [tab, setTab] = useState<WhTab>(auto ? 'prep' : run ? 'map' : 'prep')
  const [picked, setPicked] = usePreparationSquad(engine, auto ? 'signal-auto' : 'signal-manual', () =>
    auto
      ? engine
          .wormholeAutoCandidates([])
          .filter((c) => c.picked)
          .map((c) => c.shipId)
      : state.shipId
        ? [state.shipId]
        : [],
  )
  const [mainAsk, setMainAsk] = useState(false)
  const [autoComputing, setAutoComputing] = useState(false)
  const autoRequest = useRef<AbortController | null>(null)
  useEffect(() => () => {
    autoRequest.current?.abort()
    autoRequest.current = null
  }, [])
  useEffect(() => {
    autoRequest.current?.abort()
    setAutoComputing(false)
  }, [autoStockId, picked, engine.state])
  const [pendingCell, setPendingCell] = useState<{
    q: number
    r: number
    unknown: boolean
    intercept: { q: number; r: number; known: boolean } | null
  } | null>(null)

  const techTurnBonus = matterTechWhBuffs(state, ctx).turnBonus
  const admission = wormholeAdmission(ctx, picked, techTurnBonus)
  const autoCand = auto ? engine.wormholeAutoCandidates([]) : []
  const autoBlockedOf = new Map(autoCand.map((c) => [c.shipId, c.blocked]))
  const autoMainPicked = auto && picked.includes(state.shipId)
  const autoHandover = auto
    ? engine.wormholeAutoMainHandover(autoMainPicked ? picked : [...picked, state.shipId])
    : null
  const autoMainReason =
    auto && autoHandover?.reason !== undefined
      ? { error: autoHandover.reason, errorId: autoHandover.reasonId, errorParams: autoHandover.reasonParams }
      : null
  const autoBlock =
    auto && autoStockId !== null ? engine.wormholeAutoBlockReason(autoStockId, picked, autoMainPicked) : null
  const autoGate = (autoMainPicked ? autoMainReason : null) ?? autoBlock
  const prepStock = (() => {
    const id = autoStockId ?? stockId
    if (!id) return null
    return engine.wormholeStock().find((s) => s.id === id) ?? null
  })()
  const cargoM3 = wormholeFleetCargoM3(state, ctx, picked)
  const bagSlots = wormholeBagSlots(cargoM3)
  const usage = run ? wormholeBagUsage(ctx, run.bag, wormholeHoldCapacityOf(state, ctx)) : null
  const outOfTurns = run ? wormholeOutOfTurns(run) : false
  const grid = run?.grid
  const hereKey = grid ? `${grid.pos.q},${grid.pos.r}` : ''
  const hereCell = grid ? grid.cells.find((c) => c.key === hereKey) : undefined
  const atExit = grid ? isExitCell(grid, grid.pos) : false
  const bossDone = !!run && (run.bossCleared ?? 0) >= run.depth
  const salvageCell = !!hereCell && (hereCell.place === 'graveyard' || hereCell.place === 'ruins')
  const researchCell = hereCell?.place === 'research'
  const researchUnclaimed = researchCell && !grid?.activated.includes(hereKey)
  const veinCell = hereCell?.place === 'vein'
  const salvagers = run ? wormholeSalvagersOf(state, ctx) : 0
  const miners = run ? wormholeMinersOf(state, ctx) : 0
  const pickedSalvagers = wormholeSalvagersInFleet(state, ctx, picked)
  const pickedMiners = wormholeMinersInFleet(state, ctx, picked)
  const pickedScanRadius = WORMHOLE_SCAN_RADIUS_BASE + wormholeScanBonusOf(ctx, picked) + matterTechWhBuffs(state, ctx).scanRadius
  const pickedSalvageEff = wormholeWorkEfficiencyOfFleet(state, ctx, picked, 'salvager')
  const pickedCollectEff = wormholeWorkEfficiencyOfFleet(state, ctx, picked, 'miner')
  const runSalvageEff = run ? wormholeWorkEfficiencyOf(state, ctx, 'salvager') : 0
  const runCollectEff = run ? wormholeWorkEfficiencyOf(state, ctx, 'miner') : 0
  const techInRun = matterTechNodes(ctx)
    .filter((d) => d.branch !== 'industry')
    .map((d) => ({ def: d, level: matterTechLevel(state, d.id) }))
    .filter((x) => x.level > 0)
  const techInRunLevels = techInRun.reduce((s, x) => s + x.level, 0)
  const autoTech = wormholeAutoTechFactors(state, ctx, picked)
  const autoTechNeutral = wormholeAutoTechIsNeutral(autoTech)
  const matterBuffs = wormholeMatterBuffs(run?.hold, matterTechWhBuffs(state, ctx))
  const nodeThreat = run ? Math.round(wormholeLayerThreat(run.depth) * wormholeMatterThreatMul(matterBuffs, 'node')) : 0
  const matterThreatTip =
    matterBuffs.threatNodeMul < 1 || matterBuffs.threatBossMul < 1
      ? tr("ui.Wormhole.182", { p1: matterBuffs.threatNodeMul.toFixed(2), p2: (matterBuffs.threatNodeMul * matterBuffs.threatBossMul).toFixed(2) })
      : tr("ui.Wormhole.064")
  const herePiles = hereCell?.piles ?? []
  const shapedPiles = herePiles.filter((p) => wormholeIsShapedItem(p.itemId))
  const bulkPiles = veinCell
    ? herePiles.filter(p => p.itemId === WORMHOLE_ORE_ITEM_ID).length
    : herePiles.length - shapedPiles.length
  const [leavingPiles, setLeavingPiles] = useState<Array<{ key: string; itemId: string; units: number }>>([])
  const prevPilesRef = useRef<{ hereKey: string; sigs: string[] }>({ hereKey: '', sigs: [] })
  const pileSig = herePiles.map((p) => `${p.itemId}|${p.units}`).join(';')
  useEffect(() => {
    const sigs = pileSig.length > 0 ? pileSig.split(';') : []
    const prev = prevPilesRef.current
    prevPilesRef.current = { hereKey, sigs }
    if (prev.hereKey !== hereKey) {
      setLeavingPiles((l) => (l.length > 0 ? [] : l))
      return
    }
    const pool = [...sigs]
    const gone: string[] = []
    for (const s of prev.sigs) {
      const i = pool.indexOf(s)
      if (i >= 0) pool.splice(i, 1)
      else gone.push(s)
    }
    if (gone.length === 0) return
    const stamp = Date.now()
    const add = gone.slice(0, 12).map((s, i) => {
      const bar = s.lastIndexOf('|')
      return { key: `${s}#${stamp}#${i}`, itemId: s.slice(0, bar), units: Number(s.slice(bar + 1)) }
    })
    setLeavingPiles((l) => [...l, ...add])
    const t = window.setTimeout(
      () => setLeavingPiles((l) => l.filter((x) => !add.some((a) => a.key === x.key))),
      WORMHOLE_PILE_OUT_MS,
    )
    return () => window.clearTimeout(t)
  }, [pileSig, hereKey])
  const leadShipDefId = (() => {
    const uid = run?.fleet[0]
    if (!uid) return undefined
    return ctx.ships.get(state.fleet[uid]?.defId ?? uid)?.id
  })()
  const canActivate = !!grid && !!hereCell && !grid.activated.includes(hereKey) && (atExit ? !bossDone : hereCell.place !== 'empty')
  const canSalvage = (salvageCell || (researchCell && !researchUnclaimed)) && salvagers > 0 && bulkPiles > 0 && (run?.turnsLeft ?? 0) >= 1
  const canCollect = veinCell && miners > 0 && bulkPiles > 0 && (run?.turnsLeft ?? 0) >= 1
  const workCell = salvageCell || veinCell || researchCell
  const canWork = researchUnclaimed ? salvagers > 0 && (run?.turnsLeft ?? 0) >= 1
    : salvageCell || researchCell ? canSalvage : veinCell ? canCollect : false
  const rigs = salvageCell || researchCell ? salvagers : miners
  const rigName = veinCell ? tr("ui.Wormhole.238") : tr("ui.Wormhole.001")
  const commandBudget = commandBudgetOf(state, ctx, picked, true)
  const entryGate = auto || run ? null : !commandBudget.ok ? cmdText(commandBudget) : engine.wormholeEntryGate(picked)
  const autoStopText = auto || run ? null : engine.wormholeEntryAutoStopText()
  const autoStopWarns = auto || run ? [] : engine.wormholeEntryAutoStopList().filter((a) => a.warn)
  const fleetShortWarn = !auto && !run && admission.ok && picked.length < WORMHOLE_MAX_SHIPS
  const settle = auto ? null : state.wormhole.lastSettle
  const settleAtMountRef = useRef(!auto && stockId !== null && state.wormhole.lastSettle !== undefined)
  const holdInfo = run ? engine.wormholeHoldInfo() : null
  const overloaded = holdInfo?.overload ?? false
  const actionBlocked = run ? engine.wormholeActionBlocked() : null
  const layerBlocked = run ? engine.wormholeLayerBlocked() : null
  const workBlocked = actionBlocked ?? layerBlocked
  const [fx, setFx] = useState<'idle' | 'out' | 'in'>('in')
  const fxBusy = fx !== 'idle'
  const [scanFx, setScanFx] = useState<{ keys: string[]; rings: number; nonce: number } | null>(null)
  const [dissolveFx, setDissolveFx] = useState<{ keys: string[]; nonce: number } | null>(null)
  const [extractAsk, setExtractAsk] = useState(false)
  const [enterHaulAsk, setEnterHaulAsk] = useState(false)
  const [tempAsk, setTempAsk] = useState<null | 'tab' | 'extract'>(null)
  useEffect(() => {
    if (!extractAsk) return
    const t = window.setTimeout(() => setExtractAsk(false), 5000)
    return () => window.clearTimeout(t)
  }, [extractAsk])
  const [mapZoom, setMapZoom] = useState(WORMHOLE_MAP_ZOOM_FIT)
  const [mapPan, setMapPan] = useState({ x: 0, y: 0 })
  const [mapPanning, setMapPanning] = useState(false)
  const mapDragRef = useRef<{
    id: number
    sx: number
    sy: number
    panX: number
    panY: number
    kx: number
    ky: number
    moved: boolean
  } | null>(null)
  const mapDragAteClickRef = useRef(false)
  const wheelCleanupRef = useRef<(() => void) | null>(null)
  const mapBoxRef = useCallback((el: HTMLDivElement | null) => {
    wheelCleanupRef.current?.()
    wheelCleanupRef.current = null
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (e.deltaY === 0) return
      e.preventDefault()
      const step = e.deltaY < 0 ? WORMHOLE_MAP_ZOOM_WHEEL_STEP : -WORMHOLE_MAP_ZOOM_WHEEL_STEP
      setMapZoom((z) =>
        Math.min(WORMHOLE_MAP_ZOOM_MAX, Math.max(WORMHOLE_MAP_ZOOM_FIT, +(z + step).toFixed(3))),
      )
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    wheelCleanupRef.current = () => el.removeEventListener('wheel', onWheel)
  }, [])
  useEffect(() => () => wheelCleanupRef.current?.(), [])
  const layerKeyForFx = run ? `${run.seed ?? 0}-${run.depth}` : 'none'
  useEffect(() => {
    setMapZoom(wormholeMapAutoZoom(run?.grid?.radius ?? 0))
    setMapPan({ x: 0, y: 0 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerKeyForFx])
  useEffect(() => {
    if (!run) return
    setPendingCell(null)
    setFx('in')
    const t = window.setTimeout(() => setFx('idle'), WORMHOLE_FX_IN_MS)
    return () => window.clearTimeout(t)
  }, [layerKeyForFx, !!run])
  useEffect(() => {
    if (!scanFx) return
    const t = window.setTimeout(() => setScanFx(null), WORMHOLE_FX_SCAN_MS)
    return () => window.clearTimeout(t)
  }, [scanFx])
  useEffect(() => {
    if (!dissolveFx) return
    const t = window.setTimeout(() => setDissolveFx(null), WORMHOLE_FX_NEBULA_MS)
    return () => window.clearTimeout(t)
  }, [dissolveFx])
  const [jobFx, setJobFx] = useState<{ label: string; sub: string; nonce: number } | null>(null)
  useEffect(() => {
    if (!jobFx) return
    const t = window.setTimeout(() => setJobFx(null), WORMHOLE_FX_JOB_MS)
    return () => window.clearTimeout(t)
  }, [jobFx])
  const playJob = (label: string, sub: string): void =>
    setJobFx((p) => ({ label, sub, nonce: (p?.nonce ?? 0) + 1 }))
  const incomingCells = (() => {
    const m3ById = new Map<string, number>()
    for (const p of hereCell?.piles ?? []) {
      if (wormholeIsShapedItem(p.itemId)) continue
      m3ById.set(p.itemId, (m3ById.get(p.itemId) ?? 0) + p.units * (ctx.items.get(p.itemId)?.unitM3 ?? 0))
    }
    let m3 = 0
    for (const v of m3ById.values()) m3 += v
    return m3 > 0 ? Math.ceil(m3 / WORMHOLE_SLOT_M3) : 0
  })()
  const holdFreeCells = holdInfo ? Math.max(0, holdInfo.capacity - holdInfo.used) : 0
  const holdShortBy = workCell && holdInfo ? Math.max(0, incomingCells - holdFreeCells) : 0

  const [whQ, setWhQ] = useState('')
  const [whRole, setWhRole] = useState<string>(SUB_ALL)
  const [whTier, setWhTier] = useState<string>(SUB_ALL)
  const whEntries = Object.keys(state.fleet).map((uid) => {
    const def = ctx.ships.get(state.fleet[uid]!.defId ?? uid)
    const busy = auto ? null : engine.wormholeShipEntryBusy(uid)
    const autoBlocked = auto ? (uid === state.shipId ? autoMainReason : (autoBlockedOf.get(uid) ?? null)) : null
    const ok = auto ? autoBlocked === null : def ? wormholeShipAllowed(def) : false
    return {
      uid,
      def,
      name: shipDisplayName(state, ctx, uid),
      tier: def?.tier ?? 0,
      ok,
      busy: auto ? (autoBlocked !== null ? cmdText(autoBlocked) : null) : busy === null ? null : cmdText(busy),
      on: picked.includes(uid),
      armor: state.fleet[uid]!.armorPct ?? 1,
      dur: durabilityOf(state, uid),
    }
  })
  const whFiltered = whQ.trim().length > 0 || whRole !== SUB_ALL || whTier !== SUB_ALL
  const whShown = pinMarked(
    state,
    'ships',
    whEntries.filter((e) => {
      const q = whQ.trim().toLowerCase()
      if (q.length > 0) {
        const hay = `${e.name} ${e.def?.name ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      if (!shipRolePasses(e.def, whRole)) return false
      if (!shipTierPasses(e.def ?? { tier: e.tier }, whTier)) return false
      return true
    }),
    (e) => e.uid,
  )

  const pickCap = auto ? WORMHOLE_AUTO_MAX_SHIPS : WORMHOLE_MAX_SHIPS

  function togglePick(uid: string): void {
    setPicked((prev) => {
      if (prev.includes(uid)) return prev.filter((x) => x !== uid)
      if (prev.length >= pickCap) {
        onToast(auto ? tr("ui.Wormhole.183", { pickCap: pickCap }) : tr("ui.Wormhole.124", { pickCap: pickCap }), true)
        return prev
      }
      return [...prev, uid]
    })
  }

  function handleEnter(): void {
    if (engine.state.hauling.active && !enterHaulAsk) {
      setEnterHaulAsk(true)
      onToast(tr('ui.Hauling.033'), true)
      return
    }
    setEnterHaulAsk(false)
    const r = stockId ? engine.wormholeEnterFromStock(stockId, picked) : engine.wormholeEnter(picked)
    if (!r.ok) onToast(cmdText(r) || tr('ui.Wormhole.296'), true)
    else {
      onToast(tr("ui.Wormhole.065"))
      setTab('map')
    }
  }

  async function startAuto(): Promise<void> {
    if (autoStockId === null || autoRequest.current) return
    const controller = new AbortController()
    autoRequest.current = controller
    setAutoComputing(true)
    try {
      const r = await engine.wormholeAutoStart(autoStockId, picked, controller.signal)
      if (controller.signal.aborted) return
      if (!r.ok) onToast(cmdText(r) || tr('ui.Wormhole.297'), true)
      else {
        onToast(tr("ui.Wormhole.184", { p1: Math.round(WORMHOLE_AUTO_DURATION_MS / 60_000) }))
        onClose()
      }
    } finally {
      if (autoRequest.current === controller) {
        autoRequest.current = null
        setAutoComputing(false)
      }
    }
  }

  function handleAutoStart(): void {
    if (autoMainPicked) setMainAsk(true)
    else startAuto()
  }


  function pickCell(q: number, r: number): void {
    if (!grid || !run) return
    if (mapDragAteClickRef.current) return
    if (run.battle) {
      onToast(tr("ui.Wormhole.003"), true)
      return
    }
    const cell = grid.cells.find((c) => c.key === `${q},${r}`)
    if (!cell) return
    if (cell.key === hereKey) {
      onToast(tr("ui.Wormhole.066"))
      return
    }
    const unknown = !grid.scanned.includes(cell.key) && !grid.visited.includes(cell.key)
    const hit = wormholePathInterceptAt(grid, { q, r })
    if (hit) {
      const known = grid.scanned.includes(hit.key) || grid.visited.includes(hit.key)
      setPendingCell({ q, r, unknown, intercept: { q: hit.q, r: hit.r, known } })
      return
    }
    if (unknown) {
      setPendingCell({ q, r, unknown: true, intercept: null })
      return
    }
    travelTo(q, r, false, false)
  }

  function travelTo(q: number, r: number, confirmUnknown: boolean, confirmIntercept: boolean): void {
    const res = engine.wormholeTravel(q, r, confirmUnknown, confirmIntercept)
    if (!res.ok) {
      onToast(res.error ?? tr('ui.Wormhole.298'), true)
      return
    }
    setPendingCell(null)
    if (res.beacon) onToast(tr("ui.Wormhole.125"))
  }

  function doScan(): void {
    const before = new Set(grid?.scanned ?? [])
    const res = engine.wormholeScan()
    if (!res.ok) {
      onToast(res.error ?? tr('ui.Wormhole.299'), true)
      return
    }
    const after = grid?.scanned ?? []
    const fresh = after.filter((k) => !before.has(k))
    setScanFx({ keys: fresh, rings: Math.max(1, Math.floor((grid?.scanRadius ?? 1) + matterBuffs.scanRadius)), nonce: scanFxSeq() })
    if ((res.dispersed ?? 0) > 0) {
      setDissolveFx({ keys: grid?.dispersed ?? [], nonce: scanFxSeq() })
    }
    const dispersed = res.dispersed ?? 0
    const fogged = res.newlyFogged ?? 0
    const parts: string[] = []
    if (fogged > 0 && dispersed > 0) {
      parts.push(tr("ui.Wormhole.004", { fogged: fogged, dispersed: dispersed }))
    } else if (fogged > 0) {
      parts.push(tr("ui.Wormhole.005", { fogged: fogged }))
    } else if (dispersed > 0) {
      parts.push(tr("ui.Wormhole.239", { dispersed: dispersed }))
    }
    if (res.exitScanned === true) parts.push(tr("ui.Wormhole.067"))
    onToast(parts.length > 0 ? tr("ui.Wormhole.068", { p1: parts.join(' ') }) : tr("ui.Wormhole.069"))
  }

  function doActivate(): void {
    const place = hereCell?.place
    const exitNow = atExit
    if (holdShortBy > 0) {
      onToast(tr("ui.Wormhole.006", { incomingCells: incomingCells, holdFreeCells: holdFreeCells }))
    }
    const res = engine.wormholeActivate()
    if (!res.ok) {
      onToast(res.error ?? tr('ui.Wormhole.300'), true)
      return
    }
    if (exitNow || place === 'ship') return
    if (place === 'research' && researchUnclaimed) {
      playJob(tr('ui.Wormhole.070'), tr('ui.researchLab.001'))
      onToast(tr('ui.researchLab.005'))
      return
    }
    if (place === 'graveyard' || place === 'ruins' || place === 'research') {
      playJob(tr("ui.Wormhole.070"), tr("ui.Wormhole.126", { p1: res.taken ?? 0 }))
      onToast(tr("ui.Wormhole.071", { p1: res.taken ?? 0 }))
      return
    }
    if (place === 'vein') {
      playJob(tr("ui.Wormhole.240"), tr("ui.Wormhole.126", { p1: res.taken ?? 0 }))
      onToast(tr("ui.Wormhole.241", { p1: res.taken ?? 0 }))
    } else if (place === 'matter') {
      const dev = wormholeMatterDeviceAt(run?.seed ?? 0, run?.depth ?? 1, hereKey)
      onToast(tr("ui.Wormhole.072", { p1: dev.name, p2: dev.text }))
    }
  }

  function doDescend(): void {
    if (fxBusy) return
    setFx('out')
    window.setTimeout(() => {
      const r = engine.wormholeDescend()
      if (!r.ok) {
        setFx('idle')
        onToast(cmdText(r) || tr('ui.Wormhole.301'), true)
      }
    }, WORMHOLE_FX_OUT_MS)
  }

  function doExtract(): void {
    if (engine.wormholeTempPending().count > 0) {
      setTab('bag')
      setTempAsk('extract')
      return
    }
    const r = engine.wormholeExtract()
    if (!r.ok) {
      onToast(cmdText(r) || tr('ui.Wormhole.302'), true)
      return
    }
    onToast(tr("ui.Wormhole.185"))
  }

  function leaveBagPage(intent: 'tab' | 'extract', go: () => void): void {
    if (engine.wormholeTempPending().count === 0) {
      go()
      return
    }
    setTab('bag')
    setTempAsk(intent)
  }

  function resumeAfterTemp(ask: null | 'tab' | 'extract'): void {
    if (ask === 'extract') doExtract()
    else if (ask === 'tab') setTab('map')
  }

  function tempDiscardAndContinue(): void {
    const ask = tempAsk
    const r = engine.wormholeTempDiscardAll()
    setTempAsk(null)
    if (r.moved > 0) onToast(tr("ui.Wormhole.073", { p1: r.moved }), true)
    resumeAfterTemp(ask)
  }

  function tempStowAndContinue(): void {
    const ask = tempAsk
    const r = engine.wormholeTempStowAll()
    if (r.stuck.length > 0) {
      setTempAsk(null)
      onToast(tr("ui.Wormhole.186", { p1: r.stuck.length }), true)
      return
    }
    setTempAsk(null)
    if (r.moved > 0) onToast(tr("ui.Wormhole.074", { p1: r.moved }))
    resumeAfterTemp(ask)
  }

  const workTitle = researchUnclaimed ? tr('ui.researchLab.002') : veinCell
    ? tr("ui.Wormhole.242", { rigs: rigs, p2: Math.min(rigs, herePiles.length) })
    : tr("ui.Wormhole.075", { rigs: rigs, p2: Math.min(rigs, herePiles.length) })

  function renderHereNode(): React.ReactNode {
    if (!grid || !hereCell) return null
    return (
      <>
        <SignalRangeEwPreview state={state} ctx={ctx} />
        <div className="app-wh-node-title">
          {atExit ? tr("ui.Wormhole.007") : placeText(hereCell.place)}
          {/* 地点说明**不进 ⓘ**（2026-09-14 船长裁定：「地点卡的说明不要进 ⓘ」）：它跟着当前格子变，
              属于"这一格现在是什么"的读数 ⇒ 按 2026-09-13 口径（常驻说明进 ⓘ、状态读数留眼前）留在卡里 */}
          <span className="app-dim">
            {' '}{tr('ui.Wormhole.275')}Q{grid.pos.q} · R{grid.pos.r}
            {grid.activated.includes(hereKey) ? tr('ui.Wormhole.303') : ''}
          </span>
        </div>
        {researchUnclaimed && herePiles.length > 0 ? <div className="app-dim app-note">{tr('ui.researchLab.002')}</div> : null}
        {/* **作业进度条**（F2b · 纯表现 380ms）：摆在堆清单正上方——卡片"向下移出"的同时，这条在走 */}
        {jobFx ? (
          <div className="app-wh-jobrow" key={jobFx.nonce}>
            <span className="app-wh-jobrow-text">
              {jobFx.label}
              {jobFx.sub ? <span className="app-dim"> · {jobFx.sub}</span> : null}
            </span>
            <span className="app-card-progress app-wh-jobbar">
              <i />
            </span>
          </div>
        ) : null}
        {/**
         * ⚠ **判据要带"幽灵卡"**（船长 2026-09-13 深夜报的坑：「**当最后打捞干净时，卡片是直接消失的**」）：
         * 原先这里只看 `herePiles.length > 0` ⇒ 最后一堆被拿走的瞬间整块换成"地点说明"，
         * 幽灵卡**根本没机会渲染**。现在"还有卡"含幽灵卡，动画播完（300ms）才轮到地点说明。
         */}
        {herePiles.length > 0 || leavingPiles.length > 0 ? (
          <>
            {workCell && bulkPiles > 0 ? (
              <div className="app-dim app-note">
                {veinCell ? tr("ui.Wormhole.187") : tr("ui.MarketPage.009")}{tr('ui.Wormhole.342')} {bulkPiles} {tr('ui.Wormhole.342')}{veinCell ? '' : tr("ui.Wormhole.243")}{tr('ui.Wormhole.276')}
                {rigName} <b>{rigs}</b> {tr("ui.Wormhole.076")} {Math.min(Math.max(rigs, 0), bulkPiles)} {tr("ui.Wormhole.077")}{' '}
                {rigs > 0 ? Math.ceil(bulkPiles / rigs) : '—'} {tr("ui.Wormhole.078")}
                {rigs <= 0 ? tr("ui.Wormhole.244", { rigName: rigName, rigName2: rigName }) : ''}{tr('ui.Wormhole.277')}
              </div>
            ) : null}
            {shapedPiles.length > 0 ? (
              <div className="app-dim app-note">
                {tr("ui.FitPage.072")} <b>{shapedPiles.length}</b>{tr('ui.Wormhole.278')}
              </div>
            ) : null}
            {/**
             * **本格的谜质是哪一台**（F3c · 船长 2026-09-13）：按 (种子, 层, 格) 定死 ⇒ 界面读出来的
             * 与 core 落包的那一台必然一致（同一个 `wormholeMatterDeviceAt`）。
             */}
            {hereCell.place === 'matter' ? (
              <div className="app-dim app-note">
                {tr("ui.Wormhole.245")}<b>{wormholeMatterDeviceAt(run?.seed ?? 0, run.depth, hereKey).name}</b>{tr("ui.Wormhole.008")}
                {wormholeMatterDeviceAt(run?.seed ?? 0, run.depth, hereKey).text}{tr('ui.Wormhole.279')}
              </div>
            ) : null}
            {/* **装不下的预告**（船长 2026-09-13）——把"再捞就满"这件事摆在按钮之前，别等捞到一半才发现 */}
            {holdShortBy > 0 ? (
              <div className="app-wh-hold-soon">
                {tr("ui.Wormhole.188")} {bulkPiles} {tr("ui.Wormhole.079")} <b>{incomingCells}</b>
                {tr('ui.Wormhole.343', { p1: holdFreeCells })}
              </div>
            ) : null}
            {/**
             * **堆清单 = 卡片 + 内部滚动**（船长 2026-09-13：「将地点详细中出现的列表换成卡片形式，
             * 并添加滚动条。（防止外侧出现滚动条。）」）：卡片网格吃满信息窗剩余高度，
             * 超出就在**这张卡网格内部**滚（`.app-wh-cardlist`），外层永远不因此出滚动条。
             */}
            <div className="app-wh-cardlist">
              {herePiles.map((p, i) => {
                const def = ctx.items.get(p.itemId)
                const shaped = wormholeIsShapedItem(p.itemId)
                const slotUse = wormholeUnitsPerSlot(def?.unitM3 ?? 0)
                return (
                  <div key={`${p.itemId}-${i}`} className={`app-wh-pile${shaped ? ' is-shaped' : ''}`}>
                    <span className="app-wh-pile-name">
                      {/* 与货仓格同一枚图标（安全货柜按族、谜质按台）⇒ 地上与仓里对得上号 */}
                      <span
                        className="app-wh-hold-row-ico"
                        style={{ color: holdTone(p.itemId, itemIconOf(p.itemId, def?.kind)) }}
                      >
                        <Glyph name={itemIconOf(p.itemId, def?.kind)} size={14} color="currentColor" />
                      </span>
                      {def?.name ?? p.itemId}
                    </span>
                    <span className="app-wh-pile-count">×{n(p.units)}</span>
                    <span className="app-wh-pile-sub">
                      {n(p.units * (def?.unitM3 ?? 0))} m³
                      {shaped ? tr('ui.Wormhole.304') : ` · ${n(slotUse)} ${tr('ui.Expedition.102')}`}
                    </span>
                    {shaped ? (
                      /* **形状件（货柜）**：唯一入口就是这个拾取装舱（打捞/采集都不搬它） */
                      <button
                        className="app-btn is-small is-primary app-wh-pile-btn"
                        disabled={!!run.battle || actionBlocked !== null}
                        onClick={() => {
                          const r = engine.wormholeTakePile(i)
                          if (!r.ok) onToast(cmdText(r) || tr('ui.Wormhole.307'), true)
                          else {
                            playJob(tr("ui.Wormhole.189"), def?.name ?? tr('ui.MarketPage.006'))
                            onToast(tr("ui.Wormhole.080"))
                          }
                        }}
                        title={tr("ui.Wormhole.128")}
                      >
                        {tr("ui.Wormhole.129")}
                      </button>
                    ) : (
                      /* 母矿与残骸都靠**台数 × 回合**成批回收（船长 F5：规则同打捞）⇒ 不逐堆拾取 */
                      <span className="app-wh-pile-tag">{veinCell ? tr("ui.Wormhole.081") : tr("ui.Wormhole.082")}</span>
                    )}
                  </div>
                )
              })}
              {/* **刚被拿走的堆**：留一张幽灵卡播"向下移出 + 淡出"（不吃点击、不参与判定，300ms 后自动摘掉） */}
              {leavingPiles.map((g) => {
                const def = ctx.items.get(g.itemId)
                return (
                  <div key={g.key} className="app-wh-pile is-leaving" aria-hidden>
                    <span className="app-wh-pile-name">{def?.name ?? g.itemId}</span>
                    <span className="app-wh-pile-count">×{n(g.units)}</span>
                    <span className="app-wh-pile-sub">{tr("ui.Wormhole.083")}</span>
                  </div>
                )
              })}
            </div>
          </>
        ) : (
          <div className="app-dim app-note">{PLACE_NOTE[hereCell.place]}</div>
        )}
      </>
    )
  }

  function renderExploreConfirmations(): React.ReactNode {
    if (!run || !grid) return null
    return (
      <div className="app-wh-confirmations">
        {extractAsk ? (
          <div className="app-wh-extract-ask">
            <span>
              {tr("ui.Wormhole.033")} <b>{tr('ui.Wormhole.349', { p1: run.depth })}</b>
              {tr('ui.Wormhole.350')}<b>{tr("ui.Wormhole.143")}</b>{tr("ui.Wormhole.258")}
            </span>
            <span className="app-wh-actions">
              <button className="app-btn is-small is-danger" onClick={() => { setExtractAsk(false); doExtract() }}>
                {tr("ui.Wormhole.193")}
              </button>
              <button className="app-btn is-small" onClick={() => setExtractAsk(false)}>{tr("ui.ActivityBar.004")}</button>
            </span>
          </div>
        ) : null}
        {run.pendingRuinsBattle === true ? (
          <div className="app-wh-extract-ask">
            <span>⚠ <b>{tr("ui.Wormhole.099")}</b>{tr('ui.Wormhole.351')}</span>
            <span className="app-wh-actions">
              <button className="app-btn is-small is-danger" onClick={() => {
                const r = engine.wormholeFight('ruins')
                if (!r.ok) onToast(cmdText(r) || tr('ui.Wormhole.341'), true)
              }}>{tr("ui.App.080")}</button>
            </span>
          </div>
        ) : null}
        {run.pendingNodeBattle === true ? (
          <div className="app-wh-extract-ask">
            <span>⚠ <b>{tr("ui.Handbook.308")}</b>{tr('ui.Wormhole.352', { p1: `Q${grid.pos.q} · R${grid.pos.r}` })}</span>
            <span className="app-wh-actions">
              <button className="app-btn is-small is-danger" onClick={() => {
                const r = engine.wormholeFight('node')
                if (!r.ok) onToast(cmdText(r) || tr('ui.Wormhole.341'), true)
              }}>{tr("ui.Wormhole.100")}</button>
            </span>
          </div>
        ) : null}
        {pendingCell ? (
          <div className="app-wh-ask">
            <span>
              {pendingCell.intercept ? (
                pendingCell.intercept.known ? (
                  <>{tr("ui.Wormhole.210")}<b>{tr("ui.Wormhole.146")}</b>{tr('ui.Wormhole.354')}<b>{tr("ui.Wormhole.100")}</b>{tr("ui.Wormhole.034")}</>
                ) : (
                  <>{tr("ui.Wormhole.211")}<b>{tr("ui.Wormhole.102")}</b>{tr('ui.Wormhole.353')}<b>{tr("ui.Wormhole.100")}</b>{tr('ui.Wormhole.355')}</>
                )
              ) : (
                <>{tr("ui.Wormhole.103")}<b>{tr("ui.Wormhole.147")}</b>{tr("ui.Wormhole.148")}{tr('ui.Wormhole.356')}</>
              )}
              {pendingCell.intercept && pendingCell.unknown ? <><br />{tr("ui.Wormhole.104")}Q{pendingCell.q} · R{pendingCell.r}）<b>{tr("ui.Wormhole.260")}</b>{tr('ui.Wormhole.363')}</> : null}
            </span>
            <span className="app-wh-actions">
              <button className="app-btn is-small is-warn" disabled={!!run.battle || run.turnsLeft < 1}
                onClick={() => travelTo(pendingCell.q, pendingCell.r, true, !!pendingCell.intercept)}>
                {tr("ui.Wormhole.212")}
              </button>
              <button className="app-btn is-small" onClick={() => setPendingCell(null)}>{tr("ui.ActivityBar.004")}</button>
            </span>
          </div>
        ) : null}
      </div>
    )
  }

  function handleClose(): void {
    if (auto) {
      autoRequest.current?.abort()
      onClose()
      return
    }
    if (state.wormhole.run?.battle) {
      onToast(tr("ui.Wormhole.009"), true)
      return
    }
    closingRef.current = true
    if (state.wormhole.run) engine.wormholeLeave()
    onClose()
  }

  const [resumeNote, setResumeNote] = useState<string | null>(null)
  useEffect(() => {
    if (auto || closingRef.current) return
    if (!state.wormhole.run || state.wormhole.run.attending === true) return
    const r = engine.wormholeResume()
    if (!r.ok) setResumeNote(cmdText(r) || tr('ui.Wormhole.308'))
    else setResumeNote(null)
  }, [engine, state.wormhole.run?.attending, auto])

  useEffect(() => {
    if (auto) return
    if (state.wormhole.run && tab === 'prep') setTab('map')
    else if (!state.wormhole.run && tab !== 'prep') setTab('prep')
  }, [state.wormhole.run, tab, auto])

  if (!auto && run?.battle && run.attending === true) return null

  return (
    <div className="app-modal-mask" onClick={handleClose}>
      <div className="app-modal app-wh-modal" onClick={(e) => e.stopPropagation()}>
        <div className="app-modal-head">
          <span className="app-report-title">{settle ? tr("ui.Wormhole.130") : tr("ui.Expedition.005")}</span>
          <span className="app-dim app-wh-devnote" title={run ? tr(run.attending ? 'ui.Wormhole.010' : 'ui.Wormhole.084') : undefined}>
            {auto
              ? tr("ui.Wormhole.190", { WORMHOLE_AUTO_MAX_SHIPS: WORMHOLE_AUTO_MAX_SHIPS, p2: Math.round(WORMHOLE_AUTO_DURATION_MS / 60_000) })
              : settle
                ? settle.kind === 'extract'
                  ? tr("ui.Wormhole.191")
                  : tr("ui.Wormhole.192")
                : run
                  ? run.attending
                    ? tr("ui.Wormhole.010")
                    : tr("ui.Wormhole.084")
                  : tr("ui.Wormhole.011")}
          </span>
          {/**
           * **撤离按钮搬到「✕ 关闭」左侧，红色色系，两次讨伐确认**（船长 2026-09-13：
           * 「撤离按钮放在关闭左侧，并用红色色系，玩家撤离时会警告玩家并需要确认」）。
           * 与「存档管理 · 删除备份」同一套确认语言：**点一下进入待确认态**（按钮变文案 + 危险红），
           * 同时在页体顶部摆出确认条，**再点一下才真的撤**；5 秒不点自动解除，免得误触后一直挂着。
           * 战斗进行中一律禁用（见下）。
           * ⚠ 2026-09-15 撤离战取消：这一撤不再触发任何战斗（"交火中不能撤"照旧）。
           */}
          {!settle && run ? (
            <button
              className={`app-btn is-small is-danger app-wh-extract${extractAsk ? ' is-armed' : ''}`}
              disabled={!!run.battle || fxBusy}
              onClick={() => {
                if (!extractAsk) {
                  setExtractAsk(true)
                  return
                }
                setExtractAsk(false)
                doExtract()
              }}
              title={
                run.battle
                  ? tr("ui.Wormhole.012")
                  : extractAsk
                    ? tr("ui.Wormhole.013")
                    : tr("ui.Wormhole.131")
              }
            >
              {extractAsk ? tr("ui.Wormhole.193") : tr("ui.Handbook.163")}
            </button>
          ) : null}
          <button
            className="app-btn is-small"
            disabled={!!run?.battle}
            onClick={handleClose}
            title={run?.battle ? tr("ui.Wormhole.014") : undefined}
          >
            {tr("ui.Wormhole.015")}
          </button>
        </div>
        {/**
         * **探索 / 背包 = 显眼的分段大页签**（船长 2026-09-13：「探索和背包的切换按钮有些过于隐蔽」）：
         * 从标题行右侧那两颗 `is-small` 小按钮搬出来，放到标题行**正下方**、等宽两枚、带图标与读数；
         * 背包那枚顺带把**货仓占用**摆在脸上（超载转红）——省得玩家为了看格数专门切过去。
         * 进洞后「准备」是死按钮（编队已锁定）⇒ **直接不渲染**；没进洞时只有准备页 ⇒ 整条不渲染。
         */}
        {!settle && run ? (
          <div className="app-wh-tabbar">
            {(['map', 'bag'] as WhTab[]).map((k) => (
              <button
                key={k}
                className={`app-wh-tab${tab === k ? ' is-active' : ''}`}
                onClick={() => {
                  /**
                   * **切回探索 = 触发临时空间的丢弃确认**（船长 2026-09-14：
                   * 「直接将要丢弃的东西放进去后切换回探索界面触发丢弃（但是需要提醒玩家是否要丢弃物品
                   * 并列出丢弃的物品列表）」）：非空就先弹条，选完才真切过去。
                   */
                  if (k === 'bag') {
                    setTab('bag')
                    return
                  }
                  leaveBagPage('tab', () => setTab(k))
                }}
              >
                <span className="app-wh-tab-label">{TAB_LABEL[k]}</span>
                <span className="app-wh-tab-sub">
                  {k === 'map'
                    ? tr("ui.Wormhole.194", { p1: run.depth, p2: run.turnsLeft, p3: run.turnsTotal })
                    : tr("ui.Wormhole.195", { p1: holdInfo?.used ?? 0, p2: holdInfo?.capacity ?? 0 })}
                </span>
                {k === 'bag' && overloaded ? <span className="app-wh-tab-warn">{tr("ui.Wormhole.196")}</span> : null}
                {k === 'bag' && !overloaded && actionBlocked !== null ? (
                  <span className="app-wh-tab-warn">{tr("ui.Wormhole.085")}</span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}

        {/* `app-wh-body` = 让本面板的页体成为**纵向弹性容器**（船长 2026-09-13：
            「舰船选择界面高度可以适当缩减，让上一层的虫洞界面不要有滚动条」）——
            准备页把自己撑满页体、**卡网格吸收剩余高度并在内部滚动**，外层页体就不再出现滚动条。 */}
        <div className={`app-modal-body app-wh-body${!settle && tab === 'map' && run ? ' is-exploring' : ''}`}>
          {/**
           * **本趟结算界面**（船长 2026-09-13：「玩家撤离后弹出一个结算界面，表示玩家的收益和损失。
           * 然后关闭虫洞界面」）：有结算单时**整页只显示它**（页签隐去），
           * 点「确认」= 清掉结算单 + **关闭虫洞面板**（`onClose`）。
           */}
          {settle ? (
            /**
             * **本趟结算界面**（船长 2026-09-13）：「玩家撤离后弹出一个结算界面，表示玩家的收益和损失。
             * 然后关闭虫洞界面」＋同日晚两条追加：「**结算界面尽量居中显示**」
             * 「**收获信息挨个弹出显示（需要动效）**」。
             *
             * 做法：整块**居中**（定宽 640，内容变化不跳动）；四格明细**依次弹出**（逐格 +90ms，
             * 下方 6px 淡入上移，纯 CSS `animation-delay`）；合计那一行等明细播完再淡入，
             * 数字走 `useCountUp` **跳数** 320ms。⚠ **「确认并返回」立刻可点**——不拿动画锁玩家。
             */
            <SettleView
              settle={settle}
              onConfirm={() => {
                engine.wormholeAckSettle()
                /**
                 * **残留结算单 ＋ 带库存点进来 ⇒ 继续进准备页**（乙案）：玩家点「开始探索」的意图是
                 * **探索这一处**，不是"看上一趟的结算" ⇒ 确认完**不关面板**；结算单一清，
                 * 面板自然落回准备页（没有 `run` 时 `tab` 的初值本就是 `'prep'`，那处库存也还在 `stockId` 里）。
                 * 其余情形照旧关面板（船长 2026-09-13：「玩家撤离后弹出一个结算界面…然后关闭虫洞界面」）。
                 */
                if (settleAtMountRef.current) return
                onClose() // 船长：结算完关掉虫洞界面
              }}
            />
          ) : null}
          {/* 回不到虫洞（主控在忙）：把拒因摆出来，别让玩家对着不能点的界面猜（议案 A 第 3 条） */}
          {!settle && resumeNote ? <div className="app-warn app-wh-gate">{resumeNote}</div> : null}
          {/* 本趟已结束（撤离成功 / 全损）⇒ 回到准备页并说明结果（否则"探索/背包"两页会是空白） */}
          {!settle && !run && tab !== 'prep' ? (
            <div className="app-dim app-inv-empty">
              {tr("ui.Wormhole.132")} {state.wormhole.lastFleetLost} {tr("ui.Wormhole.197")}
            </div>
          ) : null}
          {!settle && tab === 'prep' ? (
            <div className="app-wh-prep">
              <div className="app-bay-title">
                {auto
                  ? tr("ui.Wormhole.086", { WORMHOLE_AUTO_MAX_SHIPS: WORMHOLE_AUTO_MAX_SHIPS })
                  : tr("ui.Wormhole.087", { WORMHOLE_MAX_SHIPS: WORMHOLE_MAX_SHIPS })}
              </div>
              {/**
               * **敌情一行**（船长 2026-09-16：「给虫洞卡片添加更多信息（虫洞内是什么敌人，
               * 以什么类型伤害为主）」——准备页与扫描页**同批对齐**，两处共用 `ui/wormholeIntel`）。
               * 只有"这一处是哪一处"已知时才显示（从库存进来 ⇒ `stockId`/`autoStockId` 有值）；
               * 悬停给三档火力构成（⚠ 档间会变：D 族深层 6:4、E 族中层纯高爆）。
               */}
              {prepStock ? (
                <div className="app-dim app-note" title={wormholeIntelTip(engine, prepStock.family)}>
                  {wormholeIntelLine(engine, prepStock.family)}
                </div>
              ) : null}
              <div className="app-dim app-note">
                {auto ? (
                  tr('ui.signalAuto.004', { p1: WORMHOLE_AUTO_MAX_SHIPS, p2: Math.round(WORMHOLE_AUTO_DURATION_MS / 60_000) })
                ) : (
                  <>
                    {tr("ui.Wormhole.089")}{' '}
                    {n(WORMHOLE_TOTAL_MASS_CAP)} {tr("ui.Wormhole.020")}{' '}
                    {n(WORMHOLE_SLOT_M3)} {tr("ui.Wormhole.021")}
                  </>
                )}
              </div>
              {/* **选舰卡片**（船长 2026-09-13：「虫洞入口选取舰船采用卡片形式，卡片内含有舰船名称、
                  舰船级别、折算质量、货仓、舰船 SVG 外形，且当编入时，卡片边框会变色」）——
                  结构/类名沿用装配页候选卡（`.app-fit-pick-item`）与舰队卡（`.app-inv-row.is-picked`）那一族：
                  整卡可点、选中态给边框+底色；舰影走统一资产 `ShipSprite`（细描边线稿，非 CSS 拼形）。
                  ⚠ `ShipSprite` **不要传 `name`**：它自带一个绝对定位的舰名标签（`.app-sprite-name`，
                  贴在舰影下缘），会压住卡片自己的舰名（2026-09-13 船长报「名称与 SVG 下方文本重叠」）。
                  检索控件（搜索 + 状态/类别/级别三行筛选）复刻「我的舰队」那套类名与口径。 */}
              <div className="app-bay-title app-wh-sub">{tr("ui.Wormhole.247")}</div>
              {/**
               * **检索区 + 进入按钮平级**（船长 2026-09-13：「进入虫洞的按钮放大（参考导航栏的出击），
               * 移动到搜索和筛选按钮相同容器内的最右侧」）：左边 = 搜索框 + 类别/级别两行筛选，
               * 右边 = 放大的「进入虫洞」主按钮（`.app-wh-enter`）+ 编队计数。 */}
              <div className="app-wh-prephead">
                <div className="app-wh-prephead-main">
                  <span className="app-head-search-wrap app-wh-search">
                    <input
                      className="app-head-search"
                      type="text"
                      placeholder={tr("ui.ShipPage.002")}
                      value={whQ}
                      onChange={(e) => setWhQ(e.target.value)}
                      spellCheck={false}
                    />
                    <span className="app-dim">
                      {whFiltered ? tr("ui.Wormhole.090", { p1: whShown.length, p2: whEntries.length }) : tr("ui.Wormhole.022", { p1: whEntries.length })}
                    </span>
                  </span>
                  <div className="app-fleet-toolbar app-wh-filters">
                <div className="app-fleet-row">
                  <span className="app-dim">{tr("ui.ShipPage.004")}</span>
                  <div className="app-task-tabs app-fleet-tabs" role="tablist">
                    <button
                      role="tab"
                      aria-selected={whRole === SUB_ALL}
                      className={`app-tasktab${whRole === SUB_ALL ? ' is-active' : ''}`}
                      onClick={() => setWhRole(SUB_ALL)}
                    >
                      {tr("ui.IndustryPage.001")}
                    </button>
                    {SHIP_DOMAIN_SUBS.filter((s) => whEntries.some((e) => shipRolePasses(e.def, s.key))).map((s) => (
                      <button
                        key={s.key}
                        role="tab"
                        aria-selected={whRole === s.key}
                        className={`app-tasktab${whRole === s.key ? ' is-active' : ''}`}
                        onClick={() => setWhRole(s.key)}
                      >
                        {subText(s)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="app-fleet-row">
                  <span className="app-dim">{tr("ui.ShipPage.005")}</span>
                  <div className="app-task-tabs app-fleet-tabs" role="tablist">
                    <button
                      role="tab"
                      aria-selected={whTier === SUB_ALL}
                      className={`app-tasktab${whTier === SUB_ALL ? ' is-active' : ''}`}
                      onClick={() => setWhTier(SUB_ALL)}
                    >
                      {tr("ui.IndustryPage.001")}
                    </button>
                    {SHIP_TIER_SUBS.map((s) => (
                      <button
                        key={s.key}
                        role="tab"
                        aria-selected={whTier === s.key}
                        className={`app-tasktab${whTier === s.key ? ' is-active' : ''}`}
                        onClick={() => setWhTier(s.key)}
                      >
                        {subText(s)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
                </div>
                {/* **进入虫洞（放大 · 检索区最右）**：主按钮档位与导航栏「出击」同款观感（`.app-wh-enter`）
                    —— 自动探索模式复用同一枚按钮位，只换文案与动作（船长 2026-09-14） */}
                <div className="app-wh-prephead-go">
                  <button
                    className="app-btn is-primary app-wh-enter"
                    style={{ position: 'relative' }}
                    disabled={auto ? autoComputing || picked.length === 0 || autoGate !== null : !admission.ok || !!run || entryGate !== null}
                    aria-busy={auto && autoComputing || undefined}
                    onClick={auto ? handleAutoStart : handleEnter}
                    title={
                      !auto && enterHaulAsk
                        ? tr('ui.Hauling.035')
                        : auto
                          ? (autoGate !== null ? cmdText(autoGate) : picked.length === 0 ? tr("ui.Wormhole.023") : undefined)
                          : (entryGate ??
                            (autoStopText ? tr("ui.Wormhole.248", { autoStopText: autoStopText }) : undefined))
                    }
                  >
                    {auto && autoComputing ? <span style={{ position: 'absolute', top: 6, right: 6 }}><Glyph name="ico-clock" size={16} /></span> : null}
                    {!auto && enterHaulAsk ? tr('ui.Hauling.034') : auto ? tr("ui.Wormhole.134") : tr("ui.Expedition.308")}
                  </button>
                  <span className="app-dim">
                    {auto
                      ? tr("ui.Wormhole.199", { p1: picked.length, WORMHOLE_AUTO_MAX_SHIPS: WORMHOLE_AUTO_MAX_SHIPS })
                      : tr("ui.Wormhole.200", { p1: picked.length, WORMHOLE_MAX_SHIPS: WORMHOLE_MAX_SHIPS })}
                  </span>
                </div>
              </div>
              <CommandBudget engine={engine} ships={picked} special />
              <RangeEwFleet state={state} ctx={ctx} ids={picked} />
              <PreparationFleetCards engine={engine} rows={whShown} auto={auto} handoverName={autoHandover?.toName} togglePick={togglePick} />

              {/**
               * **读数条**（同一处位置、同一套样式，两种模式两套内容）：
               * - 手动 ⇒ 编队读数（货仓⇒背包格 / 折算总质量 / 回合预算 ＋ **打捞器 / 采集器 / 扫描范围**
               *   三项——船长 2026-09-19：「在虫洞的准备界面，三联读数处添加玩家所选舰船的打捞器数量和
               *   采集器数量以及扫描范围」）；
               * - 自动 ⇒ 自动探索读数（AI 核心占用 / 时长 / 收益 / 损伤）——船长 2026-09-14 选定。
               * ⚠ ⟪文案调整 2026-09-19⟫ 标题：原文案是「**三联读数**」（那时确实三项）；本批加三项后改成
               * 「**编队读数**」——六个读数再叫"三联"就与内容不符了（船长若要保留旧名，改这一处即可）。
               * ⚠ 旧名还出现在 `docs/glossary.md`（词条描述）与几份旧设计稿/测试档说明里：按 §八 工作期间
               * **不动旧文档** ⇒ 归档时随工作文档一并更正（已记进本批工作文档的「归档待办」）。
               */}
              <div className="app-bay-title app-wh-sub">{auto ? tr("ui.Wormhole.207") : tr("ui.Wormhole.026")}</div>
              {auto ? (
                <div className="app-wh-triad">
                  <span className="app-wh-cell">
                    {tr('ui.signalAuto.003', { p1: picked.length })}
                  </span>
                  <span className="app-wh-cell">
                    {tr("ui.Wormhole.138")} <b>{Math.round(WORMHOLE_AUTO_DURATION_MS / 60_000)}</b> {tr("ui.DebugPanel.007")}
                  </span>
                  <span className="app-wh-cell">
                    {/* ⟪文案调整 2026-10-22⟫ 收益只显示科技对应的百分比，移除过程说明与尾注。 */}
                    {tr("ui.Wormhole.139")}<b>{Math.round(matterTechSignalAutoYield(state, ctx) * 100)}%</b>
                  </span>
                  <span
                    className="app-wh-cell"
                    title={
                      autoTechNeutral
                        ? tr('ui.Wormhole.286')
                        : tr('ui.Wormhole.287', {
                            p1: Math.round(autoTech.battleProgress * 100),
                            p2: autoTech.damage.toFixed(2),
                          })
                    }
                  >
                    {tr("ui.Wormhole.140")}{' '}
                    <b>
                      {Math.round(WORMHOLE_AUTO_DAMAGE_MIN * autoTech.damage * 100)}%~
                      {Math.round(WORMHOLE_AUTO_DAMAGE_MAX * autoTech.damage * 100)}%
                    </b>
                    {tr("ui.Wormhole.252")}
                  </span>
                  {/**
                   * **谜质科技那一格**（船长 2026-09-19 甲案「自动探索不折扣」）：只在真吃到科技时出现
                   * （未点科技 ⇒ 这一格不出现、损伤区间也一字不变）。系数由 `wormholeAutoTechFactors`
                   * 现算——**与结算同一个函数** ⇒ 读数就是返航时真正生效的那个数。
                   * 悬停给逐项细账（回合 / 货仓 / 两条效率 / 战斗线），口径见 core 的 `WormholeAutoTechFactors`。
                   */}
                  {!autoTechNeutral ? (
                    <span
                      className="app-wh-cell"
                      title={[
                        tr('ui.Wormhole.312', { p1: Math.round((autoTech.turnMul - 1) * 100), p2: autoTech.baseTurns }),
                        tr('ui.Wormhole.313', { p1: Math.round((autoTech.holdMul - 1) * 100), p2: autoTech.baseHold }),
                        tr('ui.Wormhole.314', { p1: Math.round(autoTech.salvageEff * 100) }),
                        tr('ui.Wormhole.315', { p1: Math.round(autoTech.collectEff * 100) }),
                        tr('ui.Wormhole.316', { p1: Math.round(autoTech.battleProgress * 100), p2: autoTech.damage.toFixed(2) }),
                      ].join('\n')}
                    >
                      {tr('ui.Wormhole.344')} <b>×{autoTech.wreck.toFixed(2)}</b> {tr('ui.Wormhole.345')} <b>×{autoTech.ore.toFixed(2)}</b>
                    </span>
                  ) : null}
                </div>
              ) : (
                <div className="app-wh-triad">
                  <span className="app-wh-cell">
                    {tr("ui.Wormhole.094")} <b>{n(cargoM3)}</b> {tr("ui.Wormhole.029")} <b>{bagSlots}</b>{tr('ui.Wormhole.346')}
                  </span>
                  <span className="app-wh-cell">
                    {tr("ui.Wormhole.141")} <b>{n(admission.totalMass)}</b> / {n(WORMHOLE_TOTAL_MASS_CAP)}
                  </span>
                  <span className="app-wh-cell">
                    {tr("ui.Wormhole.095")} <b>{admission.turnBudget}</b>
                  </span>
                  {/* 2026-09-19 船长追加的三项：所选编队的作业能力与开图能力（口径见上方注释）
                      ⚠ 悬停是**纯文本**渲染 ⇒ 不许写 `**` 这类强调记号（会被原样显示给玩家，
                      content:check 的「文案纯净契约」当场报红抓过本条一次，别再犯） */}
                  <span
                    className="app-wh-cell"
                    title={tr('ui.Wormhole.317', { p1: Math.round(pickedSalvageEff * 100) })}
                  >
                    {tr("ui.Wormhole.001")} <b>{pickedSalvagers}</b> {tr('ui.Wormhole.288')} <b>{Math.round(pickedSalvageEff * 100)}%</b>
                  </span>
                  <span
                    className="app-wh-cell"
                    title={tr('ui.Wormhole.318', { p1: Math.round(pickedCollectEff * 100) })}
                  >
                    {tr("ui.Wormhole.238")} <b>{pickedMiners}</b> {tr('ui.Wormhole.288')} <b>{Math.round(pickedCollectEff * 100)}%</b>
                  </span>
                  <span
                    className="app-wh-cell"
                    title={tr('ui.Wormhole.319')}
                  >
                    {tr('ui.Wormhole.347')} <b>{pickedScanRadius}</b>{tr('ui.Wormhole.348')}
                  </span>
                </div>
              )}
              {auto && autoMainPicked && autoHandover?.toName ? (
                <div className="app-warn app-wh-gate">
                  {tr("ui.Wormhole.253")}<b>{tr("ui.Wormhole.030")}{autoHandover.toName}{tr('ui.Wormhole.364')}</b>{tr("ui.Wormhole.254")}
                </div>
              ) : null}
              {auto && autoGate !== null ? <div className="app-warn app-wh-gate">{cmdText(autoGate)}</div> : null}
              {!auto && !admission.ok ? (
                <div className="app-warn app-wh-gate">{WORMHOLE_ADMISSION_TEXT[admission.code]}</div>
              ) : null}
              {!auto && entryGate !== null ? <div className="app-warn app-wh-gate">{entryGate}</div> : null}
              {/**
               * **编队未满的软提醒**（船长 2026-09-20）——与上面两条"硬拦"分开摆：
               * 它是**风险提示**（再加入会更危险），不是门槛 ⇒ 不再叠一条"编队非法"式的红字，
               * 也不置灰「进入虫洞」按钮（`disabled` 处一字未改）。类名沿用本区既有的 `.app-warn .app-wh-gate`。
               */}
              {fleetShortWarn ? (
                <div className="app-warn app-wh-gate">
                  {tr('ui.Wormhole.377', { p1: picked.length })}
                </div>
              ) : null}
              {/**
               * **进洞会自动停掉哪些活动的预告**（船长 2026-09-14「进洞自动停止」＋「同样落实到采矿/打捞」）：
               * 只说清"会发生什么"，**不拦人**——这几项都是主控亲自在跑的作业，停法与手点活动栏「停止」完全一致
               * （扫描进度保留、作业中的货留在船上）。
               */}
              {!auto && autoStopText !== null ? (
                <div className="app-note app-dim">
                  {tr("ui.Wormhole.255")}<b>{autoStopText}</b>
                  {tr("ui.Wormhole.256")}
                </div>
              ) : null}
              {/**
               * **长途运输：发警告**（船长 2026-09-14）——它停掉**有可见后果**（本段航程中止、船被挪回出发站），
               * 所以摆成琥珀色警告条，而不是跟在上面那句轻描淡写的预告里。
               */}
              {autoStopWarns.map((a) => (
                <div key={a.kind} className="app-warn app-wh-gate">
                  {tr("ui.Wormhole.031")}{a.name}{tr("ui.Wormhole.032")}<b>{tr("ui.Wormhole.096")}</b>{tr("ui.Wormhole.257")}
                </div>
              ))}
              {/* 进入按钮已上移到检索区右侧（船长 2026-09-13），此处不再重复放一个 */}
            </div>
          ) : null}

          {!settle && tab === 'map' && run ? (
            <div className="app-wh-run">
              {grid && hereCell ? (
              <div className="app-wh-explore">
                <div className="app-wh-map-pane">
              <div className="app-wh-head">
                <span className="app-wh-cell">{tr('ui.Wormhole.349', { p1: run.depth })}</span>
                <span className="app-wh-cell">
                  {tr("ui.Wormhole.097")} <b>{grid ? grid.visited.length : 0}</b> / {grid ? grid.cells.length : 0}{tr('ui.Wormhole.346')}
                </span>
                <span className="app-wh-cell">
                  {tr("ui.Wormhole.098")} <b>{grid ? grid.scanned.length : 0}</b>{tr('ui.Wormhole.346')}
                </span>
                <span
                  className="app-wh-cell"
                  title={tr('ui.Wormhole.290', { p1: Math.round(runSalvageEff * 100) })}
                >
                  {tr("ui.Wormhole.001")} <b>{salvagers}</b> {tr('ui.Wormhole.288')} <b>{Math.round(runSalvageEff * 100)}%</b>
                </span>
                <span
                  className="app-wh-cell"
                  title={tr('ui.Wormhole.291', { p1: Math.round(runCollectEff * 100) })}
                >
                  {tr("ui.Wormhole.238")} <b>{miners}</b> {tr('ui.Wormhole.288')} <b>{Math.round(runCollectEff * 100)}%</b>
                </span>
                {/**
                 * **谜质增益读数**（F3c · 船长 2026-09-13）：悬停逐台列出装置 —— 效果一律从货仓现算
                 * （`wormholeMatterBuffs`），界面与 core 同源。
                 *
                 * ⚠ ⟪2026-09-19 补⟫ **科技那一份也要显形**（船长「检查是否有其他丢掉科技的情况」四处之一）：
                 * 这只袋子是"装置 + 科技"合流的，原先只在**带了装置**时出现、悬停也只列装置 ⇒ 光点科技、
                 * 一台装置不带时这一格整个不出现（科技等于没被玩家看见）。现在两条来源各列一段，
                 * 只要任一条非空就出现：装置 ⇒「谜质 N 台」，科技 ⇒「科技 M 级」（只列**洞内两条线**
                 * 的已点节点——洞外工业线不在此列，口径见上方 `techInRun`）。
                 */}
                {matterBuffs.devices > 0 || techInRun.length > 0 ? (
                  <span
                    className="app-wh-cell"
                    title={[
                      ...(matterBuffs.devices > 0
                        ? [
                            tr('ui.Wormhole.292'),
                            ...matterBuffs.list.map(
                              ({ device, count }) =>
                                tr('ui.Wormhole.320', { p1: device.name, count: count > 1 ? ` ×${count}` : '', p4: device.text }),
                            ),
                          ]
                        : []),
                      ...(techInRun.length > 0
                        ? [
                            tr('ui.Wormhole.293'),
                            ...techInRun.map(({ def, level }) => tr('ui.Wormhole.340', { p1: def.name, p2: level, p3: def.maxLevel, p4: def.note })),
                          ]
                        : []),
                    ].join('\n')}
                  >
                    {matterBuffs.devices > 0 ? (
                      <>
                        {tr("ui.Wormhole.208")} <b>{matterBuffs.devices}</b> {tr('ui.Wormhole.288')}
                      </>
                    ) : null}
                    {matterBuffs.devices > 0 && techInRun.length > 0 ? ' · ' : null}
                    {techInRun.length > 0 ? (
                      <>
                        {tr('ui.Wormhole.294')} <b>{techInRunLevels}</b> {tr('ui.Wormhole.295')}
                      </>
                    ) : null}
                  </span>
                ) : null}
                {/**
                 * **威胁读数走谜质压制后的值**（F3c B1）：压制力场压节点与守卫两档、守卫解析仪只压守卫；
                 * 各档**各自 −50% 封顶**（在 core 的派生里夹好）。
                 * ⚠ 2026-09-15 撤离战取消 ⇒ 原来的"撤离档"读数退役。
                 */}
                <span className="app-wh-cell" title={matterThreatTip}>
                  {tr("ui.Wormhole.142")} <b>{wormholeDisplayThreat(nodeThreat)}</b>
                </span>
              </div>
                {/**
                 * **地图行 = 左侧缩放控件 + 地图**（船长 2026-09-13：「虫洞探索地图添加一个宇宙背景。
                 * 且窗口高度固定（不会随着地图变大变高）」）；按已确认 §20 让地图吃左栏余高。
                 */}
                {/* 洞内战斗不在本面板里渲染（现行：战斗中整块不渲染本面板，战场全屏独占） */}
                <div className="app-wh-maprow">
                  <div className="app-wh-zoom" role="group" aria-label={tr('ui.Wormhole.373')}>
                    <button
                      className="app-wh-zoom-btn"
                      disabled={mapZoom >= WORMHOLE_MAP_ZOOM_MAX}
                      onClick={() => setMapZoom((z) => Math.min(WORMHOLE_MAP_ZOOM_MAX, +(z + WORMHOLE_MAP_ZOOM_STEP).toFixed(2)))}
                      title={tr("ui.Wormhole.144")}
                    >
                      ＋
                    </button>
                    <span className="app-wh-zoom-val">{Math.round(mapZoom * 100)}%</span>
                    <button
                      className="app-wh-zoom-btn"
                      disabled={mapZoom <= WORMHOLE_MAP_ZOOM_FIT}
                      onClick={() => setMapZoom((z) => Math.max(WORMHOLE_MAP_ZOOM_FIT, +(z - WORMHOLE_MAP_ZOOM_STEP).toFixed(2)))}
                      title={tr("ui.Wormhole.209")}
                    >
                      －
                    </button>
                    <button
                      className="app-wh-zoom-btn is-text"
                      disabled={mapZoom === WORMHOLE_MAP_ZOOM_FIT && mapPan.x === 0 && mapPan.y === 0}
                      onClick={() => {
                        setMapZoom(WORMHOLE_MAP_ZOOM_FIT)
                        setMapPan({ x: 0, y: 0 })
                      }}
                      title={tr("ui.Wormhole.101")}
                    >
                      {tr("ui.Wormhole.259")}
                    </button>
                  </div>
                  <div
      className={`app-wh-mapbox${mapPanning ? ' is-panning' : ''}`}
      ref={mapBoxRef}
      style={{ ...(pinnedSpaceBg ? { '--wh-space-bg': `url("${pinnedSpaceBg}")` } : {}) } as React.CSSProperties}
      /**
       * **拖动地图**（船长 2026-09-20：「允许玩家拖动虫洞探索地图」）：三件事一起做 ——
       * ① `pointerdown` 只**记起点与换算系数**（`viewBox ÷ 元素像素`）；
       * ② `pointermove` 超阈值才算"拖"（低于阈值当点击，交给格子）——**指针捕获在这一刻才拿**
       *    （见下方那条 2026-09-20 报障修复）；
       * ③ `pointerup/cancel` 收尾，拖过就吃掉紧随的那次 click（见 `mapDragAteClickRef`）。
       * `z = 1`（适应窗口）时没有可拖的余地 ⇒ 直接不接（指针行为与改造前一致）。
       */
      onPointerDown={(e) => {
        mapDragAteClickRef.current = false
        if (mapZoom <= WORMHOLE_MAP_ZOOM_FIT) return
        const rect = e.currentTarget.getBoundingClientRect()
        const box = wormholeMapBoxOf(run?.grid?.radius ?? grid.radius)
        mapDragRef.current = {
          id: e.pointerId,
          sx: e.clientX,
          sy: e.clientY,
          panX: mapPan.x,
          panY: mapPan.y,
          kx: box.w / Math.max(1, rect.width),
          ky: box.h / Math.max(1, rect.height),
          moved: false,
        }
        /**
         * ⚠ **2026-09-20 玩家报障修复：这里原先"按下即捕获指针"，把格子的点击整条路吃掉了。**
         *
         * 报障原话：「进层扫描以后会有卡住的 bug……要缩放到最大才能点击触发」（症状 = 缩放后点格子没反应）。
         * 根因：`click` 由浏览器派发给 **pointerdown 与 pointerup 两个目标的最近公共祖先**，而
         * `setPointerCapture` 会把后续指针事件（含 pointerup）**改派到捕获元素**（这里 = 地图框 div）
         * ⇒ 公共祖先变成地图框 ⇒ 格子的 `onClick` 再也不触发。`z = 1` 时上面那行提前 return（不捕获）
         * ⇒ **只有"缩放过的地图"点不动**；而换层自动缩放（半径 > 8）一进层就 > 1 ⇒
         * 报障里"进层以后"与"跟缩放有关"两句都对上了；退出面板再进来会把手动缩放复位 ⇒ "到主界面再返回才好"。
         *
         * 现在改成：**只有真的拖起来（越过阈值）才捕获**——纯点击从不捕获，格子的点击在任意缩放下都正常；
         * 拖动一旦开始，指针捕获照旧（拖出地图框也不断线），并在 `pointerup/cancel` 里释放。
         */
      }}
      onPointerMove={(e) => {
        const d = mapDragRef.current
        if (!d || d.id !== e.pointerId) return
        const dx = e.clientX - d.sx
        const dy = e.clientY - d.sy
        if (!d.moved && Math.hypot(dx, dy) < WORMHOLE_MAP_DRAG_THRESHOLD_PX) return
        if (!d.moved) {
          d.moved = true
          // 拖起来了才捕获指针（此刻起"这一下"确定是拖动，不是点格子）
          try {
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {
            /* 指针已经抬起（极短拖）⇒ 不捕获也能拖完这一下 */
          }
        }
        setMapPanning(true)
        const box = wormholeMapBoxOf(run?.grid?.radius ?? grid.radius)
        const anchor = wormholeMapAnchorOf(run?.grid ?? grid)
        setMapPan(
          wormholeMapPanClamp({ x: d.panX + dx * d.kx, y: d.panY + dy * d.ky }, mapZoom, box, anchor),
        )
      }}
      onPointerUp={(e) => {
        const d = mapDragRef.current
        if (!d || d.id !== e.pointerId) return
        mapDragRef.current = null
        setMapPanning(false)
        if (d.moved) mapDragAteClickRef.current = true
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
      }}
      onPointerCancel={() => {
        mapDragRef.current = null
        setMapPanning(false)
      }}
      /**
       * **捕获丢了也要收尾**（防"卡住"）：指针被系统/别的元素抢走时 `pointerup` 可能不来，
       * 若此时还留着 `mapDragRef`/`mapPanning`，之后每一次移动都会被当成拖动（点击再也进不去格子）。
       * 这条把状态清干净——与 `pointerup` 同一个收尾，只是不"吃掉"下一次 click。
       */
      onLostPointerCapture={() => {
        mapDragRef.current = null
        setMapPanning(false)
      }}
    >
                    {/**
                     * ⚠ **这里不许写 `title`**（**2026-09-17 船长报障**：「鼠标在地点上悬停时，会同时出现
                     * **滚轮缩放的 title 提示**和格子信息，建议取消滚轮缩放的 title」）。
                     * 机制：格子上的提示走 **SVG 的 `data-tip`**（由 `ui/Tooltip.tsx` 的自绘层接管），
                     * 而**悬停元素自己没有 `title` 时，浏览器会沿祖先链找最近的 `title` 并照原生弹出**
                     * ⇒ 地图框这一层的 `title` 会和格子提示**同屏出现**（自绘 + 原生两个）。
                     * 滚轮那句话已搬进下方图例行的 ⓘ（常驻说明进 ⓘ 的既有口径），此处保持**无 title**。
                     */}
                    <WhGridMap
                      grid={grid}
                      onPickCell={pickCell}
                      shipDefId={leadShipDefId}
                      layerKey={`${run.seed ?? 0}-${run.depth}`}
                      fx={fx}
                      scanFx={scanFx}
                      dissolveFx={dissolveFx}
                      zoom={mapZoom}
                      /* 拖动地图（船长 2026-09-20）：**已夹取**的平移量，与缩放同一层 transform
                         （夹取按"锚点到两侧边缘的距离"分轴算 ⇒ 站在盘底也拖得到盘顶，见 `wormholeMapPanClamp`） */
                      pan={wormholeMapPanClamp(mapPan, mapZoom, wormholeMapBoxOf(grid.radius), wormholeMapAnchorOf(grid))}
                      panning={mapPanning}
                      /* 待确认的这次移动：画出直线路径；已知的拦截格才描红指名（甲案） */
                      pathPreview={
                        pendingCell
                          ? {
                              q: pendingCell.q,
                              r: pendingCell.r,
                              ...(pendingCell.intercept && pendingCell.intercept.known
                                ? { interceptKey: `${pendingCell.intercept.q},${pendingCell.intercept.r}` }
                                : {}),
                              ...(pendingCell.intercept && !pendingCell.intercept.known
                                ? { hush: true }
                                : {}),
                            }
                          : null
                      }
                    />
                  </div>
                </div>
                  <details className="app-wh-map-info">
                    <summary title={tr('ui.Wormhole.145')} aria-label={tr('ui.Wormhole.145')}><Glyph name="ico-hint" size={18} /></summary>
                  <div className="app-wh-legend">
                    {GRID_LEGEND.map((l) => (
                      <span key={l.key} className="app-wh-legend-item">
                        <svg
                          className={`app-wh-legend-glyph is-${
                            l.nebula === true ? 'nebula' : l.done === true ? 'visited' : l.none ? 'unknown' : (l.signal ?? 'blank')
                          }`}
                          viewBox="-13 -13 26 26"
                          aria-hidden="true"
                        >
                          {l.nebula === true ? (
                            <WhNebulaGlyph />
                          ) : l.none ? (
                            <polygon points="0,-12 10.39,-6 10.39,6 0,12 -10.39,6 -10.39,-6" />
                          ) : (
                            <WhGlyph signal={l.signal} />
                          )}
                          {/* 「去过」那一档把右上角小点也画上（与地图上的标记同源） */}
                          {l.done === true ? <circle className="app-wh-hex-done" cx={6.5} cy={-6.5} r={2.2} /> : null}
                        </svg>
                        {l.text}
                      </span>
                    ))}
                    {/**
                     * **地图操作说明进 ⓘ**（2026-09-17 船长：「取消滚轮缩放的 title」）——原句从地图框的
                     * `title` 一字不改搬到这里：那处 `title` 会在"悬停格子上"时被浏览器当**祖先原生提示**
                     * 弹出来，与格子自己的 `data-tip` 自绘提示同屏（一个屏幕两个提示）。图例行是地图的
                     * 常驻说明位（与"常驻说明进 ⓘ、状态读数留眼前"同款口径），搬来即不再打架。
                     */}
                    <span className="app-dim">{tr("ui.Wormhole.152")}</span>
                  </div>
                  </details>
                </div>
                <div className="app-wh-ops">
                  <div className="app-wh-ops-fixed">
                    <div className="app-wh-status">
                      <span className="app-wh-cell">{tr("ui.Wormhole.078")} <b>{run.turnsLeft}</b> / {run.turnsTotal}</span>
                      <span className="app-wh-cell">{tr("ui.CargoPage.004")} <b>{usage?.used ?? 0}</b> / {usage?.capacity ?? 0}{tr('ui.Wormhole.346')}</span>
                    </div>
                    <div className="app-wh-priority">
                    <div className="app-wh-commands">
                      <button
                        className="app-btn is-primary app-wh-scan-big"
                        disabled={!!run.battle || workBlocked !== null || run.turnsLeft < 1 || fxBusy}
                        onClick={doScan}
                        title={tr("ui.Wormhole.105")}
                      >
                        {tr("ui.Wormhole.106")}
                        <span className="app-wh-scan-sub">{tr("ui.Wormhole.035")}</span>
                      </button>
                      {workCell && canWork ? (
                        <button
                          className="app-btn is-primary app-wh-work"
                          disabled={!!run.battle || workBlocked !== null || run.turnsLeft < 1 || fxBusy}
                          onClick={doActivate}
                          title={workTitle}
                        >
                          {veinCell ? tr("ui.Wormhole.261") : tr("ui.Wormhole.107")}
                          <span className="app-wh-scan-sub">
                            {researchUnclaimed ? tr('ui.researchLab.002') : <>{tr("ui.Wormhole.036")} {Math.min(Math.max(rigs, 0), herePiles.length)}{tr('ui.Wormhole.342')}</>}
                          </span>
                        </button>
                      ) : null}
                      {!workCell && canActivate ? (
                        <button
                          className="app-btn is-primary app-wh-work"
                          disabled={!!run.battle || workBlocked !== null || fxBusy}
                          onClick={doActivate}
                          title={
                            atExit
                              ? tr("ui.Wormhole.149")
                              : tr("ui.Wormhole.150")
                          }
                        >
                          {atExit ? tr("ui.Wormhole.262") : tr("ui.Wormhole.151")}
                          <span className="app-wh-scan-sub">{tr("ui.Wormhole.037")}</span>
                        </button>
                      ) : null}
                      {/*
                        * 「继续深入」**只在站在下一层入口且守卫已清时出现**（船长 2026-09-18：「虫洞前往下一层
                        * 修改为必须在下一层入口才可以前往」）——与"作业按钮只在真能用的时候才出现"同一套做法；
                        * 核心侧 `wormholeDescend` 有同款判据（不只是界面收口）。
                        */}
                      {bossDone && atExit ? (
                        <button
                          className="app-btn is-primary app-wh-work"
                          disabled={!!run.battle || workBlocked !== null || run.turnsLeft <= 0 || fxBusy}
                          onClick={doDescend}
                          title={tr("ui.Wormhole.108")}
                        >
                          {tr("ui.Wormhole.213")}
                          <span className="app-wh-scan-sub">
                            {tr('ui.Wormhole.349', { p1: run.depth + 1 })} {tr("ui.Wormhole.109")} {wormholeDisplayThreat(wormholeLayerThreat(run.depth + 1))}
                          </span>
                        </button>
                      ) : null}
                    </div>
                    {renderExploreConfirmations()}
                    </div>
                  </div>
                  <div className="app-wh-details">
                    <div className="app-wh-node">{renderHereNode()}</div>
                  {/**
                   * 撤离进行中的一行读数：`extracting` = 已发起撤离、等待收口（2026-09-15 起撤离不再触发
                   * 战斗；**2026-09-27 起点撤离当拍结算** ⇒ 正常路径一闪而过，本条只兜老档／离线）。
                   * 原来的「拦截舰队正在围堵你」警示条退场。
                   */}
                  {run.phase === 'extracting' && !run.battle ? (
                    <div className="app-wh-ask">{tr("ui.Wormhole.153")}</div>
                  ) : null}
                  {/**
                   * **动作闸提示**（船长 2026-09-14：「临时空间内有物品就不允许进行其他操作，
                   * 和之前的超载类似」）：两条理由共用这一条警示条 —— 临时空间待处理 / 货仓超载。
                   */}
                  {/**
                   * **动作闸的理由行**：`actionBlocked`（临时空间 / 超载，带"去货仓页"按钮）优先；
                   * 只有"欠着一场战斗"时也照样摆出来（**2026-09-20**：该条不挡撤离 ⇒ 不给货仓按钮，
                   * 玩家照着读「先点「迎战」打完这一场」即可）。
                   */}
                  {actionBlocked !== null ? (
                    <div className="app-wh-hold-overload">
                      <span>{actionBlocked}</span>
                      <button className="app-btn is-small" onClick={() => setTab('bag')}>
                        {tr("ui.Wormhole.110")}
                      </button>
                    </div>
                  ) : layerBlocked !== null ? (
                    <div className="app-wh-hold-overload">
                      <span>{cmdText(layerBlocked)}</span>
                    </div>
                  ) : null}
                  {(run.relics ?? []).length > 0 ? (
                    <div className="app-dim app-note">
                      {tr("ui.Wormhole.263")}
                      {(run.relics ?? [])
                        .map(
                          (id) =>
                            ctx.modules.get(id)?.name ??
                            ctx.blueprints.get(id)?.name ??
                            ctx.shipBlueprints.get(id)?.name ??
                            id,
                        )
                        .join(tr("ui.MatterTechTab.017"))}
                    </div>
                  ) : null}
                  {bossDone ? (
                    <div className="app-dim app-note">
                      {tr("ui.Wormhole.154")}
                    </div>
                  ) : null}
                  {outOfTurns ? (
                    <div className="app-wh-ask">{tr("ui.Wormhole.111")}</div>
                  ) : null}
                  </div>
                </div>
              </div>
              ) : (
                <div className="app-wh-node">
                  <div className="app-wh-node-title">{tr("ui.Wormhole.155")}</div>
                  <div className="app-dim app-note">
                    {tr("ui.Wormhole.264")}
                  </div>
                  <div className="app-wh-actions">
                    <button
                      className="app-btn is-small"
                      disabled={!!run.battle || actionBlocked !== null}
                      onClick={doExtract}
                    >
                      {tr("ui.Handbook.163")}
                    </button>
                    <button
                      className="app-btn is-small is-primary"
                      disabled={!!run.battle || run.turnsLeft <= 0 || !bossDone}
                      onClick={doDescend}
                    >
                      {tr("ui.Wormhole.213")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {!settle && tab === 'bag' && run ? (
            <WhHold
        engine={engine}
        onToast={onToast}
        tempAsk={tempAsk}
        setTempAsk={setTempAsk}
        onTempDiscard={tempDiscardAndContinue}
        onTempStow={tempStowAndContinue}
      />
          ) : null}
        </div>
      </div>
      {/**
       * **主控交接确认**（船长 2026-09-14：「如果选择了主控船，就将主控换到其他船上」＋
       * 选定「自动挑一条，弹窗写明是谁」）：队里有主控 ⇒ 点「派队自动探索」先弹这一层，
       * 写明**主控从谁换到谁**；确认后才真的派（换船在 core 里走 `changeShip`）。
       */}
      {mainAsk && auto ? (
        <div className="app-modal-mask" onClick={() => { autoRequest.current?.abort(); setMainAsk(false) }}>
          <div className="app-modal" onClick={(e) => e.stopPropagation()}>
            <div className="app-modal-head">
              <span className="app-report-title">{tr("ui.Wormhole.112")}{autoHandover?.toName ?? tr("ui.Wormhole.113")}{tr("ui.Wormhole.038")}</span>
              <button className="app-btn is-small" onClick={() => { autoRequest.current?.abort(); setMainAsk(false) }}>
                {tr("ui.App.086")}
              </button>
            </div>
            <div className="app-modal-body">
              <div className="app-dim">
                {tr("ui.Wormhole.265")}{shipDisplayName(state, ctx, state.shipId)}{tr("ui.Wormhole.039")}<b>{tr("ui.Wormhole.040")}
                {autoHandover?.toName ?? tr("ui.Wormhole.114")}{tr('ui.Wormhole.364')}</b>{tr('ui.Wormhole.357')}{' '}
                {Math.round(WORMHOLE_AUTO_DURATION_MS / 60_000)} {tr("ui.Wormhole.115")}{' '}
                {tr('ui.Wormhole.358')}
              </div>
              {autoGate !== null ? <div className="app-warn app-wh-gate">{cmdText(autoGate)}</div> : null}
              <div className="app-wh-scanbar-actions" style={{ marginTop: 'var(--wui-sp-10)' }}>
                <button className="app-btn is-primary is-small" onClick={startAuto} disabled={autoComputing || autoGate !== null} aria-busy={autoComputing || undefined}>
                  {tr("ui.Wormhole.214")}
                </button>
                <button className="app-btn is-small" onClick={() => { autoRequest.current?.abort(); setMainAsk(false) }}>
                  {tr("ui.Wormhole.041")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

const CORE_LABEL: Readonly<Record<'gamma' | 'beta' | 'alpha', string>> = { get gamma() { return tr("ui.Wormhole.042") }, get beta() { return tr("ui.Wormhole.215") }, get alpha() { return tr("ui.Wormhole.266") } }

function SettleView({ settle, onConfirm }: { settle: WormholeSettleRecord; onConfirm: () => void }) {
  const total = useCountUp(settle.oreIsk + settle.wreckIsk)
  const cells: Array<{ label: string; value: string; sub: string; wide?: boolean }> = [
    { label: tr("ui.Wormhole.187"), value: n(settle.oreUnits), sub: tr("ui.Wormhole.116", { p1: n(settle.oreIsk) }) },
    { label: tr("ui.Wormhole.156"), value: n(settle.wreckIsk), sub: tr("ui.FirstTasks.003") },
    { label: tr("ui.MarketPage.006"), value: String(settle.boxes.length), sub: tr("ui.Wormhole.043") },
    { label: tr("ui.Wormhole.267"), value: String(settle.relics.length), sub: tr("ui.Wormhole.044") },
    ...(settle.cores && Object.keys(settle.cores).length > 0
      ? [
          {
            label: tr("ui.Wormhole.027"),
            value: String((settle.cores.gamma ?? 0) + (settle.cores.beta ?? 0) + (settle.cores.alpha ?? 0)),
            sub:
              tr('ui.Wormhole.374') +
              (['alpha', 'beta', 'gamma'] as const)
                .filter((t) => (settle.cores?.[t] ?? 0) > 0)
                .map((t) => `${CORE_LABEL[t]}×${settle.cores?.[t]}`)
                .join(' · ') +
              (settle.coresIsk && settle.coresIsk > 0 ? tr('ui.Wormhole.321', { p1: n(settle.coresIsk) }) : '') +
              '）',
            wide: true,
          },
        ]
      : []),
    ...(settle.essences && settle.essences > 0
      ? [
          {
            label: tr("ui.MatterTechTab.005"),
            value: n(settle.essences),
            sub:
              tr('ui.Wormhole.322') +
              (settle.essenceIsk && settle.essenceIsk > 0 ? tr('ui.Wormhole.321', { p1: n(settle.essenceIsk) }) : ''),
            wide: true,
          },
        ]
      : []),
  ]
  const STEP = 90
  return (
    <div className="app-wh-settle">
      <div className="app-wh-settle-head is-pop">
        <span className={`app-wh-settle-kind${settle.kind === 'extract' ? ' is-good' : ' is-bad'}`}>
          {settle.kind === 'extract' ? tr("ui.Wormhole.157") : tr("ui.Wormhole.158")}
        </span>
        <span className="app-dim">
          {tr('ui.Wormhole.349', { p1: settle.depth })} {tr("ui.Wormhole.117")}{' '}
          {settle.kind === 'lost'
            ? tr("ui.Wormhole.216")
            : settle.skippedExtractBattle === true
              ? // 老档的结算单会带这个标记（旧口径「第 1 层免撤离战」）——照旧读得懂
                tr("ui.Wormhole.217")
              : // 现行口径（2026-09-15 起）：撤离一律不触发战斗，老档里打赢过撤离战的也归到这一句
                tr("ui.Wormhole.118")}
        </span>
      </div>
      <div className="app-wh-settle-grid">
        {cells.map((c, i) => (
          <div
            key={c.label}
            className={`app-wh-settle-cell is-pop${c.wide ? ' is-wide' : ''}`}
            style={{ animationDelay: `${(i + 1) * STEP}ms` }}
          >
            <span className="app-dim">{c.label}</span>
            <b>{c.value}</b>
            <span className="app-dim">{c.sub}</span>
          </div>
        ))}
      </div>
      <div className="app-wh-settle-total is-pop" style={{ animationDelay: `${(cells.length + 1) * STEP}ms` }}>
        {tr("ui.Wormhole.159")} <b>{n(total)}</b> {tr("ui.FirstTasks.003")}
        {settle.boxes.length > 0 ? tr('ui.Wormhole.323', { p1: settle.boxes.length }) : ''}
      </div>
      {settle.shipsLost.length > 0 ? (
        <div className="app-wh-settle-loss is-pop" style={{ animationDelay: `${(cells.length + 2) * STEP}ms` }}>
          {tr("ui.Wormhole.160")}{settle.shipsLost.join(tr("ui.MatterTechTab.017"))}{tr("ui.Wormhole.268")} {settle.shipsLost.length} {tr("ui.Wormhole.218")}
        </div>
      ) : null}
      {settle.lostIsk > 0 ? (
        <div className="app-wh-settle-loss is-pop" style={{ animationDelay: `${(cells.length + 3) * STEP}ms` }}>
          {tr("ui.Wormhole.161")} {n(settle.lostIsk)} {tr("ui.Wormhole.045")}
        </div>
      ) : null}
      <div className="app-wh-actions app-wh-settle-actions">
        <button className="app-btn is-primary app-wh-settle-ok" onClick={onConfirm}>
          {tr("ui.Wormhole.219")}
        </button>
      </div>
    </div>
  )
}

function WhGridMap({
  grid,
  onPickCell,
  shipDefId,
  layerKey,
  fx = 'idle',
  scanFx = null,
  dissolveFx = null,
  zoom = 1,
  pan = { x: 0, y: 0 },
  panning = false,
  pathPreview = null,
}: {
  grid: WormholeGridState
  onPickCell: (q: number, r: number) => void
  shipDefId?: string
  layerKey: string
  fx?: 'idle' | 'out' | 'in'
  scanFx?: { keys: string[]; rings: number; nonce: number } | null
  dissolveFx?: { keys: string[]; nonce: number } | null
  zoom?: number
  pan?: { x: number; y: number }
  panning?: boolean
  pathPreview?: { q: number; r: number; interceptKey?: string; hush?: boolean } | null
}) {
  const size = WORMHOLE_MAP_CELL_PX
  const R = Math.max(1, Math.floor(grid.radius))
  const { w, h } = wormholeMapBoxOf(R)
  const cx = w / 2
  const cy = h / 2
  const corners = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30)
    return { dx: Math.cos(a) * size, dy: Math.sin(a) * size }
  })
  const hereKey = `${grid.pos.q},${grid.pos.r}`
  const exitKey = `${grid.exit.q},${grid.exit.r}`
  const { x: hereX, y: hereY } = wormholeMapAnchorOf(grid)
  const pathPoints = pathPreview
    ? hexLine(grid.pos, { q: pathPreview.q, r: pathPreview.r })
        .map(
          (c) =>
            `${(cx + Math.sqrt(3) * size * (c.q + c.r / 2)).toFixed(2)},${(cy + 1.5 * size * c.r).toFixed(2)}`,
        )
        .join(' ')
    : null
  const freshAt = new Map<string, number>()
  for (const k of scanFx?.keys ?? []) {
    const c = grid.cells.find((x) => x.key === k)
    if (!c) continue
    freshAt.set(k, hexRingOf(c.q - grid.pos.q, c.r - grid.pos.r) * 60)
  }
  const dissolving = new Set(dissolveFx?.keys ?? [])
  const dissolveAt = new Map<string, number>()
  for (const k of dissolveFx?.keys ?? []) {
    const c = grid.cells.find((x) => x.key === k)
    if (!c) continue
    dissolveAt.set(k, hexRingOf(c.q - grid.pos.q, c.r - grid.pos.r) * 60)
  }
  return (
    <svg
      className="app-wh-map"
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={tr("ui.Wormhole.220", { p1: grid.radius })}
    >
      {/* 舰影底下的柔光（氛围光效；SVG 渐变，不是 CSS 拼形状） */}
      <defs>
        <radialGradient id="app-wh-ship-glow">
          <stop offset="0%" stopColor="rgba(79,216,196,0.30)" />
          <stop offset="55%" stopColor="rgba(79,216,196,0.10)" />
          <stop offset="100%" stopColor="rgba(79,216,196,0)" />
        </radialGradient>
      </defs>
      {/**
       * **缩放层**（船长 2026-09-13：左侧缩放按钮调节地图大小）：**以玩家所在格为锚点**放大/缩小 ——
       * 换算：中心为原点 `origin`、平移 `-(k-1)·(玩家 - 中心)` ⇒ 玩家那一格在屏幕上**原地不动**、
       * 四周围着它长开（放大后自己的位置永远不丢）。超出的部分由地图框裁掉。
       * **拖动地图**（船长 2026-09-20）叠在同一层：`pan` 是已夹取的平移量 ⇒ 拖动的是整张盘；
       * 拖动中加 `is-panning` 把过渡关掉（否则每帧追动画，手感发飘）。
       */}
      <g
        className={`app-wh-zoomlayer${panning ? ' is-panning' : ''}`}
        style={{
          transformOrigin: `${cx.toFixed(1)}px ${cy.toFixed(1)}px`,
          transform: `translate(${(pan.x - (zoom - 1) * (hereX - cx)).toFixed(1)}px, ${(pan.y - (zoom - 1) * (hereY - cy)).toFixed(1)}px) scale(${zoom})`,
        }}
      >
      {/**
       * **路径预览线**（船长 2026-09-16）：画在**所有格子之下**（格子照旧压在线上，不挡图标/舰影）。
       * `is-blocked` = 拦截格还没扫描（甲案：不指名那一格，只把整条线置为警示色）。
       */}
      {pathPoints ? (
        <polyline
          className={`app-wh-path${pathPreview?.hush === true ? ' is-blocked' : ''}`}
          points={pathPoints}
        />
      ) : null}
      {grid.cells.map((c) => {
        const x = cx + Math.sqrt(3) * size * (c.q + c.r / 2)
        const y = cy + 1.5 * size * c.r
        const visited = grid.visited.includes(c.key)
        const scanned = grid.scanned.includes(c.key)
        /**
         * ⚠ **信息档一律走 core 的 `revealOf`**（2026-09-13 星云批改的）。
         *
         * 改之前这里直接读 `c.place` 上色（`signalOfPlace(c.place)`）⇒ 那是**真相**：
         * 星云遮蔽接进来后，照旧上色就等于"云没遮住任何东西"（边框颜色把被遮的信号漏出去）。
         * 现在四档同源：`unknown` / `signal`（含"无信号 = 空地点"）/ **`nebula`** / `known`。
         */
        const rev = revealOf(grid, { q: c.q, r: c.r })
        /**
         * **围剿者格**（**2026-09-24 船长令**：「**改为照常显示下方地点信号，族徽位置移动到右上角
         * 探索过的小点处**」）：中心那一格**照常**按原遮蔽规则画——`rev.under` = 撇开围剿者本来会
         * 揭示成什么（未扫描 ⇒ 什么都不画 · 星云未驱散 ⇒ 只画云 · 扫开/去过 ⇒ 画真实地点信号）；
         * 族徽挪去**右上角**占"去过小点"的位置（`foeKey`；「未扫描也看得到」那条口径不变）。
         */
        const under = rev.kind === 'foe' ? rev.under : rev
        const known = under.kind === 'known' || under.kind === 'signal' || under.kind === 'nebula'
        /**
         * **围剿者**（2026-09-23 船长新机制：「用敌族族徽做图标覆盖该格子」）：`revealOf` 已把它提到
         * 最高优先（盖过星云与「没扫过」）；这里按**格上那张卡**反查族 ⇒ 徽与色都取该族
         * （一处虫洞锁一族，全盘同徽；`FOE_ACCENT` 与星图族标签/战场敌舰同源）。
         */
        const foeKey =
          rev.kind === 'foe' && c.foe
            ? (Object.keys(WORMHOLE_FAMILY_CARDS).find((f) =>
                Object.values(WORMHOLE_FAMILY_CARDS[f as keyof typeof WORMHOLE_FAMILY_CARDS]).includes(c.foe!.card),
              ) ?? 'A')
            : null
        const nebula = under.kind === 'nebula'
        const signal = under.kind === 'signal' ? under.signal : under.kind === 'known' ? under.signal : null
        // 入口：**到达过**或**被漂浮信标标出来**（船长 2026-09-13 新增信标）⇒ 地图上一直标着
        const isExit = c.key === exitKey && (visited || grid.exitKnown === true)
        /**
         * **清空 / 已激活的地点：删掉地点图标；还有残留东西的：变暗**（船长 2026-09-13）。
         *
         * 判定：
         * - `activated` = 这一格的事已经做完了（舰船信号打完 / 信标读过 / 打捞·采集捞空 / 入口守卫清掉）；
         * - 去过且**堆已空**也算做完（可能没打标：比如只走过一遭的空地点）；
         * - `hasLeftover`（堆非空）= 还有东西没拿 ⇒ **图标留着**，但整格压暗（提示"来过、没拿完"）。
         * ⚠ **下一层入口（`isExit`）不吃这条**：它是导航标记不是地点图标，玩家还要靠它认路。
         */
        const activated = grid.activated.includes(c.key)
        const hasLeftover = (c.piles ?? []).length > 0
        const cleared = activated || (visited && !hasLeftover && c.place !== 'research')
        const iconGone = cleared && !isExit
        const dim = visited && (cleared || hasLeftover)
        /** 这一格是不是"这一批刚被驱散"的星云（动画期间单独画云散开；动画结束 `dissolving` 清空 ⇒ 自动落回信号档） */
        const dissolvingNow = dissolving.has(c.key)
        const cls = [
          'app-wh-hex',
          visited ? 'is-known' : scanned ? 'is-scanned' : 'is-unknown',
          visited ? 'is-visited' : '',
          dim ? 'is-visited-dim' : '',
          iconGone ? 'is-cleared' : '',
          hasLeftover ? 'is-leftover' : '',
          /**
           * ⚠ **信号分色只给"已扫描/已到达"且没被星云遮住的格**（船长 F5：「目前未扫描的地点可以通过
           * 边框颜色判断」）：未扫描的格一律走 `.is-unknown` 的**蓝灰虚线边框**；
           * 被星云遮住的格走 `.is-nebula`（**不按信号上色**，否则边框颜色就把被遮的信号漏出去了）。
           */
          known ? (nebula ? 'is-nebula' : signal ? `is-${signal}` : 'is-blank') : '',
          /**
           * **拦截格描红**（船长 2026-09-16 路径拦截 · §5.2 甲案）：**只在那一格已知时**才指名
           * （`interceptKey` 由面板仅在"已扫描/已到过"时传入）；未扫描的拦截格**不给类**，
           * 避免"边框颜色把未扫描格的内容漏出去"（2026-09-13 那条修漏口径继续有效）。
           */
          pathPreview?.interceptKey === c.key ? 'is-intercept' : '',
          c.key === hereKey ? 'is-here' : '',
          isExit ? 'is-exit' : '',
          freshAt.has(c.key) ? 'is-just-scanned' : '',
          /** 消散动画：这一帧画"云散开"（图层在上、与信号档不冲突；700ms 后自动摘掉） */
          dissolvingNow ? 'is-dissolving' : '',
        ]
          .filter((s) => s.length > 0)
          .join(' ')
        /**
         * **围剿者格优先**（2026-09-23 船长：「用敌族族徽做图标覆盖该格子」）：
         * 地图上画的是族徽（盖过星云与"没扫过"），悬停说明必须说同一件事——
         * 否则这一格会落到最后一档、读成「没有信号：空信息地点」。
         */
        const title =
          foeKey !== null
            ? tr('ui.Wormhole.378', { p1: FOE_FAMILY_LABEL[foeKey] ?? foeKey })
            : !known
              ? tr("ui.Wormhole.162")
              : isExit
                ? tr('ui.Wormhole.324', { p1: cleared ? tr("ui.Wormhole.269") : tr("ui.Wormhole.270") })
                : visited
                  ? tr('ui.Wormhole.325', { p1: placeText(c.place), p2: cleared ? tr('ui.Wormhole.303') : '' }) +
                    `${hasLeftover ? ` · 还有 ${(c.piles ?? []).length} 堆没拿` : ''}`
                  : nebula
                    ? tr("ui.Wormhole.163")
                    : signal
                      ? tr("ui.Wormhole.046", { p1: SIGNAL_TEXT[signal] })
                      : tr("ui.Wormhole.164")
        return (
          <g
            key={c.key}
            className={cls}
            onClick={() => onPickCell(c.q, c.r)}
            // 格子说明：SVG 元素用 **`data-tip`**（React 的 SVG 类型不接受 `title` 属性；SVG 的
            // `<title>` 子元素则会被浏览器弹**系统默认**提示）——由全局接管层 `ui/Tooltip.tsx` 接管
            data-tip={title}
            style={
              dissolvingNow && dissolveAt.has(c.key)
                ? { animationDelay: `${dissolveAt.get(c.key)}ms` }
                : freshAt.has(c.key)
                  ? { animationDelay: `${freshAt.get(c.key)}ms` }
                  : undefined
            }
          >
            <polygon points={corners.map((p) => `${(x + p.dx).toFixed(2)},${(y + p.dy).toFixed(2)}`).join(' ')} />
            {known && !iconGone ? (
              <g className="app-wh-hex-glyph" transform={`translate(${x.toFixed(2)},${y.toFixed(2)})`}>
                {nebula ? <WhNebulaGlyph /> : <WhGlyph signal={signal} exit={isExit} />}
              </g>
            ) : null}
            {/**
             * **星云消散**（船长 2026-09-13：「当消除星云时，给星云添加个消散的动画」）：
             * 单独补一层云团线稿——**同一个 ≤2px 的云徽由 1.0 外扩到 2.1 并淡出**
             * （外扩读作"散开"、淡出读作"没了"；与 `app-wh-scan-wave` 一样用 `transform`/`opacity`，
             * 走合成层、不重排）。数据在点下那一刻就已经进 `grid.dispersed`，这一层只是"让消失看得见"。
             */}
            {dissolvingNow ? (
              <g
                className="app-wh-nebula-dissolve"
                transform={`translate(${x.toFixed(2)},${y.toFixed(2)})`}
                pointerEvents="none"
              >
                <WhNebulaGlyph />
              </g>
            ) : null}
            {/**
             * **右上角角标**（同一处只画一个，**2026-09-24 船长令**）：
             * - 压着围剿者 ⇒ **敌族族徽**（「族徽位置移动到右上角探索过的小点处」；锚点就是"去过小点"
             *   那一片角，且一直看得见——不被星云或"没扫过"吃掉）；
             * - 否则去过 ⇒ **小实心点**（2026-09-13 船长定的"去过"标记，位置与尺寸一寸不动）。
             * ⚠ 族徽锚点要把 `Glyph` 那张 24×24 画布**居中**摆过去（各减半个边长）——`<svg>` 的原点在
             *   左上角，不补这一下整枚徽会往右下偏半格。
             */}
            {foeKey !== null ? (
              <g
                transform={`translate(${(x + size * WORMHOLE_FOE_MARK_AT - WORMHOLE_FOE_MARK_PX / 2).toFixed(2)},${(
                  y -
                  size * WORMHOLE_FOE_MARK_AT -
                  WORMHOLE_FOE_MARK_PX / 2
                ).toFixed(2)})`}
              >
                <Glyph
                  name={`fam-${foeKey.toLowerCase()}`}
                  size={WORMHOLE_FOE_MARK_PX}
                  color={FOE_ACCENT[foeKey] ?? FOE_ACCENT.A}
                />
              </g>
            ) : visited ? (
              <circle className="app-wh-hex-done" cx={x + size * 0.52} cy={y - size * 0.5} r={2.2} />
            ) : null}
          </g>
        )
      })}
      {/**
       * **扫描波**（船长 2026-09-13 拍板方案甲）：从玩家所在格向外扩散一圈**线稿圆环**
       * （SVG `circle` + CSS 动画 `r`/`opacity`，不拼形状），半径 = 扫描圈数 + 半格余量；
       * `key` 带序号 ⇒ 连点也能重播。
       */}
      {scanFx ? (
        <circle
          key={`scan-${scanFx.nonce}`}
          className="app-wh-scan-wave"
          cx={hereX.toFixed(2)}
          cy={hereY.toFixed(2)}
          r={0}
          style={{ ['--wh-wave-r' as string]: `${((scanFx.rings + 0.45) * Math.sqrt(3) * size).toFixed(1)}px` }}
        />
      ) : null}
      {/**
       * **玩家舰影**（船长 2026-09-13：「当前玩家停留的格子，用玩家舰船队伍里第一艘船的 SVG 图形覆盖表示」）：
       * 单独挂在格子之上（不进上面那圈 `<g>`，免得被格子的透明度/点击态牵连）；
       * `transform` 用**内联 style** 写 ⇒ 换格时由 CSS 过渡**平移过去**（移动动画）；
       * 换层时 `key` 变 ⇒ 重新挂载，重播一次**从地图外飞入**（船长：入场 1 秒 / 深入时先飞出屏幕外）。
       */}
      <g
        key={`player-${layerKey}`}
        className={`app-wh-ship-here${fx === 'in' ? ' is-entering' : fx === 'out' ? ' is-leaving' : ''}`}
        style={{
          transform: `translate(${hereX.toFixed(2)}px, ${hereY.toFixed(2)}px)`,
          // 关键帧里要还原"落点"，故把落点与两个出画偏移都写成变量（纯表现，判定不用）
          ['--wh-x' as string]: `${hereX.toFixed(1)}px`,
          ['--wh-y' as string]: `${hereY.toFixed(1)}px`,
          // 飞入起点 = 地图左侧外 · 飞出终点 = 地图右侧外（一眼能看出"从外面来 / 往外面走"）
          ['--wh-fly-in' as string]: `${(-hereX - size * 3).toFixed(1)}px`,
          ['--wh-fly-out' as string]: `${(w - hereX + size * 3).toFixed(1)}px`,
          ['--wh-fly-ms' as string]: `${fx === 'out' ? WORMHOLE_FX_OUT_MS : WORMHOLE_FX_IN_MS}ms`,
        }}
      >
        <circle className="app-wh-ship-halo" r={size * 0.62} fill="url(#app-wh-ship-glow)" />
        {shipDefId ? (
          <ShipSpriteShape shipId={shipDefId} size={size * 1.15} />
        ) : (
          <path className="app-wh-ship-fallback" d="M-6,-4 L7,0 L-6,4 Z" />
        )}
      </g>
      </g>
    </svg>
  )
}



const SIGNAL_TEXT: Readonly<Record<WormholeSignal, string>> = {
  get wreck() { return tr("ui.Wormhole.165") },
  get research() { return tr('ui.researchLab.004') },
  get ship() { return tr("ui.Wormhole.221") },
  get resource() { return tr("ui.Wormhole.222") },
  get radar() { return tr("ui.Wormhole.271") },
  get beacon() { return tr("ui.Wormhole.047") },
}

const GRID_LEGEND: ReadonlyArray<{
  key: string
  text: string
  signal: WormholeSignal | null
  none?: boolean
  done?: boolean
  nebula?: boolean
}> = [
  { key: 'unknown', get text() { return tr("ui.Wormhole.166") }, signal: null, none: true },
  { key: 'nebula', get text() { return tr("ui.Wormhole.167") }, signal: null, none: true, nebula: true },
  { key: 'visited', get text() { return tr("ui.Wormhole.119") }, signal: null, none: true, done: true },
  { key: 'wreck', get text() { return SIGNAL_TEXT.wreck }, signal: 'wreck' },
  { key: 'research', get text() { return SIGNAL_TEXT.research }, signal: 'research' },
  { key: 'ship', get text() { return SIGNAL_TEXT.ship }, signal: 'ship' },
  { key: 'resource', get text() { return SIGNAL_TEXT.resource }, signal: 'resource' },
  { key: 'radar', get text() { return SIGNAL_TEXT.radar }, signal: 'radar' },
  { key: 'beacon', get text() { return SIGNAL_TEXT.beacon }, signal: 'beacon' },
  { key: 'blank', get text() { return tr("ui.Wormhole.223") }, signal: null },
]

const PLACE_NOTE: Readonly<Record<WormholePlace, string>> = {
  get empty() { return tr("ui.Wormhole.224") },
  get graveyard() { return tr("ui.Wormhole.225") },
  get ruins() { return tr("ui.Wormhole.272") },
  get research() { return tr('ui.researchLab.002') },
  get ship() { return tr("ui.Wormhole.226") },
  get vein() { return tr("ui.Wormhole.168") },
  get matter() { return tr("ui.Wormhole.227") },
  get beacon() { return tr("ui.Wormhole.169") },
}

function WhHold({
  engine,
  onToast,
  tempAsk,
  setTempAsk,
  onTempDiscard,
  onTempStow,
}: {
  engine: GameEngine
  onToast: ToastFn
  tempAsk: null | 'tab' | 'extract'
  setTempAsk: (v: null | 'tab' | 'extract') => void
  onTempDiscard: () => void
  onTempStow: () => void
}) {
  const state = engine.state
  const ctx = engine.ctx
  const run = state.wormhole.run!
  const info = engine.wormholeHoldInfo()
  const tempInfo = engine.wormholeTempInfo()
const [askDiscard, setAskDiscard] = useState<string | null>(null)
  const [discardAsk, setDiscardAsk] = useState<{ id: string; units: number } | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragFrom, setDragFrom] = useState<BoardKind>('hold')
  const tempPending = tempInfo.placements
  const grabRef = useRef({ dx: 0, dy: 0 })
  const touchDragRef = useRef<{ id: number; itemId: string; from: BoardKind; sx: number; sy: number; moved: boolean } | null>(null)
  const [touchHover, setTouchHover] = useState<{ kind: BoardKind; x: number; y: number } | null>(null)
  const [touchDragging, setTouchDragging] = useState(false)
  const holdDragAteClickRef = useRef(false)
  const cols = WORMHOLE_HOLD_COLS
  const holdBoard = run.hold ?? makeHoldState()
  const tempBoard = run.tempGrid ?? makeHoldState(WORMHOLE_TEMP_COLS)
  const noCommonWreck = engine.noCommonWreckSalvageOn()
  const placements = run.hold?.placements ?? []
  const rows = Math.max(
    holdRows(info.capacity, cols),
    placements.reduce((m, p) => Math.max(m, p.y + p.h), 0),
  )
  const boxes = placements.filter((p) => p.kind === 'box').length
  const cargoPieces = placements
    .filter((p) => p.kind === 'cargo')
    .sort((a, b) => a.itemId.localeCompare(b.itemId) || a.y - b.y || a.x - b.x)

  const ownerOf = new Map<string, (typeof placements)[number]>()
  for (const p of placements) {
    for (const c of placementCells(p)) ownerOf.set(`${c.x},${c.y}`, p)
  }

  function dropAt(kind: BoardKind, x: number, y: number, src?: { id: string; from: BoardKind }): void {
    const id = src?.id ?? dragId
    if (!id) return
    const from = src?.from ?? dragFrom
    const target = ownerMap(kind).get(`${x},${y}`)
    if (target && target.id !== id) {
      const r = engine.wormholeHoldSwap(id, target.id)
      if (!r.ok) onToast(cmdText(r) || tr('ui.Wormhole.326'), true)
      setDragId(null)
      setTouchDragging(false)
      return
    }
    const r =
      from === kind
        ? engine.wormholeHoldDropAt(id, x, y, grabRef.current)
        : engine.wormholeBoardTransfer(from, kind, id, x, y, grabRef.current)
    if (!r.ok) onToast(cmdText(r) || tr('ui.Wormhole.327'), true)
    setDragId(null)
    setTouchDragging(false)
  }


  function cellUnderPoint(clientX: number, clientY: number): { kind: BoardKind; x: number; y: number } | null {
    const el = document.elementFromPoint(clientX, clientY)
    if (el === null) return null
    const hit = (el.closest('[data-wh-cell]') ?? el.closest('[data-wh-fig]')) as HTMLElement | null
    if (hit === null) return null
    const kind = (hit.dataset.whCell ?? hit.dataset.whFig) as BoardKind | undefined
    const x = Number(hit.dataset.whX)
    const y = Number(hit.dataset.whY)
    if (kind === undefined || !Number.isFinite(x) || !Number.isFinite(y)) return null
    return { kind, x, y }
  }

  function isTouchHover(kind: BoardKind, x: number, y: number): boolean {
    return touchHover !== null && touchHover.kind === kind && touchHover.x === x && touchHover.y === y
  }

  function touchDragDown(kind: BoardKind, p: WormholeHoldPlacement, e: React.PointerEvent): void {
    if (e.pointerType === 'mouse') return
    grabRef.current = grabOffsetOf(e.currentTarget as HTMLElement, p.w, p.h, e.clientX, e.clientY)
    touchDragRef.current = { id: e.pointerId, itemId: p.id, from: kind, sx: e.clientX, sy: e.clientY, moved: false }
  }

  function touchDragMove(e: React.PointerEvent): void {
    const d = touchDragRef.current
    if (d === null || d.id !== e.pointerId) return
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < WORMHOLE_MAP_DRAG_THRESHOLD_PX) return
      d.moved = true
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
      }
      setDragId(d.itemId)
      setDragFrom(d.from)
      setTouchDragging(true)
    }
    const hit = cellUnderPoint(e.clientX, e.clientY)
    setTouchHover((prev) => (prev?.kind === hit?.kind && prev?.x === hit?.x && prev?.y === hit?.y ? prev : hit))
  }

  function touchDragUp(e: React.PointerEvent): void {
    const d = touchDragRef.current
    if (d === null || d.id !== e.pointerId) return
    touchDragRef.current = null
    setTouchHover(null)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (!d.moved) return
    holdDragAteClickRef.current = true
    const hit = cellUnderPoint(e.clientX, e.clientY)
    if (hit !== null) dropAt(hit.kind, hit.x, hit.y, { id: d.itemId, from: d.from })
    else {
      setDragId(null)
      setTouchDragging(false)
    }
  }

  function touchDragCancel(): void {
    const d = touchDragRef.current
    touchDragRef.current = null
    setTouchHover(null)
    if (d?.moved === true) {
      setDragId(null)
      setTouchDragging(false)
    }
  }

  function ownerMap(kind: BoardKind): Map<string, WormholeHoldPlacement> {
    const board = kind === 'hold' ? run.hold : run.tempGrid
    const out = new Map<string, WormholeHoldPlacement>()
    for (const p of board?.placements ?? []) for (const c of placementCells(p)) out.set(`${c.x},${c.y}`, p)
    return out
  }

  function boardView(
    kind: BoardKind,
    board: WormholeHoldState,
    capacity: number,
    boardCols: number,
    boardRows: number,
    lockedTitle: string,
  ): JSX.Element {
    const owner = ownerMap(kind)
    return (
      <div
        className={`app-wh-hold-grid is-${kind}`}
        style={{
          gridTemplateColumns: `repeat(${boardCols}, 1fr)`,
          gridTemplateRows: `repeat(${boardRows}, auto)`,
        }}
      >
        {Array.from({ length: boardRows * boardCols }, (_, i) => {
          const x = i % boardCols
          const y = Math.floor(i / boardCols)
          const key = `${kind}-${x},${y}`
          const locked = i >= capacity
          const p = owner.get(`${x},${y}`)
          const isOrigin = p !== undefined && p.x === x && p.y === y
          const def = p ? ctx.items.get(p.itemId) : undefined
          const cls = [
            'app-wh-hold-cell',
            locked ? 'is-locked' : '',
            p ? (p.kind === 'cargo' ? 'is-cargo' : 'is-box') : locked ? '' : 'is-free',
            isOrigin ? 'is-origin' : p ? 'is-body' : '',
            p && p.kind === 'cargo' && !isOrigin ? 'is-cargobody' : '',
            dragId !== null && isOrigin ? 'is-dragging' : '',
          ]
            .filter((s) => s.length > 0)
            .join(' ')
          return (
            <div
              key={key}
              className={`${cls}${isTouchHover(kind, x, y) ? ' is-touch-hover' : ''}`}
              data-wh-cell={kind}
              data-wh-x={x}
              data-wh-y={y}
              title={
                locked
                  ? lockedTitle
                  : p
                    ? p.kind === 'cargo'
                      ? tr("ui.Wormhole.048", { p1: def?.name ?? p.itemId, p2: n(p.units ?? 0), p3: p.w, p4: p.h })
                      : tr("ui.Wormhole.049", { p1: def?.name ?? p.itemId, p2: p.w, p3: p.h })
                    : kind === 'hold'
                      ? tr("ui.Wormhole.228")
                      : tr("ui.Wormhole.229")
              }
              draggable={isOrigin}
              onPointerDown={(e) => {
                holdDragAteClickRef.current = false
                if (isOrigin && p) {
                  grabRef.current = grabOffsetOf(e.currentTarget as HTMLElement, p.w, p.h, e.clientX, e.clientY)
                  touchDragDown(kind, p, e)
                }
              }}
              onPointerMove={touchDragMove}
              onPointerUp={touchDragUp}
              onPointerCancel={touchDragCancel}
              onDragStart={() => {
                if (isOrigin) {
                  setDragId(p!.id)
                  setDragFrom(kind)
                }
              }}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => {
                if (dragId) e.preventDefault()
              }}
              onDrop={(e) => {
                e.preventDefault()
                dropAt(kind, x, y)
              }}
              onClick={() => {
                if (holdDragAteClickRef.current) return
                if (isOrigin) {
                  // 点一下选中/取消（选中后再点空格也能落位，照顾不方便拖的场景）
                  setDragFrom(kind)
                  setDragId((prev) => (prev === p!.id ? null : p!.id))
                } else if (dragId) {
                  dropAt(kind, x, y)
                }
              }}
            ></div>
          )
        })}
        {/* **物品块层**：与格子网格同一套列/行模板 ⇒ 逐格对齐；每件一块、块自己接拖拽/点击/落点。 */}
        <div
          className="app-wh-hold-figures"
          style={{ gridTemplateColumns: `repeat(${boardCols}, 1fr)`, gridTemplateRows: `repeat(${boardRows}, 1fr)` }}
        >
          {board.placements.map((p) => {
            const def = ctx.items.get(p.itemId)
            const iconKey = itemIconOf(p.itemId, def?.kind)
            const isCargo = p.kind === 'cargo'
            /** 谜质装置那一台（缺口 2026-09-15 船长报障：「鼠标移动到谜质上，不显示谜质具体效果」） */
            const matterDev = wormholeMatterDeviceOf(p.itemId)
            const isMatter = matterDev !== undefined
            const label = isCargo
              ? `×${n(p.units ?? 0)}`
              : p.itemId.startsWith('box-bp-')
                ? tr("ui.Wormhole.120")
                : p.itemId.startsWith('ai-core-')
                  ? tr("ui.MarketPage.008") // AI 核心（2026-09-14）：1×1 = 1 格，短标签与货柜的「图纸」同一档
                  : (matterDev?.short ?? tr('ui.MarketPage.006'))
            return (
              <div
                key={`fig-${kind}-${p.id}`}
                className={`app-wh-hold-fig ${isCargo ? 'is-cargo' : 'is-box'}${
                  dragId === p.id ? ' is-dragging' : ''
                }${kind === 'temp' && isMatter ? ' is-inert' : ''}${
                  touchDragging && dragId === p.id ? ' is-touch-drag' : ''
                }`}
                style={{
                  gridColumn: `${p.x + 1} / span ${p.w}`,
                  gridRow: `${p.y + 1} / span ${p.h}`,
                  color: holdTone(p.itemId, iconKey),
                }}
                title={
                  (isCargo
                    ? tr("ui.Wormhole.050", { p1: def?.name ?? p.itemId, p2: n(p.units ?? 0), p3: p.w, p4: p.h })
                    : // 谜质装置：**把这一台的具体效果写在悬停里**（船长 2026-09-15）——
                      // 文字与「取回谜质」的 toast、「谜质 N 台」读数同源（都取 `device.text`，界面不自写文案）
                      tr("ui.Wormhole.051", { p1: def?.name ?? p.itemId, p2: matterDev ? `：${matterDev.text}` : '', p3: p.w, p4: p.h })) +
                  (kind === 'temp'
                    ? isMatter
                      ? tr('ui.Wormhole.328')
                      : tr('ui.Wormhole.329')
                    : kind === 'hold' && isMatter
                      ? tr('ui.Wormhole.330')
                      : '')
                }
                draggable
                data-wh-fig={kind}
                data-wh-x={p.x}
                data-wh-y={p.y}
                onPointerDown={(e) => {
                  holdDragAteClickRef.current = false
                  grabRef.current = grabOffsetOf(e.currentTarget as HTMLElement, p.w, p.h, e.clientX, e.clientY)
                  touchDragDown(kind, p, e)
                }}
                onPointerMove={touchDragMove}
                onPointerUp={touchDragUp}
                onPointerCancel={touchDragCancel}
                onDragStart={() => {
                  setDragId(p.id)
                  setDragFrom(kind)
                }}
                onDragEnd={() => setDragId(null)}
                onDragOver={(e) => {
                  if (dragId) e.preventDefault()
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  dropAt(kind, p.x, p.y)
                }}
                onClick={(e) => {
                  /** 刚用指针拖过（触屏）⇒ 这一次 click 是拖动的尾巴，吃掉（与地图拖动同一套做法） */
                  if (holdDragAteClickRef.current) return
                  /**
                   * **Ctrl/⌘ + 点击 = 整件快捷搬运**（船长 2026-09-22；口径「①甲②甲③甲」）：
                   * ① 甲 = **整件搬**（一整堆散货条 / 一个货柜）· ② 甲 = 放不下 ⇒ **拒绝并提示**（沿用现有校验与 toast）
                   * · ③ 甲 = **形状货柜也支持**。
                   * ⚠ **不新写搬运逻辑**：与拖拽走同一条 core 入口 ——
                   * 临时空间 → 货仓：`engine.wormholeTempStow(id)`（core 自动找位）；
                   * 货仓 → 临时空间：`engine.wormholeBoardTransfer(...)`（与拖拽同一个函数），落点用 core
                   * `findFreeSpot(tempBoard, 形状, 临时空间容量)` **现算**（甲案）——形状/实占格原样带过去，失败口径同源。
                   */
                  if (e.ctrlKey || e.metaKey) {
                    e.preventDefault()
                    setDragId(null)
                    const r =
                      kind === 'temp'
                        ? engine.wormholeTempStow(p.id)
                        : (() => {
                            const spot = findFreeSpot(tempBoard, { w: p.w, h: p.h }, tempInfo.capacity)
                            if (!spot) return { ok: false, error: undefined } as { ok: boolean; error?: string }
                            return engine.wormholeBoardTransfer('hold', 'temp', p.id, spot.x, spot.y, { dx: 0, dy: 0 })
                          })()
                    if (!r.ok) onToast(cmdText(r) || tr('ui.Wormhole.327'), true)
                    return
                  }
                  setDragFrom(kind)
                  setDragId((prev) => (prev === p.id ? null : p.id))
                }}
              >
                <Glyph name={iconKey} size={64} color="currentColor" />
                <span className="app-wh-hold-fig-label">{label}</span>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="app-wh-hold">
      {/**
       * **临时空间待处理确认条**（船长 2026-09-14：「切换回探索界面触发丢弃（但是需要提醒玩家是否要丢弃物品
       * 并列出丢弃的物品列表）」＋「强制二选一：丢掉 或 放回」＋「撤离前必须清空」）：
       * 逐件列出（图标 + 名称 + 数量 + 是否失效），两个按钮 = 丢掉这些 / 放回货仓；谜质装置会失效。
       */}
      {tempAsk !== null && tempPending.length > 0 ? (
        <div className="app-wh-tempask">
          <div className="app-wh-tempask-title">
            {tr("ui.Wormhole.052")} <b>{tempPending.length}</b> {tr("ui.Wormhole.053")}{tempInfo.cells}/{tempInfo.capacity} {tr("ui.Wormhole.170")}
            {tempAsk === 'extract' ? tr("ui.Wormhole.171") : tr("ui.Wormhole.230")}
          </div>
          <ul className="app-wh-tempask-list">
            {tempPending.map((p) => {
              const def = ctx.items.get(p.itemId)
              const device = wormholeMatterDeviceOf(p.itemId)
              /** 已失效装置的副注（"放在这里不生效"的原因）——null 表示这台装置没有额外说明 */
              const discardHint = wormholeMatterDiscardHint(p.itemId)
              return (
                <li key={`ask-${p.id}`}>
                  <span className="app-wh-hold-row-ico" style={{ color: holdTone(p.itemId, itemIconOf(p.itemId, def?.kind)) }}>
                    <Glyph name={itemIconOf(p.itemId, def?.kind)} size={15} color="currentColor" />
                  </span>
                  {def?.name ?? p.itemId}
                  {p.kind === 'cargo' ? ` ×${n(p.units ?? 0)}` : ''}
                  <span className="app-dim">
                    {' '}
                    {tr('ui.Wormhole.281', { n: p.w * p.h })}
                    {device ? tr('ui.Wormhole.331', { p1: discardHint ? tr('ui.Wormhole.339', { p1: cmdText(discardHint) }) : '' }) : ''}
                  </span>
                </li>
              )
            })}
          </ul>
          <div className="app-wh-tempask-actions">
            <button className="app-btn is-small is-warn" onClick={onTempDiscard}>
              {tr("ui.Wormhole.054")}
            </button>
            <button className="app-btn is-small is-primary" onClick={onTempStow}>
              {tr("ui.Wormhole.172")}
            </button>
            <button className="app-btn is-small" onClick={() => setTempAsk(null)}>
              {tr("ui.Wormhole.055")}
            </button>
          </div>
        </div>
      ) : null}
      <div className="app-bay-title">
        {tr("ui.Wormhole.231")} <b>{info.used}</b> / {info.capacity}{tr('ui.Wormhole.285')}
        {info.overload ? <span className="app-wh-hold-warn">{tr('ui.Wormhole.282')}</span> : null}
        <span className="app-dim">
          {' '}{tr("ui.Wormhole.273")} {tr("ui.Wormhole.375", { p1: info.cargoCells })} {tr("ui.Wormhole.173")} {tr("ui.Wormhole.375", { p1: info.shapeCells })}
          {info.unplacedCells > 0 ? tr('ui.Wormhole.332', { p1: info.unplacedCells }) : ''}）
        </span>
        {/* 货仓说明**进 ⓘ**（2026-09-14 船长：「虫洞背包页面的货仓说明要进」）——原文一字未改，只搬位置 */}
        <HintIcon
          tip={tr("ui.Wormhole.174", { p1: n(WORMHOLE_SLOT_M3) })}
        />
      </div>
      {info.overload ? (
        <div className="app-wh-hold-overload">
          <span>
            {tr("ui.Wormhole.232")}{info.used}/{info.capacity}{tr('ui.Wormhole.359')}
          </span>
          <button
            className="app-btn is-small is-warn"
            onClick={() => {
              const r = engine.wormholeDiscardToFit()
              if (!r.ok) onToast(cmdText(r) || tr('ui.Wormhole.333'), true)
            }}
          >
            {tr("ui.Wormhole.056")}
          </button>
        </div>
      ) : null}
      <div className="app-wh-hold-boards">
        <div className="app-wh-hold-board-main">
          {/**
           * **滚动挂在外层 `.app-wh-hold-scroll`，不挂在格板上**（2026-09-23 船长：「**还是压缩了高度**」）：
           * 格板里有一层 `position:absolute; inset:0` 的"物品块层"（`.app-wh-hold-figures`），
           * 它的包含块 = **最近定位祖先的 padding box** —— 把 `max-height` 写在格板上，
           * 块层就被截成可视高（520px），13 行块全被压进这 520px、与下面的格子错位（船长实测）。
           * 放外层 ⇒ 格板保持自然高度、块层跟着整块走，滚的只是外层窗口。
           */}
          <div className="app-wh-hold-scroll">
            {boardView('hold', holdBoard, info.capacity, cols, rows, tr("ui.Wormhole.274"))}
          </div>
          <div className="app-wh-actions">
            <button
              className="app-btn is-small"
              disabled={placements.length === 0}
              onClick={() => {
                const r = engine.wormholeHoldCompact()
                if (!r.ok) onToast(cmdText(r) || tr('ui.Wormhole.334'), true)
              }}
            >
              {tr("ui.Wormhole.175")}
            </button>
            <span className="app-dim">
              {boxes} {tr("ui.Wormhole.057")} {cargoPieces.length} {tr("ui.Wormhole.058")}
            </span>
          </div>
          {/**
           * ⟪**2026-10-02 船长令**⟫ **禁止打捞普通残骸**（开关坐在**货仓页**，船长指定）。
           *
           * 打开后洞内「打捞」**只收稀有残骸**、普通残骸**留在原地**；本格只剩普通残骸时**拒绝动作且不扣回合**。
           * 文案三条都是**船长原文**：标签 = `ui.Wormhole.379` · 打开时的状态 = `core.wormholeSalvage.044`
           * （**与 core 的拒绝原因同一条 id**，按"同文并条"）· 打捞日志 = `core.wormholeSalvage.045`。
           * 开关状态必须看得见 —— 沿用技能页「自动续用」那一手（`.app-btn is-small` ＋ `is-on` 高亮 ＋
           * `aria-pressed` ＋ **文案随状态变**，先例见 `SkillsTreePage.tsx`）。
           */}
          <div className="app-wh-actions">
            <button
              className={`app-btn is-small${noCommonWreck ? ' is-on' : ''}`}
              aria-pressed={noCommonWreck}
              title={tr('ui.Wormhole.381')}
              onClick={() => {
                const r = engine.setNoCommonWreckSalvageNow(!noCommonWreck)
                if (!r.ok) onToast(cmdText(r) || tr('core.wormholeSalvage.044'), true)
              }}
            >
              {tr(noCommonWreck ? 'core.wormholeSalvage.044' : 'ui.Wormhole.379')}
            </button>
          </div>
        </div>
        {/**
         * **临时空间**（船长 2026-09-14：「背包格宽度是 8 格，那么可以在背包格右边添加一个用于丢弃和
         * 调整位置的『小背包』。玩家可以临时将东西放进去腾出位置调整背包…正式名：临时空间」）：
         * **4 列 × 8 行 = 32 格**，与货仓同款格子/块层（跨板拖拽即可搬进搬出）；**不占货仓容量、不算超载**；
         * **离开背包页前必须清空**（丢掉 或 放回货仓 —— `tempPending` 非空就拦着不让走）。
         */}
        <div className="app-wh-hold-board-side">
          <div className="app-bay-title">
            {tr("ui.Wormhole.059")} <b>{tempInfo.cells}</b> {tr("ui.Wormhole.376", { p1: tempInfo.capacity })}
            {tempInfo.full ? <span className="app-wh-hold-warn">{tr('ui.Wormhole.283')}</span> : null}
          </div>
          <div className="app-wh-hold-scroll is-temp">
            {boardView('temp', tempBoard, WORMHOLE_TEMP_CELLS, WORMHOLE_TEMP_COLS, WORMHOLE_TEMP_ROWS, '')}
          </div>
          <div className="app-wh-actions">
            <button
              className="app-btn is-small"
              disabled={tempInfo.placements.length === 0}
              onClick={() => {
                const r = engine.wormholeTempCompact()
                if (!r.ok) onToast(cmdText(r) || tr('ui.Wormhole.334'), true)
              }}
            >
              {tr("ui.Wormhole.176")}
            </button>
            <span className="app-dim">{tr("ui.Wormhole.177")}</span>
          </div>
          <div className="app-dim app-note">
            {tr('ui.Wormhole.284')}
          </div>
        </div>
      </div>
      {/* 货柜清单（形状件：位置读数 + 抛弃；散货条在下面的散货清单里按"类"处理） */}
      <div className="app-bay-title">{tr("ui.Wormhole.233")} {tr("ui.MarketPage.117", { p1: boxes })}</div>
      {boxes === 0 ? (
        <div className="app-dim app-inv-empty">{tr("ui.Wormhole.178")}</div>
      ) : (
        <ul className="app-inv-list">
          {placements
            .filter((p) => p.kind === 'box')
            .map((p) => (
              <li key={p.id} className="app-inv-row">
                <div className="app-inv-main">
                  <span className="app-inv-name">
                    <span
                      className="app-wh-hold-row-ico"
                      style={{
                        color: holdTone(p.itemId, itemIconOf(p.itemId, ctx.items.get(p.itemId)?.kind)),
                      }}
                    >
                      <Glyph
                        name={itemIconOf(p.itemId, ctx.items.get(p.itemId)?.kind)}
                        size={15}
                        color="currentColor"
                      />
                    </span>
                    {ctx.items.get(p.itemId)?.name ?? p.itemId}
                  </span>
                  <span className="app-inv-count">
                    {p.w}×{p.h} {tr("ui.Wormhole.179")} {tr("ui.Wormhole.360", { p1: p.y + 1 })} {tr("ui.Wormhole.234")} {tr("ui.Wormhole.360", { p1: p.x + 1 })}
                  </span>
                </div>
                <div className="app-inv-btns">
                  {/* 谜质「时序核心」这类**回合类**装置：抛之前先问一句（船长 2026-09-13：「需要提醒玩家」） */}
                  {wormholeMatterDiscardHint(p.itemId) && askDiscard === p.id ? null : (
                    <button
                      className="app-btn is-small is-warn"
                      onClick={() => {
                        if (wormholeMatterDiscardHint(p.itemId)) {
                          setAskDiscard(p.id)
                          return
                        }
                        const r = engine.wormholeDiscardHold(p.id)
                        if (!r.ok) onToast(cmdText(r) || tr('ui.Wormhole.335'), true)
                      }}
                    >
                      {tr("ui.Wormhole.180")}
                    </button>
                  )}
                </div>
              </li>
            ))}
        </ul>
      )}
      {/**
       * **抛弃回合类装置的确认条**（船长 2026-09-13 问的那条：「如果玩家丢弃回合相关谜质导致回合数不够，
       * 需要提醒玩家」）：明确写出代价 + "撤离不受影响" —— 丢完只是走不动，不会软锁。
       */}
      {askDiscard && placements.some((p) => p.id === askDiscard) ? (
        <div className="app-wh-ask">
          <span>⚠ {cmdText(wormholeMatterDiscardHint(placements.find((p) => p.id === askDiscard)!.itemId) ?? {})}</span>
          <span className="app-wh-actions">
            <button
              className="app-btn is-small is-danger"
              onClick={() => {
                const r = engine.wormholeDiscardHold(askDiscard)
                setAskDiscard(null)
                if (!r.ok) onToast(cmdText(r) || tr('ui.Wormhole.335'), true)
              }}
            >
              {tr("ui.Wormhole.235")}
            </button>
            <button className="app-btn is-small" onClick={() => setAskDiscard(null)}>
              {tr("ui.ActivityBar.004")}
            </button>
          </span>
        </div>
      ) : null}
      {/**
       * **散货清单 = 一件一行**（船长 2026-09-13 深夜：「残骸和母矿不应该合并超过 500 立方米，
       * 当超过时，分作 2 个单独的物品格并允许单独丢弃或者移动」）：每件最多 1 格（≤ 每格单位数），
       * 一件一个「抛弃」入口 —— 点开出现**数量拖动条 + 可直接输入数量**（同一条船长口径），
       * 只丢这一件里的指定数量，其余留在原格；移动在网格里拖那一格即可。
       */}
      <div className="app-bay-title">
        {tr("ui.Wormhole.236")} {tr("ui.MarketPage.117", { p1: cargoPieces.length })}
        <span className="app-dim">（{run.bag.length} {tr("ui.Wormhole.237")}</span>
      </div>
      {cargoPieces.length === 0 ? (
        <div className="app-dim app-inv-empty">{tr("ui.Wormhole.181")}</div>
      ) : (
        <ul className="app-inv-list">
          {cargoPieces.map((p, i) => {
            const def = ctx.items.get(p.itemId)
            const per = wormholeUnitsPerSlot(def?.unitM3 ?? 0)
            const units = Math.max(0, Math.floor(p.units ?? 0))
            const asking = discardAsk?.id === p.id
            const amount = asking ? Math.min(discardAsk.units, Math.max(1, units)) : units
            /**
             * **类型一变 = 一条分隔线**（船长 2026-09-22 ④：「物品和物品之间的分隔不明显，
             * 建议**不同类型的物品之间加个分隔线**」）。
             *
             * 口径（不新造尺）：分组键 = **物品大类**（`ItemDef.kind`），与清单既有排序同一把尺
             * （`cargoPieces` 按 `itemId` 排 ⇒ 同族天然连片）；只在"这一行的大类 ≠ 上一行"时给一个
             * `is-group-start`，样式复用行自己那条边线家族（实线 + 上间距），**不加伪元素、不改行距**。
             */
            const kindOf = (id: string): string => ctx.items.get(id)?.kind ?? ''
            const groupStart = i > 0 && kindOf(p.itemId) !== kindOf(cargoPieces[i - 1]!.itemId)
            return (
              <li key={p.id} className={`app-inv-row app-wh-piece${groupStart ? ' is-group-start' : ''}`}>
                <div className="app-inv-main">
                  <span className="app-inv-name">
                    <span
                      className="app-wh-hold-row-ico"
                      style={{ color: holdTone(p.itemId, itemIconOf(p.itemId, def?.kind)) }}
                    >
                      <Glyph name={itemIconOf(p.itemId, def?.kind)} size={15} color="currentColor" />
                    </span>
                    {def?.name ?? p.itemId} ×{n(units)}
                    <span className="app-dim">
                      {' '}
                      {tr('ui.Wormhole.371', { p1: i + 1 })} {tr("ui.Wormhole.060")} {p.y + 1} {tr("ui.Wormhole.234")} {p.x + 1}{tr('ui.Wormhole.360')}
                    </span>
                  </span>
                  <span className="app-inv-count">
                    {n(units * (def?.unitM3 ?? 0))} {tr("ui.Wormhole.061")} {n(per)} {tr("ui.Expedition.102")}
                  </span>
                </div>
                <div className="app-inv-btns">
                  {asking ? null : (
                    <button
                      className="app-btn is-small is-warn"
                      onClick={() => setDiscardAsk({ id: p.id, units })}
                    >
                      {tr("ui.Wormhole.180")}
                    </button>
                  )}
                </div>
                {/**
                 * **抛弃数量控件**（船长 2026-09-13 深夜：「添加一个让玩家选择抛弃多少的拖动条
                 * 并允许输入数量」）：拖动条与数字框双向同步；数字框允许直接敲，失焦/确认时夹到 1..本件数量。
                 */}
                {asking ? (
                  <div className="app-wh-discard">
                    <input
                      className="app-wh-discard-range"
                      type="range"
                      min={1}
                      max={Math.max(1, units)}
                      // 步长恒 1：拖动条上的取值必须能**精确**落到任何一个单位数
                      // （先前用 per/100 做步长，500 的上限会被浏览器吸附成 496 —— 读数对不上）
                      step={1}
                      value={amount}
                      onChange={(e) => setDiscardAsk({ id: p.id, units: Number(e.target.value) })}
                      aria-label={tr('ui.Wormhole.336')}
                    />
                    <input
                      className="app-wh-discard-num"
                      type="number"
                      min={1}
                      max={Math.max(1, units)}
                      value={amount}
                      onChange={(e) => {
                        const v = Math.round(Number(e.target.value))
                        setDiscardAsk({ id: p.id, units: Number.isFinite(v) ? Math.max(1, Math.min(units, v)) : 1 })
                      }}
                      aria-label={tr('ui.Wormhole.337')}
                    />
                    <span className="app-dim">
                      {tr('ui.Wormhole.372', { p1: n(units) })}<b>{n(amount)}</b> {tr("ui.Wormhole.121")}{n(amount * (def?.unitM3 ?? 0))} {tr("ui.Wormhole.062")}{' '}
                      {n(units - amount)}
                    </span>
                    <button
                      className="app-btn is-small is-warn"
                      onClick={() => {
                        const r = engine.wormholeDiscardHold(p.id, amount)
                        setDiscardAsk(null)
                        if (!r.ok) onToast(cmdText(r) || tr('ui.Wormhole.335'), true)
                        else onToast(tr("ui.Wormhole.122", { p1: n(amount), p2: def?.name ?? p.itemId }))
                      }}
                    >
                      {tr("ui.Wormhole.235")}
                    </button>
                    <button className="app-btn is-small" onClick={() => setDiscardAsk(null)}>
                      {tr("ui.ActivityBar.004")}
                    </button>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
import { CommandBudget } from '../features/combat/CommandBudget'
