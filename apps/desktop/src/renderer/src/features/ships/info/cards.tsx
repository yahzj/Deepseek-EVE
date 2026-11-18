import { type AnomalyDef, foeDamageComposition, type DamageResists, type ShipDef, type ItemDef, type UnitSpec, type BattleBalance, ceilFinalQuantity, DEFAULT_BALANCE, type ModuleDef, wormholeIsShapedItem, wormholeShapeOf, SYNAPTIC_ACCELERANT_MS, SYNAPTIC_ACCELERANT_MUL, JUMP_FUEL_SPEED_MUL, invasionBeaconTypeOf, HIGH_SEC_PENALTY, WEEKEND_MIN_STANDING, DC_LOCK_MS } from '@whale/core'
import type { ReactNode, ElementType } from 'react'
import { DmgChip, resistsText, fmt, type InfoLine, pct } from './primitives'
import { tr } from '../../../i18n/locale'
import { shipCurrentLines, shipInfoLines } from './shipLines'
import { hoverTipProps } from '../../../ui/Tooltip'
import type { GameEngine } from '../../../game/engine'
import { moduleInfoLines } from './moduleLines'
import { kindTextOfItem } from '../../../ui/labelsText'

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

export interface BadgeOver {
  hp?: { s: number; a: number; h: number }
  resists?: { shield?: DamageResists; armor?: DamageResists; hull?: DamageResists }
}

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

export function combatBadges(ship: ShipDef, over?: BadgeOver): ReactNode[] {
  const hp = over?.hp
  const res = over?.resists
  return [
    layerBadge('s', 'is-shield', tr("ui.FitPage.014"), hp?.s ?? ship.shieldHp, res?.shield ?? ship.shieldResist),
    layerBadge('a', 'is-armor', tr("ui.FitPage.015"), hp?.a ?? ship.armorHp, res?.armor ?? ship.armorResist),
    layerBadge('h', 'is-hull', tr("ui.ShipPage.023"), hp?.h ?? ship.hullHp, res?.hull ?? ship.hullResist),
  ]
}

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

export function moduleHoverContent(
  mod: ModuleDef,
  hint?: ReactNode,
  engine?: GameEngine,
  shipId?: string,
  ordinal = 1,
): ReactNode {
  return infoCardContent(
    mod.name,
    moduleInfoLines(mod, engine, shipId, ordinal),
    mod.description,
    hint ? <div className="app-info-note">{hint}</div> : null,
  )
}

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

export function itemHoverContent(
  item: ItemDef,
  nameOf?: (id: string) => string | undefined,
  hint?: ReactNode,
): ReactNode {
  return infoCardContent(item.name, itemInfoLines(item, nameOf), item.description, hint ? <div className="app-info-note">{hint}</div> : null)
}

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

export function itemInfoLines(item: ItemDef, nameOf?: (id: string) => string | undefined, includePrice = true): InfoLine[] {
  const lines: InfoLine[] = [
    { k: tr("ui.Handbook.005"), v: kindTextOfItem(item) },
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
  if (item.repairDrone) lines.push({ k: tr('ui.itemSubs.001'), v: tr('ui.repairDrone.003', {
    p1: (item.repairIntervalMs ?? 20000) / 1000, p2: item.repairArmorHp ?? 0, p3: item.repairHullHp ?? 0,
    p4: nameOf?.(item.repairKit ?? '') ?? item.repairKit ?? '',
  }) })
  if (item.repairRestore !== undefined) {
    lines.push({ k: tr("ui.itemSubs.001"), v: tr("ui.shipInfo.178", { p1: item.repairRestore }) })
  }
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
    lines.push({ k: tr('ui.Expedition.068'), v: WEEKEND_MIN_STANDING })
    lines.push({ k: tr('ui.itemSpecs.009'), v: tr('ui.itemSpecs.010', { p1: HIGH_SEC_PENALTY }) })
  } else if (item.id === 'repairkit-dc') {
    lines.push({ k: tr('ui.itemSpecs.013'), v: tr('ui.shipInfo.207', { p1: DC_LOCK_MS / 1000 }) })
  }
  return lines
}

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
