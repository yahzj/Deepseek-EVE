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
  isAtHomeLike,
  itemKindLabel,
  marketGoodOf,
  shipBusyLabel,
  shipDisplayName,
} from '@whale/core'
import { Panel, ProgressBar } from '@whale/ui'
import { ItemHover, InfoTable, itemInfoLines, moduleInfoLines } from '../ui/shipInfo'
import { Glyph, toneOf } from '../ui/Glyphs'
import { ItemActionModal } from '../ui/ItemActionModal'
import { SellQtyModal } from '../ui/SellQtyModal'
import type { ItemNavProps } from './ItemsPage'
import type { PageProps } from './common'
import { isk, itemBuyQuote, m3 } from './common'
import { ItemGlyphGrid, ItemViewBar, kindExtraNote, useItemView, type ItemGridCell } from '../ui/itemView'

const KIND_EMPTY: Record<string, string> = {
  ore: '船上没有矿石——到「出港」页开采。',
  mineral: '船上没有矿物（精炼产物直接入仓库）。',
  gas: '船上没有气体。',
  ice: '船上没有冰矿。',
  ammo: '船上没有弹药。',
  drone: '船上没有无人机。',
}

export function CargoPage({ engine, onToast, onGotoMarket }: PageProps & ItemNavProps) {
  const state = engine.state
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
  const rows = Object.entries(cargo).filter(([, n]) => n > 0)
  // 2026-09-09（船长口径 A）：装备（模块）也可入货仓携带——单列「船载」组；占位 1 m³/件
  const modRows = rows.filter(([id]) => engine.ctx.modules.get(id) !== undefined)

  // 图标/列表切换（手册同款；网格为浏览视图）
  const [view, setView] = useItemView()

  function handleSell(id: string, qty: number): void {
    // 2026-09-08（船长定）：市场随"协会基地网络"——母港与已建成副站皆可出售（副站不设独立市场，共用全局市场）
    if (!isAtHomeLike(state, engine.ctx)) {
      onToast('出售需停靠空间站（母港或已建成副站；当前在野外或修建中工地）。', true)
      return
    }
    const r = engine.sellCargo(id, qty)
    if (!r.ok) onToast(r.error ?? '出售失败', true)
    else onToast(`已售出 ${r.soldUnits.toLocaleString('zh-CN')} 单位，入账 ${r.gainedIsk.toLocaleString('zh-CN')} ISK。`)
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

  /** 2026-09-09（船长口径 A）：单行卸货——物品 → 物品仓库；模块 → 装备库（引擎分流） */
  function handleUnloadOne(id: string): void {
    const moved = engine.unloadCargoItem(id)
    if (moved === 0) onToast('货仓里没有该条目。', true)
    else {
      const isMod = engine.ctx.modules.get(id) !== undefined
      onToast(isMod ? `已把船载装备卸回装备库 ×${moved.toLocaleString('zh-CN')}。` : `已卸入物品仓库 ×${moved.toLocaleString('zh-CN')}。`)
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
      onToast('舰船在野外：卸货需停靠空间站（母港或副站，可先「返航空间站」）。', true)
      return
    }
    const moved = engine.unloadAllToWarehouse()
    if (moved === 0) onToast('货仓是空的。', true)
    else onToast(`已把 ${moved.toLocaleString('zh-CN')} 单位货物卸入物品仓库。`)
  }

  /** 2026-09-08（船长定）：非驾驶空闲舰船卸货入仓库 */
  function handleUnloadShip(id: string): void {
    const moved = engine.unloadShipAllToWarehouse(id)
    if (moved === -1) onToast('找不到该舰船。', true)
    else if (moved === -2) onToast('该船正在 AI 作业中——卸货需等任务结束（AI 到港会自行卸货）。', true)
    else if (moved === -3) onToast('该船正在善后返航途中——到港会自动卸货。', true)
    else if (moved === 0) onToast('货仓是空的。', true)
    else onToast(`已把「${targetName}」货仓的 ${moved.toLocaleString('zh-CN')} 单位货物卸入物品仓库。`)
  }

  return (
    <div className="page-stack">
      <Panel
        title="货仓"
        right={
          isPiloted ? <span className="app-dim">当前驾驶船</span> : <span className="app-dim">查看中 · 可卸货</span>
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
                title={isP ? '当前驾驶船' : b ?? '该船闲置中'}
              >
                <span className="app-shipchip-name">
                  {d ? <span className={`app-role-dot is-${d.role}`} /> : null}
                  {shipDisplayName(state, engine.ctx, id)}
                </span>
                {isP ? <span className="app-shipchip-tag">驾驶中</span> : null}
                {b ? <span className="app-shipchip-busy">·{b}</span> : null}
              </button>
            )
          })}
        </div>
        <div className="app-cargo-head">
          <ProgressBar
            value={cap > 0 ? ((used + haulOcc) / cap) * 100 : 0}
            tone={haulOcc > 0 ? 'warn' : cap > 0 && used / cap > 0.85 ? 'danger' : cap > 0 && used / cap > 0.6 ? 'warn' : 'normal'}
            label={`${targetName} · 已占用 ${m3(used + haulOcc)} / ${cap > 0 ? cap.toLocaleString('zh-CN') : '—'} m³`}
          />
          {haulOcc > 0 ? (
            <div className="app-dim" style={{ marginTop: 2 }}>
              ⚠ 长途运输进行中：货仓由虚拟运输货物占满（可用 0 m³）——到站自动结算报酬；任务期间不能装卸与出售。
            </div>
          ) : null}
          {isPiloted ? (
            <button className="app-btn is-primary is-small" onClick={handleUnloadAll} disabled={rows.length === 0}>
              全部卸入仓库
            </button>
          ) : busy === null ? (
            // 2026-09-08（船长定）：空闲停靠的非驾驶舰船也可直接卸货入仓库（装船/出售仍限驾驶船）
            <button
              className="app-btn is-small"
              onClick={() => handleUnloadShip(targetId)}
              disabled={rows.length === 0}
              title="该船空闲停靠：可直接把货仓卸入物品仓库"
            >
              全部卸入仓库
            </button>
          ) : null}
        </div>
        {isPiloted ? (
          <div className="app-dim app-note">
            货仓随船：采集与远征战利品都先落在这里；弃船会连同本页内容一起遗失。
            资源可以在此直接卖出，或卸入仓库后再处理。
            {busy ? ` 当前：${busy}。` : ''}
          </div>
        ) : (
          <div className="app-dim app-note">
            正在查看「{targetName}」的货仓：空闲停靠的舰船可直接卸入仓库；装船与出售仍仅限当前驾驶船「
            {shipDisplayName(state, engine.ctx, piloted)}」。
            {busy ? ` 该船当前：${busy}，卸货需等作业结束。` : ' 该船闲置中，可卸货。'}
          </div>
        )}
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
            ? `「${targetName}」的货仓里没有矿石。`
            : KIND_EMPTY[kind] ?? '货仓里没有该分类的货物。'
        return (
          <Panel
            key={kind}
            title={`${itemKindLabel(kind)}（${isPiloted ? '驾驶船' : '查看中'}）`}
            right={<span className="app-dim">{kindRows.length} 种</span>}
          >
            {kindExtraNote(kind) ? (
              <div className="app-dim app-note">{kindExtraNote(kind)}</div>
            ) : null}
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
                        <span className="app-inv-name">{def.name}</span>
                        <span className="app-inv-count">
                          ×{units.toLocaleString('zh-CN')}（{m3(units * def.unitM3)}）· 市场收价{' '}
                          {buy !== undefined ? `${isk(buy)} ISK` : '—'}
                        </span>
                      </div>
                      <div className="app-inv-btns">
                        {isPiloted && buy !== undefined ? (
                          <>
                            <button className="app-btn is-small is-primary" onClick={() => setSellId(id)}>
                              市价卖出
                            </button>
                            <button
                              className="app-btn is-small"
                              title="前往市场查看该物品的订单（价格/挂单/买入）"
                              onClick={() => goMarket(id)}
                            >
                              ↖ 查看市场
                            </button>
                          </>
                        ) : isPiloted ? (
                          <button className="app-btn is-small" disabled>
                            不在市场目录
                          </button>
                        ) : (
                          <span className="app-dim app-sr-eta">只读查看</span>
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

      {/* 船载装备（2026-09-09 船长口径 A：模块可入货仓携带；占位 1 m³/件，卸回装备库） */}
      {modRows.length > 0 ? (
        <Panel
          title="装备（船载）"
          right={<span className="app-dim">{modRows.length} 种 · 占位 1 m³/件</span>}
        >
          <ul className="app-inv-list">
            {modRows.map(([id, units]) => {
              const def = engine.ctx.modules.get(id)
              if (!def) return null
              return (
                <li
                  key={id}
                  className="app-inv-row"
                  title={`${def.description}——船载仅携带；装配台取料自装备库，船载装备需先卸回。`}
                >
                  <div className="app-inv-main">
                    <span className="app-inv-name">{def.name}</span>
                    <span className="app-inv-count">
                      ×{units.toLocaleString('zh-CN')}（占位 {m3(units)}）· {SLOT_LABELS[def.slot] ?? def.slot} · CPU{' '}
                      {def.cpuUse}
                    </span>
                  </div>
                  <div className="app-inv-btns">
                    {isPiloted ? (
                      <button className="app-btn is-small is-primary" onClick={() => handleUnloadOne(id)}>
                        卸回装备库
                      </button>
                    ) : (
                      <span className="app-dim app-sr-eta">只读查看</span>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </Panel>
      ) : null}
        </>
      ) : (
        <>
          {rows.length === 0 ? (
            <div className="app-dim app-inv-empty">货仓是空的——采集与战利品会先落到这里。</div>
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
                }
              })
              return (
                <Panel
                  key={kind}
                  title={`${itemKindLabel(kind)}（${isPiloted ? '驾驶船' : '查看中'}）`}
                  right={<span className="app-dim">{kindRows.length} 种</span>}
                >
                  {kindExtraNote(kind) ? (
                    <div className="app-dim app-note">{kindExtraNote(kind)}</div>
                  ) : null}
                  <ItemGlyphGrid cells={cells} onPick={(key) => setPickId(key)} />
                </Panel>
              )
            })
          )}

          {/* 船载装备（图标卡；2026-09-09 船长口径 A：模块可入货仓携带） */}
          {modRows.length > 0 ? (
            <Panel
              title="装备（船载）"
              right={<span className="app-dim">{modRows.length} 种 · 占位 1 m³/件</span>}
            >
              <ItemGlyphGrid
                cells={modRows.map(([id, units]) => {
                  const def = engine.ctx.modules.get(id)
                  return {
                    key: id,
                    glyph: def?.slot ?? 'mod',
                    name: def?.name ?? id,
                    sub: `×${units.toLocaleString('zh-CN')} · 占位 ${m3(units)}`,
                    title: def?.description,
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
                  <Glyph name={pickDef.kind} size={40} color={toneOf(pickDef.kind)} />
                </span>
                <div className="app-itempick-info">
                  <div className="app-itempick-name">{pickDef.name}</div>
                  <div className="app-dim">
                    ×{pickUnits.toLocaleString('zh-CN')}（{m3(pickUnits * pickDef.unitM3)}）· 市场收价{' '}
                    {pickBuy !== undefined ? `${isk(pickBuy)} ISK` : '—'}
                  </div>
                </div>
              </div>
              {/* 2026-09-08 船长反馈：图标模式信息太少——与列表悬浮同源信息表 */}
              <InfoTable lines={itemInfoLines(pickDef, (id) => engine.ctx.items.get(id)?.name)} />
              <div className="app-dim app-itempick-note">{pickDef.description}</div>
              <div className="app-itempick-actions">
                {!isPiloted ? (
                  <div className="app-dim">正在查看「{targetName}」——只读：装卸与出售仅对当前驾驶船可用。</div>
                ) : pickBuy !== undefined ? (
                  <button
                    className="app-btn is-primary is-small"
                    onClick={() => {
                      setPickId(null)
                      setSellId(pickId)
                    }}
                  >
                    市价卖出
                  </button>
                ) : (
                  <button className="app-btn is-small" disabled>
                    不在市场目录（无法出售）
                  </button>
                )}
                {pickId && marketGoodOf(engine.ctx, 'item', pickId) ? (
                  <button
                    className="app-btn is-small"
                    title="前往市场查看该物品的订单（价格/挂单/买入）"
                    onClick={() => {
                      setPickId(null)
                      goMarket(pickId)
                    }}
                  >
                    ↖ 查看市场订单
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
                    ×{pickModUnits.toLocaleString('zh-CN')}（占位 {m3(pickModUnits)}）·{' '}
                    {SLOT_LABELS[pickModDef.slot] ?? pickModDef.slot} · CPU {pickModDef.cpuUse}
                  </div>
                </div>
              </div>
              <InfoTable lines={moduleInfoLines(pickModDef)} />
              <div className="app-dim app-itempick-note">
                {pickModDef.description}——船载仅携带：装配台取料自装备库，船载装备需先卸回。
              </div>
              <div className="app-itempick-actions">
                {!isPiloted ? (
                  <div className="app-dim">正在查看「{targetName}」——只读：装卸仅对当前驾驶船可用。</div>
                ) : (
                  <button className="app-btn is-primary is-small" onClick={() => handleUnloadOne(pickMod)}>
                    卸回装备库
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
              priceText={sellBuy !== undefined ? `收价 ${isk(sellBuy)} ISK/单位` : undefined}
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
