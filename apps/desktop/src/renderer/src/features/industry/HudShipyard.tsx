import { calcBuildDurationMs, canStartBlueprint, missingMaterials, ownsBlueprint } from '@whale/core'
import { Glyph } from '../../ui/Glyphs'
import { RowGlyph } from '../../ui/itemView'
import { IconBtn } from '../../ui/hud'
import { aiCoreText } from '../../ui/labelsText'
import { DryDockFx } from '../../ui/dryDockFx'
import { SHIP_TIER_SUBS, SUB_ALL } from '../../ui/itemSubs'
import { hoverTipProps } from '../../ui/Tooltip'
import { tr } from '../../i18n/locale'
import { readinessOf, matsValueOf } from './hudMaterials'
import { AiCorePick } from './AiCorePick'
import type { IndustryHudModel } from './useIndustryHud'

type HudShipyardProps = Pick<IndustryHudModel, 'engine' | 'core' | 'usableCores' | 'setCoreSel' | 'dockRuns' | 'ctx' | 'durText' | 'stopManu' | 'shipShown' | 'tierFilter' | 'setTierFilter' | 'shipRows' | 'state' | 'specOf' | 'shelfTip' | 'manuManualNote' | 'startManu'>

export function HudShipyard({ engine, core, usableCores, setCoreSel, dockRuns, ctx, durText, stopManu, shipShown, tierFilter, setTierFilter, shipRows, state, specOf, shelfTip, manuManualNote, startManu }: HudShipyardProps) {
  return (
(
          <div className="hud-grid two">
            <div className="hud-panel">
              <h3>
                <Glyph name="ico-drydock" size={13} color="currentColor" /> {tr('ui.hud.097')}
              </h3>
              {/* 造船厂：选择器放"在建舰船"窗口顶部（同上令） */}
              <AiCorePick engine={engine} suffix="shipyard" core={core} usableCores={usableCores} onPick={setCoreSel} />
              {dockRuns.length === 0 ? (
                <div className="hud-empty">{tr('ui.hud.099')}</div>
              ) : (
                dockRuns.map((v) => {
                  const sbp = v.blueprintId !== null ? ctx.shipBlueprints.get(v.blueprintId) : undefined
                  const def = sbp !== undefined ? ctx.ships.get(sbp.shipId) : undefined
                  const mats = sbp?.materials ?? []
                  const ready = readinessOf(engine, mats)
                  return (
                    <div className="hud-dock" key={v.id}>
                      {/* **船坞场景**（**2026-10-01 船长令**：动画移到卡片上方、造一个更大的船坞、舰体放坞正中） */}
                      <div className="hud-dock-art">
                        {/* 真实线稿 ＋ 按进度逐段显影（船长 2026-10-01：「按进度逐段显影，使用各舰真实线稿」） */}
                        <DryDockFx
                          progress={v.percent / 100}
                          shipId={def?.id ?? ''}
                          role={def?.role}
                          /* T 级 ⇒ 坞内舰体大小（2026-10-01 船长令「按 T 级阶梯缩放」） */
                          tier={def?.tier}
                        />
                      </div>
                      <div className="hud-dock-info">
                        <div className="hud-row between">
                          <span className="nm">{def?.name ?? v.productName}</span>
                          <span className="hud-chip is-acc">{v.workerLabel}</span>
                        </div>
                        <span className="hud-bar lg">
                          <i style={{ ['--v' as string]: Math.round(v.percent) }} />
                        </span>
                        <div className="hud-cells">
                          <span title={tr('ui.hud.069')}>
                            <Glyph name="ico-feed" size={12} color="currentColor" /> {mats.length}
                          </span>
                          <span title={tr('ui.hud.105')}>
                            <Glyph name="ico-eff" size={12} color="currentColor" />{' '}
                            {(matsValueOf(engine, mats, v.blueprintId ?? undefined) / 1_000_000).toFixed(1)}M
                          </span>
                          <span title={tr('ui.hud.090')}>
                            <Glyph name="ico-stop" size={12} color="currentColor" /> {durText(v.remainingMs)}
                          </span>
                          <span title={tr('ui.hud.104')} className="hud-tiny">
                            {tr('ui.hud.104')} {Math.round(ready.pct * 100)}%
                          </span>
                        </div>
                        <div className="hud-row" style={{ marginTop: 8 }}>
                          <IconBtn
                            glyph="ico-stop"
                            label={tr('ui.hud.113')}
                            title={tr('ui.hud.113')}
                            onClick={() => stopManu(v.id)}
                          />
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
            <div className="hud-panel">
              <h3>
                <Glyph name="ico-drydock" size={13} color="currentColor" /> {tr('ui.hud.098')}
                <span className="hud-tiny" style={{ marginLeft: 8 }}>{shipShown.length}</span>
              </h3>
              <div className="hud-chips">
                <button
                  className={`hud-chip${tierFilter === SUB_ALL ? ' is-acc' : ''}`}
                  aria-pressed={tierFilter === SUB_ALL}
                  onClick={() => setTierFilter(SUB_ALL)}
                >
                  {tr('ui.hud.106')}
                </button>
                {SHIP_TIER_SUBS.filter((s) => s.key !== SUB_ALL && shipRows.some((r) => r.tierKey === s.key)).map((s) => (
                  <button
                    key={s.key}
                    className={`hud-chip${tierFilter === s.key ? ' is-acc' : ''}`}
                    aria-pressed={tierFilter === s.key}
                    onClick={() => setTierFilter(s.key)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <table className="hud-table">
                <thead>
                  <tr>
                    <th>{tr('ui.hud.089')}</th>
                    <th className="n">{tr('ui.hud.105')} · {tr('ui.hud.090')}</th>
                    <th>{tr('ui.hud.091')}</th>
                    <th className="act" />
                  </tr>
                </thead>
                <tbody>
                  {shipShown.map((r) => {
                    const can =
                      canStartBlueprint(state, ctx, r.id) &&
                      missingMaterials(state, ctx, specOf(r.materials, r.buildSeconds)).length === 0
                    const learned = ownsBlueprint(state, r.id)
                    return (
                      /* 悬浮卡与组装机书架**同一份**（都是"多料蓝图"⇒ 左列走材料清单） */
                      <tr key={r.id} {...hoverTipProps(shelfTip({ product: r.name, glyph: 'nav-ship', materials: r.materials }))}>
                        <td>
                          <span className="hud-row" style={{ gap: 6 }}>
                            <RowGlyph glyph={r.role} />
                            <span>{r.name}</span>
                          </span>
                        </td>
                        {/* 料值与工期合到一列（两行小字）：五列会把产物名挤成一字一行（1340×900 实测） */}
                        <td className="n">
                          <span className="hud-cell2">{(matsValueOf(engine, r.materials) / 1_000_000).toFixed(1)}M</span>
                          <span className="hud-cell2 hud-tiny">{durText(calcBuildDurationMs(state, ctx, specOf(r.materials, r.buildSeconds)))}</span>
                        </td>
                        <td>
                          <span className={`hud-chip${can ? ' is-ok' : learned ? ' is-warn' : ' is-bad'}`}>
                            {can ? tr('ui.hud.092') : learned ? tr('ui.hud.093') : tr('ui.hud.094')}
                          </span>
                        </td>
                        <td className="act">
                          <IconBtn
                            glyph="ico-play"
                            title={manuManualNote ?? tr('ui.hud.112', { p1: core !== null ? aiCoreText(core) : tr('ui.hud.082') })}
                            disabled={!learned || manuManualNote !== null}
                            onClick={() => startManu(r.id)}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
  )
}
