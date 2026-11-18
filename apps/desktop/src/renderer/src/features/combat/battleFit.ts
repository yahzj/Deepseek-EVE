import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'

export function fitScale(avail: number, need: number): number {
  if (!Number.isFinite(avail) || !Number.isFinite(need) || avail <= 0 || need <= 0) return 1
  const k = avail / need
  return k >= 1 ? 1 : k
}

export interface BattleFitRefs {
  screen: RefObject<HTMLElement | null>
  stage: RefObject<HTMLElement | null>
  fit: RefObject<HTMLElement | null>
  lane: RefObject<HTMLElement | null>
}

interface Stamp {
  lane: number
  laneBox: number
  avail: number
  top: number
  dock: number
  k: number
  need: number
}

export function useBattleFit(refs: BattleFitRefs): void {
  const last = useRef<Stamp | null>(null)

  const apply = useCallback((): void => {
    const screen = refs.screen.current
    const stage = refs.stage.current
    const fit = refs.fit.current
    const lane = refs.lane.current
    if (!screen || !stage || !fit || !lane) return

    const keepMin = lane.style.minHeight
    const keepFlex = lane.style.flex
    lane.style.minHeight = '0px'
    lane.style.flex = '0 0 auto'
    const dense = screen.classList.contains('is-command-dense')
    const laneNeed = dense ? Math.max(320, ...Array.from(lane.querySelectorAll<HTMLElement>('.app-bts-col.is-me,.app-bts-unit'), unit => {
      let top = 0
      for (let node: HTMLElement | null = unit; node && node !== lane; node = node.offsetParent as HTMLElement | null) top += node.offsetTop
      const bar = unit.querySelector<HTMLElement>('.app-bts-hpWrap')
      return top + Math.max(unit.offsetHeight, bar ? bar.offsetTop + bar.offsetHeight : 0) + 12
    })) : lane.scrollHeight
    lane.style.minHeight = keepMin
    lane.style.flex = keepFlex
    if (laneNeed > 0 && lane.style.minHeight !== `${laneNeed}px`) lane.style.minHeight = `${laneNeed}px`

    const keepH = fit.style.height
    const keepT = fit.style.transform
    const keepFitFlex = fit.style.flex
    fit.style.flex = '0 0 auto'
    fit.style.height = 'auto'
    fit.style.transform = 'none'
    const need = fit.offsetHeight
    fit.style.height = keepH
    fit.style.transform = keepT
    fit.style.flex = keepFitFlex

    const avail = stage.clientHeight
    const k = fitScale(avail, need)
    const topEl = screen.querySelector('.app-battle-screen-top')
    const dockEl = screen.querySelector('.app-bts-dock')
    const stamp: Stamp = {
      lane: laneNeed,
      laneBox: lane.clientHeight,
      avail,
      top: topEl?.clientHeight ?? 0,
      dock: dockEl?.clientHeight ?? 0,
      k,
      need,
    }
    const prev = last.current
    if (
      prev &&
      prev.lane === stamp.lane &&
      prev.laneBox === stamp.laneBox &&
      prev.avail === stamp.avail &&
      prev.top === stamp.top &&
      prev.dock === stamp.dock &&
      Math.abs(prev.k - stamp.k) < 0.0005
    ) {
      return
    }
    last.current = stamp

    if (k >= 1) {
      fit.style.height = '100%'
      fit.style.transform = 'none'
    } else {
      fit.style.height = `${need}px`
      fit.style.transform = `scale(${k})`
    }
    screen.classList.toggle('is-bts-fit', k < 1)
    fit.dataset.btsK = k.toFixed(4)
    fit.dataset.btsNeed = String(need)
    fit.dataset.btsAvail = String(avail)
  }, [refs.screen, refs.stage, refs.fit, refs.lane])

  useLayoutEffect(() => {
    apply()
  })

  useLayoutEffect(() => {
    const el = refs.stage.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => apply())
    ro.observe(el)
    return () => ro.disconnect()
  }, [apply, refs.stage])
}
