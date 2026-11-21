import { industryAvailable, RARE_WRECK_VOLUME_M3, recycleMineralPoolOf, recycleProfileOf, refineRate, visibleItemDefs, ITEM_KIND_LABELS, blueprintProducingItem } from '@whale/core'
import type { ItemDef } from '@whale/core'
import { Panel } from '@whale/ui'
import { useEffect, useState } from 'react'
import { BlueprintShelfPanel, ManufacturingPanel } from '../../panels/Industry'
import { ShipyardPanel } from '../../panels/Shipyard'
import { setSessionPick, sessionPick } from '../../ui/sessionView'
import '../../styles-unbox-ledger.css'
import { pinMarked } from '../../ui/marks'
import { AiSlotText } from '../../ui/aiSlots'
import { WRECK_SUBS, SUB_ALL, presentSubs, wreckTierOf, subText } from '../../ui/itemSubs'
import { useL10n } from '../../i18n/locale'
import { HintIcon } from '../../ui/Hint'
import type { PageProps } from '../../pages/common'
import { tr } from '../../i18n/locale'
import { ORE_KIND_LABEL, FURNACE_TABS } from './classicFilters'
import type { FurnaceTab, SubOpt } from './classicFilters'
import { IndPane } from './IndPane'
import { FurnaceCard } from './FurnaceCard'
import { LabPanel } from './LabPanel'

export function IndustryPage({ engine, onToast, onGotoMarket, onGotoMap, onGotoWormhole, onGotoPlugExchange, plugExchangeFocus, focusSec = null }: PageProps & {
  onGotoMarket?: (goodKey: string) => void
  onGotoMap?: (tab: 'mine' | 'salvage', ids: string[]) => void
  onGotoWormhole?: () => void
  onGotoPlugExchange?: () => void
  plugExchangeFocus?: number
  focusSec?: 'refine' | 'shelf' | 'craft' | 'shipyard' | 'lab' | null
}) {
  const state = engine.state
  const rate = refineRate(state, engine.ctx)

  const [sec, setSecState] = useState<'refine' | 'shelf' | 'craft' | 'shipyard' | 'lab'>(
    () => focusSec ?? ((sessionPick('industry.sec') as 'refine' | 'shelf' | 'craft' | 'shipyard' | 'lab' | null) ?? 'refine'),
  )
  const setSec = (v: 'refine' | 'shelf' | 'craft' | 'shipyard' | 'lab'): void => {
    setSecState(v)
    setSessionPick('industry.sec', v)
  }
  const [seenSec, setSeenSec] = useState<ReadonlySet<'refine' | 'shelf' | 'craft' | 'shipyard' | 'lab'>>(
    () => new Set(['refine', 'shelf', 'craft', 'shipyard', 'lab'].filter((k) => k === (focusSec ?? 'refine')) as Array<'refine' | 'shelf' | 'craft' | 'shipyard' | 'lab'>),
  )
  useEffect(() => {
    setSeenSec((s) => (s.has(sec) ? s : new Set(s).add(sec)))
  }, [sec])
  useEffect(() => {
    if (sec === 'lab') engine.noteLabOpened()
  }, [sec, engine])
  useL10n()
  const [furnaceTab, setFurnaceTabState] = useState<FurnaceTab>(() => {
    const v = sessionPick('industry.furnace.tab')
    return v === 'all' || v === 'ore' || v === 'wreck' || v === 'box' ? v : 'all'
  })
  const [sub, setSubState] = useState<string>(() => sessionPick('industry.furnace.sub') ?? SUB_ALL)
  const setFurnaceTab = (v: FurnaceTab): void => {
    setFurnaceTabState(v)
    setSessionPick('industry.furnace.tab', v)
  }
  const setSub = (v: string): void => {
    setSubState(v)
    setSessionPick('industry.furnace.sub', v)
  }
  const [fKw, setFKw] = useState('')
  const fq = fKw.trim().toLowerCase()
  const runViews = engine.refineRunViews()
  const [focusOreId, setFocusOreId] = useState<string | null>(null)
  const [craftFocus, setCraftFocus] = useState<string | null>(null)
  const [bookFocus, setBookFocus] = useState<string | null>(null)
  useEffect(() => {
    if (!focusOreId && !craftFocus && !bookFocus) return
    document.querySelector('.ind-pane:not(.is-off) .app-belt-card.is-goto')?.scrollIntoView({ block: 'center' })
    const t = window.setTimeout(() => {
      setFocusOreId(null)
      setCraftFocus(null)
      setBookFocus(null)
    }, 3500)
    return () => window.clearTimeout(t)
  }, [focusOreId, craftFocus, bookFocus])

  function handleNeedMineral(itemId: string): void {
    let src = ''
    for (const def of visibleItemDefs(engine.ctx)) {
      if (def.kind === 'wreck') continue
      if ((def.refine ?? []).some((r) => r.mineralId === itemId)) {
        src = def.id
        break
      }
    }
    if (src) {
      setSec('refine')
      setFurnaceTab('ore')
      setSub(SUB_ALL)
      setFocusOreId(src)
      return
    }
    const madeBy = blueprintProducingItem(engine.ctx, itemId)
    if (madeBy) {
      setSec('craft')
      setCraftFocus(madeBy.id)
      return
    }
    for (const g of engine.ctx.marketGoods.values()) {
      if (g.kind === 'item' && g.refId === itemId) {
        onGotoMarket?.(g.key)
        return
      }
    }
    onToast(tr("ui.IndustryPage.097", { p1: engine.ctx.items.get(itemId)?.name ?? itemId }), true)
  }

  const allItemDefs = visibleItemDefs(engine.ctx)
  const oreDefs = allItemDefs.filter(
    (def) => def.kind !== 'wreck' && def.refine !== undefined && def.refine.length > 0,
  )
  const wreckDefs = allItemDefs.filter(
    (def) =>
      def.kind === 'wreck' &&
      (industryAvailable(state, engine.ctx, def.id, 'pilot') > 0 || industryAvailable(state, engine.ctx, def.id) > 0 || runViews.some((v) => v.itemId === def.id)),
  )

  const boxDefs = [...engine.ctx.items.values()].filter(
    (def) =>
      def.kind === 'container' &&
      (industryAvailable(state, engine.ctx, def.id, 'pilot') > 0 || industryAvailable(state, engine.ctx, def.id) > 0 || runViews.some((v) => v.itemId === def.id) || engine.unboxLedgerOf(def.id) !== undefined),
  )
  const runningCount = runViews.length

  const oreSubs: SubOpt[] = Object.keys(ORE_KIND_LABEL)
    .filter((k) => oreDefs.some((d) => d.kind === k))
    .map((k) => ({ key: k, label: ORE_KIND_LABEL[k]! }))
  const subOptions: SubOpt[] =
    furnaceTab === 'ore'
      ? oreSubs
      : furnaceTab === 'wreck'
        ? presentSubs(WRECK_SUBS, (key) =>
            wreckDefs.some((d) => (key === 'rare' ? wreckTierOf(d.id) === 'rare' : wreckTierOf(d.id) !== 'rare')),
          )
        : []
  const subMissing = sub !== SUB_ALL && !subOptions.some((s) => s.key === sub)
  useEffect(() => {
    if (subMissing) setSub(SUB_ALL)
  }, [subMissing])
  const fHit = (def: ItemDef): boolean => {
    if (fq.length === 0) return true
    if (def.name.toLowerCase().includes(fq)) return true
    if ((def.description ?? '').toLowerCase().includes(fq)) return true
    if ((ITEM_KIND_LABELS[def.kind] ?? '').toLowerCase().includes(fq)) return true
    const outs: string[] = (def.refine ?? []).map((r) => engine.ctx.items.get(r.mineralId)?.name ?? r.mineralId)
    const prof = def.kind === 'wreck' ? recycleProfileOf(engine.ctx, def.id) : null
    if (prof) for (const [mineralId] of recycleMineralPoolOf(prof)) outs.push(engine.ctx.items.get(mineralId)?.name ?? mineralId)
    return outs.some((n) => n.toLowerCase().includes(fq))
  }
  const oreFiltered = sub === SUB_ALL ? oreDefs : oreDefs.filter((d) => d.kind === sub)
  const wreckFiltered =
    sub === 'rare'
      ? wreckDefs.filter((d) => wreckTierOf(d.id) === 'rare')
      : sub === 'common'
        ? wreckDefs.filter((d) => wreckTierOf(d.id) !== 'rare')
        : wreckDefs
  const oreShownF = pinMarked(state, 'recipes', oreFiltered.filter(fHit), (def) => def.id)
  const wreckShownF = pinMarked(state, 'recipes', wreckFiltered.filter(fHit), (def) => def.id)
  const boxShownF = boxDefs.filter(fHit)
  const showOre = furnaceTab === 'all' || furnaceTab === 'ore'
  const showWreck = furnaceTab === 'all' || furnaceTab === 'wreck'
  const showBox = furnaceTab === 'all' || furnaceTab === 'box'
  const shownCount =
    (showOre ? oreShownF.length : 0) + (showWreck ? wreckShownF.length : 0) + (showBox ? boxShownF.length : 0)
  const totalCount = oreDefs.length + wreckDefs.length + boxDefs.length

  return (
    <div className="page-stack page-fill app-industry-page">
      {/* 功能标签页（与星图页同款 app-subtabs 规范）：精炼炉 / 蓝图书架 / 组装机 */}
      <div className="app-subtabs" role="tablist">
        <button
          role="tab"
          aria-selected={sec === 'refine'}
          className={`app-subtab${sec === 'refine' ? ' is-active' : ''}`}
          onClick={() => setSec('refine')}
        >
          <span>♨</span>
          <span>{tr("ui.ShipPage.097")}</span>
        </button>
        <button
          role="tab"
          aria-selected={sec === 'craft'}
          className={`app-subtab${sec === 'craft' ? ' is-active' : ''}`}
          onClick={() => setSec('craft')}
        >
          <span>⚒</span>
          <span>{tr("ui.IndustryPage.059")}</span>
        </button>
        <button
          role="tab"
          aria-selected={sec === 'shipyard'}
          className={`app-subtab${sec === 'shipyard' ? ' is-active' : ''}`}
          onClick={() => setSec('shipyard')}
        >
          <span>⚓</span>
          <span>{tr("ui.IndustryPage.110")}</span>
        </button>
        {/* **实验室**（**2026-09-29 船长令**）：**门槛后才出现**（首座空间站建成 ⇒ `labUnlocked`）——
            不是灰掉，是不渲染（船长口径：门槛前"看不到相关内容"）。
            ⚠ **2026-10-01 船长令**：「将实验室的子页面标签移动到蓝图书架前面」⇒ 本块整体上移到
            蓝图书架之前（顺序：精炼炉 → 组装机 → 造船厂 → **实验室** → 蓝图书架）。 */}
        {engine.labUnlocked() ? (
          <button
            role="tab"
            aria-selected={sec === 'lab'}
            className={`app-subtab${sec === 'lab' ? ' is-active' : ''}`}
            onClick={() => setSec('lab')}
          >
            <span>⚗</span>
            <span>{tr("ui.lab.001")}</span>
          </button>
        ) : null}
        <button
          role="tab"
          aria-selected={sec === 'shelf'}
          className={`app-subtab${sec === 'shelf' ? ' is-active' : ''}`}
          onClick={() => setSec('shelf')}
        >
          <span>▦</span>
          <span>{tr("ui.IndustryPage.060")}</span>
        </button>
      </div>

      {/* ═══ 四个子页**保活**（2026-09-22 工业页卡顿修复第 2 步）═══
          原先这里是 `sec === 'craft' ? … : sec === 'shipyard' ? …` 的三元链：同一时刻只挂载一个子页，
          ⇒ 每次切换 = 旧面板整棵卸载 + 新面板从零重建（实测组装机 151 张卡 8298 节点：1× 花 75 ms、
          弱机档 700 ms，"数秒的卡顿"正是它）。现在改成**首次进入才挂载、之后常驻**，切换只切显示：
          `.ind-pane` 用 `display: contents`（面板照旧直接参与 `.page-stack` 的 flex 布局，不引入多余盒子），
          隐藏时 `display: none`（不占位、不参与布局与绘制）。
          ⚠ 与第 3 步配套：面板常驻后每次心跳仍会重渲染 ⇒ 靠卡片的实时指纹 `memo` 兜住，否则代价 ×4。
          ⚠ 行为变化（已报船长）：面板内部的筛选/搜索/滚动位置**不再因切换而复位**。 */}
      {seenSec.has('craft') ? (
        <IndPane scrollKey="industry.craft.scroll" off={sec !== 'craft'}>
          <ManufacturingPanel
            engine={engine}
            onToast={onToast}
            onNeedMineral={handleNeedMineral}
            onGotoMarket={onGotoMarket}
            onGotoWormhole={onGotoWormhole}
            onGotoPlugExchange={onGotoPlugExchange}
            /**
             * **组装机 → 蓝图书架的反向入口**（**2026-09-26 船长令**：优化工业界面 → 优3）：
             * 与书架→组装机**同一套手法**（切子页 ＋ 定位高亮），只是方向反过来。
             */
            onGotoShelf={(bpId) => {
              setSec('shelf')
              setBookFocus(bpId)
            }}
            plugExchangeFocus={plugExchangeFocus}
            focusBlueprintId={craftFocus}
          />
        </IndPane>
      ) : null}
      {seenSec.has('shipyard') ? (
        <IndPane scrollKey="industry.shipyard.scroll" off={sec !== 'shipyard'}>
          <ShipyardPanel
            engine={engine}
            onToast={onToast}
            onNeedMineral={handleNeedMineral}
            onGotoMarket={onGotoMarket}
            onGotoWormhole={onGotoWormhole}
            focusBlueprintId={craftFocus}
          />
        </IndPane>
      ) : null}
      {seenSec.has('shelf') ? (
        <IndPane scrollKey="industry.shelf.scroll" off={sec !== 'shelf'}>
          <BlueprintShelfPanel
            engine={engine}
            onToast={onToast}
            onGotoMarket={onGotoMarket}
            focusBookId={bookFocus}
            onGotoCraft={(bpId) => {
              // 2026-09-20 零件体系：舰船书跳造船厂、其余书跳组装机；切栏 + 定位高亮那张卡
              setSec(engine.ctx.shipBlueprints.has(bpId) ? 'shipyard' : 'craft')
              setCraftFocus(bpId)
            }}
          />
        </IndPane>
      ) : null}
      {seenSec.has('refine') ? (
      <IndPane scrollKey="industry.refine.scroll" off={sec !== 'refine'}>
        <Panel
          className="is-fill win-fixed-body"
          title={tr("ui.ShipPage.097")}
          hint={
            <HintIcon
              tip={tr("ui.IndustryPage.098", { RARE_WRECK_VOLUME_M3: RARE_WRECK_VOLUME_M3 })}
            />
          }
          right={
            <>
              {/* 搜索栏（船长 2026-09-19）：与物品页/货仓/技能/舰船页/手册同款（标题行右侧） */}
              <span className="app-head-search-wrap">
                <input
                  className="app-head-search"
                  type="text"
                  placeholder={tr('ui.IndustryPage.111')}
                  value={fKw}
                  onChange={(e) => setFKw(e.target.value)}
                  spellCheck={false}
                />
              </span>
              <span
                className="app-dim"
                title={tr("ui.IndustryPage.061")}
              >
                {tr("ui.IndustryPage.062")} {Math.round(rate * 100)}{tr('ui.IndustryPage.102', { n: runningCount })} {tr("ui.IndustryPage.063")} {oreDefs.length}{tr('ui.IndustryPage.103', { n: wreckDefs.length })}
                {boxDefs.length > 0 ? tr("ui.IndustryPage.099", { p1: boxDefs.length }) : ''}
                {/* 搜索/筛选生效时补读数（与组装机同款：免得玩家对着收窄后的网格数不清） */}
                {fq.length > 0
                  ? tr('ui.IndustryPage.108', { n: shownCount })
                  : shownCount !== totalCount
                    ? tr("ui.IndustryPage.100", { shownCount: shownCount })
                    : ''}
              </span>
              <AiSlotText state={state} ctx={engine.ctx} />
            </>
          }
        >
          {/* 筛选固定、说明进标题后的圆形感叹号（固定头 + 下滚）：一级标签行 / 二级子筛选行常驻，
              卡网格独立内滚 —— 与组装机逐项同款（`.app-task-tabs` + `.app-tasktab`，二级行去下边框） */}
          <div className="app-task-tabs" role="tablist">
            {FURNACE_TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={furnaceTab === t.key}
                className={`app-tasktab${furnaceTab === t.key ? ' is-active' : ''}`}
                onClick={() => {
                  setFurnaceTab(t.key)
                  setSub(SUB_ALL) // 换一级标签即回「全部子类」（与组装机、市场页 changeKind 同款）
                }}
              >
                {subText(t)}
              </button>
            ))}
          </div>
          {subOptions.length > 0 ? (
            <div className="app-task-tabs app-fleet-tabs" role="tablist">
              <button
                role="tab"
                aria-selected={sub === SUB_ALL}
                className={`app-tasktab${sub === SUB_ALL ? ' is-active' : ''}`}
                onClick={() => setSub(SUB_ALL)}
              >
                {tr("ui.IndustryPage.064")}
              </button>
              {subOptions.map((s) => (
                <button
                  key={s.key}
                  role="tab"
                  aria-selected={sub === s.key}
                  className={`app-tasktab${sub === s.key ? ' is-active' : ''}`}
                  onClick={() => setSub(s.key)}
                >
                  {subText(s)}
                </button>
              ))}
            </div>
          ) : null}
          <div className="app-win-body">
          {totalCount === 0 ? (
            <div className="app-dim app-inv-empty">
              {tr("ui.IndustryPage.065")}
            </div>
          ) : null}
          {shownCount === 0 && totalCount > 0 ? (
            <div className="app-dim app-exp-idle">{tr("ui.IndustryPage.066")}</div>
          ) : null}

          {showOre && oreShownF.length > 0 ? (
            <div className="app-belt-grid">
              {oreShownF.map((def) => (
                <FurnaceCard key={def.id} def={def} engine={engine} onToast={onToast} highlight={focusOreId === def.id} onGotoMap={onGotoMap} />
              ))}
            </div>
          ) : null}

          {showWreck && wreckShownF.length > 0 ? (
            <div className="app-belt-grid">
              {wreckShownF.map((def) => (
                <FurnaceCard key={def.id} def={def} engine={engine} onToast={onToast} onGotoMap={onGotoMap} />
              ))}
            </div>
          ) : null}

          {showBox && boxShownF.length > 0 ? (
            <div className="app-belt-grid">
              {boxShownF.map((def) => (
                <FurnaceCard key={def.id} def={def} engine={engine} onToast={onToast} onGotoMap={onGotoMap} />
              ))}
            </div>
          ) : null}
          {showBox && boxShownF.length === 0 ? (
            <div className="app-dim app-exp-idle">
              {fq.length > 0
                ? tr('ui.IndustryPage.109')
                : tr("ui.IndustryPage.067")}
            </div>
          ) : null}
          </div>
        </Panel>
      </IndPane>
      ) : null}
      {/* 实验室（**2026-09-29 船长令**）：与其余四页同一套保活手法（`IndPane` + 会话滚动记忆） */}
      {engine.labUnlocked() && seenSec.has('lab') ? (
        <IndPane scrollKey="industry.lab.scroll" off={sec !== 'lab'}>
          <LabPanel
            engine={engine}
            onToast={onToast}
            onGotoMarket={onGotoMarket}
            onNeedMaterial={handleNeedMineral}
            onGotoPlugExchange={onGotoPlugExchange}
          />
        </IndPane>
      ) : null}
    </div>
  )
}
