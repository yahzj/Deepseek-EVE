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
 * 例：`wreckDensity` 只乘**读取值**，不改已存 `state.wreckDensity` / 盘面 ⇒ 到期自动回落。
 *
 * **2026-09-16 新增「促销（promo）」一层**（船长：限时活动「虫洞大量生成」——扫描虫洞时间 ×0.25
 * ＋ 每人一次 5 处虫洞，**合并展示**并润色成游戏内说法）：
 * `PROMOS` 一行同时决定**三项同源**——扫描倍率 / 赠送数量 / 玩家可见文案，到期一起失效；
 * 被促销 `claims` 认领的倍率键在活动栏**不再单列徽标**（同一件事不显示两遍）。
 * 促销与 `TUNING_RULES` **共用同一套日期判据**（`dayWindowActiveAt` / `dayWindowEndMs`）。
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

/**
 * **促销（限时活动）表** —— 2026-09-16 船长：限时活动「虫洞大量生成」。
 *
 * 船长原话：「**将扫描虫洞所需时间*0.25，持续到9月20号，并给予所有玩家5个虫洞**（同样持续到
 * 20号为止，到20号之后提醒我清理这个过期的赠送）」＋ 四答：**每人只发一次 5 个** ·
 * **只给已解锁者**（协会声望 ≥ 40）· 到期**只停止赠送**（不回收已发出）· 展示**与扫描加速合并**、
 * 润色成「虫洞大量生成」这类游戏内说法。
 *
 * 一条促销 = **三项同源**（同一行决定，不会各写各的）：
 * - `scanMul`：虫洞扫描周期倍率（读点 `wormholeScanWindowMs`，与 `TUNING_RULES` 相乘）；
 * - `giftWormholes`：**一次性**赠送的未探索虫洞处数（逐 tick `reconcileWormholePromoGift` 发放，
 *   靠 `state.promoClaimed[id]` 保证"每人只发一次"，**只发给已解锁者**）；
 * - `label` / `detail`：活动栏徽标与悬停说明的**玩家可见文案**（游戏内说法，禁开发语）。
 *
 * 日期口径与 `TuningRule` **完全一致**（本地时区 · `from` 含当日 00:00 · `until` 当天整天有效、
 * 次日 00:00 失效）。⚠ 到期**不回收**已发出的虫洞、不改任何已存状态 ⇒ 收口 = 从本表删行
 * （`npm run tuning:expired` 会列出生效期已过、仍留在表里的条目）。
 */
export interface PromoRule {
  /** 促销 id（稳定标识：写进 `state.promoClaimed` 的一次性领取记录，**改 id 等于让老档重领一次**） */
  id: string
  /** 玩家可见名（活动栏徽标那行字；游戏内说法） */
  label: string
  /** 悬停明细（玩家可见；`\n` 分段） */
  detail: string
  /** 起始日期（可省 = 立即生效）；当地 00:00 起（含） */
  from?: string
  /** 截止日期；**当天整天仍生效**，次日 00:00 失效 */
  until: string
  /** 虫洞扫描周期倍率（不写 = 1；**×0.25 = 快四倍**） */
  scanMul?: number
  /** 一次性赠送的未探索虫洞处数（不写 / 0 = 不赠送） */
  giftWormholes?: number
  /** 本促销"认领"的限时倍率开关：这些键的**单独徽标会被并购进本促销**，避免同一件事显示两遍 */
  claims?: readonly TunableKey[]
}

/**
 * **促销规则表**（按需往里加；空表 = 无任何活动）。
 *
 * ⚠ **只写给玩家看得懂的活动**：`label` / `detail` 是玩家可见文案（游戏内说法），
 * 开发/验收话语（日期、口径、倍率算式）一律不进——数值解释放注释或 `note`。
 */
export const PROMOS: readonly PromoRule[] = [
  {
    id: 'wh-bloom-20260916',
    label: '虫洞大量生成',
    detail:
      '深空虫洞活动异常活跃：扫描阵列的捕获效率大幅提升，协会测绘处已为你标记 5 处虫洞坐标。\n' +
      '（未探索的虫洞可在「扫描虫洞」页查看；进洞前记得带采集器与打捞器。）',
    from: '2026-09-16',
    until: '2026-09-20',
    scanMul: 0.25,
    giftWormholes: 5,
    claims: ['wormholeScanMs'],
  },
]

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

/**
 * **日期窗口是否命中**（`TuningRule` 与 `PromoRule` 共用的**唯一判据**——两套表的口径必须一致，
 * 免得"倍率没了赠送还在"）。
 *
 * - `nowMs` 非法 / 缺省 ⇒ 不命中（工具与用例天然免疫）；
 * - `from` 可省 = 立即生效（当地 00:00 含）；`until` = **当天整天仍生效**，次日 00:00 失效（开区间）。
 */
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

/** 截止日的**失效时刻**（= 次日当地 00:00；非法日期 ⇒ null）。界面算"剩余时间"也用它 */
export function dayWindowEndMs(until: string): number | null {
  const untilStart = localDayStartMs(until)
  if (untilStart === null) return null
  const end = new Date(untilStart)
  end.setDate(end.getDate() + 1)
  return end.getTime()
}

/** 规则是否命中（`nowMs` = 现实墙钟毫秒；`null`/`undefined` ⇒ 一律不命中） */
export function ruleActiveAt(rule: TuningRule, nowMs: number | null | undefined): boolean {
  if (!(rule.mul > 0)) return false
  return dayWindowActiveAt(rule.from, rule.until, nowMs)
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

/* ═══════════ 促销（限时活动）：扫描倍率 ＋ 一次性赠送 ＋ 合并展示（2026-09-16） ═══════════ */

/** 一条生效中的促销（界面徽标与引擎发放共用同一份读数） */
export interface ActivePromo {
  id: string
  /** 玩家可见名（活动栏徽标那行字） */
  label: string
  /** 悬停明细（玩家可见；`\n` 分段） */
  detail: string
  /** 截止时刻（毫秒；界面据此算剩余时间） */
  untilMs: number
  /** 虫洞扫描周期倍率（未写 = 1） */
  scanMul: number
  /** 一次性赠送的虫洞处数（未写 = 0） */
  giftWormholes: number
  /** 本促销认领的限时倍率键（这些键的单独徽标要隐藏，见活动栏） */
  claims: readonly TunableKey[]
}

/** 促销是否命中（判据与 `ruleActiveAt` 同源 ⇒ 两套表的日期口径绝不会漂） */
export function promoActiveAt(promo: PromoRule, nowMs: number | null | undefined): boolean {
  return dayWindowActiveAt(promo.from, promo.until, nowMs)
}

/** **当前生效的促销列表**（界面徽标用；`nowMs` 非法 / 缺省 ⇒ 空数组） */
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
      giftWormholes:
        p.giftWormholes !== undefined && p.giftWormholes > 0 ? Math.floor(p.giftWormholes) : 0,
      claims: p.claims ?? [],
    })
  }
  return out
}

/** **促销带来的虫洞扫描周期倍率**（命中相乘；未命中 = 1）——`wormholeScanWindowMs` 的唯一读取点 */
export function promoScanMulAt(nowMs: number | null | undefined): number {
  let mul = 1
  for (const p of activePromos(nowMs)) mul *= p.scanMul
  return mul > 0 && Number.isFinite(mul) ? mul : 1
}

/** 引擎/界面统一入口（读 `state.wallMs`；未设 ⇒ 1×） */
export function promoScanMul(state: Pick<GameState, 'wallMs'> | null | undefined): number {
  return promoScanMulAt(state?.wallMs ?? null)
}

/**
 * **当前待发放的一次性赠送**（`reconcileWormholePromoGift` 用；未命中 ⇒ 空数组）。
 * 每项 = `{ id, count }`：`id` 写进 `state.promoClaimed` 保证**每人只发一次**。
 */
export function activePromoGifts(
  nowMs: number | null | undefined,
): Array<{ id: string; count: number }> {
  return activePromos(nowMs)
    .filter((p) => p.giftWormholes > 0)
    .map((p) => ({ id: p.id, count: p.giftWormholes }))
}
