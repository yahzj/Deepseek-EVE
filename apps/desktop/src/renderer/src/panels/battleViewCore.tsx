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

/* 画面几何常量（px）
   2026-09-10 船长：整体下移（TOP 26→54）——无人机上凸出击弧会在顶部被裁掉，给上方留出弧线空间。
   注意：CSS `.app-bts-col` 的 top 必须与本值保持一致（舰列视觉位置与锚点同源）。 */
const LAY = { PAD: 36, GAP: 84, TOP: 54, MAIN: 170, ESC: 90, ROW_GAP: 4 }

/* ═══════ 舰种体积（2026-09-11 船长：战斗动画的舰身体积与舰种挂钩）═══════
 * `TIER_SIZE[档]` = 舰身显示宽（px）。**T3 锚在改造前的统一主尺寸 170** ⇒ 巡洋舰与今天一样大、
 * 护卫舰略小、战列/旗舰更大——相对关系正好把「舰种 = 质量分级」（`hullClass.ts` 五档）兑现。
 * 依据：**玩家** = `ShipDef.tier`；**敌方** = 编成条目所引舰级的 `FoeShipDef.hullClassTier`
 * （界面经 `core/foeShipTierOf(anomaly, tag)` 取值，与 `foeUnitNameOf` 同源）。
 * ⚠ **旧威胁推导路径的卡没有舰种档**（D/E/G 三族 9 张 + 4 张遭遇模板）⇒ **回落** `LAY.MAIN/ESC`；
 *   船长 2026-09-11 裁定：这批卡的体积口径**延后**（等各族舰级在二号处补完再生效）。 */
const TIER_SIZE: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 110, 2: 140, 3: 170, 4: 205, 5: 240 }
/** 僚机 / 轻装单位的体积系数（＝改造前 90/170 的既有比例，保留"轻装更小"的语义） */
const ESCORT_MUL = 0.53
/** **单位体积解析（敌我共用）**：有舰种档 → 阶梯 × 轻装系数；无档 → 回落尺寸（旧路径卡） */
function sizeOfUnit(tier: number | null | undefined, escort: boolean): number {
  if (tier === 1 || tier === 2 || tier === 3 || tier === 4 || tier === 5) {
    return Math.round(TIER_SIZE[tier] * (escort ? ESCORT_MUL : 1))
  }
  return escort ? LAY.ESC : LAY.MAIN
}
/** 舰艏（枪口）距舰体中心（px）：与舰身宽**线性**（新 240×110 形的舰艏尖距画布中心 ≈112 单位）
 *  ⇒ 170 → 79px、90 → 42px（与改造前的两个常量逐值一致，故回落口径零变化）。 */
function noseOf(size: number): number {
  return Math.round((112 * size) / 240)
}
/** 回落主尺寸的舰艏偏移（79）：**无舰种档**（旧路径卡）情形的口径常量——实际计算一律走 `noseOf(该舰体积)` */
const NOSE_MAIN = noseOf(LAY.MAIN)
/** 回落轻装尺寸的舰艏偏移（42）：同上 */
const NOSE_ESC = noseOf(LAY.ESC)

/** 弹道飞行时长 ms（撞点特效靠 CSS 动画延迟到此刻出现） */
const FLY_MS = 420
/** 弹道/闪光元素存活时间（略长于自身动画；渲染时惰性清理） */
const BOLT_LIFE = FLY_MS + 500
const FLASH_LIFE = 340
/** 敌舰爆炸演出生命周期 ms（渲染时清理；爆炸 CSS 动画 ~1.25s） */
const BOOM_LIFE = 1700
/** 机群被点防击落的坠落演出生命周期 ms（小爆炸环 + 碎片下坠；渲染时清理） */
const DRONE_DOWN_LIFE = 760

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
 * `foeSizes` = **逐舰体积**（px，见 `sizeOfUnit`）：改造成"逐单位尺寸"后，整行宽/锚点按
 *   前缀和推进，**底边对齐**（＝改造前"僚机底边与主体底边齐平"的一般化：各单位按各自高度沉底）。
 * `meSize` = 玩家舰体积；缺省 `LAY.MAIN`（与改造前逐值一致，旧调用点不受影响）。
 */
function layout(d: Dims, foeSizes: readonly number[], visM: number, openM: number, nearM: number, meSize: number = LAY.MAIN): {
  meLeft: number
  foeLeft: number
  me: Anchor
  foe: Anchor[]
  /** **实际落画**体积（px；已含溢出收缩）——渲染尺寸/舰艏偏移必须用它，不能用入参原值 */
  sizes: number[]
  /** 米制可用跨度（px）：贴脸(near)时舰缘间距 = LAY.GAP，拉满(open)时 = LAY.GAP+usable —— 与距离线性对应 */
  usable: number
} {
  // 溢出保险（2026-09-11）：舰种体积放大后，敌编队整行可能宽过**本窗口能给敌列的空间** → 等比收缩，
  // 保证一行仍在列内、不压到我列（体积上限 T5=240 × 4~6 舰这类编成才有机会触发）。
  // 预算按**窗口**算（W − 左右留白 − 我列宽 − 最小间距），**不吃 `d.foeW` 实测值**：
  // 敌列宽由本行内容撑出（实测值会跟着收缩后的行一起变小），拿它当预算会"越缩越小"地自我反馈。
  const nFoe = foeSizes.length
  const gapW = Math.max(0, nFoe - 1) * LAY.ROW_GAP
  const maxRowW = Math.max(80, d.W - LAY.PAD * 2 - d.meW - LAY.GAP)
  const rawW = foeSizes.reduce((s, v) => s + v, 0)
  const fit = rawW + gapW > maxRowW ? Math.max(0.4, (maxRowW - gapW) / rawW) : 1
  const widths = foeSizes.map((v) => Math.max(24, Math.round(v * fit)))
  const rowW = widths.reduce((s, v) => s + v, 0) + gapW
  const usable = Math.max(0, d.W - LAY.PAD * 2 - d.meW - d.foeW - LAY.GAP)
  const g = approachOf(visM, openM, nearM) // 接近度：远 = 0，贴脸 = 1
  const t = (usable * g) / 2 // 越接近越向中线收拢
  let meLeft = LAY.PAD + t
  let foeLeft = d.W - LAY.PAD - d.foeW - t
  const minSpan = Math.min(LAY.GAP, Math.max(40, d.W - LAY.PAD * 2 - 60))
  if (foeLeft - (meLeft + d.meW) < minSpan) foeLeft = meLeft + d.meW + minSpan // 极小窗防御：不重叠
  const meH = meSize * 0.46
  const foeH = widths.map((w) => w * 0.46)
  const rowH = Math.max(1, ...foeH) // 行底 = TOP + rowH（最高单位定高，其余沉底）
  const rowLeft = foeLeft + (d.foeW - rowW) / 2
  const me: Anchor = { x: meLeft + d.meW / 2, y: LAY.TOP + meH / 2 }
  const foe: Anchor[] = []
  let acc = rowLeft
  for (let i = 0; i < nFoe; i++) {
    const w = widths[i]!
    foe.push({ x: acc + w / 2, y: LAY.TOP + rowH - foeH[i]! / 2 })
    acc += w + LAY.ROW_GAP
  }
  return { meLeft, foeLeft, me, foe, sizes: widths, usable }
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
  /** 无人机机型 id（2026-09-10：弹点按机型形制渲染——蜂群小弹点；缺省 = 普通弹道） */
  drone?: string
  /** 显示延迟（ms；2026-09-10：无人机飞行途中开火 → 弹道等其抵达阵位再显示，位置才对） */
  delay?: number
}
interface FlashV {
  key: number
  at: number
  color: string
  x: number
  y: number
  /** 小型闪光（无人机机群出弹：体积小于母舰炮口闪光） */
  small?: boolean
  /** 显示延迟（ms；与弹道同源） */
  delay?: number
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

/** 开火事件 → 弹道几何：起点 = 源舰炮口（2026-09-10 起优先真实炮口 muzzle；muzzle 为空时
 *  回退舰艏前缘，nose 由调用侧按**该舰体积**算出，见 `noseOf(size)`），终点 = 目标舰枪口侧命中点。
 *  换算：挂点为 240×110 画布本地坐标 → 画面 px = 锚点 + 画布偏移 × (artW/240)；
 *  敌侧 dir = −1（敌舰以镜像姿态朝我开火时炮口恰在 −x 侧，与既有舰艏锚同语义）。 */
function boltGeom(
  side: 'me' | 'foe',
  src: Anchor,
  dst: Anchor,
  srcNose: number,
  dstNose: number,
  muzzle?: Anchor | null,
  artW?: number,
  /** 显式起点（2026-09-10：无人机弹道自机群位置起飞，优先于 muzzle/舰艏回退） */
  from?: Anchor | null,
): { x1: number; y1: number; len: number; angDeg: number } {
  const dir = side === 'me' ? 1 : -1
  const s = artW && artW > 0 ? artW / 240 : 1
  const sx = from ? from.x : muzzle ? src.x + dir * (muzzle.x - 120) * s : src.x + dir * srcNose
  const sy = from ? from.y : muzzle ? src.y + (muzzle.y - 55) * s : src.y
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
  /** 本场机群战损（机型 id → 击落架数；2026-09-10 点防上线，战报「机群损失」行用；空 = 无损失） */
  droneLost?: Record<string, number>
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
  TIER_SIZE,
  ESCORT_MUL,
  sizeOfUnit,
  noseOf,
  NOSE_MAIN,
  NOSE_ESC,
  FLY_MS,
  BOLT_LIFE,
  FLASH_LIFE,
  BOOM_LIFE,
  DRONE_DOWN_LIFE,
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
