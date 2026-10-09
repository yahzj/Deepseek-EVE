import type { StellarPlanetKind, StellarSystem } from '@whale/core'
import rocky from '../assets/stellar/rocky.png'
import desert from '../assets/stellar/desert.png'
import ice from '../assets/stellar/ice.png'
import ocean from '../assets/stellar/ocean.png'
import lava from '../assets/stellar/lava.png'
import temperate from '../assets/stellar/temperate.png'
import gas from '../assets/stellar/gas.png'
import yellow from '../assets/stellar/star-yellow.png'
import red from '../assets/stellar/star-red.png'
import blue from '../assets/stellar/star-blue.png'
import white from '../assets/stellar/star-white.png'
import blackHole from '../assets/stellar/black-hole.png'
import license from '../assets/stellar/LICENSE-PixelPlanets.txt?url'

export const STELLAR_ASSET_LICENSE_URL = license

// 外框/本体比来自原生导出像素；带环图不能按外框当本体尺寸。
export const STELLAR_PLANET_ASSETS: Record<StellarPlanetKind, { url: string; span: number }> = {
  rocky: { url: rocky, span: 288 / 256 }, desert: { url: desert, span: 288 / 256 },
  ice: { url: ice, span: 288 / 256 }, ocean: { url: ocean, span: 288 / 256 },
  lava: { url: lava, span: 288 / 256 }, temperate: { url: temperate, span: 288 / 256 },
  gas: { url: gas, span: 800 / 256 },
}
export const stellarBodyRadius = (kind: StellarPlanetKind): number => kind === 'gas' ? 22 : 18
export const stellarDisplayRadius = (kind: StellarPlanetKind, unit: number): number => Math.max(stellarBodyRadius(kind), (kind === 'gas' ? 18 : 14) * unit)
export function stellarStarAsset(system: Pick<StellarSystem, 'starClass'>) {
  if (system.starClass === 'none') return null
  if (system.starClass === 'black-hole') return { url: blackHole, span: 544 / 256 }
  const url = system.starClass === 'red' || system.starClass === 'orange' ? red
    : system.starClass === 'blue' || system.starClass === 'neutron' ? blue
    : system.starClass === 'white' ? white : yellow
  return { url, span: 544 / 256 }
}
