/**
 * 无人机机体与弹道形制资产（2026-09-10 船长批第一批：战斗动画差异化）。
 *
 * 口径（docs/design/drone-combat-animation-20260910.md，已确认）：
 * - 颜色按弹型（动能金/高爆橙/能量青）——机型只决定**弹点形制与密度**，不夺颜色语言；
 * - 蜂鸟/赤鸢/猎鹰 = 放飞-回巢（母舰**上侧**编队）；雷鸥哨戒 = **常驻伴飞（母舰下方）**，
 *   多架只显示 1 架；
 * - 每型显示上限 6 架，超出以 ×N 徽标表达；
 * - 视觉纪律：机体与弹点一律 SVG 线稿（禁 CSS 拼形状；动作走 CSS 动画 + 类切换）。
 */
import type { ReactNode } from 'react'
import { FOE_ACCENT } from './shipArt'
import { ROLE_ACCENT, UI_TONES } from './tones'
import { tr } from '../i18n/locale'

export interface DroneSlot {
  x: number
  y: number
}
export interface DroneModel {
  /** 机型短名（图例/徽标用中文优先） */
  name: string
  /** 机体描边色（弹点仍按弹型着色） */
  tint: string
  /** 常驻伴飞（哨戒型：不回收、多架只显示 1 架） */
  resident?: boolean
  /** 编队悬浮位（px，相对母舰锚点；放飞后就位、回巢前离位） */
  slots: DroneSlot[]
  /** 蜂群弹点形制：style = 'dot' 小弹点（蜂鸟/赤鸢/猎鹰）｜'beam' 细曳光条（哨戒，仿主舰攻击但更细）
   *  flyMul = 该机型弹道飞行时长的系数（缺省用 DRONE_FLY_MUL；哨戒更长，2026-09-10 船长十一次定） */
  bolt: { style: 'dot' | 'beam'; len: number; width: number; tail: boolean; flyMul?: number }
  /** 机体形（本地 −12..12 × −7..7 画布，线稿；currentColor 描边） */
  art: ReactNode
}

/** C 族「**孢群机**」机体（2026-09-15 船长：「**需要专门的无人机SVG(属于虫族)**」）——
 *  族外形语言 = **孢子荚 + 甲壳节**（C 族本体口径是"生物流线 + 磷光绿 `#9fe6a4`"）：
 *  短粗荚体、两道甲壳节缝、尾端一枚孢子囊、前缘两根短触须；体量比蜂群机更宽厚（**攻坚机**定位）。
 *  ⚠ 与 G 族"蜂窝六边舱段 + 拼装焊接痕"、E 族"斜装甲楔形 + 断口缺角"同处一套线稿语言（细描边 / currentColor）。
 *  ⚠ 必须声明在 `DRONE_MODELS` **之前**（对象字面量按序求值）。 */
const SPORE_DRONE_ART: ReactNode = (
  <g>
    {/* 孢子荚体（短粗、前后收口 —— 攻坚机的体量感） */}
    <path d="M10 0 C10 -4.4 4.6 -6.4 -2 -5.6 C-7 -5 -10.4 -2.6 -11 0 C-10.4 2.6 -7 5 -2 5.6 C4.6 6.4 10 4.4 10 0 Z" />
    {/* 甲壳节缝两道（"节肢"读法） */}
    <path d="M3 -5.9 v11.5 M-3.4 -5.1 v10" className="app-bts-drone-line" />
    {/* 尾端孢子囊 */}
    <path d="M-10.6 0 C-12.4 -1.8 -12.4 1.8 -10.6 0" className="app-bts-drone-line" />
    {/* 前缘短触须 */}
    <path d="M9 -1.6 L12.6 -3.4 M9 1.6 L12.6 3.4" className="app-bts-drone-line" />
    {/* 孢光点（族色磷光） */}
    <circle cx="6.2" cy="0" r="1.1" className="app-bts-drone-dot" />
  </g>
)

/** 编队位（母舰上侧，按机型分三层避免叠在一起） */
const SLOTS_HIGH = (y: number): DroneSlot[] => [
  { x: -52, y },
  { x: -26, y: y - 7 },
  { x: 0, y: y - 3 },
  { x: 26, y: y - 8 },
  { x: 50, y: y - 1 },
  { x: 14, y: y - 15 },
]

/** G 族「蜂群机」机体（三系共用；说明见 `DRONE_MODELS` 里的 G 族条目）——
 *  **蜂窝六边舱段 + 拼装焊接痕**（族外形口径）。⚠ 必须声明在 `DRONE_MODELS` **之前**（对象字面量按序求值）。 */
const SWARM_BEE_ART: ReactNode = (
  <g>
    {/* 蜂窝六边舱体（族外形「蜂窝舱段」） */}
    <path d="M9.5 0 L4.7 -4.4 L-4.7 -4.4 L-9.5 0 L-4.7 4.4 L4.7 4.4 Z" />
    {/* 拼装补丁（后半截焊上去的歪板）+ 横向焊缝 */}
    <path d="M-4.7 -4.4 L-3.2 -7 L3 -6.4 L4.7 -4.4" className="app-bts-drone-line" />
    <path d="M-1 -4.4 v8.8" className="app-bts-drone-line" />
    {/* 焊点小灯 */}
    <circle cx="5.6" cy="0" r="1" className="app-bts-drone-dot" />
  </g>
)

export const DRONE_MODELS: Record<string, DroneModel> = {
  'drone-scout': {
    name: tr("ui.droneArt.001"),
    tint: UI_TONES.droneSky,
    slots: SLOTS_HIGH(-26),
    bolt: { style: 'dot', len: 7, width: 1.6, tail: false },
    art: (
      <g>
        <path d="M12 0 L-2 -3 L-9 -6 L-4 -2 L-11 0 L-4 2 L-9 6 L-2 3 Z" />
        <circle cx="2" cy="0" r="1.1" className="app-bts-drone-dot" />
      </g>
    ),
  },
  'drone-assault': {
    name: tr("ui.droneArt.002"),
    tint: UI_TONES.dronePeach,
    slots: SLOTS_HIGH(-46),
    bolt: { style: 'dot', len: 10, width: 2.2, tail: false },
    art: (
      <g>
        <path d="M11 0 L1 -2 L-2 -8 L-5 -2 L-11 0 L-5 2 L-2 8 L1 2 Z" />
        <path d="M-2 -2 h6" className="app-bts-drone-line" />
      </g>
    ),
  },
  'drone-heavy': {
    name: tr("ui.droneArt.003"),
    tint: ROLE_ACCENT.armored,
    slots: SLOTS_HIGH(-64),
    bolt: { style: 'dot', len: 14, width: 3, tail: true },
    art: (
      <g>
        <path d="M11 1 H-3 L-8 5 H-12 L-7 1 V-1 L-12 -5 H-8 L-3 -1 H11 Z" />
        <path d="M-1 -3 v6" className="app-bts-drone-line" />
      </g>
    ),
  },
  'drone-sentry': {
    name: tr("ui.droneArt.004"),
    tint: UI_TONES.droneCyan,
    resident: true,
    // 2026-09-10 船长二次定：哨戒常驻伴飞位置改到**母舰上方**
    slots: [{ x: 30, y: -22 }],
    // 哨戒：仿主舰攻击的**细曳光条**（2026-09-10 船长九次定：不发单发小弹点），线宽更细；
    // 飞行时长更长（flyMul 1.6 = 主舰基础 ×1.6，2026-09-10 船长十一次定"哨戒弹道持续时间长一些"）
    bolt: { style: 'beam', len: 9, width: 2, tail: false, flyMul: 1.6 },
    art: (
      <g>
        <circle cx="0" cy="0" r="4.4" />
        <path d="M4.4 0 H12" />
        <circle cx="0" cy="0" r="1" className="app-bts-drone-dot" />
      </g>
    ),
  },
  /* ══════════ **敌方机群机型**（2026-09-11 机群批 S5 · 船长 A2「敌专属机型」） ══════════
   * 与我方四型**共用同一套机体资产与绘制口径**（细描边 / currentColor / viewBox −13..13），
   * 只换**族色**与**形体语言** ⇒ 玩家一眼能分清敌我。 */
  // E 族「警戒机」（巨构自带的警戒机群 = **巨构的第二套火力**）：
  // 族色**残铁棕** `#d9b98c`（与 E 族舰体/族色同源）；形体语言 = 巨构残段的**斜装甲楔形 + 断口缺角**。
  'foe-drone-e-alert': {
    name: tr("ui.droneArt.005"),
    tint: FOE_ACCENT.E,
    slots: SLOTS_HIGH(-26), // 编队位只在我方出击制里用；敌侧位置由表现层贴敌舰锚点决定
    bolt: { style: 'dot', len: 9, width: 2, tail: false }, // 弹点形制与我方战斗机档同款（"老化失准"靠命中率表达，不靠观感）
    art: (
      <g>
        {/* 斜装甲楔形机体（巨构残段语言） */}
        <path d="M11 0 L3 -3 L-6 -6 L-1 -2 L-11 0 L-1 2 L-6 6 L3 3 Z" />
        {/* 断口缺角：机体后段被削掉一块（"残骸还在跑"） */}
        <path d="M-1 -2 l3 2 l-3 2" className="app-bts-drone-line" />
        {/* 警戒灯 */}
        <circle cx="4.6" cy="0" r="1" className="app-bts-drone-dot" />
      </g>
    ),
  },
  /* ── G 族「蜂群机」（鱿烬亡军的招牌 = **蜂群式无人机**；2026-09-12 挂上「天底封锁舰」T3）──
   * 族色**聚落紫** `#cd9fdd`（与 G 族舰体/族色同源）；形体语言 = **蜂窝六边舱段 + 拼装焊接痕**
   * （族外形口径「蜂窝舱段 + 补丁帆 + 拼装焊接痕」＝"拼出来的舰队"）。
   * 三型（kin / exp / pla）**共用同一机体**——口径「**颜色按弹型、机型不夺颜色语言**」⇒
   * 三系差别落在**弹点颜色**（动能金 / 高爆橙 / 能量青）与弹种上，机体一致（与 E 族同款做法）。
   * ⚠ **2026-09-12 教训**：机群机制先落码、**机型资产漏登记** ⇒ 战斗里**看不见蜂群**
   *   （船长实测发现）⇒ 本批同时加下方 `droneModelOrFallback()` 兜底，同类漏登记不再"静默消失"。 */
  'foe-drone-g-bee-kin': {
    name: tr("ui.droneArt.006"),
    tint: FOE_ACCENT.G,
    slots: SLOTS_HIGH(-26), // 编队位只在我方出击制里用；敌侧位置由表现层贴敌舰锚点决定
    bolt: { style: 'dot', len: 8, width: 1.8, tail: false }, // 小弹点、密度高（"一群致命"）
    art: SWARM_BEE_ART,
  },
  'foe-drone-g-bee-exp': {
    name: tr("ui.droneArt.006"),
    tint: FOE_ACCENT.G,
    slots: SLOTS_HIGH(-26),
    bolt: { style: 'dot', len: 8, width: 1.8, tail: false },
    art: SWARM_BEE_ART,
  },
  'foe-drone-g-bee-pla': {
    name: tr("ui.droneArt.006"),
    tint: FOE_ACCENT.G,
    slots: SLOTS_HIGH(-26),
    bolt: { style: 'dot', len: 8, width: 1.8, tail: false },
    art: SWARM_BEE_ART,
  },
  /* ── C 族「孢群机」（异形巢群的活体攻坚机；2026-09-15 挂上「孢群异虫」T3 无人机舰）──
   * 族色**磷光绿** `#9fe6a4`（与 C 族舰体/族色同源）；弹点比蜂群机更重更疏（攻坚机节奏 4,400ms）。 */
  'foe-drone-c-spore': {
    name: tr("ui.droneArt.007"),
    tint: FOE_ACCENT.C,
    slots: SLOTS_HIGH(-26),
    bolt: { style: 'dot', len: 9, width: 2, tail: false },
    art: SPORE_DRONE_ART,
  },
}

/** **未登记机型的兜底机体**（2026-09-12 加）。
 *
 * 由来：G 族蜂群机落码时**机型资产漏登记** ⇒ 敌侧 `droneModelOf()` 返回 `undefined` ⇒
 * 机体不画、玩家在战斗里**只看到弹道看不到飞机**（船长实测发现）。兜底把"漏登记"从
 * **静默消失**改成**看得见但一眼可辨**（中性灰机体 + 名字回退成机型 id），便于当场发现。 */
export const DRONE_MODEL_FALLBACK: DroneModel = {
  name: tr("ui.droneArt.008"),
  tint: UI_TONES.droneGray,
  slots: SLOTS_HIGH(-26),
  bolt: { style: 'dot', len: 8, width: 1.8, tail: false },
  art: (
    <g>
      <rect x="-8" y="-4" width="16" height="8" rx="2" />
      <path d="M8 0 h4" className="app-bts-drone-line" />
    </g>
  ),
}

/** 取机型（**未收录 ⇒ 兜底机体**；名字回退成机型 id，便于一眼认出是漏登记） */
export function droneModelOrFallback(artId: string | null | undefined): DroneModel {
  const found = droneModelOf(artId)
  if (found) return found
  return { ...DRONE_MODEL_FALLBACK, name: artId ?? DRONE_MODEL_FALLBACK.name }
}

/** 取机型（未收录返回 undefined → 表现层回退"普通弹道"口径） */
export function droneModelOf(artId: string | null | undefined): DroneModel | undefined {
  return artId ? DRONE_MODELS[artId] : undefined
}

/** 机型显示上限（超出以 ×N 徽标表达；2026-09-10 船长定 6 架） */
export const DRONE_SHOW_MAX = 6
/** 放飞后无开火的回巢阈值（ms；2026-09-10 船长定 1.2s） */
export const DRONE_BACK_MS = 1200
/** 回巢动画时长（ms；与 styles.css 的 keyframes 时长一致） */
export const DRONE_BACK_ANIM_MS = 420

/**
 * 演出制式（2026-09-10 船长二次定："放出无人机靠近敌人攻击后返回"）：
 * - `sortie`（默认，出击制）= 无人机自母舰放出 → 飞到敌舰侧的攻击阵位开火 → 无开火 1.2s 返回母舰；
 * - `formation`（保留，机群制）= 无人机在母舰上侧编队巡飞，弹道自编队位起飞。
 * 两套实现都保留，切换本常量即可（CSS 两套 keyframes 均保留）。
 */
export const DRONE_STYLE: 'sortie' | 'formation' = 'sortie'
/** 出击制：飞到攻击阵位的时长（ms）
 *  2026-09-10 船长十次定：**撤回节奏收紧**（420→560），出击/返航恢复原时长；
 *  同批的弹道提速（DRONE_FLY_MUL）与哨戒细曳光保留。 */
export const DRONE_SORTIE_OUT_MS = 560
/** 出击制：返航时长（ms；同上撤回收紧：460→620） */
export const DRONE_SORTIE_BACK_MS = 620
/** 出击制：到位后的驻留时长（ms）——保证"到位才开火"有个稳定的开火窗口，也让机体/弹道位置一致 */
export const DRONE_DWELL_MS = 220
/** 无人机弹道提速系数（2026-09-10 船长九次定"弹道速度加快"；乘在弹型基础飞行时长上） */
export const DRONE_FLY_MUL = 0.55

/**
 * 出击制单轮时序（2026-09-10 船长七次定："每次飞出时 Y 轴随机分布、到达位置后开火、开火结束立刻返回"）：
 *
 * 一轮 = 放出（`DRONE_SORTIE_OUT_MS`）→ **到位瞬间开火**（弹道即在此刻出现）→ 立刻掉头返航（`DRONE_SORTIE_BACK_MS`）。
 * 无人机可见时长 = 去程 + 返程，开火是这一轮的"顶点"；两轮之间在机库待命（引擎装填决定节奏）。
 * 无人机位置与弹道位置共用同一轮的随机阵位 → 不会错位；战斗开始时首轮同样从机库口飞出，不会直接出现在敌侧。
 */
export interface DroneSortie {
  /** 本轮放出时刻（ms） */
  startAt: number
  /** 本轮每架的阵位随机偏移（相对敌舰锚点；Y 轴随机分布，避免叠在一起） */
  offs: { x: number; y: number }[]
}

/**
 * 生成一轮的随机阵位偏移（Y 轴随机分布；X 亦轻微抖动，避免同高度成排）——距敌舰中心、朝我方一侧的绝对距离。
 * `outward`（2026-09-11 舰种体积配套）= 目标舰**放大后**的外推量：阵位基线 42~68px 是按改造前的
 * 敌舰（舰种 T3 = 170px 宽、半宽 85）定的，敌舰更大时由调用侧传入 `(舰宽 − 170) / 2`，
 * 否则机群会压在放大的舰体上（无人机与舰体重叠）。
 */
export function droneRandomOffsets(count: number, outward = 0): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  for (let i = 0; i < count; i++) {
    out.push({
      x: 42 + Math.round(Math.random() * 26) + outward, // 距敌舰（我方一侧）42~68px（+ 舰体外推量）
      y: Math.round((Math.random() - 0.5) * 96), // Y 轴 ±48px 随机
    })
  }
  return out
}

/** 本轮第 lane 架的绝对攻击阵位（敌舰我方一侧 + 本轮随机偏移） */
export function droneStationFrom(
  foe: { x: number; y: number },
  dir: number,
  off: { x: number; y: number },
): { x: number; y: number } {
  return { x: foe.x - dir * off.x, y: foe.y + off.y }
}

/** 单轮航路位置（t=0 在起/终点，t=1 在另一端；back=false 为出击段，true 为返航段） */
export function dronePathPos(
  t: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
  arcH: number,
  back: boolean,
): { x: number; y: number } {
  const e = back ? (t * t * t) : (1 - Math.pow(1 - t, 3))
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 + (back ? arcH : -arcH) }
  // 二次贝塞尔：控制点 C 使 e=0.5 恰好经过 mid（去程上凸、返程下凸）
  const cx = 2 * mid.x - (from.x + to.x) / 2
  const cy = 2 * mid.y - (from.y + to.y) / 2
  const u = 1 - e
  return { x: u * u * from.x + 2 * u * e * cx + e * e * to.x, y: u * u * from.y + 2 * u * e * cy + e * e * to.y }
}

/**
 * 出击制攻击阵位（绝对画面 px；2026-09-10 船长三次定："只去固定地点会大量重叠"）：
 * 以目标舰为圆心做**新月形分层**——中间道最贴近敌舰、外侧道后退并上下拉开，
 * 6 架在 y 上相隔 20px、x 上再分三档，保证彼此不压在一起。
 */
export function droneSortieStation(
  lane: number,
  foe: { x: number; y: number },
  dir: number,
  foeNose: number,
): { x: number; y: number } {
  const k = lane - (DRONE_SHOW_MAX - 1) / 2 // −2.5 .. 2.5
  return {
    x: foe.x - dir * (foeNose + 42 + Math.abs(k) * 11 + (lane % 2) * 15),
    y: foe.y + k * 20,
  }
}

/** 出击航路弧高（px；每道不同 → 曲线互相错开，不再叠成一团） */
export function droneArcHeight(lane: number): number {
  return 34 + lane * 11
}

/**
 * 出击制起飞点（相对母舰锚点 px）：机库口 = 舰体中部上方一点、按架次轻微错开。
 * 注意 2026-09-10 修正：起飞点是**位移基准**，攻击阵位的位移必须按"阵位 − 起飞点"计算，
 * 否则终点会叠加起飞点偏移（曾表现为"无人机始终偏在母舰上方"）。
 */
export function droneTakeoff(lane: number): { x: number; y: number } {
  return { x: (lane % 3) * 6 - 6, y: -10 + (lane % 2) * 5 }
}

/** 缓动（去程 ease-out / 返程 ease-in；与逐帧插值配套） */
export function droneEaseOut(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}
export function droneEaseIn(t: number): number {
  return t * t * t
}

/**
 * 出击制航路位置（绝对画面 px）——给定时刻沿**上凸弧线**去、沿**下凸弧线**回
 * （与上方同名函数重复的历史实现已合并，仅保留前一份定义）。
 */
