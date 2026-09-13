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
  WORMHOLE_FOE_CARD_IDS,
  WORMHOLE_ORE_ITEM_ID,
  wormholeAdvanceNode,
  wormholeCardIdFor,
  wormholeDescend,
  wormholeEnter,
  wormholeExtract,
  wormholeFoeThreat,
  wormholeLayerRewardMul,
  wormholeLayerThreat,
  wormholeMakeNode,
  wormholeNodesPerLayer,
  wormholeStepCost,
  wormholeTakePile,
} from '../packages/core/src/wormhole'
import { advanceWormhole, wormholeStartBattle } from '../packages/core/src/wormholeBattle'

const ctx: SimContext = buildSimContext()

/** 参考编队：4× T3 长尾鲨（导弹巡满配 + 支援件）——设计稿 §4.4 的「4×T3」编队 */
const REF_SHIP = 'sh-thresher'
const REF_FIT = {
  high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'],
  mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2'],
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
/** 洞内敌卡强度系数覆写（**校准用**：只改本工具上下文，引擎仍走 WORMHOLE_FOE_BASE_STRENGTH_MUL） */
const STR = process.argv.find((a) => a.startsWith('--str='))
const STRENGTH = STR ? Number(STR.split('=')[1]) : undefined
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
function runOneBattle(
  seed: number,
  depth: number,
  kind: 'node' | 'boss' | 'extract',
  nodeIndex: number,
  cardIndex?: number,
): Cell {
  const { state, uids } = makeFleet(seed)
  const cardId = cardIndex === undefined ? wormholeCardIdFor(depth, nodeIndex) : WORMHOLE_FOE_CARD_IDS[cardIndex]!
  const battle = startFleetBattleFor(state, ctx, uids, cardId, 0, null, { depth, kind, waves: WAVES, strengthMul: STRENGTH })
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

/* ─────────── 整趟模拟（`--runs=N`）：真引擎跑完整"搜打撤" ─────────── */

/** 政策用的**粗残血**（逐船 装甲% 与 结构% 取均值；不是精确三层血比，只作"要不要继续深入"的门槛） */
function roughHpFrac(state: GameState, shipIds: readonly string[]): number {
  let sum = 0
  let n = 0
  for (const uid of shipIds) {
    const f = state.fleet[uid]
    if (!f) continue
    sum += ((f.armorPct ?? 1) + (f.durability ?? 1)) / 2
    n++
  }
  return n > 0 ? sum / n : 0
}

/**
 * **三层血口径的编队残血**（含护盾；战斗内读数）。
 * ⚠ 为什么不能只用 `roughHpFrac` 做政策：**护盾不落档**（`persistFleetHullDamage` 只写装甲/结构）⇒
 * 全靠护盾扛下来的编队看起来"毫发无损"，政策会一直往下钻直到被打死。
 * 首版模拟吃到这个亏（12/12 趟在第 3 层全损），这条是修正。
 */
function battleHpFrac(battle: GameState['expedition']['battle']): number {
  if (!battle) return 1
  let cur = 0
  let max = 0
  for (const entry of battle.myFleet ?? []) {
    const u = battle.units[entry.tag]
    if (!u) continue
    cur += u.hp.s + u.hp.a + u.hp.h
    max += (u.hpMax?.s ?? 0) + (u.hpMax?.a ?? 0) + (u.hpMax?.h ?? 0)
  }
  return max > 0 ? cur / max : 1
}

interface RunOutcome {
  /** 结束方式：撤离成功 / 全损 */
  result: 'extract' | 'lost'
  depth: number
  shipsLeft: number
  oreUnits: number
  isk: number
  /** 结束时的编队粗残血 */
  hpFrac: number
}

/**
 * **跑一整趟**（真状态机 + 真战斗）：进洞 → 逐节点打 → 层末先打守卫 → 按政策决定深入或撤离。
 * 政策（模拟"一个正常玩家"）：`--extract-hp=`（粗残血低于它就撤，默认 0.5）与 `--max-depth=`（默认 3）。
 */
function simulateRun(seed: number, extractHp: number, maxDepth: number): RunOutcome {
  const { state, uids } = makeFleet(seed)
  const orePrice = ctx.items.get(WORMHOLE_ORE_ITEM_ID)?.baseSellPriceIsk ?? 0
  const before = state.warehouse.items[WORMHOLE_ORE_ITEM_ID] ?? 0
  const enter = wormholeEnter(state, ctx, uids, seed)
  if (!enter.ok) throw new Error(`入洞失败：${enter.error ?? ''}`)
  let guard = 0
  /** 最近一场战斗结束时的**三层血口径**残血（政策用它；护盾不落档，见 `battleHpFrac`） */
  let lastFrac = 1
  while (state.wormhole.run && guard++ < 400) {
    state.gameMs += 1_000 // 与引擎心跳同款：推时间，战斗才走得动
    const r = state.wormhole.run
    if (r.battle) {
      if (r.battle.ended) lastFrac = battleHpFrac(r.battle)
      advanceWormhole(state, ctx)
      continue
    }
    if (r.phase === 'extracting') {
      advanceWormhole(state, ctx)
      continue
    }
    if (r.pendingNode) {
      if (r.pendingNode.kind === 'combat') {
        if (!wormholeStartBattle(state, ctx, 'node').ok) break
      } else {
        // 拾取点：能捡就捡光；事件节点直接结算
        while ((r.pendingNode.piles ?? []).length > 0) {
          if (!wormholeTakePile(state, ctx, 0).ok) break
        }
        if (!wormholeAdvanceNode(ctx, r, state.rng.seed).ok) wormholeExtract(r)
      }
      continue
    }
    if ((r.bossCleared ?? 0) < r.depth) {
      if (!wormholeStartBattle(state, ctx, 'boss').ok) break
      continue
    }
    const frac = lastFrac > 0 ? lastFrac : roughHpFrac(state, r.fleet)
    if (r.depth >= maxDepth || frac < extractHp || r.turnsLeft <= 0) wormholeExtract(r)
    else wormholeDescend(r, state.rng.seed)
  }
  const after = state.warehouse.items[WORMHOLE_ORE_ITEM_ID] ?? 0
  const ore = after - before
  return {
    result: ore > 0 ? 'extract' : 'lost',
    depth: state.wormhole.run?.depth ?? maxDepth,
    shipsLeft: uids.filter((u) => state.fleet[u]).length,
    oreUnits: ore,
    isk: ore * orePrice,
    hpFrac: roughHpFrac(state, uids.length > 0 ? uids : []),
  }
}

function runRunsMode(): void {
  const n = Math.max(1, Number((process.argv.find((a) => a.startsWith('--runs=')) ?? '--runs=20').split('=')[1]))
  const extractHp = Number(
    (process.argv.find((a) => a.startsWith('--extract-hp=')) ?? '--extract-hp=0.5').split('=')[1],
  )
  const maxDepth = Math.max(
    1,
    Number((process.argv.find((a) => a.startsWith('--max-depth=')) ?? '--max-depth=3').split('=')[1]),
  )
  console.log(
    `整趟模拟 · ${n} 趟（参考编队 4×巡洋 MK2 · 政策：粗残血 < ${extractHp} 或到第 ${maxDepth} 层就撤 · 拾取点捡光）`,
  )
  console.log(['#', '结果', '到达层', '存活船', '原矿', '收益ISK', '收尾残血'].join('\t'))
  const out: RunOutcome[] = []
  for (let i = 0; i < n; i++) {
    const o = simulateRun(1000 + i * 37, extractHp, maxDepth)
    out.push(o)
    console.log(
      [
        i + 1,
        o.result === 'extract' ? '撤离成功' : '全损',
        o.depth,
        `${o.shipsLeft}/4`,
        o.oreUnits,
        Math.round(o.isk).toLocaleString('zh-CN'),
        `${Math.round(o.hpFrac * 100)}%`,
      ].join('\t'),
    )
  }
  const ok = out.filter((o) => o.result === 'extract')
  const avg = (f: (o: RunOutcome) => number): number => out.reduce((s, o) => s + f(o), 0) / out.length
  const lostShips = out.reduce((s, o) => s + (4 - o.shipsLeft), 0)
  console.log(
    `\n汇总：撤离成功 ${ok.length}/${out.length} · 平均到达第 ${avg((o) => o.depth).toFixed(1)} 层 · ` +
      `平均存活 ${avg((o) => o.shipsLeft).toFixed(2)}/4 艘（合计损失 ${lostShips} 艘）· ` +
      `平均原矿 ${Math.round(avg((o) => o.oreUnits))} 单位 ⇒ 平均收益 ${Math.round(avg((o) => o.isk)).toLocaleString('zh-CN')} ISK`,
  )
}

function main(): void {
  if (process.argv.includes('--runs') || process.argv.some((a) => a.startsWith('--runs='))) {
    runRunsMode()
    return
  }
  // **逐卡模式**（`--card=1 --depth=2`）：单看某层的某张卡，用来做**逐卡配平**（四张卡的战术/射程
  // 差异很大 ⇒ 同一预算下强度并不相等，必须逐卡看读数再微调该卡的 `dmgMul`）。
  const cardArg = process.argv.find((a) => a.startsWith('--card='))
  if (cardArg) {
    const ci = Number(cardArg.split('=')[1])
    const dep = Number((process.argv.find((a) => a.startsWith('--depth=')) ?? '--depth=1').split('=')[1])
    const cardId = WORMHOLE_FOE_CARD_IDS[ci]!
    console.log(`逐卡读数：第 ${dep} 层 · ${cardId}（${ctx.anomalies.get(cardId)?.name ?? '?'}）· 每节点 ${WAVES} 波 · ${SEEDS.length} 播种`)
    console.log(['模式', '胜率', '时长', '残血', '敌开火', '我开火'].join('\t'))
    for (const kind of ['node', 'boss', 'extract'] as const) {
      const c = avg(SEEDS.map((s) => runOneBattle(s, dep, kind, 0, ci)))
      console.log(
        [kind, `${Math.round(c.won * 100)}%`, `${c.sec.toFixed(0)}s`, `${Math.round(c.hpFrac * 100)}%`, c.foeShots.toFixed(0), ''].join('\t'),
      )
    }
    return
  }
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
