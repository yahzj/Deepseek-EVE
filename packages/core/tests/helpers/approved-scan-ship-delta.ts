/** 船长2026-10-17确认的舰船扫描/回避变化，供历史全值守恒测试精确叠加。 */
export function applyApprovedScanShipDelta(data: { groups: object }): void {
  const rows = Object.values(data.groups).flat() as Array<Record<string, unknown>>
  const evasion: Record<string, number> = { 'sh-shrike': .24, 'sh-tigershark': .25, 'sh-wh-d-frigate': .209 }
  for (const row of rows) {
    const id = String(row.id)
    if (evasion[id] !== undefined) row.evasion = evasion[id]
    if (id === 'sh-nautilus' || id === 'sh-wh-g-frigate') row.wormholeScanRadiusBonus = 2
  }
}
