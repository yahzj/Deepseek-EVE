import type { CSSProperties } from 'react'
import { DMG_COLOR, FOE_ACCENT } from '../ui/tones'

export const ACID_FX_LIFE_MS = 900

export interface AcidFx {
  key: number
  tag: string
  kind: 'burst' | 'impact' | 'coating'
  x: number
  y: number
  size: number
  born: number
  delay: number
}

const SHARDS = [0, 43, 91, 137, 182, 228, 274, 319]

export function AcidEffect({ effect }: { effect: AcidFx }) {
  const size = Math.max(56, effect.size * (effect.kind === 'burst' ? 1.9 : 1.15))
  return (
    <svg
      className={`app-bts-acid is-${effect.kind}`}
      data-acid-kind={effect.kind}
      data-acid-tag={effect.tag}
      viewBox="-100 -100 200 200"
      aria-hidden="true"
      style={{ left: effect.x, top: effect.y, width: size, height: size,
        color: FOE_ACCENT.C, '--acid-ms': `${ACID_FX_LIFE_MS}ms`, '--acid-delay': `${effect.delay}ms`,
        '--acid-impact': DMG_COLOR.kinetic } as CSSProperties}
    >
      {effect.kind === 'burst' ? (
        <>
          <g className="acid-core"><path d="M-17 -8 L-8 -20 L12 -16 L24 1 L12 18 L-10 20 L-23 4 Z" /><path d="M-11 -4 L3 -11 L15 4 L-2 12 Z" /></g>
          <g className="acid-ring"><circle r="43" /><path d="M-61 0 A61 61 0 0 1 0 -61 M61 0 A61 61 0 0 1 0 61" /></g>
          {SHARDS.map((angle, index) => (
            <g key={angle} transform={`rotate(${angle})`}>
              <g className="acid-shard" style={{ '--acid-travel': `${36 + index % 3 * 12}px` } as CSSProperties}>
                <path d="M12 -3 L29 -7 L35 0 L20 5 Z" />
                <path className="acid-drop" d="M24 12 Q35 7 42 13 Q34 23 24 12 Z" />
              </g>
            </g>
          ))}
        </>
      ) : effect.kind === 'impact' ? (
        <g className="acid-impact">
          <path d="M-32 -10 L-12 -7 L-17 -24 M30 -12 L11 -5 L20 -27 M-29 22 L-11 6 L-5 29 M29 21 L10 6 L4 30" />
          <ellipse rx="26" ry="16" />
        </g>
      ) : (
        <g className="acid-coating">
          <path d="M-62 -18 Q-37 -36 -25 -14 M-49 23 Q-32 5 -12 28 M24 -19 Q44 -34 64 -12 M21 25 Q43 4 58 23" />
          <path className="acid-drop" d="M-44 -14 Q-31 -3 -42 10 Q-53 -3 -44 -14 Z M39 -11 Q52 1 41 16 Q29 2 39 -11 Z M-6 12 Q7 24 -4 37 Q-17 24 -6 12 Z" />
        </g>
      )}
    </svg>
  )
}
