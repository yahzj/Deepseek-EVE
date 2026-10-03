/**
 * **机群池与近防炮**（2026-10-02 从 `combat.ts` 拆出 · 批次 4j · 零行为变化）。
 *
 * 本文件 = 无人机**机群池**与近防炮选靶/还手：池键、放飞条目、近防炮优先级、反击令牌、敌方机群选靶——
 * 只依赖 state 类型 / types / rng / combatFx / combatMath。`combat.ts` 原样再导出（先例：fitted.ts），
 * 既有引用零改动。
 */
import type { GameState } from './state'
import type { BattleBalance, DamageType, FoeFamily, SimContext } from './types'
import type { UnitSpec } from './combat'
import { applyDamage, battleShowWindowMs, clamp, isAlive } from './combatMath'
import { nextInt, nextRandom, pickOne } from './rng'
import { BATTLE_ARRIVAL_FLY_MS, pushBattleFx } from './combatFx'
import { droneReviveNoteLoss } from './droneRevive'

/* 以下为 2026-10-02 批次 4j 从 combat.ts 切接过来的整簇（aliveDroneKeys ~ pickFoeDroneTarget）。 */

/**
 * 近防炮可选靶（存活放飞条目下标）：
 * - 哨戒机**优先**（`pdPriorityOf` = 0），但**要进射程**才算候选（2026-09-12 船长改判：
 *   原 2026-09-10「近防炮不打哨戒无人机」**已作废**；见 `PD_PRIORITY_BY_ART` 与 `PD_SENTRY_RANGE_M`）；
 * - **非哨戒机全被摧毁后，近防炮转而攻击哨戒机**（2026-09-10 船长追加）——
 *   即"机群里还有别的机型就先打别的，只剩哨戒机时才打它"。
 */
function aliveDroneKeys(
  b: import('./state').BattleState,
  sentryIds: ReadonlySet<string> = SENTRY_DRONE_IDS,
  sentriesInRange = false,
  sentryOnly = false,
): string[] {
  const pools = b.dronePools
  if (!pools) return []
  const others: string[] = []
  const sentries: string[] = []
  for (const [k, p] of Object.entries(pools)) {
    if (!p.alive) continue
    if (p.artId && sentryIds.has(p.artId)) sentries.push(k)
    else others.push(k)
  }
  // **船长 2026-09-11：关闭"哨戒机可被攻击"的机制**（代码保留、不删）——常驻伴飞的哨戒机停在
  // 母舰旁、**从不飞到敌方** ⇒ **永不被攻击**；**只有出击型（会飞到敌舰旁的那些）才会挨打**。
  // 置 `PD_TARGET_SENTRIES = true` 即恢复旧口径（非哨戒机全灭后转而打哨戒机）。
  // **哨戒机：只在近防炮射程内才可被反击**（船长 2026-09-11 重新定义）——
  // 出击型不受此限，它们的反击由"被攻击"驱动（令牌见 resolvePointDefense）。
  if (sentryOnly) return sentries
  if (!sentriesInRange) return others
  return [...others, ...sentries]
}

/**
 * 哨戒机"可被攻击"的机制已由船长 2026-09-11 关闭；当年那份开关常量（PD_TARGET_SENTRIES）已随
 * 2026-10-02 未用代码清理删除（机制代码早已不在，留着开关只会误导——要恢复见 git 历史 09-11 提交）。
 */

/**
 * **反应式防空的窗口（毫秒）**（船长 2026-09-11：「**每轮都是被攻击后才开火**」）——
 * 近防炮只在'**刚被机群打过**'的这段时间内还手；超窗脱锁，等下一轮被打再开火。
 * 取 5,000ms：略长于敌机装填（4,400ms）⇒ **每一轮敌机攻击都换来一次反击窗口**。
 */
const PD_REACTIVE_WINDOW_MS = 5_000

/**
 * **哨戒机可被反击的射程（米）**（船长 2026-09-11 重新定义近防炮）——
 * · **非哨戒机（出击型）**：**攻击一次 ⇒ 换一次无视射程的反击**（它们扑到敌方去，永远够得着）；
 * · **哨戒机**：不适用'被攻击换反击'，而是**进入近防炮射程内**就会被反击
 *   （它常驻自己母舰旁 ⇒ 平时安全；两舰贴到 2,500m 以内它就暴露）。
 * 取 2,500m ＝ 我方近防炮射程 ⇒ **两侧同口径**。
 */
const PD_SENTRY_RANGE_M = 2_500

/** 哨戒机机型 id（**2026-09-12 起为"优先打击"而非"排除"**；机型表变化时此处同步） */
const SENTRY_DRONE_IDS: ReadonlySet<string> = new Set(['drone-sentry'])

/** 存活放飞条目**键**（近防炮选靶 / 开火跳过共用）——2026-09-14 起返回 `舰tag:下标`（逐舰机群）；
 *  `droneTotalCount` 已随"取消单场上限"移除用途 */

/** **机群池键**（2026-09-14 船长「逐舰机群」）：`舰tag:武器条目下标`。
 *  老档的**纯数字键**（只有主控）由 `save.ts` 归一成 `player:<下标>`（零迁移）。 */
export function dronePoolKey(tag: string, wi: number): string {
  return `${tag}:${wi}`
}
/** 池键 → 所属舰 tag（老档/异常键一律算 `player`） */
export function dronePoolOwner(key: string): string {
  const i = key.indexOf(':')
  return i > 0 ? key.slice(0, i) : 'player'
}

/**
 * **建一艘船自己的机群生存池**（2026-09-14 船长「逐舰机群」）：按该舰 `weapons` 里 `src='drone'`
 * 的条目逐条建（键 = `舰tag:下标`），机型三层血/抗性/闪避取自物品本体（`DroneDefense`）。
 * `durMul`/`evaMul` = 无人机线技能（耐久学 × 强化学 乘算 / 规避学）的既有系数，由调用方算一次传进来。
 * （2026-10-02 批次 4j：因 combat 的 startBattleFor 仍要调用而转公开，不进 combat 公开面）
 */
export function buildDronePoolsFor(
  ctx: SimContext,
  spec: UnitSpec,
  pools: Record<string, import('./state').DronePoolEntry>,
  durMul: number,
  evaMul: number,
): void {
  const tag = spec.tag ?? 'player'
  spec.weapons.forEach((w, i) => {
    if (w.src !== 'drone' || !w.artId) return
    const d = ctx.items.get(w.artId)?.defense
    // ⚠ 合并（2026-09-27）：本行同时吃两批改动 —— ①护盾投射仪给放飞机群加**护盾层**
    //   ②「无人机储备甲板」要记满血三层值。⇒ 护盾加成**并进 `sMax`**，再统一用 `s: sMax` 赋值。
    const sMax = Math.max(1, Math.round((d?.shieldHp ?? 1) * durMul * (1 + (spec.droneShieldBonusPct ?? 0))))
    const aMax = Math.max(1, Math.round((d?.armorHp ?? 1) * durMul))
    const hMax = Math.max(1, Math.round((d?.hullHp ?? 1) * durMul * (1 + (spec.droneHullBonusPct ?? 0))))
    pools[dronePoolKey(tag, i)] = {
      owner: tag,
      s: sMax,
      a: aMax,
      h: hMax,
      alive: true,
      artId: w.artId,
      evasion: clamp(0, 0.9, (d?.evasion ?? 0) * evaMul),
      /**
       * **本架满血三层值**（2026-09-27）：原先只有敌方池记这三个字段，我方池不记 ⇒
       * 「无人机储备甲板」把一架打光的机子翻回 `alive` 时会停在 0 血上、下一拍立刻再死。
       * 记满值后与敌方"备用机库补位"**同一套字段**（`p.s = p.maxS ?? p.s`）。
       */
      maxS: sMax,
      maxA: aMax,
      maxH: hMax,
      ...(d
        ? {
            resists: {
              ...(d.shieldResist ? { shield: d.shieldResist } : {}),
              ...(d.armorResist ? { armor: d.armorResist } : {}),
              ...(d.hullResist ? { hull: d.hullResist } : {}),
            },
          }
        : {}),
    }
  })
}

/** 本场已击落架数 */
export function droneLostCount(b: import('./state').BattleState): number {
  return Object.values(b.droneLost ?? {}).reduce((s, n) => s + n, 0)
}

/** 近防炮选靶优先级（2026-09-12 船长：「**优先攻击哨戒和攻坚无人机**」「侦查和普通战机相同权重抽取」）：
 *  `0` = 最高（哨戒机）· `1`（攻坚机）· `2` = 其余（侦察机 / 战斗机 / 专属机等，**彼此等权**）。
 *
 *  ⚠ **两侧共用本函数、查表轴不同**（P-40 收口时发现）：**敌方侧**打的是**我方机型**（id 稳定、
 *  表里有登记）⇒ 按**机型 id** 命中；**我方侧**打的是**敌方机型**（不受本表约束，且日后才可能加
 *  哨戒/攻坚机型）⇒ 查不到时**退回按 `role` 判档**（`sentry` → 0 / `assault` → 1），加机型即生效。
 *  ⚠ 哨戒机另受"进 `PD_SENTRY_RANGE_M`（我方侧 = 本武器射程）才暴露"的约束（船长 2026-09-11 重新定义）。 */
const PD_PRIORITY_BY_ART: Record<string, number> = {
  'drone-sentry': 0,
  'drone-heavy': 1,
  /**
   * **族专属机同档位**（2026-09-26 补）：近防炮"优先打哨戒与攻坚"的口径按**档位**生效，
   * 不该因为某型是专属机就掉进"其余等权"（`pdPriorityOf` 的 `role` 兜底只覆盖敌方机型）。
   * 三型出处 = `drone-wh-e-sentry`（E 构件哨戒）· `drone-wh-c-heavy`（C 巢卫攻坚）·
   * `drone-exile-bee`（G 鱿蜂 · 侦察档 ⇒ 与其他侦察机等权，**不列**）。
   */
  'drone-wh-e-sentry': 0,
  'drone-wh-c-heavy': 1,
  // H 族「墨潮重袭无人机」（攻坚档；H 族势力装备批 2026-09-26 新增）
  'drone-ink-heavy': 1,
}
/** 机型 → 近防炮选靶优先级（见上表；导出供 `pd-rules` 契约逐型断言，与 `pdShotOf` 同款"为可测导出"） */
export function pdPriorityOf(artId: string | undefined | null, role?: string): number {
  const byArt = artId ? PD_PRIORITY_BY_ART[artId] : undefined
  if (byArt !== undefined) return byArt
  if (role === 'sentry') return 0
  if (role === 'assault') return 1
  return 2
}

/**
 * **一发的近防炮读数**（命中率、伤害与弹种的**唯一取数口**）：全局值 ＋ **舰种档系数** ＋ **按族覆写**。
 *
 * - `acc` = `bal.pdAcc` ＋ 族覆写 `accAdd`（**百分点**）—— 调用方再与机型闪避相乘减、并走 `pdHitFloor` 下限；
 * - `dmg` = `bal.pdDmg` × `pdTierMul[档]` × 族覆写 `dmgMul`；
 * - `dmgType`（**2026-10-03 加**）= 族覆写 `dmgType` ?? `'kinetic'`（三档动能近防炮那条线）；
 * - `autoHit`（**2026-10-03 加**）= 族覆写 `autoHit === true` ⇒ **必中**：调用方**不掷命中、也不吃闪避**。
 *
 * ⚠ 抽成函数只为**单一取数口 + 可测**（用例直接断言"H 族 = 0.75 / ×1.5"、"R 族 = 能量 ＋ 必中"）；
 * 行为与内联逐字一致。
 */
export function pdShotOf(
  bal: BattleBalance,
  family: FoeFamily | undefined,
  hullClassTier: number | undefined,
): { acc: number; dmg: number; dmgType: DamageType; autoHit: boolean } {
  const ov = family !== undefined ? bal.pdFamilyOverride?.[family] : undefined
  const tierMul = bal.pdTierMul?.[Math.min(4, Math.max(0, (hullClassTier ?? 1) - 1))] ?? 1
  return {
    acc: bal.pdAcc + (ov?.accAdd ?? 0),
    dmg: bal.pdDmg * tierMul * (ov?.dmgMul ?? 1),
    dmgType: ov?.dmgType ?? 'kinetic',
    autoHit: ov?.autoHit === true,
  }
}

/**
 * 近防炮结算（每拍调用；2026-09-10 船长口径 · **2026-09-12 八条裁决改版**）：
 * - 每艘点防舰**独立**按 `pdJudgementMs`（0.5s）判定一次 ⇒ **判定频率 = 火力密度**（反击制只决定"能不能开火"）；
 * - **集火**（船长 2026-09-12）：锁定一架直到它被击落才换靶（旧口径 = 每拍随机换靶 ⇒ 伤害摊薄到整群、几乎打不掉）；
 * - **选靶优先级**：**哨戒机 → 攻坚机 → 其余等权抽取**（侦察机与战斗机同权）；
 *   ⚠ **前提：哨戒机必须在近防炮射程内**（船长 2026-09-12：「**优先攻击哨戒机的前提是哨戒在射程内**」）——
 *   哨戒机**只有 `distanceM ≤ PD_SENTRY_RANGE_M`（2,500m）时才进候选池**（见 `aliveDroneIndices`：
 *   `if (!sentriesInRange) return others`）⇒ 两舰拉开距离时它**既不可选、也不占优先级**，
 *   优先级自然落到"攻坚机 → 其余"；**集火锁**同样在它出射程那一刻解除（候选池里没有它了）。
 * - 命中 = `clamp(pdHitFloor, 1, pdAcc − 机型闪避)`（**下限 10%**，修掉"闪避 ≥ pdAcc ⇒ 永久免疫"）；
 * - 伤害 = `pdDmg × 舰种档系数(pdTierMul)`（**越大的船防空越强**：T1 1.0 / T3 2.0 / T5 4.0），
 *   再走该机型三层抗性；血量打空 = 该架本场击落（停火 + 计入 droneLost + 击落演出）；
 * - **两条独立开火许可**（2026-09-12 **修 bug**）：旧代码要求"哨戒机在射程内"**并且**有令牌，
 *   等于把"出击型打一次换一次反击"整条路掐死（出击型机群永远不会被反击、实测战损恒为 0）：
 *   a) **反击令牌**：我方无人机打过敌舰 ⇒ 窗口内还手（**无视距离**，船长 2026-09-11 口径）；
 *      ⚠ 该令牌**敌方全队共用**（不是逐舰）——船长 2026-09-16 复核定论「**点防没问题**」（见 `state.ts` `droneHitAt`）；
 *   b) **哨戒机在射程内**：常驻暴露 ⇒ 不需令牌即可还手（船长 2026-09-11 重新定义）；
 * - **不看距离**（放飞出去就在威胁之下）；**战斗内可 100% 损坏**（战后按回收率找回一部分）；
 * - 近防炮不参与敌舰对玩家的常规攻击（独立系统）；全程消费 state.rng，确定性可复现。
 * （2026-10-02 批次 4j：因 combat 的 stepBattle 仍要调用而转公开，不进 combat 公开面）
 */
export function resolvePointDefense(
  state: GameState,
  b: import('./state').BattleState,
  foes: UnitSpec[],
  bal: BattleBalance,
  dtMs: number,
): void {
  const pools = b.dronePools
  // 无近防炮调度 = 本场敌舰未达威胁门槛（或本改动前的旧战斗）：不结算
  if (!pools || b.pdCd === undefined) return;
  const period = Math.max(100, Math.round(bal.pdJudgementMs))
  // ⚠ **哨戒机只在射程内可选/可被反击**（船长 2026-09-11 重新定义）
  const sentryOk = b.distanceM <= PD_SENTRY_RANGE_M
  // 许可 a：**反击令牌**（我方无人机打过敌舰 ⇒ 窗口内还手，**无视距离**）
  const foeHitAt = b.droneHitAt?.foe
  const tokenOpen =
    foeHitAt !== undefined && b.lastTickGameMs - foeHitAt <= PD_REACTIVE_WINDOW_MS
  // 许可 b：**哨戒机在射程内**（不需令牌）
  const sentryOpen =
    sentryOk && aliveDroneKeys(b, SENTRY_DRONE_IDS, true, true).length > 0
  /**
   * 🔴 **冷却推进不受闸门管辖**（**2026-09-27 修**）。
   *
   * 原来的顺序是「先判令牌、没令牌就 `return`」⇒ **冷却只在"有令牌的拍"才递减**；而令牌是
   * **消费制**、只靠"我方无人机再打中一次"刷新（无人机装填好几秒）⇒ 冷却几乎走不动
   * ⇒ 实际火力退化成"每次令牌开启时**恰好就绪的那一两艘**各一发"。
   * **实测**（探针 · 60 分钟 · 母舰波在场 4 艘点防舰）：只命中 **13 发** —— 与"每艘每 0.5 秒
   * 判定一次"的设计差两个数量级。
   *
   * 令牌该管的是"**能不能开火**"，不该管"冷却走不走"⇒ 现在冷却照常推进，只关掉判定。
   */
  const canFire = tokenOpen || sentryOpen
  // **消费制**（船长 2026-09-11）：一次攻击换一次还手（对每艘点防舰各一次）
  // ⚠ **本令牌为敌方全队共用、非逐舰**（打到**任意一艘**敌舰 ⇒ 当场所有冷却已就绪的敌点防舰**各还手一次**，
  //   冷却仍各走各的 `pdCd[fi]`）。这与我方侧**故意不对称**——我方侧 2026-09-16 起是**逐舰令牌**
  //   （`droneHitAtMeBy`：要打到那艘船它才能反击，见 `pickFoeDroneTarget`）。
  //   船长 2026-09-16 复核定论「**点防没问题**」⇒ 本条**按现状保留**：不许照"逐舰"把敌方侧也改过去
  //   （改它＝动玩家无人机在多舰敌卡里的战损口径）。
  if (tokenOpen) b.droneHitAt = { ...(b.droneHitAt ?? {}), foe: undefined }
  const focus: Array<string | undefined> = b.pdFocus ? [...b.pdFocus] : []
  for (let fi = 0; fi < foes.length; fi++) {
    if (!isAlive(b, foes[fi]!.tag)) continue
    let cd = (b.pdCd[fi] ?? period) - dtMs
    let guard = 0
    while (cd <= 0 && guard < 64) {
      guard++
      cd += period;
      if (!canFire) break // 闸门关：**冷却照推、判定不做**（2026-09-27 修）
      // 候选 = 存活放飞条目（哨戒机**只在射程内**可选）
      const candsAll = aliveDroneKeys(b, SENTRY_DRONE_IDS, sentryOk)
      if (candsAll.length === 0) break
      /**
       * **逐舰各自挨打**（船长 2026-09-14）：本舰先选**一条舰**、再在该舰机群里按优先级选机。
       * · 选舰 = **等权随机**（与"机型等权抽取"同族，不引入新的距离口径——近防炮打机群本就不看两舰间距）；
       * · **集火**（船长 2026-09-12）沿用同一把锁：上次锁的**池键**仍可选 ⇒ 继续打那一架；
       *   否则**重新选舰**再按优先级（哨戒 → 攻坚 → 其余等权）选机。
       */
      const owners = [...new Set(candsAll.map(dronePoolOwner))]
      const lockedKey = focus[fi]
      const owner =
        lockedKey !== undefined && candsAll.includes(lockedKey)
          ? dronePoolOwner(lockedKey)
          : pickOne(state.rng, owners)!
      const cands = candsAll.filter((k) => dronePoolOwner(k) === owner)
      let key = focus[fi] !== undefined && cands.includes(focus[fi]!) ? focus[fi]! : undefined
      if (key === undefined) {
        const best = Math.min(...cands.map((k) => pdPriorityOf(pools[k]!.artId)))
        const tier1 = cands.filter((k) => pdPriorityOf(pools[k]!.artId) === best)
        key = pickOne(state.rng, tier1)!
      }
      focus[fi] = key
      const pool = pools[key]!
      /**
       * **按族的近防炮覆写**（**船长 2026-09-25 令**：「增强 H 族敌人的近防炮强度：伤害 +50%、命中 +5%」
       * ⇒ `balance.pdFamilyOverride.H = { dmgMul: 1.5, accAdd: 0.05 }`）。
       * 取数收口在 `pdShotOf`（缺省族/旧路径 ⇒ 逐字走全局值，零行为变化）。
       */
      const shot = pdShotOf(bal, foes[fi]!.family, foes[fi]!.hullClassTier)
      /**
       * 命中判定（**2026-10-03 起分两支**）：
       * - **必中族（`shot.autoHit`，现 = R 族能量光束近防炮）**：**不掷骰、也不吃闪避**——
       *   与光束武器同一句语义（引擎里 `autoHit ⇒ meHit = 1`，见 `combat` 我方开火段）
       *   ⇒ 连 `pdHitFloor` 与机型闪避一起绕过；
       * - 其余族（三档动能近防炮那条线）：命中 = clamp(**下限 10%**, 1, pdAcc ＋ 族覆写 − 闪避)
       *   （船长 2026-09-12 定式；覆写为 2026-09-25 加）。
       */
      const pHit = clamp(bal.pdHitFloor ?? 0, 1, shot.acc - pool.evasion)
      if (!shot.autoHit && nextRandom(state.rng) >= pHit) continue // 未命中（闪避生效）
      // 伤害 = pdDmg × **舰种档系数**（越大的船防空越强）× **族覆写**，弹种走 `shot.dmgType`
      const res = applyDamage(
        { s: pool.s, a: pool.a, h: pool.h },
        pool.resists ?? {},
        shot.dmg,
        shot.dmgType,
      )
      pool.s = res.hp.s
      pool.a = res.hp.a
      pool.h = res.hp.h
      if (pool.s + pool.a + pool.h <= 0) {
        pool.alive = false
        focus[fi] = undefined // 目标已灭 ⇒ 本舰下一拍重选
        // 机型直接从**池条目**取（2026-09-14「逐舰」后不再回查主控武器表：键里有舰 tag，池里有 artId）
        const artId = pool.artId ?? 'drone'
        const ownerTag = pool.owner ?? dronePoolOwner(key)
        b.droneLost = { ...(b.droneLost ?? {}) }
        b.droneLost[artId] = (b.droneLost[artId] ?? 0) + 1
        // **逐舰战损**（船长 2026-09-14「战损按舰归属」）：结算按舰扣各自的机舱清单
        const byOwner = { ...(b.droneLostBy ?? {}) }
        byOwner[ownerTag] = { ...(byOwner[ownerTag] ?? {}) }
        byOwner[ownerTag]![artId] = (byOwner[ownerTag]![artId] ?? 0) + 1
        b.droneLostBy = byOwner
        /**
         * **无人机储备甲板：入队**（2026-09-27 船长令）——与战损账**同一个事件点**：
         * 有这件装备的舰把这一架压进待补队列，并按需起一条复位周期（详见 `core/droneRevive.ts`）。
         * 没装 ⇒ `droneRevive` 字段不存在 ⇒ 本调用一步返回（**零行为变化**）。
         */
        droneReviveNoteLoss(state, b, key, b.lastTickGameMs + dtMs)
        // 击落演出事件（side='me' + src='drone' + droneDown：UI 出小爆炸/坠落）——**tag = 该架所属舰**
        // ⚠ 弹种随本族近防炮走（2026-10-03 起 R 族 = 能量）⇒ 演出/飘字配色与实收伤害同一口径
        pushBattleFx(b, {
          atMs: b.lastTickGameMs + dtMs,
          side: 'me',
          tag: ownerTag,
          type: shot.dmgType,
          src: 'drone',
          artId,
          hit: true,
          droneDown: true,
        })
      }
    }
    b.pdCd[fi] = cd
  }
  b.pdFocus = focus
}

/**
 * **防空选靶**（2026-09-11 机群批 · 船长 A1：「玩家武器通常**不可打**，**需要带有防空属性的武器**」）。
 *
 * 从存活敌机里随机抽一架——**消费 `state.rng`**，与既有'每发武器在开火瞬间独立抽取目标'同款口径。
 * - 只在**该武器自己的射程内**抽（炮台射程 ≠ 机群射程）；抽不到就照旧打舰；
 * - 已击落的架次跳过（`pool.alive === false`）；母舰阵亡 ⇒ 其机群不再参战（「机群是舰的一部分」）；
 * - 返回 `null` = 本场无机群 / 全打光 / 不在射程内。
 *
 * ⚠ **只有带 `canHitDrones` 的武器会调用本函数** ⇒ 既有武器（含我方无人机）**按构造看不到机群**，
 * 一次 `nextRandom` 都不会多消耗 ⇒ **零行为变化**。
 *
 * **导出仅供回归测试**锁住上面两条语义（零消费 rng / 击落后不再被选）——引擎内部调用，与我方
 * 无人机的 `pushBattleFx` 同款处理。真实'武器 → 机群'链路在 E 族近防炮落码后由集成用例覆盖。
 */
export function pickFoeDroneTarget(
  state: GameState,
  b: import('./state').BattleState,
  foes: readonly UnitSpec[],
  dist: number,
  w: { minRangeM: number; maxRangeM: number },
  /** 我方**武器槽下标**（集火锁定的索引轴；逐舰后键 = `舰tag:下标`，见 `BattleState.mePdFocusBy`） */
  wi = 0,
  /** **开火的那艘我方舰**（tag；缺省 `player` = 单船路径 ⇒ 与旧口径逐字相同） */
  myTag = 'player',
): { foeTag: string; pool: import('./state').DronePoolEntry } | null {
  const pools = b.foeDronePools
  if (!pools) return null;
  // **反应式**（船长 2026-09-11「每轮都是被攻击后才开火」）：只有**刚被机群打过**才反击——
  // 敌机没打过来（或已超出窗口）⇒ 近防炮不开火（"敌方无人机只有靠近你你才能反击"）。
  // ⚠ **2026-09-16 逐舰**（船长「将缺少的一并实现」）：令牌按**本舰**取/消费
  //   （旧口径 `droneHitAt.me` 全队共用一个、一次反击就消费掉 ⇒ 4 舰编队整队每轮只换到一发反击）。
  /**
   * **全队反击**（**2026-09-27 船长令**：「**将反击原本是被打的舰船反击改为全队反击一次（对我方也生效）**」）。
   *
   * 旧口径（2026-09-16 逐舰）：令牌记在**被打的那艘船**名下 ⇒ 只有它反击，编队里其它带近防炮的舰干看着。
   * 新口径：令牌**全队共用**（`droneHitAt.me`，写入点见 `applyMyWeaponFire` 那一侧）——
   * **任意一艘挨打 ⇒ 全队每艘带近防炮的舰各反击一次**；"各一次"用**逐舰消费时刻**保证
   * （`droneHitAtMeBy[本舰tag] = 本次令牌时刻`，判据 `本舰消费时刻 >= 令牌时刻` ⇒ 同一次挨打不重复反击），
   * 令牌本身**不清空** ⇒ 等下一次挨打刷新时刻、全队再来一轮。
   */
  const tokenAt = b.droneHitAt?.me
  if (tokenAt === undefined || b.lastTickGameMs - tokenAt > PD_REACTIVE_WINDOW_MS) return null
;
  /**
   * **逐门记账**（2026-09-17 修玩家报障：「**多个近防炮对无人机的伤害不叠加，同时装MK2和MK3只有一个开火**」）：
   *
   * 旧口径在这之后把**整舰共用的令牌删掉**（`delete nextTokens[myTag]`）⇒ 同一拍里**第一门**近防炮开完火，
   * 其余门（含 MK2/MK3 这种不同武器条目）全部拿到 null ⇒ 加装近防炮**毫无收益**（取证：一艘船装 3 门，
   * 每拍开火发数与只装 1 门相同）。船长 2026-09-11 定"消费制"的本意是**防一直开火**，不是"一舰只准一门开火"。
   *
   * 现改为：**令牌保留**（它记的是"本舰何时挨了机群打"），每门武器按 `舰tag:武器下标` 各记一次
   * "这次挨打我已经还过手"⇒ **一次敌机攻击 = 本舰每门近防炮各还手一次**；窗口过期仍由上面的
   * `PD_REACTIVE_WINDOW_MS` 判断兜底 ⇒ 不会退回"一直开火"。
   */
  const lockKey = dronePoolKey(myTag, wi)
  /**
   * **逐门记账**（2026-09-17 修「多门近防炮对无人机的伤害不叠加」那批）：键 = `舰tag:武器下标`。
   * **2026-09-27 船长令**（「将反击原本是被打的舰船反击改为**全队反击一次**（对我方也生效）」）后判据统一到本表：
   * **一次挨打 = 全队每艘舰的每一门近防炮各还手一次**（全队令牌 `droneHitAt.me` 共用且**不清空**，
   * 靠"本门已对本次令牌时刻还手过"防重复；窗口过期由上面的 `PD_REACTIVE_WINDOW_MS` 兜底）。
   */
  const answered = b.mePdAnsweredBy?.[lockKey]
  if (answered !== undefined && answered >= tokenAt) return null  /** 成功还手后记账（只有**选到目标**才算还过手：没目标时不消耗本门这次机会） */
  const markAnswered = (): void => {
    b.mePdAnsweredBy = { ...(b.mePdAnsweredBy ?? {}), [lockKey]: tokenAt }
  }
  // ⚠ **打机群不按两舰间距判射程**（船长 2026-09-11 裁定 · 甲案）：敌机在画面里是**飞到您舰旁**
  // 才开火的——机制服从画面 ⇒ 只要机还活着、近防炮就能打它（近防炮的射程只对"打舰"生效）。
  // 旧口径用 `b.distanceM` 判 ⇒ 画面里贴着您的敌机被当成在 4.5km 外 ⇒ 近防炮"不工作"（船长实测）。
  const cands: Array<{
    foeTag: string
    idx: number
    pool: import('./state').DronePoolEntry
    /** 该机型的角色（选靶优先级按 role 兜底判档——敌方机型不受我方 id 表约束） */
    role: string | undefined
  }> = []
  for (const f of foes) {
    if (!isAlive(b, f.tag)) continue;
    // **入场窗口内的敌舰整舰不可交战**（船长 2026-09-14「动画没结束不开火」）：它的机群自然也打不到
    // ——母舰还在跃迁/入场中，机库里的机还没跟着到场。
    if (!isFoeEngageable(b, f.tag)) continue;
    // 该舰各机型的**角色**（哨戒机按"进射程才可打"处理——船长 2026-09-11 重新定义近防炮）
    const roleOf = new Map<string, string>()
    for (const slot of f.foeDrones ?? [])
      roleOf.set(slot.drone.id, slot.drone.role)
    const arr = pools[f.tag] ?? [];
    for (let i = 0; i < arr.length; i++) {
      const p = arr[i]!;
      if (!p.alive) continue;
      if (p.inHangar === true) continue; // **备用机在库**：还没放飞 ⇒ 打不到它（2026-09-12）
      // **对称规则**（P-40）：敌方**哨戒机**要在**本武器射程内**才可被打；
      // **出击型**不受射程限制（它们扑到我方来，反击由"被攻击"的令牌驱动）。
      const role = p.artId ? roleOf.get(p.artId) : undefined
      if (role === 'sentry' && (dist < w.minRangeM || dist > w.maxRangeM))
        continue
      cands.push({ foeTag: f.tag, idx: i, pool: p, role })
    }
  }
  if (cands.length === 0) return null
  // ── **集火**（2026-09-12 船长「改为集火制度」；P-40 乙案：与我方侧口径对齐）──
  // 本武器已锁定的那架**还活着且仍可打** ⇒ 继续打它（换靶只发生在"被击落 / 被备用机替换 / 出射程"时）。
  // ⚠ 与敌方侧 `pdFocus` 同口径（那侧按**点防舰**同序存）；**我方侧 2026-09-16 起按 `舰tag:武器下标` 存**
  //   （旧口径只按下标 ⇒ 多舰的 0 号武器互相顶锁；旧字段 `mePdFocus` 只服务在途老战斗）。
  //   `lockKey` 已在上方（令牌记账处）算好，两处共用同一个键。
  const focusBy = b.mePdFocusBy
  const locked = focusBy ? focusBy[lockKey] : b.mePdFocus?.[wi]
  if (locked) {
    const keep = cands.find((c) => c.foeTag === locked.tag && c.idx === locked.idx)
    if (keep) {
      markAnswered()
      return { foeTag: keep.foeTag, pool: keep.pool }
    }
  }
  // ── **选靶优先级**（船长 2026-09-12：「**优先攻击哨戒和攻坚无人机**」「侦查和普通战机相同权重抽取」）──
  // 与敌方侧 `pdPriorityOf` **同一张表**：哨戒 0 → 攻坚 1 → 其余 2；取**当前存在的最低档**，同档**等权随机**。
  let best = 2
  for (const c of cands) {
    const p = pdPriorityOf(c.pool.artId, c.role)
    if (p < best) best = p
  }
  const tier = cands.filter((c) => pdPriorityOf(c.pool.artId, c.role) === best)
  const pick = tier[nextInt(state.rng, tier.length)]!
  if (focusBy) {
    b.mePdFocusBy = { ...focusBy, [lockKey]: { tag: pick.foeTag, idx: pick.idx } }
  } else {
    const focus: Array<{ tag: string; idx: number } | undefined> = b.mePdFocus ? [...b.mePdFocus] : []
    focus[wi] = { tag: pick.foeTag, idx: pick.idx }
    b.mePdFocus = focus
  }
  markAnswered() // 本门这次挨打还过手了（其余门各自记账，互不顶掉）
  return { foeTag: pick.foeTag, pool: pick.pool }
}

/**
 * **敌舰是否"可被我方选中"**（= 能开火打它）——船长 2026-09-14：「**动画没结束不开火**」。
 *
 * 判据 = **真值存活**（{@link isAlive}）**且已过入场窗口**（{@link BATTLE_ARRIVAL_FLY_MS}）：
 * 洞内首波的敌舰跃迁入场、以及每一次波次转场/增援入场，在窗口内都**不可被选中**——
 * 于是我方的枪口会**跳过它去打别人**；若窗口内没有别的可打目标，本拍自然停火（转场时正是这种情况）。
 *
 * 为什么这条要做成**选靶判据**而不是"伤害免疫"：引擎里**命中与伤害同拍结算**（没有在途弹道状态，
 * 界面上那条延迟弹道只是演出）⇒ 选靶处排除即**彻底**堵住"登场第一拍就被齐射带走"。
 *
 * 缺 `enteredAtMs`（开战即在的常规单位 / 洞外首波敌舰 / 老档读入）⇒ **恒可选中**（零行为变化）。
 * （2026-10-02 批次 4j 从 combat.ts 迁来：combat 的选靶函数与机群簇共用）
 */
export function isFoeEngageable(b: import('./state').BattleState, tag: string): boolean {
  if (!isAlive(b, tag)) return false
  const at = b.units[tag]?.enteredAtMs
  // 窗口按倍速等比放大（`battleShowWindowMs`）：倍速下这一窗口在真实时间里仍是 950ms ⇒ 动画演完才可被选中
  return at === undefined || b.lastTickGameMs >= at + battleShowWindowMs(b, BATTLE_ARRIVAL_FLY_MS)
}
