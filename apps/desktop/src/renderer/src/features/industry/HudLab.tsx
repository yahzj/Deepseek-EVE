import { LabRecipeFilters } from '../../ui/LabRecipeFilters'
import { labAffordableBatches, labRecipeUnlocked, labTechRequirementOf, labMaterialAvailable } from '@whale/core'
import { Glyph, itemGlyphName } from '../../ui/Glyphs'
import { RowGlyph } from '../../ui/itemView'
import { IconBtn, Readout } from '../../ui/hud'
import { aiCoreText } from '../../ui/labelsText'
import { marketPriceOf } from '../../ui/yieldView'
import { tr, cmdText } from '../../i18n/locale'
import { AiCorePick } from './AiCorePick'
import type { IndustryHudModel } from './useIndustryHud'

type HudLabProps = Pick<IndustryHudModel, 'labFilter' | 'setLabFilter' | 'recipes' | 'ctx' | 'state' | 'recipe' | 'labEff' | 'setRecipeId' | 'labLoop' | 'labRuns' | 'labGoalDraft' | 'typeDraft' | 'clearDraft' | 'commitLabLoop' | 'engine' | 'core' | 'usableCores' | 'setCoreSel' | 'lockTip' | 'manualNote' | 'onToast' | 'onGotoMarket'>

export function HudLab({ labFilter, setLabFilter, recipes, ctx, state, recipe, labEff, setRecipeId, labLoop, labRuns, labGoalDraft, typeDraft, clearDraft, commitLabLoop, engine, core, usableCores, setCoreSel, lockTip, manualNote, onToast, onGotoMarket }: HudLabProps) {
  return (
(
          <div className="hud-grid two">
            <div className="hud-panel">
              <h3>
                <Glyph name="ico-lab" size={13} color="currentColor" /> {tr('ui.hud.061')}
              </h3>
              <LabRecipeFilters value={labFilter} onPick={setLabFilter} />
              {recipes.map((r) => {
                const out = ctx.items.get(r.outputItemId)
                const affordable = labAffordableBatches(state, r)
                /** 谜质科技门槛（2026-09-30 船长令 · T5 解锁新燃料配方）：锁着 ⇒ 两个开工键一起置灰 */
                const locked = !labRecipeUnlocked(state, ctx, r)
                const lockTip = locked ? tr('ui.lab.025', { p1: labTechRequirementOf(ctx, r) ?? r.name }) : null
                const on = recipe?.id === r.id
                const eff = labEff.perMinute(r)
                const effGroup = labEff.groups.get(r.outputItemId) ?? [eff]
                const effLo = Math.min(...effGroup)
                const effHi = Math.max(...effGroup)
                const effBest = effHi
                const effPos = effHi > effLo ? (eff - effLo) / (effHi - effLo) : 1
                return (
                  /* ⚠ **可点件必须是真按钮**（`ui-ux-pro-max` 预交付清单 · Compact Control Semantics · Critical：
                     「interactive chips need a native role accessible name state keyboard operation and visible
                     focus；Don't: Use a clickable div」）——2026-09-30 三号接手时由 `<div onClick>` 改过来。 */
                  <button
                    key={r.id}
                    type="button"
                    className={`hud-card${on ? ' is-sel' : ''}`}
                    aria-pressed={on}
                    onClick={() => setRecipeId(r.id)}
                    title={locked ? lockTip! : tr('ui.hud.062')}
                  >
                    <div className="hud-row between">
                      <span className="hud-row" style={{ gap: 7 }}>
                        {out !== undefined ? <RowGlyph glyph={itemGlyphName(out.id, out.kind)} /> : null}
                        <span className="nm">{r.name}</span>
                      </span>
                      <span className={`hud-chip${locked ? ' is-bad' : affordable > 0 ? ' is-ok' : ' is-warn'}`}>
                        <Glyph name={locked ? 'ico-lock' : 'ico-play'} size={11} color="currentColor" /> {locked ? tr('ui.lab.026') : affordable}
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
                    {/* 效率 bullet（**2026-09-30 真值修正**）：区间 = **同产物各配方的实际区间**（件/分钟），
                        目标刻度 = 该产物的最优配方；两端与当前值都给文字（技能：区间与目标都要有标注）。
                        原先那两个数（`outputUnits/12`、刻度钉 92%）是页面自造的。 */}
                    <span className="hud-bullet" title={tr('ui.hud.139', { p1: eff.toFixed(1), p2: effBest.toFixed(1) })}>
                      <span className="rng" style={{ left: 0, width: '100%' }} />
                      <span className="val" style={{ ['--v' as string]: Math.round(effPos * 100) }} />
                      {/* 目标刻度 = 该产物的**最优配方**（区间上端）⇒ 钉在 99.5%（留 2px 免得贴边被裁） */}
                      <span className="tgt" style={{ left: '99.5%' }} />                    </span>
                    <span className="hud-row between" style={{ marginTop: 2 }}>
                      <span className="hud-tiny">{effLo.toFixed(1)}/min</span>
                      <span className="hud-tiny">{tr('ui.hud.140', { p1: eff.toFixed(1) })}</span>
                      <span className="hud-tiny">{effHi.toFixed(1)}/min</span>
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="hud-grid">
              <div className="hud-panel">
                <h3>
                  <Glyph name="ico-feed" size={13} color="currentColor" /> {tr('ui.hud.067')}
                </h3>
                {/**
                 * **循环实验**（**2026-10-01 船长令**：「实验室本质上也是一个组装机，建议按照组装机的来」
                 * ＋「**循环应该和组装机一样是放在顶部的**」）—— 一条线只出一批，连续生产靠这个卡片级开关。
                 *
                 * 位置照**同级相似项**：组装机那张卡里，循环行是**操作区的第一行**（在原版工业页
                 * `panels/Industry.tsx` 的 `.app-belt-actions` 顶部、开工键与运转名册之上）⇒ 本页把它放在
                 * **配方卡（本面板）的顶部**、材料表与开工键之上（与"AI 选择器放配方顶部"那条令同一处）。
                 * 控件形态也用同级相似项：HUD 家族的开关行（`hud-sw-row` ＋ `hud-sw` ＋ 状态 chip）。
                 */}
                {recipe !== null ? (
                  <label className="hud-sw-row" title={tr('ui.lab.032', { p1: labLoop.on ? tr('ui.Industry.055') : tr('ui.Industry.056') })}>
                    <span className="hud-row" style={{ gap: 8 }}>
                      <span>{tr('ui.lab.031')}</span>
                      <span className="hud-tiny app-dim">{tr('ui.lab.035')}{labRuns.length > 0 ? tr('ui.Industry.113', { p1: labRuns.length }) : ''}</span>
                    </span>
                    <span className="hud-row" style={{ gap: 8 }}>
                      {labLoop.on ? (
                        <span className="hud-row" style={{ gap: 6 }}>
                          <span className="hud-tiny">{tr('ui.Industry.058')}</span>
                          <input
                            type="number"
                            min={1}
                            /** 样式复刻同级相似项：HUD 家族现有的输入类 `hud-search`（只加一个定宽，不自造新类） */
                            className="hud-search"
                            style={{ width: 64 }}
                            placeholder="∞"
                            value={labGoalDraft !== '' ? labGoalDraft : labLoop.goal > 0 ? String(labLoop.goal) : ''}
                            title={tr('ui.lab.033')}
                            onChange={(e) => typeDraft(e.target.value)}
                            onBlur={(e) => {
                              clearDraft()
                              commitLabLoop(true, e.target.value)
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                clearDraft()
                                commitLabLoop(true, (e.target as HTMLInputElement).value)
                              }
                            }}
                          />
                        </span>
                      ) : null}
                      {labLoop.produced > 0 ? (
                        <span className="hud-chip">
                          {tr('ui.Industry.061')} {labLoop.produced.toLocaleString('zh-CN')} {tr('ui.lab.034')}
                        </span>
                      ) : null}
                      {labLoop.stopWhy.length > 0 ? <span className="hud-chip is-warn">{tr('ui.Industry.062')}{labLoop.stopWhy}</span> : null}
                      <input
                        type="checkbox"
                        className="hud-sw"
                        checked={labLoop.on}
                        onChange={(e) =>
                          commitLabLoop(e.target.checked, e.target.checked ? (labGoalDraft || (labLoop.goal > 0 ? String(labLoop.goal) : '')) : '')
                        }
                      />
                    </span>
                  </label>
                ) : null}
                {/* 实验室：选择器放"配方"顶部（2026-09-30 船长令：「实验室放到配方顶部」） */}
                <AiCorePick engine={engine} suffix="lab" core={core} usableCores={usableCores} onPick={setCoreSel} />
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
                                  <i style={{ ['--v' as string]: Math.round(pct) }} />
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
                        title={lockTip ?? manualNote ?? tr('ui.hud.074')}
                        primary
                        disabled={lockTip !== null || labAffordableBatches(state, recipe) <= 0 || manualNote !== null}
                        onClick={() => {
                          const r = engine.startLabRunAt(recipe.id, 'pilot')
                          if (!r.ok) onToast(cmdText(r) || tr('ui.hud.075'), true)
                        }}
                      />
                      <IconBtn
                        glyph="ai-core"
                        label={tr('ui.hud.076')}
                        title={lockTip ?? tr('ui.hud.077')}
                        disabled={lockTip !== null || labAffordableBatches(state, recipe) <= 0 || core === null}
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
                      <span>{tr('ui.IndustryPage.143')}</span>
                      <b>
                        <Glyph name="consumable" size={12} color="currentColor" />{' '}
                        {labMaterialAvailable(state, recipe.outputItemId).toLocaleString('zh-CN')}
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
                        {/* 一线一批（2026-10-01）：本行显示**这一批**的产出与进度；累计批数改读循环读数（上方开关行） */}
                        {tr('ui.lab.036', { p1: v.batchUnits })}
                      </span>
                      <span className="hud-bar scan" style={{ marginTop: 5 }}>
                        <i style={{ ['--v' as string]: Math.round(v.percent) }} />
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
        )
  )
}
