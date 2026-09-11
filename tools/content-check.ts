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
  FOE_SHIPS,
  RARITY_TIER,
  SKILLS,
  DRONE_ROLE_SPECS,
  DRONE_ROLE_ANCHORS,
  droneRoleIssues,
  droneRoleLadderIssues,
  droneTotalHp,
  HULL_CLASS_NAME,
  HULL_CLASS_BASE_SPEED,
  HULL_CLASS_MASS_RANGE,
  equivalentMassOf,
  buildItemCatalog,
  buildSimContext,
} from '@whale/data'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_BALANCE,
  ITEM_KIND_ORDER,
  MAX_SKILL_LEVEL,
  MODULE_SLOTS,
  typeLayerMult,
  REPAIR_PULSE_MS,
  DRONE_SKILL,
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
  lairLevelOf,
  lairNameOf,
  lairAnomalyOf,
  subDamageTypeOf,
  type DamageType,
  rareWreckItemIdOf,
  recycleTierOf,
  rackOf,
  wreckBaseDensity,
  foeLayerSplit,
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
/** 无人机四型定位契约的单发基准 = **锚点侦察机**单发（2026-09-10 船长拍板；
 * 专属强化机型不参与基准——见 data/droneRoles.ts 的 DRONE_ROLE_ANCHORS） */
const scoutDmg = drones.find((d) => d.id === DRONE_ROLE_ANCHORS.scout)?.dmg ?? 0
const DMG_TYPES = new Set(['kinetic', 'explosive', 'plasma'])

// 数量与目标规模（V10 设计确认；V16 矿带整合：矿石 10→7，总量 35→32；V18 口径取消：重弹并入通用弹 6→3；
// 2026-09-09 弹药 MK2：每族 +1 高级弹 → 弹药 6 种，物品总数 31→34；
// 2026-09-10 G 族专属无人机「流亡蜂无人机」→ 无人机 4→5 种、物品总数 34→35）
check(itemDefs.length === 35, `物品总数应为 35，实际 ${itemDefs.length}`)
check(ores.length === 7, `矿石应为 7 种，实际 ${ores.length}`)
check(minerals.length === 8, `矿物应为 8 种，实际 ${minerals.length}`)
check(gases.length === 4, `气体应为 4 种，实际 ${gases.length}`)
check(ices.length === 3, `冰矿应为 3 种，实际 ${ices.length}`)
check(ammos.length === 6, `弹药应为 6 种（每族基础弹 + MK2），实际 ${ammos.length}`)
check(drones.length === 5, `无人机应为 5 种（四型制式锚点 + 专属强化型），实际 ${drones.length}`)

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

// 每种物品必须有市场卡（防死物品）——**专属型号除外**（2026-09-10 船长：敌族窝点高级箱专属，
// 无蓝图、不上市场、不入常规掉落：渠道唯一由下方「来源唯一契约」正向断言）
for (const item of itemDefs) {
  const good = itemGoods.get(item.id)
  if (item.exclusive === true) {
    check(!good, `专属物品 ${item.id} 不得上市场（专属型号只能从窝点高级箱产出）`)
    continue
  }
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

/* ── 蓝图说明契约（2026-09-11 加，船长：「部分图纸的说明和实际产物属性对对不上，进行核查」）──
 * 背景：蓝图说明是玩家**买书时唯一能看到的产物介绍**；历史上多次调数值（炮台射程 −30%、
 * 舰船货舱调整…）之后说明没跟着改 → 玩家按说明买的图纸与实物不符（本次核出 2 处：
 * 「重型炮台 MK2」说明仍写 8.2 km 实际 5.74 km；「鲸王级舰船蓝图」说明仍写 10,000 m³ 实际 7,000 m³）。
 * 此处把**能从数据机械核对**的声明全部钉住；蓝图名与产物名的差异（「X 级舰船蓝图」vs「X 级护卫舰」）
 * 属命名习惯，只提示不拦。 */
{
  const modById = new Map(MODULES.map((m) => [m.id, m]))
  const shipById = new Map(SHIPS.map((s) => [s.id, s]))
  const goodsByBp = new Map(MARKET_GOODS.filter((g) => g.kind === 'blueprint').map((g) => [g.refId!, g]))
  const mineralNameOf = (id: string): string => items.get(id)?.name ?? id
  let claims = 0
  let nameHints = 0
  const num = (s: string): number => Number(s.replace(/,/g, ''))
  for (const bp of [...BLUEPRINTS, ...SHIP_BLUEPRINTS]) {
    const d = bp.description
    const out = bp.outputUnits ?? 1
    const mod = bp.moduleId ? modById.get(bp.moduleId) : undefined
    const item = bp.itemId ? items.get(bp.itemId) : undefined
    const ship = (bp as { shipId?: string }).shipId ? shipById.get((bp as { shipId?: string }).shipId!) : undefined
    const product = mod ?? item ?? ship
    if (!product) continue // 产物缺失已由上面的用例拦下
    const pName = product.name
    // ① 引号内的产物名
    for (const m of d.matchAll(/「([^」]+)」/g)) {
      claims += 1
      check(m[1] === pName, `蓝图说明契约：${bp.id} 说明写「${m[1]}」，实际产物名「${pName}」`)
    }
    // ② 每批产出（N 发/个/枚 … 批）
    for (const m of d.matchAll(/(\d+)\s*[发个枚]/g)) {
      if (!/批/.test(d.slice(m.index ?? 0, (m.index ?? 0) + 12))) continue
      claims += 1
      check(Number(m[1]) === out, `蓝图说明契约：${bp.id} 说明写每批 ${m[1]}，实际 outputUnits = ${out}`)
    }
    // ③ 射程（远程/射程 N km）
    for (const m of d.matchAll(/(?:远程|射程)[^0-9]{0,6}([\d.]+)\s*km/gi)) {
      if (mod?.maxRangeM === undefined) continue
      claims += 1
      check(
        Math.abs(Number(m[1]) - mod.maxRangeM / 1000) < 0.05,
        `蓝图说明契约：${bp.id} 说明写射程 ${m[1]} km，实际 maxRangeM = ${mod.maxRangeM} m`,
      )
    }
    // ④ 修理组件基础回复
    for (const m of d.matchAll(/基础\s*(\d+)\s*HP/gi)) {
      if (item?.repairRestore === undefined) continue
      claims += 1
      check(Number(m[1]) === item.repairRestore, `蓝图说明契约：${bp.id} 说明写基础 ${m[1]} HP，实际 repairRestore = ${item.repairRestore}`)
    }
    // ⑤ 弹药克制声明
    if (item?.damageType) {
      for (const [layer, word] of [['shield', '护盾'], ['armor', '装甲']] as const) {
        for (const m of d.matchAll(new RegExp(`对${word}\\s*×\\s*([\\d.]+)`, 'g'))) {
          claims += 1
          const real = typeLayerMult(item.damageType, layer)
          check(
            Math.abs(Number(m[1]) - real) < 0.01,
            `蓝图说明契约：${bp.id} 说明写对${word} ×${m[1]}，实际 ${item.damageType} 对${word} ×${real}`,
          )
        }
      }
    }
    // ⑥ 声望门槛
    for (const m of d.matchAll(/声望\s*(\d+)/g)) {
      const g = goodsByBp.get(bp.id)
      claims += 1
      check(
        g?.standingReq !== undefined && Number(m[1]) === g.standingReq,
        `蓝图说明契约：${bp.id} 说明写需声望 ${m[1]}，实际市场 standingReq = ${g?.standingReq ?? '（无市场卡）'}`,
      )
    }
    // ⑦ 舰船：货舱 / 循环秒 / 每循环产量
    if (ship) {
      for (const m of d.matchAll(/货舱\s*([\d,]+)\s*m³/g)) {
        claims += 1
        check(num(m[1]!) === ship.cargoM3, `蓝图说明契约：${bp.id} 说明写货舱 ${m[1]} m³，实际 cargoM3 = ${ship.cargoM3}`)
      }
      for (const m of d.matchAll(/循环\s*([\d.]+)\s*秒|([\d.]+)\s*秒\s*循环/g)) {
        claims += 1
        check(
          Math.abs(Number(m[1] ?? m[2]) - ship.cycleSeconds) < 0.01,
          `蓝图说明契约：${bp.id} 说明写循环 ${m[1] ?? m[2]} 秒，实际 cycleSeconds = ${ship.cycleSeconds}`,
        )
      }
      for (const m of d.matchAll(/产\s*([\d,]+)\s*单位/g)) {
        claims += 1
        check(
          num(m[1]!) === ship.oreUnitsPerCycle,
          `蓝图说明契约：${bp.id} 说明写产 ${m[1]} 单位，实际 oreUnitsPerCycle = ${ship.oreUnitsPerCycle}`,
        )
      }
    }
    // ⑧ 说明点名的矿物必须在材料里（矿石放宽：其精炼产物落在材料里即可，如「希莫非特矿带」→ 超噬矿）
    const mats = new Set(bp.materials.map((x) => x.itemId))
    const oreFeeds = (oreId: string): boolean => (items.get(oreId)?.refine ?? []).some((r) => mats.has(r.mineralId))
    for (const def of items.values()) {
      if (def.kind !== 'mineral' && def.kind !== 'ore') continue
      if (!def.name || def.name.length < 2 || !d.includes(def.name)) continue
      if (mats.has(def.id)) continue
      if (def.kind === 'ore' && oreFeeds(def.id)) continue
      claims += 1
      check(false, `蓝图说明契约：${bp.id} 说明点名了「${def.name}」，实际材料只有 ${[...mats].map(mineralNameOf).join(' + ')}`)
    }
    // ⑨ CPU 声明
    for (const m of d.matchAll(/CPU\s*(\d+)|(\d+)\s*点\s*CPU/g)) {
      const real = mod?.cpuUse ?? ship?.cpu
      if (real === undefined) continue
      claims += 1
      check(Number(m[1] ?? m[2]) === real, `蓝图说明契约：${bp.id} 说明写 CPU ${m[1] ?? m[2]}，实际 = ${real}`)
    }
    // ⑩ 蓝图名 vs 产物名：命名习惯差异只提示
    const base = bp.name.replace(/图纸$|蓝图$/, '').trim()
    if (!pName.includes(base.replace(/[（(].*?[)）]/g, '').trim())) nameHints += 1
  }
  console.log(`· 蓝图说明契约：核对 ${claims} 条数值声明（${BLUEPRINTS.length + SHIP_BLUEPRINTS.length} 张蓝图）；蓝图名与产物名不同写法 ${nameHints} 张（命名习惯，不拦）`)
}

/* ── 产物说明契约（2026-09-11 加，船长：「是，扩到全部产物说明」）──
 * 上一契约钉住的是**蓝图说明**；本契约覆盖**装备与物品自身的说明**——市场卡悬浮面板
 * （`MarketPage` 的 note 位）与物品/装备悬浮层读的就是这些 `description`，玩家据此判断要不要买。
 * 做法：把说明里的每个数值声明抽出来，要求它**能被该产物的真实数值解释**：
 *   ① 直接命中某字段（含 分数→百分数、毫秒→秒、米→千米 三种换算）；
 *   ② 引擎口径换算命中——装填 −N% 的「约合射速 +M%」= 1/(1−N)−1；抗性示例「25% 基础船 → M%」
 *      = N + 25%×(1−N)（`gapCombine` 缺口复合）；推进器「命中 ×M」= 1−失稳罚；姿态陀螺
 *      「敌命中 60% → M%」= 60%×(1−缺口削减)；无人机射程示例 = 机型基础射程 ×(1+加成)；
 *   ③ 语境常量（点火周期 60 秒、抗性上限 90%、必中 100%、弹种克制倍率、维修脉冲 5 秒…）；
 *   ④ 与说明里点到名的另一件装备做差（「比 X 还高五个点」「省下 12 点 CPU」）。
 * 另外单独钉住「无人机舱 +N m³ → 可多带几架」这类换算式：说明里的 N 架必须等于
 * 地板(舱位 ÷ 该机型体积)——这条是 2026-09-11 抓到「+15 m³ 却写约多带 2-5 架中型」的地方。
 * 解释不了的声明一律报错：既防"改了数值忘改说明"，也防"新写说明抄错数"。 */
{
  const numVal = (s: string): number => Number(s.replace(/,/g, ''))
  type Claim = { raw: string; value: number; kind: string }
  const claimsOf = (d: string): Claim[] => {
    const out: Claim[] = []
    for (const m of d.matchAll(/[+＋−-]?\s*([\d.]+)\s*%/g)) out.push({ raw: m[0].trim(), value: numVal(m[1]!), kind: 'pct' })
    for (const m of d.matchAll(/×\s*([\d.]+)/g)) out.push({ raw: m[0], value: numVal(m[1]!), kind: 'mul' })
    for (const m of d.matchAll(/([\d.]+)\s*km/g)) out.push({ raw: m[0], value: numVal(m[1]!), kind: 'km' })
    for (const m of d.matchAll(/([\d.]+)\s*m³/g)) out.push({ raw: m[0], value: numVal(m[1]!), kind: 'm3' })
    for (const m of d.matchAll(/([\d.]+)\s*m(?![³a-zA-Z])/g)) out.push({ raw: m[0], value: numVal(m[1]!), kind: 'm' })
    for (const m of d.matchAll(/([\d.]+)\s*秒/g)) out.push({ raw: m[0], value: numVal(m[1]!), kind: 'sec' })
    for (const m of d.matchAll(/([\d.]+)\s*点/g)) out.push({ raw: m[0], value: numVal(m[1]!), kind: 'pt' })
    for (const m of d.matchAll(/(?:CPU|处理器)[^0-9]{0,6}([\d.]+)/g)) out.push({ raw: m[0], value: numVal(m[1]!), kind: 'cpu' })
    for (const m of d.matchAll(/([\d.]+)\s*(?:点\s*)?CPU/g)) out.push({ raw: m[0], value: numVal(m[1]!), kind: 'cpu' })
    return out
  }
  const flatNums = (o: unknown, prefix = '', out: Array<[string, number]> = []): Array<[string, number]> => {
    if (o === null || o === undefined) return out
    if (typeof o === 'number') {
      out.push([prefix, o])
      return out
    }
    if (typeof o === 'string' || typeof o === 'boolean') return out
    if (Array.isArray(o)) {
      o.forEach((v, i) => flatNums(v, `${prefix}[${i}]`, out))
      return out
    }
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (['description', 'name', 'id', 'flavor'].includes(k)) continue
      flatNums(v, prefix ? `${prefix}.${k}` : k, out)
    }
    return out
  }
  const droneVolumes = drones.map((d) => d.unitM3).filter((v): v is number => typeof v === 'number')
  const droneRanges = drones.map((d) => d.maxRangeM).filter((v): v is number => typeof v === 'number')
  // 语境常量（引擎现行口径；改了这里就等于承认说明可以滞后，故集中在此处便于复核）
  const ctxConst: Array<[string, number]> = [
    ['点火周期 60 秒', 60],
    ['抗性上限', 90],
    ['必中', 100],
    ['示例基础抗/基础船', 25],
    ['维修脉冲', REPAIR_PULSE_MS / 1000],
    ['动能对护盾', typeLayerMult('kinetic', 'shield')],
    ['动能对装甲', typeLayerMult('kinetic', 'armor')],
    ['爆破对装甲', typeLayerMult('explosive', 'armor')],
    ['爆破对护盾', typeLayerMult('explosive', 'shield')],
    ['能量对护盾', typeLayerMult('plasma', 'shield')],
    ['能量对装甲', typeLayerMult('plasma', 'armor')],
  ]
  let total = 0
  let unexplained = 0
  let countHints = 0
  const scan = (kindLabel: string, def: { id: string; name: string; description?: string }): void => {
    const d = def.description ?? ''
    if (!d) return
    const claims = claimsOf(d)
    if (claims.length === 0) return
    const self = flatNums(def)
    // ④ 说明里点到名的另一件装备：其数值与差值也算"可解释"
    const refs = MODULES.filter((o) => o.id !== def.id && d.includes(o.name))
    const cross = refs.flatMap((o) => flatNums(o).map(([, v]) => v))
    const crossDiff = refs.flatMap((o) => flatNums(o).flatMap(([, v]) => self.map(([, sv]) => Math.abs(v - sv))))
    for (const c of claims) {
      total += 1
      const cand = new Set<number>()
      for (const [, v] of self) {
        cand.add(v)
        cand.add(v * 100)
        cand.add(Math.round(v * 100))
        cand.add(v / 1000) // 毫秒→秒 / 米→千米
        cand.add(1 - v) // 命中 ×(1−罚)
        cand.add(60 * (1 - v)) // 姿态陀螺：敌命中 60% → M%
        cand.add(v + 0.25 * (1 - v)) // 抗性示例：25% 基础船 → M%（取整后比对）
        cand.add((v + 0.25 * (1 - v)) * 100)
        cand.add((1 / (1 - v) - 1) * 100) // 装填 −N% 的「约合射速 +M%」
        for (const dv of droneRanges) cand.add(dv * (1 + v)) // 无人机射程示例
      }
      for (const v of cross) {
        cand.add(v)
        cand.add(v * 100)
        cand.add(Math.round(v * 100))
      }
      for (const v of crossDiff) {
        cand.add(v)
        cand.add(v * 100)
      }
      for (const [, v] of ctxConst) {
        cand.add(v)
        cand.add(v * 100)
      }
      const hit = [...cand].some((x) => Math.abs(x - c.value) < 0.051 || Math.abs(Math.round(x) - c.value) < 0.51)
      if (!hit) {
        unexplained += 1
        check(false, `产物说明契约：${kindLabel} ${def.id} 说明里的「${c.raw}」无法由真实数值解释——说明与实际属性对不上，或说明写了凭空的数`)
      }
    }
    // 「无人机舱 +N m³ → 可多带 N 架」换算式：N 必须等于**某个机型**的地板(舱位 ÷ 该机型体积)
    for (const m of d.matchAll(/([\d.]+)(?:\s*[-–~]\s*([\d.]+))?\s*架/g)) {
      const lo = numVal(m[1]!)
      const hi = m[2] ? numVal(m[2]) : lo
      if (!/无人机舱|机库/.test(d)) continue
      countHints += 1
      const bay = self.find(([k]) => k.includes('droneBay'))?.[1] ?? 0
      const caps = drones.map((x) => Math.floor(bay / (x.unitM3 ?? 1)))
      const okCount = caps.includes(lo) && caps.includes(hi)
      check(
        okCount,
        `产物说明契约：${kindLabel} ${def.id} 说明写「${m[0]}」，但按无人机舱位换算不成立（实际可多带 ${drones.map((x, i) => `${x.name} ${caps[i]} 架`).join(' / ')}）`,
      )
    }
    // ⑤ 说明点名的弹种/组件必须与实际接线一致（文字与字段"对不上"的另一半：不是数字错、是名字错）
    const mod = def as { repairKit?: string; damageTypeBonusPct?: Record<string, number> } & Record<string, unknown>
    if (mod.repairKit) {
      const kitName = items.get(mod.repairKit)?.name ?? mod.repairKit
      check(d.includes(kitName), `产物说明契约：装备 ${def.id} 说明没点到实际消耗的修理组件「${kitName}」（接线 ${mod.repairKit}）`)
    }
    const typeWords: Array<[string, DamageType]> = [
      ['动能', 'kinetic'],
      ['高爆', 'explosive'],
      ['爆炸', 'explosive'],
      ['爆破', 'explosive'],
      ['等离子', 'plasma'],
      ['能量', 'plasma'],
    ]
    const mapFields = ['damageTypeBonusPct', 'shieldResistAdd', 'armorResistAdd', 'hullResistAdd'] as const
    for (const f of mapFields) {
      const keys = Object.keys((mod[f] as Record<string, number> | undefined) ?? {})
      if (keys.length !== 1) continue
      // 只看**首句**（抗性/伤害声明的正位）：后文常顺带提其它弹种（如「动能是协会最常用弹种」），
      // 全句扫描会把正误两种写法都算成"提了两系"从而漏判。
      const headline = d.split('。')[0] ?? d
      const mentioned = new Set(typeWords.filter(([w]) => headline.includes(w)).map(([, t]) => t))
      if (mentioned.size === 1) {
        const wordOf: Record<string, string> = { kinetic: '动能', explosive: '高爆', plasma: '能量' }
        check(
          mentioned.has(keys[0] as DamageType),
          `产物说明契约：装备 ${def.id} 说明写的是「${wordOf[[...mentioned][0]!] ?? [...mentioned][0]}」系，实际字段 ${f} 挂在「${wordOf[keys[0]!] ?? keys[0]}」上`,
        )
      }
    }
  }
  for (const m of MODULES) scan('装备', m)
  for (const i of ITEMS) scan('物品', i)
  console.log(`· 产物说明契约：核对 ${total} 条数值声明（装备 ${MODULES.length} 件 + 物品 ${ITEMS.length} 种），其中舱位换算 ${countHints} 处；无法解释 ${unexplained} 条`)
}

/* ── 技能说明契约（2026-09-11 加，船长：「另开一批做技能说明 ↔ 引擎效果核查」）──
 * 背景：技能说明里每个数值都用 ⟦⟧ 标出（内容工作台口径：改 ⟦⟧ 需与引擎接线一致），
 * 但过去**没有任何自动检查**——改引擎数值忘改说明、或技能压根没接线，都只有玩家能发现。
 * 本契约把三处来源钉在一起（**引擎为准**）：
 *   ① **平衡表**：凡 `xxxSkillId/skillIds/familySkillIds` 与同层 `xxxPerLevel` 成对出现的地方，
 *      技能说明必须写出该每级值（含满级 = 每级 × 5）——如 mining.yieldPerLevel 0.06 ↔「每级 +6%」；
 *   ② **引擎导出的技能参数对象**：`DRONE_SKILL`（无人机六技能的每级值 + 回收基础/上限）；
 *   ③ **引擎内联常量表**（下方 `INLINE`）：数值写在各模块函数里（`1 - 0.04 * lv` 之类），
 *      逐条登记 `技能 id → 每级值 → 接线位置`；`wired: false` 表示**说明承诺了、但引擎里查无接线**
 *      （只警告不拦，与蓝图命名差异同口径）——2026-09-11 核查时唯一命中 = `cartography` 星图测绘学。
 * 另加**反向断言**：说明里带 ⟦⟧ 数值的技能必须能在上述三处之一登记，防新技能悄悄写一组没人负责的数。 */
{
  type Pair = { skill: string; per: number; from: string }
  const pairs: Pair[] = []
  const isSkillKey = (k: string): boolean => /skill/i.test(k)
  /** 键名去掉尾部 SkillId(s)/PerLevel 后的「语义前缀」，用于把技能名与每级值配到一起 */
  const prefixOf = (k: string): string => k.replace(/skill[a-z]*ids?$/i, '').replace(/perlevel$/i, '').toLowerCase()
  const related = (a: string, b: string): boolean =>
    a === b || a === '' || b === '' || a.startsWith(b) || b.startsWith(a)
  const collect = (o: unknown, path: string): void => {
    if (!o || typeof o !== 'object') return
    if (Array.isArray(o)) {
      o.forEach((v, i) => collect(v, `${path}[${i}]`))
      return
    }
    const obj = o as Record<string, unknown>
    const ids: Array<{ id: string; prefix: string }> = []
    const pers: Array<{ per: number; prefix: string }> = []
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && isSkillKey(k)) ids.push({ id: v, prefix: prefixOf(k) })
      else if (typeof v === 'number' && /per\s*level/i.test(k)) pers.push({ per: v, prefix: prefixOf(k) })
      else if (Array.isArray(v) && isSkillKey(k)) {
        for (const x of v) if (typeof x === 'string') ids.push({ id: x, prefix: prefixOf(k) })
      } else if (v && typeof v === 'object' && isSkillKey(k)) {
        for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
          // industrySkillSlots: { '技能 id': 每级工位数 }——记录本身就是"技能 → 每级值"的成对表
          if (typeof v2 === 'number') pairs.push({ skill: k2, per: v2, from: `${path}.${k}` })
          // familySkillIds: { 武器族: '技能 id' }——与同层 familySkillPerLevel 配对
          else if (typeof v2 === 'string' && !isSkillKey(k2)) ids.push({ id: v2, prefix: prefixOf(k) })
        }
      }
    }
    for (const i of ids) for (const p of pers) if (related(i.prefix, p.prefix)) pairs.push({ skill: i.id, per: p.per, from: `${path}（${i.prefix || '技能'} ↔ ${p.prefix}）` })
    for (const [k, v] of Object.entries(obj)) if (v && typeof v === 'object') collect(v, path ? `${path}.${k}` : k)
  }
  collect(DEFAULT_BALANCE, 'balance')
  // ② 引擎导出的无人机技能参数
  pairs.push(
    { skill: 'drone-warfare', per: DRONE_SKILL.warfarePerLevel, from: 'combat.DRONE_SKILL.warfarePerLevel' },
    { skill: 'drone-strike', per: DRONE_SKILL.strikePerLevel, from: 'combat.DRONE_SKILL.strikePerLevel' },
    { skill: 'drone-durability', per: DRONE_SKILL.durabilityPerLevel, from: 'combat.DRONE_SKILL.durabilityPerLevel' },
    { skill: 'drone-reinforce', per: DRONE_SKILL.reinforcePerLevel, from: 'combat.DRONE_SKILL.reinforcePerLevel' },
    { skill: 'drone-evasion', per: DRONE_SKILL.evasionPerLevel, from: 'combat.DRONE_SKILL.evasionPerLevel' },
    { skill: 'drone-recovery', per: DRONE_SKILL.recoveryPerLevel, from: 'combat.DRONE_SKILL.recoveryPerLevel' },
  )
  // ③ 引擎内联常量（2026-09-11 逐条按现场代码登记；wired:false = 说明承诺但引擎无接线）
  const INLINE: Array<{ skill: string; per: number | null; call: string | null; note?: string }> = [
    { skill: 'spaceship-command', per: 0.02, call: 'travel.ts travelTimeFactor' },
    { skill: 'mining-frigate', per: 0.03, call: 'balance.mining.timePerLevel' },
    { skill: 'industrial-ops', per: 0.04, call: 'mining.ts（industrial 族产量）' },
    { skill: 'armed-ops', per: 0.03, call: 'combat.ts（armed 族单发）' },
    { skill: 'armored-ops', per: 0.04, call: 'combat.ts（armored 族甲/结构容量）' },
    { skill: 'astro-geology', per: 0.04, call: 'mining.ts（全矿产量）' },
    { skill: 'deep-hole-blasting', per: 0.06, call: 'mining.ts（低品位矿 ≤55 ISK）' },
    { skill: 'deep-space-harvesting', per: 0.05, call: 'mining.ts（气/冰）' },
    { skill: 'rich-vein-prospecting', per: 0.2, call: 'mining.ts richVeinFactor' },
    { skill: 'core-smelting', per: 0.04, call: 'industry.ts（主控手动炉周期）' },
    { skill: 'furnace-expansion', per: 0.06, call: 'industry.ts（主控手动炉批容）' },
    { skill: 'batch-production', per: 0.03, call: 'manufacturing.ts calcBuildDurationMs' },
    { skill: 'materials', per: 0.015, call: 'manufacturing.ts materialFactor' },
    { skill: 'industrial-automation', per: 0.05, call: 'industry.ts / manufacturing.ts（炉线与制造线周期）' },
    { skill: 'ai-expert', per: 1, call: 'ai.ts aiCoreCap（每级 +1 枚核心上限）' },
    { skill: 'navigation', per: 0.04, call: 'balance.travel.skillIds/cutPerLevel' },
    { skill: 'warp-drive-operation', per: 0.04, call: 'balance.travel.skillIds/cutPerLevel' },
    { skill: 'acceleration-control', per: 0.04, call: 'balance.travel.skillIds/cutPerLevel' },
    { skill: 'component-standardization', per: 0.008, call: 'manufacturing.ts materialFactor' },
    { skill: 'ai-servicing', per: 0.03, call: 'ai.ts（副船采矿循环）' },
    { skill: 'offline-ops', per: 0.2, call: 'simulation.ts simulateOffline（基础 8 小时）' },
    { skill: 'station-engineering', per: 0.08, call: 'station.ts engFactor' },
    { skill: 'salvage-recycling', per: 0.04, call: 'industry.ts（回收炉周期）' },
    { skill: 'salvage-rigging', per: 0.03, call: 'salvaging.ts（打捞器周期）' },
    { skill: 'wreck-assaying', per: 0.2, call: 'salvaging.ts assayChanceOf（×1.2/级）' },
    { skill: 'salvage-refining', per: 0.08, call: 'salvage.ts（保底矿物）' },
    { skill: 'energy-management', per: 0.03, call: 'combat.ts（激光单发）' },
    { skill: 'gunnery', per: 0.05, call: 'balance.battle.gunneryDmgPerLevel（跨节点配对）' },
    { skill: 'fire-control', per: 0.03, call: 'combat.ts（炮台/导弹命中）' },
    { skill: 'reload-drills', per: 0.04, call: 'combat.ts（装填）' },
    { skill: 'ammunition-condensing', per: 0.08, call: 'combat.ts（出发预载弹药）' },
    { skill: 'drone-servicing', per: 0.04, call: 'combat.ts（无人机装填）' },
    { skill: 'shield-operation', per: 0.04, call: 'combat.ts（护盾容量）' },
    { skill: 'hull-upgrades', per: 0.04, call: 'combat.ts（甲/结构容量）' },
    { skill: 'shield-tuning', per: 0.02, call: 'combat.ts tune（护盾三系抗）' },
    { skill: 'armor-tuning', per: 0.02, call: 'combat.ts tune（装甲三系抗）' },
    { skill: 'repair-engineering', per: 0.1, call: 'shipyard.ts（停站维修费）' },
    { skill: 'station-protocol', per: 0.05, call: 'shipyard.ts（停站维修费）' },
    { skill: 'hull-quick-repair', per: 0.1, call: 'shipyard.ts（停站修理组件恢复量）' },
    { skill: 'ai-core-dispatch', per: 0.02, call: 'balance.aiCore.dispatchPerLevel（百分点）' },
    { skill: 'accelerated-learning', per: 0.04, call: 'training.ts trainingTimeFactor' },
    { skill: 'marketing', per: 0.012, call: 'market.ts marketSellSkillMult' },
    { skill: 'source-sweeping', per: 0.1, call: 'market.ts SWEEP_PER_LEVEL（×1.1/级）', srcNear: false },
    { skill: 'secondhand-market', per: 0.02, call: 'market.ts SECONDHAND_PER_LEVEL', srcNear: false },
    { skill: 'galactic-happenings', per: 0.08, call: 'events.ts eventCadenceFactor + expedition.ts（×1.15/级）' },
    { skill: 'event-dividend', per: 0.15, call: 'events.ts（事件现金）' },
    { skill: 'signal-analysis', per: 0.08, call: 'explore.ts scanSkillFactor' },
    { skill: 'signal-filtering', per: 0.06, call: 'explore.ts scanSkillFactor' },
    { skill: 'salvage-diving', per: 0.12, call: 'expedition.ts lootFactor + salvaging.ts' },
    { skill: 'seizure-appraisal', per: 0.1, call: 'encounters.ts（缴获）' },
    { skill: 'lowsec-survival', per: 0.12, call: 'encounters.ts（被抢上限）' },
    { skill: 'deep-space-logistics', per: 0.04, call: 'inventory.ts（货仓容量）' },
    { skill: 'hauler-ops', per: 0.05, call: 'inventory.ts（hauler 族货仓）' },
    { skill: 'compression', per: 0.06, call: 'inventory.ts（矿/气/冰体积）' },
    { skill: 'hold-management', per: 0.03, call: 'inventory.ts（货仓容量）' },
    { skill: 'bounty-hunting', per: 0.08, call: 'expedition.ts bountyRewardFactor' },
    { skill: 'cartography', per: 0.06, call: 'explore.ts scanSkillFactor（2026-09-11 船长裁决「乙」接活到就地扫描窗口）' },
  ]
  const skillById = new Map(SKILLS.map((s) => [s.id, s]))
  const claimsOfSkill = (d: string): number[] => [...d.matchAll(/⟦([\d.]+)/g)].map((m) => Number(m[1]))
  let checked = 0
  let srcChecked = 0
  const unwired: string[] = []
  const registered = new Set<string>()
  /** 内联常量的**现场复核**：登记表里的每级值必须仍出现在该技能的读取点附近
   * （说明↔表 只能防"改说明忘改数"，这一步才防"改引擎数忘改说明"）。
   * `srcNear: false` 的条目 = 数值写在文件级常量里（读取点附近看不到），只做表 ↔ 说明 核对。 */
  const root = process.cwd()
  const srcCache = new Map<string, string>()
  const sourceOf = (call: string): string | null => {
    const m = call.match(/([a-z0-9-]+\.tsx?)/i)
    return m ? `packages/core/src/${m[1]}` : null
  }
  const nearCheck = (item: { skill: string; per: number | null; call: string | null; srcNear?: boolean }): void => {
    if (item.per === null || !item.call || item.srcNear === false) return
    const rel = sourceOf(item.call)
    if (!rel) return
    let text = srcCache.get(rel)
    if (text === undefined) {
      try {
        text = readFileSync(join(root, rel), 'utf8')
      } catch {
        return
      }
      srcCache.set(rel, text)
    }
    const needle = `'${item.skill}'`
    if (!text.includes(needle)) return // 该技能不是在本文件用 id 字面量读取的（如经 balance 表间接引用）——跳过现场复核
    srcChecked += 1
    let seen = 0
    let at = text.indexOf(needle)
    while (at >= 0) {
      seen += 1
      const win = text.slice(Math.max(0, at - 400), at + 400)
      // 线性 +N%/级 与乘算式 ×(1+N)/级 两种写法都认
      if (win.includes(String(item.per)) || win.includes(String(Number((1 + item.per).toFixed(4))))) return
      at = text.indexOf(needle, at + 1)
    }
    check(
      seen === 0,
      `技能说明契约：${item.skill} 的每级值 ${item.per} 在 ${rel} 的读取点附近已找不到——引擎改了数值（请同步技能说明，并按新值更新本契约登记表）`,
    )
  }
  const verify = (p: Pair): void => {
    const def = skillById.get(p.skill)
    if (!def) {
      check(false, `技能说明契约：${p.from} 指向的技能 ${p.skill} 不在技能目录中`)
      return
    }
    registered.add(p.skill)
    const claims = claimsOfSkill(def.description)
    if (claims.length === 0) return
    checked += 1
    // 每级值本身，或它的 1~5 倍（满级/阶段值），或"乘算式"×1.1/×1.2 系的 1+每级值
    const allowed = new Set<number>()
    for (const lv of [1, 2, 3, 4, 5]) {
      allowed.add(Number((p.per * 100 * lv).toFixed(4)))
      allowed.add(Number((p.per * lv).toFixed(4)))
      allowed.add(Number((1 + p.per * lv).toFixed(4)))
    }
    const hit = claims.some((c) => [...allowed].some((a) => Math.abs(a - c) < 0.051))
    check(hit, `技能说明契约：技能「${def.name}」(${p.skill}) 说明写的是 ⟦${claims.join('% / ')}⟧，而 ${p.from} 是每级 ${p.per}——说明与引擎对不上`)
  }
  for (const p of pairs) verify(p)
  for (const item of INLINE) {
    registered.add(item.skill)
    const def = skillById.get(item.skill)
    if (!def) {
      check(false, `技能说明契约：内联表里的 ${item.skill} 不在技能目录中`)
      continue
    }
    if (!item.call) {
      unwired.push(`${def.name}（${item.skill}）：${item.note ?? '说明承诺了效果，但引擎里查无接线'}`)
      continue
    }
    if (item.per === null) continue
    verify({ skill: item.skill, per: item.per, from: `内联表 · ${item.call}` })
    nearCheck(item)
  }
  // 反向断言：说明里带 ⟦⟧ 的技能必须登记（防新技能悄悄写数）
  for (const s of SKILLS) {
    if (claimsOfSkill(s.description).length > 0 && !registered.has(s.id)) {
      check(false, `技能说明契约：技能「${s.name}」(${s.id}) 说明里有 ⟦数值⟧ 却没在契约里登记来源（引擎为准：补登记或删掉说明里的数）`)
    }
  }
  for (const u of unwired) warn.push(`技能说明契约：${u}`)
  console.log(
    `· 技能说明契约：${registered.size} 个技能登记来源（平衡表 ${pairs.length} 条 + 引擎参数对象 6 条 + 内联表 ${INLINE.length} 条），核对 ${checked} 个技能的每级值、其中 ${srcChecked} 条做了引擎现场复核；未接线 ${unwired.length} 个`,
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
  // 专属强化型（exclusive）由船长裁决豁免区间校验，只受硬边界约束（会打印在下面的清单里）
  for (const issue of droneRoleIssues(d, scoutDmg)) errors.push(issue)
}
{
  // 跨四类阶梯（闪避严格递减 / 血量与单发阶梯 / 哨戒血量与侦察机相仿）——**只比锚点机型**
  const ladderIssues = droneRoleLadderIssues(drones as never)
  for (const issue of ladderIssues) errors.push(`无人机定位契约：${issue}`)
  if (drones.length > 0) {
    const base = drones.find((d) => d.id === DRONE_ROLE_ANCHORS.scout)
    console.log(
      `· 无人机四型定位：${drones
        .map((d) => {
          const cls = d.droneClass ?? '?'
          const tag = d.exclusive === true ? '专属' : DRONE_ROLE_SPECS[cls as keyof typeof DRONE_ROLE_SPECS]?.label ?? cls
          return `${tag} 闪避 ${d.defense?.evasion ?? '—'}·血 ${droneTotalHp(d)}·单发 ${d.dmg ?? 0}`
        })
        .join('　')}（单发基准 = 锚点侦察机 ${base?.name ?? '—'} ${scoutDmg}）`,
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
  if (m.slot === 'drone-relay') {
    // 2026-09-10 无人机中继天线：百分比射程加成（值域 (0, 2]，多件线性求和乘入机型射程）
    check(
      (m.droneRangeBonusPct ?? 0) > 0 && (m.droneRangeBonusPct ?? 0) <= 2,
      `无人机中继天线 ${m.id} droneRangeBonusPct 非法（需 (0, 2]）`,
    )
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

/* ── 敌方混伤契约（2026-09-10 船长定）──
 * ①**除教学卡与纯能量卡外**每张敌军卡必须写**两系** `dmgMix`（主 8 : 副 2 = 80%/20%）——
 *   教学卡（演习场讨伐令）保持纯系：不给新手第一场上混伤；
 *   纯能量卡（2026-09-10 船长：**深渊之门卫队改为纯能量伤害**）允许只写一系 `plasma`，
 *   但**必须同时显式给 `foeFalloff`**（能量走 `beamPowerFactor` 威力衰减，纯能量卡的火力只能靠它收住）；
 * ②副系必须 = 该敌族签名副系序里第一个"不与主系相同"的系（`lairs.subDamageTypeOf`）；
 * ③窝点派生卡（`lairAnomalyOf`）= 同一主系 + **6:4**（60%/40%）；主系**不许变**。 */
{
  const TEACHING_CARD = 'ano-training'
  let mixed = 0
  let pureBeam = 0
  const positive = (mix: Partial<Record<string, number>> | undefined): Array<[string, number]> =>
    Object.entries(mix ?? {}).filter(([, v]) => typeof v === 'number' && v > 0) as Array<[string, number]>
  for (const def of ANOMALIES_FLAVORED) {
    if (def.id === TEACHING_CARD) {
      check(positive(def.dmgMix).length <= 1, `混伤契约：教学卡 ${def.id} 应保持纯系（不写两系 dmgMix）`)
      continue
    }
    const rows = positive(def.dmgMix)
    // 纯能量特例（2026-09-10 船长）：单系 plasma 合法，但必须显式给远端威力衰减
    if (rows.length === 1 && rows[0]![0] === 'plasma') {
      check(
        def.foeFalloff !== undefined,
        `混伤契约：纯能量卡 ${def.name} 必须显式给 foeFalloff（远端威力衰减，缺省 0.30 太轻）`,
      )
      pureBeam += 1
      continue
    }
    check(rows.length === 2, `混伤契约：${def.name} 应写两系 dmgMix（主 8 : 副 2），实际 ${rows.length} 系`)
    if (rows.length !== 2) continue
    const sorted = [...rows].sort((a, b) => b[1] - a[1])
    check(sorted[0]![1] === 8 && sorted[1]![1] === 2, `混伤契约：${def.name} 权重应为主 8 : 副 2，实际 ${sorted[0]![1]}:${sorted[1]![1]}`)
    const main = sorted[0]![0] as DamageType
    const sub = sorted[1]![0] as DamageType
    check(
      sub === subDamageTypeOf(def, main),
      `混伤契约：${def.name} 副系 ${sub} 与族签名序列不符（应为 ${subDamageTypeOf(def, main)}）`,
    )
    // 窝点派生：同主系 + 6:4
    const lair = lairAnomalyOf(def, 3)
    const lRows = positive(lair.dmgMix)
    const lSorted = [...lRows].sort((a, b) => b[1] - a[1])
    check(
      lRows.length === 2 && lSorted[0]![1] === 6 && lSorted[1]![1] === 4 && (lSorted[0]![0] as DamageType) === main,
      `混伤契约：${def.name} 窝点派生应为同一主系 ${main} + 副系 6:4，实际 ${JSON.stringify(lair.dmgMix)}`,
    )
    mixed += 1
  }
  console.log(
    `· 敌方混伤契约：${mixed} 张敌军卡主 8 : 副 2（窝点派生 6:4、主系不变）；教学卡保持纯系` +
      `${pureBeam > 0 ? `；纯能量卡 ${pureBeam} 张（单系 plasma + 显式 foeFalloff）` : ''}`,
  )

  /* ── 敌速口径契约（2026-09-10 加）──
   * 船长 2026-09-10 裁决「采取固定锚定，参考按照速度中位线的船只进行参考」：
   *   基准船 = 船池按 maxSpeedMps 排序取中位（长尾鲨级 272 / 敏捷 0.54）
   *   基准战斗机动 = 船速 × speedFactor ×(1+(敏捷−0.5)×2×agilitySpeedBonus) ≈ 165.2 m/s
   *   比率 = 敌战斗机动 ÷ 基准战斗机动，其中敌战斗机动 = foeSpeedMps × speedFactor × 0.94（敌敏捷固定 0.3）
   * 契约：① 每张敌军卡必须**逐卡显式**写 foeSpeedMps（防止新增卡悄悄回落到段参考船旧公式口径）；
   *       ② 比率必须落在该战术口径带内（brawl 1.05~1.55 / orbit 0.90~1.25 / kite 0.60~0.85）。 */
  {
    const bal = DEFAULT_BALANCE.battle
    const agiMul = (ag: number): number => bal.speedFactor * (1 + (ag - 0.5) * 2 * bal.agilitySpeedBonus)
    const sortedShips = [...SHIPS].sort((a, b) => (a.maxSpeedMps ?? 0) - (b.maxSpeedMps ?? 0))
    const refShip = sortedShips[Math.floor(sortedShips.length / 2)]!
    const refCombat = (refShip.maxSpeedMps ?? 0) * agiMul(refShip.agility ?? 0.5)
    const foeAgi = agiMul(0.3)
    const SPEED_BAND: Record<string, readonly [number, number]> = {
      brawl: [1.05, 1.55],
      orbit: [0.9, 1.25],
      kite: [0.6, 0.85],
    }
    let speedCounted = 0
    let speedShipPath = 0
    for (const def of ANOMALIES_FLAVORED) {
      // 舰级路径（2026-09-11）：速度由**舰级绝对值**决定，故不再要求逐卡 foeSpeedMps；
      // 改按"该卡实际会建出的单位速度"（非僚机编成条目）校验比率。
      const mains = (def.ships ?? []).filter((s) => s.escort !== true)
      if (mains.length > 0) {
        speedShipPath++
        for (const slot of mains) {
          const spd = Math.round(slot.ship.speedMps * (slot.speedMul ?? 1))
          const tactic = slot.tactic ?? slot.ship.tactic
          const band = SPEED_BAND[tactic] ?? SPEED_BAND.orbit!
          const ratio = (spd * foeAgi) / refCombat
          check(
            ratio >= band[0] && ratio <= band[1],
            `敌速口径契约：${def.name} 的舰级「${slot.ship.name}」（${tactic}）比率 ${ratio.toFixed(2)}× 越界（应 ${band[0]}~${band[1]}×；基准船 ${refShip.name} 战斗机动 ${refCombat.toFixed(1)} m/s）`,
          )
        }
        continue
      }
      const spd = def.foeSpeedMps
      check(
        spd !== undefined && spd > 0,
        `敌速口径契约：${def.name} 未显式声明 foeSpeedMps（2026-09-10 起全卡逐卡标定，见设计稿 enemy-speed-retune-20260910.md；舰级路径卡改为引用舰级速度）`,
      )
      if (spd === undefined) continue
      speedCounted++
      const tactic = def.tactic ?? 'orbit'
      const band = SPEED_BAND[tactic] ?? SPEED_BAND.orbit!
      const ratio = (spd * foeAgi) / refCombat
      check(
        ratio >= band[0] && ratio <= band[1],
        `敌速口径契约：${def.name}（${tactic}）比率 ${ratio.toFixed(2)}× 越界（应 ${band[0]}~${band[1]}×；基准船 ${refShip.name} 战斗机动 ${refCombat.toFixed(1)} m/s）`,
      )
    }
    console.log(
      `· 敌速口径契约：${speedCounted} 张逐卡显式标定 + ${speedShipPath} 张引用舰级速度，比率均在战术带内（基准船 ${refShip.name} 战斗机动 ${refCombat.toFixed(1)} m/s）`,
    )
  }

  /* ── 舰级契约（2026-09-11 加，船长定案「敌舰配置表 + 卡上修正 + 允许混编」）──
   * ① **引用有效**：卡上每个编成条目的舰级必须登记在 `FOE_SHIPS` 表内（禁止内联随手造舰级）；
   * ② **族一致**：舰级 `family` 必须等于卡的 `foeFamily`；
   * ③ **声明一致**：卡面 `tactic` / `defProfile` / `dmgMix` 必须与"实际会建出的主体单位"一致
   *    （舰级路径下这三项是**卡面口径**，与舰级定义重复，故用契约锁死，防两边漂移）；
   * ④ **编成合法**：至少一条非僚机条目（要有主体）。 */
  {
    const known = new Set(FOE_SHIPS.map((s) => s.id))
    const normMix = (m?: Partial<Record<string, number>>): string =>
      Object.entries(m ?? {})
        .filter(([, w]) => (w ?? 0) > 0)
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([k, w]) => `${k}:${w}`)
        .join(',')
    let shipCards = 0
    let slotTotal = 0
    let mixed = 0
    for (const def of ANOMALIES_FLAVORED) {
      const ships = def.ships
      if (!ships || ships.length === 0) continue
      shipCards++
      slotTotal += ships.length
      if (new Set(ships.map((x) => x.ship.id)).size > 1) mixed++
      for (const slot of ships) {
        check(
          known.has(slot.ship.id),
          `舰级契约：${def.name} 引用了未登记的舰级 ${slot.ship.id}（须登记在 packages/data/src/foe-ships.ts）`,
        )
        if (def.foeFamily) {
          check(
            slot.ship.family === def.foeFamily,
            `舰级契约：${def.name}（族 ${def.foeFamily}）引用了族 ${slot.ship.family} 的舰级「${slot.ship.name}」`,
          )
        }
      }
      const mains = ships.filter((x) => x.escort !== true)
      check(mains.length >= 1, `舰级契约：${def.name} 没有任何非僚机编成条目（至少需要一艘主体）`)
      const prime = mains[0]
      if (prime && def.tactic) {
        // 卡面战术是"这一场怎么打"的摘要；混编允许各主体用不同战术（如狙击头目 + 贴脸杂鱼），
        // 故契约只要求**卡面战术落在主体们的有效战术集合内**（有效 = 卡上覆写优先，2026-09-11 头目多战术）。
        const effTactics = new Set(mains.map((m) => m.tactic ?? m.ship.tactic))
        check(
          effTactics.has(def.tactic),
          `舰级契约：${def.name} 卡面战术 ${def.tactic} 不在主体编成的有效战术集合内 [${[...effTactics].join(' / ')}]`,
        )
      }
      if (prime && def.defProfile) {
        const want = foeLayerSplit(def.defProfile)
        const got = prime.ship.split
        check(
          Math.abs(want.s - got.s) < 1e-9 && Math.abs(want.a - got.a) < 1e-9 && Math.abs(want.h - got.h) < 1e-9,
          `舰级契约：${def.name} 卡面血型 ${def.defProfile}（${want.s}/${want.a}/${want.h}）与主体舰级「${prime.ship.name}」（${got.s}/${got.a}/${got.h}）不一致`,
        )
      }
      if (prime && def.dmgMix) {
        const eff = prime.dmgMix ?? prime.ship.dmgMix
        check(
          normMix(def.dmgMix) === normMix(eff),
          `舰级契约：${def.name} 卡面伤害构成（${normMix(def.dmgMix)}）与主体舰级有效构成（${normMix(eff)}）不一致`,
        )
      }
    }
    console.log(
      `· 舰级契约：${shipCards} 张舰级路径卡（${slotTotal} 条编成，其中混编 ${mixed} 张）引用有效、族与卡面口径一致`,
    )
  }

  /* ── 族→战术契约（2026-09-11 加）──
   * 船长 2026-09-11 定 A 族性格「**鱼龙混杂，所以应该各个战术的敌人都有**」→ A 族三种战术全合法。
   * 其余族正按字母顺序逐族商讨中，**只登记已裁定的族**，未登记 = 不校验（不预设、不猜）。 */
  {
    const FAMILY_TACTICS: Partial<Record<string, readonly string[]>> = {
      A: ['brawl', 'orbit', 'kite'], // 鱼龙混杂（船长 2026-09-11）
    }
    let checked = 0
    for (const def of ANOMALIES_FLAVORED) {
      const allow = def.foeFamily ? FAMILY_TACTICS[def.foeFamily] : undefined
      if (!allow) continue
      const tactics =
        def.ships && def.ships.length > 0
          ? def.ships.filter((x) => x.escort !== true).map((x) => x.tactic ?? x.ship.tactic)
          : [def.tactic ?? 'orbit']
      for (const t of tactics) {
        checked++
        check(
          allow.includes(t),
          `族→战术契约：${def.name}（族 ${def.foeFamily}）用了战术 ${t}，超出该族已裁定的允许范围 [${allow.join(' / ')}]`,
        )
      }
    }
    console.log(
      `· 族→战术契约：${checked} 处族内战术声明均在已裁定范围内（当前仅 A 族已裁定：鱼龙混杂，三种战术全允许）`,
    )
  }
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
      // 池内元素可以是模块或专属物品（2026-09-10 船长：G 族第一件 = 专属无人机"物品"）
      check(
        moduleIdSet.has(id) || lairCtx.items.has(id),
        `窝点契约：${def.name} 专属装备 ${id} 不存在（modules.ts / items.ts 均未登记）`,
      )
    }
  }
  for (const fam of famWithGear) {
    check(
      FOE_LAIR_GEAR[fam].length > 0,
      `窝点契约：敌族 ${fam} 有窝点成员但没配专属装备（FOE_LAIR_GEAR，每族至少一件）`,
    )
  }
  /* ── 窝点地图级别契约（2026-09-10 船长定：档位由地图级别硬封顶） ──
   * ①每张窝点候选卡必须**显式标级**（`lairLevel` 缺省 3 只是"漏标不误伤"，不是可省；
   *   忘了标级的地图会永远出全档，与"越低级的图越出不了高档位"直接冲突）；
   * ②每个有窝点成员的敌族**至少一张 3 级**（船长 2026-09-10 定）——否则该族在日板上永远打不到深层；
   * ③（提示，不拦）同族内"级别更高而奖金更低"属反常，多半是标反了。 */
  {
    const levelByFam = new Map<string, number[]>()
    for (const def of ANOMALIES_FLAVORED) {
      if (!isLairCandidate(def)) continue
      const fam = def.foeFamily ?? '?'
      const lv = def.lairLevel
      check(
        lv === 1 || lv === 2 || lv === 3,
        `窝点级别契约：${def.name} 未标 lairLevel（须显式写 1/2/3——1 = 只出外围、2 = 到核心、3 = 全档）`,
      )
      if (lv === 1 || lv === 2 || lv === 3) levelByFam.set(fam, [...(levelByFam.get(fam) ?? []), lv])
    }
    for (const [fam, levels] of levelByFam) {
      check(
        levels.includes(3),
        `窝点级别契约：敌族 ${fam} 没有任何 3 级地图（船长 2026-09-10 定：每族至少一张 3 级，否则该族永远出不了深层档）`,
      )
      const cards = [...ANOMALIES_FLAVORED].filter((d) => isLairCandidate(d) && d.foeFamily === fam)
      for (const lo of cards) {
        for (const hi of cards) {
          if (lairLevelOf(hi) > lairLevelOf(lo) && hi.rewardIsk < lo.rewardIsk) {
            warn.push(
              `窝点级别提示：${fam} 族「${hi.name}」（级别 ${lairLevelOf(hi)}）奖金低于「${lo.name}」（级别 ${lairLevelOf(lo)}）——请复核级别是否标反`,
            )
          }
        }
      }
    }
    const levelCount = { 1: 0, 2: 0, 3: 0 }
    let total = 0
    for (const levels of levelByFam.values()) {
      for (const l of levels) {
        levelCount[l as 1 | 2 | 3] += 1
        total += 1
      }
    }
    console.log(
      `· 窝点级别契约：${total} 张候选卡全数显式标级（L1×${levelCount[1]} / L2×${levelCount[2]} / L3×${levelCount[3]}），` +
        `${levelByFam.size} 个敌族各至少一张 3 级`,
    )
  }
  /* 专属装备的"来源唯一"契约（2026-09-10 加；2026-09-10 扩到专属**物品**）：
   * 这批东西**只能**从高级箱（稀有残骸额外掉落）出——不得有蓝图（造不出来）、
   * 不得有市场卡（买不到也卖不掉）、不得有碎片逆向配方、不得混进任何敌群的常规残骸主题池
   * （否则普通残骸就能刷出窝点专属，稀释窝点价值）。
   * 2026-09-10 船长：G 族第一件改为**无人机物品**（`item.exclusive`），同一套契约对它同样成立。 */
  {
    const lairGearIds = new Set<string>(Object.values(FOE_LAIR_GEAR).flat())
    const bpByModule = new Map<string, string>()
    for (const bp of BLUEPRINTS) if (bp.moduleId) bpByModule.set(bp.moduleId, bp.id)
    let marketCards = 0
    let itemGear = 0
    for (const id of lairGearIds) {
      const isModule = lairCtx.modules.has(id)
      const itemDef = lairCtx.items.get(id)
      check(
        isModule || itemDef !== undefined,
        `来源唯一契约：窝点专属 ${id} 既不是装备也不是物品（id 无法解析）`,
      )
      const kindText = isModule ? '装备' : '物品'
      if (!isModule) {
        if (itemDef) {
          itemGear += 1
          check(
            itemDef.exclusive === true,
            `来源唯一契约：窝点专属物品 ${id} 必须标 exclusive（专属型号：无蓝图、不上市场、不入常规掉落）`,
          )
          check(
            itemDef.kind === 'drone',
            `来源唯一契约：窝点专属物品 ${id} 目前只支持无人机类（kind = ${itemDef.kind}）`,
          )
        }
      }
      const bp = bpByModule.get(id)
      check(!bp, `来源唯一契约：窝点专属${kindText} ${id} 不得有蓝图（现被 ${bp} 产出；专属装备只能从高级箱出）`)
      const card = [...lairCtx.marketGoods.values()].find((g) => g.key === id || g.refId === id)
      if (card) marketCards += 1
      check(!card, `来源唯一契约：窝点专属${kindText} ${id} 不得有市场卡（现被 ${card?.key} 上架；专属装备只能从高级箱出）`)
      const frag = FRAGMENT_RECIPES[id]
      check(
        !frag,
        `来源唯一契约：窝点专属${kindText} ${id} 不得有碎片逆向配方（现指向 ${frag?.blueprintId}；专属装备只能从高级箱出）`,
      )
      for (const def of ANOMALIES_FLAVORED) {
        const inPool = [...(def.recycleLoot?.modules ?? []), ...(def.recycleLoot?.mk2 ?? [])].includes(id)
        check(
          !inPool,
          `来源唯一契约：窝点专属${kindText} ${id} 不得混进 ${def.name} 的常规残骸主题池（专属装备只能从高级箱出）`,
        )
      }
    }
    check(marketCards === 0, `来源唯一契约：窝点专属装备共 ${marketCards} 件出现在市场上架（应为 0）`)
    console.log(
      `· 来源唯一契约：${lairGearIds.size} 件窝点专属（装备 ${lairGearIds.size - itemGear} + 专属物品 ${itemGear}）` +
        `无蓝图、无市场卡、无碎片配方、不进常规掉落池（唯一来源＝高级箱）`,
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
    `· 派系活跃：候选 ${factionPool.size} 个中安/低安星系（掉落概率 ${Math.round(FACTION_RARE_DROP_CHANCE * 100)}% ×${FACTION_RARE_DROP_COUNT} 件，船长 2026-09-10 核定）`,
  )
  console.log(`· 窝点契约：${lairCards} 张窝点卡（稀有残骸 + 三档称呼 + 专属装备齐备，覆盖 ${famWithGear.size} 个敌族）`)
}

/* ── AI 扩容技能契约（2026-09-11 加）：工业专用工位扩容表里的技能 id 必须真实存在 ──
 * 背景：`balance.aiCore.industrySkillSlots` 是「技能 id → 每级工位数」的表；**写错 id 不会报错**，
 * 只会静默不生效（玩家练满也没工位）——在这里拦住；同时打印"满级合计"，与设计口径对照。 */
{
  const table = DEFAULT_BALANCE.aiCore.industrySkillSlots
  const ids = Object.keys(table ?? {})
  check(ids.length > 0, 'AI 扩容技能契约：工业专用工位扩容表不得为空')
  const catalog = new Map(SKILLS.map((s) => [s.id, s]))
  let total = 0
  const shown: string[] = []
  for (const id of ids) {
    const per = table[id] ?? 0
    const def = catalog.get(id)
    check(Boolean(def), `AI 扩容技能契约：${id} 不在技能目录中（写错 id 会静默不生效）`)
    check(Number.isInteger(per) && per > 0, `AI 扩容技能契约：${id} 的每级工位数应为正整数，实际 ${per}`)
    total += per * MAX_SKILL_LEVEL
    shown.push(`${def?.name ?? id}(rank${def?.rank ?? '?'}) +${per}/级`)
  }
  // 反向护栏（2026-09-11）：技能说明里承诺了「工业专用工位」的技能，必须在扩容表里——
  // 否则会出现"练满也不生效"的静默失效（删表/改名/新增技能漏登记都会被抓到）。
  for (const s of SKILLS) {
    if (!s.description.includes('工业专用工位')) continue
    check(
      ids.includes(s.id),
      `AI 扩容技能契约：技能「${s.name}」(${s.id}) 说明里承诺工业专用工位，却不在 balance.aiCore.industrySkillSlots 表里（练满也不生效）`,
    )
  }
  const sharedCap = MAX_SKILL_LEVEL // 共用上限满级 = AI 核心操作学满级（每级 +1）
  console.log(
    `· AI 扩容技能契约：${ids.length} 个工业工位技能（${shown.join('、')}）→ 满级站内工位 = 共用 ${sharedCap} + 扩容 ${total} = ${sharedCap + total}`,
  )
}

/* ── 模块跨族字段契约（2026-09-11 加；船长反馈「赃物强化舱的属性并没有显示装甲容量的加成数值」）──
 * 背景：模块的界面呈现**按槽位分支**（装甲槽画装甲、货舱槽画货舱……），所以"槽位族之外的搭车加成"
 * 一旦出现，就很容易被界面整段吞掉（赃物强化舱 = 货舱槽 + 装甲容量 15% 就是典型；生体甲壳板 = 装甲槽 +
 * 自愈在信息卡里也曾漏）。界面侧已加"跨族尾巴"补齐，这里再加一道**数据侧护栏**：
 *   「字段归属槽位 ≠ 本件槽位」的组合必须逐一登记在白名单里 —— 新增一件跨族件时，
 *   契约会报错提醒"先确认界面能显示、再登记"，避免又出现静默漏显示。
 * 字段归属表与界面 `crossFamilyLines`（apps/desktop .../ui/shipInfo.tsx）保持同一口径。 */
{
  /** 字段 → 归属槽位（"本职"归属；写在其它槽位上即视为跨族） */
  const OWNER: Record<string, string> = {
    bonus: 'miner|cargo',
    shieldHpBonus: 'shield',
    shieldResistAdd: 'shield',
    armorHpBonus: 'armor',
    armorResistAdd: 'armor',
    speedPenaltyPct: 'armor',
    hullHpBonus: 'armor',
    hullResistAdd: 'armor',
    speedBonusPct: 'propulsion',
    hitPenalty: 'propulsion',
    droneBayBonusM3: 'drone-rack',
    droneDmgBonus: 'drone-tac',
    droneRangeBonusPct: 'drone-relay',
    damageTypeBonusPct: 'support',
    reloadCutPct: 'support',
    hitBonusPct: 'support',
    evasionGapPct: 'support',
    repairArmorHp: 'support',
    repairHullHp: 'support',
    repairKit: 'support',
    lockDmgBonus: 'target-lock',
  }
  /** 已核过界面呈现的跨族组合（id:字段）——新增组合必须先确认能显示再登记 */
  const REGISTERED: readonly string[] = [
    'mod-lair-cargo-a:armorHpBonus', // 赃物强化舱（货舱槽 + 装甲容量）→ 界面「装甲容量 +15%」
    'mod-lair-armor-c:repairArmorHp', // 生体甲壳板（装甲槽 + 自愈）→ 信息卡「生体自愈」
    'mod-lair-dc-c:hullResistAdd', // 生体损管腔（支援槽 + 结构抗性）→ 结构抗性行
  ]
  let counted = 0
  const found: string[] = []
  for (const m of MODULES) {
    for (const [field, owner] of Object.entries(OWNER)) {
      if (owner.split('|').includes(m.slot)) continue
      const v = (m as unknown as Record<string, unknown>)[field]
      if (v === undefined || v === null) continue
      if (typeof v === 'number' && v === 0) continue
      if (typeof v === 'object' && Object.keys(v as object).length === 0) continue
      counted++
      const key = `${m.id}:${field}`
      found.push(key)
      check(
        REGISTERED.includes(key),
        `模块跨族字段契约：${m.name}（${m.id}，槽位 ${m.slot}）带了「${field}」（归属槽位 ${owner}）——` +
          `请确认界面能显示该加成（shipInfo.tsx 的 crossFamilyLines / crossFamilyShort），再把「${key}」登记进本契约白名单`,
      )
    }
  }
  console.log(
    `· 模块跨族字段契约：${MODULES.length} 件装备中 ${counted} 处"槽位族之外的搭车加成"，全部已登记且界面有呈现口径` +
      `（${found.length > 0 ? found.join('、') : '无'}）`,
  )
}

/* ── 舰种契约（2026-09-11 加；船长定案：舰种 5 档、敌我共用、按等效质量落档）──
 * 背景：舰种**收敛为 5 档**（原 7 档作废），「重型巡洋」归巡洋舰档、「战列巡洋」归战列舰档
 * （皆为称号不是独立档）。本契约只做**归类校验**，不改任何船的 tier、不重切任何质量区间：
 *   ① 每艘船的 `tier` 必须与其**等效质量落档**一致——不一致即报错并点名
 *      （船名/质量/等效质量/实际 tier/应为 tier）⇒ 专抓"质量改了却忘改档"或"档标错"；
 *   ② 每个舰种档**恰好**一档命名 + 一个基准速度，且基准速度落在合理值域 100~500；
 *   ③ 打印一行归类统计（各档船数 + 五个基准速度）。
 * ⚠ 若 ① 真抓到不一致：**不要顺手改船的 tier**——把不一致的船交船长裁决。 */
{
  /** 等效质量落在哪一档（自高向低取第一个"下界 ≤ 等效质量"的档；低于最低下界 = 0 表示落不进任何档） */
  const tierOfMass = (eq: number): number => {
    for (const t of [5, 4, 3, 2, 1] as const) {
      if (eq >= HULL_CLASS_MASS_RANGE[t][0]) return t
    }
    return 0
  }
  const classCount: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  let matched = 0
  for (const ship of SHIPS) {
    const eq = equivalentMassOf(ship)
    const expect = tierOfMass(eq)
    check(
      expect !== 0,
      `舰种契约：${ship.name}（${ship.id}）等效质量 ${eq} 低于最低档下界 ${HULL_CLASS_MASS_RANGE[1][0]}（落不进任何舰种档）`,
    )
    check(
      ship.tier === expect,
      `舰种契约：${ship.name}（${ship.id}）质量 ${ship.massKg} → 等效质量 ${eq}，实际 tier ${ship.tier}，应为 tier ${expect}（落档区间与 tier 不一致；请船长裁决，勿自行改档）`,
    )
    if (ship.tier === expect && expect !== 0) matched += 1
    if (expect !== 0) classCount[expect] += 1
  }
  for (const t of [1, 2, 3, 4, 5] as const) {
    const [lo, hi] = HULL_CLASS_MASS_RANGE[t]
    check(
      Number.isFinite(lo) && hi > lo,
      `舰种契约：${HULL_CLASS_NAME[t]}（T${t}）等效质量区间非法 [${lo}, ${hi})`,
    )
    if (t < 5) {
      check(
        HULL_CLASS_MASS_RANGE[t][1] === HULL_CLASS_MASS_RANGE[(t + 1) as 2 | 3 | 4 | 5][0],
        `舰种契约：${HULL_CLASS_NAME[t]}（T${t}）与 ${HULL_CLASS_NAME[(t + 1) as 2 | 3 | 4 | 5]}（T${t + 1}）的质量区间不接续（有缝或重叠）`,
      )
    }
    check(
      typeof HULL_CLASS_NAME[t] === 'string' && HULL_CLASS_NAME[t].length > 0,
      `舰种契约：T${t} 档缺少舰种命名`,
    )
    const spd = HULL_CLASS_BASE_SPEED[t]
    check(
      typeof spd === 'number' && Number.isFinite(spd) && spd >= 100 && spd <= 500,
      `舰种契约：${HULL_CLASS_NAME[t]}（T${t}）基准速度 ${spd} 越界（合理值域 100~500 m/s）`,
    )
  }
  const shown = ([1, 2, 3, 4, 5] as const)
    .map((t) => `${HULL_CLASS_NAME[t]} ${classCount[t]}`)
    .join(' / ')
  console.log(
    `· 舰种契约：${matched}/${SHIPS.length} 艘船归类与等效质量一致（${shown}）；` +
      `基准速度 ${([1, 2, 3, 4, 5] as const).map((t) => HULL_CLASS_BASE_SPEED[t]).join('/')}`,
  )
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
