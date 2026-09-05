/**
 * 战斗画面「视图核心」（从 BattleScreen 抽取，2026-09-05 维护性重构，观感零变化）：
 * 只含纯函数/常量/小展示件（颜色与演出计时、舰列几何、射程弧路径、三层血条、弹道几何、战报查找）；
 * 组件编排/状态机/渲染留在 BattleScreen。给未来 rAF/表现类改动一块独立地基。
 */
import type { DamageType } from '@whale/core'
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
  type: DamageType
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

/** 攻击形态演出参数（2026-09-05 船长：三族弹道观感分家）：
 * - kinetic 动能炮：快速曳光（默认 420ms）；
 * - explosive 导弹：慢速、虚线尾焰（760ms）——视觉上“追着飞”；
 * - plasma 激光/能量：近瞬光束（130ms）+ 细长光束线。 */
export const BOLT_LOOK: Record<DamageType, { fly: number; dash: number | null }> = {
  kinetic: { fly: 420, dash: null },
  explosive: { fly: 760, dash: 14 },
  plasma: { fly: 130, dash: null },
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

export {
  DMG_COLOR,
  DMG_LABEL,
  DMG_ORDER,
  ROLE_ACCENT,
  LAY,
  NOSE_MAIN,
  NOSE_ESC,
  FOE_CLASS,
  foeClassName,
  FLY_MS,
  BOLT_LIFE,
  FLASH_LIFE,
  BOOM_LIFE,
  STAR_LAYERS,
  genStars,
  clamp01,
  approachOf,
  layout,
  fanSegs,
  fanPath,
  ringPath,
  HP_LAYER_COLOR,
  HpTri,
  boltGeom,
  lastBattleReport,
}
export type { StarPt, Dims, Anchor, BoltV, FlashV, Stage, OutroSnap }
