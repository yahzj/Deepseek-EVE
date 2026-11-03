import { calcBuildDurationMs, ownsBlueprint, plugCraftUnlockedOf } from '@whale/core'
import { Glyph } from '../../ui/Glyphs'
import { AiWorkFx } from '../../ui/aiWorkFx'
import { RowGlyph } from '../../ui/itemView'
import { IconBtn, Readout } from '../../ui/hud'
import { aiCoreText } from '../../ui/labelsText'
import { SUB_ALL, subText } from '../../ui/itemSubs'
import { hoverTipProps } from '../../ui/Tooltip'
import { tr } from '../../i18n/locale'
import { SHELF_KIND_TABS } from './hudTypes'
import { readinessOf } from './hudMaterials'
import { AiCorePick } from './AiCorePick'
import type { IndustryHudModel } from './useIndustryHud'

type HudManufacturingProps = Pick<IndustryHudModel, 'manuRuns' | 'engine' | 'core' | 'usableCores' | 'setCoreSel' | 'ctx' | 'durText' | 'stopManu' | 'shelfKwRaw' | 'setShelfKwRaw' | 'shelfFilterActive' | 'shelfShown' | 'shelfRows' | 'state' | 'shelfKind' | 'setShelfKind' | 'setShelfSub' | 'shelfSubOptions' | 'shelfSub' | 'shelfLearned' | 'setShelfLearned' | 'shelfReadyOnly' | 'setShelfReadyOnly' | 'shelfCanStart' | 'shelfTip' | 'runningBlueprintIds' | 'specOf' | 'manuManualNote' | 'startManu'>

export function HudManufacturing({ manuRuns, engine, core, usableCores, setCoreSel, ctx, durText, stopManu, shelfKwRaw, setShelfKwRaw, shelfFilterActive, shelfShown, shelfRows, state, shelfKind, setShelfKind, setShelfSub, shelfSubOptions, shelfSub, shelfLearned, setShelfLearned, shelfReadyOnly, setShelfReadyOnly, shelfCanStart, shelfTip, runningBlueprintIds, specOf, manuManualNote, startManu }: HudManufacturingProps) {
  return (
(
          <div className="hud-grid two">
            <div className="hud-panel">
              <h3>
                <Glyph name="ico-assembler" size={13} color="currentColor" /> {tr('ui.hud.087')}
                <span className="hud-tiny" style={{ marginLeft: 8 }}>
                  <Readout glyph="ico-eff" value={String(manuRuns.length)} title={tr('ui.hud.114')} />
                </span>
              </h3>
              {/* 组装机：选择器放"制造队列"窗口顶部（2026-09-30 船长令：工业几个页面都加 AI 选择） */}
              <AiCorePick engine={engine} suffix="craft" core={core} usableCores={usableCores} onPick={setCoreSel} />
              {manuRuns.length === 0 ? (
                <div className="hud-empty">{tr('ui.hud.095')}</div>
              ) : (
                manuRuns.map((v) => {
                  const bp = v.blueprintId !== null
                    ? (ctx.blueprints.get(v.blueprintId) ?? ctx.shipBlueprints.get(v.blueprintId))
                    : undefined
                  const mats = bp?.materials ?? []
                  const ready = readinessOf(engine, mats, v.blueprintId ?? undefined)
                  const readyPct = Math.round(ready.pct * 100)
                  const isComplete = v.remainingMs <= 300 || v.percent >= 99.8
                  return (
                    <div className={`hud-card${isComplete ? ' is-complete' : ''}`} key={v.id}>
                      <div className="hud-row between">
                        <span className="hud-row" style={{ gap: 7, minWidth: 0 }}>
                          {/* **AI 指挥中心那套动画**（**2026-10-01 船长令**：动画一并应用）：组装机恒画 `craft`，与 AI 指挥中心那一行同一个组件 */}
                          <AiWorkFx kind="craft" />
                          <RowGlyph glyph={v.kind ?? 'item'} />
                          <span className="nm">{v.productName}</span>
                        </span>
                        <span className="hud-chip is-acc">{v.workerLabel}</span>
                      </div>
                      <div className="hud-row between" style={{ marginTop: 5 }}>
                        <span className="hud-tiny">{bp?.name ?? ''}</span>
                        <span className="hud-tiny app-mfg-countdown">{isComplete ? tr('ui.Industry.044') : durText(v.remainingMs)}</span>
                      </div>
                      <span className="hud-bar">
                        <i style={{ ['--v' as string]: Math.round(v.percent) }} />
                      </span>
                      {mats.length > 0 ? (
                        <div className="hud-mat">
                          <span className="hud-tiny">{tr('ui.hud.104')}</span>
                          <span
                            className="hud-bullet"
                            title={tr('ui.hud.111', { p1: readyPct, p2: ready.short.join(tr('ui.MatterTechTab.017')) })}
                          >
                            <span className="rng" style={{ left: 0, width: '100%' }} />
                            <span className="val" style={{ width: `${readyPct}%` }} />
                          </span>
                          <span className="hud-tiny">{readyPct}%</span>
                        </div>
                      ) : null}
                      <div className="hud-row" style={{ marginTop: 6 }}>
                        <IconBtn
                          glyph="ico-stop"
                          label={tr('ui.hud.084')}
                          title={tr('ui.hud.115', { p1: v.productName })}
                          onClick={() => stopManu(v.id)}
                        />
                      </div>
                    </div>
                  )
                })
              )}
            </div>
            <div className="hud-panel">
              <h3 className="hud-panel-head">
                <span className="hud-panel-title">
                  <Glyph name="blueprint" size={13} color="currentColor" /> {tr('ui.hud.088')}
                </span>
                {/* 搜索（**2026-10-01 船长令**：参考旧版组装机的筛选和搜索）——与旧页/其它页同一实现 `.app-head-search` */}
                <input
                  className="app-head-search"
                  type="text"
                  placeholder={tr('ui.Industry.128')}
                  value={shelfKwRaw}
                  onChange={(e) => setShelfKwRaw(e.target.value)}
                  spellCheck={false}
                />
                <span className="hud-tiny" title={shelfFilterActive ? tr('ui.hud.151', { p1: shelfShown.length }) : tr('ui.hud.089')}>
                  {shelfFilterActive ? shelfShown.length : tr('ui.hud.152', { p1: shelfRows.length })}
                </span>
              </h3>
              {/* ① 一级门类（五档，顺序照旧版 `MANU_TABS_CRAFT`；插件档在取得第一个黑匣前不出现） */}
              <div className="hud-chips">
                {SHELF_KIND_TABS.filter(
                  (tb) => tb.key !== 'plug' || (tb.id !== undefined && plugCraftUnlockedOf(state)),
                ).map((tb) => (
                  <button
                    key={tb.key}
                    className={`hud-chip${shelfKind === tb.key ? ' is-acc' : ''}`}
                    aria-pressed={shelfKind === tb.key}
                    onClick={() => {
                      setShelfKind(tb.key)
                      setShelfSub(SUB_ALL) // 换一级即回「全部子类」（与旧页同款）
                    }}
                  >
                    {tr(tb.id!)}
                  </button>
                ))}
              </div>
              {/* ② 二级子类（按门类现算；「全部」门类与空档不出现 ⇒ 选中对应一级后才有这一行） */}
              {shelfSubOptions.length > 0 ? (
                <div className="hud-chips">
                  {[{ key: SUB_ALL, label: '全部', id: 'ui.hud.106' }, ...shelfSubOptions].map((s) => (
                    <button
                      key={s.key}
                      className={`hud-chip${shelfSub === s.key ? ' is-acc' : ''}`}
                      aria-pressed={shelfSub === s.key}
                      onClick={() => setShelfSub(s.key)}
                    >
                      {subText(s)}
                    </button>
                  ))}
                </div>
              ) : null}
              {/* ③ 学会（已学会/未学会，键与旧页/市场共用 `BLUEPRINT_LEARN_SUBS`）＋ 仅可造 */}
              <div className="hud-chips">
                <button
                  className={`hud-chip${shelfLearned === 'learned' ? ' is-acc' : ''}`}
                  aria-pressed={shelfLearned === 'learned'}
                  onClick={() => setShelfLearned((v) => (v === 'learned' ? SUB_ALL : 'learned'))}
                >
                  {tr('ui.itemSubs.031')}
                </button>
                <button
                  className={`hud-chip${shelfLearned === 'unlearned' ? ' is-acc' : ''}`}
                  aria-pressed={shelfLearned === 'unlearned'}
                  onClick={() => setShelfLearned((v) => (v === 'unlearned' ? SUB_ALL : 'unlearned'))}
                >
                  {tr('ui.itemSubs.032')}
                </button>
                <button
                  className={`hud-chip${shelfReadyOnly ? ' is-ok' : ''}`}
                  aria-pressed={shelfReadyOnly}
                  title={tr('ui.hud.107')}
                  onClick={() => setShelfReadyOnly((v) => !v)}
                >
                  <Glyph name="ico-play" size={11} color="currentColor" /> {tr('ui.hud.092')}
                </button>
              </div>
              {shelfShown.length === 0 ? (
                <div className="hud-empty">{tr('ui.hud.096')}</div>
              ) : (
                <table className="hud-table is-queue">
                  <thead>
                    <tr>
                      <th className="hud-queue-led-cell" />
                      <th className="hud-queue-main">{tr('ui.hud.089')}</th>
                      <th className="n">{tr('ui.hud.090')}</th>
                      <th>{tr('ui.hud.091')}</th>
                      <th className="act" />
                    </tr>
                  </thead>
                  <tbody>
                    {shelfShown.map((r) => {
                      const can = shelfCanStart(r)
                      const learned = ownsBlueprint(state, r.id) || ctx.blueprints.get(r.id)?.learnless === true
                      return (
                        <tr key={r.id} {...hoverTipProps(shelfTip(r))}>
                          {/**
                            * **状态灯**（**2026-10-01 船长令**：「组装机蓝图书架处就不要使用 SVG 动画了，
                            * 替换为一个红灯，当运行时切换为绿灯」）：红 = 未运行 / 绿 = 正在造。
                            * 判据 = 本页既有的 `runningBlueprintIds`（core 单点 `manufacturingRunViews`）。
                            */}
                          <td>
                            <span className={'hud-queue-led' + (runningBlueprintIds.has(r.id) ? ' is-on' : '')} />
                          </td>
                          <td className="hud-queue-main">
                            <span className="hud-row" style={{ gap: 6 }}>
                              <RowGlyph glyph={r.glyph} />
                              <span>{r.product}</span>
                              {r.keys.singleUse ? <span className="hud-chip is-warn">{tr('ui.hud.110')}</span> : null}
                            </span>
                          </td>
                          <td className="n">{durText(calcBuildDurationMs(state, ctx, specOf(r.materials, r.buildSeconds)))}</td>
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
              )}
            </div>
          </div>
        )
  )
}
