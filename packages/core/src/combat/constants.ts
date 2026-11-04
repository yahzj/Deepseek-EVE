/** 战斗域：constants，从原引擎按职责迁移，保持结算顺序。 */


/** 战斗基本步长（毫秒） */
export const BATTLE_STEP_MS = 10

/** 步数守卫上限（防失控循环） */
export const BATTLE_MAX_STEPS = 400_000

/** 护盾抗性保持原100毫秒齐射快照，独立于内部步长。 */
export const BATTLE_VOLLEY_WINDOW_MS = 100
