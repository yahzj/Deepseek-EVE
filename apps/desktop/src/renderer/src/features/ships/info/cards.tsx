/** 功能域职责拆分，保持原计算与顺序。 */
import { type AnomalyDef, foeDamageComposition, type DamageResists, type ShipDef, type ItemDef, type UnitSpec, type BattleBalance, ceilFinalQuantity, DEFAULT_BALANCE, type ModuleDef, wormholeIsShapedItem, wormholeShapeOf, SYNAPTIC_ACCELERANT_MS, SYNAPTIC_ACCELERANT_MUL, JUMP_FUEL_SPEED_MUL, invasionBeaconTypeOf, HIGH_SEC_PENALTY, DC_LOCK_MS } from '@whale/core'
import type { ReactNode, ElementType } from 'react'
import { DmgChip, resistsText, fmt, type InfoLine, pct } from './primitives'
import { tr } from '../../../i18n/locale'
import { shipCurrentLines, shipInfoLines } from './shipLines'
import { hoverTipProps } from '../../../ui/Tooltip'
import type { GameEngine } from '../../../game/engine'
import { moduleInfoLines } from './moduleLines'
import { kindTextOfItem } from '../../../ui/labelsText'

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

/** 装后覆盖（装配页把徽章数值/抗性换成 createPlayerSpec 合成快照；其它调用点不传 = 船体基础值） */
export interface BadgeOver {
  hp?: { s: number; a: number; h: number }
  resists?: { shield?: DamageResists; armor?: DamageResists; hull?: DamageResists }
}

/** 层位血量徽章（盾/甲/结构），悬停 title 显示该层三系抗性 */
export function layerBadge(
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
 * 传 `current` 则整卡改报**当前属性**（舰队页；2026-09-26 船长令）。
 */
export function ShipHover({
  ship,
  children,
  block = false,
  as = 'span',
  className,
  note = tr('ui.Handbook.181'),
  current,
}: {
  ship: ShipDef
  children: ReactNode
  block?: boolean
  as?: ElementType
  className?: string
  note?: string
  /**
   * **当前属性**（船长 2026-09-26：「我的舰队页面中，玩家鼠标悬停舰船时，应该显示舰船的当前
   * 属性，而不是基础属性」）：传本舰的 `createPlayerSpec` 快照 ⇒ 血量/抗性/命中/回避/机动速度/
   * 无人机舱合计 一律换成装后合成值，顶部三层血量徽章同步；**不带间接属性块**（同日复令
   * 「不要显示显示间接属性，过于臃肿」）。
   * **不传 = 基础属性**（图鉴 / 市场 / 船坞那条路，与船长同日「图鉴内按照基础属性算」一致）。
   */
  current?: { spec: UnitSpec; battle?: BattleBalance; droneBayTotal?: number }
}) {
  const spec = current?.spec
  const content = (
    <>
      <span className="app-ship-hover-title">{ship.name}</span>
      <span className="app-combat-badges">
        {combatBadges(
          ship,
          spec
            ? {
                hp: { s: ceilFinalQuantity(spec.hp.s), a: ceilFinalQuantity(spec.hp.a), h: ceilFinalQuantity(spec.hp.h) },
                resists: spec.resists,
              }
            : undefined,
        )}
      </span>
      {spec ? (
        <InfoTable
          lines={shipCurrentLines(ship, spec, {
            battle: current?.battle ?? DEFAULT_BALANCE.battle,
            droneBayTotal: current?.droneBayTotal,
          })}
        />
      ) : (
        <InfoTable lines={shipInfoLines(ship)} />
      )}
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
export function moduleHoverContent(
  mod: ModuleDef,
  hint?: ReactNode,
  engine?: GameEngine,
  shipId?: string,
  /** **本件在同族里的位序**（1 起；`fittedEffectParamsOf` 折权用）——由调用方按装配位序给 */
  ordinal = 1,
): ReactNode {
  return infoCardContent(
    mod.name,
    moduleInfoLines(mod, engine, shipId, ordinal),
    mod.description,
    hint ? <div className="app-info-note">{hint}</div> : null,
  )
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
export function itemInfoLines(item: ItemDef, nameOf?: (id: string) => string | undefined, includePrice = true): InfoLine[] {
  const lines: InfoLine[] = [
    { k: tr("ui.Handbook.005"), v: kindTextOfItem(item) }, // 2026-09-10 无人机：无人机 · 侦察机（子属性并入种类）
    { k: tr("ui.Handbook.006"), v: `${item.unitM3} m³` },
  ]
  if (includePrice && (item.baseSellPriceIsk ?? 0) > 0) {
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
  // ⟪文案调整 2026-10-04⟫ 说明不手写数字，形状和消耗品读数由真实单点提供。
  if (wormholeIsShapedItem(item.id)) {
    const shape = wormholeShapeOf(item.id)
    lines.push({ k: tr('ui.itemSpecs.001'), v: tr('ui.itemSpecs.002', { p1: shape.w, p2: shape.h, p3: shape.w * shape.h }) })
  }
  if (item.id === 'synaptic-accelerant') {
    lines.push({ k: tr('ui.itemSpecs.003'), v: tr('ui.itemSpecs.004', { p1: SYNAPTIC_ACCELERANT_MS / 3_600_000 }) })
    lines.push({ k: tr('ui.itemSpecs.005'), v: `×${SYNAPTIC_ACCELERANT_MUL}` })
  } else if (item.id === 'jump-fuel') {
    lines.push({ k: tr('ui.itemSpecs.006'), v: `×${JUMP_FUEL_SPEED_MUL}` })
    lines.push({ k: tr('ui.itemSpecs.007'), v: tr('ui.itemSpecs.008') })
  } else if (invasionBeaconTypeOf(item.id)) {
    lines.push({ k: tr('ui.itemSpecs.009'), v: tr('ui.itemSpecs.010', { p1: HIGH_SEC_PENALTY }) })
  } else if (item.id === 'repairkit-dc') {
    lines.push({ k: tr('ui.itemSpecs.013'), v: tr('ui.shipInfo.207', { p1: DC_LOCK_MS / 1000 }) })
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
