/** 功能域职责拆分，保持原计算与顺序。 */
import { type DamageType, typeLayerMult, type DamageResists, type ModuleDef, thrusterCycleSeconds, DEFAULT_BALANCE, thrusterCycleOfModule, repairStatsFor, fittedRepairModules, fittedEffectParamsOf, stackingOf, type ShipDef, shipSlotsOf, MODULE_SLOTS } from '@whale/core'
import { tr } from '../../../i18n/locale'
import type { ReactNode } from 'react'
import type { GameEngine } from '../../../game/engine'
import { rackText, slotText } from '../../../ui/labelsText'

/** 伤害类型中文名 */
// 保留标签表访问方式，但读取时取词，避免缓存模块初始语言。
export const DMG_LABEL: Record<DamageType, string> = {
  get kinetic() { return tr("ui.BattleScreen.002") },
  get explosive() { return tr("ui.battleViewCore.001") },
  get plasma() { return tr("ui.battleViewCore.002") },
}

/** 一行键值信息 */
export interface InfoLine {
  k: string
  v: ReactNode
}

/**
 * 伤害类型色 chip（V17.2 快速辨识）：颜色 = 我方三层血量色——
 * 动能 = 盾蓝（拆盾 ×1.5）/ 高爆 = 甲红（破甲 ×1.5）/ 能量 = 结构黄（拆盾 ×1.25）。
 * label 可覆盖文字（如弹药全词"动能弹"），底色仍按类型。
 * 悬停显示与 combat.typeLayerMult 同源的克制矩阵（2026-09-05 船长）。
 */
export function DmgChip({ t, label }: { t: DamageType; label?: ReactNode }): ReactNode {
  /**
   * **⟪文案调整 2026-10-02⟫ 批⑦**：三层克制那一句改由界面按语言组装（id `ui.shipInfo.248`）——
   * 原先直接显示 core 的 `layerMultText()`（中文整句）⇒ 英文界面出中文；数字仍走 core 的 `typeLayerMult`。
   */
  const layerMulText = (layer: 'shield' | 'armor' | 'hull'): string => {
    const v = typeLayerMult(t, layer)
    return v === 1 ? '×1' : `×${v}`
  }
  return (
    <span
      className={`app-d-chip app-d-${t}`}
      title={tr('ui.shipInfo.248', {
        p1: DMG_LABEL[t],
        p2: layerMulText('shield'),
        p3: layerMulText('armor'),
        p4: layerMulText('hull'),
      })}
    >
      {label ?? DMG_LABEL[t]}
    </span>
  )
}

/** 敌型色 chip：盾厚 = 盾蓝 / 甲厚 = 甲红 / 均衡 = 结构黄（与血量层色同源） */
export function ProfileChip({ profile, text }: { profile: 'shield' | 'armor' | 'balanced'; text: string }): ReactNode {
  return <span className={`app-d-chip app-p-${profile}`}>{text}</span>
}

export const fmt = (n: number | undefined): string => (n === undefined || !Number.isFinite(n) ? '—' : n.toLocaleString('zh-CN'))

export const pct = (n: number): string => `${Math.round(n * 100)}%`

export const recoveryPct = (n: number): string => `${(n * 100).toFixed(1)}%`

export const pctOpt = (n: number | undefined): string => (n === undefined || !Number.isFinite(n) ? '—' : pct(n))

/** 射程带紧凑文本（如 "250 m ~ 4.2 km"；min 为 0 时省略近端） */
export function rangeText(minM: number | undefined, maxM: number | undefined): string {
  if (maxM === undefined) return '—'
  const lo = minM !== undefined && minM > 0 ? `${minM.toLocaleString('zh-CN')} m ~ ` : ''
  const hi = maxM >= 1000 ? `${(maxM / 1000).toFixed(maxM % 1000 === 0 ? 0 : 1)} km` : `${maxM.toLocaleString('zh-CN')} m`
  return lo + hi
}

/** 缺口抗性紧凑文本（图鉴/手册/库行共用；无船体上下文）：非零系如 "动能抗 +20%" */
export function resistGapText(add: DamageResists | undefined): string {
  if (!add) return ''
  const parts = (['kinetic', 'explosive', 'plasma'] as const)
    .map((t) => ({ t, v: add[t] ?? 0 }))
    .filter((x) => x.v > 0)
    .map((x) => tr("ui.shipInfo.087", { p1: DMG_LABEL[x.t], p2: pct(x.v) }))
  return parts.join(' · ')
}

/**
 * 缺口抗性"分系"行（盾/甲/结构三层共用同一写法）：
 * 逐系列出 chip + 缺口值（**三系件必须三系都看得见**——2026-09-10 修：此前只渲染第一系，
 * 陵墓护盾阵列/生体甲壳板这类"三系各 +X%"的件会被玩家误读成只抗一种）；
 * 尾注统一"乘入制 + 90% 上限"（示例取首个非零系）。
 */
/** 缺口抗性"分系"行（盾/甲/结构三层共用同一写法）：
 * 逐系列出 chip + 缺口值（**三系件必须三系都看得见**——2026-09-10 修：此前只渲染第一系，
 * 陵墓护盾阵列/生体甲壳板这类"三系各 +X%"的件会被玩家误读成只抗一种）；
 * 尾注只留"上限 90%"（2026-09-11 船长定精简：乘入制的算式与 25% 基础船示例属机制解释，
 * 面板不再展开——机制详见手册「装配」条目）。
 */
export function resistAddLine(k: string, add: DamageResists | undefined): InfoLine | null {
  const entries = (['kinetic', 'explosive', 'plasma'] as const)
    .map((t) => ({ t, v: add?.[t] ?? 0 }))
    .filter((x) => x.v > 0)
  if (entries.length === 0) return null
  return {
    k,
    v: (
      <>
        {entries.map((x, i) => (
          <span key={x.t} className="app-stack-inline">
            {i > 0 ? <span className="app-dim"> · </span> : null}
            <DmgChip t={x.t} />
            <span className="app-dim">{` +${pct(x.v)}`}</span>
          </span>
        ))}
        <span className="app-dim">{tr("ui.shipInfo.001")}</span>
      </>
    ),
  }
}

/** 推进器周期点火后缀（2026-09-11 精简：只留周期与"开场即点火"，"冷却期间无加速"删；
 *  2026-09-11 船长：「推进器现在有持续时间和冷却时间，这点希望在推进器的说明内讲清」——
 *  秒数不再写死，改由 core `thrusterCycleSeconds()` 取值（与引擎同源）；
 *  **2026-09-14 起按件取值**：件自带覆盖（微型跃迁引擎 = 10 秒点火 / 60 秒冷却）时以件为准）
 *
 *  ⚠ **2026-09-22 修漏译**（船长令「先进行手册的本地化」）：原先直接用 core 的
 *  `thrusterCycleFullText()`——那是**中文整句**（`"{p1} 秒点火 / {p2} 秒冷却，开场即点火"`）
 *  ⇒ 装备图鉴卡副标题在英文界面下夹着这段中文。现改为**取秒数 ＋ 渲染层模板**（core 不动）。 */
export function propTailOf(mod: ModuleDef): string {
  const { boost, cooldown } = thrusterCycleSeconds(DEFAULT_BALANCE.battle, thrusterCycleOfModule(mod))
  return `（${tr('ui.shipInfo.182', { p1: boost, p2: cooldown })}）`
}

/**
 * 推进器周期的**短句版**（`点火 X 秒 / 冷却 Y 秒`，用于「速度 +N%（…）」这类行）。
 * ⚠ 同 `propTailOf` 的 2026-09-22 修漏译：core 的 `thrusterCycleText()` 是中文整句，被 `ui.shipInfo.107`
 * 的 `{p2}` 槽直接吃进去 ⇒ 英文界面下夹中文。现取秒数 ＋ 渲染层模板。
 */
export function thrusterCycleShort(mod: ModuleDef): string {
  const { boost, cooldown } = thrusterCycleSeconds(DEFAULT_BALANCE.battle, thrusterCycleOfModule(mod))
  return tr('ui.shipInfo.183', { p1: boost, p2: cooldown })
}

/** 维修件的每跳修复量文本（跨族行与主分支共用，防两处口径漂移） */
export function repairAmountText(mod: ModuleDef): string {
  const arm = mod.repairArmorHp ?? 0
  const hul = mod.repairHullHp ?? 0
  if (arm > 0 && hul > 0) return arm === hul ? tr("ui.shipInfo.088", { p1: fmt(arm) }) : tr("ui.shipInfo.089", { p1: fmt(arm), p2: fmt(hul) })
  if (arm > 0) return tr("ui.shipInfo.090", { p1: fmt(arm) })
  return tr("ui.shipInfo.091", { p1: fmt(hul) })
}

/**
 * **按层组合给出"值文本"**（**2026-09-29 船长令**：修理类装备的数值显示统一）。
 * `arm`/`hul` 已由调用方算好（基础值或实修值），本函数只负责挑形状：
 * `各 N 点` / `装甲 N 点` / `结构 N 点`（英文 `N each` / `armor N` / `structure N`）。
 * ⚠ 与 `repairAmountText` **同一条形状规则**（那边是基础值的整句版，这边是层组合的短版）——
 * 新增层组合时两处一起改。
 */
export function repairLayerText(arm: number, hul: number): string {
  if (arm > 0 && hul > 0) return arm === hul ? tr('ui.shipInfo.215', { p1: fmt(arm) }) : `${tr('ui.shipInfo.216', { p1: fmt(arm) })} / ${tr('ui.shipInfo.217', { p1: fmt(hul) })}`
  if (arm > 0) return tr('ui.shipInfo.216', { p1: fmt(arm) })
  return tr('ui.shipInfo.217', { p1: fmt(hul) })
}

/**
 * **装上船之后的实修值一行**（**2026-09-29 船长令**：「当装备到船上后，显示实际维修值：
 * 每 5 秒修复装甲与结构各 XX（10）点。XX 为加成后的修理值」）。
 *
 * - `XX` = `core.repairStatsFor` 现算的**该台自己那一份**每跳（船长同日三选一：按单台，不按全舰合计）；
 * - 括号里 = 装备卡上的**基础值**；
 * - **只对"已装上船"的卡出这一行**（同一问：仓库/市场/手册不上船 ⇒ 仍只显示基础值）。
 * - 多台同族时按**位序**取该台那一份（第 2 台吃 87% 衰减，与 `preloadRepairFor` 同源）。
 */
export function fittedRepairLine(engine: GameEngine, shipId: string, mod: ModuleDef): InfoLine | null {
  const stats = repairStatsFor(engine.state, engine.ctx, shipId)
  if (!stats) return null
  const idx = fittedRepairModules(engine.state, engine.ctx, shipId).findIndex((d) => d.id === mod.id)
  const u = idx >= 0 ? stats.units[idx] : undefined
  if (!u) return null
  return {
    k: tr('ui.shipInfo.059'),
    v: tr('ui.shipInfo.214', {
      p1: repairLayerText(u.armorPerPulse, u.hullPerPulse),
      p2: repairLayerText(mod.repairArmorHp ?? 0, mod.repairHullHp ?? 0),
    }),
  }
}

/**
 * **多装递减装备的「有效值（原值）」一行**（**2026-09-29 船长令**：「之后所有多装递减的装备，
 * 能否采用和维修装置类似的 '真实数值（原始数值）' 这样的方式标注参数？」）——
 * 与 `fittedRepairLine` 同一形状与同一纪律：**只对"已装上船"的卡出这一行**（仓库/市场/手册不上船 ⇒ 只见原值）；
 * 数值一律走 core 单点 `fittedEffectParamsOf`（折权族 = 本件那一份；缺口族 = 装上后的合成值）。
 *
 * 显示形：折权族 `速度 +26%（原 +30%）` · 缺口族 `动能抗性 47%（本件 +20%）`；多字段用 ` · ` 连。
 */
export function fittedDecayLine(engine: GameEngine, shipId: string, mod: ModuleDef, ordinal = 1): InfoLine | null {
  const params = fittedEffectParamsOf(engine.state, engine.ctx, shipId, mod, ordinal)
  if (params.length === 0) return null
  const isGap = stackingOf(mod).group === 'gap'
  // ⟪文案调整 2026-10-23⟫ 支援件按效果显示，插件固定量保留对应单位。
  const parts = params.map((p) => {
    const name = p.key.startsWith('damage:') || p.key.startsWith('range:')
      ? `${DMG_LABEL[p.key.split(':')[1] as DamageType]} ${tr(p.key.startsWith('damage:') ? 'ui.shipInfo.071' : 'ui.shipInfo.082')}`
      : tr(EFF_PARAM_LABEL[p.key] ?? 'ui.shipInfo.218')
    const value = (v: number) => p.key === 'laserFalloff' ? `+${Number(v.toFixed(3))}`
      : ['speedAddMps', 'speedPenaltyMps'].includes(p.key) ? `${fmt(Number((p.key === 'speedPenaltyMps' ? -v : v).toFixed(2)))} m/s`
        : p.key === 'droneBayBonusM3' ? `${fmt(Number(v.toFixed(2)))} m³`
          : ['shieldHpAdd', 'armorHpAdd', 'hullHpAdd', 'cpuPenalty'].includes(p.key) ? fmt(Number((p.key === 'cpuPenalty' ? -v : v).toFixed(2)))
      : p.key === 'shieldPulse' || p.key === 'shieldField' ? recoveryPct(v) : pct(v)
    const eff = value(p.eff)
    const raw = isGap && !p.key.endsWith('Penalty') ? tr('ui.shipInfo.220', { p1: value(p.raw) }) : tr('ui.shipInfo.221', { p1: value(p.raw) })
    return `${name} ${eff}${raw}`
  })
  return { k: tr('ui.shipInfo.222'), v: parts.join(' · ') }
}

/** 效果字段 → 行内短名（`fittedDecayLine` 用；缺省走 `ui.shipInfo.218`「效果」） */
export const EFF_PARAM_LABEL: Record<string, string> = {
  reload: 'ui.shipInfo.043',
  shieldHpAdd: 'ui.FitPage.001',
  armorHpAdd: 'ui.FitPage.003',
  hullHpAdd: 'ui.shipInfo.066',
  damageBonusPct: 'ui.shipInfo.071',
  hitBonusPct: 'ui.shipInfo.227',
  plugRangeBonusPct: 'ui.shipInfo.082',
  speedAddMps: 'ui.shipInfo.223',
  speedPenaltyMps: 'ui.shipInfo.017',
  cargoCapacityBonusPct: 'ui.Handbook.010',
  droneBayBonusM3: 'ui.FitPage.010',
  cpuPenalty: 'ui.Handbook.030',
  speed: 'ui.shipInfo.223',
  droneRange: 'ui.shipInfo.224',
  droneLaunch: 'ui.launchCalibration.004',
  laserFalloff: 'ui.launchCalibration.005',
  shieldPulse: 'ui.shipInfo.225',
  shieldField: 'ui.shipInfo.226',
  hit: 'ui.shipInfo.227',
  lock: 'ui.shipInfo.228',
  warp: 'ui.shipInfo.229',
  ecmRangeCut: 'ui.shipInfo.230',
  reloadPenalty: 'ui.shipInfo.072',
  speedPenalty: 'ui.shipInfo.075',
  rangePenalty: 'ui.shipInfo.070',
  hitPenalty: 'ui.shipInfo.021',
  resistPenalty: 'ui.shipInfo.073',
  evasion: 'ui.shipInfo.231',
  'resistShield:kinetic': 'ui.shipInfo.232',
  'resistShield:explosive': 'ui.shipInfo.233',
  'resistShield:plasma': 'ui.shipInfo.234',
  'resistArmor:kinetic': 'ui.shipInfo.235',
  'resistArmor:explosive': 'ui.shipInfo.236',
  'resistArmor:plasma': 'ui.shipInfo.237',
}

/** 维修件消耗的组件名（接线单点：repairKit → 物品名） */export function repairKitName(mod: ModuleDef): string {
  return mod.repairKit === 'repairkit-mil' ? tr("ui.shipInfo.002") : mod.repairKit === 'repairkit-civ' ? tr("ui.shipInfo.003") : (mod.repairKit ?? tr('ui.itemSubs.001'))
}

/**
 * 维修系短缀（维修装置 / 异形无消耗自愈件）：每跳修复量与"是否吃组件"。
 * 2026-09-10 修：此前短效文案没有修复分支 → 民用/军用维修装置与生体损管腔在
 * 装配台槽位行、装备库行、手册网格里只剩"名字 + CPU"，玩家看不到它到底修多少。
 */
export function repairShortText(mod: ModuleDef): string {
  const arm = mod.repairArmorHp ?? 0
  const hul = mod.repairHullHp ?? 0
  if (arm <= 0 && hul <= 0) return ''
  const secs = ((mod.repairIntervalMs ?? 5_000) / 1_000).toFixed(0)
  const amt = [arm > 0 ? tr("ui.shipInfo.092", { p1: fmt(arm) }) : '', hul > 0 ? tr("ui.shipInfo.093", { p1: fmt(hul) }) : ''].filter(Boolean).join(' / ')
  return tr("ui.shipInfo.094", { secs: secs, amt: amt, p3: mod.repairFree === true ? tr("ui.shipInfo.004") : tr("ui.shipInfo.005") })
}

/**
 * **打捞周期秒数**（短行与详情面板共用单点；缺省 10 秒与 `core/salvaging.ts` 的 `?? 10_000` 同源）。
 * 为什么抽出来：2026-09-14 修「卡片没有说明」时发现**详情面板写了、短行漏了**——同一口径两处各写一遍就会漂。
 */
export function salvageCycleSecs(mod: ModuleDef): string {
  return ((mod.salvageCycleMs ?? 10_000) / 1000).toFixed(0)
}

/**
 * **无人机储备甲板的复位周期（秒）**（2026-09-27 船长令）——与 `salvageCycleSecs` 同款：
 * 从 `droneReviveCycleMs` 现算、**不在文案里手写数字**（甲案）。
 */
export function reviveCycleSecs(mod: ModuleDef): string {
  return ((mod.droneReviveCycleMs ?? 14_000) / 1000).toFixed(0)
}

/** 结构层抗性短缀（任何槽位都可能带）：`结构抗 动能+25% 爆炸+25% 能量+25%` */
export function hullResistShortText(mod: ModuleDef): string {
  const bits = (['kinetic', 'explosive', 'plasma'] as const)
    .filter((t) => (mod.hullResistAdd?.[t] ?? 0) > 0)
    .map((t) => `${DMG_LABEL[t]}+${pct(mod.hullResistAdd![t]!)}`)
  return bits.length > 0 ? tr("ui.shipInfo.095", { p1: bits.join(' ') }) : ''
}

/**
 * 装备一行式短效果（装配台槽位行 / 装备库行共用；V17：各战斗家族显示真实进公式参数）。
 * 空槽文本由调用方自给；抗性为"缺口削减"值（合成规则见 moduleInfoLines 注释行）。
 */
/** 炮台配弹文本（V17.2 炮族：固定弹种）
 *  ⚠ 2026-09-16 弹药定名批：弹药名统一到《系+弹药》⇒ 这里的后缀是「弹药」（原「弹」）。 */
export function turretAmmoText(mod: ModuleDef): string {
  const type = DMG_LABEL[mod.damageType ?? 'kinetic'] ?? mod.damageType
  return tr("ui.shipInfo.096", { type: type })
}

/** 三系抗性紧凑文本（整数主抗制简化后只列非零项；全零 = "无"） */
export function resistsText(r: DamageResists | undefined): string {
  const parts = (['kinetic', 'explosive', 'plasma'] as const)
    .map((t) => ({ t, v: r?.[t] ?? 0 }))
    .filter((x) => x.v > 0)
  if (parts.length === 0) return tr("ui.BattleScreen.001")
  return parts.map((x) => `${DMG_LABEL[x.t]} ${pct(x.v)}`).join(' · ')
}

/** 跃迁充能速率（派生展示）：动力(agility)越高充能越快 = agility×200%（0.5 → 100% 基准）。
 *  2026-09-26 船长：间接属性里「动力」就排在充能上一行 ⇒ 标签去括号只叫「跃迁充能」。 */
export function warpChargePct(ship: ShipDef): number | null {
  if (ship.agility === undefined || !Number.isFinite(ship.agility)) return null
  return Math.round(ship.agility * 200)
}

/** 槽位布局文本（V18：高/中/低 × 数量制复数安装——取代旧六槽单件列表） */
export function slotListText(ship?: ShipDef): string {
  if (ship) {
    const s = shipSlotsOf(ship)
    return tr("ui.shipInfo.122", { p1: rackText('high'), p2: s.high, p3: rackText('mid'), p4: s.mid, p5: rackText('low'), p6: s.low })
  }
  return MODULE_SLOTS.map((m) => slotText(m)).join(' · ')
}
