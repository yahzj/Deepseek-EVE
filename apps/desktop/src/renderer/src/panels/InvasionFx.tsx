import type { ReactNode } from 'react'

export const ALARM_FLASH_MS = 800
export const ALARM_FLASH_COUNT = 3
export const ALARM_TOTAL_MS = ALARM_FLASH_MS * ALARM_FLASH_COUNT
export const FIREWORKS_MS = 4_200

export function InvasionAlarm({ kind }: { kind: 'start' | 'flagship' }): ReactNode {
  const beat = {
    animationDuration: `${ALARM_FLASH_MS}ms`,
    animationIterationCount: ALARM_FLASH_COUNT,
  }
  return (
    <div className={`app-alarm is-${kind}`} aria-hidden>
      <span className="app-alarm-band is-top" style={beat} />
      <span className="app-alarm-band is-bottom" style={beat} />
    </div>
  )
}

const BURSTS: Array<{ x: number; y: number; cyan?: boolean; delayMs: number }> = [
  { x: 210, y: 150, delayMs: 0 },
  { x: 500, y: 105, cyan: true, delayMs: 260 },
  { x: 790, y: 165, delayMs: 520 },
  { x: 330, y: 320, cyan: true, delayMs: 780 },
  { x: 665, y: 300, delayMs: 1_040 },
  { x: 500, y: 425, cyan: true, delayMs: 1_300 },
]

export function InvasionFireworks(): ReactNode {
  return (
    <div className="app-fireworks" aria-hidden>
      <svg viewBox="0 0 1000 620" preserveAspectRatio="xMidYMid slice">
        {BURSTS.map((b) => (
          <g
            key={`${b.x}-${b.y}`}
            className={`app-fw-burst${b.cyan ? ' is-cyan' : ''}`}
            transform={`translate(${b.x} ${b.y})`}
            style={{ animationDelay: `${b.delayMs}ms` }}
          >
            {/* 爆散环（向外扩张淡出） */}
            <circle className="app-fw-ring" r="14" />
            {/* 八向射线 */}
            <path
              className="app-fw-rays"
              d="M0 -10 L0 -20 M7 -7 L14 -14 M10 0 L20 0 M7 7 L14 14 M0 10 L0 20 M-7 7 L-14 14 M-10 0 L-20 0 M-7 -7 L-14 -14"
            />
            {/* 芯点 */}
            <circle className="app-fw-core" r="3.2" />
          </g>
        ))}
      </svg>
    </div>
  )
}
