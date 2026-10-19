/** 船长2026-10-19确认的鱼雷舰加成转移，历史全值守恒仅叠加这两个批准字段。 */
export function applyApprovedTorpedoShipDelta(rows: Array<{ id: string; powerBonus?: number; weaponFamilyBonus?: object }>): void {
  for (const row of rows) {
    const explosive = row.id === 'sh-wh-e-frigate' ? .3 : row.id === 'sh-wh-g-cruiser' ? .4 : undefined
    if (explosive === undefined) continue
    row.powerBonus = .25
    row.weaponFamilyBonus = { ...row.weaponFamilyBonus, explosive }
  }
}
