/**
 * V10.5/V10.5b 统一舰船/装备属性展示模块（装配页 / 舰船悬停 / 手册图鉴 共用同一数据源与渲染）。
 *
 * 设计（中文说明）：
 * - 所有"舰船战斗数值"只在这里生成一次：装配页当前船、各页面舰船悬停浮层、图鉴详情窗
 *   统一调用——将来引擎启用战斗数值或新增字段，只改这一处；
 * - V16.1：抗性简化（整数主抗制：每层至多一个主抗型，信息行只列非零项，其余 = 0 易心算）；
 * - V16.1：删除废弃展示（锁定目标数/起跳时间），"跃迁充能（随动力）"由 agility 派生展示；
 * - 间接属性（速度/跃迁/质量/锁定/信号，V10.5b 保留项）显示优先级低：
 *   只出现在装配界面（shipIndirectLines），不进悬停浮层与图鉴；
 * - 契约数值一律附注"战斗系统启用后生效"，避免误读为已生效属性。
 */
import type { ReactNode } from 'react'
import type { DamageResists, ItemDef, ModuleDef, ShipDef, DamageType, WeaponSize } from '@whale/core'
import { MODULE_SLOTS, SLOT_LABELS, shipRoleLabel } from '@whale/core'
import { hideTip, moveTip, showTip } from './Tooltip'

/** 伤害类型中文名 */
export const DMG_LABEL: Record<DamageType, string> = { kinetic: '动能', explosive: '高爆', plasma: '能量' }
/** 弹/武器尺寸中文名 */
export const SIZE_LABEL: Record<WeaponSize, string> = { light: '轻', heavy: '重' }

/** 一行键值信息 */
export interface InfoLine {
  k: string
  v: ReactNode
}

const fmt = (n: number | undefined): string => (n === undefined || !Number.isFinite(n) ? '—' : n.toLocaleString('zh-CN'))
const pct = (n: number): string => `${Math.round(n * 100)}%`

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

/** 六槽列表文本（当前模型：所有船共用六槽，每槽一件） */
export function slotListText(): string {
  return MODULE_SLOTS.map((s) => SLOT_LABELS[s]).join(' · ')
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
  lines.push({ k: '槽位', v: slotListText() })
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

/** 装备统一信息行（基础加成 + V10.5b 契约字段：按家族展示已就位数值与 CPU 占用） */
export function moduleInfoLines(mod: ModuleDef): InfoLine[] {
  const lines: InfoLine[] = [{ k: '槽位 / 加成', v: `${SLOT_LABELS[mod.slot]} · ${Math.round(mod.bonus * 100)}%` }]
  if (mod.slot === 'shield') {
    const parts: string[] = []
    if (mod.shieldHpBonus !== undefined) parts.push(`容量 +${Math.round(mod.shieldHpBonus * 100)}%`)
    if (mod.shieldResistBonus !== undefined) parts.push(`抗性（三系等量）+${Math.round(mod.shieldResistBonus * 100)}%`)
    if (parts.length > 0) lines.push({ k: '战斗契约', v: parts.join('　') })
  } else if (mod.slot === 'armor') {
    const parts: string[] = []
    if (mod.armorHpBonus !== undefined) parts.push(`容量 +${Math.round(mod.armorHpBonus * 100)}%`)
    if (mod.armorResistBonus !== undefined) parts.push(`抗性（三系等量）+${Math.round(mod.armorResistBonus * 100)}%`)
    if (parts.length > 0) lines.push({ k: '战斗契约', v: parts.join('　') })
  } else if (mod.slot === 'propulsion') {
    if (mod.agilityBonus !== undefined) lines.push({ k: '战斗契约', v: `机动 +${mod.agilityBonus}` })
  } else if (mod.slot === 'turret') {
    const parts: string[] = []
    if (mod.weaponSize !== undefined) parts.push(`配弹：${SIZE_LABEL[mod.weaponSize]}弹`)
    if (mod.ammoPerEngagement !== undefined) parts.push(`每场耗弹 ×${mod.ammoPerEngagement}`)
    if (parts.length > 0) lines.push({ k: '战斗契约', v: parts.join('　') })
  }
  if (mod.cpuUse !== undefined) lines.push({ k: 'CPU 占用', v: fmt(mod.cpuUse) })
  return lines
}

/** 弹药/无人机统一附加行（物品行在物品图鉴中的补充信息） */
export function itemCombatLines(item: ItemDef): InfoLine[] {
  const lines: InfoLine[] = []
  if (item.damageType !== undefined) lines.push({ k: '伤害类型', v: DMG_LABEL[item.damageType] ?? item.damageType })
  if (item.ammoSize !== undefined) lines.push({ k: '弹种尺寸', v: SIZE_LABEL[item.ammoSize] ?? item.ammoSize })
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
  note = '战斗数值为 V10.5 契约：战斗系统启用后生效',
}: {
  ship: ShipDef
  children: ReactNode
  block?: boolean
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
  return (
    <span
      className={`app-ship-hover${block ? ' is-block' : ''}`}
      onMouseEnter={(e) => showTip(content, e.clientX, e.clientY)}
      onMouseMove={(e) => moveTip(content, e.clientX, e.clientY)}
      onMouseLeave={() => hideTip()}
    >
      {children}
    </span>
  )
}
