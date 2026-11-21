import type { GameState } from './state'
import { ironmanRareDropMul, ironmanRewardMul } from './ironman'

export const TUNABLE_KNOBS = {
  wreckDensity: {
    name: '星系残骸密度（打捞产出量）',
    where: '`wreckDensityOf` 的读取值（不改已存密度，到期自动回落）',
    dir: '×2 = 捞得更多',
  },
  rareWreckRate: {
    name: '稀有残骸掉率',
    where: '稀有残骸的掷点概率（窝点/派系掉落 与 洞内墓场判定；夹在 0~1）',
    dir: '×2 = 更常出',
  },
  rareWreckVolume: {
    name: '稀有残骸单件体积',
    where: '发放时的单位数（1 件 = RARE_WRECK_VOLUME_M3 单位 ⇒ 回收炉拆解批数随之翻倍）',
    dir: '×2 = 一件顶两件',
  },
  wormholeScanMs: {
    name: '虫洞扫描周期',
    where: 'wormholeScanDurationMs（12 小时基准 × 技能系数之后）',
    dir: '×0.5 = 快一倍',
  },
  miningCycleMs: {
    name: '采矿循环时长',
    where: 'miningParams 的 cycleMs',
    dir: '×0.5 = 快一倍',
  },
  miningYield: {
    name: '采矿每循环产出',
    where: 'miningParams 的 unitsPerCycle（向下取整，至少 1）',
    dir: '×2 = 产量翻倍',
  },
  rewardIsk: {
    name: '悬赏 / 任务奖励（信用点）',
    where: '悬赏结算与任务奖励生成（含窝点/派系两条派生口径）',
    dir: '×2 = 奖励翻倍',
  },
  skillTrainMs: {
    name: '技能训练时长',
    where: 'skillLevelTimeMs × trainingTimeFactor（技能没有"经验点"，是按时长训练的）',
    dir: '×0.5 = 练得更快',
  },
} as const

export type TunableKey = keyof typeof TUNABLE_KNOBS

export interface TuningRule {
  key: TunableKey
  mul: number
  from?: string
  until: string
  note?: string
}

export const TUNING_RULES: readonly TuningRule[] = []

export interface PromoRule {
  id: string
  label: string
  detail: string
  from?: string
  until: string
  scanMul?: number
  claims?: readonly TunableKey[]
  open?: PromoOpenTarget
}

export type PromoOpenTarget = 'wormhole-scan'

export const PROMOS: readonly PromoRule[] = []

export function localDayStartMs(day: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const t = new Date(y, mo - 1, d, 0, 0, 0, 0).getTime()
  const back = new Date(t)
  if (back.getFullYear() !== y || back.getMonth() !== mo - 1 || back.getDate() !== d) return null
  return t
}

function dayWindowActiveAt(
  from: string | undefined,
  until: string,
  nowMs: number | null | undefined,
): boolean {
  if (nowMs === null || nowMs === undefined || !Number.isFinite(nowMs)) return false
  const endMs = dayWindowEndMs(until)
  if (endMs === null) return false
  if (nowMs >= endMs) return false
  if (from !== undefined) {
    const fromMs = localDayStartMs(from)
    if (fromMs === null || nowMs < fromMs) return false
  }
  return true
}

export function dayWindowEndMs(until: string): number | null {
  const untilStart = localDayStartMs(until)
  if (untilStart === null) return null
  const end = new Date(untilStart)
  end.setDate(end.getDate() + 1)
  return end.getTime()
}

export function ruleActiveAt(rule: TuningRule, nowMs: number | null | undefined): boolean {
  if (!(rule.mul > 0)) return false
  return dayWindowActiveAt(rule.from, rule.until, nowMs)
}

export function tuningMulAt(key: TunableKey, nowMs: number | null | undefined): number {
  let mul = 1
  for (const r of TUNING_RULES) {
    if (r.key !== key) continue
    if (!ruleActiveAt(r, nowMs)) continue
    mul *= r.mul
  }
  return mul > 0 && Number.isFinite(mul) ? mul : 1
}

export function tuningMul(state: Pick<GameState, 'wallMs'> | null | undefined, key: TunableKey): number {
  return tuningMulAt(key, state?.wallMs ?? null)
}

export function rewardMulOf(state: Pick<GameState, 'wallMs' | 'ironman'> | null | undefined): number {
  return tuningMul(state, 'rewardIsk') * ironmanRewardMul(state)
}

export function rareDropRateMulOf(state: Pick<GameState, 'wallMs' | 'ironman'> | null | undefined): number {
  return tuningMul(state, 'rareWreckRate') * ironmanRareDropMul(state)
}

export interface ActiveTuning {
  key: TunableKey
  name: string
  mul: number
  untilMs: number
  note?: string
}

export function activeTunings(nowMs: number | null | undefined): ActiveTuning[] {
  const out: ActiveTuning[] = []
  for (const r of TUNING_RULES) {
    if (!ruleActiveAt(r, nowMs)) continue
    const untilMs = dayWindowEndMs(r.until)
    if (untilMs === null) continue
    out.push({
      key: r.key,
      name: TUNABLE_KNOBS[r.key]?.name ?? r.key,
      mul: r.mul,
      untilMs,
      ...(r.note ? { note: r.note } : {}),
    })
  }
  return out
}


export interface ActivePromo {
  id: string
  label: string
  detail: string
  untilMs: number
  scanMul: number
  claims: readonly TunableKey[]
  open?: PromoOpenTarget
}

export function promoActiveAt(promo: PromoRule, nowMs: number | null | undefined): boolean {
  return dayWindowActiveAt(promo.from, promo.until, nowMs)
}

export function activePromos(nowMs: number | null | undefined): ActivePromo[] {
  const out: ActivePromo[] = []
  for (const p of PROMOS) {
    if (!promoActiveAt(p, nowMs)) continue
    const untilMs = dayWindowEndMs(p.until)
    if (untilMs === null) continue
    out.push({
      id: p.id,
      label: p.label,
      detail: p.detail,
      untilMs,
      scanMul: p.scanMul !== undefined && p.scanMul > 0 ? p.scanMul : 1,
      claims: p.claims ?? [],
      ...(p.open !== undefined ? { open: p.open } : {}),
    })
  }
  return out
}

export function promoScanMulAt(nowMs: number | null | undefined): number {
  let mul = 1
  for (const p of activePromos(nowMs)) mul *= p.scanMul
  return mul > 0 && Number.isFinite(mul) ? mul : 1
}

export function promoScanMul(state: Pick<GameState, 'wallMs'> | null | undefined): number {
  return promoScanMulAt(state?.wallMs ?? null)
}
