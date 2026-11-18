import type { ReactNode } from 'react'
import type { ShipRole } from '@whale/core'
import { FOE_ART, SHIP_ART, foeShipArtOf } from './shipArt'
import { mountsOf } from './shipMounts'

function hullPath(role: ShipRole): string {
  switch (role) {
    case 'armed':
      return 'M14 36 L70 8 L88 16 L124 30 L70 32 L70 24 L52 34 L14 36 Z M70 24 L70 32 L70 32'
    case 'armored':
      return 'M20 12 h86 a8 8 0 0 1 8 8 v24 a8 8 0 0 1 -8 8 h-86 a8 8 0 0 1 -8 -8 v-24 a8 8 0 0 1 8 -8 z M28 24 h64 M20 40 h84'
    case 'hauler':
      return 'M8 22 h96 l14 6 v8 l-14 6 h-96 a6 6 0 0 1 -6 -6 v-8 a6 6 0 0 1 6 -6 z M20 28 h70 M20 36 h70'
    default:
      return 'M22 16 h78 a6 6 0 0 1 6 6 v20 a6 6 0 0 1 -6 6 h-78 a6 6 0 0 1 -6 -6 v-20 a6 6 0 0 1 6 -6 z M28 26 h68 M28 34 h68 M44 8 h20 l4 8 h-28 z'
  }
}

const EXHAUST_LEGACY = 'M10 24 L2 30 L10 36 L14 30 Z'

const EXHAUST = 'M17.1 41.3 L3.4 51.6 L17.1 61.9 L24 51.6 Z'
const EXHAUST_GAP = 5

function Exhausts({ shipId, foeKey }: { shipId?: string; foeKey?: string }) {
  const mounts = mountsOf(shipId, foeKey)
  if (!mounts) {
    return <path className="app-sprite-exhaust" d={EXHAUST} fill="currentColor" stroke="none" opacity="0.85" />
  }
  return (
    <>
      {mounts.engines.map((p, i) => (
        <g key={i} transform={`translate(${p.x - 24 - EXHAUST_GAP} ${p.y - 51.6})`}>
          <path className="app-sprite-exhaust" d={EXHAUST} fill="currentColor" stroke="none" opacity="0.85" />
        </g>
      ))}
    </>
  )
}

const VB = '0 0 240 110'
const FLIP_ORIGIN = '120px 55px'

export function ShipSprite({
  role,
  shipId,
  foeKey,
  name,
  flip = false,
  accent = 'rgb(var(--wui-dim))',
  engine = true,
  size = 150,
}: {
  role?: ShipRole
  shipId?: string
  foeKey?: string
  name?: string
  flip?: boolean
  accent?: string
  engine?: boolean
  size?: number
}) {
  const art: ReactNode | undefined = shipId
    ?
      (SHIP_ART[shipId] ?? (foeKey ? foeShipArtOf(shipId, foeKey) : undefined))
    : foeKey
      ? FOE_ART[foeKey]
      : undefined
  if (art) {
    return (
      <div className="app-sprite" style={{ width: size, height: Math.round(size * 0.46) }}>
        <svg viewBox={VB} width="100%" height="100%" fill="none" aria-hidden="true">
          <g
            style={{
              transform: `scale(${flip ? -1 : 1}, 1)`,
              transformOrigin: FLIP_ORIGIN, // 绕新画布中心翻转（配合 .app-sprite svg g 的 transform-box: view-box）
              color: accent,
            }}
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinejoin="round"
          >
            {engine ? <Exhausts shipId={shipId} foeKey={foeKey} /> : null}
            {art}
          </g>
        </svg>
        {name ? <div className="app-sprite-name">{name}</div> : null}
      </div>
    )
  }

  return (
    <div className="app-sprite" style={{ width: size, height: Math.round(size * 0.46) }}>
      <svg viewBox="0 0 140 64" width="100%" height="100%" fill="none" aria-hidden="true">
        <g
          style={{
            transform: `scale(${flip ? -1 : 1}, 1)`,
            transformOrigin: '70px 32px', // 绕舰体中心翻转（配合 transform-box: view-box）
            color: accent,
          }}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        >
          {engine ? <path className="app-sprite-exhaust" d={EXHAUST_LEGACY} fill="currentColor" stroke="none" opacity="0.85" /> : null}
          <path d={hullPath(role ?? 'industrial')} />
        </g>
      </svg>
      {name ? <div className="app-sprite-name">{name}</div> : null}
    </div>
  )
}


export function shipArtSizeOf(shipId?: string): { w: number; h: number; hit: boolean } {
  const hit = shipId !== undefined && SHIP_ART[shipId] !== undefined
  return hit ? { w: 240, h: 110, hit } : { w: 140, h: 64, hit }
}

export function ShipSpriteShape({
  role,
  shipId,
  size = 22,
  flip = false,
  engine = false,
}: {
  role?: ShipRole
  shipId?: string
  size?: number
  flip?: boolean
  engine?: boolean
}) {
  const art: ReactNode | undefined = shipId ? SHIP_ART[shipId] : undefined
  const { w, h } = shipArtSizeOf(shipId)
  const s = size / w
  const place = `scale(${s.toFixed(5)}) translate(${-w / 2},${-h / 2})`
  const mirror = flip ? ` scale(-1,1) translate(${-w},0)` : ''
  return (
    <g
      className="app-wh-ship-shape"
      transform={place + mirror}
      stroke="currentColor"
      strokeWidth={art ? 2.2 : 2}
      strokeLinejoin="round"
      fill="none"
    >
      {engine ? <Exhausts shipId={shipId} /> : null}
      {art ?? <path d={hullPath(role ?? 'industrial')} />}
    </g>
  )
}
