/** 船长2026-10-19批准的三件装备字段，供历史全值守恒用例叠加；不读取待测数据。 */
export function applyApprovedEquipmentRetune(data: { groups: object }): void {
  for (const row of Object.values(data.groups).flat() as Array<Record<string, unknown>>) {
    if (row.id === 'mod-lair-blink-r') row.slot = 'support'
    if (row.id === 'mod-wh-a-shield') row.cpuUse = 36
    if (row.id === 'mod-lair-laser-c') Object.assign(row, {
      maxRangeM: 2500, reloadMs: 3800, acidOnHit: { cutPct: .05, durationMs: 15000 },
    })
  }
}
