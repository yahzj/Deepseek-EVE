import type { MapTab } from '../pages/MapPage'

export interface ActivityGoTarget {
  page: string
  mapTab?: MapTab
  taskTab?: string
  labelId: string
}

export function goFor(kind: string): ActivityGoTarget {
  switch (kind) {
    case 'mining':
      return { page: 'map', mapTab: 'mine', labelId: 'ui.MapPage.003' }
    case 'scan':
    case 'salvage':
    case 'expedition':
    case 'return':
    case 'transit':
    case 'standby':
    case 'wormhole':
      return { page: 'map', mapTab: 'star', labelId: 'ui.MapPage.002' }
    case 'courier':
      return { page: 'task', taskTab: 'courier', labelId: 'ui.App.008' }
    case 'hauling':
      return { page: 'map', mapTab: 'haul', labelId: 'ui.MapPage.006' }
    case 'loop':
      return { page: 'map', mapTab: 'bounty', labelId: 'ui.ActivityBar.016' }
    case 'invasion-loop':
      return { page: 'map', mapTab: 'star', labelId: 'ui.MapPage.002' }
    case 'manufacture':
    case 'refine':
    case 'lab':
      return { page: 'industry', labelId: 'ui.App.006' }
    case 'train':
      return { page: 'skills', labelId: 'ui.App.007' }
    default:
      return { page: 'map', mapTab: 'star', labelId: 'ui.MapPage.002' }
  }
}
