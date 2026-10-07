/**
 * **敌群建档与增援**（2026-10-02 从 `combat.ts` 拆出 · 批次 4l · 零行为变化）。
 *
 * 本文件 = 敌方编队的**定价反解与建档**：卡面战力实测/威胁反解、舰级路径建档（`ships`）、
 * 旧威胁推导路径、增援/支援/复活判定与波次补入、距离与期望机动——只依赖 state 类型 / types /
 * rng / labels / instances / inventory / equipment / tuning / foeCard / foePower / wormholeFoes /
 * foeRange / combatMath / combatFx。`combat.ts` 原样再导出（先例：fitted.ts），既有引用零改动。
 */

/* 以下为 2026-10-02 批次 4l 从 combat.ts 切接过来的整簇（敌方编队头注 ~ seedUnit）。 */
import type { GameState } from './state'
import { addLog } from './state'
import type {
  AnomalyDef,
  BattleBalance,
  DamageType,
  FoeReinforceTrigger,
  FoeShipDef,
  FoeShipSlot,
  FoeSupportBranch,
  SimContext,
} from './types'
import type { UnitSpec, WeaponSpec } from './combat'
import { clamp, isAlive } from './combatMath'
import type { Hp3 } from './combatMath'
import { nextInt } from './rng'
import { resolveFoeMounts } from './foeMounts'
import { baseFoeTag, enumerateShipUnits, FOE_SUPPORT_TAG_RE, foeUnitNameOf, shipWaveIndexOf } from './foeCard'
import { foeHpOfThreat, foeJudgedThreatOf, foeMultiShipCompMul, foeRefSpeedMps, foeSpeedBase, foeThreatRatingOf, TACTIC_RANGE } from './foePower'
import { compositionOfMix, foeDamageComposition, pickTopType, PROFILE_SPLIT, WORMHOLE_THREAT_BASE } from './wormholeFoes'
import { foeDroneRangeOf, foeGunMaxRangeOf, foeRangeWithDebuff } from './foeRange'
import { BATTLE_ARRIVAL_FLY_MS, BATTLE_ARRIVAL_STAGGER_MS, pushBattleNotice, WORMHOLE_FOE_VOLLEY_STAGGER_MS } from './combatFx'
import { splitShotByComposition } from './wormholeFoes'

/* ═══════════ 敌方编队 ═══════════ */

/**
 * **敌卡战力实测**（定价式的左半边 · 2026-09-25）：`X = √(全波总血 × 峰值波火力DPS)`。
 *
 * 与 `steadyPreview` / 重定价批**逐字同源**：逐波建档（第 i 波前缀 `w${i}-`，第 0 波无前缀）、
 * 血 = 各波三层血之和、火力 = **各波取最大**（多波不同时在场，峰值波才是承伤口径）、
 * 单发含多舰补偿与逐条取整、火力**含机群**（`src:'drone'`）。
 *
 * 用途：给"派生过 / 缩放过的卡"重新定价 —— 例：入侵遇袭把敌卡强度 ×0.75 之后，标签必须按**本函数实测**反解，
 * 否则写出来的就是假标签（`foeHpOfThreat` 非线性 ⇒ "威胁减半" ≠ "强度减半"）。
 */
export function foeStrengthOf(anomaly: AnomalyDef, bal: BattleBalance): { hp: number; dps: number; x: number } {
  const idxs = new Set<number>()
  for (const s of anomaly.ships ?? []) idxs.add(Math.max(0, Math.floor(s.wave ?? 0)))
  if (idxs.size === 0) idxs.add(0)
  let hp = 0
  let peak = 0
  for (const i of idxs) {
    const specs = createFoeSpecs(anomaly, bal, { tagPrefix: i === 0 ? '' : `w${i}-` })
    let whp = 0
    let wdps = 0
    for (const f of specs) {
      whp += f.hp.s + f.hp.a + f.hp.h
      for (const w of f.weapons) wdps += ((w.shotDmg ?? 0) * (w.count ?? 1) * 1000) / Math.max(1, w.reloadMs)
    }
    hp += whp
    peak = Math.max(peak, wdps)
  }
  return { hp, dps: peak, x: Math.sqrt(hp * peak) }
}

/** 由**卡面属性**反解威胁（= `foeStrengthOf` ＋ `foeThreatRatingOf`）——派生卡 / 缩放卡定价的唯一入口 */
export function foeThreatOfAnomaly(anomaly: AnomalyDef, designMul: number, bal: BattleBalance): number {
  return foeThreatRatingOf(foeStrengthOf(anomaly, bal).x, designMul, bal)
}

/** 展开敌方编队（threat 卡面 = 总战力；血/火力威胁线性，射程/速度走虚拟装配模板） */
/** createFoeSpecs 波次参数（2026-09-09 多波；缺省 = 单波现状） */
export interface FoeSpecOpts {
  /** 本波"主舰+僚机"小队数（escorts 随卡不变） */
  units?: number
  /** 本波分得的敌总血比例（0~1；缺省 1 = 全量） */
  hpShare?: number
  /** tag 前缀（第 2 波起用，避免与首波/旧档 tag 冲突；首波 = '' 保持 foe-0/foe-1 旧命名） */
  tagPrefix?: string
}

/**
 * **舰级路径建档**：单位属性 = 舰级绝对值 × 本条倍率。
 * - 血：`ship.hp × hpMul`（**不吃威胁份额、不吃 hpShare**）；三层比例 = **有效 split = 条目覆写 ?? 舰级**
 *   （2026-09-11 船长裁决①「头目血型随卡片走」）
 * - 单发：`round(ship.shotDmg × dmgMul × 多舰船补偿)`；
 *   **多舰船补偿 `2N/(N+1)`**（2026-09-11 船长确认）在建档时按"本卡编成单位总数 N"缩放单发，
 *   见 `foeMultiShipCompMul`；卡上 `dmgMul` 写的是**设计单发 ÷（舰级单发 × 补偿）**，
 *   故引擎实建档值即船长确认的设计单发。
 *   速度（2026-09-11 追加裁决「劫掠护卫舰和劫掠狙击舰下落一档，只有头目是巡洋舰」）：
 *   `round(HULL_CLASS_BASE_SPEED[舰种档] × speedRatio × speedMul)` ——
 *   **舰种基准 × 倍率**（基准 = `bal.hullClassBaseSpeedMps`，倍率 = `ship.speedRatio` 与条目 `speedMul`）。
 * - 射程带：两端同乘 `rangeMul` 后取整（保持 min < max）
 * - 主系/命中：可逐条覆写（缺省走舰级）；**能量主系形态**由 `energyForm` 决定——
 *   缺省/`'beam'` = 光束必中（不消费命中）；`'spit'` = **掷命中**（消费 `hitRate`、命中随距离衰减）。
 *   2026-09-11 船长裁决⑤「立「能量·掷命中」档」。
 */
/**
 * **机群/炮台火力占比的守恒拆分**（2026-09-11 船长：「**允许调整敌舰的无人机/炮台火力比例。
 * 这个要根据每个悬赏卡制定**」；七项细节由船长逐条点选）。
 *
 * 口径 = **守恒拆分**（与 A5「机群火力计入卡的总火力、母船单发让位」同源）：
 * 1. **基准 T** = 该**条目**按旧口径的**实收总单发**（该条目所有单位的炮台 ＋ 该条目所有架次机群；
 *    含 `dmgMul`、含多舰补偿 `2N/(N+1)`、含逐条取整）——即"今天玩家会吃到的量"；
 * 2. **机群先取** `D = round(T × s)`、**炮台余额** `G = T − D`；**两侧各保底**：机群 `D ≥ 架数`、
 *    炮台 `G ≥ 单位数`（⇒ **不会出现 0 伤害条目**）；
 * 3. **机群摊分**：D 均摊到逐架（顺序 = 条目内单位顺序 × 该舰 `drones` 展开顺序，与
 *    `foeDronePools` **同序**），**余数补给前面的架次**，保证 Σ = D；
 * 4. **炮台摊分**：G 按各单位「旧口径炮台单发」权重摊（同一条目内各单位的 `dmgMul` 相同 ⇒ 权重相等，
 *    故等价于均分；**余数补给前面的单位**），保证 Σ = G。
 *
 * 生效范围 = **只拆「机群 vs 母舰武器组」两类**（敌侧近防炮照 B3 裁定不动）；
 * 命中 / 射程 / 装填 / 血型 / 期望交距**一律不受影响**（本旋钮只改火力构成）。
 * **未写 `droneFireShare`（条目 ?? 舰级）的条目返回 `null`** ⇒ 建档走旧算法、**零行为变化**。
 */
function droneFireSplitOf(
  units: ReadonlyArray<{ slot: FoeShipSlot }>,
  comp: number,
): Array<{ gun: number; drones: number[] } | null> {
  const out: Array<{ gun: number; drones: number[] } | null> = units.map(() => null)
  /** 同一 `slot` 对象（`count > 1` 时被枚举多次）归成一组——比例与摊分都按**条目**算 */
  const groups = new Map<FoeShipSlot, number[]>()
  for (let i = 0; i < units.length; i++) {
    const slot = units[i]!.slot
    const list = groups.get(slot)
    if (list) list.push(i)
    else groups.set(slot, [i])
  }
  for (const [slot, idxs] of groups) {
    const share = slot.droneFireShare ?? slot.ship.droneFireShare
    if (share === undefined) continue
    const droneSlots = slot.ship.drones ?? []
    const perUnitDrones = droneSlots.reduce((n, ds) => n + Math.max(0, Math.round(ds.count)), 0)
    if (perUnitDrones === 0) continue // 无机群 ⇒ 比例无意义（契约另拦）；这里按未写处理
    const unitCount = idxs.length
    const nDrones = unitCount * perUnitDrones
    const mul = slot.dmgMul ?? 1
    const gunOld = Math.max(1, Math.round(slot.ship.shotDmg * mul * comp))
    const droneOld = droneSlots.flatMap((ds) =>
      Array.from({ length: Math.max(0, Math.round(ds.count)) }, () =>
        Math.max(1, Math.round(ds.drone.dmg * mul)),
      ),
    )
    const droneOldSum = droneOld.reduce((a, b) => a + b, 0)
    // ① 基准 T（该条目实收总单发）：
    //    **写了 `firepowerAnchor` ⇒ 以锚点为准**（船长 2026-09-12「架数变多、总火力不动」）——
    //    否则沿用旧公式（`单位数 ×（炮台旧单发 + Σ机群旧单发）`，零行为变化）。
    const T =
      slot.firepowerAnchor !== undefined && slot.firepowerAnchor > 0
        ? Math.max(nDrones + unitCount, Math.round(slot.firepowerAnchor))
        : unitCount * (gunOld + droneOldSum)
    const D = Math.max(nDrones, Math.min(Math.round(T * clamp(0, 1, share)), Math.max(nDrones, T - unitCount)))
    const G = T - D
    // ④ 机群摊分：逐架均分、余数补给前面的架次
    const dBase = Math.floor(D / nDrones)
    let dRem = D - dBase * nDrones
    // ⑤ 炮台摊分：按旧口径单发权重（同条目内每单位相同 ⇒ 权重相等），余数补给前几个单位
    const gBase = Math.floor(G / unitCount)
    let gRem = G - gBase * unitCount
    for (const i of idxs) {
      const drones: number[] = []
      for (let k = 0; k < perUnitDrones; k++) {
        drones.push(dBase + (dRem > 0 ? 1 : 0))
        if (dRem > 0) dRem -= 1
      }
      out[i] = { gun: gBase + (gRem > 0 ? 1 : 0), drones }
      if (gRem > 0) gRem -= 1
    }
  }
  return out
}

/**
 * **敌舰体火力的「越线折扣」**（2026-09-12 船长「按照 DPS 上限 150 算」→ **2026-09-15 船长改判**：
 * 「**不是钳制到150，而是超过150的部分进行一个约15%的折扣**」）——舰级路径按**整卡每波舰体总 DPS** 判线。
 *
 * 口径（判线三条全部经实测确认，本次未动）：
 * - **只算舰体武器组**（每条目 `ship.shotDmg × dmgMul × 多舰补偿` ÷ `ship.reloadMs` 秒）；
 *   **不含机群**（机群另有受击增程 / 备用机库 / A5 守恒三套机制，且船长已裁定不吃多舰补偿）；
 * - **不含被 `droneFireShare` / `firepowerAnchor` 拆分的条目**——那条链自带总火力锚定，
 *   再缩放会让锚点失准（`droneFireSplitOf` 内部已含补偿，外层缩放会与它打架）；
 * - 单发是整数 ⇒ 逐条取整后再求和，越线时**全卡舰体单发等比例缩放**（保持各条目相对权重）。
 *
 * **折扣公式（替代首版的硬钳制）**：`D > 阈值` 时目标 `D′ = 阈值 + (D − 阈值) × (1 − 折扣率)`，
 * 缩放系数 `= D′ / D` ⇒ **不封顶**，`D → ∞` 时 `D′ ≈ 0.85 × D`（斜率由 1 降为 0.85）。
 *
 * 现值（`150 / 0.15`，实测）：**洞外 27 张基础卡全部未越线**（最高 = 虚海守望者 131.3 DPS）⇒ 逐字不变；
 * 越线的是**窝点派生档**（穹顶 L1/2/3 164.8/203.1/253.2 · 虚海 L1/2 170.3/210.0 · 噬口 L2/3 172.3/215.5
 * ⇒ 折扣后 162.7/195.2/237.8 · 167.3/201.0 · 169.3/205.5）**与虫洞派生**（层 1 起陆续越线：
 * 深层 node 最高 1,234.5 → 1,071.8、boss 1,665.8 → 1,438.5）——虫洞按船长「都生效」一并吃折扣。
 *
 * `foeDpsCap` 或 `foeDpsOverCapDiscount` **任一未写 / 非正 ⇒ 返回空表**（不缩放，零行为变化；
 * ⚠ 折扣率 0 **不会**退回旧硬钳制语义）。
 */
function foeHullDpsOf(ship: FoeShipDef, dmgMul: number, comp: number, bal: BattleBalance): number {
  const per = Math.max(1, Math.round(ship.shotDmg * dmgMul * comp))
  return (per * 1000) / Math.max(1, ship.reloadMs)
}

/** 逐 `slot` 缓存缩放系数（同一条目的多个单位共用，避免重复计算） */
function foeDpsCapScaleOf(
  units: ReadonlyArray<{ slot: FoeShipSlot }>,
  comp: number,
  bal: BattleBalance,
  splitIdx: ReadonlyArray<{ gun: number; drones: number[] } | null>,
): Map<FoeShipSlot, number> {
  const out = new Map<FoeShipSlot, number>()
  const cap = bal.foeDpsCap
  const discount = bal.foeDpsOverCapDiscount ?? 0
  if (cap === undefined || !(cap > 0) || !(discount > 0)) return out
  const seen = new Set<FoeShipSlot>()
  const bySlot = new Map<FoeShipSlot, number[]>()
  for (let i = 0; i < units.length; i++) {
    const slot = units[i]!.slot
    const list = bySlot.get(slot)
    if (list) list.push(i)
    else bySlot.set(slot, [i])
  }
  let total = 0
  for (const [slot, idxs] of bySlot) {
    // 被占比/锚点拆分的条目跳过（自带总火力锚定；钳制会让锚点失准）
    if (idxs.some((i) => splitIdx[i] !== null)) continue
    seen.add(slot)
    total += idxs.length * foeHullDpsOf(slot.ship, slot.dmgMul ?? 1, comp, bal)
  }
  if (total <= cap) return out
  // 越线**只对超出部分**打折（2026-09-15 船长：「不是钳制到150，而是超过150的部分进行一个约15%的折扣」）：
  //   目标 D′ = 阈值 + (D − 阈值) × (1 − 折扣率) ⇒ **不封顶**，火力仍随威胁继续增长。
  // ⚠ 折扣率封在 1 以内（= 旧硬钳制语义）；0 已被上面的开关挡住 ⇒ **0 = 关闭、不退回硬钳制**。
  const target = cap + (total - cap) * (1 - Math.min(1, discount))
  const scale = target / total
  for (const slot of seen) out.set(slot, scale)
  return out
}

function createFoeSpecsFromShips(anomaly: AnomalyDef, bal: BattleBalance, opts: FoeSpecOpts): UnitSpec[] {
  const prefix = opts.tagPrefix ?? ''
  const waveIdx = shipWaveIndexOf(prefix)
  const comp = foeMultiShipCompMul(anomaly)
  const units = enumerateShipUnits(anomaly, waveIdx)
  /**
   * **本场的威胁读数**（挂载件「船体修理装置」的 k 用它算）：
   * 洞内走派生卡时 `anomaly.threat` 已由 `wormholeAnomalyOf` 写成**本层本用途的实际威胁**
   * （普通节点 = 层威胁、层末守卫 ×1.2、遗迹收尾 ×1.3、支援呼叫卡的延迟补偿 ×1.1）⇒ 与显示同源；
   * 洞外卡（星图悬赏 / 低安遭遇）就是卡面威胁。见 `FOE_REPAIR_THREAT_REF`。
   */
  const threatNow = foeJudgedThreatOf(anomaly)
  // **机群/炮台火力占比**（2026-09-11 船长：「允许调整敌舰的无人机/炮台火力比例。这个要根据每个
  // 悬赏卡制定」）——**条目级**旋钮，守恒拆分：先按旧口径算出该条目的实收总单发 T（含多舰补偿、
  // 逐条取整），再拆成「机群 D = round(T×s)」与「炮台 G = T−D」（两侧各保底 1/架、1/单位）。
  // 未写 s 的条目一律 `null` ⇒ 下面走旧算法（**零行为变化**）。
  const fireSplit = droneFireSplitOf(units, comp)
  // **敌舰体火力越线折扣**（2026-09-12 船长「按照 DPS 上限 150 算」→ 2026-09-15 改判「不是钳制到150，
  // 而是超过150的部分进行一个约15%的折扣」）：整卡本波舰体总 DPS 越线时，只对**超出部分**打折，
  // 再把该系数等比例施加于全卡舰体单发（机群与"被占比拆分的条目"不参与，见 `foeDpsCapScaleOf`）。
  const dpsCapScale = foeDpsCapScaleOf(units, comp, bal, fireSplit)
  return units.map((u, ui) => {
    const sp = fireSplit[ui]
    const ship = u.slot.ship
    const mount = resolveFoeMounts(u.slot.mounts ?? ship.mounts)
    const mix = u.slot.dmgMix ?? ship.dmgMix
    const type = pickTopType(mix)
    const totalHp = ship.hp * (u.slot.hpMul ?? 1)
    // 血型（三层比例）：**有效 split = 条目覆写 ?? 舰级**（2026-09-11 船长裁决①「头目血型随卡片走」）——
    // 同一条舰级在不同卡上可按卡面 `defProfile` 建档（A 族鱼龙混杂 ⇒ 什么血型都有，无族级约束）。
    const split = u.slot.split ?? ship.split
    const hp: Hp3 = { s: totalHp * split.s, a: totalHp * split.a, h: totalHp * split.h }
    // 炮台单发：写了比例 ⇒ 取拆分后的 G 摊分结果（Σ 与旧口径守恒），否则逐字沿用旧算法；
    // 之后再乘**舰体火力越线折扣**（越线才 <1；`fireSplit` 非空的条目缩放 = 1，见 `foeDpsCapScaleOf`）
    const rawShotDmg = sp
      ? sp.gun
      : Math.max(1, Math.round(ship.shotDmg * (u.slot.dmgMul ?? 1) * comp * (dpsCapScale.get(u.slot) ?? 1)))
    const shotDmg = ship.acidBurst ? 0 : mount.broodControl ? Math.max(1, Math.round(rawShotDmg * mount.broodControl.gunDmgMul)) : rawShotDmg
    const shotSplit = splitShotByComposition(shotDmg, compositionOfMix(mix))
    const multiShots: Partial<Record<DamageType, number>> | undefined =
      shotSplit.length > 1
        ? shotSplit.reduce<Partial<Record<DamageType, number>>>((acc, r) => {
            acc[r.type] = (acc[r.type] ?? 0) + r.dmg
            return acc
          }, {})
        : undefined
    const rangeMul = u.slot.rangeMul ?? 1
    const rangeMax = Math.max(2, u.slot.rangeMaxM ?? Math.round(ship.rangeMaxM * rangeMul))
    const rangeMin = Math.max(1, Math.min(rangeMax - 1, u.slot.rangeMinM ?? Math.round(ship.rangeMinM * rangeMul)))
    // 战术：卡上覆写优先（2026-09-11 船长「头目建议允许多个战术」）——同一条头目舰可配多种打法
    const tactic = u.slot.tactic ?? ship.tactic
    // 能量武器形态（2026-09-11 船长裁决⑤「立「能量·掷命中」档」）：条目覆写 > 舰级，缺省 = 光束必中。
    // **只对能量主系生效**：动能/爆炸主系本来就是 fixed 掷命中，本字段不参与。
    const energyForm = (u.slot.energyForm ?? ship.energyForm) === 'spit' ? ('spit' as const) : ('beam' as const)
    const isBeam = type === 'plasma' && energyForm === 'beam' // 光束必中（缺省口径，零行为变化）
    // 单波次内增援（2026-09-11 船长裁决：机制实现、不启用）：**条目写了 `enterAt` 且总开关打开**时
    // 才给单位挂 `foeReinforceAt`——开关关闭时本字段一律不写（与 `foeCanCharge` 同款总开关形态，
    // 这保证"关了就是零行为变化"）。触发条件全无效 = 视为未写 = 开战即在（见 `FoeReinforceTrigger` 注释）。
    const reinforceAt =
      bal.foeReinforceEnabled === true
        ? normReinforceTrigger(u.slot.enterAt)
        : null
    const name = foeUnitNameOf(anomaly, u.tag);
    /**
     * **挂载件解析**（2026-09-16 船长：「**能否将冲锋设置成类似舰船装备的挂载物？这样只要给敌人装配就行了**」
     * ＋「除了C族，将D族和E族的射程增加也迁成挂载件」）：**条目 `mounts` ?? 舰级 `mounts`**（条目优先，
     * 与 `droneFireShare`/`desireRangeM` 同款）⇒ 运行时字段。旧字段（`foeCanCharge`/`foeChargeMul`/
     * `droneRangeMulOnHit`/`gunRangeMulOnHit`）保留为**兼容回退**：只有**没挂 mounts** 时才读，
     * 所以老卡、老档、老测试逐字不变。
     */
    /** 本条目内**逐架机群单发**的游标（与 `ship.drones` 展开顺序一致，仅写了比例时消费） */
    let dIdx = 0
    // **舰载机群**（2026-09-11 机群批 · 设计稿 `foe-drone-system-20260911.md` §三/§五）：
    // 每架展开成**一条** `src:'drone'` 武器条目（与我方"每架一条"同构 ⇒ 演出层按机型合并、按架击落）。
    // **A5 火力守恒**：机群吃**同一条 `dmgMul`**（⇒ 卡上挂机群时把 `dmgMul` 调低，**母舰单发自动让位**）；
    // **不吃多舰补偿**（船长 2026-09-11 裁定「不吃」——`foeMultiShipCompMul` 只数舰级编成单位，本就不含机群）。
    const droneWeapons: WeaponSpec[] = (ship.drones ?? []).flatMap((ds) =>
      Array.from({ length: Math.max(0, Math.round(ds.count)) }, () => ({
        label: `${ds.drone.name} ×1`,
        kind: 'fixed' as const,
        src: 'drone' as const,
        artId: ds.drone.id,
        fixedType: ds.drone.damageType,
        // 机群单发：写了比例 ⇒ 取拆分后的 D 摊分结果（逐架、余数补前面的架次），否则沿用旧算法
        shotDmg: Math.max(1, Math.round((sp ? sp.drones[dIdx++]! : Math.max(1, Math.round(ds.drone.dmg * (u.slot.dmgMul ?? 1)))) * (mount.broodControl?.droneDmgMul ?? 1))),
        ...(mount.broodControl ? { foeDroneRangeBonusPct: mount.broodControl.droneRangeBonusPct } : {}),
        maxRangeM: Math.max(2, ds.drone.maxRangeM),
        minRangeM: 1, // 机群无近盲带（贴脸也打）
        hitRate: ds.drone.hitRate,
        falloff: ds.drone.falloff,
        reloadMs: ds.drone.reloadMs,
      })),
    )
    // **备用机库**（2026-09-12 船长「损坏后补充敌机」）：备用机与 `drones` **同机型**，
    // 建档时展开成**额外的待命条目**（`initFoeDronePools` 把它们标成 `inHangar`：不出战、不开火、
    // 不计存活架数；前线战损后按 `respawnMs` 满血放出）。⚠ 不写 = 无备用（零行为变化）。
    const reserve = ship.droneReserve
    const reserveModel = (ship.drones ?? [])[0]?.drone
    if (reserve && reserveModel && reserve.count > 0) {
      for (let k = 0; k < Math.round(reserve.count); k++) {
        droneWeapons.push({
          label: `${reserveModel.name} ×1`,
          kind: 'fixed' as const,
          src: 'drone' as const,
          artId: reserveModel.id,
          reserve: true, // **账目标记**：备用机（库存深度）——总火力/守恒核对排除它
          fixedType: reserveModel.damageType,
          shotDmg: sp ? sp.drones[sp.drones.length - 1]! : Math.max(1, Math.round(reserveModel.dmg * (u.slot.dmgMul ?? 1))),
          maxRangeM: Math.max(2, reserveModel.maxRangeM),
          minRangeM: 1,
          hitRate: reserveModel.hitRate,
          falloff: reserveModel.falloff,
          reloadMs: reserveModel.reloadMs,
        })
      }
    }
    return {
      tag: u.tag,
      ...(ship.acidBurst ? { acidBurst: { ...ship.acidBurst, ...(ship.acidBurst.damage !== undefined ? { damage: Math.round(ship.acidBurst.damage * (u.slot.dmgMul ?? 1) * comp) } : {}) } } : {}),
      ...(mount.hatchery ? { foeHatchery: { ...mount.hatchery } } : {}),
      ...(mount.fleetSpeedRamp ? { foeFleetSpeedRamp: { ...mount.fleetSpeedRamp } } : {}),
      name,
      side: 'foe' as const,
      hp,
      /**
       * **层位抗性**（2026-09-15 船长：「我现暂时只打给 **C 族**添加**全血条 25% 爆炸抗性**」）：
       * 从**舰级**读（`FoeShipDef.shieldResist / armorResist / hullResist`；三条都缺省 ⇒ `{}`，
       * 既有舰级零行为变化）。与敌机群那条装配口径一致（同 `FoeDroneDef.defense` 的展开写法）。
       * ⚠ 抗性**可为负**（2026-09-27 船长令）：`applyDamage` 夹 `RESIST_FLOOR(−0.9) ~ 0.9`，
       * 所以这里传负数**会**变成"易伤"（该层受额外伤害，最多 ×1.9）。
       */
      resists: {
        ...(ship.shieldResist ? { shield: ship.shieldResist } : {}),
        ...(ship.armorResist ? { armor: ship.armorResist } : {}),
        ...(ship.hullResist ? { hull: ship.hullResist } : {}),
      },
      /**
       * 舰级闪避（船长 2026-09-16 新舰「劫掠电子舰」：闪避提高）：缺省 0.12 = 既有全部敌舰原值。
       *
       * ⚠ **姿态陀螺仪在此加算**（船长 2026-09-24：「在虫洞内，A族添加一个挂载件：姿态陀螺仪：
       * 增加10%闪避」＋追问裁定「**加算 +10 个百分点**（甲）」）：`舰级值 + 挂载件加数`，
       * 上限 **0.9**（与舰级值同一把尺）⇒ 洞内 A 族 0.22 → **0.32**、劫掠电子舰 0.30 → **0.40**。
       * 没挂该件的单位**逐字不变**（`foeEvasionBonusAdd` 只在挂件时才写）。
       */
      evasion: Math.min(
        0.9,
        (ship.evasion ?? 0.12) + (mount.foeEvasionBonusAdd ?? 0),
      ),
      ...(mount.foeEvasionBonusAdd !== undefined ? { foeEvasionBonusAdd: mount.foeEvasionBonusAdd } : {}),
      // **射程压制**（H 族墨潮干扰舰 · 2026-09-24 船长）：舰级级字段，原样带到单位（消费见 meRangeMulOf）
      // ⚠ **2026-09-26 起来源以挂载件为准**（船长令：射程压制迁成具名件「墨潮干扰阵列」）——
      //   挂载件优先、舰级字段保留为回落（别的卡若仍写舰级字段，逐字照旧）。
      ...((mount.foeRangeDebuffPct ?? ship.foeRangeDebuffPct) !== undefined
        ? { foeRangeDebuffPct: mount.foeRangeDebuffPct ?? ship.foeRangeDebuffPct }
        : {}),
      hitBonus: 0,
      signatureM: Math.max(45, Math.round(60 + totalHp * 0.5)),
      scanResMm: 450,
      // 速度 = 舰种基准速度 × 舰级倍率 × 本条 speedMul（后取整）——2026-09-11 追加裁决：
      // 「劫掠护卫舰和劫掠狙击舰下落一档，只有头目是巡洋舰」；基准表在 BattleBalance
      // （core 不能 import data 包的 hullClass.ts，故基准随 bal 传入），零行为变化。
      speedMps: Math.round(bal.hullClassBaseSpeedMps[ship.hullClassTier] * ship.speedRatio * (u.slot.speedMul ?? 1)),
      agility: 0.3,      // 敌突进（冲锋）资格，三条**互相独立**的来源：
      //   ① **挂载件**（`FoeMountDef.charge`，2026-09-16 起的主路——"给敌人装配件"）；
      //   ② **舰级级 opt-in**（`ship.foeCanCharge`，兼容回退）——无条件放行，**不看**总开关与威胁门槛，
      //      用于"慢而硬、追不上"的重型单位（C 族噬口巨兽，实速 297）与 2026-09-14 起同样开启的三种小虫；
      //   ③ 老路：威胁 ≥ 门槛 且 **有效战术** = brawl（卡上覆写优先；总开关默认 false）。
      ...(mount.foeCanCharge === true ||
      ship.foeCanCharge === true ||
      (bal.foeChargeEnabled === true &&
        anomaly.threat >= bal.foeChargeThreatFloor &&
        tactic === 'brawl')
        ? { foeCanCharge: true }
        : {}),
      // **逐单位冲锋倍率**（2026-09-14 船长：「大虫子的冲锋倍率改为3，给小虫子添加冲锋，倍率为1.5」）——
      // 挂载件优先；缺省**不写** ⇒ 走全局 `bal.foeChargeMul`（旧读数逐字不变）。
      ...(() => {
        const mul = mount.foeChargeMul ?? ship.foeChargeMul
        return mul !== undefined ? { foeChargeMul: mul } : {}
      })(),
      // **逐单位冲锋冷却**（2026-09-16 船长：A 族海盗「冲锋倍率为1.6，**冷却30秒**」）——挂了件才写
      ...(mount.foeChargeCooldownMs !== undefined ? { foeChargeCooldownMs: mount.foeChargeCooldownMs } : {}),
      // **C 族族设定**（2026-09-30 船长令）：四件虫群冲锋器带 `webImmune` ⇒ 本单位的冲锋不被网的
      // 「关推进器」解除（消费点 = `applyFoeWebDebuff`）。缺省不写 ⇒ 其余冲锋单位零行为变化。
      ...(mount.foeChargeWebImmune === true ? { foeChargeWebImmune: true } : {}),
      // **挂载件展示名**（船长同日「要：敌舰悬停/战报展示挂载件」）——视图/战报直接渲染
      ...(mount.names.length > 0 ? { foeMountNames: mount.names } : {}),
      // **同序双语名对**（2026-09-24）：显示层按语言取一列（`mountPairsOf` 那条链）
      ...(mount.namePairs.length > 0 ? { foeMountNamePairs: mount.namePairs } : {}),
      // **闪现跃迁**（**船长 2026-10-01 令**：「激光武器+闪现效果的挂载件」）——挂了件才写；
      // 消费点 = 下面受击钩子旁那一处（本体被命中 ⇒ 拉开 `distanceM` 并盖冷却）。
      // 缺省不写 ⇒ 既有各族各件**零行为变化**。
      ...(mount.foeBlink !== undefined ? { foeBlink: mount.foeBlink } : {}),
      // **叠光装置**（**船长 2026-10-01 令**：「添加叠光装置：效果是每次攻击或者闪现后，攻击间隔缩短，
      // 最多缩短至0.5秒攻击间隔。伤害给予一个0.3的倍率。」）——挂了件才写；消费点两处：
      // ① 开火处（用当前间隔重置装填计时）；② 闪现后（`settleFoeBlinkExtras`）。
      // 缺省不写 ⇒ 既有各族各件**零行为变化**。
      ...(mount.foeOverlayDrive !== undefined ? { foeOverlayDrive: mount.foeOverlayDrive } : {}),
      // **闪烁过载装置**（**船长 2026-10-01 令**：「粼光添加闪烁过载装置，效果是每次触发闪现后，
      // 恢复所有护盾值。但是会损失最大结构值5%的结构。」）——挂了件才写；
      // 消费点 = 闪现成功后那一处（`settleFoeBlinkExtras`）。缺省不写 ⇒ 零行为变化。
      ...(mount.foeFlashOverload !== undefined ? { foeFlashOverload: mount.foeFlashOverload } : {}),
      // **待机护盾阵列**（**船长 2026-10-02 令**：「闪现未处于冷却中的时候，护盾拥有全伤害50%的抗性。」）
      // —— 挂了件才写；消费单点 = **敌舰伤害唯一收口** `applyFoeUnitDamage`（按闪现是否在冷却中
      // 决定要不要把 50% 并进护盾层）。缺省不写 ⇒ 既有各族各件**零行为变化**。
      ...(mount.foeStandbyShield !== undefined ? { foeStandbyShield: mount.foeStandbyShield } : {}),
      // **聚焦阵列**（**船长 2026-10-02 令**：「武器的远端衰减，随时间提高到1（就是无衰减）。」
      // ＋改判「旗舰挂载件的会随波重置」）—— 挂了件才写；消费单点 = 敌方开火段（按本波起点现算）。
      ...(mount.foeFocusArray !== undefined ? { foeFocusArray: mount.foeFocusArray } : {}),
      // 单波次内增援（2026-09-11 船长裁决：机制实现、不启用）——带本字段的单位**不进开战编队**
      ...(reinforceAt ? { foeReinforceAt: reinforceAt } : {}),
      // **支援呼叫分支**（2026-09-19）：纯标签、一律带上（派生侧的"互斥分支记账"要用它）
      ...(u.slot.enterBranch !== undefined ? { foeReinforceBranch: u.slot.enterBranch } : {}),
      // **支援呼叫装置**（2026-09-19）：与 `foeReinforceAt` 同款总开关形态（关了不写 ⇒ 零行为变化）
      ...(bal.foeReinforceEnabled === true && mount.foeSupportCall !== undefined
        ? { foeSupportCall: mount.foeSupportCall }
        : {}),
      weapons: [
        {
          label: `${name} 武器组`,
          // 形态（2026-09-11 船长裁决⑤）：能量主系 = 光束必中（缺省）/ 掷命中（`energyForm: 'spit'`）；
          // 动能/爆炸主系一律 fixed 掷命中，不受本字段影响。
          kind: isBeam ? ('beam' as const) : ('fixed' as const),
          fixedType: type,
          shotDmg,
          ...(ship.gunCount !== undefined ? { gunCount: ship.gunCount } : {}),
          ...(multiShots ? { shotsByType: multiShots } : {}),
          // ⚠ **干扰舰的武器射程不受自己压制的影响**（船长 2026-09-24 三例：「敌方不变」）——
          // 它的 `foeRangeDebuffPct` 只作用于**我方射程**（见 `meRangeMulOf` / `applyMeJammerDebuff`）。
          maxRangeM: rangeMax,
          minRangeM: rangeMin,
          blindDmgMul: ship.blindDmgMul ?? 0.3,
          // 必中光束不消费命中（恒 1）；掷命中（动能/爆炸 + 能量 spit）走命中率
          hitRate: isBeam ? 1 : (u.slot.hitRate ?? ship.hitRate),
          // 远端威力衰减：条目覆写 ?? 舰级（2026-09-12 加，与 `hitRate` 同款；**缺省 = 舰级值 ⇒ 零行为变化**）
          falloff: u.slot.falloff ?? ship.falloff,
          reloadMs: ship.reloadMs,
          // **连发**（**船长 2026-10-02 令**：「每次开火是三次间隔100ms的射击，目标选择随机」）——
          // 舰级字段原样带给这条主武器（消费点 = 敌方开火段：前 `shots−1` 发之后装填重置为 `gapMs`）。
          // 缺省不写 ⇒ 一门一次、既有全部敌舰**零行为变化**。
          ...(ship.burst !== undefined ? { burst: ship.burst } : {}),
        },
        ...droneWeapons, // 机群：每架一条（同序 ⇒ 与 `foeDronePools[tag]` 逐架对齐）
      ],
      ...(droneWeapons.length > 0 ? { foeDrones: ship.drones } : {}),
      // **单次出击上限 / 备用机库**（2026-09-12 船长两条裁定）：只在挂了机群时下发；缺省不写 ⇒ 零变化
      ...(ship.droneLaunch && droneWeapons.length > 0
        ? { foeDroneLaunch: ship.droneLaunch }
        : {}),
      ...(ship.droneReserve && droneWeapons.length > 0
        ? { foeDroneReserve: ship.droneReserve }
        : {}),
      /**
       * **船体修理装置的逐单位脉冲**（船长 2026-09-24：「给G族添加挂载件：船体修理装置。
       * 每5秒恢复5装甲和5结构，**会吃威胁的加成**」＋裁定「修理量 = 乘层威胁倍率」甲＋
       * **同日二次令「基础数值上调至15装甲15结构」**）：
       * `k` = **本层本次实际威胁 ÷ 45**（船长逐字口径「k = 层威胁 ÷ 45」；45 = 第 1 层基准威胁，
       * 层 1 的 k 恰为 **1.00** = 追问时的归一基准「不改动」）。
       *
       * ⚠ **威胁取本场的实际值、与显示给玩家的同一把尺**：洞内战斗取派生卡的 `threat`
       * （= `wormholeCardThreatOf(卡, 层, 用途)`：普通节点 = 层威胁、层末守卫 ×1.2、遗迹收尾 ×1.3、
       * 挂了支援呼叫装置的卡 ×1.1）；洞外（星图侧契约本就禁止挂这件）不派生 ⇒ 取卡面 `threat`。
       * ⇒ 基数 15/15 下：层 1 = 15/15 · 层 7 ≈ 30/30 · 层 10 ≈ 42/42，与设计稿 §二 的读数一致。
       */
      ...(() => {
        const rp = mount.foeRepairPulse
        if (rp === undefined) return {}
        return {
          foeRepairPulse: { ...rp, k: Math.max(1, threatNow / FOE_REPAIR_THREAT_REF) },
        }
      })(),
      /**
       * **支援舰船召唤装置**（船长 2026-09-25；见 `FoeMountDef.reviveEscort`）：参数原样带给单位
       * （池子/上限/入场口径都在 `advanceBattleFor` 的"支援舰召唤"一段里判）。
       * 缺省不写 ⇒ 该单位不召唤（零行为变化）。
       */
      ...(mount.foeReviveEscort !== undefined ? { foeReviveEscort: mount.foeReviveEscort } : {}),
      // **受击增程**（2026-09-11 船长）：只有挂了机群的舰级才可能写；缺省不写 ⇒ 零行为变化。
      // 2026-09-16 起走挂载件（`foe-mount-drone-range-x4`），旧字段 `ship.droneRangeMulOnHit` 兼容回退
      ...((mount.foeDroneRangeMulOnHit ?? ship.droneRangeMulOnHit) !== undefined && droneWeapons.length > 0
        ? { foeDroneRangeMulOnHit: mount.foeDroneRangeMulOnHit ?? ship.droneRangeMulOnHit }
        : {}),
      // **受击增程（炮台）**（2026-09-12 船长：D 族静滞卫舰「挨打后射程增加 50%」，仅该型舰）：
      // 与机群那条无关（不需要机群），缺省不写 ⇒ 零行为变化。2026-09-16 起走挂载件（`foe-mount-gun-range-x1-5`）
      ...((mount.foeGunRangeMulOnHit ?? ship.gunRangeMulOnHit) !== undefined
        ? { foeGunRangeMulOnHit: mount.foeGunRangeMulOnHit ?? ship.gunRangeMulOnHit }
        : {}),
      ...(mount.foeGunRangeNoticeId !== undefined ? { foeGunRangeNoticeId: mount.foeGunRangeNoticeId } : {}),
      // **劫掠捕获网**（船长 2026-09-16）：本舰第一次开火那一刻钉住它这一发的目标；四层效果与解除口径见 FoeMountDef.web / applyMeWebDebuff
      ...(mount.foeCaptureWeb !== undefined ? { foeCaptureWeb: mount.foeCaptureWeb } : {}),
      // **舰种档**（2026-09-12 加）：敌舰近防炮的档系数用（`balance.pdTierMul`，越大的船防空越强）
      hullClassTier: ship.hullClassTier,
      /**
       * **敌族**（**2026-09-25 船长令**：「增强 H 族敌人的近防炮强度」）：只服务**按族的近防炮覆写**
       * （`balance.pdFamilyOverride`）。缺省不写（旧路径/合成 spec）⇒ 走全局值，零行为变化。
       */
      family: ship.family,
      /**
       * **舰级 id**（2026-09-24 加）：只服务**旗舰 BOSS 的伤害台账**（`flagshipBattleLedger`
       * 要认出"哪几个单位是母舰"）——战斗态里此前没有任何"我是哪条舰级"的标记。
       * 缺省不写（旧路径）= 台账认不出 ⇒ 等于零行为变化。
       */
      foeShipId: ship.id,
      // **敌方后勤舰**（船长 2026-09-16）：把自身 repairPct 比例的名义 DPS 转成修理值；缺省不写 ⇒ 零变化
      ...(ship.repairPct !== undefined ? { repairPct: ship.repairPct } : {}),
      foeTactic: tactic,
      // **自己的有效射程带**（含覆写）——供 `foeDesiredRange` 在舰级路径上替代全局战术表
      // （2026-09-11 船长裁决②「期望交距改取该单位自己的射程带」）。旧路径不写本字段。
      foeRangeBand: { min: rangeMin, max: rangeMax },
      // **期望距离覆写**（条目 > 舰级）：写了的卡/舰级直接钉住作战距离
      ...((u.slot.desireRangeM ?? ship.desireRangeM) !== undefined
        ? { foeDesireRangeM: u.slot.desireRangeM ?? ship.desireRangeM }
        : {}),
    }
  })
}

/* ═══════ 单波次内增援（2026-09-11 机制落地 → **2026-09-19 船长批「支援呼叫装置」启用**）═══════
 * **机制**：编成条目的 `enterAt` 给三种入场触发（第几秒 / 击毁几个 / 残血到多少）；
 * 带触发的单位**开战不进战场**，由 `advanceBattleFor` **每拍**检查、条件命中才 `seedUnit` 补入。
 *
 * **启用依据**（船长 2026-09-19）：「战斗开始20秒后，增援2艘幽灵舰。如果对方在自己最远射程之外时，
 * 增援2艘静滞卫舰。」⇒ 总开关 `BattleBalance.foeReinforceEnabled = true`；第一批用户 = 洞内深层卡
 * 「陵墓王庭」，其**分支到场**另见下方 `resolveReinforcements` 与 `FoeMountDef.supportCall`。
 * 契约由旧「增援机制未启用契约」改写成「**支援呼叫装置契约**」（只允许挂了该件的卡写
 * `enterAt`/`enterBranch`、两支成对且守恒）——见 `tools/content-check.ts`。
 *
 * **存档零迁移**：不新增任何存档字段——"某个单位是否已入场"**由 `battle.units` 里有没有它的 tag 反推**
 * （`seedUnit` 对已存在的 tag 不覆盖，尸体也留着，故"在场过"永远是"存在"）。
 * 读档续战时 `advanceBattleFor` 用同一份 `curFoes` 重新推导，未入场者继续等条件命中。
 *
 * **仅舰级路径**：`enterAt` 长在 `FoeShipSlot` 上，旧威胁推导路径（未写 `ships` 的卡）天然不涉及。
 *
 * ⚠ **与多舰补偿系数 `2N/(N+1)`**（两条路：结构解法 vs 数值补偿）——见设计稿
 * `docs/design/foe-reinforce-20260911.md`；洞内派生会把总量归一 ⇒ 本卡不产生叠加。
 */

/** 规范化增援触发条件：只保留**有效**条件（`sec > 0` / `afterKills > 0` / `0 ≤ hpBelow ≤ 1`）；
 *  **一个有效条件都没有 → 返回 null = 按"未写"处理 = 开战即在**（刻意不产生"永不入场"的沉默副作用）。 */
function normReinforceTrigger(at?: FoeReinforceTrigger): FoeReinforceTrigger | null {
  if (!at) return null
  const out: FoeReinforceTrigger = {}
  if (typeof at.sec === 'number' && Number.isFinite(at.sec) && at.sec > 0) out.sec = at.sec
  if (typeof at.afterKills === 'number' && Number.isFinite(at.afterKills) && at.afterKills > 0) {
    out.afterKills = Math.floor(at.afterKills)
  }
  if (typeof at.hpBelow === 'number' && at.hpBelow >= 0 && at.hpBelow <= 1) out.hpBelow = at.hpBelow
  return Object.keys(out).length > 0 ? out : null
}

/** 本波编成（`curFoes` 全部条目）的**存活剩余总血比例**：分子 = 在场且未全灭的单位的剩余三层血之和，
 *  分母 = 本波编成的**满血总量**（含尚未入场的增援——"残部呼救"要按编制总量看，不是按在场量看）。 */
function foeResidualHpFrac(b: import('./state').BattleState, curFoes: readonly UnitSpec[]): number {
  let max = 0
  let cur = 0
  for (const f of curFoes) {
    max += f.hp.s + f.hp.a + f.hp.h
    const u = b.units[f.tag]
    if (u) cur += u.hp.s + u.hp.a + u.hp.h
  }
  return max > 0 ? Math.max(0, cur) / max : 0
}

/** 本场**已击毁的敌方单位数**（三层血全归零即计；尸体留在 `battle.units` 里，故可直接数）。 */
function foeKillCount(b: import('./state').BattleState): number {
  let n = 0
  for (const tag of Object.keys(b.units)) {
    const u = b.units[tag]!
    if (u.side !== 'foe') continue
    if (u.hp.s <= 0 && u.hp.a <= 0 && u.hp.h <= 0) n += 1
  }
  return n
}

/** 入场触发判定：**任一条件满足即入场**（未写/无效的条件不参与）。
 *  `sec` 走**战斗时钟**（`lastTickGameMs − startedAtGameMs`，与推进器相位同口径、波次演出窗口不计时）。 */
function reinforceTriggered(
  at: FoeReinforceTrigger,
  b: import('./state').BattleState,
  curFoes: readonly UnitSpec[],
): boolean {
  if (at.sec !== undefined && b.lastTickGameMs - b.startedAtGameMs >= at.sec * 1000) return true
  if (at.afterKills !== undefined && foeKillCount(b) >= at.afterKills) return true
  if (at.hpBelow !== undefined && foeResidualHpFrac(b, curFoes) <= at.hpBelow) return true
  return false
}

/* ═══════ 支援呼叫装置（2026-09-19 船长：「战斗开始20秒后，增援2艘幽灵舰。如果对方在自己最远射程
 * 之外时，增援2艘静滞卫舰。」＋「因为延迟到场，所以需要一定补偿。卡计算的实际威胁要*1.1」）═══════
 *
 * **形态**：挂件挂在**呼叫者**（本卡 = 守墓王座舰）身上；两支到场单位由卡的**条目**声明
 * （`enterAt` 给时点、`enterBranch` 给分支）。每拍判一次，**判完锁死**——由"哪一支已入场"反推
 * （含尸体）⇒ **零存档字段、读档续战天然可续**。
 *
 * **判定**：战斗时钟 ≥ `delaySec` 时，取玩家当前距离 `b.distanceM` 与**呼叫者当时有效的炮台最远射程**
 * 比较（含我方电子舰的射程削减；与开火门/受击增程同一算法）⇒ 射程内 = `'inside'`、射程外 = `'outside'`。
 * 呼叫者**被击毁即不再呼叫**（本卡里"击毁王座舰 = 战斗结束"，故实际是死规矩）。
 */

/** 带「支援呼叫装置」的呼叫者（**存活**才作数）；本卡里 = 守墓王座舰 */
function supportCallerOf(
  b: import('./state').BattleState,
  curFoes: readonly UnitSpec[],
): UnitSpec | undefined {
  for (const spec of curFoes) {
    if (spec.foeSupportCall === undefined) continue
    const u = b.units[spec.tag]
    if (u && u.side === 'foe' && u.hp.s > 0 && u.hp.a > 0 && u.hp.h > 0) return spec
  }
  return undefined
}

/** 呼叫者的**当前有效炮台最远射程**（与 `markFoeGunRangeBuff` 的 reach 同一算式） */
function supportCallerReachM(b: import('./state').BattleState, caller: UnitSpec): number {
  return caller.weapons.reduce((m, w) => Math.max(m, foeGunMaxRangeOf(b, caller, w)), 0)
}

/** 已入场的那一支（**含尸体**——尸体留在 `battle.units` 里，故"到场过"永远是"存在"） */
function arrivedSupportBranch(
  b: import('./state').BattleState,
  curFoes: readonly UnitSpec[],
): FoeSupportBranch | null {
  for (const spec of curFoes) {
    const br = spec.foeReinforceBranch
    if (br !== undefined && b.units[spec.tag]) return br
  }
  return null
}

/** 本拍应当到场的那一支（`null` = 还没到判定时刻 / 呼叫者不在场 ⇒ 分支条目一律不进） */
function resolveSupportBranch(
  b: import('./state').BattleState,
  curFoes: readonly UnitSpec[],
): FoeSupportBranch | null {
  const settled = arrivedSupportBranch(b, curFoes)
  if (settled !== null) return settled // 判过就锁死（另一支本场不再出现）
  const caller = supportCallerOf(b, curFoes)
  if (caller === undefined || caller.foeSupportCall === undefined) return null
  const delayMs = Math.max(0, Math.round(caller.foeSupportCall.delaySec * 1000))
  if (b.lastTickGameMs - b.startedAtGameMs < delayMs) return null
  return b.distanceM <= supportCallerReachM(b, caller) ? 'inside' : 'outside'
}

/**
 * **每拍结算「支援舰船召唤」**（**船长 2026-09-25**：「给入侵母舰添加类似D族挂载件的独立挂载件，
 * 只不过改为**复活被摧毁的友军**（但是**表现形式上为敌方支援舰船入场**），**增援时间是60秒**，
 * **每次随机复活一艘**」；**2026-09-26 船长改判**：「…改为每60秒复活2艘船。且必定会复活干扰舰」
 * ⇒ 每次 count 艘 + priorityShipIds 名单（**优先**语义：干扰舰在可补池里就先占名额）；见 `FoeMountDef.reviveEscort`）。
 *
 * 口径（全部由船长选定）：
 * - **召唤者** = 挂了该件的单位（= 入侵母舰），且**必须在场**（它沉了就不再召唤；计时停在原地）；
 * - **节拍** = 每 `everyMs`（60 秒）一次，**首次基准 = 召唤者入场那一刻**（母舰入场才开始有支援可言）；
 * - **池子** = **当前这一波编成里已阵亡**的单位（**召唤者自己除外**）——只补当前波，跨波不补；
 * - **上限** = **不超本波原编成**（活着的 + 已召唤的 ≥ 编成数 ⇒ 本拍不召唤）⇒ 死一个补一个，
 *   玩家打掉得比补得快才能推进；
 * - **满血入场** + 入场窗口（`enteredAtMs`：动画演完才可被选中、首发也推到窗口之后）——
 *   与波次转场/单波增援**同一套演出与窗口口径**；
 * - **表现 = 敌方支援舰船入场**：新 tag **`sup{n}-<原tag>`** ⇒ 界面上是一艘**新单位**（新舰影 +
 *   入场动画），而美术/体积/名称仍按原 tag 解析（`baseFoeTag` 剥壳，见 `foeShipAtTag`）；
 * - **入场即参战**：本函数只写 `battle.units`（**编成表 `curFoes` 一个字段都不动**——槽位/上限/
 *   优先名单全按它算）⇒ 参战列表由调用方用 `foesWithSupport` 重取（开火/选靶/判清波三处同源），
 *   漏了这一步它就只是一具"会显示的摆设"（2026-09-27 玩家报障的根因）；
 * - 随机走 `state.rng`，但**只在挂了本件的战斗里消费** ⇒ 没挂件的战斗随机序列逐字不变。
 */
export function resolveFoeRevive(
  state: GameState,
  b: import('./state').BattleState,
  curFoes: readonly UnitSpec[],
  bal: BattleBalance,
  nowMs: number,
): void {
  if (bal.foeReviveEnabled !== true) return
  const summoner = curFoes.find((f) => f.foeReviveEscort !== undefined)
  if (summoner === undefined || summoner.foeReviveEscort === undefined) return
  const rt = b.units[summoner.tag]
  if (!rt || (rt.hp.s <= 0 && rt.hp.a <= 0 && rt.hp.h <= 0)) return
  const everyMs = Math.max(1_000, Math.round(summoner.foeReviveEscort.everyMs))
  const activeClock = summoner.foeReviveEscort.activeClock === true
  const clock = activeClock ? b.foeAbilityClocks?.[summoner.tag] ?? 0 : nowMs
  if (b.foeReviveAtMs === undefined) b.foeReviveAtMs = activeClock ? everyMs : (rt.enteredAtMs ?? b.startedAtGameMs) + everyMs
  if (clock < b.foeReviveAtMs) return
  /** 到点 ⇒ 推进一格（大步长/离线补算一格一格来，不在一次推进里连刷） */
  b.foeReviveAtMs = clock + everyMs
  /**
   * **本波"槽位"口径**：一个编成条目 = 一个槽位，槽位里站着的是**原单位或它的支援舰**（`sup{n}-`）。
   * ⚠ 支援舰不是 `curFoes` 里的条目 ⇒ 数"在场数"必须把它们的**剥壳 tag** 一并算上，
   * 否则上限形同虚设（每次到点都能再补一艘，战场无限膨胀）。
   * ⚠⚠ 同理，**参战列表**也得把它们的剥壳 tag 算上（`foesWithSupport`）——本函数只负责"补进场"，
   * "补进来之后它算不算敌人"在调用方（2026-09-27 报障的根因）。
   */
  const specTags = new Set(curFoes.map((f) => f.tag))
  const aliveSlots = new Set<string>()
  for (const [tag, u] of Object.entries(b.units)) {
    if (u.side !== 'foe') continue
    if (u.hp.s <= 0 && u.hp.a <= 0 && u.hp.h <= 0) continue
    const slot = baseFoeTag(tag)
    if (specTags.has(slot)) aliveSlots.add(slot)
  }
  /** **编成已满 ⇒ 不召唤**（船长的"不超本波原编成"）；剩余空槽数在下面按 `count` 分配时用 */
  if (aliveSlots.size >= curFoes.length) return
  /**
   * 池子 = **当前波编成里已阵亡、且槽位还空着**的条目（**召唤者自己除外**）——
   * 已阵亡才叫"复活"（必须有尸体），槽位空着才补得进去（同一槽位的支援舰还活着就不重复补）。
   */
  const dead = curFoes.filter(
    (f) =>
      f.foeReviveEscort === undefined &&
      (summoner.foeReviveEscort!.allowedShipIds === undefined || summoner.foeReviveEscort!.allowedShipIds.includes(f.foeShipId ?? '')) &&
      b.units[f.tag] !== undefined &&
      !aliveSlots.has(f.tag) &&
      b.units[f.tag]!.hp.s <= 0 &&
      b.units[f.tag]!.hp.a <= 0 &&
      b.units[f.tag]!.hp.h <= 0,
  )
  if (dead.length === 0) return
  /**
   * **本拍补几艘**（**船长 2026-09-26**：「入侵活动中，H族入侵母舰的挂载件复活效果，
   * **改为每60秒复活2艘船**。且**必定会复活干扰舰**」）：
   * - `count`（缺省 1）＝每次上到几艘；实际再受「本波剩余空槽（= 不超本波原编成）」与「可补池」双重封顶；
   * - **优先名单**（`priorityShipIds`，装的是 H 族「墨潮干扰舰」）：名单里的舰只要**在池子里**
   *   （= 阵亡且槽位空着）就**优先占一个名额**（按名单顺序取）；取完再在**剩下的池子**里随机补足；
   *   它活着 / 已补进场（不在池子里）⇒ 名额回落到随机（与"死一个补一个"的上限口径一致）。
   */
  const want = Math.max(1, Math.round(summoner.foeReviveEscort.count ?? 1))
  const room = curFoes.length - aliveSlots.size
  const quota = Math.min(want, room, dead.length)
  if (quota <= 0) return
  const priorityIds = summoner.foeReviveEscort.priorityShipIds ?? []
  const picks: UnitSpec[] = []
  let rest = [...dead]
  for (const shipId of priorityIds) {
    if (picks.length >= quota) break
    const at = rest.findIndex((f) => f.shipId === shipId)
    if (at < 0) continue
    picks.push(rest[at]!)
    rest = rest.filter((_, i) => i !== at)
  }
  while (picks.length < quota && rest.length > 0) {
    const at = nextInt(state.rng, rest.length)
    picks.push(rest[at]!)
    rest = rest.filter((_, i) => i !== at)
  }
  for (const pick of picks) {
    const n = (b.foeReviveCount ?? 0) + 1
    b.foeReviveCount = n
    const spec: UnitSpec = { ...pick, tag: `sup${n}-${pick.tag}` }
    seedUnit(b, spec, {
      enterReload: true,
      // 旧H维持全局入场时刻；C有效时钟按实际推进拍入场，离线不会推迟到整个预算末尾。
      arrivedAtMs: activeClock ? b.lastTickGameMs : state.gameMs,
      ...(b.wormhole ? { foePhaseMs: WORMHOLE_FOE_VOLLEY_STAGGER_MS } : {}),
    })
    // 随新单位补建机群池与修理账本（与波次转场同款；没挂那两件的单位一个键都不建）
    initFoeDronePools(b, [spec])
    initFoeRepairPulses(b, [spec])
    pushBattleNotice(b, `敌方支援舰船入场：${spec.name}`)
    addLog(
      state,
      'warn',
      `⚔ 敌方支援舰船入场：${spec.name}（第 ${n} 次支援）`,
      'core.combat.001',
      { p1: spec.name, p2: n },
    )
  }
}

/**
 * **本波"参战敌阵" = 编成条目 ＋ 已入场的支援舰**（`sup{n}-<原tag>`，见 `resolveFoeRevive`）。
 *
 * 为什么必须有这一层（**2026-09-27 玩家报障**，船长转述：「**增援的敌舰不会攻击也没有效果**」）：
 * `resolveFoeRevive` 是直接 `seedUnit` 进 `battle.units` 的（它不、也不能改 `curFoes` ——
 * 那是编成表，槽位/上限/优先名单全按它算），而**敌人开火、我方选靶、判清波/判胜**三件事
 * 全都只看调用方递进 `stepBattle` 的那份 `foes` ⇒ 支援舰虽然入得了场（有舰影、有血条、
 * 有入场动画），却**一炮不开、谁也打不着它、也不挡清波**——玩家看到的就是"增援入场但毫无作用"。
 *
 * 口径：
 * - **配对靠剥壳回查本波编成**（`baseFoeTag`）：查得到才收（本波召唤的支援舰），查不到
 *   （跨波遗留的尸体/支援舰）一律不收 —— 与"只补当前波"同一条边界；
 * - **一律追加在队尾**，绝不插队：`battle.pdCd` / `pdFocus` 都是**按下标**对齐这份列表的
 *   （见 `resolvePointDefense`），插队会让近防炮冷却与集火锁错位到别的舰上；
 * - 规格由**原条目重建**（`{...base, tag}`）：存档里只有 tag ＋ 血量，规格本来就是这个口径
 *   （换波/读档中断补缺也一样）⇒ **不新增任何存档字段**；
 * - **没挂该件的战斗逐字不变**：`foeReviveCount` 缺省（= 本场一次都没召唤过）直接原样返回，
 *   连数组都不建（与开战/逐拍路径的零变化口径一致）。
 */
export function foesWithSupport(
  b: import('./state').BattleState,
  foes: readonly UnitSpec[],
): UnitSpec[] {
  if (b.foeReviveCount === undefined) return foes as UnitSpec[]
  let extra: UnitSpec[] | null = null
  for (const tag of Object.keys(b.units)) {
    if (!FOE_SUPPORT_TAG_RE.test(tag)) continue
    if (foes.some((f) => f.tag === tag)) continue
    const base = foes.find((f) => f.tag === baseFoeTag(tag))
    if (base === undefined) continue
    ;(extra ??= []).push({ ...base, tag })
  }
  return extra === null ? (foes as UnitSpec[]) : [...foes, ...extra]
}

/**
 * **每拍结算增援入场**（`advanceBattleFor` 主循环内、`stepBattle` **之前**调用——保证"上一拍刚打死的
 * 单位"本拍就能触发援军，且判胜检查看到的是补入后的编队）。
 * - 总开关关闭 → 直接返回（**零行为变化**：此时建档期也根本没写过 `foeReinforceAt`）；
 * - 已入场判定 = `battle.units` 里已有该 tag（含尸体）→ 不重复补入、不需要任何存档字段；
 * - **分支闸门**（2026-09-19「支援呼叫装置」）：带 `foeReinforceBranch` 的条目，只有与
 *   `resolveSupportBranch` 的判定一致才进（另一支本场永不出现）；
 * - 入场单位走 `enterReload` —— 与波次转场同款"一段自然哑火窗口"（≈一次装填时长）；
 * - 到场另推一条**画面提示**（`battle.notices`，与"受击增程"同一处）；
 * - 距离重开：`bal.foeReinforceReopenFrac`（语义同 `waveReopenFrac`；缺省 0 = 原地入场）。
 */
export function resolveReinforcements(
  state: GameState,
  ctx: SimContext,
  b: import('./state').BattleState,
  anomaly: AnomalyDef,
  curFoes: readonly UnitSpec[],
  bal: BattleBalance,
  openM: number,
): void {
  if (bal.foeReinforceEnabled !== true) return
  const supportBranch = resolveSupportBranch(b, curFoes)
  const arrived: UnitSpec[] = []
  let arriveIdx = 0
  for (const spec of curFoes) {
    if (b.units[spec.tag]) continue // 已入场（含已阵亡的尸体）
    // 分支闸门：不属本场判定出来的那一支 ⇒ 本场不再考虑（未判出 = null ⇒ 分支条目一律等待）
    if (spec.foeReinforceBranch !== undefined && spec.foeReinforceBranch !== supportBranch) continue
    const at = spec.foeReinforceAt
    if (!at) continue // 开战即在的常规单位（未写 enterAt）
    if (!reinforceTriggered(at, b, curFoes)) continue
    // 入场窗口与界面动画同源（船长 2026-09-14「动画没结束不开火」）：逐舰错峰；
    // 时刻取**全局时钟**（`state.gameMs`）——与转场那一处同理由（战斗时钟可能落后于全局时钟）
    seedUnit(b, spec, {
      enterReload: true,
      arrivedAtMs: state.gameMs + arriveIdx * BATTLE_ARRIVAL_STAGGER_MS,
      ...(b.wormhole ? { foePhaseMs: arriveIdx * WORMHOLE_FOE_VOLLEY_STAGGER_MS } : {}),
    })
    arriveIdx += 1
    arrived.push(spec)
  }
  if (arrived.length === 0) return
  // **到场提示**（船长 2026-09-19：支援呼叫装置那一批「开战提示 + 到场提示」）——画面顶部提示位，
  // 与"受击增程"同一处；按名归并计数（同一支里同名多艘写成 ×N）
  const byName = new Map<string, number>()
  for (const s of arrived) byName.set(s.name, (byName.get(s.name) ?? 0) + 1)
  pushBattleNotice(
    b,
    `敌方增援抵达：${[...byName].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join('、')}`,
  )
  // 距离重开（2026-09-11 船长口径：沿用 waveReopenFrac 语义，缺省 0 = 不重开）
  const reopen = bal.foeReinforceReopenFrac ?? 0
  if (reopen > 0 && Number.isFinite(openM)) {
    b.distanceM = Math.round(openM * reopen + b.distanceM * (1 - reopen))
  }
  // 近防炮调度补位（与波次转场同款：pdCd 与敌编队同序——增援本身就占着 curFoes 里的位置，
  // 故只需要把它的倒计时置成"下一拍判定"，不必重排整个数组）
  if (b.pdCd && b.dronePools) {
    for (const spec of arrived) {
      const i = curFoes.indexOf(spec)
      if (i >= 0 && i < b.pdCd.length) b.pdCd[i] = Math.max(100, Math.round(bal.pdJudgementMs))
    }
  }
  const waveName = ctx.galaxies.get(anomaly.galaxyId)?.name ?? ''
  const names = [...new Set(arrived.map((s) => s.name))].join('、')
  addLog(
    state,
    'warn',
    `⚔ 敌方增援自远处入场（${waveName ? waveName + "·" : ""}${anomaly.name}）：${names} ×${arrived.length} 加入战斗` +
      `${reopen > 0 ? "，重新接近中。" : "。"}`,
  )
}

/**
 * **当前这一波的敌阵规格**（多波卡的唯一取法）——`tagPrefix` 与波血 `hpShare` 都由波号推。
 *
 * ⚠ **存在的理由（2026-09-24）**：H 族墨潮干扰舰的射程压制按"**本波敌阵**里有没有干扰舰"算，
 * 引擎逐拍走 `specsOf(waveIdx)`，而视图若直接调 `createFoeSpecs(anomaly, bal)`（**默认取第 0 波**）
 * 就会在后续波次里看不到干扰舰 ⇒ **界面射程弧与实际开火门不一致**。两处统一走本函数。
 * 单波卡（无 `waves`）⇒ 与 `createFoeSpecs(anomaly, bal)` 逐字同值（零行为变化）。
 */
export function activeFoeSpecsOf(
  anomaly: AnomalyDef,
  bal: BattleBalance,
  waveIdx: number | undefined,
): UnitSpec[] {
  const waves = anomaly.waves && anomaly.waves.length > 0 ? anomaly.waves : null
  if (!waves) return createFoeSpecs(anomaly, bal)
  const i = Math.min(Math.max(0, waveIdx ?? 0), waves.length - 1)
  const w = waves[i]!
  return createFoeSpecs(anomaly, bal, { units: w.units, hpShare: w.hpShare, tagPrefix: i === 0 ? '' : `w${i}-` })
}

/* ═══════════ 旗舰 BOSS：对母舰的伤害台账（船长 2026-09-24 第二轮令）═══════════
 * 船长原话：「**墨潮入侵母舰我想改成类似BOSS的机制：血量极厚，但是玩家对其造成的伤害会累计…
 * 需要玩家多次战斗后才能击沉。**」＋「**按对母舰造成的伤害决定，如果母舰没有受伤就是0输出。**」
 *
 * 口径：**在战斗状态上直接量**（不新增计数器）——
 * - **满血** = `Σ(hpMax)`：开战那一刻的满值（权威读数，不靠卡面重算）；
 * - **已收** = `Σ(hpMax) − Σ(hp)`：跨波跨场都在同一个 `battle.units` 账本里 ⇒ 逐波切档、逐场重开都不丢；
 * - ⚠ **取原始值**（不做池子截断）；母舰一点没挨打 ⇒ `rawDmg = 0`。
 *
 * 认舰方式 = 单位上的 `foeShipId`（2026-09-24 新增的标记）对上**旗舰卡里登记的舰级 id**。
 * @param cardIds 该族旗舰卡里"算母舰"的舰级 id（调用方从 `ctx.anomalies` 取 `ships[].ship.id`）
 */
export function flagshipBattleLedger(
  battle: import('./state').BattleState,
  cardIds: readonly string[],
): { rawDmg: number; flagshipMaxHp: number; flagshipSeq: number } {
  const ids = new Set(cardIds)
  let rawDmg = 0
  let maxHp = 0
  let seq = 0
  for (const tag of Object.keys(battle.units)) {
    const u = battle.units[tag]!
    if (u.side !== 'foe') continue
    if (u.foeShipId === undefined || !ids.has(u.foeShipId)) continue
    const max = u.hpMax
    if (!max) continue
    const maxSum = max.s + max.a + max.h
    const curSum = u.hp.s + u.hp.a + u.hp.h
    rawDmg += Math.max(0, maxSum - curSum)
    maxHp += maxSum
    seq++
  }
  return { rawDmg: Math.round(rawDmg), flagshipMaxHp: Math.round(maxHp), flagshipSeq: seq }
}
export function createFoeSpecs(anomaly: AnomalyDef, bal: BattleBalance, opts: FoeSpecOpts = {}): UnitSpec[] {
  // 2026-09-11 舰级路径（船长定案「敌舰配置表」）：写了 ships 的卡按**舰级绝对值**建档；
  // 未写的卡走下面的旧"威胁推导"路径，行为逐字不变（试点只转 A 族 6 张）。
  if (anomaly.ships && anomaly.ships.length > 0) {
    const specs = createFoeSpecsFromShips(anomaly, bal, opts)
    if (anomaly.wormholePdTags || anomaly.wormholeRepairScale !== undefined) {
      for (const spec of specs) {
        if (anomaly.wormholePdTags) spec.foePointDefenseEnabled = anomaly.wormholePdTags.includes(spec.tag)
        if (spec.foeRepairPulse && anomaly.wormholeRepairScale !== undefined) spec.foeRepairPulse.k = anomaly.wormholeRepairScale
      }
    }
    return specs
  }
  const tactic = anomaly.tactic ?? 'orbit'
  const split = PROFILE_SPLIT[anomaly.defProfile ?? 'balanced'] ?? PROFILE_SPLIT.balanced!
  const escorts = Math.max(0, Math.min(2, anomaly.escorts ?? 0))
  const waveUnits = Math.max(1, Math.floor(opts.units ?? 1))
  const hpShare = opts.hpShare ?? 1
  const prefix = opts.tagPrefix ?? ''
  const mainThreat = anomaly.threat / (1 + 0.6 * escorts)
  const mainType = pickTopType(anomaly.dmgMix)
  // C4-#3：射程 = 基础带 ×(1 + 侧重×((T−10)/90)) → 封顶（clamp 保持 min < max）
  const rangeBase = TACTIC_RANGE[tactic]!
  const growMul = bal.foeRangeGrowMul[tactic] ?? 0.7
  const growT = Math.min(1, Math.max(0, (anomaly.threat - 10) / 90))
  const cap = bal.foeRangeCapM ?? 15_000
  const rangeMax = Math.min(cap, Math.round(rangeBase.max * (1 + growMul * growT)))
  const rangeMin = Math.max(1, Math.min(rangeMax - 1, Math.round(rangeBase.min * (1 + growMul * growT))))
  // C4-#3：速度 = 参考船速(段) × m_base(threat) × tactic 系数 → cap（≤参考 ×foeSpeedCapMul）
  const refSpeed = foeRefSpeedMps(anomaly.threat, bal)
  const spdCap = Math.round(refSpeed * (bal.foeSpeedCapMul ?? 1.2))
  const tacticSpd = bal.foeSpeedTacticMul[tactic] ?? 1
  const foeSpeed = anomaly.foeSpeedMps ?? Math.min(spdCap, Math.round(refSpeed * foeSpeedBase(anomaly.threat, bal) * tacticSpd))

  const make = (tag: string, name: string, uThreat: number, type: DamageType): UnitSpec => {
    // C4：总血 = 时长曲线反推表值（P1：单卡 foeHpOverride 优先 = 独立标定，脱离曲线）；
    // 多波（2026-09-09）：本波分得 总血 × hpShare，波内按威胁份额分配（主体/僚机 = uThreat/T × 波血）
    const baseHp = (anomaly.foeHpOverride ?? foeHpOfThreat(anomaly.threat, bal)) * hpShare
    const unitHp = (baseHp * uThreat) / Math.max(1, anomaly.threat)
    const totalHp = unitHp
    const hp: Hp3 = { s: totalHp * split.s, a: totalHp * split.a, h: totalHp * split.h }
    const dps = uThreat * bal.foeDpsPerThreat
    // 2026-09-08（船长定：能量=光束必中；动能/爆炸普遍高命中 0.85 + 逐卡低命中特例）：
    // 非能量单发 = DPS×装填 ÷ 有效命中 × foeHitCompMul（回避>0 期望上升的等效补偿，方案 A）；
    // 能量 effHit=1 不消费补偿。
    // ⚠ 2026-09-11 船长裁决「先移除所有逐卡伤害倍率，按照实际算」：原"逐卡等效回退倍率口"
    // （2026-09-08 为能量光束必中化引入）**已退休、字段已从类型上删除**——单发一律按本链
    // **实际推导值**算，不再有等效回退旋钮；要逐卡点名伤害走下面的 `foeShotDmg` 直写。
    const effHit = type === 'plasma' ? 1 : anomaly.foeHitRate ?? bal.foeHitRate
    // 2026-09-10 船长：**基础单发可直接写死**（`foeShotDmg`）——短路"威胁份额 × foeDpsPerThreat × 装填 × 补偿"
    // 这条推导链，用于需要逐卡点名基础伤害的卡（首例 = 深渊之门卫队：推得 90 → 直接定 45）。
    const shotDmg =
      anomaly.foeShotDmg ??
      Math.max(
        1,
        Math.round(((dps * bal.foeReloadMs) / 1000) * (effHit < 1 ? bal.foeHitCompMul / effHit : 1)),
      )
    // 2026-09-10 船长（窝点混伤）：按火力构成拆成逐系单发（Σ = 总单发，敌总伤不变）。
    // 纯系卡只有一条 → 与旧行为完全一致；混伤卡 = 主 60% / 副 40% 两键。
    const shotSplit = splitShotByComposition(shotDmg, foeDamageComposition(anomaly))
    const multiShots: Partial<Record<DamageType, number>> | undefined =
      shotSplit.length > 1
        ? shotSplit.reduce<Partial<Record<DamageType, number>>>((acc, r) => {
            acc[r.type] = (acc[r.type] ?? 0) + r.dmg
            return acc
          }, {})
        : undefined
    return {
      tag,
      name,
      side: 'foe',
      hp,
      resists: {},
      // 舰级闪避（船长 2026-09-16 新舰「劫掠电子舰」：闪避提高）：缺省 0.12 = 既有全部敌舰原值
      evasion: 0.12, // ⚠ 旧「威胁推导」路径没有舰级对象（ship）⇒ 保持原值 0.12（只服务未写 ships 的老卡）
      hitBonus: 0,
      signatureM: Math.max(45, Math.round(60 + totalHp * 0.5)),
      scanResMm: 450,
      speedMps: foeSpeed, // C4-#3 虚拟装配推导（整编队同速；anomaly.foeSpeedMps 覆盖优先）
      agility: 0.3,
      // 高威胁近战敌突进（2026-09-10 船长定）：威胁 ≥ 门槛 且 战术 = brawl 才有资格；
      // ⚠ 船长同日追加：**暂时先取消实装，仅实现功能** → 受 foeChargeEnabled 总开关（默认 false）约束，
      //   开关关闭时不会有任何敌人拿到资格，机制整套保留待启用。
      ...(bal.foeChargeEnabled === true &&
      anomaly.threat >= bal.foeChargeThreatFloor &&
      (anomaly.tactic ?? 'orbit') === 'brawl'
        ? { foeCanCharge: true }
        : {}),
      weapons: [
        {
          label: `${name} 武器组`,
          // 2026-09-08（船长定）：能量（plasma）= 光束必中（开火即中、无视回避），
          // **近盲带保留**（带内威力 ×blindDmgMul）；动能/爆炸 = fixed 命中模型 + 逐卡命中率
          kind: type === 'plasma' ? 'beam' : 'fixed',
          fixedType: type, // 形态/命中/近盲/表现层配色一律按**主系**（混伤只改伤害构成）
          shotDmg,
          // 混伤：逐系单发（真实结算与胜率预估都读它；纯系卡为 undefined）
          ...(multiShots ? { shotsByType: multiShots } : {}),
          maxRangeM: rangeMax,
          minRangeM: rangeMin,
          // V18B：敌人近盲带伤害比例（船长 2026-09-05：与玩家区分——近盲带内不停火、伤害打折）
          blindDmgMul: anomaly.blindDmgMul ?? 0.3,
          hitRate: type === 'plasma' ? 1 : anomaly.foeHitRate ?? bal.foeHitRate,
          falloff: anomaly.foeFalloff ?? bal.foeFalloff,
          reloadMs: bal.foeReloadMs,
        },
      ],
      foeTactic: tactic,
    }
  }
  const specs: UnitSpec[] = []
  for (let k = 0; k < waveUnits; k++) {
    // tag 唯一性（2026-09-09 多波修复）：仅首波第一小队沿用旧命名（foe-0 主 / foe-1.. 僚，
    // 兼容旧 UI/测试的"主+僚"假想）；其余小队（同波第 2 队起）与后续波统一 w{波}-foe-{队} 前缀，
    // 避免与 legacy 僚机 tag（foe-1..n）撞名造成单位覆盖/血条参照错位。
    const legacySquad = prefix === '' && k === 0
    const squadPrefix = legacySquad ? '' : `${prefix === "" ? "w0-" : prefix}`
    const mainTag = legacySquad ? 'foe-0' : `${squadPrefix}foe-${k}`
    specs.push(make(mainTag, foeUnitNameOf(anomaly, mainTag), mainThreat, mainType))
    for (let i = 1; i <= escorts; i++) {
      const escortTag = legacySquad ? `foe-${i}` : `${squadPrefix}foe-${k}-e${i}`
      specs.push(make(escortTag, foeUnitNameOf(anomaly, escortTag), mainThreat * 0.6, mainType))
    }
  }
  return specs
}

/** 主系（权重最高；未写/空 = 动能）——**正权重键才参战**（2026-09-10 语义变更：旧"缺省键权重 1"作废）
 * （2026-10-02 批次 4f 迁到 wormholeFoes.ts） */

const FOE_BEAM_USABLE_SHARE = 0.7

/**
 * 🔴 **闪现演出的时长 = 平衡表旋钮**（**船长 2026-10-02 令**：「**给闪现发生速度做一个旋钮，
 * 我感觉现在可能太短导致看不出来，先将整个过程延长到2000ms**」；同日复测后「**闪现观感上没问题了，
 * 将发生时间回调到400ms进行测试**」）。
 *
 * 两个数都在 `balance.battle` 上（改一处、引擎与界面同时跟随）：
 * - `foeBlinkProcessMs` = **单次闪现的整个动画过程**（UI **三等分**：消失 / 等待（发生时间）/ 出现）；
 * - `foeBlinkGapMs` = **相邻两次闪现的间隔**（排队时一段播完空这么久，下一段才开始）。
 *
 * ⚠ 这两条同时定义**禁火窗口**（船长：「敌舰消失时，玩家的武器不会开火」）——过程调长 = 停火同步变长。
 * ⚠ **取值沿革**：§27 落码时 200ms → 2026-10-02 延到 2000ms（看不出来）→ 同日回调到 **400ms**（实机复测）。
 * 队列总时长 = 段数 × (过程 ＋ 间隔)。
 */
export function blinkProcessMs(bal: BattleBalance): number {
  return Math.max(1, Math.round(bal.foeBlinkProcessMs ?? 200))
}
/** 段与段的间隔（同旋钮；缺省 200ms = 旧口径） */
export function blinkGapMs(bal: BattleBalance): number {
  return Math.max(0, Math.round(bal.foeBlinkGapMs ?? 200))
}

/**
 * 🔴 **一段闪现的三等分**（**船长 2026-10-01 原话**：「**播放动画的同时舰船消失-等待发生时间-在新位置
 * 播放动画同时舰船出现**」）——整个过程 `foeBlinkProcessMs` 平分成三份：
 *
 * | 段 | 占比 | 谁在动 |
 * |---|---|---|
 * | ① 消失 | **1/3** | 舰船淡出（旧位置） |
 * | ② **等待（发生时间）** | **1/3** | 舰船不可见；**位移在这一段的起点兑现**（`moveAtMs`） |
 * | ③ 出现 | **1/3** | 舰船在新位置淡入 |
 *
 * ⚠ **为什么是三等分而不是对半劈**（**2026-10-02 船长实机反馈**）：「**我原先中间插入的发生时间等待
 * 怎么被取消了？**」——对半劈的版本只有"淡出 ＋ 淡入"，**没有中间那段等待**（且位置在触发那刻就换）。
 */
export const BLINK_VANISH_SHARE_NUM = 1
export const BLINK_SHARE_DEN = 3

/**
 * **该敌舰的「决策用最远射程」**——它心里那把尺（**只给站位/期望距离用**，`inRange` 门不吃它）。
 *
 * - **激光武器**（`kind === 'beam'`）：`0.7 ×` 有效射程（后 30% 是它自己认为的无效射程）；
 * - **其余武器**（实弹 `fixed` / 炮台 `gun` / 机群）：原样 = 有效射程（**零行为变化**）。
 *
 * ⚠ 逐武器取 `max`（不是"整船打七折"）：混装敌人只有激光那一条被折（裁定 1）。
 * ⚠ `foeGunMaxRangeOf` 走的是**与开火门同一把尺**（含「受击增程 × 我方电子舰压制」）
 *   —— 这正是裁定 2 要的"当前有效射程"口径。
 */
function foeDecideReachM(
  b: import('./state').BattleState | undefined,
  unit: UnitSpec,
): number {
  let top = 0
  for (const w of unit.weapons) {
    /**
     * **当前有效射程**：传了战斗态 ⇒ 与开火门同一把尺（`foeGunMaxRangeOf`，含「受击增程 × 我方压制」）；
     * 没传（纯函数场合，如 `foeDesiredRange`） ⇒ 按基础射程算 —— 那两道的折算由调用方自己套。
     */
    const reach = b !== undefined ? foeGunMaxRangeOf(b, unit, w) : w.maxRangeM
    top = Math.max(top, w.kind === 'beam' ? Math.round(reach * FOE_BEAM_USABLE_SHARE) : reach)
  }
  return top
}

/** 开战距离 = 双方最大射程 ×factor + 缓冲；缓冲 = max(固定 100m, 最大射程×10%)（船长 2026-09-05：
 * 远程武器不再 100m 即接战，按射程比例拉开，保证开场有可见的接近窗口） */
export function battleOpenM(me: UnitSpec, foes: UnitSpec[], bal: BattleBalance): number {
  let top = 0
  for (const w of me.weapons) top = Math.max(top, w.maxRangeM)
  for (const f of foes) for (const w of f.weapons) top = Math.max(top, w.maxRangeM)
  const pad = Math.max(bal.openRangePadM, Math.round(top * (bal.openRangePadShare ?? 0.1)))
  return Math.round(top * bal.openRangeFactor + pad)
}

/**
 * 🔴 **R 族族格：以「玩家的射程盲区 / 射程线」为期望距离**（**船长 2026-10-01 令**，原话照抄）：
 *
 * > 「这个机制是给敌人用的，是R族以玩家的盲区为期望目标。并不是玩家使用的。等于R族敌人会寻找玩家的
 * > 射程漏洞，玩家如果射程短，则R族采取风筝玩家，玩家射程长、有近盲区，则R族会主动贴身。」
 * > 「**R 族也按照头目/队长算。期望距离优先选择靠近对方最大射程的位置。比如我方4000射程，
 * > 敌人10000射程。优先选择4000更远一点的距离。而不是按照默认的。**」
 * > 「按你推荐」（= 风筝距离取 `我方射程上限 + 100`；多波卡**每波各自取本波第一个 R 族单位**当队长）
 *
 * **队长**（2026-10-01 定案）= **本波编成里第一个 R 族单位**——
 * 与既有引擎"期望距离由 `foes[0]` 决定"同一把尺（`foeDesiredRange` 的 `head = foes[0]`），
 * 只是跳过非 R 族：混编卡里若第一个是别的族，队长仍取**第一个 R 族**（族格的决策者必须是 R 族）。
 * 多波卡**逐波各取自己那一波**的第一个（与既有"每波各自算"一致）。
 *
 * 三类优先级（高 → 低）：
 * 1. **① 风筝（最高）**：队长射程 `capTop > meTop`（它打得比我方远）⇒ 站 **`meTop + 100`**
 *    （就地贴在我方射程线**外侧**：我方刚够不着、它却在自己火力最强的区间）。
 *    ⚠ 这一条是**船长明确纠正**过的取值：早先版本往"队长射程的 8 成"跑（我方 4000 / 它 10000 会站到 8000），
 *    船长要的是**靠近我方最大射程的位置**（⇒ 4100）。
 * 2. **② 钻近盲区**：①不成立、且我方 `0 < meBlindM < meTop` ⇒ 贴到我方近界下沿 `meBlindM − 100`；
 *    "全船都在盲区内"（`meBlindM ≥ meTop`，纯近战装配）⇒ 取 `meTop + 500`。
 * 3. **③ 默认**：都不成立（我方射程 ≥ 队长射程、且我方无近界）⇒ **不覆写**（返回 `null`），
 *    由 `foeDesiredRange` 按队长自己的射程带 ×战术系数算。
 *
 * 用途三层：① 写进各 R 族单位的 `foeDesireRangeM`（`foeDesiredRange` 读它 ⇒ 逐拍走位按它拉扯）；
 * ② **本场目标交战距离**（`battle.myDesireM`）；③ 放在 `if (wormhole) / else` **之外** ⇒ 洞内洞外都生效。
 * **非 R 族 `null` ⇒ 整段不执行、逐字走原口径。**
 */
export function rFamilyDesireOf(
  me: UnitSpec,
  foes: readonly UnitSpec[],
  bal: BattleBalance,
  /**
   * **战斗态（可选）**——传了就吃「挨打增程」后的有效射程（与开火链同一把尺，船长 2026-10-01 裁定 2：
   * 有效射程的基准 = **当前**有效射程）；不传 = 只按"基础射程 × 我方电子舰压制"算（老调用点零改动）。
   */
  b?: import('./state').BattleState,
): number | null {
  let meTop = 0
  let meBlindM = 0
  for (const w of me.weapons) {
    meTop = Math.max(meTop, w.maxRangeM)
    meBlindM = Math.max(meBlindM, w.minRangeM ?? 0)
  }
  if (meTop <= 0) return null
  // **队长 = 本波编成里第一个 R 族单位**（跳过其它族；一族都没有 ⇒ 本函数不介入）
  const cap = foes.find((f) => f.family === 'R')
  if (!cap) return null
  /**
   * 队长的射程：**决策用「有效射程」**（**船长 2026-10-01 令**，见 `FOE_BEAM_USABLE_SHARE`）——
   * R 族五档全是激光（`energyForm: 'beam'`）⇒ 这里取的就是 `0.7 × 当前有效射程`。
   * ⚠ 只影响 **①风筝的"够不够得着"判定**；风筝的**落点**仍是 `meTop + 100`（贴的是**我方**射程线，
   *   与它自己射程多长无关）。⇒ 效果 = 它更不容易选择"站到你射程线外侧"，转而走 ②/③。
   */
  const capTop = foeDecideReachM(b, cap as UnitSpec)
  if (capTop <= 0) return null
  const floor = bal.minDistanceM
  /** ⚠ 钳制上限用**原始射程带**（不是 `capTop`）：允许族格把它压进"它自己的无效射程"里 */
  const capReachRaw = Math.max(cap.foeRangeBand?.max ?? 0, ...cap.weapons.map((w) => w.maxRangeM))
  const clampTo = (v: number): number => Math.max(floor, Math.min(Math.round(v), capReachRaw))
  // ① 风筝（最高优先）：队长打得比我方远 ⇒ 贴到我方射程线外侧
  if (capTop > meTop) return clampTo(meTop + 100)
  // ② 钻近盲区：贴到我方近界的下沿（纯近战装配 ⇒ 站到我方射程之外）
  if (meBlindM > 0) {
    return clampTo(meBlindM < meTop ? Math.max(floor, meBlindM - 100) : meTop + 500)
  }
  // ③ 都没有 ⇒ 不覆写（走默认期望距离）
  return null
}

/**
 * **战场远端的距离上限**（2026-09-19 船长裁定「甲」）。
 *
 * 由来：船长报「部分敌人会增加射程的情况下，战场可以移动的距离还是很短，**无法逃离对方射程**」，
 * 并定口径「**计算战场宽度时考虑到技能的增程就行，不用直接乘**」⇒ 本函数**沿用 `battleOpenM`
 * 那套"射程 + 10% 缓冲"公式**（不引入任何常数放大），但两处不同：
 * 1. **取"当前"射程**——我方那一侧已含技能 / 装配 / 谜质科技的增程（每拍重建的规格带的），
 *    敌方那一侧读**受击增程生效后**的有效射程（`foeGunMaxRangeOf` / `foeDroneRangeOf`，
 *    与开火门同一把尺），不再用开战那一刻的旧值；
 * 2. **只增不减**——`开战距离` 是地板 ⇒ 没有增程时**逐字等于旧行为**（`maxM === openM`）。
 *
 * 例（本批实测）：导弹残段基础 11,000m ⇒ 开战距离 12,100m；它挨打增程后射程 16,500m
 * ⇒ 上限抬到 **18,150m** ⇒ 玩家重新退得到它射程之外（改前上限钉在 12,100m，退不出去）。
 *
 * ⚠ 上限只由"双方射程"决定，**与谁快谁慢无关**：能不能真的站到那么远，仍看每拍那场
 * 速度拔河（`steerStep` 双方各拽一把）——所以"有地方可退" ≠ "一定退得掉"。
 *
 * ⚠ **2026-09-22 船长令（本次修正）**：「**虫洞内交战距离上限不应该只看玩家操作的舰船和敌人，
 * 应该将队伍里所有舰船都考虑到。**」⇒ 新增可选入参 `ours`（我队**全队**规格）；
 * **"远端"（`top`）遍历全队的最远武器射程**，而 **`open`（开战距离）仍只按主控**（船长明确：
 * 要改的是距离上限，不是初始距离/期望距离）。不传 `ours` ⇒ **逐字等于旧行为**（老调用零改动）。
 */
export function battleMaxDistanceM(
  b: import('./state').BattleState,
  me: UnitSpec,
  foes: readonly UnitSpec[],
  bal: BattleBalance,
  /**
   * 我队**全队**（含 `me` 本身也无妨，取 max 幂等）——2026-09-22 船长令：
   * 战场距离上限要把僚舰的射程一并算进去（原先只看主控 ⇒ 僚机装远射武器也拉不开战场）。
   */
  ours?: readonly UnitSpec[],
): number {
  const open = battleOpenM(me, foes as UnitSpec[], bal)
  let top = 0
  for (const w of me.weapons) top = Math.max(top, w.maxRangeM)
  /** 全队（船长令）：任一僚舰射程更远 ⇒ 战场远端随之抬高 */
  for (const u of ours ?? []) for (const w of u.weapons) top = Math.max(top, w.maxRangeM)
  for (const f of foes) {
    // 机群武器也在这张表里（`src === 'drone'`）⇒ 按**各自的增程/削减口径**取有效射程，别混用炮台那条
    for (const w of f.weapons) {
      top = Math.max(top, w.src === 'drone' ? foeDroneRangeOf(b, w) : foeGunMaxRangeOf(b, f, w))
    }
  }
  const pad = Math.max(bal.openRangePadM, Math.round(top * (bal.openRangePadShare ?? 0.1)))
  return Math.max(open, Math.round(top * bal.openRangeFactor + pad))
}

/** **玩家主武器（战术距离口径；船长 2026-09-12 裁定「甲」）** = **射程最远的武器**；
 *  并列射程时取**名义火力大的**（再并列保持武器表顺序）。**三按钮（贴脸/中距/风筝）、出发前战术、
 *  战斗界面「我方射程带」共用这一处**。
 *
 *  为什么改（玩家报障「战斗界面下方的快速选择贴脸/中距/风筝，现在的距离不正确」）：
 *  旧口径 `weapons.find(w => w.kind === 'gun') ?? weapons[0]` 有两处系统性取错——
 *  **激光是 `beam`、基础舰炮是 `fixed`，都不算 `gun`** ⇒ 纯激光/无人机船回落到恒在的「基础舰炮」(2,500m)；
 *  **近防炮是 `gun`（2,500m）** ⇒ 装了它的船一律被 PD 抢位。实测（真数据真引擎）：
 *  激光船（主武器 4,600m）三按钮 **200/1250/2375 → 200/2300/4370**、
 *  近防炮 + 导弹架 MK2（11,760m）**200/1251/2375 → 540/6330/11172**；
 *  炮台船与纯导弹船一字不变（旧口径恰好取对）；战斗界面「我方射程带」随之从
 *  「基础舰炮 0~2500」/「近防炮 1~2500」修正为真实主武器射程带。 */
export function mainWeaponOf(me: UnitSpec): WeaponSpec | undefined {
  let best: WeaponSpec | undefined
  let bestDps = -1
  for (const w of me.weapons) {
    if (best === undefined || w.maxRangeM > best.maxRangeM) {
      best = w
      bestDps = nominalWeaponDps(w)
    } else if (w.maxRangeM === best.maxRangeM) {
      const d = nominalWeaponDps(w)
      if (d > bestDps) {
        best = w
        bestDps = d
      }
    }
  }
  return best
}

/** 名义单发/秒（并列射程时的取舍依据；与装配页 `rawDpsOf` 同口径）：
 *  炮台取首弹种单发、其余取 `shotDmg`，乘门数除以装填秒。 */
export function nominalWeaponDps(w: WeaponSpec): number {
  const per = w.kind === 'gun' ? (Object.values(w.shotsByType ?? {})[0] ?? 0) : (w.shotDmg ?? 0)
  return (per * (w.count ?? 1)) / Math.max(0.1, w.reloadMs / 1000)
}

/** 玩家战术期望距离（贴脸/中距/风筝）。
 * "主武器" = **射程最远的武器**（见 `mainWeaponOf`）。
 *
 * ⚠ **中距档 = 射程带内的位置**（2026-09-15 船长两次裁定）：缺省 = `bal.desireBandMid`（**0.8 = 射程带高位**），
 * **星图与洞内同值**（当天先落成"星图 0.8 / 洞内 0.5"分档，船长更正「这个是我口误，可以回滚那句」⇒ 取消分档）。
 * 起因＝玩家报「赏金任务一开始就在近距离、对远程武器不利」：开战那一瞬其实是最远的（16,368 m），
 * 真正"近"的是稳态期望（旧口径中点 = 射程的 54%），战斗 ~30 秒后必然收拢到那里。
 * ⚠ **洞内"近战怪开局距离"另走 `bal.wormholeBrawlOpenBand`（0.5）**，见 `startFleetBattleFor` 的洞内分支。
 * 贴脸 / 风筝两档是固定位置，不受 `midPos` 影响。 */
export function desiredRangeFor(
  me: UnitSpec,
  tactic: 'assault' | 'mid' | 'kite',
  bal: BattleBalance,
  midPos = bal.desireBandMid,
): number {
  const main = mainWeaponOf(me) ?? me.weapons[0]
  const mainMin = main ? main.minRangeM : 0
  const mainMax = main ? main.maxRangeM : 0
  if (tactic === 'assault') return Math.max(bal.minDistanceM, Math.round(mainMin * 0.6))
  if (tactic === 'kite') return Math.max(bal.minDistanceM + 1, Math.round(mainMax * 0.95))
  // mid：有效射程带内的位置（缺省中点；钳到 0~1 免得数据写坏时飞出射程带）
  const pos = Math.min(1, Math.max(0, midPos))
  return Math.max(bal.minDistanceM, Math.round(mainMin + (mainMax - mainMin) * pos))
}

/**
 * 敌方编队期望交战距离。
 *
 * **2026-09-11 船长裁决②（本函数的口径修正）**：**战术只决定"带内的偏好位置"，带由单位自己决定**。
 * - **舰级路径**（写了 `AnomalyDef.ships` 的卡）：带 = **该单位自己的有效射程带**
 *   （`foeRangeBand`，含条目 `rangeMul`/`rangeMinM`/`rangeMaxM` 覆写后的绝对值）。
 * - **旧威胁推导路径**：带 = 全局战术表 `TACTIC_RANGE[战术]`——**一字不动**
 *   （旧路径的"射程带与期望交距同源"本来是自洽的，故不修）。
 *
 * **动机（实测）**：旧口径把带写死成旧表的绝对区间，于是"敌人想站的位置"与"敌人打得到的距离"脱钩：
 * 快艇（1~1883m）被要求站 440m 还凑合，但狙击舰（1255~9619m）按 kite 站 8000m、按 orbit 站 2688m
 * 都可能**站在自己射程之外**；反过来慢速玩家追不上 → 双方都够不着 → 打满 600s 判负
 * （演习场/新港裸船实测；见 `docs/design/p0-foe-desired-range-20260911.md`）。
 *
 * **与旧口径的可比映射**（同一张 `tacticDesireFactor`，只把带换成"自己的带"）：
 * 期望交距 = `自己带.min + factor[战术] × (自己带.max − 自己带.min)`，
 * 其中 factor 沿用旧口径的**相对位置**语义（brawl 0.20 靠带内近端 / orbit 0.55 居中 / kite 0.85 贴远端）。
 * 取值依据 = **保持"带内相对位置"这一层语义不变**，只让"带"随舰级伸缩（船长口径：
 * 「射程和战术仅仅的弱相关，并不实时强绑定」）。A 族实测差异举例：
 * 快艇 440 → **377m**、护卫舰 2688 → **2498m**、狙击舰 8000 → **8364/8885/10102m**、
 * B 小艇 2688 → **1210m**（后者正是"教学卡敌人一炮未放/双方锁死"的解）。
 *
 * **混编卡取哪一个单位**：取 `foes[0]`（卡上**首个主体单位**，与既有"战术取自 foes[0]"一致）。
 * 需要让头目站得与杂鱼一致（或不同）时，用条目 `rangeMinM`/`rangeMaxM` 覆写（"同卡同带"，
 * A 族四张 kite 卡已用此旋钮把 60% 的头目火力救回来）——**不引入加权平均**（避免"谁都不到位的中间值"）。
 */
/**
 * 🔴 **激光敌人的「有效射程」占比**（**船长 2026-10-01 令**，原话照抄）：
 *
 * > 「**添加新的敌人规则，所有使用激光的敌人，其射程的前70%视作有效射程，后30%视作无效射程，
 * > 考虑各种情况时，忽略无效射程。比如在选择期望距离时，只根据有效射程来选择。
 * > 但是开火战斗还是按照全射程来开火。**」
 *
 * ⇒ **只影响"它想站多远"（决策），不影响"它能不能打到你"（开火）**：
 * 射程的**前 70% = 有效**、**后 30% = 无效**；凡是"考虑站位/期望距离"的场合按**有效**算，
 * 而 `inRange` 门、远端衰减、命中与伤害结算**一律仍按全射程**。
 *
 * **同日四条裁定**（船长逐条答复）：
 * 1. **按武器认**：只看**那条激光武器**（`kind === 'beam'`）⇒ 混装的实弹武器照旧按全射程；
 * 2. **基准 = 当前有效射程**：先走完既有的「挨打增程」「我方电子舰射程压制」，**再 ×0.7**
 *    （⇒ 静滞卫挨打增程 8,000→12,000 时，有效射程 5,600→8,400：**增程仍全额是收益**）；
 * 3. **只改期望距离**（走位/站位）——开场距离、胜率预估、界面显示**都不动**；
 * 4. **战场远界照最大射程**（`battleMaxDistanceM` 一行不改）。
 *
 * ⚠ 船长同日的纠正（记下来免得再想歪）：「**你说的副作用实际上不存在，因为开火射程没有变，
 * 正常情况下只影响期望距离。**」——所以这不是"削弱激光敌人"，而是**改变它选位**。
 */

export function foeDesiredRange(
  _me: UnitSpec,
  foes: UnitSpec[],
  bal: BattleBalance,
  /**
   * **我方电子舰对敌舰射程的削减率**（缺省 0 = 旧口径，逐字不变）。
   *
   * **船长 2026-09-18：「削减射程后，敌人的期望距离也要随之改变」** ⇒ 敌人**主动压近**以恢复火线：
   * 把射程带的上界换成"**只被削减后**的有效上界"（`foeRangeWithDebuff(band.max, 1, r)`），
   * 再在**有效带**里取同一相对位置（band 路径）；显式钉住的期望距离（`foeDesireRangeM`）
   * 按同一比例 `有效上界 ÷ 原上界` 收缩。
   *
   * ⚠ **只随「削减」变化，「受击增程」照旧不改期望距离**（2026-09-12 既有口径：增程让它够得更远、
   * 不必挪窝）——所以这里的倍率固定传 1，不读 `foeGunRangeBuff`。
   */
  foeRangeDebuffR = 0,
  battle?: import('./state').BattleState,
): number {
  const acidRoster = battle !== undefined && foes.some(f => f.acidBurst)
  if (acidRoster && foes.some(f => f.acidBurst && isAlive(battle!, f.tag))) return bal.minDistanceM
  const head = acidRoster ? foes.find(f => isAlive(battle!, f.tag)) : foes[0]
  // **期望距离覆写优先**（船长 2026-09-11 E 族：「战术调整、期望距离不改」）
  const pinned = head?.foeDesireRangeM
  // 舰级路径：带 = 自己的有效射程带；旧路径：带 = 全局战术表（原样）
  const band = head?.foeRangeBand ?? TACTIC_RANGE[head?.foeTactic ?? 'orbit']!
  // **削减后的有效上界**（只吃削减、不吃增程；基础 <3000m 或没有电子舰 ⇒ 等于原上界）
  const effMax = foeRangeDebuffR > 0 ? foeRangeWithDebuff(band.max, 1, foeRangeDebuffR) : band.max
  /**
   * 🔴 **激光敌人：选位只看「有效射程」（前 70%）**（**船长 2026-10-01 令**，见 `FOE_BEAM_USABLE_SHARE`）。
   *
   * 本函数是**纯函数**（不读战斗态）⇒ 只能按"**基础射程 × 削减**"折算 0.7，
   * **不叠加**"挨打增程"（那条要读 `BattleState.foeGunRangeBuff`，而它只在**开火**链上生效）。
   * 结果 = 没有增程的场合与 `foeDecideReachM` **完全一致**；有增程时这里略保守（不放大）。
   *
   * ⚠ 射程带的 **`min` 不动**：近界不是"打不着的远端"，把它折 0.7 反而凭空造出一个近盲区。
   * ⚠ 返回值的**上限钳制仍是原始 `effMax`** ⇒ 允许它站到自己的"无效射程"里
   *   （那是"族格/盲区把它压过去的位置"，不是"它自己想要的位置"）。
   */
  const isBeam = head !== undefined && head.weapons.some((w) => w.kind === 'beam')
  const decideMax = isBeam ? Math.round(effMax * FOE_BEAM_USABLE_SHARE) : effMax
  if (pinned !== undefined && Number.isFinite(pinned)) {
    const ratio = band.max > 0 ? decideMax / band.max : 1
    return Math.max(bal.minDistanceM, Math.round(pinned * ratio))
  }
  const pos = clamp(0.05, 0.95, bal.tacticDesireFactor[head?.foeTactic ?? 'orbit'] ?? 0.5)
  return Math.max(bal.minDistanceM, Math.min(effMax, Math.round(band.min + pos * (decideMax - band.min))))
}


/** （2026-10-02 批次 4h：船体维修装置/护盾脉冲整簇迁到 combatRepair.ts，本文件借回 + 再导出） */

export function createBattleState(
  me: UnitSpec,
  foes: UnitSpec[],
  nowMs: number,
  myDesireM: number,
  /**
   * **僚舰**（虫洞 D 批 · 船长 2026-09-13：一场战斗最多 4 艘我方同时参战）。
   * 缺省 `[]` = **单船路径**（既有 27 张悬赏卡 / 低安遭遇 / AI 副船全走这一档）⇒ 建档内容与
   * 改动前逐字一致（`units` 多出的键只可能是这里传进来的僚舰）。
   */
  myAllies: readonly UnitSpec[] = [],
): import('./state').BattleState {
  const units: Record<string, import('./state').BattleState['units'][string]> = {}
  /**
   * **本场敌方挂载件名**（2026-09-16 船长「要：敌舰悬停/战报展示挂载件」）。
   * ⚠ **开战首波是内联播种**（本函数不走 `seedUnit`）——首版只在 `seedUnit` 里累积 ⇒
   * **单波战斗的战报/悬停看不到敌方挂载件**（多波/增援才看得到）；这里补上首波这一份。
   */
  const foeMounts: string[] = []
  /**
   * **同序的「双语名对」**（2026-09-24）：与 `foeMounts` **下标对齐**、按**中文名**去重
   * （与上一行的去重键同一把尺）——显示层按当前语言挑一列，见 `BattleScreen.mountNamesTextOf`。
   */
  const foeMountPairs: Array<readonly [string, string]> = []
  for (const spec of [me, ...myAllies, ...foes]) {
    // 单波次内增援（2026-09-11 船长裁决：机制实现、不启用）：**带入场触发的单位不进开战编队**，
    // 由 `advanceBattleFor` 每拍按条件补入。开关关闭时建档期根本不写 `foeReinforceAt` → 本行永不命中。
    if (spec.foeReinforceAt) continue
    if (spec.side === 'foe') {
      const names = spec.foeMountNames ?? []
      const pairs = spec.foeMountNamePairs ?? []
      for (let i = 0; i < names.length; i++) {
        const n = names[i]!
        if (foeMounts.includes(n)) continue
        foeMounts.push(n)
        foeMountPairs.push(pairs[i] ?? [n, n])
      }
    }
    units[spec.tag] = {
      tag: spec.tag,
      side: spec.side,
      name: spec.name,
      hp: { s: spec.hp.s, a: spec.hp.a, h: spec.hp.h },
      hpMax: { s: spec.hp.s, a: spec.hp.a, h: spec.hp.h },
      // **舰级 id**（2026-09-24）：首波内联播种同样要带上（`flagshipBattleLedger` 认母舰靠它）
      ...(spec.foeShipId !== undefined ? { foeShipId: spec.foeShipId } : {}),
      weapons: spec.weapons.map(() => 0),
      /**
       * **隐秘行动装置**（2026-09-15 船长）：开战那一刻起窗——`stealthMs` 由 `createPlayerSpec` 写
       * （装了装置**且未装推进器**才有值）。**只有装了装置的那一艘写本字段**（Q3 甲）⇒
       * 编队其余船、未装装置的场次、敌舰一律零变化。
       */
      ...(spec.stealthMs !== undefined && spec.stealthMs > 0
        ? { stealthUntilMs: nowMs + spec.stealthMs }
        : {}),
    }
  }
  return {
    startedAtGameMs: nowMs,
    lastTickGameMs: nowMs,
    distanceM: 0, // 由调用方按 battleOpenM 赋值
    myDesireM,
    units,
    // 开战首波登记下来的敌方挂载件（没挂 = 不写键 ⇒ 老档/无挂载场次零变化）
    ...(foeMounts.length > 0 ? { foeMounts } : {}),
    ...(foeMountPairs.length > 0 ? { foeMountNamePairs: foeMountPairs } : {}),
    ammo: { kin: 0, exp: 0, pla: 0 },
    stats: { meShots: 0, meHits: 0, meDmg: 0, foeShots: 0, foeHits: 0 },
    fx: [],
    fxSeq: 0,
    ended: null,
    /**
     * **逐舰状态表开场即建空表**（2026-09-16 船长「将缺少的一并实现」）：
     * 近防炮的**反应式令牌**与**集火锁**都改为按 `舰tag`（锁再加武器下标）分账。
     * 建空表 = 新战斗一律走逐舰路径；**旧字段**（`droneHitAt` / `mePdFocus`）只服务
     * "本改动之前开的在途战斗"（运行态字段、不随档 ⇒ 零迁移）。
     */
    droneHitAtMeBy: {},
    mePdFocusBy: {},
  }
}

/**
 * **开战公告：隐秘行动装置启动**（2026-09-15 船长 · Q6 甲 = 不新增界面，只走战斗内那一条提示）。
 *
 * 落点口径照 2026-09-11 船长的机制提示纪律：「**日志内不用显示提示，将该提示放入战斗画面内显示**
 * （和敌方增援统一下系统，显示位置改为战斗窗口正上方）」⇒ 走 `pushBattleNotice`（画面顶部提示位，
 * 与「敌方增援」「受击增程」同一处），**不写 `addLog`**。
 * 只在**真的有窗口**时推（未装装置的场次一条都不推 ⇒ 既有读数零变化）。
 */
export function announceStealthStart(b: import('./state').BattleState): void {
  for (const u of Object.values(b.units)) {
    if (u.side !== 'me' || u.stealthUntilMs === undefined) continue
    const sec = Math.max(0, Math.round((u.stealthUntilMs - b.lastTickGameMs) / 1000))
    pushBattleNotice(b, `隐秘行动：${u.name} 进入隐身（${sec} 秒内不被锁定、不被攻击）`)
  }
}

/**
 * **开战提示：敌方呼叫增援**（船长 2026-09-19「支援呼叫装置」批：「**战斗开始20秒后，增援2艘幽灵舰。
 * 如果对方在自己最远射程之外时，增援2艘静滞卫舰。**」）——同 `announceStealthStart` 的口径：
 * 只走**画面顶部提示位**（`battle.notices`，与"敌方增援/受击增程"同一处），不写 `addLog`。
 * 没挂该件的场次一条都不推 ⇒ 既有读数零变化。
 */
export function announceSupportCallStart(
  b: import('./state').BattleState,
  foes: readonly UnitSpec[],
): void {
  const caller = foes.find((f) => f.foeSupportCall !== undefined)
  if (caller === undefined || caller.foeSupportCall === undefined) return
  const sec = Math.max(0, Math.round(caller.foeSupportCall.delaySec))
  pushBattleNotice(b, `敌方呼叫增援：${sec} 秒后抵达`)
}

/** 按规格把单位补入战斗（多波续刷/读档补缺用；已存在（含 hp 归零的尸体）不覆盖）。
 * enterReload（2026-09-09 波次转场）：增援单位入场需先完成一轮装填（weapons 满倒计时）
 * 才开火——给"增援抵达"一段自然哑火窗口（≈一次装填时长），不改变任何结算语义。 */
/**
 * **入场播种**（船长 2026-09-14：「①乙，初始不可开火，且对洞内洞外都生效」「③补。并且参考①动画没结束不开火」）。
 *
 * 只给**有入场动画**的单位写 `enteredAtMs`（洞内首波敌方跃迁入场 / 每一次波次转场与单波内增援）：
 * - `idx` = 该舰在本批入场里的序（0 起）⇒ 入场时刻含逐舰错峰，与界面 `--arrive-delay` 同一算式；
 * - **它自己的首发也推到窗口之后**：装填取"窗口时长"与自身装填的**较大者**
 *   （波次转场/增援本来就带 `enterReload`，只有"洞内首波原本满装填"这一档会因此变慢）；
 * - `enterReload` 语义不变（`true` = 至少一个自身装填周期）。
 */
export function seedUnit(
  b: import('./state').BattleState,
  spec: UnitSpec,
  opts: { enterReload?: boolean; arrivedAtMs?: number; foePhaseMs?: number } = {},
): void {
  if (b.units[spec.tag]) return
  // **本场敌方挂载件名**（2026-09-16 船长「要：敌舰悬停/战报展示挂载件」）：所有单位都经这里入场
  // （开战首波 / 波次转场 / 增援）⇒ 累积一份"本场出现过"的清单给战报用（运行期字段、不入档）。
  // ⚠ **2026-09-24 起同一份清单带「双语名对」**（键同为中文名 ⇒ 两条数组**下标恒对齐**，
  // 显示层按语言挑一列）；`foeMountNames` 与 `foeMountNamePairs` 缺一不可地一起维护。
  if (spec.side === 'foe' && spec.foeMountNames && spec.foeMountNames.length > 0) {
    const set = new Set(b.foeMounts ?? [])
    const pairs = new Map<string, readonly [string, string]>()
    const oldNames = b.foeMounts ?? []
    const oldPairs = b.foeMountNamePairs ?? []
    for (let i = 0; i < oldNames.length; i++) pairs.set(oldNames[i]!, oldPairs[i] ?? [oldNames[i]!, oldNames[i]!])
    const specPairs = spec.foeMountNamePairs ?? []
    for (let i = 0; i < spec.foeMountNames.length; i++) {
      const n = spec.foeMountNames[i]!
      set.add(n)
      if (!pairs.has(n)) pairs.set(n, specPairs[i] ?? [n, n])
    }
    const merged = [...set]
    b.foeMounts = merged
    b.foeMountNamePairs = merged.map((n) => pairs.get(n) ?? [n, n])
  }
  const windowMs = opts.arrivedAtMs !== undefined ? BATTLE_ARRIVAL_FLY_MS : 0
  /** 首轮相位错开（洞内专属；见 `WORMHOLE_FOE_VOLLEY_STAGGER_MS`）——洞外调用方一律不传 ⇒ 0 */
  const phase = opts.foePhaseMs ?? 0
  b.units[spec.tag] = {
    tag: spec.tag,
    side: spec.side,
    name: spec.name,
    hp: { s: spec.hp.s, a: spec.hp.a, h: spec.hp.h },
    hpMax: { s: spec.hp.s, a: spec.hp.a, h: spec.hp.h },
    ...(spec.foeShipId !== undefined ? { foeShipId: spec.foeShipId } : {}),
    weapons: opts.enterReload
      ? spec.weapons.map((w) => Math.max(1, w.reloadMs, windowMs) + phase)
      : spec.weapons.map(() => phase),
    ...(opts.arrivedAtMs !== undefined ? { enteredAtMs: opts.arrivedAtMs } : {}),
  }
}

/**
 * **建敌机生存池**（2026-09-11 机群批）——按**敌单位 tag** 索引；池数组与本单位 `src:'drone'`
 * 武器条目**同序**（`slot` 顺序、每条展开 `count` 架，与 `createFoeSpecsFromShips` 的展开顺序一致）。
 *
 * - 三层血 / 抗性 / 回避取自**机型表**（`FoeDroneDef.defense`，绝对值）；我方无人机线技能
 *   （耐久学/强化学/规避学）**只作用于我方机群**，敌机不吃——族格由机型表定死，与玩家技能无关；
 * - **开战与每次换波都调用**（每波单位是新对象、tag 也不同 ⇒ 旧波的池自然作废）；
 * - **无 `foeDrones` 的单位不建池**；全场都没有 ⇒ 本字段不写（既有战斗零行为变化）。
 * （2026-10-02 批次 4l 从 combat.ts 迁来：combat 的 advanceBattleFor 仍要调用，转公开）
 */
export function initFoeDronePools(
  b: import('./state').BattleState,
  foes: readonly UnitSpec[],
): void {
  const pools: Record<string, import('./state').DronePoolEntry[]> = {}
  for (const f of foes) {
    const slots = f.foeDrones
    if (!slots || slots.length === 0) continue
    const list: import('./state').DronePoolEntry[] = []
    const mk = (
      d: (typeof slots)[number]['drone']['defense'],
      artId: string,
      inHangar: boolean,
    ): import('./state').DronePoolEntry => {
      const resists = {
        ...(d.shieldResist ? { shield: d.shieldResist } : {}),
        ...(d.armorResist ? { armor: d.armorResist } : {}),
        ...(d.hullResist ? { hull: d.hullResist } : {}),
      }
      const s = Math.max(1, Math.round(d.shieldHp))
      const a = Math.max(1, Math.round(d.armorHp))
      const h = Math.max(1, Math.round(d.hullHp))
      return {
        s,
        a,
        h,
        alive: true,
        artId,
        evasion: clamp(0, 0.9, d.evasion ?? 0),
        ...(Object.keys(resists).length > 0 ? { resists } : {}),
        // 满血三层值（备用机补位按此放出）；缺省字段仅供新档，旧档缺省即视为"当前血 = 满血"
        maxS: s,
        maxA: a,
        maxH: h,
        ...(inHangar ? { inHangar: true } : {}),
      }
    }
    for (const ds of slots)
      for (let k = 0; k < Math.max(0, Math.round(ds.count)); k++)
        list.push(mk(ds.drone.defense, ds.drone.id, false))
    // **备用机库**（2026-09-12）：同机型的额外条目，开局全部在库（不出战、不开火、不计存活架数）
    const reserve = f.foeDroneReserve
    const reserveModel = slots[0]?.drone
    if (reserve && reserveModel)
      for (let k = 0; k < Math.max(0, Math.round(reserve.count)); k++)
        list.push(mk(reserveModel.defense, reserveModel.id, true))
    if (list.length > 0) pools[f.tag] = list
  }
  if (Object.keys(pools).length > 0) b.foeDronePools = pools
}

/**
 * **建档「船体修理装置」逐单位账本**（船长 2026-09-24；挂件参数见 `FoeMountDef.repairPulse`）。
 *
 * 幂等：**只为"挂了这件、且账本里还没有"的单位补一条**（首跳 = 开战时刻 + `everyMs`）——
 * 已存在的账本**原样保留**（战中的波次转场、增援入场、逐拍重建都不会把计时重置 ⇒ 不会白赚一跳）。
 * 没有任何单位挂这件时**一个键都不建**（`battle.foeRepairPulses` 保持缺省 ⇒ tick 里那块直接跳过）。
 * （2026-10-02 批次 4l 从 combat.ts 迁来：combat 的 advanceBattleFor 仍要调用，转公开）
 */
export function initFoeRepairPulses(
  b: import('./state').BattleState,
  foes: readonly UnitSpec[],
): void {
  const need = foes.filter((f) => f.foeRepairPulse !== undefined)
  if (need.length === 0) return
  const ledgers = b.foeRepairPulses ?? {}
  let added = false
  for (const f of need) {
    if (ledgers[f.tag]) continue
    ledgers[f.tag] = {
      nextPulseAtMs: b.startedAtGameMs + Math.max(1, Math.round(f.foeRepairPulse!.everyMs)),
      pulses: 0,
      healed: 0,
    }
    added = true
  }
  if (added) b.foeRepairPulses = ledgers
}

/**
 * **挂载件「船体修理装置」的威胁归一基准**（船长 2026-09-24 追问裁定的原话口径「**k = 该层威胁 ÷ 45**」）
 * ——45 = 第 1 层基准威胁（`wormholeFoes.WORMHOLE_THREAT_BASE`）⇒ **层 1 的 k = 1.00**，
 * 正是船长定这条时说的"归一基准「不改动」"。消费点只有一处：`createFoeSpecsFromShips` 写
 * `UnitSpec.foeRepairPulse.k`（详见 `FoeMountDef.repairPulse`）。
 *
 * ⚠ **这里是字面量、不从 `wormholeFoes` import**（2026-09-24 实测踩到的坑）：`wormholeFoes` 自己
 * `import { foeDamageComposition } from './combat'` ⇒ 两个模块**互相依赖**，而本常量在 `combat` 的
 * **顶层**求值 ⇒ 走 `content:check`（CJS 转译）时命中
 * `ReferenceError: Cannot access 'WORMHOLE_THREAT_BASE' before initialization`。
 * 一致性由下一行的**类型级校验**钉住（两处不等 ⇒ `typecheck` 当场红，不改数值就不会漂）。
 * （2026-10-02 批次 4l 随敌群建档簇迁到本文件；combat 借回 + 再导出）
 */
export const FOE_REPAIR_THREAT_REF = 45
/** 编译期一致性校验：与 `wormholeFoes.WORMHOLE_THREAT_BASE` 必须逐字相等（不等则本行类型报错） */
const _FOE_REPAIR_THREAT_REF_IN_SYNC: 45 extends typeof WORMHOLE_THREAT_BASE
  ? typeof WORMHOLE_THREAT_BASE extends 45
    ? true
    : never
  : never = true
void _FOE_REPAIR_THREAT_REF_IN_SYNC
