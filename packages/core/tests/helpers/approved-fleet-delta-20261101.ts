/** 已确认的指挥成本、电子战与后勤字段；固定期望不读取待测目录。 */
const COMMAND_COSTS: Readonly<Record<string, number>> = {
  sandcat: 8, burrower: 10, whale: 15, pioneer: 20, 'whale-king': 20,
  'sh-humpback': 28, 'sh-bowhead': 28, 'sh-manatee': 20, 'sh-colossal': 40,
  'sh-falconet': 7, 'sh-shrike': 10, 'sh-tigershark': 12, 'sh-mako': 15, 'sh-whiteshark': 18,
  'sh-swarm': 18, 'sh-sentinel': 24, 'sh-thresher': 20, 'sh-electricray': 20, 'sh-hammerhead': 20,
  'sh-bullshark': 20, 'sh-nautilus': 21, 'sh-tortoise': 14, 'sh-hawksbill': 20, 'sh-xuanwu': 28,
  'sh-megalodon': 30, 'sh-orca': 32, 'sh-helicoprion': 29, 'sh-dunkleosteus': 45,
  'sh-flyingfish': 15, 'sh-sailfish': 20, 'sh-swordfish': 28,
  'sh-wh-a-frigate': 13, 'sh-wh-a-destroyer': 20, 'sh-wh-a-cruiser': 24,
  'sh-wh-c-frigate': 11, 'sh-wh-c-destroyer': 15, 'sh-wh-c-cruiser': 24,
  'sh-wh-d-frigate': 12, 'sh-wh-d-destroyer': 18, 'sh-wh-d-cruiser': 22,
  'sh-wh-e-frigate': 14, 'sh-wh-e-destroyer': 20, 'sh-wh-e-carrier': 28,
  'sh-wh-g-frigate': 12, 'sh-wh-g-destroyer': 18, 'sh-wh-g-cruiser': 25,
}

export function applyApprovedFleetShipDelta(rows: Array<{ id: string }>): void {
  for (const value of rows) {
    const row = value as Record<string, unknown>
    const cost = COMMAND_COSTS[value.id]
    if (cost === undefined) throw new Error(`指挥成本期望缺少舰船：${value.id}`)
    row.commandCost = cost
    const droneHullChanges: Readonly<Record<string, Record<string, number>>> = {
      'sh-swarm': { shieldHp: 310, cpu: 275, droneBayM3: 200, maxSpeedMps: 320 },
      'sh-sentinel': { shieldHp: 515, cpu: 360, droneBayM3: 360, maxSpeedMps: 300 },
      'sh-wh-e-destroyer': { cpu: 330 },
      'sh-wh-e-carrier': { cpu: 480 },
    }
    Object.assign(row, droneHullChanges[value.id] ?? {})
    if (['sh-wh-a-frigate', 'sh-wh-d-frigate'].includes(value.id)) {
      row.rangeEwBonus = 40
      row.rangeEwEquipmentBonusPct = .25
    }
    if (value.id === 'sh-wh-g-destroyer') {
      delete row.repairPulseTargetsFleet
      row.repairOutputBonusPct = .5
      row.droneBayM3 = 80
    }
  }
}

export function applyApprovedFleetModuleDelta(rows: Array<{ id: string }>): void {
  const changes: Readonly<Record<string, object>> = {
    'mod-shieldfield-2': { shieldFieldPct: .1, shieldFieldMs: 12000, cpuUse: 50 },
    'mod-shieldfield-3': { shieldFieldPct: .1, shieldFieldMs: 10000, cpuUse: 75 },
    'mod-lock-1': { lockTargetChance: .6 },
    'mod-lock-2': { lockTargetChance: .7 },
    'mod-lock-3': { lockTargetChance: .8 },
    'mod-wh-d-lock': { lockTargetChance: .6 },
    'mod-lair-ecm-h': { rangeEwStrength: 40 },
  }
  for (const row of rows) Object.assign(row, changes[row.id] ?? {})
}

export function applyApprovedEnemyEwDelta(rows: Array<{ id: string }>): void {
  for (const row of rows) {
    if (['foe-pirate-raider', 'foe-h-ink-jammer'].includes(row.id)) Object.assign(row, { rangeEwBonus: 40, rangeEwEquipmentBonusPct: .25 })
    if (row.id === 'foe-mount-ink-range-debuff') Object.assign(row, { rangeDebuff_strength: 120 })
    if (row.id === 'foe-mount-d-range-debuff') Object.assign(row, { rangeDebuff_strength: 80 })
  }
}

export function addApprovedRepairDrone(rows: Array<{ id: string }>): void {
  if (rows.some(row => row.id === 'drone-repair-mil')) throw new Error('修理无人机已在基线内，不应重复追加')
  const at = rows.findIndex(row => row.id === 'drone-jawclaw')
  rows.splice(at < 0 ? rows.length : at, 0, {
    id: 'drone-repair-mil', kind: 'drone', droneClass: 'repair', unitM3: 40, baseSellPriceIsk: 42000, cpuUse: 8,
    repairDrone: true, repairKit: 'repairkit-mil', repairArmorHp: 20, repairHullHp: 20, repairIntervalMs: 20000,
    defense: { shieldHp: 30, armorHp: 20, hullHp: 40, evasion: .2 },
  } as { id: string })
}
