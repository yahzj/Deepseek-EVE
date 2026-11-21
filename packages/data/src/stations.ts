import type { StationSiteDef, StationTierDef } from '@whale/core'
import { ITEMS } from './items'

const itemValues = new Map(ITEMS.map(item => [item.id, item.baseSellPriceIsk ?? 0]))

function stationTier(
  name: string,
  bill: StationTierDef['bill'],
  unlockDesc: string,
  previousUnitValues: Readonly<Record<string, number>>,
): StationTierDef {
  return {
    name, bill, unlockDesc,
    legacyDeliveredCredit: {
      previousUnitValues,
      currentUnitValues: Object.fromEntries(bill.map(row => [row.itemId, itemValues.get(row.itemId) ?? 0])),
    },
  }
}

export const STATION_SITES: readonly StationSiteDef[] = [
  {
    id: 'site-redring',
    name: '红环前哨站',
    galaxyId: 'galaxy-redring',
    standingReq: 0,
    tiers: [
      stationTier('奠基', [
        { itemId: 'part-frame', count: 8_000 },
        { itemId: 'part-armor-plate', count: 3_360 },
      ], '施工推进：地基与主体框架搭建（站内功能统一在建成后开放）', {
        'min-pyerite': 12, 'min-mexallon': 20,
      }),
      stationTier('完善', [
        { itemId: 'min-tritanium', count: 200_000 },
        { itemId: 'part-armor-plate', count: 1_080 },
        { itemId: 'part-cable', count: 6_000 },
      ], '施工推进：设备安装与系统调试（站内功能统一在建成后开放）', {
        'min-nocxium': 90, 'part-frame': 145,
      }),
      stationTier('建成', [
        { itemId: 'part-frame', count: 4_000 },
        { itemId: 'part-armor-plate', count: 3_000 },
        { itemId: 'part-circuit', count: 6_000 },
        { itemId: 'part-coolant', count: 6_000 },
        { itemId: 'part-gyro', count: 1_000 },
        { itemId: 'part-lens', count: 1_000 },
      ], '副站建成：并入空间站网络，开放泊位/卸货/维修/补给/换驾驶及全部站内功能', {
        'min-isotope': 55, 'min-starcore': 245,
      }),
    ],
    introDialogueId: 'dlg-redring-intro',
    doneDialogueId: 'dlg-redring-done',
    description:
      '红环航道是深空航线枢纽，却常年被海盗把持。协会基建部拟在此建一座前哨站：以精炼原材料分三档施工，建成后并入协会基地网络。',
  },
  {
    id: 'site-cinder',
    name: '烬火前哨站',
    galaxyId: 'galaxy-cinder',
    standingReq: 0,
    tiers: [
      stationTier('奠基', [
        { itemId: 'min-tritanium', count: 1_000_000 },
        { itemId: 'part-frame', count: 10_000 },
        { itemId: 'part-armor-plate', count: 2_200 },
      ], '施工推进：地基与主体框架搭建（站内功能统一在建成后开放）', {
        'min-pyerite': 12,
      }),
      stationTier('完善', [
        { itemId: 'part-frame', count: 30_000 },
        { itemId: 'part-armor-plate', count: 20_000 },
        { itemId: 'part-cable', count: 30_000 },
      ], '施工推进：设备安装与系统调试（站内功能统一在建成后开放）', {
        'min-nocxium': 90, 'min-mexallon': 20, 'min-isotope': 55,
      }),
      stationTier('建成', [
        { itemId: 'part-frame', count: 20_000 },
        { itemId: 'part-armor-plate', count: 15_000 },
        { itemId: 'part-circuit', count: 30_000 },
        { itemId: 'part-coolant', count: 30_000 },
        { itemId: 'part-gyro', count: 5_000 },
        { itemId: 'part-lens', count: 5_000 },
      ], '副站建成：并入空间站网络，开放泊位/卸货/维修/补给/换驾驶及全部站内功能', {
        'min-starcore': 245, 'min-darkiron': 780,
      }),
    ],
    introDialogueId: 'dlg-cinder-intro',
    doneDialogueId: 'dlg-cinder-done',
    description:
      '烬火星区深处的高危采集区需要一座落脚站。基建部委托以精炼原材料分三档施工：地基尤其吃重钛钢合金，越往后用料越珍稀，建成后并入协会基地网络。',
  },
]

export function buildStationCatalog(): ReadonlyMap<string, StationSiteDef> {
  return new Map(STATION_SITES.map((s) => [s.id, s]))
}
