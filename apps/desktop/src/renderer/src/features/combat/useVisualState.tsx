import { battleArcsFor } from '@whale/core'
import { useMemo, useRef, useState } from 'react'

import type { BattleReportRecord, DamageType, DroneLossReport } from '@whale/core'

import type { BlinkPillarFx } from './battleBlink'

import type { DroneModel, DroneSortie } from './droneArt'
import { LAY, STAR_LAYERS, genStars } from './battleViewCore'
import type { Dims, BoltV, FlashV, Stage, OutroSnap } from './battleViewCore'

import type { AcidFx } from './battleAcidFx'

import { useBattleFit } from './battleFit'

import type { BattleFxCursor } from './battleFxCursor'
type BattleHandle = {
  startedAtGameMs: number
  lastTickGameMs: number
  distanceM: number
  myDesireM: number
  myFleet?: Array<{ tag: string; shipId: string }>
}
export function useVisualState({ arcs }: {
arcs: ReturnType<typeof battleArcsFor>
}) {
const [stage, setStage] = useState<Stage>('live')
  const [retreatAsk, setRetreatAsk] = useState(false)
  const [dragV, setDragV] = useState<number | null>(null)
  const [dims, setDims] = useState<Dims>({ W: 1200, H: 460, meW: 330, foeW: 330 })
  const [smoothM, setSmoothM] = useState<number | null>(null)
  const moveSnapRef = useRef<{ prev: { m: number; w: number } | null; cur: { m: number; w: number } | null }>({
    prev: null,
    cur: null,
  })
  const dimsRef = useRef(dims)
  dimsRef.current = dims
  const thrusterBoostRef = useRef(0)
  thrusterBoostRef.current = arcs?.thrusterBoost ?? 0
  const thrusterCycleRef = useRef<{ boostMs: number; cooldownMs: number } | undefined>(undefined)
  thrusterCycleRef.current = arcs?.thrusterCycle
  const measureRef = useRef<() => void>(() => {})
  const widthCheckRef = useRef(0)
  const starLayerRefs = useRef<Array<HTMLDivElement | null>>([])
  const starOffRef = useRef<number[]>([0, 0, 0])
  const starStateRef = useRef({ v: 70, dir: 1 })
const meSpeedRef = useRef(200)
  const starField = useMemo(
    () =>
      STAR_LAYERS.map((cfg, i) => ({
        cfg,
        pts: genStars(cfg, Math.max(60, dims.W), Math.max(120, dims.H), 1009 + i * 73),
      })),
    [dims.W, dims.H],
  )

  const laneRef = useRef<HTMLDivElement>(null)
  const screenRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const fitRef = useRef<HTMLDivElement>(null)
  useBattleFit({ screen: screenRef, stage: stageRef, fit: fitRef, lane: laneRef })
  const meColRef = useRef<HTMLDivElement>(null)
  const foeColRef = useRef<HTMLDivElement>(null)
  const meFxRootRef = useRef<HTMLDivElement>(null)
  const facingRef = useRef({ meFlip: false, foeFlip: true })
  const fxCursorRef = useRef<BattleFxCursor>({ seq: -1 })
  const keyRef = useRef(1)
  const boltsRef = useRef<BoltV[]>([])
  const flashRef = useRef<FlashV[]>([])
  const acidFxRef = useRef<AcidFx[]>([])
  const acidDeathsRef = useRef<Set<string>>(new Set())
  const acidFxWakeAtRef = useRef(Number.POSITIVE_INFINITY)
  const [, refreshAcidFx] = useState(0)
  const popupsRef = useRef<
    Array<{ key: number; target: string; slot: number; x: number; y: number; born: number; amount: number; type: DamageType; miss: boolean }>
  >([])
  const popupAccRef = useRef<Map<string, { x: number; y: number; amount: number; type: DamageType; miss: boolean }>>(
    new Map(),
  )
  const muzzleCountRef = useRef<Map<string, number>>(new Map())
  const droneSortieRef = useRef<Map<string, DroneSortie>>(new Map());
  const foeSortieRef = useRef<Map<string, DroneSortie>>(new Map());
  const droneSlotRef = useRef<Map<string, number>>(new Map())
  const droneBoxRef = useRef<HTMLDivElement>(null)
  const droneElsRef = useRef<Map<string, HTMLSpanElement>>(new Map())
  const droneWritesRef = useRef<Map<string, string>>(new Map())
  const droneDownRef = useRef<
    Array<{
      key: number
      artId: string
      x: number
      y: number
      tx: number
      ty: number
      born: number
      foe?: boolean
    }>
  >([]);
  const blinkRef = useRef<Map<string, { side: 'foe' | 'me'; vanish: number; move: number; appear: number; segMs: number }>>(new Map());
  const blinkFxRef = useRef<BlinkPillarFx[]>([]);
  const blinkSeenRef = useRef<Set<string>>(new Set())
  const dronePrevShowRef = useRef<Map<string, number>>(new Map())
  const visDistRef = useRef(0)
  const droneDriveRef = useRef<{
    foeSizes: number[]
    mySizes?: number[]
    meSize: number
    farM: number
    nearM: number
    wings: Array<{
      key?: string
      owner?: string
      artId: string
      model: DroneModel
      show: number
      st?: DroneSortie
      deck: boolean
      foe?: string
      rangeBuff?: boolean
    }>
    meAnchors: Map<string, { x: number; y: number }>
  }>({ foeSizes: [LAY.MAIN], meSize: LAY.MAIN, farM: 1, nearM: 200, wings: [], meAnchors: new Map() })
  const deadRef = useRef<Set<string>>(new Set())
  const corpseAtRef = useRef<Map<string, number>>(new Map())
  const prevHpRef = useRef<Map<string, number>>(new Map())
  const hpInitRef = useRef(false)
  const lastHitTypeRef = useRef<Map<string, DamageType>>(new Map())
  const outroRef = useRef<OutroSnap | null>(null)
  const reportTextRef = useRef('')
  const droneReportRef = useRef<DroneLossReport | null>(null)
  const battleReportRef = useRef<BattleReportRecord | null>(null)
  const flushTimerRef = useRef<number | null>(null)
  const dragValRef = useRef<number | null>(null)
  const dragRafRef = useRef<number | null>(null)
  const dragPendingRef = useRef<number | null>(null)
  const battleRef = useRef<BattleHandle | null>(null)
  const battleStartRef = useRef(0)
  const prevBattleIdRef = useRef<number | null>(null)
  const mapRef = useRef<{ farM: number; nearM: number }>({ farM: 1, nearM: 200 })

  if (arcs) {
    mapRef.current = { farM: arcs.maxM, nearM: arcs.nearM }
  }
return {
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
  }
}
