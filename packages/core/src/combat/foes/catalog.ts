/** 战斗域职责拆分，保持原计算与顺序。 */
import type { AnomalyDef, BattleBalance, DamageType } from '../../types'
import { foeThreatRatingOf, TACTIC_RANGE, foeRefSpeedMps, foeSpeedBase, foeHpOfThreat, foeFamilyHpMulOf, foeShipHpMulOf } from '../foePower'
import type { UnitSpec } from '../model'
import { createFoeSpecsFromShips } from './ships'
import { PROFILE_SPLIT, pickTopType, splitShotByComposition, foeDamageComposition } from '../../wormholeFoes'
import { ceilFinalQuantity } from '../../quantity'
import type { Hp3 } from '../combatMath'
import { foeUnitNameOf } from '../foeCard'

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
  /** 虫洞内部预算取加血前规格，避免最终容量影响火力分配。 */
  beforeHpUplift?: boolean
}

export function createFoeSpecs(anomaly: AnomalyDef, bal: BattleBalance, opts: FoeSpecOpts = {}): UnitSpec[] {
  // 2026-09-11 舰级路径（船长定案「敌舰配置表」）：写了 ships 的卡按**舰级绝对值**建档；
  // 未写的卡走下面的旧"威胁推导"路径，行为逐字不变（试点只转 A 族 6 张）。
  if (anomaly.ships && anomaly.ships.length > 0) {
    const specs = createFoeSpecsFromShips(anomaly, bal, opts)
    for (const spec of specs) {
      const summon = spec.foeSummonEscort
      if (!summon) continue
      const source = anomaly.ships.find(slot => slot.ship.id === summon.shipId)
      if (!source) continue
      const sourceWave = source.wave ?? 0
      // 从原成虫所在波重建本场规格；巢母血池覆写只作用于巢母条目。
      const template = createFoeSpecsFromShips(anomaly, bal, { tagPrefix: sourceWave === 0 ? '' : `w${sourceWave}-` })
        .find(unit => unit.foeShipId === summon.shipId)
      if (template) spec.foeSummonTemplate = { ...template, tag: `${opts.tagPrefix ?? ''}summon-${summon.shipId}` }
    }
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
    const hpMul = opts.beforeHpUplift ? foeFamilyHpMulOf(anomaly.foeFamily) : foeShipHpMulOf(anomaly.foeFamily)
    const hpValue = opts.beforeHpUplift ? (value: number) => value : ceilFinalQuantity
    const hp: Hp3 = { s: hpValue(totalHp * split.s * hpMul), a: hpValue(totalHp * split.a * hpMul), h: hpValue(totalHp * split.h * hpMul) }
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
        ceilFinalQuantity(((dps * bal.foeReloadMs) / 1000) * (effHit < 1 ? bal.foeHitCompMul / effHit : 1)),
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

export function flagshipBattleLedger(
  battle: import('../../state').BattleState,
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
  return { rawDmg: ceilFinalQuantity(rawDmg), flagshipMaxHp: ceilFinalQuantity(maxHp), flagshipSeq: seq }
}
