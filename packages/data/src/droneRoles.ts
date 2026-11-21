import type { DroneClass, ItemDef } from '@whale/core'

export interface DroneRoleSpec {
  label: string
  evasion: readonly [number, number]
  totalHp: readonly [number, number]
  dmgShare: readonly [number, number]
  rangeM: readonly [number, number]
  hitRate: readonly [number, number]
  noFalloff: boolean
}

export const DRONE_ROLE_SPECS: Record<DroneClass, DroneRoleSpec> = {
  scout: {
    label: '侦察机',
    evasion: [0.42, 0.55],
    totalHp: [30, 50],
    dmgShare: [1, 1.4],
    rangeM: [5700, 6000],
    hitRate: [0.7, 0.8],
    noFalloff: true,
  },
  combat: {
    label: '战斗机',
    evasion: [0.2, 0.3],
    totalHp: [70, 100],
    dmgShare: [1.8, 2.4],
    rangeM: [4800, 5200],
    hitRate: [0.7, 0.8],
    noFalloff: true,
  },
  assault: {
    label: '攻坚机',
    evasion: [0.08, 0.14],
    totalHp: [180, 240],
    dmgShare: [3.4, 4.6],
    rangeM: [3800, 4200],
    hitRate: [0.7, 0.8],
    noFalloff: true,
  },
  sentry: {
    label: '哨戒机',
    evasion: [0.15, 0.22],
    totalHp: [36, 60],
    dmgShare: [6, 7.5],
    rangeM: [6000, 7500],
    hitRate: [1, 1.2],
    noFalloff: false,
  },
  repair: {
    label: '修理机', evasion: [0, 0.9], totalHp: [1, 500], dmgShare: [0, 0], rangeM: [500, 20000], hitRate: [0, 2], noFalloff: true,
  },
}

export function droneTotalHp(def: ItemDef): number {
  const d = def.defense
  return (d?.shieldHp ?? 0) + (d?.armorHp ?? 0) + (d?.hullHp ?? 0)
}

export const DRONE_ROLE_ANCHORS: Record<DroneClass, string> = {
  scout: 'drone-scout',
  combat: 'drone-assault',
  assault: 'drone-heavy',
  sentry: 'drone-sentry',
  repair: 'drone-repair-mil',
}

const HARD_BOUNDS = {
  evasion: [0, 0.9],
  dmg: [1, 200],
  totalHp: [1, 500],
  rangeM: [500, 20_000],
  hitRate: [0.2, 2],
} as const

function exclusiveHardBoundIssues(def: ItemDef): string[] {
  const out: string[] = []
  const ev = def.defense?.evasion
  if (ev === undefined) out.push(`${def.id} 缺少 defense.evasion`)
  else if (ev < HARD_BOUNDS.evasion[0] || ev > HARD_BOUNDS.evasion[1]) {
    out.push(`${def.id} 闪避 ${ev} 越出硬边界 ${HARD_BOUNDS.evasion[0]}~${HARD_BOUNDS.evasion[1]}`)
  }
  const hp = droneTotalHp(def)
  if (hp < HARD_BOUNDS.totalHp[0] || hp > HARD_BOUNDS.totalHp[1]) {
    out.push(`${def.id} 三层总血 ${hp} 越出硬边界 ${HARD_BOUNDS.totalHp[0]}~${HARD_BOUNDS.totalHp[1]}`)
  }
  const dmg = def.dmg ?? 0
  if (dmg < HARD_BOUNDS.dmg[0] || dmg > HARD_BOUNDS.dmg[1]) {
    out.push(`${def.id} 单发 ${dmg} 越出硬边界 ${HARD_BOUNDS.dmg[0]}~${HARD_BOUNDS.dmg[1]}`)
  }
  if (def.maxRangeM !== undefined && (def.maxRangeM < HARD_BOUNDS.rangeM[0] || def.maxRangeM > HARD_BOUNDS.rangeM[1])) {
    out.push(`${def.id} 射程 ${def.maxRangeM} 越出硬边界 ${HARD_BOUNDS.rangeM[0]}~${HARD_BOUNDS.rangeM[1]}`)
  }
  const hit = def.hitRate
  if (hit === undefined) out.push(`${def.id} 缺少 hitRate`)
  else if (hit < HARD_BOUNDS.hitRate[0] || hit > HARD_BOUNDS.hitRate[1]) {
    out.push(`${def.id} 命中 ${hit} 越出硬边界 ${HARD_BOUNDS.hitRate[0]}~${HARD_BOUNDS.hitRate[1]}`)
  }
  return out
}

function inBand(v: number, band: readonly [number, number]): boolean {
  return v >= band[0] && v <= band[1]
}

export function droneRoleIssues(def: ItemDef, scoutDmg: number): string[] {
  const cls = def.droneClass
  if (!cls) return [`${def.id} 缺少 droneClass（四型定位契约必填）`]
  if (def.exclusive === true) return exclusiveHardBoundIssues(def)
  const spec = DRONE_ROLE_SPECS[cls]
  if (cls === 'repair') return def.repairDrone === true && (def.repairKit !== undefined) ? [] : [`${def.id} 修理无人机字段不完整`]
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

export function droneRoleLadderIssues(drones: readonly ItemDef[]): string[] {
  const out: string[] = []
  const byClass = new Map<DroneClass, ItemDef>()
  for (const [cls, anchorId] of Object.entries(DRONE_ROLE_ANCHORS) as Array<[DroneClass, string]>) {
    const anchor = drones.find((d) => d.id === anchorId)
    if (anchor) byClass.set(cls, anchor)
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
