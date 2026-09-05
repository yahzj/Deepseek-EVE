/**
 * T9 副空间站建站点（内容层）。
 * 位置：红环航道（galaxy-redring，出产 希莫非特/灼烧岩）、烬火星区（galaxy-cinder，出产 蓝霜冰）。
 * 档位数值 = 该星系正常采集约 2~4 小时量级的草案（12s/轮 × 10 单位 × ~75% 有效率折算），
 * 交付后由 balance 校准终值（见 docs/design/t9 交付报告）。
 */
import type { StationSiteDef } from '@whale/core'

/** 全量建站点（顺序即任务中心展示顺序） */
export const STATION_SITES: readonly StationSiteDef[] = [
  {
    id: 'site-redring',
    name: '红环前哨站',
    galaxyId: 'galaxy-redring',
    standingReq: 0,
    acceptItemIds: ['ore-hemorphite', 'ore-scorched'],
    tiers: [
      { name: '奠基', count: 2_000, unlockDesc: '可停靠并卸货入仓库' },
      { name: '完善', count: 4_000, unlockDesc: '开放维修与补给（弹药/修理组件）' },
      { name: '建成', count: 2_000, unlockDesc: '开放换驾驶；并入空间站清单' },
    ],
    introDialogueId: 'dlg-redring-intro',
    doneDialogueId: 'dlg-redring-done',
    description:
      '红环航道是深空航线枢纽，却常年被海盗把持。协会基建部拟在此建一座前哨站：以本星系出产的矿石筑垒，分三档交付，边交边生效。',
  },
  {
    id: 'site-cinder',
    name: '烬火前哨站',
    galaxyId: 'galaxy-cinder',
    standingReq: 0,
    acceptItemIds: ['ice-frost'],
    tiers: [
      { name: '奠基', count: 2_500, unlockDesc: '可停靠并卸货入仓库' },
      { name: '完善', count: 5_000, unlockDesc: '开放维修与补给（弹药/修理组件）' },
      { name: '建成', count: 2_500, unlockDesc: '开放换驾驶；并入空间站清单' },
    ],
    introDialogueId: 'dlg-cinder-intro',
    doneDialogueId: 'dlg-cinder-done',
    description:
      '烬火星区深处的高危采集区需要一座落脚站。基建部委托以蓝霜冰为主要建材：冰层致密、就地可得，分三档交付。',
  },
]

/** 建站点目录（引擎用） */
export function buildStationCatalog(): ReadonlyMap<string, StationSiteDef> {
  return new Map(STATION_SITES.map((s) => [s.id, s]))
}
