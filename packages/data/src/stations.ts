/**
 * T9 副空间站建站点（内容层）。
 * 位置：红环航道（galaxy-redring）、烬火星区（galaxy-cinder）。
 * 2026-09-09（船长定）：建站改为**逐档材料单**——每档一张"物品 × 数量"清单，逐项交齐才升档；
 * 建材只收精炼矿物（三钛合金/类银超金属等），**排除原矿**；烬火为二阶段目标站，总量约为旧口径 ×2，
 * 三钛合金"大单"与红环错档（红环 = 完善档、烬火 = 奠基档）。
 * 2026-09-08（船长定）：建成前不视为任何站点——不停靠、不提供任何站内功能；
 * 全部档位完成（建成）后一次性并入空间站网络并开放全部功能。
 */
import type { StationSiteDef } from '@whale/core'

/** 全量建站点（顺序即任务中心展示顺序） */
export const STATION_SITES: readonly StationSiteDef[] = [
  {
    id: 'site-redring',
    name: '红环前哨站',
    galaxyId: 'galaxy-redring',
    standingReq: 0,
    tiers: [
      {
        name: '奠基',
        bill: [
          { itemId: 'min-pyerite', count: 1_500 },
          { itemId: 'min-mexallon', count: 500 },
        ],
        unlockDesc: '施工推进：地基与主体框架搭建（站内功能统一在建成后开放）',
      },
      {
        name: '完善',
        bill: [
          { itemId: 'min-tritanium', count: 5_000 },
          { itemId: 'min-nocxium', count: 1_000 },
        ],
        unlockDesc: '施工推进：设备安装与系统调试（站内功能统一在建成后开放）',
      },
      {
        name: '建成',
        bill: [
          { itemId: 'min-isotope', count: 1_200 },
          { itemId: 'min-starcore', count: 800 },
        ],
        unlockDesc: '副站建成：并入空间站网络，开放泊位/卸货/维修/补给/换驾驶及全部站内功能',
      },
    ],
    introDialogueId: 'dlg-redring-intro',
    doneDialogueId: 'dlg-redring-done',
    description:
      '红环航道是深空航线枢纽，却常年被海盗把持。协会基建部拟在此建一座前哨站：以精炼矿物分三档施工，建成后并入协会基地网络。',
  },
  {
    id: 'site-cinder',
    name: '烬火前哨站',
    galaxyId: 'galaxy-cinder',
    standingReq: 0,
    tiers: [
      {
        name: '奠基',
        bill: [
          { itemId: 'min-tritanium', count: 9_000 },
          { itemId: 'min-pyerite', count: 1_000 },
        ],
        unlockDesc: '施工推进：地基与主体框架搭建（站内功能统一在建成后开放）',
      },
      {
        name: '完善',
        bill: [
          { itemId: 'min-nocxium', count: 3_000 },
          { itemId: 'min-mexallon', count: 2_000 },
          { itemId: 'min-isotope', count: 1_000 },
        ],
        unlockDesc: '施工推进：设备安装与系统调试（站内功能统一在建成后开放）',
      },
      {
        name: '建成',
        bill: [
          { itemId: 'min-starcore', count: 2_000 },
          { itemId: 'min-darkiron', count: 2_000 },
        ],
        unlockDesc: '副站建成：并入空间站网络，开放泊位/卸货/维修/补给/换驾驶及全部站内功能',
      },
    ],
    introDialogueId: 'dlg-cinder-intro',
    doneDialogueId: 'dlg-cinder-done',
    description:
      '烬火星区深处的高危采集区需要一座落脚站。基建部委托以精炼矿物分三档施工：地基尤其吃重三钛合金，越往后用料越珍稀，建成后并入协会基地网络。',
  },
]

/** 建站点目录（引擎用） */
export function buildStationCatalog(): ReadonlyMap<string, StationSiteDef> {
  return new Map(STATION_SITES.map((s) => [s.id, s]))
}
