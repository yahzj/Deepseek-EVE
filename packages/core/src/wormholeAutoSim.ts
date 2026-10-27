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
 * ⚠ **与手动进洞的两处"有意差异"**（2026-09-27 写明，免得后人当缺陷报）：
 * ① **盘面不是同一张**：本模块用**独立可复现种子** `seed*31 + depth*7919` 建盘（手动用 `run.seed`
 *    ＋ 扫描加成）——自动线要能"跑一趟而不碰真档/真盘"，这是刻意的；
 * ② **不掷围剿**：第 7 层起"每消耗 1 回合刷 1 个"那条链（`wormholeSpawnAfterTurns`）是手动专有，
 *    自动线不跑 ⇒ 收益与风险读数**不含围剿**（打赢围剿的小概率货柜同理不在内）。
 * **空白地点占比已对齐手动**（2026-09-27 补）：建盘喂 `blankShareFactor`（= `blankShareFactorOf(state)`，
 * 事件玄学满级 0.8）——此前漏了这一项，自动线面对的盘比手动"更空"。
 *
 * ⚠ **战斗是"快速对判"**（船长口径 3）：只看"DPS × 有效血量"的期望比，不逐帧跑战斗、
 * 不掷单发命中；打不过就绕开或撤离。之所以敢这么简化：自动探索的既定红线是**绝不丢船**
 * （`WORMHOLE_AUTO_HULL_FLOOR` 与损伤公式在 `wormholeAuto.ts` 里照旧）。
 */
import { ceilFinalQuantity } from './quantity'
import {
  HEX_DIRS,
  gridCellAt,
  gridTally,
  hexDiskAround,
  hexDiskCells,
  hexDistance,
  hexKey,
  isExitCell,
  wormholeGridRadiusFor,
  wormholeMakeGrid,
  type HexCell,
  type WormholePlace,
} from './wormholeGrid'
import { WORMHOLE_TURN_PER_MOVE, WORMHOLE_TURN_PER_SCAN } from './wormholeGrid'
import { WORMHOLE_PILE_UNITS_BASE } from './wormhole'
import { WORMHOLE_WRECK_PILE_M3_BASE, WORMHOLE_GRAVEYARD_COMMONS_MIN, WORMHOLE_GRAVEYARD_COMMONS_MAX,
  WORMHOLE_VEIN_PILES_MIN, WORMHOLE_VEIN_PILES_MAX, wormholeRelicChanceOf } from './wormholeSalvage'
import { signalSpaceResourcePileBonus, wormholeLayerRewardMul } from './wormholeFoes'
import { wormholeTurnBudget, wormholeStepCost } from './wormhole'

/**
 * **一"步"的回合开销 = 移动 1 回合**。
 * ⚠ **扫描要单独算，而且不能按"每格 1 回合"算**：`gridScanTargets` + `WORMHOLE_SCAN_RADIUS_BASE`(1)
 * ⇒ **一次扫描揭示 7 格（自身 + 一圈六格）、只花 1 回合**。本模块第一版把它按"每格 1 回合"计，
 * 把扫描成本放大了 7 倍，于是 4×T3（45 回合）连层 3 都上不去 —— 船长 2026-09-26 一问就露馅。
 */
const STEP_COST = WORMHOLE_TURN_PER_MOVE

/**
 * **收成折扣 = 0.8**（2026-09-26 船长令：「收益按照80%折扣」）。
 *
 * 背景：改成"真进洞跑一趟"之后，满科技 + 扫描船的读数（残骸 4263 m³ / 稀有 13.9 件）约为旧口径的 7 倍；
 * 船长按 8 折收口。**打折打在"带回来的东西"上**（模拟器的每一条产出线一起乘），
 * 不是改走法、也不是改掉落规则 —— 走法/掉落仍与手动一致，只有"自动探索这一趟的收成"乘 0.8。
 */
export const WORMHOLE_AUTO_SIM_YIELD_MUL = 0.8
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
  /**
   * 取回的**谜质储存器台数**（2026-09-27 玩家报障修复）。
   *
   * 报障原话（船长转述）：「**而且自动探索不给谜质**」——`worth` 白名单原先只有
   * `vein / graveyard / ruins / ship`，`matter`（谜质格）**根本不在内** ⇒ 整趟都不去谜质格，
   * 谜质恒为 0。船长选**甲**：与手动同口径（手动每格取回 1 台，撤离成功时 1 台折 1 枚虫洞谜质）。
   *
   * ⚠ **不占本模块的货仓额度**：手动取装置走**收货阶梯**（货仓 2×2 → 临时空间 → 两处都满才算失败），
   * 探索期间货仓满也照样拿得到；且自动线最后把台数折算成虫洞谜质、不留装置形态 ⇒ 不记 `holdUsed`。
   */
  matterDevices: number
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

/**
 * **真跑一趟**（纯函数；同 `(seed, depth, mass, power, hold, techFactors)` ⇒ 同结果）。
 *
 * 策略（"一个老练玩家"的走法，逐条可读）：
 * 1. 每层**边走边扫**（移动前先扫落点，各 1 回合）——扫全盘太贵（层 1 就要 19 回合），实测会把人锁死在浅层；
 * 2. **贪心最近优先**访有产出的格（矿脉 / 坟场 / 遗迹 / 舰船信号 / **谜质**）；空的格不去；
 *    优先级 = 遗迹与谜质**同档**（按远近）＞ 舰船信号 ＞ 矿脉与坟场（同档，按远近）；
 *    ⚠ 谜质格 **2026-09-27 才进白名单**——此前整趟都不去，玩家报障「自动探索不给谜质」；
 * 3. 到格就干活：母矿按 `采集器台数` 堆/动作、坟场按 `打捞器台数` 堆/动作，各 1 回合一堆；
 * 4. 层末入口的守卫**打得过就打**（它是门，不打上不去），沿用原安全取舍；
 * 5. 普通资源由实际剩余货舱约束，不再共享跨层25%软额度；无对应设备不选择作业地点；
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
  /** 母矿每单位体积，由调用方读取物品定义，避免容量换算漂移。 */
  oreUnitM3: number
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
  /** 本趟出发锁定的科技收益；缺省兼容旧80%任务及纯模拟调用。 */
  yieldMul?: number
  /**
   * **事件玄学（`event-dividend`）给的"空白地点占比系数"** = `blankShareFactorOf(state)`
   * （0 级 = 1 ⇒ 一字不变；满级 5 = 0.8）。**缺省 1**：不传就与本次改动前完全一致。
   * ⚠ 2026-09-27 补：本模块原先建盘只写 `(seed, depth, 0)` ⇒ 漏了这个系数，自动线面对的盘
   * 比手动"更空"（满级时手动空地点少两成，自动却按默认 1 算）⇒ 与手动不同尺。
   */
  blankShareFactor?: number
}): WormholeAutoDescend {
  const { seed, startDepth, totalMass, holdM3, oreUnitM3, miners, salvagers, power, guardPowerOf, tech, scanRadius,
    blankShareFactor = 1 } = opts
  const rng = mulberry(seed * 6364136223846793005 + 1442695040888963407)
  const yieldMul = opts.yieldMul ?? WORMHOLE_AUTO_SIM_YIELD_MUL
  let turns = wormholeTurnBudget(totalMass, opts.techTurnBonus ?? 0)

  const out: WormholeAutoDescend = {
    depthReached: Math.max(1, Math.min(9, startDepth)),
    cellsExplored: 0,
    fightsWon: 0,
    fightsAvoided: 0,
    wreckM3: 0,
    oreUnits: 0,
    rareItems: 0,
    relicBoxes: 0,
    matterDevices: 0,
    holdFull: false,
    outOfTurns: false,
    turnsOnScan: 0,
    turnsOnMove: 0,
  }
  let holdUsed = 0

  for (let depth = Math.max(1, startDepth); depth <= 9; depth++) {
    const grid = wormholeMakeGrid(seed * 31 + depth * 7919, depth, 0, blankShareFactor)
    const mul = wormholeLayerRewardMul(depth)
    const radius = wormholeGridRadiusFor(depth)

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
      if (place === 'vein' && miners <= 0) continue
      if ((place === 'graveyard' || place === 'ruins') && salvagers <= 0) continue
      if (place === 'vein' || place === 'graveyard' || place === 'ruins' || place === 'ship' || place === 'matter') {
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
      // 遗迹/谜质沿用独立产出规则；普通货物装不下时不再为其消耗移动或作业回合。
      // ① 最近目标（贪心；**遗迹优先**——它出稀有残骸与安全货柜，是这趟最值钱的一条线；
      //    实测"纯最近优先"会在回合用尽前根本轮不到遗迹 ⇒ 稀有/货柜两条线恒为 0）
      /**
       * **谜质格与遗迹同档（rank 2）**——2026-09-27 补，船长对同批两问均取推荐项
       * （谜质线怎么补 = 甲「与手动同口径」；去不去抢 = E「与遗迹同档」）。
       *
       * 为什么不能只挂在 rank 0（与矿脉/坟场同档）：实测 200 趟里**只有 48 趟**拿得到谜质
       * （0.24 枚/趟）——rank 0 的格要等遗迹与舰船全清完才轮得到，回合早用尽了 ⇒ 玩家仍会报"不给谜质"。
       * 为什么不用 rank 3（最优先）：谜质会把遗迹整条挤掉，实测**稀有残骸 −45%**、货柜 −四成，代价过重。
       * 同档 = **两者按远近竞争**：遗迹那条"不能被纯最近优先饿死"的既定意图原样保住，谜质也拿得到。
       * 实测（200 趟 · 4× sh-thresher · ai-expert 6）：谜质 **1.91 枚/趟、194/200 趟命中**；
       * 稀有残骸 −13%~−22%、货柜 −13%~−17%、母矿 +3% —— 这是加入谜质线必然的回合取舍
       * （回合预算固定 45，手动玩家同样要选先去哪），不是缺陷。
       */
      let bestIdx = -1
      let bestD = Infinity
      let bestRank = -1
      for (let i = 0; i < worth.length; i++) {
        const w = worth[i]!
        if (holdUsed >= holdM3 && w.place !== 'ruins' && w.place !== 'matter') continue
        const rank = w.place === 'ruins' || w.place === 'matter' ? 2 : w.place === 'ship' ? 1 : 0
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
        const wreck = Math.min(Math.floor(Math.max(0, holdM3 - holdUsed)), pileM3(mul, rng, tech.wreck))
        out.wreckM3 += wreck
        holdUsed += wreck
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

      /**
       * **谜质格 ⇒ 取回一台谜质储存器**（2026-09-27 补 · 船长甲案"与手动同口径"）。
       *
       * 手动口径：到达该格后"激活"取回 **1 台**（`wormholeBattle.ts` L294），
       * **激活一分回合都不扣**（`wormholeGrid.ts` L824 写明）⇒ 本模块只算移动的回合，到格即取、不掷骰。
       * 是哪一台由 `(种子, 层, 格 key)` 定死（`wormholeMatterDeviceAt`），与本模块无关——自动线只数台数。
       */
      if (target.place === 'matter') {
        out.matterDevices += 1
        continue
      }

      // 矿脉和墓场普通堆数随层增长；遗迹沿用原自动探索的两次翻检口径。
      const extra = signalSpaceResourcePileBonus(depth)
      const piles = target.place === 'vein'
        ? WORMHOLE_VEIN_PILES_MIN + Math.floor(rng() * (WORMHOLE_VEIN_PILES_MAX - WORMHOLE_VEIN_PILES_MIN + 1)) + extra
        : target.place === 'graveyard'
          ? WORMHOLE_GRAVEYARD_COMMONS_MIN + Math.floor(rng() * (WORMHOLE_GRAVEYARD_COMMONS_MAX - WORMHOLE_GRAVEYARD_COMMONS_MIN + 1)) + extra
          : 2
      const rigs = target.place === 'vein' ? miners : target.place === 'graveyard' ? salvagers : 1
      const trips = Math.max(1, Math.ceil(piles / rigs))
      for (let t = 0; t < trips; t++) {
        if (turns <= EXTRACT_RESERVE_TURNS || (holdUsed >= holdM3 && target.place !== 'ruins')) break
        turns -= 1
        // 每次作业按台数收堆，末批不得把不足台数的堆补满；遗迹维持一次动作一次翻检。
        const batch = target.place === 'ruins' ? 1 : Math.min(rigs, piles - t * rigs)
        for (let p = 0; p < batch; p++) {
          if (target.place !== 'ruins' && holdUsed >= holdM3) break
          if (target.place === 'vein') {
            const units = Math.min(Math.floor(Math.max(0, holdM3 - holdUsed) / oreUnitM3),
              Math.max(1, ceilFinalQuantity(WORMHOLE_PILE_UNITS_BASE * mul * (0.8 + rng() * 0.4) * tech.ore)))
            out.oreUnits += units
            holdUsed += units * oreUnitM3
          } else if (target.place === 'graveyard') {
            const m3 = Math.min(Math.floor(Math.max(0, holdM3 - holdUsed)), pileM3(mul, rng, tech.wreck))
            out.wreckM3 += m3
            holdUsed += m3
          } else {
            // 遗迹保留一次动作一次翻检：先判稀有，未中且层数足够时给货柜。
            if (rng() < wormholeRelicChanceOf(depth)) out.rareItems += 1
            else if (depth >= 2) out.relicBoxes += 1
          }
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
    const wreck = Math.min(Math.floor(Math.max(0, holdM3 - holdUsed)), pileM3(mul, rng, tech.wreck))
    out.wreckM3 += wreck
    holdUsed += wreck
  }

  return {
    depthReached: out.depthReached,
    cellsExplored: out.cellsExplored,
    fightsWon: out.fightsWon,
    fightsAvoided: out.fightsAvoided,
    /** 收益系数只在收尾应用一次，不改变路线、回合或货舱约束。 */
    wreckM3: ceilFinalQuantity(out.wreckM3 * yieldMul),
    oreUnits: ceilFinalQuantity(out.oreUnits * yieldMul),
    rareItems: out.rareItems * yieldMul,
    relicBoxes: out.relicBoxes * yieldMul,
    /** 谜质装置台数同样打 8 折（小数部分由调用方掷一次取整，与稀有残骸/货柜同一套写法） */
    matterDevices: out.matterDevices * yieldMul,
    holdFull: out.holdFull,
    outOfTurns: out.outOfTurns,
    turnsOnScan: out.turnsOnScan,
    turnsOnMove: out.turnsOnMove,
  }
}

/** 普通残骸一堆的 m³（与旧口径同一个基准 + 层收益 + 0.8~1.2 抖动 + 残骸线科技） */
function pileM3(mul: number, rng: () => number, techWreck: number): number {
  return ceilFinalQuantity(WORMHOLE_WRECK_PILE_M3_BASE * mul * techWreck * (0.8 + rng() * 0.4))
}

/** 快速对判：**打不过就不上**（只看 DPS × 有效血量的期望比；不做单发掷骰） */
function canWin(me: WormholeAutoPower, foe: WormholeAutoPower): boolean {
  const mine = me.dps * me.ehp
  const his = foe.dps * foe.ehp
  if (his <= 0) return true
  return mine / his >= 1.15 // 留 15% 余量：赢得难看也算输，绝不丢船
}

/**
 * 一层的产出格统计（报告/用例读数用）。
 * `blankShareFactor` 与模拟器**同一把尺**（缺省 1；要按玩家真实技能读盘面就读 `blankShareFactorOf(state)`）。
 */
export function wormholeAutoLayerTally(
  seed: number,
  depth: number,
  blankShareFactor = 1,
): ReturnType<typeof gridTally> {
  return gridTally(wormholeMakeGrid(seed * 31 + depth * 7919, depth, 0, blankShareFactor))
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
