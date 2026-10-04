/**
 * **敌武器射程与电子舰压制**（2026-10-02 从 `combat.ts` 拆出 · 批次 4k · 零行为变化）。
 *
 * 本文件 = 敌机/敌舰**有效射程**与我方电子舰的**压制链**：受击增程、电子舰削减（加法口径、
 * 下限 3000m）、干扰舰净削减率、施加与基准账——只依赖 state 类型 / types / playerSpec。
 * `combat.ts` 原样再导出（先例：fitted.ts），既有引用零改动。
 */

/* 以下为 2026-10-02 批次 4k 从 combat.ts 切接过来的整簇（foeDroneRangeOf ~ markFoeGunRangeBuff）。 */
import type { GameState } from './state'
import type { DamageType, ModuleDef, SimContext } from './types'
import type { UnitSpec, WeaponSpec } from './combat'
import { createPlayerSpec } from './playerSpec'
import { allFittedModules, stackingOf, stackWeight, WEIGHTED_GAP_FLEET_CAP, weightedGap } from './equipment'
import { distFactor } from './combatMath'
import { coronaFocusBonusOf } from './coronaFocus'
import { moduleAllowedOnShip } from './shipFitting'
import { fleetDefOf } from './instances'

/** **敌机有效射程**（单一真相源）＝机型绝对射程 × **全敌队的受击增程倍率**（未触发 = ×1）－ **我方电子舰削减**。
 *
 *  2026-09-11 船长：「添加新机制，**受到攻击后，大幅提高无人机射程（提高 400%）**」——
 *  E 族三条舰级写 `droneRangeMulOnHit: 4` ⇒ 警戒机 5,000 → **20,000m**（本场永久、不封顶）；
 *  **全敌队一次生效**（船长二次裁定：「只触发一次，**对所有敌舰生效**」）。
 *  ⚠ **开火判定与界面（机群阵位/弹道/击落点）都读本函数**：射程只有一处算法，不出现"打得着但画得近"。
 *  ⚠ **2026-09-18 起并入电子舰的削减**（船长：「电子舰新增特性，削减敌人15%的武器射程…射程最短只能
 *  削弱到3000m」）——口径与舰体武器同款（见 `foeRangeDebuffOf`：与增程**做加法**、基础 <3000 不削）。
 */
export function foeDroneRangeOf(
  b: import('./state').BattleState,
  w: WeaponSpec,
): number {
  const buffMul = b.foeDroneRangeBuff && b.foeDroneRangeBuff > 1 ? b.foeDroneRangeBuff : 1
  return effectiveFoeRangeM(b, w.maxRangeM, buffMul)
}

/* ═══════════ 我方电子舰 · 压制敌舰武器射程（船长 2026-09-18）═══════════
 * 船长原话：「**电子舰新增特性，削减敌人15%的武器射程，可以乘法叠加，与敌人的射程增加效果做加法处理。
 * （比如10000m射程，我方一艘电子舰，对方拥有射程+50%，那么对方实际射程为13500.）
 * 射程最短只能削弱到3000m（不足3000m的无法被削弱）。**」
 *
 * 口径（三问三答全取甲）：
 * - **多艘乘法合成**：`r = 1 − Π(1 − vᵢ)`（每艘带 `ShipDef.foeRangeDebuffPct`，电子舰 = 0.15）
 *   ⇒ 1 艘 15% · 2 艘 **27.75%** · 3 艘 38.6%；
 * - **与敌方增程做加法**：**净倍率 = 增程倍率 − r**（例：10000、敌 +50%、我方 1 艘 ⇒ 10000×(1.5−0.15)=**13500**）；
 * - **地板**：敌舰/机型的**基础射程 < `FOE_RANGE_DEBUFF_FLOOR_M`（3000m）⇒ 完全不削**（只吃它自己的增程）；
 *   否则削后结果**下限 3000m**；
 * - **只动最远射程**，近界不动（与既有「受击增程」口径一致，见 `foeGunMaxRangeOf` 的注释）。
 *
 * **落点 = 两处既有单一真相源**（开火门 / 距离衰减 / 战斗界面射程标签全部自动跟随，不新增第三份算法）：
 * `foeGunMaxRangeOf`（舰体武器）与 `foeDroneRangeOf`（敌方机群放飞射程）。
 * **削减率每拍重算进运行态 `BattleState.meFoeRangeDebuff`**（不随档 ⇒ 读档/中途换编队都不陈旧）。 */
export const FOE_RANGE_DEBUFF_FLOOR_M = 3000

/**
 * **该件"装上船之后"的效果读数**（**2026-09-29 船长令**：「之后所有多装递减的装备，能否采用和维修装置
 * 类似的 '真实数值（原始数值）' 这样的方式标注参数？」）——界面**唯一取数口**，
 * 与 `repairStatsFor` 同一条纪律：**界面不许自己折权**，否则显示值与实战值必然漂移。
 *
 * 两类口径：
 * - **折权族**（`stackingOf().group` = `curve` / `weighted` / `fleetDecay`）：本件**自己那一份**的有效值
 *   = `原值 × stackWeight(该舰同族第 n 件)`（`ordinal` 由调用方按装配位序给，缺省 1）；
 * - **缺口族**（`gap`：三系抗性 / 闪避）：逐件折权没有干净算法（缺口复合是非线性的）
 *   ⇒ 报**装上后该舰的合成值**（走 `createPlayerSpec`，与战斗同一份规格），原值仍是本件那一份。
 *
 * 维修装置（`repairArmorHp` / `repairHullHp`）**不在本表内**——它另有 `repairStatsFor`
 * （那条还要叠"层容量增幅 × 恢复量技能"）⇒ 两处各出一行、不重复。
 *
 * ⚠ 放在 `combat.ts` 而不是 `equipment.ts`：缺口族要读 `createPlayerSpec`，而 `equipment` 是被
 * `combat` 依赖的那一层（放那边会成环；`repair.ts` 当初也是为同一件事单开的）。
 */
export function fittedEffectParamsOf(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  mod: ModuleDef,
  ordinal = 1,
): Array<{ key: string; raw: number; eff: number }> {
  const out: Array<{ key: string; raw: number; eff: number }> = []
  const group = stackingOf(mod).group
  const w = group === 'flat' || group === 'max' ? 1 : stackWeight(Math.max(1, ordinal))
  /** 折权族：本件自己那一份（`raw × 曲线权重`） */
  const folded = (key: string, raw: number | undefined): void => {
    if (raw === undefined || raw === 0) return
    out.push({ key, raw, eff: raw * w })
  }
  folded('speed', mod.speedBonusPct)
  folded('droneRange', mod.droneRangeBonusPct)
  folded('shieldPulse', mod.shieldPulsePct)
  folded('shieldField', mod.shieldFieldPct)
  folded('hit', mod.hitBonusPct)
  folded('lock', mod.lockDmgBonus)
  folded('warp', mod.warpSpeedBonusPct)
  folded('ecmRangeCut', mod.foeRangeDebuffPct)
  /** 缺口族：报装上后的**合成值**（`createPlayerSpec` = 引擎同一份规格） */
  if (group === 'gap') {
    const spec = createPlayerSpec(state, ctx, shipId)
    if (spec) {
      for (const [type, v] of Object.entries(mod.shieldResistAdd ?? {})) {
        out.push({
          key: `resistShield:${type}`,
          raw: v ?? 0,
          eff: spec.resists.shield?.[type as DamageType] ?? 0,
        })
      }
      for (const [type, v] of Object.entries(mod.armorResistAdd ?? {})) {
        out.push({
          key: `resistArmor:${type}`,
          raw: v ?? 0,
          eff: spec.resists.armor?.[type as DamageType] ?? 0,
        })
      }
      if (mod.evasionGapPct !== undefined) out.push({ key: 'evasion', raw: mod.evasionGapPct, eff: spec.evasion })
    }
  }
  return out
}

/**
 * 编队当前的**敌舰射程削减率** `r`（无电子舰/无压制件 = 0）。
 *
 * **口径（2026-09-29 船长裁定「丙」· 同舰递减乘法 ＋ 舰间乘法 ＋ 整队封顶）**：
 * 1. **每艘船一个池**：该舰船体自带的那份（电子舰 15%）与**该舰每一件**墨潮电子舱（各 15%）拉平，
 *    按单件效果从强到弱套 **EVE 曲线权重**（100% / 87% / 57% / 28%…）后**乘法合成**
 *    ⇒ `r_舰 = 1 − Π(1 − vᵢ·wᵢ)`（单舰饱和 ≈ 36.7%，`equipment.weightedGap`）；
 * 2. **舰与舰之间也乘法**：`r = 1 − Π(1 − r_舰)`；
 * 3. **整队总上限 60%**（`equipment.WEIGHTED_GAP_FLEET_CAP`）——没有这一道，4 舰各 3~6 件能叠到
 *    **79.1%~83.8%**，12,000 m 的敌人又被压到地板 3,000 m（玩家报障复现）。
 *
 * 船长原话（照抄）：「**墨潮电子舱玩家似乎将效果叠的很高，让所有敌人只剩下3000射程**」→
 * 「**这类全队型的效果，能否做全队多装递减，并且效果也是乘法**」→「**墨潮电子舱就照全队递减的乘法**」
 * →（看完"能叠多少"的读数后）「**丙**」。
 * **作废的两条旧口径**：① 2026-09-26 的「同舰加和、上限 0.9」；② 2026-09-29 上午先落的
 * 「整队拉平成一个池」（那条渐近只有 36.7%）。**与敌方增程做加法**与**地板 3,000 m** 照旧生效。
 *
 * **读数**：单舰 1/2/3/6 件 = 15.0 / 26.1 / 32.4 / 36.6% · 4 舰×1 件 47.8%（未封顶）·
 * 3 舰×3 件 69.1% → **60%** · 4 舰×3 件 79.1% → **60%** ⇒ 12,000 m 的敌人最多压到 **4,800 m**。
 */
export function meFoeRangeDebuffOf(
  state: GameState,
  ctx: SimContext,
  shipIds: readonly string[],
): number {
  let remain = 1
  for (const sid of shipIds) {
    const entry = state.fleet[sid]
    /** 本舰一个池：船体自带那份 ＋ 本舰每一件电子舱各一份 */
    const own: number[] = []
    const defId = entry?.defId
    const hull = defId ? (ctx.ships.get(defId)?.foeRangeDebuffPct ?? 0) : 0
    if (hull > 0 && hull < 1) own.push(hull)
    if (entry?.fitted) {
      for (const m of allFittedModules(entry.fitted, ctx)) {
        if (!moduleAllowedOnShip(fleetDefOf(state, ctx, sid), m)) continue
        const v = Math.max(0, m.foeRangeDebuffPct ?? 0)
        if (v > 0) own.push(v)
      }
    }
    const rShip = own.length === 0 ? 0 : weightedGap(own)
    if (rShip > 0) remain *= 1 - rShip
  }
  const total = 1 - remain
  return total <= 0 ? 0 : Math.min(WEIGHTED_GAP_FLEET_CAP, total)
}

/** 把编队削减率写进运行态（战斗建档与**每拍**各调一次——只写开战那一刻会在换编队/读档后陈旧）。 */
export function applyFoeRangeDebuff(
  state: GameState,
  ctx: SimContext,
  battle: import('./state').BattleState,
  shipIds: readonly string[],
): void {
  const r = meFoeRangeDebuffOf(state, ctx, shipIds)
  if (r > 0) battle.meFoeRangeDebuff = r
  else delete battle.meFoeRangeDebuff
}

/**
 * **敌方某个射程的最终有效值**（舰体武器与机群共用这一条算式）：
 * `基础 × (增程倍率 − 削减率)`，带"基础 <3000 不削"与"削后下限 3000"两道闸（见上面那段注释）。
 */
function effectiveFoeRangeM(
  b: import('./state').BattleState,
  baseRangeM: number,
  buffMul: number,
): number {
  return foeRangeWithDebuff(baseRangeM, buffMul, b.meFoeRangeDebuff ?? 0)
}

/** 上面的纯函数版（不读战斗态）——供"期望距离随削减收缩"复用同一条闸门口径 */
export function foeRangeWithDebuff(baseRangeM: number, buffMul: number, r: number): number {
  if (r <= 0) return buffMul > 1 ? Math.round(baseRangeM * buffMul) : baseRangeM
  // 「不足 3000m 的无法被削弱」：只管它自己的增程，不削
  if (baseRangeM < FOE_RANGE_DEBUFF_FLOOR_M) return buffMul > 1 ? Math.round(baseRangeM * buffMul) : baseRangeM
  const net = Math.max(0, buffMul - r)
  return Math.round(Math.max(FOE_RANGE_DEBUFF_FLOOR_M, baseRangeM * net))
}

/* ═══════════ 敌方「射程压制」（H 族墨潮干扰舰 · 2026-09-24 船长三例定死口径）═══════════
 * 船长原话：「**拥有和我方电子舰同款降低敌人射程的效果，降低效果为降低50%射程，可以和我方电子舰的
 * 效果相互抵消**」；随后**给了三个范例**把口径钉死（照抄）：
 *   ① 「敌方1艘干扰，我方1艘电子，最终结果是我方射程 **-0.35**，**敌方不变**」
 *   ② 「敌方1艘干扰，我方2艘电子，最终结果是我方射程 **-0.2**，敌方不变」
 *   ③ 「敌方1艘干扰，我方1艘电子，我方有**射程增加60%**效果，最终结果是我方射程 **-0.35+0.6=+0.25**，敌方不变」
 *
 * 由此定死的三条（本段实现即照此）：
 * - **各自先乘法合成**：`r_e = 1 − Π(1 − vᵢ)`（干扰舰每艘 v = 0.5 ⇒ 1 艘 0.5 · 2 艘 0.75）；
 *   `r_p` = 我方电子舰那套（每艘 0.15 ⇒ 1 艘 0.15 · 2 艘 0.2775）；
 * - **净削减 = `r_e − r_p`**（夹 ≥0）：例① 0.50−0.15 = **0.35** · 例② 0.50−0.2775 = **0.2225**
 *   （船长口述 0.2，取整说法）——**"相互抵消"就是这一减**；
 * - **我方倍率 = `1 + 我方射程加成 − 净削减`**（例③：1 + 0.6 − 0.35 = **1.25**）；
 *   ⚠ 加成的**加法口径**由船长明示（不是相乘）⇒ 引擎侧按"加成的乘法结果 ÷ (1+加成) × (1+加成−净)"等价实现
 *   （见 `applyMeJammerDebuff`：`(1+bonus)` 已先乘过，这里再乘 `(1+bonus−净)/(1+bonus)` 得同值）；
 *   🔴 **2026-09-26 修正**：这一步原先**没真做到** —— `applyMeJammerDebuff` 收的是"按 bonus = 0 算出的系数"，
 *   再按每件加成"反解"，而那个反解是**恒等变换** ⇒ 每件武器都被当成**无加成**压（带 +22% 射程的攻坚炮台
 *   8,967 → 4,484，加法口径应为 5,292）。现在**第二参改收净削减率**，逐件按自己的加成反解；
 *   并且**基准账与武器条目逐条一一对齐**（基础舰炮与每架无人机也各入一条账 —— 原先不入账 ⇒ 下标整体错位）。
 *   用例：`ink-tide-20260924.test.ts` 的「逐件加法口径」两条（带加成的舰炮 / 带中继的无人机）。
 * - **敌方射程不受影响**（三例都写「敌方不变」）⇒ 本机制**只压我方**，不动 `foeGunMaxRangeOf` 那条链。
 *
 * ⚠ **落点两处、口径一条**：① `buildMyUnitSpecs`（开战首拍建档 + 每拍重建都走它；单船/多舰两条路径、
 * 逐舰各带自己的基准账在函数里）② 视图 `battleArcsFor`（视图锚舰另建一份规格 ⇒ 不施加就会"画面射程
 * 与实际开火门不一致"）。两处都调 `meJammerNetOf` / `applyMeJammerDebuff`，**不新增第三份射程算法**。
 * 敌阵取**当前波**（`activeFoeSpecsOf`）——多波卡里干扰舰可能只在某一波出场。
 * `meFoeRangeDebuff`（我方电子舰的合成率，运行态、不随档）由 `applyFoeRangeDebuff` 每拍**先**写，
 * `meJammerNetOf` 再拿它跟敌方干扰率相减取净。
 */

/** 本波敌阵里挂 `foeRangeDebuffPct` 的**编制数**（含未入场/已阵亡单位 ⇒ 与 hpShare 口径一致）。 */
export function foeJammerCountOf(foes: readonly UnitSpec[]): number {
  return foes.reduce((n, f) => n + ((f.foeRangeDebuffPct ?? 0) > 0 ? 1 : 0), 0)
}

/**
 * 该敌舰单位**是否已被摧毁**（`battle.units` 里的运行态：建档后**三系血全 ≤ 0** = 阵亡）。
 *
 * ⚠ **没有建档记录**（尚未入场 / 纯函数调用 / 老档补算）⇒ **视为未死**（返回 `false`）——
 * 这样"编制口径"的旧行为一点不变，只有**明确打死的**那几艘才失去作用面。
 */
export function foeUnitDeadOf(b: import('./state').BattleState, tag: string): boolean {
  const u = b.units[tag]
  return u !== undefined && u.hp.s <= 0 && u.hp.a <= 0 && u.hp.h <= 0
}

/** 敌阵的合成削减率 `r_e = 1 − Π(1 − vᵢ)`（无干扰舰 ⇒ 0） */
export function foeRangeDebuffOf(foes: readonly UnitSpec[]): number {
  let remain = 1
  let r = 0
  for (const f of foes) {
    const v = f.foeRangeDebuffPct ?? 0
    if (v > 0 && v < 1) {
      remain *= 1 - v
      r = 1 - remain
    }
  }
  return r
}

/**
 * **干扰的净削减率** = `敌方干扰合成 − 我方电子舰合成`（夹 ≥0）——**"相互抵消"就是这一减**：
 * 我方的电子舰能把自己的电子战能力抵掉敌方的干扰（2 艘抵 27.75 个百分点），抵到 0 以下不再"加射程"。
 * 船长三例：① 0.50−0.15 = **0.35** · ② 0.50−0.2775 = **0.2225**（他口述"−0.2"）。
 *
 * ⚠⚠ **2026-09-25 船长报障**：「**摧毁敌方干扰舰后，射程不会恢复。**」根因 = 上面那个合成函数吃的是
 * **编制口径**（`activeFoeSpecsOf` 含已阵亡单位）⇒ 干扰舰被打死之后它的 50% 仍然挂在净削减里
 * （**界面射程弧与实际开火门两处都挂着**，因为两条路径都从这里取数）。
 * ⇒ 这里**先滤掉已阵亡的干扰舰**（{@link foeUnitDeadOf}；未建档 = 视为未死 ⇒ 零行为变化）。
 */
export function meJammerNetOf(battle: import('./state').BattleState, foes: readonly UnitSpec[]): number {
  const enemy = foeRangeDebuffOf(foes.filter((f) => !foeUnitDeadOf(battle, f.tag)))
  if (enemy <= 0) return 0
  // **净射程削减 = 敌方干扰合成 − 我方电子舰合成**（船长 2026-09-24 三例的口径）：
  // 我方的电子舰能**抵消**敌方的干扰（2 艘抵消 35 个百分点），抵消到 0 以下就不再"加射程"（夹 0）。
  return Math.max(0, enemy - Math.max(0, battle.meFoeRangeDebuff ?? 0))
}

/**
 * **我方武器被干扰后的射程系数**（⚠ 不是"我方倍率"）——由船长三例的**加法口径**反解：
 * 我方倍率 = `1 + bonus − 净削减`（bonus = 我方自己的射程加成，已先乘进武器射程）⇒
 * 施加系数 = `(1 + bonus − 净) / (1 + bonus)`（把已经乘过的 `(1+bonus)` 还原成加法）。
 *
 * ⚠ 不带任何射程加成的武器（bonus = 0）⇒ 系数 = `1 − 净`（船长例①②就是这一支）；
 * 例③（bonus = 0.6）：(1 + 0.6 − 0.35) / 1.6 = **0.78125** ⇒ 最终射程 ×1.6×0.78125 = **×1.25** ✓。
 */
export function meRangeMulOf(
  battle: import('./state').BattleState,
  foes: readonly UnitSpec[],
  /** 该武器的**射程加成倍率 − 1**（0 = 无加成）；缺省 0（= 倒推不出加成，按无加成算） */
  bonus = 0,
): number {
  const net = meJammerNetOf(battle, foes)
  if (net <= 0) return 1
  return meRangeMulForBonus(bonus, net)
}

/**
 * **单件武器的干扰系数** = `(1 + 该件射程加成 − 净削减) ÷ (1 + 该件射程加成)`（下限 0.1）。
 *
 * ⚠ **这就是船长三例的加法口径**（例③：`1 + 0.6 − 0.35 = ×1.25`）——关键在于：
 * 分母里的加成**必须先乘回武器射程**（`createPlayerSpec` 的 `rangeOf` 已乘过），
 * 所以这里只能按**该件自己的加成**反解，**不能**拿"整份规格的系数"（那是按 bonus = 0 算的）逐件套用。
 *
 * 🔴 **2026-09-26 修正的真错**：`applyMeJammerDebuff` 原先收的是**系数**（`1 − 净`，按 bonus = 0 算），
 * 再按每件加成"反解"——那个反解在数学上是**恒等变换**（`net' = bonusMul × (1 − 系数)` 代回去正好还原），
 * 于是每件武器都被当成**无加成**压：带 +22% 射程加成的攻坚炮台（8,967 m）在净 0.50 下被压到 4,484 m，
 * 而加法口径应为 `7,350 × 0.72 =` **5,292 m**（少 15%）。⇒ 现在`applyMeJammerDebuff` 改收**净削减**。
 */
export function meRangeMulForBonus(bonus: number, net: number): number {
  const bonusMul = Math.max(0, 1 + bonus)
  return Math.max(0.1, (bonusMul - net) / bonusMul)
}

/**
 * **把我方武器的射程按干扰净削减率缩小**（只动最远射程；近界不动、下限 2 m）。
 *
 * ⚠ **第二参是「净削减率」，不是「射程系数」**（2026-09-26 改；见 {@link meRangeMulForBonus} 的错因）：
 * 传 `meJammerNetOf(...)`（0.5 = 压掉一半），**不要**传 `meRangeMulOf(...)`（0.5 在那边的含义是 1 − 净，
 * 两者数值相同时语义正好相反 ⇒ 会被当成"压掉 0.5 中的一部分"用错）。
 *
 * 逐件按**该件自己的射程加成**反解（`ranges[i]` = `createPlayerSpec` 记下的
 * `{ 基准射程, 加成倍率 }`，**与 `spec.weapons` 逐条一一对齐**：基础舰炮、炮台/导弹/激光、每架无人机
 * 各一条）。**不传 `ranges`**（老调用点）⇒ 全部按 bonus = 0 处理（= 每件乘 `1 − 净`）。
 */
export function applyMeJammerDebuff<T extends UnitSpec>(
  spec: T,
  net: number,
  ranges?: readonly { baseM: number; bonusMul: number }[],
): T {
  if (!(net > 0) || !Number.isFinite(net)) return spec
  spec.weapons = spec.weapons.map((w, i) => {
    // 该件自己的射程加成（缺账 = 无加成 ⇒ 老行为）
    const bonus = Math.max(0, (ranges?.[i]?.bonusMul ?? 1) - 1)
    const mul = meRangeMulForBonus(bonus, net)
    if (mul >= 1) return w
    return { ...w, maxRangeM: Math.max(2, Math.round(w.maxRangeM * mul)) }
  })
  return spec
}

/** **受击增程**触发器（只由"我方武器**命中敌舰本体**"调用——打机群 / 未命中都不算）。
 *
 *  ⚠ **全敌队一次生效**（船长二次裁定：「每个敌人都会单独触发一次射程增加的文字提示，理论上应该
 *  **只触发一次**，**对所有敌舰生效**」）：命中**任一**带该机制的敌舰 ⇒ 给**整支敌队**盖章
 *  （状态是标量 `battle.foeDroneRangeBuff`），此后所有敌舰的机群都吃倍率；提示**只推一条**。
 *  **一次触发即本场永久**（值即倍率，不存时间戳）。
 *  @returns 是否本次**首次**触发（首次才推画面提示） */
export function markFoeDroneRangeBuff(
  rt: UnitSpec,
  b: import('./state').BattleState,
): boolean {
  const mul = rt.foeDroneRangeMulOnHit
  if (mul === undefined || mul <= 1) return false
  if (!rt.foeDrones || rt.foeDrones.length === 0) return false
  const cur = b.foeDroneRangeBuff
  if (cur !== undefined && cur >= mul) return false // 已触发过（整队共享）⇒ 不重复盖章、不重复提示
  b.foeDroneRangeBuff = mul
  return true
}

/* ═══════════ 敌方炮台受击增程（2026-09-12 船长：给 D 族静滞卫舰"挨打后射程增加 50%"）═══════════
 * 与上面机群那条**同款触发、不同作用面**：
 * - **触发**：任一"带 `foeGunRangeMulOnHit` 的敌舰"**被命中一次** ⇒ 在 `BattleState.foeGunRangeBuff`
 *   上盖章一次（打机群不算、未命中不算；**本场永久**、**只推一条**画面提示）；
 * - **生效面**：**只有带该字段的敌舰**（= 所有静滞卫舰）；同场的其它舰级（守墓长舰等）**不受影响**
 *   —— 船长原话「**仅影响所有静滞卫舰**」。⚠ 与 E 族那条（"**整支敌队的机群** ×4"）是**两套独立状态**，
 *   互不覆盖；
 * - **口径（船长选「乙」）**：只延长**最远射程**、近界不动；**原射程内的命中/伤害折减一字不变**，
 *   延长段按**同斜率**继续线性衰减（12 km 处仍 ×0.5，18 km 处 ≈ ×0.20，而非趴在 falloff 平台上）。
 * ⚠ **射程与折减都只有这一处算法**：开火射程门、命中/伤害衰减、战斗界面底部射程标签三处共用
 *   （教训来自 2026-09-12「无人机射程变更后标签没跟着变」那次实测反馈）。 */

/** 该敌舰当前的**炮台增程倍率**（未带字段 / 未触发 = 1） */
export function foeGunRangeMulOf(
  b: import('./state').BattleState,
  unit: { foeGunRangeMulOnHit?: number },
): number {
  const mul = unit.foeGunRangeMulOnHit
  if (mul === undefined || mul <= 1) return 1
  const buff = b.foeGunRangeBuff
  return buff !== undefined && buff > 1 ? buff : 1
}

/** 该敌舰武器的**有效最远射程**（开火门与界面标签共用；未触发 = 原值）。
 *  ⚠ **2026-09-18 起并入我方电子舰的削减**（船长：「削减敌人15%的武器射程…射程最短只能削弱到3000m」）：
 *  净倍率 = **增程倍率 − 削减率**（做加法，见 `foeRangeDebuffOf`）；**基础 <3000m 不削**、削后**下限 3000m**。 */
export function foeGunMaxRangeOf(
  b: import('./state').BattleState,
  unit: Pick<UnitSpec, 'foeGunRangeMulOnHit' | 'foeFocusArray'>,
  w: { maxRangeM: number },
): number {
  const bonus = coronaFocusBonusOf(b, unit.foeFocusArray, 'rangeBonusPct')
  return effectiveFoeRangeM(b, w.maxRangeM, foeGunRangeMulOf(b, unit) + bonus)
}

/** 聚焦按当前有效射程计算衰减；既有受击增程仍沿原斜率外推。 */
export function foeGunPowerFactorOf(
  b: import('./state').BattleState,
  unit: Pick<UnitSpec, 'foeGunRangeMulOnHit' | 'foeFocusArray'>,
  w: { minRangeM: number; maxRangeM: number; falloff: number },
  dist: number,
): number {
  if (unit.foeFocusArray !== undefined) {
    return distFactor(dist, { ...w, maxRangeM: foeGunMaxRangeOf(b, unit, w) })
  }
  const base = distFactor(dist, w) // 原区间内 = 原读数（一字不变）
  if (foeGunRangeMulOf(b, unit) <= 1 || dist <= w.maxRangeM) return base
  const span = Math.max(1, w.maxRangeM - w.minRangeM)
  const slope = (1 - w.falloff) / span
  return Math.max(0, base - slope * (dist - w.maxRangeM))
}

/** **炮台受击增程**触发器（只由"我方武器**命中敌舰本体**"调用——打机群 / 未命中都不算）。
 *
 * ⚠ **2026-09-16 船长加距离门**：「**将射程增加效果改为，如果敌人在射程外攻击时才触发**」
 * ⇒ 除了"命中本体"，还要求**这一发来自它当前全部炮台射程之外**（`b.distanceM > max(自身各炮台远界)`）。
 * 语义：这条机制本意是惩罚"在它够不着的距离外放风筝"，近身对轰**不该**解锁增程。
 * 洞内洞外同一处生效（船长同日裁「只改 D 炮台增程」⇒ E 族机群那条 ×4 **保持原样**）。
 *  @returns 是否本次**首次**触发（首次才推画面提示） */
export function markFoeGunRangeBuff(rt: UnitSpec, b: import('./state').BattleState): boolean {
  const mul = rt.foeGunRangeMulOnHit
  if (mul === undefined || mul <= 1) return false
  const reach = rt.weapons.reduce((m, w) => Math.max(m, foeGunMaxRangeOf(b, rt, w)), 0)
  if (!(b.distanceM > reach)) return false // 近身命中不解锁（船长 2026-09-16）
  const cur = b.foeGunRangeBuff
  if (cur !== undefined && cur >= mul) return false // 该型舰共享 ⇒ 不重复盖章、不重复提示
  b.foeGunRangeBuff = mul
  return true
}
