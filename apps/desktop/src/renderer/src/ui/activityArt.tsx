/**
 * **主控活动窗口 · 演出美术**（2026-09-21 船长：「目前还是过于简陋」「还不如左上角的小窗来的精细，
 * 需要补齐细节（包括我方舰船外形等）可以先参考左上角的小窗」）。
 *
 * 相比第一版的四处补齐（口径对齐 `ui/ShipStatusWin.tsx` 那个小窗，只是画布放大）：
 * ① **舰船用真实矢量外形**：第一版把主控画成一个菱形占位符——这是"不如小窗"的主因。
 *    现在舰体走 `ShipSpriteShape`（**画进同一张 SVG**：25 艘舰各自外形、引擎尾焰按真实喷口、
 *    面板线与发光件沿用 `.shipart-*` 资产类），与全站同源。
 * ② **星空层**：小窗有星点阵，活动窗口原来只有纯色底 ⇒ 按小窗 `STAR_BASE` 的密度口径扩成大画布星野
 *    （同一片星空固定种子生成，不逐帧随机）。
 * ③ **漂浮物与远景**：矿岩 / 残片 / 航标 / 回波 / 远方虫洞候选全部落进 SVG 环境层，
 *    与小窗的 `app-swin-drift` 同一套动画语言（只是尺度放大）。
 * ④ **节拍跟真实进度**：见下方"两层动画"口径。
 *
 * **两层动画口径**（2026-09-21）：
 * - **动感层**（激光闪烁 / 碎屑回流 / 牵引锥呼吸 / 航迹拖尾 / 扫描波外掠）：固定短周期，
 *   负责"在动"——这一层与进度无关，快慢只服从观感。
 * - **进度层**（矿脉高光 / 打捞弧 / 航标进度环 / 扫描雷达环，类名带 `app-act-tick`）：
 *   **相位锁真实作业进度**。舞台上的 `--act-cycle` = 一个作业周期的毫秒数、`--act-delay` = 已走毫秒的
 *   负值（见 `styles.css` 与 `ActivityScreen.tsx`）⇒ **周期完成那一刻正好走到峰值**（产出 / 到站 /
 *   扫完一遍的瞬间亮一下），进度归零时相位也归零。周期过长过短只**夹节拍**（<1.6s 闪成一片 /
 *   >12s 近乎静止），**相位照样按真实进度对齐，读数与进度条不受任何影响**。
 *
 * 坐标口径：SVG 画布 `560×220`（`preserveAspectRatio="xMidYMid meet"` 等比铺满舞台）。
 * 舰体与作业光带、货柜、扫描桅杆**同在一个 `app-act-float` 组里**——同周期同位移地一起轻浮，
 * 激光永远不脱靶（小窗 `app-swin-work` 同款做法）。
 *
 * 性能口径（约定第十四章）：只动 `transform` / `opacity`；不碰 `filter` / `box-shadow` / 宽高；
 * 不新建 rAF；场景组件 `memo`（引擎每 tick 整树重渲染时不再重建这几十个 SVG 节点）。
 */
import { memo } from 'react'
import type { ComponentType, ReactNode } from 'react'
import type { ShipRole } from '@whale/core'
import { ShipSpriteShape } from './ShipSprite'

/** 画布尺寸（与 `ActivityScreen` 的 `viewBox` 一致） */
export const ACT_W = 560
export const ACT_H = 220

/** 主控舰锚点（舰体几何中心；各场景把舰放在这里） */
export const SHIP_ANCHOR = { x: 196, y: 112 }

/** 主控舰显示宽度（画布单位；舰形资产是 240×110，故高度 = 0.46×此值） */
const SHIP_W = 164

/**
 * 作业光带 / 牵引锥的**起点**（画布 x）。
 *
 * 取 `SHIP_ANCHOR.x + 34` 而不是"舰首位置"（+82）：各舰的**实际描边范围**并不等于画布宽
 * （舰形资产 240×110 里留了边距，实测最窄的舰描边只到 ±61、最宽到 ±82）——按舰首取点，
 * 窄舰就会露出一截"光带悬浮在舰首外"（2026-09-21 无头实测：打捞舰光带离舰 7 单位）。
 * 固定在锚点内侧 34 单位 ⇒ 对**任何**舰形都从舰体内射出（且舰体是线稿、光带自会透出，与状态窗同观感）。
 */
const EMITTER_X = SHIP_ANCHOR.x + 34

/** 场景道具位（各场景共用：作业对象在右侧，留出"舰—对象"之间的作业距离） */
const ROCK = { x: 462, y: 104 }
const WRECK_A = { x: 452, y: 82 }
const WRECK_B = { x: 486, y: 146 }
const GATE = { x: 486, y: 108 }
const POD = { x: 150, y: 178 }

/** 星野（确定性伪随机：固定种子 ⇒ 每次构建都是同一片星空，不逐帧跳；密度对齐小窗） */
const STARS: Array<[number, number, number, number]> = (() => {
  let s = 20260921
  const rnd = (): number => (s = (s * 16807) % 2147483647) / 2147483647
  const out: Array<[number, number, number, number]> = []
  for (let i = 0; i < 96; i++) out.push([rnd() * ACT_W, rnd() * ACT_H, 0.7 + rnd() * 0.9, 0.22 + rnd() * 0.5])
  return out
})()

/** 星点层（各场景共用；静态不参与动画，低对比不压舰体线稿） */
function Stars(): JSX.Element {
  return (
    <g className="app-act-stars">
      {STARS.map(([x, y, r, o], i) => (
        <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r={r.toFixed(2)} opacity={o.toFixed(2)} />
      ))}
    </g>
  )
}

/**
 * 漂浮物落位与动画**分层**（2026-09-21 自查修正）：
 * 落位要靠 `transform="translate(…)"`、漂移动画也要动 `transform`——同一个元素上两处抢一个属性，
 * 结果就是"动画把落位覆盖掉、所有漂浮物全挤在画布左上角"。故：**外层 `<g transform>` 落位、
 * 内层 `.app-act-drift` 动画**，各管一处。
 */
function DriftItem({
  x,
  y,
  kind,
  small,
  dur,
  delay,
  children,
}: {
  x: number
  y: number
  kind: 'rock' | 'debris' | 'gate' | 'probe'
  small?: boolean
  dur: string
  delay: string
  children: ReactNode
}): JSX.Element {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g
        className={`app-act-drift is-${kind}${small ? ' is-small' : ''}`}
        style={{ animationDuration: dur, animationDelay: delay }}
      >
        {children}
      </g>
    </g>
  )
}

/** 浮岩（采掘）：三块大小错相位漂移，与小窗 `app-swin-drift is-rock` 同语言 */
function DriftRocks(): JSX.Element {
  return (
    <>
      <DriftItem x={470} y={42} kind="rock" dur="11s" delay="0s">
        <path d="M2 12 L10 3 L22 5 L26 15 L19 25 L5 22 Z" />
        <path d="M10 7 l9 2 M8 17 l7 -2 M18 19 l5 -2" strokeOpacity="0.45" />
      </DriftItem>
      <DriftItem x={404} y={188} kind="rock" small dur="13.5s" delay="3.6s">
        <path d="M2 9 L13 2 L20 6 L17 13 L6 15 Z" />
      </DriftItem>
      <DriftItem x={530} y={150} kind="rock" small dur="16s" delay="7.2s">
        <path d="M3 8 L12 3 L18 8 L14 14 L5 13 Z" />
      </DriftItem>
    </>
  )
}

/** 浮残片（打捞）：三块碎片翻滚漂移 */
function DriftDebris(): JSX.Element {
  return (
    <>
      <DriftItem x={452} y={30} kind="debris" dur="10s" delay="0.6s">
        <path d="M2 9 L13 1 L24 5 L20 14 L7 16 Z" />
        <path d="M13 3 l2 6 M7 12 l6 0" strokeOpacity="0.45" />
      </DriftItem>
      <DriftItem x={392} y={196} kind="debris" small dur="13s" delay="4s">
        <path d="M1 7 L11 2 L16 9 L9 14 Z" />
      </DriftItem>
      <DriftItem x={524} y={176} kind="debris" small dur="15s" delay="8.4s">
        <path d="M2 6 L10 2 L15 7 L11 13 L3 12 Z" />
      </DriftItem>
    </>
  )
}

/** 浮航标（长途运输）：两个方向标错相位掠过 */
function DriftGates(): JSX.Element {
  return (
    <>
      <DriftItem x={480} y={46} kind="gate" dur="12s" delay="0s">
        <path d="M2 10 L14 3 L24 10 L14 17 Z" />
        <path d="M14 3 V17" strokeOpacity="0.4" />
      </DriftItem>
      <DriftItem x={430} y={192} kind="gate" small dur="15s" delay="5.5s">
        <path d="M2 7 L11 2 L17 7 L11 12 Z" />
      </DriftItem>
    </>
  )
}

/** 浮信号（扫描）：三粒信号点由远及近漂过 */
function DriftSignals(): JSX.Element {
  return (
    <>
      <DriftItem x={470} y={40} kind="probe" dur="10.5s" delay="0s">
        <circle cx="9" cy="9" r="6" />
        <circle cx="9" cy="9" r="1.8" stroke="none" />
      </DriftItem>
      <DriftItem x={510} y={186} kind="probe" small dur="13s" delay="3.5s">
        <circle cx="7" cy="7" r="4" />
        <circle cx="7" cy="7" r="1.3" stroke="none" />
      </DriftItem>
      <DriftItem x={418} y={166} kind="probe" small dur="16s" delay="7s">
        <circle cx="6" cy="6" r="3" />
        <circle cx="6" cy="6" r="1" stroke="none" />
      </DriftItem>
    </>
  )
}

/** 各场景共享的舰体参数 */
export interface ShipFx {
  /** 主控舰 defId（走 `SHIP_ART` 的真实外形；缺 = 回落 role 剪影） */
  shipId?: string
  /** 回退剪影族别 */
  role?: ShipRole
  /** 舰体主色（作业色 / 角色色，与状态窗 `WORK_ACCENT` 同源） */
  accent: string
  /** 是否画引擎尾焰（作业中都在喷；口径同状态窗） */
  engine: boolean
}

/**
 * 主控舰（真实舰形画进同一张 SVG）+ 随舰作业件。
 * `ShipSpriteShape` 自带"缩放到目标宽度 + 居中到原点"⇒ 这里只把它移到锚点；
 * 外层 `.app-act-float` 让**舰体与随舰件一起**轻浮（同周期同位移 ⇒ 光带不脱靶）。
 */
function Ship({ fx, children }: { fx: ShipFx; children?: ReactNode }): JSX.Element {
  return (
    <g className="app-act-float" style={{ color: fx.accent }}>
      {children}
      <g transform={`translate(${SHIP_ANCHOR.x} ${SHIP_ANCHOR.y})`}>
        <ShipSpriteShape shipId={fx.shipId} role={fx.role} size={SHIP_W} engine={fx.engine} />
      </g>
    </g>
  )
}

/** 采掘：采掘激光自舰首打到矿岩，矿屑错相位回流货舱；矿脉高光是进度层 */
const MineSpr = memo(function MineSpr({ fx }: { fx: ShipFx }) {
  return (
    <>
      <Stars />
      <DriftRocks />
      <Ship fx={fx}>
        <path className="app-act-beam" d={`M${EMITTER_X} ${SHIP_ANCHOR.y} H${ROCK.x - 33}`} />
      </Ship>
      <g className="app-act-rock">
        <path d={`M${ROCK.x - 34} ${ROCK.y - 6} L${ROCK.x - 12} ${ROCK.y - 34} L${ROCK.x + 24} ${ROCK.y - 30} L${ROCK.x + 42} ${ROCK.y - 2} L${ROCK.x + 26} ${ROCK.y + 30} L${ROCK.x - 14} ${ROCK.y + 32} Z`} />
        <path d={`M${ROCK.x - 14} ${ROCK.y - 20} l20 4 M${ROCK.x - 10} ${ROCK.y + 12} l16 -4 M${ROCK.x + 14} ${ROCK.y + 16} l12 -6`} strokeOpacity="0.45" />
        {/* 矿脉高光（进度层：越接近出货越亮，产出那一刻最亮） */}
        <path className="app-act-tick app-act-vein" d={`M${ROCK.x - 6} ${ROCK.y - 22} l10 8 l-8 10`} />
      </g>
      {/* 矿屑回流货舱（动感层） */}
      <rect className="app-act-chip" x={ROCK.x - 44} y={ROCK.y - 30} width="11" height="11" />
      <rect className="app-act-chip is-late" x={ROCK.x - 20} y={ROCK.y + 26} width="11" height="11" />
      <rect className="app-act-chip is-late2" x={ROCK.x - 62} y={ROCK.y + 30} width="11" height="11" />
      <rect className="app-act-chip" x={ROCK.x - 92} y={ROCK.y - 34} width="11" height="11" />
    </>
  )
})

/** 打捞：牵引锥呼吸 + 扫描弧扫过残片，残片碎屑被吸回货舱 */
const SalvageSpr = memo(function SalvageSpr({ fx }: { fx: ShipFx }) {
  return (
    <>
      <Stars />
      <DriftDebris />
      <Ship fx={fx}>
        <path className="app-act-cone" d={`M${EMITTER_X} ${SHIP_ANCHOR.y} L${WRECK_A.x + 60} ${WRECK_A.y - 56} L${WRECK_B.x + 40} ${WRECK_B.y + 44} Z`} fill="currentColor" fillOpacity="0.1" />
        <path className="app-act-beam" d={`M${EMITTER_X} ${SHIP_ANCHOR.y} H${WRECK_B.x + 20}`} />
      </Ship>
      {/* 两块待捞残骸（缓慢起伏：它们是漂浮物，但位移小到牵引锥不脱靶） */}
      <g className="app-act-bob">
        <g className="app-act-wreck-a">
          <path d={`M${WRECK_A.x - 26} ${WRECK_A.y - 12} L${WRECK_A.x + 10} ${WRECK_A.y - 34} L${WRECK_A.x + 44} ${WRECK_A.y - 6} L${WRECK_A.x + 12} ${WRECK_A.y + 24} Z`} />
          <path d={`M${WRECK_A.x - 8} ${WRECK_A.y - 16} l14 8 M${WRECK_A.x + 6} ${WRECK_A.y + 10} l16 -8`} strokeOpacity="0.45" />
        </g>
        <g className="app-act-wreck-b">
          <path d={`M${WRECK_B.x - 22} ${WRECK_B.y - 8} L${WRECK_B.x + 6} ${WRECK_B.y - 24} L${WRECK_B.x + 34} ${WRECK_B.y - 2} L${WRECK_B.x + 10} ${WRECK_B.y + 20} Z`} />
          <path d={`M${WRECK_B.x - 12} ${WRECK_B.y - 4} l12 4`} strokeOpacity="0.45" />
        </g>
      </g>
      {/* 打捞扫描弧（进度层：一台打捞器走完一轮的瞬间扫到最亮） */}
      <path className="app-act-tick app-act-arc" d={`M${WRECK_A.x - 42} ${WRECK_A.y - 40} C${WRECK_A.x - 10} ${WRECK_A.y - 72} ${WRECK_A.x + 26} ${WRECK_A.y - 84} ${WRECK_A.x + 58} ${WRECK_A.y - 88}`} />
      <rect className="app-act-chip" x={WRECK_A.x - 96} y={WRECK_A.y - 4} width="11" height="11" />
      <rect className="app-act-chip is-late" x={WRECK_A.x - 124} y={WRECK_A.y + 30} width="11" height="11" />
      <rect className="app-act-chip is-late2" x={WRECK_B.x - 118} y={WRECK_B.y - 26} width="11" height="11" />
    </>
  )
})

/** 长途运输共用：航标 + 航迹（承运段多挂一只货柜） */
function HaulBase({ fx, loaded }: { fx: ShipFx; loaded: boolean }): JSX.Element {
  return (
    <>
      <Stars />
      <DriftGates />
      {/* 航迹（动感层；一律在舰尾**后方**，向左流走 = 舰在向右赶路） */}
      <path className="app-act-trail" d={`M18 ${SHIP_ANCHOR.y + 6} H${SHIP_ANCHOR.x - 86}`} />
      <path className="app-act-trail is-late" d={`M26 ${SHIP_ANCHOR.y - 22} H${SHIP_ANCHOR.x - 84}`} />
      <path className="app-act-trail is-late2" d={`M26 ${SHIP_ANCHOR.y + 32} H${SHIP_ANCHOR.x - 84}`} />
      {/* 目的航标（放大；进度环是进度层：快到站时环亮起来） */}
      <g className="app-act-gate">
        <path d={`M${GATE.x - 34} ${GATE.y} L${GATE.x + 16} ${GATE.y - 34} L${GATE.x + 58} ${GATE.y} L${GATE.x + 16} ${GATE.y + 34} Z`} />
        <path d={`M${GATE.x + 16} ${GATE.y - 34} V${GATE.y + 34}`} strokeOpacity="0.4" />
      </g>
      <circle className="app-act-tick app-act-legring" cx={GATE.x + 16} cy={GATE.y} r="26" />
      {/* 舰体（+ 承运段吊在舰腹下的外挂货柜；就位段空舱 ⇒ 不挂。
          货柜与吊索进同一个 float 组 ⇒ 随舰一起轻浮，吊索不会脱钩） */}
      <Ship fx={fx}>
        {loaded ? (
          <>
            <g className="app-act-pod">
              <rect x={POD.x - 54} y={POD.y - 18} width="108" height="36" rx="4" />
              <path d={`M${POD.x - 36} ${POD.y - 18} V${POD.y + 18} M${POD.x} ${POD.y - 18} V${POD.y + 18} M${POD.x + 36} ${POD.y - 18} V${POD.y + 18}`} strokeOpacity="0.45" />
              <path d={`M${POD.x - 54} ${POD.y - 6} h7 M${POD.x - 54} ${POD.y + 6} h7 M${POD.x + 47} ${POD.y - 6} h7 M${POD.x + 47} ${POD.y + 6} h7`} strokeOpacity="0.6" />
            </g>
            <path className="app-act-sling" d={`M${SHIP_ANCHOR.x - 62} ${SHIP_ANCHOR.y + 30} L${POD.x - 40} ${POD.y - 18} M${SHIP_ANCHOR.x + 24} ${SHIP_ANCHOR.y + 34} L${POD.x + 34} ${POD.y - 18}`} />
          </>
        ) : null}
      </Ship>
    </>
  )
}

/** 长途运输·承运：满载挂柜，货柜随舰体轻晃 */
const HaulSpr = memo(function HaulSpr({ fx }: { fx: ShipFx }) {
  return <HaulBase fx={fx} loaded />
})

/** 长途运输·就位：空舱赶路——只有航迹与远方端点，没有货柜 */
const HaulPosSpr = memo(function HaulPosSpr({ fx }: { fx: ShipFx }) {
  return <HaulBase fx={fx} loaded={false} />
})

/** 扫描虫洞：展开扫描阵列，扇形扫描波自舰体向外掠过，回波信号点闪回 */
const ScanSpr = memo(function ScanSpr({ fx }: { fx: ShipFx }) {
  return (
    <>
      <Stars />
      <DriftSignals />
      {/* 远方虫洞候选（未确认的暗环，缓慢呼吸；确认靠下方回波点） */}
      <g className="app-act-wh">
        <ellipse cx="512" cy="62" rx="22" ry="30" />
        <path d="M512 40 C524 48 524 76 512 84 C500 76 500 48 512 40 Z" strokeOpacity="0.5" />
      </g>
      {/* 扫描雷达环（进度层：扫完一遍的瞬间涨到最大最亮） */}
      <circle className="app-act-tick app-act-radar" cx={SHIP_ANCHOR.x} cy={SHIP_ANCHOR.y} r="54" />
      {/* 三道扇形扫描波（动感层） */}
      <path className="app-act-wave" d={`M${SHIP_ANCHOR.x + 86} 16 C${SHIP_ANCHOR.x + 128} 62 ${SHIP_ANCHOR.x + 128} 158 ${SHIP_ANCHOR.x + 86} 204`} />
      <path className="app-act-wave is-late" d={`M${SHIP_ANCHOR.x + 154} -6 C${SHIP_ANCHOR.x + 206} 60 ${SHIP_ANCHOR.x + 206} 160 ${SHIP_ANCHOR.x + 154} 226`} />
      <path className="app-act-wave is-late2" d={`M${SHIP_ANCHOR.x + 222} -28 C${SHIP_ANCHOR.x + 284} 58 ${SHIP_ANCHOR.x + 284} 162 ${SHIP_ANCHOR.x + 222} 248`} />
      {/* 回波信号点（扫到东西了） */}
      <circle className="app-act-echo" cx="500" cy="70" r="7" />
      <circle className="app-act-echo is-late" cx="474" cy="152" r="5" />
      <circle className="app-act-echo is-late2" cx="416" cy="96" r="4" />
      {/* 扫描阵列桅杆随舰（与舰体同组 ⇒ 一起轻浮） */}
      <Ship fx={fx}>
        <path className="app-act-array" d={`M${SHIP_ANCHOR.x} ${SHIP_ANCHOR.y - 20} V${SHIP_ANCHOR.y - 70} M${SHIP_ANCHOR.x} ${SHIP_ANCHOR.y - 70} L${SHIP_ANCHOR.x - 30} ${SHIP_ANCHOR.y - 86} M${SHIP_ANCHOR.x} ${SHIP_ANCHOR.y - 70} L${SHIP_ANCHOR.x + 30} ${SHIP_ANCHOR.y - 86}`} />
      </Ship>
    </>
  )
})

/**
 * 场景表：**背景与道具 + 真实舰体**（舰形由 `ShipSpriteShape` 画进同一张 SVG，见 `Ship`）。
 * 长途运输按航段分两支：`haul` = 承运（挂柜）/ `haul-pos` = 就位（空舱）。
 */
export type ActSceneId = 'mine' | 'salvage' | 'haul' | 'haul-pos' | 'scan'

export const ACTIVITY_SCENES: Record<ActSceneId, ComponentType<{ fx: ShipFx }>> = {
  mine: MineSpr,
  salvage: SalvageSpr,
  haul: HaulSpr,
  'haul-pos': HaulPosSpr,
  scan: ScanSpr,
}
