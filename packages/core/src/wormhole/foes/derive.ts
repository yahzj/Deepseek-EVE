/** 功能域职责拆分，保持原计算与顺序。 */
import type { WormholeFamily } from '../../state'
import type { FoeTargetingMode, AnomalyDef, FoeShipSlot } from '../../types'
import { type WormholeFoeKind, wormholeCardThreatOf, wormholeNaturalHp, WORMHOLE_THREAT_REF_RATIO } from './curves'
import { ceilFinalQuantity } from '../../quantity'

/**
 * **层末守卫的选靶倾向概率**（船长 2026-09-14：「**虫洞敌人的攻击倾向，加一个概率**」→ 先定 60%，
 * 同日二次改判「**概率降为40%试一下**」）——BOSS 的**模式**仍是「打最大的」（2026-09-13 定的分流），
 * 变的只是"不再每发都精准"：每发开火前掷一次，没掷中 ⇒ 退回随机。
 *
 * 2026-10-09船长指定倾向降低到10%；未命中倾向时按插件权重随机选靶。
 * 普通节点/撤离战用族定概率，这一个常量只管 BOSS。
 */
export const WORMHOLE_BOSS_TARGETING_CHANCE = 0.1

/**
 * **族定选靶**（船长 2026-09-15：「选靶按照族限定。」）——**同族各卡一律用族定模式**，
 * 不再逐卡自定义（此前逐卡写法作废）：
 *
 * | 族 | 模式 | 设定 |
 * |---|---|---|
 * | A 海盗 | `noncombat` | 抢货船 |
 * | C 异形 | `smallest` | 捕食弱者 |
 * | D 守墓 | `top-output` | 残余程序压制火力 |
 * | E 巨构 | `random` | 平台随机投送机群（族格） |
 * | G 鱿鱼 | `random` | 蜂群乱战 |
 *
 * 派生端（`wormholeAnomalyOf`）以**本表**为准取模式 ⇒ 卡面字段写错也不会跑偏；
 * `content:check` 与用例另行断言"卡面 = 族定值"。层末守卫仍是 `largest`（既有裁定，不受族限）。
 */
export const WORMHOLE_FAMILY_TARGETING: Readonly<Record<WormholeFamily, FoeTargetingMode>> = {
  A: 'noncombat',
  C: 'smallest',
  D: 'top-output',
  E: 'random',
  G: 'random',
}

/** 族定选靶的倾向概率，2026-10-09改为10%；只有非随机模式消费。 */
export const WORMHOLE_FAMILY_TARGETING_CHANCE = 0.1

/**
 * **把洞内敌卡按层派生**（不改数据文件，与窝点派生 `lairAnomalyOf` 同款做法）：
 * - 威胁：`wormholeFoeThreat(depth, kind)` × **本卡补偿**（`wormholeCardThreatOf`——挂了「支援呼叫装置」
 *   的卡另有 ×`threatMul`，其它卡逐字不变）；
 * - 舰级路径的**绝对值缩放**：按「锚点威胁 → 目标威胁」的比例同乘每个条目的 `hpMul` / `dmgMul`
 *   （保住"威胁 = 战力标尺"；单发/射程/编成/战术一律不动）；
 * - **波数**：节点的 `waves` 表达"同一编成分 N 波进场" ⇒ 血与火力各摊 `1/N`、按 `slot.wave` 分波
 *   （总战力守恒，与设计稿 §3 表"同一威胁带里分几波"一致）；
 * - **选靶模式**（船长 2026-09-13 定，**2026-09-15 改为「按族限定」**）：普通用途一律取**族定模式**
 *   （`WORMHOLE_FAMILY_TARGETING`；卡面字段只作展示与体检断言）；**BOSS 一律「打最大的」**；
 * - **选靶倾向概率**：非随机族取 `WORMHOLE_FAMILY_TARGETING_CHANCE`（0.1），
 *   随机族不掷骰（恒 1）；BOSS 取 `WORMHOLE_BOSS_TARGETING_CHANCE`。
 * 旧路径卡（没写 `ships`）不缩放条目，只改 `threat`（曲线自己会算血与火力）。
 */
export function wormholeAnomalyOf(
  base: AnomalyDef,
  depth: number,
  kind: WormholeFoeKind,
  waves: number,
  /**
   * - `hpBudget`：**本层本档的"血尺度"**（= `foeHpOfThreat(层威胁) × WORMHOLE_FOE_BASE_STRENGTH_MUL`，
   *   由引擎算好传进来，含谜质威胁乘数；不给 = 用本卡的"自然总血"）——新口径下它经平方化成**威胁预算 T**。
   * - `strengthMul`：**校准用覆写**（只有 `tools/wormhole-econ.ts` 会传；引擎/实战一律走常量）。
   * - `tierThreatMul`：**分层威胁预算修正**（浅 1 / 中 1.05 / 深 1.1，见 `WORMHOLE_TIER_THREAT_MUL`）。
   * - `naturalDps`：该卡**自然总火力**（含机群；由调用方按 `createFoeSpecs` 算好传入）——
   *   决定卡的"自然血/火力比 `r`"。缺省 ⇒ 退回 `WORMHOLE_THREAT_REF_RATIO`（等价于"比 = 参考比"）。
   */
  opts?: { hpBudget?: number; strengthMul?: number; tierThreatMul?: number; naturalDps?: number },
): AnomalyDef {
  /**
   * **族定选靶**（船长 2026-09-15「选靶按照族限定」）：族字母可取到就按族表取，
   * 取不到（B/F 等非洞内族，正常路径不该出现）退回卡面字段 ?? 随机 —— **零行为变化**兜底。
   */
  const fam = base.foeFamily
  const familyTargeting: FoeTargetingMode =
    fam !== undefined && fam in WORMHOLE_FAMILY_TARGETING
      ? WORMHOLE_FAMILY_TARGETING[fam as WormholeFamily]
      : (base.foeTargeting ?? 'random')
  const target = wormholeCardThreatOf(base, depth, kind)
  const natural = Math.max(1, wormholeNaturalHp(base))
  const budget = (opts?.hpBudget ?? natural) * (opts?.strengthMul ?? 1)
  /**
   * **2026-09-16 船长改口径（甲案）：「预算不应该只看血量，应该直接考虑血/火力比，或者两个一起看」**
   * ⇒ 预算从"总血"改成**威胁量** `T = 血 × 火力`（≈ 敌人被打死前能打出的总伤害），
   * 卡的自然血/火力比 `r` **原样保留**，血与火力按 `血 = √(T·r)`、`火力 = √(T/r)` 反算：
   * - 层难度曲线仍在：`T = budget² ÷ WORMHOLE_THREAT_REF_RATIO`（budget 已含曲线 ×10 与谜质）；
   * - 档位修正改乘 **T**（浅 1 / 中 1.05 / 深 1.1）⇒ 血与火力**一起**抬，而不是只抬血；
   * - **族系数全部撤除**（D 族的"厚血低伤"由它自己的自然比表达，不再需要专用旋钮）。
   * 效果（改前 → 改后）：15 张卡的"血 × 火力"极差由 **7.69× → 1.00×**（同层同档内恒等）。
   */
  const ratio = opts?.naturalDps !== undefined && opts.naturalDps > 0 ? natural / opts.naturalDps : WORMHOLE_THREAT_REF_RATIO
  const threatBudget = ((budget * budget) / WORMHOLE_THREAT_REF_RATIO) * (opts?.tierThreatMul ?? 1)
  const hpTarget = Math.sqrt(threatBudget * ratio)
  const dpsTarget = Math.sqrt(threatBudget / ratio)
  const scaleHp = hpTarget / natural
  const scaleDmg = opts?.naturalDps !== undefined && opts.naturalDps > 0 ? dpsTarget / opts.naturalDps : scaleHp
  const nWaves = Math.max(1, Math.floor(waves))
  const per = 1 / nWaves
  const slots = base.ships ?? []
  const ships: readonly FoeShipSlot[] | undefined =
    slots.length === 0
      ? base.ships
      : slots.flatMap((slot) =>
          Array.from({ length: nWaves }, (_, i) => ({
            ...slot,
            wave: i,
            hpMul: (slot.hpMul ?? 1) * scaleHp * per,
            dmgMul: (slot.dmgMul ?? 1) * scaleDmg * per,
            ...(slot.firepowerAnchor !== undefined
              ? { firepowerAnchor: Math.max(1, ceilFinalQuantity(slot.firepowerAnchor * scaleDmg * per)) }
              : {}),
          })),
        )
  /** 每波单位数（`waves[]` 只驱动"打几波"，编成由 `slot.wave` 决定；这里给出与实际一致的读数） */
  const perWaveUnits = (ships ?? []).length
    ? Array.from({ length: nWaves }, (_, i) =>
        (ships ?? [])
          .filter((s) => (s.wave ?? 0) === i)
          .reduce((n, s) => n + Math.max(1, Math.floor(s.count ?? 1)), 0),
      )
    : []
  return {
    ...base,
    name:
      kind === 'boss'
        ? `${base.name} · 第 ${depth} 层守卫`
        : kind === 'extract'
          ? // ⚠ 仅老档（撤离战 2026-09-15 退役）：敌名后缀避开已退役的机制名
            `${base.name} · 撤离`
          : `${base.name} · 第 ${depth} 层`,
    threat: target,
    ...(perWaveUnits.length > 0
      ? {
          ships,
          waves: perWaveUnits.map((units) => ({ units: Math.max(1, units), hpShare: 1 })),
        }
      : {}),
    // 层末 BOSS 专挑最大的船（船长 2026-09-13 的五模式里，「打最大的」落在 BOSS 上）；
    // **选靶按族限定**（船长 2026-09-15）：普通用途一律取**族定模式**（卡面字段只作展示/体检断言），
    // BOSS 仍走「打最大的」+ 概率化（船长 2026-09-14「挨个定为 60%」→ 同日改 40%）。
    foeTargeting: kind === 'boss' ? 'largest' : familyTargeting,
    foeTargetingChance:
      kind === 'boss'
        ? WORMHOLE_BOSS_TARGETING_CHANCE
        : familyTargeting === 'random'
          ? 1
          : WORMHOLE_FAMILY_TARGETING_CHANCE,
  }
}
