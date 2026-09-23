/**
 * **铁人模式**（**2026-09-23 船长令**：「和玩家讨论了下，发现好像搞一个铁人模式更受欢迎」）。
 *
 * 一句话：**一条只能前进的存档代次** ＋ **铁人档装载闸门** ＋ **铁人福利**。
 *
 * **① 代次（`state.ironman.seq`）**：每次落盘 +1（在线是"每 15 秒一次 ＋ 每个动作后一次"）。
 * 它**同时**写进存档与"存档之外的账本"（主进程侧，`%APPDATA%\whale-idle\ironman-ledger.json`，
 * 主 + 影子双写）——只写存档的话，回滚会把代次一起带回，等于没记。
 *
 * **② 闸门**（主进程执行，判据在本文件给出唯一实现）：装载（导入 / 恢复）一份档时取
 * `T = max(当前档代次, 账本最高代次)`；**铁人档**遇到 `档.代次 < T` ⇒ 拒绝；
 * **例外 = 救援**：该档"年龄 ≥ 48 小时"（按档内 `savedAtWallMs` 计）⇒ 放行（玩家自选，回退两天刚刚好）。
 *
 * **③ 福利**（**只在铁人开启期间生效**；关闭即失去；两枚隐藏徽章保留）：
 * - A · 离线结算上限 **+8 小时**（加在基准额度上 ⇒ 未点技能 8h→16h、双满级 32h→64h）；
 * - B · 常驻行情每窗刷单量 **×3** · 稀有订单权重 **×2** · 奇货订单权重 **×2**；
 * - C · 悬赏/任务奖励 **×1.1** · 稀有残骸掉率 **×1.2**（30% → 36%）· 技能训练时长 **×0.9**；
 * - ⚠ **贸易税不做优惠**（船长 2026-09-23 明确）。
 *
 * ⚠ 福利一律**只在铁人开启期间**乘上去；关闭后这些乘区自动回 1（徽章与代次保留）。
 * ⚠ **不开铁人的档一律 ×1**（老档、工具、用例都不受影响 ⇒ 标定读数天然是普通档基线）。
 */

/** A · 离线结算上限加成（加在**基准额度**上，与两个技能乘区叠加） */
export const IRONMAN_OFFLINE_CAP_BONUS_MS = 8 * 3_600_000

/** B · 常驻行情每窗刷单量倍率（+200%） */
export const IRONMAN_COMMON_FLOW_MUL = 3
/** B · 稀有订单出现权重倍率（+100%） */
export const IRONMAN_RARE_WEIGHT_MUL = 2
/** B · 奇货订单权重倍率（+100%） */
export const IRONMAN_EXOTIC_WEIGHT_MUL = 2
/** B · **奇货订单每窗最大数量 +2**（**船长 2026-09-23 追加**：「铁人福利的奇货订单每窗最大数量+2」）
 *  —— 加在 `EXOTIC_CAP_PER_DRAW`（2）上 ⇒ 铁人档每窗至多 4 张。 */
export const IRONMAN_EXOTIC_CAP_BONUS = 2

/** C · 悬赏/任务奖励倍率（+10%） */
export const IRONMAN_REWARD_MUL = 1.1
/** C · 稀有残骸掉率倍率（30% → 36%，相对 +20%） */
export const IRONMAN_RARE_DROP_MUL = 1.2
/** C · 技能训练时长倍率（−10%） */
export const IRONMAN_TRAINING_MUL = 0.9

/** 救援放行所需的存档年龄（**船长令**：「允许玩家读取至少两天前的存档作为救援」） */
export const IRONMAN_RESCUE_MIN_AGE_MS = 48 * 3_600_000

/** 铁人档的存档面（`state.ironman`；缺省 = 老档 ⇒ 普通档、代次 0） */
export type { IronmanState } from './state'

export interface IronmanLike {
  on?: boolean
  seq?: number
  sinceWallMs?: number
  closedWallMs?: number
}

/** 读一份状态的铁人面（老档/缺字段 ⇒ 普通档、代次 0）——**唯一读法** */
export function ironmanOf(state: { ironman?: IronmanLike } | null | undefined): Required<Pick<IronmanLike, 'on' | 'seq'>> &
  Omit<IronmanLike, 'on' | 'seq'> {
  const raw = state?.ironman
  const seq = typeof raw?.seq === 'number' && Number.isFinite(raw.seq) ? Math.max(0, Math.floor(raw.seq)) : 0
  return {
    on: raw?.on === true,
    seq,
    ...(typeof raw?.sinceWallMs === 'number' && Number.isFinite(raw.sinceWallMs) ? { sinceWallMs: raw.sinceWallMs } : {}),
    ...(typeof raw?.closedWallMs === 'number' && Number.isFinite(raw.closedWallMs) ? { closedWallMs: raw.closedWallMs } : {}),
  }
}

/** 当前是否处于铁人模式（**福利是否生效、闸门是否启用**都读它） */
export function ironmanOn(state: { ironman?: IronmanLike } | null | undefined): boolean {
  return ironmanOf(state).on
}

/** **是否曾经是铁人档**（含已关闭）——「铁人」隐藏徽章的判据 */
export function ironmanEver(state: { ironman?: IronmanLike } | null | undefined): boolean {
  const it = ironmanOf(state)
  return it.on || it.sinceWallMs !== undefined
}

/** **是否关闭过铁人**——「关闭铁人」隐藏徽章的判据（只在关闭那一刻写 `closedWallMs`） */
export function ironmanClosed(state: { ironman?: IronmanLike } | null | undefined): boolean {
  return ironmanOf(state).closedWallMs !== undefined
}

/** 铁人档的当前代次（普通档也返回它的代次；闸门两侧都用它） */
export function ironmanSeq(state: { ironman?: IronmanLike } | null | undefined): number {
  return ironmanOf(state).seq
}

/**
 * **代次 +1**（每次落盘调用一次）。返回新代次。
 *
 * 口径（**船长令**「**允许关闭，但是关闭后不再上升**」）：**只有铁人开启期间才上升**；
 * 普通档 / 已关闭的档 ⇒ **冻结不动**（`seq` 保留作展示与"曾经到过哪一代"的痕迹）。
 * ⚠ 只改内存；写盘由调用方（渲染层 `persist` → 主进程）负责，主进程顺带把代次推到账本。
 */
export function bumpIronmanSeq(state: { ironman?: IronmanLike }): number {
  const it = ironmanOf(state)
  if (!it.on) return it.seq
  const next = it.seq + 1
  state.ironman = {
    on: true,
    seq: next,
    ...(it.sinceWallMs !== undefined ? { sinceWallMs: it.sinceWallMs } : {}),
    ...(it.closedWallMs !== undefined ? { closedWallMs: it.closedWallMs } : {}),
  }
  return next
}

/**
 * 开启铁人（**新档开局选择**或**旧档一次性转换**；`atWallMs` = 现实墙钟）。
 *
 * `ledgerSeq` = **存档之外账本里的最高代次**（可选；主进程读得到，用例不传）。
 * 为什么要把存档代次**顶到账本高度**：玩家可能"曾经是铁人（账本已到 5000）→ 关闭 → 重置档案"，
 * 新档代次若从 0 起，转换后再导出/导入**自己这份档**都会被闸门拦住（0 < 5000）——那是误伤。
 * 顶上之后，当前这份档永远处在"账本头部"，可自由导出/导入。
 */
export function enterIronman(
  state: { ironman?: IronmanLike },
  atWallMs: number,
  ledgerSeq = 0,
): void {
  const it = ironmanOf(state)
  const base = Math.max(it.seq, Math.max(0, Math.floor(ledgerSeq || 0)))
  state.ironman = {
    on: true,
    seq: base,
    sinceWallMs: it.sinceWallMs ?? Math.max(0, Math.floor(atWallMs)),
    ...(it.closedWallMs !== undefined ? { closedWallMs: it.closedWallMs } : {}),
  }
}

/**
 * **关闭铁人**（**单向门**：关闭后不可再开启 ⇒ 本函数对已关闭的档是幂等空操作）。
 * 语义：代次**停止上升**（由 `bumpIronmanSeq` 的调用方判断 `on`）、账本保留、徽章保留。
 */
export function closeIronman(state: { ironman?: IronmanLike }, atWallMs: number): boolean {
  const it = ironmanOf(state)
  if (!it.on) return false
  state.ironman = {
    on: false,
    seq: it.seq,
    ...(it.sinceWallMs !== undefined ? { sinceWallMs: it.sinceWallMs } : {}),
    closedWallMs: Math.max(0, Math.floor(atWallMs)),
  }
  return true
}

/**
 * **装载闸门**（主进程与用例共用的唯一判据）。
 *
 * @param incomingSeq  待装载存档的代次
 * @param currentSeq   当前档的代次（内存里/当前 `save.json`）
 * @param ledgerSeq    账本最高代次（存档之外）
 * @param incomingSavedAtWallMs 待装载存档的上次保存墙钟（算年龄用；缺失 ⇒ 不给救援）
 * @param nowWallMs    现在（现实墙钟）
 * @param ironman      当前档是否铁人档（**普通档一律放行**）
 */
export function ironmanLoadVerdict(args: {
  ironman: boolean
  incomingSeq: number
  currentSeq: number
  ledgerSeq: number
  incomingSavedAtWallMs: number
  nowWallMs: number
}): { ok: true; rescue: boolean } | { ok: false; reason: 'rolled-back'; threshold: number } {
  if (!args.ironman) return { ok: true, rescue: false }
  const threshold = Math.max(
    0,
    Math.floor(args.currentSeq || 0),
    Math.floor(args.ledgerSeq || 0),
  )
  if (Math.floor(args.incomingSeq || 0) >= threshold) return { ok: true, rescue: false }
  // 救援：**≥48 小时**前的档放行（船长：「回退这么多刚刚好作为平衡」）
  const age = args.nowWallMs - Math.max(0, Math.floor(args.incomingSavedAtWallMs || 0))
  if (args.incomingSavedAtWallMs > 0 && age >= IRONMAN_RESCUE_MIN_AGE_MS) return { ok: true, rescue: true }
  return { ok: false, reason: 'rolled-back', threshold }
}

/* ─────────────── 福利乘区（关闭/普通档一律 1×） ─────────────── */

/** A · 离线结算上限加成（毫秒；非铁人 ⇒ 0） */
export function ironmanOfflineCapBonusMs(state: { ironman?: IronmanLike } | null | undefined): number {
  return ironmanOn(state) ? IRONMAN_OFFLINE_CAP_BONUS_MS : 0
}

/** B · 常驻行情每窗刷单量倍率 */
export function ironmanCommonFlowMul(state: { ironman?: IronmanLike } | null | undefined): number {
  return ironmanOn(state) ? IRONMAN_COMMON_FLOW_MUL : 1
}

/** B · 稀有订单出现权重倍率 */
export function ironmanRareWeightMul(state: { ironman?: IronmanLike } | null | undefined): number {
  return ironmanOn(state) ? IRONMAN_RARE_WEIGHT_MUL : 1
}

/** B · 奇货订单权重倍率 */
export function ironmanExoticWeightMul(state: { ironman?: IronmanLike } | null | undefined): number {
  return ironmanOn(state) ? IRONMAN_EXOTIC_WEIGHT_MUL : 1
}

/** B · 奇货订单每窗最大数量加成（**船长 2026-09-23 追加**；非铁人 ⇒ 0） */
export function ironmanExoticCapBonus(state: { ironman?: IronmanLike } | null | undefined): number {
  return ironmanOn(state) ? IRONMAN_EXOTIC_CAP_BONUS : 0
}

/** C · 悬赏/任务奖励倍率 */
export function ironmanRewardMul(state: { ironman?: IronmanLike } | null | undefined): number {
  return ironmanOn(state) ? IRONMAN_REWARD_MUL : 1
}

/** C · 稀有残骸掉率倍率 */
export function ironmanRareDropMul(state: { ironman?: IronmanLike } | null | undefined): number {
  return ironmanOn(state) ? IRONMAN_RARE_DROP_MUL : 1
}

/** C · 技能训练时长倍率 */
export function ironmanTrainingMul(state: { ironman?: IronmanLike } | null | undefined): number {
  return ironmanOn(state) ? IRONMAN_TRAINING_MUL : 1
}
