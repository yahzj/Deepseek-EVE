import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { type LabFilter } from '../../ui/LabRecipeFilters'
import { aiCoreCap, canStartBlueprint, formatDurationShort, industryAiBonus, bestAiCoreOf, usableAiCoresOf, labRecipeUnlocked, labTechRequirementOf, manufacturingRunViews, missingMaterials, manualSlotOf, industryAvailable, stationActivityStartBlockReason, ownsBlueprint, recycleBatchM3Of, recycleMineralPoolOf, recycleProfileOf, refineBaseParamsOf, refineBatchOutputOf, refineRate, refineRateMax, sortManuRows, UNBOX_CYCLE_MS, visibleItemDefs, type AiCoreType, type MaterialNeed } from '@whale/core'
import type { PageProps } from '../../pages/common'
import { itemGlyphName } from '../../ui/Glyphs'
import { HudHoverCard, type HudIoLine } from '../../ui/hud'
import { useLoopGoalDraft } from '../../ui/useLoopGoalDraft'
import { aiCoreText } from '../../ui/labelsText'
import { marketPriceOf } from '../../ui/yieldView'
import { SUB_ALL, bpFilterKeysOf, manuSubsOf, presentSubs, wreckTierOf } from '../../ui/itemSubs'
import { bookPriceOf } from './blueprintValue'
import { tr, cmdText, useL10n } from '../../i18n/locale'
import type { HudTab, HudShelfKind, FeedTab, HudShelfRow } from './hudTypes'
import { matRowsOf, readinessOf } from './hudMaterials'
import { manufacturingBlueprintVisible } from './blueprintPolicy'

export function useIndustryHud({ engine, onToast, onGotoMarket }: PageProps & {
  onGotoMarket?: (goodKey: string) => void
}) {
  const state = engine.state
  const ctx = engine.ctx
  const { locale } = useL10n()
  const [tab, setTab] = useState<HudTab>('refine')
  const { draft: labGoalDraft, typeDraft, clearDraft, clearTouched } = useLoopGoalDraft((n) => {
    if (recipe === null) return
    engine.setLabLoopAt(recipe.id, true, n)
  })
  useEffect(() => {
    if (tab === 'lab') engine.noteLabOpened()
  }, [tab, engine])
  const [recipeId, setRecipeId] = useState<string | null>(null)
  const [shelfKind, setShelfKind] = useState<HudShelfKind>(SUB_ALL)
  const [shelfSub, setShelfSub] = useState<string>(SUB_ALL)
  const [shelfLearned, setShelfLearned] = useState<string>(SUB_ALL)
  const [shelfKwRaw, setShelfKwRaw] = useState('')
  const shelfKw = shelfKwRaw.trim().toLowerCase()
  const [shelfReadyOnly, setShelfReadyOnly] = useState(false)
  const [tierFilter, setTierFilter] = useState<string>(SUB_ALL)
  const [feedTab, setFeedTab] = useState<FeedTab>('all')
  const [feedSub, setFeedSub] = useState<string>(SUB_ALL)
  const [feedKwRaw, setFeedKwRaw] = useState('')
  const feedKw = feedKwRaw.trim().toLowerCase()
  const [foldStation, setFoldStation] = useState(false)
  const [coreSel, setCoreSel] = useState<AiCoreType>(() => bestAiCoreOf(state) ?? 'basic')
  const usableCores = usableAiCoresOf(state)
  const core = usableCores.includes(coreSel) ? coreSel : (usableCores[0] ?? null)
  const runs = engine.refineRunViews()
  const labRuns = engine.labRunViews()
  const manuRuns = manufacturingRunViews(state, ctx)

  const runningBlueprintIds = new Set(
    manuRuns.map((v) => v.blueprintId).filter((id): id is string => id !== null),
  )
  const [labFilter, setLabFilter] = useState<LabFilter>('all')
  const allRecipes = [...ctx.labRecipes.values()]
  const recipes = allRecipes.filter(r => labFilter === 'all' || r.category === labFilter)
  const recipe = allRecipes.find((r) => r.id === recipeId) ?? allRecipes[0] ?? null
  const lockTip = recipe !== null && !labRecipeUnlocked(state, ctx, recipe)
    ? tr('ui.lab.025', { p1: labTechRequirementOf(ctx, recipe) ?? recipe.name })
    : null
  const labLoop = engine.labLoopOf(recipe !== null ? recipe.id : null)
  const commitLabLoop = (on: boolean, goalText: string): void => {
    clearTouched()
    if (recipe === null) return
    const n = Number.parseInt(goalText, 10)
    const r = engine.setLabLoopAt(recipe.id, on, on ? (Number.isFinite(n) && n > 0 ? n : null) : null)
    if (!r.ok) onToast(cmdText(r) || tr('ui.hud.021'), true)
  }
  const rate = refineRate(state, ctx)
  const tabs: Array<{ k: HudTab; g: string; label: string; title: string }> = [
    { k: 'refine', g: 'ico-furnace', label: tr('ui.hud.001'), title: tr('ui.hud.011') },
    { k: 'craft', g: 'ico-assembler', label: tr('ui.hud.002'), title: tr('ui.hud.012') },
    { k: 'shipyard', g: 'ico-drydock', label: tr('ui.hud.003'), title: tr('ui.hud.013') },
    ...(engine.labUnlocked()
      ? [{ k: 'lab' as HudTab, g: 'ico-lab', label: tr('ui.hud.004'), title: tr('ui.hud.014') }]
      : []),
  ]
  const manualBlock = stationActivityStartBlockReason(state, ctx, tab === 'lab' ? 'lab' : tab === 'craft' || tab === 'shipyard' ? 'manufacturing' : 'refine')
  const manualNote = manualSlotOf(state) !== null ? tr('ui.hud.212') : manualBlock ? cmdText(manualBlock) : null
  const shelfRows: HudShelfRow[] = useMemo(() => {
    const rows: HudShelfRow[] = []
    for (const bp of ctx.blueprints.values()) {
      if (bp.unreleased) continue
      const mod = bp.moduleId !== undefined ? ctx.modules.get(bp.moduleId) : undefined
      const item = bp.itemId !== undefined ? ctx.items.get(bp.itemId) : undefined
      if (mod === undefined && item === undefined) continue
      rows.push({
        id: bp.id,
        name: bp.name,
        product: mod?.name ?? item?.name ?? bp.id,
        glyph: mod?.slot ?? item?.kind ?? 'blueprint',
        kindLabel: mod !== undefined ? '装备' : '消耗品',
        keys: bpFilterKeysOf(ctx, bp.id),
        productKey: mod !== undefined ? `module:${mod.id}` : `item:${item?.id ?? bp.id}`,
        bookPrice: bookPriceOf(engine, bp.id, 0),
        singleUse: bp.singleUse === true,
        materials: bp.materials,
        buildSeconds: bp.buildSeconds,
      })
    }
    return sortManuRows<HudShelfRow>(rows)
  }, [ctx, engine])
  const specOf = (materials: readonly MaterialNeed[], buildSeconds: number): {
    materials: readonly MaterialNeed[]
    buildSeconds: number
    buildCostIsk: number
  } => ({ materials, buildSeconds, buildCostIsk: 0 })
  const shelfCanStart = (row: HudShelfRow): boolean =>
    canStartBlueprint(state, ctx, row.id) && missingMaterials(state, ctx, specOf(row.materials, row.buildSeconds)).length === 0
  const shelfLearnedOf = (row: HudShelfRow): boolean =>
    ownsBlueprint(state, row.id) || ctx.blueprints.get(row.id)?.learnless === true
  const availableShelfRows = shelfRows.filter(row => manufacturingBlueprintVisible(state, ctx, row.id))
  const shelfSubOptions = presentSubs(shelfKind === SUB_ALL ? [] : manuSubsOf(shelfKind), (key) =>
    availableShelfRows.some((r) => r.keys.tab === shelfKind && r.keys.subKey === key),
  )
  const shelfShown = availableShelfRows.filter((r) => {
    if (shelfKind !== SUB_ALL && r.keys.tab !== shelfKind) return false
    if (shelfSub !== SUB_ALL && r.keys.subKey !== shelfSub) return false
    if (shelfLearned !== SUB_ALL && shelfLearnedOf(r) !== (shelfLearned === 'learned')) return false
    if (shelfReadyOnly && !shelfCanStart(r)) return false
    if (shelfKw !== '' && !`${r.product} ${r.name}`.toLowerCase().includes(shelfKw)) return false
    return true
  })
  const shelfFilterActive =
    shelfKind !== SUB_ALL || shelfSub !== SUB_ALL || shelfLearned !== SUB_ALL || shelfReadyOnly || shelfKw !== ''
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
  const dockRuns = manuRuns.filter((v) => v.kind === 'ship')
  const startManu = (blueprintId: string): void => {
    const worker: AiCoreType | 'pilot' = core ?? 'pilot'
    const r = engine.startManufacturingAt(blueprintId, worker)
    if (!r.ok) onToast(cmdText(r) || tr('ui.hud.021'), true)
  }
  const manuManualNote = core === null ? manualNote : null
  const stopManu = (runId: number): void => {
    const r = engine.cancelManufacturingAt(runId)
    if (!r.ok) onToast(cmdText(r) || tr('ui.hud.021'), true)
  }
  const durText = (ms: number): string => formatDurationShort(ms, locale === 'en' ? 'en' : 'zh')

  const labEff = (() => {
    const perMinute = (r: { outputUnits: number; cycleMs: number }): number =>
      r.outputUnits / Math.max(0.001, r.cycleMs / 60_000)
    const groups = new Map<string, number[]>()
    for (const r of allRecipes) {
      const arr = groups.get(r.outputItemId) ?? []
      arr.push(perMinute(r))
      groups.set(r.outputItemId, arr)
    }
    return { perMinute, groups }
  })()

  const stationCap = aiCoreCap(state, ctx) + industryAiBonus(state, ctx)
  const rateBase = ctx.balance.refining.baseRate
  const rateMax = refineRateMax(ctx)
  const ratePos = rateMax > rateBase ? Math.min(1, Math.max(0, (rate - rateBase) / (rateMax - rateBase))) : 1

  const production = (() => {
    const byItem = new Map<string, { itemId: string; furnaces: number; orePerHour: number; iskPerHour: number; minerals: Map<string, number> }>()
    for (const v of runs) {
      if (v.recipe !== 'refine' || v.itemId === null) continue
      const perHour = (v.batchUnits * 3_600_000) / Math.max(1, v.cycleMs)
      const price = marketPriceOf(state, ctx, v.itemId) ?? ctx.items.get(v.itemId)?.baseSellPriceIsk ?? 0
      const cur = byItem.get(v.itemId) ?? { itemId: v.itemId, furnaces: 0, orePerHour: 0, iskPerHour: 0, minerals: new Map<string, number>() }
      cur.furnaces += 1
      cur.orePerHour += perHour
      cur.iskPerHour += perHour * price
      const def = ctx.items.get(v.itemId)
      if (def !== undefined) {
        for (const row of refineBatchOutputOf(state, ctx, def, v.batchUnits)) {
          const perH = (row.units * 3_600_000) / Math.max(1, v.cycleMs)
          cur.minerals.set(row.mineralId, (cur.minerals.get(row.mineralId) ?? 0) + perH)
        }
      }
      byItem.set(v.itemId, cur)
    }
    const all = [...byItem.values()].sort((a, b) => b.iskPerHour - a.iskPerHour)
    const total = all.reduce((s, r) => s + r.iskPerHour, 0)
    const top = all.slice(0, 5)
    const rest = all.slice(5)
    const restIsk = rest.reduce((s, r) => s + r.iskPerHour, 0)
    return { rows: all, total, top, rest, restIsk, restCount: rest.length }
  })()
  const ringSegments = [
    ...production.top.map((r) => ({
      key: r.itemId,
      label: ctx.items.get(r.itemId)?.name ?? r.itemId,
      isk: r.iskPerHour,
      detail: tr('ui.hud.123', {
        p1: r.furnaces,
        p2: Math.round(r.orePerHour).toLocaleString('zh-CN'),
        p3: Math.round(r.iskPerHour).toLocaleString('zh-CN'),
      }),
    })),
    ...(production.restCount > 0
      ? [
          {
            key: '__rest__',
            label: tr('ui.hud.137'),
            isk: production.restIsk,
            detail: tr('ui.hud.124', { p1: production.restCount }),
          },
        ]
      : []),
  ]
  const feedDefs = visibleItemDefs(ctx)
    .filter((d) => (d.refine?.length ?? 0) > 0 || d.kind === 'wreck' || d.kind === 'container')
    .map((def) => ({ def, have: industryAvailable(state, ctx, def.id, 'pilot'), aiHave: industryAvailable(state, ctx, def.id) }))
  const feedFamilyOf = (kind: string): FeedTab => (kind === 'wreck' ? 'wreck' : kind === 'container' ? 'box' : 'ore')
  const feedShown = feedDefs
    .filter(({ def }) => feedTab === 'all' || feedFamilyOf(def.kind) === feedTab)
    .filter(({ def }) => {
      if (feedSub === SUB_ALL) return true
      if (feedTab === 'wreck') return wreckTierOf(def.id) === feedSub
      return def.kind === feedSub
    })
    .filter(({ def }) => {
      if (feedKw.length === 0) return true
      const hay = `${def.name} ${def.description ?? ''}`.toLowerCase()
      return hay.includes(feedKw)
    })
    .sort((a, b) => b.have - a.have || a.def.name.localeCompare(b.def.name, 'zh-Hans-CN'))
  const startFeed = (def: (typeof feedDefs)[number]['def'], worker: AiCoreType | 'pilot'): void => {
    const r =
      def.kind === 'container'
        ? engine.startUnboxRunAt(def.id, worker)
        : def.kind === 'wreck'
          ? engine.startRecycleRunAt(def.id, worker)
          : engine.startRefineRunAt(def.id, worker)
    if (!r.ok) onToast(cmdText(r) || tr('ui.hud.021'), true)
  }
  const stationTip = (v: (typeof runs)[number]): ReactNode => {
    const def = v.itemId !== null ? ctx.items.get(v.itemId) : undefined
    const outs = def !== undefined ? refineBatchOutputOf(state, ctx, def, v.batchUnits) : []
    const have = v.itemId !== null ? industryAvailable(state, ctx, v.itemId) : 0
    return (
      <HudHoverCard
        title={`${tr('ui.hud.143', { p1: String(v.id).padStart(2, '0') })} · ${v.itemName} · ${
          v.worker === 'pilot' ? tr('ui.hud.082') : aiCoreText(v.worker)
        }`}
        input={[
          { glyph: itemGlyphName(def?.id, def?.kind ?? 'item'), name: def?.name ?? v.itemName },
          { name: tr('ui.hud.117', { p1: v.batchUnits.toLocaleString('zh-CN') }) },
          { name: tr('ui.hud.118', { p1: Math.floor(have).toLocaleString('zh-CN') }) },
          { name: tr('ui.hud.119', { p1: Math.round(v.cycleMs / 100) / 10 }) },
        ]}
        output={outs.map((o) => ({
          glyph: 'mineral',
          name: ctx.items.get(o.mineralId)?.name ?? o.mineralId,
          qty: `×${o.units.toLocaleString('zh-CN')}`,
        }))}
        note={tr('ui.hud.125', { p1: Math.round(v.percent) })}
      />
    )
  }

  const feedBatchOf = (def: (typeof feedDefs)[number]['def']): { per: number; unit: string } => {
    if (def.kind === 'wreck') return { per: recycleBatchM3Of(def.id), unit: ' m³' }
    if (def.kind === 'container') return { per: 1, unit: '' }
    return { per: refineBaseParamsOf(def).batchUnits, unit: '' }
  }
  const feedShortOf = (def: (typeof feedDefs)[number]['def'], have: number): string | null => {
    const { per, unit } = feedBatchOf(def)
    if (have >= per) return null
    return tr('ui.hud.150', { p1: `${Math.ceil(per - have).toLocaleString('zh-CN')}${unit}` })
  }
  const feedTip = (def: (typeof feedDefs)[number]['def'], have: number): ReactNode => {
    const isWreck = def.kind === 'wreck'
    const isBox = def.kind === 'container'
    const base = refineBaseParamsOf(def)
    const batchM3 = isWreck ? recycleBatchM3Of(def.id) : 0
    const wreckPool = isWreck ? recycleProfileOf(ctx, def.id) : null
    const outs = !isWreck && !isBox ? refineBatchOutputOf(state, ctx, def, base.batchUnits) : []
    const input: HudIoLine[] = [{ glyph: itemGlyphName(def.id, def.kind), name: def.name, ok: feedShortOf(def, have) === null, short: feedShortOf(def, have) ?? undefined }]
    if (isWreck) {
      input.push({ name: tr('ui.hud.145', { p1: batchM3 }) })
      input.push({ name: tr('ui.hud.144', { p1: Math.floor(have).toLocaleString('zh-CN') }) })
    } else if (isBox) {
      input.push({ name: tr('ui.hud.117', { p1: 1 }) })
      input.push({ name: tr('ui.hud.118', { p1: Math.floor(have).toLocaleString('zh-CN') }) })
      input.push({ name: tr('ui.hud.119', { p1: Math.round(UNBOX_CYCLE_MS / 1000) }) })
    } else {
      input.push({ name: tr('ui.hud.117', { p1: base.batchUnits.toLocaleString('zh-CN') }) })
      input.push({ name: tr('ui.hud.118', { p1: Math.floor(have).toLocaleString('zh-CN') }) })
      input.push({ name: tr('ui.hud.119', { p1: Math.round(base.cycleMs / 100) / 10 }) })
    }
    const output: HudIoLine[] = outs.map((o) => ({
      glyph: 'mineral',
      name: ctx.items.get(o.mineralId)?.name ?? o.mineralId,
      qty: `×${o.units.toLocaleString('zh-CN')}`,
    }))
    if (isWreck) {
      const pool = wreckPool !== null ? recycleMineralPoolOf(wreckPool) : []
      output.push({ name: `${tr('ui.hud.146')}：` })
      for (const [mineralId] of pool) {
        output.push({ glyph: 'mineral', name: ctx.items.get(mineralId)?.name ?? mineralId })
      }
    }
    return (
      <HudHoverCard
        title={def.name}
        input={input}
        output={output}
        emptyOutput={isBox ? def.description : undefined}
      />
    )
  }

  const shelfTip = (row: { product: string; glyph: string; materials: readonly MaterialNeed[] }): ReactNode => {
    const rows = matRowsOf(engine, row.materials, 'id' in row ? String(row.id) : undefined)
    const ready = readinessOf(engine, row.materials, 'id' in row ? String(row.id) : undefined)
    const input: HudIoLine[] = []
    for (const m of rows) {
      input.push({
        glyph: m.glyph,
        name: m.name,
        qty: `×${m.need.toLocaleString('zh-CN')}`,
        ok: m.ok,
        short: m.ok ? undefined : tr('ui.hud.150', { p1: (m.need - m.have).toLocaleString('zh-CN') }),
      })
      input.push({ name: tr('ui.hud.118', { p1: m.have.toLocaleString('zh-CN') }) })
    }
    return (
      <HudHoverCard
        title={row.product}
        input={input}
        output={[{ glyph: row.glyph, name: row.product }]}
        note={
          ready.short.length === 0
            ? `${tr('ui.hud.104')} ${Math.round(ready.pct * 100)}%`
            : tr('ui.hud.111', { p1: Math.round(ready.pct * 100), p2: ready.short.join(tr('ui.MatterTechTab.017')) })
        }
      />
    )
  }
  return {
    tabs,
    tab,
    setTab,
    rate,
    runs,
    stationCap,
    engine,
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
    onToast,
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
    shelfRows: availableShelfRows,
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
    onGotoMarket,
  }
}

export type IndustryHudModel = ReturnType<typeof useIndustryHud>
