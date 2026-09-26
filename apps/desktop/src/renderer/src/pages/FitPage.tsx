/**
 * 装配页（V18 槽位制）：给"当前驾驶的船"装配装备。
 * 高/中/低三类物理槽 × 位序（ShipDef.slots 数量，复数安装）；模块按 rack 归槽
 * （高 = 炮台/采集器/无人机装置；中 = 盾系/推进；低 = 甲系/货舱扩展）。
 * 装备随船：换船后看到的是那艘船自己的装配；弃船时装备随船损失。
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type {
  DamageResists,
  DamageType,
  FittedModules,
  GameState,
  ModuleDef,
  ModuleSlot,
  RackSlot,
  UnitSpec,
} from '@whale/core'
import {
  allFittedIds,
  /** 本场预载需求（与开战装载同一函数）＋ 取档判定（船长 2026-09-16「甲」口径的单点） */
  ammoLoadTotals,
  resolveAmmoTier,
  /** 战后自动补足机群（2026-09-20）⇒ 机群门槛只在"货源不够"时拦人；这里把缺额写出来 */
  autoLoopDroneShortfall,
  countModule,
  countWare,
  cpuBudgetOf,
  cpuUseOf,
  createPlayerSpec,
  /** 2026-09-26 船长令：装配页插件槽只读区（core 单点给槽位上限 + 已装清单） */
  plugInfoOf,
  droneCpuUsed,
  droneLoadM3,
  effectiveCpu, // 保留：船体预算（不含协处理器扩容）在别处仍可能用到；预算总额见 cpuBudgetOf
  fittedCpuUsed,
  fleetDefOf,
  rackOf,
  sameKindCount,

  fitPresetBrief,
  fitPresetDetailOf,
  fitPresetsOf,
  FIT_PRESET_MAX,
  FIT_PRESET_NAME_MAX,
  shipDisplayName,
  shipSlotsOf,
  stackingOf,
  stackWeight,
  thrusterCycleFullText,
  typeLayerMult,
  // 2026-09-26 无人机舱总容量（船体 + 甲板扩展）唯一单点——主表与舰队页悬停卡同一把尺
  droneBayTotalM3,
  // 2026-09-14 跃迁计算机：装配页显示**有效跃迁速度**（含装备加成）与航行时间因子（与引擎同源）
  travelTimeFactor,
  warpBonusMult,
  warpSpeedAus,
} from '@whale/core'
import { Panel } from '@whale/ui'
// 装备稀有度档位（换装浮层默认"稀有度高的排前面"；2026-09-11 船长定）
import { rarityTierOf } from '@whale/data'
import { combatBadges, COMBAT_BASE_KEYS, DmgChip, DMG_LABEL, FIT_MAIN_HIDDEN_KEYS, fittedDroneBayLine, fittedSpeedLine, InfoTable, itemHoverContent, moduleHoverContent, moduleShortEffect, shipIndirectLines, shipInfoLines } from '../ui/shipInfo'
import { hoverTipProps } from '../ui/Tooltip'
import { Glyph, toneOf } from '../ui/Glyphs'
import { HintIcon } from '../ui/Hint'
import { ShipSprite } from '../ui/ShipSprite'
// ⚠ 槽类名（高/中/低槽）走本地化单点 `rackText`（2026-09-26 船长报障：英文界面下槽位名漏中文）——
// core 的 `RACK_LABELS` / `rackLabel` 是纯中文表，**渲染层不得直读**（见 `ui/labelsText.ts` 头注）
import { rackText, slotText } from '../ui/labelsText'
import type { PageProps } from './common'
import { tr, cmdText } from '../i18n/locale'


/** 槽类可装家族简述（空位引导文案；V18.1 支援件：伤害/射速 = 低槽，命中/闪避 = 中槽；
 *  2026-09-11 协处理器 = 低槽 CPU 预算扩容件）
 *  2026-09-14 船长「改回高槽」：采集器 / 打捞器回到高槽组（作业装备不再走低槽） */
const RACK_FAMILIES: Record<RackSlot, string> = {
  high: tr("ui.FitPage.011"),
  mid: tr("ui.FitPage.012"),
  low: tr("ui.FitPage.013"),
}

/** 数字千分位 */
const fmt = (n: number): string => n.toLocaleString('zh-CN')

/** 抗性三系恒显 chips（船长 2026-09-05：0 抗也列出——不做"缺行=0"的隐性省略） */
function resChipsAll(res: DamageResists | undefined): ReactNode {
  return (['kinetic', 'explosive', 'plasma'] as const).map((t) => {
    const pct = Math.round((res?.[t] ?? 0) * 100)
    return pct > 0 ? (
      <DmgChip key={t} t={t} label={`${DMG_LABEL[t]} ${pct}%`} />
    ) : (
      <span key={t} className="app-res-zero">
        {DMG_LABEL[t]} 0%
      </span>
    )
  })
}

/** 换装对比段（装配浮层卡片底部；船长 2026-09-05：显示装后 DPS/属性是否有变化） */
interface FitSeg {
  /** 展示文本（如 "火力 +14%" / "盾 960→1032" / "CPU 剩 42→35"） */
  t: string
  /** 着色：up=绿（升）· down=红（降）· info=中性青（值变化）· none=灰（占位说明） */
  c: 'up' | 'down' | 'info' | 'none'
}

const HP_KEY_LABEL: Record<'s' | 'a' | 'h', string> = { s: tr("ui.FitPage.014"), a: tr("ui.FitPage.015"), h: tr("ui.ShipPage.023") }
const TYPE_SN: Record<string, string> = { kinetic: tr("ui.FitPage.016"), explosive: tr("ui.FitPage.017"), plasma: tr("ui.FitPage.018") }

/** 负数按本仓文案惯例用真减号 U+2212 显示（CPU 剩 −12 而非 -12） */
function minus(n: number): string {
  return n < 0 ? `−${-n}` : `${n}`
}

/** 名义火力（全命中、无距离衰减、弹药不断供）：Σ 各武器 单发/装填秒。
 * 仅供"同条件下换装相对比较"——战斗实际 DPS 还乘命中/距离衰减（基础舰炮恒在，剔除避免稀释）。 */
function rawDpsOf(spec: UnitSpec): number {
  let sum = 0
  for (const w of spec.weapons) {
    if (w.label === '基础舰炮') continue // l10n-keep：武器形态联合 key（不是文案）
    const per = w.kind === 'gun' ? Object.values(w.shotsByType ?? {})[0] ?? 0 : (w.shotDmg ?? 0)
    sum += per / Math.max(0.1, w.reloadMs / 1000)
  }
  return sum
}

/** 整机命中近似（口径：炮台命中率均值 × 开火失稳，再乘索敌乘子；beam 必中计 1）——
 * 供"命中 ≈ ±%"相对变化段（覆盖索敌阵列/失稳惩罚/换炮基础命中差） */
function meanHitMul(spec: UnitSpec): number | null {
  const ws = spec.weapons.filter((w) => w.kind === 'gun' || w.kind === 'beam')
  if (ws.length === 0) return null
  let s = 0
  for (const w of ws) s += w.kind === 'beam' ? 1 : (w.hitRate ?? 0.5) * (w.eqHitMul ?? 1)
  return (spec.hitMul ?? 1) * (s / ws.length)
}

/** **整机命中率（含余量）**（船长 2026-09-19 报障「装配界面的舰船属性里，少了命中率属性」，
 *  口径两步定：先选 A（纸面加算口径），再令「**解除上限锁** —— 超出上限的部分能够抵消射程的命中削减」）：
 *  掷命中武器（炮台 / 导弹架）取 `(基础命中 + 船体命中加成) × 索敌件 × 推进失稳`，激光必中计 100%，
 *  **一律不截断** ⇒ 读数可以 >100%，那部分余量正是实战里被射程衰减与敌舰回避消费掉的量。
 *
 *  ⚠ 三个引擎对齐点（都是逐字核过 `combat.hitChance` / 开火分支的）：
 *  ① 船体加成是**加算**在武器基础命中上（`types.ts` 的 `hitBonus` 注释：加到武器命中率上）；
 *  ② 索敌件（`eqHitMul`）与推进失稳（`hitMul`）**只作用于掷命中武器**——激光 `hit = 1` 必中、不吃失稳；
 *  ③ 引擎的 `clamp(0,1,…)` 是**最后一步**（在距离衰减之后）⇒ 本行刻意不截断，把余量留给玩家读。
 *  ⚠ 基础舰炮与无人机是 `kind:'fixed'`（必中）⇒ 不进均值（与 `rawDpsOf` 同一取舍）。 */
function meanHitRateOf(spec: UnitSpec): { rate: number; hitBonus: number; eqMul: number | null; unstable: number } | null {
  const ws = spec.weapons.filter((w) => w.kind === 'gun' || w.kind === 'beam')
  if (ws.length === 0) return null
  const hitBonus = spec.hitBonus ?? 0
  const unstable = spec.hitMul ?? 1
  let sum = 0
  let eqMul: number | null = null
  for (const w of ws) {
    if (w.kind === 'beam') {
      sum += 1
      continue
    }
    if (w.eqHitMul !== undefined) eqMul = w.eqHitMul
    sum += ((w.hitRate ?? 0.5) + hitBonus) * (w.eqHitMul ?? 1) * unstable
  }
  return { rate: sum / ws.length, hitBonus, eqMul, unstable }
}

/** 命中率行的括号明细（只列非缺省项——缺省的 ×1.00 / +0% 不进括号，免得读成"有代价"） */
function hitDetailText(read: { hitBonus: number; eqMul: number | null; unstable: number }): string {
  const parts: string[] = []
  if (read.hitBonus > 0) parts.push(tr("ui.FitPage.111", { p1: Math.round(read.hitBonus * 100) }))
  if (read.eqMul !== null && Math.abs(read.eqMul - 1) > 1e-6) parts.push(tr("ui.FitPage.112", { p1: read.eqMul.toFixed(2) }))
  if (Math.abs(read.unstable - 1) > 1e-6) parts.push(tr("ui.FitPage.113", { p1: read.unstable.toFixed(2) }))
  return parts.join(' · ')
}

/** 装后 − 装前 差异段；数值全部来自 createPlayerSpec 同源合成（与战斗引擎一致），只报真实变化。
 *  `weapon` = 该槽位新旧武器的**弹伤倍率**（可选）：换了炮台/导弹架/激光炮时，
 *  除"火力 ±%"外再明示倍率本身的变化（2026-09-11 船长：只看火力看不到弹药伤害倍率）。 */
function diffSegs(
  cur: UnitSpec,
  next: UnitSpec,
  cpuCur: number,
  cpuNext: number,
  cpuTotal: number,
  weapon?: { curMult: number | null; nextMult: number | null; curType: DamageType | null; nextType: DamageType | null },
  cpuTotalNext?: number,
): FitSeg[] {
  const segs: FitSeg[] = []
  const add = (t: string, c: FitSeg['c']): void => {
    segs.push({ t, c })
  }
  const dir = (d: number): 'up' | 'down' => (d > 0 ? 'up' : 'down')
  // CPU 减法视角（船长 2026-09-05：显示剩余 CPU 的变化）。
  // 2026-09-11 协处理器：**预算随件走** —— 装/卸协处理器时前后预算不同，两栏各用自己的预算。
  // 2026-09-12 船长（玩家反馈「超了只显示到 0，看不到差多少、也不变红」）：「按甲来」——
  // 装后**超载**（剩余 < 0）给**负数 + 「差 N」并标红**；**刚好装满**（= 0，合法、装得进）单列中性文案；
  // 其余仍只报变化。⚠ 判据是"装后是否超预算"，不是"变化没变化"——已超载的船换同耗件也要照红。
  const remCur = cpuTotal - cpuCur
  const remNext = (cpuTotalNext ?? cpuTotal) - cpuNext
  if (remNext < 0) add(tr("ui.FitPage.114", { p1: minus(remCur), p2: minus(remNext), p3: -remNext }), 'down')
  else if (remNext !== remCur) {
    add(remNext === 0 ? tr("ui.FitPage.115", { p1: minus(remCur) }) : tr("ui.FitPage.116", { p1: minus(remCur), remNext: remNext }), 'info')
  }
  // 血量层（取变化最大的两层，避免长卡）
  const hpPairs: Array<{ lab: string; c: number; n: number }> = []
  for (const k of ['s', 'a', 'h'] as const) {
    const c = cur.hp[k]
    const n = next.hp[k]
    if (n !== c) hpPairs.push({ lab: HP_KEY_LABEL[k], c: Math.round(c), n: Math.round(n) })
  }
  hpPairs.sort((x, y) => Math.abs(y.n - y.c) - Math.abs(x.n - x.c))
  for (const p of hpPairs.slice(0, 2)) add(`${p.lab} ${fmt(p.c)}→${fmt(p.n)}`, dir(p.n - p.c))
  // 抗性（盾/甲两层 × 三系；取百分点变化最大的两条）
  const resDiffs: Array<{ t: string; c: number; n: number }> = []
  for (const layer of ['shield', 'armor'] as const) {
    const cb = cur.resists[layer] ?? {}
    const nb = next.resists[layer] ?? {}
    for (const ty of ['kinetic', 'explosive', 'plasma'] as const) {
      const cpp = Math.round((cb[ty] ?? 0) * 100)
      const npp = Math.round((nb[ty] ?? 0) * 100)
      if (npp !== cpp) resDiffs.push({ t: tr("ui.FitPage.117", { p1: layer === 'shield' ? tr("ui.FitPage.014") : tr("ui.FitPage.015"), p2: TYPE_SN[ty] }), c: cpp, n: npp })
    }
  }
  resDiffs.sort((a, b) => Math.abs(b.n - b.c) - Math.abs(a.n - a.c))
  for (const d of resDiffs.slice(0, 2)) add(`${d.t} ${d.c}→${d.n}%`, dir(d.n - d.c))
  // 回避 / 机动速度
  const epp = Math.round((next.evasion - cur.evasion) * 100)
  if (epp !== 0) add(tr("ui.FitPage.118", { p1: Math.round(cur.evasion * 100), p2: Math.round(next.evasion * 100) }), dir(epp))
  const spd = Math.round(next.speedMps - cur.speedMps)
  if (spd !== 0) add(tr("ui.FitPage.119", { p1: Math.round(cur.speedMps), p2: Math.round(next.speedMps) }), dir(spd))
  // 推进器点火期速度（2026-09-11 船长：「推进器现在有持续时间和冷却时间，这点希望在推进器的说明内讲清」）：
  // 周期化（2026-09-10）后 `speedMps` **不含**推进器加成（走 `thrusterBoost`、只在点火窗口生效）
  // ⇒ 换上/换下推进器时上面那段「速度」恒为 0，卡片看起来"速度没变"。这里补报**点火期**速度
  // （= 基础 ×(1+爆发倍率)），换推进器时玩家才看得到真实机动差。
  const boostCur = cur.thrusterBoost ?? 0
  const boostNext = next.thrusterBoost ?? 0
  if (boostCur !== boostNext) {
    const ignCur = Math.round(cur.speedMps * (1 + boostCur))
    const ignNext = Math.round(next.speedMps * (1 + boostNext))
    add(tr("ui.FitPage.120", { ignCur: ignCur, ignNext: ignNext }), dir(ignNext - ignCur))
  }
  // 火力（名义口径见 rawDpsOf 注释；数值直接给，不带 ≈ 前缀）
  const cd = rawDpsOf(cur)
  const nd = rawDpsOf(next)
  if (cd <= 0 && nd > 0) add(tr("ui.FitPage.121"), 'up')
  else if (nd <= 0 && cd > 0) add(tr("ui.FitPage.122"), 'down')
  else if (cd > 0 && nd > 0) {
    const pct = (nd / cd - 1) * 100
    if (Math.abs(pct) >= 0.5) {
      // 绝对值格式化（船长 2026-09-05：避免负值自带符号与前缀符号叠成双负号）
      const absPct = Math.abs(pct)
      const show = absPct >= 10 ? String(Math.round(absPct)) : absPct.toFixed(1)
      add(tr("ui.FitPage.123", { p1: pct > 0 ? '+' : '−', show: show }), pct > 0 ? 'up' : 'down')
    }
  }
  // 弹伤倍率本身的变化（换炮台时最关心的一个数；弹种变了也点明）
  if (weapon && weapon.curMult !== null && weapon.nextMult !== null && weapon.curMult !== weapon.nextMult) {
    add(tr("ui.FitPage.124", { p1: mulText(weapon.curMult), p2: mulText(weapon.nextMult) }), dir(weapon.nextMult - weapon.curMult))
  }
  if (weapon && weapon.curType !== null && weapon.nextType !== null && weapon.curType !== weapon.nextType) {
    add(tr("ui.FitPage.125", { p1: DMG_LABEL[weapon.curType], p2: DMG_LABEL[weapon.nextType] }), 'info')
  }
  // 命中近似（整机相对变化；口径见 meanHitMul）
  const ch = meanHitMul(cur)
  const nh = meanHitMul(next)
  if (ch !== null && nh !== null && ch > 0) {
    const hp = (nh / ch - 1) * 100
    if (Math.abs(hp) >= 2) {
      // 同上：绝对值格式化，符号只由前缀给一次
      const absHp = Math.abs(hp)
      const show = absHp >= 10 ? String(Math.round(absHp)) : absHp.toFixed(1)
      add(tr("ui.FitPage.126", { p1: hp > 0 ? '+' : '−', show: show }), hp > 0 ? 'up' : 'down')
    }
  }
  return segs
}

/** 武器判定：炮台/导弹架/激光炮（弹种 chip 显示攻击类型，色 = 伤害类型 ↔ 血量层色） */
const WEAPON_SLOTS = new Set<ModuleSlot>(['turret', 'missile', 'laser'])

/** 武器的**弹种**（与 ammoChipOf 同一口径：炮台取自身伤害类型、导弹固定高爆、激光固定能量） */
function weaponDamageTypeOf(m: ModuleDef): DamageType {
  if (m.slot === 'turret') return m.damageType ?? 'kinetic'
  if (m.slot === 'missile') return 'explosive'
  return 'plasma'
}

/** 层位克制短串（如「盾×1.5·甲×0.5」；×1 的层省略）——数值与 `combat.typeLayerMult` 同源，挂在弹种 chip 上 */
function layerShortOf(t: DamageType): string {
  const name = { shield: tr("ui.FitPage.014"), armor: tr("ui.FitPage.015"), hull: tr("ui.ShipPage.023") } as const
  const parts: string[] = []
  for (const l of ['shield', 'armor', 'hull'] as const) {
    const v = typeLayerMult(t, l)
    if (v !== 1) parts.push(`${name[l]}×${v}`)
  }
  return parts.join('·')
}

/** 倍率显示（1.5 → ×1.5；3 → ×3；去尾零） */
function mulText(v: number): string {
  return `×${Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100)}`
}

/** 武器弹药 chip（船长 2026-09-05：换装卡须明示弹药攻击类型） */
function ammoChipOf(m: ModuleDef): ReactNode | null {
  if (m.slot === 'turret') {
    const t = m.damageType ?? 'kinetic'
    return <DmgChip t={t} label={tr("ui.FitPage.127", { p1: DMG_LABEL[t] })} />
  }
  if (m.slot === 'missile') return <DmgChip t="explosive" label={tr("ui.FitPage.008")} />
  if (m.slot === 'laser') return <DmgChip t="plasma" label={tr("ui.FitPage.009")} />
  return null
}

/** 射程短文本（换装卡武器行用；min=0 省略近端） */
function rangeShort(m: ModuleDef): string {
  const max = m.maxRangeM
  if (max === undefined) return '—'
  const hi = max >= 1000 ? `${(max / 1000).toFixed(max % 1000 === 0 ? 0 : 1)} km` : `${max} m`
  const lo = m.minRangeM && m.minRangeM > 0 ? m.minRangeM : 0
  if (lo === 0) return hi
  const loS = lo >= 1000 ? `${(lo / 1000).toFixed(lo % 1000 === 0 ? 0 : 1)} km` : `${lo} m`
  return `${loS} ~ ${hi}`
}

/** CPU 剩余条（槽位区顶部；装配+放飞共用静态池，超上限拒绝装配；减法显示剩余——船长 2026-09-05）
 *  2026-09-12 船长（玩家反馈「超了只显示到 0，看不到差多少、也不变红」）：「按甲来」——
 *  剩余**允许为负**：负数 = 超载 ⇒ 数字给负数 + 右侧「超 N」+ 危险红（`is-full`）；
 *  **刚好装满**（= 0，合法、装得进）从红里分出来 ⇒ 琥珀 + 「刚好装满」；有余量照旧按百分比分级。 */
function CpuStrip({ used, total }: { used: number; total: number }): ReactNode {
  const rem = total - used
  const over = rem < 0
  const remPct = total > 0 ? Math.max(0, Math.min(100, (rem / total) * 100)) : 0
  // 醒目分级：剩余充足青绿 → ≤15% 琥珀告警（含"刚好装满"）→ 超载危险红
  const cls = over ? 'is-full' : remPct <= 15 ? 'is-warn' : 'is-ok'
  return (
    <div
      className={`app-fit-cpustrip ${cls}`}
      title={tr("ui.FitPage.019")}
    >
      <span className="app-fit-cpustrip-label">{tr("ui.FitPage.020")}</span>
      <span className="app-fit-cpustrip-num">
        {minus(rem)} / {total}
      </span>
      <span className="app-fit-cpustrip-pct">
        {over ? tr("ui.FitPage.128", { p1: -rem }) : rem === 0 ? tr("ui.FitPage.021") : `${Math.round(remPct)}%`}
      </span>
      <span className={`app-fit-cpustrip-track ${cls}`} role="progressbar" aria-valuenow={Math.round(remPct)} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: `${remPct}%` }} />
      </span>
    </div>
  )
}

export function FitPage({ engine, onToast, fitShipId = null }: PageProps & { fitShipId?: string | null }) {
  const state = engine.state
  // 装配目标船（船长 2026-09-05：入口在舰船页舰队卡片——onGotoFit 带入目标船；直接进入默认当前驾驶船）
  const piloted = state.shipId
  const [targetId] = useState<string>(fitShipId && state.fleet[fitShipId] ? fitShipId : piloted)
  const effectiveTarget = state.fleet[targetId] ? targetId : piloted
  const isPiloted = effectiveTarget === piloted
  const shipDef = fleetDefOf(state, engine.ctx, effectiveTarget)
  const shipName = shipDisplayName(state, engine.ctx, effectiveTarget)
  const fitted = state.fleet[effectiveTarget]?.fitted
  const slots = shipDef ? shipSlotsOf(shipDef) : { high: 1, mid: 1, low: 1 }
  // 装后合成（与战斗引擎同源：血量含容量件、抗性含乘入缺口、速度含加力曲线、回避含陀螺缺口）
  const spec = shipDef ? createPlayerSpec(state, engine.ctx, effectiveTarget) : null
  // 命中率（2026-09-19 船长：「装配界面的舰船属性里，少了命中率属性」）：整机读数 + 括号明细
  // （船体加成 / 索敌件 / 推进失稳）——口径见 meanHitRateOf
  const hitRead = spec ? meanHitRateOf(spec) : null
  const hitDetail = hitRead ? hitDetailText(hitRead) : ''
  // 2026-09-14 跃迁计算机：本船**有效跃迁速度**（船表值 × 装备加成，与引擎 `travel.warpSpeedAus` 同源）
  // 与**航行时间因子**（`travelTimeFactor`：含跃迁速度与航行技能族）——只影响跨星系航行，不进战斗。
  const effWarp = shipDef
    ? {
        aus: warpSpeedAus(state, engine.ctx, effectiveTarget),
        bonusPct: warpBonusMult(state, engine.ctx, effectiveTarget) - 1,
      }
    : undefined
  const warpFactor = travelTimeFactor(state, engine.ctx, effectiveTarget)

  // 装备库按**持有数**筛 ⇒ 走全目录（玩家的东西必须显示得出来，未上线闸门只管"给玩家看的枚举"）
  const bayModules: ModuleDef[] = engine.allModules.filter((m) => countModule(state, m.id) > 0)
  // CPU 占用（全位合计 + 无人机舱清单预占——2026-09-08 无人机舱大改：装入即占预算）
  const droneLoadOf = state.fleet[effectiveTarget]?.droneLoad
  const cpuUsed = fitted ? fittedCpuUsed(fitted, engine.ctx, shipDef) + droneCpuUsed(droneLoadOf, engine.ctx) : 0
  // 装配台左右分栏（船长 2026-09-05）：左=船参数，右=装备按槽位图标；装备库列表移到物品页，不再在此显示。

  // ── 舰船形象区自适应（船长 2026-09-09：窗口缩窄优先缩小舰影，图缩到下限仍不够才隐藏间接列；
  //    实测容器宽度分档，避免间接文字被图形顶出窗口） ──
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [stageFit, setStageFit] = useState({ art: 280, indirect: true })
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const update = (): void => {
      // stage 有 padding+border：内容可用宽 = clientWidth − 左右装饰
      const avail = el.clientWidth - 22
      const INDIRECT_MIN = 250 // 间接列表可读最小宽（11px 行 + 折行余量）
      const GAP = 12
      const MIN_ART = 190 // 舰影可读下限（再小就藏间接、图占主位）
      const MAX_ART = 300
      const keepIndirect = avail >= MIN_ART + GAP + INDIRECT_MIN
      let art = keepIndirect ? Math.min(MAX_ART, Math.max(MIN_ART, avail - GAP - INDIRECT_MIN)) : Math.min(MAX_ART, Math.round(avail * 0.92))
      if (art < 130) art = 130
      setStageFit((old) => (old.art === art && old.indirect === keepIndirect ? old : { art, indirect: keepIndirect }))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /** 卸下（2026-09-11：`unfitAtAt` 改回报 CommandResult——CPU 双向校验下"卸不掉"会带原因） */
  function handleUnfit(rack: RackSlot, index: number): void {
    const r = engine.unfitAtAt(rack, index, effectiveTarget)
    if (r.ok) onToast(tr("ui.FitPage.129"))
    else onToast(cmdText(r) || tr('ui.FitPage.165'), true)
  }

  // ── 装配方案（预设）：保存当前装配 / 套用预设（2026-09-14 船长；入口在「装配目标」栏右侧） ──
  //    方案按**船型**归口（同型号任意一艘通用），每型最多 FIT_PRESET_MAX 套；
  //    套用 = 先卸光再装 + 尽力装（缺件/超载逐条报出，见 core `fitPresets.ts`）。
  const [presetOpen, setPresetOpen] = useState(false)
  const [presetRename, setPresetRename] = useState<{ index: number; name: string } | null>(null)
  /**
   * **「替换」的两步确认**（船长 2026-09-19：「给方案加个替换按钮，点击后将当前装配覆盖进目标方案，
   * 覆盖之前需要玩家确认」）——点「替换」进入本状态，行内变成「用当前装配覆盖？覆盖 / 取消」。
   */
  const [presetReplaceAt, setPresetReplaceAt] = useState<number | null>(null)
  /** **方案明细行内展开**（船长 2026-09-17：「允许玩家查看装备方案内用了哪些装备」⇒ 行内展开 · 逐位列含空位） */
  const [presetDetailAt, setPresetDetailAt] = useState<number | null>(null)
  const presetDefId = shipDef?.id ?? ''
  const presets = presetDefId.length > 0 ? fitPresetsOf(state, presetDefId) : []

  /** 保存当前装配（满套时把方案列表一并打开，好让玩家先删一套） */
  function handleSavePreset(): void {
    const r = engine.saveFitPresetFor(effectiveTarget)
    if (!r.ok) {
      onToast(cmdText(r) || tr('ui.FitPage.166'), true)
      setPresetOpen(true)
      return
    }
    onToast(tr("ui.FitPage.130"))
    setPresetOpen(true)
  }

  /** 套用方案（成功后自动关掉浮层；结果小结逐条列出缺件/超载） */
  function handleApplyPreset(index: number): void {
    const r = engine.applyFitPresetAt(effectiveTarget, index)
    if (!r.ok) {
      onToast(cmdText(r) || tr('ui.FitPage.167'), true)
      return
    }
    setPresetOpen(false)
    setPresetRename(null)
    onToast(r.summary)
  }

  /** 重命名（同名拒绝，原因由 core 给） */
  function handleRenamePreset(): void {
    if (!presetRename) return
    const r = engine.renameFitPresetAt(presetDefId, presetRename.index, presetRename.name)
    if (!r.ok) {
      onToast(cmdText(r) || tr('ui.FitPage.168'), true)
      return
    }
    onToast(tr("ui.FitPage.131"))
    setPresetRename(null)
  }

  /**
   * **用当前装配覆盖这套方案**（替换；已过行内确认）——名称与位置保持原样，只换内容。
   * 空装配会被 core 拒（提示先装几件）。
   */
  function handleOverwritePreset(index: number): void {
    const r = engine.overwriteFitPresetAt(effectiveTarget, index)
    setPresetReplaceAt(null)
    if (!r.ok) {
      onToast(cmdText(r) || tr('ui.FitPage.169'), true)
      return
    }
    setPresetDetailAt(null) // 内容变了：收起旧明细，下次展开重算
    onToast(tr("ui.FitPage.132"))
  }

  /** 删除方案 */
  function handleDeletePreset(index: number): void {
    const r = engine.deleteFitPresetAt(presetDefId, index)
    if (!r.ok) {
      onToast(cmdText(r) || tr('ui.FitPage.170'), true)
      return
    }
    setPresetRename(null)
    onToast(tr("ui.FitPage.133"))
  }

  /** 一键卸下全部装备（放回装备库；甲板扩容器一并卸下，超容无人机自动退仓） */
  function handleUnfitAll(): void {
    const r = engine.unfitAllFor(effectiveTarget)
    if (!r.ok) {
      onToast(cmdText(r) || tr('ui.FitPage.165'), true)
      return
    }
    if (r.removed > 0) onToast(tr("ui.FitPage.134", { p1: r.removed }))
    else onToast(tr("ui.FitPage.135"), true)
  }

  // ── 槽位换装浮层（船长 2026-09-05：点槽位 → 浮层选装；覆盖左侧舰船属性） ──
  const [pickBay, setPickBay] = useState<{ rack: RackSlot; index: number } | null>(null)
  // 换装对比段缓存（每候选一段；打开浮层时按当前装配/库存试算一次）
  const [pickDiffs, setPickDiffs] = useState<Map<string, FitSeg[]> | null>(null)
  // 浮层内的筛选与搜索（2026-09-11 船长定：「添加装备筛选和搜索功能，参考市场页面的」→
  // 复刻市场页那套「搜索框 + 分类下拉 + 命中计数」的形态；船长补定：**不要子分类**，只按装备分类，
  // 且**默认稀有度高的排前面**）。筛选只在浮层内生效，不改候选集本身的算法。
  const [pickKw, setPickKw] = useState('')
  const [pickSlot, setPickSlot] = useState<string>('all')
  /** 打开/关闭浮层时重置筛选（与市场页切换类型时子分类归零同哲学） */
  const pickQuery = pickKw.trim().toLowerCase()
  function candidatesOf(rack: RackSlot): ModuleDef[] {
    const base = bayModules.filter((m) => rackOf(m) === rack)
    const hit = (m: ModuleDef): boolean => {
      if (pickSlot !== 'all' && m.slot !== pickSlot) return false
      if (pickQuery.length === 0) return true
      // 检索口径与物品页 `hitMod` 同源：名称 / 槽位中文名 / 说明文；另加装备 id（便于按唯一键查，约定 §5）
      return (
        m.name.toLowerCase().includes(pickQuery) ||
        m.id.toLowerCase().includes(pickQuery) ||
        slotText(m.slot).toLowerCase().includes(pickQuery) ||
        (m.description ?? '').toLowerCase().includes(pickQuery)
      )
    }
    // 默认排序：**稀有度高的排前面**（档位取物品稀有度表 `RARITY_TIER`，键 = 市场商品键 mod-<id>）；
    // 同档保持原有稳定顺序（`bayModules` 的目录序），避免每次筛选都跳动。
    return base
      .filter(hit)
      .map((m, i) => ({ m, i, tier: rarityTierOf(`mod-${m.id}`) }))
      .sort((a, b) => b.tier - a.tier || a.i - b.i)
      .map((x) => x.m)
  }
  /** 浮层当前展示的候选（筛选 + 搜索 + 按稀有度排序；浮层关闭时为空数组） */
  const pickShown: ModuleDef[] = pickBay ? candidatesOf(pickBay.rack) : []
  /** 该槽位可选的全部装备里出现过的装备分类（下拉选项；只列实际存在的槽位） */
  function pickSlotOptions(rack: RackSlot): Array<{ slot: string; label: string; count: number }> {
    const cnt = new Map<string, number>()
    for (const m of bayModules) {
      if (rackOf(m) !== rack) continue
      cnt.set(m.slot, (cnt.get(m.slot) ?? 0) + 1)
    }
    return [...cnt.entries()]
      .map(([slot, count]) => ({ slot, label: slotText(slot), count }))
      .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
  }
  /** 试算"该位卸旧件→装候选"后的同源合成快照（只读模拟：浅拷贝 fitted 链，不触碰真实状态） */
  function tryFitSpec(
    m: ModuleDef,
    rack: RackSlot,
    index: number,
  ): { cur: UnitSpec; next: UnitSpec | null; cpuNext: number; cpuTotalNext: number } | null {
    const curSpec = spec
    if (!curSpec) return null
    const base: FittedModules = fitted ?? { high: [], mid: [], low: [] }
    const arr = [...(base[rack] ?? [])]
    while (arr.length <= index) arr.push(null)
    arr[index] = m.id
    const simFitted: FittedModules = { ...base, [rack]: arr }
    const fleet = state.fleet[effectiveTarget]
    if (!fleet) return null
    const simState: GameState = {
      ...state,
      fleet: { ...state.fleet, [effectiveTarget]: { ...fleet, fitted: simFitted } },
    }
    return {
      cur: curSpec,
      next: createPlayerSpec(simState, engine.ctx, effectiveTarget),
      // 2026-09-08：换装对比 CPU 口径同含无人机舱清单占用（清单不变，只反映装配变化）
      cpuNext: fittedCpuUsed(simFitted, engine.ctx, shipDef) + droneCpuUsed(fleet.droneLoad, engine.ctx),
      // 2026-09-11 协处理器：**装后预算**（装的是协处理器时会变大）——"CPU 剩"两栏各用自己的预算
      cpuTotalNext: cpuBudgetOf(state, engine.ctx, effectiveTarget, simFitted),
    }
  }
  function openPick(rack: RackSlot, index: number): void {
    // 每次打开都从「全部」看起（与市场页切换类型时子分类归零同哲学）
    setPickKw('')
    setPickSlot('all')
    setPickBay({ rack, index })
    // 2026-09-11 协处理器：预算随件走 —— 对比段的两栏各用自己的预算（装/卸协处理器才显示得对）
    const cpuTotal = cpuBudgetOf(state, engine.ctx, effectiveTarget)
    const segs = new Map<string, FitSeg[]>()
    for (const m of candidatesOf(rack)) {
      const oldId = fitted?.[rack]?.[index] ?? null
      if (oldId === m.id) {
        segs.set(m.id, [])
        continue // 同件重装无对比意义
      }
      const r = tryFitSpec(m, rack, index)
      // 新旧武器的弹伤倍率/弹种（非武器槽 = null；空位 = 无旧件）
      const oldDef = oldId !== null ? engine.ctx.modules.get(oldId) ?? null : null
      const isWeaponSlot = WEAPON_SLOTS.has(m.slot) // 三类武器件（高槽）
      const weapon = isWeaponSlot
        ? {
            curMult: oldDef?.dmgMult ?? null,
            nextMult: m.dmgMult ?? null,
            curType: oldDef ? weaponDamageTypeOf(oldDef) : null,
            nextType: weaponDamageTypeOf(m),
          }
        : undefined
      segs.set(
        m.id,
        r && r.next ? diffSegs(r.cur, r.next, cpuUsed, r.cpuNext, cpuTotal, weapon, r.cpuTotalNext) : [],
      )
    }
    setPickDiffs(segs)
  }
  /** 装配/换装（2026-09-11 起走**原子换装**：一次成型、按最终状态校验 CPU ——
   *  原先的"先卸后装"在 CPU 双向校验下会把「换协处理器」这类最终态合法的换装卡住） */
  function pickModule(m: ModuleDef): void {
    if (!pickBay) return
    const { rack, index } = pickBay
    const had = (fitted?.[rack]?.[index] ?? null) !== null
    const r = engine.swapModuleTo(m.id, rack, index, effectiveTarget)
    if (!r.ok) onToast(cmdText(r) || tr('ui.FitPage.171'), true)
    else onToast(tr("ui.FitPage.136", { p1: m.name, p2: had ? tr("ui.FitPage.022") : tr("ui.FitPage.023"), p3: rackText(rack), p4: index + 1 }))
    setPickBay(null)
  }

  /**
   * **本船特性对隐秘行动装置的标注**（船长 2026-09-16：「侦查舰添加特性，隐秘行动装置所需CPU降低50%，
   * 且移除推进器失效惩罚」＋四答「甲：特性栏 ＋ 装配页标注」）——只在**本船确有该特性**且**这件是隐秘装置**
   * 时返回一段尾巴，写清"省了多少"与"推进器不再失效"；其余件、其余船返回空串（一个字不加）。
   * 数值走 core 的 `cpuUseOf`（装配校验同一函数）⇒ 界面写的数就是引擎算的数。
   */
  function stealthTraitNote(m: ModuleDef): string {
    if (m.stealthMs === undefined || !shipDef) return ''
    const bits: string[] = []
    if (shipDef.stealthCpuMul !== undefined && shipDef.stealthCpuMul !== 1) {
      bits.push(tr("ui.FitPage.137", { p1: cpuUseOf(m, shipDef), p2: m.cpuUse ?? 0 }))
    }
    if (shipDef.stealthIgnoresPropulsion === true) bits.push(tr("ui.FitPage.138"))
    return bits.length > 0 ? ` ← ${bits.join(' · ')}` : ''
  }

  /** 空位候选下拉文案：V18.1 收敛件标注"第 N 件衰减"（避免玩家误以为全效线性叠加） */
  function fitOptionLabel(m: ModuleDef): string {
    const base = `${m.name}（×${countModule(state, m.id)} · ${moduleShortEffect(m)}）${stealthTraitNote(m)}`
    if (!fitted) return base
    const st = stackingOf(m)
    // `flat` = 加算不收敛、`sum` = 同舰加和（上限内不打折）⇒ 两者都不挂"第 N 件衰减"尾注
    if (st.group === 'flat' || st.group === 'sum') return base
    const n = sameKindCount(fitted, engine.ctx, m)
    if (n === 0) return base
    // 2026-09-15 隐秘行动装置（`max` 组）：多件**取最长一件**——明说"不叠加"，免得玩家以为能叠到 50 秒
    if (st.group === 'max') return tr("ui.FitPage.139", { base: base, p2: n + 1 })
    if (st.group === 'curve' || st.group === 'weighted') { // 折权加算与 EVE 曲线同文案：写明第 N 件按权重百分比生效
      return tr("ui.FitPage.140", { base: base, p2: n + 1, p3: Math.round(stackWeight(n + 1) * 100) })
    }
    return tr("ui.FitPage.141", { base: base, p2: n + 1 })
  }

  // 无人机舱总量（船体 + 已装「甲板扩展」= 清单容量上限；装入入口在低槽组下方无人机舱区——
  // 2026-09-08 无人机舱大改：只放飞已装入清单，仓库余量不自动出战）
  // 2026-09-26：求和改用 core 单点 `droneBayTotalM3`（舰队页悬停卡同源，防两处口径漂移）
  const droneBayTotal = droneBayTotalM3(shipDef, fitted, engine.ctx)

  // 船体维修装置·运转消耗提示（2026-09-10 船长：消耗的修理组件常被忽略）——
  // 装了维修装置就列出"每跳吃什么组件、现在有多少"，0 枚直接红字告警；
  // 无消耗自愈件（异形生体件 repairFree）单列一行：不吃组件、永不停机
  const repairKitRows: { kitId: string; name: string; stock: number; perJumpSecs: number }[] = []
  const freeRepairRows: { name: string; secs: number; armor: number; hull: number }[] = []
  if (fitted) {
    for (const id of Object.values(fitted).flat()) {
      if (typeof id !== 'string' || id.length === 0) continue
      const mod = engine.ctx.modules.get(id)
      if (!mod || ((mod.repairArmorHp ?? 0) <= 0 && (mod.repairHullHp ?? 0) <= 0)) continue
      const secs = Math.max(1, Math.round((mod.repairIntervalMs ?? 5_000) / 1_000))
      if (mod.repairFree === true) {
        freeRepairRows.push({
          name: mod.name,
          secs,
          armor: mod.repairArmorHp ?? 0,
          hull: mod.repairHullHp ?? 0,
        })
        continue
      }
      const kitId = mod.repairKit ?? 'repairkit-civ'
      if (repairKitRows.some((r) => r.kitId === kitId)) continue
      repairKitRows.push({
        kitId,
        name: engine.ctx.items.get(kitId)?.name ?? kitId,
        stock: (state.fleet[effectiveTarget]?.cargo?.[kitId] ?? 0) + countWare(state, kitId),
        perJumpSecs: secs,
      })
    }
  }

  return (
    <div className="page-stack page-fill">
      <Panel className="is-fill" title={tr("ui.FitPage.024")} right={<span className="app-dim">{tr("ui.FitPage.025")}</span>}>
        {/* 装配目标（船长 2026-09-05：醒目左置；入口在舰船页卡片，本页不再切换目标） */}
        <div className="app-fit-target">
          <span className="app-fit-target-label">
            {tr("ui.FitPage.026")}
            {isPiloted ? <em className="app-belt-flag is-run">{tr("ui.FitPage.027")}</em> : <em className="app-belt-flag">{tr("ui.FitPage.028")}</em>}
          </span>
          <span className="app-fit-target-ship">{shipName}</span>
          <span className="app-dim app-fit-target-hint">
            {isPiloted
              ? tr("ui.FitPage.029")
              : tr("ui.FitPage.030")}
          </span>
          {/* 装配方案（2026-09-14 船长：保存当前装配 / 使用预设装配）——同一船型通用 */}
          <div className="app-fit-preset-bar">
            <button
              className="app-btn is-small"
              onClick={handleSavePreset}
              title={tr("ui.FitPage.031")}
            >
              {tr("ui.FitPage.032")}
            </button>
            <button
              className="app-btn is-small is-primary"
              onClick={() => setPresetOpen(true)}
              title={tr("ui.FitPage.142", { FIT_PRESET_MAX: FIT_PRESET_MAX })}
            >
              {tr("ui.FitPage.033")} <em className="app-fit-preset-count">{presets.length}/{FIT_PRESET_MAX}</em>
            </button>
          </div>
        </div>
        <div className="app-fit-cols">
          <div className="app-fit-col-left">
        {shipDef ? (
          <>
            {/* 舰船形象 + 间接属性（船长 2026-09-09：左栏顶部插入独立舰影，间接属性移其右侧；
                窄窗优先缩小舰影，图缩至下限仍不够时隐藏间接列——高度守恒：原底部间接块整体上移占位） */}
            <div className="app-fit-stage" ref={stageRef}>
              <div className="app-fit-stage-art">
                <ShipSprite shipId={shipDef.id} role={shipDef.role} size={stageFit.art} engine={false} />
              </div>
              {stageFit.indirect && shipIndirectLines(shipDef, effWarp).length > 0 ? (
                <div className="app-fit-indirect">
                  <div className="app-info-note app-fit-indirect-note">{tr("ui.FitPage.034")}</div>
                  <InfoTable lines={shipIndirectLines(shipDef, effWarp)} />
                </div>
              ) : null}
            </div>
          <div className="app-fit-shipinfo">
            <span className="app-fit-shipinfo-head">
              {/* 血量徽章 = 装后合成值（装备/技能生效后）；火力增幅已从徽章移入下方属性行（船长 2026-09-05） */}
              <span className="app-combat-badges">
                {combatBadges(
                  shipDef,
                  spec
                    ? { hp: { s: Math.round(spec.hp.s), a: Math.round(spec.hp.a), h: Math.round(spec.hp.h) }, resists: spec.resists }
                    : undefined,
                )}
              </span>
            </span>
            <InfoTable
              lines={[
                ...shipInfoLines(shipDef).filter(
                  (l) =>
                    l.k !== '槽位' && // l10n-keep：这几条是 core shipInfoLines 的中文标签 key（比较用，非文案）
                    l.k !== '采集性能' &&
                    l.k !== '货舱容量' &&
                    l.k !== 'CPU' && // 上限已由右栏「CPU 剩余」条显示（含技能加成），表格不重复
                    // 2026-09-26 船长：「无人机舱有2个重复的」＋「用机动速度替换所有动力的位置」
                    // ⇒ 这两条基础行让位给下面的合计行 / 装后口径行（登记表见 `shipInfo.tsx`
                    // `FIT_MAIN_HIDDEN_KEYS`，`npm run ui:attr-check` 按「不重名」体检）
                    !FIT_MAIN_HIDDEN_KEYS.includes(l.k) &&
                    !COMBAT_BASE_KEYS.has(l.k),
                ),
                // 机动速度（2026-09-11 船长：「推进器现在有持续时间和冷却时间，这点希望在推进器的
                // 说明内讲清」）：推进器周期化（2026-09-10）后 `spec.speedMps` **已不含**推进器加成
                // （加成走 `thrusterBoost`、只在点火窗口生效）——旧标签「含加力」与自己显示的数字
                // 对不上，改为「基础值 +（装推进器时）点火期值 + 周期尾缀」，秒数与 balance 同源。
                // **2026-09-14 起按船取值**：周期取自本船 `spec` 的两个覆盖字段（微型跃迁引擎 = 10 秒点火）。
                // **2026-09-26 船长**：「用机动速度替换所有动力的位置（假如已经存在，则挪过来）」
                // ⇒ 本行从右下角装后块**整体上移**到原「动力」行的位置（动力已挪去左栏「间接属性」）。
                // 行内容走 `fittedSpeedLine` 单点——舰队页悬停卡（`shipCurrentLines`）同一份。
                ...(spec ? [fittedSpeedLine(spec, engine.ctx.balance.battle)] : []),
                // 无人机舱（上限 = 船体 + 甲板扩展；战斗只放飞下方「无人机舱」清单——2026-09-08 大改）
                ...(droneBayTotal > 0 ? [fittedDroneBayLine(droneBayTotal)] : []),
                // 船体维修装置·运转消耗（2026-09-10 船长：消耗组件需高亮；0 枚红字告警）
                ...repairKitRows.map((r) => {
                  const cls = r.stock <= 0 ? 'is-bad' : r.stock < 10 ? 'is-warn' : 'is-ok'
                  const hint =
                    r.stock <= 0
                      ? tr("ui.FitPage.036")
                      : r.stock < 10
                        ? tr("ui.FitPage.037")
                        : tr("ui.FitPage.038")
                  return {
                    k: tr("ui.FitPage.039"),
                    v: (
                      <>
                        <em className="app-chip is-cost">{tr('ui.FitPage.163', { name: r.name, s: r.perJumpSecs })}</em>
                        <span className={`app-kit-stock ${cls}`}>
                          {' '}{tr("ui.FitPage.040")} {r.stock} {tr("ui.FitPage.041")}{hint}）
                        </span>
                      </>
                    ),
                  }
                }),
                // 无消耗自愈件（异形生体件）：不吃组件、永不停机——单列一行，避免玩家误以为要备料
                ...(freeRepairRows.length > 0
                  ? [
                      {
                        k: tr("ui.FitPage.042"),
                        v: (
                          <>
                            <em className="app-chip is-ok">{tr("ui.FitPage.043")}</em>
                            <span className="app-dim">
                              {' '}
                              {freeRepairRows
                                .map((r) => tr("ui.FitPage.144", { p1: r.name, p2: r.secs, p3: r.armor, p4: r.hull }))
                                .join('；')}
                              {tr("ui.FitPage.044")}
                            </span>
                          </>
                        ),
                      },
                    ]
                  : []),
                // 装后合成预览（V18.1：收敛件多装最终值；血量由顶部徽章承担不重复列出——与最上方徽章同源）
                ...(spec
                  ? [
                      { k: tr("ui.FitPage.045"), v: resChipsAll(spec.resists.shield) },
                      { k: tr("ui.FitPage.046"), v: resChipsAll(spec.resists.armor) },
                      { k: tr("ui.FitPage.005"), v: resChipsAll(spec.resists.hull) },
                      {
                        k: tr("ui.FitPage.047"),
                        v:
                          hitRead === null ? (
                            '—'
                          ) : (
                            <>
                              {`${Math.round(hitRead.rate * 100)}%`}
                              {hitDetail !== '' ? <span className="app-dim">{`（${hitDetail}）`}</span> : null}
                            </>
                          ),
                      },
                      { k: tr("ui.FitPage.048"), v: `${Math.round(spec.evasion * 100)}%` },
                      // 机动速度已上移到主表（原「动力」行位置，见文件上方）——此处不再重复
                      // 跃迁速度（2026-09-14 跃迁计算机）：只影响**跨星系航行耗时**，战斗机动一字不动
                      // ⇒ 与「机动速度」并列单列一行，避免玩家把两个"速度"混为一谈。
                      {
                        k: tr("ui.FitPage.050"),
                        v: (
                          <>
                            {`${effWarp ? effWarp.aus.toFixed(2) : '-'} AU/s`}
                            {effWarp && effWarp.bonusPct > 0 ? (
                              <span className="app-dim">{tr("ui.FitPage.146", { p1: Math.round(effWarp.bonusPct * 100) })}</span>
                            ) : null}
                            <span className="app-dim">{tr("ui.FitPage.147", { p1: warpFactor.toFixed(2) })}</span>
                          </>
                        ),
                      },
                    ]
                  : []),
              ]}
              note={tr("ui.FitPage.148", { p1: slots.high, p2: slots.mid, p3: slots.low })}
            />
          </div>
          {/* 无人机舱（**2026-09-26 船长令**：「**无人机仓位移动到左半边**」）——原先在右栏低槽组下方，
              现挂在左栏「舰船属性表」之后：装什么机群与船体属性是同一件事的两面。
              自带顶部虚线分隔（`.app-fit-dronebay`），与上面那张表分得开。 */}
          <DroneBaySection engine={engine} onToast={onToast} target={effectiveTarget} />
          </>
        ) : null}
          </div>
          <div className="app-fit-col-right">
        {/* 弹药档位（**2026-09-26 船长令**：「**右侧弹药档位移动到最上方 CPU 上面**」）——
            "出战前选哪一档弹"是这一栏最靠前的动作，故放到 CPU 条之前；没有对应武器的弹族时
            整块不渲染（`AmmoTierSection` 的 `rows.length === 0` 早退）⇒ 无机炮的船这里就是 CPU 条打头。 */}
        <AmmoTierSection engine={engine} onToast={onToast} target={effectiveTarget} />
        {/* CPU 剩余条（船长 2026-09-05：由左栏移置槽位最上方、减法显示剩余；与放飞共用池）。
            2026-09-11 协处理器：预算 = 船体 CPU + 已装协处理器扩容 → 走 core `cpuBudgetOf` 单点 */}
        {shipDef ? (
          <CpuStrip used={cpuUsed} total={cpuBudgetOf(state, engine.ctx, effectiveTarget)} />
        ) : null}
        {/* V18：高/中/低三组槽位——按槽位图标排布（取消列表形式，船长 2026-09-05） */}
        <div className="app-fit-racks">
          {(['high', 'mid', 'low'] as RackSlot[]).map((rack) => {
            const bays = fitted ? fitted[rack] : []
            const filledCount = bays.filter((id) => id !== null).length
            const total = slots[rack]
            return (
              <div key={rack} className="app-fit-rack">
                <div className="app-fit-rack-title">
                  {rackText(rack)} <span className="app-dim">（{RACK_FAMILIES[rack]}）</span>
                  <span className="app-dim">　{filledCount}/{total} {tr("ui.FitPage.051")}</span>
                </div>
                <div className="app-fit-icongrid">
                {Array.from({ length: Math.max(total, bays.length) }, (_, i) => {
                  const fittedId = bays[i] ?? null
                  const fittedDef = fittedId ? engine.ctx.modules.get(fittedId) : undefined
                  if (!fittedDef) {
                    // 空位：点击槽位 → 浮层选装（船长 2026-09-05：格内不显示位序、无下拉）
                    return (
                      <button
                        key={`${rack}-${i}`}
                        className="app-fit-slot-icon is-empty"
                        onClick={() => openPick(rack, i)}
                        title={tr("ui.FitPage.149", { p1: i + 1 })}
                      >
                        <span className="app-fit-slot-icon-glyph">＋</span>
                        <span className="app-fit-slot-icon-name">{tr("ui.FitPage.023")}</span>
                      </button>
                    )
                  }
                  const tone = toneOf(fittedDef.slot)
                  return (
                    <button
                      key={`${rack}-${i}`}
                      className="app-fit-slot-icon is-filled"
                      onClick={() => openPick(rack, i)}
                      /* 2026-09-16 船长：「装配界面，鼠标悬停槽位上的装备时，显示出的装备详细过于简陋，
                         参考仓库界面的物品详细」⇒ 改挂**仓库同款富卡**（`moduleHoverContent` =
                         `ModuleHover` 的内容，标题 + 统一参数表 + 描述），行动提示降为末行注脚。
                         ⚠ 不再写 `title`：同一元素禁 `title` + 富提示并存（两个提示路径互顶）。 */
                      {...hoverTipProps(
                        moduleHoverContent(fittedDef, tr("ui.FitPage.150", { p1: i + 1, p2: stealthTraitNote(fittedDef) })),
                      )}
                    >
                      <span className="app-fit-slot-icon-glyph">
                        <Glyph name={fittedDef.slot} size={22} color={tone} />
                      </span>
                      <span className="app-fit-slot-icon-name">{fittedDef.name}</span>
                      <span
                        className="app-fit-slot-icon-unfit"
                        role="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleUnfit(rack, i)
                        }}
                      >
                        {tr("ui.FitPage.052")}
                      </span>
                    </button>
                  )
                })}
                </div>
              </div>
            )
          })}
          {/* 弹药档位已上移到本栏最上方（2026-09-26 船长令），此处不再渲染 */}
          {/**
           * **舰船插件槽（只读）**（**2026-09-26 船长令**：「舰船插件是一种类似装备的东西，同样装备在
           * 舰船上，但是**不可拆卸，不可替换**」）。
           *
           * 与高/中/低槽**刻意不同**：这里**没有卸下按钮、没有浮层选装**——不可拆是**结构性**的
           * （core 的 `plugs.ts` 连 `removePlug` 都不存在），界面这一块只是**读数**。
           * 槽位上限与已装清单都走 core 单点 `plugInfoOf`；短效果复用装备行同一把尺 `moduleShortEffect`。
           */}
          <PluginSlotsSection engine={engine} target={effectiveTarget} />
          {/* 无人机舱已移到左栏（2026-09-26 船长令：「无人机仓位移动到左半边」） */}
        </div>
          </div>
        </div>
      </Panel>

      {/* 装配方案浮层（2026-09-14 船长）：套用 / 重命名 / 删除 / 一键卸下 */}
      {presetOpen ? (
        <div className="app-fit-overlay" onClick={() => setPresetOpen(false)}>
          <div className="app-fit-modal app-fit-preset-modal" onClick={(e) => e.stopPropagation()}>
            <div className="app-fit-modal-head">
              <span>
                {tr("ui.FitPage.053")} {shipName}
                <HintIcon tip={tr("ui.FitPage.054")} />
              </span>
              <button className="app-btn is-small" onClick={() => setPresetOpen(false)}>
                {tr("ui.FitPage.055")}
              </button>
            </div>
            {presets.length === 0 ? (
              <div className="app-dim app-inv-empty">
                {tr("ui.FitPage.056")}
              </div>
            ) : (
              <div className="app-fit-preset-list">
                {presets.map((p, i) => {
                  // 明细每渲染算一次（件名解析走 core 单点 `fitPresetDetailOf`，界面不自己拼）
                  const detail = presetDetailAt === i && shipDef ? fitPresetDetailOf(p, engine.ctx, shipDef) : null
                  return (
                  <div className="app-fit-preset-item" key={`${p.name}-${i}`}>
                  <div className="app-fit-preset-row">
                    {presetRename?.index === i ? (
                      <>
                        <input
                          className="app-mkt-search-input app-fit-preset-name"
                          value={presetRename.name}
                          maxLength={FIT_PRESET_NAME_MAX}
                          spellCheck={false}
                          onChange={(e) => setPresetRename({ index: i, name: e.target.value })}
                        />
                        <span className="app-dim">{fitPresetBrief(p)}</span>
                        <button className="app-btn is-small is-primary" onClick={handleRenamePreset}>
                          {tr("ui.FitPage.057")}
                        </button>
                        <button className="app-btn is-small" onClick={() => setPresetRename(null)}>
                          {tr("ui.ActivityBar.004")}
                        </button>
                      </>
                    ) : presetReplaceAt === i ? (
                      /* 替换的两步确认（船长 2026-09-19）：覆盖前先问一句 */
                      <>
                        <b>{p.name}</b>
                        <span className="app-dim">{tr("ui.FitPage.058")}</span>
                        <button
                          className="app-btn is-small is-primary"
                          title={tr("ui.FitPage.059")}
                          onClick={() => handleOverwritePreset(i)}
                        >
                          {tr("ui.FitPage.060")}
                        </button>
                        <button className="app-btn is-small" onClick={() => setPresetReplaceAt(null)}>
                          {tr("ui.ActivityBar.004")}
                        </button>
                      </>
                    ) : (
                      <>
                        <b>{p.name}</b>
                        <span className="app-dim">{fitPresetBrief(p)}</span>
                        <button
                          className="app-btn is-small"
                          onClick={() => setPresetDetailAt(presetDetailAt === i ? null : i)}
                          title={tr("ui.FitPage.061")}
                        >
                          {presetDetailAt === i ? tr("ui.FitPage.062") : tr("ui.FitPage.063")}
                        </button>
                        <button className="app-btn is-small is-primary" onClick={() => handleApplyPreset(i)}>
                          {tr("ui.FitPage.064")}
                        </button>
                        <button
                          className="app-btn is-small"
                          title={tr("ui.FitPage.065")}
                          onClick={() => setPresetReplaceAt(i)}
                        >
                          {tr("ui.FitPage.066")}
                        </button>
                        <button
                          className="app-btn is-small"
                          onClick={() => setPresetRename({ index: i, name: p.name })}
                        >
                          {tr("ui.FitPage.067")}
                        </button>
                        <button className="app-btn is-small is-warn" onClick={() => handleDeletePreset(i)}>
                          {tr("ui.FitPage.068")}
                        </button>
                      </>
                    )}
                  </div>
                  {/* 方案明细（2026-09-17 船长）：逐位列出「高 1 件名 · 2 空 …」＋无人机；件名走 core 单点 */}
                  {detail ? (
                    <div className="app-fit-preset-detail">
                      {(['high', 'mid', 'low'] as const).map((rack) => (
                        <div className="app-fit-preset-detail-line" key={rack}>
                          <span className="app-fit-preset-detail-rack">{rackText(rack)}</span>
                          {detail.slots
                            .filter((s) => s.rack === rack)
                            .map((s) => (
                              <span
                                className={`app-fit-preset-detail-cell${s.id === null ? ' is-empty' : ''}${s.missing ? ' is-missing' : ''}`}
                                key={`${rack}-${s.index}`}
                              >
                                <em>{s.index}</em>
                                {s.name}
                                {s.missing ? tr("ui.FitPage.069") : ''}
                              </span>
                            ))}
                        </div>
                      ))}
                      <div className="app-fit-preset-detail-line">
                        <span className="app-fit-preset-detail-rack">{tr("ui.Handbook.004")}</span>
                        {detail.drones.length === 0 ? (
                          <span className="app-fit-preset-detail-cell is-empty">{tr("ui.FitPage.070")}</span>
                        ) : (
                          detail.drones.map((d) => (
                            <span
                              className={`app-fit-preset-detail-cell${d.missing ? ' is-missing' : ''}`}
                              key={d.id}
                            >
                              {d.name} ×{d.count}
                              {d.missing ? tr("ui.FitPage.071") : ''}
                            </span>
                          ))
                        )}
                      </div>
                      {detail.overflow > 0 ? (
                        <div className="app-fit-preset-detail-note">
                          {tr("ui.FitPage.072")} {detail.overflow} {tr("ui.FitPage.073")}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  </div>
                  )
                })}
              </div>
            )}
            <div className="app-fit-preset-foot">
              <button className="app-btn is-small" onClick={handleSavePreset}>
                {tr("ui.FitPage.074")}
              </button>
              <button
                className="app-btn is-small is-warn"
                onClick={handleUnfitAll}
                title={tr("ui.FitPage.075")}
              >
                {tr("ui.FitPage.076")}
              </button>
              <span className="app-dim">
                {tr("ui.FitPage.077")}
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {/* 槽位换装浮层：覆盖左侧舰船属性（船长 2026-09-05） */}
      {pickBay ? (
        <div className="app-fit-overlay" onClick={() => setPickBay(null)}>
          <div className="app-fit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="app-fit-modal-head">
              <span>
                {tr('ui.FitPage.164', { rack: rackText(pickBay.rack), n: pickBay.index + 1 })}
                {fitted?.[pickBay.rack]?.[pickBay.index] ? tr("ui.FitPage.078") : tr("ui.FitPage.079")}
                <HintIcon tip={tr("ui.FitPage.080")} />
              </span>
              <button className="app-btn is-small" onClick={() => setPickBay(null)}>
                {tr("ui.FitPage.055")}
              </button>
            </div>
            {/* 筛选与搜索（2026-09-11 船长定：参考市场页；复刻 app-mkt-search 那套"搜索框 + 分类下拉 + 命中计数"） */}
            <div className="app-mkt-search app-fit-pick-filter">
              <input
                className="app-mkt-search-input"
                type="search"
                placeholder={tr("ui.FitPage.081")}
                value={pickKw}
                onChange={(e) => setPickKw(e.target.value)}
                spellCheck={false}
              />
              <select
                className="app-mkt-kind"
                value={pickSlot}
                onChange={(e) => setPickSlot(e.target.value)}
                title={tr("ui.FitPage.082")}
              >
                <option value="all">{tr("ui.FitPage.083")}</option>
                {pickSlotOptions(pickBay.rack).map((o) => (
                  <option key={o.slot} value={o.slot}>
                    {o.label}（{o.count}）
                  </option>
                ))}
              </select>
              <span className="app-dim">
                {pickQuery.length > 0 || pickSlot !== 'all'
                  ? tr("ui.FitPage.151", { p1: pickShown.length })
                  : tr("ui.FitPage.152", { p1: pickShown.length })}
              </span>
            </div>
            <div className="app-fit-pickgrid">
              {pickShown.length === 0 ? (
                <div className="app-dim app-exp-idle">{tr("ui.FitPage.084")}</div>
              ) : null}
              {pickShown.map((m) => {
                const segs = pickDiffs?.get(m.id)
                const sameAsOld = (fitted?.[pickBay.rack]?.[pickBay.index] ?? null) === m.id
                return (
                  <button
                    key={m.id}
                    className="app-fit-pick-item"
                    /* 2026-09-16 同批：候选卡也换成**仓库同款富卡**（标题 + 参数表 + 描述），
                       `fitOptionLabel` 里那串"第 N 件衰减/取最长一件"的行动信息降为末行注脚。
                       ⚠ 不再写 `title`（同一元素禁 `title` + 富提示并存）。 */
                    {...hoverTipProps(moduleHoverContent(m, fitOptionLabel(m)))}
                    onClick={() => pickModule(m)}
                    disabled={sameAsOld}
                  >
                    {/* 图标与名称同行（船长 2026-09-05：图标不再单独占一行） */}
                    <span className="app-fit-pick-head">
                      <span className="app-fit-pick-icon">
                        <Glyph name={m.slot} size={20} color={toneOf(m.slot)} />
                      </span>
                      <span className="app-fit-pick-name">{m.name}</span>
                    </span>
                    {/* 说明行：武器 = 弹药类型 chip（攻击类型醒目）+ **弹伤害倍率** + 层位克制 + 射程；
                        2026-09-11 船长：「装配界面更换炮台时，只简略的显示了火力变化，无法看到武器的
                        弹药伤害倍率」⇒ 弹种 chip 旁补一枚克制 chip（复用 DmgChip，悬停给三层全串），
                        文本里给出 `弹伤 ×N`（= 模块 dmgMult，单发 = 弹 dmg × 本倍率）。 */}
                    <span className="app-fit-pick-sub">
                      {WEAPON_SLOTS.has(m.slot) ? (
                        <>
                          {ammoChipOf(m)}
                          <DmgChip t={weaponDamageTypeOf(m)} label={layerShortOf(weaponDamageTypeOf(m))} />
                          <span className="app-fit-pick-subtext">
                            ×{countModule(state, m.id)}
                            {m.dmgMult !== undefined ? tr("ui.FitPage.153", { p1: mulText(m.dmgMult) + ((m.shots ?? 1) > 1 ? `×${m.shots}` : '') }) : ''}
                            {/* ⟪2026-09-22 船长令⟫ 单轮发数并进同一乘式：陵卫连装炮显示「弹伤害 ×4.6×2」 */}
                            {tr('ui.FitPage.162', { r: rangeShort(m) })}
                          </span>
                        </>
                      ) : (
                        <span className="app-fit-pick-subtext">
                          ×{countModule(state, m.id)} · {moduleShortEffect(m)}
                        </span>
                      )}
                    </span>
                    {sameAsOld ? (
                      <span className="app-fit-pick-diff">
                        <span className="dseg is-none">{tr("ui.FitPage.085")}</span>
                      </span>
                    ) : segs && segs.length > 0 ? (
                      <span className="app-fit-pick-diff" title={segs.map((s) => s.t).join('　')}>
                        {segs.slice(0, 4).map((s, i) => (
                          <span key={i} className={`dseg is-${s.c}`}>
                            {s.t}
                          </span>
                        ))}
                        {segs.length > 4 ? <span className="dseg is-none">+{segs.length - 4}</span> : null}
                      </span>
                    ) : (
                      <span className="app-fit-pick-diff">
                        <span className="dseg is-none">{tr("ui.FitPage.086")}</span>
                      </span>
                    )}
                  </button>
                )
              })}
              {candidatesOf(pickBay.rack).length === 0 ? (
                <div className="app-dim app-inv-empty">
                  {tr("ui.FitPage.087")}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/* ═══════════════ 弹药档位（2026-09-09 弹药 MK2：出战前选档——装配页按弹族选基础弹/MK2；
   **取档口径 2026-09-16 船长改判**：开战按"同族取能装得最多的一档"装载、装不满也照装
   （旧口径「库存不足整族回退基础弹」已作废）；连打/离线同源。未设 = 基础弹；
   本区显示的"本场预载"走 core `resolveAmmoTier`（与开战装载同一函数）） ═══════════════ */

const AMMO_SLOT_TYPES: Array<{ slot: 'turret' | 'missile' | 'laser'; type: DamageType }> = [
  { slot: 'turret', type: 'kinetic' },
  { slot: 'missile', type: 'explosive' },
  { slot: 'laser', type: 'plasma' },
]

/** 弹药档位区：只显示装了对应武器（炮台/导弹架/激光炮）的弹族 */
function AmmoTierSection({
  engine,
  onToast,
  target,
}: {
  engine: PageProps['engine']
  onToast: PageProps['onToast']
  target: string
}) {
  const state = engine.state
  const ctx = engine.ctx
  const ship = state.fleet[target]
  const highIds = new Set((ship?.fitted?.high ?? []).filter((id): id is string => typeof id === 'string'))
  /**
   * **本场预载需求**（与引擎开战装载同一函数 `ammoLoadTotals`）——界面要拿它算"这一档够不够装"。
   * ⚠ 与开战口径同源：同一 `createPlayerSpec` + 同一 `ammoLoadTotals`（技能/装配一变就跟着变）。
   */
  const spec = ship ? createPlayerSpec(state, ctx, target) : null
  const totals = spec ? ammoLoadTotals(spec, ctx.balance.battle, state) : {}
  const rows = AMMO_SLOT_TYPES.map(({ slot, type }) => {
    const hasWeapon = [...highIds].some((id) => ctx.modules.get(id)?.slot === slot)
    if (!hasWeapon) return null
    const mk2 = ctx.items.get(`ammo-${type}-2`)
    const base = ctx.items.get(`ammo-${type}-l`)
    const baseName = base?.name ?? DMG_LABEL[type]
    if (!mk2) return null
    const pref = ship?.ammoPref?.[type]
    const onMk2 = pref === mk2.id
    const haveMk2 = countWare(state, mk2.id)
    const haveBase = countWare(state, base?.id ?? `ammo-${type}-l`)
    /**
     * **本场实际会装哪一档**（船长 2026-09-16「甲」口径：同族取"能装得最多"的那一档）——
     * 走 core 的 `resolveAmmoTier`（**与开战预载同一函数** ⇒ 界面显示 = 实战结果，不各写一套）。
     */
    const need = totals[type] ?? 0
    const eff = resolveAmmoTier(state, ctx, target, type, need)
    const effName = ctx.items.get(eff.id)?.name ?? eff.id
    const noneLeft = eff.can <= 0 && need > 0
    return (
      <div key={type} className="app-fit-ammotier-row">
        <DmgChip t={type} label={baseName} />
        <span className="app-fit-ammotier-opts">
          <button
            className={`app-fit-ammotier-opt${!onMk2 ? ' is-active' : ''}`}
            onClick={() => {
              const r = engine.setAmmoTierAt(type, null, target)
              if (!r.ok) onToast(cmdText(r) || tr('ui.FitPage.172'), true)
            }}
            title={tr("ui.FitPage.154", { baseName: baseName, baseName2: baseName })}
          >
            {baseName}
          </button>
          <button
            className={`app-fit-ammotier-opt${onMk2 ? ' is-active' : ''}`}
            onClick={() => {
              const r = engine.setAmmoTierAt(type, mk2.id, target)
              if (!r.ok) onToast(cmdText(r) || tr('ui.FitPage.172'), true)
            }}
            title={tr("ui.FitPage.155", { p1: mk2.name, p2: mk2.dmg ?? '?', p3: base?.dmg ?? '?', haveMk2: haveMk2 })}
          >
            {mk2.name}
          </button>
        </span>
        <span className="app-dim">
          {baseName} ×{fmt(haveBase)} · {mk2.name} ×{fmt(haveMk2)}
          {need > 0 ? (
            <>
              {' · '}
              {tr("ui.FitPage.088")}<b>{effName}</b> {tr("ui.FitPage.089")} {fmt(eff.can)}/{fmt(need)}
            </>
          ) : null}
          {noneLeft ? (
            <>
              {' · '}
              <span className="app-fit-ammotier-warn">{tr("ui.FitPage.090")}</span>
            </>
          ) : eff.fellBack && need > 0 ? (
            <>
              {' · '}
              <span className="app-fit-ammotier-warn">
                ⚠ {pref ? ctx.items.get(pref)?.name ?? tr('ui.FitPage.173') : tr("ui.FitPage.091")}{tr("ui.FitPage.092")}{effName}
              </span>
            </>
          ) : null}
        </span>
      </div>
    )
  }).filter((x): x is NonNullable<typeof x> => x !== null)
  if (rows.length === 0) return null
  return (
    <div className="app-fit-ammotier">
      <div className="app-fit-dronebay-head">
        <span className="app-fit-dronebay-title">{tr("ui.FitPage.093")}</span>
        <span className="app-dim">{tr("ui.FitPage.094")}</span>
      </div>
      {rows}
    </div>
  )
}

/* ═══════════════ 舰船插件槽（2026-09-26 船长令：只读 · 无卸下 · 无替换） ═══════════════ */

/**
 * **舰船插件槽区**（**只读**）。
 *
 * 船长原话（照抄）：「**舰船插件是一种类似装备的东西，同样装备在舰船上，但是不可拆卸，不可替换。
 * 装有插件的舰船无法放入舰船仓库。**」
 *
 * 三条界面口径：
 * - **没有卸下按钮、没有浮层选装**——"不可拆"是 core 侧的结构性保证（`plugs.ts` 里连 `removePlug`
 *   都不存在）；界面这一块只负责**读数**，不给任何"点了能改"的错觉；
 * - 槽位上限与已装清单走 core 单点 `plugInfoOf`（= `plugSlotsOf` ＋ `plugModulesOf`），界面不自己数；
 * - 无插件槽的船（无档船 / 插件槽为 0）**整块不显示**——不留一行"0/0"的空壳。
 *
 * 满槽时在标题行右侧给一句提示（玩家想知道"还能不能再装"）；未满也报「已装 N/M」。
 *
 * ⚠ **2026-09-26 玩家报障**：「**而且所有舰船的舰船插件都是同一个**」——真因就是这里原先读的是
 * `state.shipId`（**主控船**）而不是本页的**目标船** ⇒ 从舰船页点别的船进装配台时，插件槽整块显示的
 * 是主控船那一套（所有船看起来装的是同一批插件）。现随其它区块一起收 `target`（= `effectiveTarget`）。
 */
function PluginSlotsSection({ engine, target }: { engine: PageProps['engine']; target: string }) {
  const state = engine.state
  const ctx = engine.ctx
  const { slots, installed } = plugInfoOf(state, ctx, target)
  if (slots <= 0) return null
  const full = installed.length >= slots
  return (
    <div className="app-fit-plugslots">
      <div className="app-fit-dronebay-head">
        <span className="app-fit-dronebay-title">{tr('ui.itemSubs.042')}</span>
        <span className="app-dim">
          {tr('ui.Expedition.444', { p1: installed.length, p2: slots })}
          {full ? ` · ${tr('ui.FitPage.177')}` : ''}
        </span>
      </div>
      <div className="app-fit-icongrid">
        {Array.from({ length: slots }, (_, i) => {
          const def = installed[i]
          if (!def) {
            // 空槽：**不可点**（这里没有装入入口；插件只能从装备库走 `installPlug`）
            return (
              <span key={`plug-${i}`} className="app-fit-slot-icon is-empty is-readonly">
                <span className="app-fit-slot-icon-glyph">—</span>
                <span className="app-fit-slot-icon-name">{tr('ui.Expedition.445')}</span>
              </span>
            )
          }
          const tone = toneOf(def.slot)
          return (
            <span
              key={`plug-${i}`}
              className="app-fit-slot-icon is-filled is-readonly"
              {...hoverTipProps(
                moduleHoverContent(def, tr('ui.Expedition.443')),
              )}
            >
              <span className="app-fit-slot-icon-glyph">
                <Glyph name="plug" size={22} color={tone} />
              </span>
              <span className="app-fit-slot-icon-name">{def.name}</span>
              <span className="app-fit-slot-icon-sub">{moduleShortEffect(def)}</span>
            </span>
          )
        })}
      </div>
    </div>
  )
}

/* ═══════════════ 无人机舱（2026-09-08 无人机舱大改：低槽下方；容量条 + 一型一卡 ×N + 全部卸下 + 装入弹层） ═══════════════ */

/** 无人机舱区：只放飞已装入清单；装入/卸下经 adjustDroneLoadAt（舱容 + CPU 预占校验） */
function DroneBaySection({
  engine,
  onToast,
  target,
}: {
  engine: PageProps['engine']
  onToast: PageProps['onToast']
  target: string
}) {
  const state = engine.state
  const ctx = engine.ctx
  const entry = state.fleet[target]
  const shipDef = entry?.defId ? fleetDefOf(state, ctx, target) : undefined
  const fitted = entry?.fitted
  const load = entry?.droneLoad ?? {}
  // 舱上限 = 船体 droneBayM3 + 已装甲板扩展（rack 高槽件）
  let cap = shipDef?.droneBayM3 ?? 0
  if (fitted) {
    for (const id of allFittedIds(fitted)) {
      cap += ctx.modules.get(id)?.droneBayBonusM3 ?? 0
    }
  }
  if (cap <= 0 && Object.keys(load).length === 0) return null // 无舱不显示（与机舱平衡表一致）
  const droneTypes = [...ctx.items.values()].filter((d) => d.kind === 'drone')
  const usedM3 = droneLoadM3(load, ctx)
  const droneCpu = droneCpuUsed(load, ctx)
  const pct = cap > 0 ? Math.min(100, (usedM3 / cap) * 100) : 0
  const [open, setOpen] = useState(false)
  const [selId, setSelId] = useState<string | null>(null)
  const [selN, setSelN] = useState(1)
  const fittedCpu = fitted ? fittedCpuUsed(fitted, ctx, fleetDefOf(state, ctx, target)) : 0
  // 2026-09-11 协处理器：预算含扩容（与 core `adjustDroneLoad` 同源，界面不会"能装/装不上"打架）
  const cpuTotal = cpuBudgetOf(state, ctx, target)
  const cpuLeftRaw = cpuTotal - fittedCpu - droneCpu // 显示用：允许为负（超载时让玩家看见差多少）
  const cpuLeft = Math.max(0, cpuLeftRaw) // 钳制用：决定"还能装几架"

  function adj(id: string, delta: number): void {
    const r = engine.adjustDroneLoadAt(id, delta, target)
    if (!r.ok) onToast(cmdText(r) || tr('ui.Expedition.393'), true)
  }
  function clearAll(): void {
    for (const [id, n] of Object.entries(load)) adj(id, -n)
  }
  /** 某型还能装几架（仓库 × 舱余 × CPU 余 的最小值） */
  function maxOf(droneId: string): number {
    const d = ctx.items.get(droneId)
    if (!d) return 0
    const have = countWare(state, droneId)
    const m3Left = Math.max(0, cap - droneLoadM3(load, ctx))
    const byM3 = Math.floor(m3Left / Math.max(0.001, d.unitM3 ?? 0))
    const byCpu = (d.cpuUse ?? 0) > 0 ? Math.floor(cpuLeft / (d.cpuUse ?? 1)) : 1_000_000
    return Math.max(0, Math.min(have, byM3, byCpu))
  }

  const cells = Object.entries(load)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => {
      const def = ctx.items.get(id)
      return { id, n, def }
    })
  /**
   * **机群缺额**（船长 2026-09-20：战斗结束会立刻按本场出发编制自动补足机群，货仓优先、其次仓库）——
   * 走到"还缺"这一步就说明**货仓与物品仓库都没有存货**了，门槛会拦住重复清剿；
   * 判据走 core 单点 `autoLoopDroneShortfall`（与 `autoLoopReopenBlockReason` 同一把尺），界面不自算。
   */
  const droneShort = autoLoopDroneShortfall(state, target)

  return (
    <div className="app-fit-dronebay">
      <div className="app-fit-dronebay-head">
        <span className="app-fit-dronebay-title">
          {tr("ui.FitPage.010")}
          {/* 并入 main（2026-09-20）：对方把这条说明扩写了（补"战斗结束自动补足"）⇒ 换新 id */}
          <span className="app-dim">{tr("ui.FitPage.174")}</span>
          {droneCpu > 0 ? (
            <span className="app-dim">{tr("ui.FitPage.096")} {droneCpu}）</span>
          ) : null}
        </span>
        {cells.length > 0 ? (
          <button className="app-btn is-small is-warn" onClick={clearAll} title={tr("ui.FitPage.097")}>
            {tr("ui.FitPage.098")}
          </button>
        ) : null}
      </div>
      {/* 容量条（参考 CPU 条视觉；m³ 口径） */}
      <div className="app-fit-dronecap" title={tr("ui.FitPage.156", { p1: Math.round(usedM3 * 10) / 10, cap: cap, droneCpu: droneCpu })}>
        <span className="app-fit-dronecap-label">{tr("ui.FitPage.099")}</span>
        <span className="app-fit-dronecap-num">
          {Math.round(usedM3 * 10) / 10}/{cap} m³
        </span>
        <span className="app-fit-dronecap-track">
          <i style={{ width: `${pct}%` }} />
        </span>
        <span className="app-dim">
          {cells.reduce((s, c) => s + c.n, 0)} {tr("ui.FitPage.100")} {droneCpu}
        </span>
      </div>
      {droneShort ? (
        <div className="app-dim" title={tr('ui.FitPage.175')}>
          {tr('ui.FitPage.176', {
            p1: droneShort.need - droneShort.now,
            p2: droneShort.floor,
            p3: droneShort.now,
          })}
        </div>
      ) : null}
      {/* 型卡流：一型一卡 ×N（+ / − 微调）；空态只有「装入」 */}
      <div className="app-fit-dronebay-cells">
        {cells.map(({ id, n, def }) => (
          <div
            key={id}
            className="app-fit-drone-cell"
            /* 2026-09-16 同批：无人机舱单元格也换**仓库同款富卡**（`itemHoverContent` = 仓库页
               `ItemHover` 的内容），原那句"清单口径"降为末行注脚；± 按钮自己的提示照旧内层优先。 */
            {...hoverTipProps(
              def
                ? itemHoverContent(def, (mid) => engine.ctx.items.get(mid)?.name, tr("ui.FitPage.157"))
                : tr("ui.FitPage.158", { id: id }),
            )}
          >
            {def ? (
              <span className="app-fit-drone-cell-glyph">
                <Glyph name="drone" size={16} color={toneOf('drone')} />
              </span>
            ) : null}
            <span className="app-fit-drone-cell-name">{def?.name ?? id} ×{n}</span>
            <button className="app-fit-drone-step" title={tr("ui.FitPage.101")} onClick={() => adj(id, -1)}>
              −
            </button>
            <button className="app-fit-drone-step" title={tr("ui.FitPage.102")} onClick={() => adj(id, 1)}>
              +
            </button>
          </div>
        ))}
        <button
          className="app-fit-drone-add"
          onClick={() => {
            setSelId(droneTypes.find((d) => maxOf(d.id) > 0)?.id ?? null)
            setSelN(1)
            setOpen(true)
          }}
          title={tr("ui.FitPage.103")}
        >
          {tr("ui.FitPage.104")}
        </button>
      </div>

      {/* 装入弹层：选型 + 数量（钳到 仓库/舱容/CPU 余量） */}
      {open ? (
        <div className="app-fit-overlay" onClick={() => setOpen(false)}>
          <div className="app-fit-modal app-fit-drone-modal" onClick={(e) => e.stopPropagation()}>
            <div className="app-fit-modal-head">
              <span>{tr("ui.FitPage.105")} {Math.round(usedM3 * 10) / 10}/{cap} {tr("ui.FitPage.106")} {minus(cpuLeftRaw)}）</span>
              <button className="app-btn is-small" onClick={() => setOpen(false)}>
                {tr("ui.FitPage.055")}
              </button>
            </div>
            <div className="app-fit-drone-picklist">
              {droneTypes.map((d) => {
                const m = maxOf(d.id)
                const have = countWare(state, d.id)
                const active = selId === d.id
                return (
                  <button
                    key={d.id}
                    className={`app-fit-drone-pick${active ? ' is-active' : ''}${m <= 0 ? ' is-off' : ''}`}
                    onClick={() => {
                      setSelId(d.id)
                      setSelN(1)
                    }}
                    disabled={m <= 0}
                    title={tr("ui.FitPage.159", { p1: d.description, p2: d.unitM3, p3: d.cpuUse ?? 0, have: have })}
                  >
                    <Glyph name="drone" size={18} color={toneOf('drone')} />
                    <span className="app-fit-drone-pick-name">{d.name}</span>
                    <span className="app-dim">
                      {m <= 0 ? tr("ui.FitPage.107") : tr("ui.FitPage.160", { have: have, m: m })}
                    </span>
                  </button>
                )
              })}
            </div>
            {selId ? (
              <div className="app-fit-drone-qty">
                <span>{tr("ui.FitPage.108")}</span>
                <button className="app-fit-drone-step" disabled={selN <= 1} onClick={() => setSelN(Math.max(1, selN - 1))}>
                  −
                </button>
                <b>×{selN}</b>
                <button
                  className="app-fit-drone-step"
                  disabled={selN >= maxOf(selId)}
                  onClick={() => setSelN(Math.min(maxOf(selId), selN + 1))}
                >
                  +
                </button>
                <button
                  className="app-btn is-small is-primary"
                  disabled={maxOf(selId) <= 0}
                  onClick={() => {
                    const want = Math.min(selN, maxOf(selId))
                    adj(selId, want)
                    setOpen(false)
                  }}
                >
                  {tr("ui.FitPage.109")}{Math.min(selN, Math.max(1, maxOf(selId)))}
                </button>
              </div>
            ) : (
              <div className="app-dim app-fit-drone-empty">{tr("ui.FitPage.110")}</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
