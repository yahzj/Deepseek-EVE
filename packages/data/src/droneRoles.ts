/**
 * 无人机四型定位契约（2026-09-10 船长拍板，已确认）——
 * 四型各有明确 role，**新增无人机必须落在本契约区间内**（content:check 与 core 测试双重守卫，
 * 改数据即被拦下，不必靠人记）。
 *
 *   侦察机（scout）  ：闪避最高、装甲最薄——生存靠机动
 *   战斗机（combat） ：全属性平均——机群主力
 *   攻坚机（assault）：血量最厚、单发高、闪避最低——贴脸重击
 *   哨戒机（sentry） ：射程最远、单发最高（狙击）；血量与侦察机相仿、闪避次低——靠距离活命
 *
 * 火力梯子（以侦察机单发为 1×）：1 / 2 / 4 / 6.7；命中口径：侦察·战斗·攻坚三型 75% 且
 * **不随距离衰减**（falloff 1），哨戒 110% 且**保留衰减**（falloff 0.35）。
 * 现行四型（蜂鸟 / 赤鸢 / 猎鹰 / 雷鸥）即本契约的锚点机型。
 */
import type { DroneClass, ItemDef } from '@whale/core'

export interface DroneRoleSpec {
  label: string
  /** 闪避区间（跨类必须严格递减：侦察 > 战斗 > 哨戒 > 攻坚） */
  evasion: readonly [number, number]
  /** 三层血量合计区间 */
  totalHp: readonly [number, number]
  /** 单发相对侦察机基准的倍数区间 */
  dmgShare: readonly [number, number]
  rangeM: readonly [number, number]
  hitRate: readonly [number, number]
  /** true = falloff 必须为 1（命中不随距离衰减） */
  noFalloff: boolean
}

export const DRONE_ROLE_SPECS: Record<DroneClass, DroneRoleSpec> = {
  scout: {
    label: '侦察机',
    evasion: [0.42, 0.55],
    totalHp: [15, 25],
    dmgShare: [1, 1.4],
    rangeM: [2000, 2800],
    hitRate: [0.7, 0.8],
    noFalloff: true,
  },
  combat: {
    label: '战斗机',
    evasion: [0.2, 0.3],
    totalHp: [35, 50],
    dmgShare: [1.8, 2.4],
    rangeM: [2800, 3200],
    hitRate: [0.7, 0.8],
    noFalloff: true,
  },
  assault: {
    label: '攻坚机',
    evasion: [0.08, 0.14],
    totalHp: [90, 120],
    dmgShare: [3.4, 4.6],
    rangeM: [3300, 3800],
    hitRate: [0.7, 0.8],
    noFalloff: true,
  },
  sentry: {
    label: '哨戒机',
    evasion: [0.15, 0.22],
    totalHp: [18, 30],
    dmgShare: [6, 7.5],
    rangeM: [4500, 6000],
    hitRate: [1, 1.2],
    noFalloff: false,
  },
}

/** 无人机三层血量合计（生存包契约口径） */
export function droneTotalHp(def: ItemDef): number {
  const d = def.defense
  return (d?.shieldHp ?? 0) + (d?.armorHp ?? 0) + (d?.hullHp ?? 0)
}

function inBand(v: number, band: readonly [number, number]): boolean {
  return v >= band[0] && v <= band[1]
}

/** 单机定位校验：类档位区间（返回违规说明；空数组 = 合规） */
export function droneRoleIssues(def: ItemDef, scoutDmg: number): string[] {
  const cls = def.droneClass
  if (!cls) return [`${def.id} 缺少 droneClass（四型定位契约必填）`]
  const spec = DRONE_ROLE_SPECS[cls]
  const out: string[] = []
  const evasion = def.defense?.evasion
  if (evasion === undefined) out.push(`${def.id} 缺少 defense.evasion`)
  else if (!inBand(evasion, spec.evasion)) {
    out.push(`${def.id}（${spec.label}）闪避 ${evasion} 越出定位档 ${spec.evasion[0]}~${spec.evasion[1]}`)
  }
  const hp = droneTotalHp(def)
  if (!inBand(hp, spec.totalHp)) {
    out.push(`${def.id}（${spec.label}）三层总血 ${hp} 越出定位档 ${spec.totalHp[0]}~${spec.totalHp[1]}`)
  }
  const share = scoutDmg > 0 ? (def.dmg ?? 0) / scoutDmg : 0
  if (!inBand(share, spec.dmgShare)) {
    out.push(
      `${def.id}（${spec.label}）单发 ${def.dmg ?? 0} = 侦察机 ${share.toFixed(2)}× 越出定位档 ${spec.dmgShare[0]}~${spec.dmgShare[1]}×`,
    )
  }
  if (def.maxRangeM !== undefined && !inBand(def.maxRangeM, spec.rangeM)) {
    out.push(`${def.id}（${spec.label}）射程 ${def.maxRangeM} 越出定位档 ${spec.rangeM[0]}~${spec.rangeM[1]}`)
  }
  const hit = def.hitRate
  if (hit === undefined) out.push(`${def.id} 缺少 hitRate`)
  else if (!inBand(hit, spec.hitRate)) {
    out.push(`${def.id}（${spec.label}）命中 ${hit} 越出定位档 ${spec.hitRate[0]}~${spec.hitRate[1]}`)
  }
  const ff = def.falloff ?? 0.35
  if (spec.noFalloff && ff !== 1) {
    out.push(`${def.id}（${spec.label}）应不随距离衰减（falloff = 1），实际 ${ff}`)
  }
  if (!spec.noFalloff && (ff >= 1 || ff < 0.2)) {
    out.push(`${def.id}（${spec.label}）应保留距离衰减（falloff 0.2~1 之间），实际 ${ff}`)
  }
  return out
}

/**
 * 全局阶梯校验：跨四类的单调关系（返回违规说明；空数组 = 合规）。
 * ① 闪避：侦察 > 战斗 > 哨戒 > 攻坚（严格）
 * ② 血量：攻坚 > 战斗 > 侦察，且哨戒 ≤ 侦察 ×1.6（"血量与侦察机相仿"）且 < 战斗
 * ③ 单发：侦察 < 战斗 < 攻坚 < 哨戒
 * 缺失某一类时不报错（允许尚未实装的机型缺席），但已存在的类之间必须成立。
 */
export function droneRoleLadderIssues(drones: readonly ItemDef[]): string[] {
  const out: string[] = []
  const byClass = new Map<DroneClass, ItemDef>()
  for (const d of drones) {
    if (d.droneClass) byClass.set(d.droneClass, d)
  }
  const ev = (c: DroneClass): number | null => byClass.get(c)?.defense?.evasion ?? null
  const hp = (c: DroneClass): number | null => {
    const d = byClass.get(c)
    return d ? droneTotalHp(d) : null
  }
  const dmg = (c: DroneClass): number | null => byClass.get(c)?.dmg ?? null

  const ladder: Array<[DroneClass, DroneClass]> = [
    ['scout', 'combat'],
    ['combat', 'sentry'],
    ['sentry', 'assault'],
  ]
  for (const [a, b] of ladder) {
    const va = ev(a)
    const vb = ev(b)
    if (va !== null && vb !== null && !(va > vb)) {
      out.push(`闪避阶梯：${DRONE_ROLE_SPECS[a].label} ${va} 应严格高于 ${DRONE_ROLE_SPECS[b].label} ${vb}`)
    }
  }
  const hpAssault = hp('assault')
  const hpCombat = hp('combat')
  const hpScout = hp('scout')
  const hpSentry = hp('sentry')
  if (hpAssault !== null && hpCombat !== null && !(hpAssault > hpCombat)) {
    out.push(`血量阶梯：攻坚机 ${hpAssault} 应严格厚于战斗机 ${hpCombat}`)
  }
  if (hpCombat !== null && hpScout !== null && !(hpCombat > hpScout)) {
    out.push(`血量阶梯：战斗机 ${hpCombat} 应严格厚于侦察机 ${hpScout}`)
  }
  if (hpSentry !== null && hpScout !== null && hpSentry > hpScout * 1.6) {
    out.push(`血量契约：哨戒机 ${hpSentry} 应与侦察机 ${hpScout} 相仿（上限 ${hpScout}×1.6）`)
  }
  if (hpSentry !== null && hpCombat !== null && hpSentry >= hpCombat) {
    out.push(`血量阶梯：哨戒机 ${hpSentry} 应薄于战斗机 ${hpCombat}`)
  }
  const dm = (['scout', 'combat', 'assault', 'sentry'] as const).map((c) => [c, dmg(c)] as const)
  for (let i = 1; i < dm.length; i++) {
    const [ca, da] = dm[i - 1]!
    const [cb, db] = dm[i]!
    if (da !== null && db !== null && !(db > da)) {
      out.push(`火力阶梯：${DRONE_ROLE_SPECS[cb].label} 单发 ${db} 应高于 ${DRONE_ROLE_SPECS[ca].label} ${da}`)
    }
  }
  return out
}
