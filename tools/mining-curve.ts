/**
 * **采矿收益曲线体检**（正式工具 · 2026-09-30 建 · 把前几轮"临时探针"的读数一次收口）。
 *
 * 回答四件事，四轴可任意组合：
 * 1. **船 × 配置**：每条矿带上，哪艘船、装什么，每小时挣多少（逐带取 **CPU 合法配置里的最优**）；
 * 2. **建站前后**：起点 = 母港，还是「母港 / 已建成副站」里**最近**的那个
 *    （与引擎真实路径同源：`location.nearestStationGalaxyId`，采矿推进三处都走它）；
 * 3. **燃料开关**：1 单位抵 1 秒「满载返航」、返航 ÷10；净收益 = 毛收益 − 燃料成本（自产/市场两档单价）；
 * 4. **技能档**：`full`（全技能 5）与 `mine`（只点采矿两条 —— 当年 A3 表的技能侧口径）。
 *
 * 口径（全部走引擎单点，逐条注明）：
 * - 一趟 = **空船去程** `oneOutboundLegMs`（= 满载返航单程 ÷2）＋ **挖满整舱**（货舱 m³ ÷ 采集 m³/时）
 *   ＋ **满载返航** `oneLegMs`（含 `cargoHoldRatio` 缩放）；
 * - 收益 = 整舱货值 ÷ 一趟 × 3600；单 m³ 价值 = 矿石 `baseSellPriceIsk` ÷ `unitM3`；
 * - 采集 = `getMiningParams`（舰船循环 × 采矿技能 × 多矿枪加成求和），货舱 = `cargoCapacityM3Of`
 *   （多件**加算** × 深空物流学/货舱管理学）；
 * - **CPU 合法性**：件 `cpuUse` 求和 ≤ 舰船 `cpu`（MK3 = 40 · MK2 = 15 · MK1 = 5 · 民用 = 3）；
 * - **燃料成本**：自产 = 实验室一批（600 单位）的原料按矿物基准价折算（**77.57 ISK/单位**）；
 *   市场 = `marketCatalog` 的 `jump-fuel` 基准价（**120 ISK/单位**）。消耗 = `ceil(满载返航秒)`。
 *
 * 用法：
 *   npm run mining:curve                      # 默认：两艘矿船 × 满技能 × 未建站 × 不用燃料
 *   npm run mining:curve -- --skills=mine     # 只点采矿两条技能（旧 A3 口径）
 *   npm run mining:curve -- --stations=built  # 两座副站按"已建成"算
 *   npm run mining:curve -- --fuel=on         # 叠燃料（自产 / 市场两档都印）
 *   npm run mining:curve -- --ships=whale-king,sh-humpback,sh-colossal
 *
 * ⚠ 本工具只读数据 + 现算，不改任何状态；读数留档到 `docs/design/` 的工作文档里。
 */
import { buildSimContext } from '@whale/data'
import {
  addShipToFleet,
  cargoCapacityM3Of,
  createInitialState,
  getMiningParams,
  oneLegMs,
  oneOutboundLegMs,
  shortestTravelMinutes,
  HOME_GALAXY_ID,
} from '@whale/core'
import type { GameState, SimContext } from '@whale/core'

/** 默认体检的船（鲸王 / 座头鲸 = 当前唯一两条工业矿舰；可用 `--ships=` 覆写） */
const DEFAULT_SHIPS = ['whale-king', 'sh-humpback'] as const

/** 件 CPU（与 `packages/data/src/modules.ts` 的 `cpuUse` 同值；工具侧只用于**配置枚举**的合法性预筛） */
const MOD_CPU: Readonly<Record<string, number>> = {
  'mod-miner-1': 5,
  'mod-miner-2': 15,
  'mod-miner-3': 40,
  'mod-cargo-1': 5,
  'mod-cargo-2': 15,
  'mod-cargo-3': 40,
}
const MINERS = ['mod-miner-3', 'mod-miner-2', 'mod-miner-1'] as const
const CARGOS = ['mod-cargo-3', 'mod-cargo-2', 'mod-cargo-1'] as const

/** 燃料单价：自产（一批 600 单位的原料按基准价折算）与市场基准价 */
const FUEL_ISK = { lab: 46_540 / 600, market: 120 } as const

interface Build {
  miners: readonly string[]
  cargos: readonly string[]
  cpu: number
}
interface Reading {
  build: Build
  hold: number
  rateM3H: number
  mineS: number
  outS: number
  backS: number
  tripS: number
  iskH: number
}

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

/** 按"每种件最多几件"枚举 CPU 合法的配置（件数受槽位数限制；只保留"份数谱系"上不劣的组合） */
function buildsOf(ship: { slots?: { high: number; low: number }; cpu?: number }): Build[] {
  const high = ship.slots?.high ?? 0
  const low = ship.slots?.low ?? 0
  const cpuCap = ship.cpu ?? 0
  const out: Build[] = []
  const combos = (ids: readonly string[], cap: number): string[][] => {
    const res: string[][] = []
    const walk = (i: number, left: number, acc: string[]): void => {
      if (i === ids.length) {
        if (acc.length > 0) res.push([...acc])
        return
      }
      for (let k = 0; k <= left; k++) walk(i + 1, left - k, k > 0 ? [...acc, ...Array(k).fill(ids[i]!)] : acc)
    }
    walk(0, cap, [])
    return res
  }
  for (const miners of combos(MINERS, high)) {
    for (const cargos of combos(CARGOS, low)) {
      const cpu = [...miners, ...cargos].reduce((s, m) => s + (MOD_CPU[m] ?? 0), 0)
      if (cpu > cpuCap) continue
      out.push({ miners, cargos, cpu })
    }
  }
  return out
}

/** 一条矿带 × 一艘船 × 一套配置 ⇒ 读数（`origin` / `fuel` 由调用方决定） */
function read(
  state: GameState,
  ctx: SimContext,
  shipId: string,
  build: Build,
  beltId: string,
  origin: string | null,
): Reading | null {
  const id = addShipToFleet(state, shipId)
  state.fleet[id]!.fitted = { high: [...build.miners], mid: [], low: [...build.cargos] } as never
  state.shipId = id
  const belt = ctx.belts.get(beltId)
  if (!belt) return null
  const params = getMiningParams(state, ctx, { shipId: id, beltId })
  const ore = ctx.items.get(belt.oreId)
  if (!params || !ore) return null
  const hold = cargoCapacityM3Of(state, ctx, id)
  const rateM3H = ((params.unitsPerCycle * (ore.unitM3 ?? 1)) / params.cycleMs) * 3_600_000
  const mineS = (hold / rateM3H) * 3600
  const outS = oneOutboundLegMs(state, ctx, beltId, id, origin) / 1000
  const backS = oneLegMs(state, ctx, beltId, id, origin) / 1000
  const tripS = outS + mineS + backS
  const iskH = (hold * ((ore.baseSellPriceIsk ?? 0) / (ore.unitM3 ?? 1)) * 3600) / tripS
  state.fleet[id]!.fitted = { high: [], mid: [], low: [] } as never
  return { build, hold, rateM3H, mineS, outS, backS, tripS, iskH }
}

const label = (b: Build): string => {
  const cnt = (ids: readonly string[]): string => {
    const m = new Map<string, number>()
    for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1)
    return [...m.entries()].map(([id, n]) => `${n}×${id.replace('mod-', '')}`).join('+')
  }
  return [b.miners.length > 0 ? cnt(b.miners) : '—', b.cargos.length > 0 ? cnt(b.cargos) : '—'].join(' / ')
}

function main(): void {
  const ctx = buildSimContext()
  const shipIds = arg('ships', DEFAULT_SHIPS.join(',')).split(',').map((s) => s.trim()).filter(Boolean)
  const skills = arg('skills', 'full')
  const stations = arg('stations', 'none')
  const fuel = arg('fuel', 'off') === 'on'

  const state = createInitialState({ nowWallMs: 0, seed: 1 })
  if (skills === 'full') {
    for (const s of ctx.skills.values()) state.skills.trained[s.id] = 5
  } else {
    const bal = ctx.balance.mining
    state.skills.trained[bal.timeSkillId] = 5
    state.skills.trained[bal.yieldSkillId] = 5
  }
  if (stations === 'built') {
    for (const site of ctx.stations.values()) {
      state.stationSites[site.id] = { stage: site.tiers.length, paid: [] } as never
    }
  }
  const builtStations = [...ctx.stations.values()].filter((s) => {
    const p = state.stationSites[s.id]
    return p && p.stage >= s.tiers.length
  })

  console.log('══ 采矿收益曲线体检 ══')
  console.log(
    `口径：一趟 = 空船去程 ＋ 挖满整舱 ＋ 满载返航；收益 = 整舱货值 ÷ 一趟 × 3600 | ` +
      `技能档 ${skills} | 站点 ${stations === 'built' ? `已建成副站 ${builtStations.length} 座（起点取最近站）` : '未建站（起点 = 母港）'} | 燃料 ${fuel ? '开' : '关'}`,
  )
  console.log(
    `船：${shipIds.map((id) => `${ctx.ships.get(id)?.name ?? id}（CPU ${ctx.ships.get(id)?.cpu ?? '?'} · 槽 ${ctx.ships.get(id)?.slots.high}/${ctx.ships.get(id)?.slots.mid}/${ctx.ships.get(id)?.slots.low}）`).join(' · ')}`,
  )
  console.log(`燃料单价：自产 ${FUEL_ISK.lab.toFixed(2)} ISK/单位 · 市场 ${FUEL_ISK.market} ISK/单位（消耗 = ceil(满载返航秒)）`)

  const belts = [...ctx.belts.values()]
    .map((b) => {
      const belt = b
      const gal = belt.galaxyId
      const origin = stations === 'built' ? nearest(state, ctx, gal) : null
      const out = oneOutboundLegMs(state, ctx, belt.id, shipIds[0], origin) / 1000
      return { belt, gal, out }
    })
    .sort((a, b) => a.out - b.out)

  const bestByShip = new Map<string, number[]>()
  for (const shipId of shipIds) {
    const ship = ctx.ships.get(shipId)
    if (!ship) continue
    const builds = buildsOf(ship)
    console.log(`\n── ${ship.name}（CPU ${ship.cpu} · 合法配置 ${builds.length} 套）──`)
    console.log(
      '矿带 / 星系 | 单程 | 最优配置（高 / 低）| CPU | 货舱 m³ | 采集 m³/时 | 一趟 | 航程占比 | ISK/时 | 相对首行' +
        (fuel ? ' | 燃料/趟 | 燃料成本/时 | 燃料净 ISK/时 | 盈亏平衡单价' : ''),
    )
    const list: number[] = []
    let first = 0
    for (const { belt, gal } of belts) {
      const origin = stations === 'built' ? nearest(state, ctx, gal) : null
      let best: Reading | null = null
      for (const build of builds) {
        const r = read(state, ctx, shipId, build, belt.id, origin)
        if (r && (!best || r.iskH > best.iskH)) best = r
      }
      if (!best) continue
      list.push(best.iskH)
      if (first === 0) first = best.iskH
      const oreName = ctx.items.get(belt.oreId)?.name ?? belt.oreId
      const base =
        `${oreName} / ${ctx.galaxies.get(gal)?.name ?? gal} | ${(best.outS / 60).toFixed(1)} 分 | ${label(best.build)} | ${best.build.cpu} | ` +
        `${Math.round(best.hold).toLocaleString('zh-CN')} | ${Math.round(best.rateM3H).toLocaleString('zh-CN')} | ${(best.tripS / 60).toFixed(1)} 分 | ` +
        `${(((best.outS + best.backS) / best.tripS) * 100).toFixed(0)}% | ${Math.round(best.iskH).toLocaleString('zh-CN')} | ×${(best.iskH / first).toFixed(2)}`
      if (!fuel) {
        console.log(base)
        continue
      }
      const backS = best.backS
      const units = Math.ceil(backS)
      const tripFuelS = best.outS + best.mineS + backS / 10
      const gross = (best.hold * ((ctx.items.get(belt.oreId)?.baseSellPriceIsk ?? 0) / (ctx.items.get(belt.oreId)?.unitM3 ?? 1)) * 3600) / tripFuelS
      const fuelPerH = units * (3600 / tripFuelS)
      const netLab = gross - fuelPerH * FUEL_ISK.lab
      const netMkt = gross - fuelPerH * FUEL_ISK.market
      const be = (gross - best.iskH) / fuelPerH
      console.log(
        `${base} | ${units.toLocaleString('zh-CN')} | ${Math.round(fuelPerH * FUEL_ISK.lab).toLocaleString('zh-CN')} | ${Math.round(netLab).toLocaleString('zh-CN')} | ${be.toFixed(0)}（市场买净 ${Math.round(netMkt).toLocaleString('zh-CN')}）`,
      )
    }
    console.log('')
    bestByShip.set(shipId, list)
    if (list.length > 1) {
      console.log(
        `  ⇒ 近端 ${Math.round(list[0]!).toLocaleString('zh-CN')} → 最远端 ${Math.round(list[list.length - 1]!).toLocaleString('zh-CN')} = ` +
          `${((list[list.length - 1]! / list[0]!) * 100).toFixed(1)}%（${list.length} 条带）`,
      )
    }
  }
  if (shipIds.length > 1) {
    console.log('\n── 逐带对照（各船取自己的最优配置）──')
    const a = shipIds[0]!
    const b = shipIds[1]!
    const la = bestByShip.get(a) ?? []
    const lb = bestByShip.get(b) ?? []
    console.log(`${ctx.ships.get(a)?.name} vs ${ctx.ships.get(b)?.name}：`)
    for (let i = 0; i < Math.min(la.length, lb.length); i++) {
      console.log(`  第 ${i + 1} 带：${Math.round(la[i]!).toLocaleString('zh-CN')} vs ${Math.round(lb[i]!).toLocaleString('zh-CN')} ⇒ ×${(lb[i]! / la[i]!).toFixed(2)}`)
    }
  }
}

/** 起点 = 「母港 / 已建成副站」里航程最近的那个（与 `location.nearestStationGalaxyId` 同口径的最小实现） */
function nearest(state: GameState, ctx: SimContext, galaxyId: string): string {
  let best = HOME_GALAXY_ID
  let bestMin = Number.isFinite(shortestTravelMinutes(ctx, galaxyId, HOME_GALAXY_ID))
    ? shortestTravelMinutes(ctx, galaxyId, HOME_GALAXY_ID)
    : Number.POSITIVE_INFINITY
  for (const site of ctx.stations.values()) {
    const p = state.stationSites[site.id]
    if (!p || p.stage < site.tiers.length) continue
    const m = shortestTravelMinutes(ctx, galaxyId, site.galaxyId)
    if (Number.isFinite(m) && m < bestMin) {
      bestMin = m
      best = site.galaxyId
    }
  }
  return best
}

main()
