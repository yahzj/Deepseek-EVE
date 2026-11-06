/**
 * 深空证券交易所 · 界面停留位置
 *
 * 2026-11-06 船长令：在简单投资与专业投资之间来回切、乃至退出游戏再进，
 * 都要回到上次停留的地方（视图模式、标的、各栏 tab、图表周期与指标开关）。
 * 存储不可用（隐私模式、配额满）时只是记不住位置，不影响交易。
 */

const PREFIX = 'whale-idle:exch-'

export const EXCH_PREF = {
  /** 简单 / 专业 */
  viewMode: `${PREFIX}view-mode`,
  /** 上次选中的标的代码 */
  code: `${PREFIX}code`,
  /** 专业界面右栏：持仓与委托 / 成交历史与流水 */
  proSide: `${PREFIX}pro-side`,
  /** 专业界面下单区：杠杆多 / 杠杆空 / 自动量化 */
  proOrder: `${PREFIX}pro-order`,
  /** 简单界面右栏：我的委托 / 理财与基金 */
  simpleSide: `${PREFIX}simple-side`,
  /** 图表周期 */
  chartPeriod: `${PREFIX}chart-period`,
  /** 图表指标开关（JSON） */
  chartToggles: `${PREFIX}chart-toggles`,
} as const

function readRaw(key: string): string | null {
  try {
    const value = window.localStorage.getItem(key)
    return value !== null && value !== '' ? value : null
  } catch {
    return null
  }
}

/**
 * 偏好变更事件：活动栏「点债券/基金直达理财」这类跨组件跳转要用它——
 * 只写 localStorage 的话，已经挂载的交易所页面读不到新值。
 */
export const EXCHANGE_PREF_EVENT = 'whale-exchange-pref-change'

/** 跳到交易所的某个界面（活动栏等外部入口用）：先写偏好，再通知已挂载的页面重读 */
export function jumpExchangePage(view: 'simple' | 'pro', side?: string): void {
  writeExchangePref(EXCH_PREF.viewMode, view)
  if (view === 'simple' && side) writeExchangePref(EXCH_PREF.simpleSide, side)
  if (view === 'pro' && side) writeExchangePref(EXCH_PREF.proSide, side)
  try {
    window.dispatchEvent(new Event(EXCHANGE_PREF_EVENT))
  } catch {
    // 事件派发失败只是不即时刷新，不影响跳转
  }
}

export function writeExchangePref(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // 记不住位置不算失败，静默放过
  }
}

/** 只在可选值里认领，脏数据回落到默认值 */
export function readExchangeChoice<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const saved = readRaw(key)
  return saved !== null && (allowed as readonly string[]).includes(saved) ? (saved as T) : fallback
}

export function readExchangeCode(fallback: string): string {
  return readRaw(EXCH_PREF.code) ?? fallback
}

/** 指标开关按已知键逐个认领，多出来的键忽略、缺的键用默认 */
export function readExchangeToggles<T extends Record<string, boolean>>(fallback: T): T {
  const saved = readRaw(EXCH_PREF.chartToggles)
  if (saved === null) return fallback
  try {
    const parsed = JSON.parse(saved) as Record<string, unknown>
    const next: Record<string, boolean> = { ...fallback }
    for (const key of Object.keys(fallback)) {
      const value = parsed[key]
      if (typeof value === 'boolean') next[key] = value
    }
    return next as T
  } catch {
    return fallback
  }
}

export function writeExchangeToggles(toggles: Record<string, boolean>): void {
  try {
    writeExchangePref(EXCH_PREF.chartToggles, JSON.stringify(toggles))
  } catch {
    // JSON 序列化失败（理论不会发生）同样只是记不住
  }
}
