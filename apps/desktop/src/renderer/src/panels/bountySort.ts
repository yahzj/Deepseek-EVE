
export type BountySortKey = 'danger' | 'distance' | 'galaxy' | 'reward' | 'standing' | 'name'

export interface BountySortRow {
  id: string
  name: string
  security: number
  dist: number
  rewardIsk: number
  standingGain: number
  galaxyName: string
}

function byNameOf(x: BountySortRow, y: BountySortRow): number {
  return x.name.localeCompare(y.name, 'zh-Hans-CN') || x.id.localeCompare(y.id)
}

export function bountyComparatorOf(
  sort: BountySortKey,
  pinnedIds: ReadonlySet<string>,
): (x: BountySortRow, y: BountySortRow) => number {
  return (x, y) => {
    const px = pinnedIds.has(x.id) ? 0 : 1
    const py = pinnedIds.has(y.id) ? 0 : 1
    if (px !== py) return px - py
    if (sort === 'danger') {
      if (x.security !== y.security) return y.security - x.security
      return byNameOf(x, y)
    }
    if (sort === 'distance') {
      if (x.dist !== y.dist) return x.dist - y.dist
      return byNameOf(x, y)
    }
    if (sort === 'galaxy') {
      const g = x.galaxyName.localeCompare(y.galaxyName, 'zh-Hans-CN')
      if (g !== 0) return g
      return byNameOf(x, y)
    }
    if (sort === 'reward') {
      if (x.rewardIsk !== y.rewardIsk) return y.rewardIsk - x.rewardIsk
      return byNameOf(x, y)
    }
    if (sort === 'standing') {
      if (x.standingGain !== y.standingGain) return y.standingGain - x.standingGain
      return byNameOf(x, y)
    }
    return byNameOf(x, y)
  }
}
