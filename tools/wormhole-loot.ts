/**
 * **终局玩法「虫洞」· 层收益读数（正式入库；F3c · 2026-09-13）**。
 *
 * 用途：把「深层收益比难度曲线更高」以及**新落码的四类地点产出**（F3b）从"设计意图"
 * 变成**可复跑的读数**——按层算出：
 * ① 一层里**期望有几个**什么地点（墓场/遗迹/矿脉/舰船信号/信标；走真实盘面生成）；
 * ② 每个地点的**期望产出与收益估值**（母矿按基础卖价；残骸按**回收炉拆解**口径
 *    ——`wormholeLootValueIsk`：残骸的 `baseSellPriceIsk = 1`，只看基础价会算成 0）；
 * ③ 一层的**毛收益期望**、对应**背包格数**、以及**打捞要花几回合**（⌈堆数 ÷ 台数⌉）；
 * ④ 残骸 vs 母矿的**每格价值**对照——判断"深层更赚"时，格子与回合才是真约束。
 *
 * 口径与落码同源：地点生成走 `wormholeMakeGrid` + `wormholeEnsureSalvagePiles` /
 * `wormholeEnsureVeinPiles`，估值走 `wormholeLootValueIsk`，格数走 `wormholeBagSlotsOfFleet`。
 * **本工具只打印、不写任何游戏数据。**
 *
 * 用法：
 *   npx tsx tools/wormhole-loot.ts                 # 层 1~8 · 每层 200 盘
 *   npx tsx tools/wormhole-loot.ts --layers=12 --grids=400
 *   npx tsx tools/wormhole-loot.ts --rigs=2        # 打捞器台数（算打捞回合用）
 *   npm run wormhole:loot                          # 等价
 */
import { buildSimContext } from '@whale/data'
import { createInitialState } from '../packages/core/src/state'
import { addShipToFleet } from '../packages/core/src/shipyard'
import {
  WORMHOLE_ORE_ITEM_ID,
  wormholeBagSlotsOfFleet,
  wormholeEnter,
  wormholeLayerRewardMul,
  wormholeLayerThreat,
} from '../packages/core/src/wormhole'
import { gridCellAt, gridTally, wormholeMakeGrid } from '../packages/core/src/wormholeGrid'
import {
  WORMHOLE_RARE_JUDGE_CHANCE,
  WORMHOLE_RELIC_MIN_DEPTH,
  wormholeCellCardIdOf,
  wormholeEnsureSalvagePiles,
  wormholeEnsureVeinPiles,
  wormholeLootValueIsk,
  wormholeRelicChanceOf,
} from '../packages/core/src/wormholeSalvage'
import { RARE_WRECK_VOLUME_M3, rareWreckItemIdOfCard, wreckItemIdOfCard } from '../packages/core/src/salvage'

const ctx = buildSimContext()
const arg = (key: string, dflt: number): number => {
  const hit = process.argv.find((a) => a.startsWith(`--${key}=`))
  return hit ? Number(hit.split('=')[1]) : dflt
}
const LAYERS = Math.max(1, arg('layers', 8))
const GRIDS = Math.max(1, arg('grids', 200))
/** 打捞器台数（编队合计；算"打捞要花几回合"用） */
const RIGS = Math.max(1, arg('rigs', 4))
/** 参考编队（与 `wormhole:econ` 同款：4× 长尾鲨级巡洋舰） */
const REF_SHIP = 'sh-thresher'
const REF_N = 4
/** 普通残骸每堆基准体积（与 `wormholeSalvage.WORMHOLE_WRECK_PILE_M3_BASE` 同值） */
const WRECK_PILE_M3 = 200

/** 造一次参考编队的入洞现场（层内产出需要一个"趟"上下文：种子/层/编队） */
function refRun(): ReturnType<typeof createInitialState> {
  const state = createInitialState({ nowWallMs: 0, seed: 1 })
  const ids: string[] = []
  for (let i = 0; i < REF_N; i++) ids.push(addShipToFleet(state, REF_SHIP))
  state.shipId = ids[0]!
  wormholeEnter(state, ctx, ids, 1)
  return state
}
const bagSlots = wormholeBagSlotsOfFleet(refRun(), ctx, refRun().wormhole.run!.fleet)

interface LayerRow {
  depth: number
  threat: number
  cells: number
  graves: number
  ruins: number
  veins: number
  ships: number
  beacons: number
  lootValue: number
  graveValue: number
  ruinValue: number
  veinValue: number
  shipValue: number
  relics: number
  lootSlots: number
  salvageTurns: number
}

function layerRow(depth: number): LayerRow {
  const state = refRun()
  const run = state.wormhole.run!
  run.depth = depth
  const acc: LayerRow = {
    depth,
    threat: wormholeLayerThreat(depth),
    cells: 0,
    graves: 0,
    ruins: 0,
    veins: 0,
    ships: 0,
    beacons: 0,
    lootValue: 0,
    graveValue: 0,
    ruinValue: 0,
    veinValue: 0,
    shipValue: 0,
    relics: 0,
    lootSlots: 0,
    salvageTurns: 0,
  }
  let salvagePiles = 0
  for (let seed = 1; seed <= GRIDS; seed++) {
    const grid = wormholeMakeGrid(seed, depth)
    run.grid = grid
    acc.cells += gridTally(grid).total
    for (const c of grid.cells) {
      const cell = gridCellAt(grid, { q: c.q, r: c.r })!
      if (c.place === 'graveyard' || c.place === 'ruins') {
        wormholeEnsureSalvagePiles(state, cell)
        const piles = cell.piles ?? []
        const value = piles.reduce((s, p) => s + wormholeLootValueIsk(ctx, p.itemId, p.units), 0)
        const m3 = piles.reduce((s, p) => s + p.units * (ctx.items.get(p.itemId)?.unitM3 ?? 0), 0)
        acc.lootSlots += m3 / 500
        salvagePiles += piles.length
        if (c.place === 'graveyard') {
          acc.graves += 1
          acc.graveValue += value
        } else {
          acc.ruins += 1
          acc.ruinValue += value
          acc.relics += wormholeRelicChanceOf(depth)
          acc.lootSlots += 0 // 专属件不进背包格子（记在 run.relics）
        }
      } else if (c.place === 'vein') {
        wormholeEnsureVeinPiles(state, cell)
        const piles = cell.piles ?? []
        acc.veins += 1
        acc.veinValue += piles.reduce((s, p) => s + wormholeLootValueIsk(ctx, p.itemId, p.units), 0)
        acc.lootSlots += piles.reduce((s, p) => s + p.units * (ctx.items.get(p.itemId)?.unitM3 ?? 0), 0) / 500
      } else if (c.place === 'ship') {
        acc.ships += 1
        const card = wormholeCellCardIdOf(run, cell)
        const mul = wormholeLayerRewardMul(depth)
        acc.shipValue +=
          2 * wormholeLootValueIsk(ctx, wreckItemIdOfCard(card)!, Math.round(WRECK_PILE_M3 * mul)) +
          wormholeLootValueIsk(ctx, rareWreckItemIdOfCard(card)!, RARE_WRECK_VOLUME_M3)
        acc.lootSlots += (2 * Math.round(WRECK_PILE_M3 * mul) + RARE_WRECK_VOLUME_M3) / 500
      } else if (c.place === 'beacon') {
        acc.beacons += 1
      }
    }
  }
  const n = GRIDS
  const per = (x: number): number => x / n
  for (const k of [
    'cells',
    'graves',
    'ruins',
    'veins',
    'ships',
    'beacons',
    'graveValue',
    'ruinValue',
    'veinValue',
    'shipValue',
    'relics',
    'lootSlots',
  ] as const) {
    acc[k] = per(acc[k])
  }
  acc.lootValue = acc.graveValue + acc.ruinValue + acc.veinValue + acc.shipValue
  acc.salvageTurns = salvagePiles / n / RIGS
  return acc
}

console.log(
  `虫洞 · 层收益读数（参考编队 ${REF_N}×巡洋舰 · 背包 ${bagSlots} 格 · 打捞器 ${RIGS} 台 · 每层 ${GRIDS} 盘）`,
)
console.log(
  [
    '层',
    '威胁',
    '格数',
    '墓场',
    '遗迹',
    '矿脉',
    '舰船',
    '信标',
    '毛收益ISK',
    '墓场',
    '遗迹',
    '矿脉',
    '战果',
    '专属件',
    '占格',
    '打捞回合',
  ].join('\t'),
)
for (let d = 1; d <= LAYERS; d++) {
  const r = layerRow(d)
  const f = (x: number): string => Math.round(x).toLocaleString('zh-CN')
  console.log(
    [
      r.depth,
      r.threat,
      r.cells.toFixed(0),
      r.graves.toFixed(2),
      r.ruins.toFixed(2),
      r.veins.toFixed(2),
      r.ships.toFixed(2),
      r.beacons.toFixed(2),
      f(r.lootValue),
      f(r.graveValue),
      f(r.ruinValue),
      f(r.veinValue),
      f(r.shipValue),
      r.relics.toFixed(2),
      r.lootSlots.toFixed(1),
      r.salvageTurns.toFixed(1),
    ].join('\t'),
  )
}
const wreckPerSlot = wormholeLootValueIsk(ctx, wreckItemIdOfCard('wh-pirate-scout')!, 500)
const orePerSlot = wormholeLootValueIsk(ctx, WORMHOLE_ORE_ITEM_ID, 500)
console.log('')
console.log('读法：')
console.log('  ① 「毛收益ISK」= 该层**全部地点**产出的期望估值（母矿按基础卖价；残骸按**回收炉拆解**估值）')
console.log('     ⇒ **不等于能带走的收益**：还要过"背包格数"与"回合预算"两道闸（见「占格」与「打捞回合」）。')
console.log(`  ② 「打捞回合」= 墓场+遗迹的堆数 ÷ ${RIGS} 台打捞器（⌈堆数 ÷ 台数⌉；**不含**移动/扫描/战斗的回合）。`)
console.log(
  `  ③ 每格价值对照：普通残骸 ${Math.round(wreckPerSlot).toLocaleString('zh-CN')} ISK/格 · ` +
    `虚空母矿 ${Math.round(orePerSlot).toLocaleString('zh-CN')} ISK/格（母矿是残骸的 ${(orePerSlot / wreckPerSlot).toFixed(0)} 倍）` +
    ` ⇒ 残骸是**占格的散货**，墓场的价值主要在"每 3 堆普通判一次"的稀有残骸与遗迹的专属掉落。`,
)
console.log(
  `  ④ 遗迹专属：层 ${WORMHOLE_RELIC_MIN_DEPTH} 起**固定 ${(wormholeRelicChanceOf(WORMHOLE_RELIC_MIN_DEPTH) * 100).toFixed(0)}%**` +
    `（2026-09-15 船长：「遗迹出货柜概率提高到70%」；旧的"随层上升、封顶 50%"作废）；` +
    `掉出的货柜 = 贵重品柜 **50%** + 安全柜五族/图纸柜三档/军用柜共 9 种**各 ≈5.6%**（不分层）；` +
    `「专属件」列 = 一层里期望掉几件（不占背包格，撤离成功才入库）。`,
)
console.log(
  `  ⑤ 墓场稀有残骸：每 3 堆普通判一次（单次 ${(WORMHOLE_RARE_JUDGE_CHANCE * 100).toFixed(0)}%）⇒ 稀有堆数 ≤ ⌊普通堆数 ÷ 3⌋。`,
)
