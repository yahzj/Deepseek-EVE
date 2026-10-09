import type { AnomalyDef, BattleBalance, FoeShipDef, FoeShipSlot, FoeSupportBranch, SimContext } from './types'
import type { WormholeFamily } from './state'
import type { UnitSpec } from './combat'
import { createFoeSpecs } from './foeSpecs'
import { foeFamilyHpMulOf, foeHpOfThreat, foeMultiShipCompMul, foeThreatRatingOf } from './foePower'
import { FOE_MOUNT_IDS, resolveFoeMounts } from './foeMounts'
import {
  WORMHOLE_FAMILY_CARDS,
  WORMHOLE_FAMILY_TARGETING,
  WORMHOLE_FAMILY_TARGETING_CHANCE,
  WORMHOLE_FOE_BASE_STRENGTH_MUL,
  WORMHOLE_THREAT_BASE,
  WORMHOLE_THREAT_REF_RATIO,
  wormholeSkippedBranch,
} from './wormholeFoes'

export type WormholeExpeditionFoeRole = 'ordinary' | 'elite' | 'guard' | 'patrol' | 'event'

/** 保存派生输入；新趟战斗不向共享 ctx 注册临时卡。 */
export interface WormholeExpeditionFoeSpec {
  family: WormholeFamily
  depth: number
  expeditionRules: number
  expeditionRole: WormholeExpeditionFoeRole
  guardSupportDisabled?: boolean
}

/** 数据层可注入未进旧卡的舰级；core 不反向导入 data。 */
export type WormholeExpeditionFoeContext = SimContext & {
  foeShips?: ReadonlyMap<string, FoeShipDef>
}

export interface WormholeExpeditionFoeStrength {
  hp: number
  dps: number
  x: number
}

export interface WormholeExpeditionFoeMods {
  threatMul?: number
  foeHitDown?: number
  blindReduce?: number
}

export interface WormholeExpeditionFoePlan {
  family: WormholeFamily
  depth: number
  role: WormholeExpeditionFoeRole
  disabledSupport: boolean
  templateId: string
  scale: number
  /** 未解除支援时的总预算；不是主力之外再附送的预算。 */
  budget: WormholeExpeditionFoeStrength
  /** 实际会到场的一支，且不把待命备用机当成常驻齐射。 */
  strength: WormholeExpeditionFoeStrength
  pointDefense: {
    threatJudged: number
    unitTags: readonly string[]
  }
  /** 直接用于 UnitSpec.foeRepairPulse.k，不再读取展示威胁。 */
  repairScale: number
}

export interface WormholeExpeditionFoeCard extends AnomalyDef {
  expeditionFoe: WormholeExpeditionFoePlan
  wormholeRepairScale: number
  wormholePdTags: readonly string[]
}

export type WormholeExpeditionUnitSpec = UnitSpec & { foePointDefenseEnabled: boolean }

const ROLE_SCALE: Readonly<Record<WormholeExpeditionFoeRole, number>> = {
  ordinary: 1,
  elite: 1.2,
  guard: 1.15,
  patrol: 1,
  event: 1,
}

function cloneSlot(slot: FoeShipSlot): FoeShipSlot {
  return structuredClone(slot)
}

function templateOf(ctx: SimContext, family: WormholeFamily, tier: 'shallow' | 'mid' | 'deep'): AnomalyDef {
  const id = WORMHOLE_FAMILY_CARDS[family]?.[tier]
  const card = id ? ctx.anomalies.get(id) : undefined
  if (!card || card.foeFamily !== family || !card.ships?.length) {
    throw new Error(`wormhole-expedition-template-missing:${family}:${tier}`)
  }
  const copy = structuredClone(card)
  delete copy.wormholeRepairScale
  delete copy.wormholePdTags
  return copy
}

function removeMount(slot: FoeShipSlot, id: string): void {
  slot.mounts = (slot.mounts ?? slot.ship.mounts ?? []).filter((mount) => mount !== id)
  delete slot.foeMountNamePairs
}

function ordinaryTemplate(ctx: SimContext, family: WormholeFamily): AnomalyDef {
  const card = templateOf(ctx, family, 'shallow')
  for (const slot of card.ships!) {
    delete slot.enterAt
    delete slot.enterBranch
    removeMount(slot, FOE_MOUNT_IDS.supportCall)
    removeMount(slot, FOE_MOUNT_IDS.captureWeb)
    delete slot.ship.droneReserve
  }
  return card
}

function representativeTemplate(ctx: WormholeExpeditionFoeContext, family: WormholeFamily): AnomalyDef {
  if (family === 'C') return templateOf(ctx, family, 'mid')
  const card = templateOf(ctx, family, 'deep')
  if (family === 'A') {
    const head = card.ships!.find((slot) => slot.ship.elite === true)
    const web = card.ships!.find((slot) => resolveFoeMounts(slot.mounts ?? slot.ship.mounts).foeCaptureWeb)
    if (!head || !web || head === web) throw new Error('wormhole-expedition-pirate-template-invalid')
    card.ships = [cloneSlot(head), cloneSlot(web)].map((slot) => ({ ...slot, count: 1 }))
  }
  if (family === 'G') {
    const tender = ctx.foeShips?.get('foe-g-remnant-tender') ?? [...ctx.anomalies.values()]
      .flatMap((anomaly) => anomaly.ships ?? [])
      .find((slot) => slot.ship.id === 'foe-g-remnant-tender')?.ship
    if (!tender || tender.family !== 'G' || !(tender.repairPct! > 0)) {
      throw new Error('wormhole-expedition-foe-ship-missing:foe-g-remnant-tender')
    }
    const head = cloneSlot(card.ships![0]!)
    delete head.ship.drones
    delete head.ship.droneReserve
    // 依据 §16.5：无自修的后勤排在现有自动选靶顺序可先攻击的位置。
    const support: FoeShipSlot = { ship: structuredClone(tender), count: 1, mounts: [] }
    delete support.ship.drones
    delete support.ship.droneReserve
    card.ships = [support, head]
  }
  return card
}

function rawSpecs(card: AnomalyDef, bal: BattleBalance): UnitSpec[] {
  return createFoeSpecs(card, bal)
}

function sumStrength(specs: readonly UnitSpec[], branch?: FoeSupportBranch, skip?: FoeSupportBranch | null, beforeFamilyHp = false): WormholeExpeditionFoeStrength {
  let hp = 0
  let dps = 0
  for (const spec of specs) {
    if (branch !== undefined && spec.foeReinforceBranch !== branch) continue
    if (skip != null && spec.foeReinforceBranch === skip) continue
    hp += (spec.hp.s + spec.hp.a + spec.hp.h) / (beforeFamilyHp ? foeFamilyHpMulOf(spec.family) : 1)
    for (const weapon of spec.weapons) {
      if (weapon.reserve === true) continue
      dps += (weapon.shotDmg ?? 0) * (weapon.count ?? 1) * 1000 / Math.max(1, weapon.reloadMs)
    }
  }
  return { hp, dps, x: Math.sqrt(hp * dps) }
}

/** 血/名义火力读数沿用真实建档，互斥支援只记一支，备用机只记库存。 */
export function wormholeExpeditionStrengthOf(card: AnomalyDef, bal: BattleBalance): WormholeExpeditionFoeStrength {
  return sumStrength(rawSpecs(card, bal), undefined, wormholeSkippedBranch(card))
}

/** 用真实建档反解 dmgMul，兼容单发取整、机炮拆分及既有越线折扣。 */
function fitDps(card: AnomalyDef, bal: BattleBalance, target: number, branch?: FoeSupportBranch): void {
  const slots = card.ships!.filter((slot) => branch === undefined || slot.enterBranch === branch)
  const starts = slots.map((slot) => ({ dmg: slot.dmgMul ?? 1, anchor: slot.firepowerAnchor }))
  const apply = (scale: number): void => {
    slots.forEach((slot, index) => {
      slot.dmgMul = starts[index]!.dmg * scale
      const anchor = starts[index]!.anchor
      if (anchor !== undefined) slot.firepowerAnchor = Math.max(1, Math.round(anchor * scale))
    })
  }
  const read = (): number => branch === undefined
    ? wormholeExpeditionStrengthOf(card, bal).dps
    : sumStrength(rawSpecs(card, bal), branch).dps
  let lo = 0
  let hi = 1
  apply(hi)
  while (read() < target && hi < 1e12) {
    hi *= 2
    apply(hi)
  }
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2
    apply(mid)
    if (read() <= target) lo = mid
    else hi = mid
  }
  apply(lo)
}

function equalizeSupport(card: AnomalyDef, bal: BattleBalance): void {
  const skip = wormholeSkippedBranch(card)
  if (skip === null) return
  const kept: FoeSupportBranch = skip === 'inside' ? 'outside' : 'inside'
  const specs = rawSpecs(card, bal)
  const target = sumStrength(specs, kept)
  const other = sumStrength(specs, skip)
  for (const slot of card.ships!.filter((slot) => slot.enterBranch === skip)) {
    slot.hpMul = (slot.hpMul ?? 1) * target.hp / other.hp
  }
  fitDps(card, bal, target.dps, skip)
}

function disableSupport(card: AnomalyDef, family: WormholeFamily, bal: BattleBalance): void {
  const beforeComp = foeMultiShipCompMul(card)
  const survivingDps = sumStrength(rawSpecs(card, bal).filter((spec) =>
    family === 'D' ? spec.foeReinforceBranch === undefined : !(spec.repairPct! > 0),
  )).dps
  if (family === 'D') {
    card.ships = card.ships!.filter((slot) => slot.enterBranch === undefined)
    for (const slot of card.ships) removeMount(slot, FOE_MOUNT_IDS.supportCall)
  } else if (family === 'A') {
    for (const slot of card.ships!) removeMount(slot, FOE_MOUNT_IDS.captureWeb)
  } else if (family === 'E') {
    for (const slot of card.ships!) delete slot.ship.droneReserve
  } else if (family === 'G') {
    card.ships = card.ships!.filter((slot) => !(slot.ship.repairPct! > 0))
  }
  const afterComp = foeMultiShipCompMul(card)
  if (beforeComp !== afterComp) {
    for (const slot of card.ships!) slot.dmgMul = (slot.dmgMul ?? 1) * beforeComp / afterComp
    // 判据：删单位还会改变整卡越线折扣；幸存单位保持删除前的真实名义火力。
    fitDps(card, bal, survivingDps)
  }
}

/**
 * §16.2/16.5：新趟专用独立卡。先分完总预算再解除支援，幸存主力不吃回收的份额。
 * 普通/巡逻/事件固定浅层编成；精英与后层守卫使用已披露的代表机制。
 */
export function wormholeExpeditionCard(
  ctx: WormholeExpeditionFoeContext,
  family: WormholeFamily,
  depth: number,
  role: WormholeExpeditionFoeRole,
  disabledSupport = false,
): WormholeExpeditionFoeCard {
  if (!(family in WORMHOLE_FAMILY_CARDS) || !(role in ROLE_SCALE) || !Number.isFinite(depth)) {
    throw new Error('wormhole-expedition-foe-spec-invalid')
  }
  const d = Math.max(1, Math.floor(depth))
  const ordinary = ordinaryTemplate(ctx, family)
  // 预算按族格前的血/火力比划分，最终加血不被反算抵消。
  const natural = sumStrength(rawSpecs(ordinary, ctx.balance.battle), undefined, wormholeSkippedBranch(ordinary), true)
  const ratio = natural.hp / natural.dps
  const baseline = foeHpOfThreat(WORMHOLE_THREAT_BASE, ctx.balance.battle) * WORMHOLE_FOE_BASE_STRENGTH_MUL
  const scale = (1 + 0.04 * (d - 1)) * ROLE_SCALE[role]
  const budgetHp = baseline * Math.sqrt(ratio / WORMHOLE_THREAT_REF_RATIO) * scale
  const budgetDps = baseline / Math.sqrt(ratio * WORMHOLE_THREAT_REF_RATIO) * scale
  const representative = role === 'elite' || (role === 'guard' && d >= 4)
  const card = representative ? representativeTemplate(ctx, family) : ordinary
  const templateId = card.id
  card.region = 'wh'
  card.hidden = true
  card.standingReq = 0
  card.standingGain = 0
  card.rewardIsk = 0
  card.loot = []
  card.foeTargeting = role === 'guard' ? 'largest' : WORMHOLE_FAMILY_TARGETING[family]
  card.foeTargetingChance = card.foeTargeting === 'random' ? 1 : WORMHOLE_FAMILY_TARGETING_CHANCE
  delete card.rareWreckDrop
  delete card.lairCore
  delete card.lairGear
  delete card.lairLevel
  delete card.lairTierNames
  delete card.waves
  for (const slot of card.ships!) {
    slot.wave = 0
    delete slot.foeMountNamePairs
  }
  equalizeSupport(card, ctx.balance.battle)
  const hpNow = sumStrength(rawSpecs(card, ctx.balance.battle), undefined, wormholeSkippedBranch(card), true).hp
  for (const slot of card.ships!) slot.hpMul = (slot.hpMul ?? 1) * budgetHp / hpNow
  fitDps(card, ctx.balance.battle, budgetDps)
  equalizeSupport(card, ctx.balance.battle)
  if (disabledSupport) disableSupport(card, family, ctx.balance.battle)
  // 依据 §16.2：近防资格按用途/层预告，不由重新定价的展示标签过线。
  const pd = representative && d >= 4
  const threatJudged = pd
    ? ctx.balance.battle.pdThreatFloor
    : Math.min(WORMHOLE_THREAT_BASE, ctx.balance.battle.pdThreatFloor - 1)
  card.threatJudged = threatJudged
  const strength = wormholeExpeditionStrengthOf(card, ctx.balance.battle)
  card.threat = foeThreatRatingOf(strength.x, WORMHOLE_FOE_BASE_STRENGTH_MUL, ctx.balance.battle)
  const specs = rawSpecs(card, ctx.balance.battle)
  const pdTags = pd ? specs.map((spec) => spec.tag) : []
  card.waves = [{ units: specs.length, hpShare: 1 }]
  return {
    ...card,
    wormholeRepairScale: scale,
    wormholePdTags: pdTags,
    expeditionFoe: {
      family,
      depth: d,
      role,
      disabledSupport,
      templateId,
      scale,
      budget: {
        hp: budgetHp * foeFamilyHpMulOf(family), dps: budgetDps,
        x: Math.sqrt(budgetHp * foeFamilyHpMulOf(family) * budgetDps),
      },
      strength,
      pointDefense: { threatJudged, unitTags: pdTags },
      repairScale: scale,
    },
  }
}

/** 谜质快照只作用于副本；线性属性尺度、修理与显示威胁在同一出口更新。 */
export function wormholeExpeditionModifyCard(
  source: WormholeExpeditionFoeCard,
  bal: BattleBalance,
  mods: WormholeExpeditionFoeMods,
): WormholeExpeditionFoeCard {
  const mul = mods.threatMul ?? 1
  const hitDown = mods.foeHitDown ?? 0
  const blindDown = mods.blindReduce ?? 0
  if (!Number.isFinite(mul) || !(mul > 0) || !Number.isFinite(hitDown) || hitDown < 0 || !Number.isFinite(blindDown) || blindDown < 0) {
    throw new Error('wormhole-expedition-foe-mods-invalid')
  }
  const card = structuredClone(source)
  const pdTags = card.wormholePdTags
  delete (card as AnomalyDef).wormholeRepairScale
  delete (card as AnomalyDef).wormholePdTags
  for (const slot of card.ships!) {
    slot.hpMul = (slot.hpMul ?? 1) * mul
    slot.dmgMul = (slot.dmgMul ?? 1) * mul
    if (slot.firepowerAnchor !== undefined) slot.firepowerAnchor = Math.max(1, Math.round(slot.firepowerAnchor * mul))
    if (hitDown > 0) {
      slot.hitRate = Math.max(0, (slot.hitRate ?? slot.ship.hitRate) - hitDown)
    }
    if (blindDown > 0) slot.ship.blindDmgMul = Math.max(0, (slot.ship.blindDmgMul ?? 0.3) - blindDown)
  }
  if (mul !== 1) {
    // 判据：沿用整卡越线折扣，但属性倍率不因跨折扣线而多算一遍。
    fitDps(card, bal, source.expeditionFoe.strength.dps * mul)
    equalizeSupport(card, bal)
  }
  const strength = wormholeExpeditionStrengthOf(card, bal)
  card.threat = foeThreatRatingOf(strength.x, WORMHOLE_FOE_BASE_STRENGTH_MUL, bal)
  card.wormholeRepairScale = source.wormholeRepairScale * mul
  card.wormholePdTags = pdTags
  card.expeditionFoe.scale *= mul
  card.expeditionFoe.repairScale = card.wormholeRepairScale
  card.expeditionFoe.budget = {
    hp: source.expeditionFoe.budget.hp * mul,
    dps: source.expeditionFoe.budget.dps * mul,
    x: source.expeditionFoe.budget.x * mul,
  }
  card.expeditionFoe.strength = strength
  return card
}

/** 与公共 createFoeSpecs 使用同一份显式标记，保留既有波次参数。 */
export function wormholeExpeditionFoeSpecs(
  card: WormholeExpeditionFoeCard,
  bal: BattleBalance,
): WormholeExpeditionUnitSpec[] {
  const pdTags = new Set(card.wormholePdTags)
  return rawSpecs(card, bal).map((spec) => ({
    ...spec,
    foePointDefenseEnabled: pdTags.has(spec.tag),
  }))
}
