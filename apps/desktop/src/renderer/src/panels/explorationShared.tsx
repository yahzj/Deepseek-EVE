/** 新旧探索界面共用的纯表现辅助件，不参与玩法或存档结算。 */
import { useEffect, useState } from 'react'
import type { WormholeSignal } from '@whale/core'
import { itemToneOf, RARE_WRECK_TONE } from '../ui/Glyphs'
import { wreckTierOf } from '../ui/itemSubs'

export function holdTone(itemId: string, iconKey: string): string {
  return wreckTierOf(itemId) === 'rare' ? RARE_WRECK_TONE : itemToneOf(itemId, iconKey)
}

export function hexRingOf(dq: number, dr: number): number {
  return Math.max(0, Math.round((Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2))
}

export function explorationNumber(v: number): string {
  return Math.round(v).toLocaleString('zh-CN')
}

export function useCountUp(value: number, ms = 320): number {
  const [shown, setShown] = useState(value)
  useEffect(() => {
    if (!Number.isFinite(value) || value === 0) {
      setShown(value)
      return
    }
    const t0 = performance.now()
    let raf = 0
    const step = (t: number): void => {
      const k = Math.min(1, (t - t0) / ms)
      setShown(Math.round(value * (1 - Math.pow(1 - k, 3))))
      if (k < 1) raf = window.requestAnimationFrame(step)
    }
    raf = window.requestAnimationFrame(step)
    return () => window.cancelAnimationFrame(raf)
  }, [value, ms])
  return shown
}

/** 保留抓取点在物件内的格偏移，鼠标和触屏落位共用。 */
export function grabOffsetOf(el: HTMLElement, w: number, h: number, clientX: number, clientY: number): { dx: number; dy: number } {
  const r = el.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return { dx: 0, dy: 0 }
  const clamp = (v: number, max: number): number => Math.min(max, Math.max(0, v))
  return {
    dx: clamp(Math.floor(((clientX - r.left) / r.width) * w), w - 1),
    dy: clamp(Math.floor(((clientY - r.top) / r.height) * h), h - 1),
  }
}

export function WhGlyph({ signal, exit }: { signal: WormholeSignal | null; exit?: boolean }) {
  if (exit) return <path d="M-7,0 L6,0 M1,-5 L7,0 L1,5" />
  if (signal === 'wreck') return <path d="M-8,3 L-4,-3 L0,2 L4,-4 L8,3" />
  if (signal === 'ship') return <path d="M-7,-5 L8,0 L-7,5 Z" />
  if (signal === 'resource') return <path d="M0,-7 L7,0 L0,7 L-7,0 Z" />
  if (signal === 'radar')
    return (
      <>
        <path d="M-7,4 A7,7 0 0 1 7,4" />
        <path d="M-3.4,4 A3.4,3.4 0 0 1 3.4,4" />
        <circle cx={0} cy={4} r={1.4} />
      </>
    )
  if (signal === 'beacon')
    return (
      <>
        <path d="M-3.6,7 L-1.8,-2 L1.8,-2 L3.6,7 Z" />
        <path d="M-7,-5 L-2.6,-3.4 M7,-5 L2.6,-3.4" />
        <path d="M-1.8,-2 L1.8,-2" />
      </>
    )
  return <circle cx={0} cy={0} r={2.2} />
}

export function WhNebulaGlyph() {
  return (
    <g className="app-wh-nebula">
      <path d="M-7,2.4 A3.2,3.2 0 0 1 -2.6,-2.4 A3.6,3.6 0 0 1 3,-1.4 A3,3 0 0 1 7,2.4 Z" />
      <path d="M-5.6,4.6 A2.4,2.4 0 0 1 -1.6,1.6 A2.6,2.6 0 0 1 3.2,2.2 A2.6,2.6 0 0 1 5.6,4.6" />
      <circle cx={-3.4} cy={-4.4} r={0.9} />
      <circle cx={4.2} cy={-3.2} r={0.7} />
    </g>
  )
}
