/**
 * **命中与伤害数学**（2026-10-02 从 `combat.ts` 拆出 · 批次 4a · 零行为变化）。
 *
 * 本文件 = V12 战斗引擎的**纯数学层**：三层血量形状、克制系数、距离衰减、命中公式、
 * 逐层扣血——全部**无 state / 无随机 / 无日志**，只依赖 `types`。`combat.ts` 借回使用并
 * 原样再导出（先例：fitted.ts），wormholeBattle / encounters / hullDamage / UI / 用例
 * 等既有引用零改动。
 */
import type { BattleBalance, DamageResists, DamageType } from './types'

/** 三层血量形状 */
export interface Hp3 {
  s: number
  a: number
  h: number
}

export function clamp(min: number, max: number, v: number): number {
  return Math.min(max, Math.max(min, v))
}

/**
 * **抗性下限（2026-09-27 船长令：「抗性打算允许负数」）**。
 *
 * 口径：抗性 = 减伤比例，**上限仍是 0.9**（既有 90% 顶格不变）；**下限由 0 放开到 −0.9**
 * ⇒ 抗性可以被削成**负数**，此时该层**受到额外伤害**：`(1 − 抗) = 1 + |抗|`（最多 ×1.9）。
 * 起因＝**掠袭折射涂层**的负面「全抗性 −15」原先被 `Math.max(0, …)` 吃掉 ⇒ 在**没有基础抗性**的层上
 * 这条负面完全不生效（说明写着"代价是全抗性 −15"，实际代价为 0）。
 *
 * ⚠ 为什么下限也取 0.9：让 `(1 − 抗)` 恒为正且 ≤ 1.9（伤害倍率有界、不会出现负伤害）。
 * ⚠ **本常量只在这一族（抗性）里用**：`evasion` 那两个 `clamp(0, 0.9, …)` 与它无关，不要顺手改。
 */
export const RESIST_FLOOR = -0.9

/**
 * 层位克制系数（远行星号体系削弱版）。
 * 2026-09-05 船长改：能量（plasma）对护盾 0.75 → 1.25（能量弹/激光对盾更有效，
 * 三系成为"各有克制侧重"：动能拆盾 1.5、爆炸破甲 1.5、能量拆盾 1.25 且不劣于任何层）。
 * **2026-09-13 船长改（本次）**：「爆炸对护盾改为 ×0.75，动能对装甲改为 ×0.75」——
 * 两处**逆克制劣化**由 0.5 抬到 0.75（克制/劣化比 3:1 → 2:1），三系对"非擅长层"不再腰斩。
 * UI 速查文案 `layerMultText`、产物资检契约（`tools/content-check.ts` 克制表对账）与本函数同源，自动跟随。
 * ⚠ C4 复核项：此改动提升激光炮/能量弹系（含部分无人机能量弹）胜率与 PvE 时长结构，请二号复核平衡。
 */
export function typeLayerMult(t: DamageType, layer: 'shield' | 'armor' | 'hull'): number {
  if (t === 'kinetic') return layer === 'shield' ? 1.5 : layer === 'armor' ? 0.75 : 1
  if (t === 'explosive') return layer === 'shield' ? 0.75 : layer === 'armor' ? 1.5 : 1
  return layer === 'shield' ? 1.25 : 1 // plasma（能量）：拆盾 1.25，对甲/结构无劣化
}

/** 三层克制一句话（UI 悬停/手册速查用；数值与 typeLayerMult 同源） */
export function layerMultText(type: DamageType): string {
  const fmt = (layer: 'shield' | 'armor' | 'hull'): string => {
    const v = typeLayerMult(type, layer)
    return v === 1 ? '×1' : `×${v}`
  }
  return `盾 ${fmt('shield')} · 甲 ${fmt('armor')} · 结构 ${fmt('hull')}`
}

/** 距离衰减：minRange 端 1.0 → maxRange 端 falloff（线性）。
 *  ⚠ **这是全仓唯一一处"远端衰减"实现**（2026-09-12 审计 B1 合并）：`beamPowerFactor`（能量**威力**衰减）、
 *  `hitChance`（动能/爆炸**命中**衰减）、`foeGunPowerFactorOf`（敌方炮台受击增程感知版）**全部走本函数**。
 *  合并前提 = **`falloff ∈ [0,1]`**（守卫见 `content:check`「远端衰减取值域契约」）。 */
export function distFactor(dist: number, w: { minRangeM: number; maxRangeM: number; falloff: number }): number {
  const { minRangeM: min, maxRangeM: max, falloff } = w
  if (max <= min) return 1
  const t = clamp(0, 1, (dist - min) / (max - min))
  return 1 - t * (1 - falloff)
}

/** 武器是否在当前距离开火 */
export function inRange(dist: number, w: { minRangeM: number; maxRangeM: number }): boolean {
  return dist >= w.minRangeM && dist <= w.maxRangeM
}

/**
 * 单发命中概率（设计文档公式；V17.1：×attacker.hitMul = 加力失稳缩放，缺省 1）。
 * 2026-09 船长拍板：信号半径/扫描分辨率等"间接属性"不参与战斗公式（纯展示副属性），
 * 命中只由 武器基础命中/攻方命中加成 / 守方回避 / 距离衰减 三者决定。
 *
 * ⚠ **2026-09-15 船长改判（现行口径）**：「**改为从初始命中中扣**」——回避**从"初始命中"里先扣，
 * 余量再一起乘距离衰减**（旧口径是"先乘衰减、再减回避"，即回避作为**不随距离缩水的固定点数**）。
 *  - 旧：`hit = (基础命中 + 攻方加成) × df − 守方回避`
 *  - 新：`hit = (基础命中 + 攻方加成 − 守方回避) × df`
 *  语义差别：**df = 1（贴到近端）时两者完全等价**；越远，回避越被衰减稀释（远距离回避收益按比例缩水）。
 *  对称地，双方远距离命中都上升；对**打机群**（`droneHitChance`，df 固定为 1）零变化。
 *  读数（敌动能炮 base 0.85 / 远端衰减 0.5）：回避 0.34 时 df 0.7 = 25.5% → **35.7%**、
 *  df 0.5 = 8.5% → **25.5%**；典型回避 0.22 时 df 0.7 = 37.5% → **44.1%**。
 *  ⚠ **连带（登记、未改值）**：`balance.battle.foeHitCompMul`（敌方单发伤害的等效补偿）是按**旧公式**
 *  折出来的锚 ⇒ 同一补偿下敌方期望承伤在中距 +17.6%、远端 +53.7%（船长 2026-09-15 选「先不动、看读数」）。
 * 参数保留 scanResMm/signatureM 可选字段仅为调用面兼容（字面量与单位对象），公式不消费。
 */
export function hitChance(
  weapon: { hitRate: number; minRangeM: number; maxRangeM: number; falloff: number; eqHitMul?: number },
  attacker: { hitBonus: number; scanResMm?: number; hitMul?: number },
  defender: { evasion: number; signatureM?: number },
  dist: number,
  bal: BattleBalance,
  /** **距离衰减覆写**（2026-09-12 加；缺省 = 原 `distFactor`，零行为变化）——
   *  供**敌方炮台受击增程**（`foeGunPowerFactorOf`）传入"延长段同斜率外推"的折减，
   *  否则射程延长到 18km 后，命中率会在 12km 处**卡在 falloff 平台上**（不是船长要的"同斜率继续衰减"）。 */
  dfOverride?: number,
): number {
  const df = dfOverride ?? distFactor(dist, weapon)
  // 2026-09-15：回避从**初始命中**里扣，扣完再乘距离衰减（见函数头注释）
  const raw = (weapon.hitRate + attacker.hitBonus - defender.evasion) * df
  // V18.1：索敌（命中件）乘子在 clamp 内与失稳分开——eqHitMul 只随炮台条目
  return clamp(bal.hitMin, bal.hitMax, raw * (weapon.eqHitMul ?? 1) * (attacker.hitMul ?? 1))
}

/**
 * **打机群的命中**（船长 2026-09-12 终裁：**闪避生效版**）：与 `hitChance` 同一套公式
 * （基础命中 × 火控 → **减机型闪避** → 乘索敌件 → clamp），**唯一差别 = 距离衰减固定为 1**。
 *
 * 依据：选靶早已按船长 2026-09-11 甲案「**打机群不看两舰间距**」办（`pickFoeDroneTarget`：
 * 出击型不受射程限制、哨戒机才要进射程），而命中却仍按**两舰间距**算 `distFactor`——
 * 近防炮射程 2,500m 短于典型交距（3,211~5,545m）⇒ 该因子恒落在下限 ×0.5
 * ⇒ 装备表写的命中 0.9 实战只剩 0.27~0.35，与"不看两舰间距"的裁定自相矛盾。
 * ⚠ **只对机群生效**：打舰仍走 `hitChance` 的原 `distFactor`（"近防炮射程短所以对舰吃亏"不动）。
 * 抽成函数一是为可测（`tests/pd-damage-ladder.test.ts` 直接锁这条口径），二是让调用点一眼看出
 * "这两条命中不是同一条公式"。
 *
 * ⚠ **口径沿革（三条，别照旧文重开）**：
 * 1. 最初：吃距离衰减（×0.5 下限）⇒ 实收 0.27~0.35；
 * 2. 2026-09-12「按丁修复」：**去掉距离**、仍减闪避 ⇒ 实收 **0.72（E 警戒机）/ 0.45（G 蜂群机）**；
 * 3. 同日一度改判「无视距离的 90」（连闪避也不减）⇒ 船长随即裁定「**哦 滚回到上一个闪避生效的版本**」
 *    ⇒ **以本实现（第 2 条）为准**：装备表的 0.9/0.92 是**基础命中**，机型闪避照常参与；
 *    报读数时须区分**基础值**与**实收值**（例如 0.9 基础 ⇒ 对 E 警戒机实收 0.72）。
 *
 * ⚠ **2026-09-29 加：对方对机群的命中收窄**（船长令：巨构导控塔「对方对无人机的命中收窄 5%」，
 * 同日三选一裁定「**路径①（闪避处扣）**」）——`attacker.droneHitGapPct`（本舰 `drone-tac` 族模块求和）
 * 作用在**被减数**上：综合闪避 = 机型闪避 × (1 − 收窄)。等价于"打机群的命中 ×0.95"
 * （例：0.90 基础 − 0.45 闪避 = 0.45 ⇒ 收窄后 0.90 − 0.4275 = **0.4725**），
 * 与回避缺口/抗性缺口**同一条链**（都在战前合成、都落在被减数或减法上，不是 clamp 外的独立乘子）。
 */
export function droneHitChance(
  weapon: Parameters<typeof hitChance>[0],
  attacker: Parameters<typeof hitChance>[1] & { droneHitGapPct?: number },
  evasion: number,
  bal: BattleBalance,
): number {
  const gap = clamp(0, 0.9, attacker.droneHitGapPct ?? 0)
  return hitChance(weapon, attacker, { evasion: evasion * (1 - gap) }, 0, bal, 1)
}

/** 把一发伤害按层序消费（盾→甲→结构），返回更新后三层与实际扣血 */
export function applyDamage(
  hp: Hp3,
  resists: { shield?: DamageResists; armor?: DamageResists; hull?: DamageResists },
  dmg: number,
  type: DamageType,
): { hp: Hp3; dealt: number } {
  const next = { s: hp.s, a: hp.a, h: hp.h }
  const rest0 = Math.max(0, dmg)
  const layerKey: Array<keyof Hp3> = ['s', 'a', 'h']
  const layerName: Array<'shield' | 'armor' | 'hull'> = ['shield', 'armor', 'hull']
  const before = hp.s + hp.a + hp.h

  /**
   * 🔴 **整发只吃一次克制（船长 2026-10-01 裁定「乙」）** —— 与旧口径的差别全在这一段。
   *
   * **旧口径**（本函数改成这样之前）：逐层各自乘系数，而且**把"乘过系数的值"继续往下传**
   * ⇒ 净倍率在层间**互相放大/抵消**：
   *   · 打**没有护盾层**的目标时，护盾那层先按 ×1.5 放大、再进装甲按 ×0.75 收 ⇒ 动能实得 **×1.13**
   *     （既不是该层的 0.75，也不是第一层的 1.5）；
   *   · 护盾**刚破那一刻**，每一发伤害的"边际倍率"会换到下一层的系数（动能 1.5 → 1.13）
   *     ⇒ 同一门炮同一种弹，**打护盾阶段与打装甲阶段的有效倍率不同**（船长转述玩家反馈的观感来源）。
   *
   * **新口径**：整发**只吃一个**克制系数，它由「**这一发伤害的落点层**」决定 ——
   * 1. 先用**未乘任何系数**的原始伤害，按各层血量逐层推演"能打到哪一层"（这一步只用血量判"落点"）；
   * 2. 取**落点那层**的 `typeLayerMult`，整发都按它结算（不再逐层换系数）；
   * 3. 逐层结算时各层仍然各吃**该层自己的抗性**（抗性是目标每层的属性，与克制系数不是一回事）；
   * 4. 每层的"够扣多少" = `该层血量 ÷ 该层系数 ÷ (1 − 抗性)`（把系数与抗性都折算回**原始伤害**的尺度）。
   *
   * 例（叠光级 437/160/131 · 无抗性 · 一发 600）：
   *   · 旧口径：盾 600 全吃（×1.5），**灭**；
   *   · 新口径：落点判到**结构层**（437 + 160 都被打穿）⇒ 整发按结构 ×1.0 ⇒ 扣 600（旧口径是 729）。
   *
   * ⚠ 连带的**设计后果**（船长已确认按「乙」执行）：动能在**破盾之后**不再吃 ×1.5、也不吃装甲的 ×0.75
   *   ⇒ 它从"拆盾神器"回落成"通用"；这正是"整发只吃一次"的必然结果。
   */
  const mulAt = (i: number): number => typeLayerMult(type, layerName[i]!)
  /** 判定落点：用**未乘系数**的原始伤害推进（只看能不能打穿该层） */
  let probe = rest0
  let land = 2
  for (let i = 0; i < 3; i++) {
    if (probe <= 0) {
      land = i
      break
    }
    probe -= next[layerKey[i]!]
    if (probe <= 0) {
      land = i
      break
    }
  }
  const coef = mulAt(land)
  let rest = rest0
  for (let i = 0; i < 3 && rest > 0; i++) {
    const res = resists[layerName[i]!]?.[type] ?? 0
    /** 本层"在原始伤害尺度上"能吃掉多少：层血量 ÷ 系数 ÷(1−抗性)（系数与抗性都折算回原始尺度） */
    const layerDamage = next[layerKey[i]!] / Math.max(1e-9, coef * (1 - clamp(RESIST_FLOOR, 0.9, res)))
    const absorbedRaw = Math.min(rest, layerDamage)
    next[layerKey[i]!] -= Math.min(next[layerKey[i]!], absorbedRaw * coef * (1 - clamp(RESIST_FLOOR, 0.9, res)))
    rest -= absorbedRaw
  }
  const after = next.s + next.a + next.h
  return { hp: next, dealt: Math.max(0, before - after) }
}
