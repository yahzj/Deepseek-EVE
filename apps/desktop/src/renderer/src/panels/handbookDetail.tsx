import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { shipCategoryKeyOf } from '@whale/core'
import type { BlueprintDef, DamageType, DroneClass, FoeShipDef, ItemDef, ItemKind, ModuleDef, ShipBlueprintDef, ShipDef, ShipRole } from '@whale/core'
import { itemRarityTierOf } from '@whale/data'
import { handMarketKeyOf } from '../ui/marketJump'
import { kindText, slotText, shipRoleText, crestFamOf, shipTierText, kindTextOfItem } from '../ui/labelsText'
import { Glyph, partToneKeyOf, itemGlyphName } from '../ui/Glyphs'
import { toneOfAny } from '../ui/tones'
import { DmgChip, itemCombatLines, itemInfoLines, moduleInfoLines, moduleShortEffect, shipCodexBaseLines, shipIndirectLines } from '../ui/shipInfo'
import { plainSkillDesc } from '../ui/skillText'
import { foeBriefLinesOfShip, mountLabelText } from '../ui/foeBrief'
import { ShipSprite } from '../ui/ShipSprite'
import { Panel } from '@whale/ui'
import { tr } from '../i18n/locale'
import type { GameEngine } from '../game/engine'
import type { GridCell, RawData } from './Handbook'

export const kindName = (k: string): string => kindText(k as Parameters<typeof kindText>[0])
export const slotName = (k: string): string => slotText(k)
export const roleName = (k: string): string => shipRoleText(k as Parameters<typeof shipRoleText>[0])


export function marketKeyOf(engine: GameEngine, cell: GridCell): string | null {
  return handMarketKeyOf(engine.ctx, cell.tab, cell.key)
}

export function moduleCellOf(mod: ModuleDef): GridCell {
  const crest = crestFamOf(mod.id)
  return {
    key: mod.id,
    tab: 'modules',
    glyph: mod.slot,
    name: mod.name,
    sub: `${slotName(mod.slot)} · ${moduleShortEffect(mod)}`,
    raw: mod as unknown as RawData,
    rarity: itemRarityTierOf(mod.id),
    ...(crest !== undefined ? { crest } : {}),
  }
}

export function shipCellOf(ship: ShipDef): GridCell {
  const cls = shipCategoryKeyOf(ship)
  const crest = crestFamOf(ship.id)
  return {
    key: ship.id,
    tab: 'ships',
    glyph: cls,
    name: ship.name,
    sub: `${roleName(cls)} · ${shipTierText(ship.tier)} · ${ship.cargoM3.toLocaleString('zh-CN')} m³`,
    raw: ship as unknown as RawData,
    rarity: itemRarityTierOf(ship.id),
    shipId: ship.id,
    shipRole: ship.role,
    ...(crest !== undefined ? { crest } : {}),
  }
}

export function itemCellOf(item: ItemDef): GridCell {
  const crest = crestFamOf(item.id)
  return {
    key: item.id,
    tab: 'items',
    glyph: item.kind === 'part' ? partToneKeyOf(item.id) : itemGlyphName(item.id, item.kind),
    name: item.name,
    sub: `${kindName(item.kind)} · ${item.unitM3} m³`,
    raw: item as unknown as RawData,
    rarity: itemRarityTierOf(item.id),
    ...(crest !== undefined ? { crest } : {}),
  }
}

export function blueprintCellOf(engine: GameEngine, bp: BlueprintDef): GridCell {
  const prodMod = bp.moduleId !== undefined ? engine.ctx.modules.get(bp.moduleId) : undefined
  const crest = crestFamOf(bp.moduleId)
  return {
    key: bp.id,
    tab: 'blueprints',
    glyph: 'blueprint',
    name: bp.name,
    sub:
      bp.itemId !== undefined
        ?
          `${kindName(engine.ctx.items.get(bp.itemId)?.kind ?? 'ammo')} · ${engine.ctx.items.get(bp.itemId)?.name ?? bp.itemId}`
        : tr("ui.Handbook.317", { p1: prodMod?.name ?? bp.moduleId ?? '' }),
    raw: bp as unknown as RawData,
    rarity: itemRarityTierOf(bp.id),
    ...(crest !== undefined ? { crest } : {}),
  }
}

export function shipBlueprintCellOf(engine: GameEngine, bp: ShipBlueprintDef): GridCell {
  const crest = crestFamOf(bp.shipId)
  return {
    key: bp.id,
    tab: 'blueprints',
    glyph: 'blueprint',
    name: bp.name,
    sub: tr("ui.Handbook.249", { p1: engine.ctx.ships.get(bp.shipId)?.name ?? bp.shipId }),
    raw: bp as unknown as RawData,
    rarity: itemRarityTierOf(bp.id),
    ...(crest !== undefined ? { crest } : {}),
  }
}


export function DetailBody({ engine, cell }: { engine: GameEngine; cell: GridCell }) {
  const r = cell.raw
  const rows: Array<[string, ReactNode]> = []
  let note: ReactNode = null

  if (cell.tab === 'items') {
    const kind = String(r.kind ?? '')
    rows.push([
      tr("ui.Handbook.005"),
      kindTextOfItem({ kind: kind as ItemKind, droneClass: r.droneClass as DroneClass | undefined }),
    ])
    rows.push([tr("ui.Handbook.006"), `${Number(r.unitM3 ?? 0)} m³`])
    const itemId = String(r.id ?? '')
    const itemDef = itemId ? engine.ctx.items.get(itemId) : undefined
    if (itemDef && (itemDef.kind === 'ammo' || itemDef.kind === 'drone')) {
      for (const line of itemCombatLines(itemDef)) rows.push([line.k, line.v])
    }
    const refine = (r.refine as Array<{ mineralId: string; perOre: number }> | undefined) ?? []
    if (refine.length > 0) {
      rows.push([
        tr("ui.Handbook.007"),
        refine
          .map((row) => `${engine.ctx.items.get(row.mineralId)?.name ?? row.mineralId} ×${row.perOre}`)
          .join('　'),
      ])
    }
  } else if (cell.tab === 'modules') {
    const modId = String(r.id ?? '')
    const modDef = modId ? engine.ctx.modules.get(modId) : undefined
    if (modDef) {
      for (const line of moduleInfoLines(modDef)) rows.push([line.k, line.v])
    } else {
      rows.push([tr("ui.Handbook.008"), tr("ui.Handbook.106", { p1: slotName(String(r.slot ?? '')), p2: Math.round(Number(r.bonus ?? 0) * 100) })])
    }
  } else if (cell.tab === 'ships') {
    const shipId = String(r.id ?? '')
    const shipDef = shipId ? engine.ctx.ships.get(shipId) : undefined
    if (shipDef) {
      for (const line of shipCodexBaseLines(shipDef)) rows.push([line.k, line.v])
      for (const line of shipIndirectLines(shipDef)) rows.push([line.k, line.v])
      rows.push([tr("ui.Handbook.315"), Number(r.priceIsk ?? 0) <= 0 ? tr("ui.Handbook.107") : tr("ui.Handbook.108")])
      note = tr('ui.Handbook.181')
    } else {
      const cls = shipCategoryKeyOf(r as unknown as { role?: ShipRole; shieldHp?: number; armorHp?: number })
      rows.push([tr("ui.Handbook.009"), `${roleName(cls)} · ${shipTierText(Number(r.tier ?? 0))}`])
      rows.push([tr("ui.Handbook.010"), `${Number(r.cargoM3 ?? 0).toLocaleString('zh-CN')} m³`])
      rows.push([tr("ui.Handbook.011"), tr("ui.shipInfo.130", { p1: Number(r.cycleSeconds ?? 0), p2: Number(r.oreUnitsPerCycle ?? 0) })])
      rows.push([tr("ui.Handbook.012"), `${Math.round(Number(r.agility ?? 0) * 100)}%`])
      if (Number(r.priceIsk ?? 0) <= 0) rows.push([tr("ui.Handbook.315"), tr("ui.Handbook.107")])
    }
  } else if (cell.tab === 'blueprints') {
    const materials = (r.materials as Array<{ itemId: string; count: number }> | undefined) ?? []
    const moduleId = r.moduleId !== undefined ? String(r.moduleId) : undefined
    const itemId = r.itemId !== undefined ? String(r.itemId) : undefined
    const shipId = r.shipId !== undefined ? String(r.shipId) : undefined
    let productName = ''
    const prodRows: Array<[string, ReactNode]> = []
    if (itemId !== undefined) {
      const itemDef = engine.ctx.items.get(itemId)
      productName = tr("ui.Handbook.109", { p1: itemDef?.name ?? itemId })
      if (itemDef) {
        for (const l of itemInfoLines(itemDef, (id) => engine.ctx.items.get(id)?.name)) prodRows.push([l.k, l.v])
        if (itemDef.description) prodRows.push([tr("ui.Handbook.110"), itemDef.description])
      }
    } else if (moduleId !== undefined) {
      const modDef = engine.ctx.modules.get(moduleId)
      productName = tr("ui.Handbook.111", { p1: modDef?.name ?? moduleId })
      if (modDef) {
        for (const l of moduleInfoLines(modDef)) prodRows.push([l.k, l.v])
        if (modDef.description) prodRows.push([tr("ui.Handbook.110"), modDef.description])
      }
    } else {
      const shipDef = engine.ctx.ships.get(shipId ?? '')
      productName = tr("ui.Handbook.112", { p1: shipDef?.name ?? shipId ?? '' })
      if (shipDef) {
        for (const l of shipCodexBaseLines(shipDef)) prodRows.push([l.k, l.v])
        for (const l of shipIndirectLines(shipDef)) prodRows.push([l.k, l.v])
        if (shipDef.description) prodRows.push([tr("ui.Handbook.110"), shipDef.description])
      }
    }
    rows.push([tr("ui.MarketPage.016"), productName])
    for (const [k, v] of prodRows) rows.push([k, v])
    rows.push([
      tr("ui.MarketPage.018"),
      <span key="mats" className="app-detail-mats">
        {materials.map((m) => (
          <span key={m.itemId} className="app-detail-mat">
            {engine.ctx.items.get(m.itemId)?.name ?? m.itemId} ×{m.count.toLocaleString('zh-CN')}
          </span>
        ))}
      </span>,
    ])
    rows.push([tr("ui.Handbook.246"), tr("ui.Handbook.247", { p1: Math.round(Number(r.buildSeconds ?? 0) / 60) })])
  } else if (cell.tab === 'foe') {
    return <FoeBody cell={cell} engine={engine} />
  } else if (cell.tab === 'skills') {
    rows.push([tr("ui.Handbook.132"), String(r.group ?? '')])
    rows.push([tr("ui.Handbook.316"), tr("ui.Handbook.113", { p1: Number(r.rank ?? 0) })])
  }

  return (
    <div className="app-detail-body">
      {rows.map(([k, v]) => (
        <div key={k} className="app-detail-row">
          <span className="app-detail-key">{k}</span>
          <span className="app-detail-val">{v}</span>
        </div>
      ))}
      {String(r.description ?? '') !== '' ? (
        <div className="app-detail-desc">{plainSkillDesc(String(r.description))}</div>
      ) : null}
      {note !== null ? <div className="app-info-note">{note}</div> : null}
    </div>
  )
}

export function FoeBody({ cell, engine }: { cell: GridCell; engine: GameEngine }): ReactNode {
  const def = cell.raw as unknown as FoeShipDef
  const line = foeBriefLinesOfShip(def)
  const row = (k: string, v: ReactNode): ReactNode => (
    <div key={k} className="app-detail-row">
      <span className="app-detail-key">{k}</span>
      <span className="app-detail-val">{v}</span>
    </div>
  )
  const pctOf = (v: number | undefined): string => (v === undefined ? '—' : `${Math.round(v * 100)}%`)
  const mounts = line?.mounts ?? []
  return (
    <div className="app-detail-body">
      <div style={{ display: 'flex', justifyContent: 'center', margin: '2px 0 10px' }}>
        <ShipSprite shipId={def.id} size={200} engine={false} />
      </div>
      {row(tr('ui.Handbook.009'), `${line?.hull ?? ''}${def.elite === true ? ` · ${tr('ui.foeIntro.070')}` : ''}`)}
      {/* 伤害构成：用与卡面同一枚 `DmgChip`（三系伤害色）＋ shares 百分比（`ui.foeIntro.030` 的句式） */}
      {row(
        tr('ui.Expedition.217'),
        (() => {
          const mix = Object.entries(def.dmgMix ?? {}).sort((a, b) => b[1] - a[1])
          const total = mix.reduce((n, [, v]) => n + v, 0)
          if (mix.length === 0 || total <= 0) return '—'
          return (
            <>
              {mix.map(([t, v], i) => (
                <span key={t} className="app-stack-inline">
                  {i > 0 ? <span className="app-dim"> · </span> : null}
                  <DmgChip t={t as DamageType} />
                  <span className="app-dim">{` ${Math.round((v / total) * 100)}%`}</span>
                </span>
              ))}
            </>
          )
        })(),
      )}
      {/* 三层血**占比**（不是绝对血量：敌舰按威胁缩放，占比才是卡面口径） */}
      {row(
        `${tr('ui.FitPage.014')} / ${tr('ui.FitPage.015')} / ${tr('ui.ShipPage.023')}`,
        `${Math.round((def.split?.s ?? 0) * 100)}% / ${Math.round((def.split?.a ?? 0) * 100)}% / ${Math.round((def.split?.h ?? 0) * 100)}%`,
      )}
      {row(tr('ui.FitPage.006'), pctOf(def.hitRate))}
      {row(tr('ui.FitPage.007'), pctOf(def.evasion))}
      {/**
       * **攻击范围**（**2026-09-26 船长令**：「**在手册内的敌人，还会显示其基础速度和攻击范围**」）——
       * 标签复用既有的「射程带」（`ui.shipInfo.040`，与舰船属性表同词），数值 = `rangeMinM – rangeMaxM`。
       * （原先这一行用的是「锁定范围」的标签，语义不对 —— 那是"能锁多远"，这里要报**火力够到哪**。）
       */}
      {row(tr('ui.shipInfo.040'), `${def.rangeMinM ?? 0} – ${def.rangeMaxM ?? 0} m`)}
      {/**
       * ⚠ **不显示「单发伤害」**（**2026-09-26 船长令**：「**敌人的单发伤害不要显示，因为实际上
       * 并没有这个伤害**」）——`FoeShipDef.shotDmg` 是**舰级裸值**，实战单发在战斗建档时经
       * `dmgMul × 多舰船补偿 × 越线折扣 × 逐卡缩放` 才成形，卡面上报它等于报一个不存在的数。
       * 火力大小由上面那行**伤害构成占比**表达；装填仍留着（它是射速口径，不是伤害口径）。
       */}
      {row(tr('ui.shipInfo.032'), `${((def.reloadMs ?? 0) / 1000).toFixed(1)} s`)}
      {/**
       * **基础速度**（同上一条船长令）：`舰种基准 × speedRatio`，与战斗建档**同源同式**
       * （`combat.createFoeSpecsFromShips`：`HULL_CLASS_BASE_SPEED[舰种档] × speedRatio × speedMul`，
       * `speedMul` 只有编成条目会带、舰级不带 ⇒ 这里是"这条舰级的基础速度"）。
       * 基准表读 core 的 `hullClassBaseSpeedMps`（`{1:340, 2:295, 3:258, 4:205, 5:155}`，
       * data 包的 `HULL_CLASS_BASE_SPEED` 就是它的同源引用 ⇒ 不另存第二份数字）。
       * 船长2026-10-08：显示只保留基础m/s，不再附内部倍率。
       * ⚠ **标签不能用 `ui.shipInfo.009`**（那个键在"删最大速度"批里已删，`tr()` 会原样印出 id ——
       * 实测踩过：格子里印出 `ui.shipInfo.009 = 391 m/s`）⇒ 这里复用既有词条「机动速度」。
       */}
      {row(
        tr('ui.FitPage.049'),
        `${Math.round((engine.ctx.balance.battle.hullClassBaseSpeedMps[def.hullClassTier] ?? 0) * (def.speedRatio ?? 1))} m/s`,
      )}
      {row(tr('ui.Expedition.152', { p1: line?.bits[0] ?? '—' }), line !== null && line.bits.length > 1 ? line.bits.slice(1).join(' · ') : '—')}
      {mounts.map((m, i) =>
        row(`${mountLabelText()}${mounts.length > 1 ? ` ${i + 1}` : ''}`, `${m.name !== '' ? `${m.name}：` : ''}${m.effect}`),
      )}
    </div>
  )
}

export function CellDetail({
  engine,
  cell,
  onClose,
  onGotoMarket,
}: {
  engine: GameEngine
  cell: GridCell
  onClose: () => void
  onGotoMarket?: (goodKey: string) => void
}) {
  const tone = cell.tone ?? toneOfAny(cell.glyph)
  const marketKey = onGotoMarket ? marketKeyOf(engine, cell) : null
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="app-detail-mask" onClick={(e) => { e.stopPropagation(); onClose() }}>
      <div
        className="app-detail"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={cell.name}
        style={{ '--tone': tone } as React.CSSProperties}
      >
        <div className="app-detail-head">
          <span className="app-hand-cell-icon">
            {/* 舰船只/敌舰只：头部也画 SVG（与卡片同一张资产表）；其余条目仍是类别徽记 */}
            {cell.shipId !== undefined ? (
              <ShipSprite shipId={cell.shipId} role={cell.shipRole} size={120} engine={false} />
            ) : (
              <Glyph name={cell.glyph} size={44} color={tone} />
            )}
          </span>
          <div className="app-detail-title">
            <div className="app-detail-name">{cell.name}</div>
            <div className="app-detail-sub">{cell.sub}</div>
          </div>
          {/* 「↖ 查看市场」：只跳转、不下单（与舰船页/物品页/货舱页/组装机同一个 `onGotoMarket` 入口）
              —— 到市场页会自动搜到该商品并展开它的行情详情。⚠ 点它**同时关掉手册**：
              手册是覆盖层，不关就会盖在刚切过去的市场页上面、聚焦也看不见。 */}
          {marketKey !== null && onGotoMarket ? (
            <button
              className="app-btn is-small app-detail-goto"
              title={tr("ui.CargoPage.003")}
              onClick={() => {
                onClose()
                onGotoMarket(marketKey)
              }}
            >
              {tr("ui.CargoPage.001")}
            </button>
          ) : null}
        </div>
        <DetailBody engine={engine} cell={cell} />
        <div className="app-dim app-detail-tip">{tr("ui.Handbook.248")}</div>
      </div>
    </div>
  )
}

export function GroupSection({
  label,
  unit,
  count,
  children,
}: {
  label: string
  unit: string
  count: number
  children: ReactNode
}) {
  return (
    <Panel title={label} right={<span className="app-dim">{count} {unit}</span>}>
      {children}
    </Panel>
  )
}
