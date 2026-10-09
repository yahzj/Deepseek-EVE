import type { StellarPlanetKind } from '@whale/core'
import { useState } from 'react'
import { STELLAR_PLANET_ASSETS } from './stellarAssets'

export const STELLAR_KIND_IDS = { single: 'ui.stellar.024', binary: 'ui.stellar.025', 'white-dwarf': 'ui.stellar.026', neutron: 'ui.stellar.027', 'black-hole': 'ui.stellar.028', rogue: 'ui.stellar.029' } as const
export const STELLAR_PLANET_KIND_IDS = { rocky: 'ui.stellar.030', desert: 'ui.stellar.031', ice: 'ui.stellar.032', ocean: 'ui.stellar.033', lava: 'ui.stellar.034', temperate: 'ui.stellar.035', gas: 'ui.stellar.036' } as const

/** 图案只使用已公开类型，不能根据隐藏资源或特性改变外形。 */
function StellarPlanetFallback({ kind }: { kind: StellarPlanetKind }) {
  return <g className={`app-stellar-planet-art is-${kind}`} aria-hidden="true">
    <circle className="planet-disc" r="10" />
    <path className="planet-night" d="M3-9.5C-2-5-2 5 3 9.5" />
    {kind === 'rocky' ? <><path d="M-7-4L-2-6 2-3 1 1-3 2-6-1M3 3L6 2 7 5" /><circle cx="4" cy="-4" r="1.5" /></> : null}
    {kind === 'desert' ? <><path d="M-8-4C-3-7 2-2 8-4M-9 1C-4-2 2 3 9 0M-7 5C-2 2 3 7 7 5" /></> : null}
    {kind === 'ice' ? <><path d="M-5-8L-2-3 2-1 4 4 2 8M-2-3L-7 0M2-1L7-5M4 4L8 5" /><path className="planet-thin" d="M-6 6L-3 2 0 3" /></> : null}
    {kind === 'ocean' ? <><path d="M-8-3Q-4-6 0-3T8-3M-9 2Q-4-1 0 2T9 2M-6 6Q-3 4 0 6T6 6" /></> : null}
    {kind === 'lava' ? <><path d="M-3-9L0-4-3-1 1 2 0 6 3 9M-3-1L-8 1M1 2L6-1 9 1" /><circle className="planet-hot" cx="4" cy="-5" r="1.5" /></> : null}
    {kind === 'temperate' ? <><path d="M-7-4L-3-6 1-4 0-1-4 1-6-1M3 1L7 2 6 6 2 7 1 4Z" /><path className="planet-thin" d="M-7 5Q-4 3-1 5M4-7L6-5" /></> : null}
    {kind === 'gas' ? <><path d="M-8-4Q0-1 8-4M-9 0Q0 4 9 0M-6 6Q0 4 6 6" /><ellipse className="planet-ring" rx="17" ry="4" transform="rotate(-25)" /></> : null}
  </g>
}

export function StellarPlanetArt({ kind }: { kind: StellarPlanetKind }) {
  const asset = STELLAR_PLANET_ASSETS[kind]
  const [failed, setFailed] = useState<string | null>(null)
  const size = 20 * asset.span
  return failed === asset.url ? <StellarPlanetFallback kind={kind} /> :
    <g className={`app-stellar-planet-raster is-${kind}`} aria-hidden="true">
      <image href={asset.url} x={-size / 2} y={-size / 2} width={size} height={size}
        data-stellar-asset={kind} onError={() => setFailed(asset.url)} />
    </g>
}

export function StellarPlanetPreview({ kind }: { kind: StellarPlanetKind }) {
  return <svg className="app-stellar-planet-preview" viewBox={kind === 'gas' ? '-34 -34 68 68' : '-15 -15 30 30'} aria-hidden="true">
    <path className="preview-cross" d={kind === 'gas' ? 'M-33 0H-29M29 0H33M0-33V-29M0 29V33' : 'M-14 0H-12M12 0H14M0-14V-12M0 12V14'} />
    <circle className="preview-orbit" r={kind === 'gas' ? 31 : 13} />
    <StellarPlanetArt kind={kind} />
  </svg>
}
