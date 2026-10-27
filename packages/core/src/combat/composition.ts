/** 功能域职责拆分，保持原计算与顺序。 */
import type { DamageType, AnomalyDef, DefProfile } from '../types'
import type { Hp3 } from '../combatMath'

/**
 * **2026-10-02 破环搬家**（原住 combat.ts）：火力构成两件。
 * 为什么搬到这里：本件是 `foeDamageComposition` 唯一的跨模块消费者，而 combat 又要 import 本件的
 * 虫洞强度件 ⇒ `combat ↔ wormholeFoes` 互相依赖；这两件是**纯构成计算**（只依赖 types）⇒
 * 搬来后 wormholeFoes 不再 import combat，环断（combat 侧原样再导出，既有引用不动）。
 */

/** 火力构成（按 **mix 对象**计算）——2026-09-11 舰级表试点抽出：舰级/编成条目的 mix 可能与
 * 卡面声明不同（如"同一艘船缴获改装了不同弹药"），故把口径与"读哪份 mix"解耦。 */
export function compositionOfMix(
  mix: Partial<Record<DamageType, number>> | undefined,
): Array<{ type: DamageType; share: number }> {
  const rows = (['kinetic', 'explosive', 'plasma'] as const)
    .map((t) => ({ type: t, w: mix?.[t] ?? 0 }))
    .filter((r) => r.w > 0)
  if (rows.length <= 1) return [{ type: rows[0]?.type ?? 'kinetic', share: 1 }]
  const total = rows.reduce((s, r) => s + r.w, 0)
  return rows
    .map((r) => ({ type: r.type, share: r.w / total }))
    .sort((a, b) => b.share - a.share || a.type.localeCompare(b.type))
}

/** 敌方火力构成（按卡读 `anomaly.dmgMix`）：返回按份额降序的 `[{ type, share }]`（份额归一化、和 = 1）。
 *  - 写了两系及以上（常驻悬赏/低安遇袭 8:2、窝点派生 6:4）→ 逐系份额；
 *  - 只写一系 / 未写（教学卡）→ 单条 `{ 主系, 1 }`（纯系）。 */
export function foeDamageComposition(anomaly: AnomalyDef): Array<{ type: DamageType; share: number }> {
  return compositionOfMix(anomaly.dmgMix)
}

/** 主系（权重最高；未写/空 = 动能）——**正权重键才参战**（2026-09-10 语义变更：旧"缺省键权重 1"作废） */
export function pickTopType(mix: Partial<Record<DamageType, number>> | undefined): DamageType {
  let best: DamageType = 'kinetic'
  let bestW = 0
  for (const t of ['kinetic', 'explosive', 'plasma'] as const) {
    const w = mix?.[t] ?? 0
    if (w > bestW) {
      bestW = w
      best = t
    }
  }
  return best
}

/** 敌方编队主伤害类型（V17 导出；卡面 dmgMix 取最高权重，缺省 = 动能）——悬赏卡展示/玩家配抗参考 */
export function foeMainDamageType(anomaly: AnomalyDef): DamageType {
  return pickTopType(anomaly.dmgMix)
}

/**
 * 把一次开火的总伤害按火力构成**拆成逐系单发**（2026-09-10：窝点混伤）。
 * 取整口径：先按份额分配、**最后一条吃余数**，保证 Σ = 总单发（敌总伤不变，只改构成）。
 * 返回空数组 = 总伤为 0（调用方跳过）。
 */
export function splitShotByComposition(
  shotDmg: number,
  comp: ReadonlyArray<{ type: DamageType; share: number }>,
): Array<{ type: DamageType; dmg: number }> {
  if (shotDmg <= 0) return []
  if (comp.length <= 1) return [{ type: comp[0]?.type ?? 'kinetic', dmg: shotDmg }]
  const out: Array<{ type: DamageType; dmg: number }> = []
  let left = shotDmg
  comp.forEach((c, i) => {
    const dmg = i === comp.length - 1 ? left : Math.max(1, Math.round(shotDmg * c.share))
    const take = Math.min(left, dmg)
    out.push({ type: c.type, dmg: take })
    left -= take
  })
  return out.filter((r) => r.dmg > 0)
}

/** 血型层占比表（盾型 50/25/25 · 甲型 20/55/25 · 均衡 33/33/33；createFoeSpecs 与 foeLayerSplit 同源） */
export const PROFILE_SPLIT: Record<string, Hp3> = {
  shield: { s: 0.5, a: 0.25, h: 0.25 },
  armor: { s: 0.2, a: 0.55, h: 0.25 },
  balanced: { s: 0.34, a: 0.33, h: 0.33 },
}

/** 敌方血型层占比（V17.2 导出；悬赏卡"敌型"展示——与 createFoeSpecs 同源）：
 * 盾型 50/25/25 · 甲型 20/55/25 · 均衡 33/33/33（盾/甲/结构） */
export function foeLayerSplit(profile: DefProfile | undefined): { s: number; a: number; h: number } {
  return PROFILE_SPLIT[profile ?? 'balanced'] ?? PROFILE_SPLIT.balanced!
}
