/**
 * 内容完整性体检（V10 数据大扩容后加入）：
 * 校验 data 包全部内容表的交叉引用，防止"加数据改漏引用"造成的死物品/坏目录。
 *
 * 覆盖（中文说明）：
 * - 目录键唯一；市场卡 refId 必须能按 kind 解析到真实条目；
 * - 每种物品（矿石/矿物/气体/冰/弹药/无人机）都必须有市场卡（防死物品：买不了也卖不了）；
 * - 采集点：id 唯一、产出物存在且可采集（ore/gas/ice）、声望门槛非负整数；
 * - 精炼配方：只有可精炼资源（ore/gas/ice）带配方、配方行矿物存在且 kind=mineral；
 * - 装备：id 唯一、slot 在六槽内、参数按家族齐备；**窝点专属装备例外**（无市场卡、无蓝图，只从高级箱出，见下方契约）；
 * - 蓝图：id 唯一、模块/船存在、材料都是矿物；蓝图卡存在时其 refId 必须解析到真实蓝图（否则无法购书学习）；
 * - 舰船：id 唯一、role 合法；蓝图的产物船存在；舰船蓝图引用船存在；
 * - 市场卡：refId 解析 + 池商品必须有 poolTarget/supplyFlow、单件门槛/倍数字段数值合法。
 *
 * 用法：npm run content:check（或 npx tsx tools/content-check.ts）
 */

import {
  BLUEPRINTS,
  ITEMS,
  BELTS,
  MARKET_GOODS,
  WRECK_BUY_GOODS,
  MODULES,
  SHIP_BLUEPRINTS,
  SHIPS,
  ANOMALIES_FLAVORED,
  RARITY_TIER,
  DRONE_ROLE_SPECS,
  droneRoleIssues,
  droneRoleLadderIssues,
  droneTotalHp,
  buildItemCatalog,
  buildSimContext,
} from '@whale/data'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ITEM_KIND_ORDER,
  MODULE_SLOTS,
  MINEABLE_KINDS,
  RACK_SLOTS,
  RARE_WRECK_VOLUME_M3,
  RECYCLE_POOL_AVG_ISK,
  SHIP_ROLE_LABELS,
  FOE_LAIR_GEAR,
  BOUNTY_ZONE_PLAN,
  FACTION_RARE_DROP_CHANCE,
  FACTION_RARE_DROP_COUNT,
  FRAGMENT_RECIPES,
  hasLairCore,
  isLairCandidate,
  lairGearOf,
  lairNameOf,
  rareWreckItemIdOf,
  recycleTierOf,
  rackOf,
  wreckBaseDensity,
} from '@whale/core'

const errors: string[] = []
const warn: string[] = []

function check(cond: boolean, msg: string): void {
  if (!cond) errors.push(msg)
}

/* ── 基础目录 ── */
const items = buildItemCatalog()
/* 动态物品（残骸/蓝图碎片按敌群/逆向配方生成，不入静态物品表）——市场卡 item 解析用 */
const ctxItems = buildSimContext().items
const itemDefs = [...ITEMS]
const ores = itemDefs.filter((i) => i.kind === 'ore')
const minerals = itemDefs.filter((i) => i.kind === 'mineral')
const gases = itemDefs.filter((i) => i.kind === 'gas')
const ices = itemDefs.filter((i) => i.kind === 'ice')
const ammos = itemDefs.filter((i) => i.kind === 'ammo')
const drones = itemDefs.filter((i) => i.kind === 'drone')
/** 无人机四型定位契约的单发基准 = 侦察机单发（2026-09-10 船长拍板） */
const scoutDmg = drones.find((d) => d.droneClass === 'scout')?.dmg ?? 0
const DMG_TYPES = new Set(['kinetic', 'explosive', 'plasma'])

// 数量与目标规模（V10 设计确认；V16 矿带整合：矿石 10→7，总量 35→32；V18 口径取消：重弹并入通用弹 6→3；
// 2026-09-09 弹药 MK2：每族 +1 高级弹 → 弹药 6 种，物品总数 31→34）
check(itemDefs.length === 34, `物品总数应为 34，实际 ${itemDefs.length}`)
check(ores.length === 7, `矿石应为 7 种，实际 ${ores.length}`)
check(minerals.length === 8, `矿物应为 8 种，实际 ${minerals.length}`)
check(gases.length === 4, `气体应为 4 种，实际 ${gases.length}`)
check(ices.length === 3, `冰矿应为 3 种，实际 ${ices.length}`)
check(ammos.length === 6, `弹药应为 6 种（每族基础弹 + MK2），实际 ${ammos.length}`)
check(drones.length === 4, `无人机应为 4 种，实际 ${drones.length}`)

/* ── 市场目录 ── */
const goodKeys = new Set<string>()
const itemGoods = new Map<string, { rarity: string; playerSellable: boolean }>()
for (const g of MARKET_GOODS) {
  if (goodKeys.has(g.key)) errors.push(`市场卡键重复：${g.key}`)
  goodKeys.add(g.key)
  switch (g.kind) {
    case 'item':
      check(ctxItems.has(g.refId), `市场卡 ${g.key} → 物品 ${g.refId} 不存在`)
      if (ctxItems.has(g.refId)) itemGoods.set(g.refId, { rarity: g.rarity, playerSellable: g.playerSellable !== false })
      break
    case 'module':
      check(MODULES.some((m) => m.id === g.refId), `市场卡 ${g.key} → 装备 ${g.refId} 不存在`)
      break
    case 'ship':
      check(SHIPS.some((s) => s.id === g.refId), `市场卡 ${g.key} → 舰船 ${g.refId} 不存在`)
      break
    case 'blueprint':
      check(
        BLUEPRINTS.some((b) => b.id === g.refId) || SHIP_BLUEPRINTS.some((b) => b.id === g.refId),
        `市场卡 ${g.key} → 蓝图 ${g.refId} 不存在`,
      )
      break
    case 'aicore':
      check(['basic', 'gamma', 'beta', 'alpha'].includes(g.refId), `市场卡 ${g.key} → 核心 ${g.refId} 非法`)
      break
    default:
      errors.push(`市场卡 ${g.key} 的 kind 未知：${g.kind}`)
  }
  if (g.kind !== 'item') {
    check(g.standingReq === undefined || (Number.isInteger(g.standingReq) && g.standingReq >= 0), `市场卡 ${g.key} standingReq 非法`)
  }
  if (g.poolTarget !== undefined) {
    check((g.poolTarget ?? 0) > 0 && (g.supplyFlow ?? 0) > 0, `池商品 ${g.key} 缺少 poolTarget/supplyFlow`)
  }
}
check(goodKeys.size === MARKET_GOODS.length, `市场卡键重复（${MARKET_GOODS.length - goodKeys.size} 处）`)
console.log(`· 市场商品卡：${MARKET_GOODS.length} 张`)

/* ── 数字稀有度表（2026-09-09 船长拍板：稀有度入物品本体 RARITY_TIER，市场调用）── */
{
  const tableKeys = new Set(Object.keys(RARITY_TIER))
  const refSet = new Set(MARKET_GOODS.map((g) => g.refId))
  check(tableKeys.size === MARKET_GOODS.length, `稀有度表键数 ${tableKeys.size} ≠ 市场卡数 ${MARKET_GOODS.length}`)
  for (const ref of refSet) {
    if (!tableKeys.has(ref)) errors.push(`市场卡 ${ref} 缺稀有度表项（RARITY_TIER）`)
  }
  for (const k of tableKeys) {
    if (!refSet.has(k)) errors.push(`稀有度表多余键 ${k}（无对应市场卡）`)
    const v = RARITY_TIER[k]!
    check(Number.isInteger(v) && v >= 1 && v <= 4, `稀有度表 ${k} 值非法：${v}（应为 1~4 整数）`)
  }
  // 渠道一致性：common 必须 1；rare 只能 2/3；exotic 只能 3/4（低值奇货可标 3，船长 2026-09-09）
  for (const g of MARKET_GOODS) {
    const v = RARITY_TIER[g.refId] ?? 0
    if (g.rarity === 'common') check(v === 1, `稀有度表 ${g.refId}：common 渠道应为 1，实际 ${v}`)
    else if (g.rarity === 'rare') check(v === 2 || v === 3, `稀有度表 ${g.refId}：rare 渠道应为 2/3，实际 ${v}`)
    else check(v === 3 || v === 4, `稀有度表 ${g.refId}：exotic 渠道应为 3/4，实际 ${v}`)
  }
}

// 每种物品必须有市场卡（防死物品）
for (const item of itemDefs) {
  const good = itemGoods.get(item.id)
  if (!good) {
    errors.push(`物品 ${item.id}（${item.name}）没有市场卡——将无法买卖（死物品）`)
  } else if (good.rarity !== 'common') {
    warn.push(`物品 ${item.id} 的市场卡非常驻（${good.rarity}），玩家产出将无法稳定卖出`)
  }
}

// 采集点
const beltIds = new Set<string>()
for (const b of BELTS) {
  if (beltIds.has(b.id)) errors.push(`采集点 id 重复：${b.id}`)
  beltIds.add(b.id)
  const item = items.get(b.oreId)
  check(!!item && MINEABLE_KINDS.has(item.kind), `采集点 ${b.id} 产物 ${b.oreId} 不存在或不可采集`)
  check(b.standingReq === undefined || (Number.isInteger(b.standingReq) && b.standingReq >= 0), `采集点 ${b.id} 声望门槛非法`)
}
check(BELTS.length === 17, `采集点应为 17 个，实际 ${BELTS.length}`)

// 精炼配方
for (const item of itemDefs) {
  const hasRefine = item.refine !== undefined && item.refine.length > 0
  if (hasRefine) {
    check(MINEABLE_KINDS.has(item.kind), `${item.id} 带了精炼配方但不是可采集资源（应无配方）`)
    for (const row of item.refine) {
      const target = items.get(row.mineralId)
      check(!!target && target.kind === 'mineral', `${item.id} 配方产物 ${row.mineralId} 不存在或不是矿物`)
      check(row.perOre > 0 && Number.isFinite(row.perOre), `${item.id} 配方系数非法：${row.perOre}`)
    }
  } else {
    check(
      item.kind === 'mineral' || item.kind === 'ammo' || item.kind === 'drone' || item.kind === 'kit',
      `${item.id}（${item.kind}）没有精炼配方——可采集资源必须带配方（kit 为无配方消耗品豁免）`,
    )
  }
}

// 装备
const moduleIds = new Set<string>()
for (const m of MODULES) {
  if (moduleIds.has(m.id)) errors.push(`装备 id 重复：${m.id}`)
  moduleIds.add(m.id)
  check([...MODULE_SLOTS].includes(m.slot), `装备 ${m.id} 家族非法：${m.slot}`)
}
for (const g of MARKET_GOODS) {
  if (g.kind === 'module' && !moduleIds.has(g.refId)) errors.push(`市场卡 ${g.key} 装备缺失`)
}
check(MODULES.length >= 24, `装备应 ≥24 件，实际 ${MODULES.length}`)
console.log(`· 装备：${MODULES.length} 件`)

// 蓝图
const bpIds = new Set<string>()
const moduleIdSet = new Set(MODULES.map((m) => m.id))
for (const bp of BLUEPRINTS) {
  if (bpIds.has(bp.id)) errors.push(`蓝图 id 重复：${bp.id}`)
  bpIds.add(bp.id)
  // 产物：moduleId（装备）或 itemId+outputUnits（消耗品/弹药，2026-09-05 弹药/修理组件同构）
  if (bp.moduleId !== undefined) {
    check(moduleIdSet.has(bp.moduleId), `蓝图 ${bp.id} → 装备 ${bp.moduleId} 不存在`)
  } else if (bp.itemId !== undefined) {
    const out = items.get(bp.itemId)
    check(!!out, `蓝图 ${bp.id} → 产物物品 ${bp.itemId} 不存在`)
    check(bp.outputUnits !== undefined && Number.isInteger(bp.outputUnits) && bp.outputUnits > 0, `蓝图 ${bp.id} 产物数量非法`)
  } else {
    errors.push(`蓝图 ${bp.id} 缺少 moduleId/itemId 产物声明`)
  }
  for (const need of bp.materials) {
    const mat = items.get(need.itemId)
    check(!!mat && mat.kind === 'mineral', `蓝图 ${bp.id} 材料 ${need.itemId} 不存在或不是矿物`)
    check(need.count > 0 && Number.isInteger(need.count), `蓝图 ${bp.id} 材料数量非法`)
  }
  check(
    MARKET_GOODS.some((g) => g.kind === 'blueprint' && g.refId === bp.id),
    `装备蓝图 ${bp.id} 没有市场卡（无法购书学习）`,
  )
}
const shipIdSet = new Set(SHIPS.map((s) => s.id))
for (const sbp of SHIP_BLUEPRINTS) {
  if (bpIds.has(sbp.id)) errors.push(`蓝图 id 与其它蓝图重复：${sbp.id}`)
  bpIds.add(sbp.id)
  check(shipIdSet.has(sbp.shipId), `舰船蓝图 ${sbp.id} → 舰船 ${sbp.shipId} 不存在`)
  for (const need of sbp.materials) {
    const mat = items.get(need.itemId)
    check(!!mat && mat.kind === 'mineral', `舰船蓝图 ${sbp.id} 材料 ${need.itemId} 不存在或不是矿物`)
  }
  check(
    MARKET_GOODS.some((g) => g.kind === 'blueprint' && g.refId === sbp.id),
    `舰船蓝图 ${sbp.id} 没有市场卡（无法购书学习）`,
  )
}

// 舰船
const roleSet = new Set(['industrial', 'armed', 'armored', 'hauler'])
const shipIds = new Set<string>()
const tierTotalAvg: Record<number, { industrial: number[]; others: number[] }> = {}
for (const s of SHIPS) {
  if (shipIds.has(s.id)) errors.push(`舰船 id 重复：${s.id}`)
  shipIds.add(s.id)
  check(roleSet.has(s.role), `舰船 ${s.id} role 非法：${s.role}`)
  check(s.cycleSeconds > 0 && s.oreUnitsPerCycle > 0 && s.cargoM3 > 0, `舰船 ${s.id} 数值非法`)
  // V10.5 战斗数值契约：三层血量必填且 >0
  check((s.shieldHp ?? 0) > 0 && (s.armorHp ?? 0) > 0 && (s.hullHp ?? 0) > 0, `舰船 ${s.id} 三层血量缺失或非正（V10.5 契约）`)
  // V10.5b：每层抗性为三系对象（0~0.9/系），键必须是合法伤害类型
  for (const r of ['shieldResist', 'armorResist', 'hullResist'] as const) {
    const res = s[r]
    if (res === undefined) continue
    if (typeof res !== 'object') {
      errors.push(`舰船 ${s.id} ${r} 应为三系对象（V10.5b）`)
      continue
    }
    for (const [t, val] of Object.entries(res)) {
      if (!DMG_TYPES.has(t)) errors.push(`舰船 ${s.id} ${r} 含未知伤害类型键：${t}`)
      if (typeof val !== 'number' || !Number.isFinite(val) || val < 0 || val > 0.9) {
        errors.push(`舰船 ${s.id} ${r}.${t} 越界：${String(val)}`)
      }
    }
  }
  // V10.5b：CPU 总量必填正数；无人机舱 ≥0；间接属性若有则必须为正数
  check((s.cpu ?? 0) > 0 && Number.isInteger(s.cpu), `舰船 ${s.id} cpu 缺失或非法（V10.5b）`)
  check((s.droneBayM3 ?? 0) >= 0 && Number.isFinite(s.droneBayM3), `舰船 ${s.id} droneBayM3 非法`)
  // V18：槽位布局必填（高/中/低 ≥1 整数；总位 3~12）
  const slots = s.slots
  check(!!slots, `舰船 ${s.id} 缺少 V18 槽位布局 slots`)
  if (slots) {
    const total = slots.high + slots.mid + slots.low
    check(
      Number.isInteger(slots.high) && slots.high >= 1 && slots.high <= 6 &&
        Number.isInteger(slots.mid) && slots.mid >= 1 && slots.mid <= 5 &&
        Number.isInteger(slots.low) && slots.low >= 1 && slots.low <= 6,
      `舰船 ${s.id} slots 越界：${JSON.stringify(slots)}（需 高1-6/中1-5/低1-6）`,
    )
    check(total >= 3 && total <= 12, `舰船 ${s.id} 总槽位 ${total} 超限（3~12）`)
    // V18 族定位弱断言：武装舰高槽多、装甲舰低槽多（布局草案精神）
    if (s.role === 'armed') check(slots.high >= slots.low + 1, `武装舰 ${s.id} 高槽应显著多于低槽（${slots.high} vs ${slots.low}）`)
    if (s.role === 'armored') check(slots.low >= slots.high + 1, `装甲舰 ${s.id} 低槽应显著多于高槽（${slots.low} vs ${slots.high}）`)
  }
  // V12：回避 0~0.9、命中加成 0~0.5
  check(s.evasion === undefined || (s.evasion >= 0 && s.evasion <= 0.9), `舰船 ${s.id} evasion 越界：${String(s.evasion)}`)
  check(s.hitBonus === undefined || (s.hitBonus >= 0 && s.hitBonus <= 0.5), `舰船 ${s.id} hitBonus 越界：${String(s.hitBonus)}`)
  for (const f of ['maxSpeedMps', 'warpSpeedAus', 'massKg', 'lockRangeM', 'signatureM', 'scanResMm'] as const) {
    const v = s[f]
    check(v === undefined || (typeof v === 'number' && Number.isFinite(v) && v > 0), `舰船 ${s.id} 间接属性 ${f} 非法：${String(v)}`)
  }
  if (s.role === 'armed') {
    check(s.powerBonus !== undefined && s.powerBonus > 0 && s.powerBonus <= 2, `武装舰 ${s.id} 必须有合法 powerBonus`)
    check((s.shieldHp ?? 0) > (s.armorHp ?? 0), `武装舰 ${s.id} 护盾应大于装甲（族定位）`)
  } else {
    check(s.powerBonus === undefined, `非武装舰 ${s.id} 不应带 powerBonus`)
  }
  const total = (s.shieldHp ?? 0) + (s.armorHp ?? 0) + (s.hullHp ?? 0)
  const bucket = (tierTotalAvg[s.tier] ??= { industrial: [], others: [] })
  ;(s.role === 'industrial' ? bucket.industrial : bucket.others).push(total)
}
// 族定位弱断言：同 tier 下工业系平均总血量应低于非工业系（工业 = 采矿机器）
for (const [tier, b] of Object.entries(tierTotalAvg)) {
  if (b.industrial.length === 0 || b.others.length === 0) continue
  const indAvg = b.industrial.reduce((a, x) => a + x, 0) / b.industrial.length
  const othAvg = b.others.reduce((a, x) => a + x, 0) / b.others.length
  check(indAvg < othAvg, `tier ${tier} 工业系平均总血量（${Math.round(indAvg)}）应低于非工业系（${Math.round(othAvg)}）`)
}
check(SHIPS.length === 25, `舰船应为 25 艘，实际 ${SHIPS.length}`)
console.log(`· 舰船：${SHIPS.length} 艘（role 分布：${['industrial', 'armed', 'armored', 'hauler'].map((r) => `${r}=${SHIPS.filter((s) => s.role === r).length}`).join(' ')})`)

/* ── V10.5 战斗数值契约：弹药 / 无人机 / 装备字段 ── */
for (const a of ammos) {
  check(a.damageType !== undefined && DMG_TYPES.has(a.damageType), `弹药 ${a.id} damageType 缺失或非法`)
  check((a.dmg ?? 0) > 0 && Number.isFinite(a.dmg), `弹药 ${a.id} dmg 缺失或非正`)
}
// V18（口径取消）+ 2026-09-09 弹药 MK2：每族 2 件 = 基础弹（-l）+ MK2（-2），各档能量基数最高
for (const t of DMG_TYPES) {
  const list = ammos.filter((a) => a.damageType === t)
  check(list.length === 2, `弹药：${t} 型应恰有 2 件（基础 -l + MK2 -2），实际 ${list.length}`)
  check(list.some((a) => a.id.endsWith('-l')), `弹药：${t} 型缺基础弹（-l）`)
  check(list.some((a) => a.id.endsWith('-2')), `弹药：${t} 型缺 MK2 弹（-2）`)
}
{
  // 能量(plasma)基数最高契约按档成立（基础 6/7/9、MK2 8/9/12 各自档内 plasma 最高）
  for (const suffix of ['-l', '-2']) {
    const byType = (t: string) => ammos.find((a) => a.damageType === t && a.id.endsWith(suffix))?.dmg ?? 0
    check(
      byType('plasma') > byType('kinetic') && byType('plasma') > byType('explosive'),
      `弹药：能量(plasma)基数应最高（${suffix} 档），实际 kin=${byType('kinetic')} exp=${byType('explosive')} pla=${byType('plasma')}`,
    )
  }
  // MK2 纯数值上级契约：同族 MK2 dmg > 基础（防未来反超/混档）
  for (const t of DMG_TYPES) {
    const base = ammos.find((a) => a.damageType === t && a.id.endsWith('-l'))
    const mk2 = ammos.find((a) => a.damageType === t && a.id.endsWith('-2'))
    check((mk2?.dmg ?? 0) > (base?.dmg ?? 0), `弹药：${t} MK2 单发应高于基础弹`)
  }
}
for (const d of drones) {
  check(d.damageType !== undefined && DMG_TYPES.has(d.damageType), `无人机 ${d.id} damageType 缺失或非法`)
  check((d.dmg ?? 0) > 0 && Number.isFinite(d.dmg), `无人机 ${d.id} dmg 缺失或非正`)
  check((d.cpuUse ?? 0) > 0 && Number.isInteger(d.cpuUse), `无人机 ${d.id} cpuUse 缺失或非法（V10.5b 放飞占 CPU）`)
  // 2026-09-10 射程分类 + 分类字段契约（船长：机型分类入本体，界面「种类」显示无人机 · 侦察机）
  const DRONE_CLASS_RANGE: Record<string, number> = { scout: 2500, combat: 3000, assault: 3500, sentry: 5000 }
  const dc = d.droneClass
  check(dc !== undefined && DRONE_CLASS_RANGE[dc] !== undefined, `无人机 ${d.id} droneClass 缺失或非法：${String(dc)}`)
  if (dc !== undefined && DRONE_CLASS_RANGE[dc] !== undefined) {
    check(
      d.maxRangeM === DRONE_CLASS_RANGE[dc],
      `无人机 ${d.id}（${dc}）射程应为 ${DRONE_CLASS_RANGE[dc]}，实际 ${String(d.maxRangeM)}`,
    )
  }
  // V11：无人机生存包契约（三层血量必填、回避与抗性界内）
  const def = d.defense
  check(!!def && (def.shieldHp ?? 0) > 0 && (def.armorHp ?? 0) > 0 && (def.hullHp ?? 0) > 0, `无人机 ${d.id} defense 缺失或三层血量非正（V11）`)
  check(def === undefined || def.evasion === undefined || (def.evasion >= 0 && def.evasion <= 0.9), `无人机 ${d.id} defense.evasion 越界`)
  for (const r of ['shieldResist', 'armorResist', 'hullResist'] as const) {
    const res = def?.[r]
    if (!res) continue
    for (const [t, val] of Object.entries(res)) {
      if (!DMG_TYPES.has(t) || typeof val !== 'number' || !Number.isFinite(val) || val < 0 || val > 0.9) {
        errors.push(`无人机 ${d.id} defense.${r}.${t} 非法：${String(val)}`)
      }
    }
  }
  // 2026-09-10 四型定位契约（船长拍板；新增机型必须落在区间内——契约定义见 data/droneRoles.ts）
  for (const issue of droneRoleIssues(d, scoutDmg)) errors.push(issue)
}
{
  // 跨四类阶梯（闪避严格递减 / 血量与单发阶梯 / 哨戒血量与侦察机相仿）
  const ladderIssues = droneRoleLadderIssues(drones as never)
  for (const issue of ladderIssues) errors.push(`无人机定位契约：${issue}`)
  if (drones.length > 0) {
    const scout = drones.find((d) => d.droneClass === 'scout')
    console.log(
      `· 无人机四型定位：${drones
        .map((d) => {
          const cls = d.droneClass ?? '?'
          return `${DRONE_ROLE_SPECS[cls as keyof typeof DRONE_ROLE_SPECS]?.label ?? cls} 闪避 ${d.defense?.evasion ?? '—'}·血 ${droneTotalHp(d)}·单发 ${d.dmg ?? 0}`
        })
        .join('　')}（单发基准 = 侦察机 ${scoutDmg}）`,
    )
  }
}
for (const m of MODULES) {
  check((m.cpuUse ?? 0) > 0 && Number.isInteger(m.cpuUse), `装备 ${m.id} cpuUse 缺失或非法（V10.5b）`)
  // V18：家族合法（六家族 + 无人机装置两家族）
  check([...MODULE_SLOTS].includes(m.slot), `装备 ${m.id} 家族非法：${m.slot}`)
  // V18：槽类归属 rack 必填且与 rackOf 推导一致（Q3 映射集中落数据；防标注漂移）
  check(m.rack !== undefined && RACK_SLOTS.includes(m.rack), `装备 ${m.id} 缺少 V18 rack 归属`)
  if (m.rack !== undefined) {
    check(m.rack === rackOf(m), `装备 ${m.id} rack 标注（${m.rack}）与 Q3 推导（${rackOf(m)}）不一致`)
  }
  if (m.slot === 'drone-rack' || m.slot === 'drone-tac') {
    // V18 无人机装置：字段自洽（甲板扩展 = +droneBayM3；战术导控 = +droneDmgBonus；互斥）
    const hasBay = (m.droneBayBonusM3 ?? 0) > 0
    const hasDmg = (m.droneDmgBonus ?? 0) > 0
    check(hasBay !== hasDmg, `无人机装置 ${m.id} 必须且只能给一个效果字段（bay/dmg）`)
    if (hasBay) check((m.droneBayBonusM3 ?? 0) <= 500, `无人机甲板 ${m.id} droneBayBonusM3 越界`)
    if (hasDmg) check((m.droneDmgBonus ?? 0) <= 1, `战术导控 ${m.id} droneDmgBonus 越界`)
  }
  if (m.slot === 'miner' || m.slot === 'cargo') {
    // V17：工业槽保留加成系数形态
    check((m.bonus ?? 0) > 0 && Number.isFinite(m.bonus), `工业装备 ${m.id} bonus 缺失或非法（V17 仅工业槽使用）`)
  } else if (m.slot === 'turret') {
    // V17：炮台不再携带工业 bonus（火力参数 = 武器卡，见下方全参数检查）
    check(m.bonus === undefined, `炮台 ${m.id} 不应携带 bonus（V17 起炮台用武器参数）`)
    check(m.damageType !== undefined && DMG_TYPES.has(m.damageType), `炮台 ${m.id} damageType 缺失或非法（V17.2 炮族制：固定弹种）`)
    check((m.ammoPerEngagement ?? 0) > 0 && Number.isInteger(m.ammoPerEngagement), `炮台 ${m.id} ammoPerEngagement 缺失或非法`)
    // V12：武器参数必填且值域合法
    check(m.maxRangeM !== undefined && m.maxRangeM > 0, `炮台 ${m.id} maxRangeM 缺失或非法`)
    check(m.minRangeM !== undefined && m.minRangeM >= 0 && m.minRangeM < (m.maxRangeM ?? 0), `炮台 ${m.id} minRangeM 非法`)
    check(m.hitRate !== undefined && m.hitRate > 0 && m.hitRate <= 1, `炮台 ${m.id} hitRate 非法`)
    check(m.falloff !== undefined && m.falloff > 0 && m.falloff <= 1, `炮台 ${m.id} falloff 非法`)
    check(m.reloadMs !== undefined && m.reloadMs > 0 && Number.isInteger(m.reloadMs), `炮台 ${m.id} reloadMs 非法`)
    check(m.dmgMult !== undefined && m.dmgMult > 0, `炮台 ${m.id} dmgMult 非法`)
  } else if (m.slot === 'shield') {
    // V17.1 拆族：容量件（shieldHpBonus）与抗性件（shieldResistAdd）互斥，且必须给一项
    const cap = m.shieldHpBonus
    const add = m.shieldResistAdd
    const hasCap = cap !== undefined
    const hasAdd = add !== undefined && Object.keys(add).length > 0
    check(hasCap || hasAdd, `护盾 ${m.id} 未声明容量或抗性（V17.1 拆族）`)
    check(!(hasCap && hasAdd), `护盾 ${m.id} 同时携带容量与抗性——抗性/容量件已拆族（V17.1）`)
    if (hasCap) check(cap !== undefined && cap > 0 && cap <= 2, `护盾 ${m.id} shieldHpBonus 非法`)
    if (hasAdd) {
      for (const [t, val] of Object.entries(add ?? {})) {
        if (!DMG_TYPES.has(t) || typeof val !== 'number' || !Number.isFinite(val) || val <= 0 || val > 0.9) {
          errors.push(`护盾 ${m.id} shieldResistAdd.${t} 非法：${String(val)}（需 (0, 0.9]，乘入缺口值）`)
        }
      }
    }
  } else if (m.slot === 'armor') {
    // V17.1 拆族：同上（装甲镀层=抗性 / 装甲增厚板=容量）
    const cap = m.armorHpBonus
    const add = m.armorResistAdd
    const hasCap = cap !== undefined
    const hasAdd = add !== undefined && Object.keys(add).length > 0
    check(hasCap || hasAdd, `装甲 ${m.id} 未声明容量或抗性（V17.1 拆族）`)
    check(!(hasCap && hasAdd), `装甲 ${m.id} 同时携带容量与抗性——抗性/容量件已拆族（V17.1）`)
    if (hasCap) check(cap !== undefined && cap > 0 && cap <= 2, `装甲 ${m.id} armorHpBonus 非法`)
    if (hasAdd) {
      for (const [t, val] of Object.entries(add ?? {})) {
        if (!DMG_TYPES.has(t) || typeof val !== 'number' || !Number.isFinite(val) || val <= 0 || val > 0.9) {
          errors.push(`装甲 ${m.id} armorResistAdd.${t} 非法：${String(val)}（需 (0, 0.9]，乘入缺口值）`)
        }
      }
    }
    // 2026-09-10 船长：重甲件的**机动代价**（陵寝装甲层 −25%）——值域 (0, 0.9]；
    // 只挂在容量件上（抗性件不该借代价换额外厚度），多件不叠加、战斗内取最重一件
    if (m.speedPenaltyPct !== undefined) {
      check(
        m.speedPenaltyPct > 0 && m.speedPenaltyPct <= 0.9,
        `装甲 ${m.id} speedPenaltyPct 非法（需 (0, 0.9]，战斗速度代价）`,
      )
      check(hasCap, `装甲 ${m.id} 带 speedPenaltyPct 却不给容量——机动代价只挂在容量件上`)
    }
    // 2026-09-10 船长：**结构层容量**（E 族巨构骨架引出）——值域 (0, 2]，通常与装甲容量同件
    if (m.hullHpBonus !== undefined) {
      check(
        m.hullHpBonus > 0 && m.hullHpBonus <= 2,
        `装甲 ${m.id} hullHpBonus 非法（需 (0, 2]，结构层容量加成）`,
      )
    }
  } else if (m.slot === 'propulsion') {
    // 2026-09-08 船长：取消 speedBonusPct ≤0.9 上限护栏（推进器提速档位改由设计定；命中代价 hitPenalty 仍受检）
    check(m.speedBonusPct !== undefined && m.speedBonusPct > 0, `推进器 ${m.id} speedBonusPct 非法（需为正）`)
    check(m.hitPenalty === undefined || (m.hitPenalty >= 0 && m.hitPenalty <= 0.5), `推进器 ${m.id} hitPenalty 非法（需 [0, 0.5]，V17.1 命中代价）`)
  } else if (m.slot === 'missile') {
    // V18B-1 导弹架：爆炸系武器形态——追踪命中（不随距离衰减）+ 近盲安全射距（防自爆）
    check(m.bonus === undefined, `导弹架 ${m.id} 不应携带工业 bonus`)
    check(m.damageType === 'explosive', `导弹架 ${m.id} damageType 必须为 explosive（爆炸系武器形态）`)
    check((m.ammoPerEngagement ?? 0) > 0 && Number.isInteger(m.ammoPerEngagement), `导弹架 ${m.id} ammoPerEngagement 缺失或非法`)
    check(m.maxRangeM !== undefined && m.maxRangeM > 0, `导弹架 ${m.id} maxRangeM 缺失或非法`)
    check((m.minRangeM ?? 0) > 0 && (m.minRangeM ?? 0) < (m.maxRangeM ?? 0), `导弹架 ${m.id} minRangeM 必须为近盲正数（太近会炸到自己）`)
    check(m.hitRate !== undefined && m.hitRate > 0 && m.hitRate <= 1, `导弹架 ${m.id} hitRate 非法`)
    check(m.falloff === 1, `导弹架 ${m.id} falloff 必须为 1（命中不随距离衰减）`)
    check(m.reloadMs !== undefined && m.reloadMs > 0 && Number.isInteger(m.reloadMs), `导弹架 ${m.id} reloadMs 非法`)
    check(m.dmgMult !== undefined && m.dmgMult > 0, `导弹架 ${m.id} dmgMult 非法`)
  } else if (m.slot === 'laser') {
    // V18B-2 激光炮：能量系武器形态——必中光束（消耗能量弹药，威力随距离衰减）
    check(m.bonus === undefined, `激光炮 ${m.id} 不应携带工业 bonus`)
    check(m.damageType === 'plasma', `激光炮 ${m.id} damageType 必须为 plasma（能量系武器形态）`)
    check((m.ammoPerEngagement ?? 0) > 0 && Number.isInteger(m.ammoPerEngagement), `激光炮 ${m.id} ammoPerEngagement 缺失或非法`)
    check(m.maxRangeM !== undefined && m.maxRangeM > 0, `激光炮 ${m.id} maxRangeM 缺失或非法`)
    check(m.minRangeM === 0, `激光炮 ${m.id} minRangeM 必须为 0（光束无近盲）`)
    check(m.hitRate === 1, `激光炮 ${m.id} hitRate 必须为 1（必中，不掷命中）`)
    check(m.falloff !== undefined && m.falloff > 0 && m.falloff <= 1, `激光炮 ${m.id} falloff（威力衰减参）非法`)
    check(m.reloadMs !== undefined && m.reloadMs > 0 && Number.isInteger(m.reloadMs), `激光炮 ${m.id} reloadMs 非法`)
    check(m.dmgMult !== undefined && m.dmgMult > 0, `激光炮 ${m.id} dmgMult 非法`)
  } else if (m.slot === 'support') {
    // V18.1 支援件：恰好一类效果字段（伤害稳定器按系/射速/命中/闪避互斥），值域合法；
    // 2026-09-09 维修装置：修复系 = repairArmorHp/repairHullHp 可同带（装甲+结构双层修复）——
    // 修复系与旧四类效果互斥（一件只给一个功能系）
    const stabKeys = Object.entries(m.damageTypeBonusPct ?? {}).filter(([, v]) => (v ?? 0) > 0).length
    const hasRof = m.reloadCutPct !== undefined
    const hasHit = m.hitBonusPct !== undefined
    const hasEva = m.evasionGapPct !== undefined
    const hasRepair = (m.repairArmorHp ?? 0) > 0 || (m.repairHullHp ?? 0) > 0
    const kinds = (stabKeys > 0 ? 1 : 0) + (hasRof ? 1 : 0) + (hasHit ? 1 : 0) + (hasEva ? 1 : 0) + (hasRepair ? 1 : 0)
    check(kinds === 1, `支援件 ${m.id} 必须且只能给一类效果（伤害系/射速/命中/闪避/修复）`)
    if (hasRepair) {
      // 修复系：装甲/结构修复值 ∈ [1, 100]、周期缺省 5 秒（2000~60_000 毫秒）、必须指明消耗的修理组件
      check((m.repairArmorHp ?? 0) >= 0 && (m.repairArmorHp ?? 0) <= 100 && (m.repairHullHp ?? 0) >= 0 && (m.repairHullHp ?? 0) <= 100,
        `支援件 ${m.id} 修复值非法（需 [0, 100] 且至少一层 > 0）`)
      const interval = m.repairIntervalMs ?? 5_000
      check(Number.isInteger(interval) && interval >= 2_000 && interval <= 60_000, `支援件 ${m.id} repairIntervalMs 非法（需 2000~60000 毫秒）`)
      // 2026-09-10 船长：异形生体件 = **无消耗自愈**（repairFree）——与消耗件互斥：
      // 要么指明民用/军用修理组件，要么标 repairFree（不吃组件、永不停机）
      check(
        (m.repairKit === 'repairkit-civ' || m.repairKit === 'repairkit-mil') !== (m.repairFree === true),
        `支援件 ${m.id} 必须二选一：指明消耗组件（民用/军用修理组件）或标 repairFree（无消耗自愈）`,
      )
      check(m.rack === 'mid', `支援件 ${m.id}（修复）应为中槽，实际 ${m.rack}`)
      check(m.reloadCutPct === undefined && m.hitBonusPct === undefined && m.evasionGapPct === undefined && stabKeys === 0,
        `支援件 ${m.id} 修复系不得与其它支援效果同带`)
    } else {
      for (const [t, val] of Object.entries(m.damageTypeBonusPct ?? {})) {
        if (!DMG_TYPES.has(t) || typeof val !== 'number' || !Number.isFinite(val) || val <= 0 || val > 0.9) {
          errors.push(`支援件 ${m.id} damageTypeBonusPct.${t} 非法：${String(val)}`)
        }
      }
      if (hasRof) check((m.reloadCutPct ?? 0) > 0 && (m.reloadCutPct ?? 0) <= 0.9, `支援件 ${m.id} reloadCutPct 非法（需 (0, 0.9]）`)
      if (hasHit) check((m.hitBonusPct ?? 0) > 0 && (m.hitBonusPct ?? 0) <= 0.9, `支援件 ${m.id} hitBonusPct 非法（需 (0, 0.9]）`)
      if (hasEva) check((m.evasionGapPct ?? 0) > 0 && (m.evasionGapPct ?? 0) <= 0.9, `支援件 ${m.id} evasionGapPct 非法（需 (0, 0.9]）`)
      // 归槽语义：伤害/射速 = 低槽；命中/闪避 = 中槽（数据显式 rack，rackOf 已校验一致）
      if (stabKeys > 0 || hasRof) check(m.rack === 'low', `支援件 ${m.id}（伤害/射速）应为低槽，实际 ${m.rack}`)
      if (hasHit || hasEva) check(m.rack === 'mid', `支援件 ${m.id}（命中/闪避）应为中槽，实际 ${m.rack}`)
    }
    check(m.bonus === undefined, `支援件 ${m.id} 不应携带工业 bonus`)
    check(m.maxRangeM === undefined && m.damageType === undefined, `支援件 ${m.id} 不应携带炮台武器参数`)
  } else if (m.slot === 'target-lock') {
    // 2026-09-09 目标锁定阵列（高槽 target-lock）：携带 lockDmgBonus 值域合法、必须高槽、
    // 不携带其它效果/武器参数
    check((m.lockDmgBonus ?? 0) > 0 && (m.lockDmgBonus ?? 0) <= 0.9, `锁定装置 ${m.id} lockDmgBonus 非法（需 (0, 0.9]）`)
    check(m.rack === 'high', `锁定装置 ${m.id} 应为高槽，实际 ${m.rack}`)
    check(m.bonus === undefined && m.damageType === undefined && m.maxRangeM === undefined, `锁定装置 ${m.id} 不应携带工业/武器参数`)
  }
}

/* ── B3.1 敌群特色回收池（2026-09-08 收尾：池均价 ÷ 档基数 ∈ 保底乘数 m ±3%）
 *   公式（docs/design/b3-flavor-content.md）：m = mSec(≤1.45) × mThreat(≤1.30)，
 *   mSec = 1 + 0.45×max(0,−sec)；mThreat = 1 + 0.004×threat；档基数 = RECYCLE_POOL_AVG_ISK[tier] */
{
  const ctx = buildSimContext()
  let flavored = 0
  for (const def of ANOMALIES_FLAVORED) {
    if (!def.recyclePool || def.recyclePool.length === 0) continue
    flavored += 1
    const galaxy = ctx.galaxies.get(def.galaxyId)
    const sec = typeof galaxy?.security === 'number' && Number.isFinite(galaxy.security) ? galaxy.security : 0.5
    const mSec = Math.min(1.45, 1 + 0.45 * Math.max(0, -sec))
    const mThreat = Math.min(1.3, 1 + 0.004 * (def.threat ?? 0))
    const m = mSec * mThreat
    const pool = def.recyclePool
    const wSum = pool.reduce((s, [, w]) => s + w, 0)
    let avg = 0
    let missing: string | null = null
    for (const [id, w] of pool) {
      const item = ctx.items.get(id)
      if (!item || (item.baseSellPriceIsk ?? 0) <= 0) {
        missing = missing ?? `池矿物 ${id} 缺失或价格非法`
        continue
      }
      avg += (w / wSum) * item.baseSellPriceIsk!
    }
    const tier = recycleTierOf(wreckBaseDensity(def.galaxyId, ctx))
    const base = RECYCLE_POOL_AVG_ISK[tier]
    const ratio = avg / base
    const dev = ((ratio - m) / m) * 100
    check(
      missing === null && Math.abs(dev) <= 3,
      `B3.1 ${def.name}（${def.id}）特色池校验失败：${missing ?? `池均价 ${avg.toFixed(2)} ÷ 档基数 ${base} = ${ratio.toFixed(3)}，目标 m=${m.toFixed(3)}（偏差 ${dev.toFixed(1)}% > ±3%）`}`,
    )
  }
  check(flavored >= 21, `B3.1 特色池卡数应为 21，实际 ${flavored}`)
  console.log(`· B3.1 特色回收池：${flavored} 张（约束：池均价 = m × 档基数 ±3%）`)
  // 残骸收购卡价格锚（2026-09-08 船长定 + 当日修正）：收价 < 无技能拆解保底（≈57/m³，三档齐平），
  // 且与档位表一致（常 30 / 险 40 / 危 50，≈该档典型特色回收的五成上下）
  const wreckBuyPrice = { common: 30, risky: 40, dire: 50 }
  const noSkillPerM3 = 82_000 / 1_440
  for (const g of WRECK_BUY_GOODS) {
    const anoId = g.refId.startsWith('wreck-') ? g.refId.slice('wreck-'.length) : ''
    const def = ANOMALIES_FLAVORED.find((a) => a.id === anoId)
    const sec = typeof ctx.galaxies.get(def?.galaxyId ?? '')?.security === 'number' ? ctx.galaxies.get(def!.galaxyId)!.security! : 0.5
    const density = Math.min(40, Math.max(10, Math.round(10 + 15 * (1 - sec))))
    const tier = density >= 30 ? 'dire' : density >= 20 ? 'risky' : 'common'
    check(g.basePrice === wreckBuyPrice[tier], `残骸卡 ${g.key} 价格档错位：期望 ${wreckBuyPrice[tier]}（${tier}），实际 ${g.basePrice}`)
    check(g.basePrice < noSkillPerM3, `残骸卡 ${g.key} 收价 ${g.basePrice} 不低于无技能拆解保底 ${noSkillPerM3.toFixed(1)}/m³——会击穿回收线最低锚`)
    check(g.playerBuyable === false, `残骸卡 ${g.key} 必须只收不卖（playerBuyable=false）`)
  }
  console.log(`· 残骸收购卡：${WRECK_BUY_GOODS.length} 张（收价 = 常 30 / 险 40 / 危 50 ISK·m³，须低于无技能拆解保底）`)
  // 2026-09-08 船长定稿：①主题彩头（recycleLoot 追加件）只允许 sec < 0.5 星系；
  // ②主题追加件不得含武器（炮/激光/导弹架），唯一例外 = 穹顶守卫门槛线追加三把 MK3 武器；
  // ③MK3 一律走碎片，穹顶守卫 × {三把 MK3 武器} 为唯一 MK3 直出白名单
  const weaponIds = new Set(MODULES.filter((m) => m.slot === 'turret' || m.slot === 'laser' || m.slot === 'missile').map((m) => m.id))
  const mk3Weapons = ['mod-turret-kin-3', 'mod-laser-3', 'mod-missile-3']
  let lootCards = 0
  for (const def of ANOMALIES_FLAVORED) {
    const loot = def.recycleLoot
    if (!loot || (!loot.modules?.length && !loot.mk2?.length)) continue
    lootCards += 1
    const galaxy = ctx.galaxies.get(def.galaxyId)
    const sec = typeof galaxy?.security === 'number' && Number.isFinite(galaxy.security) ? galaxy.security : 0.5
    check(sec < 0.5, `B3.1 主题彩头仅限 sec<0.5 星系：${def.name}（${def.galaxyId}）sec=${sec}`)
    for (const group of ['modules', 'mk2'] as const) {
      for (const id of loot[group] ?? []) {
        const isMk3 = id.endsWith('-3')
        const vaultMk3 = def.id === 'ano-vault-sentinel' && mk3Weapons.includes(id)
        check(!isMk3 || vaultMk3, `B3.1 MK3 直出收口失败：${def.name} 主题件 ${id}（MK3 一律走碎片，唯一白名单 = 穹顶守卫 × 三把 MK3 武器）`)
        check(!weaponIds.has(id) || vaultMk3, `B3.1 武器移出主题失败：${def.name} 主题追加件 ${id} 是武器（主题只放增幅装备；唯一武器例外 = 穹顶守卫三把 MK3）`)
      }
    }
  }
  console.log(`· B3.1 主题追加件：${lootCards} 张卡（sec<0.5 增幅件；武器白名单仅穹顶守卫 × MK3 三武）`)
}

/* ── 图标覆盖契约（2026-09-10 加）：每个物品种类 / 装备槽位 / 舰船族都必须有 Glyphs 图形与色调 ──
 * 背景：仓库·货仓·图鉴·工业页卡片的行首图标一律按 kind / slot / role 取图形，缺键会**静默**落兜底圆环徽
 *（当天补齐的正是 wreck / fragment / kit / salvager / target-lock 五个键）——新增内容种类时在此拦住。 */
{
  const glyphPath = join(process.cwd(), 'apps', 'desktop', 'src', 'renderer', 'src', 'ui', 'Glyphs.tsx')
  if (!existsSync(glyphPath)) {
    check(false, `图标契约：找不到渲染层图标库 ${glyphPath}（文件移位请同步本检查）`)
  } else {
    const glyphSrc = readFileSync(glyphPath, 'utf8')
    const keysOf = (block: string): Set<string> => {
      const m = glyphSrc.match(new RegExp(`${block}: Record<string, (?:string|ReactNode)> = \\{([\\s\\S]*?)\\n\\}`))
      return new Set([...(m?.[1] ?? '').matchAll(/^\s*'?([A-Za-z0-9-]+)'?:/gm)].map((x) => x[1]))
    }
    const shapes = keysOf('SHAPES')
    const tones = keysOf('TONES')
    const needed = [...ITEM_KIND_ORDER, ...MODULE_SLOTS, ...Object.keys(SHIP_ROLE_LABELS), 'blueprint']
    for (const key of needed) {
      check(shapes.has(key), `图标契约：${key} 缺 Glyphs 图形（列表/卡片行首会落兜底圆环徽；请在 ui/Glyphs.tsx 补 SHAPES.${key}）`)
      check(tones.has(key), `图标契约：${key} 缺 TONES 色调（未知键一律落默认灰）`)
    }
    if (needed.every((key) => shapes.has(key) && tones.has(key))) {
      console.log(
        `· 图标契约：物品 ${ITEM_KIND_ORDER.length} 类 + 槽位 ${MODULE_SLOTS.length} 个 + 舰船族 ${Object.keys(SHIP_ROLE_LABELS).length} 个 图形/色调齐备` +
          `（图标库共 ${shapes.size}/${tones.size} 键）`,
      )
    }
  }
}

/* ── 赏金任务·敌人窝点契约（2026-09-10 加）：可作窝点目标的敌群必须齐备"派生所需的三件套" ──
 * ①稀有残骸物品（窝点战利品，打捞必得 → 高级箱）已注册进 ctx.items；
 * ②三档称呼词齐全（敌族词表或卡级覆盖）；
 * ③该敌族的**专属装备**至少一件，且 id 必须真实存在（B/F 两族留空，见下）。
 * 另：**B 族（武装拾荒者）已取消**——任何 B 族卡都不得成为窝点候选（船长 2026-09-10 定）。 */
{
  let lairCards = 0
  const famWithGear = new Set<string>()
  const lairCtx = buildSimContext()
  for (const def of ANOMALIES_FLAVORED) {
    if (def.foeFamily === 'B') {
      check(!isLairCandidate(def), `窝点契约：B 族已取消（2026-09-10 船长定），${def.name} 不得作为窝点候选`)
      check(FOE_LAIR_GEAR.B.length === 0, `窝点契约：B 族专属装备应已撤下，实际 ${FOE_LAIR_GEAR.B.join('、')}`)
    }
    if (!isLairCandidate(def)) continue
    lairCards += 1
    const rareId = rareWreckItemIdOf(def.id)
    const rareDef = lairCtx.items.get(rareId)
    check(!!rareDef, `窝点契约：${def.name} 缺稀有残骸物品 ${rareId}（data/context.ts 需按 hasLairCore 注册）`)
    if (rareDef) {
      check(rareDef.kind === 'wreck', `窝点契约：稀有残骸 ${rareId} 种类应为 wreck，实际 ${rareDef.kind}`)
      check(
        rareDef.unitM3 === 1,
        `窝点契约：稀有残骸 ${rareId} 必须沿用"计数即体积"台账（unitM3 = 1，1 件 = ${RARE_WRECK_VOLUME_M3} 单位 = ${RARE_WRECK_VOLUME_M3} m³），实际 unitM3=${rareDef.unitM3}`,
      )
    }
    const names = [1, 2, 3].map((t) => lairNameOf(def, t as 1 | 2 | 3))
    for (const n of names) check(n.trim().length > 0 && !n.endsWith('·'), `窝点契约：${def.name} 档位称呼为空（name=${n}）`)
    check(new Set(names).size === 3, `窝点契约：${def.name} 三档称呼重复（${names.join(' / ')}）`)
    const gear = lairGearOf(def)
    if (def.foeFamily && def.foeFamily !== 'F') famWithGear.add(def.foeFamily)
    for (const id of gear) {
      check(moduleIdSet.has(id), `窝点契约：${def.name} 专属装备 ${id} 不存在（modules.ts 未登记）`)
    }
  }
  for (const fam of famWithGear) {
    check(
      FOE_LAIR_GEAR[fam].length > 0,
      `窝点契约：敌族 ${fam} 有窝点成员但没配专属装备（FOE_LAIR_GEAR，每族至少一件）`,
    )
  }
  /* 专属装备的"来源唯一"契约（2026-09-10 加）：这批装备**只能**从高级箱（稀有残骸额外掉落）出——
   * 不得有蓝图（造不出来）、不得有市场卡（买不到也卖不掉）、不得有碎片逆向配方、
   * 不得混进任何敌群的常规残骸主题池（否则普通残骸就能刷出窝点专属，稀释窝点价值）。 */
  {
    const lairGearIds = new Set<string>(Object.values(FOE_LAIR_GEAR).flat())
    const bpByModule = new Map<string, string>()
    for (const bp of BLUEPRINTS) if (bp.moduleId) bpByModule.set(bp.moduleId, bp.id)
    let marketCards = 0
    for (const id of lairGearIds) {
      const bp = bpByModule.get(id)
      check(!bp, `来源唯一契约：窝点专属装备 ${id} 不得有蓝图（现被 ${bp} 产出；专属装备只能从高级箱出）`)
      const card = [...lairCtx.marketGoods.values()].find((g) => g.key === id || g.refId === id)
      if (card) marketCards += 1
      check(!card, `来源唯一契约：窝点专属装备 ${id} 不得有市场卡（现被 ${card?.key} 上架；专属装备只能从高级箱出）`)
      const frag = FRAGMENT_RECIPES[id]
      check(
        !frag,
        `来源唯一契约：窝点专属装备 ${id} 不得有碎片逆向配方（现指向 ${frag?.blueprintId}；专属装备只能从高级箱出）`,
      )
      for (const def of ANOMALIES_FLAVORED) {
        const inPool = [...(def.recycleLoot?.modules ?? []), ...(def.recycleLoot?.mk2 ?? [])].includes(id)
        check(
          !inPool,
          `来源唯一契约：窝点专属装备 ${id} 不得混进 ${def.name} 的常规残骸主题池（专属装备只能从高级箱出）`,
        )
      }
    }
    check(marketCards === 0, `来源唯一契约：窝点专属装备共 ${marketCards} 件出现在市场上架（应为 0）`)
    console.log(
      `· 来源唯一契约：${lairGearIds.size} 件窝点专属装备无蓝图、无市场卡、无碎片配方、不进常规掉落池（唯一来源＝高级箱）`,
    )
  }
  // 日板席位可行性（2026-09-10 船长定：高安不派发，中安 2 席 + 低安 3 席）：各区都要有候选可抽
  const zoneCount = { 中安: 0, 低安: 0 }
  for (const def of ANOMALIES_FLAVORED) {
    if (!isLairCandidate(def)) continue
    const sec = lairCtx.galaxies.get(def.galaxyId)?.security
    const v = typeof sec === 'number' && Number.isFinite(sec) ? sec : 0.5
    if (v >= 0.5) continue
    if (v >= 0) zoneCount.中安 += 1
    else zoneCount.低安 += 1
  }
  for (const plan of BOUNTY_ZONE_PLAN) {
    const have = plan.zone === '高安' ? 0 : zoneCount[plan.zone as '中安' | '低安']
    check(
      have >= plan.count,
      `日板席位：${plan.zone} 需 ${plan.count} 个候选地点，实际只有 ${have} 个（抽不满就少发，请补内容）`,
    )
  }
  // 敌对派系活跃（2026-09-10）：候选 = 中安/低安星系的常驻悬赏（非隐藏、有核心词、奖金 > 0）——
  // 至少要有 1 个，否则这条置顶任务永远刷不出来
  const factionPool = new Set<string>()
  for (const def of ANOMALIES_FLAVORED) {
    if (!hasLairCore(def) || !(def.rewardIsk > 0)) continue
    const sec = lairCtx.galaxies.get(def.galaxyId)?.security
    const v = typeof sec === 'number' && Number.isFinite(sec) ? sec : 0.5
    if (v >= 0.5) continue
    factionPool.add(def.galaxyId)
  }
  check(
    factionPool.size > 0,
    '派系活跃：中安/低安至少要有一个可作目标的星系（常驻悬赏），否则这条置顶任务永远刷不出来',
  )
  console.log(
    `· 派系活跃：候选 ${factionPool.size} 个中安/低安星系（掉落概率 ${Math.round(FACTION_RARE_DROP_CHANCE * 100)}% ×${FACTION_RARE_DROP_COUNT} 件，待船长核定）`,
  )
  console.log(`· 窝点契约：${lairCards} 张窝点卡（稀有残骸 + 三档称呼 + 专属装备齐备，覆盖 ${famWithGear.size} 个敌族）`)
}

/* ── 输出 ── */
console.log(`· 蓝图：装备 ${BLUEPRINTS.length} 张 + 舰船 ${SHIP_BLUEPRINTS.length} 张`)
if (warn.length > 0) {
  console.log('· 警告：')
  for (const w of warn) console.log(`  ⚠ ${w}`)
}
if (errors.length > 0) {
  console.error(`\n❌ 内容体检失败：${errors.length} 处错误`)
  for (const e of errors) console.error(`  ✗ ${e}`)
  process.exit(1)
}
console.log('\n✅ 内容体检通过：全部交叉引用可解析，无死物品。')
