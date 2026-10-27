/** 功能域职责拆分，保持原计算与顺序。 */
import type { GameEngine } from '../../game/engine'
import type { ToastFn } from '../../pages/common'
import { useState } from 'react'
import { isExplored, stationBillView, playerAtSite, stationActivityStartBlockReason, siteDeliverFreeCargoM3, billNeedOf, tierNeedOf } from '@whale/core'
import { Glyph, ICO_TONES } from '../../ui/Glyphs'
import { tr, cmdText } from '../../i18n/locale'
import { secTone, secText } from '../../panels/StarMap'
import { Communicator } from '../../ui/communicator'

/** 建站族任务卡：状态 / 档位进度 / 提交 / 通讯重看（siteIds 为空数组时不显示任何卡——任务初期不出现） */
export function StationCard({ engine, onToast, siteIds }: { engine: GameEngine; onToast: ToastFn; siteIds?: string[] }) {
  const state = engine.state
  const [comm, setComm] = useState<string | null>(null)
  const [qty, setQty] = useState<number>(0)
  const [selItem, setSelItem] = useState<Record<string, string>>({})
  const sites = siteIds
    ? siteIds.flatMap((id) => {
        const s = engine.ctx.stations.get(id)
        return s ? [s] : []
      })
    : [...engine.ctx.stations.values()]
  return (
    <>
      {sites.map((site) => {
        const galaxy = engine.ctx.galaxies.get(site.galaxyId)
        const explored = galaxy ? isExplored(state, galaxy.id) : false
        const prog = state.stationSites[site.id] ?? { stage: 0, delivered: {} }
        const built = prog.stage >= site.tiers.length
        const tier = !built ? site.tiers[prog.stage]! : null
        // 2026-09-09：逐档材料单视图（当前档每项需求/已缴/剩余）
        const billRows = !built ? stationBillView(state, engine.ctx, site) : []
        const remain = billRows.reduce((s, r) => s + r.remaining, 0)
        const itemId = selItem[site.id] ?? billRows[0]?.itemId ?? ''
        // 工地现场 = 停靠该站，或野外停留于站点星系（2026-09-06 修复：现场交付无需"先停靠"）
        const presentAtSite = playerAtSite(state, site)
        const availOf = (id: string): number =>
          (state.warehouse.items[id] ?? 0) + (state.fleet[state.shipId]?.cargo[id] ?? 0)
        const selRow = billRows.find((r) => r.itemId === itemId)
        const avail = itemId ? availOf(itemId) : 0
        // 2026-09-08 一键「前往工地交付」＝交付循环（物理载货：装仓库建材→到点清仓→自动续趟→建成或仓库耗尽终止）
        const tripOn = state.transit.active && state.transit.delivery?.siteId === site.id
        /**
         * ⚠ **2026-09-22 船长令**：「建设空间站的运输也加入可以打断其他行为的切换里，不需要先暂停其他活动」
         * ⇒ 原先的 `tripBusy`（开采/远征/打捞/掩护巡逻/在途/亲自开炉/亲自开线 任一项在跑就置灰）**整段删掉**：
         * 那些活动由 core 的统一判据裁决（能自动停的先停掉 ＋ 一条统一日志；远征/快递直接拒）。
         *
         * 位置门槛只保留两种"点了也白点"的情形：
         * ① 舰船在野外**且手上没有可停的活动**（纯野外留守）⇒ 得先自己返航；
         * ② `transit` 槽被占着（换港返航 / 另外一条在建的交付航线）⇒ 同一个槽，等它跑完。
         * 其余一律交给 core 判（`mainActivityOf` 与 activityGate 同源）。
         */
        const tripReadyDock = stationActivityStartBlockReason(state, engine.ctx, 'siteDeliver') === null
        const tripBusy = state.transit.active && !tripOn
        const wareStock = billRows.reduce((s, r) => s + (state.warehouse.items[r.itemId] ?? 0), 0)
        const tripFreeM3 = siteDeliverFreeCargoM3(state, engine.ctx)
        const tripBlocked = tripOn || !tripReadyDock || tripBusy || wareStock <= 0 || tripFreeM3 <= 0
        const want = Math.min(Math.max(0, Math.floor(qty)), selRow ? selRow.remaining : 0, avail)
        const intro = site.introDialogueId ? engine.dialogues.find((d) => d.id === site.introDialogueId) : undefined
        return (
          <div key={site.id} className={`app-station-card${built ? ' is-built' : ''}`}>
            <div className="app-station-head">
              <span className="app-station-name">
                {site.name}
                {built ? <em className="app-chip app-station-built"><span className="app-ico"><Glyph name="ico-crane" size={12} color={ICO_TONES["ico-crane"]} /></span>{tr("ui.Expedition.179")}</em> : null}
                {!built && tier ? (
                  <em className="app-chip">{tr("ui.Expedition.180")}{tier.name}」</em>
                ) : null}
              </span>
              <span className="app-dim">
                {galaxy?.name ?? site.galaxyId}
                {galaxy?.security !== undefined ? (
                  <span className={`app-sec-chip app-sec-chip-${secTone(galaxy.security)}`}>
                    {secText(galaxy.security)}
                  </span>
                ) : null}
                {presentAtSite && state.dockedSite === site.id ? (
                  tr('ui.Expedition.412')
                ) : state.awayGalaxy === null && state.dockedSite === null ? (
                  tr('ui.Expedition.413')
                ) : state.awayGalaxy === site.galaxyId ? (
                  tr('ui.Expedition.414')
                ) : (
                  ''
                )}
              </span>
            </div>
            <div className="app-dim">{site.description}</div>
            {(() => {
              // 2026-09-09：展示各档材料单（精炼矿物；排除原矿）
              const billTxt = (t: (typeof site.tiers)[number]): string =>
                t.bill.map((b) => `${engine.ctx.items.get(b.itemId)?.name ?? b.itemId}×${b.count.toLocaleString('zh-CN')}`).join(' + ')
              return (
                <div className="app-station-mats">
                  {tr("ui.Expedition.181")}
                  {site.tiers.map((t, i) => (
                    <div key={t.name} className="app-dim">
                      {i + 1}·{t.name}：{billTxt(t)}
                    </div>
                  ))}
                  <span className="app-dim">{tr("ui.Expedition.064")}</span>
                </div>
              )
            })()}
            <div className="app-station-tiers">
              {site.tiers.map((t, i) => {
                const billTxt = t.bill
                  .map((b) => `${engine.ctx.items.get(b.itemId)?.name ?? b.itemId}×${billNeedOf(state, site, i, b.itemId).toLocaleString('zh-CN')}`)
                  .join(' + ')
                return (
                  <span key={t.name} className={`app-station-tier${prog.stage > i ? ' is-done' : ''}${prog.stage === i && !built ? ' is-cur' : ''}`}>
                    {i + 1}·{t.name}：{billTxt}（{tierNeedOf(state, site, i).toLocaleString('zh-CN')} {tr("ui.ShipPage.100")}{prog.stage > i ? ' ✓' : ''}
                  </span>
                )
              })}
            </div>
            {!explored ? (
              <div className="app-dim">{tr("ui.Expedition.300")}</div>
            ) : built ? (
              <div className="app-dim">{tr("ui.Expedition.125")}</div>
            ) : tier ? (
              <>
                <div className="app-station-progress">
                  {billRows.length > 0 ? (
                    <div>
                      {billRows.map((r) => (
                        <div key={r.itemId} className="app-dim">
                          {r.itemName}{tr('ui.Expedition.415')}{r.delivered.toLocaleString('zh-CN')} / {r.need.toLocaleString('zh-CN')}
                          {r.remaining > 0 ? tr("ui.Expedition.342", { p1: r.remaining.toLocaleString('zh-CN') }) : ' ✓'}
                        </div>
                      ))}
                      <span className="app-dim">
                        {tr("ui.Expedition.242")} {remain.toLocaleString('zh-CN')} {tr("ui.Expedition.102")}{remain === 0 ? tr("ui.Expedition.343") : ''}
                      </span>
                    </div>
                  ) : null}
                </div>
                {presentAtSite ? (
                  <div className="app-station-deliver">
                    <span className="app-dim">{tr("ui.Expedition.182")}</span>
                    <select
                      className="app-select"
                      value={itemId}
                      onChange={(e) => setSelItem((prev) => ({ ...prev, [site.id]: e.target.value }))}
                    >
                      {billRows.map((r) => (
                        <option key={r.itemId} value={r.itemId}>
                          {r.itemName}{tr("ui.Expedition.344")} {availOf(r.itemId).toLocaleString('zh-CN')}{tr('ui.Expedition.371')}{r.remaining.toLocaleString('zh-CN')}）
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={0}
                      max={avail}
                      value={Number.isFinite(qty) && qty > 0 ? qty : ''}
                      placeholder={tr("ui.Expedition.003")}
                      onChange={(e) => setQty(Number(e.target.value))}
                      style={{ width: 90 }}
                    />
                    <button
                      className="app-btn is-small is-primary"
                      disabled={want <= 0}
                      title={want > 0 ? tr("ui.Expedition.183", { p1: want.toLocaleString('zh-CN') }) : tr("ui.Expedition.243")}
                      onClick={() => {
                        const r = engine.deliverSiteAt(site.id, itemId, want)
                        if (!r.ok) onToast(cmdText(r) || tr('ui.Expedition.416'), true)
                        else onToast(tr("ui.Expedition.184"))
                        setQty(0)
                      }}
                    >
                      {tr("ui.Expedition.185")}
                    </button>
                  </div>
                ) : (
                  <div className="app-station-deliver">
                    <span className="app-dim">
                      {tr("ui.Expedition.065")}
                    </span>
                    <button
                      className="app-btn is-small is-primary"
                      disabled={tripBlocked}
                      title={
                        tripOn
                          ? tr("ui.Expedition.029")
                          : !tripReadyDock
                            ? tr("ui.Expedition.301")
                            : tripBusy
                              ? tr("ui.Expedition.345")
                              : tripFreeM3 <= 0
                                ? tr("ui.Expedition.267")
                                : wareStock <= 0
                                  ? tr("ui.Expedition.066", { p1: billRows.map((r) => `${r.itemName}×${r.remaining.toLocaleString('zh-CN')}`).join(tr("ui.MatterTechTab.017")) })
                                  : tr("ui.Expedition.067", { p1: galaxy?.name ?? site.galaxyId, p2: tripFreeM3.toLocaleString('zh-CN') })
                      }
                      onClick={() => {
                        const r = engine.deliverTripAt(site.id)
                        if (!r.ok) onToast(cmdText(r) || tr('ui.Expedition.389'), true)
                        else if (r.queued) onToast(tr('core.busy.020'))
                        else onToast(tr("ui.Expedition.093", { p1: site.name }))
                      }}
                    >
                      <span className="app-ico"><Glyph name="ico-home" size={13} color={ICO_TONES["ico-home"]} /></span>
                      {tripOn ? tr("ui.Expedition.034") : tr("ui.Expedition.094")}
                    </button>
                  </div>
                )}
              </>
            ) : null}
            {intro ? (
              <button
                className="app-btn is-small"
                title={tr("ui.Expedition.346")}
                onClick={() => {
                  const r = engine.openDialogue(intro.id)
                  if (r.ok) setComm(intro.id)
                  else onToast(cmdText(r) || tr('ui.Expedition.417'), true)
                }}
              >
                <span className="app-ico"><Glyph name="ico-antenna" size={13} color={ICO_TONES["ico-antenna"]} /></span>{tr("ui.Expedition.347")}
              </button>
            ) : null}
          </div>
        )
      })}
      {comm ? (
        <Communicator
          script={engine.dialogues.find((d) => d.id === comm)!}
          onClose={() => setComm(null)}
        />
      ) : null}
    </>
  )
}
