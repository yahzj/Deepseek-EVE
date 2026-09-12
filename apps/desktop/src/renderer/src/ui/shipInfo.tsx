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
 * - 间接属性（速度/跃迁/质量/锁定/信号，V10.5b 保留项）显示优先级低：
 *   只出现在装配界面（shipIndirectLines），不进悬停浮层与图鉴；
 * - 无人机生存包等未落地内容仍标注"契约"。
 */
import type { ElementType, MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import type { AnomalyDef, DamageResists, ItemDef, ModuleDef, ModuleSlot, ShipDef, DamageType } from '@whale/core'
import { foeDamageComposition, ITEM_KIND_LABELS, itemKindText, MODULE_SLOTS, RACK_LABELS, rackOf, shipSlotsOf, SLOT_LABELS, shipRoleLabel, shipSizeLabel, stackingOf, layerMultText, beamPowerFactor, thrusterCycleText, thrusterCycleFullText } from '@whale/core'
import { hideTip, moveTip, showTip } from './Tooltip'

/** 伤害类型中文名 */
export const DMG_LABEL: Record<DamageType, string> = { kinetic: '动能', explosive: '高爆', plasma: '能量' }

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
    .map((x) => `${DMG_LABEL[x.t]}抗 +${pct(x.v)}`)
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
        <span className="app-dim">（上限 90%）</span>
      </>
    ),
  }
}

/** 推进器周期点火后缀（2026-09-11 精简：只留周期与"开场即点火"，"冷却期间无加速"删；
 *  2026-09-11 船长：「推进器现在有持续时间和冷却时间，这点希望在推进器的说明内讲清」——
 *  秒数不再写死，改由 core `thrusterCycleFullText()` 从 `balance.battle` 取（与引擎同源）） */
const PROP_TAIL = `（${thrusterCycleFullText()}）`
/** 维修件的每跳修复量文本（跨族行与主分支共用，防两处口径漂移） */
function repairAmountText(mod: ModuleDef): string {
  const arm = mod.repairArmorHp ?? 0
  const hul = mod.repairHullHp ?? 0
  if (arm > 0 && hul > 0) return arm === hul ? `装甲与结构各 ${fmt(arm)} 点` : `装甲 ${fmt(arm)} / 结构 ${fmt(hul)} 点`
  if (arm > 0) return `装甲 ${fmt(arm)} 点`
  return `结构 ${fmt(hul)} 点`
}
/** 维修件消耗的组件名（接线单点：repairKit → 物品名） */
function repairKitName(mod: ModuleDef): string {
  return mod.repairKit === 'repairkit-mil' ? '军用修理组件' : mod.repairKit === 'repairkit-civ' ? '民用修理组件' : (mod.repairKit ?? '修理组件')
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
  const amt = [arm > 0 ? `甲${fmt(arm)}` : '', hul > 0 ? `结构${fmt(hul)}` : ''].filter(Boolean).join(' / ')
  return `每 ${secs} 秒 ${amt}${mod.repairFree === true ? '（无消耗）' : '（耗组件）'}`
}

/** 结构层抗性短缀（任何槽位都可能带）：`结构抗 动能+25% 爆炸+25% 能量+25%` */
function hullResistShortText(mod: ModuleDef): string {
  const bits = (['kinetic', 'explosive', 'plasma'] as const)
    .filter((t) => (mod.hullResistAdd?.[t] ?? 0) > 0)
    .map((t) => `${DMG_LABEL[t]}+${pct(mod.hullResistAdd![t]!)}`)
  return bits.length > 0 ? `结构抗 ${bits.join(' ')}` : ''
}

/**
 * 装备一行式短效果（装配台槽位行 / 装备库行共用；V17：各战斗家族显示真实进公式参数）。
 * 空槽文本由调用方自给；抗性为"缺口削减"值（合成规则见 moduleInfoLines 注释行）。
 */
/** 炮台配弹文本（V17.2 炮族：固定弹种） */
export function turretAmmoText(mod: ModuleDef): string {
  const type = DMG_LABEL[mod.damageType ?? 'kinetic'] ?? mod.damageType
  return `${type}弹`
}

/** 短效文案（装配台槽位行 / 装备库行 / 手册网格共用；V18.1 收敛件尾注"多装递减"） */
export function moduleShortEffect(mod: ModuleDef): string {
  let body = ''
  switch (mod.slot) {
    case 'miner':
      body = `产量 +${pctOpt(mod.bonus)}`
      break
    case 'cargo':
      body = `货舱容量 +${pctOpt(mod.bonus)}`
      break
    case 'turret': {
      body = `${turretAmmoText(mod)} · 射程 ${rangeText(mod.minRangeM, mod.maxRangeM)}`
      break
    }
    case 'missile': {
      // V18B-1 导弹架：爆炸系武器形态（爆破导弹，近盲安全射距 + 追踪命中）
      body = `爆破导弹 · 射程 ${rangeText(mod.minRangeM, mod.maxRangeM)}`
      break
    }
    case 'laser': {
      // V18B-2 激光炮：能量系武器形态（能量弹药 · 必中 · 威力随距离轻微衰减）
      body = `能量弹药 · 射程 ${rangeText(mod.minRangeM, mod.maxRangeM)}`
      break
    }
    case 'shield': {
      const parts: string[] = []
      if (mod.shieldHpBonus !== undefined) parts.push(`盾容 +${pct(mod.shieldHpBonus)}`)
      const gap = resistGapText(mod.shieldResistAdd)
      if (gap) parts.push(gap)
      body = parts.join(' · ')
      break
    }
    case 'armor': {
      const parts: string[] = []
      if (mod.armorHpBonus !== undefined) parts.push(`甲容 +${pct(mod.armorHpBonus)}`)
      const gap = resistGapText(mod.armorResistAdd)
      if (gap) parts.push(gap)
      // 结构层容量（E 族巨构骨架）：短行也要看得见"最后那段血更厚"
      if ((mod.hullHpBonus ?? 0) > 0) parts.push(`结构 +${pct(mod.hullHpBonus ?? 0)}`)
      // 2026-09-10 船长：重甲件的机动代价（陵寝装甲层 −25%）——短行也带代价（同推进器「命中×0.85」写法）
      if ((mod.speedPenaltyPct ?? 0) > 0) parts.push(`速度×${(1 - (mod.speedPenaltyPct ?? 0)).toFixed(2)}`)
      body = parts.join(' · ')
      break
    }
    case 'propulsion': {
      // 2026-09-11 船长：「推进器现在有持续时间和冷却时间，这点希望在推进器的说明内讲清」——
      // 短行（换装卡 / 装备库行 / 手册网格）此前只有「速度 +X% · 命中×Y」，看不出是**周期**爆发，
      // 补周期缀（秒数同源于 balance.battle，见 core thrusterCycleText）
      const parts: string[] = []
      if (mod.speedBonusPct !== undefined) parts.push(`速度 +${pct(mod.speedBonusPct)}（${thrusterCycleText()}）`)
      if (mod.hitPenalty !== undefined && mod.hitPenalty > 0) parts.push(`命中×${(1 - mod.hitPenalty).toFixed(2)}`)
      body = parts.join(' · ')
      break
    }
    case 'drone-rack':
      body = `无人机舱 +${fmt(mod.droneBayBonusM3)} m³`
      break
    case 'drone-tac':
      body = `无人机伤害 +${pctOpt(mod.droneDmgBonus)}`
      break
    case 'drone-relay':
      // 2026-09-10 无人机中继天线：放飞无人机射程加成
      body = `无人机射程 +${pctOpt(mod.droneRangeBonusPct)}`
      break
    case 'support': {
      // V18.1 支援件：效果字段判别（稳定器按系可多件 → 逐系列出）
      const dmg = mod.damageTypeBonusPct
      if (dmg && Object.keys(dmg).length > 0) {
        body = Object.entries(dmg)
          .filter(([, v]) => (v ?? 0) > 0)
          .map(([t, v]) => `${DMG_LABEL[t as DamageType]}伤 +${pct(v ?? 0)}`)
          .join(' + ')
      } else if (mod.reloadCutPct !== undefined) {
        body = `装填 −${pct(mod.reloadCutPct)}`
      } else if (mod.hitBonusPct !== undefined) {
        body = `炮台命中 +${pct(mod.hitBonusPct)}`
      } else if (mod.evasionGapPct !== undefined) {
        body = `被命中 −${pct(mod.evasionGapPct)}（缺口）`
      }
      break
    }
    case 'target-lock':
      // 2026-09-09 目标锁定阵列：集火首位 + 目标受击加深
      body = `锁定集火：目标受击 +${pctOpt(mod.lockDmgBonus)}`
      break
  }
  // 任何槽位统一尾缀：维修系（每跳修多少/吃不吃组件）、结构层抗性与**跨族加成**——短行不丢关键效果
  // （跨族尾缀 = 2026-09-11 修复：赃物强化舱的"甲容 +15%"这类搭车加成因槽位分支而漏显示）
  const extras = [repairShortText(mod), hullResistShortText(mod), crossFamilyShort(mod)].filter(Boolean).join(' · ')
  if (extras) body = body ? `${body} · ${extras}` : extras
  // V18.1：收敛件（抗性/闪避 = 缺口复合、命中/速度 = EVE 曲线）尾注"多装递减"
  return body + (stackingOf(mod).group === 'flat' ? '' : ' · 多装递减')
}

/** 三系抗性紧凑文本（整数主抗制简化后只列非零项；全零 = "无"） */
export function resistsText(r: DamageResists | undefined): string {
  const parts = (['kinetic', 'explosive', 'plasma'] as const)
    .map((t) => ({ t, v: r?.[t] ?? 0 }))
    .filter((x) => x.v > 0)
  if (parts.length === 0) return '无'
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
    <span key={key} className={`app-combat-badge ${cls}`} title={hasResist ? `抗性：${resistsText(resist)}` : undefined}>
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
    layerBadge('s', 'is-shield', '盾', hp?.s ?? ship.shieldHp, res?.shield ?? ship.shieldResist),
    layerBadge('a', 'is-armor', '甲', hp?.a ?? ship.armorHp, res?.armor ?? ship.armorResist),
    layerBadge('h', 'is-hull', '结构', hp?.h ?? ship.hullHp, res?.hull ?? ship.hullResist),
  ]
}

/** 槽位布局文本（V18：高/中/低 × 数量制复数安装——取代旧六槽单件列表） */
export function slotListText(ship?: ShipDef): string {
  if (ship) {
    const s = shipSlotsOf(ship)
    return `${RACK_LABELS.high} ${s.high} / ${RACK_LABELS.mid} ${s.mid} / ${RACK_LABELS.low} ${s.low}（复数安装）`
  }
  return MODULE_SLOTS.map((m) => SLOT_LABELS[m]).join(' · ')
}

/** 舰船统一信息行：基础 + V10.5b 面板分组（护盾/装甲/结构区块各自血量与三系抗性；CPU/无人机舱） */
export function shipInfoLines(ship: ShipDef): InfoLine[] {
  const lines: InfoLine[] = [
    { k: '定位 / 档次', v: `${shipRoleLabel(ship.role)} · ${shipSizeLabel(ship.tier)} T${ship.tier}` },
    { k: '货舱容量', v: `${fmt(ship.cargoM3)} m³` },
    { k: '采集性能', v: `${ship.cycleSeconds} 秒 × ${ship.oreUnitsPerCycle} 单位/循环` },
    { k: '动力（机动 / 跃迁充能）', v: `${Math.round(ship.agility * 100)}%` },
  ]
  const hasCombat = (ship.shieldHp ?? 0) > 0 || (ship.armorHp ?? 0) > 0 || (ship.hullHp ?? 0) > 0
  if (hasCombat) {
    lines.push({ k: '护盾', v: fmt(ship.shieldHp) })
    lines.push({ k: '护盾抗性', v: resistsText(ship.shieldResist) })
    lines.push({ k: '装甲', v: fmt(ship.armorHp) })
    lines.push({ k: '装甲抗性', v: resistsText(ship.armorResist) })
    lines.push({ k: '结构', v: fmt(ship.hullHp) })
    lines.push({ k: '结构抗性', v: resistsText(ship.hullResist) })
    if (ship.powerBonus !== undefined && ship.powerBonus > 0) {
      lines.push({ k: '火力加成', v: `+${Math.round(ship.powerBonus * 100)}%` })
    }
    // 船体武器族加成（2026-09-09 船长拍板：四族巡洋分型 EVE 式族加成）——本族武器单发加成、跨族可用无加成
    if (ship.weaponFamilyBonus !== undefined) {
      for (const [t, v] of Object.entries(ship.weaponFamilyBonus)) {
        if ((v ?? 0) > 0) {
          lines.push({
            k: '武器族加成',
            v: (
              <>
                <DmgChip t={t as DamageType} label={`${DMG_LABEL[t as DamageType]}伤`} />
                <span className="app-dim">{` 本族武器单发 +${pct(v ?? 0)}（装别族武器无加成）`}</span>
              </>
            ),
          })
        }
      }
    }
    // V16.1：命中加成/回避率上主属性（装配台主要属性区内可见）
    if (ship.hitBonus !== undefined) lines.push({ k: '命中加成', v: `+${Math.round(ship.hitBonus * 100)}%` })
    if (ship.evasion !== undefined) lines.push({ k: '回避率', v: `${Math.round(ship.evasion * 100)}%` })
  }
  lines.push({ k: '槽位', v: slotListText(ship) })
  if (ship.cpu !== undefined) lines.push({ k: 'CPU', v: fmt(ship.cpu) })
  lines.push({ k: '无人机舱', v: ship.droneBayM3 ? `${fmt(ship.droneBayM3)} m³` : '无' })
  return lines
}

/** 间接属性行（速度/跃迁/质量/锁定/信号）：显示优先级低——仅装配界面使用 */
export function shipIndirectLines(ship: ShipDef): InfoLine[] {
  const lines: InfoLine[] = []
  if (ship.maxSpeedMps !== undefined) lines.push({ k: '最大速度', v: `${fmt(ship.maxSpeedMps)} m/s` })
  if (ship.warpSpeedAus !== undefined) lines.push({ k: '跃迁速度', v: `${ship.warpSpeedAus} AU/s` })
  if (ship.massKg !== undefined) lines.push({ k: '质量', v: `${(ship.massKg / 1_000_000).toFixed(1)} 百万 kg` })
  if (ship.lockRangeM !== undefined) lines.push({ k: '锁定范围', v: `${(ship.lockRangeM / 1000).toFixed(0)} km` })
  if (ship.signatureM !== undefined) lines.push({ k: '信号半径', v: `${fmt(ship.signatureM)} m` })
  if (ship.scanResMm !== undefined) lines.push({ k: '扫描分辨率', v: `${fmt(ship.scanResMm)} mm` })
  // V16.1：跃迁充能（派生自动力 agility，动力越高充能越快；取代旧"起跳时间"）
  const charge = warpChargePct(ship)
  if (charge !== null) lines.push({ k: '跃迁充能（随动力）', v: `${charge}%` })
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
    if (mod.armorHpBonus !== undefined) out.push({ k: '装甲容量', v: `+${pct(mod.armorHpBonus)}` })
    const row = resistAddLine('装甲抗性', mod.armorResistAdd)
    if (row) out.push(row)
    if ((mod.speedPenaltyPct ?? 0) > 0) {
      const pen = mod.speedPenaltyPct ?? 0
      out.push({
        k: '机动代价',
        v: (
          <>
            <em className="app-chip is-cost">{`战斗速度 ×${(1 - pen).toFixed(2)}`}</em>
            <span className="app-dim">（多件取最重一件）</span>
          </>
        ),
      })
    }
  }
  // 护盾族（容量 / 抗性）
  if (foreign('shield')) {
    if (mod.shieldHpBonus !== undefined) out.push({ k: '护盾容量', v: `+${pct(mod.shieldHpBonus)}` })
    const row = resistAddLine('护盾抗性', mod.shieldResistAdd)
    if (row) out.push(row)
  }
  // 推进器族（加力推进 / 点火代价）
  if (foreign('propulsion')) {
    if (mod.speedBonusPct !== undefined) {
      out.push({
        k: '加力推进',
        v: (
          <>
            {`点火期间战斗速度 +${pct(mod.speedBonusPct)}`}
            <span className="app-dim">{PROP_TAIL}</span>
          </>
        ),
      })
    }
    if ((mod.hitPenalty ?? 0) > 0) {
      out.push({ k: '点火代价', v: `点火期间开火命中 ×${(1 - (mod.hitPenalty ?? 0)).toFixed(2)}` })
    }
  }
  // 维修/自愈（支援槽之外也带得动：生体甲壳板）
  if (foreign('support') && ((mod.repairArmorHp ?? 0) > 0 || (mod.repairHullHp ?? 0) > 0)) {
    const secs = ((mod.repairIntervalMs ?? 5_000) / 1_000).toFixed(0)
    const isFree = mod.repairFree === true
    out.push({
      k: isFree ? '生体自愈' : '自动维修',
      v: `每 ${secs} 秒修复${repairAmountText(mod)}`,
    })
    out.push({
      k: '运转消耗',
      v: isFree ? (
        <>
          <em className="app-chip is-ok">无消耗</em>
          <span className="app-dim">（不吃组件，永不停机）</span>
        </>
      ) : (
        <>
          <em className="app-chip is-cost">{repairKitName(mod)} ×1 / 跳</em>
          <span className="app-dim">（耗尽即停机）</span>
        </>
      ),
    })
  }
  // 无人机三族（甲板扩展 / 战术导控 / 中继天线）
  if (foreign('drone-rack') && (mod.droneBayBonusM3 ?? 0) > 0) {
    out.push({ k: '无人机舱扩展', v: `+${fmt(mod.droneBayBonusM3 ?? 0)} m³` })
  }
  if (foreign('drone-tac') && (mod.droneDmgBonus ?? 0) > 0) {
    out.push({ k: '无人机伤害', v: `+${pct(mod.droneDmgBonus ?? 0)}` })
  }
  if (foreign('drone-relay') && (mod.droneRangeBonusPct ?? 0) > 0) {
    out.push({ k: '无人机射程', v: `+${pct(mod.droneRangeBonusPct ?? 0)}（按机型射程加成）` })
  }
  // 支援件四族（炮台伤害 / 射速 / 命中 / 回避）
  if (foreign('support')) {
    const dmg = mod.damageTypeBonusPct
    if (dmg && Object.keys(dmg).length > 0) {
      out.push({
        k: '炮台伤害',
        v: `${Object.entries(dmg)
          .filter(([, v]) => (v ?? 0) > 0)
          .map(([t, v]) => `${DMG_LABEL[t as DamageType]} +${pct(v ?? 0)}`)
          .join(' · ')}`,
      })
    }
    if (mod.reloadCutPct !== undefined) out.push({ k: '射速支援', v: `炮台装填间隔 −${pct(mod.reloadCutPct)}` })
    if (mod.hitBonusPct !== undefined) out.push({ k: '命中支援', v: `炮台命中 ×${(1 + mod.hitBonusPct).toFixed(2)}` })
    if (mod.evasionGapPct !== undefined) out.push({ k: '回避支援', v: `敌命中 ×${(1 - mod.evasionGapPct).toFixed(2)}（全船生效）` })
  }
  // 目标锁定阵列
  if (foreign('target-lock') && mod.lockDmgBonus !== undefined) {
    out.push({ k: '锁定加深', v: `被锁目标受本舰伤害 +${pct(mod.lockDmgBonus)}` })
  }
  return out
}

/** 跨族加成的**短行**文本（装配台槽位行 / 装备库行 / 手册网格共用；与上面的信息卡同源口径） */
function crossFamilyShort(mod: ModuleDef): string {
  const parts: string[] = []
  const foreign = (owner: ModuleSlot): boolean => mod.slot !== owner
  if (foreign('armor')) {
    if (mod.armorHpBonus !== undefined) parts.push(`甲容 +${pct(mod.armorHpBonus)}`)
    if ((mod.speedPenaltyPct ?? 0) > 0) parts.push(`速度×${(1 - (mod.speedPenaltyPct ?? 0)).toFixed(2)}`)
  }
  if (foreign('shield') && mod.shieldHpBonus !== undefined) parts.push(`盾容 +${pct(mod.shieldHpBonus)}`)
  if (foreign('propulsion')) {
    if (mod.speedBonusPct !== undefined) parts.push(`速度 +${pct(mod.speedBonusPct)}（${thrusterCycleText()}）`)
    if ((mod.hitPenalty ?? 0) > 0) parts.push(`命中×${(1 - (mod.hitPenalty ?? 0)).toFixed(2)}`)
  }
  if (foreign('drone-rack') && (mod.droneBayBonusM3 ?? 0) > 0) parts.push(`机舱 +${fmt(mod.droneBayBonusM3 ?? 0)} m³`)
  if (foreign('drone-tac') && (mod.droneDmgBonus ?? 0) > 0) parts.push(`无人机伤害 +${pct(mod.droneDmgBonus ?? 0)}`)
  if (foreign('drone-relay') && (mod.droneRangeBonusPct ?? 0) > 0) parts.push(`无人机射程 +${pct(mod.droneRangeBonusPct ?? 0)}`)
  if (foreign('target-lock') && mod.lockDmgBonus !== undefined) parts.push(`锁定受击 +${pct(mod.lockDmgBonus)}`)
  return parts.join(' · ')
}

/**
 * 装备统一信息行（V17：各家族按"真实进公式的参数"渲染，取代旧统一百分比行）：
 * 工业槽 = 加成系数；炮台 = 武器卡（配弹/射程带/命中衰减/装填/伤害倍率）；
 * 护盾/装甲 = 容量 + 分系"缺口削减"抗性（合成：实际抗性 = 1 − (1−船体基础) × (1−缺口)，
 * 上限 90%——基础抗越高的船装同系模块收益越低）；推进器 = 加力推进（战斗速度）。
 */
export function moduleInfoLines(mod: ModuleDef): InfoLine[] {
  const lines: InfoLine[] = [{ k: '槽位 / 类型', v: `${SLOT_LABELS[mod.slot]}（${RACK_LABELS[rackOf(mod)]}）` }]
  if (mod.slot === 'miner') {
    lines.push({ k: '循环产量', v: `+${pctOpt(mod.bonus)}` })
  } else if (mod.slot === 'cargo') {
    lines.push({ k: '货舱容量', v: `+${pctOpt(mod.bonus)}` })
  } else if (mod.slot === 'shield') {
    if (mod.shieldHpBonus !== undefined) lines.push({ k: '护盾容量', v: `+${pct(mod.shieldHpBonus)}` })
    const row = resistAddLine('护盾抗性', mod.shieldResistAdd)
    if (row) lines.push(row)
  } else if (mod.slot === 'armor') {
    if (mod.armorHpBonus !== undefined) lines.push({ k: '装甲容量', v: `+${pct(mod.armorHpBonus)}` })
    const row = resistAddLine('装甲抗性', mod.armorResistAdd)
    if (row) lines.push(row)
    // 重甲件的机动代价（2026-09-10 船长：陵寝装甲层 −25%）——多件不叠加、取最重一件
    if ((mod.speedPenaltyPct ?? 0) > 0) {
      const pen = mod.speedPenaltyPct ?? 0
      lines.push({
        k: '机动代价',
        v: (
          <>
            <em className="app-chip is-cost">{`战斗速度 ×${(1 - pen).toFixed(2)}`}</em>
            <span className="app-dim">（多件取最重一件）</span>
          </>
        ),
      })
    }
  } else if (mod.slot === 'propulsion') {
    if (mod.speedBonusPct !== undefined) {
      // 2026-09-10 船长定：推进器改周期点火（点火 60 秒 → 冷却 60 秒，开场即点火）
      // 2026-09-11 船长定精简：去掉"冷却期间无加速"（同义重复）与"说明"行
      lines.push({
        k: '加力推进',
        v: (
          <>
            {`点火期间战斗速度 +${pct(mod.speedBonusPct)}`}
            <span className="app-dim">{PROP_TAIL}</span>
          </>
        ),
      })
    }
    if (mod.hitPenalty !== undefined && mod.hitPenalty > 0) {
      lines.push({ k: '点火代价', v: `点火期间开火命中 ×${(1 - mod.hitPenalty).toFixed(2)}` })
    }
  } else if (mod.slot === 'turret') {
    if (mod.damageType !== undefined) {
      lines.push({
        k: '弹药',
        v: (
          <>
            <span className="app-dim">配弹：</span>
            <DmgChip t={mod.damageType} label={`${DMG_LABEL[mod.damageType]}弹`} />
            <span className="app-dim">（固定）</span>
          </>
        ),
      })
    } else if (mod.ammoPerEngagement !== undefined) {
      lines.push({ k: '弹药', v: `每场耗弹基数 ×${mod.ammoPerEngagement}` })
    }
    if (mod.maxRangeM !== undefined) lines.push({ k: '射程带', v: rangeText(mod.minRangeM, mod.maxRangeM) })
    if (mod.hitRate !== undefined || mod.falloff !== undefined) {
      const hit = mod.hitRate !== undefined ? `基础命中 ${pct(mod.hitRate)}` : ''
      const ff = mod.falloff !== undefined ? `远端衰减 ×${mod.falloff}` : ''
      lines.push({ k: '命中', v: [hit, ff].filter(Boolean).join('　') })
    }
    if (mod.reloadMs !== undefined) lines.push({ k: '装填', v: `${(mod.reloadMs / 1000).toFixed(1)} 秒/发` })
    if (mod.dmgMult !== undefined) lines.push({ k: '单发伤害', v: `弹伤害 ×${mod.dmgMult}` })
  } else if (mod.slot === 'missile') {
    // V18B-1 导弹架：武器卡（与炮台同参数字段，性格差异 = 无视近盲 + 追踪命中）
    lines.push({
      k: '弹头',
      v: (
        <>
          <span className="app-dim">配弹：</span>
          <DmgChip t={mod.damageType ?? 'explosive'} label="爆破导弹" />
          <span className="app-dim">（固定）</span>
        </>
      ),
    })
    if (mod.maxRangeM !== undefined) lines.push({ k: '射程带', v: rangeText(mod.minRangeM, mod.maxRangeM) })
    lines.push({ k: '弹道特性', v: '近盲（太近会炸到自己）· 命中不随距离衰减' })
    if (mod.hitRate !== undefined) lines.push({ k: '追踪命中', v: `${pct(mod.hitRate)}` })
    if (mod.reloadMs !== undefined) lines.push({ k: '装填', v: `${(mod.reloadMs / 1000).toFixed(1)} 秒/发` })
    if (mod.dmgMult !== undefined) lines.push({ k: '单发伤害', v: `弹头伤害 ×${mod.dmgMult}` })
  } else if (mod.slot === 'laser') {
    // V18B-2 激光炮：能量系武器形态（必中光束 + 威力随距离衰减）
    lines.push({
      k: '弹种',
      v: (
        <>
          <span className="app-dim">消耗：</span>
          <DmgChip t={mod.damageType ?? 'plasma'} label="能量弹药" />
          <span className="app-dim">（专用）</span>
        </>
      ),
    })
    if (mod.maxRangeM !== undefined) lines.push({ k: '射程带', v: rangeText(mod.minRangeM, mod.maxRangeM) })
    lines.push({ k: '光束特性', v: '必中 · 无近盲' })
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
        k: '威力衰减',
        v: `远端威力 ×${far.toFixed(2)}`,
      })
    }
    if (mod.reloadMs !== undefined) lines.push({ k: '装填', v: `${(mod.reloadMs / 1000).toFixed(1)} 秒/发` })
    if (mod.dmgMult !== undefined) lines.push({ k: '单发伤害', v: `能量弹药伤害 ×${mod.dmgMult}` })
  } else if (mod.slot === 'drone-rack') {
    if (mod.droneBayBonusM3 !== undefined) {
      lines.push({ k: '无人机舱扩展', v: `+${fmt(mod.droneBayBonusM3)} m³` })
    }
  } else if (mod.slot === 'drone-tac') {
    if (mod.droneDmgBonus !== undefined) {
      lines.push({ k: '无人机伤害', v: `+${pct(mod.droneDmgBonus)}` })
    }
  } else if (mod.slot === 'drone-relay') {
    if (mod.droneRangeBonusPct !== undefined) {
      lines.push({
        k: '无人机射程',
        v: `+${pct(mod.droneRangeBonusPct)}（按机型射程加成）`,
      })
    }
  } else if (mod.slot === 'salvager') {
    // 2026-09-11 船长定精简时补：打捞器此前只显示"叠加方式 + CPU"，看不到真正的效果
    if (mod.salvageCycleMs !== undefined) {
      lines.push({ k: '打捞周期', v: `每 ${(mod.salvageCycleMs / 1000).toFixed(0)} 秒 1 具残骸` })
    }
  } else if (mod.slot === 'support') {
    // V18.1 支援件：按效果字段渲染（低槽 = 稳定器/射速计算机；中槽 = 索敌/陀螺）
    const dmg = mod.damageTypeBonusPct
    if (dmg && Object.keys(dmg).length > 0) {
      lines.push({
        k: '炮台伤害',
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
      lines.push({ k: '射速支援', v: `炮台装填间隔 −${pct(mod.reloadCutPct)}` })
    }
    if (mod.hitBonusPct !== undefined) {
      lines.push({ k: '命中支援', v: `炮台命中 ×${(1 + (mod.hitBonusPct ?? 0)).toFixed(2)}` })
    }
    if (mod.evasionGapPct !== undefined) {
      lines.push({ k: '回避支援', v: `敌命中 ×${(1 - (mod.evasionGapPct ?? 0)).toFixed(2)}（全船生效）` })
    }
    // 船体维修装置 / 生体自愈件（2026-09-09 船长定自动修复；2026-09-10 增无消耗自愈）
    if ((mod.repairArmorHp ?? 0) > 0 || (mod.repairHullHp ?? 0) > 0) {
      const secs = ((mod.repairIntervalMs ?? 5_000) / 1_000).toFixed(0)
      const isFree = mod.repairFree === true
      lines.push({
        k: isFree ? '生体自愈' : '自动维修',
        v: `每 ${secs} 秒修复${repairAmountText(mod)}`,
      })
      if (isFree) {
        // 无消耗自愈（异形生体件）：不吃组件、永不停机；同型多件按 EVE 曲线递减
        lines.push({
          k: '运转消耗',
          v: (
            <>
              <em className="app-chip is-ok">无消耗</em>
              <span className="app-dim">（不吃组件，永不停机）</span>
            </>
          ),
        })
      } else {
        lines.push({
          k: '运转消耗',
          v: (
            <>
              <em className="app-chip is-cost">{repairKitName(mod)} ×1 / 跳</em>
              <span className="app-dim">（耗尽即停机）</span>
            </>
          ),
        })
      }
    }
  } else if (mod.slot === 'target-lock') {
    // 2026-09-09 目标锁定阵列（高槽 target-lock）：集火 + 被锁目标受击加深
    lines.push({ k: '集火模式', v: '全部武器集火存活编队首位' })
    if (mod.lockDmgBonus !== undefined) {
      lines.push({ k: '锁定加深', v: `被锁目标受本舰伤害 +${pct(mod.lockDmgBonus)}` })
    }
  }
  // 结构层：**容量**（E 族巨构骨架引出；任何槽位都可能带）与**抗性**（生体损管腔）两行分开，
  // 语义各自成行——容量 = 最后那段血更厚、抗性 = 那段血更耐打
  if ((mod.hullHpBonus ?? 0) > 0) {
    lines.push({
      k: '结构容量',
      v: (
        <>
          <span>{`+${pct(mod.hullHpBonus ?? 0)}`}</span>
          <span className="app-dim">（最后一段血量）</span>
        </>
      ),
    })
  }
  const hullRow = resistAddLine('结构抗性', mod.hullResistAdd)
  if (hullRow) lines.push(hullRow)
  // 跨族加成（2026-09-11 修复：槽位族之外的加成原先一律不显示——见 crossFamilyLines 注释）
  lines.push(...crossFamilyLines(mod))
  // V18.1 叠加方式标签（所有装备统一：收敛件 = 多装递减；线性件 = 全额叠加）
  // 2026-09-11 船长定精简：只留结论一句（机制解释在手册「装配」条目里）
  const st = stackingOf(mod)
  if (st.group === 'flat') {
    lines.push({ k: '叠加方式', v: '全额叠加' })
  } else {
    lines.push({ k: '叠加方式', v: '多装递减' })
  }
  if (mod.cpuUse !== undefined) lines.push({ k: 'CPU 占用', v: fmt(mod.cpuUse) })
  return lines
}

/** 弹药/无人机统一附加行（物品行在物品图鉴中的补充信息） */
export function itemCombatLines(item: ItemDef): InfoLine[] {
  const lines: InfoLine[] = []
  if (item.damageType !== undefined) lines.push({ k: '伤害类型', v: <DmgChip t={item.damageType} /> })
  if (item.dmg !== undefined) lines.push({ k: '伤害基数', v: fmt(item.dmg) })
  if (item.kind === 'drone' && item.cpuUse !== undefined) {
    lines.push({ k: '放飞 CPU', v: fmt(item.cpuUse) })
    lines.push({ k: '占用舱容', v: `${item.unitM3} m³/架` })
    if (item.maxRangeM !== undefined) {
      lines.push({ k: '射程上限', v: `${fmt(item.maxRangeM)} m（中继天线按百分比加成）` })
    }
    // 2026-09-10 船长：命中/衰减下放到机型本体——侦察/战斗/攻坚三型命中不随距离衰减，
    // 哨戒保留正常衰减（射程端点倍率）。与导弹架"追踪命中"同款表述口径。
    if (item.hitRate !== undefined) {
      const ff = item.falloff ?? 0.35
      lines.push({
        k: '放飞命中',
        v: ff >= 1 ? `${pct(item.hitRate)}（不随距离衰减）` : `${pct(item.hitRate)}（射程端点 ×${ff.toFixed(2)}）`,
      })
    }
  }
  if (item.kind === 'drone' && item.defense) {
    const d = item.defense
    lines.push({ k: '生存（契约）', v: `盾 ${fmt(d.shieldHp)} · 甲 ${fmt(d.armorHp)} · 结构 ${fmt(d.hullHp)}` })
    lines.push({ k: '回避', v: d.evasion !== undefined ? `${Math.round(d.evasion * 100)}%` : '—' })
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
  note = '已生效战斗数值：抗性按递减方式合成（上限 90%）',
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
      onMouseEnter={(e: ReactMouseEvent<HTMLElement>) => showTip(content, e.clientX, e.clientY)}
      onMouseMove={(e: ReactMouseEvent<HTMLElement>) => moveTip(content, e.clientX, e.clientY)}
      onMouseLeave={() => hideTip()}
    >
      {children}
    </Tag>
  )
}

/**
 * 通用信息悬浮（全站列表行悬浮的统一皮肤）：标题 + InfoTable 统一参数表 + 备注行。
 * 装备/物品/蓝图/AI 核心/舰船等悬浮窗共用同一视觉与布局，避免各页悬浮风格割裂。
 * as/className 透传以兼容行级 li/div 包裹；children = 原行内容（悬浮热区）。
 */
export function InfoHover({
  title,
  lines,
  note,
  children,
  as = 'span',
  className,
}: {
  title: ReactNode
  lines: InfoLine[]
  note?: ReactNode
  children: ReactNode
  as?: ElementType
  className?: string
}) {
  const content = (
    <>
      <span className="app-ship-hover-title">{title}</span>
      <InfoTable lines={lines} />
      {note ? <div className="app-info-note">{note}</div> : null}
    </>
  )
  const Tag = as as ElementType
  return (
    <Tag
      className={className}
      onMouseEnter={(e: ReactMouseEvent<HTMLElement>) => showTip(content, e.clientX, e.clientY)}
      onMouseMove={(e: ReactMouseEvent<HTMLElement>) => moveTip(content, e.clientX, e.clientY)}
      onMouseLeave={() => hideTip()}
    >
      {children}
    </Tag>
  )
}

/**
 * 悬停说明（装备条目/卡片）：统一富卡（InfoHover）——名称 + moduleInfoLines 统一参数表
 * （槽位/效果/抗性/代价 + CPU 占用，装配资源是选购与换装决策的重要信息）+ 数据表描述。
 * 由市场行、装配台装备库行、已装槽位行与手册列表挂载。
 */
export function ModuleHover({
  mod,
  children,
  as = 'span',
  className,
}: {
  mod: ModuleDef
  children: ReactNode
  as?: ElementType
  className?: string
}) {
  return (
    <InfoHover title={mod.name} lines={moduleInfoLines(mod)} note={mod.description} as={as} className={className}>
      {children}
    </InfoHover>
  )
}

/** 物品统一信息行（悬浮窗数据源：种类/体积/收价 + 精炼 + 弹药无人机战斗行 + 修理组件） */
export function itemInfoLines(item: ItemDef, nameOf?: (id: string) => string | undefined): InfoLine[] {
  const lines: InfoLine[] = [
    { k: '种类', v: itemKindText(item) }, // 2026-09-10 无人机：无人机 · 侦察机（子属性并入种类）
    { k: '单位体积', v: `${item.unitM3} m³` },
  ]
  if ((item.baseSellPriceIsk ?? 0) > 0) {
    lines.push({ k: '站内收价', v: `${item.baseSellPriceIsk.toLocaleString('zh-CN')} ISK/单位` })
  }
  if (item.refine !== undefined && item.refine.length > 0) {
    lines.push({
      k: '精炼配方',
      v: item.refine.map((r) => `${nameOf ? nameOf(r.mineralId) ?? r.mineralId : r.mineralId} ×${r.perOre}`).join('　'),
    })
  }
  if (item.kind === 'ammo' || item.kind === 'drone') {
    for (const l of itemCombatLines(item)) lines.push(l)
  }
  if (item.repairRestore !== undefined) {
    lines.push({ k: '修理组件', v: `单件基础回复 ${item.repairRestore} HP（结构/装甲各按层容量增幅，层越厚回得越多）` })
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
