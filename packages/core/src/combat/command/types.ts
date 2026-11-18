/** 出发快照与意向编队分开；战斗结束后直到返航完成仍按本名单锁舰。 */
export interface CombatSortie {
  version: 1
  leaderShipId: string
  shipIds: string[]
  /** 本次出发锁定的距离与预设来源；旧在途记录可缺省。 */
  range?: import('../../fleetRange').FleetRangeSettings
}

export interface ShipCommandDef {
  /** 固定船型指挥点，不随技能或配装改变。 */
  commandCost?: number
}
