/**
 * M3 远征中心：势力声望、星图（SVG）、悬赏任务卡。
 * 中列面板：SkirmishStatus（远征中作业）→ StarMap（可点选）→ Standing → 任务列表。
 */
import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { AnomalyDef, GalaxyDef, AiCoreType } from '@whale/core'
import {
  AI_CORE_ORDER,
  DSI_FACTION_ID,
  SCAN_WINDOW_MS,
  aiCoreName,
  battleWinPreview,
  bountyCooldownRemainingMs,
  bountyRewardFactor,
  calcPower,
  countAiCore,
  expeditionStatus,
  fleetDefOf,
  foeLayerSplit,
  foeMainDamageType,
  formatDurationMs,
  frontierGalaxyIds,
  idleAiShipIds,
  isExplored,
  originGalaxyOf,
  scanStatus,
  shipDisplayName,
  shipRoleLabel,
  wreckDensityOf,
  shortestTravelMinutes,
  standingOf,
  travelLegMs,
  travelMinutesEff,
} from '@whale/core'
import { Panel, ProgressBar } from '@whale/ui'
import type { GameEngine } from '../game/engine'
import { MONEY_GLYPH } from '../pages/common'
import type { ToastFn } from '../pages/common'
import { DmgChip, ProfileChip } from '../ui/shipInfo'

/** 星图页「星图·远征」标签内容：声望条 + 扫描/远征作业 + 星图 */
export function ExpeditionPanel({ engine, onToast }: { engine: GameEngine; onToast: ToastFn }) {
  const state = engine.state
  const standing = standingOf(state, DSI_FACTION_ID)
  const view = expeditionStatus(state, engine.ctx)
  const scan = scanStatus(state)

  return (
    <Panel
      title="深空工业协会 · 远征调度"
      right={<span className="app-standing">声望 {standing}</span>}
    >
      {/* T1：扫描/远征作业状态与停止入口已收敛到顶部活动窗口；此处只保留摘要与交火入口提示 */}
      {scan.active || view.active || state.transit.active ? (
        <div className="app-dim app-exp-idle">
          {state.transit.active
            ? `🏠 返航空间站中 · 剩余约 ${formatDurationMs(Math.max(0, state.transit.finishAtGameMs - state.gameMs))}`
            : ''}
          {state.transit.active && (scan.active || view.active) ? ' ｜ ' : ''}
          {scan.active ? `🔭 扫描探索进行中 · 剩余约 ${formatDurationMs(scan.remainingMs)}` : ''}
          {scan.active && view.active ? ' ｜ ' : ''}
          {view.active
            ? view.phase === 'combat'
              ? `⚔ 实时交火中（${view.anomalyName}）· 火力 ${view.power} vs 威胁 ${view.threat}——点击右上角「⚔ 战斗中」进入战场，或静待战报；活动栏可查看实时进度`
              : `${view.anomalyName}（${view.galaxyName}）· ${view.phaseLabel}，剩余约 ${formatDurationMs(view.remainingMs)}——进度与「召回」在顶部活动栏`
            : ''}
        </div>
      ) : state.dockedSite !== null ? (
        <div className="app-dim app-exp-idle">
          停靠「{engine.ctx.stations.get(state.dockedSite)?.name ?? state.dockedSite}」（副空间站）：提供卸货/维修/补给/换驾驶——悬赏与扫描可从本站出发（按当前位置计程）。
        </div>
      ) : state.awayGalaxy !== null ? (
        /* T8：野外（掩护巡逻 / 胜利停留 / 扫描完成后停泊）——远征/扫描/采矿均可即时出发，或显式返航 */
        <div className="app-exp-idle app-idle-field">
          <span>
            ⛺ 舰船在「{engine.ctx.galaxies.get(state.awayGalaxy)?.name ?? state.awayGalaxy}」星系（掩护巡逻 / 野外停留）——
            从这里可即时出发远征、扫描或采矿（去程已取消，无航行等待）；卸货、维修与换船需返回空间站。
          </span>
          <button
            className="app-btn is-small"
            title="显式返航最近空间站（当前为母港）：到站后可卸货/维修/换船"
            onClick={() => {
              const r = engine.flyHomeNow()
              if (!r.ok) onToast(r.error ?? '无法返航', true)
            }}
          >
            🏠 返航空间站
          </button>
        </div>
      ) : (
        <div className="app-dim app-exp-idle">
          舰船停靠空间站。星图上标着悬赏情报，选一个目标「出发」——胜利后停留目标星系可连续出击，失利自动返航。
        </div>
      )}
      <StarMap engine={engine} onToast={onToast} />
    </Panel>
  )
}

/** 星图页「任务中心」标签内容：统一任务目录（T10）。
 * - 任务族：当前 = 悬赏（22 张，完整沿用其机制）；建站/引导等族随后续内容加入同一框架；
 * - 排序（船长定稿）：距离 / 星系 / 奖励 / 声望 / 默认（可接取冒泡在前，其余按名称）——
 *   可接取 = 声望满足且星系已探索；选择存本地。
 */
type TaskSort = 'default' | 'distance' | 'galaxy' | 'reward' | 'standing'
const TASK_SORT_KEY = 'whale-idle:task-sort'
const TASK_SORT_LABEL: Record<TaskSort, string> = {
  default: '默认（可接取优先 · 名称）',
  distance: '距离最近',
  galaxy: '星系名称',
  reward: '奖励最高',
  standing: '声望收益最高',
}

/* 选项卡分类（船长优化）：重要 / 资源（建站） / 快递——任务可属于多类（如建站=重要+资源） */
/* 注：悬赏任务已从任务中心抽出，独立成出港「战斗悬赏」标签（见 BountyPanel，船长 2026-09-05） */
type TaskTabKey = 'important' | 'resource' | 'courier'
const TASK_TABS: Array<{ key: TaskTabKey; label: string }> = [
  { key: 'important', label: '重要任务' },
  { key: 'resource', label: '资源任务' },
  { key: 'courier', label: '快递任务' },
]
const TASK_TAB_KEY = 'whale-idle:task-tab'

export function TaskPanel({ engine, onToast }: { engine: GameEngine; onToast: ToastFn }) {
  const [tab, setTab] = useState<TaskTabKey>(() => {
    try {
      const v = localStorage.getItem(TASK_TAB_KEY)
      return v === 'important' || v === 'resource' || v === 'courier' ? v : 'important'
    } catch {
      return 'important'
    }
  })

  const stationCount = engine.ctx.stations.size

  function changeTab(next: TaskTabKey): void {
    setTab(next)
    try {
      localStorage.setItem(TASK_TAB_KEY, next)
    } catch {
      // 忽略
    }
  }

  return (
    <Panel
      title="任务中心"
      right={<span className="app-dim">建站 {stationCount} · 任务可跨分类</span>}
    >
      <div className="app-task-tabs" role="tablist">
        {TASK_TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`app-tasktab${tab === t.key ? ' is-active' : ''}`}
            onClick={() => changeTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'important' ? (
        <div>
          <div className="app-dim app-exp-idle">长期建设目标：完成副站建设会并入空间站网络（采矿返航/卸货/维修/补给/换驾驶）。</div>
          <div className="app-station-list">
            <StationCard engine={engine} onToast={onToast} />
          </div>
        </div>
      ) : tab === 'resource' ? (
        <div>
          <div className="app-dim app-exp-idle">资源任务：向建站点提交本星系出产物资，分档推进、边交边生效。</div>
          <div className="app-station-list">
            <StationCard engine={engine} onToast={onToast} />
          </div>
        </div>
      ) : (
        <div className="app-dim app-exp-idle">暂无快递任务——协会货运网络尚在筹备，分类已就位（后续内容接入）。</div>
      )}
    </Panel>
  )
}

/* ─────────── 战斗悬赏（船长 2026-09-05：从「任务中心」抽出，独立成出港顶级标签——悬赏卡列表） ─────────── */
export function BountyPanel({ engine, onToast }: { engine: GameEngine; onToast: ToastFn }) {
  const state = engine.state
  const [sort, setSort] = useState<TaskSort>(() => {
    try {
      const v = localStorage.getItem(TASK_SORT_KEY)
      return v === 'default' || v === 'distance' || v === 'galaxy' || v === 'reward' || v === 'standing' ? v : 'default'
    } catch {
      return 'default'
    }
  })

  function changeSort(next: TaskSort): void {
    setSort(next)
    try {
      localStorage.setItem(TASK_SORT_KEY, next)
    } catch {
      // 忽略
    }
  }

  // —— 悬赏任务排序（默认=可接取冒泡+名称；次级均按名称） ——
  const byName = (x: { a: AnomalyDef }, y: { a: AnomalyDef }): number =>
    x.a.name.localeCompare(y.a.name, 'zh-Hans-CN') || x.a.id.localeCompare(y.a.id)
  const items = engine.anomalies.map((a) => {
    const galaxy = engine.ctx.galaxies.get(a.galaxyId)
    const mins = shortestTravelMinutes(engine.ctx, originGalaxyOf(state, engine.ctx), a.galaxyId)
    return {
      a,
      galaxyName: galaxy?.name ?? a.galaxyId,
      can: (standingOf(state, DSI_FACTION_ID) >= (a.standingReq ?? 0)) && (galaxy ? isExplored(state, galaxy.id) : true),
      dist: Number.isFinite(mins) ? mins : Number.POSITIVE_INFINITY,
      reward: a.rewardIsk,
      standing: a.standingGain,
    }
  })
  const sorted = [...items].sort((x, y) => {
    if (sort === 'distance') {
      if (x.dist !== y.dist) return x.dist - y.dist
      return byName(x, y)
    }
    if (sort === 'galaxy') {
      const g = x.galaxyName.localeCompare(y.galaxyName, 'zh-Hans-CN')
      if (g !== 0) return g
      return byName(x, y)
    }
    if (sort === 'reward') {
      if (x.reward !== y.reward) return y.reward - x.reward
      return byName(x, y)
    }
    if (sort === 'standing') {
      if (x.standing !== y.standing) return y.standing - x.standing
      return byName(x, y)
    }
    if (x.can !== y.can) return x.can ? -1 : 1
    return byName(x, y)
  })

  return (
    <Panel
      title="战斗悬赏"
      right={<span className="app-dim">悬赏任务 {engine.anomalies.length} 张 · 可接取排序</span>}
    >
      <div className="app-task-sortrow">
        <span className="app-dim">悬赏排序：</span>
        <select className="app-select" value={sort} onChange={(e) => changeSort(e.target.value as TaskSort)}>
          {(Object.keys(TASK_SORT_LABEL) as TaskSort[]).map((k) => (
            <option key={k} value={k}>
              {TASK_SORT_LABEL[k]}
            </option>
          ))}
        </select>
      </div>
      <div className="app-ano-list">
        {sorted.map((item) => (
          <AnomalyCard key={item.a.id} engine={engine} anomaly={item.a} onToast={onToast} />
        ))}
      </div>
    </Panel>
  )
}

/* ─────────── 星图（SVG：名称在图标正下方 + 布局拖拽编辑器） ─────────── */

const MAP_W = 700
const MAP_H = 300
/**
 * 布局本地覆盖键（v2，2026-09-05）：船长本地排版坐标已合入内置默认（universe.ts，并整体左移 14），
 * 旧键 v1（whale-idle:starmap-layout，09-04 编辑器排版本）一律不再读取——
 * 旧本地覆盖会遮蔽新默认（此前改内置坐标看不到变化即此因）；今后编辑器排完版「保存并复制 JSON」合入默认即可。
 */
const LAYOUT_KEY = 'whale-idle:starmap-layout-v2'
/** v1 旧键（whale-idle:starmap-layout）已作废且不再读取：启动时顺手删除本地残留数据 */
const LEGACY_LAYOUT_KEY = 'whale-idle:starmap-layout'
try {
  localStorage.removeItem(LEGACY_LAYOUT_KEY)
} catch {
  // 存储不可用时忽略（布局编辑器本就依赖 localStorage，读不到也无碍）
}
/**
 * 开发模式开关：星图布局编辑器（拖拽/交叉检测/自动整理/导出 JSON）默认对玩家隐藏；
 * 需要调整布局时在 DevTools 执行 localStorage.setItem('whale-idle:dev-layout','1') 后刷新页面即可显示入口。
 */
const DEV_EDITOR_KEY = 'whale-idle:dev-layout'

type LayoutMap = Record<string, { x: number; y: number }>

function readLayoutOverride(): LayoutMap {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as LayoutMap
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

/** 名称放在图标正下方（恒为两节点下方，同航道已按名宽留距） */
function NodeLabel({ name, x, y, cls }: { name: string; x: number; y: number; cls?: string }) {
  return (
    <text x={x} y={y + 21} textAnchor="middle" className={`app-map-label${cls ?? ''}`}>
      {name}
    </text>
  )
}

/* ── V16.1 安全等级（EVE 式 −1.0 ~ +1.0）：文字色阶与展示 ── */

/** 安全等级显示文本（+0.6 / 0.0 / −0.5） */
function secText(v: number | undefined): string {
  if (v === undefined) return ''
  return v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1)
}

/** 色阶类后缀（V16.2：≥0 安全向绿/黄；低于 0 即红，越近 −1 越偏紫） */
function secTone(v: number | undefined): string {
  if (v === undefined) return ''
  if (v >= 0.5) return '1'
  if (v >= 0) return '2'
  if (v >= -0.4) return '3'
  if (v >= -0.8) return '4'
  return '5'
}

/** 名称着色追加类（hub 保持金色徽标不参与） */
function secCls(v: number | undefined): string {
  const t = secTone(v)
  return t ? ` app-sec-${t}` : ''
}

/* ─────────── 通路交叉检测与整理（布局编辑器辅助） ─────────── */

interface Pt {
  x: number
  y: number
}
interface Seg {
  a: Pt
  b: Pt
}

function orient(p: Pt, q: Pt, r: Pt): number {
  const v = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  return v > 1e-9 ? 1 : v < -1e-9 ? -1 : 0
}

function onSeg(p: Pt, q: Pt, r: Pt): boolean {
  return (
    Math.min(p.x, q.x) <= r.x && r.x <= Math.max(p.x, q.x) && Math.min(p.y, q.y) <= r.y && r.y <= Math.max(p.y, q.y)
  )
}

const closePt = (u: Pt, v: Pt): boolean => Math.abs(u.x - v.x) < 1e-6 && Math.abs(u.y - v.y) < 1e-6

/** 两线段是否在内部交叉（共享端点不算——端点按坐标比较，因为线段对象每次渲染都会重建；退化/共线不算） */
function segsCross(s1: Seg, s2: Seg): boolean {
  if (closePt(s1.a, s2.a) || closePt(s1.a, s2.b) || closePt(s1.b, s2.a) || closePt(s1.b, s2.b)) return false
  const o1 = orient(s1.a, s1.b, s2.a)
  const o2 = orient(s1.a, s1.b, s2.b)
  const o3 = orient(s2.a, s2.b, s1.a)
  const o4 = orient(s2.a, s2.b, s1.b)
  if (o1 === 0 && onSeg(s1.a, s1.b, s2.a)) return false // 共线重叠不算（罕见）
  if (o2 === 0 && onSeg(s1.a, s1.b, s2.b)) return false
  if (o3 === 0 && onSeg(s2.a, s2.b, s1.a)) return false
  if (o4 === 0 && onSeg(s2.a, s2.b, s1.b)) return false
  return o1 * o2 < 0 && o3 * o4 < 0
}

/** 求两线段交点（segsCross 保证存在） */
function segIntersectPt(s1: Seg, s2: Seg): Pt {
  const a1 = s1.a
  const b1 = s1.b
  const a2 = s2.a
  const b2 = s2.b
  const den = (b1.x - a1.x) * (b2.y - a2.y) - (b1.y - a1.y) * (b2.x - a2.x)
  if (Math.abs(den) < 1e-9) return { x: (s1.a.x + s1.b.x) / 2, y: (s1.a.y + s1.b.y) / 2 }
  const t = ((a2.x - a1.x) * (b2.y - a2.y) - (a2.y - a1.y) * (b2.x - a2.x)) / den
  return { x: a1.x + t * (b1.x - a1.x), y: a1.y + t * (b1.y - a1.y) }
}

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y)

/** 计算互相交叉的边对（返回边索引对） */
function findCrossings(segs: Seg[]): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (segsCross(segs[i]!, segs[j]!)) out.push([i, j])
    }
  }
  return out
}

/* ── 自动整理：确定性模拟退火最小化通路交叉 ── */

/** mulberry32 确定性随机数（同样输入 → 同样结果，便于撤销/复现） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function clonePos(m: Map<string, Pt>): Map<string, Pt> {
  const o = new Map<string, Pt>()
  for (const [k, v] of m) o.set(k, { x: v.x, y: v.y })
  return o
}
function copyInto(dst: Map<string, Pt>, src: Map<string, Pt>): void {
  for (const [k, v] of src) dst.set(k, { x: v.x, y: v.y })
}
function countCrossings(pos: Map<string, Pt>, segNodes: Array<[string, string]>): number {
  return findCrossings(segNodes.map(([na, nb]) => ({ a: pos.get(na)!, b: pos.get(nb)! }))).length
}

interface TidyOpts {
  iterations: number
  t0: number
  t1: number
  sigma: number
  bigJumpP: number
  bigJumpSigma: number
  minDist: number
  crossW: number
  moveW: number
}

/**
 * 退火一轮：以 origPos 为锚点随机游走，代价 = 交叉数×crossW + 节点位移×moveW + 过近惩罚；
 * 始终返回过程中遇到的最优（最少交叉）布局快照。
 */
function annealUncross(
  segNodes: Array<[string, string]>,
  origPos: Map<string, Pt>,
  seed: number,
  cfg: TidyOpts
): { best: number; pos: Map<string, Pt> } {
  const rand = mulberry32(seed)
  const ids = [...origPos.keys()]
  const pos = clonePos(origPos)
  const segCount = segNodes.length
  const evalCost = (): number => {
    const segs = new Array<Seg>(segCount)
    for (let i = 0; i < segCount; i++) {
      const [na, nb] = segNodes[i]!
      segs[i] = { a: pos.get(na)!, b: pos.get(nb)! }
    }
    let cost = findCrossings(segs).length * cfg.crossW
    for (let a = 0; a < ids.length; a++) {
      for (let b = a + 1; b < ids.length; b++) {
        const d = dist(pos.get(ids[a])!, pos.get(ids[b])!)
        if (d < cfg.minDist) cost += (cfg.minDist - d) * 120
      }
    }
    for (const id of ids) {
      const p = pos.get(id)!
      const o = origPos.get(id)!
      cost += Math.hypot(p.x - o.x, p.y - o.y) * cfg.moveW
    }
    return cost
  }
  let cur = evalCost()
  let best = countCrossings(pos, segNodes)
  const bestPos = clonePos(origPos)
  let T = cfg.t0
  const cool = Math.pow(cfg.t1 / cfg.t0, 1 / Math.max(1, cfg.iterations))
  const gauss = (): number => {
    const u = rand() || 1e-9
    const v = rand()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  for (let it = 0; it < cfg.iterations; it++) {
    const id = ids[Math.floor(rand() * ids.length)]!
    const p = pos.get(id)!
    const sigma = rand() < cfg.bigJumpP ? cfg.bigJumpSigma : cfg.sigma
    const prev = { x: p.x, y: p.y }
    p.x = Math.min(MAP_W - 12, Math.max(12, p.x + gauss() * sigma))
    p.y = Math.min(MAP_H - 12, Math.max(12, p.y + gauss() * sigma))
    const nc = evalCost()
    if (nc <= cur || rand() < Math.exp(-(nc - cur) / T)) {
      cur = nc
      const c = countCrossings(pos, segNodes)
      if (c < best) {
        best = c
        copyInto(bestPos, pos)
      }
    } else {
      p.x = prev.x
      p.y = prev.y
    }
    T *= cool
  }
  return { best, pos: bestPos }
}

/**
 * 自动整理：第一轮全局退火（动得稍大），随后至多两轮"锚定上一轮结果"的本地抛光；
 * 交叉数不再下降即停止；返回整理后的坐标表（id → 四舍五入坐标），不修改入参。
 * 同一输入布局结果可复现。
 */
function autoTidy(posMap: Map<string, Pt>, segNodes: Array<[string, string]>): Record<string, Pt> {
  if (posMap.size < 2 || segNodes.length === 0) {
    const outEmpty: Record<string, Pt> = {}
    for (const [id, p] of posMap) outEmpty[id] = { x: Math.round(p.x), y: Math.round(p.y) }
    return outEmpty
  }
  const passes: Array<TidyOpts & { seed: number }> = [
    { seed: 20240917, iterations: 14000, t0: 160, t1: 0.35, sigma: 12, bigJumpP: 0.08, bigJumpSigma: 48, minDist: 46, crossW: 1500, moveW: 1.4 },
    { seed: 20240918, iterations: 9000, t0: 90, t1: 0.35, sigma: 8, bigJumpP: 0.05, bigJumpSigma: 30, minDist: 46, crossW: 1500, moveW: 2.6 },
    { seed: 20240919, iterations: 6000, t0: 70, t1: 0.35, sigma: 6, bigJumpP: 0.04, bigJumpSigma: 22, minDist: 46, crossW: 1500, moveW: 3.6 },
  ]
  let anchor = clonePos(posMap)
  for (const p of passes) {
    const before = countCrossings(anchor, segNodes)
    if (before === 0) break
    const res = annealUncross(segNodes, anchor, p.seed, p)
    if (res.best >= before) break // 无改进：保留当前
    anchor = res.pos
    if (res.best === 0) break
  }
  const out: Record<string, Pt> = {}
  for (const [id, p] of anchor) out[id] = { x: Math.round(p.x), y: Math.round(p.y) }
  return out
}

function StarMap({ engine, onToast }: { engine: GameEngine; onToast: ToastFn }) {
  const state = engine.state
  const [editing, setEditing] = useState(false)
  const [devEditor] = useState<boolean>(() => {
    try {
      return localStorage.getItem(DEV_EDITOR_KEY) === '1'
    } catch {
      return false
    }
  })
  const [override, setOverride] = useState<LayoutMap>(readLayoutOverride)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const dragRef = useRef<{ id: string } | null>(null)
  const hubName = engine.ctx.galaxies.get('galaxy-hub')?.name ?? ''
  const selected: GalaxyDef | null = engine.ctx.galaxies.get(selectedId ?? '') ?? null
  const view = expeditionStatus(state, engine.ctx)
  const scan = scanStatus(state)

  // ── V13 探索迷雾：dev/编辑器模式看全图；正常模式 = 已探索亮 + 一跳剪影 + 其余隐藏 ──
  const devView = devEditor || editing
  const exploredIds: Set<string> = devView
    ? new Set(engine.galaxies.map((g) => g.id))
    : new Set(state.exploredGalaxies)
  const frontierIds: Set<string> = devView ? new Set() : new Set(frontierGalaxyIds(state, engine.ctx))
  const isFrontier = (id: string): boolean => frontierIds.has(id) && !exploredIds.has(id)
  // 悬赏情报例外：无论探索状态都统计（协会共享情报；剪影节点上显示数量徽标）
  const bountyByGalaxy = new Map<string, number>()
  for (const a of engine.anomalies) {
    bountyByGalaxy.set(a.galaxyId, (bountyByGalaxy.get(a.galaxyId) ?? 0) + 1)
  }

  const scanMinutesOf = (g: GalaxyDef): number => {
    const mins = shortestTravelMinutes(engine.ctx, 'galaxy-hub', g.id)
    if (!Number.isFinite(mins)) return 0
    // T8：作业 = 单程航行 + 就地扫描窗口（完成即停留，无自动返航段）
    return Math.round((travelLegMs(state, engine.ctx, mins) + SCAN_WINDOW_MS) / 60_000)
  }

  function handleScan(g: GalaxyDef): void {
    const r = engine.startScanAt(g.id)
    if (!r.ok) onToast(r.error ?? '无法发起扫描。', true)
    else onToast('扫描探索艇已出发，返港后录入情报。')
  }

  const posOf = (g: GalaxyDef): { x: number; y: number } => {
    const o = override[g.id]
    return o ? { x: o.x, y: o.y } : { x: g.x, y: g.y }
  }

  // ── 通路几何：按当前坐标重建线段，逐帧检测交叉（拖动时会实时更新） ──
  const mapEdges: Array<{ from: GalaxyDef; to: GalaxyDef; travelMinutes: number }> = []
  for (const edge of engine.galaxyEdges) {
    const a = engine.ctx.galaxies.get(edge.from)
    const b = engine.ctx.galaxies.get(edge.to)
    if (!a || !b) continue
    mapEdges.push({ from: a, to: b, travelMinutes: edge.travelMinutes })
  }
  const segs: Seg[] = mapEdges.map((e) => ({ a: posOf(e.from), b: posOf(e.to) }))
  const segNodes: Array<[string, string]> = mapEdges.map((e) => [e.from.id, e.to.id])
  const crossings = findCrossings(segs)
  const crossedEdge = new Set<number>()
  for (const [i, j] of crossings) {
    crossedEdge.add(i)
    crossedEdge.add(j)
  }

  // 「撤销整理」快照：记录最近一次点「自动整理」前的全部坐标
  const preTidyRef = useRef<LayoutMap | null>(null)
  function snapshotLayout(): LayoutMap {
    const out: LayoutMap = {}
    for (const g of engine.galaxies) out[g.id] = { ...posOf(g) }
    return out
  }
  function applyAutoTidy(): void {
    preTidyRef.current = snapshotLayout()
    const posMap = new Map<string, Pt>()
    for (const g of engine.galaxies) posMap.set(g.id, posOf(g))
    setOverride(autoTidy(posMap, segNodes))
  }
  function undoAutoTidy(): void {
    const snap = preTidyRef.current
    preTidyRef.current = null
    if (snap) setOverride(snap)
  }

  function saveOverride(): void {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(override))
    } catch {
      // 忽略存储失败
    }
  }

  function resetOverride(): void {
    setOverride({})
    try {
      localStorage.removeItem(LAYOUT_KEY)
    } catch {
      // 忽略
    }
  }

  async function copyJson(): Promise<void> {
    const all = engine.galaxies.map((g) => ({ id: g.id, ...posOf(g) }))
    const out: Record<string, { x: number; y: number }> = {}
    for (const e of all) out[e.id] = { x: e.x, y: e.y }
    try {
      await navigator.clipboard.writeText(JSON.stringify(out))
    } catch {
      // 剪贴板不可用（Electron 环境一般可用）
    }
  }

  // 拖拽：换算到 viewBox 坐标
  function toViewBox(e: { clientX: number; clientY: number }, svg: SVGSVGElement): { x: number; y: number } {
    const r = svg.getBoundingClientRect()
    return {
      x: Math.min(MAP_W - 14, Math.max(14, ((e.clientX - r.left) / r.width) * MAP_W)),
      y: Math.min(MAP_H - 10, Math.max(10, ((e.clientY - r.top) / r.height) * MAP_H)),
    }
  }

  function onPointerDown(id: string, e: ReactPointerEvent<SVGGElement>): void {
    if (!editing) return
    e.preventDefault()
    setSelectedId(id)
    const svg = e.currentTarget.ownerSVGElement ?? ((e.currentTarget.closest('svg') ?? null) as SVGSVGElement | null)
    if (!svg) return
    dragRef.current = { id }
    const move = (ev: PointerEvent): void => {
      const d = dragRef.current
      if (!d) return
      const p = toViewBox(ev, svg)
      setOverride((prev) => ({ ...prev, [d.id]: { x: Math.round(p.x), y: Math.round(p.y) } }))
    }
    const up = (): void => {
      dragRef.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="app-starmap-wrap">
      <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className={`app-starmap${editing ? ' is-editing' : ''}`} role="img" aria-label="星图">
        {/* 航线（V13 迷雾）：双亮实线带分钟；涉及剪影暗化无分钟；剪影连向更深处只画半段虚化提示 */}
        {mapEdges.map((e, idx) => {
          const pa = posOf(e.from)
          const pb = posOf(e.to)
          const aExp = exploredIds.has(e.from.id)
          const bExp = exploredIds.has(e.to.id)
          const aFront = frontierIds.has(e.from.id)
          const bFront = frontierIds.has(e.to.id)
          const aVis = aExp || aFront
          const bVis = bExp || bFront
          const crossed = editing && crossedEdge.has(idx)
          const halfX = pa.x + (pb.x - pa.x) * 0.5
          const halfY = pa.y + (pb.y - pa.y) * 0.5
          if (!aVis && !bVis) return null // 迷雾深处：不渲染
          if (aVis && !bVis) {
            // 亮/剪影端 → 未知深处：从可见端画半段虚化，提示“这边还有路”
            return (
              <line
                key={`${e.from.id}-${e.to.id}`}
                x1={pa.x}
                y1={pa.y}
                x2={halfX}
                y2={halfY}
                className="app-map-edge is-hint"
              />
            )
          }
          if (bVis && !aVis) {
            return (
              <line
                key={`${e.from.id}-${e.to.id}`}
                x1={pb.x}
                y1={pb.y}
                x2={halfX}
                y2={halfY}
                className="app-map-edge is-hint"
              />
            )
          }
          if (!(aExp && bExp)) {
            // 至少一端是剪影：整条暗色线可见，但不暴露分钟数
            return (
              <line
                key={`${e.from.id}-${e.to.id}`}
                x1={pa.x}
                y1={pa.y}
                x2={pb.x}
                y2={pb.y}
                className="app-map-edge is-fog"
              />
            )
          }
          const mx = (pa.x + pb.x) / 2
          const my = (pa.y + pb.y) / 2
          // T7 统一口径：边距显示"当前驾驶船实际耗时"（跃迁速度 × 航行技能），标称分钟只进悬停说明
          const actMin = travelMinutesEff(state, engine.ctx, e.travelMinutes)
          const actLabel = actMin >= 10 ? `${Math.round(actMin)}′` : `${Math.round(actMin * 10) / 10}′`
          const actTitle = `标称 ${e.travelMinutes}′ · 当前驾驶船实际约 ${formatDurationMs(Math.max(1, Math.round(actMin * 60_000)))}（含跃迁速度与航行技能）`
          return (
            <g key={`${e.from.id}-${e.to.id}`}>
              <line
                x1={pa.x}
                y1={pa.y}
                x2={pb.x}
                y2={pb.y}
                className={`app-map-edge${crossed ? ' is-cross' : ''}`}
              />
              <text x={mx} y={my - 6} textAnchor="middle" className={`app-map-min${crossed ? ' is-cross' : ''}`}>
                <title>{actTitle}</title>
                {actLabel}
              </text>
            </g>
          )
        })}
        {/* 交叉点标记（编辑中实时显示） */}
        {editing
          ? crossings.map(([i, j], k) => {
              const p = segIntersectPt(segs[i]!, segs[j]!)
              return <circle key={`x${k}`} cx={p.x} cy={p.y} r={3.5} className="app-map-xdot" />
            })
          : null}
        {/* 星系节点：已探索完整显示；剪影 = 半透明“未知信号”+ 悬赏情报徽标例外显示 */}
        {engine.galaxies.map((g) => {
          const p = posOf(g)
          const explored = exploredIds.has(g.id)
          const frontier = isFrontier(g.id)
          if (!explored && !frontier) return null // 迷雾深处：不渲染
          const isHub = g.id === 'galaxy-hub'
          const isSel = g.id === selectedId
          const secExtra = isHub || frontier ? '' : secCls(g.security)
          const cls = isHub ? ' is-hub' : isSel ? ' is-sel' : frontier ? ' is-frontier' : ''
          const bounty = bountyByGalaxy.get(g.id) ?? 0
          return (
            <g
              key={g.id}
              className="app-map-node"
              onClick={() => setSelectedId(g.id)}
              onPointerDown={(e) => onPointerDown(g.id, e)}
            >
              <circle cx={p.x} cy={p.y} r={frontier ? 7 : isHub ? 11 : 8} className={`app-map-dot${cls}`} />
              {/* 悬赏情报徽标（协会共享情报：剪影也显示数量，帮助判断是否值得扫描） */}
              {bounty > 0 && frontier ? (
                <text x={p.x} y={p.y - 12} textAnchor="middle" className="app-map-bounty">
                  ⚔{bounty}
                </text>
              ) : null}
              <NodeLabel name={frontier ? '未知信号' : g.name} x={p.x} y={p.y} cls={cls + secExtra} />
            </g>
          )
        })}
      </svg>
      <div className="app-map-side">
        {selected ? (
          isFrontier(selected.id) ? (
            <div className="app-map-detail">
              <div className="app-map-detail-name app-map-frontier-name">未知信号</div>
              <div className="app-map-detail-desc">
                尚未探明的星系——情报不足，无法查看航路与内容。对剪影发起扫描探索可录入完整情报。
              </div>
              <div className="app-dim">
                悬赏情报 {bountyByGalaxy.get(selected.id) ?? 0} 处（协会共享，仍需先探索才能出发）
                {scan.active ? ' · 扫描进行中' : state.mining.active ? ' · 采矿中' : view.active ? ' · 远征中' : ''}
              </div>
              <div className="app-map-scan-row">
                <button
                  className="app-btn is-small is-primary"
                  disabled={scan.active || state.mining.active || view.active}
                  onClick={() => handleScan(selected)}
                  title={`派出深空扫描艇：立即就地扫描（去程已取消）约 10 分钟，完成即停留该星系；期间事件倒计时加速、更易遭遇「探索发现」`}
                >
                  🔭 扫描探索（约 {Math.max(1, scanMinutesOf(selected))} 分钟）
                </button>
                <span className="app-dim app-map-scan-note">完成即点亮 · 期间事件更频繁</span>
              </div>
            </div>
          ) : (
            <div className="app-map-detail">
              <div className="app-map-detail-name">
                {selected.name}
                {selected.security !== undefined ? (
                  <span className={`app-sec-chip app-sec-chip-${secTone(selected.security)}`} title="安全等级（EVE 式：越高越安全，负数 = 高危深渊区）">
                    {secText(selected.security)}
                  </span>
                ) : null}
              </div>
              <div className="app-map-detail-desc">{selected.description}</div>
              {/* B1.5 前往星系动作区：掩护巡逻（主控/副船）/ 矿带 / 悬赏，含简介 */}
              <GalaxyActions engine={engine} galaxy={selected} onToast={onToast} />
              <div className="app-dim">
                距母港（{hubName}）{view.active ? ' · 远征中' : ''}
              </div>
              {editing ? (
                <div className="app-map-edit-tip">
                  拖动星系圆点调整布局 · 当前位置 ({Math.round(posOf(selected).x)}, {Math.round(posOf(selected).y)})
                </div>
              ) : null}
            </div>
          )
        ) : (
          <div className="app-dim app-map-hint">
            点击星系查看航路情报；「未知信号」可通过扫描探索点亮（已探索星系的一跳邻居会以剪影显示）。
          </div>
        )}
      </div>
      {/* 布局编辑工具条（开发工具：默认隐藏，置 dev-layout 标志后显示入口） */}
      {!devEditor && !editing ? null : (
        <div className="app-map-editbar">
        {!editing ? (
          <button
            className="app-btn is-small"
            onClick={() => setEditing(true)}
            title="开发工具：拖动星系调整星图布局，检查通路交叉，保存为本地覆盖或导出坐标 JSON"
          >
            ✎ 布局编辑{crossings.length > 0 ? '（有通路交叉）' : ''}
          </button>
        ) : (
          <>
            <span className={crossings.length > 0 ? 'app-map-xcount' : 'app-dim'}>
              {crossings.length > 0
                ? `⚠ 通路交叉 ${crossings.length} 处（红线），可拖开星系或点「自动整理」`
                : '✓ 通路无交叉 · 拖动星系圆点调整布局'}
            </span>
            <button
              className="app-btn is-small is-primary"
              onClick={applyAutoTidy}
              title="自动把交叉处的星系向两侧推开，尽量消除红线（可点「撤销整理」回退）"
            >
              自动整理
            </button>
            <button
              className="app-btn is-small"
              onClick={undoAutoTidy}
              disabled={!preTidyRef.current}
              title="回退到最近一次点「自动整理」之前的布局"
            >
              撤销整理
            </button>
            <button
              className="app-btn is-small is-primary"
              onClick={() => {
                saveOverride()
                void copyJson()
              }}
              title="保存到本地（重启保留）并把坐标 JSON 复制到剪贴板（可发给开发者合入默认布局）"
            >
              保存并复制 JSON
            </button>
            <button className="app-btn is-small" onClick={resetOverride} title="清除本地覆盖，恢复内置默认布局">
              重置默认
            </button>
            <button className="app-btn is-small" onClick={() => setEditing(false)}>
              完成
            </button>
          </>
        )}
        </div>
      )}
    </div>
  )
}

/* ─────────── 野外应急修理（修理系统 2026-09-05：驾驶船停留本星系时的手动组件入口） ─────────── */
function FieldKitRepair({ engine, onToast }: { engine: GameEngine; onToast: ToastFn }) {
  const state = engine.state
  const ship = state.fleet[state.shipId]
  if (!ship) return null
  const kits = (['repairkit-civ', 'repairkit-mil'] as const).reduce((n, id) => n + (ship.cargo[id] ?? 0), 0)
  const worn = ship.durability < 1 || (ship.armorPct ?? 1) < 1
  if (kits <= 0 || !worn) return null
  return (
    <div className="app-ga-row">
      <span className="app-ga-main">
        🧰 应急修理
        <span className="app-dim app-ga-desc">消耗货仓 1 枚修理组件（民用优先）：基础 HP×容量增幅（民用30/军用70）</span>
      </span>
      <button
        className="app-btn is-small is-primary"
        onClick={() => {
          const r = engine.useRepairKitNow()
          if (!r.ok) onToast(r.error ?? '使用修理组件失败', true)
          else onToast('已使用一枚修理组件（基础 HP×容量增幅）。')
        }}
        title="只能在停留/停靠时手动使用；连续出击出发前低于 50% 会自动消耗组件"
      >
        组件 ×{kits}
      </button>
    </div>
  )
}

/* ─────────── B1.5 星图「前往星系」动作区（掩护巡逻/矿带/悬赏 + 简介） ─────────── */

function GalaxyActions({ engine, galaxy, onToast }: { engine: GameEngine; galaxy: GalaxyDef; onToast: ToastFn }) {
  const state = engine.state
  const ctx = engine.ctx
  // —— 主控掩护巡逻（原"待命"） ——
  const inFlight = state.standby.active && state.standby.galaxyId === galaxy.id
  const alreadyHere =
    state.awayGalaxy === galaxy.id && !state.transit.active && !state.expedition.active && !state.mining.active && !state.scanning.active
  const pilotBusy =
    state.mining.active ||
    state.expedition.active ||
    state.scanning.active ||
    state.transit.active ||
    (state.standby.active && !inFlight)
  const standbyDisabled = inFlight || alreadyHere || pilotBusy || state.awayGalaxy === galaxy.id
  const standbyTitle = inFlight
    ? '正在前往该星系掩护巡逻途中'
    : alreadyHere
      ? `舰船已在「${galaxy.name}」掩护巡逻`
      : pilotBusy
        ? '当前驾驶船有进行中的作业（采矿/远征/扫描/返航）——结束后才能前往掩护巡逻'
        : undefined
  function handleStandby(): void {
    const r = engine.goStandbyAt(galaxy.id)
    if (!r.ok) onToast(r.error ?? '无法前往', true)
    else onToast(`掩护巡逻就位：舰船已抵达「${galaxy.name}」并留守（可随时返航空间站或继续作业）。`)
  }

  // —— 副船掩护巡逻 ——
  const idleShips = idleAiShipIds(state)
  const [aiShip, setAiShip] = useState('')
  const [aiCore, setAiCore] = useState<AiCoreType>('basic')
  const aiCoreAvailable = countAiCore(state, aiCore) > 0
  function handleAiStandby(): void {
    if (!aiShip) {
      onToast('先选择一艘空闲副船。', true)
      return
    }
    const r = engine.assignAiStandbyAt(aiShip, aiCore, galaxy.id)
    if (!r.ok) onToast(r.error ?? '无法派往掩护巡逻', true)
    else onToast('副船已派往该星系掩护巡逻（可取消召回）。')
  }

  // —— 该星系矿带 ——
  const belts = engine.belts.filter(
    (b) => b.galaxyId === galaxy.id || (galaxy.id === 'galaxy-hub' && !b.galaxyId),
  )
  const expOn = state.expedition.active
  const [mineAskBelt, setMineAskBelt] = useState<string | null>(null)
  function handleMineStart(beltId: string): void {
    if (state.mining.active) {
      onToast('采矿作业进行中：先停止当前开采再换矿带。', true)
      return
    }
    if (expOn && !mineAskBelt) {
      setMineAskBelt(beltId)
      onToast(
        '⚡ 远征中开采 = 转场：本次远征将取消（无战果）' +
          (state.autoLoopAnomalyId !== null ? '，连续出击同步停止' : '') +
          '——再点一次确认。',
        true,
      )
      return
    }
    setMineAskBelt(null)
    const r = expOn ? engine.startMiningFromExpeditionAt(beltId) : engine.startMiningAt(beltId)
    if (!r.ok) onToast(r.error ?? '无法开采', true)
  }

  // —— 该星系悬赏（只列当前可接；已首胜标黄不隐藏） ——
  const pilotName = shipDisplayName(state, ctx, state.shipId)
  const pilotRoleLabel = (() => {
    const role = fleetDefOf(state, ctx, state.shipId)?.role
    return role ? shipRoleLabel(role) : ''
  })()
  const miningActive = state.mining.active
  const [goAskAno, setGoAskAno] = useState<string | null>(null)
  function handleAnoGo(ano: AnomalyDef): void {
    if (miningActive && goAskAno !== ano.id) {
      setGoAskAno(ano.id)
      onToast(
        `⚡ 采矿中出击 = 转战：当前采矿将结束（已采 ${state.mining.tripUnits} 单位随船），从矿带星系出发。` +
          `当前驾驶「${pilotName}」${pilotRoleLabel ? `（${pilotRoleLabel}型）` : ''}——再点一次确认。`,
        true,
      )
      return
    }
    setGoAskAno(null)
    const r = miningActive ? engine.startExpeditionFromMiningAt(ano.id) : engine.startExpeditionAt(ano.id)
    if (!r.ok) onToast(r.error ?? '无法出发', true)
  }

  return (
    <div className="app-galaxy-actions">
      <div className="app-bay-title">前往星系 · 行动</div>
      {/* ⑧ 野外停留应急修理（修理系统 2026-09-05：驾驶船正停留本星系且带修理组件时可用） */}
      {state.awayGalaxy === galaxy.id ? (
        <FieldKitRepair engine={engine} onToast={onToast} />
      ) : null}
      {/* ① 前往掩护巡逻 */}
      <div className="app-ga-row">
        <span className="app-ga-main">
          ⛳ 前往掩护巡逻
          <span className="app-dim app-ga-desc">即时转场留守该星系（低安可触发巡逻/伏击；可采矿/出击/返航）</span>
        </span>
        <button
          className="app-btn is-small is-primary"
          disabled={standbyDisabled}
          title={standbyDisabled ? standbyTitle : `前往「${galaxy.name}」掩护巡逻（即时就位，无航行等待）`}
          onClick={handleStandby}
        >
          {inFlight ? '前往中…' : alreadyHere || state.awayGalaxy === galaxy.id ? '已在此掩护巡逻' : '前往掩护巡逻'}
        </button>
      </div>
      {/* ② 副船掩护巡逻 */}
      <div className="app-ga-row app-ga-ai">
        <select
          className="app-select"
          value={aiShip}
          onChange={(e) => setAiShip(e.target.value)}
          title="空闲副船"
          disabled={idleShips.length === 0}
        >
          <option value="">{idleShips.length === 0 ? '无空闲副船' : '— 选副船掩护巡逻 —'}</option>
          {idleShips.map((id) => (
            <option key={id} value={id}>
              {shipDisplayName(state, ctx, id)}
            </option>
          ))}
        </select>
        <select className="app-select" value={aiCore} onChange={(e) => setAiCore(e.target.value as AiCoreType)} title="AI 核心">
          {AI_CORE_ORDER.filter((t) => countAiCore(state, t) > 0).map((t) => (
            <option key={t} value={t}>
              {aiCoreName(t)}
            </option>
          ))}
        </select>
        <button className="app-btn is-small" disabled={!aiShip || !aiCoreAvailable} onClick={handleAiStandby}>
          派去掩护巡逻
        </button>
      </div>
      {/* ③ 矿带 */}
      <div className="app-bay-title app-ga-sub">矿带（{belts.length}）</div>
      {belts.length === 0 ? (
        <div className="app-dim app-ga-empty">该星系没有可采矿区。</div>
      ) : (
        belts.map((b) => {
          const ore = ctx.items.get(b.oreId)
          const isMiningThis = state.mining.active && state.mining.beltId === b.id
          return (
            <div key={b.id} className="app-ga-row">
              <span className="app-ga-main">
                {b.name}
                <span className="app-dim app-ga-desc">{ore?.name ?? b.oreId}（满载自动返航卸货；去程时间已并入返航）</span>
              </span>
              <button
                className={`app-btn is-small${isMiningThis || mineAskBelt === b.id ? ' is-warn' : ' is-primary'}`}
                disabled={isMiningThis || state.mining.active}
                title={
                  state.mining.active
                    ? isMiningThis
                      ? '采掘中（自动循环中）'
                      : '采矿作业进行中：先停止当前开采再换矿带'
                    : expOn
                      ? mineAskBelt === b.id
                        ? '再点一次确认：开采将取消本次远征（无战果）'
                        : '远征中：点击转开采（将取消本次远征）'
                      : '开始开采'
                }
                onClick={() => handleMineStart(b.id)}
              >
                {isMiningThis ? '采掘中' : mineAskBelt === b.id ? '⚡ 再点确认' : expOn ? '⚡ 转开采' : '⛏ 开采'}
              </button>
            </div>
          )
        })
      )}
      {/* ④ 悬赏 */}
      <div className="app-bay-title app-ga-sub">悬赏（{engine.anomalies.filter((a) => a.galaxyId === galaxy.id).length}）</div>
      {(() => {
        const list = engine.anomalies
          .filter((a) => a.galaxyId === galaxy.id)
          .filter((a) => {
            if (standingOf(state, DSI_FACTION_ID) < a.standingReq) return false
            if (bountyCooldownRemainingMs(state, a.id) > 0) return false
            if (state.expedition.active && state.expedition.anomalyId === a.id) return false
            return true
          })
        if (list.length === 0) {
          return <div className="app-dim app-ga-empty">该星系暂无可接悬赏（声望/冷却/进行中过滤）。</div>
        }
        const scanOn = state.scanning.active
        const transitOn = state.transit.active
        const otherExpOn = state.expedition.active && state.expedition.anomalyId !== null
        const goBlocked = scanOn || transitOn || (otherExpOn && !miningActive)
        return list.map((a) => (
          <div key={a.id} className="app-ga-row">
            <span className="app-ga-main">
              ⚔ {a.name}
              <span className="app-dim app-ga-desc">
                威胁 {a.threat} · 奖金 {Math.round(a.rewardIsk * bountyRewardFactor(state)).toLocaleString('zh-CN')} ISK
                {state.completedBounties.includes(a.id) ? ' · 已首胜' : ''}
              </span>
            </span>
            <button
              className={`app-btn is-small${goAskAno === a.id ? ' is-warn' : ' is-primary'}`}
              disabled={goBlocked}
              title={
                scanOn
                  ? '扫描探索进行中'
                  : transitOn
                    ? '返航空间站途中'
                    : otherExpOn && !miningActive
                      ? '远征进行中——先等当前远征结束'
                      : miningActive
                        ? goAskAno === a.id
                          ? '再点一次确认转战'
                          : '采矿中可转战'
                        : '出发远征'
              }
              onClick={() => handleAnoGo(a)}
            >
              {goAskAno === a.id ? '⚡ 再点确认' : miningActive ? '转战出发' : '出击'}
            </button>
          </div>
        ))
      })()}
      {/* ⑤ 残骸打捞（B3：采矿式单趟作业；需高槽打捞器，满仓自动返航卸货后结束） */}
      <div className="app-bay-title app-ga-sub">
        🛰 残骸打捞（该星系残骸密度 {wreckDensityOf(state, galaxy.id, engine.ctx).toFixed(1)}）
      </div>
      {state.salvaging.active && state.salvaging.galaxyId === galaxy.id ? (
        <div className="app-ga-row">
          <span className="app-ga-main">
            打捞作业中
            <span className="app-dim app-ga-desc">
              {state.salvaging.phase === 'outbound'
                ? '出航中'
                : state.salvaging.phase === 'returning'
                  ? '返航卸货中'
                  : `持续打捞（本趟约 ${Math.round(state.salvaging.tripM3 * 10) / 10} m³）`}
            </span>
          </span>
          <button className="app-btn is-small is-warn" onClick={() => engine.stopSalvageOpNow()}>
            ■ 停止
          </button>
        </div>
      ) : (
        <div className="app-ga-row">
          <span className="app-ga-main">
            打捞（需高槽打捞器）
            <span className="app-dim app-ga-desc">
              残骸回母港用精炼炉「残骸回收」开箱（保底矿物+彩头）；满仓自动返航；低安留意伏击
            </span>
          </span>
          <button
            className="app-btn is-small is-primary"
            disabled={state.salvaging.active}
            title={state.salvaging.active ? '打捞作业进行中（顶部活动栏可停止）' : '开始打捞（采矿式单趟）'}
            onClick={() => {
              const r = engine.startSalvageOpAt(galaxy.id)
              if (!r.ok) onToast(r.error ?? '无法打捞', true)
            }}
          >
            🛰 开始打捞
          </button>
        </div>
      )}
    </div>
  )
}

/* ─────────── 悬赏任务卡 ─────────── */

/**
 * 敌方战术 → 打法提示（C4 第二批收口·#3 丙，2026-09-05 船长确认"甲+丙"）：
 * 威胁数字是强度刻度、战术决定"哪种装配吃瘪"——kite 卡专治短程，光看威胁会误判。
 */
const FOE_TACTIC_HINTS: Record<string, string> = {
  brawl: '贴脸近战型：会被快速咬住——火力压制，或拉开距离消耗',
  orbit: '环绕中距型：中距对射，主动权取决于双方射程带',
  kite: '远程风筝型：射程压制——需远程火力对射，或高速贴脸钻其近盲带',
}

function AnomalyCard({ engine, anomaly, onToast }: { engine: GameEngine; anomaly: AnomalyDef; onToast: ToastFn }) {
  const state = engine.state
  const galaxy = engine.ctx.galaxies.get(anomaly.galaxyId)
  const power = calcPower(state, engine.ctx)
  // V12：预估胜率与引擎结算同源（期望推演）
  const pWin = battleWinPreview(state, engine.ctx, anomaly) * 100
  const chance = Math.round(pWin)
  const chanceTone = chance >= 70 ? '高' : chance >= 40 ? '中' : '低'
  const combatMs = anomaly.combatSeconds * 1000
  // 奖励/小时（去程已取消）：胜利即停留该星系、可即时再出击——每单耗时 ≈ 实时交火时长
  const roundTripMs = Math.max(1, combatMs)
  const grossIsk = anomaly.rewardIsk * bountyRewardFactor(state)
  const iskPerHour = roundTripMs > 0 ? grossIsk / (roundTripMs / 3_600_000) : 0
  const iskPerHourTxt =
    iskPerHour >= 1000
      ? `${(iskPerHour / 1000).toLocaleString('zh-CN', { maximumFractionDigits: 1 })}k`
      : Math.round(iskPerHour).toLocaleString('zh-CN')
  const standing = standingOf(state, DSI_FACTION_ID)
  const reqMet = standing >= anomaly.standingReq
  const unexplored = galaxy ? !isExplored(state, galaxy.id) : false // V13：星系未探索（悬赏情报例外可见）
  // T4 延后项：采矿中可「转战」（两步确认）；提示当前驾驶船（可能开着战斗船在挖矿）
  const [goAsk, setGoAsk] = useState(false)
  const lootText = anomaly.loot
    .map((l) => `${engine.ctx.items.get(l.itemId)?.name ?? l.itemId}×${l.units}`)
    .join('、')
  const mining = state.mining
  const miningActive = mining.active
  const pilotName = shipDisplayName(state, engine.ctx, state.shipId)
  const pilotRoleLabel = (() => {
    const role = fleetDefOf(state, engine.ctx, state.shipId)?.role
    return role ? shipRoleLabel(role) : ''
  })()
  const inFlightSelf = state.expedition.active && state.expedition.anomalyId === anomaly.id
  const inFlightOther = state.expedition.active && !inFlightSelf
  // 声望仅首胜发放：已首胜过的目标重复完成不再涨声望
  const bountyCleared = state.completedBounties.includes(anomaly.id)
  // T8：重复冷却 + 连续出击状态；优化：其它作业（采矿/扫描/返航/非本目标的远征）中不可开启
  const cdRemain = bountyCooldownRemainingMs(state, anomaly.id)
  const looping = state.autoLoopAnomalyId === anomaly.id
  const busyOther =
    state.mining.active ||
    state.scanning.active ||
    state.transit.active ||
    (state.expedition.active && state.autoLoopAnomalyId !== anomaly.id)
  // 出击可点条件：声望/探索/冷却/扫描/返港/远征在飞时禁；采矿中放行（转战）
  const goDisabled =
    !reqMet || unexplored || cdRemain > 0 || state.scanning.active || state.transit.active || inFlightSelf || inFlightOther

  function handleGoClick(): void {
    if (miningActive && !goAsk) {
      setGoAsk(true) // 展开卡片内联警示（替换底部 toast——警示要够明显）
      return
    }
    if (!goAsk) {
      const r = engine.startExpeditionAt(anomaly.id)
      if (!r.ok) onToast(r.error ?? '无法出发', true)
      else onToast('舰队已抵达目标空域，正在交火！')
      return
    }
    // 面板「确认转战」
    setGoAsk(false)
    const r = engine.startExpeditionFromMiningAt(anomaly.id)
    if (!r.ok) onToast(r.error ?? '无法转战', true)
    else onToast('已转战：采矿结束（货随船），舰队正从矿带星系出发。')
  }

  function toggleLoop(): void {
    const r = engine.bountyLoopAt(looping ? null : anomaly.id)
    if (!r.ok) onToast(r.error ?? '操作失败', true)
  }

  const locked = !reqMet || unexplored

  return (
    <div className={`app-ano-card${locked ? ' is-locked' : ''}`}>
      <div className="app-ano-top">
        <span className="app-ano-name">{anomaly.name}</span>
        <span className={`app-chip${locked ? ' is-dim' : ''}`}>
          {unexplored ? '🔭 星系未探索' : reqMet ? `威胁 ${anomaly.threat}` : `需声望 ${anomaly.standingReq}`}
        </span>
      </div>
      <div className="app-ano-meta">
        {galaxy ? (unexplored ? '未知星系（剪影）' : (
          <>
            {galaxy.name}
            {galaxy.security !== undefined ? (
              <span className={`app-sec-chip app-sec-chip-${secTone(galaxy.security)}`} title="该星系安全等级（负数 = 高危）">
                {secText(galaxy.security)}
              </span>
            ) : null}
          </>
        )) : '？'} ·{' '}
        {(() => {
          // 去程已取消（定稿）：下达即开战，不再展示"去程约 X"；交火后胜利即停留
          return (
            <>
              即时开战（去程取消） · 交火约 {formatDurationMs(anomaly.combatSeconds * 1000)} · 胜利后停留（可连击/返航）
            </>
          )
        })()}
        {cdRemain > 0 ? (
          <span className="app-dim" title="同目标重复出击的冷却（受该船扫描属性影响）">
            {' '}· ⏳ 冷却 {Math.max(1, Math.ceil(cdRemain / 1000))} 秒
          </span>
        ) : null}
      </div>
      {anomaly.tactic ? (
        <div className="app-ano-meta">
          <span className="app-dim" title="敌方战术决定了接战距离与克制关系：威胁低也可能打不动——胜率%与打法提示为准">
            🛰 {FOE_TACTIC_HINTS[anomaly.tactic] ?? `战术 ${anomaly.tactic}`}
          </span>
        </div>
      ) : null}
      <div className="app-ano-win">
        火力 {power} → 预估胜率 <b className={`app-win-${chanceTone}`}>{Math.round(chance)}%</b>
        {!reqMet ? <span className="app-dim">（声望 {standing}/{anomaly.standingReq}）</span> : null}
        {/* V17：敌方主伤害类型色 chip——护盾/装甲增强器按系配抗的换装依据 */}
        <span className="app-dim" title="敌方编队主伤害类型：护盾/装甲增强器按此配抗（缺口乘入），伤害构成见卡面">
          {' '}· 敌主伤 <DmgChip t={foeMainDamageType(anomaly)} />
        </span>
        {/* V17.2：敌方血型色 chip——选弹种依据：动能克盾 ×1.5 / 高爆克甲 ×1.5 */}
        {(() => {
          const p = anomaly.defProfile ?? 'balanced'
          const split = foeLayerSplit(p)
          const cn = p === 'shield' ? '盾厚' : p === 'armor' ? '甲厚' : '均衡'
          return (
            <span
              className="app-dim"
              title={`敌方三层血量占比：盾 ${Math.round(split.s * 100)}% / 甲 ${Math.round(split.a * 100)}% / 结构 ${Math.round(split.h * 100)}%——动能弹拆盾 ×1.5、高爆破甲 ×1.5、能量弹各层均衡`}
            >
              {' '}· 敌型 <ProfileChip profile={p} text={cn} />
            </span>
          )
        })()}
      </div>
      <div className="app-ano-reward">
        奖金 {Math.round(anomaly.rewardIsk * bountyRewardFactor(state)).toLocaleString('zh-CN')} ISK
        {anomaly.loot.length > 0 ? ` + ${lootText}` : ''} · 声望 +{anomaly.standingGain}
        {bountyCleared ? <span className="app-dim" title="该悬赏已首胜：重复完成不再获得声望，可转向新目标提升协会声望">（已首胜）</span> : null}
      </div>
      <div
        className="app-ano-econ"
        title={`估算奖励/小时（去程已取消：每次出击 = 实时交火时长）：${grossIsk.toLocaleString('zh-CN')} ISK ÷ ${formatDurationMs(roundTripMs)}`}
      >
        {MONEY_GLYPH} 估算 ≈{iskPerHourTxt} ISK/h（每次出击）
      </div>
      <div className="app-ano-bottom">
        <span className="app-ano-desc">
          {unexplored ? '该星系尚未探索——先到星图上对它的「未知信号」执行扫描探索，才能出发。' : anomaly.description}
        </span>
        <div className="app-ano-btns">
          <button
            className={`app-btn is-small${looping ? ' is-warn' : ''}`}
            disabled={!reqMet || unexplored || busyOther}
            title={
              !reqMet || unexplored
                ? '先满足声望/探索条件'
                : busyOther
                  ? '当前舰船正在采矿/扫描/返航或执行其它远征——作业结束后才能开启连击'
                  : looping
                    ? '停止自动循环（当前这一单会打完）'
                    : '开启连续出击：完成后冷却结束自动再次出发；货仓装不下缴获或耐久不足（修理组件耗尽）时自动暂停'
            }
            onClick={toggleLoop}
          >
            {looping ? '■ 停止连击' : '🔁 连续出击'}
          </button>
          <button
            className={`app-btn is-small ${miningActive && !goAsk ? 'is-warn is-primary' : goAsk ? 'is-dim' : 'is-primary'}`}
            disabled={goDisabled || goAsk}
            title={
              goAsk
                ? '转战确认已展开在下方——用面板按钮操作'
                : cdRemain > 0
                ? `重复出击冷却中（剩约 ${Math.max(1, Math.ceil(cdRemain / 1000))} 秒）`
                : !reqMet || unexplored
                  ? '先满足声望/探索条件'
                  : state.scanning.active
                    ? '扫描探索进行中——结束扫描后才能出发'
                    : state.transit.active
                      ? '返航空间站途中——到站后再出发'
                      : inFlightSelf
                        ? '该目标已在执行中'
                        : inFlightOther
                          ? '远征进行中——先等当前远征结束'
                          : miningActive
                            ? '采矿中：点击展开转战确认（将结束采矿、货随船、从矿带星系出发）'
                            : ''
            }
            onClick={handleGoClick}
          >
            {cdRemain > 0 ? '冷却中' : miningActive ? '⚡ 转战出发' : '出发'}
          </button>
        </div>
      </div>
      {/* T4 延后项：采矿中转战的醒目内联警示（操作按钮正下方全宽，取代易忽略的底部提示） */}
      {goAsk ? (
        <div className="app-ano-switch-confirm">
          <div className="app-sell-warn">
            ⚠ 采矿中出击 = <b>转场</b>：本次采矿将立即结束——本趟已采
            <b> {mining.tripUnits} 单位</b>留在船上（不卸货），舰船将从
            <b> 当前矿带星系</b>直接出发征讨「{anomaly.name}」。
          </div>
          <div className="app-ano-pilot-note">
            当前驾驶：「{pilotName}」{pilotRoleLabel ? `（${pilotRoleLabel}型）` : ''}
          </div>
          <div className="app-sell-confirm-btns">
            <button className="app-btn is-small is-danger" onClick={handleGoClick}>
              确认转战
            </button>
            <button className="app-btn is-small" onClick={() => setGoAsk(false)}>
              取消
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/* ═══════════════ T9：建站族任务卡 + 通讯器 ═══════════════ */

/** 通讯器浮层（D2：一次性完整呈现；逐句镜像日志由 engine.openDialogue 负责） */
export function Communicator({
  script,
  onClose,
}: {
  script: { title: string; lines: readonly { speaker: string; text: string }[] }
  onClose: () => void
}) {
  return (
    <div className="app-comm-mask" onClick={onClose}>
      <div className="app-comm" onClick={(e) => e.stopPropagation()}>
        <div className="app-comm-title">{script.title}</div>
        <div className="app-comm-body">
          {script.lines.map((l, i) => (
            <div key={i} className="app-comm-line">
              <span className="app-comm-speaker">{l.speaker}</span>
              <span className="app-comm-text">{l.text}</span>
            </div>
          ))}
        </div>
        <div className="app-comm-foot">
          <button className="app-btn is-small is-primary" onClick={onClose}>
            关闭（对话已存档进右侧事件日志）
          </button>
        </div>
      </div>
    </div>
  )
}

/** 建站族任务卡：状态 / 档位进度 / 提交 / 通讯重看 */
function StationCard({ engine, onToast }: { engine: GameEngine; onToast: ToastFn }) {
  const state = engine.state
  const [comm, setComm] = useState<string | null>(null)
  const [qty, setQty] = useState<number>(0)
  const [selItem, setSelItem] = useState<Record<string, string>>({})
  const sites = [...engine.ctx.stations.values()]
  return (
    <>
      {sites.map((site) => {
        const galaxy = engine.ctx.galaxies.get(site.galaxyId)
        const explored = galaxy ? isExplored(state, galaxy.id) : false
        const prog = state.stationSites[site.id] ?? { stage: 0, delivered: {} }
        const built = prog.stage >= site.tiers.length
        const tier = !built ? site.tiers[prog.stage]! : null
        const delTotal = site.acceptItemIds.reduce((sum, id) => sum + (prog.delivered[id] ?? 0), 0)
        const remain = tier ? Math.max(0, tier.count - delTotal) : 0
        const itemId = selItem[site.id] ?? site.acceptItemIds[0]!
        const dockedHere = state.awayGalaxy === null && state.dockedSite === site.id
        const availOf = (itemId: string): number =>
          (state.warehouse.items[itemId] ?? 0) + (state.fleet[state.shipId]?.cargo[itemId] ?? 0)
        const avail = site.acceptItemIds.reduce((s, id) => s + availOf(id), 0)
        const want = Math.min(Math.max(0, Math.floor(qty)), remain, avail)
        const intro = site.introDialogueId ? engine.dialogues.find((d) => d.id === site.introDialogueId) : undefined
        return (
          <div key={site.id} className={`app-station-card${built ? ' is-built' : ''}`}>
            <div className="app-station-head">
              <span className="app-station-name">
                {site.name}
                {built ? <em className="app-chip app-station-built">🏗 已建成</em> : null}
                {!built && tier ? (
                  <em className="app-chip">建造中 · 档位「{tier.name}」</em>
                ) : null}
              </span>
              <span className="app-dim">
                {galaxy?.name ?? site.galaxyId}
                {galaxy?.security !== undefined ? (
                  <span className={`app-sec-chip app-sec-chip-${secTone(galaxy.security)}`}>
                    {secText(galaxy.security)}
                  </span>
                ) : null}
                {dockedHere ? ' · 已停靠' : state.awayGalaxy === null && state.dockedSite === null ? ' · 母港' : ''}
              </span>
            </div>
            <div className="app-dim">{site.description}</div>
            {(() => {
              const mats = site.acceptItemIds.map((id) => engine.ctx.items.get(id)?.name ?? id)
              const srcBelts = [...engine.ctx.belts.values()].filter((b) => b.galaxyId === site.galaxyId)
              const req = srcBelts.length > 0 ? Math.max(...srcBelts.map((b) => b.standingReq ?? 0)) : 0
              const vol = engine.ctx.items.get(site.acceptItemIds[0] ?? '')?.unitM3
              return (
                <div className="app-station-mats">
                  所需物资：<b>{mats.join(' / ')}</b>
                  {srcBelts.length > 0 ? ` —— 产自「${srcBelts.map((b) => b.name).join('、')}」` : ''}
                  {req > 0 ? `（需协会声望 ${req} 方可开采）` : ''}
                  {vol !== undefined ? ` · 每单位占 ${vol} m³ 货舱` : ''}。两种物资可任意组合，按档位累计提交。
                </div>
              )
            })()}
            <div className="app-station-tiers">
              {site.tiers.map((t, i) => (
                <span key={t.name} className={`app-station-tier${prog.stage > i ? ' is-done' : ''}${prog.stage === i && !built ? ' is-cur' : ''}`}>
                  {i + 1}·{t.name}：{t.unlockDesc}（{t.count.toLocaleString('zh-CN')} 单位建材）{prog.stage > i ? ' ✓' : ''}
                </span>
              ))}
            </div>
            {!explored ? (
              <div className="app-dim">该星系尚未探索——先到星图上扫描点亮。</div>
            ) : built ? (
              <div className="app-dim">已并入空间站网络：本星系采矿返航 / 卸货 / 维修 / 补给 / 换驾驶可用。</div>
            ) : tier ? (
              <>
                <div className="app-station-progress">
                  本档已缴 {Math.min(delTotal, tier.count).toLocaleString('zh-CN')} / {tier.count.toLocaleString('zh-CN')} 单位
                  {remain === 0 ? '（凑齐后自动结算档位）' : ''}
                </div>
                {dockedHere ? (
                  <div className="app-station-deliver">
                    <span className="app-dim">提交建材（仓库+货仓）：</span>
                    <select
                      className="app-select"
                      value={itemId}
                      onChange={(e) => setSelItem((prev) => ({ ...prev, [site.id]: e.target.value }))}
                    >
                      {site.acceptItemIds.map((id) => (
                        <option key={id} value={id}>
                          {engine.ctx.items.get(id)?.name ?? id}（手头 {availOf(id).toLocaleString('zh-CN')}）
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={0}
                      max={avail}
                      value={Number.isFinite(qty) && qty > 0 ? qty : ''}
                      placeholder="数量"
                      onChange={(e) => setQty(Number(e.target.value))}
                      style={{ width: 90 }}
                    />
                    <button
                      className="app-btn is-small is-primary"
                      disabled={want <= 0}
                      title={want > 0 ? `提交 ${want.toLocaleString('zh-CN')} 单位` : '没有可提交的数量'}
                      onClick={() => {
                        const r = engine.deliverSiteAt(site.id, itemId, want)
                        if (!r.ok) onToast(r.error ?? '提交失败', true)
                        else onToast('建材已入库。')
                        setQty(0)
                      }}
                    >
                      提交
                    </button>
                  </div>
                ) : (
                  <div className="app-dim">需停靠在「{site.name}」（{galaxy?.name ?? ''}）才能提交建材。</div>
                )}
              </>
            ) : null}
            {intro ? (
              <button
                className="app-btn is-small"
                title="重看协会基建部的通讯（每次重看都会写入事件日志）"
                onClick={() => {
                  const r = engine.openDialogue(intro.id)
                  if (r.ok) setComm(intro.id)
                  else onToast(r.error ?? '通讯失败', true)
                }}
              >
                📡 通讯记录
              </button>
            ) : null}
          </div>
        )
      })}
      {comm ? (
        <Communicator
          script={engine.dialogues.find((d) => d.id === comm)!}
          onClose={() => setComm(null)}
        />
      ) : null}
    </>
  )
}
