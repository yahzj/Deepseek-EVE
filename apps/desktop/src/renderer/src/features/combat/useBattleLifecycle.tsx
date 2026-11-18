import { useEffect } from 'react'

import { createPlayerSpec, thrusterPhase } from '@whale/core'
import type { BattleReportRecord, DroneLossReport } from '@whale/core'

import type { GameEngine } from '../../game/engine'

import { planBlinkPillars, syncBlinkPillarDom } from './battleBlink'
import type { BlinkPillarFx } from './battleBlink'

import { STAR_LAYERS, clamp01, layout } from './battleViewCore'
import type { Dims, Stage, OutroSnap } from './battleViewCore'

import type { AcidFx } from './battleAcidFx'

import { dronePoseAt, foePoseAt } from './battleDrones'
import type { DroneDriveState } from './droneDriveTypes'

type BattleHandle = {
  startedAtGameMs: number
  lastTickGameMs: number
  distanceM: number
  myDesireM: number
  myFleet?: Array<{ tag: string; shipId: string }>
}
export function useBattleLifecycle({
    onDone, onClose, battle, stage, outroRef, setStage,
    combatView, state, droneReportRef, battleReportRef, reportTextRef, tr,
    onReport, prevBattleIdRef, deadRef, corpseAtRef, acidFxRef, acidDeathsRef,
    acidFxWakeAtRef, prevHpRef, hpInitRef, engine, meSpeedRef, battleRef,
    pausedRef, battleStartRef, moveSnapRef, visDistRef, blinkSeenRef, blinkFxRef,
    widthCheckRef, foeColRef, meColRef, dimsRef, measureRef, setSmoothM,
    refreshAcidFx, stageRef, meFxRootRef, starStateRef, thrusterCycleRef, thrusterBoostRef,
    starOffRef, starLayerRefs, droneDriveRef, droneBoxRef, droneWritesRef, droneElsRef,
    laneRef, setDims, flushTimerRef, dragValRef, mapRef,
  }: {
onDone: (() => void) | undefined
onClose: () => void
battle: import('@whale/core').BattleState | null
stage: Stage
outroRef: import('react').MutableRefObject<OutroSnap | null>
setStage: import('react').Dispatch<import('react').SetStateAction<Stage>>
combatView: { distanceM: number; myDesireM: number; meHp: { s: number; a: number; h: number; }; foeHp: Record<string, { s: number; a: number; h: number; name: string; }>; shots: number; hits: number; lockTag: string | null; } | null
state: import('@whale/core').GameState
droneReportRef: import('react').MutableRefObject<DroneLossReport | null>
battleReportRef: import('react').MutableRefObject<BattleReportRecord | null>
reportTextRef: import('react').MutableRefObject<string>
tr: (id: string, params?: Record<string, string | number>) => string
onReport: (() => boolean) | undefined
prevBattleIdRef: import('react').MutableRefObject<number | null>
deadRef: import('react').MutableRefObject<Set<string>>
corpseAtRef: import('react').MutableRefObject<Map<string, number>>
acidFxRef: import('react').MutableRefObject<AcidFx[]>
acidDeathsRef: import('react').MutableRefObject<Set<string>>
acidFxWakeAtRef: import('react').MutableRefObject<number>
prevHpRef: import('react').MutableRefObject<Map<string, number>>
hpInitRef: import('react').MutableRefObject<boolean>
engine: Pick<GameEngine, "state" | "ctx" | "wormholeSpeedActive" | "wormholeSpeedOptions" | "setWormholeSpeed" | "battleSetDesireAt" | "retreatNow">
meSpeedRef: import('react').MutableRefObject<number>
battleRef: import('react').MutableRefObject<BattleHandle | null>
pausedRef: import('react').MutableRefObject<boolean>
battleStartRef: import('react').MutableRefObject<number>
moveSnapRef: import('react').MutableRefObject<{ prev: { m: number; w: number; } | null; cur: { m: number; w: number; } | null; }>
visDistRef: import('react').MutableRefObject<number>
blinkSeenRef: import('react').MutableRefObject<Set<string>>
blinkFxRef: import('react').MutableRefObject<BlinkPillarFx[]>
widthCheckRef: import('react').MutableRefObject<number>
foeColRef: import('react').RefObject<HTMLDivElement>
meColRef: import('react').RefObject<HTMLDivElement>
dimsRef: import('react').MutableRefObject<Dims>
measureRef: import('react').MutableRefObject<() => void>
setSmoothM: import('react').Dispatch<import('react').SetStateAction<number | null>>
refreshAcidFx: import('react').Dispatch<import('react').SetStateAction<number>>
stageRef: import('react').RefObject<HTMLDivElement>
meFxRootRef: import('react').RefObject<HTMLDivElement>
starStateRef: import('react').MutableRefObject<{ v: number; dir: number; }>
thrusterCycleRef: import('react').MutableRefObject<{ boostMs: number; cooldownMs: number; } | undefined>
thrusterBoostRef: import('react').MutableRefObject<number>
starOffRef: import('react').MutableRefObject<number[]>
starLayerRefs: import('react').MutableRefObject<(HTMLDivElement | null)[]>
droneDriveRef: import('react').MutableRefObject<DroneDriveState>
droneBoxRef: import('react').RefObject<HTMLDivElement>
droneWritesRef: import('react').MutableRefObject<Map<string, string>>
droneElsRef: import('react').MutableRefObject<Map<string, HTMLSpanElement>>
laneRef: import('react').RefObject<HTMLDivElement>
setDims: import('react').Dispatch<import('react').SetStateAction<Dims>>
flushTimerRef: import('react').MutableRefObject<number | null>
dragValRef: import('react').MutableRefObject<number | null>
mapRef: import('react').MutableRefObject<{ farM: number; nearM: number; }>
}) {
  const finish = (): void => {
    if (onDone) onDone()
    else onClose()
  }
  useEffect(() => {
    const ended = battle?.ended ?? null
    if (stage === 'live') {
      if (ended) {
        outroRef.current = {
          kind: ended,
          atWall: performance.now(),
          startedAtGameMs: battle!.startedAtGameMs,
          durMs: Math.max(0, battle!.lastTickGameMs - battle!.startedAtGameMs),
          meShots: battle!.stats.meShots,
          meHits: battle!.stats.meHits,
          meDmg: battle!.stats.meDmg,
          foeShots: battle!.stats.foeShots,
          foeHits: battle!.stats.foeHits,
          ...(battle!.droneLost && Object.keys(battle!.droneLost).length > 0 ? { droneLost: { ...battle!.droneLost } } : {}),
          ...(battle!.wormhole ? { wormholeKind: battle!.wormhole.kind } : {}),
        }
        setStage('outro')
      } else if (!combatView) {
        finish()
      }
    } else if (stage === 'outro' && !combatView) {
      if (outroRef.current?.wormholeKind === 'extract') {
        finish()
        return
      }
      const snap = outroRef.current
      const dr = state.droneLossReport ?? null
      droneReportRef.current =
        dr && (!snap || dr.battleStartedAtGameMs === snap.startedAtGameMs) ? dr : null
      const br = state.battleReport ?? null
      battleReportRef.current = br && (!snap || br.battleStartedAtGameMs === snap.startedAtGameMs) ? br : null
      reportTextRef.current =
        (battleReportRef.current?.summaryId !== undefined
          ? tr(battleReportRef.current.summaryId, battleReportRef.current.summaryParams as Record<string, string | number> | undefined)
          : battleReportRef.current?.summary) ??
        (snap?.kind === 'me' ? tr("ui.BattleScreen.005") : tr("ui.BattleScreen.006"))
      setStage('report')
      if (!(onReport?.() ?? true)) finish()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, battle?.ended, combatView === null])

  useEffect(() => {
    const id = battle?.startedAtGameMs
    if (id === undefined) return
    if (prevBattleIdRef.current === id) return
    prevBattleIdRef.current = id
    outroRef.current = null
    setStage('live')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle?.startedAtGameMs])

  useEffect(() => {
    if (stage !== 'report') return
    const t = window.setTimeout(() => finish(), 20_000)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage])

  useEffect(() => {
    const b = battle
    if (!b) return
    deadRef.current = new Set(
      Object.values(b.units)
        .filter((u) => u.side === 'foe' && u.hp.s + u.hp.a + u.hp.h <= 0)
        .map((u) => u.tag),
    )
    corpseAtRef.current.clear()
    acidFxRef.current = []
    acidDeathsRef.current.clear()
    acidFxWakeAtRef.current = Number.POSITIVE_INFINITY
    prevHpRef.current.clear()
    hpInitRef.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle?.startedAtGameMs])

  useEffect(() => {
    if (!battle) return
    const anchorId = battle.myFleet?.[0]?.shipId ?? engine.state.shipId
    const spec = createPlayerSpec(engine.state, engine.ctx, anchorId)
    meSpeedRef.current = spec?.speedMps ?? 200
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle?.startedAtGameMs])

  useEffect(() => {
    const iv = window.setInterval(() => {
      const b = battleRef.current
      const now = performance.now()
      if (!b) return
      if (pausedRef.current) return
      if (b.startedAtGameMs !== battleStartRef.current) {
        battleStartRef.current = b.startedAtGameMs
        moveSnapRef.current = { prev: null, cur: null }
        visDistRef.current = 0
        corpseAtRef.current.clear()
        acidFxRef.current = []
        acidDeathsRef.current.clear()
        acidFxWakeAtRef.current = Number.POSITIVE_INFINITY
        prevHpRef.current.clear()
        hpInitRef.current = false
        blinkSeenRef.current.clear()
        for (const p of blinkFxRef.current) p.el?.remove()
        blinkFxRef.current.length = 0
        const anchorId = b.myFleet?.[0]?.shipId ?? engine.state.shipId
        const spec = createPlayerSpec(engine.state, engine.ctx, anchorId)
        meSpeedRef.current = spec?.speedMps ?? 200
      }
      const s = moveSnapRef.current
      if (!s.cur || s.cur.m !== b.distanceM) {
        if (s.cur && s.cur.m !== b.distanceM) s.prev = s.cur
        else s.prev = null
        s.cur = { m: b.distanceM, w: now }
      }
      let vis = s.cur.m
      if (s.prev && s.cur.m !== s.prev.m) {
        const t = clamp01((now - s.cur.w) / 100)
        vis = s.prev.m + (s.cur.m - s.prev.m) * t
      }
      visDistRef.current = vis
      if (++widthCheckRef.current >= 10) {
        widthCheckRef.current = 0
        const fw = foeColRef.current?.offsetWidth
        const mw = meColRef.current?.offsetWidth
        if ((fw && Math.abs(fw - dimsRef.current.foeW) > 2) || (mw && Math.abs(mw - dimsRef.current.meW) > 2)) {
          measureRef.current()
        }
      }
      setSmoothM((old) => (old === null || Math.abs(old - vis) >= 0.05 ? vis : old))
      if (now >= acidFxWakeAtRef.current) {
        acidFxWakeAtRef.current = Number.POSITIVE_INFINITY
        refreshAcidFx(tick => tick + 1)
      }
      planBlinkPillars(b, blinkSeenRef.current, blinkFxRef.current, now, {
        foe: foeColRef.current,
        me: stageRef.current,
      })
      syncBlinkPillarDom(blinkFxRef.current, foeColRef.current, now, 'foe')
      syncBlinkPillarDom(blinkFxRef.current, stageRef.current, now, 'me', meFxRootRef.current)

      const st = starStateRef.current
      const gap = b.myDesireM - b.distanceM
      if (Math.abs(gap) > 2) st.dir = gap < 0 ? 1 : -1
      const boostNow = thrusterPhase(b, engine.ctx.balance.battle, thrusterCycleRef.current).boosting
        ? thrusterBoostRef.current
        : 0
      const vMag = Math.min(320, 40 + meSpeedRef.current * (1 + boostNow) * 0.32)
      const target = st.dir * vMag
      st.v += (target - st.v) * 0.12
      const offs = starOffRef.current
      const W = Math.max(1, dimsRef.current.W)
      for (let i = 0; i < STAR_LAYERS.length; i++) {
        offs[i] = (offs[i] + st.v * STAR_LAYERS[i].mult * 0.033) % W
        if (offs[i] < 0) offs[i] += W
        const el = starLayerRefs.current[i]
        if (el) el.style.transform = `translate3d(${-offs[i].toFixed(1)}px, 0, 0)`
      }
    }, 33)
    return () => window.clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let alive = true
    let raf = 0
    const drive = (): void => {
      if (!alive) return
      const d = droneDriveRef.current
      if (!pausedRef.current && d.wings.length > 0) {
        const layLoop = layout(dimsRef.current, d.foeSizes, visDistRef.current, d.farM, d.nearM, d.meSize, d.mySizes)
        const box = droneBoxRef.current
        const w0 = droneWritesRef.current
        if (box) {
          const tb = `translate3d(${layLoop.me.x.toFixed(1)}px, ${layLoop.me.y.toFixed(1)}px, 0)`
          if (w0.get('@box') !== tb) {
            box.style.transform = tb
            w0.set('@box', tb)
          }
        }
        const nowMs = performance.now()
        for (const w of d.wings) {
          if (w.deck) continue
          const elapsed = w.st ? nowMs - w.st.startAt : Number.POSITIVE_INFINITY
          const own = w.owner && w.owner !== 'player' ? d.meAnchors.get(w.owner) : undefined
          const layW = own ? { foe: layLoop.foe, me: own } : layLoop
          for (let i = 0; i < w.show; i++) {
            const key = w.foe
              ? `foe:${w.foe}:${w.artId}|${i}`
              : `${w.key ?? w.artId}|${i}`
            const el = droneElsRef.current.get(key)
            if (!el) continue
            const pose = w.foe
              ? foePoseAt(w.model, i, w.st, { me: layLoop.me, foe: [layLoop.foe[d.foeTags?.indexOf(w.foe) ?? 0] ?? layLoop.foe[0] ?? layLoop.me] }, elapsed, w.rangeBuff === true)
              : dronePoseAt(w.model, i, w.st, layW, elapsed)
            const t = `translate3d(${(pose.x - layLoop.me.x).toFixed(1)}px, ${(pose.y - layLoop.me.y).toFixed(1)}px, 0) translate(-50%, -50%) scaleX(${pose.heading})`
            if (w0.get(key) !== t) {
              el.style.transform = t
              w0.set(key, t)
            }
          }
        }
      }
      raf = window.requestAnimationFrame(drive)
    }
    raf = window.requestAnimationFrame(drive)
    return () => {
      alive = false
      window.cancelAnimationFrame(raf)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const measure = (): void => {
      const lane = laneRef.current
      if (!lane) return
      const next: Dims = {
        W: lane.clientWidth || 1200,
        H: lane.clientHeight || 460,
        meW: meColRef.current?.offsetWidth || 330,
        foeW: foeColRef.current?.offsetWidth || 330,
      }
      setDims((d) =>
        d.W === next.W && d.H === next.H && d.meW === next.meW && d.foeW === next.foeW ? d : next,
      )
    }
    measureRef.current = measure
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  useEffect(() => {
    return () => {
      if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current)
      const v = dragValRef.current
      const m = mapRef.current
      if (v !== null && m.farM > 1) {
        engine.battleSetDesireAt(Math.round(m.farM - (v / 1000) * (m.farM - m.nearM)))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
return { finish }
}
