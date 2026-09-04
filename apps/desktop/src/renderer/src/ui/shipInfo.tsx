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
import type { DamageResists, ItemDef, ModuleDef, ShipDef, DamageType } from '@whale/core'
import { ITEM_KIND_LABELS, MODULE_SLOTS, RACK_LABELS, rackOf, shipSlotsOf, SLOT_LABELS, shipRoleLabel, stackingOf } from '@whale/core'
import { hideTip, moveTip, showTip } from './Tooltip'

/** 伤害类型中文名 */
export const DMG_LABEL: Record<DamageType, string> = { kinetic: '动能', explosive: '高爆', plasma: '能量' }

/**
 * 伤害类型色 chip（V17.2 快速辨识）：颜色 = 我方三层血量色——
 * 动能 = 盾蓝（拆盾 ×1.5）/ 高爆 = 甲红（破甲 ×1.5）/ 能量 = 结构黄（均衡高基）。
 * label 可覆盖文字（如弹药全词"动能弹"），底色仍按类型。
 */
export function DmgChip({ t, label }: { t: DamageType; label?: ReactNode }): ReactNode {
  return <span className={`app-d-chip app-d-${t}`}>{label ?? DMG_LABEL[t]}</span>
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

/** 乘入合成速查：把该缺口值装到"25% 基础"船上的面板（示例句尾用；无键返回空串） */
function gapTo25Example(add: DamageResists | undefined): string {
  if (!add) return ''
  const key = (['kinetic', 'explosive', 'plasma'] as const).find((t) => (add[t] ?? 0) > 0)
  if (!key) return ''
  const a = add[key]!
  const panel = 1 - (1 - 0.25) * (1 - a)
  return `${DMG_LABEL[key]}：25% 基础船 → ${pct(panel)}`
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
      body = parts.join(' · ')
      break
    }
    case 'propulsion': {
      const parts: string[] = []
      if (mod.speedBonusPct !== undefined) parts.push(`速度 +${pct(mod.speedBonusPct)}`)
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
  }
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

/** 跃迁充能速率（派生展示）：动力(agility)越高充能越快 = agility×200%（0.5 → 100% 基准） */
export function warpChargePct(ship: ShipDef): number | null {
  if (ship.agility === undefined || !Number.isFinite(ship.agility)) return null
  return Math.round(ship.agility * 200)
}

/** 层位血量徽章（盾/甲/结构），悬停 title 显示该层三系抗性 */
function layerBadge(key: string, cls: string, label: string, hp: number | undefined, resist: DamageResists | undefined): ReactNode {
  const hasResist = resist !== undefined && Object.values(resist).some((v) => (v ?? 0) > 0)
  return (
    <span key={key} className={`app-combat-badge ${cls}`} title={hasResist ? `抗性：${resistsText(resist)}` : undefined}>
      {label} {fmt(hp)}
    </span>
  )
}

/** 三层血量徽章（盾/甲/结构 + 火力），各行其色 */
export function combatBadges(ship: ShipDef): ReactNode[] {
  const out: ReactNode[] = []
  out.push(layerBadge('s', 'is-shield', '盾', ship.shieldHp, ship.shieldResist))
  out.push(layerBadge('a', 'is-armor', '甲', ship.armorHp, ship.armorResist))
  out.push(layerBadge('h', 'is-hull', '结构', ship.hullHp, ship.hullResist))
  if (ship.powerBonus !== undefined && ship.powerBonus > 0) {
    out.push(
      <span key="p" className="app-combat-badge is-power">
        火力 +{Math.round(ship.powerBonus * 100)}%
      </span>,
    )
  }
  return out
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
    { k: '定位 / 档次', v: `${shipRoleLabel(ship.role)} · T${ship.tier}` },
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
    const entries = Object.entries(mod.shieldResistAdd ?? {}).filter(([, val]) => (val ?? 0) > 0)
    if (entries.length > 0) {
      const ex = gapTo25Example(mod.shieldResistAdd)
      const tail = ex ? `抗 +${pct(entries[0]![1]!)}（乘入制：${ex}；上限 90%）` : `抗 +${pct(entries[0]![1]!)}（乘入制，上限 90%）`
      lines.push({
        k: '护盾抗性（乘入制）',
        v: (
          <>
            <DmgChip t={entries[0]![0] as DamageType} />
            <span className="app-dim">{` ${tail}`}</span>
          </>
        ),
      })
    }
  } else if (mod.slot === 'armor') {
    if (mod.armorHpBonus !== undefined) lines.push({ k: '装甲容量', v: `+${pct(mod.armorHpBonus)}` })
    const entries = Object.entries(mod.armorResistAdd ?? {}).filter(([, val]) => (val ?? 0) > 0)
    if (entries.length > 0) {
      const ex = gapTo25Example(mod.armorResistAdd)
      const tail = ex ? `抗 +${pct(entries[0]![1]!)}（乘入制：${ex}；上限 90%）` : `抗 +${pct(entries[0]![1]!)}（乘入制，上限 90%）`
      lines.push({
        k: '装甲抗性（乘入制）',
        v: (
          <>
            <DmgChip t={entries[0]![0] as DamageType} />
            <span className="app-dim">{` ${tail}`}</span>
          </>
        ),
      })
    }
  } else if (mod.slot === 'propulsion') {
    if (mod.speedBonusPct !== undefined) lines.push({ k: '加力推进', v: `战斗速度 +${pct(mod.speedBonusPct)}` })
    if (mod.hitPenalty !== undefined && mod.hitPenalty > 0) {
      lines.push({ k: '常驻代价', v: `开火命中 ×${(1 - mod.hitPenalty).toFixed(2)}（全部武器，进胜率预估）` })
    }
    lines.push({ k: '说明', v: '弃船逃生 / 跃迁充能仍随船体动力，不受模块影响' })
  } else if (mod.slot === 'turret') {
    if (mod.damageType !== undefined) {
      lines.push({
        k: '弹药',
        v: (
          <>
            <span className="app-dim">配弹：</span>
            <DmgChip t={mod.damageType} label={`${DMG_LABEL[mod.damageType]}弹`} />
            <span className="app-dim">（固定弹种，出发只装此型）</span>
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
    if (mod.dmgMult !== undefined) lines.push({ k: '单发伤害', v: `弹伤害 ×${mod.dmgMult}（再 × 炮术 / 船火力）` })
  } else if (mod.slot === 'missile') {
    // V18B-1 导弹架：武器卡（与炮台同参数字段，性格差异 = 无视近盲 + 追踪命中）
    lines.push({
      k: '弹头',
      v: (
        <>
          <span className="app-dim">配弹：</span>
          <DmgChip t={mod.damageType ?? 'explosive'} label="爆破导弹" />
          <span className="app-dim">（导弹架专用，出发只装此型）</span>
        </>
      ),
    })
    if (mod.maxRangeM !== undefined) lines.push({ k: '射程带', v: rangeText(mod.minRangeM, mod.maxRangeM) })
    lines.push({ k: '弹道特性', v: '近盲安全射距（太近会炸到自己）· 追踪命中：不随距离衰减' })
    if (mod.hitRate !== undefined) lines.push({ k: '追踪命中', v: `${pct(mod.hitRate)}（不再乘距离衰减；仍受攻防命中修正与回避影响）` })
    if (mod.reloadMs !== undefined) lines.push({ k: '装填', v: `${(mod.reloadMs / 1000).toFixed(1)} 秒/发（单发高伤节奏）` })
    if (mod.dmgMult !== undefined) lines.push({ k: '单发伤害', v: `弹头伤害 ×${mod.dmgMult}（再 × 炮术 / 船火力）` })
  } else if (mod.slot === 'laser') {
    // V18B-2 激光炮：能量系武器形态（必中光束 + 威力随距离衰减）
    lines.push({
      k: '弹种',
      v: (
        <>
          <span className="app-dim">消耗：</span>
          <DmgChip t={mod.damageType ?? 'plasma'} label="能量弹药" />
          <span className="app-dim">（激光炮专用，出发预载此型）</span>
        </>
      ),
    })
    if (mod.maxRangeM !== undefined) lines.push({ k: '射程带', v: rangeText(mod.minRangeM, mod.maxRangeM) })
    lines.push({ k: '光束特性', v: '必中（射程带内锁定即命中，无视距离衰减与回避）· 无近盲' })
    if (mod.falloff !== undefined) {
      const far = (1 + (mod.falloff ?? 0)) / 2
      lines.push({
        k: '威力衰减',
        v: `距离只削威力不削命中（幅度为命中衰减的一半）——远端威力 ×${far.toFixed(2)}`,
      })
    }
    if (mod.reloadMs !== undefined) lines.push({ k: '装填', v: `${(mod.reloadMs / 1000).toFixed(1)} 秒/发` })
    if (mod.dmgMult !== undefined) lines.push({ k: '单发伤害', v: `能量弹药伤害 ×${mod.dmgMult}（再 × 炮术 / 船火力）` })
  } else if (mod.slot === 'drone-rack') {
    if (mod.droneBayBonusM3 !== undefined) {
      lines.push({ k: '无人机舱扩展', v: `+${fmt(mod.droneBayBonusM3)} m³（携带/放飞上限，与无人机装置可复数叠加）` })
    }
  } else if (mod.slot === 'drone-tac') {
    if (mod.droneDmgBonus !== undefined) {
      lines.push({ k: '无人机伤害', v: `+${pct(mod.droneDmgBonus)}（乘入放飞无人机单发；线性可叠）` })
    }
  } else if (mod.slot === 'support') {
    // V18.1 支援件：按效果字段渲染（低槽 = 稳定器/射速计算机；中槽 = 索敌/陀螺）
    const dmg = mod.damageTypeBonusPct
    if (dmg && Object.keys(dmg).length > 0) {
      const tail = '只加成对应系炮台单发，不影响无人机'
      lines.push({
        k: '炮台伤害',
        v: (
          <>
            {Object.entries(dmg)
              .filter(([, v]) => (v ?? 0) > 0)
              .map(([t, v]) => (
                <span key={t} className="app-stack-inline">
                  <DmgChip t={t as DamageType} />
                  <span className="app-dim">{` +${pct(v ?? 0)}（${tail}）`}</span>
                </span>
              ))}
          </>
        ),
      })
    }
    if (mod.reloadCutPct !== undefined) {
      lines.push({ k: '射速支援', v: `炮台装填间隔 −${pct(mod.reloadCutPct)}（装填 ÷ ${(1 / (1 - (mod.reloadCutPct ?? 0))).toFixed(2)}，只作用于炮台）` })
    }
    if (mod.hitBonusPct !== undefined) {
      lines.push({ k: '命中支援', v: `炮台命中 ×${(1 + (mod.hitBonusPct ?? 0)).toFixed(2)}（同类多装按 EVE 曲线递减）` })
    }
    if (mod.evasionGapPct !== undefined) {
      lines.push({ k: '回避支援', v: `被命中缺口削减 ${pct(mod.evasionGapPct)}——敌命中 60% 时 ×${(1 - (mod.evasionGapPct ?? 0)).toFixed(2)}；全船生效` })
    }
  }
  // V18.1 叠加方式标签（所有装备统一：收敛件 = 多装递减；线性件 = 全额叠加）
  const st = stackingOf(mod)
  if (st.group === 'flat') {
    lines.push({ k: '叠加方式', v: '可多装 · 全额叠加（效果线性求和；上限看 CPU）' })
  } else if (st.group === 'curve') {
    lines.push({ k: '叠加方式', v: '同类多装收益递减（EVE 叠加曲线：第 2 件 ≈87%、第 3 件 ≈57%）' })
  } else {
    lines.push({ k: '叠加方式', v: '同类多装收益递减（缺口复合：1 − (1−a)(1−b)；第 2 件再削剩余缺口）' })
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
  note = '已生效战斗数值：抗性为整数主抗制；增强器以缺口乘入合成（上限 90%）',
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
    { k: '种类', v: ITEM_KIND_LABELS[item.kind] ?? item.kind },
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
    lines.push({ k: '修理组件', v: `单件修复船体耐久 +${Math.round(item.repairRestore * 100)}%` })
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
