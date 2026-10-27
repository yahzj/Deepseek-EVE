import { battleArcsFor } from '@whale/core'
/** 战斗界面职责：useVisualState，保持原调用顺序。 */
import { useMemo, useRef, useState } from 'react'

import type { BattleReportRecord, DamageType, DroneLossReport } from '@whale/core'

import type { BlinkPillarFx } from './battleBlink'

import type { DroneModel, DroneSortie } from './droneArt'
import { LAY, STAR_LAYERS, genStars } from './battleViewCore'
import type { Dims, BoltV, FlashV, Stage, OutroSnap } from './battleViewCore'

import type { AcidFx } from './battleAcidFx'

import { useBattleFit } from './battleFit'

import type { BattleFxCursor } from './battleFxCursor'
type BattleHandle = {
  startedAtGameMs: number
  /** 上一拍时刻（`thrusterPhase` 与平滑循环都读） */
  lastTickGameMs: number
  distanceM: number
  myDesireM: number
  myFleet?: Array<{ tag: string; shipId: string }>
}
export function useVisualState({ arcs }: {
arcs: ReturnType<typeof battleArcsFor>
}) {
const [stage, setStage] = useState<Stage>('live')
  const [retreatAsk, setRetreatAsk] = useState(false)
  const [dragV, setDragV] = useState<number | null>(null)
  /**
   * **期望交距读数常驻**（**2026-09-29 船长报障**：「原先战斗中，会显示玩家选择的期望距离具体数值，
   * 现在好像不见了」）。
   *
   * 改前（2026-09-26 信息层级批 I1）它**只在拖动/键盘调整时出现**，松手即隐 —— 那一批的取舍是
   * "这个数字与滑条位置说的是同一件事，常驻只是加噪音"。船长的验收口径与之相反：**战斗中要一直看得到
   * 自己选的期望距离** ⇒ 恢复常驻。占位与排版一字不动（`.app-bts-desire` 的 `min-width` 照旧），
   * 所以底部那行不会因为这次改动跳动。
   */
  const [dims, setDims] = useState<Dims>({ W: 1200, H: 460, meW: 330, foeW: 330 })
  /** 视觉插值距离（33ms 平滑引擎 ~100ms 拍；null = 尚未插值，直接用引擎值） */
  const [smoothM, setSmoothM] = useState<number | null>(null)
  const moveSnapRef = useRef<{ prev: { m: number; w: number } | null; cur: { m: number; w: number } | null }>({
    prev: null,
    cur: null,
  })
  /* ── 背景星场（三层视差：直接操作 DOM transform，追逐/拉锯差速滚动） ── */
  const dimsRef = useRef(dims)
  dimsRef.current = dims
  /** 推进器爆发倍率（0 = 未装；每渲染同步给 33ms 循环用——与 dimsRef 同款模式） */
  const thrusterBoostRef = useRef(0)
  thrusterBoostRef.current = arcs?.thrusterBoost ?? 0
  /** 我方首舰的推进器周期（2026-09-14 逐单位周期；33ms 循环同款取值） */
  const thrusterCycleRef = useRef<{ boostMs: number; cooldownMs: number } | undefined>(undefined)
  thrusterCycleRef.current = arcs?.thrusterCycle
  /** 尺寸重测入口（列宽随编队数量变化；由 33ms 循环按需调用——放在守卫之前的 hook 区声明） */
  const measureRef = useRef<() => void>(() => {})
  /** 列宽核对节拍（33ms 循环每 10 拍核对一次 ≈330ms） */
  const widthCheckRef = useRef(0)
  const starLayerRefs = useRef<Array<HTMLDivElement | null>>([])
  const starOffRef = useRef<number[]>([0, 0, 0])
  const starStateRef = useRef({ v: 70, dir: 1 })
/** 驾驶船战斗速度（装配/推进器/技能折算后的实际值，战斗期间静态）——星空视差速率来源 */
const meSpeedRef = useRef(200)
  const starField = useMemo(
    () =>
      STAR_LAYERS.map((cfg, i) => ({
        cfg,
        pts: genStars(cfg, Math.max(60, dims.W), Math.max(120, dims.H), 1009 + i * 73),
      })),
    [dims.W, dims.H],
  )

  const laneRef = useRef<HTMLDivElement>(null)
  /**
   * 「装不下就等比缩放」用（2026-09-25 船长令 · 方案甲；**2026-09-26 改成只缩战场**）：
   * 屏（标记用）· 战场外层（预算 = 屏高 − 顶栏 − 底栏）· 战场内层（量内容高并承接缩放）。
   * ⚠ 顶栏与底栏**不进这个缩放**——手机上再叠旋转那层 0.703 会把字与按钮一起缩到不可读/点不准。
   */
  const screenRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const fitRef = useRef<HTMLDivElement>(null)
  useBattleFit({ screen: screenRef, stage: stageRef, fit: fitRef, lane: laneRef })
  const meColRef = useRef<HTMLDivElement>(null)
  const foeColRef = useRef<HTMLDivElement>(null)
  /**
   * 🔴 **我方闪现光柱的宿主**（**2026-10-02 §35**）——敌方有 `.app-bts-col.is-foe` 当公共列盒，
   * 我方舰列是**逐舰绝对定位的兄弟节点**、没有公共盒 ⇒ 另起一层零尺寸、钉在舞台原点的宿主。
   * ⚠ 光柱**不能挂进我方舰船那一列**：那一列在"等待段"挂着 `opacity: 0`，子元素会被一起压成
   * 全透明（§32 敌方那次的同一个坑）。
   * ⚠ 宿主自身必须在舞台原点、零尺寸 ⇒ 里面按 `host.offsetLeft/offsetTop`（相对**同一个**定位祖先）
   * 定位出来的光柱，落点与我方舰位逐像素对齐。
   */
  const meFxRootRef = useRef<HTMLDivElement>(null)
  /** 舰首朝向：meFlip = 我方头朝左；foeFlip = 敌方头朝左（默认相向而行：我方朝右、敌方朝左） */
  const facingRef = useRef({ meFlip: false, foeFlip: true })
  /** 已消费的最新开火事件序号（引擎事件环超 48 条会丢最旧——按序号续播而非数组下标，
   *  避免"攒满 48 条后新开火全部不再播放"（战斗超 ~60 秒动画停播 bug） */
  const fxCursorRef = useRef<BattleFxCursor>({ seq: -1 })
  const keyRef = useRef(1)
  const boltsRef = useRef<BoltV[]>([])
  const flashRef = useRef<FlashV[]>([])
  const acidFxRef = useRef<AcidFx[]>([])
  const acidDeathsRef = useRef<Set<string>>(new Set())
  const acidFxWakeAtRef = useRef(Number.POSITIVE_INFINITY)
  const [, refreshAcidFx] = useState(0)
  /**
   * **伤害飘字**（**2026-09-24 船长令**：「战斗界面，我希望添加战斗伤害的数值动画（包括 MISS）」＋四答甲）：
   * 目标旁向上飘 · **同一拍对同一目标累加成一个数字** · 类型色数字 + 灰色 MISS · 只在战斗画面且随倍速/暂停。
   * 生命期用**战斗时钟** `now`（与弹道同一把尺，见下方 filter），不用墙钟 ⇒ 倍速跟着快、暂停即冻结。
   */
  const popupsRef = useRef<
    Array<{ key: number; target: string; slot: number; x: number; y: number; born: number; amount: number; type: DamageType; miss: boolean }>
  >([])
  /** 同一拍内按目标聚合（key = 目标 tag）——每拍末尾一次性落成飘字（甲②：累加成一个数字） */
  const popupAccRef = useRef<Map<string, { x: number; y: number; amount: number; type: DamageType; miss: boolean }>>(
    new Map(),
  )
  /** 2026-09-10 炮口轮换计数（key = 'me' 或敌方 tag；多炮口舰逐发轮换开火点） */
  const muzzleCountRef = useRef<Map<string, number>>(new Map())
  /** 2026-09-10 无人机机群：机型 → 当前一轮出击（放出时刻 + 本轮随机阵位；位置与弹道同源） */
  const droneSortieRef = useRef<Map<string, DroneSortie>>(new Map());
  /** **敌方机群**出海状态（2026-09-11 机群批 S5 第二层）：键 = `tag:artId`，与我方同款单轮时序 */
  const foeSortieRef = useRef<Map<string, DroneSortie>>(new Map());
  /** 出弹位轮换计数（key = 'fly:机型' / 'res:机型'；同一型多架轮流出弹） */
  const droneSlotRef = useRef<Map<string, number>>(new Map())
  /* ── 无人机位置驱动（2026-09-10 船长"无人机移动不连贯"修复）：
        位置不再走 React 渲染（33ms 循环仅在距离变化时 setState → 敌舰就位后只剩 10Hz 通知，
        表现为 10fps 步进）；改为 rAF 循环直接写 transform（容器 + 每架），恒定 60fps 平滑。 ── */
  const droneBoxRef = useRef<HTMLDivElement>(null)
  const droneElsRef = useRef<Map<string, HTMLSpanElement>>(new Map())
  /** 上次写入的 transform（值未变就不写，避免每帧无谓的样式失效与重排） */
  const droneWritesRef = useRef<Map<string, string>>(new Map())
  /** 机群被点防击落的坠落演出（2026-09-10）：登记"刚被打掉那架"的落点，CSS 演完即清（只动 transform/opacity） */
  const droneDownRef = useRef<
    Array<{
      key: number
      artId: string
      x: number
      y: number
      tx: number
      ty: number
      born: number
      foe?: boolean
    }>
  >([]);
  /**
   * **闪现跃迁演出登记**（**船长 2026-10-01/02 三次令**）：
   * 键 = 敌舰战斗 tag，值 = 本段演出的三个**界面时钟**时刻（`vanish` 消失 / `move` 位移兑现 /
   * `appear` 出现）＋ 段长。渲染层据此判"该隐了 / 该在新位置淡入了"。
   *
   * 数据来源 = **引擎的 `battle.foeBlinkQueue` 时刻表**（游戏毫秒）＋ `fx.blink` 事件触发的换算：
   * 每见到一条新事件（同上一次快照比对），就按 `(atMs − 当前战斗刻) / speedX` 换算成**真实毫秒延迟**
   * 写进本表。⚠ 这条换算是必需的：引擎的 `atMs` 是**游戏时钟**、动画跑的是**真实时钟**（倍速下不同步）。
   *
   * 🔴 **2026-10-02 修（船长实机反馈）**：位移改为**引擎在 `moveAtMs` 才兑现**，界面这里同步改成
   * **三段**（消失 1/3 → 等待 1/3 → 出现在新位置 1/3）——旧版对半劈 ⇒ 中间那段"发生时间等待"没了。
   * ⚠ **不做逐帧 JS 动画**：只加/摘类，动画交给 CSS（与 `is-arriving`/坠落演出同一纪律）。
   */
  const blinkRef = useRef<Map<string, { side: 'foe' | 'me'; vanish: number; move: number; appear: number; segMs: number }>>(new Map());
  /**
   * **闪现光柱的待播/在播表**（**船长 2026-10-02**：「**在对应的时间节点播放一个特效**」）——
   * `at` = 该柱的**真实毫秒**时刻、`until` = 播完即清理、`el` = 已建出来的 DOM（不查 DOM，省每帧 query）。
   *
   * ⚠ 排期（`planBlinkPillars`）与建/删 DOM（`syncBlinkPillarDom`）**都在 RAF 循环里**，**不走 React**：
   * 闪现期间距离常常不变 ⇒ 等不到重渲染（**船长 2026-10-02 第二次报障的根因**，见 `planBlinkPillars` 头注）。
   */
  const blinkFxRef = useRef<BlinkPillarFx[]>([]);
  /** `planBlinkPillars` 的去重集合（键 `tag:queuedMs`；换战斗时清空）——每拍都会看见同一段几十次 */
  const blinkSeenRef = useRef<Set<string>>(new Set())
  /** 每个机型**上一帧**渲染的机体数（击落时用它定位"本帧即将消失的末位机体"） */
  const dronePrevShowRef = useRef<Map<string, number>>(new Map())
  const visDistRef = useRef(0)
  const droneDriveRef = useRef<{
    /** 逐舰体积（px；2026-09-11 舰种体积，见上 `foeSizesFor`） */
    foeSizes: number[]
    /** 玩家舰体积（px；无人机阵位/弹道起点按它定标） */
    meSize: number
    farM: number
    nearM: number
    /** `foe` 有值 = 该机群属于**敌方单位 tag**（走 `foePoseAt` 镜像几何；元素键加 `foe:` 前缀）。
     *  `rangeBuff` = **受击增程已触发**（2026-09-11 船长）：机体后撤到远距阵位（见 `foeDroneStation`）。
     *  `key`/`owner` = **我方**机群的池键（`舰tag:artId`）与所属舰（2026-09-14「逐舰机群」：
     *  僚舰的机群挂在自己舰位旁 ⇒ 姿态按 `meAnchors` 里该舰的锚算）。 */
    wings: Array<{
      /** **我方**机群的池键（`舰tag:artId`；敌方那条不需要，走 `foe` 分支） */
      key?: string
      owner?: string
      artId: string
      model: DroneModel
      show: number
      st?: DroneSortie
      deck: boolean
      foe?: string
      rangeBuff?: boolean
    }>
    /** **我方逐舰锚点**（tag → 锚；2026-09-14「逐舰机群」）：rAF 循环里给僚舰机群取自己的舰位 */
    meAnchors: Map<string, { x: number; y: number }>
  }>({ foeSizes: [LAY.MAIN], meSize: LAY.MAIN, farM: 1, nearM: 200, wings: [], meAnchors: new Map() })
  /** 已被击毁的敌方单位（永久登记：残骸演出结束不复活） */
  const deadRef = useRef<Set<string>>(new Set())
  /**
   * 2026-09-09 二轮（船长反馈"切换突兀/爆炸未播完/边爆边换位"）：尸骸不再撤出队列另走锚点层，
   * 而是原位占用队列槽整段演出——tag → 爆炸计划墙钟（= 检测到死亡时刻 + 致死弹道飞行时长，
   * 让致死弹着弹后再炸）；演出期 = boomAt → boomAt + BOOM_LIFE + WRECK_FADE_MS（灰化爆炸 + 淡出）。
   * 淡出完成但右侧仍有演出期尸骸时原位占位保留，整批演完才一起撤出（一次收拢，无压爆换位）。
   */
  const corpseAtRef = useRef<Map<string, number>>(new Map())
  /** 各单位上一次渲染的血量总和（用于检测"本拍刚死"，避免复活旧尸爆炸） */
  const prevHpRef = useRef<Map<string, number>>(new Map())
  const hpInitRef = useRef(false)
  /** 各单位最近一次被击中的攻击形态（tag → DamageType）——击杀爆炸延迟按“致死形态的弹道时长”对齐，
   *  否则导弹(760ms)会被按旧 420ms 提前触发“变灰+上移” */
  const lastHitTypeRef = useRef<Map<string, DamageType>>(new Map())
  /** 分出胜负时的结算快照（resolve 后 battle 会被清空，报告数据靠它） */
  const outroRef = useRef<OutroSnap | null>(null)
  const reportTextRef = useRef('')
  /** 机群战损结算结果（2026-09-11）：进入 report 阶段那一刻从引擎取，供战报两行明细 */
  const droneReportRef = useRef<DroneLossReport | null>(null)
  /** **结构化战报**（2026-09-14 战报改造）：进入 report 阶段那一刻从引擎取（按起手时刻配对） */
  const battleReportRef = useRef<BattleReportRecord | null>(null)
  const flushTimerRef = useRef<number | null>(null)
  const dragValRef = useRef<number | null>(null)
  /**
   * 拖动"跟手"重绘的 rAF 句柄（合并高频 input 事件，见下方 `pushDragV`）。
   * ⚠ **必须在守卫之前声明**：渲染体在 `!combatView` 时会提前 `return null`，
   * 守卫之后出现的任何 hook 都会让两次渲染的 hook 数量不一致 ⇒ React 卸载整棵树（**黑屏**，
   * 2026-09-13 船长实测踩到——就是这两个 ref 放错了位置）。
   */
  const dragRafRef = useRef<number | null>(null)
  const dragPendingRef = useRef<number | null>(null)
  /**
   * **当前战斗句柄**（远征 or 洞内）——33ms 平滑循环读它（每渲染赋值一次，`dimsRef` 同款模式）。
   * ⚠ 2026-09-13：那个循环原先硬编码 `engine.state.expedition.battle` ⇒ **洞内那场在它眼里永远是 null**，
   * 于是"两拍之间线性插值"整段没跑，船只在引擎每 100ms 一拍时才动一下 ＝ 船长说的
   * 「移动有顿挫感，不是顺滑移动」（帧率没问题，是**更新节奏**掉了）。
   */
  const battleRef = useRef<BattleHandle | null>(null)
  /** 最近一次"战斗换了"的标记（`startedAtGameMs`）：33ms 循环据此重置尸骸/血量/速度等视觉账本 */
  const battleStartRef = useRef(0)
  /**
   * **阶段机的换场标记**（2026-09-22）：与 `battleStartRef` 同源但**用途不同** ——
   * 它管的是 React 状态 `stage` 的复位（见下方那个 `useEffect`），视觉账本那套照旧走 `battleStartRef`。
   * 分开是因为两者复位时机不同：阶段机只在"新战斗出现"时复位，视觉账本每换场都要清。
   */
  const prevBattleIdRef = useRef<number | null>(null)
  const mapRef = useRef<{ farM: number; nearM: number }>({ farM: 1, nearM: 200 })

  // 滑条两端距（卸载冲刷也要用）
  if (arcs) {
    mapRef.current = { farM: arcs.maxM, nearM: arcs.nearM }
  }
return {
    stage, setStage, retreatAsk, setRetreatAsk, dragV, setDragV,
    dims, setDims, smoothM, setSmoothM, moveSnapRef, dimsRef,
    thrusterBoostRef, thrusterCycleRef, measureRef, widthCheckRef, starLayerRefs, starOffRef,
    starStateRef, meSpeedRef, starField, laneRef, screenRef, stageRef,
    fitRef, meColRef, foeColRef, meFxRootRef, facingRef, fxCursorRef,
    keyRef, boltsRef, flashRef, acidFxRef, acidDeathsRef, acidFxWakeAtRef,
    refreshAcidFx, popupsRef, popupAccRef, muzzleCountRef, droneSortieRef, foeSortieRef,
    droneSlotRef, droneBoxRef, droneElsRef, droneWritesRef, droneDownRef, blinkRef,
    blinkFxRef, blinkSeenRef, dronePrevShowRef, visDistRef, droneDriveRef, deadRef,
    corpseAtRef, prevHpRef, hpInitRef, lastHitTypeRef, outroRef, reportTextRef,
    droneReportRef, battleReportRef, flushTimerRef, dragValRef, dragRafRef, dragPendingRef,
    battleRef, battleStartRef, prevBattleIdRef, mapRef,
  }
}
