export interface CombatSortie {
  version: 1
  leaderShipId: string
  shipIds: string[]
  /** 本次出发锁定的距离与预设来源；旧在途记录可缺省。 */
  range?: import('../../fleetRange').FleetRangeSettings
}

export interface ShipCommandDef {
  commandCost?: number
}
