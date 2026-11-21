import type { WormholeHoldState } from './wormholeHold'
import type { CoreBlockReason } from './engine'

export type WormholeMatterEffectKind =
  | 'scanRadius'
  | 'turnBudget'
  | 'salvagePiles'
  | 'collectPiles'
  | 'nebulaDisperse'
  | 'oreYieldPct'
  | 'holdCells'
  | 'threatAll'
  | 'threatBoss'
  | 'threatExtract'
  | 'resistShield'
  | 'resistArmor'
  | 'resistHull'
  | 'hitBonus'
  | 'evasion'
  | 'enemyHitDown'
  | 'weaponRangePct'
  | 'blindReduce'
  | 'damagePct'
  | 'reloadPct'
  | 'volleyOverflow'
  | 'ammoRefundPct'
  | 'droneRecoveryPct'
  | 'fieldRepairPct'

export interface WormholeMatterDevice {
  id: string
  name: string
  short: string
  effect: WormholeMatterEffectKind
  per: number
  text: string
  retired?: boolean
}

export const WORMHOLE_MATTER_THREAT_FLOOR_MUL = 0.5
export const WORMHOLE_MATTER_EVASION_CAP = 0.25
export const WORMHOLE_MATTER_ENEMY_HIT_DOWN_CAP = 0.25
export const WORMHOLE_MATTER_RESIST_CAP = 0.9

export const WORMHOLE_MATTER_DEVICES: readonly WormholeMatterDevice[] = [
  {
    id: 'mat-surveyor',
    short: '测绘',
    name: '深空测绘仪',
    effect: 'scanRadius',
    per: 1,
    text: '扫描半径 +1 圈',
  },
  {
    id: 'mat-chrono',
    short: '时序',
    name: '时序核心',
    effect: 'turnBudget',
    per: 10,
    text: '本趟回合上限 +10',
  },
  {
    id: 'mat-crane',
    short: '起重',
    name: '打捞起重机',
    effect: 'salvagePiles',
    per: 1,
    text: '每次打捞 +1 堆',
  },
  {
    id: 'mat-drill',
    short: '钻机',
    name: '采集钻机',
    effect: 'collectPiles',
    per: 1,
    text: '每次采集 +1 堆',
  },
  {
    id: 'mat-nebula',
    short: '驱散',
    name: '星云驱散器',
    effect: 'nebulaDisperse',
    per: 2,
    text: '每次扫描额外驱散 2 格星云',
  },
  {
    id: 'mat-enricher',
    short: '富集',
    name: '母矿富集器',
    effect: 'oreYieldPct',
    per: 0.25,
    text: '采到的虚空母矿 +25%',
  },
  {
    id: 'mat-expander',
    short: '扩展',
    name: '舱段扩展器',
    effect: 'holdCells',
    per: 8,
    text: '货仓有效格数 +8',
  },
  {
    id: 'mat-suppressor',
    short: '压制',
    name: '压制力场',
    effect: 'threatAll',
    per: 0.05,
    text: '本层威胁 −5%（节点 / 守卫同源）',
  },
  {
    id: 'mat-boss-analyzer',
    short: '解析',
    name: '守卫解析仪',
    effect: 'threatBoss',
    per: 0.1,
    text: '层末守卫威胁 −10%',
  },
  {
    id: 'mat-extract-cover',
    short: '掩护',
    name: '撤离掩护器',
    effect: 'threatExtract',
    per: 0.1,
    text: '谜质凝成的一层薄壳：已不再提供增益',
    retired: true,
  },
  {
    id: 'mat-shield-res',
    short: '盾谐',
    name: '护盾谐振片',
    effect: 'resistShield',
    per: 0.1,
    text: '护盾对敌方主伤害系抗性 +10 点（只作用护盾）',
  },
  {
    id: 'mat-armor-res',
    short: '甲固',
    name: '装甲强化片',
    effect: 'resistArmor',
    per: 0.1,
    text: '装甲对敌方主伤害系抗性 +10 点（只作用装甲）',
  },
  {
    id: 'mat-hull-res',
    short: '构固',
    name: '结构加固片',
    effect: 'resistHull',
    per: 0.1,
    text: '结构对敌方主伤害系抗性 +10 点（只作用结构）',
  },
  {
    id: 'mat-tracker',
    short: '追踪',
    name: '追踪阵列',
    effect: 'hitBonus',
    per: 0.05,
    text: '我方命中 +0.05',
  },
  {
    id: 'mat-gyro',
    short: '陀螺',
    name: '陀螺稳定器',
    effect: 'evasion',
    per: 0.05,
    text: '我方回避 +0.05（最多 +0.25）',
  },
  {
    id: 'mat-jammer',
    short: '干扰',
    name: '干扰发射器',
    effect: 'enemyHitDown',
    per: 0.05,
    text: '敌方命中 −0.05（最多 −0.25）',
  },
  {
    id: 'mat-rangefinder',
    short: '射程',
    name: '射程扩展器',
    effect: 'weaponRangePct',
    per: 0.1,
    text: '全武器射程 +10%',
  },
  {
    id: 'mat-blindspot',
    short: '盲区',
    name: '盲区压制器',
    effect: 'blindReduce',
    per: 0.05,
    text: '敌方贴脸开火的伤害比例 −0.05',
  },
  {
    id: 'mat-ammo-dmg',
    short: '弹效',
    name: '弹药增效器',
    effect: 'damagePct',
    per: 0.08,
    text: '我方单发伤害 +8%',
  },
  {
    id: 'mat-reload',
    short: '装填',
    name: '装填加速器',
    effect: 'reloadPct',
    per: 0.08,
    text: '武器装填周期 −8%',
  },
  {
    id: 'mat-volley',
    short: '齐射',
    name: '齐射协调仪',
    effect: 'volleyOverflow',
    per: 1,
    text: '齐射打死后，多余的火力转给下一艘敌舰',
  },
  {
    id: 'mat-ammo-back',
    short: '回收',
    name: '弹药回收装置',
    effect: 'ammoRefundPct',
    per: 0.25,
    text: '战后弹药退款 +25%（按本场打出去的折算）',
  },
  {
    id: 'mat-drone-net',
    short: '机网',
    name: '机群回收网',
    effect: 'droneRecoveryPct',
    per: 0.1,
    text: '机群回收率 +10 个百分点',
  },
  {
    id: 'mat-field-repair',
    short: '维修',
    name: '战地维修单元',
    effect: 'fieldRepairPct',
    per: 0.05,
    text: '战后装甲与结构各 +5%（不耗货仓组件）',
  },
]

export const WORMHOLE_MATTER_DEVICE_IDS: readonly string[] = WORMHOLE_MATTER_DEVICES.map((d) => d.id)

export const WORMHOLE_MATTER_DRAW_POOL: readonly WormholeMatterDevice[] = WORMHOLE_MATTER_DEVICES.filter(
  (d) => d.retired !== true,
)

const BY_ID: ReadonlyMap<string, WormholeMatterDevice> = new Map(WORMHOLE_MATTER_DEVICES.map((d) => [d.id, d]))

export function wormholeMatterDeviceOf(itemId: string): WormholeMatterDevice | undefined {
  return BY_ID.get(itemId)
}

export function wormholeIsMatterDevice(itemId: string): boolean {
  return BY_ID.has(itemId)
}

export function wormholeMatterCounts(
  hold: WormholeHoldState | null | undefined,
): ReadonlyArray<{ device: WormholeMatterDevice; count: number }> {
  const byId = new Map<string, number>()
  for (const p of hold?.placements ?? []) {
    if (wormholeIsMatterDevice(p.itemId)) byId.set(p.itemId, (byId.get(p.itemId) ?? 0) + 1)
  }
  return WORMHOLE_MATTER_DEVICES.filter((d) => (byId.get(d.id) ?? 0) > 0).map((d) => ({
    device: d,
    count: byId.get(d.id) ?? 0,
  }))
}

export interface WormholeMatterBuffs {
  devices: number
  scanRadius: number
  turnBonus: number
  salvagePiles: number
  collectPiles: number
  nebulaDisperse: number
  oreYieldMul: number
  holdCells: number
  threatNodeMul: number
  threatBossMul: number
  threatExtractMul: number
  resistShield: number
  resistArmor: number
  resistHull: number
  hitBonus: number
  evasion: number
  enemyHitDown: number
  weaponRangePct: number
  blindReduce: number
  damagePct: number
  reloadPct: number
  volleyOverflow: boolean
  ammoRefundPct: number
  droneRecoveryPct: number
  fieldRepairPct: number
  list: ReadonlyArray<{ device: WormholeMatterDevice; count: number }>
}

export const WORMHOLE_MATTER_BUFFS_NONE: WormholeMatterBuffs = {
  devices: 0,
  scanRadius: 0,
  turnBonus: 0,
  salvagePiles: 0,
  collectPiles: 0,
  nebulaDisperse: 0,
  oreYieldMul: 1,
  holdCells: 0,
  threatNodeMul: 1,
  threatBossMul: 1,
  threatExtractMul: 1,
  resistShield: 0,
  resistArmor: 0,
  resistHull: 0,
  hitBonus: 0,
  evasion: 0,
  enemyHitDown: 0,
  weaponRangePct: 0,
  blindReduce: 0,
  damagePct: 0,
  reloadPct: 0,
  volleyOverflow: false,
  ammoRefundPct: 0,
  droneRecoveryPct: 0,
  fieldRepairPct: 0,
  list: [],
}

export function wormholeMatterThreatMul(buffs: WormholeMatterBuffs, kind: 'node' | 'boss' | 'extract'): number {
  const extra = kind === 'boss' ? buffs.threatBossMul : kind === 'extract' ? buffs.threatExtractMul : 1
  const mul = buffs.threatNodeMul * extra
  return Math.max(WORMHOLE_MATTER_THREAT_FLOOR_MUL, Math.min(1, mul))
}

export interface WormholeTechBuffs {
  scanRadius: number
  turnBonus: number
  holdCells: number
  resistShield: number
  resistArmor: number
  resistHull: number
  hitBonus: number
  evasion: number
  enemyHitDown: number
  weaponRangePct: number
  reloadPct: number
  damagePct: number
  blindReduce: number
  threatNode: number
  threatBoss: number
  droneRecoveryPct: number
  fieldRepairPct: number
}

export const WORMHOLE_TECH_BUFFS_NONE: WormholeTechBuffs = {
  scanRadius: 0,
  turnBonus: 0,
  holdCells: 0,
  resistShield: 0,
  resistArmor: 0,
  resistHull: 0,
  hitBonus: 0,
  evasion: 0,
  enemyHitDown: 0,
  weaponRangePct: 0,
  reloadPct: 0,
  damagePct: 0,
  blindReduce: 0,
  threatNode: 0,
  threatBoss: 0,
  droneRecoveryPct: 0,
  fieldRepairPct: 0,
}

export function wormholeMatterBuffs(
  hold: WormholeHoldState | null | undefined,
  tech?: WormholeTechBuffs,
): WormholeMatterBuffs {
  const list = wormholeMatterCounts(hold)
  if (list.length === 0 && tech === undefined) return WORMHOLE_MATTER_BUFFS_NONE
  const out: WormholeMatterBuffs = { ...WORMHOLE_MATTER_BUFFS_NONE, list }
  let threatAll = 0
  let threatBoss = 0
  let threatExtract = 0
  if (tech !== undefined) {
    out.scanRadius += tech.scanRadius
    out.turnBonus += tech.turnBonus
    out.holdCells += tech.holdCells
    out.resistShield += tech.resistShield
    out.resistArmor += tech.resistArmor
    out.resistHull += tech.resistHull
    out.hitBonus += tech.hitBonus
    out.evasion += tech.evasion
    out.enemyHitDown += tech.enemyHitDown
    out.weaponRangePct += tech.weaponRangePct
    out.reloadPct += tech.reloadPct
    out.damagePct += tech.damagePct
    out.blindReduce += tech.blindReduce
    out.droneRecoveryPct += tech.droneRecoveryPct
    out.fieldRepairPct += tech.fieldRepairPct
    threatAll += tech.threatNode
    threatBoss += tech.threatBoss
  }
  for (const { device, count } of list) {
    out.devices += count
    const v = device.per * count
    switch (device.effect) {
      case 'scanRadius':
        out.scanRadius += v
        break
      case 'turnBudget':
        out.turnBonus += v
        break
      case 'salvagePiles':
        out.salvagePiles += v
        break
      case 'collectPiles':
        out.collectPiles += v
        break
      case 'nebulaDisperse':
        out.nebulaDisperse += v
        break
      case 'oreYieldPct':
        out.oreYieldMul += v
        break
      case 'holdCells':
        out.holdCells += v
        break
      case 'threatAll':
        threatAll += v
        break
      case 'threatBoss':
        threatBoss += v
        break
      case 'threatExtract':
        threatExtract += v
        break
      case 'resistShield':
        out.resistShield += v
        break
      case 'resistArmor':
        out.resistArmor += v
        break
      case 'resistHull':
        out.resistHull += v
        break
      case 'hitBonus':
        out.hitBonus += v
        break
      case 'evasion':
        out.evasion += v
        break
      case 'enemyHitDown':
        out.enemyHitDown += v
        break
      case 'weaponRangePct':
        out.weaponRangePct += v
        break
      case 'blindReduce':
        out.blindReduce += v
        break
      case 'damagePct':
        out.damagePct += v
        break
      case 'reloadPct':
        out.reloadPct += v
        break
      case 'volleyOverflow':
        out.volleyOverflow = true
        break
      case 'ammoRefundPct':
        out.ammoRefundPct += v
        break
      case 'droneRecoveryPct':
        out.droneRecoveryPct += v
        break
      case 'fieldRepairPct':
        out.fieldRepairPct += v
        break
    }
  }
  out.threatNodeMul = 1 - threatAll
  out.threatBossMul = 1 - threatBoss
  out.threatExtractMul = 1 - threatExtract
  out.resistShield = Math.min(WORMHOLE_MATTER_RESIST_CAP, out.resistShield)
  out.resistArmor = Math.min(WORMHOLE_MATTER_RESIST_CAP, out.resistArmor)
  out.resistHull = Math.min(WORMHOLE_MATTER_RESIST_CAP, out.resistHull)
  out.evasion = Math.min(WORMHOLE_MATTER_EVASION_CAP, out.evasion)
  out.enemyHitDown = Math.min(WORMHOLE_MATTER_ENEMY_HIT_DOWN_CAP, out.enemyHitDown)
  out.blindReduce = Math.max(0, out.blindReduce)
  out.ammoRefundPct = Math.min(1, out.ammoRefundPct)
  out.droneRecoveryPct = Math.min(1, out.droneRecoveryPct)
  out.fieldRepairPct = Math.min(1, out.fieldRepairPct)
  return out
}

export function wormholeMatterDeviceAt(seed: number, depth: number, cellKey: string): WormholeMatterDevice {
  let h = (Math.imul(seed | 0, 2654435761) ^ Math.imul(depth | 0, 40503)) >>> 0
  for (let i = 0; i < cellKey.length; i++) h = Math.imul(h ^ cellKey.charCodeAt(i), 16777619) >>> 0
  return WORMHOLE_MATTER_DRAW_POOL[h % WORMHOLE_MATTER_DRAW_POOL.length]!
}

export function wormholeMatterTurnDeltaOf(itemId: string): number {
  const d = wormholeMatterDeviceOf(itemId)
  return d && d.effect === 'turnBudget' ? d.per : 0
}

export function wormholeMatterApplyTurnDelta(
  run: { turnsLeft: number; turnsTotal: number; turnsSpent?: number },
  itemId: string,
  sign: 1 | -1,
): void {
  const delta = wormholeMatterTurnDeltaOf(itemId)
  if (delta === 0) return
  const spent = Math.max(run.turnsSpent ?? 0, run.turnsTotal - run.turnsLeft)
  run.turnsSpent = spent
  run.turnsTotal = Math.max(0, run.turnsTotal + sign * delta)
  run.turnsLeft = Math.min(run.turnsTotal, Math.max(0, run.turnsTotal - spent))
}

export function wormholeMatterDiscardHint(itemId: string): CoreBlockReason | null {
  const delta = wormholeMatterTurnDeltaOf(itemId)
  if (delta === 0) return null
  const deviceName = wormholeMatterDeviceOf(itemId)?.name ?? itemId
  return {
    error: `丢掉「${deviceName}」会少 ${delta} 回合：可能走不到想去的格子（撤离不受影响，任何回合数都能撤）。`,
    errorId: 'ui.Wormhole.380',
    errorParams: { p1: deviceName, p2: delta },
  }
}
