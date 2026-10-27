/** 功能域职责拆分，保持原计算与顺序。 */
import { WEEKEND_FAMILY_ROTATION_ANCHOR_WALL_MS, WEEKEND_LOCKED_FAMILY, WEEKEND_FAMILY_OVERRIDE, WEEKEND_FAMILY_ROTATION, WEEKEND_DEBUG_FAMILY, WEEKEND_FAMILY_NAME_ZH, UNKNOWN_FAMILY_ZH, WEEKEND_FAMILY_NAME_ID, H_FOE_POOL_CORE, H_FOE_POOL_PERIPHERY, R_FOE_POOL_CORE, R_FOE_POOL_PERIPHERY, D_FOE_POOL_CORE, D_FOE_POOL_PERIPHERY, WEEKEND_FAMILIES, weekendOccupiedIds } from './constants'
import type { GameState, WormholeFamily } from '../../state'
import { wormholeCardPoolAt } from '../../wormholeFoes'
import type { WeekendEventState } from './model'

/** **某一期窗口的期号**（锚点那期 = 0；按**周**顺延 —— 排期是每周五 20:00 一期，窗口长 96h） */
export function weekendPeriodIndexOf(windowT0WallMs: number): number {
  const week = 7 * 24 * 3_600_000
  return Math.max(0, Math.floor((windowT0WallMs - WEEKEND_FAMILY_ROTATION_ANCHOR_WALL_MS) / week))
}

/**
 * **本期该跑哪一族**（玩家线**默认**入口；`null` = 不指定、交给随机）——优先级从高到低：
 *
 * 1. `WEEKEND_LOCKED_FAMILY`（**全线硬锁**，平时 `null`；要"所有档一律某族"才填它）；
 * 2. `WEEKEND_FAMILY_OVERRIDE`（**只对指定那一期**生效的特意设置）；
 * 3. **循环**（`WEEKEND_FAMILY_ROTATION` 按 `weekendPeriodIndexOf` 顺延）。
 */
export function weekendFamilyForWindow(windowT0WallMs: number): string | null {
  if (WEEKEND_LOCKED_FAMILY !== null) return WEEKEND_LOCKED_FAMILY
  const period = weekendPeriodIndexOf(windowT0WallMs)
  if (WEEKEND_FAMILY_OVERRIDE !== null && WEEKEND_FAMILY_OVERRIDE.periodIndex === period) {
    return WEEKEND_FAMILY_OVERRIDE.family
  }
  return WEEKEND_FAMILY_ROTATION.length > 0 ? WEEKEND_FAMILY_ROTATION[period % WEEKEND_FAMILY_ROTATION.length]! : null
}

/**
 * **本次开局面实际锁定的族**（单点）——调试档优先于玩家线锁定：
 * `null` 表示"不锁"（恢复随机）。
 */
export function weekendLockedFamilyOf(state: Pick<GameState, 'debugQuick'>): string | null {
  return state.debugQuick === true && WEEKEND_DEBUG_FAMILY !== null
    ? WEEKEND_DEBUG_FAMILY
    : WEEKEND_LOCKED_FAMILY
}

/**
 * 族名中文全称（**未知族 ⇒ 回落到「未知势力」**，**绝不印内部族代号**）。
 *
 * ⚠ **2026-10-01 实障修正**：原兜底写作 `` `${family} 族` ``（把内部代号直接印进玩家可见文案）。
 * 加族时一旦漏登记，玩家看到的就是「R 族」这种开发字眼 —— 船长已两次同款报障
 * （2026-09-24「'XX族'这类开发字眼」/ 2026-10-01「不应该直接用X族」）。
 * 宁可给一个中性称呼，也不许族代号进玩家可见范围。
 */
export function weekendFamilyNameZh(family: string): string {
  return WEEKEND_FAMILY_NAME_ZH[family] ?? UNKNOWN_FAMILY_ZH
}

/**
 * 族名文案 id（**未知族 ⇒ `core.weekend.025`「未知势力」**，中英都能翻）。
 *
 * 保留 `| undefined` 的签名只是为兼容既有调用点的 `?? 'core.weekend.023'`（那已是死分支）；
 * 实际**永远返回一个表内 id**，不会再出现"取不到族名 ⇒ 界面回落到别的族"的张冠李戴。
 */
export function weekendFamilyNameId(family: string): string | undefined {
  return WEEKEND_FAMILY_NAME_ID[family] ?? 'core.weekend.025'
}

/**
 * **入侵舰队在玩家界面上显示的名字**（＝ `<族名>舰队 · <卡名>`）。
 *
 * ⚠ **2026-10-01 实障**：原写法是 `` `${family} 族舰队 · ${cardName}` `` —— 直接把**内部族代号**
 * 印给了玩家（「H 族舰队 · 墨潮帮骚扰舰队」「R 族舰队 · 光环 · 游弋集群」；
 * 船长报障「**入侵的通讯应该采取更正式的名称，不应该直接用X族**」）。
 *
 * ⚠ 后半段那个 `·` 只在**卡名自己不带族名**时才拼：H / R 两族的独立卡卡名自带族名
 * （「墨潮帮骚扰舰队」「光环 · 游弋集群」）⇒ 再加前缀会成「墨潮帮舰队 · 墨潮帮骚扰舰队」，
 * 这类只印卡名；A/C/G 三族仍用虫洞卡（卡名不带族名）⇒ 照旧加前缀。
 */
export function weekendFoeFleetNameOf(family: string, cardName: string): string {
  const fam = weekendFamilyNameZh(family)
  return cardName.includes(fam) ? cardName : `${fam}舰队 · ${cardName}`
}

/**
 * **该族的入侵敌卡是否"自带定价"**（独立卡 ⇒ 威胁 = 卡面实测价，可被抽签换卡）。
 * H / R / C = 真（独立卡按定价式落档）；A/G = 假（仍用虫洞池卡 + 入侵覆写威胁
 * 78/120，属 M1 占位口径，等各自旗舰卡设计好再迁）。
 */
export function weekendFoeCardsSelfPriced(family: string): boolean {
  return family === 'H' || family === 'R' || family === 'C' || family === 'D'
}

/**
 * **某族某区域的入侵敌卡池**：
 * - H 族：外围 `{骚扰 90, 袭击 108}` · 核心 `{袭击 108, 主力 129}`（等概率）；
 * - R 族：外围 `{游弋 90, 分光 108}` · 核心 `{分光 108, 汇聚 129}`（同上，威胁档沿用 H 族）；
 * - C族：外围前锋/护卫，核心护卫/主力；旗舰另走巢母卡。
 * - A/G：仍取该族虫洞池，外围层5、核心层9。
 */
export function weekendFoePoolOf(family: string, isCore: boolean): readonly string[] {
  if (family === 'C') return isCore ? ['alien-escort', 'alien-main'] : ['alien-vanguard', 'alien-escort']
  if (family === 'H') return isCore ? H_FOE_POOL_CORE : H_FOE_POOL_PERIPHERY
  if (family === 'R') return isCore ? R_FOE_POOL_CORE : R_FOE_POOL_PERIPHERY
  if (family === 'D') return isCore ? D_FOE_POOL_CORE : D_FOE_POOL_PERIPHERY
  const fam = (WEEKEND_FAMILIES.includes(family) ? family : WEEKEND_FAMILIES[0]!) as WormholeFamily
  return [wormholeCardPoolAt(fam, isCore ? 9 : 5)[0]!.id]
}

/**
 * **从池里抽一张**（纯函数 · 可复现）：`hash32(hash32(场次, 星系位序), 盐)`。
 *
 * 为什么这样就够：① 走**入侵自己的随机子流**（`hash32`）⇒ **不消费主随机序列**、老档读数一字不动；
 * ② 输入只含"场次 / 星系 / 盐"、不含调用顺序 ⇒ **同一场入侵内稳定**（悬赏板不会每次刷新都换卡）。
 * 池长 1（A/C/G 三族）⇒ 直接返回那一张。
 */
export function weekendDrawFoeCardId(
  family: string,
  isCore: boolean,
  seq: number,
  galaxyIdx: number,
  salt: number,
): string {
  const pool = weekendFoePoolOf(family, isCore)
  if (pool.length <= 1) return pool[0]!
  const r = hash32(hash32(seq, galaxyIdx), salt) / 4294967296
  return pool[Math.min(pool.length - 1, Math.floor(r * pool.length))]!
}

/**
 * **该被占星系"驻留"的那支入侵舰队**（悬赏板 = 主动出击 = 这一支）：
 * 按 `(存档种子, 本场入侵编号 seq, 星系在占领区里的位序)` 抽定 ⇒ **一场之内稳定**、读档/换窗口不变。
 */
export function weekendGarrisonFoeCardId(
  _state: Pick<GameState, 'rng'>,
  ev: WeekendEventState,
  galaxyId: string,
): string {
  const idx = Math.max(0, weekendOccupiedIds(ev).indexOf(galaxyId))
  return weekendDrawFoeCardId(ev.family, galaxyId === ev.coreId, ev.seq, idx, 0)
}

/**
 * **入侵旗舰战的敌卡**（**唯一换卡点**）：H / R 族 = 自家旗舰部队卡；A/C/G = 该族最深池卡。
 * ⚠ 旗舰卡**不参与抽签**（船长 2026-09-25：「**旗舰卡单独**」）。
 */
export function weekendFoeCardOf(family: string, kind: 'assault' | 'flagship'): string {
  if (family === 'C') return kind === 'flagship' ? 'alien-broodmother' : 'alien-vanguard'
  if (family === 'H') return kind === 'flagship' ? 'ink-flagship' : H_FOE_POOL_PERIPHERY[0]!
  if (family === 'R') return kind === 'flagship' ? 'corona-nexus' : R_FOE_POOL_PERIPHERY[0]!
  if (family === 'D') return kind === 'flagship' ? 'gravekeeper-flagship' : D_FOE_POOL_PERIPHERY[0]!
  const fam = (WEEKEND_FAMILIES.includes(family) ? family : WEEKEND_FAMILIES[0]!) as WormholeFamily
  const pool = wormholeCardPoolAt(fam, kind === 'flagship' ? 9 : 5)
  return pool[0]!.id
}

export function hash32(a: number, b: number): number {
  let h = (a | 0) ^ Math.imul(b | 0, 0x9e3779b9)
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

/** 由 (存档种子, 入侵编号) 派生一个确定性序列；**不动 `state.rng`** */
export function streamOf(seed: number, seq: number): () => number {
  let s = hash32(seed, seq * 2654435761) || 1
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
