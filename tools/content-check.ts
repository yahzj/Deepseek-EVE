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
  FOE_DRONES,
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
  RETIRED_LAIR_CARD_IDS,
  ALIEN_BEAST_SHIP_IDS,
  COMMS_MESSAGES,
  COMMS_FACTIONS,
  FACTION_AVATARS,
  TUTORIAL_TOTAL,
  DIALOGUES,
  STATION_SITES,
  GALAXIES,
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
  createFoeSpecs, // 机群火力占比契约的守恒实测（Σ 单发对照）
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
        `蓝图说明契约：${bp.id} 说明写需声望 ${m[1]}，实际市场 standingReq = ${g?.standingReq ?? "（无市场卡）"}`,
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
      check(
        false,
        `蓝图说明契约：${bp.id} 说明点名了「${def.name}」，实际材料只有 ${[...mats].map(mineralNameOf).join(" + ")}`,
      )
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
        `产物说明契约：${kindLabel} ${def.id} 说明写「${m[0]}」，但按无人机舱位换算不成立（实际可多带 ${drones.map((x, i) => `${x.name} ${caps[i]} 架`).join(" / ")}）`,
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
    for (const i of ids)
      for (const p of pers)
        if (related(i.prefix, p.prefix))
          pairs.push({
            skill: i.id,
            per: p.per,
            from: `${path}（${i.prefix || "技能"} ↔ ${p.prefix}）`,
          })
    for (const [k, v] of Object.entries(obj))
      if (v && typeof v === 'object') collect(v, path ? `${path}.${k}` : k)
  }
  collect(DEFAULT_BALANCE, 'balance');
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
    const hit = claims.some((c) =>
      [...allowed].some((a) => Math.abs(a - c) < 0.051),
    )
    check(
      hit,
      `技能说明契约：技能「${def.name}」(${p.skill}) 说明写的是 ⟦${claims.join("% / ")}⟧，而 ${p.from} 是每级 ${p.per}——说明与引擎对不上`,
    )
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
      unwired.push(
        `${def.name}（${item.skill}）：${item.note ?? "说明承诺了效果，但引擎里查无接线"}`,
      )
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
console.log(
  `· 舰船：${SHIPS.length} 艘（role 分布：${["industrial", "armed", "armored", "hauler"].map((r) => `${r}=${SHIPS.filter((s) => s.role === r).length}`).join(" ")})`,
)

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
      byType('plasma') > byType('kinetic') &&
        byType('plasma') > byType('explosive'),
      `弹药：能量(plasma)基数应最高（${suffix} 档），实际 kin=${byType("kinetic")} exp=${byType("explosive")} pla=${byType("plasma")}`,
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
          const tag =
            d.exclusive === true
              ? '专属'
              : (DRONE_ROLE_SPECS[cls as keyof typeof DRONE_ROLE_SPECS]
                  ?.label ?? cls)
          return `${tag} 闪避 ${d.defense?.evasion ?? "—"}·血 ${droneTotalHp(d)}·单发 ${d.dmg ?? 0}`
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
 * ③窝点派生卡（`lairAnomalyOf`）= 同一主系 + **6:4**（60%/40%）；主系**不许变**；
 * ④**E 族特例**（2026-09-11 船长：「**E 族单独调整，包括 E 族赏金任务的伤害比例**」）：
 *   泰坦巨构全族 = **50% 动能 + 50% 爆炸**（族格「动能 + 爆炸为主」的对称落点）⇒
 *   **常驻卡与窝点派生卡一律 5:5**（窝点**不套 6:4**——族级特例优先于'窝点比悬赏更混'的一般口径）。 */
{
  const TEACHING_CARD = 'ano-training'
  let mixed = 0
  let pureBeam = 0
  /** E 族特例（5:5）计数——见下方 ④ */
  let symmetric = 0
  const positive = (mix: Partial<Record<string, number>> | undefined): Array<[string, number]> =>
    Object.entries(mix ?? {}).filter(([, v]) => typeof v === 'number' && v > 0) as Array<[string, number]>
  for (const def of ANOMALIES_FLAVORED) {
    if (def.id === TEACHING_CARD) {
      check(positive(def.dmgMix).length <= 1, `混伤契约：教学卡 ${def.id} 应保持纯系（不写两系 dmgMix）`)
      continue
    }
    const rows = positive(def.dmgMix)
    // 纯能量特例（2026-09-10 船长：深渊之门卫队改纯能量；2026-09-11 裁定⑤放宽）：
    // 单系 plasma 合法，但**必须有"收束旋钮"**——远端不许既必中又不衰减：
    // - **旧威胁推导路径**：必须**显式给 `foeFalloff`**（能量走 `beamPowerFactor` 威力衰减，写缺省 0.30 太轻）；
    // - **舰级路径**（2026-09-11 裁定⑤「能量·掷命中」档后）：放宽为「**衰减或命中任给其一**」——
    //   掷命中形态下"命中随距离衰减 + 消费 hitRate"本身就是收束旋钮。契约据此**要求显式声明形态**：
    //   `energyForm: 'spit'`（掷命中）⇒ 必须 `hitRate < 1`（掷命中的意义就是有掷的成分）；
    //   缺省 / `'beam'`（必中光束）⇒ 必须显式收紧 `falloff`（≤ 缺省 0.5，不许宽于全局默认）。
    if (rows.length === 1 && rows[0]![0] === 'plasma') {
      const pureShips = [...new Map((def.ships ?? []).map((s) => [s.ship.id, s.ship])).values()]
      if (pureShips.length > 0) {
        for (const ship of pureShips) {
          check(
            ship.energyForm !== undefined,
            `混伤契约：纯能量卡 ${def.name} 引用的舰级「${ship.name}」未显式声明 energyForm——` +
              `纯能量必须有收束旋钮：'spit'（能量掷命中：掷命中 + 命中随距离衰减）或 'beam'（必中光束，须收紧 falloff）`,
          )
          if (ship.energyForm === 'spit') {
            check(
              ship.hitRate < 1,
              `混伤契约：纯能量卡 ${def.name} 的舰级「${ship.name}」声明了 'spit'（能量掷命中）却给 hitRate ${ship.hitRate}——` +
                `掷命中形态须给小于 1 的命中率（否则与"必中"无异、收束旋钮形同虚设）`,
            )
          } else {
            check(
              ship.falloff <= 0.5,
              `混伤契约：纯能量卡 ${def.name} 的舰级「${ship.name}」走必中光束却给了 falloff ${ship.falloff}——` +
                `必中光束的远端收束只能靠 falloff，须不宽于全局缺省 0.5`,
            )
          }
        }
      } else {
        check(
          def.foeFalloff !== undefined,
          `混伤契约：纯能量卡 ${def.name} 必须显式给 foeFalloff（远端威力衰减，缺省 0.30 太轻）`,
        )
      }
      pureBeam += 1
      continue
    }
    // **④ E 族特例**（2026-09-11 船长：「**E 族单独调整，包括 E 族赏金任务的伤害比例**」）：
    // 泰坦巨构全族 = **50% 动能 + 50% 爆炸**（族格「动能 + 爆炸为主」的对称落点）——
    // **常驻卡与窝点派生卡一律 5:5**（窝点不套 6:4：族级特例优先于"窝点比悬赏更混"的一般口径）。
    if (def.foeFamily === 'E') {
      const w = new Map(rows)
      check(
        rows.length === 2 && w.get('kinetic') === 5 && w.get('explosive') === 5,
        `混伤契约：E 族（泰坦巨构）${def.name} 应写 **50% 动能 + 50% 爆炸**（\`{ kinetic: 5, explosive: 5 }\`）——` +
          `船长 2026-09-11「**E 族单独调整，包括 E 族赏金任务的伤害比例**」；实际 ${JSON.stringify(def.dmgMix)}`,
      )
      const eLair = lairAnomalyOf(def, 3)
      const eRows = positive(eLair.dmgMix)
      check(
        eRows.length === 2 && eRows.every(([, v]) => v === 5),
        `混伤契约：E 族 ${def.name} 的**窝点派生卡**应同为 5:5（不套全局 6:4），实际 ${JSON.stringify(eLair.dmgMix)}`,
      )
      symmetric += 1
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
      `${symmetric > 0 ? `；**E 族特例 ${symmetric} 张 50% 动能 + 50% 爆炸**（窝点派生同值，不套 6:4）` : ""}` +
      `${pureBeam > 0 ? `；纯能量卡 ${pureBeam} 张（单系 plasma + 收束旋钮：舰级路径须显式 energyForm，旧路径须显式 foeFalloff）` : ""}`,
  )

  /* ── 敌速口径契约（2026-09-10 加）──
   * 船长 2026-09-10 裁决「采取固定锚定，参考按照速度中位线的船只进行参考」：
   *   基准船 = 船池按 maxSpeedMps 排序取中位（长尾鲨级 272 / 敏捷 0.54）
   *   基准战斗机动 = 船速 × speedFactor ×(1+(敏捷−0.5)×2×agilitySpeedBonus) ≈ 165.2 m/s
   *   比率 = 敌战斗机动 ÷ 基准战斗机动，其中敌战斗机动 = foeSpeedMps × speedFactor × 0.94（敌敏捷固定 0.3）
   * 契约：① 每张敌军卡必须**逐卡显式**写 foeSpeedMps（防止新增卡悄悄回落到段参考船旧公式口径）；
   *       ② 比率必须落在该战术口径带内（brawl 1.05~1.55 / orbit 0.90~1.25 / kite 0.60~0.85）。
   *
   * ⚠ **A 族例外（2026-09-11 数值落地批，船长确认「A 族速度都快（方便突袭）」）**——
   * 海盗族舰级路径卡**不受旧"战术比率带"约束**：旧带锚定"中位玩家船"，其中 kite 带 0.60~0.85
   * 与船长「劫掠团也跑得快、方便突袭」的设定**直接冲突**（狙击舰新实速 325 比率 ≈1.11）。
   * 该族改按**族口径**校验：**实速必须高于本档舰种基准**（护卫 340 / 驱逐 295 / 巡洋 258）
   * 且比率落在**全族提速带 1.00~1.60**（下限 = "比基准船快"，上限防失控）。
   * 其余族（非 A）舰级路径卡仍按上面的战术带；旧路径卡（未写 ships）一律不变。 */
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
    /** A 族（海盗）全族提速带：下限 = 快于基准船，上限防失控（船长 2026-09-11 裁定） */
    const PIRATE_SPEED_BAND: readonly [number, number] = [1.0, 1.6]
    /** B 族（武装拾荒者）**全族慢速带**（船长 2026-09-11「速度偏慢」→ 裁决「B 族速落实 0.8」）：
     *  上限 1.00 = **慢于基准船**（"偏慢"的可验证表达）；下限 **0.75** 防失控（防被调到极慢变成"玩家白嫖"）。
     *  取值与三号 `handover-faction-b-20260911.md` §三 登记的 B 族偏慢带 **0.75~1.00×** 对齐。
     *  **必须用族级带、不能用战术带**：orbit 常规带 0.90~1.25 与"全族慢速"冲突（0.80 口径下拾荒火力舰 0.81× 会被误拦）。 */
    const SCAV_SPEED_BAND: readonly [number, number] = [0.75, 1.0]
    /** C 族（异形生物）**全族提速带**（船长 2026-09-11 裁定②：「**C 族速度比 A 海盗还快**」）：
     *  - **倍率口径**（设计稿表格的"倍率"列，即 `speedRatio`）：**1.30~2.10**——四档实测 1.35 / 1.60 / 1.62 / 1.65；
     *  - **基准船比率口径**（与 A / B 族同度量，见下）：**1.30~2.10**，**T4 巨兽豁免**
     *    （船长裁定③：「允许 T4 战列舰（生物巨兽）；**T4 例外允许慢**」——噬口巨兽 328 m/s 比率 ≈1.12）；
     *  - **横向断言**：**同档实速必须高于 A 族同档最快舰级**（A 族无 T4 ⇒ T4 只做白名单登记校验）。 */
    const ALIEN_SPEED_RATIO_BAND: readonly [number, number] = [1.3, 2.1]
    const ALIEN_SPEED_BAND: readonly [number, number] = [1.3, 2.1];
    /** D 族（守墓古舰）**族格速带**（船长 2026-09-11 亲定「幽灵舰 1.10 · 守墓长舰 1.00 · 静滞卫舰 0.50」
     *  ⇒ 族格读法 = **越往里越慢**，实测比率 **0.44 / 0.88 / 1.11**）：
     *  带取 **0.40~1.15×**——下限要吃下'半速的静滞卫舰'（0.44），上限略高于'提速的幽灵舰'（1.11）。
     *  ⚠ **必须用族级带、不能用战术带**：kite 常规带 0.60~0.85 会把 0.44× **误拦**（与 B 族 0.81× 同款教训）。 */
    const GRAVE_SPEED_BAND: readonly [number, number] = [0.4, 1.15];
    /**
     * **E 族（泰坦巨构）族格速带**（2026-09-11 机群批 · 船长裁定「族速带 0.65~0.95 × 本档基准」；
     * **同日终裁**「**族速度倍率设为 0**。依靠无人机攻击炮台范围外敌人」⇒ 下限放开到 **0**）。
     * 族格 = **巨构不讲机动，只讲撑到最后**（'还在跑的老机器'；速度 0 = **静物残骸**，火力由机群投送）
     * ——全族**实速不高于本档舰种基准**（`speedRatio ≤ 1`）。带取 **0~0.90×**（比率 = 实速 × 敌敏捷 ÷
     * 基准船战斗机动，与 A/B/C/D 同一口径）：下限 0 是'静物'这一族级口径的落点，上限吃下族内任何
     * 非零速度（历史顶格 = T4 × 0.95 = 195 ⇒ 0.67×）。
     * ⚠ **必须用族级带、不能用战术带**：brawl 常规带 1.05~1.55 会把慢的巨构**误拦**（与 B/D 同款教训）。
     */
    const TITAN_SPEED_BAND: readonly [number, number] = [0, 0.9]
    /** A 族各档**最快实速**（横向对照用；从舰级表现算，不手抄数字） */
    const pirateFastestByTier = new Map<number, number>()
    for (const ship of FOE_SHIPS) {
      if (ship.family !== 'A') continue
      const spd = Math.round(HULL_CLASS_BASE_SPEED[ship.hullClassTier] * ship.speedRatio)
      pirateFastestByTier.set(ship.hullClassTier, Math.max(pirateFastestByTier.get(ship.hullClassTier) ?? 0, spd))
    }
    let speedCounted = 0
    let speedShipPath = 0
    let pirateReadings = 0
    const pirateSample: string[] = []
    let alienReadings = 0
    const alienSample: string[] = []
    let graveReadings = 0
    const graveSample: string[] = []
    let titanReadings = 0
    const titanSample: string[] = []
    let scavReadings = 0
    const scavSample: string[] = []
    for (const def of ANOMALIES_FLAVORED) {
      // 舰级路径（2026-09-11）：速度由**舰级登记值**决定，故不再要求逐卡 foeSpeedMps；
      // 改按"该卡实际会建出的单位速度"（非僚机编成条目）校验比率。
      const mains = (def.ships ?? []).filter((s) => s.escort !== true)
      if (mains.length > 0) {
        speedShipPath++
        for (const slot of mains) {
          // 2026-09-11 追加裁决：舰级速度改登记「舰种档 + 倍率」→ 实速 = 舰种基准 × 倍率 × 条目 speedMul
          const base = HULL_CLASS_BASE_SPEED[slot.ship.hullClassTier]
          const spd = Math.round(base * slot.ship.speedRatio * (slot.speedMul ?? 1))
          const tactic = slot.tactic ?? slot.ship.tactic
          const ratio = (spd * foeAgi) / refCombat
          if (def.foeFamily === 'A') {
            // A 族口径（见上方⚠）：高于本档舰种基准 + 落在全族提速带
            pirateReadings++
            pirateSample.push(`${def.id}/${slot.ship.name} ${spd}(${ratio.toFixed(2)})`)
            check(
              spd > base,
              `敌速口径契约：A 族 ${def.name} 的舰级「${slot.ship.name}」实速 ${spd} m/s **未高于本档舰种基准 ${base} m/s**——` +
                `船长 2026-09-11 裁定 A 族「速度都快（方便突袭）」，每档都必须高于基准（护卫 340 / 驱逐 295 / 巡洋 258）`,
            )
            check(
              ratio >= PIRATE_SPEED_BAND[0] && ratio <= PIRATE_SPEED_BAND[1],
              `敌速口径契约：A 族 ${def.name} 的舰级「${slot.ship.name}」（${tactic}）比率 ${ratio.toFixed(2)}× 越出全族提速带 ` +
                `${PIRATE_SPEED_BAND[0]}~${PIRATE_SPEED_BAND[1]}×（基准船 ${refShip.name} 战斗机动 ${refCombat.toFixed(1)} m/s）`,
            )
            continue
          }
          if (def.foeFamily === 'B') {
            // **B 族（武装拾荒者）口径**（船长 2026-09-11：「**速度偏慢**」→ 裁决「**B 族速落实 0.8**」）：
            // ①族级硬口径 = **实速必须低于本档舰种基准**（`speedRatio < 1`）——与倍率口径无关，恒成立；
            // ②比率按 **B 族专用慢速带 `SCAV_SPEED_BAND = 0.75~1.00×`**（= **慢于基准船**）校验。
            //   实测读数：拾荒武装艇 272（**0.93×**）、拾荒火力舰 236（**0.81×**）。
            // ⚠ **为什么不用战术带**：战术带（orbit 0.90~1.25×）描述的是"普通 orbit 单位的机动区间"，
            //   与"**全族慢速**"这一族级口径**直接冲突**——0.80 口径下拾荒火力舰 236 m/s ⇒ 比率 **0.81×**
            //   会被 orbit 带**误拦**（本批实测踩到）。族级口径必须用族级带表达。
            scavReadings++
            scavSample.push(`${def.id}/${slot.ship.name} ${spd}(${ratio.toFixed(2)})`)
            check(
              spd < base,
              `敌速口径契约：B 族 ${def.name} 的舰级「${slot.ship.name}」实速 ${spd} m/s **未低于本档舰种基准 ${base} m/s**——` +
                `船长 2026-09-11 裁定「**速度偏慢**」（倍率须 < 1）`,
            )
            check(
              ratio >= SCAV_SPEED_BAND[0] && ratio <= SCAV_SPEED_BAND[1],
              `敌速口径契约：B 族 ${def.name} 的舰级「${slot.ship.name}」（${tactic}）比率 ${ratio.toFixed(2)}× 越出**全族慢速带** ` +
                `${SCAV_SPEED_BAND[0]}~${SCAV_SPEED_BAND[1]}×（船长「速度偏慢」；基准船 ${refShip.name} 战斗机动 ${refCombat.toFixed(1)} m/s）`,
            )
            continue
          }
          if (def.foeFamily === 'C') {
            // **C 族（异形生物）口径**（船长 2026-09-11 裁定②「C 族速度比 A 海盗还快」+ 裁定③「T4 例外允许慢」）：
            // ①倍率口径（speedRatio）落全族提速带 1.30~2.10；②基准船比率口径同带，**T4 巨兽豁免**；
            // ③**同档实速必须高于 A 族同档最快舰级**（A 族无 T4 档 ⇒ 只做巨兽白名单登记校验）。
            const tier = slot.ship.hullClassTier
            if (alienSample.some((s) => s.startsWith(`${slot.ship.id} `))) continue // 同一舰级被多条编成引用时只校验一次
            alienReadings++
            alienSample.push(`${slot.ship.id} ${slot.ship.name} ${spd}(${ratio.toFixed(2)})`)
            check(
              slot.ship.speedRatio >= ALIEN_SPEED_RATIO_BAND[0] && slot.ship.speedRatio <= ALIEN_SPEED_RATIO_BAND[1],
              `敌速口径契约：C 族 ${def.name} 的舰级「${slot.ship.name}」倍率 ${slot.ship.speedRatio.toFixed(2)}× 越出**全族提速带** ` +
                `${ALIEN_SPEED_RATIO_BAND[0]}~${ALIEN_SPEED_RATIO_BAND[1]}×（船长裁定②「C 族速度比 A 海盗还快」）`,
            )
            if (tier === 4 || tier === 5) {
              check(
                ALIEN_BEAST_SHIP_IDS.includes(slot.ship.id),
                `敌速口径契约：C 族 ${def.name} 的舰级「${slot.ship.name}」登记了 T${tier} 档却不在**巨兽白名单**` +
                  `（ALIEN_BEAST_SHIP_IDS）——船长裁定③只允许「生物巨兽」用 T4，且**允许慢**（本档免比率校验）`,
              )
            } else {
              check(
                ratio >= ALIEN_SPEED_BAND[0] && ratio <= ALIEN_SPEED_BAND[1],
                `敌速口径契约：C 族 ${def.name} 的舰级「${slot.ship.name}」（${tactic}）比率 ${ratio.toFixed(2)}× 越出**全族提速带** ` +
                  `${ALIEN_SPEED_BAND[0]}~${ALIEN_SPEED_BAND[1]}×（基准船 ${refShip.name} 战斗机动 ${refCombat.toFixed(1)} m/s）`,
              )
            }
            const aFastest = pirateFastestByTier.get(tier)
            if (aFastest !== undefined) {
              check(
                spd > aFastest,
                `敌速口径契约：C 族 ${def.name} 的舰级「${slot.ship.name}」实速 ${spd} m/s **未高于 A 族同档最快** ${aFastest} m/s——` +
                  `船长裁定②「**C 族速度比 A 海盗还快**」（同档必须更快；T4 巨兽例外不在此列）`,
              )
            }
            continue
          }
          if (def.foeFamily === 'D') {
            // **D 族（守墓古舰）口径**（船长 2026-09-11 三次亲定：档位「**1 驱逐 2 巡洋**」/ 战法「**静滞卫舰远程、
            // 幽灵舰中程**」/ 速度「幽灵舰 **1.10** · 守墓长舰 **1.00** · 静滞卫舰 **0.50**」）：
            // 族格读法 = **越往里越慢**（外围巡哨还要机动 / 陵区主力按基准 / 最内层的守誓者只有半速）
            // ⇒ 实测比率 0.44 / 0.88 / 1.11，**必须用族级速带**校验，
            //   不能用战术带（kite 常规带 0.60~0.85 会把 0.44× 的静滞卫舰**误拦**——与 B 族那次同款教训：
            //   **族级口径必须用族级带表达**）。
            if (graveSample.some((s) => s.startsWith(`${slot.ship.id} `)))
              continue; // 同一舰级被多条编成引用时只校验一次
            graveReadings++
            graveSample.push(
              `${slot.ship.id} ${slot.ship.name} ${spd}(${ratio.toFixed(2)})`,
            )
            check(
              ratio >= GRAVE_SPEED_BAND[0] && ratio <= GRAVE_SPEED_BAND[1],
              `敌速口径契约：D 族 ${def.name} 的舰级「${slot.ship.name}」（${tactic}）比率 ${ratio.toFixed(2)}× 越出**族格速带** ` +
                `${GRAVE_SPEED_BAND[0]}~${GRAVE_SPEED_BAND[1]}×（船长「越往里越慢」：幽灵舰 1.10 / 守墓长舰 1.00 / 静滞卫舰 0.50；` +
                `基准船 ${refShip.name} 战斗机动 ${refCombat.toFixed(1)} m/s）`,
            )
            continue
          }
          if (def.foeFamily === 'E') {
            // **E 族（泰坦巨构）口径**（船长 2026-09-11 机群批：「巨构不讲机动，只讲撑到最后」；
            // 同日晚些终裁：「**族速度倍率设为 0**。依靠无人机攻击炮台范围外敌人」）：
            // 族格 = **静物残骸**（'还在跑的老机器'）⇒ 实速落 **E 族族格速带 0~0.90 × 本档舰种基准**。
            // ⚠ 与 D 族同款教训：**族级口径必须用族级带表达**——战术带（brawl 1.05~1.55×）会把
            // 慢的巨构**误拦**（它本来就是慢的，慢是设定不是失衡；速度 0 更是族规本身）。
            if (titanSample.some((s) => s.startsWith(`${slot.ship.id} `)))
              continue; // 同一舰级只校验一次
            titanReadings++
            titanSample.push(
              `${slot.ship.id} ${slot.ship.name} ${spd}(${ratio.toFixed(2)})`,
            )
            check(
              slot.ship.speedRatio <= 1,
              `敌速口径契约：E 族 ${def.name} 的舰级「${slot.ship.name}」速度倍率 ${slot.ship.speedRatio} **高于本档舰种基准**——` +
                `船长族格「巨构不讲机动」（E 族族带 0~0.90 × 本档基准）`,
            )
            check(
              ratio >= TITAN_SPEED_BAND[0] && ratio <= TITAN_SPEED_BAND[1],
              `敌速口径契约：E 族 ${def.name} 的舰级「${slot.ship.name}」（${tactic}）比率 ${ratio.toFixed(2)}× 越出**族格速带** ` +
                `${TITAN_SPEED_BAND[0]}~${TITAN_SPEED_BAND[1]}×（船长「巨构不讲机动，只讲撑到最后」；基准船 ${refShip.name} ` +
                `战斗机动 ${refCombat.toFixed(1)} m/s）`,
            )
            continue
          }
          const band = SPEED_BAND[tactic] ?? SPEED_BAND.orbit!
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
      `· 敌速口径契约：${speedCounted} 张逐卡显式标定 + ${speedShipPath} 张引用舰级速度，比率均在战术带内（基准船 ${refShip.name} 战斗机动 ${refCombat.toFixed(1)} m/s）；` +
        `其中 A 族 ${pirateReadings} 条按**全族提速口径**（实速高于本档舰种基准、比率 ${PIRATE_SPEED_BAND[0]}~${PIRATE_SPEED_BAND[1]}×）、` +
        `B 族 ${scavReadings} 条按**全族慢速口径**（实速低于本档舰种基准、比率落 ${SCAV_SPEED_BAND[0]}~${SCAV_SPEED_BAND[1]}×；船长「速度偏慢」→「B 族速落实 0.8」）、` +
        `C 族 ${alienReadings} 条按**全族更快口径**（倍率 ${ALIEN_SPEED_RATIO_BAND[0]}~${ALIEN_SPEED_RATIO_BAND[1]}×、比率 ${ALIEN_SPEED_BAND[0]}~${ALIEN_SPEED_BAND[1]}×、` +
        `同档实速须高于 A 族；T4 巨兽例外允许慢）、` +
        `D 族 ${graveReadings} 条按**族格"越往里越慢"口径**（幽灵舰 1.10 / 守墓长舰 1.00 / 静滞卫舰 0.50，比率落 ${GRAVE_SPEED_BAND[0]}~${GRAVE_SPEED_BAND[1]}×）、` +
        `E 族 ${titanReadings} 条按**族格"巨构不讲机动"口径**（族速度倍率 0 = 静物残骸、靠机群作战，比率落 ${TITAN_SPEED_BAND[0]}~${TITAN_SPEED_BAND[1]}×）`,
    )
    if (pirateSample.length > 0)
      console.log(`  ↳ A 族实测读数（实速/比率）：${pirateSample.join("　")}`)
    if (scavSample.length > 0)
      console.log(`  ↳ B 族实测读数（实速/比率）：${scavSample.join("　")}`)
    if (alienSample.length > 0)
      console.log(`  ↳ C 族实测读数（实速/比率）：${alienSample.join("　")}`)
    if (graveSample.length > 0)
      console.log(`  ↳ D 族实测读数（实速/比率）：${graveSample.join("　")}`)
    if (titanSample.length > 0)
      console.log(`  ↳ E 族实测读数（实速/比率）：${titanSample.join("　")}`)
  }

  /* ── 机群与防空契约（2026-09-11 机群批 S4 加 · 船长「我记得巨构需要制作敌方无人机系统」+
   *    A1「玩家武器通常不可打，需要带有防空属性的武器（为近防炮做铺垫）」+ C1/C2 分族先做 E 族）──
   * ① **防空武器必须短射程**：带 `canHitDrones` 的装备射程上限须 ≤ `PD_MAX_RANGE_M`——
   *    防空是'贴身护卫'；射程一放开，它就会变成'对舰能打、对空也能打'的通用最优解，
   *    而它的定位恰恰是**用一门主炮的槽位换'带机群的仗'的答案**。
   * ② **敌机只能挂在舰级上**：`drones` 只允许出现在 `FOE_SHIPS` 的舰级行（卡面不写机群）
   *    —— 与'舰级给绝对值、卡上用修正'同一纪律：改一艘船的影响面一眼可见。
   * ③ **机型必须在本族机型表内且族一致**（E 族用警戒机、G 族用蜂群机，不许串族）。
   * ④ **架数为 ≥1 的整数**（'机库存量、打光为止'的语义）。
   * ⑤ **E 族射程带与受击增程**（2026-09-11 船长：「E 族射程按照**最低 100**，**最高根据 7000~10000** 设定，
   *    **无人机射程设为 5000**，添加新机制，**受到攻击后，大幅提高无人机射程（提高 400%）**」）：
   *    a) **带机群的 E 族舰级**射程下限 = `TITAN_RANGE_MIN_M`（100）、上限须落在
   *       `TITAN_RANGE_MAX_BAND`（7,000~10,000）内 —— 族级射程口径由契约锁住，防逐卡漂移；
   *    b) **警戒机射程 = `TITAN_DRONE_RANGE_M`（5,000）**（机型表绝对值就是族级口径，改它要过船长）；
   *    c) **受击增程倍率**只允许**带机群的 E 族舰级**写，且 ≤ `DRONE_RANGE_ON_HIT_CAP`（4 = 船长裁定的
   *       「提高 400%」= ×4 ⇒ 5,000 → 20,000m 本场永久、不封顶）。
   * ⑥ **机群火力占比**（2026-09-11 船长：「**允许调整敌舰的无人机/炮台火力比例。这个要根据每个悬赏卡
   *    制定**」）：a) 取值域 **0~1**；b) **只有"该条目会展开出机群"（舰级 `drones` 非空）才允许写**；
   *    c) **守恒**——写了比例的卡，其**实收总单发**必须与"同卡去掉比例"逐字相等（机群与炮台此消彼长，
   *    总量不动）。
   */
  {
    // 2026-09-11 船长裁定「**近防炮射程按照 2500m 算**」⇒ 阈值随之上抬（点防仍远短于主炮 7 km）
    const PD_MAX_RANGE_M = 2_500
    /** E 族射程带（船长 2026-09-11：「最低 100，最高根据 7000~10000 设定」） */
    const TITAN_RANGE_MIN_M = 100
    const TITAN_RANGE_MAX_BAND: readonly [number, number] = [7_000, 10_000]
    /** 警戒机射程（船长同日：「无人机射程设为 5000」） */
    const TITAN_DRONE_RANGE_M = 5_000
    /** 受击增程倍率上限（船长同日：「提高 400%」＝×4） */
    const DRONE_RANGE_ON_HIT_CAP = 4
    const aaMods = MODULES.filter((m) => m.canHitDrones === true)
    check(
      aaMods.length > 0,
      '机群与防空契约：没有任何装备带防空属性（`canHitDrones`）——玩家将没有反制敌方机群的手段',
    )
    for (const m of aaMods) {
      const r = m.maxRangeM ?? 0
      check(
        r > 0 && r <= PD_MAX_RANGE_M,
        `机群与防空契约：防空武器「${m.name}」射程 ${r}m 超过 ${PD_MAX_RANGE_M}m——防空是贴身护卫，不是万能武器`,
      )
    }
    let droneSlots = 0
    /** E 族射程读数（逐舰级一条，落到汇总行） */
    const titanRanges: string[] = []
    let onHitShips = 0
    for (const ship of FOE_SHIPS) {
      const hasDrones = (ship.drones ?? []).length > 0
      // ⑤a **E 族射程带**（只约束带机群的 E 族舰级——即本批落码的那三条）
      if (ship.family === 'E' && hasDrones) {
        check(
          ship.rangeMinM === TITAN_RANGE_MIN_M,
          `机群与防空契约：E 族舰级「${ship.name}」射程下限 ${ship.rangeMinM}m ≠ ${TITAN_RANGE_MIN_M}m——` +
            `船长 2026-09-11「E 族射程按照**最低 100**」`,
        )
        check(
          ship.rangeMaxM >= TITAN_RANGE_MAX_BAND[0] && ship.rangeMaxM <= TITAN_RANGE_MAX_BAND[1],
          `机群与防空契约：E 族舰级「${ship.name}」射程上限 ${ship.rangeMaxM}m 越出 ${TITAN_RANGE_MAX_BAND[0]}~${TITAN_RANGE_MAX_BAND[1]}m——` +
            `船长 2026-09-11「最高根据 **7000~10000** 设定」`,
        )
        titanRanges.push(`${ship.name} ${ship.rangeMinM}~${ship.rangeMaxM}`)
      }
      // ⑤c **受击增程**：只给带机群的 E 族舰级，且倍率 ≤ 4（= +400%）
      if (ship.droneRangeMulOnHit !== undefined) {
        check(
          ship.family === 'E' && hasDrones,
          `机群与防空契约：舰级「${ship.name}」（${ship.family} 族${hasDrones ? '' : '、无机群'}）写了受击增程倍率——` +
            `本机制目前只允许**带机群的 E 族舰级**（船长 2026-09-11 E 族专属裁定）`,
        )
        check(
          ship.droneRangeMulOnHit > 1 && ship.droneRangeMulOnHit <= DRONE_RANGE_ON_HIT_CAP,
          `机群与防空契约：舰级「${ship.name}」受击增程倍率 ${ship.droneRangeMulOnHit} 越界（须 >1 且 ≤ ${DRONE_RANGE_ON_HIT_CAP}）`,
        )
        onHitShips++
      }
      for (const ds of ship.drones ?? []) {
        droneSlots++
        check(
          FOE_DRONES.some((d) => d.id === ds.drone.id),
          `机群与防空契约：舰级「${ship.name}」引用的机型 ${ds.drone.id} 不在机型表（FOE_DRONES）内`,
        )
        check(
          ds.drone.family === ship.family,
          `机群与防空契约：舰级「${ship.name}」（${ship.family} 族）挂了 ${ds.drone.family} 族的机型「${ds.drone.name}」——不许串族`,
        )
        check(
          Number.isInteger(ds.count) && ds.count >= 1,
          `机群与防空契约：舰级「${ship.name}」的机群架数 ${ds.count} 必须是 ≥1 的整数`,
        )
        // ⑤b **警戒机射程 = 5,000**（E 族族级口径）
        if (ship.family === 'E') {
          check(
            ds.drone.maxRangeM === TITAN_DRONE_RANGE_M,
            `机群与防空契约：E 族机型「${ds.drone.name}」射程 ${ds.drone.maxRangeM}m ≠ ${TITAN_DRONE_RANGE_M}m——` +
              `船长 2026-09-11「**无人机射程设为 5000**」`,
          )
        }
      }
    }
    console.log(
      `· 机群与防空契约：防空武器 ${aaMods.length} 件（射程上限 ≤ ${PD_MAX_RANGE_M}m）· 敌机登记 ${droneSlots} 处（机型在表内 / 族一致 / 架数合法）` +
        `${titanRanges.length > 0 ? ` · **E 族射程带** ${titanRanges.join('　')}（机型射程 ${TITAN_DRONE_RANGE_M}m）` : ''}` +
        `${onHitShips > 0 ? ` · **受击增程** ${onHitShips} 条舰级 ×${DRONE_RANGE_ON_HIT_CAP}（母舰被命中 ⇒ 全机群射程 ×4 = ${TITAN_DRONE_RANGE_M * DRONE_RANGE_ON_HIT_CAP}m，本场永久、不封顶）` : ''}`,
    )

    /* ⑥ **机群火力占比**（2026-09-11 船长：「允许调整敌舰的无人机/炮台火力比例。这个要根据每个
     *    悬赏卡制定」）——守恒拆分：条目实收总单发不变，机群与炮台此消彼长。
     *    a) 取值域 0~1；b) 只有"会展开出机群"的条目/舰级可写；c) **守恒实测**：写了比例的卡，
     *    其单位武器 Σ 必须与"同卡去掉比例"逐字相等（多舰补偿/取整都在同一链上，故可比）。 */
    {
      const shareCtx = buildSimContext()
      let shareShips = 0
      let shareSlots = 0
      for (const ship of FOE_SHIPS) {
        if (ship.droneFireShare === undefined) continue
        shareShips++
        check(
          ship.droneFireShare >= 0 && ship.droneFireShare <= 1,
          `机群与防空契约：舰级「${ship.name}」机群火力占比 ${ship.droneFireShare} 越界（须 0~1）`,
        )
        check(
          (ship.drones ?? []).length > 0,
          `机群与防空契约：舰级「${ship.name}」写了机群火力占比却**没有机群**——本旋钮只拆"机群 vs 母舰武器组"`,
        )
      }
      const sumShots = (def: (typeof ANOMALIES_FLAVORED)[number]): number =>
        createFoeSpecs(def, shareCtx.balance.battle).reduce(
          // ⚠ **排除备用机条目**（`w.reserve`）——备用机库是"库存深度"（战损后才放出），
          // 不属于常驻齐射；本契约判的是"比例有没有动总量"，故两边都不计备用机。
          (n, u) =>
            n +
            u.weapons.reduce((m, w) => m + (w.reserve === true ? 0 : (w.shotDmg ?? 0)), 0),
          0,
        )
      /** 去掉卡上所有 `droneFireShare`（舰级缺省也要压掉）的克隆——用于守恒对照。
       *  ⚠ **同时压掉 `droneReserve`**（2026-09-12 乙）——备用机库是**另一个维度**（库存深度）：
       *  它按"拆分后的逐架单发"额外贡献火力，若只压比例不压备用，对照两边会差出备用机的份额，
       *  误判成"不守恒"。本契约只判**比例**本身（同一编成下 T 不变）。 */
      const stripShare = (def: (typeof ANOMALIES_FLAVORED)[number]) => ({
        ...def,
        ships: def.ships?.map((s) => ({
          ...s,
          droneFireShare: undefined,
          ship: {
            ...s.ship,
            droneFireShare: undefined,
            droneReserve: undefined,
          },
        })),
      })
      for (const def of ANOMALIES_FLAVORED) {
        const slots = def.ships ?? []
        if (!slots.some((s) => (s.droneFireShare ?? s.ship.droneFireShare) !== undefined)) continue
        for (const s of slots) {
          const share = s.droneFireShare ?? s.ship.droneFireShare
          if (share === undefined) continue
          shareSlots++
          check(
            share >= 0 && share <= 1,
            `机群与防空契约：${def.name} 的编成条目「${s.ship.name}」机群火力占比 ${share} 越界（须 0~1）`,
          )
          check(
            (s.ship.drones ?? []).length > 0,
            `机群与防空契约：${def.name} 的编成条目「${s.ship.name}」写了机群火力占比却**没有机群**`,
          )
        }
        const withShare = sumShots(def)
        const without = sumShots(stripShare(def) as typeof def)
        check(
          withShare === without,
          `机群与防空契约：${def.name} 写了机群火力占比后**总单发不守恒**（${withShare} vs 去掉比例 ${without}）——` +
            `比例只改"机群 / 炮台"的构成，**总量不动**`,
        )
      }
      if (shareShips + shareSlots > 0)
        console.log(
          `· 机群火力占比契约：舰级缺省 ${shareShips} 条 · 卡上条目 ${shareSlots} 处（0~1 · 须有机群 · **总单发守恒**）`,
        )
    }

    /* ⑦ **备用机库**（2026-09-12 船长「或给敌机添加**备用机库**（损坏后补充敌机）」⇒ **本轮只采用乙**）
     *    与 ⑧ **单次出击上限**（同日「限制敌机单次出击数量」⇒ 船长裁定「**甲留作后续其他机制**」）：
     *    a) 乙：`droneReserve` 只允许**带机群的舰级**写；`count` = ≥1 整数、`respawnMs` = 500~60000ms
     *       （⚠ 与 A3 裁定「打光为止不补充」相反 = 船长 2026-09-12 **改判**）；
     *    b) 甲：机制已实现但**本轮不采用** ⇒ 契约**禁止任何舰级写 `droneLaunch`**
     *       （与「敌突进 / 单波增援」同款"机制实现、不启用"纪律：开关就是"契约不许写"）。
     */
    {
      let reserveShips = 0
      let launchShips = 0
      for (const ship of FOE_SHIPS) {
        if (ship.droneReserve !== undefined) {
          reserveShips++
          check(
            (ship.drones ?? []).length > 0,
            `机群与防空契约：舰级「${ship.name}」写了备用机库却**没有机群**`,
          )
          check(
            Number.isInteger(ship.droneReserve.count) && ship.droneReserve.count >= 1,
            `机群与防空契约：舰级「${ship.name}」备用机库架数 ${ship.droneReserve.count} 须为 ≥1 的整数`,
          )
          check(
            ship.droneReserve.respawnMs >= 500 && ship.droneReserve.respawnMs <= 60000,
            `机群与防空契约：舰级「${ship.name}」备用机补位间隔 ${ship.droneReserve.respawnMs}ms 越界（须 500~60000ms）`,
          )
        }
        if (ship.droneLaunch !== undefined) {
          launchShips++
          check(
            false,
            `机群与防空契约：舰级「${ship.name}」写了单次出击上限（\`droneLaunch\`）——` +
              `船长 2026-09-12 裁定「**甲留作后续其他机制**」⇒ 本轮**不许任何舰级启用**（机制已实现、待启用）`,
          )
        }
      }
      console.log(
        `· 机群出击契约：**备用机库** ${reserveShips} 条舰级启用（战损后满血补位；A3「不补充」已按船长改判）· **单次出击上限** ${launchShips} 条启用（机制就位、本轮不采用）`,
      )
    }
  }

  /* ── 舰级契约（2026-09-11 加，船长定案「敌舰配置表 + 卡上修正 + 允许混编」）──
   * ① **引用有效**：卡上每个编成条目的舰级必须登记在 `FOE_SHIPS` 表内（禁止内联随手造舰级）；
   * ② **族一致**：舰级 `family` 必须等于卡的 `foeFamily`；
   * ③ **声明一致**：卡面 `tactic` / `defProfile` / `dmgMix` 必须与"**主体单位**"一致
   *    （舰级路径下这三项是**卡面口径**，与舰级定义重复，故用契约锁死，防两边漂移）；
   *    **主体（prime）定义（2026-09-11 数值落地批改定）**：混编卡（如「头目舰 ×1 + 杂鱼 ×3」）
   *    的卡面**只能写一族**的血型与伤害构成，故 prime 取**单位数最多的非僚机条目** ——
   *    即编成的**数量主体**（例：头目 ×1 + 劫掠狙击舰 ×3 → prime = 劫掠狙击舰，
   *    卡面 `defProfile: 'shield'` / `dmgMix plasma8:kinetic2` 讲的就是它）。
   *    ⚠ 头目那份血量不随卡面血型走（`FoeShipSlot` 无 `split` 覆写位）——已知口径，见设计稿。
   * ④ **编成合法**：至少一条非僚机条目（要有主体）；
   * ⑤ **舰种档合法**（2026-09-11 追加裁决「劫掠护卫舰和劫掠狙击舰下落一档，只有头目是巡洋舰」）：
   *    每个敌舰级的 `hullClassTier` 必须落在 `1~5`；且**海盗族（family 'A'）不得登记 4 战列舰 / 5 旗舰档**；
   * ⑥ **A 族编成契约（2026-09-11 数值落地批加，船长确认）**：
   *    a) **编成必须是「头目舰 ×1 + 同族杂鱼 ×3」**（共 4 个单位，杂鱼同族同型）；
   *    b) **头目血量占比 = 60% ±1%**（按编成实算：`Σ(舰级血 × hpMul × 数量)`）。
   *    依据 = 船长 A 族设定「**鱼龙混杂 / 装备较差数值偏低 / 靠数量弥补 / 一个头目强大带一堆杂鱼 /
   *    速度都快**」——数量弥补所以要 3 艘杂鱼，头目强大所以头目独占 60% 血与 60% 名义火力。 */
  {
    const known = new Set(FOE_SHIPS.map((s) => s.id))
    /** 编成条目的**单位数**（`count` 缺省 1）——"数量主体"与 A 族编成契约共用同一口径 */
    const unitCount = (slot: { count?: number }): number => Math.max(1, Math.floor(slot.count ?? 1))
    /** 编成实算总血（舰级血 × hpMul × 数量） */
    const slotsHp = (slots: readonly { ship: { hp: number }; hpMul?: number; count?: number }[]): number =>
      slots.reduce((n, s) => n + s.ship.hp * (s.hpMul ?? 1) * unitCount(s), 0)
    // ⑤ 舰种档：先校验登记表全表（档位越界 / 各族**不配的档**）
    const PIRATE_BANNED_TIERS: readonly number[] = [4, 5] // 4 战列舰 / 5 旗舰
    /** **B 族（武装拾荒者）不得 ≥ 3 巡洋舰**（2026-09-11 船长七裁决：「**确认为新手过渡种族**」+
     *  拾荒者拿的是拼装小艇）⇒ 只登记 **T1 护卫舰 / T2 驱逐舰**两档 */
    const SCAV_BANNED_FROM_TIER = 3
    let tiered = 0
    for (const ship of FOE_SHIPS) {
      const t = ship.hullClassTier
      check(
        Number.isInteger(t) && t >= 1 && t <= 5,
        `舰级契约：舰级「${ship.name}」（${ship.id}）的舰种档 ${t} 越界（须落在 1~5：1 护卫舰 / 2 驱逐舰 / 3 巡洋舰 / 4 战列舰 / 5 旗舰）`,
      )
      if (ship.family === 'A') {
        check(
          !PIRATE_BANNED_TIERS.includes(t),
          `舰级契约：海盗族舰级「${ship.name}」（${ship.id}）登记了 ${HULL_CLASS_NAME[t as 1] ?? "未知档"}（T${t}）档——**海盗不配战列级（维护成本大，不符合海盗背景设定）**；海盗舰队只用 1 护卫舰 / 2 驱逐舰 / 3 巡洋舰三档（船长 2026-09-11：「海盗应该是护卫驱逐巡洋构成」）`,
        )
      }
      if (ship.family === 'B') {
        check(
          t < SCAV_BANNED_FROM_TIER,
          `舰级契约：拾荒族舰级「${ship.name}」（${ship.id}）登记了 ${HULL_CLASS_NAME[t as 1] ?? "未知档"}（T${t}）档——` +
            `**武装拾荒者不配 T3 及以上**：船长 2026-09-11 定「**确认为新手过渡种族**」，` +
            `拾荒者开的是拼装小艇 ⇒ 只登记 **1 护卫舰 / 2 驱逐舰两档**`,
        )
      }
      if (ship.family === 'C') {
        // **C 族（异形生物）舰种档**（船长 2026-09-11 裁定③：「**允许 T4 战列舰**（"生物巨兽"）」）：
        // ①允许 1~4 档（**不配 5 旗舰**——生物再大也是"巨兽"而非"旗舰"编队）；
        // ②**T4 必须登记为"巨兽"用途**（`ALIEN_BEAST_SHIP_IDS` 白名单）——目的是**防日后随手给杂鱼挂 T4**
        //   （把战列档当普通量产物用，等于把"巨兽"的意义抹平）。白名单是"显式登记"的代码化表达。
        check(
          t <= 4,
          `舰级契约：异形族舰级「${ship.name}」（${ship.id}）登记了 ${HULL_CLASS_NAME[t as 1] ?? "未知档"}（T${t}）档——` +
            `异形族只允许 1 护卫舰 ~ 4 战列舰（船长裁定③「**允许 T4 战列舰**（生物巨兽）」），**不配 5 旗舰**`,
        )
        if (t === 4) {
          check(
            ALIEN_BEAST_SHIP_IDS.includes(ship.id),
            `舰级契约：异形族舰级「${ship.name}」（${ship.id}）登记了 4 战列舰档却**未登记为"巨兽"用途**——` +
              `T4 是"**生物巨兽**"专档（船长 2026-09-11 裁定③），须显式登记在 \`ALIEN_BEAST_SHIP_IDS\`（packages/data/src/foe-ships.ts）；` +
              `目的是防日后随手给杂鱼挂 T4`,
          )
        }
      }
      tiered++
    }
    const normMix = (m?: Partial<Record<string, number>>): string =>
      Object.entries(m ?? {})
        .filter(([, w]) => (w ?? 0) > 0)
        .sort(([x], [y]) => x.localeCompare(y))
        .map(([k, w]) => `${k}:${w}`)
        .join(',')
    let shipCards = 0
    let slotTotal = 0
    let mixed = 0
    let aCompositionCards = 0
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
      // 主体 = 单位数最多的非僚机条目（数量相同时取先写的；见上方 ③ 的 prime 定义）
      const prime = mains.reduce<(typeof mains)[number] | undefined>(
        (best, x) => (best && unitCount(best) >= unitCount(x) ? best : x),
        undefined,
      )
      if (prime && def.tactic) {
        // 卡面战术是"这一场怎么打"的摘要；混编允许各主体用不同战术（如狙击头目 + 贴脸杂鱼），
        // 故契约只要求**卡面战术落在主体们的有效战术集合内**（有效 = 卡上覆写优先，2026-09-11 头目多战术）。
        const effTactics = new Set(mains.map((m) => m.tactic ?? m.ship.tactic))
        check(
          effTactics.has(def.tactic),
          `舰级契约：${def.name} 卡面战术 ${def.tactic} 不在主体编成的有效战术集合内 [${[...effTactics].join(" / ")}]`,
        )
      }
      // **血型 / 构成：逐条主体按「有效值」判定**（2026-09-11 船长裁决①「头目血型随卡片走」）——
      // 有效 split = 条目 `split` 覆写 ?? 舰级 `split`；卡面 `defProfile` / `dmgMix` 是**卡**的口径，
      // 必须对**每一条非僚机编成**都成立（否则"头目一份血在卡面描述之外"）。
      // ⚠ **A 族不做族级血型约束**（船长同日：海盗鱼龙混杂 ⇒ 什么血型都有），血型逐卡自定。
      // 想配异质编成时的正解 = 在条目里写覆写使其与卡面对齐，而不是让卡面失真。
      for (const slot of mains) {
        if (def.defProfile) {
          const want = foeLayerSplit(def.defProfile)
          const got = slot.split ?? slot.ship.split
          const via = slot.split ? '条目 `split` 覆写' : '沿用舰级 split'
          check(
            Math.abs(want.s - got.s) < 1e-9 && Math.abs(want.a - got.a) < 1e-9 && Math.abs(want.h - got.h) < 1e-9,
            `舰级契约：${def.name} 卡面血型 ${def.defProfile}（${want.s}/${want.a}/${want.h}）与编成条目「${slot.ship.name}」（${via}：${got.s}/${got.a}/${got.h}）不一致——` +
              `船长 2026-09-11：「**头目血型随卡片走**」；若该条目要配别的血型，请写 \`split\` 覆写使其与卡面对齐`,
          )
          check(
            Math.abs(got.s + got.a + got.h - 1) < 1e-9,
            `舰级契约：${def.name} 的编成条目「${slot.ship.name}」有效血型 Σ ≠ 1（${got.s}+${got.a}+${got.h}）——血型比例须归一`,
          )
        }
        if (def.dmgMix) {
          const eff = slot.dmgMix ?? slot.ship.dmgMix
          check(
            normMix(def.dmgMix) === normMix(eff),
            `舰级契约：${def.name} 卡面伤害构成（${normMix(def.dmgMix)}）与编成条目「${slot.ship.name}」有效构成（${normMix(eff)}）不一致`,
          )
        }
      }
      /* ⑥ **A 族编成契约**（2026-09-11 数值落地批 + 同日追加两条裁定）——两个分支：
       * **分支一 · 有头目**（灰霾/赤潮/蜃影）——依据「靠数量弥补」+「一个头目强大带一堆杂鱼」：
       *   a) 编成 = 头目 ×1 + 同族同型杂鱼 ×3（共 4 单位）；b) 头目血量占比 = 60% ±1%。
       * **分支二 · 无首领**（边境/碎晶/信标，船长 2026-09-11「**边境海盗前哨 / 碎晶带劫匪通缉 /
       *   信标猎手悬赏 都设定无首领**」）——**全队同族同型、无 elite 头目**，且按船长给定的**波次结构**：
       *   边境「**1+2**」（首波 1 艘 + 次波 2 艘 = 3 单位）、碎晶与信标「**2+2**」（每波 2 艘 = 4 单位），
       *   并要求登记 `anomaly.waves` 两波（引擎靠它切波；舰级路径的波次由 `slot.wave` 决定）。 */
      if (def.foeFamily === 'A') {
        /** A 族**无首领**三张卡（船长 2026-09-11 追加裁定）与其波次结构：边境「1+2」、碎晶/信标「2+2」 */
        const NO_BOSS_A_CARDS: Record<
          string,
          { units: number; wave0: number; wave1: number; shape: string }
        > = {
          'ano-pirate-post': { units: 3, wave0: 1, wave1: 2, shape: '1+2' },
          'ano-shard-bandits': { units: 4, wave0: 2, wave1: 2, shape: '2+2' },
          'ano-lantern-saboteurs': {
            units: 4,
            wave0: 2,
            wave1: 2,
            shape: '2+2',
          },
        }
        const totalUnits = ships.reduce((n, s) => n + unitCount(s), 0)
        const bosses = ships.filter((s) => s.ship.elite === true)
        const minions = ships.filter((s) => s.ship.elite !== true)
        const bossUnits = bosses.reduce((n, s) => n + unitCount(s), 0)
        const minionUnits = minions.reduce((n, s) => n + unitCount(s), 0)
        const minionTypes = new Set(minions.map((s) => s.ship.id))
        const waveUnits = (w: number): number =>
          ships
            .filter((s) => (s.wave ?? 0) === w)
            .reduce((n, s) => n + unitCount(s), 0)
        const noBoss = NO_BOSS_A_CARDS[def.id]
        if (noBoss) {
          check(
            bosses.length === 0 && bossUnits === 0,
            `舰级契约：A 族卡 ${def.name} 已按船长 2026-09-11 裁定「**设定无首领**」——编成里不得再有 elite 头目；` +
              `实际 elite 条目 ${bosses.length} 条 / ${bossUnits} 个单位`,
          )
          check(
            minionTypes.size === 1,
            `舰级契约：A 族卡 ${def.name}（无首领）应为**同族同型**编队（单一舰级）；实际 ${[...minionTypes].join(" / ")}`,
          )
          check(
            totalUnits === noBoss.units,
            `舰级契约：A 族卡 ${def.name} 的单位总数应为 **${noBoss.units}**（船长「**${noBoss.shape}**」），实际 ${totalUnits}`,
          )
          check(
            waveUnits(0) === noBoss.wave0 && waveUnits(1) === noBoss.wave1,
            `舰级契约：A 族卡 ${def.name} 的波次结构应为「**${noBoss.shape}**」（首波 ${noBoss.wave0} 艘 + 次波 ${noBoss.wave1} 艘，` +
              `用 slot.wave 的 0/1 表达）；实际 首波 ${waveUnits(0)} 艘 / 次波 ${waveUnits(1)} 艘`,
          )
          check(
            (def.waves?.length ?? 0) === 2,
            `舰级契约：A 族卡 ${def.name}（无首领 · ${noBoss.shape}）须登记 anomaly.waves **两波**（引擎据此切波），实际 ${def.waves?.length ?? 0} 波`,
          )
        } else {
          check(
            bosses.length === 1 && bossUnits === 1,
            `舰级契约：A 族卡 ${def.name} 的编成应为「**头目舰 ×1** + 杂鱼 ×3」——船长 2026-09-11 设定「**一个头目强大带一堆杂鱼**」；` +
              `实际头目条目 ${bosses.length} 条 / 头目单位 ${bossUnits} 个（头目 = 登记为 elite 的 A 族舰级）`,
          )
          check(
            minions.length === 1 && minionUnits === 3 && minionTypes.size === 1,
            `舰级契约：A 族卡 ${def.name} 的编成应为「头目舰 ×1 + **同族同型杂鱼 ×3**」——船长 2026-09-11 设定「**靠数量弥补**」；` +
              `实际杂鱼条目 ${minions.length} 条（${[...minionTypes].join(" / ")}）/ 杂鱼单位 ${minionUnits} 个（须为 3、且同一条目同型）`,
          )
          check(
            totalUnits === 4,
            `舰级契约：A 族卡 ${def.name} 编成单位总数应为 **4**（头目 ×1 + 杂鱼 ×3，多舰船补偿系数按 N=4 = 1.6 标定），实际 ${totalUnits}`,
          )
          const totalHp = slotsHp(ships)
          check(
            totalHp > 0,
            `舰级契约：A 族卡 ${def.name} 编成总血为 0（无法校验头目血占比）`,
          )
          const bossHp = slotsHp(bosses)
          const share = totalHp > 0 ? bossHp / totalHp : 0
          check(
            Math.abs(share - 0.6) <= 0.01,
            `舰级契约：A 族卡 ${def.name} 的**头目血量占比应为 60% ±1%**（按编成实算：Σ舰级血 × hpMul × 数量），实际 ` +
              `${(share * 100).toFixed(2)}%（头目 ${bossHp.toFixed(2)} / 总血 ${totalHp.toFixed(2)}）——` +
              `依据船长 2026-09-11 A 族设定：头目强大（独占 60% 血）、杂鱼靠数量弥补（各 40%÷3）`,
          )
        }
        aCompositionCards++
      }
    }
    console.log(
      `· 舰级契约：${shipCards} 张舰级路径卡（${slotTotal} 条编成，其中混编 ${mixed} 张）引用有效、族与卡面口径一致；` +
        `舰种档 ${tiered} 个舰级全部落在 1~5，海盗族（A）无 4 战列舰 / 5 旗舰档、拾荒族（B）无 T3 及以上（新手过渡族）、` +
        `异形族（C）允许 T4（须登记为"巨兽"用途：${ALIEN_BEAST_SHIP_IDS.join(" / ")}）且不配 T5；` +
        `A 族编成契约 ${aCompositionCards} 张：灰霾/赤潮/蜃影 = 头目 ×1 + 同族杂鱼 ×3（共 4 单位）· 头目血量 60% ±1%；` +
        `边境/碎晶/信标 = **无首领**（同族同型 + 船长给定波次 1+2 / 2+2 / 2+2）`,
    )
  }

  /* ── 增援机制未启用契约（2026-09-11 加）──
   * 船长裁决原文：「**先完成相应的系统机制，不使用。用作后续机制。**」
   * 口径：`BattleBalance.foeReinforceEnabled` **关闭期间，任何卡不得携带 `enterAt`**——
   * 让"未使用"这个状态**由代码守住**（而不是靠人记）：一旦有人在关着开关时给卡写 `enterAt`
   * （比如以为写了就生效），**内容体检立刻失败并说清依据**。
   * 启用流程 = 先开开关（`balance.foeReinforceEnabled = true`）再编成条目写 `enterAt`，
   * 同时按注释解除本契约并补实测（见 `docs/design/foe-reinforce-20260911.md`）。 */
  {
    const enabled = DEFAULT_BALANCE.battle.foeReinforceEnabled === true
    let carriers = 0
    const named: string[] = []
    for (const def of ANOMALIES_FLAVORED) {
      for (const slot of def.ships ?? []) {
        if (!slot.enterAt) continue
        carriers++
        named.push(def.name)
        check(
          enabled,
          `增援机制未启用契约：${def.name} 的编成条目携带了 \`enterAt\`，但总开关 \`foeReinforceEnabled\` 为 false——` +
            `**单波次内增援机制已实现、但按船长裁决不启用**` +
            `（船长 2026-09-11：「先完成相应的系统机制，不使用。用作后续机制。」）；` +
            `要启用请先打开总开关（core \`balance.ts\`），再同步解除本契约（tools/content-check.ts）并补实测`,
        )
      }
    }
    console.log(
      `· 增援机制未启用契约：总开关 **${enabled ? "开" : "关"}**，${carriers} 张卡携带 \`enterAt\`` +
        `${carriers > 0 ? `（${[...new Set(named)].join('、')}）` : ""}——` +
        `机制（三种触发 / 存档零迁移 / 距离重开）已实现并有用例覆盖，**按船长裁决不启用，留作后续机制**`,
    )
  }

  /* ── 族→战术契约（2026-09-11 加）──
   * 船长 2026-09-11 定 A 族性格「**鱼龙混杂，所以应该各个战术的敌人都有**」→ A 族三种战术全合法。
   * **B 族（武装拾荒者）**：船长 2026-09-11 七裁决「**战术性格统一为 orbit**」→ **只允许 orbit**。
   * 其余族正按字母顺序逐族商讨中，**只登记已裁定的族**，未登记 = 不校验（不预设、不猜）。 */
  {
    const FAMILY_TACTICS: Partial<Record<string, readonly string[]>> = {
      A: ['brawl', 'orbit', 'kite'], // 鱼龙混杂（船长 2026-09-11）
      B: ['orbit'], // 武装拾荒者·全族 orbit（船长 2026-09-11「战术性格统一为 orbit」）
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
          `族→战术契约：${def.name}（族 ${def.foeFamily}）用了战术 ${t}，超出该族已裁定的允许范围 [${allow.join(" / ")}]`,
        )
      }
    }
    console.log(
      `· 族→战术契约：${checked} 处族内战术声明均在已裁定范围内（**A 族 = 鱼龙混杂三战术全允许 / B 族 = 统一 orbit**；其余族未裁定、不校验）`,
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
      check(
        !isLairCandidate(def),
        `窝点契约：B 族已取消（2026-09-10 船长定），${def.name} 不得作为窝点候选`,
      )
      check(
        FOE_LAIR_GEAR.B.length === 0,
        `窝点契约：B 族专属装备应已撤下，实际 ${FOE_LAIR_GEAR.B.join("、")}`,
      )
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
    for (const n of names)
      check(
        n.trim().length > 0 && !n.endsWith('·'),
        `窝点契约：${def.name} 档位称呼为空（name=${n}）`,
      )
    check(
      new Set(names).size === 3,
      `窝点契约：${def.name} 三档称呼重复（${names.join(" / ")}）`,
    )
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
  /* ── 退役窝点卡契约（2026-09-11 船长「按方案 2 执行」）──
   * 背景：B 族两卡（新港商路护航令 / 占港武装通缉）的 `lairCore` **已退役删除**（B 族无窝点），
   * 但 `data/context.ts` 的稀有残骸注册改用显式白名单 `RETIRED_LAIR_CARD_IDS` 保住旧档兼容。
   * 本契约四条（防止白名单腐烂 / 防止字段被加回来 / 防止退役卡复活成窝点候选）：
   * ①白名单里的 id **必须真实存在于 ANOMALIES**（写错 id = 白名单形同虚设，旧档照样"未知物品"）；
   * ②这些卡 **`lairCore` 必须确实为空**（否则"退役"没落地，或后人把字段加回来）；
   * ③这些卡**必须仍被 `isLairCandidate()` 排除**（否则退役卡重新变成窝点候选、又派发起来）；
   * ④对应的**稀有残骸物品仍能被注册**（在 ctx.items 里）——这正是白名单存在的唯一目的。 */
  {
    let retiredChecked = 0
    for (const id of RETIRED_LAIR_CARD_IDS) {
      const def = ANOMALIES_FLAVORED.find((d) => d.id === id)
      check(!!def, `退役窝点卡契约：白名单 id「${id}」在 ANOMALIES 里不存在（写错 id ⇒ 旧档稀有残骸照样认不出）`)
      if (!def) continue
      retiredChecked += 1
      check(
        !hasLairCore(def),
        `退役窝点卡契约：${def.name}（${def.id}）的 lairCore 应为空——2026-09-11 船长裁决「B 族没有窝点、排除出赏金范围」，` +
          `字段退役后**不得加回来**（旧档兼容已由 RETIRED_LAIR_CARD_IDS 白名单承接）`,
      )
      check(
        !isLairCandidate(def),
        `退役窝点卡契约：${def.name}（${def.id}）仍是窝点候选（isLairCandidate 为真）——退役卡不得重新派发窝点`,
      )
      const rareId = rareWreckItemIdOf(def.id)
      check(
        lairCtx.items.has(rareId),
        `退役窝点卡契约：旧档稀有残骸 ${rareId} 未注册（data/context.ts 的注册条件须含 RETIRED_LAIR_CARD_IDS.has(a.id)）` +
          `——否则旧档里已有的这件的会显示成"未知物品"`,
      )
    }
    console.log(
      `· 退役窝点卡契约：${retiredChecked} 张退役卡字段已清、白名单有效、稀有残骸仍可识别` +
        `（${[...RETIRED_LAIR_CARD_IDS].map((id) => rareWreckItemIdOf(id)).join(" / ")}）`,
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

  /* ── 窝点派生契约（2026-09-11 加，船长裁决④「按甲处理」）──
   * 派生卡（`lairAnomalyOf`，tier 1/2/3）必须满足两条：
   * ① **每波单位数 ≥ 1**：旧路径的波表（`LAIR_WAVES`）按"每波几队"描述**旧路径**编队，
   *    而**舰级路径**的编队由 `slot.wave` 决定（**2026-09-11 起：边境/碎晶/信标 三张已按船长裁定
   *    显式分配 `wave: 0/1` 两波**，其余舰级路径卡仍在 `wave: 0`）⇒ 直接套用旧波表会让第 2/3 波
   *    **刷出 0 个单位**（探针实测）；舰级路径派生卡因此**不套旧波表**（按 `slot.wave` 接波），本例即守这件事——
   *    将来谁把波表接回舰级路径，这里立刻失败。
   * ② **派生后总血 / 总火力随 tier 单调不降、且不低于主题卡**：旧路径靠"威胁 → 血/火力曲线"自动变强；
   *    **舰级路径是绝对值、不会自己涨** ⇒ 派生时必须按「原威胁 → 派生威胁」的比例同乘 `hpMul`/`dmgMul`。
   *    （火力用"舰级单发 × dmgMul × 数量"作**单调性代理值**——不含命中/补偿，只比档位间强弱。）
   * 适用范围：② 只对**舰级路径**候选卡生效（旧路径由威胁曲线负责，天生随 tier 变强）。 */
  {
    /** 每波单位数：舰级路径数 `slot.wave`，旧路径读波表；无波表 = 单波 1 条 */
    const unitsInWave = (card: AnomalyDef, waveIdx: number): number => {
      const slots = card.ships
      if (slots && slots.length > 0) {
        return slots
          .filter((s) => (s.wave ?? 0) === waveIdx)
          .reduce((n, s) => n + Math.max(1, Math.floor(s.count ?? 1)), 0)
      }
      const w = card.waves?.[waveIdx]
      return w ? Math.max(0, Math.floor(w.units ?? 1)) : waveIdx === 0 ? 1 : 0
    }
    /** 舰级路径派生卡的**总血 / 火力代理值**（绝对值口径，不含命中与多舰补偿——只比档位单调） */
    const hpOf = (card: AnomalyDef): number =>
      (card.ships ?? []).reduce((n, s) => n + s.ship.hp * (s.hpMul ?? 1) * Math.max(1, Math.floor(s.count ?? 1)), 0)
    const powerOf = (card: AnomalyDef): number =>
      (card.ships ?? []).reduce(
        (n, s) => n + s.ship.shotDmg * (s.dmgMul ?? 1) * Math.max(1, Math.floor(s.count ?? 1)),
        0,
      )
    let waveChecked = 0
    let scaledCards = 0
    for (const def of ANOMALIES_FLAVORED) {
      if (!isLairCandidate(def)) continue
      const isShipPath = !!def.ships && def.ships.length > 0
      let prevHp = isShipPath ? hpOf(def) : 0
      let prevPower = isShipPath ? powerOf(def) : 0
      for (const tier of [1, 2, 3] as const) {
        const lair = lairAnomalyOf(def, tier)
        // ① 每波 ≥ 1 单位（波表没写 = 单波）
        const waveCount = Math.max(1, lair.waves?.length ?? 1)
        for (let w = 0; w < waveCount; w++) {
          const units = unitsInWave(lair, w)
          waveChecked++
          check(
            units >= 1,
            `窝点派生契约：${def.name} 的 ${tier} 档派生卡**第 ${w + 1} 波刷出 0 个单位**——` +
              `舰级路径的编队由 \`slot.wave\` 决定，套用旧路径波表（LAIR_WAVES）会刷空（探针实测）；` +
              `舰级路径的窝点应维持单波（或按 \`slot.wave\` 显式分配条目后再接波次）`,
          )
        }
        if (!isShipPath) continue
        // ② 总血 / 火力随 tier **严格递增**，且第一档就高于主题卡
        // （"单调不降"若按 ≥ 判定，把缩放整个摘掉也能过——负向验证要求"摘掉即报错"，故用严格递增）
        const hpNow = hpOf(lair)
        const powerNow = powerOf(lair)
        check(
          hpNow > prevHp + 1e-6,
          `窝点派生契约：${def.name} 的 ${tier} 档派生卡总血 ${hpNow.toFixed(1)} **未高于**上一档/主题卡 ${prevHp.toFixed(1)}——` +
            `舰级路径是绝对值、不会随威胁自动变强，派生时必须按「原威胁 → 派生威胁」的比例缩放 \`hpMul\`（船长 2026-09-11 裁决④「按甲处理」）`,
        )
        check(
          powerNow > prevPower + 1e-6,
          `窝点派生契约：${def.name} 的 ${tier} 档派生卡火力代理值 ${powerNow.toFixed(1)} **未高于**上一档/主题卡 ${prevPower.toFixed(1)}——同上（须同乘 \`dmgMul\`）`,
        )
        prevHp = hpNow
        prevPower = powerNow
      }
      if (isShipPath) scaledCards++
    }
    console.log(
      `· 窝点派生契约：${scaledCards} 张舰级路径候选卡的 tier1/2/3 派生卡**总血与火力代理值随档严格递增**（且首档高于主题卡）；` +
        `${waveChecked} 个波次全部 ≥ 1 单位（舰级路径派生卡**不套旧 LAIR_WAVES 波表**，波次按 slot.wave 表达）`,
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
    shown.push(`${def?.name ?? id}(rank${def?.rank ?? "?"}) +${per}/级`)
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
    `· AI 扩容技能契约：${ids.length} 个工业工位技能（${shown.join("、")}）→ 满级站内工位 = 共用 ${sharedCap} + 扩容 ${total} = ${sharedCap + total}`,
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
      `（${found.length > 0 ? found.join("、") : "无"}）`,
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
      `基准速度 ${([1, 2, 3, 4, 5] as const).map((t) => HULL_CLASS_BASE_SPEED[t]).join("/")}`,
  )
}

/* ── 通讯消息契约（2026-09-11 通讯系统）────────────────────────────────────────────
   体检口径：id 唯一、字段齐备、触发器字段可解析（星系/技能/站点必须真实存在）、
   跳转目标页合法（及其页面内标签）、玩家可见文案不含开发用词；
   剧本（DIALOGUES）侧只查主题与正文可用（它们也要进同一个收件箱）。
   2026-09-11 v2 扩展：发件方改为「势力 + 部门」引用，故新增
   **势力契约**（species 恒为章鱼人、部门 id 势力内唯一、立场合法、色调/图标有口径）
   与**发件方引用契约**（factionId/deptId 必须存在、kind 必须落在势力白名单、每个势力至少被引用一次）。 */
{
  const JUMP_PAGES = new Set(['map', 'ship', 'fit', 'items', 'market', 'industry', 'skills', 'comms'])
  const MAP_TABS = new Set(['star', 'mine', 'bounty', 'salvage', 'haul', 'task'])
  /** 舰船页内标签（`hint.shipTab`；与 App.tsx 的 ShipTab 同口径） */
  const SHIP_TABS = new Set(['fleet', 'fit', 'ai'])
  const TRIGGER_KINDS = new Set(['start', 'day', 'explored', 'galaxy', 'skill', 'isk', 'siteBuilt', 'tutorial'])
  const KINDS = new Set(['剧情', '提示', '委托', '教程'])
  const ALIGNMENTS = new Set(['官方', '民间', '中立', '系统'])
  /**
   * 既有线稿图标名（`apps/desktop/src/renderer/src/ui/Glyphs.tsx` 的 `GLYPHS` 表；
   * 势力 `glyph` 只能复用它们，不许自造图标名——界面查不到会渲染空白）。
   */
  const ICON_NAMES = new Set([
    'drone-rack', 'drone-tac', 'drone-relay', 'target-lock',
    'nav-map', 'nav-ship', 'nav-fit', 'nav-items', 'nav-market', 'nav-industry', 'nav-skills',
    'nav-mail', 'nav-mine', 'nav-bounty', 'nav-salvage', 'nav-task', 'nav-ai', 'nav-shop', 'nav-haul',
    // 官方章鱼人头像（2026-09-11 船长定：代表官方章鱼人；所有 NPC 势力共用，只靠色调区分）
    'faction-octopus',
    'ico-home', 'ico-lock', 'ico-clock', 'ico-loop', 'ico-flag', 'ico-star', 'ico-scan',
    'ico-swap', 'ico-cross', 'ico-crane', 'ico-antenna', 'ico-tact',
  ])
  /** 玩家可见文案禁用的开发/出戏用词（与词典「玩家可见文案禁用彩头/主题件/掉池」同口径，宽清单） */
  const BANNED = ['彩头', '主题件', '掉池', '基础池', '区划', '口径', '断言', '白名单', '体检', '待定', '占位', 'EVE', 'npm']
  /**
   * 世界观铁律（2026-09-11 船长定，`docs/design/npc-factions-20260911.md`）：
   * **对外（章鱼人 NPC）玩家是「飞行员」——他们不追问船里是谁**；**对内（船自己的系统）玩家知道自己就是舰载 AI**
   * （船长 2026-09-11：「外部认知中我们是飞行员，但内部系统中我们知道自己是舰载 AI」）。
   *
   * 判定方式：先按"玩家本质词"命中，再**豁免既有系统官方名**（`AI 核心`、`人工智能专家`、
   * `AI` + 中文的既有系统名，以及「舰载 AI」这一自我认知表述——它正是船内系统的正当说法）。
   * **豁免是按发件方分级的**：NPC 势力（官方/民间/中立）用完整豁免；
   * **船内系统（`alignment === '系统'`，如信息库）不吃「舰载 AI」豁免**——它本该知道玩家是什么。
   */
  const PLAYER_ESSENCE = ['AI', '智能', '旧时代', '人类']
  const LORE_EXEMPT = ['AI 核心', '人工智能']
  /**
   * `keepSelfKnowledge = true`（**仅船内系统来源**，如信息库）时额外豁免「舰载 AI / 船载 AI / 舰船 AI / 旧时代」——
   * 那是玩家自己的系统在说自己的事，正是船长定的"内部系统中我们知道自己是舰载 AI"
   * （`旧时代` 也在内：序章收尾台词「一艘不该存在的旧时代舰船 AI」本来就是船的自我认知）。
   * NPC 来源**不给**这条豁免：章鱼人不该知道船里是谁，写了就该被拦（先写反过一次，负向验证抓出来的）。
   */
  const SELF_KNOWLEDGE = /舰载\s*AI|船载\s*AI|舰船\s*AI|旧时代/g
  const loreHits = (text: string, opts?: { keepSelfKnowledge?: boolean }): string[] => {
    let masked = text
    for (const ex of LORE_EXEMPT) masked = masked.split(ex).join('□'.repeat(ex.length))
    // 既有系统名的其余写法（「AI 指挥中心」「AI 副船」等）：**连空格一起**吃掉；
    // 纯「AI」或「AI + 非中文」仍会命中（那才是把玩家当成 AI 说话的写法）。
    masked = masked.replace(/AI\s*(?=[\u4e00-\u9fa5])/g, '□□')
    if (opts?.keepSelfKnowledge) masked = masked.replace(SELF_KNOWLEDGE, '□□□')
    return PLAYER_ESSENCE.filter((w) => masked.includes(w))
  }
  /** 玩家与船不可分离（玩家就是那条船）：直接查说法，不做豁免 */
  const LORE_SPLIT = ['你的舰船']
  const galaxyIds = new Set(GALAXIES.map((g) => g.id))
  const skillIds = new Set(SKILLS.map((s) => s.id))
  const siteIds = new Set(STATION_SITES.map((s) => s.id))

  /* ① 势力契约（NPC 势力档案本身） */
  const factionIds = new Set<string>()
  const deptKeys = new Set<string>()
  for (const f of COMMS_FACTIONS) {
    check(f.id.trim().length > 0 && !factionIds.has(f.id), `势力 id 重复或为空：${f.id}`)
    factionIds.add(f.id)
    check(f.name.trim().length > 0, `势力 ${f.id} 缺名称`)
    // 铁律：所有 **NPC** 势力都是章鱼人（防设定漂移）；船内系统（alignment = 系统）不是 NPC，无物种要求
    const isSystem = f.alignment === '系统'
    check(
      isSystem ? f.species.trim().length > 0 : f.species === '章鱼人',
      isSystem ? `系统来源 ${f.id} 缺物种标注` : `势力 ${f.id} 的物种必须是章鱼人（世界观铁律），实际：${f.species}`,
    )
    check(ALIGNMENTS.has(f.alignment), `势力 ${f.id} 立场非法：${f.alignment}`)
    check(/^#[0-9a-fA-F]{6}$/.test(f.tone), `势力 ${f.id} 色调不是六位十六进制：${f.tone}`)
    check(ICON_NAMES.has(f.glyph), `势力 ${f.id} 图标不在既有线稿图标表内：${f.glyph}`)
    // 头像口径（2026-09-11 船长：「头像换成类似核心的SVG」⇒ 按发件方分两种头像）：
    // 船内系统 → 核心形图标；NPC 势力 → 官方章鱼头。写别的图标会打破"一个符号代表一类发件方"的口径。
    const wantAvatar = FACTION_AVATARS[f.id] ?? 'faction-octopus'
    check(
      f.glyph === wantAvatar,
      `势力 ${f.id} 的头像应为 ${wantAvatar}（${isSystem ? "船内系统用核心形图标" : "NPC 用官方章鱼头"}），实际：${f.glyph}`,
    )
    check(
      f.brief.trim().length > 0,
      `势力 ${f.id} 缺简介（界面「这是谁」说明）`,
    )
    check(f.kinds.length > 0, `势力 ${f.id} 没有可发内容类型白名单`)
    for (const k of f.kinds) check(KINDS.has(k), `势力 ${f.id} 白名单里的内容类型非法：${k}`)
    check(f.departments.length > 0, `势力 ${f.id} 没有部门（发件人写法的后半截）`)
    const deptIds = new Set<string>()
    for (const d of f.departments) {
      check(d.id.trim().length > 0 && !deptIds.has(d.id), `势力 ${f.id} 的部门 id 重复或为空：${d.id}`)
      deptIds.add(d.id)
      deptKeys.add(`${f.id}/${d.id}`)
      check(d.name.trim().length > 0, `势力 ${f.id} 部门 ${d.id} 缺名称`)
      check(d.brief.trim().length > 0, `势力 ${f.id} 部门 ${d.id} 缺简介`)
      check(d.kinds.length > 0, `势力 ${f.id} 部门 ${d.id} 没有可发内容类型白名单`)
      for (const k of d.kinds) {
        check(KINDS.has(k), `势力 ${f.id} 部门 ${d.id} 白名单里的内容类型非法：${k}`)
        check(f.kinds.includes(k), `势力 ${f.id} 部门 ${d.id} 白名单「${k}」超出势力白名单`)
      }
    }
  }

  /* ② 发件方引用契约（消息 + 剧本都必须挂靠到真实势力/部门） */
  const referenced = new Set<string>()
  const seen = new Set<string>()
  let hints = 0
  for (const m of COMMS_MESSAGES) {
    check(m.id.length > 0 && !seen.has(m.id), `通讯消息 id 重复或为空：${m.id}`)
    seen.add(m.id)
    check(m.subject.trim().length > 0, `通讯 ${m.id} 缺主题`)
    check(m.body.length > 0 && m.body.every((p) => p.trim().length > 0), `通讯 ${m.id} 正文为空段`)
    // 发件方：势力必须存在；有部门则部门必须在**该势力**下存在；kind 必须落在两级白名单里
    const faction = COMMS_FACTIONS.find((f) => f.id === m.factionId)
    check(faction !== undefined, `通讯 ${m.id} 的发件势力不存在：${m.factionId}`)
    check(KINDS.has(m.kind), `通讯 ${m.id} 内容类型非法：${m.kind}`)
    if (faction) {
      referenced.add(faction.id)
      check(faction.kinds.includes(m.kind), `通讯 ${m.id} 的内容类型「${m.kind}」不在势力 ${faction.id} 白名单内`)
      if (m.deptId !== undefined) {
        const dept = faction.departments.find((d) => d.id === m.deptId)
        check(dept !== undefined, `通讯 ${m.id} 的发件部门不在势力 ${faction.id} 下：${m.deptId}`)
        if (dept) check(dept.kinds.includes(m.kind), `通讯 ${m.id} 的内容类型「${m.kind}」不在部门 ${m.deptId} 白名单内`)
      }
    }
    check(TRIGGER_KINDS.has(m.trigger.kind), `通讯 ${m.id} 触发器 kind 未知：${m.trigger.kind}`)
    switch (m.trigger.kind) {
      case 'day':
        check(Number.isInteger(m.trigger.days) && m.trigger.days >= 1, `通讯 ${m.id} day.days 应为 ≥1 整数`)
        break
      case 'explored':
        check(Number.isInteger(m.trigger.count) && m.trigger.count >= 1, `通讯 ${m.id} explored.count 应为 ≥1 整数`)
        break
      case 'galaxy':
        check(galaxyIds.has(m.trigger.galaxyId), `通讯 ${m.id} 指向的星系不存在：${m.trigger.galaxyId}`)
        break
      case 'skill':
        check(skillIds.has(m.trigger.skillId), `通讯 ${m.id} 指向的技能不存在：${m.trigger.skillId}`)
        check(Number.isInteger(m.trigger.level) && m.trigger.level >= 1, `通讯 ${m.id} skill.level 应为 ≥1 整数`)
        break
      case 'isk':
        check(m.trigger.amount > 0, `通讯 ${m.id} isk.amount 应为正数`)
        break
      case 'siteBuilt':
        check(siteIds.has(m.trigger.siteId), `通讯 ${m.id} 指向的建站点不存在：${m.trigger.siteId}`)
        break
      case 'tutorial':
        // 教程通讯：0 = 序章简报（信息库检索重启），1..TUTORIAL_TOTAL = 七步教程（与 core 的 ONB_* 同值）
        check(
          Number.isInteger(m.trigger.step) && m.trigger.step >= 0 && m.trigger.step <= TUTORIAL_TOTAL,
          `通讯 ${m.id} tutorial.step 应在 0..${TUTORIAL_TOTAL}：${m.trigger.step}`,
        )
        break
      default:
        break
    }
    if (m.hint) {
      hints++
      check(JUMP_PAGES.has(m.hint.page), `通讯 ${m.id} 跳转目标页非法：${m.hint.page}`)
      check(m.hint.text.trim().length > 0, `通讯 ${m.id} 跳转提示为空`)
      if (m.hint.tab !== undefined) {
        check(m.hint.page === 'map', `通讯 ${m.id} 只有星图页支持标签跳转，实际页：${m.hint.page}`)
        check(MAP_TABS.has(m.hint.tab), `通讯 ${m.id} 星图标签非法：${m.hint.tab}`)
      }
      if (m.hint.shipTab !== undefined) {
        check(m.hint.page === 'ship', `通讯 ${m.id} 只有舰船页支持标签跳转，实际页：${m.hint.page}`)
        check(SHIP_TABS.has(m.hint.shipTab), `通讯 ${m.id} 舰船标签非法：${m.hint.shipTab}`)
      }
    }
    for (const p of [m.subject, ...m.body, ...(m.hint ? [m.hint.text] : [])]) {
      for (const w of BANNED) {
        check(!p.includes(w), `通讯 ${m.id} 的玩家可见文案含开发用词「${w}」：${p.slice(0, 24)}…`)
      }
      // 船内系统（信息库）= 玩家自己的系统，可以直说「舰载 AI」这类自我认知；NPC 文案不许（见 loreHits 注释）
      for (const w of loreHits(p, { keepSelfKnowledge: faction?.alignment === '系统' })) {
        check(false, `通讯 ${m.id} 的文案触碰世界观铁律「${w}」（章鱼人不追问船里是谁）：${p.slice(0, 24)}…`)
      }
      for (const w of LORE_SPLIT) {
        check(!p.includes(w), `通讯 ${m.id} 的文案把玩家与船分开说「${w}」（玩家就是那条船）：${p.slice(0, 24)}…`)
      }
    }
  }
  for (const d of DIALOGUES) {
    check(d.lines.length > 0, `通讯剧本 ${d.id} 没有台词`)
    check(d.title.trim().length > 0, `通讯剧本 ${d.id} 缺标题（收件箱发件人栏）`)
    for (const w of LORE_SPLIT) {
      check(!d.title.includes(w), `通讯剧本 ${d.id} 标题把玩家与船分开说「${w}」`)
    }
    // 剧本可挂靠势力（挂靠后收件箱里与数据消息同口径）；挂了就必须真实存在
    if (d.commsFactionId !== undefined) {
      const faction = COMMS_FACTIONS.find((f) => f.id === d.commsFactionId)
      check(faction !== undefined, `通讯剧本 ${d.id} 的挂靠势力不存在：${d.commsFactionId}`)
      if (faction) {
        referenced.add(faction.id)
        if (d.commsDeptId !== undefined) {
          const dept = faction.departments.find((x) => x.id === d.commsDeptId)
          check(dept !== undefined, `通讯剧本 ${d.id} 的挂靠部门不在势力 ${faction.id} 下：${d.commsDeptId}`)
        }
      }
    } else {
      check(d.commsDeptId === undefined, `通讯剧本 ${d.id} 有挂靠部门却没有挂靠势力`)
    }
    for (const line of d.lines) {
      for (const w of loreHits(line.text)) {
        check(false, `通讯剧本 ${d.id} 的台词触碰世界观铁律「${w}」：${line.text.slice(0, 24)}…`)
      }
      for (const w of LORE_SPLIT) {
        check(!line.text.includes(w), `通讯剧本 ${d.id} 的台词把玩家与船分开说「${w}」：${line.text.slice(0, 24)}…`)
      }
    }
  }
  // 每个势力至少被引用一次（登记了却没人发消息 = 空档案，容易被遗忘）
  for (const f of COMMS_FACTIONS) {
    check(referenced.has(f.id), `势力 ${f.id}（${f.name}）已登记但没有任何消息或剧本引用它`)
  }
  console.log(
    `· 通讯消息契约：${COMMS_MESSAGES.length} 条消息（${hints} 条带跳转提示）+ ${DIALOGUES.length} 份剧本，` +
      `触发器与跳转目标全部可解析；势力档案 ${COMMS_FACTIONS.length} 个（${COMMS_FACTIONS.map((f) => `${f.name}·${f.departments.length} 部门`).join(" / ")}），` +
      `发件方引用与内容类型白名单全通过`,
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
