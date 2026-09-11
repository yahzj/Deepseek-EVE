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
 *   船长 2026-09-11 裁定：这批卡的体积口径**延后**（等各族舰级在二号处补完再生效）。
 *
 * ⚠⚠ **2026-09-11 船长：「因为放大，导致各种距离不准了。能否先将各个级别舰船图形大小还原，
 *   系统保留进行测试」** ⇒ 本批**默认关**（见下方 `sizeByTierEnabled()` / `SIZE_BY_TIER_DEFAULT`）：
 *   **显示口径还原为改造前的统一体积（主舰 170 / 其余 90）**，而阶梯表、`foeShipTierOf` 反查、
 *   逐单位布局**系统全部保留就位**。
 *   为什么"距离不准"：距离尺本身是米 → 百分比（与舰体无关），但**同一米数对应的视觉缺口**
 *   是按统一 170/90 舰体标定的；舰体一大一小之后，读数（米）与观感（缺口）不再对应。 */
const TIER_SIZE: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 110, 2: 140, 3: 170, 4: 205, 5: 240 }
/** 僚机 / 轻装单位的体积系数（＝改造前 90/170 的既有比例，保留"轻装更小"的语义） */
const ESCORT_MUL = 0.53
/** 代码里的正式默认值（发布口径）：**关** = 还原统一体积；改 `true` 即正式启用阶梯（须复核视觉距离标定） */
const SIZE_BY_TIER_DEFAULT = false
/** 缓存的开关值（首次调用时读一次；测试/探针可在首次调用前注入 `localStorage` 桩） */
let sizeTierFlag: boolean | null = null
/**
 * 是否启用「舰种体积」——默认**否**（还原口径）；测试期由
 * `localStorage['whale-idle:ship-size-tier'] === '1'` 免重建启用（刷新生效）。
 */
function sizeByTierEnabled(): boolean {
  if (sizeTierFlag === null) sizeTierFlag = readFlag('whale-idle:ship-size-tier') ?? SIZE_BY_TIER_DEFAULT
  return sizeTierFlag
}

/** 读隐藏开关（与 V15 调试模式 `whale-idle:debug` 同款用法）：非浏览器环境 / 存储被禁 → `null`（用默认值） */
function readFlag(key: string): boolean | null {
  try {
    const v = localStorage.getItem(key)
    return v === null ? null : v === '1'
  } catch {
    return null
  }
}

/** **单位体积解析（敌我共用）**：见上方两段口径——默认走"还原"分支（统一 170/90） */
function sizeOfUnit(tier: number | null | undefined, escort: boolean): number {
  if (!sizeByTierEnabled()) return escort ? LAY.ESC : LAY.MAIN // 还原口径：主舰 170 / 其余 90（＝改造前逐像素）
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

/* ═══════ 敌列「错列雁阵」（2026-09-11 船长定：不要排成一行）═══════
 * 船长四条：① 甲 错列雁阵 ② 按角色——**主舰在前、僚机与杂鱼在后** ③ 血条跟着各舰走 ④ 尽量小动（只加偏移）；
 * 追加裁决：**加大错列幅度（≥68px）** ⇒ 取 `RANK_STAGGER = 72`（恰好一条血条高，上下梯队血条不互压）。
 * 语义：在 2D 侧视里"后" = 屏幕更高（与无人机"母舰上侧"、残骸上飘同一套语言），故**主舰在基线（最前最低）**、
 * 其余整体抬高 72px。单舰编成 `raise = 0` ⇒ 与改动前**逐像素一致**。
 * ⚠ 几何代价：后排顶对齐既有 `LAY.TOP` ⇒ 编队整体向下多占 72px（主舰下沉；我方舰位不动）。
 * `RANK_BY_WAVE` = **多波次是否再分一层**（第 n 波再抬 `n × 72`）——船长 2026-09-11「分别看下差异」，
 * 现取值见常量注释，两种口径的逐卡读数见 `docs/design/ship-battle-art/battle-formation-20260911.md`。 */
const RANK_STAGGER = 72
/** 多波增援是否再抬一层（`false` = 增援与残兵同梯队；`true` = 第 n 波再抬 n×72） */
const RANK_BY_WAVE = false
/** tag 的波序号（`w{n}-` 前缀；无前缀 = 第 0 波）——与引擎同口径 */
function foeWaveIndexOf(tag: string): number {
  const m = /^w(\d+)-/.exec(tag)
  return m ? parseInt(m[1]!, 10) : 0
}
/**
 * 是否**前排**（队长位）：`(w{n}-)?foe-0` = 本波首舰，或该单位舰级为**头目档**（`elite`，由
 * `core/foeShipEliteOf` 传进来）。⚠ **不能**用 `foeMainTagOf`：它把 `w{n}-foe-{k}`（k≥1）也算主舰
 * （2026-09-09 放宽口径）⇒ A 族卡 3 艘杂鱼会被当主舰、阵形根本不生效（首次探针即抓到此坑）。
 * 本判据**只看 tag 与数据**（不看谁还活着）⇒ 击毁单位不会让阵形重排跳动。
 */
function isFoeFrontRank(tag: string, elite: boolean): boolean {
  return /^(w\d+-)?foe-0$/.test(tag) || elite
}
/** 单位抬升量（px）：前排 0（基线，最前最低），后排 +`RANK_STAGGER`；按波分层时再 +`波序 × RANK_STAGGER` */
function foeRaiseOf(tag: string, elite: boolean): number {
  return (isFoeFrontRank(tag, elite) ? 0 : RANK_STAGGER) + (RANK_BY_WAVE ? foeWaveIndexOf(tag) * RANK_STAGGER : 0)
}
/** 血条步距（px）：`HpTri` 实测 = 3×10 行 + 2×2 间距 + 名字行 12 + 2 ≈ 48，取 50 留一条缝（拥挤梯队竖排用） */
const HP_BAR_H = 50
/** 血条宽上限 / 下限（px；`.app-bts-hpWrap` 现值 185，下限保证"护/甲/结"三段数字仍读得出） */
const HP_BAR_W_MAX = 185
const HP_BAR_W_MIN = 140
/** 血条几何（相对**本舰**的偏移量；`dx` 正 = 右移，`dy` 正 = 下移） */
interface BarGeom {
  width: number
  dx: number
  dy: number
}
/**
 * **逐舰血条几何**（船长 ③「血条跟着各舰走」+ 拥挤口径）：
 * 先按抬升量分梯队；梯队内相邻舰间距
 * - ≥ `MAX+6`：各条贴各自舰正下方，宽 185；
 * - ≥ `MIN+6`：各条贴各自舰正下方，宽 = `间距 − 6`（下限 140）——吃掉并排压叠；
 * - 更窄（如旧路径双僚机 94px）：**该梯队整组竖排堆叠**（宽 185，居中于该梯队，顺序 = 左右顺序），
 *   且**排到编队最下方**（`baseBottom` 之下依次向下）——排在原舰队行内会与前排的条相撞（探针实测）。
 * `baseBottom` = 编队基线（最前排舰底）；跨梯队的条天然相隔 `RANK_STAGGER(72) > 条高(48)` ⇒ 不会互压。
 */
function foeBarGeom(xs: readonly number[], raises: readonly number[], baseBottom: number): BarGeom[] {
  const n = xs.length
  const out: BarGeom[] = xs.map(() => ({ width: HP_BAR_W_MAX, dx: 0, dy: 0 }))
  const tiers = new Map<number, number[]>() // raise → 单位下标（保持左右顺序）
  for (let i = 0; i < n; i++) {
    const r = raises[i] ?? 0
    const list = tiers.get(r)
    if (list) list.push(i)
    else tiers.set(r, [i])
  }
  const stackDy = (i: number, k: number): number => {
    // 本舰舰底 → 编队基线（baseBottom）之下：跨过最前排的条（2 + 条高 + 2）
    const shipBottom = baseBottom - (raises[i] ?? 0)
    return baseBottom + 2 + HP_BAR_H + 2 + k * HP_BAR_H - shipBottom
  }
  let stacked = 0 // 已入堆叠区的条数（多个拥挤梯队时依次向下接排）
  for (const idxs of tiers.values()) {
    if (idxs.length <= 1) continue
    let minPitch = Number.POSITIVE_INFINITY
    for (let k = 1; k < idxs.length; k++) minPitch = Math.min(minPitch, Math.abs(xs[idxs[k]!]! - xs[idxs[k - 1]!]!))
    if (minPitch >= HP_BAR_W_MAX + 6) continue // 各自贴舰（185）
    if (minPitch >= HP_BAR_W_MIN + 6) {
      const w = Math.max(HP_BAR_W_MIN, Math.round(minPitch - 6))
      for (const i of idxs) out[i] = { width: w, dx: 0, dy: 0 }
      continue
    }
    // 整组竖排堆叠：居中于该梯队的 x 跨度，依次向下排（顺序 = 左右顺序）
    const first = idxs[0]!
    const last = idxs[idxs.length - 1]!
    const center = (xs[first]! + xs[last]!) / 2
    idxs.forEach((i, k) => {
      out[i] = { width: HP_BAR_W_MAX, dx: center - xs[i]!, dy: stackDy(i, stacked + k) }
    })
    stacked += idxs.length
  }
  return out
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
 * `foeSizes` = **逐舰体积**（px，见 `sizeOfUnit`）：整行宽/锚点按前缀和推进（**锚点永远跟实际舰宽**，
 *   2026-09-11 船长「乙」裁决——顺手修掉"多舰卡锚点按 90 槽位排、与实际舰体错位"的既有问题）。
 * `foeRaises` = **逐舰抬升量**（px，见 `foeRaiseOf`）：错列雁阵的纵向错开；行底 = `TOP + max(raise + 高)`。
 * `meSize` = 玩家舰体积；缺省 `LAY.MAIN`。
 */
function layout(
  d: Dims,
  foeSizes: readonly number[],
  visM: number,
  openM: number,
  nearM: number,
  meSize: number = LAY.MAIN,
  foeRaises: readonly number[] = [],
): {
  meLeft: number
  foeLeft: number
  me: Anchor
  foe: Anchor[]
  /** **实际落画**体积（px；启用阶梯时已含溢出收缩）——渲染尺寸/舰艏偏移必须用它，不能用入参原值 */
  sizes: number[]
  /** 编队基线 y（最前排舰底 = `TOP + max(抬升 + 舰高)`）——血条堆叠/自检用 */
  foeBottom: number
  /** 米制可用跨度（px）：贴脸(near)时舰缘间距 = LAY.GAP，拉满(open)时 = LAY.GAP+usable —— 与距离线性对应 */
  usable: number
} {
  const nFoe = foeSizes.length
  const gapW = Math.max(0, nFoe - 1) * LAY.ROW_GAP
  /**
   * 锚点槽位宽 = **逐舰实际体积**（渲染、弹道、血条、无人机阵位同一份坐标，天然自洽）。
   * 溢出保险（仅**启用舰种阶梯**时）：体积放大后整行可能宽过本窗口能给敌列的空间 → 等比收缩；
   * 还原口径下不收缩（＝改造前行为：行宽超出时由泳道裁剪）。
   * 预算按**窗口**算（W − 左右留白 − 我列宽 − 最小间距），**不吃 `d.foeW` 实测值**：
   * 敌列宽由本行内容撑出，拿它当预算会"越缩越小"地自我反馈。
   */
  let slots: number[] = [...foeSizes]
  if (sizeByTierEnabled()) {
    const maxRowW = Math.max(80, d.W - LAY.PAD * 2 - d.meW - LAY.GAP)
    const rawW = foeSizes.reduce((s, v) => s + v, 0)
    const fit = rawW + gapW > maxRowW ? Math.max(0.4, (maxRowW - gapW) / rawW) : 1
    slots = foeSizes.map((v) => Math.max(24, Math.round(v * fit)))
  }
  const rowW = slots.reduce((s, v) => s + v, 0) + gapW
  const usable = Math.max(0, d.W - LAY.PAD * 2 - d.meW - d.foeW - LAY.GAP)
  const g = approachOf(visM, openM, nearM) // 接近度：远 = 0，贴脸 = 1
  const t = (usable * g) / 2 // 越接近越向中线收拢
  let meLeft = LAY.PAD + t
  let foeLeft = d.W - LAY.PAD - d.foeW - t
  const minSpan = Math.min(LAY.GAP, Math.max(40, d.W - LAY.PAD * 2 - 60))
  if (foeLeft - (meLeft + d.meW) < minSpan) foeLeft = meLeft + d.meW + minSpan // 极小窗防御：不重叠
  const meH = meSize * 0.46
  const foeH = slots.map((w) => w * 0.46)
  // 编队高度 = max(抬升 + 舰高)：后排抬多高，编队就往下长多少（后排顶对齐 LAY.TOP）
  const env = Math.max(1, ...slots.map((_, i) => (foeRaises[i] ?? 0) + foeH[i]!))
  const rowLeft = foeLeft + (d.foeW - rowW) / 2
  const me: Anchor = { x: meLeft + d.meW / 2, y: LAY.TOP + meH / 2 }
  const foe: Anchor[] = []
  let acc = rowLeft
  for (let i = 0; i < nFoe; i++) {
    const w = slots[i]!
    const raise = foeRaises[i] ?? 0
    foe.push({ x: acc + w / 2, y: LAY.TOP + env - raise - foeH[i]! / 2 })
    acc += w + LAY.ROW_GAP
  }
  return { meLeft, foeLeft, me, foe, sizes: slots, foeBottom: LAY.TOP + env, usable }
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
  RANK_STAGGER,
  HP_BAR_W_MAX,
  foeRaiseOf,
  foeBarGeom,
  sizeByTierEnabled,
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
export type { StarPt, Dims, Anchor, BoltV, FlashV, Stage, OutroSnap, BarGeom }
