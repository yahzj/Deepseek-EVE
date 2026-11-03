/** 新旧探索界面共用的纯表现辅助件，不参与玩法或存档结算。 */
import { useEffect, useMemo, useState } from 'react'
import type { WormholeSignal } from '@whale/core'
import { Glyph, itemToneOf, RARE_WRECK_TONE } from '../ui/Glyphs'
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

/** 波形共振与解密调谐仪（第 16 轮专项：平滑步进、等宽读数、全息脉冲锁定） */
export function WhWaveformResonance({
  targetFreq = 180,
  targetAmp = 75,
  onResonanceLock,
  disabled = false,
}: {
  targetFreq?: number
  targetAmp?: number
  onResonanceLock?: () => void
  disabled?: boolean
}) {
  const [freq, setFreq] = useState(120)
  const [amp, setAmp] = useState(50)
  const [locked, setLocked] = useState(false)
  const [pulsing, setPulsing] = useState(false)

  const diffF = Math.abs(freq - targetFreq) / Math.max(1, targetFreq)
  const diffA = Math.abs(amp - targetAmp) / Math.max(1, targetAmp)
  const syncRate = Math.max(0, Math.min(100, Math.round((1 - (diffF * 0.6 + diffA * 0.4)) * 100)))

  const isMatched = syncRate >= 96

  const handleLock = () => {
    if (disabled || locked) return
    setFreq(targetFreq)
    setAmp(targetAmp)
    setLocked(true)
    setPulsing(true)
    setTimeout(() => {
      setPulsing(false)
      onResonanceLock?.()
    }, 450)
  }

  // 生成 SVG 路径点
  const dTarget = useMemo(() => {
    const pts: string[] = ['M 0,34']
    for (let x = 6; x <= 300; x += 6) {
      const y = 34 + Math.sin(x * (targetFreq / 1400)) * (targetAmp * 0.28)
      pts.push(`L ${x.toFixed(1)},${y.toFixed(1)}`)
    }
    return pts.join(' ')
  }, [targetFreq, targetAmp])

  const dTuned = useMemo(() => {
    const pts: string[] = ['M 0,34']
    for (let x = 6; x <= 300; x += 6) {
      const y = 34 + Math.sin(x * (freq / 1400)) * (amp * 0.28)
      pts.push(`L ${x.toFixed(1)},${y.toFixed(1)}`)
    }
    return pts.join(' ')
  }, [freq, amp])

  return (
    <div className={`app-wh-resonance${locked || isMatched ? ' is-locked' : ''}${pulsing ? ' app-resonance-pulse' : ''}`}>
      <div className="app-wh-resonance-head">
        <span className="app-wh-resonance-title">
          <Glyph name="ico-tact" size={16} color="rgb(var(--wui-accent))" />
          波形矩阵共振解密
        </span>
        <span className="app-wh-resonance-metrics">
          <span>匹配度: <b>{isMatched || locked ? '100%' : `${syncRate}%`}</b></span>
        </span>
      </div>

      <svg className="app-wh-resonance-svg" viewBox="0 0 300 68" aria-hidden="true">
        <line x1="0" y1="34" x2="300" y2="34" stroke="rgb(var(--wui-border) / 0.5)" strokeDasharray="3 3" />
        <path className="app-wh-resonance-target" d={dTarget} />
        <path className="app-wh-resonance-tuned" d={dTuned} />
      </svg>

      <div className="app-wh-resonance-controls">
        <div className="app-wh-resonance-col">
          <div className="app-wh-resonance-metrics">
            <span>载波频率</span>
            <b>{freq.toFixed(1)} MHz</b>
          </div>
          <div className="app-wh-resonance-row">
            <button
              type="button"
              className="app-wh-resonance-btn"
              disabled={disabled || locked}
              onClick={() => setFreq((v) => Math.max(50, v - 5))}
            >
              -
            </button>
            <input
              type="range"
              min="50"
              max="350"
              step="1"
              value={freq}
              disabled={disabled || locked}
              className="app-wh-resonance-slider"
              onChange={(e) => setFreq(Number(e.target.value))}
            />
            <button
              type="button"
              className="app-wh-resonance-btn"
              disabled={disabled || locked}
              onClick={() => setFreq((v) => Math.min(350, v + 5))}
            >
              +
            </button>
          </div>
        </div>

        <div className="app-wh-resonance-col">
          <div className="app-wh-resonance-metrics">
            <span>共振波幅</span>
            <b>{amp.toFixed(1)}%</b>
          </div>
          <div className="app-wh-resonance-row">
            <button
              type="button"
              className="app-wh-resonance-btn"
              disabled={disabled || locked}
              onClick={() => setAmp((v) => Math.max(20, v - 5))}
            >
              -
            </button>
            <input
              type="range"
              min="20"
              max="100"
              step="1"
              value={amp}
              disabled={disabled || locked}
              className="app-wh-resonance-slider"
              onChange={(e) => setAmp(Number(e.target.value))}
            />
            <button
              type="button"
              className="app-wh-resonance-btn"
              disabled={disabled || locked}
              onClick={() => setAmp((v) => Math.min(100, v + 5))}
            >
              +
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--wui-sp-6)', marginTop: 'var(--wui-sp-2)' }}>
        <button
          type="button"
          className="app-btn is-small is-primary"
          disabled={disabled || locked}
          onClick={handleLock}
        >
          {locked ? '共振已锁定' : isMatched ? '确认锁相触发' : '快速锁相对齐'}
        </button>
      </div>
    </div>
  )
}

/** 遗迹开箱与结算物品战术槽位网格 */
export function WhSettleSlots({
  boxesCount = 0,
  relicsCount = 0,
  cores = {},
  essences = 0,
}: {
  boxesCount?: number
  relicsCount?: number
  cores?: { alpha?: number; beta?: number; gamma?: number }
  essences?: number
}) {
  const slots: Array<{ id: string; name: string; qty: number; quality: 'normal' | 'rare' | 'epic' | 'special'; glyph: string }> = []
  if (relicsCount > 0) {
    slots.push({ id: 'relic', name: '古代遗迹遗存', qty: relicsCount, quality: 'epic', glyph: 'ico-tact' })
  }
  if (boxesCount > 0) {
    slots.push({ id: 'box', name: '安全货柜', qty: boxesCount, quality: 'rare', glyph: 'ico-ind' })
  }
  if ((cores.alpha ?? 0) > 0) {
    slots.push({ id: 'core-a', name: 'Alpha 核心', qty: cores.alpha!, quality: 'special', glyph: 'ico-tact' })
  }
  if ((cores.beta ?? 0) > 0) {
    slots.push({ id: 'core-b', name: 'Beta 核心', qty: cores.beta!, quality: 'special', glyph: 'ico-tact' })
  }
  if ((cores.gamma ?? 0) > 0) {
    slots.push({ id: 'core-g', name: 'Gamma 核心', qty: cores.gamma!, quality: 'special', glyph: 'ico-tact' })
  }
  if (essences > 0) {
    slots.push({ id: 'essence', name: '虫洞谜质', qty: essences, quality: 'epic', glyph: 'ico-tact' })
  }
  if (slots.length === 0) return null
  return (
    <div className="app-wh-settle-slots is-pop">
      {slots.map((s) => (
        <div key={s.id} className={`app-wh-settle-slot is-${s.quality}`}>
          <div className="app-wh-settle-slot-ico">
            <Glyph
              name={s.glyph}
              size={20}
              color={
                s.quality === 'epic'
                  ? 'rgb(var(--wui-gold))'
                  : s.quality === 'special'
                    ? 'rgb(var(--wui-x146))'
                    : 'rgb(var(--wui-accent))'
              }
            />
          </div>
          <div className="app-wh-settle-slot-name" title={s.name}>{s.name}</div>
          <div className="app-wh-settle-slot-qty">×{s.qty.toLocaleString('zh-CN')}</div>
        </div>
      ))}
    </div>
  )
}
