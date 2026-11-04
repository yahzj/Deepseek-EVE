import { applyApprovedFleetModuleDelta } from './approved-fleet-delta-20261101'

/** 后续批准的精确装备字段，供历史全值守恒用例叠加；不读取待测数据。 */
export function applyApprovedEquipmentRetune(data: { groups: object }): void {
  for (const row of Object.values(data.groups).flat() as Array<Record<string, unknown>>) {
    if (row.id === 'mod-lair-blink-r') row.slot = 'support'
    if (row.id === 'mod-wh-a-shield') row.cpuUse = 36
    if (row.id === 'mod-lair-armor-c') row.repairArmorHp = 10
    if (row.id === 'mod-gravekeeper-crisis' && row.crisisOverload) Object.assign(row.crisisOverload, {
      damageBonusPct: .25, droneCycleCutPct: .25, speedPenaltyPct: .4,
    })
    if (row.id === 'mod-lair-laser-c') Object.assign(row, {
      maxRangeM: 2500, reloadMs: 3800, acidOnHit: { cutPct: .05, durationMs: 15000 },
    })
  }
  applyApprovedFleetModuleDelta(Object.values(data.groups).flat())
}
