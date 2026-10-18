/**
 * T9 副空间站建站点（内容层）。
 * 位置：红环航道（galaxy-redring）、烬火星区（galaxy-cinder）。
 * 船长2026-10-18确认：大宗钛钢保留，其余直接建材改为基础零件；分档交付，排除原矿。
 * 钛钢与红环/烬火施工档的错位保持；具体价值目标由专项测试和工具核验。
 * 2026-09-08（船长定）：建成前不视为任何站点——不停靠、不提供任何站内功能；
 * 全部档位完成（建成）后一次性并入空间站网络并开放全部功能。
 */
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

/** 全量建站点（顺序即任务中心展示顺序） */
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

/** 建站点目录（引擎用） */
export function buildStationCatalog(): ReadonlyMap<string, StationSiteDef> {
  return new Map(STATION_SITES.map((s) => [s.id, s]))
}
