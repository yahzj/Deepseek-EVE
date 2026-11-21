export type PlayerFacilityKind = 'power' | 'life-support' | 'service' | 'refinery' | 'research' | 'manufacturing' | 'training' | 'warning'
export type PlayerStationBill = Readonly<Record<string, number>>

/** 宿主负责真实库存/货舱与互斥；模块不拥有第二套生产或运输实现。 */
export interface PlayerStationHost {
  engineeringLevel(): number
  available(itemId: string): number
  /** 同步、原子扣料；失败必须不改库存。 */
  take(bill: PlayerStationBill): boolean
  /** 同步、不可失败的单次返还；不得重入模块。 */
  give(bill: PlayerStationBill): void
  itemName(itemId: string): string
  /** 已接收、具备工程资格且未被其他岗位占用的身份；本模块自行扣除已有工程占用。 */
  engineers?(): readonly number[]
  /** 已安排且具备人员/材料条件的设施作业请求；供电仍由站点单点分配。 */
  workingCells?(): readonly number[]
  cellCount?(): 9 | 16
  unlocked?(kind: PlayerFacilityKind): boolean
  facilityState?(cellIndex: number): { level: 1 | 2; damaged: boolean }
  externalConstructionPower?(): number
}
export interface PlayerStationProject {
  kind: 'body' | PlayerFacilityKind
  cellIndex?: number
  progressMs: number
  durationMs: number
  spent: Record<string, number>
  paused: boolean
  /** 首座发电的限定启动施工能力；同一时刻不能给另一座发电使用。 */
  startup?: true
  /** 实际开工绑定的工程师身份；暂停/缺电仍由该工程占用。 */
  engineerIndex?: number
}
export interface PlayerStationState {
  runtimeVersion: 3
  clockMs: number
  built: boolean
  bodyApproved: boolean
  bodyPaused: boolean
  bodyMaterials: Record<string, number>
  recoveryMaterials: Record<string, number>
  project?: PlayerStationProject
  /** 设施工程按开工顺序保存；每地块一项，可独立暂停/取消。 */
  projects: PlayerStationProject[]
  cells: { kind: PlayerFacilityKind; cellIndex: number; enabled: boolean }[]
}

export type PlayerStationAction = { kind: 'approve' }
  | { kind: 'pause' | 'resume' | 'cancel'; cellIndex?: number }
  | { kind: 'build'; facility: PlayerFacilityKind; cellIndex: number }
  | { kind: 'toggle'; cellIndex: number }

export type PlayerStationReason = 'invalid-state' | 'invalid-action' | 'busy' | 'body-required'
  | 'no-project' | 'invalid-cell' | 'materials' | 'power' | 'engineer' | 'research'
export type PlayerStationResult = { ok: true } | { ok: false; reason: PlayerStationReason }
