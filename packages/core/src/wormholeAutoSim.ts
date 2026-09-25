/**
 * **虫洞 · 自动探索的"真跑一趟"模拟器**（2026-09-26 · 船长令）。
 *
 * 船长原话（照抄）：
 * ①「玩家翻译自动探索虫洞要占用4个核心，且收益太低了，我打算降低为只占用1个核心，且优化自动探索」
 * ②「我的优化逻辑指的是，**自动探索舰船进入洞后获得的收益逻辑**」
 * ③ 口径四答：「1 保持 5 分钟」「2（货舱当真上限）要」「3 快速对判」「4（允许不追深度、只求稳）允许」
 *
 * **为什么单独一个模块**：旧口径是"手动期望 × 40%"一笔算完（`settleRun` 里的平铺公式）；
 * 新口径要**按手动进洞的规则真走一遍**（网格、回合、层、层末守卫、货舱）。这坨逻辑有 300 行量级，
 * 塞进 `wormholeAuto.ts` 会把"账目/守卫/界面读数"淹掉；分离后两条边界也清楚：
 * 本模块**只算"这一趟捡到了什么"**，入账、报告、日志仍归 `wormholeAuto.ts`。
 *
 * ⚠ **与手动进洞共用同一套常数**（回合预算 / 每步开销 / 层收益 / 堆大小 / 遗迹命中 / 网格与出口落点），
 * 一处改、两处同步 —— 不许在本模块里另抄一份魔数。
 *
 * ⚠ **战斗是"快速对判"**（船长口径 3）：只看"DPS × 有效血量"的期望比，不逐帧跑战斗、
 * 不掷单发命中；打不过就绕开或撤离。之所以敢这么简化：自动探索的既定红线是**绝不丢船**
 * （`WORMHOLE_AUTO_HULL_FLOOR` 与损伤公式在 `wormholeAuto.ts` 里照旧）。
 */
import {
  HEX_DIRS,
  gridCellAt,
  gridTally,
  hexDiskAround,
  hexDiskCells,
  hexDistance,
  hexKey,
  isExitCell,
  pickPlace,
  pickSignal,
  wormholeArchetypeOf,
  wormholeGridRadiusFor,
  wormholeMakeGrid,
  wormholeRuinsShareFor,
  wormholeSignalWeightsFor,
  type HexCell,
  type WormholeGridState,
  type WormholePlace,
} from './wormholeGrid'
import { WORMHOLE_TURN_PER_MOVE, WORMHOLE_TURN_PER_SCAN } from './wormholeGrid'
import { WORMHOLE_PILE_UNITS_BASE } from './wormhole'
import { WORMHOLE_WRECK_PILE_M3_BASE, wormholeRelicChanceOf } from './wormholeSalvage'
import { wormholeLayerRewardMul } from './wormholeFoes'
import { WORMHOLE_TURN_BASE, WORMHOLE_TURN_MASS_COEF, wormholeStepCost, WORMHOLE_TOTAL_MASS_CAP } from './wormhole'

/**
 * **一"步"的回合开销 = 移动 1 回合**。
 * ⚠ **扫描要单独算，而且不能按"每格 1 回合"算**：`gridScanTargets` + `WORMHOLE_SCAN_RADIUS_BASE`(1)
 * ⇒ **一次扫描揭示 7 格（自身 + 一圈六格）、只花 1 回合**。本模块第一版把它按"每格 1 回合"计，
 * 把扫描成本放大了 7 倍，于是 4×T3（45 回合）连层 3 都上不去 —— 船长 2026-09-26 一问就露馅。
 */
const STEP_COST = WORMHOLE_TURN_PER_MOVE

/** **浅层留手比例**：本层最多捡到 `货舱 × 本值` 就转去下潜（深层收益 ×1.2/层，早下潜更划算） */
export const WORMHOLE_AUTO_DESCEND_HOLD_SHARE = 0.25
/** 撤离前留的回合余量（不够就不下潜、就地收工） */
const EXTRACT_RESERVE_TURNS = 2

/** 一次"进洞跑一趟"的读数（报告与用例都读它；不入档） */
export interface WormholeAutoDescend {
  /** 真正下到的层（1 = 只在第 1 层捞完就撤） */
  depthReached: number
  /** 探索过的格数（读数用） */
  cellsExplored: number
  /** 打过的战斗节点数（快速对判为"打得过"才计入） */
  fightsWon: number
  /** 因为"打不过"而绕开的节点数 */
  fightsAvoided: number
  /** 带回的普通残骸 m³ */
  wreckM3: number
  /** 带回的母矿单位 */
  oreUnits: number
  /** 带回的稀有残骸件数 */
  rareItems: number
  /** 触发过的遗迹安全货柜次数 */
  relicBoxes: number
  /** 是否因货舱满而提前收工 */
  holdFull: boolean
  /** 是否因回合耗尽而收工 */
  outOfTurns: boolean
  /** 这一趟扫描花了多少回合（含"未知格补扫"那几次）——用来量"扫描距离船"到底省了多少 */
  turnsOnScan: number
  /** 这一趟移动花了多少回合 */
  turnsOnMove: number
}

/** 快速对判用的编队战力（DPS × 有效血量；只用于"打不打"的取舍，不参与结算数值） */
export interface WormholeAutoPower {
  dps: number
  ehp: number
}

const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * **真跑一趟**（纯函数；同 `(seed, depth, mass, power, hold, techFactors)` ⇒ 同结果）。
 *
 * 策略（"一个老练玩家"的走法，逐条可读）：
 * 1. 每层**边走边扫**（移动前先扫落点，各 1 回合）——扫全盘太贵（层 1 就要 19 回合），实测会把人锁死在浅层；
 * 2. **贪心最近优先**访有产出的格（矿脉 / 坟场 / 遗迹）；空的格不去；
 * 3. 到格就干活：母矿按 `采集器台数` 堆/动作、坟场按 `打捞器台数` 堆/动作，各 1 回合一堆；
 * 4. 层末入口的守卫**打得过就打**（它是门，不打上不去；深层收益 ×1.2/层）；打不过就**留在本层继续捞**；
 * 5. 本层捡到 `货舱 × 0.45` 就转去下潜（给深层留货舱）；
 * 6. 收工条件：货舱满 / 回合见底 / 没有可达的产出格。
 */
export function wormholeAutoDescend(opts: {
  seed: number
  /** 出发时库存项记的层（起点；老档按 1） */
  startDepth: number
  /** 编队折合总质量（决定回合预算：越重越短） */
  totalMass: number
  /** 本趟货舱可装 m³（`wormholeBagSlotsOfFleet` 口径的近似：采集器/打捞器算进去） */
  holdM3: number
  /** 采集器台数（每动作回收几堆母矿） */
  miners: number
  /** 打捞器台数（每动作回收几堆残骸） */
  salvagers: number
  /** 编队战力（快速对判） */
  power: WormholeAutoPower
  /**
   * **本趟的扫描半径** = `WORMHOLE_SCAN_RADIUS_BASE` + Σ 编队各船的 `wormholeScanRadiusBonus`。
   * ⚠ 本模块第一版**恒按基础 1 算**（一次扫 7 格）——漏了鹦鹉螺 / 鲸盟护卫这类"扫描距离"船。
   * 它们每条 **+1 且可叠加**（船长 2026-09-13「编入队伍就有效、且可以叠加」）⇒ 4×鹦鹉螺 的真实半径
   * 是 **5（一次扫 91 格）**，与"半径 1"完全不是一个量级；漏掉会系统性高估回合成本、低估可下深度。
   */
  scanRadius: number
  /** 每层守卫的战力（快速对判；由调用方按层威胁换算） */
  guardPowerOf: (depth: number) => WormholeAutoPower
  /** 谜质科技给的**最大回合**加成（与手动的 `wormholeTurnBudget(mass, techTurnBonus)` 同一份） */
  techTurnBonus?: number
  /** 谜质科技系数（与旧口径同一套：残骸线 / 采集线） */
  tech: { wreck: number; ore: number }
}): WormholeAutoDescend {
  const { seed, startDepth, totalMass, holdM3, miners, salvagers, power, guardPowerOf, tech, scanRadius } = opts
  const rng = mulberry(seed * 6364136223846793005 + 1442695040888963407)
  let turns = turnBudgetOf(totalMass, opts.techTurnBonus ?? 0)

  const out: WormholeAutoDescend = {
    depthReached: Math.max(1, Math.min(9, startDepth)),
    cellsExplored: 0,
    fightsWon: 0,
    fightsAvoided: 0,
    wreckM3: 0,
    oreUnits: 0,
    rareItems: 0,
    relicBoxes: 0,
    holdFull: false,
    outOfTurns: false,
    turnsOnScan: 0,
    turnsOnMove: 0,
  }
  let holdUsed = 0
  const archetype = wormholeArchetypeOf(seed)

  for (let depth = Math.max(1, startDepth); depth <= 9; depth++) {
    const grid = wormholeMakeGrid(seed * 31 + depth * 7919, depth, 0)
    const mul = wormholeLayerRewardMul(depth)
    const radius = wormholeGridRadiusFor(depth)
    const holdCapThisLayer = holdM3 * WORMHOLE_AUTO_DESCEND_HOLD_SHARE

    /**
     * 本层有哪些"值得去"的位置：**直接读真网格的 `place`**（`wormholeMakeGrid` 已经按层把
     * 空占比 / 遗迹占比 / 信号权重都掷好了）。
     *
     * ⚠ 这里曾经**自己按概率重掷一遍** place —— 那是错的，而且错得很隐蔽：层 1/2 的真实网格
     * **根本没有遗迹格**（遗迹从 `WORMHOLE_RUINS_FLOOR_MIN_DEPTH` 起才铺），自己重掷反而会掷出来，
     * 而读真网格时又永远拿不到 ⇒ 实测 200 颗种子下"稀有残骸 / 安全货柜"两条线**恒为 0**。
     * 一处真相源：**只信 `wormholeMakeGrid` 铺好的 place**。
     * `place` 缺省（老档/合成夹具）⇒ 视为空信息地点，不去。
     */
    const worth: Array<{ cell: HexCell; place: WormholePlace }> = []
    for (const cell of hexDiskCells(radius)) {
      const g = gridCellAt(grid, cell)
      if (!g) continue
      if (isExitCell(grid, cell)) continue
      const place = g.place
      if (place === 'vein' || place === 'graveyard' || place === 'ruins' || place === 'ship') {
        worth.push({ cell, place })
      }
    }

    // 出发位置 = 入口（入口格本身不算产出格，与手动"到达即铺产出"的规则一致：只有产出地点才铺）
    let pos: HexCell = grid.start

    /**
     * **扫描账**（2026-09-26 船长追问补上）：一次扫描花 **1 回合**、揭开 `scanRadius` 半径的**整个盘**
     * （`gridScanTargets` + `grid.scanRadius`）。半径 1 ⇒ 一次 7 格；**4×鹦鹉螺（每条 +1 可叠加）⇒ 半径 5、
     * 一次 91 格**，一个半径 2~3 的盘**一屏就扫穿了**。
     * 所以本层要花几次扫描，取决于"这一层的盘要几屏才能盖住"——这正是扫描距离船的价值所在。
     */
    const scanR = Math.max(1, Math.floor(scanRadius))
    const cellsInLayer = hexDiskCells(radius).length
    const scansNeeded = Math.max(1, Math.ceil(cellsInLayer / (3 * scanR * scanR + 3 * scanR + 1)))
    const scanCost = scansNeeded * WORMHOLE_TURN_PER_SCAN
    if (turns - scanCost < EXTRACT_RESERVE_TURNS) {
      out.outOfTurns = true
      break
    }
    turns -= scanCost
    out.turnsOnScan += scanCost

    while (turns > EXTRACT_RESERVE_TURNS) {
      if (holdUsed >= holdCapThisLayer) break
      // ① 最近目标（贪心；**遗迹优先**——它出稀有残骸与安全货柜，是这趟最值钱的一条线；
      //    实测"纯最近优先"会在回合用尽前根本轮不到遗迹 ⇒ 稀有/货柜两条线恒为 0）
      let bestIdx = -1
      let bestD = Infinity
      let bestRank = -1
      for (let i = 0; i < worth.length; i++) {
        const w = worth[i]!
        const rank = w.place === 'ruins' ? 2 : w.place === 'ship' ? 1 : 0
        const d = hexDistance(pos, w.cell)
        if (rank > bestRank || (rank === bestRank && d < bestD)) {
          bestRank = rank
          bestD = d
          bestIdx = i
        }
      }
      if (bestIdx < 0) break
      const target = worth[bestIdx]!
      const need = bestD * STEP_COST
      if (turns - need < EXTRACT_RESERVE_TURNS) break

      /**
       * **未知格不可直达**（2026-09-26 补）：手动进洞时玩家只能走向**已扫出来**的格；
       * 目标若还在探测圈外，就得在路上再扫一次（**1 回合**、揭开 `scanRadius` 一圈）才谈得上走过去。
       * 这条才是"扫描距离船"真正的价值：半径 5 几乎一屏盖住整层，半径 1 时必须边走边扫。
       */
      if (bestD > scanR && turns - WORMHOLE_TURN_PER_SCAN < EXTRACT_RESERVE_TURNS) break
      const revealCost = bestD > scanR ? WORMHOLE_TURN_PER_SCAN : 0

      // ② 战斗格：先对判（打不过就划掉，不再考虑）
      if (target.place === 'ship') {
        const gp = guardPowerOf(depth)
        if (!canWin(power, gp)) {
          out.fightsAvoided += 1
          worth.splice(bestIdx, 1)
          continue
        }
        // 打一场：开销 = 节点基础 + 每多一波 1 回合（与手动同口径）+ 落点扫描 1 回合
        const cost = wormholeStepCost(2, 0)
        if (turns - need - cost - revealCost < EXTRACT_RESERVE_TURNS) break
        turns -= need + cost
        out.fightsWon += 1
        out.wreckM3 += pileM3(mul, rng, tech.wreck)
        holdUsed += WORMHOLE_WRECK_PILE_M3_BASE
        pos = target.cell
        out.cellsExplored += 1
        worth.splice(bestIdx, 1)
        continue
      }

      // 移动过去（+ 必要的补扫）
      turns -= need + revealCost
      out.turnsOnScan += revealCost
      out.turnsOnMove += need
      pos = target.cell
      out.cellsExplored += 1
      worth.splice(bestIdx, 1)

      // ③ 到格干活：每动作 1 回合，回收 = 台数 堆（取"该地点该有的堆数"上限 2 堆，与节点口径一致）
      const piles = 2
      const rigs = target.place === 'vein' ? Math.max(1, miners) : Math.max(1, salvagers)
      const trips = Math.max(1, Math.ceil(piles / rigs))
      for (let t = 0; t < trips; t++) {
        if (turns < 1 || holdUsed >= holdCapThisLayer) break
        turns -= 1
        if (target.place === 'vein') {
          const units = Math.max(1, Math.round(WORMHOLE_PILE_UNITS_BASE * mul * (0.8 + rng() * 0.4) * tech.ore))
          out.oreUnits += units
          holdUsed += units * 0.5 // 母矿单位→m³ 的量级换算（与货舱页同量级）
        } else if (target.place === 'graveyard') {
          const m3 = pileM3(mul, rng, tech.wreck)
          out.wreckM3 += m3
          holdUsed += WORMHOLE_WRECK_PILE_M3_BASE
        } else {
          /**
           * 遗迹：一次作业**必出**一件东西 —— 要么稀有残骸、要么安全货柜（深层两样都更容易）。
           * 口径：先掷稀有（`wormholeRelicChanceOf(depth)`，与手动同一张表），没中就掷货柜（层 2 起）。
           * ⚠ 与手动的差别（有意）：手动是"探索遗迹格"分多次动作，这里一次作业算一次完整翻检 ⇒ 必出 1 件。
           * 为什么这么定：实测"按概率各掷一次"在 200 颗种子下 **恒为 0**（遗迹格本来就少、还要走得过去），
           * 等于把稀有残骸与安全货柜两条线在新口径里废掉了 —— 那不是"优化"，是丢功能。
           */
          if (rng() < wormholeRelicChanceOf(depth)) out.rareItems += 1
          else if (depth >= 2) out.relicBoxes += 1
        }
      }
    }

    if (holdUsed >= holdM3) {
      out.holdFull = true
      break
    }
    if (turns <= EXTRACT_RESERVE_TURNS) {
      out.outOfTurns = true
      break
    }

    // ④ 走到出口 → 打层末守卫 → 下潜
    const toExit = hexDistance(pos, grid.exit) * STEP_COST
    const guard = guardPowerOf(depth)
    const guardCost = wormholeStepCost(2, 0)
    if (turns - toExit - guardCost < EXTRACT_RESERVE_TURNS) {
      out.outOfTurns = true
      break
    }
    if (!canWin(power, guard)) {
      // 打不过守卫 ⇒ 留在本层把货舱填满再走（船长口径 4：允许不追深度）
      out.fightsAvoided += 1
      continue
    }
    turns -= toExit + guardCost
    out.fightsWon += 1
    out.depthReached = depth + 1
    // 层末守卫的战利品
    out.wreckM3 += pileM3(mul, rng, tech.wreck)
    holdUsed += WORMHOLE_WRECK_PILE_M3_BASE
  }

  return out
}

/** 普通残骸一堆的 m³（与旧口径同一个基准 + 层收益 + 0.8~1.2 抖动 + 残骸线科技） */
function pileM3(mul: number, rng: () => number, techWreck: number): number {
  return Math.round(WORMHOLE_WRECK_PILE_M3_BASE * mul * techWreck * (0.8 + rng() * 0.4))
}

/** 快速对判：**打不过就不上**（只看 DPS × 有效血量的期望比；不做单发掷骰） */
function canWin(me: WormholeAutoPower, foe: WormholeAutoPower): boolean {
  const mine = me.dps * me.ehp
  const his = foe.dps * foe.ehp
  if (his <= 0) return true
  return mine / his >= 1.15 // 留 15% 余量：赢得难看也算输，绝不丢船
}

/** 回合预算（与手动的 `wormholeTurnBudget` 同式；这里只吃质量，科技由调用方加进 `turnsBase`） */
function turnBudgetOf(totalMass: number, techTurnBonus: number): number {
  const ratio = Math.max(0, Math.min(1, totalMass / WORMHOLE_TOTAL_MASS_CAP))
  return Math.floor(WORMHOLE_TURN_BASE * (1 - ratio * WORMHOLE_TURN_MASS_COEF)) + Math.max(0, Math.floor(techTurnBonus))
}

/** 一层的产出格统计（报告/用例读数用） */
export function wormholeAutoLayerTally(seed: number, depth: number): ReturnType<typeof gridTally> {
  return gridTally(wormholeMakeGrid(seed * 31 + depth * 7919, depth, 0))
}

/** 确定性乘法同余流（与 `wormholeGrid.wormholeStream` 同族，但独立一份：不共享全局 rng） */
function mulberry(seed: number): () => number {
  let a = (seed | 0) >>> 0 || 1
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 邻近格（报告里"下一格往哪走"的读数用；也便于用例构造） */
export function wormholeAutoNeighbors(cell: HexCell): HexCell[] {
  return HEX_DIRS.map((d) => ({ q: cell.q + d.q, r: cell.r + d.r }))
}

/** 格键（读数/日志用） */
export const wormholeAutoCellKey = hexKey

/** 环形格（用例构造边界用） */
export const wormholeAutoRing = hexDiskAround
