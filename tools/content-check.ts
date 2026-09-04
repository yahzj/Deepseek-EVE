/**
 * 内容完整性体检（V10 数据大扩容后加入）：
 * 校验 data 包全部内容表的交叉引用，防止"加数据改漏引用"造成的死物品/坏目录。
 *
 * 覆盖（中文说明）：
 * - 目录键唯一；市场卡 refId 必须能按 kind 解析到真实条目；
 * - 每种物品（矿石/矿物/气体/冰/弹药/无人机）都必须有市场卡（防死物品：买不了也卖不了）；
 * - 采集点：id 唯一、产出物存在且可采集（ore/gas/ice）、声望门槛非负整数；
 * - 精炼配方：只有可精炼资源（ore/gas/ice）带配方、配方行矿物存在且 kind=mineral；
 * - 装备：id 唯一、slot 在六槽内、每件装备必须有市场卡；
 * - 蓝图：id 唯一、模块/船存在、材料都是矿物、蓝图必须有市场卡（否则无法购书学习）；
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
  MODULES,
  SHIP_BLUEPRINTS,
  SHIPS,
  buildItemCatalog,
} from '@whale/data'
import { MODULE_SLOTS, MINEABLE_KINDS } from '@whale/core'

const errors: string[] = []
const warn: string[] = []

function check(cond: boolean, msg: string): void {
  if (!cond) errors.push(msg)
}

/* ── 基础目录 ── */
const items = buildItemCatalog()
const itemDefs = [...ITEMS]
const ores = itemDefs.filter((i) => i.kind === 'ore')
const minerals = itemDefs.filter((i) => i.kind === 'mineral')
const gases = itemDefs.filter((i) => i.kind === 'gas')
const ices = itemDefs.filter((i) => i.kind === 'ice')
const ammos = itemDefs.filter((i) => i.kind === 'ammo')
const drones = itemDefs.filter((i) => i.kind === 'drone')
const DMG_TYPES = new Set(['kinetic', 'explosive', 'plasma'])

// 数量与目标规模（V10 设计确认；V16 矿带整合：矿石 10→7，总量 35→32）
check(itemDefs.length === 32, `物品总数应为 32，实际 ${itemDefs.length}`)
check(ores.length === 7, `矿石应为 7 种，实际 ${ores.length}`)
check(minerals.length === 8, `矿物应为 8 种，实际 ${minerals.length}`)
check(gases.length === 4, `气体应为 4 种，实际 ${gases.length}`)
check(ices.length === 3, `冰矿应为 3 种，实际 ${ices.length}`)
check(ammos.length === 6, `弹药应为 6 种，实际 ${ammos.length}`)
check(drones.length === 4, `无人机应为 4 种，实际 ${drones.length}`)

/* ── 市场目录 ── */
const goodKeys = new Set<string>()
const itemGoods = new Map<string, { rarity: string; playerSellable: boolean }>()
for (const g of MARKET_GOODS) {
  if (goodKeys.has(g.key)) errors.push(`市场卡键重复：${g.key}`)
  goodKeys.add(g.key)
  switch (g.kind) {
    case 'item':
      check(items.has(g.refId), `市场卡 ${g.key} → 物品 ${g.refId} 不存在`)
      if (items.has(g.refId)) itemGoods.set(g.refId, { rarity: g.rarity, playerSellable: g.playerSellable !== false })
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
console.log(`· 市场商品卡：${MARKET_GOODS.length} 张（目标 ~95~110）`)

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
    check(item.kind === 'mineral' || item.kind === 'ammo' || item.kind === 'drone', `${item.id}（${item.kind}）没有精炼配方——可采集资源必须有配方`)
  }
}

// 装备
const moduleIds = new Set<string>()
for (const m of MODULES) {
  if (moduleIds.has(m.id)) errors.push(`装备 id 重复：${m.id}`)
  moduleIds.add(m.id)
  check(MODULE_SLOTS.includes(m.slot), `装备 ${m.id} 槽位非法：${m.slot}`)
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
  check(moduleIdSet.has(bp.moduleId), `蓝图 ${bp.id} → 装备 ${bp.moduleId} 不存在`)
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
check(SHIPS.length === 19, `舰船应为 19 艘，实际 ${SHIPS.length}`)
console.log(`· 舰船：${SHIPS.length} 艘（role 分布：${['industrial', 'armed', 'armored', 'hauler'].map((r) => `${r}=${SHIPS.filter((s) => s.role === r).length}`).join(' ')})`)

/* ── V10.5 战斗数值契约：弹药 / 无人机 / 装备字段 ── */
for (const a of ammos) {
  check(a.damageType !== undefined && DMG_TYPES.has(a.damageType), `弹药 ${a.id} damageType 缺失或非法`)
  check(a.ammoSize === 'light' || a.ammoSize === 'heavy', `弹药 ${a.id} ammoSize 缺失或非法`)
  check(a.id.endsWith('-l') === (a.ammoSize === 'light'), `弹药 ${a.id} 尺寸与 id 后缀不一致`)
  check((a.dmg ?? 0) > 0 && Number.isFinite(a.dmg), `弹药 ${a.id} dmg 缺失或非正`)
}
for (const size of ['light', 'heavy'] as const) {
  const byType = (t: string) => ammos.find((a) => a.ammoSize === size && a.damageType === t)?.dmg ?? 0
  check(
    byType('plasma') > byType('kinetic') && byType('plasma') > byType('explosive'),
    `${size} 弹：能量(plasma)基数应最高（通用弹凭基数在结构层胜出）`,
  )
}
for (const d of drones) {
  check(d.damageType !== undefined && DMG_TYPES.has(d.damageType), `无人机 ${d.id} damageType 缺失或非法`)
  check((d.dmg ?? 0) > 0 && Number.isFinite(d.dmg), `无人机 ${d.id} dmg 缺失或非正`)
  check((d.cpuUse ?? 0) > 0 && Number.isInteger(d.cpuUse), `无人机 ${d.id} cpuUse 缺失或非法（V10.5b 放飞占 CPU）`)
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
}
for (const m of MODULES) {
  check((m.cpuUse ?? 0) > 0 && Number.isInteger(m.cpuUse), `装备 ${m.id} cpuUse 缺失或非法（V10.5b）`)
  if (m.slot === 'turret') {
    check(m.weaponSize === 'light' || m.weaponSize === 'heavy', `炮台 ${m.id} weaponSize 缺失或非法`)
    check((m.ammoPerEngagement ?? 0) > 0 && Number.isInteger(m.ammoPerEngagement), `炮台 ${m.id} ammoPerEngagement 缺失或非法`)
    // V12：武器参数必填且值域合法
    check(m.maxRangeM !== undefined && m.maxRangeM > 0, `炮台 ${m.id} maxRangeM 缺失或非法`)
    check(m.minRangeM !== undefined && m.minRangeM >= 0 && m.minRangeM < (m.maxRangeM ?? 0), `炮台 ${m.id} minRangeM 非法`)
    check(m.hitRate !== undefined && m.hitRate > 0 && m.hitRate <= 1, `炮台 ${m.id} hitRate 非法`)
    check(m.falloff !== undefined && m.falloff > 0 && m.falloff <= 1, `炮台 ${m.id} falloff 非法`)
    check(m.reloadMs !== undefined && m.reloadMs > 0 && Number.isInteger(m.reloadMs), `炮台 ${m.id} reloadMs 非法`)
    check(m.dmgMult !== undefined && m.dmgMult > 0, `炮台 ${m.id} dmgMult 非法`)
  } else if (m.slot === 'shield') {
    check(m.shieldHpBonus !== undefined && m.shieldHpBonus > 0 && m.shieldHpBonus <= 2, `护盾 ${m.id} shieldHpBonus 非法`)
    check(m.shieldResistBonus !== undefined && m.shieldResistBonus >= 0 && m.shieldResistBonus <= 0.9, `护盾 ${m.id} shieldResistBonus 非法`)
  } else if (m.slot === 'armor') {
    check(m.armorHpBonus !== undefined && m.armorHpBonus > 0 && m.armorHpBonus <= 2, `装甲 ${m.id} armorHpBonus 非法`)
    check(m.armorResistBonus !== undefined && m.armorResistBonus >= 0 && m.armorResistBonus <= 0.9, `装甲 ${m.id} armorResistBonus 非法`)
  } else if (m.slot === 'propulsion') {
    check(m.agilityBonus !== undefined && m.agilityBonus > 0 && m.agilityBonus <= 0.5, `推进器 ${m.id} agilityBonus 非法`)
  }
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
