/**
 * **舰船忙态标签 · 单点**（2026-09-27 建 · 三号 verify）
 *
 * 为什么单列：忙态文案原先在**两处各写一份裸中文**（`activity.shipBusyLabel` 与
 * `wormhole.shipActivityBusy`/`shipBusyForWormhole`）——两处**刻意重复**是为了避开
 * `state → wormhole → activity` 的循环依赖（见 `wormhole.ts` 那段注释），但代价是：
 * ① 文案要改得改两处；② **英文界面下这些标签直接漏中文**（它们经货仓页徽标 / 进洞拒因上屏）。
 * ⇒ 本文件只承担"**档位 → 文案 + id**"，依赖极轻（不 import 任何业务模块）⇒ 两处都能安全引用、不成环。
 *
 * 口径：文案在 `packages/data/src/l10n/table.ts` 的 `core.busy.*`（zh + en）；本文件的
 * `BUSY_TEXT` 是**中文兜底**（工具、老路径与"查不到 id"时用），与 `CommandResult.error` 同款加法式口径。
 */

/** 忙态档位（键名即语义；新增档位时**必须同时**在 BUSY_TEXT 与 l10n 表补条目） */
export type BusyLabelId =
  | 'wormhole'
  | 'mining'
  | 'miningOut'
  | 'miningBack'
  | 'salvage'
  | 'salvageOut'
  | 'salvageBack'
  | 'hauling'
  | 'courier'
  | 'patrolTo'
  | 'patrol'
  | 'whscan'
  | 'expedition'
  | 'expOut'
  | 'expCombat'
  | 'expBack'
  | 'refine'
  | 'manufacture'
  | 'deliver'
  | 'unload'
  | 'aiMining'
  | 'aiMiningOut'
  | 'aiMiningBack'
  | 'aiPatrolTo'
  | 'aiPatrol'
  | 'aiExpedition'
  | 'aiExpOut'
  | 'aiExpCombat'
  | 'aiExpBack'

/** 档位 → l10n id（唯一表 `core.busy.*`） */
export const BUSY_LABEL_ID: Readonly<Record<BusyLabelId, string>> = {
  wormhole: 'core.busy.001',
  mining: 'core.busy.002',
  miningOut: 'core.busy.003',
  miningBack: 'core.busy.004',
  salvage: 'core.busy.005',
  salvageOut: 'core.busy.006',
  salvageBack: 'core.busy.007',
  hauling: 'core.busy.008',
  courier: 'core.busy.009',
  patrolTo: 'core.busy.010',
  patrol: 'core.busy.011',
  whscan: 'core.busy.012',
  expedition: 'core.busy.013',
  expOut: 'core.busy.014',
  expCombat: 'core.busy.015',
  expBack: 'core.busy.016',
  refine: 'core.busy.017',
  manufacture: 'core.busy.018',
  deliver: 'core.busy.019',
  unload: 'core.busy.020',
  aiMining: 'core.busy.021',
  aiMiningOut: 'core.busy.022',
  aiMiningBack: 'core.busy.023',
  aiPatrolTo: 'core.busy.024',
  aiPatrol: 'core.busy.025',
  aiExpedition: 'core.busy.026',
  aiExpOut: 'core.busy.027',
  aiExpCombat: 'core.busy.028',
  aiExpBack: 'core.busy.029',
}

/** 档位 → 中文兜底文案（`patrolTo` 带 `{p1}`＝目标星系名） */
export const BUSY_TEXT: Readonly<Record<BusyLabelId, string>> = {
  wormhole: '虫洞探索中',
  mining: '采矿中',
  miningOut: '采矿·出航中',
  miningBack: '采矿·返航中',
  salvage: '打捞中',
  salvageOut: '打捞·出航中',
  salvageBack: '打捞·返航中',
  hauling: '长途运输中',
  courier: '快递投送中',
  patrolTo: '掩护巡逻·前往{p1}中',
  patrol: '掩护巡逻中',
  whscan: '扫描虫洞中',
  expedition: '远征中',
  expOut: '远征·出航中',
  expCombat: '远征·交火中',
  expBack: '远征·返航中',
  refine: '亲自开炉精炼中',
  manufacture: '亲自开线制造中',
  deliver: '建站交付中',
  unload: '返航卸货中',
  aiMining: 'AI 采矿中',
  aiMiningOut: 'AI 采矿·出航中',
  aiMiningBack: 'AI 采矿·返航中',
  aiPatrolTo: 'AI 掩护巡逻·去程中',
  aiPatrol: 'AI 掩护巡逻中',
  aiExpedition: 'AI 远征中',
  aiExpOut: 'AI 远征·去程中',
  aiExpCombat: 'AI 远征·交火中',
  aiExpBack: 'AI 远征·返航中',
}

/** 忙态（文案 + id + 可选参数）；与 `CommandResult` 同款加法式字段，渲染层用 `cmdText()` 直接消费 */
export interface BusyLabel {
  /** 中文原串（照写；`patrolTo` 的 `{p1}` 已就地代入） */
  error: string
  /** 档位 id（界面按当前语言渲染） */
  errorId: string
  /** 插值参数（`patrolTo` 传 `{ p1: 目标星系名 }`） */
  errorParams?: Readonly<Record<string, string | number>>
}

/**
 * 造一个忙态标签。
 * `params` 里给了 `p1` 时，中文兜底也会把 `{p1}` 就地代入（与界面渲染口径一致）。
 */
export function busyLabel(id: BusyLabelId, params?: Readonly<Record<string, string | number>>): BusyLabel {
  const raw = BUSY_TEXT[id]
  const text = params ? raw.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m)) : raw
  return { error: text, errorId: BUSY_LABEL_ID[id], ...(params ? { errorParams: params } : {}) }
}
