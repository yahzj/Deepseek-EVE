/**
 * 货仓页（T3）：顶部"查看船"选择条可切换查看舰队任一艘船的货仓。
 * - 每艘船一枚 chip：船名 + （驾驶中）标记 + 出勤徽标（shipBusyLabel）；
 * - 默认查看驾驶船；驾驶船变更后自动跟随；选中船不存在（卖/弃船）自动回驾驶船；
 * - 动作隔离（已确认口径 1甲/2甲/3甲）：装卸与出售只对"当前驾驶船"开放，
 *   副船/作业中的船一律只读查看。
 * - V10：按物品大类分组展示（矿石/矿物/气体/冰矿/弹药/无人机）。
 */
import { useEffect, useState } from 'react'
import {
  ITEM_KIND_ORDER,
  SLOT_LABELS,
  cargoCapacityM3Of,
  cargoOfShip,
  cargoUsedM3Of,
  fleetDefOf,
  haulingOccupiedM3,
  courierOccupiedM3,
  isAtHomeLike,
  itemKindLabel,
  marketGoodOf,
  shipBusyLabel,
  shipDisplayName,
} from '@whale/core'
import { Panel, ProgressBar } from '@whale/ui'
import { ItemHover, InfoTable, itemHoverContent, itemInfoLines, moduleHoverContent, ModuleHover, moduleInfoLines } from '../ui/shipInfo'
import { Glyph, inventoryItemTone, toneOf } from '../ui/Glyphs'
import { HintIcon } from '../ui/Hint'
import { ItemActionModal } from '../ui/ItemActionModal'
import { SellQtyModal } from '../ui/SellQtyModal'
import { RedeemFragmentButton } from '../ui/fragmentRedeem'
import type { ItemNavProps } from './ItemsPage'
import type { PageProps } from './common'
import { useL10n, cmdText } from '../i18n/locale'
import { isk, itemBuyQuote, m3 } from './common'
import { ItemGlyphGrid, ItemViewBar, RowGlyph, kindExtraNote, useItemView, type ItemGridCell } from '../ui/itemView'
import { tr } from '../i18n/locale'

const KIND_EMPTY: Record<string, string> = {
  ore: 'ui.CargoPage.010',
  mineral: 'ui.CargoPage.011',
  gas: 'ui.CargoPage.012',
  ice: 'ui.CargoPage.013',
  ammo: 'ui.CargoPage.014',
  drone: 'ui.CargoPage.015',
}

export function CargoPage({ engine, onToast, onGotoMarket }: PageProps & ItemNavProps) {
  const state = engine.state
  /** 语言（2026-09-19 船长令「英语本地化」）：界面串走 `t(中文源串)`；缺词条回退中文 */
  const { t } = useL10n()
  const piloted = state.shipId
  const [selId, setSelId] = useState<string>(piloted)
  // 驾驶船变更 → 查看跟随驾驶船（本页历史职责是"驾驶船货仓"，选副船只是临时查看）
  useEffect(() => {
    setSelId(piloted)
  }, [piloted])
  const fleetIds = Object.keys(state.fleet)
  const targetId = fleetIds.includes(selId) ? selId : piloted
  const isPiloted = targetId === piloted
  const targetName = shipDisplayName(state, engine.ctx, targetId)
  const busy = shipBusyLabel(state, engine.ctx, targetId)

  const cargo = cargoOfShip(state, targetId)
  const used = cargoUsedM3Of(state, engine.ctx, targetId)
  const cap = cargoCapacityM3Of(state, engine.ctx, targetId)
  // 2026-09-09 长途运输：驾驶船货仓被虚拟"运输货物"全部占用（不产生真实物品；显示用）
  const haulOcc = isPiloted && state.hauling.active ? haulingOccupiedM3(state, engine.ctx) : 0
  // 2026-09-18 快递改虚拟货物：在途快递按体积占用货舱（与长途运输同款语义）
  const courierOcc = isPiloted ? courierOccupiedM3(state) : 0
  const rows = Object.entries(cargo).filter(([, n]) => n > 0)
  // 2026-09-09（船长口径 A）：装备（模块）也可入货仓携带——单列「船载」组；按 1 m³/件 计入货舱
  const modRows = rows.filter(([id]) => engine.ctx.modules.get(id) !== undefined)

  // 图标/列表切换（手册同款；网格为浏览视图）
  const [view, setView] = useItemView()

  function handleSell(id: string, qty: number): void {
    // 2026-09-08（船长定）：市场随"协会基地网络"——母港与已建成副站皆可出售（副站不设独立市场，共用全局市场）
    if (!isAtHomeLike(state, engine.ctx)) {
      onToast(t('ui.CargoPage.020'), true)
      return
    }
    const r = engine.sellCargo(id, qty)
    if (!r.ok) onToast(cmdText(r) || t('ui.CargoPage.019'), true)
    else
      onToast(
        t('ui.CargoPage.021', {
          units: r.soldUnits.toLocaleString('zh-CN'),
          isk: r.gainedIsk.toLocaleString('zh-CN'),
        }),
      )
    setSellId(null)
    setPickId(null)
  }

  // 图标模式点选操作（船长 2026-09-05：网格也要能操作）
  const [pickId, setPickId] = useState<string | null>(null)
  const pickDef = pickId ? engine.ctx.items.get(pickId) : undefined
  const pickUnits = pickId ? (cargo[pickId] ?? 0) : 0
  const pickBuy = pickId ? itemBuyQuote(engine, pickId) : undefined
  // 2026-09-09：船载装备（模块）点选（与物品点选分开——模块信息/卸回装备库）
  const [pickMod, setPickMod] = useState<string | null>(null)
  const pickModDef = pickMod ? engine.ctx.modules.get(pickMod) : undefined
  const pickModUnits = pickMod ? (cargo[pickMod] ?? 0) : 0
  /**
   * **蓝图碎片**（2026-09-19 玩家报障「集齐了 25 个蓝图碎片，找不到在哪换成蓝图」）：
   * 货仓里也可能躺着碎片（打捞/回收后先落在仓库，玩家装船后就在这儿）⇒ 货仓行与点选弹层
   * 都给同一个「逆向解锁」按钮（组件单点 `ui/fragmentRedeem`，与物品页共用）。
   * 判据只认"这件是不是碎片"，按钮状态全部由组件读 core 单点。
   */
  const fragIds = new Set(engine.fragmentRedeemRows().map((r) => r.fragmentItemId))

  /** 2026-09-09（船长口径 A）：单行卸货——物品 → 物品仓库；模块 → 装备库（引擎分流） */
  function handleUnloadOne(id: string): void {
    const moved = engine.unloadCargoItem(id)
    if (moved === 0) onToast(t('ui.CargoPage.022'), true)
    else {
      const isMod = engine.ctx.modules.get(id) !== undefined
      onToast(
        isMod
          ? t('ui.CargoPage.023', { n: moved.toLocaleString('zh-CN') })
          : t('ui.CargoPage.024', { n: moved.toLocaleString('zh-CN') }),
      )
    }
    setPickId(null)
    setPickMod(null)
  }
  // 出售数量选择（船长 2026-09-05：支持只卖一部分）
  const [sellId, setSellId] = useState<string | null>(null)
  const sellDef = sellId ? engine.ctx.items.get(sellId) : undefined
  const sellUnits = sellId ? (cargo[sellId] ?? 0) : 0
  const sellBuy = sellId ? itemBuyQuote(engine, sellId) : undefined

  /** 快速查看市场订单（参照舰船市场入口：跳市场页并聚焦该商品；船长 2026-09-05） */
  function goMarket(id: string): void {
    const good = marketGoodOf(engine.ctx, 'item', id)
    if (good) onGotoMarket(good.key)
  }

  function handleUnloadAll(): void {
    // T9：卸货入仓库在任何空间站可用（母港与副站）
    if (state.awayGalaxy !== null) {
      onToast(t('ui.CargoPage.025'), true)
      return
    }
    const moved = engine.unloadAllToWarehouse()
    if (moved === 0) onToast(t('ui.CargoPage.026'), true)
    else onToast(t('ui.CargoPage.027', { n: moved.toLocaleString('zh-CN') }))
  }

  /** 2026-09-08（船长定）：非驾驶空闲舰船卸货入仓库 */
  function handleUnloadShip(id: string): void {
    const moved = engine.unloadShipAllToWarehouse(id)
    if (moved === -1) onToast(t('ui.CargoPage.028'), true)
    else if (moved === -2) onToast(t('ui.CargoPage.029'), true)
    else if (moved === -3) onToast(t('ui.CargoPage.030'), true)
    else if (moved === 0) onToast(t('ui.CargoPage.026'), true)
    else onToast(t('ui.CargoPage.031', { ship: targetName, n: moved.toLocaleString('zh-CN') }))
  }

  return (
    <div className="page-stack">
      <Panel
        title={t('ui.CargoPage.004')}
        hint={
          <HintIcon
            tip={
              isPiloted
                ? t('ui.CargoPage.032') +
                  (busy ? ' ' + t('ui.CargoPage.033', { b: busy }) : '')
                : t('ui.CargoPage.034', {
                    ship: targetName,
                    piloted: shipDisplayName(state, engine.ctx, piloted),
                  }) +
                  (busy ? ' ' + t('ui.CargoPage.035', { b: busy }) : ' ' + t('ui.CargoPage.036'))
            }
          />
        }
        right={
          isPiloted ? <span className="app-dim">{t('ui.CargoPage.007')}</span> : <span className="app-dim">{t('ui.CargoPage.008')}</span>
        }
      >
        <div className="app-cargo-ships">
          {fleetIds.map((id) => {
            const d = fleetDefOf(state, engine.ctx, id)
            const b = shipBusyLabel(state, engine.ctx, id)
            const isP = id === piloted
            const isSel = id === targetId
            return (
              <button
                key={id}
                className={`app-shipchip${isSel ? ' is-active' : ''}${isP ? ' is-piloted' : ''}`}
                onClick={() => setSelId(id)}
                title={isP ? tr("ui.CargoPage.007") : b ?? '该船闲置中'}
              >
                <span className="app-shipchip-name">
                  {d ? <span className={`app-role-dot is-${d.role}`} /> : null}
                  {shipDisplayName(state, engine.ctx, id)}
                </span>
                {isP ? <span className="app-shipchip-tag">{tr("ui.ShipPage.010")}</span> : null}
                {b ? <span className="app-shipchip-busy">·{b}</span> : null}
              </button>
            )
          })}
        </div>
        <div className="app-cargo-head">
          <ProgressBar
            value={cap > 0 ? ((used + haulOcc + courierOcc) / cap) * 100 : 0}
            tone={haulOcc + courierOcc > 0 ? 'warn' : cap > 0 && used / cap > 0.85 ? 'danger' : cap > 0 && used / cap > 0.6 ? 'warn' : 'normal'}
            label={tr("ui.CargoPage.056", { targetName: targetName, p2: m3(used + haulOcc + courierOcc), p3: cap > 0 ? cap.toLocaleString('zh-CN') : '—' })}
          />
          {haulOcc > 0 ? (
            <div className="app-dim" style={{ marginTop: 2 }}>
              {tr("ui.CargoPage.041")}
            </div>
          ) : null}
          {courierOcc > 0 ? (
            <div className="app-dim" style={{ marginTop: 2 }}>
              {tr("ui.CargoPage.042")} {courierOcc.toLocaleString('zh-CN')} {tr("ui.CargoPage.043")}
            </div>
          ) : null}
          {isPiloted ? (
            <button className="app-btn is-primary is-small" onClick={handleUnloadAll} disabled={rows.length === 0}>
              {tr("ui.CargoPage.037")}
            </button>
          ) : busy === null ? (
            // 2026-09-08（船长定）：空闲停靠的非驾驶舰船也可直接卸货入仓库（装船/出售仍限驾驶船）
            <button
              className="app-btn is-small"
              onClick={() => handleUnloadShip(targetId)}
              disabled={rows.length === 0}
              title={t('ui.CargoPage.018')}
            >
              {t('ui.CargoPage.037')}
            </button>
          ) : null}
        </div>
      </Panel>

      <ItemViewBar mode={view} onChange={setView} />
      {view === 'list' ? (
        <>
      {ITEM_KIND_ORDER.map((kind) => {
        const kindRows = rows.filter(([id]) => engine.ctx.items.get(id)?.kind === kind)
        // 矿石面板常驻（引导开采），其余分类空时不显示
        if (kindRows.length === 0 && kind !== 'ore') return null
        const emptyText =
          kind === 'ore' && !isPiloted
            ? t('ui.CargoPage.017', { ship: targetName })
            : (KIND_EMPTY[kind] !== undefined ? t(KIND_EMPTY[kind]!) : t('ui.CargoPage.016'))
        const extra = kindExtraNote(kind)
        return (
          <Panel
            key={kind}
            title={`${itemKindLabel(kind)}（${isPiloted ? t('ui.CargoPage.005') : t('ui.CargoPage.006')}）`}
            hint={extra ? <HintIcon tip={extra} /> : undefined}
            right={<span className="app-dim">{t('ui.CargoPage.009', { n: kindRows.length })}</span>}
          >
            {kindRows.length === 0 ? (
              <div className="app-dim app-inv-empty">{emptyText}</div>
            ) : (
              <ul className="app-inv-list">
                {kindRows.map(([id, units]) => {
                  const def = engine.ctx.items.get(id)
                  if (!def) return null
                  const buy = itemBuyQuote(engine, id)
                  return (
                    <ItemHover
                      key={id}
                      as="li"
                      item={def}
                      nameOf={(pid) => engine.ctx.items.get(pid)?.name}
                      className="app-inv-row"
                    >
                      <div className="app-inv-main">
                        <span className="app-inv-name">
                          <RowGlyph glyph={def.kind} tone={inventoryItemTone(id, def.kind)} /> {def.name}
                        </span>
                        <span className="app-inv-count">
                          ×{units.toLocaleString('zh-CN')}（{m3(units * def.unitM3)}{tr('ui.CargoPage.054')}{' '}
                          {buy !== undefined ? `${isk(buy)} ${tr('ui.FirstTasks.003')}` : '—'}
                        </span>
                      </div>
                      <div className="app-inv-btns">
                        {isPiloted && buy !== undefined ? (
                          <>
                            <button className="app-btn is-small is-primary" onClick={() => setSellId(id)}>
                              {tr("ui.CargoPage.038")}
                            </button>
                            <button
                              className="app-btn is-small"
                              title={t('ui.CargoPage.003')}
                              onClick={() => goMarket(id)}
                            >
                              {t('ui.CargoPage.001')}
                            </button>
                          </>
                        ) : isPiloted ? (
                          /* 2026-09-19 玩家报障修：碎片不在市场目录，但必须给兑现路（与物品页同一个组件） */
                          fragIds.has(id) ? (
                            <RedeemFragmentButton engine={engine} itemId={id} onToast={onToast} />
                          ) : (
                            <button className="app-btn is-small" disabled>
                              {tr("ui.CargoPage.039")}
                            </button>
                          )
                        ) : (
                          <span className="app-dim app-sr-eta">{tr("ui.CargoPage.044")}</span>
                        )}
                      </div>
                    </ItemHover>
                  )
                })}
              </ul>
            )}
          </Panel>
        )
      })}

      {/* 船载装备（2026-09-09 船长口径 A：模块可入货仓携带，按 1 m³/件 计入货舱；卸回装备库） */}
      {modRows.length > 0 ? (
        <Panel
          title={tr("ui.CargoPage.045")}
          right={<span className="app-dim">{modRows.length} {tr("ui.CargoPage.046")}</span>}
        >
          <ul className="app-inv-list">
            {modRows.map(([id, units]) => {
              const def = engine.ctx.modules.get(id)
              if (!def) return null
              return (
                /* 富卡悬停（与物品行 / 仓库装备行同一张卡）；"船载仅携带"那句降为卡内注脚
                   （2026-09-19 与仓库同步：装备行的悬停一律是富文本详细，不再只给一句简介）。 */
                <ModuleHover
                  key={id}
                  as="li"
                  mod={def}
                  className="app-inv-row"
                  hint={tr("ui.CargoPage.059")}
                >
                  <div className="app-inv-main">
                    <span className="app-inv-name">
                      <RowGlyph glyph={def.slot} /> {def.name}
                    </span>
                    <span className="app-inv-count">
                      ×{units.toLocaleString('zh-CN')}{tr("ui.CargoPage.047")} {m3(units)}）· {SLOT_LABELS[def.slot] ?? def.slot} · CPU{' '}
                      {def.cpuUse}
                    </span>
                  </div>
                  <div className="app-inv-btns">
                    {isPiloted ? (
                      <button className="app-btn is-small is-primary" onClick={() => handleUnloadOne(id)}>
                        {tr("ui.CargoPage.048")}
                      </button>
                    ) : (
                      <span className="app-dim app-sr-eta">{tr("ui.CargoPage.044")}</span>
                    )}
                  </div>
                </ModuleHover>
              )
            })}
          </ul>
        </Panel>
      ) : null}
        </>
      ) : (
        <>
          {rows.length === 0 ? (
            <div className="app-dim app-inv-empty">{tr("ui.CargoPage.049")}</div>
          ) : (
            ITEM_KIND_ORDER.map((kind) => {
              const kindRows = rows.filter(([id]) => engine.ctx.items.get(id)?.kind === kind)
              if (kindRows.length === 0) return null
              const cells: ItemGridCell[] = kindRows.map(([id, units]) => {
                const def = engine.ctx.items.get(id)
                return {
                  key: id,
                  glyph: def?.kind ?? kind,
                  name: def?.name ?? id,
                  sub: `×${units.toLocaleString('zh-CN')} · ${m3(units * (def?.unitM3 ?? 1))}`,
                  title: def?.description,
                  // 富卡悬停（与列表模式的 ItemHover 同一内容；2026-09-19 与仓库同步）
                  hover: def ? itemHoverContent(def, (pid) => engine.ctx.items.get(pid)?.name) : undefined,
                  // 稀有残骸上稀有金（船长 2026-09-19）；其余物品照旧按大类取色
                  tone: inventoryItemTone(id, def?.kind ?? kind),
                }
              })
              const extra = kindExtraNote(kind)
              return (
                <Panel
                  key={kind}
                  title={`${itemKindLabel(kind)}（${isPiloted ? tr("ui.CargoPage.005") : tr("ui.CargoPage.006")}）`}
                  hint={extra ? <HintIcon tip={extra} /> : undefined}
                  right={<span className="app-dim">{tr('ui.CargoPage.009', { n: kindRows.length })}</span>}
                >
                  <ItemGlyphGrid cells={cells} onPick={(key) => setPickId(key)} />
                </Panel>
              )
            })
          )}

          {/* 船载装备（图标卡；2026-09-09 船长口径 A：模块可入货仓携带） */}
          {modRows.length > 0 ? (
            <Panel
              title={tr("ui.CargoPage.045")}
              right={<span className="app-dim">{modRows.length} {tr("ui.CargoPage.046")}</span>}
            >
              <ItemGlyphGrid
                cells={modRows.map(([id, units]) => {
                  const def = engine.ctx.modules.get(id)
                  return {
                    key: id,
                    glyph: def?.slot ?? 'mod',
                    name: def?.name ?? id,
                    sub: tr("ui.CargoPage.058", { p1: units.toLocaleString('zh-CN'), p2: m3(units) }),
                    title: def?.description,
                    // 富卡悬停（含"船载仅携带"那句注脚；2026-09-19 与列表模式/仓库同步）
                    hover: def
                      ? moduleHoverContent(def, '船载仅携带：装配台取料自装备库，船载装备需先卸回。')
                      : undefined,
                  }
                })}
                onPick={(key) => setPickMod(key)}
              />
            </Panel>
          ) : null}

          {pickDef && pickId ? (
            <ItemActionModal onClose={() => setPickId(null)}>
              <div className="app-itempick-head">
                <span className="app-itempick-icon">
                  <Glyph name={pickDef.kind} size={40} color={inventoryItemTone(pickId, pickDef.kind)} />
                </span>
                <div className="app-itempick-info">
                  <div className="app-itempick-name">{pickDef.name}</div>
                  <div className="app-dim">
                    ×{pickUnits.toLocaleString('zh-CN')}（{m3(pickUnits * pickDef.unitM3)}{tr('ui.CargoPage.054')}{' '}
                    {pickBuy !== undefined ? `${isk(pickBuy)} ${tr('ui.FirstTasks.003')}` : '—'}
                  </div>
                </div>
              </div>
              {/* 2026-09-08 船长反馈：图标模式信息太少——与列表悬浮同源信息表 */}
              <InfoTable lines={itemInfoLines(pickDef, (id) => engine.ctx.items.get(id)?.name)} />
              <div className="app-dim app-itempick-note">{pickDef.description}</div>
              <div className="app-itempick-actions">
                {!isPiloted ? (
                  <div className="app-dim">{tr("ui.CargoPage.050")}{targetName}{tr("ui.CargoPage.051")}</div>
                ) : pickBuy !== undefined ? (
                  <button
                    className="app-btn is-primary is-small"
                    onClick={() => {
                      setPickId(null)
                      setSellId(pickId)
                    }}
                  >
                    {tr("ui.CargoPage.038")}
                  </button>
                ) : fragIds.has(pickId) ? (
                  /* 2026-09-19 玩家报障修：碎片这一路在弹层里也要能兑（与物品页同一个组件） */
                  <RedeemFragmentButton engine={engine} itemId={pickId} onToast={onToast} />
                ) : (
                  <button className="app-btn is-small" disabled>
                    {tr("ui.CargoPage.040")}
                  </button>
                )}
                {pickId && marketGoodOf(engine.ctx, 'item', pickId) ? (
                  <button
                    className="app-btn is-small"
                    title={tr("ui.CargoPage.003")}
                    onClick={() => {
                      setPickId(null)
                      goMarket(pickId)
                    }}
                  >
                    {t('ui.CargoPage.002')}
                  </button>
                ) : null}
              </div>
            </ItemActionModal>
          ) : null}

          {/* 船载装备点选（模块信息 + 卸回装备库；2026-09-09） */}
          {pickModDef && pickMod ? (
            <ItemActionModal onClose={() => setPickMod(null)}>
              <div className="app-itempick-head">
                <span className="app-itempick-icon">
                  <Glyph name={pickModDef.slot} size={40} color={toneOf(pickModDef.slot)} />
                </span>
                <div className="app-itempick-info">
                  <div className="app-itempick-name">{pickModDef.name}</div>
                  <div className="app-dim">
                    ×{pickModUnits.toLocaleString('zh-CN')}{tr("ui.CargoPage.047")} {m3(pickModUnits)}）·{' '}
                    {SLOT_LABELS[pickModDef.slot] ?? pickModDef.slot} · CPU {pickModDef.cpuUse}
                  </div>
                </div>
              </div>
              <InfoTable lines={moduleInfoLines(pickModDef)} />
              <div className="app-dim app-itempick-note">
                {pickModDef.description}{tr("ui.CargoPage.052")}
              </div>
              <div className="app-itempick-actions">
                {!isPiloted ? (
                  <div className="app-dim">{tr("ui.CargoPage.050")}{targetName}{tr("ui.CargoPage.053")}</div>
                ) : (
                  <button className="app-btn is-primary is-small" onClick={() => handleUnloadOne(pickMod)}>
                    {tr("ui.CargoPage.048")}
                  </button>
                )}
              </div>
            </ItemActionModal>
          ) : null}

          {/* 出售数量选择（部分出售；船长 2026-09-05） */}
          {sellDef && sellId ? (
            <SellQtyModal
              name={sellDef.name}
              glyph={sellDef.kind}
              max={sellUnits}
              unit="单位"
              priceText={sellBuy !== undefined ? tr("ui.CargoPage.055", { p1: isk(sellBuy) }) : undefined}
              note={sellDef.description}
              onClose={() => setSellId(null)}
              onConfirm={(qty) => handleSell(sellId, qty)}
            />
          ) : null}
        </>
      )}
    </div>
  )
}
