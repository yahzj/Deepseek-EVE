/** 功能域职责拆分，保持原计算与顺序。 */
import type { ModuleDef, DamageResists, SimContext, FittedModules, DamageType, ModuleSlot } from '../../types'
import { plugStackingKindOf } from '../../plugEffects'
import type { GameState } from '../../state'
import { fleetDefOf } from '../../instances'
import { allFittedModules } from '../../fitted'
import { moduleAllowedOnShip } from '../../shipFitting'
import { stackWeight } from '../../stacking'
import { allFittedIds, MODULE_SLOTS } from '../../labels'

/** 收敛分组：gap = 缺口复合（抗性/闪避）· curve = EVE 曲线（命中/跃迁速度/目标锁定）· **weighted = 折权加算**（**速度**（2026-09-20 起）与无人机射程中继天线）· **max = 取最强一件**（多件不叠加，2026-09-15 起用于隐秘行动装置的隐身窗口）· **fleetDecay = 全队折权缺口乘法**（**2026-09-29 船长令**：全队型削减类效果——所有来源拉平进一个池、按 EVE 曲线逐件递减、再乘法合成；现用于墨潮电子舱的射程压制）· flat = 加算线性（不收敛） */
export type StackGroup = 'gap' | 'curve' | 'weighted' | 'max' | 'fleetDecay' | 'flat'

/**
 * 一件装备的收敛分组与收敛键（同键 = 同一收敛池，按单件效果从强到弱参与合成）。
 * - 抗性（盾/甲各系）与闪避 → gap（缺口复合 1−Π(1−x)，天然收敛）；
 * - 命中/跃迁速度/目标锁定 → curve（EVE 曲线 Π(1+pᵢ·wᵢ)）；
 * - **速度（推进器族）→ weighted（折权加算 Σpᵢ·wᵢ，2026-09-20 船长「基础改为加算，但是依旧有多件衰减」）**；
 * - **全队型削减类效果（墨潮电子舱）→ fleetDecay（折权缺口乘法，2026-09-29 船长「这类全队型的效果……
 *   做全队多装递减，并且效果也是乘法」）——**旧口径 `sum`（同舰加和上限 90% ＋ 跨舰乘法）已作废**；
 * - 指定伤害/射速支援件及属性插件 → weighted；伤害与射程的实际权重按各效果池计算。
 * - 容量%/矿枪/货舱/导控/炮台实体 → flat（加算线性，不额外收敛）。
 * UI 用 group 出"多装递减 / 可多装·全额叠加"标签；装配数件数用 kind 提示第 N 件。
 *
 * ⚠ **`kind` 是"衰减池键"**（同键同池、跨型号合并）——**2026-09-21 船长令**起它与
 * **回转冷却的拆分粒度**是两件事，见 {@link pulseStreamOf}：三类周期脉冲装置按**全族**衰减、
 * 却按**型号**各走各的冷却。
 */
export function stackingOf(def: ModuleDef): { group: StackGroup; kind: string } {
  if (def.slot === 'plug') {
    const kind = plugStackingKindOf(def)
    return { group: kind === null ? 'flat' : 'weighted', kind: kind ?? 'plug' }
  }
  if (def.slot === 'support') {
    if (def.reloadCutPct !== undefined && def.speedBonusPct === undefined) return { group: 'weighted', kind: 'reload' }
    if (Object.keys(def.damageTypeBonusPct ?? {}).length) return { group: 'weighted', kind: 'support-damage' }
  }
  if (def.crisisOverload) return { group: 'curve', kind: 'crisis-overload' }
  if (def.droneLaunchCutPct !== undefined) return { group: 'fleetDecay', kind: 'drone-launch' }
  if (def.laserFalloffBonus !== undefined) return { group: 'weighted', kind: 'laser-calibration' }
  const resistKey = (add: DamageResists | undefined): string | null => {
    for (const [t, v] of Object.entries(add ?? {})) if ((v ?? 0) > 0) return t
    return null
  }
  if (def.evasionGapPct !== undefined) return { group: 'gap', kind: 'evasion' }
  /**
   * **对方对机群的命中收窄**（`droneHitGapPct`，**2026-09-29 船长令**：巨构导控塔）——
   * 归 **`gap`**（缺口复合那把尺）而不是 `flat` 兜底：效果本质是"缺口收窄"，
   * 掉进 `flat` 会被界面标成「全额叠加」（读起来像"可以无限叠"），与语义不符。
   *
   * ⚠ **kind 与 `evasion` 分开**：一个是"本舰更难被打中"（闪避侧），一个是"对方机群更难被本舰打中"
   * （打机群那一支的命中侧），两者作用对象不同、不该并进同一个收敛池计数。
   */
  if (def.droneHitGapPct !== undefined) return { group: 'gap', kind: 'drone-hit' }
  if (def.hitBonusPct !== undefined) return { group: 'curve', kind: 'hit' }
  /**
   * **推进器（`speedBonusPct`）= 折权加算**（**2026-09-20 船长**：「**基础改为加算，但是依旧有多件衰减**」）。
   *
   * 由来：原与"命中/跃迁速度/目标锁定"同走 `curve`（`Π(1+pᵢ·wᵢ)`）——那条曲线对**小额件**是递减，
   * 对**大额件反而放大**（`equipment.ts` 自己早写明这条）：2× 微型跃迁引擎 MK3（+250%）合计 **×11.10**，
   * 比"全额加算"的 ×6.00 还高一截，3 件到 ×26.9 ⇒ 中槽够的船塞两三件 MWD 就能把爆发期速度拉到几十倍。
   * 现改为**单体加成按权重折减后仍相加**（`weightedSum`）⇒ **件件递减、总额随件数上升但收敛**：
   * 同例 2× MWD MK3 = **+467%**（×5.67）、3 件 = **+610%**（×7.10）。
   * ⚠ **只动速度这一支**：命中 / 跃迁速度 / 目标锁定**仍是 EVE 曲线**（未被本裁定涉及）。
   * 收敛池不变 = 全部带 `speedBonusPct` 的已装件（任意槽位，按加成从强到弱排位）。
   * UI 侧不受影响：`weighted` 与 `curve` 的文案本来同一档（「多装递减」＋"第 N 件按权重 %"）。
   */
  if (def.speedBonusPct !== undefined) return { group: 'weighted', kind: 'speed' }
  // 跃迁计算机（`warpSpeedBonusPct`，2026-09-14 船长新增 MK2 +20% / MK3 +35%）：**EVE 曲线**
  // （与"命中/速度"同一条）⇒ 多装递减：MK2 1/2/3/4 件 = ×1.20 / ×1.41 / ×1.57 / ×1.66。
  // 收敛池 = 同 kind（MK2 与 MK3 混装时按单件效果从强到弱排位）。
  if (def.warpSpeedBonusPct !== undefined) return { group: 'curve', kind: 'warp' }
  if (def.lockDmgBonus !== undefined) return { group: 'curve', kind: 'lock' }
  if (def.blink !== undefined) return { group: 'max', kind: 'blink' }
  /**
   * **隐秘行动装置（`stealthMs`，2026-09-15 船长）**：隐身窗口 = **多件取最长那一件**（不叠加）——
   * 两档 20/30 秒，装两件也只有最长的那一段。UI 据此标「取最长（不叠加）」，
   * 既不写"多装递减"（那是收敛件的口径），也不写"全额叠加"（那是加算件的口径）。
   */
  if (def.stealthMs !== undefined) return { group: 'max', kind: 'stealth' }
  // 无人机中继天线（`droneRangeBonusPct`）：**折权加算**（2026-09-14 船长「对无人机的射程插件添加叠加
  // 惩罚」→「按推荐折算」）——第 2 件起按 `stackWeight` 的 87% / 57% / 28%… 折权后**仍相加**，
  // 不再"全额线性叠加"；收敛池 = 同 `kind`（制式 MK1/2/3 与 G 族「流亡中继桅」同槽同池）。
  if (def.droneRangeBonusPct !== undefined) return { group: 'weighted', kind: 'drone-relay' }
  // 无人机护盾投射仪（2026-09-27 船长令）：护盾层加成 = **加算线性**（多件不衰减；与耐久学/强化学乘算）
  if (def.droneShieldHpBonusPct !== undefined) return { group: 'flat', kind: 'drone-shield' }
  const sk = resistKey(def.shieldResistAdd)
  if (sk) return { group: 'gap', kind: `shield-${sk}` }
  const ak = resistKey(def.armorResistAdd)
  if (ak) return { group: 'gap', kind: `armor-${ak}` }
  // 结构层抗性（2026-09-11 修）：引擎侧同样走缺口复合（`combat.ts applyAdds`：1−(1−cur)(1−add)、上限 0.9），
  // 但此前不在本函数判定里 ⇒ 生体损管腔（唯一的 hullResistAdd 件）被标成 **flat**，
  // 面板与列表短行都写「全额叠加」，与实际的"多装递减"不符。
  const hk = resistKey(def.hullResistAdd)
  if (hk) return { group: 'gap', kind: `hull-${hk}` }
  /**
   * **两件「按周期脉冲」的装置（`shieldPulsePct` 中槽充能 / `shieldFieldPct` 高槽力场）**
   * = **折权加算**（第 2 件起按 `stackWeight` 的 87% / 57% / 28%… 折权后仍相加）。
   *
   * ⚠ **2026-09-21 补登 + 改口径（船长：「护盾充能立场不是多件衰减吗」）**：
   * - **补登**：这两件原先**掉在 `flat` 兜底里** ⇒ 装配页/说明短行把"同型多件"标成**「全额叠加」**，
   *   而引擎（`combat.shieldPulsePctOf` / `combat.shieldFieldOf`）**一直在按 EVE 曲线折减** —— 面板与
   *   实际不符；这也是船长那问的第一个来源。
   * - **改口径**：收敛池由**按件 id 计数**改为**按本键（同族=同池）计数** ⇒ **MK2 与 MK3 混装也算叠加**
   *   （此前 `2×MK2 + MK3` 会出 28.69%：MK2 那一对按曲线折、MK3 那件**全额**加进去 —— 混装反而成了
   *   不吃惩罚的最优解）。船长 2026-09-21 裁定「**同族合并计数：MK2+MK3 也衰减**」。
   *   与「跃迁计算机 MK2/MK3 同池」（上面 `warp` 那条）同一口径。
   * - **多艘船各带一件仍各自独立、可叠加**（船长 2026-09-20 原裁定，未变）——收敛池只看**同一艘船**的装配。
   * - ⚠ **衰减池仍按全族**（**2026-09-21 第二轮船长令**：「**哪怕同类型装备，只要是不同型号，就要独立的
   *   回转冷却**」——那条讲的是**冷却逐型号独立**，**不动衰减池**：换型号不能绕开衰减）。两者已拆成
   *   两个函数：本函数出**衰减池键**，{@link pulseStreamOf} 出**冷却流**。
   */
  if (def.shieldFieldPct !== undefined) return { group: 'weighted', kind: 'shield-field' }
  if (def.shieldPulsePct !== undefined) return { group: 'weighted', kind: 'shield-charge' }
  /**
   * **船体维修装置 / 生体自愈件**（`repairArmorHp` / `repairHullHp`）= **折权加算**，与上两件同一把尺。
   *
   * ⚠ **2026-09-21 补登**（船长第二轮把维修装置一并点名）：「**包括船体维修装置的不同型号也一样的规则**」。
   * 原先是**每个型号各自拿满权**（`combat.preloadRepairFor` 按件 id 计数）——而维修装置的情况恰恰相反：
   * 民用级 / MK1 / MK2 / 生体甲壳板 / 生体损管腔**五个型号彼此无关**，装三台就是三份满额修甲。
   * 现归本键 ⇒ **同舰多台维修装置按全族第 n 台折减**（第 2 台 87%、第 3 台 57%…）。
   * ⚠ 这是**难度改动**（维修总量下调），船长 2026-09-21 已知情并选定。
   */
  if (def.repairArmorHp !== undefined || def.repairHullHp !== undefined) {
    return { group: 'weighted', kind: 'repair' }
  }
  /**
   * **墨潮电子舱**（`foeRangeDebuffPct`）：**同舰多件递减乘法 ＋ 舰间乘法 ＋ 整队封顶 60%**（`fleetDecay`）——
   * **每艘船一个池**（该舰船体自带那份 ＋ 该舰每件电子舱各一份，按 EVE 曲线逐件递减后相乘），
   * **舰与舰之间也相乘**，最后压 **整队总上限 60%**（`WEIGHTED_GAP_FLEET_CAP`）。
   *
   * ⚠ **2026-09-29 船长三问改判**（原话）：「**墨潮电子舱玩家似乎将效果叠的很高，让所有敌人只剩下3000射程**」
   * →「**这类全队型的效果，能否做全队多装递减，并且效果也是乘法**」→「**墨潮电子舱就照全队递减的乘法**」
   * →（看完"能叠多少"的三案读数后）「**丙**」。
   * **作废的两条旧口径**：① 2026-09-26 立的「同舰加和、上限 90%」；② 同日先落的「整队拉平成一个池」
   * （那条渐近只有 36.7%）。**丙**允许叠到 **60%**：4 舰各 3 件 79.1% → 封顶 60% ⇒ 12,000 m 的敌人
   * 最多压到 **4,800 m**（永不见底）；单舰 3 件 = 32.4%，"每舰多装"与"多带舰"都仍有感。
   *
   * **仍生效的两条**：与敌方增程**做加法**（净倍率 = 增程倍率 − r）· **地板 3,000 m**
   * （`combat.FOE_RANGE_DEBUFF_FLOOR_M`：基础 < 3,000 m 不削，削后下限 3,000 m）。
   */
  if (def.foeRangeDebuffPct !== undefined) return { group: 'fleetDecay', kind: 'ecm' }
  /**
   * **墨潮捕获网**（`captureWebCycleMs`，**2026-09-26 船长令**）：同舰多件**取最短周期**（更快的那台
   * 说了算，见 `combat.createPlayerSpec`）⇒ 归 `max` 组（该组的 UI 语义 = 不叠加、只取一件）。
   */
  if (def.captureWebCycleMs !== undefined) return { group: 'max', kind: 'capture-web' }
  return { group: 'flat', kind: def.slot }
}

/**
 * **三类「按周期脉冲」装置的冷却流**（`pulseStreamOf`）——**逐型号一路计时器**。
 *
 * **船长令（2026-09-21，原话）**：「**漏了一点，哪怕同类型装备，只要是不同型号，就要独立的回转冷却**」
 * ＋「**包括船体维修装置的不同型号也一样的规则**」⇒ 力场（高槽）/ 护盾充能（中槽）/ 船体维修（中槽）
 * 三类一律**按型号拆成多路**：各带自己的 `nextPulseAtMs`，各按各的间隔跳、各修各的量。
 *
 * 改前是"一台一路"：同舰 MK2+MK3 **共用**一个计时器，间隔取最短的一档（力场 8 秒），
 * 比例是两件的合计值 —— 于是**两件装置变成一路脉冲**（MK3 的快节奏把 MK2 也带快了、
 * 而 MK2 的量被并进同一路里）。维修装置更极端：**一路 5 秒脉冲只结算一台装置**（`pulseRepairsFor`
 * 的循环在第一个"跳得动"的装置上就消耗掉这一跳），装三台与装一台的实际修理量几乎一样。
 *
 * ⚠ **与衰减池是两件事**：衰减按**全族**（{@link stackingOf} 的 `kind`），冷却按**型号**（本函数）。
 * 所以"MK2 一件 + MK3 一件"= **两路**各 10% 起跳、比例各自按全族第 n 件折减。
 * `def.id` 就是型号（`mod-shieldfield-2` / `mod-hullrep-1` / `mod-lair-dc-c` …），
 * 这也是唯一的现成粒度、无需新增数据字段。
 */
export function pulseStreamOf(def: ModuleDef): { kind: string; modelId: string } | null {
  if (def.shieldFieldPct !== undefined) return { kind: 'shield-field', modelId: def.id }
  if (def.shieldPulsePct !== undefined) return { kind: 'shield-charge', modelId: def.id }
  if (def.repairArmorHp !== undefined || def.repairHullHp !== undefined) return { kind: 'repair', modelId: def.id }
  return null
}

/** 按正向收益排位；负面沿用同件权重，缺口族按先前装备剩余缺口折减。 */
export function fittedPenaltyPartsOf(state: GameState, ctx: SimContext, shipId: string, fittedOverride?: FittedModules) {
  const hull = fleetDefOf(state, ctx, shipId)
  const fitted = fittedOverride ?? state.fleet[shipId]?.fitted
  const defs = fitted ? allFittedModules(fitted, ctx).filter(d => moduleAllowedOnShip(hull, d)) : []
  const pools = new Map<string, Array<{ mod: ModuleDef; index: number; ordinal: number; value: number }>>()
  const strength = (d: ModuleDef, kind: string): number => {
    if (kind === 'evasion') return d.evasionGapPct ?? 0
    if (kind === 'hit') return d.hitBonusPct ?? 0
    if (kind === 'speed') return d.speedBonusPct ?? 0
    if (kind === 'warp') return d.warpSpeedBonusPct ?? 0
    if (kind === 'lock') return d.lockDmgBonus ?? 0
    if (kind === 'drone-relay') return d.droneRangeBonusPct ?? 0
    if (kind === 'drone-launch') return d.droneLaunchCutPct ?? 0
    if (kind === 'crisis-overload') return d.crisisOverload?.damageBonusPct ?? 0
    if (kind === 'laser-calibration') return d.laserFalloffBonus ?? 0
    if (kind === 'drone-hit') return d.droneHitGapPct ?? 0
    if (kind === 'ecm') return d.foeRangeDebuffPct ?? 0
    if (kind === 'shield-field') return d.shieldFieldPct ?? 0
    if (kind === 'shield-charge') return d.shieldPulsePct ?? 0
    if (kind === 'repair') return (d.repairArmorHp ?? 0) + (d.repairHullHp ?? 0)
    if (kind === 'reload') return d.reloadCutPct ?? 0
    for (const [prefix, values] of [['shield-', d.shieldResistAdd], ['armor-', d.armorResistAdd], ['hull-', d.hullResistAdd]] as const) {
      if (kind.startsWith(prefix)) return values?.[kind.slice(prefix.length) as DamageType] ?? 0
    }
    return 0
  }
  const out = defs.map((mod, index) => {
    const st = stackingOf(mod)
    const pool = pools.get(st.kind) ?? []
    const part = { mod, index, ordinal: pool.length + 1, value: strength(mod, st.kind), weight: 1 }
    pool.push(part)
    pools.set(st.kind, pool)
    return part
  })
  for (const pool of pools.values()) {
    const sorted = [...pool].sort((a, b) => b.value - a.value || a.index - b.index)
    let remain = 1, rank = 0
    for (const part of sorted) {
      const group = stackingOf(part.mod).group
      if (part.value <= 0 || group === 'flat' || group === 'max') continue
      out[part.index]!.weight = group === 'gap' ? remain : stackWeight(++rank)
      if (group === 'gap') remain *= 1 - Math.min(.9, Math.max(0, part.value))
    }
  }
  return out
}

/** 装填增加与百分比降低逐件相乘；抗性按有效百分点相减。 */
export function equipmentPenaltiesOf(state: GameState, ctx: SimContext, shipId: string, fittedOverride?: FittedModules) {
  const result = { reload: 1, speed: 1, range: 1, hit: 1, resist: 0 }
  for (const { mod, weight } of fittedPenaltyPartsOf(state, ctx, shipId, fittedOverride)) {
    result.reload *= 1 + Math.max(0, mod.reloadPenaltyPct ?? 0) * weight
    result.speed *= 1 - Math.min(.9, Math.max(0, mod.speedPenaltyPct ?? 0)) * weight
    result.range *= 1 - Math.min(.9, Math.max(0, mod.rangeCutPct ?? 0)) * weight
    result.hit *= 1 - Math.min(.9, Math.max(0, mod.hitPenalty ?? 0)) * weight
    result.resist += Math.max(0, mod.allResistPenaltyPct ?? 0) * weight
  }
  return result
}

/** 周期仅在各自取数入口乘一次，已走计时不重置。 */
export function equipmentCycleMsOf(state: GameState, ctx: SimContext, shipId: string, baseMs: number): number {
  return Math.max(1, Math.round(baseMs * equipmentPenaltiesOf(state, ctx, shipId).reload))
}

/**
 * EVE 曲线多件合成系数：单件加成按"从强到弱"排位后
 * 总系数 = Π(1 + pᵢ × wᵢ)（EVE stacking penalty 标准形）。
 */
export function curveMult(bonuses: number[]): number {
  const sorted = [...bonuses].filter((p) => p > 0).sort((a, b) => b - a)
  let mult = 1
  for (let i = 0; i < sorted.length; i++) mult *= 1 + sorted[i]! * stackWeight(i + 1)
  return mult
}

/**
 * **折权加算多件合成**（加算族的多装惩罚 · 2026-09-14 船长「对无人机的射程插件添加叠加惩罚」→「按推荐折算」）：
 * 总加成 = **Σ pᵢ × wᵢ**（p 从强到弱排位，w = `stackWeight(n)` ⇒ 100% / 87% / 57% / 28% / 11%…）。
 *
 * ⚠ **与 `curveMult` 别混用**：那个是**乘积**形 `Π(1+pᵢ·wᵢ)`，对大额件反而**放大**
 * （2×+80% 时 +205% ＞ 全额叠加的 +160%），只适合"命中/速度"这类**乘区**；
 * 本形是**折权后仍相加** ⇒ 件件递减、总额仍随件数上升（无人机射程中继天线族用它）。
 */
export function weightedSum(bonuses: number[]): number {
  const sorted = [...bonuses].filter((p) => p > 0).sort((a, b) => b - a)
  let sum = 0
  for (let i = 0; i < sorted.length; i++) sum += sorted[i]! * stackWeight(i + 1)
  return sum
}

/** 激光校准只改远端保留系数，不改射程、命中或近端单发。 */
export function laserFalloffOf(base: number, modules: readonly ModuleDef[]): number {
  return Math.min(1, Math.max(0, base + weightedSum(modules.map(m => m.laserFalloffBonus ?? 0))))
}

/**
 * 缺口复合：1 − (1−base) × Π(1−xᵢ)。
 * base = 既有缺口值（如船体基础回避 0.13 / 船体基础抗 0.5），x = 各件缺口削减。
 * 两件 20% 闪避件且无基础 → 1−0.8² = 0.36（船长示例）。
 */
export function gapCombine(gaps: number[], base = 0): number {
  const cut = (x: number): number => Math.min(0.9, Math.max(0, x))
  let remain = 1 - cut(base)
  for (const x of gaps) remain *= 1 - cut(x)
  return 1 - remain
}

/**
 * **折权缺口乘法**（**全队型削减类效果的统一口径** · **2026-09-29 船长令**）：
 * 总削减 = `1 − Π(1 − pᵢ × wᵢ)`（p 从强到弱排位，`w = stackWeight(n)` ⇒ 100% / 87% / 57% / 28% / 11%…）。
 *
 * 船长原话（照抄）：「**这类全队型的效果，能否做全队多装递减，并且效果也是乘法**」→
 * 「**墨潮电子舱就照全队递减的乘法**」→（追问"能叠多少"并看完读数后）「**丙**」
 * ⇒ 本函数是那把尺的**单点**（与 `curveMult` / `weightedSum` / `gapCombine` 并列的第四种合成形）：
 * - **与 `gapCombine` 的区别**：那条不折权（件件满额、只靠乘法自然收敛），本条**逐件按曲线递减**
 *   ⇒ 收敛得更狠、且有**渐近上限**（单件 15% 时 ≈ 36.7%，再多件也不涨）；
 * - **与 `weightedSum` 的区别**：那条折权后**仍相加**（适合"加成"），本条是**缺口/削减**语义，故走乘法。
 *
 * ⚠ **池子的边界由调用方决定**（本函数只管"一个池"）：墨潮电子舱那套（丙案）是
 * **每艘船一个池**（同舰递减）＋ **舰与舰相乘** ＋ {@link WEIGHTED_GAP_FLEET_CAP 整队总上限}。
 */
export function weightedGap(bonuses: number[]): number {
  const sorted = [...bonuses].map((p) => Math.min(0.9, Math.max(0, p))).filter((p) => p > 0).sort((a, b) => b - a)
  let remain = 1
  for (let i = 0; i < sorted.length; i++) remain *= 1 - sorted[i]! * stackWeight(i + 1)
  return 1 - remain
}

/**
 * **全队型削减类效果的整队总上限 = 60%**（**2026-09-29 船长裁定「丙」**）：
 * 「同舰多件递减乘法 ＋ 不同舰船之间也乘法」单靠这两条能叠到 **83.8%**
 * （4 舰各 6 件）⇒ 12,000 m 的敌人又被压到地板 3,000 m（玩家报障复现）⇒ 再加一道整队封顶。
 *
 * 读数（单件 15%）：2 舰×3 件 54.3%（未封顶）· **3 舰×3 件 69.1% → 封顶 60%** ·
 * **4 舰×3 件 79.1% → 封顶 60%** · **4 舰×6 件 83.8% → 封顶 60%**
 * ⇒ 12,000 m 的敌人最多被压到 **4,800 m**（8,000 → 3,200），**永不见底**。
 */
export const WEIGHTED_GAP_FLEET_CAP = 0.6

/** 候选装配前，同收敛键已装件数；包含同型号，候选本身尚未计入。 */
export function sameKindCount(fitted: FittedModules, ctx: SimContext, def: ModuleDef): number {
  const kind = stackingOf(def).kind
  let n = 0
  for (const id of allFittedIds(fitted)) {
    const d = ctx.modules.get(id)
    if (d && stackingOf(d).kind === kind) n++
  }
  return n
}

/** 指定船（缺省当前驾驶船）的家族加成：按家族求和（复数矿枪/货舱扩展线性叠加；
 * 战斗槽加成由各自字段直接进 combat.createPlayerSpec——本表对它们恒为 0） */
export function fittedBonuses(
  state: GameState,
  ctx: SimContext,
  shipId: string = state.shipId,
): Record<ModuleSlot, number> {
  const result = {} as Record<ModuleSlot, number>
  for (const slot of MODULE_SLOTS) result[slot] = 0
  const fitted = state.fleet[shipId]?.fitted
  if (!fitted) return result
  for (const def of allFittedModules(fitted, ctx)) {
    if (def.bonus !== undefined && def.slot !== 'turret') result[def.slot] += def.bonus ?? 0
  }
  return result
}
