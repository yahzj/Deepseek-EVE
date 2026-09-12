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
import type { CSSProperties } from 'react'
import { battleArcsFor, battleTacticDesire, createPlayerSpec, expeditionStatus, fleetDefOf, foeMainTagOf, foeUnitNameOf, thrusterPhase } from '@whale/core'
import type { BattleFx, DamageType, DroneLossReport, ShipRole } from '@whale/core'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'
import { ShipSprite } from '../ui/ShipSprite'
import { FOE_ACCENT, foeFamilyOf } from '../ui/shipArt'
import { mountsOf } from '../ui/shipMounts'
import {
  DRONE_DWELL_MS,
  DRONE_SHOW_MAX,
  DRONE_SORTIE_BACK_MS,
  DRONE_SORTIE_OUT_MS,
  DRONE_FLY_MUL,
  DRONE_STYLE,
  droneArcHeight,
  droneModelOf,
  dronePathPos,
  droneRandomOffsets,
  droneStationFrom,
  droneTakeoff,
} from '../ui/droneArt'
import type { DroneModel, DroneSortie } from '../ui/droneArt'
import {
  BOLT_LOOK,
  DMG_COLOR, DMG_LABEL, DMG_ORDER, ROLE_ACCENT, LAY, NOSE_MAIN, NOSE_ESC,
  FLY_MS, BOLT_LIFE, FLASH_LIFE, BOOM_LIFE, DRONE_DOWN_LIFE,
  STAR_LAYERS, genStars, clamp01, approachOf, layout,
  fanSegs, fanPath, ringPath, HpTri, boltGeom, lastBattleReport,
} from './battleViewCore'
import type { Dims, Anchor, BoltV, FlashV, Stage, OutroSnap } from './battleViewCore'

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

/**
 * **敌方机群姿态**（2026-09-11 机群批 S5）——我方 `dronePoseAt` 的**完整镜像**：
 * 起点 = **敌舰机库口**（`droneTakeoff` 偏移相对敌舰**水平镜像**），阵位 = **我方舰旁**（`lay.me + off`）
 * ——因为敌方机群打的是**我方舰**，锚点就是'要打的那一方'（与我方机群锚敌舰同一条口径）。
 * 朝向：出海/驻留 `heading = -1`（朝我）· 返航 `heading = +1`（掉头）。
 */
function foePoseAt(
  model: DroneModel,
  lane: number,
  st: DroneSortie | undefined,
  lay: { me: Anchor; foe: Anchor[] },
  elapsed: number,
): { x: number; y: number; heading: number } {
  const foeA = lay.foe[0] ?? lay.me
  const tk = droneTakeoff(lane)
  const deck = { x: foeA.x - tk.x, y: foeA.y + tk.y }
  const off = st?.offs[lane % (st.offs.length || 1)] ?? { x: 52, y: 0 }
  const station = { x: lay.me.x + off.x, y: lay.me.y + off.y }
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

export function BattleScreen({ engine, onToast, onClose }: { engine: GameEngine; onToast: ToastFn; onClose: () => void }) {
  const state = engine.state
  const view = expeditionStatus(state, engine.ctx)
  const arcs = battleArcsFor(state, engine.ctx)
  const battle = state.expedition.battle
  /** 推进器周期状态（2026-09-10 船长定：点火 60 秒 / 冷却 60 秒 / 开场即点火）——与引擎同源 */
  const thruster = battle ? thrusterPhase(battle, engine.ctx.balance.battle) : null
  /** 无人机机型 → 实际架数（弹道道次必须落在"实际渲染的机体数"内；见 fx 消费处 2026-09-10 修复） */
  const droneCountOf = new Map<string, number>()
  for (const w of arcs?.me ?? [])
    if (w.src === 'drone' && w.artId) droneCountOf.set(w.artId, w.count ?? 1);
  /** 敌方机群：敌单位 tag + 机型 → **该舰现存架数**（弹道道次取模要用它；敌我各用各的表，见弹道层） */
  const foeDroneAliveOf = (tag: string, artId: string): number =>
    arcs?.foeDrones?.find((d) => d.tag === tag && d.artId === artId)?.alive ??
    1

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
    foeN: number
    openM: number
    nearM: number;
    /** `foe` 有值 = 该机群属于**敌方单位 tag**（走 `foePoseAt` 镜像几何；元素键加 `foe:` 前缀） */
    wings: Array<{
      artId: string
      model: DroneModel
      show: number
      st?: DroneSortie
      deck: boolean
      foe?: string
    }>
  }>({ foeN: 1, openM: 1, nearM: 200, wings: [] });
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
  const flushTimerRef = useRef<number | null>(null)
  const dragValRef = useRef<number | null>(null)
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
        }
        setStage('outro')
      } else if (!view.combat) {
        // 未见到分出胜负战斗就结束了（离线恢复等）：直接关屏，战报看日志
        onClose()
      }
    } else if (stage === 'outro' && !view.combat) {
      // 引擎已结算（killcam 走完）→ 战报文本（resolve 日志已写入）
      const snap = outroRef.current
      // 机群战损结算结果（2026-09-11）：结算刚在这一刻完成，读取结构化结果；
      // 用战斗起手时刻配对，避免并行战斗（AI 副船等）的结果串场
      const dr = state.droneLossReport ?? null
      droneReportRef.current =
        dr && (!snap || dr.battleStartedAtGameMs === snap.startedAtGameMs) ? dr : null
      const report =
        lastBattleReport(state.logs, snap?.startedAtGameMs ?? 0) ??
        (snap?.kind === 'me' ? '大捷：敌方编队全灭，舰队开始返航。' : '失利：舰队被迫撤离，详情见事件日志。')
      reportTextRef.current = report
      setStage('report')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, battle?.ended, view.combat === null])

  // 战报自动关闭：report 展示 12 秒后自动返回（按钮可随时提前关闭）
  // 2026-09-11 船长：「战斗报告持续时间延长」——6 秒 → 12 秒（新增机群回收明细后 6 秒读不完）
  useEffect(() => {
    if (stage !== 'report') return
    const t = window.setTimeout(() => onClose(), 12_000)
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
    const b = engine.state.expedition.battle
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
  }, [engine.state.expedition.battle?.startedAtGameMs])

  // 星空视差速率：基准 = 驾驶船基础战斗速度（装配/技能静态）——每帧再按推进器点火态放大（见 33ms 循环）
  useEffect(() => {
    if (!engine.state.expedition.battle) return
    const spec = createPlayerSpec(engine.state, engine.ctx, engine.state.shipId)
    meSpeedRef.current = spec?.speedMps ?? 200
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine.state.expedition.battle?.startedAtGameMs])

  // 视觉插值：引擎每 ~100ms 一拍；本循环 33ms 在两拍间线性插值，舰列/弧/游标平滑移动
  useEffect(() => {
    const iv = window.setInterval(() => {
      const b = engine.state.expedition.battle
      const now = performance.now()
      if (!b) return
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
      const boostNow = thrusterPhase(b, engine.ctx.balance.battle).boosting ? thrusterBoostRef.current : 0
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
        const layLoop = layout(dimsRef.current, Math.max(1, d.foeN), visDistRef.current, d.openM, d.nearM)
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
          for (let i = 0; i < w.show; i++) {
            const key = w.foe
              ? `foe:${w.foe}:${w.artId}|${i}`
              : `${w.artId}|${i}`
            const el = droneElsRef.current.get(key)
            if (!el) continue
            const pose = w.foe
              ? foePoseAt(w.model, i, w.st, layLoop, elapsed)
              : dronePoseAt(w.model, i, w.st, layLoop, elapsed)
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
    const won = snap?.kind === 'me'
    const durSec = Math.max(1, Math.round((snap?.durMs ?? 0) / 1000))
    const fallback = won ? '敌方编队已全灭。' : '舰队被迫撤离。'
    return (
      <div className="app-battle-screen">
        <div className="app-bts-report">
          <div className={`app-bts-report-card${won ? " is-win" : " is-lose"}`}>
            <div className="app-bts-report-title">
              {won ? '⚔ 大捷' : '⚠ 失利'}
            </div>
            <div className="app-bts-report-text">
              {reportTextRef.current || fallback}
            </div>
            {snap ? (
              <div className="app-bts-report-stats">
                我方开火 {snap.meShots} / 命中 {snap.meHits} · 造成伤害{' '}
                {Math.round(snap.meDmg).toLocaleString('zh-CN')} · 敌方开火{' '}
                {snap.foeShots} / 命中 {snap.foeHits} · 交火 {durSec}s
              </div>
            ) : null}
            {/* 机群战损（2026-09-11 船长：优先回收高价值 + 在战报里显示）：
                第一行 = 汇总（损坏 / 回收归队 / 净损失），第二行 = 逐型明细（回收 ｜ 净损失，按机型价值降序） */}
            {droneReport ? (
              <>
                <div className="app-bts-report-stats is-loss">
                  机群战损：损坏 {droneReport.total} 架 · 回收{' '}
                  {droneReport.recovered} 架归队（回收率{' '}
                  {Math.round(droneReport.rate * 100)}% · 优先回收高价值）·
                  净损失 {droneReport.gone} 架
                </div>
                <div className="app-bts-report-stats is-loss">
                  回收：
                  {droneReport.rows
                    .filter((r) => r.back > 0)
                    .map((r) => `${r.name}×${r.back}`)
                    .join('、') || '无'}
                  {' ｜ '}净损失：
                  {droneReport.rows
                    .filter((r) => r.gone > 0)
                    .map((r) => `${r.name}×${r.gone}`)
                    .join('、') || '无'}
                  （无人机舱清单已扣除，回港需补充）
                </div>
              </>
            ) : snap?.droneLost && Object.keys(snap.droneLost).length > 0 ? (
              <div className="app-bts-report-stats is-loss">
                机群损失：
                {Object.entries(snap.droneLost)
                  .map(([artId, n]) => `${droneModelOf(artId)?.name ?? artId} ×${n}`)
                  .join('、')}
                （无人机舱清单已扣除，回港需补充）
              </div>
            ) : null}
            <div className="app-bts-report-note">奖励/战利品已入账，舰队自动返航中；本报告 12 秒后自动关闭（完整记录见右侧事件日志）。</div>
            <button className="app-btn" onClick={onClose}>
              收下战报 · 返回
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (!view.combat || !battle || !arcs) return null
  const combat = view.combat
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
  const foeAnomaly = state.expedition.anomalyId ? engine.ctx.anomalies.get(state.expedition.anomalyId) : undefined
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
  // 弹道瞄准用的几何（按上一帧撤出结果的视觉行；本帧渲染队列在阵亡检测后定稿重算）
  const layFx = layout(dims, Math.max(1, rowFxTags.length), visM, openM, nearM)

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
          const layDown = layout(
            dims,
            Math.max(1, rowFxTags.length),
            visDistRef.current,
            openM,
            nearM,
          );
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
            const lane = Math.max(0, Math.min(alive, DRONE_SHOW_MAX - 1))
            const pose = foePoseAt(model, lane, st, layDown, elapsed)
            const off = st?.offs[lane % Math.max(1, st.offs.length)] ?? {
              x: 52,
              y: 0,
            }
            const station = {
              x: layDown.me.x + off.x,
              y: layDown.me.y + off.y,
            }
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
            const prevShow =
              downCursor.get(artId) ?? dronePrevShowRef.current.get(artId) ?? 1
            const lane = Math.max(0, Math.min(prevShow, DRONE_SHOW_MAX) - 1)
            downCursor.set(artId, lane)
            const st = droneSortieRef.current.get(artId);
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
      const aimTag = isMeShot ? (fx.to ?? foeAliveTags[0]) : fx.to ?? 'player'
      const aimRowIdx = rowFxTags.indexOf(aimTag)
      let src: Anchor | undefined
      let dst: Anchor | undefined
      if (isMeShot) {
        src = layFx.me
        dst = aimRowIdx >= 0 ? layFx.foe[aimRowIdx] : layFx.foe[0] // 目标已撤（旧尸骸）→ 首位兜底
      } else {
        src = aimRowIdx >= 0 ? layFx.foe[aimRowIdx] : layFx.foe[0] // 发射者（存活敌人）
        dst = layFx.me
      }
      if (!src || !dst) continue
      if (isMeShot && fx.hit) lastHitTypeRef.current.set(aimTag, fx.type) // 记录最近命中形态（击杀延迟用）
      // 舰艏偏移按主/僚判定（多波主舰 w{n}-foe-* 非队列首位同样是大舰艏；2026-09-09 修复）
      const aimMain = isFoeMainTag(aimTag)
      const shooterMain = isFoeMainTag(fx.tag)
      const foeNose = aimMain ? NOSE_MAIN : NOSE_ESC
      const srcNose = isMeShot ? NOSE_MAIN : shooterMain ? NOSE_MAIN : NOSE_ESC
      const dstNose = isMeShot ? foeNose : NOSE_MAIN
      // 2026-09-10 船长批：开火点挂真实炮口——按发射者挂点取 muzzle（多炮口轮换），
      // 无挂点/无原生炮（货矿舰等）→ 传 null 回退舰艏前缘；artW = 发射舰实际显示宽
      // 无人机（src='drone'）例外：弹道自**机群当前悬浮位**起飞（不占母舰炮口轮换）
      const dm = fx.src === 'drone' ? droneModelOf(fx.artId) : undefined
      const artW = isMeShot ? LAY.MAIN : shooterMain ? LAY.MAIN : LAY.ESC
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
        const skey = foeDrone ? `${fx.tag}:${fx.artId}` : fx.artId!
        const smap = foeDrone ? foeSortieRef.current : droneSortieRef.current
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
                Math.min(droneCountOf.get(fx.artId!) ?? 1, DRONE_SHOW_MAX),
              )
          const lane = n % count
          const prev = smap.get(skey)
          const cycleMs =
            DRONE_SORTIE_OUT_MS + DRONE_DWELL_MS + DRONE_SORTIE_BACK_MS
          const st =
            !prev || now - prev.startAt >= cycleMs + 40
              ? { startAt: now, offs: droneRandomOffsets(DRONE_SHOW_MAX) }
              : prev
          smap.set(skey, st)
          const off = st.offs[lane % st.offs.length]!
          const elapsed = now - st.startAt
          if (elapsed < DRONE_SORTIE_OUT_MS) {
            // 仍在出击途中：弹道自阵位出，延到"无人机抵达"那一刻显示
            from = droneStationFrom(anchor, dir, off)
            droneDelay = Math.round(DRONE_SORTIE_OUT_MS - elapsed)
          } else if (elapsed < DRONE_SORTIE_OUT_MS + DRONE_DWELL_MS) {
            // 已到位：阵位出弹，立即显示
            from = droneStationFrom(anchor, dir, off)
          } else if (isMeShot) {
            // 返航中（我方）：弹道就从无人机当前位置出（与机体一致）
            from = dronePoseAt(dm, lane, st, layFx, elapsed)
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
              droneStationFrom(anchor, dir, off),
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

  /* ── 敌方单位被击毁检测（hp 归零的瞬间登记尸骸 + 爆炸计划，演出与战斗是否结束无关）── */
  if (!hpInitRef.current) {
    for (const tag of foeTags) {
      const hp = combat.foeHp[tag]
      prevHpRef.current.set(tag, hp ? hp.s + hp.a + hp.h : 0)
    }
    hpInitRef.current = true
  } else {
    for (const tag of foeTags) {
      const hp = combat.foeHp[tag]
      const sum = hp ? hp.s + hp.a + hp.h : 0
      const prev = prevHpRef.current.get(tag) ?? 0
      prevHpRef.current.set(tag, sum)
      if (sum === 0 && prev > 0 && !deadRef.current.has(tag)) {
        deadRef.current.add(tag) // 刚被击毁：登记尸骸；爆炸延后到致死弹道着弹后再启动
        // 击杀爆炸延迟 = 致死形态的弹道时长（动能 420 / 导弹 760 / 激光 130），
        // 与命中 puff 同时出现——否则导弹击杀会在弹道半途提前变灰/上移
        const killerType = lastHitTypeRef.current.get(tag)
        const killerFly = (killerType ? BOLT_LOOK[killerType]?.fly : undefined) ?? FLY_MS
        corpseAtRef.current.set(tag, now + killerFly)
      }
    }
  }
  // 队列定稿（2026-09-09 二轮）：阵亡检测后再扫一次撤出集——本帧新阵亡的尸骸（boomAt 未到、
  // 演出期长）计入"演出中"，阻止同帧撤出它左侧已完成淡出的旧尸骸（收拢不撞上新爆炸）；
  // 撤出即清演出登记：跨波之后该尸骸永不回队占位（波次尸骸不得挤占新波队列）。
  const dropFinal = scanDroppable()
  for (const tag of dropFinal) corpseAtRef.current.delete(tag)
  const foeRowTags = foeTags.filter((t) => !deadRef.current.has(t) || !dropFinal.has(t))
  const foeN = Math.max(1, foeRowTags.length) // 队列至少保留 1 槽（全灭瞬间布局不退化）
  /* 2026-09-10 说明：列宽重测**不能**在这里用 useEffect —— 本行位于 `if (!view.combat …) return null`
     守卫之后，战斗结束时提前 return 会跳过该 hook，hooks 数量不一致会让 React 卸载整棵树（黑屏无反应）。
     现改为在守卫之前的 33ms 循环里按 ~330ms 节流核对列宽（见该循环 "列宽核对" 段）。 */
  const lay = layout(dims, foeN, visM, openM, nearM)
  /** 波次演出窗口提示（引擎 waveEnterGapMs 内：上一波全灭、下一波尚未抵达） */
  const wavePending = battle.waveClearAt !== undefined && !ended
  const waveNext = wavePending && foeAnomaly?.waves && foeAnomaly.waves.length > 1 ? (battle.waveIdx ?? 0) + 2 : 0

  /* 射程弧：锚定双方舰艏枪口（与弹道同源、随舰身移动）。
     显示尺与舰列间距共用同一米制比例：sPxPerM = usable/(openM−nearM) px/m。
     贴脸基准枪口距 gunBasePx 不用猜测常量，而是由"当前帧实测枪口间距 − 当前距离的像素长"反推：
       gunBasePx = (foeGunX − meGunX) − (visM − nearM)×sPxPerM   （几何常数，随窗口/列宽自动成立）
     于是 弧半径(射程) = gunBasePx + (射程 − nearM)×sPxPerM，当 射程 == 当前距离 时弧端恰好触到敌方枪口；
     弧端到敌枪口的像素缺口正比于"射程 − 当前距离"。 */
  const meGunX = lay.me.x + NOSE_MAIN
  const foeGunX = (lay.foe[0]?.x ?? lay.me.x) - NOSE_MAIN
  const sPxPerM = lay.usable / Math.max(1, openM - nearM) // 与舰列位移同尺（px/m）
  const gunBasePx = Math.max(40, foeGunX - meGunX - (visM - nearM) * sPxPerM)
  const arcCap = lay.usable + gunBasePx + 80 // 兜底上限：不超"开局枪口位 + 余量"
  const arcR = (rangeM: number, minPx: number): number =>
    Math.max(minPx, Math.min(arcCap, gunBasePx + Math.max(0, rangeM - nearM) * sPxPerM))
  const mainMeArc = arcs.me.find((w) => w.kind === 'gun') ?? arcs.me[0]
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

  /* 船体维修装置状态（2026-09-09）：运转中（绿点呼吸）/ 组件耗尽停机（暗红）；徽标在弹药旁 */
  const repairRt = battle?.repair
  const repairTotal = repairRt ? Object.values(repairRt.kits).reduce((a, b) => a + b, 0) : 0
  const repairRunning = repairRt ? repairRt.units.some((u) => !u.stopped) : false

  /* 距离滑条：值 = 接近度×1000（0 最远拉开 → 1000 贴脸），右拖 = 接近 */
  const desireM = Math.min(openM, Math.max(nearM, combat.myDesireM))
  const sliderV = dragV ?? approachOf(desireM, openM, nearM) * 1000
  const sliderToDesire = (v: number): number => Math.round(openM - (v / 1000) * (openM - nearM))
  const commitDesire = (v: number): void => {
    const r = engine.battleSetDesireAt(sliderToDesire(v))
    if (!r.ok) onToast(r.error ?? '设置失败', true)
  }
  const scheduleCommit = (v: number): void => {
    dragValRef.current = v
    if (flushTimerRef.current !== null) window.clearTimeout(flushTimerRef.current)
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null
      dragValRef.current = null
      commitDesire(v)
      setDragV(null)
    }, 160)
  }
  const flushDrag = (): void => {
    const v = dragValRef.current
    if (v === null) return
    dragValRef.current = null
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current)
      flushTimerRef.current = null
    }
    commitDesire(v)
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
  const droneWings = arcs.me
    .filter((w) => w.src === 'drone' && !!w.artId)
    .map((w) => {
      const model = droneModelOf(w.artId!)!
      const st = droneSortieRef.current.get(w.artId!)
      const cycleMs = DRONE_SORTIE_OUT_MS + DRONE_DWELL_MS + DRONE_SORTIE_BACK_MS
      const elapsed = st ? now - st.startAt : Number.POSITIVE_INFINITY
      const phase: 'out' | 'back' | 'deck' = model.resident
        ? 'out'
        : elapsed < DRONE_SORTIE_OUT_MS + DRONE_DWELL_MS
          ? 'out'
          : elapsed < cycleMs
            ? 'back'
            : 'deck'
      const show = model.resident ? 1 : Math.max(1, Math.min(w.count ?? 1, DRONE_SHOW_MAX))
      // 记下本帧渲染的机体数：下一拍的击落演出靠它定位"即将消失的末位机体"（见 fx 消费处）
      dronePrevShowRef.current.set(w.artId!, show)
      return {
        artId: w.artId!,
        model,
        phase,
        elapsed,
        st,
        show,
        total: w.count ?? 1,
      }
    });
  /** 敌方机群（第二层）：与 `droneWings` 同构——起点换成**敌舰机库口**、阵位在**我方舰旁**（镜像） */
  const foeWings = (arcs.foeDrones ?? []).filter((w) => w.alive > 0);
  /** 交给 rAF 驱动层：布局元数据 + 各机型机群（含本轮出击状态）；位置计算完全走 dronePoseAt */
  visDistRef.current = visM
  droneDriveRef.current = {
    foeN: Math.max(1, foeRowTags.length),
    openM,
    nearM,
    wings: [
      ...droneWings.map((w) => ({
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
          model: droneModelOf(w.artId)!,
          show: Math.min(w.alive, DRONE_SHOW_MAX),
          st,
          // **收舱待命 = 不显示**（与我方同款：`is-deck` 走 CSS `display:none`）。
          // ⚠ 旧版常显 ⇒ 敌机在每轮之间**停在敌舰甲板上朝右不动**（船长实测："初始位于敌舰尾部、
          //   朝向朝右"）——敌机的可见时段应当与我方一致：只有出海那 1.4 秒。
          deck: !st || fel >= fcyc,
          foe: w.tag,
        }
      }),
    ],
  }

  /* 敌方单位行（2026-09-09 二轮：存活单位 + 演出期尸骸同队列渲染）——
     尸骸占原槽整段演出：boomAt（致死弹道着弹）前原样停留 → 灰化 + 爆炸环 → 原位淡出；
     撤出只发生在整批尸骸全部演完的瞬间（一次收拢，见 scanDroppable），存活舰补位收拢
     不再压着爆炸/淡出动画走，多个单位同时阵亡也不再互相挤位叠加。
     2026-09-10 性能修复（船长"击毁敌人后画面明显卡顿"）：存活与尸骸**共用同一套 DOM 结构**
     （此前两个分支结构不同 → 击毁瞬间整份舰体 SVG 被卸载重建，正是卡顿主因）——
     现只切换 class（is-corpse）与淡出透明度，舰体矢量始终不被重建。 */
  /** 敌方机群（2026-09-11 机群批 S5）：按敌单位 tag 取该舰的警戒机群（机型 / 机库 / 现存架数） */
  const foeUnitEls = foeRowTags.map((tag) => {
    const isMain = isFoeMainTag(tag)
    const ba = corpseAtRef.current.get(tag)
    const sinceBoom = ba === undefined ? -1 : now - ba
    const corpseOn = sinceBoom >= 0 // 致死弹道着弹后才是真尸骸；着弹前原样停留
    const locked = !corpseOn && tag === combat.lockTag
    const boomLive = corpseOn && sinceBoom < BOOM_LIFE
    const fadeT = sinceBoom >= BOOM_LIFE ? clamp01((sinceBoom - BOOM_LIFE) / WRECK_FADE_MS) : 0
    return (
      <div
        key={tag}
        data-tag={tag}
        className={`app-bts-unit${corpseOn ? " is-corpse" : ""}${locked ? " is-locked" : ""}`}
      >
        {/* 淡出作用于舰体容器（外层 .app-bts-unit 有入场动画 fill 占位，透明度须压在子层）；
            尸骸灰化 = accent 传灰（2026-09-10 性能：不再用 CSS 滤镜重新栅格化整份舰体矢量） */}
        <span className="app-bts-corpse" style={fadeT > 0 ? { opacity: Math.max(0, 1 - fadeT) } : undefined}>
          <ShipSprite
            foeKey={foeKey}
            flip={foeFlip}
            accent={corpseOn ? '#6b7280' : FOE_ACCENT[foeKey] ?? '#ff8373'}
            size={isMain ? LAY.MAIN : LAY.ESC}
          />
        </span>
        <span className="app-bts-name" style={{ color: isMain ? '#ffb3a6' : '#d8a08f' }}>
          {locked ? `◈ ${foeNameOf(tag)}` : foeNameOf(tag)}
        </span>
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
            <button className="app-btn is-small" onClick={onClose}>
              ← 退出战场
            </button>
            <button
              className={`app-btn is-small is-warn${retreatAsk ? " is-danger" : ""}`}
              title="撤退：轻损脱离战斗并自动返航（仅损失少量舰船耐久、无弃船风险；同时停止重复清剿）"
              onClick={() => {
                if (!retreatAsk) {
                  setRetreatAsk(true)
                  onToast('撤退 = 轻损脱离（仅损失少量舰船耐久、无弃船风险）——再点一次确认。', true)
                  return
                }
                setRetreatAsk(false)
                const r = engine.retreatNow()
                if (!r.ok) onToast(r.error ?? '撤退失败', true)
              }}
            >
              {retreatAsk ? '再点确认撤退' : '⚑ 撤退'}
            </button>
          </>
        ) : (
          <span className="app-bts-outro-tag">{ended ? (defeat ? '战斗结束 · 正在撤离…' : '战斗结束 · 正在结算…') : ''}</span>
        )}
        <span className="app-gold">{view.anomalyName}</span>
        <span className="app-dim">
          交火 {secs}s · 我方开火 {meStats.meShots}/命中 {meStats.meHits} · 敌开火 {meStats.foeShots}/命中 {meStats.foeHits}
        </span>
      </div>

      <div className="app-bts-stage">
        {/* 距离尺（游标式）：左 = 远（拉开）→ 右 = 近（贴脸）；与下方滑条同轴同比例 */}
        <div className="app-bts-ruler">
          <div className="app-bts-ruler-head">
            <span className="app-dim">◀ 拉开（远 {Math.round(openM).toLocaleString('zh-CN')}m）</span>
            <span className="app-dim">贴脸（近 {Math.round(nearM).toLocaleString('zh-CN')}m）▶</span>
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

          {/* 我方舰列 */}
          <div
            className={`app-bts-col is-me${defeat ? " is-crippled" : ""}`}
            ref={meColRef}
            style={{ left: lay.meLeft }}
          >
            <span className="app-bts-name">{meShip?.name}</span>
            <ShipSprite shipId={meShip?.id} role={meRole} accent={ROLE_ACCENT[meRole]} size={LAY.MAIN} flip={meFlip} />
            <div className="app-bts-hpWrap">
              <HpTri hp={combat.meHp} max={arcs.maxHp.me} />
            </div>
          </div>

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
                  key={w.artId}
                  className={`app-bts-wing is-${w.phase}${w.phase === "deck" ? " is-deck" : ""}${w.model.resident ? " is-resident" : ""}${DRONE_STYLE === "sortie" ? " is-sortie" : " is-formation"}`}
                >
                  {Array.from({ length: w.show }, (_, i) => (
                    <span
                      key={i}
                      ref={(el) => {
                        const key = `${w.artId}|${i}`
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

          {/* 敌方舰列（血条只跟存活单位；尸骸原位占槽演出见 foeUnitEls） */}
          <div className="app-bts-col is-foe" ref={foeColRef} style={{ left: lay.foeLeft }}>
            <div className="app-bts-shipRow">{foeUnitEls}</div>
            {foeAliveTags[0] ? (
              <div className="app-bts-hpWrap">
                <HpTri
                  hp={combat.foeHp[foeAliveTags[0]]!}
                  max={arcs.maxHp.foe[foeAliveTags[0]] ?? { s: 0, a: 0, h: 0 }}
                />
              </div>
            ) : null}
            {foeAliveTags.slice(1).map((tag) => (
              <div key={tag} className="app-bts-hpWrap">
                <HpTri hp={combat.foeHp[tag]!} max={arcs.maxHp.foe[tag] ?? { s: 0, a: 0, h: 0 }} label={foeNameOf(tag)} />
              </div>
            ))}
          </div>

          {/* 波次演出窗口提示（引擎 waveEnterGapMs 内：上一波全灭、下一波尚未抵达） */}
          {wavePending ? (
            <span
              className="app-bts-wave-hint"
              style={{ left: lay.foe[0]?.x ?? lay.me.x, top: (lay.foe[0]?.y ?? lay.me.y) + 42 }}
            >
              {waveNext > 0 ? `第 ${waveNext}/${foeAnomaly?.waves?.length} 波增援正在接近…` : '敌方增援正在接近…'}
            </span>
          ) : null}

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
              <span key={`lg${wi}`} className="app-bts-chip" title={w.kind === 'gun' && !w.type ? '炮台已无弹药（虚线弧 = 无法发射）' : undefined}>
                <i style={{ background: w.type ? DMG_COLOR[w.type] : '#93a4b8' }} />
                {w.label} {w.minM.toLocaleString('zh-CN')}~{w.maxM.toLocaleString('zh-CN')}m
                {w.kind === 'gun' ? (
                  w.type ? (
                    <span className={`app-a-chip app-a-${w.type}`}>{DMG_LABEL[w.type]}弹</span>
                  ) : (
                    '（无弹）'
                  )
                ) : null}
              </span>
            ))}
            <span className="app-bts-chip is-foe" title="敌方整编队武器（同型聚合）">
              <i style={{ background: foeColor }} />
              敌方 {arcs.foe.minM.toLocaleString('zh-CN')}~{arcs.foe.maxM.toLocaleString('zh-CN')}m
              <span className={`app-a-chip app-a-${arcs.foe.type}`}>{DMG_LABEL[arcs.foe.type]}</span>
            </span>
            {/* 敌方突进标记（2026-09-10 船长定：高威胁近战敌在够不着时突进机动 ×2）——
                复用同级"运行态 chip"样式（红点 = 告警态），不自造新类 */}
            {battle?.foeChargeOn ? (
              <span className="app-bts-repair is-down" title="敌方正在突进：够不着你时机动翻倍逼近——进入其射程后仍会维持 2 秒，随后冷却 20 秒">
                <i /> 敌突进中
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
            {repairRt ? (
              <span
                className={`app-bts-repair${repairRunning ? "" : " is-down"}`}
                title={
                  repairRunning
                    ? '船体维修装置运转中：每 5 秒自动修复装甲/结构，每跳消耗 1 枚对应修理组件'
                    : '船体维修装置已停机：修理组件耗尽（或开战时未备组件）——装甲/结构不再自动修复'
                }
              >
                <i /> {repairRunning ? '维修装置运转中' : '维修装置停机'}
                <span className="app-dim">组件 ×{repairTotal.toLocaleString('zh-CN')}</span>
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
                    {ready ? '就绪' : `${Math.max(0.1, Math.ceil(remain / 100) / 10)}s`}
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
                <span className="app-bts-reload-name">推进器</span>
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
            <span className="app-dim app-bts-sideLabel">◀ 拉开</span>
            <div className="app-bts-sliderWrap">
              <input
                type="range"
                className="app-battle-range app-bts-range"
                min={0}
                max={1000}
                step={5}
                disabled={ended}
                value={Math.min(1000, Math.max(0, sliderV))}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setDragV(v)
                  scheduleCommit(v)
                }}
                onPointerUp={flushDrag}
                onKeyUp={flushDrag}
                title="向左拖 = 拉开距离，向右拖 = 贴脸接近（自动记忆）"
              />
              <i className="app-bts-here" style={{ left: `${pct(visM)}%` }} title="当前实际距离" />
            </div>
            <span className="app-dim app-bts-sideLabel">贴脸 ▶</span>
            <span className="app-gold app-bts-desire">期望 {sliderToDesire(sliderV).toLocaleString('zh-CN')}m</span>
          </div>
          <div className="app-bts-ops">
            <span className="app-battle-tacs">
              <button className="app-btn is-small" disabled={ended} onClick={() => applyTactic('assault')}>贴脸</button>
              <button className="app-btn is-small" disabled={ended} onClick={() => applyTactic('mid')}>中距</button>
              <button className="app-btn is-small" disabled={ended} onClick={() => applyTactic('kite')}>风筝</button>
            </span>
            <span className="app-dim app-bts-note">
              {ended
                ? '交火已结束，正在结算战果…'
                : '拖条/战术即时生效并记忆偏好；舰船会机动到期望距离，进入射程才开火。'}
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
