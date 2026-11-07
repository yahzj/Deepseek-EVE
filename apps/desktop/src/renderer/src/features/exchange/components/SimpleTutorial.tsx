/**
 * 简单投资 · 新手引导。
 * 首次进入自动出现 7 步：遮罩挖孔高亮 + 气泡，全程大白话；可跳过，看完写 localStorage 不再弹。
 */
import { useEffect, useMemo, useState } from 'react'
import { T } from '../texts'

const TUTORIAL_KEY = 'whale-idle:exch-tutorial-v1'

interface Step {
  selector: string | null
  text: string
}

const STEPS: Step[] = [
  { selector: '.ex-simple-col-left', text: T.tutStep1 },
  { selector: '.ex-simple-chart-card', text: T.tutStep2 },
  { selector: '.ex-simple-trade-tabs', text: T.tutStep3 },
  { selector: '.ex-simple-chips', text: T.tutStep4 },
  { selector: '.ex-simple-big-action-btn', text: T.tutStep5 },
  { selector: '.ex-topbar-status', text: T.tutRules },
  { selector: '.ex-simple-side-switch', text: T.tutStep6 },
  { selector: null, text: T.tutStep7 },
]

export function SimpleTutorial() {
  const [open, setOpen] = useState(false)
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    try {
      if (window.localStorage.getItem(TUTORIAL_KEY) === '1') return
    } catch {
      return
    }
    setOpen(true)
  }, [])

  useEffect(() => {
    if (!open) return
    const step = STEPS[index]
    const update = (): void => {
      if (step?.selector == null) {
        setRect(null)
        return
      }
      const el = document.querySelector(step.selector)
      setRect(el ? el.getBoundingClientRect() : null)
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [open, index])

  const content = useMemo(() => {
    const lines = (STEPS[index]?.text ?? '').split('\n')
    return { title: lines[0] ?? '', body: lines.slice(1).join('\n') }
  }, [index])

  if (!open) return null

  const finish = (): void => {
    setOpen(false)
    try {
      window.localStorage.setItem(TUTORIAL_KEY, '1')
    } catch {
      /* ignore */
    }
  }

  const bubbleStyle = rect
    ? (() => {
        const width = 320
        const gap = 14
        const below = window.innerHeight - rect.bottom > 210 || rect.top < 200
        const top = below ? rect.bottom + gap : Math.max(12, rect.top - gap - 180)
        const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.left + rect.width / 2 - width / 2))
        return { top, left, width }
      })()
    : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 360 }

  return (
    <div className="ex-tutorial" role="dialog" aria-modal="true" aria-label={content.title}>
      {rect ? (
        <div
          className="ex-tutorial-spot"
          style={{
            left: rect.left - 4,
            top: rect.top - 4,
            width: rect.width + 8,
            height: rect.height + 8,
          }}
        />
      ) : (
        <div className="ex-tutorial-dim" />
      )}
      <div className="ex-tutorial-bubble" style={bubbleStyle}>
        <div className="ex-tutorial-step">
          STEP {String(index + 1).padStart(2, '0')} // {STEPS.length}
        </div>
        <div className="ex-tutorial-title">{content.title}</div>
        <div className="ex-tutorial-body">{content.body}</div>
        <div className="ex-tutorial-actions">
          <button type="button" className="ex-tutorial-btn" onClick={finish}>
            {T.tutSkip}
          </button>
          {index > 0 ? (
            <button type="button" className="ex-tutorial-btn" onClick={() => setIndex((n) => Math.max(0, n - 1))}>
              {T.tutBack}
            </button>
          ) : null}
          <button
            type="button"
            className="ex-tutorial-btn is-primary"
            onClick={() => (index >= STEPS.length - 1 ? finish() : setIndex((n) => n + 1))}
          >
            {index >= STEPS.length - 1 ? T.tutDone : T.tutNext}
          </button>
        </div>
      </div>
    </div>
  )
}
