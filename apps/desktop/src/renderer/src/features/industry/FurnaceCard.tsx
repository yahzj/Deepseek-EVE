import { RECYCLE_BATCH_M3, RECYCLE_CYCLE_MS, RECYCLE_YIELD_PER_M3, UNBOX_CYCLE_MS, recycleRefiningMultiplier, countWare, industryAvailable, stationActivityStartBlockReason, RARE_WRECK_VOLUME_M3, recycleMineralPoolOf, recycleProfileOf, refineRate, usableAiCoresOf, manualSlotOf } from '@whale/core'
import { bestAiCoreOf } from '@whale/core'
import type { AiCoreType, ItemDef } from '@whale/core'
import { wreckGroupText } from '@whale/data'
import { useId, useState, type ReactNode } from 'react'
import { History } from '../../ui/layoutIcons'
import type { GameEngine } from '../../game/engine'
import '../../styles-unbox-ledger.css'
import { MarkStar } from '../../ui/marks'
import { RowGlyph } from '../../ui/itemView'
import { AiCoreSelect } from '../../ui/aiCoreSelect'
import { itemGlyphName } from '../../ui/Glyphs'
import { isEn, cmdText } from '../../i18n/locale'
import { aiCoreText } from '../../ui/labelsText'
import { mineralRowsOf } from '../../ui/wreckFlavor'
import { marketPriceOf, NetIncomeLine } from '../../ui/yieldView'
import type { PageProps } from '../../pages/common'
import { m3, wreckSourceGalaxyIdsOf } from '../../pages/common'
import { tr } from '../../i18n/locale'
import { WreckFlavorRow } from './WreckFlavorRow'
import { UnboxLedgerRows } from './UnboxLedgerRows'

export function FurnaceCard({ def, engine, onToast, highlight = false, onGotoMap }: { def: ItemDef; engine: GameEngine; onToast: PageProps['onToast']; highlight?: boolean; onGotoMap?: (tab: 'mine' | 'salvage', ids: string[]) => void }): ReactNode {
  const state = engine.state
  const isWreck = def.kind === 'wreck'
  const isBox = def.kind === 'container'
  const [ledgerOpen, setLedgerOpen] = useState(false)
  const ledgerId = useId()
  const unboxRecord = isBox ? engine.unboxLedgerOf(def.id) : undefined
  const wreckProfile = isWreck ? recycleProfileOf(engine.ctx, def.id) : null
  const isRareBox = wreckProfile?.rare === true
  const rate = refineRate(state, engine.ctx)
  const availableNow = industryAvailable(state, engine.ctx, def.id)
  const manualTotal = industryAvailable(state, engine.ctx, def.id, 'pilot')
  const total = manualTotal
  const gotoTarget: { tab: 'mine' | 'salvage'; ids: string[] } | null = isWreck
    ? (() => {
        const ids = wreckSourceGalaxyIdsOf(engine.ctx, def.id)
        return ids.length > 0 ? { tab: 'salvage' as const, ids } : null
      })()
    : (() => {
        const belts = engine.belts.filter((b) => b.oreId === def.id)
        return belts.length > 0 ? { tab: 'mine' as const, ids: belts.map((b) => b.id) } : null
      })()
  const runs = engine.refineRunViews().filter((v) => v.itemId === def.id)
  const running = runs.length > 0
  const claimHeld = runs.reduce((s, v) => s + (v.claimedUnits ?? 0), 0)
  const [coreSel, setCoreSel] = useState<AiCoreType>(() => bestAiCoreOf(state) ?? 'basic')
  const usableCores = usableAiCoresOf(state)
  const core = usableCores.includes(coreSel) ? coreSel : (usableCores[0] ?? null)
  const noStockNote =
    claimHeld > 0
      ? tr("ui.IndustryPage.016")
      : tr("ui.IndustryPage.017")
  const slot = manualSlotOf(state)
  const manualNote =
    slot === 'refine'
      ? tr("ui.IndustryPage.018")
      : slot === 'manufacturing'
        ? tr("ui.IndustryPage.019")
        : slot === 'lab'
          ? tr("ui.hud.212")
          : (() => { const block = stationActivityStartBlockReason(state, engine.ctx, 'refine'); return block ? cmdText(block) : null })()

  function runWith(worker: AiCoreType | 'pilot'): void {
    const r = isBox
      ? engine.startUnboxRunAt(def.id, worker)
      : isWreck
        ? engine.startRecycleRunAt(def.id, worker)
        : engine.startRefineRunAt(def.id, worker)
    if (!r.ok) {
      onToast(cmdText(r) || tr('ui.IndustryPage.112'), true)
      return
    }
    if (r.queued) { onToast(tr('core.busy.020')); return }
    const who = worker === 'pilot' ? tr("ui.IndustryPage.020") : tr("ui.IndustryPage.068", { p1: aiCoreText(worker) })
    onToast(
      isBox
        ? tr("ui.IndustryPage.069", { p1: def.name, total: total, who: who, p4: Math.max(1, Math.round(UNBOX_CYCLE_MS / 1000)) })
        : isWreck
          ? isRareBox
          ? tr("ui.IndustryPage.070", { p1: def.name, p2: Math.min(RARE_WRECK_VOLUME_M3, Math.round(total * 10) / 10), RARE_WRECK_VOLUME_M3: RARE_WRECK_VOLUME_M3, who: who, RECYCLE_BATCH_M3: RECYCLE_BATCH_M3 })
          : tr("ui.IndustryPage.071", { p1: def.name, p2: Math.round(total * 10) / 10, who: who })
        : tr("ui.IndustryPage.072", { p1: def.name, p2: total.toLocaleString('zh-CN'), who: who }),
    )
  }
  function stopRun(runId: number, hasClaim: boolean): void {
    const r = engine.stopRefineRunAt(runId)
    if (!r.ok) onToast(cmdText(r) || tr('ui.IndustryPage.105'), true)
    else if (hasClaim)
      onToast(tr("ui.IndustryPage.073"))
    else onToast(tr("ui.IndustryPage.074"))
  }

  const boxSeconds = Math.max(1, Math.round(UNBOX_CYCLE_MS / 1000))
  let dataLine: ReactNode
  if (running) {
    dataLine = isBox
      ? tr("ui.IndustryPage.075", { p1: runs.length, p2: total.toLocaleString('zh-CN') })
      : isWreck
        ? tr("ui.IndustryPage.076", { p1: runs.length, p2: Math.round((total + claimHeld) * 10) / 10 }) +
          (claimHeld > 0
            ? tr("ui.IndustryPage.077", { p1: Math.round(claimHeld * 10) / 10, p2: Math.round(total * 10) / 10 })
            : '')
        : tr("ui.IndustryPage.078", { p1: runs.length, p2: total.toLocaleString('zh-CN'), p3: m3(total * def.unitM3) })
  } else if (isBox) {
    dataLine = tr("ui.IndustryPage.079", { p1: total.toLocaleString('zh-CN'), boxSeconds: boxSeconds })
  } else if (isWreck) {
    const qty = Math.round(total * 10) / 10
    dataLine = isRareBox
      ? tr("ui.IndustryPage.080", { qty: qty, p2: Math.floor(total / RARE_WRECK_VOLUME_M3), RARE_WRECK_VOLUME_M3: RARE_WRECK_VOLUME_M3, RECYCLE_BATCH_M3: RARE_WRECK_VOLUME_M3, p5: Math.round(RECYCLE_CYCLE_MS / 1000) })
      : tr("ui.IndustryPage.081", { qty: qty, RECYCLE_BATCH_M3: RECYCLE_BATCH_M3, p3: Math.round(RECYCLE_CYCLE_MS / 1000), p4: Math.ceil(total / RECYCLE_BATCH_M3) })
  } else {
    const batch = def.refineBatchUnits && def.refineBatchUnits > 0 ? Math.floor(def.refineBatchUnits) : 10
    const cycleS = def.refineCycleMs && def.refineCycleMs > 0 ? Math.round(def.refineCycleMs / 100) / 10 : 6
    dataLine = tr("ui.IndustryPage.082", { p1: total.toLocaleString('zh-CN'), p2: m3(total * def.unitM3), batch: batch, cycleS: cycleS, p5: Math.ceil(total / batch) })
  }

  let econ: ReactNode = null
  if (isWreck) {
    const profile = wreckProfile
    if (profile) {
      const recLv = Math.min(5, state.skills.trained['salvage-recycling'] ?? 0)
      const cycleMs = Math.max(1, Math.round(RECYCLE_CYCLE_MS * Math.max(0.6, 1 - 0.04 * recLv)))
      const mineralRows = mineralRowsOf(
        recycleMineralPoolOf(profile),
        {
          batchM3: RECYCLE_BATCH_M3,
          yieldPerM3: RECYCLE_YIELD_PER_M3[profile.tier],
          refiningMultiplier: recycleRefiningMultiplier(state),
          priceOf: (id) => engine.ctx.items.get(id)?.baseSellPriceIsk ?? 0,
        },
        (id) => engine.ctx.items.get(id)?.name ?? id,
      )
      const mineralTip =
        tr("ui.IndustryPage.083", { RECYCLE_BATCH_M3: RARE_WRECK_VOLUME_M3 }) +
        tr('ui.IndustryPage.113') +
        (profile.note
          ? tr("ui.IndustryPage.084", {
              p1:
                (profile.groupKey !== undefined
                  ? wreckGroupText(profile.groupKey, isEn() ? 'en' : 'zh', 'note')
                  : undefined) ?? profile.note,
            })
          : '')
      econ = (
        <div className="app-belt-econ">
          {mineralRows.length > 0 ? (
            <>
              <div title={mineralTip}>{tr("ui.IndustryPage.021")}</div>
              {mineralRows.map((r) => (
                <div key={r.id} className="app-belt-out" title={mineralTip}>
                  {r.name} {tr("ui.IndustryPage.022")} {r.units}
                  {/* **残骸的信用点收入估价已移除**（**2026-09-23 船长令**：「残骸的信用点收入估价可以移除」）：
                      只留"仓库已拥有 + 市场当前行情价"，与其它卡同一套语言（取数见 `ui/yieldView.tsx`）。 */}
                  <span className="app-dim">
                    {' '}
                    （{tr('ui.Yield.002')} {countWare(state, r.id).toLocaleString('zh-CN')} · {tr('ui.Yield.003')}{' '}
                    {marketPriceOf(state, engine.ctx, r.id)?.toLocaleString('zh-CN') ?? '—'}）
                  </span>
                </div>
              ))}
            </>
          ) : null}
          {/* 「保底 ≈N 信用点/h」整行已删（2026-09-23 船长令：残骸的信用点收入估价可以移除） */}
          {/**
           * **净收益/h（仅调试模式 · 2026-09-29 船长令「希望在调试模式下看到各个活动的净收益」）**：
           * 残骸回收是**批量型活动**（一批 = `RECYCLE_BATCH_M3` m³、周期 = 上面那个 `cycleMs`）⇒
           * `(整批保底矿物价值 − 耗料成本 0) ÷ 周期 × 3600`。**回收无耗料可扣**（残骸是打捞来的）
           * ⇒ `costIsk = 0`。
           * ⚠ **口径 = 上面逐项那几行的 `isk` 之和**（同一份 `mineralRowsOf` 估算，取站内收价基准），
           * 即"这一炉拆出来的矿物值多少"——与卡面自洽；**不是**按市场行情另算一套。
           * ⚠ 这是"**拆解成矿物再卖**"的读数；残骸**直销**那条路按船长定规**不计入估值**。
           */}
          <NetIncomeLine price={mineralRows.reduce((s, r) => s + r.isk, 0)} costIsk={0} buildMs={cycleMs} />
        </div>
      )
    }
  } else {
    const batch = def.refineBatchUnits && def.refineBatchUnits > 0 ? Math.floor(def.refineBatchUnits) : 10
    const cycleMs = def.refineCycleMs && def.refineCycleMs > 0 ? def.refineCycleMs : 6_000
    const outs = (def.refine ?? [])
      .map((row) => {
        const mineral = engine.ctx.items.get(row.mineralId)
        if (!mineral) return null
        const units = Math.floor(batch * row.perOre * rate)
        return units > 0 ? { def: mineral, units } : null
      })
      .filter((x): x is { def: ItemDef; units: number } => x !== null)
    const perHourOf = (units: number): number => Math.round(units * (3_600_000 / cycleMs))
    econ = (
      <div className="app-belt-econ">
        {/* 2026-09-10 船长：产出做成「♨ 产出：」标题 + 每种产物缩进一行，行尾带自己拥有的数量 */}
        {outs.length === 0 ? (
          <div>{tr("ui.IndustryPage.027")}</div>
        ) : (
          <>
            <div>{tr("ui.IndustryPage.028")}</div>
            {outs.map((o) => (
              <div key={o.def.id} className="app-belt-out">
                {o.def.name} ×{perHourOf(o.units).toLocaleString('zh-CN')}/h
                <span className="app-dim">
                  {' '}
                  {tr('ui.Yield.004', {
                    p1: countWare(state, o.def.id).toLocaleString('zh-CN'),
                    p2: marketPriceOf(state, engine.ctx, o.def.id)?.toLocaleString('zh-CN') ?? '—',
                  })}
                </span>
              </div>
            ))}
          </>
        )}
        {/**
         * **净收益/h**（**2026-09-29 船长令**：「我只想在调试模式下显示」）——
         * 与上面每行的"×N/h（仓库 · 行情）"并列，但它是**整批口径的净值**：
         * `(整批产物行情值 − 整批耗料行情成本) ÷ 精炼周期 × 3600`，与组装机/造船厂同一个组件、同一把尺。
         * 发布版不渲染（`debugEnabled()` 在本机之外恒 false）。
         */}
        <NetIncomeLine
          price={outs.reduce((s, o) => s + o.units * (marketPriceOf(state, engine.ctx, o.def.id) ?? o.def.baseSellPriceIsk ?? 0), 0)}
          costIsk={batch * (marketPriceOf(state, engine.ctx, def.id) ?? def.baseSellPriceIsk ?? 0)}
          buildMs={cycleMs}
        />
      </div>
    )
  }

  return (
    <div className={`app-belt-card${highlight ? ' is-goto' : ''}`} key={def.id}>
      <div className="app-belt-head">
        <span className="app-belt-name">
          <RowGlyph glyph={itemGlyphName(def.id, def.kind)} /> {def.name}
          {isRareBox ? (
            <em
              className="app-chip is-rare"
              title={tr("ui.IndustryPage.034")}
            >
              {tr("ui.IndustryPage.035")}
            </em>
          ) : null}
        </span>
        {/* 卡头右侧：标记星标（2026-09-10 船长） + 去矿带/去打捞跳转 */}
        <span className="app-belt-head-right">
          <MarkStar engine={engine} kind="recipes" id={def.id} />
          {isBox ? (
            <button type="button" className="app-btn is-small app-unbox-ledger-toggle"
              aria-expanded={ledgerOpen} aria-controls={ledgerId}
              aria-label={tr(ledgerOpen ? 'ui.IndustryPage.151' : 'ui.IndustryPage.149')}
              title={tr(ledgerOpen ? 'ui.IndustryPage.151' : 'ui.IndustryPage.149')}
              onClick={() => setLedgerOpen(open => !open)}>
              <History size={16} aria-hidden="true" />
            </button>
          ) : null}
          {gotoTarget && onGotoMap ? (
            <button
              className="app-btn is-small"
              title={
                isWreck
                  ? tr("ui.IndustryPage.036")
                  : tr("ui.IndustryPage.101", { p1: gotoTarget.ids.length > 1 ? tr("ui.IndustryPage.085", { p1: gotoTarget.ids.length }) : '' })
              }
              onClick={() => onGotoMap(gotoTarget.tab, gotoTarget.ids)}
            >
              {isWreck ? tr("ui.IndustryPage.037") : tr("ui.IndustryPage.038")}
            </button>
          ) : null}
        </span>
      </div>
      <div className="app-belt-desc">
        {isWreck
          ? isRareBox
            ? tr("ui.IndustryPage.039")
            : tr("ui.IndustryPage.040")
          : def.description}
      </div>
      {isWreck ? <WreckFlavorRow def={def} engine={engine} /> : null}
      <div className="app-belt-ore">{dataLine}</div>
      {isBox && ledgerOpen ? (
        <section className="app-unbox-ledger" id={ledgerId} aria-label={tr('ui.IndustryPage.148')}>
          <div className="app-unbox-ledger-head">{tr('ui.IndustryPage.148')}</div>
          <UnboxLedgerRows engine={engine} record={unboxRecord} />
        </section>
      ) : null}
      {econ}
      <div className="app-belt-actions">
        {/* 运转单位名册（每台一行：劳动者 + 当前批进度条 + 停）——矿带副船名册同款结构 */}
        {runs.length > 0 ? (
          <div className="app-belt-workers">
            {runs.map((v) => (
              <span key={v.id} className="app-belt-worker">
                <span className="app-belt-worker-name">
                  {v.worker === 'pilot' ? tr("ui.IndustryPage.041") : tr("ui.IndustryPage.086", { p1: v.workerLabel })} ·{' '}
                  {isBox ? tr("ui.IndustryPage.087", { p1: v.batchesDone }) : isWreck ? tr("ui.IndustryPage.088", { p1: v.batchesDone }) : tr("ui.IndustryPage.089", { p1: v.batchesDone })}
                  {v.claimedUnits !== undefined
                    ? tr("ui.IndustryPage.090", { p1: Math.round(v.claimedUnits * 10) / 10 })
                    : ''}
                </span>
                <span
                  className="app-progress-mini"
                  title={tr("ui.IndustryPage.107", { p1: v.percent, p2: isBox ? tr("ui.IndustryPage.091", { p1: Math.round(v.cycleMs / 100) / 10 }) : tr("ui.IndustryPage.092", { p1: v.batchUnits, p2: Math.round(v.cycleMs / 100) / 10 }), p3: v.claimedUnits !== undefined
                      ? tr("ui.IndustryPage.093", { p1: v.batchUnits })
                      : tr("ui.IndustryPage.042") })}
                >
                  <i style={{ width: `${v.percent}%` }} />
                </span>
                <button
                  className="app-btn is-small is-warn"
                  onClick={() => stopRun(v.id, v.claimedUnits !== undefined)}
                  title={
                    v.claimedUnits !== undefined
                      ? tr("ui.IndustryPage.043")
                      : tr("ui.IndustryPage.044")
                  }
                >
                  {tr('ui.IndustryPage.104')}
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <button
          className="app-btn is-small is-primary"
          disabled={manualNote !== null || manualTotal <= 0}
          title={
            manualNote ??
            (manualTotal <= 0
              ? noStockNote
              : running
                ? tr("ui.IndustryPage.094", { p1: isBox ? tr("ui.IndustryPage.045") : tr("ui.IndustryPage.042") })
                : isBox
                  ? tr("ui.IndustryPage.095", { p1: Math.max(1, Math.round(UNBOX_CYCLE_MS / 1000)) })
                  : isWreck
                    ? isRareBox
                      ? tr("ui.IndustryPage.096", { RARE_WRECK_VOLUME_M3: RARE_WRECK_VOLUME_M3, RECYCLE_BATCH_M3: RARE_WRECK_VOLUME_M3 })
                      : tr("ui.IndustryPage.046")
                    : tr("ui.IndustryPage.047"))
          }
          onClick={() => runWith('pilot')}
        >
          {isBox ? tr("ui.IndustryPage.048") : isWreck ? tr("ui.IndustryPage.049") : tr("ui.IndustryPage.050")}
        </button>
        {/* AI 工位：核心下拉常驻（无可用核心时置灰并在控件里写明，卡面不跳动；船长 2026-09-10）——
            2026-10-02 起走公共件 `ui/aiCoreSelect.tsx`（行为与旧实现逐字一致） */}
        <div className="app-belt-ai">
          <AiCoreSelect
            engine={engine}
            value={core}
            onPick={setCoreSel}
            titleReady={tr("ui.IndustryPage.052")}
            titleEmpty={tr("ui.IndustryPage.051")}
            emptyLabel={tr("ui.ShipPage.070")}
          />
          <button
            className="app-btn is-small"
            disabled={!core || availableNow <= 0}
            title={
              core
                ? availableNow <= 0
                  ? noStockNote
                  : running
                    ? tr("ui.IndustryPage.053")
                    : tr("ui.IndustryPage.054")
                : tr("ui.IndustryPage.055")
            }
            onClick={() => core && runWith(core)}
          >
            {isBox ? tr("ui.IndustryPage.056") : isWreck ? tr("ui.IndustryPage.057") : tr("ui.IndustryPage.058")}
          </button>
        </div>
      </div>
    </div>
  )
}
