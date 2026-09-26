/**
 * 舰船战斗图形（2026-09-09 三号重构，补上此前缺失的资产接线）：
 * 双层取形——
 * ① 传 shipId（玩家舰/敌舰**舰级 id**）或 foeKey（敌族 A~H）且命中资产表 →
 *    240×110 独立矢量形（舰首朝右；无类元素 = 主轮廓继承 currentColor 2.2 描边；
 *    面板线/族件/发光件类规则见 styles.css .shipart-*）；
 *    ⚠ 2026-09-26 起**敌舰也是逐舰形**（键 = 舰级 id）——取形链：`SHIP_ART[shipId]`
 *    （总表，含敌舰 30 条）→ `foeShipArtOf(shipId, foeKey)` 的逐舰 → 族形；详见 `foeShipArtOf` 注释。
 * ② 未命中（异常旧档/未录形）→ 回退 V12 role 线描剪影（140×64 放大适配，观感同旧版）。
 * 翻转 = 绕舰体中心 scaleX(-1)（CSS 过渡平滑转身，船头跟随运动方向）。
 * 引擎尾焰 2026-09-10 船长批：数量/位置对齐各舰引擎喷口——按 shipMounts.engines 逐口
 * 挂载（同尺寸焰形；喷口点 = 口沿左缘中点，焰形右尖恰好抵口）；未收录挂点的形回退旧单焰；
 * 脉冲动画沿用 .app-sprite-exhaust（纯 opacity/scale 动画，逐口由 <g> 平移隔离，互不干扰）。
 */
import type { ReactNode } from 'react'
import type { ShipRole } from '@whale/core'
import { FOE_ART, SHIP_ART, foeShipArtOf } from './shipArt'
import { mountsOf } from './shipMounts'

/** role → 线描舰形路径（回退形；船头朝右，viewBox 0 0 140 64） */
function hullPath(role: ShipRole): string {
  switch (role) {
    case 'armed':
      // 尖翼突击舰
      return 'M14 36 L70 8 L88 16 L124 30 L70 32 L70 24 L52 34 L14 36 Z M70 24 L70 32 L70 32'
    case 'armored':
      // 厚壳重甲舰
      return 'M20 12 h86 a8 8 0 0 1 8 8 v24 a8 8 0 0 1 -8 8 h-86 a8 8 0 0 1 -8 -8 v-24 a8 8 0 0 1 8 -8 z M28 24 h64 M20 40 h84'
    case 'hauler':
      // 长体货舰
      return 'M8 22 h96 l14 6 v8 l-14 6 h-96 a6 6 0 0 1 -6 -6 v-8 a6 6 0 0 1 6 -6 z M20 28 h70 M20 36 h70'
    default:
      // industrial：方正作业船 + 顶部作业塔
      return 'M22 16 h78 a6 6 0 0 1 6 6 v20 a6 6 0 0 1 -6 6 h-78 a6 6 0 0 1 -6 -6 v-20 a6 6 0 0 1 6 -6 z M28 26 h68 M28 34 h68 M44 8 h20 l4 8 h-28 z'
  }
}

/** 引擎尾焰（旧 140×64 画布形；放在舰尾、船头朝右 => 尾焰在左） */
const EXHAUST_LEGACY = 'M10 24 L2 30 L10 36 L14 30 Z'

/** 引擎尾焰（新 240×110 画布形：菱形右尖在 (24,51.6)；2026-09-10 起逐口挂载，
 *  <g translate(口沿x−24−EXHAUST_GAP, 口沿y−51.6)>：右尖与喷口口沿留一点空隙，焰向左喷出） */
const EXHAUST = 'M17.1 41.3 L3.4 51.6 L17.1 61.9 L24 51.6 Z'
/** 尾焰与喷口口沿的空隙（画布本地单位；2026-09-10 船长：完全贴口不美观，留一点距离） */
const EXHAUST_GAP = 5

/**
 * 尾焰挂载（2026-09-10 船长批：数量/位置对齐引擎喷口）：
 * - 有挂点数据 → 按 engines 每口一枚（同尺寸，右尖距口沿留 EXHAUST_GAP 空隙）；
 *   engines 为空（有机体异形等）→ 不画；
 * - 无挂点数据（未转录的形）→ 回退旧单焰，观感不变。
 */
function Exhausts({ shipId, foeKey }: { shipId?: string; foeKey?: string }) {
  const mounts = mountsOf(shipId, foeKey)
  if (!mounts) {
    return <path className="app-sprite-exhaust" d={EXHAUST} fill="currentColor" stroke="none" opacity="0.85" />
  }
  return (
    <>
      {mounts.engines.map((p, i) => (
        <g key={i} transform={`translate(${p.x - 24 - EXHAUST_GAP} ${p.y - 51.6})`}>
          <path className="app-sprite-exhaust" d={EXHAUST} fill="currentColor" stroke="none" opacity="0.85" />
        </g>
      ))}
    </>
  )
}

/** 舰体本地画布（与 .app-sprite 容器同比例：0.458 ≈ 容器高宽比 0.46，meet 无信箱边） */
const VB = '0 0 240 110'
const FLIP_ORIGIN = '120px 55px'

export function ShipSprite({
  role,
  shipId,
  foeKey,
  name,
  flip = false,
  accent = 'rgb(var(--wui-dim))',
  engine = true,
  size = 150,
}: {
  /** 回退剪影族别（资产表未命中时使用；敌舰按族取形时可不传） */
  role?: ShipRole
  /** 玩家舰 defId：命中 SHIP_ART 资产表走独立形（缺省回退 role 剪影） */
  shipId?: string
  /** 敌舰族群 A~G：命中 FOE_ART 资产表走族形 */
  foeKey?: string
  name?: string
  /** 镜像（头朝左）；战斗画面按移动方向动态切换，CSS 过渡平滑转身 */
  flip?: boolean
  accent?: string
  engine?: boolean
  size?: number
}) {
  const art: ReactNode | undefined = shipId
    ? // ⚠ 这里原来是 `shipId ? SHIP_ART[shipId] : foeKey ? FOE_ART[foeKey] : …`——
      // 三元表达式把两条路写成互斥，**敌舰一旦带回 shipId，族形分支就永远走不到**（2026-09-26 修）。
      // 现在：先查总资产表（玩家舰 25 艘 + 敌舰逐舰 30 条都在这张表里），
      // 查不到再按需回退——带回 shipId 的敌舰走 `foeShipArtOf` 的逐舰 → 族形链。
      (SHIP_ART[shipId] ?? (foeKey ? foeShipArtOf(shipId, foeKey) : undefined))
    : foeKey
      ? FOE_ART[foeKey]
      : undefined
  if (art) {
    return (
      <div className="app-sprite" style={{ width: size, height: Math.round(size * 0.46) }}>
        <svg viewBox={VB} width="100%" height="100%" fill="none" aria-hidden="true">
          <g
            style={{
              transform: `scale(${flip ? -1 : 1}, 1)`,
              transformOrigin: FLIP_ORIGIN, // 绕新画布中心翻转（配合 .app-sprite svg g 的 transform-box: view-box）
              color: accent,
            }}
            stroke="currentColor"
            strokeWidth="2.2" // 主轮廓线宽（无类元素；面板/族件等 CSS 类自带线宽覆盖此值）
            strokeLinejoin="round"
          >
            {engine ? <Exhausts shipId={shipId} foeKey={foeKey} /> : null}
            {art}
          </g>
        </svg>
        {name ? <div className="app-sprite-name">{name}</div> : null}
      </div>
    )
  }

  // ── 回退形：V12 role 剪影（与重构前渲染完全一致） ──
  return (
    <div className="app-sprite" style={{ width: size, height: Math.round(size * 0.46) }}>
      <svg viewBox="0 0 140 64" width="100%" height="100%" fill="none" aria-hidden="true">
        <g
          style={{
            transform: `scale(${flip ? -1 : 1}, 1)`,
            transformOrigin: '70px 32px', // 绕舰体中心翻转（配合 transform-box: view-box）
            color: accent,
          }}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        >
          {engine ? <path className="app-sprite-exhaust" d={EXHAUST_LEGACY} fill="currentColor" stroke="none" opacity="0.85" /> : null}
          <path d={hullPath(role ?? 'industrial')} />
        </g>
      </svg>
      {name ? <div className="app-sprite-name">{name}</div> : null}
    </div>
  )
}

/* 2026-09-26 删：原先这里导出 `roleLabel(role)`（直读 core 的角色名纯中文表）。
   全仓**无人引用**（`grep roleLabel` 只剩它自己），而英文界面下它会漏中文 ⇒ 直接删掉，
   要显示角色名请用 `ui/labelsText.ts` 的 `shipRoleText()`（本地化单点）。 */

/**
 * **把舰形画进"已经存在的 SVG"**（2026-09-13 · 虫洞地图的"当前格 = 玩家舰"用）：
 * 只输出一个 `<g>`（**不套 `<div>`/`<svg>` 外壳**，否则嵌进地图的 `<svg>` 里就是非法嵌套）。
 *
 * 画布口径沿用资产表（`SHIP_ART` = 240×110、船头朝右；未命中回退 140×64 的 role 剪影）——
 * 本组件**自带"缩放到目标宽度 + 居中到原点"的变换** ⇒ 调用方只要把它放进一个负责定位/动画的
 * 外层 `<g>`（例如地图格子上做 CSS transform 过渡）即可。
 * 尾焰默认**不画**（地图格子小，焰形会糊成一团；要画就传 `engine`）。
 */
export function ShipSpriteShape({
  role,
  shipId,
  size = 22,
  flip = false,
  engine = false,
}: {
  role?: ShipRole
  shipId?: string
  /** 目标显示宽度（地图用户单位 / 像素）；高度按资产比例自动算 */
  size?: number
  flip?: boolean
  engine?: boolean
}) {
  const art: ReactNode | undefined = shipId ? SHIP_ART[shipId] : undefined
  const w = art ? 240 : 140
  const h = art ? 110 : 64
  const s = size / w
  const place = `scale(${s.toFixed(5)}) translate(${-w / 2},${-h / 2})`
  const mirror = flip ? ` scale(-1,1) translate(${-w},0)` : ''
  return (
    <g
      className="app-wh-ship-shape"
      transform={place + mirror}
      stroke="currentColor"
      strokeWidth={art ? 2.2 : 2}
      strokeLinejoin="round"
      fill="none"
    >
      {engine ? <Exhausts shipId={shipId} /> : null}
      {art ?? <path d={hullPath(role ?? 'industrial')} />}
    </g>
  )
}
