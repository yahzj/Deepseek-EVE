/**
 * 终局玩法「虫洞」· 界面（E 批 2026-09-13 起 · F3a-2 层内网格 2026-09-13）。
 *
 * ✅ **2026-09-14 船长解闸：「可以解除虫洞对玩家的不可见状态了」** ⇒ 当年那条**施工期可见性铁律作废**
 * （入口只在调试模式下出现 / 数据走 `unreleased` 闸门 / 文案不得提及「虫洞」）——现口径：
 * 入口常驻（星图「出港」的「扫描虫洞」标签 + 星图行动区入口 + 活动栏）、数据全部上线、
 * **公开就叫「虫洞」**；玩家侧仍有**解锁门槛**（协会声望 ≥ 40，见 `wormholeScanUnlockStanding`）。
 *
 * 界面构成：准备页（编队检索 + 编队读数）· **探索页（F3a-2：圆盘六边形网格 + 扫描/前往；F5 起
 * 墓场/遗迹/矿脉走到就铺好产出 ⇒ 按钮是「打捞 / 采集」而不是「激活」）** · 货仓页（F4b 背包式格管理；
 * F5 起散货也是网格里的真摆放件、可拖拽）。层内动作各花 1 回合，未扫描的地点要先警告再确认（船长口径）；
 * 未扫描的格子在图上用**蓝灰虚线边框**区分，且不按信号上色（免得漏真相）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
// 洞内底图固定（船长 2026-09-13）：进洞时把当前那张无缝星云图钉住，本趟不随全站换图而变
import { currentSpaceBg, spaceBgUrlAt } from '../ui/spaceBg'
import { HintIcon } from '../ui/Hint'
import { pinMarked } from '../ui/marks'
import { wormholeIntelLine, wormholeIntelTip } from '../ui/wormholeIntel'
// 物品图标（F3c · 船长：「货仓内物品采用图标而不是纯文字」）：安全货柜按族分色、谜质每台一枚专属线稿
import { Glyph, itemIconOf, itemToneOf } from '../ui/Glyphs'
import {
  WORMHOLE_ADMISSION_TEXT,
  WORMHOLE_MAX_SHIPS,
  /** 自动探索（批次 3 · 船长定案）：准备页在自动模式下共用同一套结构，只有读数与按钮换口径 */
  WORMHOLE_AUTO_MAX_SHIPS,
  WORMHOLE_AUTO_DURATION_MS,
  WORMHOLE_AUTO_YIELD_MUL,
  WORMHOLE_AUTO_DAMAGE_MIN,
  WORMHOLE_AUTO_DAMAGE_MAX,
  WORMHOLE_PLACE_TEXT,
  wormholeIsShapedItem,
  WORMHOLE_SLOT_M3,
  WORMHOLE_TOTAL_MASS_CAP,
  cargoCapacityM3Of,
  isExitCell,
  shipDisplayName,
  shipSizeLabel,
  wormholeAdmission,
  wormholeBagSlots,
  wormholeBagUsage,
  wormholeFleetCargoM3,
  wormholeFoeThreat,
  wormholeLayerThreat,
  /** 玩家可见威胁的显示口径（×2；船长 2026-09-15「面板威胁乘以2」）——**只乘给人看的数字** */
  wormholeDisplayThreat,
  WORMHOLE_HOLD_COLS,
  /** 临时空间（船长 2026-09-14）：4 列 × 8 行 = 32 格 */
  WORMHOLE_TEMP_CELLS,
  WORMHOLE_TEMP_COLS,
  WORMHOLE_TEMP_ROWS,
  makeHoldState,
  durabilityOf,
  holdRows,
  placementCells,
  // F3c 谜质装置（船长 2026-09-13）：派生增益 / 本格是哪一台 / 抛弃回合类装置的提醒
  wormholeMatterBuffs,
  wormholeMatterDeviceAt,
  wormholeMatterDeviceOf,
  wormholeMatterDiscardHint,
  wormholeMatterThreatMul,
  /**
   * ⚠ **信息展示必须走 `revealOf`**（2026-09-13 星云批）：地图此前直接读 `c.place` 上色，
   * 那是**真相**——星云遮蔽接进来后照旧上色，云就等于白罩了。
   * `signalOfPlace` 仍保留（把真相换成信号用），但**上色判据取 `revealOf` 的 `kind`**。
   */
  revealOf,
  signalOfPlace,
  /**
   * **路径拦截**（船长 2026-09-16）：界面画路径/描红用的判据与引擎**同一个函数**
   * （`hexLine` 出连线、`wormholePathInterceptAt` 出"最近的未清敌人格"）——"界面记得拦"不是纪律，
   * 两边同一把尺才是。
   */
  hexLine,
  wormholePathInterceptAt,
  wormholeOutOfTurns,
  wormholeShipAllowed,
  wormholeSalvagersOf,
  wormholeMinersOf,
  // 2026-09-19 准备页读数（船长）：按**所选编队**现算的打捞器/采集器台数 + 扫描范围
  wormholeSalvagersInFleet,
  wormholeMinersInFleet,
  wormholeScanBonusOf,
  WORMHOLE_SCAN_RADIUS_BASE,
  /**
   * 2026-09-19 效率读数（船长「检查是否有其他丢掉科技的情况」四处之一）：
   * `wormholeWorkEfficiencyOfFleet`（按任意编队现算，准备页用）与 `wormholeWorkEfficiencyOf`
   * （本趟编队，入洞后用）——**与 core 结算"额外堆"同一把尺**，读数即实战吃到的数。
   */
  wormholeWorkEfficiencyOfFleet,
  wormholeWorkEfficiencyOf,
  // 2026-09-19：威胁读数必须把**谜质科技**那一份也并进袋子（见下方 matterBuffs 注释）
  matterTechWhBuffs,
  // 2026-09-19：入洞读数要单独列科技来源（袋子里只剩合流后的标量）⇒ 需要逐节点读等级
  matterTechNodes,
  matterTechLevel,
  // 2026-09-19 甲案：自动探索的科技系数（与结算同一个函数 ⇒ 准备页读数即返航时生效的那个数）
  wormholeAutoTechFactors,
  wormholeAutoTechIsNeutral,
  wormholeShipMass,
  wormholeUnitsPerSlot,
  wormholeShapeOf,
  wormholeCargoSlotsOf,
  placementCellsCount,
} from '@whale/core'
import type { WormholeGridState, WormholeHoldPlacement, WormholeHoldState, WormholePlace, WormholeSettleRecord, WormholeSignal } from '@whale/core'
import type { GameEngine } from '../game/engine'
import { ShipSprite, ShipSpriteShape } from '../ui/ShipSprite'
import type { ToastFn } from '../pages/common'
import { SHIP_SUBS, SHIP_TIER_SUBS, SUB_ALL, shipRolePasses, shipTierPasses } from '../ui/itemSubs'
import { tr } from '../i18n/locale'

type WhTab = 'prep' | 'map' | 'bag'

/** 两块格板：货仓（8 列）/ **临时空间**（4 列 × 8 行 = 32 格 · 船长 2026-09-14） */
type BoardKind = 'hold' | 'temp'

/**
 * 页签文案。⚠ **玩家可见一律叫「货仓」，不叫「背包」**（船长 2026-09-15：「不应该直接叫背包，
 * 展示给玩家看的叫货仓」）——内部标识符仍是 `bag` / `run.bag`（不动存档与代码键名）。
 */
const TAB_LABEL: Record<WhTab, string> = { prep: tr("ui.Wormhole.063"), map: tr("ui.Wormhole.123"), bag: tr("ui.CargoPage.004") }

/* ── 探索页动效时长（船长 2026-09-13 拍板：「入场动画时长可以拉长到 1 秒」）──
   飞入 1000ms（进场与到达新层）· 飞出 600ms（深入下一层前先飞走）· 扫描波 900ms ·
   **星云消散 700ms**（船长同日追加：「当消除星云时，给星云添加个消散的动画」）。
   四处都是纯表现：数据结算在点下那一刻就完成了，动画期间只是"不许再点"。 */
const WORMHOLE_FX_IN_MS = 1000
const WORMHOLE_FX_OUT_MS = 600
const WORMHOLE_FX_SCAN_MS = 900
const WORMHOLE_FX_NEBULA_MS = 700
/** 被拿走的堆卡片"向下移出 + 淡出"用多久（与 CSS `.app-wh-pile.is-leaving` 的动画时长同值） */
const WORMHOLE_PILE_OUT_MS = 300
/**
 * **作业进度条时长**（F2b · 船长 2026-09-13 裁定「**只做表现层进度条**」）：
 * 打捞 / 采集 / 拾取装舱点下那一刻**数据就已经结算完了**（全篇同款：结算即落盘，动画只是表现），
 * 这条 380ms 的回收进度条只让"正在收货"看得见——**不锁按钮、不拦操作、不加状态机**；
 * 时长与 CSS `.app-wh-jobbar i` 的动画同值。
 */
const WORMHOLE_FX_JOB_MS = 380

/** 探索地图的缩放档（1 = 适应窗口；每档 +25%，上限 250%）——左侧 ＋/－ 按这个步进 */
const WORMHOLE_MAP_ZOOM_FIT = 1
const WORMHOLE_MAP_ZOOM_STEP = 0.25
/** 滚轮一格的步长（比按钮细一半：滚轮是连续输入，粗档会一跳一跳） */
const WORMHOLE_MAP_ZOOM_WHEEL_STEP = 0.125
const WORMHOLE_MAP_ZOOM_MAX = 2.5

/** 扫描动画的序号（换一次 = 重播一次；只用于 React key/CSS 重挂，不进存档） */
let scanFxSeqCounter = 0
function scanFxSeq(): number {
  scanFxSeqCounter += 1
  return scanFxSeqCounter
}

/** 六边形"第几圈"（`(dq,dr)` 的立方距离）——逐格延迟与扩散波共用这一把尺 */
function hexRingOf(dq: number, dr: number): number {
  return Math.max(0, Math.round((Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2))
}

/** 千分位 */
function n(v: number): string {
  return Math.round(v).toLocaleString('zh-CN')
}

/**
 * **数字跳数**（船长 2026-09-13 拍板「⑦要」）：结算单里的 信用点 合计从 0 滚到目标值，
 * 220ms 一跳、共 `ms` 毫秒；纯前端表现，不碰任何数据。
 */
function useCountUp(value: number, ms = 320): number {
  const [shown, setShown] = useState(value)
  useEffect(() => {
    if (!Number.isFinite(value) || value === 0) {
      setShown(value)
      return
    }
    const t0 = performance.now()
    let raf = 0
    const step = (t: number): void => {
      const k = Math.min(1, (t - t0) / ms)
      // 末段减速（ease-out），停下来的那一下才落在真值上
      setShown(Math.round(value * (1 - Math.pow(1 - k, 3))))
      if (k < 1) raf = window.requestAnimationFrame(step)
    }
    raf = window.requestAnimationFrame(step)
    return () => window.cancelAnimationFrame(raf)
  }, [value, ms])
  return shown
}

export function WormholePanel({
  engine,
  onToast,
  onClose,
  stockId = null,
  autoStockId = null,
}: {
  engine: GameEngine
  onToast: ToastFn
  onClose: () => void
  /** 从「扫描虫洞」页选中的库存虫洞 id（给了 ⇒ 进洞走 `wormholeEnterFromStock`：种子与起始层取它） */
  stockId?: string | null
  /**
   * **自动探索模式**（船长 2026-09-14：「**自动探索采取和我们主控探索相同的准备界面。**」）：
   * 给了库存 id ⇒ 本面板只渲染「准备」页，但规则/读数/按钮换成自动探索口径
   * （最多 4 条副船 · 每条占 1 枚 AI 核心 · 约 5 分钟 · 收益 = 手动期望 ×40% 直入仓库 · 绝不丢船），
   * 主按钮写「派队自动探索」；选了主控船 ⇒ 先弹确认（主控换到自动挑出的那条空闲船上）。
   */
  autoStockId?: string | null
}) {
  const state = engine.state
  const ctx = engine.ctx
  /** 自动探索模式（与手动进洞共用同一个准备页） */
  const auto = autoStockId !== null
  /**
   * ⚠ 自动探索模式**无视洞内那一趟**：本面板此时只是一张"准备页"（不显示探索/背包、不给撤离、
   * 不占主控活动位）⇒ 直接把 `run` 当没有。玩家若正躺在虫洞里，那趟进度原样保存在 state 里。
   */
  const run = auto ? undefined : state.wormhole.run
  /**
   * **洞内背景固定**（船长 2026-09-13：「**当次虫洞内的背景图需要固定**」）：
   * 以**本趟种子**为键，把进洞那一刻的全站底图**钉住**（--wh-space-bg）——
   * 之后即便玩家在「设置」里换了一张全站底图，或者关掉面板再打开，洞内那张都不会变。
   * 出洞（没有 run）后不再钉，面板回到全站底图。
   */
  const pinnedSpaceBg = useMemo(() => {
    const seed = run?.seed ?? null
    if (seed === null) return null
    const info = currentSpaceBg()
    return info ? spaceBgUrlAt(info.index) : null
  }, [run?.seed])
  const [tab, setTab] = useState<WhTab>(auto ? 'prep' : run ? 'map' : 'prep')
  /**
   * 编队选择（同一份状态，手动/自动两用）：
   * - 手动 ⇒ 默认**带上主控**（老口径）；
   * - 自动 ⇒ 默认给**自动配置的那一队**（`wormholeAutoCandidates` 里被勾中的，最多 4 条、不超过核心余量）。
   */
  const [picked, setPicked] = useState<string[]>(() =>
    auto
      ? engine
          .wormholeAutoCandidates([])
          .filter((c) => c.picked)
          .map((c) => c.shipId)
      : state.shipId
        ? [state.shipId]
        : [],
  )
  /** 自动探索：选了主控船 ⇒ 派队前先弹确认（写明主控要换给谁） */
  const [mainAsk, setMainAsk] = useState(false)
  /**
   * 待确认的"前往未知地点"目标（船长 2026-09-13：前往未扫描的地方**需要警告**）。
   * 口径：点未扫描的格 **不直接走**（也不扣回合），先把警告摆出来，等玩家点「确认前往」。
   *
   * ⚠ **2026-09-16 起同一条待确认栏也承载「路径拦截」**（船长路径拦截机制）：
   * `unknown` = 目标格未扫描（原口径）；`intercept` = 直线路径上挡着没清掉的敌人
   * （`known` = 那一格是否已知 —— 甲案：已知才在地图上描红指名，未知只警示路径线）。
   * 两件事**可以同时成立**（点的是未扫描格、路上还挡着敌人）⇒ 合成一次确认、一次移动。
   */
  const [pendingCell, setPendingCell] = useState<{
    q: number
    r: number
    unknown: boolean
    intercept: { q: number; r: number; known: boolean } | null
  } | null>(null)

  /**
   * ⚠ **2026-09-19 报障排查补**：进场预览必须把**谜质科技「时序锚定器」**那一份算进去
   * （实际入场走 `wormholeEnter → wormholeStartRun(..., techTurnBonus)` 是带着的）——
   * 原先这里不传 ⇒ 读数比实际少一大截，玩家会以为科技白点了。
   */
  const techTurnBonus = matterTechWhBuffs(state, ctx).turnBonus
  const admission = wormholeAdmission(ctx, picked, techTurnBonus)
  /* ── 自动探索模式的读数（船长 2026-09-14：准备页两用）─────────────────────────────
     规则来自 core 同一把尺：`wormholeAutoCandidates`（逐船可派性）·
     `wormholeAutoMainHandover`（选了主控 ⇒ 主控换给谁 / 为什么不能换）·
     `wormholeAutoBlockReason`（整队能不能派）· `wormholeAutoCores`（AI 核心余量）。 */
  const autoCand = auto ? engine.wormholeAutoCandidates([]) : []
  const autoBlockedOf = new Map(autoCand.map((c) => [c.shipId, c.blocked]))
  const autoMainPicked = auto && picked.includes(state.shipId)
  /** 主控已经在队里 ⇒ 用真队读；还没编入 ⇒ 先探一次"编进来会怎样"（只读，不改状态） */
  const autoHandover = auto
    ? engine.wormholeAutoMainHandover(autoMainPicked ? picked : [...picked, state.shipId])
    : null
  /** 主控船为什么编不进来 / 编进来会换给谁（null = 没有障碍） */
  const autoMainReason = auto ? (autoHandover?.reason ?? null) : null
  const autoCores = auto ? engine.wormholeAutoCores() : null
  /**
   * 整队能不能派（core 同一把尺）。主控在队里时按"允许随队"校验（`mainMayJoin`）——
   * 主控那一道闸由 `autoMainReason` 单独说话（换不了就是换不了，理由更具体）。
   */
  const autoBlock =
    auto && autoStockId !== null ? engine.wormholeAutoBlockReason(autoStockId, picked, autoMainPicked) : null
  const autoGate = autoMainReason ?? autoBlock
  /**
   * **本次准备的是哪一处虫洞**（船长 2026-09-16 的敌情行要用它）：从库存进来时
   * `stockId`（手动）/ `autoStockId`（自动）有值 ⇒ 取其族；两者都没有（从星图入口直接开面板）
   * ⇒ 不显示敌情行（不猜、不编）。
   */
  const prepStock = (() => {
    const id = autoStockId ?? stockId
    if (!id) return null
    return engine.wormholeStock().find((s) => s.id === id) ?? null
  })()
  const cargoM3 = wormholeFleetCargoM3(state, ctx, picked)
  const bagSlots = wormholeBagSlots(cargoM3)
  const usage = run ? wormholeBagUsage(ctx, run.bag, wormholeBagSlots(wormholeFleetCargoM3(state, ctx, run.fleet))) : null
  /** 回合走不动了（耗尽 / 付不起当前节点）⇒ 只能撤离（逃生门；与 core `wormholeOutOfTurns` 同一把尺） */
  const outOfTurns = run ? wormholeOutOfTurns(run) : false
  /** 本层网格（F3a-2；老档该层没有网格 ⇒ 退回旧口径提示） */
  const grid = run?.grid
  const hereKey = grid ? `${grid.pos.q},${grid.pos.r}` : ''
  const hereCell = grid ? grid.cells.find((c) => c.key === hereKey) : undefined
  const atExit = grid ? isExitCell(grid, grid.pos) : false
  const bossDone = !!run && (run.bossCleared ?? 0) >= run.depth
  /** **打捞现场**（F3b：墓场/遗迹）——它的"激活"是打捞作业（要打捞器、按台数回收） */
  const salvageCell = !!hereCell && (hereCell.place === 'graveyard' || hereCell.place === 'ruins')
  /**
   * **矿脉**（F5 · 船长 2026-09-13：「资源点和墓场遗迹改为不用激活」「虚空母矿要求玩家携带采集器。
   * 规则同虫洞打捞」）：走到就铺好母矿堆，打捞/采集各按"台数 × 回合"回收 ⇒ 与墓场同一套交互。
   */
  const veinCell = hereCell?.place === 'vein'
  /** 编队打捞器台数（0 ⇒ 打捞格干不了活；界面据此给出拒因而不是让按钮白按） */
  const salvagers = run ? wormholeSalvagersOf(state, ctx) : 0
  /** 编队采集器台数（0 ⇒ 母矿一堆也挖不动：与打捞器同一把尺） */
  const miners = run ? wormholeMinersOf(state, ctx) : 0
  /**
   * **准备页读数：所选编队的 打捞器 / 采集器 / 扫描范围**（船长 2026-09-19）。
   *
   * 为什么在准备页也要看：这三个数决定"这队进洞能干什么"——没有打捞器就吃不了墓场/遗迹、
   * 没有采集器就挖不动虚空母矿，而扫描范围决定每扫一次能开几圈图。原先它们只在**入洞后**的
   * 探索页才看得到（都是读 `run` 的口径）⇒ 现在改用**按所选编队现算**的同一把尺
   * （`wormholeSalvagersInFleet` / `wormholeMinersInFleet` / `wormholeScanBonusOf`），
   * 还没入洞、还在挑船时就能对着读数配队。
   *
   * ⚠ 口径：扫描范围 = `WORMHOLE_SCAN_RADIUS_BASE`（基础 1 圈）＋ **编队**的侦察舰/电子舰加成；
   * 洞内捞到的谜质装置「测绘仪」还能再 +圈（那是入洞后从货仓现算的，准备页不预告）。
   */
  const pickedSalvagers = wormholeSalvagersInFleet(state, ctx, picked)
  const pickedMiners = wormholeMinersInFleet(state, ctx, picked)
  const pickedScanRadius = WORMHOLE_SCAN_RADIUS_BASE + wormholeScanBonusOf(ctx, picked)
  /**
   * **打捞 / 采集效率读数**（2026-09-19 补 · 船长「检查是否有其他丢掉科技的情况」四处之一）。
   *
   * 效率 = `Σ 各台档位基础效率`（民用 0 / MK1 20% / MK2 40% / MK3 60% / 异星 80%）
   * **＋ 谜质科技加成**（引力吊臂 / 富集钻头各 +20%/级）；消费点 = 每次打捞/采集的**额外堆**
   * （`floor(效率)` 必得 ＋ 按余数掷一次）。**界面与结算共用同一个函数** ⇒ 显示的百分比就是实战那个数。
   * 准备页按**所选编队**现算（`…OfFleet`），入洞后按**本趟编队**（`…Of`），两条路同一段算式。
   */
  const pickedSalvageEff = wormholeWorkEfficiencyOfFleet(state, ctx, picked, 'salvager')
  const pickedCollectEff = wormholeWorkEfficiencyOfFleet(state, ctx, picked, 'miner')
  const runSalvageEff = run ? wormholeWorkEfficiencyOf(state, ctx, 'salvager') : 0
  const runCollectEff = run ? wormholeWorkEfficiencyOf(state, ctx, 'miner') : 0
  /**
   * **已点的洞内科技节点**（入洞读数单列一行"科技"来源）：只收 `lv > 0` 的节点。
   *
   * 分类口径走**数据表自带的 `branch`**（第三条线 `industry` = 界面上的「洞外工业」，
   * 三个节点都在洞外生效 ⇒ 不列进洞内读数），**不另抄一份效果清单**——
   * 抄一份就有"新节点忘了登记 ⇒ 读数静默少一行"的风险。
   */
  const techInRun = matterTechNodes(ctx)
    .filter((d) => d.branch !== 'industry')
    .map((d) => ({ def: d, level: matterTechLevel(state, d.id) }))
    .filter((x) => x.level > 0)
  const techInRunLevels = techInRun.reduce((s, x) => s + x.level, 0)
  /**
   * **自动探索吃到的谜质科技系数**（船长 2026-09-19 甲案：「自动探索不折扣」＋「用实际回合 / 战斗线按完成度
   * 减半 / 货仓接 / AI 核心吃」）。`shipIds` 传**所选编队**（uid）⇒ 准备页读数就是派队后真正生效的那个数
   * （结算里用的是同一把尺：`wormholeAutoTechFactors(state, ctx, run.shipIds)`）。
   * ⚠ 手动模式不看这组系数（手动里的每一个数都各自现算，不需要折算）。
   */
  const autoTech = wormholeAutoTechFactors(state, ctx, picked)
  const autoTechNeutral = wormholeAutoTechIsNeutral(autoTech)
  /**
   * **谜质增益**（F3c · 船长 2026-09-13「放在货仓里就生效」）：一律从货仓**现算**，
   * 界面读数、按钮提示与 core 的结算走同一个函数（`wormholeMatterBuffs`）⇒ 不会两套口径。
   * ⚠ 2026-09-19 补：**必须把谜质科技那一份也传进来**（`matterTechWhBuffs(state, ctx)`）——
   * 这只袋子是"装置 + 科技"两只来源合并的，原先这里只传装置 ⇒ 点了「压制力场增幅 / 守卫解析」
   * 之后界面威胁读数**不跟着降**（而引擎实际已经降了）＝读数与实战不符。
   */
  const matterBuffs = wormholeMatterBuffs(run?.hold, matterTechWhBuffs(state, ctx))
  /**
   * **谜质压制后的威胁读数**（F3c B1）：界面与 core 走同一个 `wormholeMatterThreatMul`
   * ⇒ 玩家看到的威胁就是开战真正吃的那个数。
   *
   * ⚠ 2026-09-15 撤离战取消 ⇒ **只剩下节点档**（原先还有一档"撤离 ×0.8"的读数，随撤离战一并退役）。
   */
  const nodeThreat = run ? Math.round(wormholeLayerThreat(run.depth) * wormholeMatterThreatMul(matterBuffs, 'node')) : 0
  const matterThreatTip =
    matterBuffs.threatNodeMul < 1 || matterBuffs.threatBossMul < 1
      ? tr("ui.Wormhole.182", { p1: matterBuffs.threatNodeMul.toFixed(2), p2: (matterBuffs.threatNodeMul * matterBuffs.threatBossMul).toFixed(2) })
      : tr("ui.Wormhole.064")
  /** 当前格上还剩几堆（打捞/采集共用；按钮上显示"本次能回收几堆"） */
  const herePiles = hereCell?.piles ?? []
  /**
   * **堆分两类**（2026-09-13 修好货柜拾取后）：
   * - **形状件**（安全货柜 2×2 / 图纸货柜 2×1）= 要玩家**自己拾取装舱**（放不下整件拒收）；
   * - 其余 = 残骸 / 母矿，走「打捞」「采集」的成批回收。
   * 按钮可用性只看**可成批回收的那部分**（只剩货柜时「打捞」不该亮着）。
   */
  const shapedPiles = herePiles.filter((p) => wormholeIsShapedItem(p.itemId))
  const bulkPiles = herePiles.length - shapedPiles.length
  /**
   * **被拿走的那几堆卡片：向下移出 + 淡出**（船长 2026-09-13 深夜：「将地点详细里，那些被打捞或者
   * 采集掉的卡片，添加一个向下移出+淡出的消失动画」）。
   *
   * 做法（不引第三方动画库）：留一份"上一帧的堆签名"，本帧对不上的条目挑出来当**幽灵卡**
   * 渲染 `WORMHOLE_PILE_OUT_MS`（300ms），动画放完就摘掉；幽灵卡不吃点击、也不参与任何判定。
   * ⚠ **换格子不算消失**（那是整块信息窗换内容）⇒ `hereKey` 变了就直接清空，不播这个动画。
   */
  const [leavingPiles, setLeavingPiles] = useState<Array<{ key: string; itemId: string; units: number }>>([])
  const prevPilesRef = useRef<{ hereKey: string; sigs: string[] }>({ hereKey: '', sigs: [] })
  const pileSig = herePiles.map((p) => `${p.itemId}|${p.units}`).join(';')
  useEffect(() => {
    const sigs = pileSig.length > 0 ? pileSig.split(';') : []
    const prev = prevPilesRef.current
    prevPilesRef.current = { hereKey, sigs }
    // 换了格子（或还没进网格）⇒ 直接清空幽灵卡，不播"消失动画"
    if (prev.hereKey !== hereKey) {
      setLeavingPiles((l) => (l.length > 0 ? [] : l))
      return
    }
    const pool = [...sigs]
    const gone: string[] = []
    for (const s of prev.sigs) {
      const i = pool.indexOf(s)
      if (i >= 0) pool.splice(i, 1)
      else gone.push(s)
    }
    if (gone.length === 0) return
    const stamp = Date.now()
    const add = gone.slice(0, 12).map((s, i) => {
      const bar = s.lastIndexOf('|')
      return { key: `${s}#${stamp}#${i}`, itemId: s.slice(0, bar), units: Number(s.slice(bar + 1)) }
    })
    setLeavingPiles((l) => [...l, ...add])
    const t = window.setTimeout(
      () => setLeavingPiles((l) => l.filter((x) => !add.some((a) => a.key === x.key))),
      WORMHOLE_PILE_OUT_MS,
    )
    return () => window.clearTimeout(t)
  }, [pileSig, hereKey])
  /**
   * **编队第一艘船的 defId**（地图上"当前格"用它的舰影表示 —— 船长 2026-09-13）。
   * 取不到（老档 uid 悬空）就退化成一个小箭头，不让地图空着。
   */
  const leadShipDefId = (() => {
    const uid = run?.fleet[0]
    if (!uid) return undefined
    return ctx.ships.get(state.fleet[uid]?.defId ?? uid)?.id
  })()
  /** 当前地点能不能激活：空信息地点/信标没作业、处理过的不重复、入口格守卫清掉后不再触发 */
  const canActivate = !!grid && !!hereCell && !grid.activated.includes(hereKey) && (atExit ? !bossDone : hereCell.place !== 'empty')
  /** 打捞格：没打捞器就打不了；有打捞器但堆已空 ⇒ 也打不了 */
  const canSalvage = salvageCell && salvagers > 0 && bulkPiles > 0 && (run?.turnsLeft ?? 0) >= 1
  /** 矿脉：没采集器就挖不动；有采集器但堆已空 ⇒ 也采不了 */
  const canCollect = veinCell && miners > 0 && bulkPiles > 0 && (run?.turnsLeft ?? 0) >= 1
  /** **免激活的两个作业格**（打捞 / 采集）：界面按钮走同一个引擎入口，标签与拒因按地点分流 */
  const workCell = salvageCell || veinCell
  const canWork = salvageCell ? canSalvage : veinCell ? canCollect : false
  const rigs = salvageCell ? salvagers : miners
  const rigName = veinCell ? tr("ui.Wormhole.238") : tr("ui.Wormhole.001")
  /**
   * **进洞门槛**（核心同一把尺 `wormholeEntryBlockReason`）——**不再用界面徽标 `shipBusyLabel` 自己判**：
   * 两者对「扫描虫洞」口径不同（徽标报"忙"，门槛放行 ⇒ 进洞那一步自动停扫，船长 2026-09-14「进洞自动停止」）。
   */
  const entryGate = auto || run ? null : engine.wormholeEntryGate(picked)
  /** 进洞会先自动停掉的那个活动（目前只有「扫描虫洞」；null = 没有） */
  const autoStopText = auto || run ? null : engine.wormholeEntryAutoStopText()
  /** 带 `warn` 的（长途运输）要单独摆成**警告条**——船长 2026-09-14：「长途运输发出警告」 */
  const autoStopWarns = auto || run ? [] : engine.wormholeEntryAutoStopList().filter((a) => a.warn)
  /**
   * **货仓超载**（F4 · 船长裁定 8：沉船后要求玩家手动抛弃货物）：
   * 超载期间不能再装货（拾取/打捞/战果），撤离与深入也要先抛到容量内 ⇒ 界面据此置灰并给提示。
   */
  /** **本趟结算单**（有它 ⇒ 整页只显示结算界面，见船长 2026-09-13）；自动探索模式不看它（那趟与自动队无关） */
  const settle = auto ? null : state.wormhole.lastSettle
  const holdInfo = run ? engine.wormholeHoldInfo() : null
  const overloaded = holdInfo?.overload ?? false
  /**
   * **动作闸**（船长 2026-09-14：「临时空间内有物品就不允许进行其他操作，和之前的超载类似」）：
   * 临时空间有东西 **或** 货仓超载 ⇒ 扫描/前往/打捞/采集/开战/撤离/深入一起置灰，并把理由摆出来。
   */
  const actionBlocked = run ? engine.wormholeActionBlocked() : null
  /**
   * **进场/换层动效相位**（船长 2026-09-13：「入场动画时长可以拉长到 1 秒，并且可以实现玩家初始舰船
   * 从屏幕外入场的效果（前往下一层时也可以飞出屏幕外，到达时从屏幕外飞入）」）：
   * `in` = 舰影从地图外飞入（进场与到达新层都播）· `out` = 往地图外飞走（深入前先播）· `idle` = 静止。
   * ⚠ 动效期间**所有作业按钮禁用**（`fxBusy`）：否则"飞出"还没播完玩家就点下一个动作，画面会跳。
   */
  const [fx, setFx] = useState<'idle' | 'out' | 'in'>('in')
  const fxBusy = fx !== 'idle'
  /** 扫描动画（扫完自动清；`nonce` 换一次 = 重播一次） */
  const [scanFx, setScanFx] = useState<{ keys: string[]; rings: number; nonce: number } | null>(null)
  /**
   * **星云消散动画**（船长 2026-09-13：「当消除星云时，给星云添加个消散的动画」）：
   * 记下"这一批刚被驱散的是哪几格"，地图上给它们挂 `is-dissolving` ⇒ 云团描边外扩 + 淡出（700ms）。
   * 与逐格点亮同一套节奏：延迟按"第几圈"给（云从里往外一圈圈散开）。
   */
  const [dissolveFx, setDissolveFx] = useState<{ keys: string[]; nonce: number } | null>(null)
  /** 撤离的**待确认态**（两讨伐确认：第一次点只亮警告、第二次点才真撤）——5 秒不点自动解除 */
  const [extractAsk, setExtractAsk] = useState(false)
  /**
   * **临时空间待清空确认**（船长 2026-09-14：「离开背包页时丢弃并失效」＋「强制二选一：丢掉 或 放回」
   * ＋「撤离前必须清空」）：三个触发口（切页 / 关面板 / 撤离）都在面板这一层；确认条画在背包页里
   * ⇒ 触发时**先把页签切到背包**再弹条。
   */
  const [tempAsk, setTempAsk] = useState<null | 'tab' | 'close' | 'extract'>(null)
  useEffect(() => {
    if (!extractAsk) return
    const t = window.setTimeout(() => setExtractAsk(false), 5000)
    return () => window.clearTimeout(t)
  }, [extractAsk])
  /** 地图缩放（船长 2026-09-13：「在探索界面的左侧给玩家一个缩放按钮或者滚动条……调节探索地图的大小」） */
  const [mapZoom, setMapZoom] = useState(WORMHOLE_MAP_ZOOM_FIT)
  /**
   * **鼠标滚轮缩放地图**（船长 2026-09-13：「允许鼠标滚轮缩放虫洞的探索地图」）。
   *
   * 为什么不用 React 的 `onWheel`：React 把 wheel 挂成**被动监听**（passive）⇒ 里面 `preventDefault()`
   * 拦不住"滚轮穿到面板体 / 外层弹层上"，地图缩放了、背后的列表也跟着滚。所以这里自己挂**原生**
   * 监听并显式 `{ passive: false }`：指针在地图框里滚 ⇒ **只缩放地图、不滚动任何东西**。
   * 步长取按钮的一半（0.125）——滚轮是连续输入，用按钮那档会一跳一跳；上下限与按钮同一把尺
   * （`WORMHOLE_MAP_ZOOM_FIT` ~ `WORMHOLE_MAP_ZOOM_MAX`）。指针不在图上时一个字节都不拦。
   *
   * ⚠ **必须用回调 ref、不能用 `useEffect` 挂**（船长 2026-09-13 报的 BUG：「战斗后，滚轮失效，
   * 需要重开虫洞探索界面」）：战斗期间本面板**整块不渲染**（见 `run.battle` 那条早退）⇒ 地图框连同
   * 监听一起卸载；战斗结束面板回来时元素是**新节点**，而 `useEffect` 的依赖（有没有 run / 哪个页签）
   * 没变 ⇒ **不会补挂**，于是滚轮从此失效。回调 ref 在**每次挂载**都拿到新节点、顺手挂监听、旧节点
   * 卸载时清掉 ⇒ 战斗前后、切页前后都不会漏。
   */
  const wheelCleanupRef = useRef<(() => void) | null>(null)
  const mapBoxRef = useCallback((el: HTMLDivElement | null) => {
    wheelCleanupRef.current?.()
    wheelCleanupRef.current = null
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (e.deltaY === 0) return
      e.preventDefault()
      const step = e.deltaY < 0 ? WORMHOLE_MAP_ZOOM_WHEEL_STEP : -WORMHOLE_MAP_ZOOM_WHEEL_STEP
      setMapZoom((z) =>
        Math.min(WORMHOLE_MAP_ZOOM_MAX, Math.max(WORMHOLE_MAP_ZOOM_FIT, +(z + step).toFixed(3))),
      )
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    wheelCleanupRef.current = () => el.removeEventListener('wheel', onWheel)
  }, [])
  useEffect(() => () => wheelCleanupRef.current?.(), [])
  const layerKeyForFx = run ? `${run.seed ?? 0}-${run.depth}` : 'none'
  /** 新层挂载 ⇒ 播"从屏幕外飞入"，1 秒后交还操作（进场与深入共用这一条） */
  useEffect(() => {
    if (!run) return
    /**
     * ⚠ **换层要把"逐层的确认态"清干净**（2026-09-14 修船长报障「**前往下一层后，上一层遗留的按钮
     * 未消失**」）：`pendingCell` = "点了未扫描的格 ⇒ 待确认前往"那个**双按钮条**（确认前往 / 取消），
     * 记的是上一层的 **Q/R 坐标**；它只是普通 state、不随换层重置 ⇒ 深入后仍挂在新层头顶，
     * 而且同坐标在新层另有格子（点下去会跑到新层的那个坐标）。这里与 `fx` 一起复位。
     */
    setPendingCell(null)
    setFx('in')
    const t = window.setTimeout(() => setFx('idle'), WORMHOLE_FX_IN_MS)
    return () => window.clearTimeout(t)
  }, [layerKeyForFx, !!run])
  /** 扫描动画收尾：波散完 + 格子亮完就清（清理只影响表现，数据早已落盘） */
  useEffect(() => {
    if (!scanFx) return
    const t = window.setTimeout(() => setScanFx(null), WORMHOLE_FX_SCAN_MS)
    return () => window.clearTimeout(t)
  }, [scanFx])
  /** 星云消散收尾：700ms 后摘掉类名（不摘的话云虽然已经不在可见态里，但类名会一直挂着） */
  useEffect(() => {
    if (!dissolveFx) return
    const t = window.setTimeout(() => setDissolveFx(null), WORMHOLE_FX_NEBULA_MS)
    return () => window.clearTimeout(t)
  }, [dissolveFx])
  /**
   * **作业进度条**（F2b · 船长 2026-09-13 裁定「只做表现层进度条」）：
   * 打捞 / 采集 / 拾取装舱成功时播一条 380ms 的回收进度条，条上写明"这一批收了多少"。
   * **纯表现**——动作在点下那一刻已经结算完（与扫描波、堆卡"向下移出"同一套口径），
   * 因此不锁按钮、不拦连点（连点两次 = 进度条重播一次，属预期）。
   */
  const [jobFx, setJobFx] = useState<{ label: string; sub: string; nonce: number } | null>(null)
  useEffect(() => {
    if (!jobFx) return
    const t = window.setTimeout(() => setJobFx(null), WORMHOLE_FX_JOB_MS)
    return () => window.clearTimeout(t)
  }, [jobFx])
  /** 播一条作业进度条（`nonce` 换一次 = CSS 动画重播一次） */
  const playJob = (label: string, sub: string): void =>
    setJobFx((p) => ({ label, sub, nonce: (p?.nonce ?? 0) + 1 }))
  /**
   * **作业前「货仓会不会满」预告**（船长 2026-09-13：「**在打捞挖矿之前货仓可能会满的时候提醒玩家**」）：
   * 把当前格上剩下的**散货堆**按 m³ → 格折算成预计入仓格数，与货仓剩余格数比大小。
   * 口径是**保守估计**（同种物品可能压进已有的半格 ⇒ 实际可能少占一点，故文案写"约"）；
   * 形状件（安全货柜）不参与这条算式——它有自己的收货阶梯（货仓腾不出 2×2 会先进临时空间）。
   */
  const incomingCells = (() => {
    const m3ById = new Map<string, number>()
    for (const p of hereCell?.piles ?? []) {
      if (wormholeIsShapedItem(p.itemId)) continue
      m3ById.set(p.itemId, (m3ById.get(p.itemId) ?? 0) + p.units * (ctx.items.get(p.itemId)?.unitM3 ?? 0))
    }
    let m3 = 0
    for (const v of m3ById.values()) m3 += v
    return m3 > 0 ? Math.ceil(m3 / WORMHOLE_SLOT_M3) : 0
  })()
  const holdFreeCells = holdInfo ? Math.max(0, holdInfo.capacity - holdInfo.used) : 0
  /** 这一格的产出**装不下**（还差多少格）——只在工作格真有活、货仓读数在手时才算 */
  const holdShortBy = workCell && holdInfo ? Math.max(0, incomingCells - holdFreeCells) : 0

  /* ── 选舰检索（船长 2026-09-13「缺少一个类似我的舰队里的舰船筛选和搜索」）──
     复刻「我的舰队」那套：搜索词（舰名/船型名，忽略大小写）+ 两行筛选（类别 / 级别，各维取「与」）；
     类别与级别复用同一张单点表（`SHIP_SUBS` / `SHIP_TIER_SUBS`），与市场/手册/组装机同口径。
     （2026-09-13 船长：「状态的筛选可以删除」⇒ 原「状态」那一行整行退场。） */
  const [whQ, setWhQ] = useState('')
  const [whRole, setWhRole] = useState<string>(SUB_ALL)
  const [whTier, setWhTier] = useState<string>(SUB_ALL)
  const whEntries = Object.keys(state.fleet).map((uid) => {
    const def = ctx.ships.get(state.fleet[uid]!.defId ?? uid)
    /**
     * 卡片上的"忙"：走**进洞门槛那把尺**（`engine.wormholeShipEntryBusy`），不是泛用的界面徽标——
     * 两者对「扫描虫洞」口径不同：徽标报"忙"（它确实占着主控），但**进洞放行**（进洞会自动停扫，
     * 船长 2026-09-14「进洞自动停止」）⇒ 主控那张卡不该因此锁住（否则默认编队里的主控会被标灰）。
     */
    const busy = auto ? null : engine.wormholeShipEntryBusy(uid)
    /**
     * 可编入性：**手动**照旧走"洞口准入"（`wormholeShipAllowed`：T5 与超重进不去）；
     * **自动**换走自动探索那把尺（主控船 = 交接可行才放行，其余 = 无拒因）。
     */
    const autoBlocked = auto ? (uid === state.shipId ? autoMainReason : (autoBlockedOf.get(uid) ?? null)) : null
    const ok = auto ? autoBlocked === null : def ? wormholeShipAllowed(def) : false
    return {
      uid,
      def,
      name: shipDisplayName(state, ctx, uid),
      tier: def?.tier ?? 0,
      ok,
      busy: auto ? autoBlocked : busy,
      on: picked.includes(uid),
      // **损伤**（与舰队页「待维修」同一把尺）：装甲/结构未满 = 带伤；护盾每场满值重建、不持久、不计
      armor: state.fleet[uid]!.armorPct ?? 1,
      dur: durabilityOf(state, uid),
    }
  })
  const whFiltered = whQ.trim().length > 0 || whRole !== SUB_ALL || whTier !== SUB_ALL
  const whShown = pinMarked(
    state,
    'ships',
    whEntries.filter((e) => {
      const q = whQ.trim().toLowerCase()
      if (q.length > 0) {
        const hay = `${e.name} ${e.def?.name ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      // 类别 / 级别：走**唯一入口** `shipRolePasses` / `shipTierPasses`（2026-09-19 乙组·判定单点；
      // 类别 = 派生类别键 `shipCategoryKeyOf`，与舰队/仓库/手册同一把尺）
      if (!shipRolePasses(e.def, whRole)) return false
      if (!shipTierPasses(e.def ?? { tier: e.tier }, whTier)) return false
      return true
    }),
    /**
     * **已标记（收藏）的船靠前**（船长 2026-09-14：「虫洞准备页面，玩家标记的船也要靠前」）：
     * 口径与舰队页逐字同款——`pinMarked` 只把标记项插到最前、**组内保持原顺序**（本次是"机库序"），
     * 不重排其余项；本页没有用户可选排序键（只有搜索 + 类别/级别子筛选）⇒ 恒走「默认排序」这一条
     * （口径出处：`core/marks.ts` 头注 + `ui/marks.tsx`——置顶只在默认排序下生效）。
     */
    (e) => e.uid,
  )

  /** 编队上限：手动 = `WORMHOLE_MAX_SHIPS`；自动 = 4 条副船（船长定案） */
  const pickCap = auto ? WORMHOLE_AUTO_MAX_SHIPS : WORMHOLE_MAX_SHIPS

  function togglePick(uid: string): void {
    setPicked((prev) => {
      if (prev.includes(uid)) return prev.filter((x) => x !== uid)
      if (prev.length >= pickCap) {
        onToast(auto ? tr("ui.Wormhole.183", { pickCap: pickCap }) : tr("ui.Wormhole.124", { pickCap: pickCap }), true)
        return prev
      }
      return [...prev, uid]
    })
  }

  function handleEnter(): void {
    const r = stockId ? engine.wormholeEnterFromStock(stockId, picked) : engine.wormholeEnter(picked)
    if (!r.ok) onToast(r.error ?? '无法跃入。', true)
    else {
      onToast(tr("ui.Wormhole.065"))
      setTab('map')
    }
  }

  /**
   * **自动探索 · 派队**（船长 2026-09-14）：准备页挑好队伍 ⇒ 出发。
   * 队里有主控 ⇒ **先弹确认**（写明主控要换给谁，见 `mainAsk`），确认后才真的派。
   */
  function startAuto(): void {
    if (autoStockId === null) return
    const r = engine.wormholeAutoStart(autoStockId, picked)
    if (!r.ok) onToast(r.error ?? '派队失败。', true)
    else {
      onToast(
        tr("ui.Wormhole.184", { p1: Math.round(WORMHOLE_AUTO_DURATION_MS / 60_000) }),
      )
      onClose()
    }
  }

  function handleAutoStart(): void {
    if (autoMainPicked) setMainAsk(true)
    else startAuto()
  }

  /* ── 层内网格动作（F3a-2）：扫描 / 前往 各 1 回合；**激活免费**（2026-09-15）；打捞 / 采集每次动作 1 回合 ──
     口径（船长 2026-09-13）：「玩家可以到达任意位置，包括未扫描，但是前往未扫描的地方需要
     警告玩家即将前往未知地点」⇒ 点未扫描的格**只摆警告**（不移动、不扣回合），
     等玩家点「确认前往」才真的走。核心侧同样有这道闸（`code === 'unknown-target'`），
     界面不依赖"记得拦"——两边同一把尺。 */

  /**
   * 点格：已扫描/已到达 ⇒ 直接走；未扫描 ⇒ 先警告。
   * ⚠ **2026-09-16 路径拦截**：**不管目标是否已知**，先在核心同一把尺上算一次"直线路径上最近的未清敌人格"
   * ⇒ 有拦截就一律先摆确认栏（不直接走、不扣回合）。已知格才把 `interceptKey` 交给地图描红指名；
   * 未扫描的拦截格**不指名**（甲案：不泄漏未扫描格的内容），只把路径线置警示色。
   */
  function pickCell(q: number, r: number): void {
    if (!grid || !run) return
    if (run.battle) {
      onToast(tr("ui.Wormhole.003"), true)
      return
    }
    const cell = grid.cells.find((c) => c.key === `${q},${r}`)
    if (!cell) return
    if (cell.key === hereKey) {
      onToast(tr("ui.Wormhole.066"))
      return
    }
    const unknown = !grid.scanned.includes(cell.key) && !grid.visited.includes(cell.key)
    const hit = wormholePathInterceptAt(grid, { q, r })
    if (hit) {
      const known = grid.scanned.includes(hit.key) || grid.visited.includes(hit.key)
      setPendingCell({ q, r, unknown, intercept: { q: hit.q, r: hit.r, known } })
      return
    }
    if (unknown) {
      setPendingCell({ q, r, unknown: true, intercept: null })
      return
    }
    travelTo(q, r, false, false)
  }

  /**
   * 真的走（`confirmUnknown` / `confirmIntercept` 由上面的确认栏给出；核心侧同样有这两道闸）。
   * 被拦截时战斗界面接手（那条路径与"到达舰船信号即开打"完全同款，故不额外弹提示）。
   */
  function travelTo(q: number, r: number, confirmUnknown: boolean, confirmIntercept: boolean): void {
    const res = engine.wormholeTravel(q, r, confirmUnknown, confirmIntercept)
    if (!res.ok) {
      onToast(res.error ?? '无法前往。', true)
      return
    }
    setPendingCell(null)
    // 到达即触发的两件事（船长 2026-09-13）：信标指路 / 舰船信号就地开打（战斗界面接手，不提示）
    if (res.beacon) onToast(tr("ui.Wormhole.125"))
  }

  /**
   * **扫描动画**（船长 2026-09-13 拍板「甲：扫描波 + 逐格点亮」）：
   * 点下扫描即结算（数据不等动画），这里只记"这一批新揭开了哪几格 + 扫了几圈"，
   * 地图据此画一圈扩散的波、并让新格子**按圈依次亮起**；动画放完（~900ms）自动清空。
   */
  function doScan(): void {
    const before = new Set(grid?.scanned ?? [])
    const res = engine.wormholeScan()
    if (!res.ok) {
      onToast(res.error ?? '无法扫描。', true)
      return
    }
    const after = grid?.scanned ?? []
    const fresh = after.filter((k) => !before.has(k))
    setScanFx({ keys: fresh, rings: Math.max(1, Math.floor(grid?.scanRadius ?? 1)), nonce: scanFxSeq() })
    /**
     * **星云消散动画**（船长 2026-09-13）：这一扫驱散了哪几格，就给它们播一段"云散开"。
     * 时机与"逐格点亮"一致（都在数据落地之后补播），故两者能叠在同一帧里不打架。
     */
    if ((res.dispersed ?? 0) > 0) {
      setDissolveFx({ keys: grid?.dispersed ?? [], nonce: scanFxSeq() })
    }
    /**
     * **星云反馈**（船长 2026-09-13 星云机制）：一次扫描可能同时做两件事——
     * 揭开新格、驱散圈内的星云。两种情况各给一句提示，玩家才分得清"这次扫到的东西被云挡着"
     * （要**再扫一次**）与"云散了"。
     * ⚠ **扫到下一层入口**（船长 2026-09-16 甲案）与它们并列：地图上会立刻标出入口
     * （`grid.exitKnown`），这里再补一句，免得玩家漏看地图上多出来的那个标记。
     */
    const dispersed = res.dispersed ?? 0
    const fogged = res.newlyFogged ?? 0
    const parts: string[] = []
    if (fogged > 0 && dispersed > 0) {
      parts.push(tr("ui.Wormhole.004", { fogged: fogged, dispersed: dispersed }))
    } else if (fogged > 0) {
      parts.push(tr("ui.Wormhole.005", { fogged: fogged }))
    } else if (dispersed > 0) {
      parts.push(tr("ui.Wormhole.239", { dispersed: dispersed }))
    }
    if (res.exitScanned === true) parts.push(tr("ui.Wormhole.067"))
    onToast(parts.length > 0 ? tr("ui.Wormhole.068", { p1: parts.join(' ') }) : tr("ui.Wormhole.069"))
  }

  /**
   * 当前地点的作业入口（F5 起**墓场/遗迹/矿脉都不用先"激活"**，走到就铺好产出）：
   * 舰船信号 / 下一层入口会**就地开战**；**墓场/遗迹 = 打捞一批**、**矿脉 = 采集一批**
   * （两者都在 core 侧按台数分流）；谜质的增强待定（F3c）。
   */
  function doActivate(): void {
    const place = hereCell?.place
    const exitNow = atExit
    /**
     * **动手前的容量提醒**（船长 2026-09-13：「在打捞挖矿之前货仓可能会满的时候提醒玩家」）：
     * 这一格的产出按保守估计装不下时，先喊一句再干活（**不拦着**：打捞到装不下会自己停下、剩下的留在原地）。
     */
    if (holdShortBy > 0) {
      onToast(tr("ui.Wormhole.006", { incomingCells: incomingCells, holdFreeCells: holdFreeCells }))
    }
    const res = engine.wormholeActivate()
    if (!res.ok) {
      onToast(res.error ?? '无法激活。', true)
      return
    }
    if (exitNow || place === 'ship') return // 已开战：交给战斗界面
    if (place === 'graveyard' || place === 'ruins') {
      playJob(tr("ui.Wormhole.070"), tr("ui.Wormhole.126", { p1: res.taken ?? 0 }))
      onToast(tr("ui.Wormhole.071", { p1: res.taken ?? 0 }))
      return
    }
    if (place === 'vein') {
      playJob(tr("ui.Wormhole.240"), tr("ui.Wormhole.126", { p1: res.taken ?? 0 }))
      onToast(tr("ui.Wormhole.241", { p1: res.taken ?? 0 }))
    } else if (place === 'matter') {
      /**
       * **取回谜质**（F3c · 船长 2026-09-13）：装置是哪一台按 (种子, 层, 格) 定死，
       * 界面用同一个函数读出来报名字（与 core 落包的那一台必然一致）。
       */
      const dev = wormholeMatterDeviceAt(run?.seed ?? 0, run?.depth ?? 1, hereKey)
      onToast(tr("ui.Wormhole.072", { p1: dev.name, p2: dev.text }))
    }
  }

  /**
   * **深入下一层**（船长 2026-09-13：「前往下一层时也可以飞出屏幕外，到达时从屏幕外飞入」）：
   * ① 先播 600ms「飞出屏幕外」（这一段时间真的**不下沉**，所以失败也不会出现"飞走了却没走成"）；
   * ② 到点才调 `engine.wormholeDescend()`；③ 新层挂载后由 `layerKey` 那个 effect 播 1 秒飞入。
   */
  function doDescend(): void {
    if (fxBusy) return
    setFx('out')
    window.setTimeout(() => {
      const r = engine.wormholeDescend()
      if (!r.ok) {
        setFx('idle')
        onToast(r.error ?? '无法深入。', true)
      }
      // 成功：`layerKey` 变了 ⇒ 那个 effect 会接着播飞入并复位
    }, WORMHOLE_FX_OUT_MS)
  }

  function doExtract(): void {
    // **临时空间没清空 ⇒ 先切到背包页弹确认条**（船长 2026-09-14：「撤离前必须清空（丢掉或放回）」）
    if (engine.wormholeTempPending().count > 0) {
      setTab('bag')
      setTempAsk('extract')
      return
    }
    const r = engine.wormholeExtract()
    if (!r.ok) {
      onToast(r.error ?? '无法撤离。', true)
      return
    }
    /**
     * **撤离提示**（船长 2026-09-13：「玩家撤离时提醒玩家需要进行撤离战」的旧口径）。
     * ⚠ 2026-09-15 撤离战取消 ⇒ 提示语改为"直接入港"（不再分第 1 层 / 深层，也不再提拦截）。
     */
    onToast(tr("ui.Wormhole.185"))
  }

  /**
   * **离开背包页的统一关卡**（船长 2026-09-14：「强制二选一：丢掉 或 放回」）：
   * 临时空间非空就不放行，弹确认条（逐件列出）；处理完**按原意图继续**（切探索 / 关面板 / 撤离）。
   */
  function leaveBagPage(intent: 'tab' | 'close' | 'extract', go: () => void): void {
    if (engine.wormholeTempPending().count === 0) {
      go()
      return
    }
    setTab('bag')
    setTempAsk(intent)
  }

  /** 处理完临时空间之后，把玩家原本想做的事接着做完（切页那条 = 去探索页） */
  function resumeAfterTemp(ask: null | 'tab' | 'close' | 'extract'): void {
    if (ask === 'extract') doExtract()
    else if (ask === 'close') onClose()
    else if (ask === 'tab') setTab('map')
  }

  /** 「丢掉这些」：逐件丢弃（谜质装置一并失效、回合夹紧），清空后按原意图继续 */
  function tempDiscardAndContinue(): void {
    const ask = tempAsk
    const r = engine.wormholeTempDiscardAll()
    setTempAsk(null)
    if (r.moved > 0) onToast(tr("ui.Wormhole.073", { p1: r.moved }), true)
    resumeAfterTemp(ask)
  }

  /** 「放回货仓」：逐件尝试（放不下的留在临时空间并提示先整理/抛货） */
  function tempStowAndContinue(): void {
    const ask = tempAsk
    const r = engine.wormholeTempStowAll()
    if (r.stuck.length > 0) {
      setTempAsk(null)
      onToast(tr("ui.Wormhole.186", { p1: r.stuck.length }), true)
      return
    }
    setTempAsk(null)
    if (r.moved > 0) onToast(tr("ui.Wormhole.074", { p1: r.moved }))
    resumeAfterTemp(ask)
  }

  /** 打捞/采集按钮的悬浮说明（只在真能用时才渲染按钮，故这里只讲"这一批能回收多少"） */
  const workTitle = veinCell
    ? tr("ui.Wormhole.242", { rigs: rigs, p2: Math.min(rigs, herePiles.length) })
    : tr("ui.Wormhole.075", { rigs: rigs, p2: Math.min(rigs, herePiles.length) })

  /**
   * **当前地点的信息卡**（船长 2026-09-13：扫描按钮放大后**与它平级**摆在左侧）——
   * 内容与原样一致（地点名 / 坐标 / 已处理标记 / 堆清单或地点说明）。
   */
  function renderHereNode(): React.ReactNode {
    if (!grid || !hereCell) return null
    return (
      <>
        <div className="app-wh-node-title">
          {atExit ? tr("ui.Wormhole.007") : WORMHOLE_PLACE_TEXT[hereCell.place]}
          {/* 地点说明**不进 ⓘ**（2026-09-14 船长裁定：「地点卡的说明不要进 ⓘ」）：它跟着当前格子变，
              属于"这一格现在是什么"的读数 ⇒ 按 2026-09-13 口径（常驻说明进 ⓘ、状态读数留眼前）留在卡里 */}
          <span className="app-dim">
            {' '}{tr('ui.Wormhole.275')}Q{grid.pos.q} · R{grid.pos.r}
            {grid.activated.includes(hereKey) ? ' · 已处理' : ''}
          </span>
        </div>
        {/* **作业进度条**（F2b · 纯表现 380ms）：摆在堆清单正上方——卡片"向下移出"的同时，这条在走 */}
        {jobFx ? (
          <div className="app-wh-jobrow" key={jobFx.nonce}>
            <span className="app-wh-jobrow-text">
              {jobFx.label}
              {jobFx.sub ? <span className="app-dim"> · {jobFx.sub}</span> : null}
            </span>
            <span className="app-card-progress app-wh-jobbar">
              <i />
            </span>
          </div>
        ) : null}
        {/**
         * ⚠ **判据要带"幽灵卡"**（船长 2026-09-13 深夜报的坑：「**当最后打捞干净时，卡片是直接消失的**」）：
         * 原先这里只看 `herePiles.length > 0` ⇒ 最后一堆被拿走的瞬间整块换成"地点说明"，
         * 幽灵卡**根本没机会渲染**。现在"还有卡"含幽灵卡，动画播完（300ms）才轮到地点说明。
         */}
        {herePiles.length > 0 || leavingPiles.length > 0 ? (
          <>
            {workCell && bulkPiles > 0 ? (
              <div className="app-dim app-note">
                {veinCell ? tr("ui.Wormhole.187") : tr("ui.MarketPage.009")}堆 {bulkPiles} 堆{veinCell ? '' : tr("ui.Wormhole.243")}{tr('ui.Wormhole.276')}
                {rigName} <b>{rigs}</b> {tr("ui.Wormhole.076")} {Math.min(Math.max(rigs, 0), bulkPiles)} {tr("ui.Wormhole.077")}{' '}
                {rigs > 0 ? Math.ceil(bulkPiles / rigs) : '—'} {tr("ui.Wormhole.078")}
                {rigs <= 0 ? tr("ui.Wormhole.244", { rigName: rigName, rigName2: rigName }) : ''}{tr('ui.Wormhole.277')}
              </div>
            ) : null}
            {shapedPiles.length > 0 ? (
              <div className="app-dim app-note">
                {tr("ui.FitPage.072")} <b>{shapedPiles.length}</b>{tr('ui.Wormhole.278')}
              </div>
            ) : null}
            {/**
             * **本格的谜质是哪一台**（F3c · 船长 2026-09-13）：按 (种子, 层, 格) 定死 ⇒ 界面读出来的
             * 与 core 落包的那一台必然一致（同一个 `wormholeMatterDeviceAt`）。
             */}
            {hereCell.place === 'matter' ? (
              <div className="app-dim app-note">
                {tr("ui.Wormhole.245")}<b>{wormholeMatterDeviceAt(run?.seed ?? 0, run.depth, hereKey).name}</b>{tr("ui.Wormhole.008")}
                {wormholeMatterDeviceAt(run?.seed ?? 0, run.depth, hereKey).text}{tr('ui.Wormhole.279')}
              </div>
            ) : null}
            {/* **装不下的预告**（船长 2026-09-13）——把"再捞就满"这件事摆在按钮之前，别等捞到一半才发现 */}
            {holdShortBy > 0 ? (
              <div className="app-wh-hold-soon">
                {tr("ui.Wormhole.188")} {bulkPiles} {tr("ui.Wormhole.079")} <b>{incomingCells}</b> 格，
                货仓只剩 <b>{holdFreeCells}</b> {tr("ui.Wormhole.127")} {holdShortBy} 格）——装不下的会留在原地，
                先把散货抛掉或腾出货仓格再来，或者直接撤离带货回家。
              </div>
            ) : null}
            {/**
             * **堆清单 = 卡片 + 内部滚动**（船长 2026-09-13：「将地点详细中出现的列表换成卡片形式，
             * 并添加滚动条。（防止外侧出现滚动条。）」）：卡片网格吃满信息窗剩余高度，
             * 超出就在**这张卡网格内部**滚（`.app-wh-cardlist`），外层永远不因此出滚动条。
             */}
            <div className="app-wh-cardlist">
              {herePiles.map((p, i) => {
                const def = ctx.items.get(p.itemId)
                const shaped = wormholeIsShapedItem(p.itemId)
                const slotUse = wormholeUnitsPerSlot(def?.unitM3 ?? 0)
                return (
                  <div key={`${p.itemId}-${i}`} className={`app-wh-pile${shaped ? ' is-shaped' : ''}`}>
                    <span className="app-wh-pile-name">
                      {/* 与货仓格同一枚图标（安全货柜按族、谜质按台）⇒ 地上与仓里对得上号 */}
                      <span
                        className="app-wh-hold-row-ico"
                        style={{ color: itemToneOf(p.itemId, itemIconOf(p.itemId, def?.kind)) }}
                      >
                        <Glyph name={itemIconOf(p.itemId, def?.kind)} size={14} color="currentColor" />
                      </span>
                      {def?.name ?? p.itemId}
                    </span>
                    <span className="app-wh-pile-count">×{n(p.units)}</span>
                    <span className="app-wh-pile-sub">
                      {n(p.units * (def?.unitM3 ?? 0))} m³
                      {shaped ? ' · 整件占 2×2 = 4 格' : ` · 每格 ${n(slotUse)} 单位`}
                    </span>
                    {shaped ? (
                      /* **形状件（货柜）**：唯一入口就是这个拾取装舱（打捞/采集都不搬它） */
                      <button
                        className="app-btn is-small is-primary app-wh-pile-btn"
                        disabled={!!run.battle || actionBlocked !== null}
                        onClick={() => {
                          const r = engine.wormholeTakePile(i)
                          if (!r.ok) onToast(r.error ?? '拾取失败。', true)
                          else {
                            playJob(tr("ui.Wormhole.189"), def?.name ?? '货柜')
                            onToast(tr("ui.Wormhole.080"))
                          }
                        }}
                        title={tr("ui.Wormhole.128")}
                      >
                        {tr("ui.Wormhole.129")}
                      </button>
                    ) : (
                      /* 母矿与残骸都靠**台数 × 回合**成批回收（船长 F5：规则同打捞）⇒ 不逐堆拾取 */
                      <span className="app-wh-pile-tag">{veinCell ? tr("ui.Wormhole.081") : tr("ui.Wormhole.082")}</span>
                    )}
                  </div>
                )
              })}
              {/* **刚被拿走的堆**：留一张幽灵卡播"向下移出 + 淡出"（不吃点击、不参与判定，300ms 后自动摘掉） */}
              {leavingPiles.map((g) => {
                const def = ctx.items.get(g.itemId)
                return (
                  <div key={g.key} className="app-wh-pile is-leaving" aria-hidden>
                    <span className="app-wh-pile-name">{def?.name ?? g.itemId}</span>
                    <span className="app-wh-pile-count">×{n(g.units)}</span>
                    <span className="app-wh-pile-sub">{tr("ui.Wormhole.083")}</span>
                  </div>
                )
              })}
            </div>
          </>
        ) : (
          <div className="app-dim app-note">{PLACE_NOTE[hereCell.place]}</div>
        )}
      </>
    )
  }

  /**
   * **临时离开 = 活动停止**（船长 2026-09-13 批准 · 议案 A 第 2 条）：关掉面板就 `wormholeLeave()`
   * ⇒ 主控立刻释放（可以去做别的），**虫洞进度原样保存**、洞内一切冻结（含战斗）。
   * ⚠ **交火中不许离开**（船长 2026-09-13：「虫洞中的战斗画面不可以退出」）：按钮禁用，这里再兜一道。
   */
  function handleClose(): void {
    /** **自动探索模式**：本面板只是"准备页"，关掉它**不碰洞内那一趟**（不 leave、不切页签） */
    if (auto) {
      onClose()
      return
    }
    if (state.wormhole.run?.battle) {
      onToast(tr("ui.Wormhole.009"), true)
      return
    }
    /**
     * **临时空间没清空 ⇒ 先去背包页处理**（船长 2026-09-14：「离开背包页时丢弃并失效」＋
     * 「强制二选一：丢掉 或 放回」）：不直接关面板，而是**切到背包页并把确认条弹出来**。
     */
    if (state.wormhole.run && engine.wormholeTempPending().count > 0) {
      setTab('bag')
      setTempAsk('close')
      return
    }
    if (state.wormhole.run) engine.wormholeLeave()
    onClose()
  }

  // **返回虫洞**（打开面板即占住活动位）：要求主控空闲——忙着则留在"已离开"态并提示先收工（第 3 条）。
  const [resumeNote, setResumeNote] = useState<string | null>(null)
  useEffect(() => {
    /** 自动探索模式不改"在不在洞里"这件事（本面板不主张主控活动位） */
    if (auto) return
    if (!state.wormhole.run || state.wormhole.run.attending === true) return
    const r = engine.wormholeResume()
    if (!r.ok) setResumeNote(r.error ?? '暂时回不到虫洞。')
    else setResumeNote(null)
    // 只在"刚打开/刚离开"这两种时刻触发；`attending` 变 true 后本效果自动空转
  }, [engine, state.wormhole.run?.attending, auto])

  /**
   * **页签跟随"有没有在洞里"**：进洞 ⇒ 只能看「探索/背包」（准备页对编队已锁定）；
   * 出洞 ⇒ 回到准备页。这样关掉面板再打开也落在正确那一页（不会停在空白页或死掉的准备页）。
   * ⚠ 自动探索模式**恒在准备页**（本面板没有探索/背包两页）。
   */
  useEffect(() => {
    if (auto) return
    if (state.wormhole.run && tab === 'prep') setTab('map')
    else if (!state.wormhole.run && tab !== 'prep') setTab('prep')
  }, [state.wormhole.run, tab, auto])

  /**
   * **战斗中不渲染本面板**（船长 2026-09-13：「打捞遗迹触发战斗时，**虫洞界面处于最前端遮住了战斗**」）：
   * 全屏战场 `.app-battle-screen` 的层级低于弹层遮罩（100 vs 120）⇒ 只要面板还开着就**必然压住战斗**。
   * 这里直接在战斗中不渲染（`whOpen` 仍为真 ⇒ 战斗结束、收口完成后**面板自动回来**，玩家不用再点一次）。
   * ⚠ 这条是"几何层级的硬保证"，与"迎战前先确认再跳转"那道流程互为兜底。
   */
  if (!auto && run?.battle) return null

  return (
    <div className="app-modal-mask" onClick={handleClose}>
      <div className="app-modal app-wh-modal" onClick={(e) => e.stopPropagation()}>
        <div className="app-modal-head">
          <span className="app-report-title">{settle ? tr("ui.Wormhole.130") : tr("ui.Expedition.005")}</span>
          <span className="app-dim app-wh-devnote">
            {auto
              ? tr("ui.Wormhole.190", { WORMHOLE_AUTO_MAX_SHIPS: WORMHOLE_AUTO_MAX_SHIPS, p2: Math.round(WORMHOLE_AUTO_DURATION_MS / 60_000) })
              : settle
                ? settle.kind === 'extract'
                  ? tr("ui.Wormhole.191")
                  : tr("ui.Wormhole.192")
                : run
                  ? run.attending
                    ? tr("ui.Wormhole.010")
                    : tr("ui.Wormhole.084")
                  : tr("ui.Wormhole.011")}
          </span>
          {/**
           * **撤离按钮搬到「✕ 关闭」左侧，红色色系，两次讨伐确认**（船长 2026-09-13：
           * 「撤离按钮放在关闭左侧，并用红色色系，玩家撤离时会警告玩家并需要确认」）。
           * 与「存档管理 · 删除备份」同一套确认语言：**点一下进入待确认态**（按钮变文案 + 危险红），
           * 同时在页体顶部摆出确认条，**再点一下才真的撤**；5 秒不点自动解除，免得误触后一直挂着。
           * 战斗进行中一律禁用（见下）。
           * ⚠ 2026-09-15 撤离战取消：这一撤不再触发任何战斗（"交火中不能撤"照旧）。
           */}
          {!settle && run ? (
            <button
              className={`app-btn is-small is-danger app-wh-extract${extractAsk ? ' is-armed' : ''}`}
              disabled={!!run.battle || fxBusy}
              onClick={() => {
                if (!extractAsk) {
                  setExtractAsk(true)
                  return
                }
                setExtractAsk(false)
                doExtract()
              }}
              title={
                run.battle
                  ? tr("ui.Wormhole.012")
                  : extractAsk
                    ? tr("ui.Wormhole.013")
                    : tr("ui.Wormhole.131")
              }
            >
              {extractAsk ? tr("ui.Wormhole.193") : tr("ui.Handbook.163")}
            </button>
          ) : null}
          <button
            className="app-btn is-small"
            disabled={!!run?.battle}
            onClick={handleClose}
            title={run?.battle ? tr("ui.Wormhole.014") : undefined}
          >
            {tr("ui.Wormhole.015")}
          </button>
        </div>
        {/**
         * **探索 / 背包 = 显眼的分段大页签**（船长 2026-09-13：「探索和背包的切换按钮有些过于隐蔽」）：
         * 从标题行右侧那两颗 `is-small` 小按钮搬出来，放到标题行**正下方**、等宽两枚、带图标与读数；
         * 背包那枚顺带把**货仓占用**摆在脸上（超载转红）——省得玩家为了看格数专门切过去。
         * 进洞后「准备」是死按钮（编队已锁定）⇒ **直接不渲染**；没进洞时只有准备页 ⇒ 整条不渲染。
         */}
        {!settle && run ? (
          <div className="app-wh-tabbar">
            {(['map', 'bag'] as WhTab[]).map((k) => (
              <button
                key={k}
                className={`app-wh-tab${tab === k ? ' is-active' : ''}`}
                onClick={() => {
                  /**
                   * **切回探索 = 触发临时空间的丢弃确认**（船长 2026-09-14：
                   * 「直接将要丢弃的东西放进去后切换回探索界面触发丢弃（但是需要提醒玩家是否要丢弃物品
                   * 并列出丢弃的物品列表）」）：非空就先弹条，选完才真切过去。
                   */
                  if (k === 'bag') {
                    setTab('bag')
                    return
                  }
                  leaveBagPage('tab', () => setTab(k))
                }}
              >
                <span className="app-wh-tab-label">{TAB_LABEL[k]}</span>
                <span className="app-wh-tab-sub">
                  {k === 'map'
                    ? tr("ui.Wormhole.194", { p1: run.depth, p2: run.turnsLeft, p3: run.turnsTotal })
                    : tr("ui.Wormhole.195", { p1: holdInfo?.used ?? 0, p2: holdInfo?.capacity ?? 0 })}
                </span>
                {k === 'bag' && overloaded ? <span className="app-wh-tab-warn">{tr("ui.Wormhole.196")}</span> : null}
                {k === 'bag' && !overloaded && actionBlocked !== null ? (
                  <span className="app-wh-tab-warn">{tr("ui.Wormhole.085")}</span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}

        {/* `app-wh-body` = 让本面板的页体成为**纵向弹性容器**（船长 2026-09-13：
            「舰船选择界面高度可以适当缩减，让上一层的虫洞界面不要有滚动条」）——
            准备页把自己撑满页体、**卡网格吸收剩余高度并在内部滚动**，外层页体就不再出现滚动条。 */}
        <div className="app-modal-body app-wh-body">
          {/**
           * **本趟结算界面**（船长 2026-09-13：「玩家撤离后弹出一个结算界面，表示玩家的收益和损失。
           * 然后关闭虫洞界面」）：有结算单时**整页只显示它**（页签隐去），
           * 点「确认」= 清掉结算单 + **关闭虫洞面板**（`onClose`）。
           */}
          {settle ? (
            /**
             * **本趟结算界面**（船长 2026-09-13）：「玩家撤离后弹出一个结算界面，表示玩家的收益和损失。
             * 然后关闭虫洞界面」＋同日晚两条追加：「**结算界面尽量居中显示**」
             * 「**收获信息挨个弹出显示（需要动效）**」。
             *
             * 做法：整块**居中**（定宽 640，内容变化不跳动）；四格明细**依次弹出**（逐格 +90ms，
             * 下方 6px 淡入上移，纯 CSS `animation-delay`）；合计那一行等明细播完再淡入，
             * 数字走 `useCountUp` **跳数** 320ms。⚠ **「确认并返回」立刻可点**——不拿动画锁玩家。
             */
            <SettleView
              settle={settle}
              onConfirm={() => {
                engine.wormholeAckSettle()
                onClose() // 船长：结算完关掉虫洞界面
              }}
            />
          ) : null}
          {/* 回不到虫洞（主控在忙）：把拒因摆出来，别让玩家对着不能点的界面猜（议案 A 第 3 条） */}
          {!settle && resumeNote ? <div className="app-warn app-wh-gate">{resumeNote}</div> : null}
          {/* 本趟已结束（撤离成功 / 全损）⇒ 回到准备页并说明结果（否则"探索/背包"两页会是空白） */}
          {!settle && !run && tab !== 'prep' ? (
            <div className="app-dim app-inv-empty">
              {tr("ui.Wormhole.132")} {state.wormhole.lastFleetLost} {tr("ui.Wormhole.197")}
            </div>
          ) : null}
          {!settle && tab === 'prep' ? (
            <div className="app-wh-prep">
              <div className="app-bay-title">
                {auto
                  ? tr("ui.Wormhole.086", { WORMHOLE_AUTO_MAX_SHIPS: WORMHOLE_AUTO_MAX_SHIPS })
                  : tr("ui.Wormhole.087", { WORMHOLE_MAX_SHIPS: WORMHOLE_MAX_SHIPS })}
              </div>
              {/**
               * **敌情一行**（船长 2026-09-16：「给虫洞卡片添加更多信息（虫洞内是什么敌人，
               * 以什么类型伤害为主）」——准备页与扫描页**同批对齐**，两处共用 `ui/wormholeIntel`）。
               * 只有"这一处是哪一处"已知时才显示（从库存进来 ⇒ `stockId`/`autoStockId` 有值）；
               * 悬停给三档火力构成（⚠ 档间会变：D 族深层 6:4、E 族中层纯高爆）。
               */}
              {prepStock ? (
                <div className="app-dim app-note" title={wormholeIntelTip(engine, prepStock.family)}>
                  {wormholeIntelLine(engine, prepStock.family)}
                </div>
              ) : null}
              <div className="app-dim app-note">
                {auto ? (
                  <>
                    {tr("ui.Wormhole.002")}<b>{tr("ui.Wormhole.016")}</b>：派最多 {WORMHOLE_AUTO_MAX_SHIPS} 条船去一趟（可少派），
                    每条各占 <b>{tr("ui.Wormhole.017")}</b>{tr("ui.Wormhole.246")}{' '}
                    {Math.round(WORMHOLE_AUTO_DURATION_MS / 60_000)} {tr("ui.Wormhole.088")}{' '}
                    {Math.round(WORMHOLE_AUTO_YIELD_MUL * 100)}%（<b>{tr("ui.Wormhole.133")}</b>、不保底），结构/装甲各受损{' '}
                    {Math.round(WORMHOLE_AUTO_DAMAGE_MIN * 100)}%~{Math.round(WORMHOLE_AUTO_DAMAGE_MAX * 100)}%
                    但<b>{tr("ui.Wormhole.198")}</b>。<b>{tr("ui.Wormhole.018")}</b>{tr("ui.Wormhole.019")}
                  </>
                ) : (
                  <>
                    {tr("ui.Wormhole.089")}{' '}
                    {n(WORMHOLE_TOTAL_MASS_CAP)} {tr("ui.Wormhole.020")}{' '}
                    {n(WORMHOLE_SLOT_M3)} {tr("ui.Wormhole.021")}
                  </>
                )}
              </div>
              {/* **选舰卡片**（船长 2026-09-13：「虫洞入口选取舰船采用卡片形式，卡片内含有舰船名称、
                  舰船级别、折算质量、货仓、舰船 SVG 外形，且当编入时，卡片边框会变色」）——
                  结构/类名沿用装配页候选卡（`.app-fit-pick-item`）与舰队卡（`.app-inv-row.is-picked`）那一族：
                  整卡可点、选中态给边框+底色；舰影走统一资产 `ShipSprite`（细描边线稿，非 CSS 拼形）。
                  ⚠ `ShipSprite` **不要传 `name`**：它自带一个绝对定位的舰名标签（`.app-sprite-name`，
                  贴在舰影下缘），会压住卡片自己的舰名（2026-09-13 船长报「名称与 SVG 下方文本重叠」）。
                  检索控件（搜索 + 状态/类别/级别三行筛选）复刻「我的舰队」那套类名与口径。 */}
              <div className="app-bay-title app-wh-sub">{tr("ui.Wormhole.247")}</div>
              {/**
               * **检索区 + 进入按钮平级**（船长 2026-09-13：「进入虫洞的按钮放大（参考导航栏的出击），
               * 移动到搜索和筛选按钮相同容器内的最右侧」）：左边 = 搜索框 + 类别/级别两行筛选，
               * 右边 = 放大的「进入虫洞」主按钮（`.app-wh-enter`）+ 编队计数。 */}
              <div className="app-wh-prephead">
                <div className="app-wh-prephead-main">
                  <span className="app-head-search-wrap app-wh-search">
                    <input
                      className="app-head-search"
                      type="text"
                      placeholder={tr("ui.ShipPage.002")}
                      value={whQ}
                      onChange={(e) => setWhQ(e.target.value)}
                      spellCheck={false}
                    />
                    <span className="app-dim">
                      {whFiltered ? tr("ui.Wormhole.090", { p1: whShown.length, p2: whEntries.length }) : tr("ui.Wormhole.022", { p1: whEntries.length })}
                    </span>
                  </span>
                  <div className="app-fleet-toolbar app-wh-filters">
                <div className="app-fleet-row">
                  <span className="app-dim">{tr("ui.ShipPage.004")}</span>
                  <div className="app-task-tabs app-fleet-tabs" role="tablist">
                    <button
                      role="tab"
                      aria-selected={whRole === SUB_ALL}
                      className={`app-tasktab${whRole === SUB_ALL ? ' is-active' : ''}`}
                      onClick={() => setWhRole(SUB_ALL)}
                    >
                      {tr("ui.IndustryPage.001")}
                    </button>
                    {SHIP_SUBS.map((s) => (
                      <button
                        key={s.key}
                        role="tab"
                        aria-selected={whRole === s.key}
                        className={`app-tasktab${whRole === s.key ? ' is-active' : ''}`}
                        onClick={() => setWhRole(s.key)}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="app-fleet-row">
                  <span className="app-dim">{tr("ui.ShipPage.005")}</span>
                  <div className="app-task-tabs app-fleet-tabs" role="tablist">
                    <button
                      role="tab"
                      aria-selected={whTier === SUB_ALL}
                      className={`app-tasktab${whTier === SUB_ALL ? ' is-active' : ''}`}
                      onClick={() => setWhTier(SUB_ALL)}
                    >
                      {tr("ui.IndustryPage.001")}
                    </button>
                    {SHIP_TIER_SUBS.map((s) => (
                      <button
                        key={s.key}
                        role="tab"
                        aria-selected={whTier === s.key}
                        className={`app-tasktab${whTier === s.key ? ' is-active' : ''}`}
                        onClick={() => setWhTier(s.key)}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
                </div>
                {/* **进入虫洞（放大 · 检索区最右）**：主按钮档位与导航栏「出击」同款观感（`.app-wh-enter`）
                    —— 自动探索模式复用同一枚按钮位，只换文案与动作（船长 2026-09-14） */}
                <div className="app-wh-prephead-go">
                  <button
                    className="app-btn is-primary app-wh-enter"
                    disabled={auto ? picked.length === 0 || autoGate !== null : !admission.ok || !!run || entryGate !== null}
                    onClick={auto ? handleAutoStart : handleEnter}
                    title={
                      auto
                        ? (autoGate ?? (picked.length === 0 ? tr("ui.Wormhole.023") : undefined))
                        : (entryGate ??
                          (autoStopText ? tr("ui.Wormhole.248", { autoStopText: autoStopText }) : undefined))
                    }
                  >
                    {auto ? tr("ui.Wormhole.134") : tr("ui.Expedition.308")}
                  </button>
                  <span className="app-dim">
                    {auto
                      ? tr("ui.Wormhole.199", { p1: picked.length, WORMHOLE_AUTO_MAX_SHIPS: WORMHOLE_AUTO_MAX_SHIPS })
                      : tr("ui.Wormhole.200", { p1: picked.length, WORMHOLE_MAX_SHIPS: WORMHOLE_MAX_SHIPS })}
                  </span>
                </div>
              </div>
              <ul className="app-wh-cards">
                {whShown.map(({ uid, name, tier, ok, on, busy, armor, dur }) => {
                  const damaged = armor < 1 || dur < 1
                  const def = ctx.ships.get(state.fleet[uid]!.defId ?? uid)
                  const canPick = ok && !busy
                  const title = !ok
                    ? auto
                      ? (busy ?? '这条船不能编入自动探索队')
                      : tr("ui.Wormhole.201")
                    : auto
                      ? busy
                        ? busy
                        : uid === state.shipId
                          ? (autoHandover?.toName
                              ? tr("ui.Wormhole.202", { p1: autoHandover.toName })
                              : tr("ui.Wormhole.135"))
                          : on
                            ? tr("ui.Wormhole.024")
                            : tr("ui.Wormhole.136")
                      : busy
                        ? tr("ui.Wormhole.025", { busy: busy })
                        : on
                          ? tr("ui.Wormhole.024")
                          : tr("ui.Wormhole.137")
                  return (
                    <li key={uid}>
                      <button
                        type="button"
                        className={`app-wh-card${on ? ' is-picked' : ''}${canPick ? '' : ' is-locked'}`}
                        disabled={!canPick}
                        onClick={() => togglePick(uid)}
                        title={title}
                      >
                        <span className="app-wh-card-art" aria-hidden>
                          {/* ⚠ 不传 name（见上：会把舰名压在卡片文本上） */}
                          <ShipSprite shipId={state.fleet[uid]!.defId ?? uid} size={132} />
                        </span>
                        <span className="app-wh-card-name">{shipDisplayName(state, ctx, uid)}</span>
                        <span className="app-wh-card-sub">
                          {shipSizeLabel(tier)} · T{tier}
                          {busy ? <span className="app-chip is-dim"> {busy}</span> : null}
                        </span>
                        <span className="app-wh-card-sub">
                          {tr("ui.Handbook.159")} {def ? n(wormholeShipMass(def)) : '—'}{tr('ui.Wormhole.280')}{n(cargoCapacityM3Of(state, ctx, uid))} m³
                        </span>
                        <span className="app-wh-card-tags">
                          <span className={`app-wh-card-tag${on ? ' is-on' : ''}`}>
                            {on ? tr("ui.Wormhole.091") : !ok ? tr("ui.Wormhole.203") : busy ? tr("ui.Wormhole.092") : tr("ui.Wormhole.204")}
                          </span>
                          {/* **损伤提示标签**（船长 2026-09-13：「如果舰船有损伤，那么在编入的标签旁新增一个标签
                              提示玩家，防止不小心损坏的船带入虫洞」）：判据与舰队页「待维修」同一把尺
                              （`armorPct < 1 || durability < 1`；护盾不持久、不计损伤）。 */}
                          {damaged ? (
                            <span
                              className="app-wh-card-tag is-warn"
                              title={tr("ui.Wormhole.249", { p1: armor < 1 ? tr("ui.Wormhole.205", { p1: Math.round(armor * 100) }) : '', p2: armor < 1 && dur < 1 ? ' · ' : '', p3: dur < 1 ? tr("ui.Wormhole.206", { p1: Math.round(dur * 100) }) : '' })}
                            >
                              {tr("ui.Wormhole.093")}{armor < 1 ? ` 甲${Math.round(armor * 100)}%` : ''}
                              {dur < 1 ? ` 构${Math.round(dur * 100)}%` : ''}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>

              {/**
               * **读数条**（同一处位置、同一套样式，两种模式两套内容）：
               * - 手动 ⇒ 编队读数（货仓⇒背包格 / 折算总质量 / 回合预算 ＋ **打捞器 / 采集器 / 扫描范围**
               *   三项——船长 2026-09-19：「在虫洞的准备界面，三联读数处添加玩家所选舰船的打捞器数量和
               *   采集器数量以及扫描范围」）；
               * - 自动 ⇒ 自动探索读数（AI 核心占用 / 时长 / 收益 / 损伤）——船长 2026-09-14 选定。
               * ⚠ ⟪文案调整 2026-09-19⟫ 标题：原文案是「**三联读数**」（那时确实三项）；本批加三项后改成
               * 「**编队读数**」——六个读数再叫"三联"就与内容不符了（船长若要保留旧名，改这一处即可）。
               * ⚠ 旧名还出现在 `docs/glossary.md`（词条描述）与几份旧设计稿/测试档说明里：按 §八 工作期间
               * **不动旧文档** ⇒ 归档时随工作文档一并更正（已记进本批工作文档的「归档待办」）。
               */}
              <div className="app-bay-title app-wh-sub">{auto ? tr("ui.Wormhole.207") : tr("ui.Wormhole.026")}</div>
              {auto ? (
                <div className="app-wh-triad">
                  <span className="app-wh-cell">
                    {tr("ui.Wormhole.027")} <b>{picked.length}</b> {tr("ui.Wormhole.028")} <b>{autoCores?.free ?? 0}</b>{tr("ui.Wormhole.250")} {autoCores?.cap ?? 0}）
                  </span>
                  <span className="app-wh-cell">
                    {tr("ui.Wormhole.138")} <b>{Math.round(WORMHOLE_AUTO_DURATION_MS / 60_000)}</b> {tr("ui.DebugPanel.007")}
                  </span>
                  <span className="app-wh-cell">
                    {tr("ui.Wormhole.139")} <b>{Math.round(WORMHOLE_AUTO_YIELD_MUL * 100)}%</b>{tr("ui.Wormhole.251")}
                  </span>
                  <span
                    className="app-wh-cell"
                    title={
                      autoTechNeutral
                        ? tr('ui.Wormhole.286')
                        : tr('ui.Wormhole.287', {
                            p1: Math.round(autoTech.battleProgress * 100),
                            p2: autoTech.damage.toFixed(2),
                          })
                    }
                  >
                    {tr("ui.Wormhole.140")}{' '}
                    <b>
                      {Math.round(WORMHOLE_AUTO_DAMAGE_MIN * autoTech.damage * 100)}%~
                      {Math.round(WORMHOLE_AUTO_DAMAGE_MAX * autoTech.damage * 100)}%
                    </b>
                    {tr("ui.Wormhole.252")}
                  </span>
                  {/**
                   * **谜质科技那一格**（船长 2026-09-19 甲案「自动探索不折扣」）：只在真吃到科技时出现
                   * （未点科技 ⇒ 这一格不出现、损伤区间也一字不变）。系数由 `wormholeAutoTechFactors`
                   * 现算——**与结算同一个函数** ⇒ 读数就是返航时真正生效的那个数。
                   * 悬停给逐项细账（回合 / 货仓 / 两条效率 / 战斗线），口径见 core 的 `WormholeAutoTechFactors`。
                   */}
                  {!autoTechNeutral ? (
                    <span
                      className="app-wh-cell"
                      title={[
                        `回合：+${Math.round((autoTech.turnMul - 1) * 100)}%（时序锚定器 ÷ 本队基础 ${autoTech.baseTurns} 回合）`,
                        `货仓：+${Math.round((autoTech.holdMul - 1) * 100)}%（折叠货舱 ÷ 本队基础 ${autoTech.baseHold} 格）`,
                        `打捞效率：+${Math.round(autoTech.salvageEff * 100)}%（管残骸 / 稀有残骸 / 遗迹货柜 / AI 核心）`,
                        `采集效率：+${Math.round(autoTech.collectEff * 100)}%（管虚空母矿）`,
                        `战斗线完成度 ${Math.round(autoTech.battleProgress * 100)}%：损伤 ×${autoTech.damage.toFixed(2)}`,
                      ].join('\n')}
                    >
                      科技 残骸 <b>×{autoTech.wreck.toFixed(2)}</b> · 母矿 <b>×{autoTech.ore.toFixed(2)}</b>
                    </span>
                  ) : null}
                </div>
              ) : (
                <div className="app-wh-triad">
                  <span className="app-wh-cell">
                    {tr("ui.Wormhole.094")} <b>{n(cargoM3)}</b> {tr("ui.Wormhole.029")} <b>{bagSlots}</b> 格
                  </span>
                  <span className="app-wh-cell">
                    {tr("ui.Wormhole.141")} <b>{n(admission.totalMass)}</b> / {n(WORMHOLE_TOTAL_MASS_CAP)}
                  </span>
                  <span className="app-wh-cell">
                    {tr("ui.Wormhole.095")} <b>{admission.turnBudget}</b>
                  </span>
                  {/* 2026-09-19 船长追加的三项：所选编队的作业能力与开图能力（口径见上方注释）
                      ⚠ 悬停是**纯文本**渲染 ⇒ 不许写 `**` 这类强调记号（会被原样显示给玩家，
                      content:check 的「文案纯净契约」当场报红抓过本条一次，别再犯） */}
                  <span
                    className="app-wh-cell"
                    title={`所选编队的打捞器台数：墓场与遗迹每次打捞按台数回收若干堆；0 台 ⇒ 打捞格干不了活。打捞效率 ${Math.round(pickedSalvageEff * 100)}%：每满 100% 必多捞 1 堆，余数按概率（民用 0 / MK1 20% / MK2 40% / MK3 60% / 异星 80%，谜质科技「引力吊臂」每级 +20%）`}
                  >
                    {tr("ui.Wormhole.001")} <b>{pickedSalvagers}</b> {tr('ui.Wormhole.288')} <b>{Math.round(pickedSalvageEff * 100)}%</b>
                  </span>
                  <span
                    className="app-wh-cell"
                    title={`所选编队的采集器台数：矿脉每次采集按台数回收若干堆；0 台 ⇒ 一堆虚空母矿也挖不动。采集效率 ${Math.round(pickedCollectEff * 100)}%：每满 100% 必多采 1 堆，余数按概率（民用 0 / MK1 20% / MK2 40% / MK3 60% / 异星 80%，谜质科技「富集钻头」每级 +20%）`}
                  >
                    {tr("ui.Wormhole.238")} <b>{pickedMiners}</b> {tr('ui.Wormhole.288')} <b>{Math.round(pickedCollectEff * 100)}%</b>
                  </span>
                  <span
                    className="app-wh-cell"
                    title="本队入洞后的扫描范围：基础 1 圈 ＋ 编队里侦察舰/电子舰的加成（编入队伍即生效、可叠加）；洞内捞到的谜质装置「测绘仪」还能再 +圈"
                  >
                    扫描范围 <b>{pickedScanRadius}</b> 圈
                  </span>
                </div>
              )}
              {auto && autoMainPicked && autoHandover?.toName ? (
                <div className="app-warn app-wh-gate">
                  {tr("ui.Wormhole.253")}<b>{tr("ui.Wormhole.030")}{autoHandover.toName}」</b>{tr("ui.Wormhole.254")}
                </div>
              ) : null}
              {auto && autoGate !== null ? <div className="app-warn app-wh-gate">{autoGate}</div> : null}
              {!auto && !admission.ok ? (
                <div className="app-warn app-wh-gate">{WORMHOLE_ADMISSION_TEXT[admission.code]}</div>
              ) : null}
              {!auto && entryGate !== null ? <div className="app-warn app-wh-gate">{entryGate}</div> : null}
              {/**
               * **进洞会自动停掉哪些活动的预告**（船长 2026-09-14「进洞自动停止」＋「同样落实到采矿/打捞」）：
               * 只说清"会发生什么"，**不拦人**——这几项都是主控亲自在跑的作业，停法与手点活动栏「停止」完全一致
               * （扫描进度保留、作业中的货留在船上）。
               */}
              {!auto && autoStopText !== null ? (
                <div className="app-note app-dim">
                  {tr("ui.Wormhole.255")}<b>{autoStopText}</b>
                  {tr("ui.Wormhole.256")}
                </div>
              ) : null}
              {/**
               * **长途运输：发警告**（船长 2026-09-14）——它停掉**有可见后果**（本段航程中止、船被挪回出发站），
               * 所以摆成琥珀色警告条，而不是跟在上面那句轻描淡写的预告里。
               */}
              {autoStopWarns.map((a) => (
                <div key={a.kind} className="app-warn app-wh-gate">
                  {tr("ui.Wormhole.031")}{a.name}{tr("ui.Wormhole.032")}<b>{tr("ui.Wormhole.096")}</b>{tr("ui.Wormhole.257")}
                </div>
              ))}
              {/* 进入按钮已上移到检索区右侧（船长 2026-09-13），此处不再重复放一个 */}
            </div>
          ) : null}

          {!settle && tab === 'map' && run ? (
            <div className="app-wh-run">
              <div className="app-wh-head">
                <span className="app-wh-cell">第 <b>{run.depth}</b> 层</span>
                <span className="app-wh-cell">
                  {tr("ui.Wormhole.097")} <b>{grid ? grid.visited.length : 0}</b> / {grid ? grid.cells.length : 0} 格
                </span>
                <span className="app-wh-cell">
                  {tr("ui.Wormhole.098")} <b>{grid ? grid.scanned.length : 0}</b> 格
                </span>
                <span
                  className="app-wh-cell"
                  title={tr('ui.Wormhole.290', { p1: Math.round(runSalvageEff * 100) })}
                >
                  {tr("ui.Wormhole.001")} <b>{salvagers}</b> {tr('ui.Wormhole.288')} <b>{Math.round(runSalvageEff * 100)}%</b>
                </span>
                <span
                  className="app-wh-cell"
                  title={tr('ui.Wormhole.291', { p1: Math.round(runCollectEff * 100) })}
                >
                  {tr("ui.Wormhole.238")} <b>{miners}</b> {tr('ui.Wormhole.288')} <b>{Math.round(runCollectEff * 100)}%</b>
                </span>
                <span className="app-wh-cell">{tr("ui.Wormhole.078")} <b>{run.turnsLeft}</b> / {run.turnsTotal}</span>
                <span className="app-wh-cell">{tr("ui.CargoPage.004")} <b>{usage?.used ?? 0}</b> / {usage?.capacity ?? 0} 格</span>
                {/**
                 * **谜质增益读数**（F3c · 船长 2026-09-13）：悬停逐台列出装置 —— 效果一律从货仓现算
                 * （`wormholeMatterBuffs`），界面与 core 同源。
                 *
                 * ⚠ ⟪2026-09-19 补⟫ **科技那一份也要显形**（船长「检查是否有其他丢掉科技的情况」四处之一）：
                 * 这只袋子是"装置 + 科技"合流的，原先只在**带了装置**时出现、悬停也只列装置 ⇒ 光点科技、
                 * 一台装置不带时这一格整个不出现（科技等于没被玩家看见）。现在两条来源各列一段，
                 * 只要任一条非空就出现：装置 ⇒「谜质 N 台」，科技 ⇒「科技 M 级」（只列**洞内两条线**
                 * 的已点节点——洞外工业线不在此列，口径见上方 `techInRun`）。
                 */}
                {matterBuffs.devices > 0 || techInRun.length > 0 ? (
                  <span
                    className="app-wh-cell"
                    title={[
                      ...(matterBuffs.devices > 0
                        ? [
                            tr('ui.Wormhole.292'),
                            ...matterBuffs.list.map(
                              ({ device, count }) =>
                                `· ${device.name}${count > 1 ? ` ×${count}` : ''}：${device.text}`,
                            ),
                          ]
                        : []),
                      ...(techInRun.length > 0
                        ? [
                            tr('ui.Wormhole.293'),
                            ...techInRun.map(({ def, level }) => `· ${def.name} ${level}/${def.maxLevel} 级：${def.note}`),
                          ]
                        : []),
                    ].join('\n')}
                  >
                    {matterBuffs.devices > 0 ? (
                      <>
                        {tr("ui.Wormhole.208")} <b>{matterBuffs.devices}</b> {tr('ui.Wormhole.288')}
                      </>
                    ) : null}
                    {matterBuffs.devices > 0 && techInRun.length > 0 ? ' · ' : null}
                    {techInRun.length > 0 ? (
                      <>
                        {tr('ui.Wormhole.294')} <b>{techInRunLevels}</b> {tr('ui.Wormhole.295')}
                      </>
                    ) : null}
                  </span>
                ) : null}
                {/**
                 * **威胁读数走谜质压制后的值**（F3c B1）：压制力场压节点与守卫两档、守卫解析仪只压守卫；
                 * 各档**各自 −50% 封顶**（在 core 的派生里夹好）。
                 * ⚠ 2026-09-15 撤离战取消 ⇒ 原来的"撤离档"读数退役。
                 */}
                <span className="app-wh-cell" title={matterThreatTip}>
                  {tr("ui.Wormhole.142")} <b>{wormholeDisplayThreat(nodeThreat)}</b>
                </span>
              </div>
              {grid && hereCell ? (
                <>
                  {/**
                   * **撤离确认条**（船长 2026-09-13：「玩家撤离时会警告玩家并需要确认」）：
                   * 待确认时摆在页体顶部，写清"这一撤会发生什么"。
                   * ⚠ 2026-09-15 撤离战取消 ⇒ 文案改为"不消耗回合、不触发战斗"，不再分第 1 层 / 深层两档。
                   */}
                  {extractAsk ? (
                    <div className="app-wh-extract-ask">
                      <span>
                        {tr("ui.Wormhole.033")} <b>第 {run.depth} 层</b>
                        ：撤离不消耗回合、不会触发战斗，货仓、货柜与随行战利品<b>{tr("ui.Wormhole.143")}</b>{tr("ui.Wormhole.258")}
                      </span>
                      <span className="app-wh-actions">
                        <button
                          className="app-btn is-small is-danger"
                          onClick={() => {
                            setExtractAsk(false)
                            doExtract()
                          }}
                        >
                          {tr("ui.Wormhole.193")}
                        </button>
                        <button className="app-btn is-small" onClick={() => setExtractAsk(false)}>
                          {tr("ui.ActivityBar.004")}
                        </button>
                      </span>
                    </div>
                  ) : null}
                  {/**
                   * **遗迹守备的迎战确认条**（船长 2026-09-13：「打捞遗迹触发战斗时……战斗突然发生没有任何提示，
                   * 应该提示玩家惊扰守卫等，**玩家确认后跳转**」）：
                   * 打捞已经结算（回合扣了、货进包了），这里只等玩家点「迎战」；点之前别的动作一律被 core 拦。
                   * ⚠ **2026-09-14 修船长报障「虫洞的战斗胜利后，点击战报有时会退出虫洞界面」**：
                   *   这里原先跟着一句 `onClose()`（"关掉面板，全屏战场接管"）——与上面那条
                   *   「**战斗中不渲染本面板、`whOpen` 保持为真 ⇒ 打完面板自动回来**」的既有设计**直接冲突**：
                   *   面板一旦关掉就再也回不来 ⇒ 打完战报一关，人落在星图上（= 退出了虫洞界面）。
                   *   "有时"正是因为**只有这一条路**关面板：另外两条开战路径（`doActivate` 的舰船信号 /
                   *   层末守卫）不关 ⇒ 那两条打完都能回到面板。
                   *   现改为**不关面板**：战斗中本组件 `return null`（层级硬保证，见文件末那条注释），
                   *   战斗收口后自动回来，与另两条路径一致。
                   */}
                  {run.pendingRuinsBattle === true ? (
                    <div className="app-wh-extract-ask">
                      <span>
                        ⚠ <b>{tr("ui.Wormhole.099")}</b>：深处传来交火前的机械声——这一场躲不掉，打完才能继续探索。
                      </span>
                      <span className="app-wh-actions">
                        <button
                          className="app-btn is-small is-danger"
                          onClick={() => {
                            const r = engine.wormholeFight('ruins')
                            if (!r.ok) {
                              onToast(r.error ?? '无法开战。', true)
                              return
                            }
                            // 面板**保持打开**（战斗中自动不渲染）⇒ 战报一关就回到虫洞界面
                          }}
                        >
                          {tr("ui.App.080")}
                        </button>
                      </span>
                    </div>
                  ) : null}
                  {/**
                   * **踩中埋伏**（船长 2026-09-16：「移动途中被敌方拦截或者**进入未扫描地点踩到怪**了，
                   * 都要弹窗提示，玩家确认后进入战斗」）——与上面「遗迹守备」**同一套语言与形态**：
                   * 到达那一刻已发事件提醒（日志 + 这条警告条），**玩家点「开战」才进战斗**；
                   * 提醒里只写来由与坐标（船长选定：不写残血/回合）。
                   */}
                  {run.pendingNodeBattle === true ? (
                    <div className="app-wh-extract-ask">
                      <span>
                        ⚠ <b>{tr("ui.Handbook.308")}</b>：这个地点（Q{grid?.pos.q ?? 0} · R{grid?.pos.r ?? 0}）出发前
                        没有扫描过，里面是敌人——对方已经发现我们，打完才能继续探索。
                      </span>
                      <span className="app-wh-actions">
                        <button
                          className="app-btn is-small is-danger"
                          onClick={() => {
                            const r = engine.wormholeFight('node')
                            if (!r.ok) {
                              onToast(r.error ?? '无法开战。', true)
                              return
                            }
                          }}
                        >
                          {tr("ui.Wormhole.100")}
                        </button>
                      </span>
                    </div>
                  ) : null}
                  {/**
                   * **地图行 = 左侧缩放控件 + 地图**（船长 2026-09-13：「虫洞探索地图添加一个宇宙背景。
                   * 且窗口高度固定（不会随着地图变大变高），在探索界面的左侧给玩家一个缩放按钮或者滚动条。
                   * 让玩家能够调节探索地图的大小」）：地图框**定高** 300px（不再随圈数长高），
                   * 缩放只放大图内内容（以玩家所在格为中心），超出部分由地图框裁掉 ⇒ 外层永不因此滚动。
                   */}
                  <div className="app-wh-maprow">
                    <div className="app-wh-zoom" role="group" aria-label="地图缩放">
                      <button
                        className="app-wh-zoom-btn"
                        disabled={mapZoom >= WORMHOLE_MAP_ZOOM_MAX}
                        onClick={() => setMapZoom((z) => Math.min(WORMHOLE_MAP_ZOOM_MAX, +(z + WORMHOLE_MAP_ZOOM_STEP).toFixed(2)))}
                        title={tr("ui.Wormhole.144")}
                      >
                        ＋
                      </button>
                      <span className="app-wh-zoom-val">{Math.round(mapZoom * 100)}%</span>
                      <button
                        className="app-wh-zoom-btn"
                        disabled={mapZoom <= WORMHOLE_MAP_ZOOM_FIT}
                        onClick={() => setMapZoom((z) => Math.max(WORMHOLE_MAP_ZOOM_FIT, +(z - WORMHOLE_MAP_ZOOM_STEP).toFixed(2)))}
                        title={tr("ui.Wormhole.209")}
                      >
                        －
                      </button>
                      <button
                        className="app-wh-zoom-btn is-text"
                        disabled={mapZoom === WORMHOLE_MAP_ZOOM_FIT}
                        onClick={() => setMapZoom(WORMHOLE_MAP_ZOOM_FIT)}
                        title={tr("ui.Wormhole.101")}
                      >
                        {tr("ui.Wormhole.259")}
                      </button>
                    </div>
                    <div
        className="app-wh-mapbox"
        ref={mapBoxRef}
        style={{ ...(pinnedSpaceBg ? { '--wh-space-bg': `url("${pinnedSpaceBg}")` } : {}) } as React.CSSProperties}
      >
                      {/**
                       * ⚠ **这里不许写 `title`**（**2026-09-17 船长报障**：「鼠标在地点上悬停时，会同时出现
                       * **滚轮缩放的 title 提示**和格子信息，建议取消滚轮缩放的 title」）。
                       * 机制：格子上的提示走 **SVG 的 `data-tip`**（由 `ui/Tooltip.tsx` 的自绘层接管），
                       * 而**悬停元素自己没有 `title` 时，浏览器会沿祖先链找最近的 `title` 并照原生弹出**
                       * ⇒ 地图框这一层的 `title` 会和格子提示**同屏出现**（自绘 + 原生两个）。
                       * 滚轮那句话已搬进下方图例行的 ⓘ（常驻说明进 ⓘ 的既有口径），此处保持**无 title**。
                       */}
                      <WhGridMap
                        grid={grid}
                        onPickCell={pickCell}
                        shipDefId={leadShipDefId}
                        layerKey={`${run.seed ?? 0}-${run.depth}`}
                        fx={fx}
                        scanFx={scanFx}
                        dissolveFx={dissolveFx}
                        zoom={mapZoom}
                        /* 待确认的这次移动：画出直线路径；已知的拦截格才描红指名（甲案） */
                        pathPreview={
                          pendingCell
                            ? {
                                q: pendingCell.q,
                                r: pendingCell.r,
                                ...(pendingCell.intercept && pendingCell.intercept.known
                                  ? { interceptKey: `${pendingCell.intercept.q},${pendingCell.intercept.r}` }
                                  : {}),
                                ...(pendingCell.intercept && !pendingCell.intercept.known
                                  ? { hush: true }
                                  : {}),
                              }
                            : null
                        }
                      />
                    </div>
                  </div>
                  <div className="app-wh-legend">
                    {GRID_LEGEND.map((l) => (
                      <span key={l.key} className="app-wh-legend-item">
                        <svg
                          className={`app-wh-legend-glyph is-${
                            l.nebula === true ? 'nebula' : l.done === true ? 'visited' : l.none ? 'unknown' : (l.signal ?? 'blank')
                          }`}
                          viewBox="-13 -13 26 26"
                          aria-hidden="true"
                        >
                          {l.nebula === true ? (
                            <WhNebulaGlyph />
                          ) : l.none ? (
                            <polygon points="0,-12 10.39,-6 10.39,6 0,12 -10.39,6 -10.39,-6" />
                          ) : (
                            <WhGlyph signal={l.signal} />
                          )}
                          {/* 「去过」那一档把右上角小点也画上（与地图上的标记同源） */}
                          {l.done === true ? <circle className="app-wh-hex-done" cx={6.5} cy={-6.5} r={2.2} /> : null}
                        </svg>
                        {l.text}
                      </span>
                    ))}
                    {/**
                     * **地图操作说明进 ⓘ**（2026-09-17 船长：「取消滚轮缩放的 title」）——原句从地图框的
                     * `title` 一字不改搬到这里：那处 `title` 会在"悬停格子上"时被浏览器当**祖先原生提示**
                     * 弹出来，与格子自己的 `data-tip` 自绘提示同屏（一个屏幕两个提示）。图例行是地图的
                     * 常驻说明位（与"常驻说明进 ⓘ、状态读数留眼前"同款口径），搬来即不再打架。
                     */}
                    <HintIcon tip={tr("ui.Wormhole.145")} />
                  </div>
                  {pendingCell ? (
                    <div className="app-wh-ask">
                      <span>
                        {pendingCell.intercept ? (
                          pendingCell.intercept.known ? (
                            <>
                              {tr("ui.Wormhole.210")}<b>{tr("ui.Wormhole.146")}</b>（Q{pendingCell.intercept.q} · R{pendingCell.intercept.r}）：
                              直接前往会在中途被拦下并<b>{tr("ui.Wormhole.100")}</b>{tr("ui.Wormhole.034")}
                            </>
                          ) : (
                            <>
                              {tr("ui.Wormhole.211")}<b>{tr("ui.Wormhole.102")}</b>：直接前往会在中途被拦下并<b>{tr("ui.Wormhole.100")}</b>——
                              拦路的是什么、会不会撞上交火，现在都还不知道。
                            </>
                          )
                        ) : (
                          <>
                            {tr("ui.Wormhole.103")}<b>{tr("ui.Wormhole.147")}</b>{tr("ui.Wormhole.148")}{pendingCell.q} · R{pendingCell.r}）：那里是什么、
                            会不会撞上交火，现在都还不知道。
                          </>
                        )}
                        {pendingCell.intercept && pendingCell.unknown ? (
                          <>
                            <br />
                            {tr("ui.Wormhole.104")}{pendingCell.q} · R{pendingCell.r}）<b>{tr("ui.Wormhole.260")}</b>。
                          </>
                        ) : null}
                      </span>
                      <span className="app-wh-actions">
                        <button
                          className="app-btn is-small is-warn"
                          disabled={!!run.battle || run.turnsLeft < 1}
                          onClick={() => travelTo(pendingCell.q, pendingCell.r, true, !!pendingCell.intercept)}
                        >
                          {tr("ui.Wormhole.212")}
                        </button>
                        <button className="app-btn is-small" onClick={() => setPendingCell(null)}>
                          {tr("ui.ActivityBar.004")}
                        </button>
                      </span>
                    </div>
                  ) : null}
                  {/**
                   * **左列 = 扫描 + 作业按钮 + 继续深入**（船长 2026-09-13：「激活等按钮可以放在扫描下方」
                   * ＋「**继续深入按钮也可以整合到扫描 + 作业按钮处**」）：三枚同宽、纵向排列；
                   * 右边是地点信息窗（其列表已改**卡片 + 内部滚动**，见 `renderHereNode`）。
                   * 作业按钮**只在真能用的时候才出现**（船长：「有可以采集或者激活的情况时，才显示对应按钮」）；
                   * 「继续深入」只在守卫清掉后出现。「撤离」已搬到标题行（红色 · 两讨伐确认）。
                   */}
                  <div className="app-wh-workspace">
                    <div className="app-wh-workspace-left">
                      <button
                        className="app-btn is-primary app-wh-scan-big"
                        disabled={!!run.battle || actionBlocked !== null || run.turnsLeft < 1 || fxBusy}
                        onClick={doScan}
                        title={tr("ui.Wormhole.105")}
                      >
                        {tr("ui.Wormhole.106")}
                        <span className="app-wh-scan-sub">{tr("ui.Wormhole.035")}</span>
                      </button>
                      {workCell && canWork ? (
                        <button
                          className="app-btn is-primary app-wh-work"
                          disabled={!!run.battle || actionBlocked !== null || run.turnsLeft < 1 || fxBusy}
                          onClick={doActivate}
                          title={workTitle}
                        >
                          {veinCell ? tr("ui.Wormhole.261") : tr("ui.Wormhole.107")}
                          <span className="app-wh-scan-sub">
                            {tr("ui.Wormhole.036")} {Math.min(Math.max(rigs, 0), herePiles.length)} 堆
                          </span>
                        </button>
                      ) : null}
                      {!workCell && canActivate ? (
                        <button
                          className="app-btn is-primary app-wh-work"
                          disabled={!!run.battle || actionBlocked !== null || fxBusy}
                          onClick={doActivate}
                          title={
                            atExit
                              ? tr("ui.Wormhole.149")
                              : tr("ui.Wormhole.150")
                          }
                        >
                          {atExit ? tr("ui.Wormhole.262") : tr("ui.Wormhole.151")}
                          <span className="app-wh-scan-sub">{tr("ui.Wormhole.037")}</span>
                        </button>
                      ) : null}
                      {/*
                        * 「继续深入」**只在站在下一层入口且守卫已清时出现**（船长 2026-09-18：「虫洞前往下一层
                        * 修改为必须在下一层入口才可以前往」）——与"作业按钮只在真能用的时候才出现"同一套做法；
                        * 核心侧 `wormholeDescend` 有同款判据（不只是界面收口）。
                        */}
                      {bossDone && atExit ? (
                        <button
                          className="app-btn is-primary app-wh-work"
                          disabled={!!run.battle || actionBlocked !== null || run.turnsLeft <= 0 || fxBusy}
                          onClick={doDescend}
                          title={tr("ui.Wormhole.108")}
                        >
                          {tr("ui.Wormhole.213")}
                          <span className="app-wh-scan-sub">
                            第 {run.depth + 1} {tr("ui.Wormhole.109")} {wormholeDisplayThreat(wormholeLayerThreat(run.depth + 1))}
                          </span>
                        </button>
                      ) : null}
                    </div>
                    <div className="app-wh-node">{renderHereNode()}</div>
                  </div>
                  <div className="app-wh-actions">
                    <span className="app-dim">{tr("ui.Wormhole.152")}</span>
                  </div>
                  {/**
                   * 撤离进行中的一行读数：`extracting` 只是"已发起撤离、下一拍结算"（2026-09-15 起
                   * 撤离不再触发战斗）⇒ 原来的「拦截舰队正在围堵你」警示条退场。
                   */}
                  {run.phase === 'extracting' && !run.battle ? (
                    <div className="app-wh-ask">{tr("ui.Wormhole.153")}</div>
                  ) : null}
                  {/**
                   * **动作闸提示**（船长 2026-09-14：「临时空间内有物品就不允许进行其他操作，
                   * 和之前的超载类似」）：两条理由共用这一条警示条 —— 临时空间待处理 / 货仓超载。
                   */}
                  {actionBlocked !== null ? (
                    <div className="app-wh-hold-overload">
                      <span>{actionBlocked}</span>
                      <button className="app-btn is-small" onClick={() => setTab('bag')}>
                        {tr("ui.Wormhole.110")}
                      </button>
                    </div>
                  ) : null}
                  {(run.relics ?? []).length > 0 ? (
                    <div className="app-dim app-note">
                      {tr("ui.Wormhole.263")}
                      {(run.relics ?? [])
                        .map(
                          (id) =>
                            ctx.modules.get(id)?.name ??
                            ctx.blueprints.get(id)?.name ??
                            ctx.shipBlueprints.get(id)?.name ??
                            id,
                        )
                        .join(tr("ui.MatterTechTab.017"))}
                    </div>
                  ) : null}
                  {bossDone ? (
                    <div className="app-dim app-note">
                      {tr("ui.Wormhole.154")}
                    </div>
                  ) : null}
                  {outOfTurns ? (
                    <div className="app-wh-ask">{tr("ui.Wormhole.111")}</div>
                  ) : null}
                </>
              ) : (
                <div className="app-wh-node">
                  <div className="app-wh-node-title">{tr("ui.Wormhole.155")}</div>
                  <div className="app-dim app-note">
                    {tr("ui.Wormhole.264")}
                  </div>
                  <div className="app-wh-actions">
                    <button
                      className="app-btn is-small"
                      disabled={!!run.battle || actionBlocked !== null}
                      onClick={doExtract}
                    >
                      {tr("ui.Handbook.163")}
                    </button>
                    <button
                      className="app-btn is-small is-primary"
                      disabled={!!run.battle || run.turnsLeft <= 0 || !bossDone}
                      onClick={doDescend}
                    >
                      {tr("ui.Wormhole.213")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {!settle && tab === 'bag' && run ? (
            <WhHold
        engine={engine}
        onToast={onToast}
        tempAsk={tempAsk}
        setTempAsk={setTempAsk}
        onTempDiscard={tempDiscardAndContinue}
        onTempStow={tempStowAndContinue}
      />
          ) : null}
        </div>
      </div>
      {/**
       * **主控交接确认**（船长 2026-09-14：「如果选择了主控船，就将主控换到其他船上」＋
       * 选定「自动挑一条，弹窗写明是谁」）：队里有主控 ⇒ 点「派队自动探索」先弹这一层，
       * 写明**主控从谁换到谁**；确认后才真的派（换船在 core 里走 `changeShip`）。
       */}
      {mainAsk && auto ? (
        <div className="app-modal-mask" onClick={() => setMainAsk(false)}>
          <div className="app-modal" onClick={(e) => e.stopPropagation()}>
            <div className="app-modal-head">
              <span className="app-report-title">{tr("ui.Wormhole.112")}{autoHandover?.toName ?? tr("ui.Wormhole.113")}{tr("ui.Wormhole.038")}</span>
              <button className="app-btn is-small" onClick={() => setMainAsk(false)}>
                {tr("ui.App.086")}
              </button>
            </div>
            <div className="app-modal-body">
              <div className="app-dim">
                {tr("ui.Wormhole.265")}{shipDisplayName(state, ctx, state.shipId)}{tr("ui.Wormhole.039")}<b>{tr("ui.Wormhole.040")}
                {autoHandover?.toName ?? tr("ui.Wormhole.114")}」</b>，它随自动探索队出发（约{' '}
                {Math.round(WORMHOLE_AUTO_DURATION_MS / 60_000)} {tr("ui.Wormhole.115")}{' '}
                {Math.round(WORMHOLE_AUTO_YIELD_MUL * 100)}% 直入仓库；结构/装甲受损但绝不丢船）。
              </div>
              {autoGate !== null ? <div className="app-warn app-wh-gate">{autoGate}</div> : null}
              <div className="app-wh-scanbar-actions" style={{ marginTop: 10 }}>
                <button className="app-btn is-primary is-small" onClick={startAuto} disabled={autoGate !== null}>
                  {tr("ui.Wormhole.214")}
                </button>
                <button className="app-btn is-small" onClick={() => setMainAsk(false)}>
                  {tr("ui.Wormhole.041")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * **本趟结算单**（船长 2026-09-13：「结算界面表示玩家的收益和损失」＋ 同日晚两条追加
 * 「**结算界面尽量居中显示**」「**收获信息挨个弹出显示（需要动效）**」）。
 *
 * 版式：整块**居中**、定宽 640（内容变化不跳动）；收获格**依次弹出**（+90ms/格，纯 CSS
 * `animation-delay`），合计等明细播完再淡入，数字用 `useCountUp` **跳数**（320ms 缓出）；
 * ⚠ 「确认并返回」**立刻可点**，不拿动画锁玩家。
 *
 * 2026-09-14 船长增补第 5 格「AI 核心 N 枚」（遗迹打捞掉落）：**只在真捞到时才出**、
 * 并**跨两列独占一行**（4 格是偶数，第 5 格落单会难看）；它是唯一不进「到手合计」的一格。
 */
/** 核心账本键 → 短名（结算单里那行小字用；全称见 core 的 `aiCoreName`） */
const CORE_LABEL: Readonly<Record<'gamma' | 'beta' | 'alpha', string>> = { gamma: tr("ui.Wormhole.042"), beta: tr("ui.Wormhole.215"), alpha: tr("ui.Wormhole.266") }

function SettleView({ settle, onConfirm }: { settle: WormholeSettleRecord; onConfirm: () => void }) {
  const total = useCountUp(settle.oreIsk + settle.wreckIsk)
  const cells: Array<{ label: string; value: string; sub: string; wide?: boolean }> = [
    { label: tr("ui.Wormhole.187"), value: n(settle.oreUnits), sub: tr("ui.Wormhole.116", { p1: n(settle.oreIsk) }) },
    { label: tr("ui.Wormhole.156"), value: n(settle.wreckIsk), sub: tr("ui.FirstTasks.003") },
    { label: tr("ui.MarketPage.006"), value: String(settle.boxes.length), sub: tr("ui.Wormhole.043") },
    { label: tr("ui.Wormhole.267"), value: String(settle.relics.length), sub: tr("ui.Wormhole.044") },
    /**
     * **AI 核心**（2026-09-14 船长：「结算单另加一格「AI 核心 N 枚」」＋「附按行价约 N 信用点」）。
     * 只在真捞到时才出这一格；`wide` = 跨两列独占一行（4 格是偶数、第 5 格落单会难看）。
     * ⚠ 它是**唯一不进「到手合计」**的一格：核心直接进核心账本、不拆解，故单独给行价参考。
     */
    ...(settle.cores && Object.keys(settle.cores).length > 0
      ? [
          {
            label: tr("ui.Wormhole.027"),
            value: String((settle.cores.gamma ?? 0) + (settle.cores.beta ?? 0) + (settle.cores.alpha ?? 0)),
            sub:
              '枚（' +
              (['alpha', 'beta', 'gamma'] as const)
                .filter((t) => (settle.cores?.[t] ?? 0) > 0)
                .map((t) => `${CORE_LABEL[t]}×${settle.cores?.[t]}`)
                .join(' · ') +
              (settle.coresIsk && settle.coresIsk > 0 ? ` ⇒ 按行价约 ${n(settle.coresIsk)} 信用点` : '') +
              '）',
            wide: true,
          },
        ]
      : []),
    /**
     * **虫洞谜质**（2026-09-15 船长定：「谜质在虫洞结束时不再删除，而是转化成虫洞谜质存入仓库」）。
     * 同 AI 核心一样**只在真析出时才出**、跨两列独占一行、**不进「到手合计」**（只收不卖，
     * 出手要玩家自己去市场卖）⇒ 单独给行价参考。
     */
    ...(settle.essences && settle.essences > 0
      ? [
          {
            label: tr("ui.MatterTechTab.005"),
            value: n(settle.essences),
            sub:
              '枚（谜质装置析出 · 可投入「谜质科技」研究）' +
              (settle.essenceIsk && settle.essenceIsk > 0 ? ` ⇒ 按行价约 ${n(settle.essenceIsk)} 信用点` : ''),
            wide: true,
          },
        ]
      : []),
  ]
  const STEP = 90
  return (
    <div className="app-wh-settle">
      <div className="app-wh-settle-head is-pop">
        <span className={`app-wh-settle-kind${settle.kind === 'extract' ? ' is-good' : ' is-bad'}`}>
          {settle.kind === 'extract' ? tr("ui.Wormhole.157") : tr("ui.Wormhole.158")}
        </span>
        <span className="app-dim">
          第 {settle.depth} {tr("ui.Wormhole.117")}{' '}
          {settle.kind === 'lost'
            ? tr("ui.Wormhole.216")
            : settle.skippedExtractBattle === true
              ? // 老档的结算单会带这个标记（旧口径「第 1 层免撤离战」）——照旧读得懂
                tr("ui.Wormhole.217")
              : // 现行口径（2026-09-15 起）：撤离一律不触发战斗，老档里打赢过撤离战的也归到这一句
                tr("ui.Wormhole.118")}
        </span>
      </div>
      <div className="app-wh-settle-grid">
        {cells.map((c, i) => (
          <div
            key={c.label}
            className={`app-wh-settle-cell is-pop${c.wide ? ' is-wide' : ''}`}
            style={{ animationDelay: `${(i + 1) * STEP}ms` }}
          >
            <span className="app-dim">{c.label}</span>
            <b>{c.value}</b>
            <span className="app-dim">{c.sub}</span>
          </div>
        ))}
      </div>
      <div className="app-wh-settle-total is-pop" style={{ animationDelay: `${(cells.length + 1) * STEP}ms` }}>
        {tr("ui.Wormhole.159")} <b>{n(total)}</b> {tr("ui.FirstTasks.003")}
        {settle.boxes.length > 0 ? ` · 货柜 ${settle.boxes.length} 件` : ''}
      </div>
      {settle.shipsLost.length > 0 ? (
        <div className="app-wh-settle-loss is-pop" style={{ animationDelay: `${(cells.length + 2) * STEP}ms` }}>
          {tr("ui.Wormhole.160")}{settle.shipsLost.join(tr("ui.MatterTechTab.017"))}{tr("ui.Wormhole.268")} {settle.shipsLost.length} {tr("ui.Wormhole.218")}
        </div>
      ) : null}
      {settle.lostIsk > 0 ? (
        <div className="app-wh-settle-loss is-pop" style={{ animationDelay: `${(cells.length + 3) * STEP}ms` }}>
          {tr("ui.Wormhole.161")} {n(settle.lostIsk)} {tr("ui.Wormhole.045")}
        </div>
      ) : null}
      <div className="app-wh-actions app-wh-settle-actions">
        <button className="app-btn is-primary app-wh-settle-ok" onClick={onConfirm}>
          {tr("ui.Wormhole.219")}
        </button>
      </div>
    </div>
  )
}

/**
 * **层内网格地图**（F3a-2 · 船长 2026-09-13：「探索采用网格地图的形式。整体网格地图呈现圆型」）。
 *
 * 画法：尖顶六边形（pointy-top）铺成半径为 `grid.radius` 的**圆盘**；一格 = 一个地点。
 * 三档揭示（`revealOf` 同源）：
 * - **未扫描** = **蓝灰虚线边框**的空hex（船长 F5：「目前未扫描的地点可以通过边框颜色判断」），
 *   点了先弹「前往未知地点」的警告；**未扫描的格不按信号上色**（否则边框颜色就把真相漏了）；
 * - **已扫描** = 只给信号符号（残骸/舰船/资源/雷达；**空信息地点给一个小圆点**）；
 * - **已到达** = 真相（地点名看下方卡片；入口格额外画箭头）。
 *
 * 玩家所在格（船长 2026-09-13 两改）：
 * - **用编队第一艘船的舰影表示**（`ShipSpriteShape`：与舰船资产同源的 SVG 线稿，不再用虚线圈）；
 * - **进入本层淡入**（`is-enter` 动画）、**移动时平移过去**（CSS transform 过渡）——船长：
 *   「玩家的图标用一个淡入的过程表示玩家的进入过程」「移动时候同样需要一个动画表示玩家的移动过程」。
 *
 * ⚠ 视觉纪律：图形一律 SVG 线稿（约定 §九），不用 CSS 拼形状；颜色只给信号类别分色。
 */
function WhGridMap({
  grid,
  onPickCell,
  shipDefId,
  layerKey,
  fx = 'idle',
  scanFx = null,
  dissolveFx = null,
  zoom = 1,
  pathPreview = null,
}: {
  grid: WormholeGridState
  onPickCell: (q: number, r: number) => void
  /** 编队第一艘船的 defId（画玩家舰影用；取不到就退化成一个小箭头） */
  shipDefId?: string
  /** 层标识（换了它 = 换了新盘 ⇒ 舰影重挂动画、重新飞入） */
  layerKey: string
  /** 舰影动效相位：`in` 从地图外飞入 · `out` 往地图外飞走 · `idle` 静止 */
  fx?: 'idle' | 'out' | 'in'
  /** 扫描动画：这一批新揭开的格 + 扫了几圈（波散开、格子按圈依次亮） */
  scanFx?: { keys: string[]; rings: number; nonce: number } | null
  /** **星云消散动画**：这一批刚被驱散的格（云团外扩淡出；船长 2026-09-13 追加） */
  dissolveFx?: { keys: string[]; nonce: number } | null
  /** 缩放（1 = 适应窗口）：**以玩家所在格为中心**放大，超出地图框的部分被裁掉 */
  zoom?: number
  /**
   * **路径预览**（船长 2026-09-16 路径拦截）：待确认的这次移动 —— 画出"当前格 → 目标格"的直线，
   * 并在**已知**的拦截格上加红框。`hush = true`（拦截格未扫描）⇒ **不指名**：只把路径线置警示色
   * （§5.2 甲案：不泄漏未扫描格的内容）。
   */
  pathPreview?: { q: number; r: number; interceptKey?: string; hush?: boolean } | null
}) {
  const size = 30
  const R = Math.max(1, Math.floor(grid.radius))
  /**
   * 画布留白按半径算（六边形顶点正好落在边界上会显得挤）。
   * ⚠ **容器高度不再随圈数长高**（船长 2026-09-13：「窗口高度固定（不会随着地图变大变高）」）：
   * 高度交给 CSS（`.app-wh-mapbox` 定高 300px），这里只出 viewBox —— 圈数越大，
   * 整张圆盘在同一个框里等比缩得越小；要看清就点左侧的 **＋/－ 缩放**（以玩家所在格为中心放大）。
   */
  const w = Math.sqrt(3) * size * (2 * R + 1.3)
  const h = size * (3 * R + 2.4)
  const cx = w / 2
  const cy = h / 2
  // 六边形顶点（尖顶：上下各一个顶点、左右是平边）
  const corners = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 30)
    return { dx: Math.cos(a) * size, dy: Math.sin(a) * size }
  })
  const hereKey = `${grid.pos.q},${grid.pos.r}`
  const exitKey = `${grid.exit.q},${grid.exit.r}`
  /** 玩家舰影的落点（与格子同一套换算；单独算一份给地图最上层那个 `<g>` 用） */
  const hereX = cx + Math.sqrt(3) * size * (grid.pos.q + grid.pos.r / 2)
  const hereY = cy + 1.5 * size * grid.pos.r
  /**
   * **路径预览的折线点**（船长 2026-09-16 路径拦截）：走 core 的 `hexLine`（与引擎判定**同一把尺**），
   * 换算成各格中心的屏幕坐标 ⇒ 一条穿过沿途各格的折线。
   */
  const pathPoints = pathPreview
    ? hexLine(grid.pos, { q: pathPreview.q, r: pathPreview.r })
        .map(
          (c) =>
            `${(cx + Math.sqrt(3) * size * (c.q + c.r / 2)).toFixed(2)},${(cy + 1.5 * size * c.r).toFixed(2)}`,
        )
        .join(' ')
    : null
  /**
   * **新扫到的格子按圈依次亮起**（船长 2026-09-13 拍板「甲：扫描波 + 逐格点亮」）：
   * 延迟 = 与玩家所在格的距离（按"第几圈"算）× 60ms，与扩散的波同步。
   * **星云消散用同一把尺**（船长同日追加消散动画）⇒ 云也是"从里往外一圈圈散开"。
   */
  const freshAt = new Map<string, number>()
  for (const k of scanFx?.keys ?? []) {
    const c = grid.cells.find((x) => x.key === k)
    if (!c) continue
    freshAt.set(k, hexRingOf(c.q - grid.pos.q, c.r - grid.pos.r) * 60)
  }
  /** 这一批正在消散的星云格（含各自的圈延迟） */
  const dissolving = new Set(dissolveFx?.keys ?? [])
  const dissolveAt = new Map<string, number>()
  for (const k of dissolveFx?.keys ?? []) {
    const c = grid.cells.find((x) => x.key === k)
    if (!c) continue
    dissolveAt.set(k, hexRingOf(c.q - grid.pos.q, c.r - grid.pos.r) * 60)
  }
  return (
    <svg
      className="app-wh-map"
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={tr("ui.Wormhole.220", { p1: grid.radius })}
    >
      {/* 舰影底下的柔光（氛围光效；SVG 渐变，不是 CSS 拼形状） */}
      <defs>
        <radialGradient id="app-wh-ship-glow">
          <stop offset="0%" stopColor="rgba(79,216,196,0.30)" />
          <stop offset="55%" stopColor="rgba(79,216,196,0.10)" />
          <stop offset="100%" stopColor="rgba(79,216,196,0)" />
        </radialGradient>
      </defs>
      {/**
       * **缩放层**（船长 2026-09-13：左侧缩放按钮调节地图大小）：**以玩家所在格为锚点**放大/缩小 ——
       * 换算：中心为原点 `origin`、平移 `-(k-1)·(玩家 - 中心)` ⇒ 玩家那一格在屏幕上**原地不动**、
       * 四周围着它长开（放大后自己的位置永远不丢，也不用拖图）。超出的部分由地图框裁掉。
       */}
      <g
        className="app-wh-zoomlayer"
        style={{
          transformOrigin: `${cx.toFixed(1)}px ${cy.toFixed(1)}px`,
          transform: `translate(${(-(zoom - 1) * (hereX - cx)).toFixed(1)}px, ${(-(zoom - 1) * (hereY - cy)).toFixed(1)}px) scale(${zoom})`,
        }}
      >
      {/**
       * **路径预览线**（船长 2026-09-16）：画在**所有格子之下**（格子照旧压在线上，不挡图标/舰影）。
       * `is-blocked` = 拦截格还没扫描（甲案：不指名那一格，只把整条线置为警示色）。
       */}
      {pathPoints ? (
        <polyline
          className={`app-wh-path${pathPreview?.hush === true ? ' is-blocked' : ''}`}
          points={pathPoints}
        />
      ) : null}
      {grid.cells.map((c) => {
        const x = cx + Math.sqrt(3) * size * (c.q + c.r / 2)
        const y = cy + 1.5 * size * c.r
        const visited = grid.visited.includes(c.key)
        const scanned = grid.scanned.includes(c.key)
        /**
         * ⚠ **信息档一律走 core 的 `revealOf`**（2026-09-13 星云批改的）。
         *
         * 改之前这里直接读 `c.place` 上色（`signalOfPlace(c.place)`）⇒ 那是**真相**：
         * 星云遮蔽接进来后，照旧上色就等于"云没遮住任何东西"（边框颜色把被遮的信号漏出去）。
         * 现在四档同源：`unknown` / `signal`（含"无信号 = 空地点"）/ **`nebula`** / `known`。
         */
        const rev = revealOf(grid, { q: c.q, r: c.r })
        const known = rev.kind === 'known' || rev.kind === 'signal' || rev.kind === 'nebula'
        const nebula = rev.kind === 'nebula'
        const signal = rev.kind === 'signal' ? rev.signal : rev.kind === 'known' ? rev.signal : null
        // 入口：**到达过**或**被漂浮信标标出来**（船长 2026-09-13 新增信标）⇒ 地图上一直标着
        const isExit = c.key === exitKey && (visited || grid.exitKnown === true)
        /**
         * **清空 / 已激活的地点：删掉地点图标；还有残留东西的：变暗**（船长 2026-09-13）。
         *
         * 判定：
         * - `activated` = 这一格的事已经做完了（舰船信号打完 / 信标读过 / 打捞·采集捞空 / 入口守卫清掉）；
         * - 去过且**堆已空**也算做完（可能没打标：比如只走过一遭的空地点）；
         * - `hasLeftover`（堆非空）= 还有东西没拿 ⇒ **图标留着**，但整格压暗（提示"来过、没拿完"）。
         * ⚠ **下一层入口（`isExit`）不吃这条**：它是导航标记不是地点图标，玩家还要靠它认路。
         */
        const activated = grid.activated.includes(c.key)
        const hasLeftover = (c.piles ?? []).length > 0
        const cleared = activated || (visited && !hasLeftover)
        const iconGone = cleared && !isExit
        const dim = visited && (cleared || hasLeftover)
        /** 这一格是不是"这一批刚被驱散"的星云（动画期间单独画云散开；动画结束 `dissolving` 清空 ⇒ 自动落回信号档） */
        const dissolvingNow = dissolving.has(c.key)
        const cls = [
          'app-wh-hex',
          visited ? 'is-known' : scanned ? 'is-scanned' : 'is-unknown',
          visited ? 'is-visited' : '',
          dim ? 'is-visited-dim' : '',
          iconGone ? 'is-cleared' : '',
          hasLeftover ? 'is-leftover' : '',
          /**
           * ⚠ **信号分色只给"已扫描/已到达"且没被星云遮住的格**（船长 F5：「目前未扫描的地点可以通过
           * 边框颜色判断」）：未扫描的格一律走 `.is-unknown` 的**蓝灰虚线边框**；
           * 被星云遮住的格走 `.is-nebula`（**不按信号上色**，否则边框颜色就把被遮的信号漏出去了）。
           */
          known ? (nebula ? 'is-nebula' : signal ? `is-${signal}` : 'is-blank') : '',
          /**
           * **拦截格描红**（船长 2026-09-16 路径拦截 · §5.2 甲案）：**只在那一格已知时**才指名
           * （`interceptKey` 由面板仅在"已扫描/已到过"时传入）；未扫描的拦截格**不给类**，
           * 避免"边框颜色把未扫描格的内容漏出去"（2026-09-13 那条修漏口径继续有效）。
           */
          pathPreview?.interceptKey === c.key ? 'is-intercept' : '',
          c.key === hereKey ? 'is-here' : '',
          isExit ? 'is-exit' : '',
          freshAt.has(c.key) ? 'is-just-scanned' : '',
          /** 消散动画：这一帧画"云散开"（图层在上、与信号档不冲突；700ms 后自动摘掉） */
          dissolvingNow ? 'is-dissolving' : '',
        ]
          .filter((s) => s.length > 0)
          .join(' ')
        const title = !known
          ? tr("ui.Wormhole.162")
          : isExit
            ? `下一层入口${cleared ? tr("ui.Wormhole.269") : tr("ui.Wormhole.270")}`
            : visited
              ? `${WORMHOLE_PLACE_TEXT[c.place]}（去过${cleared ? ' · 已清空' : ''}）` +
                `${hasLeftover ? ` · 还有 ${(c.piles ?? []).length} 堆没拿` : ''}`
              : nebula
                ? tr("ui.Wormhole.163")
                : signal
                  ? tr("ui.Wormhole.046", { p1: SIGNAL_TEXT[signal] })
                  : tr("ui.Wormhole.164")
        return (
          <g
            key={c.key}
            className={cls}
            onClick={() => onPickCell(c.q, c.r)}
            // 格子说明：SVG 元素用 **`data-tip`**（React 的 SVG 类型不接受 `title` 属性；SVG 的
            // `<title>` 子元素则会被浏览器弹**系统默认**提示）——由全局接管层 `ui/Tooltip.tsx` 接管
            data-tip={title}
            style={
              dissolvingNow && dissolveAt.has(c.key)
                ? { animationDelay: `${dissolveAt.get(c.key)}ms` }
                : freshAt.has(c.key)
                  ? { animationDelay: `${freshAt.get(c.key)}ms` }
                  : undefined
            }
          >
            <polygon points={corners.map((p) => `${(x + p.dx).toFixed(2)},${(y + p.dy).toFixed(2)}`).join(' ')} />
            {known && !iconGone ? (
              <g className="app-wh-hex-glyph" transform={`translate(${x.toFixed(2)},${y.toFixed(2)})`}>
                {nebula ? <WhNebulaGlyph /> : <WhGlyph signal={signal} exit={isExit} />}
              </g>
            ) : null}
            {/**
             * **星云消散**（船长 2026-09-13：「当消除星云时，给星云添加个消散的动画」）：
             * 单独补一层云团线稿——**同一个 ≤2px 的云徽由 1.0 外扩到 2.1 并淡出**
             * （外扩读作"散开"、淡出读作"没了"；与 `app-wh-scan-wave` 一样用 `transform`/`opacity`，
             * 走合成层、不重排）。数据在点下那一刻就已经进 `grid.dispersed`，这一层只是"让消失看得见"。
             */}
            {dissolvingNow ? (
              <g
                className="app-wh-nebula-dissolve"
                transform={`translate(${x.toFixed(2)},${y.toFixed(2)})`}
                pointerEvents="none"
              >
                <WhNebulaGlyph />
              </g>
            ) : null}
            {/* **去过标记**：右上角一个小实心点（SVG 线稿；与图例同源） */}
            {visited ? <circle className="app-wh-hex-done" cx={x + size * 0.52} cy={y - size * 0.5} r={2.2} /> : null}
          </g>
        )
      })}
      {/**
       * **扫描波**（船长 2026-09-13 拍板方案甲）：从玩家所在格向外扩散一圈**线稿圆环**
       * （SVG `circle` + CSS 动画 `r`/`opacity`，不拼形状），半径 = 扫描圈数 + 半格余量；
       * `key` 带序号 ⇒ 连点也能重播。
       */}
      {scanFx ? (
        <circle
          key={`scan-${scanFx.nonce}`}
          className="app-wh-scan-wave"
          cx={hereX.toFixed(2)}
          cy={hereY.toFixed(2)}
          r={0}
          style={{ ['--wh-wave-r' as string]: `${((scanFx.rings + 0.45) * Math.sqrt(3) * size).toFixed(1)}px` }}
        />
      ) : null}
      {/**
       * **玩家舰影**（船长 2026-09-13：「当前玩家停留的格子，用玩家舰船队伍里第一艘船的 SVG 图形覆盖表示」）：
       * 单独挂在格子之上（不进上面那圈 `<g>`，免得被格子的透明度/点击态牵连）；
       * `transform` 用**内联 style** 写 ⇒ 换格时由 CSS 过渡**平移过去**（移动动画）；
       * 换层时 `key` 变 ⇒ 重新挂载，重播一次**从地图外飞入**（船长：入场 1 秒 / 深入时先飞出屏幕外）。
       */}
      <g
        key={`player-${layerKey}`}
        className={`app-wh-ship-here${fx === 'in' ? ' is-entering' : fx === 'out' ? ' is-leaving' : ''}`}
        style={{
          transform: `translate(${hereX.toFixed(2)}px, ${hereY.toFixed(2)}px)`,
          // 关键帧里要还原"落点"，故把落点与两个出画偏移都写成变量（纯表现，判定不用）
          ['--wh-x' as string]: `${hereX.toFixed(1)}px`,
          ['--wh-y' as string]: `${hereY.toFixed(1)}px`,
          // 飞入起点 = 地图左侧外 · 飞出终点 = 地图右侧外（一眼能看出"从外面来 / 往外面走"）
          ['--wh-fly-in' as string]: `${(-hereX - size * 3).toFixed(1)}px`,
          ['--wh-fly-out' as string]: `${(w - hereX + size * 3).toFixed(1)}px`,
          ['--wh-fly-ms' as string]: `${fx === 'out' ? WORMHOLE_FX_OUT_MS : WORMHOLE_FX_IN_MS}ms`,
        }}
      >
        <circle className="app-wh-ship-halo" r={size * 0.62} fill="url(#app-wh-ship-glow)" />
        {shipDefId ? (
          <ShipSpriteShape shipId={shipDefId} size={size * 1.15} />
        ) : (
          <path className="app-wh-ship-fallback" d="M-6,-4 L7,0 L-6,4 Z" />
        )}
      </g>
      </g>
    </svg>
  )
}

/**
 * 格内符号（**一律 SVG 线稿**，以格心为原点、半径约 7~8）。
 * `exit` = 下一层入口（箭头）；`signal === null` = 空信息地点（一个小空心点）；
 * `beacon` = 漂浮信标（灯塔塔身 + 两道扫描光）。
 */
function WhGlyph({ signal, exit }: { signal: WormholeSignal | null; exit?: boolean }) {
  if (exit) return <path d="M-7,0 L6,0 M1,-5 L7,0 L1,5" />
  if (signal === 'wreck') return <path d="M-8,3 L-4,-3 L0,2 L4,-4 L8,3" />
  if (signal === 'ship') return <path d="M-7,-5 L8,0 L-7,5 Z" />
  if (signal === 'resource') return <path d="M0,-7 L7,0 L0,7 L-7,0 Z" />
  if (signal === 'radar')
    return (
      <>
        <path d="M-7,4 A7,7 0 0 1 7,4" />
        <path d="M-3.4,4 A3.4,3.4 0 0 1 3.4,4" />
        <circle cx={0} cy={4} r={1.4} />
      </>
    )
  if (signal === 'beacon')
    return (
      <>
        <path d="M-3.6,7 L-1.8,-2 L1.8,-2 L3.6,7 Z" />
        <path d="M-7,-5 L-2.6,-3.4 M7,-5 L2.6,-3.4" />
        <path d="M-1.8,-2 L1.8,-2" />
      </>
    )
  return <circle cx={0} cy={0} r={2.2} />
}

/**
 * **星云图标**（船长 2026-09-13 星云机制）：被星云遮住的格画一团云——**SVG 线稿**（约定 §九：
 * 图形一律线稿、禁 CSS 拼形状），由三条疏密不同的弧线叠出"云团"轮廓 + 两颗小星点（说明这是"星云"、
 * 不是"什么都没扫到"）。与 `WhGlyph` 同一套 `currentColor` / 描边语言，故格子配色一变它自动跟随。
 */
function WhNebulaGlyph() {
  return (
    <g className="app-wh-nebula">
      <path d="M-7,2.4 A3.2,3.2 0 0 1 -2.6,-2.4 A3.6,3.6 0 0 1 3,-1.4 A3,3 0 0 1 7,2.4 Z" />
      <path d="M-5.6,4.6 A2.4,2.4 0 0 1 -1.6,1.6 A2.6,2.6 0 0 1 3.2,2.2 A2.6,2.6 0 0 1 5.6,4.6" />
      <circle cx={-3.4} cy={-4.4} r={0.9} />
      <circle cx={4.2} cy={-3.2} r={0.7} />
    </g>
  )
}

/** 信号名（图例与悬浮提示共用；与 `WORMHOLE_PLACE_TEXT` 分开：信号 ≠ 地点真相） */
const SIGNAL_TEXT: Readonly<Record<WormholeSignal, string>> = {
  wreck: tr("ui.Wormhole.165"),
  ship: tr("ui.Wormhole.221"),
  resource: tr("ui.Wormhole.222"),
  radar: tr("ui.Wormhole.271"),
  beacon: tr("ui.Wormhole.047"),
}

/** 地图图例（与格内符号共用同一个 `WhGlyph` ⇒ 图例与看板永远一致） */
const GRID_LEGEND: ReadonlyArray<{
  key: string
  text: string
  signal: WormholeSignal | null
  none?: boolean
  /** 「去过」那一档：画基线空 hex + 右上角小点 */
  done?: boolean
  /** 「星云」那一档：画星云线稿（船长 2026-09-13 星云机制） */
  nebula?: boolean
}> = [
  { key: 'unknown', text: tr("ui.Wormhole.166"), signal: null, none: true },
  { key: 'nebula', text: tr("ui.Wormhole.167"), signal: null, none: true, nebula: true },
  { key: 'visited', text: tr("ui.Wormhole.119"), signal: null, none: true, done: true },
  { key: 'wreck', text: SIGNAL_TEXT.wreck, signal: 'wreck' },
  { key: 'ship', text: SIGNAL_TEXT.ship, signal: 'ship' },
  { key: 'resource', text: SIGNAL_TEXT.resource, signal: 'resource' },
  { key: 'radar', text: SIGNAL_TEXT.radar, signal: 'radar' },
  { key: 'beacon', text: SIGNAL_TEXT.beacon, signal: 'beacon' },
  { key: 'blank', text: tr("ui.Wormhole.223"), signal: null },
]

/** 地点说明（看板一处说清"这里有什么/能干什么"；数字口径与 core 常量同源） */
const PLACE_NOTE: Readonly<Record<WormholePlace, string>> = {
  empty: tr("ui.Wormhole.224"),
  graveyard: tr("ui.Wormhole.225"),
  ruins: tr("ui.Wormhole.272"),
  ship: tr("ui.Wormhole.226"),
  vein: tr("ui.Wormhole.168"),
  matter:
    tr("ui.Wormhole.227"),
  beacon: tr("ui.Wormhole.169"),
}
/**
 * **货仓页 = 形状网格**（F4b · 船长 2026-09-13：「类似背包英雄那种需要管理的背包格（没有背包，
 * 货仓直接代表背包大小）」；F5 补一条：「散货也在货仓背包内，并允许玩家拖拽移动」）。
 *
 * 画法（与 core 同一套几何，`wormholeHold`）：
 * - **8 列**、行数 = ⌈可用格数 ÷ 8⌉；超出可用格数的显示位 = **锁定格**（虚线、不可放）；
 * - **一切占格的东西都在 `run.hold.placements` 里**（F5 起散货也是**真摆放件**，不再是画面上临时填的散格）：
 *   **形状件**（安全货柜 2×2 · 图纸货柜 2×1）与**散货条**（一种货一条 1×N 横条，放不下自动改 N×1 竖条）
 *   都按自己的坐标画成整块、**都能拖拽**（落点非法 ⇒ 拒绝并提示）；
 * - 散货条由 core `wormholeHoldSyncCargo` 与 `run.bag` 对齐（数量变了就重放，**先试原位**保住玩家摆好的位置）；
 * - 超载（沉船后格数变小）⇒ 顶部红条 + 「一键抛到容量内」；抛弃**永远手动**（船长裁定 8）。
 */
/**
 * **抓取偏移**：玩家是抓住块内**第几格**开始拖的（列 dx / 行 dy）。
 *
 * 为什么必须有它（船长 2026-09-13 报障「如果不是拖拽左上角会提示[这里放不下]」）：
 * 拖拽落点事件给的是**鼠标压着的那一格**；件的新左上角 = 落点 − 抓取偏移。
 * 少了这一步，抓右下角拖一个 2×2 货柜就会按"左上角落在右下角那格"去判 —— 必然越界。
 */
function grabOffsetOf(el: HTMLElement, w: number, h: number, clientX: number, clientY: number): { dx: number; dy: number } {
  const r = el.getBoundingClientRect()
  if (r.width <= 0 || r.height <= 0) return { dx: 0, dy: 0 }
  const clamp = (v: number, max: number): number => Math.min(max, Math.max(0, v))
  return {
    dx: clamp(Math.floor(((clientX - r.left) / r.width) * w), w - 1),
    dy: clamp(Math.floor(((clientY - r.top) / r.height) * h), h - 1),
  }
}

function WhHold({
  engine,
  onToast,
  tempAsk,
  setTempAsk,
  onTempDiscard,
  onTempStow,
}: {
  engine: GameEngine
  onToast: ToastFn
  /** 临时空间待清空确认的意图（面板层持有：切页 / 关面板 / 撤离都要过这一关） */
  tempAsk: null | 'tab' | 'close' | 'extract'
  setTempAsk: (v: null | 'tab' | 'close' | 'extract') => void
  /** 「丢掉这些」/「放回货仓」的实际处置（面板层持有，因为它要用 onClose / 撤离继续流程） */
  onTempDiscard: () => void
  onTempStow: () => void
}) {
  const state = engine.state
  const ctx = engine.ctx
  const run = state.wormhole.run!
  const info = engine.wormholeHoldInfo()
  /** **临时空间读数**（船长 2026-09-13：「大件货先进临时空间，让玩家协调」） */
  const tempInfo = engine.wormholeTempInfo()
  /** **抛弃控件**：正在问"丢多少"的那一件（船长 2026-09-13：「拖动条 + 允许输入数量」） */
const [askDiscard, setAskDiscard] = useState<string | null>(null)
  const [discardAsk, setDiscardAsk] = useState<{ id: string; units: number } | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  /** 拖的是**哪一块板**上的件（跨板拖 = 货仓 ↔ 临时空间；同板拖 = 移动/换位） */
  const [dragFrom, setDragFrom] = useState<BoardKind>('hold')
  /** 临时空间里还摆着的件（非空 ⇒ 离开背包页必须先处理；意图态由面板层持有） */
  const tempPending = tempInfo.placements
  /** 抓起时压住的是块内哪一格（见 `grabOffsetOf`）：落点要减掉它，抓哪一格拖都算数 */
  const grabRef = useRef({ dx: 0, dy: 0 })
  const cols = WORMHOLE_HOLD_COLS
  const holdBoard = run.hold ?? makeHoldState()
  const tempBoard = run.tempGrid ?? makeHoldState(WORMHOLE_TEMP_COLS)
  const placements = run.hold?.placements ?? []
  /**
   * **行数要够到"实际摆放件"**（不能只按容量算）：整理时**放不下的件会被排到可用区之外**
   * （core `holdCompact`：先保彼此不重叠，再由界面提示抛货）——只按容量算行数，这些件会跑到格子外**看不见**。
   */
  const rows = Math.max(
    holdRows(info.capacity, cols),
    placements.reduce((m, p) => Math.max(m, p.y + p.h), 0),
  )
  const boxes = placements.filter((p) => p.kind === 'box').length
  /** 散货**件**（一件一格：船长 2026-09-13 深夜口径；按物品名 + 位置排序，列表稳定不跳） */
  const cargoPieces = placements
    .filter((p) => p.kind === 'cargo')
    .sort((a, b) => a.itemId.localeCompare(b.itemId) || a.y - b.y || a.x - b.x)

  /** 格 → 件（画块用；散货条与货柜共用一张占用表） */
  const ownerOf = new Map<string, (typeof placements)[number]>()
  for (const p of placements) {
    for (const c of placementCells(p)) ownerOf.set(`${c.x},${c.y}`, p)
  }

  /**
   * **落点**（船长 2026-09-13 两条：「拖拽要能抓住整件」「物品之间要能交换位置」）：
   * ① 落在**空格**上 = 普通移动；② 落在**别件身上** = **两件互换位置**（形状对不上则拒绝并回滚，
   * 由 core `holdSwap` 判、界面只报原因）。
   *
   * ⚠ **2026-09-14 修船长报障**（「不是拖拽左上角就提示[这里放不下]」＋「当物品上方处于第一排时」）：
   * 落位要按**抓取偏移**换算（`grabRef`），且**越界由 core 夹回网格内**（`holdDropWithGrab`）。
   *
   * ⚠ **2026-09-14 新增跨板**（临时空间改成 4×8 的格子区）：`kind` = 落点所在的板 ——
   * 同一块板内 = 移动/换位；**跨板**（货仓 ↔ 临时空间）= `wormholeBoardTransfer`（形状/实占格原样带过去）。
   */
  function dropAt(kind: BoardKind, x: number, y: number): void {
    const id = dragId
    if (!id) return
    const target = ownerMap(kind).get(`${x},${y}`)
    if (target && target.id !== id) {
      const r = engine.wormholeHoldSwap(id, target.id)
      if (!r.ok) onToast(r.error ?? '换不了位置。', true)
      setDragId(null)
      return
    }
    const r =
      dragFrom === kind
        ? engine.wormholeHoldDropAt(id, x, y, grabRef.current)
        : engine.wormholeBoardTransfer(dragFrom, kind, id, x, y, grabRef.current)
    if (!r.ok) onToast(r.error ?? '这里放不下。', true)
    setDragId(null)
  }

  /** 某一板上「格 → 件」的占用表（画格子与判落点都用它） */
  function ownerMap(kind: BoardKind): Map<string, WormholeHoldPlacement> {
    const board = kind === 'hold' ? run.hold : run.tempGrid
    const out = new Map<string, WormholeHoldPlacement>()
    for (const p of board?.placements ?? []) for (const c of placementCells(p)) out.set(`${c.x},${c.y}`, p)
    return out
  }

  /**
   * **一块格板**（货仓 8 列 / 临时空间 4 列**共用同一套画法**——船长 2026-09-14：
   * 「背包格宽度是 8 格，那么可以在背包格右边添加一个用于丢弃和调整位置的『小背包』」）。
   *
   * ⚠ 写成**普通渲染函数**而不是内层组件：内层组件每次渲染都是"新类型"，React 会把整棵子树
   * 卸载重建 ⇒ 拖拽中的 DOM 与状态会被打断。
   */
  function boardView(
    kind: BoardKind,
    board: WormholeHoldState,
    capacity: number,
    boardCols: number,
    boardRows: number,
    lockedTitle: string,
  ): JSX.Element {
    const owner = ownerMap(kind)
    return (
      <div
        className={`app-wh-hold-grid is-${kind}`}
        style={{ gridTemplateColumns: `repeat(${boardCols}, 1fr)`, gridTemplateRows: `repeat(${boardRows}, 1fr)` }}
      >
        {Array.from({ length: boardRows * boardCols }, (_, i) => {
          const x = i % boardCols
          const y = Math.floor(i / boardCols)
          const key = `${kind}-${x},${y}`
          const locked = i >= capacity
          const p = owner.get(`${x},${y}`)
          const isOrigin = p !== undefined && p.x === x && p.y === y
          const def = p ? ctx.items.get(p.itemId) : undefined
          const cls = [
            'app-wh-hold-cell',
            locked ? 'is-locked' : '',
            p ? (p.kind === 'cargo' ? 'is-cargo' : 'is-box') : locked ? '' : 'is-free',
            isOrigin ? 'is-origin' : p ? 'is-body' : '',
            p && p.kind === 'cargo' && !isOrigin ? 'is-cargobody' : '',
            dragId !== null && isOrigin ? 'is-dragging' : '',
          ]
            .filter((s) => s.length > 0)
            .join(' ')
          return (
            <div
              key={key}
              className={cls}
              title={
                locked
                  ? lockedTitle
                  : p
                    ? p.kind === 'cargo'
                      ? tr("ui.Wormhole.048", { p1: def?.name ?? p.itemId, p2: n(p.units ?? 0), p3: p.w, p4: p.h })
                      : tr("ui.Wormhole.049", { p1: def?.name ?? p.itemId, p2: p.w, p3: p.h })
                    : kind === 'hold'
                      ? tr("ui.Wormhole.228")
                      : tr("ui.Wormhole.229")
              }
              draggable={isOrigin}
              onPointerDown={(e) => {
                if (isOrigin && p) {
                  grabRef.current = grabOffsetOf(e.currentTarget as HTMLElement, p.w, p.h, e.clientX, e.clientY)
                }
              }}
              onDragStart={() => {
                if (isOrigin) {
                  setDragId(p!.id)
                  setDragFrom(kind)
                }
              }}
              onDragEnd={() => setDragId(null)}
              onDragOver={(e) => {
                if (dragId) e.preventDefault()
              }}
              onDrop={(e) => {
                e.preventDefault()
                dropAt(kind, x, y)
              }}
              onClick={() => {
                if (isOrigin) {
                  // 点一下选中/取消（选中后再点空格也能落位，照顾不方便拖的场景）
                  setDragFrom(kind)
                  setDragId((prev) => (prev === p!.id ? null : p!.id))
                } else if (dragId) {
                  dropAt(kind, x, y)
                }
              }}
            ></div>
          )
        })}
        {/* **物品块层**：与格子网格同一套列/行模板 ⇒ 逐格对齐；每件一块、块自己接拖拽/点击/落点。 */}
        <div
          className="app-wh-hold-figures"
          style={{ gridTemplateColumns: `repeat(${boardCols}, 1fr)`, gridTemplateRows: `repeat(${boardRows}, 1fr)` }}
        >
          {board.placements.map((p) => {
            const def = ctx.items.get(p.itemId)
            const iconKey = itemIconOf(p.itemId, def?.kind)
            const isCargo = p.kind === 'cargo'
            /** 谜质装置那一台（缺口 2026-09-15 船长报障：「鼠标移动到谜质上，不显示谜质具体效果」） */
            const matterDev = wormholeMatterDeviceOf(p.itemId)
            const isMatter = matterDev !== undefined
            const label = isCargo
              ? `×${n(p.units ?? 0)}`
              : p.itemId.startsWith('box-bp-')
                ? tr("ui.Wormhole.120")
                : p.itemId.startsWith('ai-core-')
                  ? tr("ui.MarketPage.008") // AI 核心（2026-09-14）：1×1 = 1 格，短标签与货柜的「图纸」同一档
                  : (matterDev?.short ?? '货柜')
            return (
              <div
                key={`fig-${kind}-${p.id}`}
                className={`app-wh-hold-fig ${isCargo ? 'is-cargo' : 'is-box'}${
                  dragId === p.id ? ' is-dragging' : ''
                }${kind === 'temp' && isMatter ? ' is-inert' : ''}`}
                style={{
                  gridColumn: `${p.x + 1} / span ${p.w}`,
                  gridRow: `${p.y + 1} / span ${p.h}`,
                  color: itemToneOf(p.itemId, iconKey),
                }}
                title={
                  (isCargo
                    ? tr("ui.Wormhole.050", { p1: def?.name ?? p.itemId, p2: n(p.units ?? 0), p3: p.w, p4: p.h })
                    : // 谜质装置：**把这一台的具体效果写在悬停里**（船长 2026-09-15）——
                      // 文字与「取回谜质」的 toast、「谜质 N 台」读数同源（都取 `device.text`，界面不自写文案）
                      tr("ui.Wormhole.051", { p1: def?.name ?? p.itemId, p2: matterDev ? `：${matterDev.text}` : '', p3: p.w, p4: p.h })) +
                  (kind === 'temp'
                    ? isMatter
                      ? ' · 在临时空间里不生效（谜质增益只认货仓格）'
                      : ' · 离开货仓页前要放回货仓或丢掉'
                    : kind === 'hold' && isMatter
                      ? ' · 本趟增益生效中'
                      : '')
                }
                draggable
                onPointerDown={(e) => {
                  grabRef.current = grabOffsetOf(e.currentTarget as HTMLElement, p.w, p.h, e.clientX, e.clientY)
                }}
                onDragStart={() => {
                  setDragId(p.id)
                  setDragFrom(kind)
                }}
                onDragEnd={() => setDragId(null)}
                onDragOver={(e) => {
                  if (dragId) e.preventDefault()
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  dropAt(kind, p.x, p.y)
                }}
                onClick={() => {
                  setDragFrom(kind)
                  setDragId((prev) => (prev === p.id ? null : p.id))
                }}
              >
                <Glyph name={iconKey} size={64} color="currentColor" />
                <span className="app-wh-hold-fig-label">{label}</span>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="app-wh-hold">
      {/**
       * **临时空间待处理确认条**（船长 2026-09-14：「切换回探索界面触发丢弃（但是需要提醒玩家是否要丢弃物品
       * 并列出丢弃的物品列表）」＋「强制二选一：丢掉 或 放回」＋「撤离前必须清空」）：
       * 逐件列出（图标 + 名称 + 数量 + 是否失效），两个按钮 = 丢掉这些 / 放回货仓；谜质装置会失效。
       */}
      {tempAsk !== null && tempPending.length > 0 ? (
        <div className="app-wh-tempask">
          <div className="app-wh-tempask-title">
            {tr("ui.Wormhole.052")} <b>{tempPending.length}</b> {tr("ui.Wormhole.053")}{tempInfo.cells}/{tempInfo.capacity} {tr("ui.Wormhole.170")}
            {tempAsk === 'extract' ? tr("ui.Wormhole.171") : tr("ui.Wormhole.230")}
          </div>
          <ul className="app-wh-tempask-list">
            {tempPending.map((p) => {
              const def = ctx.items.get(p.itemId)
              const device = wormholeMatterDeviceOf(p.itemId)
              return (
                <li key={`ask-${p.id}`}>
                  <span className="app-wh-hold-row-ico" style={{ color: itemToneOf(p.itemId, itemIconOf(p.itemId, def?.kind)) }}>
                    <Glyph name={itemIconOf(p.itemId, def?.kind)} size={15} color="currentColor" />
                  </span>
                  {def?.name ?? p.itemId}
                  {p.kind === 'cargo' ? ` ×${n(p.units ?? 0)}` : ''}
                  <span className="app-dim">
                    {' '}
                    {tr('ui.Wormhole.281', { n: p.w * p.h })}
                    {device ? ` · 谜质装置：放在这里已失效${wormholeMatterDiscardHint(p.itemId) ? `（${wormholeMatterDiscardHint(p.itemId)}）` : ''}` : ''}
                  </span>
                </li>
              )
            })}
          </ul>
          <div className="app-wh-tempask-actions">
            <button className="app-btn is-small is-warn" onClick={onTempDiscard}>
              {tr("ui.Wormhole.054")}
            </button>
            <button className="app-btn is-small is-primary" onClick={onTempStow}>
              {tr("ui.Wormhole.172")}
            </button>
            <button className="app-btn is-small" onClick={() => setTempAsk(null)}>
              {tr("ui.Wormhole.055")}
            </button>
          </div>
        </div>
      ) : null}
      <div className="app-bay-title">
        {tr("ui.Wormhole.231")} <b>{info.used}</b> / {info.capacity}{tr('ui.Wormhole.285')}
        {info.overload ? <span className="app-wh-hold-warn">{tr('ui.Wormhole.282')}</span> : null}
        <span className="app-dim">
          {' '}{tr("ui.Wormhole.273")} {info.cargoCells} {tr("ui.Wormhole.173")} {info.shapeCells} 格
          {info.unplacedCells > 0 ? ` + 放不下 ${info.unplacedCells} 格` : ''}）
        </span>
        {/* 货仓说明**进 ⓘ**（2026-09-14 船长：「虫洞背包页面的货仓说明要进」）——原文一字未改，只搬位置 */}
        <HintIcon
          tip={tr("ui.Wormhole.174", { p1: n(WORMHOLE_SLOT_M3) })}
        />
      </div>
      {info.overload ? (
        <div className="app-wh-hold-overload">
          <span>
            {tr("ui.Wormhole.232")}{info.used}/{info.capacity} 格）。
            请手动抛弃货物——超载期间不能再拾取/打捞，撤离与深入也要先抛到容量内。
          </span>
          <button
            className="app-btn is-small is-warn"
            onClick={() => {
              const r = engine.wormholeDiscardToFit()
              if (!r.ok) onToast(r.error ?? '没有可抛的货。', true)
            }}
          >
            {tr("ui.Wormhole.056")}
          </button>
        </div>
      ) : null}
      <div className="app-wh-hold-boards">
        <div className="app-wh-hold-board-main">
          {boardView('hold', holdBoard, info.capacity, cols, rows, tr("ui.Wormhole.274"))}
          <div className="app-wh-actions">
            <button
              className="app-btn is-small"
              disabled={placements.length === 0}
              onClick={() => {
                const r = engine.wormholeHoldCompact()
                if (!r.ok) onToast(r.error ?? '无法整理。', true)
              }}
            >
              {tr("ui.Wormhole.175")}
            </button>
            <span className="app-dim">
              {boxes} {tr("ui.Wormhole.057")} {cargoPieces.length} {tr("ui.Wormhole.058")}
            </span>
          </div>
        </div>
        {/**
         * **临时空间**（船长 2026-09-14：「背包格宽度是 8 格，那么可以在背包格右边添加一个用于丢弃和
         * 调整位置的『小背包』。玩家可以临时将东西放进去腾出位置调整背包…正式名：临时空间」）：
         * **4 列 × 8 行 = 32 格**，与货仓同款格子/块层（跨板拖拽即可搬进搬出）；**不占货仓容量、不算超载**；
         * **离开背包页前必须清空**（丢掉 或 放回货仓 —— `tempPending` 非空就拦着不让走）。
         */}
        <div className="app-wh-hold-board-side">
          <div className="app-bay-title">
            {tr("ui.Wormhole.059")} <b>{tempInfo.cells}</b> / {tempInfo.capacity} 格
            {tempInfo.full ? <span className="app-wh-hold-warn">{tr('ui.Wormhole.283')}</span> : null}
          </div>
          {boardView('temp', tempBoard, WORMHOLE_TEMP_CELLS, WORMHOLE_TEMP_COLS, WORMHOLE_TEMP_ROWS, '')}
          <div className="app-wh-actions">
            <button
              className="app-btn is-small"
              disabled={tempInfo.placements.length === 0}
              onClick={() => {
                const r = engine.wormholeTempCompact()
                if (!r.ok) onToast(r.error ?? '无法整理。', true)
              }}
            >
              {tr("ui.Wormhole.176")}
            </button>
            <span className="app-dim">{tr("ui.Wormhole.177")}</span>
          </div>
          <div className="app-dim app-note">
            {tr('ui.Wormhole.284')}
          </div>
        </div>
      </div>
      {/* 货柜清单（形状件：位置读数 + 抛弃；散货条在下面的散货清单里按"类"处理） */}
      <div className="app-bay-title">{tr("ui.Wormhole.233")} {boxes} 件</div>
      {boxes === 0 ? (
        <div className="app-dim app-inv-empty">{tr("ui.Wormhole.178")}</div>
      ) : (
        <ul className="app-inv-list">
          {placements
            .filter((p) => p.kind === 'box')
            .map((p) => (
              <li key={p.id} className="app-inv-row">
                <div className="app-inv-main">
                  <span className="app-inv-name">
                    <span
                      className="app-wh-hold-row-ico"
                      style={{
                        color: itemToneOf(p.itemId, itemIconOf(p.itemId, ctx.items.get(p.itemId)?.kind)),
                      }}
                    >
                      <Glyph
                        name={itemIconOf(p.itemId, ctx.items.get(p.itemId)?.kind)}
                        size={15}
                        color="currentColor"
                      />
                    </span>
                    {ctx.items.get(p.itemId)?.name ?? p.itemId}
                  </span>
                  <span className="app-inv-count">
                    {p.w}×{p.h} {tr("ui.Wormhole.179")} {p.y + 1} {tr("ui.Wormhole.234")} {p.x + 1} 列
                  </span>
                </div>
                <div className="app-inv-btns">
                  {/* 谜质「时序核心」这类**回合类**装置：抛之前先问一句（船长 2026-09-13：「需要提醒玩家」） */}
                  {wormholeMatterDiscardHint(p.itemId) && askDiscard === p.id ? null : (
                    <button
                      className="app-btn is-small is-warn"
                      onClick={() => {
                        if (wormholeMatterDiscardHint(p.itemId)) {
                          setAskDiscard(p.id)
                          return
                        }
                        const r = engine.wormholeDiscardHold(p.id)
                        if (!r.ok) onToast(r.error ?? '抛弃失败。', true)
                      }}
                    >
                      {tr("ui.Wormhole.180")}
                    </button>
                  )}
                </div>
              </li>
            ))}
        </ul>
      )}
      {/**
       * **抛弃回合类装置的确认条**（船长 2026-09-13 问的那条：「如果玩家丢弃回合相关谜质导致回合数不够，
       * 需要提醒玩家」）：明确写出代价 + "撤离不受影响" —— 丢完只是走不动，不会软锁。
       */}
      {askDiscard && placements.some((p) => p.id === askDiscard) ? (
        <div className="app-wh-ask">
          <span>⚠ {wormholeMatterDiscardHint(placements.find((p) => p.id === askDiscard)!.itemId)}</span>
          <span className="app-wh-actions">
            <button
              className="app-btn is-small is-danger"
              onClick={() => {
                const r = engine.wormholeDiscardHold(askDiscard)
                setAskDiscard(null)
                if (!r.ok) onToast(r.error ?? '抛弃失败。', true)
              }}
            >
              {tr("ui.Wormhole.235")}
            </button>
            <button className="app-btn is-small" onClick={() => setAskDiscard(null)}>
              {tr("ui.ActivityBar.004")}
            </button>
          </span>
        </div>
      ) : null}
      {/**
       * **散货清单 = 一件一行**（船长 2026-09-13 深夜：「残骸和母矿不应该合并超过 500 立方米，
       * 当超过时，分作 2 个单独的物品格并允许单独丢弃或者移动」）：每件最多 1 格（≤ 每格单位数），
       * 一件一个「抛弃」入口 —— 点开出现**数量拖动条 + 可直接输入数量**（同一条船长口径），
       * 只丢这一件里的指定数量，其余留在原格；移动在网格里拖那一格即可。
       */}
      <div className="app-bay-title">
        {tr("ui.Wormhole.236")} {cargoPieces.length} 件
        <span className="app-dim">（{run.bag.length} {tr("ui.Wormhole.237")}</span>
      </div>
      {cargoPieces.length === 0 ? (
        <div className="app-dim app-inv-empty">{tr("ui.Wormhole.181")}</div>
      ) : (
        <ul className="app-inv-list">
          {cargoPieces.map((p, i) => {
            const def = ctx.items.get(p.itemId)
            const per = wormholeUnitsPerSlot(def?.unitM3 ?? 0)
            const units = Math.max(0, Math.floor(p.units ?? 0))
            const asking = discardAsk?.id === p.id
            const amount = asking ? Math.min(discardAsk.units, Math.max(1, units)) : units
            return (
              <li key={p.id} className="app-inv-row app-wh-piece">
                <div className="app-inv-main">
                  <span className="app-inv-name">
                    <span
                      className="app-wh-hold-row-ico"
                      style={{ color: itemToneOf(p.itemId, itemIconOf(p.itemId, def?.kind)) }}
                    >
                      <Glyph name={itemIconOf(p.itemId, def?.kind)} size={15} color="currentColor" />
                    </span>
                    {def?.name ?? p.itemId} ×{n(units)}
                    <span className="app-dim">
                      {' '}
                      · 第 {i + 1} {tr("ui.Wormhole.060")} {p.y + 1} {tr("ui.Wormhole.234")} {p.x + 1} 列
                    </span>
                  </span>
                  <span className="app-inv-count">
                    {n(units * (def?.unitM3 ?? 0))} {tr("ui.Wormhole.061")} {n(per)} {tr("ui.Expedition.102")}
                  </span>
                </div>
                <div className="app-inv-btns">
                  {asking ? null : (
                    <button
                      className="app-btn is-small is-warn"
                      onClick={() => setDiscardAsk({ id: p.id, units })}
                    >
                      {tr("ui.Wormhole.180")}
                    </button>
                  )}
                </div>
                {/**
                 * **抛弃数量控件**（船长 2026-09-13 深夜：「添加一个让玩家选择抛弃多少的拖动条
                 * 并允许输入数量」）：拖动条与数字框双向同步；数字框允许直接敲，失焦/确认时夹到 1..本件数量。
                 */}
                {asking ? (
                  <div className="app-wh-discard">
                    <input
                      className="app-wh-discard-range"
                      type="range"
                      min={1}
                      max={Math.max(1, units)}
                      // 步长恒 1：拖动条上的取值必须能**精确**落到任何一个单位数
                      // （先前用 per/100 做步长，500 的上限会被浏览器吸附成 496 —— 读数对不上）
                      step={1}
                      value={amount}
                      onChange={(e) => setDiscardAsk({ id: p.id, units: Number(e.target.value) })}
                      aria-label="抛弃数量"
                    />
                    <input
                      className="app-wh-discard-num"
                      type="number"
                      min={1}
                      max={Math.max(1, units)}
                      value={amount}
                      onChange={(e) => {
                        const v = Math.round(Number(e.target.value))
                        setDiscardAsk({ id: p.id, units: Number.isFinite(v) ? Math.max(1, Math.min(units, v)) : 1 })
                      }}
                      aria-label="抛弃数量（可直接输入）"
                    />
                    <span className="app-dim">
                      共 {n(units)} · 抛弃 <b>{n(amount)}</b> {tr("ui.Wormhole.121")}{n(amount * (def?.unitM3 ?? 0))} {tr("ui.Wormhole.062")}{' '}
                      {n(units - amount)}
                    </span>
                    <button
                      className="app-btn is-small is-warn"
                      onClick={() => {
                        const r = engine.wormholeDiscardHold(p.id, amount)
                        setDiscardAsk(null)
                        if (!r.ok) onToast(r.error ?? '抛弃失败。', true)
                        else onToast(tr("ui.Wormhole.122", { p1: n(amount), p2: def?.name ?? p.itemId }))
                      }}
                    >
                      {tr("ui.Wormhole.235")}
                    </button>
                    <button className="app-btn is-small" onClick={() => setDiscardAsk(null)}>
                      {tr("ui.ActivityBar.004")}
                    </button>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
