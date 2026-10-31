import type { BattleState } from '../combat/state/battle'

/** 远征作业状态；返航时长由travel.ts统一按实际星系与当前倍率计算。 */
export interface ExpeditionState {
  sortie?: import('../combat/command/types').CombatSortie
  active: boolean
  /** 目标异常点 id */
  anomalyId: string | null
  /** 当前阶段结束的游戏内时刻（毫秒）——V12 起语义随 phase：开战/战斗结束/返航到家 */
  finishAtGameMs: number
  /** 本次作业总耗时（毫秒，出发时锁定；展示用） */
  durationMs: number
  /** 单程航程耗时（毫秒，锁定；用于异常航路返航兜底） */
  outMs: number
  /** 交火参考耗时（毫秒，展示用；实际由战斗推演决定） */
  combatMs: number
  /** 出发时火力（锁定；展示/旧式兼容） */
  power: number
  /** 出发时抽中的途中事件 id（null = 本次平安无事；去程取消后在出发瞬间触发） */
  eventId: string | null
  /** 途中事件是否已触发 */
  eventFired: boolean
  /* ═══ V12：阶段与战斗状态 ═══ */
  /** 当前阶段：去程（旧档兼容）/ 交火 / 返航（未出航时 = 'out'） */
  phase: 'out' | 'battle' | 'back'
  /** 返航来源（2026-09-06 兼容字段）：victory=悬赏胜利自动返航（不可召回）；
   *  defeat/retreat=失利/撤退返航（可召回）；旧档在途 back 无此字段 = 按失利口径 */
  returnReason?: 'victory' | 'defeat' | 'retreat'
  /** 返航段起点（2026-09-08 兼容字段）：转入 back 的游戏时刻——进度条分母 =
   *  finishAtGameMs − 本值；旧档在途 back 缺省 → 回退旧口径 */
  returnAtGameMs?: number
  /** 实时战斗状态（phase='battle' 时非空；只存动态量，静态由 ship/anomaly 定义重建） */
  battle: BattleState | null
  /** 2026-10-21起仅保留旧星系记录，不供新战斗读取、不猜测迁移到卡ID。 */
  desirePrefByGalaxy?: Record<string, number>
  /** ⚠ 遗留字段（2026-09-11 起不再使用，仅存档兼容占位）：原"全局期望距离偏好"。
   *  现行口径见 `GameState.battleRangeByCard`；读档时不回填、不回读。 */
  desirePrefM?: number
  /** 赏金任务·窝点档位（2026-09-10 兼容字段）：非空 = 本次远征打的是派生窝点
   *  （威胁/波次/僚机按档位强化，奖金与稀有残骸按窝点口径结算）；旧档与普通悬赏 = 未设 */
  lairTier?: 1 | 2 | 3
  /** 敌对派系活跃（2026-09-10 兼容字段）：true = 本次远征打的是当日派系活跃星系的**常驻悬赏**
   *  （威胁 ×1.1、奖金 ×1.1、胜利有概率掉稀有残骸）；与 lairTier 互斥（派系只针对普通悬赏） */
  factionActive?: boolean
  /**
   * **这一场实际打的是哪个星系**（2026-09-25 加：周末入侵接线）：
   * H 族入侵独立卡自带母港 `galaxyId` ⇒ 战后归属/残骸注入若只看卡就会算到母港（把残骸注错星系）。
   * 引擎在出发那一刻把**界面上那张卡**的星系写进来（被占星系的入侵替换卡带的是**被占星系**），
   * `weekendBattleInvolvedOf` 优先读它。缺省 / 非法 ⇒ 回落老口径（只看卡的 `galaxyId`）⇒ 零迁移、零行为变化。
   */
  foeGalaxyId?: string
  /**
   * **奖励基底覆写**（2026-09-25 加 · 周末入侵"主动出击每场重抽"配套）：入侵的敌舰每场重抽，
   * 但奖励恒 = **该星系原卡 ×1.4** ⇒ 出发时算好写进来，结算时用它替代 `anomaly.rewardIsk`。
   * 可选字段 ⇒ 零迁移（老路径不写它，逐字不变）。
   */
  rewardIskOverride?: number
  /** 本次返航的跃迁燃料倍率（同 `MiningState.fuelMul`；1/缺省 = 没吃燃料） */
  fuelMul?: number
}
