export interface CombatSortie {
  version: 1
  leaderShipId: string
  shipIds: string[]
}

export interface ShipCommandDef {
  commandCost?: number
}
