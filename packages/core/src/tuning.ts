/**
 * **限时倍率表（tuning schedule）** —— 船长 2026-09-15 定的新功能：
 * 「允许我快速设置在指定的现实日期之前，给特定数值调整一个倍率（比如残骸量，虫洞扫描周期等）」。
 *
 * 口径（六问六答 · 全按船长裁定）：
 * - **全员生效**：本表是**正式数据**（随代码上线），不是本地调试开关；
 * - **白名单**：只有 `TUNABLE_KNOBS` 里登记过的目标能被调（每条有 id / 中文名 / 乘在哪 / 边界）；
 * - **时间**：每条规则 `{ key, mul, from?, until, note? }`，以**本地墙钟**判定；
 *   `from`（可省）= 当地 **00:00** 起生效（含）；`until` = **当天整天仍生效**，次日 00:00 失效；
 * - **叠加**：同一目标多条命中 ⇒ **相乘**；未命中 ⇒ **1**；
 * - **界面**：生效期间由 `activeTunings()` 供活动栏显示"加成项 + 剩余时间"。
 *
 * ⚠ **为什么不用 `Date.now()` 直接读**：倍率必须**可复现**——引擎每拍把现实墙钟写进
 * `state.wallMs`（`advanceGame` 的 `nowWallMs`），读取点一律走 `tuningMul(state, key)`。
 * **工具与用例都不设 `state.wallMs` ⇒ 恒为 1×** ⇒ 标定读数（`battle:calibrate` / `wormhole:econ` /
 * `balance`）**不会被日历污染**，这在"读数当验收证据"的流程里是硬要求。
 *
 * ⚠ **不落存档生效状态**：命中与否现算 ⇒ 活动结束**无需回收、无需迁移**。
 * 例：`wreckDensity` 只乘**读取值**，不改已存 `state.galaxyWrecks[g].density` ⇒ 到期自动回落。
 */
import type { GameState } from './state'

/**
 * **可调目标清单（白名单）**。新增一项 = 在这里登记一行 + 在读取点乘 `tuningMul` + 补一条用例。
 *
 * `dir`：倍率的直观方向（写给界面与文档看；引擎只认数值）。
 */
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
    where: '发放时的单位数（1 件 = RARE_WRECK_VOLUME_M3 单位 ⇒ 回收炉开箱批数随之翻倍）',
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

/** 一条限时规则（日期一律 `YYYY-MM-DD`，按**本地时区**解析） */
export interface TuningRule {
  /** 白名单里的开关 id */
  key: TunableKey
  /** 倍率（> 0；1 = 不生效，写 1 只作留档） */
  mul: number
  /** 起始日期（可省 = 立即生效）；当地 00:00 起（含） */
  from?: string
  /** 截止日期；**当天整天仍生效**，次日 00:00 失效 */
  until: string
  /** 备注（写给日后看的"这次活动是什么"，不进玩家可见文案） */
  note?: string
}

/**
 * **规则表**（按需往里加；空表 = 无任何加成）。
 *
 * 写法示例（照抄改数即可）：
 * ```ts
 * export const TUNING_RULES: readonly TuningRule[] = [
 *   { key: 'wreckDensity', mul: 2, from: '2026-09-20', until: '2026-09-22', note: '周末双倍残骸' },
 *   { key: 'wormholeScanMs', mul: 0.5, until: '2026-09-30', note: '虫洞扫描加速（无起始日 ⇒ 立即）' },
 * ]
 * ```
 */
export const TUNING_RULES: readonly TuningRule[] = []

/** `YYYY-MM-DD` → 当地 00:00 的毫秒（非法日期返回 null，调用方按"不生效"处理） */
export function localDayStartMs(day: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const t = new Date(y, mo - 1, d, 0, 0, 0, 0).getTime()
  // 反查一遍：`2026-02-31` 这类会被 Date 顺延 ⇒ 视为非法
  const back = new Date(t)
  if (back.getFullYear() !== y || back.getMonth() !== mo - 1 || back.getDate() !== d) return null
  return t
}

/** 规则是否命中（`nowMs` = 现实墙钟毫秒；`null`/`undefined` ⇒ 一律不命中） */
export function ruleActiveAt(rule: TuningRule, nowMs: number | null | undefined): boolean {
  if (nowMs === null || nowMs === undefined || !Number.isFinite(nowMs)) return false
  if (!(rule.mul > 0)) return false
  const untilStart = localDayStartMs(rule.until)
  if (untilStart === null) return false
  let fromMs: number | null = null
  if (rule.from !== undefined) {
    fromMs = localDayStartMs(rule.from)
    if (fromMs === null) return false
  }
  // 截止日**整天**生效 ⇒ 上界取"次日 00:00"（开区间）
  const end = new Date(untilStart)
  end.setDate(end.getDate() + 1)
  const endMs = end.getTime()
  if (nowMs >= endMs) return false
  if (fromMs !== null && nowMs < fromMs) return false
  return true
}

/** **某开关当前的倍率**（命中规则相乘；未命中 = 1）。读取点唯一的入口。 */
export function tuningMulAt(key: TunableKey, nowMs: number | null | undefined): number {
  let mul = 1
  for (const r of TUNING_RULES) {
    if (r.key !== key) continue
    if (!ruleActiveAt(r, nowMs)) continue
    mul *= r.mul
  }
  return mul > 0 && Number.isFinite(mul) ? mul : 1
}

/** **引擎/界面统一入口**：读 `state.wallMs`（未设 ⇒ 1×，工具与用例天然免疫） */
export function tuningMul(state: Pick<GameState, 'wallMs'> | null | undefined, key: TunableKey): number {
  return tuningMulAt(key, state?.wallMs ?? null)
}

/** 生效中的加成（界面读数用：按规则顺序，带剩余时间与倍率） */
export interface ActiveTuning {
  key: TunableKey
  name: string
  mul: number
  /** 截止时刻（毫秒；界面据此算剩余时间） */
  untilMs: number
  note?: string
}

/** 当前生效的加成列表（`nowMs` 缺省 ⇒ 空数组；界面传 `Date.now()`） */
export function activeTunings(nowMs: number | null | undefined): ActiveTuning[] {
  const out: ActiveTuning[] = []
  for (const r of TUNING_RULES) {
    if (!ruleActiveAt(r, nowMs)) continue
    const untilStart = localDayStartMs(r.until)
    if (untilStart === null) continue
    const end = new Date(untilStart)
    end.setDate(end.getDate() + 1)
    out.push({
      key: r.key,
      name: TUNABLE_KNOBS[r.key]?.name ?? r.key,
      mul: r.mul,
      untilMs: end.getTime(),
      ...(r.note ? { note: r.note } : {}),
    })
  }
  return out
}
