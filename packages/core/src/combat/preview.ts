/** 战斗域：preview，从原引擎按职责迁移，保持结算顺序。 */
import type { GameState } from '../state'
import type { UnitSpec } from './model'
import type { BattleBalance, SimContext, AnomalyDef, DamageType } from '../types'
import { desiredRangeFor, foeDesiredRange, battleOpenM } from './foes/tactics'
import { createFoeSpecs } from './foes/catalog'
import { clamp, SHIP_HP_UPLIFT_MUL, playerWeaponInRange, hitChance, playerBlindDamageMul, typeLayerMult } from './combatMath'
import { createPlayerSpec } from './player/create'
import { foeHpOfThreat } from './foePower'
import { battleCardRangeOf } from './battleRangeMemory'
import { meFoeRangeDebuffOf } from './foeRange'
import { beamPowerFactor } from './beam'
import { foeDamageComposition } from '../wormholeFoes'
import { ceilFinalQuantity } from '../quantity'
import { SHIELD_REGEN_FLOOR_PCT, shieldChargeStreamsOf } from './combatRepair'
import { spreadWinChance } from './combatReport'

/**
 * **某星系的玩家目标距离设定**（船长 2026-09-11：「玩家每个星系设定的目标距离独立保存，
 * 预估胜率的战斗按照那个距离决定。如果没有，采用射程中段距离」）。
 * 返回 null = 该星系没设过（调用方回落到默认档：**星图 = 射程带 0.8、洞内 = 中段 0.5**，
 * 2026-09-15 船长裁定；见 `balance.battle.desireBand*`）。
 * 单点：实战开战（远征/遭遇/AI）、胜率预估（MC 与稳态解析）全走这一处，避免多处各读各的。
 */
export function desirePrefOf(state: GameState, galaxyId: string | null | undefined): number | null {
  if (!galaxyId) return null
  const v = state.expedition.desirePrefByGalaxy?.[galaxyId]
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null
}

/** 写入某星系的目标距离（战斗内拖条/战术切换、出发时显式指定共用）；返回写入后的值 */
export function setDesirePrefOf(state: GameState, galaxyId: string, desireM: number): number {
  const v = Math.max(1, Math.round(desireM))
  state.expedition.desirePrefByGalaxy = { ...(state.expedition.desirePrefByGalaxy ?? {}), [galaxyId]: v }
  return v
}

/**
 * 稳态距离近似：双方期望距离的中点（钳制在开战距离内）。
 * `midPos` = 我方**默认期望档**在射程带内的位置（`bal.desireBandMid` = 0.8；星图与洞内同值，
 * 2026-09-15 船长取消分档后不再按 `wh-*` 分辨）。
 */
export function steadyDistance(
  me: UnitSpec,
  foes: UnitSpec[],
  bal: BattleBalance,
  midPos: number,
  foeRangeDebuffR = 0,
): number {
  const dMe = desiredRangeFor(me, 'mid', bal, midPos)
  const dFoe = foeDesiredRange(me, foes, bal, foeRangeDebuffR)
  const open = battleOpenM(me, foes, bal)
  return clamp(bal.minDistanceM, open, (dMe + dFoe) / 2)
}

/** 预估胜率核心（确定性期望推演；不消耗 rng）。
 * meMul/foeMul = 命中率缩放系数（AI favor 用；玩家手动 = 1/1），返回未扩散的模型胜率 raw ∈ [0,1] */
/** 稳态预览引擎（battleWinPreview 与带伤预警共用同一公式源——DPS/承伤/tick 换算与展示一一对应）。
 * 2026-09-09 修正（real sim 终验暴露低估，docs/design/wave-battles-20260909.md）：
 * ① 多波卡：敌方总血 = 全波预算；敌方火力 = 峰值波（各波不同时在场，不吃全波火力加成）；
 * ② 护盾回充进承伤模型（引擎 shieldRegenPerSec 实回，长盘显著）——回充窗口 ≈ 直到装甲击穿，
 *    净敌火 = foeDps − 回充率，破甲时间 tA = (盾+甲)/(净敌火)，可承受总伤 = 总 EHP + 回充量。
 * ③ **2026-09-25（船长令「改」）**：敌血**按卡面属性建档取值**（舰级路径 = 逐波三层血之和），
 *    不再一律读威胁曲线 ⇒ 与实战同源；见下方 `foeHpTotal` 的口径说明。 */
export function steadyPreview(
  state: GameState,
  ctx: SimContext,
  anomaly: AnomalyDef,
  shipId: string,
  meMul: number,
  foeMul: number,
): {
  me: UnitSpec
  meHpTotal: number
  foeHpTotal: number
  meDps: number
  foeDps: number
  ttrMe: number
  ttrFoe: number
} | null {
  const bal = ctx.balance.battle
  const me = createPlayerSpec(state, ctx, shipId)
  if (!me) return null
  // 敌方编制口径（两处**故意分开**）：
  //   ① `foes` = **波 0** 编制 —— 实战的开战距离 / 期望交距就由波 0 首个主体单位决定（见波次注释）
  //      ⇒ 距离口径必须与实战同源，不随"峰值波"改；
  //   ② `firepowerFoes` = **各波里火力最大的那一波** —— 多波不同时在场，峰值波才是承伤口径（见下）。
  const waves = anomaly.waves && anomaly.waves.length > 0 ? anomaly.waves : null
  const peakUnits = waves ? Math.max(...waves.map((w) => w.units)) : 1
  const foes = peakUnits > 1 ? createFoeSpecs(anomaly, bal, { units: peakUnits }) : createFoeSpecs(anomaly, bal)

  /**
   * **舰级路径的逐波建档**（波号从 `slot.wave` 现算 ⇒ 不依赖 `waves[]` 是否写出；一次建好，血与火力共用）：
   * - **血**：全波之和（多波 = 全波预算）；
   * - **火力**：取 `dps` 最大的那一波（`firepowerFoes`）。
   *
   * ⚠ **2026-09-25 修正（船长令「改」）**：旧口径一律读曲线 `foeHpOfThreat(威胁)` 当敌血，而舰级路径
   * 的真实血量是 `ship.hp × hpMul` 的绝对值 ⇒ 两把尺子可差数倍（穹顶守卫 真 **5,729** vs 曲线价
   * F(110)=1,435），且**动威胁标签就会牵动这些显示读数**；火力侧同样有失配——
   * `createFoeSpecsFromShips` **忽略 `units`**、按 `tagPrefix` 取波（缺省 = 波 0）⇒ 多波舰级卡
   * 只按**波 0 的火力**算（噬口猎杀令：波 0 = 10.0 DPS vs 头目波 107.8 DPS，差 ×10.78）。
   * 现改为与实战同源：**血 = 属性建档之和** · **火力 = 各波取最大**（船长「按'各波取最大'改」）。
   * 旧路径（无 `ships[]`）两侧都保持原口径（曲线血 + `units` 峰值波）⇒ 逐字零变化；
   * `foeHpOverride` 仍只对旧路径生效（舰级路径本就忽略它，与实战一致）。
   */
  const shipSlots = anomaly.ships ?? []
  const shipWaveBuilds =
    shipSlots.length > 0
      ? ((): Array<{ specs: UnitSpec[]; hp: number; dps: number }> => {
          const idxs = new Set<number>()
          for (const s of shipSlots) idxs.add(Math.max(0, Math.floor(s.wave ?? 0)))
          if (idxs.size === 0) idxs.add(0)
          return [...idxs].map((i) => {
            const specs = createFoeSpecs(anomaly, bal, { tagPrefix: i === 0 ? '' : `w${i}-` })
            let hp = 0
            let dps = 0
            for (const f of specs) {
              hp += f.hp.s + f.hp.a + f.hp.h
              for (const w of f.weapons) dps += ((w.shotDmg ?? 0) * (w.count ?? 1) * 1000) / Math.max(1, w.reloadMs)
            }
            return { specs, hp, dps }
          })
        })()
      : null
  const curveHp = (anomaly.foeHpOverride ?? foeHpOfThreat(anomaly.threat, bal)) * SHIP_HP_UPLIFT_MUL
  /** 敌血总预算（多波 = 全波）：舰级路径 = 逐波三层血之和；旧路径 = 曲线（建档出 0 血时同兜底曲线） */
  const foeHpTotal = shipWaveBuilds ? shipWaveBuilds.reduce((n, b) => n + b.hp, 0) || curveHp : curveHp
  /** 火力侧编制：舰级路径 = 各波中 DPS 最大的一波；旧路径 = `foes`（`units` 口径本就是峰值波） */
  const firepowerFoes = shipWaveBuilds
    ? shipWaveBuilds.reduce((best, b) => (b.dps > best.dps ? b : best), shipWaveBuilds[0]!).specs
    : foes
  // 距离口径（船长 2026-09-11：「预估胜率的战斗按照那个距离决定，如果没有，采用射程中段距离」）：
  // 按卡记忆取距；没有记录时保留解析预估原有默认模型。
  const steadyPref = battleCardRangeOf(state, anomaly.id)?.desireM ?? null
  const steady =
    steadyPref !== null
      ? clamp(bal.minDistanceM, battleOpenM(me, foes, bal), steadyPref)
      : steadyDistance(me, foes, bal, bal.desireBandMid, meFoeRangeDebuffOf(state, ctx, [shipId]))

  const meHpTotal = me.hp.s + me.hp.a + me.hp.h

  // 我方 DPS：逐武器（V17.2 炮台 = 固定弹种：按炮型 × 敌方血型克制精确计算；
  // V18B-2 激光 beam = 命中恒 1（必中）且按稳态距离折算威力衰减）
  let meDps = 0
  for (const w of me.weapons) {
    if (w.disabled || !playerWeaponInRange(steady, w)) continue
    let shot = 0
    let ammoType: DamageType | null = null
    let hit = 0
    let power = 1
    if (w.kind === 'gun') {
      const entries = Object.entries(w.shotsByType ?? {})
      if (entries.length > 0) {
        const [t, v] = entries[0]!
        ammoType = t as DamageType
        shot = v ?? 0
      }
      hit = hitChance(w, me, foes[0]!, steady, bal)
    } else if (w.kind === 'beam') {
      ammoType = w.fixedType ?? 'plasma'
      shot = w.shotDmg ?? 0
      hit = 1 // 必中
      power = beamPowerFactor(steady, w)
    } else {
      shot = w.shotDmg ?? 0
      hit = hitChance(w, me, foes[0]!, steady, bal)
    }
    if (hit <= 0) continue
    const mult = effectiveDmgMultAgainst(foes, ammoType ?? w.fixedType ?? 'kinetic')
    // **全体攻击**（2026-09-13 船长：C 孢子导弹巢「对所有敌方同时攻击」）——
    // 预估必须同步：一轮齐射的实收 = 单目标 × **当前在场敌舰数**（多波卡按峰值波小队数，与 `foes` 同源）。
    const allFoesMul = w.allFoes === true ? Math.max(1, foes.length) : 1
    power *= playerBlindDamageMul(steady, w)
    meDps += (shot * power * mult * hit * allFoesMul * 1000) / w.reloadMs
    // 附加伤害段同步（掠袭破片炮）：预估不许"卡面混伤、按纯系算"——副段走它自己那系的克制倍率
    const secPctEst = w.secondaryDamagePct ?? 0
    if (secPctEst > 0) {
      const secMul = effectiveDmgMultAgainst(foes, w.secondaryDamageType ?? 'kinetic')
      meDps += (shot * power * secMul * hit * allFoesMul * secPctEst * 1000) / w.reloadMs
    }
  }
  // 敌方 DPS（打我，含类型克制与层抗；近盲带内伤害按 blindDmgMul 折算——
  // 2026-09-08：能量 beam 必中（hit=1）且威力走 beamPowerFactor/盲带，与实时引擎同源）
  // 2026-09-10 船长（窝点混伤）：克制倍率按**火力构成加权求和**（与实时逐系结算同源，
  // 否则"卡面写混伤、预估按纯系算"会骗人）
  const foeComp = foeDamageComposition(anomaly)
  const foeCompWeighted = (type: DamageType): number =>
    foeComp.length <= 1
      ? avgLayerMult(meHpTotal, me, type)
      : foeComp.reduce((s, c) => s + c.share * avgLayerMult(meHpTotal, me, c.type), 0)
  let foeDpsPeak = 0
  // ⚠ 用 `firepowerFoes`（各波里火力最大的一波），**不是** `foes`（波 0，只服务距离口径）——
  //   舰级路径多波卡的头目常在末波（噬口猎杀令：波 0 = 10.0 DPS vs 头目波 107.8 DPS）
  for (const f of firepowerFoes) {
    const w = f.weapons[0]!
    const isBeam = w.kind === 'beam'
    const hit = isBeam ? 1 : hitChance(w, f, me, steady, bal)
    if (hit <= 0) continue
    const power = isBeam ? (steady < w.minRangeM ? w.blindDmgMul ?? 0.3 : beamPowerFactor(steady, w)) : steady < w.minRangeM ? w.blindDmgMul ?? 0.3 : 1
    const shot = Math.max(1, ceilFinalQuantity((w.shotDmg ?? 0) * power))
    const mult = foeCompWeighted(w.fixedType ?? 'kinetic')
    /**
     * ⚠ **连发按"一轮 `shots` 发 ÷ 同一个装填周期"计入**（**2026-10-02 加**）：
     * `w.burst` 缺省 ⇒ `shotsPerCycle = 1` ⇒ 本行与改动前**逐字一致**（既有全部敌舰）。
     * 不乘 `shots` 会把三连发武器的期望承伤**低估到 1/3**（发间隔 100ms 相对 5 秒装填可忽略，
     * 故周期仍按 `reloadMs` 计）。
     */
    const shotsPerCycle = Math.max(1, Math.floor(w.burst?.shots ?? 1))
    foeDpsPeak += (shot * shotsPerCycle * mult * hit * 1000) / w.reloadMs
  }
  // 2026-09-09 减员修正（稳态把"敌人满员全程输出"当真相，多单位/多波严重高估承伤）：
  // 我方逐个击毁敌方单位 → 敌方在场火力近似线性衰减，全程平均 ≈ 峰值 × (N+1)/(2N)
  // （N = **峰值火力那一波的单位数**；随机目标下各单位击杀时刻 ≈ 按血量比例均匀分布）
  const foeUnitN = Math.max(1, firepowerFoes.length)
  const foeDps = foeDpsPeak * ((foeUnitN + 1) / (2 * foeUnitN))

  // 承伤窗口含护盾回充（2026-09-09 修正）——**2026-09-14 船长改判后为指数式**：
  // 回充按**当前盾**比例（引擎：`urt.hp.s × 费率`）⇒ 盾动力学 `ds/dt = k·s − D`（k = 费率、D = 净敌火）
  //   · 盾被打穿时刻 `tBreak = ln(D/(D − k·s₀)) ÷ k`（**仅当 D > k·s₀**；否则回充永远顶得住、盾不破）
  //   · **破盾后回充归 0**（船长「不留，破盾后 0 回复」）⇒ 之后 D 全打在甲+结构上
  //   · 装了「护盾充能装置」时：把 15 秒脉冲折成**恒定附加回充** `c = 满盾 × 每跳比例 ÷ 15 秒`，
  //     **只在破盾后计入**（盾没破时被动回充远大于它）——这样估算不会对带装置的人过分悲观。
  // ⚠ **2026-09-20 船长加「恢复速度下限」后本模型必须同改**（原话见 `SHIELD_REGEN_FLOOR_PCT`）：
  //   现行回充为 `max(当前盾 × k, 满盾 × 0.6%)` ⇒ 盾低于50%后回充不再随盾量缩水。
  //   恒速下限 = 满盾0.6%/秒，交点sX = sCap / k；预估与实战读取相同参数。
  //     · `s > sX`：指数段（同旧口径）
  //     · `sX ≥ s > 0`：**恒速段**（净掉率 = D − sCap；`D ≤ sCap` ⇒ 恒速回充，永远打不穿）
  //     · `s = 0`：破盾，回充归 0（不变）
  const foeDpsNet = foeDps * foeMul
  const regenMul = 1 + (me.shieldPassiveBonusPct ?? 0)
  const k = bal.shieldRegenPerSec * regenMul
  const s0 = Math.max(0, me.hp.s)
  const sCap = s0 * SHIELD_REGEN_FLOOR_PCT * regenMul
  const sX = k > 0 ? sCap / k : Number.POSITIVE_INFINITY
  /**
   * **每秒回盾量 = Σ 逐路「本路比例 × 满盾 ÷ 本路间隔」**（**2026-09-21 逐型号独立回转**后：
   * 各路各按各的节奏跳，所以必须逐路换算再相加，不能拿"合计比例 ÷ 某个间隔"）。
   */
  const chargePerSec =
    shieldChargeStreamsOf(state, ctx, shipId).reduce((n, s) => n + (s.pct * s0) / Math.max(1, s.ms) / 1000, 0)
  let ttrMe: number
  if (foeDpsNet <= 0) {
    ttrMe = Number.POSITIVE_INFINITY // 敌方打不动我
  } else if (k > 0 && s0 > 0 && foeDpsNet <= Math.max(k * s0, sCap)) {
    ttrMe = Number.POSITIVE_INFINITY // 回充顶住敌火：盾永不破 ⇒ 只有超时血比才可能落败
  } else if (k > 0 && s0 > 0) {
    // 第一段：指数衰减到交点（已在交点以下就直接进第二段）
    const tExp = s0 > sX ? Math.log((foeDpsNet - sCap) / (foeDpsNet - k * s0)) / k : 0
    // 第二段：从 `min(s0, sX)` 恒速掉到 0
    const lin = foeDpsNet - sCap
    const tLin = lin > 0 ? Math.min(s0, sX) / lin : Number.POSITIVE_INFINITY
    const tBreak = tExp + tLin // 盾被打穿（∞ = 恒速段也顶得住 ⇒ 永远打不穿）
    const after = Math.max(0, foeDpsNet - chargePerSec) // 破盾后：充能装置托底
    ttrMe = Number.isFinite(tBreak) && after > 0 ? tBreak + (me.hp.a + me.hp.h) / after : Number.POSITIVE_INFINITY
  } else {
    ttrMe = meHpTotal / foeDpsNet // 无回充（费率 0 或无盾）：原口径
  }
  const ttrFoe = meDps > 0 ? foeHpTotal / Math.max(1e-9, meDps * meMul) : Infinity // 我击毁敌方所需秒数
  return { me, meHpTotal, foeHpTotal, meDps, foeDps, ttrMe, ttrFoe }
}

export function winPreviewRaw(
  state: GameState,
  ctx: SimContext,
  anomaly: AnomalyDef,
  shipId: string,
  meMul: number,
  foeMul: number,
): number {
  const sp = steadyPreview(state, ctx, anomaly, shipId, meMul, foeMul)
  if (!sp) return 0
  if (!Number.isFinite(sp.ttrMe) && !Number.isFinite(sp.ttrFoe)) return 0.5
  if (!Number.isFinite(sp.ttrMe)) return 1 // 敌永远打不死我 → 必胜
  if (!Number.isFinite(sp.ttrFoe)) return 0 // 我永远打不死敌 → 必败
  return clamp(0, 1, sp.ttrMe / (sp.ttrMe + sp.ttrFoe))
}

/**
 * 带伤预警预估（2026-09-08 船长定）：在满耐久稳态模型上，把"预计承受总伤"按 盾→装甲→结构
 * 三层顺序分摊，得到预计装甲损耗比与结构损耗比（0~1）。战斗持续时长 = 先到者（我被击毁 /
 * 我击毁敌方），与实时引擎同源公式。
 */
export function bountyDamageForecast(
  state: GameState,
  ctx: SimContext,
  anomaly: AnomalyDef,
  shipId: string = state.shipId,
): { armorLoss: number; hullLoss: number; rawWin: number } {
  const sp = steadyPreview(state, ctx, anomaly, shipId, 1, 1)
  if (!sp) return { armorLoss: 0, hullLoss: 0, rawWin: 0 }
  let rawWin: number
  if (!Number.isFinite(sp.ttrMe) && !Number.isFinite(sp.ttrFoe)) rawWin = 0.5
  else if (!Number.isFinite(sp.ttrMe)) rawWin = 1
  else if (!Number.isFinite(sp.ttrFoe)) rawWin = 0
  else rawWin = clamp(0, 1, sp.ttrMe / (sp.ttrMe + sp.ttrFoe))
  const duration = Math.min(sp.ttrMe, sp.ttrFoe)
  /**
   * **隐秘行动装置计入预估**（2026-09-15 船长 · Q6 甲）：隐身窗口内**双方都不开火**
   * （我方一开火就现形 ⇒ 窗口内我方同样停火）⇒ 敌方的**有效输出时长**要扣掉这一段
   * （窗口比战斗还长就扣到 0，不会出现"负输出"）。
   *
   * **口径边界（如实登记）**：胜率**比值**不受影响（双方 DPS 没变，只是开打得更晚）——
   * 玩家可见的胜率走 `winEstimate.ts` 的**蒙特卡洛**（直接跑真引擎）⇒ 装置**自动计入**、无需另算；
   * 本处改的是**损耗预估**（预计装甲/结构损耗），免得"装了装置、面板还按旧损耗显示"。
   */
  const stealthSec = Math.max(0, (sp.me.stealthMs ?? 0) / 1000)
  const foeFireSec = Math.max(0, duration - stealthSec)
  const dmg = Number.isFinite(duration) ? sp.foeDps * foeFireSec : 0
  const afterShield = Math.max(0, dmg - sp.me.hp.s)
  const armorLoss = sp.me.hp.a > 0 ? clamp(0, 1, afterShield / sp.me.hp.a) : afterShield > 0 ? 1 : 0
  const hullLoss = sp.me.hp.h > 0 ? clamp(0, 1, Math.max(0, afterShield - sp.me.hp.a) / sp.me.hp.h) : afterShield > sp.me.hp.a ? 1 : 0
  return { armorLoss, hullLoss, rawWin }
}

/**
 * 【已退役的展示口径，2026-09-09】悬赏展示胜率 = 稳态解析 + 带伤扣分(旧方案)——探针实测双向
 * 大偏差(显示 2% 却常胜),被 winEstimate.ts 蒙特卡洛推演(玩家可见)取代。本函数保留仅作：
 * ①缓存预热完成前的临时回退显示；②活动远征视图/测试兼容。结算与 AI/工具口径 battleWinPreview 不变。
 * = 原显示胜率（满耐久基准 + logit 扩散）− 预计装甲损耗×winPenaltyArmorPerFull
 * − 预计结构损耗×winPenaltyHullPerFull（结构伤扣更重），下限 2%。
 *
 * ⚠ **2026-09-23 船长报障后去掉 98% 上限**（玩家：「**胜率过于极端，98 胜率打噬口猎杀令连续失败**」）：
 * 旧写法 `Math.min(0.98, …)` 把"稳赢"也显示成 **98%**，玩家读成"几乎必胜"；而**派系/窝点卡**
 * 这条回退口径是**唯一的显示来源**（蒙特卡洛只管未加成卡，见 `Expedition` 的 `factionHit`）
 * ⇒ 那条路径上"98%"就是天花板值，与实际胜率无关。**下限 2% 保留**（"仍有希望"语义），
 * 上限改为不截断（真正稳赢就显示 99%/100%，由显示端按整数呈现）。
 */
export function bountyWinPercentGuarded(
  state: GameState,
  ctx: SimContext,
  anomaly: AnomalyDef,
  shipId: string = state.shipId,
): number {
  const f = bountyDamageForecast(state, ctx, anomaly, shipId)
  if (f.rawWin <= 0) return 0
  const shown = spreadWinChance(f.rawWin, ctx.balance.battle.winSpread)
  const bal = ctx.balance.battle
  const penalty = f.armorLoss * bal.winPenaltyArmorPerFull + f.hullLoss * bal.winPenaltyHullPerFull
  return Math.max(0.02, Math.min(1, shown - penalty))
}

/** 玩家口径预估胜率：无 favor 模型 + logit 扩散（悬赏卡/玩家手动战斗展示用；实际结算与之对应） */
export function battleWinPreview(state: GameState, ctx: SimContext, anomaly: AnomalyDef, shipId: string = state.shipId): number {
  const raw = winPreviewRaw(state, ctx, anomaly, shipId, 1, 1)
  return spreadWinChance(raw, ctx.balance.battle.winSpread)
}

/** AI 远征 favor 优势量（与结算推进同一来源；指派与展示共用） */
export function aiFavorAdv(state: GameState, ctx: SimContext, anomaly: AnomalyDef, shipId: string): number {
  const raw = winPreviewRaw(state, ctx, anomaly, shipId, 1, 1)
  return clamp(-1, 1, (raw - 0.5) * 2)
}

/** AI 口径预估胜率（"最终成功率"）：无 favor 模型 → 按 aiFavorStrength 修正命中 → logit 扩散。
 *  AI 接单门槛与 AI 指挥中心展示用它；数值 = AI 副船在该 favor 下的期望表现。 */
export function aiWinPreview(state: GameState, ctx: SimContext, anomaly: AnomalyDef, shipId: string): number {
  const k = ctx.balance.battle.aiFavorStrength
  const adv = aiFavorAdv(state, ctx, anomaly, shipId)
  const favored = winPreviewRaw(state, ctx, anomaly, shipId, 1 + k * adv, 1 - k * adv)
  return spreadWinChance(favored, ctx.balance.battle.winSpread)
}

/** 伤害类型 × 敌方三层占比的期望克制倍率（敌方无抗） */
export function effectiveDmgMultAgainst(foes: UnitSpec[], type: DamageType): number {
  let total = 0
  let acc = 0
  for (const f of foes) {
    const s = f.hp.s + f.hp.a + f.hp.h
    total += s
    acc += f.hp.s * typeLayerMult(type, 'shield') + f.hp.a * typeLayerMult(type, 'armor') + f.hp.h * typeLayerMult(type, 'hull')
  }
  return total > 0 ? acc / total : 1
}

/** 我方三层占比 × 类型克制 × (1−层抗) 的期望倍率 */
export function avgLayerMult(meHpTotal: number, me: UnitSpec, type: DamageType): number {
  if (meHpTotal <= 0) return 1
  const s = (me.hp.s / meHpTotal) * typeLayerMult(type, 'shield') * (1 - (me.resists.shield?.[type] ?? 0))
  const a = (me.hp.a / meHpTotal) * typeLayerMult(type, 'armor') * (1 - (me.resists.armor?.[type] ?? 0))
  const h = (me.hp.h / meHpTotal) * typeLayerMult(type, 'hull') * (1 - (me.resists.hull?.[type] ?? 0))
  return s + a + h
}
