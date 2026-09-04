/**
 * V12 全屏战斗场景（P4 击杀慢镜版）：
 * - 引擎在交火期间按 100ms 切片推进并即时通知本屏，画面直接以实时状态驱动；
 * - 分出胜负后引擎延迟 killcamMs 结算 → 本屏依次演出：最后一击弹道/命中 → 敌舰爆炸
 *   （或我方受创告警）→ 结算完成弹出战报覆盖层；
 * - 距离尺游标式（左远右近）、射程弧按弹种着色、滑条右 = 贴脸 / 左 = 拉开（同轴同比例）。
 * 组件只读展示，不参与确定性结算。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { battleArcsFor, battleTacticDesire, expeditionStatus, fleetDefOf } from '@whale/core'
import type { BattleFx, DamageType, ShipRole } from '@whale/core'
import type { GameEngine } from '../game/engine'
import type { ToastFn } from '../pages/common'
import { ShipSprite } from '../ui/ShipSprite'

/** 伤害类型 → 颜色（动能金 / 高爆橙 / 能量青；弹道、命中与射程弧共用） */
const DMG_COLOR: Record<DamageType, string> = { kinetic: '#ffd54f', explosive: '#ffa04d', plasma: '#5fd0ff' }
const DMG_LABEL: Record<DamageType, string> = { kinetic: '动能', explosive: '高爆', plasma: '能量' }
const DMG_ORDER: DamageType[] = ['kinetic', 'explosive', 'plasma']

const ROLE_ACCENT: Record<string, string> = {
  industrial: '#5ee6c8',
  armed: '#ff8373',
  armored: '#cdd6e0',
  hauler: '#ffd166',
}

/* 画面几何常量（px） */
const LAY = { PAD: 36, GAP: 84, TOP: 26, MAIN: 170, ESC: 90, ROW_GAP: 4 }
/** 舰艏（枪口）距舰体中心：主力舰 = hull 尖端 124/140 ×170 − 半宽 85 ≈ 66px；僚机小舰 ≈ 35px */
const NOSE_MAIN = 66
const NOSE_ESC = 35

/** 敌方"舰种"显示名（按战术 × 血型映射；代替通缉名展示在舰船上方） */
const FOE_CLASS: Record<string, Record<string, string>> = {
  brawl: { shield: '突击护卫舰', armor: '攻坚重甲舰', balanced: '突击炮艇' },
  orbit: { shield: '巡逻护卫舰', armor: '装甲巡逻舰', balanced: '环绕护航舰' },
  kite: { shield: '狙击护卫舰', armor: '远程装甲舰', balanced: '狙击炮艇' },
}
function foeClassName(tactic: string | undefined, profile: string | undefined): string {
  return FOE_CLASS[tactic ?? 'orbit']?.[profile ?? 'balanced'] ?? '敌方舰艇'
}
/** 弹道飞行时长 ms（撞点特效靠 CSS 动画延迟到此刻出现） */
const FLY_MS = 420
/** 弹道/闪光元素存活时间（略长于自身动画；渲染时惰性清理） */
const BOLT_LIFE = FLY_MS + 500
const FLASH_LIFE = 340
/** 敌舰爆炸演出生命周期 ms（渲染时清理；爆炸 CSS 动画 ~1.25s） */
const BOOM_LIFE = 1700

/** 战斗背景视差星层配置：far 慢 / mid 中 / near 快（追逐机动时差速最明显） */
const STAR_LAYERS = [
  { cls: 'is-far', n: 90, mult: 0.35, rMin: 0.8, rMax: 1.5, oMin: 0.14, oMax: 0.4 },
  { cls: 'is-mid', n: 70, mult: 0.65, rMin: 1.0, rMax: 2.0, oMin: 0.2, oMax: 0.55 },
  { cls: 'is-near', n: 42, mult: 1, rMin: 1.4, rMax: 2.7, oMin: 0.28, oMax: 0.8 },
]
interface StarPt {
  x: number
  y: number
  r: number
  o: number
}
function genStars(cfg: (typeof STAR_LAYERS)[number], W: number, H: number, seed: number): StarPt[] {
  let s = seed || 1
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
  const pts: StarPt[] = []
  for (let i = 0; i < cfg.n; i++) {
    pts.push({
      x: rnd() * W,
      y: rnd() * H,
      r: cfg.rMin + rnd() * (cfg.rMax - cfg.rMin),
      o: cfg.oMin + rnd() * (cfg.oMax - cfg.oMin),
    })
  }
  return pts
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}
/** 距离米数 → 0..1 的"接近度"（0 = 最远拉开 / 1 = 极限贴脸；滑条与上方距离尺共用此归一化） */
function approachOf(m: number, openM: number, nearM: number): number {
  return clamp01((openM - m) / Math.max(1, openM - nearM))
}

interface Dims {
  W: number
  H: number
  meW: number
  foeW: number
}
interface Anchor {
  x: number
  y: number
}
/**
 * 由当前真实距离算出两舰列位置与舰身锚点（渲染与弹道共用，保证画面自洽）。
 * 语义：距离 = open（射程外稍远）时两舰在两端拉开；向贴脸机动时向中线收拢，
 * 贴脸（nearM）时两舰间距 = LAY.GAP。
 */
function layout(d: Dims, foeN: number, visM: number, openM: number, nearM: number): {
  meLeft: number
  foeLeft: number
  me: Anchor
  foe: Anchor[]
  /** 米制可用跨度（px）：贴脸(near)时舰缘间距 = LAY.GAP，拉满(open)时 = LAY.GAP+usable —— 与距离线性对应 */
  usable: number
} {
  const rowW = LAY.MAIN + Math.max(0, foeN - 1) * (LAY.ESC + LAY.ROW_GAP)
  const usable = Math.max(0, d.W - LAY.PAD * 2 - d.meW - d.foeW - LAY.GAP)
  const g = approachOf(visM, openM, nearM) // 接近度：远 = 0，贴脸 = 1
  const t = (usable * g) / 2 // 越接近越向中线收拢
  let meLeft = LAY.PAD + t
  let foeLeft = d.W - LAY.PAD - d.foeW - t
  const minSpan = Math.min(LAY.GAP, Math.max(40, d.W - LAY.PAD * 2 - 60))
  if (foeLeft - (meLeft + d.meW) < minSpan) foeLeft = meLeft + d.meW + minSpan // 极小窗防御：不重叠
  const mainH = LAY.MAIN * 0.46
  const escH = LAY.ESC * 0.46
  const rowLeft = foeLeft + (d.foeW - rowW) / 2
  const me: Anchor = { x: meLeft + d.meW / 2, y: LAY.TOP + mainH / 2 }
  const foe: Anchor[] = []
  for (let i = 0; i < foeN; i++) {
    if (i === 0) {
      foe.push({ x: rowLeft + LAY.MAIN / 2, y: LAY.TOP + mainH / 2 })
    } else {
      const e = i - 1
      foe.push({
        x: rowLeft + LAY.MAIN + LAY.ROW_GAP + e * (LAY.ESC + LAY.ROW_GAP) + LAY.ESC / 2,
        y: LAY.TOP + mainH - escH / 2,
      })
    }
  }
  return { meLeft, foeLeft, me, foe, usable }
}

/** 扇形路径（原点为圆心、朝 +x 张角 ±38°；折线逼近弧线） */
function fanSegs(r: number): string[] {
  const A = (38 * Math.PI) / 180
  const N = 9
  const pts: string[] = []
  for (let i = 0; i <= N; i++) {
    const a = -A + ((2 * A * i) / N) * 1
    pts.push(`${(r * Math.cos(a)).toFixed(1)} ${(r * Math.sin(a)).toFixed(1)}`)
  }
  return pts
}
function fanPath(r0: number, r1: number): string {
  const inner = fanSegs(r0)
  return `M${fanSegs(r1).join(' L')} L${inner.reverse().join(' L')} Z`
}
function ringPath(r: number): string {
  return `M${fanSegs(r).join(' L')}`
}

/** 三层垂直血量条：自上而下 护盾(蓝) / 装甲(红) / 结构(黄)，各层按自身满值比例独立显示。
 *  布局与配色全部内联（不依赖样式表加载顺序），确保任何环境下条均可见。 */
const HP_LAYER_COLOR = { s: '#3f9fd8', a: '#d34a4a', h: '#e0b83f' } as const
function HpTri({ hp, max, label }: { hp: { s: number; a: number; h: number }; max: { s: number; a: number; h: number }; label?: string }) {
  const layers = [
    { k: 's' as const, zh: '护盾' },
    { k: 'a' as const, zh: '装甲' },
    { k: 'h' as const, zh: '结构' },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%' }}>
      {label ? <span style={{ fontSize: 10, color: '#99a5b5', lineHeight: 1.2 }}>{label}</span> : null}
      {layers.map((ly) => {
        const cur = Math.max(0, Math.round(hp[ly.k]))
        const full = max?.[ly.k] ?? 0
        const ratio = full > 0 ? Math.min(100, Math.max(0, (cur / full) * 100)) : 0
        const color = HP_LAYER_COLOR[ly.k]
        return (
          <div key={ly.k} title={`${ly.zh} ${cur}/${Math.round(full)}`} style={{ display: 'flex', alignItems: 'center', gap: 4, height: 10 }}>
            <span style={{ flex: '0 0 24px', fontSize: 9.5, color: '#99a5b5', textAlign: 'right' }}>{ly.zh}</span>
            <span style={{ flex: 1, height: '100%', background: 'rgba(0,0,0,.45)', borderRadius: 2, overflow: 'hidden' }}>
              <i style={{ display: 'block', height: '100%', width: `${ratio}%`, background: color, boxShadow: `0 0 4px ${color}`, transition: 'width .4s' }} />
            </span>
            <span style={{ flex: '0 0 26px', fontSize: 9, fontFamily: 'var(--wui-mono)', color: '#99a5b5', textAlign: 'right' }}>{cur}</span>
          </div>
        )
      })}
    </div>
  )
}

interface BoltV {
  key: number
  color: string
  hit: boolean
  x1: number
  y1: number
  len: number
  angDeg: number
  born: number
}
interface FlashV {
  key: number
  at: number
  color: string
  x: number
  y: number
}

/** 开火事件 → 弹道几何：起点 = 源舰枪口（舰艏前缘），终点 = 目标舰枪口侧命中点。
 *  nose 按舰种取 NOSE_MAIN/NOSE_ESC，弹道与射程弧（同为枪口锚定）视觉一致。 */
function boltGeom(
  side: 'me' | 'foe',
  src: Anchor,
  dst: Anchor,
  srcNose: number,
  dstNose: number,
): { x1: number; y1: number; len: number; angDeg: number } {
  const dir = side === 'me' ? 1 : -1
  const sx = src.x + dir * srcNose
  const sy = src.y
  const tx = dst.x - dir * dstNose
  const ty = dst.y
  const dx = tx - sx
  const dy = ty - sy
  const len = Math.max(2, Math.hypot(dx, dy))
  return { x1: sx, y1: sy, len, angDeg: (Math.atan2(dy, dx) * 180) / Math.PI }
}

/** 战报阶段：live 交战 / outro 击杀慢镜演出 / report 战报弹层 */
type Stage = 'live' | 'outro' | 'report'
interface OutroSnap {
  kind: 'me' | 'foe'
  atWall: number
  startedAtGameMs: number
  durMs: number
  meShots: number
  meHits: number
  meDmg: number
  foeShots: number
  foeHits: number
}

/** 在日志中找本场战斗的战报原文（时间在开战之后、含"战报"的最新一条） */
function lastBattleReport(logs: Array<{ atGameMs: number; text: string }>, sinceGameMs: number): string | null {
  for (let i = logs.length - 1; i >= 0; i--) {
    const l = logs[i]!
    if (l.atGameMs < sinceGameMs) break // 日志按时间升序：再往前都是开战前的
    if (l.text.includes('战报')) return l.text
  }
  return null
}

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
  /** 已消费的开火事件数（引擎每拍追加一次，渲染到达即回放） */
  const fxIdxRef = useRef(0)
  const initedFxRef = useRef(false)
  const keyRef = useRef(1)
  const boltsRef = useRef<BoltV[]>([])
  const flashRef = useRef<FlashV[]>([])
  /** 已被击毁的敌方单位（永久登记：残骸淡出不复活） */
  const deadRef = useRef<Set<string>>(new Set())
  /** 爆炸特效的计划开始墙钟：tag → 墙钟（= 检测到死亡时刻 + 弹道飞行时长，让致死弹着弹后再炸） */
  const boomRef = useRef<Map<string, number>>(new Map())
  /** 各单位上一次渲染的血量总和（用于检测"本拍刚死"，避免复活旧尸爆炸） */
  const prevHpRef = useRef<Map<string, number>>(new Map())
  const hpInitRef = useRef(false)
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

      // ── 背景视差滚动：方向 = 玩家舰推进方向（同向流动）；速度 = 巡航基础 + 按期望距离差的机动加速 ──
      // 近似依据：引擎只演化相对距离、无绝对速度。玩家船"即时速度"由此代理表达：
      // 基础巡航保证对峙/已到达期望时星空也持续流动（表示双方高速同向/巡航中）；
      // 期望差大 → 机动全速叠加（追逐/拉锯加速）。
      const st = starStateRef.current
      const gap = b.myDesireM - b.distanceM // <0 = 想接近（船向右推进）；>0 = 想拉开（船向左退）
      const base = 70 // px/s 巡航基础（对峙也流动）
      let dir = st.dir
      if (Math.abs(gap) > 2) dir = gap < 0 ? -1 : 1 // 同向：接近(右进)星向右流
      st.dir = dir
      const drive = Math.abs(gap) > 2 ? Math.min(1, (Math.abs(gap) - 2) / 160) * 220 : 0
      const target = dir * (base + drive)
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

  // 首帧不重放历史开火事件
  if (!initedFxRef.current) {
    fxIdxRef.current = battle.fx.length
    initedFxRef.current = true
  }

  const meShip = fleetDefOf(state, engine.ctx, state.shipId)
  const meRole: ShipRole = meShip?.role ?? 'industrial'
  const foeTags = Object.keys(combat.foeHp)
  const foeMain = combat.foeHp[foeTags[0]!]
  const ended = battle.ended !== null
  const defeat = battle.ended === 'foe'

  const realDist = battle.distanceM // 引擎实时距离（交火中每 ~100ms 更新）
  const visM = smoothM !== null ? smoothM : realDist // 视觉插值距离（舰列/弧/游标平滑用）
  const foeN = foeTags.length
  const lay = layout(dims, foeN, visM, openM, nearM)
  const pct = (m: number): number => approachOf(m, openM, nearM) * 100
  const now = performance.now()

  /* ── 舰首朝向 = 机动意图（各自"想接近还是想拉开"），而非实际位移：
       拔河中即使被拖退也保持"想接近"的冲顶姿态；到达期望距离（差 <2m）保持现状，对峙不抖动 ── */
  const myGap = combat.myDesireM - realDist
  const foeGap = arcs.foeDesireM - realDist
  if (myGap > 2) facingRef.current.meFlip = true // 我方想拉开 → 掉头背向
  else if (myGap < -2) facingRef.current.meFlip = false // 我方想接近 → 船头朝敌
  if (foeGap > 2) facingRef.current.foeFlip = false // 敌想拉开 → 掉头背向
  else if (foeGap < -2) facingRef.current.foeFlip = true // 敌想接近 → 船头朝我
  const { meFlip, foeFlip } = facingRef.current

  /* ── 消费新到达的开火事件（同帧转弹道 + 闪光）── */
  const fxLen = battle.fx.length
  if (fxIdxRef.current < fxLen) {
    while (fxIdxRef.current < fxLen) {
      const fx: BattleFx = battle.fx[fxIdxRef.current]!
      fxIdxRef.current += 1
      const fi = foeTags.indexOf(fx.tag)
      const idx = fi >= 0 ? fi : 0
      const src = fx.side === 'me' ? lay.me : lay.foe[idx]
      const dst = fx.side === 'me' ? lay.foe[idx] : lay.me
      if (!src || !dst) continue
      const foeNose = idx === 0 ? NOSE_MAIN : NOSE_ESC
      const srcNose = fx.side === 'me' ? NOSE_MAIN : foeNose
      const dstNose = fx.side === 'me' ? foeNose : NOSE_MAIN
      const g = boltGeom(fx.side, src, dst, srcNose, dstNose)
      boltsRef.current.push({
        key: keyRef.current++,
        color: DMG_COLOR[fx.type],
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

  /* ── 敌方单位被击毁检测（hp 归零的瞬间登记残骸 + 爆炸，演出与战斗是否结束无关）── */
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
        deadRef.current.add(tag) // 刚被击毁：登记残骸；爆炸延后到致死弹道着弹后再启动
        boomRef.current.set(tag, now + FLY_MS)
      }
    }
  }
  // 爆炸特效到期只清特效，残骸状态保留
  for (const [tag, at] of [...boomRef.current.entries()]) {
    if (now - at > BOOM_LIFE) boomRef.current.delete(tag)
  }

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

  /* 弹道（旋转容器内沿 +x 飞行）+ 撞点特效（CSS 延迟到着弹时刻） */
  const boltEls = boltsRef.current.map((bv) => (
    <div key={bv.key} className="app-bts-bolt" style={{ left: bv.x1, top: bv.y1, transform: `rotate(${bv.angDeg}deg)` }}>
      <i className="app-bts-bolt-bar" style={{ width: bv.len, background: `linear-gradient(90deg, ${bv.color} 0%, ${bv.color}cc 60%, transparent 100%)`, boxShadow: `0 0 8px ${bv.color}` }} />
      <i
        className={`app-bts-puff${bv.hit ? ' is-hit' : ' is-miss'}`}
        style={{ left: bv.len, top: 0, borderColor: bv.color, boxShadow: `0 0 10px ${bv.color}`, animationDelay: `${FLY_MS}ms` }}
      />
    </div>
  ))
  const muzzleEls = flashRef.current.map((f) => (
    <i key={f.key} className="app-bts-muzzle" style={{ left: f.x, top: f.y, color: f.color }} />
  ))

  /* 敌方单位行（舰名 = 敌方舰种名显示在舰上方；含爆炸演出与残骸淡出） */
  const foeTagsList = foeTags
  const foeAnomaly = state.expedition.anomalyId ? engine.ctx.anomalies.get(state.expedition.anomalyId) : undefined
  const foeClassBase = foeClassName(foeAnomaly?.tactic, foeAnomaly?.defProfile)
  const foeUnitEls = foeTagsList.map((tag, i) => {
    const boomAt = boomRef.current.get(tag)
    const dead = deadRef.current.has(tag)
    const boomLive = boomAt !== undefined && now >= boomAt && now - boomAt < BOOM_LIFE
    return (
      <div key={tag} className={`app-bts-unit${dead ? ' is-dead' : ''}`}>
        <ShipSprite
          role={i === 0 ? 'armed' : 'hauler'}
          flip={foeFlip}
          accent={i === 0 ? '#ff8373' : '#c25a4a'}
          size={i === 0 ? LAY.MAIN : LAY.ESC}
        />
        <span className="app-bts-name" style={{ color: i === 0 ? '#ffb3a6' : '#d8a08f' }}>
          {i === 0 ? foeClassBase : `${foeClassBase}·僚机`}
        </span>
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
              title="撤退：轻损脱离战斗并自动返航（仅损失少量舰船耐久、无弃船风险；同时停止连续出击）"
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
            <ShipSprite role={meRole} accent={ROLE_ACCENT[meRole]} size={LAY.MAIN} flip={meFlip} />
            <div className="app-bts-hpWrap">
              <HpTri hp={combat.meHp} max={arcs.maxHp.me} />
            </div>
          </div>

          {/* 敌方舰列（含爆炸演出） */}
          <div className="app-bts-col is-foe" ref={foeColRef} style={{ left: lay.foeLeft }}>
            <div className="app-bts-shipRow">{foeUnitEls}</div>
            {foeMain ? (
              <div className="app-bts-hpWrap">
                <HpTri hp={foeMain} max={arcs.maxHp.foe[foeTags[0]!] ?? { s: foeMain.s, a: foeMain.a, h: foeMain.h }} />
              </div>
            ) : null}
            {foeTags.slice(1).map((tag) => (
              <div key={tag} className="app-bts-hpWrap">
                <HpTri hp={combat.foeHp[tag]!} max={arcs.maxHp.foe[tag] ?? { s: 0, a: 0, h: 0 }} label={combat.foeHp[tag]!.name} />
              </div>
            ))}
          </div>

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
                {w.kind === 'gun' ? (w.type ? `（${DMG_LABEL[w.type]}弹）` : '（无弹）') : null}
              </span>
            ))}
            <span className="app-bts-chip is-foe" title="敌方整编队武器（同型聚合）">
              <i style={{ background: foeColor }} />
              敌方 {arcs.foe.minM.toLocaleString('zh-CN')}~{arcs.foe.maxM.toLocaleString('zh-CN')}m（{DMG_LABEL[arcs.foe.type]}）
            </span>
            {ammoChips.length > 0 ? (
              <span className="app-bts-ammo">
                {ammoChips.map((t) => (
                  <span key={t} style={{ color: DMG_COLOR[t] }}>
                    {DMG_LABEL[t]}×{arcs.ammo[ammoKey(t)].toLocaleString('zh-CN')}
                  </span>
                ))}
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
