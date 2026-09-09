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
import { battleArcsFor, battleTacticDesire, createPlayerSpec, expeditionStatus, fleetDefOf, foeMainTagOf, foeUnitNameOf } from '@whale/core'
import type { BattleFx, DamageType, ShipRole } from '@whale/core'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'
import { ShipSprite } from '../ui/ShipSprite'
import { FOE_ACCENT, foeFamilyOf } from '../ui/shipArt'
import {
  BOLT_LOOK,
  DMG_COLOR, DMG_LABEL, DMG_ORDER, ROLE_ACCENT, LAY, NOSE_MAIN, NOSE_ESC,
  FLY_MS, BOLT_LIFE, FLASH_LIFE, BOOM_LIFE,
  STAR_LAYERS, genStars, clamp01, approachOf, layout,
  fanSegs, fanPath, ringPath, HpTri, boltGeom, lastBattleReport,
} from './battleViewCore'
import type { Dims, Anchor, BoltV, FlashV, Stage, OutroSnap } from './battleViewCore'

export function BattleScreen({ engine, onToast, onClose }: { engine: GameEngine; onToast: ToastFn; onClose: () => void }) {
  const state = engine.state
  const view = expeditionStatus(state, engine.ctx)
  const arcs = battleArcsFor(state, engine.ctx)
  const battle = state.expedition.battle

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
        }
        setStage('outro')
      } else if (!view.combat) {
        // 未见到分出胜负战斗就结束了（离线恢复等）：直接关屏，战报看日志
        onClose()
      }
    } else if (stage === 'outro' && !view.combat) {
      // 引擎已结算（killcam 走完）→ 战报文本（resolve 日志已写入）
      const snap = outroRef.current
      const report =
        lastBattleReport(state.logs, snap?.startedAtGameMs ?? 0) ??
        (snap?.kind === 'me' ? '大捷：敌方编队全灭，舰队开始返航。' : '失利：舰队被迫撤离，详情见事件日志。')
      reportTextRef.current = report
      setStage('report')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, battle?.ended, view.combat === null])

  // 战报自动关闭：report 展示 6 秒后自动返回（按钮可随时提前关闭）
  useEffect(() => {
    if (stage !== 'report') return
    const t = window.setTimeout(() => onClose(), 6000)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage])

  // 星空视差速率：开战时锁定一次驾驶船战斗速度（装配/技能静态，战斗期间不变）
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
      setSmoothM((old) => (old === null || Math.abs(old - vis) >= 0.05 ? vis : old))

      // ── 背景视差滚动（2026-09-05 船长规则）：玩家前进（船向右、朝敌接近）→ 星空向左流；
      // 后退（想拉开、船向左退）→ 星空向右流。速度与「驾驶船战斗速度」挂钩（推进器/技能已折算），
      // 对峙（已到位）时保持原流向以巡航速度流动（双方高速同向的体感）。
      const st = starStateRef.current
      const gap = b.myDesireM - b.distanceM // <0 = 想接近（前进/向右）；>0 = 想拉开（后退/向左）
      if (Math.abs(gap) > 2) st.dir = gap < 0 ? 1 : -1 // +1 = 星空向左流 / −1 = 向右流
      const vMag = Math.min(240, 40 + meSpeedRef.current * 0.32) // 40px/s 底速 + 船速比例（~300m/s → 136px/s）
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

  // 尺寸测量（列宽由固定内容决定；窗口变化只影响 lane 宽）
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
    const won = snap?.kind === 'me'
    const durSec = Math.max(1, Math.round((snap?.durMs ?? 0) / 1000))
    const fallback = won ? '敌方编队已全灭。' : '舰队被迫撤离。'
    return (
      <div className="app-battle-screen">
        <div className="app-bts-report">
          <div className={`app-bts-report-card${won ? ' is-win' : ' is-lose'}`}>
            <div className="app-bts-report-title">{won ? '⚔ 大捷' : '⚠ 失利'}</div>
            <div className="app-bts-report-text">{reportTextRef.current || fallback}</div>
            {snap ? (
              <div className="app-bts-report-stats">
                我方开火 {snap.meShots} / 命中 {snap.meHits} · 造成伤害 {Math.round(snap.meDmg).toLocaleString('zh-CN')} · 敌方开火{' '}
                {snap.foeShots} / 命中 {snap.foeHits} · 交火 {durSec}s
              </div>
            ) : null}
            <div className="app-bts-report-note">奖励/战利品已入账，舰队自动返航中；本报告 6 秒后自动关闭（完整记录见右侧事件日志）。</div>
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
  /** 敌舰族形键（悬赏卡 → 族 A~G；远征/未列卡/异常 → F 制式巡逻兜底，与资产 FOE_ART 键同源） */
  const foeKey = foeFamilyOf(state.expedition.anomalyId)
  /** 敌舰显示名（2026-09-09 命名统一：引擎同源推导——舰种名 + 规格词缀，弱规格 = 轻装 X；
   *  异常数据缺失时回退档内单位名/tag——旧档存档字符串不直接参与显示） */
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
    for (const fx of arrivals) {
      fxSeqRef.current = fx.seq
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
      const g = boltGeom(fx.side, src, dst, srcNose, dstNose)
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
      })
      flashRef.current.push({ key: keyRef.current++, at: now, color: DMG_COLOR[fx.type], x: g.x1, y: g.y1 })
    }
    if (flashRef.current.length > 6) flashRef.current.splice(0, flashRef.current.length - 6)
  }
  // 惰性清理过期元素（渲染输出不再包含它们即从 DOM 移除）
  boltsRef.current = boltsRef.current.filter((b) => now - b.born < BOLT_LIFE)
  flashRef.current = flashRef.current.filter((f) => now - f.at < FLASH_LIFE)

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
          className={`app-bts-puff${bv.hit ? ' is-hit' : ' is-miss'}`}
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
    <i key={f.key} className="app-bts-muzzle" style={{ left: f.x, top: f.y, color: f.color }} />
  ))

  /* 敌方单位行（2026-09-09 二轮：存活单位 + 演出期尸骸同队列渲染）——
     尸骸占原槽整段演出：boomAt（致死弹道着弹）前原样停留 → 灰化 + 爆炸环 → 原位淡出；
     撤出只发生在整批尸骸全部演完的瞬间（一次收拢，见 scanDroppable），存活舰补位收拢
     不再压着爆炸/淡出动画走，多个单位同时阵亡也不再互相挤位叠加。 */
  const foeUnitEls = foeRowTags.map((tag) => {
    const isMain = isFoeMainTag(tag)
    const ba = corpseAtRef.current.get(tag)
    if (ba === undefined) {
      // 存活单位（锁定装置集火目标高亮：金色呼吸描边）
      const locked = tag === combat.lockTag
      return (
        <div key={tag} data-tag={tag} className={`app-bts-unit${locked ? ' is-locked' : ''}`}>
          <ShipSprite
            foeKey={foeKey}
            flip={foeFlip}
            accent={FOE_ACCENT[foeKey] ?? '#ff8373'}
            size={isMain ? LAY.MAIN : LAY.ESC}
          />
          <span className="app-bts-name" style={{ color: isMain ? '#ffb3a6' : '#d8a08f' }}>
            {locked ? `◈ ${foeNameOf(tag)}` : foeNameOf(tag)}
          </span>
        </div>
      )
    }
    // 尸骸：sinceBoom < 0 = 僵尸帧（致死弹道未着弹，原样停留）；之后灰化 + 爆炸环 + 淡出
    const sinceBoom = now - ba
    const boomLive = sinceBoom >= 0 && sinceBoom < BOOM_LIFE
    const fadeT = sinceBoom >= BOOM_LIFE ? clamp01((sinceBoom - BOOM_LIFE) / WRECK_FADE_MS) : 0
    const corpseOn = sinceBoom >= 0
    return (
      <div key={tag} data-tag={tag} className={`app-bts-unit${corpseOn ? ' is-corpse' : ''}`}>
        {/* 淡出作用于舰体容器（外层 .app-bts-unit 有入场动画 fill 占位，透明度须压在子层） */}
        <span className="app-bts-corpse" style={fadeT > 0 ? { opacity: Math.max(0, 1 - fadeT) } : undefined}>
          <ShipSprite
            foeKey={foeKey}
            flip={foeFlip}
            accent={FOE_ACCENT[foeKey] ?? '#ff8373'}
            size={isMain ? LAY.MAIN : LAY.ESC}
          />
        </span>
        {corpseOn ? null : (
          <span className="app-bts-name" style={{ color: isMain ? '#ffb3a6' : '#d8a08f' }}>
            {foeNameOf(tag)}
          </span>
        )}
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
              className={`app-btn is-small is-warn${retreatAsk ? ' is-danger' : ''}`}
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
        <div className={`app-bts-lane${defeat ? ' is-defeat' : ''}`} ref={laneRef}>
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
          <div className={`app-bts-col is-me${defeat ? ' is-crippled' : ''}`} ref={meColRef} style={{ left: lay.meLeft }}>
            <span className="app-bts-name">{meShip?.name}</span>
            <ShipSprite shipId={meShip?.id} role={meRole} accent={ROLE_ACCENT[meRole]} size={LAY.MAIN} flip={meFlip} />
            <div className="app-bts-hpWrap">
              <HpTri hp={combat.meHp} max={arcs.maxHp.me} />
            </div>
          </div>

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
                className={`app-bts-repair${repairRunning ? '' : ' is-down'}`}
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
                  className={`app-bts-reload${ready ? ' is-ready' : ''}`}
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
