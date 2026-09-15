/**
 * **终局玩法「虫洞」· 层收益校准**（正式入库；F 批 · 2026-09-13）。
 *
 * 用途：把「深层收益应该比难度曲线要更高」（船长 2026-09-13）从口号变成**可复跑的读数**——
 * 逐层跑真实战斗推演（普通节点 / 层末守卫）并算出该层的**期望原矿收益**，
 * 最后判定「**单位威胁收益**是否逐层严格上升」。
 *
 * ⚠ **2026-09-15 撤离战退役**（船长「虫洞的撤离战取消吧」）：撤离不再触发战斗 ⇒
 * 本工具的单场解析表**删掉「撤离战胜率」列**，整趟模式里"撤离"变成一次直接入港。
 *
 * 用法：
 *   npx tsx tools/wormhole-econ.ts                 # 默认 8 层 · 每节点 1 波 · 5 播种
 *   npx tsx tools/wormhole-econ.ts --layers=12     # 看更深
 *   npx tsx tools/wormhole-econ.ts --waves=2       # 按"每节点 2 波"跑（节点 cost 也随之上抬）
 *   npm run wormhole:econ                          # 等价
 *   npx tsx tools/wormhole-econ.ts --runs=20 --start-depth=4 --fit=auto   # 空降到第 4 层跑（★星云层）
 *
 * 口径（与引擎同源，不另存一份）：
 * - 威胁：`wormholeLayerThreat(depth)`（层 1 = 45、每层 **×1.10**，2026-09-15 由 ×1.16 降下来）；
 *   BOSS ×1.2（**撤离战 ×0.8 已于 2026-09-15 退役**）；
 * - 敌卡：`wormholeCardIdForRun({ depth, kind, nodeIndex })` —— **族锁 + 该层档位池**
 *   （层 1 只浅 / 层 2~3 中 2 : 浅 1 / 层 4+ 深 2 : 中 1 : 浅 1；守卫取最深已解锁档），
 *   与实战同一取值点；**分层血量修正**（浅 ×1 / 中 ×1.1 / 深 ×1.2）由引擎按卡 id 反查自动带上；
 * - 拾取收益：按**该 seed 真实生成的节点表**（拾取点 + 每堆单位数）求和，再乘**虚空母矿基础价**
 *   （`baseSellPriceIsk`，不走市场供需），即"按基础价的毛收益"；
 * - 参考编队：**4× T3 长尾鲨导弹巡（5×导弹 MK3 + 支援件）**，技能 = 战斗系 Lv3（= `battle-calibrate`
 *   的 S2/T3 线满配行同款），弹药 = 基础弹管够；这是设计稿 §4.4「4×T3 = 14,000 质量 / 29 回合」的编队。
 *
 * 读数列义：`胜率` = 该场判定我方胜的比例；`时长` = 战斗时钟秒（多播种均值）；`残血` = 我方
 * **全编队**剩余三层血 ÷ 满血；`收益/威胁` = 该层期望原矿价值 ÷ 该层威胁（**应逐层上升**）。
 *
 * **整趟模式（`--runs`）的读数列义**（2026-09-13 二号补注）：`结果` = 撤离成功 / 全损；
 * 「到手」= 真正**入港**的额（撤离成功才有，全损 = 0）；「收集」= 趟内累计（不等于到手）；
 * 汇总下面那行「**回合余量**」= 终局还剩几回合 —— 它用来区分"**盘面没东西可拿**"与"**回合不够拿**"，
 * 两者的处方相反（前者要加产出、后者要加回合）。⚠ 回合是**整趟共用一池**，深入下一层**不刷新**
 * （`wormhole.ts:508`）⇒ 这个数是整趟结束时的余量。
 *
 * ⚠ **版本自检**（口径同「旧数据不可靠」：超过一个大版本必须核对是否与现状偏差过大）
 *   - 游戏版本：**v0.1.0**（`package.json`）· 存档结构：**v25**（`CURRENT_STATE_VERSION`）
 *   - 本工具最后核对：**2026-09-15**（当日核对：层威胁曲线 / 洞内敌卡轮换 / 拾取堆生成 /
 *     **撤离战退役**（船长「虫洞的撤离战取消吧」）——撤离不再触发战斗，解析表删掉该列）
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
  wormholeCardIdForRun,
  wormholeDescend,
  wormholeEnter,
  wormholeExtract,
  wormholeFoeThreat,
  wormholeGridScan,
  wormholeLayerRewardMul,
  wormholeLayerThreat,
  wormholeMakeNode,
  wormholeNodesPerLayer,
  wormholeScanBonusOf,
  wormholeStepCost,
} from '../packages/core/src/wormhole'
import { advanceWormhole, wormholeActivateAt, wormholeStartBattle, wormholeTravelTo } from '../packages/core/src/wormholeBattle'
import {
  wormholeCollectOreAt,
  wormholeDiscardToFit,
  wormholeOverloadBlockReason,
  wormholeLootValueIsk,
  wormholeMinersOf,
  wormholeSalvageAt,
  wormholeSalvagersOf,
  wormholeTakePileAt,
} from '../packages/core/src/wormholeSalvage'
import { WORMHOLE_FOE_BASE_STRENGTH_MUL } from '../packages/core/src/wormholeFoes'
import { isRareWreck, RARE_WRECK_VOLUME_M3 } from '../packages/core/src/salvage'
import {
  gridCellAt,
  gridNebulaTargets,
  gridScanTargets,
  hexDistance,
  hexNeighbors,
  isExitCell,
  isNebulaFogged,
  wormholeMakeGrid,
} from '../packages/core/src/wormholeGrid'
import type { WormholeGridState, WormholePlace } from '../packages/core/src/wormholeGrid'

const ctx: SimContext = buildSimContext()

/**
 * 参考编队（三套 fit · F3c 第二段）：
 * - **`full`（默认 · 满配）**：**11 个槽位全插满** —— 高槽 **3×导弹 MK2 + 打捞器 MK3 + 采集器 MK3**
 *   （作业装备**回高槽**后与火力同槽竞争：船长 2026-09-14「改回高槽」，火力让出 2 位换两件作业装备）、
 *   中槽 推进 + 双盾 + 索敌、低槽 稳像 + 装甲。CPU **226 / 345** ✓（实测脚本核对过槽数与 CPU）。
 * - `combat`：**老难度基准**（5×导弹 + 3 中槽 + 稳像/装甲低槽）——不带作业装备，纯战斗读数用。
 * - `old`：**2026-09-13～09-14 短暂口径的对照**（作业装备占低槽 ⇒ 5×导弹一点不让 + 低槽作业两件）——
 *   该口径已被船长判为"错位 BUG"作废，仅留作读数对照。
 */
const REF_SHIP = 'sh-thresher'
/**
 * **`auto`（2026-09-13 二号追加 · 供"哪套编队最优"的对比）**：按**该舰自己的槽位**自动配装——
 * 高槽按 **打捞器 MK3 → 采集器 MK3 → 导弹 MK2** 取前 N（作业装备优先占位，剩下的位给火力）、
 * 中槽按 推进→双盾→索敌 取前 N、低槽 稳像/装甲 取前 N。
 * 为什么必须用 `auto` 做舰队横向对比：`full/combat/old` 三套都是**长尾鲨的 11 槽配装**，
 * 直接套到 10 槽的鹦鹉螺/13 槽的玳瑁上会**超槽**（`fitted` 是直接赋值的、不走装配校验）⇒
 * 槽少的船会白拿别人的火力，对比就失真了。同一艘船的读数与 `full` 同源。
 */
export type RefFit = 'full' | 'combat' | 'old' | 'auto'
const REF_FIT_FULL = {
  high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-salvager-3', 'mod-miner-3'],
  mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2', 'mod-shield-kin-2'],
  low: ['mod-stab-kin-2', 'mod-armor-kin-2'],
}
const REF_FIT_COMBAT = {
  high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'],
  mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2'],
  low: ['mod-stab-kin-2', 'mod-armor-kin-2'],
}
/** 对照行 = 2026-09-13～09-14 的低槽口径（**已作废**：作业装备现在归高槽；本行仅供读数对照——
 *  配装是直接赋值给 `fitted` 的，不走装配校验，所以这里不放行也能跑） */
const REF_FIT_OLD = {
  high: ['mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2'],
  mid: ['mod-prop-2', 'mod-shield-kin-2', 'mod-track-2'],
  low: ['mod-salvager-3', 'mod-miner-3'],
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

/**
 * **用哪套装配**（`--fit=full|combat|old`，默认 `full` 满配）：
 * 解析表 / 逐卡模式看战斗读数，整趟模式还要看"能不能捞"（不带作业装备 ⇒ 一分钱也捞不上来）。
 */
const FIT_ARG = (process.argv.find((a) => a.startsWith('--fit=')) ?? '--fit=full').split('=')[1]
const ANALYTIC_FIT: RefFit = FIT_ARG === 'combat' ? 'combat' : FIT_ARG === 'old' ? 'old' : FIT_ARG === 'auto' ? 'auto' : 'full'

/**
 * **`--ships=id,id,...`（2026-09-13 二号追加）**：把"参考编队"换成任意编队 ⇒ 用来跑
 * 「哪套编队最优」的横向对比（默认仍是 4×长尾鲨）。与 `--fit=auto` 搭配时按各舰自己的槽位配装。
 * ⚠ 入洞门槛由引擎把关（`wormholeEnter` 失败即抛错），本工具不预先筛。
 */
const SHIPS_ARG = process.argv.find((a) => a.startsWith('--ships='))
const FLEET_IDS: readonly string[] | null = SHIPS_ARG ? SHIPS_ARG.split('=')[1]!.split(',').filter((s) => s.length > 0) : null

/**
 * **`--start-depth=N`（2026-09-13 二号追加 · 加法式）**：整趟从**第 N 层**起跑（默认 1 = 原行为）。
 *
 * 为什么要它：**层 4 在正常编队下根本下不去**（守卫血量门槛会在层 1~3 就把编队逼回去），
 * 而**星云只在层 4 起出现** ⇒ 想量"星云回合税"、想看深层盘面读数，就得能"空降"到那一层。
 * 口径与测试档 `wh-layer4` 一致：`run.depth = N` + 新盘 + **守卫未清**（守卫仍只堵深入）。
 * ⚠ 这不是"玩家能作弊"——它是校准旋钮，用来回答"**假如玩家能在层 N 活动**，那一层值多少"。
 */
const START_DEPTH = Math.max(1, Number((process.argv.find((a) => a.startsWith('--start-depth=')) ?? '--start-depth=1').split('=')[1]))

/** `--fit=auto`：按该舰槽位自动配装（高槽 打捞器→采集器→导弹、中槽推进/双盾/索敌、低槽 稳像/装甲） */
function autoFitFor(defId: string): { high: string[]; mid: string[]; low: string[] } {
  const slots = ctx.ships.get(defId)?.slots ?? { high: 0, mid: 0, low: 0 }
  const highPool = ['mod-salvager-3', 'mod-miner-3', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2', 'mod-turret-kin-2']
  const midPool = ['mod-prop-2', 'mod-shield-kin-2', 'mod-shield-kin-2', 'mod-track-2', 'mod-gyro-2']
  const lowPool = ['mod-stab-kin-2', 'mod-armor-kin-2', 'mod-armor-kin-2', 'mod-armor-plate-2', 'mod-armor-plate-2']
  return {
    high: highPool.slice(0, slots.high ?? 0),
    mid: midPool.slice(0, slots.mid ?? 0),
    low: lowPool.slice(0, slots.low ?? 0),
  }
}


const LAYERS = Number((process.argv.find((a) => a.startsWith('--layers=')) ?? '--layers=8').split('=')[1])
const WAVES = Math.max(1, Number((process.argv.find((a) => a.startsWith('--waves=')) ?? '--waves=1').split('=')[1]))
const SEED_N = Math.max(1, Number((process.argv.find((a) => a.startsWith('--seeds=')) ?? '--seeds=5').split('=')[1]))
/** 洞内敌卡强度系数覆写（**校准用**：只改本工具上下文，引擎仍走 WORMHOLE_FOE_BASE_STRENGTH_MUL） */
const STR = process.argv.find((a) => a.startsWith('--str='))
const STRENGTH = STR ? Number(STR.split('=')[1]) : undefined
const SEEDS = Array.from({ length: SEED_N }, (_, i) => 1 + i * 6)

function makeFleet(seed: number, fit: RefFit = 'full'): { state: GameState; uids: string[] } {
  const state = createInitialState({ nowWallMs: 0, seed })
  state.wallet.isk = 20_000_000
  for (const [id, lv] of Object.entries(SKILLS)) state.skills.trained[id] = lv
  for (const key of ['ammo-kinetic-l', 'ammo-explosive-l', 'ammo-plasma-l']) state.warehouse.items[key] = 5_000
  const refFit = fit === 'old' ? REF_FIT_OLD : fit === 'combat' ? REF_FIT_COMBAT : REF_FIT_FULL
  const uids: string[] = []
  const ids = FLEET_IDS ?? Array.from({ length: 4 }, () => REF_SHIP)
  for (const id of ids) {
    const useFit = fit === 'auto' ? autoFitFor(id) : refFit
    const uid = addShipToFleet(state, id)
    state.fleet[uid]!.fitted = { high: [...useFit.high], mid: [...useFit.mid], low: [...useFit.low] }
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

/** 跑一场真实洞内战斗（推到分出胜负或打满上限）。
 * ⚠ **撤离战（`'extract'`）2026-09-15 已退役**（船长「虫洞的撤离战取消吧」）⇒ 本工具不再跑它。 */
function runOneBattle(
  seed: number,
  depth: number,
  kind: 'node' | 'boss',
  nodeIndex: number,
  cardIndex?: number,
  fit: RefFit = 'full',
): Cell {
  const { state, uids } = makeFleet(seed, fit)
  const cardId =
    cardIndex === undefined
      ? wormholeCardIdForRun({ depth, kind, nodeIndex })
      : WORMHOLE_FOE_CARD_IDS[cardIndex]!
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

/**
 * ⚠ **旧线性口径的层收益读数**（`wormholeMakeNode` / `wormholeNodesPerLayer`）。
 *
 * F3a-2（2026-09-13）起，层内内容由**网格**承载（`run.grid`），线性节点只在老档里存在；
 * 地点收益（墓场/遗迹打捞、矿脉挖掘）要到 **F3b** 才落地 ⇒ 本函数暂时只能给"数量级参考"，
 * **不可作为最终定稿依据**。F3c 配平批会把层内政策（扫描/前往/激活怎么走最省回合）与收益一起重写，
 * 再把 `layerLoot` 换成按网格盘面的期望值。
 */
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

/**
 * **入港读数**（F3c 第二段 · 2026-09-13）。
 *
 * ⚠ 为什么按**仓库/装备库/书架**读、而不是按 `run.bag` 算：虫洞的口径是「**撤离成功才入港**，
 * 半路全损一起丢」⇒ 只有真正落到仓库里的东西才算收益。逐层读数就是这套绝对量的**差分**。
 */
interface Income {
  /** 虚空母矿（单位数 / 基础卖价 ISK） */
  oreUnits: number
  oreIsk: number
  /** 残骸按**回收炉拆解**估值（`baseSellPriceIsk = 1`，只看基础价会算成 0） */
  wreckIsk: number
  /**
   * **稀有残骸（`wreck-rare-*`）件数**（2026-09-13 二号追加 · **目标函数**）。
   *
   * ⚠ **为什么它是主读数、而不是 ISK**（船长 2026-09-13 校正口径）：
   * 「**进虫洞的目的是获得专属装备（稀有残骸，虫洞专属），资产收益只是附带的**」。
   * 虫洞专属装备的唯一来源 = 稀有残骸 → 回收炉开**高级箱** → 该族专属件；
   * 而 `wreckIsk` 里**只算了回收炉的保底矿物**（`wormholeLootValueIsk` 默认**不计**高级箱的
   * `WORMHOLE_RARE_CHEST_NOMINAL_ISK`）⇒ 用 ISK 当目标函数会把"捡到专属装备的机会"
   * 按 1,700 ISK/堆 折算掉，**方向性错误**。
   */
  rareWrecks: number
  /** 虫洞货柜件数（**专属装备/图纸的中间件**；内容物待拆解 ⇒ 不计 ISK）。两种合计：
   *  安全货柜 `box-relic-*`（2×2）+ **图纸货柜 `box-bp-*`**（2×1 · 2026-09-14 新增） */
  boxes: number
  /** 其中**图纸货柜**的件数（`boxes` 的子集；验证"并列 50:50 落到实战"的读数） */
  boxesBp: number
  /** **AI 核心件数**（2026-09-14 新增掉落；出入核心账本，不计入「合计ISK」） */
  cores: number
  /** AI 核心**按市场行价的参考估值**（只作参考，不进合计） */
  coreIsk: number
  /** 族专属无人机（件数 + 基础价 ISK） */
  drones: number
  droneIsk: number
  /** 装备库件数 / 蓝图书架张数（老口径的随行战利品） */
  modules: number
  blueprints: number
}

/**
 * **虫洞货柜**（带回后精炼炉拆解的中间件；内容物待拆解 ⇒ 一律**不计 ISK、只计件数**）：
 * - **安全货柜** `box-relic-*`（按族五种 · 2×2 = 4 格 · 2026-09-13 F4）；
 * - **图纸货柜** `box-bp-*`（按层档三种 · 2×1 = 2 格 · **2026-09-14 船长新增**）。
 *
 * ⚠ 2026-09-14 修：本工具原先只认 `box-relic-` 前缀 ⇒ **新图纸货柜会被漏计**（读数偏低）。
 * 现统一走下面的判据，并把「图纸货柜」单列一列（它同时是"并列比例 50:50 落到实战"的验证读数）。
 */
const isRelicBoxId = (id: string): boolean => id.startsWith('box-relic-')
const isBpBoxId = (id: string): boolean => id.startsWith('box-bp-')
const isContainerId = (id: string): boolean => isRelicBoxId(id) || isBpBoxId(id)
/**
 * **AI 核心**（2026-09-14 船长新增：遗迹打捞 10% 掉落 · 60/30/10 权重 · 各占 1 格）。
 *
 * ⚠ 两个坑，本轮都填了：
 * ① 核心是**形状件**（走 `run.hold.placements`、`kind: 'box'`）⇒ 原先"凡 box 件都算货柜"的写法
 *    会把核心误计成货柜（读数虚高、且会污染"货柜列逐字不变"的核对）；
 * ② 核心**不入仓库**（撤离成功直接进 `state.aiCores`）⇒ 只能从**核心账本**读到手数，
 *    仓库差分那条路（`incomeOf` 的 `warehouse.items` 循环）永远看不到它。
 *
 * 估值口径：按**市场那本账的行价**（2026-09-14 船长定：伽马 20 万 / 贝塔 150 万 / 阿尔法 1000 万信用点；
 * 唯一出处 = `marketCatalog.ts` 的 `core-*` 卡片，这里**从 ctx 现读**、不另抄一份免得两处漂移），
 * **只作参考、不进「合计ISK」**——核心是账本资源（不拆、且贝塔/阿尔法已只收不卖），
 * 进合计会让资产口径与旧读数不可比。
 */
const isCoreId = (id: string): boolean => id.startsWith('ai-core-')
const CORE_TYPE_ORDER = ['gamma', 'beta', 'alpha'] as const
/** 核心账本键 ⇒ 市场行价（读不到 = 0；`core-*` 卡片不在"未上线闸门"里，正常恒可读） */
function coreIskOf(type: (typeof CORE_TYPE_ORDER)[number]): number {
  return ctx.marketGoods.get(`core-${type}`)?.basePrice ?? 0
}

function incomeOf(state: GameState): Income {
  const acc: Income = { oreUnits: 0, oreIsk: 0, wreckIsk: 0, rareWrecks: 0, boxes: 0, boxesBp: 0, cores: 0, coreIsk: 0, drones: 0, droneIsk: 0, modules: 0, blueprints: 0 }
  for (const [id, units] of Object.entries(state.warehouse.items)) {
    const n = Math.max(0, Math.floor(units))
    if (n <= 0) continue
    if (id === WORMHOLE_ORE_ITEM_ID) {
      acc.oreUnits += n
      acc.oreIsk += n * (ctx.items.get(id)?.baseSellPriceIsk ?? 0)
    } else if (id.startsWith('wreck-')) {
      acc.wreckIsk += wormholeLootValueIsk(ctx, id, n)
      if (isRareWreck(id)) acc.rareWrecks += 1 // 1 件 = 30 m³ = 1 个高级箱的原料（不是 30 件）
    } else if (isContainerId(id)) {
      acc.boxes += n
      if (isBpBoxId(id)) acc.boxesBp += n
    } else if (id.startsWith('drone-wh-')) {
      acc.drones += n
      acc.droneIsk += n * (ctx.items.get(id)?.baseSellPriceIsk ?? 0)
    }
  }
  for (const n of Object.values(state.moduleBay ?? {})) acc.modules += Math.max(0, Math.floor(n))
  for (const n of Object.values(state.blueprintStock ?? {})) acc.blueprints += Math.max(0, Math.floor(n))
  // AI 核心不走仓库 ⇒ 从核心账本读（本工具用全新 state，故绝对值 = 本批到手数）
  for (const t of CORE_TYPE_ORDER) {
    const n = Math.max(0, Math.floor(state.aiCores?.[t] ?? 0))
    acc.cores += n
    acc.coreIsk += n * coreIskOf(t)
  }
  return acc
}

const INCOME_KEYS = [
  'oreUnits',
  'oreIsk',
  'wreckIsk',
  'rareWrecks',
  'boxes',
  'boxesBp',
  'cores',
  'coreIsk',
  'drones',
  'droneIsk',
  'modules',
  'blueprints',
] as const satisfies ReadonlyArray<keyof Income>

/**
 * **趟内已收集账**（还没入港）：读 `run.bag`（散货）+ `run.temp`（临时空间的散货）
 * + `run.hold`（形状件：安全货柜 2×2 / 图纸货柜 2×1）。
 *
 * ⚠ 为什么要和 `incomeOf` 分开：虫洞的收益**只有撤离成功才入港**（半路全损一起丢）⇒
 * 仓库差分只能给出"整趟到手多少"，给不出"**哪一层收集了多少**"。逐层配平必须看后者
 * （否则中途收集的东西会被记到"撤离那一层"的账上，层收益曲线全歪）。
 */
interface Ledger {
  oreUnits: number
  oreIsk: number
  wreckIsk: number
  /** 稀有残骸件数（趟内已收）——**目标函数的分子** */
  rareWrecks: number
  /** 货柜件数（两种合计；其中图纸货柜见 `boxesBp`） */
  boxes: number
  /** 其中**图纸货柜**件数（`boxes` 的子集） */
  boxesBp: number
  /** **AI 核心**件数（2026-09-14 新增；核心是 1×1 形状件、撤离后进核心账本） */
  cores: number
}

function runLedger(state: GameState): Ledger {
  const acc: Ledger = { oreUnits: 0, oreIsk: 0, wreckIsk: 0, rareWrecks: 0, boxes: 0, boxesBp: 0, cores: 0 }
  const run = state.wormhole.run
  // 背包（货仓格）+ **临时空间**（大件缓冲，撤离时一并入港 ⇒ 也算"已经拿到手"）
  const slots = [...(run?.bag ?? []), ...(run?.temp ?? [])]
  for (const slot of slots) {
    const n = Math.max(0, Math.floor(slot.units))
    if (n <= 0) continue
    if (slot.itemId === WORMHOLE_ORE_ITEM_ID) {
      acc.oreUnits += n
      acc.oreIsk += n * (ctx.items.get(slot.itemId)?.baseSellPriceIsk ?? 0)
    } else if (slot.itemId.startsWith('wreck-')) {
      acc.wreckIsk += wormholeLootValueIsk(ctx, slot.itemId, n)
      if (isRareWreck(slot.itemId)) acc.rareWrecks += 1 // 1 件 = 30 m³ = 1 个高级箱的原料
    } else if (isContainerId(slot.itemId)) {
      acc.boxes += n
      if (isBpBoxId(slot.itemId)) acc.boxesBp += n
    } else if (isCoreId(slot.itemId)) {
      acc.cores += n
    }
  }
  /**
   * 形状件走 placements（placement 只记 itemId ⇒ 同样按前缀分流）。
   * ⚠ **必须显式分流**：placement 的 `kind: 'box'` 是"形状件"的意思，**不等于货柜** ——
   * 核心（1×1）也是 box 件。原先"凡 box 件都记货柜"会让核心污染货柜列。
   */
  for (const p of run?.hold?.placements ?? []) {
    if (p.kind !== 'box') continue
    if (isCoreId(p.itemId)) acc.cores += 1
    else if (isContainerId(p.itemId)) {
      acc.boxes += 1
      if (isBpBoxId(p.itemId)) acc.boxesBp += 1
    }
  }
  return acc
}

function subLedger(a: Ledger, b: Ledger): Ledger {
  return {
    oreUnits: a.oreUnits - b.oreUnits,
    oreIsk: a.oreIsk - b.oreIsk,
    wreckIsk: a.wreckIsk - b.wreckIsk,
    rareWrecks: a.rareWrecks - b.rareWrecks,
    boxes: a.boxes - b.boxes,
    boxesBp: a.boxesBp - b.boxesBp,
    cores: a.cores - b.cores,
  }
}

/** 收集额（散货估值 + 货柜按件；货柜内容物待拆解 ⇒ 不计 ISK） */
function ledgerIsk(l: Ledger): number {
  return l.oreIsk + l.wreckIsk
}

function subIncome(a: Income, b: Income): Income {
  const out = { ...a }
  for (const k of INCOME_KEYS) out[k] = a[k] - b[k]
  return out
}

/** 一趟到手的 **ISK**（货柜不计：内容物要等拆解批；件数单独报） */
function incomeIsk(i: Income): number {
  return i.oreIsk + i.wreckIsk + i.droneIsk
}

/** 层内动作计数（政策读数：一趟里扫了几次 / 走了几步 / 打捞·采集几次 / 打了几场） */
interface LayerActs {
  scans: number
  moves: number
  salvages: number
  collects: number
  fights: number
  /** 一键抛货次数（超载后玩家必须手动抛；政策用游戏自带的那个按钮） */
  discards: number
  /** **"磨回合"次数**：旧闸门（撤离要求守卫已清）逼出来的歪招（原地转圈等回合耗尽）。
   *  船长 2026-09-13 改裁定「玩家可以无条件开始撤离」后**恒为 0**——留着它当回归证据。 */
  waits: number
}

interface RunOutcome {
  /** 结束方式：撤离成功 / 全损 */
  result: 'extract' | 'lost' | 'unfinished'
  depth: number
  shipsLeft: number
  /** 结束时的编队粗残血 */
  hpFrac: number
  /** 合计到手（撤离成功才有货；全损 = 全 0） */
  income: Income
  /** **逐层"收集"ISK**（下标 = 层号 - 1；收集 ≠ 到手——半路全损就全丢） */
  layerCollected: number[]
  /** 逐层收集到的货柜件数（内容物待拆解，不计 ISK） */
  layerBoxes: number[]
  /** **逐层收到的稀有残骸件数**（专属装备的原料 ⇒ 目标函数的分层读数） */
  layerRares: number[]
  /** 逐层动作数（回合账） */
  layerActs: LayerActs[]
  acts: LayerActs
  turnsLeft: number
  turnsTotal: number
  /** **为驱散星云而多花的扫描动作数**（星云机制的回合税读数；层 1~3 恒 0） */
  nebulaScans: number
  /** **为什么停**（只对"未结束"有意义：某个动作被拒 / 盘面走遍仍没信标 / 步数上限） */
  stopReason: string
  /** `--logs` 时的引擎日志尾（诊断"这趟到底怎么死的"） */
  logs?: string[]
}

/**
 * 整趟政策参数（`--runs` 模式）。
 *
 * ⚠ **已知缺口（2026-09-15 登记）**：本政策**不会处理"临时空间"** —— 洞内拿到的谜质/超格物品进
 * `run.temp` 后，下一次**扫描**会被引擎拒（「临时空间里有 N 件没处理：先到「货仓」页放回货仓或丢弃」），
 * 而政策没有"清临时空间"这一步 ⇒ 趟会**停在那里**（读数记作 `未结束`，收集物**不计入到手**）。
 * 回合预算越高、走得越深越容易撞上（基础 100 的 20 趟里有 5 趟如此）⇒ 看深层读数时**先扣掉未结束趟**，
 * 或给政策补一步"把临时空间搬回货仓/丢弃"（属工具改动，另批）。
 */
interface Policy {
  /** 粗残血低于它就撤（默认 0.5） */
  extractHp: number
  /** 到这一层就撤（默认 3） */
  maxDepth: number
  /** 回合保留：剩这么少就不再收租，直奔守卫/出口（默认 2） */
  reserve: number
  /** 血量低于它就不再主动去"舰船信号"（到了就地开打，没法挑） */
  shipHpMin: number
  /**
   * 血量低于它就**不再硬打层末守卫**，直接开始撤离（`0` = 永远硬打）。
   *
   * 船长 2026-09-13 改裁定后：撤离**无条件可以开始**；⚠ 2026-09-15 起**撤离不再触发战斗**
   * （「虫洞的撤离战取消吧」）⇒ 这条是"保守打法"的开关：残血时保住已收集的货，
   * 把守卫（与更深层）让给下一次。负数/0 = 激进打法（永远硬打守卫拿深度）。
   */
  bossHpMin: number
}

/**
 * **层内政策**（"一个正常玩家"· F3c 第二段）：**只走玩家能走的路**——出口位置在
 * `grid.exitKnown === false` 时**不许偷看** `grid.exit`（信标到达才置 true），没读到就继续探索。
 *
 * 优先级（回合紧张时换序）：遗迹 → 墓场 → 矿脉 → 信标 → 舰船信号；都要"已扫描、没到过"，
 * 并按装备与血量过滤（没打捞器不去墓场/遗迹、没采集器不去矿脉、血太少不主动撞舰船信号）。
 */
function pickTarget(
  g: WormholeGridState,
  rigs: number,
  miners: number,
  hp: number,
  urgent: boolean,
): { q: number; r: number } | null {
  const prio: WormholePlace[] = urgent
    ? ['beacon', 'vein', 'graveyard', 'ruins', 'ship']
    : ['ruins', 'graveyard', 'vein', 'beacon', 'ship']
  for (const place of prio) {
    if ((place === 'graveyard' || place === 'ruins') && rigs <= 0) continue
    if (place === 'vein' && miners <= 0) continue
    if (place === 'ship' && hp < 0.6) continue
    if (place === 'beacon' && g.exitKnown === true) continue
    const cands = g.cells.filter(
      (c) => c.place === place && g.scanned.includes(c.key) && !g.visited.includes(c.key),
    )
    if (cands.length === 0) continue
    // 就近走（回合与距离无关，这只是"像人一样不瞎绕"）
    cands.sort((a, b) => hexDistance(a, g.pos) - hexDistance(b, g.pos) || a.key.localeCompare(b.key))
    return { q: cands[0]!.q, r: cands[0]!.r }
  }
  return null
}

/**
 * **跑一整趟**（真状态机 + 真战斗 + 真打捞/采集）：进洞 → 逐层按政策扫/走/打捞/采集/开战 →
 * 找信标 → 打层末守卫 → 按政策决定深入或撤离 ⇒ 读**真正入港**的收益与逐层分布。
 */
function simulateRun(seed: number, pol: Policy, fit: RefFit): RunOutcome {
  const { state, uids } = makeFleet(seed, fit)
  const before = incomeOf(state)
  const enter = wormholeEnter(state, ctx, uids, seed)
  if (!enter.ok) throw new Error(`入洞失败：${enter.error ?? ''}`)
  /**
   * **空降到 `--start-depth=` 指定的层**（默认 1 ⇒ 不动）。口径与测试档 `wh-layer4` 一致：
   * 层号改写 + **按该层重生成一张盘**（同 seed/层 ⇒ 确定性）+ 守卫未清（守卫仍只堵深入）。
   * 回合预算仍按入场校验给（不是"每层重置"）——那正是真实的整趟口径。
   */
  if (START_DEPTH > 1) {
    const r0 = state.wormhole.run!
    r0.depth = START_DEPTH
    r0.nodesPerLayer = wormholeNodesPerLayer(START_DEPTH)
    r0.grid = wormholeMakeGrid(seed, START_DEPTH, wormholeScanBonusOf(ctx, r0.fleet))
    r0.bossCleared = 0
  }
  let guard = 0
  /** 最近一场战斗结束时的**三层血口径**残血（政策用它；护盾不落档，见 `battleHpFrac`） */
  let lastFrac = 1
  /**
   * **逐层动作数**（回合 = 硬约束 ⇒ 每层花在扫/走/打捞/采集/交战上几回合，是配平的关键读数）。
   * `bump()` 记一次动作；整趟的合计在返回时按层求和。
   */
  const layerActs: LayerActs[] = []
  const actsAt = (d: number): LayerActs => {
    while (layerActs.length < d) {
      layerActs.push({ scans: 0, moves: 0, salvages: 0, collects: 0, fights: 0, discards: 0, waits: 0 })
    }
    return layerActs[d - 1]!
  }
  const bump = (k: keyof LayerActs): void => {
    actsAt(state.wormhole.run?.depth ?? 1)[k] += 1
  }
  const layerCollected: number[] = []
  const layerBoxes: number[] = []
  /** 逐层**稀有残骸件数**（目标函数的分层读数） */
  const layerRares: number[] = []
  let lastSnap = runLedger(state)
  /** **为驱散星云而多花的扫描动作数**（星云机制的回合税读数；层 1~3 恒 0） */
  let nebulaScans = 0
  const turnsTotal = enter.run?.turnsTotal ?? 0
  /** **停止原因**（只对"未结束"有意义：把"卡在哪一步"如实带出来，而不是让人对着 0 收益猜） */
  let stopReason = ''
  const stop = (why: string): void => {
    stopReason = why
  }
  /** `--trace`：逐步打印政策动作（核对政策用；默认关） */
  const trace = process.argv.includes('--trace')
  let step = 0
  /** 最后一次看到的剩余回合（run 一结束就读不到了，但读数要它） */
  let lastTurns = turnsTotal

  /**
   * **逐层记账**（每一拍调用一次）：把 `runLedger` 的**正增量**归到当前层。
   *
   * 为什么不是"深入时结账"：`run.bag` 会在**撤离结算**那一刻被清空（货进仓库）⇒ 如果按时刻做差，
   * 最后一层会算出负额。故改成"只累加增量、负增量只重置基线"：
   * - 打捞/采集/舰船战果让 `run.bag` 变大 ⇒ 记进当前层 ✓
   * - 撤离入港 / 抛货让 `run.bag` 变小 ⇒ 不冲销（那是"能不能带回港"的问题，由整趟的 `income` 回答）
   */
  const accrue = (): void => {
    const now = runLedger(state)
    const d = subLedger(now, lastSnap)
    const gain = ledgerIsk(d)
    const depth = state.wormhole.run?.depth ?? 1
    if (gain > 0 || d.boxes > 0 || d.rareWrecks > 0) {
      while (layerCollected.length < depth) {
        layerCollected.push(0)
        layerBoxes.push(0)
        layerRares.push(0)
      }
      layerCollected[depth - 1] = (layerCollected[depth - 1] ?? 0) + Math.max(0, gain)
      layerBoxes[depth - 1] = (layerBoxes[depth - 1] ?? 0) + Math.max(0, d.boxes)
      layerRares[depth - 1] = (layerRares[depth - 1] ?? 0) + Math.max(0, d.rareWrecks)
    }
    lastSnap = now
  }

  while (state.wormhole.run && guard++ < 4000) {
    state.gameMs += 1_000 // 与引擎心跳同款：推时间，战斗才走得动
    const r = state.wormhole.run
    lastTurns = r.turnsLeft
    accrue()
    if (r.battle) {
      if (r.battle.ended) lastFrac = battleHpFrac(r.battle)
      advanceWormhole(state, ctx)
      continue
    }
    if (r.phase === 'extracting') {
      advanceWormhole(state, ctx)
      continue
    }
    if (r.grid) {
      const g = r.grid
      if (trace) {
        step += 1
        if (step <= 120) {
          console.log(
            `    · #${step} 层${r.depth} (${g.pos.q},${g.pos.r}) 回合${r.turnsLeft} ` +
              `已扫${g.scanned.length}/${g.cells.length} 守卫${(r.bossCleared ?? 0) >= r.depth ? '清' : '在'} ` +
              `信标${g.exitKnown === true ? '已读' : '未读'}`,
          )
        }
      }
      const here = gridCellAt(g, g.pos)
      if (!here) {
        stop('当前位置不在网格里')
        break
      }
      const rigs = wormholeSalvagersOf(state, ctx)
      const miners = wormholeMinersOf(state, ctx)
      const hp = lastFrac > 0 ? lastFrac : roughHpFrac(state, r.fleet)
      const bossDone = (r.bossCleared ?? 0) >= r.depth
      // ⓪ 回合走不动（逃生门）：撤离（2026-09-15 起撤离零战斗、下一拍直接入港）
      if (r.turnsLeft <= 0) {
        const ex = wormholeExtract(r)
        if (!ex.ok) {
          stop(`回合耗尽且撤离被拒：${ex.error ?? ''}`)
          break
        }
        continue
      }
      /**
       * ⓪a **遗迹战「先确认再跳转」闸门**（船长 2026-09-13：「打捞遗迹触发战斗时，虫洞界面处于最前端
       * 遮住了战斗，且战斗突然发生没有任何提示，应该提示玩家惊扰守卫等，**玩家确认后跳转**」）：
       * 打捞遗迹掷中收尾战时引擎**不直接开战**，只留 `run.pendingRuinsBattle`，此后
       * **扫描 / 前往 / 采集 / 打捞一律被拦**（`wormhole.ts` 的 `gridActionBlocked`）。
       *
       * ⚠⚠ **本工具漏了这一步 ⇒ 2026-09-14 那一轮复跑读数全部作废**：政策不"点迎战" ⇒ 一旦触发就
       * **整趟死锁**（余 20+ 回合却动不了），实测 20 趟里 9 趟停在这句、稀有残骸从 2.15 掉到 0.70 件/趟。
       * 玩家的做法就是点「迎战」，引擎侧早已支持 `wormholeStartBattle(state, ctx, 'ruins')`（见
       * `wormholeBattle.ts` 的说明），这里照玩家做法补上。
       */
      if (r.pendingRuinsBattle === true) {
        const ok = wormholeStartBattle(
          state,
          ctx,
          'ruins',
          state.gameMs,
          STRENGTH === undefined ? undefined : { strengthMul: STRENGTH },
        ).ok
        if (!ok) {
          stop('遗迹收尾战开战失败')
          break
        }
        bump('fights')
        continue
      }
      /**
       * ⓪b **超载**（沉船缩容后货仓装不下）：船长裁定 8 要求**玩家手动抛弃** ⇒
       * 政策照玩家的做法点游戏里那个「一键抛到容量内」按钮（按每格价值从低到高），然后继续。
       */
      const ov = wormholeOverloadBlockReason(state, ctx)
      if (ov) {
        const tie = wormholeDiscardToFit(state, ctx)
        if (!tie.ok) {
          stop(`超载且没有可抛的货：${ov}`)
          break
        }
        bump('discards')
        continue
      }
      // ① 本格还有活 ⇒ 做完（打捞/采集一次 = 1 回合、回收 = 台数 堆）
      if ((here.place === 'graveyard' || here.place === 'ruins') && (here.piles ?? []).length > 0 && rigs > 0) {
        const sv = wormholeSalvageAt(state, ctx)
        if (!sv.ok) {
          stop(`打捞被拒：${sv.error ?? ''}`)
          break
        }
        bump('salvages')
        continue
      }
      if (here.place === 'vein' && (here.piles ?? []).length > 0 && miners > 0) {
        const co = wormholeCollectOreAt(state, ctx)
        if (!co.ok) {
          stop(`采集被拒：${co.error ?? ''}`)
          break
        }
        bump('collects')
        continue
      }
      // ② 还有得赚就继续收租（回合紧张时只认信标 ⇒ 直奔出口）
      const urgent = r.turnsLeft <= pol.reserve + 3
      /**
       * ②b **打不过守卫就直接撤**（`--boss-hp=` 门槛）。
       *
       * 船长 2026-09-13 改裁定：「**玩家可以无条件开始撤离，但是依旧需要打撤离战**」⇒
       * 残血时不必硬打守卫（实测：搜打撤编队在层 1 守卫战全灭），随时能走。
       * ⚠ **2026-09-15 起撤离不再触发任何战斗**（船长「虫洞的撤离战取消吧」）⇒ "随时能走"变成**零代价**；
       * 守卫**只堵"深入"**。
       *
       * ⚠ 本工具早前那一版政策在这里"原地转圈磨回合、等回合耗尽走逃生门"——那正是旧闸门逼出来的歪招，
       * 已随新裁定删除（政策里留 `waits` 这一格是为了证明它现在恒为 0）。
       */
      const tooHurtForBoss = !bossDone && pol.bossHpMin > 0 && hp < pol.bossHpMin
      const target = bossDone && r.depth >= pol.maxDepth
        ? null
        : pickTarget(g, rigs, miners, tooHurtForBoss ? 0 : hp, urgent)
      if (target) {
        const res = wormholeTravelTo(state, ctx, target, {})
        if (!res.ok) {
          stop(`前往目标被拒：${res.error ?? ''}`)
          break
        }
        bump('moves')
        continue
      }
      if (tooHurtForBoss) {
        const ex = wormholeExtract(r)
        if (!ex.ok) {
          stop(`撤离被拒：${ex.error ?? ''}`)
          break
        }
        continue
      }
      // ③ 收租完毕（或不值得再收）⇒ 打层末守卫：站上入口格并激活
      if (!bossDone) {
        if (g.exitKnown !== true) {
          /**
           * ③a **已知信标但还没读到终点** ⇒ 去"走"它一趟。
           *
           * ⚠ 这里含一个**边角洞**（2026-09-13 本工具跑出来的）：信标可能生成在**入口格**上，
           * 而"到达即读出终点"只在 `wormholeGridTravel` 里触发（入口格开局就 `visited`、
           * 不经过移动到达）⇒ 玩家**站在信标上却读不到出口**，只能"先走开一回合、再走回来"破解。
           * 本政策照玩家的做法走：脚下是信标 ⇒ 先挪到邻格，下一轮再回来。
           */
          const beacon = g.cells.find((c) => c.place === 'beacon' && g.scanned.includes(c.key))
          if (beacon) {
            const hereKey = `${g.pos.q},${g.pos.r}`
            if (beacon.key === hereKey) {
              const step = hexNeighbors(g.pos)
                .map((n) => gridCellAt(g, n))
                .find((c) => !!c && c.key !== beacon.key && !isExitCell(g, c))
              if (step) {
                const res = wormholeTravelTo(
                  state,
                  ctx,
                  { q: step.q, r: step.r },
                  { confirmUnknown: !g.scanned.includes(step.key) },
                )
                if (!res.ok) {
                  stop(`信标压在入口格：挪开被拒：${res.error ?? ''}`)
                  break
                }
                bump('moves')
                continue
              }
            } else {
              const res = wormholeTravelTo(
                state,
                ctx,
                { q: beacon.q, r: beacon.r },
                { confirmUnknown: !g.scanned.includes(beacon.key) },
              )
              if (!res.ok) {
                stop(`前往信标被拒：${res.error ?? ''}`)
                break
              }
              bump('moves')
              continue
            }
          }
          // 还没扫到信标 ⇒ 继续探索（不许偷看 grid.exit）
          if (gridScanTargets(g).length > 0) {
            const sc = wormholeGridScan(state)
            if (!sc.ok) {
              stop(`扫描被拒：${sc.error ?? ''}`)
              break
            }
            bump('scans')
            continue
          }
          /**
           * **星云要"再扫一次"才散**（船长 2026-09-13 星云机制）——层 4 起盘面会有被云罩住的格。
           *
           * ⚠ 本工具原先只认"有没有新格可揭"，**没有"为驱散而再扫一次"这条路** ⇒ 在层 4+
           * 要么白丢回合（读了也想不起来去散云）、要么直接以"盘面走遍仍没读到信标"收场。
           * 补法：圈里还有没散的星云（`gridNebulaTargets`）就照玩家的做法再扫一次；
           * 但**只在盘面还有盲区时**这么做（否则白花回合——见上一条"盘面走遍"的判据）。
           */
          if (gridNebulaTargets(g).length > 0 && g.scanned.length < g.cells.length) {
            const sc = wormholeGridScan(state)
            if (!sc.ok) {
              stop(`驱散星云被拒：${sc.error ?? ''}`)
              break
            }
            bump('scans')
            nebulaScans += 1
            continue
          }
          const unknown = g.cells.find((c) => !g.scanned.includes(c.key))
          if (unknown) {
            const res = wormholeTravelTo(state, ctx, { q: unknown.q, r: unknown.r }, { confirmUnknown: true })
            if (!res.ok) {
              stop(`前往未知格被拒：${res.error ?? ''}`)
              break
            }
            bump('moves')
            continue
          }
          // 盘面走遍仍没读到信标（理论上不会：每层至少 1 个）⇒ 只能撤离
          const ex = wormholeExtract(r)
          stop(`盘面走遍仍没读到信标；撤离${ex.ok ? '成功' : `被拒：${ex.error ?? ''}`}`)
          break
        }
        if (isExitCell(g, g.pos)) {
          const ac = wormholeActivateAt(state, ctx, state.gameMs)
          if (!ac.ok) {
            stop(`入口激活被拒：${ac.error ?? ''}`)
            break
          }
          bump('fights')
          continue
        }
        /**
         * ⚠ 第二个边角（同一个洞的亲戚）：**出口格自己可能从没被扫过**（它不参与信号分配 ⇒ 没被扫就没有
         * "已扫描"标记）⇒ 直接前往会被"这个地点还没扫描过"拦下。玩家的做法就是点「确认前往」，
         * 故这里带上 `confirmUnknown`（信标已经告诉我们终点在哪，这一步只是走过去）。
         */
        const exitCell = gridCellAt(g, { q: g.exit.q, r: g.exit.r })
        const res = wormholeTravelTo(
          state,
          ctx,
          { q: g.exit.q, r: g.exit.r },
          { confirmUnknown: !exitCell || !g.scanned.includes(exitCell.key) },
        )
        if (!res.ok) {
          stop(`前往入口被拒：${res.error ?? ''}`)
          break
        }
        bump('moves')
        continue
      }
      // ④ 守卫已清 ⇒ 按政策深入或撤离（血量 / 深度 / 回合）
      if (r.depth >= pol.maxDepth || hp < pol.extractHp || r.turnsLeft <= 0) {
        const ex = wormholeExtract(r)
        if (!ex.ok) {
          stop(`撤离被拒：${ex.error ?? ''}`)
          break
        }
      } else {
        const dn = wormholeDescend(state, state.rng.seed, wormholeScanBonusOf(ctx, r.fleet))
        if (!dn.ok) {
          stop(`深入被拒：${dn.error ?? ''}`)
          break
        }
      }
      continue
    }
    // ── 老档线性层（兼容路径）：拾取点捡光 → 推进 → 守卫 → 深入/撤离 ──
    if (r.pendingNode) {
      if (r.pendingNode.kind === 'combat') {
        if (!wormholeStartBattle(state, ctx, 'node', state.gameMs, STRENGTH === undefined ? undefined : { strengthMul: STRENGTH }).ok) { stop('线性层：节点开战失败'); break }
      } else {
        while ((r.pendingNode.piles ?? []).length > 0) {
          if (!wormholeTakePileAt(state, ctx, 0).ok) break
        }
        if (!wormholeAdvanceNode(ctx, r, state.rng.seed).ok) wormholeExtract(r)
      }
      continue
    }
    if ((r.bossCleared ?? 0) < r.depth) {
      if (!wormholeStartBattle(state, ctx, 'boss', state.gameMs, STRENGTH === undefined ? undefined : { strengthMul: STRENGTH }).ok) { stop('线性层：守卫开战失败'); break }
      continue
    }
    const frac = lastFrac > 0 ? lastFrac : roughHpFrac(state, r.fleet)
    if (r.depth >= pol.maxDepth || frac < pol.extractHp || r.turnsLeft <= 0) wormholeExtract(r)
    else wormholeDescend(state, state.rng.seed, wormholeScanBonusOf(ctx, r.fleet))
  }

  if (state.wormhole.run) stopReason = stopReason || '步数上限（4000 步没走完）'
  const after = incomeOf(state)
  accrue() // 收尾再记一次（把最后一段增量归到当前层）
  const shipsLeft = uids.filter((u) => state.fleet[u]).length
  return {
    // 结束方式按**状态机**判（不是按"有没有捞到矿"——那会把"这趟没碰到矿脉"误判成全损）
    result: state.wormhole.run !== null ? 'unfinished' : shipsLeft > 0 ? 'extract' : 'lost',
    depth: state.wormhole.run?.depth ?? Math.max(1, layerCollected.length),
    shipsLeft,
    hpFrac: roughHpFrac(state, uids),
    income: subIncome(after, before),
    layerCollected,
    layerBoxes,
    layerRares,
    layerActs,
    acts: layerActs.reduce((s, a) => ({ scans: s.scans + a.scans, moves: s.moves + a.moves, salvages: s.salvages + a.salvages, collects: s.collects + a.collects, fights: s.fights + a.fights, discards: s.discards + a.discards, waits: s.waits + a.waits }), { scans: 0, moves: 0, salvages: 0, collects: 0, fights: 0, discards: 0, waits: 0 }),
    turnsLeft: state.wormhole.run?.turnsLeft ?? lastTurns,
    turnsTotal,
    nebulaScans,
    stopReason,
    ...(process.argv.includes('--logs') ? { logs: state.logs.map((l) => l.text) } : {}),
  }
}

/**
 * 逐层聚合（**配平的主读数**）：把每趟的"逐层收集 ISK"与"逐层动作数"按层号聚合，与层威胁并排 ⇒
 * 直接看两件事：①「**层收集 ÷ 层威胁**是否逐层上升」（船长口径：深层收益要比难度曲线更高）；
 * ②「**每动作收集额**」（回合是硬约束：一层里能做的动作数决定了你到底能带走多少）。
 */
interface LayerRow {
  samples: number
  isk: number
  oreUnits: number
  wrecks: number
  /** **稀有残骸件数**（该层收到手的；目标函数的分层读数） */
  rares: number
  boxes: number
  /** 该层的动作数合计（扫/走/打捞/采集/交战/抛货/磨回合） */
  acts: number
}

function runRunsMode(): void {
  const n = Math.max(1, Number((process.argv.find((a) => a.startsWith('--runs=')) ?? '--runs=20').split('=')[1]))
  const pol: Policy = {
    extractHp: Number((process.argv.find((a) => a.startsWith('--extract-hp=')) ?? '--extract-hp=0.5').split('=')[1]),
    maxDepth: Math.max(1, Number((process.argv.find((a) => a.startsWith('--max-depth=')) ?? '--max-depth=3').split('=')[1])),
    reserve: Math.max(0, Number((process.argv.find((a) => a.startsWith('--reserve=')) ?? '--reserve=2').split('=')[1])),
    shipHpMin: 0.6,
    bossHpMin: Number((process.argv.find((a) => a.startsWith('--boss-hp=')) ?? '--boss-hp=0.55').split('=')[1]),
  }
  const fit: RefFit = ANALYTIC_FIT
  const fitText: Record<RefFit, string> = {
    full: '**满配**：3×导弹 MK2 + 打捞器 MK3 + 采集器 MK3（高槽） + 推进/双盾/索敌 + 稳像/装甲（11 槽插满 · CPU 226/345）',
    combat: '纯战斗：5×导弹 MK2 + 3 中槽 + 稳像/装甲（不带作业装备 ⇒ 捞不到东西）',
    old: '对照（已作废）：5×导弹 + 打捞器/采集器**占低槽**（2026-09-13～09-14 的短暂口径）',
  }
  /**
   * ⚠ 2026-09-14 修：原先是 `参考编队 4×巡洋「${fitText[fit]}」` —— 一旦用 `--ships=` 换编队，
   * 「4×巡洋」与 `fitText` 就都名不副实（实测打印出「4×巡洋「undefined」」：`fitText` 是**配装**文案，
   * 不是舰名）。现改为**按实际编队报舰名**（同型写「4× 舰名」，混编逐个列）。
   */
  const shipIds = SHIPS_ARG ? SHIPS_ARG.split(',').map((s) => s.trim()).filter(Boolean) : []
  const fleetLabel =
    shipIds.length === 0
      ? `4×${ctx.ships.get(REF_SHIP)?.name ?? REF_SHIP}（默认）`
      : new Set(shipIds).size === 1
        ? `${shipIds.length}×${ctx.ships.get(shipIds[0]!)?.name ?? shipIds[0]}`
        : shipIds.map((id) => ctx.ships.get(id)?.name ?? id).join(' + ')
  console.log(
    `整趟模拟 · ${n} 趟（**强度系数 ${WORMHOLE_FOE_BASE_STRENGTH_MUL * (STRENGTH ?? 1)}**（覆写 ${STRENGTH ?? '无'}）· ` +
      `参考编队 ${fleetLabel}「${fitText[fit]}」）`,
  )
  console.log(
    `  政策：粗残血 < ${pol.extractHp} 或到第 ${pol.maxDepth} 层就撤（撤离开放：随时能走，零战斗）· ` +
      `回合保留 ${pol.reserve} · 守卫血量门槛 ${pol.bossHpMin}（低于它就直接撤；守卫只堵深入）· ` +
      `优先 遗迹→墓场→矿脉→信标→舰船信号 · 出口只认**信标**（不许偷看盘面）`,
  )
  console.log(
    ['#', '结果', '到达层', '存活', '★稀有残骸(件)', '★货柜(件)', '其中图纸货柜', '★AI核心(枚)', '母矿', '母矿ISK', '残骸ISK', '无人机', '合计ISK', '扫描', '移动', '打捞', '采集', '交战', '抛货', '磨回合', '余回合', '停止原因'].join('\t'),
  )
  const out: RunOutcome[] = []
  for (let i = 0; i < n; i++) {
    const o = simulateRun(1000 + i * 37, pol, fit)
    out.push(o)
    const f = (x: number): string => Math.round(x).toLocaleString('zh-CN')
    console.log(
      [
        i + 1,
        o.result === 'extract' ? '撤离成功' : o.result === 'lost' ? '全损' : '未结束',
        o.depth,
        `${o.shipsLeft}/4`,
        o.income.rareWrecks,
        o.income.boxes,
        o.income.boxesBp,
        o.income.cores,
        o.income.oreUnits,
        f(o.income.oreIsk),
        f(o.income.wreckIsk),
        o.income.drones,
        f(incomeIsk(o.income)),
        o.acts.scans,
        o.acts.moves,
        o.acts.salvages,
        o.acts.collects,
        o.acts.fights,
        o.acts.discards,
        o.acts.waits,
        o.turnsLeft,
        o.result === 'extract' ? '' : o.stopReason,
      ].join('\t'),
    )
  }
  if (process.argv.includes('--logs')) {
    for (const [i, o] of out.entries()) {
      console.log(`\n--- 第 ${i + 1} 趟（${o.result} · 层 ${o.depth} · ${o.stopReason.length > 0 ? o.stopReason : '正常结束'}）日志尾 30 条 ---`)
      for (const line of (o.logs ?? []).slice(-30)) console.log(`    ${line}`)
    }
  }
  const ok = out.filter((o) => o.result === 'extract')
  const avg = (f: (o: RunOutcome) => number): number => out.reduce((s, o) => s + f(o), 0) / out.length
  const lostShips = out.reduce((s, o) => s + (4 - o.shipsLeft), 0)
  /**
   * **目标函数行**（2026-09-13 二号追加 · 船长校正口径后的主读数）。
   *
   * 船长原话：「**进虫洞的目的是获得专属装备（稀有残骸，虫洞专属），资产收益只是附带的**」⇒
   * 看配置优劣先看这一行（**稀有残骸件数 + 货柜件数**），ISK 只在同一条线上做参考。
   * 「回收率」= 已收到手的稀有残骸 ÷ 趟内曾经收进包的（分母含全损趟里丢掉的那些）。
   */
  const rareGot = avg((o) => o.income.rareWrecks)
  const rareCollected = avg((o) => o.layerRares.reduce((s, v) => s + v, 0))
  const boxGot = avg((o) => o.income.boxes)
  const boxBpGot = avg((o) => o.income.boxesBp)
  const coreGot = avg((o) => o.income.cores)
  const coreIskGot = avg((o) => o.income.coreIsk)
  console.log(
    `        **专属产出（目标函数）**：稀有残骸 **${rareGot.toFixed(2)} 件/趟**` +
      `（1 件 = ${RARE_WRECK_VOLUME_M3} m³ = 1 个高级箱的原料；1 箱开出 1 件该族专属装备或专属图纸）· ` +
      `**货柜 ${boxGot.toFixed(2)} 件/趟**` +
      `（安全货柜 ${(boxGot - boxBpGot).toFixed(2)} + **图纸货柜 ${boxBpGot.toFixed(2)}**；层 2 起才出）· ` +
      `回收率 ${rareCollected > 0 ? ((rareGot / rareCollected) * 100).toFixed(0) : '—'}%` +
      `（全损趟连稀有残骸一起丢）`,
  )
  /**
   * **AI 核心**（2026-09-14 船长新增：遗迹打捞 10% · 60/30/10 · 各占 1 格 · 层 1 也给）。
   * 单列一行而不是并进「合计ISK」：核心走**核心账本**（不卖不拆），并进去会让资产口径与旧读数不可比；
   * 参考估值按市场行价（2026-09-14 船长定：伽马 20 万 / 贝塔 150 万 / 阿尔法 1000 万信用点）。
   */
  console.log(
    `        **AI 核心（遗迹打捞）**：**${coreGot.toFixed(3)} 枚/趟**` +
      `（按行价参考 ≈ ${Math.round(coreIskGot).toLocaleString('zh-CN')} ISK/趟 —— **不进上面的「合计ISK」**）` +
      ` · 出货率 10% · 权重 伽马 60 / 贝塔 30 / 阿尔法 10 · 层 1 起就出 · 自动探索按 ×40% 折算`,
  )
  console.log(
    `        纯资产（附带）：平均到手 ${Math.round(avg((o) => incomeIsk(o.income))).toLocaleString('zh-CN')} ISK` +
      `（母矿 ${Math.round(avg((o) => o.income.oreUnits))} 单位 / ${Math.round(avg((o) => o.income.oreIsk)).toLocaleString('zh-CN')} ISK` +
      ` + 残骸拆解（**只算保底矿物，不含高级箱**）${Math.round(avg((o) => o.income.wreckIsk)).toLocaleString('zh-CN')} ISK）` +
      ` · 撤离 ${ok.length}/${out.length} · 平均第 ${avg((o) => o.depth).toFixed(1)} 层 · ` +
      `存活 ${avg((o) => o.shipsLeft).toFixed(2)}/4（合计损失 ${lostShips} 艘）`,
  )
  /**
   * **回合余量**（2026-09-13 二号追加 · 判断"到底是什么卡住了收益"）。
   *
   * 为什么要报它：早前只看"每动作收益"会把**盘面没东西可拿**误读成**回合不够拿**——两者的处方完全相反
   * （前者要加产出、后者要加回合）。逐趟打过 `--trace` 才确认：收租收完就直接去信标/守卫了，
   * 余回合数并不小 ⇒ 收益上限由**盘面可收的量**决定。余回合接近 0 才说明回合真的见底。
   * ⚠ 口径：整趟共用**一个**回合池（`turnsLeft` 在深入下一层时**不刷新**，见 `wormhole.ts:508`）⇒
   * 这个数是"整趟结束时剩多少"，不是"每层剩多少"。
   */
  console.log(
    `        回合余量：终局平均剩 ${avg((o) => o.turnsLeft).toFixed(1)} 回合（预算 ${
      out[0] ? out[0].turnsTotal : '—'
    } 回合/趟，整趟共用一池，深入不刷新）· 平均动作 ${avg((o) =>
      o.acts.scans + o.acts.moves + o.acts.salvages + o.acts.collects + o.acts.fights + o.acts.discards,
    ).toFixed(1)} 次` +
      `（扫 ${avg((o) => o.acts.scans).toFixed(1)} / 走 ${avg((o) => o.acts.moves).toFixed(1)} / 打捞 ${avg((o) => o.acts.salvages).toFixed(1)}` +
      ` / 采集 ${avg((o) => o.acts.collects).toFixed(1)} / 交战 ${avg((o) => o.acts.fights).toFixed(1)} / 抛货 ${avg((o) => o.acts.discards).toFixed(1)}）`,
  )
  /**
   * **星云回合税**（2026-09-13 二号追加 · 星云机制落地后的读数）：为驱散星云而**多花的扫描动作数**。
   * 层 1~3 恒 0（那儿没有星云）；层 4+ 才非 0 —— 这是"星云到底吃掉多少回合"的唯一读数。
   */
  const nebulaScansAvg = avg((o) => o.nebulaScans)
  const nebulaRuns = out.filter((o) => o.nebulaScans > 0).length
  console.log(
    `        星云回合税：平均 **${nebulaScansAvg.toFixed(2)} 个扫描动作/趟**` +
      `（${nebulaRuns}/${out.length} 趟至少驱散过一次；层 1~3 恒 0，层 4 起才有云；已计入上面的"扫"列）`,
  )
  const collectedAvg = avg((o) => o.layerCollected.reduce((s, v) => s + v, 0))
  console.log(
    `        收集 ${Math.round(collectedAvg).toLocaleString('zh-CN')} ISK/趟 ⇒ **到手率 ` +
      `${collectedAvg > 0 ? ((avg((o) => incomeIsk(o.income)) / collectedAvg) * 100).toFixed(0) : '—'}%**` +
      `（收集 ≠ 到手：没撤离成功的那部分随趟一起丢）`,
  )
  // 逐层聚合（与层威胁并排 ⇒ 看"单位威胁收益"是否逐层上升）
  const rows = new Map<number, LayerRow>()
  for (const o of out) {
    o.layerCollected.forEach((isk, idx) => {
      const d = idx + 1
      const row = rows.get(d) ?? { samples: 0, isk: 0, oreUnits: 0, wrecks: 0, rares: 0, boxes: 0, acts: 0 }
      const a = o.layerActs[idx]
      row.samples += 1
      row.isk += isk
      row.boxes += o.layerBoxes[idx] ?? 0
      row.rares += o.layerRares[idx] ?? 0
      row.acts += a ? a.scans + a.moves + a.salvages + a.collects + a.fights + a.discards + a.waits : 0
      rows.set(d, row)
    })
  }
  console.log('\n逐层读数（**按层累加"收集"额 + 该层动作数**；样本 = 走到过这一层的趟数）：')
  console.log(['层', '样本', '稀有残骸/层', '平均动作数', '每动作稀有/100', '平均收集ISK', '每动作ISK', '货柜/层', '层威胁', 'ISK/威胁', '较上层'].join('\t'))
  let prevRatio = 0
  for (let d = 1; d <= Math.max(...out.map((o) => o.depth), 1); d++) {
    const row = rows.get(d)
    if (!row || row.samples === 0) continue
    const isk = row.isk / row.samples
    const acts = row.acts / row.samples
    const rares = row.rares / row.samples
    const threat = wormholeLayerThreat(d)
    const ratio = isk / threat
    console.log(
      [
        d,
        row.samples,
        rares.toFixed(2),
        acts.toFixed(1),
        acts > 0 ? (rares / acts * 100).toFixed(1) : '—',
        Math.round(isk).toLocaleString('zh-CN'),
        acts > 0 ? Math.round(isk / acts).toLocaleString('zh-CN') : '—',
        row.boxes.toFixed(2),
        threat,
        ratio.toFixed(0),
        prevRatio > 0 ? `${ratio >= prevRatio ? '↑' : '↓'} ${(((ratio - prevRatio) / prevRatio) * 100).toFixed(1)}%` : '—',
      ].join('\t'),
    )
    prevRatio = ratio
  }
  console.log(
    '\n读法：① **主读数 = 「稀有残骸/层」**（船长 2026-09-13：「进虫洞的目的是获得专属装备（稀有残骸，虫洞专属），' +
      '资产收益只是附带的」）——稀有残骸 → 回收炉开**高级箱** → 该族专属件，是专属装备与专属图纸的唯一来源；' +
      '② 逐层表记的是**收集额**（按层累加；母矿按基础卖价、残骸按回收炉保底估值，**不含高级箱**）——样本少的高层会被"能活着走到那儿的人"筛选过，看趋势时先看样本列；' +
      '③ 整趟表记的是**到手额**（只有撤离成功才入港 ⇒ 全损 = 0）——两个数的差就是"没带回来"的部分；' +
      '④ 货柜（安全货柜 2×2 / **图纸货柜 2×1** · 2026-09-14 新增）与稀有残骸都**不计 ISK**，单列件数；⑤ 「ISK/威胁」是**资产口径**的旁证（应逐层上升）；' +
      '⑥ 政策不偷看 `grid.exit`，出口只由**信标**给出 ⇒ 读数里包含"找信标"的回合成本；' +
      '⑦ 撤离开放（船长 2026-09-13：「玩家可以无条件开始撤离，但是依旧需要打撤离战」；' +
      '⚠ **2026-09-15 起撤离不再触发战斗**——「虫洞的撤离战取消吧」）⇒ ' +
      '「磨回合」列恒 0：旧闸门逼出来的"打不过就转圈耗回合"歪招已消失；守卫只堵**深入**。',
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
    for (const kind of ['node', 'boss'] as const) {
      const c = avg(SEEDS.map((s) => runOneBattle(s, dep, kind, 0, ci, ANALYTIC_FIT)))
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
    const node = avg(SEEDS.map((s) => runOneBattle(s, d, 'node', 0, undefined, ANALYTIC_FIT)))
    const boss = avg(SEEDS.map((s) => runOneBattle(s, d, 'boss', 0, undefined, ANALYTIC_FIT)))
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
        `${threat}（守卫 ${wormholeFoeThreat(d, 'boss')}）`,
        `${Math.round(node.won * 100)}%`,
        `${node.sec.toFixed(0)}s`,
        `${Math.round(node.hpFrac * 100)}%`,
        node.foeShots.toFixed(0),
        `${Math.round(boss.won * 100)}%`,
        `${Math.round(boss.hpFrac * 100)}%`,
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
      `（口径 = 收益每层 ×1.2、威胁每层 ×1.10；船长 2026-09-13「深层收益应该比难度曲线要更高」；` +
      `威胁增幅 2026-09-15 由 ×1.16 降为 ×1.10）`,
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
