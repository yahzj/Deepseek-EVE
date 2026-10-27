/** 战斗域职责拆分，保持原计算与顺序。 */
import type { FoeShipSlot, FoeShipDef, BattleBalance, AnomalyDef, DamageType, FoeReinforceTrigger } from '../../types'
import { ceilFinalQuantity } from '../../quantity'
import { clamp, type Hp3 } from '../combatMath'
import type { FoeSpecOpts } from './catalog'
import type { UnitSpec, WeaponSpec } from '../model'
import { shipWaveIndexOf, enumerateShipUnits, foeUnitNameOf } from '../foeCard'
import { foeMultiShipCompMul, foeJudgedThreatOf, foeFamilyHpMulOf, foeShipHpMulOf } from '../foePower'
import { resolveFoeMounts } from '../foeMounts'
import { pickTopType, splitShotByComposition, compositionOfMix, WORMHOLE_THREAT_BASE } from '../../wormholeFoes'

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
export function droneFireSplitOf(
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
    const gunOld = Math.max(1, ceilFinalQuantity(slot.ship.shotDmg * mul * comp))
    const droneOld = droneSlots.flatMap((ds) =>
      Array.from({ length: Math.max(0, Math.round(ds.count)) }, () =>
        Math.max(1, ceilFinalQuantity(ds.drone.dmg * mul)),
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
export function foeHullDpsOf(ship: FoeShipDef, dmgMul: number, comp: number): number {
  const per = Math.max(1, ceilFinalQuantity(ship.shotDmg * dmgMul * comp))
  return (per * 1000) / Math.max(1, ship.reloadMs)
}

/** 逐 `slot` 缓存缩放系数（同一条目的多个单位共用，避免重复计算） */
export function foeDpsCapScaleOf(
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
    total += idxs.length * foeHullDpsOf(slot.ship, slot.dmgMul ?? 1, comp)
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

export function createFoeSpecsFromShips(anomaly: AnomalyDef, bal: BattleBalance, opts: FoeSpecOpts): UnitSpec[] {
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
    const hpMul = opts.beforeHpUplift ? foeFamilyHpMulOf(ship.family) : foeShipHpMulOf(ship.family)
    const hpValue = opts.beforeHpUplift ? (value: number) => value : ceilFinalQuantity
    const hp: Hp3 = u.slot.hpOverride ? { ...u.slot.hpOverride } : {
      s: hpValue(totalHp * split.s * hpMul),
      a: hpValue(totalHp * split.a * hpMul * (mount.foeMausoleumArmor?.hpMul ?? 1)),
      h: hpValue(totalHp * split.h * hpMul * (mount.foeMausoleumArmor?.hpMul ?? 1)),
    }
    // 炮台单发：写了比例 ⇒ 取拆分后的 G 摊分结果（Σ 与旧口径守恒），否则逐字沿用旧算法；
    // 之后再乘**舰体火力越线折扣**（越线才 <1；`fireSplit` 非空的条目缩放 = 1，见 `foeDpsCapScaleOf`）
    const rawShotDmg = sp
      ? sp.gun
      : Math.max(1, ceilFinalQuantity(ship.shotDmg * (u.slot.dmgMul ?? 1) * comp * (dpsCapScale.get(u.slot) ?? 1)))
    const shotDmg = ship.acidBurst ? 0 : mount.broodControl ? Math.max(1, ceilFinalQuantity(rawShotDmg * mount.broodControl.gunDmgMul)) : rawShotDmg
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
        shotDmg: Math.max(1, ceilFinalQuantity((sp ? sp.drones[dIdx++]! : Math.max(1, ceilFinalQuantity(ds.drone.dmg * (u.slot.dmgMul ?? 1)))) * (mount.broodControl?.droneDmgMul ?? 1))),
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
          shotDmg: sp ? sp.drones[sp.drones.length - 1]! : Math.max(1, ceilFinalQuantity(reserveModel.dmg * (u.slot.dmgMul ?? 1))),
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
      ...(ship.acidBurst ? { acidBurst: { ...ship.acidBurst, ...(ship.acidBurst.damage !== undefined ? { damage: ceilFinalQuantity(ship.acidBurst.damage * (u.slot.dmgMul ?? 1) * comp) } : {}), ...(mount.acidShieldDamageMul !== undefined ? { shieldDamageMul: mount.acidShieldDamageMul } : {}) } } : {}),
      ...(mount.hatchery ? { foeHatchery: { ...mount.hatchery } } : {}),
      ...(mount.fleetSpeedRamp ? { foeFleetSpeedRamp: { ...mount.fleetSpeedRamp } } : {}),
      name,
      side: 'foe' as const,
      hp,
      /**
       * **层位抗性**（2026-09-15 船长：「我现暂时只打给 **C 族**添加**全血条 25% 爆炸抗性**」）：
       * 从**舰级**读，护盾允许编成条目按伤害类型覆写；三条都缺省 ⇒ `{}`，
       * 既有舰级零行为变化）。与敌机群那条装配口径一致（同 `FoeDroneDef.defense` 的展开写法）。
       * ⚠ 抗性**可为负**（2026-09-27 船长令）：`applyDamage` 夹 `RESIST_FLOOR(−0.9) ~ 0.9`，
       * 所以这里传负数**会**变成"易伤"（该层受额外伤害，最多 ×1.9）。
       */
      resists: {
        ...(ship.shieldResist || u.slot.shieldResist ? { shield: { ...(ship.shieldResist ?? {}), ...(u.slot.shieldResist ?? {}) } } : {}),
        ...(ship.armorResist || mount.foeMausoleumArmor ? { armor: { ...(ship.armorResist ?? {}), ...(mount.foeMausoleumArmor ? { kinetic: mount.foeMausoleumArmor.resistPct, explosive: mount.foeMausoleumArmor.resistPct, plasma: mount.foeMausoleumArmor.resistPct } : {}) } } : {}),
        ...(ship.hullResist || mount.foeMausoleumArmor ? { hull: { ...(ship.hullResist ?? {}), ...(mount.foeMausoleumArmor ? { kinetic: mount.foeMausoleumArmor.resistPct, explosive: mount.foeMausoleumArmor.resistPct, plasma: mount.foeMausoleumArmor.resistPct } : {}) } } : {}),
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
      ...(mount.foeRebirthProtocol !== undefined ? { foeRebirthProtocol: mount.foeRebirthProtocol } : {}),
      ...(mount.foeMausoleumArmor !== undefined ? { foeMausoleumArmor: mount.foeMausoleumArmor } : {}),
      ...(mount.foeCoatingArmor !== undefined ? { foeCoatingArmor: mount.foeCoatingArmor } : {}),
      ...(mount.foeShieldCapacitor !== undefined ? { foeShieldCapacitor: mount.foeShieldCapacitor } : {}),
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
      ...(mount.foeSummonEscort !== undefined ? { foeSummonEscort: mount.foeSummonEscort } : {}),
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

/** 规范化增援触发条件：只保留**有效**条件（`sec > 0` / `afterKills > 0` / `0 ≤ hpBelow ≤ 1`）；
 *  **一个有效条件都没有 → 返回 null = 按"未写"处理 = 开战即在**（刻意不产生"永不入场"的沉默副作用）。 */
export function normReinforceTrigger(at?: FoeReinforceTrigger): FoeReinforceTrigger | null {
  if (!at) return null
  const out: FoeReinforceTrigger = {}
  if (typeof at.sec === 'number' && Number.isFinite(at.sec) && at.sec > 0) out.sec = at.sec
  if (typeof at.afterKills === 'number' && Number.isFinite(at.afterKills) && at.afterKills > 0) {
    out.afterKills = Math.floor(at.afterKills)
  }
  if (typeof at.hpBelow === 'number' && at.hpBelow >= 0 && at.hpBelow <= 1) out.hpBelow = at.hpBelow
  return Object.keys(out).length > 0 ? out : null
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
export const _FOE_REPAIR_THREAT_REF_IN_SYNC: 45 extends typeof WORMHOLE_THREAT_BASE
  ? typeof WORMHOLE_THREAT_BASE extends 45
    ? true
    : never
  : never = true
