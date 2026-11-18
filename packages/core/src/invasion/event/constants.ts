import type { WeekendEventState } from './model'

export const WEEKEND_PERIPHERY_THREAT = 78

export const WEEKEND_CORE_THREAT = 120

export const WEEKEND_MIN_STANDING = 60

export const WEEKEND_STANDING_MAX = 30

export const WEEKEND_STANDING_BEACON = 10

export const WEEKEND_AMBUSH_STRENGTH_MUL = 0.75

export const WEEKEND_ENCOUNTER_P = 0.6

export const WEEKEND_ENCOUNTER_CAP = 0.9

export const WEEKEND_GAIN_PERIPHERY_WIN = 0.05

export const WEEKEND_GAIN_CORE_WIN = 0.05

export const WEEKEND_GAIN_REPEL = 0.03

export const WEEKEND_GAIN_OFFLINE_REPEL = 0.01

export const WEEKEND_LOCKED_FAMILY: string | null = null

export const WEEKEND_FINISHED_FAMILIES: readonly string[] = ['R', 'C', 'H', 'D']

export const WEEKEND_FAMILY_ROTATION: readonly string[] = WEEKEND_FINISHED_FAMILIES

export const WEEKEND_FAMILY_ROTATION_ANCHOR_WALL_MS = new Date(2026, 9, 2, 20, 0, 0, 0).getTime()

export const WEEKEND_FAMILY_OVERRIDE: { readonly family: string; readonly periodIndex: number } | null = {
  family: 'C',
  periodIndex: 1,
}

export const WEEKEND_DEBUG_FAMILY: string | null = 'D'

export const WEEKEND_DEBUG_WIN_GAIN = 0.5

export const WEEKEND_NPC_PERIPHERY_MS = 48 * 3_600_000

export const WEEKEND_NPC_CORE_MS = 24 * 3_600_000

export const WEEKEND_FLAGSHIP_DEADLINE_MS = 24 * 3_600_000

export const WEEKEND_BOSS_FAMILIES: readonly string[] = ['H', 'R', 'C', 'D']

export const WEEKEND_FLAGSHIP_POOL_HP = 300_000

export const WEEKEND_FLAGSHIP_SHIP_ID = 'foe-h-ink-flagship'

export const WEEKEND_OFFLINE_SHIELD_MS = 24 * 3_600_000

export const WEEKEND_START_WEEKDAY = 5

export const WEEKEND_START_HOUR = 20

export const WEEKEND_WINDOW_MS = 96 * 3_600_000

export const WEEKEND_DEBUG_ONLY = false

export const WEEKEND_FIRST_T0_WALL_MS: number | null = new Date(2026, 8, 25, 22, 0, 0, 0).getTime()

export const WEEKEND_DEBUG_RESTART_MS = 3_600_000

export const WEEKEND_DEBUG_AUTO_START_ENABLED = false

export const WEEKEND_DEBUG_TIME_DIVISOR = 60

export const WEEKEND_BOSS_TICK_MAX_MS = 5_000

export const WEEKEND_OCTOPUS_HOLD_MS = 60_000

export const WEEKEND_WINDOW_END_HOLD_MS = 60_000

export const WEEKEND_FAMILIES: readonly string[] = ['A', 'C', 'G', 'H', 'R', 'D']

export const WEEKEND_FAMILY_NAME_ZH: Readonly<Record<string, string>> = {
  A: '海盗',
  C: '异形生物',
  G: '鱿鱼亡军',
  H: '墨潮帮',
  R: '光环',
  D: '守墓者',
}

export const WEEKEND_FAMILY_NAME_ID: Readonly<Record<string, string>> = {
  A: 'core.weekend.020',
  C: 'core.weekend.021',
  G: 'core.weekend.022',
  H: 'core.weekend.023',
  R: 'core.weekend.024',
  D: 'core.weekend.026',
}

export const UNKNOWN_FAMILY_ZH = '未知势力'

export const H_FOE_POOL_PERIPHERY: readonly string[] = ['ink-harass', 'ink-raid']

export const H_FOE_POOL_CORE: readonly string[] = ['ink-raid', 'ink-main']

export const R_FOE_POOL_PERIPHERY: readonly string[] = ['corona-drift', 'corona-split']

export const R_FOE_POOL_CORE: readonly string[] = ['corona-split', 'corona-converge']

export const D_FOE_POOL_PERIPHERY: readonly string[] = ['gravekeeper-drift', 'gravekeeper-line']

export const D_FOE_POOL_CORE: readonly string[] = ['gravekeeper-line', 'gravekeeper-main']

export const WEEKEND_DEBUG_FLAGSHIP_WINDOW_MS = 10 * 60_000

export function weekendOccupiedIds(ev: WeekendEventState | undefined): string[] {
  if (!ev) return []
  return [ev.coreId, ...ev.peripheryIds]
}


export const WEEKEND_CARD_PREFIX = 'wk-'

export const WEEKEND_PROGRESS_ISK_PER_PCT = 200_000

export const WEEKEND_CONTRIBUTION_BOSS_WEIGHT = 0.6

export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return v < 0 ? 0 : v > 1 ? 1 : v
}
