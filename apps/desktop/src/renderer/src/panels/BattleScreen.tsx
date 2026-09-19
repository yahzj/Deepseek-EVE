/**
 * V12 全屏战斗场景（P4 击杀慢镜版）：
 * - 引擎在交火期间按 100ms 切片推进并即时通知本屏，画面直接以实时状态驱动；
 * - 分出胜负后引擎延迟 killcamMs 结算 → 本屏依次演出：最后一击弹道/命中 → 敌舰爆炸
 *   （或我方受创告警）→ 结算完成弹出战报覆盖层；
 * - 距离尺游标式（左远右近）、射程弧按弹种着色、滑条右 = 贴脸 / 左 = 拉开（同轴同比例）。
 * 组件只读展示，不参与确定性结算。
 * 结构（2026-09-05 维护性重构）：本文件只留「组件编排 / 状态机 / 渲染」；
 * 纯视图核心（颜色与演出计时、舰列几何、射程弧路径、三层血条、弹道几何、战报查找）
 * 已抽到 ./battleViewCore.tsx——动画/表现类改动请先落在那里的常量与纯函数。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { BATTLE_ARRIVAL_FLY_MS, BATTLE_ARRIVAL_STAGGER_MS, battleArcsFor, battleFoeAnomaly, battleShowWindowMs, battleTacticDesire, battleVerdictOf, createPlayerSpec, expeditionStatus, fleetDefOf, foeChargeCount, foeMainTagOf, foeShipTierOf, foeUnitNameOf, repairLedgersOf, thrusterPhase, wormholeBattleViewOf } from '@whale/core'
import type { AnomalyDef, BattleFx, BattleReportRecord, BattleVerdict, DamageType, DroneLossReport, ShipRole } from '@whale/core'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'
import { ShipSprite } from '../ui/ShipSprite'
import { FOE_ACCENT, foeFamilyOf } from '../ui/shipArt'
import { mountsOf } from '../ui/shipMounts'
import { Glyph, ICO_TONES } from '../ui/Glyphs'
import {
  DRONE_DWELL_MS,
  DRONE_SHOW_MAX,
  DRONE_SORTIE_BACK_MS,
  DRONE_SORTIE_OUT_MS,
  DRONE_FLY_MUL,
  DRONE_STYLE,
  droneArcHeight,
  droneModelOf,
  droneModelOrFallback,
  dronePathPos,
  droneRandomOffsets,
  droneStationFrom,
  droneTakeoff,
} from '../ui/droneArt'
import type { DroneModel, DroneSortie } from '../ui/droneArt'
import {
  BOLT_LOOK,
  DMG_COLOR, DMG_LABEL, DMG_ORDER, ROLE_ACCENT, LAY, sizeOfUnit, noseOf, foeBarGeom, foeHangarByTag, foeHangarTotal,
  ROW2_BAR_DROP,
  FLY_MS, BOLT_LIFE, FLASH_LIFE, BOOM_LIFE, DRONE_DOWN_LIFE,
  STAR_LAYERS, genStars, clamp01, approachOf, layout,
  fanSegs, fanPath, ringPath, HpTri, boltGeom, resolveBoltAnchors,
} from './battleViewCore'
import type { Dims, Anchor, BoltV, FlashV, Stage, OutroSnap } from './battleViewCore'
import { tr } from '../i18n/locale'

/**
 * 无人机阵位（绝对画面 px；2026-09-10 船长二次定）：
 * - 出击制（默认 `sortie`）= 飞到敌舰侧的攻击阵位开火（哨戒常驻型例外：始终随母舰下方伴飞）；
 * - 机群制（保留 `formation`）= 母舰上侧编队巡飞，弹道自编队位起飞。
 */
/**
 * 无人机停泊/编队位（绝对画面 px）——供**机群制**与**哨戒常驻型**使用：
 * 机群制 = 母舰上侧编队位；哨戒 = 母舰上方伴飞位；出击制（放飞型）由每轮的随机阵位给出（见 droneRandomOffsets）。
 */
function droneHomeStation(model: DroneModel, lane: number, lay: { me: Anchor; foe: Anchor[] }): Anchor {
  const slot = model.slots[lane % Math.max(1, Math.min(model.slots.length, DRONE_SHOW_MAX))] ?? model.slots[0]!
  return { x: lay.me.x + slot.x, y: lay.me.y + slot.y }
}

/**
 * 无人机姿态（绝对画面 px + 朝向；2026-09-10 船长"无人机移动不连贯"修复）：
 * 位置不再依赖 React 重渲染（33ms 循环仅在距离变化时才 setState → 敌舰就位后无人机只剩 10Hz 通知刷新，
 * 表现为 10fps 步进）。本函数被 **rAF 循环**直接调用，把 transform 写进 DOM → 恒定 60fps 平滑。
 */
function dronePoseAt(
  model: DroneModel,
  lane: number,
  st: DroneSortie | undefined,
  lay: { me: Anchor; foe: Anchor[] },
  elapsed: number,
): { x: number; y: number; heading: number } {
  const base = DRONE_STYLE === 'sortie' && !model.resident ? droneTakeoff(lane) : model.slots[lane % model.slots.length]!
  const baseAbs = { x: lay.me.x + base.x, y: lay.me.y + base.y }
  const arc = droneArcHeight(lane)
  const foeA = lay.foe[0] ?? lay.me
  const off = st?.offs[lane % (st.offs.length || 1)] ?? { x: 46, y: 0 }
  const station =
    DRONE_STYLE === 'sortie' && !model.resident ? droneStationFrom(foeA, 1, off) : droneHomeStation(model, lane, lay)
  if (DRONE_STYLE === 'sortie' && !model.resident) {
    if (elapsed < DRONE_SORTIE_OUT_MS) {
      const t = Math.min(1, Math.max(0, elapsed / DRONE_SORTIE_OUT_MS))
      const p = dronePathPos(t, baseAbs, station, arc, false)
      return { x: p.x, y: p.y, heading: 1 }
    }
    if (elapsed < DRONE_SORTIE_OUT_MS + DRONE_DWELL_MS) return { x: station.x, y: station.y, heading: 1 } // 到位驻留
    const t = Math.min(1, Math.max(0, (elapsed - DRONE_SORTIE_OUT_MS - DRONE_DWELL_MS) / DRONE_SORTIE_BACK_MS))
    const p = dronePathPos(t, station, baseAbs, arc, true)
    return { x: p.x, y: p.y, heading: -1 } // 返航：掉头
  }
  return { x: station.x, y: station.y, heading: 1 }
}

/** 被击落的无人机**滑向爆炸点**的时长（毫秒）。船长 2026-09-11：「**爆炸的时间点定在返航到 1/3
 *  的途中**，这样才更能看清」——击落后机体**继续朝自己的母舰方向飘 1/3 段**再炸（不是原地炸），
 *  这样爆炸点与'被打中的那一刻'分开，玩家更容易看清是哪一架没了。
 *  取值 = 返航航段（`DRONE_SORTIE_BACK_MS`）的 1/3。 */
const DRONE_DOWN_FREEZE_MS = Math.round(DRONE_SORTIE_BACK_MS / 3)

/** 击落后的**爆炸点**：从被打中的位置朝自己的母舰方向**挪 1/3 段**（船长「返航到 1/3 的途中」）。 */
function oneThirdToward(
  from: { x: number; y: number },
  home: { x: number; y: number },
): { tx: number; ty: number } {
  return {
    tx: from.x + (home.x - from.x) / 3,
    ty: from.y + (home.y - from.y) / 3,
  }
}

/** **敌机阵位**（受击增程的视觉落点）：平时 = **我舰旁**（`lay.me + off`，镜像几何）；
 *  增程触发后**沿"我舰 → 敌舰"方向外推**——外推量 = 该方向的 55%、**上限 260px**
 *  （敌舰锚点本身在画面内 ⇒ 外推后仍在可视区内，不会把机体推出战场）。
 *  ⚠ 击杀落点与实时阵位**共用本函数**（否则死亡动画会跳回未增程的位置）。 */
function foeDroneStation(
  me: Anchor,
  foeA: Anchor,
  off: { x: number; y: number },
  rangeBuff: boolean,
): { x: number; y: number } {
  const base = { x: me.x + off.x, y: me.y + off.y }
  if (!rangeBuff) return base
  const dx = foeA.x - me.x
  const dy = foeA.y - me.y
  const len = Math.hypot(dx, dy) || 1
  const step = Math.min(260, len * 0.55)
  return { x: base.x + (dx / len) * step, y: base.y + (dy / len) * step }
}

/**
 * **敌方机群姿态**（2026-09-11 机群批 S5）——我方 `dronePoseAt` 的**完整镜像**：
 * 起点 = **敌舰机库口**（`droneTakeoff` 偏移相对敌舰**水平镜像**），阵位 = **我方舰旁**（`lay.me + off`）
 * ——因为敌方机群打的是**我方舰**，锚点就是'要打的那一方'（与我方机群锚敌舰同一条口径）。
 * 朝向：出海/驻留 `heading = -1`（朝我）· 返航 `heading = +1`（掉头）。
 *
 * **受击增程**（2026-09-11 船长：「受到攻击后，大幅提高无人机射程（提高 400%）」）：
 * 触发后阵位由 `foeDroneStation` 外推 ⇒ **机体明显后撤、出击/攻击线拉长**（机群视觉上"改打远距"）。
 */
function foePoseAt(
  model: DroneModel,
  lane: number,
  st: DroneSortie | undefined,
  lay: { me: Anchor; foe: Anchor[] },
  elapsed: number,
  rangeBuff = false,
): { x: number; y: number; heading: number } {
  const foeA = lay.foe[0] ?? lay.me
  const tk = droneTakeoff(lane)
  const deck = { x: foeA.x - tk.x, y: foeA.y + tk.y }
  const off = st?.offs[lane % (st.offs.length || 1)] ?? { x: 52, y: 0 }
  const station = foeDroneStation(lay.me, foeA, off, rangeBuff)
  const arc = droneArcHeight(lane)
  if (elapsed < DRONE_SORTIE_OUT_MS) {
    const t = Math.min(1, Math.max(0, elapsed / DRONE_SORTIE_OUT_MS))
    return { ...dronePathPos(t, deck, station, arc, false), heading: -1 }
  }
  if (elapsed < DRONE_SORTIE_OUT_MS + DRONE_DWELL_MS)
    return { x: station.x, y: station.y, heading: -1 }
  const t = Math.min(
    1,
    Math.max(
      0,
      (elapsed - DRONE_SORTIE_OUT_MS - DRONE_DWELL_MS) / DRONE_SORTIE_BACK_MS,
    ),
  )
  return { ...dronePathPos(t, station, deck, arc, true), heading: 1 }
}

/**
 * 33ms 平滑循环需要的**最小战斗句柄**（结构类型：远征与洞内两种 `BattleState` 都满足；
 * 也省得把 `BattleState` 从 core 再导出一遍）。
 */
type BattleHandle = {
  startedAtGameMs: number
  /** 上一拍时刻（`thrusterPhase` 与平滑循环都读） */
  lastTickGameMs: number
  distanceM: number
  myDesireM: number
  myFleet?: Array<{ tag: string; shipId: string }>
}

export function BattleScreen({ engine, onToast, onClose }: { engine: GameEngine; onToast: ToastFn; onClose: () => void }) {
  const state = engine.state
  /** 洞内战斗视图（F2 · 2026-09-13）：有它就用它，否则照旧走远征口径 */
  const whView = wormholeBattleViewOf(state, engine.ctx)
  const view = expeditionStatus(state, engine.ctx)
  const combatView = view.combat ?? whView?.combat ?? null
  const sceneName = view.combat ? view.anomalyName : (whView?.name ?? '')
  /** 本场是不是洞内战斗（洞内**不能中途撤退**——船长第 8 条） */
  const inWormhole = !!whView && !!combatView
  /**
   * **洞内倍速控件**（2026-09-19 谜质科技「时间压缩矩阵」·解挂 `battle-speed-20260919.md`）：
   * 位置 = 战斗窗口**顶部中间、距离条上方**（船长口径）；**只显示已解锁档**，未解锁（只有 1×）⇒ 整个控件不出现。
   * 档位选择存在渲染层会话内存里（`engine.setWormholeSpeed`），引擎每拍再夹一次 ⇒ 界面传错也拿不到未解锁速度。
   */
  const speedOptions = inWormhole ? engine.wormholeSpeedOptions() : []
  const speedPick = engine.wormholeSpeedPickValue()
  const speedActive = speedPick > 1 ? speedPick : (speedOptions[speedOptions.length - 1] ?? 1)
  const arcs = battleArcsFor(
    state,
    engine.ctx,
    whView ? { battle: whView.battle, anomaly: whView.anomaly, leaderShipId: whView.leaderShipId } : null,
  )
  const battle = whView ? whView.battle : state.expedition.battle
  /**
   * 推进器周期状态（2026-09-10 船长定：点火 60 秒 / 冷却 60 秒 / 开场即点火）——与引擎同源。
   * **2026-09-14 起周期逐单位**（微型跃迁引擎 = 10 秒点火）：这一格显示**我方首舰（主控/读数锚）**的周期
   * （`arcs.thrusterCycle`），与「推进器点火中：战斗中机动 +N%」用的 `arcs.thrusterBoost` 同一个单位。
   */
  const thruster = battle ? thrusterPhase(battle, engine.ctx.balance.battle, arcs?.thrusterCycle) : null
  /** 机群池键（**`舰tag:机型`**）→ 实际架数（弹道道次必须落在"实际渲染的机体数"内；见 fx 消费处 2026-09-10 修复）。
   *  2026-09-14「逐舰机群」：由 core 视图的**逐舰**机体清单（`myUnits[].drones`）建表——此前只有主控那张。 */
  const droneCountOf = new Map<string, number>()
  for (const u of arcs?.myUnits ?? [])
    for (const d of u.drones ?? []) droneCountOf.set(`${u.tag}:${d.artId}`, d.count);
  /** 敌方机群：敌单位 tag + 机型 → **该舰现存架数**（弹道道次取模要用它；敌我各用各的表，见弹道层） */
  const foeDroneAliveOf = (tag: string, artId: string): number =>
    arcs?.foeDrones?.find((d) => d.tag === tag && d.artId === artId)?.alive ??
    1
  /** **敌机是否处于受击增程态**（2026-09-11 船长）：机体阵位与弹道**必须同源**——
   *  否则机体已后撤到远距、弹道却仍从我舰旁发出 ⇒ 船长实测「射程增加后，敌无人机的落点位置出现错位」。 */
  const foeDroneBuffedOf = (tag: string): boolean =>
    arcs?.foeDrones?.some((d) => d.tag === tag && d.rangeBuff === true) === true

  const [stage, setStage] = useState<Stage>('live')
  const [retreatAsk, setRetreatAsk] = useState(false)
  const [dragV, setDragV] = useState<number | null>(null)
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
  const meColRef = useRef<HTMLDivElement>(null)
  const foeColRef = useRef<HTMLDivElement>(null)
  /** 舰首朝向：meFlip = 我方头朝左；foeFlip = 敌方头朝左（默认相向而行：我方朝右、敌方朝左） */
  const facingRef = useRef({ meFlip: false, foeFlip: true })
  /** 已消费的最新开火事件序号（引擎事件环超 48 条会丢最旧——按序号续播而非数组下标，
   *  避免"攒满 48 条后新开火全部不再播放"（战斗超 ~60 秒动画停播 bug） */
  const fxSeqRef = useRef(0)
  const initedFxRef = useRef(false)
  const keyRef = useRef(1)
  const boltsRef = useRef<BoltV[]>([])
  const flashRef = useRef<FlashV[]>([])
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
  /** 每个机型**上一帧**渲染的机体数（击落时用它定位"本帧即将消失的末位机体"） */
  const dronePrevShowRef = useRef<Map<string, number>>(new Map())
  const visDistRef = useRef(0)
  const droneDriveRef = useRef<{
    /** 逐舰体积（px；2026-09-11 舰种体积，见上 `foeSizesFor`） */
    foeSizes: number[]
    /** 玩家舰体积（px；无人机阵位/弹道起点按它定标） */
    meSize: number
    openM: number
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
  }>({ foeSizes: [LAY.MAIN], meSize: LAY.MAIN, openM: 1, nearM: 200, wings: [], meAnchors: new Map() })
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
  const mapRef = useRef<{ openM: number; nearM: number }>({ openM: 1, nearM: 200 })

  // 滑条两端距（卸载冲刷也要用）
  if (arcs) {
    mapRef.current = { openM: arcs.openM, nearM: arcs.nearM }
  }

  // ── 阶段推进：live →（分出胜负）→ outro →（引擎结算完成）→ report ──
  useEffect(() => {
    const ended = battle?.ended ?? null
    if (stage === 'live') {
      if (ended) {
        // 引擎刚分出胜负（killcam 窗口内）：记快照，开始演出
        outroRef.current = {
          kind: ended,
          atWall: performance.now(),
          startedAtGameMs: battle!.startedAtGameMs,
          durMs: Math.max(0, battle!.lastTickGameMs - battle!.startedAtGameMs),
          meShots: battle!.stats.meShots,
          meHits: battle!.stats.meHits,
          meDmg: battle!.stats.meDmg,
          foeShots: battle!.stats.foeShots,
          foeHits: battle!.stats.foeHits,
          // 机群战损（2026-09-10）：战报弹层要显示"机群损失"行——结算后战场数据会清空，
          // 必须在分出胜负的这一刻快照下来（battleArcsFor 的 droneLost 届时已取不到）
          ...(battle!.droneLost && Object.keys(battle!.droneLost).length > 0 ? { droneLost: { ...battle!.droneLost } } : {}),
          // 虫洞战斗的用途（船长 2026-09-14：撤离战的战报不该弹——结算后 battle 清空，故此刻快照）
          // ⚠ 2026-09-15 撤离战退役 ⇒ 这一档只剩**老档**里正在打的撤离战会命中（新趟不再有）
          ...(battle!.wormhole ? { wormholeKind: battle!.wormhole.kind } : {}),
        }
        setStage('outro')
      } else if (!combatView) {
        // 未见到分出胜负战斗就结束了（离线恢复等）：直接关屏，战报看日志
        onClose()
      }
    } else if (stage === 'outro' && !combatView) {
      /**
       * **撤离战不弹战报**（船长 2026-09-14：「离开虫洞的战斗也会弹出战斗报告（这一场战斗不应该弹出）」）：
       * 那一场由虫洞的**结算单**（`run.lastSettle`）说话，战报只会把结算挡住 ⇒ 直接关屏。
       * 注意：战报**日志**照旧写在事件日志里（留档），这里只跳过弹层。
       *
       * ⚠ 2026-09-15 撤离战退役 ⇒ 这一档如今**只有老档**里正在打的撤离战会命中（新趟不再有撤离战）。
       */
      if (outroRef.current?.wormholeKind === 'extract') {
        onClose()
        return
      }
      // 引擎已结算（killcam 走完）→ 战报文本（resolve 日志已写入）
      const snap = outroRef.current
      // 机群战损结算结果（2026-09-11）：结算刚在这一刻完成，读取结构化结果；
      // 用战斗起手时刻配对，避免并行战斗（AI 副船等）的结果串场
      const dr = state.droneLossReport ?? null
      droneReportRef.current =
        dr && (!snap || dr.battleStartedAtGameMs === snap.startedAtGameMs) ? dr : null
      /**
       * **结构化战报**（2026-09-14 船长定 · 战报改造）：引擎在结算时写了一份 `state.battleReport`，
       * 弹层直接读它 —— 取代原先"在日志里找含『战报』二字的那条"（那条做法对洞内/遭遇/无法交战
       * **三类战斗全部取不到正文**，而且标题只看胜负 ⇒ 沉了船也写「大捷」）。
       * 配对口径同 `droneLossReport`：起手时刻对不上就是别的战斗写的 ⇒ 回落兜底句，绝不串场。
       */
      const br = state.battleReport ?? null
      battleReportRef.current = br && (!snap || br.battleStartedAtGameMs === snap.startedAtGameMs) ? br : null
      reportTextRef.current =
        battleReportRef.current?.summary ??
        (snap?.kind === 'me' ? tr("ui.BattleScreen.005") : tr("ui.BattleScreen.006"))
      setStage('report')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, battle?.ended, combatView === null])

  // 战报自动关闭：report 展示 20 秒后自动返回（按钮可随时提前关闭）
  // 2026-09-11 船长：「战斗报告持续时间延长」6 秒 → 12 秒；
  // 2026-09-14（战报改造）：内容又多了三行（我方损失 / 双方残余 / 弹药消耗）⇒ 12 秒 → **20 秒**
  useEffect(() => {
    if (stage !== 'report') return
    const t = window.setTimeout(() => onClose(), 20_000)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage])

  /**
   * 已被摧毁敌方单位的**进场预登记**（2026-09-10 船长："多舰船战斗时退出战斗界面再进来，
   * 已被摧毁的敌人会重新出现（血量0）"修复）：
   * deadRef/corpseAtRef 都是组件局部状态，退出战场即卸载清空；再进来时引擎里 hp 已归零的敌人
   * 会被当成存活单位重新渲染。现于**每次战斗开始（含重进战场）**按 battle.units 真值预登记：
   * 已摧毁 → 直接视为"已撤出队列"（无残骸演出登记 → 不再出队，也不会重放爆炸）。
   * 同时清空血量缓存并重置首帧标记，避免把"进场时的既成伤亡"误判成本帧新阵亡。
   */
  useEffect(() => {
    // ⚠ 2026-09-14 修：此前写死 `engine.state.expedition.battle` ⇒ **洞内那场恒为 null**，
    //   预登记整段不跑 ⇒ 洞内"退出战斗界面再进来，血量 0 的敌人重新出现"（2026-09-10 修过的同款
    //   BUG 当年只在洞外修好）。现取**本场已解析的 `battle`**（远征 or 洞内）。
    const b = battle
    if (!b) return
    deadRef.current = new Set(
      Object.values(b.units)
        .filter((u) => u.side === 'foe' && u.hp.s + u.hp.a + u.hp.h <= 0)
        .map((u) => u.tag),
    )
    corpseAtRef.current.clear()
    prevHpRef.current.clear()
    hpInitRef.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle?.startedAtGameMs])

  // 星空视差速率：基准 = 驾驶船基础战斗速度（装配/技能静态）——每帧再按推进器点火态放大（见 33ms 循环）
  useEffect(() => {
    // ⚠ 2026-09-14 修：同上，洞内战里这里恒早退 ⇒ 星场基准速度一直停在缺省值。
    //   锚船与 33ms 循环**同一口径**（洞内 = 编队首舰）。
    if (!battle) return
    const anchorId = battle.myFleet?.[0]?.shipId ?? engine.state.shipId
    const spec = createPlayerSpec(engine.state, engine.ctx, anchorId)
    meSpeedRef.current = spec?.speedMps ?? 200
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle?.startedAtGameMs])

  // 视觉插值：引擎每 ~100ms 一拍；本循环 33ms 在两拍间线性插值，舰列/弧/游标平滑移动
  // ⚠ **句柄取 `battleRef`（远征 or 洞内）**：原先写死 `engine.state.expedition.battle` ⇒
  //   洞内那场在这里恒为 null，插值整段不跑 ⇒ 船每 100ms 才动一次（船长"移动有顿挫感，不顺滑"）。
  useEffect(() => {
    const iv = window.setInterval(() => {
      const b = battleRef.current
      const now = performance.now()
      if (!b) return
      // **换了战斗**（开战/换节点/换层）：清视觉账本，并同步星场速率的基准船速（洞内 = 编队首舰）
      if (b.startedAtGameMs !== battleStartRef.current) {
        battleStartRef.current = b.startedAtGameMs
        moveSnapRef.current = { prev: null, cur: null }
        visDistRef.current = 0
        corpseAtRef.current.clear()
        prevHpRef.current.clear()
        hpInitRef.current = false
        const anchorId = b.myFleet?.[0]?.shipId ?? engine.state.shipId
        const spec = createPlayerSpec(engine.state, engine.ctx, anchorId)
        meSpeedRef.current = spec?.speedMps ?? 200
      }
      const s = moveSnapRef.current
      if (!s.cur || s.cur.m !== b.distanceM) {
        if (s.cur && s.cur.m !== b.distanceM) s.prev = s.cur
        else s.prev = null
        s.cur = { m: b.distanceM, w: now }
      }
      let vis = s.cur.m
      if (s.prev && s.cur.m !== s.prev.m) {
        const t = clamp01((now - s.cur.w) / 100)
        vis = s.prev.m + (s.cur.m - s.prev.m) * t
      }
      visDistRef.current = vis // 供无人机 rAF 驱动使用（与舰列/弧同一插值距离）
      /* 列宽核对（~330ms 一次）：编队数量变化会改变敌列 DOM 宽度，若不重测则锚点偏移、
         弹道落点偏右（2026-09-10 船长"击毁小型敌人后无人机落弹位置有误"）。放在本循环而非
         useEffect，是因为渲染体在 `!view.combat` 时会提前 return，守卫之后不得再出现 hook。 */
      if (++widthCheckRef.current >= 10) {
        widthCheckRef.current = 0
        const fw = foeColRef.current?.offsetWidth
        const mw = meColRef.current?.offsetWidth
        if ((fw && Math.abs(fw - dimsRef.current.foeW) > 2) || (mw && Math.abs(mw - dimsRef.current.meW) > 2)) {
          measureRef.current()
        }
      }
      setSmoothM((old) => (old === null || Math.abs(old - vis) >= 0.05 ? vis : old))

      // ── 背景视差滚动（2026-09-05 船长规则）：玩家前进（船向右、朝敌接近）→ 星空向左流；
      // 后退（想拉开、船向左退）→ 星空向右流。速度与「驾驶船战斗速度」挂钩（技能已折算）——
      // 2026-09-10 推进器周期化后：点火期额外乘爆发倍率（星空跑得更快 = 加速的直观反馈）。
      const st = starStateRef.current
      const gap = b.myDesireM - b.distanceM // <0 = 想接近（前进/向右）；>0 = 想拉开（后退/向左）
      if (Math.abs(gap) > 2) st.dir = gap < 0 ? 1 : -1 // +1 = 星空向左流 / −1 = 向右流
      const boostNow = thrusterPhase(b, engine.ctx.balance.battle, thrusterCycleRef.current).boosting
        ? thrusterBoostRef.current
        : 0
      const vMag = Math.min(320, 40 + meSpeedRef.current * (1 + boostNow) * 0.32) // 40px/s 底速 + 船速比例
      const target = st.dir * vMag
      st.v += (target - st.v) * 0.12 // 速度连续渐变
      const offs = starOffRef.current
      const W = Math.max(1, dimsRef.current.W)
      for (let i = 0; i < STAR_LAYERS.length; i++) {
        offs[i] = (offs[i] + st.v * STAR_LAYERS[i].mult * 0.033) % W
        if (offs[i] < 0) offs[i] += W
        const el = starLayerRefs.current[i]
        if (el) el.style.transform = `translate3d(${-offs[i].toFixed(1)}px, 0, 0)`
      }
    }, 33)
    return () => window.clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* 无人机位置驱动（rAF，恒定 60fps；与 React 重渲染节奏解耦） */
  useEffect(() => {
    let alive = true
    let raf = 0
    const drive = (): void => {
      if (!alive) return
      const d = droneDriveRef.current
      if (d.wings.length > 0) {
        const layLoop = layout(dimsRef.current, d.foeSizes, visDistRef.current, d.openM, d.nearM, d.meSize)
        const box = droneBoxRef.current
        const w0 = droneWritesRef.current
        if (box) {
          const tb = `translate3d(${layLoop.me.x.toFixed(1)}px, ${layLoop.me.y.toFixed(1)}px, 0)`
          if (w0.get('@box') !== tb) {
            box.style.transform = tb
            w0.set('@box', tb)
          }
        }
        const nowMs = performance.now()
        for (const w of d.wings) {
          if (w.deck) continue // 收舱（display:none）不写位置
          const elapsed = w.st ? nowMs - w.st.startAt : Number.POSITIVE_INFINITY
          /**
           * **逐舰锚**（2026-09-14「逐舰机群」）：僚舰的机群挂在自己舰位旁 ⇒ 姿态按**该舰**的布局算
           * （把 `me` 换成该舰锚，敌侧锚沿用同一份）。主控那条 = 旧口径的 `layLoop`（逐像素不变）；
           * 外层盒子的平移仍以主控锚为基准（机体坐标是相对主控锚的差值）。
           */
          const own = w.owner && w.owner !== 'player' ? d.meAnchors.get(w.owner) : undefined
          const layW = own ? { foe: layLoop.foe, me: own } : layLoop
          for (let i = 0; i < w.show; i++) {
            const key = w.foe
              ? `foe:${w.foe}:${w.artId}|${i}`
              : `${w.key ?? w.artId}|${i}`
            const el = droneElsRef.current.get(key)
            if (!el) continue
            const pose = w.foe
              ? foePoseAt(w.model, i, w.st, layLoop, elapsed, w.rangeBuff === true)
              : dronePoseAt(w.model, i, w.st, layW, elapsed)
            const t = `translate3d(${(pose.x - layLoop.me.x).toFixed(1)}px, ${(pose.y - layLoop.me.y).toFixed(1)}px, 0) translate(-50%, -50%) scaleX(${pose.heading})`
            if (w0.get(key) !== t) {
              el.style.transform = t
              w0.set(key, t)
            }
          }
        }
      }
      raf = window.requestAnimationFrame(drive)
    }
    raf = window.requestAnimationFrame(drive)
    return () => {
      alive = false
      window.cancelAnimationFrame(raf)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 尺寸测量（列宽由固定内容决定；窗口变化只影响 lane 宽）
   *  2026-09-10：列宽会随编队数量变化（击毁僚舰/波次增援），故除 resize 外由 33ms 循环按需重测 */
  useEffect(() => {
    const measure = (): void => {
      const lane = laneRef.current
      if (!lane) return
      const next: Dims = {
        W: lane.clientWidth || 1200,
        H: lane.clientHeight || 460,
        meW: meColRef.current?.offsetWidth || 330,
        foeW: foeColRef.current?.offsetWidth || 330,
      }
      setDims((d) =>
        d.W === next.W && d.H === next.H && d.meW === next.meW && d.foeW === next.foeW ? d : next,
      )
    }
    measureRef.current = measure
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  // 卸载 / 切出前冲刷未提交的滑条
  useEffect(() => {
    return () => {
      if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current)
      const v = dragValRef.current
      const m = mapRef.current
      if (v !== null && m.openM > 1) {
        engine.battleSetDesireAt(Math.round(m.openM - (v / 1000) * (m.openM - m.nearM)))
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ═══════════ 战报弹层（stage = report：引擎已结算返航，战场数据已清空） ═══════════ */
  if (stage === 'report') {
    const snap = outroRef.current
    const droneReport = droneReportRef.current
    const br = battleReportRef.current
    const won = snap?.kind === 'me'
    const durSec = Math.max(1, Math.round((snap?.durMs ?? 0) / 1000))
    const fallback = won ? tr("ui.BattleScreen.007") : tr("ui.BattleScreen.008")
    /**
     * **判定四档**（2026-09-14 船长定）：胜且**零沉船、机群无损**才是「大捷」；有损失 ⇒ 「惨胜」；
     * 负 ⇒ 「失利」；没分出胜负就收场（结构撤退/超时/无法交战/主动撤退）⇒ 「脱离」。
     * 判定由 core 的纯函数出（`battleVerdictOf` ⇒ 它进得了用例）；这里只管文案与配色。
     * ⚠ 取不到记录（老档/配对不上）时**回落旧口径**（只看胜负），行为与改造前一致。
     */
    const verdict: BattleVerdict = br ? battleVerdictOf(br) : won ? 'great' : 'defeat'
    const lostN = br?.shipsLost.length ?? 0
    const titleOf: Record<BattleVerdict, string> = {
      great: tr("ui.BattleScreen.009"),
      // 「惨胜」沿用**胜色**（金色），只在标题里带上损失数 —— 不新增一档配色（船长 2026-09-14 批准）
      pyrrhic: `⚔ 惨胜（损失 ${lostN} 艘）`,
      defeat: tr("ui.BattleScreen.010"),
      break: tr("ui.BattleScreen.011"),
    }
    const isWinSide = verdict === 'great' || verdict === 'pyrrhic'
    /** 三层残余一行：`长尾鲨 盾 1240/1240 · 甲 860/860 · 结构 420/420`（多舰用「 ｜ 」连） */
    const myUnitsText = br
      ? br.myUnits.map((u) => `${u.name} 盾 ${Math.round(u.s)}/${Math.round(u.sMax)} · 甲 ${Math.round(u.a)}/${Math.round(u.aMax)} · 结构 ${Math.round(u.h)}/${Math.round(u.hMax)}`).join(' ｜ ')
      : ''
    const foeText = br
      ? br.foe.alive <= 0
        ? `敌方 全灭（共 ${br.foe.total} 艘）`
        : `敌方 存活 ${br.foe.alive}/${br.foe.total} · 残余血量 ${Math.round(br.foe.hpFrac * 100)}%`
      : ''
    /** 弹药消耗一行：0 的弹种不列；全 0 ⇒ 这一行整行不显示（没开过火就别占版面） */
    const ammoSeg = br
      ? ([
          [tr("ui.BattleScreen.002"), br.ammoUsed.kin],
          [tr("ui.BattleScreen.012"), br.ammoUsed.exp],
          [tr("ui.BattleScreen.013"), br.ammoUsed.pla],
        ] as const)
          .filter(([, n]) => n > 0)
          .map(([label, n]) => `${label} ×${n}`)
          .join(' · ')
      : ''
    return (
      <div className="app-battle-screen is-report">
        <div className="app-bts-report">
          <div className={`app-bts-report-card${isWinSide ? " is-win" : " is-lose"}`}>
            <div className="app-bts-report-title">{titleOf[verdict]}</div>
            <div className="app-bts-report-text">
              {reportTextRef.current || fallback}
            </div>
            {snap ? (
              <div className="app-bts-report-stats">
                {tr("ui.BattleScreen.014")} {snap.meShots} {tr("ui.BattleScreen.015")} {snap.meHits} · 造成伤害{' '}
                {Math.round(snap.meDmg).toLocaleString('zh-CN')} · 敌方开火{' '}
                {snap.foeShots} {tr("ui.BattleScreen.015")} {snap.foeHits} · 交火 {durSec}s
              </div>
            ) : null}
            {/* **我方损失**（2026-09-14 船长定：新增三行之一）——这条正是"损失了舰船也显示大捷"的正身 */}
            {br && lostN > 0 ? (
              <div className="app-bts-report-stats is-loss">
                {tr("ui.BattleScreen.016")}{br.shipsLost.join(tr("ui.MatterTechTab.017"))}（{lostN} {tr("ui.BattleScreen.017")}
              </div>
            ) : null}
            {/* **双方残余**（新增三行之二）：逐舰 盾/甲/结构（当前/上限）+ 敌方残余 */}
            {myUnitsText ? <div className="app-bts-report-stats">{tr("ui.BattleScreen.018")} {myUnitsText} ｜ {foeText}</div> : null}
            {/* **敌方挂载件**（2026-09-16 船长「要：敌舰悬停/战报展示挂载件」）——没挂件就整行不显示 */}
            {br && br.foeMounts && br.foeMounts.length > 0 ? (
              <div className="app-bts-report-stats">{tr("ui.BattleScreen.019")}{br.foeMounts.join(tr("ui.MatterTechTab.017"))}</div>
            ) : null}
            {/* **弹药消耗**（新增三行之三）：按弹种；0 的弹种不列 */}
            {ammoSeg ? <div className="app-bts-report-stats">{tr("ui.BattleScreen.020")}{ammoSeg}</div> : null}
            {/* 机群战损（2026-09-11 船长：优先回收高价值 + 在战报里显示）：
                第一行 = 汇总（损坏 / 回收归队 / 净损失），第二行 = 逐型明细（回收 ｜ 净损失，按机型价值降序） */}
            {droneReport ? (
              <>
                <div className="app-bts-report-stats is-loss">
                  {tr("ui.BattleScreen.021")} {droneReport.total} {tr("ui.BattleScreen.022")}{' '}
                  {droneReport.recovered} {tr("ui.BattleScreen.023")}{' '}
                  {Math.round(droneReport.rate * 100)}% · 优先回收高价值）·
                  净损失 {droneReport.gone} 架
                </div>
                <div className="app-bts-report-stats is-loss">
                  {tr("ui.BattleScreen.024")}
                  {droneReport.rows
                    .filter((r) => r.back > 0)
                    .map((r) => `${r.name}×${r.back}`)
                    .join(tr("ui.MatterTechTab.017")) || tr("ui.BattleScreen.001")}
                  {' ｜ '}{tr("ui.BattleScreen.025")}
                  {droneReport.rows
                    .filter((r) => r.gone > 0)
                    .map((r) => `${r.name}×${r.gone}`)
                    .join(tr("ui.MatterTechTab.017")) || tr("ui.BattleScreen.001")}
                  {tr("ui.BattleScreen.026")}
                </div>
              </>
            ) : snap?.droneLost && Object.keys(snap.droneLost).length > 0 ? (
              <div className="app-bts-report-stats is-loss">
                {tr("ui.BattleScreen.027")}
                {Object.entries(snap.droneLost)
                  .map(([artId, n]) => `${droneModelOf(artId)?.name ?? artId} ×${n}`)
                  .join(tr("ui.MatterTechTab.017"))}
                {tr("ui.BattleScreen.026")}
              </div>
            ) : null}
            <div className="app-bts-report-note">{tr("ui.BattleScreen.028")}</div>
            <button className="app-btn" onClick={onClose}>
              {tr("ui.BattleScreen.029")}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!combatView || !battle || !arcs) return null
  // 交给 33ms 平滑循环（每渲染同步一次句柄；`dimsRef` 同款模式）
  battleRef.current = battle
  const combat = combatView
  const openM = arcs.openM
  const nearM = arcs.nearM

  // 首帧不重放历史开火事件：只从"当前环尾"续播（迟到进战场不补播旧弹道）；
  // 无历史时置 -1——引擎每场战斗首发的 seq=0，若按 0 初始化会被 seq>0 过滤吞掉
  // （2026-09-05 修复“导弹第一次攻击没有动画”：旧实现里首发发生在画面弹出前的隐藏秒，
  // 从未被看见；开场缓冲拉开后首发成为可见第一发，序号断层立刻显形）
  if (!initedFxRef.current) {
    const tail = battle.fx.length > 0 ? battle.fx[battle.fx.length - 1] : undefined
    fxSeqRef.current = tail ? tail.seq : -1
    initedFxRef.current = true
  }

  const meShip = fleetDefOf(state, engine.ctx, state.shipId)
  const meRole: ShipRole = meShip?.role ?? 'industrial'
  const foeTags = Object.keys(combat.foeHp)
  /** 存活敌舰（血条/命中对象用；与视觉行 foeRowTags 不同——视觉行含演出期尸骸占位） */
  const foeAliveTags = foeTags.filter((t) => !deadRef.current.has(t))
  // 2026-09-09 多波修复：主/僚判定不靠"队列首位"——多波多小队的主舰 tag 为 w{n}-foe-{k}
  // （旧判定把第 2 艘主舰当僚机：小尺寸 + 僚机字样）；判定与引擎同源（core foeMainTagOf）
  const isFoeMainTag = foeMainTagOf
  /**
   * **敌卡 = 本场战斗的那张卡**（2026-09-14 修船长报障「虫洞内的战斗，敌方舰船动画不对 /
   * **敌方的战斗动画图形和敌族对不上** / 战斗开始位置似乎不对」）：
   * 取卡单点在 core `battleFoeAnomaly`（洞内 = 按层派生卡，洞外 = 远征卡）。
   * 此前这里只认 `state.expedition.anomalyId` ⇒ **洞内恒取不到敌卡**，三个下游一起错：
   *   ① `foeKey = foeFamilyOf(undefined)` ⇒ 兜底族 **A 海盗**（洞里 C/D/E/G 族全画成海盗舰体/动画）
   *      ⇒ **图形与敌族对不上**；
   *   ② `foeShipTierOf` 拿不到舰种档 ⇒ `sizeOfUnit(null)` 回落 170/90（舰种体积阶梯在洞内失效）；
   *   ③ 而 `foeSizes` 又喂给 `layout()`（锚点跟实际舰宽、机位/排布/米制跨度 `usable` 全由它推）
   *      ⇒ **敌方舰船体积与机位整体偏**，看起来就是"开局位置不对"。
   */
  const foeAnomaly = battleFoeAnomaly(state, engine.ctx)
  /** 逐舰体积（px）：玩家舰 = `ShipDef.tier`；敌舰 = 编成条目所引舰级的 `hullClassTier`。
   *  舰级路径卡以外的旧卡无舰种档 → 回落改造前的 170/90（船长 2026-09-11：这批延后）。 */
  const meSize = sizeOfUnit(meShip?.tier, false)
  const foeSizeOf = (tag: string): number =>
    sizeOfUnit(foeAnomaly ? foeShipTierOf(foeAnomaly, tag) : null, !isFoeMainTag(tag))
  /** 视觉行逐舰体积；全灭瞬间仍保留 1 槽（与改造前 `Math.max(1, n)` 同语义：布局不退化） */
  const foeSizesFor = (tags: readonly string[]): number[] =>
    tags.length ? tags.map(foeSizeOf) : [LAY.MAIN]
  /** 敌舰族形键（2026-09-11 起 = 数据侧 `AnomalyDef.foeFamily`；未列卡/异常 → F 制式巡逻兜底） */
  const foeKey = foeFamilyOf(foeAnomaly)
  /** 敌舰显示名（2026-09-09 命名统一：引擎同源推导——舰种名 + 规格词缀，弱规格 = 轻装 X；
   *  异常记录缺失时回退档内单位名/tag——旧档存档字符串不直接参与显示） */
  const foeNameOf = (tag: string): string =>
    foeAnomaly ? foeUnitNameOf(foeAnomaly, tag) : (combat.foeHp[tag]?.name ?? tag)
  const ended = battle.ended !== null
  const defeat = battle.ended === 'foe'

  const realDist = battle.distanceM // 引擎实时距离（交火中每 ~100ms 更新）
  const visM = smoothM !== null ? smoothM : realDist // 视觉插值距离（舰列/弧/游标平滑用）
  const now = performance.now()
  const pct = (m: number): number => approachOf(m, openM, nearM) * 100

  /* ── 敌方"视觉行"与演出期尸骸（2026-09-09 二轮，船长反馈"切换突兀/爆炸未播完/边爆边换位"）：
     尸骸不撤队、原位占槽演完整段（boomAt 前原样停留 → boomAt 起灰化 + 爆炸环 → 淡出）；
     撤出只允许"淡出完成且该尸骸右侧（种子序更靠后）无仍在演出的尸骸"——整批尸骸演完才
     一起收拢一次，存活舰补位不再压着爆炸动画走。几何/弹道按视觉行序（含占位尸骸）计算。 */
  const WRECK_FADE_MS = 520 // 尸骸灰舰淡出时长（爆炸环演出期结束后的收尾段）
  const scanDroppable = (): Set<string> => {
    const drop = new Set<string>()
    let laterVisible = false
    for (let i = foeTags.length - 1; i >= 0; i--) {
      const tag = foeTags[i]!
      if (!deadRef.current.has(tag)) continue
      const ba = corpseAtRef.current.get(tag)
      if (ba === undefined) {
        drop.add(tag) // 无演出登记（已撤/开屏前已死）：永不占位
        continue
      }
      if (now < ba + BOOM_LIFE + WRECK_FADE_MS) laterVisible = true
      else if (!laterVisible) drop.add(tag)
    }
    return drop
  }
  const dropNow = scanDroppable()
  const rowFxTags = foeTags.filter((t) => !deadRef.current.has(t) || !dropNow.has(t))
  /* ── 我方逐舰几何（**必须先于弹道几何算**：2026-09-13 起弹道按发射舰取锚点，见下方 `meAnchorByTag`） ──
     · `multiMe`：单船路径 = false（观感与旧版逐像素一致）；多舰路径 = true（洞内 4 舰）。
     · `mySizes`：逐舰落画体积（阵位序 = core 给的顺序，**主控在前**）。 */
  const multiMe = arcs.myUnits.length > 1
  const mySizes = multiMe
    ? arcs.myUnits.map((u) => sizeOfUnit(fleetDefOf(state, engine.ctx, u.shipId)?.tier, false))
    : [meSize]
  // 弹道瞄准用的几何（按上一帧撤出结果的视觉行；本帧渲染队列在阵亡检测后定稿重算）
  // **多舰路径也要喂我方逐舰体积**（2026-09-13 修"弹道统一从第一艘出"）：否则 `layFx.my` 只有主控一条，
  // 我方每一发都从主控炮口飞出去（船长实测："多船战斗时弹道变成统一由第一艘船射出"）。
  const layFx = layout(dims, foeSizesFor(rowFxTags), visM, openM, nearM, meSize, multiMe ? mySizes : undefined)
  /**
   * **我方逐舰锚点/体积按 tag 索引**（多舰路径）——开火事件 `fx.tag` 就是发射舰（`player` / `ally-N`），
   * 弹道起点取"那一艘"的锚点与舰体尺寸；单船路径为空表 ⇒ 全部回落到 `layFx.me`（观感与旧版逐像素一致）。
   * 无人机（`src='drone'`）例外：机群池按**编队首舰**建（见 D 批边界），其弹道仍从主控一侧起飞。
   */
  const meAnchorByTag = new Map<string, typeof layFx.me>()
  const meSizeByTag = new Map<string, number>()
  if (multiMe) {
    arcs.myUnits.forEach((u, slot) => {
      const a = layFx.my[slot]
      if (a) meAnchorByTag.set(u.tag, a)
      const sz = mySizes[slot]
      if (sz !== undefined) meSizeByTag.set(u.tag, sz)
    })
  }
  /** 无人机攻击阵位外推量（2026-09-11 舰种体积配套）：阵位基线按改造前的敌舰（T3 = 170px 宽）定，
   *  目标舰更大时阵位同步外推，避免机群压在放大的舰体上；敌舰未变大时不内收（下限 0）。 */
  const droneOutward = Math.max(0, Math.round(((layFx.sizes[0] ?? LAY.MAIN) - LAY.MAIN) / 2))

  /* ── 舰首朝向 = 机动意图（各自"想接近还是想拉开"），而非实际位移：
       拔河中即使被拖退也保持"想接近"的冲顶姿态；到达期望距离（差 <2m）保持现状，对峙不抖动 ── */
  const myGap = combat.myDesireM - realDist
  const foeGap = arcs.foeDesireM - realDist
  if (myGap > 2) facingRef.current.meFlip = true // 我方想拉开 → 掉头背向
  else if (myGap < -2) facingRef.current.meFlip = false // 我方想接近 → 船头朝敌
  if (foeGap > 2) facingRef.current.foeFlip = false // 敌想拉开 → 掉头背向
  else if (foeGap < -2) facingRef.current.foeFlip = true // 敌想接近 → 船头朝我
  const { meFlip, foeFlip } = facingRef.current

  /* ── 消费新到达的开火事件（按序号取 seq > lastSeq 的新事件，同帧转弹道 + 闪光；
        环裁剪丢旧事件不影响：序号跳跃即自动跳过丢失部分） ── */
  const arrivals = battle.fx.filter((f) => f.seq > fxSeqRef.current)
  if (arrivals.length > 0) {
    // 本帧各机型的"击落落点游标"：同一拍被打掉两架时逐架往前取位（不叠在同一处）
    const downCursor = new Map<string, number>()
    for (const fx of arrivals) {
      fxSeqRef.current = fx.seq
      /**
       * 机群被点防击落（2026-09-10 点防上线）：这条事件**不是开火**——引擎在打空一架时推
       * src='drone' + droneDown 的 fx（见 combat.resolvePointDefense）。此处必须提前拦下：
       * ① 不画弹道、不打命中闪光（否则会在母舰与敌舰之间画出一道不存在的射击）；
       * ② 登记坠落演出——落点取"本帧即将消失的那一架"：引擎的存活架数已经减 1，
       *    渲染层机体数随之减 1，消失的正是上一帧的末位机体（dronePrevShowRef）。
       */
      if (fx.droneDown) {
        const model = droneModelOf(fx.artId)
        if (model) {
          const artId = fx.artId!
          // ⚠ 布局调用统一为**主树新签名**（2026-09-11 舰种体积 + 2026-09-12 斜向菱形：逐舰体积 `foeSizes` /
          //   阵形由 `layout` 内部按体积推导 / 玩家舰体积 `meSize`）——合并时以主树签名为准。
          const layDown = layout(dims, foeSizesFor(rowFxTags), visDistRef.current, openM, nearM, meSize)
          // **敌机被击落**（2026-09-11 修）：引擎打空一架时也推 droneDown（`side='foe'`）——
          // 但落点必须用**敌机自己**的状态表与姿态函数；旧口径一律走我方 `droneSortieRef` +
          // `dronePoseAt` ⇒ 敌机的爆炸被画到**我方机体那一侧**（船长实测："完全无法察觉"）。
          // lane 取该舰**现存架数**（引擎已减 1，故它就是"刚消失那一架"的位次）。
          if (fx.side === 'foe') {
            // **死亡点不再随相位漂移**（船长 2026-09-11：「敌机**死亡位置**飘忽不定，爆炸动画跟着敌机位置」）：
            // 旧口径连**死亡点**都取"渲染层自己以为的那一轮相位" ⇒ 那一击若落在**收舱段**，
            // 姿态就等于停在敌舰机库口（表现为"刚出机库就炸"）。
            // 现：**起点**仍取它**当时真实所在**（不跳），**终点固定**在「从攻击阵位（您舰旁）
            // 往敌舰机库口返航 1/3 处」⇒ 机体从真实位置滑到那个固定点再炸，位置每次都一致。
            const st = foeSortieRef.current.get(`${fx.tag}:${artId}`)
            const elapsed = st ? now - st.startAt : Number.POSITIVE_INFINITY
            const alive =
              arcs?.foeDrones?.find(
                (w) => w.tag === fx.tag && w.artId === artId,
              )?.alive ?? 0
            const rangeBuff =
              arcs?.foeDrones?.find(
                (w) => w.tag === fx.tag && w.artId === artId,
              )?.rangeBuff === true
            const lane = Math.max(0, Math.min(alive, DRONE_SHOW_MAX - 1))
            const pose = foePoseAt(model, lane, st, layDown, elapsed, rangeBuff)
            const off = st?.offs[lane % Math.max(1, st.offs.length)] ?? {
              x: 52,
              y: 0,
            }
            // ⚠ 与实时阵位**同源**（增程态下不能跳回"我舰旁"）
            const station = foeDroneStation(
              layDown.me,
              layDown.foe[0] ?? layDown.me,
              off,
              rangeBuff,
            )
            const tk = droneTakeoff(lane)
            const home = {
              x: (layDown.foe[0]?.x ?? layDown.me.x) - tk.x,
              y: (layDown.foe[0]?.y ?? layDown.me.y) + tk.y,
            }
            droneDownRef.current.push({
              key: keyRef.current++,
              artId,
              x: pose.x,
              y: pose.y,
              ...oneThirdToward(station, home),
              born: now,
              foe: true,
            })
          } else {
            /** **我方**机群：键一律走 `舰tag:机型`（2026-09-14「逐舰机群」——僚舰的机体也在这层，
             *  击落演出必须找到**它自己那条舰**的机体位次） */
            const meKey = `${fx.tag ?? 'player'}:${artId}`
            const prevShow =
              downCursor.get(meKey) ?? dronePrevShowRef.current.get(meKey) ?? 1
            const lane = Math.max(0, Math.min(prevShow, DRONE_SHOW_MAX) - 1)
            downCursor.set(meKey, lane)
            const st = droneSortieRef.current.get(meKey);
            // **爆炸点与相位无关**（同上，我方一侧对称）：固定取「从攻击阵位（敌舰旁）
            // 往我舰机库口返航 1/3 处」，不随"当前轮次相位"漂移。
            const off = st?.offs[lane % Math.max(1, st.offs.length)] ?? {
              x: 46,
              y: 0,
            }
            const foeA = layDown.foe[0] ?? layDown.me
            const station = { x: foeA.x - off.x, y: foeA.y + off.y }
            const tk = droneTakeoff(lane)
            const home = { x: layDown.me.x + tk.x, y: layDown.me.y + tk.y }
            droneDownRef.current.push({
              key: keyRef.current++,
              artId,
              x: station.x,
              y: station.y,
              ...oneThirdToward(station, home),
              born: now,
            })
          }
          // **敌机被击落**（2026-09-11 修）：引擎打空一架时也推 droneDown（`side='foe'`）——
          // 但落点必须用**敌机自己**的状态表与姿态函数；旧口径一律走我方 `droneSortieRef` +
          // `dronePoseAt` ⇒ 敌机的爆炸被画到**我方机体那一侧**（船长实测："完全无法察觉"）。
          // lane 取该舰**现存架数**（引擎已减 1，故它就是"刚消失那一架"的位次）。
          if (fx.side === 'foe') {
            // **死亡点不再随相位漂移**（船长 2026-09-11：「敌机**死亡位置**飘忽不定，爆炸动画跟着敌机位置」）：
            // 旧口径连**死亡点**都取"渲染层自己以为的那一轮相位" ⇒ 那一击若落在**收舱段**，
            // 姿态就等于停在敌舰机库口（表现为"刚出机库就炸"）。
            // 现：**起点**仍取它**当时真实所在**（不跳），**终点固定**在「从攻击阵位（您舰旁）
            // 往敌舰机库口返航 1/3 处」⇒ 机体从真实位置滑到那个固定点再炸，位置每次都一致。
            const st = foeSortieRef.current.get(`${fx.tag}:${artId}`)
            const elapsed = st ? now - st.startAt : Number.POSITIVE_INFINITY
            const alive =
              arcs?.foeDrones?.find(
                (w) => w.tag === fx.tag && w.artId === artId,
              )?.alive ?? 0
            const rangeBuff =
              arcs?.foeDrones?.find(
                (w) => w.tag === fx.tag && w.artId === artId,
              )?.rangeBuff === true
            const lane = Math.max(0, Math.min(alive, DRONE_SHOW_MAX - 1))
            const pose = foePoseAt(model, lane, st, layDown, elapsed, rangeBuff)
            const off = st?.offs[lane % Math.max(1, st.offs.length)] ?? {
              x: 52,
              y: 0,
            }
            // ⚠ 与实时阵位**同源**（增程态下不能跳回"我舰旁"）
            const station = foeDroneStation(
              layDown.me,
              layDown.foe[0] ?? layDown.me,
              off,
              rangeBuff,
            )
            const tk = droneTakeoff(lane)
            const home = {
              x: (layDown.foe[0]?.x ?? layDown.me.x) - tk.x,
              y: (layDown.foe[0]?.y ?? layDown.me.y) + tk.y,
            }
            droneDownRef.current.push({
              key: keyRef.current++,
              artId,
              x: pose.x,
              y: pose.y,
              ...oneThirdToward(station, home),
              born: now,
              foe: true,
            })
          } else {
            /** **我方**机群：键一律走 `舰tag:机型`（2026-09-14「逐舰机群」——僚舰的机体也在这层，
             *  击落演出必须找到**它自己那条舰**的机体位次） */
            const meKey = `${fx.tag ?? 'player'}:${artId}`
            const prevShow =
              downCursor.get(meKey) ?? dronePrevShowRef.current.get(meKey) ?? 1
            const lane = Math.max(0, Math.min(prevShow, DRONE_SHOW_MAX) - 1)
            downCursor.set(meKey, lane)
            const st = droneSortieRef.current.get(meKey);
            // **爆炸点与相位无关**（同上，我方一侧对称）：固定取「从攻击阵位（敌舰旁）
            // 往我舰机库口返航 1/3 处」，不随"当前轮次相位"漂移。
            const off = st?.offs[lane % Math.max(1, st.offs.length)] ?? {
              x: 46,
              y: 0,
            }
            const foeA = layDown.foe[0] ?? layDown.me
            const station = { x: foeA.x - off.x, y: foeA.y + off.y }
            const tk = droneTakeoff(lane)
            const home = { x: layDown.me.x + tk.x, y: layDown.me.y + tk.y }
            droneDownRef.current.push({
              key: keyRef.current++,
              artId,
              x: station.x,
              y: station.y,
              ...oneThirdToward(station, home),
              born: now,
            })
          }
        }
        continue
      }
      // V18B（2026-09-05 修复）+ 2026-09-09 二轮：弹道按 fx.to（目标 tag）定位并按"视觉行序"
      // 取位（含演出期尸骸占位）——随机目标下每发飞向各自目标，不受队列撤出/补位影响
      const isMeShot = fx.side === 'me'
      /**
       * ⚠ **2026-09-14 船长报障修复：「多对多战斗里，敌方的弹道依旧瞄准我方最右上角的舰船」**。
       *
       * 旧代码敌方那一支写的是 `src = layFx.foe[aimRowIdx]` + `dst = layFx.me`，两处都塌了：
       * ① `aimRowIdx` 是**拿我方 tag 去查 `rowFxTags`（只含敌方 tag）** ⇒ 恒 `-1` ⇒ 起点塌成 `foe[0]`
       *    （**不是实际开火的那艘敌舰**）；② 落点**写死成 `layFx.me`**（我方主控锚）⇒ 敌方每一发都飞向主控
       *    —— 画面里就是"最右上角那艘"。引擎侧一直是对的（`to: gtgt.spec.tag`，每发开火前重选靶），
       *    所以这是**纯演出层的坐标解析 bug**。
       * 现把解析抽成纯函数 `resolveBoltAnchors`（`battleViewCore` · **两侧对称**：起点 = 实际开火的舰、
       * 落点 = 被瞄准的舰），并由正式工具 `npm run battle:bolt` 做回归守卫。
       */
      const aimTag = isMeShot ? (fx.to ?? foeAliveTags[0]) : fx.to ?? 'player'
      const aimRowIdx = rowFxTags.indexOf(aimTag)
      /** **发射舰**（我方多舰路径按 `fx.tag` 取该舰锚点）——见上方 meAnchorByTag。
       *  ⚠ 2026-09-14「逐舰机群」起**无人机也按发射舰取锚**（fx.tag = 该架所属舰；主控那条仍是 `player`
       *  ⇒ 单船/主控路径逐像素不变）。此前无人机一律回落主控锚 ⇒ 僚舰放飞的机群弹道会从主控出。 */
      const mySrc = isMeShot ? meAnchorByTag.get(fx.tag) : undefined
      /** **敌方发射舰的行号**（`rowFxTags` 只含敌方 ⇒ 只在敌方那一支有意义；我方那一支恒 −1） */
      const shooterRowIdx = isMeShot ? -1 : rowFxTags.indexOf(fx.tag)
      /** **被瞄准的我方舰**（仅敌方那一支用；缺 `fx.to` 或单船路径 ⇒ undefined ⇒ 回落主控） */
      const aimMeAnchor = isMeShot ? undefined : fx.to !== undefined ? meAnchorByTag.get(fx.to) : undefined
      let src: Anchor | undefined
      let dst: Anchor | undefined
      {
        // 我方多舰路径：发射舰锚点表优先（`fx.src='drone'` 的弹道自机群位起飞，故不走这张表）
        const r = resolveBoltAnchors({
          side: isMeShot ? 'me' : 'foe',
          tag: fx.tag,
          ...(fx.to !== undefined ? { to: fx.to } : {}),
          rowFxTags,
          meAnchors: meAnchorByTag,
          meFallback: layFx.me,
          foeAnchors: layFx.foe,
        })
        if (r) {
          src = isMeShot ? (mySrc ?? r.src) : r.src
          dst = isMeShot ? r.dst : (aimMeAnchor ?? r.dst)
        }
      }
      if (!src || !dst) continue
      if (isMeShot && fx.hit) lastHitTypeRef.current.set(aimTag, fx.type) // 记录最近命中形态（击杀延迟用）
      // 舰艏偏移按**该舰实际落画体积**取（2026-09-11 舰种体积：舰艏距中心与舰宽线性，见 noseOf）——
      // 优先取本帧布局的实际值（含溢出收缩），索引缺失才回落到按 tag 推导的体积
      const aimSize = isMeShot
        ? ((aimRowIdx >= 0 ? layFx.sizes[aimRowIdx] : undefined) ?? foeSizeOf(aimTag))
        : ((fx.to !== undefined ? meSizeByTag.get(fx.to) : undefined) ?? meSize) // 敌方那一支的"目标"是我方舰
      /** 我方多舰路径：发射舰的实际落画体积（与 `src` 同一把尺） */
      const myShooterSize = isMeShot ? meSizeByTag.get(fx.tag) : undefined
      const shooterSize =
        myShooterSize ?? ((shooterRowIdx >= 0 ? layFx.sizes[shooterRowIdx] : undefined) ?? foeSizeOf(fx.tag))
      const srcNose = noseOf(isMeShot ? (myShooterSize ?? meSize) : shooterSize)
      const dstNose = noseOf(aimSize)
      // 2026-09-10 船长批：开火点挂真实炮口——按发射者挂点取 muzzle（多炮口轮换），
      // 无挂点/无原生炮（货矿舰等）→ 传 null 回退舰艏前缘；artW = 发射舰实际显示宽
      // 无人机（src='drone'）例外：弹道自**机群当前悬浮位**起飞（不占母舰炮口轮换）
      const dm = fx.src === 'drone' ? droneModelOf(fx.artId) : undefined
      const artW = isMeShot ? (myShooterSize ?? meSize) : shooterSize
      let mounts: ReturnType<typeof mountsOf>
      let muzzlePt: Anchor | null = null
      let from: Anchor | null = null
      let droneDelay = 0
      if (dm) {
        const key = dm.resident ? `res:${fx.artId}` : `fly:${fx.artId}`
        const n = droneSlotRef.current.get(key) ?? 0
        droneSlotRef.current.set(key, n + 1)
        const foeA = layFx.foe[0] ?? layFx.me;
        // **阵位锚点 = "要打的那一方"**（2026-09-11 机群批 S5 二次修正）：
        //   · 我方机群 → 锚在**敌舰**（悬在目标舰旁，打的就是它）；
        //   · 敌方机群 → 锚在**我方舰**（完全镜像：扑到您脸上来打）。
        // ⇒ 两侧出击**都是整段舰间距**的航路（旧口径把敌机也锚在敌舰上 ⇒ 只飞 42~68px，
        //   船长实测反馈"只移动一小段、位置还贴在敌舰左上角"）。
        const anchor = isMeShot ? foeA : layFx.me
        const dir = isMeShot ? 1 : -1;
        // **第二层：敌机也走"出击制"**——敌我**共用同一套状态表口径**（2026-09-11 修正）：
        //   · 我方：键 = `artId`，表 = `droneSortieRef`，架数 = 我方该机型架数；
        //   · 敌方：键 = `tag:artId`，表 = `foeSortieRef`，架数 = **该舰现存架数**。
        // ⚠ 旧版敌机弹道读的是**我方那张表**、又用我方架数 ⇒ 与机体层（读 `foeSortieRef`）的
        //   **时间起点 / 随机阵位 / 道次全对不上** ⇒ 船长实测反馈"弹道和敌机位置不对"。
        const foeDrone = !isMeShot
        /** 键统一成 **`舰tag:机型`**（2026-09-14「逐舰机群」：两侧同构，机体层与弹道层用同一个键） */
        const skey = `${fx.tag}:${fx.artId}`
        const smap = foeDrone ? foeSortieRef.current : droneSortieRef.current
        /** 我方**逐舰**布局（僚舰的机群从自己舰位起飞/返航；主控那条 = `layFx` ⇒ 逐像素不变） */
        const layOwner = foeDrone
          ? layFx
          : fx.tag && fx.tag !== 'player'
            ? { foe: layFx.foe, me: meAnchorByTag.get(fx.tag) ?? layFx.me }
            : layFx
        if (DRONE_STYLE === 'sortie' && !dm.resident) {
          /**
           * 2026-09-10 船长"弹道发射位置和无人机对不上（小概率）"修复——两处确定性缺陷：
           * ① 道次原按 6 取模，但渲染机体数是 min(架数,6)：带 2~5 架时弹道会从"没有机体的道位"发出；
           * ② 无人机已在返航途中开火时，弹道仍从敌侧阵位发出（机体已不在那里）。
           * 现改为：道次按**实际机体数**取模；返航阶段开火则弹道**从无人机当前位置**发出（边退边打）。
           */
          const count = foeDrone
            ? Math.max(
                1,
                Math.min(foeDroneAliveOf(fx.tag!, fx.artId!), DRONE_SHOW_MAX),
              )
            : Math.max(
                1,
                Math.min(droneCountOf.get(skey) ?? 1, DRONE_SHOW_MAX),
              )
          const lane = n % count
          const prev = smap.get(skey)
          const cycleMs =
            DRONE_SORTIE_OUT_MS + DRONE_DWELL_MS + DRONE_SORTIE_BACK_MS
          const st =
            !prev || now - prev.startAt >= cycleMs + 40
              ? { startAt: now, offs: droneRandomOffsets(DRONE_SHOW_MAX, droneOutward) }
              : prev
          smap.set(skey, st)
          const off = st.offs[lane % st.offs.length]!
          const elapsed = now - st.startAt
          // **弹道起飞点＝机体同一个阵位**（受击增程后一起后撤；非增程时与原口径逐字相同）
          const station = foeDrone
            ? foeDroneStation(layFx.me, foeA, off, foeDroneBuffedOf(fx.tag!))
            : droneStationFrom(anchor, dir, off)
          if (elapsed < DRONE_SORTIE_OUT_MS) {
            // 仍在出击途中：弹道自阵位出，延到"无人机抵达"那一刻显示
            from = station
            droneDelay = Math.round(DRONE_SORTIE_OUT_MS - elapsed)
          } else if (elapsed < DRONE_SORTIE_OUT_MS + DRONE_DWELL_MS) {
            // 已到位：阵位出弹，立即显示
            from = station
          } else if (isMeShot) {
            // 返航中（我方）：弹道就从无人机当前位置出（与机体一致）——**按所属舰的布局**取姿态
            from = dronePoseAt(dm, lane, st, layOwner, elapsed)
          } else {
            // 返航中（敌方）：镜像几何——阵位（我方舰旁）→ 敌舰机库口
            const t2 = Math.min(
              1,
              Math.max(
                0,
                (elapsed - DRONE_SORTIE_OUT_MS - DRONE_DWELL_MS) /
                  DRONE_SORTIE_BACK_MS,
              ),
            )
            const tk = droneTakeoff(lane)
            const deckAbs = { x: foeA.x - tk.x, y: foeA.y + tk.y }; // 相对敌舰**水平镜像**（敌舰朝向我方）
            from = dronePathPos(
              t2,
              station,
              deckAbs,
              droneArcHeight(lane),
              true,
            )
          }
        } else {
          from = droneHomeStation(dm, n % Math.max(1, Math.min(dm.slots.length, DRONE_SHOW_MAX)), layFx)
        }
      } else {
        mounts = isMeShot ? mountsOf(meShip?.id, undefined) : mountsOf(undefined, foeKey)
        const mz = mounts?.muzzles
        if (mz && mz.length > 0) {
          const k = isMeShot ? 'me' : fx.tag
          const n = muzzleCountRef.current.get(k) ?? 0
          muzzleCountRef.current.set(k, n + 1)
          muzzlePt = mz[n % mz.length]!
        }
      }
      // 无人机瞄准敌舰**中心点**（2026-09-10 船长八次定）：炮台/激光仍打舰艏侧命中点，无人机不打前缘
      const g = boltGeom(
        fx.side,
        src,
        dst,
        srcNose,
        dm ? 0 : dstNose,
        muzzlePt,
        artW,
        from,
      );
      // **打机群不画弹道**（船长 2026-09-11）：机群已飞到您舰旁，弹道画向敌舰是错的；
      // 攻击感由**炮口闪光**（下面照旧推）+ 机群自身的出击动画表达。
      if (!fx.pd)
        boltsRef.current.push({
          key: keyRef.current++,
          color: DMG_COLOR[fx.type],
          type: fx.type,
          hit: fx.hit,
          x1: g.x1,
          y1: g.y1,
          len: g.len,
          angDeg: g.angDeg,
          born: now,
          ...(dm ? { drone: fx.artId } : {}),
          ...(droneDelay > 0 ? { delay: droneDelay } : {}),
        })
      flashRef.current.push({
        key: keyRef.current++,
        at: now,
        color: DMG_COLOR[fx.type],
        x: g.x1,
        y: g.y1,
        ...(dm ? { small: true } : {}),
        ...(droneDelay > 0 ? { delay: droneDelay } : {}),
      })
    }
    if (flashRef.current.length > 6) flashRef.current.splice(0, flashRef.current.length - 6)
  }
  // 惰性清理过期元素（渲染输出不再包含它们即从 DOM 移除；延迟弹道按 delay 延长存活）
  boltsRef.current = boltsRef.current.filter((b) => now - b.born < BOLT_LIFE + (b.delay ?? 0))
  flashRef.current = flashRef.current.filter((f) => now - f.at < FLASH_LIFE + (f.delay ?? 0))
  // 击落坠落演出：CSS 演完即清（不留常驻 DOM，也不做逐帧 JS 动画）
  if (droneDownRef.current.length > 0) {
    droneDownRef.current = droneDownRef.current.filter(
      (d) => now - d.born < DRONE_DOWN_FREEZE_MS + DRONE_DOWN_LIFE,
    )
  }

  /* ── 敌方单位被击毁检测（hp 归零的瞬间登记尸骸 + 爆炸计划，演出与战斗是否结束无关）──
     ⚠ **2026-09-14 船长报障修复（甲案）**：「血条打空后，舰船形象和血条都不清理消除」——
     旧判据 `sum === 0 && prev > 0` 要求**看见过它活着**才登记阵亡；而**次波/增援的新单位可能在
     登场第一拍就被我方齐射打死**（真引擎实测：210 场里 81 场复现，幽灵**全部**来自 `w1-/w2-` 增援波），
     于是它永不入 `deadRef` ⇒ 视觉行不撤队 + 血条照画（`corpseOn` 为假才画条）⇒ 舰影与空血条**
     永久留场**。现改为：**只要观察到 0 血且未登记过，就登记阵亡**——
     有前值（正常阵亡）⇒ 照旧演爆炸；**没有前值**（首见即 0 血：漏帧 / 入场期被打死 / 重进战场）
     ⇒ **不登记尸骸 ⇒ `scanDroppable` 立即出队**，不重放爆炸（与 2026-09-10 预登记那条同口径）。 */
  if (!hpInitRef.current) {
    for (const tag of foeTags) {
      const hp = combat.foeHp[tag]
      const sum = hp ? hp.s + hp.a + hp.h : 0
      prevHpRef.current.set(tag, sum)
      // 首帧就把"已经是尸体"的登记掉（无声撤出：不写尸骸 ⇒ 不演爆炸）——重进战场/洞内重开面板都走这条
      if (sum === 0) deadRef.current.add(tag)
    }
    hpInitRef.current = true
  } else {
    for (const tag of foeTags) {
      const hp = combat.foeHp[tag]
      const sum = hp ? hp.s + hp.a + hp.h : 0
      const known = prevHpRef.current.has(tag)
      const prev = prevHpRef.current.get(tag) ?? 0
      prevHpRef.current.set(tag, sum)
      if (sum === 0 && !deadRef.current.has(tag)) {
        deadRef.current.add(tag) // 阵亡登记（含"首见即 0 血"这一档）
        if (known && prev > 0) {
          // 正常阵亡：爆炸延后到致死弹道着弹后再启动
          // 击杀爆炸延迟 = 致死形态的弹道时长（动能 420 / 导弹 760 / 激光 130），
          // 与命中 puff 同时出现——否则导弹击杀会在弹道半途提前变灰/上移
          const killerType = lastHitTypeRef.current.get(tag)
          const killerFly = (killerType ? BOLT_LOOK[killerType]?.fly : undefined) ?? FLY_MS
          corpseAtRef.current.set(tag, now + killerFly)
        }
      }
    }
  }
  // 队列定稿（2026-09-09 二轮）：阵亡检测后再扫一次撤出集——本帧新阵亡的尸骸（boomAt 未到、
  // 演出期长）计入"演出中"，阻止同帧撤出它左侧已完成淡出的旧尸骸（收拢不撞上新爆炸）；
  // 撤出即清演出登记：跨波之后该尸骸永不回队占位（波次尸骸不得挤占新波队列）。
  const dropFinal = scanDroppable()
  for (const tag of dropFinal) corpseAtRef.current.delete(tag)
  const foeRowTags = foeTags.filter((t) => !deadRef.current.has(t) || !dropFinal.has(t))
  const foeSizes = foeSizesFor(foeRowTags) // 逐舰体积（px；含"全灭保留 1 槽"兜底，与改造前 foeN 同语义）
  /* ═══ 我方舰列：单船 / 4 舰同屏（虫洞 F2b，2026-09-13 船长「我方4条舰船需要同时显示」＋
     「按照敌人阵型那样**镜像排列**」）═══
     · 单船路径（`myUnits.length === 1`）走原分支（`lay.me` / `lay.meLeft`），DOM 与原实现逐字一致；
     · 多舰路径喂 `layout()` 我方逐舰体积 ⇒ 它按**敌人斜向菱形的镜像**给我方逐舰锚点 `lay.my[i]`
       （列序向左展开、第二排左移半个列距 + 下移一行高；主控＝第 0 列最靠敌）。
     · 直径尺锚点仍按主控那条舰；**弹道已改为按发射舰出**（见上 `meAnchorByTag`，2026-09-13 修）。 */
  const mySlots = multiMe ? arcs.myUnits.map((u, slot) => ({ u, slot })) : []
  /** 渲染次序：非主控在前（远的先画）、主控最后（画在最上层） */
  const myDrawOrder = multiMe ? [...mySlots].sort((a, b) => Number(a.u.leader) - Number(b.u.leader)) : []
  /* 2026-09-10 说明：列宽重测**不能**在这里用 useEffect —— 本行位于 `if (!view.combat …) return null`
     守卫之后，战斗结束时提前 return 会跳过该 hook，hooks 数量不一致会让 React 卸载整棵树（黑屏无反应）。
     现改为在守卫之前的 33ms 循环里按 ~330ms 节流核对列宽（见该循环 "列宽核对" 段）。 */
  const lay = layout(dims, foeSizes, visM, openM, nearM, meSize, mySizes)
  /**
   * **跃迁入场**（船长 2026-09-13：「既然开始做战斗效果了，那么能否在开始时做一个入场效果？
   *  为了最小程度防止BUG，**入场效果仅为动画**。玩家和敌舰的位置依旧不改变。入场效果为我方或者敌方
   *  跃迁入场。（**虫洞内为敌方，虫洞外为我方**）」）。
   *
   * ⚠ **2026-09-14 船长改判**（原话「**动画没结束不开火**」，见
   * `docs/design/battle-arrival-window-20260914.md` §6）：「**仅为动画**」这句**不再成立**——
   * 入场现在**同时**带一段"不可被我方选中"的窗口（引擎侧给，窗口与动画**同一个数**）；
   * **仍然成立的是"位置不改"**（那才是原话"为了最小程度防止BUG"的用意）：本层不进 `layout()`、
   * 不碰任何布局/坐标/编队几何/血条锚点/距离尺。**"只演一次"也一并改判**为**逐舰各演一次**。
   *
   * 口径（四条，缺一不可）：
   * 1. **不碰布局**：只给舰船元素加 `is-arriving` + `--arrive-dx/--arrive-ms/--arrive-delay`
   *    （CSS 关键帧做 `translateX(起点) → 0` + 快速淡入，**只走 transform/opacity**），
   *    我方列与敌列的 `left`、编队几何、距离尺全部照旧；
   * 2. **按战斗时钟**：首波 = 开战前 `ARRIVAL_FX_MS`（中途退出再进战场不会重播）；
   *    **此后每一次波次转场/增援 = 引擎 `enteredAtMs` 逐舰驱动**（每一条新舰各演一次）；
   * 3. **谁入场**：虫洞内 = **敌方**跃迁入场（洞里是它们的地盘）；洞外（悬赏/遭遇/教学）= **我方**。
   * 4. **怎么入场**（2026-09-13 船长二次裁定）：「**舰船从屏幕外以减速的形式进场并落到舰船战斗位置。
   *    这里只影响动画。不影响舰船实际位置。**」——即**舰船本体**从**本侧屏幕外**飞入（我方自左缘外、
   *    敌方自右缘外），末段减速落位；**不用**原来的"泳道中线画一圈跃迁环"（那版已删除）。
   *    实现 = 给入场那侧的舰船元素加 `is-arriving` + `--arrive-dx/--arrive-ms/--arrive-delay` 三个变量，
   *    由 CSS 关键帧做 `translateX(起点) → 0` + 快速淡入；**只走 transform/opacity（合成层，不重排）**，
   *    终点恒为 `translateX(0)` ＝ 它的战斗位置 ⇒ 舰船坐标、编队几何、血条锚点、距离尺一字不改；
   *    动画撤掉（窗口结束）时无跳变。
   */
  const ARRIVAL_FX_MS = 1300
  /** 单舰飞入时长（ms）与逐舰错峰（ms）——**与引擎同源**（`core/combat.ts` 的两个常量：
   *  入场窗口就是拿它们算的 ⇒「动画没结束不开火」与"看得见的动画"永远同一个数，不许各写一份）。
   *  ⚠ **倍速批（2026-09-19）**：引擎侧窗口按倍速等比放大（`battleShowWindowMs`：倍速只压战斗进程、
   *  不压演出）⇒ 界面这几处比较也必须过同一个函数，否则"动画演完那一刻窗口正好结束"的同步就断了。
   *  下面读的是**战斗时钟差值**，乘回倍速后对应的**真实时长仍是原值**（动画本身照原速播，未动）。 */
  const ARRIVAL_FLY_MS = BATTLE_ARRIVAL_FLY_MS
  const ARRIVAL_STAGGER_MS = BATTLE_ARRIVAL_STAGGER_MS
  /** 起点余量（px）：让起点**完全落在屏幕外**（泳道 `overflow: hidden`，超出即不可见） */
  const ARRIVAL_EDGE_MARGIN = 40
  /** **开战那一刻谁在入场**（船长 2026-09-13：洞内 = 敌方跃迁入场、洞外 = 我方）——只用于**首波**；
   *  此后每一次波次转场/增援由引擎的 `enteredAtMs` 逐舰驱动（见下 `arrivingTagOf`，船长 2026-09-14「③补」）。 */
  const arrivalSide: 'me' | 'foe' | null =
    battle.lastTickGameMs - battle.startedAtGameMs <= battleShowWindowMs(battle, ARRIVAL_FX_MS) ? (inWormhole ? 'foe' : 'me') : null
  /**
   * **逐舰入场判定**（船长 2026-09-14「③补。并且参考①动画没结束不开火」）：
   * 引擎给**每一次入场**（洞内首波 / 每一次波次转场 / 单波内增援）的每条舰写了 `enteredAtMs`
   * （含逐舰错峰），界面据此**各播一次飞入**——旧实现只看"开战前 1300ms"，次波入场**没有动画**。
   * ⚠ 与引擎的不可选中窗口**同一个数**：动画演完那一刻，窗口也正好结束。
   */
  const arrivingTagOf = (tag: string): boolean => {
    const at = battle.units[tag]?.enteredAtMs
    if (at === undefined) return false
    const since = battle.lastTickGameMs - at
    return since >= 0 && since < battleShowWindowMs(battle, ARRIVAL_FLY_MS)
  }
  const foeArriving = (tag: string): boolean => arrivingTagOf(tag) || arrivalSide === 'foe'
  /** 我方飞入起点位移（负 = 自左缘外飞入；0 = 战斗位置） */
  const arriveDxMe = Math.round(-(lay.me.x + meSize / 2 + ARRIVAL_EDGE_MARGIN))
  /** 敌方逐舰飞入起点位移（正 = 自右缘外飞入；逐舰按各自机位算，斜向菱形两排一致） */
  const arriveDxFoe = (i: number): number => {
    const w = lay.sizes[i] ?? LAY.MAIN
    const x = lay.foe[i]?.x ?? dims.W
    return Math.round(dims.W - x + w / 2 + ARRIVAL_EDGE_MARGIN)
  }
  /* ═══ 我方舰列：单船 / 4 舰同屏（虫洞 F2b，2026-09-13 船长「我方4条舰船需要同时显示」）═══
     · 单船路径（`myUnits.length === 1`）走原分支，DOM 与原实现逐字一致 ⇒ 观感零变化；
     · 多舰路径逐舰一条舰影，锚点取 `lay.my[i]`（**敌人斜向菱形的镜像**，见上）；DOM 顺序把主控放最后
       ＝画在最上层；距离尺/弹道锚点仍按主控那条舰。 */
  /** 阵形（斜向菱形）：列宽/右移/下移/排高 + 逐舰机位（DOM 的两排排布与逐舰微调共用这一份） */
  const foeFormation = lay.formation
  /** 逐舰血条几何（宽/相对本舰偏移；贴各自舰下，拥挤时该排整组竖排到编队下方）——
   *  入参是**逐舰舰底 y**（第一排/第二排舰底差一个排高，堆叠基准必须用真实舰底） */
  const foeBarGeoms = foeBarGeom(
    lay.foe.map((a) => a.x),
    lay.foe.map((a, i) => a.y + ((lay.sizes[i] ?? LAY.MAIN) * 0.46) / 2),
    lay.foeBottom,
  )
  /** 波次演出窗口提示（引擎 waveEnterGapMs 内：上一波全灭、下一波尚未抵达） */
  const wavePending = battle.waveClearAt !== undefined && !ended
  const waveNext = wavePending && foeAnomaly?.waves && foeAnomaly.waves.length > 1 ? (battle.waveIdx ?? 0) + 2 : 0
  /**
   * **战斗窗口正上方的提示位**（2026-09-11 船长：「**日志内不用显示提示，将该提示放入战斗画面内显示**
   * （和**敌方增援**统一下系统，**显示位置改为战斗窗口正上方**）」）——同一处提示位渲染两路来源：
   * ① 波次增援（由 `waveClearAt` 推导，整段增援窗口常显）；② 引擎推来的战斗提示（`battle.notices`，
   * 如「受击增程」），按战斗时钟**限时显示后自动消失**（提示位是"正在发生"，留档归战报）。
   */
  /**
   * 引擎推来的战斗提示**显示时长**（毫秒）——2026-09-12 船长：「顶部的『静滞阵列解除限幅：静滞卫舰
   * 炮台射程 +50%』这类文字显示持续时间**变为 300%**」⇒ 4,000 → **12,000ms**（原值 ×3）。
   * ⚠ 只作用于 ② 引擎提示（`battle.notices`：受击增程 · 敌方增援提示等）；①「敌方增援正在接近…」
   * 是按**增援窗口**（`waveClearAt`）常显的，与固定时长不同源、本次未动。
   */
  const NOTICE_LIFE_MS = 12_000
  const noticeItems: Array<{ key: string; text: string }> = []
  if (wavePending)
    noticeItems.push({
      key: 'wave',
      text: waveNext > 0 ? `第 ${waveNext}/${foeAnomaly?.waves?.length} 波增援正在接近…` : tr("ui.BattleScreen.030"),
    })
  for (const [i, n] of (battle.notices ?? []).entries()) {
    if (battle.lastTickGameMs - n.atMs > battleShowWindowMs(battle, NOTICE_LIFE_MS)) continue
    noticeItems.push({ key: `notice-${i}-${n.atMs}`, text: n.text })
  }

  /* 射程弧：锚定双方舰艏枪口（与弹道同源、随舰身移动）。
     显示尺与舰列间距共用同一米制比例：sPxPerM = usable/(openM−nearM) px/m。
     贴脸基准枪口距 gunBasePx 不用猜测常量，而是由"当前帧实测枪口间距 − 当前距离的像素长"反推：
       gunBasePx = (foeGunX − meGunX) − (visM − nearM)×sPxPerM   （几何常数，随窗口/列宽自动成立）
     于是 弧半径(射程) = gunBasePx + (射程 − nearM)×sPxPerM，当 射程 == 当前距离 时弧端恰好触到敌方枪口；
     弧端到敌枪口的像素缺口正比于"射程 − 当前距离"。 */
  const meGunX = lay.me.x + noseOf(meSize)
  const foeGunX = (lay.foe[0]?.x ?? lay.me.x) - noseOf(lay.sizes[0] ?? LAY.MAIN)
  const sPxPerM = lay.usable / Math.max(1, openM - nearM) // 与舰列位移同尺（px/m）
  const gunBasePx = Math.max(40, foeGunX - meGunX - (visM - nearM) * sPxPerM)
  const arcCap = lay.usable + gunBasePx + 80 // 兜底上限：不超"开局枪口位 + 余量"
  const arcR = (rangeM: number, minPx: number): number =>
    Math.max(minPx, Math.min(arcCap, gunBasePx + Math.max(0, rangeM - nearM) * sPxPerM))
  // 主武器弧 = 战术距离口径认定的那件（core `mainWeaponOf` 下发 `isMain`；2026-09-12 船长裁定「甲」，
  // 界面不再自己 find(kind==='gun')——旧写法会把激光船/装近防炮的船的米数刻度画成 2,500m）
  const mainMeArc = arcs.me.find((w) => w.isMain) ?? arcs.me[0]
  const meArcEls = arcs.me.map((w, wi) => {
    const color = w.type ? DMG_COLOR[w.type] : '#93a4b8'
    const hollow = w.kind === 'gun' && !w.type
    const inBand = realDist >= w.minM && realDist <= w.maxM // 已进入该武器射程带（按引擎真实距离，避免插值边界抖动）
    const dim = inBand ? 0.25 : 1
    const r1 = arcR(w.maxM, 26)
    // 最小射程内沿：< 近距(200m) 的武器（0m 起）视为"贴脸即可打"，带起点贴回枪口小半径；
    // ≥ 近距的按米差精确落在贴脸基线外侧
    const r0 = w.minM >= nearM ? Math.min(arcR(w.minM, 12), r1 - 4) : Math.min(12, r1 - 4)
    return (
      <g key={`me${wi}`} opacity={(hollow ? 0.55 : 1) * dim}>
        <path d={fanPath(r0, r1)} fill={color} fillOpacity={hollow ? 0 : 0.12} />
        <path d={ringPath(r1)} fill="none" stroke={color} strokeWidth={hollow ? 1.2 : 2} strokeDasharray={hollow ? '4 4' : undefined} strokeOpacity={0.85} />
        {w.minM > 0 ? <path d={ringPath(r0)} fill="none" stroke={color} strokeWidth={1} strokeDasharray="3 5" strokeOpacity={0.5} /> : null}
      </g>
    )
  })
  const foeColor = DMG_COLOR[arcs.foe.type]
  const foeR1 = arcR(arcs.foe.maxM, 26)
  const foeR0 = arcs.foe.minM >= nearM ? Math.min(arcR(arcs.foe.minM, 12), foeR1 - 4) : Math.min(12, foeR1 - 4)
  const foeInBand = realDist >= arcs.foe.minM && realDist <= arcs.foe.maxM // 我方已进入敌方有效射程带（引擎真实距离）
  const meMainR1 = mainMeArc ? arcR(mainMeArc.maxM, 26) : 0

  /* 弹药（显示层） */
  const ammoChips = DMG_ORDER.filter((t) => arcs.ammo[ammoKey(t)] > 0)

  /* 敌方冲锋（2026-09-14 逐单位）：可能同时多条在冲 ⇒ 标记带条数；口径与引擎同源（core 的 `foeChargeCount`） */
  const foeCharging = battle ? foeChargeCount(battle) : 0

  /* 船体维修装置状态（2026-09-09；**2026-09-16 逐舰**）：运转中（绿点呼吸）/ 组件耗尽停机（暗红）；徽标在弹药旁。
     逐舰化后徽标是**全队合计**（任何一艘在跑 ⇒ 亮"运转中"），悬停列出逐舰明细（谁在跑、各剩多少组件）。 */
  const repairLedgers = repairLedgersOf(battle)
  const repairTotal = repairLedgers.reduce(
    (n, e) => n + Object.values(e.ledger.kits).reduce((a, b) => a + b, 0),
    0,
  )
  const repairRunning = repairLedgers.some((e) => e.ledger.units.some((u) => !u.stopped))
  const repairDetail = repairLedgers
    .map((e) => {
      const kits = Object.values(e.ledger.kits).reduce((a, b) => a + b, 0)
      const running = e.ledger.units.some((u) => !u.stopped)
      const who = e.tag === 'player' ? tr("ui.BattleScreen.031") : `僚舰 ${e.tag.replace('ally-', '')}`
      return `${who}：${running ? tr("ui.BattleScreen.032") : tr("ui.BattleScreen.033")}（组件 ×${kits.toLocaleString('zh-CN')}）`
    })
    .join('\n')

  /* 距离滑条：值 = 接近度×1000（0 最远拉开 → 1000 贴脸），右拖 = 接近 */
  const desireM = Math.min(openM, Math.max(nearM, combat.myDesireM))
  const sliderV = dragV ?? approachOf(desireM, openM, nearM) * 1000
  const sliderToDesire = (v: number): number => Math.round(openM - (v / 1000) * (openM - nearM))
  const commitDesire = (v: number): void => {
    const r = engine.battleSetDesireAt(sliderToDesire(v))
    if (!r.ok) onToast(r.error ?? '设置失败', true)
  }
  /**
   * 拖动中：**节流提交**（把期望距离写进引擎，远征按星系记忆 / 洞内记在本趟），
   * 但 **`dragV` 一直留到松手**（2026-09-13 船长反馈"一格一格地移动"）——
   * 首版这个定时器顺手 `setDragV(null)`：手指还按着时，滑条会每 160ms 被"回弹到上一次提交值"，
   * 拖起来就是一跳一跳的。提交归提交，**画面跟随归画面跟随**，松手才收。
   */
  /**
   * **拖动中的"跟手"重绘**：合并到 `requestAnimationFrame`，**每帧最多一次 setState**——
   * 高回报率鼠标（125~1000Hz）一次拖动能产生几百个 `input` 事件，逐个 setState 会把整棵战场
   * （我方 4 舰 + SVG 射程弧 + 事件环）重渲染几百次 ⇒ 顿挫（船长 2026-09-13：「依旧还是有顿挫感」）。
   */
  const pushDragV = (v: number): void => {
    dragPendingRef.current = v
    if (dragRafRef.current !== null) return
    dragRafRef.current = window.requestAnimationFrame(() => {
      dragRafRef.current = null
      const pending = dragPendingRef.current
      if (pending !== null) setDragV(pending)
    })
  }
  const scheduleCommit = (v: number): void => {
    dragValRef.current = v
    if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current)
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null
      commitDesire(v)
    }, 160)
  }
  /** 松手/失焦：补最后一次提交，并交还"跟随态" */
  const flushDrag = (): void => {
    const v = dragValRef.current
    dragValRef.current = null
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
    if (v !== null) commitDesire(v)
    setDragV(null)
  }
  const applyTactic = (t: 'assault' | 'mid' | 'kite'): void => {
    const m = battleTacticDesire(state, engine.ctx, t)
    commitDesire(approachOf(m, openM, nearM) * 1000)
  }

  const meStats = battle.stats
  const secs = Math.max(1, Math.round((state.gameMs - battle.startedAtGameMs) / 1000))

  /* 弹道（旋转容器内沿 +x 飞行）+ 撞点特效（CSS 延迟到着弹时刻）——
     2026-09-05 三族观感分家：动能=快曳光 / 导弹=慢速虚线尾焰 / 激光=近瞬光束线 */
  /**
   * **劫掠捕获网连线**（船长 2026-09-16：「动画效果为一根蓝色的光速连着命中舰船」）：
   * 与弹道**同一套几何**（锚点 + 夹角 + 长度），但**不发散也不消失**——只要引擎账本里还有这条网就一直画，
   * 击杀发动者后 `arcs.webLinks` 自然为空、连线当帧消失。样式沿用同级 `.app-bts-bolt` 那套（不新造机制）。
   * ⚠ 两端语义（船长 2026-09-17 定稿：「**亮端留在被钉舰、羽化端朝敌人**」）：
   * `from` = 发动者（劫掠电子舰 · 敌人）＝连线元素 0% 端 ⇒ **羽化淡出**；
   * `to` = 被钉住的我方舰 ＝ 100% 端 ⇒ **最亮 + 外发光**（渐变方向只在 `styles.css` 的 `.app-bts-web-bar`）。
   */
  const foeAnchorByTag = new Map<string, { x: number; y: number }>()
  rowFxTags.forEach((tag, i) => {
    const a = layFx.foe[i]
    if (a) foeAnchorByTag.set(tag, a)
  })
  const meAnchorOfTag = (tag: string): { x: number; y: number } | undefined =>
    multiMe ? meAnchorByTag.get(tag) : tag === 'player' ? layFx.me : undefined
  const webEls = (arcs.webLinks ?? []).flatMap((l) => {
    const from = foeAnchorByTag.get(l.from)
    const to = meAnchorOfTag(l.to)
    if (!from || !to) return []
    const dx = to.x - from.x
    const dy = to.y - from.y
    const len = Math.max(8, Math.hypot(dx, dy))
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI
    return [
      <div
        key={`web-${l.from}-${l.to}`}
        className="app-bts-web"
        style={{ left: from.x, top: from.y, transform: `rotate(${ang}deg)` }}
        title={tr("ui.BattleScreen.034")}
      >
        <i className="app-bts-web-bar" style={{ width: len }} />
      </div>,
    ]
  })

  const boltEls = boltsRef.current.map((bv) => {
    const look = BOLT_LOOK[bv.type] ?? BOLT_LOOK.kinetic
    const color = bv.color
    const barBg =
      look.dash !== null
        ? `repeating-linear-gradient(90deg, ${color} 0 ${look.dash - 4}px, transparent ${look.dash - 4}px ${look.dash}px)`
        : `linear-gradient(90deg, ${color} 0%, ${color}cc 60%, transparent 100%)`
    const beamLine = bv.type === 'plasma' ? (
      <i
        className="app-bts-beamline"
        style={{
          width: bv.len,
          borderColor: color,
          boxShadow: `0 0 6px ${color}`,
          animationDuration: `${look.fly}ms`,
        }}
      />
    ) : null
    const dm = bv.drone ? droneModelOf(bv.drone) : undefined
    // 无人机弹道（2026-09-10）：飞行时长按机型系数（哨戒更长、其余提速 DRONE_FLY_MUL）；
    // 蜂鸟/赤鸢/猎鹰 = 可见小曳光点（--fly = 行程 px）；哨戒 = 仿主舰的**细曳光条**（更细，不发小弹点）
    const flyMs = dm ? Math.max(60, Math.round(look.fly * (dm.bolt.flyMul ?? DRONE_FLY_MUL))) : look.fly
    if (dm && dm.bolt.style === 'beam') {
      return (
        <div key={bv.key} className={`app-bts-bolt is-${bv.type} is-drone is-sentry`} style={{ left: bv.x1, top: bv.y1, transform: `rotate(${bv.angDeg}deg)` }}>
          <i
            className="app-bts-bolt-bar"
            style={{
              width: bv.len,
              height: dm.bolt.width,
              top: -dm.bolt.width / 2,
              background: barBg,
              boxShadow: `0 0 6px ${color}`,
              animationDuration: `${flyMs}ms`,
              animationDelay: `${bv.delay ?? 0}ms`,
            }}
          />
          <i
            className={`app-bts-puff${bv.hit ? " is-hit" : " is-miss"} is-small`}
            style={{
              left: bv.len,
              top: 0,
              borderColor: color,
              boxShadow: `0 0 10px ${color}`,
              animationDelay: `${(bv.delay ?? 0) + flyMs}ms`,
              animationDuration: bv.type === 'plasma' ? '180ms' : '420ms',
            }}
          />
        </div>
      )
    }
    if (dm) {
      return (
        <div key={bv.key} className={`app-bts-bolt is-${bv.type} is-drone`} style={{ left: bv.x1, top: bv.y1, transform: `rotate(${bv.angDeg}deg)` }}>
          <i
            className="app-bts-bolt-dot"
            style={
              {
                background: color,
                boxShadow: `0 0 6px ${color}, 0 0 12px ${color}66`,
                animationDuration: `${flyMs}ms`,
                animationDelay: `${bv.delay ?? 0}ms`,
                '--fly': `${Math.max(24, bv.len)}px`,
                '--dot': `${dm.bolt.width + 3}px`,
              } as CSSProperties
            }
          />
          <i
            className={`app-bts-puff${bv.hit ? " is-hit" : " is-miss"} is-small`}
            style={{
              left: bv.len,
              top: 0,
              borderColor: color,
              boxShadow: `0 0 10px ${color}`,
              animationDelay: `${(bv.delay ?? 0) + flyMs}ms`,
              animationDuration: bv.type === 'plasma' ? '180ms' : '420ms',
            }}
          />
        </div>
      )
    }
    return (
      <div key={bv.key} className={`app-bts-bolt is-${bv.type}`} style={{ left: bv.x1, top: bv.y1, transform: `rotate(${bv.angDeg}deg)` }}>
        <i
          className="app-bts-bolt-bar"
          style={{
            width: bv.len,
            height: bv.type === 'plasma' ? 1 : bv.type === 'explosive' ? 6 : 4,
            top: bv.type === 'plasma' ? 0 : -2,
            background: barBg,
            boxShadow: `0 0 8px ${color}`,
            animationDuration: `${look.fly}ms`,
          }}
        />
        {beamLine}
        <i
          className={`app-bts-puff${bv.hit ? " is-hit" : " is-miss"}`}
          style={{
            left: bv.len,
            top: 0,
            borderColor: color,
            boxShadow: `0 0 10px ${color}`,
            animationDelay: `${look.fly}ms`,
            animationDuration: bv.type === 'plasma' ? '180ms' : '420ms',
          }}
        />
      </div>
    )
  })
  const muzzleEls = flashRef.current.map((f) => (
    <i
      key={f.key}
      className={`app-bts-muzzle${f.small ? " is-small" : ""}`}
      style={{
        left: f.x,
        top: f.y,
        color: f.color,
        animationDelay: `${f.delay ?? 0}ms`,
      }}
    />
  ))

  /* 无人机机群层（2026-09-10 船长批；每型上限 6 架 + ×N 徽标）——
     数据源 = 射程弧里已合并的「机型 ×N」无人机条目（src='drone'）；渲染按单位锚点定位，
     未来副本机制的多船舰队只要把友军单位的机群也喂进这一层即可（接口已按单位设计）。
     单轮时序（与弹道同源）：放出 →（去程 0.56s）→ 到阵位即开火 → 立刻掉头返航（0.62s）→ 收舱待命。 */
  /**
   * 我方机群机体层（2026-09-14 船长「逐舰机群」）：**逐舰**出机体——数据源 = core 视图里每艘
   * 编队舰自己的 `myUnits[].drones`（按该舰**存活**池归并）。主控那条与旧口径同源（同 artId、
   * 同架数、同锚点）⇒ 单船路径与主控路径逐像素不变。
   * ⚠ 键从 `artId` 改成 **`舰tag:artId`**（与敌方那侧 `${tag}:${artId}` 同构）：机体元素表、
   *   出击状态表、上一帧机体数表与弹道侧**四处必须用同一个键**，否则击落演出会找不到机体。
   */
  const droneWings = arcs.myUnits.flatMap((u) =>
    (u.drones ?? []).map((d) => {
      const key = `${u.tag}:${d.artId}`
      // **兜底取机型**（2026-09-12）：漏登记机型时画"未知机型"灰机体 + 名字回退成 id，
      // 不再静默消失（G 族蜂群机曾因漏登记而在战斗里看不见）。
      const model = droneModelOrFallback(d.artId)
      const st = droneSortieRef.current.get(key)
      const cycleMs = DRONE_SORTIE_OUT_MS + DRONE_DWELL_MS + DRONE_SORTIE_BACK_MS
      const elapsed = st ? now - st.startAt : Number.POSITIVE_INFINITY
      const phase: 'out' | 'back' | 'deck' = model.resident
        ? 'out'
        : elapsed < DRONE_SORTIE_OUT_MS + DRONE_DWELL_MS
          ? 'out'
          : elapsed < cycleMs
            ? 'back'
            : 'deck'
      const show = model.resident ? 1 : Math.max(1, Math.min(d.count, DRONE_SHOW_MAX))
      // 记下本帧渲染的机体数：下一拍的击落演出靠它定位"即将消失的末位机体"（见 fx 消费处）
      dronePrevShowRef.current.set(key, show)
      return {
        key,
        owner: u.tag,
        artId: d.artId,
        model,
        phase,
        elapsed,
        st,
        show,
        total: d.count,
      }
    }),
  );
  /** 敌方机群（第二层）：与 `droneWings` 同构——起点换成**敌舰机库口**、阵位在**我方舰旁**（镜像） */
  const foeWings = (arcs.foeDrones ?? []).filter((w) => w.alive > 0);
  /** 交给 rAF 驱动层：布局元数据 + 各机型机群（含本轮出击状态）；位置计算完全走 dronePoseAt */
  visDistRef.current = visM
  droneDriveRef.current = {
    foeSizes,
    meSize,
    openM,
    nearM,
    meAnchors: meAnchorByTag,
    wings: [
      ...droneWings.map((w) => ({
        key: w.key,
        owner: w.owner,
        artId: w.artId,
        model: w.model,
        show: w.show,
        st: w.st,
        deck: w.phase === 'deck',
      })),
      // **敌机也交给同一套驱动**（2026-09-11 S5 修正）：旧版敌机机体不在 `wings` 里 ⇒ 机群层盒子
      // 从未被平移到我方舰位（玩家不带无人机时 `d.wings` 为空）⇒ 敌机位置全错、还随布局漂移。
      ...foeWings.map((w) => {
        const sk = `${w.tag}:${w.artId}`
        const fcyc0 =
          DRONE_SORTIE_OUT_MS + DRONE_DWELL_MS + DRONE_SORTIE_BACK_MS;
        // **首轮也要飞出来**（船长 2026-09-11：「进入敌方射程后，敌方无人机似乎第一次不会飞出」）：
        // 出击状态原先只在"该机**开火**"那一刻才盖章 ⇒ 敌机的**第一发**是在机体还没出现时打出来的。
        // ⚠ **但不能"机群一出现就起一轮"**（船长 2026-09-11 追加：「每次进入战斗界面时，敌机会
        //   固定飞出一次」）：本 ref 是**组件内的**，重进战斗界面会重挂 ⇒ 又初始化一次 ⇒ 多飞一趟。
        // ⇒ 初始值取"**本轮已收舱**"（`startAt = now − 一轮时长`）：机体先停在甲板，
        //   **由它自己的第一发开火**盖章起一轮（机体随之飞出，弹道也按到位延迟显示）——
        //   既不空打、也不会每次重进界面白飞一趟。
        if (!foeSortieRef.current.get(sk)) {
          foeSortieRef.current.set(sk, {
            startAt: now - fcyc0,
            offs: droneRandomOffsets(DRONE_SHOW_MAX),
          })
        }
        const st = foeSortieRef.current.get(sk)
        const fcyc =
          DRONE_SORTIE_OUT_MS + DRONE_DWELL_MS + DRONE_SORTIE_BACK_MS
        const fel = st ? now - st.startAt : Number.POSITIVE_INFINITY
        return {
          artId: w.artId,
          model: droneModelOrFallback(w.artId),
          // **分批出击**（2026-09-12 船长「限制敌机单次出击数量」）：机体数按**本批在空架数**画
          // （引擎在 `foeDrones[].alive` 里已排除在库备用机）——缺省与旧口径一致（= 存活架数）。
          show: Math.min(w.alive, DRONE_SHOW_MAX),
          st,
          // **受击增程**（2026-09-11 船长）：本体挨打后该舰机群阵位后撤（`foeDroneStation`）
          rangeBuff: w.rangeBuff === true,
          // **收舱待命 = 不显示**（与我方同款：`is-deck` 走 CSS `display:none`）。
          // ⚠ 旧版常显 ⇒ 敌机在每轮之间**停在敌舰甲板上朝右不动**（船长实测："初始位于敌舰尾部、
          //   朝向朝右"）——敌机的可见时段应当与我方一致：只有出海那 1.4 秒。
          deck: !st || fel >= fcyc,
          foe: w.tag,
        }
      }),
    ],
  }

  /**
   * **机库备用机**（2026-09-12 船长：「关于战斗画面的后备机库，将其显示在名字边上，采用图标乘以数字的形式」
   * → 追加选定「**乙**：显示**全队合计**」）。
   *
   * 引擎按舰报 `hangar`（在库待命、战损后按 `respawnMs` 满血放出的架数）。
   * ⚠ **按舰取一次、不能累加**：同一艘舰的多个机型条目上带的是**同一个按舰数值**
   *   （`battleView` 里 `hangarN` 是每舰一个，却盖在 `byArt` 的**每一条**上）⇒ 逐条累加会翻倍。
   * 显示口径 = **全队合计**（各舰之和，如奥罗 = 5+5+5 = 15）挂在**主体**名字右边的「图标 ×N」上
   *   （主体不带库时退首个带库的舰；无备用机不占位）；图标用既有 `drone-rack`。
   */
  const hangarByTag = foeHangarByTag(arcs.foeDrones ?? [])
  const hangarTotal = foeHangarTotal(arcs.foeDrones ?? [])
  const hangarCarrierTag =
    foeRowTags.find((t) => isFoeMainTag(t) && (hangarByTag.get(t) ?? 0) > 0) ??
    foeRowTags.find((t) => (hangarByTag.get(t) ?? 0) > 0) ??
    null
  const hangarBadgeOf = (tag: string): ReactNode => {
    if (tag !== hangarCarrierTag || hangarTotal <= 0) return null
    return (
      <span
        className="app-bts-hangar"
        title={tr("ui.BattleScreen.035")}
      >
        <span className="app-ico">
          <Glyph name="drone-rack" size={11} color={ICO_TONES['drone-rack']} />
        </span>
        ×{hangarTotal}
      </span>
    )
  }

  /* 敌方单位行（2026-09-09 二轮：存活单位 + 演出期尸骸同队列渲染）——
     尸骸占原槽整段演出：boomAt（致死弹道着弹）前原样停留 → 灰化 + 爆炸环 → 原位淡出；
     撤出只发生在整批尸骸全部演完的瞬间（一次收拢，见 scanDroppable），存活舰补位收拢
     不再压着爆炸/淡出动画走，多个单位同时阵亡也不再互相挤位叠加。
     2026-09-10 性能修复（船长"击毁敌人后画面明显卡顿"）：存活与尸骸**共用同一套 DOM 结构**
     （此前两个分支结构不同 → 击毁瞬间整份舰体 SVG 被卸载重建，正是卡顿主因）——
     现只切换 class（is-corpse）与淡出透明度，舰体矢量始终不被重建。 */
  /** 敌方机群（2026-09-11 机群批 S5）：按敌单位 tag 取该舰的警戒机群（机型 / 机库 / 现存架数）＋
   *  **逐舰体积/血条几何**（主树 2026-09-11 舰种体积 + 血条跟舰；2026-09-12 斜向菱形阵形） */
  const foeUnitEls = foeRowTags.map((tag, rowIdx) => {
    const isMain = isFoeMainTag(tag)
    /** 该舰体积（px；2026-09-11 舰种体积 = 舰级档阶梯，旧路径卡回落 170/90） */
    const size = lay.sizes[rowIdx] ?? LAY.MAIN
    /** 该舰机位（2026-09-12 斜向菱形：第 2/4/6… 艘在第二排＝右移半格 + 下移一个舰高） */
    const slot = foeFormation.slots[rowIdx] ?? { col: 0, row: 0 as const, dx: 0, raise: 0 }
    /** 第二排：舰名改由血条标签承载（浮空舰名会压在**第一排**的舰体上） */
    const isRank2 = slot.row === 1
    /** 该舰血条几何（2026-09-11 船长③：血条跟着各舰走——贴各自舰下，拥挤时该排内竖排） */
    const bar = foeBarGeoms[rowIdx] ?? { width: 185, dx: 0, dy: 0 }
    const ba = corpseAtRef.current.get(tag)
    const sinceBoom = ba === undefined ? -1 : now - ba
    const corpseOn = sinceBoom >= 0 // 致死弹道着弹后才是真尸骸；着弹前原样停留
    const locked = !corpseOn && tag === combat.lockTag
    const boomLive = corpseOn && sinceBoom < BOOM_LIFE
    const fadeT = sinceBoom >= BOOM_LIFE ? clamp01((sinceBoom - BOOM_LIFE) / WRECK_FADE_MS) : 0
    /** 本舰是否正在**飞入**（逐舰入场：首波按 `arrivalSide`，此后按引擎 `enteredAtMs`） */
    const arriving = foeArriving(tag)
    return (
      <div
        key={tag}
        data-tag={tag}
        className={`app-bts-unit${corpseOn ? ' is-corpse' : ''}${locked ? ' is-locked' : ''}${arriving ? ' is-arriving' : ''}`}
        /* 列内居中微调（窄舰在本列里居中；等宽编成为 0）——纵向位置由**所在排**决定，不用 top 偏移。
           入场期（is-arriving）另带三个变量：起点位移 / 时长 / 错峰——**只做动画**，不留任何布局改动 */
        style={
          arriving
            ? ({
                ...(slot.dx !== 0 ? { marginLeft: slot.dx } : {}),
                '--arrive-dx': `${arriveDxFoe(rowIdx)}px`,
                '--arrive-ms': `${ARRIVAL_FLY_MS}ms`,
                // 逐舰错峰：首波仍按行序（`arrivalSide` 那档，与改造前一致）；此后**已烘进 `enteredAtMs`**
                // （引擎写的就是"本条舰的入场时刻"）⇒ 界面不再重复叠一层延迟
                '--arrive-delay': `${arrivalSide === 'foe' ? rowIdx * ARRIVAL_STAGGER_MS : 0}ms`,
              } as CSSProperties)
            : slot.dx !== 0
              ? { marginLeft: slot.dx }
              : undefined
        }
      >
        {/* 淡出作用于舰体容器（外层 .app-bts-unit 有入场动画 fill 占位，透明度须压在子层）；
            尸骸灰化 = accent 传灰（2026-09-10 性能：不再用 CSS 滤镜重新栅格化整份舰体矢量） */}
        <span className="app-bts-corpse" style={fadeT > 0 ? { opacity: Math.max(0, 1 - fadeT) } : undefined}>
          <ShipSprite
            foeKey={foeKey}
            flip={foeFlip}
            accent={corpseOn ? '#6b7280' : FOE_ACCENT[foeKey] ?? '#ff8373'}
            size={size}
          />
        </span>
        {/* 舰名：**第一排**浮在舰体上方（与改动前一致）；**第二排**（其上方是第一排的舰体）改由该舰血条标签承载
            机库备用机（图标 ×N）跟在**各自的名字右边**（2026-09-12 船长） */}
        {!isRank2 ? (
          <span className="app-bts-name" style={{ color: isMain ? '#ffb3a6' : '#d8a08f' }}>
            {locked ? `◈ ${foeNameOf(tag)}` : foeNameOf(tag)}
            {hangarBadgeOf(tag)}
          </span>
        ) : null}
        {/* 血条（2026-09-11 船长③）：贴在本舰正下方（绝对定位，不参与行内布局）；
            尸骸不显示血条（与改造前"只给存活单位画条"一致） */}
        {!corpseOn ? (
          <span
            className="app-bts-hpWrap is-unitBar"
            style={{ width: bar.width, marginLeft: bar.dx, marginTop: bar.dy + 2 }}
          >
            <HpTri
              hp={combat.foeHp[tag]!}
              max={arcs.maxHp.foe[tag] ?? { s: 0, a: 0, h: 0 }}
              label={
                isRank2 ? (
                  <>
                    {locked ? '◈ ' : ''}
                    {foeNameOf(tag)}
                    {hangarBadgeOf(tag)}
                  </>
                ) : undefined
              }
            />
          </span>
        ) : null}
        {/* 敌方机群由**机群层**统一出海（第二层，见 `.app-bts-drones` 内的 foeWings 渲染） */}
        {boomLive ? (
          <span className="app-bts-boom">
            <i className="b-core" />
            <i className="b-ring" />
            <i className="b-ring r2" />
          </span>
        ) : null}
      </div>
    )
  })

  return (
    <div className="app-battle-screen">
      <div className="app-battle-screen-top">
        {stage === 'live' ? (
          <>
            {/**
             * **洞内战斗画面不许退出**（船长 2026-09-13：「虫洞中的战斗画面不可以退出」）：
             * 按钮留着但**禁用**（让玩家知道平时这里有个出口），悬停写明原因；
             * 洞外战斗照旧可退出（那只是"看着打"，引擎自己推进）。
             */}
            <button
              className="app-btn is-small"
              disabled={inWormhole}
              onClick={onClose}
              title={inWormhole ? tr("ui.BattleScreen.036") : undefined}
            >
              {tr("ui.BattleScreen.037")}
            </button>
            {/* 洞内战斗**不给撤退**（船长 2026-09-12 第 8 条：战斗一开必须打完；撤离只在层末发起） */}
            {inWormhole ? (
              <span className="app-dim app-bts-noretreat" title={tr("ui.BattleScreen.038")}>
                {tr("ui.BattleScreen.039")}
              </span>
            ) : (
              <button
                className={`app-btn is-small is-warn${retreatAsk ? ' is-danger' : ''}`}
                title={tr("ui.BattleScreen.040")}
                onClick={() => {
                  if (!retreatAsk) {
                    setRetreatAsk(true)
                    onToast('撤退 = 轻损脱离（仅损失少量舰船耐久、无弃船风险、不收维修费）——再点一次确认。', true)
                    return
                  }
                  setRetreatAsk(false)
                  const r = engine.retreatNow()
                  if (!r.ok) onToast(r.error ?? '撤退失败', true)
                }}
              >
                {retreatAsk ? tr("ui.ActivityBar.024") : tr("ui.BattleScreen.041")}
              </button>
            )}
          </>
        ) : (
          <span className="app-bts-outro-tag">{ended ? (defeat ? tr("ui.BattleScreen.042") : tr("ui.BattleScreen.043")) : ''}</span>
        )}
        <span className="app-gold">{sceneName}</span>
        <span className="app-dim">
          {tr("ui.BattleScreen.044")} {secs}{tr("ui.BattleScreen.045")} {meStats.meShots}{tr("ui.BattleScreen.046")} {meStats.meHits} · 敌开火 {meStats.foeShots}{tr("ui.BattleScreen.046")} {meStats.foeHits}
        </span>
      </div>

      {/* **我方编队条已撤**（2026-09-13 F2b · 交接卡 §3 建议）：4 舰读数改为**直接画在各自的舰影上**
          （舰名 + 三层血条 + 主控徽标 + 沉没灰态）⇒ 同一读数不再出现两遍。
          若船长要留，恢复成"折叠一行"的紧凑读数即可（原实现见 git 历史：`.app-bts-fleet` 那一块）。 */}

      <div className="app-bts-stage">
        {/* **洞内倍速**（船长 2026-09-19：位置 = 顶部中间、距离条上方；只显示已解锁档）——
            倍速只压战斗进程，演出动画（入场/转场/击杀慢镜）照原速播，见 `battleShowWindowMs`。 */}
        {speedOptions.length > 1 ? (
          <div className="app-bts-speedx">
            <span className="app-dim">{tr("ui.BattleScreen.047")}</span>
            {speedOptions.map((x) => (
              <button
                key={x}
                className={`app-btn is-small${x === speedActive ? ' is-active' : ''}`}
                title={
                  x === 1
                    ? tr("ui.BattleScreen.048")
                    : `战斗进程 ×${x}：同样的现实时间里打得更快；入场/转场/击杀演出仍按原速播放`
                }
                onClick={() => engine.setWormholeSpeed(x)}
              >
                ×{x}
              </button>
            ))}
          </div>
        ) : null}
        {/* 距离尺（游标式）：左 = 远（拉开）→ 右 = 近（贴脸）；与下方滑条同轴同比例 */}
        <div className="app-bts-ruler">
          {/* **双方速度**（2026-09-16 船长：「在上方的距离条两端的上方分别显示敌我的战斗速度」；
              同日裁「只修改战斗显示数值，实际数值不变动」）：
              左端 = 我方（舰队在左）· 右端 = 敌方；口径 = **与装配页「机动速度」同一把尺**
              （单位速度 × 机动倍率，逐单位平均；我方点火期含推进器倍率、敌方冲锋期含冲锋倍率）。
              缺省（未开火/老档）不显示这一行。 */}
          {arcs.meSpeedMps !== undefined || arcs.foeSpeedMps !== undefined ? (
            <div className="app-bts-ruler-speed">
              <span
                className="app-bts-speed is-me"
                title={tr("ui.BattleScreen.049")}
              >
                {tr("ui.BattleScreen.050")} {Math.round(arcs.meSpeedMps ?? 0).toLocaleString('zh-CN')} m/s
              </span>
              <span
                className="app-bts-speed is-foe"
                title={tr("ui.BattleScreen.051")}
              >
                {tr("ui.BattleScreen.052")} {Math.round(arcs.foeSpeedMps ?? 0).toLocaleString('zh-CN')} m/s ▶
              </span>
            </div>
          ) : null}
          <div className="app-bts-ruler-head">
            <span className="app-dim">{tr("ui.BattleScreen.053")} {Math.round(openM).toLocaleString('zh-CN')}m）</span>
            <span className="app-dim">{tr("ui.BattleScreen.054")} {Math.round(nearM).toLocaleString('zh-CN')}m）▶</span>
          </div>
          <div className="app-bts-scale">
            <i className="app-bts-zone is-me" style={{ left: `${pct(mainMeArc?.maxM ?? openM)}%`, width: `${Math.max(0.6, pct(mainMeArc?.minM ?? 0) - pct(mainMeArc?.maxM ?? openM))}%` }} title={`我方主武器有效 ${mainMeArc?.minM ?? 0}~${mainMeArc?.maxM ?? 0}m`} />
            <i className="app-bts-zone is-foe" style={{ left: `${pct(arcs.foe.maxM)}%`, width: `${Math.max(0.6, pct(arcs.foe.minM) - pct(arcs.foe.maxM))}%` }} title={`敌方射程 ${arcs.foe.minM}~${arcs.foe.maxM}m`} />
            <i className="app-bts-tick" style={{ left: '25%' }} />
            <i className="app-bts-tick" style={{ left: '50%' }} />
            <i className="app-bts-tick" style={{ left: '75%' }} />
            <i className="app-bts-cursor" style={{ left: `${pct(visM)}%` }} />
            <span className="app-bts-cur-chip" style={{ left: `${pct(visM)}%` }}>
              {Math.round(visM).toLocaleString('zh-CN')}m
            </span>
          </div>
        </div>

        {/* 战场：两舰列间距 = 引擎真实距离（交火中 100ms 一拍）；弧线 = 武器射程 */}
        <div
          className={`app-bts-lane${defeat ? " is-defeat" : ""}`}
          ref={laneRef}
        >
          {/* 窄屏（手机竖屏）提示：舞台（标尺＋车道）横向可滑动（`.app-bts-swipehint` 只在 ≤640px 显示） */}
          <span className="app-bts-swipehint">{tr("ui.BattleScreen.055")}</span>
          {/* 星空背景（三层视差、左右无缝循环；位于战场最底层，低对比不干扰分辨） */}
          <div className="app-bts-stars" aria-hidden="true">
            {starField.map(({ cfg, pts }, li) => (
              <div
                key={cfg.cls}
                className={`app-bts-star-layer ${cfg.cls}`}
                ref={(el) => {
                  starLayerRefs.current[li] = el
                }}
              >
                {pts.map((p, k) => (
                  <i key={`a${k}`} className="app-bts-star" style={{ left: p.x, top: p.y, width: p.r, height: p.r, opacity: p.o }} />
                ))}
                {pts.map((p, k) => (
                  <i key={`b${k}`} className="app-bts-star" style={{ left: p.x + Math.max(60, dims.W), top: p.y, width: p.r, height: p.r, opacity: p.o }} />
                ))}
              </div>
            ))}
          </div>
          {/* 入场效果**不再是一层覆盖图形**：改为入场那侧**舰船本体**飞入（我方列见下方 `is-arriving`、
              敌方逐舰见 `foeUnitEls` 的 `is-arriving`）——2026-09-13 船长二次裁定：
              「舰船从屏幕外以减速的形式进场并落到舰船战斗位置。这里只影响动画。不影响舰船实际位置。」
              旧的「泳道中线跃迁环 + 尾迹 + 闪光」覆盖层与此处的挂载点一并删除。 */}
          <svg className="app-bts-arcs" width="100%" height="100%" aria-hidden="true">
            {/* attribute transform（在无 viewBox/CSS-transform 兼容性问题上最可靠）；平滑由 33ms 视觉插值提供 */}
            <g transform={`translate(${meGunX} ${lay.me.y})`}>{meArcEls}</g>
            <g transform={`translate(${foeGunX} ${lay.foe[0]?.y ?? 0}) scale(-1 1)`} opacity={foeInBand ? 0.25 : 1}>
              <path d={fanPath(foeR0, foeR1)} fill={foeColor} fillOpacity={0.16} />
              <path d={ringPath(foeR1)} fill="none" stroke={foeColor} strokeWidth={2.4} strokeOpacity={0.9} />
              {arcs.foe.minM > 0 ? <path d={ringPath(foeR0)} fill="none" stroke={foeColor} strokeWidth={1} strokeDasharray="3 5" strokeOpacity={0.5} /> : null}
            </g>
            {/* 弧端米数刻度：弧长与面板/图例数字一一对应（敌方标签置于组外避免镜像反转） */}
            {mainMeArc && meMainR1 > 0 ? (
              <text className="app-bts-arc-label" x={meGunX + meMainR1 + 4} y={lay.me.y + 4} textAnchor="start">
                {mainMeArc.maxM.toLocaleString('zh-CN')}m
              </text>
            ) : null}
            <text className="app-bts-arc-label" x={foeGunX - foeR1 - 4} y={(lay.foe[0]?.y ?? lay.me.y) + 4} textAnchor="end">
              {arcs.foe.maxM.toLocaleString('zh-CN')}m
            </text>
          </svg>

          {/* 我方舰列 —— 单船（远征 / 遭遇 / 教学）与 **4 舰同屏**（虫洞 F2b）共用这一支。
              · **单船路径**（`myUnits.length === 1`）：渲染与原实现**逐字一致**（同一 class / ref / style），
                ⇒ 观感零变化（交接卡验收第 5 条）；
              · **多舰路径**（虫洞 4 舰）：逐舰一条舰影，**主控保持原位**（距离尺与弹道锚点仍按主控那条舰，
                逐舰锚点是另一批的活）；其余 3 条沿纵队向左错位 `MY_LANE_STAGGER`×序号（近处=主控在最前，
                故 DOM 顺序把主控放最后 = 画在最上层）；
              · 每条各带**舰名 + 三层血条**（同一支 `HpTri`）、主控徽标（沿用编队条样式）、
                **沉没舰位置保留**只转灰（抽走会让其余舰影跳动 —— 验收第 4 条）；
              · 入场动画照旧：整列 `is-arriving` 自左缘外飞入，**逐舰 `--arrive-delay` 错峰**，
                只走 transform/opacity、落点坐标不动（验收第 6 条）。 */}
          {multiMe
            ? myDrawOrder.map(({ u, slot }, drawIdx) => {
                const def = fleetDefOf(state, engine.ctx, u.shipId)
                const role: ShipRole = def?.role ?? 'industrial'
                const spriteSize = sizeOfUnit(def?.tier, false)
                // **镜像斜向菱形**：锚点 = `lay.my[slot]`（主控那条恒等于 `me`，故距离尺/弹道不偏）
                const anchor = lay.my[slot] ?? lay.me
                const left = Math.round(anchor.x - spriteSize / 2)
                const top = Math.round(anchor.y - (spriteSize * 0.46) / 2)
                return (
                  <div
                    key={u.tag}
                    className={`app-bts-col is-me${defeat && u.leader ? ' is-crippled' : ''}${u.alive ? '' : ' is-down'}${arrivalSide === 'me' ? ' is-arriving' : ''}`}
                    style={
                      arrivalSide === 'me'
                        ? ({
                            left,
                            top,
                            '--arrive-dx': `${arriveDxMe}px`,
                            '--arrive-ms': `${ARRIVAL_FLY_MS}ms`,
                            '--arrive-delay': `${(u.leader ? 0 : drawIdx + 1) * ARRIVAL_STAGGER_MS}ms`,
                          } as CSSProperties)
                        : { left, top }
                    }
                  >
                    <span className="app-bts-name">
                      {u.name}
                      {u.leader ? <i className="app-bts-fleet-lead">{tr("ui.BattleScreen.031")}</i> : null}
                    </span>
                    <ShipSprite
                      /**
                       * ⚠ **画舰影要用 `defId`（船型 id），不是 `shipId`（编队 uid）** ——
                       * 船长 2026-09-14 报障「**在虫洞内，友方舰船的图形不正确**」的真因：
                       * 这里原先传 `u.shipId`（形如 `sh-thresher#3`）⇒ `SHIP_ART['sh-thresher#3']`
                       * 查不到 ⇒ **退回 role 兜底剪影**，洞里 4 条友舰全成了通用轮廓。
                       */
                      shipId={u.defId}
                      role={role}
                      accent={ROLE_ACCENT[role]}
                      size={spriteSize}
                      flip={meFlip}
                    />
                    {u.alive ? (
                      /**
                       * **血条宽度跟同排间距走**（2026-09-14 船长：「同一排舰船的间距可以再拉开一些，
                       * 目前会遮挡血条上的数字」）：`lay.myBarW` 由 `layout()` 按同排实际间距现算
                       * （= `间距 − 6`，上限 185 即 CSS 默认值）⇒ 邻舰船体压不到血条右端的数字。
                       * 单船路径没有这个值 ⇒ 落回 CSS 的 185px，逐像素不变。
                       */
                      <div className="app-bts-hpWrap" style={lay.myBarW !== undefined ? { width: lay.myBarW } : undefined}>
                        <HpTri hp={u.hp} max={u.hpMax} />
                      </div>
                    ) : (
                      <span className="app-bts-fleet-down">{tr("ui.BattleScreen.056")}</span>
                    )}
                  </div>
                )
              })
            : (
              <div
                className={`app-bts-col is-me${defeat ? " is-crippled" : ""}${arrivalSide === 'me' ? ' is-arriving' : ''}`}
                ref={meColRef}
                style={
                  arrivalSide === 'me'
                    ? ({ left: lay.meLeft, '--arrive-dx': `${arriveDxMe}px`, '--arrive-ms': `${ARRIVAL_FLY_MS}ms` } as CSSProperties)
                    : { left: lay.meLeft }
                }
              >
                <span className="app-bts-name">{meShip?.name}</span>
                <ShipSprite shipId={meShip?.id} role={meRole} accent={ROLE_ACCENT[meRole]} size={meSize} flip={meFlip} />
                <div className="app-bts-hpWrap">
                  <HpTri hp={combat.meHp} max={arcs.maxHp.me} />
                </div>
              </div>
            )}

          {/* 无人机机群（2026-09-10：蜂鸟/赤鸢/猎鹰 起飞即出击-到位开火-立刻返航；雷鸥哨戒常驻伴飞）；
              位置由 rAF 驱动层直接写 transform（见上），此处只负责结构与显隐。
              **2026-09-11 机群批 S5 第二层**：**敌方机群**（警戒机）也进这一层——同一套出击制，
              只是起点换成**敌舰机库口**、阵位落在**两舰之间**、机体**镜像朝向**（敌机朝我）。 */}
          {/* ⚠ **挂载条件必须把'待播的击落演出'也算上**（2026-09-11 船长：「当最后一架敌机判断击毁时，
              该次攻击动画将会消失（没有飞出攻击返航的动画，也没有返航时爆炸的动画）」）——
              旧口径只看'还有活着的机群'：**最后一架被打掉 ⇒ 该机群归零 ⇒ 整层被卸载**
              ⇒ 连它那一轮正在播的**击落定格/滑行/爆炸**一起消失。 */}
          {droneWings.length > 0 ||
          foeWings.length > 0 ||
          droneDownRef.current.length > 0 ? (
            <div
              className="app-bts-drones"
              ref={droneBoxRef}
              aria-hidden="true"
            >
              {droneWings.map((w) => (
                <div
                  key={w.key}
                  className={`app-bts-wing is-${w.phase}${w.phase === "deck" ? " is-deck" : ""}${w.model.resident ? " is-resident" : ""}${DRONE_STYLE === "sortie" ? " is-sortie" : " is-formation"}`}
                >
                  {Array.from({ length: w.show }, (_, i) => (
                    <span
                      key={i}
                      ref={(el) => {
                        const key = `${w.key}|${i}`
                        if (el) droneElsRef.current.set(key, el)
                        else droneElsRef.current.delete(key)
                      }}
                      className="app-bts-drone"
                      style={{ left: 0, top: 0, color: w.model.tint }}
                    >
                      <svg
                        viewBox="-13 -8 26 16"
                        width="22"
                        height="14"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinejoin="round"
                      >
                        {w.model.art}
                      </svg>
                    </span>
                  ))}
                  {w.total > w.show ? (
                    <span className="app-bts-drone-more">×{w.total}</span>
                  ) : null}
                </div>
              ))}
              {/* ── **敌方机群（第二层）**：从**敌舰机库口**放出 → 飞抵**两舰之间** → 到位开火 → 掉头返航 ──
                  与我方**同一套出击制**（放出 0.56s / 停留 0.22s / 返航 0.62s · 每架一条弧线），
                  只是**起点换成敌舰**、阵位落在两舰之间（弹道层同口径：`敌舰锚点 − 42~68px`）、
                  **机体镜像朝向**（出海朝我、返航掉头）。本轮起点由弹道层在首次开火时盖章（`foeSortieRef`）。
                  坐标以本层原点（＝我方舰位）为基准——与击落演出 `d.x - lay.me.x` 同源。 */}
              {foeWings.map((w) => {
                const model = droneModelOf(w.artId)
                if (!model) return null
                const show = Math.min(w.alive, DRONE_SHOW_MAX);
                // 收舱待命段与我方同款：加 `is-deck` ⇒ CSS `display:none`（不再"停在敌舰甲板上朝右不动"）
                const fst = foeSortieRef.current.get(`${w.tag}:${w.artId}`)
                const fcyc2 =
                  DRONE_SORTIE_OUT_MS + DRONE_DWELL_MS + DRONE_SORTIE_BACK_MS
                const fel2 = fst ? now - fst.startAt : Number.POSITIVE_INFINITY
                const onDeck = !fst || fel2 >= fcyc2;
                // 位置**不在这里算**：与本方机群一样交给 rAF 驱动层（`droneDriveRef.wings` 里带 `foe` 的那些），
                // 驱动按 `foePoseAt` 写 transform（含 translate(-50%,-50%) 居中与 scaleX(heading) 朝向）。
                // ⚠ 旧版在这里自己写 left/top ⇒ 机群层盒子只有"我方有机群"时才被平移到我方舰位，
                //   玩家不带无人机时敌机全部落在未平移的盒子里（船长实测：位置错、还随布局漂移）。
                return (
                  <div
                    key={`foe-${w.tag}-${w.artId}`}
                    className={`app-bts-wing is-sortie${onDeck ? " is-deck" : ""}`}
                  >
                    {Array.from({ length: show }, (_, i) => (
                      <span
                        key={i}
                        ref={(el) => {
                          const k = `foe:${w.tag}:${w.artId}|${i}`
                          if (el) droneElsRef.current.set(k, el)
                          else droneElsRef.current.delete(k)
                        }}
                        className="app-bts-drone"
                        style={{ color: model.tint }}
                      >
                        <svg
                          viewBox="-13 -8 26 16"
                          width="22"
                          height="14"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.2"
                          strokeLinejoin="round"
                        >
                          {model.art}
                        </svg>
                      </span>
                    ))}
                    {w.count > show ? (
                      <span className="app-bts-drone-more">×{w.alive}</span>
                    ) : null}
                  </div>
                )
              })}
              {/* 被点防击落的机体：原位小爆炸 + 碎片下坠（截图位与机体同一坐标系，见 .app-bts-drone-wreck） */}
              {droneDownRef.current.map((d) => {
                const model = droneModelOf(d.artId)
                if (!model) return null
                const age = now - d.born;
                // ① **原地定住**（船长 2026-09-11：「所有无人机被判定击落时，在返航到一半的途中
                //    原地停止然后爆炸」）——先让机体**停在被打中的那一刻的位置**约 0.32 秒
                //    （不消失、不动），玩家才看得清"是这一架被打下来了"，然后才炸。
                if (age < DRONE_DOWN_FREEZE_MS) {
                  // ① **继续往回飘 1/3 段**（船长：「爆炸的时间点定在返航到 1/3 的途中」）——
                  //    机体在被打中后的 `DRONE_DOWN_FREEZE_MS` 内从被打中的位置滑向爆炸点，然后才炸。
                  const u = Math.max(
                    0,
                    Math.min(1, age / DRONE_DOWN_FREEZE_MS),
                  )
                  const gx = d.x + (d.tx - d.x) * u
                  const gy = d.y + (d.ty - d.y) * u
                  return (
                    <span
                      key={d.key}
                      className="app-bts-drone"
                      style={{
                        position: 'absolute',
                        left: gx - lay.me.x,
                        top: gy - lay.me.y,
                        color: model.tint,
                        transform: 'translate(-50%, -50%)',
                        opacity: 0.9,
                      }}
                    >
                      <svg
                        viewBox="-13 -8 26 16"
                        width="22"
                        height="14"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinejoin="round"
                      >
                        {model.art}
                      </svg>
                    </span>
                  )
                }
                return (
                  <span
                    key={d.key}
                    className={`app-bts-drone-wreck${d.foe ? " is-foe" : ""}`}
                    style={{
                      left: d.tx - lay.me.x,
                      top: d.ty - lay.me.y,
                      color: model.tint,
                    }}
                  >
                    {/* 敌机（警戒机）的击落演出放大 1.5×（2026-09-11 船长：'完全无法察觉'）——
                        族色残铁棕 + 更大的冲击环，让'打下来了'这件事在满屏弹道里也看得见 */}
                    <svg
                      viewBox="-14 -11 28 22"
                      width={d.foe ? 46 : 30}
                      height={d.foe ? 37 : 24}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={d.foe ? 1.6 : 1.2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      {/* **效果 A：白色高亮扩散环**（船长 2026-09-11 选定）——比族色环更亮、线更粗，
                          在满屏弹道里一眼能看见'这一架没了' */}
                      <circle
                        className="app-bts-wreck-ring"
                        cx="0"
                        cy="0"
                        r="5"
                        stroke="#ffffff"
                        strokeWidth="2.4"
                      />
                      {/* 冲击环（向外扩散淡出） */}
                      <circle className="app-bts-wreck-ring" cx="0" cy="0" r="5" />
                      {/* 爆散射线（八向短线） */}
                      <path className="app-bts-wreck-rays" d="M0 -6 L0 -10 M4.4 -4.4 L7.4 -7.4 M6 0 L10 0 M4.4 4.4 L7.4 7.4 M0 6 L0 10 M-4.4 4.4 L-7.4 7.4 M-6 0 L-10 0 M-4.4 -4.4 L-7.4 -7.4" />
                      {/* 崩落碎屑（三片，各自下坠） */}
                      <path className="app-bts-wreck-bit" d="M-3 -1 l2.6 1.2 l-2.6 1.6 z" />
                      <path className="app-bts-wreck-bit is-b" d="M1.6 -2.2 l2.4 1 l-2.2 1.8 z" />
                      <path className="app-bts-wreck-bit is-c" d="M-0.6 2 l2.2 1 l-2 1.6 z" />
                    </svg>
                  </span>
                )
              })}
            </div>
          ) : null}

          {/* 敌方舰列（2026-09-11 船长③：血条跟着各舰走——已随各舰渲染，列底不再竖排血条；
              尸骸原位占槽演出见 foeUnitEls） */}
          <div className="app-bts-col is-foe" ref={foeColRef} style={{ left: lay.foeLeft }}>
            {/* 整行 `margin-top` = 下沉补偿（抬升超出上方留白时才非 0，现值 0）——与 layout 的基线同源 */}
            {/* **敌列阵形：斜向菱形**（2026-09-12 船长「2×2 菱形 → 斜向菱形、第二排向右偏移」选丙②）：
                两排各若干舰，**第二排右移半格 + 下移一个舰高**（`layout` 的阵形几何是唯一出处）；
                外层定宽块 = 编队总宽（由列宽推得），列高固定为单排行高 ⇒ DOM 与锚点逐像素对齐。 */}
            <div style={{ width: foeFormation.rowW }}>
              <div className="app-bts-shipRow" style={{ minHeight: foeFormation.rowH }}>
                {foeUnitEls.filter((_, i) => foeFormation.slots[i]?.row !== 1)}
              </div>
              {foeFormation.rows === 2 ? (
                <div
                  className="app-bts-shipRow"
                  /* 2026-09-13 船长：「第二排下移，目前会挡住第一排血条（敌我都移动）」——
                     第二排容器再加 `ROW2_BAR_DROP`（一条血条高 + 6 缝隙，与 `layout` 的锚点同源同值），
                     让第二排舰体顶边落到第一排血条**之下**；第一排容器一律不动。 */
                  style={{ minHeight: foeFormation.rowH, marginLeft: foeFormation.shift, marginTop: ROW2_BAR_DROP }}
                >
                  {foeUnitEls.filter((_, i) => foeFormation.slots[i]?.row === 1)}
                </div>
              ) : null}
            </div>
            {/* **机库余量**（2026-09-12 船长：由"敌舰列下方一行 chip"改为**跟着各舰名字**显示
                「图标 ×N」——见 `hangarBadgeOf`）：此处不再单独出一行。 */}
          </div>

          {/* **战斗窗口正上方提示位**（2026-09-11 船长：与"敌方增援"统一下系统、位置由"敌舰上方"
              改到**战斗窗口正上方**）：波次增援 + 引擎推来的战斗提示（如受击增程）共用这一处。 */}
          {noticeItems.length > 0 ? (
            <div className="app-bts-notices">
              {noticeItems.map((n) => (
                <span key={n.key} className="app-bts-wave-hint">
                  {n.text}
                </span>
              ))}
            </div>
          ) : null}

          {/* **劫掠捕获网连线**（船长 2026-09-16）：持续态，画在弹道层**之下**，不挡弹道 */}
          {webEls}
          {/* 开火闪光 + 弹道 + 撞点特效（最上层） */}
          {muzzleEls}
          {boltEls}
        </div>
      </div>

      {/* 距离控制（收窄居中；战斗已结束时禁用，等战报） */}
      <div className="app-battle-controls">
        <div className="app-bts-dock">
          <div className="app-bts-legends">
            {arcs.me.map((w, wi) => (
              <span key={`lg${wi}`} className="app-bts-chip" title={w.kind === 'gun' && !w.type ? tr("ui.BattleScreen.057") : undefined}>
                <i style={{ background: w.type ? DMG_COLOR[w.type] : '#93a4b8' }} />
                {w.label} {w.minM.toLocaleString('zh-CN')}~{w.maxM.toLocaleString('zh-CN')}m
                {w.kind === 'gun' ? (
                  w.type ? (
                    <span className={`app-a-chip app-a-${w.type}`}>{DMG_LABEL[w.type]}{tr("ui.BattleScreen.003")}</span>
                  ) : (
                    '（无弹）'
                  )
                ) : null}
              </span>
            ))}
            {/* 敌方射程（2026-09-11 船长：「敌方的舰船射程不一致，只会显示其中一个的射程」）：
                按**射程带**逐条出 chip（与我方逐武器一条同款），多条带时补「×N 艘」与逐舰悬停说明；
                只有一条带时文本与旧版完全一致（「敌方 X~Ym」）。 */}
            {(arcs.foeBands.length > 0
              ? arcs.foeBands
              : [{ ...arcs.foe, count: 0, names: [] as string[] }]
            ).map((b, bi) => (
              <span
                key={`foe${bi}`}
                className="app-bts-chip is-foe"
                title={
                  b.names.length > 0
                    ? `敌方射程带（${b.names.join(tr("ui.MatterTechTab.017"))}）：${b.minM}~${b.maxM}m` +
                      // 2026-09-16 船长「敌舰悬停展示挂载件」：本带的敌方挂载件挂在同一条悬停里
                      (b.mounts && b.mounts.length > 0 ? ` · 挂载：${b.mounts.join(tr("ui.MatterTechTab.017"))}` : '')
                    : tr("ui.BattleScreen.058")
                }
              >
                <i style={{ background: DMG_COLOR[b.type] }} />
                {tr("ui.BattleScreen.052")} {b.minM.toLocaleString('zh-CN')}~{b.maxM.toLocaleString('zh-CN')}m
                {b.count > 1 ? ` ×${b.count} 艘` : ''}
                <span className={`app-a-chip app-a-${b.type}`}>{DMG_LABEL[b.type]}</span>
              </span>
            ))}
            {/* 敌方冲锋标记（2026-09-10 船长定；**2026-09-14 改逐单位**：可能不止一条在冲）——
                复用同级"运行态 chip"样式（红点 = 告警态），不自造新类。
                ⚠ 冷却不再写死 10 秒：C 族 10 秒、A 族洞内海盗 30 秒（挂载件各自给，见 `FoeMountDef.charge`） */}
            {foeCharging > 0 ? (
              <span className="app-bts-repair is-down" title={tr("ui.BattleScreen.059")}>
                <i /> {tr("ui.BattleScreen.060")}{foeCharging > 1 ? ` ×${foeCharging}` : ''}
              </span>
            ) : null}
            {/* **敌方挂载件**（2026-09-16 船长「要：敌舰悬停/战报展示挂载件」）——有才占位，悬停看全名 */}
            {arcs.foeMounts && arcs.foeMounts.length > 0 ? (
              <span className="app-bts-chip is-foe" title={`敌方挂载件：${arcs.foeMounts.join(tr("ui.MatterTechTab.017"))}`}>
                <i /> {tr("ui.BattleScreen.061")}{arcs.foeMounts.join(tr("ui.MatterTechTab.017"))}
              </span>
            ) : null}
            {ammoChips.length > 0 ? (
              <span className="app-bts-ammo">
                {ammoChips.map((t) => (
                  <span key={t} className={`app-a-chip app-a-${t}`}>
                    {arcs.ammoNames?.[ammoKey(t)] ?? DMG_LABEL[t]}×{arcs.ammo[ammoKey(t)].toLocaleString('zh-CN')}
                  </span>
                ))}
              </span>
            ) : null}
            {repairLedgers.length > 0 ? (
              <span
                className={`app-bts-repair${repairRunning ? "" : " is-down"}`}
                title={
                  (repairRunning
                    ? tr("ui.BattleScreen.062")
                    : tr("ui.BattleScreen.063")) +
                  (repairDetail ? `\n${repairDetail}` : '')
                }
              >
                <i /> {repairRunning ? tr("ui.BattleScreen.064") : tr("ui.BattleScreen.065")}
                <span className="app-dim">{tr("ui.BattleScreen.066")}{repairTotal.toLocaleString('zh-CN')}</span>
              </span>
            ) : null}
          </div>
          {/* 装填冷却平铺（距离条窗口上方）：每件武器一格——色点 + 名称 + 冷却条 + 倒计时/就绪 */}
          <div className="app-bts-reloads">
            {arcs.me.map((w, wi) => {
              const remain = arcs.meReload[wi] ?? 0
              const ready = remain <= 0
              const pct = ready
                ? 100
                : Math.min(100, Math.max(0, ((w.reloadMs - remain) / Math.max(1, w.reloadMs)) * 100))
              const dotColor = w.type ? DMG_COLOR[w.type] : '#93a4b8'
              return (
                <span
                  key={`rl${wi}`}
                  className={`app-bts-reload${ready ? " is-ready" : ""}`}
                  title={
                    ready
                      ? `${w.label}：装填就绪，进入射程即可开火`
                      : `${w.label}：装填中 · 剩 ${Math.max(0.1, Math.ceil(remain / 100) / 10)} 秒`
                  }
                >
                  <i className="app-bts-reload-dot" style={{ background: dotColor }} />
                  <span className="app-bts-reload-name">{w.label}</span>
                  <span className="app-bts-reload-track">
                    <i
                      className="app-bts-reload-fill"
                      style={{ width: `${pct}%`, background: ready ? '#6fd98a' : dotColor }}
                    />
                  </span>
                  <span className="app-bts-reload-ms">
                    {ready ? tr("ui.BattleScreen.067") : `${Math.max(0.1, Math.ceil(remain / 100) / 10)}s`}
                  </span>
                </span>
              )
            })}
            {/* 推进器周期状态（2026-09-10 船长定：点火 60 秒 / 冷却 60 秒 / 开场即点火）——
                复刻同级"装填冷却"格结构（色点 + 名称 + 冷却条 + 倒计时/就绪） */}
            {thruster && arcs && arcs.thrusterBoost > 0 ? (
              <span
                className={`app-bts-reload${thruster.boosting ? " is-ready" : ""}`}
                title={
                  thruster.boosting
                    ? `推进器点火中：战斗中机动 +${Math.round(arcs.thrusterBoost * 100)}%，剩 ${Math.max(0.1, Math.ceil(thruster.remainMs / 100) / 10)} 秒后进入冷却`
                    : `推进器冷却中：剩 ${Math.max(0.1, Math.ceil(thruster.remainMs / 100) / 10)} 秒——冷却期间无加速，回到基础机动`
                }
              >
                <i className="app-bts-reload-dot" style={{ background: thruster.boosting ? '#6fd98a' : '#8aa0b8' }} />
                <span className="app-bts-reload-name">{tr("ui.BattleScreen.004")}</span>
                <span className="app-bts-reload-track">
                  <i
                    className="app-bts-reload-fill"
                    style={{
                      width: `${
                        thruster.boosting
                          ? 100
                          : Math.min(100, Math.max(0, (1 - thruster.remainMs / Math.max(1, engine.ctx.balance.battle.thrusterCooldownMs)) * 100))
                      }%`,
                      background: thruster.boosting ? '#6fd98a' : '#8aa0b8',
                    }}
                  />
                </span>
                <span className="app-bts-reload-ms">
                  {thruster.boosting ? `推进 ${Math.max(0.1, Math.ceil(thruster.remainMs / 100) / 10)}s` : `${Math.max(0.1, Math.ceil(thruster.remainMs / 100) / 10)}s`}
                </span>
              </span>
            ) : null}
          </div>
          <div className="app-bts-sliderRow">
            <span className="app-dim app-bts-sideLabel">{tr("ui.BattleScreen.068")}</span>
            <div className="app-bts-sliderWrap">
              <input
                type="range"
                className="app-battle-range app-bts-range"
                min={0}
                max={1000}
                /**
                 * **步长 1**（2026-09-13 船长反馈"一格一格"）：原 `step=5` 只有 201 个落点——
                 * 在洞内这种 5 千多米的量程上，一格 ≈ 27m，慢拖时肉眼就是"跳格"。
                 * 1 ⇒ 1001 个落点（约 5m/格），拖动与读数都跟手。
                 */
                step={1}
                disabled={ended}
                value={Math.min(1000, Math.max(0, sliderV))}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  // **每帧最多重绘一次**（2026-09-13 性能修）：高回报率鼠标一次拖动能来几百个
                  // input 事件，逐个 setState 会把整棵战场（我方 4 舰 + SVG 弧 + 事件环）重渲染几百次
                  // ⇒ 顿挫。这里合并到 rAF：画面最多 60 次/秒，提交仍按 160ms 节流。
                  pushDragV(v)
                  scheduleCommit(v)
                }}
                onPointerUp={flushDrag}
                onPointerCancel={flushDrag}
                onBlur={flushDrag}
                onKeyUp={flushDrag}
                title={tr("ui.BattleScreen.069")}
              />
              <i className="app-bts-here" style={{ left: `${pct(visM)}%` }} title={tr("ui.BattleScreen.070")} />
            </div>
            <span className="app-dim app-bts-sideLabel">{tr("ui.BattleScreen.071")}</span>
            <span className="app-gold app-bts-desire">{tr("ui.BattleScreen.072")} {sliderToDesire(sliderV).toLocaleString('zh-CN')}m</span>
          </div>
          <div className="app-bts-ops">
            <span className="app-battle-tacs">
              <button className="app-btn is-small" disabled={ended} onClick={() => applyTactic('assault')}>{tr("ui.BattleScreen.073")}</button>
              <button className="app-btn is-small" disabled={ended} onClick={() => applyTactic('mid')}>{tr("ui.BattleScreen.074")}</button>
              <button className="app-btn is-small" disabled={ended} onClick={() => applyTactic('kite')}>{tr("ui.BattleScreen.075")}</button>
            </span>
            <span className="app-dim app-bts-note">
              {ended
                ? tr("ui.BattleScreen.076")
                : tr("ui.BattleScreen.077")}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

/** ammo 缩写键（与核心引擎一致） */
function ammoKey(t: DamageType): 'kin' | 'exp' | 'pla' {
  return t === 'kinetic' ? 'kin' : t === 'explosive' ? 'exp' : 'pla'
}
