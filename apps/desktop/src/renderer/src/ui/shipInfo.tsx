/**
 * V10.5/V10.5b + V17 统一舰船/装备属性展示模块（装配页 / 舰船悬停 / 手册图鉴共用同一数据源与渲染）。
 *
 * 设计（中文说明）：
 * - 所有"舰船战斗数值"只在这里生成一次：装配页当前船、各页面舰船悬停浮层、图鉴详情窗
 *   统一调用——将来引擎启用战斗数值或新增字段，只改这一处；
 * - V16.1：抗性简化（整数主抗制：每层至多一个主抗型，信息行只列非零项，其余 = 0 易心算）；
 * - V16.1：删除废弃展示（锁定目标数/起跳时间），"跃迁充能（随动力）"由 agility 派生展示；
 * - V17：装备行不再显示笼统百分比——各家族渲染"真实进公式的参数"（模块短效果/武器卡/
 *   缺口抗性/加力推进），抗性合成为 EVE 式缺口乘入（见 moduleInfoLines 说明行）；
 * - 间接属性（速度/跃迁/质量/锁定/信号，V10.5b 保留项）：装配界面用 `shipIndirectLines` 成组显示；
 *   **2026-09-12 船长「手册图鉴里的舰船信息可以查看舰船的间接属性」** ⇒ 图鉴（手册·舰船/舰船蓝图详情）
 *   同样追加这组行；悬停浮层仍不显示（浮层空间有限，保持原有克制）。
 * - 无人机生存包等未落地内容仍标注"契约"。
 */
import type { ElementType, ReactNode } from 'react'
import type { AnomalyDef, DamageResists, ItemDef, ModuleDef, ModuleSlot, ShipDef, DamageType } from '@whale/core'
import { DEFAULT_BALANCE, foeDamageComposition, ITEM_KIND_LABELS, itemKindText, MODULE_SLOTS, RACK_LABELS, rackOf, shipSlotsOf, SLOT_LABELS, shipCategoryLabelOf, shipSizeLabel, stackingOf, layerMultText, beamPowerFactor, thrusterCycleOfModule, thrusterCycleText, thrusterCycleFullText, SHIELD_PULSE_MS } from '@whale/core'
import { hoverTipProps } from './Tooltip'
import { tr } from '../i18n/locale'

/** 伤害类型中文名 */
export const DMG_LABEL: Record<DamageType, string> = { kinetic: tr("ui.BattleScreen.002"), explosive: tr("ui.battleViewCore.001"), plasma: tr("ui.battleViewCore.002") }

/**
 * 伤害类型色 chip（V17.2 快速辨识）：颜色 = 我方三层血量色——
 * 动能 = 盾蓝（拆盾 ×1.5）/ 高爆 = 甲红（破甲 ×1.5）/ 能量 = 结构黄（拆盾 ×1.25）。
 * label 可覆盖文字（如弹药全词"动能弹"），底色仍按类型。
 * 悬停显示与 combat.typeLayerMult 同源的克制矩阵（2026-09-05 船长）。
 */
export function DmgChip({ t, label }: { t: DamageType; label?: ReactNode }): ReactNode {
  return (
    <span className={`app-d-chip app-d-${t}`} title={`${DMG_LABEL[t]}：${layerMultText(t)}`}>
      {label ?? DMG_LABEL[t]}
    </span>
  )
}

/** 敌型色 chip：盾厚 = 盾蓝 / 甲厚 = 甲红 / 均衡 = 结构黄（与血量层色同源） */
export function ProfileChip({ profile, text }: { profile: 'shield' | 'armor' | 'balanced'; text: string }): ReactNode {
  return <span className={`app-d-chip app-p-${profile}`}>{text}</span>
}

/** 一行键值信息 */
export interface InfoLine {
  k: string
  v: ReactNode
}

const fmt = (n: number | undefined): string => (n === undefined || !Number.isFinite(n) ? '—' : n.toLocaleString('zh-CN'))
const pct = (n: number): string => `${Math.round(n * 100)}%`
const pctOpt = (n: number | undefined): string => (n === undefined || !Number.isFinite(n) ? '—' : pct(n))

/** 射程带紧凑文本（如 "250 m ~ 4.2 km"；min 为 0 时省略近端） */
function rangeText(minM: number | undefined, maxM: number | undefined): string {
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
function resistAddLine(k: string, add: DamageResists | undefined): InfoLine | null {
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
 *  秒数不再写死，改由 core `thrusterCycleFullText()` 取值（与引擎同源）；
 *  **2026-09-14 起按件取值**：件自带覆盖（微型跃迁引擎 = 10 秒点火 / 60 秒冷却）时以件为准） */
function propTailOf(mod: ModuleDef): string {
  return `（${thrusterCycleFullText(DEFAULT_BALANCE.battle, thrusterCycleOfModule(mod))}）`
}
/** 维修件的每跳修复量文本（跨族行与主分支共用，防两处口径漂移） */
function repairAmountText(mod: ModuleDef): string {
  const arm = mod.repairArmorHp ?? 0
  const hul = mod.repairHullHp ?? 0
  if (arm > 0 && hul > 0) return arm === hul ? tr("ui.shipInfo.088", { p1: fmt(arm) }) : tr("ui.shipInfo.089", { p1: fmt(arm), p2: fmt(hul) })
  if (arm > 0) return tr("ui.shipInfo.090", { p1: fmt(arm) })
  return tr("ui.shipInfo.091", { p1: fmt(hul) })
}
/** 维修件消耗的组件名（接线单点：repairKit → 物品名） */
function repairKitName(mod: ModuleDef): string {
  return mod.repairKit === 'repairkit-mil' ? tr("ui.shipInfo.002") : mod.repairKit === 'repairkit-civ' ? tr("ui.shipInfo.003") : (mod.repairKit ?? tr('ui.itemSubs.001'))
}

/**
 * 维修系短缀（维修装置 / 异形无消耗自愈件）：每跳修复量与"是否吃组件"。
 * 2026-09-10 修：此前短效文案没有修复分支 → 民用/军用维修装置与生体损管腔在
 * 装配台槽位行、装备库行、手册网格里只剩"名字 + CPU"，玩家看不到它到底修多少。
 */
function repairShortText(mod: ModuleDef): string {
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
function salvageCycleSecs(mod: ModuleDef): string {
  return ((mod.salvageCycleMs ?? 10_000) / 1000).toFixed(0)
}

/** 结构层抗性短缀（任何槽位都可能带）：`结构抗 动能+25% 爆炸+25% 能量+25%` */
function hullResistShortText(mod: ModuleDef): string {
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

/** 短效文案（装配台槽位行 / 装备库行 / 手册网格共用；V18.1 收敛件尾注"多装递减"） */
export function moduleShortEffect(mod: ModuleDef): string {
  let body = ''
  switch (mod.slot) {
    case 'miner':
      body = tr("ui.shipInfo.097", { p1: pctOpt(mod.bonus) })
      break
    case 'cargo':
      body = tr("ui.shipInfo.098", { p1: pctOpt(mod.bonus) })
      break
    case 'turret': {
      body = tr("ui.shipInfo.099", { p1: turretAmmoText(mod), p2: rangeText(mod.minRangeM, mod.maxRangeM) })
      break
    }
    case 'missile': {
      // V18B-1 导弹架：爆炸系武器形态（爆破弹药，近盲安全射距 + 追踪命中）
      body = tr("ui.shipInfo.100", { p1: rangeText(mod.minRangeM, mod.maxRangeM) })
      break
    }
    case 'laser': {
      // V18B-2 激光炮：能量系武器形态（能量弹药 · 必中 · 威力随距离轻微衰减）
      body = tr("ui.shipInfo.101", { p1: rangeText(mod.minRangeM, mod.maxRangeM) })
      break
    }
    case 'shield-field': {
      /**
       * 护盾充能力场装置（2026-09-20 船长）：**高槽 · 护盾族**。
       * 短行必须自己一支 —— 与中槽 `shield` 那条（「每 N 秒回盾 x（按满盾）」）不同：
       * 本件**全队受益**、且**冷却按件自带**（`mod.shieldFieldMs`，不写死 30 秒）。
       */
      const parts: string[] = []
      const ms = mod.shieldFieldMs ?? 0
      if ((mod.shieldFieldPct ?? 0) > 0 && ms > 0) {
        parts.push(tr("ui.shipInfo.181", { p1: Math.round(ms / 1000), p2: pct(mod.shieldFieldPct ?? 0) }))
      }
      body = parts.join(' · ')
      break
    }
    case 'shield': {
      const parts: string[] = []
      if (mod.shieldHpBonus !== undefined) parts.push(tr("ui.shipInfo.102", { p1: pct(mod.shieldHpBonus) }))
      const gap = resistGapText(mod.shieldResistAdd)
      if (gap) parts.push(gap)
      // 2026-09-14 护盾充能装置（船长：「每 30 秒恢复自身护盾最大值一定比例的护盾量」）：
      // ⚠ 它只有 `shieldPulsePct` 一个效果字段，原先短行**拼出空串**（船长报障「装配时候的卡片上没有说明」）
      // —— 秒数取 core 单点 `SHIELD_PULSE_MS`，不写死 30。
      if ((mod.shieldPulsePct ?? 0) > 0) {
        parts.push(tr("ui.shipInfo.103", { p1: SHIELD_PULSE_MS / 1000, p2: pct(mod.shieldPulsePct ?? 0) }))
      }
      body = parts.join(' · ')
      break
    }
    case 'armor': {
      const parts: string[] = []
      if (mod.armorHpBonus !== undefined) parts.push(tr("ui.shipInfo.104", { p1: pct(mod.armorHpBonus) }))
      const gap = resistGapText(mod.armorResistAdd)
      if (gap) parts.push(gap)
      // 结构层容量（E 族巨构骨架）：短行也要看得见"最后那段血更厚"
      if ((mod.hullHpBonus ?? 0) > 0) parts.push(tr("ui.shipInfo.105", { p1: pct(mod.hullHpBonus ?? 0) }))
      // 2026-09-10 船长：重甲件的机动代价（陵寝装甲层 −25%）——短行也带代价（同推进器「命中×0.85」写法）
      if ((mod.speedPenaltyPct ?? 0) > 0) parts.push(tr("ui.shipInfo.106", { p1: (1 - (mod.speedPenaltyPct ?? 0)).toFixed(2) }))
      body = parts.join(' · ')
      break
    }
    case 'propulsion': {
      // 2026-09-11 船长：「推进器现在有持续时间和冷却时间，这点希望在推进器的说明内讲清」——
      // 短行（换装卡 / 装备库行 / 手册网格）此前只有「速度 +X% · 命中×Y」，看不出是**周期**爆发，
      // 补周期缀（秒数同源于 balance.battle，见 core thrusterCycleText；**2026-09-14 起按件取值**：
      // 件自带覆盖（微型跃迁引擎 10 秒点火）时以件为准）
      const parts: string[] = []
      if (mod.speedBonusPct !== undefined)
        parts.push(tr("ui.shipInfo.107", { p1: pct(mod.speedBonusPct), p2: thrusterCycleText(DEFAULT_BALANCE.battle, thrusterCycleOfModule(mod)) }))
      if (mod.hitPenalty !== undefined && mod.hitPenalty > 0) parts.push(tr("ui.shipInfo.108", { p1: (1 - mod.hitPenalty).toFixed(2) }))
      body = parts.join(' · ')
      break
    }
    case 'drone-rack':
      body = tr("ui.shipInfo.109", { p1: fmt(mod.droneBayBonusM3) })
      break
    case 'salvager':
      // 2026-09-14 补（与护盾充能装置同批查出）：**打捞器短行此前也是空的**——本模板**漏了 salvager 这个槽位分支**
      body = tr("ui.shipInfo.110", { p1: salvageCycleSecs(mod) })
      break
    case 'drone-tac':
      body = tr("ui.shipInfo.111", { p1: pctOpt(mod.droneDmgBonus) })
      break
    case 'drone-relay':
      // 2026-09-10 无人机中继天线：放飞无人机射程加成
      body = tr("ui.shipInfo.112", { p1: pctOpt(mod.droneRangeBonusPct) })
      break
    case 'support': {
      // V18.1 支援件：效果字段判别（稳定器按系可多件 → 逐系列出）
      const dmg = mod.damageTypeBonusPct
      if (dmg && Object.keys(dmg).length > 0) {
        body = Object.entries(dmg)
          .filter(([, v]) => (v ?? 0) > 0)
          .map(([t, v]) => tr("ui.shipInfo.113", { p1: DMG_LABEL[t as DamageType], p2: pct(v ?? 0) }))
          .join(' + ')
      } else if (mod.reloadCutPct !== undefined) {
        body = tr("ui.shipInfo.114", { p1: pct(mod.reloadCutPct) })
      } else if (mod.hitBonusPct !== undefined) {
        body = tr("ui.shipInfo.115", { p1: pct(mod.hitBonusPct) })
      } else if (mod.evasionGapPct !== undefined) {
        body = tr("ui.shipInfo.116", { p1: pct(mod.evasionGapPct) })
      } else if (mod.warpSpeedBonusPct !== undefined) {
        // 2026-09-14 跃迁计算机（低槽支援件）：只缩短**星系际航行**时间，不碰战斗机动
        body = tr("ui.shipInfo.117", { p1: pct(mod.warpSpeedBonusPct) })
      } else if (mod.stealthMs !== undefined) {
        // 2026-09-15 隐秘行动装置（高槽支援件）：开火前隐身——短行必须写明"开火即现形"与推进器禁令
        body = tr("ui.shipInfo.118", { p1: mod.stealthMs / 1000 })
      }
      break
    }
    case 'target-lock':
      // 2026-09-09 目标锁定阵列：集火首位 + 目标受击加深；**2026-09-17 船长：增伤与集火都改「全队生效」**
      body = tr("ui.shipInfo.119", { p1: pctOpt(mod.lockDmgBonus) })
      break
    case 'cpu':
      // 2026-09-11 协处理器：装配 CPU 预算扩容（本件自身不占 CPU——说清，否则玩家会以为要占 0 是 bug）
      body = tr("ui.shipInfo.120", { p1: fmt(mod.cpuBonus) })
      break
  }
  // 任何槽位统一尾缀：维修系（每跳修多少/吃不吃组件）、结构层抗性与**跨族加成**——短行不丢关键效果
  // （跨族尾缀 = 2026-09-11 修复：赃物强化舱的"甲容 +15%"这类搭车加成因槽位分支而漏显示）
  const extras = [repairShortText(mod), hullResistShortText(mod), crossFamilyShort(mod)].filter(Boolean).join(' · ')
  if (extras) body = body ? `${body} · ${extras}` : extras
  // V18.1：收敛件（抗性/闪避 = 缺口复合、命中/速度 = EVE 曲线）尾注"多装递减"；
  // 2026-09-15 隐秘行动装置（`max` 组）= **取最长一件、不叠加** ⇒ 既不标"多装递减"也不标"全额叠加"。
  const stShort = stackingOf(mod).group
  return body + (stShort === 'flat' || stShort === 'max' ? '' : tr('ui.shipInfo.179'))
}

/** 三系抗性紧凑文本（整数主抗制简化后只列非零项；全零 = "无"） */
export function resistsText(r: DamageResists | undefined): string {
  const parts = (['kinetic', 'explosive', 'plasma'] as const)
    .map((t) => ({ t, v: r?.[t] ?? 0 }))
    .filter((x) => x.v > 0)
  if (parts.length === 0) return tr("ui.BattleScreen.001")
  return parts.map((x) => `${DMG_LABEL[x.t]} ${pct(x.v)}`).join(' · ')
}

/**
 * 敌方**火力构成**（2026-09-10 船长：混伤——「需要在任务中告知玩家」）：
 * 单系 = 一个色 chip；两系 = 逐系 chip + 百分比（常驻悬赏 80%/20%、窝点 60%/40%）。
 * 数据源 = core 单点 `foeDamageComposition`（与战斗结算、胜率预估同源，卡面不会与实战脱节）。
 */
export function FoeDamageMix({ anomaly }: { anomaly: AnomalyDef }): ReactNode {
  const comp = foeDamageComposition(anomaly)
  if (comp.length <= 1) return <DmgChip t={comp[0]?.type ?? 'kinetic'} />
  return (
    <>
      {comp.map((c, i) => (
        <span key={c.type} className="app-stack-inline">
          {i > 0 ? <span className="app-dim"> · </span> : null}
          <DmgChip t={c.type} />
          <span className="app-dim">{` ${Math.round(c.share * 100)}%`}</span>
        </span>
      ))}
    </>
  )
}

/** 跃迁充能速率（派生展示）：动力(agility)越高充能越快 = agility×200%（0.5 → 100% 基准） */
export function warpChargePct(ship: ShipDef): number | null {
  if (ship.agility === undefined || !Number.isFinite(ship.agility)) return null
  return Math.round(ship.agility * 200)
}

/** 装后覆盖（装配页把徽章数值/抗性换成 createPlayerSpec 合成快照；其它调用点不传 = 船体基础值） */
export interface BadgeOver {
  hp?: { s: number; a: number; h: number }
  resists?: { shield?: DamageResists; armor?: DamageResists; hull?: DamageResists }
}

/** 层位血量徽章（盾/甲/结构），悬停 title 显示该层三系抗性 */
function layerBadge(
  key: string,
  cls: string,
  label: string,
  hp: number | undefined,
  resist: DamageResists | undefined,
): ReactNode {
  const hasResist = resist !== undefined && Object.values(resist).some((v) => (v ?? 0) > 0)
  return (
    <span key={key} className={`app-combat-badge ${cls}`} title={hasResist ? tr("ui.shipInfo.121", { p1: resistsText(resist) }) : undefined}>
      {label} {fmt(hp)}
    </span>
  )
}

/**
 * 三层血量徽章（盾/甲/结构），各行其色。火力增幅不进徽章组（船长 2026-09-05：不应与血量并列，
 * 由属性表"火力加成"行展示）。over = 装配页装后覆盖（血量/抗性换成含装备合成值）。
 */
export function combatBadges(ship: ShipDef, over?: BadgeOver): ReactNode[] {
  const hp = over?.hp
  const res = over?.resists
  return [
    layerBadge('s', 'is-shield', tr("ui.FitPage.014"), hp?.s ?? ship.shieldHp, res?.shield ?? ship.shieldResist),
    layerBadge('a', 'is-armor', tr("ui.FitPage.015"), hp?.a ?? ship.armorHp, res?.armor ?? ship.armorResist),
    layerBadge('h', 'is-hull', tr("ui.ShipPage.023"), hp?.h ?? ship.hullHp, res?.hull ?? ship.hullResist),
  ]
}

/** 槽位布局文本（V18：高/中/低 × 数量制复数安装——取代旧六槽单件列表） */
export function slotListText(ship?: ShipDef): string {
  if (ship) {
    const s = shipSlotsOf(ship)
    return tr("ui.shipInfo.122", { p1: RACK_LABELS.high, p2: s.high, p3: RACK_LABELS.mid, p4: s.mid, p5: RACK_LABELS.low, p6: s.low })
  }
  return MODULE_SLOTS.map((m) => SLOT_LABELS[m]).join(' · ')
}

/** 舰船统一信息行：基础 + V10.5b 面板分组（护盾/装甲/结构区块各自血量与三系抗性；CPU/无人机舱） */
export function shipInfoLines(ship: ShipDef): InfoLine[] {
  const lines: InfoLine[] = [
    {
      k: tr("ui.Handbook.009"),
      // 2026-09-13 船长：**舰种子分类进界面**（只有虫洞族专属舰船写 `subClass`）
      // 2026-09-16 船长：类别名走 `shipCategoryLabelOf`（装甲线 = `role: armored` 或武装舰里装甲占比 > 护盾占比）
      v: `${ship.subClass ? `${ship.subClass} · ` : ''}${shipCategoryLabelOf(ship)} · ${shipSizeLabel(ship.tier)} T${ship.tier}`,
    },
    // 2026-09-13 船长点名的三条**船体固有新机制**（只虫洞族专属舰船有；没有就不占行）
    ...(() => {
      const bits: string[] = []
      const rangeText = Object.entries(ship.weaponRangeBonusPct ?? {})
        .map(([t, v]) => tr("ui.shipInfo.123", { p1: DMG_LABEL[t as keyof typeof DMG_LABEL] ?? t, p2: Math.round((v ?? 0) * 100) }))
        .join(' · ')
      if (rangeText) bits.push(rangeText)
      if (ship.fleetDamageBonusPct) bits.push(tr("ui.shipInfo.124", { p1: Math.round(ship.fleetDamageBonusPct * 100) }))
      if (ship.wormholeScanRadiusBonus) bits.push(tr("ui.shipInfo.125", { p1: ship.wormholeScanRadiusBonus }))
      // 2026-09-16 船长：后勤舰特性进「船体特性」栏（判据已由 `subClass` 改为数据字段，界面与引擎同源）
      if (ship.repairPulseTargetsFleet) bits.push(tr("ui.shipInfo.126"))
      // 2026-09-16 船长：**侦察舰特性**（「隐秘行动装置所需CPU降低50%，且移除推进器失效惩罚」）——
      // 同样走数据字段 ⇒ 引擎（`equipment.cpuUseOf` / `combat.createPlayerSpec`）与这里同源
      if (ship.stealthCpuMul !== undefined && ship.stealthCpuMul !== 1) {
        bits.push(tr("ui.shipInfo.127", { p1: ship.stealthCpuMul }))
      }
      if (ship.stealthIgnoresPropulsion === true) bits.push(tr("ui.shipInfo.128"))
      // 2026-09-18 船长：**电子舰特性 · 压制敌舰武器射程**（多艘乘法叠加 · 与敌方增程做加法 · 下限 3000m）
      if ((ship.foeRangeDebuffPct ?? 0) > 0) {
        bits.push(
          tr("ui.shipInfo.129", { p1: Math.round((ship.foeRangeDebuffPct ?? 0) * 100) }),
        )
      }
      return bits.length > 0 ? [{ k: tr("ui.shipInfo.006"), v: bits.join(' · ') }] : []
    })(),
    { k: tr("ui.Handbook.010"), v: `${fmt(ship.cargoM3)} m³` },
    { k: tr("ui.Handbook.011"), v: tr("ui.shipInfo.130", { p1: ship.cycleSeconds, p2: ship.oreUnitsPerCycle }) },
    { k: tr("ui.Handbook.012"), v: `${Math.round(ship.agility * 100)}%` },
  ]
  const hasCombat = (ship.shieldHp ?? 0) > 0 || (ship.armorHp ?? 0) > 0 || (ship.hullHp ?? 0) > 0
  if (hasCombat) {
    lines.push({ k: tr("ui.FitPage.001"), v: fmt(ship.shieldHp) })
    lines.push({ k: tr("ui.FitPage.002"), v: resistsText(ship.shieldResist) })
    lines.push({ k: tr("ui.FitPage.003"), v: fmt(ship.armorHp) })
    lines.push({ k: tr("ui.FitPage.004"), v: resistsText(ship.armorResist) })
    lines.push({ k: tr("ui.ShipPage.023"), v: fmt(ship.hullHp) })
    lines.push({ k: tr("ui.FitPage.005"), v: resistsText(ship.hullResist) })
    if (ship.powerBonus !== undefined && ship.powerBonus > 0) {
      lines.push({ k: tr("ui.shipInfo.007"), v: `+${Math.round(ship.powerBonus * 100)}%` })
    }
    // 船体武器族加成（2026-09-09 船长拍板：四族巡洋分型 EVE 式族加成）——本族武器单发加成、跨族可用无加成
    if (ship.weaponFamilyBonus !== undefined) {
      for (const [t, v] of Object.entries(ship.weaponFamilyBonus)) {
        if ((v ?? 0) > 0) {
          lines.push({
            k: tr("ui.shipInfo.008"),
            v: (
              <>
                <DmgChip t={t as DamageType} label={tr("ui.shipInfo.131", { p1: DMG_LABEL[t as DamageType] })} />
                <span className="app-dim">{` 本族武器单发 +${pct(v ?? 0)}（装别族武器无加成）`}</span>
              </>
            ),
          })
        }
      }
    }
    // V16.1：命中加成/回避率上主属性（装配台主要属性区内可见）
    if (ship.hitBonus !== undefined) lines.push({ k: tr("ui.FitPage.006"), v: `+${Math.round(ship.hitBonus * 100)}%` })
    if (ship.evasion !== undefined) lines.push({ k: tr("ui.FitPage.007"), v: `${Math.round(ship.evasion * 100)}%` })
  }
  lines.push({ k: tr("ui.Handbook.008"), v: slotListText(ship) })
  if (ship.cpu !== undefined) lines.push({ k: 'CPU', v: fmt(ship.cpu) })
  lines.push({ k: tr("ui.FitPage.010"), v: ship.droneBayM3 ? `${fmt(ship.droneBayM3)} m³` : tr("ui.BattleScreen.001") })
  return lines
}

/**
 * 间接属性行（速度/跃迁/质量/锁定/信号）：显示优先级低——仅装配界面使用。
 *
 * `effWarp`（2026-09-14 跃迁计算机）：装配页把手算好的**有效跃迁速度**（含装备加成）传进来
 * ⇒ 该行显示「基础 → 有效（含装备 +X%）」；**不传 = 显示船表基础值**（图鉴/船型档案那条路
 * 没有存档上下文，读数仍是档案值）。
 */
export function shipIndirectLines(ship: ShipDef, effWarp?: { aus: number; bonusPct: number }): InfoLine[] {
  const lines: InfoLine[] = []
  if (ship.maxSpeedMps !== undefined) lines.push({ k: tr("ui.shipInfo.009"), v: `${fmt(ship.maxSpeedMps)} m/s` })
  if (ship.warpSpeedAus !== undefined) {
    const base = ship.warpSpeedAus
    const boosted = effWarp !== undefined && effWarp.bonusPct > 0 && Math.abs(effWarp.aus - base) > 1e-6
    lines.push({
      k: tr("ui.shipInfo.010"),
      v: boosted ? tr("ui.shipInfo.132", { base: base, p2: effWarp.aus.toFixed(2), p3: pct(effWarp.bonusPct) }) : `${base} AU/s`,
    })
  }
  if (ship.massKg !== undefined) lines.push({ k: tr("ui.shipInfo.011"), v: tr("ui.shipInfo.133", { p1: (ship.massKg / 1_000_000).toFixed(1) }) })
  if (ship.lockRangeM !== undefined) lines.push({ k: tr("ui.shipInfo.012"), v: `${(ship.lockRangeM / 1000).toFixed(0)} km` })
  if (ship.signatureM !== undefined) lines.push({ k: tr("ui.shipInfo.013"), v: `${fmt(ship.signatureM)} m` })
  if (ship.scanResMm !== undefined) lines.push({ k: tr("ui.shipInfo.014"), v: `${fmt(ship.scanResMm)} mm` })
  // V16.1：跃迁充能（派生自动力 agility，动力越高充能越快；取代旧"起跳时间"）
  const charge = warpChargePct(ship)
  if (charge !== null) lines.push({ k: tr("ui.shipInfo.015"), v: `${charge}%` })
  return lines
}

/**
 * 跨族加成（2026-09-11 船长反馈修复：「赃物强化舱的属性并没有显示装甲容量的加成数值」）：
 *
 * 起因：模块信息行 / 短效文案原先都按 `mod.slot` 走分支渲染（装甲槽只画装甲、货舱槽只画货舱……），
 * 于是**槽位族之外的加成会被整段吞掉**——赃物强化舱是**货舱槽**却带 `armorHpBonus 0.15`（货舱 +100%
 * 的"搭车"装甲板），界面上就只剩货舱那一行。同类还有：生体甲壳板（装甲槽带自愈）在**信息卡**里看不到自愈、
 * 生体损管腔（支援槽带结构抗性，此前后者靠尾段补上）。
 *
 * 修法：不改各槽位分支的既有渲染，而是在**尾部**补一段「跨族加成」——凡"字段归属槽位 ≠ 本件槽位"
 * 的有效字段一律补齐（归属槽位自己的分支已经画过的不重复）。日后新增"槽位族之外的搭车加成"自动可见。
 */
function crossFamilyLines(mod: ModuleDef): InfoLine[] {
  const out: InfoLine[] = []
  const foreign = (owner: ModuleSlot): boolean => mod.slot !== owner
  // 装甲族（容量 / 抗性 / 机动代价）
  if (foreign('armor')) {
    if (mod.armorHpBonus !== undefined) out.push({ k: tr("ui.shipInfo.016"), v: `+${pct(mod.armorHpBonus)}` })
    const row = resistAddLine(tr("ui.FitPage.004"), mod.armorResistAdd)
    if (row) out.push(row)
    if ((mod.speedPenaltyPct ?? 0) > 0) {
      const pen = mod.speedPenaltyPct ?? 0
      out.push({
        k: tr("ui.shipInfo.017"),
        v: (
          <>
            <em className="app-chip is-cost">{tr("ui.shipInfo.134", { p1: (1 - pen).toFixed(2) })}</em>
            <span className="app-dim">{tr("ui.shipInfo.018")}</span>
          </>
        ),
      })
    }
  }
  // 护盾族（容量 / 抗性）
  if (foreign('shield')) {
    if (mod.shieldHpBonus !== undefined) out.push({ k: tr("ui.shipInfo.019"), v: `+${pct(mod.shieldHpBonus)}` })
    const row = resistAddLine(tr("ui.FitPage.002"), mod.shieldResistAdd)
    if (row) out.push(row)
  }
  // 推进器族（加力推进 / 点火代价）
  if (foreign('propulsion')) {
    if (mod.speedBonusPct !== undefined) {
      out.push({
        k: tr("ui.shipInfo.020"),
        v: (
          <>
            {tr("ui.shipInfo.135", { p1: pct(mod.speedBonusPct) })}
            <span className="app-dim">{propTailOf(mod)}</span>
          </>
        ),
      })
    }
    if ((mod.hitPenalty ?? 0) > 0) {
      out.push({ k: tr("ui.shipInfo.021"), v: tr("ui.shipInfo.136", { p1: (1 - (mod.hitPenalty ?? 0)).toFixed(2) }) })
    }
  }
  // 维修/自愈（支援槽之外也带得动：生体甲壳板）
  if (foreign('support') && ((mod.repairArmorHp ?? 0) > 0 || (mod.repairHullHp ?? 0) > 0)) {
    const secs = ((mod.repairIntervalMs ?? 5_000) / 1_000).toFixed(0)
    const isFree = mod.repairFree === true
    out.push({
      k: isFree ? tr("ui.shipInfo.022") : tr("ui.shipInfo.023"),
      v: tr("ui.shipInfo.137", { secs: secs, p2: repairAmountText(mod) }),
    })
    out.push({
      k: tr("ui.shipInfo.024"),
      v: isFree ? (
        <>
          <em className="app-chip is-ok">{tr("ui.shipInfo.025")}</em>
          <span className="app-dim">{tr("ui.shipInfo.026")}</span>
        </>
      ) : (
        <>
          <em className="app-chip is-cost">{repairKitName(mod)} {tr("ui.shipInfo.138")}</em>
          <span className="app-dim">{tr("ui.shipInfo.027")}</span>
        </>
      ),
    })
  }
  // 无人机三族（甲板扩展 / 战术导控 / 中继天线）
  if (foreign('drone-rack') && (mod.droneBayBonusM3 ?? 0) > 0) {
    out.push({ k: tr("ui.shipInfo.028"), v: `+${fmt(mod.droneBayBonusM3 ?? 0)} m³` })
  }
  if (foreign('drone-tac') && (mod.droneDmgBonus ?? 0) > 0) {
    out.push({ k: tr("ui.shipInfo.029"), v: `+${pct(mod.droneDmgBonus ?? 0)}` })
  }
  if (foreign('drone-relay') && (mod.droneRangeBonusPct ?? 0) > 0) {
    out.push({ k: tr("ui.shipInfo.030"), v: tr("ui.shipInfo.139", { p1: pct(mod.droneRangeBonusPct ?? 0) }) })
  }
  // 支援件四族（炮台伤害 / 射速 / 命中 / 回避）
  if (foreign('support')) {
    const dmg = mod.damageTypeBonusPct
    if (dmg && Object.keys(dmg).length > 0) {
      out.push({
        k: tr("ui.shipInfo.031"),
        v: `${Object.entries(dmg)
          .filter(([, v]) => (v ?? 0) > 0)
          .map(([t, v]) => `${DMG_LABEL[t as DamageType]} +${pct(v ?? 0)}`)
          .join(' · ')}`,
      })
    }
    if (mod.reloadCutPct !== undefined) out.push({ k: tr("ui.shipInfo.032"), v: tr("ui.shipInfo.140", { p1: pct(mod.reloadCutPct) }) })
    if (mod.hitBonusPct !== undefined) out.push({ k: tr("ui.shipInfo.033"), v: tr("ui.shipInfo.141", { p1: (1 + mod.hitBonusPct).toFixed(2) }) })
    if (mod.evasionGapPct !== undefined) out.push({ k: tr("ui.shipInfo.034"), v: tr("ui.shipInfo.142", { p1: (1 - mod.evasionGapPct).toFixed(2) }) })
  }
  // 目标锁定阵列（2026-09-17 船长：增伤与集火都「全队生效」）
  if (foreign('target-lock') && mod.lockDmgBonus !== undefined) {
    out.push({ k: tr("ui.shipInfo.035"), v: tr("ui.shipInfo.143", { p1: pct(mod.lockDmgBonus) }) })
  }
  // 协处理器（2026-09-11）：CPU 预算扩容——本职在 cpu 族；写在别的槽位上才算跨族（当前无此件，护栏登记着）
  if (foreign('cpu') && (mod.cpuBonus ?? 0) > 0) {
    out.push({ k: tr("ui.shipInfo.144"), v: tr("ui.shipInfo.145", { p1: fmt(mod.cpuBonus ?? 0) }) })
  }
  return out
}

/** 跨族加成的**短行**文本（装配台槽位行 / 装备库行 / 手册网格共用；与上面的信息卡同源口径） */
function crossFamilyShort(mod: ModuleDef): string {
  const parts: string[] = []
  const foreign = (owner: ModuleSlot): boolean => mod.slot !== owner
  if (foreign('armor')) {
    if (mod.armorHpBonus !== undefined) parts.push(tr("ui.shipInfo.104", { p1: pct(mod.armorHpBonus) }))
    if ((mod.speedPenaltyPct ?? 0) > 0) parts.push(tr("ui.shipInfo.106", { p1: (1 - (mod.speedPenaltyPct ?? 0)).toFixed(2) }))
  }
  if (foreign('shield') && mod.shieldHpBonus !== undefined) parts.push(tr("ui.shipInfo.102", { p1: pct(mod.shieldHpBonus) }))
  if (foreign('propulsion')) {
    if (mod.speedBonusPct !== undefined)
      parts.push(tr("ui.shipInfo.107", { p1: pct(mod.speedBonusPct), p2: thrusterCycleText(DEFAULT_BALANCE.battle, thrusterCycleOfModule(mod)) }))
    if ((mod.hitPenalty ?? 0) > 0) parts.push(tr("ui.shipInfo.108", { p1: (1 - (mod.hitPenalty ?? 0)).toFixed(2) }))
  }
  if (foreign('drone-rack') && (mod.droneBayBonusM3 ?? 0) > 0) parts.push(tr("ui.shipInfo.146", { p1: fmt(mod.droneBayBonusM3 ?? 0) }))
  if (foreign('drone-tac') && (mod.droneDmgBonus ?? 0) > 0) parts.push(tr("ui.shipInfo.111", { p1: pct(mod.droneDmgBonus ?? 0) }))
  if (foreign('drone-relay') && (mod.droneRangeBonusPct ?? 0) > 0) parts.push(tr("ui.shipInfo.112", { p1: pct(mod.droneRangeBonusPct ?? 0) }))
  if (foreign('target-lock') && mod.lockDmgBonus !== undefined) parts.push(tr("ui.shipInfo.147", { p1: pct(mod.lockDmgBonus) }))
  if (foreign('cpu') && (mod.cpuBonus ?? 0) > 0) parts.push(tr("ui.shipInfo.148", { p1: fmt(mod.cpuBonus ?? 0) }))
  return parts.join(' · ')
}

/**
 * 装备统一信息行（V17：各家族按"真实进公式的参数"渲染，取代旧统一百分比行）：
 * 工业槽 = 加成系数；炮台 = 武器卡（配弹/射程带/命中衰减/装填/伤害倍率）；
 * 护盾/装甲 = 容量 + 分系"缺口削减"抗性（合成：实际抗性 = 1 − (1−船体基础) × (1−缺口)，
 * 上限 90%——基础抗越高的船装同系模块收益越低）；推进器 = 加力推进（战斗速度）。
 */
export function moduleInfoLines(mod: ModuleDef): InfoLine[] {
  const lines: InfoLine[] = [{ k: tr("ui.shipInfo.036"), v: `${SLOT_LABELS[mod.slot]}（${RACK_LABELS[rackOf(mod)]}）` }]
  if (mod.slot === 'miner') {
    lines.push({ k: tr("ui.shipInfo.037"), v: `+${pctOpt(mod.bonus)}` })
  } else if (mod.slot === 'cargo') {
    lines.push({ k: tr("ui.Handbook.010"), v: `+${pctOpt(mod.bonus)}` })
  } else if (mod.slot === 'shield') {
    if (mod.shieldHpBonus !== undefined) lines.push({ k: tr("ui.shipInfo.019"), v: `+${pct(mod.shieldHpBonus)}` })
    const row = resistAddLine(tr("ui.FitPage.002"), mod.shieldResistAdd)
    if (row) lines.push(row)
  } else if (mod.slot === 'armor') {
    if (mod.armorHpBonus !== undefined) lines.push({ k: tr("ui.shipInfo.016"), v: `+${pct(mod.armorHpBonus)}` })
    const row = resistAddLine(tr("ui.FitPage.004"), mod.armorResistAdd)
    if (row) lines.push(row)
    // 重甲件的机动代价（2026-09-10 船长：陵寝装甲层 −25%）——多件不叠加、取最重一件
    if ((mod.speedPenaltyPct ?? 0) > 0) {
      const pen = mod.speedPenaltyPct ?? 0
      lines.push({
        k: tr("ui.shipInfo.017"),
        v: (
          <>
            <em className="app-chip is-cost">{tr("ui.shipInfo.134", { p1: (1 - pen).toFixed(2) })}</em>
            <span className="app-dim">{tr("ui.shipInfo.018")}</span>
          </>
        ),
      })
    }
  } else if (mod.slot === 'propulsion') {
    if (mod.speedBonusPct !== undefined) {
      // 2026-09-10 船长定：推进器改周期点火（点火 60 秒 → 冷却 60 秒，开场即点火）
      // 2026-09-11 船长定精简：去掉"冷却期间无加速"（同义重复）与"说明"行
      lines.push({
        k: tr("ui.shipInfo.020"),
        v: (
          <>
            {tr("ui.shipInfo.135", { p1: pct(mod.speedBonusPct) })}
            <span className="app-dim">{propTailOf(mod)}</span>
          </>
        ),
      })
    }
    if (mod.hitPenalty !== undefined && mod.hitPenalty > 0) {
      lines.push({ k: tr("ui.shipInfo.021"), v: tr("ui.shipInfo.136", { p1: (1 - mod.hitPenalty).toFixed(2) }) })
    }
  } else if (mod.slot === 'turret') {
    if (mod.damageType !== undefined) {
      lines.push({
        k: tr("ui.BattleScreen.003"),
        v: (
          <>
            <span className="app-dim">{tr("ui.shipInfo.038")}</span>
            <DmgChip t={mod.damageType} label={tr("ui.FitPage.127", { p1: DMG_LABEL[mod.damageType] })} />
            <span className="app-dim">{tr("ui.shipInfo.039")}</span>
          </>
        ),
      })
    } else if (mod.ammoPerEngagement !== undefined) {
      lines.push({ k: tr("ui.BattleScreen.003"), v: tr("ui.shipInfo.149", { p1: mod.ammoPerEngagement }) })
    }
    if (mod.maxRangeM !== undefined) lines.push({ k: tr("ui.shipInfo.040"), v: rangeText(mod.minRangeM, mod.maxRangeM) })
    // **防空（属性）**（船长 2026-09-12：「**给近防炮系列添加一个属性"防空"，将近防炮的对无人机伤害 ×2
    // 写到防空属性里**」）：一条属性 = ①能筛到敌方机群 ②对无人机伤害 ×该值 ⇒ 渲染为一行「防空」。
    if (mod.antiDrone !== undefined) {
      lines.push({
        k: tr("ui.shipInfo.041"),
        v: (
          <>
            {tr('ui.shipInfo.180')}
            <span className="app-dim">{`　对无人机伤害 ×${mod.antiDrone}`}</span>
          </>
        ),
      })
    }
    if (mod.hitRate !== undefined || mod.falloff !== undefined) {
      const hit = mod.hitRate !== undefined ? tr("ui.shipInfo.150", { p1: pct(mod.hitRate) }) : ''
      const ff = mod.falloff !== undefined ? tr("ui.shipInfo.151", { p1: mod.falloff }) : ''
      lines.push({ k: tr("ui.shipInfo.042"), v: [hit, ff].filter(Boolean).join('　') })
    }
    if (mod.reloadMs !== undefined) lines.push({ k: tr("ui.shipInfo.043"), v: tr("ui.shipInfo.152", { p1: (mod.reloadMs / 1000).toFixed(1) }) })
    if (mod.dmgMult !== undefined) lines.push({ k: tr("ui.shipInfo.044"), v: tr("ui.shipInfo.153", { p1: mod.dmgMult }) })
  } else if (mod.slot === 'missile') {
    // V18B-1 导弹架：武器卡（与炮台同参数字段，性格差异 = 无视近盲 + 追踪命中）
    lines.push({
      k: tr("ui.shipInfo.045"),
      v: (
        <>
          <span className="app-dim">{tr("ui.shipInfo.038")}</span>
          <DmgChip t={mod.damageType ?? 'explosive'} label={tr("ui.FitPage.008")} />
          <span className="app-dim">{tr("ui.shipInfo.039")}</span>
        </>
      ),
    })
    if (mod.maxRangeM !== undefined) lines.push({ k: tr("ui.shipInfo.040"), v: rangeText(mod.minRangeM, mod.maxRangeM) })
    lines.push({ k: tr("ui.shipInfo.046"), v: tr("ui.shipInfo.047") })
    if (mod.hitRate !== undefined) lines.push({ k: tr("ui.shipInfo.048"), v: `${pct(mod.hitRate)}` })
    if (mod.reloadMs !== undefined) lines.push({ k: tr("ui.shipInfo.043"), v: tr("ui.shipInfo.152", { p1: (mod.reloadMs / 1000).toFixed(1) }) })
    if (mod.dmgMult !== undefined) lines.push({ k: tr("ui.shipInfo.044"), v: tr("ui.shipInfo.154", { p1: mod.dmgMult }) })
  } else if (mod.slot === 'laser') {
    // V18B-2 激光炮：能量系武器形态（必中光束 + 威力随距离衰减）
    lines.push({
      k: tr("ui.shipInfo.049"),
      v: (
        <>
          <span className="app-dim">{tr("ui.shipInfo.050")}</span>
          <DmgChip t={mod.damageType ?? 'plasma'} label={tr("ui.FitPage.009")} />
          <span className="app-dim">{tr("ui.shipInfo.051")}</span>
        </>
      ),
    })
    if (mod.maxRangeM !== undefined) lines.push({ k: tr("ui.shipInfo.040"), v: rangeText(mod.minRangeM, mod.maxRangeM) })
    lines.push({ k: tr("ui.shipInfo.052"), v: tr("ui.shipInfo.053") })
    if (mod.falloff !== undefined) {
      // 2026-09-11 修：此行原来自算 (1+falloff)/2（×0.65/×0.68），而引擎 `beamPowerFactor` 在旧口径下
      // 实际是最远端 ×0.44/×0.48 —— 面板读数与实战不符。改为**直接问引擎要最远端系数**，
      // 日后衰减口径再调整（如统一"最远端 = falloff"）面板自动跟随，不会再漂移。
      const far = beamPowerFactor(mod.maxRangeM ?? 0, {
        minRangeM: mod.minRangeM ?? 0,
        maxRangeM: mod.maxRangeM ?? 0,
        falloff: mod.falloff,
      })
      lines.push({
        k: tr("ui.shipInfo.054"),
        v: tr("ui.shipInfo.155", { p1: far.toFixed(2) }),
      })
    }
    if (mod.reloadMs !== undefined) lines.push({ k: tr("ui.shipInfo.043"), v: tr("ui.shipInfo.152", { p1: (mod.reloadMs / 1000).toFixed(1) }) })
    if (mod.dmgMult !== undefined) lines.push({ k: tr("ui.shipInfo.044"), v: tr("ui.shipInfo.156", { p1: mod.dmgMult }) })
  } else if (mod.slot === 'drone-rack') {
    if (mod.droneBayBonusM3 !== undefined) {
      lines.push({ k: tr("ui.shipInfo.028"), v: `+${fmt(mod.droneBayBonusM3)} m³` })
    }
  } else if (mod.slot === 'drone-tac') {
    if (mod.droneDmgBonus !== undefined) {
      lines.push({ k: tr("ui.shipInfo.029"), v: `+${pct(mod.droneDmgBonus)}` })
    }
  } else if (mod.slot === 'drone-relay') {
    if (mod.droneRangeBonusPct !== undefined) {
      lines.push({
        k: tr("ui.shipInfo.030"),
        v: tr("ui.shipInfo.139", { p1: pct(mod.droneRangeBonusPct) }),
      })
    }
  } else if (mod.slot === 'salvager') {
    // 2026-09-11 船长定精简时补：打捞器此前只显示"叠加方式 + CPU"，看不到真正的效果
    if (mod.salvageCycleMs !== undefined) {
      lines.push({ k: tr("ui.shipInfo.055"), v: tr("ui.shipInfo.110", { p1: salvageCycleSecs(mod) }) }) // 与短行同单点
    }
  } else if (mod.slot === 'support') {
    // V18.1 支援件：按效果字段渲染（低槽 = 稳定器/射速计算机；中槽 = 索敌/陀螺）
    const dmg = mod.damageTypeBonusPct
    if (dmg && Object.keys(dmg).length > 0) {
      lines.push({
        k: tr("ui.shipInfo.031"),
        v: (
          <>
            {Object.entries(dmg)
              .filter(([, v]) => (v ?? 0) > 0)
              .map(([t, v]) => (
                <span key={t} className="app-stack-inline">
                  <DmgChip t={t as DamageType} />
                  <span className="app-dim">{` +${pct(v ?? 0)}`}</span>
                </span>
              ))}
          </>
        ),
      })
    }
    if (mod.reloadCutPct !== undefined) {
      lines.push({ k: tr("ui.shipInfo.032"), v: tr("ui.shipInfo.140", { p1: pct(mod.reloadCutPct) }) })
    }
    if (mod.hitBonusPct !== undefined) {
      lines.push({ k: tr("ui.shipInfo.033"), v: tr("ui.shipInfo.141", { p1: (1 + (mod.hitBonusPct ?? 0)).toFixed(2) }) })
    }
    if (mod.evasionGapPct !== undefined) {
      lines.push({ k: tr("ui.shipInfo.034"), v: tr("ui.shipInfo.142", { p1: (1 - (mod.evasionGapPct ?? 0)).toFixed(2) }) })
    }
    // 隐秘行动装置（2026-09-15 船长：高槽 · 自身武器开火前隐身 20/30 秒 · 不被锁定不被攻击）
    if (mod.stealthMs !== undefined) {
      lines.push({
        k: tr("ui.shipInfo.056"),
        v: tr("ui.shipInfo.157", { p1: mod.stealthMs / 1000 }),
      })
      lines.push({ k: tr("ui.shipInfo.057"), v: tr("ui.shipInfo.058") })
    }
    // 船体维修装置 / 生体自愈件（2026-09-09 船长定自动修复；2026-09-10 增无消耗自愈）
    if ((mod.repairArmorHp ?? 0) > 0 || (mod.repairHullHp ?? 0) > 0) {
      const secs = ((mod.repairIntervalMs ?? 5_000) / 1_000).toFixed(0)
      const isFree = mod.repairFree === true
      lines.push({
        k: isFree ? tr("ui.shipInfo.022") : tr("ui.shipInfo.023"),
        v: tr("ui.shipInfo.137", { secs: secs, p2: repairAmountText(mod) }),
      })
      if (isFree) {
        // 无消耗自愈（异形生体件）：不吃组件、永不停机；同型多件按 EVE 曲线递减
        lines.push({
          k: tr("ui.shipInfo.024"),
          v: (
            <>
              <em className="app-chip is-ok">{tr("ui.shipInfo.025")}</em>
              <span className="app-dim">{tr("ui.shipInfo.026")}</span>
            </>
          ),
        })
      } else {
        lines.push({
          k: tr("ui.shipInfo.024"),
          v: (
            <>
              <em className="app-chip is-cost">{repairKitName(mod)} {tr("ui.shipInfo.138")}</em>
              <span className="app-dim">{tr("ui.shipInfo.027")}</span>
            </>
          ),
        })
      }
      /**
       * **修复量口径**（2026-09-16 船长「统一吃」＋「并在相关说明中提及（提高维修量等）」）：
       * 上面那行是**基础值**；实战每跳还要乘**额外护甲/结构加成**与两条恢复量技能——与修理组件同一把尺。
       * 不写这一行 = 玩家看到"每跳 5 点"会以为增厚板/加固理论对维修没用（显示值与实战值漂移的旧坑）。
       */
      lines.push({
        k: tr("ui.shipInfo.059"),
        v: tr("ui.shipInfo.060"),
      })
    }
  } else if (mod.slot === 'target-lock') {
    // 2026-09-09 目标锁定阵列（高槽 target-lock）：集火 + 目标受击加深
    // **2026-09-17 船长：增伤与集火都改「全队生效」**（编队取最高一份）
    lines.push({ k: tr("ui.shipInfo.061"), v: tr("ui.shipInfo.062") })
    if (mod.lockDmgBonus !== undefined) {
      lines.push({ k: tr("ui.shipInfo.035"), v: tr("ui.shipInfo.147", { p1: pct(mod.lockDmgBonus) }) })
    }
  } else if (mod.slot === 'cpu') {
    // 2026-09-11 协处理器（低槽）：装配 CPU 预算扩容；**本件自身不占 CPU**（船长定）——
    // 两行都写清：扩容多少 + 自己不占（否则玩家看到"CPU 占用 0"会以为是坏的）
    if (mod.cpuBonus !== undefined) {
      lines.push({
        k: tr("ui.shipInfo.144"),
        v: (
          <>
            {tr("ui.shipInfo.158", { p1: fmt(mod.cpuBonus) })}
            <span className="app-dim">{tr("ui.shipInfo.063")}</span>
          </>
        ),
      })
    }
    lines.push({
      k: tr("ui.shipInfo.064"),
      v: (
        <>
          <em className="app-chip is-ok">{tr("ui.shipInfo.159")}</em>
          <span className="app-dim">{tr("ui.shipInfo.065")}</span>
        </>
      ),
    })
  }
  // 结构层：**容量**（E 族巨构骨架引出；任何槽位都可能带）与**抗性**（生体损管腔）两行分开，
  // 语义各自成行——容量 = 最后那段血更厚、抗性 = 那段血更耐打
  if ((mod.hullHpBonus ?? 0) > 0) {
    lines.push({
      k: tr("ui.shipInfo.066"),
      v: (
        <>
          <span>{`+${pct(mod.hullHpBonus ?? 0)}`}</span>
          <span className="app-dim">{tr("ui.shipInfo.067")}</span>
        </>
      ),
    })
  }
  const hullRow = resistAddLine(tr("ui.FitPage.005"), mod.hullResistAdd)
  if (hullRow) lines.push(hullRow)
  /* ── 2026-09-13 虫洞专属装备引出的新旋钮（船长逐条给定；**任何槽位都可能带**，故独立成段）──
   * 口径与引擎一致：附加伤害段/耗弹倍数/射程削减与按系加成/通用单发/装填惩罚/全层抗性削减/出击周期。
   * 缺省不写 ⇒ 既有装备一行都不多。 */
  if ((mod.secondaryDamagePct ?? 0) > 0) {
    lines.push({
      k: tr("ui.shipInfo.068"),
      v: tr("ui.shipInfo.160", { p1: pct(mod.secondaryDamagePct ?? 0), p2: DMG_LABEL[(mod.secondaryDamageType ?? 'kinetic') as DamageType] }),
    })
  }
  if ((mod.ammoPerShot ?? 1) > 1) {
    lines.push({ k: tr("ui.shipInfo.069"), v: tr("ui.shipInfo.161", { p1: mod.ammoPerShot ?? 1 }) })
  }
  if ((mod.rangeCutPct ?? 0) > 0) {
    lines.push({ k: tr("ui.shipInfo.070"), v: tr("ui.shipInfo.162", { p1: pct(mod.rangeCutPct ?? 0) }) })
  }
  if (mod.rangeTypeBonusPct) {
    for (const [t, v] of Object.entries(mod.rangeTypeBonusPct)) {
      if ((v ?? 0) > 0) lines.push({ k: tr("ui.shipInfo.163", { p1: DMG_LABEL[t as DamageType] }), v: `+${pct(v ?? 0)}` })
    }
  }
  if ((mod.damageBonusPct ?? 0) > 0) {
    lines.push({ k: tr("ui.shipInfo.071"), v: tr("ui.shipInfo.164", { p1: pct(mod.damageBonusPct ?? 0) }) })
  }
  if ((mod.reloadPenaltyPct ?? 0) > 0) {
    lines.push({ k: tr("ui.shipInfo.072"), v: tr("ui.shipInfo.165", { p1: pct(mod.reloadPenaltyPct ?? 0) }) })
  }
  if ((mod.allResistPenaltyPct ?? 0) > 0) {
    lines.push({
      k: tr("ui.shipInfo.073"),
      v: tr("ui.shipInfo.166", { p1: pct(mod.allResistPenaltyPct ?? 0) }),
    })
  }
  if ((mod.droneCycleCutPct ?? 0) > 0) {
    lines.push({ k: tr("ui.shipInfo.074"), v: tr("ui.shipInfo.167", { p1: pct(mod.droneCycleCutPct ?? 0) }) })
  }
  if ((mod.speedBonusPct ?? 0) > 0 && mod.slot !== 'propulsion') {
    lines.push({ k: tr("ui.shipInfo.075"), v: tr("ui.shipInfo.168", { p1: pct(mod.speedBonusPct ?? 0) }) })
  }
  // 跨族加成（2026-09-11 修复：槽位族之外的加成原先一律不显示——见 crossFamilyLines 注释）
  lines.push(...crossFamilyLines(mod))
  // V18.1 叠加方式标签（所有装备统一：收敛件 = 多装递减；线性件 = 全额叠加；
  // 2026-09-15 隐秘行动装置 = **取最长一件、不叠加**——`max` 组单列一档，不谎报"全额叠加"）
  // 2026-09-11 船长定精简：只留结论一句（机制解释在手册「装配」条目里）
  const st = stackingOf(mod)
  if (st.group === 'flat') {
    lines.push({ k: tr("ui.shipInfo.076"), v: tr("ui.shipInfo.077") })
  } else if (st.group === 'max') {
    lines.push({ k: tr("ui.shipInfo.076"), v: tr("ui.shipInfo.078") })
  } else {
    lines.push({ k: tr("ui.shipInfo.076"), v: tr("ui.shipInfo.079") })
  }
  if (mod.cpuUse !== undefined) lines.push({ k: tr("ui.shipInfo.169"), v: fmt(mod.cpuUse) })
  return lines
}

/** 弹药/无人机统一附加行（物品行在物品图鉴中的补充信息） */
export function itemCombatLines(item: ItemDef): InfoLine[] {
  const lines: InfoLine[] = []
  if (item.damageType !== undefined) lines.push({ k: tr("ui.shipInfo.170"), v: <DmgChip t={item.damageType} /> })
  if (item.dmg !== undefined) lines.push({ k: tr("ui.shipInfo.171"), v: fmt(item.dmg) })
  if (item.kind === 'drone' && item.cpuUse !== undefined) {
    lines.push({ k: tr("ui.shipInfo.080"), v: fmt(item.cpuUse) })
    lines.push({ k: tr("ui.shipInfo.081"), v: tr("ui.shipInfo.172", { p1: item.unitM3 }) })
    if (item.maxRangeM !== undefined) {
      lines.push({ k: tr("ui.shipInfo.082"), v: tr("ui.shipInfo.173", { p1: fmt(item.maxRangeM) }) })
    }
    // 2026-09-10 船长：命中/衰减下放到机型本体——侦察/战斗/攻坚三型命中不随距离衰减，
    // 哨戒保留正常衰减（射程端点倍率）。与导弹架"追踪命中"同款表述口径。
    if (item.hitRate !== undefined) {
      const ff = item.falloff ?? 0.35
      lines.push({
        k: tr("ui.shipInfo.083"),
        v: ff >= 1 ? tr("ui.shipInfo.174", { p1: pct(item.hitRate) }) : tr("ui.shipInfo.175", { p1: pct(item.hitRate), p2: ff.toFixed(2) }),
      })
    }
  }
  if (item.kind === 'drone' && item.defense) {
    const d = item.defense
    lines.push({ k: tr("ui.shipInfo.084"), v: tr("ui.shipInfo.176", { p1: fmt(d.shieldHp), p2: fmt(d.armorHp), p3: fmt(d.hullHp) }) })
    lines.push({ k: tr("ui.shipInfo.085"), v: d.evasion !== undefined ? `${Math.round(d.evasion * 100)}%` : '—' })
  }
  return lines
}

/* ═══════════ 通用渲染 ═══════════ */

/** 键值行表（图鉴详情窗与装配页共用同一视觉） */
export function InfoTable({
  lines,
  note,
}: {
  lines: InfoLine[]
  note?: string
}) {
  return (
    <div className="app-info-table">
      {lines.map((line, i) => (
        <div key={`${line.k}-${i}`} className="app-info-row">
          <span className="app-info-key">{line.k}</span>
          <span className="app-info-val">{line.v}</span>
        </div>
      ))}
      {note ? <div className="app-info-note">{note}</div> : null}
    </div>
  )
}

/**
 * 悬停说明（鼠标悬停舰船卡片/条目时显示名称、三层血量徽章与统一属性表）。
 * 视觉与内容与图鉴/装配页同一数据源；展示机制与全站统一（跟随鼠标的全局提示层，
 * 见 Tooltip.tsx）。block = 以块级包裹整卡（悬停热区覆盖整张卡片）；默认行内包裹单个元素。
 * 间接属性（速度/锁定等）不在此显示——仅装配界面（低优先级）。
 */
export function ShipHover({
  ship,
  children,
  block = false,
  as = 'span',
  className,
  note = tr('ui.Handbook.181'),
}: {
  ship: ShipDef
  children: ReactNode
  block?: boolean
  as?: ElementType
  className?: string
  note?: string
}) {
  const content = (
    <>
      <span className="app-ship-hover-title">{ship.name}</span>
      <span className="app-combat-badges">{combatBadges(ship)}</span>
      <InfoTable lines={shipInfoLines(ship)} />
      {note ? <div className="app-info-note">{note}</div> : null}
    </>
  )
  const Tag = as as ElementType
  const cls = className ?? `app-ship-hover${block ? ' is-block' : ''}`
  return (
    <Tag
      className={cls}
      {...hoverTipProps(content)}
    >
      {children}
    </Tag>
  )
}

/**
 * **富卡内容**（标题 + 统一参数表 + 备注行）——全站悬停卡的**唯一一份皮肤**。
 * `InfoHover` / `ModuleHover` 与"必须自当容器"的场合（如装配台槽位是 `<button>`、要挂 `onClick`）
 * 共用它，避免各页各画一份、风格割裂。
 */
export function infoCardContent(title: ReactNode, lines: InfoLine[], note?: ReactNode, extra?: ReactNode): ReactNode {
  return (
    <>
      <span className="app-ship-hover-title">{title}</span>
      <InfoTable lines={lines} />
      {note ? <div className="app-info-note">{note}</div> : null}
      {extra}
    </>
  )
}

/**
 * **装备富卡内容**（`ModuleHover` 的等价内容，但不带包裹元素）。
 *
 * 用途：容器标签不能换的场景 —— 装配台「已装槽位」与「换装候选卡」都是 `<button>`（要挂 `onClick`），
 * 用 `{...hoverTipProps(moduleHoverContent(mod))}` 直接挂在按钮上。
 * ⚠ 同一元素**禁** `title` + `hoverTipProps` 并存（两个提示路径会在同一个单例层上互顶，见 `ui/Tooltip.tsx`）。
 * `hint` = 追加一行行动提示（如「点击更换 · 第 N 位」），与描述同款注脚样式。
 */
export function moduleHoverContent(mod: ModuleDef, hint?: ReactNode): ReactNode {
  return infoCardContent(mod.name, moduleInfoLines(mod), mod.description, hint ? <div className="app-info-note">{hint}</div> : null)
}

/**
 * 通用信息悬浮（全站列表行悬浮的统一皮肤）：标题 + InfoTable 统一参数表 + 备注行 + 追加行。
 * 装备/物品/蓝图/AI 核心/舰船等悬浮窗共用同一视觉与布局，避免各页悬浮风格割裂。
 * as/className 透传以兼容行级 li/div 包裹；children = 原行内容（悬浮热区）。
 * `extra` = 备注行之后的**追加注脚**（与 `infoCardContent` 的第 4 参同义：给"这一处特有的行动/机制提示"，
 * 如货仓页的"船载仅携带"）；不传 ⇒ 与改动前逐字一致。
 */
export function InfoHover({
  title,
  lines,
  note,
  extra,
  children,
  as = 'span',
  className,
}: {
  title: ReactNode
  lines: InfoLine[]
  note?: ReactNode
  extra?: ReactNode
  children: ReactNode
  as?: ElementType
  className?: string
}) {
  const content = infoCardContent(title, lines, note, extra)
  const Tag = as as ElementType
  return (
    <Tag
      className={className}
      {...hoverTipProps(content)}
    >
      {children}
    </Tag>
  )
}

/**
 * **物品富卡内容**（`ItemHover` 的等价内容，但不带包裹元素）——给"容器标签不能换"的场合
 * （如装配台无人机舱单元格是 `<div>` 且内含 ± 按钮，要从按钮那一层让位给内层提示）。
 * `hint` = 追加一行行动/机制提示（与描述同款注脚样式）。
 */
export function itemHoverContent(
  item: ItemDef,
  nameOf?: (id: string) => string | undefined,
  hint?: ReactNode,
): ReactNode {
  return infoCardContent(item.name, itemInfoLines(item, nameOf), item.description, hint ? <div className="app-info-note">{hint}</div> : null)
}

/**
 * 悬停说明（装备条目/卡片）：统一富卡（InfoHover）——名称 + moduleInfoLines 统一参数表
 * （槽位/效果/抗性/代价 + CPU 占用，装配资源是选购与换装决策的重要信息）+ 数据表描述。
 * 由市场行、物品页仓库装备行（2026-09-19 报障后补）、装配台装备库行、已装槽位行、货仓船载行与手册列表挂载。
 * `hint` = 追加一行行动/机制提示（与描述同款注脚样式；等价于 `moduleHoverContent(mod, hint)` 的第二个参数）。
 */
export function ModuleHover({
  mod,
  children,
  as = 'span',
  className,
  hint,
}: {
  mod: ModuleDef
  children: ReactNode
  as?: ElementType
  className?: string
  hint?: ReactNode
}) {
  return (
    <InfoHover
      title={mod.name}
      lines={moduleInfoLines(mod)}
      note={mod.description}
      extra={hint ? <div className="app-info-note">{hint}</div> : null}
      as={as}
      className={className}
    >
      {children}
    </InfoHover>
  )
}

/** 物品统一信息行（悬浮窗数据源：种类/体积/收价 + 精炼 + 弹药无人机战斗行 + 修理组件） */
export function itemInfoLines(item: ItemDef, nameOf?: (id: string) => string | undefined): InfoLine[] {
  const lines: InfoLine[] = [
    { k: tr("ui.Handbook.005"), v: itemKindText(item) }, // 2026-09-10 无人机：无人机 · 侦察机（子属性并入种类）
    { k: tr("ui.Handbook.006"), v: `${item.unitM3} m³` },
  ]
  if ((item.baseSellPriceIsk ?? 0) > 0) {
    lines.push({ k: tr("ui.shipInfo.086"), v: tr("ui.shipInfo.177", { p1: item.baseSellPriceIsk.toLocaleString('zh-CN') }) })
  }
  if (item.refine !== undefined && item.refine.length > 0) {
    lines.push({
      k: tr("ui.Handbook.007"),
      v: item.refine.map((r) => `${nameOf ? nameOf(r.mineralId) ?? r.mineralId : r.mineralId} ×${r.perOre}`).join('　'),
    })
  }
  if (item.kind === 'ammo' || item.kind === 'drone') {
    for (const l of itemCombatLines(item)) lines.push(l)
  }
  if (item.repairRestore !== undefined) {
    lines.push({ k: tr("ui.itemSubs.001"), v: tr("ui.shipInfo.178", { p1: item.repairRestore }) })
  }
  return lines
}

/**
 * 悬停说明（物品条目：矿石/矿物/气体/冰矿/弹药/无人机）：统一富卡（InfoHover）+
 * itemInfoLines 参数表 + 描述。nameOf 用于把精炼产物 id 解析为中文名（各页用 ctx 注入）。
 * 由市场行、物品仓库行、货仓行与手册列表挂载。
 */
export function ItemHover({
  item,
  nameOf,
  children,
  as = 'span',
  className,
}: {
  item: ItemDef
  nameOf?: (id: string) => string | undefined
  children: ReactNode
  as?: ElementType
  className?: string
}) {
  return (
    <InfoHover title={item.name} lines={itemInfoLines(item, nameOf)} note={item.description} as={as} className={className}>
      {children}
    </InfoHover>
  )
}
