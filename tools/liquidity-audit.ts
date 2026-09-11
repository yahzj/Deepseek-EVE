/**
 * 市场流通性体检（2026-09-10 船长：「市场流通性还是较差，建议根据玩家对物品的生产能力调整市场的物品池」；
 * 原临时探针 `_probe-liquidity.ts` 按工具纪律**转正入库**，探针已删）。
 *
 * 用途：把「玩家产能」与「市场池吸收能力」摆在同一张表上——覆盖比 = 池日吸收 ÷ 基准日产，
 * **< 1 即"采了/炼了卖不掉"**；并给出按**单价分层覆盖比**算出的建议池参数（poolTarget + supplyFlow），
 * 供日后改产率 / 船型 / 价格 / 池子后复跑核对。
 *
 * 运行：npx tsx tools/liquidity-audit.ts（等价 `npm run liquidity:audit`）
 *
 * 口径：
 * - **采矿侧基准 = 掘洞级采矿艇 + 满采矿技能 + 2×强化采集器 MK1**（船长 2026-09-10 指定：中期配置，
 *   不是座头鲸满配）；产率走引擎真函数 `getMiningParams`（循环时长 × 每循环产量），
 *   对照列另给裸船 / 满技能 / 座头鲸满配；
 * - 满技能 = 采矿技术 / 星质地质学 / 深井爆破学 / 深空采集学 / 采矿舰操作 各 5 级；
 * - **矿物侧基准 = 主控精炼炉满技能**：批 = `refineBatchUnits`、周期 = `refineCycleMs`、
 *   高级回收满级批量 ×1.3、精炼产出倍率满级 1.65；每种矿物取"件/时产出最高"的那支矿作参照；
 * - 市场侧：池商品按 `supplyFlow`（缺省 poolTarget/120）每 60 秒窗补单 ⇒ **日吸收 = flow × 1440**；
 * - 分层覆盖比（2026-09-10 船长定）：单价 ≤20 → ×15（大宗）／≤200 → ×6（中阶）／≤400 → ×3（高阶）／>400 → ×2（顶级）；
 * - 复合矿带只按主产物（`belt.oreId`）计，不拆权重池。
 */
import { addShipToFleet, createInitialState, getMiningParams } from '@whale/core'
import { buildSimContext } from '@whale/data'
import { advanceBattleFor, startBattleFor, waveGapTotalMs } from '../packages/core/src/combat'

const ctx = buildSimContext()
const SHIP = 'burrower' // 掘洞级采矿艇（船长指定基准：MK1 采集器 ×2，高槽 2 / CPU 90）
const SKILLS = ['mining', 'astro-geology', 'deep-hole-blasting', 'deep-space-harvesting', 'industrial-ops']
const fmt = (n: number): string => Math.round(n).toLocaleString('zh-CN')

function makeState(withSkills: boolean, guns: string[]): ReturnType<typeof createInitialState> {
  const state = createInitialState({ nowWallMs: 0, seed: 1 })
  const uid = addShipToFleet(state, SHIP)
  state.shipId = uid
  const entry = state.fleet[uid]!
  entry.fitted = {
    high: [...guns, null, null].slice(0, 2) as (string | null)[],
    mid: [null, null],
    low: [null],
  }
  if (withSkills) for (const s of SKILLS) state.skills.trained[s] = 5
  return state
}

const HP = ((): ReturnType<typeof createInitialState> => {
  const s = createInitialState({ nowWallMs: 0, seed: 1 })
  const uid = addShipToFleet(s, 'sh-humpback')
  s.shipId = uid
  s.fleet[uid]!.fitted = {
    high: ['mod-miner-3', 'mod-miner-3', 'mod-miner-3'],
    mid: [null, null],
    low: [null, null, null],
  }
  for (const k of SKILLS) s.skills.trained[k] = 5
  return s
})()

const CONFIGS: Array<{ label: string; state: ReturnType<typeof createInitialState>; ship: string }> = [
  { label: '掘洞裸船', state: makeState(false, []), ship: SHIP },
  { label: '掘洞满技能', state: makeState(true, []), ship: SHIP },
  { label: '掘洞满技能+2×MK1', state: makeState(true, ['mod-miner-1', 'mod-miner-1']), ship: SHIP },
  { label: '（参考）座头鲸满配', state: HP, ship: 'sh-humpback' },
]

type Row = { belt: string; ore: string; price: number; perHour: number; perDay: number; absorbDay: number; cover: number }
const rows: Row[] = []
for (const belt of ctx.belts.values()) {
  const best = CONFIGS[2]! // 基准 = 掘洞满技能 + 2×MK1
  const p = getMiningParams(best.state, ctx, { shipId: SHIP, beltId: belt.id })
  if (!p) continue
  const perHour = (p.unitsPerCycle * 3_600_000) / p.cycleMs
  const good = ctx.marketGoods.get(belt.oreId)
  const poolTarget = good?.poolTarget ?? 0
  if (poolTarget <= 0) continue
  const flow = good?.supplyFlow ?? Math.max(1, Math.round(poolTarget / 120))
  rows.push({
    belt: belt.name ?? belt.id,
    ore: p.ore.name,
    price: p.ore.baseSellPriceIsk ?? 0,
    perHour,
    perDay: perHour * 24,
    absorbDay: flow * 1440,
    cover: (flow * 1440) / (perHour * 24),
  })
}

console.log('')
console.log('══ 掘洞级采矿艇产率（引擎 getMiningParams）══')
for (const beltId of ['belt-kernite', 'belt-glowstone', 'belt-voidshard', 'belt-nebulite', 'belt-gas-aurora', 'belt-ice-darkstar']) {
  const line: string[] = []
  for (const c of CONFIGS) {
    const p = getMiningParams(c.state, ctx, { shipId: c.ship, beltId })
    if (!p) continue
    line.push(`${c.label} ${fmt((p.unitsPerCycle * 3_600_000) / p.cycleMs)} 件/h`)
  }
  const belt = ctx.belts.get(beltId)
  console.log(`· ${belt?.name ?? beltId}（${belt?.oreId}）：${line.join(' ｜ ')}`)
}

rows.sort((a, b) => a.cover - b.cover)
console.log('')
console.log('══ 覆盖比 = 池日吸收 ÷ 座头鲸满配日产（<1 = 玩家一天就卖不动）══')
console.log('| 矿带 | 产物 | 单价 | 满配件/时 | 满配件/日 | 池日吸收 | **覆盖比** |')
console.log('|---|---|---|---|---|---|---|')
for (const r of rows) {
  console.log(
    `| ${r.belt} | ${r.ore} | ${r.price} | ${fmt(r.perHour)} | ${fmt(r.perDay)} | ${fmt(r.absorbDay)} | **${r.cover.toFixed(2)}×** |`,
  )
}
const bad = rows.filter((r) => r.cover < 1)
console.log('')
console.log(`· 覆盖比 < 1 的品类：${bad.length} / ${rows.length}（这些就是"流通性差"的来源）`)
console.log(`· 说明：基准 = 掘洞级 + 满采矿技能 + 2×强化采集器 MK1（高槽 2 / CPU 90）；池日吸收 = supplyFlow × 1440 窗（60 秒/窗）。`)

console.log('')
console.log('══ 分层覆盖比方案（保留"低阶需求大、高阶需求小"，但保证最低档也卖得掉）══')
console.log('· 覆盖比函数：单价 ≤20 → ×15（大宗）；≤200 → ×6（中阶）；≤400 → ×3（高阶）；>400 → ×2（顶级，仍 >1 = 卖得掉）')
console.log('| 产物 | 单价 | 基准日产 | 现 flow/窗 | 现覆盖比 | **目标覆盖比** | **建议 flow** | **建议 poolTarget** | 倍率 |')
console.log('|---|---|---|---|---|---|---|---|---|')
const coverageOf = (price: number): number => (price <= 20 ? 15 : price <= 200 ? 6 : price <= 400 ? 3 : 2)
for (const r of [...rows].sort((a, b) => a.price - b.price)) {
  const good = [...ctx.marketGoods.values()].find((g) => g.refId && ctx.items.get(g.refId)?.name === r.ore)
  const curFlow = good?.supplyFlow ?? 0
  const curPool = good?.poolTarget ?? 0
  const tgt = coverageOf(r.price)
  const needFlow = Math.ceil((r.perDay * tgt) / 1440)
  console.log(
    `| ${r.ore} | ${r.price} | ${fmt(r.perDay)} | ${fmt(curFlow)} | ${r.cover.toFixed(2)}× | **${tgt}×** | **${fmt(needFlow)}** | **${fmt(needFlow * 120)}** | ${(needFlow / Math.max(1, curFlow)).toFixed(1)}× |`,
  )
}
const flows = rows.map((r) => Math.ceil((r.perDay * coverageOf(r.price)) / 1440))
const poolNow = rows
  .map((r) => [...ctx.marketGoods.values()].find((g) => g.refId && ctx.items.get(g.refId)?.name === r.ore)?.supplyFlow ?? 0)
  .filter((f) => f > 0)
console.log(
  `· 梯度：建议 flow 区间 ${fmt(Math.min(...flows))} ~ ${fmt(Math.max(...flows))}/窗（**${(Math.max(...flows) / Math.min(...flows)).toFixed(1)}× 差距**）` +
    `；现状区间 ${fmt(Math.min(...poolNow))} ~ ${fmt(Math.max(...poolNow))}/窗（**${(Math.max(...poolNow) / Math.min(...poolNow)).toFixed(0)}× 差距**）`,
)
console.log('· 收入含义：低阶矿几乎不动（富凡 flow 不变）；高阶/气冰扩容后卖得掉，收入 = 产率 × 单价。')

/* ───────── 矿物侧（精炼产物）：以"主控炉满技能"为产能基准 ─────────
 * 口径来源：industry.refineParamsOf（批 = refineBatchUnits 100 / 周期 = refineCycleMs）、
 * 高级回收满级批量 ×(1+0.06×5)=×1.3、refineRate 满级 1.65；
 * 每种矿物取"单位时间产出最高"的那支矿作参照（玩家要某个矿物就会挑那支矿来炼）。 */
console.log('')
console.log('══ 矿物侧（精炼产物）：单炉满技能的件/时 与 池覆盖 ══')
const mineralRate = new Map<string, { perHour: number; fromOre: string }>()
for (const item of ctx.items.values()) {
  if (!item.refine || item.refine.length === 0) continue
  const cycleMs = item.refineCycleMs ?? 6000
  const batch = item.refineBatchUnits ?? 10
  const orePerHour = (3_600_000 / cycleMs) * batch * 1.3 // 高级回收满级 ×1.3
  for (const row of item.refine) {
    const perHour = orePerHour * row.perOre * 1.65 // 精炼产出倍率满级 1.65
    const prev = mineralRate.get(row.mineralId)
    if (!prev || perHour > prev.perHour) mineralRate.set(row.mineralId, { perHour, fromOre: item.name ?? item.id })
  }
}
console.log('| 矿物 | 单价 | 参照矿 | 单炉满技能件/时 | 件/日 | 现 flow/窗 | 现覆盖比 | **建议 flow** | **建议 poolTarget** | 倍率 |')
console.log('|---|---|---|---|---|---|---|---|---|---|')
for (const [mineralId, info] of [...mineralRate.entries()].sort((a, b) => a[1].perHour - b[1].perHour)) {
  const good = ctx.marketGoods.get(mineralId)
  if (!good?.poolTarget) continue
  const item = ctx.items.get(mineralId)
  const price = item?.baseSellPriceIsk ?? 0
  const perDay = info.perHour * 24
  const curFlow = good.supplyFlow ?? 0
  const cover = (curFlow * 1440) / perDay
  const tgt = coverageOf(price)
  const needFlow = Math.ceil((perDay * tgt) / 1440)
  console.log(
    `| ${item?.name ?? mineralId} | ${price} | ${info.fromOre} | ${fmt(info.perHour)} | ${fmt(perDay)} | ${fmt(curFlow)} | ${cover.toFixed(2)}× | **${fmt(needFlow)}** | **${fmt(needFlow * 120)}** | ${(needFlow / Math.max(1, curFlow)).toFixed(1)}× |`,
  )
}

/* ───────── 消耗品侧（2026-09-11 补；船长：「消耗品的市场规模依旧很低」）─────────
 * 与矿物侧同一把尺，但两处口径不同要讲清：
 * - **产能口径**（同矿物侧）：弹药/修理组件**玩家可自造**（有蓝图）→ 基准 = **单工位无技能产能**
 *   （outputUnits ÷ buildSeconds × 86400），覆盖比 = 池日吸收 ÷ 该产能；无人机**无蓝图** → 只走市场。
 * - **消耗口径**（本侧新增）：用**真实引擎**跑参考战斗，量出"一场打掉多少"，
 *   再看池子"够打几场"——这是玩家侧的体感规模（买得到多少）。
 * 参考行（真实引擎，4 张卡 × 5 种子取中位）：
 *   S2 灰鲭鲨 4×动能MK2 + 维修装置MK2（中位技能）／S4 大白鲨 5×动能MK3（满技能）／D3 王鲭机群（满技能）。 */
console.log('')
console.log('══ 消耗品侧：单场消耗（真实引擎）与池规模 ══')
const CONSUMER_SKILL_IDS = [
  'gunnery', 'kinetic-gunnery', 'missile-launching', 'laser-cannon', 'fire-control', 'reload-drills',
  'drone-warfare', 'drone-servicing', 'ammunition-condensing', 'shield-operation', 'energy-management',
  'hull-upgrades', 'shield-tuning', 'armor-tuning', 'armed-ops', 'armored-ops', 'vector-maneuvering',
  'evasion-maneuvering', 'targeting-integration', 'ship-systems-engineering',
]
const fullSkills = Object.fromEntries(CONSUMER_SKILL_IDS.map((k) => [k, 5]))
const midSkills = Object.fromEntries(CONSUMER_SKILL_IDS.map((k) => [k, 3]))
interface ConsumerRow {
  name: string
  ship: string
  high: string[]
  mid: string[]
  low: string[]
  drones?: Record<string, number>
  ammoTier?: string
  repair: boolean
  skills: Record<string, number>
}
const CONSUMER_ROWS: ConsumerRow[] = [
  {
    name: 'S2 灰鲭鲨 4×动能MK2 + 维修装置MK2（中位技能）',
    ship: 'sh-mako',
    high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'],
    mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-hullrep-2'],
    low: ['mod-stab-kin-2', 'mod-armor-kin-2'],
    ammoTier: 'ammo-kinetic-l',
    repair: true,
    skills: midSkills,
  },
  {
    name: 'S4 大白鲨 5×动能MK3 + 维修装置MK2（满技能）',
    ship: 'sh-whiteshark',
    high: ['mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3', 'mod-turret-kin-3'],
    mid: ['mod-shield-kin-2', 'mod-hullrep-2', 'mod-gyro-2'],
    low: ['mod-stab-kin-2', 'mod-armor-kin-2'],
    ammoTier: 'ammo-kinetic-2',
    repair: true,
    skills: fullSkills,
  },
  {
    name: 'D3 王鲭机群 4 攻坚 + 6 哨戒（满技能）',
    ship: 'sh-sentinel',
    high: ['mod-drone-rack-3', 'mod-drone-rack-3', 'mod-drone-tac-3', 'mod-drone-tac-3'],
    mid: ['mod-shield-kin-2', 'mod-gyro-2'],
    low: ['mod-armor-kin-2', 'mod-armor-plate-2'],
    drones: { 'drone-heavy': 4, 'drone-sentry': 6 },
    repair: false,
    skills: fullSkills,
  },
]
const CONSUMER_CARDS = ['ano-maw-hunt', 'ano-gravekeeper', 'ano-voidedge-warden', 'ano-vault-sentinel']
const SEEDS = [1, 7, 13, 29, 51]
const median = (xs: number[]): number => {
  const a = [...xs].sort((x, y) => x - y)
  return a.length === 0 ? 0 : a[Math.floor(a.length / 2)]!
}
const mean = (xs: number[]): number => (xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length)
const consumed = new Map<string, number[]>() // 消耗品 id → 逐场消耗
const push = (id: string, n: number): void => {
  const arr = consumed.get(id)
  if (arr) arr.push(n)
  else consumed.set(id, [n])
}
for (const r of CONSUMER_ROWS) {
  for (const card of CONSUMER_CARDS) {
    for (const seed of SEEDS) {
      const st = createInitialState({ nowWallMs: 0, seed })
      const uid = addShipToFleet(st, r.ship)
      st.shipId = uid
      for (const [k, v] of Object.entries(r.skills)) st.skills.trained[k] = v
      for (const k of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l', 'ammo-kinetic-2', 'ammo-explosive-2', 'ammo-plasma-2']) {
        st.warehouse.items[k] = 20_000
      }
      st.warehouse.items['repairkit-mil'] = 5_000
      st.warehouse.items['repairkit-civ'] = 5_000
      const entry = st.fleet[uid]!
      entry.fitted = { high: [...r.high], mid: [...r.mid], low: [...r.low] }
      if (r.drones) {
        entry.droneLoad = { ...r.drones }
        for (const [id, n] of Object.entries(r.drones)) st.warehouse.items[id] = n
      }
      if (r.ammoTier) entry.ammoPref = { kinetic: r.ammoTier }
      const battle = startBattleFor(st, ctx, uid, card, 0)
      if (!battle) continue
      const loaded = Object.values(battle.ammo).reduce((s, v) => s + (v ?? 0), 0)
      const kitsLoaded = Object.values(battle.repair?.kits ?? {}).reduce((s, v) => s + (v ?? 0), 0)
      st.gameMs = ctx.balance.battle.maxBattleMs + 5_000 + waveGapTotalMs(ctx.anomalies.get(card), ctx.balance.battle)
      advanceBattleFor(st, ctx, battle, uid, card)
      const left = Object.values(battle.ammo).reduce((s, v) => s + (v ?? 0), 0)
      const kitsLeft = Object.values(battle.repair?.kits ?? {}).reduce((s, v) => s + (v ?? 0), 0)
      const spent = loaded - left
      if (r.ammoTier && spent > 0) push(r.ammoTier, spent)
      if (r.repair && kitsLoaded > 0) push('repairkit-mil', kitsLoaded - kitsLeft)
      if (r.drones) for (const [id, n] of Object.entries(battle.droneLost ?? {})) push(id, n)
      if (r.repair) push('repairkit-civ', 0)
    }
  }
}
const BLUEPRINT_OUT = new Map<string, number>() // 消耗品 id → 单工位日产（无技能）
for (const bp of ctx.blueprints.values()) {
  if (!bp.itemId || !bp.outputUnits || !bp.buildSeconds) continue
  const perDay = (86_400 / bp.buildSeconds) * bp.outputUnits
  const prev = BLUEPRINT_OUT.get(bp.itemId) ?? 0
  if (perDay > prev) BLUEPRINT_OUT.set(bp.itemId, perDay)
}
const CONSUMABLE_IDS = [
  'ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l',
  'ammo-kinetic-2', 'ammo-explosive-2', 'ammo-plasma-2',
  'repairkit-civ', 'repairkit-mil',
  'drone-scout', 'drone-assault', 'drone-heavy', 'drone-sentry',
]
console.log('| 消耗品 | 单价 | 池存量 | flow/窗 | 日供给 | 单工位日产 | **产能覆盖比** | 单场消耗 | **够打** | **建议 flow** | **建议 poolTarget** |')
console.log('|---|---|---|---|---|---|---|---|---|---|---|')
for (const id of CONSUMABLE_IDS) {
  const good = ctx.marketGoods.get(id)
  if (!good) continue
  const item = ctx.items.get(id)
  const price = good.basePrice
  const flow = good.supplyFlow ?? 0
  const perDay = flow * 1440
  const prod = BLUEPRINT_OUT.get(id) ?? 0
  const cover = prod > 0 ? perDay / prod : Number.NaN
  // 弹药取中位（每场都在打）；修理组件取均值（打不到伤的场次为 0，中位会被 0 压低）
  const per = id.startsWith('repairkit') ? Math.round(mean(consumed.get(id) ?? [])) : median(consumed.get(id) ?? [])
  const battles = per > 0 ? Math.round(perDay / per) : Number.POSITIVE_INFINITY
  const tgt = coverageOf(price)
  const base = prod > 0 ? prod : per > 0 ? per * 144 : 0 // 无蓝图（无人机）→ 按战损口径：144 场/天
  const needFlow = base > 0 ? Math.ceil((base * tgt) / 1440) : flow
  console.log(
    `| ${item?.name ?? id} | ${price} | ${fmt(good.poolTarget ?? 0)} | ${fmt(flow)} | ${fmt(perDay)} | ${prod > 0 ? fmt(prod) : '—（无蓝图）'} | ` +
      `${Number.isFinite(cover) ? cover.toFixed(2) + '×' : '—'} | ${per > 0 ? fmt(per) : '—'} | ${Number.isFinite(battles) ? fmt(battles) + ' 场/天' : '—'} | ` +
      `**${fmt(needFlow)}** | **${fmt(needFlow * 120)}** |`,
  )
}
console.log('· 读法：**产能覆盖比** = 池日吸收 ÷ 单工位日产（<1 = 一个工位造出来的量，市场一天都吃不下）；')
console.log('  **单场消耗 → 够打** = 池日供给够撑几场（真实引擎实测的单场消耗，含 2026-09-11 修复的"齐射按门数扣弹"）；')
console.log('  **建议** = 与矿物侧同一把尺（分层覆盖比 ×15/×6/×2）；无人机无蓝图 → 基准按 144 场/天战损折算。')
