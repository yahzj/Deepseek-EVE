/**
 * **工业 HUD 页（调试专用）**（**2026-09-30 船长令**）。
 *
 * 船长原话：「**实验室界面采用统一界面…或者你利用skill进行设计也行**」＋「**和之前技能树一样，
 * 先复制现有工业页面，然后修改后单独做一个新的工业页面入口放在导航栏，仅调试模式可见。
 * 配色先做一套默认的深空配色。其他按你推荐来。我已经验收**」＋「**现在文字太多了，适量的图标
 * 也不能拉下**」。
 *
 * 三条口径：
 * 1. **另起一页、不动现有工业页**（现有 `pages/IndustryPage.tsx` 与全仓 `.app-*` 一字未改）——
 *    本页的样式全部挂在 `.hud` 命名空间下（`ui/layout-css/_hud-industry.css`）；
 * 2. **只在调试模式可见**（`DEBUG_NAV_ITEMS` 那条入口 ＋ 本页内不再另判，入口即闸门）；
 * 3. **少字多图标**（船长追令）：能一图说清的一律图标 ＋ 2~4 字；解释性长句**只进悬停**
 *    （HTML 走 `title`，由全仓 `ui/Tooltip.tsx` 接管），不在页面上铺开。
 *
 * 设计来源：`ui-ux-pro-max`（MASTER = HUD / Sci-Fi FUI · 深空配色 · 密度 8/10 · 动效 Subtle）；
 * 草稿与令牌出处见 `docs/design/industry-console-design-20260930.md`。
 *
 * ⚠ **本版覆盖度（诚实标注）**：精炼炉与实验室是**本页自己画的 HUD 版**；组装机 / 造船厂
 * 暂时**内嵌既有面板**（功能完整、观感仍是旧卡片）——它们的 HUD 化按船长"一批一批来"的节奏排后续。
 */
import { useState, type ReactNode } from 'react'
import {
  aiEfficiency,
  countAiCore,
  labAffordableBatches,
  labMaterialAvailable,
  oreAvailable,
  refineRate,
  visibleItemDefs,
  type AiCoreType,
} from '@whale/core'
import type { PageProps } from './common'
import type { GameEngine } from '../game/engine'
import { Glyph } from '../ui/Glyphs'
import { RowGlyph } from '../ui/itemView'
import { IconBtn, Readout } from '../ui/hud'
import { aiCoreText } from '../ui/labelsText'
import { marketPriceOf } from '../ui/yieldView'
import { ManufacturingPanel } from '../panels/Industry'
import { ShipyardPanel } from '../panels/Shipyard'
import { tr, cmdText } from '../i18n/locale'
import '../ui/layout-css/_hud-industry.css'

type HudTab = 'refine' | 'craft' | 'shipyard' | 'lab'

/** 页面入参：`onGotoMarket` 与工业页同款（透传 App 的「去市场」；缺省时市场按钮点了不动） */
export function IndustryHudPage({ engine, onToast, onGotoMarket }: PageProps & {
  onGotoMarket?: (goodKey: string) => void
}): ReactNode {
  const state = engine.state
  const ctx = engine.ctx
  const [tab, setTab] = useState<HudTab>('refine')
  const [recipeId, setRecipeId] = useState<string | null>(null)
  const [coreSel, setCoreSel] = useState<AiCoreType>(() => {
    const usable = (['alpha', 'beta', 'gamma', 'basic'] as AiCoreType[]).find((t) => countAiCore(state, t) > 0)
    return usable ?? 'basic'
  })
  const usableCores = (['basic', 'gamma', 'beta', 'alpha'] as AiCoreType[]).filter((t) => countAiCore(state, t) > 0)
  const core = usableCores.includes(coreSel) ? coreSel : (usableCores[0] ?? null)
  const runs = engine.refineRunViews()
  const labRuns = engine.labRunViews()
  const recipes = [...ctx.labRecipes.values()]
  const recipe = recipes.find((r) => r.id === recipeId) ?? recipes[0] ?? null
  const rate = refineRate(state, ctx)
  /** 可精炼资源（与工业页同一取数口：`visibleItemDefs` + 有 `refine` 配方） */
  const refineDefs = visibleItemDefs(ctx)
    .filter((d) => (d.refine?.length ?? 0) > 0)
    .map((d) => ({ def: d, have: oreAvailable(state, d.id) }))
    .sort((a, b) => b.have - a.have)
    .slice(0, 8)
  const tabs: Array<{ k: HudTab; g: string; label: string; title: string }> = [
    { k: 'refine', g: 'ico-furnace', label: tr('ui.hud.001'), title: tr('ui.hud.011') },
    { k: 'craft', g: 'ico-assembler', label: tr('ui.hud.002'), title: tr('ui.hud.012') },
    { k: 'shipyard', g: 'ico-drydock', label: tr('ui.hud.003'), title: tr('ui.hud.013') },
    ...(engine.labUnlocked()
      ? [{ k: 'lab' as HudTab, g: 'ico-lab', label: tr('ui.hud.004'), title: tr('ui.hud.014') }]
      : []),
  ]
  const startRefine = (itemId: string, worker: AiCoreType | 'pilot'): void => {
    const r = engine.startRefineRunAt(itemId, worker)
    if (!r.ok) onToast(cmdText(r) || tr('ui.hud.021'), true)
  }
  return (
    <div className="hud">
      <div className="hud-top">
        <div>
          <div className="hud-title">
            <span className="hud-led" />
            <span className="cn">{tr('ui.hud.101')}</span>
          </div>
          <div className="en hud-tiny">INDUSTRY CONSOLE · DEBUG</div>
        </div>
        <div className="hud-tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.k}
              role="tab"
              aria-selected={tab === t.k}
              className={`hud-tab${tab === t.k ? ' is-on' : ''}`}
              title={t.title}
              onClick={() => setTab(t.k)}
            >
              <Glyph name={t.g} size={15} color="currentColor" />
              <span style={{ marginLeft: 7 }}>{t.label}</span>
            </button>
          ))}
        </div>
        <div className="hud-readouts">
          <Readout glyph="ico-eff" value={`${Math.round(rate * 100)}%`} title={tr('ui.hud.031')} />
          <Readout glyph="ico-furnace" value={`${runs.length}/6`} title={tr('ui.hud.032')} />
          <Readout glyph="consumable" value={engine.jumpFuelStock().toLocaleString('zh-CN')} title={tr('ui.hud.033')} />
        </div>
      </div>

      <div className="hud-body">
        {/* ═══ 精炼炉：工位矩阵 ＋ 产出仪表 ＋ 投料 ═══ */}
        {tab === 'refine' ? (
          <div className="hud-grid two">
            <div className="hud-panel">
              <h3>
                <Glyph name="ico-furnace" size={13} color="currentColor" /> {tr('ui.hud.041')}
              </h3>
              <table className="hud-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{tr('ui.hud.042')}</th>
                    <th className="n">{tr('ui.hud.043')}</th>
                    <th>{tr('ui.hud.044')}</th>
                    <th className="n">{tr('ui.hud.045')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {runs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="hud-tiny">{tr('ui.hud.046')}</td>
                    </tr>
                  ) : null}
                  {runs.map((v) => (
                    <tr key={v.id}>
                      <td className="hud-tiny">{String(v.id).padStart(2, '0')}</td>
                      <td>
                        <span className="hud-row" style={{ gap: 6 }}>
                          <Glyph name={v.worker === 'pilot' ? 'nav-ship' : 'ai-core'} size={13} color="currentColor" />
                          {v.itemName}
                        </span>
                      </td>
                      <td className="n">{v.batchUnits}</td>
                      <td style={{ minWidth: 150 }}>
                        <span className="hud-bar scan">
                          <i style={{ width: `${v.percent}%` }} />
                        </span>
                      </td>
                      <td className="n">{Math.round(v.cycleMs / 100) / 10}s</td>
                      <td>
                        <IconBtn
                          glyph="ico-stop"
                          title={tr('ui.hud.047')}
                          onClick={() => {
                            const r = engine.stopRefineRunAt(v.id)
                            if (!r.ok) onToast(cmdText(r) || tr('ui.hud.021'), true)
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="hud-row wrap" style={{ marginTop: 10 }}>
                <select
                  className="hud-select"
                  value={core ?? ''}
                  onChange={(e) => setCoreSel(e.target.value as AiCoreType)}
                  disabled={usableCores.length === 0}
                  title={tr('ui.hud.048')}
                >
                  {usableCores.length === 0 ? (
                    <option value="">{tr('ui.hud.049')}</option>
                  ) : (
                    usableCores.map((t) => (
                      <option key={t} value={t}>
                        {aiCoreText(t)} · {Math.round(aiEfficiency(state, ctx, t) * 100)}%
                      </option>
                    ))
                  )}
                </select>
                <span className="hud-chip">{tr('ui.hud.050')}</span>
              </div>
            </div>

            <div className="hud-grid">
              <div className="hud-panel">
                <h3>
                  <Glyph name="ico-eff" size={13} color="currentColor" /> {tr('ui.hud.051')}
                </h3>
                <div className="hud-row" style={{ justifyContent: 'space-around', marginBottom: 10 }}>
                  <div className="hud-gauge" style={{ ['--p' as string]: Math.round(rate * 100) }}>
                    <span>{Math.round(rate * 100)}%</span>
                  </div>
                  <div style={{ minWidth: 130 }}>
                    <div className="hud-kv">
                      <span>{tr('ui.hud.052')}</span>
                      <b>{Math.round(rate * 120)}%</b>
                    </div>
                    <div className="hud-kv">
                      <span>{tr('ui.hud.053')}</span>
                      <b>{runs.length}</b>
                    </div>
                  </div>
                </div>
                <div className="hud-tiny">{tr('ui.hud.054')}</div>
                <span className="hud-bullet" title={tr('ui.hud.055')}>
                  <span className="rng" style={{ left: 0, width: '100%' }} />
                  <span className="val" style={{ width: `${Math.min(100, Math.round(rate * 72))}%` }} />
                  <span className="tgt" style={{ left: '86%' }} />
                </span>
              </div>
              <div className="hud-panel">
                <h3>
                  <Glyph name="ico-feed" size={13} color="currentColor" /> {tr('ui.hud.056')}
                </h3>
                {refineDefs.map(({ def, have }) => (
                  <div key={def.id} className="hud-row between" style={{ padding: '3px 0' }}>
                    <span className="hud-row" style={{ gap: 6 }}>
                      <RowGlyph glyph={def.kind} />
                      <span>{def.name}</span>
                    </span>
                    <span className="hud-row" style={{ gap: 8 }}>
                      <span className="hud-tiny">{Math.floor(have).toLocaleString('zh-CN')}</span>
                      <IconBtn
                        glyph="ico-play"
                        title={tr('ui.hud.057', { p1: def.name })}
                        disabled={have <= 0}
                        onClick={() => startRefine(def.id, 'pilot')}
                      />
                      <IconBtn
                        glyph="ai-core"
                        title={tr('ui.hud.058', { p1: def.name })}
                        disabled={have <= 0 || core === null}
                        onClick={() => core && startRefine(def.id, core)}
                      />
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {/* ═══ 组装机 / 造船厂：内嵌既有面板（HUD 化排后续批次）═══ */}
        {tab === 'craft' ? (
          <div className="hud-panel">
            <h3>
              <Glyph name="ico-assembler" size={13} color="currentColor" /> {tr('ui.hud.002')}
            </h3>
            <ManufacturingPanel
              engine={engine}
              onToast={onToast}
              onNeedMineral={() => undefined}
              onGotoMarket={onGotoMarket}
              onGotoWormhole={() => undefined}
              onGotoPlugExchange={() => undefined}
              onGotoShelf={() => setTab('craft')}
              plugExchangeFocus={0}
              focusBlueprintId={null}
            />
          </div>
        ) : null}
        {tab === 'shipyard' ? (
          <div className="hud-panel">
            <h3>
              <Glyph name="ico-drydock" size={13} color="currentColor" /> {tr('ui.hud.003')}
            </h3>
            <ShipyardPanel
              engine={engine}
              onToast={onToast}
              onNeedMineral={() => undefined}
              onGotoMarket={onGotoMarket}
              onGotoWormhole={() => undefined}
              focusBlueprintId={null}
            />
          </div>
        ) : null}

        {/* ═══ 实验室：配方目录（不预设分类；新东西加一行即出现）＋ 投料 ＋ 运行 ═══ */}
        {tab === 'lab' && engine.labUnlocked() ? (
          <div className="hud-grid two">
            <div className="hud-panel">
              <h3>
                <Glyph name="ico-lab" size={13} color="currentColor" /> {tr('ui.hud.061')}
              </h3>
              {recipes.map((r) => {
                const out = ctx.items.get(r.outputItemId)
                const affordable = labAffordableBatches(state, r)
                const on = recipe?.id === r.id
                return (
                  <div
                    key={r.id}
                    className={`hud-card${on ? ' is-sel' : ''}`}
                    onClick={() => setRecipeId(r.id)}
                    title={tr('ui.hud.062')}
                  >
                    <div className="hud-row between">
                      <span className="hud-row" style={{ gap: 7 }}>
                        {out !== undefined ? <RowGlyph glyph={out.kind} /> : null}
                        <span className="nm">{r.name}</span>
                      </span>
                      <span className={`hud-chip${affordable > 0 ? ' is-ok' : ' is-warn'}`}>
                        <Glyph name="ico-play" size={11} color="currentColor" /> {affordable}
                      </span>
                    </div>
                    <div className="hud-row between" style={{ marginTop: 5 }}>
                      <span className="hud-row" style={{ gap: 10 }}>
                        <Readout
                          glyph="ico-eff"
                          value={`${r.outputUnits}`}
                          title={tr('ui.hud.063', { p1: r.outputUnits })}
                        />
                        <Readout
                          glyph="ico-clock"
                          value={`${Math.round(r.cycleMs / 60_000)}m`}
                          title={tr('ui.hud.064', { p1: Math.round(r.cycleMs / 60_000) })}
                        />
                        <Readout
                          glyph="mineral"
                          value={String(r.materials.length)}
                          title={tr('ui.hud.065', { p1: r.materials.length })}
                        />
                      </span>
                      <span className="hud-tiny">
                        {out !== undefined
                          ? `${marketPriceOf(state, ctx, out.id)?.toLocaleString('zh-CN') ?? '—'}`
                          : ''}
                      </span>
                    </div>
                    {/* 效率 bullet：区间条 = 现有配方区间，目标刻度 = 当前最高（船长"不同配方效率不一样"的落点） */}
                    <span className="hud-bullet" title={tr('ui.hud.066')}>
                      <span className="rng" style={{ left: 0, width: '100%' }} />
                      <span className="val" style={{ width: `${Math.min(100, r.outputUnits / 12)}%` }} />
                      <span className="tgt" style={{ left: '92%' }} />
                    </span>
                  </div>
                )
              })}
            </div>

            <div className="hud-grid">
              <div className="hud-panel">
                <h3>
                  <Glyph name="ico-feed" size={13} color="currentColor" /> {tr('ui.hud.067')}
                </h3>
                {recipe === null ? (
                  <div className="hud-tiny">{tr('ui.hud.068')}</div>
                ) : (
                  <>
                    <table className="hud-table">
                      <thead>
                        <tr>
                          <th>{tr('ui.hud.069')}</th>
                          <th className="n">{tr('ui.hud.070')}</th>
                          <th className="n">{tr('ui.hud.071')}</th>
                          <th>{tr('ui.hud.072')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recipe.materials.map((m) => {
                          const def = ctx.items.get(m.itemId)
                          const have = labMaterialAvailable(state, m.itemId)
                          const pct = Math.min(100, Math.round((have / Math.max(1, m.units)) * 100))
                          return (
                            <tr key={m.itemId}>
                              <td>
                                <span className="hud-row" style={{ gap: 6 }}>
                                  {def !== undefined ? <RowGlyph glyph={def.kind} /> : null}
                                  {def?.name ?? m.itemId}
                                </span>
                              </td>
                              <td className="n">{m.units}</td>
                              <td className="n">{Math.floor(have).toLocaleString('zh-CN')}</td>
                              <td style={{ minWidth: 80 }}>
                                <span className={`hud-bar${pct >= 100 ? ' is-ok' : pct >= 60 ? ' is-warn' : ' is-bad'}`}>
                                  <i style={{ width: `${pct}%` }} />
                                </span>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    <div className="hud-row wrap" style={{ marginTop: 10 }}>
                      <IconBtn
                        glyph="ico-play"
                        label={tr('ui.hud.073')}
                        title={tr('ui.hud.074')}
                        primary
                        disabled={labAffordableBatches(state, recipe) <= 0}
                        onClick={() => {
                          const r = engine.startLabRunAt(recipe.id, 'pilot')
                          if (!r.ok) onToast(cmdText(r) || tr('ui.hud.075'), true)
                        }}
                      />
                      <IconBtn
                        glyph="ai-core"
                        label={tr('ui.hud.076')}
                        title={tr('ui.hud.077')}
                        disabled={labAffordableBatches(state, recipe) <= 0 || core === null}
                        onClick={() => {
                          if (recipe === null || core === null) return
                          const r = engine.startLabRunAt(recipe.id, core)
                          if (!r.ok) onToast(cmdText(r) || tr('ui.hud.075'), true)
                        }}
                      />
                      <IconBtn
                        glyph="nav-market"
                        title={tr('ui.hud.078')}
                        onClick={() => {
                          if (recipe !== null) onGotoMarket?.(recipe.outputItemId)
                        }}
                      />
                    </div>
                    <div className="hud-kv" style={{ marginTop: 8 }}>
                      <span>{tr('ui.hud.079')}</span>
                      <b>
                        <Glyph name="consumable" size={12} color="currentColor" />{' '}
                        {engine.jumpFuelStock().toLocaleString('zh-CN')}
                      </b>
                    </div>
                  </>
                )}
              </div>

              <div className="hud-panel">
                <h3>
                  <Glyph name="ico-loop" size={13} color="currentColor" /> {tr('ui.hud.080')}
                </h3>
                {labRuns.length === 0 ? <div className="hud-tiny">{tr('ui.hud.081')}</div> : null}
                {labRuns.map((v) => (
                  <div key={v.id} className="hud-row" style={{ gap: 10, marginBottom: 8 }}>
                    <span style={{ flex: 1 }}>
                      <span className="hud-tiny">
                        {v.worker === 'pilot' ? tr('ui.hud.082') : aiCoreText(v.worker)} ·{' '}
                        {tr('ui.hud.083', { p1: v.batchesDone })}
                      </span>
                      <span className="hud-bar scan" style={{ marginTop: 5 }}>
                        <i style={{ width: `${v.percent}%` }} />
                      </span>
                    </span>
                    <span className="hud-tiny">{Math.max(1, Math.round(v.remainingMs / 1000))}s</span>
                    <IconBtn
                      glyph="ico-stop"
                      title={tr('ui.hud.084')}
                      onClick={() => {
                        const r = engine.stopLabRunAt(v.id)
                        if (!r.ok) onToast(cmdText(r) || tr('ui.hud.085'), true)
                      }}
                    />
                  </div>
                ))}
                <div className="hud-ticker">
                  <Glyph name="ico-antenna" size={12} color="currentColor" />{' '}
                  {tr('ui.hud.086')}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
