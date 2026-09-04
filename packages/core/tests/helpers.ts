/**
 * 测试共用工具：快速造内容定义与"可定制的模拟世界上下文"（SimContext）。
 * 默认世界：技能 0 个（调用方按需传入）、测试船（800 m³ / 12 秒 / 每循环 10 单位）、
 * 一条矿带（出产矿甲）、矿石矿甲/乙、矿物甲/乙、测试装备 mod-a/miner +50%、mod-b/cargo +30%，
 * 以及两张测试蓝图 bp-a（造 mod-a，10 单位矿粉甲，10 分钟）与 bp-b（造 mod-b）。
 */
import { DEFAULT_BALANCE } from '../src/balance'
import type {
  AnomalyDef,
  BalanceConfig,
  BeltDef,
  BlueprintDef,
  GalaxyDef,
  GalaxyEdgeDef,
  ItemDef,
  ModuleDef,
  ModuleSlot,
  ShipBlueprintDef,
  ShipDef,
  SimContext,
  SkillDef,
  StationSiteDef,
  TravelEventDef,
} from '../src/types'

/** 快速造技能 */
export function skill(id: string, rank = 1, name = `技能${id}`): SkillDef {
  return { id, name, group: '测试组', rank, description: '测试用技能' }
}

/** 快速造矿石 */
export function ore(id: string, opts?: { name?: string; price?: number; refine?: ItemDef['refine'] }): ItemDef {
  return {
    id,
    name: opts?.name ?? `矿${id}`,
    kind: 'ore',
    unitM3: 1,
    baseSellPriceIsk: opts?.price ?? 12,
    description: '测试用矿石',
    refine: opts?.refine,
  }
}

/** 快速造矿物 */
export function mineral(id: string, price = 8): ItemDef {
  return { id, name: `矿粉${id}`, kind: 'mineral', unitM3: 0.01, baseSellPriceIsk: price, description: '测试用矿物' }
}

/** 快速造矿带（opts.galaxyId：挂到指定星系；standingReq：声望门槛） */
export function belt(
  id: string,
  oreId: string,
  name?: string,
  opts?: { galaxyId?: string; standingReq?: number },
): BeltDef {
  return {
    id,
    name: name ?? `带${id}`,
    oreId,
    ...(opts?.galaxyId !== undefined ? { galaxyId: opts.galaxyId } : {}),
    ...(opts?.standingReq !== undefined ? { standingReq: opts.standingReq } : {}),
    description: '测试用矿带',
  }
}

/** 快速造舰船（V12：带默认战斗数值，保证战斗测试可用；可覆盖） */
export function ship(
  id: string,
  opts?: {
    cargo?: number
    cycle?: number
    perCycle?: number
    price?: number
    agility?: number
    shieldHp?: number
    armorHp?: number
    hullHp?: number
    evasion?: number
    hitBonus?: number
    powerBonus?: number
    maxSpeedMps?: number
    warpSpeedAus?: number
    signatureM?: number
    scanResMm?: number
    cpu?: number
    droneBayM3?: number
  },
): ShipDef {
  return {
    id,
    name: `船${id}`,
    tier: 1,
    role: 'industrial',
    cargoM3: opts?.cargo ?? 800,
    cycleSeconds: opts?.cycle ?? 12,
    oreUnitsPerCycle: opts?.perCycle ?? 10,
    priceIsk: opts?.price ?? 0,
    agility: opts?.agility ?? 0.4,
    shieldHp: opts?.shieldHp ?? 15,
    armorHp: opts?.armorHp ?? 10,
    hullHp: opts?.hullHp ?? 25,
    evasion: opts?.evasion ?? 0.1,
    hitBonus: opts?.hitBonus ?? 0.05,
    powerBonus: opts?.powerBonus,
    maxSpeedMps: opts?.maxSpeedMps ?? 260,
    ...(opts?.warpSpeedAus !== undefined ? { warpSpeedAus: opts.warpSpeedAus } : {}),
    signatureM: opts?.signatureM ?? 70,
    scanResMm: opts?.scanResMm ?? 500,
    cpu: opts?.cpu ?? 120,
    droneBayM3: opts?.droneBayM3 ?? 0,
    description: '测试用舰船',
  }
}

/** 快速造装备（V12：可附带武器/战斗字段） */
export function moduleDef(
  id: string,
  slot: ModuleSlot,
  bonus: number,
  opts?: {
    weaponSize?: 'light' | 'heavy'
    maxRangeM?: number
    minRangeM?: number
    hitRate?: number
    falloff?: number
    reloadMs?: number
    dmgMult?: number
    cpuUse?: number
  },
): ModuleDef {
  return {
    id,
    name: `模块${id}`,
    slot,
    bonus,
    description: '测试用装备',
    ...(opts?.weaponSize !== undefined ? { weaponSize: opts.weaponSize } : {}),
    ...(opts?.maxRangeM !== undefined ? { maxRangeM: opts.maxRangeM } : {}),
    ...(opts?.minRangeM !== undefined ? { minRangeM: opts.minRangeM } : {}),
    ...(opts?.hitRate !== undefined ? { hitRate: opts.hitRate } : {}),
    ...(opts?.falloff !== undefined ? { falloff: opts.falloff } : {}),
    ...(opts?.reloadMs !== undefined ? { reloadMs: opts.reloadMs } : {}),
    ...(opts?.dmgMult !== undefined ? { dmgMult: opts.dmgMult } : {}),
    ...(opts?.cpuUse !== undefined ? { cpuUse: opts.cpuUse } : {}),
  }
}

/** 快速造蓝图 */
export function blueprint(
  id: string,
  moduleId: string,
  materials: BlueprintDef['materials'],
  opts?: { buildSeconds?: number; buildCost?: number; price?: number },
): BlueprintDef {
  return {
    id,
    name: `${id} 蓝图`,
    moduleId,
    materials,
    buildSeconds: opts?.buildSeconds ?? 600,
    buildCostIsk: opts?.buildCost ?? 500,
    priceIsk: opts?.price ?? 1000,
    description: '测试用蓝图',
  }
}

/** 测试世界里的默认物品 */
export const DEFAULT_TEST_ITEMS: readonly ItemDef[] = [
  ore('ore-a', { name: '矿甲', refine: [{ mineralId: 'min-a', perOre: 2 }, { mineralId: 'min-b', perOre: 0.5 }] }),
  ore('ore-b', { name: '矿乙', price: 20, refine: [{ mineralId: 'min-a', perOre: 1.2 }] }),
  mineral('min-a'),
  mineral('min-b', 12),
  // V12：轻口径三型弹药（战斗/装载测试用；数值与正式数据一致）
  { id: 'ammo-kinetic-l', name: '轻动能弹', kind: 'ammo', unitM3: 0.02, baseSellPriceIsk: 6, description: '测试轻动能弹', damageType: 'kinetic', ammoSize: 'light', dmg: 6 },
  { id: 'ammo-explosive-l', name: '轻高爆弹', kind: 'ammo', unitM3: 0.02, baseSellPriceIsk: 7, description: '测试轻高爆弹', damageType: 'explosive', ammoSize: 'light', dmg: 7 },
  { id: 'ammo-plasma-l', name: '轻等离子弹', kind: 'ammo', unitM3: 0.02, baseSellPriceIsk: 8, description: '测试轻等离子弹', damageType: 'plasma', ammoSize: 'light', dmg: 9 },
]

/** 测试世界里的默认装备 */
export const DEFAULT_TEST_MODULES: readonly ModuleDef[] = [
  moduleDef('mod-a', 'miner', 0.5),
  moduleDef('mod-b', 'cargo', 0.3),
]

/** 测试世界里的默认蓝图 */
export const DEFAULT_TEST_BLUEPRINTS: readonly BlueprintDef[] = [
  blueprint('bp-a', 'mod-a', [{ itemId: 'min-a', count: 10 }]),
  blueprint('bp-b', 'mod-b', [{ itemId: 'min-b', count: 8 }], { buildSeconds: 300, buildCost: 300, price: 800 }),
]

/** 快速造星系 */
export function galaxy(id: string, name = `星系${id}`): GalaxyDef {
  return { id, name, x: 0, y: 0, description: '测试用星系' }
}

/** 快速造异常目标 */
export function anomaly(
  id: string,
  galaxyId: string,
  opts?: {
    threat?: number
    req?: number
    reward?: number
    combatSeconds?: number
    loot?: AnomalyDef['loot']
    standingGain?: number
    tactic?: AnomalyDef['tactic']
  },
): AnomalyDef {
  return {
    id,
    name: `目标${id}`,
    galaxyId,
    threat: opts?.threat ?? 8,
    standingReq: opts?.req ?? 0,
    standingGain: opts?.standingGain ?? 1,
    rewardIsk: opts?.reward ?? 5_000,
    loot: opts?.loot ?? [],
    combatSeconds: opts?.combatSeconds ?? 120,
    tactic: opts?.tactic,
    description: '测试用异常点',
  }
}

/** 测试世界里的默认星系：母港 hub 与远方星系 far（单程 2 分钟） */
export const DEFAULT_TEST_GALAXIES: readonly GalaxyDef[] = [galaxy('galaxy-hub', '母港'), galaxy('galaxy-far', '远方')]

/** 测试世界里的默认航线 */
export const DEFAULT_TEST_EDGES: readonly GalaxyEdgeDef[] = [{ from: 'galaxy-hub', to: 'galaxy-far', travelMinutes: 2 }]

/** 测试世界里的默认异常点：低威胁入门目标 + 高威胁/高声望目标 */
export const DEFAULT_TEST_ANOMALIES: readonly AnomalyDef[] = [
  anomaly('ano-a', 'galaxy-hub', { threat: 8, reward: 5_000 }),
  anomaly('ano-hard', 'galaxy-far', { threat: 40, req: 5, reward: 50_000, loot: [{ itemId: 'min-a', units: 10 }] }),
]

/** 快速造舰船蓝图 */
export function shipBlueprint(
  id: string,
  shipId: string,
  materials: BlueprintDef['materials'],
  opts?: { buildSeconds?: number; buildCost?: number; price?: number },
): ShipBlueprintDef {
  return {
    id,
    name: `${id} 舰船蓝图`,
    shipId,
    materials,
    buildSeconds: opts?.buildSeconds ?? 600,
    buildCostIsk: opts?.buildCost ?? 500,
    priceIsk: opts?.price ?? 1000,
    description: '测试用舰船蓝图',
  }
}

/** 快速造途中事件 */
export function travelEvent(id: string, effect: TravelEventDef['effect'], weight = 10): TravelEventDef {
  return { id, name: `事件${id}`, text: `途中遭遇事件${id}`, weight, effect }
}

/** 测试世界里的默认舰船蓝图：造 sandcat2 */
export const DEFAULT_TEST_SHIP_BLUEPRINTS: readonly ShipBlueprintDef[] = [
  shipBlueprint('sbp-a', 'sandcat2', [{ itemId: 'min-a', count: 5 }], { buildSeconds: 60, buildCost: 100, price: 200 }),
]

/** 测试世界里的默认途中事件（一条有收益一条纯趣闻） */
export const DEFAULT_TEST_TRAVEL_EVENTS: readonly TravelEventDef[] = [
  travelEvent('ev-a', { kind: 'isk', min: 100, max: 200 }),
  travelEvent('ev-b', { kind: 'none' }, 5),
]

/**
 * 测试市场的默认商品目录：自动为测试世界的每件物品/装备/蓝图/舰船蓝图/船
 * （价格 >0）生成一张市场卡。
 * - 物品按池模型（target 10 万，收购价恒等基准价 → 出售收入确定可断言）；
 * - 单件商品按基准价 = 旧价锚（船=priceIsk、蓝图=priceIsk、装备=basePrice 字段无 →
 *   装备按 10_000 ×(i+1) 之类固定值，随传入的装备 id 稳定即可：用 20_000+index*1000）；
 * - 价格全部精确（无 jitter：开盘种子单），测试里不推进市场窗口就不会有波动。
 */
import type { MarketGoodDef } from '../src/types'

function autoMarketGoods(ctx: {
  items: ReadonlyMap<string, ItemDef>
  modules: ReadonlyMap<string, ModuleDef>
  blueprints: ReadonlyMap<string, BlueprintDef>
  shipBlueprints: ReadonlyMap<string, ShipBlueprintDef>
  ships: ReadonlyMap<string, ShipDef>
}): ReadonlyMap<string, MarketGoodDef> {
  const goods: MarketGoodDef[] = []
  for (const item of ctx.items.values()) {
    goods.push({
      key: `it-${item.id}`,
      kind: 'item',
      refId: item.id,
      rarity: 'common',
      basePrice: item.baseSellPriceIsk,
      poolTarget: 100_000,
      supplyFlow: 1_000,
    })
  }
  let n = 0
  for (const mod of ctx.modules.values()) {
    n += 1
    goods.push({
      key: `mod-${mod.id}`,
      kind: 'module',
      refId: mod.id,
      rarity: 'common',
      basePrice: 20_000 + n * 1_000,
      demandMultiplier: 0.4,
    })
  }
  for (const bp of ctx.blueprints.values()) {
    goods.push({
      key: `bp-${bp.id}`,
      kind: 'blueprint',
      refId: bp.id,
      rarity: 'common',
      basePrice: bp.priceIsk,
      demandMultiplier: 0.5,
    })
  }
  for (const bp of ctx.shipBlueprints.values()) {
    goods.push({
      key: `bp-${bp.id}`,
      kind: 'blueprint',
      refId: bp.id,
      rarity: 'common',
      basePrice: bp.priceIsk,
      demandMultiplier: 0.5,
    })
  }
  for (const ship of ctx.ships.values()) {
    if (ship.priceIsk > 0) {
      goods.push({
        key: `ship-${ship.id}`,
        kind: 'ship',
        refId: ship.id,
        rarity: 'common',
        basePrice: ship.priceIsk,
        demandMultiplier: 0.4,
      })
    }
  }
  return new Map(goods.map((g) => [g.key, g]))
}

/** 组装一个测试上下文；任何内容都可以按需覆盖/追加 */
export function makeTestCtx(opts?: {
  skills?: Iterable<SkillDef>
  ships?: Iterable<ShipDef>
  belts?: Iterable<BeltDef>
  items?: Iterable<ItemDef>
  modules?: Iterable<ModuleDef>
  blueprints?: Iterable<BlueprintDef>
  shipBlueprints?: Iterable<ShipBlueprintDef>
  galaxies?: Iterable<GalaxyDef>
  edges?: Iterable<GalaxyEdgeDef>
  anomalies?: Iterable<AnomalyDef>
  travelEvents?: Iterable<TravelEventDef>
  stations?: Iterable<StationSiteDef>
  marketGoods?: Iterable<MarketGoodDef>
  /** 关闭随机事件流（精确断言时间线/日志/rng 的测试用） */
  quietEvents?: boolean
  balance?: BalanceConfig
}): SimContext {
  const ships = [ship('sandcat'), ship('sandcat2', { cargo: 100, cycle: 6, perCycle: 5 }), ...(opts?.ships ?? [])]
  const belts = [belt('belt-a', 'ore-a'), ...(opts?.belts ?? [])]
  const items = [...DEFAULT_TEST_ITEMS, ...(opts?.items ?? [])]
  const skills = [...(opts?.skills ?? [])]
  const modules = [...DEFAULT_TEST_MODULES, ...(opts?.modules ?? [])]
  const blueprints = [...DEFAULT_TEST_BLUEPRINTS, ...(opts?.blueprints ?? [])]
  const shipBlueprints = [...DEFAULT_TEST_SHIP_BLUEPRINTS, ...(opts?.shipBlueprints ?? [])]
  const galaxies = [...DEFAULT_TEST_GALAXIES, ...(opts?.galaxies ?? [])]
  const edges = [...DEFAULT_TEST_EDGES, ...(opts?.edges ?? [])]
  const anomalies = [...DEFAULT_TEST_ANOMALIES, ...(opts?.anomalies ?? [])]
  const travelEvents = [...DEFAULT_TEST_TRAVEL_EVENTS, ...(opts?.travelEvents ?? [])]
  const stations = new Map<string, StationSiteDef>(Array.from(opts?.stations ?? [], (s) => [s.id, s]))
  const shipsMap = new Map(ships.map((s) => [s.id, s]))
  const itemsMap = new Map(items.map((i) => [i.id, i]))
  const modulesMap = new Map(modules.map((m) => [m.id, m]))
  const blueprintsMap = new Map(blueprints.map((b) => [b.id, b]))
  const shipBlueprintsMap = new Map(shipBlueprints.map((b) => [b.id, b]))
  const marketGoods =
    opts?.marketGoods !== undefined
      ? new Map([...opts.marketGoods].map((g) => [g.key, g]))
      : autoMarketGoods({
          items: itemsMap,
          modules: modulesMap,
          blueprints: blueprintsMap,
          shipBlueprints: shipBlueprintsMap,
          ships: shipsMap,
        })
  const balance =
    opts?.quietEvents === true
      ? { ...(opts?.balance ?? DEFAULT_BALANCE), events: { ...(opts?.balance ?? DEFAULT_BALANCE).events, enabled: false } }
      : (opts?.balance ?? DEFAULT_BALANCE)
  return {
    skills: new Map(skills.map((s) => [s.id, s])),
    ships: shipsMap,
    belts: new Map(belts.map((b) => [b.id, b])),
    items: itemsMap,
    modules: modulesMap,
    blueprints: blueprintsMap,
    shipBlueprints: shipBlueprintsMap,
    galaxies: new Map(galaxies.map((g) => [g.id, g])),
    galaxyEdges: edges,
    anomalies: new Map(anomalies.map((a) => [a.id, a])),
    travelEvents,
    stations,
    marketGoods,
    balance,
  }
}
