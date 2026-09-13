/**
 * **终局玩法「虫洞」· 层收益校准**（正式入库；F 批 · 2026-09-13）。
 *
 * 用途：把「深层收益应该比难度曲线要更高」（船长 2026-09-13）从口号变成**可复跑的读数**——
 * 逐层跑真实战斗推演（普通节点 / 层末守卫 / 撤离战）并算出该层的**期望原矿收益**，
 * 最后判定「**单位威胁收益**是否逐层严格上升」。
 *
 * 用法：
 *   npx tsx tools/wormhole-econ.ts                 # 默认 8 层 · 每节点 1 波 · 5 播种
 *   npx tsx tools/wormhole-econ.ts --layers=12     # 看更深
 *   npx tsx tools/wormhole-econ.ts --waves=2       # 按"每节点 2 波"跑（节点 cost 也随之上抬）
 *   npm run wormhole:econ                          # 等价
 *
 * 口径（与引擎同源，不另存一份）：
 * - 威胁：`wormholeLayerThreat(depth)`（层 1 = 45、每层 ×1.16）；BOSS ×1.2、撤离战 ×0.8；
 * - 敌卡：`wormholeCardIdFor(depth, nodeIndex)` 四族轮换 —— 本工具按"每层逐节点"取，故与实战一致；
 * - 拾取收益：按**该 seed 真实生成的节点表**（拾取点 + 每堆单位数）求和，再乘**虚空母矿基础价**
 *   （`baseSellPriceIsk`，不走市场供需），即"按基础价的毛收益"；
 * - 参考编队：**4× T3 长尾鲨导弹巡（5×导弹 MK3 + 支援件）**，技能 = 战斗系 Lv3（= `battle-calibrate`
 *   的 S2/T3 线满配行同款），弹药 = 基础弹管够；这是设计稿 §4.4「4×T3 = 14,000 质量 / 29 回合」的编队。
 *
 * 读数列义：`胜率` = 该场判定我方胜的比例；`时长` = 战斗时钟秒（多播种均值）；`残血` = 我方
 * **全编队**剩余三层血 ÷ 满血；`收益/威胁` = 该层期望原矿价值 ÷ 该层威胁（**应逐层上升**）。
 *
 * ⚠ **版本自检**（口径同「旧数据不可靠」：超过一个大版本必须核对是否与现状偏差过大）
 *   - 游戏版本：**v0.1.0**（`package.json`）· 存档结构：**v25**（`CURRENT_STATE_VERSION`）
 *   - 本工具最后核对：**2026-09-13**（当日核对：层威胁曲线 / 四族敌卡轮换 / 拾取堆生成 / 撤离战倍率）
 *   - 本工具最后跑过：**2026-09-13**
 *   - 判据：`CURRENT_STATE_VERSION − v25 ≥ 2` ⇒ **必须重跑核对**（存档结构跨了一个大版本）
 */
import { addShipToFleet, createInitialState } from '@whale/core'
import type { GameState, SimContext } from '@whale/core'
import { buildSimContext } from '@whale/data'
import {
  advanceBattleFor,
  startFleetBattleFor,
} from '../packages/core/src/combat'
import {
  WORMHOLE_ORE_ITEM_ID,
  wormholeCardIdFor,
  wormholeFoeThreat,
  wormholeLayerRewardMul,
  wormholeLayerThreat,
  wormholeMakeNode,
  wormholeNodesPerLayer,
  wormholeStepCost,
} from '../packages/core/src/wormhole'

const ctx: SimContext = buildSimContext()

/** 参考编队：4× T3 长尾鲨（导弹巡满配 + 支援件）——设计稿 §4.4 的「4×T3」编队 */
const REF_SHIP = 'sh-thresher'
const REF_FIT = {
  high: ['mod-missile-3', 'mod-missile-3', 'mod-missile-3', 'mod-missile-3', 'mod-missile-3'],
  mid: ['mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2'],
  low: ['mod-stab-kin-2', 'mod-armor-kin-2'],
}
/** 技能档 = 战斗系 Lv3（中位行，与 `battle-calibrate` 的 A1 行同口径） */
const SKILLS: Record<string, number> = {
  'gunnery': 3,
  'missile-ops': 3,
  'shield-ops': 3,
  'armor-ops': 3,
  'evasive-maneuvers': 3,
  'targeting': 3,
}

const LAYERS = Number((process.argv.find((a) => a.startsWith('--layers=')) ?? '--layers=8').split('=')[1])
const WAVES = Math.max(1, Number((process.argv.find((a) => a.startsWith('--waves=')) ?? '--waves=1').split('=')[1]))
const SEED_N = Math.max(1, Number((process.argv.find((a) => a.startsWith('--seeds=')) ?? '--seeds=5').split('=')[1]))
const SEEDS = Array.from({ length: SEED_N }, (_, i) => 1 + i * 6)

function makeFleet(seed: number): { state: GameState; uids: string[] } {
  const state = createInitialState({ nowWallMs: 0, seed })
  state.wallet.isk = 20_000_000
  for (const [id, lv] of Object.entries(SKILLS)) state.skills.trained[id] = lv
  for (const key of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) state.warehouse.items[key] = 5_000
  const uids: string[] = []
  for (let i = 0; i < 4; i++) {
    const uid = addShipToFleet(state, REF_SHIP)
    state.fleet[uid]!.fitted = { high: [...REF_FIT.high], mid: [...REF_FIT.mid], low: [...REF_FIT.low] }
    uids.push(uid)
  }
  state.shipId = uids[0]!
  return { state, uids }
}

interface Cell {
  won: number
  n: number
  sec: number
  hpFrac: number
  /** 敌方开火次数（判定"我方残血 100%"到底是打赢了还是**敌人根本没开火**——强制列） */
  foeShots: number
}

/** 跑一场真实洞内战斗（推到分出胜负或打满上限） */
function runOneBattle(seed: number, depth: number, kind: 'node' | 'boss' | 'extract', nodeIndex: number): Cell {
  const { state, uids } = makeFleet(seed)
  const cardId = wormholeCardIdFor(depth, nodeIndex)
  const battle = startFleetBattleFor(state, ctx, uids, cardId, 0, null, { depth, kind, waves: WAVES })
  if (!battle) return { won: 0, n: 1, sec: 0, hpFrac: 0 }
  const meTags = (battle.myFleet ?? []).map((e) => e.tag)
  const fullHp = () => {
    let cur = 0
    let max = 0
    for (const tag of meTags) {
      const u = battle.units[tag]
      if (!u) continue
      cur += u.hp.s + u.hp.a + u.hp.h
      max += (u.hpMax?.s ?? 0) + (u.hpMax?.a ?? 0) + (u.hpMax?.h ?? 0)
    }
    return max > 0 ? cur / max : 0
  }
  let guard = 0
  while (!battle.ended && guard < 900) {
    state.gameMs += 1_000
    advanceBattleFor(state, ctx, battle, uids[0]!, cardId)
    guard++
  }
  const sec = Math.max(0, (battle.lastTickGameMs - battle.startedAtGameMs) / 1000)
  return { won: battle.ended === 'me' ? 1 : 0, n: 1, sec, hpFrac: fullHp(), foeShots: battle.stats.foeShots }
}

function avg(cells: Cell[]): Cell {
  const n = cells.reduce((s, c) => s + c.n, 0)
  if (n === 0) return { won: 0, n: 0, sec: 0, hpFrac: 0, foeShots: 0 }
  return {
    won: cells.reduce((s, c) => s + c.won, 0) / n,
    n,
    sec: cells.reduce((s, c) => s + c.sec, 0) / n,
    hpFrac: cells.reduce((s, c) => s + c.hpFrac, 0) / n,
    foeShots: cells.reduce((s, c) => s + c.foeShots, 0) / n,
  }
}

/** 该层**按 seed 真实生成**的节点表：拾取堆总数与总单位数（与实战同源） */
function layerLoot(seed: number, depth: number): { piles: number; units: number; cost: number } {
  const n = wormholeNodesPerLayer(depth)
  let piles = 0
  let units = 0
  let cost = 0
  for (let i = 0; i < n; i++) {
    const node = wormholeMakeNode(seed, depth, i)
    cost += wormholeStepCost(node.waves, node.pickups)
    for (const pile of node.piles ?? []) {
      piles++
      units += pile.units
    }
  }
  return { piles, units, cost }
}

function main(): void {
  const ore = ctx.items.get(WORMHOLE_ORE_ITEM_ID)
  const orePrice = ore?.baseSellPriceIsk ?? 0
  console.log(
    `虫洞 · 层收益校准（参考编队 4×${ctx.ships.get(REF_SHIP)?.name ?? REF_SHIP} 满配 + 战斗系 Lv3；` +
      `每节点 ${WAVES} 波；${SEEDS.length} 播种；原矿 ${ore?.name ?? WORMHOLE_ORE_ITEM_ID} 基础价 ${orePrice} ISK）`,
  )
  console.log(
    [
      '层',
      '威胁',
      '节点胜率',
      '节点时长',
      '节点残血',
      '敌开火',
      '守卫胜率',
      '守卫残血',
      '撤离战胜率',
      '层回合',
      '期望堆数',
      '期望原矿',
      '毛收益ISK',
      '每回合ISK',
      '难度',
    ].join('\t'),
  )
  /** 解析口径：单堆收益系数 ÷ 威胁（**去噪**——实测堆数每层离散，不宜直接比） */
  const analytic: number[] = []
  const perTurn: number[] = []
  for (let d = 1; d <= LAYERS; d++) {
    const node = avg(SEEDS.map((s) => runOneBattle(s, d, 'node', 0)))
    const boss = avg(SEEDS.map((s) => runOneBattle(s, d, 'boss', 0)))
    const extr = avg(SEEDS.map((s) => runOneBattle(s, d, 'extract', 0)))
    const loot = SEEDS.map((s) => layerLoot(s, d)).reduce(
      (acc, l) => ({
        piles: acc.piles + l.piles / SEEDS.length,
        units: acc.units + l.units / SEEDS.length,
        cost: acc.cost + l.cost / SEEDS.length,
      }),
      { piles: 0, units: 0, cost: 0 },
    )
    const isk = loot.units * orePrice
    const threat = wormholeLayerThreat(d)
    // 每层"每回合收益"：回合是硬约束（质量压塌）⇒ 这才是玩家真正比较的量
    const perTurnIsk = loot.cost > 0 ? isk / loot.cost : 0
    analytic.push(wormholeLayerRewardMul(d) / threat)
    perTurn.push(perTurnIsk)
    const soft = node.won >= 1 && node.hpFrac >= 0.9
    const hard = node.won < 1 || node.hpFrac < 0.7
    const wall = node.won < 0.5
    console.log(
      [
        d,
        `${threat}（守卫 ${wormholeFoeThreat(d, 'boss')} / 撤离 ${wormholeFoeThreat(d, 'extract')}）`,
        `${Math.round(node.won * 100)}%`,
        `${node.sec.toFixed(0)}s`,
        `${Math.round(node.hpFrac * 100)}%`,
        node.foeShots.toFixed(0),
        `${Math.round(boss.won * 100)}%`,
        `${Math.round(boss.hpFrac * 100)}%`,
        `${Math.round(extr.won * 100)}%`,
        loot.cost.toFixed(1),
        loot.piles.toFixed(1),
        loot.units.toFixed(0),
        Math.round(isk).toLocaleString('zh-CN'),
        Math.round(perTurnIsk).toLocaleString('zh-CN'),
        wall ? '**墙**' : hard ? '有挑战' : soft ? '太软' : '中',
      ].join('\t'),
    )
  }
  /** 设计裁定 Q11 的可验证落点：**单位威胁收益逐层严格上升**（用解析口径去噪） */
  let rising = true
  for (let i = 1; i < analytic.length; i++) if (!(analytic[i]! > analytic[i - 1]!)) rising = false
  console.log(
    `\n① 收益曲线（解析口径：单堆收益系数 ÷ 威胁）逐层${rising ? '**严格上升** ✓' : '**未严格上升** ✗'}` +
      `（口径 = 收益每层 ×1.2、威胁每层 ×1.16；船长 2026-09-13「深层收益应该比难度曲线要更高」）`,
  )
  console.log(
    `② 实测每回合收益（ISK，已按该 seed 真实节点/堆数计）：${perTurn.map((v) => Math.round(v).toLocaleString('zh-CN')).join(' → ')}`,
  )
  console.log(
    `③ 难度提示：「太软」= 节点战 100% 胜且残血 ≥90%（对 4×T3 满配编队没有风险）；` +
      `「有挑战」= 胜率 <100% 或残血 <70%；「墙」= 胜率 <50%`,
  )
}

main()
