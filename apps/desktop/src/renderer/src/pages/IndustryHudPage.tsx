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
import { useMemo, useState, type ReactNode } from 'react'
import {
  aiEfficiency,
  calcBuildDurationMs,
  canStartBlueprint,
  countAiCore,
  countWare,
  formatDurationShort,
  labAffordableBatches,
  labMaterialAvailable,
  matNeedCount,
  materialDisplayIdOf,
  materialGroupIdsOf,
  manufacturingRunViews,
  missingMaterials,
  oreAvailable,
  ownsBlueprint,
  recipeCapability,
  refineRate,
  sortManuRows,
  visibleItemDefs,
  type AiCoreType,
  type MaterialNeed,
} from '@whale/core'
import type { PageProps } from './common'
import type { GameEngine } from '../game/engine'
import { Glyph } from '../ui/Glyphs'
import { RowGlyph } from '../ui/itemView'
import { IconBtn, Readout } from '../ui/hud'
import { aiCoreText } from '../ui/labelsText'
import { marketPriceOf } from '../ui/yieldView'
import { ShipSprite } from '../ui/ShipSprite'
import { SHIP_TIER_SUBS, SUB_ALL } from '../ui/itemSubs'
import { bookPriceOf } from '../panels/Industry'
import { tr, cmdText, useL10n } from '../i18n/locale'
import '../ui/layout-css/_hud-industry.css'

type HudTab = 'refine' | 'craft' | 'shipyard' | 'lab'

/** 组装机书架的一行（只留 HUD 表要用的字段；判据全部走 core 既有取数口） */
interface HudShelfRow {
  id: string
  /** 图纸名 */
  name: string
  /** 产物显示名 */
  product: string
  /** 产物图标用的类别键（交给 `RowGlyph`） */
  glyph: string
  /** 一级分类：装备 / 消耗品（舰船归造船厂页签） */
  kind: 'equip' | 'consumable'
  /** core `sortManuRows` 认的口径键（内容层联合 key，渲染处不显示） */
  kindLabel: string
  /** core `sortManuRows` 认的产物唯一键（同产物的一次性图纸紧随原图纸） */
  productKey: string
  /** core `sortManuRows` 认的书价（市场目录基准价；0 = 沉底） */
  bookPrice: number
  /** 一次性图纸（书架里用一枚 chip 标出来） */
  singleUse: boolean
  materials: readonly MaterialNeed[]
  buildSeconds: number
}

/**
 * **材料齐备度**（0~1）——**与"能不能开工"同一把尺**（`matNeedCount` 折扣后需求 ·
 * 等价组按组内合计，口径同 core `missingMaterials`）。
 *
 * 取**逐项达标率的平均**（不是 Σ 现有 ÷ Σ 需求）：不同料的件数量级差很大，求和会让大件吃掉整个读数。
 * 技能口径（chart 域 Bullet）：「每个区间与目标都要有文字标注，颜色只是补充」⇒ 调用处必须把
 * 百分比与"缺哪几项"用文字给出（`title` 与可见读数同源）。
 */
function readinessOf(engine: GameEngine, materials: readonly MaterialNeed[]): { pct: number; short: string[] } {
  if (materials.length === 0) return { pct: 1, short: [] }
  let sum = 0
  const short: string[] = []
  for (const m of materials) {
    const need = matNeedCount(engine.state, m.count)
    const have = materialGroupIdsOf(m.itemId).reduce((s, id) => s + countWare(engine.state, id), 0)
    sum += Math.min(1, need > 0 ? have / need : 1)
    if (have < need) short.push(engine.ctx.items.get(materialDisplayIdOf(engine.state, m.itemId))?.name ?? m.itemId)
  }
  return { pct: sum / materials.length, short }
}

/** 一批料的**料值**（按当前行情价估；取不到行情退回物品基准价——与卡面行情同一把尺） */
function matsValueOf(engine: GameEngine, materials: readonly MaterialNeed[]): number {
  let v = 0
  for (const m of materials) {
    const price = marketPriceOf(engine.state, engine.ctx, m.itemId) ?? engine.ctx.items.get(m.itemId)?.baseSellPriceIsk ?? 0
    v += matNeedCount(engine.state, m.count) * price
  }
  return v
}

/** 页面入参：`onGotoMarket` 与工业页同款（透传 App 的「去市场」；缺省时市场按钮点了不动） */
export function IndustryHudPage({ engine, onToast, onGotoMarket }: PageProps & {
  onGotoMarket?: (goodKey: string) => void
}): ReactNode {
  const state = engine.state
  const ctx = engine.ctx
  const { locale } = useL10n()
  const [tab, setTab] = useState<HudTab>('refine')
  const [recipeId, setRecipeId] = useState<string | null>(null)
  /** 书架筛选（HUD 版只留两维：分类 ＋ 仅可造；完整三维筛选仍在现有工业页） */
  const [shelfKind, setShelfKind] = useState<'equip' | 'consumable' | typeof SUB_ALL>(SUB_ALL)
  const [shelfReadyOnly, setShelfReadyOnly] = useState(false)
  const [tierFilter, setTierFilter] = useState<string>(SUB_ALL)
  const [coreSel, setCoreSel] = useState<AiCoreType>(() => {
    const usable = (['alpha', 'beta', 'gamma', 'basic'] as AiCoreType[]).find((t) => countAiCore(state, t) > 0)
    return usable ?? 'basic'
  })
  const usableCores = (['basic', 'gamma', 'beta', 'alpha'] as AiCoreType[]).filter((t) => countAiCore(state, t) > 0)
  const core = usableCores.includes(coreSel) ? coreSel : (usableCores[0] ?? null)
  const runs = engine.refineRunViews()
  const labRuns = engine.labRunViews()
  const manuRuns = manufacturingRunViews(state, ctx)
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
  /**
   * **组装机书架**（模块 ＋ 物品蓝图；舰船归造船厂页签）——
   * 排序沿用 core 单点 `sortManuRows`（类型 → 书价升序 → 同产物的一次性图纸紧随原图纸），
   * 书价走渲染层既有的 `bookPriceOf`（与现有工业页同一把尺）。
   */
  const shelfRows: HudShelfRow[] = useMemo(() => {
    const rows: HudShelfRow[] = []
    for (const bp of ctx.blueprints.values()) {
      const mod = bp.moduleId !== undefined ? ctx.modules.get(bp.moduleId) : undefined
      const item = bp.itemId !== undefined ? ctx.items.get(bp.itemId) : undefined
      if (mod === undefined && item === undefined) continue
      rows.push({
        id: bp.id,
        name: bp.name,
        product: mod?.name ?? item?.name ?? bp.id,
        glyph: mod?.slot ?? item?.kind ?? 'blueprint',
        kind: mod !== undefined ? 'equip' : 'consumable',
        // l10n-keep：内容层联合 key（`sortManuRows` 的一级分类序认它，界面不显示这两个词）
        kindLabel: mod !== undefined ? '装备' : '消耗品',
        productKey: mod !== undefined ? `module:${mod.id}` : `item:${item?.id ?? bp.id}`,
        bookPrice: bookPriceOf(engine, bp.id, 0),
        singleUse: bp.singleUse === true,
        materials: bp.materials,
        buildSeconds: bp.buildSeconds,
      })
    }
    return sortManuRows(rows)
  }, [ctx, engine])
  /** 一份料的 BuildSpec（core 那几个纯函数认的形状；界面不自算口径） */
  const specOf = (materials: readonly MaterialNeed[], buildSeconds: number): {
    materials: readonly MaterialNeed[]
    buildSeconds: number
    buildCostIsk: number
  } => ({ materials, buildSeconds, buildCostIsk: 0 })
  /** 书架行"现在能不能开工"（与按钮/状态 chip 同一把尺：`canStartBlueprint` ＋ `missingMaterials`） */
  const shelfCanStart = (row: HudShelfRow): boolean =>
    canStartBlueprint(state, ctx, row.id) && missingMaterials(state, ctx, specOf(row.materials, row.buildSeconds)).length === 0
  const shelfShown = shelfRows.filter(
    (r) => (shelfKind === SUB_ALL || r.kind === shelfKind) && (!shelfReadyOnly || shelfCanStart(r)),
  )
  /**
   * **造船厂可造舰船**（`SHIP_TIER_SUBS` 是舰级的单点表；舰级判据与旧页同一张表）。
   */
  const shipRows = useMemo(
    () =>
      [...ctx.shipBlueprints.values()].map((sbp) => {
        const def = ctx.ships.get(sbp.shipId)
        return {
          id: sbp.id,
          name: def?.name ?? sbp.name,
          shipId: sbp.shipId,
          role: def?.role ?? 'industrial',
          tierKey: def !== undefined ? `t${def.tier}` : '',
          materials: sbp.materials,
          buildSeconds: sbp.buildSeconds,
        }
      }),
    [ctx],
  )
  const shipShown = shipRows.filter((r) => tierFilter === SUB_ALL || r.tierKey === tierFilter)
  /** 在船坞里的舰船线（`manufacturingRunViews` 里产物是舰船的那几条） */
  const dockRuns = manuRuns.filter((v) => v.kind === 'ship')
  const startManu = (blueprintId: string): void => {
    const worker: AiCoreType | 'pilot' = core ?? 'pilot'
    const r = engine.startManufacturingAt(blueprintId, worker)
    if (!r.ok) onToast(cmdText(r) || tr('ui.hud.021'), true)
  }
  const stopManu = (runId: number): void => {
    const r = engine.cancelManufacturingAt(runId)
    if (!r.ok) onToast(cmdText(r) || tr('ui.hud.021'), true)
  }
  const durText = (ms: number): string => formatDurationShort(ms, locale === 'en' ? 'en' : 'zh')
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
          <Readout glyph="ico-furnace" value={`${runs.length}/6`} title={tr('ui.hud.032')} />
          <Readout glyph="consumable" value={engine.jumpFuelStock().toLocaleString('zh-CN')} title={tr('ui.hud.033')} />
        </div>
      </div>

      <div className="hud-body" id={`hud-panel-${tab}`} role="tabpanel" aria-labelledby={`hud-tab-${tab}`}>
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

        {/* ═══ 组装机：制造队列（左）＋ 蓝图书架（右）═══
            2026-09-30 三号接手：原先这里内嵌旧面板（`ManufacturingPanel`）⇒ 同一页两种视觉语言；
            现换成 HUD 版。**判据全部走 core 既有取数口**（`manufacturingRunViews` / `canStartBlueprint` /
            `missingMaterials` / `sortManuRows`），没有新口径。 */}
        {tab === 'craft' ? (
          <div className="hud-grid two">
            <div className="hud-panel">
              <h3>
                <Glyph name="ico-assembler" size={13} color="currentColor" /> {tr('ui.hud.087')}
                <span className="hud-tiny" style={{ marginLeft: 8 }}>
                  <Readout glyph="ico-eff" value={String(manuRuns.length)} title={tr('ui.hud.114')} />
                </span>
              </h3>
              {manuRuns.length === 0 ? (
                <div className="hud-empty">{tr('ui.hud.095')}</div>
              ) : (
                manuRuns.map((v) => {
                  const bp = v.blueprintId !== null
                    ? (ctx.blueprints.get(v.blueprintId) ?? ctx.shipBlueprints.get(v.blueprintId))
                    : undefined
                  const mats = bp?.materials ?? []
                  const ready = readinessOf(engine, mats)
                  const readyPct = Math.round(ready.pct * 100)
                  return (
                    <div className="hud-card" key={v.id}>
                      <div className="hud-row between">
                        <span className="hud-row" style={{ gap: 7 }}>
                          <RowGlyph glyph={v.kind ?? 'item'} />
                          <span className="nm">{v.productName}</span>
                        </span>
                        <span className="hud-chip is-acc">{v.workerLabel}</span>
                      </div>
                      <div className="hud-row between" style={{ marginTop: 5 }}>
                        <span className="hud-tiny">{bp?.name ?? ''}</span>
                        <span className="hud-tiny">{durText(v.remainingMs)}</span>
                      </div>
                      <span className="hud-bar">
                        <i style={{ width: `${v.percent}%` }} />
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
              <h3>
                <Glyph name="blueprint" size={13} color="currentColor" /> {tr('ui.hud.088')}
                <span className="hud-tiny" style={{ marginLeft: 8 }}>{shelfShown.length}</span>
              </h3>
              <div className="hud-chips">
                <button
                  className={`hud-chip${shelfKind === SUB_ALL ? ' is-acc' : ''}`}
                  aria-pressed={shelfKind === SUB_ALL}
                  onClick={() => setShelfKind(SUB_ALL)}
                >
                  {tr('ui.hud.106')}
                </button>
                <button
                  className={`hud-chip${shelfKind === 'equip' ? ' is-acc' : ''}`}
                  aria-pressed={shelfKind === 'equip'}
                  onClick={() => setShelfKind('equip')}
                >
                  {tr('ui.hud.102')}
                </button>
                <button
                  className={`hud-chip${shelfKind === 'consumable' ? ' is-acc' : ''}`}
                  aria-pressed={shelfKind === 'consumable'}
                  onClick={() => setShelfKind('consumable')}
                >
                  {tr('ui.hud.103')}
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
                <table className="hud-table">
                  <thead>
                    <tr>
                      <th>{tr('ui.hud.089')}</th>
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
                        <tr key={r.id}>
                          <td>
                            <span className="hud-row" style={{ gap: 6 }}>
                              <RowGlyph glyph={r.glyph} />
                              <span>{r.product}</span>
                              {r.singleUse ? <span className="hud-chip is-warn">{tr('ui.hud.110')}</span> : null}
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
                              title={tr('ui.hud.112', { p1: core !== null ? aiCoreText(core) : tr('ui.hud.082') })}
                              disabled={!learned}
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
        ) : null}

        {/* ═══ 造船厂：干船坞（左）＋ 可造舰船（右）═══ */}
        {tab === 'shipyard' ? (
          <div className="hud-grid two">
            <div className="hud-panel">
              <h3>
                <Glyph name="ico-drydock" size={13} color="currentColor" /> {tr('ui.hud.097')}
              </h3>
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
                      <div className="hud-dock-art" aria-hidden="true">
                        {def !== undefined ? <ShipSprite shipId={def.id} role={def.role} size={132} /> : null}
                      </div>
                      <div className="hud-dock-info">
                        <div className="hud-row between">
                          <span className="nm">{def?.name ?? v.productName}</span>
                          <span className="hud-chip is-acc">{v.workerLabel}</span>
                        </div>
                        <span className="hud-bar lg">
                          <i style={{ width: `${v.percent}%` }} />
                        </span>
                        <div className="hud-cells">
                          <span title={tr('ui.hud.069')}>
                            <Glyph name="ico-feed" size={12} color="currentColor" /> {mats.length}
                          </span>
                          <span title={tr('ui.hud.105')}>
                            <Glyph name="ico-eff" size={12} color="currentColor" />{' '}
                            {(matsValueOf(engine, mats) / 1_000_000).toFixed(1)}M
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
                      <tr key={r.id}>
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
                            title={tr('ui.hud.112', { p1: core !== null ? aiCoreText(core) : tr('ui.hud.082') })}
                            disabled={!learned}
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
                  /* ⚠ **可点件必须是真按钮**（`ui-ux-pro-max` 预交付清单 · Compact Control Semantics · Critical：
                     「interactive chips need a native role accessible name state keyboard operation and visible
                     focus；Don't: Use a clickable div」）——2026-09-30 三号接手时由 `<div onClick>` 改过来。 */
                  <button
                    key={r.id}
                    type="button"
                    className={`hud-card${on ? ' is-sel' : ''}`}
                    aria-pressed={on}
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
                  </button>
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
