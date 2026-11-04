import { type ReactNode } from 'react'
import type { PageProps } from '../../pages/common'
import { Glyph } from '../../ui/Glyphs'
import { Readout } from '../../ui/hud'
import { tr } from '../../i18n/locale'
import '../../ui/layout-css/_hud-industry.css'
import { useIndustryHud } from './useIndustryHud'
import { HudRefining } from './HudRefining'
import { HudManufacturing } from './HudManufacturing'
import { HudShipyard } from './HudShipyard'
import { HudLab } from './HudLab'

export function IndustryHudPage({ engine, onToast, onGotoMarket }: PageProps & {
  onGotoMarket?: (goodKey: string) => void
}): ReactNode {
  const {
    tabs,
    tab,
    setTab,
    rate,
    runs,
    stationCap,
    production,
    ringSegments,
    rateBase,
    rateMax,
    ratePos,
    foldStation,
    setFoldStation,
    core,
    usableCores,
    setCoreSel,
    ctx,
    stationTip,
    feedShown,
    feedTab,
    setFeedTab,
    setFeedSub,
    feedSub,
    feedKwRaw,
    setFeedKwRaw,
    feedTip,
    feedShortOf,
    manualNote,
    startFeed,
    manuRuns,
    durText,
    stopManu,
    shelfKwRaw,
    setShelfKwRaw,
    shelfFilterActive,
    shelfShown,
    shelfRows,
    state,
    shelfKind,
    setShelfKind,
    setShelfSub,
    shelfSubOptions,
    shelfSub,
    shelfLearned,
    setShelfLearned,
    shelfReadyOnly,
    setShelfReadyOnly,
    shelfCanStart,
    shelfTip,
    runningBlueprintIds,
    specOf,
    manuManualNote,
    startManu,
    dockRuns,
    shipShown,
    tierFilter,
    setTierFilter,
    shipRows,
    labFilter,
    setLabFilter,
    recipes,
    recipe,
    labEff,
    setRecipeId,
    labLoop,
    labRuns,
    labGoalDraft,
    typeDraft,
    clearDraft,
    commitLabLoop,
    lockTip,
  } = useIndustryHud({ engine, onToast, onGotoMarket })
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
              id={`hud-tab-${t.k}`}
              role="tab"
              aria-selected={tab === t.k}
              /* 页签与面板的关联（技能预交付清单：交互件要有 role/名称/状态/键盘/可见焦点四件套） */
              aria-controls={`hud-panel-${t.k}`}
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
          {/* ⚠ 2026-09-30 真值修正：上限从**写死的 6** 改成 `aiCoreCap + industryAiBonus`（技能驱动、会变） */}
          <Readout glyph="ico-furnace" value={`${runs.length}/${stationCap}`} title={tr('ui.hud.032')} />
          <Readout glyph="consumable" value={engine.jumpFuelStock().toLocaleString('zh-CN')} title={tr('ui.hud.033')} />
        </div>
      </div>

      <div className="hud-body" id={`hud-panel-${tab}`} role="tabpanel" aria-labelledby={`hud-tab-${tab}`}>
        {/* ═══ 精炼炉（**2026-09-30 船长令**：产出读数块挪到**左侧顶部**、圆环按各资源产值占比分段染色、
             生产项悬停出「左输入 / 右输出」卡；同批修：工位资源图标错 · 投料缺残骸与货柜且没有筛选 ·
             三处自造刻度换真值）═══ */}
        {tab === 'refine' ? <HudRefining
            production={production}
            ringSegments={ringSegments}
            rateBase={rateBase}
            rateMax={rateMax}
            rate={rate}
            runs={runs}
            stationCap={stationCap}
            ratePos={ratePos}
            foldStation={foldStation}
            setFoldStation={setFoldStation}
            engine={engine}
            core={core}
            usableCores={usableCores}
            setCoreSel={setCoreSel}
            ctx={ctx}
            stationTip={stationTip}
            onToast={onToast}
            feedShown={feedShown}
            feedTab={feedTab}
            setFeedTab={setFeedTab}
            setFeedSub={setFeedSub}
            feedSub={feedSub}
            feedKwRaw={feedKwRaw}
            setFeedKwRaw={setFeedKwRaw}
            feedTip={feedTip}
            feedShortOf={feedShortOf}
            manualNote={manualNote}
            startFeed={startFeed}
          /> : null}

        {/* ═══ 组装机：制造队列（左）＋ 蓝图书架（右）═══
            2026-09-30 三号接手：原先这里内嵌旧面板（`ManufacturingPanel`）⇒ 同一页两种视觉语言；
            现换成 HUD 版。**判据全部走 core 既有取数口**（`manufacturingRunViews` / `canStartBlueprint` /
            `missingMaterials` / `sortManuRows`），没有新口径。 */}
        {tab === 'craft' ? <HudManufacturing
            manuRuns={manuRuns}
            engine={engine}
            core={core}
            usableCores={usableCores}
            setCoreSel={setCoreSel}
            ctx={ctx}
            durText={durText}
            stopManu={stopManu}
            shelfKwRaw={shelfKwRaw}
            setShelfKwRaw={setShelfKwRaw}
            shelfFilterActive={shelfFilterActive}
            shelfShown={shelfShown}
            shelfRows={shelfRows}
            state={state}
            shelfKind={shelfKind}
            setShelfKind={setShelfKind}
            setShelfSub={setShelfSub}
            shelfSubOptions={shelfSubOptions}
            shelfSub={shelfSub}
            shelfLearned={shelfLearned}
            setShelfLearned={setShelfLearned}
            shelfReadyOnly={shelfReadyOnly}
            setShelfReadyOnly={setShelfReadyOnly}
            shelfCanStart={shelfCanStart}
            shelfTip={shelfTip}
            runningBlueprintIds={runningBlueprintIds}
            specOf={specOf}
            manuManualNote={manuManualNote}
            startManu={startManu}
          /> : null}

        {/* ═══ 造船厂：干船坞（左）＋ 可造舰船（右）═══ */}
        {tab === 'shipyard' ? <HudShipyard
            engine={engine}
            core={core}
            usableCores={usableCores}
            setCoreSel={setCoreSel}
            dockRuns={dockRuns}
            ctx={ctx}
            durText={durText}
            stopManu={stopManu}
            shipShown={shipShown}
            tierFilter={tierFilter}
            setTierFilter={setTierFilter}
            shipRows={shipRows}
            state={state}
            specOf={specOf}
            shelfTip={shelfTip}
            manuManualNote={manuManualNote}
            startManu={startManu}
          /> : null}

        {/* ═══ 实验室：分类配方目录 ＋ 投料 ＋ 运行 ═══ */}
        {tab === 'lab' && engine.labUnlocked() ? <HudLab
            labFilter={labFilter}
            setLabFilter={setLabFilter}
            recipes={recipes}
            ctx={ctx}
            state={state}
            recipe={recipe}
            labEff={labEff}
            setRecipeId={setRecipeId}
            labLoop={labLoop}
            labRuns={labRuns}
            labGoalDraft={labGoalDraft}
            typeDraft={typeDraft}
            clearDraft={clearDraft}
            commitLabLoop={commitLabLoop}
            engine={engine}
            core={core}
            usableCores={usableCores}
            setCoreSel={setCoreSel}
            lockTip={lockTip}
            manualNote={manualNote}
            onToast={onToast}
            onGotoMarket={onGotoMarket}
          /> : null}
      </div>
    </div>
  )
}
