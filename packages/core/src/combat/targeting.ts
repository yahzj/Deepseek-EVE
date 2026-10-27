/** 战斗域：targeting，从原引擎按职责迁移，保持结算顺序。 */
import type { UnitSpec } from './model'
import { isAlive } from './combatMath'
import { nominalWeaponDps } from './foes/tactics'
import type { ShipRole, FoeTargetingMode } from '../types'
import type { GameState } from '../state'
import { pickWeighted, nextRandom, nextInt } from '../rng'
import { isFoeEngageable } from './combatDrones'

/** 敌舰是否"可被我方选中"（2026-10-02 批次 4j 迁到 combatDrones.ts，本文件借回） */

/**
 * **我方单位当前是否"可被敌方选中"**（2026-09-15 船长：「隐秘行动装置」——**开火前隐身：不被锁定、
 * 不被攻击**）。
 *
 * 判据 = 该单位的隐身窗口不在生效期：`stealthUntilMs === undefined || lastTickGameMs >= stealthUntilMs`。
 * 为什么做成**选靶判据**而不是"伤害免疫"：与上面 `isFoeEngageable` 同一条理由——引擎里**命中与伤害
 * 同拍结算**（没有在途弹道状态）⇒ 选靶处排除即彻底；且敌舰主炮与机群在**无处可选**时自然
 * **停火待机**（Q2 甲：本拍若没有别的可打目标就不开火）。
 *
 * 缺字段（未装装置的船 / 敌舰 / 老档）⇒ **恒可选中**（零行为变化）。
 */
export function isMyUnitTargetable(b: import('../state').BattleState, tag: string): boolean {
  const until = b.units[tag]?.stealthUntilMs
  return until === undefined || b.lastTickGameMs >= until
}

/**
 * 我方单位**当前是否正处于隐身窗口内**（`isMyUnitTargetable` 的补集）——给"隐身时不自动开火"这类
 * 判据用（船长 2026-09-17：「**让舰船自带的基础舰炮在隐身情况下不开炮**」；落码点 = 我方开火循环里
 * 对 `src === 'base'` 的那一条）。**故意与选靶共用同一把尺**：两处若各写一份判据，日后改隐身旁支
 * 必然出现"打得着却打不到 / 打不到却挨打"的错位。缺字段（未装装置 / 敌舰 / 老档）⇒ `false`。
 */
export function isMyUnitStealthed(b: import('../state').BattleState, tag: string): boolean {
  return !isMyUnitTargetable(b, tag)
}

/** 我方还有没有活着的单位（`myUnits` 里任一存活）——单船路径等价于 `isAlive(b,'player')` */export function isAliveAnyOf(b: import('../state').BattleState, myUnits: readonly UnitSpec[]): boolean {
  return myUnits.some((u) => isAlive(b, u.tag))
}

/** 存活的我方单位（按编队顺序；`myFleet` 首条 = 主控 ⇒ 首位恒为 `player`） */
export function aliveMyUnits(
  b: import('../state').BattleState,
  myUnits: readonly UnitSpec[],
): UnitSpec[] {
  return myUnits.filter((u) => isAlive(b, u.tag))
}

/** 我方单位的**输出分**（模式「打输出最高的」判据）= 各武器条目名义 DPS 之和
 *  （`nominalWeaponDps` 与装配页 `rawDpsOf` 同口径：炮台取首弹种单发 × 门数 ÷ 装填） */
export function myUnitOutputScore(u: UnitSpec): number {
  let sum = 0
  for (const w of u.weapons) sum += nominalWeaponDps(w)
  return sum
}

/** **非战斗船**（模式「打非战斗船」判据）：工业/采矿与货舰算非战斗；武装/装甲算战斗 */
export function isNonCombatShipRole(role: ShipRole | undefined): boolean {
  return role === 'industrial' || role === 'hauler'
}

/**
 * **敌方选靶**（虫洞 D 批 · 船长 2026-09-13 定的五种模式；见 `FoeTargetingMode`）：
 * 从**存活我方单位**里挑一个目标。并列（同输出 / 同档 / 多艘非战斗船）一律**按被选中权重抽取**
 * （缺省权重都是 1 ⇒ 等权随机，也就是改动前的口径）。
 *
 * ⚠⚠ **只剩一艘我方单位时直接返回、一次随机数都不消费** —— 这条是单船路径零漂移的命门：
 * 既有 27 张悬赏卡 / 低安遭遇 / AI 副船的战斗里，敌方开火从不掷"选靶骰"，本函数在那些
 * 场次里也不会多消耗一个 `nextRandom`（否则整批标定读数会漂移）。
 * ⚠ `noncombat` 模式下编队里**没有**非战斗船 ⇒ **退回随机**（船长口径）。
 * ⚠ 模式只由**虫洞内敌卡**（`AnomalyDef.foeTargeting`）写；不写 = `random`。
 *
 * **倾向概率**（船长 2026-09-14：「虫洞敌人的攻击倾向，加一个概率」→「目前先挨个定为60%」）：
 * `chance` = 该模式下**每发开火前**按这个概率生效一次，没掷中 ⇒ **这一发乱了（退回随机抽取）**。
 * `chance >= 1`（缺省）或模式本来就是 `random` ⇒ **连一次骰都不掷** ⇒ 旧场次的随机数消费顺序逐字节不变。
 */
export function pickMyUnitTarget(
  state: GameState,
  b: import('../state').BattleState,
  myUnits: readonly UnitSpec[],
  mode: FoeTargetingMode = 'random',
  /** 模式的作用概率（1 = 铁律；<1 ⇒ 每发开火前掷一次，没掷中退回随机） */
  chance = 1,
): UnitSpec | null {
  // ⚠ **单船路径逐字等价**：编队只有一条（= 既有 27 张悬赏卡 / 低安遭遇 / AI 副船全部场次）
  // ⇒ 恒返回那一条、**一次随机数都不消费**。这里**刻意不看存活**：改动前敌方主炮分支只判
  // `!meRt`、不判 `isAlive`，故"我方在某一拍被打沉后、本拍剩余敌人仍照旧结算开火"——
  // 那一发打在尸体上、对战果无影响，但**会进 `stats.foeShots`**（标定工具「敌开火」列）。
  // 若在此提前返回 null，该计数会少掉最后一拍 ⇒ 与改动前口径不一致（D 批实测到的唯一漂移）。
  if (myUnits.length === 1) {
    /**
     * **隐秘行动**（2026-09-15 船长）：唯一那艘若在隐身窗口内 ⇒ 敌方**无人可选** ⇒ 本发停火
     * （Q2 甲）。**零漂移命门照旧**：没装装置时 `isMyUnitTargetable` 恒真 ⇒ 与改动前逐字等价、
     * 一次随机数都不多消费。
     */
    const only = myUnits[0]!
    return isMyUnitTargetable(b, only.tag) ? only : null
  }
  const alive = aliveMyUnits(b, myUnits).filter((u) => isMyUnitTargetable(b, u.tag))
  if (alive.length === 0) return null
  if (alive.length === 1) return alive[0]!
  /**
   * **按"被选中权重"加权抽取**——走仓内单点 `pickWeighted`（`bound: 'lt'`，与原先的
   * `nextInt(rng, n) = ⌊u × n⌋` 同边界），**恰好消费一次 `nextRandom`**。
   *
   * ⚠⚠ **零漂移命门（2026-09-26 插件批的等价性证明）**：全部权重都等于 1 时，
   * `roll = u × n` 落在第 k 段 ⇔ `⌊u × n⌋ = k`（仅在 `u × n` 精确等于整数 k 的边界上两者都取 k）
   * ⇒ 与改动前的 `nextInt(state.rng, cands.length)` **恒等**，随机数消费次数也一致。
   * 没装靶标/隐匿插件的全部既有场次（含 27 张悬赏卡与标定读数）**逐位不变**。
   */
  const weightOf = (u: UnitSpec): number => {
    const w = u.targetWeightMul
    return w !== undefined && Number.isFinite(w) && w > 0 ? w : 1
  }
  const randomOf = (cands: UnitSpec[]): UnitSpec =>
    pickWeighted(state.rng, cands, weightOf) ?? cands[cands.length - 1]!
  /**
   * **倾向概率的掷骰点**（2026-09-14 船长）：**每发开火前各掷一次**，没掷中 ⇒ 这一发乱了。
   * 位置刻意放在两个早退**之后** —— 单船 / 只剩一艘时恒返回、不掷骰（洞外零漂移的命门）。
   */
  const missed = chance < 1 && mode !== 'random' && nextRandom(state.rng) >= chance
  if (mode === 'random' || missed) return randomOf(alive)
  switch (mode) {
    case 'top-output': {
      const best = Math.max(...alive.map((u) => myUnitOutputScore(u)))
      return randomOf(alive.filter((u) => myUnitOutputScore(u) === best))
    }
    case 'smallest':
    case 'largest': {
      const tiers = alive.map((u) => u.shipTier ?? 1)
      const want = mode === 'smallest' ? Math.min(...tiers) : Math.max(...tiers)
      return randomOf(alive.filter((u) => (u.shipTier ?? 1) === want))
    }
    case 'noncombat': {
      const civ = alive.filter((u) => isNonCombatShipRole(u.shipRole))
      return civ.length > 0 ? randomOf(civ) : randomOf(alive)
    }
    // `random` 已在上面早退（`mode === 'random' || missed`）⇒ 这里只剩兜底
    default:
      return randomOf(alive)
  }
}

/** 锁定目标（2026-09-09 锁定装置）：存活编队首位（foes 生成序 = 主舰优先），
 * 主舰击毁自动接力下一艘——集火永不卡空；确定性、不消耗 rng */
export function firstAliveFoe(foes: UnitSpec[], b: import('../state').BattleState): UnitSpec | null {
  for (const f of foes) if (isFoeEngageable(b, f.tag)) return f
  return null
}

/**
 * V18B 随机目标（船长 2026-09-05）：从存活敌人中均匀随机抽一个（确定性走 state.rng——
 * 种子固定则每场可复现；每发武器调用一次 = 齐射可分散到不同目标）。
 */
export function randomAliveFoe(state: import('../state').GameState, b: import('../state').BattleState, foes: UnitSpec[]): UnitSpec | null {
  // ⚠ 抽签池 = **可选中**的敌人（`isFoeEngageable`：存活 + 已过入场窗口）——池子为空 ⇒ 返回 null
  //    ⇒ 本发武器跳过（`advanceBattleFor` 里 `if (!foeTarget && !droneHit) continue`），本拍停火。
  const alive = foes.filter((f) => isFoeEngageable(b, f.tag))
  if (alive.length === 0) return null
  const i = nextInt(state.rng, alive.length)
  return alive[i]!
}
